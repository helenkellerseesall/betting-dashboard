require("dotenv").config()
const express = require("express")
const cors = require("cors")
const axios = require("axios")

const app = express()
const fs = require("fs")
const path = require("path")
const MLScorer = require("./ml/scorer")
const { buildMoneyMakerPortfolio } = require("./upside/builders")
const { isFragileLeg, getFragileLegDiagnostics, resetFragileFilterAdjustedLogCount } = require("./pipeline/filters/fragile")
const { buildSlateEvents } = require("./pipeline/schedule/buildSlateEvents")
const { inferMarketTypeFromKey } = require("./pipeline/markets/classification")
const { buildCoverageReport } = require("./pipeline/markets/coverageReport")
const { classifyBoardRow, isTeamFirstBasketRow, isMilestoneLadderRow } = require("./pipeline/markets/boardClassification")
const { buildExpandedMarketPools, buildFinalPlayableRows } = require("./pipeline/markets/expandedPools")
const { scoreBestFallbackRow, buildBestPropsFallbackRows } = require("./pipeline/selection/bestProps")
const { buildBestLadders } = require("./pipeline/boards/buildBestLadders")
const { buildBestSpecials } = require("./pipeline/boards/buildBestSpecials")
const { buildFirstBasketBoard } = require("./pipeline/boards/buildFirstBasketBoard")
const { buildFeaturedPlays } = require("./pipeline/boards/buildFeaturedPlays")
const { buildCuratedLayer2Buckets: buildCuratedLayer2BucketsHelper } = require("./pipeline/boards/buildCuratedLayer2Buckets")
const { buildSpecialtyOutputs } = require("./pipeline/boards/buildSpecialtyOutputs")
const { buildCeilingRoleSpikeSignals, buildLineupRoleContextSignals, buildMarketContextSignals } = require("./pipeline/signals/buildPredictiveSignals")
const { createSurfaceRowBuilder, finalizeRuntimeExternalOverlay } = require("./pipeline/output/buildSurfaceRow")
const { rowTeamMatchesMatchup: rowTeamMatchesMatchupResolver, getBadTeamAssignmentRows: getBadTeamAssignmentRowsResolver, buildSpecialtyPlayerTeamIndex } = require("./pipeline/resolution/playerTeamResolution")
const { buildDecisionLayer } = require("./pipeline/edge/buildDecisionLayer")
const { buildExternalEdgeOverlay } = require("./pipeline/edge/buildExternalEdgeOverlay")
const { adaptAvailabilitySignal, toPlayerKey } = require("./pipeline/edge/buildAvailabilitySignalAdapter")
const { ingestNbaOfficialInjuryReport } = require("./pipeline/edge/ingestNbaOfficialInjuryReport")
const { ingestRotoWireSignals } = require("./pipeline/edge/ingestRotoWireSignals")
const { createEmptyMlbSnapshot, buildMlbBootstrapSnapshot } = require("./pipeline/mlb/buildMlbBootstrapSnapshot")
const { buildMlbInspectionBoard } = require("./pipeline/mlb/buildMlbInspectionBoard")

// Initialize ML scorer (loads trained model if available)
const modelPath = path.join(__dirname, "ml", "model.json")
const mlScorer = new MLScorer(modelPath)


app.use(cors())
app.use(express.json())
console.log("[SERVER-DEBUG] server.js diagnostics patch loaded")

let snapshotLoadedFromDisk = false
let lastSnapshotSource = "startup-empty"
let lastSnapshotSavedAt = null
let lastSnapshotAgeMinutes = null
let lastForceRefreshAt = null

const ENABLE_DISK_SNAPSHOT_LOAD = String(process.env.ENABLE_DISK_SNAPSHOT_LOAD || "false").toLowerCase() === "true"

let oddsSnapshot = {
  updatedAt: null,
  events: [],
  rawProps: [],
  props: [],
  eliteProps: [],
  strongProps: [],
  playableProps: [],
  bestProps: [],
  diagnostics: {},
  flexProps: [],
  parlays: null,
  dualParlays: null
}

// Phase 1 MLB bootstrap snapshot is intentionally isolated from oddsSnapshot.
let mlbSnapshot = createEmptyMlbSnapshot()
const MLB_BOOTSTRAP_CLASSIFICATION_VERSION = "phase-6-ingest-scaffold-v1"

const WATCHED_PLAYER_NAMES = [
  "Luka Doncic",
  "Luka Dončić"
]

const ACTIVE_BOOKS = ["DraftKings", "FanDuel"]

const DK_EXTRA_MARKETS = [
  "player_first_basket",
  "player_first_team_basket",
  "player_double_double",
  "player_triple_double",
  "player_points_alternate",
  "player_rebounds_alternate",
  "player_assists_alternate",
  "player_threes_alternate",
  "player_points_rebounds_assists_alternate"
]

const BASE_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists"
]

const ALL_DK_MARKETS = [...BASE_MARKETS, ...DK_EXTRA_MARKETS]
const MARKET_COVERAGE_FOCUS_KEYS = [
  "player_first_team_basket",
  "player_points_alternate",
  "player_rebounds_alternate",
  "player_assists_alternate",
  "player_threes_alternate",
  "player_points_rebounds_assists_alternate"
]
let lastMarketCoverageFocusDebug = {
  marketCoverage: MARKET_COVERAGE_FOCUS_KEYS.map((marketKey) => ({
    marketKey,
    requested: 0,
    returned: 0,
    accepted: 0,
    rejected: 0,
    final: 0
  })),
  rejectReasons: []
}

const SPECIAL_MARKET_KEYS = new Set([
  "player_first_basket",
  "player_first_team_basket",
  "player_double_double",
  "player_triple_double"
])

const SPECIAL_PROP_TYPE_NAMES = new Set([
  "First Basket",
  "First Team Basket",
  "Double Double",
  "Triple Double"
])

const UNSTABLE_GAME_EVENT_IDS = [
  "d17b632d984be98852b4bc409ae1d056",
  "24a4d71edcffcb5584a61d2aa89c66d8"
]

try {
  const snapshotPath = path.join(__dirname, "snapshot.json")
  if (!ENABLE_DISK_SNAPSHOT_LOAD) {
    snapshotLoadedFromDisk = false
    lastSnapshotSource = "startup-empty-disk-cache-disabled"
    console.log("[SNAPSHOT-CACHE] startup disk snapshot load disabled", {
      snapshotPath
    })
  } else if (fs.existsSync(snapshotPath)) {
    const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"))
    oddsSnapshot = raw.data
    if (!Array.isArray(oddsSnapshot.rawProps)) oddsSnapshot.rawProps = []
    if (!Array.isArray(oddsSnapshot.flexProps)) oddsSnapshot.flexProps = []
    if (!oddsSnapshot.diagnostics || typeof oddsSnapshot.diagnostics !== "object") oddsSnapshot.diagnostics = {}
    snapshotLoadedFromDisk = true
    lastSnapshotSource = "disk-cache"
    lastSnapshotSavedAt = raw.savedAt || null
    lastSnapshotAgeMinutes = Number.isFinite(raw.savedAt)
      ? Math.round((Date.now() - raw.savedAt) / 60000)
      : null
    console.log("[SNAPSHOT-CACHE] loaded snapshot from disk", {
      ageMinutes: lastSnapshotAgeMinutes
    })
    console.log("[TOP-DOWN-DISK-LOAD]", {
      events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
      props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
      bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1,
      updatedAt: oddsSnapshot?.updatedAt || null
    })
  }
} catch (e) {
  lastSnapshotSource = "disk-cache-load-failed"
  console.log("[SNAPSHOT-CACHE] failed to load snapshot", e.message)
}

function buildSnapshotMeta(overrides = {}) {
  const updatedAtMs = oddsSnapshot?.updatedAt ? new Date(oddsSnapshot.updatedAt).getTime() : null
  const ageMinutes = Number.isFinite(updatedAtMs)
    ? Math.max(0, Math.round((Date.now() - updatedAtMs) / 60000))
    : (Number.isFinite(lastSnapshotAgeMinutes) ? lastSnapshotAgeMinutes : null)
  const snapshotGeneratedAt = oddsSnapshot?.snapshotGeneratedAt || oddsSnapshot?.updatedAt || null
  const snapshotSlateDateLocal =
    oddsSnapshot?.snapshotSlateDateLocal ||
    oddsSnapshot?.snapshotSlateDateKey ||
    (snapshotGeneratedAt ? toDetroitDateKey(snapshotGeneratedAt) : null)

  return {
    source: overrides.source || lastSnapshotSource || "unknown",
    loadedFromDisk: snapshotLoadedFromDisk,
    updatedAt: oddsSnapshot?.updatedAt || null,
    snapshotGeneratedAt,
    snapshotSlateDateLocal,
    ageMinutes,
    savedAt: lastSnapshotSavedAt || null,
    lastForceRefreshAt,
    bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
    flexProps: Array.isArray(oddsSnapshot?.flexProps) ? oddsSnapshot.flexProps.length : 0,
    playableProps: Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps.length : 0,
    strongProps: Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps.length : 0,
    eliteProps: Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps.length : 0,
    snapshotSlateDateKey: oddsSnapshot?.snapshotSlateDateKey || null,
    snapshotSlateGameCount: Number(oddsSnapshot?.snapshotSlateGameCount || 0),
      slateStateValidator: oddsSnapshot?.slateStateValidator || null,
      lineHistorySummary: oddsSnapshot?.lineHistorySummary || null,
  }
}

function logSnapshotMeta(label, overrides = {}) {
  const meta = buildSnapshotMeta(overrides)
  console.log(`[SNAPSHOT-META] ${label}`, meta)
  return meta
}

function detectSlateMode({ sportKey, snapshotMeta, snapshot, runtime } = {}) {
  const sport = String(sportKey || "").trim().toLowerCase() || "unknown"
  const games = Number(snapshotMeta?.snapshotSlateGameCount ?? snapshot?.snapshotSlateGameCount ?? 0)
  const eventsCount = Array.isArray(snapshot?.events) ? snapshot.events.length : null
  const propsCount = Array.isArray(snapshot?.props) ? snapshot.props.length : null
  const rawPropsCount = Array.isArray(snapshot?.rawProps) ? snapshot.rawProps.length : null
  const bestPropsCount = Array.isArray(snapshot?.bestProps) ? snapshot.bestProps.length : null
  const liveRowsDetected = Number(runtime?.liveRowsDetected ?? 0)
  const liveBooksDetected = Number(runtime?.liveBooksDetected ?? 0)
  const loadedSlateQualityPassEnabled = Boolean(runtime?.loadedSlateQualityPassEnabled)
  const ageMinutes = Number.isFinite(Number(snapshotMeta?.ageMinutes)) ? Number(snapshotMeta.ageMinutes) : null

  const thresholdsBySport = {
    nba: { heavyGames: 7, lightGames: 3, minPropsHealthy: 280, minLiveRowsHealthy: 18, minBooksHealthy: 2 },
    mlb: { heavyGames: 10, lightGames: 4, minPropsHealthy: 350, minLiveRowsHealthy: 22, minBooksHealthy: 2 },
    nhl: { heavyGames: 6, lightGames: 3, minPropsHealthy: 220, minLiveRowsHealthy: 16, minBooksHealthy: 2 },
    nfl: { heavyGames: 10, lightGames: 4, minPropsHealthy: 500, minLiveRowsHealthy: 26, minBooksHealthy: 2 }
  }
  const t = thresholdsBySport[sport] || thresholdsBySport.nba

  const reasons = []
  if (games <= 0) reasons.push("no-games")
  if (Number.isFinite(propsCount) && propsCount === 0) reasons.push("no-props")
  if (Number.isFinite(rawPropsCount) && rawPropsCount === 0) reasons.push("no-raw-props")
  if (!loadedSlateQualityPassEnabled) reasons.push("loaded-slate-quality-pass-failed")
  if (ageMinutes != null && ageMinutes >= 90) reasons.push("stale-snapshot")
  if (liveBooksDetected > 0 && liveBooksDetected < t.minBooksHealthy) reasons.push("low-book-coverage")
  if (liveRowsDetected > 0 && liveRowsDetected < t.minLiveRowsHealthy) reasons.push("thin-live-rows")
  if (Number.isFinite(propsCount) && propsCount > 0 && propsCount < t.minPropsHealthy) reasons.push("thin-prop-availability")

  let mode = "normal"
  if (games >= t.heavyGames) mode = "heavy"
  else if (games >= t.lightGames) mode = "light"
  else if (games > 0) mode = "thin"

  // Promote to thinBad if key health signals fail (avoid over-patching expectations).
  const thinBadSignals =
    games <= 0 ||
    (Number.isFinite(propsCount) && propsCount === 0) ||
    (liveBooksDetected > 0 && liveBooksDetected < t.minBooksHealthy) ||
    (Number.isFinite(propsCount) && propsCount > 0 && propsCount < Math.floor(t.minPropsHealthy * 0.45))
  if (thinBadSignals) mode = "thinBad"

  return {
    sportKey: sport,
    mode,
    reasons,
    metrics: {
      games,
      eventsCount,
      propsCount,
      rawPropsCount,
      bestPropsCount,
      liveRowsDetected,
      liveBooksDetected,
      loadedSlateQualityPassEnabled,
      ageMinutes
    }
  }
}

function getLineHistoryLegKey(row) {
  return [
    String(row?.eventId || row?.gameId || row?.matchup || ""),
    String(row?.book || ""),
    String(row?.marketKey || ""),
    String(row?.propType || ""),
    String(row?.player || ""),
    String(row?.side || "")
  ].join("|")
}

function toFiniteOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function applyPersistentLineHistory(currentRows, previousRows, observedAtIso) {
  const safeCurrent = Array.isArray(currentRows) ? currentRows : []
  const safePrevious = Array.isArray(previousRows) ? previousRows : []
  const previousByKey = new Map()

  for (const row of safePrevious) {
    previousByKey.set(getLineHistoryLegKey(row), row)
  }

  return safeCurrent.map((row) => {
    const key = getLineHistoryLegKey(row)
    const prev = previousByKey.get(key)

    const latestLine = toFiniteOrNull(row?.line)
    const latestOdds = toFiniteOrNull(row?.odds)
    const previousLine = toFiniteOrNull(prev?.latestLine ?? prev?.line)
    const previousOdds = toFiniteOrNull(prev?.latestOdds ?? prev?.odds)
    const firstSeenLine = toFiniteOrNull(prev?.firstSeenLine ?? prev?.line ?? row?.line)
    const firstSeenOdds = toFiniteOrNull(prev?.firstSeenOdds ?? prev?.odds ?? row?.odds)
    const firstSeenAt = prev?.firstSeenAt || prev?.latestSeenAt || observedAtIso
    const previousSeenAt = prev?.latestSeenAt || prev?.firstSeenAt || null

    const lineMove =
      Number.isFinite(latestLine) && Number.isFinite(firstSeenLine)
        ? Number((latestLine - firstSeenLine).toFixed(3))
        : null
    const oddsMove =
      Number.isFinite(latestOdds) && Number.isFinite(firstSeenOdds)
        ? Number((latestOdds - firstSeenOdds).toFixed(3))
        : null

    return {
      ...row,
      firstSeenLine,
      firstSeenOdds,
      latestLine,
      latestOdds,
      previousLine,
      previousOdds,
      lineMove,
      oddsMove,
      firstSeenAt,
      previousSeenAt,
      latestSeenAt: observedAtIso
    }
  })
}

function buildLineHistorySummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  let movedLineCount = 0
  let movedOddsCount = 0

  for (const row of safeRows) {
    if (Number.isFinite(Number(row?.lineMove)) && Number(row?.lineMove) !== 0) movedLineCount += 1
    if (Number.isFinite(Number(row?.oddsMove)) && Number(row?.oddsMove) !== 0) movedOddsCount += 1
  }

  return {
    trackedLegs: safeRows.length,
    movedLineCount,
    movedOddsCount
  }
}

function parseHitRateInline(hitRate) {
  if (typeof hitRate === "number") return hitRate
  if (typeof hitRate !== "string") return 0
  const parts = hitRate.split("/").map((part) => Number(part))
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] > 0) {
    return parts[0] / parts[1]
  }
  const numeric = Number(hitRate)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeBookName(book) {
  const raw = String(book || "").trim()
  const lower = raw.toLowerCase()
  if (lower.includes("draftkings")) return "DraftKings"
  if (lower.includes("fanduel")) return "FanDuel"
  return raw
}

function isActiveBook(book) {
  const normalizedActiveBooks = ACTIVE_BOOKS.map((value) => normalizeBookName(value))
  return normalizedActiveBooks.includes(normalizeBookName(book))
}

function summarizeBookMarketCoverage(bookmakers) {
  const safeBooks = Array.isArray(bookmakers) ? bookmakers : []
  const byBook = {}
  const allMarketKeySet = new Set()

  for (const book of safeBooks) {
    const bookKey = String(book?.key || book?.title || "unknown")
    const markets = Array.isArray(book?.markets)
      ? book.markets
      : (Array.isArray(book?.props) ? book.props : [])
    const marketKeys = markets
      .map((market) => String(market?.key || market?.name || ""))
      .filter(Boolean)
    for (const key of marketKeys) allMarketKeySet.add(key)
    const outcomeCount = markets.reduce((count, market) => {
      const outcomes = Array.isArray(market?.outcomes)
        ? market.outcomes
        : (Array.isArray(market?.selections) ? market.selections : [])
      return count + outcomes.length
    }, 0)

    byBook[bookKey] = {
      marketCount: markets.length,
      outcomeCount,
      marketKeys,
      sampleMarkets: marketKeys.slice(0, 25)
    }
  }

  return {
    byBook,
    allMarketKeys: [...allMarketKeySet]
  }
}

function summarizeNormalizedMarketCoverage(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const byBook = {}
  const byPropType = {}
  const byMarketKey = {}
  const byBookAndPropType = {}

  for (const row of safeRows) {
    const bookKey = String(row?.book || "Unknown")
    const propTypeKey = String(row?.propType || "Unknown")
    const marketKey = String(row?.marketKey || "unknown")

    byBook[bookKey] = (byBook[bookKey] || 0) + 1
    byPropType[propTypeKey] = (byPropType[propTypeKey] || 0) + 1
    byMarketKey[marketKey] = (byMarketKey[marketKey] || 0) + 1

    if (!byBookAndPropType[bookKey]) byBookAndPropType[bookKey] = {}
    byBookAndPropType[bookKey][propTypeKey] = (byBookAndPropType[bookKey][propTypeKey] || 0) + 1
  }

  return {
    totalRows: safeRows.length,
    byBook,
    byPropType,
    byMarketKey,
    byBookAndPropType
  }
}

function detectInterestingMarketKeys(marketKeys) {
  const safeKeys = Array.isArray(marketKeys) ? marketKeys : []
  const uniqueKeys = [...new Set(safeKeys.map((key) => String(key || "").trim()).filter(Boolean))]

  const matchesAny = (key, needles) => needles.some((needle) => key.includes(needle))
  const firstBasketKeys = []
  const firstTeamBasketKeys = []
  const milestonePointKeys = []
  const altThreeKeys = []
  const doubleDoubleKeys = []
  const tripleDoubleKeys = []
  const otherInterestingKeys = []

  for (const rawKey of uniqueKeys) {
    const key = rawKey.toLowerCase()
    if (matchesAny(key, ["player first team basket", "player_first_team_basket", "first team basket", "first_team_basket"])) {
      firstTeamBasketKeys.push(rawKey)
      continue
    }
    if (matchesAny(key, ["player first basket", "player_first_basket", "first basket", "first_basket"])) {
      firstBasketKeys.push(rawKey)
      continue
    }
    if (matchesAny(key, ["player_threes_alternate", "alternate threes", "alternate_threes", "player threes alt", "player_threes_alt"])) {
      altThreeKeys.push(rawKey)
      continue
    }
    if (matchesAny(key, ["player double double", "player_double_double", "double double", "double_double"])) {
      doubleDoubleKeys.push(rawKey)
      continue
    }
    if (matchesAny(key, ["player triple double", "player_triple_double", "triple double", "triple_double"])) {
      tripleDoubleKeys.push(rawKey)
      continue
    }
    if (matchesAny(key, ["player_points_alternate", "player_rebounds_alternate", "player_assists_alternate", "player_points_rebounds_assists_alternate", "alternate points", "alternate_points", "player points alt", "player_points_alt", "25+", "30+", "35+", "40+"])) {
      milestonePointKeys.push(rawKey)
      continue
    }
    if (matchesAny(key, ["milestone", "ladder", "alternate", "special", "first scorer", "first_score"])) {
      otherInterestingKeys.push(rawKey)
    }
  }

  return {
    firstBasketKeys,
    firstTeamBasketKeys,
    milestonePointKeys,
    altThreeKeys,
    doubleDoubleKeys,
    tripleDoubleKeys,
    otherInterestingKeys
  }
}

function summarizeInterestingNormalizedRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const byPropType = {}
  const byFamily = {}

  for (const row of safeRows) {
    const marketKey = String(row?.marketKey || "")
    const inferred = inferMarketTypeFromKey(marketKey)
    const propType = String(row?.propType || inferred.internalType || "Unknown")
    const family = String(inferred.family || "unknown")

    byPropType[propType] = (byPropType[propType] || 0) + 1
    byFamily[family] = (byFamily[family] || 0) + 1
  }

  return {
    totalRows: safeRows.length,
    byPropType,
    byFamily
  }
}
// --- END MARKET EXPANSION SCAFFOLD ---

function adjustLadderMetrics(row, variantLine) {
  const baseHitRate = parseHitRate(row.hitRate)
  const baseLine = Number(row.line) || 0
  const propType = String(row.propType || "")
  const side = String(row.side || "Over")
  const shift = variantLine - baseLine
  // positive difficultyDelta = harder line
  const hardnessMultiplier = side === "Over" ? 1 : -1
  const difficultyDelta = shift * hardnessMultiplier

  let hitRatePerPoint, edgePerPoint, scorePerPoint
  if (propType === "Points") {
    hitRatePerPoint = 0.012; edgePerPoint = 0.06; scorePerPoint = 0.9
  } else if (propType === "PRA") {
    hitRatePerPoint = 0.01; edgePerPoint = 0.05; scorePerPoint = 0.8
  } else if (propType === "Assists" || propType === "Rebounds") {
    hitRatePerPoint = 0.025; edgePerPoint = 0.12; scorePerPoint = 1.0
  } else if (propType === "Threes") {
    hitRatePerPoint = 0.08; edgePerPoint = 0.22; scorePerPoint = 1.4
  } else {
    hitRatePerPoint = 0.01; edgePerPoint = 0.05; scorePerPoint = 0.8
  }

  const adjustedHitRate = Math.min(0.95, Math.max(0.20, baseHitRate - difficultyDelta * hitRatePerPoint))
  const adjustedEdge = (Number(row.edge) || 0) - difficultyDelta * edgePerPoint
  const adjustedScore = (Number(row.score) || 0) - difficultyDelta * scorePerPoint

  return {
    hitRate: Math.round(adjustedHitRate * 1000) / 1000,
    edge: Math.round(adjustedEdge * 1000) / 1000,
    score: Math.round(adjustedScore * 100) / 100
  }
}

function getSlipCandidateScore(row) {
  const hr = parseHitRateValue(row.hitRate)
  const edge = Number(row.edge || 0)
  const score = Number(row.score || 0)
  return (hr * 100) + (edge * 4) + (score * 0.35)
}

function dedupeSlipPool(rows) {
  const seen = new Set()
  return rows.filter((row) => {
    const key = [
      String(row?.player || ""),
      String(row?.propType || ""),
      String(row?.side || ""),
      String(row?.line ?? ""),
      String(row?.propVariant || "base"),
      String(row?.matchup || "")
    ].join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dedupeMarketRows(rows) {
  const seen = new Set()
  return rows.filter((row) => {
    const key = [
      String(row?.player || ""),
      String(row?.propType || ""),
      String(row?.side || ""),
      String(row?.line ?? ""),
      String(row?.matchup || ""),
      String(row?.book || "")
    ].join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const SLIP_SEED_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])

function buildSlipSeedPool(snapshot) {
  const elite = Array.isArray(snapshot?.eliteProps) ? snapshot.eliteProps : []
  const strong = Array.isArray(snapshot?.strongProps) ? snapshot.strongProps : []
  const playable = Array.isArray(snapshot?.playableProps) ? snapshot.playableProps : []
  const combined = [...elite, ...strong, ...playable]
  const seen = new Set()
  const deduped = combined.filter((row) => {
    const key = [
      String(row?.player || ""),
      String(row?.propType || ""),
      String(row?.side || ""),
      String(row?.line ?? ""),
      String(row?.matchup || ""),
      String(row?.book || "")
    ].join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const qualified = deduped.filter(
    (row) =>
      row?.book === "DraftKings" &&
      row?.team &&
      row?.hitRate != null &&
      row?.edge != null &&
      row?.score != null &&
      SLIP_SEED_PROP_TYPES.has(row?.propType)
  )
  qualified.sort((a, b) => getSlipCandidateScore(b) - getSlipCandidateScore(a))
  return qualified.slice(0, 20)
}

function buildSlipCards(bestProps, ladderPool) {
  const pickLeg = (row) => ({
    eventId: row.eventId,
    matchup: row.matchup,
    gameTime: row.gameTime,
    book: row.book,
    player: row.player,
    team: row.team,
    propType: row.propType,
    side: row.side,
    line: row.line,
    odds: row.odds,
    hitRate: row.hitRate,
    edge: row.edge,
    score: row.score,
    propVariant: row.propVariant || "base",
    sourcePool: row.sourcePool || "best"
  })

  const getLegProfile = (row) => {
    const hr = parseHitRateValue(row?.hitRate)
    const variant = String(row?.propVariant || "base")
    if (hr >= 0.78 && (variant === "base" || variant === "alt-low")) return "anchor"
    if (hr >= 0.64) return "balanced"
    return "upside"
  }

  const getSideKey = (row) => {
    const side = String(row?.side || "Over").toLowerCase()
    return side === "under" ? "under" : "over"
  }

  const americanToDecimal = (odds) => {
    const n = Number(odds)
    if (!Number.isFinite(n) || n === 0) return 1
    if (n < 0) return 1 + (100 / Math.abs(n))
    return 1 + (n / 100)
  }

  const estimateCardPayout = (legs, stake = 5) => {
    const decimalOdds = (Array.isArray(legs) ? legs : []).reduce((acc, leg) => acc * americanToDecimal(leg?.odds), 1)
    const totalReturn = stake * decimalOdds
    const profit = totalReturn - stake
    return {
      stake: Math.round(stake * 100) / 100,
      decimalOdds: Math.round(decimalOdds * 100) / 100,
      estReturn: Math.round(totalReturn * 100) / 100,
      estProfit: Math.round(profit * 100) / 100
    }
  }

  const isUsable = (row) => {
    if (!row) return false
    if (row.book !== "DraftKings") return false
    if (!row.team) return false
    if (row.hitRate == null || row.edge == null || row.score == null) return false
    if (!row.player || !row.propType || row.line == null || row.odds == null) return false
    if (shouldRemoveLegForPlayerStatus(row)) return false
    if (isFragileLeg(row)) return false
    if (!isPregameEligibleRow(row)) return false
    if (!rowTeamMatchesMatchup(row)) return false
    return true
  }

  const isSpecialPropType = (row) => SPECIAL_PROP_TYPE_NAMES.has(String(row?.propType || ""))

  const getPrimaryPriority = (row) => {
    const variant = String(row?.propVariant || "base")
    const propType = String(row?.propType || "")
    const odds = Number(row?.odds || 0)

    if (isSpecialPropType(row)) return 5
    if (variant === "alt-max") return 4
    if (variant === "alt-high") return 3
    if (variant === "alt-mid") return 2
    if (variant === "alt-low") return 1
    if (propType === "Points" || propType === "Rebounds" || propType === "Assists" || propType === "Threes" || propType === "PRA") {
      if (odds >= -220 && odds <= 160) return 0
    }
    return 1
  }

  const getPrimaryOnlyPool = (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return safeRows.filter((row) => getPrimaryPriority(row) <= 1)
  }

  const buildRankedPool = (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return [...safeRows].sort((a, b) => {
      const aPriority = getPrimaryPriority(a)
      const bPriority = getPrimaryPriority(b)
      if (aPriority !== bPriority) return aPriority - bPriority
      return getSlipCandidateScore(b) - getSlipCandidateScore(a)
    })
  }

  const snapshotStandardCandidates = Array.isArray(oddsSnapshot?.standardCandidates) ? oddsSnapshot.standardCandidates : []
  const snapshotFinalPlayableRows = Array.isArray(oddsSnapshot?.finalPlayableRows) ? oddsSnapshot.finalPlayableRows : []

  const combined = dedupeSlipPool([
    ...(Array.isArray(bestProps) ? bestProps : []).map((row) => ({ ...row, sourcePool: "best" })),
    ...(Array.isArray(ladderPool) ? ladderPool : []).map((row) => ({ ...row, sourcePool: "ladder" })),
    ...snapshotStandardCandidates.map((row) => ({ ...row, sourcePool: row?.sourcePool || "standard" })),
    ...snapshotFinalPlayableRows.map((row) => ({ ...row, sourcePool: row?.sourcePool || "playable" }))
  ]).filter(isUsable)

  const primaryOnlyPool = dedupeSlipPool(getPrimaryOnlyPool(combined))
  const ranked = buildRankedPool(combined)
  const rankedPrimary = buildRankedPool(primaryOnlyPool)

  const getComboPenalty = (row, currentLegs) => {
    let penalty = 0

    for (const leg of currentLegs) {
      // Same matchup penalty
      if (leg.matchup === row.matchup) penalty += 8

      // Same player penalty (should rarely happen but extra safety)
      if (leg.player === row.player) penalty += 12

      // Same stat type penalty (prevents stacking like 3 PRA unders)
      if (leg.propType === row.propType) penalty += 4

      // Too many unders penalty
      if (leg.side === "Under" && row.side === "Under") penalty += 3
    }

    return penalty
  }


  const getComboQualityScore = (legs) => {
    const safeLegs = Array.isArray(legs) ? legs : []
    if (!safeLegs.length) return -Infinity

    let total = 0
    let overs = 0
    let unders = 0
    const matchupSet = new Set()
    const playerSet = new Set()
    const variantSet = new Set()
    let anchorCount = 0
    let upsideCount = 0

    for (const leg of safeLegs) {
      total += getSlipCandidateScore(leg)
      if (getSideKey(leg) === "over") overs += 1
      else unders += 1
      if (leg?.matchup) matchupSet.add(String(leg.matchup))
      if (leg?.player) playerSet.add(String(leg.player))
      if (leg?.propVariant) variantSet.add(String(leg.propVariant))
      if (getLegProfile(leg) === "anchor") anchorCount += 1
      if (getLegProfile(leg) === "upside") upsideCount += 1
    }

    const payout = estimateCardPayout(safeLegs, 5)
    const estReturn = Number(payout?.estReturn || 0)
    const diversityBonus = (matchupSet.size * 4) + (playerSet.size * 2)
    const overBonus = overs >= 1 ? 6 : 0
    const variantBonus = variantSet.has("base") && variantSet.size > 1 ? 5 : 0
    const profileBonus = (anchorCount >= 1 ? 4 : 0) + (upsideCount >= 1 ? 4 : 0)
    const underPenalty = unders >= 3 ? (unders - 2) * 4 : 0

    return total + diversityBonus + overBonus + variantBonus + profileBonus + (estReturn * 0.08) - underPenalty
  }

  const buildBestComboForBand = (rankedRows, options) => {
    const {
      label,
      minLegs,
      maxLegs,
      minHitRate,
      allowedVariants,
      minReturn,
      maxReturn,
      requireAtLeastOneOver,
      requireAtLeastOneAnchor,
      requireAtLeastOneUpside,
      maxPerPlayer,
      maxPerMatchup,
      maxUnders
    } = options
    const emptyBandCard = () => ({
      label,
      legs: [],
      payout: estimateCardPayout([], 5)
    })
    const isReturnInBand = (estReturn) => estReturn >= minReturn && estReturn <= maxReturn

    const allowedSet = new Set(Array.isArray(allowedVariants) ? allowedVariants : [])
    const pool = (Array.isArray(rankedRows) ? rankedRows : []).filter((row) => {
      if (!isUsable(row)) return false
      const hr = parseHitRateValue(row.hitRate)
      if (hr < minHitRate) return false
      const variant = String(row?.propVariant || "base")
      if (allowedSet.size > 0 && !allowedSet.has(variant)) return false
      return true
    }).slice(0, 24)

    let bestCombo = null
    let bestScore = -Infinity

    const comboValid = (legs) => {
      const playerCounts = new Map()
      const matchupCounts = new Map()
      let unders = 0
      let overs = 0
      let anchors = 0
      let upsides = 0

      for (const leg of legs) {
        const player = String(leg?.player || "")
        const matchup = String(leg?.matchup || "")
        playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
        matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
        if ((playerCounts.get(player) || 0) > maxPerPlayer) return false
        if ((matchupCounts.get(matchup) || 0) > maxPerMatchup) return false
        if (getSideKey(leg) === "under") unders += 1
        else overs += 1
        if (getLegProfile(leg) === "anchor") anchors += 1
        if (getLegProfile(leg) === "upside") upsides += 1
      }

      if (unders > maxUnders) return false
      if (requireAtLeastOneOver && overs < 1) return false
      if (requireAtLeastOneAnchor && anchors < 1) return false
      if (requireAtLeastOneUpside && upsides < 1) return false
      return true
    }

    const considerCombo = (legs) => {
      if (!comboValid(legs)) return
      const payout = estimateCardPayout(legs, 5)
      const estReturn = Number(payout?.estReturn || 0)
      if (!isReturnInBand(estReturn)) return
      const comboScore = getComboQualityScore(legs)
      if (comboScore > bestScore) {
        bestScore = comboScore
        bestCombo = legs.slice()
      }
    }

    const walk = (startIndex, targetSize, current) => {
      if (current.length === targetSize) {
        considerCombo(current)
        return
      }
      for (let i = startIndex; i < pool.length; i++) {
        const row = pool[i]
        const duplicate = current.some((leg) => [
          String(leg?.player || ""),
          String(leg?.propType || ""),
          String(leg?.side || ""),
          String(leg?.line ?? ""),
          String(leg?.propVariant || "base"),
          String(leg?.matchup || "")
        ].join("|") === [
          String(row?.player || ""),
          String(row?.propType || ""),
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.propVariant || "base"),
          String(row?.matchup || "")
        ].join("|"))
        if (duplicate) continue
        current.push({ ...row, _comboScore: getSlipCandidateScore(row) - getComboPenalty(row, current) })
        walk(i + 1, targetSize, current)
        current.pop()
      }
    }

    for (let size = minLegs; size <= maxLegs; size++) {
      walk(0, size, [])
    }

    // Fallback pass if no combo found
    if (!bestCombo && !options._relaxedFallbackPass) {
      console.log("[CARD-FALLBACK] activating relaxed search for", label)

      const relaxedOptions = {
        ...options,
        requireAtLeastOneOver: false,
        requireAtLeastOneUpside: false,
        requireAtLeastOneAnchor: false,
        maxPerMatchup: Math.max(options.maxPerMatchup || 1, 3),
        minHitRate: Math.max(0, Number(options.minHitRate || 0) - 0.08),
        minReturn: Math.max(5, Number(options.minReturn || 0) * 0.8),
        maxReturn: Number(options.maxReturn || 0) * 1.25,
        maxLegs: Math.max(Number(options.maxLegs || 0), Number(options.minLegs || 0) + 2)
      }

      const relaxedResult = buildBestComboForBand(rankedRows, {
        ...relaxedOptions,
        _relaxedFallbackPass: true
      })

      if (Array.isArray(relaxedResult?.legs) && relaxedResult.legs.length > 0) {
        return relaxedResult
      }

      return emptyBandCard()
    }

    const finalLegs = Array.isArray(bestCombo) ? bestCombo.map(pickLeg) : []
    const finalPayout = estimateCardPayout(finalLegs, 5)
    const finalReturn = Number(finalPayout?.estReturn || 0)
    if (!finalLegs.length || !isReturnInBand(finalReturn)) {
      return emptyBandCard()
    }
    return {
      label,
      legs: finalLegs,
      payout: finalPayout
    }
  }

  const buildFallbackBandCard = (label, rankedRows, fallbackOptions) => {
    const primaryRows = getPrimaryOnlyPool(rankedRows)

    const primaryCard = buildBestComboForBand(primaryRows, fallbackOptions)
    if (Array.isArray(primaryCard?.legs) && primaryCard.legs.length > 0) return primaryCard

    const rankedCard = buildBestComboForBand(rankedRows, fallbackOptions)
    if (Array.isArray(rankedCard?.legs) && rankedCard.legs.length > 0) return rankedCard

    const safeRows = Array.isArray(rankedRows) ? rankedRows : []
    const emergencySource = primaryRows.length >= 2 ? primaryRows : safeRows
    const emergencyPool = emergencySource
      .filter(isUsable)
      .filter((row) => {
        const variant = String(row?.propVariant || "base")
        const allowedSet = new Set(Array.isArray(fallbackOptions?.allowedVariants) ? fallbackOptions.allowedVariants : [])
        if (allowedSet.size > 0 && !allowedSet.has(variant)) return false
        return true
      })
      .slice(0, 12)

    let bestEmergency = null
    let bestDistance = Infinity

    const minLegs = Number(fallbackOptions?.minLegs || 2)
    const maxLegs = Math.min(Number(fallbackOptions?.maxLegs || 3), 6)
    const minReturn = Number(fallbackOptions?.minReturn || 0)
    const maxReturn = Number(fallbackOptions?.maxReturn || Infinity)

    const considerEmergency = (legs) => {
      const payout = estimateCardPayout(legs, 5)
      const estReturn = Number(payout?.estReturn || 0)

      let distance = 0
      if (estReturn < minReturn) distance = minReturn - estReturn
      else if (estReturn > maxReturn) distance = estReturn - maxReturn

      if (distance < bestDistance) {
        bestDistance = distance
        bestEmergency = {
          label,
          legs: legs.map(pickLeg),
          payout
        }
      }
    }

    const walkEmergency = (startIndex, targetSize, current) => {
      if (current.length === targetSize) {
        considerEmergency(current)
        return
      }
      for (let i = startIndex; i < emergencyPool.length; i++) {
        const row = emergencyPool[i]
        const duplicate = current.some((leg) => [
          String(leg?.player || ""),
          String(leg?.propType || ""),
          String(leg?.side || ""),
          String(leg?.line ?? ""),
          String(leg?.propVariant || "base"),
          String(leg?.matchup || "")
        ].join("|") === [
          String(row?.player || ""),
          String(row?.propType || ""),
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.propVariant || "base"),
          String(row?.matchup || "")
        ].join("|"))
        if (duplicate) continue
        current.push(row)
        walkEmergency(i + 1, targetSize, current)
        current.pop()
      }
    }

    for (let size = minLegs; size <= maxLegs; size++) {
      walkEmergency(0, size, [])
    }

    if (bestEmergency && Array.isArray(bestEmergency.legs) && bestEmergency.legs.length > 0) {
      console.log("[CARD-EMERGENCY-FALLBACK]", {
        label,
        bestDistance,
        legs: bestEmergency.legs.length,
        estReturn: bestEmergency.payout?.estReturn || 0,
        usedPrimaryOnly: emergencySource === primaryRows
      })
      return bestEmergency
    }

    return {
      label,
      legs: [],
      payout: estimateCardPayout([], 5)
    }
  }

  const card50 = buildFallbackBandCard("$5 → $50", rankedPrimary, {
    label: "$5 → $50",
    minLegs: 2,
    maxLegs: 3,
    minHitRate: 0.68,
    allowedVariants: ["base", "alt-low", "alt-mid"],
    minReturn: 35,
    maxReturn: 65,
    requireAtLeastOneOver: false,
    requireAtLeastOneAnchor: true,
    requireAtLeastOneUpside: false,
    maxPerPlayer: 1,
    maxPerMatchup: 1,
    maxUnders: 2
  })

  const card100 = buildFallbackBandCard("$5 → $100", rankedPrimary, {
    label: "$5 → $100",
    minLegs: 2,
    maxLegs: 4,
    minHitRate: 0.60,
    allowedVariants: ["base", "alt-low", "alt-mid", "alt-high"],
    minReturn: 75,
    maxReturn: 140,
    requireAtLeastOneOver: true,
    requireAtLeastOneAnchor: true,
    requireAtLeastOneUpside: false,
    maxPerPlayer: 1,
    maxPerMatchup: 1,
    maxUnders: 2
  })

  const card300 = buildFallbackBandCard("$5 → $300", ranked, {
    label: "$5 → $300",
    minLegs: 2,
    maxLegs: 5,
    minHitRate: 0.52,
    allowedVariants: ["base", "alt-low", "alt-mid", "alt-high", "alt-max"],
    minReturn: 220,
    maxReturn: 380,
    requireAtLeastOneOver: true,
    requireAtLeastOneAnchor: true,
    requireAtLeastOneUpside: true,
    maxPerPlayer: 1,
    maxPerMatchup: 2,
    maxUnders: 3
  })
  const card50Return = Number(card50?.payout?.estReturn || 0)
  const card100Return = Number(card100?.payout?.estReturn || 0)
  const card300Return = Number(card300?.payout?.estReturn || 0)
  const card50InRange = card50.legs.length > 0 && card50Return >= 35 && card50Return <= 65
  const card100InRange = card100.legs.length > 0 && card100Return >= 75 && card100Return <= 140
  const card300InRange = card300.legs.length > 0 && card300Return >= 220 && card300Return <= 380

  console.log("[SLIP-CARDS-DEBUG]", {
    bestCount: Array.isArray(bestProps) ? bestProps.length : 0,
    ladderCount: Array.isArray(ladderPool) ? ladderPool.length : 0,
    combinedCount: combined.length,
    primaryOnlyCount: primaryOnlyPool.length,
    rankedPrimaryCount: rankedPrimary.length,
    rankedCount: ranked.length,
    standardCandidateCount: snapshotStandardCandidates.length,
    finalPlayableCandidateCount: snapshotFinalPlayableRows.length,
    topRankedSample: ranked.slice(0, 8).map((row) => ({
      player: row?.player || null,
      team: row?.team || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      side: row?.side || null,
      line: row?.line ?? null,
      odds: row?.odds ?? null,
      propVariant: row?.propVariant || "base",
      sourcePool: row?.sourcePool || null
    })),
    topPrimarySample: rankedPrimary.slice(0, 8).map((row) => ({
      player: row?.player || null,
      team: row?.team || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      side: row?.side || null,
      line: row?.line ?? null,
      odds: row?.odds ?? null,
      propVariant: row?.propVariant || "base",
      sourcePool: row?.sourcePool || null
    })),
    card50Legs: card50.legs.length,
    card50Overs: card50.legs.filter((row) => getSideKey(row) === "over").length,
    card50Unders: card50.legs.filter((row) => getSideKey(row) === "under").length,
    card50Return,
    card50InRange,
    card100Legs: card100.legs.length,
    card100Overs: card100.legs.filter((row) => getSideKey(row) === "over").length,
    card100Unders: card100.legs.filter((row) => getSideKey(row) === "under").length,
    card100Return,
    card100InRange,
    card300Legs: card300.legs.length,
    card300Overs: card300.legs.filter((row) => getSideKey(row) === "over").length,
    card300Unders: card300.legs.filter((row) => getSideKey(row) === "under").length,
    card300Return,
    card300InRange
  })

  return {
    card50,
    card100,
    card300
  }
}

function getLadderVariantsForRow(row) {
  const hasCompleteLadderData =
    row &&
    row.team &&
    row.hitRate != null &&
    row.hitRate !== "" &&
    row.edge != null &&
    row.score != null

  if (!hasCompleteLadderData) {
    return [{ ...row, isAlt: false, propVariant: "base" }]
  }

  const baseLine = Number(row.line) || 0
  const propType = String(row.propType || "")
  const side = String(row.side || "Over")

  function clampLine(l) {
    const clamped = Math.max(0.5, l)
    if (Number.isInteger(baseLine)) return Math.round(clamped)
    return Math.round(clamped * 2) / 2
  }

  let offsets
  if (propType === "Points") {
    offsets = side === "Over"
      ? [
          { propVariant: "alt-low", lineOffset: -4 },
          { propVariant: "alt-mid", lineOffset: -2 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: 3 },
          { propVariant: "alt-max", lineOffset: 6 }
        ]
      : [
          { propVariant: "alt-low", lineOffset: 4 },
          { propVariant: "alt-mid", lineOffset: 2 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: -3 },
          { propVariant: "alt-max", lineOffset: -6 }
        ]
  } else if (propType === "PRA") {
    offsets = side === "Over"
      ? [
          { propVariant: "alt-low", lineOffset: -5 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: 5 }
        ]
      : [
          { propVariant: "alt-low", lineOffset: 5 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: -5 }
        ]
  } else if (propType === "Assists" || propType === "Rebounds") {
    offsets = side === "Over"
      ? [
          { propVariant: "alt-low", lineOffset: -2 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: 2 }
        ]
      : [
          { propVariant: "alt-low", lineOffset: 2 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: -2 }
        ]
  } else if (propType === "Threes") {
    offsets = side === "Over"
      ? [
          { propVariant: "alt-low", lineOffset: -1 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: 1 },
          { propVariant: "alt-max", lineOffset: 2 }
        ]
      : [
          { propVariant: "alt-low", lineOffset: 1 },
          { propVariant: "base", lineOffset: 0 },
          { propVariant: "alt-high", lineOffset: -1 },
          { propVariant: "alt-max", lineOffset: -2 }
        ]
  } else {
    return [{ ...row, isAlt: false, propVariant: "base" }]
  }

  return offsets.map(({ propVariant, lineOffset }) => {
    const variantLine = clampLine(baseLine + lineOffset)
    const isAlt = propVariant !== "base"
    const adjustedMetrics = isAlt ? adjustLadderMetrics(row, variantLine) : {}
    return { ...row, line: variantLine, isAlt, propVariant, ...adjustedMetrics }
  })
}

function getDualExpandedEligibleRows() {
  const rawRows = dedupeByLegSignature([
    ...(Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props : []),
    ...(Array.isArray(oddsSnapshot.eliteProps) ? oddsSnapshot.eliteProps : []),
    ...(Array.isArray(oddsSnapshot.strongProps) ? oddsSnapshot.strongProps : []),
    ...(Array.isArray(oddsSnapshot.playableProps) ? oddsSnapshot.playableProps : []),
    ...(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])
  ])

  const eligibleRows = getAvailablePrimarySlateRows(rawRows)
  const rawGames = [...new Set(rawRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const eligibleGames = [...new Set(eligibleRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  logPayloadDebugExclusions("dualExpandedEligibleRows", rawRows, eligibleRows)
  console.log("[DUAL-EXPANDED-GAME-DEBUG]", {
    rawRowCount: rawRows.length,
    eligibleRowCount: eligibleRows.length,
    rawGameCount: rawGames.length,
    eligibleGameCount: eligibleGames.length,
    rawGames,
    eligibleGames
  })

  return eligibleRows
}

function buildDualPoolDiagnostics(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const statTypes = ["Points", "Rebounds", "Assists", "Threes", "PRA"]
  const books = ["FanDuel", "DraftKings"]
  const byBook = {}
  const byStat = {}

  for (const book of books) {
    const bookRows = safeRows.filter((row) => row.book === book)
    byBook[book] = {
      total: bookRows.length,
      points: bookRows.filter((row) => row.propType === "Points").length,
      rebounds: bookRows.filter((row) => row.propType === "Rebounds").length,
      assists: bookRows.filter((row) => row.propType === "Assists").length,
      threes: bookRows.filter((row) => row.propType === "Threes").length,
      pra: bookRows.filter((row) => row.propType === "PRA").length
    }
  }

  for (const statType of statTypes) {
    const statRows = safeRows.filter((row) => row.propType === statType)
    byStat[statType] = {
      total: statRows.length,
      fanduel: statRows.filter((row) => row.book === "FanDuel").length,
      draftkings: statRows.filter((row) => row.book === "DraftKings").length
    }
  }

  return {
    totalEligible: safeRows.length,
    rawProps: Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props.length : 0,
    byBook,
    byStat
  }
}

function buildDualStatLeaderboards(rows) {
  const books = ["FanDuel", "DraftKings"]
  const statTypes = ["Points", "Rebounds", "Assists", "Threes", "PRA"]
  const result = {}

  for (const book of books) {
    result[book.toLowerCase()] = {}

    for (const statType of statTypes) {
      const statRows = dedupeByLegSignature(
        rows.filter((row) => row.book === book && row.propType === statType)
      )
        .filter((row) => !shouldRemoveLegForPlayerStatus(row))
        .filter((row) => !isFragileLeg(row))
        .sort((a, b) => {
          const aHitRate = parseHitRateInline(a.hitRate)
          const bHitRate = parseHitRateInline(b.hitRate)
          const aEdge = Number(a.edge || a.projectedValue || 0)
          const bEdge = Number(b.edge || b.projectedValue || 0)
          const aScore = Number(a.score || 0)
          const bScore = Number(b.score || 0)
          const aMinutesRisk = String(a.minutesRisk || "").toLowerCase() === "low" ? 0.08 : 0
          const bMinutesRisk = String(b.minutesRisk || "").toLowerCase() === "low" ? 0.08 : 0
          const aInjuryRisk = String(a.injuryRisk || "").toLowerCase() === "low" ? 0.05 : 0
          const bInjuryRisk = String(b.injuryRisk || "").toLowerCase() === "low" ? 0.05 : 0
          const aTrendRisk = String(a.trendRisk || "").toLowerCase() === "high" ? -0.08 : 0
          const bTrendRisk = String(b.trendRisk || "").toLowerCase() === "high" ? -0.08 : 0
          const aComposite = (aHitRate * 0.55) + (aEdge / 12 * 0.2) + (aScore / 140 * 0.17) + aMinutesRisk + aInjuryRisk + aTrendRisk
          const bComposite = (bHitRate * 0.55) + (bEdge / 12 * 0.2) + (bScore / 140 * 0.17) + bMinutesRisk + bInjuryRisk + bTrendRisk
          return bComposite - aComposite
        })
        .slice(0, 3)
        .map((row) => ({
          eventId: row.eventId,
          matchup: row.matchup,
          gameTime: row.gameTime,
          book: row.book,
          player: row.player,
          team: row.team,
          propType: row.propType,
          side: row.side,
          line: row.line,
          odds: row.odds,
          hitRate: row.hitRate,
          edge: row.edge,
          score: row.score,
          l10Avg: row.l10Avg,
          recent5Avg: row.recent5Avg,
          recent3Avg: row.recent3Avg,
          avgMin: row.avgMin,
          minutesRisk: row.minutesRisk,
          trendRisk: row.trendRisk,
          injuryRisk: row.injuryRisk,
          dvpScore: row.dvpScore
        }))

      result[book.toLowerCase()][statType.toLowerCase()] = statRows
    }
  }

  return result
}

// ─── Diagnostics helpers ───────────────────────────────────────────────────

function buildRawCoverage() {
  const raw = Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length
    ? oddsSnapshot.rawProps
    : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])
  const books = ["FanDuel", "DraftKings"]
  const statTypes = ["Points", "Rebounds", "Assists", "Threes", "PRA"]

  const byBook = {}
  for (const bk of books) {
    byBook[bk] = raw.filter((r) => r?.book === bk).length
  }

  const byStat = {}
  for (const st of statTypes) {
    byStat[st] = raw.filter((r) => r?.propType === st).length
  }

  const byBookAndStat = {}
  for (const bk of books) {
    byBookAndStat[bk] = {}
    for (const st of statTypes) {
      byBookAndStat[bk][st] = raw.filter((r) => r?.book === bk && r?.propType === st).length
    }
  }

  const gameSet = new Set()
  const playerSet = new Set()
  let missingTeam = 0, missingOdds = 0, missingLine = 0, missingPropType = 0
  for (const r of raw) {
    if (r?.matchup) gameSet.add(String(r.matchup))
    if (r?.player) playerSet.add(String(r.player))
    if (!r?.team) missingTeam++
    if (r?.odds == null || r?.odds === "") missingOdds++
    if (r?.line == null || r?.line === "") missingLine++
    if (!r?.propType) missingPropType++
  }

  return {
    totalRawProps: raw.length,
    byBook,
    byStat,
    byBookAndStat,
    uniqueGames: gameSet.size,
    uniquePlayers: playerSet.size,
    missingFields: { team: missingTeam, odds: missingOdds, line: missingLine, propType: missingPropType }
  }
}

function buildStageCounts(expandedEligibleRows, dualBestPropsPool) {
  const safeExpanded = Array.isArray(expandedEligibleRows) ? expandedEligibleRows : []
  const safeDualPool = Array.isArray(dualBestPropsPool) ? dualBestPropsPool : []
  const rawProps = Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0
  const bestPropsRaw = Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0

  const finalBestRows = getAvailablePrimarySlateRows(Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps : [])
  const finalBestFD = finalBestRows.filter((r) => r?.book === "FanDuel").length
  const finalBestDK = finalBestRows.filter((r) => r?.book === "DraftKings").length

  return {
    rawProps,
    bestPropsRaw,
    expandedEligibleRows: safeExpanded.length,
    expandedByBook: {
      FanDuel: safeExpanded.filter((r) => r?.book === "FanDuel").length,
      DraftKings: safeExpanded.filter((r) => r?.book === "DraftKings").length
    },
    dualBestPropsPool: safeDualPool.length,
    finalBestVisible: {
      fanduel: finalBestFD,
      draftkings: finalBestDK,
      total: finalBestFD + finalBestDK
    }
  }
}

function buildExclusionSummary() {
  const raw = Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []
  const todayKey = (() => { try { return getLocalSlateDateKey(new Date().toISOString()) } catch (_) { return "" } })()
  const fragileReasonCounts = {}

  let removedByPlayerStatus = 0
  let removedByFragile = 0
  let invalidGameTime = 0
  let notPrimarySlate = 0
  let missingRequiredFields = 0
  let removedByPregameStatus = 0
  let dedupedOut = 0
  let survived = 0

  // Track keys seen to count deduplication drops
  const seenLegSig = new Set()

  for (const r of raw) {
    if (!r) continue

    // Missing required fields check
    if (!r.player || !r.propType || r.line == null) {
      missingRequiredFields++
      continue
    }

    // Player status check
    if (shouldRemoveLegForPlayerStatus(r)) {
      removedByPlayerStatus++
      continue
    }

    // Fragile leg check
    const fragileDiagnostics = getFragileLegDiagnostics(r, "default")
    if (fragileDiagnostics.fragile) {
      removedByFragile++
      for (const reason of fragileDiagnostics.reasons) {
        fragileReasonCounts[reason] = (fragileReasonCounts[reason] || 0) + 1
      }
      continue
    }

    if (!r?.gameTime) {
      invalidGameTime++
      continue
    }

    const gameMs = new Date(r.gameTime).getTime()
    if (!Number.isFinite(gameMs)) {
      invalidGameTime++
      continue
    }

    if (!isPregameEligibleRow(r)) {
      removedByPregameStatus++
      continue
    }

    // Dedupe check (mimics dedupeByLegSignature key)
    const legSig = `${r.player}|${r.propType}|${r.book}|${r.side}|${r.line}`
    if (seenLegSig.has(legSig)) {
      dedupedOut++
      continue
    }
    seenLegSig.add(legSig)
    survived++
  }

  return {
    totalRaw: raw.length,
    survived,
    removedByPlayerStatus,
    removedByFragile,
    invalidGameTime,
    notPrimarySlate,
    missingRequiredFields,
    removedByPregameStatus,
    fragileReasonCounts,
    dedupedOut,
    totalExcluded: raw.length - survived
  }
}

function normalizeDebugPlayerName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function rowTeamMatchesMatchup(row) {
  return rowTeamMatchesMatchupResolver(row, teamAbbr)
}

function getBadTeamAssignmentRows(rows, limit = 25) {
  return getBadTeamAssignmentRowsResolver(rows, limit, teamAbbr)
}

function summarizeIdentityChanges(rawRows, enrichedRows, limit = 25) {
  const safeRaw = Array.isArray(rawRows) ? rawRows : []
  const safeEnriched = Array.isArray(enrichedRows) ? enrichedRows : []
  const total = Math.min(safeRaw.length, safeEnriched.length)
  const maxLimit = Number.isFinite(limit) ? Math.max(0, Number(limit)) : 25
  let changedCount = 0
  let playerChanged = 0
  let teamChanged = 0
  let matchupChanged = 0
  let eventChanged = 0
  let bookChanged = 0
  let propChanged = 0
  let sideChanged = 0
  let lineChanged = 0
  const sample = []
  for (let i = 0; i < total; i++) {
    const raw = safeRaw[i]
    const enriched = safeEnriched[i]
    const pChg = String(raw?.player ?? "") !== String(enriched?.player ?? "")
    const tChg = String(raw?.team ?? "") !== String(enriched?.team ?? "")
    const mChg = String(raw?.matchup ?? "") !== String(enriched?.matchup ?? "")
    const aChg = String(raw?.awayTeam ?? "") !== String(enriched?.awayTeam ?? "")
    const hChg = String(raw?.homeTeam ?? "") !== String(enriched?.homeTeam ?? "")
    const eChg = String(raw?.eventId ?? "") !== String(enriched?.eventId ?? "")
    const bChg = String(raw?.book ?? "") !== String(enriched?.book ?? "")
    const prChg = String(raw?.propType ?? "") !== String(enriched?.propType ?? "")
    const sChg = String(raw?.side ?? "") !== String(enriched?.side ?? "")
    const lChg = String(raw?.line ?? "") !== String(enriched?.line ?? "")
    const anyChanged = pChg || tChg || mChg || aChg || hChg || eChg || bChg || prChg || sChg || lChg
    if (!anyChanged) continue
    changedCount++
    if (pChg) playerChanged++
    if (tChg) teamChanged++
    if (mChg) matchupChanged++
    if (eChg) eventChanged++
    if (bChg) bookChanged++
    if (prChg) propChanged++
    if (sChg) sideChanged++
    if (lChg) lineChanged++
    if (sample.length < maxLimit) {
      sample.push({
        index: i,
        rawPlayer: raw?.player,
        enrichedPlayer: enriched?.player,
        rawTeam: raw?.team,
        enrichedTeam: enriched?.team,
        rawMatchup: raw?.matchup,
        enrichedMatchup: enriched?.matchup,
        rawEventId: raw?.eventId,
        enrichedEventId: enriched?.eventId,
        rawBook: raw?.book,
        enrichedBook: enriched?.book,
        rawPropType: raw?.propType,
        enrichedPropType: enriched?.propType,
        rawSide: raw?.side,
        enrichedSide: enriched?.side,
        rawLine: raw?.line,
        enrichedLine: enriched?.line
      })
    }
  }
  return {
    totalCompared: total,
    changedCount,
    playerChanged,
    teamChanged,
    matchupChanged,
    eventChanged,
    bookChanged,
    propChanged,
    sideChanged,
    lineChanged,
    sample
  }
}

function getEventIdForDebug(event) {
  const id = event?.id ?? event?.eventId
  return id == null ? "" : String(id)
}

function getEventMatchupForDebug(event) {
  const away = event?.away_team || event?.awayTeam || ""
  const home = event?.home_team || event?.homeTeam || ""
  if (away && home) return `${away} @ ${home}`
  if (event?.matchup) return String(event.matchup)
  return "UNKNOWN_MATCHUP"
}

function getEventTimeForDebug(event) {
  return event?.commence_time || event?.gameTime || event?.startTime || event?.start_time || event?.game_time || null
}

function getDistinctGameCount(items = []) {
  const safeItems = Array.isArray(items) ? items : []
  const gameKeys = new Set()

  for (const item of safeItems) {
    const eventId = getEventIdForDebug(item) || String(item?.eventId || "").trim()
    const matchup = String(item?.matchup || getEventMatchupForDebug(item) || "").trim()
    const key = eventId || matchup
    if (key) gameKeys.add(key)
  }

  return gameKeys.size
}

function aggregateMarketCoverageFocusDebug(eventIngestDebug = []) {
  const totalsByKey = MARKET_COVERAGE_FOCUS_KEYS.reduce((acc, key) => {
    acc[key] = { requested: 0, returned: 0, accepted: 0, rejected: 0, final: 0 }
    return acc
  }, {})
  const rejectReasonTotals = {}

  for (const entry of Array.isArray(eventIngestDebug) ? eventIngestDebug : []) {
    const focus = entry?.marketCoverageFocusDebug
    if (!focus) continue

    const coverageRows = Array.isArray(focus?.marketCoverage) ? focus.marketCoverage : []
    for (const row of coverageRows) {
      const key = String(row?.marketKey || "")
      if (!totalsByKey[key]) continue
      totalsByKey[key].requested += Number(row?.requested || 0)
      totalsByKey[key].returned += Number(row?.returned || 0)
      totalsByKey[key].accepted += Number(row?.accepted || 0)
      totalsByKey[key].rejected += Number(row?.rejected || 0)
      totalsByKey[key].final += Number(row?.final || 0)
    }

    const reasons = Array.isArray(focus?.rejectReasons) ? focus.rejectReasons : []
    for (const reasonRow of reasons) {
      const reason = String(reasonRow?.reason || "unknown")
      rejectReasonTotals[reason] = Number(rejectReasonTotals[reason] || 0) + Number(reasonRow?.count || 0)
    }
  }

  return {
    marketCoverage: MARKET_COVERAGE_FOCUS_KEYS.map((marketKey) => ({
      marketKey,
      requested: totalsByKey[marketKey].requested,
      returned: totalsByKey[marketKey].returned,
      accepted: totalsByKey[marketKey].accepted,
      rejected: totalsByKey[marketKey].rejected,
      final: totalsByKey[marketKey].final
    })),
    rejectReasons: Object.entries(rejectReasonTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count }))
  }
}

async function fetchDkScopedEventsForDebug(oddsApiKey) {
  const response = await axios.get("https://api.the-odds-api.com/v4/sports/basketball_nba/odds", {
    params: {
      apiKey: oddsApiKey,
      regions: "us",
      bookmakers: "draftkings",
      markets: "h2h",
      oddsFormat: "american"
    },
    timeout: 15000
  })

  return Array.isArray(response?.data) ? response.data : []
}

function runCurrentSlateCoverageDiagnostics(debugStages = {}) {
  const scheduledEvents = Array.isArray(debugStages?.scheduledEvents) ? debugStages.scheduledEvents : []
  const rawPropsRows = Array.isArray(debugStages?.rawPropsRows) ? debugStages.rawPropsRows : []
  const enrichedModelRows = Array.isArray(debugStages?.enrichedModelRows) ? debugStages.enrichedModelRows : []
  const survivedFragileRows = Array.isArray(debugStages?.survivedFragileRows) ? debugStages.survivedFragileRows : []
  const bestPropsRawRows = Array.isArray(debugStages?.bestPropsRawRows) ? debugStages.bestPropsRawRows : []
  const finalBestVisibleRows = Array.isArray(debugStages?.finalBestVisibleRows) ? debugStages.finalBestVisibleRows : []

  const scheduledByEventId = new Map()
  for (const event of scheduledEvents) {
    const eventId = getEventIdForDebug(event)
    if (!eventId) continue
    scheduledByEventId.set(eventId, {
      eventId,
      matchup: getEventMatchupForDebug(event),
      commenceTime: event?.commence_time || event?.gameTime || null
    })
  }

  const rawEventIds = new Set(
    rawPropsRows
      .map((row) => (row?.eventId == null ? "" : String(row.eventId)))
      .filter(Boolean)
  )

  const missingScheduledGames = [...scheduledByEventId.values()].filter((event) => !rawEventIds.has(event.eventId))

  const perGamePlayerNames = new Map()
  const perGameNormalizedPlayers = new Map()
  for (const row of rawPropsRows) {
    const eventId = row?.eventId == null ? "" : String(row.eventId)
    if (!eventId) continue
    const rawName = String(row?.player || row?.playerName || "").trim()
    if (!rawName) continue
    const normalized = normalizeDebugPlayerName(rawName)
    if (!perGamePlayerNames.has(eventId)) perGamePlayerNames.set(eventId, new Set())
    if (!perGameNormalizedPlayers.has(eventId)) perGameNormalizedPlayers.set(eventId, new Set())
    perGamePlayerNames.get(eventId).add(rawName)
    if (normalized) perGameNormalizedPlayers.get(eventId).add(normalized)
  }

  const limitedEvents = [...scheduledByEventId.values()].slice(0, 6)
  const perGameCoverage = limitedEvents.map((event) => {
    const rawPlayers = [...(perGamePlayerNames.get(event.eventId) || new Set())].sort()
    const normalizedPlayers = [...(perGameNormalizedPlayers.get(event.eventId) || new Set())].sort()
    return {
      eventId: event.eventId,
      matchup: event.matchup,
      commenceTime: event.commenceTime,
      rawPlayerCount: rawPlayers.length,
      normalizedPlayerCount: normalizedPlayers.length,
      rawPlayers,
      normalizedPlayers
    }
  })

  const suspiciouslyThinGames = perGameCoverage.filter((game) => game.normalizedPlayerCount > 0 && game.normalizedPlayerCount < 12)

  const watchedPlayers = [
    "Luka Doncic",
    "Luka Dončić"
  ]

  const stageRows = [
    { key: "rawProps", rows: rawPropsRows },
    { key: "finalBestVisible", rows: finalBestVisibleRows }
  ]

  const watchedSummary = watchedPlayers.map((watchedName) => {
    const targetNorm = normalizeDebugPlayerName(watchedName)
    const stagePresence = {}

    for (const stage of stageRows) {
      const matches = stage.rows.filter((row) => normalizeDebugPlayerName(row?.player || row?.playerName) === targetNorm)
      stagePresence[stage.key] = {
        present: matches.length > 0,
        count: matches.length,
        books: [...new Set(matches.map((row) => String(row?.book || "")).filter(Boolean))],
        eventIds: [...new Set(matches.map((row) => String(row?.eventId || "")).filter(Boolean))]
      }
    }

    let disappearedAfterStage = null
    if (stagePresence.rawProps?.present) {
      for (let index = 1; index < stageRows.length; index++) {
        const prev = stageRows[index - 1].key
        const current = stageRows[index].key
        if (stagePresence[prev]?.present && !stagePresence[current]?.present) {
          disappearedAfterStage = prev
          break
        }
      }
    }

    return {
      watchedName,
      normalizedName: targetNorm,
      stagePresence,
      disappearedAfterStage
    }
  })

  const finalVisibleByBook = {
    FanDuel: finalBestVisibleRows.filter((row) => row?.book === "FanDuel").length,
    DraftKings: finalBestVisibleRows.filter((row) => row?.book === "DraftKings").length
  }

  if (process.env.DISABLE_HEAVY_DEBUG === "true") return;
  console.log("[COVERAGE-AUDIT-DEBUG]", {
    scheduledCount: scheduledByEventId.size,
    rawEventIdCount: rawEventIds.size,
    missingGamesCount: missingScheduledGames.length
  })

  console.log("[MISSING-GAMES-DETAIL-DEBUG]", {
    missingGames: missingScheduledGames.map((game) => ({
      eventId: game.eventId,
      matchup: game.matchup
    }))
  })

  console.log("[MISSING-PLAYER-AUDIT-DEBUG]", {
    totalGames: perGameCoverage.length,
    thinGames: suspiciouslyThinGames.length
  })

  console.log("[WATCHED-PLAYER-STAGE-DEBUG]", {
    watchedPlayers,
    summary: watchedSummary.map((playerSummary) => ({
      name: playerSummary.watchedName,
      disappearedAfterStage: playerSummary.disappearedAfterStage
    })),
    finalVisibleByBook
  })

  console.log("[WATCHED-PLAYER-PRESENCE-DEBUG]", {
    players: watchedSummary.map((playerSummary) => ({
      name: playerSummary.watchedName,
      rawPropsPresent: Boolean(playerSummary?.stagePresence?.rawProps?.present),
      finalBestVisiblePresent: Boolean(playerSummary?.stagePresence?.finalBestVisible?.present),
      rawPropsCount: Number(playerSummary?.stagePresence?.rawProps?.count || 0),
      finalBestVisibleCount: Number(playerSummary?.stagePresence?.finalBestVisible?.count || 0)
    }))
  })
}

function buildWideLeaderboards() {
  // Use a wider pool: all props arrays deduplicated, filter only for obviously invalid rows
  const wideRaw = [
    ...(Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []),
    ...(Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps : []),
    ...(Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps : []),
    ...(Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps : []),
    ...(Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps : [])
  ]

  const deduped = (() => {
    try { return dedupeByLegSignature(wideRaw) } catch (_) { return wideRaw }
  })().filter((r) => r && r.player && r.propType && r.book)
    .filter((r) => { try { return !shouldRemoveLegForPlayerStatus(r) } catch (_) { return true } })
    .filter((r) => { try { return !isFragileLeg(r) } catch (_) { return true } })

  const books = ["FanDuel", "DraftKings"]
  const statTypes = ["Points", "Rebounds", "Assists", "Threes", "PRA"]
  const result = {}

  for (const bk of books) {
    result[bk] = {}
    const bookRows = deduped.filter((r) => r.book === bk)
    for (const st of statTypes) {
      const statRows = bookRows.filter((r) => r.propType === st)
      const sorted = statRows.slice().sort((a, b) => {
        const aHR = parseHitRateInline(a.hitRate)
        const bHR = parseHitRateInline(b.hitRate)
        const aEdge = Number(a.edge || a.projectedValue || 0)
        const bEdge = Number(b.edge || b.projectedValue || 0)
        const aScore = Number(a.score || 0)
        const bScore = Number(b.score || 0)
        const aMR = String(a.minutesRisk || "").toLowerCase() === "low" ? 0.08 : 0
        const bMR = String(b.minutesRisk || "").toLowerCase() === "low" ? 0.08 : 0
        const aIR = String(a.injuryRisk || "").toLowerCase() === "low" ? 0.05 : 0
        const bIR = String(b.injuryRisk || "").toLowerCase() === "low" ? 0.05 : 0
        const aTR = String(a.trendRisk || "").toLowerCase() === "high" ? -0.08 : 0
        const bTR = String(b.trendRisk || "").toLowerCase() === "high" ? -0.08 : 0
        const aC = (aHR * 0.55) + (aEdge / 12 * 0.2) + (aScore / 140 * 0.17) + aMR + aIR + aTR
        const bC = (bHR * 0.55) + (bEdge / 12 * 0.2) + (bScore / 140 * 0.17) + bMR + bIR + bTR
        return bC - aC
      })
      result[bk][st] = sorted.slice(0, 5).map((r) => ({
        player: r.player,
        team: r.team,
        matchup: r.matchup,
        propType: r.propType,
        side: r.side,
        line: r.line,
        odds: r.odds,
        hitRate: r.hitRate,
        edge: r.edge,
        score: r.score,
        l10Avg: r.l10Avg,
        recent5Avg: r.recent5Avg,
        recent3Avg: r.recent3Avg,
        avgMin: r.avgMin,
        minutesRisk: r.minutesRisk,
        trendRisk: r.trendRisk,
        injuryRisk: r.injuryRisk,
        dvpScore: r.dvpScore
      }))
    }
  }

  return result
}

// ─── End diagnostics helpers ────────────────────────────────────────────────

// scoreBestFallbackRow and buildBestPropsFallbackRows are exported from
// ./pipeline/selection/bestProps (required at top of file)

function getFlexPropScore(row) {
  const hitRate = parseHitRateInline(row?.hitRate)
  const edge = Number(row?.edge || row?.projectedValue || 0)
  const score = Number(row?.score || 0)
  const odds = Number(row?.odds || 0)
  const trendRisk = String(row?.trendRisk || "").toLowerCase()
  const propType = String(row?.propType || "")

  const oddsBonus =
    odds >= -150 && odds <= 200 ? 0.12 :
    odds > 200 ? 0.04 :
    odds >= -220 ? 0.08 : 0

  const trendBonus =
    trendRisk === "low" ? 0.06 :
    trendRisk === "medium" ? 0.02 : 0

  const propBonus =
    propType === "Threes" ? 0.08 :
    propType === "Points" ? 0.06 :
    propType === "PRA" ? 0.04 : 0

  return hitRate * 0.5 + (edge / 12) * 0.2 + (score / 140) * 0.15 + oddsBonus + trendBonus + propBonus
}

function isFlexEligibleRow(row) {
  if (!row) return false
  if (shouldRemoveLegForPlayerStatus(row)) return false
  if (isFragileLeg(row)) return false

  const hitRate = parseHitRateInline(row.hitRate)
  const avgMin = Number(row.avgMin || 0)
  const edge = Number(row.edge || row.projectedValue || 0)
  const minutesRisk = String(row.minutesRisk || "").toLowerCase()
  const injuryRisk = String(row.injuryRisk || "").toLowerCase()
  const removed = Boolean(row.removed)

  if (removed) return false
  if (minutesRisk === "high" && hitRate < 0.5) return false
  if (injuryRisk === "high") return false
  if (hitRate < 0.38) return false
  if (avgMin > 0 && avgMin < 10) return false
  if (edge < -4) return false

  return true
}

function getFlexTargetSize(totalRows) {
  if (!Number.isFinite(totalRows) || totalRows <= 0) return 50
  return Math.max(50, Math.min(100, Math.round(totalRows * 0.4)))
}

function buildFlexPropsPool(label, sourceRows) {
  const source = Array.isArray(sourceRows) ? sourceRows : []
  const deduped = dedupeByLegSignature(source)

  const beforeByProp = {}
  const beforeByBook = {}
  for (const row of deduped) {
    const propType = String(row?.propType || "unknown")
    const book = String(row?.book || "unknown")
    beforeByProp[propType] = (beforeByProp[propType] || 0) + 1
    beforeByBook[book] = (beforeByBook[book] || 0) + 1
  }

  const filtered = deduped.filter((row) => isFlexEligibleRow(row))
  const flexDropCounts = {
    removed: 0,
    playerStatus: 0,
    fragile: 0,
    minutesRiskHighLowHitRate: 0,
    injuryRiskHigh: 0,
    hitRateTooLow: 0,
    avgMinTooLow: 0,
    edgeTooLow: 0,
    survived: filtered.length
  }

  for (const row of deduped) {
    if (!row) continue
    if (row.removed) {
      flexDropCounts.removed++
      continue
    }
    if (shouldRemoveLegForPlayerStatus(row)) {
      flexDropCounts.playerStatus++
      continue
    }
    if (isFragileLeg(row)) {
      flexDropCounts.fragile++
      continue
    }

    const hitRate = parseHitRateInline(row.hitRate)
    const avgMin = Number(row.avgMin || 0)
    const edge = Number(row.edge || row.projectedValue || 0)
    const minutesRisk = String(row.minutesRisk || "").toLowerCase()
    const injuryRisk = String(row.injuryRisk || "").toLowerCase()

    if (minutesRisk === "high" && hitRate < 0.5) {
      flexDropCounts.minutesRiskHighLowHitRate++
      continue
    }
    if (injuryRisk === "high") {
      flexDropCounts.injuryRiskHigh++
      continue
    }
    if (hitRate < 0.38) {
      flexDropCounts.hitRateTooLow++
      continue
    }
    if (avgMin > 0 && avgMin < 10) {
      flexDropCounts.avgMinTooLow++
      continue
    }
    if (edge < -4) {
      flexDropCounts.edgeTooLow++
      continue
    }
  }

  const flexDropped = deduped.filter((row) => !isFlexEligibleRow(row))
  const top15DroppedFlex = flexDropped
    .sort((a, b) => getFlexPropScore(b) - getFlexPropScore(a))
    .slice(0, 15)
    .map((row) => ({
      player: row?.player,
      team: row?.team,
      book: row?.book,
      propType: row?.propType,
      side: row?.side,
      line: row?.line,
      propVariant: row?.propVariant || "base",
      hitRate: parseHitRateInline(row?.hitRate),
      edge: Number(row?.edge || 0),
      score: Number(row?.score || 0),
      dropReason: "failedFlexEligibility"
    }))

  const afterByProp = {}
  const afterByBook = {}
  for (const row of filtered) {
    const propType = String(row?.propType || "unknown")
    const book = String(row?.book || "unknown")
    afterByProp[propType] = (afterByProp[propType] || 0) + 1
    afterByBook[book] = (afterByBook[book] || 0) + 1
  }

  const cap = getFlexTargetSize(filtered.length)
  const ranked = filtered
    .map((row) => ({ ...row, __flexScore: getFlexPropScore(row) }))
    .sort((a, b) => {
      if (b.__flexScore !== a.__flexScore) return b.__flexScore - a.__flexScore
      return parseHitRateInline(b.hitRate) - parseHitRateInline(a.hitRate)
    })
    .slice(0, cap)
    .map(({ __flexScore, ...row }) => row)

  console.log("[FLEX-POOL-DEBUG]", {
    label,
    totalBeforeFilter: deduped.length,
    totalAfterFilter: filtered.length,
    flexDropCounts,
    finalCount: ranked.length,
    cap,
    byPropBefore: beforeByProp,
    byPropAfter: afterByProp,
    byBookBefore: beforeByBook,
    byBookAfter: afterByBook
  })

  console.log("[FINAL-FLEX-THINNING-DEBUG]", {
    label,
    sourceCount: source.length,
    afterDedupe: deduped.length,
    afterSafetyFilter: filtered.length,
    afterCap: ranked.length,
    cap,
    finalByBook: {
      FanDuel: ranked.filter((row) => String(row?.book || "") === "FanDuel").length,
      DraftKings: ranked.filter((row) => String(row?.book || "") === "DraftKings").length
    },
    finalByPropVariant: ranked.reduce((acc, row) => {
      const v = String(row?.propVariant || "base")
      acc[v] = (acc[v] || 0) + 1
      return acc
    }, {}),
    top15Dropped: top15DroppedFlex
  })

  return ranked
}

function probabilityToAmerican(probability) {
  const prob = Number(probability)
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob))
  return Math.round((100 * (1 - prob)) / prob)
}

function normalizeBestPropVariant(row, propVariant = "base") {
  if (!row) return null
  return {
    ...row,
    isAlt: propVariant !== "base",
    propVariant
  }
}

// Returns an array of { propVariant, lineOffset } ladder steps for a given propType.
// lineOffset is added to baseLine; positive = harder for Over bettors.
function getAltLadderSteps(propType) {
  const key = String(propType || "")
  if (key === "Points") {
    return [
      { propVariant: "alt-low",  lineOffset: -5   },
      { propVariant: "alt-mid",  lineOffset: -2.5 },
      // base is handled separately
      { propVariant: "alt-high", lineOffset:  3   },
      { propVariant: "alt-max",  lineOffset:  6   }
    ]
  }
  if (key === "Threes") {
    return [
      { propVariant: "alt-low",  lineOffset: -1 },
      // base is handled separately
      { propVariant: "alt-high", lineOffset:  1 },
      { propVariant: "alt-max",  lineOffset:  2 }
    ]
  }
  if (key === "PRA") {
    return [
      { propVariant: "alt-low",  lineOffset: -5 },
      // base is handled separately
      { propVariant: "alt-high", lineOffset:  5 }
    ]
  }
  return []
}

// Per-unit adjustments for each prop type when the line shifts by 1 unit.
// These are applied proportionally to |lineOffset|.
function getAltLadderRates(propType) {
  const key = String(propType || "")
  if (key === "Points") {
    return { hitRatePerUnit: 0.012, edgePerUnit: 0.06, probPerUnit: 0.018, scorePerUnit: 0.9 }
  }
  if (key === "Threes") {
    return { hitRatePerUnit: 0.08,  edgePerUnit: 0.22, probPerUnit: 0.11,  scorePerUnit: 4.5 }
  }
  if (key === "PRA") {
    return { hitRatePerUnit: 0.010, edgePerUnit: 0.05, probPerUnit: 0.015, scorePerUnit: 0.8 }
  }
  // fallback — no variants will be added for other prop types, but keep safe defaults
  return { hitRatePerUnit: 0.01, edgePerUnit: 0.05, probPerUnit: 0.015, scorePerUnit: 0.8 }
}

function buildBestPropVariantPool(rows = []) {
  const baseRows = dedupeByLegSignature(
    (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map((row) => normalizeBestPropVariant(row, String(row?.propVariant || "base")))
      .filter(Boolean)
  )

  const altRows = []

  for (const row of baseRows) {
    const steps = getAltLadderSteps(row?.propType)
    if (!steps.length) continue

    const baseLine = Number(row?.line)
    const baseOdds = Number(row?.odds)
    if (!Number.isFinite(baseLine)) continue

    const rates = getAltLadderRates(row?.propType)
    const baseHitRate = parseHitRate(row?.hitRate)
    const baseEdge = Number(row?.edge || 0)
    const baseScore = Number(row?.score || 0)
    const marketProb = impliedProbabilityFromAmerican(baseOdds)
    const side = String(row?.side || "Over")

    // Track unique lines we've already emitted (including base) to avoid duplicates
    const seenLines = new Set([Number(baseLine.toFixed(1))])

    for (const step of steps) {
      const altLine = Number((baseLine + step.lineOffset).toFixed(1))

      // Skip if line would be negative/zero for Threes, or is a duplicate
      if (String(row?.propType || "") === "Threes" && altLine < 0.5) continue
      if (seenLines.has(altLine)) continue
      seenLines.add(altLine)

      // A positive lineOffset is harder for Over, easier for Under
      const harderForSide = side === "Under" ? step.lineOffset < 0 : step.lineOffset > 0
      const magnitude = Math.abs(step.lineOffset)

      // hitRate decreases as line gets harder, increases as it gets easier
      const adjustedHitRate = clamp(
        Number((baseHitRate + (harderForSide ? -1 : 1) * rates.hitRatePerUnit * magnitude).toFixed(3)),
        0.05,
        0.95
      )

      // Edge slightly increases for harder variants (alt-high/alt-max => +money => more EV if it hits)
      // and decreases for easier variants
      const edgeSign = harderForSide ? 0.6 : -0.4  // alt-high gets a small edge bonus
      const adjustedEdge = Number(
        (baseEdge + edgeSign * rates.edgePerUnit * magnitude).toFixed(2)
      )

      // Odds: harder line => higher implied prob needed => more + money
      const probShift = (harderForSide ? 1 : -1) * rates.probPerUnit * magnitude
      const adjustedMarketProb = marketProb !== null
        ? clamp(marketProb - probShift, 0.05, 0.92)  // harder → lower prob → more +money
        : null
      const rawAdjustedOdds = adjustedMarketProb !== null
        ? probabilityToAmerican(adjustedMarketProb)
        : baseOdds + (harderForSide ? 45 : -45) * magnitude
      const adjustedOdds = Number.isFinite(rawAdjustedOdds) ? rawAdjustedOdds : baseOdds

      // Score: alt-high/alt-max harder variants drag score down slightly; easy variants lift it
      const adjustedScore = Number(
        (baseScore + (harderForSide ? -1 : 1) * rates.scorePerUnit * magnitude).toFixed(2)
      )

      altRows.push({
        ...row,
        line: altLine,
        odds: adjustedOdds,
        hitRate: adjustedHitRate,
        edge: adjustedEdge,
        score: adjustedScore,
        isAlt: true,
        propVariant: step.propVariant,
        altFromLine: baseLine
      })
    }
  }

  const combined = dedupeSlipLegs([...baseRows, ...altRows])

  console.log("[ALT-PROP-POOL-DEBUG]", {
    baseRows: baseRows.length,
    altRows: altRows.length,
    combined: combined.length,
    byVariant: combined.reduce((acc, row) => {
      const key = String(row?.propVariant || "base")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  })

  return combined
}

function buildMixedBestAvailableBuckets(rows = [], options = {}) {
  const sourceRows = dedupeSlipLegs((Array.isArray(rows) ? rows : []).filter(Boolean))
  if (!sourceRows.length) {
    return {
      safe: null,
      balanced: null,
      aggressive: null,
      lotto: null
    }
  }

  const thinSlateMode = Boolean(options.thinSlateMode) || sourceRows.length < 130

  const bucketConfigs = {
    safe: {
      tag: "safe",
      minReturn: 40,
      maxReturnExclusive: 80,
      idealReturn: 58,
      legCounts: [3, 4],
      minHitRate: 0.56,
      attempts: 18,
      maxAltHigh: 1,
      minAltHigh: 0
    },
    balanced: {
      tag: "balanced",
      minReturn: 80,
      maxReturnExclusive: 180,
      idealReturn: 120,
      legCounts: [4, 5],
      minHitRate: 0.52,
      attempts: 20,
      maxAltHigh: 2,
      minAltHigh: 0
    },
    aggressive: {
      tag: "aggressive",
      minReturn: 180,
      maxReturnExclusive: 400,
      idealReturn: 260,
      legCounts: [5, 6],
      minHitRate: 0.48,
      attempts: 24,
      maxAltHigh: 3,
      minAltHigh: 1
    },
    lotto: {
      tag: "lotto",
      minReturn: 400,
      maxReturnExclusive: Infinity,
      idealReturn: 550,
      legCounts: [6, 7, 8],
      minHitRate: 0.44,
      attempts: 28,
      maxAltHigh: 4,
      minAltHigh: 1
    }
  }

  const rotateRows = (list, offset = 0) => {
    if (!Array.isArray(list) || list.length <= 1) return Array.isArray(list) ? [...list] : []
    const safeOffset = Math.max(0, offset) % list.length
    return [...list.slice(safeOffset), ...list.slice(0, safeOffset)]
  }

  const toLegKey = (row) => `${row.player}|${row.propType}|${row.side}|${Number(row.line)}|${row.book}`
  const getTeamKey = (row) => String(row?.team || row?.playerTeam || row?.book || "unknown")
  const isHighOddsLeg = (row) => Number(row?.odds || 0) > (thinSlateMode ? 99 : 120)
  const isSafeOddsLeg = (row) => {
    const odds = Number(row?.odds || 0)
    if (!Number.isFinite(odds) || odds >= 0) return false
    return thinSlateMode
      ? (odds <= -102 && odds >= -280)
      : (odds <= -150 && odds >= -300)
  }

  const hasPlusMinusSpreadLegMix = (legs) => {
    const safeLegs = Array.isArray(legs) ? legs : []
    const hasPlus = safeLegs.some((leg) => Number(leg?.odds || 0) >= (thinSlateMode ? 98 : 121))
    const hasFavorite = safeLegs.some((leg) => {
      const o = Number(leg?.odds || 0)
      return Number.isFinite(o) && o < 0 && o <= (thinSlateMode ? -102 : -150) && o >= -300
    })
    return hasPlus && hasFavorite
  }

  const selectionScore = (row, cfg) => {
    const hitRate = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge || 0)
    const odds = Number(row?.odds || 0)
    const score = Number(row?.score || 0)
    const variant = String(row?.propVariant || "base")
    const variantBonus =
      cfg.tag === "safe"
        ? (variant === "alt-low" ? 0.12 : variant === "alt-high" ? -0.08 : 0.05)
        : cfg.tag === "balanced"
          ? (variant === "base" ? 0.08 : variant === "alt-high" ? 0.05 : 0.04)
          : cfg.tag === "aggressive"
            ? (variant === "alt-high" ? 0.14 : variant === "base" ? 0.05 : 0)
            : (variant === "alt-high" ? 0.2 : variant === "base" ? 0.04 : -0.02)
    const oddsBonus =
      cfg.tag === "safe"
        ? (isSafeOddsLeg(row) ? 0.16 : odds > 120 ? -0.1 : 0.04)
        : cfg.tag === "balanced"
          ? (odds > 120 ? 0.08 : isSafeOddsLeg(row) ? 0.1 : 0.04)
          : (odds > 120 ? 0.16 : isSafeOddsLeg(row) ? 0.06 : 0.02)

    return hitRate * 0.42 + edge * 0.09 + score / 180 + oddsBonus + variantBonus
  }

  const makeCandidate = (book, tag, legs) => {
    const normalizedLegs = dedupeSlipLegs(Array.isArray(legs) ? legs : []).filter(Boolean)
    if (normalizedLegs.length < 2) return null

    const price = parlayPriceFromLegs(normalizedLegs)
    if (!price) return null

    const projectedReturn = estimateReturn(5, price.american)
    if (!Number.isFinite(projectedReturn)) return null

    return {
      book,
      tag,
      legs: normalizedLegs,
      price,
      projectedReturn,
      confidence: confidenceFromLegs(normalizedLegs),
      trueProbability: trueParlayProbabilityFromLegs(normalizedLegs)
    }
  }

  const buildOddsBalanceScore = (candidate, cfg) => {
    const projectedReturn = Number(candidate?.projectedReturn || 0)
    const target = Number(cfg?.idealReturn || cfg?.minReturn || 0)
    const closeness = target > 0
      ? Math.max(0, 1 - Math.abs(projectedReturn - target) / Math.max(target, 1))
      : 0
    const legs = Array.isArray(candidate?.legs) ? candidate.legs : []
    const plusMoneyCount = legs.filter((row) => Number(row?.odds || 0) > 0).length
    const distinctPropTypes = new Set(legs.map((row) => String(row?.propType || ""))).size
    const mixBonus = Math.min(1, distinctPropTypes / Math.max(2, Math.min(4, legs.length)))
    const distributionBonus = plusMoneyCount >= 1 && plusMoneyCount < legs.length ? 1 : 0.55
    const requirementBonus = legs.some(isHighOddsLeg) && legs.some(isSafeOddsLeg) ? 1 : 0
    return Number((closeness * 0.45 + mixBonus * 0.2 + distributionBonus * 0.15 + requirementBonus * 0.2).toFixed(4))
  }

  const scoreCandidate = (candidate, cfg) => {
    const legs = Array.isArray(candidate?.legs) ? candidate.legs : []
    const avgEdge = avg(legs.map((row) => Number(row?.edge || 0))) || 0
    const avgHitRate = avg(legs.map((row) => parseHitRate(row?.hitRate))) || 0
    const normalizedEdge = clamp((avgEdge + 1.5) / 4.5, 0, 1)
    const oddsBalance = buildOddsBalanceScore(candidate, cfg)
    const slipScore = Number((normalizedEdge * 0.4 + avgHitRate * 0.3 + oddsBalance * 0.3).toFixed(4))
    return {
      ...candidate,
      avgEdge: Number(avgEdge.toFixed(3)),
      avgHitRate: Number(avgHitRate.toFixed(3)),
      oddsBalance,
      slipScore
    }
  }

  const canAddLeg = (selected, candidate, cfg) => {
    if (!candidate) return false
    if (shouldRemoveLegForPlayerStatus(candidate) || hasConflict(selected, candidate)) return false
    if (parseHitRate(candidate?.hitRate) < cfg.minHitRate) return false

    const player = String(candidate?.player || "")
    if (selected.some((leg) => String(leg?.player || "") === player)) return false

    const teamKey = getTeamKey(candidate)
    const teamCount = selected.filter((leg) => getTeamKey(leg) === teamKey).length
    if (teamCount >= 2) return false

    const propType = String(candidate?.propType || "")
    const propCount = selected.filter((leg) => String(leg?.propType || "") === propType).length
    if (propCount >= 2) return false

    const altHighCount = selected.filter((leg) => String(leg?.propVariant || "") === "alt-high").length
    if (String(candidate?.propVariant || "") === "alt-high" && altHighCount >= cfg.maxAltHigh) return false

    if (hasSameGameStatSide(selected, candidate)) return false

    return true
  }

  const finalizeBucketCandidate = (candidate, cfg) => {
    if (!candidate) return null
    const projectedReturn = Number(candidate.projectedReturn || 0)
    const minReturnFloor = thinSlateMode && cfg.tag === "safe" ? Math.min(cfg.minReturn, 26) : cfg.minReturn
    const maxReturnCap = thinSlateMode && cfg.tag === "safe" && Number.isFinite(cfg.maxReturnExclusive)
      ? Math.max(cfg.maxReturnExclusive, 96)
      : cfg.maxReturnExclusive
    if (projectedReturn < minReturnFloor) return null
    if (Number.isFinite(maxReturnCap) && projectedReturn >= maxReturnCap) return null
    const legs = Array.isArray(candidate.legs) ? candidate.legs : []
    if (thinSlateMode) {
      if (!hasPlusMinusSpreadLegMix(legs)) return null
    } else {
      if (!legs.some(isHighOddsLeg)) return null
      if (!legs.some(isSafeOddsLeg)) return null
    }
    const altHighCount = legs.filter((leg) => String(leg?.propVariant || "") === "alt-high").length
    if (altHighCount < cfg.minAltHigh) return null
    return scoreCandidate(candidate, cfg)
  }

  const buildBookBucketCandidates = (book, cfg) => {
    const bookRows = sourceRows
      .filter((row) => String(row?.book || "") === book)
      .filter((row) => !shouldRemoveLegForPlayerStatus(row))

    if (!bookRows.length) return []

    const rankedRows = [...bookRows].sort((a, b) => selectionScore(b, cfg) - selectionScore(a, cfg))
    const highOddsRows = rankedRows.filter((row) => isHighOddsLeg(row))
    const safeOddsRows = rankedRows.filter((row) => isSafeOddsLeg(row))
    const candidates = []

    for (const legCount of cfg.legCounts) {
      for (let attempt = 0; attempt < cfg.attempts; attempt += 1) {
        const selected = []
        const usedKeys = new Set()
        const rotatedHighOdds = rotateRows(highOddsRows, attempt)
        const rotatedSafeOdds = rotateRows(safeOddsRows, attempt * 2 + 1)
        const rotatedAll = rotateRows(rankedRows, attempt * 3 + 2)

        for (const row of rotatedHighOdds) {
          const key = toLegKey(row)
          if (usedKeys.has(key)) continue
          if (!canAddLeg(selected, row, cfg)) continue
          selected.push(row)
          usedKeys.add(key)
          break
        }

        for (const row of rotatedSafeOdds) {
          const key = toLegKey(row)
          if (usedKeys.has(key)) continue
          if (!canAddLeg(selected, row, cfg)) continue
          selected.push(row)
          usedKeys.add(key)
          break
        }

        for (const row of rotatedAll) {
          if (selected.length >= legCount) break
          const key = toLegKey(row)
          if (usedKeys.has(key)) continue
          if (!canAddLeg(selected, row, cfg)) continue

          const propType = String(row?.propType || "")
          const propCount = selected.filter((leg) => String(leg?.propType || "") === propType).length
          const distinctPropTypes = new Set(selected.map((leg) => String(leg?.propType || ""))).size
          if (propCount >= 1 && distinctPropTypes < Math.min(3, legCount - 1)) {
            const unusedTypeExists = rotatedAll.some((candidate) => {
              const candidateKey = toLegKey(candidate)
              return !usedKeys.has(candidateKey) && String(candidate?.propType || "") !== propType && canAddLeg(selected, candidate, cfg)
            })
            if (unusedTypeExists) continue
          }

          selected.push(row)
          usedKeys.add(key)
        }

        if (selected.length !== legCount) continue

        const candidate = finalizeBucketCandidate(makeCandidate(book, cfg.tag, selected), cfg)
        if (!candidate) continue
        candidates.push(candidate)
      }
    }

    const deduped = new Map()
    for (const candidate of candidates) {
      const signature = candidate.legs.map(toLegKey).sort().join("||")
      const existing = deduped.get(signature)
      if (!existing || candidate.slipScore > existing.slipScore) {
        deduped.set(signature, candidate)
      }
    }

    return [...deduped.values()].sort((a, b) => {
      if (b.slipScore !== a.slipScore) return b.slipScore - a.slipScore
      if (b.trueProbability !== a.trueProbability) return b.trueProbability - a.trueProbability
      return a.projectedReturn - b.projectedReturn
    })
  }

  const output = {
    safe: null,
    balanced: null,
    aggressive: null,
    lotto: null
  }

  for (const [bucketKey, cfg] of Object.entries(bucketConfigs)) {
    const candidates = [
      ...buildBookBucketCandidates("FanDuel", cfg),
      ...buildBookBucketCandidates("DraftKings", cfg)
    ].sort((a, b) => {
      if (b.slipScore !== a.slipScore) return b.slipScore - a.slipScore
      if (b.trueProbability !== a.trueProbability) return b.trueProbability - a.trueProbability
      return a.projectedReturn - b.projectedReturn
    })

    const bestCandidate = candidates[0] || null
    output[bucketKey] = bestCandidate
      ? {
          book: bestCandidate.book,
          tag: cfg.tag,
          legs: bestCandidate.legs,
          projectedReturn: Number(bestCandidate.projectedReturn.toFixed(2)),
          confidence: bestCandidate.confidence,
          slipScore: bestCandidate.slipScore,
          oddsAmerican: bestCandidate.price.american,
          oddsDecimal: Number(bestCandidate.price.decimal.toFixed(3))
        }
      : null
  }

  console.log("[MIXED-BEST-AVAILABLE-DEBUG]", {
    sourceRows: sourceRows.length,
    buckets: Object.fromEntries(
      Object.entries(output).map(([key, value]) => [
        key,
        value
          ? {
              book: value.book,
              projectedReturn: value.projectedReturn,
              confidence: value.confidence,
              legs: value.legs.length
            }
          : null
      ])
    )
  })

  return output
}

function buildLiveDualBestAvailablePayload() {
  console.log("[PAYLOAD-DEBUG] ENTER buildLiveDualBestAvailablePayload")
  // CORE_ONLY_REFRESH_MODE was introduced as a temporary stability switch, but
  // /api/best-available is now a contract used by the frontend for portfolios
  // and slips. Default to FULL payload generation; allow opting back into core-
  // NOTE: The core-only shortcut is now disabled because it breaks downstream
  // consumers expecting slip/portfolio fields. If an emergency mode is needed
  // again, reintroduce it behind an explicit route/query toggle so the API
  // contract can't silently degrade due to environment drift.
  const CORE_ONLY_REFRESH_MODE = false
  const combinedPrimaryRows = [
    ...(oddsSnapshot.eliteProps || []),
    ...(oddsSnapshot.strongProps || []),
    ...(oddsSnapshot.playableProps || []),
    ...(oddsSnapshot.bestProps || [])
  ]
  console.log("[PAYLOAD-DEBUG] combinedPrimaryRows.length:", combinedPrimaryRows.length)

  const combinedRows = getAvailablePrimarySlateRows(combinedPrimaryRows)
  console.log("[PAYLOAD-DEBUG] combinedRows.length:", combinedRows.length)
  logPayloadDebugExclusions("combinedPrimaryRows→combinedRows", combinedPrimaryRows, combinedRows)

  const elite = getAvailablePrimarySlateRows(oddsSnapshot.eliteProps || [])
  console.log("[PAYLOAD-DEBUG] elite.length:", elite.length, "from eliteProps:", (oddsSnapshot.eliteProps || []).length)

  const strong = getAvailablePrimarySlateRows(oddsSnapshot.strongProps || [])
  console.log("[PAYLOAD-DEBUG] strong.length:", strong.length, "from strongProps:", (oddsSnapshot.strongProps || []).length)

  const playable = getAvailablePrimarySlateRows(oddsSnapshot.playableProps || [])
  console.log("[PAYLOAD-DEBUG] playable.length:", playable.length, "from playableProps:", (oddsSnapshot.playableProps || []).length)

  const flex = getAvailablePrimarySlateRows(oddsSnapshot.flexProps || [])
  console.log("[PAYLOAD-DEBUG] flex.length:", flex.length, "from flexProps:", (oddsSnapshot.flexProps || []).length)

  const expandedEligibleRows = getDualExpandedEligibleRows()

  console.log("[PAYLOAD-DEBUG] oddsSnapshot.bestProps.length:", (oddsSnapshot.bestProps || []).length)
  const snapshotBest = getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).map((row) => normalizeBestPropVariant(row, "base"))
  const usingFallback = snapshotBest.length === 0
  const fallbackBest = usingFallback ? buildBestPropsFallbackRows(expandedEligibleRows, Math.min(60, expandedEligibleRows.length || 60)) : []
  const best = usingFallback ? fallbackBest : snapshotBest

  console.log("[PAYLOAD-DEBUG] best.length:", best.length)
  logPayloadDebugExclusions("bestProps→best", oddsSnapshot.bestProps || [], snapshotBest)
  console.log("[BEST-PROPS-FALLBACK-DEBUG]", {
    snapshotBest: snapshotBest.length,
    fallbackBest: fallbackBest.length,
    usingFallback
  })
  console.log("[BEST-PROPS-VISIBLE-COUNTS]", {
    sourceAssigned: (oddsSnapshot.bestProps || []).length,
    visibleTotal: best.length,
    byBook: {
      FanDuel: best.filter((row) => row.book === "FanDuel").length,
      DraftKings: best.filter((row) => row.book === "DraftKings").length
    }
  })

  const availableCounts = {
    elite: {
      total: elite.length,
      fanduel: elite.filter((row) => row.book === "FanDuel").length,
      draftkings: elite.filter((row) => row.book === "DraftKings").length
    },
    strong: {
      total: strong.length,
      fanduel: strong.filter((row) => row.book === "FanDuel").length,
      draftkings: strong.filter((row) => row.book === "DraftKings").length
    },
    playable: {
      total: playable.length,
      fanduel: playable.filter((row) => row.book === "FanDuel").length,
      draftkings: playable.filter((row) => row.book === "DraftKings").length
    },
    flex: {
      total: flex.length,
      fanduel: flex.filter((row) => row.book === "FanDuel").length,
      draftkings: flex.filter((row) => row.book === "DraftKings").length
    },
    best: {
      total: best.length,
      fanduel: best.filter((row) => row.book === "FanDuel").length,
      draftkings: best.filter((row) => row.book === "DraftKings").length
    }
  }

  if (CORE_ONLY_REFRESH_MODE) {
    console.log("[REFRESH-CORE-ONLY]", {
      raw: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
      bestRaw: snapshotBest.length,
      bestSnapshot: Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0,
      bestVisible: best.length
    })

    return {
      availableCounts,
      best,
      safe: oddsSnapshot?.safe || null,
      balanced: oddsSnapshot?.balanced || null,
      aggressive: oddsSnapshot?.aggressive || null,
      lotto: oddsSnapshot?.lotto || null,
      flexProps: [],
      highestHitRate2: { fanduel: null, draftkings: null },
      highestHitRate3: { fanduel: null, draftkings: null },
      highestHitRate4: { fanduel: null, draftkings: null },
      highestHitRate5: { fanduel: null, draftkings: null },
      highestHitRate6: { fanduel: null, draftkings: null },
      highestHitRate7: { fanduel: null, draftkings: null },
      highestHitRate8: { fanduel: null, draftkings: null },
      highestHitRate9: { fanduel: null, draftkings: null },
      highestHitRate10: { fanduel: null, draftkings: null },
      payoutFitPortfolio: {
        fanduel: null,
        draftkings: null
      },
      moneyMakerPortfolio: {
        fanduel: null,
        draftkings: null
      },
      statLeaderboards: null,
      poolDiagnostics: null,
      diagnostics: null
    }
  }

  const dualPoolDiagnostics = buildDualPoolDiagnostics(expandedEligibleRows)
  const statLeaderboards = buildDualStatLeaderboards(expandedEligibleRows)

  const rawPropsRowsForDebug = Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []
  const survivedFragileRowsForDebug = rawPropsRowsForDebug.filter((row) => {
    try {
      return !isFragileLeg(row)
    } catch (_) {
      return true
    }
  })

  runCurrentSlateCoverageDiagnostics({
    scheduledEvents: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : [],
    rawPropsRows: rawPropsRowsForDebug,
    enrichedModelRows: combinedPrimaryRows,
    survivedFragileRows: survivedFragileRowsForDebug,
    bestPropsRawRows: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps : [],
    finalBestVisibleRows: best
  })

  console.log("[DUAL-EXPANDED-POOL-DEBUG]", JSON.stringify(dualPoolDiagnostics, null, 2))

  console.log("[DUAL-DEBUG] availableCounts:", JSON.stringify(availableCounts, null, 2))

  // Build all highest-hit-rate slips once and reuse them for payout-fit portfolio
  // IMPORTANT: expandedEligibleRows can include large raw/low-signal pools that
  // are "eligible" for diagnostics but are not scored/ranked enough for slip
  // building (e.g. score≈0-10, hitRate≈0.05). Feeding those into slip builders
  // causes every tier to fail minScore/minHitRate gates and yields null slips.
  //
  // For slip generation, prefer the scored primary-slate pool (elite/strong/
  // playable/best), falling back to the visible `best` pool if needed.
  const scoredPrimaryPool = combinedRows.length ? combinedRows : combinedPrimaryRows
  const dualBestPropsPoolBase = scoredPrimaryPool.length ? scoredPrimaryPool : best
  const dualBestPropsPool = buildBestPropVariantPool(dualBestPropsPoolBase)
  const mixedThinSlate =
    dualBestPropsPool.length < 140 ||
    (Number(oddsSnapshot?.snapshotSlateGameCount || 0) > 0 && Number(oddsSnapshot.snapshotSlateGameCount) <= 4)
  const mixedBestAvailable = buildMixedBestAvailableBuckets(dualBestPropsPool, { thinSlateMode: mixedThinSlate })

  // ── Diagnostics (additive only, no side-effects on generation) ────────────
  const rawCoverage = buildRawCoverage()
  const stageCounts = buildStageCounts(expandedEligibleRows, dualBestPropsPoolBase)
  const exclusionSummary = buildExclusionSummary()
  const wideLeaderboards = buildWideLeaderboards()

  console.log("[RAW-COVERAGE-DEBUG]", JSON.stringify(rawCoverage))
  console.log("[STAGE-COUNTS-DEBUG]", JSON.stringify(stageCounts))
  console.log("[EXCLUSION-SUMMARY-DEBUG]", JSON.stringify(exclusionSummary))
  console.log("[WIDE-LEADERBOARDS-DEBUG] FD totalSlots:",
    Object.values(wideLeaderboards.FanDuel || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0),
    "DK totalSlots:",
    Object.values(wideLeaderboards.DraftKings || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
  )
  // ── End diagnostics ───────────────────────────────────────────────────────

  const fdHighestHitRate2 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 2, dualBestPropsPool), "Highest Hit Rate 2-Leg")
  const fdHighestHitRate3 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 3, dualBestPropsPool), "Highest Hit Rate 3-Leg")
  const fdHighestHitRate4 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 4, dualBestPropsPool), "Highest Hit Rate 4-Leg")
  const fdHighestHitRate5 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 5, dualBestPropsPool), "Highest Hit Rate 5-Leg")
  const fdHighestHitRate6 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 6, dualBestPropsPool), "Highest Hit Rate 6-Leg")
  const fdHighestHitRate7 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 7, dualBestPropsPool), "Highest Hit Rate 7-Leg")
  const fdHighestHitRate8 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 8, dualBestPropsPool), "Highest Hit Rate 8-Leg")
  const fdHighestHitRate9 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 9, dualBestPropsPool), "Highest Hit Rate 9-Leg")
  const fdHighestHitRate10 = makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 10, dualBestPropsPool), "Highest Hit Rate 10-Leg")

  const dkHighestHitRate2 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 2, dualBestPropsPool), "Highest Hit Rate 2-Leg")
  const dkHighestHitRate3 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 3, dualBestPropsPool), "Highest Hit Rate 3-Leg")
  const dkHighestHitRate4 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 4, dualBestPropsPool), "Highest Hit Rate 4-Leg")
  const dkHighestHitRate5 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 5, dualBestPropsPool), "Highest Hit Rate 5-Leg")
  const dkHighestHitRate6 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 6, dualBestPropsPool), "Highest Hit Rate 6-Leg")
  const dkHighestHitRate7 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 7, dualBestPropsPool), "Highest Hit Rate 7-Leg")
  const dkHighestHitRate8 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 8, dualBestPropsPool), "Highest Hit Rate 8-Leg")
  const dkHighestHitRate9 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 9, dualBestPropsPool), "Highest Hit Rate 9-Leg")
  const dkHighestHitRate10 = makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 10, dualBestPropsPool), "Highest Hit Rate 10-Leg")

  const fdSlipObjects = [
    fdHighestHitRate2,
    fdHighestHitRate3,
    fdHighestHitRate4,
    fdHighestHitRate5,
    fdHighestHitRate6,
    fdHighestHitRate7,
    fdHighestHitRate8,
    fdHighestHitRate9,
    fdHighestHitRate10
  ].filter(Boolean)

  const dkSlipObjects = [
    dkHighestHitRate2,
    dkHighestHitRate3,
    dkHighestHitRate4,
    dkHighestHitRate5,
    dkHighestHitRate6,
    dkHighestHitRate7,
    dkHighestHitRate8,
    dkHighestHitRate9,
    dkHighestHitRate10
  ].filter(Boolean)

  const moneyMakerSourceRows = Array.isArray(dualBestPropsPool) ? dualBestPropsPool : []
  const moneyMakerSourceRowsByBook = {
    FanDuel: moneyMakerSourceRows.filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: moneyMakerSourceRows.filter((row) => String(row?.book || "") === "DraftKings").length
  }
  const moneyMakerPostPlayerStatusRows = moneyMakerSourceRows.filter((row) => {
    try {
      return !shouldRemoveLegForPlayerStatus(row)
    } catch (_) {
      return true
    }
  })
  const moneyMakerPostFragileRows = moneyMakerPostPlayerStatusRows.filter((row) => {
    try {
      return !isFragileLeg(row)
    } catch (_) {
      return true
    }
  })
  const moneyMakerPostMatchupRows = moneyMakerPostFragileRows.filter((row) => {
    try {
      return playerFitsMatchup(row)
    } catch (_) {
      return true
    }
  })
  const moneyMakerFd = buildMoneyMakerPortfolio("FanDuel", dualBestPropsPool)
  const moneyMakerDk = buildMoneyMakerPortfolio("DraftKings", dualBestPropsPool)

  console.log("[MONEYMAKER-CALLSITE-DEBUG]", {
    sourceRows: moneyMakerSourceRows.length,
    sourceRowsByBook: moneyMakerSourceRowsByBook,
    postPlayerStatus: moneyMakerPostPlayerStatusRows.length,
    postFragile: moneyMakerPostFragileRows.length,
    postMatchup: moneyMakerPostMatchupRows.length,
    output: {
      fanduel: {
        hasOutput: Boolean(moneyMakerFd),
        optionCount: Array.isArray(moneyMakerFd?.options) ? moneyMakerFd.options.length : 0
      },
      draftkings: {
        hasOutput: Boolean(moneyMakerDk),
        optionCount: Array.isArray(moneyMakerDk?.options) ? moneyMakerDk.options.length : 0
      }
    }
  })

  // ONLY ML-weighted Highest Hit Rate tier (for winning with least chance to miss)
  return {
    availableCounts,
    best,
    safe: mixedBestAvailable.safe,
    balanced: mixedBestAvailable.balanced,
    aggressive: mixedBestAvailable.aggressive,
    lotto: mixedBestAvailable.lotto,
    flexProps: flex,
    highestHitRate2: {
      fanduel: fdHighestHitRate2,
      draftkings: dkHighestHitRate2
    },
    highestHitRate3: {
      fanduel: fdHighestHitRate3,
      draftkings: dkHighestHitRate3
    },
    highestHitRate4: {
      fanduel: fdHighestHitRate4,
      draftkings: dkHighestHitRate4
    },
    highestHitRate5: {
      fanduel: fdHighestHitRate5,
      draftkings: dkHighestHitRate5
    },
    highestHitRate6: {
      fanduel: fdHighestHitRate6,
      draftkings: dkHighestHitRate6
    },
    highestHitRate7: {
      fanduel: fdHighestHitRate7,
      draftkings: dkHighestHitRate7
    },
    highestHitRate8: {
      fanduel: fdHighestHitRate8,
      draftkings: dkHighestHitRate8
    },
    highestHitRate9: {
      fanduel: fdHighestHitRate9,
      draftkings: dkHighestHitRate9
    },
    highestHitRate10: {
      fanduel: fdHighestHitRate10,
      draftkings: dkHighestHitRate10
    },
    payoutFitPortfolio: {
      fanduel: buildPayoutFitPortfolio("FanDuel", fdSlipObjects, null, {
        dualMode: true,
        dualUsablePool: dualBestPropsPool
      }),
      draftkings: buildPayoutFitPortfolio("DraftKings", dkSlipObjects, null, {
        dualMode: true,
        dualUsablePool: dualBestPropsPool
      })
    },
    moneyMakerPortfolio: {
      fanduel: moneyMakerFd,
      draftkings: moneyMakerDk
    },
    statLeaderboards,
    poolDiagnostics: dualPoolDiagnostics,
    diagnostics: {
      rawCoverage,
      stageCounts,
      exclusionSummary,
      wideLeaderboards
    }
  }
}

function toCompactBestRow(row) {
  if (!row) return null
  return {
    book: row.book,
    team: row.team,
    player: row.player,
    propType: row.propType,
    side: row.side,
    line: row.line,
    odds: row.odds,
    hitRate: row.hitRate,
    edge: row.edge,
    score: row.score,
    matchup: row.matchup,
    gameTime: row.gameTime,
    minutesRisk: row.minutesRisk,
    trendRisk: row.trendRisk,
    injuryRisk: row.injuryRisk
  }
}

function buildCompactBestPayload() {
  const payload = buildLiveDualBestAvailablePayload()
  const bestRows = Array.isArray(payload?.best) ? payload.best : []
  const compactBest = bestRows.map(toCompactBestRow).filter(Boolean)

  return {
    snapshotMeta: buildSnapshotMeta(),
    availableCounts: payload?.availableCounts || null,
    bestCount: compactBest.length,
    bestByBook: {
      fanduel: compactBest.filter((row) => row.book === "FanDuel").length,
      draftkings: compactBest.filter((row) => row.book === "DraftKings").length
    },
    best: compactBest,
    highestHitRate5: payload?.highestHitRate5 || null,
    payoutFitPortfolio: payload?.payoutFitPortfolio || null,
    statLeaderboards: payload?.statLeaderboards || null,
    diagnostics: payload?.diagnostics || null
  }
}

function buildPayoutFitPortfolio(book, slipObjects = null, sourceRowsOverride = null, options = {}) {
  const bands = {
    smallHitters: { label: "Small Hitters", description: "Safe, lower-risk plays with smaller returns" },
    midUpside: { label: "Mid Upside", description: "Balanced risk-reward with moderate upside" },
    bigUpside: { label: "Big Upside", description: "Stronger upside plays with increased risk" },
    lotto: { label: "Lotto Jackpot", description: "Highest-risk longshot plays with extreme payouts" }
  }

  const bandRules = {
    smallHitters: {
      minReturn: 10,
      maxReturnExclusive: 25,
      minLegs: 2,
      maxLegs: 2,
      preferredLegCounts: [2],
      idealReturn: 17
    },
    midUpside: {
      minReturn: 25,
      maxReturnExclusive: 60,
      minLegs: 3,
      maxLegs: 3,
      preferredLegCounts: [3],
      idealReturn: 38
    },
    bigUpside: {
      minReturn: 55,
      maxReturnExclusive: 100,
      minLegs: 4,
      maxLegs: 5,
      preferredLegCounts: [4, 5],
      idealReturn: 85
    },
    lotto: {
      minReturn: 100,
      maxReturnExclusive: Infinity,
      minLegs: 5,
      maxLegs: 6,
      preferredLegCounts: [5, 6],
      idealReturn: 160
    }
  }

  const bandOrder = ["smallHitters", "midUpside", "bigUpside", "lotto"]
  const desiredOptionsByBand = {
    smallHitters: 2,
    midUpside: 3,
    bigUpside: 3,
    lotto: book === "FanDuel" ? 2 : 3
  }
  const dualMode = Boolean(options?.dualMode)
  const dualUsablePool = Array.isArray(options?.dualUsablePool) ? options.dualUsablePool : null

  const getBookRows = () => {
    const primary = Array.isArray(sourceRowsOverride)
      ? sourceRowsOverride
      : (Array.isArray(dualUsablePool) && dualUsablePool.length
          ? dualUsablePool
          : [
              ...(oddsSnapshot.eliteProps || []),
              ...(oddsSnapshot.strongProps || []),
              ...(oddsSnapshot.playableProps || []),
              ...(oddsSnapshot.bestProps || [])
            ])

    return dedupeByLegSignature(
      primary
        .filter((row) => row.book === book)
        .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    )
  }

  const confidenceWeight = (confidence) => {
    const key = String(confidence || "").toLowerCase()
    if (key === "high") return 1
    if (key === "medium") return 0.65
    if (key === "low") return 0.35
    return 0.5
  }

  const toLegKey = (leg) => `${leg.playerName || leg.player}|${leg.statType || leg.propType}|${leg.side || ""}|${leg.line}`

  const isReasonablePlusMoneyLeg = (odds) => {
    if (!Number.isFinite(odds)) return false
    if (odds > 0) return odds <= 170
    return odds >= -150
  }

  const isHighRiskFlag = (row) => {
    const minutesRisk = String(row.minutesRisk || "").toLowerCase()
    const injuryRisk = String(row.injuryRisk || "").toLowerCase()
    const trendRisk = String(row.trendRisk || "").toLowerCase()
    return minutesRisk === "high" || injuryRisk === "high" || trendRisk === "high"
  }

  const isSafeLeg = (row, relaxed = false) => {
    if (!row || shouldRemoveLegForPlayerStatus(row) || isFragileLeg(row)) return false
    if (isHighRiskFlag(row)) return false

    const hitRate = parseHitRate(row.hitRate)
    const avgMin = Number(row.avgMin || 0)
    const minFloor = Number(row.minFloor || 0)
    const minHit = relaxed ? 0.5 : 0.52

    if (hitRate < minHit) return false
    if (!relaxed && avgMin > 0 && avgMin < 18) return false
    if (!relaxed && minFloor > 0 && minFloor < 12) return false
    return true
  }

  const isValueLeg = (row, relaxed = false) => {
    if (!row || shouldRemoveLegForPlayerStatus(row) || isFragileLeg(row)) return false
    if (isHighRiskFlag(row)) return false

    const hitRate = parseHitRate(row.hitRate)
    const edge = Number(row.edge || row.projectedValue || 0)
    const score = Number(row.score || 0)
    const minHit = relaxed ? 0.5 : 0.52

    if (hitRate < minHit) return false
    if (edge < (relaxed ? -1.25 : -1)) return false
    if (score < (relaxed ? -5 : 5)) return false
    return true
  }

  const isPayoutBoosterLeg = (row) => {
    if (!row) return false
    if (shouldRemoveLegForPlayerStatus(row)) return false
    if (isFragileLeg(row)) return false

    const propType = String(row.propType || "")
    if (!["Threes", "Points", "PRA"].includes(propType)) return false

    const hitRate = parseHitRate(row.hitRate)
    if (hitRate < 0.5) return false

    const minutesRisk = String(row.minutesRisk || "").toLowerCase()
    const injuryRisk = String(row.injuryRisk || "").toLowerCase()
    const trendRisk = String(row.trendRisk || "").toLowerCase()
    if (minutesRisk === "high") return false
    if (injuryRisk === "high") return false
    if (trendRisk === "high") return false

    const avgMin = Number(row.avgMin || 0)
    if (avgMin > 0 && avgMin < 18) return false

    const odds = Number(row.odds || 0)
    if (!isReasonablePlusMoneyLeg(odds)) return false

    return true
  }

  const isPayoutBoosterLegRelaxed = (row) => {
    if (!row) return false
    if (shouldRemoveLegForPlayerStatus(row)) return false
    if (isFragileLeg(row)) return false
    if (isHighRiskFlag(row)) return false

    const propType = String(row.propType || "")
    if (!["Threes", "Points", "PRA"].includes(propType)) return false
    if (parseHitRate(row.hitRate) < 0.5) return false
    return isReasonablePlusMoneyLeg(Number(row.odds || 0))
  }

  const payoutBoosterLegScore = (row) => {
    const propType = String(row.propType || "")
    const propPriority =
      propType === "Threes" ? 0.22 :
      propType === "Points" ? 0.14 :
      propType === "PRA" ? 0.08 : 0

    const hitRate = parseHitRate(row.hitRate)
    const edge = Number(row.edge || row.projectedValue || 0)
    const score = Number(row.score || 0)
    const odds = Number(row.odds || 0)
    const plusMoneyBonus =
      odds > 0 && odds <= 180 ? 0.1 :
      odds > 180 ? 0.04 :
      odds >= -145 ? 0.07 : 0.02

    return hitRate * 0.5 + (edge / 12) * 0.2 + (score / 130) * 0.15 + plusMoneyBonus + propPriority
  }

  const fitScoreForBand = (candidate, bandKey) => {
    const rule = bandRules[bandKey]
    const returnFit = 1 - Math.min(1, Math.abs(candidate.returnMultiple - rule.idealReturn) / Math.max(2, rule.idealReturn))
    const legDistance = Math.min(...rule.preferredLegCounts.map((n) => Math.abs(candidate.legCount - n)))
    const legFit = Math.max(0, 1 - legDistance / 3)
    const probFit = Math.max(0, Math.min(1, candidate.trueProbability))
    const confidenceFit = confidenceWeight(candidate.confidence)

    return (
      returnFit * 0.42 +
      legFit * 0.28 +
      probFit * 0.2 +
      confidenceFit * 0.1
    )
  }

  const legSelectionScore = (row, boostThrees = false) => {
    const hitRate = parseHitRate(row.hitRate)
    const edge = Number(row.edge || row.projectedValue || 0)
    const score = Number(row.score || 0)
    const odds = Number(row.odds || 0)
    const threesBonus = boostThrees && String(row.propType || "") === "Threes" ? 0.12 : 0
    const oddsBonus = odds > 0 && odds <= 200 ? 0.07 : (odds >= -160 && odds <= 120 ? 0.05 : 0)
    return hitRate * 0.6 + (edge / 12) * 0.22 + (score / 130) * 0.15 + oddsBonus + threesBonus
  }

  const makeCandidate = (label, legs, bandKey) => {
    const normalizedLegs = Array.isArray(legs) ? dedupeSlipLegs(legs).filter(Boolean) : []
    if (normalizedLegs.length < 2) return null

    const price = parlayPriceFromLegs(normalizedLegs)
    if (!price) return null

    const projectedReturn = estimateReturn(5, price.american)
    if (!projectedReturn) return null

    const trueProbability = trueParlayProbabilityFromLegs(normalizedLegs)
    const confidence = confidenceFromLegs(normalizedLegs)
    const materialSignature = normalizedLegs.map(toLegKey).sort().join("||")
    const topTwoCore = [...normalizedLegs]
      .sort((a, b) => parseHitRate(b.hitRate) - parseHitRate(a.hitRate))
      .slice(0, 2)
      .map(toLegKey)
      .sort()
      .join("||")

    const candidate = {
      sourceLabel: label,
      legs: normalizedLegs,
      stake: 5,
      price,
      projectedReturn,
      returnMultiple: projectedReturn,
      trueProbability,
      confidence,
      legCount: normalizedLegs.length,
      materialSignature,
      twoLegCoreSignature: topTwoCore,
      assignmentScore: 0
    }

    candidate.assignmentScore = fitScoreForBand(candidate, bandKey)
    return candidate
  }

  const portfolioDebug = {
    rejectionCounts: {
      smallHitters: {},
      midUpside: {},
      bigUpside: {},
      lotto: {}
    }
  }

  const noteBandRejection = (bandKey, reason) => {
    const bucket = portfolioDebug.rejectionCounts[bandKey]
    bucket[reason] = (bucket[reason] || 0) + 1
  }

  const fitsLottoByBook = (candidate) => {
    if (!candidate) return false
    const legCount = candidate.legCount
    const returnMultiple = candidate.returnMultiple

    if (legCount !== 5 && legCount !== 6) {
      if (book === "FanDuel") {
        console.log("[FD-LOTTO-QUALIFY-DEBUG]", {
          legCount,
          returnMultiple,
          accepted: false,
          rejectReason: "leg-count"
        })
      }
      return false
    }

    if (book === "FanDuel") {
      // 75x / 105x are reachable with mixed-odds 5/6-leg FD slips
      return (candidate.legCount === 5 && candidate.returnMultiple >= 90) ||
        (candidate.legCount === 6 && candidate.returnMultiple >= 125)
    }

    return returnMultiple >= 120
  }

  const ruleFits = (candidate, bandKey) => {
    if (!candidate) return false

    const rule = bandRules[bandKey]
    const fitsBig = (
      candidate.returnMultiple >= rule.minReturn &&
      candidate.returnMultiple < rule.maxReturnExclusive &&
      candidate.legCount >= rule.minLegs &&
      candidate.legCount <= rule.maxLegs
    )
    const fitsLotto = fitsLottoByBook(candidate)

    if (bandKey === "lotto" || bandKey === "bigUpside") {
      console.log("[BAND-FIT-DEBUG]", {
        book,
        band: bandKey,
        legCount: candidate.legCount,
        returnMultiple: Number(candidate.returnMultiple.toFixed(2)),
        fitsBigUpside: fitsBig,
        fitsLotto
      })
    }

    if (bandKey === "lotto") {
      return fitsLotto
    }

    if (bandKey === "bigUpside") {
      return fitsBig && !fitsLotto
    }

    return fitsBig
  }

  const ruleFitsRelaxed = (candidate, bandKey) => {
    if (!candidate) return false
    if (bandKey === "bigUpside") {
      if (fitsLottoByBook(candidate)) return false
      if (candidate.legCount === 4) return candidate.returnMultiple >= 55
      if (candidate.legCount === 5) return candidate.returnMultiple >= 70 && candidate.returnMultiple < 120
      return false
    }
    if (bandKey === "lotto") {
      return fitsLottoByBook(candidate)
    }
    return ruleFits(candidate, bandKey)
  }

  const bookRows = getBookRows()
  const fanDuelPoolIsThin = book === "FanDuel" && bookRows.length < 40

  const highestHitRows = sortRowsForMLHighestHitRate(bookRows)
  const bestValueRows = sortRowsForBestValue(bookRows)

  const safeRows = highestHitRows.filter((row) => isSafeLeg(row, false))
  const safeRowsRelaxed = highestHitRows.filter((row) => isSafeLeg(row, true))
  const valueRows = bestValueRows.filter((row) => isValueLeg(row, false))
  const valueRowsRelaxed = bestValueRows.filter((row) => isValueLeg(row, true))

  const payoutBoosterRows = dedupeByLegSignature(
    highestHitRows
      .filter((row) => isPayoutBoosterLeg(row))
      .map((row) => ({
        ...row,
        __payoutBoosterScore: payoutBoosterLegScore(row)
      }))
  ).sort((a, b) => {
    if (b.__payoutBoosterScore !== a.__payoutBoosterScore) return b.__payoutBoosterScore - a.__payoutBoosterScore
    return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
  })

  const payoutBoosterRowsRelaxed = dedupeByLegSignature(
    highestHitRows
      .filter((row) => isPayoutBoosterLegRelaxed(row))
      .map((row) => ({
        ...row,
        __payoutBoosterScore: payoutBoosterLegScore(row)
      }))
  ).sort((a, b) => {
    if (b.__payoutBoosterScore !== a.__payoutBoosterScore) return b.__payoutBoosterScore - a.__payoutBoosterScore
    return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
  })

  const threesRows = payoutBoosterRows.filter((row) => String(row.propType || "") === "Threes")
  const threesRowsRelaxed = payoutBoosterRowsRelaxed.filter((row) => String(row.propType || "") === "Threes")
  const bestPropsBookBoosters = dedupeByLegSignature(
    ((oddsSnapshot.bestProps || [])
      .filter((row) => row.book === book)
      .filter((row) => isPayoutBoosterLegRelaxed(row)))
  ).sort((a, b) => {
    const scoreDiff = payoutBoosterLegScore(b) - payoutBoosterLegScore(a)
    if (scoreDiff !== 0) return scoreDiff
    return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
  })

  const rotateRows = (rows, attempt = 0) => {
    if (!Array.isArray(rows) || rows.length <= 1) return Array.isArray(rows) ? [...rows] : []
    const offset = Math.max(0, attempt) % rows.length
    return [...rows.slice(offset), ...rows.slice(0, offset)]
  }

  const selectLegs = (targetLegCount, pools, options = {}) => {
    const {
      maxPerGame = targetLegCount <= 3 ? 1 : 2,
      requireThrees = 0,
      requireBooster = 0,
      allowOneRiskier = false,
      attempt = 0,
      relaxed = false,
      scoreBoostThrees = false,
      blockSameGameStatSide = targetLegCount <= 2,
      debugHighLegFallback = false
    } = options

    const flattened = []
    for (const pool of pools) {
      const rotated = rotateRows(pool, attempt)
      for (const row of rotated) flattened.push(row)
    }

    const ranked = dedupeByLegSignature(flattened)
      .filter((row) => !shouldRemoveLegForPlayerStatus(row))
      .filter((row) => !isFragileLeg(row))
      .filter((row) => !isHighRiskFlag(row))
      .sort((a, b) => legSelectionScore(b, scoreBoostThrees) - legSelectionScore(a, scoreBoostThrees))

    const countUndersInGame = (legs, matchup) => {
      return legs.filter((leg) =>
        String(leg.matchup || "") === matchup &&
        String(leg.side || "").toLowerCase() === "under"
      ).length
    }

    const attemptSelect = (maxPerGameCap) => {
      const selected = []
      const gameCounts = new Map()
      const statCounts = new Map()
      const usedPlayers = new Set()
      let riskierCount = 0

      while (selected.length < targetLegCount) {
        let bestRow = null
        let bestScore = -Infinity

        for (const row of ranked) {
          const player = String(row.player || "")
          const matchup = String(row.matchup || "")
          const propType = String(row.propType || row.statType || "")
          const side = String(row.side || "").toLowerCase()
          if (!player) continue
          if (usedPlayers.has(player)) continue
          if ((gameCounts.get(matchup) || 0) >= maxPerGameCap) continue
          if (hasConflict(selected, row)) continue
          if (blockSameGameStatSide && hasSameGameStatSide(selected, row)) continue

          const safe = isSafeLeg(row, relaxed)
          if (!safe) {
            if (!allowOneRiskier) continue
            if (!isValueLeg(row, true) && !isPayoutBoosterLegRelaxed(row)) continue
            if (riskierCount >= 1) continue
          }

          const isRepeatedUnderSameGame =
            targetLegCount >= 5 &&
            side === "under" &&
            countUndersInGame(selected, matchup) >= 1

          if (isRepeatedUnderSameGame) {
            const hasAlternative = ranked.some((alt) => {
              const altPlayer = String(alt.player || "")
              const altMatchup = String(alt.matchup || "")
              const altSide = String(alt.side || "").toLowerCase()
              if (!altPlayer) return false
              if (usedPlayers.has(altPlayer)) return false
              if ((gameCounts.get(altMatchup) || 0) >= maxPerGameCap) return false
              if (hasConflict(selected, alt)) return false
              if (blockSameGameStatSide && hasSameGameStatSide(selected, alt)) return false
              if (targetLegCount >= 5 && altSide === "under" && countUndersInGame(selected, altMatchup) >= 1) return false
              const altSafe = isSafeLeg(alt, relaxed)
              if (!altSafe) {
                if (!allowOneRiskier) return false
                if (!isValueLeg(alt, true) && !isPayoutBoosterLegRelaxed(alt)) return false
                if (riskierCount >= 1) return false
              }
              return true
            })
            if (hasAlternative) continue
          }

          let dynamicScore = legSelectionScore(row, scoreBoostThrees)
          if (targetLegCount >= 5) {
            const existingFromGame = gameCounts.get(matchup) || 0
            const existingFromStat = statCounts.get(propType) || 0
            dynamicScore -= existingFromGame * 0.17
            dynamicScore -= existingFromStat * 0.11
            if (existingFromGame === 0) dynamicScore += 0.08
            if (existingFromStat === 0) dynamicScore += 0.06
            if (isRepeatedUnderSameGame) dynamicScore -= 0.24
          }

          if (dynamicScore > bestScore) {
            bestScore = dynamicScore
            bestRow = row
          }
        }

        if (!bestRow) break

        const player = String(bestRow.player || "")
        const matchup = String(bestRow.matchup || "")
        const propType = String(bestRow.propType || bestRow.statType || "")
        const safe = isSafeLeg(bestRow, relaxed)

        selected.push(bestRow)
        usedPlayers.add(player)
        gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
        statCounts.set(propType, (statCounts.get(propType) || 0) + 1)
        if (!safe) riskierCount += 1
      }

      if (selected.length !== targetLegCount) return []

      const threesCount = selected.filter((leg) => String(leg.propType || "") === "Threes").length
      const boosterCount = selected.filter((leg) => isPayoutBoosterLegRelaxed(leg)).length
      if (threesCount < requireThrees) return []
      if (boosterCount < requireBooster) return []

      return dedupeSlipLegs(selected)
    }

    const ladder = targetLegCount >= 5
      ? [2, 3, 4]
      : [Math.max(1, Number(maxPerGame || 1))]

    for (const cap of ladder) {
      const selected = attemptSelect(cap)
      if (selected.length === targetLegCount) {
        if (debugHighLegFallback && targetLegCount >= 5 && cap > 2) {
          console.log("[HIGHLEG-MAXPERGAME-DEBUG]", {
            book,
            targetLegCount,
            attempt,
            chosenMaxPerGame: cap
          })
        }
        return selected
      }
    }

    if (debugHighLegFallback && targetLegCount >= 5) {
      console.log("[HIGHLEG-MAXPERGAME-DEBUG]", {
        book,
        targetLegCount,
        attempt,
        chosenMaxPerGame: null
      })
    }
    return []
  }

  const diversifyCandidateLastLeg = (candidate, bandKey, options = {}) => {
    if (!candidate || !Array.isArray(candidate.legs) || candidate.legs.length < 5) return candidate

    const maxPerGame = Number(options.maxPerGame || 4)
    const legs = [...candidate.legs]
    const lateStart = Math.min(3, Math.max(0, legs.length - 2))
    const weakestLateIndex = legs
      .map((leg, idx) => ({ idx, score: Number(leg?.score || 0) }))
      .filter((x) => x.idx >= lateStart)
      .sort((a, b) => a.score - b.score)[0]?.idx

    if (!Number.isInteger(weakestLateIndex)) return candidate

    const weakest = legs[weakestLateIndex]
    const fixedLegs = legs.filter((_, idx) => idx !== weakestLateIndex)
    const usedSignatures = new Set(fixedLegs.map(toLegKey))
    const usedPlayers = new Set(fixedLegs.map((leg) => String(leg.player || "")))
    const gameCounts = new Map()
    const statCounts = new Map()
    for (const leg of fixedLegs) {
      const matchup = String(leg.matchup || "")
      const stat = String(leg.propType || leg.statType || "")
      gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
      statCounts.set(stat, (statCounts.get(stat) || 0) + 1)
    }

    const alternatives = dedupeByLegSignature([
      ...highestHitRows,
      ...safeRowsRelaxed,
      ...valueRowsRelaxed,
      ...payoutBoosterRowsRelaxed,
      ...threesRowsRelaxed,
      ...bestPropsBookBoosters
    ])

    let attempts = 0
    let bestVariant = null
    let bestVariantScore = -Infinity

    for (const alt of alternatives) {
      if (!alt || shouldRemoveLegForPlayerStatus(alt) || isFragileLeg(alt) || isHighRiskFlag(alt)) continue
      if (usedPlayers.has(String(alt.player || ""))) continue
      if (usedSignatures.has(toLegKey(alt))) continue
      if (hasConflict(fixedLegs, alt)) continue
      if (hasSameGameStatSide(fixedLegs, alt)) continue

      const altMatchup = String(alt.matchup || "")
      if ((gameCounts.get(altMatchup) || 0) >= maxPerGame) continue

      const changesGame = String(alt.matchup || "") !== String(weakest.matchup || "")
      const changesStat = String(alt.propType || alt.statType || "") !== String(weakest.propType || weakest.statType || "")
      if (!changesGame && !changesStat) continue

      attempts += 1

      const variantLegs = dedupeSlipLegs([...fixedLegs, alt])
      if (variantLegs.length !== legs.length) continue

      const price = parlayPriceFromLegs(variantLegs)
      if (!price) continue
      const projectedReturn = estimateReturn(5, price.american)
      if (!projectedReturn) continue

      const variantCandidate = {
        ...candidate,
        legs: variantLegs,
        legCount: variantLegs.length,
        price,
        projectedReturn,
        returnMultiple: projectedReturn,
        trueProbability: trueParlayProbabilityFromLegs(variantLegs),
        confidence: confidenceFromLegs(variantLegs),
        materialSignature: variantLegs.map(toLegKey).sort().join("||")
      }

      if (!candidateMatchesBandWindow(variantCandidate, bandKey) && !candidateMatchesBandWindowRelaxed(variantCandidate, bandKey)) continue

      variantCandidate.assignmentScore = fitScoreForBand(variantCandidate, bandKey)

      const statKey = String(alt.propType || alt.statType || "")
      const gamePenalty = gameCounts.get(altMatchup) || 0
      const statPenalty = statCounts.get(statKey) || 0
      const diversityBump = (changesGame ? 0.18 : 0) + (changesStat ? 0.14 : 0)
      const composite = (variantCandidate.assignmentScore || 0) + diversityBump - (gamePenalty * 0.08) - (statPenalty * 0.07)

      if (composite > bestVariantScore) {
        bestVariantScore = composite
        bestVariant = variantCandidate
      }
    }

    const accepted = Boolean(bestVariant && bestVariant.materialSignature !== candidate.materialSignature)
    console.log("[DIVERSIFY-SWAP-DEBUG]", {
      book,
      scope: options.scope || "portfolio",
      bandKey,
      legCount: candidate.legCount,
      attempts,
      accepted
    })

    return accepted ? bestVariant : candidate
  }

  const buildSafe2Leg = (attempt = 0, relaxed = false) => {
    const rows = relaxed ? safeRowsRelaxed : safeRows
    return makeCandidate(
      "buildSafe2Leg",
      selectLegs(2, [rows, highestHitRows], { attempt, relaxed }),
      "smallHitters"
    )
  }

  const buildSafe3Leg = (attempt = 0, relaxed = false) => {
    const rows = relaxed ? safeRowsRelaxed : safeRows
    const candidate = makeCandidate(
      "buildSafe3Leg",
      selectLegs(3, [rows, highestHitRows], { attempt, relaxed, maxPerGame: relaxed ? 2 : 1, blockSameGameStatSide: false }),
      "midUpside"
    )
    if (!candidate) return null
    if (candidate.returnMultiple < 25 || candidate.returnMultiple >= 60) return null
    return candidate
  }

  const buildBalanced3Leg = (attempt = 0, relaxed = false) => {
    const safePool = relaxed ? safeRowsRelaxed : safeRows
    const valuePool = relaxed ? valueRowsRelaxed : valueRows
    const candidate = makeCandidate(
      "buildBalanced3Leg",
      selectLegs(3, [safePool, valuePool, payoutBoosterRowsRelaxed], {
        attempt,
        relaxed,
        allowOneRiskier: true,
        maxPerGame: 2,
        blockSameGameStatSide: false
      }),
      "midUpside"
    )
    if (!candidate) return null
    if (candidate.returnMultiple < 25 || candidate.returnMultiple >= 60) return null
    return candidate
  }

  const buildBalanced4Leg = (attempt = 0, relaxed = false) => {
    const safePool = relaxed ? safeRowsRelaxed : safeRows
    const valuePool = relaxed ? valueRowsRelaxed : valueRows
    const threesPool = relaxed ? threesRowsRelaxed : threesRows
    const relaxedFourLegForFanDuel = book === "FanDuel"
    const candidate = makeCandidate(
      "buildBalanced4Leg",
      selectLegs(4, [safePool, valuePool, threesPool, ...(book === "DraftKings" ? [bestPropsBookBoosters] : [])], {
        attempt,
        relaxed,
        requireThrees: relaxedFourLegForFanDuel ? 0 : 1,
        requireBooster: relaxedFourLegForFanDuel ? 0 : 1,
        allowOneRiskier: true,
        scoreBoostThrees: true,
        maxPerGame: dualMode ? 3 : (book === "DraftKings" ? 3 : 2),
        blockSameGameStatSide: false
      }),
      "bigUpside"
    )
    if (!candidate) return null
    if (candidate.returnMultiple < 60 || candidate.returnMultiple >= 120) return null
    return candidate
  }

  const buildThreesBoostSlip = (attempt = 0, relaxed = false) => {
    const threesPool = relaxed ? threesRowsRelaxed : threesRows
    const boosters = relaxed ? payoutBoosterRowsRelaxed : payoutBoosterRows
    const valuePool = relaxed ? valueRowsRelaxed : valueRows
    const relaxedFourLegForFanDuel = book === "FanDuel"
    const candidate = makeCandidate(
      "buildThreesBoostSlip",
      selectLegs(4, [threesPool, boosters, valuePool, ...(book === "DraftKings" ? [bestPropsBookBoosters] : [])], {
        attempt,
        relaxed: true,
        requireThrees: relaxedFourLegForFanDuel ? 0 : 1,
        requireBooster: relaxedFourLegForFanDuel ? 0 : 2,
        allowOneRiskier: true,
        scoreBoostThrees: true
        ,
        maxPerGame: 3,
        blockSameGameStatSide: false
      }),
      "bigUpside"
    )
    if (!candidate) return null
    if (candidate.returnMultiple < 60 || candidate.returnMultiple >= 120) return null
    return candidate
  }

  const buildBalanced5Leg = (attempt = 0, relaxed = false) => {
    const safePool = relaxed ? safeRowsRelaxed : safeRows
    const valuePool = relaxed ? valueRowsRelaxed : valueRows
    const boosters = relaxed ? payoutBoosterRowsRelaxed : payoutBoosterRows
    const threesPool = relaxed ? threesRowsRelaxed : threesRows
    const candidate = makeCandidate(
      "buildBalanced5Leg",
      selectLegs(5, [safePool, valuePool, boosters, threesPool, ...(book === "DraftKings" ? [bestPropsBookBoosters] : [])], {
        attempt,
        relaxed: true,
        requireBooster: book === "FanDuel" ? 0 : 1,
        requireThrees: 0,
        allowOneRiskier: true,
        scoreBoostThrees: true,
        maxPerGame: 3,
        blockSameGameStatSide: false
      }),
      "bigUpside"
    )
    if (!candidate) return null
    if (candidate.returnMultiple < 55 || candidate.returnMultiple >= 190) return null
    return candidate
  }

  const buildMixed5Leg = (attempt = 0, relaxed = false) => {
    const safePool = relaxed ? safeRowsRelaxed : safeRows
    const valuePool = relaxed ? valueRowsRelaxed : valueRows
    const boosters = relaxed ? payoutBoosterRowsRelaxed : payoutBoosterRows
    const candidate = makeCandidate(
      "buildMixed5Leg",
      selectLegs(5, [valuePool, safePool, boosters, highestHitRows], {
        attempt,
        relaxed: true,
        requireBooster: 0,
        requireThrees: 0,
        allowOneRiskier: true,
        scoreBoostThrees: true,
        maxPerGame: 3,
        blockSameGameStatSide: false
      }),
      "bigUpside"
    )
    if (!candidate) return null
    if (candidate.returnMultiple < 55 || candidate.returnMultiple >= 220) return null
    return candidate
  }

  const buildLottoSlip = (attempt = 0, relaxed = false, options = {}) => {
    const safePool = rotateRows(relaxed ? safeRowsRelaxed : safeRows, attempt)
    const valuePool = rotateRows(relaxed ? valueRowsRelaxed : valueRows, attempt + 1)
    const boosterPool = rotateRows(relaxed ? payoutBoosterRowsRelaxed : payoutBoosterRows, attempt + 2)
    const threesPool = rotateRows(relaxed ? threesRowsRelaxed : threesRows, attempt + 3)
    const isDraftKingsBook = book === "DraftKings"
    const plusMoneyBoosterPool = boosterPool.filter((row) => Number(row.odds || 0) > 0)
    const targetLegCount = Number(options?.forceLegCount) || [5, 6][attempt % 2]

    const safeLegs = selectLegs(1, [safePool, highestHitRows], { attempt, relaxed, maxPerGame: 3, blockSameGameStatSide: false })
    const valueLegs = selectLegs(1, [valuePool, bestValueRows], { attempt: attempt + 1, relaxed, allowOneRiskier: true, maxPerGame: 3, blockSameGameStatSide: false })
    const boosterNeeded = targetLegCount - 2
    const hasThreesPool = threesPool.length > 0
    const availableBoosterSupply = dedupeSlipLegs([...plusMoneyBoosterPool, ...boosterPool]).length
    const preferredRequireBooster = isDraftKingsBook ? 1 : (availableBoosterSupply >= 2 ? 2 : 1)
    const thinBoosterPool = availableBoosterSupply < (targetLegCount + 1)
    const requiredBoosterPrimary = thinBoosterPool ? 1 : preferredRequireBooster
    const requiredThreesPrimary = hasThreesPool && !thinBoosterPool ? 1 : 0
    let nullCandidateRejectCount = 0

    const logLottoQualify = (candidate, accepted, rejectReason = "") => {
      const boosterCount = Array.isArray(candidate?.legs)
        ? candidate.legs.filter((leg) => isPayoutBoosterLegRelaxed(leg)).length
        : 0
      const threesCount = Array.isArray(candidate?.legs)
        ? candidate.legs.filter((leg) => String(leg.propType || "") === "Threes").length
        : 0

      const payload = {
        book,
        legCount: candidate?.legCount || 0,
        returnMultiple: Number(candidate?.returnMultiple || 0),
        boosterCount,
        threesCount,
        accepted
      }
      if (!accepted) payload.rejectReason = rejectReason
      console.log("[LOTTO-QUALIFY-DEBUG]", payload)
    }

    const qualifiesLottoCandidate = (candidate, options = {}) => {
      const relaxedLaterFill = Boolean(options?.relaxedLaterFill)
      if (!candidate) {
        nullCandidateRejectCount += 1
        return false
      }
      if (candidate.legCount < 5 || candidate.legCount > 6) {
        logLottoQualify(candidate, false, "lotto-legcount")
        return false
      }
      const boosterCount = candidate.legs.filter((leg) => isPayoutBoosterLegRelaxed(leg)).length
      const threesCount = candidate.legs.filter((leg) => String(leg.propType || "") === "Threes").length
      const relaxedFanDuelReturnFloor = candidate.legCount === 5 ? 90 : 125
      const requiredBoosterCount = relaxedLaterFill && book === "FanDuel" && fanDuelPoolIsThin
        ? 0
        : (isDraftKingsBook ? 1 : requiredBoosterPrimary)
      const requireThreesForThisCandidate = hasThreesPool && !(relaxedLaterFill && book === "FanDuel")
      if (boosterCount < requiredBoosterCount) {
        logLottoQualify(candidate, false, "booster-min")
        return false
      }
      if (requireThreesForThisCandidate && threesCount < 1) {
        logLottoQualify(candidate, false, "threes-min")
        return false
      }
      if (!fitsLottoByBook(candidate)) {
        if (!(relaxedLaterFill && book === "FanDuel" && candidate.returnMultiple >= relaxedFanDuelReturnFloor)) {
          logLottoQualify(candidate, false, "return-threshold")
          return false
        }
      }

      if (relaxedLaterFill) {
        const laterLegs = candidate.legs.slice(3)
        for (const leg of laterLegs) {
          const legHitRate = parseHitRate(leg.hitRate)
          const legScore = Number(leg.score || 0)
          const legEdge = Number(leg.edge || leg.projectedValue || 0)
          const legTrendRisk = String(leg.trendRisk || "").toLowerCase()
          const legInjuryRisk = String(leg.injuryRisk || "").toLowerCase()

          if (legTrendRisk === "high") {
            logLottoQualify(candidate, false, "fallback-later-trendRisk-high")
            return false
          }
          if (legInjuryRisk === "high") {
            logLottoQualify(candidate, false, "fallback-later-injuryRisk-high")
            return false
          }
          // FanDuel thin-pool: skip score/edge/hitRate floors — risk flags above are sufficient safety gates
          if (book === "FanDuel" && fanDuelPoolIsThin) continue
          if (legEdge < -2) {
            logLottoQualify(candidate, false, "fallback-later-edge-floor")
            return false
          }
          if (legScore < 15) {
            logLottoQualify(candidate, false, "fallback-later-score-floor")
            return false
          }
          if (legHitRate < 0.58) {
            logLottoQualify(candidate, false, "fallback-later-hitRate-floor")
            return false
          }
        }
      } else {
        const strongHitRateLegs = candidate.legs.filter((leg) => parseHitRate(leg.hitRate) >= 0.8).length
        const lowHitRateLegs = candidate.legs.filter((leg) => parseHitRate(leg.hitRate) < 0.75).length
        const strictStrongLegFloor = book === "FanDuel" ? 3 : 4
        if (strongHitRateLegs < strictStrongLegFloor) {
          logLottoQualify(candidate, false, "strong-hitrate-min")
          return false
        }
        if (lowHitRateLegs > 2) {
          logLottoQualify(candidate, false, "low-hitrate-max")
          return false
        }
      }

      logLottoQualify(candidate, true)
      return true
    }

    let boosterLegs = selectLegs(boosterNeeded, [plusMoneyBoosterPool, boosterPool, threesPool], {
      attempt: attempt + 2,
      relaxed: true,
      allowOneRiskier: true,
      requireBooster: requiredBoosterPrimary,
      requireThrees: requiredThreesPrimary,
      scoreBoostThrees: true,
      maxPerGame: 3,
      blockSameGameStatSide: false
    })

    let combined = dedupeSlipLegs([...safeLegs, ...valueLegs, ...boosterLegs])
    let candidate = combined.length < targetLegCount
      ? null
      : makeCandidate("buildLottoSlip", combined.slice(0, targetLegCount), "lotto")

    if (!qualifiesLottoCandidate(candidate, { relaxedLaterFill: false })) {
      boosterLegs = selectLegs(boosterNeeded, [plusMoneyBoosterPool, boosterPool, threesPool], {
        attempt: attempt + 3,
        relaxed: true,
        allowOneRiskier: true,
        requireBooster: 1,
        requireThrees: 0,
        scoreBoostThrees: true,
        maxPerGame: 3,
        blockSameGameStatSide: false
      })
      combined = dedupeSlipLegs([...safeLegs, ...valueLegs, ...boosterLegs])
      candidate = combined.length < targetLegCount
        ? null
        : makeCandidate("buildLottoSlip", combined.slice(0, targetLegCount), "lotto")
    }
    // Third fallback: wide pool with no booster/threes requirements to avoid null-candidate-aggregate
    // Only triggers when candidate is still null after both prior attempts
    if (!candidate) {
      const widerLegs = selectLegs(targetLegCount, [safeRowsRelaxed, highestHitRows, valueRowsRelaxed, payoutBoosterRowsRelaxed, threesRowsRelaxed], {
        attempt: attempt + 4,
        relaxed: true,
        requireBooster: 0,
        requireThrees: 0,
        allowOneRiskier: true,
        maxPerGame: 3,
        blockSameGameStatSide: false
      })
      if (widerLegs.length >= targetLegCount) {
        const widerCandidate = makeCandidate("buildLottoSlip-wideFallback", widerLegs.slice(0, targetLegCount), "lotto")
        // Accept wide-fallback at 60x for FD (pure safe-leg 5-leg slips rarely hit 75x)
        const wideFallbackOk = candidateMatchesBandWindowRelaxed(widerCandidate, "lotto") ||
          (book === "FanDuel" && widerCandidate.legCount >= 5 && widerCandidate.returnMultiple >= 60)
        if (widerCandidate && wideFallbackOk) {
          console.log("[LOTTO-QUALIFY-DEBUG]", {
            book,
            fallbackUsed: "wide-pool",
            legCount: widerCandidate.legCount,
            returnMultiple: Number(widerCandidate.returnMultiple.toFixed(1))
          })
          candidate = widerCandidate
        }
      }
    }
    const relaxedAccepted = qualifiesLottoCandidate(candidate, { relaxedLaterFill: true })
    if (nullCandidateRejectCount > 0) {
      console.log("[LOTTO-QUALIFY-DEBUG]", {
        book,
        legCount: targetLegCount,
        accepted: false,
        rejectReason: "null-candidate-aggregate",
        count: nullCandidateRejectCount
      })
    }
    if (relaxedAccepted) return candidate
    if (candidate && candidate.legCount >= 5) {
      // Lowered FD floors: 75x (5-leg) / 105x (6-leg) are achievable with mixed-odds slips
      if (book === "FanDuel" && candidate.returnMultiple >= (candidate.legCount === 5 ? 75 : 105)) return candidate
      if (book === "DraftKings" && candidate.returnMultiple >= 110) return candidate
      if (candidate.returnMultiple >= 100) return candidate
    }
    return null
  }

  const buildLotto5Leg = (attempt = 0, relaxed = false) => buildLottoSlip(attempt, relaxed, { forceLegCount: 5 })
  const buildLotto6Leg = (attempt = 0, relaxed = false) => buildLottoSlip(attempt, relaxed, { forceLegCount: 6 })

  const buildVariantCandidate = (label, targetLegCount, pools, bandKey, options = {}) => {
    const {
      attempt = 0,
      relaxed = true,
      requireBooster = 0,
      requireThrees = 0,
      allowOneRiskier = true,
      scoreBoostThrees = true,
      maxPerGame = 3
    } = options

    return makeCandidate(
      label,
      selectLegs(targetLegCount, pools, {
        attempt,
        relaxed,
        requireBooster,
        requireThrees,
        allowOneRiskier,
        scoreBoostThrees,
        maxPerGame,
        blockSameGameStatSide: false
      }),
      bandKey
    )
  }

  const buildCandidatePoolByBand = () => {
    const pool = {
      smallHitters: [],
      midUpside: [],
      bigUpside: [],
      lotto: []
    }

    const pushCandidate = (bandKey, candidate) => {
      if (!candidate) return
      const strictFit = candidateMatchesBandWindow(candidate, bandKey)
      const relaxedFit = !strictFit && candidateMatchesBandWindowRelaxed(candidate, bandKey)
      if (!strictFit && !relaxedFit) return
      pool[bandKey].push({
        ...candidate,
        __relaxedWindowOnly: relaxedFit,
        assignmentScore: fitScoreForBand(candidate, bandKey)
      })
    }

    if (Array.isArray(slipObjects)) {
      for (const slip of slipObjects) {
        const legs = Array.isArray(slip?.legs) ? dedupeSlipLegs(slip.legs) : []
        if (legs.length < 2) continue
        const candidate = makeCandidate(slip?.label || "Seed Slip", legs, "midUpside")
        if (!candidate) continue

        pushCandidate("smallHitters", candidate)
        pushCandidate("midUpside", candidate)
        pushCandidate("bigUpside", candidate)
        pushCandidate("lotto", candidate)
      }
    }

    const attemptCeiling = book === "FanDuel" ? 18 : 16

    for (let attempt = 0; attempt < attemptCeiling; attempt += 1) {
      const shiftedA = (attempt * 2 + 1) % attemptCeiling
      const shiftedB = (attempt * 3 + 2) % attemptCeiling
      const shiftedC = (attempt * 5 + 3) % attemptCeiling

      pushCandidate("smallHitters", buildSafe2Leg(attempt, false))
      pushCandidate("smallHitters", buildSafe2Leg(shiftedA, true))

      pushCandidate("midUpside", buildSafe3Leg(attempt, false))
      pushCandidate("midUpside", buildSafe3Leg(shiftedA, true))
      pushCandidate("midUpside", buildBalanced3Leg(attempt, false))
      pushCandidate("midUpside", buildBalanced3Leg(shiftedB, true))
      pushCandidate("midUpside", buildBalanced4Leg(shiftedA, book === "FanDuel"))
      pushCandidate("midUpside", buildBalanced4Leg(shiftedC, true))
      pushCandidate("midUpside", buildVariantCandidate(
        "buildVariantMid3",
        3,
        [safeRowsRelaxed, valueRowsRelaxed, payoutBoosterRowsRelaxed, threesRowsRelaxed, bestPropsBookBoosters],
        "midUpside",
        { attempt: shiftedB, requireBooster: 0, requireThrees: 0, maxPerGame: 2 }
      ))

      pushCandidate("bigUpside", buildBalanced4Leg(attempt, book === "FanDuel"))
      pushCandidate("bigUpside", buildBalanced4Leg(shiftedA, true))
      pushCandidate("bigUpside", buildThreesBoostSlip(attempt, book === "FanDuel"))
      pushCandidate("bigUpside", buildThreesBoostSlip(shiftedB, true))
      pushCandidate("bigUpside", buildBalanced5Leg(shiftedA, false))
      pushCandidate("bigUpside", buildBalanced5Leg(shiftedB, true))
      pushCandidate("bigUpside", buildMixed5Leg(shiftedC, false))
      pushCandidate("bigUpside", buildMixed5Leg(attempt, true))
      pushCandidate("bigUpside", buildVariantCandidate(
        "buildVariantBig4",
        4,
        [payoutBoosterRowsRelaxed, threesRowsRelaxed, valueRowsRelaxed, safeRowsRelaxed, bestPropsBookBoosters],
        "bigUpside",
        {
          attempt: shiftedC,
          requireBooster: fanDuelPoolIsThin ? 0 : 1,
          requireThrees: fanDuelPoolIsThin ? 0 : 1,
          maxPerGame: 3
        }
      ))
      pushCandidate("bigUpside", buildLottoSlip(shiftedA, false))

      pushCandidate("lotto", buildLottoSlip(attempt, false))
      pushCandidate("lotto", buildLottoSlip(shiftedA, true))
      pushCandidate("lotto", buildLotto5Leg(shiftedB, false))
      pushCandidate("lotto", buildLotto5Leg(shiftedC, true))
      pushCandidate("lotto", buildLotto6Leg(shiftedA, false))
      pushCandidate("lotto", buildLotto6Leg(shiftedB, true))
      pushCandidate("lotto", buildVariantCandidate(
        "buildVariantLotto5",
        5,
        [payoutBoosterRowsRelaxed, valueRowsRelaxed, safeRowsRelaxed, threesRowsRelaxed, bestPropsBookBoosters, highestHitRows],
        "lotto",
        {
          attempt: shiftedC,
          // FanDuel always uses 0 requirements for 5/6-leg variants — thin or not — to maximise candidate supply
          requireBooster: book === "FanDuel" ? 0 : 1,
          requireThrees: book === "FanDuel" ? 0 : 1,
          maxPerGame: 3
        }
      ))
      pushCandidate("lotto", buildVariantCandidate(
        "buildVariantLotto6",
        6,
        [payoutBoosterRowsRelaxed, valueRowsRelaxed, safeRowsRelaxed, threesRowsRelaxed, bestPropsBookBoosters, highestHitRows],
        "lotto",
        {
          attempt: shiftedB,
          requireBooster: book === "FanDuel" ? 0 : 1,
          requireThrees: 0,
          maxPerGame: 3
        }
      ))
      // Extra FD-only wide-pool lotto variant: no booster/threes constraints, maxPerGame:4, relaxed=true
      // This ensures at least some lotto candidates exist even on the thinnest FD slates
      if (book === "FanDuel") {
        pushCandidate("lotto", buildVariantCandidate(
          "buildVariantLotto5-fdwide",
          5,
          [highestHitRows, safeRowsRelaxed, valueRowsRelaxed, payoutBoosterRowsRelaxed, threesRowsRelaxed],
          "lotto",
          { attempt: shiftedA, requireBooster: 0, requireThrees: 0, maxPerGame: 4, relaxed: true }
        ))
        pushCandidate("lotto", buildVariantCandidate(
          "buildVariantLotto5-fdwide2",
          5,
          [valueRowsRelaxed, highestHitRows, safeRowsRelaxed, payoutBoosterRowsRelaxed],
          "lotto",
          { attempt: shiftedB, requireBooster: 0, requireThrees: 0, maxPerGame: 4, relaxed: true }
        ))
      }
    }

    console.log(`[PAYOUT-PORTFOLIO] ${book} seeded candidate counts`, {
      smallHitters: pool.smallHitters.length,
      midUpside: pool.midUpside.length,
      bigUpside: pool.bigUpside.length,
      lotto: pool.lotto.length,
      attemptCeiling
    })

    return pool
  }

  const dedupeCandidates = (candidates, bandKey) => {
    const bySignature = new Map()

    const candidateDiversityScore = (candidate) => {
      const legs = Array.isArray(candidate?.legs) ? candidate.legs : []
      if (!legs.length) return 0
      const games = new Set(legs.map((leg) => String(leg?.matchup || ""))).size
      const stats = new Set(legs.map((leg) => String(leg?.propType || leg?.statType || ""))).size
      const underCount = legs.filter((leg) => String(leg?.side || "").toLowerCase() === "under").length
      const underPenalty = underCount >= Math.max(3, Math.ceil(legs.length * 0.7)) ? 0.12 : 0
      return games * 0.08 + stats * 0.05 - underPenalty
    }

    for (const candidate of candidates || []) {
      if (!candidate) continue
      // Accept if strict ruleFits OR relaxed window — pushCandidate already gatekeeps the raw pool,
      // this prevents relaxed-window candidates (e.g. FD 5-leg 90-99x) from being silently stripped here
      if (!ruleFits(candidate, bandKey) && !candidateMatchesBandWindowRelaxed(candidate, bandKey)) continue
      const existing = bySignature.get(candidate.materialSignature)
      const candidateComposite = candidate.assignmentScore + candidateDiversityScore(candidate)
      const existingComposite = existing
        ? existing.assignmentScore + candidateDiversityScore(existing)
        : -Infinity
      if (!existing || candidateComposite > existingComposite) {
        bySignature.set(candidate.materialSignature, candidate)
      }
    }

    return [...bySignature.values()].sort((a, b) => {
      const bComposite = b.assignmentScore + candidateDiversityScore(b)
      const aComposite = a.assignmentScore + candidateDiversityScore(a)
      if (bComposite !== aComposite) return bComposite - aComposite
      if (b.trueProbability !== a.trueProbability) return b.trueProbability - a.trueProbability
      return b.returnMultiple - a.returnMultiple
    })
  }

  const candidatePoolByBand = buildCandidatePoolByBand()
  const candidateCountsRaw = {
    smallHitters: candidatePoolByBand.smallHitters.length,
    midUpside: candidatePoolByBand.midUpside.length,
    bigUpside: candidatePoolByBand.bigUpside.length,
    lotto: candidatePoolByBand.lotto.length
  }

  const selectedByBand = {
    smallHitters: [],
    midUpside: [],
    bigUpside: [],
    lotto: []
  }

  const buildLottoBatchOptions = (lottoCandidates = []) => {
    const usedMaterial = new Set()
    const twoCoreCounts = new Map()
    const threeCoreCounts = new Map()
    const anchorCounts = new Map()
    const boosterCoreCounts = new Map()
    const maxBatchOptions = book === "FanDuel" ? 2 : 3
    const thinPool = (lottoCandidates || []).length < 6

    const diversityScore = (candidate) => {
      const legs = Array.isArray(candidate?.legs) ? candidate.legs : []
      const games = new Set(legs.map((leg) => String(leg?.matchup || ""))).size
      const propMix = new Set(legs.map((leg) => String(leg?.propType || leg?.statType || ""))).size
      const plusMoneyCount = legs.filter((leg) => Number(leg?.odds || 0) > 0).length
      return games * 0.18 + propMix * 0.14 + plusMoneyCount * 0.1 + (candidate.assignmentScore || 0)
    }

    const bucketed = {
      5: [],
      6: [],
      7: [],
      4: []
    }

    for (const c of lottoCandidates || []) {
      if (!c || !Array.isArray(c.legs)) continue
      const k = Number(c.legCount)
      if (bucketed[k]) bucketed[k].push(c)
    }

    for (const k of Object.keys(bucketed)) {
      bucketed[k].sort((a, b) => diversityScore(b) - diversityScore(a))
    }

    const ordered = []
    const pattern = [5, 6, 5, 6, 5, 6, 7, 4]
    for (const k of pattern) {
      const arr = bucketed[k]
      if (arr && arr.length) ordered.push(arr.shift())
    }
    for (const k of [5, 6, 7, 4]) {
      for (const c of bucketed[k]) ordered.push(c)
    }

    console.log("[LOTTO-BATCH-DEDUPE-DEBUG]", {
      book,
      inputCandidates: lottoCandidates.length,
      orderedCandidates: ordered.length,
      thinPool,
      relaxedCoreDedupe: thinPool
    })

    if (thinPool) {
      const seedCandidates = ordered.slice(0, Math.min(6, ordered.length))
      for (const seed of seedCandidates) {
        const variant = diversifyCandidateLastLeg(seed, "lotto", { scope: "lottoBatch-variant", maxPerGame: 4 })
        if (!variant) continue
        if (variant.materialSignature === seed.materialSignature) continue
        ordered.push(variant)
      }
    }

    const selected = []
    for (const c of ordered) {
      if (selected.length >= maxBatchOptions) break
      if (!c || !Array.isArray(c.legs)) continue
      const candidate = diversifyCandidateLastLeg(c, "lotto", { scope: "lottoBatch-final", maxPerGame: 4 })
      if (!candidate || !candidateMatchesBandWindowRelaxed(candidate, "lotto")) continue

      const material = candidate.materialSignature || candidate.legs.map((l) => `${l.player}|${l.propType}|${l.side}|${l.line}`).sort().join("||")
      if (usedMaterial.has(material)) continue

      const core2 = candidate.legs
        .slice(0, 2)
        .map((l) => `${l.player}|${l.propType}`)
        .join("|")
      const core3 = candidate.legs
        .slice(0, 3)
        .map((l) => `${l.player}|${l.propType}`)
        .join("|")
      const anchor = candidate.legs
        .slice()
        .sort((a, b) => parseHitRate(b.hitRate) - parseHitRate(a.hitRate))[0]
      const anchorKey = anchor ? `${anchor.player}|${anchor.propType}` : ""
      const boosterCore = candidate.legs
        .filter((l) => Number(l.odds || 0) > 0)
        .slice(0, 2)
        .map((l) => `${l.player}|${l.propType}`)
        .sort()
        .join("||")

      if (!thinPool) {
        if ((twoCoreCounts.get(core2) || 0) >= (book === "FanDuel" ? 1 : 2)) continue
        if ((threeCoreCounts.get(core3) || 0) >= 2) continue
        if (anchorKey && (anchorCounts.get(anchorKey) || 0) >= 1) continue
        if (boosterCore && (boosterCoreCounts.get(boosterCore) || 0) >= 1) continue
      }

      usedMaterial.add(material)
      twoCoreCounts.set(core2, (twoCoreCounts.get(core2) || 0) + 1)
      threeCoreCounts.set(core3, (threeCoreCounts.get(core3) || 0) + 1)
      if (anchorKey) anchorCounts.set(anchorKey, (anchorCounts.get(anchorKey) || 0) + 1)
      if (boosterCore) boosterCoreCounts.set(boosterCore, (boosterCoreCounts.get(boosterCore) || 0) + 1)
      selected.push(candidate)
    }

    console.log("[LOTTO-BATCH-DEDUPE-DEBUG]", {
      book,
      selectedCount: selected.length,
      maxBatchOptions,
      thinPool
    })

    return selected.map((candidate, index) => ({
      rank: index + 1,
      label: `Lotto Batch #${index + 1}`,
      buildTag: "lotto-batch",
      stake: 1,
      projectedReturn: Number((candidate.projectedReturn / 5).toFixed(2)),
      estimatedProfit: Number(((candidate.projectedReturn / 5) - 1).toFixed(2)),
      oddsAmerican: candidate.price.american,
      oddsDecimal: candidate.price.decimal,
      trueProbability: Number((candidate.trueProbability * 100).toFixed(1)),
      confidence: candidate.confidence,
      legCount: candidate.legCount,
      legs: candidate.legs
    }))
  }

  function candidateMatchesBandWindow(candidate, bandKey) {
    if (!candidate) return false
    const rule = bandRules[bandKey]
    if (!rule) return false
    if (!candidate.legCount || candidate.legCount < 2) return false

    if (bandKey === "lotto") {
      return fitsLottoByBook(candidate)
    }

    if (bandKey === "bigUpside") {
      if (candidate.legCount < rule.minLegs || candidate.legCount > rule.maxLegs) return false
      if (candidate.returnMultiple < rule.minReturn) return false
      if (candidate.returnMultiple >= rule.maxReturnExclusive) return false
      if (fitsLottoByBook(candidate)) return false
      return true
    }

    if (bandKey === "midUpside") {
      if (candidate.legCount < 3 || candidate.legCount > 4) return false
      if (candidate.returnMultiple < 25) return false
      if (candidate.returnMultiple >= 60) return false
      return true
    }

    if (bandKey === "smallHitters") {
      if (candidate.legCount !== 2) return false
      if (candidate.returnMultiple < 10) return false
      if (candidate.returnMultiple >= 25) return false
      return true
    }

    return false
  }

  function candidateMatchesBandWindowRelaxed(candidate, bandKey) {
    if (!candidate || !Array.isArray(candidate.legs) || candidate.legs.length < 2) return false
    if (candidate.legs.some((leg) => shouldRemoveLegForPlayerStatus(leg) || isFragileLeg(leg) || isHighRiskFlag(leg))) return false

    if (bandKey === "smallHitters") {
      if (candidate.legCount < 2 || candidate.legCount > 3) return false
      return candidate.returnMultiple >= 8 && candidate.returnMultiple < 30
    }

    if (bandKey === "midUpside") {
      if (candidate.legCount < 3 || candidate.legCount > 4) return false
      return candidate.returnMultiple >= 22 && candidate.returnMultiple < 72
    }

    if (bandKey === "bigUpside") {
      if (candidate.legCount < 4 || candidate.legCount > 6) return false
      const minReturn = book === "FanDuel" ? 48 : 52
      if (candidate.returnMultiple < minReturn || candidate.returnMultiple >= 140) return false
      if (fitsLottoByBook(candidate)) return false
      return true
    }

    if (bandKey === "lotto") {
      if (fitsLottoByBook(candidate)) return true
      if (candidate.legCount !== 5 && candidate.legCount !== 6) return false
      if (book === "FanDuel") {
        // RELAXED: accept 75x+ (5-leg) / 105x+ (6-leg) so thin-pool FD candidates aren't fully gated out
        return (candidate.legCount === 5 && candidate.returnMultiple >= 75) ||
          (candidate.legCount === 6 && candidate.returnMultiple >= 105)
      }
      return candidate.returnMultiple >= 110
    }

    return false
  }

  const usedMaterialAcrossBands = new Set()
  const usedTwoLegCore = new Map()
  const duplicateRejectCounts = {
    smallHitters: { exactDuplicate: 0, sharedCoreDuplicate: 0 },
    midUpside: { exactDuplicate: 0, sharedCoreDuplicate: 0 },
    bigUpside: { exactDuplicate: 0, sharedCoreDuplicate: 0 },
    lotto: { exactDuplicate: 0, sharedCoreDuplicate: 0 }
  }
  const dedupedCandidatesByBand = {}
  const candidateCountsBeforeSelection = {}
  const selectedCountsAfterFirstPass = {
    smallHitters: 0,
    midUpside: 0,
    bigUpside: 0,
    lotto: 0
  }

  const violatesPlayerReuse = () => false

  const registerCandidateUsage = (candidate) => {
    usedMaterialAcrossBands.add(candidate.materialSignature)
    if (candidate.twoLegCoreSignature) {
      usedTwoLegCore.set(candidate.twoLegCoreSignature, (usedTwoLegCore.get(candidate.twoLegCoreSignature) || 0) + 1)
    }
  }

  const trySelectCandidate = (bandKey, candidate, phase = "selection", selectOptions = {}) => {
    const allowExactReuse = Boolean(selectOptions?.allowExactReuse)
    const disableCoreLockout = Boolean(selectOptions?.disableCoreLockout)
    const enforceTwoLegCoreLockout = bandKey === "smallHitters" && !disableCoreLockout
    if (!candidate) {
      noteBandRejection(bandKey, `${phase}-null-candidate`)
      return false
    }
    if (!allowExactReuse && usedMaterialAcrossBands.has(candidate.materialSignature)) {
      noteBandRejection(bandKey, "exact-slip-reuse")
      duplicateRejectCounts[bandKey].exactDuplicate += 1
      if (bandKey === "lotto") {
        console.log("[LOTTO-REJECT-DEBUG]", {
          bandKey,
          phase,
          reason: "exact-slip-reuse",
          materialSignature: candidate.materialSignature
        })
      }
      return false
    }
    if (enforceTwoLegCoreLockout && candidate.twoLegCoreSignature && (usedTwoLegCore.get(candidate.twoLegCoreSignature) || 0) >= 1) {
      noteBandRejection(bandKey, "two-leg-core-lockout")
      duplicateRejectCounts[bandKey].sharedCoreDuplicate += 1
      return false
    }
    if (violatesPlayerReuse(candidate)) {
      noteBandRejection(bandKey, "player-reuse-lockout")
      return false
    }
    registerCandidateUsage(candidate)
    selectedByBand[bandKey].push(candidate)
    return true
  }

  const buildRelaxedFallbackCandidates = (bandKey) => {
    const basePool = candidatePoolByBand[bandKey] || []
    const adjacentBandPools = {
      smallHitters: [candidatePoolByBand.midUpside || []],
      midUpside: [candidatePoolByBand.smallHitters || [], candidatePoolByBand.bigUpside || []],
      bigUpside: [candidatePoolByBand.midUpside || [], candidatePoolByBand.lotto || []],
      lotto: [candidatePoolByBand.bigUpside || []]
    }

    const merged = [...basePool, ...(adjacentBandPools[bandKey] || []).flat()]
      .filter(Boolean)
      .filter((candidate) => candidateMatchesBandWindowRelaxed(candidate, bandKey))

    const byMaterial = new Map()
    for (const candidate of merged) {
      if (!candidate || !candidate.materialSignature) continue
      const score = fitScoreForBand(candidate, bandKey)
      const existing = byMaterial.get(candidate.materialSignature)
      if (!existing || score > existing.__fallbackScore) {
        byMaterial.set(candidate.materialSignature, { ...candidate, __fallbackScore: score })
      }
    }

    return [...byMaterial.values()]
      .sort((a, b) => {
        if (b.__fallbackScore !== a.__fallbackScore) return b.__fallbackScore - a.__fallbackScore
        if (b.trueProbability !== a.trueProbability) return b.trueProbability - a.trueProbability
        return b.returnMultiple - a.returnMultiple
      })
      .map(({ __fallbackScore, ...candidate }) => candidate)
  }

  for (const bandKey of bandOrder) {
    const deduped = dedupeCandidates(candidatePoolByBand[bandKey], bandKey)
    dedupedCandidatesByBand[bandKey] = deduped
    candidateCountsBeforeSelection[bandKey] = deduped.length
  }

  for (const bandKey of bandOrder) {
    for (const candidate of dedupedCandidatesByBand[bandKey]) {
      if (selectedByBand[bandKey].length >= 1) break
      if (trySelectCandidate(bandKey, candidate, "first-pass")) break
    }
    selectedCountsAfterFirstPass[bandKey] = selectedByBand[bandKey].length
  }

  for (const bandKey of bandOrder) {
    for (const candidate of dedupedCandidatesByBand[bandKey]) {
      if (selectedByBand[bandKey].length >= (desiredOptionsByBand[bandKey] || 2)) break
      if (selectedByBand[bandKey].some((selected) => selected.materialSignature === candidate.materialSignature)) continue
      trySelectCandidate(bandKey, candidate, "second-pass")
    }
  }

  for (const bandKey of bandOrder) {
    if (selectedByBand[bandKey].length >= (desiredOptionsByBand[bandKey] || 2)) continue

    const relaxedFallbackCandidates = buildRelaxedFallbackCandidates(bandKey)
    if (relaxedFallbackCandidates.length) {
      console.log(`[PAYOUT-PORTFOLIO] ${book} ${bandKey} relaxed fallback used`, {
        targetOptions: desiredOptionsByBand[bandKey] || 2,
        currentOptions: selectedByBand[bandKey].length,
        relaxedCandidateCount: relaxedFallbackCandidates.length
      })
    }

    for (const candidate of relaxedFallbackCandidates) {
      if (selectedByBand[bandKey].length >= (desiredOptionsByBand[bandKey] || 2)) break
      if (selectedByBand[bandKey].some((selected) => selected.materialSignature === candidate.materialSignature)) continue
      trySelectCandidate(bandKey, candidate, "relaxed-pass", { disableCoreLockout: true })
    }
  }

  for (const bandKey of bandOrder) {
    console.log(`[PAYOUT-PORTFOLIO] ${book} ${bandKey} selection summary`, {
      candidateCountBeforeSelection: candidateCountsBeforeSelection[bandKey],
      selectedAfterFirstPass: selectedCountsAfterFirstPass[bandKey],
      selectedAfterSecondPass: selectedByBand[bandKey].length,
      duplicateRejects: duplicateRejectCounts[bandKey],
      rejectionCounts: portfolioDebug.rejectionCounts[bandKey]
    })
    if (!selectedByBand[bandKey].length) {
      console.log(`[PAYOUT-PORTFOLIO] ${book} ${bandKey} final empty`, portfolioDebug.rejectionCounts[bandKey])
    }
  }

  const portfolio = {}
  for (const bandKey of bandOrder) {
    const band = bands[bandKey]
    const selected = selectedByBand[bandKey]

    const validSelected = selected.filter((c) => (
      candidateMatchesBandWindow(c, bandKey) || candidateMatchesBandWindowRelaxed(c, bandKey)
    ))

    portfolio[bandKey] = {
      label: band.label,
      description: band.description,
      options: validSelected.map((c, idx) => ({
        rank: idx + 1,
        label: `${band.label} #${idx + 1}`,
        stake: c.stake,
        projectedReturn: Number(c.projectedReturn.toFixed(2)),
        estimatedProfit: Number((c.projectedReturn - c.stake).toFixed(2)),
        oddsAmerican: c.price.american,
        oddsDecimal: Number(c.price.decimal.toFixed(2)),
        trueProbability: Number((c.trueProbability * 100).toFixed(1)),
        confidence: c.confidence,
        legCount: c.legCount,
        legs: c.legs.map((leg) => ({
          playerName: leg.playerName || leg.player,
          statType: leg.statType || leg.propType,
          line: leg.line,
          odds: leg.odds,
          book: leg.book,
          hitRate: leg.hitRate,
          projectedValue: leg.projectedValue || leg.edge
        }))
      }))
    }
  }

  let lottoBatchSource = (dedupedCandidatesByBand?.lotto?.length
    ? dedupedCandidatesByBand.lotto
    : selectedByBand.lotto
  // Accept both strict and relaxed lotto candidates so thin-pool FD slips reach buildLottoBatchOptions
  ).filter((candidate) => candidateMatchesBandWindow(candidate, "lotto") || candidateMatchesBandWindowRelaxed(candidate, "lotto"))

  const lottoBatchTarget = book === "FanDuel" ? 2 : 3
  if (lottoBatchSource.length < lottoBatchTarget) {
    const relaxedLottoFallback = [
      ...(candidatePoolByBand.lotto || []),
      ...(dedupedCandidatesByBand.bigUpside || []),
      ...(candidatePoolByBand.bigUpside || [])
    ]
      .filter(Boolean)
      .filter((candidate) => candidateMatchesBandWindowRelaxed(candidate, "lotto"))

    const seenMaterial = new Set(lottoBatchSource.map((candidate) => candidate.materialSignature))
    for (const candidate of relaxedLottoFallback) {
      if (!candidate?.materialSignature) continue
      if (seenMaterial.has(candidate.materialSignature)) continue
      lottoBatchSource.push(candidate)
      seenMaterial.add(candidate.materialSignature)
    }

    console.log("[LOTTO-BATCH-DEBUG]", {
      book,
      relaxedFallbackUsed: true,
      lottoBatchTarget,
      relaxedFallbackAdded: Math.max(0, lottoBatchSource.length - (dedupedCandidatesByBand?.lotto?.length || selectedByBand.lotto.length))
    })
  }

  const lottoBatchOptions = buildLottoBatchOptions(lottoBatchSource)

  console.log("[LOTTO-BATCH-DEBUG]", {
    book,
    lottoBatchTarget,
    lottoBatchSourceCount: lottoBatchSource.length,
    lottoBatchSelectedCount: lottoBatchOptions.length,
    selectedLottoCount: selectedByBand.lotto.length,
    dedupedLottoCount: dedupedCandidatesByBand?.lotto?.length || 0
  })

  portfolio.lottoBatch = {
    label: "Lotto Batch",
    description: "High-volume diversified $1 lotto tickets",
    options: lottoBatchOptions
  }

  // Count strict vs relaxed breakdown in deduped pools for supply diagnostics
  const relaxedCounts = {}
  for (const bandKey of bandOrder) {
    relaxedCounts[bandKey] = {
      strict: dedupedCandidatesByBand[bandKey].filter((c) => !c.__relaxedWindowOnly).length,
      relaxed: dedupedCandidatesByBand[bandKey].filter((c) => c.__relaxedWindowOnly).length
    }
  }

  console.log("[PAYOUT-PORTFOLIO-CANDIDATE-SUMMARY]", {
    book,
    beforeDedupe: candidateCountsRaw,
    afterDedupe: {
      smallHitters: dedupedCandidatesByBand.smallHitters.length,
      midUpside: dedupedCandidatesByBand.midUpside.length,
      bigUpside: dedupedCandidatesByBand.bigUpside.length,
      lotto: dedupedCandidatesByBand.lotto.length
    },
    relaxedBreakdown: relaxedCounts,
    lottoBatchSelected: portfolio.lottoBatch.options.length
  })

  // Final band health summary: if supply was the problem vs conflict/band-fit rules
  const bandHealth = {}
  for (const bandKey of bandOrder) {
    const deduped = dedupedCandidatesByBand[bandKey].length
    const selected = selectedByBand[bandKey].length
    const desired = desiredOptionsByBand[bandKey] || 2
    bandHealth[bandKey] = {
      deduped,
      selected,
      desired,
      shortage: deduped === 0 ? "supply" : selected < desired ? "conflict-or-fit" : "ok"
    }
  }
  console.log("[PAYOUT-PORTFOLIO-BAND-HEALTH]", { book, bands: bandHealth, lottoBatch: portfolio.lottoBatch.options.length })

  return portfolio
}

function buildDualLanePortfoliosForBook(book, sourceRows = [], highestHitSlipObjects = []) {
  const safeRows = dedupeByLegSignature(
    (Array.isArray(sourceRows) ? sourceRows : [])
      .filter((row) => row?.book === book)
      .filter((row) => !shouldRemoveLegForPlayerStatus(row))
      .filter((row) => !isFragileLeg(row))
  )

  const laneConfigs = {
    recoup: {
      targetMin: 8,
      targetMaxExclusive: 20,
      legCounts: [2, 3],
      maxOptions: 2,
      stake: 5,
      buildTags: ["recoup-core", "safe-floor-mix"],
      maxBooster: 0,
      minHitRate: 0.68,
      avoidNovelty: true
    },
    conservative: {
      targetMin: 20,
      targetMaxExclusive: 60,
      legCounts: [2, 3, 4],
      maxOptions: 3,
      stake: 5,
      buildTags: ["conservative-alt-core", "balanced-floor"],
      maxBooster: 1,
      minHitRate: 0.62,
      avoidNovelty: true
    },
    midUpside: {
      targetMin: 60,
      targetMaxExclusive: 120,
      legCounts: [4, 5],
      maxOptions: 3,
      stake: 5,
      buildTags: ["mid-upside-balance", "boosted-core"],
      maxBooster: 2,
      minHitRate: 0.56,
      avoidNovelty: true
    },
    lottoBatch: {
      targetMin: 100,
      targetMaxExclusive: Infinity,
      legCounts: [4, 5, 6, 7],
      maxOptions: 10,
      stake: 1,
      buildTags: ["threes-cluster", "star-under-core", "balanced-ladder-style", "role-player-boost", "ceiling-mix"],
      minHitRate: 0.5,
      avoidNovelty: true
    }
  }

  const isNoveltyMarket = (row) => {
    const propType = String(row?.propType || "").toLowerCase()
    if (!propType) return true
    const stable = ["points", "rebounds", "assists", "pra", "threes", "blocks", "steals", "turnovers"]
    return !stable.includes(propType)
  }

  const isHighRiskLeg = (row) => {
    const trendRisk = String(row?.trendRisk || "").toLowerCase()
    const injuryRisk = String(row?.injuryRisk || "").toLowerCase()
    const minutesRisk = String(row?.minutesRisk || "").toLowerCase()
    return trendRisk === "high" || injuryRisk === "high" || minutesRisk === "high"
  }

  const isPayoutBoosterLeg = (row) => {
    const odds = Number(row?.odds || 0)
    const propType = String(row?.propType || "").toLowerCase()
    if (odds > 0) return true
    if (isLadderLeg(row)) return true
    return ["threes", "points", "pra", "rebounds", "assists"].includes(propType)
  }

  const isLadderLeg = (row) => {
    const propTypeRaw = String(row?.propType || "")
    const propType = propTypeRaw.toLowerCase()
    const line = Number(row?.line || 0)
    const odds = Number(row?.odds || 0)
    if (propType.includes("alt")) return true
    if (!Number.isFinite(line)) return false

    const ladderThresholds = {
      points: [15, 20, 25, 30],
      rebounds: [4, 6, 8, 10],
      assists: [3, 5, 7],
      threes: [2, 3, 4, 5],
      pra: [20, 25, 30, 35]
    }

    for (const [market, thresholds] of Object.entries(ladderThresholds)) {
      if (!propType.includes(market)) continue
      if (thresholds.includes(Math.round(line))) return true
      if (odds >= -165 && line >= Math.min(...thresholds)) return true
    }

    return false
  }

  const isCoreLeg = (row) => {
    const hitRate = parseHitRate(row?.hitRate)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || row?.projectedValue || 0)
    return hitRate >= 0.62 && score >= 55 && edge >= 0.25 && !isHighRiskLeg(row)
  }

  const missDistanceScore = (row) => {
    const edge = Number(row?.edge || row?.projectedValue || 0)
    const score = Number(row?.score || 0)
    const valueStd = Math.abs(Number(row?.valueStd || 0))
    const minStd = Math.abs(Number(row?.minStd || 0))
    const volatility = (valueStd + minStd) / 2
    const trendRisk = String(row?.trendRisk || "").toLowerCase()
    const injuryRisk = String(row?.injuryRisk || "").toLowerCase()

    const closeMissBonus = Math.max(0, edge) * 0.45 + Math.max(0, score) / 120
    const volatilityPenalty = Math.min(1.1, volatility / 7.5)
    const hardRiskPenalty = trendRisk === "high" || injuryRisk === "high" ? 0.7 : 0
    const deadMissPenalty = edge < -0.25 ? 0.35 : 0

    return closeMissBonus - volatilityPenalty - hardRiskPenalty - deadMissPenalty
  }

  const scoreRowForLane = (row, lane) => {
    const hitRate = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge || row?.projectedValue || 0)
    const score = Number(row?.score || 0)
    const odds = Number(row?.odds || 0)
    const missScore = missDistanceScore(row)
    const noveltyPenalty = isNoveltyMarket(row) ? 0.3 : 0
    const riskPenalty = isHighRiskLeg(row) ? 0.45 : 0
    const plusMoneyBoost = odds > 0 ? Math.min(0.2, odds / 900) : 0
    const ladderBonus = isLadderLeg(row) ? 0.08 : 0

    if (lane === "recoup") {
      return hitRate * 0.62 + (score / 130) * 0.18 + Math.max(0, edge) * 0.08 + missScore * 0.2 - noveltyPenalty - riskPenalty - plusMoneyBoost * 0.35
    }
    if (lane === "conservative") {
      return hitRate * 0.5 + (score / 130) * 0.2 + Math.max(0, edge) * 0.12 + missScore * 0.2 - noveltyPenalty - riskPenalty
    }
    if (lane === "midUpside") {
      return hitRate * 0.38 + (score / 130) * 0.22 + Math.max(0, edge) * 0.2 + missScore * 0.15 + plusMoneyBoost * 0.1 + ladderBonus - noveltyPenalty * 0.5 - riskPenalty * 0.6
    }
    return hitRate * 0.24 + (score / 130) * 0.22 + Math.max(0, edge) * 0.24 + missScore * 0.13 + plusMoneyBoost * 0.2 + ladderBonus * 1.2 - noveltyPenalty * 0.35 - riskPenalty * 0.45
  }

  const rotateRows = (rows, attempt = 0) => {
    if (!Array.isArray(rows) || rows.length <= 1) return Array.isArray(rows) ? [...rows] : []
    const offset = Math.max(0, attempt) % rows.length
    return [...rows.slice(offset), ...rows.slice(0, offset)]
  }

  const materialSignature = (legs) => (Array.isArray(legs) ? legs : [])
    .map((leg) => `${leg.player || leg.playerName || ""}|${leg.propType || leg.statType || ""}|${leg.side || ""}|${Number(leg.line)}`)
    .sort()
    .join("||")

  const twoLegCoreSignature = (legs) => (Array.isArray(legs) ? legs : [])
    .slice()
    .sort((a, b) => parseHitRate(b?.hitRate) - parseHitRate(a?.hitRate))
    .slice(0, 2)
    .map((leg) => `${leg.player || leg.playerName || ""}|${leg.propType || leg.statType || ""}|${leg.side || ""}|${Number(leg.line)}`)
    .sort()
    .join("||")

  const threeLegCoreSignature = (legs) => (Array.isArray(legs) ? legs : [])
    .slice()
    .sort((a, b) => parseHitRate(b?.hitRate) - parseHitRate(a?.hitRate))
    .slice(0, 3)
    .map((leg) => `${leg.player || leg.playerName || ""}|${leg.propType || leg.statType || ""}|${leg.side || ""}|${Number(leg.line)}`)
    .sort()
    .join("||")

  const makeCandidateFromLegs = (lane, legs, stake, buildTag) => {
    const normalized = dedupeSlipLegs(Array.isArray(legs) ? legs : []).filter(Boolean)
    if (normalized.length < 2) return null
    const price = parlayPriceFromLegs(normalized)
    if (!price) return null
    const projectedReturn = estimateReturn(stake, price.american)
    if (!Number.isFinite(projectedReturn)) return null
    return {
      lane,
      buildTag,
      stake,
      legs: normalized,
      legCount: normalized.length,
      price,
      projectedReturn,
      estimatedProfit: projectedReturn - stake,
      trueProbability: trueParlayProbabilityFromLegs(normalized),
      confidence: confidenceFromLegs(normalized),
      materialSignature: materialSignature(normalized),
      twoLegCore: twoLegCoreSignature(normalized),
      threeLegCore: threeLegCoreSignature(normalized)
    }
  }

  const diversityScoreForCandidate = (candidate) => {
    const legs = Array.isArray(candidate?.legs) ? candidate.legs : []
    if (!legs.length) return -1
    const matchups = legs.map((l) => String(l?.matchup || ""))
    const matchupCounts = matchups.reduce((acc, m) => {
      acc[m] = (acc[m] || 0) + 1
      return acc
    }, {})
    const statCounts = legs.reduce((acc, leg) => {
      const k = String(leg?.propType || leg?.statType || "")
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {})
    const underCount = legs.filter((l) => String(l?.side || "").toLowerCase() === "under").length
    const coreLegs = legs.slice().sort((a, b) => parseHitRate(b?.hitRate) - parseHitRate(a?.hitRate)).slice(0, 3)
    const boosterLegs = legs.filter((l) => isPayoutBoosterLeg(l)).length
    const ladderLegs = legs.filter((l) => isLadderLeg(l)).length
    const oomphLegs = legs.filter((l) => Number(l?.odds || 0) >= 140 || isLadderLeg(l)).length

    const sameGameOverloadPenalty = Object.values(matchupCounts).reduce((n, c) => n + Math.max(0, c - 2), 0) * 0.2
    const statClusterPenalty = Object.values(statCounts).reduce((n, c) => n + Math.max(0, c - 2), 0) * 0.13
    const underHeavyPenalty = underCount >= Math.max(3, Math.ceil(legs.length * 0.7)) ? 0.35 : 0
    const gameBonus = Math.min(0.5, new Set(matchups).size / Math.max(1, legs.length))
    const coreBonus = coreLegs.length
      ? coreLegs.reduce((n, l) => n + parseHitRate(l?.hitRate), 0) / coreLegs.length * 0.22
      : 0
    const payoutBonus = boosterLegs >= 1 && boosterLegs <= 3 ? 0.18 : (boosterLegs > 3 ? 0.05 : 0)
    const oomphBonus = oomphLegs >= 1 ? 0.14 : 0
    const ladderBonus = ladderLegs >= 1 ? 0.09 : 0

    return gameBonus + coreBonus + payoutBonus + oomphBonus + ladderBonus - sameGameOverloadPenalty - statClusterPenalty - underHeavyPenalty
  }

  const optionFromCandidate = (laneLabel, candidate, rank) => ({
    rank,
    label: `${laneLabel} #${rank}`,
    buildTag: candidate.buildTag,
    stake: candidate.stake,
    projectedReturn: Number(candidate.projectedReturn.toFixed(2)),
    estimatedProfit: Number(candidate.estimatedProfit.toFixed(2)),
    oddsAmerican: candidate.price.american,
    oddsDecimal: Number(candidate.price.decimal.toFixed(2)),
    trueProbability: Number((candidate.trueProbability * 100).toFixed(1)),
    confidence: candidate.confidence,
    legCount: candidate.legCount,
    legs: candidate.legs.map((leg) => ({
      playerName: leg.playerName || leg.player,
      statType: leg.statType || leg.propType,
      line: leg.line,
      odds: leg.odds,
      book: leg.book,
      hitRate: leg.hitRate,
      projectedValue: leg.projectedValue || leg.edge
    }))
  })

  const buildLaneCandidates = (lane) => {
    const cfg = laneConfigs[lane]
    const rankedBase = [...safeRows]
      .filter((row) => !cfg.avoidNovelty || !isNoveltyMarket(row))
      .sort((a, b) => scoreRowForLane(b, lane) - scoreRowForLane(a, lane))

    const candidates = []
    const attempts = lane === "lottoBatch" ? 30 : 14

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const ranked = rotateRows(rankedBase, attempt)
      for (const legCount of cfg.legCounts) {
        if (lane === "lottoBatch") {
          const selected = []
          const usedPlayers = new Set()
          const gameCounts = new Map()
          const corePool = ranked.filter((row) => isCoreLeg(row))
          const boosterPool = ranked.filter((row) => isPayoutBoosterLeg(row))
          const coreTarget = legCount >= 6 ? 3 : 2
          const boosterTarget = Math.max(2, Math.min(4, legCount - coreTarget))

          for (const row of corePool) {
            if (selected.length >= coreTarget) break
            const player = String(row?.player || "")
            const matchup = String(row?.matchup || "")
            if (!player || usedPlayers.has(player)) continue
            if (hasConflict(selected, row)) continue
            if ((gameCounts.get(matchup) || 0) >= 2) continue
            selected.push(row)
            usedPlayers.add(player)
            gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
          }

          const usedBuildStyles = new Set(selected.map((r) => String(r?.propType || "").toLowerCase()))
          for (const row of boosterPool) {
            if (selected.length >= legCount) break
            const player = String(row?.player || "")
            const matchup = String(row?.matchup || "")
            const style = String(row?.propType || "").toLowerCase()
            if (!player || usedPlayers.has(player)) continue
            if (hasConflict(selected, row)) continue
            if ((gameCounts.get(matchup) || 0) >= 3) continue

            const allUnder = selected.length >= 2 && selected.every((l) => String(l?.side || "").toLowerCase() === "under")
            const thisUnder = String(row?.side || "").toLowerCase() === "under"
            if (allUnder && thisUnder && boosterPool.some((x) => String(x?.side || "").toLowerCase() !== "under")) {
              console.log("[BOOSTER-LEG-DEBUG]", {
                book,
                lane,
                player,
                propType: row?.propType,
                line: row?.line,
                accepted: false,
                reason: "under-heavy-stack"
              })
              continue
            }

            const styleClustered = usedBuildStyles.has(style)
            if (styleClustered && boosterPool.some((x) => String(x?.propType || "").toLowerCase() !== style)) {
              console.log("[BOOSTER-LEG-DEBUG]", {
                book,
                lane,
                player,
                propType: row?.propType,
                line: row?.line,
                accepted: false,
                reason: "style-clustered"
              })
              continue
            }

            selected.push(row)
            usedPlayers.add(player)
            usedBuildStyles.add(style)
            gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
            console.log("[BOOSTER-LEG-DEBUG]", {
              book,
              lane,
              player,
              propType: row?.propType,
              line: row?.line,
              accepted: true,
              reason: isLadderLeg(row) ? "ladder-booster" : "payout-booster"
            })
            if (selected.length >= coreTarget + boosterTarget) break
          }

          if (selected.length < Math.max(4, coreTarget + 2)) {
            console.log("[LOTTO-BATCH-DEBUG]", {
              book,
              lane,
              legCount,
              accepted: false,
              reason: "insufficient-core-booster-legs",
              selectedLen: selected.length
            })
            continue
          }

          const ladderCount = selected.filter((row) => isLadderLeg(row)).length
          console.log("[LADDER-DETECT-DEBUG]", {
            book,
            lane,
            legCount,
            ladderCount,
            accepted: true,
            reason: ladderCount > 0 ? "ladder-present" : "no-ladder"
          })

          const buildTag = cfg.buildTags[(attempt + legCount + ladderCount) % cfg.buildTags.length]
          const candidate = makeCandidateFromLegs(lane, selected.slice(0, legCount), cfg.stake, buildTag)
          if (!candidate) {
            console.log("[LOTTO-BATCH-DEBUG]", {
              book,
              lane,
              legCount,
              accepted: false,
              reason: "candidate-null"
            })
            continue
          }
          if (candidate.projectedReturn < cfg.targetMin || candidate.projectedReturn >= cfg.targetMaxExclusive) {
            console.log("[LOTTO-BATCH-DEBUG]", {
              book,
              lane,
              legCount,
              accepted: false,
              reason: "target-window-miss",
              projectedReturn: candidate.projectedReturn
            })
            continue
          }
          candidates.push(candidate)
          continue
        }

        const selected = []
        const usedPlayers = new Set()
        const gameCounts = new Map()
        let boosterCount = 0

        for (const row of ranked) {
          if (selected.length >= legCount) break
          const player = String(row?.player || "")
          const matchup = String(row?.matchup || "")
          if (!player || usedPlayers.has(player)) continue
          if (hasConflict(selected, row)) continue

          const maxPerGame = lane === "lottoBatch" ? 3 : 2
          if ((gameCounts.get(matchup) || 0) >= maxPerGame) continue

          if (isHighRiskLeg(row)) continue
          if (parseHitRate(row.hitRate) < cfg.minHitRate) continue

          const booster = isPayoutBoosterLeg(row)
          if (lane === "conservative" && booster && boosterCount >= (cfg.maxBooster || 0)) continue
          if (lane === "midUpside" && booster && boosterCount >= (cfg.maxBooster || 2)) continue

          if (lane === "recoup" && booster) continue
          if (lane === "recoup" && Number(row?.edge || row?.projectedValue || 0) < 0.2) continue

          selected.push(row)
          usedPlayers.add(player)
          gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
          if (booster) boosterCount += 1
        }

        if (selected.length < legCount) continue
        if (lane === "lottoBatch" && boosterCount < 1) continue

        const buildTag = cfg.buildTags[(attempt + legCount) % cfg.buildTags.length]
        const candidate = makeCandidateFromLegs(lane, selected, cfg.stake, buildTag)
        if (!candidate) continue

        const ladderCount = selected.filter((row) => isLadderLeg(row)).length
        if (lane === "midUpside") {
          console.log("[LADDER-DETECT-DEBUG]", {
            book,
            lane,
            legCount,
            ladderCount,
            accepted: true,
            reason: ladderCount > 0 ? "ladder-present" : "no-ladder"
          })
        }

        if (candidate.projectedReturn < cfg.targetMin || candidate.projectedReturn >= cfg.targetMaxExclusive) continue
        candidates.push(candidate)
      }
    }

    if (Array.isArray(highestHitSlipObjects) && lane !== "lottoBatch") {
      for (const slip of highestHitSlipObjects) {
        if (!slip || !Array.isArray(slip.legs)) continue
        const buildTag = cfg.buildTags[0]
        const candidate = makeCandidateFromLegs(lane, slip.legs, cfg.stake, buildTag)
        if (!candidate) continue
        if (!cfg.legCounts.includes(candidate.legCount)) continue
        if (candidate.projectedReturn < cfg.targetMin || candidate.projectedReturn >= cfg.targetMaxExclusive) continue
        candidates.push(candidate)
      }
    }

    console.log("[LANE-BUILD-DEBUG]", {
      book,
      lane,
      sourceRows: safeRows.length,
      candidateCount: candidates.length
    })

    return candidates
  }

  const selectTopCandidates = (lane, candidates) => {
    const cfg = laneConfigs[lane]
    const byMaterial = new Map()
    for (const c of candidates || []) {
      const existing = byMaterial.get(c.materialSignature)
      if (!existing || c.trueProbability > existing.trueProbability) {
        byMaterial.set(c.materialSignature, c)
      }
    }

    const ranked = [...byMaterial.values()].sort((a, b) => {
      const aD = diversityScoreForCandidate(a)
      const bD = diversityScoreForCandidate(b)
      const aScore = a.trueProbability * 0.58 + aD * 0.42
      const bScore = b.trueProbability * 0.58 + bD * 0.42
      if (bScore !== aScore) return bScore - aScore
      return b.projectedReturn - a.projectedReturn
    })

    if (lane !== "lottoBatch") return ranked.slice(0, cfg.maxOptions)

    const selected = []
    const twoCoreCounts = new Map()
    const threeCoreCounts = new Map()
    const playerExposure = new Map()
    const maxPlayerExposure = 5

    for (const candidate of ranked) {
      if (selected.length >= cfg.maxOptions) break
      const core2 = candidate.twoLegCore || ""
      const core3 = candidate.threeLegCore || ""
      if ((twoCoreCounts.get(core2) || 0) >= 2) {
        console.log("[PORTFOLIO-DIVERSITY-DEBUG]", {
          book,
          lane,
          materialSignature: candidate.materialSignature,
          diversity: diversityScoreForCandidate(candidate),
          accepted: false,
          reason: "two-leg-core-cap"
        })
        console.log("[LOTTO-BATCH-DEBUG]", {
          book,
          lane,
          accepted: false,
          reason: "two-leg-core-cap",
          core: core2
        })
        continue
      }
      if ((threeCoreCounts.get(core3) || 0) >= 2) {
        console.log("[PORTFOLIO-DIVERSITY-DEBUG]", {
          book,
          lane,
          materialSignature: candidate.materialSignature,
          diversity: diversityScoreForCandidate(candidate),
          accepted: false,
          reason: "three-leg-core-cap"
        })
        console.log("[LOTTO-BATCH-DEBUG]", {
          book,
          lane,
          accepted: false,
          reason: "three-leg-core-cap",
          core: core3
        })
        continue
      }

      let overCap = false
      for (const leg of candidate.legs) {
        const player = String(leg.player || leg.playerName || "")
        if ((playerExposure.get(player) || 0) >= maxPlayerExposure) {
          overCap = true
          break
        }
      }
      if (overCap) {
        console.log("[PORTFOLIO-DIVERSITY-DEBUG]", {
          book,
          lane,
          materialSignature: candidate.materialSignature,
          diversity: diversityScoreForCandidate(candidate),
          accepted: false,
          reason: "player-exposure-cap"
        })
        console.log("[LOTTO-BATCH-DEBUG]", {
          book,
          lane,
          accepted: false,
          reason: "player-exposure-cap"
        })
        continue
      }

      const diversity = diversityScoreForCandidate(candidate)
      console.log("[PORTFOLIO-DIVERSITY-DEBUG]", {
        book,
        lane,
        materialSignature: candidate.materialSignature,
        diversity,
        accepted: true,
        reason: "selected"
      })

      selected.push(candidate)
      twoCoreCounts.set(core2, (twoCoreCounts.get(core2) || 0) + 1)
      threeCoreCounts.set(core3, (threeCoreCounts.get(core3) || 0) + 1)
      for (const leg of candidate.legs) {
        const player = String(leg.player || leg.playerName || "")
        playerExposure.set(player, (playerExposure.get(player) || 0) + 1)
      }

      console.log("[LOTTO-BATCH-DEBUG]", {
        book,
        lane,
        accepted: true,
        reason: "selected",
        legCount: candidate.legCount,
        buildTag: candidate.buildTag
      })
    }

    console.log("[LOTTO-BATCH-DEBUG]", {
      book,
      requested: cfg.maxOptions,
      selected: selected.length,
      uniqueCores: twoCoreCounts.size,
      uniquePlayers: playerExposure.size
    })

    return selected
  }

  const recoupSelected = selectTopCandidates("recoup", buildLaneCandidates("recoup"))
  const conservativeSelected = selectTopCandidates("conservative", buildLaneCandidates("conservative"))
  const midUpsideSelected = selectTopCandidates("midUpside", buildLaneCandidates("midUpside"))
  const lottoBatchSelected = selectTopCandidates("lottoBatch", buildLaneCandidates("lottoBatch"))

  console.log("[LANE-SELECTION-SUMMARY]", {
    book,
    recoup: recoupSelected.length,
    conservative: conservativeSelected.length,
    midUpside: midUpsideSelected.length,
    lottoBatch: lottoBatchSelected.length
  })

  return {
    recoupPortfolio: {
      options: recoupSelected.map((c, idx) => optionFromCandidate("Recoup", c, idx + 1))
    },
    conservativePortfolio: {
      options: conservativeSelected.map((c, idx) => optionFromCandidate("Conservative", c, idx + 1))
    },
    midUpsidePortfolio: {
      options: midUpsideSelected.map((c, idx) => optionFromCandidate("Mid Upside", c, idx + 1))
    },
    lottoBatchPortfolio: {
      options: lottoBatchSelected.map((c, idx) => optionFromCandidate("Lotto Batch", c, idx + 1))
    }
  }
}

function buildHighestHitRateBookSlip(book, targetLegCount, sourceRowsOverride = null) {
  const isFanDuel = book === "FanDuel"
  const overrideRowsForBook = Array.isArray(sourceRowsOverride)
    ? sortRowsForMLHighestHitRate(sourceRowsOverride.filter((r) => r.book === book))
    : null
  const rankedRows = dedupeByLegSignature(overrideRowsForBook || [])
  const allowDraftKingsHighLegCoreFallback = Boolean(overrideRowsForBook && book === "DraftKings" && targetLegCount >= 5)

  const getCandidatePoolForBook = () => {
    if (Array.isArray(overrideRowsForBook) && overrideRowsForBook.length) {
      return dedupeByLegSignature(overrideRowsForBook)
    }

    return dedupeByLegSignature(
      sortRowsForMLHighestHitRate([
        ...((oddsSnapshot.eliteProps || []).filter((r) => r.book === book)),
        ...((oddsSnapshot.strongProps || []).filter((r) => r.book === book)),
        ...((oddsSnapshot.playableProps || []).filter((r) => r.book === book)),
        ...((oddsSnapshot.bestProps || []).filter((r) => r.book === book))
      ])
    )
  }

  const sourcePoolRows = getCandidatePoolForBook()
  const sourceRowCount = sourcePoolRows.length
  const usablePoolRows = dedupeByLegSignature(
    sourcePoolRows.filter((row) => !shouldRemoveLegForPlayerStatus(row))
  )
  const usableRowCount = usablePoolRows.length
  const uniqueGames = new Set(
    usablePoolRows
      .map((row) => String(row?.matchup || ""))
      .filter(Boolean)
  ).size
  const isThinOrSingleGamePool = uniqueGames <= 1 || usableRowCount < 40

  const legRiskPenalty = (row) => {
    const minutesRisk = String(row?.minutesRisk || "").toLowerCase()
    const injuryRisk = String(row?.injuryRisk || "").toLowerCase()
    const trendRisk = String(row?.trendRisk || "").toLowerCase()
    let penalty = 0
    if (minutesRisk === "high") penalty += 2
    else if (minutesRisk === "medium") penalty += 1
    if (injuryRisk === "high") penalty += 2
    else if (injuryRisk === "medium") penalty += 1
    if (trendRisk === "high") penalty += 2
    else if (trendRisk === "medium") penalty += 1
    return penalty
  }

  const buildRelaxedSingleGameSafeSlip = () => {
    const candidates = [...usablePoolRows].sort((a, b) => {
      const aHitRate = parseHitRate(a.hitRate)
      const bHitRate = parseHitRate(b.hitRate)
      if (bHitRate !== aHitRate) return bHitRate - aHitRate

      const aEdge = Number(a.edge ?? a.projectedValue ?? 0)
      const bEdge = Number(b.edge ?? b.projectedValue ?? 0)
      if (bEdge !== aEdge) return bEdge - aEdge

      const aScore = Number(a.score || 0)
      const bScore = Number(b.score || 0)
      if (bScore !== aScore) return bScore - aScore

      const aRiskPenalty = legRiskPenalty(a)
      const bRiskPenalty = legRiskPenalty(b)
      if (aRiskPenalty !== bRiskPenalty) return aRiskPenalty - bRiskPenalty

      const aFragile = isFragileLeg(a) ? 1 : 0
      const bFragile = isFragileLeg(b) ? 1 : 0
      return aFragile - bFragile
    })

    const result = []
    const usedPlayers = new Set()
    const usedSignatures = new Set()

    for (const row of candidates) {
      if (!row) continue
      const player = String(row.player || row.playerName || "")
      const propType = String(row.propType || row.statType || "")
      const side = String(row.side || "")
      const line = Number(row.line)
      const signature = `${player}|${propType}|${side}|${line}`

      if (!player) continue
      if (usedPlayers.has(player)) continue
      if (usedSignatures.has(signature)) continue
      if (hasConflict(result, row)) continue

      result.push(row)
      usedPlayers.add(player)
      usedSignatures.add(signature)
      if (result.length >= targetLegCount) break
    }

    return result
  }

  const finalizeHighestHitRateBuild = (rows, options = {}) => {
    const strictRows = Array.isArray(rows)
      ? dedupeSlipLegs(rows).filter((row) => !shouldRemoveLegForPlayerStatus(row))
      : []

    const strictSucceeded = strictRows.length === targetLegCount
    const relaxedRows = !strictSucceeded && isThinOrSingleGamePool
      ? dedupeSlipLegs(buildRelaxedSingleGameSafeSlip()).filter((row) => !shouldRemoveLegForPlayerStatus(row))
      : []
    const relaxedSucceeded = relaxedRows.length === targetLegCount
    const finalRows = strictSucceeded ? strictRows : (relaxedSucceeded ? relaxedRows : [])

    console.log("[HIGHEST-HIT-RATE-BUILD-DEBUG]", {
      book,
      requestedLegs: targetLegCount,
      sourceRowCount,
      usableRowCount,
      uniqueGames,
      strictSucceeded,
      relaxedSucceeded,
      finalLegCount: finalRows.length
    })
    return finalRows.length === targetLegCount ? finalRows : null
  }

  function getHighLegLateRejectReason(row, legIndex, options = {}) {
    if (!row || targetLegCount < 5 || legIndex <= 3) return ""

    const relaxedLaterFill = Boolean(options?.relaxedLaterFill)
    const finalQualityPass = Boolean(options?.finalQualityPass)
    const hitRate = parseHitRate(row.hitRate)
    const score = Number(row.score || 0)
    const edge = Number(row.edge ?? row.projectedValue ?? 0)
    const trendRisk = String(row.trendRisk || "").toLowerCase()
    const injuryRisk = String(row.injuryRisk || "").toLowerCase()
    const minutesRisk = String(row.minutesRisk || "").toLowerCase()

    if (trendRisk === "high") return "later-fill-trendRisk-high"
    if (injuryRisk === "high") return "later-fill-injuryRisk-high"
    if (minutesRisk === "high") return "later-fill-minutesRisk-high"

    let minHitRate = 0.65
    let minScore = 35
    let minEdge = 0

    if (book === "FanDuel") {
      if (legIndex === 4) {
        minHitRate = finalQualityPass ? 0.63 : (relaxedLaterFill ? 0.62 : 0.65)
        minScore = finalQualityPass ? 30 : (relaxedLaterFill ? 28 : 35)
        minEdge = finalQualityPass ? -0.1 : (relaxedLaterFill ? -0.25 : 0)
      } else {
        minHitRate = finalQualityPass ? 0.65 : (relaxedLaterFill ? 0.64 : 0.66)
        minScore = finalQualityPass ? 34 : (relaxedLaterFill ? 32 : 38)
        minEdge = 0
      }
    } else {
      minHitRate = relaxedLaterFill ? 0.58 : 0.65
      minScore = relaxedLaterFill ? 20 : 35
      minEdge = relaxedLaterFill ? -1 : 0
    }

    if (edge < minEdge) return finalQualityPass ? "final-late-edge-floor" : "later-fill-edge-floor"
    if (score < minScore) return finalQualityPass ? "final-late-score-floor" : "later-fill-score-floor"
    if (hitRate < minHitRate) return finalQualityPass ? "final-late-hitRate-floor" : "later-fill-hitRate-floor"

    return ""
  }

  function pruneWeakLateLegs(rows, phase = "") {
    if (!isFanDuel || targetLegCount < 5) return rows
    if (!Array.isArray(rows) || rows.length < 4) return rows

    const kept = []
    const rejectCounts = {}

    for (const [index, row] of dedupeSlipLegs(rows).entries()) {
      const rejectReason = getHighLegLateRejectReason(row, index + 1, {
        relaxedLaterFill: true,
        finalQualityPass: true
      })

      if (rejectReason) {
        rejectCounts[rejectReason] = (rejectCounts[rejectReason] || 0) + 1
        continue
      }

      kept.push(row)
    }

    if (Object.keys(rejectCounts).length) {
      console.log("[HIGHLEG-LATE-REJECT-DEBUG]", {
        book,
        targetLegCount,
        phase,
        before: Array.isArray(rows) ? rows.length : 0,
        after: kept.length,
        rejectCounts
      })
    }

    return kept
  }

  if (Array.isArray(sourceRowsOverride)) {
    console.log("[DUAL-OVERRIDE-SOURCE-DEBUG]", {
      book,
      targetLegCount,
      overrideCount: sourceRowsOverride.filter((r) => r.book === book).length
    })

    const logDeepFillReject = (row, reason) => {
      console.log("[DEEP-FILL-REJECT-DEBUG]", {
        book,
        targetLegCount,
        player: row.player,
        propType: row.propType,
        line: row.line,
        hitRate: row.hitRate,
        score: row.score,
        edge: row.edge,
        trendRisk: row.trendRisk,
        injuryRisk: row.injuryRisk,
        reason
      })
    }

    const buildOverrideResult = (maxPerGame, options = {}) => {
      const relaxedLaterFill = Boolean(options?.relaxedLaterFill)
      const result = []
      const usedPlayers = new Set()
      const usedConflictKeys = new Set()
      const usedSignatures = new Set()
      const gameCounts = new Map()
      const slotAvailability = {}
      const thresholdRejectCounts = {}
      const conflictRejectCounts = {}

      const noteThresholdReject = (reason) => {
        thresholdRejectCounts[reason] = (thresholdRejectCounts[reason] || 0) + 1
      }

      const noteConflictReject = (reason) => {
        conflictRejectCounts[reason] = (conflictRejectCounts[reason] || 0) + 1
      }

      const countAvailableForSlot = (slotIndex) => {
        return rankedRows.filter((candidate) => {
          if (!candidate || shouldRemoveLegForPlayerStatus(candidate)) return false

          const player = String(candidate.player || candidate.playerName || "")
          const propType = String(candidate.propType || candidate.statType || "")
          const side = String(candidate.side || "")
          const line = Number(candidate.line)
          const matchup = String(candidate.matchup || "")
          const legSignature = `${player}|${propType}|${side}|${line}`
          const conflictKey = `${player}|${propType}|${side}`

          if (!player) return false
          if (usedPlayers.has(player)) return false
          if (usedConflictKeys.has(conflictKey)) return false
          if (usedSignatures.has(legSignature)) return false
          if ((gameCounts.get(matchup) || 0) >= maxPerGame) return false
          if (hasConflict(result, candidate)) return false

          if (slotIndex <= 3) {
            const candidateHitRate = parseHitRate(candidate.hitRate)
            const candidateScore = Number(candidate.score || 0)
            const candidateEdge = Number(candidate.edge || candidate.projectedValue || 0)
            return candidateHitRate >= 0.62 && candidateScore >= 45 && candidateEdge >= 0
          }

          return !getHighLegLateRejectReason(candidate, slotIndex, { relaxedLaterFill })
        }).length
      }

      for (const row of rankedRows) {
        if (!row || shouldRemoveLegForPlayerStatus(row)) continue

        const player = String(row.player || row.playerName || "")
        const propType = String(row.propType || row.statType || "")
        const side = String(row.side || "")
        const line = Number(row.line)
        const matchup = String(row.matchup || "")
        const legSignature = `${player}|${propType}|${side}|${line}`
        const conflictKey = `${player}|${propType}|${side}`

        if (!player) continue
        if (usedPlayers.has(player)) {
          noteConflictReject("used-player")
          continue
        }
        if (usedConflictKeys.has(conflictKey)) {
          noteConflictReject("conflict-key")
          continue
        }
        if (usedSignatures.has(legSignature)) {
          noteConflictReject("duplicate-signature")
          continue
        }
        if ((gameCounts.get(matchup) || 0) >= maxPerGame) {
          noteConflictReject("max-per-game")
          continue
        }

        const nextLegIndex = result.length + 1
        const hitRate = parseHitRate(row.hitRate)
        const score = Number(row.score || 0)
        const edge = Number(row.edge || 0)

        if (slotAvailability[nextLegIndex] == null) {
          slotAvailability[nextLegIndex] = countAvailableForSlot(nextLegIndex)
        }

        if (nextLegIndex <= 3) {
          // Lowered floors so thin FD pool can still build a core
          if (hitRate < 0.62) {
            noteThresholdReject("legs1to3-hitRate-floor")
            logDeepFillReject(row, "legs1to3-hitRate-floor")
            continue
          }
          if (score < 45) {
            noteThresholdReject("legs1to3-score-floor")
            logDeepFillReject(row, "legs1to3-score-floor")
            continue
          }
          if (edge < 0) {
            noteThresholdReject("legs1to3-edge-floor")
            logDeepFillReject(row, "legs1to3-edge-floor")
            continue
          }
        } else if (targetLegCount >= 5) {
          const rejectReason = getHighLegLateRejectReason(row, nextLegIndex, { relaxedLaterFill })
          if (rejectReason) {
            noteThresholdReject(rejectReason)
            logDeepFillReject(row, rejectReason)
            continue
          }
        } else if (nextLegIndex === 4) {
          if (hitRate < 0.65) {
            logDeepFillReject(row, "leg4-hitRate-floor")
            continue
          }
          if (score < 55) {
            logDeepFillReject(row, "leg4-score-floor")
            continue
          }
          if (edge < 0) {
            logDeepFillReject(row, "leg4-edge-floor")
            continue
          }
        } else {
          if (trendRisk === "high") {
            logDeepFillReject(row, "legs5plus-trendRisk-high")
            continue
          }
          if (injuryRisk === "high") {
            logDeepFillReject(row, "legs5plus-injuryRisk-high")
            continue
          }
          if (edge < 0) {
            logDeepFillReject(row, "legs5plus-edge-floor")
            continue
          }
          if (score < 40) {
            logDeepFillReject(row, "legs5plus-score-floor")
            continue
          }
          if (hitRate < 0.6) {
            logDeepFillReject(row, "legs5plus-hitRate-floor")
            continue
          }
        }

        if (targetLegCount >= 5) {
          const existingFromGame = gameCounts.get(matchup) || 0
          const repeatedUnderSameGame =
            String(side || "").toLowerCase() === "under" &&
            result.some((leg) =>
              String(leg.matchup || "") === matchup &&
              String(leg.side || "").toLowerCase() === "under"
            )

          if (existingFromGame > 0 || repeatedUnderSameGame) {
            const hasAlternative = rankedRows.some((alt) => {
              const altPlayer = String(alt.player || alt.playerName || "")
              const altPropType = String(alt.propType || alt.statType || "")
              const altSide = String(alt.side || "")
              const altLine = Number(alt.line)
              const altMatchup = String(alt.matchup || "")
              const altSignature = `${altPlayer}|${altPropType}|${altSide}|${altLine}`
              const altConflictKey = `${altPlayer}|${altPropType}|${altSide}`

              if (!altPlayer) return false
              if (usedPlayers.has(altPlayer)) return false
              if (usedConflictKeys.has(altConflictKey)) return false
              if (usedSignatures.has(altSignature)) return false
              if ((gameCounts.get(altMatchup) || 0) >= maxPerGame) return false
              if (hasConflict(result, alt)) return false

              const altIsRepeatedUnderSameGame =
                String(altSide || "").toLowerCase() === "under" &&
                result.some((leg) =>
                  String(leg.matchup || "") === altMatchup &&
                  String(leg.side || "").toLowerCase() === "under"
                )
              if (altIsRepeatedUnderSameGame) return false

              // Soft preference: if we can find a fresh-game option with comparable quality,
              // avoid stacking another leg from an already represented game.
              const altScore = Number(alt.score || 0)
              const altHitRate = parseHitRate(alt.hitRate)
              if (existingFromGame > 0 && altMatchup !== matchup) {
                return altScore >= (score - 8) && altHitRate >= (hitRate - 0.05)
              }

              return repeatedUnderSameGame && altMatchup !== matchup
            })

            if (hasAlternative) {
              if (repeatedUnderSameGame) {
                noteConflictReject("same-game-under-deprioritized")
                logDeepFillReject(row, "same-game-under-deprioritized")
              } else {
                noteConflictReject("same-game-soft-penalty")
                logDeepFillReject(row, "same-game-soft-penalty")
              }
              continue
            }
          }
        }

        result.push(row)
        usedPlayers.add(player)
        usedConflictKeys.add(conflictKey)
        usedSignatures.add(legSignature)
        gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)

        if (result.length >= targetLegCount) break
      }

      if (targetLegCount >= 5) {
        console.log("[HIGHLEG-SLOT-POOL-DEBUG]", {
          book,
          targetLegCount,
          maxPerGame,
          relaxedLaterFill,
          slotAvailability
        })
        console.log("[HIGHLEG-LATE-REJECT-DEBUG]", {
          book,
          targetLegCount,
          maxPerGame,
          relaxedLaterFill,
          thresholdRejectCounts,
          conflictRejectCounts
        })
      }

      return { result, usedPlayers, usedConflictKeys, usedSignatures, slotAvailability, thresholdRejectCounts, conflictRejectCounts }
    }

    const firstPassMaxPerGame = targetLegCount >= 5 ? 2 : (targetLegCount >= 4 ? 3 : 2)
    let {
      result,
      usedPlayers,
      usedConflictKeys,
      usedSignatures,
      slotAvailability,
      thresholdRejectCounts,
      conflictRejectCounts
    } = buildOverrideResult(firstPassMaxPerGame, { relaxedLaterFill: false })

    if (targetLegCount >= 5) {
      console.log("[DEEP-RECOVERY-DEBUG]", {
        book,
        targetLegCount,
        phase: "strict-pass",
        resultLen: result.length,
        maxPerGame: firstPassMaxPerGame
      })
    }

    let overrideFallbackMaxPerGame = firstPassMaxPerGame

    if (targetLegCount >= 5 && result.length < targetLegCount) {
      ({
        result,
        usedPlayers,
        usedConflictKeys,
        usedSignatures,
        slotAvailability,
        thresholdRejectCounts,
        conflictRejectCounts
      } = buildOverrideResult(3, { relaxedLaterFill: true }))
      overrideFallbackMaxPerGame = 3

      console.log("[DEEP-RECOVERY-DEBUG]", {
        book,
        targetLegCount,
        phase: "fallback-pass",
        resultLen: result.length,
        maxPerGame: 3
      })
    }

    if (targetLegCount >= 5 && result.length < targetLegCount) {
      ({
        result,
        usedPlayers,
        usedConflictKeys,
        usedSignatures,
        slotAvailability,
        thresholdRejectCounts,
        conflictRejectCounts
      } = buildOverrideResult(4, { relaxedLaterFill: true }))
      overrideFallbackMaxPerGame = 4

      console.log("[DEEP-RECOVERY-DEBUG]", {
        book,
        targetLegCount,
        phase: "final-fallback-pass",
        resultLen: result.length,
        maxPerGame: 4
      })
    }

    if (targetLegCount >= 5) {
      console.log("[HIGHLEG-MAXPERGAME-DEBUG]", {
        book,
        targetLegCount,
        chosenMaxPerGame: result.length >= targetLegCount ? overrideFallbackMaxPerGame : null
      })
    }

    console.log("[OVERRIDE-BUILD-RESULT]", {
      book,
      targetLegCount,
      builtLen: result.length,
      players: result.map(r => r.player || r.playerName),
      props: result.map(r => `${r.player || r.playerName} ${r.propType} ${r.line}`)
    })

    console.log("[OVERRIDE-BUILD-QUALITY-DEBUG]", {
      book,
      targetLegCount,
      builtLen: result.length,
      minHitRate: result.length ? Math.min(...result.map(r => parseHitRate(r.hitRate))) : null,
      minScore: result.length ? Math.min(...result.map(r => Number(r.score || 0))) : null,
      minEdge: result.length ? Math.min(...result.map(r => Number(r.edge || 0))) : null
    })

    if (targetLegCount >= 5 && result.length >= 2) {
      const matchupCounts = result.reduce((acc, row) => {
        const key = String(row.matchup || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
      const lowHitRateLegs = result.filter((row) => parseHitRate(row.hitRate) < 0.75).length
      console.log("[DEEP-SLIP-QUALITY-DEBUG]", {
        book,
        targetLegCount,
        matchupCounts,
        lowHitRateLegs,
        minHitRate: Math.min(...result.map((r) => parseHitRate(r.hitRate))),
        minScore: Math.min(...result.map((r) => Number(r.score || 0))),
        minEdge: Math.min(...result.map((r) => Number(r.edge || 0)))
      })
    }

    if (book === "FanDuel" && targetLegCount >= 6 && result.length < targetLegCount) {
      console.log("[FD-DEEP-NULL-DEBUG]", {
        stage: "override-shortfall",
        book,
        targetLegCount,
        rankedCount: rankedRows.length,
        resultLen: result.length,
        usedPlayers: usedPlayers.size,
        usedConflictKeys: usedConflictKeys.size,
        usedSignatures: usedSignatures.size
      })
    }

    if (book === "FanDuel" && targetLegCount >= 6 && result.length < 2) {
      console.log("[FD-DEEP-NULL-DEBUG]", {
        stage: "override-return-empty",
        book,
        targetLegCount,
        rankedCount: rankedRows.length,
        resultLen: result.length,
        usedPlayers: usedPlayers.size,
        usedConflictKeys: usedConflictKeys.size,
        usedSignatures: usedSignatures.size
      })
    }

    const diversifiedResult = targetLegCount >= 5
      ? pruneWeakLateLegs(diversifyHighLegFinalLeg(result), "override-final")
      : result

    if (allowDraftKingsHighLegCoreFallback && diversifiedResult.length < targetLegCount) {
      console.log("[DK-HIGHLEG-FAIL-DEBUG]", {
        book,
        targetLegCount,
        stage: "override-underfilled",
        rankedCount: rankedRows.length,
        resultLen: diversifiedResult.length,
        slotAvailability,
        thresholdRejectCounts,
        conflictRejectCounts,
        bandFitRejected: false,
        fallbackLogic: "core-builder-enabled"
      })
    } else {
      return finalizeHighestHitRateBuild(diversifiedResult)
    }
  }

  const useOverrideOnly = Boolean(overrideRowsForBook) && !allowDraftKingsHighLegCoreFallback

  const elite = useOverrideOnly ? [] : sortRowsForMLHighestHitRate(
    ((oddsSnapshot.eliteProps || []).filter((r) => r.book === book))
  )
  const strong = useOverrideOnly ? [] : sortRowsForMLHighestHitRate(
    ((oddsSnapshot.strongProps || []).filter((r) => r.book === book))
  )
  const playable = useOverrideOnly ? [] : sortRowsForMLHighestHitRate(
    ((oddsSnapshot.playableProps || []).filter((r) => r.book === book))
  )
  const bestBookMatched = useOverrideOnly ? overrideRowsForBook : sortRowsForMLHighestHitRate(
    ((oddsSnapshot.bestProps || []).filter((r) => r.book === book))
  )

  console.log(`[DUAL-DEBUG] buildHighestHitRateBookSlip(${book}, ${targetLegCount}) - elite:${elite.length} strong:${strong.length} playable:${playable.length}`)

  const sources = useOverrideOnly ? [overrideRowsForBook] : [elite, strong, playable]
  const shared = {
    maxPerPlayer: 1,
    maxPerGame: targetLegCount >= 5 ? 2 : 1,
    preferredBook: book,
    forceUniquePlayers: true,
    blockSameGameStatSide: true,
    allowedPropTypes: targetLegCount >= 5 ? null : ["Points", "Rebounds", "Assists", "Threes"]
  }

  let usedBestPropsFill = 0
  const maybeAddBestPropsFill = (rows, options = {}) => {
    const {
      target = targetLegCount,
      maxPerGame = 3,
      blockSameGameStatSide = false,
      allowedPropTypes = ["Points", "Rebounds", "Assists", "Threes", "PRA"]
    } = options

    const base = Array.isArray(rows) ? dedupeSlipLegs(rows) : []
    if (base.length >= target) return base

    const gameCounts = new Map()
    const usedPlayers = new Set()
    for (const leg of base) {
      const player = String(leg.player || "")
      const matchup = String(leg.matchup || "")
      if (player) usedPlayers.add(player)
      if (matchup) gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
    }

    for (const row of bestBookMatched) {
      if (base.length >= target) break
      const player = String(row.player || "")
      const matchup = String(row.matchup || "")
      const propType = String(row.propType || "")
      const slotIndex = base.length + 1
      if (!player || usedPlayers.has(player)) continue
      if (!allowedPropTypes.includes(propType)) continue
      if ((gameCounts.get(matchup) || 0) >= maxPerGame) continue
      if (hasConflict(base, row)) continue
      if (blockSameGameStatSide && hasSameGameStatSide(base, row)) continue
      if (targetLegCount >= 5) {
        const lateRejectReason = getHighLegLateRejectReason(row, slotIndex, {
          relaxedLaterFill: true,
          finalQualityPass: true
        })
        if (lateRejectReason) continue
      }

      base.push(row)
      usedPlayers.add(player)
      gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
      usedBestPropsFill += 1
      break
    }

    return dedupeSlipLegs(base)
  }

  const logBuilderDepth = (result) => {
    const maxSameGame = Array.isArray(result) && result.length
      ? Math.max(...Object.values(result.reduce((acc, leg) => {
          const key = String(leg?.matchup || "unknown")
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})))
      : 0
    console.log(`[BUILDER-DEPTH-DEBUG] book=${book} targetLegCount=${targetLegCount} resultLength=${Array.isArray(result) ? result.length : 0}`)
    console.log(`[FD-BUILDER-DEPTH-DEBUG] book=${book} targetLegCount=${targetLegCount} resultLength=${Array.isArray(result) ? result.length : 0} sourceCounts elite=${elite.length} strong=${strong.length} playable=${playable.length}`)
    console.log(`[DEPTH-FILL-DEBUG] book=${book} target=${targetLegCount} finalLength=${Array.isArray(result) ? result.length : 0} usedBestPropsFill=${usedBestPropsFill}`)
    if (targetLegCount >= 5) {
      console.log("[HIGHLEG-MAXPERGAME-DEBUG]", {
        book,
        targetLegCount,
        chosenMaxPerGame: maxSameGame || null
      })
    }
  }

  function diversifyHighLegFinalLeg(rows) {
    if (!isFanDuel || targetLegCount < 5) return rows
    if (!Array.isArray(rows) || rows.length < targetLegCount) return rows

    const base = dedupeSlipLegs(rows).slice(0, targetLegCount)
    if (base.length < targetLegCount) return rows

    const lateStart = Math.min(3, Math.max(0, base.length - 2))
    const weakestLateIndex = base
      .map((leg, idx) => ({ idx, score: Number(leg?.score || 0) }))
      .filter((x) => x.idx >= lateStart)
      .sort((a, b) => a.score - b.score)[0]?.idx
    if (!Number.isInteger(weakestLateIndex)) return rows

    const weakest = base[weakestLateIndex]
    const fixed = base.filter((_, idx) => idx !== weakestLateIndex)
    const usedPlayers = new Set(fixed.map((leg) => String(leg.player || "")))
    const usedSignatures = new Set(fixed.map((leg) => `${leg.player}|${leg.propType}|${leg.side}|${Number(leg.line)}`))
    const gameCounts = new Map()
    for (const leg of fixed) {
      const matchup = String(leg.matchup || "")
      gameCounts.set(matchup, (gameCounts.get(matchup) || 0) + 1)
    }

    const basePrice = parlayPriceFromLegs(base)
    const baseReturn = basePrice ? estimateReturn(5, basePrice.american) : 0

    let attempts = 0
    let accepted = false
    let bestRows = rows
    let bestScore = -Infinity

    for (const alt of rankedRows) {
      if (!alt || shouldRemoveLegForPlayerStatus(alt) || isFragileLeg(alt)) continue
      const player = String(alt.player || "")
      const matchup = String(alt.matchup || "")
      const signature = `${alt.player}|${alt.propType}|${alt.side}|${Number(alt.line)}`
      const lateRejectReason = getHighLegLateRejectReason(alt, weakestLateIndex + 1, {
        relaxedLaterFill: true,
        finalQualityPass: true
      })
      if (!player || usedPlayers.has(player)) continue
      if (usedSignatures.has(signature)) continue
      if ((gameCounts.get(matchup) || 0) >= 4) continue
      if (hasConflict(fixed, alt)) continue
      if (lateRejectReason) continue

      const changesGame = String(alt.matchup || "") !== String(weakest.matchup || "")
      const changesStat = String(alt.propType || alt.statType || "") !== String(weakest.propType || weakest.statType || "")
      if (!changesGame && !changesStat) continue

      attempts += 1
      const variant = dedupeSlipLegs([...fixed, alt])
      if (variant.length !== targetLegCount) continue

      const variantPrice = parlayPriceFromLegs(variant)
      if (!variantPrice) continue
      const variantReturn = estimateReturn(5, variantPrice.american)
      if (!variantReturn) continue
      if (baseReturn && variantReturn < baseReturn * 0.9) continue

      const statTypes = new Set(variant.map((leg) => String(leg.propType || leg.statType || ""))).size
      const games = new Set(variant.map((leg) => String(leg.matchup || ""))).size
      const score = games * 0.4 + statTypes * 0.35 + parseHitRate(alt.hitRate)
      if (score > bestScore) {
        bestScore = score
        bestRows = variant
        accepted = true
      }
    }

    console.log("[DIVERSIFY-SWAP-DEBUG]", {
      book,
      scope: "highestHitRate",
      targetLegCount,
      attempts,
      accepted
    })

    return accepted ? bestRows : rows
  }

  if (targetLegCount === 2) {
    const result = buildTierWithFallback(sources, 2, [
      { ...shared, minScore: 95, avoidFragile: true },
      { ...shared, minScore: 85, avoidFragile: false },
      { ...shared, minScore: 75, avoidFragile: false },
      { ...shared, minScore: 65, avoidFragile: false },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 55, avoidFragile: false, blockSameGameStatSide: false },
            { ...shared, minScore: 45, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false }
          ]
        : [])
    ])
    const isValid = validateSlip(result, 1, 1)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   2-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 2 && isValid ? result : [])
  }

  if (targetLegCount === 3) {
    const result = buildTierWithFallback(sources, 3, [
      { ...shared, minScore: 60, avoidFragile: false },  // Floor for 3-leg
      { ...shared, minScore: 50, avoidFragile: false },
      { ...shared, minScore: 40, avoidFragile: false },
      { ...shared, minScore: 30, avoidFragile: false },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 20, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
            { ...shared, minScore: 10, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false }
          ]
        : []),
      ...(!isFanDuel
        ? [{ ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }]
        : [])
    ])
    const isValid = validateSlip(result, 1, isFanDuel ? 2 : 1)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   3-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 3 && isValid ? result : [])
  }

  if (targetLegCount === 4) {
    const result = buildTierWithFallback(sources, 4, [
      { ...shared, minScore: 55, avoidFragile: false },
      { ...shared, minScore: 45, avoidFragile: false },
      { ...shared, minScore: 35, avoidFragile: false },
      { ...shared, minScore: 25, avoidFragile: false },
      { ...shared, minScore: 15, avoidFragile: false, maxPerGame: 2 },
      { ...shared, minScore: 5, avoidFragile: false, maxPerGame: 2 },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
            { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }
          ]
        : []),
      ...(!isFanDuel
        ? [{ ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false }]
        : [])
    ])
    const isValid = validateSlip(result, 1, isFanDuel ? 3 : 2)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   4-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 4 && isValid ? result : [])
  }

  if (targetLegCount === 5) {
    let result = buildTierWithFallback(sources, 5, [
      { ...shared, minScore: 60, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 50, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 40, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 30, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 20, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 10, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false }
    ])
    // Call bestPropsFill for both books so FanDuel can fill 5-leg from the wider pool
    result = maybeAddBestPropsFill(result, { target: 5, maxPerGame: 3, blockSameGameStatSide: false })
    result = diversifyHighLegFinalLeg(result)
    const isValid = validateSlip(result, 1, 3)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   5-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 5 && isValid ? result : [])
  }

  if (targetLegCount === 6) {
    let result = buildTierWithFallback(sources, 6, [
      { ...shared, minScore: 55, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 45, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 35, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 25, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 15, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 5, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 8, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
            { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }
          ]
        : [])
    ])
    result = maybeAddBestPropsFill(result, { target: 6, maxPerGame: 3, blockSameGameStatSide: false })
    result = diversifyHighLegFinalLeg(result)
    const isValid = validateSlip(result, 1, 3)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   6-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 6 && isValid ? result : [])
  }

  if (targetLegCount === 7) {
    let result = buildTierWithFallback(sources, 7, [
      { ...shared, minScore: 45, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 35, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 25, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 15, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 5, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 8, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
            { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }
          ]
        : [])
    ])
    result = maybeAddBestPropsFill(result, { target: 7, maxPerGame: 3, blockSameGameStatSide: false })
    result = diversifyHighLegFinalLeg(result)
    const isValid = validateSlip(result, 1, 3)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   7-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 7 && isValid ? result : [])
  }

  if (targetLegCount === 8) {
    let result = buildTierWithFallback(sources, 8, [
      { ...shared, minScore: 40, avoidFragile: false, maxPerGame: 2, blockSameGameStatSide: false },
      { ...shared, minScore: 30, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 20, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 10, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 5, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 6, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
            { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }
          ]
        : [])
    ])
    result = maybeAddBestPropsFill(result, { target: 8, maxPerGame: 3, blockSameGameStatSide: false })
    result = diversifyHighLegFinalLeg(result)
    const isValid = validateSlip(result, 1, 3)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   8-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 8 && isValid ? result : [])
  }

  if (targetLegCount === 9) {
    let result = buildTierWithFallback(sources, 9, [
      { ...shared, minScore: 55, avoidFragile: false },
      { ...shared, minScore: 45, avoidFragile: false },
      { ...shared, minScore: 35, avoidFragile: false },
      { ...shared, minScore: 25, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 15, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 5, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
      { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false },
      ...(isFanDuel
        ? [
            { ...shared, minScore: 10, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
            { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }
          ]
        : [])
    ])
    result = maybeAddBestPropsFill(result, { target: 9, maxPerGame: 3, blockSameGameStatSide: false })
    result = diversifyHighLegFinalLeg(result)
    const isValid = validateSlip(result, 1, 3)
    logBuilderDepth(result)
    console.log(`[DUAL-DEBUG]   9-leg: result.length=${result.length} valid=${isValid}`)
    return finalizeHighestHitRateBuild(result.length === 9 && isValid ? result : [])
  }

  let result = buildTierWithFallback(sources, 10, [
    { ...shared, minScore: 50, avoidFragile: false },
    { ...shared, minScore: 40, avoidFragile: false },
    { ...shared, minScore: 30, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
    { ...shared, minScore: 20, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
    { ...shared, minScore: 10, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
    { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
    { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 4, blockSameGameStatSide: false },
    ...(isFanDuel
      ? [
          { ...shared, minScore: 6, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false },
          { ...shared, minScore: 0, avoidFragile: false, maxPerGame: 3, blockSameGameStatSide: false }
        ]
      : [])
  ])
  result = maybeAddBestPropsFill(result, { target: 10, maxPerGame: 3, blockSameGameStatSide: false })
  result = diversifyHighLegFinalLeg(result)
  const isValid = validateSlip(result, 1, 3)
  logBuilderDepth(result)
  console.log(`[DUAL-DEBUG]   10-leg: result.length=${result.length} valid=${isValid}`)
  return finalizeHighestHitRateBuild(result.length === 10 && isValid ? result : [])
}

function buildBestBookSlip(book, targetLegCount) {
  return buildTargetBookSlip(book, targetLegCount)
}

function getBookPrimaryRows(book) {
  const primaryBest = getAvailablePrimarySlateRows(oddsSnapshot.bestProps || [])
  const primaryElite = getAvailablePrimarySlateRows(oddsSnapshot.eliteProps || [])
  const primaryStrong = getAvailablePrimarySlateRows(oddsSnapshot.strongProps || [])
  const primaryPlayable = getAvailablePrimarySlateRows(oddsSnapshot.playableProps || [])

  const combined = dedupeSlipLegs([
    ...primaryBest,
    ...primaryElite,
    ...primaryStrong,
    ...primaryPlayable
  ]).filter(
    (row) => row.book === book && isSafeSlipAllowedPropType(row.propType)
  )

  return sortRowsForMLHighestHitRate(combined)
}

function fallbackBookSlip(book, targetLegCount) {
  const rows = getBookPrimaryRows(book)
  if (!rows.length) return []

  const isFanDuel = book === "FanDuel"

  const exact = buildTierWithFallback([rows], targetLegCount, [
    {
      maxPerPlayer: 1,
      maxPerGame: targetLegCount <= 2 ? 1 : targetLegCount <= 4 ? 2 : 3,
      preferredBook: book,
      minScore: 0,
      avoidFragile: false,
      forceUniquePlayers: true,
      blockSameGameStatSide: targetLegCount <= 3,
      allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
    },
    ...(isFanDuel
      ? [
          {
            maxPerPlayer: 1,
            maxPerGame: targetLegCount <= 3 ? 2 : 3,
            preferredBook: book,
            minScore: 0,
            avoidFragile: false,
            forceUniquePlayers: true,
            blockSameGameStatSide: false,
            allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
          }
        ]
      : [])
  ])

  if (exact.length === targetLegCount) return exact

  for (let count = targetLegCount - 1; count >= 2; count -= 1) {
    const partial = buildTierWithFallback([rows], count, [
      {
        maxPerPlayer: 1,
        maxPerGame: count <= 2 ? 1 : count <= 4 ? 2 : 3,
        preferredBook: book,
        minScore: 0,
        avoidFragile: false,
        forceUniquePlayers: true,
        blockSameGameStatSide: count <= 3,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      ...(isFanDuel
        ? [
            {
              maxPerPlayer: 1,
              maxPerGame: count <= 3 ? 2 : 3,
              preferredBook: book,
              minScore: 0,
              avoidFragile: false,
              forceUniquePlayers: true,
              blockSameGameStatSide: false,
              allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
            }
          ]
        : [])
    ])

    if (partial.length >= 2) return partial
  }

  return []
}

function withBookSlipFallback(book, targetLegCount, legs) {
  const normalizedLegs = Array.isArray(legs)
    ? dedupeSlipLegs(legs).filter((row) => !shouldRemoveLegForPlayerStatus(row))
    : []
  const minAcceptedLegCount = targetLegCount >= 5 ? 4 : targetLegCount
  const rawLen = Array.isArray(legs) ? legs.length : 0

  console.log(`[DUAL-DEBUG] withBookSlipFallback(${book}, ${targetLegCount}) - normalizedLegs=${normalizedLegs.length}`)

  if (normalizedLegs.length >= minAcceptedLegCount) {
    console.log(`[SLIP-ACCEPT-DEBUG] book=${book} target=${targetLegCount} rawLen=${rawLen} normalizedLen=${normalizedLegs.length} accepted=true minAccepted=${minAcceptedLegCount}`)
    return normalizedLegs
  }
  if (normalizedLegs.length > 0) {
    console.log(`[DUAL-DEBUG]   rejecting partial primary slip for ${book} ${targetLegCount}-leg: got ${normalizedLegs.length}`)
  }

  const fallback = fallbackBookSlip(book, targetLegCount)
  const normalizedFallback = Array.isArray(fallback)
    ? dedupeSlipLegs(fallback).filter((row) => !shouldRemoveLegForPlayerStatus(row))
    : []

  console.log(`[DUAL-DEBUG]   normalizedFallback=${normalizedFallback.length}`)

  if (normalizedFallback.length >= minAcceptedLegCount) {
    console.log(`[SLIP-ACCEPT-DEBUG] book=${book} target=${targetLegCount} rawLen=${normalizedFallback.length} normalizedLen=${normalizedFallback.length} accepted=true minAccepted=${minAcceptedLegCount}`)
    return normalizedFallback
  }
  if (normalizedFallback.length > 0) {
    console.log(`[DUAL-DEBUG]   rejecting partial fallback slip for ${book} ${targetLegCount}-leg: got ${normalizedFallback.length}`)
  }

  console.log(`[SLIP-ACCEPT-DEBUG] book=${book} target=${targetLegCount} rawLen=${normalizedFallback.length} normalizedLen=${normalizedFallback.length} accepted=false minAccepted=${minAcceptedLegCount}`)
  return []
}

app.get("/api/best-available", (req, res) => {
  console.log("[TOP-DOWN-BEST-AVAILABLE-ENTRY]", {
    snapshotSource: lastSnapshotSource || "unknown",
    snapshotLoadedFromDisk,
    updatedAt: oddsSnapshot?.updatedAt || null,
    events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
    rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
    props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
    bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1
  })
  const bestAvailablePayload = buildLiveDualBestAvailablePayload()

  if (!bestAvailablePayload) {
    return res.status(503).json({
      ok: false,
      error: "bestAvailable not ready",
      snapshotMeta: buildSnapshotMeta(),
      slateStateValidator: oddsSnapshot?.slateStateValidator || null,
      lineHistorySummary: oddsSnapshot?.lineHistorySummary || null
    })
  }

  const effectiveBestProps = (() => {
    const snapshotBest = Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []
    if (snapshotBest.length > 0) return snapshotBest
    const fallbackBest = Array.isArray(oddsSnapshot.props) ? buildBestPropsFallbackRows(oddsSnapshot.props, 60) : []
    return Array.isArray(fallbackBest) ? fallbackBest : []
  })()

  const LEGACY_STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
  const legacyBestFilterDebug = {
    input: Array.isArray(effectiveBestProps) ? effectiveBestProps.length : 0,
    excludedSpecialMarketFamily: 0,
    excludedNonStandardPropType: 0,
    excludedMissingCoreFields: 0,
    forceIncludedSpecialExcluded: 0
  }
  const legacyStandardBestProps = (Array.isArray(effectiveBestProps) ? effectiveBestProps : []).filter((row) => {
    if (!row) return false

    const marketFamily = String(row?.marketFamily || "")
    if (marketFamily === "special") {
      legacyBestFilterDebug.excludedSpecialMarketFamily += 1
      if (row?.__forceInclude) legacyBestFilterDebug.forceIncludedSpecialExcluded += 1
      return false
    }

    const propType = String(row?.propType || "")
    if (!LEGACY_STANDARD_PROP_TYPES.has(propType)) {
      legacyBestFilterDebug.excludedNonStandardPropType += 1
      return false
    }

    if (!row?.player || !row?.team || !row?.matchup || !row?.propType || !row?.book) {
      legacyBestFilterDebug.excludedMissingCoreFields += 1
      return false
    }

    return true
  })

  console.log("[BEST-PROPS-ROUTE-GAME-DEBUG]", {
    total: effectiveBestProps.length,
    byBook: {
      FanDuel: effectiveBestProps.filter((row) => row?.book === "FanDuel").length,
      DraftKings: effectiveBestProps.filter((row) => row?.book === "DraftKings").length
    },
    byGame: effectiveBestProps.reduce((acc, row) => {
      const key = String(row?.matchup || row?.eventId || "unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  })

  const bestVisibleRows = Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : []

  let standardCandidates = []
  let ladderCandidates = []
  let specialProps = []
  let routePlayableSeed = []
  let finalPlayableRows = []
  let ladderPool = []
  let expandedPoolDebug = null

  try {
    const FIRST_BASKET_MARKET_KEYS = new Set(["player_first_basket", "player_first_team_basket"])

    const normalizeExpandedPlayerKey = (value) =>
      String(value || "")
        .normalize("NFKD")
        .replace(/[’']/g, "")
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()

    let expandedPoolInputRows = Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length > 0
      ? oddsSnapshot.rawProps
      : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])

    const normalizedFirstBasketRows = (Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : [])
      .filter((row) => ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || "")))

    expandedPoolInputRows = dedupeMarketRows([
      ...(Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : []),
      ...(Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : [])
    ])

    const eventPlayerPool = new Map()
    for (const row of (Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : [])) {
      const eventKey = String(row?.eventId || row?.matchup || "")
      const playerKey = normalizeExpandedPlayerKey(row?.player)
      const marketFamily = String(row?.marketFamily || "")
      const propType = String(row?.propType || "")
      const marketKey = String(row?.marketKey || "")

      if (!eventKey || !playerKey) continue

      const isStandardLike =
        marketFamily === "standard" ||
        ["Points", "Rebounds", "Assists", "PRA", "Threes"].includes(propType) ||
        [
          "player_points",
          "player_rebounds",
          "player_assists",
          "player_points_rebounds_assists",
          "player_threes"
        ].includes(marketKey)

      if (!isStandardLike) continue

      if (!eventPlayerPool.has(eventKey)) eventPlayerPool.set(eventKey, new Set())
      eventPlayerPool.get(eventKey).add(playerKey)
    }

    const coerceFirstBasketExpandedRow = (row) => {
      if (!row) return null

      const marketKey = String(row?.marketKey || "")
      if (!FIRST_BASKET_MARKET_KEYS.has(marketKey)) return null

      const player = String(row?.player || "").trim()
      const team = String(row?.team || "").trim()
      const matchup = String(row?.matchup || "").trim()
      const awayTeam = String(row?.awayTeam || "").trim()
      const homeTeam = String(row?.homeTeam || "").trim()

      if (!player) return null
      if (!row?.eventId && !matchup) return null

      const hasTeamContext = Boolean(team && (awayTeam || homeTeam || matchup))
      if (hasTeamContext) {
        const matchupContainsTeam =
          (awayTeam && team === awayTeam) ||
          (homeTeam && team === homeTeam) ||
          (matchup && matchup.includes(team))

        if (!matchupContainsTeam) return null
      }

      const eventKey = String(row?.eventId || row?.matchup || "")
      const normalizedPlayer = normalizeExpandedPlayerKey(player)
      const knownPlayersForEvent = eventPlayerPool.get(eventKey)

      if (knownPlayersForEvent && knownPlayersForEvent.size > 0) {
        if (!knownPlayersForEvent.has(normalizedPlayer)) return null
      }

      const propType = marketKey === "player_first_team_basket" ? "First Team Basket" : "First Basket"
      const specialSubtype = marketKey === "player_first_team_basket" ? "teamFirstBasket" : "playerFirstBasket"

      return {
        ...row,
        marketFamily: "special",
        boardFamily: "special",
        propType,
        specialSubtype
      }
    }

    const expandedResult = buildExpandedMarketPools({
      ...oddsSnapshot,
      rawProps: expandedPoolInputRows
    })
    standardCandidates = expandedResult.standardCandidates || []
    ladderCandidates = expandedResult.ladderCandidates || []
    specialProps = expandedResult.specialProps || []

    // --- Special props fallback: rebuild from snapshot if expandedPools returned empty ---
    // Also: always merge missing first basket / first team basket rows even if specialProps is non-empty
    const FIRST_BASKET_PROP_TYPES = new Set(["First Basket", "First Team Basket"])

    const hasFirstBasket = specialProps.some((row) => {
      const mk = String(row?.marketKey || "")
      const pt = String(row?.propType || "")
      return mk === "player_first_basket" || pt === "First Basket"
    })
    const hasFirstTeamBasket = specialProps.some((row) => {
      const mk = String(row?.marketKey || "")
      const pt = String(row?.propType || "")
      return mk === "player_first_team_basket" || pt === "First Team Basket"
    })

    if (!specialProps.length || !hasFirstBasket || !hasFirstTeamBasket) {
      const specialFallbackSource = dedupeMarketRows([
        ...(Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length > 0
          ? oddsSnapshot.rawProps
          : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])),
        ...(Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps : []),
        ...(Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps : []),
        ...(Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps : []),
        ...(Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps : [])
      ])

      if (!specialProps.length) {
        // Full fallback: rebuild ALL special props from snapshot
        const specialFallbackRaw = specialFallbackSource.filter((row) => {
          if (row?.book !== "DraftKings") return false
          if (!row?.player) return false

          const marketKey = String(row?.marketKey || "")
          const isSpecialMarket = SPECIAL_MARKET_KEYS.has(marketKey)
          const isSpecialPropType = SPECIAL_PROP_TYPE_NAMES.has(String(row?.propType || ""))
          const shouldTreatAsSpecial = isSpecialMarket || isSpecialPropType

          if (!shouldTreatAsSpecial) return false

          // Relax metric requirements for special markets: only require player + matchup
          if (!row?.matchup && !row?.eventId) return false
          return true
        })

        specialFallbackRaw.sort((a, b) => {
          const scoreA = Number(a?.score || 0)
          const scoreB = Number(b?.score || 0)
          if (scoreB !== scoreA) return scoreB - scoreA
          return Number(b?.edge || 0) - Number(a?.edge || 0)
        })

        specialProps = specialFallbackRaw.slice(0, 40)

        console.log("[SPECIAL-PROPS-FALLBACK-DEBUG]", {
          fallbackSourceCount: specialFallbackSource.length,
          specialFallbackRawCount: specialFallbackRaw.length,
          finalSpecialPropsCount: specialProps.length
        })
      } else {
        // Partial fallback: specialProps exists but is missing first basket rows — merge them in
        const firstBasketFallback = specialFallbackSource.filter((row) => {
          if (row?.book !== "DraftKings") return false
          if (!row?.player) return false
          if (!row?.matchup && !row?.eventId) return false

          const mk = String(row?.marketKey || "")
          const pt = String(row?.propType || "")
          return FIRST_BASKET_MARKET_KEYS.has(mk) || FIRST_BASKET_PROP_TYPES.has(pt)
        })

        firstBasketFallback.sort((a, b) => {
          const oddsA = Number(a?.odds || 0)
          const oddsB = Number(b?.odds || 0)
          // Lower odds = higher implied probability = better
          return oddsA - oddsB
        })

        const firstBasketMerge = firstBasketFallback.slice(0, 30)
        specialProps = dedupeMarketRows([...specialProps, ...firstBasketMerge])

        console.log("[FIRST-BASKET-MERGE-DEBUG]", {
          firstBasketFallbackCount: firstBasketFallback.length,
          mergedCount: firstBasketMerge.length,
          totalSpecialPropsAfterMerge: specialProps.length
        })
      }
    }

    const directFirstBasketRows = dedupeMarketRows(
      (Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : [])
        .filter((row) =>
          FIRST_BASKET_MARKET_KEYS.has(String(row?.marketKey || ""))
        )
        .map(coerceFirstBasketExpandedRow)
        .filter(Boolean)
    )

    specialProps = dedupeMarketRows([
      ...(Array.isArray(specialProps) ? specialProps : []),
      ...directFirstBasketRows
    ])

    console.log("[SPECIAL-PROPS-DEBUG]", {
      totalSpecialProps: Array.isArray(specialProps) ? specialProps.length : 0,
      sampleSpecialProps: Array.isArray(specialProps)
        ? specialProps.slice(0, 10).map((row) => ({
            matchup: row?.matchup || null,
            player: row?.player || null,
            team: row?.team || null,
            marketKey: row?.marketKey || null,
            propType: row?.propType || null,
            side: row?.side || null,
            line: row?.line ?? null,
            odds: row?.odds ?? null,
            score: row?.score ?? null
          }))
        : []
    })

    console.log("[FIRST-BASKET-DEBUG]", {
      firstBasketCount: Array.isArray(specialProps)
        ? specialProps.filter((row) => String(row?.marketKey || "") === "player_first_basket").length
        : 0,
      firstTeamBasketCount: Array.isArray(specialProps)
        ? specialProps.filter((row) => String(row?.marketKey || "") === "player_first_team_basket").length
        : 0,
      sampleFirstBasketLike: Array.isArray(specialProps)
        ? specialProps
            .filter((row) =>
              ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
            )
            .slice(0, 12)
            .map((row) => ({
              matchup: row?.matchup || null,
              player: row?.player || null,
              team: row?.team || null,
              marketKey: row?.marketKey || null,
              propType: row?.propType || null,
              side: row?.side || null,
              odds: row?.odds ?? null,
              book: row?.book || null,
              eventId: row?.eventId || null
            }))
        : []
    })

    console.log("[EXPANDED-MARKET-POOLS-DEBUG]", {
      standardCount: standardCandidates.length,
      ladderCount: ladderCandidates.length,
      specialCount: specialProps.length,
      standardByProp: standardCandidates.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      ladderByProp: ladderCandidates.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      specialByProp: specialProps.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })

    routePlayableSeed = Array.isArray(standardCandidates) && standardCandidates.length > 0
      ? standardCandidates
      : buildSlipSeedPool(oddsSnapshot)

    console.log("[ROUTE-PLAYABLE-SEED-DEBUG]", {
      total: routePlayableSeed.length,
      byPropType: routePlayableSeed.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byGame: routePlayableSeed.reduce((acc, row) => {
        const key = String(row?.matchup || row?.eventId || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      topSample: routePlayableSeed.slice(0, 20).map((row) => ({
        player: row?.player,
        propType: row?.propType,
        matchup: row?.matchup,
        line: row?.line,
        hitRate: row?.hitRate,
        edge: row?.edge,
        score: row?.score
      }))
    })

    const fallbackStandardCandidates = Array.isArray(standardCandidates) ? standardCandidates : []
    const fallbackRoutePlayableSeed = Array.isArray(routePlayableSeed) ? routePlayableSeed : []

    finalPlayableRows = dedupeMarketRows(
      fallbackStandardCandidates.length ? fallbackStandardCandidates : fallbackRoutePlayableSeed
    )

    console.log("[FINAL-PLAYABLE-FALLBACK]", {
      standardCandidates: fallbackStandardCandidates.length,
      routePlayableSeed: fallbackRoutePlayableSeed.length,
      finalPlayableRows: finalPlayableRows.length,
      source:
        fallbackStandardCandidates.length ? "standardCandidates" :
        fallbackRoutePlayableSeed.length ? "routePlayableSeed" :
        "none"
    })

    const slipSeedPool = routePlayableSeed
    console.log("[SLIP-SEED-POOL-DEBUG]", {
      total: slipSeedPool.length,
      byPropType: slipSeedPool.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byGame: slipSeedPool.reduce((acc, row) => {
        const key = String(row?.matchup || row?.eventId || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      sample: slipSeedPool.slice(0, 15).map((row) => ({
        player: row?.player,
        propType: row?.propType,
        matchup: row?.matchup,
        line: row?.line,
        hitRate: row?.hitRate,
        edge: row?.edge,
        score: row?.score
      }))
    })

    ladderPool = slipSeedPool.flatMap((row) => getLadderVariantsForRow(row))
    console.log("[LADDER-POOL-DEBUG]", {
      baseBestCount: effectiveBestProps.length,
      ladderCount: ladderPool.length,
      incompleteBaseRows: effectiveBestProps.filter((row) => {
        return !(row && row.team && row.hitRate != null && row.hitRate !== "" && row.edge != null && row.score != null)
      }).length,
      byVariant: ladderPool.reduce((acc, row) => {
        const key = String(row?.propVariant || "base")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byProp: ladderPool.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })

    expandedPoolDebug = {
      ladderPool: Array.isArray(ladderPool) ? ladderPool.length : -1,
      routePlayableSeed: Array.isArray(routePlayableSeed) ? routePlayableSeed.length : -1,
      standardCandidates: Array.isArray(standardCandidates) ? standardCandidates.length : -1,
      finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : -1,
      ladderCandidates: Array.isArray(ladderCandidates) ? ladderCandidates.length : -1,
      specialProps: Array.isArray(specialProps) ? specialProps.length : -1
    }

    console.log("[EXPANDED-POOL-SUCCESS]", expandedPoolDebug)
  } catch (err) {
    const readableExpandedPoolError =
      err?.stack ||
      err?.message ||
      (typeof err === "string" ? err : "") ||
      JSON.stringify(err, Object.getOwnPropertyNames(err || {}))

    console.error("[EXPANDED-POOL-CRASH]", {
      message: err?.message || null,
      stack: err?.stack || null,
      expandedPoolDebug,
      readableExpandedPoolError
    })

    throw err
  }

  const snapshotMeta = logSnapshotMeta("route=/api/best-available response")

  // === FORCE COVERAGE DEBUG ON LIVE RESPONSE PATH ===
  try {
    const scheduledEvents = Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : []
    const rawPropsRows = Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []

    console.log("[RAW-PROPS-BEFORE-FILTER]", {
      total: rawPropsRows.length,
      byBook: rawPropsRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    const enrichedModelRows = Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []
    const beforeFilter = rawPropsRows.length
    const survivedFragileRows = rawPropsRows.filter((r) => {
      let keep = true
      try {
        keep = !shouldRemoveLegForPlayerStatus(r) && !isFragileLeg(r)
      } catch (_) {
        keep = true
      }

      if (!keep && r?.book === "FanDuel") {
        console.log("[FANDUEL-DROPPED-DEBUG]", {
          player: r?.player,
          propType: r?.propType,
          matchup: r?.matchup,
          reason: "failed_first_filter"
        })
      }

      return keep
    })
    console.log("[RAW-PROPS-AFTER-FIRST-FILTER]", {
      before: beforeFilter,
      after: survivedFragileRows.length,
      byBook: survivedFragileRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    const bestPropsRawRows = Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps : []
    const finalBestVisibleRows = getAvailablePrimarySlateRows(bestPropsRawRows)

    console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
      scheduledEvents: scheduledEvents.length,
      rawPropsRows: rawPropsRows.length,
      enrichedModelRows: enrichedModelRows.length,
      survivedFragileRows: survivedFragileRows.length,
      survivedFragileRowsByBook: {
        FanDuel: survivedFragileRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: survivedFragileRows.filter((r) => r?.book === "DraftKings").length
      },
      bestPropsRawRows: bestPropsRawRows.length,
      bestPropsRawRowsByBook: {
        FanDuel: bestPropsRawRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: bestPropsRawRows.filter((r) => r?.book === "DraftKings").length
      },
      finalBestVisibleRows: finalBestVisibleRows.length
    })

    runCurrentSlateCoverageDiagnostics({
      scheduledEvents,
      rawPropsRows,
      enrichedModelRows,
      survivedFragileRows,
      bestPropsRawRows,
      finalBestVisibleRows
    })
  } catch (e) {
    console.log("[COVERAGE-AUDIT-ERROR]", e?.message || e)
  }
  // === END FORCE COVERAGE DEBUG ===

  const scheduledEventsForBestPayload = Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : []
  const scheduledBestEventIdSet = new Set(
    scheduledEventsForBestPayload
      .map((event) => String(event?.eventId || event?.id || ""))
      .filter(Boolean)
  )

  const bestPayloadRows = legacyStandardBestProps.filter((row) => {
    if (!row) return false
    if (shouldRemoveLegForPlayerStatus(row)) return false

    const eventId = String(row?.eventId || "")
    if (!eventId) return false
    if (scheduledBestEventIdSet.size === 0) return true

    return scheduledBestEventIdSet.has(eventId)
  })

  console.log("[BEST-PROPS-VISIBILITY-FILTER-DEBUG]", {
    beforeTotal: Array.isArray(effectiveBestProps) ? effectiveBestProps.length : 0,
    afterLegacyStandardFilter: Array.isArray(legacyStandardBestProps) ? legacyStandardBestProps.length : 0,
    afterTotal: Array.isArray(bestPayloadRows) ? bestPayloadRows.length : 0,
    excludedSpecialFromLegacyBestProps: legacyBestFilterDebug.excludedSpecialMarketFamily,
    excludedNonStandardFromLegacyBestProps: legacyBestFilterDebug.excludedNonStandardPropType,
    excludedMissingCoreFieldsFromLegacyBestProps: legacyBestFilterDebug.excludedMissingCoreFields,
    forceIncludedSpecialExcludedFromLegacyBestProps: legacyBestFilterDebug.forceIncludedSpecialExcluded
  })

  if (bestAvailablePayload) {
    bestAvailablePayload.best = bestPayloadRows
    if (bestAvailablePayload.availableCounts) {
      bestAvailablePayload.availableCounts.best = {
        total: bestPayloadRows.length,
        fanduel: bestPayloadRows.filter((row) => row?.book === "FanDuel").length,
        draftkings: bestPayloadRows.filter((row) => row?.book === "DraftKings").length
      }
    }
  }

  console.log("[FINAL-PLAYABLE-RUNTIME-CHECK]", {
    ladderPool: Array.isArray(ladderPool) ? ladderPool.length : -1,
    routePlayableSeed: Array.isArray(routePlayableSeed) ? routePlayableSeed.length : -1,
    standardCandidates: Array.isArray(standardCandidates) ? standardCandidates.length : -1,
    finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : -1,
    ladderCandidates: Array.isArray(ladderCandidates) ? ladderCandidates.length : -1,
    specialProps: Array.isArray(specialProps) ? specialProps.length : -1
  })

  // --- Build enriched board source pool ---
  const dedupeBoardRows = (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const seen = new Set()
    const out = []

    for (const row of safeRows) {
      const key = [
        String(row?.eventId || ""),
        String(row?.player || ""),
        String(row?.matchup || ""),
        String(row?.marketKey || ""),
        String(row?.propType || ""),
        String(row?.side || ""),
        String(row?.line ?? ""),
        String(row?.odds ?? ""),
        String(row?.propVariant || "base")
      ].join("|")

      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }

    return out
  }

  const enrichedSpecialProps = Array.isArray(specialProps)
    ? specialProps.map(enrichSpecialPredictionRow)
    : []

  const effectiveBestPropsForBoardSource = (Array.isArray(effectiveBestProps) ? effectiveBestProps : []).filter((row) => {
    const marketFamily = String(row?.marketFamily || "").toLowerCase()
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    if (marketFamily === "special") return false
    if (SPECIAL_MARKET_KEYS.has(marketKey)) return false
    if (SPECIAL_PROP_TYPE_NAMES.has(propType)) return false
    return true
  })

  const boardSourceRows = dedupeBoardRows([
    ...(Array.isArray(finalPlayableRows) ? finalPlayableRows : []),
    ...(Array.isArray(standardCandidates) ? standardCandidates : []),
    ...(Array.isArray(ladderPool) ? ladderPool : []),
    ...(Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps : []),
    ...effectiveBestPropsForBoardSource
  ])

  console.log("[BOARD-SOURCE-DEBUG]", {
    boardSourceRows: Array.isArray(boardSourceRows) ? boardSourceRows.length : 0,
    withEvidence: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) => row?.evidence).length
      : 0,
    withWhyItRates: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) => Array.isArray(row?.whyItRates) && row.whyItRates.length > 0).length
      : 0,
    withPredictionScores: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) =>
          row?.gamePriorityScore !== null &&
          row?.gamePriorityScore !== undefined &&
          row?.playerConfidenceScore !== null &&
          row?.playerConfidenceScore !== undefined
        ).length
      : 0,
    firstBasketLike: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) =>
          ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
        ).length
      : 0
  })

  // --- Build market-siloed boards ---
  const classifiedBoardSourceRows = boardSourceRows.map((row) => {
    const classified = classifyBoardRow(row)
    return {
      ...row,
      boardFamily: classified?.boardFamily || null,
      ladderSubtype: classified?.ladderSubtype || null,
      specialSubtype: classified?.specialSubtype || null
    }
  })
  const gameEdgeMap = buildGameEdgeMap(classifiedBoardSourceRows)
  const boardSourceRowsWithGameRole = applyGameAndRoleEdge(classifiedBoardSourceRows, gameEdgeMap).map((row) => ({
    ...row,
    playDecision: inferPlayDecision(row)
  })).map((row) => ({
    ...row,
    decisionSummary: buildDecisionSummary(row)
  }))
  const ladderPresentationAlternateMarketKeys = new Set([
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
    "player_threes_alternate",
    "player_points_rebounds_assists_alternate"
  ])
  const ladderPresentationVariants = new Set(["alt-low", "alt-mid", "alt-high", "alt-max"])
  const ladderTypeByMarketKey = {
    player_points_alternate: "Points",
    player_rebounds_alternate: "Rebounds",
    player_assists_alternate: "Assists",
    player_threes_alternate: "Threes",
    player_points_rebounds_assists_alternate: "PRA"
  }
  const boardSourceRowsWithLadderPresentation = boardSourceRowsWithGameRole.map((row) => {
    const marketKey = String(row?.marketKey || "")
    const propVariant = String(row?.propVariant || "base")
    const isAlternateMarketRow = ladderPresentationAlternateMarketKeys.has(marketKey)
    const isSyntheticLadderVariant = ladderPresentationVariants.has(propVariant)
    const isLadderBoardRow = String(row?.boardFamily || "") === "ladder" || String(row?.ladderSubtype || "") !== ""
    const shouldAttachLadderPresentation = isAlternateMarketRow || isSyntheticLadderVariant || isLadderBoardRow
    if (!shouldAttachLadderPresentation) {
      return row
    }

    const side = String(row?.side || "")
    const lineValue = Number(row?.line)
    const hasMilestoneLikeShape = isAlternateMarketRow && side === "Over" && Number.isFinite(lineValue)
    const ladderPresentation = hasMilestoneLikeShape ? "milestoneLike" : "altLine"
    const ladderTarget = Number.isFinite(lineValue) ? lineValue : null
    const labelType = String(
      row?.propType ||
      ladderTypeByMarketKey[marketKey] ||
      "Ladder"
    ).replace(/\s+Ladder$/i, "").trim()
    const normalizedThreshold = Number.isFinite(lineValue)
      ? (Number.isInteger(lineValue) ? lineValue : Number(lineValue.toFixed(1)))
      : null
    const ladderLabel = hasMilestoneLikeShape
      ? `${normalizedThreshold}+ ${labelType}`.trim()
      : Number.isFinite(lineValue)
        ? `${side === "Under" ? "Under" : side === "Over" ? "Over" : "Alt"} ${normalizedThreshold} ${labelType}`.trim()
        : `Alt ${labelType}`.trim()

    return {
      ...row,
      ladderPresentation,
      ladderLabel,
      ladderTarget
    }
  })

  console.log("[BOARD-CLASSIFIER-DEBUG]", {
    boardFamily: boardSourceRowsWithGameRole.reduce((acc, row) => {
      const key = String(row?.boardFamily || "unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    ladderSubtype: boardSourceRowsWithGameRole.reduce((acc, row) => {
      const key = String(row?.ladderSubtype || "none")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    specialSubtype: boardSourceRowsWithGameRole.reduce((acc, row) => {
      const key = String(row?.specialSubtype || "none")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    teamFirstBasketCount: boardSourceRowsWithGameRole.filter((row) => isTeamFirstBasketRow(row)).length,
    milestoneLadderCount: boardSourceRowsWithGameRole.filter((row) => isMilestoneLadderRow(row)).length
  })

  const allVisibleRowsForBoards = boardSourceRowsWithLadderPresentation
  const ladderPresentationRows = allVisibleRowsForBoards.filter((row) =>
    String(row?.ladderPresentation || "").length > 0
  )
  console.log("[LADDER-PRESENTATION-DEBUG]", {
    totalLadderRows: ladderPresentationRows.length,
    milestoneLikeCount: ladderPresentationRows.filter((row) => row?.ladderPresentation === "milestoneLike").length,
    altLineCount: ladderPresentationRows.filter((row) => row?.ladderPresentation === "altLine").length,
    ladderLabelSample: [...new Set(
      ladderPresentationRows
        .map((row) => String(row?.ladderLabel || "").trim())
        .filter(Boolean)
    )].slice(0, 10)
  })

  const CORE_STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
  const LADDER_PROP_VARIANTS = new Set(["alt-low", "alt-mid", "alt-high", "alt-max"])

  const hasCoreBoardFields = (row) =>
    Boolean(row?.player && row?.team && row?.matchup && row?.propType && row?.book)

  const hasSpecialBoardFields = (row) =>
    Boolean(row?.player && row?.matchup && row?.propType && row?.book)

  const isLaneNativeLadderCandidate = (row) => {
    const marketFamily = String(row?.marketFamily || "")
    const propVariant = String(row?.propVariant || "base")
    const propType = String(row?.propType || "")
    const side = String(row?.side || "")
    if (marketFamily === "special") return false
    if (!LADDER_PROP_VARIANTS.has(propVariant)) return false
    if (!CORE_STANDARD_PROP_TYPES.has(propType)) return false
    if (side !== "Over") return false
    if (isFirstBasketLikeRow(row)) return false
    return true
  }

  const TEAM_FIRST_BASKET_MARKET_KEY = "player_first_team_basket"
  const isTeamFirstBasketMarketRow = (row) => String(row?.marketKey || "") === TEAM_FIRST_BASKET_MARKET_KEY
  const isSpecialLikeFallbackCandidate = (row) => {
    if (!hasSpecialBoardFields(row)) return false
    if (isFirstBasketLikeRow(row)) return false
    if (isLaneNativeLadderCandidate(row)) return false
    const marketFamily = String(row?.marketFamily || "")
    const propVariant = String(row?.propVariant || "base")
    const odds = Number(row?.odds || 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const isSpecialTier = tier.startsWith("special-")
    const isAggressiveAlt = ["alt-mid", "alt-high", "alt-max"].includes(propVariant)
    const isInterestingPlusMoney = Number.isFinite(odds) && odds >= 140
    if (confidence < 0.20) return false
    return marketFamily === "special" || isSpecialTier || isAggressiveAlt || isInterestingPlusMoney
  }
  const specialLikeFallbackScore = (row) => {
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const volatility = Number(row?.volatilityScore || 0)
    const gamePriority = Number(row?.gamePriorityScore || 0)
    const odds = Number(row?.odds || 0)
    const propVariant = String(row?.propVariant || "base")
    const tier = String(row?.confidenceTier || "").toLowerCase()

    let score = (confidence * 100) + (volatility * 30) + (gamePriority * 20)
    if (tier === "special-elite") score += 10
    else if (tier === "special-strong") score += 7
    else if (tier === "special-playable") score += 4
    if (["alt-mid", "alt-high", "alt-max"].includes(propVariant)) score += 8
    if (Number.isFinite(odds) && odds >= 180 && odds <= 1200) score += 10
    else if (Number.isFinite(odds) && odds > 1200) score += 4
    return score
  }
  const specialLikeFallbackPromotionScore = (row) => {
    const marketKey = String(row?.marketKey || "")
    const propVariant = String(row?.propVariant || "base")
    const odds = Number(row?.odds || 0)

    let score = specialLikeFallbackScore(row)
    if (isFirstBasketLikeRow(row)) score += 90
    if (marketKey === TEAM_FIRST_BASKET_MARKET_KEY) score += 30
    if (marketKey === "player_first_basket") score += 24
    if (propVariant === "alt-max") score += 10
    else if (propVariant === "alt-high") score += 8
    else if (propVariant === "alt-mid") score += 6

    if (Number.isFinite(odds) && odds >= 180 && odds <= 950) score += 10
    else if (Number.isFinite(odds) && odds > 950) score += 5
    else if (Number.isFinite(odds) && odds > 0 && odds < 130) score -= 12

    return score
  }

  const coreStandardProps = dedupeBoardRows(
    sortCorePropsBoard(
      allVisibleRowsForBoards.filter((row) => {
        if (!hasCoreBoardFields(row)) return false
        if (String(row?.marketFamily || "") === "special") return false
        if (!CORE_STANDARD_PROP_TYPES.has(String(row?.propType || ""))) return false
        const propVariant = String(row?.propVariant || "base")
        return propVariant === "base" || propVariant === "default"
      })
    )
  )

  const ladderProps = dedupeBoardRows(
    sortLadderBoard(
      allVisibleRowsForBoards.filter((row) => {
        if (!hasCoreBoardFields(row)) return false
        if (String(row?.marketFamily || "") === "special") return false
        const propVariant = String(row?.propVariant || "base")
        return LADDER_PROP_VARIANTS.has(propVariant)
      })
    )
  )

  const specialPropsBoard = dedupeBoardRows(
    sortSpecialBoard(
      allVisibleRowsForBoards.filter((row) => {
        if (!hasSpecialBoardFields(row)) return false
        return String(row?.marketFamily || "") === "special"
      })
    )
  )

  const boardCounts = {
    coreStandardProps: coreStandardProps.length,
    ladderProps: ladderProps.length,
    specialProps: specialPropsBoard.length
  }

  console.log("[NBA-BOARD-SHAPING-DEBUG]", {
    counts: boardCounts,
    coreStandardSample: coreStandardProps.slice(0, 5).map((row) => ({
      player: row?.player || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base"
    })),
    ladderSample: ladderProps.slice(0, 5).map((row) => ({
      player: row?.player || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base"
    })),
    specialSample: specialPropsBoard.slice(0, 5).map((row) => ({
      player: row?.player || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      line: row?.line ?? null
    }))
  })

  const {
    trueTeamFirstBasketRowsForBoard,
    rawFirstBasketBoard,
    specialLikeFallbackBoardRows,
    teamFirstBasketSupplyThinForBoard,
    useSpecialLikeFirstBasketFallback,
    firstBasketBoard
  } = buildFirstBasketBoard({
    allVisibleRowsForBoards,
    dedupeBoardRows,
    sortFirstBasketBoard,
    sortSpecialBoardSmart,
    isFirstBasketLikeRow,
    isSpecialLikeFallbackCandidate,
    specialLikeFallbackScore,
    specialLikeFallbackPromotionScore,
    isTeamFirstBasketMarketRow
  })

  const corePropsBoard = sortCorePropsBoard(
    allVisibleRowsForBoards.filter((row) => isCorePropRow(row) && !isLadderRow(row))
  ).slice(0, 40)

  const ladderBoard = sortLadderBoard(
    allVisibleRowsForBoards.filter(isLadderRow)
  ).slice(0, 40)

  const specialBoardSourceRows = allVisibleRowsForBoards.filter(
    (row) => isSpecialButNotFirstBasketRow(row) || isFirstBasketLikeRow(row)
  )
  const sortedSpecialBoardRows = sortSpecialBoard(specialBoardSourceRows)
  const specialBoardFirstBasketRows = sortedSpecialBoardRows.filter(isFirstBasketLikeRow).slice(0, 6)
  const specialBoardNonFirstBasketRows = sortedSpecialBoardRows.filter((row) => !isFirstBasketLikeRow(row))
  const specialBoard = dedupeBoardRows([
    ...specialBoardFirstBasketRows,
    ...specialBoardNonFirstBasketRows
  ]).slice(0, 20)

  const lottoBoard = sortLottoBoard(
    allVisibleRowsForBoards.filter((row) => isLottoStyleRow(row) || isFirstBasketLikeRow(row))
  ).slice(0, 30)

  console.log("[BOARD-BUILDER-DEBUG]", {
    firstBasketBoard: Array.isArray(firstBasketBoard) ? firstBasketBoard.length : 0,
    trueTeamFirstBasketRows: trueTeamFirstBasketRowsForBoard.length,
    specialLikeFallbackActivated: useSpecialLikeFirstBasketFallback,
    specialLikeFallbackRows: specialLikeFallbackBoardRows.length,
    corePropsBoard: Array.isArray(corePropsBoard) ? corePropsBoard.length : 0,
    ladderBoard: Array.isArray(ladderBoard) ? ladderBoard.length : 0,
    specialBoard: Array.isArray(specialBoard) ? specialBoard.length : 0,
    specialBoardFirstBasketCount: (Array.isArray(specialBoard) ? specialBoard : []).filter((row) => String(row?.marketKey || "") === "player_first_basket").length,
    specialBoardFirstTeamBasketCount: (Array.isArray(specialBoard) ? specialBoard : []).filter((row) => String(row?.marketKey || "") === "player_first_team_basket").length,
    lottoBoard: Array.isArray(lottoBoard) ? lottoBoard.length : 0,
    firstBasketSample: Array.isArray(firstBasketBoard)
      ? firstBasketBoard.slice(0, 8).map((row) => ({
          player: row?.player || null,
          matchup: row?.matchup || null,
          marketKey: row?.marketKey || null,
          odds: row?.odds ?? null,
          whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
        }))
      : []
  })

  // --- Build prediction-layer selective picks ---
  const predictionSourceRows = boardSourceRowsWithGameRole

  let fbRows = predictionSourceRows.filter((row) => isFirstBasketLikeRow(row))
  const trueTeamFirstBasketRowsForPicks = predictionSourceRows.filter(isTeamFirstBasketMarketRow)
  const teamFirstBasketSupplyThinForPicks = trueTeamFirstBasketRowsForPicks.length <= 1
  let specialLikeFallbackPickRowsCount = 0
  let specialLikeFallbackActivatedForPicks = false
  if (teamFirstBasketSupplyThinForPicks) {
    const specialLikeFallbackPickRows = sortSpecialBoardSmart(
      predictionSourceRows
        .filter(isSpecialLikeFallbackCandidate)
        .sort((a, b) => specialLikeFallbackScore(b) - specialLikeFallbackScore(a))
    ).slice(0, 10)
    specialLikeFallbackPickRowsCount = specialLikeFallbackPickRows.length
    if (specialLikeFallbackPickRows.length > 0) {
      fbRows = dedupeBoardRows([...fbRows, ...specialLikeFallbackPickRows]).slice(0, 20)
      specialLikeFallbackActivatedForPicks = true
    }
  }

  fbRows = filterSpecialRowsForBoard(fbRows)
  fbRows = sortSpecialBoardSmart(fbRows)
  if (specialLikeFallbackActivatedForPicks) {
    fbRows = [...fbRows].sort((a, b) => specialLikeFallbackPromotionScore(b) - specialLikeFallbackPromotionScore(a))
  }

  // HARD CAP to top 5 only
  const firstBasketPicks = fbRows.slice(0, 5)

  console.log("[SPECIAL-BOARD-FILTER-DEBUG]", {
    originalFB: predictionSourceRows.filter(r => isFirstBasketLikeRow(r)).length,
    filteredFB: fbRows.length,
    specialLikeFallbackActivatedForPicks,
    specialLikeFallbackPickRows: specialLikeFallbackPickRowsCount,
    finalFB: firstBasketPicks.length,
    topFB: firstBasketPicks.map(r => ({
      player: r.player,
      odds: r.odds,
      confidence: r.playerConfidenceScore,
      tier: r.confidenceTier
    }))
  })

  const corePropPicks = buildSelectiveBoard(
    predictionSourceRows.filter((row) => isCorePropRow(row) && !isLadderRow(row)),
    20,
    sortByPredictionStrength
  )

  let lottoRows = predictionSourceRows.filter((row) =>
    isLottoStyleRow(row) || isFirstBasketLikeRow(row)
  )

  // allow longshots here, but still filter garbage
  lottoRows = lottoRows.filter((row) => {
    const odds = Number(row?.odds || 0)
    const confidence = Number(row?.playerConfidenceScore || 0)

    if (odds > 2000 && confidence < 0.15) return false
    return true
  })

  lottoRows = sortSpecialBoardSmart(lottoRows)

  const lottoPicks = lottoRows.slice(0, 10)

  console.log("[PREDICTION-LAYER-DEBUG]", {
    firstBasketPicks: Array.isArray(firstBasketPicks) ? firstBasketPicks.length : 0,
    corePropPicks: Array.isArray(corePropPicks) ? corePropPicks.length : 0,
    lottoPicks: Array.isArray(lottoPicks) ? lottoPicks.length : 0,
    firstBasketSample: Array.isArray(firstBasketPicks)
      ? firstBasketPicks.slice(0, 6).map((row) => ({
          player: row?.player || null,
          matchup: row?.matchup || null,
          odds: row?.odds ?? null,
          gamePriorityScore: row?.gamePriorityScore ?? null,
          playerConfidenceScore: row?.playerConfidenceScore ?? null,
          confidenceTier: row?.confidenceTier || null,
          whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
        }))
      : []
  })

  console.log("[FIRST-BASKET-CONTEXT-DEBUG]", {
    firstBasketLikeCount: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) =>
          ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
        ).length
      : 0,
    sample: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps
          .filter((row) =>
            ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
          )
          .slice(0, 8)
          .map((row) => ({
            player: row?.player || null,
            propType: row?.propType || null,
            odds: row?.odds ?? null,
            gamePriorityScore: row?.gamePriorityScore ?? null,
            playerConfidenceScore: row?.playerConfidenceScore ?? null,
            confidenceTier: row?.confidenceTier || null,
            whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : [],
            modelSummary: row?.modelSummary || null
          }))
      : []
  })

  console.log("[SPECIAL-CONTEXT-DEBUG]", {
    totalSpecialProps: Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps.length : 0,
    bySubtype: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.reduce((acc, row) => {
          const key = String(row?.evidence?.subtype || "unknown")
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})
      : {},
    sample: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.slice(0, 8).map((row) => ({
          player: row?.player || null,
          propType: row?.propType || null,
          marketKey: row?.marketKey || null,
          odds: row?.odds ?? null,
          playerConfidenceScore: row?.playerConfidenceScore ?? null,
          confidenceTier: row?.confidenceTier || null,
          whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : [],
          modelSummary: row?.modelSummary || null
        }))
      : []
  })

  console.log("[SPECIAL-MARKET-INTEL-DEBUG]", {
    count: enrichedSpecialProps.length,
    sample: enrichedSpecialProps.slice(0,5).map(r => ({
      player: r.player,
      odds: r.odds,
      confidence: r.playerConfidenceScore,
      why: r.whyItRates
    }))
  })

  console.log("[SPECIAL-ENRICHMENT-DEBUG]", {
    rawSpecialProps: Array.isArray(specialProps) ? specialProps.length : 0,
    enrichedSpecialProps: Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps.length : 0,
    firstBasketLikeEnriched: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) =>
          ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
        ).length
      : 0,
    withEvidence: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) => row?.evidence).length
      : 0,
    withWhyItRates: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) => Array.isArray(row?.whyItRates) && row.whyItRates.length > 0).length
      : 0,
    withPredictionScores: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) =>
          row?.gamePriorityScore !== null &&
          row?.gamePriorityScore !== undefined &&
          row?.playerConfidenceScore !== null &&
          row?.playerConfidenceScore !== undefined
        ).length
      : 0,
    sampleFirstBasket: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps
          .filter((row) => String(row?.marketKey || "") === "player_first_basket")
          .slice(0, 6)
          .map((row) => ({
            player: row?.player || null,
            odds: row?.odds ?? null,
            gamePriorityScore: row?.gamePriorityScore ?? null,
            playerConfidenceScore: row?.playerConfidenceScore ?? null,
            confidenceTier: row?.confidenceTier || null,
            whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
          }))
      : []
  })

  const gameEdgeBoard = Object.values(gameEdgeMap)
    .sort((a, b) => Number(b?.gameEdgeScore || 0) - Number(a?.gameEdgeScore || 0))
    .slice(0, 8)

  const finalMustPlayRowsBeforeDedupe = sortByAdjustedConfidence(
    boardSourceRowsWithGameRole.filter((row) => String(row?.playDecision || "") === "must-play")
  )
  const normalizeMustPlayKeyPart = (value) =>
    value == null ? "" : String(value).trim().toLowerCase()

  const mustPlaySeen = new Set()
  const finalMustPlayRowsAfterDedupe = []
  for (const row of finalMustPlayRowsBeforeDedupe) {
    const normalizedLineValue = row?.line
    const normalizedLine =
      normalizedLineValue == null
        ? ""
        : normalizeMustPlayKeyPart(Number.isFinite(Number(normalizedLineValue)) ? Number(normalizedLineValue) : normalizedLineValue)
    const normalizedVariantRaw = normalizeMustPlayKeyPart(row?.propVariant)
    const normalizedVariant = normalizedVariantRaw || "base"
    const mustPlayKey = [
      normalizeMustPlayKeyPart(row?.player),
      normalizeMustPlayKeyPart(row?.matchup),
      normalizeMustPlayKeyPart(row?.marketKey),
      normalizeMustPlayKeyPart(row?.propType),
      normalizeMustPlayKeyPart(row?.side),
      normalizedLine,
      normalizedVariant,
      normalizeMustPlayKeyPart(row?.book)
    ].join("|")
    if (mustPlaySeen.has(mustPlayKey)) continue
    mustPlaySeen.add(mustPlayKey)
    finalMustPlayRowsAfterDedupe.push(row)
  }
  const mustPlayDuplicatesRemoved = finalMustPlayRowsBeforeDedupe.length - finalMustPlayRowsAfterDedupe.length
  const mustPlayBoard = finalMustPlayRowsAfterDedupe.slice(0, 15)

  const {
    featuredPlayScore,
    featuredCore,
    featuredLadders,
    featuredFirstBasket,
    featuredSpecials,
    featuredMustPlays,
    featuredPlays
  } = buildFeaturedPlays({
    corePropPicks,
    ladderBoard,
    enrichedSpecialProps,
    specialBoard,
    firstBasketBoard,
    mustPlayBoard,
    useSpecialLikeFirstBasketFallback,
    isSpecialLikeFallbackCandidate,
    isFirstBasketLikeRow,
    specialLikeFallbackPromotionScore,
    parseHitRate,
    dedupeBoardRows
  })

  const tonightsBestSingles = (() => {
    const candidates = (Array.isArray(corePropPicks) ? corePropPicks : [])
      .filter(Boolean)

    const picks = []
    const seenPropTypes = new Set()
    const propTypeCounts = new Map()
    const seenLegs = new Set()
    const seenPlayers = new Set()
    const TONIGHTS_SINGLES_MAX_PER_PROP_TYPE = 2

    for (const row of candidates) {
      const propTypeKey = String(row?.propType || "").trim().toLowerCase()
      const playerKey = String(row?.player || "").trim().toLowerCase()
      const legKey = [
        playerKey,
        propTypeKey,
        String(row?.side || ""),
        String(row?.line ?? ""),
        String(row?.marketKey || ""),
        String(row?.propVariant || "base")
      ].join("|")

      if (seenLegs.has(legKey)) continue
      if (seenPropTypes.has(propTypeKey)) continue
      if (seenPlayers.has(playerKey)) continue

      seenLegs.add(legKey)
      seenPropTypes.add(propTypeKey)
      seenPlayers.add(playerKey)
      propTypeCounts.set(propTypeKey, (propTypeCounts.get(propTypeKey) || 0) + 1)
      picks.push(row)

      if (picks.length >= 5) break
    }

    if (picks.length < 5) {
      for (const row of candidates) {
        const playerKey = String(row?.player || "").trim().toLowerCase()
        const propTypeKey = String(row?.propType || "").trim().toLowerCase()
        const legKey = [
          playerKey,
          propTypeKey,
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")

        if (seenLegs.has(legKey)) continue
        if (seenPlayers.has(playerKey)) continue
        if ((propTypeCounts.get(propTypeKey) || 0) >= TONIGHTS_SINGLES_MAX_PER_PROP_TYPE) continue

        seenLegs.add(legKey)
        seenPlayers.add(playerKey)
        propTypeCounts.set(propTypeKey, (propTypeCounts.get(propTypeKey) || 0) + 1)
        picks.push(row)

        if (picks.length >= 5) break
      }
    }

    if (picks.length < 5) {
      for (const row of candidates) {
        const propTypeKey = String(row?.propType || "").trim().toLowerCase()
        const legKey = [
          String(row?.player || "").trim().toLowerCase(),
          propTypeKey,
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")

        if (seenLegs.has(legKey)) continue
        if ((propTypeCounts.get(propTypeKey) || 0) >= TONIGHTS_SINGLES_MAX_PER_PROP_TYPE) continue

        seenLegs.add(legKey)
        propTypeCounts.set(propTypeKey, (propTypeCounts.get(propTypeKey) || 0) + 1)
        picks.push(row)

        if (picks.length >= 5) break
      }
    }

    if (picks.length < 5) {
      for (const row of candidates) {
        const legKey = [
          String(row?.player || "").trim().toLowerCase(),
          String(row?.propType || "").trim().toLowerCase(),
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")

        if (seenLegs.has(legKey)) continue

        seenLegs.add(legKey)
        picks.push(row)

        if (picks.length >= 5) break
      }
    }

    return picks
  })()

  const tonightsBestLadders = buildBestLadders({
    featuredLadders,
    featuredPlayScore,
    isLaneNativeLadderCandidate,
    maxRows: 6
  })
  const liveSpecialCandidates = Array.isArray(specialBoard) ? specialBoard : []
  const tonightsBestSpecials = buildBestSpecials({
    featuredFirstBasket,
    featuredSpecials,
    liveSpecialRows: liveSpecialCandidates,
    featuredPlayScore,
    maxRows: 7
  })

  const MUST_PLAY_ELIGIBLE_TIERS = new Set(["elite", "strong"])

  const mustPlayCandidates = (() => {
    const mustPlayMarketScore = (row) => {
      const side = String(row?.side || "").toLowerCase()
      const lm = Number.isFinite(Number(row?.lineMove)) ? Number(row.lineMove) : null
      const om = Number.isFinite(Number(row?.oddsMove)) ? Number(row.oddsMove) : null
      let bonus = 0
      if (lm !== null) {
        if (side === "over" && lm < 0) bonus += 2   // line dropped — easier to hit
        if (side === "over" && lm > 0) bonus -= 2   // line rose — harder to hit
        if (side === "under" && lm > 0) bonus += 2  // line rose — easier to hit
        if (side === "under" && lm < 0) bonus -= 2  // line dropped — harder
      }
      if (om !== null) {
        if (om < -3) bonus += 1   // odds shortened — market backing it
        if (om > 10) bonus -= 1   // odds drifted — market fading it
      }
      return bonus
    }

    const laddersSet = new Set(Array.isArray(tonightsBestLadders) ? tonightsBestLadders : [])
    const specialsSet = new Set(Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : [])
    const MUST_PLAY_SPECIAL_TIERS = new Set(["special-elite", "special-strong"])
    const MUST_PLAY_MAX_PER_MATCHUP = 2

    const eligibleSpecials = (Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : []).filter((row) => {
      if (!row) return false
      const tier = String(row?.confidenceTier || "").toLowerCase()
      return MUST_PLAY_SPECIAL_TIERS.has(tier)
    })


    const eligible = [...tonightsBestSingles, ...tonightsBestLadders].filter((row) => {
      if (!row) return false
      const tier = String(row?.confidenceTier || "").toLowerCase()
      return MUST_PLAY_ELIGIBLE_TIERS.has(tier)
    })

    // Group by player|propType — prefer base/default variant, then better market score
    const groupMap = new Map()
    for (const row of eligible) {
      const groupKey = [
        String(row?.player || "").trim().toLowerCase(),
        String(row?.propType || "").trim().toLowerCase()
      ].join("|")
      const existing = groupMap.get(groupKey)
      if (!existing) {
        groupMap.set(groupKey, row)
        continue
      }
      const rowVariant = String(row?.propVariant || "base").toLowerCase()
      const existingVariant = String(existing?.propVariant || "base").toLowerCase()
      const rowIsBase = rowVariant === "base" || rowVariant === "default"
      const existingIsBase = existingVariant === "base" || existingVariant === "default"
      if (rowIsBase && !existingIsBase) {
        groupMap.set(groupKey, row)
      } else if (rowIsBase === existingIsBase) {
        if (mustPlayMarketScore(row) > mustPlayMarketScore(existing)) groupMap.set(groupKey, row)
      }
    }

    const mustPlayPriorityScore = (row) => {
      const conf = Number(row?.playerConfidenceScore || row?.adjustedConfidenceScore || row?.score || 0)
      const tier = String(row?.confidenceTier || "").toLowerCase()
      const tierBonus = tier === "elite" ? 8 : tier === "strong" ? 4 : 0
      const variant = String(row?.propVariant || "base").toLowerCase()
      const baseBonus = (variant === "base" || variant === "default") ? 3 : 0
      const laneBonus = laddersSet.has(row) ? 2 : 6
      return (conf * 100) + (mustPlayMarketScore(row) * 4) + tierBonus + baseBonus + laneBonus
    }

    const preferredEligible = Array.from(groupMap.values())
      .filter(Boolean)
      .sort((a, b) => mustPlayPriorityScore(b) - mustPlayPriorityScore(a))

    const out = []
    const seen = new Set()
    const seenPlayers = new Set()
    const matchupCounts = new Map()

    for (const row of preferredEligible) {
      const groupKey = [
        String(row?.player || "").trim().toLowerCase(),
        String(row?.propType || "").trim().toLowerCase()
      ].join("|")
      if (seen.has(groupKey)) continue
      if (groupMap.get(groupKey) !== row) continue
      const playerKey = String(row?.player || "").trim().toLowerCase()
      const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
      if (playerKey && seenPlayers.has(playerKey)) continue
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= MUST_PLAY_MAX_PER_MATCHUP) continue
      seen.add(groupKey)
      if (playerKey) seenPlayers.add(playerKey)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      out.push(row)
      if (out.length >= 6) break
    }

    if (out.length < 6) {
      for (const row of preferredEligible) {
        const groupKey = [
          String(row?.player || "").trim().toLowerCase(),
          String(row?.propType || "").trim().toLowerCase()
        ].join("|")
        if (seen.has(groupKey)) continue
        const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
        if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= MUST_PLAY_MAX_PER_MATCHUP) continue
        seen.add(groupKey)
        if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
        out.push(row)
        if (out.length >= 6) break
      }
    }

    // Append qualifying specials into remaining slots (up to 6 total)
    const seenSpecialKeys = new Set(out.map((r) => [String(r?.player || "").trim().toLowerCase(), String(r?.propType || "").trim().toLowerCase()].join("|")))
    for (const row of eligibleSpecials) {
      if (out.length >= 6) break
      const groupKey = [String(row?.player || "").trim().toLowerCase(), String(row?.propType || "").trim().toLowerCase()].join("|")
      if (seenSpecialKeys.has(groupKey)) continue
      const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= MUST_PLAY_MAX_PER_MATCHUP) continue
      seenSpecialKeys.add(groupKey)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      out.push(row)
    }

    // Secondary sort: strongest confidence first, market signal as tiebreaker
    out.sort((a, b) => {
      const confDiff = Number(b?.playerConfidenceScore || 0) - Number(a?.playerConfidenceScore || 0)
      if (confDiff !== 0) return confDiff
      return mustPlayMarketScore(b) - mustPlayMarketScore(a)
    })

    return out.map((row, index) => {
      const sourceLane = specialsSet.has(row) ? "bestSpecials" : laddersSet.has(row) ? "bestLadders" : "bestSingles"
      const betType = sourceLane === "bestSpecials" ? "special" : sourceLane === "bestLadders" ? "ladder" : "single"
      const tier = String(row?.confidenceTier || "").toLowerCase()
      const propVariant = String(row?.propVariant || "base").toLowerCase()
      const isAlt = propVariant !== "base" && propVariant !== "default"
      const side = String(row?.side || "")
      const line = row?.line ?? null
      const mks = mustPlayMarketScore(row)
      const gameEdgeScore = Number(row?.gameEdgeScore || 0)
      const roleSignalScore = Number(row?.roleSignalScore || 0)
      const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
      const mustPlayContextScore = Number(Math.min(1, Math.max(0,
        (gameEdgeScore * 0.45) +
        (roleSignalScore * 0.35) +
        (matchupEdgeScore * 0.20)
      )).toFixed(3))

      let mustPlayContextTag = "context-thin"
      if (mustPlayContextScore >= 0.60) mustPlayContextTag = "context-strong"
      else if (mustPlayContextScore >= 0.45) mustPlayContextTag = "context-viable"

      const reasonParts = []
      if (tier === "elite" || tier === "special-elite") reasonParts.push("elite-confidence")
      else if (tier === "strong" || tier === "special-strong") reasonParts.push("strong-confidence")
      reasonParts.push(betType)
      reasonParts.push(isAlt ? "alt" : "base")
      if (mks > 0) reasonParts.push("market-confirmed")
      else if (mks < 0) reasonParts.push("market-drifting")
      else reasonParts.push("stable-market")
      reasonParts.push(mustPlayContextTag)

      const displayLineParts = [side]
      if (line != null) displayLineParts.push(String(line))
      if (isAlt) displayLineParts.push(`(${propVariant})`)

      return {
        ...row,
        mustPlayRank: index + 1,
        mustPlayBetType: betType,
        mustPlaySourceLane: sourceLane,
        mustPlayReasonTag: reasonParts.join("+") || "qualified",
        mustPlayDisplayLine: displayLineParts.join(" ") || null,
        mustPlayContextScore,
        mustPlayContextTag
      }
    })
  })()

  const buildCuratedLayer2Buckets = () => buildCuratedLayer2BucketsHelper({
    corePropsBoard,
    ladderBoard,
    ladderProps,
    lottoBoard,
    parseHitRate,
    dedupeBoardRows,
    shouldRemoveLegForPlayerStatus,
    highestHitRateSortValue,
    bestValueSortValue,
    logger: console.log
  })

  const layer2CuratedBuckets = buildCuratedLayer2Buckets()

  console.log("[FEATURED-PLAYS-DEBUG]", {
    total: featuredPlays.length,
    sourceCounts: {
      core: featuredCore.length,
      ladders: featuredLadders.length,
      firstBasket: featuredFirstBasket.length,
      specials: featuredSpecials.length,
      mustPlays: featuredMustPlays.length
    },
    byPropType: featuredPlays.reduce((acc, row) => {
      const key = String(row?.propType || "Unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    byPropVariant: featuredPlays.reduce((acc, row) => {
      const key = String(row?.propVariant || "base")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    byMarketFamily: featuredPlays.reduce((acc, row) => {
      const key = String(row?.marketFamily || "standard")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    sample: featuredPlays.slice(0, 12).map((row) => ({
      player: row?.player || null,
      propType: row?.propType || null,
      side: row?.side || null,
      line: row?.line ?? null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base",
      marketFamily: row?.marketFamily || null
    }))
  })

  console.log("[GAME-ROLE-EDGE-DEBUG]", {
    gameEdgeBoard: Array.isArray(gameEdgeBoard) ? gameEdgeBoard.length : 0,
    mustPlayBoard: Array.isArray(mustPlayBoard) ? mustPlayBoard.length : 0,
    mustPlayDuplicatesRemoved,
    gameEdgeTop: Array.isArray(gameEdgeBoard)
      ? gameEdgeBoard.slice(0, 5).map((row) => ({
          matchup: row?.matchup || null,
          gameEdgeScore: row?.gameEdgeScore ?? null,
          avgConfidence: row?.avgConfidence ?? null
        }))
      : [],
    mustPlayTop: Array.isArray(mustPlayBoard)
      ? mustPlayBoard.slice(0, 8).map((row) => ({
          player: row?.player || null,
          matchup: row?.matchup || null,
          propType: row?.propType || null,
          marketKey: row?.marketKey || null,
          adjustedConfidenceScore: row?.adjustedConfidenceScore ?? null,
          playDecision: row?.playDecision || null,
          decisionSummary: row?.decisionSummary || null
        }))
      : []
  })

  const buildTonightsLaneAuditRows = (lane, rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return safeRows.map((row, index) => ({
      lane,
      rankWithinLane: index + 1,
      player: row?.player || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base",
      odds: Number(row?.odds ?? 0) || null,
      confidenceTier: row?.confidenceTier || null,
      score: Number(row?.score ?? 0) || null,
      adjustedConfidenceScore: Number(row?.adjustedConfidenceScore ?? 0) || null,
      playerConfidenceScore: Number(row?.playerConfidenceScore ?? 0) || null
    }))
  }

  const boardProgress = {
    snapshotSlateDateKey: oddsSnapshot?.snapshotSlateDateKey || null,
    snapshotSlateGameCount: Number(oddsSnapshot?.snapshotSlateGameCount || 0),
    laneCounts: {
      bestSingles: tonightsBestSingles.length,
      bestLadders: tonightsBestLadders.length,
      bestSpecials: tonightsBestSpecials.length,
      mustPlayCandidates: mustPlayCandidates.length
    },
    curatedCounts: {
      mostLikelyToHit: Array.isArray(layer2CuratedBuckets?.mostLikelyToHit) ? layer2CuratedBuckets.mostLikelyToHit.length : 0,
      bestValue: Array.isArray(layer2CuratedBuckets?.bestValue) ? layer2CuratedBuckets.bestValue.length : 0,
      bestUpside: Array.isArray(layer2CuratedBuckets?.bestUpside) ? layer2CuratedBuckets.bestUpside.length : 0
    },
    mustPlayIncludesSpecials: mustPlayCandidates.some((row) => String(row?.mustPlayBetType || "") === "special" || String(row?.mustPlaySourceLane || "") === "bestSpecials"),
    lineHistoryPresent: Boolean(Number(oddsSnapshot?.lineHistorySummary?.trackedLegs || 0) > 0)
  }

  const tonightsPlaysEvaluation = {
    bestSingles: buildTonightsLaneAuditRows("bestSingles", tonightsBestSingles),
    bestLadders: buildTonightsLaneAuditRows("bestLadders", tonightsBestLadders),
    bestSpecials: buildTonightsLaneAuditRows("bestSpecials", tonightsBestSpecials),
    mustPlayCandidates: buildTonightsLaneAuditRows("mustPlayCandidates", mustPlayCandidates)
  }

  const boards = {
    mustPlayCandidates,
    bestSingles: tonightsBestSingles,
    bestSpecials: tonightsBestSpecials,
    bestLadders: tonightsBestLadders,
    bestLongshots: Array.isArray(lottoPicks) ? lottoPicks : [],
    comboCandidates: Array.isArray(featuredPlays) ? featuredPlays : []
  }

  const {
    safe,
    balanced,
    aggressive,
    lotto,
    highestHitRate2,
    highestHitRate3,
    highestHitRate4,
    highestHitRate5,
    highestHitRate6,
    highestHitRate7,
    highestHitRate8,
    highestHitRate9,
    highestHitRate10,
    payoutFitPortfolio,
    moneyMakerPortfolio,
    ...bestAvailablePayloadBoardFirst
  } = bestAvailablePayload || {}

  const normalizeRuntimeAvailabilityStatus = (row) => {
    const rawStatus = row?.availabilityStatus || row?.playerStatus || row?.status || row?.injuryStatus || ""
    const normalized = normalizePlayerStatusValue(rawStatus)

    if (!normalized) return null
    if (normalized.includes("out") || normalized.includes("inactive") || normalized.includes("suspended") || normalized.includes("not with team") || normalized.includes("dnp")) return "out"
    if (normalized.includes("questionable") || normalized.includes("game time") || normalized.includes("gtd")) return "questionable"
    if (normalized.includes("doubtful")) return "doubtful"
    if (normalized.includes("probable") || normalized.includes("returning") || normalized.includes("minutes") || normalized.includes("limited")) return "probable"
    if (normalized.includes("available") || normalized.includes("active") || normalized.includes("cleared") || normalized.includes("healthy")) return "active"
    return null
  }

  const normalizeRuntimeStarterStatus = (row) => {
    const rawStarter = row?.starterStatus || row?.lineupStatus || row?.startingStatus || row?.startingRole || row?.roleTag || ""
    const normalizedStarter = normalizePlayerStatusValue(rawStarter)
    const normalizedContext = normalizePlayerStatusValue(row?.contextTag || row?.mustPlayContextTag || "")

    if (!normalizedStarter && !normalizedContext) return null
    if (normalizedStarter.includes("starter") || normalizedStarter.includes("starting") || normalizedStarter.includes("first unit")) return "starter"
    if (normalizedStarter.includes("bench") || normalizedStarter.includes("reserve") || normalizedStarter.includes("non starter") || normalizedStarter.includes("second unit")) return "bench"
    if (normalizedContext.includes("starter") || normalizedContext.includes("starting")) return "starter"
    return null
  }

  const buildRuntimeExternalContextTag = (row, availabilityStatus, starterStatus, marketValidity) => {
    const rawContext = normalizePlayerStatusValue(row?.contextTag || row?.mustPlayContextTag || row?.statusTag || "")

    if (availabilityStatus === "out") return "player out"
    if (availabilityStatus === "questionable" || availabilityStatus === "doubtful") return "questionable status"
    if (starterStatus === "starter") return "starter confirmed"
    if (starterStatus === "bench") return "bench role"
    if (rawContext.includes("context strong")) return "positive role context"
    if (rawContext.includes("context viable")) return "role holding"
    if (rawContext.includes("context thin")) return "thin support"
    if (marketValidity === "valid") return "market live"
    return null
  }

  const buildRuntimeExternalSignalInput = (row, extra = {}) => {
    const sourceLane = extra?.sourceLane || extra?.defaultLane || row?.sourceLane || row?.mustPlaySourceLane || null
    const book = String(row?.book || "")
    const isCurrentSurfacedMarket = Boolean(
      row &&
      (sourceLane || row?.marketKey || row?.propType) &&
      row?.odds != null &&
      row?.line != null
    )
    const availabilityStatus = normalizeRuntimeAvailabilityStatus(row)
    const starterStatus = normalizeRuntimeStarterStatus(row)
    const marketValidity = isCurrentSurfacedMarket ? "valid" : null
    const contextTag = buildRuntimeExternalContextTag(row, availabilityStatus, starterStatus, marketValidity)
    const hasRuntimeStatusEvidence = Boolean(availabilityStatus || starterStatus)
    const sourceName = book === "DraftKings" ? "draftkings_live_board" : null

    return {
      sourceName,
      availabilityStatus,
      starterStatus,
      marketValidity,
      contextTag,
      __runtimeLocalSourceName: hasRuntimeStatusEvidence ? "runtime_row_signal" : sourceName,
      __hasAvailabilityEvidence: Boolean(availabilityStatus),
      __hasStarterEvidence: Boolean(starterStatus)
    }
  }

  const buildSourceLevelAvailabilitySignalMap = () => {
    const sourceRows = [
      ...(Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps : []),
      ...(Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])
    ]

    const signalMap = new Map()
    const nbaOfficialRuntimeInputCandidates = [
      oddsSnapshot?.nbaOfficialInjuryReport,
      oddsSnapshot?.nbaOfficialInjuries,
      oddsSnapshot?.injuryReports?.nbaOfficial,
      oddsSnapshot?.externalInjuries?.nbaOfficial,
      oddsSnapshot?.externalSignals?.nbaOfficialInjuryReport,
      oddsSnapshot?.sourceFeeds?.nbaOfficialInjuryReport
    ]
    const nbaOfficialRuntimeInput = nbaOfficialRuntimeInputCandidates.find((value) => {
      if (Array.isArray(value)) return value.length > 0
      return Boolean(value && typeof value === "object")
    }) || null

    const countRuntimeInputRows = (value) => {
      if (!value) return 0
      if (Array.isArray(value)) return value.length
      if (typeof value !== "object") return 0
      const listKeys = ["reports", "injuries", "players", "rows", "data", "items", "entries"]
      for (const key of listKeys) {
        if (Array.isArray(value?.[key])) return value[key].length
      }
      return 1
    }

    const nbaOfficialRuntimeInputRows = countRuntimeInputRows(nbaOfficialRuntimeInput)
    const ingestedNbaOfficialRows = nbaOfficialRuntimeInput
      ? ingestNbaOfficialInjuryReport(nbaOfficialRuntimeInput)
      : []
    const rotoWireRuntimeInputCandidates = [
      oddsSnapshot?.rotoWireSignals,
      oddsSnapshot?.rotoWireStatus,
      oddsSnapshot?.rotoWireLineups,
      oddsSnapshot?.injuryReports?.rotoWire,
      oddsSnapshot?.externalSignals?.rotoWire,
      oddsSnapshot?.sourceFeeds?.rotoWire
    ]
    const dailyOverlayRuntimeFilePath = path.join(__dirname, "runtime_inputs", "daily_overlay.json")
    const legacyRotoWireRuntimeFilePath = path.join(__dirname, "runtime_inputs", "rotowire_signals.json")
    let rotoWireRuntimeFileChecked = true
    let rotoWireRuntimeFileExists = false
    let rotoWireRuntimeFileRows = 0
    let rotoWireRuntimeFileInput = null
    let manualOverlaySource = "manual-overlay-unavailable"
    let manualOverlayPath = "backend/runtime_inputs/daily_overlay.json"

    try {
      const parseRuntimeOverlayFile = (filePath) => {
        if (!fs.existsSync(filePath)) return null
        const rawFile = fs.readFileSync(filePath, "utf-8")
        const parsedFile = JSON.parse(rawFile)
        const hasData = Array.isArray(parsedFile)
          ? parsedFile.length > 0
          : Boolean(parsedFile && typeof parsedFile === "object")
        return hasData ? parsedFile : null
      }

      const preferredOverlayInput = parseRuntimeOverlayFile(dailyOverlayRuntimeFilePath)
      if (preferredOverlayInput) {
        rotoWireRuntimeFileInput = preferredOverlayInput
        rotoWireRuntimeFileExists = true
        manualOverlaySource = "manual-overlay-daily"
        manualOverlayPath = "backend/runtime_inputs/daily_overlay.json"
      } else {
        const legacyOverlayInput = parseRuntimeOverlayFile(legacyRotoWireRuntimeFilePath)
        if (legacyOverlayInput) {
          rotoWireRuntimeFileInput = legacyOverlayInput
          rotoWireRuntimeFileExists = true
          manualOverlaySource = "manual-overlay-legacy-rotowire"
          manualOverlayPath = "backend/runtime_inputs/rotowire_signals.json"
        } else {
          rotoWireRuntimeFileExists = fs.existsSync(dailyOverlayRuntimeFilePath) || fs.existsSync(legacyRotoWireRuntimeFilePath)
        }
      }
    } catch (_) {
      rotoWireRuntimeFileInput = null
      manualOverlaySource = "manual-overlay-unavailable"
      manualOverlayPath = "backend/runtime_inputs/daily_overlay.json"
    }

    const rotoWireRuntimeInput = rotoWireRuntimeInputCandidates.find((value) => {
      if (Array.isArray(value)) return value.length > 0
      return Boolean(value && typeof value === "object")
    }) || rotoWireRuntimeFileInput || null
    const rotoWireRuntimeInputRows = countRuntimeInputRows(rotoWireRuntimeInput)
    rotoWireRuntimeFileRows = countRuntimeInputRows(rotoWireRuntimeFileInput)
    const ingestedRotoWireRows = rotoWireRuntimeInput
      ? ingestRotoWireSignals(rotoWireRuntimeInput)
      : []

    let rowsWithStatusEvidence = 0
    let adaptedSignalsCreated = 0
    let adaptedSignalsWithAvailability = 0
    let adaptedSignalsWithStarter = 0
    let nbaOfficialSignalsWithAvailability = 0
    let nbaOfficialSignalsMerged = 0
    let rotoWireSignalsWithAvailability = 0
    let rotoWireSignalsWithStarter = 0
    let rotoWireSignalsMerged = 0
    let rotoWireRuntimeFileSignalsMerged = 0

    for (const ingested of ingestedNbaOfficialRows) {
      if (!ingested?.playerKey) continue

      const hasAvailabilityEvidence = ingested.availabilityStatus && ingested.availabilityStatus !== "unknown"
      if (hasAvailabilityEvidence) nbaOfficialSignalsWithAvailability += 1

      const candidateSignal = {
        sourceName: ingested.sourceName || "nba_official_injury_report",
        availabilityStatus: hasAvailabilityEvidence ? ingested.availabilityStatus : null,
        starterStatus: null,
        contextTag: ingested.contextTag || null,
        __runtimeLocalSourceName: ingested.sourceName || "nba_official_injury_report",
        __hasAvailabilityEvidence: Boolean(hasAvailabilityEvidence),
        __hasStarterEvidence: false,
        __adapterFed: true,
        __evidenceScore: hasAvailabilityEvidence ? 3 : 0
      }

      const existing = signalMap.get(ingested.playerKey)
      if (!existing || Number(candidateSignal.__evidenceScore) > Number(existing.__evidenceScore || 0)) {
        signalMap.set(ingested.playerKey, candidateSignal)
        nbaOfficialSignalsMerged += 1
      }
    }

    for (const ingested of ingestedRotoWireRows) {
      if (!ingested?.playerKey) continue

      const hasAvailabilityEvidence = ingested.availabilityStatus && ingested.availabilityStatus !== "unknown"
      const hasStarterEvidence = ingested.starterStatus && ingested.starterStatus !== "unknown"
      if (hasAvailabilityEvidence) rotoWireSignalsWithAvailability += 1
      if (hasStarterEvidence) rotoWireSignalsWithStarter += 1

      const candidateSignal = {
        sourceName: ingested.sourceName || "rotowire",
        availabilityStatus: hasAvailabilityEvidence ? ingested.availabilityStatus : null,
        starterStatus: hasStarterEvidence ? ingested.starterStatus : null,
        contextTag: ingested.contextTag || null,
        __runtimeLocalSourceName: ingested.sourceName || "rotowire",
        __hasAvailabilityEvidence: Boolean(hasAvailabilityEvidence),
        __hasStarterEvidence: Boolean(hasStarterEvidence),
        __adapterFed: true,
        __evidenceScore: (hasAvailabilityEvidence ? 2 : 0) + (hasStarterEvidence ? 2 : 0)
      }

      const existing = signalMap.get(ingested.playerKey)
      if (!existing || Number(candidateSignal.__evidenceScore) > Number(existing.__evidenceScore || 0)) {
        signalMap.set(ingested.playerKey, candidateSignal)
        rotoWireSignalsMerged += 1
        if (rotoWireRuntimeFileInput && !rotoWireRuntimeInputCandidates.some((value) => value === rotoWireRuntimeInput)) {
          rotoWireRuntimeFileSignalsMerged += 1
        }
      }
    }

    for (const row of sourceRows) {
      if (!row?.player) continue

      const rawAvailability = row?.availabilityStatus || row?.playerStatus || row?.status || row?.injuryStatus || null
      const rawStarter = row?.starterStatus || row?.lineupStatus || row?.startingStatus || row?.startingRole || row?.roleTag || null
      const rawContext = row?.contextTag || row?.mustPlayContextTag || row?.statusTag || null

      if (!rawAvailability && !rawStarter) continue
      rowsWithStatusEvidence += 1

      const sourceHint =
        row?.statusSource ||
        row?.availabilitySource ||
        row?.lineupSource ||
        row?.newsSource ||
        row?.sourceName ||
        row?.source ||
        row?.provider ||
        "nba_official_injury_report"

      const adaptedSignal = adaptAvailabilitySignal({
        sourceName: sourceHint,
        playerName: row.player,
        status: rawAvailability,
        starterStatus: rawStarter,
        contextTag: rawContext
      })

      if (!adaptedSignal?.playerKey) continue
      adaptedSignalsCreated += 1

      const hasAvailabilityEvidence = adaptedSignal.availabilityStatus && adaptedSignal.availabilityStatus !== "unknown"
      const hasStarterEvidence = adaptedSignal.starterStatus && adaptedSignal.starterStatus !== "unknown"
      if (hasAvailabilityEvidence) adaptedSignalsWithAvailability += 1
      if (hasStarterEvidence) adaptedSignalsWithStarter += 1

      const candidateSignal = {
        sourceName: adaptedSignal.sourceName,
        availabilityStatus: hasAvailabilityEvidence ? adaptedSignal.availabilityStatus : null,
        starterStatus: hasStarterEvidence ? adaptedSignal.starterStatus : null,
        contextTag: adaptedSignal.contextTag || null,
        __runtimeLocalSourceName: adaptedSignal.sourceName,
        __hasAvailabilityEvidence: Boolean(hasAvailabilityEvidence),
        __hasStarterEvidence: Boolean(hasStarterEvidence),
        __adapterFed: true,
        __evidenceScore: (hasAvailabilityEvidence ? 2 : 0) + (hasStarterEvidence ? 1 : 0)
      }

      const existing = signalMap.get(adaptedSignal.playerKey)
      if (!existing || Number(candidateSignal.__evidenceScore) > Number(existing.__evidenceScore || 0)) {
        signalMap.set(adaptedSignal.playerKey, candidateSignal)
      }
    }

    return {
      signalMap,
      diagnostics: {
        phase2bNbaOfficialRuntimeInputAvailable: Boolean(nbaOfficialRuntimeInput),
        phase2bNbaOfficialRuntimeInputRows: nbaOfficialRuntimeInputRows,
        phase2bNbaOfficialIngestedRows: ingestedNbaOfficialRows.length,
        phase2bNbaOfficialSignalsWithAvailability: nbaOfficialSignalsWithAvailability,
        phase2bNbaOfficialSignalsMerged: nbaOfficialSignalsMerged,
        phase2bNbaOfficialRuntimeInputMissing: !nbaOfficialRuntimeInput,
        phase2bRotoWireRuntimeInputAvailable: Boolean(rotoWireRuntimeInput),
        phase2bRotoWireRuntimeInputRows: rotoWireRuntimeInputRows,
        phase2bRotoWireIngestedRows: ingestedRotoWireRows.length,
        phase2bRotoWireSignalsWithAvailability: rotoWireSignalsWithAvailability,
        phase2bRotoWireSignalsWithStarter: rotoWireSignalsWithStarter,
        phase2bRotoWireSignalsMerged: rotoWireSignalsMerged,
        phase2bRotoWireRuntimeInputMissing: !rotoWireRuntimeInput,
        phase2bManualOverlayAvailable: Boolean(rotoWireRuntimeFileInput),
        phase2bManualOverlaySource: manualOverlaySource,
        phase2bManualOverlayRows: rotoWireRuntimeFileRows,
        phase2bManualOverlayPath: manualOverlayPath,
        phase2bRotoWireRuntimeFileChecked: rotoWireRuntimeFileChecked,
        phase2bRotoWireRuntimeFileExists: rotoWireRuntimeFileExists,
        phase2bRotoWireRuntimeFileRows: rotoWireRuntimeFileRows,
        phase2bRotoWireRuntimeFileSignalsMerged: rotoWireRuntimeFileSignalsMerged,
        phase2bExternalIngestionRowsScanned: sourceRows.length,
        phase2bExternalIngestionRowsWithStatusEvidence: rowsWithStatusEvidence,
        phase2bExternalIngestionSignalsAdapted: adaptedSignalsCreated,
        phase2bExternalIngestionSignalsWithAvailability: adaptedSignalsWithAvailability,
        phase2bExternalIngestionSignalsWithStarter: adaptedSignalsWithStarter,
        phase2bExternalIngestionUniquePlayerKeys: signalMap.size,
        phase2bExternalIngestionNoSourceStatusInputs: rowsWithStatusEvidence === 0
      }
    }
  }

  const externalAvailabilityIngestion = buildSourceLevelAvailabilitySignalMap()
  const externalAvailabilitySignalMap = externalAvailabilityIngestion.signalMap

  const buildAdapterAvailabilitySignalForRow = (row) => {
    const playerKey = toPlayerKey(row?.player)
    if (!playerKey) return null
    return externalAvailabilitySignalMap.get(playerKey) || null
  }

  const buildOverlayExternalSignalInput = (row, extra = {}) => {
    const existingSignals = row?.externalSignals || row?.externalSignal || row?.externalSources || null
    const adapterSignal = buildAdapterAvailabilitySignalForRow(row)
    const runtimeSignal = buildRuntimeExternalSignalInput(row, extra)
    const combinedSignals = []

    if (adapterSignal) combinedSignals.push(adapterSignal)
    if (Array.isArray(existingSignals)) combinedSignals.push(...existingSignals)
    else if (existingSignals && typeof existingSignals === "object") combinedSignals.push(existingSignals)
    if (runtimeSignal) combinedSignals.push(runtimeSignal)

    if (combinedSignals.length === 0) return null
    if (combinedSignals.length === 1) return combinedSignals[0]
    return combinedSignals
  }

  const resolveSurfaceTeam = (row) => {
    const canonicalTeam = resolveCanonicalPlayerTeamForRow(row)
    if (canonicalTeam && rowTeamMatchesMatchup({ ...row, team: canonicalTeam })) return canonicalTeam

    const playerTeam = String(row?.playerTeam || "").trim()
    if (playerTeam && rowTeamMatchesMatchup({ ...row, team: playerTeam })) return playerTeam

    const rawTeam = String(row?.team || "").trim()
    if (rawTeam && rowTeamMatchesMatchup(row)) return rawTeam

    return playerTeam || rawTeam || null
  }

  const buildReadableSurfaceRow = createSurfaceRowBuilder({ buildOverlayExternalSignalInput, resolveSurfaceTeam })

  const buildCompactPreviewRows = (rows, limit = 4) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return safeRows.slice(0, limit).map((row) => {
      const isTrueFirstBasket = isFirstBasketLikeRow(row)
      const isFallbackSpecialLike = !isTrueFirstBasket && isSpecialLikeFallbackCandidate(row)
      return {
        player: row?.player || null,
        team: row?.team || null,
        marketKey: row?.marketKey || null,
        propType: row?.propType || null,
        line: row?.line ?? null,
        odds: Number(row?.odds ?? 0) || null,
        propVariant: row?.propVariant || "base",
        confidenceTier: row?.confidenceTier || null,
        adjustedConfidenceScore: Number(row?.adjustedConfidenceScore ?? 0) || null,
        playerConfidenceScore: Number(row?.playerConfidenceScore ?? 0) || null,
        rowKind: isTrueFirstBasket ? "true-first-basket" : isFallbackSpecialLike ? "fallback-special-like" : "other"
      }
    })
  }

  const surfacedRowsPreviewDiagnostics = {
    firstBasketBoardPreview: buildCompactPreviewRows(firstBasketBoard, 5),
    firstBasketPicksPreview: buildCompactPreviewRows(firstBasketPicks, 5),
    featuredPlaysPreview: buildCompactPreviewRows(featuredPlays, 5),
    tonightsPlaysPreview: {
      bestSingles: buildCompactPreviewRows(tonightsBestSingles, 4),
      bestLadders: buildCompactPreviewRows(tonightsBestLadders, 4),
      bestSpecials: buildCompactPreviewRows(tonightsBestSpecials, 4),
      mustPlayCandidates: buildCompactPreviewRows(mustPlayCandidates, 4)
    }
  }

  const firstBasketFallbackDiagnostics = {
    trueTeamFirstBasketRows: trueTeamFirstBasketRowsForBoard.length,
    specialLikeFallbackActivated: useSpecialLikeFirstBasketFallback,
    specialLikeFallbackRows: specialLikeFallbackBoardRows.length
  }

  const countByMarketKey = (rows, marketKey) =>
    (Array.isArray(rows) ? rows : []).filter((row) => String(row?.marketKey || "") === marketKey).length

  const rawFirstBasketSourceRows = Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length > 0
    ? oddsSnapshot.rawProps
    : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])

  const firstBasketPipelineDiagnostics = {
    rawFirstBasketRowsSeen: countByMarketKey(rawFirstBasketSourceRows, "player_first_basket"),
    rawFirstTeamBasketRowsSeen: countByMarketKey(rawFirstBasketSourceRows, "player_first_team_basket"),
    visibleFirstBasketRowsForBoards: countByMarketKey(allVisibleRowsForBoards, "player_first_basket"),
    visibleFirstTeamBasketRowsForBoards: countByMarketKey(allVisibleRowsForBoards, "player_first_team_basket"),
    specialBoardFirstBasketCount: countByMarketKey(specialBoard, "player_first_basket"),
    specialBoardFirstTeamBasketCount: countByMarketKey(specialBoard, "player_first_team_basket"),
    liveSpecialCandidatesFirstBasketCount: countByMarketKey(liveSpecialCandidates, "player_first_basket"),
    liveSpecialCandidatesFirstTeamBasketCount: countByMarketKey(liveSpecialCandidates, "player_first_team_basket"),
    firstBasketBoardFirstBasketCount: countByMarketKey(firstBasketBoard, "player_first_basket"),
    firstBasketBoardFirstTeamBasketCount: countByMarketKey(firstBasketBoard, "player_first_team_basket")
  }

  const externalAvailabilityIngestionDiagnostics = {
    ...(externalAvailabilityIngestion?.diagnostics && typeof externalAvailabilityIngestion.diagnostics === "object"
      ? externalAvailabilityIngestion.diagnostics
      : {})
  }

  const mergedBestAvailableDiagnostics = {
    ...(bestAvailablePayloadBoardFirst?.diagnostics && typeof bestAvailablePayloadBoardFirst.diagnostics === "object"
      ? bestAvailablePayloadBoardFirst.diagnostics
      : {}),
    ...firstBasketFallbackDiagnostics,
    ...firstBasketPipelineDiagnostics,
    ...externalAvailabilityIngestionDiagnostics,
    ...surfacedRowsPreviewDiagnostics
  }

  const mergedBestAvailablePoolDiagnostics = {
    ...(bestAvailablePayloadBoardFirst?.poolDiagnostics && typeof bestAvailablePayloadBoardFirst.poolDiagnostics === "object"
      ? bestAvailablePayloadBoardFirst.poolDiagnostics
      : {}),
    ...firstBasketFallbackDiagnostics,
    ...firstBasketPipelineDiagnostics,
    ...externalAvailabilityIngestionDiagnostics,
    ...surfacedRowsPreviewDiagnostics
  }

  let finalBettingNowNullDecisionSpecialsFiltered = 0
  let finalDecisionCalibratorPromotedStrong = 0
  let finalDecisionCalibratorPromotedMust = 0

  const buildBettingNowView = () => {
    finalBettingNowNullDecisionSpecialsFiltered = 0
    finalDecisionCalibratorPromotedStrong = 0
    finalDecisionCalibratorPromotedMust = 0
    const candidatePools = [
      { rows: mustPlayCandidates, getLane: (r) => r?.mustPlaySourceLane || "unknown", limit: 6 },
      { rows: tonightsBestSingles, getLane: () => "bestSingles", limit: 4 },
      { rows: tonightsBestLadders, getLane: () => "bestLadders", limit: 3 },
      { rows: tonightsBestSpecials, getLane: () => "bestSpecials", limit: 4 }
    ]

    // First pass: strict diversity (no duplicate players, max 1 per matchup)
    const strictPass = () => {
      const tempOut = []
      const seenPlayers = new Set()
      const seenMatchups = new Set()
      
      for (const pool of candidatePools) {
        const safeRows = Array.isArray(pool.rows) ? pool.rows : []
        for (let i = 0; i < Math.min(pool.limit, safeRows.length) && tempOut.length < 10; i++) {
          const row = safeRows[i]
          if (!row) continue
          
          const sourceLane = pool.getLane(row)
          const playerKey = String(row?.player || "").trim().toLowerCase()
          const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
          
          // Skip if player already in output
          if (playerKey && seenPlayers.has(playerKey)) continue
          
          // Skip if matchup already has a row
          if (matchupKey && seenMatchups.has(matchupKey)) continue
          
          seenPlayers.add(playerKey)
          seenMatchups.add(matchupKey)
          
          tempOut.push(buildReadableSurfaceRow(row, {
            rank: tempOut.length + 1,
            sourceLane,
            sourceRank: i + 1,
            _matchupKey: matchupKey
          }))
        }
      }
      return tempOut
    }

    // Fallback pass: lenient fill if strict pass didn't reach target
    const fallbackFill = (baseOut, baseTarget = 10) => {
      if (baseOut.length >= baseTarget) return baseOut
      
      const result = [...baseOut]
      const matchupCounts = new Map()
      
      for (const r of baseOut) {
        if (r._matchupKey) {
          matchupCounts.set(r._matchupKey, (matchupCounts.get(r._matchupKey) || 0) + 1)
        }
      }
      
      // Try to add remaining rows with max 2 per matchup, but allow duplicate players from different lanes
      for (const pool of candidatePools) {
        const safeRows = Array.isArray(pool.rows) ? pool.rows : []
        for (let i = 0; i < safeRows.length && result.length < baseTarget; i++) {
          const row = safeRows[i]
          if (!row) continue
          
          const sourceLane = pool.getLane(row)
          const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
          
          // Check if this exact row is already in result (by checking all fields)
          const isDuplicate = result.some((r) => 
            r.player === row?.player && 
            r.propType === (row?.propType || null) && 
            r.marketKey === (row?.marketKey || null) &&
            r.side === (row?.side || null)
          )
          if (isDuplicate) continue
          
          // Allow max 2 per matchup in fallback
          if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= 2) continue
          
          const newRow = buildReadableSurfaceRow(row, {
            rank: result.length + 1,
            sourceLane,
            sourceRank: i + 1
          })
          
          result.push(newRow)
          if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
        }
      }
      
      return result
    }

    const strictPhaseOut = strictPass()
    const filled = fallbackFill(strictPhaseOut)
    const nonAvoidOrFade = filled.filter((row) => {
      const playDecision = String(row?.playDecision || "").toLowerCase()
      return !playDecision.includes("avoid") && !playDecision.includes("fade")
    })

    // Final gate: same definition as the smoke test so the check here = what the test sees
    const isSurfacedSpecialRow = (row) => {
      const text = [
        row?.marketKey,
        row?.propType,
        row?.sourceLane,
        row?.mustPlayBetType,
        row?.mustPlaySourceLane,
      ].filter(Boolean).join(" ").toLowerCase()
      return [
        "first_basket",
        "first basket",
        "first_team_basket",
        "first team basket",
        "double_double",
        "double double",
        "triple_double",
        "triple double",
        "special",
        "bestspecials",
      ].some((x) => text.includes(x))
    }

    const surfacedEligible = nonAvoidOrFade.filter((row) => {
      const hasDecisionBacking = Boolean(String(row?.playDecision || "").trim()) || Boolean(String(row?.decisionSummary || "").trim())
      if (isSurfacedSpecialRow(row) && !hasDecisionBacking) {
        finalBettingNowNullDecisionSpecialsFiltered += 1
        return false
      }
      return true
    })

    // Separate and rebuild so specials cannot occupy rank 1 or exceed 1 in top 3
  const corePool = surfacedEligible.filter((row) => !isSurfacedSpecialRow(row))
  const specialPool = surfacedEligible.filter((row) => isSurfacedSpecialRow(row))
    const rebuilt = []
    let cIdx = 0
    let sIdx = 0
    let specialsInTop3 = 0
    while (rebuilt.length < 10) {
      const rank = rebuilt.length + 1
      const nextCore = corePool[cIdx]
      const nextSpecial = specialPool[sIdx]
      if (!nextCore && !nextSpecial) break
      if (!nextCore) { rebuilt.push(nextSpecial); sIdx++; continue }
      if (!nextSpecial) { rebuilt.push(nextCore); cIdx++; continue }
      // Rank 1 must be core
      if (rank === 1) { rebuilt.push(nextCore); cIdx++; continue }
      // Top 3: max 1 special
      if (rank <= 3 && specialsInTop3 < 1) {
        rebuilt.push(nextSpecial); sIdx++; specialsInTop3++; continue
      }
      // Default: prefer core to keep singles/ladders anchored
      rebuilt.push(nextCore); cIdx++
    }

    const orderedRows = rebuilt.map(({ _matchupKey, rank: _r, ...row }, idx) => ({ ...row, rank: idx + 1 }))

    // Final post-ranking calibrator for surfaced bettingNow rows only.
    // Keeps order fixed and only adjusts decision labels/buckets conservatively for core rows.
    let promotedMustUsed = false
    return orderedRows.map((row, idx) => {
      const isSpecial = isSurfacedSpecialRow(row)
      if (isSpecial) return row

      const currentLabel = String(row?.finalDecisionLabel || "").toLowerCase()
      if (currentLabel === "sit" || currentLabel === "must-play") return row

      const hasSitReason = Boolean(String(row?.sitReason || "").trim())
      if (hasSitReason) return row

      const availability = String(row?.availabilityStatus || "").toLowerCase()
      if (availability === "out" || availability === "doubtful") return row
      const isQuestionable = availability === "questionable"

      const score = Number(row?.finalDecisionScore)
      if (!Number.isFinite(score)) return row

      const starterStatus = String(row?.starterStatus || "").toLowerCase()
      const externalEdgeLabel = String(row?.externalEdgeLabel || "").toLowerCase()
      const contextSummary = String(row?.supportEdge?.contextSummary || "").toLowerCase()
      const marketSummary = String(row?.marketEdge?.marketSummary || "").toLowerCase()
      const riskSummary = String(row?.riskEdge?.riskSummary || "").toLowerCase()
      const contextEdgeScore = Number(row?.supportEdge?.contextEdgeScore)

      let supportSignals = 0
      if (starterStatus === "starter") supportSignals += 1
      if (externalEdgeLabel.includes("upgrade")) supportSignals += 1
      if (contextSummary === "strong-support" || (Number.isFinite(contextEdgeScore) && contextEdgeScore >= 78)) supportSignals += 1
      if (contextSummary === "viable-support") supportSignals += 1
      if (marketSummary !== "market-adverse") supportSignals += 1
      if (riskSummary !== "risk-fragile") supportSignals += 1

      const isTopCoreSlot = idx < 4
      const questionableExceptionalEligible =
        isQuestionable &&
        isTopCoreSlot &&
        score >= 62 &&
        supportSignals >= 5 &&
        starterStatus === "starter" &&
        externalEdgeLabel.includes("upgrade") &&
        (contextSummary === "strong-support" || (Number.isFinite(contextEdgeScore) && contextEdgeScore >= 82)) &&
        marketSummary !== "market-adverse" &&
        riskSummary !== "risk-fragile"

      const strongEligible =
        isTopCoreSlot &&
        ((isQuestionable && questionableExceptionalEligible) || (!isQuestionable && score >= 49)) &&
        riskSummary !== "risk-fragile" &&
        supportSignals >= (isQuestionable ? 5 : 3) &&
        currentLabel === "playable"

      if (!strongEligible && currentLabel !== "strong-play") return row

      let nextLabel = currentLabel
      if (strongEligible) {
        nextLabel = "strong-play"
        finalDecisionCalibratorPromotedStrong += 1
      }

      const hasStrongContext =
        contextSummary === "strong-support" ||
        (Number.isFinite(contextEdgeScore) && contextEdgeScore >= 82)
      const hasSupportiveExternalState = externalEdgeLabel.includes("upgrade")
      const hasSafeMustAvailability =
        availability !== "out" &&
        availability !== "doubtful" &&
        availability !== "questionable"

      const mustEligible =
        !promotedMustUsed &&
        idx < 2 &&
        nextLabel === "strong-play" &&
        score >= 68 &&
        supportSignals >= 5 &&
        hasSafeMustAvailability &&
        starterStatus === "starter" &&
        hasStrongContext &&
        hasSupportiveExternalState &&
        marketSummary !== "market-adverse" &&
        riskSummary !== "risk-fragile"

      if (mustEligible) {
        nextLabel = "must-play"
        promotedMustUsed = true
        finalDecisionCalibratorPromotedMust += 1
      }

      const nextBucket =
        nextLabel === "must-play" ? "must-play"
        : nextLabel === "strong-play" ? "strong-play"
        : nextLabel === "playable" ? "playable"
        : nextLabel === "special-only" ? "special-only"
        : "sit"

      return {
        ...row,
        finalDecisionLabel: nextLabel,
        decisionBucket: nextBucket
      }
    })
  }

  const bettingNow = buildBettingNowView()
  mergedBestAvailableDiagnostics.finalBettingNowNullDecisionSpecialsFiltered = finalBettingNowNullDecisionSpecialsFiltered
  mergedBestAvailableDiagnostics.finalDecisionCalibratorPromotedStrong = finalDecisionCalibratorPromotedStrong
  mergedBestAvailableDiagnostics.finalDecisionCalibratorPromotedMust = finalDecisionCalibratorPromotedMust
  mergedBestAvailablePoolDiagnostics.finalBettingNowNullDecisionSpecialsFiltered = finalBettingNowNullDecisionSpecialsFiltered
  mergedBestAvailablePoolDiagnostics.finalDecisionCalibratorPromotedStrong = finalDecisionCalibratorPromotedStrong
  mergedBestAvailablePoolDiagnostics.finalDecisionCalibratorPromotedMust = finalDecisionCalibratorPromotedMust

  const buildSlateBoardView = () => {
    const lanePools = [
      { lane: "mustPlayCandidates", rows: Array.isArray(mustPlayBoard) ? mustPlayBoard : [], limit: 24 },
      { lane: "bestSingles", rows: Array.isArray(corePropsBoard) ? corePropsBoard : [], limit: 48 },
      { lane: "bestLadders", rows: Array.isArray(ladderBoard) ? ladderBoard : [], limit: 40 },
      { lane: "bestSpecials", rows: Array.isArray(specialBoard) ? specialBoard : [], limit: 40 }
    ]

    const buildSlateLegKey = (row) => {
      return [
        String(row?.matchup || row?.eventId || "").trim().toLowerCase(),
        String(row?.player || "").trim().toLowerCase(),
        String(row?.marketKey || "").trim().toLowerCase(),
        String(row?.propType || "").trim().toLowerCase(),
        String(row?.side || "").trim().toLowerCase(),
        String(row?.line ?? ""),
        String(row?.propVariant || "base").trim().toLowerCase()
      ].join("|")
    }

    const laneCapsByMatchup = {
      mustPlayCandidates: 2,
      bestSingles: 4,
      bestLadders: 3,
      bestSpecials: 3
    }

    const seenLegs = new Set()
    const groupedByMatchup = new Map()

    for (const pool of lanePools) {
      const lane = pool.lane
      const rows = Array.isArray(pool.rows) ? pool.rows : []
      const limit = Number(pool.limit || 0)

      for (let i = 0; i < rows.length && i < limit; i++) {
        const row = rows[i]
        if (!row) continue
        const legKey = buildSlateLegKey(row)
        if (seenLegs.has(legKey)) continue

        const matchup = String(row?.matchup || row?.eventId || "").trim() || "Unknown"
        const matchupKey = matchup.toLowerCase()
        const laneCap = laneCapsByMatchup[lane] || 2

        if (!groupedByMatchup.has(matchupKey)) {
          groupedByMatchup.set(matchupKey, {
            matchup,
            rows: [],
            laneCounts: new Map()
          })
        }

        const bucket = groupedByMatchup.get(matchupKey)
        const laneCount = bucket.laneCounts.get(lane) || 0
        if (laneCount >= laneCap) continue
        if (bucket.rows.length >= 12) continue

        seenLegs.add(legKey)
        bucket.laneCounts.set(lane, laneCount + 1)
        bucket.rows.push({
          ...buildReadableSurfaceRow(row, {
            sourceLane: lane,
            sourceRank: i + 1
          }),
          team: row?.team || null,
          matchup: row?.matchup || row?.eventId || null,
          eventId: row?.eventId || null
        })
      }
    }

    const matchups = Array.from(groupedByMatchup.values())
      .filter((bucket) => Array.isArray(bucket.rows) && bucket.rows.length > 0)
      .sort((a, b) => b.rows.length - a.rows.length)
      .map((bucket) => ({
        matchup: bucket.matchup,
        totalRows: bucket.rows.length,
        rows: bucket.rows
      }))

    return {
      totalMatchups: matchups.length,
      totalRows: matchups.reduce((acc, bucket) => acc + bucket.totalRows, 0),
      matchups
    }
  }

  const slateBoard = buildSlateBoardView()
  const specialtyPlayerTeamIndex = buildCanonicalSpecialtyPlayerTeamIndex(allVisibleRowsForBoards)

  const specialtyOutputs = buildSpecialtyOutputs({
    specialBoard,
    firstBasketBoard,
    tonightsBestSpecials,
    featuredPlays,
    countByMarketKey,
    specialtyPlayerTeamIndex,
    typeSliceLimit: 4,
    laneSliceLimit: 6
  })

  let finalTopSpecialsNullDecisionFilteredCount = Number(
    specialtyOutputs?.filteredTopSpecials?.nullDecisionFilteredCount || 0
  )

  const specialsAudit = specialtyOutputs?.specialsAudit || {
    totalCandidates: 0,
    countsByType: {
      firstBasket: 0,
      firstTeamBasket: 0,
      doubleDouble: 0,
      tripleDouble: 0,
      otherSpecials: 0
    },
    surfacedAuditFirstBasketCount: 0,
    surfacedAuditFirstTeamBasketCount: 0,
    auditSource: "specialBoard",
    auditSourceExcludesFirstBasketByDesign: true,
    routedFirstBasketRowsInFirstBasketBoard: 0,
    routedFirstTeamBasketRowsInFirstBasketBoard: 0,
    groupedByType: {
      firstBasket: [],
      firstTeamBasket: [],
      doubleDouble: [],
      tripleDouble: [],
      otherSpecials: []
    },
    surfacedBestSpecialsCount: 0
  }

  const mapSpecialRowsForSurface = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => buildReadableSurfaceRow(row, {
      defaultLane: "bestSpecials",
      sourceLane: row?.sourceLane || "bestSpecials"
    }))

  const typeAwareSpecialsRaw = specialtyOutputs?.typeAwareSpecials || {}
  const typeAwareSpecials = {
    bestDoubleDoubles: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestDoubleDoubles),
    bestTripleDoubles: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestTripleDoubles),
    bestFirstBasket: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestFirstBasket),
    bestFirstTeamBasket: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestFirstTeamBasket),
    bestLongshotPlays: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestLongshotPlays),
    bestLongshotSpecials: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestLongshotPlays)
  }

  const specialtyLaneOutputsRaw = specialtyOutputs?.specialtyLaneOutputs || {}
  const specialtyLaneOutputs = {
    firstBasket: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.firstBasket),
    firstTeamBasket: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.firstTeamBasket),
    specials: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.specials),
    featured: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.featured)
  }

  const buildTopCardView = () => {
    const compactRow = (row, defaultLane) => buildReadableSurfaceRow(row, { defaultLane })
    const filteredTopSpecials = specialtyOutputs?.filteredTopSpecials?.rows || []

    return {
      topSingles: (Array.isArray(tonightsBestSingles) ? tonightsBestSingles.slice(0, 4) : []).map((row) => compactRow(row, "bestSingles")),
      topLadders: (Array.isArray(tonightsBestLadders) ? tonightsBestLadders.slice(0, 4) : []).map((row) => compactRow(row, "bestLadders")),
      topSpecials: (Array.isArray(filteredTopSpecials) ? filteredTopSpecials.slice(0, 4) : []).map((row) => compactRow(row, "bestSpecials")),
      topMustPlays: (Array.isArray(mustPlayCandidates) ? mustPlayCandidates.slice(0, 4) : []).map((row) => compactRow(row, "mustPlayCandidates"))
    }
  }

  const topCard = buildTopCardView()
  mergedBestAvailableDiagnostics.finalTopSpecialsNullDecisionFilteredCount = finalTopSpecialsNullDecisionFilteredCount
  mergedBestAvailablePoolDiagnostics.finalTopSpecialsNullDecisionFilteredCount = finalTopSpecialsNullDecisionFilteredCount

  const surfacedBestSpecialRows = Array.isArray(specialtyOutputs?.normalizedBestSpecialRows)
    ? specialtyOutputs.normalizedBestSpecialRows
    : (Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : [])

  const surfacedBestSpecials = surfacedBestSpecialRows.map((row) => {
    const externalSignalInput = buildOverlayExternalSignalInput(row, { sourceLane: row?.sourceLane || "bestSpecials" })
    const decisionLayer = buildDecisionLayer({
      ...row,
      sourceLane: row?.sourceLane || "bestSpecials"
    })
    const externalOverlay = finalizeRuntimeExternalOverlay(buildExternalEdgeOverlay({
      ...row,
      sourceLane: row?.sourceLane || "bestSpecials"
    }, externalSignalInput), externalSignalInput)

    const baseDecisionLabel = decisionLayer?.finalDecisionLabel || null
    const baseDecisionBucket = decisionLayer?.decisionBucket || null
    const baseSitReason = decisionLayer?.sitReason || null
    const forceSpecialPlayable =
      String(row?.playDecision || "").toLowerCase() === "special-playable" &&
      String(row?.finalDecisionLabelHint || row?.decisionBucketHint || "").toLowerCase() === "special-only"

    const alignedDecisionLabel = forceSpecialPlayable && baseDecisionLabel === "sit"
      ? "special-only"
      : baseDecisionLabel
    const alignedDecisionBucket = forceSpecialPlayable && baseDecisionBucket === "sit"
      ? "special-only"
      : baseDecisionBucket
    const alignedSitReason = forceSpecialPlayable && baseSitReason === "play-decision-blocked"
      ? null
      : baseSitReason

    return {
      ...row,
      finalDecisionScore: decisionLayer?.finalDecisionScore ?? null,
      finalDecisionLabel: alignedDecisionLabel,
      decisionBucket: alignedDecisionBucket,
      supportEdge: decisionLayer?.supportEdge || null,
      marketEdge: decisionLayer?.marketEdge || null,
      riskEdge: decisionLayer?.riskEdge || null,
      sitReason: alignedSitReason,
      externalEdgeScore: externalOverlay?.externalEdgeScore ?? null,
      externalEdgeLabel: externalOverlay?.externalEdgeLabel || null,
      availabilityStatus: externalOverlay?.availabilityStatus || null,
      starterStatus: externalOverlay?.starterStatus || null,
      marketValidity: externalOverlay?.marketValidity || null,
      contextTag: externalOverlay?.contextTag || null,
      externalSignalsUsed: externalOverlay?.externalSignalsUsed || null,
      externalSitFlag: Boolean(externalOverlay?.externalSitFlag),
      externalSitReason: externalOverlay?.externalSitReason || null
    }
  })

  const buildCuratedSurfaceLane = ({ rows, sourceLane, defaultLane, thinDecision, isEligibleFallbackRow }) => {
    const surfacedRows = (Array.isArray(rows) ? rows : [])
      .map((row, index) => buildReadableSurfaceRow(row, {
        sourceLane,
        sourceRank: index + 1,
        defaultLane
      }))

    const primaryRows = surfacedRows.filter((row) => {
      const playDecision = String(row?.playDecision || "").toLowerCase()
      const finalDecisionLabel = String(row?.finalDecisionLabel || "").toLowerCase()
      return playDecision !== thinDecision && finalDecisionLabel !== "sit"
    })

    if (primaryRows.length > 0) return primaryRows

    return surfacedRows.filter((row) => {
      const playDecision = String(row?.playDecision || "").toLowerCase()
      return playDecision === thinDecision && isEligibleFallbackRow(row)
    }).slice(0, 3)
  }

  const curatedMostLikelyToHit = buildCuratedSurfaceLane({
    rows: Array.isArray(layer2CuratedBuckets?.mostLikelyToHit) ? layer2CuratedBuckets.mostLikelyToHit : [],
    sourceLane: "mostLikelyToHit",
    defaultLane: "bestSingles",
    thinDecision: "stable-thin",
    isEligibleFallbackRow: (row) => Number(row?.confidenceScore || 0) >= 0.58
  })
  const curatedBestValueRaw = buildCuratedSurfaceLane({
    rows: Array.isArray(layer2CuratedBuckets?.bestValue) ? layer2CuratedBuckets.bestValue : [],
    sourceLane: "bestValue",
    defaultLane: "bestSingles",
    thinDecision: "value-thin",
    isEligibleFallbackRow: (row) => {
      const odds = Number(row?.odds || 0)
      const confidenceScore = Number(row?.confidenceScore || 0)
      const marketLagScore = Number(row?.marketLagScore || 0)
      const bookDisagreementScore = Number(row?.bookDisagreementScore || 0)
      return odds >= -165 && odds <= 280 && confidenceScore >= 0.52 && (marketLagScore >= 0.18 || bookDisagreementScore >= 0.16 || odds >= 100)
    }
  })
  const curatedBestUpsideRaw = buildCuratedSurfaceLane({
    rows: Array.isArray(layer2CuratedBuckets?.bestUpside) ? layer2CuratedBuckets.bestUpside : [],
    sourceLane: "bestUpside",
    defaultLane: "bestLadders",
    thinDecision: "upside-thin",
    isEligibleFallbackRow: (row) => {
      const propVariant = String(row?.propVariant || "base").toLowerCase()
      const odds = Number(row?.odds || 0)
      const ceilingScore = Number(row?.ceilingScore || 0)
      const roleSpikeScore = Number(row?.roleSpikeScore || 0)
      const hasTrueUpsideShape = (propVariant !== "base" && propVariant !== "default") || odds >= 170
      return hasTrueUpsideShape && ceilingScore >= 0.18 && roleSpikeScore >= 0.12
    }
  })

  console.log("[CEILING-SIGNAL-EMIT-DEBUG]", {
    bestPayloadRowsWithCeiling: (Array.isArray(bestPayloadRows) ? bestPayloadRows : []).filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
    bestPayloadRowsWithRoleSpike: (Array.isArray(bestPayloadRows) ? bestPayloadRows : []).filter((row) => Number.isFinite(Number(row?.roleSpikeScore))).length,
    curatedMostLikelyWithCeiling: curatedMostLikelyToHit.filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
    curatedBestValueWithCeiling: curatedBestValueRaw.filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
    curatedBestUpsideWithCeiling: curatedBestUpsideRaw.filter((row) => Number.isFinite(Number(row?.ceilingScore))).length
  })

  const toFiniteNumber = (value, fallback = null) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const toDecimalOddsForTicket = (americanOdds) => {
    const odds = Number(americanOdds)
    if (!Number.isFinite(odds) || odds === 0) return 1
    if (odds > 0) return 1 + (odds / 100)
    return 1 + (100 / Math.abs(odds))
  }

  const ALLOWED_NBA_BOOKS = new Set([
    "draftkings",
    "fanduel",
    "fanatics",
    "betmgm",
    "caesars"
  ])

  const isAllowedNbaBookRow = (row) => {
    const normalizedBook = String(row?.book || "").trim().toLowerCase()
    return normalizedBook && ALLOWED_NBA_BOOKS.has(normalizedBook)
  }

  const filterAllowedNbaBookRows = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => isAllowedNbaBookRow(row))

  const isLikelyMatchupText = (text) => {
    const t = String(text || "").trim().toLowerCase()
    if (!t) return false
    return t.includes("@") || t.includes(" vs ") || t.includes(" vs.")
  }

  const normalizeNbaSurfaceTeam = (row, candidateTeam) => {
    const team = String(candidateTeam || "").trim()
    if (!team) return null
    if (isLikelyMatchupText(team)) return null
    if (rowTeamMatchesMatchup({ ...row, team })) return team
    return null
  }

  const inferNbaOutcomeTier = (row, boardFamily = "") => {
    const family = String(boardFamily || "").toLowerCase()
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    const odds = Number(row?.odds)
    const isFirstEventFamily =
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      family.includes("firstbasket") ||
      family.includes("firstteambasket")

    if (isFirstEventFamily) return "nuke"
    if (marketKey.includes("triple_double")) return "nuke"
    if (marketKey.includes("double_double")) return "ceiling"
    if (!Number.isFinite(odds)) return "ceiling"
    if (odds >= 360) return "nuke"
    if (odds >= 170) return "ceiling"
    if (propVariant !== "base" && propVariant !== "default") return "ceiling"
    return "support"
  }

  const isNbaSpecialMarketRow = (row) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    return (
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      marketKey.includes("double_double") ||
      marketKey.includes("triple_double")
    )
  }

  const toNbaSurfacedPlayRow = (row, options = {}) => {
    const boardFamily = String(options.boardFamily || "unknown")
    const sourceLane = options.sourceLane || boardFamily
    const outcomeTier = options.outcomeTier || inferNbaOutcomeTier(row, boardFamily)
    const readable = buildReadableSurfaceRow(row, { sourceLane, defaultLane: sourceLane })
    const impliedProb = impliedProbabilityFromAmerican(row?.odds)
    const confidenceScore = Number(
      Math.max(0, Math.min(1,
        toFiniteNumber(readable?.confidenceScore, null) != null
          ? Number(readable.confidenceScore)
          : (toFiniteNumber(row?.playerConfidenceScore, null) != null
            ? Number(row.playerConfidenceScore) / 100
            : (toFiniteNumber(row?.adjustedConfidenceScore, null) != null
              ? Number(row.adjustedConfidenceScore) / 100
              : 0.5)
          )
      )).toFixed(4)
    )

    return {
      player: readable?.player || row?.player || null,
      team: normalizeNbaSurfaceTeam(row, readable?.team || row?.team || row?.playerTeam),
      book: readable?.book || row?.book || null,
      marketKey: readable?.marketKey || row?.marketKey || null,
      propType: readable?.propType || row?.propType || null,
      side: readable?.side || row?.side || null,
      line: readable?.line ?? row?.line ?? null,
      odds: readable?.odds ?? row?.odds ?? null,
      matchup: readable?.matchup || row?.matchup || row?.eventId || null,
      confidenceScore,
      modelHitProb: toFiniteNumber(row?.modelHitProb, null),
      impliedProb: Number.isFinite(impliedProb) ? Number(impliedProb.toFixed(4)) : null,
      edgeGap: toFiniteNumber(row?.edgeGap, null),
      outcomeTier,
      boardFamily,
      decisionSummary: readable?.decisionSummary || row?.decisionSummary || row?.playDecision || null,
      playDecision: row?.playDecision || readable?.playDecision || null,
      propVariant: row?.propVariant || null,
      ladderPresentation: Boolean(row?.ladderPresentation),
      hitRate: row?.hitRate ?? null,
      score: toFiniteNumber(row?.score, null),
      edge: toFiniteNumber(row?.edge, null),
      ceilingScore: toFiniteNumber(row?.ceilingScore, null),
      roleSpikeScore: toFiniteNumber(row?.roleSpikeScore, null),
      marketLagScore: toFiniteNumber(row?.marketLagScore, null),
      bookDisagreementScore: toFiniteNumber(row?.bookDisagreementScore, null)
    }
  }

  const normalizeConfidence01 = (row) => {
    const values = [
      toFiniteNumber(row?.confidenceScore, null),
      toFiniteNumber(row?.playerConfidenceScore, null),
      toFiniteNumber(row?.adjustedConfidenceScore, null)
    ]
    for (const value of values) {
      if (!Number.isFinite(value)) continue
      if (value > 1) return Math.max(0, Math.min(1, value / 100))
      return Math.max(0, Math.min(1, value))
    }
    return 0.5
  }

  const getModelEdgeSignal = (row) => {
    const modelHitProb = toFiniteNumber(row?.modelHitProb, null)
    const impliedProbFromOdds = impliedProbabilityFromAmerican(row?.odds)
    if (Number.isFinite(modelHitProb) && Number.isFinite(impliedProbFromOdds)) {
      return modelHitProb - impliedProbFromOdds
    }
    const edgeGap = toFiniteNumber(row?.edgeGap, null)
    if (Number.isFinite(edgeGap)) {
      if (Math.abs(edgeGap) <= 1) return edgeGap
      return edgeGap / 100
    }
    return null
  }

  const getRowHitRate = (row) => {
    const parsed = parseHitRate(row?.hitRate)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    return toFiniteNumber(row?.modelHitProb, 0)
  }

  const buildNbaLegSignature = (row) => [
    String(row?.player || "").trim().toLowerCase(),
    String(row?.marketKey || "").trim().toLowerCase(),
    String(row?.side || "").trim().toLowerCase(),
    String(row?.line ?? ""),
    String(row?.book || "").trim().toLowerCase()
  ].join("|")

  const dedupeNbaRowsByLegSignature = (rows) => {
    const out = []
    const seen = new Set()
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = buildNbaLegSignature(row)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
    return out
  }

  const isLadderishUpsideRow = (row) => {
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    return Boolean(row?.ladderPresentation) || propVariant === "alt-mid" || propVariant === "alt-high" || propVariant === "alt-max"
  }

  const liveRowsForQualityMode = dedupeNbaRowsByLegSignature([
    ...filterAllowedNbaBookRows(Array.isArray(curatedBestValueRaw) ? curatedBestValueRaw : []),
    ...filterAllowedNbaBookRows(Array.isArray(curatedBestUpsideRaw) ? curatedBestUpsideRaw : []),
    ...filterAllowedNbaBookRows(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : []),
    ...filterAllowedNbaBookRows((Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row)))
  ]).filter((row) => Number.isFinite(Number(row?.line)) && Number.isFinite(Number(row?.odds)))
  const liveBooksForQualityMode = new Set(
    liveRowsForQualityMode
      .map((row) => String(row?.book || "").trim().toLowerCase())
      .filter(Boolean)
  )
  const snapshotSlateGameCount = Number(oddsSnapshot?.snapshotSlateGameCount || 0)
  const nbaLoadedSlateQualityPassEnabled =
    liveRowsForQualityMode.length >= 18 &&
    liveBooksForQualityMode.size >= 2 &&
    snapshotSlateGameCount >= 3

  const applyLoadedSlateLaneQuality = (rows, config = {}) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const maxRows = Math.max(1, Number(config?.maxRows || safeRows.length || 1))
    const relaxedFilter = typeof config?.relaxedFilter === "function" ? config.relaxedFilter : (() => true)
    const strictFilter = typeof config?.strictFilter === "function" ? config.strictFilter : (() => true)
    const rankFn = typeof config?.rankFn === "function" ? config.rankFn : (() => 0)
    const minStrictRows = Math.max(1, Number(config?.minStrictRows || 1))

    if (!nbaLoadedSlateQualityPassEnabled) {
      return {
        rows: safeRows.slice(0, maxRows),
        strictCount: safeRows.length,
        relaxedCount: safeRows.length,
        usedRelaxedFallback: false
      }
    }

    const strictRows = safeRows.filter((row) => strictFilter(row))
    const relaxedRows = safeRows.filter((row) => relaxedFilter(row))
    const useRelaxedFallback = strictRows.length < minStrictRows
    const sourceRows = useRelaxedFallback
      ? (relaxedRows.length > 0 ? relaxedRows : safeRows)
      : strictRows
    const ranked = dedupeNbaRowsByLegSignature(sourceRows)
      .sort((a, b) => rankFn(b) - rankFn(a))
      .slice(0, maxRows)

    return {
      rows: ranked,
      strictCount: strictRows.length,
      relaxedCount: relaxedRows.length,
      usedRelaxedFallback: useRelaxedFallback
    }
  }

  const bestValueQualityScore = (row) => {
    const confidence = normalizeConfidence01(row)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const bookDisagreementScore = toFiniteNumber(row?.bookDisagreementScore, 0)
    const edgeSignal = getModelEdgeSignal(row)
    const odds = Number(row?.odds || 0)
    const lowOddsPenalty = odds < -175 ? Math.min(18, (Math.abs(odds) - 175) * 0.08) : 0
    return bestValueSortValue(row) + (confidence * 26) + (marketLagScore * 16) + (bookDisagreementScore * 22) + ((edgeSignal || 0) * 65) - lowOddsPenalty
  }

  const isBestValueLaneRow = (row, strict = false) => {
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const odds = Number(row?.odds || 0)
    const confidence = normalizeConfidence01(row)
    const edgeSignal = getModelEdgeSignal(row)
    const decisionText = `${String(row?.playDecision || "")} ${String(row?.decisionSummary || "")}`.toLowerCase()
    if (!Number.isFinite(odds) || !Number.isFinite(score)) return false
    if (strict && decisionText.includes("thin")) return false
    if (odds < -220 || odds > 320) return false
    if (hitRate < (strict ? 0.53 : 0.5)) return false
    if (score < (strict ? 68 : 62)) return false
    if (edge < (strict ? 0.8 : 0.35)) return false
    if (confidence < (strict ? 0.54 : 0.5)) return false
    if (strict && Number.isFinite(edgeSignal) && edgeSignal < -0.02) return false
    return true
  }

  const bestUpsideQualityScore = (row) => {
    const odds = Number(row?.odds || 0)
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const confidence = normalizeConfidence01(row)
    const variant = String(row?.propVariant || "base").toLowerCase()
    const variantBonus =
      variant === "alt-max" ? 20 :
      variant === "alt-high" ? 15 :
      variant === "alt-mid" ? 9 : 0
    return (odds * 0.11) + (hitRate * 75) + (score * 0.9) + (edge * 16) + (ceilingScore * 18) + (roleSpikeScore * 14) + (marketLagScore * 10) + (confidence * 24) + variantBonus
  }

  const isBestUpsideLaneRow = (row, strict = false) => {
    const odds = Number(row?.odds || 0)
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const confidence = normalizeConfidence01(row)
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const side = String(row?.side || "").toLowerCase()
    const isUnder = side === "under"
    const ladderish = isLadderishUpsideRow(row)
    const strongUnderException =
      isUnder &&
      hitRate >= (strict ? 0.7 : 0.64) &&
      score >= (strict ? 84 : 78) &&
      edge >= (strict ? 1.7 : 1.2) &&
      (ceilingScore >= (strict ? 0.66 : 0.56) || roleSpikeScore >= (strict ? 0.58 : 0.46))
    const hasUpsideShape =
      odds >= (strict ? 170 : 145) ||
      ladderish ||
      ceilingScore >= (strict ? 0.3 : 0.2) ||
      roleSpikeScore >= (strict ? 0.22 : 0.14)

    if (!Number.isFinite(odds) || !Number.isFinite(score)) return false
    if (!hasUpsideShape) return false
    if (odds < 130 || odds > 1200) return false
    if (hitRate < (strict ? 0.46 : 0.42)) return false
    if (score < (strict ? 66 : 60)) return false
    if (edge < (strict ? 0.25 : 0.05)) return false
    if (confidence < (strict ? 0.48 : 0.45)) return false
    if (isUnder && !strongUnderException) return false
    if (strict && odds < 180 && !ladderish && ceilingScore < 0.34 && roleSpikeScore < 0.24) return false
    return true
  }

  const bestValueLaneQuality = applyLoadedSlateLaneQuality(curatedBestValueRaw, {
    maxRows: 8,
    minStrictRows: 4,
    strictFilter: (row) => isBestValueLaneRow(row, true),
    relaxedFilter: (row) => isBestValueLaneRow(row, false),
    rankFn: bestValueQualityScore
  })
  const bestUpsideLaneQuality = applyLoadedSlateLaneQuality(curatedBestUpsideRaw, {
    maxRows: 8,
    minStrictRows: 5,
    strictFilter: (row) => isBestUpsideLaneRow(row, true),
    relaxedFilter: (row) => isBestUpsideLaneRow(row, false),
    rankFn: bestUpsideQualityScore
  })

  const curatedBestValue = bestValueLaneQuality.rows
  const curatedBestUpside = bestUpsideLaneQuality.rows

  const layerBestValue = (Array.isArray(curatedBestValue) ? curatedBestValue : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestValue", sourceLane: "bestValue" }))
  const layerBestUpside = (Array.isArray(curatedBestUpside) ? curatedBestUpside : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestUpside", sourceLane: "bestUpside" }))
  const layerBestLadders = (Array.isArray(tonightsBestLadders) ? tonightsBestLadders : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => !isNbaSpecialMarketRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestLadders", sourceLane: "bestLadders" }))

  const layerFirstBasket = (Array.isArray(typeAwareSpecials.bestFirstBasket) ? typeAwareSpecials.bestFirstBasket : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestFirstBasket", sourceLane: "bestSpecials" }))
  const layerFirstTeamBasket = (Array.isArray(typeAwareSpecials.bestFirstTeamBasket) ? typeAwareSpecials.bestFirstTeamBasket : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestFirstTeamBasket", sourceLane: "bestSpecials" }))
  const layerDoubleDoubles = (Array.isArray(typeAwareSpecials.bestDoubleDoubles) ? typeAwareSpecials.bestDoubleDoubles : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestDoubleDoubles", sourceLane: "bestSpecials" }))
  const layerTripleDoubles = (Array.isArray(typeAwareSpecials.bestTripleDoubles) ? typeAwareSpecials.bestTripleDoubles : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestTripleDoubles", sourceLane: "bestSpecials" }))
  const layerBestSpecials = (Array.isArray(surfacedBestSpecials) ? surfacedBestSpecials : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => !isNbaSpecialMarketRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSpecials", sourceLane: "bestSpecials" }))

  const isNbaChalkHeavyLeg = (row) => {
    const odds = Number(row?.odds)
    if (!Number.isFinite(odds)) return false
    if (odds <= -138) return true
    const hitRate = getRowHitRate(row)
    if (odds < -102 && odds > -138 && Number.isFinite(hitRate) && hitRate >= 0.55) return true
    return false
  }

  const isLongshotBoardBombShape = (row) => !isNbaChalkHeavyLeg(row) && isBombLikeRow(row, false)

  const isBombLikeRow = (row, strict = false) => {
    if (isNbaChalkHeavyLeg(row)) return false
    const odds = Number(row?.odds || 0)
    const outcomeTier = String(row?.outcomeTier || "").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const confidence = normalizeConfidence01(row)
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    const hasAggressiveVariant = propVariant === "alt-high" || propVariant === "alt-max"
    if (!Number.isFinite(odds)) return false
    if (outcomeTier !== "nuke" && outcomeTier !== "ceiling") return false
    if (strict) {
      const strictBombShape =
        outcomeTier === "nuke" ||
        odds >= 280 ||
        (outcomeTier === "ceiling" && odds >= 230 && (odds >= 270 || hasAggressiveVariant || ceilingScore >= 0.4 || roleSpikeScore >= 0.28)) ||
        (odds >= 230 && hasAggressiveVariant && (ceilingScore >= 0.48 || roleSpikeScore >= 0.34))
      return strictBombShape && confidence >= 0.46
    }
    const relaxedBombShape =
      outcomeTier === "nuke" ||
      odds >= 220 ||
      (outcomeTier === "ceiling" && Number.isFinite(odds) && odds >= 100 && confidence >= 0.43) ||
      (odds >= 185 && (hasAggressiveVariant || ceilingScore >= 0.34 || roleSpikeScore >= 0.24))
    return relaxedBombShape && confidence >= 0.43
  }

  const computeNbaLongshotPredictiveIndex = (row) => {
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const bookDisagreementScore = toFiniteNumber(row?.bookDisagreementScore, 0)
    const opportunitySpikeScore = toFiniteNumber(row?.opportunitySpikeScore, 0)
    const lineupContextScore = toFiniteNumber(row?.lineupContextScore, 0)
    const edgeSignal = Math.abs(toFiniteNumber(getModelEdgeSignal(row), 0))
    const score = Number(row?.score)
    const pdText = `${row?.playDecision || ""} ${row?.decisionSummary || ""}`.toLowerCase()
    let idx =
      ceilingScore * 0.34 +
      roleSpikeScore * 0.28 +
      marketLagScore * 0.12 +
      bookDisagreementScore * 0.1 +
      Math.min(1, opportunitySpikeScore * 1.05) * 0.08 +
      Math.min(1, lineupContextScore * 1.05) * 0.06 +
      Math.min(1, edgeSignal * 12) * 0.06
    if (pdText.includes("ceiling") || pdText.includes("upside") || pdText.includes("spike") || pdText.includes("matchup")) {
      idx += 0.07
    }
    if (Number.isFinite(score) && score >= 85) idx += 0.05
    if (Number.isFinite(score) && score >= 78) idx += 0.02
    const line = Number(row?.line)
    const r5 = Number(row?.recent5Avg)
    const l10 = Number(row?.l10Avg)
    const ref = Number.isFinite(r5) ? r5 : l10
    const isUnder = String(row?.side || "").toLowerCase() === "under"
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
      const pace = ref / line
      if (!isUnder && pace >= 1.06) {
        idx += Math.min(0.12, (pace - 1.06) * 0.42)
      }
      if (isUnder && pace <= 0.94) {
        idx += Math.min(0.08, (0.94 - pace) * 0.35)
      }
    }
    const edgePts = Math.abs(toFiniteNumber(row?.edge, 0))
    if (edgePts >= 4) idx += 0.045
    if (edgePts >= 7.5) idx += 0.045
    return Math.min(1, idx)
  }

  const passesNbaLongshotPredictiveGate = (row) => {
    const idx = computeNbaLongshotPredictiveIndex(row)
    const c = toFiniteNumber(row?.ceilingScore, 0)
    const r = toFiniteNumber(row?.roleSpikeScore, 0)
    const o = Number(row?.odds)
    const edge = Math.abs(toFiniteNumber(getModelEdgeSignal(row), 0))
    const line = Number(row?.line)
    const r5 = Number(row?.recent5Avg)
    const l10 = Number(row?.l10Avg)
    const ref = Number.isFinite(r5) ? r5 : l10
    const isUnder = String(row?.side || "").toLowerCase() === "under"
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
      if (!isUnder && ref >= line * 1.12) return true
      if (isUnder && ref <= line * 0.88) return true
    }
    if (idx >= 0.235) return true
    if (c >= 0.38 || r >= 0.22) return true
    if (c + r >= 0.44) return true
    if (edge >= 0.048) return true
    if (Number.isFinite(o) && o >= 380 && (c >= 0.26 || r >= 0.16 || idx >= 0.19)) return true
    return false
  }

  const passesNbaLongshotPredictiveWeak = (row) => {
    const idx = computeNbaLongshotPredictiveIndex(row)
    const c = toFiniteNumber(row?.ceilingScore, 0)
    const r = toFiniteNumber(row?.roleSpikeScore, 0)
    const o = Number(row?.odds)
    const line = Number(row?.line)
    const r5 = Number(row?.recent5Avg)
    const l10 = Number(row?.l10Avg)
    const ref = Number.isFinite(r5) ? r5 : l10
    const isUnder = String(row?.side || "").toLowerCase() === "under"
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
      if (!isUnder && ref >= line * 1.07) return true
      if (isUnder && ref <= line * 0.93) return true
    }
    if (idx >= 0.128) return true
    if (c + r >= 0.34) return true
    if (Number.isFinite(o) && o >= 300 && idx >= 0.11) return true
    return false
  }

  const longshotQualityScore = (row) => {
    const rawOdds = Number(row?.odds || 0)
    const oddsForRank = Number.isFinite(rawOdds)
      ? (rawOdds > 0 ? Math.min(rawOdds, 580) : Math.max(rawOdds, -400))
      : 0
    const confidence = normalizeConfidence01(row)
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const edgeSignal = getModelEdgeSignal(row) || 0
    const predictiveIdx = computeNbaLongshotPredictiveIndex(row)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const bookDisagreementScore = toFiniteNumber(row?.bookDisagreementScore, 0)
    const nukeBonus = String(row?.outcomeTier || "").toLowerCase() === "nuke" ? 14 : 0
    const payoutBandBonus =
      rawOdds >= 550 ? 34 :
        rawOdds >= 400 ? 28 :
          rawOdds >= 300 ? 22 :
            rawOdds >= 250 ? 16 :
              rawOdds >= 200 ? 10 :
                rawOdds >= 180 ? 5 : 0
    const sweetSpotLift = rawOdds >= 200 && rawOdds <= 520 ? 24 : 0
    const upperBandPenalty = rawOdds > 680 ? (rawOdds - 680) * 0.11 : 0
    const oddsOnlyPenalty = predictiveIdx < 0.14 && rawOdds >= 200 ? (0.14 - predictiveIdx) * 55 : 0
    return (
      (oddsForRank * 0.082) +
      (confidence * 40) +
      (ceilingScore * 22) +
      (roleSpikeScore * 18) +
      (marketLagScore * 16) +
      (bookDisagreementScore * 12) +
      (edgeSignal * 62) +
      predictiveIdx * 52 +
      nukeBonus +
      payoutBandBonus * 0.88 +
      sweetSpotLift -
      upperBandPenalty -
      oddsOnlyPenalty
    )
  }

  const inferNbaLongshotBoardOutcomeTier = (row) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    if (
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      marketKey.includes("double_double") ||
      marketKey.includes("triple_double")
    ) {
      return inferNbaOutcomeTier(row, "bestLongshotPlays")
    }
    const odds = Number(row?.odds)
    const variant = String(row?.propVariant || "base").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const baseTier = inferNbaOutcomeTier(row, "bestLongshotPlays")
    if (baseTier !== "support") return baseTier
    if (variant !== "base" && variant !== "default") return "ceiling"
    if (Number.isFinite(odds) && odds >= 150) return "ceiling"
    if (ceilingScore >= 0.58 || roleSpikeScore >= 0.36) return "ceiling"
    if (Number.isFinite(odds) && odds >= 125 && (ceilingScore >= 0.35 || roleSpikeScore >= 0.2)) return "ceiling"
    return "support"
  }

  const isNbaPlayerPropMarketForLongshotExplosion = (row) => {
    const mk = String(row?.marketKey || "").toLowerCase()
    if (
      mk.includes("first_basket") ||
      mk.includes("first_team_basket") ||
      mk.includes("double_double") ||
      mk.includes("triple_double")
    ) {
      return false
    }
    return (
      mk.startsWith("player_") ||
      mk.includes("points") ||
      mk.includes("rebounds") ||
      mk.includes("assists") ||
      mk.includes("threes") ||
      mk.includes("steals") ||
      mk.includes("blocks") ||
      mk.includes("turnovers") ||
      mk.includes("combo") ||
      mk.includes("pra")
    )
  }

  const isNbaLongshotExplosionUpstreamRow = (row) => {
    if (!row || !isNbaPlayerPropMarketForLongshotExplosion(row)) return false
    const odds = Number(row?.odds)
    if (!Number.isFinite(odds) || odds < -400 || odds > 950) return false
    if (isNbaChalkHeavyLeg(row)) return false
    const variant = String(row?.propVariant || "base").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const aggressive = variant === "alt-high" || variant === "alt-max"
    const rawScore = Number(row?.score)
    if (Number.isFinite(rawScore) && rawScore < 28 && odds < 200) return false
    if (!Number.isFinite(rawScore) && odds < 175) return false

    if (odds >= 185 && odds <= 900) return true
    if (aggressive && odds >= 125 && odds <= 950 && (ceilingScore >= 0.22 || roleSpikeScore >= 0.12)) return true
    if (aggressive && odds >= 105 && (ceilingScore >= 0.48 || roleSpikeScore >= 0.3)) return true
    if (odds >= 155 && odds < 185 && (ceilingScore >= 0.38 || roleSpikeScore >= 0.26)) return true
    return false
  }

  const snapshotPropsForLongshotExplosion = (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []).filter((row) => {
    const o = Number(row?.odds)
    if (!Number.isFinite(o)) return false
    if (o > 950 || o < -400) return false
    if (o >= 155 || o <= -240) return true
    const v = String(row?.propVariant || "base").toLowerCase()
    return v === "alt-high" || v === "alt-max" || (v === "alt-mid" && o >= 102)
  })

  const longshotExplosionFeed = dedupeNbaRowsByLegSignature(
    filterAllowedNbaBookRows([
      ...(Array.isArray(bestPayloadRows) ? bestPayloadRows : []),
      ...(Array.isArray(finalPlayableRows) ? finalPlayableRows : []),
      ...(Array.isArray(standardCandidates) ? standardCandidates : []),
      ...(Array.isArray(ladderPool) ? ladderPool : []),
      ...(Array.isArray(curatedBestUpsideRaw) ? curatedBestUpsideRaw : []),
      ...snapshotPropsForLongshotExplosion
    ]).filter((row) => isNbaLongshotExplosionUpstreamRow(row))
  )

  const layerBestLongshotPlays = (() => {
    const candidates = [
      ...longshotExplosionFeed,
      ...filterAllowedNbaBookRows(Array.isArray(lottoPicks) ? lottoPicks : []),
      ...filterAllowedNbaBookRows(Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row)),
      ...filterAllowedNbaBookRows(Array.isArray(curatedBestUpside) ? curatedBestUpside : []).filter((row) => !isNbaSpecialMarketRow(row)),
      ...filterAllowedNbaBookRows(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : []).filter((row) => !isNbaSpecialMarketRow(row)),
      ...filterAllowedNbaBookRows((Array.isArray(mustPlayCandidates) ? mustPlayCandidates : []).filter((row) => !isNbaSpecialMarketRow(row)))
    ]
    const teamByPlayer = new Map()
    const registerPlayerTeam = (row) => {
      const playerKey = String(row?.player || "").trim().toLowerCase()
      if (!playerKey) return
      const rawTeam = row?.team || row?.playerTeam || row?.resolvedTeamCode
      if (!rawTeam) return
      const normalized = normalizeNbaSurfaceTeam(row, rawTeam)
      const finalTeam = normalized || (isLikelyMatchupText(rawTeam) ? null : String(rawTeam).trim())
      if (!finalTeam) return
      if (!teamByPlayer.has(playerKey)) teamByPlayer.set(playerKey, finalTeam)
    }
    for (const r of Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []) registerPlayerTeam(r)
    for (const r of Array.isArray(bestPayloadRows) ? bestPayloadRows : []) registerPlayerTeam(r)
    for (const r of candidates) registerPlayerTeam(r)

    const ceilingContextByPlayer = new Map()
    const maybeSetCeilingContext = (r) => {
      const k = String(r?.player || "").trim().toLowerCase()
      if (!k) return
      const c = toFiniteNumber(r?.ceilingScore, 0)
      const prev = ceilingContextByPlayer.get(k)
      const prevC = toFiniteNumber(prev?.ceilingScore, 0)
      const prevHasTeam = Boolean(prev?.team)
      const nextHasTeam = Boolean(r?.team)
      if (!prev) return ceilingContextByPlayer.set(k, r)
      if (c > prevC) return ceilingContextByPlayer.set(k, r)
      if (!prevHasTeam && nextHasTeam && c >= prevC - 0.02) return ceilingContextByPlayer.set(k, r)
    }
    for (const r of liveRowsForQualityMode) maybeSetCeilingContext(r)
    for (const r of Array.isArray(bestPayloadRows) ? bestPayloadRows : []) maybeSetCeilingContext(r)
    for (const r of Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []) maybeSetCeilingContext(r)
    for (const r of candidates) maybeSetCeilingContext(r)
    const getCeilingContextRow = (row) => {
      const k = String(row?.player || "").trim().toLowerCase()
      return k ? (ceilingContextByPlayer.get(k) || null) : null
    }
    const withCeilingContext = (row) => {
      const k = String(row?.player || "").trim().toLowerCase()
      const ctx = k ? ceilingContextByPlayer.get(k) : null
      if (!ctx) return row
      return {
        ...row,
        team: row.team ?? ctx.team,
        matchup: row.matchup ?? ctx.matchup,
        ceilingScore: row.ceilingScore ?? ctx.ceilingScore,
        roleSpikeScore: row.roleSpikeScore ?? ctx.roleSpikeScore,
        recent5Avg: row.recent5Avg ?? ctx.recent5Avg,
        recent3Avg: row.recent3Avg ?? ctx.recent3Avg,
        l10Avg: row.l10Avg ?? ctx.l10Avg,
        marketLagScore: row.marketLagScore ?? ctx.marketLagScore,
        bookDisagreementScore: row.bookDisagreementScore ?? ctx.bookDisagreementScore,
        opportunitySpikeScore: row.opportunitySpikeScore ?? ctx.opportunitySpikeScore,
        lineupContextScore: row.lineupContextScore ?? ctx.lineupContextScore,
        score: row.score ?? ctx.score,
        edge: row.edge ?? ctx.edge,
        modelHitProb: row.modelHitProb ?? ctx.modelHitProb,
        edgeGap: row.edgeGap ?? ctx.edgeGap
      }
    }
    const scored = []
    for (const raw of candidates) {
      const row = withCeilingContext(raw)
      if (!String(row?.player || "").trim()) continue
      const rawAmerican = Number(row?.odds)
      if (!Number.isFinite(rawAmerican) || rawAmerican <= 0) continue
      const marketKey = String(row?.marketKey || "").toLowerCase()
      if (marketKey.includes("first_basket") || marketKey.includes("first_team_basket") || marketKey.includes("double_double") || marketKey.includes("triple_double")) continue
      let surfaced = toNbaSurfacedPlayRow(row, {
        boardFamily: "bestLongshotPlays",
        sourceLane: "bestLadders",
        outcomeTier: inferNbaLongshotBoardOutcomeTier(row)
      })
      if (!surfaced?.team) {
        const ctx = getCeilingContextRow(row)
        const playerKey = String(row?.player || "").trim().toLowerCase()
        const ctxTeam = ctx?.team && !isLikelyMatchupText(ctx.team) ? String(ctx.team).trim() : null
        const mappedTeam = playerKey ? (teamByPlayer.get(playerKey) || null) : null
        const rawTeam = row?.team && !isLikelyMatchupText(row.team) ? String(row.team).trim() : null
        surfaced = { ...surfaced, team: ctxTeam || mappedTeam || rawTeam || surfaced.team || null }
      }
      const surfacedAmerican = Number(surfaced.odds)
      if (!Number.isFinite(surfacedAmerican) || surfacedAmerican <= 0) continue
      let tierEarly = String(surfaced.outcomeTier || "").trim().toLowerCase()
      if (!tierEarly || tierEarly === "support") {
        tierEarly = String(inferNbaLongshotBoardOutcomeTier(row) || "").trim().toLowerCase()
        surfaced = { ...surfaced, outcomeTier: tierEarly }
      }
      if (tierEarly === "support") continue
      if (isNbaChalkHeavyLeg(surfaced)) continue
      const am = Number(surfaced.odds)
      const co = Number(surfaced.confidenceScore)
      if (
        Number.isFinite(am) &&
        am >= 165 &&
        (!Number.isFinite(co) || co < 0.08)
      ) {
        const ceilingLift = toFiniteNumber(row?.ceilingScore ?? surfaced.ceilingScore, 0)
        const imputed = Number(Math.min(0.55, Math.max(0.43, 0.38 + ceilingLift * 0.2)).toFixed(4))
        surfaced = { ...surfaced, confidenceScore: imputed }
      }
      surfaced = {
        ...surfaced,
        ceilingScore: toFiniteNumber(row?.ceilingScore, surfaced.ceilingScore),
        roleSpikeScore: toFiniteNumber(row?.roleSpikeScore, surfaced.roleSpikeScore),
        marketLagScore: toFiniteNumber(row?.marketLagScore, surfaced.marketLagScore),
        bookDisagreementScore: toFiniteNumber(row?.bookDisagreementScore, surfaced.bookDisagreementScore),
        opportunitySpikeScore: toFiniteNumber(row?.opportunitySpikeScore, surfaced.opportunitySpikeScore),
        lineupContextScore: toFiniteNumber(row?.lineupContextScore, surfaced.lineupContextScore),
        modelHitProb: toFiniteNumber(row?.modelHitProb, surfaced.modelHitProb),
        edgeGap: toFiniteNumber(row?.edgeGap, surfaced.edgeGap),
        edge: toFiniteNumber(row?.edge, surfaced.edge),
        recent5Avg: row?.recent5Avg ?? surfaced.recent5Avg,
        recent3Avg: row?.recent3Avg ?? surfaced.recent3Avg,
        l10Avg: row?.l10Avg ?? surfaced.l10Avg,
        line: surfaced.line ?? row?.line,
        side: surfaced.side ?? row?.side
      }
      surfaced = {
        ...surfaced,
        longshotPredictiveIndex: Number(computeNbaLongshotPredictiveIndex(surfaced).toFixed(4))
      }
      scored.push(surfaced)
    }
    const deduped = dedupeNbaRowsByLegSignature(scored)
    const strictRows = deduped.filter((row) => isBombLikeRow(row, true))
    const relaxedRows = deduped.filter((row) => isLongshotBoardBombShape(row))
    // Longshot board is payout-upside first: strict bomb gates skew hit-rate-shaped and can
    // hide real +200–600 legs that only pass relaxed shape. Prefer relaxed whenever non-empty.
    const chosenPool = relaxedRows.length ? relaxedRows : strictRows

    const finalizeLongshotBoardRow = (row) => {
      const o = Number(row?.odds)
      if (!Number.isFinite(o) || o <= 0) return null
      let tier = String(row?.outcomeTier ?? "").trim().toLowerCase()
      if (tier !== "nuke" && tier !== "ceiling") {
        tier = String(inferNbaLongshotBoardOutcomeTier({ ...row, odds: o }) || "").trim().toLowerCase()
      }
      if (tier === "support") return null
      if (tier !== "nuke" && tier !== "ceiling") {
        tier = o >= 360 ? "nuke" : "ceiling"
      }
      const shaped = { ...row, odds: o, outcomeTier: tier }
      if (!isLongshotBoardBombShape(shaped)) return null
      return shaped
    }

    const sortedChosen = [...chosenPool].sort((a, b) => longshotQualityScore(b) - longshotQualityScore(a))
    const finalizedOrdered = []
    const seenFinalize = new Set()
    for (const row of sortedChosen) {
      const fin = finalizeLongshotBoardRow(row)
      if (!fin) continue
      const key = buildNbaLegSignature(fin)
      if (seenFinalize.has(key)) continue
      seenFinalize.add(key)
      finalizedOrdered.push(fin)
    }
    const distinctTeamsAvailable = new Set(
      finalizedOrdered
        .map((r) => String(r?.team || "").trim().toLowerCase())
        .filter(Boolean)
    ).size
    // If we have enough distinct teams, cap repeats harder to prevent one-team domination.
    const maxTeamUses = distinctTeamsAvailable >= 3 ? 4 : 6
    const out = []
    const used = new Set()
    const playerUses = new Map()
    const teamUses = new Map()
    const matchupUses = new Map()
    const marketUsesByPlayer = new Map()

    const canAcceptLongshot = (row) => {
      const player = String(row?.player || "").trim().toLowerCase()
      const team = String(row?.team || "").trim().toLowerCase() || "__unknown__"
      const matchup = String(row?.matchup || "").trim().toLowerCase()
      const marketKey = String(row?.marketKey || "").trim().toLowerCase()

      const pCount = player ? (playerUses.get(player) || 0) : 0
      const tCount = team ? (teamUses.get(team) || 0) : 0
      const mCount = matchup ? (matchupUses.get(matchup) || 0) : 0

      // Prevent longshot board from collapsing into one team/player's repeated alts.
      // Keep depth by allowing some repeats, but cap them.
      if (player && pCount >= 2) return false
      if (team === "__unknown__" && tCount >= 2) return false
      if (team && tCount >= maxTeamUses) return false
      if (matchup && mCount >= 9) return false

      if (player && marketKey) {
        const set = marketUsesByPlayer.get(player) || new Set()
        if (set.has(marketKey)) return false
      }

      return true
    }

    const recordLongshotPick = (row) => {
      const player = String(row?.player || "").trim().toLowerCase()
      const team = String(row?.team || "").trim().toLowerCase() || "__unknown__"
      const matchup = String(row?.matchup || "").trim().toLowerCase()
      const marketKey = String(row?.marketKey || "").trim().toLowerCase()
      if (player) playerUses.set(player, (playerUses.get(player) || 0) + 1)
      if (team) teamUses.set(team, (teamUses.get(team) || 0) + 1)
      if (matchup) matchupUses.set(matchup, (matchupUses.get(matchup) || 0) + 1)
      if (player && marketKey) {
        const set = marketUsesByPlayer.get(player) || new Set()
        set.add(marketKey)
        marketUsesByPlayer.set(player, set)
      }
    }

    for (const r of finalizedOrdered) {
      if (out.length >= 14) break
      const k = buildNbaLegSignature(r)
      if (used.has(k)) continue
      if (passesNbaLongshotPredictiveGate(r) && canAcceptLongshot(r)) {
        used.add(k)
        out.push(r)
        recordLongshotPick(r)
      }
    }
    if (out.length < 14) {
      for (const r of finalizedOrdered) {
        if (out.length >= 14) break
        const k = buildNbaLegSignature(r)
        if (used.has(k)) continue
        if (passesNbaLongshotPredictiveWeak(r) && canAcceptLongshot(r)) {
          used.add(k)
          out.push(r)
          recordLongshotPick(r)
        }
      }
    }
    if (out.length < 6) {
      for (const r of finalizedOrdered) {
        if (out.length >= 14) break
        const k = buildNbaLegSignature(r)
        if (used.has(k)) continue
        if (!canAcceptLongshot(r)) continue
        used.add(k)
        out.push(r)
        recordLongshotPick(r)
      }
    }
    return out.slice(0, 14)
  })()

  const convictionRowsSource = [
    ...filterAllowedNbaBookRows((Array.isArray(mustPlayCandidates) ? mustPlayCandidates : []).filter((row) => !isNbaSpecialMarketRow(row))),
    ...filterAllowedNbaBookRows(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : []),
    ...filterAllowedNbaBookRows((Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row)))
  ]

  const layeredConvictions = (() => {
    const byPlayer = new Map()
    for (const row of convictionRowsSource) {
      const player = String(row?.player || "").trim()
      if (!player) continue
      if (!byPlayer.has(player)) byPlayer.set(player, [])
      byPlayer.get(player).push(row)
    }

    const rows = []
    for (const [player, playerRows] of byPlayer.entries()) {
      const surfacedRows = playerRows
        .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "convictions", sourceLane: row?.mustPlaySourceLane || "bestSingles" }))
        .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
      const top = surfacedRows[0] || {}
      const oddsValues = surfacedRows.map((r) => Number(r?.odds)).filter(Number.isFinite)
      const minOdds = oddsValues.length ? Math.min(...oddsValues) : 0
      const maxOdds = oddsValues.length ? Math.max(...oddsValues) : 0
      const volatilityScore = Number(Math.max(0, Math.min(1, Math.abs(maxOdds - minOdds) / 700)).toFixed(4))
      const confidenceScore = Number(top?.confidenceScore || 0.5)
      const ceilingScore = Number(Math.max(0, Math.min(1, ((maxOdds || 100) + 300) / 1100)).toFixed(4))
      const floorScore = Number(Math.max(0, Math.min(1, 1 - volatilityScore)).toFixed(4))
      const spikeScore = Number(Math.max(0, Math.min(1, (ceilingScore + confidenceScore) / 2)).toFixed(4))
      const playerConvictionScore = Number(((confidenceScore * 0.52) + (ceilingScore * 0.2) + (floorScore * 0.16) + (spikeScore * 0.12)).toFixed(4))

      rows.push({
        player,
        team: top?.team || null,
        playerConvictionScore,
        confidenceScore,
        ceilingScore,
        floorScore,
        spikeScore,
        volatilityScore,
        bestFamilyForPlayer: String(top?.boardFamily || "bestSingles"),
        topOutcomeCandidates: surfacedRows.slice(0, 3)
      })
    }

    return rows.sort((a, b) => Number(b.playerConvictionScore || 0) - Number(a.playerConvictionScore || 0)).slice(0, 10)
  })()

  const ladderCandidateRows = [
    ...filterAllowedNbaBookRows((Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row))),
    ...filterAllowedNbaBookRows((Array.isArray(curatedBestUpside) ? curatedBestUpside : []).filter((row) => !isNbaSpecialMarketRow(row))),
    ...filterAllowedNbaBookRows((Array.isArray(lottoPicks) ? lottoPicks : []).filter((row) => !isNbaSpecialMarketRow(row)))
  ]

  const buildLadderTierRows = (tier) => {
    const byPlayer = new Map()
    for (const row of ladderCandidateRows) {
      const player = String(row?.player || "").trim()
      if (!player) continue
      const surfaced = toNbaSurfacedPlayRow(row, { boardFamily: "bestLadders", sourceLane: "bestLadders" })
      if (surfaced.outcomeTier !== tier) continue
      const existing = byPlayer.get(player)
      if (!existing || Number(surfaced.confidenceScore || 0) > Number(existing.confidenceScore || 0)) {
        byPlayer.set(player, surfaced)
      }
    }
    return Array.from(byPlayer.values())
      .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
      .slice(0, 10)
  }

  const layeredLadders = {
    bestSupportOutcomes: buildLadderTierRows("support"),
    bestCeilingOutcomes: buildLadderTierRows("ceiling"),
    bestNukeOutcomes: buildLadderTierRows("nuke")
  }

  const buildTicketLeg = (row, role) => ({
    role,
    player: row?.player || null,
    team: row?.team || null,
    book: row?.book || null,
    marketKey: row?.marketKey || null,
    side: row?.side || null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    outcomeTier: row?.outcomeTier || inferNbaOutcomeTier(row, "tickets"),
    confidenceScore: toFiniteNumber(row?.confidenceScore, 0.5),
    matchup: row?.matchup || null,
    playDecision: row?.playDecision ?? null,
    propVariant: row?.propVariant ?? null,
    ceilingScore: toFiniteNumber(row?.ceilingScore, null)
  })

  const buildTicketCandidate = (legs, ticketType, options = {}) => {
    const safeLegs = (Array.isArray(legs) ? legs : []).filter(Boolean)
    if (safeLegs.length < 2) return null
    const players = safeLegs.map((leg) => String(leg?.player || "").trim().toLowerCase()).filter(Boolean)
    if (new Set(players).size !== players.length) return null

    const uniqueBooks = [...new Set(safeLegs.map((leg) => String(leg?.book || "").trim()).filter(Boolean))]

    if (options?.requireSameBook === true) {
      if (uniqueBooks.length !== 1) return null
    }

    const avgConfidence = safeLegs.reduce((sum, leg) => sum + Number(leg?.confidenceScore || 0), 0) / safeLegs.length
    const payoutDecimal = safeLegs.reduce((acc, leg) => acc * toDecimalOddsForTicket(leg?.odds), 1)
    const payoutSignal = Math.max(0, Math.min(1, (payoutDecimal - 2.2) / 8))
    const ticketScore = Number(((avgConfidence * 0.68) + (payoutSignal * 0.32)).toFixed(4))

    const ticketBook =
      uniqueBooks.length === 1
        ? uniqueBooks[0]
        : (String(safeLegs[0]?.book || "").trim() || null)

    return {
      ticketType,
      legCount: safeLegs.length,
      book: ticketBook,
      ticketScore,
      estimatedPayoutDecimal: Number(payoutDecimal.toFixed(2)),
      legs: safeLegs
    }
  }

  const selectLayeredTickets = (candidates, limit, constraints = {}) => {
    const safeCandidates = (Array.isArray(candidates) ? candidates : [])
      .filter(Boolean)
      .sort((a, b) => Number(b?.ticketScore || 0) - Number(a?.ticketScore || 0))

    const selected = []
    const seenTicketKeys = new Set()
    const playerUses = new Map()
    const matchupUses = new Map()
    const playerCap = Math.max(1, Number(constraints?.maxPlayerUsesAfterFirst || 1))
    const matchupCap = Math.max(1, Number(constraints?.maxMatchupUsesAcrossSurfacedTickets || 2))

    for (const ticket of safeCandidates) {
      const key = (Array.isArray(ticket?.legs) ? ticket.legs : [])
        .map((leg) => [String(leg?.player || ""), String(leg?.marketKey || ""), String(leg?.line ?? "")].join("|"))
        .sort()
        .join("||")
      if (!key || seenTicketKeys.has(key)) continue

      if (selected.length > 0) {
        let blocked = false
        for (const leg of ticket.legs || []) {
          const playerKey = String(leg?.player || "").trim().toLowerCase()
          const matchupKey = String(leg?.matchup || "").trim().toLowerCase()
          if (playerKey && (playerUses.get(playerKey) || 0) >= playerCap) {
            blocked = true
            break
          }
          if (matchupKey && (matchupUses.get(matchupKey) || 0) >= matchupCap) {
            blocked = true
            break
          }
        }
        if (blocked) continue
      }

      seenTicketKeys.add(key)
      selected.push(ticket)
      for (const leg of ticket.legs || []) {
        const playerKey = String(leg?.player || "").trim().toLowerCase()
        const matchupKey = String(leg?.matchup || "").trim().toLowerCase()
        if (playerKey) playerUses.set(playerKey, (playerUses.get(playerKey) || 0) + 1)
        if (matchupKey) matchupUses.set(matchupKey, (matchupUses.get(matchupKey) || 0) + 1)
      }

      if (selected.length >= Math.max(1, Number(limit || 6))) break
    }

    return selected
  }

  const bookCountsFromRows = (rows) => {
    const counts = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
      const bookKey = String(row?.book || "").trim().toLowerCase()
      if (!bookKey) continue
      counts.set(bookKey, (counts.get(bookKey) || 0) + 1)
    }
    return counts
  }

  const booksWithAtLeastRows = (rows, minRows) => {
    const out = new Set()
    for (const [bookKey, count] of bookCountsFromRows(rows).entries()) {
      if (count >= minRows) out.add(bookKey)
    }
    return out
  }

  const intersectBookSets = (a, b) => {
    const out = new Set()
    for (const value of a) {
      if (b.has(value)) out.add(value)
    }
    return out
  }

  const supportLegQualityScore = (row) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row) || 0
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const conservativeOddsBonus = odds >= -185 && odds <= 120 ? 8 : 0
    const longshotPenalty = odds > 160 ? Math.min(14, (odds - 160) * 0.08) : 0
    return (confidence * 44) + (hitRate * 36) + (score * 0.3) + (edgeSignal * 58) + (marketLagScore * 8) + conservativeOddsBonus - longshotPenalty
  }

  const isStrongSupportLeg = (row, strict = false) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edgeSignal = getModelEdgeSignal(row)
    const decisionText = `${String(row?.playDecision || "")} ${String(row?.decisionSummary || "")}`.toLowerCase()
    if (String(row?.outcomeTier || "").toLowerCase() !== "support") return false
    if (!Number.isFinite(odds)) return false
    if (odds < -260 || odds > 220) return false
    if (hitRate < (strict ? 0.54 : 0.5)) return false
    if (score < (strict ? 66 : 60)) return false
    if (confidence < (strict ? 0.56 : 0.5)) return false
    if (strict && decisionText.includes("thin")) return false
    if (strict && Number.isFinite(edgeSignal) && edgeSignal < -0.03) return false
    return true
  }

  const clusterNbaSupportPoolByBook = (rows, max = 12) => {
    const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => supportLegQualityScore(b) - supportLegQualityScore(a))
    const byBook = new Map()
    for (const row of sorted) {
      const key = String(row?.book || "").trim().toLowerCase()
      if (!key) continue
      if (!byBook.has(key)) byBook.set(key, [])
      byBook.get(key).push(row)
    }
    const keys = [...byBook.keys()].sort()
    if (!keys.length) return []
    const perBook = Math.max(2, Math.ceil(max / keys.length))
    const out = []
    for (const k of keys) {
      const bucket = byBook.get(k) || []
      out.push(...bucket.slice(0, perBook))
    }
    return dedupeNbaRowsByLegSignature(out).slice(0, max)
  }

  const nbaSameBookPairPossible = (pool) => {
    for (const count of bookCountsFromRows(pool).values()) {
      if (count >= 2) return true
    }
    return false
  }

  const isBombTicketLeg = (row, strict = false) => {
    if (!isBombLikeRow(row, strict)) return false
    if (isNbaChalkHeavyLeg(row)) return false
    const odds = Number(row?.odds || 0)
    const outcomeTier = String(row?.outcomeTier || "").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    const hasAggressiveVariant = propVariant === "alt-high" || propVariant === "alt-max"
    if (!Number.isFinite(odds)) return false

    // Hard floor: bomb-ticket legs must be longshot shaped, not pick'em or heavy chalk.
    if (odds > 0 && odds < 118) return false
    if (odds <= 0 && odds > -108) return false
    if (odds <= -138) return false
    if (odds > 0 && odds < 190 && outcomeTier !== "nuke") return false

    if (!strict) {
      return (
        outcomeTier === "nuke" ||
        odds >= 275 ||
        (odds >= 220 && (hasAggressiveVariant || ceilingScore >= 0.44 || roleSpikeScore >= 0.3))
      )
    }

    return (
      outcomeTier === "nuke" ||
      odds >= 300 ||
      (odds >= 240 && (ceilingScore >= 0.52 || roleSpikeScore >= 0.36))
    )
  }

  const firstEventLegQualityScore = (row) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row) || 0
    const preferredOddsCenter = 520
    const distancePenalty = Number.isFinite(odds) ? Math.min(18, Math.abs(odds - preferredOddsCenter) * 0.02) : 0
    return (confidence * 58) + (edgeSignal * 54) + (Math.max(0, Math.min(1200, odds)) * 0.03) - distancePenalty
  }

  const isQualityFirstEventLeg = (row, strict = false) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const isFirstEventMarket = marketKey.includes("first_basket") || marketKey.includes("first_team_basket")
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row)
    if (!isFirstEventMarket) return false
    if (!Number.isFinite(odds)) return false
    if (odds < 140 || odds > 1800) return false
    if (confidence < (strict ? 0.44 : 0.4)) return false
    if (strict && Number.isFinite(edgeSignal) && edgeSignal < -0.045) return false
    return true
  }

  const isFirstEventAnchorLeg = (row) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row)
    return Number.isFinite(odds) &&
      odds <= 780 &&
      confidence >= 0.5 &&
      (!Number.isFinite(edgeSignal) || edgeSignal >= -0.03)
  }

  const ticketSupportCandidates = dedupeNbaRowsByLegSignature([
    ...(Array.isArray(bestPayloadRows) ? bestPayloadRows : [])
      .filter((row) => isAllowedNbaBookRow(row))
      .filter((row) => !isNbaSpecialMarketRow(row))
      .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSingles", sourceLane: "bestPayload" })),
    ...(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : [])
      .filter((row) => isAllowedNbaBookRow(row))
      .filter((row) => !isNbaSpecialMarketRow(row))
      .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSingles", sourceLane: "bestSingles" })),
    ...layerBestValue
  ])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => String(row?.outcomeTier || "").toLowerCase() === "support")
    .sort((a, b) => supportLegQualityScore(b) - supportLegQualityScore(a))

  const ticketBombCandidates = dedupeNbaRowsByLegSignature([
    ...layerBestLongshotPlays,
    ...layerBestUpside.filter((row) => row?.outcomeTier !== "support")
  ])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => !isNbaSpecialMarketRow(row))
    .filter((row) => !isNbaChalkHeavyLeg(row))
    .sort((a, b) => longshotQualityScore(b) - longshotQualityScore(a))

  const ticketFirstEventCandidates = dedupeNbaRowsByLegSignature([
    ...layerFirstBasket,
    ...layerFirstTeamBasket
  ])
    .filter((row) => isAllowedNbaBookRow(row))
    .sort((a, b) => firstEventLegQualityScore(b) - firstEventLegQualityScore(a))

  const ticketSupportStrict = ticketSupportCandidates.filter((row) => isStrongSupportLeg(row, true))
  const ticketSupportRelaxed = ticketSupportCandidates.filter((row) => isStrongSupportLeg(row, false))
  const ticketBombStrict = ticketBombCandidates.filter((row) => isBombTicketLeg(row, true))
  const ticketBombRelaxed = ticketBombCandidates.filter((row) => isBombTicketLeg(row, false))
  const ticketFirstEventStrict = ticketFirstEventCandidates.filter((row) => isQualityFirstEventLeg(row, true))
  const ticketFirstEventRelaxed = ticketFirstEventCandidates.filter((row) => isQualityFirstEventLeg(row, false))

  let ticketSupportPool = (nbaLoadedSlateQualityPassEnabled && ticketSupportStrict.length >= 6 ? ticketSupportStrict : ticketSupportRelaxed).slice(0, 12)
  let ticketBombPool = ticketBombStrict.slice(0, 14)
  let ticketFirstEventPool = (nbaLoadedSlateQualityPassEnabled && ticketFirstEventStrict.length >= 6 ? ticketFirstEventStrict : ticketFirstEventRelaxed).slice(0, 10)

  const strictBombPoolTooThin =
    ticketBombPool.length < 2 ||
    booksWithAtLeastRows(ticketBombPool, 2).size === 0
  if (strictBombPoolTooThin) {
    ticketBombPool = ticketBombRelaxed.slice(0, 14)
  }

  if (ticketSupportPool.length === 0) ticketSupportPool = ticketSupportCandidates.slice(0, 12)
  if (ticketBombPool.length === 0) {
    const shapeOk = ticketBombCandidates
      .filter((row) => !isNbaChalkHeavyLeg(row))
      .filter((row) => isBombLikeRow(row, false))
    const fallbackRows = shapeOk.length ? shapeOk : layerBestLongshotPlays
    ticketBombPool = fallbackRows
      .filter((row) => !isNbaChalkHeavyLeg(row))
      .filter((row) => isBombLikeRow(row, false))
      .slice(0, 14)
  }
  if (ticketFirstEventPool.length === 0) ticketFirstEventPool = ticketFirstEventCandidates.slice(0, 10)

  if (!nbaSameBookPairPossible(ticketSupportPool) && ticketSupportCandidates.length >= 3) {
    const relaxedForPairs = ticketSupportRelaxed.length ? ticketSupportRelaxed : ticketSupportCandidates
    ticketSupportPool = clusterNbaSupportPoolByBook(relaxedForPairs, 12)
  }

  const bombPlusSupportBooks = intersectBookSets(
    booksWithAtLeastRows(ticketBombPool, 1),
    booksWithAtLeastRows(ticketSupportPool, 1)
  )
  if (nbaLoadedSlateQualityPassEnabled && bombPlusSupportBooks.size === 0) {
    ticketSupportPool = ticketSupportRelaxed.slice(0, 12)
  }

  if (nbaLoadedSlateQualityPassEnabled && booksWithAtLeastRows(ticketFirstEventPool, 2).size === 0) {
    ticketFirstEventPool = ticketFirstEventRelaxed.slice(0, 10)
  }

  const buildableBombPairBooks = booksWithAtLeastRows(ticketBombPool, 2)
  const buildableBombPlusSupportBooks = intersectBookSets(
    booksWithAtLeastRows(ticketBombPool, 1),
    booksWithAtLeastRows(ticketSupportPool, 1)
  )
  const buildableFirstEventBooks = booksWithAtLeastRows(ticketFirstEventPool, 2)
  const ticketBuildableBooks = Array.from(new Set([
    ...Array.from(buildableBombPairBooks),
    ...Array.from(buildableBombPlusSupportBooks),
    ...Array.from(buildableFirstEventBooks)
  ]))

  const buildBombPairTickets = () => {
    const candidates = []
    for (let i = 0; i < ticketBombPool.length; i += 1) {
      for (let j = i + 1; j < ticketBombPool.length; j += 1) {
        const ticket = buildTicketCandidate([
          buildTicketLeg(ticketBombPool[i], "bomb"),
          buildTicketLeg(ticketBombPool[j], "bomb")
        ], "bombPair", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 6, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const buildBombPlusSupportTickets = () => {
    const candidates = []
    for (const bomb of ticketBombPool.slice(0, 8)) {
      for (const support of ticketSupportPool.slice(0, 10)) {
        const ticket = buildTicketCandidate([
          buildTicketLeg(bomb, "bomb"),
          buildTicketLeg(support, "support")
        ], "bombPlusSupport", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 8, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const buildSafePairTickets = () => {
    const candidates = []
    const safeRows = ticketSupportPool.slice(0, 12)
    for (let i = 0; i < safeRows.length; i += 1) {
      for (let j = i + 1; j < safeRows.length; j += 1) {
        const ticket = buildTicketCandidate([
          buildTicketLeg(safeRows[i], "support"),
          buildTicketLeg(safeRows[j], "support")
        ], "safePair", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 6, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const buildFirstEventClusterTickets = () => {
    const candidates = []
    for (let i = 0; i < ticketFirstEventPool.length; i += 1) {
      for (let j = i + 1; j < ticketFirstEventPool.length; j += 1) {
        if (nbaLoadedSlateQualityPassEnabled) {
          const a = ticketFirstEventPool[i]
          const b = ticketFirstEventPool[j]
          const hasAnchorLeg = isFirstEventAnchorLeg(a) || isFirstEventAnchorLeg(b)
          if (!hasAnchorLeg) continue
        }
        const ticket = buildTicketCandidate([
          buildTicketLeg(ticketFirstEventPool[i], "firstEvent"),
          buildTicketLeg(ticketFirstEventPool[j], "firstEvent")
        ], "firstEventCluster", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 6, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const nbaRowQualityAudit = {
    loadedSlateQualityPassEnabled: nbaLoadedSlateQualityPassEnabled,
    liveRowsDetected: liveRowsForQualityMode.length,
    liveBooksDetected: liveBooksForQualityMode.size,
    snapshotSlateGameCount,
    slateMode: null,
    bottlenecks: {
      bestValueRowsBlockedByStrictGate: Math.max(0, curatedBestValueRaw.length - bestValueLaneQuality.strictCount),
      bestUpsideRowsBlockedByStrictGate: Math.max(0, curatedBestUpsideRaw.length - bestUpsideLaneQuality.strictCount),
      bombCandidatesBlockedByStrictGate: Math.max(0, ticketBombCandidates.length - ticketBombStrict.length),
      supportCandidatesBlockedByStrictGate: Math.max(0, ticketSupportCandidates.length - ticketSupportStrict.length),
      firstEventCandidatesBlockedByStrictGate: Math.max(0, ticketFirstEventCandidates.length - ticketFirstEventStrict.length)
    },
    lanes: {
      bestValue: {
        rawCount: curatedBestValueRaw.length,
        strictEligibleCount: bestValueLaneQuality.strictCount,
        relaxedEligibleCount: bestValueLaneQuality.relaxedCount,
        finalCount: curatedBestValue.length,
        usedRelaxedFallback: bestValueLaneQuality.usedRelaxedFallback
      },
      bestUpside: {
        rawCount: curatedBestUpsideRaw.length,
        strictEligibleCount: bestUpsideLaneQuality.strictCount,
        relaxedEligibleCount: bestUpsideLaneQuality.relaxedCount,
        finalCount: curatedBestUpside.length,
        usedRelaxedFallback: bestUpsideLaneQuality.usedRelaxedFallback
      },
      bestLongshotPlays: {
        finalCount: layerBestLongshotPlays.length,
        explosionFeedCount: longshotExplosionFeed.length,
        snapshotPropCandidatesConsidered: snapshotPropsForLongshotExplosion.length
      },
      supportPool: {
        strictEligibleCount: ticketSupportStrict.length,
        relaxedEligibleCount: ticketSupportRelaxed.length,
        finalCount: ticketSupportPool.length
      }
    },
    tickets: {
      supportPool: {
        strictEligibleCount: ticketSupportStrict.length,
        relaxedEligibleCount: ticketSupportRelaxed.length,
        finalCount: ticketSupportPool.length
      },
      bombPool: {
        strictEligibleCount: ticketBombStrict.length,
        relaxedEligibleCount: ticketBombRelaxed.length,
        finalCount: ticketBombPool.length
      },
      firstEventPool: {
        strictEligibleCount: ticketFirstEventStrict.length,
        relaxedEligibleCount: ticketFirstEventRelaxed.length,
        finalCount: ticketFirstEventPool.length
      },
      buildableBooks: {
        bombPair: Array.from(buildableBombPairBooks).sort(),
        bombPlusSupport: Array.from(buildableBombPlusSupportBooks).sort(),
        firstEventCluster: Array.from(buildableFirstEventBooks).sort()
      }
    }
  }
  nbaRowQualityAudit.slateMode = detectSlateMode({
    sportKey: "nba",
    snapshotMeta: buildSnapshotMeta(),
    snapshot: oddsSnapshot,
    runtime: {
      liveRowsDetected: liveRowsForQualityMode.length,
      liveBooksDetected: liveBooksForQualityMode.size,
      loadedSlateQualityPassEnabled: nbaLoadedSlateQualityPassEnabled
    }
  })

  const layeredSurfaced = {
    convictions: {
      bestPlayerConvictions: layeredConvictions
    },
    ladders: layeredLadders,
    boards: {
      bestValue: layerBestValue,
      bestUpside: layerBestUpside,
      bestLongshotPlays: layerBestLongshotPlays,
      bestLadders: layerBestLadders,
      bestFirstBasket: layerFirstBasket,
      bestFirstTeamBasket: layerFirstTeamBasket,
      bestDoubleDoubles: layerDoubleDoubles,
      bestTripleDoubles: layerTripleDoubles,
      bestSpecials: layerBestSpecials
    },
    tickets: {
      bestBombPairTickets: buildBombPairTickets(),
      bestBombPlusSupportTickets: buildBombPlusSupportTickets(),
      bestSafePairTickets: buildSafePairTickets(),
      bestFirstEventClusterTickets: buildFirstEventClusterTickets()
    },
    execution: {
      bestBookByPlay: [],
      bestBookByTicket: [],
      ticketBuildableBooks: ticketBuildableBooks
    },
    qualityAudit: nbaRowQualityAudit,
    recovery: {
      bestRecoveryPlay: [],
      bestRecoveryTicket: [],
      bestAnchorLeg: [],
      bestAnchorTicket: []
    }
  }

  const nbaSurfacedLongshotTop = (Array.isArray(layerBestLongshotPlays) && layerBestLongshotPlays.length)
    ? layerBestLongshotPlays[0]
    : null
  const nbaSurfacedSafePairTickets = Array.isArray(layeredSurfaced?.tickets?.bestSafePairTickets)
    ? layeredSurfaced.tickets.bestSafePairTickets
    : []
  const nbaSurfacedSafePairTop = nbaSurfacedSafePairTickets[0] || null

  return res.json({
    bestAvailable: {
      ...bestAvailablePayloadBoardFirst,
      // Preserve the full /api/best-available contract: these are generated by
      // buildLiveDualBestAvailablePayload() but were previously destructured
      // out and never re-attached to the response payload.
      safe,
      balanced,
      aggressive,
      lotto,
      slateMode: nbaRowQualityAudit?.slateMode || null,
      longshotTop: nbaSurfacedLongshotTop,
      safePairTop: nbaSurfacedSafePairTop,
      highestHitRate2,
      highestHitRate3,
      highestHitRate4,
      highestHitRate5,
      highestHitRate6,
      highestHitRate7,
      highestHitRate8,
      highestHitRate9,
      highestHitRate10,
      payoutFitPortfolio,
      moneyMakerPortfolio,
      diagnostics: mergedBestAvailableDiagnostics,
      poolDiagnostics: mergedBestAvailablePoolDiagnostics,
      specialProps: enrichedSpecialProps,
      bettingNow,
      slateBoard,
      topCard,
      mostLikelyToHit: curatedMostLikelyToHit,
      bestValue: curatedBestValue,
      bestUpside: curatedBestUpside,
      boards,
      firstBasketBoard,
      corePropsBoard,
      ladderBoard,
      specialBoard,
      lottoBoard,
      firstBasketPicks,
      corePropPicks,
      lottoPicks,
      gameEdgeBoard,
      mustPlayBoard,
      featuredPlays,
      firstBasket: specialtyLaneOutputs.firstBasket,
      firstTeamBasket: specialtyLaneOutputs.firstTeamBasket,
      specials: specialtyLaneOutputs.specials,
      featured: specialtyLaneOutputs.featured,
      bestDoubleDoubles: typeAwareSpecials.bestDoubleDoubles,
      bestTripleDoubles: typeAwareSpecials.bestTripleDoubles,
      bestFirstBasket: typeAwareSpecials.bestFirstBasket,
      bestFirstTeamBasket: typeAwareSpecials.bestFirstTeamBasket,
      bestLongshotPlays: layerBestLongshotPlays,
      bestLongshotSpecials: layerBestLongshotPlays,
      surfaced: layeredSurfaced,
      tonightsPlays: {
        bestSingles: tonightsBestSingles,
        bestLadders: tonightsBestLadders,
        bestSpecials: surfacedBestSpecials,
        mustPlayCandidates,
        curated: {
          mostLikelyToHit: curatedMostLikelyToHit,
          bestValue: curatedBestValue,
          bestUpside: curatedBestUpside
        },
        boardProgress,
        surfaced: layeredSurfaced,
        counts: {
          bestSingles: tonightsBestSingles.length,
          bestLadders: tonightsBestLadders.length,
          bestSpecials: tonightsBestSpecials.length,
          mustPlayCandidates: mustPlayCandidates.length,
          mostLikelyToHit: curatedMostLikelyToHit.length,
          bestValue: curatedBestValue.length,
          bestUpside: curatedBestUpside.length
        },
        evaluation: tonightsPlaysEvaluation
      },
      specialsAudit: specialsAudit
    },
    ladderPool,
    routePlayableSeed: routePlayableSeed,
    finalPlayableRows: finalPlayableRows,
    standardCandidates: standardCandidates,
    ladderCandidates: ladderCandidates,
    coreStandardProps,
    ladderProps,
    specialProps: specialPropsBoard,
    boardCounts,
    snapshotMeta,
    slateStateValidator: oddsSnapshot?.slateStateValidator || null,
    lineHistorySummary: oddsSnapshot?.lineHistorySummary || null
  })
})

const PORT = process.env.PORT || 4000
const ODDS_API_KEY = process.env.ODDS_API_KEY
const API_SPORTS_KEY = process.env.API_SPORTS_KEY

let playerIdCache = new Map()
let playerStatsCache = new Map()
let playerLookupMissCache = new Set()
let apiSportsEmptySearchStreak = 0

const CACHE_FILE = path.join(__dirname, "api-sports-cache.json")

function loadApiSportsCachesFromDisk() {
  // Async, non-blocking load of API-Sports caches from disk.
  return (async () => {
    try {
      await fs.promises.access(CACHE_FILE)
    } catch (err) {
      // No cache file yet; that's fine.
      return
    }

    try {
      const raw = await fs.promises.readFile(CACHE_FILE, "utf8")
      if (!raw) return

      const parsed = JSON.parse(raw)

      for (const [key, value] of Object.entries(parsed.playerIdCache || {})) {
        playerIdCache.set(key, value)
      }

      for (const [key, value] of Object.entries(parsed.playerStatsCache || {})) {
        playerStatsCache.set(Number(key), value)
      }

      // CRITICAL FIX: When reloading cache from disk, refresh timestamps to NOW
      // so entries are not immediately considered stale by the TTL check.
      // Otherwise, cached entries fail (now - cachedAt < TTL) check and trigger
      // new API calls despite having valid data.
      const now = Date.now()
      for (const [key, value] of Object.entries(parsed.playerStatsCacheTimes || {})) {
        playerStatsCacheTimes.set(Number(key), now)
      }

      for (const value of parsed.playerLookupMissCache || []) {
        playerLookupMissCache.add(value)
      }

      console.log(
        "Loaded API-Sports cache from disk:",
        "ids=", playerIdCache.size,
        "stats=", playerStatsCache.size + " (timestamps refreshed to now)",
        "misses=", playerLookupMissCache.size
      )
    } catch (error) {
      console.error("Failed loading API-Sports cache from disk:", error.message)
    }
  })()
}

function saveApiSportsCachesToDisk() {
  // Async, non-blocking save of API-Sports caches to disk.
  return (async () => {
    try {
      const payload = {
        playerIdCache: Object.fromEntries(playerIdCache.entries()),
        playerStatsCache: Object.fromEntries(playerStatsCache.entries()),
        playerStatsCacheTimes: Object.fromEntries(playerStatsCacheTimes.entries()),
        playerLookupMissCache: Array.from(playerLookupMissCache.values())
      }

      await fs.promises.writeFile(CACHE_FILE, JSON.stringify(payload))
    } catch (error) {
      console.error("Failed saving API-Sports cache to disk:", error.message)
    }
  })()
}
const API_SPORTS_EMPTY_SEARCH_STREAK_LIMIT = 25
const MANUAL_PLAYER_OVERRIDES = {
  "Tristan da Silva": { id: 4348, team: "Orlando Magic" },
  "Tristan Da Silva": { id: 4348, team: "Orlando Magic" },
  "Tristan DaSilva": { id: 4348, team: "Orlando Magic" },
  "Dean Wade": { id: 2898, team: "Cleveland Cavaliers" },
  "Jevon Carter": { id: 874, team: "Chicago Bulls" },
  "Moe Wagner": { id: 1925, team: "Orlando Magic" },
  "Moritz Wagner": { id: 1925, team: "Orlando Magic" },
  "Cameron Johnson": { id: 1536, team: "Brooklyn Nets" },
  "Jabari Smith Jr": { id: 3405, team: "Houston Rockets" },
  "Jabari Smith Jr.": { id: 3405, team: "Houston Rockets" },
  "Drew Eubanks": { id: 2036, team: "Utah Jazz" },
  "Wendell Carter Jr": { id: 4347, team: "Orlando Magic" },
  "Duncan Robinson": { id: 897, team: "Detroit Pistons" },
  "Isaiah Stewart II": { id: 2177, team: "Detroit Pistons" }
}
let lastSnapshotRefreshAt = 0
const SNAPSHOT_COOLDOWN_MS = 60 * 1000
const ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH = String(process.env.ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH || "false").toLowerCase() === "true"
const ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH = String(process.env.ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH || "false").toLowerCase() === "true"
const ENABLE_NBA_ODDS_REPLAY_MODE = String(process.env.ENABLE_NBA_ODDS_REPLAY_MODE || "false").toLowerCase() === "true"
const NBA_REPLAY_SNAPSHOT_PATH = path.join(__dirname, "snapshot.json")
// CRITICAL FIX: Increased from 1 to 10 to fix 98% API-Sports usage spike.
// Reason: Concurrency=1 meant player lookups happened serially (one at a time).
// With 200+ unique players per refresh, this multiplied request time and API calls.
// Raising to 10 processes batches in parallel, reducing refresh time ~10x.
const PLAYER_LOOKUP_CONCURRENCY = 10
const API_SPORTS_TIMEOUT_MS = 5000
const PLAYER_STATS_TTL_MS = 30 * 60 * 1000
let playerStatsCacheTimes = new Map()

function isNbaOddsReplayRequest(req) {
  const replayParam = String(req?.query?.replay || "").toLowerCase().trim()
  return ENABLE_NBA_ODDS_REPLAY_MODE || replayParam === "1" || replayParam === "true"
}

async function loadNbaReplaySnapshotFromDisk() {
  try {
    const raw = await fs.promises.readFile(NBA_REPLAY_SNAPSHOT_PATH, "utf8")
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const snapshot = (parsed?.data && typeof parsed.data === "object") ? parsed.data : parsed
    if (!snapshot || typeof snapshot !== "object") return null

    if (!Array.isArray(snapshot.events)) snapshot.events = []
    if (!Array.isArray(snapshot.rawProps)) snapshot.rawProps = []
    if (!Array.isArray(snapshot.props)) snapshot.props = []
    if (!Array.isArray(snapshot.eliteProps)) snapshot.eliteProps = []
    if (!Array.isArray(snapshot.strongProps)) snapshot.strongProps = []
    if (!Array.isArray(snapshot.playableProps)) snapshot.playableProps = []
    if (!Array.isArray(snapshot.bestProps)) snapshot.bestProps = []
    if (!Array.isArray(snapshot.flexProps)) snapshot.flexProps = []
    if (!snapshot.diagnostics || typeof snapshot.diagnostics !== "object") snapshot.diagnostics = {}

    return snapshot
  } catch (error) {
    console.error("[NBA-REPLAY] Failed loading replay snapshot:", error?.message || error)
    return null
  }
}

function buildReplayRefreshResponse({ source = "replay-disk-snapshot" } = {}) {
  const refreshMeta = buildSnapshotMeta({ source })
  return {
    ok: true,
    replay: true,
    cached: true,
    message: "Snapshot loaded from replay cache",
    source,
    liveOddsFetchAttempted: false,
    liveOddsFetchSkipped: true,
    liveExternalFetchAttempted: false,
    apiSpendExpected: 0,
    snapshotMeta: refreshMeta,
    snapshotGeneratedAt: refreshMeta?.snapshotGeneratedAt || oddsSnapshot?.snapshotGeneratedAt || oddsSnapshot?.updatedAt || null,
    snapshotSlateDateLocal: refreshMeta?.snapshotSlateDateLocal || oddsSnapshot?.snapshotSlateDateLocal || oddsSnapshot?.snapshotSlateDateKey || null,
    snapshotSlateDateKey: oddsSnapshot?.snapshotSlateDateKey || null,
    snapshotSlateGameCount: Number(oddsSnapshot?.snapshotSlateGameCount || 0),
    slateStateValidator: oddsSnapshot?.slateStateValidator || null,
    lineHistorySummary: oddsSnapshot?.lineHistorySummary || null,
    marketCoverageFocusDebug: lastMarketCoverageFocusDebug,
    counts: {
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
      props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
      bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
      playableProps: Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps.length : 0,
      strongProps: Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps.length : 0,
      eliteProps: Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps.length : 0
    }
  }
}

function getNbaReplayEventTime(event) {
  return event?.commence_time || event?.gameTime || event?.startTime || event?.start_time || event?.game_time || ""
}

function recomputeNbaReplaySlateState(snapshot, { logTag = "[SLATE-SELECTION-DEBUG-REPLAY-MODE]", routeTag = "refresh-snapshot" } = {}) {
  const replayReferenceTimeIso =
    snapshot?.snapshotGeneratedAt ||
    snapshot?.updatedAt ||
    null
  const replayReferenceTimeMs = replayReferenceTimeIso
    ? new Date(replayReferenceTimeIso).getTime()
    : NaN
  const replaySlateNow = Number.isFinite(replayReferenceTimeMs)
    ? replayReferenceTimeMs
    : Date.now()

  const replayTodayDateKey = toDetroitDateKey(replaySlateNow)
  const replayTomorrowDateKey = toDetroitDateKey(replaySlateNow + 24 * 60 * 60 * 1000)
  const replayAllEvents = Array.isArray(snapshot?.events) ? snapshot.events : []

  const replayTodayEvents = replayAllEvents.filter((event) =>
    toDetroitDateKey(getNbaReplayEventTime(event)) === replayTodayDateKey
  )
  const replayTomorrowEvents = replayAllEvents.filter((event) =>
    toDetroitDateKey(getNbaReplayEventTime(event)) === replayTomorrowDateKey
  )
  const replayTodayPregameEligible = replayTodayEvents.filter((event) => {
    const eventMs = new Date(getNbaReplayEventTime(event)).getTime()
    return Number.isFinite(eventMs) && eventMs > replaySlateNow
  })

  let replayChosenSlateDateKey = replayTodayDateKey
  let replayChosenEvents = replayTodayPregameEligible

  if (replayTodayPregameEligible.length === 0 && replayTomorrowEvents.length > 0) {
    replayChosenSlateDateKey = replayTomorrowDateKey
    replayChosenEvents = replayTomorrowEvents
  }

  const replayChosenEventIds = new Set(
    replayChosenEvents
      .map((event) => String(event?.id || event?.eventId || ""))
      .filter(Boolean)
  )

  const replayRawProps = Array.isArray(snapshot?.rawProps) ? snapshot.rawProps : []
  const replayRawPropsCountByEventId = replayRawProps.reduce((acc, row) => {
    const eventId = String(row?.eventId || "")
    if (!eventId) return acc
    acc.set(eventId, (acc.get(eventId) || 0) + 1)
    return acc
  }, new Map())

  const replayProps = Array.isArray(snapshot?.props) ? snapshot.props : []
  const replayChosenEventsWithProps = new Set(
    replayProps
      .map((row) => String(row?.eventId || ""))
      .filter((eventId) => replayChosenEventIds.has(eventId))
  )

  const chosenEventCoverageStates = replayChosenEvents.map((event) => {
    const eventId = String(event?.id || event?.eventId || "")
    const rawPropsCountBeforeFinalFiltering = Number(replayRawPropsCountByEventId.get(eventId) || 0)
    const hasProps = replayChosenEventsWithProps.has(eventId)
    return {
      eventId,
      matchup: event?.matchup || `${event?.away_team || event?.awayTeam || "?"} @ ${event?.home_team || event?.homeTeam || "?"}`,
      postingState: hasProps ? "props_posted" : "no_props_posted_yet",
      rawPropsCountBeforeFinalFiltering
    }
  })

  const chosenEventsWithPropsCount = replayChosenEventsWithProps.size
  const missingChosenEventIds = chosenEventCoverageStates
    .filter((item) => item.postingState !== "props_posted")
    .map((item) => item.eventId)

  const missingChosenEventSummaries = replayChosenEvents
    .filter((event) => missingChosenEventIds.includes(String(event?.id || event?.eventId || "")))
    .map((event) => {
      const eventId = String(event?.id || event?.eventId || "")
      return {
        eventId,
        matchup: event?.matchup || null,
        commenceTime: getNbaReplayEventTime(event) || null,
        homeTeam: event?.homeTeam || event?.home_team || null,
        awayTeam: event?.awayTeam || event?.away_team || null,
        postingState: "no_props_posted_yet",
        dkFetchError: false,
        dkRequestSucceeded: false,
        dkBookmakerEntries: 0,
        dkMarketEntries: 0,
        rawPropsExistedBeforeFinalFiltering: Number(replayRawPropsCountByEventId.get(eventId) || 0) > 0,
        rawPropsCountBeforeFinalFiltering: Number(replayRawPropsCountByEventId.get(eventId) || 0)
      }
    })

  let slateState = "active_today"
  if (replayChosenSlateDateKey === replayTomorrowDateKey) {
    slateState = "rolled_to_tomorrow"
  } else if (replayChosenEvents.length > 0 && chosenEventsWithPropsCount === 0) {
    slateState = "awaiting_posting"
  }

  snapshot.snapshotSlateDateKey = replayChosenSlateDateKey || null
  snapshot.snapshotSlateDateLocal = replayChosenSlateDateKey || null
  snapshot.snapshotSlateGameCount = replayChosenEvents.length
  snapshot.slateStateValidator = {
    currentDateKeyChosen: replayChosenSlateDateKey || null,
    currentPregameGameCount: replayTodayPregameEligible.length,
    todayTotalGames: replayTodayEvents.length,
    tomorrowTotalGames: replayTomorrowEvents.length,
    todayHasPregameGames: replayTodayPregameEligible.length > 0,
    tomorrowPropsPartiallyPosted: false,
    slateState,
    chosenEventsWithPropsCount,
    chosenEventCount: replayChosenEvents.length,
    partialPostedChosenEventCount: 0,
    noPropsPostedChosenEventCount: chosenEventCoverageStates.filter((item) => item.postingState === "no_props_posted_yet").length,
    ingestErrorChosenEventCount: 0,
    chosenEventCoverageStates,
    missingChosenEventIds,
    missingChosenEventSummaries,
    rolloverApplied: replayChosenSlateDateKey !== replayTodayDateKey,
    nextDateKeyConsidered: replayTomorrowDateKey,
    nextPregameGameCount: replayTomorrowEvents.filter((event) => {
      const eventMs = new Date(getNbaReplayEventTime(event)).getTime()
      return Number.isFinite(eventMs) && eventMs > replaySlateNow
    }).length
  }

  console.log(logTag, {
    route: routeTag,
    now: new Date(replaySlateNow).toISOString(),
    referenceTimeIso: replayReferenceTimeIso,
    todayDateKey: replayTodayDateKey,
    tomorrowDateKey: replayTomorrowDateKey,
    todayEventCount: replayTodayEvents.length,
    todayPregameEligibleCount: replayTodayPregameEligible.length,
    tomorrowEventCount: replayTomorrowEvents.length,
    chosenSlateDateKey: replayChosenSlateDateKey,
    chosenEventCount: replayChosenEvents.length,
    chosenEvents: replayChosenEvents.map((e) => ({
      eventId: e?.id || e?.eventId || null,
      matchup: `${e?.away_team || e?.awayTeam || "?"} @ ${e?.home_team || e?.homeTeam || "?"}`
    }))
  })
}

async function sendNbaReplayRefreshResponse(res, { routeTag = "refresh-snapshot", logTag = "[SLATE-SELECTION-DEBUG-REPLAY-MODE]" } = {}) {
  const replaySnapshot = await loadNbaReplaySnapshotFromDisk()
  if (!replaySnapshot) {
    return res.status(503).json({
      ok: false,
      error: "Replay mode requested but snapshot replay file is missing or invalid",
      replay: true
    })
  }

  oddsSnapshot = replaySnapshot
  lastSnapshotSource = "replay-disk-snapshot"
  snapshotLoadedFromDisk = true
  lastSnapshotSavedAt = Date.now()
  lastSnapshotAgeMinutes = 0

  recomputeNbaReplaySlateState(oddsSnapshot, { logTag, routeTag })

  return res.status(200).json(buildReplayRefreshResponse({ source: "replay-disk-snapshot" }))
}

function ensureNbaRefreshEnvConfigured(res) {
  if (!ODDS_API_KEY) {
    res.status(500).json({ error: "Missing ODDS_API_KEY in .env" })
    return false
  }

  if (!API_SPORTS_KEY) {
    res.status(500).json({ error: "Missing API_SPORTS_KEY in .env" })
    return false
  }

  return true
}

async function fetchNbaUnrestrictedSlateEvents() {
  const unrestrictedEventsResponse = await axios.get(
    "https://api.the-odds-api.com/v4/sports/basketball_nba/events",
    {
      params: { apiKey: ODDS_API_KEY },
      timeout: 15000
    }
  )

  const unrestrictedFetchedEvents = Array.isArray(unrestrictedEventsResponse?.data)
    ? unrestrictedEventsResponse.data
    : []

  const {
    allEvents,
    scheduledEvents
  } = await buildSlateEvents({
    oddsApiKey: ODDS_API_KEY,
    now: Date.now(),
    events: unrestrictedFetchedEvents
  })

  return {
    allEvents,
    scheduledEvents
  }
}

// ===== MLB REPLAY MODE SUPPORT (Phase 7) =====
const ENABLE_MLB_ODDS_REPLAY_MODE = String(process.env.ENABLE_MLB_ODDS_REPLAY_MODE || "false").toLowerCase() === "true"
const MLB_REPLAY_SNAPSHOT_PATH = path.join(__dirname, "snapshot-mlb.json")

function isMlbOddsReplayRequest(req) {
  const replayParam = String(req?.query?.replay || "").toLowerCase().trim()
  return ENABLE_MLB_ODDS_REPLAY_MODE || replayParam === "1" || replayParam === "true"
}

async function loadMlbReplaySnapshotFromDisk() {
  try {
    const raw = await fs.promises.readFile(MLB_REPLAY_SNAPSHOT_PATH, "utf8")
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const snapshot = (parsed?.data && typeof parsed.data === "object") ? parsed.data : parsed
    if (!snapshot || typeof snapshot !== "object") return null

    // Normalize arrays
    if (!Array.isArray(snapshot.events)) snapshot.events = []
    if (!Array.isArray(snapshot.rawOddsEvents)) snapshot.rawOddsEvents = []
    if (!Array.isArray(snapshot.rows)) snapshot.rows = []

    // Normalize diagnostics
    if (!snapshot.diagnostics || typeof snapshot.diagnostics !== "object") snapshot.diagnostics = {}
    if (!Array.isArray(snapshot.diagnostics.failedEvents)) snapshot.diagnostics.failedEvents = []
    if (!snapshot.diagnostics.byBook) snapshot.diagnostics.byBook = {}
    if (!snapshot.diagnostics.byMarketFamily) snapshot.diagnostics.byMarketFamily = {}
    if (!snapshot.diagnostics.enrichmentCoverage) snapshot.diagnostics.enrichmentCoverage = {}

    return snapshot
  } catch (err) {
    console.error(`[MLB-REPLAY] Failed to load MLB replay snapshot: ${err.message}`)
    return null
  }
}

async function saveMlbReplaySnapshotToDisk(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return

  try {
    await fs.promises.writeFile(
      MLB_REPLAY_SNAPSHOT_PATH,
      JSON.stringify({
        data: snapshot,
        savedAt: Date.now()
      })
    )
  } catch (err) {
    console.error(`[MLB-REPLAY] Failed to save MLB replay snapshot: ${err.message}`)
  }
}

function buildMlbReplayRefreshResponse(sourceSnap = {}) {
  const rows = Array.isArray(sourceSnap?.rows) ? sourceSnap.rows : []
  return {
    ok: true,
    replay: true,
    source: "mlb-replay-disk-snapshot",
    sport: "mlb",
    classificationVersion: MLB_BOOTSTRAP_CLASSIFICATION_VERSION,
    updatedAt: sourceSnap?.updatedAt || sourceSnap?.snapshotGeneratedAt || null,
    snapshotSlateDateKey: sourceSnap?.snapshotSlateDateKey || null,
    events: Array.isArray(sourceSnap?.events) ? sourceSnap.events.length : 0,
    fetchedEventOdds: Array.isArray(sourceSnap?.rawOddsEvents) ? sourceSnap.rawOddsEvents.length : 0,
    rows: rows.length,
    byBook: (sourceSnap?.diagnostics && sourceSnap.diagnostics.byBook) || {},
    byMarketFamily: (sourceSnap?.diagnostics && sourceSnap.diagnostics.byMarketFamily) || {},
    externalSnapshotMeta: sourceSnap?.externalSnapshotMeta || null,
    diagnostics: {
      enrichmentCoverage: (sourceSnap?.diagnostics && sourceSnap.diagnostics.enrichmentCoverage) || null
    },
    failedEventCount: Number(sourceSnap?.diagnostics?.failedEventCount || 0)
  }
}

function normalizePropType(key) {
  const normalizedKey = String(key || "").trim().toLowerCase()
  switch (normalizedKey) {
    case "player_points":
      return "Points"
    case "player_assists":
      return "Assists"
    case "player_rebounds":
      return "Rebounds"
    case "player_threes":
      return "Threes"
    case "player_points_rebounds_assists":
    case "player_pra":
    case "pra":
      return "PRA"
    case "player_first_basket":
      return "First Basket"
    case "player_first_team_basket":
      return "First Team Basket"
    case "player_points_alternate":
      return "Points Ladder"
    case "player_rebounds_alternate":
      return "Rebounds Ladder"
    case "player_assists_alternate":
      return "Assists Ladder"
    case "player_threes_alternate":
      return "Threes Ladder"
    case "player_points_rebounds_assists_alternate":
      return "PRA Ladder"
    default:
      return null
  }
}

function buildMatchup(awayTeam, homeTeam) {
  return `${awayTeam} @ ${homeTeam}`
}


function getSlateDateKey(dateString) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ""

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date)
}

function getTodaySlateDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date())
}

function toDetroitDateKey(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date)
}


function filterEventsToPrimarySlate(events = []) {
  const allEvents = [...events]
    .filter((event) => Number.isFinite(new Date(event?.commence_time || event?.gameTime || "").getTime()))
    .sort((a, b) => {
      const aMs = new Date(a?.commence_time || a?.gameTime || "").getTime()
      const bMs = new Date(b?.commence_time || b?.gameTime || "").getTime()
      return aMs - bMs
    })

  if (!allEvents.length) return []

  const slateDateKey = toDetroitDateKey(Date.now())
  return allEvents.filter(
    (event) => toDetroitDateKey(event?.commence_time || event?.gameTime) === slateDateKey
  )
}

function filterRowsToPrimarySlate(rows = []) {
  const upcoming = [...rows]
    .filter((row) => new Date(row.gameTime).getTime() > Date.now())
    .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())

  if (!upcoming.length) return []

  const primaryDateKey = getPrimarySlateDateKeyFromRows(upcoming)

  return upcoming.filter(
    (row) => getLocalSlateDateKey(row.gameTime) === primaryDateKey
  )
}



function getAvailablePrimarySlateRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const isBestPropsVisibilityPass = safeRows === oddsSnapshot.bestProps
  const scheduledEvents = Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : []
  const scheduledEventIdSet = new Set(
    scheduledEvents
      .map((event) => String(event?.eventId || event?.id || ""))
      .filter(Boolean)
  )
  const rawPropsRows = (Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length)
    ? oddsSnapshot.rawProps
    : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])
  const primarySlateInputRows = isBestPropsVisibilityPass
    ? (Array.isArray(rawPropsRows) ? rawPropsRows : [])
    : safeRows

  const primarySlateRows = primarySlateInputRows.filter((row) => {
    if (!row || !row.eventId || !row.matchup) return false
    if (scheduledEventIdSet.size === 0) return true
    return scheduledEventIdSet.has(String(row.eventId))
  })

  const inputGames = [...new Set(primarySlateInputRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const outputGames = [...new Set(primarySlateRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const scheduledGames = scheduledEvents.map((event) => String(event?.matchup || getEventMatchupForDebug(event) || "")).filter(Boolean)
  const propsCoveredGames = [...new Set(primarySlateRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const missingFromPropsGames = scheduledGames.filter((matchup) => !propsCoveredGames.includes(matchup))
  console.log("[PRIMARY-SLATE-FILTER-DEBUG]", {
    nowIso: new Date().toISOString(),
    inputRowCount: primarySlateInputRows.length,
    outputRowCount: primarySlateRows.length,
    inputGameCount: inputGames.length,
    outputGameCount: outputGames.length,
    scheduledGameCount: scheduledGames.length,
    propsCoveredGameCount: propsCoveredGames.length,
    missingFromPropsGameCount: missingFromPropsGames.length,
    inputGames,
    outputGames
  })
  const scheduledMatchups = scheduledEvents.map((e) => e.matchup)
  const propsMatchups = Array.from(new Set(primarySlateRows.map((r) => r.matchup)))

  const missingMatchups = scheduledMatchups.filter((m) => !propsMatchups.includes(m))

  console.log("[SLATE-COVERAGE-CHECK]", {
    scheduledGameCount: scheduledEvents.length,
    propsCoveredGameCount: propsMatchups.length,
    missingFromPropsGameCount: missingMatchups.length,
    missingMatchups
  })

  if (isBestPropsVisibilityPass) {
    console.log("[BEST-PROPS-VISIBILITY-FILTER-DEBUG]", {
      beforeTotal: primarySlateInputRows.length,
      afterTotal: primarySlateRows.length,
      beforeByBook: {
        FanDuel: primarySlateInputRows.filter((row) => String(row?.book || "") === "FanDuel").length,
        DraftKings: primarySlateInputRows.filter((row) => String(row?.book || "") === "DraftKings").length
      },
      afterByBook: {
        FanDuel: primarySlateRows.filter((row) => String(row?.book || "") === "FanDuel").length,
        DraftKings: primarySlateRows.filter((row) => String(row?.book || "") === "DraftKings").length
      }
    })
  }

  return primarySlateRows
}

function summarizePropPipelineRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : []

  const byPlayer = safeRows.reduce((acc, row) => {
    const key = String(row?.player || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const byPropType = safeRows.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const byBook = safeRows.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const byMatchup = safeRows.reduce((acc, row) => {
    const matchup = String(
      row?.matchup || `${row?.awayTeam || ""} @ ${row?.homeTeam || ""}`.trim() || "Unknown"
    )
    acc[matchup] = (acc[matchup] || 0) + 1
    return acc
  }, {})

  const topMatchups = Object.entries(byMatchup)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([matchup, count]) => ({ matchup, count }))

  const topPlayers = Object.entries(byPlayer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([player, count]) => ({ player, count }))

  return {
    totalCount: safeRows.length,
    distinctPlayerCount: Object.keys(byPlayer).length,
    distinctMatchupCount: Object.keys(byMatchup).length,
    byPropType,
    byBook,
    topMatchups,
    topPlayers
  }
}

function logPropPipelineStep(pathLabel, stepLabel, rows = []) {
  console.log("[PROP-PIPELINE-DEBUG]", {
    path: pathLabel,
    step: stepLabel,
    ...summarizePropPipelineRows(rows)
  })
}

function logFunnelDropSummary(pathLabel, stages) {
  const ORDERED_STAGES = [
    "rawNormalized",
    "afterPregameStatus",
    "afterPrimarySlate",
    "afterDedupe",
    "afterScoringRanking",
    "afterPlayableProps",
    "afterStrongProps",
    "afterEliteProps",
    "afterBestProps"
  ]
  let maxDrop = 0
  let maxDropStage = "none"
  let maxDropFrom = 0
  let maxDropTo = 0
  for (let i = 1; i < ORDERED_STAGES.length; i++) {
    const prev = stages[ORDERED_STAGES[i - 1]]?.totalCount ?? 0
    const curr = stages[ORDERED_STAGES[i]]?.totalCount ?? 0
    const drop = prev - curr
    if (drop > maxDrop) {
      maxDrop = drop
      maxDropStage = ORDERED_STAGES[i]
      maxDropFrom = prev
      maxDropTo = curr
    }
  }
  console.log(
    `[PROP-PIPELINE-DROP] path=${pathLabel} biggestDrop=${maxDropStage}` +
    ` from=${maxDropFrom} to=${maxDropTo} dropped=${maxDrop}`
  )
}

function logPayloadDebugExclusions(label, inputRows, returnedRows) {
  const safeInput = Array.isArray(inputRows) ? inputRows : []
  const safeReturned = Array.isArray(returnedRows) ? returnedRows : []
  const returnedSet = new Set(
    safeReturned.map((r) =>
      `${r.player}|${r.propType}|${r.book}|${r.matchup}|${r.gameTime}|${r.line}|${r.side}`
    )
  )
  const todayKey = getLocalSlateDateKey(new Date().toISOString())
  const excluded = safeInput.filter((r) => {
    const key = `${r.player}|${r.propType}|${r.book}|${r.matchup}|${r.gameTime}|${r.line}|${r.side}`
    return !returnedSet.has(key)
  })
  const sample = excluded.slice(0, 25).map((row) => {
    let reason = "unknown"
    if (shouldRemoveLegForPlayerStatus(row)) {
      reason = "unavailable / removed"
    } else {
      const gameMs = new Date(row?.gameTime).getTime()
      if (!Number.isFinite(gameMs)) {
        reason = "invalid game time"
      } else if (hasGameStarted(row?.gameTime) && getLocalSlateDateKey(row?.gameTime) !== todayKey) {
        reason = "not primary slate"
      } else if (!isPregameEligibleRow(row)) {
        reason = "filtered by status"
      }
    }
    return {
      player: row.player,
      book: row.book,
      propType: row.propType,
      matchup: row.matchup,
      gameTime: row.gameTime,
      playerStatus: row.playerStatus,
      reason
    }
  })
  console.log(`[PAYLOAD-DEBUG] ${label}: inputCount=${safeInput.length} returnedCount=${safeReturned.length} excludedCount=${excluded.length}`)
  if (sample.length > 0) {
    console.log(`[PAYLOAD-DEBUG] ${label}: first ${sample.length} excluded rows:`, sample)
  }
}

function logTopPropSample(label, rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const sample = safeRows.slice(0, 12).map((row) => ({
    player: row.player,
    book: row.book,
    propType: row.propType,
    matchup: row.matchup,
    line: row.line,
    hitRate: row.hitRate,
    score: row.score,
    team: row.team
  }))
  console.log(`[TOP-PROP-SAMPLE] ${label}: total=${safeRows.length} sample=`, sample)
}

function logFunnelStage(pathLabel, stageName, inputRows, outputRows, opts = {}) {
  const safeIn = Array.isArray(inputRows) ? inputRows : []
  const safeOut = Array.isArray(outputRows) ? outputRows : []
  const distinctPlayers = (rows) => new Set(rows.map((r) => r.player)).size
  const distinctMatchups = (rows) => new Set(rows.map((r) => r.matchup || (r.awayTeam || "") + "@" + (r.homeTeam || ""))).size
  console.log("[FUNNEL-STAGE-DEBUG]", {
    path: pathLabel,
    stage: stageName,
    inputCount: safeIn.length,
    outputCount: safeOut.length,
    dropped: safeIn.length - safeOut.length,
    distinctPlayersIn: distinctPlayers(safeIn),
    distinctPlayersOut: distinctPlayers(safeOut),
    distinctMatchupsIn: distinctMatchups(safeIn),
    distinctMatchupsOut: distinctMatchups(safeOut),
    ...opts
  })
}

function logFunnelExcluded(pathLabel, stageName, inputRows, outputRows) {
  const safeIn = Array.isArray(inputRows) ? inputRows : []
  const safeOut = Array.isArray(outputRows) ? outputRows : []
  const outKeys = new Set(safeOut.map((r) => r.player + "|" + r.propType + "|" + r.book + "|" + r.matchup + "|" + String(r.line) + "|" + r.side))
  const excluded = safeIn.filter((r) => !outKeys.has(r.player + "|" + r.propType + "|" + r.book + "|" + r.matchup + "|" + String(r.line) + "|" + r.side))
  if (!excluded.length) return
  const sample = excluded.slice(0, 25).map((row) => ({
    player: row.player,
    book: row.book,
    propType: row.propType,
    matchup: row.matchup,
    score: row.score,
    hitRate: row.hitRate,
    edge: row.edge,
    team: row.team,
    reason: "not-selected-by-stage"
  }))
  console.log("[FUNNEL-EXCLUDED-DEBUG]", { path: pathLabel, stage: stageName, excludedCount: excluded.length, sample })
}

function summarizeBestPropsCapPool(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const byPropType = safeRows.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const byBook = safeRows.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const uniquePlayers = new Set(safeRows.map((row) => String(row?.player || "")).filter(Boolean)).size
  const uniqueMatchups = new Set(
    safeRows
      .map((row) => String(row?.matchup || `${row?.awayTeam || ""}@${row?.homeTeam || ""}`))
      .filter(Boolean)
  ).size

  return {
    preCapBestPropsCount: safeRows.length,
    uniquePlayers,
    uniqueMatchups,
    byPropType,
    byBook,
    preCapExceeds60: safeRows.length > 60
  }
}

function logBestPropsCapDebug(pathLabel, phase, preCapRows, postCapRows, capDiagnostics = null) {
  const summary = summarizeBestPropsCapPool(preCapRows)
  const safePost = Array.isArray(postCapRows) ? postCapRows : []
  const postSummary = summarizeBestPropsCapPool(safePost)
  console.log(`[BEST-PROPS-CAP-DEBUG] ${phase}`, {
    path: pathLabel,
    bestPropsSourceCountBeforeCap: summary.preCapBestPropsCount,
    finalBestPropsCountAfterCap: safePost.length,
    preCapBestPropsCount: summary.preCapBestPropsCount,
    postCapBestPropsCount: safePost.length,
    uniquePlayers: summary.uniquePlayers,
    uniqueMatchups: summary.uniqueMatchups,
    byPropType: summary.byPropType,
    byBook: summary.byBook,
    preCapExceeds60: summary.preCapExceeds60,
    beforeCapByBook: summary.byBook,
    afterCapByBook: postSummary.byBook,
    beforeCapByStat: summary.byPropType,
    afterCapByStat: postSummary.byPropType,
    droppedByConstraint: capDiagnostics?.dropCounts || null,
    capConfig: capDiagnostics?.config || null
  })
}

function logBestPropsCapExcluded(pathLabel, preCapRows, postCapRows, capDiagnostics = null) {
  const safePre = Array.isArray(preCapRows) ? preCapRows : []
  const safePost = Array.isArray(postCapRows) ? postCapRows : []
  const keyOf = (row) => `${row?.player || ""}|${row?.book || ""}|${row?.propType || ""}|${row?.matchup || ""}|${Number(row?.line)}|${row?.side || ""}`
  const keptKeys = new Set(safePost.map((row) => keyOf(row)))
  const excludedByCap = safePre.filter((row) => !keptKeys.has(keyOf(row))).slice(0, 20).map((row) => ({
    player: row.player,
    book: row.book,
    propType: row.propType,
    matchup: row.matchup,
    score: row.score,
    edge: row.edge,
    hitRate: row.hitRate,
    capDropReason: capDiagnostics?.dropReasonByKey?.[keyOf(row)] || "unknown"
  }))
  console.log("[BEST-PROPS-CAP-EXCLUDED]", {
    path: pathLabel,
    excludedCount: Math.max(0, safePre.length - safePost.length),
    sample: excludedByCap
  })
}

function isLooseResolvedMatch(requestedName, matchedName) {
  const requestedStrict = normalizePlayerName(requestedName)
  const matchedStrict = normalizePlayerName(matchedName)
  if (!requestedStrict || !matchedStrict) return false
  if (requestedStrict === matchedStrict) return false

  const requestedLoose = normalizePlayerNameLoose(requestedName)
  const matchedLoose = normalizePlayerNameLoose(matchedName)
  return Boolean(requestedLoose && requestedLoose === matchedLoose)
}

function logPlayerResolutionDiagnostics(pathLabel, diagnostics) {
  console.log("[PLAYER-COVERAGE-DEBUG]", {
    path: pathLabel,
    step: "player-resolution-summary",
    totalRawPlayerNamesSeen: diagnostics.totalRawPlayerNamesSeen,
    totalPlayerNamesWithResolvedIds: diagnostics.totalPlayerNamesWithResolvedIds,
    totalUnresolvedPlayerNames: diagnostics.totalUnresolvedPlayerNames,
    sampleUnresolvedPlayerNames: diagnostics.sampleUnresolvedPlayerNames,
    manualOverrideHitCount: diagnostics.manualOverrideHitCount,
    looseMatchHitCount: diagnostics.looseMatchHitCount,
    missCacheHitCount: diagnostics.missCacheHitCount
  })
}

function avg(nums) {
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}


function stddev(nums) {
  if (!nums.length) return null
  const mean = avg(nums)
  const variance = avg(nums.map((n) => (n - mean) ** 2))
  return variance === null ? null : Math.sqrt(variance)
}


function minVal(nums) {
  if (!nums.length) return null
  return Math.min(...nums)
}


function maxVal(nums) {
  if (!nums.length) return null
  return Math.max(...nums)
}


function parseHitRate(hitRate) {
  if (!hitRate || typeof hitRate !== "string") return 0
  const [hits, total] = hitRate.split("/").map(Number)
  if (!total) return 0
  return hits / total
}


function normalizePlayerName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‐-‒–—-]/g, " ")
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePlayerNameLoose(name) {
  return normalizePlayerName(name)
    .replace(/\b(da|de|del|van|von)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function buildWatchedNameSet() {
  return WATCHED_PLAYER_NAMES.map((name) => ({
    name,
    normalized: normalizePlayerName(name)
  })).filter((item) => item.normalized)
}

function extractOutcomePlayerFields(outcome = {}) {
  return [
    String(outcome?.name || ""),
    String(outcome?.description || ""),
    String(outcome?.player || ""),
    String(outcome?.player_name || ""),
    String(outcome?.participant || "")
  ]
}

function countWatchedPlayersInOutcomes(outcomes = []) {
  const watchedSet = buildWatchedNameSet()
  const counts = Object.fromEntries(watchedSet.map((item) => [item.name, 0]))

  for (const outcome of outcomes) {
    const normalizedFields = extractOutcomePlayerFields(outcome)
      .map((field) => normalizePlayerName(field))
      .filter(Boolean)

    for (const watched of watchedSet) {
      const hit = normalizedFields.some((field) => field.includes(watched.normalized))
      if (hit) counts[watched.name] = Number(counts[watched.name] || 0) + 1
    }
  }

  return counts
}

function countWatchedPlayersInRows(rows = []) {
  const watchedSet = buildWatchedNameSet()
  const counts = Object.fromEntries(watchedSet.map((item) => [item.name, 0]))

  for (const row of rows) {
    const normalizedPlayer = normalizePlayerName(row?.player)
    if (!normalizedPlayer) continue

    for (const watched of watchedSet) {
      if (normalizedPlayer.includes(watched.normalized)) {
        counts[watched.name] = Number(counts[watched.name] || 0) + 1
      }
    }
  }

  return counts
}

function aggregateWatchedCountsFromEventDebug(eventDebugRows = []) {
  const watchedSet = buildWatchedNameSet()
  const totals = Object.fromEntries(watchedSet.map((item) => [item.name, 0]))

  for (const debugRow of Array.isArray(eventDebugRows) ? eventDebugRows : []) {
    const safeCounts = debugRow?.watchedRawCounts || {}
    for (const watched of watchedSet) {
      totals[watched.name] = Number(totals[watched.name] || 0) + Number(safeCounts[watched.name] || 0)
    }
  }

  return totals
}

function buildWatchedPlayersCoverage(rawApiCounts = {}, rawPropsRows = [], bestPropsRows = []) {
  const rawPropsCounts = countWatchedPlayersInRows(rawPropsRows)
  const bestPropsCounts = countWatchedPlayersInRows(bestPropsRows)

  return WATCHED_PLAYER_NAMES.map((name) => {
    const rawApiCount = Number(rawApiCounts[name] || 0)
    const rawPropsCount = Number(rawPropsCounts[name] || 0)
    const bestPropsCount = Number(bestPropsCounts[name] || 0)

    let missingReason = "present"
    if (rawApiCount === 0) missingReason = "absent_from_raw_api"
    else if (rawApiCount > 0 && rawPropsCount === 0) missingReason = "present_in_raw_api_not_mapped"
    else if (rawPropsCount > 0 && bestPropsCount === 0) missingReason = "present_in_raw_props_not_in_best"

    return {
      player: name,
      rawPropsPresent: rawPropsCount > 0,
      rawPropsCount,
      bestPropsPresent: bestPropsCount > 0,
      bestPropsCount,
      missingReason
    }
  })
}

function getRequestedPlayerCandidateNames(name) {
  const variants = getPlayerSearchVariants(name)
  const out = new Set()

  for (const variant of variants) {
    const cleaned = String(variant || "").trim()
    if (!cleaned) continue
    out.add(cleaned)

    const withoutDots = cleaned.replace(/\./g, "").trim()
    if (withoutDots) out.add(withoutDots)
  }

  return Array.from(out)
}

function getApiPlayerCandidateNames(apiPlayer) {
  const rawCandidates = [
    apiPlayer?.name,
    apiPlayer?.fullname,
    apiPlayer?.full_name,
    apiPlayer?.display_name,
    `${apiPlayer?.firstname || ""} ${apiPlayer?.lastname || ""}`.trim(),
    `${apiPlayer?.firstName || ""} ${apiPlayer?.lastName || ""}`.trim(),
    `${apiPlayer?.first_name || ""} ${apiPlayer?.last_name || ""}`.trim()
  ]

  return rawCandidates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
}

function getApiPlayerTeamCode(apiPlayer) {
  const explicitCode = String(apiPlayer?.team?.code || "").toUpperCase().trim()
  if (explicitCode) return explicitCode

  const mappedName = teamAbbr(apiPlayer?.team?.name || apiPlayer?.team?.nickname || "")
  return String(mappedName || "").toUpperCase().trim()
}


function isReasonablePlayerMatch(requestedName, apiPlayer, expectedTeamCodes = []) {
  const requestedCandidates = getRequestedPlayerCandidateNames(requestedName)
  const apiCandidates = getApiPlayerCandidateNames(apiPlayer)

  if (!requestedCandidates.length || !apiCandidates.length) return false

  const expectedSet = new Set(
    (expectedTeamCodes || [])
      .map((code) => String(code || "").toUpperCase().trim())
      .filter(Boolean)
  )

  const apiTeamCode = getApiPlayerTeamCode(apiPlayer)
  const teamMatches = !expectedSet.size || (apiTeamCode && expectedSet.has(apiTeamCode))

  for (const requestedRaw of requestedCandidates) {
    const requested = normalizePlayerName(requestedRaw)
    const requestedLoose = normalizePlayerNameLoose(requestedRaw)

    const requestedParts = requested.split(" ").filter(Boolean)
    const requestedLooseParts = requestedLoose.split(" ").filter(Boolean)

    const requestedFirst = requestedParts[0] || ""
    const requestedLast = requestedParts[requestedParts.length - 1] || ""

    for (const candidate of apiCandidates) {
      const apiFull = normalizePlayerName(candidate)
      const apiLoose = normalizePlayerNameLoose(candidate)

      if (!apiFull) continue

      const apiParts = apiFull.split(" ").filter(Boolean)
      const apiLooseParts = apiLoose.split(" ").filter(Boolean)

      const apiFirst = apiParts[0] || ""
      const apiLast = apiParts[apiParts.length - 1] || ""

      if (requested === apiFull) return true
      if (requestedLoose && apiLoose && requestedLoose === apiLoose) return true

      // strict first + last
      if (
        requestedFirst &&
        requestedLast &&
        requestedFirst === apiFirst &&
        requestedLast === apiLast
      ) {
        return true
      }

      // strict compound-tail match like "tristan da silva"
      if (
        requestedLooseParts.length >= 3 &&
        apiLooseParts.length >= 3 &&
        requestedLooseParts[0] === apiLooseParts[0] &&
        requestedLooseParts.slice(1).join(" ") === apiLooseParts.slice(1).join(" ")
      ) {
        return true
      }

      // allow initial-based API names only if initial + exact last name line up
      // and the API player team still matches the expected slate teams when available
      const apiFirstIsInitial = /^[a-z]$/.test(apiFirst)
      if (
        apiFirstIsInitial &&
        requestedFirst &&
        requestedLast &&
        requestedFirst[0] === apiFirst &&
        requestedLast === apiLast &&
        teamMatches
      ) {
        return true
      }

      // also allow requested initial-style names like "C. Flagg" to match full names
      const requestedFirstIsInitial = /^[a-z]$/.test(requestedFirst)
      if (
        requestedFirstIsInitial &&
        apiFirst &&
        requestedLast &&
        requestedLast === apiLast &&
        apiFirst[0] === requestedFirst &&
        teamMatches
      ) {
        return true
      }
    }
  }

  return false
}


function getPlayerSearchOverride(playerName) {
  const overrides = {
    "Kelly Oubre Jr": "Kelly Oubre",
    "Shai Gilgeous-Alexander": "Shai Gilgeous Alexander",
    "Shai Gilgeous–Alexander": "Shai Gilgeous Alexander",
    "P.J. Washington": "PJ Washington",
    "R.J. Barrett": "RJ Barrett",
    "Nickeil Alexander-Walker": "Nickeil Alexander Walker",
    "Nickeil Alexander–Walker": "Nickeil Alexander Walker",
    "Herb Jones": "Herbert Jones",
    "Moe Wagner": "Moritz Wagner",
    "Dennis Schroder": "Dennis Schroder",
    "Ja'Kobe Walter": "Jakobe Walter",
    "Dean Wade": "Dean Wade",
    "Tristan da Silva": "Tristan da Silva",
    "LaMelo Ball": "LaMelo Ball",
    "Amen Thompson": "Amen Thompson",
    "Cameron Johnson": "Cameron Johnson",
    "Bruce Brown": "Bruce Brown",
    "Derrick Jones": "Derrick Jones",
    "Cody Williams": "Cody Williams",
    "Ace Bailey": "Ace Bailey",
    "Jabari Smith Jr": "Jabari Smith Jr",
    "Miles Bridges": "Miles Bridges",
    "Nique Clifford": "Nique Clifford",
    "Maxime Raynaud": "Maxime Raynaud",
    "Ryan Kalkbrenner": "Ryan Kalkbrenner",
    "Kon Knueppel": "Kon Knueppel",
    "Jeremiah Fears": "Jeremiah Fears"
  }

  return overrides[playerName] || playerName
}

function getPlayerSearchVariants(playerName) {
  const overrideName = String(getPlayerSearchOverride(playerName) || "").trim()
  const baseName = overrideName || String(playerName || "").trim()

  const ordered = []
  const seen = new Set()

  const push = (value) => {
    const cleaned = String(value || "")
      .replace(/\s+/g, " ")
      .trim()

    if (!cleaned || seen.has(cleaned)) return
    seen.add(cleaned)
    ordered.push(cleaned)
  }

  const stripped = baseName
    .replace(/[.’']/g, "")
    .replace(/\./g, "")
    .replace(/[‐-‒–—-]/g, " ")
    .replace(/\bJr\b/gi, "")
    .replace(/\bSr\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()

  const parts = stripped.split(" ").filter(Boolean)
  const first = parts[0] || stripped
  const last = parts[parts.length - 1] || stripped
  const firstLast = `${first} ${last}`.trim()
  const isCompoundLastName = /\b(da|de|del|van|von)\b/i.test(stripped)
  const isSuffixName = /\b(ii|iii|iv)\b/i.test(baseName)
  const isSpecialCase =
    /\bschroder\b/i.test(baseName) ||
    /\bschröder\b/i.test(baseName) ||
    /\bherb\b/i.test(baseName) ||
    /\bmoe\b/i.test(baseName) ||
    /[.'’]/.test(baseName)

  // For most players, go straight to the most productive search first.
  if (parts.length >= 2 && !isCompoundLastName && !isSuffixName && !isSpecialCase) {
    push(last)
    push(firstLast)
    push(stripped)
    push(baseName)
  } else {
    push(baseName)
    push(stripped)
    push(firstLast)
    push(last)
  }

  push(first)

  // Add special handling for Schroder/Schröder
  if (/schroder/i.test(baseName) || /schröder/i.test(baseName)) {
    push(baseName.replace(/Schroder/gi, "Schröder"))
    push(baseName.replace(/Schröder/gi, "Schroder"))
    push("Schroder")
    push("Schröder")
  }

  if (parts.length >= 2) {
    push(parts.slice(0, 2).join(" "))
    push(parts.slice(-2).join(" "))
  }

  if (/\bda\b/i.test(stripped)) {
    push(stripped.replace(/\bda\b/gi, "").replace(/\s+/g, " ").trim())
    push(`Da ${last}`)

    const daIndex = parts.findIndex((part) => /^da$/i.test(part))
    if (daIndex >= 0 && daIndex < parts.length - 1) {
      push(parts.slice(daIndex).join(" "))
      push(parts.slice(daIndex - 1 >= 0 ? daIndex - 1 : daIndex).join(" "))
    }
  }

  if (/\bde\b/i.test(stripped)) {
    push(stripped.replace(/\bde\b/gi, "").replace(/\s+/g, " ").trim())
  }

  if (/\bherb\b/i.test(baseName)) {
    push(baseName.replace(/\bHerb\b/i, "Herbert"))
  }

  if (/\bmoe\b/i.test(baseName)) {
    push(baseName.replace(/\bMoe\b/i, "Moritz"))
  }

  if (parts.length >= 2) {
    const firstInitial = first.replace(/[^a-z]/gi, "").charAt(0)
    if (firstInitial) {
      push(`${firstInitial} ${last}`)
      push(`${firstInitial}. ${last}`)
    }
  }

  return ordered.slice(0, 5)
}




function getTeamOverride(playerName) {
  const overrides = {
    
  }

  return overrides[playerName] || ""
}

function getManualPlayerStatus(playerName) {
  const overrides = {
    // Example:
    // "LeBron James": "questionable",
    // "Kawhi Leonard": "probable",
    // "Player Name": "minutes restriction"
  }

  return String(overrides[playerName] || "")
}

function normalizePlayerStatusValue(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isUnavailablePlayerStatus(status) {
  const normalized = normalizePlayerStatusValue(status)
  if (!normalized) return false

  return [
    "out",
    "dnp",
    "dnp coachs decision",
    "dnp coaches decision",
    "inactive",
    "suspended",
    "not with team"
  ].includes(normalized)
}


function shouldRemoveLegForPlayerStatus(row) {
  if (!row) return false
  // STEP 3: Prevent filters from removing force-included watched players
  if (row.__forceInclude) return false
  return isUnavailablePlayerStatus(row.playerStatus)
}

function hasGameStarted(gameTime) {
  const startMs = new Date(gameTime).getTime()
  if (!Number.isFinite(startMs)) return false
  return startMs <= Date.now()
}

function isPregameEligibleRow(row) {
  if (!row?.gameTime) return false
  const gameMs = new Date(row.gameTime).getTime()
  if (!Number.isFinite(gameMs)) return false
  return gameMs > Date.now()
}


function isManualOverridePlayer(playerName) {
  return Boolean(MANUAL_PLAYER_OVERRIDES[playerName])
}

function isSafeSlipAllowedPropType(propType) {
  return true
}


function teamAbbr(teamName) {
  const map = {
    "Atlanta Hawks": "ATL",
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA",
    "Chicago Bulls": "CHI",
    "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL",
    "Denver Nuggets": "DEN",
    "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW",
    "Houston Rockets": "HOU",
    "Indiana Pacers": "IND",
    "Los Angeles Clippers": "LAC",
    "Los Angeles Lakers": "LAL",
    "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA",
    "Milwaukee Bucks": "MIL",
    "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP",
    "New York Knicks": "NYK",
    "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL",
    "Philadelphia 76ers": "PHI",
    "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR",
    "Sacramento Kings": "SAC",
    "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR",
    "Utah Jazz": "UTA",
    "Washington Wizards": "WAS"
  }

  return map[teamName] || teamName
}

function getDetroitDateParts(dateString) {
  if (!dateString) return null

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return null

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  })

  const parts = formatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: Number(lookup.hour || 0)
  }
}

function getLocalSlateDateKey(dateString) {
  const parts = getDetroitDateParts(dateString)
  if (!parts) return ""

  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatDetroitLocalTimestamp(dateString) {
  if (!dateString) return ""

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ""

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(date)
}

function getPrimarySlateDateKeyFromRows(rows = []) {
  const counts = new Map()

  for (const row of rows) {
    const key = getLocalSlateDateKey(row?.gameTime)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  let bestKey = ""
  let bestCount = -1

  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      bestKey = key
      bestCount = count
    }
  }

  return bestKey
}


function getCurrentTeamCodeFromStats(stats) {
  if (!stats || !stats.length) return ""

  for (let i = stats.length - 1; i >= 0; i -= 1) {
    const code = String(stats[i]?.team?.code || "").toUpperCase().trim()
    if (code) return code
  }

  return ""
}

function resolveTeamNameForRowFromCode(teamCode, row) {
  const normalizedCode = String(teamCode || "").toUpperCase().trim()
  if (!normalizedCode) return null

  const awayCode = String(teamAbbr(row?.awayTeam) || "").toUpperCase().trim()
  const homeCode = String(teamAbbr(row?.homeTeam) || "").toUpperCase().trim()

  if (normalizedCode === awayCode) return row?.awayTeam || normalizedCode
  if (normalizedCode === homeCode) return row?.homeTeam || normalizedCode
  return normalizedCode
}

function getCachedRecentStatsForPlayer(playerName) {
  const cachedPlayerInfo = playerIdCache.get(playerName)
  if (!cachedPlayerInfo?.id || !playerStatsCache.has(cachedPlayerInfo.id)) return []
  const cachedStats = playerStatsCache.get(cachedPlayerInfo.id) || []
  return Array.isArray(cachedStats) ? cachedStats.slice(0, 10) : []
}

function resolveCanonicalPlayerTeamForRow(row) {
  const playerName = String(row?.player || "").trim()
  if (!playerName) return null

  const cachedPlayerInfo = playerIdCache.get(playerName)
  const recentStats = getCachedRecentStatsForPlayer(playerName)
  const teamCode = String(
    getTeamOverride(playerName) ||
    teamAbbr(cachedPlayerInfo?.team || "") ||
    getCurrentTeamCodeFromStats(recentStats) ||
    ""
  ).toUpperCase().trim()

  if (!teamCode) return null
  return resolveTeamNameForRowFromCode(teamCode, row)
}

function inferSpecialtyContextPropType(row) {
  const marketKey = String(row?.marketKey || "")
  const propType = String(row?.propType || "")

  if (marketKey === "player_first_basket" || marketKey === "player_first_team_basket") return "Points"
  if (marketKey === "player_double_double" || marketKey === "player_triple_double") return "PRA"
  if (/first\s*basket/i.test(propType)) return "Points"
  if (/double\s*double/i.test(propType) || /triple\s*double/i.test(propType)) return "PRA"
  return "Points"
}

function buildRealSpecialtyContextInputs(row) {
  const playerName = String(row?.player || "").trim()
  if (!playerName) return {}

  const recentStats = getCachedRecentStatsForPlayer(playerName)
  if (!recentStats.length) return {}

  const contextPropType = inferSpecialtyContextPropType(row)
  const values = recentStats
    .map((log) => propValueFromApiSportsLog(log, contextPropType))
    .filter((value) => value !== null && Number.isFinite(Number(value)))
    .map(Number)
  const mins = recentStats
    .map((log) => Number(log?.min || 0))
    .filter((value) => Number.isFinite(value) && value > 0)

  const avgMin = avg(mins)
  const recent3MinAvg = avg(mins.slice(-3))
  const minCeiling = maxVal(mins)
  const recent3Avg = avg(values.slice(-3))
  const l10Avg = avg(values)
  const minutesTrendDelta = Number.isFinite(recent3MinAvg) && Number.isFinite(avgMin)
    ? recent3MinAvg - avgMin
    : null
  const minutesBaseSignal = Number.isFinite(avgMin)
    ? clamp((avgMin - 18) / 18, 0, 1)
    : null
  const minutesTrendSignal = Number.isFinite(minutesTrendDelta)
    ? clamp((minutesTrendDelta + 1.5) / 6, 0, 1)
    : null
  const roleSignalScore = minutesBaseSignal != null || minutesTrendSignal != null
    ? Number(clamp(
        ((minutesBaseSignal != null ? minutesBaseSignal : 0) * 0.65) +
        ((minutesTrendSignal != null ? minutesTrendSignal : 0) * 0.35),
        0,
        1
      ).toFixed(3))
    : null

  const output = {}
  if (Number.isFinite(avgMin)) output.avgMin = Number(avgMin.toFixed(1))
  if (Number.isFinite(recent3MinAvg)) output.recent3MinAvg = Number(recent3MinAvg.toFixed(1))
  if (Number.isFinite(minCeiling)) output.minCeiling = Number(minCeiling.toFixed(1))
  if (Number.isFinite(recent3Avg)) output.recent3Avg = Number(recent3Avg.toFixed(1))
  if (Number.isFinite(l10Avg)) output.l10Avg = Number(l10Avg.toFixed(1))
  if (Number.isFinite(roleSignalScore)) output.roleSignalScore = roleSignalScore
  return output
}

function buildCanonicalSpecialtyPlayerTeamIndex(rows) {
  const seededIndex = buildSpecialtyPlayerTeamIndex(rows)
  const output = { ...(seededIndex || {}) }

  for (const row of Array.isArray(rows) ? rows : []) {
    const playerKey = String(row?.player || "").trim().toLowerCase()
    if (!playerKey) continue
    const canonicalTeam = resolveCanonicalPlayerTeamForRow(row)
    if (canonicalTeam) output[playerKey] = canonicalTeam
  }

  return output
}



function playerFitsMatchup(row) {
  const team = String(row.team || "").toUpperCase()
  return team === teamAbbr(row.awayTeam) || team === teamAbbr(row.homeTeam)
}

function getOpponentForRow(row) {
  const team = String(row.team || "").toUpperCase()
  const away = teamAbbr(row.awayTeam)
  const home = teamAbbr(row.homeTeam)

  if (team && team === away) return row.homeTeam
  if (team && team === home) return row.awayTeam

  return row.awayTeam || row.homeTeam || ""
}


function propValueFromApiSportsLog(log, propType) {
  switch (propType) {
    case "Points":
      return Number(log.points || 0)
    case "Rebounds":
      return Number(log.totReb || 0)
    case "Assists":
      return Number(log.assists || 0)
    case "Threes":
      return Number(log.tpm || 0)
    case "PRA":
      return Number(log.points || 0) + Number(log.totReb || 0) + Number(log.assists || 0)
    default:
      return null
  }
}


function getDvpScore(opponent, propType) {
  const dvpTable = {
    "Cleveland Cavaliers": { Assists: -1, Points: -1, Rebounds: 0, Threes: -1, PRA: -1 },
    "Philadelphia 76ers": { Assists: 1, Points: 0, Rebounds: 0, Threes: 0, PRA: 0 },
    "Phoenix Suns": { Assists: 1, Points: 1, Rebounds: -1, Threes: 1, PRA: 1 },
    "Charlotte Hornets": { Assists: 1, Points: 1, Rebounds: 1, Threes: 1, PRA: 1 },
    "Los Angeles Lakers": { Assists: 0, Points: 1, Rebounds: 1, Threes: 1, PRA: 1 },
    "New York Knicks": { Assists: -1, Points: -1, Rebounds: 0, Threes: -1, PRA: -1 },
    // DVP UPGRADE: more team entries
    "Boston Celtics": { Assists: -1, Points: -1, Rebounds: -1, Threes: -1, PRA: -1 },
    "Atlanta Hawks": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Miami Heat": { Assists: -1, Points: -1, Rebounds: 0, Threes: -1, PRA: -1 },
    "Orlando Magic": { Assists: -1, Points: -1, Rebounds: 0, Threes: -1, PRA: -1 },
    "Washington Wizards": { Assists: 1, Points: 1, Rebounds: 1, Threes: 1, PRA: 1 },
    "San Antonio Spurs": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Milwaukee Bucks": { Assists: 0, Points: 1, Rebounds: 1, Threes: 0, PRA: 1 },
    "Sacramento Kings": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Denver Nuggets": { Assists: 0, Points: 0, Rebounds: 0, Threes: 0, PRA: 0 },
    "Los Angeles Clippers": { Assists: -1, Points: -1, Rebounds: 0, Threes: -1, PRA: -1 },
    "Dallas Mavericks": { Assists: 0, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Detroit Pistons": { Assists: 0, Points: 1, Rebounds: 1, Threes: 0, PRA: 1 },
    "Houston Rockets": { Assists: -1, Points: -1, Rebounds: 1, Threes: -1, PRA: -1 },
    "Indiana Pacers": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Brooklyn Nets": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Chicago Bulls": { Assists: 0, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Golden State Warriors": { Assists: 1, Points: 0, Rebounds: -1, Threes: 1, PRA: 0 },
    "Memphis Grizzlies": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Minnesota Timberwolves": { Assists: -1, Points: -1, Rebounds: 1, Threes: -1, PRA: -1 },
    "New Orleans Pelicans": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Oklahoma City Thunder": { Assists: -1, Points: -1, Rebounds: 0, Threes: -1, PRA: -1 },
    "Portland Trail Blazers": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Toronto Raptors": { Assists: 1, Points: 1, Rebounds: 0, Threes: 1, PRA: 1 },
    "Utah Jazz": { Assists: 1, Points: 1, Rebounds: 1, Threes: 1, PRA: 1 }
    // "Los Angeles Lakers" already exists, do not duplicate
  }

  const teamRow = dvpTable[opponent]
  if (!teamRow) return 0
  return teamRow[propType] || 0
}


function getVolatilityPenalty(row) {
  let penalty = 0

  const edge = Number(row.edge || 0)
  const hit = parseHitRate(row.hitRate)
  const odds = Number(row.odds || 0)
  const prop = row.propType
  const side = row.side

  if (side === "Over" && edge < 2) penalty += 6
  if (side === "Over" && hit < 0.7) penalty += 6

  if (prop === "Points" && row.avgMin >= 30 && edge < 2.5) penalty += 4

  if (odds < -170) penalty += 8
  else if (odds < -150) penalty += 4

  if (row.avgMin < 28) penalty += 4

  if (edge < 1) penalty += 8
  else if (edge < 1.5) penalty += 4

  return penalty
}

function getPracticalSafetyBonus(row) {
  let bonus = 0

  const edge = Number(row.edge || 0)
  const hit = parseHitRate(row.hitRate)
  const odds = Number(row.odds || 0)

  if (hit >= 0.8) bonus += 8
  else if (hit >= 0.7) bonus += 4

  if (edge >= 3) bonus += 8
  else if (edge >= 2) bonus += 4

  if (odds >= -140 && odds <= 110) bonus += 4

  if (row.propType === "Rebounds" || row.propType === "Assists") bonus += 2

  return bonus
}

function getMarketEdgeBonus(row) {
  const odds = Number(row.odds || 0)
  const edge = Number(row.edge || 0)
  const hitRate = parseHitRate(row.hitRate)

  let bonus = 0

  if (edge >= 4) bonus += 10
  else if (edge >= 3) bonus += 7
  else if (edge >= 2) bonus += 4
  else if (edge >= 1.5) bonus += 2

  if (hitRate >= 0.8 && odds >= -150 && odds <= 125) bonus += 4
  else if (hitRate >= 0.7 && odds >= -165 && odds <= 140) bonus += 2

  if (odds > 0 && edge >= 2) bonus += 2

  return bonus
}

function getSharpSteamBonus(row) {
  const side = String(row.side || "")
  const lineMove = Number(row.lineMove || 0)
  const oddsMove = Number(row.oddsMove || 0)
  const edge = Number(row.edge || 0)
  const hitRate = parseHitRate(row.hitRate)

  let bonus = 0

  // Sharp steam = the market moving in the same direction as the bet.
  if (side === "Over") {
    if (lineMove >= 1) bonus += 10
    else if (lineMove >= 0.5) bonus += 6

    if (oddsMove <= -20) bonus += 5
    else if (oddsMove <= -10) bonus += 3

    if (lineMove <= -1) bonus -= 8
    else if (lineMove <= -1) bonus -= 4
  }

  if (side === "Under") {
    if (lineMove <= -1) bonus += 10
    else if (lineMove <= -1) bonus += 6

    if (oddsMove <= -20) bonus += 5
    else if (oddsMove <= -10) bonus += 3

    if (lineMove >= 1) bonus -= 8
    else if (lineMove >= 0.5) bonus -= 4
  }

  // Only trust steam more when there is some actual support already.
  if (edge < 1) bonus -= 3
  if (hitRate < 0.6) bonus -= 3

  return bonus
}

// --- Edge profile helpers (additive, non-scoring) ---

const clamp01 = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  if (num <= 0) return 0
  if (num >= 1) return 1
  return num
}

const normalizeOddsForValueScore = (odds) => {
  const num = Number(odds)
  if (!Number.isFinite(num)) return 0
  if (num >= 0) {
    return clamp01((num - 100) / 900)
  }
  return clamp01((Math.abs(num) - 100) / 900)
}

const inferGameEnvironmentScore = (row) => {
  const hitRate = Number(row?.hitRate || 0)
  const edge = Number(row?.edge || 0)
  const propType = String(row?.propType || "")
  const odds = Number(row?.odds || 0)

  let score = 0.35
  score += clamp01(hitRate) * 0.25
  score += clamp01(edge / 20) * 0.20

  if (["Points", "PRA", "Assists", "Threes", "Points Ladder", "PRA Ladder", "Assists Ladder", "Threes Ladder"].includes(propType)) {
    score += 0.10
  }

  if (Number.isFinite(odds) && odds > 0) {
    score += 0.05
  }

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const inferMatchupEdgeScore = (row) => {
  const edge = Number(row?.edge || 0)
  const hitRate = Number(row?.hitRate || 0)
  const propType = String(row?.propType || "")
  const propVariant = String(row?.propVariant || "base")

  let score = 0.20
  score += clamp01(edge / 25) * 0.45
  score += clamp01(hitRate) * 0.20

  if (propVariant.includes("alt")) score += 0.05
  if (["First Basket", "First Team Basket", "Double Double", "Triple Double"].includes(propType)) score += 0.05

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const inferBookValueScore = (row) => {
  const odds = Number(row?.odds || 0)
  const propVariant = String(row?.propVariant || "base")
  const marketKey = String(row?.marketKey || "")
  const edge = Number(row?.edge || 0)

  let score = 0.15
  score += normalizeOddsForValueScore(odds) * 0.35
  score += clamp01(edge / 20) * 0.20

  if (propVariant.includes("alt")) score += 0.10
  if (marketKey.includes("first_basket")) score += 0.10
  if (marketKey.includes("double_double") || marketKey.includes("triple_double")) score += 0.10

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const inferVolatilityScore = (row) => {
  const odds = Number(row?.odds || 0)
  const propType = String(row?.propType || "")
  const propVariant = String(row?.propVariant || "base")
  const marketKey = String(row?.marketKey || "")

  let score = 0.15

  if (Number.isFinite(odds) && odds > 0) score += clamp01(odds / 1000) * 0.35
  if (propVariant.includes("alt")) score += 0.20
  if (marketKey.includes("first_basket") || marketKey.includes("first_team_basket")) score += 0.25
  if (marketKey.includes("triple_double")) score += 0.20
  if (["First Basket", "First Team Basket", "Triple Double"].includes(propType)) score += 0.15

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const inferBetTypeFit = (row, profile) => {
  const propType = String(row?.propType || "")
  const propVariant = String(row?.propVariant || "base")
  const marketKey = String(row?.marketKey || "")
  const hitRate = Number(row?.hitRate || 0)
  const odds = Number(row?.odds || 0)

  if (marketKey.includes("first_basket") || marketKey.includes("first_team_basket")) return "special"
  if (marketKey.includes("double_double") || marketKey.includes("triple_double")) return "special"

  if (propVariant.includes("alt-max") || propVariant.includes("alt-high")) return "ladder"
  if (profile.volatilityScore >= 0.75 && Number.isFinite(odds) && odds >= 300) return "lotto"
  if (hitRate >= 0.66 && profile.matchupEdgeScore >= 0.45) return "anchor"
  if (profile.bookValueScore >= 0.55) return "value"

  return "playable"
}

const buildWhyItRates = (row, profile) => {
  const reasons = []
  const hitRate = Number(row?.hitRate || 0)
  const edge = Number(row?.edge || 0)
  const odds = Number(row?.odds || 0)
  const propVariant = String(row?.propVariant || "base")
  const marketKey = String(row?.marketKey || "")

  if (hitRate >= 0.65) reasons.push("high-hit-rate")
  if (edge >= 8) reasons.push("positive-edge")
  if (profile.matchupEdgeScore >= 0.55) reasons.push("matchup-edge")
  if (profile.gameEnvironmentScore >= 0.60) reasons.push("good-game-environment")
  if (profile.bookValueScore >= 0.55) reasons.push("book-value")
  if (propVariant.includes("alt")) reasons.push("alt-line-upside")
  if (marketKey.includes("first_basket") || marketKey.includes("first_team_basket")) reasons.push("special-market-upside")
  if (Number.isFinite(odds) && odds >= 300) reasons.push("high-payout-volatility")

  return reasons
}

// --- End edge profile helpers ---

// --- Market-siloed board predicates ---

const isFirstBasketLikeRow = (row) => {
  const marketKey = String(row?.marketKey || "")
  const propType = String(row?.propType || "")
  return (
    marketKey === "player_first_basket" ||
    marketKey === "player_first_team_basket" ||
    propType === "First Basket" ||
    propType === "First Team Basket"
  )
}

const isCorePropRow = (row) => {
  const propType = String(row?.propType || "")
  return new Set([
    "Points",
    "Rebounds",
    "Assists",
    "Threes",
    "PRA"
  ]).has(propType)
}

const isLadderRow = (row) => {
  const propVariant = String(row?.propVariant || "")
  const propType = String(row?.propType || "")
  return (
    propVariant.includes("alt") ||
    propType.includes("Ladder")
  )
}

const isSpecialButNotFirstBasketRow = (row) => {
  const propType = String(row?.propType || "")
  const marketKey = String(row?.marketKey || "")
  if (isFirstBasketLikeRow(row)) return false
  return (
    marketKey === "player_double_double" ||
    marketKey === "player_triple_double" ||
    propType === "Double Double" ||
    propType === "Triple Double"
  )
}

const isLottoStyleRow = (row) => {
  const odds = Number(row?.odds || 0)
  const betTypeFit = String(row?.betTypeFit || "")
  return betTypeFit === "lotto" || odds >= 300
}

// --- Market-siloed board ranking helpers ---

const sortFirstBasketBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.bookValueScore || 0) * 0.35) +
      (Number(a?.matchupEdgeScore || 0) * 0.20) +
      (Number(a?.gameEnvironmentScore || 0) * 0.15) +
      (Number(a?.volatilityScore || 0) * 0.20) +
      ((Number(a?.odds || 0) >= 250 && Number(a?.odds || 0) <= 2500) ? 0.10 : 0)

    const bScore =
      (Number(b?.bookValueScore || 0) * 0.35) +
      (Number(b?.matchupEdgeScore || 0) * 0.20) +
      (Number(b?.gameEnvironmentScore || 0) * 0.15) +
      (Number(b?.volatilityScore || 0) * 0.20) +
      ((Number(b?.odds || 0) >= 250 && Number(b?.odds || 0) <= 2500) ? 0.10 : 0)

    return bScore - aScore
  })
}

const sortCorePropsBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.score || 0) * 0.45) +
      (Number(a?.matchupEdgeScore || 0) * 0.20) +
      (Number(a?.gameEnvironmentScore || 0) * 0.15) +
      (Number(a?.bookValueScore || 0) * 0.10) -
      (Number(a?.volatilityScore || 0) * 0.10)

    const bScore =
      (Number(b?.score || 0) * 0.45) +
      (Number(b?.matchupEdgeScore || 0) * 0.20) +
      (Number(b?.gameEnvironmentScore || 0) * 0.15) +
      (Number(b?.bookValueScore || 0) * 0.10) -
      (Number(b?.volatilityScore || 0) * 0.10)

    return bScore - aScore
  })
}

const sortLadderBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.bookValueScore || 0) * 0.25) +
      (Number(a?.volatilityScore || 0) * 0.25) +
      (Number(a?.matchupEdgeScore || 0) * 0.20) +
      (Number(a?.score || 0) * 0.20) +
      (String(a?.betTypeFit || "") === "ladder" ? 0.10 : 0)

    const bScore =
      (Number(b?.bookValueScore || 0) * 0.25) +
      (Number(b?.volatilityScore || 0) * 0.25) +
      (Number(b?.matchupEdgeScore || 0) * 0.20) +
      (Number(b?.score || 0) * 0.20) +
      (String(b?.betTypeFit || "") === "ladder" ? 0.10 : 0)

    return bScore - aScore
  })
}

const sortSpecialBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.bookValueScore || 0) * 0.30) +
      (Number(a?.volatilityScore || 0) * 0.20) +
      (Number(a?.matchupEdgeScore || 0) * 0.15) +
      (Number(a?.score || 0) * 0.15) +
      (String(a?.betTypeFit || "") === "special" ? 0.20 : 0)

    const bScore =
      (Number(b?.bookValueScore || 0) * 0.30) +
      (Number(b?.volatilityScore || 0) * 0.20) +
      (Number(b?.matchupEdgeScore || 0) * 0.15) +
      (Number(b?.score || 0) * 0.15) +
      (String(b?.betTypeFit || "") === "special" ? 0.20 : 0)

    return bScore - aScore
  })
}

const sortLottoBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.volatilityScore || 0) * 0.35) +
      (Number(a?.bookValueScore || 0) * 0.20) +
      (Number(a?.matchupEdgeScore || 0) * 0.15) +
      ((Number(a?.odds || 0) >= 300) ? 0.20 : 0) +
      (String(a?.betTypeFit || "") === "lotto" ? 0.10 : 0)

    const bScore =
      (Number(b?.volatilityScore || 0) * 0.35) +
      (Number(b?.bookValueScore || 0) * 0.20) +
      (Number(b?.matchupEdgeScore || 0) * 0.15) +
      ((Number(b?.odds || 0) >= 300) ? 0.20 : 0) +
      (String(b?.betTypeFit || "") === "lotto" ? 0.10 : 0)

    return bScore - aScore
  })
}

// --- End market-siloed board helpers ---

// --- Prediction layer helpers ---

const inferGamePriorityScore = (row) => {
  const gameEnvironmentScore = Number(row?.gameEnvironmentScore || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
  const volatilityScore = Number(row?.volatilityScore || 0)
  const propType = String(row?.propType || "")
  const marketKey = String(row?.marketKey || "")

  let score = 0.25
  score += gameEnvironmentScore * 0.40
  score += matchupEdgeScore * 0.25
  score += volatilityScore * 0.10

  if (["Points", "PRA", "Assists", "Threes"].includes(propType)) score += 0.10
  if (marketKey === "player_first_basket" || marketKey === "player_first_team_basket") score += 0.10

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const inferPlayerConfidenceScore = (row) => {
  const score = Number(row?.score || 0)
  const hitRateRaw = row?.hitRate
  const hitRate =
    typeof hitRateRaw === "string" && hitRateRaw.includes("/")
      ? (() => {
          const [a, b] = hitRateRaw.split("/").map(Number)
          return b ? a / b : 0
        })()
      : Number(hitRateRaw || 0)

  const gameEnvironmentScore = Number(row?.gameEnvironmentScore || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const volatilityScore = Number(row?.volatilityScore || 0)

  let normalizedModelScore = 0
  if (Number.isFinite(score)) normalizedModelScore = Math.min(1, Math.max(0, score / 250))

  let confidence = 0.10
  confidence += normalizedModelScore * 0.30
  confidence += Math.min(1, Math.max(0, hitRate)) * 0.25
  confidence += matchupEdgeScore * 0.15
  confidence += gameEnvironmentScore * 0.10
  confidence += bookValueScore * 0.10
  confidence -= volatilityScore * 0.08

  return Number(Math.min(1, Math.max(0, confidence)).toFixed(3))
}

const inferConfidenceTier = (row) => {
  const confidence = Number(row?.playerConfidenceScore || 0)
  const betTypeFit = String(row?.betTypeFit || "")
  const marketKey = String(row?.marketKey || "")

  if (marketKey === "player_first_basket" || marketKey === "player_first_team_basket") {
    if (confidence >= 0.70) return "special-elite"
    if (confidence >= 0.55) return "special-strong"
    if (confidence >= 0.42) return "special-playable"
    return "special-thin"
  }

  if (betTypeFit === "lotto") {
    if (confidence >= 0.52) return "lotto-strong"
    return "lotto-playable"
  }

  if (confidence >= 0.72) return "elite"
  if (confidence >= 0.60) return "strong"
  if (confidence >= 0.48) return "playable"
  return "thin"
}

const enrichPredictionLayer = (row) => {
  const gamePriorityScore = inferGamePriorityScore(row)
  const playerConfidenceScore = inferPlayerConfidenceScore({
    ...row,
    gameEnvironmentScore: row?.gameEnvironmentScore,
    matchupEdgeScore: row?.matchupEdgeScore,
    bookValueScore: row?.bookValueScore,
    volatilityScore: row?.volatilityScore
  })

  const predictionRow = {
    ...row,
    gamePriorityScore,
    playerConfidenceScore
  }

  return {
    ...predictionRow,
    confidenceTier: inferConfidenceTier(predictionRow)
  }
}

const buildSpecialMarketEvidence = (row) => {
  const odds = Number(row?.odds || 0)
  const player = String(row?.player || "")
  const propType = String(row?.propType || "")

  const impliedProb = odds > 0
    ? 100 / (odds + 100)
    : Math.abs(odds) / (Math.abs(odds) + 100)

  return {
    impliedProbability: Number(impliedProb.toFixed(3)),
    isLongshot: odds > 700,
    isReasonable: odds > 200 && odds <= 700,
    isFavorite: odds < 200,
    player,
    propType
  }
}

const buildSpecialWhyItRates = (row, evidence) => {
  const reasons = []

  if (evidence.isFavorite) reasons.push("high-implied-probability")
  if (evidence.isReasonable) reasons.push("balanced-upside")
  if (!evidence.isLongshot) reasons.push("not-extreme-longshot")

  if (row?.team) reasons.push("team-context-valid")
  if (row?.matchup) reasons.push("game-context-valid")

  return reasons
}

const scoreSpecialMarketConfidence = (row, evidence) => {
  let score = 0.25

  // IMPLIED PROBABILITY (MAIN DRIVER)
  score += evidence.impliedProbability * 0.6

  // ODDS PENALTY / BOOST
  if (evidence.isLongshot) score -= 0.15
  if (evidence.isReasonable) score += 0.08
  if (evidence.isFavorite) score += 0.12

  // STABILITY SIGNALS
  if (row?.team) score += 0.05
  if (row?.matchup) score += 0.05

  return Math.max(0, Math.min(1, Number(score.toFixed(3))))
}

const getSpecialOddsBand = (odds) => {
  const num = Number(odds || 0)
  if (!Number.isFinite(num)) return "unknown"
  if (num <= 180) return "favored"
  if (num <= 450) return "balanced"
  if (num <= 900) return "longshot"
  return "extreme-longshot"
}

const inferSpecialMarketSubtype = (row) => {
  const marketKey = String(row?.marketKey || "")
  const propType = String(row?.propType || "")

  if (marketKey === "player_first_basket" || propType === "First Basket") return "first-basket"
  if (marketKey === "player_first_team_basket" || propType === "First Team Basket") return "first-team-basket"
  if (marketKey === "player_double_double" || propType === "Double Double") return "double-double"
  if (marketKey === "player_triple_double" || propType === "Triple Double") return "triple-double"
  return "special"
}

const buildSpecialContextEvidence = (row) => {
  const subtype = inferSpecialMarketSubtype(row)
  const odds = Number(row?.odds || 0)
  const oddsBand = getSpecialOddsBand(odds)
  const impliedProb =
    Number.isFinite(odds) && odds !== 0
      ? (odds > 0
          ? 100 / (odds + 100)
          : Math.abs(odds) / (Math.abs(odds) + 100))
      : 0

  const volatilityScore = Number(row?.volatilityScore || 0)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const gamePriorityScore = Number(row?.gamePriorityScore || 0)
  const playerConfidenceScore = Number(row?.playerConfidenceScore || 0)

  const marketContextLabel =
    subtype === "first-basket"
      ? "first-score volatility market"
      : subtype === "first-team-basket"
        ? "team-first-score market"
        : subtype === "double-double"
          ? "multi-stat accumulation market"
          : subtype === "triple-double"
            ? "high-volatility multi-stat market"
            : "special market"

  const oddsBandLabel =
    oddsBand === "favored"
      ? "favored special price"
      : oddsBand === "balanced"
        ? "balanced special price"
        : oddsBand === "longshot"
          ? "longshot special price"
          : oddsBand === "extreme-longshot"
            ? "extreme longshot price"
            : null

  const volatilityLabel =
    volatilityScore >= 0.75
      ? "very high volatility"
      : volatilityScore >= 0.5
        ? "high volatility"
        : volatilityScore >= 0.3
          ? "moderate volatility"
          : "controlled volatility"

  return {
    subtype,
    impliedProbability: Number(impliedProb.toFixed(3)),
    oddsBand,
    oddsBandLabel,
    marketContextLabel,
    volatilityLabel,
    bookValueLabel: bookValueScore >= 0.55 ? "strong special value" : bookValueScore >= 0.35 ? "reasonable special value" : null,
    gameContextLabel: gamePriorityScore >= 0.55 ? "strong game context" : gamePriorityScore >= 0.4 ? "good game context" : null,
    confidenceLabel: playerConfidenceScore >= 0.7 ? "high model confidence" : playerConfidenceScore >= 0.55 ? "solid model confidence" : playerConfidenceScore >= 0.42 ? "playable model confidence" : "thin model confidence"
  }
}

const buildSpecialContextWhyItRates = (row, contextEvidence) => {
  const reasons = []
  const subtype = String(contextEvidence?.subtype || "")
  const oddsBand = String(contextEvidence?.oddsBand || "")
  const impliedProbability = Number(contextEvidence?.impliedProbability || 0)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const gamePriorityScore = Number(row?.gamePriorityScore || 0)
  const playerConfidenceScore = Number(row?.playerConfidenceScore || 0)

  if (subtype === "first-team-basket") reasons.push("team-first-score-market")
  if (subtype === "first-basket") reasons.push("first-score-market")
  if (subtype === "double-double") reasons.push("multi-stat-role")
  if (subtype === "triple-double") reasons.push("high-end-multi-stat-path")

  if (oddsBand === "favored") reasons.push("high-implied-probability")
  if (oddsBand === "balanced") reasons.push("balanced-upside")
  if (oddsBand === "longshot") reasons.push("longshot-upside")
  if (oddsBand === "extreme-longshot") reasons.push("extreme-longshot")

  if (impliedProbability >= 0.20) reasons.push("meaningful-implied-probability")
  if (bookValueScore >= 0.35) reasons.push("book-value")
  if (gamePriorityScore >= 0.4) reasons.push("game-context-valid")
  if (playerConfidenceScore >= 0.42) reasons.push("model-confidence-valid")

  return [...new Set(reasons)]
}

const buildSpecialContextSummary = (row, contextEvidence, whyItRates) => {
  const player = String(row?.player || "This play")
  const propType = String(row?.propType || "special")
  const pieces = []

  if (contextEvidence?.oddsBandLabel) pieces.push(contextEvidence.oddsBandLabel)
  if (contextEvidence?.marketContextLabel) pieces.push(contextEvidence.marketContextLabel)
  if (contextEvidence?.gameContextLabel) pieces.push(contextEvidence.gameContextLabel)
  if (contextEvidence?.bookValueLabel) pieces.push(contextEvidence.bookValueLabel)
  if (contextEvidence?.confidenceLabel) pieces.push(contextEvidence.confidenceLabel)

  if (!pieces.length) {
    return `${player} ${propType} rates as a special-market play based on current pricing and context.`
  }

  return `${player} ${propType} rates well because of ${pieces.join(", ")}.`
}

const adjustSpecialConfidenceForSubtype = (row, contextEvidence) => {
  const subtype = String(contextEvidence?.subtype || "")
  const oddsBand = String(contextEvidence?.oddsBand || "")
  const base = Number(row?.playerConfidenceScore || 0)

  let adjusted = base

  if (subtype === "first-team-basket") adjusted += 0.08
  if (subtype === "double-double") adjusted += 0.10
  if (subtype === "triple-double") adjusted -= 0.05
  if (subtype === "first-basket") adjusted -= 0.03

  if (oddsBand === "favored") adjusted += 0.10
  if (oddsBand === "balanced") adjusted += 0.05
  if (oddsBand === "longshot") adjusted -= 0.04
  if (oddsBand === "extreme-longshot") adjusted -= 0.12

  return Number(Math.max(0, Math.min(1, adjusted)).toFixed(3))
}

const inferSpecialConfidenceTier = (row, adjustedConfidence, contextEvidence) => {
  const subtype = String(contextEvidence?.subtype || "")

  if (subtype === "double-double") {
    if (adjustedConfidence >= 0.72) return "special-elite"
    if (adjustedConfidence >= 0.58) return "special-strong"
    if (adjustedConfidence >= 0.44) return "special-playable"
    return "special-thin"
  }

  if (subtype === "first-team-basket") {
    if (adjustedConfidence >= 0.62) return "special-elite"
    if (adjustedConfidence >= 0.50) return "special-strong"
    if (adjustedConfidence >= 0.38) return "special-playable"
    return "special-thin"
  }

  if (subtype === "first-basket") {
    if (adjustedConfidence >= 0.56) return "special-elite"
    if (adjustedConfidence >= 0.46) return "special-strong"
    if (adjustedConfidence >= 0.34) return "special-playable"
    return "special-thin"
  }

  if (subtype === "triple-double") {
    if (adjustedConfidence >= 0.52) return "special-strong"
    if (adjustedConfidence >= 0.38) return "special-playable"
    return "special-thin"
  }

  if (adjustedConfidence >= 0.60) return "special-strong"
  if (adjustedConfidence >= 0.42) return "special-playable"
  return "special-thin"
}

const isFirstBasketSubtype = (rowOrSubtype) => {
  const subtype = typeof rowOrSubtype === "string"
    ? rowOrSubtype
    : String(rowOrSubtype?.evidence?.subtype || rowOrSubtype?.marketKey || "")

  return subtype === "first-basket" || subtype === "first-team-basket" ||
    subtype === "player_first_basket" || subtype === "player_first_team_basket"
}

const inferFirstBasketOddsBandScore = (odds) => {
  const num = Number(odds || 0)
  if (!Number.isFinite(num)) return 0.2
  if (num <= 180) return 0.95
  if (num <= 320) return 0.82
  if (num <= 500) return 0.68
  if (num <= 700) return 0.52
  if (num <= 1000) return 0.34
  return 0.18
}

const inferFirstBasketGameContextScore = (row) => {
  const odds = Number(row?.odds || 0)
  const oddsBandScore = inferFirstBasketOddsBandScore(odds)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const volatilityScore = Number(row?.volatilityScore || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)

  let score = 0.10
  score += oddsBandScore * 0.45
  score += bookValueScore * 0.20
  score += matchupEdgeScore * 0.10
  score += (1 - Math.min(1, Math.max(0, volatilityScore))) * 0.10

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const inferFirstBasketConfidenceScore = (row, contextEvidence) => {
  const odds = Number(row?.odds || 0)
  const oddsBandScore = inferFirstBasketOddsBandScore(odds)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const gamePriorityScore = Number(row?.gamePriorityScore || 0)

  let score = 0.08
  score += oddsBandScore * 0.45
  score += bookValueScore * 0.20
  score += gamePriorityScore * 0.15

  if (String(contextEvidence?.oddsBand || "") === "favored") score += 0.08
  if (String(contextEvidence?.oddsBand || "") === "balanced") score += 0.05
  if (String(contextEvidence?.oddsBand || "") === "longshot") score -= 0.04
  if (String(contextEvidence?.oddsBand || "") === "extreme-longshot") score -= 0.12

  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

const buildFirstBasketWhyItRates = (row, contextEvidence) => {
  const reasons = []
  const oddsBand = String(contextEvidence?.oddsBand || "")
  const impliedProbability = Number(contextEvidence?.impliedProbability || 0)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const gamePriorityScore = Number(row?.gamePriorityScore || 0)
  const playerConfidenceScore = Number(row?.playerConfidenceScore || 0)

  if (String(contextEvidence?.subtype || "") === "first-team-basket") reasons.push("team-first-score-angle")
  else reasons.push("first-score-angle")

  if (oddsBand === "favored") reasons.push("high-implied-probability")
  if (oddsBand === "balanced") reasons.push("balanced-upside")
  if (oddsBand === "longshot") reasons.push("longshot-upside")
  if (oddsBand === "extreme-longshot") reasons.push("extreme-longshot")

  if (impliedProbability >= 0.18) reasons.push("meaningful-implied-probability")
  if (bookValueScore >= 0.30) reasons.push("book-value")
  if (gamePriorityScore >= 0.35) reasons.push("game-context-valid")
  if (playerConfidenceScore >= 0.38) reasons.push("model-confidence-valid")

  return [...new Set(reasons)]
}

const buildFirstBasketSummary = (row, contextEvidence, whyItRates) => {
  const player = String(row?.player || "This play")
  const propType = String(row?.propType || "First Basket")

  const pieces = []
  if (contextEvidence?.oddsBandLabel) pieces.push(contextEvidence.oddsBandLabel)
  if (contextEvidence?.gameContextLabel) pieces.push(contextEvidence.gameContextLabel)
  if (contextEvidence?.bookValueLabel) pieces.push(contextEvidence.bookValueLabel)
  if (contextEvidence?.confidenceLabel) pieces.push(contextEvidence.confidenceLabel)

  if (!pieces.length) {
    return `${player} ${propType} rates as a first-score play based on current pricing and context.`
  }

  return `${player} ${propType} rates well because of ${pieces.join(", ")}.`
}

const inferFirstBasketConfidenceTier = (row, adjustedConfidence, contextEvidence) => {
  if (String(contextEvidence?.subtype || "") === "first-team-basket") {
    if (adjustedConfidence >= 0.60) return "special-elite"
    if (adjustedConfidence >= 0.48) return "special-strong"
    if (adjustedConfidence >= 0.34) return "special-playable"
    return "special-thin"
  }

  if (adjustedConfidence >= 0.54) return "special-elite"
  if (adjustedConfidence >= 0.42) return "special-strong"
  if (adjustedConfidence >= 0.30) return "special-playable"
  return "special-thin"
}

const enrichSpecialPredictionRow = (row) => {
  const safeRow = row && typeof row === "object" ? row : {}
  const canonicalTeam = resolveCanonicalPlayerTeamForRow(safeRow)
  const realContextInputs = buildRealSpecialtyContextInputs(safeRow)
  const canonicalSpecialRow = {
    ...safeRow,
    playerTeam: canonicalTeam || safeRow?.playerTeam || null,
    team: canonicalTeam || safeRow?.playerTeam || null,
    ...realContextInputs
  }

  if (
    safeRow?.marketKey === "player_first_basket" ||
    safeRow?.marketKey === "player_first_team_basket" ||
    safeRow?.marketKey === "player_double_double" ||
    safeRow?.marketKey === "player_triple_double"
  ) {
    const evidence = buildSpecialMarketEvidence(canonicalSpecialRow)
    const whyItRates = buildSpecialWhyItRates(canonicalSpecialRow, evidence)
    const confidence = scoreSpecialMarketConfidence(canonicalSpecialRow, evidence)

    const withConfidence = {
      ...canonicalSpecialRow,
      evidence,
      whyItRates,
      playerConfidenceScore: confidence,
      gamePriorityScore: inferGamePriorityScore(canonicalSpecialRow),
      modelSummary: `${canonicalSpecialRow.player} ${canonicalSpecialRow.propType} is priced at ${canonicalSpecialRow.odds} with ${(evidence.impliedProbability * 100).toFixed(1)}% implied probability and categorized as ${evidence.isLongshot ? "longshot" : evidence.isReasonable ? "balanced" : "favored"}.`
    }

    const contextEvidence = buildSpecialContextEvidence(withConfidence)
    const contextWhyItRates = buildSpecialContextWhyItRates(withConfidence, contextEvidence)
    const adjustedSpecialConfidence = adjustSpecialConfidenceForSubtype(withConfidence, contextEvidence)
    const contextModelSummary = buildSpecialContextSummary(withConfidence, contextEvidence, contextWhyItRates)
    const confidenceTier = inferSpecialConfidenceTier(withConfidence, adjustedSpecialConfidence, contextEvidence)

    let finalGamePriorityScore = Number(withConfidence?.gamePriorityScore || 0)
    let finalPlayerConfidenceScore = adjustedSpecialConfidence
    let finalWhyItRates = contextWhyItRates
    let finalModelSummary = contextModelSummary
    let finalConfidenceTier = confidenceTier

    if (isFirstBasketSubtype(contextEvidence?.subtype)) {
      finalGamePriorityScore = inferFirstBasketGameContextScore(withConfidence)
      finalPlayerConfidenceScore = inferFirstBasketConfidenceScore(
        { ...withConfidence, gamePriorityScore: finalGamePriorityScore },
        contextEvidence
      )
      finalWhyItRates = buildFirstBasketWhyItRates(
        { ...withConfidence, gamePriorityScore: finalGamePriorityScore, playerConfidenceScore: finalPlayerConfidenceScore },
        contextEvidence
      )
      finalModelSummary = buildFirstBasketSummary(
        { ...withConfidence, gamePriorityScore: finalGamePriorityScore, playerConfidenceScore: finalPlayerConfidenceScore },
        contextEvidence,
        finalWhyItRates
      )
      finalConfidenceTier = inferFirstBasketConfidenceTier(
        { ...withConfidence, gamePriorityScore: finalGamePriorityScore, playerConfidenceScore: finalPlayerConfidenceScore },
        finalPlayerConfidenceScore,
        contextEvidence
      )
    }

    const lineupContextInput = {
      ...withConfidence,
      gamePriorityScore: finalGamePriorityScore,
      playerConfidenceScore: finalPlayerConfidenceScore
    }
    const hasRealSpecialtyContext = [
      lineupContextInput.avgMin,
      lineupContextInput.recent3MinAvg,
      lineupContextInput.recent3Avg,
      lineupContextInput.l10Avg,
      lineupContextInput.minCeiling,
      lineupContextInput.roleSignalScore
    ].some((value) => Number.isFinite(Number(value)))
    const lineupRoleSignals = hasRealSpecialtyContext
      ? buildLineupRoleContextSignals(lineupContextInput)
      : {}

    return {
      ...withConfidence,
      gamePriorityScore: finalGamePriorityScore,
      evidence: {
        ...(withConfidence?.evidence || {}),
        ...contextEvidence
      },
      whyItRates: finalWhyItRates,
      playerConfidenceScore: finalPlayerConfidenceScore,
      confidenceTier: finalConfidenceTier,
      modelSummary: finalModelSummary,
      ...lineupRoleSignals
    }
  }

  const specialBase = {
    ...canonicalSpecialRow,
    gameEnvironmentScore: Number(safeRow?.gameEnvironmentScore ?? 0.35),
    matchupEdgeScore: Number(safeRow?.matchupEdgeScore ?? 0.25),
    bookValueScore: Number(safeRow?.bookValueScore ?? inferBookValueScore(safeRow)),
    volatilityScore: Number(safeRow?.volatilityScore ?? inferVolatilityScore(safeRow)),
    betTypeFit: String(safeRow?.betTypeFit || inferBetTypeFit(safeRow, {
      gameEnvironmentScore: Number(safeRow?.gameEnvironmentScore ?? 0.35),
      matchupEdgeScore: Number(safeRow?.matchupEdgeScore ?? 0.25),
      bookValueScore: Number(safeRow?.bookValueScore ?? inferBookValueScore(safeRow)),
      volatilityScore: Number(safeRow?.volatilityScore ?? inferVolatilityScore(safeRow))
    }))
  }

  const enrichedPrediction = enrichPredictionLayer(specialBase)
  const evidence = buildEvidence(enrichedPrediction)
  const whyItRates = buildDataDrivenWhyItRates(enrichedPrediction)
  const modelSummary = buildModelSummary(enrichedPrediction, evidence, whyItRates)

  return {
    ...enrichedPrediction,
    evidence,
    whyItRates,
    modelSummary
  }
}

const filterSpecialRowsForBoard = (rows) => {
  const safe = Array.isArray(rows) ? rows : []

  return safe.filter((row) => {
    const odds = Number(row?.odds || 0)
    const confidence = Number(row?.playerConfidenceScore || 0)
    const tier = String(row?.confidenceTier || "")

    // kill extreme longshot garbage
    if (odds > 1500 && confidence < 0.25) return false

    // kill low confidence noise
    if (confidence < 0.22) return false

    // keep only relevant tiers
    if (
      !tier.includes("elite") &&
      !tier.includes("strong") &&
      !tier.includes("playable")
    ) {
      return false
    }

    return true
  })
}

const sortSpecialBoardSmart = (rows) => {
  const safe = Array.isArray(rows) ? rows : []

  return [...safe].sort((a, b) => {
    const aScore =
      (Number(a?.playerConfidenceScore || 0) * 0.6) +
      (Number(a?.gamePriorityScore || 0) * 0.2) +
      (Number(a?.bookValueScore || 0) * 0.1)

    const bScore =
      (Number(b?.playerConfidenceScore || 0) * 0.6) +
      (Number(b?.gamePriorityScore || 0) * 0.2) +
      (Number(b?.bookValueScore || 0) * 0.1)

    return bScore - aScore
  })
}

const getMatchupKey = (row) => String(row?.matchup || "")

const buildGameEdgeMap = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const byGame = {}

  for (const row of safeRows) {
    const key = getMatchupKey(row)
    if (!key) continue
    if (!byGame[key]) byGame[key] = []
    byGame[key].push(row)
  }

  const gameEdgeMap = {}

  for (const [matchup, gameRows] of Object.entries(byGame)) {
    const count = gameRows.length || 1

    const avgGameEnvironment =
      gameRows.reduce((sum, row) => sum + Number(row?.gameEnvironmentScore || 0), 0) / count

    const avgMatchupEdge =
      gameRows.reduce((sum, row) => sum + Number(row?.matchupEdgeScore || 0), 0) / count

    const avgBookValue =
      gameRows.reduce((sum, row) => sum + Number(row?.bookValueScore || 0), 0) / count

    const avgConfidence =
      gameRows.reduce((sum, row) => sum + Number(row?.playerConfidenceScore || 0), 0) / count

    const score = Number(Math.min(1, Math.max(0,
      (avgGameEnvironment * 0.40) +
      (avgMatchupEdge * 0.25) +
      (avgBookValue * 0.15) +
      (avgConfidence * 0.20)
    )).toFixed(3))

    gameEdgeMap[matchup] = {
      matchup,
      rowCount: gameRows.length,
      avgGameEnvironment: Number(avgGameEnvironment.toFixed(3)),
      avgMatchupEdge: Number(avgMatchupEdge.toFixed(3)),
      avgBookValue: Number(avgBookValue.toFixed(3)),
      avgConfidence: Number(avgConfidence.toFixed(3)),
      gameEdgeScore: score
    }
  }

  return gameEdgeMap
}

const inferRoleSignal = (row) => {
  const recent5MinAvg = Number(row?.recent5MinAvg || 0)
  const avgMin = Number(row?.avgMin || 0)
  const hitRateRaw = row?.hitRate
  const hitRate =
    typeof hitRateRaw === "string" && hitRateRaw.includes("/")
      ? (() => {
          const [a, b] = hitRateRaw.split("/").map(Number)
          return b ? a / b : 0
        })()
      : Number(hitRateRaw || 0)

  let roleScore = 0.10
  if (recent5MinAvg >= 30) roleScore += 0.30
  else if (recent5MinAvg >= 26) roleScore += 0.20
  else if (recent5MinAvg >= 22) roleScore += 0.10

  if (avgMin >= 30) roleScore += 0.20
  else if (avgMin >= 26) roleScore += 0.12

  if (hitRate >= 0.70) roleScore += 0.20
  else if (hitRate >= 0.55) roleScore += 0.10

  if (String(row?.betTypeFit || "") === "anchor") roleScore += 0.10
  if (String(row?.betTypeFit || "") === "special") roleScore += 0.05
  if (String(row?.betTypeFit || "") === "lotto") roleScore -= 0.05

  return Number(Math.min(1, Math.max(0, roleScore)).toFixed(3))
}

const applyGameAndRoleEdge = (rows, gameEdgeMap) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeMap = gameEdgeMap && typeof gameEdgeMap === "object" ? gameEdgeMap : {}

  return safeRows.map((row) => {
    const matchup = getMatchupKey(row)
    const gameEdgeScore = Number(safeMap?.[matchup]?.gameEdgeScore || 0)
    const roleSignalScore = inferRoleSignal(row)

    const adjustedConfidence = Number(Math.min(1, Math.max(0,
      (Number(row?.playerConfidenceScore || 0) * 0.55) +
      (gameEdgeScore * 0.25) +
      (roleSignalScore * 0.20)
    )).toFixed(3))

    return {
      ...row,
      gameEdgeScore,
      roleSignalScore,
      adjustedConfidenceScore: adjustedConfidence
    }
  })
}

const inferPlayDecision = (row) => {
  const adjusted = Number(row?.adjustedConfidenceScore || 0)
  const betTypeFit = String(row?.betTypeFit || "")
  const marketKey = String(row?.marketKey || "")

  if (marketKey === "player_first_basket" || marketKey === "player_first_team_basket") {
    if (adjusted >= 0.52) return "must-play"
    if (adjusted >= 0.38) return "secondary"
    return "avoid"
  }

  if (betTypeFit === "anchor") {
    if (adjusted >= 0.72) return "must-play"
    if (adjusted >= 0.58) return "secondary"
    return "avoid"
  }

  if (betTypeFit === "value" || betTypeFit === "ladder" || betTypeFit === "special") {
    if (adjusted >= 0.60) return "must-play"
    if (adjusted >= 0.44) return "secondary"
    return "avoid"
  }

  if (betTypeFit === "lotto") {
    if (adjusted >= 0.46) return "must-play"
    if (adjusted >= 0.32) return "secondary"
    return "avoid"
  }

  if (adjusted >= 0.60) return "must-play"
  if (adjusted >= 0.42) return "secondary"
  return "avoid"
}

const buildDecisionSummary = (row) => {
  const decision = String(row?.playDecision || "secondary")
  const matchup = String(row?.matchup || "")
  const gameEdgeScore = Number(row?.gameEdgeScore || 0)
  const roleSignalScore = Number(row?.roleSignalScore || 0)
  const adjusted = Number(row?.adjustedConfidenceScore || 0)

  const reasons = []
  if (gameEdgeScore >= 0.50) reasons.push("strong game")
  else if (gameEdgeScore >= 0.35) reasons.push("good game")

  if (roleSignalScore >= 0.45) reasons.push("strong role")
  else if (roleSignalScore >= 0.28) reasons.push("solid role")

  if (adjusted >= 0.60) reasons.push("high confidence")
  else if (adjusted >= 0.42) reasons.push("playable confidence")

  if (!reasons.length) reasons.push("limited edge")

  return `${decision.toUpperCase()}: ${reasons.join(", ")}${matchup ? ` in ${matchup}` : ""}.`
}

const sortByAdjustedConfidence = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) =>
    Number(b?.adjustedConfidenceScore || 0) - Number(a?.adjustedConfidenceScore || 0)
  )
}

const normalizeRelativeScores = (rows, key) => {
  const safeRows = Array.isArray(rows) ? rows : []
  if (!safeRows.length) return safeRows

  const values = safeRows.map((r) => Number(r?.[key] || 0))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return safeRows.map((row) => ({
    ...row,
    [`${key}Relative`]: (Number(row?.[key] || 0) - min) / range
  }))
}

const applyGamePriorityBoost = (rows) => {
  const byGame = {}

  for (const row of rows) {
    const key = String(row?.matchup || "")
    if (!byGame[key]) byGame[key] = []
    byGame[key].push(row)
  }

  let output = []

  for (const gameRows of Object.values(byGame)) {
    const sorted = [...gameRows].sort(
      (a, b) => (b.playerConfidenceScore || 0) - (a.playerConfidenceScore || 0)
    )

    const boosted = sorted.map((row, idx) => {
      let boost = 0
      if (idx === 0) boost = 0.12
      else if (idx === 1) boost = 0.07
      else if (idx === 2) boost = 0.03

      return {
        ...row,
        playerConfidenceScore: Math.min(1, (row.playerConfidenceScore || 0) + boost)
      }
    })

    output.push(...boosted)
  }

  return output
}

const dedupePredictionRows = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const out = []

  for (const row of safeRows) {
    const key = [
      String(row?.player || ""),
      String(row?.matchup || ""),
      String(row?.propType || ""),
      String(row?.side || ""),
      String(row?.line ?? ""),
      String(row?.marketKey || ""),
      String(row?.propVariant || "base")
    ].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out
}

const buildSelectiveBoard = (rows, limit, sortFn) => {
  const safeRows = dedupePredictionRows(Array.isArray(rows) ? rows : [])
  const sorted = typeof sortFn === "function" ? sortFn(safeRows) : safeRows
  return sorted.slice(0, limit)
}

const sortByPredictionStrength = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.playerConfidenceScore || 0) * 0.45) +
      (Number(a?.gamePriorityScore || 0) * 0.25) +
      (Number(a?.bookValueScore || 0) * 0.10) +
      (Number(a?.matchupEdgeScore || 0) * 0.10) -
      (Number(a?.volatilityScore || 0) * 0.05)

    const bScore =
      (Number(b?.playerConfidenceScore || 0) * 0.45) +
      (Number(b?.gamePriorityScore || 0) * 0.25) +
      (Number(b?.bookValueScore || 0) * 0.10) +
      (Number(b?.matchupEdgeScore || 0) * 0.10) -
      (Number(b?.volatilityScore || 0) * 0.05)

    return bScore - aScore
  })
}

const sortFirstBasketPredictionBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.playerConfidenceScore || 0) * 0.30) +
      (Number(a?.bookValueScore || 0) * 0.20) +
      (Number(a?.gamePriorityScore || 0) * 0.20) +
      (Number(a?.volatilityScore || 0) * 0.15) +
      ((Number(a?.odds || 0) >= 300 && Number(a?.odds || 0) <= 1800) ? 0.15 : 0)

    const bScore =
      (Number(b?.playerConfidenceScore || 0) * 0.30) +
      (Number(b?.bookValueScore || 0) * 0.20) +
      (Number(b?.gamePriorityScore || 0) * 0.20) +
      (Number(b?.volatilityScore || 0) * 0.15) +
      ((Number(b?.odds || 0) >= 300 && Number(b?.odds || 0) <= 1800) ? 0.15 : 0)

    return bScore - aScore
  })
}

const sortLottoPredictionBoard = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows].sort((a, b) => {
    const aScore =
      (Number(a?.volatilityScore || 0) * 0.30) +
      (Number(a?.bookValueScore || 0) * 0.20) +
      (Number(a?.playerConfidenceScore || 0) * 0.20) +
      (Number(a?.gamePriorityScore || 0) * 0.10) +
      ((Number(a?.odds || 0) >= 300) ? 0.20 : 0)

    const bScore =
      (Number(b?.volatilityScore || 0) * 0.30) +
      (Number(b?.bookValueScore || 0) * 0.20) +
      (Number(b?.playerConfidenceScore || 0) * 0.20) +
      (Number(b?.gamePriorityScore || 0) * 0.10) +
      ((Number(b?.odds || 0) >= 300) ? 0.20 : 0)

    return bScore - aScore
  })
}

// --- End prediction layer helpers ---

// --- Explanation layer helpers ---

const parseHitRateFraction = (value) => {
  if (typeof value === "string" && value.includes("/")) {
    const [a, b] = value.split("/").map(Number)
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return { made: a, total: b, ratio: a / b }
  }
  const num = Number(value)
  if (Number.isFinite(num)) return { made: null, total: null, ratio: num }
  return { made: null, total: null, ratio: 0 }
}

const buildEvidence = (row) => {
  const hit = parseHitRateFraction(row?.hitRate)
  const l10Avg = Number(row?.l10Avg || 0)
  const recent5Avg = Number(row?.recent5Avg || 0)
  const recent3Avg = Number(row?.recent3Avg || 0)
  const line = row?.line
  const avgMin = Number(row?.avgMin || 0)
  const recent5MinAvg = Number(row?.recent5MinAvg || 0)
  const edge = Number(row?.edge || 0)
  const gameEnvironmentScore = Number(row?.gameEnvironmentScore || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
  const odds = row?.odds

  return {
    hitRateLabel:
      hit.made !== null && hit.total !== null
        ? `${hit.made}/${hit.total} last ${hit.total}`
        : null,
    lineLabel: line !== null && line !== undefined ? `line ${line}` : null,
    l10AvgLabel: Number.isFinite(l10Avg) && l10Avg > 0 ? `${l10Avg} last 10 avg` : null,
    recent5AvgLabel: Number.isFinite(recent5Avg) && recent5Avg > 0 ? `${recent5Avg} last 5 avg` : null,
    recent3AvgLabel: Number.isFinite(recent3Avg) && recent3Avg > 0 ? `${recent3Avg} last 3 avg` : null,
    avgMinLabel: Number.isFinite(avgMin) && avgMin > 0 ? `${avgMin} avg mpg` : null,
    recent5MinLabel: Number.isFinite(recent5MinAvg) && recent5MinAvg > 0 ? `${recent5MinAvg} recent mpg` : null,
    edgeLabel: Number.isFinite(edge) && edge > 0 ? `edge +${edge}` : null,
    matchupLabel: matchupEdgeScore >= 0.55 ? "strong matchup edge" : matchupEdgeScore >= 0.40 ? "positive matchup edge" : null,
    environmentLabel: gameEnvironmentScore >= 0.60 ? "strong game environment" : gameEnvironmentScore >= 0.48 ? "good game environment" : null,
    oddsLabel: odds !== null && odds !== undefined ? `odds ${odds}` : null
  }
}

const buildDataDrivenWhyItRates = (row) => {
  const reasons = []
  const hit = parseHitRateFraction(row?.hitRate)
  const line = Number(row?.line)
  const l10Avg = Number(row?.l10Avg || 0)
  const recent5Avg = Number(row?.recent5Avg || 0)
  const recent5MinAvg = Number(row?.recent5MinAvg || 0)
  const edge = Number(row?.edge || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
  const gameEnvironmentScore = Number(row?.gameEnvironmentScore || 0)
  const bookValueScore = Number(row?.bookValueScore || 0)
  const marketKey = String(row?.marketKey || "")

  if (hit.ratio >= 0.8) reasons.push("high-hit-rate")
  if (Number.isFinite(line) && Number.isFinite(l10Avg) && l10Avg > line) reasons.push("recent-production-over-line")
  if (Number.isFinite(line) && Number.isFinite(recent5Avg) && recent5Avg > line) reasons.push("recent-form-over-line")
  if (Number.isFinite(recent5MinAvg) && recent5MinAvg >= 28) reasons.push("stable-minutes")
  if (edge >= 5) reasons.push("positive-edge")
  if (matchupEdgeScore >= 0.40) reasons.push("matchup-edge")
  if (gameEnvironmentScore >= 0.48) reasons.push("good-game-environment")
  if (bookValueScore >= 0.24) reasons.push("book-value")
  if (marketKey === "player_first_basket" || marketKey === "player_first_team_basket") reasons.push("special-market-upside")

  return reasons
}

const buildModelSummary = (row, evidence, reasons) => {
  const player = String(row?.player || "This play")
  const propType = String(row?.propType || "prop")
  const parts = []

  if (evidence?.hitRateLabel) parts.push(`hit ${evidence.hitRateLabel}`)
  if (evidence?.l10AvgLabel && evidence?.lineLabel) parts.push(`${evidence.l10AvgLabel} against ${evidence.lineLabel}`)
  if (evidence?.recent5MinLabel) parts.push(`${evidence.recent5MinLabel}`)
  if (evidence?.matchupLabel) parts.push(evidence.matchupLabel)
  if (evidence?.environmentLabel) parts.push(evidence.environmentLabel)
  if (evidence?.edgeLabel) parts.push(evidence.edgeLabel)

  if (!parts.length) {
    return `${player} ${propType} rates well based on the current model inputs.`
  }

  return `${player} ${propType} rates well because ${parts.join(", ")}.`
}

// --- End explanation layer helpers ---

function scorePropRow(row) {
  const hitRateValue = parseHitRate(row.hitRate)
  const line = Number(row.line || 0)
  const edge = Number(row.edge || 0)
  const odds = Number(row.odds || 0)
  const avgMin = Number(row.avgMin || 0)
  const minStd = Number(row.minStd || 0)
  const valueStd = Number(row.valueStd || 0)
  const minFloor = Number(row.minFloor || 0)
  const recent3Avg = Number(row.recent3Avg || 0)
  const recent5Avg = Number(row.recent5Avg || 0)
  const l10Avg = Number(row.l10Avg || 0)
  const lineMove = Number(row.lineMove || 0)
  const oddsMove = Number(row.oddsMove || 0)
  const minutesRisk = String(row.minutesRisk || "")
  const trendRisk = String(row.trendRisk || "")
  const injuryRisk = String(row.injuryRisk || "")

  let score = 0

  if (row.edge !== null && line > 0) {
    const edgeBase = Math.max(line, 5)
    const normalizedEdge = edge / edgeBase
    score += normalizedEdge * 120
  }

  score += hitRateValue * 55

  if (row.avgMin !== null) {
    if (avgMin >= 34) score += 10
    else if (avgMin >= 30) score += 7
    else if (avgMin >= 28) score += 4
    else if (avgMin >= 26) score += 1
    else score -= 10
  }

  if (odds >= -135 && odds <= 110) score += 6
  else if (odds < -170) score -= 10
  else if (odds < -150) score -= 5

  const dvp = getDvpScore(getOpponentForRow(row), row.propType)
  if (row.side === "Over") score += dvp * 5
  if (row.side === "Under") score -= dvp * 5

  if (row.propType === "Assists") {
    if (line <= 5.5) score += 5
    else if (line <= 6.5) score += 2
    else if (line >= 8.5) score -= 6
  }

  if (row.propType === "Rebounds") {
    if (line <= 8.5) score += 6
    else if (line >= 11.5) score -= 5
  }

  if (row.propType === "Threes") {
    if (line <= 1.5) score += 7
    else if (line <= 2.5) score += 4
    else if (line <= 3.5) score += 1 // Small bonus for reasonable 3+ lines
    else if (line >= 4.5 && row.side === "Over") score -= 5 // Reduced penalty
    else if (line >= 3.5 && row.side === "Over") score -= 3 // Reduced from -7
    
    // Allow higher 3-point lines for high hit rate players
    const hitRate = parseHitRate(row.hitRate)
    if (line >= 3.5 && hitRate >= 0.75) score += 2
  }

  if (row.propType === "Points") {
    if (line <= 17.5) score += 5
    else if (line >= 24.5) score -= 6
    else if (line >= 29.5) score -= 12
  }

  if (row.propType === "PRA") {
    // Reduced base penalty for PRA, allow when justified
    score -= 6 // Reduced from -12
    
    // Less harsh penalties for high lines
    if (line >= 35) score -= 4 // Reduced from -8 at 30, -15 at 40
    else if (line >= 40) score -= 8
    
    // Bonus for high hit rate players on PRA (like consistent performers)
    const hitRate = parseHitRate(row.hitRate)
    if (hitRate >= 0.7) score += 4 // Allow PRA for consistent players
    if (hitRate >= 0.8) score += 3
    
    // Bonus for good edge on PRA
    if (edge >= 3) score += 3
  }

  if (row.side === "Over") {
    if (row.propType === "Rebounds" && line <= 8.5) score += 3
    if (row.propType === "Threes" && line <= 1.5) score += 4
    if (row.propType === "Points" && line >= 24.5) score -= 5
    if (row.propType === "PRA") score -= 2 // Reduced from -6
  }

  if (row.side === "Under") {
    if (row.propType === "Points" && line >= 24.5) score += 5
    if (row.propType === "Rebounds" && line >= 10.5) score += 4
    if (row.propType === "PRA" && line >= 30) score += 8
    if (row.propType === "Threes" && line >= 3.5) score += 4
    if (row.propType === "Assists" && line >= 7.5) score += 4
  }

  // minutes stability
  if (row.minStd !== null) {
    if (minStd <= 2.5) score += 8
    else if (minStd <= 4) score += 5
    else if (minStd <= 6) score += 2
    else if (minStd >= 9) score -= 10
    else if (minStd >= 7) score -= 5
  }

  // role floor
  if (row.minFloor !== null) {
    if (minFloor >= 30) score += 8
    else if (minFloor >= 27) score += 4
    else if (minFloor < 24) score -= 10
  }
  if (minutesRisk === "high") score -= 8
  else if (minutesRisk === "medium") score -= 3
  else if (minutesRisk === "low") score += 1

  if (trendRisk === "high") score -= 8
  else if (trendRisk === "medium") score -= 3

  if (injuryRisk === "high") score -= 10
  else if (injuryRisk === "medium") score -= 4

  // stat volatility
  if (row.valueStd !== null) {
    if (row.propType === "Points" || row.propType === "PRA") {
      if (valueStd >= 10) score -= 8
      else if (valueStd >= 8) score -= 4
    } else {
      if (valueStd >= 5) score -= 6
      else if (valueStd >= 4) score -= 3
    }
  }

  // recent form / trend
  if (row.recent3Avg !== null && row.recent5Avg !== null) {
    if (row.side === "Over") {
      if (recent3Avg >= recent5Avg && recent5Avg >= l10Avg) score += 8
      else if (recent3Avg < recent5Avg && recent5Avg < l10Avg) score -= 8
    }

    if (row.side === "Under") {
      if (recent3Avg <= recent5Avg && recent5Avg <= l10Avg) score += 8
      else if (recent3Avg > recent5Avg && recent5Avg > l10Avg) score -= 8
    }
  }

  score += getPracticalSafetyBonus(row)
  score += getMarketEdgeBonus(row)

  // market movement adjustments
  if (row.side === "Over") {
    if (lineMove >= 1) score -= 8
    else if (lineMove >= 0.5) score -= 4
    else if (lineMove <= -1) score += 6
    else if (lineMove <= -1) score += 3
  }

  if (row.side === "Under") {
    if (lineMove <= -1) score -= 8
    else if (lineMove <= -1) score -= 4
    else if (lineMove >= 1) score += 6
    else if (lineMove >= 0.5) score += 3
  }

  if (oddsMove <= -30) score -= 5
  else if (oddsMove <= -15) score -= 3
  else if (oddsMove >= 30) score += 4
  else if (oddsMove >= 15) score += 2

  score += getSharpSteamBonus(row)
  score -= getVolatilityPenalty(row)

  return Number(score.toFixed(1))
}
function dedupeBestProps(rows) {
  const map = new Map()

  for (const row of rows) {
    if (shouldRemoveLegForPlayerStatus(row)) continue
    const key = `${row.player}-${row.propType}-${row.line}-${row.side}`

    if (!map.has(key)) {
      map.set(key, row)
    } else {
      const existing = map.get(key)
      if (Number(row.odds) > Number(existing.odds)) {
        map.set(key, row)
      }
    }
  }

  return Array.from(map.values())
}

function buildConstrainedSlip(rows, legCount, options = {}) {
  const { maxPerPlayer = 1, maxPerGame = 2 } = options

  const chosen = []
  const playerCounts = new Map()
  const gameCounts = new Map()

  for (const row of rows) {
    const playerCount = playerCounts.get(row.player) || 0
    const gameCount = gameCounts.get(row.matchup) || 0

    if (playerCount >= maxPerPlayer) continue
    if (gameCount >= maxPerGame) continue

    chosen.push(row)
    playerCounts.set(row.player, playerCount + 1)
    gameCounts.set(row.matchup, gameCount + 1)

    if (chosen.length >= legCount) break
  }

  return chosen
}

function dedupeSlipLegs(rows) {
  const seen = new Set()
  const out = []

  for (const row of rows) {
    if (shouldRemoveLegForPlayerStatus(row)) continue
    const key = `${row.player}-${row.propType}-${row.side}-${Number(row.line)}-${row.book}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out
}

function hasConflict(existingLegs, candidate) {
  return existingLegs.some((leg) =>
    leg.player === candidate.player &&
    leg.propType === candidate.propType &&
    Number(leg.line) === Number(candidate.line) &&
    leg.side !== candidate.side
  )
}

function hasSameGameStatSide(existingLegs, candidate) {
  return existingLegs.some((leg) =>
    leg.matchup === candidate.matchup &&
    leg.propType === candidate.propType &&
    leg.side === candidate.side
  )
}

function hasSingleEventId(legs = []) {
  if (!Array.isArray(legs) || !legs.length) return false

  const firstEventId = String(legs[0]?.eventId || "").trim()
  if (!firstEventId) return false

  return legs.every((leg) => String(leg?.eventId || "").trim() === firstEventId)
}

function buildTieredSlip(sources, legCount, options = {}) {
  const {
    maxPerPlayer = 1,
    maxPerGame = 2,
    preferredBook = null,
    skip = 0,
    minScore = 0,
    excludePlayers = [],
    excludeLegKeys = [],
    avoidFragile = false,
    forceUniquePlayers = true,
    excludeManualOverridePlayers = false,
    allowedPropTypes = null,
    blockSameGameStatSide = false
  } = options

  const chosen = []
  const playerCounts = new Map()
  const gameCounts = new Map()

  const excludedPlayers = new Set(excludePlayers)
  const excludedLegSet = new Set(excludeLegKeys)

  let seenEligible = 0

  for (const sourceRows of sources) {
    const rows = preferredBook
      ? sourceRows.filter((row) => row.book === preferredBook)
      : sourceRows

    for (const row of rows) {
      if (shouldRemoveLegForPlayerStatus(row)) continue
      const legKey = `${row.player}-${row.propType}-${row.side}-${Number(row.line)}-${row.book}`

      if (excludedPlayers.has(row.player)) continue
      if (excludedLegSet.has(legKey)) continue
      if (Number(row.score || 0) < Number(minScore || 0)) continue
      if (avoidFragile && isFragileLeg(row)) continue
      if (excludeManualOverridePlayers && isManualOverridePlayer(row.player)) continue
      if (Array.isArray(allowedPropTypes) && !allowedPropTypes.includes(row.propType)) continue

      // Reject legs with high risk. Medium/unknown minutes/injury risk are still usable.
      if (String(row.minutesRisk || "").toLowerCase() === "high") continue
      if (String(row.injuryRisk || "").toLowerCase() === "high") continue
      if (row.trendRisk === "high") continue
      if ((row.avgMin || 0) > 0 && (row.avgMin || 0) < 20) continue
      if ((row.minFloor || 0) > 0 && (row.minFloor || 0) < 12) continue

      const playerCount = playerCounts.get(row.player) || 0
      const gameCount = gameCounts.get(row.matchup) || 0

      if (forceUniquePlayers && samePlayerInSlip(chosen, row)) continue
      if (playerCount >= maxPerPlayer) continue
      if (gameCount >= maxPerGame) continue
      if (hasConflict(chosen, row)) continue
      if (blockSameGameStatSide && hasSameGameStatSide(chosen, row)) continue

      if (seenEligible < skip) {
        seenEligible += 1
        continue
      }

      chosen.push(row)
      playerCounts.set(row.player, playerCount + 1)
      gameCounts.set(row.matchup, gameCount + 1)

      if (chosen.length >= legCount) {
        return dedupeSlipLegs(chosen)
      }
    }
  }

  return dedupeSlipLegs(chosen)
}


function collectPlayers(legs = []) {
  return [...new Set(legs.map((leg) => leg.player))]
}

function collectLegKeys(legs = []) {
  return legs.map(
    (leg) => `${leg.player}-${leg.propType}-${leg.side}-${Number(leg.line)}-${leg.book}`
  )
}

function appendUniqueLegs(base, additions, maxLen, options = {}) {
  const {
    maxPerPlayer = Infinity,
    maxPerGame = Infinity,
    forceUniquePlayers = false
  } = options

  const out = [...base]

  const getPlayerCount = (player) =>
    out.filter((leg) => leg.player === player).length

  const getGameCount = (matchup) =>
    out.filter((leg) => leg.matchup === matchup).length

  for (const row of additions || []) {
    if (shouldRemoveLegForPlayerStatus(row)) continue
    if (out.length >= maxLen) break
    if (!row) continue

    if (forceUniquePlayers && samePlayerInSlip(out, row)) continue
    if (hasConflict(out, row)) continue
    if (getPlayerCount(row.player) >= maxPerPlayer) continue
    if (getGameCount(row.matchup) >= maxPerGame) continue

    const alreadyExists = out.some(
      (leg) =>
        leg.player === row.player &&
        leg.propType === row.propType &&
        leg.side === row.side &&
        Number(leg.line) === Number(row.line) &&
        leg.book === row.book
    )

    if (alreadyExists) continue
    out.push(row)
  }

  return out
}

function buildTierWithFallback(sources, legCount, strategies = []) {
  let out = []

  for (const strategy of strategies) {
    if (out.length >= legCount) break

    const picked = buildTieredSlip(sources, legCount, {
      ...strategy,
      blockSameGameStatSide: Boolean(strategy.blockSameGameStatSide),
      excludePlayers: [
        ...(strategy.excludePlayers || []),
        ...collectPlayers(out)
      ],
      excludeLegKeys: [
        ...(strategy.excludeLegKeys || []),
        ...collectLegKeys(out)
      ]
    })

    out = appendUniqueLegs(out, picked, legCount, {
      maxPerPlayer: strategy.maxPerPlayer ?? Infinity,
      maxPerGame: strategy.maxPerGame ?? Infinity,
      forceUniquePlayers: Boolean(strategy.forceUniquePlayers)
    })
  }

  return out.slice(0, legCount)
}

function validateSlip(slip, maxPerPlayer = 1, maxPerGame = 1) {
  const playerCounts = new Map()
  const gameCounts = new Map()

  for (const leg of slip) {
    const playerCount = playerCounts.get(leg.player) || 0
    const gameCount = gameCounts.get(leg.matchup) || 0

    if (playerCount >= maxPerPlayer) return false
    if (gameCount >= maxPerGame) return false

    playerCounts.set(leg.player, playerCount + 1)
    gameCounts.set(leg.matchup, gameCount + 1)
  }

  return true
}

function highestHitRateSortValue(row) {
  const hitRate = parseHitRate(row.hitRate)
  const minutesRiskRank =
    row.minutesRisk === "low" ? 3 :
    row.minutesRisk === "medium" ? 2 :
    row.minutesRisk === "high" ? 1 : 0
  const trendRiskRank =
    row.trendRisk === "low" ? 3 :
    row.trendRisk === "medium" ? 2 :
    row.trendRisk === "high" ? 1 : 0
  const injuryRiskRank =
    row.injuryRisk === "low" ? 3 :
    row.injuryRisk === "medium" ? 2 :
    row.injuryRisk === "high" ? 1 : 0

  return (
    hitRate * 1000 +
    Number(row.minFloor || 0) * 2 +
    Number(row.avgMin || 0) * 1.5 -
    Number(row.minStd || 0) * 8 -
    Number(row.valueStd || 0) * 6 +
    minutesRiskRank * 12 +
    trendRiskRank * 10 +
    injuryRiskRank * 10 +
    Number(row.score || 0) * 0.35
  )
}

function bestValueSortValue(row) {
  const hitRate = parseHitRate(row.hitRate)
  return (
    Number(row.score || 0) * 1.25 +
    Number(row.edge || 0) * 18 +
    hitRate * 120 +
    Number(row.odds || 0) * 0.04 -
    Number(row.minStd || 0) * 3 -
    Number(row.valueStd || 0) * 2
  )
}

/**
 * ML-weighted sort value: combines heuristic score with ML-predicted probability.
 * Higher values = better picks.
 */
function mlWeightedSortValue(row) {
  const heuristicScore = Number(row.score || 0)
  const mlProb = mlScorer.scoreRow(row)
  
  if (mlProb === null) {
    // Fallback to heuristic if ML scorer unavailable
    return heuristicScore
  }
  
  const hitRate = parseHitRate(row.hitRate)
  const edge = Number(row.edge || 0)
  
  // Weighted combination: heuristic + ML probability + edge + hit rate
  return (
    heuristicScore * 0.4 +
    mlProb * 100 * 0.4 +
    edge * 15 * 0.1 +
    hitRate * 60 * 0.1
  )
}

function sortRowsForHighestHitRate(rows = []) {
  return [...rows].sort((a, b) => {
    return highestHitRateSortValue(b) - highestHitRateSortValue(a)
  })
}

function sortRowsForBestValue(rows = []) {
  return [...rows].sort((a, b) => {
    return bestValueSortValue(b) - bestValueSortValue(a)
  })
}

/**
 * Sort rows by ML-weighted score (heuristic + ML probability).
 */
function sortRowsForMLWeightedScore(rows = []) {
  return [...rows].sort((a, b) => {
    return mlWeightedSortValue(b) - mlWeightedSortValue(a)
  })
}

/**
 * ML-weighted hit rate sort: blends hit rate preference with ML probability.
 * Prioritizes high-accuracy picks while incorporating ML confidence.
 */
function mlWeightedHighestHitRateSortValue(row) {
  const hitRate = parseHitRate(row.hitRate)
  const minutesRiskRank =
    row.minutesRisk === "low" ? 3 :
    row.minutesRisk === "medium" ? 2 :
    row.minutesRisk === "high" ? 1 : 0
  const trendRiskRank =
    row.trendRisk === "low" ? 3 :
    row.trendRisk === "medium" ? 2 :
    row.trendRisk === "high" ? 1 : 0
  const injuryRiskRank =
    row.injuryRisk === "low" ? 3 :
    row.injuryRisk === "medium" ? 2 :
    row.injuryRisk === "high" ? 1 : 0
  
  // Base hit-rate scoring
  const baseScore = (
    hitRate * 1000 +
    Number(row.minFloor || 0) * 2 +
    Number(row.avgMin || 0) * 1.5 -
    Number(row.minStd || 0) * 8 -
    Number(row.valueStd || 0) * 6 +
    minutesRiskRank * 12 +
    trendRiskRank * 10 +
    injuryRiskRank * 10 +
    Number(row.score || 0) * 0.35
  )
  
  // Blend with ML probability (60% hit rate, 40% ML probability)
  const mlProb = mlScorer.scoreRow(row)
  if (mlProb === null) return baseScore
  
  return baseScore * 0.6 + mlProb * 100 * 0.4
}

/**
 * Sort rows by ML-weighted hit rate (hit rate preference + ML probability).
 */
function sortRowsForMLHighestHitRate(rows = []) {
  return [...rows].sort((a, b) => {
    return mlWeightedHighestHitRateSortValue(b) - mlWeightedHighestHitRateSortValue(a)
  })
}

function makeSlipProfiles() {
  // NOTE: /parlays uses makeSlipProfiles() — NOT buildLiveDualBestAvailablePayload
  console.log("[PAYLOAD-DEBUG] ENTER makeSlipProfiles (used by /parlays route)")
  console.log("[PAYLOAD-DEBUG] makeSlipProfiles oddsSnapshot counts:", {
    bestProps: (oddsSnapshot.bestProps || []).length,
    eliteProps: (oddsSnapshot.eliteProps || []).length,
    strongProps: (oddsSnapshot.strongProps || []).length,
    playableProps: (oddsSnapshot.playableProps || []).length
  })
  const primaryRows = (oddsSnapshot.bestProps || [])
  if (!primaryRows.length) return {}
  const elite = (oddsSnapshot.eliteProps || [])
  const strong = (oddsSnapshot.strongProps || [])
  const playable = (oddsSnapshot.playableProps || [])
  const best = (oddsSnapshot.bestProps || [])

  // Use ML-weighted sorting for highest hit rate sources (ML-optimized for maximum win probability)
  const highestHitRateSources = [
    sortRowsForMLHighestHitRate(elite),
    sortRowsForMLHighestHitRate(strong),
    sortRowsForMLHighestHitRate(playable),
    sortRowsForMLHighestHitRate(best)
  ]

  // Best value sources for balanced/lotto strategies
  const bestValueSources = [
    sortRowsForBestValue(elite),
    sortRowsForBestValue(strong),
    sortRowsForBestValue(playable),
    sortRowsForBestValue(best)
  ]

  const profiles = {}

  // Conservative: High hit rate, safe props, 2-4 legs
  const conservativeLegCounts = [2, 3, 4]
  for (const legCount of conservativeLegCounts) {
    const conservativeSlip = buildTierWithFallback(highestHitRateSources, legCount, [
      {
        maxPerPlayer: 1,
        maxPerGame: 2,
        minScore: 85,
        avoidFragile: true,
        forceUniquePlayers: true,
        blockSameGameStatSide: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"] // No PRA for conservative
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 2,
        minScore: 75,
        avoidFragile: true,
        forceUniquePlayers: true,
        blockSameGameStatSide: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 2,
        minScore: 65,
        avoidFragile: false,
        forceUniquePlayers: true,
        blockSameGameStatSide: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      }
    ])

    profiles[`conservative${legCount}`] = conservativeSlip.length === legCount
      ? [...conservativeSlip].sort(
          (a, b) =>
            highestHitRateSortValue(b) - highestHitRateSortValue(a)
        )
      : []
  }

  // Balanced: Mix of hit rate and value, moderate risk, 3-6 legs
  const balancedLegCounts = [3, 4, 5, 6]
  for (const legCount of balancedLegCounts) {
    const balancedSlip = buildTierWithFallback(bestValueSources, legCount, [
      {
        maxPerPlayer: 2,
        maxPerGame: 2,
        minScore: 70,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes", "PRA"] // Include PRA for balanced
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 2,
        minScore: 60,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes", "PRA"]
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 2,
        minScore: 50,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: false,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes", "PRA"]
      }
    ])

    profiles[`balanced${legCount}`] = balancedSlip.length === legCount
      ? [...balancedSlip].sort(
          (a, b) =>
            bestValueSortValue(b) - bestValueSortValue(a)
        )
      : []
  }

  // Lotto: Higher risk/reward, include volatile props, 4-8 legs
  const lottoLegCounts = [4, 5, 6, 7, 8]
  for (const legCount of lottoLegCounts) {
    const lottoSlip = buildTierWithFallback(bestValueSources, legCount, [
      {
        maxPerPlayer: 2,
        maxPerGame: 3,
        minScore: 50,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: false,
        allowedPropTypes: null // Allow all prop types for lotto
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 3,
        minScore: 40,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 3,
        maxPerGame: 4,
        minScore: 30,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 3,
        maxPerGame: 4,
        minScore: 20,
        avoidFragile: false,
        forceUniquePlayers: false,
        blockSameGameStatSide: false,
        allowedPropTypes: null
      }
    ])

    profiles[`lotto${legCount}`] = lottoSlip.length === legCount
      ? [...lottoSlip].sort(
          (a, b) =>
            bestValueSortValue(b) - bestValueSortValue(a)
        )
      : []
  }

  return profiles
}
function buildClosestBookTargetCandidate(book, target, options = {}) {
  const legCounts = [2, 3, 4, 5, 6, 7]
  const candidates = []
  const fallbackCandidates = []
  const { allowUndershoot = false, allowFallbackBelowFloor = false } = options

  for (const legCount of legCounts) {
    const built = buildTargetBookSlip(book, legCount)
    const price = parlayPriceFromLegs(built)

    if (!price) continue
    if (!Array.isArray(built) || built.length !== legCount) continue

    const projectedReturn = estimateReturn(5, price.american)
    if (!projectedReturn) continue

    if (!allowUndershoot && !allowFallbackBelowFloor) {
      if (target >= 1000 && projectedReturn < 800) continue
      if (target >= 500 && projectedReturn < 425) continue
      if (target >= 300 && projectedReturn < 255) continue
      if (target >= 100 && projectedReturn < 90) continue
      if (target >= 50 && projectedReturn < 40) continue
    }

    const trueProbability = Number(trueParlayProbabilityFromLegs(built) || 0)
    const distanceFromTarget = Number(Math.abs(projectedReturn - target).toFixed(2))
    const relativeMiss = distanceFromTarget / Math.max(target, 1)
    const closenessScore = Math.max(0, 1 - relativeMiss)

    const overshoot = projectedReturn > target
    const overshootRatio = overshoot
      ? (projectedReturn - target) / Math.max(target, 1)
      : 0
    const undershootRatio = projectedReturn < target
      ? (target - projectedReturn) / Math.max(target, 1)
      : 0

    const minPreferredPayout =
      target === 50 ? 40 :
      target === 100 ? 90 :
      target === 300 ? 255 :
      target === 500 ? 425 :
      target === 1000 ? 825 : 0

    const maxPreferredPayout =
      target === 50 ? 62 :
      target === 100 ? 125 :
      target === 300 ? 390 :
      target === 500 ? 650 :
      target === 1000 ? 1350 : Infinity

    const isPreferredRange =
      projectedReturn >= minPreferredPayout &&
      projectedReturn <= maxPreferredPayout

    let candidateScore =
      closenessScore * 0.88 +
      trueProbability * 0.12

    if (undershootRatio > 0.2) {
      candidateScore -= 0.9
    } else if (undershootRatio > 0.1) {
      candidateScore -= 0.45
    } else if (undershootRatio > 0.03) {
      candidateScore -= 0.15
    }

    if (overshootRatio > 0.35) {
      candidateScore -= 0.6
    } else if (overshootRatio > 0.2) {
      candidateScore -= 0.28
    } else if (overshootRatio > 0.1) {
      candidateScore -= 0.1
    }

    if (target >= 300 && legCount <= 2) candidateScore -= 0.25
    if (target >= 500 && legCount <= 3) candidateScore -= 0.2
    if (target >= 1000 && legCount <= 4) candidateScore -= 0.15

    candidateScore = Number(candidateScore.toFixed(4))

    const candidate = {
      legCount,
      book,
      targetPayout: target,
      actualPayout: projectedReturn,
      distanceFromTarget,
      trueProbability,
      candidateScore,
      confidence: confidenceFromLegs(built),
      slip: {
        book,
        legs: built,
        price,
        projectedReturn,
        trueProbability,
        confidence: confidenceFromLegs(built)
      },
      isPreferredRange
    }

    fallbackCandidates.push(candidate)
    if (isPreferredRange) candidates.push(candidate)
  }

  const minTargetPayout =
    target >= 1000 ? 800 :
    target >= 500 ? 425 :
    target >= 300 ? 255 :
    target >= 100 ? 90 :
    target >= 50 ? 40 : 0

  const floorFilteredFallbacks = fallbackCandidates.filter(
    (candidate) => Number(candidate.actualPayout || 0) >= minTargetPayout
  )

  const pool = candidates.length
    ? candidates
    : floorFilteredFallbacks.length
      ? floorFilteredFallbacks
      : (allowFallbackBelowFloor ? fallbackCandidates : [])
  if (!pool.length) return null

  pool.sort((a, b) => {
    if (b.candidateScore !== a.candidateScore) return b.candidateScore - a.candidateScore
    if (a.distanceFromTarget !== b.distanceFromTarget) return a.distanceFromTarget - b.distanceFromTarget
    if (b.trueProbability !== a.trueProbability) return b.trueProbability - a.trueProbability

    const confidenceRank = { High: 3, Medium: 2, Low: 1 }
    const aConf = confidenceRank[a.confidence] || 0
    const bConf = confidenceRank[b.confidence] || 0
    if (bConf !== aConf) return bConf - aConf

    return a.legCount - b.legCount
  })

  return pool[0]
}

function buildTargetBookSlip(book, targetLegCount) {
  const elite = ((oddsSnapshot.eliteProps || []).filter((r) => r.book === book))
  const strong = ((oddsSnapshot.strongProps || []).filter((r) => r.book === book))
  const playable = ((oddsSnapshot.playableProps || []).filter((r) => r.book === book))
  const practicalPlayable = playable.filter((row) => isPracticalCoreLeg(row))

  const safeElite = dedupeByLegSignature(elite.filter((row) => isSafeProp(row)))
  const safeStrong = dedupeByLegSignature(strong.filter((row) => isSafeProp(row)))
  const safePracticalPlayable = dedupeByLegSignature(practicalPlayable.filter((row) => isSafeProp(row)))
  const safePlayable = dedupeByLegSignature(playable.filter((row) => isSafeProp(row)))

  const safestSources = safeElite.length || safeStrong.length
    ? [safeElite, safeStrong, safePracticalPlayable, safePlayable]
    : [safePracticalPlayable.length ? safePracticalPlayable : safePlayable]

  if (targetLegCount === 2) {
    return buildTierWithFallback(safestSources, 2, [
      {
        maxPerPlayer: 2,
        maxPerGame: 1,
        preferredBook: book,
        minScore: 100,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 1,
        preferredBook: book,
        minScore: 90,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 1,
        preferredBook: book,
        minScore: 80,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      }
    ])
  }

  if (targetLegCount === 3) {
    return buildTierWithFallback(safestSources, 3, [
      {
        maxPerPlayer: 2,
        maxPerGame: 1,
        preferredBook: book,
        minScore: 95,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 1,
        preferredBook: book,
        minScore: 85,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 1,
        preferredBook: book,
        minScore: 75,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      }
    ])
  }

  if (targetLegCount === 4) {
    return buildTierWithFallback(safestSources, 4, [
      {
        maxPerPlayer: 2,
        maxPerGame: 2,
        preferredBook: book,
        minScore: 85,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 2,
        preferredBook: book,
        minScore: 75,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      },
      {
        maxPerPlayer: 2,
        maxPerGame: 2,
        preferredBook: book,
        minScore: 65,
        avoidFragile: false,
        forceUniquePlayers: false,
        allowedPropTypes: null
      }
    ])
  }

  if (targetLegCount === 5) {
    return buildTierWithFallback([elite, strong, practicalPlayable, playable], 5, [
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 60,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 52,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 45,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 38,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 30,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      }
    ])
  }

  if (targetLegCount === 6) {
    return buildTierWithFallback([elite, strong, practicalPlayable, playable], 6, [
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 55,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 48,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 40,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 34,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 26,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      }
    ])
  }

  if (targetLegCount === 7) {
    return buildTierWithFallback([elite, strong, practicalPlayable, playable], 7, [
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 48,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 40,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 32,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 24,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      },
      {
        maxPerPlayer: 1,
        maxPerGame: 3,
        preferredBook: book,
        minScore: 16,
        avoidFragile: false,
        forceUniquePlayers: true,
        allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
      }
    ])
  }

  return buildTierWithFallback([elite, strong, practicalPlayable, playable], 8, [
    {
      maxPerPlayer: 1,
      maxPerGame: 3,
      preferredBook: book,
      minScore: 42,
      avoidFragile: false,
      forceUniquePlayers: true,
      allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
    },
    {
      maxPerPlayer: 1,
      maxPerGame: 3,
      preferredBook: book,
      minScore: 34,
      avoidFragile: false,
      forceUniquePlayers: true,
      allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
    },
    {
      maxPerPlayer: 1,
      maxPerGame: 3,
      preferredBook: book,
      minScore: 26,
      avoidFragile: false,
      forceUniquePlayers: true,
      allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
    },
    {
      maxPerPlayer: 1,
      maxPerGame: 3,
      preferredBook: book,
      minScore: 18,
      avoidFragile: false,
      forceUniquePlayers: true,
      allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
    },
    {
      maxPerPlayer: 1,
      maxPerGame: 3,
      preferredBook: book,
      minScore: 10,
      avoidFragile: false,
      forceUniquePlayers: true,
      allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
    }
  ])
}



function buildSafestBookSlip(book, targetLegCount) {
  const elite = ((oddsSnapshot.eliteProps || []).filter((r) => r.book === book))
  const strong = ((oddsSnapshot.strongProps || []).filter((r) => r.book === book))
  const playable = ((oddsSnapshot.playableProps || []).filter((r) => r.book === book))

  const safeElite = dedupeByLegSignature(elite.filter((row) => isSafeProp(row)))
  const safeStrong = dedupeByLegSignature(strong.filter((row) => isSafeProp(row)))
  const safePlayable = dedupeByLegSignature(playable.filter((row) => isSafeProp(row)))

  const allSafeRows = dedupeByLegSignature([
    ...safeElite,
    ...safeStrong,
    ...safePlayable
  ])

  const strictSources = safeElite.length || safeStrong.length
    ? [safeElite, safeStrong, safePlayable]
    : [safePlayable]

  const relaxedSources = safeElite.length || safeStrong.length
    ? [safeElite, safeStrong, safePlayable, allSafeRows]
    : [allSafeRows]

  const strictStrategy = {
    maxPerPlayer: 1,
    maxPerGame: 1,
    preferredBook: book,
    avoidFragile: true,
    forceUniquePlayers: true,
    allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
  }

  const relaxedStrategy = {
    maxPerPlayer: 1,
    maxPerGame: targetLegCount <= 3 ? 1 : 2,
    preferredBook: book,
    avoidFragile: false,
    forceUniquePlayers: true,
    blockSameGameStatSide: true,
    allowedPropTypes: ["Points", "Rebounds", "Assists", "Threes"]
  }

  const buildStrictest = (count) => {
    if (count === 2) {
      return buildTierWithFallback(strictSources, 2, [
        { ...strictStrategy, minScore: 95 },
        { ...strictStrategy, minScore: 85 },
        { ...strictStrategy, minScore: 75 }
      ])
    }

    if (count === 3) {
      return buildTierWithFallback(strictSources, 3, [
        { ...strictStrategy, minScore: 88 },
        { ...strictStrategy, minScore: 80 },
        { ...strictStrategy, minScore: 72 },
        { ...strictStrategy, minScore: 68 }
      ])
    }

    if (count === 4) {
      return buildTierWithFallback(strictSources, 4, [
        { ...strictStrategy, minScore: 84 },
        { ...strictStrategy, minScore: 76 },
        { ...strictStrategy, minScore: 68 },
        { ...strictStrategy, minScore: 62 }
      ])
    }

    if (count === 5) {
      return buildTierWithFallback(strictSources, 5, [
        { ...strictStrategy, minScore: 78 },
        { ...strictStrategy, minScore: 72 },
        { ...strictStrategy, minScore: 66 },
        { ...strictStrategy, minScore: 60 }
      ])
    }

    if (count === 6) {
      return buildTierWithFallback(strictSources, 6, [
        { ...strictStrategy, minScore: 74 },
        { ...strictStrategy, minScore: 68 },
        { ...strictStrategy, minScore: 62 },
        { ...strictStrategy, minScore: 56 }
      ])
    }

    if (count === 7) {
      return buildTierWithFallback(strictSources, 7, [
        { ...strictStrategy, minScore: 70 },
        { ...strictStrategy, minScore: 64 },
        { ...strictStrategy, minScore: 58 },
        { ...strictStrategy, minScore: 52 }
      ])
    }

    if (count === 8) {
      return buildTierWithFallback(strictSources, 8, [
        { ...strictStrategy, minScore: 66 },
        { ...strictStrategy, minScore: 60 },
        { ...strictStrategy, minScore: 54 },
        { ...strictStrategy, minScore: 50 }
      ])
    }

    if (count === 9) {
      return buildTierWithFallback(strictSources, 9, [
        { ...strictStrategy, minScore: 62 },
        { ...strictStrategy, minScore: 56 },
        { ...strictStrategy, minScore: 50 },
        { ...strictStrategy, minScore: 46 }
      ])
    }

    return buildTierWithFallback(strictSources, 10, [
      { ...strictStrategy, minScore: 58 },
      { ...strictStrategy, minScore: 52 },
      { ...strictStrategy, minScore: 46 },
      { ...strictStrategy, minScore: 42 }
    ])
  }

  const buildRelaxed = (count) => {
    if (count === 2) {
      return buildTierWithFallback(relaxedSources, 2, [
        { ...relaxedStrategy, minScore: 90 },
        { ...relaxedStrategy, minScore: 82 },
        { ...relaxedStrategy, minScore: 74 },
        { ...relaxedStrategy, minScore: 66 }
      ])
    }

    if (count === 3) {
      return buildTierWithFallback(relaxedSources, 3, [
        {
          ...relaxedStrategy,
          maxPerGame: 2,
          minScore: 90,
          avoidFragile: true,
          blockSameGameStatSide: true
        },
        {
          ...relaxedStrategy,
          maxPerGame: 2,
          minScore: 84,
          avoidFragile: true,
          blockSameGameStatSide: true
        },
        {
          ...relaxedStrategy,
          maxPerGame: 2,
          minScore: 78,
          avoidFragile: false,
          blockSameGameStatSide: true
        },
        {
          ...relaxedStrategy,
          maxPerGame: 2,
          minScore: 72,
          avoidFragile: false,
          blockSameGameStatSide: true
        }
      ])
    }

    if (count === 4) {
      return buildTierWithFallback(relaxedSources, 4, [
        { ...relaxedStrategy, minScore: 78 },
        { ...relaxedStrategy, minScore: 72 },
        { ...relaxedStrategy, minScore: 66 },
        { ...relaxedStrategy, minScore: 60 }
      ])
    }

    if (count === 5) {
      return buildTierWithFallback(relaxedSources, 5, [
        { ...relaxedStrategy, minScore: 74 },
        { ...relaxedStrategy, minScore: 68 },
        { ...relaxedStrategy, minScore: 62 },
        { ...relaxedStrategy, minScore: 56 },
        { ...relaxedStrategy, minScore: 50 }
      ])
    }

    if (count === 6) {
      return buildTierWithFallback(relaxedSources, 6, [
        { ...relaxedStrategy, minScore: 70 },
        { ...relaxedStrategy, minScore: 64 },
        { ...relaxedStrategy, minScore: 58 },
        { ...relaxedStrategy, minScore: 52 },
        { ...relaxedStrategy, minScore: 46 }
      ])
    }

    if (count === 7) {
      return buildTierWithFallback(relaxedSources, 7, [
        { ...relaxedStrategy, minScore: 66 },
        { ...relaxedStrategy, minScore: 60 },
        { ...relaxedStrategy, minScore: 54 },
        { ...relaxedStrategy, minScore: 48 },
        { ...relaxedStrategy, minScore: 42 }
      ])
    }

    if (count === 8) {
      return buildTierWithFallback(relaxedSources, 8, [
        { ...relaxedStrategy, minScore: 62 },
        { ...relaxedStrategy, minScore: 56 },
        { ...relaxedStrategy, minScore: 50 },
        { ...relaxedStrategy, minScore: 44 },
        { ...relaxedStrategy, minScore: 38 }
      ])
    }

    if (count === 9) {
      return buildTierWithFallback(relaxedSources, 9, [
        { ...relaxedStrategy, minScore: 58 },
        { ...relaxedStrategy, minScore: 52 },
        { ...relaxedStrategy, minScore: 46 },
        { ...relaxedStrategy, minScore: 40 },
        { ...relaxedStrategy, minScore: 34 }
      ])
    }

    return buildTierWithFallback(relaxedSources, 10, [
      { ...relaxedStrategy, minScore: 54 },
      { ...relaxedStrategy, minScore: 48 },
      { ...relaxedStrategy, minScore: 42 },
      { ...relaxedStrategy, minScore: 36 },
      { ...relaxedStrategy, minScore: 30 }
    ])
  }

  const strictSlip = buildStrictest(targetLegCount)
  if (strictSlip.length === targetLegCount) return strictSlip

  const relaxedSlip = buildRelaxed(targetLegCount)
  if (relaxedSlip.length === targetLegCount) return relaxedSlip

  if (targetLegCount <= 3) return []
  return []
}

// Helper to validate slip objects before returning them
function isValidSlipObject(slip, expectedLegCount = null) {
  if (!slip) return false
  
  // Check basic structure
  if (!Array.isArray(slip.legs) || slip.legs.length === 0) return false
  if (!Number.isFinite(slip.projectedReturn)) return false
  if (!slip.price || !Number.isFinite(slip.price.american)) return false
  
  // Never allow 1-leg slips as parlay targets
  if (slip.legs.length === 1) return false
  
  // Check expected leg count if provided
  if (expectedLegCount && slip.legs.length !== expectedLegCount) return false
  
  return true
}

function getTargetLegCountFromLabel(labelPrefix = "") {
  const match = String(labelPrefix || "").match(/(\d+)-Leg/i)
  return match ? Number(match[1]) : null
}

function makeSlipObject(book, legs, labelPrefix) {
  const targetLegCount = getTargetLegCountFromLabel(labelPrefix)
  const accepted = Array.isArray(legs) && legs.length >= 2 && (!targetLegCount || legs.length === targetLegCount)
  console.log("[RECOVERY-SLIP-DEBUG]", { book, label: labelPrefix, targetLegCount, rawLen: Array.isArray(legs) ? legs.length : 0, accepted })
  if (!accepted) return null

  const price = parlayPriceFromLegs(legs)
  if (!price) return null

  const projectedReturn = estimateReturn(5, price.american)
  const trueProbability = trueParlayProbabilityFromLegs(legs)
  const confidence = confidenceFromLegs(legs)

  const slip = {
    book,
    legs,
    price,
    projectedReturn,
    trueProbability,
    confidence,
    label: formatPayoutLabel(`${book} ${labelPrefix}`, projectedReturn)
  }
  
  // Validate before returning
  if (!isValidSlipObject(slip, targetLegCount)) {
    return null
  }
  
  return slip
}


function buildAnyBookSlip(targetLegCount) {
  const elite = (oddsSnapshot.eliteProps || [])
  const strong = (oddsSnapshot.strongProps || [])
  const playable = (oddsSnapshot.playableProps || [])

  if (targetLegCount <= 2) {
    return buildTieredSlip([elite, strong], targetLegCount, {
      maxPerPlayer: 1,
      maxPerGame: 1
    })
  }

  if (targetLegCount <= 4) {
    return buildTieredSlip([elite, strong, playable], targetLegCount, {
      maxPerPlayer: 1,
      maxPerGame: 2
    })
  }

  return buildTieredSlip([elite, strong, playable], targetLegCount, {
    maxPerPlayer: 1,
    maxPerGame: 2
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function impliedProbabilityFromAmerican(americanOdds) {
  const odds = Number(americanOdds)
  if (!Number.isFinite(odds)) return null
  if (odds > 0) return 100 / (odds + 100)
  return Math.abs(odds) / (Math.abs(odds) + 100)
}

function estimateLegTrueProbability(row) {
  const hitRate = parseHitRate(row.hitRate)
  const edge = Number(row.edge || 0)
  const minStd = Number(row.minStd || 0)
  const valueStd = Number(row.valueStd || 0)
  const minFloor = Number(row.minFloor || 0)
  const avgMin = Number(row.avgMin || 0)
  const score = Number(row.score || 0)
  const marketProb = impliedProbabilityFromAmerican(row.odds)

  let prob = hitRate || 0.5

  if (marketProb !== null) {
    prob = prob * 0.75 + marketProb * 0.25
  }

  if (edge >= 3) prob += 0.05
  else if (edge >= 2) prob += 0.03
  else if (edge < 1) prob -= 0.04

  if (avgMin >= 32) prob += 0.02
  else if (avgMin < 28) prob -= 0.04

  if (minFloor >= 28) prob += 0.03
  else if (minFloor > 0 && minFloor < 18) prob -= 0.08

  if (minStd >= 8) prob -= 0.05
  else if (minStd >= 6.5) prob -= 0.03

  if (valueStd >= 8) prob -= 0.05
  else if (valueStd >= 6) prob -= 0.03

  if (isTrendBadForLeg(row)) prob -= 0.05
  if (isFragileLeg(row)) prob -= 0.06

  if (score >= 110) prob += 0.04
  else if (score >= 95) prob += 0.025
  else if (score < 70) prob -= 0.04

  return clamp(Number(prob.toFixed(4)), 0.05, 0.95)
}


function getSameGameCorrelationPenalty(legs) {
  if (!Array.isArray(legs) || legs.length <= 1) return 0

  const matchupGroups = new Map()

  for (const leg of legs) {
    const matchup = String(leg.matchup || "")
    if (!matchup) continue
    if (!matchupGroups.has(matchup)) matchupGroups.set(matchup, [])
    matchupGroups.get(matchup).push(leg)
  }

  let penalty = 0

  for (const group of matchupGroups.values()) {
    if (group.length <= 1) continue

    penalty += 0.05 * (group.length - 1)

    const overs = group.filter((leg) => leg.side === "Over")
    const unders = group.filter((leg) => leg.side === "Under")

    if (overs.length >= 2) penalty += 0.02
    if (unders.length >= 2) penalty += 0.015

    const playerCounts = new Map()
    for (const leg of group) {
      playerCounts.set(leg.player, (playerCounts.get(leg.player) || 0) + 1)
    }

    for (const count of playerCounts.values()) {
      if (count > 1) penalty += 0.08 * (count - 1)
    }

    const statTypeCounts = new Map()
    for (const leg of group) {
      const key = `${leg.side}-${leg.propType}`
      statTypeCounts.set(key, (statTypeCounts.get(key) || 0) + 1)
    }

    for (const count of statTypeCounts.values()) {
      if (count > 1) penalty += 0.025 * (count - 1)
    }
  }

  return clamp(Number(penalty.toFixed(4)), 0, 0.35)
}

function getSameGameConfidencePenalty(legs) {
  if (!Array.isArray(legs) || legs.length <= 1) return 0

  const matchupCounts = new Map()
  for (const leg of legs) {
    const matchup = String(leg.matchup || "")
    if (!matchup) continue
    matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
  }

  let penalty = 0
  for (const count of matchupCounts.values()) {
    if (count > 1) penalty += (count - 1) * 6
  }

  return penalty
}

function trueParlayProbabilityFromLegs(legs) {
  if (!legs.length) return 0

  const baseProduct = legs.reduce((acc, leg) => {
    return acc * estimateLegTrueProbability(leg)
  }, 1)

  const correlationPenalty = getSameGameCorrelationPenalty(legs)
  const adjusted = baseProduct * (1 - correlationPenalty)

  return clamp(Number(adjusted.toFixed(4)), 0, 1)
}

function americanToDecimal(americanOdds) {
  const odds = Number(americanOdds)
  if (Number.isNaN(odds)) return null
  if (odds > 0) return 1 + odds / 100
  return 1 + 100 / Math.abs(odds)
}

function decimalToAmerican(decimalOdds) {
  const dec = Number(decimalOdds)
  if (!dec || dec <= 1) return null
  if (dec >= 2) return Math.round((dec - 1) * 100)
  return Math.round(-100 / (dec - 1))
}

function parlayPriceFromLegs(legs) {
  const decimals = legs
    .map((leg) => americanToDecimal(leg.odds))
    .filter((v) => v !== null)

  if (!decimals.length) return null

  const combinedDecimal = decimals.reduce((acc, v) => acc * v, 1)
  const combinedAmerican = decimalToAmerican(combinedDecimal)

  return {
    decimal: Number(combinedDecimal.toFixed(3)),
    american: combinedAmerican
  }
}

function estimateReturn(stake, americanOdds) {
  const dec = americanToDecimal(americanOdds)
  if (!dec) return null
  return Number((stake * dec).toFixed(2))
}

function formatPayoutLabel(baseLabel, payout) {
  const value = Number(payout || 0)
  if (!value) return baseLabel
  return `${baseLabel} ($${value.toFixed(2)})`
}

function addSlipLabel(baseLabel, slip) {
  if (!slip) return null
  return {
    ...slip,
    label: formatPayoutLabel(baseLabel, slip.projectedReturn)
  }
}

function confidenceFromLegs(legs) {
  if (!legs.length) return "Low"

  const avgScore = avg(legs.map((leg) => Number(leg.score || 0))) || 0
  const avgHitRate = avg(legs.map((leg) => parseHitRate(leg.hitRate))) || 0
  const avgEdge = avg(legs.map((leg) => Number(leg.edge || 0))) || 0
  const avgMinFloor = avg(
    legs.map((leg) => Number(leg.minFloor || 0)).filter((v) => v > 0)
  ) || 0
  const avgMinStd = avg(
    legs.map((leg) => Number(leg.minStd || 0)).filter((v) => v > 0)
  ) || 0
  const avgValueStd = avg(
    legs.map((leg) => Number(leg.valueStd || 0)).filter((v) => v > 0)
  ) || 0

  const trueProb = trueParlayProbabilityFromLegs(legs)

  let confidenceScore = 0

  confidenceScore += avgScore * 0.25
  confidenceScore += avgHitRate * 100 * 0.35
  confidenceScore += avgEdge * 4
  confidenceScore += trueProb * 100 * 0.6

  if (avgMinFloor >= 28) confidenceScore += 8
  else if (avgMinFloor >= 24) confidenceScore += 5
  else if (avgMinFloor >= 20) confidenceScore += 2
  else confidenceScore -= 4

  if (avgMinStd <= 4.5) confidenceScore += 8
  else if (avgMinStd <= 6) confidenceScore += 5
  else if (avgMinStd <= 7.5) confidenceScore += 2
  else if (avgMinStd >= 9) confidenceScore -= 8
  else confidenceScore -= 3

  if (avgValueStd <= 2.5) confidenceScore += 6
  else if (avgValueStd <= 4) confidenceScore += 3
  else if (avgValueStd <= 6) confidenceScore += 1
  else if (avgValueStd >= 8) confidenceScore -= 6
  else confidenceScore -= 2

  if (legs.length === 2) confidenceScore += 10
  else if (legs.length === 3) confidenceScore += 6
  else if (legs.length === 4) confidenceScore += 2
  else if (legs.length === 5) confidenceScore -= 3
  else if (legs.length === 6) confidenceScore -= 8
  else if (legs.length >= 7) confidenceScore -= 12
  confidenceScore -= getSameGameConfidencePenalty(legs)

  if (trueProb >= 0.5) confidenceScore += 12
  else if (trueProb >= 0.35) confidenceScore += 7
  else if (trueProb >= 0.22) confidenceScore += 3
  else if (trueProb < 0.12) confidenceScore -= 10

  const mediumThreshold =
    legs.length <= 3 ? 60 :
    legs.length === 4 ? 66 :
    legs.length === 5 ? 72 :
    78

  const highThreshold =
    legs.length <= 3 ? 88 :
    legs.length === 4 ? 94 :
    legs.length === 5 ? 100 :
    108

  if (confidenceScore >= highThreshold) return "High"
  if (confidenceScore >= mediumThreshold) return "Medium"
  return "Low"
}

function compareDistance(a, b, target) {
  return Math.abs(a - target) - Math.abs(b - target)
}

async function fetchApiSportsPlayerId(playerName, expectedTeamCodes = []) {
  if (playerIdCache.has(playerName)) {
    const cached = playerIdCache.get(playerName)
    const expectedSet = new Set(
      (expectedTeamCodes || [])
        .map((code) => String(code || "").toUpperCase().trim())
        .filter(Boolean)
    )

    if (!cached) return cached

    const cachedTeamCode = String(
      getTeamOverride(playerName) || teamAbbr(cached.team || "")
    ).toUpperCase().trim()

    if (!expectedSet.size || !cachedTeamCode || expectedSet.has(cachedTeamCode)) {
      return cached
    }

    playerIdCache.delete(playerName)
  }
  if (playerLookupMissCache.has(playerName)) {
    playerLookupMissCache.delete(playerName)
  }
  const manualOverride = MANUAL_PLAYER_OVERRIDES[playerName]
  if (manualOverride) {
    const manualResult = {
      ...manualOverride,
      matchedName: playerName,
      requestedName: playerName
    }
    console.log("API-Sports MANUAL OVERRIDE:", playerName, "=>", manualOverride.team, "| id:", manualOverride.id)
    playerIdCache.set(playerName, manualResult)
    saveApiSportsCachesToDisk().catch((err) => console.error('Failed saving API-Sports cache:', err?.message || err))
    return manualResult
  }
  const rawName = String(getPlayerSearchOverride(playerName) || "").trim()
  if (!rawName) return null

  const searchOverride = getPlayerSearchOverride(playerName)
  const forceLastNameOnlyPlayers = new Set([
    "Paolo Banchero",
    "James Harden",
    "Donovan Mitchell",
    "Jalen Suggs",
    "Evan Mobley",
    "Keon Ellis",
    "Sam Merrill",
    "Jaylon Tyson",
    "Wendell Carter Jr",
    "R.J. Barrett",
    "Zion Williamson",
    "Dejounte Murray",
    "Brandon Ingram",
    "Scottie Barnes",
    "Immanuel Quickley",
    "Jakob Poeltl",
    "Saddiq Bey",
    "Derik Queen",
    "Herb Jones",
    "Keyonte George",
    "Karl-Anthony Towns",
    "Mikal Bridges",
    "Jalen Brunson",
    "Landry Shamet",
    "Cody Williams",
    "Kyle Filipowski",
    "OG Anunoby",
    "Brice Sensabaugh",
    "Mitchell Robinson",
    "Brandon Miller",
    "DeMar DeRozan",
    "Coby White",
    "LaMelo Ball",
    "Russell Westbrook",
    "Moussa Diabate",
    "Miles Bridges",
    "Precious Achiuwa",
    "Reed Sheppard",
    "Nikola Jokic",
    "Alperen Sengun",
    "Amen Thompson",
    "Jamal Murray",
    "Tari Eason",
    "Aaron Gordon",
    "Christian Braun",
    "Bruce Brown",
    "Anthony Edwards",
    "Kris Dunn",
    "Donte DiVincenzo",
    "Kawhi Leonard",
    "Darius Garland",
    "Julius Randle",
    "Ayo Dosunmu",
    "Rudy Gobert",
    "Brook Lopez",
    "Naz Reid",
    "Bennedict Mathurin",
    "Jaden McDaniels",
    "Isaiah Jackson"
  ])

  let searches = []

  if (forceLastNameOnlyPlayers.has(playerName)) {
    const lastName = rawName.split(/\s+/).pop()
    if (lastName) searches = [lastName]
  } else if (searchOverride && searchOverride !== playerName) {
    searches = getPlayerSearchVariants(playerName)
  } else {
    const variants = getPlayerSearchVariants(playerName)
    const exactFirst = variants.find((search) => search === rawName)
    const rest = variants.filter((search) => search !== rawName)
    searches = exactFirst ? [exactFirst, ...rest] : variants
  }

  const attempts = searches.map((search) => ({
    endpoint: "nba-v2",
    url: "https://v2.nba.api-sports.io/players",
    search,
    label: `search=${search}`
  }))

  let rows = []
  let matchedAttempt = null
  let matchedEndpoint = null

  for (const attempt of attempts) {
    try {
      const response = await axios.get(attempt.url, {
        params: { search: attempt.search },
        headers: {
          "x-apisports-key": API_SPORTS_KEY
        },
        timeout: API_SPORTS_TIMEOUT_MS
      })

      const found = response.data?.response || []
      console.log(
        "API-Sports lookup:",
        playerName,
        "| endpoint:", attempt.endpoint,
        "| attempt:", attempt.label,
        "| results:", found.length
      )

      if (found.length) {
        rows = found
        matchedAttempt = attempt.label
        matchedEndpoint = attempt.endpoint
        break
      }
    } catch (error) {
      console.error(
        "API-Sports player search failed for",
        playerName,
        "| endpoint:", attempt.endpoint,
        "| attempt:", attempt.label,
        "|",
        error.response?.data || error.message
      )
    }
  }

  if (!rows.length) {
    console.log("API-Sports NO MATCH:", playerName)
    saveApiSportsCachesToDisk().catch((err) => console.error('Failed saving API-Sports cache:', err?.message || err))
    return null
  }

  const reasonableMatches = rows.filter((p) =>
    isReasonablePlayerMatch(playerName, p, expectedTeamCodes)
  )

  let player = null

  if (expectedTeamCodes.length) {
    const expectedSet = new Set(
      expectedTeamCodes
        .map((code) => String(code || "").toUpperCase().trim())
        .filter(Boolean)
    )

    player = reasonableMatches.find((p) => expectedSet.has(getApiPlayerTeamCode(p))) || null
  }

  if (!player && reasonableMatches.length === 1) {
    player = reasonableMatches[0]
  }

  if (!player) {
    console.log("API-Sports SAFE NO MATCH:", playerName)
    saveApiSportsCachesToDisk()
    return null
  }

  const matchedName = getApiPlayerCandidateNames(player)[0] || `${player.firstname || ""} ${player.lastname || ""}`.trim()

  console.log(
    "API-Sports MATCH:",
    playerName,
    "=>",
    matchedName,
    "| endpoint:", matchedEndpoint,
    "| attempt:", matchedAttempt
  )

  const result = {
    id: player.id,
    team: player?.team?.name || player?.team?.nickname || "",
    matchedName,
    requestedName: playerName
  }

  playerIdCache.set(playerName, result)
  saveApiSportsCachesToDisk().catch((err) => console.error('Failed saving API-Sports cache:', err?.message || err))

  return result
}
async function fetchApiSportsPlayerStats(playerId) {
  const response = await axios.get(
    "https://v2.nba.api-sports.io/players/statistics",
    {
      params: {
        id: playerId,
        season: 2025
      },
      headers: {
        "x-apisports-key": API_SPORTS_KEY
      },
      timeout: API_SPORTS_TIMEOUT_MS
    }
  )

  return response.data?.response || []
}

async function fetchApiSportsPlayerIdCached(playerName, expectedTeamCodes = []) {
  if (playerIdCache.has(playerName)) {
    const cached = playerIdCache.get(playerName)
    const expectedSet = new Set(
      (expectedTeamCodes || [])
        .map((code) => String(code || "").toUpperCase().trim())
        .filter(Boolean)
    )

    if (!cached) return cached

    const cachedTeamCode = String(
      getTeamOverride(playerName) || teamAbbr(cached.team || "")
    ).toUpperCase().trim()

    if (!expectedSet.size || !cachedTeamCode || expectedSet.has(cachedTeamCode)) {
      return cached
    }

    playerIdCache.delete(playerName)
  }

  const playerInfo = await fetchApiSportsPlayerId(playerName, expectedTeamCodes)
  playerIdCache.set(playerName, playerInfo)
  return playerInfo
}

async function fetchApiSportsPlayerStatsCached(playerId) {
  const now = Date.now()
  const cachedAt = playerStatsCacheTimes.get(playerId)

  if (
    playerStatsCache.has(playerId) &&
    cachedAt &&
    now - cachedAt < PLAYER_STATS_TTL_MS
  ) {
    return playerStatsCache.get(playerId)
  }

  const stats = await fetchApiSportsPlayerStats(playerId)
  playerStatsCache.set(playerId, stats)
  playerStatsCacheTimes.set(playerId, now)
  saveApiSportsCachesToDisk().catch((err) => console.error('Failed saving API-Sports cache:', err?.message || err))
  return stats
}

function isTrendBadForLeg(row) {
  const line = Number(row.line || 0)
  const recent3 = Number(row.recent3Avg || 0)
  const recent5 = Number(row.recent5Avg || 0)

  if (!line) return false

  if (row.side === "Under") {
    if (recent3 >= line) return true
    if (recent5 >= line && recent3 >= line - 0.3) return true
  }

  if (row.side === "Over") {
    if (recent3 <= line) return true
    if (recent5 <= line && recent3 <= line + 0.3) return true
  }

  return false
}

function isPracticalCoreLeg(row) {
  if (!row) return false

  const propType = String(row.propType || "")
  const side = String(row.side || "")
  const line = Number(row.line || 0)
  const avgMin = Number(row.avgMin || 0)
  const minFloor = Number(row.minFloor || 0)
  const odds = Number(row.odds || 0)
  const hitRate = parseHitRate(row.hitRate)

  if (!["Points", "Rebounds", "Assists", "Threes"].includes(propType)) return false
  if (avgMin < 28) return false
  if (minFloor > 0 && minFloor < 18) return false
  if (hitRate < 0.7) return false
  if (odds < -190) return false
  if (isFragileLeg(row)) return false

  if (propType === "Assists" && side === "Over" && line <= 2.5) return false
  if (propType === "Assists" && side === "Under" && line <= 3.5) return false
  if (propType === "Rebounds" && side === "Under" && line <= 5.5) return false
  if (propType === "Threes" && side === "Under" && line <= 1.5) return false

  return true
}

function samePlayerInSlip(existingLegs, candidate) {
  return existingLegs.some((leg) => leg.player === candidate.player)
}

function isSafeProp(row) {
  if (!row) return false

  const hit = parseHitRate(row.hitRate)
  const minStd = Number(row.minStd || 0)
  const valueStd = Number(row.valueStd || 0)
  const avgMin = Number(row.avgMin || 0)
  const minFloor = Number(row.minFloor || 0)
  const minutesRisk = String(row.minutesRisk || "")
  const trendRisk = String(row.trendRisk || "")
  const injuryRisk = String(row.injuryRisk || "")
  const propType = String(row.propType || "")
  const side = String(row.side || "")
  const line = Number(row.line || 0)

  if (!["Points", "Rebounds", "Assists", "Threes"].includes(propType)) return false
  if (hit < 0.7) return false
  if (minutesRisk === "high") return false
  if (trendRisk === "high") return false
  if (injuryRisk !== "low") return false
  if (avgMin < 26) return false
  if (minFloor > 0 && minFloor < 16) return false
  if (valueStd > 7) return false
  if (minStd > 6.5) return false
  if (isFragileLeg(row)) return false

  if (propType === "PRA") return false
  if (propType === "Threes" && side === "Over" && line >= 3.5) return false
  if (propType === "Points" && side === "Over" && line >= 24.5) return false
  if (propType === "Assists" && side === "Over" && line >= 8.5) return false
  if (propType === "Rebounds" && side === "Over" && line >= 11.5) return false

  return true
}

function dedupeByEventId(rows = []) {
  const seen = new Set()
  const out = []

  for (const row of rows) {
    const eventId = String(row?.eventId || "")
    if (!eventId) continue
    if (seen.has(eventId)) continue
    seen.add(eventId)
    out.push(row)
  }

  return out
}

function dedupeByLegSignature(rows = []) {
  const seen = new Set()
  const out = []

  for (const row of rows) {
    const key = [
      row?.eventId,
      row?.book,
      row?.player,
      row?.propType,
      row?.side,
      Number(row?.line),
      row?.propVariant || "base"
    ].join("|")

    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out
}

function getIngestRejectReason(row) {
  if (!row) return "invalid_row"

  const player = String(row.player || "").trim()
  const side = String(row.side || "").trim()
  const propType = String(row.propType || "").trim()
  const book = String(row.book || "").trim()
  const matchup = String(row.matchup || "").trim()
  const gameTime = String(row.gameTime || "").trim()
  const line = Number(row.line)
  const odds = Number(row.odds)
  const marketFamily = String(row.marketFamily || "").trim()

  if (!player || !propType || !book || !matchup || !gameTime) return "missing_required_fields"
  if (!Number.isFinite(odds)) return "invalid_odds"

  const isLadder = marketFamily === "ladder"
  const isSpecial = marketFamily === "special"

  // Standard markets require Over/Under side and a finite line
  if (!isLadder && !isSpecial) {
    if (!side) return "missing_required_fields"
    if (side !== "Over" && side !== "Under") return "invalid_side"
    if (!Number.isFinite(line)) return "invalid_line"
  }

  // Ladder markets: do not reject solely for missing/invalid line.
  // Only reject if both side and line are unusable for ladder handling.
  if (isLadder) {
    const hasUsableSide = side === "Over" || side === "Under" || side === "Yes" || side === "No"
    const hasUsableLine = Number.isFinite(line)
    if (!hasUsableSide && !hasUsableLine) return "ladder_unusable_missing_side_and_line"
  }

  // Special markets (first basket, double-double, triple-double) do NOT require a numeric line or Over/Under side

  const standardPropTypes = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
  const ladderPropTypes = new Set(["Points Ladder", "Rebounds Ladder", "Assists Ladder", "Threes Ladder", "PRA Ladder"])
  const specialPropTypes = new Set(["First Basket", "First Team Basket", "Double Double", "Triple Double"])
  const allAllowedPropTypes = new Set([...standardPropTypes, ...ladderPropTypes, ...specialPropTypes])
  if (!allAllowedPropTypes.has(propType)) return "invalid_prop_type"

  // Special markets (first basket etc.) have much higher odds (+500 to +5000), widen range
  if (isSpecial) {
    if (odds < -1000 || odds > 10000) return "odds_out_of_range"
  } else if (isLadder) {
    if (odds < -1000 || odds > 10000) return "odds_out_of_range"
  } else {
    if (odds < -350 || odds > 400) return "odds_out_of_range"
  }
  if (Number.isFinite(line) && line < 0) return "line_below_zero"

  return null
}

function shouldRejectRow(row) {
  return Boolean(getIngestRejectReason(row))
}

async function buildExtraMarketRowsForEvents({ scheduledEvents, oddsApiKey, normalizeEventRows }) {
  console.log("[DK-EXTRA-MARKETS-REQUEST-DEBUG]", {
    requestedMarkets: DK_EXTRA_MARKETS,
    scheduledEvents: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
  })

  const safeEvents = Array.isArray(scheduledEvents) ? scheduledEvents : []
  const extraRawRows = []
  const extraEvents = []

  for (const event of safeEvents) {
    const eventId = String(event?.id || event?.eventId || "").trim()
    if (!eventId) continue

    try {
      const extraResponse = await axios.get(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds`, {
        params: {
          apiKey: oddsApiKey,
          regions: "us",
          bookmakers: "draftkings",
          markets: DK_EXTRA_MARKETS.join(","),
          oddsFormat: "american"
        },
        timeout: 15000
      })

      const eventPayload = extraResponse?.data || null

      console.log("[DK-EVENT-FETCH-RESPONSE-DEBUG]", {
        eventId: event?.id || event?.eventId || null,
        matchup: `${event?.away_team || event?.awayTeam || "?"} @ ${event?.home_team || event?.homeTeam || "?"}`,
        responseType: Array.isArray(eventPayload) ? "array" : typeof eventPayload,
        hasResponse: Boolean(eventPayload),
        topLevelKeys: eventPayload && typeof eventPayload === "object" && !Array.isArray(eventPayload)
          ? Object.keys(eventPayload).slice(0, 20)
          : [],
        bookmakerCount: Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers.length : 0,
        bookmakerKeys: Array.isArray(eventPayload?.bookmakers)
          ? eventPayload.bookmakers.map((b) => ({
              key: b?.key || null,
              title: b?.title || null,
              marketCount: Array.isArray(b?.markets) ? b.markets.length : 0,
              sampleMarketKeys: Array.isArray(b?.markets)
                ? b.markets.slice(0, 10).map((m) => m?.key || m?.name || null)
                : []
            }))
          : []
      })

      if (!eventPayload) continue
      extraEvents.push(eventPayload)

      const eventRows = normalizeEventRows(eventPayload, event) || []
      if (Array.isArray(eventRows) && eventRows.length > 0) {
        extraRawRows.push(...eventRows)
      }
    } catch (error) {
      console.log("[DK-EXTRA-MARKETS-ERROR-DEBUG]", {
        eventId,
        matchup: getEventMatchupForDebug(event),
        message: error?.message || String(error)
      })
    }
  }

  console.log("[DK-EXTRA-MARKETS-RESULT-DEBUG]", {
    eventCount: extraEvents.length,
    rawRowCount: extraRawRows.length,
    marketKeys: [...new Set(extraRawRows.map((row) => String(row?.marketKey || "")).filter(Boolean))].sort(),
    byFamily: summarizeInterestingNormalizedRows(extraRawRows).byFamily,
    byPropType: summarizeInterestingNormalizedRows(extraRawRows).byPropType
  })

  return extraRawRows
}

async function fetchEventPlayerPropsWithCoverage(event, previousOpenMap, options = {}) {
  const pathLabel = String(options.pathLabel || "unknown")
  const matchup = buildMatchup(event?.away_team, event?.home_team)
  const away = event?.away_team || event?.awayTeam || ""
  const home = event?.home_team || event?.homeTeam || ""
  const eventApiId = String(event?.id || event?.eventId || "").trim()
  const eventIdForDebug = String(event?.id || event?.eventId || "")
  const matchupForDebug = away && home ? `${away} @ ${home}` : String(event?.matchup || "")
  const getEventMatchupForDebug = (evt) => {
    const awayTeam = evt?.away_team || evt?.awayTeam || ""
    const homeTeam = evt?.home_team || evt?.homeTeam || ""
    return awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : String(evt?.matchup || "")
  }
  const normalizeIngestText = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
  const awayNorm = normalizeIngestText(event?.away_team)
  const homeNorm = normalizeIngestText(event?.home_team)
  const isMavsNuggetsEvent =
    ((awayNorm.includes("mavericks") && homeNorm.includes("nuggets")) ||
      (awayNorm.includes("nuggets") && homeNorm.includes("mavericks")))

  const requestedMarkets = ALL_DK_MARKETS

  const baseParams = {
    apiKey: ODDS_API_KEY,
    regions: "us",
    markets: BASE_MARKETS.join(","),
    oddsFormat: "american"
  }
  const isDraftKingsBook = (book) => {
    const key = String(book?.key || book?.title || book?.name || "").toLowerCase().trim()
    return key.includes("draftkings")
  }
  const getMarketCountFromBook = (book) => {
    const markets = Array.isArray(book?.markets) ? book.markets : (Array.isArray(book?.props) ? book.props : [])
    return Array.isArray(markets) ? markets.length : 0
  }
  const normalizedFirstBasketRows = []

  const parseBooksToRows = (books = [], sourceLabel) => {
    const rows = []
    const returnedRowsForCoverage = []
    const rejectedRowsForCoverage = []
    let rejectedRows = 0
    let marketCount = 0
    let outcomeCount = 0
    let emptyMarketsCount = 0
    let emptyOutcomesCount = 0
    const dropReasonCounts = {}
    let rejectedTeamFirstBasket = 0
    let rejectedAlternateMarkets = 0
    const lukaNameMapStats = {
      rawOutcomeMentions: 0,
      mappedRows: 0,
      mappedPlayerSources: {}
    }
    const rawOutcomesForWatchedCoverage = []

    const normalizeSide = (value) => {
      const raw = String(value || "").trim().toLowerCase()
      if (raw === "over") return "Over"
      if (raw === "under") return "Under"
      return String(value || "").trim()
    }

    console.log("[DK-NORMALIZE-INPUT]", {
      bookmakerCount: Array.isArray(books) ? books.length : 0,
      marketKeys: Array.isArray(books)
        ? [...new Set(
            books.flatMap((book) =>
              Array.isArray(book?.markets) ? book.markets.map((m) => m?.key).filter(Boolean) : []
            )
          )]
        : []
    })

    for (const book of books) {
      const markets = Array.isArray(book?.markets)
        ? book.markets
        : (Array.isArray(book?.props) ? book.props : [])

      if (!Array.isArray(markets) || markets.length === 0) {
        emptyMarketsCount += 1
      }

      for (const market of markets) {
        marketCount += 1
        const marketKey = String(market?.key || market?.name || "").trim()
        const inferredMarket = inferMarketTypeFromKey(marketKey)
        const inferredPropType = inferredMarket.internalType
        const inferredFamily = inferredMarket.family
        const propType = normalizePropType(marketKey)
        let normalizedPropType = propType || inferredPropType || null
        const shouldKeepNormalizedMarket = Boolean(
          normalizedPropType ||
          inferredFamily === "standard" ||
          inferredFamily === "ladder" ||
          inferredFamily === "special"
        )

        if (!shouldKeepNormalizedMarket) continue

        const outcomes = Array.isArray(market?.outcomes)
          ? market.outcomes
          : (Array.isArray(market?.selections) ? market.selections : [])

        if (!Array.isArray(outcomes) || outcomes.length === 0) {
          emptyOutcomesCount += 1
        }

        for (const outcome of outcomes) {
          outcomeCount += 1
          rawOutcomesForWatchedCoverage.push(outcome)
          const eventId = String(
            event?.id ||
            event?.eventId ||
            event?.event_id ||
            outcome?.eventId ||
            outcome?.event_id ||
            outcome?.game_id ||
            market?.eventId ||
            market?.event_id ||
            market?.game_id ||
            market?.event?.id ||
            book?.eventId ||
            book?.event_id ||
            book?.game_id ||
            book?.event?.id ||
            event?.key ||
            ""
          ).trim()
          const sideRaw = String(outcome?.name || outcome?.label || outcome?.side || "").trim()
          const rawDescription = String(outcome?.description || "").trim()
          const rawParticipant = String(outcome?.participant || "").trim()
          const rawPlayer = String(outcome?.player || "").trim()
          const rawPlayerName = String(outcome?.player_name || "").trim()
          const combinedRawText = [sideRaw, rawDescription, rawParticipant, rawPlayer, rawPlayerName].join(" ")
          let side = normalizeSide(sideRaw)
          if (side !== "Over" && side !== "Under") {
            const combinedNorm = normalizeIngestText(combinedRawText)
            if (combinedNorm.includes(" over ") || combinedNorm.endsWith(" over") || combinedNorm.startsWith("over ")) side = "Over"
            else if (combinedNorm.includes(" under ") || combinedNorm.endsWith(" under") || combinedNorm.startsWith("under ")) side = "Under"
          }

          // For special/ladder markets, normalize Yes/No and treat player-name sides as "Yes"
          if (inferredFamily === "special" || inferredFamily === "ladder") {
            const sideLower = side.toLowerCase()
            if (sideLower === "yes") side = "Yes"
            else if (sideLower === "no") side = "No"
            else if (side !== "Over" && side !== "Under") side = "Yes"
          }

          let playerSource = "description"
          let player = rawDescription
          if (!player) {
            player = rawParticipant
            playerSource = "participant"
          }
          if (!player) {
            player = rawPlayer
            playerSource = "player"
          }
          if (!player) {
            player = rawPlayerName
            playerSource = "player_name"
          }
          if (!player) {
            const cleanedName = sideRaw.replace(/\b(over|under)\b/gi, "").trim()
            if (cleanedName && cleanedName.toLowerCase() !== "over" && cleanedName.toLowerCase() !== "under") {
              player = cleanedName
              playerSource = "name_derived"
            }
          }

          // Permanent watched-player guard: check every common raw field with normalizePlayerName.
          const watchedRawFields = [sideRaw, rawDescription, rawPlayer, rawPlayerName, rawParticipant]
          const normalizedWatchedFields = watchedRawFields.map((field) => normalizePlayerName(field)).filter(Boolean)
          for (const watchedName of WATCHED_PLAYER_NAMES) {
            const watchedNormalized = normalizePlayerName(watchedName)
            if (!watchedNormalized) continue
            if (normalizedWatchedFields.some((field) => field.includes(watchedNormalized))) {
              const preferredWatchedName = rawDescription || rawPlayer || rawPlayerName || rawParticipant || watchedName
              if (!player || normalizePlayerName(player) !== watchedNormalized) {
                player = preferredWatchedName
                playerSource = "watched_field_match"
              }
              break
            }
          }

          if (isMavsNuggetsEvent) {
            const rawNorm = normalizeIngestText(combinedRawText)
            if (rawNorm.includes("luka") || rawNorm.includes("doncic")) {
              lukaNameMapStats.rawOutcomeMentions += 1
            }
          }

          player = String(player || "").trim()
          const bookName = String(book?.title || book?.key || book?.name || "").trim()
          const currentLine = Number(outcome?.point ?? outcome?.line ?? outcome?.handicap ?? outcome?.total)
          const currentOdds = Number(outcome?.price ?? outcome?.odds ?? outcome?.american_odds)
          const rowKey = [
            eventId,
            player,
            normalizedPropType,
            side,
            bookName
          ].join("|")

          const previousOpen = previousOpenMap.get(rowKey)
          const openingLine = previousOpen ? previousOpen.openingLine : currentLine
          const openingOdds = previousOpen ? previousOpen.openingOdds : currentOdds
          const lineMove = Number((currentLine - openingLine).toFixed(1))
          const oddsMove = Number((currentOdds - openingOdds).toFixed(0))

          let marketMovementTag = "neutral"
          if (lineMove > 0) marketMovementTag = "line up"
          else if (lineMove < 0) marketMovementTag = "line down"
          else if (oddsMove > 0) marketMovementTag = "odds better"
          else if (oddsMove < 0) marketMovementTag = "odds worse"

          const draftRow = {
            eventId,
            matchup,
            awayTeam: event?.away_team || event?.awayTeam || event?.teams?.[0] || "",
            homeTeam: event?.home_team || event?.homeTeam || event?.teams?.[1] || "",
            gameTime: getEventTimeForDebug(event) || "",
            book: bookName,
            marketKey,
            marketFamily: inferredFamily,
            propType: normalizedPropType,
            player,
            side,
            playerStatus: getManualPlayerStatus(player),
            line: currentLine,
            odds: currentOdds,
            openingLine,
            openingOdds,
            lineMove,
            oddsMove,
            marketMovementTag
          }
          const classification = classifyBoardRow(draftRow)
          draftRow.boardFamily = classification?.boardFamily || null
          draftRow.ladderSubtype = classification?.ladderSubtype || null
          draftRow.specialSubtype = classification?.specialSubtype || null
          if (["player_first_basket", "player_first_team_basket"].includes(String(draftRow?.marketKey || ""))) {
            normalizedFirstBasketRows.push(draftRow)
          }
          returnedRowsForCoverage.push(draftRow)

          const rejectReason = getIngestRejectReason(draftRow)
          if (rejectReason) {
            rejectedRows += 1
            dropReasonCounts[rejectReason] = Number(dropReasonCounts[rejectReason] || 0) + 1
            rejectedRowsForCoverage.push({ ...draftRow, rejectReason })
            const marketKeyLower = String(draftRow?.marketKey || "").toLowerCase()
            if (marketKeyLower.includes("player_first_team_basket") || draftRow?.specialSubtype === "teamFirstBasket") {
              rejectedTeamFirstBasket += 1
            }
            if (marketKeyLower.includes("_alternate")) {
              rejectedAlternateMarkets += 1
            }
            continue
          }

          rows.push(draftRow)

          // STEP 2: Force-include logic for watched players (RIGHT AFTER ROW CREATION, BEFORE ANY FILTERS)
          const normalizedPlayer = normalizeDebugPlayerName(draftRow.player || "")
          const isWatched = WATCHED_PLAYER_NAMES
            .map(normalizeDebugPlayerName)
            .includes(normalizedPlayer)

          if (isWatched) {
            draftRow.__forceInclude = true
            console.log("[WATCHED-PLAYER-INGESTED]", {
              player: draftRow.player,
              matchup: draftRow.matchup,
              book: draftRow.book,
              propType: draftRow.propType,
              line: draftRow.line
            })
          }

          if (isMavsNuggetsEvent) {
            const mappedPlayerNorm = normalizeIngestText(player)
            if (mappedPlayerNorm.includes("luka") || mappedPlayerNorm.includes("doncic")) {
              lukaNameMapStats.mappedRows += 1
              lukaNameMapStats.mappedPlayerSources[playerSource] = Number(lukaNameMapStats.mappedPlayerSources[playerSource] || 0) + 1
            }
          }
        }
      }
    }

    console.log("[DK-NORMALIZE-OUTPUT]", {
      totalRows: rows.length,
      byMarketKey: rows.reduce((acc, row) => {
        const key = String(row?.marketKey || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byFamily: rows.reduce((acc, row) => {
        const key = String(row?.marketFamily || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })

    return {
      rows,
      debug: {
        sourceLabel,
        bookmakerCount: Array.isArray(books) ? books.length : 0,
        marketCount,
        outcomeCount,
        acceptedRows: rows.length,
        rejectedRows,
        emptyMarketsCount,
        emptyOutcomesCount,
        rejectedTeamFirstBasket,
        rejectedAlternateMarkets,
        dropReasonCounts,
        returnedRowsForCoverage,
        rejectedRowsForCoverage,
        lukaNameMapStats,
        watchedRawCounts: countWatchedPlayersInOutcomes(rawOutcomesForWatchedCoverage),
        watchedMappedCounts: countWatchedPlayersInRows(rows),
        booksSeen: (Array.isArray(books) ? books : []).map((book) => String(book?.title || "")).filter(Boolean)
      }
    }
  }

  console.log("[DK-MARKET-REQUEST-DEBUG]", {
    requestedMarkets
  })

  let primaryResponse = null
  try {
    primaryResponse = await axios.get(
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventApiId}/odds`,
      {
        params: {
          ...baseParams,
          bookmakers: "fanduel,draftkings"
        }
      }
    )
  } catch (error) {
    error.__dkFetchMeta = {
      requestedMarkets,
      responseReceived: Boolean(error?.response)
    }
    throw error
  }

  console.log("[DK-MARKETS-REQUESTED]", ALL_DK_MARKETS)

  const primaryResponseEvents = Array.isArray(primaryResponse?.data)
    ? primaryResponse.data
    : (primaryResponse?.data ? [primaryResponse.data] : [])

  for (const eventPayload of primaryResponseEvents) {
    console.log("[EVENT-BOOKMAKER-PRESENCE-DEBUG]", {
      eventId: String(event?.id || event?.eventId || ""),
      matchup: getEventMatchupForDebug(event),
      bookmakerCount: Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers.length : 0,
      bookmakerKeys: (Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []).map((book) => String(book?.key || book?.title || "")),
      marketCountByBook: (Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []).map((book) => ({
        book: String(book?.key || book?.title || ""),
        marketCount: Array.isArray(book?.markets) ? book.markets.length : 0
      }))
    })
  }

  const __events = Array.isArray(primaryResponse?.data) ? primaryResponse.data : []

  console.log("[API-EVENT-COUNT-DEBUG]", {
    totalEvents: __events.length,
    sampleMatchups: __events.slice(0, 10).map((e) => ({
      eventId: e?.id,
      matchup: `${e?.away_team} @ ${e?.home_team}`
    }))
  })

  for (const event of __events) {
    console.log("[API-EVENT-MARKETS-DEBUG]", {
      eventId: event?.id,
      matchup: `${event?.away_team} @ ${event?.home_team}`,
      bookmakerCount: (event?.bookmakers || []).length,
      hasDraftKings: (event?.bookmakers || []).some((b) =>
        (b?.key || "").toLowerCase().includes("draftkings")
      )
    })
  }

  if (!primaryResponseEvents.length) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "event_lookup_miss",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }
  const primaryBooks = primaryResponseEvents.flatMap((apiEvent) =>
    Array.isArray(apiEvent?.bookmakers) ? apiEvent.bookmakers : []
  )

  console.log("[EVENT-ODDS-PAYLOAD-DEBUG]", {
    eventId: String(event?.id || event?.eventId || ""),
    matchup: getEventMatchupForDebug(event),
    bookmakersPresent: Array.isArray(primaryBooks)
      ? primaryBooks.map((b) => String(b?.key || b?.title || ""))
      : [],
    bookmakerCount: Array.isArray(primaryBooks) ? primaryBooks.length : 0
  })

  console.log("[BOOKMAKER-MARKET-DEBUG]", {
    eventId: String(event?.id || event?.eventId || ""),
    matchup: getEventMatchupForDebug(event),
    books: (Array.isArray(primaryBooks) ? primaryBooks : []).map((book) => ({
      key: String(book?.key || book?.title || ""),
      marketCount: Array.isArray(book?.markets) ? book.markets.length : 0,
      marketKeys: (Array.isArray(book?.markets) ? book.markets : []).map((m) => String(m?.key || m?.name || "")).slice(0, 25)
    }))
  })

  const lukaRaw = primaryResponseEvents.flatMap((e) =>
    (e.bookmakers || []).flatMap((b) =>
      (b.markets || []).flatMap((m) =>
        (m.outcomes || []).filter((o) =>
          String(o.description || "").toLowerCase().includes("doncic")
        )
      )
    )
  )

  const primaryParsed = parseBooksToRows(primaryBooks, "primary-fanduel-draftkings")
  console.log("[INGEST-DROP-REASON-DEBUG]", {
    path: pathLabel,
    eventId: String(event?.id || ""),
    source: "primary-fanduel-draftkings",
    dropReasonCounts: primaryParsed?.debug?.dropReasonCounts || {},
    acceptedRows: primaryParsed?.debug?.acceptedRows || 0,
    rejectedRows: primaryParsed?.debug?.rejectedRows || 0
  })

  let finalRows = [...primaryParsed.rows]
  let extraRawRows = []
  let extraMarketsFetchSucceeded = false
  let fallbackParsed = null
  let extraParsed = null
  let fallbackResponseEvents = []
  let fallbackBooks = []
  let fallbackLukaRaw = []

  const primaryBooksNormalized = (Array.isArray(primaryBooks) ? primaryBooks : []).map((book) => {
    return String(book?.key || book?.title || book?.name || "").toLowerCase().trim()
  })
  const hasPrimaryFanDuel = primaryBooksNormalized.some((key) => key.includes("fanduel"))
  const hasPrimaryDraftKings = primaryBooksNormalized.some((key) => key.includes("draftkings"))
  const shouldFetchFallbackAllBooks = finalRows.length === 0 || !hasPrimaryFanDuel || !hasPrimaryDraftKings

  if (shouldFetchFallbackAllBooks) {
    try {
      const fallbackResponse = await axios.get(
        `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventApiId}/odds`,
        {
          params: baseParams
        }
      )

      fallbackResponseEvents = Array.isArray(fallbackResponse?.data)
        ? fallbackResponse.data
        : (fallbackResponse?.data ? [fallbackResponse.data] : [])
      for (const eventPayload of fallbackResponseEvents) {
        console.log("[EVENT-BOOKMAKER-PRESENCE-DEBUG]", {
          eventId: String(event?.id || event?.eventId || ""),
          matchup: getEventMatchupForDebug(event),
          bookmakerCount: Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers.length : 0,
          bookmakerKeys: (Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []).map((book) => String(book?.key || book?.title || "")),
          marketCountByBook: (Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []).map((book) => ({
            book: String(book?.key || book?.title || ""),
            marketCount: Array.isArray(book?.markets) ? book.markets.length : 0
          }))
        })
      }
      fallbackBooks = fallbackResponseEvents.flatMap((apiEvent) =>
        Array.isArray(apiEvent?.bookmakers) ? apiEvent.bookmakers : []
      )

      console.log("[EVENT-ODDS-PAYLOAD-DEBUG]", {
        eventId: String(event?.id || event?.eventId || ""),
        matchup: getEventMatchupForDebug(event),
        bookmakersPresent: Array.isArray(fallbackBooks)
          ? fallbackBooks.map((b) => String(b?.key || b?.title || ""))
          : [],
        bookmakerCount: Array.isArray(fallbackBooks) ? fallbackBooks.length : 0
      })

      console.log("[BOOKMAKER-MARKET-DEBUG]", {
        eventId: String(event?.id || event?.eventId || ""),
        matchup: getEventMatchupForDebug(event),
        books: (Array.isArray(fallbackBooks) ? fallbackBooks : []).map((book) => ({
          key: String(book?.key || book?.title || ""),
          marketCount: Array.isArray(book?.markets) ? book.markets.length : 0,
          marketKeys: (Array.isArray(book?.markets) ? book.markets : []).map((m) => String(m?.key || m?.name || "")).slice(0, 25)
        }))
      })

      fallbackLukaRaw = fallbackResponseEvents.flatMap((e) =>
        (e.bookmakers || []).flatMap((b) =>
          (b.markets || []).flatMap((m) =>
            (m.outcomes || []).filter((o) =>
              String(o.description || "").toLowerCase().includes("doncic")
            )
          )
        )
      )

      fallbackParsed = parseBooksToRows(fallbackBooks, "fallback-all-books")
      console.log("[INGEST-DROP-REASON-DEBUG]", {
        path: pathLabel,
        eventId: String(event?.id || ""),
        source: "fallback-all-books",
        dropReasonCounts: fallbackParsed?.debug?.dropReasonCounts || {},
        acceptedRows: fallbackParsed?.debug?.acceptedRows || 0,
        rejectedRows: fallbackParsed?.debug?.rejectedRows || 0
      })
      finalRows = dedupeByLegSignature([
        ...finalRows,
        ...(Array.isArray(fallbackParsed?.rows) ? fallbackParsed.rows : [])
      ])
    } catch (fallbackError) {
      console.log("[DK-FALLBACK-FETCH-ERROR]", {
        path: pathLabel,
        eventId: eventIdForDebug,
        matchup: matchupForDebug,
        requestedMarkets,
        responseReceived: Boolean(fallbackError?.response),
        message: fallbackError?.response?.data || fallbackError?.message || String(fallbackError)
      })
    }
  }

  try {
    console.log("[DK-EXTRA-MARKETS-REQUEST-DEBUG]", {
      requestedMarkets: DK_EXTRA_MARKETS
    })

    const extraResponse = await axios.get(
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventApiId}/odds`,
      {
        params: {
          ...baseParams,
          markets: DK_EXTRA_MARKETS.join(","),
          bookmakers: "draftkings"
        }
      }
    )

    const extraEvents = Array.isArray(extraResponse?.data)
      ? extraResponse.data
      : (extraResponse?.data ? [extraResponse.data] : [])
    const extraBooks = extraEvents.flatMap((apiEvent) =>
      Array.isArray(apiEvent?.bookmakers) ? apiEvent.bookmakers : []
    )
    extraParsed = parseBooksToRows(extraBooks, "secondary-draftkings-extra-markets")
    extraRawRows = Array.isArray(extraParsed?.rows) ? extraParsed.rows : []
    extraMarketsFetchSucceeded = true

    console.log("[DK-EXTRA-MARKETS-RESULT-DEBUG]", {
      eventCount: Array.isArray(extraEvents) ? extraEvents.length : 0,
      rawRowCount: Array.isArray(extraRawRows) ? extraRawRows.length : 0,
      marketKeys: [...new Set((extraRawRows || []).map((row) => String(row?.marketKey || "")).filter(Boolean))].sort(),
      byFamily: summarizeInterestingNormalizedRows(extraRawRows || []).byFamily,
      byPropType: summarizeInterestingNormalizedRows(extraRawRows || []).byPropType
    })
  } catch (error) {
    console.log("[DK-EXTRA-MARKETS-ERROR-DEBUG]", {
      message: error?.message || String(error)
    })
  }

  console.log("[DK-SPLIT-FETCH]", {
    baseCount: finalRows.length,
    extraCount: Array.isArray(extraRawRows) ? extraRawRows.length : 0,
    combinedCount: finalRows.length + (Array.isArray(extraRawRows) ? extraRawRows.length : 0)
  })

  if (extraMarketsFetchSucceeded && Array.isArray(extraRawRows) && extraRawRows.length > 0) {
    finalRows = dedupeByLegSignature([...finalRows, ...extraRawRows])
  }

  const requestedMarketKeysForCoverage = [
    ...(Array.isArray(requestedMarkets) ? requestedMarkets : []),
    ...DK_EXTRA_MARKETS
  ]
  const returnedRowsForCoverage = [
    ...(Array.isArray(primaryParsed?.debug?.returnedRowsForCoverage) ? primaryParsed.debug.returnedRowsForCoverage : []),
    ...(Array.isArray(fallbackParsed?.debug?.returnedRowsForCoverage) ? fallbackParsed.debug.returnedRowsForCoverage : []),
    ...(Array.isArray(extraParsed?.debug?.returnedRowsForCoverage) ? extraParsed.debug.returnedRowsForCoverage : [])
  ]
  const acceptedRowsForCoverage = [
    ...(Array.isArray(primaryParsed?.rows) ? primaryParsed.rows : []),
    ...(Array.isArray(fallbackParsed?.rows) ? fallbackParsed.rows : []),
    ...(Array.isArray(extraParsed?.rows) ? extraParsed.rows : [])
  ]
  const rejectedRowsForCoverage = [
    ...(Array.isArray(primaryParsed?.debug?.rejectedRowsForCoverage) ? primaryParsed.debug.rejectedRowsForCoverage : []),
    ...(Array.isArray(fallbackParsed?.debug?.rejectedRowsForCoverage) ? fallbackParsed.debug.rejectedRowsForCoverage : []),
    ...(Array.isArray(extraParsed?.debug?.rejectedRowsForCoverage) ? extraParsed.debug.rejectedRowsForCoverage : [])
  ]
  const coverageReport = buildCoverageReport({
    requestedMarketKeys: requestedMarketKeysForCoverage,
    returnedRows: returnedRowsForCoverage,
    acceptedRows: acceptedRowsForCoverage,
    rejectedRows: rejectedRowsForCoverage,
    finalRows: Array.isArray(finalRows) ? finalRows : []
  })
  console.log("[MARKET-COVERAGE-DEBUG]", {
    totals: coverageReport?.totals || {},
    rejectedByReason: coverageReport?.rejectedByReason || {},
    marketCoverage: Array.isArray(coverageReport?.marketCoverage) ? coverageReport.marketCoverage.slice(0, 25) : []
  })
  const focusedMarketKeys = [
    "player_first_team_basket",
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
    "player_threes_alternate",
    "player_points_rebounds_assists_alternate"
  ]
  const focusedCoverageMap = new Map(
    (Array.isArray(coverageReport?.marketCoverage) ? coverageReport.marketCoverage : []).map((entry) => [
      String(entry?.marketKey || ""),
      entry
    ])
  )
  const focusedRejectReasons = {}
  for (const row of rejectedRowsForCoverage) {
    const mk = String(row?.marketKey || "")
    if (!focusedMarketKeys.includes(mk)) continue
    const reason = String(row?.rejectReason || "unknown")
    focusedRejectReasons[reason] = (focusedRejectReasons[reason] || 0) + 1
  }
  const marketCoverageFocusDebug = {
    marketCoverage: focusedMarketKeys.map((marketKey) => {
      const entry = focusedCoverageMap.get(marketKey) || null
      return {
        marketKey,
        requested: Number(entry?.requested || 0),
        returned: Number(entry?.returned || 0),
        accepted: Number(entry?.accepted || 0),
        rejected: Number(entry?.rejected || 0),
        final: Number(entry?.final || 0)
      }
    }),
    rejectReasons: Object.entries(focusedRejectReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count }))
  }
  console.log("[MARKET-COVERAGE-FOCUS-DEBUG]", marketCoverageFocusDebug)

  const bookPayloads = [
    ...primaryBooks,
    ...(fallbackBooks || [])
  ]
  const dkBookPayloads = bookPayloads.filter((book) => isDraftKingsBook(book))
  const markets = bookPayloads.flatMap((book) =>
    Array.isArray(book?.markets)
      ? book.markets
      : (Array.isArray(book?.props) ? book.props : [])
  )
  const outcomes = markets.flatMap((market) =>
    Array.isArray(market?.outcomes)
      ? market.outcomes
      : (Array.isArray(market?.selections) ? market.selections : [])
  )
  const eventRows = Array.isArray(finalRows) ? finalRows : []
  const dkBookmakerEntries = dkBookPayloads.length
  const dkMarketEntries = dkBookPayloads.reduce((sum, book) => sum + getMarketCountFromBook(book), 0)
  const dkNormalizedRowsProduced = eventRows.filter((row) => String(row?.book || "") === "DraftKings").length

  console.log("[EVENT-RAW-ROWS-BY-GAME-DEBUG]", {
    eventId: String(event?.id || event?.eventId || ""),
    matchup: getEventMatchupForDebug(event),
    rowCount: Array.isArray(eventRows) ? eventRows.length : 0,
    byPropType: (Array.isArray(eventRows) ? eventRows : []).reduce((acc, row) => {
      const key = String(row?.propType || "Unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  })

  console.log("[EVENT-RAW-ROWS-DEBUG]", {
    eventId: String(event?.id || event?.eventId || ""),
    matchup: getEventMatchupForDebug(event),
    rowCount: Array.isArray(eventRows) ? eventRows.length : 0,
    byBook: (Array.isArray(eventRows) ? eventRows : []).reduce((acc, row) => {
      const key = String(row?.book || "Unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  })

  console.log("[RAW-PROPS-EVENT-DEBUG]", {
    eventId: eventIdForDebug,
    matchup: matchupForDebug,
    rawBookPayloadCount: Array.isArray(bookPayloads) ? bookPayloads.length : null,
    rawMarketCount: Array.isArray(markets) ? markets.length : null,
    rawOutcomeCount: Array.isArray(outcomes) ? outcomes.length : null,
    normalizedRowsForEvent: Array.isArray(eventRows) ? eventRows.length : 0
  })

  if (!bookPayloads.length) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "no_book_payload",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }
  if (bookPayloads.length > 0 && markets.length === 0) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "no_markets",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }
  if (markets.length > 0 && outcomes.length === 0) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "no_outcomes",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }
  const invalidPropTypeDrops = Number(primaryParsed?.debug?.dropReasonCounts?.invalid_prop_type || 0) + Number(fallbackParsed?.debug?.dropReasonCounts?.invalid_prop_type || 0)
  if (invalidPropTypeDrops > 0) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "unsupported_market_type",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }
  if (outcomes.length > 0 && eventRows.length === 0) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "normalization_empty",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }
  if (eventRows.length > 0 && eventIdForDebug && !eventRows.some((row) => String(row?.eventId || "") === eventIdForDebug)) {
    console.log("[RAW-PROPS-SKIP-DEBUG]", {
      reason: "event_id_mismatch",
      eventId: eventIdForDebug,
      matchup: matchupForDebug
    })
  }

  const debug = {
    path: pathLabel,
    eventId: String(event?.id || ""),
    matchup,
    requestedMarkets,
    responseReceived: true,
    dkRequestSucceeded: true,
    dkBookmakerEntries,
    dkMarketEntries,
    dkNormalizedRowsProduced,
    normalizedRowsProduced: eventRows.length,
    apiEventIdsPrimary: primaryResponseEvents.map((e) => String(e?.id || e?.event_id || e?.key || "")).filter(Boolean),
    apiEventIdsFallback: fallbackResponseEvents.map((e) => String(e?.id || e?.event_id || e?.key || "")).filter(Boolean),
    lukaRawPrimaryCount: lukaRaw.length,
    lukaRawFallbackCount: fallbackLukaRaw.length,
    lukaMappedCount: finalRows.filter((row) => {
      const normalized = String(row?.player || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      return normalized.includes("doncic")
    }).length,
    scheduledGameTime: event?.commence_time || null,
    primary: primaryParsed.debug,
    fallback: fallbackParsed?.debug || null,
    watchedRawCounts: WATCHED_PLAYER_NAMES.reduce((acc, name) => {
      acc[name] = Number(primaryParsed?.debug?.watchedRawCounts?.[name] || 0) + Number(fallbackParsed?.debug?.watchedRawCounts?.[name] || 0)
      return acc
    }, {}),
    watchedMappedCounts: countWatchedPlayersInRows(finalRows),
    usedFallbackAllBooks: Boolean(fallbackParsed),
    allBookmakerSummary: bookPayloads.map((b) => ({
      key: String(b?.key || ""),
      title: String(b?.title || ""),
      marketCount: Array.isArray(b?.markets) ? b.markets.length : 0,
      sampleMarketKeys: Array.isArray(b?.markets) ? b.markets.slice(0, 15).map((m) => String(m?.key || m?.name || "")) : []
    })),
    dkMarketKeysSeen: [...new Set(dkBookPayloads.flatMap((b) => (Array.isArray(b?.markets) ? b.markets : []).map((m) => String(m?.key || m?.name || ""))))].filter(Boolean),
    coverageReport,
    marketCoverageFocusDebug
  }

  if (isMavsNuggetsEvent) {
    const rawBooks = [...primaryBooks, ...(fallbackBooks || [])]
    const bookmakerNames = [...new Set(rawBooks.map((book) => String(book?.key || book?.title || "").trim()).filter(Boolean))]
    const marketKeys = [...new Set(rawBooks.flatMap((book) => {
      const markets = Array.isArray(book?.markets) ? book.markets : (Array.isArray(book?.props) ? book.props : [])
      return markets.map((market) => String(market?.key || market?.market_key || market?.name || market?.description || "").trim())
    }).filter(Boolean))]

    const rawOutcomes = rawBooks.flatMap((book) => {
      const markets = Array.isArray(book?.markets) ? book.markets : (Array.isArray(book?.props) ? book.props : [])
      return markets.flatMap((market) => {
        const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : (Array.isArray(market?.selections) ? market.selections : [])
        return outcomes.map((outcome) => ({
          name: String(outcome?.name || "").trim(),
          description: String(outcome?.description || "").trim(),
          player: String(outcome?.player || "").trim(),
          player_name: String(outcome?.player_name || "").trim(),
          participant: String(outcome?.participant || "").trim()
        }))
      })
    })

    const rawTextList = rawOutcomes.map((o) => [o.name, o.description, o.player, o.player_name, o.participant].join(" "))

    const rawLower = rawTextList.join(" ").toLowerCase()
    const rawNorm = normalizeIngestText(rawTextList.join(" "))
    const lukaOrDoncicRegex = /luka|doncic/i

    const fieldHitSummary = {
      name: rawOutcomes.filter((o) => lukaOrDoncicRegex.test(o.name)).length,
      description: rawOutcomes.filter((o) => lukaOrDoncicRegex.test(o.description)).length,
      player: rawOutcomes.filter((o) => lukaOrDoncicRegex.test(o.player)).length,
      player_name: rawOutcomes.filter((o) => lukaOrDoncicRegex.test(o.player_name)).length,
      participant: rawOutcomes.filter((o) => lukaOrDoncicRegex.test(o.participant)).length
    }

    const matchingRawNames = rawOutcomes
      .flatMap((o) => [o.name, o.description, o.player, o.player_name, o.participant])
      .map((value) => String(value || "").trim())
      .filter((value) => value && lukaOrDoncicRegex.test(value))
    const matchingSample = [...new Set(matchingRawNames)].slice(0, 8)

    const lukaMentionsCount = matchingRawNames.filter((value) => /luka/i.test(value)).length
    const doncicMentionsCount = matchingRawNames.filter((value) => /doncic/i.test(value)).length

    console.log("[LUKA-RAW-API-PRESENCE-DEBUG]", {
      path: pathLabel,
      eventId: String(event?.id || ""),
      matchup,
      rawApiEventFound: Boolean(primaryResponse?.data || fallbackResponseEvents.length),
      bookmakers: bookmakerNames,
      marketKeys,
      lukaMentionsCount,
      doncicMentionsCount,
      matchingSample,
      lukaAbsentFromRawApi: matchingSample.length === 0
    })

    console.log("[LUKA-RAW-API-FIELD-DEBUG]", {
      path: pathLabel,
      eventId: String(event?.id || ""),
      fieldsChecked: ["outcome.name", "outcome.description", "outcome.player", "outcome.player_name", "outcome.participant"],
      fieldHitSummary,
      nameHits: {
        lukaDoncic: rawNorm.includes("luka doncic"),
        lukaDoncicAccent: rawLower.includes("luka dončić"),
        luka: rawNorm.includes("luka"),
        doncic: rawNorm.includes("doncic")
      }
    })

  }

  const allNormalizedRows = [...(Array.isArray(finalRows) ? finalRows : []), ...(Array.isArray(extraRawRows) ? extraRawRows : [])]
  console.log("[DK-MARKETS-RETURNED]", {
    uniqueMarketKeys: [...new Set(allNormalizedRows.map(r => r.marketKey))].slice(0, 50)
  })

  return {
    rows: finalRows,
    extraRawRows,
    extraMarketsFetchSucceeded,
    normalizedFirstBasketRows: dedupeMarketRows(
      (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : [])
        .filter((row) => ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || "")))
    ),
    debug
  }
}

function getSlateModeFromEvents(events = []) {
  const rawProps = Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : []
  const todayKey = (() => {
    try {
      return getLocalSlateDateKey(new Date().toISOString())
    } catch (_) {
      return ""
    }
  })()
  const coveredEvents = Array.isArray(events) ? events : []
  const scheduledEvents = coveredEvents
  const slateDayRows = Array.isArray(coveredEvents)
    ? coveredEvents
    : (Array.isArray(scheduledEvents) ? scheduledEvents : [])

  const totalSlateGames = new Set(
    slateDayRows.map((row) => String(row?.matchup || "")).filter(Boolean)
  ).size
  const eligibleRemainingGames = new Set(
    slateDayRows
      .filter((row) => isPregameEligibleRow(row) === true)
      .map((row) => String(row?.matchup || ""))
      .filter(Boolean)
  ).size
  const startedSlateGames = new Set(
    slateDayRows
      .filter((row) => isPregameEligibleRow(row) === false)
      .map((row) => String(row?.matchup || ""))
      .filter(Boolean)
  ).size

  console.log("[SLATE-GAME-COUNT-DEBUG]", {
    nowIso: new Date().toISOString(),
    todayKey,
    totalSlateGames,
    eligibleRemainingGames,
    startedSlateGames
  })

  if (!totalSlateGames) {
    return {
      slateMode: "unknown",
      eligibleRemainingGames: 0,
      totalEligibleGames: 0,
      startedEligibleGames: 0
    }
  }

  return {
    slateMode: startedSlateGames > 0 ? "remaining-slate" : "full-slate",
    eligibleRemainingGames,
    totalEligibleGames: totalSlateGames,
    startedEligibleGames: startedSlateGames
  }
}


app.get("/", (req, res) => {
  res.json({
    status: "Betting engine running",
    message: "API working"
  })
})

app.get("/event-markets", async (req, res) => {
  try {
    if (!ODDS_API_KEY) {
      return res.status(500).json({ error: "Missing ODDS_API_KEY in .env" })
    }

    const { eventId } = req.query
    if (!eventId) {
      return res.status(400).json({ error: "Missing eventId query param" })
    }

    const response = await axios.get(
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/markets`,
      {
        params: {
          apiKey: ODDS_API_KEY,
          regions: "us",
          bookmakers: "fanduel,draftkings"
        }
      }
    )

    res.json(response.data)
  } catch (error) {
    res.status(500).json({
      error: "Event markets fetch failed",
      details: error.response?.data || error.message
    })
  }
})

app.get("/odds", async (req, res) => {
  try {
    if (!ODDS_API_KEY) {
      return res.status(500).json({ error: "Missing ODDS_API_KEY in .env" })
    }

    const response = await axios.get(
      "https://api.the-odds-api.com/v4/sports/basketball_nba/odds",
      {
        params: {
          apiKey: ODDS_API_KEY,
          regions: "us",
          markets: "h2h,spreads,totals",
          oddsFormat: "american"
        }
      }
    )

    res.json(response.data)
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json({
        error: "Odds API request failed",
        details: error.response.data
      })
    }

    res.status(500).json({
      error: "Server error",
      details: error.message
    })
  }
})

app.get("/props", async (req, res) => {
  try {
    if (!ODDS_API_KEY) {
      return res.status(500).json({ error: "Missing ODDS_API_KEY in .env" })
    }

    const eventsResponse = await axios.get(
      "https://api.the-odds-api.com/v4/sports/basketball_nba/events",
      {
        params: { apiKey: ODDS_API_KEY }
      }
    )

    const events = eventsResponse.data || []
    const targetEvents = events.slice(0, 3)
    const allProps = []

    for (const event of targetEvents) {
      try {
        const basePropsResponse = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds`,
          {
            params: {
              apiKey: ODDS_API_KEY,
              regions: "us",
              bookmakers: "fanduel,draftkings",
              markets: BASE_MARKETS.join(","),
              oddsFormat: "american"
            }
          }
        )

        const extraPropsResponse = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds`,
          {
            params: {
              apiKey: ODDS_API_KEY,
              regions: "us",
              bookmakers: "draftkings",
              markets: DK_EXTRA_MARKETS.join(","),
              oddsFormat: "american"
            }
          }
        )

        const baseData = basePropsResponse.data
        const extraData = extraPropsResponse.data
        const mergedBookmakers = [
          ...(Array.isArray(baseData?.bookmakers) ? baseData.bookmakers : []),
          ...(Array.isArray(extraData?.bookmakers) ? extraData.bookmakers : [])
        ]

        allProps.push({
          eventId: event.id,
          away_team: event.away_team,
          home_team: event.home_team,
          data: { ...baseData, bookmakers: mergedBookmakers }
        })
      } catch (eventError) {
        allProps.push({
          eventId: event.id,
          away_team: event.away_team,
          home_team: event.home_team,
          error: eventError.response?.data || eventError.message
        })
      }
    }

    res.json(allProps)
  } catch (error) {
    res.status(500).json({
      error: "Props fetch failed",
      details: error.response?.data || error.message
    })
  }
})

app.get("/props/clean", async (req, res) => {
  try {
    if (!ODDS_API_KEY) {
      return res.status(500).json({ error: "Missing ODDS_API_KEY in .env" })
    }

    const eventsResponse = await axios.get(
      "https://api.the-odds-api.com/v4/sports/basketball_nba/events",
      {
        params: { apiKey: ODDS_API_KEY }
      }
    )

    const events = eventsResponse.data || []
    const targetEvents = events.slice(0, 3)
    const cleaned = []

    const previousOpenMap = new Map(
      (oddsSnapshot.props || []).map((row) => {
        const key = [row.eventId, row.player, row.propType, row.side, row.book].join("|")
        return [
          key,
          {
            openingLine: Number.isFinite(Number(row.openingLine)) ? Number(row.openingLine) : Number(row.line),
            openingOdds: Number.isFinite(Number(row.openingOdds)) ? Number(row.openingOdds) : Number(row.odds)
          }
        ]
      })
    )

    for (const event of targetEvents) {
      try {
        const basePropsResponse = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds`,
          {
            params: {
              apiKey: ODDS_API_KEY,
              regions: "us",
              bookmakers: "fanduel,draftkings",
              markets: BASE_MARKETS.join(","),
              oddsFormat: "american"
            }
          }
        )

        const extraPropsResponse = await axios.get(
          `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds`,
          {
            params: {
              apiKey: ODDS_API_KEY,
              regions: "us",
              bookmakers: "draftkings",
              markets: DK_EXTRA_MARKETS.join(","),
              oddsFormat: "american"
            }
          }
        )

        const baseBooks = basePropsResponse.data.bookmakers || []
        const extraBooks = extraPropsResponse.data.bookmakers || []
        const books = [...baseBooks, ...extraBooks]

        const matchup = buildMatchup(event.away_team, event.home_team)

        for (const book of books) {
          const bookName = book.title

          for (const market of book.markets || []) {
            const marketKey = String(market?.key || market?.name || "").trim()
            const inferredMarket = inferMarketTypeFromKey(marketKey)
            const inferredFamily = inferredMarket.family
            const propType = normalizePropType(market.key) || inferredMarket.internalType || null

            for (const outcome of market.outcomes || []) {
              const sideRaw = String(outcome?.name || "").trim()
              let side = sideRaw === "over" || sideRaw === "Over" ? "Over" : (sideRaw === "under" || sideRaw === "Under" ? "Under" : sideRaw)

              if (inferredFamily === "special" || inferredFamily === "ladder") {
                const sideLower = side.toLowerCase()
                if (sideLower === "yes") side = "Yes"
                else if (sideLower === "no") side = "No"
                else if (side !== "Over" && side !== "Under") side = "Yes"
              }

              const draftRow = {
                eventId: event.id,
                matchup,
                awayTeam: event.away_team,
                homeTeam: event.home_team,
                gameTime: event.commence_time,
                book: bookName,
                marketKey,
                marketFamily: inferredFamily,
                propType,
                player: outcome.description,
                side,
                playerStatus: getManualPlayerStatus(outcome.description),
                line: outcome.point,
                odds: outcome.price
              }

              if (shouldRejectRow(draftRow)) continue

              cleaned.push(draftRow)
            }
          }
        }
      } catch (eventError) {
        console.error(
          "Event props failed:",
          event.id,
          eventError.response?.data || eventError.message
        )
      }
    }

    res.json(cleaned)
  } catch (error) {
    res.status(500).json({
      error: "Clean props fetch failed",
      details: error.response?.data || error.message
    })
  }
})

app.get("/props/edges", async (req, res) => {
  try {
    res.json(oddsSnapshot.props || [])
  } catch (error) {
    res.status(500).json({
      error: "Props edge fetch failed",
      details: error.message
    })
  }
})

app.get("/props/best", async (req, res) => {
  try {
    res.json(oddsSnapshot.bestProps || [])
  } catch (error) {
    res.status(500).json({
      error: "Best props fetch failed",
      details: error.message
    })
  }
})

app.get("/props/elite", async (req, res) => {
  try {
    res.json(oddsSnapshot.eliteProps || [])
  } catch (error) {
    res.status(500).json({
      error: "Elite props fetch failed",
      details: error.message
    })
  }
})

app.get("/props/strong", async (req, res) => {
  try {
    res.json(oddsSnapshot.strongProps || [])
  } catch (error) {
    res.status(500).json({
      error: "Strong props fetch failed",
      details: error.message
    })
  }
})

app.get("/props/playable", async (req, res) => {
  try {
    res.json(oddsSnapshot.playableProps || [])
  } catch (error) {
    res.status(500).json({
      error: "Playable props fetch failed",
      details: error.message
    })
  }
})

function payoutMultipleFromAmerican(americanOdds) {
  const dec = americanToDecimal(americanOdds)
  if (!dec) return null
  return dec
}

function legEVPerUnit(row) {
  const odds = Number(row?.odds)
  if (!Number.isFinite(odds)) return null

  const payoutMultiple = payoutMultipleFromAmerican(odds)
  if (!payoutMultiple) return null

  const mlProb = mlScorer.scoreRow(row)
  const prob = mlProb === null ? estimateLegTrueProbability(row) : mlProb
  if (prob === null) return null

  // EV per 1u stake: win => (payoutMultiple - 1), lose => -1
  return prob * (payoutMultiple - 1) - (1 - prob)
}

function diversifyRows(rows = [], { limit = 15, maxPerTeam = 2, maxPerPlayer = 1 } = {}) {
  const out = []
  const teamCounts = new Map()
  const playerCounts = new Map()

  for (const row of rows) {
    const team = String(row?.team || "UNK")
    const player = String(row?.player || "UNK")

    const t = teamCounts.get(team) || 0
    const p = playerCounts.get(player) || 0
    if (t >= maxPerTeam) continue
    if (p >= maxPerPlayer) continue

    out.push(row)
    teamCounts.set(team, t + 1)
    playerCounts.set(player, p + 1)

    if (out.length >= limit) break
  }

  return out
}

app.get("/picks/today", async (req, res) => {
  try {
    const primary = getAvailablePrimarySlateRows(dedupeBestProps([
      ...(oddsSnapshot.bestProps || []),
      ...(oddsSnapshot.eliteProps || []),
      ...(oddsSnapshot.strongProps || []),
      ...(oddsSnapshot.playableProps || []),
    ]))

    if (!primary.length) {
      return res.json({
        ok: true,
        updatedAt: oddsSnapshot.updatedAt || null,
        picks: { singles: {}, slips: {} }
      })
    }

    const withExtras = primary.map((row) => {
      const impliedProb = impliedProbabilityFromAmerican(row.odds)
      const mlProb = mlScorer.scoreRow(row)
      const trueProb = mlProb === null ? estimateLegTrueProbability(row) : mlProb
      const ev = legEVPerUnit(row)
      const edgeVsMarket = (trueProb !== null && impliedProb !== null)
        ? Number((trueProb - impliedProb).toFixed(4))
        : null

      return {
        ...row,
        mlPredictedProb: mlProb,
        impliedProb,
        trueProb,
        evPerUnit: ev === null ? null : Number(ev.toFixed(4)),
        edgeVsMarket
      }
    })

    const conservativeSorted = sortRowsForMLHighestHitRate(withExtras)
      .filter((row) => isSafeProp(row))

    const balancedSorted = [...withExtras]
      .filter((row) => row.evPerUnit !== null)
      .sort((a, b) => Number(b.evPerUnit || -999) - Number(a.evPerUnit || -999))

    // "Lotto singles": high payout lines but not pure noise
    const lottoSingles = [...withExtras]
      .filter((row) => {
        const odds = Number(row.odds || 0)
        if (!Number.isFinite(odds)) return false
        if (odds < 120) return false
        if (row.evPerUnit === null) return false
        return row.evPerUnit >= 0.02
      })
      .sort((a, b) => (Number(b.evPerUnit) - Number(a.evPerUnit)))

    const books = ["FanDuel", "DraftKings"]
    const slips = {}

    // Build the live payload once to get all highestHitRate and portfolio data
    console.log("[PAYLOAD-DEBUG] ROUTE calling buildLiveDualBestAvailablePayload")
    const payload = buildLiveDualBestAvailablePayload()

    for (const book of books) {
      slips[book] = {}
      const bookKey = book === "FanDuel" ? "fanduel" : "draftkings"

      // Daily Target (~$100): priority order
      // 1. Try highestHitRate3 if return is roughly in daily range (75-125)
      const hr3 = payload?.highestHitRate3?.[bookKey]
      if (hr3?.projectedReturn && hr3.projectedReturn >= 75 && hr3.projectedReturn <= 125 && hr3?.legs?.length === 3) {
        slips[book].daily = hr3
      } else {
        // 2. Try highestHitRate2
        const hr2 = payload?.highestHitRate2?.[bookKey]
        if (hr2?.legs?.length === 2) {
          slips[book].daily = hr2
        } else {
          // 3. Try best from payoutFitPortfolio smallHitters/midUpside
          const portfolio = payload?.payoutFitPortfolio?.[bookKey]
          const dailyOption = portfolio?.smallHitters?.options?.[0] || portfolio?.midUpside?.options?.[0]
          if (dailyOption?.legs?.length >= 2) {
            slips[book].daily = {
              book,
              legs: dailyOption.legs,
              price: { american: dailyOption.oddsAmerican },
              projectedReturn: dailyOption.projectedReturn,
              confidence: dailyOption.confidence,
              label: `${book} Daily Target (~$${dailyOption.projectedReturn.toFixed(0)})`
            }
          }
        }
      }

      // Lotto Target (~$500): priority order
      // 1. Try highestHitRate5 (strictly requires 5 legs and appropriate payout)
      const hr5 = payload?.highestHitRate5?.[bookKey]
      if (hr5?.legs?.length === 5 && hr5?.projectedReturn >= 425) {
        slips[book].lotto = hr5
      } else {
        // 2. Try highestHitRate4
        const hr4 = payload?.highestHitRate4?.[bookKey]
        if (hr4?.legs?.length === 4 && hr4?.projectedReturn >= 300) {
          slips[book].lotto = hr4
        } else {
          // 3. Try best from payoutFitPortfolio lotto/bigUpside (4+ legs only)
          const portfolio = payload?.payoutFitPortfolio?.[bookKey]
          const lottoOption = portfolio?.lotto?.options?.[0] || 
                             (portfolio?.bigUpside?.options?.find(o => o.legCount >= 4))
          if (lottoOption?.legs?.length >= 4 && lottoOption?.projectedReturn >= 300) {
            slips[book].lotto = {
              book,
              legs: lottoOption.legs,
              price: { american: lottoOption.oddsAmerican },
              projectedReturn: lottoOption.projectedReturn,
              confidence: lottoOption.confidence,
              label: `${book} Lotto Target (~$${lottoOption.projectedReturn.toFixed(0)})`
            }
          }
        }
      }
    }

    const slateMeta = getSlateModeFromEvents(oddsSnapshot.events || [])

    res.json({
      ok: true,
      updatedAt: oddsSnapshot.updatedAt || null,
      updatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
      primarySlateDateLocal: getPrimarySlateDateKeyFromRows(withExtras),
      slateMode: slateMeta.slateMode,
      singles: {
        conservative: diversifyRows(conservativeSorted, { limit: 15, maxPerTeam: 2, maxPerPlayer: 1 }),
        balanced: diversifyRows(balancedSorted, { limit: 15, maxPerTeam: 2, maxPerPlayer: 1 }),
        lotto: diversifyRows(lottoSingles, { limit: 15, maxPerTeam: 2, maxPerPlayer: 1 }),
      },
      slips
    })
  } catch (error) {
    res.status(500).json({
      error: "Today picks failed",
      details: error.message
    })
  }
})

app.get("/parlays", async (req, res) => {
  try {
    console.log("[route-hit] GET /parlays", new Date().toISOString())
    // NOTE: /parlays uses makeSlipProfiles() — NOT buildLiveDualBestAvailablePayload
    console.log("[PAYLOAD-DEBUG] ROUTE /parlays — calls makeSlipProfiles, NOT buildLiveDualBestAvailablePayload")
    console.log("[PAYLOAD-DEBUG] /parlays oddsSnapshot.bestProps.length:", (oddsSnapshot.bestProps || []).length)
    const slips = makeSlipProfiles()
    console.log("[PAYLOAD-DEBUG] /parlays SUMMARY route=/parlays bestPropsInSnapshot:", (oddsSnapshot.bestProps || []).length,
      "eliteProps:", (oddsSnapshot.eliteProps || []).length,
      "strongProps:", (oddsSnapshot.strongProps || []).length,
      "playableProps:", (oddsSnapshot.playableProps || []).length
    )
    console.log("[ROUTE-FINAL-DEBUG] /parlays", {
      bestPropsRaw: (oddsSnapshot.bestProps || []).length,
      playablePropsRaw: (oddsSnapshot.playableProps || []).length,
      strongPropsRaw: (oddsSnapshot.strongProps || []).length,
      elitePropsRaw: (oddsSnapshot.eliteProps || []).length
    })
    const payloadBestKeys = new Set()
    for (const value of Object.values(slips || {})) {
      if (!Array.isArray(value)) continue
      for (const leg of value) {
        const key = `${leg.player || ""}|${leg.propType || ""}|${leg.side || ""}|${Number(leg.line)}|${leg.book || ""}`
        payloadBestKeys.add(key)
      }
    }
    console.log(`[FINAL-ROUTE-COUNTS] route=/parlays bestPropsRaw=${(oddsSnapshot.bestProps || []).length} payloadBest=${payloadBestKeys.size}`)
    const snapshotMeta = logSnapshotMeta("route=/parlays response")
    res.json({
      ...slips,
      snapshotMeta
    })
  } catch (error) {
    res.status(500).json({
      error: "Parlay builder failed",
      details: error.message
    })
  }
})

// Export current candidate legs for model training (JSON)
app.get("/export/training.json", async (req, res) => {
  try {
    const candidates = [
      ...(oddsSnapshot.props || []),
      ...(oddsSnapshot.bestProps || []),
      ...manualOutcomes
    ]

    const rows = dedupeBestProps(candidates).map((row) => ({
      eventId: row.eventId || "",
      matchup: row.matchup || "",
      gameTime: row.gameTime || "",
      player: row.player || "",
      propType: row.propType || "",
      side: row.side || "",
      book: row.book || "",
      line: row.line || null,
      odds: row.odds || null,
      openingLine: row.openingLine || null,
      openingOdds: row.openingOdds || null,
      lineMove: row.lineMove || null,
      oddsMove: row.oddsMove || null,
      edge: row.edge || null,
      hitRate: row.hitRate || null,
      avgMin: row.avgMin || null,
      minStd: row.minStd || null,
      valueStd: row.valueStd || null,
      minutesRisk: row.minutesRisk || null,
      trendRisk: row.trendRisk || null,
      injuryRisk: row.injuryRisk || null,
      dvpScore: row.dvpScore || null,
      score: row.score || null,
      snapshotUpdatedAt: oddsSnapshot.updatedAt || null,
      outcome: row.outcome === undefined ? null : row.outcome
    }))

    res.json(rows)
  } catch (error) {
    res.status(500).json({ error: "Training export failed", details: error.message })
  }
})

// Export current candidate legs as CSV for quick download
app.get("/export/training.csv", async (req, res) => {
  try {
    const candidates = [
      ...(oddsSnapshot.props || []),
      ...(oddsSnapshot.bestProps || []),
      ...manualOutcomes
    ]

    const rows = dedupeBestProps(candidates).map((row) => ({
      eventId: row.eventId || "",
      matchup: row.matchup || "",
      gameTime: row.gameTime || "",
      player: row.player || "",
      propType: row.propType || "",
      side: row.side || "",
      book: row.book || "",
      line: row.line || "",
      odds: row.odds || "",
      openingLine: row.openingLine || "",
      openingOdds: row.openingOdds || "",
      lineMove: row.lineMove || "",
      oddsMove: row.oddsMove || "",
      edge: row.edge || "",
      hitRate: row.hitRate || "",
      avgMin: row.avgMin || "",
      minStd: row.minStd || "",
      valueStd: row.valueStd || "",
      minutesRisk: row.minutesRisk || "",
      trendRisk: row.trendRisk || "",
      injuryRisk: row.injuryRisk || "",
      dvpScore: row.dvpScore || "",
      score: row.score || "",
      snapshotUpdatedAt: oddsSnapshot.updatedAt || "",
      outcome: row.outcome === undefined ? "" : String(row.outcome)
    }))

    const headers = Object.keys(rows[0] || {
      eventId: "",
      matchup: "",
      gameTime: "",
      player: "",
      propType: "",
      side: "",
      book: "",
      line: "",
      odds: "",
      openingLine: "",
      openingOdds: "",
      lineMove: "",
      oddsMove: "",
      edge: "",
      hitRate: "",
      avgMin: "",
      minStd: "",
      valueStd: "",
      minutesRisk: "",
      trendRisk: "",
      injuryRisk: "",
      dvpScore: "",
      score: "",
      snapshotUpdatedAt: "",
      outcome: ""
    })

    const escape = (v) => {
      if (v === null || v === undefined) return ""
      const s = String(v)
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""') }"`
      return s
    }

    const csv = [headers.join(",")]
      .concat(rows.map((r) => headers.map((h) => escape(r[h])).join(",")))
      .join("\n")

    res.setHeader("Content-Type", "text/csv")
    res.setHeader("Content-Disposition", "attachment; filename=training-data.csv")
    res.send(csv)
  } catch (error) {
    res.status(500).json({ error: "Training CSV export failed", details: error.message })
  }
})

// Label outcome for a specific leg (for model training).
// POST /label-outcome { eventId, player, propType, side, line, book, outcome: 0|1, gameDate? }
app.post("/label-outcome", async (req, res) => {
  try {
    const { eventId, player, propType, side, line, book, outcome, gameDate } = req.body
    
    if (!eventId || !player || !propType || !side || !book || outcome === undefined) {
      return res.status(400).json({
        error: "Missing required fields: eventId, player, propType, side, line, book, outcome"
      })
    }
    
    const outcomeNum = Number(outcome) ? 1 : 0
    
    // Find and update matching row in oddsSnapshot
    let found = false
    
    for (const prop of oddsSnapshot.props || []) {
      if (prop.eventId === eventId &&
          prop.player === player &&
          prop.propType === propType &&
          prop.side === side &&
          Number(prop.line) === Number(line) &&
          prop.book === book) {
        prop.outcome = outcomeNum
        found = true
        break
      }
    }
    
    for (const prop of oddsSnapshot.bestProps || []) {
      if (prop.eventId === eventId &&
          prop.player === player &&
          prop.propType === propType &&
          prop.side === side &&
          Number(prop.line) === Number(line) &&
          prop.book === book) {
        prop.outcome = outcomeNum
        found = true
        break
      }
    }
    
    if (!found) {
      // Check if it's a manual outcome (for settled props)
      if (eventId.startsWith("manual-")) {
        // Check if we already have this manual outcome
        const existingIndex = manualOutcomes.findIndex(m =>
          m.player === player &&
          m.propType === propType &&
          m.side === side &&
          Number(m.line) === Number(line) &&
          m.book === book
        )
        
        if (existingIndex >= 0) {
          manualOutcomes[existingIndex] = {
            eventId,
            player,
            propType,
            side,
            line: Number(line),
            book,
            outcome: outcomeNum,
            gameDate: gameDate || null,
            recordedAt: new Date().toISOString()
          }
        } else {
          manualOutcomes.push({
            eventId,
            player,
            propType,
            side,
            line: Number(line),
            book,
            outcome: outcomeNum,
            gameDate: gameDate || null,
            recordedAt: new Date().toISOString()
          })
        }
        
        // Save manual outcomes to disk
        await saveManualOutcomes()
      } else {
        return res.status(404).json({ error: "Leg not found" })
      }
    }
    
    res.json({
      ok: true,
      message: `Labeled leg as ${outcomeNum ? "hit" : "miss"}`,
      eventId, player, propType, side, line, book, outcome: outcomeNum
    })
  } catch (error) {
    res.status(500).json({ error: "Label outcome failed", details: error.message })
  }
})

app.get("/parlays/compare", async (req, res) => {
  try {
    const parlays = makeSlipProfiles()

    const compareSlip = (legs, label) => {
      const pickBestForBook = (rows, side) => {
        if (!rows.length) return null

        return [...rows].sort((a, b) => {
          const aLine = Number(a.line || 0)
          const bLine = Number(b.line || 0)
          const aOdds = Number(a.odds || -999)
          const bOdds = Number(b.odds || -999)

          if (side === "Over") {
            if (aLine !== bLine) return aLine - bLine
          } else {
            if (aLine !== bLine) return bLine - aLine
          }

          return bOdds - aOdds
        })[0]
      }

      const keys = legs.map((leg) => ({
        player: leg.player,
        propType: leg.propType,
        side: leg.side,
        originalLine: leg.line,
        originalBook: leg.book
      }))

      const fdLegs = []
      const dkLegs = []

      for (const key of keys) {
        const matching = (oddsSnapshot.props || []).filter((row) =>
          row.player === key.player &&
          row.propType === key.propType &&
          row.side === key.side
        )

        const fd = pickBestForBook(
          matching.filter((row) => row.book === "FanDuel"),
          key.side
        )
        const dk = pickBestForBook(
          matching.filter((row) => row.book === "DraftKings"),
          key.side
        )

        if (fd) fdLegs.push(fd)
        if (dk) dkLegs.push(dk)
      }

      const fdPrice = fdLegs.length === keys.length ? parlayPriceFromLegs(fdLegs) : null
      const dkPrice = dkLegs.length === keys.length ? parlayPriceFromLegs(dkLegs) : null

      let bestBook = null
      if (fdPrice && dkPrice) bestBook = fdPrice.decimal > dkPrice.decimal ? "FanDuel" : "DraftKings"
      else if (fdPrice) bestBook = "FanDuel"
      else if (dkPrice) bestBook = "DraftKings"

      return {
        label,
        legs: keys,
        fanduel: fdPrice ? { legs: fdLegs, price: fdPrice } : null,
        draftkings: dkPrice ? { legs: dkLegs, price: dkPrice } : null,
        bestBook
      }
    }

    res.json({
      safest2: compareSlip(parlays.safest2 || [], "Safest 2"),
      safest3: compareSlip(parlays.safest3 || [], "Safest 3"),
      safest4: compareSlip(parlays.safest4 || [], "Safest 4"),
      best2: compareSlip(parlays.best2 || [], "Best 2-Leg"),
      best3: compareSlip(parlays.best3 || [], "Best 3-Leg"),
      best4: compareSlip(parlays.best4 || [], "Best 4-Leg"),
      best5: compareSlip(parlays.best5 || [], "Best 5-Leg"),
      best6: compareSlip(parlays.best6 || [], "Best 6-Leg"),
      best7: compareSlip(parlays.best7 || [], "Best 7-Leg")
    })
  } catch (error) {
    res.status(500).json({
      error: "Parlay comparison failed",
      details: error.message
    })
  }
})


app.get("/parlays/dual", async (req, res) => {
  try {
    console.log("[DUAL-TRACE] route hit")
    // NOTE: /parlays/dual does NOT call buildLiveDualBestAvailablePayload.
    // It builds slips inline using buildHighestHitRateBookSlip + buildPayoutFitPortfolio.
    // buildLiveDualBestAvailablePayload is only used by /api/best-available.
    console.log("[PAYLOAD-DEBUG] ROUTE /parlays/dual — does NOT use buildLiveDualBestAvailablePayload — builds inline")
    console.log("[PAYLOAD-DEBUG] /parlays/dual oddsSnapshot counts:", {
      bestProps: (oddsSnapshot.bestProps || []).length,
      eliteProps: (oddsSnapshot.eliteProps || []).length,
      strongProps: (oddsSnapshot.strongProps || []).length,
      playableProps: (oddsSnapshot.playableProps || []).length
    })
    console.log("[route-hit] GET /parlays/dual", new Date().toISOString())
    const dualBestPropsPool = getAvailablePrimarySlateRows(oddsSnapshot.bestProps || [])
    console.log("[DUAL-BESTPROPS-POOL-DEBUG]", {
      total: dualBestPropsPool.length,
      fanduel: dualBestPropsPool.filter(r => r.book === "FanDuel").length,
      draftkings: dualBestPropsPool.filter(r => r.book === "DraftKings").length
    })

    const allRows = [
      ...(oddsSnapshot.eliteProps || []),
      ...(oddsSnapshot.strongProps || []),
      ...(oddsSnapshot.playableProps || []),
      ...(oddsSnapshot.bestProps || []),
      ...(oddsSnapshot.props || [])
    ]

    const byBook = (legs, book, requiredLegCount = null) => {
      const out = []

      if (requiredLegCount !== null && (!legs || legs.length !== requiredLegCount)) {
        return null
      }

      for (const leg of legs) {
        const matches = allRows.filter((row) =>
          row.player === leg.player &&
          row.propType === leg.propType &&
          row.side === leg.side &&
          Number(row.line) === Number(leg.line) &&
          row.book === book
        )

        if (!matches.length) return null

        const match =
          matches.find((row) => row.score !== undefined) ||
          matches.find((row) => row.dvpScore !== undefined) ||
          matches[0]

        out.push(match)
      }

      const price = parlayPriceFromLegs(out)
      if (!price) return null

      const trueProbability = trueParlayProbabilityFromLegs(out)
      return {
        book,
        legs: out,
        price,
        projectedReturn: estimateReturn(5, price.american),
        trueProbability,
        confidence: confidenceFromLegs(out)
      }
    }


    const formatPayoutLabel = (baseLabel, payout) => {
      const value = Number(payout || 0)
      if (!value) return baseLabel
      return `${baseLabel} ($${value.toFixed(2)})`
    }

    const addSlipLabel = (baseLabel, slip) => {
      if (!slip) return null
      return {
        ...slip,
        label: formatPayoutLabel(baseLabel, slip.projectedReturn)
      }
    }

    const isDualEmergencyAcceptedSize = (book, targetLegCount, legCount) => {
      if (book === "DraftKings" && targetLegCount === 3 && legCount === 2) return true
      if (book === "DraftKings" && targetLegCount === 4 && legCount === 3) return true
      if (book === "FanDuel" && targetLegCount === 3 && legCount === 2) return true
      if (book === "FanDuel" && targetLegCount === 4 && legCount === 3) return true
      return false
    }

    const buildDualEmergencySlipObject = (book, legs, labelPrefix) => {
      if (!Array.isArray(legs) || legs.length < 2) return null
      const price = parlayPriceFromLegs(legs)
      if (!price) return null
      const projectedReturn = estimateReturn(5, price.american)
      const trueProbability = trueParlayProbabilityFromLegs(legs)
      const confidence = confidenceFromLegs(legs)
      const slip = {
        book,
        legs,
        price,
        projectedReturn,
        trueProbability,
        confidence,
        label: formatPayoutLabel(`${book} ${labelPrefix}`, projectedReturn)
      }
      return isValidSlipObject(slip, null) ? slip : null
    }

    const fdRaw6 = buildHighestHitRateBookSlip("FanDuel", 6, dualBestPropsPool)
    console.log("[FD-DEEP-RAW-DEBUG]", {
      target: 6,
      rawLen: Array.isArray(fdRaw6) ? fdRaw6.length : 0
    })
    const fdRaw7 = buildHighestHitRateBookSlip("FanDuel", 7, dualBestPropsPool)
    console.log("[FD-DEEP-RAW-DEBUG]", {
      target: 7,
      rawLen: Array.isArray(fdRaw7) ? fdRaw7.length : 0
    })
    const fdRaw8 = buildHighestHitRateBookSlip("FanDuel", 8, dualBestPropsPool)
    console.log("[FD-DEEP-RAW-DEBUG]", {
      target: 8,
      rawLen: Array.isArray(fdRaw8) ? fdRaw8.length : 0
    })
    const fdRaw9 = buildHighestHitRateBookSlip("FanDuel", 9, dualBestPropsPool)
    console.log("[FD-DEEP-RAW-DEBUG]", {
      target: 9,
      rawLen: Array.isArray(fdRaw9) ? fdRaw9.length : 0
    })
    const fdRaw10 = buildHighestHitRateBookSlip("FanDuel", 10, dualBestPropsPool)
    console.log("[FD-DEEP-RAW-DEBUG]", {
      target: 10,
      rawLen: Array.isArray(fdRaw10) ? fdRaw10.length : 0
    })

    const fdSlips = {
      highestHitRate2: makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 2, dualBestPropsPool), "Highest Hit Rate 2-Leg"),
      highestHitRate3: makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 3, dualBestPropsPool), "Highest Hit Rate 3-Leg"),
      highestHitRate4: makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 4, dualBestPropsPool), "Highest Hit Rate 4-Leg"),
      highestHitRate5: makeSlipObject("FanDuel", buildHighestHitRateBookSlip("FanDuel", 5, dualBestPropsPool), "Highest Hit Rate 5-Leg"),
      highestHitRate6: makeSlipObject("FanDuel", fdRaw6, "Highest Hit Rate 6-Leg"),
      highestHitRate7: makeSlipObject("FanDuel", fdRaw7, "Highest Hit Rate 7-Leg"),
      highestHitRate8: makeSlipObject("FanDuel", fdRaw8, "Highest Hit Rate 8-Leg"),
      highestHitRate9: makeSlipObject("FanDuel", fdRaw9, "Highest Hit Rate 9-Leg"),
      highestHitRate10: makeSlipObject("FanDuel", fdRaw10, "Highest Hit Rate 10-Leg")
    }

    console.log("[DUAL-SLOT-DEBUG] slot=fd4 isNull=", fdSlips.highestHitRate4 === null, "legCount=", fdSlips.highestHitRate4?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=fd5 isNull=", fdSlips.highestHitRate5 === null, "legCount=", fdSlips.highestHitRate5?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=fd6 isNull=", fdSlips.highestHitRate6 === null, "legCount=", fdSlips.highestHitRate6?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=fd7 isNull=", fdSlips.highestHitRate7 === null, "legCount=", fdSlips.highestHitRate7?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=fd8 isNull=", fdSlips.highestHitRate8 === null, "legCount=", fdSlips.highestHitRate8?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=fd9 isNull=", fdSlips.highestHitRate9 === null, "legCount=", fdSlips.highestHitRate9?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=fd10 isNull=", fdSlips.highestHitRate10 === null, "legCount=", fdSlips.highestHitRate10?.legs?.length || 0)

    const dkSlips = {
      highestHitRate2: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 2, dualBestPropsPool), "Highest Hit Rate 2-Leg"),
      highestHitRate3: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 3, dualBestPropsPool), "Highest Hit Rate 3-Leg"),
      highestHitRate4: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 4, dualBestPropsPool), "Highest Hit Rate 4-Leg"),
      highestHitRate5: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 5, dualBestPropsPool), "Highest Hit Rate 5-Leg"),
      highestHitRate6: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 6, dualBestPropsPool), "Highest Hit Rate 6-Leg"),
      highestHitRate7: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 7, dualBestPropsPool), "Highest Hit Rate 7-Leg"),
      highestHitRate8: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 8, dualBestPropsPool), "Highest Hit Rate 8-Leg"),
      highestHitRate9: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 9, dualBestPropsPool), "Highest Hit Rate 9-Leg"),
      highestHitRate10: makeSlipObject("DraftKings", buildHighestHitRateBookSlip("DraftKings", 10, dualBestPropsPool), "Highest Hit Rate 10-Leg")
    }

    console.log("[DUAL-SLOT-DEBUG] slot=dk4 isNull=", dkSlips.highestHitRate4 === null, "legCount=", dkSlips.highestHitRate4?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=dk5 isNull=", dkSlips.highestHitRate5 === null, "legCount=", dkSlips.highestHitRate5?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=dk6 isNull=", dkSlips.highestHitRate6 === null, "legCount=", dkSlips.highestHitRate6?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=dk7 isNull=", dkSlips.highestHitRate7 === null, "legCount=", dkSlips.highestHitRate7?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=dk8 isNull=", dkSlips.highestHitRate8 === null, "legCount=", dkSlips.highestHitRate8?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=dk9 isNull=", dkSlips.highestHitRate9 === null, "legCount=", dkSlips.highestHitRate9?.legs?.length || 0)
    console.log("[DUAL-SLOT-DEBUG] slot=dk10 isNull=", dkSlips.highestHitRate10 === null, "legCount=", dkSlips.highestHitRate10?.legs?.length || 0)

    const fdLanePortfolios = buildDualLanePortfoliosForBook("FanDuel", dualBestPropsPool, Object.values(fdSlips))
    const dkLanePortfolios = buildDualLanePortfoliosForBook("DraftKings", dualBestPropsPool, Object.values(dkSlips))
    const fdPayoutFitPortfolio = buildPayoutFitPortfolio("FanDuel", Object.values(fdSlips), dualBestPropsPool, { dualMode: true, dualUsablePool: dualBestPropsPool })
    const dkPayoutFitPortfolio = buildPayoutFitPortfolio("DraftKings", Object.values(dkSlips), dualBestPropsPool, { dualMode: true, dualUsablePool: dualBestPropsPool })

    const fdLottoBatchOptions = Array.isArray(fdLanePortfolios?.lottoBatchPortfolio?.options) && fdLanePortfolios.lottoBatchPortfolio.options.length
      ? fdLanePortfolios.lottoBatchPortfolio.options
      : (fdPayoutFitPortfolio?.lottoBatch?.options || [])
    const dkLottoBatchOptions = Array.isArray(dkLanePortfolios?.lottoBatchPortfolio?.options) && dkLanePortfolios.lottoBatchPortfolio.options.length
      ? dkLanePortfolios.lottoBatchPortfolio.options
      : (dkPayoutFitPortfolio?.lottoBatch?.options || [])

    const dualResponse = buildDualParlaysResponseShape({
      bestAvailable: {
        highestHitRate2: { fanduel: fdSlips.highestHitRate2, draftkings: dkSlips.highestHitRate2 },
        highestHitRate3: { fanduel: fdSlips.highestHitRate3, draftkings: dkSlips.highestHitRate3 },
        highestHitRate4: { fanduel: fdSlips.highestHitRate4, draftkings: dkSlips.highestHitRate4 },
        highestHitRate5: { fanduel: fdSlips.highestHitRate5, draftkings: dkSlips.highestHitRate5 },
        highestHitRate6: { fanduel: fdSlips.highestHitRate6, draftkings: dkSlips.highestHitRate6 },
        highestHitRate7: { fanduel: fdSlips.highestHitRate7, draftkings: dkSlips.highestHitRate7 },
        highestHitRate8: { fanduel: fdSlips.highestHitRate8, draftkings: dkSlips.highestHitRate8 },
        highestHitRate9: { fanduel: fdSlips.highestHitRate9, draftkings: dkSlips.highestHitRate9 },
        highestHitRate10: { fanduel: fdSlips.highestHitRate10, draftkings: dkSlips.highestHitRate10 }
      },
      payoutFitPortfolio: {
        fanduel: fdPayoutFitPortfolio,
        draftkings: dkPayoutFitPortfolio
      },
      recoupPortfolio: {
        fanduel: fdLanePortfolios.recoupPortfolio,
        draftkings: dkLanePortfolios.recoupPortfolio
      },
      conservativePortfolio: {
        fanduel: fdLanePortfolios.conservativePortfolio,
        draftkings: dkLanePortfolios.conservativePortfolio
      },
      midUpsidePortfolio: {
        fanduel: fdLanePortfolios.midUpsidePortfolio,
        draftkings: dkLanePortfolios.midUpsidePortfolio
      },
      lottoBatchPortfolio: {
        fanduel: {
          ...(fdLanePortfolios.lottoBatchPortfolio || {}),
          options: fdLottoBatchOptions
        },
        draftkings: {
          ...(dkLanePortfolios.lottoBatchPortfolio || {}),
          options: dkLottoBatchOptions
        }
      }
    })

    console.log("[PAYOUT-PORTFOLIO] DraftKings portfolio keys:", Object.keys(dualResponse?.payoutFitPortfolio?.draftkings || {}))
    console.log("[PAYLOAD-DEBUG] /parlays/dual SUMMARY route=/parlays/dual bestPropsInSnapshot:", (oddsSnapshot.bestProps || []).length,
      "eliteProps:", (oddsSnapshot.eliteProps || []).length,
      "strongProps:", (oddsSnapshot.strongProps || []).length,
      "playableProps:", (oddsSnapshot.playableProps || []).length
    )
    console.log("[ROUTE-FINAL-DEBUG] /parlays/dual", {
      bestPropsRaw: (oddsSnapshot.bestProps || []).length,
      playablePropsRaw: (oddsSnapshot.playableProps || []).length,
      strongPropsRaw: (oddsSnapshot.strongProps || []).length,
      elitePropsRaw: (oddsSnapshot.eliteProps || []).length
    })

    const payloadBestKeys = new Set()
    const collectPayloadLegKeys = (node) => {
      if (!node) return
      if (Array.isArray(node)) {
        for (const item of node) collectPayloadLegKeys(item)
        return
      }
      if (typeof node !== "object") return
      if (Array.isArray(node.legs)) {
        for (const leg of node.legs) {
          const key = `${leg.player || leg.playerName || ""}|${leg.propType || leg.statType || ""}|${leg.side || ""}|${Number(leg.line)}|${leg.book || ""}`
          payloadBestKeys.add(key)
        }
      }
      for (const value of Object.values(node)) collectPayloadLegKeys(value)
    }
    collectPayloadLegKeys(dualResponse)
    console.log(`[FINAL-ROUTE-COUNTS] route=/parlays/dual bestPropsRaw=${(oddsSnapshot.bestProps || []).length} payloadBest=${payloadBestKeys.size}`)
    console.log("[DUAL-COVERAGE-DEBUG]", {
      fd6: Boolean(dualResponse?.bestAvailable?.highestHitRate6?.fanduel),
      fdLotto: Number(dualResponse?.payoutFitPortfolio?.fanduel?.lotto?.options?.length || 0),
      dkBig: Number(dualResponse?.payoutFitPortfolio?.draftkings?.bigUpside?.options?.length || 0),
      dkLotto: Number(dualResponse?.payoutFitPortfolio?.draftkings?.lotto?.options?.length || 0)
    })

    console.log("[DUAL-TRACE FINAL]", {
      fd6: dualResponse?.bestAvailable?.highestHitRate6?.fanduel,
      dk6: dualResponse?.bestAvailable?.highestHitRate6?.draftkings,
      fd7: dualResponse?.bestAvailable?.highestHitRate7?.fanduel,
      dk7: dualResponse?.bestAvailable?.highestHitRate7?.draftkings,
      fd8: dualResponse?.bestAvailable?.highestHitRate8?.fanduel,
      dk8: dualResponse?.bestAvailable?.highestHitRate8?.draftkings,
      fd9: dualResponse?.bestAvailable?.highestHitRate9?.fanduel,
      dk9: dualResponse?.bestAvailable?.highestHitRate9?.draftkings,
      fd10: dualResponse?.bestAvailable?.highestHitRate10?.fanduel,
      dk10: dualResponse?.bestAvailable?.highestHitRate10?.draftkings,
      fdLotto: dualResponse?.bestAvailable?.payoutFitPortfolio?.fanduel?.lotto?.options?.length,
      dkLotto: dualResponse?.bestAvailable?.payoutFitPortfolio?.draftkings?.lotto?.options?.length
    })

    console.log("[DUAL-FINAL-COVERAGE-DEBUG]", {
      fd3: Boolean(dualResponse?.bestAvailable?.highestHitRate3?.fanduel),
      fd4: Boolean(dualResponse?.bestAvailable?.highestHitRate4?.fanduel),
      fd5: Boolean(dualResponse?.bestAvailable?.highestHitRate5?.fanduel),
      fd6: Boolean(dualResponse?.bestAvailable?.highestHitRate6?.fanduel),
      dk3: Boolean(dualResponse?.bestAvailable?.highestHitRate3?.draftkings),
      dk4: Boolean(dualResponse?.bestAvailable?.highestHitRate4?.draftkings),
      dk5: Boolean(dualResponse?.bestAvailable?.highestHitRate5?.draftkings),
      dk6: Boolean(dualResponse?.bestAvailable?.highestHitRate6?.draftkings),
      fdLottoCount: Number(dualResponse?.payoutFitPortfolio?.fanduel?.lotto?.options?.length || 0),
      dkLottoCount: Number(dualResponse?.payoutFitPortfolio?.draftkings?.lotto?.options?.length || 0)
    })

    console.log("[DUAL-HIGHRATE-COVERAGE-DEBUG]", {
      fd2: dualResponse.bestAvailable?.highestHitRate2?.fanduel?.legs?.length || 0,
      fd3: dualResponse.bestAvailable?.highestHitRate3?.fanduel?.legs?.length || 0,
      fd4: dualResponse.bestAvailable?.highestHitRate4?.fanduel?.legs?.length || 0,
      fd5: dualResponse.bestAvailable?.highestHitRate5?.fanduel?.legs?.length || 0,
      dk2: dualResponse.bestAvailable?.highestHitRate2?.draftkings?.legs?.length || 0,
      dk3: dualResponse.bestAvailable?.highestHitRate3?.draftkings?.legs?.length || 0,
      dk4: dualResponse.bestAvailable?.highestHitRate4?.draftkings?.legs?.length || 0,
      dk5: dualResponse.bestAvailable?.highestHitRate5?.draftkings?.legs?.length || 0
    })

    const snapshotMeta = logSnapshotMeta("route=/parlays/dual response")
    res.json({
      ...dualResponse,
      snapshotMeta
    })
  } catch (error) {
    res.status(500).json({
      error: "Dual-mode parlay engine failed",
      details: error.message
    })
  }
})

app.get("/snapshot/status", async (req, res) => {
  try {
    const forceRefresh = req.query.force === "1" || req.query.force === "true"
    const now = Date.now()
    const cooldownRemainingMs = Math.max(0, SNAPSHOT_COOLDOWN_MS - Math.max(0, now - lastSnapshotRefreshAt))
    const cooldownRemainingSeconds = Math.ceil(cooldownRemainingMs / 1000)
    const forceRefreshAvailable = cooldownRemainingMs === 0
    const snapshotSource = oddsSnapshot.updatedAt ? "Cached" : "Unknown"
    const slateMeta = getSlateModeFromEvents(oddsSnapshot.events || [])

    lastSnapshotSource = forceRefresh ? "force-refresh-live" : "refresh-live"
    lastSnapshotSavedAt = Date.now()
    lastSnapshotAgeMinutes = 0
    if (forceRefresh) lastForceRefreshAt = new Date().toISOString()

    res.json({
      ok: true,
      updatedAt: oddsSnapshot.updatedAt,
      updatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
      primarySlateDateLocal: getPrimarySlateDateKeyFromRows(oddsSnapshot.props || []),
      snapshotSource,
      slateMode: slateMeta.slateMode,
      eligibleRemainingGames: slateMeta.eligibleRemainingGames,
      totalEligibleGames: slateMeta.totalEligibleGames,
      startedEligibleGames: slateMeta.startedEligibleGames,
      cooldownMs: SNAPSHOT_COOLDOWN_MS,
      cooldownRemainingMs,
      cooldownRemainingSeconds,
      forceRefreshAvailable,
      events: (oddsSnapshot.events || []).length,
      props: (oddsSnapshot.props || []).length,
      bestProps: (oddsSnapshot.bestProps || []).length
    })
  } catch (error) {
    res.status(500).json({
      error: "Snapshot status failed",
      details: error.message
    })
  }
})

app.get("/refresh-snapshot", async (req, res) => {
  console.log("[SNAPSHOT-DEBUG] START refresh-snapshot")
  console.log("[TOP-DOWN-REFRESH-ENTRY]", {
    snapshotSource: lastSnapshotSource || "unknown",
    snapshotLoadedFromDisk,
    updatedAt: oddsSnapshot?.updatedAt || null,
    events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
    rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
    props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
    bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1,
    forceQuery: req.query.force || null
  })
  try {
    resetFragileFilterAdjustedLogCount()
    const previousSnapshot = oddsSnapshot && typeof oddsSnapshot === "object"
      ? {
          ...oddsSnapshot,
          events: Array.isArray(oddsSnapshot.events) ? [...oddsSnapshot.events] : [],
          rawProps: Array.isArray(oddsSnapshot.rawProps) ? [...oddsSnapshot.rawProps] : [],
          props: Array.isArray(oddsSnapshot.props) ? [...oddsSnapshot.props] : [],
          eliteProps: Array.isArray(oddsSnapshot.eliteProps) ? [...oddsSnapshot.eliteProps] : [],
          strongProps: Array.isArray(oddsSnapshot.strongProps) ? [...oddsSnapshot.strongProps] : [],
          playableProps: Array.isArray(oddsSnapshot.playableProps) ? [...oddsSnapshot.playableProps] : [],
          bestProps: Array.isArray(oddsSnapshot.bestProps) ? [...oddsSnapshot.bestProps] : [],
          flexProps: Array.isArray(oddsSnapshot.flexProps) ? [...oddsSnapshot.flexProps] : [],
          diagnostics: oddsSnapshot.diagnostics && typeof oddsSnapshot.diagnostics === "object"
            ? { ...oddsSnapshot.diagnostics }
            : {}
        }
      : null
    const previousSnapshotForCarry = {
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? [...oddsSnapshot.rawProps] : [],
      props: Array.isArray(oddsSnapshot?.props) ? [...oddsSnapshot.props] : []
    }

    const cloneSnapshotForFallback = (snapshot) => (
      snapshot && typeof snapshot === "object"
        ? {
            ...snapshot,
            events: Array.isArray(snapshot.events) ? [...snapshot.events] : [],
            rawProps: Array.isArray(snapshot.rawProps) ? [...snapshot.rawProps] : [],
            props: Array.isArray(snapshot.props) ? [...snapshot.props] : [],
            eliteProps: Array.isArray(snapshot.eliteProps) ? [...snapshot.eliteProps] : [],
            strongProps: Array.isArray(snapshot.strongProps) ? [...snapshot.strongProps] : [],
            playableProps: Array.isArray(snapshot.playableProps) ? [...snapshot.playableProps] : [],
            bestProps: Array.isArray(snapshot.bestProps) ? [...snapshot.bestProps] : [],
            flexProps: Array.isArray(snapshot.flexProps) ? [...snapshot.flexProps] : [],
            diagnostics: snapshot.diagnostics && typeof snapshot.diagnostics === "object"
              ? { ...snapshot.diagnostics }
              : {},
            parlays: snapshot.parlays ?? null,
            dualParlays: snapshot.dualParlays ?? null
          }
        : null
    )

    const currentSnapshotFallback = cloneSnapshotForFallback(oddsSnapshot)

    let diskSnapshotFallback = null
    try {
      const snapshotPath = path.join(__dirname, "snapshot.json")
      if (fs.existsSync(snapshotPath)) {
        const rawDiskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"))
        diskSnapshotFallback = cloneSnapshotForFallback(rawDiskSnapshot?.data || null)
      }
    } catch (diskReadError) {
      console.log("[SNAPSHOT-FALLBACK-DISK-READ-FAILED]", {
        message: diskReadError?.message || null
      })
    }

    const getSnapshotStrength = (snapshot) => {
      const rawPropsCount = Array.isArray(snapshot?.rawProps) ? snapshot.rawProps.length : 0
      const bestPropsCount = Array.isArray(snapshot?.bestProps) ? snapshot.bestProps.length : 0
      const propsCount = Array.isArray(snapshot?.props) ? snapshot.props.length : 0
      return rawPropsCount * 1000000 + bestPropsCount * 1000 + propsCount
    }

    const preferredSnapshotFallback =
      getSnapshotStrength(diskSnapshotFallback) > getSnapshotStrength(currentSnapshotFallback)
        ? diskSnapshotFallback
        : currentSnapshotFallback

    const replayModeRequested = isNbaOddsReplayRequest(req)
    if (replayModeRequested) {
      return sendNbaReplayRefreshResponse(res, {
        routeTag: "refresh-snapshot",
        logTag: "[SLATE-SELECTION-DEBUG-REPLAY-MODE]"
      })
    }

    const forceRefresh = String(req.query.force || "").toLowerCase() === "1" ||
      String(req.query.force || "").toLowerCase() === "true"

    if (forceRefresh) {
      lastForceRefreshAt = new Date().toISOString()
    }
    console.log("[FORCE-REFRESH-DEBUG]", {
      forceFlag: forceRefresh,
      lastForceRefreshAt
    })

    if (forceRefresh) {
      console.log("[SNAPSHOT-DEBUG] FORCE REFRESH ROUTE HIT")
      // Force refresh: clear in-memory snapshot to ensure completely fresh rebuild
      oddsSnapshot = {
        updatedAt: null,
        events: [],
        props: [],
        bestProps: [],
        eliteProps: [],
        strongProps: [],
        playableProps: [],
        flexProps: []
      }
    }

    const snapshotAgeMinutes = oddsSnapshot?.updatedAt
      ? (Date.now() - new Date(oddsSnapshot.updatedAt).getTime()) / 60000
      : null

    const buildCachedRefreshResponse = ({
      cacheReason = null,
      includePrimarySlateDateLocal = false,
      includeSnapshotSlateFields = false,
      includeLegacyFreshSnapshotReason = false
    } = {}) => {
      const cachedScheduledEvents = Array.isArray(oddsSnapshot.events) ? oddsSnapshot.events : []
      const cachedRawPropsRows = Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props : []
      const cachedEnrichedModelRows = dedupeByLegSignature([
        ...(Array.isArray(oddsSnapshot.eliteProps) ? oddsSnapshot.eliteProps : []),
        ...(Array.isArray(oddsSnapshot.strongProps) ? oddsSnapshot.strongProps : []),
        ...(Array.isArray(oddsSnapshot.playableProps) ? oddsSnapshot.playableProps : []),
        ...(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])
      ])
      const cachedSurvivedFragileRows = cachedRawPropsRows.filter((row) => {
        try {
          return !isFragileLeg(row, "best")
        } catch (_) {
          return true
        }
      })
      const cachedBestPropsRawRows = Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []
      const cachedFinalBestVisibleRows = getAvailablePrimarySlateRows(cachedBestPropsRawRows)
      const __normalizedFamilySummary = summarizeInterestingNormalizedRows(cachedRawPropsRows || [])
      const __normalizedCoverageSummary = summarizeNormalizedMarketCoverage(cachedRawPropsRows || [])

      console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", __normalizedFamilySummary)
      console.log("[NORMALIZATION-MARKET-KEYS-TOP-DEBUG]", {
        totalRows: __normalizedCoverageSummary.totalRows,
        topPropTypes: Object.entries(__normalizedCoverageSummary.byPropType || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15),
        topMarketKeys: Object.entries(__normalizedCoverageSummary.byMarketKey || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25),
        byBookAndPropType: __normalizedCoverageSummary.byBookAndPropType || {}
      })
      console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
        path: cacheReason || "refresh-snapshot-cached",
        scheduledEvents: cachedScheduledEvents.length,
        rawPropsRows: cachedRawPropsRows.length,
        enrichedModelRows: cachedEnrichedModelRows.length,
        survivedFragileRows: cachedSurvivedFragileRows.length,
        survivedFragileRowsByBook: {
          FanDuel: cachedSurvivedFragileRows.filter((r) => r?.book === "FanDuel").length,
          DraftKings: cachedSurvivedFragileRows.filter((r) => r?.book === "DraftKings").length
        },
        bestPropsRawRows: cachedBestPropsRawRows.length,
        bestPropsRawRowsByBook: {
          FanDuel: cachedBestPropsRawRows.filter((r) => r?.book === "FanDuel").length,
          DraftKings: cachedBestPropsRawRows.filter((r) => r?.book === "DraftKings").length
        },
        finalBestVisibleRows: cachedFinalBestVisibleRows.length
      })
      runCurrentSlateCoverageDiagnostics({
        scheduledEvents: cachedScheduledEvents,
        rawPropsRows: cachedRawPropsRows,
        enrichedModelRows: cachedEnrichedModelRows,
        survivedFragileRows: cachedSurvivedFragileRows,
        bestPropsRawRows: cachedBestPropsRawRows,
        finalBestVisibleRows: cachedFinalBestVisibleRows
      })

      const slateMeta = getSlateModeFromEvents(oddsSnapshot.events || [])
      const response = {
        ok: true,
        cached: true,
        updatedAt: oddsSnapshot.updatedAt,
        snapshotGeneratedAt: oddsSnapshot?.snapshotGeneratedAt || oddsSnapshot?.updatedAt || null,
        snapshotSlateDateLocal:
          oddsSnapshot?.snapshotSlateDateLocal ||
          oddsSnapshot?.snapshotSlateDateKey ||
          (oddsSnapshot?.updatedAt ? toDetroitDateKey(oddsSnapshot.updatedAt) : null),
        updatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
        slateMode: slateMeta.slateMode,
        eligibleRemainingGames: slateMeta.eligibleRemainingGames,
        totalEligibleGames: slateMeta.totalEligibleGames,
        startedEligibleGames: slateMeta.startedEligibleGames,
        events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : 0,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
        slateStateValidator: oddsSnapshot?.slateStateValidator || null,
        lineHistorySummary: oddsSnapshot?.lineHistorySummary || null
      }

      if (cacheReason) response.cacheReason = cacheReason
      if (includePrimarySlateDateLocal) {
        response.primarySlateDateLocal = getPrimarySlateDateKeyFromRows(oddsSnapshot.props || [])
      }
      if (includeSnapshotSlateFields) {
        response.snapshotSlateDateKey = oddsSnapshot.snapshotSlateDateKey || null
        response.snapshotSlateGameCount = oddsSnapshot.snapshotSlateGameCount || 0
      }
      if (includeLegacyFreshSnapshotReason) {
        response.reason = "fresh_snapshot"
      }

      return response
    }

    const shouldSkipRebuild =
      snapshotLoadedFromDisk &&
      snapshotAgeMinutes !== null &&
      snapshotAgeMinutes < 10

    if (shouldSkipRebuild) {
      console.log("[TOP-DOWN-REFRESH-SKIP-REBUILD]", {
        reason: "shouldSkipRebuild",
        snapshotLoadedFromDisk,
        snapshotAgeMinutes,
        events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1
      })
      console.log("[SNAPSHOT-CACHE] skipping rebuild, using cached snapshot", {
        snapshotAgeMinutes
      })
      return res.json(buildCachedRefreshResponse({
        cacheReason: "refresh-snapshot-cached-skip-rebuild",
        includeLegacyFreshSnapshotReason: true
      }))
    }

    if (
      !forceRefresh &&
      oddsSnapshot.updatedAt &&
      oddsSnapshot.events.length &&
      oddsSnapshot.props.length &&
      (!snapshotLoadedFromDisk || (snapshotAgeMinutes !== null && snapshotAgeMinutes < 10))
    ) {
      console.log("[TOP-DOWN-REFRESH-SKIP-CACHED]", {
        reason: "cached_snapshot_still_valid",
        snapshotLoadedFromDisk,
        snapshotAgeMinutes,
        events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1
      })
      return res.json(buildCachedRefreshResponse({
        cacheReason: "refresh-snapshot-cached-shortcut",
        includePrimarySlateDateLocal: true
      }))
    }

    const now = Date.now()
    const msSinceLast = now - lastSnapshotRefreshAt

    if (msSinceLast < SNAPSHOT_COOLDOWN_MS && !forceRefresh) {
      return res.status(429).json({
        error: "Snapshot refresh cooldown active",
        retryInSeconds: Math.ceil((SNAPSHOT_COOLDOWN_MS - msSinceLast) / 1000),
        lastUpdatedAt: oddsSnapshot.updatedAt,
        lastUpdatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
        primarySlateDateLocal: getPrimarySlateDateKeyFromRows(oddsSnapshot.props || [])
      })
    }

    if (!ensureNbaRefreshEnvConfigured(res)) {
      return
    }

    // Same-slate cache guard: skip live API calls if snapshot is fresh and for a valid slate
    const slateCacheSnapshotAge = oddsSnapshot?.updatedAt
      ? (Date.now() - new Date(oddsSnapshot.updatedAt).getTime()) / 60000
      : null
    const slateCacheHasEvents = Array.isArray(oddsSnapshot?.events) && oddsSnapshot.events.length > 0
    const slateCacheHasSlateKey = Boolean(oddsSnapshot?.snapshotSlateDateKey)
    const slateCacheIsFresh = slateCacheSnapshotAge !== null && slateCacheSnapshotAge <= 10

    if (
      !forceRefresh &&
      slateCacheHasSlateKey &&
      slateCacheHasEvents &&
      slateCacheIsFresh
    ) {
      console.log("[REFRESH-CACHE-HIT-SAME-SLATE]", {
        snapshotSlateDateKey: oddsSnapshot.snapshotSlateDateKey,
        snapshotSlateGameCount: oddsSnapshot.snapshotSlateGameCount || 0,
        snapshotAgeMinutes: Math.round((slateCacheSnapshotAge || 0) * 10) / 10,
        events: oddsSnapshot.events.length,
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0
      })

      return res.json(buildCachedRefreshResponse({
        cacheReason: "same-slate-fresh",
        includeSnapshotSlateFields: true
      }))
    }

    const {
      allEvents,
      scheduledEvents: rawScheduledEvents
    } = await fetchNbaUnrestrictedSlateEvents()

    // Smart slate selection: today vs tomorrow
    const slateNow = Date.now()
    const todayDateKey = toDetroitDateKey(slateNow)
    const tomorrowDateKey = toDetroitDateKey(slateNow + 24 * 60 * 60 * 1000)

    const getEventTime = (event) =>
      event?.commence_time || event?.gameTime || event?.startTime || event?.start_time || event?.game_time || ""

    const todayEvents = (Array.isArray(allEvents) ? allEvents : []).filter((event) =>
      toDetroitDateKey(getEventTime(event)) === todayDateKey
    )
    const tomorrowEvents = (Array.isArray(allEvents) ? allEvents : []).filter((event) =>
      toDetroitDateKey(getEventTime(event)) === tomorrowDateKey
    )
    const todayPregameEligible = todayEvents.filter((event) => {
      const eventMs = new Date(getEventTime(event)).getTime()
      return Number.isFinite(eventMs) && eventMs > slateNow
    })

    let chosenSlateDateKey = todayDateKey
    let scheduledEvents = todayPregameEligible

    if (todayPregameEligible.length === 0 && tomorrowEvents.length > 0) {
      chosenSlateDateKey = tomorrowDateKey
      scheduledEvents = tomorrowEvents
    }

    console.log("[SLATE-SELECTION-DEBUG]", {
      now: new Date(slateNow).toISOString(),
      todayDateKey,
      tomorrowDateKey,
      todayEventCount: todayEvents.length,
      todayPregameEligibleCount: todayPregameEligible.length,
      tomorrowEventCount: tomorrowEvents.length,
      chosenSlateDateKey,
      chosenEventCount: scheduledEvents.length,
      chosenEvents: scheduledEvents.map((e) => ({
        eventId: e?.id || e?.eventId || null,
        matchup: `${e?.away_team || e?.awayTeam || "?"} @ ${e?.home_team || e?.homeTeam || "?"}`
      }))
    })

    console.log("[REFRESH-STAGE-1-SCHEDULED-EVENTS]", {
      scheduledEvents: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
      sampleEventIds: Array.isArray(scheduledEvents) ? scheduledEvents.slice(0, 5).map((e) => e?.id || e?.eventId || null) : [],
      sampleMatchups: Array.isArray(scheduledEvents) ? scheduledEvents.slice(0, 5).map((e) => `${e?.away_team || e?.awayTeam || "?"} @ ${e?.home_team || e?.homeTeam || "?"}`) : []
    })

    let dkScopedFetchedEvents = null
    if (ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH) {
      try {
        dkScopedFetchedEvents = await fetchDkScopedEventsForDebug(ODDS_API_KEY)
      } catch (error) {
        const outOfCredits =
          error?.response?.status === 401 &&
          String(error?.response?.data?.error_code || "") === "OUT_OF_USAGE_CREDITS"

        if (outOfCredits) {
          console.log("[DK-SCOPED-EVENTS-DEBUG-SKIPPED] out of usage credits", {
            status: error?.response?.status || null,
            errorCode: error?.response?.data?.error_code || null,
            message: error?.response?.data?.message || error?.message || null
          })
          dkScopedFetchedEvents = null
        } else {
          throw error
        }
      }
    } else {
      console.log("[DK-SCOPED-EVENTS-DEBUG-SKIPPED] disabled by ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH=false")
    }
    const {
      scheduledEvents: dkScopedScheduledEvents
    } = dkScopedFetchedEvents != null ? await buildSlateEvents({
      oddsApiKey: ODDS_API_KEY,
      now: Date.now(),
      events: dkScopedFetchedEvents
    }) : { scheduledEvents: [] }

    const unrestrictedEventIds = [...new Set((Array.isArray(allEvents) ? allEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const scheduledEventIds = [...new Set((Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const dkScopedEventIds = [...new Set((Array.isArray(dkScopedScheduledEvents) ? dkScopedScheduledEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const rawApiEventIds = dkScopedEventIds
    const missingFromDkButInScheduled = scheduledEventIds.filter((eventId) => !dkScopedEventIds.includes(eventId))
    if (!scheduledEvents.length) {
      return res.status(404).json({
        error: "No upcoming NBA games found for the primary slate"
      })
    }
    const primarySlateDateLocal = scheduledEvents[0]
      ? new Date(getEventTimeForDebug(scheduledEvents[0])).toLocaleDateString("en-US", {
          timeZone: "America/Detroit"
        })
      : null
    console.log("[EVENT-FETCH-INTEGRITY-DEBUG]", {
      unrestrictedEventFetchCount: unrestrictedEventIds.length,
      unrestrictedEventIds,
      scheduledEventCount: scheduledEvents.length,
      scheduledEventIds,
      dkScopedEventFetchCount: dkScopedEventIds.length,
      dkScopedEventIds,
      missingFromDkButInScheduled
    })
    console.log("[EVENT-FETCH-MATCHUP-INTEGRITY-DEBUG]", {
      scheduledMatchups: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => getEventMatchupForDebug(event)),
      dkScopedMatchups: (Array.isArray(dkScopedScheduledEvents) ? dkScopedScheduledEvents : []).map((event) => getEventMatchupForDebug(event)),
      missingScheduledMatchupsFromDk: (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .filter((event) => missingFromDkButInScheduled.includes(getEventIdForDebug(event)))
        .map((event) => getEventMatchupForDebug(event))
    })
    console.log("[RAW-PROPS-PIPELINE-START]", {
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      eventIds: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => String(event?.id || event?.eventId || "")).filter(Boolean),
      matchups: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => {
        const away = event?.away_team || event?.awayTeam || ""
        const home = event?.home_team || event?.homeTeam || ""
        return away && home ? `${away} @ ${home}` : String(event?.matchup || "")
      }).filter(Boolean)
    })
    console.log("[TOP-DOWN-RAW-PROPS-INPUT]", {
      inputCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
      sampleEventIds: Array.isArray(scheduledEvents)
        ? scheduledEvents.slice(0, 5).map((item) => item?.id || item?.eventId || null)
        : [],
      sampleMatchups: Array.isArray(scheduledEvents)
        ? scheduledEvents.slice(0, 5).map((item) => `${item?.away_team || item?.awayTeam || "?"} @ ${item?.home_team || item?.homeTeam || "?"}`)
        : []
    })
    let cleaned = []
    const eventIngestDebug = []
    const previousOpenMap = new Map(
      (oddsSnapshot.props || []).map((row) => {
        const key = [row.eventId, row.player, row.propType, row.side, row.book].join("|")
        return [
          key,
          {
            openingLine: Number.isFinite(Number(row.openingLine)) ? Number(row.openingLine) : Number(row.line),
            openingOdds: Number.isFinite(Number(row.openingOdds)) ? Number(row.openingOdds) : Number(row.odds)
          }
        ]
      })
    )
    const dkRequestedMarkets = ALL_DK_MARKETS
    const scheduledEventRecords = (Array.isArray(scheduledEvents) ? scheduledEvents : [])
      .map((event) => ({
        eventId: String(event?.eventId || event?.id || ""),
        matchup: String(event?.matchup || getEventMatchupForDebug(event) || ""),
        gameTime: event?.gameTime || event?.commence_time || event?.startTime || null
      }))
      .filter((event) => event.eventId)
    const scheduledEventMap = new Map(
      (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .map((event) => [String(event?.eventId || event?.id || ""), event])
        .filter(([eventId]) => Boolean(eventId))
    )
    const settledEventAttempts = await Promise.allSettled(
      scheduledEventRecords.map(async (scheduledRecord) => {
        const sourceEvent = scheduledEventMap.get(scheduledRecord.eventId)
        if (!sourceEvent) {
          return {
            eventId: scheduledRecord.eventId,
            matchup: scheduledRecord.matchup,
            ok: false,
            empty: false,
            errorMessage: "scheduled_event_not_found",
            responseBookmakersCount: 0,
            responseMarketsCount: 0,
            normalizedRowsCount: 0,
            normalizedRows: [],
            responseReceived: false,
            requestedMarkets: dkRequestedMarkets,
            _allRows: [],
            _fetchDebug: {}
          }
        }

        const fetched = await fetchEventPlayerPropsWithCoverage(sourceEvent, previousOpenMap, {
          pathLabel: "refresh-snapshot"
        })
        const allRows = Array.isArray(fetched?.rows) ? [...fetched.rows] : []
        if (Boolean(fetched?.extraMarketsFetchSucceeded)) {
          allRows.push(...(Array.isArray(fetched?.extraRawRows) ? fetched.extraRawRows : []))
        }
        const fetchDebug = fetched?.debug || {}
        const normalizedRows = allRows.filter((row) => isActiveBook(row?.book))
        const responseBookmakersCount = Number(fetchDebug?.dkBookmakerEntries || 0)
        const responseMarketsCount = Number(fetchDebug?.dkMarketEntries || 0)

        console.log("[DK-EVENT-COVERAGE-CHECK]", {
          eventId: sourceEvent?.id || sourceEvent?.eventId,
          matchup: `${sourceEvent?.away_team || sourceEvent?.awayTeam || "?"} @ ${sourceEvent?.home_team || sourceEvent?.homeTeam || "?"}`,
          hasResponse: Boolean(fetched),
          bookmakerCount: responseBookmakersCount,
          bookmakerKeys: Array.isArray(fetchDebug?.allBookmakerSummary)
            ? fetchDebug.allBookmakerSummary.map(b => b?.key || b?.title || null)
            : [],
          hasDraftKings: responseBookmakersCount > 0,
          marketCount: responseMarketsCount,
          dkMarketKeys: Array.isArray(fetchDebug?.dkMarketKeysSeen) ? fetchDebug.dkMarketKeysSeen : [],
          normalizedRowCount: normalizedRows.length,
          totalRowCount: allRows.length
        })

        if (responseBookmakersCount === 0 || responseMarketsCount === 0) {
          console.log("[DK-EVENT-NO-DATA]", {
            eventId: sourceEvent?.id || sourceEvent?.eventId,
            matchup: `${sourceEvent?.away_team || sourceEvent?.awayTeam || "?"} @ ${sourceEvent?.home_team || sourceEvent?.homeTeam || "?"}`,
            bookmakerCount: responseBookmakersCount,
            marketCount: responseMarketsCount,
            fetchDebugKeys: Object.keys(fetchDebug),
            primaryBooksSeen: fetchDebug?.primary?.booksSeen || [],
            primaryAccepted: fetchDebug?.primary?.acceptedRows || 0,
            primaryRejected: fetchDebug?.primary?.rejectedRows || 0,
            primaryDropReasons: fetchDebug?.primary?.dropReasonCounts || {}
          })
        }

        const normalizedRowsCount = normalizedRows.length
        const empty = responseBookmakersCount === 0 || responseMarketsCount === 0 || normalizedRowsCount === 0

        return {
          eventId: scheduledRecord.eventId,
          matchup: scheduledRecord.matchup,
          ok: true,
          empty,
          errorMessage: null,
          responseBookmakersCount,
          responseMarketsCount,
          normalizedRowsCount,
          normalizedRows,
          responseReceived: true,
          requestedMarkets: Array.isArray(fetchDebug?.requestedMarkets) && fetchDebug.requestedMarkets.length
            ? fetchDebug.requestedMarkets
            : dkRequestedMarkets,
          normalizedFirstBasketRows: Array.isArray(fetched?.normalizedFirstBasketRows) ? fetched.normalizedFirstBasketRows : [],
          _allRows: allRows,
          _fetchDebug: fetchDebug
        }
      })
    )
    const eventResults = settledEventAttempts.map((settled, index) => {
      const scheduledRecord = scheduledEventRecords[index] || { eventId: "", matchup: "" }
      if (settled.status === "fulfilled") {
        return settled.value
      }
      const reason = settled.reason || {}
      return {
        eventId: scheduledRecord.eventId,
        matchup: scheduledRecord.matchup,
        ok: false,
        empty: false,
        errorMessage: String(reason?.response?.data?.message || reason?.response?.data?.error || reason?.message || reason || "unknown_error"),
        responseBookmakersCount: 0,
        responseMarketsCount: 0,
        normalizedRowsCount: 0,
        normalizedRows: [],
        responseReceived: Boolean(reason?.response || reason?.__dkFetchMeta?.responseReceived),
        requestedMarkets: Array.isArray(reason?.__dkFetchMeta?.requestedMarkets) && reason.__dkFetchMeta.requestedMarkets.length
          ? reason.__dkFetchMeta.requestedMarkets
          : dkRequestedMarkets,
        normalizedFirstBasketRows: [],
        _allRows: [],
        _fetchDebug: {}
      }
    })
    console.log("[DK-EVENT-ATTEMPT-SUMMARY]", {
      scheduledEventCount: scheduledEventRecords.length,
      attemptedEventCount: eventResults.length,
      successCount: eventResults.filter((result) => result.ok).length,
      emptyCount: eventResults.filter((result) => result.ok && result.empty).length,
      errorCount: eventResults.filter((result) => !result.ok).length,
      rowBackedEventCount: eventResults.filter((result) => (result.normalizedRowsCount || 0) > 0).length,
      missingEventAttempts: scheduledEventRecords
        .filter((scheduledRecord) => !eventResults.some((result) => result.eventId === scheduledRecord.eventId))
        .map((scheduledRecord) => ({ eventId: scheduledRecord.eventId, matchup: scheduledRecord.matchup }))
    })
    console.log("[DK-EVENT-ATTEMPT-DETAILS]", eventResults.map((result) => ({
      eventId: result.eventId,
      matchup: result.matchup,
      ok: result.ok,
      empty: result.empty,
      errorMessage: result.errorMessage,
      responseBookmakersCount: result.responseBookmakersCount,
      responseMarketsCount: result.responseMarketsCount,
      normalizedRowsCount: result.normalizedRowsCount
    })))
    for (const eventResult of eventResults) {
      if (eventResult.ok && (eventResult.normalizedRowsCount || 0) > 0) {
        console.log("[DK-EVENT-FETCH-SUCCESS]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      } else if (eventResult.ok) {
        console.log("[DK-EVENT-FETCH-EMPTY]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      } else {
        console.log("[DK-EVENT-FETCH-ERROR]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      }
    }
    console.log("[REFRESH-STAGE-2-FETCHED-EVENT-ODDS]", {
      fetchedEvents: Array.isArray(eventResults) ? eventResults.length : -1,
      sampleEventIds: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.eventId || null) : [],
      sampleBookmakerCounts: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.responseBookmakersCount || 0) : [],
      sampleMarketCounts: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.responseMarketsCount || 0) : [],
      sampleNormalizedRowCounts: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.normalizedRowsCount || 0) : [],
      totalNormalizedRows: Array.isArray(eventResults) ? eventResults.reduce((sum, e) => sum + (e?.normalizedRowsCount || 0), 0) : 0,
      erroredEvents: Array.isArray(eventResults) ? eventResults.filter((e) => !e?.ok).map((e) => ({ eventId: e?.eventId, matchup: e?.matchup, error: e?.errorMessage })) : [],
      firstEventBookmakers: (() => {
        const first = eventResults[0]?._fetchDebug?.allBookmakerSummary
        return Array.isArray(first) ? first.map((b) => ({
          key: b?.key || null,
          title: b?.title || null,
          marketCount: b?.marketCount || 0,
          sampleMarketKeys: Array.isArray(b?.sampleMarketKeys) ? b.sampleMarketKeys.slice(0, 10) : []
        })) : []
      })()
    })
    const dkFetchAudit = Array.isArray(eventResults)
      ? eventResults.slice(0, 10).map((r) => {
          const debug = r._fetchDebug || {}
          return {
            eventId: r.eventId || null,
            matchup: r.matchup || null,
            bookmakerCount: debug.primary?.bookmakerCount || 0,
            booksSeen: debug.primary?.booksSeen || [],
            hasDraftKings: (debug.dkBookmakerEntries || 0) > 0,
            dkMarketCount: debug.dkMarketEntries || 0,
            dkNormalizedRows: debug.dkNormalizedRowsProduced || 0,
            dkSampleMarketKeys: Array.isArray(debug.dkMarketKeysSeen) ? debug.dkMarketKeysSeen.slice(0, 15) : [],
            requestedMarkets: debug.requestedMarkets || [],
            dropReasonCounts: debug.primary?.dropReasonCounts || {},
            acceptedRows: debug.primary?.acceptedRows || 0,
            rejectedRows: debug.primary?.rejectedRows || 0
          }
        })
      : []
    console.log("[REFRESH-STAGE-2B-DK-AUDIT]", dkFetchAudit)

    const quotaExceededDuringRefresh = Array.isArray(eventResults)
      ? eventResults.some((attempt) => {
          const message = String(attempt?.errorMessage || "")
          return message.includes("Usage quota has been reached") || message.includes("OUT_OF_USAGE_CREDITS")
        })
      : false

    if (quotaExceededDuringRefresh) {
      const fallbackRawProps = Array.isArray(preferredSnapshotFallback?.rawProps) ? preferredSnapshotFallback.rawProps.length : 0
      const fallbackBestProps = Array.isArray(preferredSnapshotFallback?.bestProps) ? preferredSnapshotFallback.bestProps.length : 0
      const fallbackProps = Array.isArray(preferredSnapshotFallback?.props) ? preferredSnapshotFallback.props.length : 0

      console.log("[REFRESH-QUOTA-PRESERVE-SNAPSHOT]", {
        fallbackRawProps,
        fallbackProps,
        fallbackBestProps,
        usingDiskFallback: getSnapshotStrength(diskSnapshotFallback) > getSnapshotStrength(currentSnapshotFallback),
        usingMemoryFallback: getSnapshotStrength(currentSnapshotFallback) >= getSnapshotStrength(diskSnapshotFallback)
      })

      if (preferredSnapshotFallback && (fallbackRawProps > 0 || fallbackBestProps > 0 || fallbackProps > 0)) {
        oddsSnapshot = preferredSnapshotFallback
        lastSnapshotSource = "quota-preserved-cache"

        return res.status(200).json({
          ok: true,
          message: "Live refresh skipped because Odds API quota is exhausted; preserved cached snapshot",
          snapshotMeta: buildSnapshotMeta({ source: "quota-preserved-cache" }),
          counts: {
            rawProps: fallbackRawProps,
            props: fallbackProps,
            bestProps: fallbackBestProps
          }
        })
      }

      return res.status(503).json({
        ok: false,
        error: "Odds API quota exhausted and no usable cached snapshot is available",
        snapshotMeta: buildSnapshotMeta({ source: "quota-exhausted-no-cache" })
      })
    }

    const rawDraftKingsRows = eventResults.flatMap((result) =>
      Array.isArray(result.normalizedRows) ? result.normalizedRows : []
    )
    const normalizedFirstBasketRows = eventResults.flatMap((result) =>
      Array.isArray(result.normalizedFirstBasketRows) ? result.normalizedFirstBasketRows : []
    )
    cleaned = dedupeByLegSignature([
      ...rawDraftKingsRows,
      ...normalizedFirstBasketRows
    ])
    console.log("[RAW-FIRST-BASKET-INGESTION-DEBUG]", {
      total: Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows.length : 0,
      byEventId: (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "missing")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byMatchup: (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : []).reduce((acc, row) => {
        const key = String(row?.matchup || "missing")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      sample: (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : []).slice(0, 20).map((row) => ({
        eventId: row?.eventId || null,
        matchup: row?.matchup || null,
        player: row?.player || null,
        team: row?.team || null,
        marketKey: row?.marketKey || null,
        propType: row?.propType || null,
        odds: row?.odds ?? null
      }))
    })
    for (const eventResult of eventResults) {
      const allRows = Array.isArray(eventResult?._allRows) ? eventResult._allRows : []
      const fetchDebug = eventResult?._fetchDebug || {}
      eventIngestDebug.push({
        ...fetchDebug,
        path: "refresh-snapshot",
        eventId: eventResult.eventId,
        matchup: eventResult.matchup,
        requestedMarkets: eventResult.requestedMarkets,
        responseReceived: eventResult.responseReceived,
        dkRequestSucceeded: eventResult.ok,
        dkBookmakerEntries: eventResult.responseBookmakersCount,
        dkMarketEntries: eventResult.responseMarketsCount,
        dkNormalizedRowsProduced: eventResult.normalizedRowsCount,
        normalizedRowsProduced: allRows.length,
        dkFetchError: !eventResult.ok,
        error: eventResult.errorMessage,
        finalAcceptedRows: allRows.length
      })
    }
    const dkAttemptedEventIdSet = new Set(eventResults.map((result) => String(result?.eventId || "")).filter(Boolean))
    const dkRowBackedEventIdSetFromAttempts = new Set(
      eventResults
        .filter((result) => Number(result?.normalizedRowsCount || 0) > 0)
        .map((result) => String(result?.eventId || ""))
        .filter(Boolean)
    )
    console.log("[DK-ATTEMPT-VS-ROW-COVERAGE]", {
      scheduledEventCount: scheduledEventRecords.length,
      attemptedEventCount: dkAttemptedEventIdSet.size,
      rowBackedEventCount: dkRowBackedEventIdSetFromAttempts.size,
      attemptedWithoutRows: eventResults
        .filter((result) => result.ok && (result.normalizedRowsCount || 0) === 0)
        .map((result) => ({ eventId: result.eventId, matchup: result.matchup })),
      failedAttempts: eventResults
        .filter((result) => !result.ok)
        .map((result) => ({ eventId: result.eventId, matchup: result.matchup, errorMessage: result.errorMessage }))
    })

    const previousRowsForCarry = dedupeByLegSignature([
      ...(Array.isArray(previousSnapshotForCarry?.rawProps) ? previousSnapshotForCarry.rawProps : []),
      ...(Array.isArray(previousSnapshotForCarry?.props) ? previousSnapshotForCarry.props : [])
    ])
    const preCarryEventIds = [...new Set(cleaned.map((row) => String(row?.eventId || "")).filter(Boolean))]
    const slateDateKey = scheduledEvents[0] ? getLocalSlateDateKey(getEventTimeForDebug(scheduledEvents[0])) : ""
    const unstableMissingBeforeCarry = UNSTABLE_GAME_EVENT_IDS.filter((eventId) => {
      return scheduledEventIds.includes(eventId) && !preCarryEventIds.includes(eventId)
    })
    const carryForwardRows = previousRowsForCarry
      .filter((row) => unstableMissingBeforeCarry.includes(String(row?.eventId || "")))
      .filter((row) => {
        if (!slateDateKey) return true
        try {
          return getLocalSlateDateKey(row?.gameTime) === slateDateKey
        } catch (_) {
          return false
        }
      })
      .filter((row) => {
        try {
          return isPregameEligibleRow(row)
        } catch (_) {
          return false
        }
      })
      .map((row) => ({ ...row, staleCarryForward: true }))

    if (carryForwardRows.length > 0) cleaned.push(...carryForwardRows)

    console.log("[UNSTABLE-GAME-CARRY-FORWARD-DEBUG]", {
      path: "refresh-snapshot",
      events: UNSTABLE_GAME_EVENT_IDS.map((eventId) => ({
        eventId,
        carriedRows: carryForwardRows.filter((row) => String(row?.eventId || "") === eventId).length
      }))
    })

    let rawIngestedProps = dedupeByLegSignature(cleaned)
    let rawPropsRows = rawIngestedProps

    console.log("[TOP-DOWN-RAW-PROPS-SOURCE]", {
      cleanedCount: Array.isArray(cleaned) ? cleaned.length : -1,
      rawPropsCount: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
      byBook: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.book || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byPropType: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.propType || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byMarketKey: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.marketKey || "unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      sampleRows: Array.isArray(rawPropsRows)
        ? rawPropsRows.slice(0, 5).map((row) => ({
            eventId: row?.eventId || null,
            matchup: row?.matchup || null,
            book: row?.book || null,
            player: row?.player || null,
            propType: row?.propType || null,
            side: row?.side || null,
            line: row?.line ?? null,
            marketKey: row?.marketKey || null
          }))
        : []
    })

    console.log("[REFRESH-STAGE-3A-PRE-EXTRA-MARKETS]", {
      rawIngestedProps: Array.isArray(rawIngestedProps) ? rawIngestedProps.length : -1,
      byBook: Array.isArray(rawIngestedProps)
        ? rawIngestedProps.reduce((acc, row) => {
            const key = String(row?.book || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {}
    })

    const normalizeEventRowsFromPayload = (eventPayload, event) => {
      const matchup = buildMatchup(event?.away_team, event?.home_team)
      let rows = []
      const rejectReasonCounts = {}
      const books = Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []

      for (const book of books) {
        const markets = Array.isArray(book?.markets) ? book.markets : (Array.isArray(book?.props) ? book.props : [])

        for (const market of markets) {
          const marketKey = String(market?.key || market?.name || "").trim()
          const inferredMarket = inferMarketTypeFromKey(marketKey)
          const propType = normalizePropType(marketKey)
          let normalizedPropType = propType || inferredMarket.internalType || null
          const inferredFamily = inferredMarket.family
          const shouldKeep = Boolean(
            normalizedPropType ||
            inferredFamily === "standard" ||
            inferredFamily === "ladder" ||
            inferredFamily === "special"
          )

          if (!shouldKeep) continue

          const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : (Array.isArray(market?.selections) ? market.selections : [])
          for (const outcome of outcomes) {
            const eventId = String(
              event?.id ||
              event?.eventId ||
              market?.eventId ||
              book?.eventId ||
              ""
            ).trim()
            const sideRaw = String(outcome?.name || outcome?.label || outcome?.side || "").trim()
            const rawDescription = String(outcome?.description || "").trim()
            let side = sideRaw === "over" || sideRaw === "Over" ? "Over" : (sideRaw === "under" || sideRaw === "Under" ? "Under" : sideRaw)

            // For special/ladder markets, normalize Yes/No and treat player-name sides as "Yes"
            if (inferredFamily === "special" || inferredFamily === "ladder") {
              const sideLower = side.toLowerCase()
              if (sideLower === "yes") side = "Yes"
              else if (sideLower === "no") side = "No"
              else if (side !== "Over" && side !== "Under") side = "Yes"
            }

            let player = rawDescription || String(outcome?.participant || "").trim() || String(outcome?.player || "").trim()
            player = String(player || "").trim()

            const bookName = String(book?.title || book?.key || book?.name || "").trim()
            const currentLine = Number(outcome?.point ?? outcome?.line ?? outcome?.handicap ?? outcome?.total)
            const currentOdds = Number(outcome?.price ?? outcome?.odds ?? outcome?.american_odds)

            const draftRow = {
              eventId,
              matchup,
              awayTeam: event?.away_team || event?.awayTeam || event?.teams?.[0] || "",
              homeTeam: event?.home_team || event?.homeTeam || event?.teams?.[1] || "",
              gameTime: getEventTimeForDebug(event) || "",
              book: bookName,
              marketKey,
              marketFamily: inferredFamily,
              propType: normalizedPropType,
              player,
              side,
              playerStatus: getManualPlayerStatus(player),
              line: currentLine,
              odds: currentOdds,
              openingLine: currentLine,
              openingOdds: currentOdds,
              lineMove: 0,
              oddsMove: 0,
              marketMovementTag: "neutral",
              // line integrity fields (to be set below)
              currentLine: currentLine,
              isPrimaryLine: false,
              propVariant: outcome?.propVariant || null
            }

            const rejectReason = getIngestRejectReason(draftRow)
            if (rejectReason) {
              rejectReasonCounts[rejectReason] = (rejectReasonCounts[rejectReason] || 0) + 1
              continue
            }

            rows.push(draftRow)
          }
        }
      }

      const totalRejected = Object.values(rejectReasonCounts).reduce((s, n) => s + n, 0)
      if (totalRejected > 0 || rows.length === 0) {
        console.log("[INGEST-REJECT-REASONS-EXTRA-MKT]", {
          eventId: event?.id,
          matchup,
          accepted: rows.length,
          rejected: totalRejected,
          reasons: rejectReasonCounts
        })
      }

      return rows
    }

    // Continue with per-event normalized rows only.
    rawPropsRows = cleaned

    let extraRawRows = []
    if (ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH) {
      extraRawRows = await buildExtraMarketRowsForEvents({
        scheduledEvents,
        oddsApiKey: ODDS_API_KEY,
        normalizeEventRows: normalizeEventRowsFromPayload
      })
    } else {
      console.log("[DK-EXTRA-MARKETS-REFETCH-SKIPPED] disabled by ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH=false")
    }

    rawPropsRows = dedupeMarketRows([
      ...(Array.isArray(rawPropsRows) ? rawPropsRows : []),
      ...(Array.isArray(extraRawRows) ? extraRawRows : [])
    ])
    console.log("[REFRESH-STAGE-3-NORMALIZED-RAW-PROPS]", {
      rawProps: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
      extraRawRows: Array.isArray(extraRawRows) ? extraRawRows.length : -1,
      byBook: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.book || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byPropType: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.propType || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byMarketKey: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.marketKey || "unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      sampleRows: Array.isArray(rawPropsRows) ? rawPropsRows.slice(0, 5).map((row) => ({
        eventId: row?.eventId || null,
        matchup: row?.matchup || null,
        book: row?.book || null,
        player: row?.player || null,
        propType: row?.propType || null,
        side: row?.side || null,
        line: row?.line ?? null,
        marketKey: row?.marketKey || null
      })) : []
    })
    const scheduledEventIdSet = new Set(
      (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .map((event) => String(event?.eventId || event?.id || ""))
        .filter(Boolean)
    )
    const rawDraftKingsEventIdSet = new Set(
      (Array.isArray(rawPropsRows) ? rawPropsRows : [])
        .filter((row) => String(row?.book || "") === "DraftKings")
        .map((row) => String(row?.eventId || ""))
        .filter(Boolean)
    )
    const missingDraftKingsEventIds = [...scheduledEventIdSet].filter((id) => !rawDraftKingsEventIdSet.has(id))
    console.log("[DK-RAW-COVERAGE-DEBUG]", {
      scheduledEventCount: scheduledEventIdSet.size,
      rawDraftKingsEventCount: rawDraftKingsEventIdSet.size,
      missingDraftKingsEventIds
    })
    console.log("[DK-RAW-COVERAGE-MATCHUPS]", {
      missingMatchups: (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .filter((event) => !rawDraftKingsEventIdSet.has(String(event?.eventId || event?.id || "")))
        .map((event) => ({
          eventId: String(event?.eventId || event?.id || ""),
          matchup: String(event?.matchup || getEventMatchupForDebug(event) || ""),
          gameTime: event?.gameTime || event?.commence_time || event?.startTime || null
        }))
    })
    const dkAttemptedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkFetchedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => item?.dkRequestSucceeded === true)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkRowBackedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => Number(item?.dkNormalizedRowsProduced || 0) > 0)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkErroredEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => item?.dkFetchError === true)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    console.log("[DK-EVENT-FETCH-VS-ROWS]", {
      dkFetchedEventCount: dkFetchedEventIds.size,
      dkRowBackedEventCount: dkRowBackedEventIds.size,
      fetchedWithoutRows: [...dkFetchedEventIds].filter((id) => !dkRowBackedEventIds.has(id)),
      dkErroredEventIds: [...dkErroredEventIds],
      neverAttemptedEventIds: [...scheduledEventIdSet].filter((id) => !dkAttemptedEventIds.has(id))
    })

    console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", summarizeInterestingNormalizedRows(rawPropsRows || []))
    const activeBookRawPropsRows = (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => isActiveBook(row?.book))
    console.log("[ACTIVE-BOOK-FILTER-DEBUG]", {
      activeBooks: ACTIVE_BOOKS,
      before: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      after: activeBookRawPropsRows.length,
      byBook: activeBookRawPropsRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    const coveredEventIds = new Set(
      (Array.isArray(rawPropsRows) ? rawPropsRows : [])
        .map((row) => String(row?.eventId || ""))
        .filter(Boolean)
    )

    const coveredEvents = (Array.isArray(scheduledEvents) ? scheduledEvents : []).filter((event) => {
      const eventId = getEventIdForDebug(event)
      return eventId && coveredEventIds.has(eventId)
    })

    const missingScheduledEvents = (Array.isArray(scheduledEvents) ? scheduledEvents : []).filter((event) => {
      const eventId = getEventIdForDebug(event)
      return !eventId || !coveredEventIds.has(eventId)
    })

    console.log("[EVENT-COVERAGE-SNAPSHOT-DEBUG]", {
      scheduledCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      coveredCount: coveredEvents.length,
      missingCount: missingScheduledEvents.length,
      coveredMatchups: coveredEvents.map((event) => getEventMatchupForDebug(event)),
      missingMatchups: missingScheduledEvents.map((event) => getEventMatchupForDebug(event))
    })
    console.log("[RAW-PROPS-EVENT-COVERAGE-DEBUG]", {
      totalRows: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      byBook: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byEventId: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "")
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    console.log("[RAW-PROPS-PIPELINE-END]", {
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      totalRawRowsBuilt: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      byBook: {
        FanDuel: (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => row?.book === "FanDuel").length,
        DraftKings: (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => row?.book === "DraftKings").length
      },
      byEventId: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "")
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    if (scheduledEvents.length > 0 && rawPropsRows.length === 0) {
      console.log("[RAW-PROPS-ZERO-ROWS-DEBUG]", {
        scheduledEvents: scheduledEvents.map((event) => ({
          eventId: String(event?.id || event?.eventId || ""),
          matchup: (() => {
            const away = event?.away_team || event?.awayTeam || ""
            const home = event?.home_team || event?.homeTeam || ""
            return away && home ? `${away} @ ${home}` : String(event?.matchup || "")
          })()
        }))
      })
    }
    const ingestedEventIds = [...new Set(rawPropsRows.map((row) => String(row?.eventId || "")).filter(Boolean))]
    const missingEventIds = scheduledEventIds.filter((eventId) => !ingestedEventIds.includes(eventId))
    const propsPerEventId = Object.fromEntries(
      scheduledEventIds.map((eventId) => [
        eventId,
        rawPropsRows.filter((row) => String(row?.eventId || "") === eventId).length
      ])
    )

    const ingestApiEventIds = [...new Set(
      eventIngestDebug.flatMap((item) => [
        ...(Array.isArray(item?.apiEventIdsPrimary) ? item.apiEventIdsPrimary : []),
        ...(Array.isArray(item?.apiEventIdsFallback) ? item.apiEventIdsFallback : [])
      ].map((id) => String(id || "")).filter(Boolean))
    )]
    const targetMissingEventStages = UNSTABLE_GAME_EVENT_IDS.map((id) => ({
      eventId: id,
      inScheduledEvents: scheduledEventIds.includes(id),
      inRawApiResponse: rawApiEventIds.includes(id) || ingestApiEventIds.includes(id),
      inMappedRawProps: ingestedEventIds.includes(id),
      inFinalSavedRawProps: false,
      inFinalSavedProps: false,
      mappedRows: rawPropsRows.filter((row) => String(row?.eventId || "") === id).length
    }))

    console.log("[TARGET-MISSING-GAME-INGEST-DEBUG]", {
      path: "refresh-snapshot",
      targets: targetMissingEventStages
    })

    const normalizeIngestPlayer = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
    const lukaRawApiCount = eventIngestDebug.reduce((sum, item) => {
      return sum + Number(item?.lukaRawPrimaryCount || 0) + Number(item?.lukaRawFallbackCount || 0)
    }, 0)
    const lukaMappedCount = rawPropsRows.filter((row) => normalizeIngestPlayer(row?.player).includes("doncic")).length

    console.log("[INGEST-LUKA-STAGE-DEBUG]", {
      path: "refresh-snapshot",
      inRawApiResponse: lukaRawApiCount > 0,
      rawApiCount: lukaRawApiCount,
      inMappedRawProps: lukaMappedCount > 0,
      mappedCount: lukaMappedCount
    })

    const debugPipelineStages = {}
    debugPipelineStages.rawNormalized = summarizePropPipelineRows(activeBookRawPropsRows)
    logPropPipelineStep("refresh-snapshot", "raw-normalized-props", activeBookRawPropsRows)
    const pregameStatusRowsForDebug = activeBookRawPropsRows.filter((row) => isPregameEligibleRow(row))
    debugPipelineStages.afterPregameStatus = summarizePropPipelineRows(pregameStatusRowsForDebug)
    logPropPipelineStep("refresh-snapshot", "after-pregame-status-filtering", pregameStatusRowsForDebug)
    const primarySlateRowsForDebug = filterRowsToPrimarySlate(pregameStatusRowsForDebug)
    debugPipelineStages.afterPrimarySlate = summarizePropPipelineRows(primarySlateRowsForDebug)
    logPropPipelineStep("refresh-snapshot", "after-primary-slate-filtering", primarySlateRowsForDebug)

    const playerRows = new Map()
    for (const row of activeBookRawPropsRows) {
      if (!row.player) continue
      if (!playerRows.has(row.player)) playerRows.set(row.player, row)
    }

    const statsCache = new Map()
    const playerTeamMap = new Map()
    const players = Array.from(playerRows.keys())
    const playerResolutionDebug = {
      totalRawPlayerNamesSeen: players.length,
      totalPlayerNamesWithResolvedIds: 0,
      unresolvedPlayerNames: [],
      manualOverrideHitCount: 0,
      looseMatchHitCount: 0,
      missCacheHitCount: 0
    }

    for (let i = 0; i < players.length; i += PLAYER_LOOKUP_CONCURRENCY) {
      const batch = players.slice(i, i + PLAYER_LOOKUP_CONCURRENCY)

      await Promise.all(
        batch.map(async (player) => {
          try {
            if (isManualOverridePlayer(player)) {
              playerResolutionDebug.manualOverrideHitCount += 1
            }

            const sourceRow = playerRows.get(player)
            const expectedTeamCodes = sourceRow
              ? [teamAbbr(sourceRow.awayTeam), teamAbbr(sourceRow.homeTeam)]
              : []

            const cachedPlayerInfo = playerIdCache.get(player)
            if (cachedPlayerInfo?.id && playerStatsCache.has(cachedPlayerInfo.id)) {
              const cachedStats = playerStatsCache.get(cachedPlayerInfo.id) || []
              const recentStats = cachedStats.slice(0, 10)

              const derivedTeamCode = String(
                getTeamOverride(player) ||
                teamAbbr(cachedPlayerInfo.team) ||
                getCurrentTeamCodeFromStats(recentStats) ||
                ""
              ).toUpperCase().trim()

              const expectedSet = new Set(
                expectedTeamCodes
                  .map((code) => String(code || "").toUpperCase().trim())
                  .filter(Boolean)
              )

              if (!expectedSet.size || !derivedTeamCode || expectedSet.has(derivedTeamCode)) {
                statsCache.set(player, recentStats)
                playerTeamMap.set(player, derivedTeamCode)
                playerResolutionDebug.totalPlayerNamesWithResolvedIds += 1
                if (isLooseResolvedMatch(player, cachedPlayerInfo.matchedName || "")) {
                  playerResolutionDebug.looseMatchHitCount += 1
                }
                return
              }

              playerIdCache.delete(player)
            }

            if (playerLookupMissCache.has(player)) {
              playerResolutionDebug.missCacheHitCount += 1
            }

            const playerInfo = await fetchApiSportsPlayerIdCached(player, expectedTeamCodes)
            if (!playerInfo || !playerInfo.id) return

            playerResolutionDebug.totalPlayerNamesWithResolvedIds += 1
            if (isLooseResolvedMatch(player, playerInfo.matchedName || "")) {
              playerResolutionDebug.looseMatchHitCount += 1
            }

            const stats = await fetchApiSportsPlayerStatsCached(playerInfo.id)
            const recentStats = (stats || []).slice(0, 10)

            const derivedTeamCode =
              getTeamOverride(player) ||
              teamAbbr(playerInfo.team) ||
              getCurrentTeamCodeFromStats(recentStats)

            statsCache.set(player, recentStats)
            playerTeamMap.set(player, String(derivedTeamCode || "").toUpperCase())
          } catch (err) {
            playerResolutionDebug.unresolvedPlayerNames.push(player)
            console.error(
              "Snapshot stats failed for",
              player,
              err.response?.data || err.message
            )
          }
        })
      )
    }

    for (const player of players) {
      if (!playerTeamMap.has(player)) {
        playerResolutionDebug.unresolvedPlayerNames.push(player)
      }
    }

    const uniqueUnresolved = Array.from(new Set(playerResolutionDebug.unresolvedPlayerNames))
    logPlayerResolutionDiagnostics("refresh-snapshot", {
      totalRawPlayerNamesSeen: playerResolutionDebug.totalRawPlayerNamesSeen,
      totalPlayerNamesWithResolvedIds: playerResolutionDebug.totalPlayerNamesWithResolvedIds,
      totalUnresolvedPlayerNames: uniqueUnresolved.length,
      sampleUnresolvedPlayerNames: uniqueUnresolved.slice(0, 20),
      manualOverrideHitCount: playerResolutionDebug.manualOverrideHitCount,
      looseMatchHitCount: playerResolutionDebug.looseMatchHitCount,
      missCacheHitCount: playerResolutionDebug.missCacheHitCount
    })

    const enriched = activeBookRawPropsRows.map((row) => {
  const playerName = row.player
  const manualStatus = row.playerStatus || getManualPlayerStatus(playerName) || ""
  const logs = statsCache.get(row.player) || []

  const values = logs
    .map((log) => propValueFromApiSportsLog(log, row.propType))
    .filter((v) => v !== null)

  const mins = logs
    .map((log) => Number(log.min || 0))
    .filter((v) => !Number.isNaN(v) && v > 0)

  const l10Avg = avg(values)
  const avgMin = avg(mins)

  const recent5Values = values.slice(-5)
  const recent3Values = values.slice(-3)
  const recent5Mins = mins.slice(-5)
  const recent3Mins = mins.slice(-3)

  const recent5Avg = avg(recent5Values)
  const recent3Avg = avg(recent3Values)
  const minStd = stddev(mins)
  const valueStd = stddev(values)
  const minFloor = minVal(mins)
  const minCeiling = maxVal(mins)
  const recent5MinAvg = avg(recent5Mins)
  const recent3MinAvg = avg(recent3Mins)

  let hitRate = null
  let edge = null

  if (l10Avg !== null && values.length) {
    if (row.side === "Over") {
      edge = l10Avg - row.line
      hitRate = `${values.filter((v) => v > row.line).length}/${values.length}`
    } else if (row.side === "Under") {
      edge = row.line - l10Avg
      hitRate = `${values.filter((v) => v < row.line).length}/${values.length}`
    }
  }

  const teamCode = String(playerTeamMap.get(row.player) || "").toUpperCase()
  const validTeam =
    teamCode && (
      teamCode === teamAbbr(row.awayTeam) ||
      teamCode === teamAbbr(row.homeTeam)
    )

  const fallbackTeam =
    teamCode ||
    teamAbbr(row.awayTeam) ||
    teamAbbr(row.homeTeam) ||
    ""

  const resolvedTeam = fallbackTeam

  const highTriggers = [
    minFloor !== null && minFloor < 18,
    avgMin !== null && avgMin < 24,
    minStd !== null && minStd >= 8.5
  ].filter(Boolean).length

  const mediumTriggers = [
    minFloor !== null && minFloor < 18,
    avgMin !== null && avgMin < 28,
    minStd !== null && minStd >= 6.5
  ].filter(Boolean).length

  let minutesRisk = "low"

  if (highTriggers >= 2) {
    minutesRisk = "high"
  } else if (highTriggers === 1 || mediumTriggers >= 2) {
    minutesRisk = "medium"
  }

  // apply manual injury / minutes overrides
  if (manualStatus === "out") minutesRisk = "high"
  if (manualStatus === "limited") minutesRisk = "high"
  if (manualStatus === "probable") minutesRisk = minutesRisk === "high" ? "medium" : minutesRisk

  // Trend risk (recent form vs bet direction)
  let trendRisk = "low"

  if (recent3Avg !== null && l10Avg !== null) {
    const trendDelta = recent3Avg - l10Avg

    if (row.side === "Over" && trendDelta < -2) {
      trendRisk = "high"
    } else if (row.side === "Under" && trendDelta > 2) {
      trendRisk = "high"
    } else if (row.side === "Over" && trendDelta < -1) {
      trendRisk = "medium"
    } else if (row.side === "Under" && trendDelta > 1) {
      trendRisk = "medium"
    }
  }

  let injuryRisk = "low"

  const status = String(row.playerStatus || manualStatus || "").toLowerCase()

  if (
    status.includes("questionable") ||
    status.includes("game-time") ||
    status.includes("gtd")
  ) {
    injuryRisk = "high"
  } else if (
    status.includes("probable") ||
    status.includes("returning") ||
    status.includes("minutes")
  ) {
    injuryRisk = "medium"
  }

  return {
    ...row,
    l10Avg: l10Avg === null ? null : Number(l10Avg.toFixed(1)),
    avgMin: avgMin === null ? null : Number(avgMin.toFixed(1)),
    hitRate,
    edge: edge === null ? null : Number(edge.toFixed(1)),
    gamesUsed: values.length,
    recent5Avg: recent5Avg === null ? null : Number(recent5Avg.toFixed(1)),
    recent3Avg: recent3Avg === null ? null : Number(recent3Avg.toFixed(1)),
    minStd: minStd === null ? null : Number(minStd.toFixed(1)),
    valueStd: valueStd === null ? null : Number(valueStd.toFixed(1)),
    minFloor: minFloor === null ? null : Number(minFloor.toFixed(1)),
    minCeiling: minCeiling === null ? null : Number(minCeiling.toFixed(1)),
    recent5MinAvg: recent5MinAvg === null ? null : Number(recent5MinAvg.toFixed(1)),
    recent3MinAvg: recent3MinAvg === null ? null : Number(recent3MinAvg.toFixed(1)),
    minutesRisk,
    trendRisk,
    injuryRisk,
    resolvedTeamCode: teamCode,
    player: row.player,
    team: resolvedTeam,
    eventId: row.eventId,
    matchup: row.matchup,
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
    gameTime: row.gameTime,
    book: row.book,
    propType: row.propType,
    side: row.side,
    line: row.line,
    odds: row.odds,
    openingLine: row.openingLine,
    openingOdds: row.openingOdds,
    marketMovementTag: row.marketMovementTag,
    playerStatus: row.playerStatus,
    isAlt: row.isAlt,
    propVariant: row.propVariant

  }
})

    const enrichedModelRows = Array.isArray(enriched) ? enriched : []

    console.log("[ENRICHMENT-IDENTITY-DEBUG]", summarizeIdentityChanges(rawPropsRows, enrichedModelRows, 25))
    console.log("[BAD-TEAM-RAW-DEBUG]", {
      count: getBadTeamAssignmentRows(rawPropsRows, 25).length,
      byBook: {
        FanDuel: rawPropsRows.filter((row) => row?.book === "FanDuel" && !rowTeamMatchesMatchup(row)).length,
        DraftKings: rawPropsRows.filter((row) => row?.book === "DraftKings" && !rowTeamMatchesMatchup(row)).length
      },
      sample: getBadTeamAssignmentRows(rawPropsRows, 25)
    })
    console.log("[BAD-TEAM-ENRICHED-DEBUG]", {
      count: getBadTeamAssignmentRows(enrichedModelRows, 25).length,
      byBook: {
        FanDuel: enrichedModelRows.filter((row) => row?.book === "FanDuel" && !rowTeamMatchesMatchup(row)).length,
        DraftKings: enrichedModelRows.filter((row) => row?.book === "DraftKings" && !rowTeamMatchesMatchup(row)).length
      },
      sample: getBadTeamAssignmentRows(enrichedModelRows, 25)
    })

    const allBadTeamAssignmentRows = (Array.isArray(enriched) ? enriched : []).filter((row) => !rowTeamMatchesMatchup(row))
    const badTeamAssignmentRows = getBadTeamAssignmentRows(enriched, 25)
    console.log("[BAD-TEAM-ASSIGNMENT-DEBUG]", {
      path: "refresh-snapshot",
      count: allBadTeamAssignmentRows.length,
      byBook: {
        FanDuel: allBadTeamAssignmentRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: allBadTeamAssignmentRows.filter((r) => r?.book === "DraftKings").length
      },
      sample: badTeamAssignmentRows
    })

    const deduped = dedupeBestProps(enriched)
    debugPipelineStages.afterDedupe = summarizePropPipelineRows(deduped)
  logPropPipelineStep("refresh-snapshot", "after-dedupe", deduped)

// --- Funnel diagnostics: prove which filter drives afterDedupe -> afterScoringRanking drop ---
{
  const _sd0 = Array.isArray(deduped) ? deduped : []
  const _sd1 = _sd0.filter((row) => playerFitsMatchup(row))
  const _sd2 = _sd1.filter((row) => {
    const team = String(row.team || "").toUpperCase().trim()
    return Boolean(team) && (team === teamAbbr(row.awayTeam) || team === teamAbbr(row.homeTeam))
  })
  const _sd3 = _sd2.filter((row) => row.l10Avg !== null)
  const _sd4 = _sd3.filter((row) => row.avgMin !== null && row.avgMin >= 18)
  const _sd4_old = _sd3.filter((row) => row.avgMin !== null && row.avgMin >= 22)
  const _sd5 = _sd4.filter((row) => parseHitRate(row.hitRate) >= 0.5)
  const _sd6 = _sd5.filter((row) => row.gamesUsed >= 6)
  const _sd7 = _sd6.filter((row) => {
    const gameTime = new Date(row.gameTime)
    if (!(gameTime.getTime() > Date.now())) return false
    const localGameDate = gameTime.toLocaleDateString("en-US", { timeZone: "America/Detroit" })
    return !primarySlateDateLocal || localGameDate === primarySlateDateLocal
  })
  const _sd8 = _sd7.filter((row) => {
    const diff = Math.abs(Number(row.line) - Number(row.l10Avg))
    if (row.propType === "Points") return diff <= 10
    if (row.propType === "Rebounds") return diff <= 5
    if (row.propType === "Assists") return diff <= 5
    if (row.propType === "Threes") return diff <= 2.5
    if (row.propType === "PRA") return diff <= 12
    return true
  })
  const _sd9 = _sd8.filter((row) => {
    if (row.propType === "Assists" && Number(row.line) > 11.5) return false
    if (row.propType === "Rebounds" && Number(row.line) > 15.5) return false
    if (row.propType === "Points" && Number(row.line) > 36.5) return false
    if (row.propType === "PRA" && Number(row.line) > 47.5) return false
    return true
  })
  console.log("[SCORED-PROPS-FUNNEL-DEBUG]", {
    f0_deduped: _sd0.length,
    f1_playerFitsMatchup: _sd1.length,
    f2_teamAbbrValidation: _sd2.length,
    f3_l10AvgNotNull: _sd3.length,
    f4_avgMinGe18_new: _sd4.length,
    f4_avgMinGe22_old: _sd4_old.length,
    f4_recoveredByLowering: _sd4.length - _sd4_old.length,
    f5_hitRateGe50pct: _sd5.length,
    f6_gamesUsedGe6: _sd6.length,
    f7_gameDateFilter: _sd7.length,
    f8_lineDiffProximity: _sd8.length,
    f9_maxLineSanity: _sd9.length,
    drops: {
      f1_teamFit: _sd0.length - _sd1.length,
      f2_teamAbbr: _sd1.length - _sd2.length,
      f3_l10Avg: _sd2.length - _sd3.length,
      f4_avgMin_18: _sd3.length - _sd4.length,
      f4_avgMin_22_would_have_dropped: _sd3.length - _sd4_old.length,
      f5_hitRate_50: _sd4.length - _sd5.length,
      f6_gamesUsed: _sd5.length - _sd6.length,
      f7_gameDate: _sd6.length - _sd7.length,
      f8_lineDiff: _sd7.length - _sd8.length,
      f9_maxLine: _sd8.length - _sd9.length
    }
  })
}

const scoredProps = deduped
  .filter((row) => playerFitsMatchup(row))
  .filter((row) => {
    const team = String(row.team || "").toUpperCase().trim()
    return Boolean(team) && (
      team === teamAbbr(row.awayTeam) ||
      team === teamAbbr(row.homeTeam)
    )
  })
  .filter((row) => row.l10Avg !== null)
  .filter((row) => row.avgMin !== null && row.avgMin >= 18)
  .filter((row) => parseHitRate(row.hitRate) >= 0.5)
  .filter((row) => row.gamesUsed >= 6)
  .filter((row) => {
    const gameTime = new Date(row.gameTime)
    if (!(gameTime.getTime() > Date.now())) return false

    const localGameDate = gameTime.toLocaleDateString("en-US", {
      timeZone: "America/Detroit"
    })

    return !primarySlateDateLocal || localGameDate === primarySlateDateLocal
  })
  .filter((row) => {
    const diff = Math.abs(Number(row.line) - Number(row.l10Avg))

    if (row.propType === "Points") return diff <= 10
    if (row.propType === "Rebounds") return diff <= 5
    if (row.propType === "Assists") return diff <= 5
    if (row.propType === "Threes") return diff <= 2.5
    if (row.propType === "PRA") return diff <= 12

    return true
  })
  .filter((row) => {
    if (row.propType === "Assists" && Number(row.line) > 11.5) return false
    if (row.propType === "Rebounds" && Number(row.line) > 15.5) return false
    if (row.propType === "Points" && Number(row.line) > 36.5) return false
    if (row.propType === "PRA" && Number(row.line) > 47.5) return false
    return true
  })
  .map((row) => {
    const baseRow = {
      ...row,
      score: scorePropRow(row),
      dvpScore: getDvpScore(getOpponentForRow(row), row.propType)
    }
    const edgeProfile = {
      gameEnvironmentScore: inferGameEnvironmentScore(baseRow),
      matchupEdgeScore: inferMatchupEdgeScore(baseRow),
      bookValueScore: inferBookValueScore(baseRow),
      volatilityScore: inferVolatilityScore(baseRow)
    }
    const betTypeFit = inferBetTypeFit(baseRow, edgeProfile)
    const evidence = buildEvidence(baseRow)
    const whyItRates = buildDataDrivenWhyItRates(baseRow)
    const modelSummary = buildModelSummary(baseRow, evidence, whyItRates)
    const edgeRow = {
      ...baseRow,
      gameEnvironmentScore: edgeProfile.gameEnvironmentScore,
      matchupEdgeScore: edgeProfile.matchupEdgeScore,
      bookValueScore: edgeProfile.bookValueScore,
      volatilityScore: edgeProfile.volatilityScore,
      betTypeFit,
      edgeProfile,
      evidence,
      whyItRates,
      modelSummary
    }
    const ceilingRoleSignals = buildCeilingRoleSpikeSignals(edgeRow)
    const lineupRoleSignals = buildLineupRoleContextSignals(edgeRow)
    const marketContextSignals = buildMarketContextSignals(edgeRow)
    return enrichPredictionLayer({ ...edgeRow, ...ceilingRoleSignals, ...lineupRoleSignals, ...marketContextSignals })
  })
  .filter((row) => {
    const hasCoreData =
      row.team &&
      row.hitRate != null &&
      row.edge != null &&
      row.score != null

    return hasCoreData
  })
  .sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if ((b.edge ?? -999) !== (a.edge ?? -999)) return (b.edge ?? -999) - (a.edge ?? -999)
    return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
  })

console.log("[CEILING-SIGNAL-STAGE-DEBUG]", {
  path: "refresh-snapshot",
  scoredPropsCount: Array.isArray(scoredProps) ? scoredProps.length : 0,
  scoredWithCeilingScore: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
  scoredWithRoleSpikeScore: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => Number.isFinite(Number(row?.roleSpikeScore))).length
})

console.log("[EDGE-PROFILE-DEBUG]", {
  totalRows: Array.isArray(scoredProps) ? scoredProps.length : 0,
  byBetTypeFit: Array.isArray(scoredProps)
    ? scoredProps.reduce((acc, row) => {
        const key = String(row?.betTypeFit || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    : {},
  sampleRows: Array.isArray(scoredProps)
    ? scoredProps.slice(0, 12).map((row) => ({
        player: row?.player || null,
        team: row?.team || null,
        matchup: row?.matchup || null,
        propType: row?.propType || null,
        marketKey: row?.marketKey || null,
        propVariant: row?.propVariant || "base",
        odds: row?.odds ?? null,
        hitRate: row?.hitRate ?? null,
        edge: row?.edge ?? null,
        gameEnvironmentScore: row?.gameEnvironmentScore ?? null,
        matchupEdgeScore: row?.matchupEdgeScore ?? null,
        bookValueScore: row?.bookValueScore ?? null,
        volatilityScore: row?.volatilityScore ?? null,
        betTypeFit: row?.betTypeFit || null,
        whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
      }))
    : []
})

console.log("[BOOK-DATA-QUALITY-FILTER]", {
  totalAfterFilter: scoredProps.length,
  byBook: scoredProps.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
})

  debugPipelineStages.afterScoringRanking = summarizePropPipelineRows(scoredProps)
logPropPipelineStep("refresh-snapshot", "after-scoring-ranking", scoredProps)

console.log("[SCORED-PROPS-FILTER-RELAX-DEBUG]", {
  total: scoredProps.length,
  byBook: scoredProps.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  byGame: scoredProps.reduce((acc, row) => {
    const key = String(row?.matchup || row?.eventId || "unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  byProp: scoredProps.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
})

const normalizeBestPropsEdge = (edge) => clamp((Number(edge || 0) + 2) / 8, 0, 1)
const normalizeBestPropsScore = (score) => clamp(Number(score || 0) / 120, 0, 1)
const getTierEdge = (row) => Number(row.edge ?? row.projectedValue ?? 0)
const getTierScore = (row) => Number(row.score || 0)
const getMinutesRisk = (row) => String(row.minutesRisk || "").toLowerCase()
const getInjuryRisk = (row) => String(row.injuryRisk || "").toLowerCase()
const TIER_BOOKS = ["FanDuel", "DraftKings"]
const TIER_STAT_TYPES = ["Points", "Rebounds", "Assists", "Threes", "PRA"]

const qualifiesEliteTier = (row) => {
  const hit = parseHitRate(row.hitRate)
  return (
    hit >= 0.72 &&
    getTierScore(row) >= 88 &&
    (row.minFloor === null || row.minFloor >= 24) &&
    (row.minStd === null || row.minStd <= 7.5) &&
    (row.valueStd === null ||
      (
        (row.propType === "Points" || row.propType === "PRA")
          ? row.valueStd <= 10.5
          : row.valueStd <= 5.5
      ))
  )
}

const qualifiesStrongTier = (row) => {
  const hit = parseHitRate(row.hitRate)
  return (
    hit >= 0.61 &&
    getTierScore(row) >= 62 &&
    (row.minFloor === null || row.minFloor >= 22) &&
    (row.minStd === null || row.minStd <= 9.5) &&
    (row.valueStd === null ||
      (
        (row.propType === "Points" || row.propType === "PRA")
          ? row.valueStd <= 12
          : row.valueStd <= 6.5
      ))
  )
}

const bestPropsCompositeScore = (row) => {
  const hitRate = parseHitRate(row.hitRate)
  const edgeComponent = normalizeBestPropsEdge(row.edge ?? row.projectedValue ?? 0)
  const scoreComponent = normalizeBestPropsScore(row.score)
  const lowRiskBonuses =
    (String(row.minutesRisk || "").toLowerCase() === "low" ? 0.035 : 0) +
    (String(row.injuryRisk || "").toLowerCase() === "low" ? 0.03 : 0) +
    (String(row.trendRisk || "").toLowerCase() === "low" ? 0.02 : 0)

  return hitRate * 0.5 + edgeComponent * 0.25 + scoreComponent * 0.15 + lowRiskBonuses
}

const qualifiesPlayableTier = (row) => {
  const hit = parseHitRate(row.hitRate)
  const edge = getTierEdge(row)
  const score = getTierScore(row)
  const minutesRisk = getMinutesRisk(row)
  const injuryRisk = getInjuryRisk(row)

  if (minutesRisk === "high") return false
  if (injuryRisk === "high") return false
  if (hit < 0.5) return false
  if (edge < -0.75 && score < 34) return false
  if (score >= 42) return true
  if (hit >= 0.62) return true
  if (hit >= 0.59 && edge >= 0.2) return true
  if (hit >= 0.57 && score >= 34) return true
  return false
}

const qualifiesBestPropsSource = (row) => {
  const hit = parseHitRate(row.hitRate)
  const edge = getTierEdge(row)
  const score = getTierScore(row)
  const minutesRisk = getMinutesRisk(row)
  const injuryRisk = getInjuryRisk(row)

  if (minutesRisk === "high") return false
  if (injuryRisk === "high") return false
  if (hit < 0.46) return false
  if (edge < -1.0 && score < 30) return false
  return score >= 30 || hit >= 0.53 || (hit >= 0.56 && edge >= 0.05)
}

const summarizeTierBucket = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const byBook = {}
  const byStat = {}

  for (const book of TIER_BOOKS) {
    byBook[book] = safeRows.filter((row) => String(row?.book || "Unknown") === book).length
  }

  for (const statType of TIER_STAT_TYPES) {
    byStat[statType] = safeRows.filter((row) => String(row?.propType || "Unknown") === statType).length
  }

  return {
    total: safeRows.length,
    byBook,
    byStat
  }
}

const buildSequentialFilterDropCounts = (rows, filters) => {
  let remaining = Array.isArray(rows) ? rows : []
  const droppedByFilter = {}

  for (const filter of filters) {
    const next = remaining.filter(filter.predicate)
    droppedByFilter[filter.key] = remaining.length - next.length
    remaining = next
  }

  return {
    droppedByFilter,
    survivors: remaining
  }
}

const logTierAssignmentDebug = (pathLabel, rawRows, tierRows, filterCounts = {}) => {
  const safeRawRows = Array.isArray(rawRows) ? rawRows : []
  const eliteRows = Array.isArray(tierRows.eliteRows) ? tierRows.eliteRows : []
  const strongRows = Array.isArray(tierRows.strongRows) ? tierRows.strongRows : []
  const playableRows = Array.isArray(tierRows.playableRows) ? tierRows.playableRows : []
  const bestSourceRows = Array.isArray(tierRows.bestSourceRows) ? tierRows.bestSourceRows : []
  const preCapBestRows = Array.isArray(tierRows.preCapBestRows) ? tierRows.preCapBestRows : []
  const bestRows = Array.isArray(tierRows.bestRows) ? tierRows.bestRows : []

  console.log("[TIER-ASSIGNMENT-DEBUG]", {
    path: pathLabel,
    rawCandidateCount: safeRawRows.length,
    rawPropsByBook: summarizeTierBucket(safeRawRows).byBook,
    rawPropsByStatType: summarizeTierBucket(safeRawRows).byStat,
    countRemovedByFilter: filterCounts,
    finalCounts: {
      eliteProps: eliteRows.length,
      strongProps: strongRows.length,
      playableProps: playableRows.length,
      bestPropsSource: bestSourceRows.length,
      bestPropsPreCap: preCapBestRows.length,
      bestProps: bestRows.length
    },
    perBookCounts: {
      eliteProps: summarizeTierBucket(eliteRows).byBook,
      strongProps: summarizeTierBucket(strongRows).byBook,
      playableProps: summarizeTierBucket(playableRows).byBook,
      bestPropsSource: summarizeTierBucket(bestSourceRows).byBook,
      bestProps: summarizeTierBucket(bestRows).byBook
    },
    perStatCounts: {
      eliteProps: summarizeTierBucket(eliteRows).byStat,
      strongProps: summarizeTierBucket(strongRows).byStat,
      playableProps: summarizeTierBucket(playableRows).byStat,
      bestPropsSource: summarizeTierBucket(bestSourceRows).byStat,
      bestProps: summarizeTierBucket(bestRows).byStat
    },
    playablePropsByBook: summarizeTierBucket(playableRows).byBook,
    bestPropsByBook: summarizeTierBucket(bestRows).byBook,
    bestPropsByStatType: summarizeTierBucket(bestRows).byStat,
    finalBestPropsTotal: bestRows.length
  })
}

const eliteProps = scoredProps.filter((row) => qualifiesEliteTier(row))
logFunnelStage("refresh-snapshot", "eliteProps-from-scoredProps", scoredProps, eliteProps, { threshold: "hit>=0.72,score>=88,minFloor>=24,minStd<=7.5,valueStd<=10.5/5.5" })
logFunnelExcluded("refresh-snapshot", "eliteProps-from-scoredProps", scoredProps, eliteProps)

const strongProps = scoredProps.filter((row) => qualifiesStrongTier(row))
logFunnelStage("refresh-snapshot", "strongProps-from-scoredProps", scoredProps, strongProps, { threshold: "hit>=0.61,score>=62,minFloor>=22,minStd<=9.5,valueStd<=12/6.5" })
logFunnelExcluded("refresh-snapshot", "strongProps-from-scoredProps", scoredProps, strongProps)

const BEST_PROPS_BALANCE_CONFIG = {
  totalCap: 140,
  minPerBook: 60,
  maxPerPlayer: 8,
  maxPerMatchup: 12,
  maxPerType: {
    Assists: 40,
    Rebounds: 40,
    Points: 40,
    Threes: 24,
    PRA: 24
  }
}

const FLEX_PRIORITY_PROP_TYPES = new Set(["Threes", "Points", "PRA"])

const getFlexOddsBonus = (oddsValue) => {
  const odds = Number(oddsValue)
  if (!Number.isFinite(odds)) return 0
  if (odds >= 100 && odds <= 200) return 0.1
  if (odds >= -120 && odds < 100) return 0.05
  return 0
}

const getFlexTrendBonus = (row) => {
  const recent3 = Number(row?.recent3Avg)
  const recent5 = Number(row?.recent5Avg)
  const l10 = Number(row?.l10Avg)

  let bonus = 0
  if (Number.isFinite(recent3) && Number.isFinite(recent5) && recent3 > recent5) bonus += 0.08
  if (Number.isFinite(recent5) && Number.isFinite(l10) && recent5 > l10) bonus += 0.05
  return bonus
}

const isFlexEligible = (row) => {
  if (!row) return false
  if (!row.player || !row.propType || row.line == null) return false
  if (shouldRemoveLegForPlayerStatus(row)) return false
  if (isFragileLeg(row)) return false

  const hit = parseHitRate(row.hitRate)
  const avgMin = Number(row.avgMin || 0)
  const edge = Number(row.edge ?? row.projectedValue ?? 0)
  const minutesRisk = String(row.minutesRisk || "").toLowerCase()
  const injuryRisk = String(row.injuryRisk || "").toLowerCase()

  if (minutesRisk === "high") return false
  if (injuryRisk === "high") return false
  if (!Number.isFinite(hit) || hit < 0.45) return false
  if (!Number.isFinite(avgMin) || avgMin < 14) return false
  if (!Number.isFinite(edge) || edge < -2.5) return false

  return true
}

const flexScore = (row) => {
  const hit = parseHitRate(row.hitRate)
  const edge = Number(row.edge ?? row.projectedValue ?? 0)
  const score = Number(row.score || 0)
  const oddsBonus = getFlexOddsBonus(row.odds)
  const trendBonus = getFlexTrendBonus(row)

  return (
    hit * 0.4 +
    (edge / 12) * 0.2 +
    (score / 140) * 0.15 +
    oddsBonus * 0.15 +
    trendBonus * 0.1
  )
}

const getFlexPoolCap = (candidateCount) => {
  const safeCount = Number.isFinite(candidateCount) ? candidateCount : 0
  return Math.max(60, Math.min(80, 60 + Math.floor(safeCount / 40) * 5))
}

const countRowsByKey = (rows, keyFn) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return safeRows.reduce((acc, row) => {
    const key = keyFn(row)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

const buildFlexPropsPool = (pathLabel, sourceRows) => {
  const dedupedSource = dedupeByLegSignature(Array.isArray(sourceRows) ? sourceRows : [])
  const filtered = dedupedSource.filter((row) => isFlexEligible(row))
  const cap = getFlexPoolCap(filtered.length)

  const sorted = filtered.slice().sort((a, b) => {
    const scoreDiff = flexScore(b) - flexScore(a)
    if (scoreDiff !== 0) return scoreDiff

    const aVariancePriority = FLEX_PRIORITY_PROP_TYPES.has(String(a.propType || "")) ? 1 : 0
    const bVariancePriority = FLEX_PRIORITY_PROP_TYPES.has(String(b.propType || "")) ? 1 : 0
    if (bVariancePriority !== aVariancePriority) return bVariancePriority - aVariancePriority

    const aOddsWindow = Number.isFinite(Number(a.odds)) && Number(a.odds) >= -150 && Number(a.odds) <= 200 ? 1 : 0
    const bOddsWindow = Number.isFinite(Number(b.odds)) && Number(b.odds) >= -150 && Number(b.odds) <= 200 ? 1 : 0
    if (bOddsWindow !== aOddsWindow) return bOddsWindow - aOddsWindow

    return Number(b.score || 0) - Number(a.score || 0)
  })

  const finalPool = sorted.slice(0, cap)

  console.log("[FLEX-POOL-DEBUG]", {
    path: pathLabel,
    totalBeforeFilter: dedupedSource.length,
    totalAfterFilter: filtered.length,
    finalCount: finalPool.length,
    cap,
    beforeByPropType: countRowsByKey(dedupedSource, (row) => String(row?.propType || "Unknown")),
    afterByPropType: countRowsByKey(finalPool, (row) => String(row?.propType || "Unknown")),
    beforeByBook: countRowsByKey(dedupedSource, (row) => String(row?.book || "Unknown")),
    afterByBook: countRowsByKey(finalPool, (row) => String(row?.book || "Unknown"))
  })

  return finalPool
}

const selectBalancedPool = (rows, options = {}) => {
  const {
    totalCap = 120,
    minPerBook = 0,
    maxPerPlayer = 2,
    maxPerMatchup = 4,
    maxPerType = {},
    ranker = bestPropsCompositeScore
  } = options

  const sorted = dedupeSlipLegs(rows)
    .slice()
    .sort((a, b) => {
      const scoreDiff = ranker(b) - ranker(a)
      if (scoreDiff !== 0) return scoreDiff
      if (Number(b.edge || -999) !== Number(a.edge || -999)) return Number(b.edge || -999) - Number(a.edge || -999)
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })

  const selected = []
  const playerCounts = new Map()
  const matchupCounts = new Map()
  const typeCounts = new Map()
  const bookCounts = new Map()
  const books = ["FanDuel", "DraftKings"]

  const canTakeRow = (row) => {
    const player = String(row.player || "")
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    if ((playerCounts.get(player) || 0) >= maxPerPlayer) return false
    if ((matchupCounts.get(matchup) || 0) >= maxPerMatchup) return false
    if ((typeCounts.get(propType) || 0) >= (maxPerType[propType] ?? 999)) return false
    if ((bookCounts.get(bookKey) || 0) >= totalCap) return false
    return true
  }

  const takeRow = (row) => {
    const player = String(row.player || "")
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    selected.push(row)
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
    matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
    typeCounts.set(propType, (typeCounts.get(propType) || 0) + 1)
    bookCounts.set(bookKey, (bookCounts.get(bookKey) || 0) + 1)
  }

  for (const bookKey of books) {
    for (const row of sorted) {
      if (selected.length >= totalCap) break
      if (String(row.book || "") !== bookKey) continue
      if ((bookCounts.get(bookKey) || 0) >= minPerBook) break
      if (!canTakeRow(row)) continue
      takeRow(row)
    }
  }

  for (const row of sorted) {
    if (selected.length >= totalCap) break
    const rowKey = `${row.player}|${row.propType}|${row.side}|${row.line}|${row.book}`
    const alreadySelected = selected.some((picked) => `${picked.player}|${picked.propType}|${picked.side}|${picked.line}|${picked.book}` === rowKey)
    if (alreadySelected) continue
    if (!canTakeRow(row)) continue
    takeRow(row)
  }

  return selected
}

function logBestStage(label, rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  console.log("[BEST-STAGE-DEBUG]", {
    label,
    total: safeRows.length,
    fanduel: safeRows.filter((row) => row?.book === "FanDuel").length,
    draftkings: safeRows.filter((row) => row?.book === "DraftKings").length
  })
  return rows
}

const buildBestPropsBalancedPool = (rows, options = {}) => {
  const config = {
    targetTotal: Number.isFinite(options.targetTotal) ? options.targetTotal : BEST_PROPS_BALANCE_CONFIG.totalCap,
    bestCap: Number.isFinite(options.bestCap)
      ? options.bestCap
      : (Number.isFinite(options.targetTotal) ? options.targetTotal : BEST_PROPS_BALANCE_CONFIG.totalCap),
    maxPerPlayer: Number.isFinite(options.maxPerPlayer) ? options.maxPerPlayer : BEST_PROPS_BALANCE_CONFIG.maxPerPlayer,
    maxPerMatchup: Number.isFinite(options.maxPerMatchup) ? options.maxPerMatchup : BEST_PROPS_BALANCE_CONFIG.maxPerMatchup,
    partialPostingMode: options.partialPostingMode === true,
    maxPerType: { ...BEST_PROPS_BALANCE_CONFIG.maxPerType, ...(options.maxPerType || {}) },
    ranker: options.ranker || bestPropsCompositeScore
  }
  const configuredMinPerBook = Number.isFinite(options.minPerBook)
    ? options.minPerBook
    : BEST_PROPS_BALANCE_CONFIG.minPerBook
  config.minPerBook = Math.max(0, Math.min(configuredMinPerBook, Math.floor(config.targetTotal / 2)))

  const bestBoardOrderingScore = (row) => {
    const baseScore = Number((options.ranker || bestPropsCompositeScore)(row) || 0)
    const side = String(row?.side || "")
    const propVariant = String(row?.propVariant || "base")
    const propType = String(row?.propType || "")
    const hitRate = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge ?? row?.projectedValue ?? 0)

    let adjusted = baseScore

    if (side === "Under") adjusted -= 8
    if (side === "Over") adjusted += 3

    if (propVariant !== "base" && propVariant !== "default") adjusted -= 6

    if (propType === "Points") adjusted += 5
    if (propType === "PRA") adjusted += 6
    if (propType === "Assists") adjusted += 4
    if (propType === "Rebounds") adjusted -= 5

    if (side === "Over" && (propType === "Points" || propType === "PRA" || propType === "Assists")) adjusted += 3
    if (side === "Over" && propType === "Rebounds") adjusted -= 2

    if (side === "Under" && propType === "Rebounds") adjusted -= 8

    if (hitRate >= 0.75 && edge >= 3.0 && (propType === "Points" || propType === "PRA" || propType === "Assists")) adjusted += 4
    if (side === "Under" && hitRate >= 0.76 && edge >= 3.5) adjusted += 5
    if ((propVariant !== "base" && propVariant !== "default") && hitRate >= 0.8 && edge >= 4.0) adjusted += 4

    return adjusted
  }

  const pathLabel = String(options.pathLabel || "unknown")
  const isBestBoardPath =
    pathLabel === "refresh-snapshot" ||
    pathLabel === "refresh-snapshot-hard-reset" ||
    pathLabel.includes("bestProps")
  const rawSource = Array.isArray(rows) ? rows : []
  const sourceByBook = countByBookForRows(rawSource)
  logBestStage(`${pathLabel}:sourcePoolBeforeBestPropsFiltering`, rawSource)

  const sourceAfterPlayerStatus = rawSource
    .filter((row) => row && row.player && row.propType && row.line != null)
    .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    .filter((row) => {
      if (!isBestBoardPath) return true
      return String(row?.minutesRisk || "").toLowerCase() !== "high"
    })
    .filter((row) => {
      if (!isBestBoardPath) return true
      const tier = String(row?.confidenceTier || "").toLowerCase()
      return tier !== "thin" || parseHitRate(row?.hitRate) >= 0.63 || Number(row?.edge ?? row?.projectedValue ?? 0) >= 2.25
    })
  logBestStage(`${pathLabel}:afterPlayerStatusFiltering`, sourceAfterPlayerStatus)

  const bestPropsAfterFragile = sourceAfterPlayerStatus
    .filter((row) => !isFragileLeg(row, "best"))
  logBestStage(`${pathLabel}:afterFragileFiltering`, bestPropsAfterFragile)
  console.log("[BEST-FRAGILE-MODE-DEBUG]", {
    mode: "best",
    remaining: bestPropsAfterFragile.length,
    fanduel: bestPropsAfterFragile.filter((row) => row?.book === "FanDuel").length,
    draftkings: bestPropsAfterFragile.filter((row) => row?.book === "DraftKings").length
  })
  const eligibleSource = bestPropsAfterFragile
    .filter((row) => playerFitsMatchup(row))
  logBestStage(`${pathLabel}:afterMatchupGameFiltering`, eligibleSource)
  const droppedByIneligible = Math.max(0, rawSource.length - eligibleSource.length)

  console.log("[BEST-PROPS-STAGE-COUNTS]", {
    path: pathLabel,
    stage: "beforeFragileFilter",
    total: sourceAfterPlayerStatus.length,
    byBook: countByBookForRows(sourceAfterPlayerStatus)
  })
  console.log("[BEST-PROPS-STAGE-COUNTS]", {
    path: pathLabel,
    stage: "afterFragileFilter",
    total: bestPropsAfterFragile.length,
    byBook: countByBookForRows(bestPropsAfterFragile)
  })

  const dedupedEligible = dedupeByLegSignature(eligibleSource)
  const droppedByDedupe = Math.max(0, eligibleSource.length - dedupedEligible.length)
  logBestStage(`${pathLabel}:afterDedupe`, dedupedEligible)
  console.log("[BEST-PROPS-STAGE-COUNTS]", {
    path: pathLabel,
    stage: "afterDedupe",
    total: dedupedEligible.length,
    byBook: countByBookForRows(dedupedEligible)
  })

  const candidates = dedupedEligible
    .slice()
    .sort((a, b) => {
      const scoreDiff = bestBoardOrderingScore(b) - bestBoardOrderingScore(a)
      if (scoreDiff !== 0) return scoreDiff
      if (Number(b.edge || -999) !== Number(a.edge || -999)) return Number(b.edge || -999) - Number(a.edge || -999)
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })

  // ensure FD + DK balance before final best selection
  const fd = candidates.filter((p) => p.book === "FanDuel")
  const dk = candidates.filter((p) => p.book === "DraftKings")
  const activeBooksInCandidates = [
    fd.length > 0 ? "FanDuel" : null,
    dk.length > 0 ? "DraftKings" : null
  ].filter(Boolean)
  const dualBookMode = activeBooksInCandidates.length > 1

  let bestPool = candidates

  if (dualBookMode) {
    const MAX_PER_BOOK = Math.ceil((config?.bestCap || 60) / 2)
    const balancedPool = [
      ...fd.slice(0, MAX_PER_BOOK),
      ...dk.slice(0, MAX_PER_BOOK)
    ]
    bestPool = balancedPool.length > 0 ? balancedPool : candidates
  }

  const sorted = bestPool
    .slice()
    .sort((a, b) => {
      const scoreDiff = bestBoardOrderingScore(b) - bestBoardOrderingScore(a)
      if (scoreDiff !== 0) return scoreDiff
      if (Number(b.edge || -999) !== Number(a.edge || -999)) return Number(b.edge || -999) - Number(a.edge || -999)
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })

  const eligibleByBook = countByBookForRows(sorted)
  const reserveTargetByBook = {
    FanDuel: Math.min(config.minPerBook, eligibleByBook.FanDuel || 0),
    DraftKings: Math.min(config.minPerBook, eligibleByBook.DraftKings || 0)
  }

  const bookBuckets = {
    FanDuel: sorted.filter((row) => String(row?.book || "") === "FanDuel"),
    DraftKings: sorted.filter((row) => String(row?.book || "") === "DraftKings")
  }
  const bookCursor = {
    FanDuel: 0,
    DraftKings: 0
  }
  // --- Single-book mode logic ---
  const activeCandidateBooks = Object.keys(eligibleByBook).filter((b) => eligibleByBook[b] > 0)
  const singleBookMode = activeCandidateBooks.length === 1
  if (singleBookMode && activeCandidateBooks[0] === "DraftKings") {
    config.maxPerPlayer = Math.max(config.maxPerPlayer, 8)
    config.maxPerMatchup = Math.max(config.maxPerMatchup, 12)
    config.maxPerType = {
      ...config.maxPerType,
      Assists: Math.max(Number(config.maxPerType?.Assists || 0), 40),
      Rebounds: Math.max(Number(config.maxPerType?.Rebounds || 0), 40),
      Points: Math.max(Number(config.maxPerType?.Points || 0), 40),
      Threes: Math.max(Number(config.maxPerType?.Threes || 0), 24),
      PRA: Math.max(Number(config.maxPerType?.PRA || 0), 24)
    }
  }

  const keyOf = (row) => `${row?.player || ""}|${row?.book || ""}|${row?.propType || ""}|${row?.matchup || ""}|${Number(row?.line)}|${row?.side || ""}`
  const selected = []
  const selectedKeys = new Set()
  const playerCounts = new Map()
  const matchupCounts = new Map()
  const typeCounts = new Map()
  const bookCounts = new Map()
  const sideCounts = new Map()
  const dropCounts = {
    droppedByBookCap: 0,
    droppedByPlayerCap: 0,
    droppedByMatchupCap: 0,
    droppedByStatCap: 0,
    droppedByQualityShape: 0,
    droppedByDedupe,
    droppedByIneligible
  }
  const dropReasonByKey = {}
  const droppedRowObjects = []
  let skippedLowQualityCount = 0
  let openFillAdded = 0

  const selectedByBook = () => countByBookForRows(selected)
  const getBookCount = (book) => bookCounts.get(book) || 0
  const finalDifferenceFDvsDK = () => Math.abs(getBookCount("FanDuel") - getBookCount("DraftKings"))
  const recordDrop = (row, reason) => {
    const key = keyOf(row)
    if (selectedKeys.has(key)) return
    if (dropReasonByKey[key]) return
    dropReasonByKey[key] = reason
      droppedRowObjects.push({ row, reason })
    if (reason === "droppedByBookCap") dropCounts.droppedByBookCap += 1
    if (reason === "droppedByPlayerCap") dropCounts.droppedByPlayerCap += 1
    if (reason === "droppedByMatchupCap") dropCounts.droppedByMatchupCap += 1
    if (reason === "droppedByStatCap") dropCounts.droppedByStatCap += 1
    if (reason === "droppedByQualityShape") dropCounts.droppedByQualityShape += 1
  }

  const normalizeBestPlayerKey = (value) =>
    String(value || "")
      .normalize("NFKD")
      .replace(/[’']/g, "")
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()

  const canTakeRow = (row, mode = "reserve") => {
    const player = String(row.player || "")
    const normalizedPlayer = normalizeBestPlayerKey(player)
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    const side = String(row?.side || "")
    const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
    const hitRate = parseHitRate(row?.hitRate)
    const score = Number(row?.score ?? 0)

    if (selected.length >= config.targetTotal) return { ok: false, reason: "droppedByBookCap" }
    if ((playerCounts.get(player) || 0) >= config.maxPerPlayer) return { ok: false, reason: "droppedByPlayerCap" }
    if ((matchupCounts.get(matchup) || 0) >= config.maxPerMatchup) return { ok: false, reason: "droppedByMatchupCap" }
    if ((typeCounts.get(propType) || 0) >= (config.maxPerType[propType] ?? 999)) return { ok: false, reason: "droppedByStatCap" }

    if (mode === "open") {
      const projectedFD = getBookCount("FanDuel") + (bookKey === "FanDuel" ? 1 : 0)
      const projectedDK = getBookCount("DraftKings") + (bookKey === "DraftKings" ? 1 : 0)
      if (!singleBookMode && Math.abs(projectedFD - projectedDK) > 6) {
        return { ok: false, reason: "droppedByBookCap" }
      }
    }

    if (isBestBoardPath) {
      const sideLower = side.toLowerCase()
      if ((playerCounts.get(normalizedPlayer) || 0) >= 1) {
        const passesRepeatPlayerGate = config.partialPostingMode
          ? (hitRate >= 0.66 && edge >= 1.5 && score >= 78)
          : (hitRate >= 0.71 && edge >= 2.25 && score >= 88)
        if (!passesRepeatPlayerGate) {
          return { ok: false, reason: "droppedByQualityShape" }
        }
      }

      const passesUnderGate = config.partialPostingMode
        ? (hitRate >= 0.63 && edge >= 1.25 && score >= 70)
        : (hitRate >= 0.68 && edge >= 2.0 && score >= 78)
      if (side === "Under" && !passesUnderGate) {
        return { ok: false, reason: "droppedByQualityShape" }
      }

      // Soft composition guard: avoid under-heavy boards unless an under is truly elite.
      if (mode === "open" && sideLower === "under" && selected.length >= 12) {
        const projectedUnderCount = (sideCounts.get("under") || 0) + 1
        const projectedShare = projectedUnderCount / (selected.length + 1)
        const softUnderShareCap = config.partialPostingMode ? 0.58 : 0.55
        const eliteUnderException = config.partialPostingMode
          ? (hitRate >= 0.69 && edge >= 1.6 && score >= 82)
          : (hitRate >= 0.72 && edge >= 2.1 && score >= 88)

        if (projectedShare > softUnderShareCap && !eliteUnderException) {
          return { ok: false, reason: "droppedByQualityShape" }
        }
      }
    }

    return { ok: true }
  }

  const takeRow = (row) => {
    const player = String(row.player || "")
    const normalizedPlayer = normalizeBestPlayerKey(player)
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    const sideKey = String(row?.side || "").toLowerCase()
    const key = keyOf(row)
    selected.push(row)
    selectedKeys.add(key)
    playerCounts.set(normalizedPlayer, (playerCounts.get(normalizedPlayer) || 0) + 1)
    matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
    typeCounts.set(propType, (typeCounts.get(propType) || 0) + 1)
    bookCounts.set(bookKey, (bookCounts.get(bookKey) || 0) + 1)
    if (sideKey) sideCounts.set(sideKey, (sideCounts.get(sideKey) || 0) + 1)
  }

  const takeNextFromBook = (bookKey) => {
    const bucket = bookBuckets[bookKey] || []
    while ((bookCursor[bookKey] || 0) < bucket.length) {
      const row = bucket[bookCursor[bookKey]]
      bookCursor[bookKey] += 1
      if (selectedKeys.has(keyOf(row))) continue

      const projectedFD = getBookCount("FanDuel") + (bookKey === "FanDuel" ? 1 : 0)
      const projectedDK = getBookCount("DraftKings") + (bookKey === "DraftKings" ? 1 : 0)
      if (!singleBookMode && Math.abs(projectedFD - projectedDK) > 6) {
        recordDrop(row, "droppedByBookCap")
        continue
      }

      const decision = canTakeRow(row, "reserve")
      if (!decision.ok) {
        recordDrop(row, decision.reason)
        continue
      }
      takeRow(row)
      return true
    }
    return false
  }

  let selectedByBookAfterReservePass = {}
  if (singleBookMode) {
    // Only one book: skip per-book balancing, just take top N globally
    for (const row of sorted) {
      if (selected.length >= config.targetTotal) break
      if (selectedKeys.has(keyOf(row))) continue
      const decision = canTakeRow(row, "open")
      if (!decision.ok) {
        recordDrop(row, decision.reason)
        continue
      }
      takeRow(row)
    }
    selectedByBookAfterReservePass = selectedByBook()
    logBestStage(`${pathLabel}:afterPerBookBalancingAssignment`, selected)
    console.log("[BEST-PROPS-STAGE-COUNTS]", {
      path: pathLabel,
      stage: "afterPerBookBalancing",
      total: selected.length,
      byBook: selectedByBookAfterReservePass,
      singleBookMode,
      activeCandidateBooks
    })
    // In single-book mode, do not increment droppedByBookCap for per-book balancing
    dropCounts.droppedByBookCap = 0
  } else {
    const maxReserveRounds = Math.max(...TIER_BOOKS.map((book) => reserveTargetByBook[book] || 0), 0)
    for (let round = 0; round < maxReserveRounds; round += 1) {
      let madeProgress = false
      for (const bookKey of TIER_BOOKS) {
        if ((selectedByBook()[bookKey] || 0) >= (reserveTargetByBook[bookKey] || 0)) continue
        if (takeNextFromBook(bookKey)) madeProgress = true
      }
      if (!madeProgress) break
      if (selected.length >= config.targetTotal) break
    }
    selectedByBookAfterReservePass = selectedByBook()
    logBestStage(`${pathLabel}:afterPerBookBalancingAssignment`, selected)
    console.log("[BEST-PROPS-STAGE-COUNTS]", {
      path: pathLabel,
      stage: "afterPerBookBalancing",
      total: selected.length,
      byBook: selectedByBookAfterReservePass,
      singleBookMode,
      activeCandidateBooks
    })
  }

  for (const row of sorted) {
    if (selected.length >= config.targetTotal) break
    if (selectedKeys.has(keyOf(row))) continue

    const hitRate = parseHitRate(row.hitRate)
    const edge = Number(row.edge ?? row.projectedValue ?? 0)
    if (hitRate < 0.5 || edge < -1.0) {
      skippedLowQualityCount += 1
      continue
    }

    const decision = canTakeRow(row, "open")
    if (!decision.ok) {
      recordDrop(row, decision.reason)
      continue
    }
    takeRow(row)
    openFillAdded += 1
  }

  // Controlled fallback: if strict quality gating under-fills, admit only slightly lower quality rows.
  if (selected.length < config.targetTotal) {
    for (const row of sorted) {
      if (selected.length >= config.targetTotal) break
      if (selectedKeys.has(keyOf(row))) continue

      const hitRate = parseHitRate(row.hitRate)
      const edge = Number(row.edge ?? row.projectedValue ?? 0)
      if (hitRate < 0.47 || edge < -2.0) continue

      const decision = canTakeRow(row, "open")
      if (!decision.ok) {
        recordDrop(row, decision.reason)
        continue
      }
      takeRow(row)
      openFillAdded += 1
    }
  }

  const dedupeSelectedBestRowsByPlayer = (rows) => {
    if (!isBestBoardPath) return Array.isArray(rows) ? rows : []

    const safeRows = Array.isArray(rows) ? rows : []
    const perPlayerCap = config.partialPostingMode ? 2 : 1
    const playerCounts = new Map()
    const playerPropTypes = new Map()
    const out = []

    for (const row of safeRows) {
      const playerKey = normalizeBestPlayerKey(row?.player)
      if (!playerKey) continue
      const count = playerCounts.get(playerKey) || 0
      if (count >= perPlayerCap) continue
      if (config.partialPostingMode && count >= 1) {
        const currentPropType = String(row?.propType || "")
        const seenTypes = playerPropTypes.get(playerKey) || new Set()
        if (currentPropType && seenTypes.has(currentPropType)) continue
      }
      playerCounts.set(playerKey, count + 1)
      const propType = String(row?.propType || "")
      const nextSeenTypes = playerPropTypes.get(playerKey) || new Set()
      if (propType) nextSeenTypes.add(propType)
      playerPropTypes.set(playerKey, nextSeenTypes)
      out.push(row)
    }

    return out
  }

  let finalSelected = dedupeSelectedBestRowsByPlayer(selected)
  let partialDiversityFillAdded = 0
  if (config.partialPostingMode && finalSelected.length < Math.min(32, config.targetTotal)) {
    const refillTarget = Math.min(32, config.targetTotal)
    const refillRows = [...finalSelected]
    const refillKeys = new Set(refillRows.map((row) => keyOf(row)))
    const refillPlayerCounts = new Map()
    const refillMatchupCounts = new Map()
    const refillPlayerPropKeys = new Set()

    for (const row of refillRows) {
      const playerKey = normalizeBestPlayerKey(row?.player)
      const matchupKey = String(row?.matchup || "")
      const propType = String(row?.propType || "")
      if (playerKey) {
        refillPlayerCounts.set(playerKey, (refillPlayerCounts.get(playerKey) || 0) + 1)
        if (propType) refillPlayerPropKeys.add(`${playerKey}|${propType}`)
      }
      if (matchupKey) refillMatchupCounts.set(matchupKey, (refillMatchupCounts.get(matchupKey) || 0) + 1)
    }

    const matchupCapForRefill = Math.max(5, Math.min(8, Math.ceil(refillTarget / 4)))
    for (const row of sorted) {
      if (refillRows.length >= refillTarget) break
      const key = keyOf(row)
      if (refillKeys.has(key)) continue

      const hitRate = parseHitRate(row?.hitRate)
      const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
      const score = Number(row?.score ?? 0)
      if (hitRate < 0.58 || edge < 0.75 || score < 72) continue

      const playerKey = normalizeBestPlayerKey(row?.player)
      const matchupKey = String(row?.matchup || "")
      const propType = String(row?.propType || "")
      const playerPropKey = `${playerKey}|${propType}`

      if (!playerKey || !matchupKey || !propType) continue
      if ((refillPlayerCounts.get(playerKey) || 0) >= 2) continue
      if (refillPlayerPropKeys.has(playerPropKey)) continue
      if ((refillMatchupCounts.get(matchupKey) || 0) >= matchupCapForRefill) continue

      refillRows.push(row)
      refillKeys.add(key)
      refillPlayerCounts.set(playerKey, (refillPlayerCounts.get(playerKey) || 0) + 1)
      refillPlayerPropKeys.add(playerPropKey)
      refillMatchupCounts.set(matchupKey, (refillMatchupCounts.get(matchupKey) || 0) + 1)
      partialDiversityFillAdded += 1
    }

    finalSelected = refillRows
  }
  const postCapByBook = summarizeBestPropsCapPool(finalSelected).byBook
  logBestStage(`${pathLabel}:afterPerBookBalancingFinal`, finalSelected)
  console.log("[BEST-PROPS-BALANCER-DEBUG]", {
    path: pathLabel,
    sourceTotal: rawSource.length,
    sourceByBook,
    eligibleByBookBeforeBalancing: eligibleByBook,
    reservedTargetByBook: reserveTargetByBook,
    selectedByBookAfterReservePass,
    selectedByBookAfterFinalFill: postCapByBook,
    targetTotal: config.targetTotal,
    minPerBook: config.minPerBook,
    openFillAdded,
    partialDiversityFillAdded,
    skippedLowQualityCount,
    finalDifferenceFDvsDK: finalDifferenceFDvsDK(),
    finalTotal: finalSelected.length,
    finalFD: finalSelected.filter((row) => row?.book === "FanDuel").length,
    finalDK: finalSelected.filter((row) => row?.book === "DraftKings").length
  })

  console.log("[BEST-PROPS-BALANCER-DROPS]", {
    path: pathLabel,
    droppedByBookCap: dropCounts.droppedByBookCap,
    droppedByPlayerCap: dropCounts.droppedByPlayerCap,
    droppedByMatchupCap: dropCounts.droppedByMatchupCap,
    droppedByStatCap: dropCounts.droppedByStatCap,
    droppedByDedupe: dropCounts.droppedByDedupe,
    droppedByIneligible: dropCounts.droppedByIneligible
  })

  const top15Dropped = droppedRowObjects
    .sort((a, b) => config.ranker(b.row) - config.ranker(a.row))
    .slice(0, 15)
    .map(({ row, reason }) => ({
      player: row?.player,
      team: row?.team,
      book: row?.book,
      propType: row?.propType,
      side: row?.side,
      line: row?.line,
      propVariant: row?.propVariant || "base",
      hitRate: parseHitRate(row?.hitRate),
      edge: Number(row?.edge || 0),
      score: Number(row?.score || 0),
      dropReason: reason
    }))
  console.log("[FINAL-BEST-THINNING-DEBUG]", {
    path: pathLabel,
    sourceCount: rawSource.length,
    afterSafetyFilters: eligibleSource.length,
    afterDedupe: dedupedEligible.length,
    afterBalancing: (selectedByBookAfterReservePass.FanDuel || 0) + (selectedByBookAfterReservePass.DraftKings || 0),
    afterCap: finalSelected.length,
    finalByBook: countByBookForRows(finalSelected),
    finalByPropVariant: finalSelected.reduce((acc, row) => {
      const v = String(row?.propVariant || "base")
      acc[v] = (acc[v] || 0) + 1
      return acc
    }, {}),
    top15Dropped
  })


  return {
    selected: finalSelected,
    diagnostics: {
      config,
      pathLabel,
      sourceRawCount: rawSource.length,
      eligibleCount: eligibleSource.length,
      dedupedCount: dedupedEligible.length,
      postBalancerCount: finalSelected.length,
      sourceCount: sorted.length,
      finalCount: finalSelected.length,
      beforeCapByBook: countByBookForRows(sorted),
      afterCapByBook: postCapByBook,
      beforeCapByStat: summarizeBestPropsCapPool(sorted).byPropType,
      afterCapByStat: summarizeBestPropsCapPool(finalSelected).byPropType,
      dropCounts: {
        ...dropCounts,
        totalCap: Math.max(0, sorted.length - selected.length),
        perBookBalancing: dropCounts.droppedByBookCap,
        perPlayerCap: dropCounts.droppedByPlayerCap,
        perMatchupCap: dropCounts.droppedByMatchupCap,
        perStatCap: dropCounts.droppedByStatCap
      },
      dropReasonByKey,
      reserveTargetByBook,
      eligibleByBook,
      selectedByBookAfterReservePass,
      targetTotal: config.targetTotal,
      minPerBook: config.minPerBook,
      openFillAdded,
      partialDiversityFillAdded,
      skippedLowQualityCount,
      finalDifferenceFDvsDK: finalDifferenceFDvsDK()
    }
  }
}

const countByBookForRows = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return {
    FanDuel: safeRows.filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: safeRows.filter((row) => String(row?.book || "") === "DraftKings").length
  }
}

const logPropStageByBookDebug = (path, stages = {}) => {
  console.log("[PROP-STAGE-BY-BOOK-DEBUG]", {
    path,
    elite: countByBookForRows(stages.elite),
    strong: countByBookForRows(stages.strong),
    playable: countByBookForRows(stages.playable),
    best: countByBookForRows(stages.best)
  })
}

const ensureBestPropsPlayableBookFloor = (bestRows, playableRows, options = {}) => {
  const targetBook = String(options?.targetBook || "FanDuel")
  const minCount = Number.isFinite(options?.minCount) ? options.minCount : 8
  const totalCap = Number.isFinite(options?.totalCap) ? options.totalCap : BEST_PROPS_BALANCE_CONFIG.totalCap
  const healthyTotal = Number.isFinite(options?.healthyTotal) ? options.healthyTotal : 20

  let safeBestRows = dedupeSlipLegs(Array.isArray(bestRows) ? bestRows : [])
  const safePlayableRows = dedupeSlipLegs(Array.isArray(playableRows) ? playableRows : [])

  const currentBookCount = safeBestRows.filter((row) => String(row?.book || "") === targetBook).length
  if (safeBestRows.length < healthyTotal || currentBookCount >= minCount) {
    return {
      rows: safeBestRows,
      promotedCount: 0,
      initialBookCount: currentBookCount,
      finalBookCount: currentBookCount
    }
  }

  const existingKeys = new Set(
    safeBestRows.map((row) => `${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`)
  )

  const playableCandidates = safePlayableRows
    .filter((row) => String(row?.book || "") === targetBook)
    .filter((row) => playerFitsMatchup(row))
    .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    .filter((row) => !existingKeys.has(`${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`))
    .sort((a, b) => {
      const compositeDiff = bestPropsCompositeScore(b) - bestPropsCompositeScore(a)
      if (compositeDiff !== 0) return compositeDiff
      return Number(b?.score || 0) - Number(a?.score || 0)
    })

  let promotedCount = 0
  for (const candidate of playableCandidates) {
    if (safeBestRows.filter((row) => String(row?.book || "") === targetBook).length >= minCount) break
    safeBestRows.push(candidate)
    existingKeys.add(`${candidate?.player}-${candidate?.propType}-${candidate?.side}-${Number(candidate?.line)}-${candidate?.book}`)
    promotedCount += 1
  }

  safeBestRows = dedupeSlipLegs(safeBestRows)
    .sort((a, b) => {
      const compositeDiff = bestPropsCompositeScore(b) - bestPropsCompositeScore(a)
      if (compositeDiff !== 0) return compositeDiff
      return Number(b?.score || 0) - Number(a?.score || 0)
    })

  if (safeBestRows.length > totalCap) {
    const protectedRows = []
    const unprotectedRows = []
    let protectedFanDuelCount = 0

    for (const row of safeBestRows) {
      if (String(row?.book || "") === targetBook && protectedFanDuelCount < minCount) {
        protectedRows.push(row)
        protectedFanDuelCount += 1
      } else {
        unprotectedRows.push(row)
      }
    }

    safeBestRows = [...protectedRows, ...unprotectedRows].slice(0, totalCap)
  }

  const finalBookCount = safeBestRows.filter((row) => String(row?.book || "") === targetBook).length
  return {
    rows: safeBestRows,
    promotedCount,
    initialBookCount: currentBookCount,
    finalBookCount
  }
}

const ensureBestPropsBookPresence = (finalRows, sourceRows, options = {}) => {
  const targetBook = String(options?.targetBook || "DraftKings")
  const totalCap = Number.isFinite(options?.totalCap) ? options.totalCap : BEST_PROPS_BALANCE_CONFIG.totalCap
  const meaningfulFloor = Number.isFinite(options?.meaningfulFloor) ? options.meaningfulFloor : 8

  const safeFinalRows = dedupeSlipLegs(Array.isArray(finalRows) ? finalRows : [])
  const sourcePool = dedupeSlipLegs(Array.isArray(sourceRows) ? sourceRows : [])
  const sourceCandidatesForBook = sourcePool
    .filter((row) => String(row?.book || "") === targetBook)
    .filter((row) => playerFitsMatchup(row))
    .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    .sort((a, b) => {
      const scoreDiff = bestPropsCompositeScore(b) - bestPropsCompositeScore(a)
      if (scoreDiff !== 0) return scoreDiff
      return Number(b.score || 0) - Number(a.score || 0)
    })

  const sourceHasBook = sourceCandidatesForBook.length > 0
  const finalBookCount = safeFinalRows.filter((row) => String(row?.book || "") === targetBook).length
  const targetBookCount = sourceCandidatesForBook.length >= meaningfulFloor
    ? Math.min(meaningfulFloor, sourceCandidatesForBook.length)
    : sourceCandidatesForBook.length

  if (!sourceHasBook || finalBookCount >= targetBookCount) {
    return {
      rows: safeFinalRows,
      rescuedBook: null
    }
  }

  let nextRows = [...safeFinalRows]
  let remainingNeed = Math.max(0, targetBookCount - finalBookCount)

  const candidateQueue = sourceCandidatesForBook.filter((candidate) => {
    const candidateKey = `${candidate.player}|${candidate.propType}|${candidate.side}|${Number(candidate.line)}|${candidate.book}`
    return !nextRows.some((row) => `${row.player}|${row.propType}|${row.side}|${Number(row.line)}|${row.book}` === candidateKey)
  })

  while (remainingNeed > 0 && candidateQueue.length > 0) {
    const replacementCandidate = candidateQueue.shift()
    const replaceIndex = nextRows
      .map((row, idx) => ({ idx, row }))
      .filter((entry) => String(entry.row?.book || "") !== targetBook)
      .sort((a, b) => {
        const scoreDiff = bestPropsCompositeScore(a.row) - bestPropsCompositeScore(b.row)
        if (scoreDiff !== 0) return scoreDiff
        return Number(a.row?.score || 0) - Number(b.row?.score || 0)
      })[0]?.idx

    if (!Number.isInteger(replaceIndex)) break
    nextRows.splice(replaceIndex, 1, replacementCandidate)
    remainingNeed -= 1
  }

  nextRows = dedupeSlipLegs(nextRows).slice(0, totalCap)

  const finalRescuedCount = nextRows.filter((row) => String(row?.book || "") === targetBook).length
  const rescuedBook = finalRescuedCount > finalBookCount ? targetBook : null

  return {
    rows: nextRows,
    rescuedBook
  }
}

const playableProps = scoredProps.filter((row) => qualifiesPlayableTier(row))
logFunnelStage("refresh-snapshot", "playableProps-from-scoredProps", scoredProps, playableProps, { threshold: "mins/injury!=high and (score>=42 or hit>=0.62 or hit/edge support or hit/score support)" })
logFunnelExcluded("refresh-snapshot", "playableProps-from-scoredProps", scoredProps, playableProps)
  debugPipelineStages.afterPlayableProps = summarizePropPipelineRows(playableProps)
  debugPipelineStages.afterStrongProps = summarizePropPipelineRows(strongProps)
  debugPipelineStages.afterEliteProps = summarizePropPipelineRows(eliteProps)
logPropPipelineStep("refresh-snapshot", "after-playableProps-assignment", playableProps)
logPropPipelineStep("refresh-snapshot", "after-strongProps-assignment", strongProps)
logPropPipelineStep("refresh-snapshot", "after-eliteProps-assignment", eliteProps)

const capPoolByType = (rows, caps) => {
  const counts = new Map()
  const out = []

  for (const row of rows) {
    const key = row.propType
    const current = counts.get(key) || 0
    const cap = caps[key] ?? 99

    if (current >= cap) continue

    out.push(row)
    counts.set(key, current + 1)
  }

  return out
}

const capPoolByPlayer = (rows, maxPerPlayer = 2) => {
  const counts = new Map()
  const out = []

  for (const row of rows) {
    const current = counts.get(row.player) || 0
    if (current >= maxPerPlayer) continue

    out.push(row)
    counts.set(row.player, current + 1)
  }

  return out
}

const eliteCapped = capPoolByPlayer(
  capPoolByType(eliteProps, {
    Assists: 4,
    Rebounds: 4,
    Points: 4,
    Threes: 3,
    PRA: 1
  }),
  2
)
logFunnelStage("refresh-snapshot", "eliteCapped-from-eliteProps", eliteProps, eliteCapped, { typeCaps: "Assists:4,Rebounds:4,Points:4,Threes:3,PRA:1", playerCap: 2 })
logFunnelExcluded("refresh-snapshot", "eliteCapped-from-eliteProps", eliteProps, eliteCapped)

const strongCapped = capPoolByPlayer(
  capPoolByType(
    strongProps.filter((row) =>
      !eliteCapped.some(
        (e) =>
          e.player === row.player &&
          e.propType === row.propType &&
          e.side === row.side &&
          Number(e.line) === Number(row.line)
      )
    ),
    {
      Assists: 6,
      Rebounds: 6,
      Points: 6,
      Threes: 4,
      PRA: 2
    }
  ),
  2
)
logFunnelStage("refresh-snapshot", "strongCapped-from-strongProps", strongProps, strongCapped, { typeCaps: "Assists:6,Rebounds:6,Points:6,Threes:4,PRA:2", playerCap: 2, note: "deduped-vs-eliteCapped" })
logFunnelExcluded("refresh-snapshot", "strongCapped-from-strongProps", strongProps, strongCapped)

const playableCapped = selectBalancedPool(
  playableProps.filter((row) =>
    !eliteCapped.some(
      (e) =>
        e.player === row.player &&
        e.propType === row.propType &&
        e.side === row.side &&
        Number(e.line) === Number(row.line)
    ) &&
    !strongCapped.some(
      (e) =>
        e.player === row.player &&
        e.propType === row.propType &&
        e.side === row.side &&
        Number(e.line) === Number(row.line)
    )
  ),
  {
    totalCap: 180,
    minPerBook: 80,
    maxPerPlayer: 3,
    maxPerMatchup: 6,
    maxPerType: {
      Assists: 32,
      Rebounds: 32,
      Points: 32,
      Threes: 22,
      PRA: 16
    }
  }
)
logFunnelStage("refresh-snapshot", "playableCapped-from-playableProps", playableProps, playableCapped, { totalCap: 180, minPerBook: 80, maxPerPlayer: 3, maxPerMatchup: 6 })
logFunnelExcluded("refresh-snapshot", "playableCapped-from-playableProps", playableProps, playableCapped)

const matchupValidProps = enriched.filter((row) => playerFitsMatchup(row))

const preBestStandardRows = (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => {
  const family = String(row?.marketFamily || "")
  const propType = String(row?.propType || "")
  return family === "standard" || ["Points", "Rebounds", "Assists", "Threes", "PRA"].includes(propType)
})

console.log("[PRE-BEST-STANDARD-COVERAGE-DEBUG]", {
  total: preBestStandardRows.length,
  byPropType: preBestStandardRows.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  byBook: preBestStandardRows.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  sample: preBestStandardRows.slice(0, 20).map((row) => ({
    book: row?.book,
    propType: row?.propType,
    marketKey: row?.marketKey,
    player: row?.player,
    line: row?.line,
    hitRate: row?.hitRate,
    edge: row?.edge,
    score: row?.score
  }))
})


// --- Strict core bestProps promotion: only valid standard stat props ---
const STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
const bestPropsSourceRaw = Array.isArray(scoredProps) ? scoredProps : []
const bestPropsSource = []
const excludedSpecials = []
const excludedMalformed = []
for (const row of bestPropsSourceRaw) {
  const isStandard = STANDARD_PROP_TYPES.has(String(row?.propType || ""))
  const hasAllFields = (
    row &&
    row.player &&
    row.team &&
    row.matchup &&
    row.propType &&
    Number.isFinite(row.line) &&
    row.hitRate != null &&
    Number.isFinite(row.score) &&
    row.book &&
    playerFitsMatchup(row)
  )
  if (!isStandard) {
    excludedSpecials.push(row)
    continue
  }
  if (!hasAllFields) {
    excludedMalformed.push(row)
    continue
  }
  bestPropsSource.push(row)
}
logBestStage("refresh-snapshot:sourcePool", bestPropsSource)
console.log(`[BEST-PROPS-SOURCE-DEBUG] path=refresh-snapshot sourceCount=${bestPropsSource.length}`)
console.log("[BEST-PROPS-EXCLUDED-DEBUG]", {
  excludedSpecials: excludedSpecials.length,
  excludedMalformed: excludedMalformed.length,
  sampleSpecials: excludedSpecials.slice(0, 5).map(r => ({ player: r?.player, propType: r?.propType, book: r?.book, line: r?.line })),
  sampleMalformed: excludedMalformed.slice(0, 5).map(r => ({ player: r?.player, propType: r?.propType, book: r?.book, line: r?.line, hitRate: r?.hitRate, score: r?.score, team: r?.team }))
})

const scheduledEventCountForBestBoard = Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
const coveredEventCountForBestBoard = new Set(
  (Array.isArray(rawPropsRows) ? rawPropsRows : [])
    .map((row) => String(row?.eventId || ""))
    .filter(Boolean)
).size
const partialPostingModeForBestBoard =
  scheduledEventCountForBestBoard > 0 &&
  coveredEventCountForBestBoard > 0 &&
  coveredEventCountForBestBoard < scheduledEventCountForBestBoard

const bestPropsCapResult = buildBestPropsBalancedPool(bestPropsSource, {
  pathLabel: "refresh-snapshot",
  partialPostingMode: partialPostingModeForBestBoard
})
const preCapBestPropsPool = bestPropsCapResult.selected
logBestPropsCapDebug("refresh-snapshot", "pre-cap", bestPropsSource, preCapBestPropsPool, bestPropsCapResult.diagnostics)
let bestProps = preCapBestPropsPool.slice(0, BEST_PROPS_BALANCE_CONFIG.totalCap)
const sourceRows = Array.isArray(bestPropsSource) ? bestPropsSource : []
const fdRows = bestProps.filter((r) => r.book === "FanDuel")

if (fdRows.length < 10) {
  const fallbackFD = sourceRows
    .filter((r) => r.book === "FanDuel")
    .filter((r) => !shouldRemoveLegForPlayerStatus(r))
    .slice(0, 20)

  bestProps = [
    ...bestProps,
    ...fallbackFD.slice(0, 10 - fdRows.length)
  ]
}

console.log("[BEST-PROPS-BOOK-BALANCE]", {
  path: "refresh-snapshot",
  fanduel: bestProps.filter((r) => r.book === "FanDuel").length,
  draftkings: bestProps.filter((r) => r.book === "DraftKings").length
})
logBestStage("refresh-snapshot:afterRankingSortAndCap", bestProps)
logBestPropsCapExcluded("refresh-snapshot", bestPropsSource, bestProps, bestPropsCapResult.diagnostics)
logFunnelStage("refresh-snapshot", "bestProps-from-scoredProps", bestPropsSource, bestProps, { sortComposite: true, cap: BEST_PROPS_BALANCE_CONFIG.totalCap, minPerBook: BEST_PROPS_BALANCE_CONFIG.minPerBook, matchupCap: BEST_PROPS_BALANCE_CONFIG.maxPerMatchup, playerCap: BEST_PROPS_BALANCE_CONFIG.maxPerPlayer })
logFunnelExcluded("refresh-snapshot", "bestProps-from-scoredProps", bestPropsSource, bestProps)

const nextRawPropsCount = Array.isArray(rawPropsRows) ? rawPropsRows.length : 0
const nextPropsCount = Array.isArray(activeBookRawPropsRows) ? activeBookRawPropsRows.length : 0
const nextBestPropsCount = Array.isArray(bestProps) ? bestProps.length : 0
const scheduledEventsCount = Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
const previousRawPropsCount = Array.isArray(previousSnapshot?.rawProps) ? previousSnapshot.rawProps.length : 0
const previousBestPropsCount = Array.isArray(previousSnapshot?.bestProps) ? previousSnapshot.bestProps.length : 0

const previousHadUsableData = previousRawPropsCount > 0 || previousBestPropsCount > 0
const newSnapshotIsEmptyButSlateExists =
  scheduledEventsCount > 0 &&
  nextRawPropsCount === 0 &&
  nextPropsCount === 0 &&
  nextBestPropsCount === 0

console.log("[SNAPSHOT-COMMIT-CHECK]", {
  scheduledEventsCount,
  nextRawPropsCount,
  nextPropsCount,
  nextBestPropsCount,
  previousRawPropsCount,
  previousBestPropsCount
})

if (newSnapshotIsEmptyButSlateExists && previousHadUsableData) {
  console.log("[SNAPSHOT-PRESERVE-PREVIOUS]", {
    scheduledEventsCount,
    nextRawPropsCount,
    nextPropsCount,
    nextBestPropsCount,
    previousRawPropsCount,
    previousBestPropsCount
  })

  oddsSnapshot = previousSnapshot
  lastSnapshotSource = "refresh-live-empty-preserved-previous"

  return res.status(200).json({
    ok: true,
    message: "Live refresh returned no props; preserved previous snapshot",
    snapshotMeta: buildSnapshotMeta({ source: "refresh-live-empty-preserved-previous" }),
    snapshotGeneratedAt: oddsSnapshot?.snapshotGeneratedAt || oddsSnapshot?.updatedAt || null,
    snapshotSlateDateLocal: oddsSnapshot?.snapshotSlateDateLocal || oddsSnapshot?.snapshotSlateDateKey || (oddsSnapshot?.updatedAt ? toDetroitDateKey(oddsSnapshot.updatedAt) : null),
    counts: {
      scheduledEvents: scheduledEventsCount,
      incomingRawProps: nextRawPropsCount,
      incomingProps: nextPropsCount,
      incomingBestProps: nextBestPropsCount,
      preservedRawProps: previousRawPropsCount,
      preservedBestProps: previousBestPropsCount
    }
  })
}

console.log("[TOP-DOWN-SNAPSHOT-PRE-COMMIT]", {
  events: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
  rawProps: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
  props: Array.isArray(activeBookRawPropsRows) ? activeBookRawPropsRows.length : -1,
  bestProps: Array.isArray(bestProps) ? bestProps.length : -1
})
console.log("[REFRESH-STAGE-4-SNAPSHOT-ASSEMBLY]", {
  events: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
  rawProps: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
  props: Array.isArray(activeBookRawPropsRows) ? activeBookRawPropsRows.length : -1,
  bestProps: Array.isArray(bestProps) ? bestProps.length : -1
})
oddsSnapshot.updatedAt = new Date().toISOString()
const lineHistoryObservedAt = oddsSnapshot.updatedAt
const previousRawPropsForHistory = Array.isArray(previousSnapshot?.rawProps) ? previousSnapshot.rawProps : []
const previousPropsForHistory = Array.isArray(previousSnapshot?.props) ? previousSnapshot.props : []
const previousBestPropsForHistory = Array.isArray(previousSnapshot?.bestProps) ? previousSnapshot.bestProps : []
const rawPropsRowsWithHistory = applyPersistentLineHistory(rawPropsRows, previousRawPropsForHistory, lineHistoryObservedAt)
const activeBookRawPropsRowsWithHistory = applyPersistentLineHistory(activeBookRawPropsRows, previousPropsForHistory, lineHistoryObservedAt)
bestProps = applyPersistentLineHistory(bestProps, previousBestPropsForHistory, lineHistoryObservedAt)
oddsSnapshot.events = Array.isArray(scheduledEvents) ? scheduledEvents : []
oddsSnapshot.rawProps = rawPropsRowsWithHistory
oddsSnapshot.props = activeBookRawPropsRowsWithHistory
oddsSnapshot.snapshotGeneratedAt = oddsSnapshot.updatedAt || null
oddsSnapshot.snapshotSlateDateKey = chosenSlateDateKey || null
oddsSnapshot.snapshotSlateDateLocal = chosenSlateDateKey || (oddsSnapshot.updatedAt ? toDetroitDateKey(oddsSnapshot.updatedAt) : null)
oddsSnapshot.snapshotSlateGameCount = Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
const chosenEventIds = new Set((Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => String(event?.id || event?.eventId || "")).filter(Boolean))
const chosenEventIdsWithProps = new Set((Array.isArray(activeBookRawPropsRowsWithHistory) ? activeBookRawPropsRowsWithHistory : []).map((row) => String(row?.eventId || "")).filter((eventId) => chosenEventIds.has(eventId)))
const chosenEventIdsArray = Array.from(chosenEventIds)
const chosenEventIdsWithPropsArray = Array.from(chosenEventIdsWithProps)
const missingChosenEventIdsArray = chosenEventIdsArray.filter((eventId) => !chosenEventIdsWithProps.has(eventId))
const eventIngestDebugByEventId = new Map(
  (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
    .map((item) => [String(item?.eventId || ""), item])
    .filter(([eventId]) => Boolean(eventId))
)
const rawPropsRowsForCoverageDebug = Array.isArray(rawPropsRowsWithHistory)
  ? rawPropsRowsWithHistory
  : (Array.isArray(rawPropsRows) ? rawPropsRows : [])
const rawPropCountsByEventId = rawPropsRowsForCoverageDebug.reduce((acc, row) => {
  const eventId = String(row?.eventId || "")
  if (!eventId) return acc
  acc.set(eventId, (acc.get(eventId) || 0) + 1)
  return acc
}, new Map())
const chosenEventsById = (Array.isArray(scheduledEvents) ? scheduledEvents : []).reduce((acc, event) => {
  const eventId = String(event?.id || event?.eventId || "")
  if (eventId) acc.set(eventId, event)
  return acc
}, new Map())
const classifyChosenEventPostingState = (eventId, rawPropsCountBeforeFinalFiltering) => {
  const ingest = eventIngestDebugByEventId.get(eventId) || null
  const requestSucceeded = ingest?.dkRequestSucceeded === true
  const fetchError = ingest?.dkFetchError === true || ingest?.dkRequestSucceeded === false
  const dkBookmakerEntries = Number(ingest?.dkBookmakerEntries || 0)
  const dkMarketEntries = Number(ingest?.dkMarketEntries || 0)
  const acceptedRows = Number(ingest?.finalAcceptedRows || ingest?.normalizedRowsProduced || 0)

  if (rawPropsCountBeforeFinalFiltering > 0) {
    if (requestSucceeded && dkMarketEntries > 0 && dkMarketEntries <= 2) return "partial_props_posted"
    return "props_posted"
  }
  if (fetchError) return "ingest_error"
  if (requestSucceeded && dkBookmakerEntries === 0 && dkMarketEntries === 0) return "no_props_posted_yet"
  if (requestSucceeded && (dkBookmakerEntries > 0 || dkMarketEntries > 0) && acceptedRows === 0) return "fetched_but_zero_accepted_rows"
  return "true_unknown_gap"
}
const chosenEventCoverageStates = chosenEventIdsArray.map((eventId) => {
  const event = chosenEventsById.get(eventId) || null
  const rawPropsCountBeforeFinalFiltering = Number(rawPropCountsByEventId.get(eventId) || 0)
  return {
    eventId,
    matchup: event?.matchup || null,
    postingState: classifyChosenEventPostingState(eventId, rawPropsCountBeforeFinalFiltering),
    rawPropsCountBeforeFinalFiltering
  }
})
const missingChosenEventSummaries = missingChosenEventIdsArray.map((eventId) => {
  const event = chosenEventsById.get(eventId) || null
  const ingest = eventIngestDebugByEventId.get(eventId) || null
  const rawPropsCountBeforeFinalFiltering = Number(rawPropCountsByEventId.get(eventId) || 0)
  const postingState = classifyChosenEventPostingState(eventId, rawPropsCountBeforeFinalFiltering)
  return {
    eventId,
    matchup: event?.matchup || null,
    commenceTime: event ? (getEventTime(event) || event?.commenceTime || null) : null,
    homeTeam: event?.homeTeam || event?.home_team || null,
    awayTeam: event?.awayTeam || event?.away_team || null,
    postingState,
    dkFetchError: ingest?.dkFetchError === true,
    dkRequestSucceeded: ingest?.dkRequestSucceeded === true,
    dkBookmakerEntries: Number(ingest?.dkBookmakerEntries || 0),
    dkMarketEntries: Number(ingest?.dkMarketEntries || 0),
    rawPropsExistedBeforeFinalFiltering: rawPropsCountBeforeFinalFiltering > 0,
    rawPropsCountBeforeFinalFiltering
  }
})
const chosenEventCount = chosenEventIds.size
const chosenEventsWithPropsCount = chosenEventIdsWithProps.size
const partialPostedChosenEventCount = chosenEventCoverageStates.filter((item) => item.postingState === "partial_props_posted").length
const noPropsPostedChosenEventCount = chosenEventCoverageStates.filter((item) => item.postingState === "no_props_posted_yet").length
const ingestErrorChosenEventCount = chosenEventCoverageStates.filter((item) => item.postingState === "ingest_error").length
console.log("[CHOSEN-SLATE-PROP-COVERAGE-DEBUG]", {
  chosenSlateDateKey,
  chosenEventCount,
  chosenEventsWithPropsCount,
  partialPostedChosenEventCount,
  noPropsPostedChosenEventCount,
  ingestErrorChosenEventCount,
  chosenEventIds: chosenEventIdsArray,
  chosenEventIdsWithProps: chosenEventIdsWithPropsArray,
  missingChosenEventIds: missingChosenEventIdsArray,
  chosenEventCoverageStates,
  missingChosenEventSummaries
})
const chosenPropsPartiallyPosted = chosenEventCount > 0 && chosenEventsWithPropsCount > 0 && chosenEventsWithPropsCount < chosenEventCount
let slateState = "active_today"
if (todayPregameEligible.length > 0) {
  slateState = "active_today"
} else if (chosenSlateDateKey === tomorrowDateKey && chosenEventsWithPropsCount === 0) {
  slateState = "awaiting_posting"
} else if (chosenSlateDateKey === tomorrowDateKey) {
  slateState = "rolled_to_tomorrow"
}
oddsSnapshot.slateStateValidator = {
  currentDateKeyChosen: chosenSlateDateKey || null,
  currentPregameGameCount: todayPregameEligible.length,
  todayTotalGames: todayEvents.length,
  tomorrowTotalGames: tomorrowEvents.length,
  todayHasPregameGames: todayPregameEligible.length > 0,
  tomorrowPropsPartiallyPosted: chosenSlateDateKey === tomorrowDateKey ? chosenPropsPartiallyPosted : false,
  slateState,
  chosenEventsWithPropsCount,
  chosenEventCount,
  partialPostedChosenEventCount,
  noPropsPostedChosenEventCount,
  ingestErrorChosenEventCount,
  chosenEventCoverageStates,
  missingChosenEventIds: missingChosenEventIdsArray,
  missingChosenEventSummaries,
  rolloverApplied: chosenSlateDateKey !== todayDateKey,
  nextDateKeyConsidered: tomorrowDateKey,
  nextPregameGameCount: tomorrowEvents.filter(e => {
    const t = new Date(getEventTime(e)).getTime()
    return Number.isFinite(t) && t > slateNow
  }).length
}
console.log("[UNSTABLE-GAME-INGEST-DEBUG]", {
  path: "refresh-snapshot",
  targets: targetMissingEventStages.map((stage) => ({
    ...stage,
    inFinalSavedRawProps: (oddsSnapshot.rawProps || []).some((row) => String(row?.eventId || "") === stage.eventId),
    inFinalSavedProps: (oddsSnapshot.props || []).some((row) => String(row?.eventId || "") === stage.eventId)
  }))
})
oddsSnapshot.eliteProps = applyPersistentLineHistory(eliteCapped.filter((row) => playerFitsMatchup(row)), previousRawPropsForHistory, lineHistoryObservedAt)
logFunnelStage("refresh-snapshot", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps)
oddsSnapshot.strongProps = applyPersistentLineHistory(strongCapped.filter((row) => playerFitsMatchup(row)), previousRawPropsForHistory, lineHistoryObservedAt)
logFunnelStage("refresh-snapshot", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps)
oddsSnapshot.playableProps = applyPersistentLineHistory(playableCapped.filter((row) => playerFitsMatchup(row)), previousRawPropsForHistory, lineHistoryObservedAt)
logFunnelStage("refresh-snapshot", "oddsSnapshot.playableProps", playableCapped, oddsSnapshot.playableProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.playableProps", playableCapped, oddsSnapshot.playableProps)
logPropStageByBookDebug("refresh-snapshot:afterTierAssignment", {
  elite: oddsSnapshot.eliteProps,
  strong: oddsSnapshot.strongProps,
  playable: oddsSnapshot.playableProps,
  best: bestProps
})

// STEP 5: Final visibility guarantee - ensure all watched players in rawProps make it to bestProps
const watchedNormalized = WATCHED_PLAYER_NAMES.map(normalizeDebugPlayerName)
const allRawPropsForWatchedCheck = dedupeByLegSignature([
  ...(Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props : [])
])
const missingWatchedInBest = allRawPropsForWatchedCheck.filter(row => {
  const name = normalizeDebugPlayerName(row?.player || "")
  const isWatched = watchedNormalized.includes(name)
  const inBest = bestProps.some(p => normalizeDebugPlayerName(p?.player || "") === name)
  return isWatched && !inBest
})

for (const row of missingWatchedInBest) {
  const playerName = normalizeDebugPlayerName(row?.player || "")
  if (!bestProps.some(p => normalizeDebugPlayerName(p?.player || "") === playerName)) {
    bestProps.push(row)
    console.log("[WATCHED-PLAYER-FINAL-GUARANTEE]", {
      player: row?.player,
      reason: "missing_from_best_added_from_raw",
      propType: row?.propType,
      book: row?.book,
      line: row?.line
    })
  }
}

const finalBestPropsGateDebug = {
  finalBestPropsExcludedSpecial: 0,
  finalBestPropsExcludedNonStandard: 0,
  finalBestPropsExcludedInvalidCoreFields: 0,
  finalBestPropsExcludedInvalidLine: 0,
  finalBestPropsExcludedInvalidScore: 0,
  finalBestPropsForceIncludedBlocked: 0
}
const bestPropsAfterFinalLegacyGate = (Array.isArray(bestProps) ? bestProps : []).filter((row) => {
  if (!row) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidCoreFields += 1
    return false
  }

  const blockForceIncluded = () => {
    if (row?.__forceInclude) finalBestPropsGateDebug.finalBestPropsForceIncludedBlocked += 1
  }

  if (String(row?.marketFamily || "") === "special") {
    finalBestPropsGateDebug.finalBestPropsExcludedSpecial += 1
    blockForceIncluded()
    return false
  }

  if (!STANDARD_PROP_TYPES.has(String(row?.propType || ""))) {
    finalBestPropsGateDebug.finalBestPropsExcludedNonStandard += 1
    blockForceIncluded()
    return false
  }

  if (!row?.player || !row?.team || !row?.matchup || !row?.propType || !row?.book) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidCoreFields += 1
    blockForceIncluded()
    return false
  }

  if (!Number.isFinite(Number(row?.line))) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidLine += 1
    blockForceIncluded()
    return false
  }

  if (!Number.isFinite(Number(row?.score))) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidScore += 1
    blockForceIncluded()
    return false
  }

  return true
})

console.log("[BEST-PROPS-FINAL-GATE-DEBUG]", {
  inputCount: Array.isArray(bestProps) ? bestProps.length : 0,
  outputCount: bestPropsAfterFinalLegacyGate.length,
  ...finalBestPropsGateDebug
})

oddsSnapshot.bestProps = dedupeByLegSignature(bestPropsAfterFinalLegacyGate)
oddsSnapshot.lineHistorySummary = buildLineHistorySummary(oddsSnapshot.bestProps)
const bestPropsBookSoftFloor = Math.max(
  4,
  Math.min(10, Math.floor((Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0) * 0.3))
)
console.log("[FINAL-LEGACY-BESTPROPS-DEBUG]", {
  total: Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0,
  bestPropsByPropType: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  bestPropsByMarketFamily: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).reduce((acc, row) => {
    const key = String(row?.marketFamily || "unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  invalidLineCount: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => !Number.isFinite(Number(row?.line))).length,
  invalidScoreCount: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => !Number.isFinite(Number(row?.score))).length,
  missingTeamCount: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => !row?.team).length,
  sample: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).slice(0, 10).map((row) => ({
    player: row?.player || null,
    matchup: row?.matchup || null,
    propType: row?.propType || null,
    marketKey: row?.marketKey || null,
    marketFamily: row?.marketFamily || null,
    team: row?.team || null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    score: row?.score ?? null,
    hitRate: row?.hitRate ?? null,
    __forceInclude: row?.__forceInclude === true
  }))
})
logBestStage("refresh-snapshot:afterDedupe", oddsSnapshot.bestProps)
const mainBestPropsBookRescue = ensureBestPropsBookPresence(oddsSnapshot.bestProps, bestPropsSource, {
  targetBook: "DraftKings",
  totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
  meaningfulFloor: bestPropsBookSoftFloor
})
const mainBestPropsFanDuelRescue = ensureBestPropsBookPresence(mainBestPropsBookRescue.rows, bestPropsSource, {
  targetBook: "FanDuel",
  totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
  meaningfulFloor: bestPropsBookSoftFloor
})
const refreshPlayableFanDuelPromotion = ensureBestPropsPlayableBookFloor(
  mainBestPropsFanDuelRescue.rows,
  oddsSnapshot.playableProps,
  {
    targetBook: "FanDuel",
    minCount: 8,
    totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap
  }
)
oddsSnapshot.bestProps = dedupeByLegSignature(
  Array.isArray(refreshPlayableFanDuelPromotion.rows) ? refreshPlayableFanDuelPromotion.rows : []
)
oddsSnapshot.lineHistorySummary = buildLineHistorySummary(oddsSnapshot.bestProps)
logBestStage("refresh-snapshot:afterBookBalance", refreshPlayableFanDuelPromotion.rows)
console.log("[BEST-PROPS-PLAYABLE-PROMOTION-DEBUG]", {
  path: "refresh-snapshot",
  initialFanDuelCount: refreshPlayableFanDuelPromotion.initialBookCount,
  finalFanDuelCount: refreshPlayableFanDuelPromotion.finalBookCount,
  promotedCount: refreshPlayableFanDuelPromotion.promotedCount,
  playableFanDuelCount: countByBookForRows(oddsSnapshot.playableProps).FanDuel
})

const refreshSnapshotBestPropsRawRows = Array.isArray(refreshPlayableFanDuelPromotion.rows) ? refreshPlayableFanDuelPromotion.rows : []
console.log("[BEST-RAW-BY-PROP-DEBUG]", {
  total: Array.isArray(refreshSnapshotBestPropsRawRows) ? refreshSnapshotBestPropsRawRows.length : 0,
  byPropType: (Array.isArray(refreshSnapshotBestPropsRawRows) ? refreshSnapshotBestPropsRawRows : []).reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
})
const refreshSnapshotFinalBestVisibleRowsPreSave = getAvailablePrimarySlateRows(refreshSnapshotBestPropsRawRows)
const refreshSnapshotSurvivedFragileRowsPreSave = (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => {
  try {
    return !isFragileLeg(row, "best")
  } catch (_) {
    return true
  }
})
console.log("[FRAGILE-FILTER-SUMMARY-DEBUG]", {
  inputCount: (Array.isArray(enriched) ? enriched : []).length,
  survivedCount: refreshSnapshotSurvivedFragileRowsPreSave.length,
  removedCount: Math.max(0, (Array.isArray(enriched) ? enriched : []).length - refreshSnapshotSurvivedFragileRowsPreSave.length),
  byBookInput: {
    FanDuel: (Array.isArray(enriched) ? enriched : []).filter((row) => row?.book === "FanDuel").length,
    DraftKings: (Array.isArray(enriched) ? enriched : []).filter((row) => row?.book === "DraftKings").length
  },
  byBookSurvived: {
    FanDuel: refreshSnapshotSurvivedFragileRowsPreSave.filter((row) => row?.book === "FanDuel").length,
    DraftKings: refreshSnapshotSurvivedFragileRowsPreSave.filter((row) => row?.book === "DraftKings").length
  }
})
const refreshSnapshotMissingStageNames = []
const targetEvents = Array.isArray(scheduledEvents)
  ? scheduledEvents
  : (Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : [])
if (!Array.isArray(targetEvents)) refreshSnapshotMissingStageNames.push("scheduledEvents")
if (!Array.isArray(cleaned)) refreshSnapshotMissingStageNames.push("rawPropsRows")
if (!Array.isArray(enriched)) refreshSnapshotMissingStageNames.push("enrichedModelRows")
if (!Array.isArray(scoredProps)) refreshSnapshotMissingStageNames.push("survivedFragileRows")
if (!Array.isArray(refreshPlayableFanDuelPromotion.rows)) refreshSnapshotMissingStageNames.push("bestPropsRawRows")

const refreshRawPropsByBook = countByBookForRows(activeBookRawPropsRows)
const refreshSurvivedFragileByBook = countByBookForRows(refreshSnapshotSurvivedFragileRowsPreSave)
const refreshPreBestCandidateByBook = countByBookForRows(Array.isArray(bestPropsSource) ? bestPropsSource : [])
const refreshFinalBestRawByBook = countByBookForRows(refreshSnapshotBestPropsRawRows)

console.log("[BEST-PROPS-BOOK-STAGE-DEBUG]", {
  path: "refresh-snapshot",
  rawPropsRows: refreshRawPropsByBook,
  dedupedRows: countByBookForRows(deduped),
  scoredPropsRows: countByBookForRows(scoredProps),
  survivedFragileRows: refreshSurvivedFragileByBook,
  preBestPropsCandidates: refreshPreBestCandidateByBook,
  finalBestPropsRawRows: refreshFinalBestRawByBook,
  balancer: {
    minPerBook: bestPropsCapResult?.diagnostics?.minPerBook,
    reserveTargetByBook: bestPropsCapResult?.diagnostics?.reserveTargetByBook,
    selectedByBookAfterReservePass: bestPropsCapResult?.diagnostics?.selectedByBookAfterReservePass,
    finalDifferenceFDvsDK: bestPropsCapResult?.diagnostics?.finalDifferenceFDvsDK
  }
})

const refreshFdCandidates = (Array.isArray(bestPropsSource) ? bestPropsSource : []).filter((row) => String(row?.book || "") === "FanDuel")
const refreshFdFinal = refreshSnapshotBestPropsRawRows.filter((row) => String(row?.book || "") === "FanDuel")
const refreshFdDropReasons = {
  totalFdCandidates: refreshFdCandidates.length,
  finalFdRows: refreshFdFinal.length,
  droppedByBookBalancer: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perBookBalancing || 0),
  droppedByPlayerCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perPlayerCap || 0),
  droppedByMatchupCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perMatchupCap || 0),
  droppedByStatCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perStatCap || 0),
  droppedByTotalCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.totalCap || 0),
  sourceHasFanDuelCandidates: refreshFdCandidates.length > 0
}

console.log("[BEST-PROPS-BOOK-EXCLUSION-DEBUG]", {
  path: "refresh-snapshot",
  fanduel: refreshFdDropReasons
})

const __normalizedFamilySummary = summarizeInterestingNormalizedRows(rawPropsRows || [])
const __normalizedCoverageSummary = summarizeNormalizedMarketCoverage(rawPropsRows || [])

console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", __normalizedFamilySummary)
console.log("[NORMALIZATION-MARKET-KEYS-TOP-DEBUG]", {
  totalRows: __normalizedCoverageSummary.totalRows,
  topPropTypes: Object.entries(__normalizedCoverageSummary.byPropType || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15),
  topMarketKeys: Object.entries(__normalizedCoverageSummary.byMarketKey || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25),
  byBookAndPropType: __normalizedCoverageSummary.byBookAndPropType || {}
})

console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
  path: "refresh-snapshot-pre-finalize",
  scheduledEvents: (Array.isArray(targetEvents) ? targetEvents : []).length,
  rawPropsRows: activeBookRawPropsRows.length,
  enrichedModelRows: (Array.isArray(enriched) ? enriched : []).length,
  survivedFragileRows: refreshSnapshotSurvivedFragileRowsPreSave.length,
  survivedFragileRowsByBook: {
    FanDuel: refreshSnapshotSurvivedFragileRowsPreSave.filter((r) => r?.book === "FanDuel").length,
    DraftKings: refreshSnapshotSurvivedFragileRowsPreSave.filter((r) => r?.book === "DraftKings").length
  },
  bestPropsRawRows: refreshSnapshotBestPropsRawRows.length,
  bestPropsRawRowsByBook: {
    FanDuel: refreshSnapshotBestPropsRawRows.filter((r) => r?.book === "FanDuel").length,
    DraftKings: refreshSnapshotBestPropsRawRows.filter((r) => r?.book === "DraftKings").length
  },
  finalBestVisibleRows: refreshSnapshotFinalBestVisibleRowsPreSave.length,
  missingStages: refreshSnapshotMissingStageNames
})
runCurrentSlateCoverageDiagnostics({
  scheduledEvents: Array.isArray(targetEvents) ? targetEvents : [],
  rawPropsRows: activeBookRawPropsRows,
  enrichedModelRows: Array.isArray(enriched) ? enriched : [],
  survivedFragileRows: refreshSnapshotSurvivedFragileRowsPreSave,
  bestPropsRawRows: refreshSnapshotBestPropsRawRows,
  finalBestVisibleRows: refreshSnapshotFinalBestVisibleRowsPreSave
})

const refreshPromotedBestProps = Array.isArray(refreshPlayableFanDuelPromotion.rows)
  ? refreshPlayableFanDuelPromotion.rows
  : []
logBestStage("refresh-snapshot:finalAssignedBestProps", oddsSnapshot.bestProps)
logPropStageByBookDebug("refresh-snapshot:finalPromotion", {
  elite: oddsSnapshot.eliteProps,
  strong: oddsSnapshot.strongProps,
  playable: oddsSnapshot.playableProps,
  best: oddsSnapshot.bestProps
})
const refreshWatchedRawApiCounts = aggregateWatchedCountsFromEventDebug(eventIngestDebug)
const refreshWatchedCoverage = buildWatchedPlayersCoverage(
  refreshWatchedRawApiCounts,
  activeBookRawPropsRows,
  oddsSnapshot.bestProps
)
oddsSnapshot.diagnostics = {
  ...(oddsSnapshot.diagnostics && typeof oddsSnapshot.diagnostics === "object" ? oddsSnapshot.diagnostics : {}),
  activeBooks: ACTIVE_BOOKS,
  scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
  coveredEventCount: coveredEvents.length,
  missingScheduledEventCount: missingScheduledEvents.length,
  watchedPlayersCoverage: refreshWatchedCoverage
}
console.log("[WATCHED-PLAYER-COVERAGE-GUARD]", {
  path: "refresh-snapshot",
  players: refreshWatchedCoverage.map((row) => ({
    player: row.player,
    rawPropsPresent: row.rawPropsPresent,
    rawPropsCount: row.rawPropsCount,
    bestPropsPresent: row.bestPropsPresent,
    bestPropsCount: row.bestPropsCount,
    missingReason: row.missingReason
  }))
})
const bestPropsPoolForMixed = oddsSnapshot.bestProps || bestProps
const bestAvailable = buildMixedBestAvailableBuckets(bestPropsPoolForMixed, {
  thinSlateMode:
    (Array.isArray(bestPropsPoolForMixed) ? bestPropsPoolForMixed.length : 0) < 140 ||
    (Number(oddsSnapshot?.snapshotSlateGameCount || 0) > 0 && Number(oddsSnapshot.snapshotSlateGameCount) <= 4)
})
oddsSnapshot.safe = bestAvailable.safe
oddsSnapshot.balanced = bestAvailable.balanced
oddsSnapshot.aggressive = bestAvailable.aggressive
oddsSnapshot.lotto = bestAvailable.lotto
console.log("[PARLAY-BUILDER-RESULT]", {
  safe: !!oddsSnapshot.safe,
  balanced: !!oddsSnapshot.balanced,
  aggressive: !!oddsSnapshot.aggressive,
  lotto: !!oddsSnapshot.lotto
})
const refreshSnapshotFinalVisibleBest = getAvailablePrimarySlateRows(oddsSnapshot.bestProps || [])
logBestStage("refresh-snapshot:afterFinalVisibilityFiltering", refreshSnapshotFinalVisibleBest)
console.log("[PRIMARY-SLATE-DISCOVERY-DEBUG]", {
  path: "refresh-snapshot",
  unrestrictedEventFetchCount: unrestrictedEventIds.length,
  unrestrictedEventIds,
  scheduledEventCount: scheduledEventIds.length,
  scheduledEventIds,
  dkScopedEventFetchCount: dkScopedEventIds.length,
  dkScopedEventIds,
  missingFromDkButInScheduled,
  mappedRawPropGameCount: getDistinctGameCount(activeBookRawPropsRows),
  playablePropGameCount: getDistinctGameCount(oddsSnapshot.playableProps),
  bestPropGameCount: getDistinctGameCount(refreshSnapshotFinalVisibleBest)
})
console.log("[BEST-PROPS-STAGE-COUNTS]", {
  path: "refresh-snapshot",
  stage: "afterFinalVisibilityFilter",
  total: refreshSnapshotFinalVisibleBest.length,
  byBook: {
    FanDuel: refreshSnapshotFinalVisibleBest.filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: refreshSnapshotFinalVisibleBest.filter((row) => String(row?.book || "") === "DraftKings").length
  }
})
console.log("[BEST-PROPS-PIPELINE-COUNTS]", {
  path: "refresh-snapshot",
  sourceCandidates: bestPropsSource.length,
  postEligibility: bestPropsCapResult?.diagnostics?.eligibleCount || 0,
  postDedupe: bestPropsCapResult?.diagnostics?.dedupedCount || 0,
  postBalancer: preCapBestPropsPool.length,
  postFinalAssignment: oddsSnapshot.bestProps.length,
  finalVisibleByBook: {
    FanDuel: getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length
  }
})
console.log("[BEST-PROPS-FINAL-DEBUG]", {
  finalBestPropsTotal: (oddsSnapshot.bestProps || []).length,
  finalFDCount: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
  finalDKCount: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length,
  first10Players: (oddsSnapshot.bestProps || []).slice(0, 10).map((row) => ({
    player: row?.player,
    book: row?.book,
    propType: row?.propType
  }))
})
console.log("[BEST-PROPS-SIZE-DEBUG]", {
  path: "refresh-snapshot",
  eligibleCount: bestPropsSource.length,
  selectedFinalCount: (oddsSnapshot.bestProps || []).length,
  byBook: {
    FanDuel: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length
  }
})
logBestPropsCapDebug("refresh-snapshot", "post-cap", bestPropsSource, bestProps, bestPropsCapResult.diagnostics)
logFunnelStage("refresh-snapshot", "oddsSnapshot.bestProps", bestProps, oddsSnapshot.bestProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.bestProps", bestProps, oddsSnapshot.bestProps)
const flexPropsSource = dedupeByLegSignature([
  ...(Array.isArray(matchupValidProps) ? matchupValidProps : []),
  ...(Array.isArray(oddsSnapshot.playableProps) ? oddsSnapshot.playableProps : []),
  ...(Array.isArray(oddsSnapshot.strongProps) ? oddsSnapshot.strongProps : []),
  ...(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])
])
oddsSnapshot.flexProps = []
oddsSnapshot.parlays = null
oddsSnapshot.dualParlays = null
console.log("[REFRESH-CORE-ONLY]", {
  raw: oddsSnapshot.props.length,
  best: oddsSnapshot.bestProps.length
})
const playableFilterCounts = buildSequentialFilterDropCounts(scoredProps, [
  { key: "playableHighMinutesRisk", predicate: (row) => getMinutesRisk(row) !== "high" },
  { key: "playableHighInjuryRisk", predicate: (row) => getInjuryRisk(row) !== "high" },
  { key: "playableSubfloorHitRate", predicate: (row) => parseHitRate(row.hitRate) >= 0.5 },
  { key: "playableThinEdgeAndScore", predicate: (row) => !(getTierEdge(row) < -0.75 && getTierScore(row) < 34) },
  { key: "playableMissedPromotionGate", predicate: qualifiesPlayableTier }
])
const bestFilterCounts = buildSequentialFilterDropCounts(scoredProps, [
  { key: "bestHighMinutesRisk", predicate: (row) => getMinutesRisk(row) !== "high" },
  { key: "bestHighInjuryRisk", predicate: (row) => getInjuryRisk(row) !== "high" },
  { key: "bestSubfloorHitRate", predicate: (row) => parseHitRate(row.hitRate) >= 0.48 },
  { key: "bestThinEdgeAndScore", predicate: (row) => !(getTierEdge(row) < -0.75 && getTierScore(row) < 32) },
  { key: "bestMissedPromotionGate", predicate: qualifiesBestPropsSource }
])
logTierAssignmentDebug(
  "refresh-snapshot",
  scoredProps,
  {
    eliteRows: oddsSnapshot.eliteProps,
    strongRows: oddsSnapshot.strongProps,
    playableRows: oddsSnapshot.playableProps,
    bestSourceRows: bestPropsSource,
    preCapBestRows: bestProps,
    bestRows: oddsSnapshot.bestProps,
    flexRows: oddsSnapshot.flexProps
  },
  {
    ...playableFilterCounts.droppedByFilter,
    ...bestFilterCounts.droppedByFilter,
    bestPoolSelectionDrop: Math.max(0, bestPropsSource.length - bestProps.length),
    bestPoolTotalCapDrop: bestPropsCapResult.diagnostics.dropCounts.totalCap,
    bestPoolPerBookBalancingDrop: bestPropsCapResult.diagnostics.dropCounts.perBookBalancing,
    bestPoolPerPlayerCapDrop: bestPropsCapResult.diagnostics.dropCounts.perPlayerCap,
    bestPoolPerMatchupCapDrop: bestPropsCapResult.diagnostics.dropCounts.perMatchupCap,
    bestPoolPerStatCapDrop: bestPropsCapResult.diagnostics.dropCounts.perStatCap,
    bestPostMatchupFilterDrop: Math.max(0, bestProps.length - oddsSnapshot.bestProps.length),
    flexPoolCount: oddsSnapshot.flexProps.length
  }
)
try {
  fs.writeFileSync(
    path.join(__dirname, "snapshot.json"),
    JSON.stringify({
      data: oddsSnapshot,
      savedAt: Date.now()
    })
  )
  console.log("[SNAPSHOT-CACHE] saved snapshot to disk")
} catch (e) {
  console.log("[SNAPSHOT-CACHE] failed to save snapshot", e.message)
}
console.log("[TOP-PROP-SAMPLE] bestProps count:", (oddsSnapshot.bestProps || []).length)
logTopPropSample("refresh-snapshot bestProps", oddsSnapshot.bestProps)
  debugPipelineStages.afterBestProps = summarizePropPipelineRows(oddsSnapshot.bestProps)
logPropPipelineStep("refresh-snapshot", "after-bestProps-assignment", oddsSnapshot.bestProps)
logFunnelDropSummary("refresh-snapshot", debugPipelineStages)
console.log("[BEST-PROPS-DEBUG] total bestProps:", oddsSnapshot.bestProps.length)
console.log("[FLEX-PROPS-DEBUG] total flexProps:", (oddsSnapshot.flexProps || []).length)
console.log(
  "[BEST-PROPS-DEBUG] bestProps by propType:",
  oddsSnapshot.bestProps.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
)
console.log(
  "[BEST-PROPS-DEBUG] bestProps by book:",
  oddsSnapshot.bestProps.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
)
lastSnapshotRefreshAt = Date.now()

    const refreshMeta = buildSnapshotMeta({ source: "refresh-live" })

	    console.log("[SNAPSHOT-REFRESH-SUCCESS]", {
	      updatedAt: oddsSnapshot?.updatedAt || null,
	      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
	      props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
	      bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
	      playableProps: Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps.length : 0,
	      strongProps: Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps.length : 0,
	      eliteProps: Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps.length : 0
	    })
	    const marketCoverageFocusDebug = aggregateMarketCoverageFocusDebug(eventIngestDebug)
	    lastMarketCoverageFocusDebug = marketCoverageFocusDebug

	    return res.json({
	      ok: true,
	      message: "Snapshot refreshed successfully",
	      snapshotMeta: refreshMeta,
        snapshotGeneratedAt: refreshMeta?.snapshotGeneratedAt || null,
        snapshotSlateDateLocal: refreshMeta?.snapshotSlateDateLocal || null,
	      marketCoverageFocusDebug,
	      snapshotSlateDateKey: oddsSnapshot.snapshotSlateDateKey || null,
	      snapshotSlateGameCount: oddsSnapshot.snapshotSlateGameCount || 0,
        slateStateValidator: oddsSnapshot?.slateStateValidator || null,
        lineHistorySummary: oddsSnapshot?.lineHistorySummary || null,
	      counts: {
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
        playableProps: Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps.length : 0,
        strongProps: Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps.length : 0,
        eliteProps: Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps.length : 0
      }
    })
  } catch (error) {
    const readableError =
      error?.stack ||
      error?.message ||
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      (typeof error?.response?.data === "string" ? error.response.data : "") ||
      (typeof error === "string" ? error : "") ||
      JSON.stringify(error, Object.getOwnPropertyNames(error || {}))

    console.error("[SNAPSHOT-REFRESH-ERROR]", {
      message: error?.message || null,
      stack: error?.stack || null,
      name: error?.name || null,
      code: error?.code || null,
      responseStatus: error?.response?.status || null,
      responseData: error?.response?.data || null,
      readableError
    })

    res.status(500).send(`Snapshot refresh failed (${readableError})`)
  }
})

app.get("/refresh-snapshot/hard-reset", async (req, res) => {
  console.log("[SNAPSHOT-DEBUG] START refresh-snapshot-hard-reset")
  try {
    resetFragileFilterAdjustedLogCount()
    const replayModeRequested = isNbaOddsReplayRequest(req)
    if (replayModeRequested) {
      return sendNbaReplayRefreshResponse(res, {
        routeTag: "refresh-snapshot-hard-reset",
        logTag: "[SLATE-SELECTION-DEBUG-REPLAY-MODE-HARD-RESET]"
      })
    }

    const previousSnapshotForCarry = {
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? [...oddsSnapshot.rawProps] : [],
      props: Array.isArray(oddsSnapshot?.props) ? [...oddsSnapshot.props] : []
    }
    // Hard reset: clear all snapshot state and caches
    oddsSnapshot = {
      updatedAt: null,
      events: [],
      rawProps: [],
      props: [],
      eliteProps: [],
      strongProps: [],
      playableProps: [],
      bestProps: [],
      diagnostics: {},
      flexProps: [],
      parlays: null,
      dualParlays: null
    }
    lastSnapshotRefreshAt = 0

    // Clear in-memory caches
    playerIdCache.clear()
    playerStatsCache.clear()
    playerStatsCacheTimes.clear()
    playerLookupMissCache.clear()

    // Optionally delete api-sports-cache.json if it exists
    try {
      if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE)
      }
    } catch (cacheError) {
      console.warn("Failed to delete cache file:", cacheError.message)
    }

    // Now rebuild snapshot from scratch (same logic as force refresh)
    if (!ensureNbaRefreshEnvConfigured(res)) {
      return
    }

    const {
      allEvents,
      scheduledEvents
    } = await fetchNbaUnrestrictedSlateEvents()
    let dkScopedFetchedEvents = null
    if (ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH) {
      try {
        dkScopedFetchedEvents = await fetchDkScopedEventsForDebug(ODDS_API_KEY)
      } catch (err) {
        console.log("[DK-SCOPED-DEBUG-SKIPPED]", {
          message: err?.message || String(err || "")
        })
        dkScopedFetchedEvents = null
      }
    } else {
      console.log("[DK-SCOPED-EVENTS-DEBUG-SKIPPED] disabled by ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH=false")
    }
    const {
      scheduledEvents: dkScopedScheduledEvents
    } = dkScopedFetchedEvents != null ? await buildSlateEvents({
      oddsApiKey: ODDS_API_KEY,
      now: Date.now(),
      events: dkScopedFetchedEvents
    }) : { scheduledEvents: [] }

    const unrestrictedEventIds = [...new Set((Array.isArray(allEvents) ? allEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const scheduledEventIds = [...new Set((Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const dkScopedEventIds = [...new Set((Array.isArray(dkScopedScheduledEvents) ? dkScopedScheduledEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const rawApiEventIds = dkScopedEventIds
    const missingFromDkButInScheduled = scheduledEventIds.filter((eventId) => !dkScopedEventIds.includes(eventId))
    if (!scheduledEvents.length) {
      return res.status(404).json({
        error: "No upcoming NBA games found for the primary slate"
      })
    }

    const primarySlateDateLocal = scheduledEvents[0]
      ? new Date(getEventTimeForDebug(scheduledEvents[0])).toLocaleDateString("en-US", {
          timeZone: "America/Detroit"
        })
      : null
    console.log("[EVENT-FETCH-INTEGRITY-DEBUG]", {
      unrestrictedEventFetchCount: unrestrictedEventIds.length,
      unrestrictedEventIds,
      scheduledEventCount: scheduledEvents.length,
      scheduledEventIds,
      dkScopedEventFetchCount: dkScopedEventIds.length,
      dkScopedEventIds,
      missingFromDkButInScheduled
    })
    console.log("[EVENT-FETCH-MATCHUP-INTEGRITY-DEBUG]", {
      scheduledMatchups: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => getEventMatchupForDebug(event)),
      dkScopedMatchups: (Array.isArray(dkScopedScheduledEvents) ? dkScopedScheduledEvents : []).map((event) => getEventMatchupForDebug(event)),
      missingScheduledMatchupsFromDk: (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .filter((event) => missingFromDkButInScheduled.includes(getEventIdForDebug(event)))
        .map((event) => getEventMatchupForDebug(event))
    })
    console.log("[RAW-PROPS-PIPELINE-START]", {
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      eventIds: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => String(event?.id || event?.eventId || "")).filter(Boolean),
      matchups: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => {
        const away = event?.away_team || event?.awayTeam || ""
        const home = event?.home_team || event?.homeTeam || ""
        return away && home ? `${away} @ ${home}` : String(event?.matchup || "")
      }).filter(Boolean)
    })
    let cleaned = []
    const eventIngestDebug = []
    const previousOpenMap = new Map(
      (oddsSnapshot.props || []).map((row) => {
        const key = [row.eventId, row.player, row.propType, row.side, row.book].join("|")
        return [
          key,
          {
            openingLine: Number.isFinite(Number(row.openingLine)) ? Number(row.openingLine) : Number(row.line),
            openingOdds: Number.isFinite(Number(row.openingOdds)) ? Number(row.openingOdds) : Number(row.odds)
          }
        ]
      })
    )
    const dkRequestedMarkets = ALL_DK_MARKETS
    const scheduledEventRecords = (Array.isArray(scheduledEvents) ? scheduledEvents : [])
      .map((event) => ({
        eventId: String(event?.eventId || event?.id || ""),
        matchup: String(event?.matchup || getEventMatchupForDebug(event) || ""),
        gameTime: event?.gameTime || event?.commence_time || event?.startTime || null
      }))
      .filter((event) => event.eventId)
    const scheduledEventMap = new Map(
      (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .map((event) => [String(event?.eventId || event?.id || ""), event])
        .filter(([eventId]) => Boolean(eventId))
    )
    const settledEventAttempts = await Promise.allSettled(
      scheduledEventRecords.map(async (scheduledRecord) => {
        const sourceEvent = scheduledEventMap.get(scheduledRecord.eventId)
        if (!sourceEvent) {
          return {
            eventId: scheduledRecord.eventId,
            matchup: scheduledRecord.matchup,
            ok: false,
            empty: false,
            errorMessage: "scheduled_event_not_found",
            responseBookmakersCount: 0,
            responseMarketsCount: 0,
            normalizedRowsCount: 0,
            normalizedRows: [],
            responseReceived: false,
            requestedMarkets: dkRequestedMarkets,
            _allRows: [],
            _fetchDebug: {}
          }
        }

        const fetched = await fetchEventPlayerPropsWithCoverage(sourceEvent, previousOpenMap, {
          pathLabel: "refresh-snapshot-hard-reset"
        })
        const allRows = Array.isArray(fetched?.rows) ? [...fetched.rows] : []
        if (Boolean(fetched?.extraMarketsFetchSucceeded)) {
          allRows.push(...(Array.isArray(fetched?.extraRawRows) ? fetched.extraRawRows : []))
        }
        const fetchDebug = fetched?.debug || {}
        const normalizedRows = allRows.filter((row) => isActiveBook(row?.book))
        const responseBookmakersCount = Number(fetchDebug?.dkBookmakerEntries || 0)
        const responseMarketsCount = Number(fetchDebug?.dkMarketEntries || 0)
        const normalizedRowsCount = normalizedRows.length
        const empty = responseBookmakersCount === 0 || responseMarketsCount === 0 || normalizedRowsCount === 0

        return {
          eventId: scheduledRecord.eventId,
          matchup: scheduledRecord.matchup,
          ok: true,
          empty,
          errorMessage: null,
          responseBookmakersCount,
          responseMarketsCount,
          normalizedRowsCount,
          normalizedRows,
          responseReceived: true,
          requestedMarkets: Array.isArray(fetchDebug?.requestedMarkets) && fetchDebug.requestedMarkets.length
            ? fetchDebug.requestedMarkets
            : dkRequestedMarkets,
          _allRows: allRows,
          _fetchDebug: fetchDebug
        }
      })
    )
    const eventResults = settledEventAttempts.map((settled, index) => {
      const scheduledRecord = scheduledEventRecords[index] || { eventId: "", matchup: "" }
      if (settled.status === "fulfilled") {
        return settled.value
      }
      const reason = settled.reason || {}
      return {
        eventId: scheduledRecord.eventId,
        matchup: scheduledRecord.matchup,
        ok: false,
        empty: false,
        errorMessage: String(reason?.response?.data?.message || reason?.response?.data?.error || reason?.message || reason || "unknown_error"),
        responseBookmakersCount: 0,
        responseMarketsCount: 0,
        normalizedRowsCount: 0,
        normalizedRows: [],
        responseReceived: Boolean(reason?.response || reason?.__dkFetchMeta?.responseReceived),
        requestedMarkets: Array.isArray(reason?.__dkFetchMeta?.requestedMarkets) && reason.__dkFetchMeta.requestedMarkets.length
          ? reason.__dkFetchMeta.requestedMarkets
          : dkRequestedMarkets,
        _allRows: [],
        _fetchDebug: {}
      }
    })
    console.log("[DK-EVENT-ATTEMPT-SUMMARY]", {
      scheduledEventCount: scheduledEventRecords.length,
      attemptedEventCount: eventResults.length,
      successCount: eventResults.filter((result) => result.ok).length,
      emptyCount: eventResults.filter((result) => result.ok && result.empty).length,
      errorCount: eventResults.filter((result) => !result.ok).length,
      rowBackedEventCount: eventResults.filter((result) => (result.normalizedRowsCount || 0) > 0).length,
      missingEventAttempts: scheduledEventRecords
        .filter((scheduledRecord) => !eventResults.some((result) => result.eventId === scheduledRecord.eventId))
        .map((scheduledRecord) => ({ eventId: scheduledRecord.eventId, matchup: scheduledRecord.matchup }))
    })
    console.log("[DK-EVENT-ATTEMPT-DETAILS]", eventResults.map((result) => ({
      eventId: result.eventId,
      matchup: result.matchup,
      ok: result.ok,
      empty: result.empty,
      errorMessage: result.errorMessage,
      responseBookmakersCount: result.responseBookmakersCount,
      responseMarketsCount: result.responseMarketsCount,
      normalizedRowsCount: result.normalizedRowsCount
    })))
    for (const eventResult of eventResults) {
      if (eventResult.ok && (eventResult.normalizedRowsCount || 0) > 0) {
        console.log("[DK-EVENT-FETCH-SUCCESS]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      } else if (eventResult.ok) {
        console.log("[DK-EVENT-FETCH-EMPTY]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      } else {
        console.log("[DK-EVENT-FETCH-ERROR]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      }
    }
    const rawDraftKingsRows = eventResults.flatMap((result) =>
      Array.isArray(result.normalizedRows) ? result.normalizedRows : []
    )
    cleaned = dedupeByLegSignature(rawDraftKingsRows)
    for (const eventResult of eventResults) {
      const allRows = Array.isArray(eventResult?._allRows) ? eventResult._allRows : []
      const fetchDebug = eventResult?._fetchDebug || {}
      eventIngestDebug.push({
        ...fetchDebug,
        path: "refresh-snapshot-hard-reset",
        eventId: eventResult.eventId,
        matchup: eventResult.matchup,
        requestedMarkets: eventResult.requestedMarkets,
        responseReceived: eventResult.responseReceived,
        dkRequestSucceeded: eventResult.ok,
        dkBookmakerEntries: eventResult.responseBookmakersCount,
        dkMarketEntries: eventResult.responseMarketsCount,
        dkNormalizedRowsProduced: eventResult.normalizedRowsCount,
        normalizedRowsProduced: allRows.length,
        dkFetchError: !eventResult.ok,
        error: eventResult.errorMessage,
        finalAcceptedRows: allRows.length
      })
    }
    const dkAttemptedEventIdSet = new Set(eventResults.map((result) => String(result?.eventId || "")).filter(Boolean))
    const dkRowBackedEventIdSetFromAttempts = new Set(
      eventResults
        .filter((result) => Number(result?.normalizedRowsCount || 0) > 0)
        .map((result) => String(result?.eventId || ""))
        .filter(Boolean)
    )
    console.log("[DK-ATTEMPT-VS-ROW-COVERAGE]", {
      scheduledEventCount: scheduledEventRecords.length,
      attemptedEventCount: dkAttemptedEventIdSet.size,
      rowBackedEventCount: dkRowBackedEventIdSetFromAttempts.size,
      attemptedWithoutRows: eventResults
        .filter((result) => result.ok && (result.normalizedRowsCount || 0) === 0)
        .map((result) => ({ eventId: result.eventId, matchup: result.matchup })),
      failedAttempts: eventResults
        .filter((result) => !result.ok)
        .map((result) => ({ eventId: result.eventId, matchup: result.matchup, errorMessage: result.errorMessage }))
    })

    const previousRowsForCarry = dedupeByLegSignature([
      ...(Array.isArray(previousSnapshotForCarry?.rawProps) ? previousSnapshotForCarry.rawProps : []),
      ...(Array.isArray(previousSnapshotForCarry?.props) ? previousSnapshotForCarry.props : [])
    ])
    const preCarryEventIds = [...new Set(cleaned.map((row) => String(row?.eventId || "")).filter(Boolean))]
    const slateDateKey = scheduledEvents[0] ? getLocalSlateDateKey(getEventTimeForDebug(scheduledEvents[0])) : ""
    const unstableMissingBeforeCarry = UNSTABLE_GAME_EVENT_IDS.filter((eventId) => {
      return scheduledEventIds.includes(eventId) && !preCarryEventIds.includes(eventId)
    })
    const carryForwardRows = previousRowsForCarry
      .filter((row) => unstableMissingBeforeCarry.includes(String(row?.eventId || "")))
      .filter((row) => {
        if (!slateDateKey) return true
        try {
          return getLocalSlateDateKey(row?.gameTime) === slateDateKey
        } catch (_) {
          return false
        }
      })
      .filter((row) => {
        try {
          return isPregameEligibleRow(row)
        } catch (_) {
          return false
        }
      })
      .map((row) => ({ ...row, staleCarryForward: true }))

    if (carryForwardRows.length > 0) cleaned.push(...carryForwardRows)

    console.log("[UNSTABLE-GAME-CARRY-FORWARD-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      events: UNSTABLE_GAME_EVENT_IDS.map((eventId) => ({
        eventId,
        carriedRows: carryForwardRows.filter((row) => String(row?.eventId || "") === eventId).length
      }))
    })

    let rawIngestedProps = dedupeByLegSignature(cleaned)
    let rawPropsRows = rawIngestedProps

    const normalizeEventRowsFromPayload = (eventPayload, event) => {
      const matchup = buildMatchup(event?.away_team, event?.home_team)
      const rows = []
      const books = Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []

      for (const book of books) {
        const markets = Array.isArray(book?.markets) ? book.markets : (Array.isArray(book?.props) ? book.props : [])

        for (const market of markets) {
          const marketKey = String(market?.key || market?.name || "").trim()
          const inferredMarket = inferMarketTypeFromKey(marketKey)
          const propType = normalizePropType(marketKey)
          let normalizedPropType = propType || inferredMarket.internalType || null
          const inferredFamily = inferredMarket.family
          const shouldKeep = Boolean(
            normalizedPropType ||
            inferredFamily === "standard" ||
            inferredFamily === "ladder" ||
            inferredFamily === "special"
          )

          if (!shouldKeep) continue

          const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : (Array.isArray(market?.selections) ? market.selections : [])

          for (const outcome of outcomes) {
            const eventId = String(
              event?.id ||
              event?.eventId ||
              market?.eventId ||
              book?.eventId ||
              ""
            ).trim()
            const sideRaw = String(outcome?.name || outcome?.label || outcome?.side || "").trim()
            const rawDescription = String(outcome?.description || "").trim()
            let side = sideRaw === "over" || sideRaw === "Over" ? "Over" : (sideRaw === "under" || sideRaw === "Under" ? "Under" : sideRaw)

            // For special/ladder markets, normalize Yes/No and treat player-name sides as "Yes"
            if (inferredFamily === "special" || inferredFamily === "ladder") {
              const sideLower = side.toLowerCase()
              if (sideLower === "yes") side = "Yes"
              else if (sideLower === "no") side = "No"
              else if (side !== "Over" && side !== "Under") side = "Yes"
            }

            let player = rawDescription || String(outcome?.participant || "").trim() || String(outcome?.player || "").trim()
            player = String(player || "").trim()

            const bookName = String(book?.title || book?.key || book?.name || "").trim()
            const currentLine = Number(outcome?.point ?? outcome?.line ?? outcome?.handicap ?? outcome?.total)
            const currentOdds = Number(outcome?.price ?? outcome?.odds ?? outcome?.american_odds)

            const draftRow = {
              eventId,
              matchup,
              awayTeam: event?.away_team || event?.awayTeam || event?.teams?.[0] || "",
              homeTeam: event?.home_team || event?.homeTeam || event?.teams?.[1] || "",
              gameTime: getEventTimeForDebug(event) || "",
              book: bookName,
              marketKey,
              marketFamily: inferredFamily,
              propType: normalizedPropType,
              player,
              side,
              playerStatus: getManualPlayerStatus(player),
              line: currentLine,
              odds: currentOdds,
              openingLine: currentLine,
              openingOdds: currentOdds,
              lineMove: 0,
              oddsMove: 0,
              marketMovementTag: "neutral"
            }

            const rejectReason = getIngestRejectReason(draftRow)
            if (rejectReason) continue

            rows.push(draftRow)
          }
        }
      }

      return rows
    }

    let extraRawRows = []
    if (ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH) {
      extraRawRows = await buildExtraMarketRowsForEvents({
        scheduledEvents,
        oddsApiKey: ODDS_API_KEY,
        normalizeEventRows: normalizeEventRowsFromPayload
      })
    } else {
      console.log("[DK-EXTRA-MARKETS-REFETCH-SKIPPED] disabled by ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH=false")
    }

    rawPropsRows = dedupeMarketRows([
      ...(Array.isArray(rawPropsRows) ? rawPropsRows : []),
      ...(Array.isArray(extraRawRows) ? extraRawRows : [])
    ])
    const scheduledEventIdSet = new Set(
      (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .map((event) => String(event?.eventId || event?.id || ""))
        .filter(Boolean)
    )
    const rawDraftKingsEventIdSet = new Set(
      (Array.isArray(rawPropsRows) ? rawPropsRows : [])
        .filter((row) => String(row?.book || "") === "DraftKings")
        .map((row) => String(row?.eventId || ""))
        .filter(Boolean)
    )
    const missingDraftKingsEventIds = [...scheduledEventIdSet].filter((id) => !rawDraftKingsEventIdSet.has(id))
    console.log("[DK-RAW-COVERAGE-DEBUG]", {
      scheduledEventCount: scheduledEventIdSet.size,
      rawDraftKingsEventCount: rawDraftKingsEventIdSet.size,
      missingDraftKingsEventIds
    })
    console.log("[DK-RAW-COVERAGE-MATCHUPS]", {
      missingMatchups: (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .filter((event) => !rawDraftKingsEventIdSet.has(String(event?.eventId || event?.id || "")))
        .map((event) => ({
          eventId: String(event?.eventId || event?.id || ""),
          matchup: String(event?.matchup || getEventMatchupForDebug(event) || ""),
          gameTime: event?.gameTime || event?.commence_time || event?.startTime || null
        }))
    })
    const dkAttemptedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkFetchedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => item?.dkRequestSucceeded === true)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkRowBackedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => Number(item?.dkNormalizedRowsProduced || 0) > 0)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkErroredEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => item?.dkFetchError === true)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    console.log("[DK-EVENT-FETCH-VS-ROWS]", {
      dkFetchedEventCount: dkFetchedEventIds.size,
      dkRowBackedEventCount: dkRowBackedEventIds.size,
      fetchedWithoutRows: [...dkFetchedEventIds].filter((id) => !dkRowBackedEventIds.has(id)),
      dkErroredEventIds: [...dkErroredEventIds],
      neverAttemptedEventIds: [...scheduledEventIdSet].filter((id) => !dkAttemptedEventIds.has(id))
    })

    console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", summarizeInterestingNormalizedRows(rawPropsRows || []))
    const activeBookRawPropsRows = (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => isActiveBook(row?.book))
    console.log("[ACTIVE-BOOK-FILTER-DEBUG]", {
      activeBooks: ACTIVE_BOOKS,
      before: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      after: activeBookRawPropsRows.length,
      byBook: activeBookRawPropsRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    const coveredEventIds = new Set(
      (Array.isArray(rawPropsRows) ? rawPropsRows : [])
        .map((row) => String(row?.eventId || ""))
        .filter(Boolean)
    )

    const coveredEvents = (Array.isArray(scheduledEvents) ? scheduledEvents : []).filter((event) => {
      const eventId = getEventIdForDebug(event)
      return eventId && coveredEventIds.has(eventId)
    })

    const missingScheduledEvents = (Array.isArray(scheduledEvents) ? scheduledEvents : []).filter((event) => {
      const eventId = getEventIdForDebug(event)
      return !eventId || !coveredEventIds.has(eventId)
    })

    console.log("[EVENT-COVERAGE-SNAPSHOT-DEBUG]", {
      scheduledCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      coveredCount: coveredEvents.length,
      missingCount: missingScheduledEvents.length,
      coveredMatchups: coveredEvents.map((event) => getEventMatchupForDebug(event)),
      missingMatchups: missingScheduledEvents.map((event) => getEventMatchupForDebug(event))
    })
    console.log("[RAW-PROPS-EVENT-COVERAGE-DEBUG]", {
      totalRows: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      byBook: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byEventId: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "")
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    console.log("[RAW-PROPS-PIPELINE-END]", {
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      totalRawRowsBuilt: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      byBook: {
        FanDuel: (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => row?.book === "FanDuel").length,
        DraftKings: (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => row?.book === "DraftKings").length
      },
      byEventId: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "")
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    if (scheduledEvents.length > 0 && rawPropsRows.length === 0) {
      console.log("[RAW-PROPS-ZERO-ROWS-DEBUG]", {
        scheduledEvents: scheduledEvents.map((event) => ({
          eventId: String(event?.id || event?.eventId || ""),
          matchup: (() => {
            const away = event?.away_team || event?.awayTeam || ""
            const home = event?.home_team || event?.homeTeam || ""
            return away && home ? `${away} @ ${home}` : String(event?.matchup || "")
          })()
        }))
      })
    }
    const ingestedEventIds = [...new Set(rawPropsRows.map((row) => String(row?.eventId || "")).filter(Boolean))]
    const missingEventIds = scheduledEventIds.filter((eventId) => !ingestedEventIds.includes(eventId))
    const propsPerEventId = Object.fromEntries(
      scheduledEventIds.map((eventId) => [
        eventId,
        rawPropsRows.filter((row) => String(row?.eventId || "") === eventId).length
      ])
    )

    const ingestApiEventIds = [...new Set(
      eventIngestDebug.flatMap((item) => [
        ...(Array.isArray(item?.apiEventIdsPrimary) ? item.apiEventIdsPrimary : []),
        ...(Array.isArray(item?.apiEventIdsFallback) ? item.apiEventIdsFallback : [])
      ].map((id) => String(id || "")).filter(Boolean))
    )]
    const targetMissingEventStages = UNSTABLE_GAME_EVENT_IDS.map((id) => ({
      eventId: id,
      inScheduledEvents: scheduledEventIds.includes(id),
      inRawApiResponse: rawApiEventIds.includes(id) || ingestApiEventIds.includes(id),
      inMappedRawProps: ingestedEventIds.includes(id),
      inFinalSavedRawProps: false,
      inFinalSavedProps: false,
      mappedRows: rawPropsRows.filter((row) => String(row?.eventId || "") === id).length
    }))

    console.log("[TARGET-MISSING-GAME-INGEST-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      targets: targetMissingEventStages
    })

    const normalizeIngestPlayer = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
    const lukaRawApiCount = eventIngestDebug.reduce((sum, item) => {
      return sum + Number(item?.lukaRawPrimaryCount || 0) + Number(item?.lukaRawFallbackCount || 0)
    }, 0)
    const lukaMappedCount = rawPropsRows.filter((row) => normalizeIngestPlayer(row?.player).includes("doncic")).length

    console.log("[INGEST-LUKA-STAGE-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      inRawApiResponse: lukaRawApiCount > 0,
      rawApiCount: lukaRawApiCount,
      inMappedRawProps: lukaMappedCount > 0,
      mappedCount: lukaMappedCount
    })

    const debugPipelineStages = {}
    debugPipelineStages.rawNormalized = summarizePropPipelineRows(activeBookRawPropsRows)
    logPropPipelineStep("refresh-snapshot-hard-reset", "raw-normalized-props", activeBookRawPropsRows)
    const pregameStatusRowsForDebug = activeBookRawPropsRows.filter((row) => isPregameEligibleRow(row))
    debugPipelineStages.afterPregameStatus = summarizePropPipelineRows(pregameStatusRowsForDebug)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-pregame-status-filtering", pregameStatusRowsForDebug)
    const primarySlateRowsForDebug = filterRowsToPrimarySlate(pregameStatusRowsForDebug)
    debugPipelineStages.afterPrimarySlate = summarizePropPipelineRows(primarySlateRowsForDebug)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-primary-slate-filtering", primarySlateRowsForDebug)

    const playerRows = new Map()
    for (const row of activeBookRawPropsRows) {
      if (!row.player) continue
      if (!playerRows.has(row.player)) playerRows.set(row.player, row)
    }

    const statsCache = new Map()
    const playerTeamMap = new Map()
    const players = Array.from(playerRows.keys())
    const playerResolutionDebug = {
      totalRawPlayerNamesSeen: players.length,
      totalPlayerNamesWithResolvedIds: 0,
      unresolvedPlayerNames: [],
      manualOverrideHitCount: 0,
      looseMatchHitCount: 0,
      missCacheHitCount: 0
    }

    for (let i = 0; i < players.length; i += PLAYER_LOOKUP_CONCURRENCY) {
      const batch = players.slice(i, i + PLAYER_LOOKUP_CONCURRENCY)

      await Promise.all(
        batch.map(async (player) => {
          try {
            if (isManualOverridePlayer(player)) {
              playerResolutionDebug.manualOverrideHitCount += 1
            }

            const sourceRow = playerRows.get(player)
            const expectedTeamCodes = sourceRow
              ? [teamAbbr(sourceRow.awayTeam), teamAbbr(sourceRow.homeTeam)]
              : []

            const cachedPlayerInfo = playerIdCache.get(player)
            if (cachedPlayerInfo?.id && playerStatsCache.has(cachedPlayerInfo.id)) {
              const cachedStats = playerStatsCache.get(cachedPlayerInfo.id) || []
              const recentStats = cachedStats.slice(0, 10)

              const derivedTeamCode = String(
                getTeamOverride(player) ||
                teamAbbr(cachedPlayerInfo.team) ||
                getCurrentTeamCodeFromStats(recentStats) ||
                ""
              ).toUpperCase().trim()

              const expectedSet = new Set(
                expectedTeamCodes
                  .map((code) => String(code || "").toUpperCase().trim())
                  .filter(Boolean)
              )

              if (!expectedSet.size || !derivedTeamCode || expectedSet.has(derivedTeamCode)) {
                statsCache.set(player, recentStats)
                playerTeamMap.set(player, derivedTeamCode)
                playerResolutionDebug.totalPlayerNamesWithResolvedIds += 1
                if (isLooseResolvedMatch(player, cachedPlayerInfo.matchedName || "")) {
                  playerResolutionDebug.looseMatchHitCount += 1
                }
                return
              }

              playerIdCache.delete(player)
            }

            if (playerLookupMissCache.has(player)) {
              playerResolutionDebug.missCacheHitCount += 1
            }

            const playerInfo = await fetchApiSportsPlayerIdCached(player, expectedTeamCodes)
            if (!playerInfo || !playerInfo.id) return

            playerResolutionDebug.totalPlayerNamesWithResolvedIds += 1
            if (isLooseResolvedMatch(player, playerInfo.matchedName || "")) {
              playerResolutionDebug.looseMatchHitCount += 1
            }

            const stats = await fetchApiSportsPlayerStatsCached(playerInfo.id)
            const recentStats = stats.slice(0, 10)
            statsCache.set(player, recentStats)
            playerTeamMap.set(player, playerInfo.team)
          } catch (playerError) {
            playerResolutionDebug.unresolvedPlayerNames.push(player)
            console.error("Player lookup failed:", player, playerError.message)
          }
        })
      )
    }

    for (const player of players) {
      if (!playerTeamMap.has(player)) {
        playerResolutionDebug.unresolvedPlayerNames.push(player)
      }
    }

    const uniqueUnresolved = Array.from(new Set(playerResolutionDebug.unresolvedPlayerNames))
    logPlayerResolutionDiagnostics("refresh-snapshot-hard-reset", {
      totalRawPlayerNamesSeen: playerResolutionDebug.totalRawPlayerNamesSeen,
      totalPlayerNamesWithResolvedIds: playerResolutionDebug.totalPlayerNamesWithResolvedIds,
      totalUnresolvedPlayerNames: uniqueUnresolved.length,
      sampleUnresolvedPlayerNames: uniqueUnresolved.slice(0, 20),
      manualOverrideHitCount: playerResolutionDebug.manualOverrideHitCount,
      looseMatchHitCount: playerResolutionDebug.looseMatchHitCount,
      missCacheHitCount: playerResolutionDebug.missCacheHitCount
    })

    const matchupValidProps = activeBookRawPropsRows.filter((row) => {
      const teamCode = playerTeamMap.get(row.player)
      return teamCode && [teamAbbr(row.awayTeam), teamAbbr(row.homeTeam)].includes(teamCode)
    })

    const allBadTeamAssignmentRows = (Array.isArray(matchupValidProps) ? matchupValidProps : []).filter((row) => !rowTeamMatchesMatchup(row))
    const badTeamAssignmentRows = getBadTeamAssignmentRows(matchupValidProps, 25)
    console.log("[BAD-TEAM-ASSIGNMENT-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      count: allBadTeamAssignmentRows.length,
      byBook: {
        FanDuel: allBadTeamAssignmentRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: allBadTeamAssignmentRows.filter((r) => r?.book === "DraftKings").length
      },
      sample: badTeamAssignmentRows
    })

    const scoredPropsBase = matchupValidProps.map((row) => ({
      ...row,
      score: scorePropRow(row),
      dvpScore: scorePropRowForDvp(row),
      avgMin: getPlayerAvgMin(row.player, statsCache.get(row.player) || []),
      minFloor: getPlayerMinFloor(row.player, statsCache.get(row.player) || []),
      minStd: getPlayerMinStd(row.player, statsCache.get(row.player) || []),
      valueStd: getPlayerValueStd(row.player, statsCache.get(row.player) || [], row.propType),
      recent3Avg: getPlayerRecentAvg(row.player, statsCache.get(row.player) || [], 3, row.propType),
      recent5Avg: getPlayerRecentAvg(row.player, statsCache.get(row.player) || [], 5, row.propType),
      l10Avg: getPlayerRecentAvg(row.player, statsCache.get(row.player) || [], 10, row.propType),
      minutesRisk: getPlayerMinutesRisk(row.player, statsCache.get(row.player) || []),
      trendRisk: getPlayerTrendRisk(row.player, statsCache.get(row.player) || [], row.propType),
      injuryRisk: getPlayerInjuryRisk(row.player, statsCache.get(row.player) || []),
      hitRate: getPlayerHitRate(row.player, statsCache.get(row.player) || [], row.propType, row.line, row.side),
      edge: getPlayerEdge(row.player, statsCache.get(row.player) || [], row.propType, row.line, row.side, row.odds)
    }))
    const scoredProps = scoredPropsBase.map((row) => {
      const edgeProfile = {
        gameEnvironmentScore: inferGameEnvironmentScore(row),
        matchupEdgeScore: inferMatchupEdgeScore(row),
        bookValueScore: inferBookValueScore(row),
        volatilityScore: inferVolatilityScore(row)
      }
      const betTypeFit = inferBetTypeFit(row, edgeProfile)
      const evidence = buildEvidence(row)
      const whyItRates = buildDataDrivenWhyItRates(row)
      const modelSummary = buildModelSummary(row, evidence, whyItRates)
      const edgeRow = {
        ...row,
        gameEnvironmentScore: edgeProfile.gameEnvironmentScore,
        matchupEdgeScore: edgeProfile.matchupEdgeScore,
        bookValueScore: edgeProfile.bookValueScore,
        volatilityScore: edgeProfile.volatilityScore,
        betTypeFit,
        edgeProfile,
        evidence,
        whyItRates,
        modelSummary
      }
      const ceilingRoleSignals = buildCeilingRoleSpikeSignals(edgeRow)
      const lineupRoleSignals = buildLineupRoleContextSignals(edgeRow)
      const marketContextSignals = buildMarketContextSignals(edgeRow)
      return enrichPredictionLayer({ ...edgeRow, ...ceilingRoleSignals, ...lineupRoleSignals, ...marketContextSignals })
    })

    console.log("[CEILING-SIGNAL-STAGE-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      scoredPropsCount: Array.isArray(scoredProps) ? scoredProps.length : 0,
      scoredWithCeilingScore: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
      scoredWithRoleSpikeScore: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => Number.isFinite(Number(row?.roleSpikeScore))).length
    })

    console.log("[EDGE-PROFILE-DEBUG]", {
      totalRows: Array.isArray(scoredProps) ? scoredProps.length : 0,
      byBetTypeFit: Array.isArray(scoredProps)
        ? scoredProps.reduce((acc, row) => {
            const key = String(row?.betTypeFit || "unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      sampleRows: Array.isArray(scoredProps)
        ? scoredProps.slice(0, 12).map((row) => ({
            player: row?.player || null,
            team: row?.team || null,
            matchup: row?.matchup || null,
            propType: row?.propType || null,
            marketKey: row?.marketKey || null,
            propVariant: row?.propVariant || "base",
            odds: row?.odds ?? null,
            hitRate: row?.hitRate ?? null,
            edge: row?.edge ?? null,
            gameEnvironmentScore: row?.gameEnvironmentScore ?? null,
            matchupEdgeScore: row?.matchupEdgeScore ?? null,
            bookValueScore: row?.bookValueScore ?? null,
            volatilityScore: row?.volatilityScore ?? null,
            betTypeFit: row?.betTypeFit || null,
            whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
          }))
        : []
    })

    const scoredRankedForDebug = [...scoredProps].sort((a, b) => {
      if (Number(b.score || 0) !== Number(a.score || 0)) {
        return Number(b.score || 0) - Number(a.score || 0)
      }
      if (Number(b.edge || -999) !== Number(a.edge || -999)) {
        return Number(b.edge || -999) - Number(a.edge || -999)
      }
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })
    debugPipelineStages.afterScoringRanking = summarizePropPipelineRows(scoredRankedForDebug)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-scoring-ranking", scoredRankedForDebug)

    const dedupedBestCandidates = dedupeSlipLegs(
      scoredProps.filter((row) => row.score >= 0)
    )
    debugPipelineStages.afterDedupe = summarizePropPipelineRows(dedupedBestCandidates)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-dedupe", dedupedBestCandidates)

    const preBestStandardRows = (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => {
      const family = String(row?.marketFamily || "")
      const propType = String(row?.propType || "")
      return family === "standard" || ["Points", "Rebounds", "Assists", "Threes", "PRA"].includes(propType)
    })

    console.log("[PRE-BEST-STANDARD-COVERAGE-DEBUG]", {
      total: preBestStandardRows.length,
      byPropType: preBestStandardRows.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byBook: preBestStandardRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      sample: preBestStandardRows.slice(0, 20).map((row) => ({
        book: row?.book,
        propType: row?.propType,
        marketKey: row?.marketKey,
        player: row?.player,
        line: row?.line,
        hitRate: row?.hitRate,
        edge: row?.edge,
        score: row?.score
      }))
    })

    const bestPropsSource = dedupedBestCandidates.filter((row) => qualifiesBestPropsSource(row))
    logBestStage("refresh-snapshot-hard-reset:sourcePool", bestPropsSource)
    console.log(`[BEST-PROPS-SOURCE-DEBUG] path=refresh-snapshot-hard-reset sourceCount=${bestPropsSource.length}`)
    const bestPropsCapResult = buildBestPropsBalancedPool(bestPropsSource, { pathLabel: "refresh-snapshot-hard-reset" })
    const preCapBestPropsPool = bestPropsCapResult.selected
    logBestPropsCapDebug("refresh-snapshot-hard-reset", "pre-cap", bestPropsSource, preCapBestPropsPool, bestPropsCapResult.diagnostics)
    let bestProps = preCapBestPropsPool.slice(0, BEST_PROPS_BALANCE_CONFIG.totalCap)
    const sourceRows = Array.isArray(bestPropsSource) ? bestPropsSource : []
    const fdRows = bestProps.filter((r) => r.book === "FanDuel")

    if (fdRows.length < 10) {
      const fallbackFD = sourceRows
        .filter((r) => r.book === "FanDuel")
        .filter((r) => !shouldRemoveLegForPlayerStatus(r))
        .slice(0, 20)

      bestProps = [
        ...bestProps,
        ...fallbackFD.slice(0, 10 - fdRows.length)
      ]
    }

    console.log("[BEST-PROPS-BOOK-BALANCE]", {
      path: "refresh-snapshot-hard-reset",
      fanduel: bestProps.filter((r) => r.book === "FanDuel").length,
      draftkings: bestProps.filter((r) => r.book === "DraftKings").length
    })
    logBestStage("refresh-snapshot-hard-reset:afterRankingSortAndCap", bestProps)
    logBestPropsCapExcluded("refresh-snapshot-hard-reset", bestPropsSource, bestProps, bestPropsCapResult.diagnostics)
    const eliteProps = bestProps.filter((row) => qualifiesEliteTier(row))
    logFunnelStage("refresh-snapshot-hard-reset", "eliteProps-from-bestProps", bestProps, eliteProps, { threshold: "hit>=0.72,score>=88,minFloor>=24,minStd<=7.5,valueStd<=10.5/5.5" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "eliteProps-from-bestProps", bestProps, eliteProps)
    const strongProps = bestProps.filter((row) => qualifiesStrongTier(row))
    logFunnelStage("refresh-snapshot-hard-reset", "strongProps-from-bestProps", bestProps, strongProps, { threshold: "hit>=0.61,score>=62,minFloor>=22,minStd<=9.5,valueStd<=12/6.5" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "strongProps-from-bestProps", bestProps, strongProps)
    const playableProps = bestProps.filter((row) => qualifiesPlayableTier(row))
    logFunnelStage("refresh-snapshot-hard-reset", "playableProps-from-bestProps", bestProps, playableProps, { threshold: "mins/injury!=high and (score>=42 or hit>=0.62 or hit/edge support or hit/score support)" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "playableProps-from-bestProps", bestProps, playableProps)
    debugPipelineStages.afterPlayableProps = summarizePropPipelineRows(playableProps)
    debugPipelineStages.afterStrongProps = summarizePropPipelineRows(strongProps)
    debugPipelineStages.afterEliteProps = summarizePropPipelineRows(eliteProps)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-playableProps-assignment", playableProps)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-strongProps-assignment", strongProps)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-eliteProps-assignment", eliteProps)

    const eliteCapped = diversifyByTeam(eliteProps, 2, 20)
    logFunnelStage("refresh-snapshot-hard-reset", "eliteCapped-from-eliteProps", eliteProps, eliteCapped, { method: "diversifyByTeam", maxPerTeam: 2, totalCap: 20 })
    logFunnelExcluded("refresh-snapshot-hard-reset", "eliteCapped-from-eliteProps", eliteProps, eliteCapped)
    const strongCapped = diversifyByTeam(strongProps, 2, 30)
    logFunnelStage("refresh-snapshot-hard-reset", "strongCapped-from-strongProps", strongProps, strongCapped, { method: "diversifyByTeam", maxPerTeam: 2, totalCap: 30 })
    logFunnelExcluded("refresh-snapshot-hard-reset", "strongCapped-from-strongProps", strongProps, strongCapped)
    const playableCapped = selectBalancedPool(playableProps, {
      totalCap: 180,
      minPerBook: 80,
      maxPerPlayer: 3,
      maxPerMatchup: 6,
      maxPerType: {
        Assists: 32,
        Rebounds: 32,
        Points: 32,
        Threes: 22,
        PRA: 16
      }
    })
    logFunnelStage("refresh-snapshot-hard-reset", "playableCapped-from-playableProps", playableProps, playableCapped, { totalCap: 180, minPerBook: 80, maxPerPlayer: 3, maxPerMatchup: 6 })
    logFunnelExcluded("refresh-snapshot-hard-reset", "playableCapped-from-playableProps", playableProps, playableCapped)

    oddsSnapshot.updatedAt = new Date().toISOString()
    oddsSnapshot.events = Array.isArray(scheduledEvents) ? scheduledEvents : []
    oddsSnapshot.rawProps = rawPropsRows
    oddsSnapshot.props = activeBookRawPropsRows
    console.log("[UNSTABLE-GAME-INGEST-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      targets: targetMissingEventStages.map((stage) => ({
        ...stage,
        inFinalSavedRawProps: (oddsSnapshot.rawProps || []).some((row) => String(row?.eventId || "") === stage.eventId),
        inFinalSavedProps: (oddsSnapshot.props || []).some((row) => String(row?.eventId || "") === stage.eventId)
      }))
    })
    oddsSnapshot.eliteProps = eliteCapped.filter((row) => playerFitsMatchup(row))
    logFunnelStage("refresh-snapshot-hard-reset", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps, { filter: "playerFitsMatchup" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps)
    oddsSnapshot.strongProps = strongCapped.filter((row) => playerFitsMatchup(row))
    logFunnelStage("refresh-snapshot-hard-reset", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps, { filter: "playerFitsMatchup" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps)
    oddsSnapshot.playableProps = playableCapped.filter((row) => playerFitsMatchup(row))
    logFunnelStage("refresh-snapshot-hard-reset", "oddsSnapshot.playableProps", playableCapped, oddsSnapshot.playableProps, { filter: "playerFitsMatchup" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "oddsSnapshot.playableProps", playableCapped, oddsSnapshot.playableProps)
    logPropStageByBookDebug("refresh-snapshot-hard-reset:afterTierAssignment", {
      elite: oddsSnapshot.eliteProps,
      strong: oddsSnapshot.strongProps,
      playable: oddsSnapshot.playableProps,
      best: bestProps
    })

    // STEP 5: Final visibility guarantee - ensure all watched players in rawProps make it to bestProps
    const watchedNormalized = WATCHED_PLAYER_NAMES.map(normalizeDebugPlayerName)
    const allRawPropsForWatchedCheck = dedupeByLegSignature([
      ...(Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props : [])
    ])
    const missingWatchedInBest = allRawPropsForWatchedCheck.filter(row => {
      const name = normalizeDebugPlayerName(row?.player || "")
      const isWatched = watchedNormalized.includes(name)
      const inBest = bestProps.some(p => normalizeDebugPlayerName(p?.player || "") === name)
      return isWatched && !inBest
    })

    for (const row of missingWatchedInBest) {
      const playerName = normalizeDebugPlayerName(row?.player || "")
      if (!bestProps.some(p => normalizeDebugPlayerName(p?.player || "") === playerName)) {
        bestProps.push(row)
        console.log("[WATCHED-PLAYER-FINAL-GUARANTEE]", {
          player: row?.player,
          reason: "missing_from_best_added_from_raw",
          propType: row?.propType,
          book: row?.book,
          line: row?.line
        })
      }
    }

    oddsSnapshot.bestProps = dedupeByLegSignature(bestProps)
    const hardResetBestPropsBookSoftFloor = Math.max(
      4,
      Math.min(10, Math.floor((Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0) * 0.3))
    )
    logBestStage("refresh-snapshot-hard-reset:afterDedupe", oddsSnapshot.bestProps)
    const hardResetBestPropsBookRescue = ensureBestPropsBookPresence(oddsSnapshot.bestProps, bestPropsSource, {
      targetBook: "DraftKings",
      totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
      meaningfulFloor: hardResetBestPropsBookSoftFloor
    })
    const hardResetBestPropsFanDuelRescue = ensureBestPropsBookPresence(hardResetBestPropsBookRescue.rows, bestPropsSource, {
      targetBook: "FanDuel",
      totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
      meaningfulFloor: hardResetBestPropsBookSoftFloor
    })
    const hardResetPlayableFanDuelPromotion = ensureBestPropsPlayableBookFloor(
      hardResetBestPropsFanDuelRescue.rows,
      oddsSnapshot.playableProps,
      {
        targetBook: "FanDuel",
        minCount: 8,
        totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap
      }
    )
    logBestStage("refresh-snapshot-hard-reset:afterBookBalance", hardResetPlayableFanDuelPromotion.rows)
    console.log("[BEST-RAW-BY-PROP-DEBUG]", {
      total: Array.isArray(hardResetPlayableFanDuelPromotion.rows) ? hardResetPlayableFanDuelPromotion.rows.length : 0,
      byPropType: (Array.isArray(hardResetPlayableFanDuelPromotion.rows) ? hardResetPlayableFanDuelPromotion.rows : []).reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    console.log("[BEST-PROPS-PLAYABLE-PROMOTION-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      initialFanDuelCount: hardResetPlayableFanDuelPromotion.initialBookCount,
      finalFanDuelCount: hardResetPlayableFanDuelPromotion.finalBookCount,
      promotedCount: hardResetPlayableFanDuelPromotion.promotedCount,
      playableFanDuelCount: countByBookForRows(oddsSnapshot.playableProps).FanDuel
    })
    const hardResetPromotedBestProps = Array.isArray(hardResetPlayableFanDuelPromotion.rows)
      ? hardResetPlayableFanDuelPromotion.rows
      : []
    logBestStage("refresh-snapshot-hard-reset:finalAssignedBestProps", oddsSnapshot.bestProps)
    logPropStageByBookDebug("refresh-snapshot-hard-reset:finalPromotion", {
      elite: oddsSnapshot.eliteProps,
      strong: oddsSnapshot.strongProps,
      playable: oddsSnapshot.playableProps,
      best: oddsSnapshot.bestProps
    })
    const hardResetWatchedRawApiCounts = aggregateWatchedCountsFromEventDebug(eventIngestDebug)
    const hardResetWatchedCoverage = buildWatchedPlayersCoverage(
      hardResetWatchedRawApiCounts,
      activeBookRawPropsRows,
      oddsSnapshot.bestProps
    )
    oddsSnapshot.diagnostics = {
      ...(oddsSnapshot.diagnostics && typeof oddsSnapshot.diagnostics === "object" ? oddsSnapshot.diagnostics : {}),
      activeBooks: ACTIVE_BOOKS,
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      coveredEventCount: coveredEvents.length,
      missingScheduledEventCount: missingScheduledEvents.length,
      watchedPlayersCoverage: hardResetWatchedCoverage
    }
    console.log("[WATCHED-PLAYER-COVERAGE-GUARD]", {
      path: "refresh-snapshot-hard-reset",
      players: hardResetWatchedCoverage.map((row) => ({
        player: row.player,
        rawPropsPresent: row.rawPropsPresent,
        rawPropsCount: row.rawPropsCount,
        bestPropsPresent: row.bestPropsPresent,
        bestPropsCount: row.bestPropsCount,
        missingReason: row.missingReason
      }))
    })
    const bestPropsPoolForMixedHard = oddsSnapshot.bestProps || bestProps
    const bestAvailable = buildMixedBestAvailableBuckets(bestPropsPoolForMixedHard, {
      thinSlateMode:
        (Array.isArray(bestPropsPoolForMixedHard) ? bestPropsPoolForMixedHard.length : 0) < 140 ||
        (Number(oddsSnapshot?.snapshotSlateGameCount || 0) > 0 && Number(oddsSnapshot.snapshotSlateGameCount) <= 4)
    })
    oddsSnapshot.safe = bestAvailable.safe
    oddsSnapshot.balanced = bestAvailable.balanced
    oddsSnapshot.aggressive = bestAvailable.aggressive
    oddsSnapshot.lotto = bestAvailable.lotto
    console.log("[PARLAY-BUILDER-RESULT]", {
      safe: !!oddsSnapshot.safe,
      balanced: !!oddsSnapshot.balanced,
      aggressive: !!oddsSnapshot.aggressive,
      lotto: !!oddsSnapshot.lotto
    })
    const hardResetFinalVisibleBest = getAvailablePrimarySlateRows(oddsSnapshot.bestProps || [])
    logBestStage("refresh-snapshot-hard-reset:afterFinalVisibilityFiltering", hardResetFinalVisibleBest)
    console.log("[PRIMARY-SLATE-DISCOVERY-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      unrestrictedEventFetchCount: unrestrictedEventIds.length,
      unrestrictedEventIds,
      scheduledEventCount: scheduledEventIds.length,
      scheduledEventIds,
      dkScopedEventFetchCount: dkScopedEventIds.length,
      dkScopedEventIds,
      missingFromDkButInScheduled,
      mappedRawPropGameCount: getDistinctGameCount(activeBookRawPropsRows),
      playablePropGameCount: getDistinctGameCount(oddsSnapshot.playableProps),
      bestPropGameCount: getDistinctGameCount(hardResetFinalVisibleBest)
    })
    const hardResetSurvivedFragileRows = (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => {
      try {
        return !isFragileLeg(row, "best")
      } catch (_) {
        return true
      }
    })
    console.log("[FRAGILE-FILTER-SUMMARY-DEBUG]", {
      inputCount: (Array.isArray(scoredProps) ? scoredProps : []).length,
      survivedCount: hardResetSurvivedFragileRows.length,
      removedCount: Math.max(0, (Array.isArray(scoredProps) ? scoredProps : []).length - hardResetSurvivedFragileRows.length),
      byBookInput: {
        FanDuel: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => row?.book === "FanDuel").length,
        DraftKings: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => row?.book === "DraftKings").length
      },
      byBookSurvived: {
        FanDuel: hardResetSurvivedFragileRows.filter((row) => row?.book === "FanDuel").length,
        DraftKings: hardResetSurvivedFragileRows.filter((row) => row?.book === "DraftKings").length
      }
    })
    const hardResetRawPropsByBook = countByBookForRows(activeBookRawPropsRows)
    const hardResetSurvivedFragileByBook = countByBookForRows(hardResetSurvivedFragileRows)
    const hardResetPreBestCandidateByBook = countByBookForRows(Array.isArray(bestPropsSource) ? bestPropsSource : [])
    const hardResetFinalBestRawByBook = countByBookForRows(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])

    console.log("[BEST-PROPS-BOOK-STAGE-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      rawPropsRows: hardResetRawPropsByBook,
      dedupedRows: countByBookForRows(dedupedBestCandidates),
      scoredPropsRows: countByBookForRows(scoredProps),
      survivedFragileRows: hardResetSurvivedFragileByBook,
      preBestPropsCandidates: hardResetPreBestCandidateByBook,
      finalBestPropsRawRows: hardResetFinalBestRawByBook,
      balancer: {
        minPerBook: bestPropsCapResult?.diagnostics?.minPerBook,
        reserveTargetByBook: bestPropsCapResult?.diagnostics?.reserveTargetByBook,
        selectedByBookAfterReservePass: bestPropsCapResult?.diagnostics?.selectedByBookAfterReservePass,
        finalDifferenceFDvsDK: bestPropsCapResult?.diagnostics?.finalDifferenceFDvsDK
      }
    })

    const hardResetFdCandidates = (Array.isArray(bestPropsSource) ? bestPropsSource : []).filter((row) => String(row?.book || "") === "FanDuel")
    const hardResetFdFinal = (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => String(row?.book || "") === "FanDuel")
    const hardResetFdDropReasons = {
      totalFdCandidates: hardResetFdCandidates.length,
      finalFdRows: hardResetFdFinal.length,
      droppedByBookBalancer: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perBookBalancing || 0),
      droppedByPlayerCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perPlayerCap || 0),
      droppedByMatchupCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perMatchupCap || 0),
      droppedByStatCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perStatCap || 0),
      droppedByTotalCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.totalCap || 0),
      sourceHasFanDuelCandidates: hardResetFdCandidates.length > 0
    }

    console.log("[BEST-PROPS-BOOK-EXCLUSION-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      fanduel: hardResetFdDropReasons
    })

    const __normalizedFamilySummary = summarizeInterestingNormalizedRows(rawPropsRows || [])
    const __normalizedCoverageSummary = summarizeNormalizedMarketCoverage(rawPropsRows || [])

    console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", __normalizedFamilySummary)
    console.log("[NORMALIZATION-MARKET-KEYS-TOP-DEBUG]", {
      totalRows: __normalizedCoverageSummary.totalRows,
      topPropTypes: Object.entries(__normalizedCoverageSummary.byPropType || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15),
      topMarketKeys: Object.entries(__normalizedCoverageSummary.byMarketKey || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25),
      byBookAndPropType: __normalizedCoverageSummary.byBookAndPropType || {}
    })

    const targetEvents = Array.isArray(scheduledEvents)
      ? scheduledEvents
      : (Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : [])
    console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      scheduledEvents: (Array.isArray(targetEvents) ? targetEvents : []).length,
      rawPropsRows: activeBookRawPropsRows.length,
      enrichedModelRows: (Array.isArray(scoredProps) ? scoredProps : []).length,
      survivedFragileRows: hardResetSurvivedFragileRows.length,
      survivedFragileRowsByBook: {
        FanDuel: hardResetSurvivedFragileRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: hardResetSurvivedFragileRows.filter((r) => r?.book === "DraftKings").length
      },
      bestPropsRawRows: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).length,
      bestPropsRawRowsByBook: {
        FanDuel: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((r) => r?.book === "FanDuel").length,
        DraftKings: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((r) => r?.book === "DraftKings").length
      },
      finalBestVisibleRows: hardResetFinalVisibleBest.length
    })
    runCurrentSlateCoverageDiagnostics({
      scheduledEvents: Array.isArray(targetEvents) ? targetEvents : [],
      rawPropsRows: activeBookRawPropsRows,
      enrichedModelRows: Array.isArray(scoredProps) ? scoredProps : [],
      survivedFragileRows: hardResetSurvivedFragileRows,
      bestPropsRawRows: Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [],
      finalBestVisibleRows: hardResetFinalVisibleBest
    })
    console.log("[BEST-PROPS-STAGE-COUNTS]", {
      path: "refresh-snapshot-hard-reset",
      stage: "afterFinalVisibilityFilter",
      total: hardResetFinalVisibleBest.length,
      byBook: {
        FanDuel: hardResetFinalVisibleBest.filter((row) => String(row?.book || "") === "FanDuel").length,
        DraftKings: hardResetFinalVisibleBest.filter((row) => String(row?.book || "") === "DraftKings").length
      }
    })
    console.log("[BEST-PROPS-PIPELINE-COUNTS]", {
      path: "refresh-snapshot-hard-reset",
      sourceCandidates: bestPropsSource.length,
      postEligibility: bestPropsCapResult?.diagnostics?.eligibleCount || 0,
      postDedupe: bestPropsCapResult?.diagnostics?.dedupedCount || 0,
      postBalancer: preCapBestPropsPool.length,
      postFinalAssignment: oddsSnapshot.bestProps.length,
      finalVisibleByBook: {
        FanDuel: getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
        DraftKings: getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length
      }
    })
    console.log("[BEST-PROPS-FINAL-DEBUG]", {
      finalBestPropsTotal: (oddsSnapshot.bestProps || []).length,
      finalFDCount: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
      finalDKCount: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length,
      first10Players: (oddsSnapshot.bestProps || []).slice(0, 10).map((row) => ({
        player: row?.player,
        book: row?.book,
        propType: row?.propType
      }))
    })
    console.log("[BEST-PROPS-SIZE-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      eligibleCount: bestPropsSource.length,
      selectedFinalCount: (oddsSnapshot.bestProps || []).length,
      byBook: {
        FanDuel: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
        DraftKings: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length
      }
    })
    logBestPropsCapDebug("refresh-snapshot-hard-reset", "post-cap", bestPropsSource, bestProps, bestPropsCapResult.diagnostics)
    logFunnelStage("refresh-snapshot-hard-reset", "oddsSnapshot.bestProps", bestProps, oddsSnapshot.bestProps, { filter: "playerFitsMatchup" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "oddsSnapshot.bestProps", bestProps, oddsSnapshot.bestProps)
    const hardResetFlexPropsSource = dedupeByLegSignature([
      ...(Array.isArray(matchupValidProps) ? matchupValidProps : []),
      ...(Array.isArray(oddsSnapshot.playableProps) ? oddsSnapshot.playableProps : []),
      ...(Array.isArray(oddsSnapshot.strongProps) ? oddsSnapshot.strongProps : []),
      ...(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])
    ])
    oddsSnapshot.flexProps = []
    oddsSnapshot.parlays = null
    oddsSnapshot.dualParlays = null
    console.log("[REFRESH-CORE-ONLY]", {
      raw: oddsSnapshot.props.length,
      best: oddsSnapshot.bestProps.length
    })
    const hardResetPlayableFilterCounts = buildSequentialFilterDropCounts(dedupedBestCandidates, [
      { key: "playableHighMinutesRisk", predicate: (row) => getMinutesRisk(row) !== "high" },
      { key: "playableHighInjuryRisk", predicate: (row) => getInjuryRisk(row) !== "high" },
      { key: "playableSubfloorHitRate", predicate: (row) => parseHitRate(row.hitRate) >= 0.5 },
      { key: "playableThinEdgeAndScore", predicate: (row) => !(getTierEdge(row) < -0.75 && getTierScore(row) < 34) },
      { key: "playableMissedPromotionGate", predicate: qualifiesPlayableTier }
    ])
    const hardResetBestFilterCounts = buildSequentialFilterDropCounts(dedupedBestCandidates, [
      { key: "bestHighMinutesRisk", predicate: (row) => getMinutesRisk(row) !== "high" },
      { key: "bestHighInjuryRisk", predicate: (row) => getInjuryRisk(row) !== "high" },
      { key: "bestSubfloorHitRate", predicate: (row) => parseHitRate(row.hitRate) >= 0.48 },
      { key: "bestThinEdgeAndScore", predicate: (row) => !(getTierEdge(row) < -0.75 && getTierScore(row) < 32) },
      { key: "bestMissedPromotionGate", predicate: qualifiesBestPropsSource }
    ])
    logTierAssignmentDebug(
      "refresh-snapshot-hard-reset",
      dedupedBestCandidates,
      {
        eliteRows: oddsSnapshot.eliteProps,
        strongRows: oddsSnapshot.strongProps,
        playableRows: oddsSnapshot.playableProps,
        bestSourceRows: bestPropsSource,
        preCapBestRows: bestProps,
        bestRows: oddsSnapshot.bestProps,
        flexRows: oddsSnapshot.flexProps
      },
      {
        ...hardResetPlayableFilterCounts.droppedByFilter,
        ...hardResetBestFilterCounts.droppedByFilter,
        bestPoolSelectionDrop: Math.max(0, bestPropsSource.length - bestProps.length),
        bestPoolTotalCapDrop: bestPropsCapResult.diagnostics.dropCounts.totalCap,
        bestPoolPerBookBalancingDrop: bestPropsCapResult.diagnostics.dropCounts.perBookBalancing,
        bestPoolPerPlayerCapDrop: bestPropsCapResult.diagnostics.dropCounts.perPlayerCap,
        bestPoolPerMatchupCapDrop: bestPropsCapResult.diagnostics.dropCounts.perMatchupCap,
        bestPoolPerStatCapDrop: bestPropsCapResult.diagnostics.dropCounts.perStatCap,
        bestPostMatchupFilterDrop: Math.max(0, bestProps.length - oddsSnapshot.bestProps.length),
        flexPoolCount: oddsSnapshot.flexProps.length
      }
    )
    try {
      fs.writeFileSync(
        path.join(__dirname, "snapshot.json"),
        JSON.stringify({
          data: oddsSnapshot,
          savedAt: Date.now()
        })
      )
      console.log("[SNAPSHOT-CACHE] saved snapshot to disk")
    } catch (e) {
      console.log("[SNAPSHOT-CACHE] failed to save snapshot", e.message)
    }
    console.log("[TOP-PROP-SAMPLE] bestProps count:", (oddsSnapshot.bestProps || []).length)
    logTopPropSample("refresh-snapshot-hard-reset bestProps", oddsSnapshot.bestProps)
    debugPipelineStages.afterBestProps = summarizePropPipelineRows(oddsSnapshot.bestProps)
    logPropPipelineStep("refresh-snapshot-hard-reset", "after-bestProps-assignment", oddsSnapshot.bestProps)
    logFunnelDropSummary("refresh-snapshot-hard-reset", debugPipelineStages)
    console.log("[BEST-PROPS-DEBUG] total bestProps:", oddsSnapshot.bestProps.length)
    console.log("[FLEX-PROPS-DEBUG] total flexProps:", (oddsSnapshot.flexProps || []).length)
    console.log(
      "[BEST-PROPS-DEBUG] bestProps by propType:",
      oddsSnapshot.bestProps.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    )
    console.log(
      "[BEST-PROPS-DEBUG] bestProps by book:",
      oddsSnapshot.bestProps.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    )
    lastSnapshotRefreshAt = Date.now()
    console.log("[SNAPSHOT-DEBUG] END refresh-snapshot-hard-reset",
      "bestProps=" + oddsSnapshot.bestProps.length,
      "playableProps=" + oddsSnapshot.playableProps.length,
      "strongProps=" + oddsSnapshot.strongProps.length,
      "eliteProps=" + oddsSnapshot.eliteProps.length
    )

	    const slateMeta = getSlateModeFromEvents(oddsSnapshot.events || [])
	    lastMarketCoverageFocusDebug = aggregateMarketCoverageFocusDebug(eventIngestDebug)

	    lastSnapshotSource = "hard-reset-live"
    lastSnapshotSavedAt = Date.now()
    lastSnapshotAgeMinutes = 0
    lastForceRefreshAt = new Date().toISOString()

    res.json({
      ok: true,
      hardReset: true,
      updatedAt: oddsSnapshot.updatedAt,
      updatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
      primarySlateDateLocal: getPrimarySlateDateKeyFromRows(oddsSnapshot.props || []),
      slateMode: slateMeta.slateMode,
      eligibleRemainingGames: slateMeta.eligibleRemainingGames,
      totalEligibleGames: slateMeta.totalEligibleGames,
      startedEligibleGames: slateMeta.startedEligibleGames,
      events: oddsSnapshot.events.length,
      props: oddsSnapshot.props.length,
      bestProps: oddsSnapshot.bestProps.length,
      flexProps: (oddsSnapshot.flexProps || []).length,
      debugPipeline: {
        stages: debugPipelineStages,
        bestPropsCount: oddsSnapshot.bestProps.length,
        flexPropsCount: (oddsSnapshot.flexProps || []).length,
        playablePropsCount: oddsSnapshot.playableProps.length,
        strongPropsCount: oddsSnapshot.strongProps.length,
        elitePropsCount: oddsSnapshot.eliteProps.length
      }
    })
  } catch (error) {
    res.status(500).json({
      error: "Hard reset snapshot failed",
      details: error.response?.data || error.message
    })
  }
})


// load caches (async) and log failures
loadApiSportsCachesFromDisk().catch((err) => {
  console.error("API-Sports cache load failed:", err?.message || err)
})

// periodically persist API-Sports caches so restarts do not burn API calls
setInterval(() => {
  saveApiSportsCachesToDisk().catch((err) => {
    console.error("API-Sports cache autosave failed:", err?.message || err)
  })
}, 60000)

app.get("/api/debug/market-coverage", (req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    marketCoverageFocusDebug: lastMarketCoverageFocusDebug
  })
})

app.get("/api/best/compact", (req, res) => {
  res.json(buildCompactBestPayload())
})

app.get("/api/best/summary", (req, res) => {
  const payload = buildLiveDualBestAvailablePayload()
  const bestRows = Array.isArray(payload?.best) ? payload.best : []

  res.json({
    snapshotMeta: buildSnapshotMeta(),
    availableCounts: payload?.availableCounts || null,
    bestCount: bestRows.length,
    bestByBook: {
      fanduel: bestRows.filter((row) => row.book === "FanDuel").length,
      draftkings: bestRows.filter((row) => row.book === "DraftKings").length
    },
    topBestSample: bestRows.slice(0, 10).map(toCompactBestRow),
    highestHitRate5: payload?.highestHitRate5 || null,
    diagnostics: payload?.diagnostics || null
  })
})

app.get("/api/best/by-prop/:propType", (req, res) => {
  const requestedPropType = String(req.params.propType || "").toLowerCase()
  const payload = buildLiveDualBestAvailablePayload()
  const bestRows = Array.isArray(payload?.best) ? payload.best : []

  const filtered = bestRows.filter((row) =>
    String(row?.propType || "").toLowerCase() === requestedPropType
  )

  res.json({
    snapshotMeta: buildSnapshotMeta(),
    propType: req.params.propType,
    count: filtered.length,
    rows: filtered.map(toCompactBestRow)
  })
})

app.get("/mlb/refresh", async (req, res) => {
  try {
    // MLB Replay mode support (Phase 7)
    const replayModeRequested = isMlbOddsReplayRequest(req)
    if (replayModeRequested) {
      const replaySnapshot = await loadMlbReplaySnapshotFromDisk()
      if (!replaySnapshot) {
        return res.status(503).json({
          ok: false,
          error: "Replay mode requested but MLB snapshot replay file is missing or invalid",
          replay: true
        })
      }

      mlbSnapshot = replaySnapshot

      return res.status(200).json(buildMlbReplayRefreshResponse(replaySnapshot))
    }

    if (!ODDS_API_KEY) {
      return res.status(500).json({ error: "Missing ODDS_API_KEY in .env" })
    }

    const snapshot = await buildMlbBootstrapSnapshot({
      oddsApiKey: ODDS_API_KEY,
      now: Date.now()
    })

    mlbSnapshot = {
      ...snapshot,
      diagnostics: {
        ...(snapshot?.diagnostics && typeof snapshot.diagnostics === "object" ? snapshot.diagnostics : {}),
        bootstrapPhase: "phase-1-live"
      }
    }

    await saveMlbReplaySnapshotToDisk(mlbSnapshot)

    const rows = Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows : []

    return res.json({
      ok: true,
      replay: false,
      source: "mlb-live-refresh",
      sport: "mlb",
      classificationVersion: MLB_BOOTSTRAP_CLASSIFICATION_VERSION,
      updatedAt: mlbSnapshot.updatedAt,
      snapshotSlateDateKey: mlbSnapshot.snapshotSlateDateKey,
      events: Array.isArray(mlbSnapshot?.events) ? mlbSnapshot.events.length : 0,
      fetchedEventOdds: Array.isArray(mlbSnapshot?.rawOddsEvents) ? mlbSnapshot.rawOddsEvents.length : 0,
      rows: rows.length,
      byBook: (mlbSnapshot?.diagnostics && mlbSnapshot.diagnostics.byBook) || {},
      byMarketFamily: (mlbSnapshot?.diagnostics && mlbSnapshot.diagnostics.byMarketFamily) || {},
      externalSnapshotMeta: mlbSnapshot?.externalSnapshotMeta || null,
      diagnostics: {
        enrichmentCoverage: (mlbSnapshot?.diagnostics && mlbSnapshot.diagnostics.enrichmentCoverage) || null
      },
      failedEventCount: Number(mlbSnapshot?.diagnostics?.failedEventCount || 0)
    })
  } catch (error) {
    return res.status(500).json({
      error: "MLB refresh failed",
      details: error.response?.data || error.message
    })
  }
})

app.get("/mlb/board", (req, res) => {
  const rows = Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows : []
  const parsedLimit = Number(req.query.limit)
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(200, parsedLimit)) : 50
  const parsedGroupSample = Number(req.query.groupSample)
  const groupSample = Number.isFinite(parsedGroupSample) ? Math.max(1, Math.min(100, parsedGroupSample)) : 10
  const parsedTopLimit = Number(req.query.topLimit)
  const topLimit = Number.isFinite(parsedTopLimit) ? Math.max(1, Math.min(100, parsedTopLimit)) : 20

  const inspectionBoard = buildMlbInspectionBoard({
    snapshot: mlbSnapshot,
    sampleLimit: groupSample,
    topLimit
  })

  const sampleRows = rows
    .slice(0, limit)
    .map((row) => ({
      sport: row?.sport || "mlb",
      eventId: row?.eventId || null,
      matchup: row?.matchup || null,
      gameTime: row?.gameTime || null,
      book: row?.book || null,
      marketKey: row?.marketKey || null,
      marketFamily: row?.marketFamily || null,
      propType: row?.propType || null,
      player: row?.player || null,
      side: row?.side || null,
      line: row?.line,
      odds: row?.odds,
      isPitcherMarket: row?.isPitcherMarket === true,
      teamMatchesMatchup: row?.teamMatchesMatchup !== false
    }))

  return res.json({
    ok: true,
    sport: "mlb",
    classificationVersion: MLB_BOOTSTRAP_CLASSIFICATION_VERSION,
    updatedAt: mlbSnapshot?.updatedAt || null,
    snapshotSlateDateKey: mlbSnapshot?.snapshotSlateDateKey || null,
    counts: inspectionBoard.counts,
    diagnostics: {
      ...(mlbSnapshot?.diagnostics || {}),
      byMarketFamily: inspectionBoard.diagnostics.byMarketFamily,
      byMarketKey: inspectionBoard.diagnostics.byMarketKey,
      byBook: inspectionBoard.diagnostics.byBook,
      byMatchup: inspectionBoard.diagnostics.byMatchup,
      topMarketKeys: inspectionBoard.diagnostics.topMarketKeys,
      topBooks: inspectionBoard.diagnostics.topBooks,
      topMatchups: inspectionBoard.diagnostics.topMatchups
    },
    groups: inspectionBoard.groups,
    surfaced: inspectionBoard.surfaced,
    sampleRows
  })
})

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
})

function normalizeParlayLegArray(value, expectedLegCount) {
  if (!Array.isArray(value)) return []
  if (expectedLegCount && value.length !== expectedLegCount) return []
  return value
}

function normalizeParlaySlipObject(value, expectedLegCount) {
  if (!value || typeof value !== "object") return null
  if (!Array.isArray(value.legs)) return null
  if (expectedLegCount && value.legs.length !== expectedLegCount) return null
  return value
}

function buildParlaysResponseShape(parlays = {}) {
  const out = {}

  for (const category of ["safest", "highestHitRate", "best"]) {
    for (const legCount of [2,3,4,5,6,7,8,9,10]) {
      const key = `${category}${legCount}`
      out[key] = normalizeParlayLegArray(parlays[key], legCount)
    }
  }

  return out
}

function buildDualParlaysResponseShape(dualParlays = {}) {
  const out = { bestAvailable: {} }

  for (const category of ["highestHitRate"]) {
    for (const legCount of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const key = `${category}${legCount}`
      const nestedVal = dualParlays?.bestAvailable?.[key] || null
      const flatVal = dualParlays?.[key] || null
      const val =
        nestedVal && typeof nestedVal === "object"
          ? nestedVal
          : flatVal && typeof flatVal === "object"
            ? flatVal
            : {}

      if (!out.bestAvailable[key]) out.bestAvailable[key] = {}

      out.bestAvailable[key].fanduel =
        normalizeParlaySlipObject(val?.fanduel, legCount)

      out.bestAvailable[key].draftkings =
        normalizeParlaySlipObject(val?.draftkings, legCount)
    }
  }

  // Add payoutFitPortfolio directly to the response
  if (dualParlays?.payoutFitPortfolio) {
    out.payoutFitPortfolio = {
      fanduel: dualParlays.payoutFitPortfolio.fanduel || {},
      draftkings: dualParlays.payoutFitPortfolio.draftkings || {}
    }
  }

  for (const laneKey of ["recoupPortfolio", "conservativePortfolio", "midUpsidePortfolio", "lottoBatchPortfolio"]) {
    if (!dualParlays?.[laneKey]) continue
    out[laneKey] = {
      fanduel: dualParlays[laneKey].fanduel || { options: [] },
      draftkings: dualParlays[laneKey].draftkings || { options: [] }
    }
  }

  return out
}
