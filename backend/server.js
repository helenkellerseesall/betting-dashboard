require("dotenv").config({ path: require("path").join(__dirname, ".env") })
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
const {
  buildMlbInspectionBoard,
  buildPlayerTeamIndex,
  inferSurfaceTeamLabel
} = require("./pipeline/mlb/buildMlbInspectionBoard")
const {
  resolveMlbTeamFromDiskCacheRow,
  getMlbTeamTokenSet,
  parseMlbMatchupTeams
} = require("./pipeline/resolution/mlbTeamResolution")
const { buildPregameContext } = require("./pipeline/context/pregameContext")
const { buildMlbDecisionBoard } = require("./pipeline/mlb/lanes/buildMlbDecisionBoard")
const { buildMlbBetSelector } = require("./pipeline/mlb/buildMlbBetSelector")
const { buildMlbSlipEngine } = require("./pipeline/mlb/buildMlbSlipEngine")
const { buildMlbOomphEngine } = require("./pipeline/mlb/buildMlbOomphEngine")
const { buildMlbSpikeEngine } = require("./pipeline/mlb/buildMlbSpikeEngine")
const { buildMlbPropClusters } = require("./pipeline/mlb/buildMlbPropClusters")
const { buildMlbClusters } = require("./pipeline/mlb/buildMlbClusters")
const { buildMlbBestProps } = require("./pipeline/mlb/buildMlbBestProps")
const { scoreMlbProp } = require("./pipeline/mlb/scoreMlbProp")
const { recordMlbBestProps, evaluateMlbPerformance, readMlbTrackedBestSnapshot, recordMlbDailyPicks, evaluateMlbPicks } = require("./pipeline/mlb/phase4Tracking")
const {
  normalizeBestAvailableSportKey,
  isMlbBestAvailableSportKey
} = require("./pipeline/sports/bestAvailableSportDispatch")
const { handleMlbBestAvailableGet, handleMlbRefreshSnapshotGet } = require("./http/mlbIsolatedRoutes")
const {
  getNbaBestAvailableSource,
  getNbaRefreshSnapshotSource
} = require("./http/nbaIsolatedRoutes")
const { buildMlbParlays } = require("./pipeline/mlb/buildMlbParlays")
const { buildMlbPlayerModelContext, modelMlbPredictedProbability } = require("./pipeline/mlb/playerModel")
const {
  buildMlbCorrelationClusters,
  buildMlbUpsideClusters,
  isHighUpsideRow: isMlbHighUpsideRow
} = require("./pipeline/mlb/buildMlbCorrelationEngine")
const { saveTrackedSlateSnapshot } = require("./pipeline/tracking/saveTrackedSlateSnapshot")
const { gradeTrackedSlateSnapshot } = require("./pipeline/tracking/gradeTrackedSlateSnapshot")
const { buildTrackedSlateSummary } = require("./pipeline/tracking/buildTrackedSlateSummary")
const { buildBestPairs } = require("./pipeline/decision/buildBestPairs")
const { loadBets, logBet } = require("./tracker/betTracker")
const { computeBetMetrics } = require("./tracker/betMetrics")

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

function sanitizeSnapshotRows(rows, opts = {}) {
  const input = Array.isArray(rows) ? rows : []
  const slateState = typeof opts?.slateState === "string" ? opts.slateState : null
  const nowMs = Date.now()

  const marketValidityOkForActiveSanitize = (r) => {
    const v = r?.marketValidity
    if (v === "invalid") return false
    return v == null || v === "" || v === "valid"
  }

  const derivedActiveSlate =
    input.some((r) => {
      const gameMs = r?.gameTime ? new Date(r.gameTime).getTime() : null
      const marketOk = marketValidityOkForActiveSanitize(r) && r?.odds != null
      return Number.isFinite(gameMs) && gameMs <= nowMs && marketOk
    })

  const isActiveSlate = slateState === "active_today" || derivedActiveSlate

  const output = input.filter((r) => {
    if (!r || typeof r !== "object") return false

    // Active slate: keep degraded-but-valid rows so we don't wipe the whole slate.
    if (isActiveSlate) {
      return (
        marketValidityOkForActiveSanitize(r) &&
        r.odds != null &&
        r.propType != null &&
        String(r.propType || "").trim() !== "0"
      )
    }

    // Pregame strict (existing behavior).
    return (
      typeof r.propType === "string" &&
      r.propType !== "0" &&
      typeof r.team === "string" &&
      r.team !== "0" &&
      Number.isFinite(Number(r.odds)) &&
      Number(r.odds) !== 0 &&
      Number.isFinite(Number(r.line)) &&
      Number(r.line) !== 0
    )
  })

  console.log("[SANITIZE RESULT]", {
    before: input.length,
    after: output.length,
    mode: isActiveSlate ? "active-relaxed" : "pregame-strict"
  })

  return output
}

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
let mlbPicks = { safeCore: [], valueCore: [], powerCore: [] }
let mlbSlips = []
let mlbOomphSlips = null
let mlbSpikePlayers = { spikePlayers: [] }
let mlbCorrelationClusters = []
let mlbUpsideClusters = []

// MLB line movement tracker (in-memory across refreshes).
// Keyed by a stable leg signature so we can compute openingOdds + movement
// without touching scoring or selection logic.
const mlbOpeningOddsByLegKey = new Map()

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

  // Safe override: quality-pass failure must not force props to be treated as dead
  // when we have valid raw+sanitized props. Mark slate as thin-but-valid.
  if (
    !loadedSlateQualityPassEnabled &&
    Number.isFinite(rawPropsCount) && rawPropsCount > 0 &&
    Number.isFinite(propsCount) && propsCount > 0
  ) {
    console.log("[QUALITY PASS OVERRIDE]", {
      rawPropsCount,
      sanitizedCount: propsCount
    })
    mode = "thin-but-valid"
    // Remove this reason so downstream does not treat it as a hard failure signal.
    const idx = reasons.indexOf("loaded-slate-quality-pass-failed")
    if (idx >= 0) reasons.splice(idx, 1)
  }

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
  const collapsed = raw.toLowerCase().replace(/\s+/g, "")
  if (collapsed.includes("draftkings") || collapsed === "dk") return "DraftKings"
  if (collapsed.includes("fanduel") || collapsed === "fd") return "FanDuel"
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
  const sourceRowsRaw = dedupeSlipLegs((Array.isArray(rows) ? rows : []).filter(Boolean))
  // Filter out low-impact / low-ceiling rows from best-available buckets.
  // Keep only true exceptions (very high score/edge) to preserve honesty on thin slates.
  const sourceRows = sourceRowsRaw.filter((row) => {
    const ceiling = Number(row?.ceilingScore || 0)
    const hit = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge || 0)
    const score = Number(row?.score || 0)
    const propType = String(row?.propType || "")
    const line = Number(row?.line || 0)

    if (propType === "Threes" && line > 0 && line <= 1.5 && ceiling < 0.62) return false

    if (ceiling > 0 && ceiling < 0.5) {
      const eliteException =
        (score >= 95 && hit >= 0.62) ||
        (Math.abs(edge) >= 6.5 && hit >= 0.6)
      return eliteException
    }
    return true
  })
  if (sourceRowsRaw.length !== sourceRows.length) {
    console.log("[BEST-AVAILABLE-SOURCE-FILTER]", {
      dropped: sourceRowsRaw.length - sourceRows.length,
      kept: sourceRows.length
    })
  }
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

function shapeExportBestBoard(rows = [], options = {}) {
  const safe = dedupeSlipLegs(Array.isArray(rows) ? rows : []).filter(Boolean)
  const mode = String(options?.slateMode || "").toLowerCase()
  const targetCount = Number.isFinite(options?.targetCount) ? Number(options.targetCount) : safe.length
  if (!safe.length) return []

  const maxPerPlayer = Number.isFinite(options?.maxPerPlayer)
    ? Number(options.maxPerPlayer)
    : (mode === "thin" ? 2 : 2)
  const maxPerPlayerPropType = 1
  const praSoftCap = Number.isFinite(options?.praSoftCap)
    ? Number(options.praSoftCap)
    : Math.max(2, Math.min(4, Math.floor(targetCount * (mode === "thin" ? 0.45 : 0.35))))

  const normalizedProp = (p) => String(p || "").trim()
  const isPRA = (row) => normalizedProp(row?.propType) === "PRA"

  const rankKey = (row) => {
    const baseScore = Number(row?.score || 0)
    // Shaping-only: small preference for distinct single-stat markets vs PRA when close.
    const typeBias = isPRA(row) ? -2 : 2
    const ceiling = Number(row?.ceilingScore || 0)
    const ceilingBias = ceiling >= 0.7 ? 2 : ceiling >= 0.58 ? 1 : 0
    return baseScore + typeBias + ceilingBias
  }

  const sorted = [...safe].sort((a, b) => {
    const d = rankKey(b) - rankKey(a)
    if (d !== 0) return d
    const s = Number(b?.score || 0) - Number(a?.score || 0)
    if (s !== 0) return s
    const e = Number(b?.edge || 0) - Number(a?.edge || 0)
    if (e !== 0) return e
    return Number(b?.odds || 0) - Number(a?.odds || 0)
  })

  const out = []
  const playerCounts = new Map()
  const playerPropCounts = new Map() // player -> Map(propType -> count)
  let praCount = 0

  const playerKey = (row) => String(row?.player || "").trim().toLowerCase()
  const propKey = (row) => String(row?.propType || "").trim().toLowerCase()

  const canTake = (row, phase = "main") => {
    const pk = playerKey(row)
    if (!pk) return false
    const pCount = playerCounts.get(pk) || 0
    if (pCount >= maxPerPlayer) return false

    const pt = propKey(row)
    const ptMap = playerPropCounts.get(pk) || new Map()
    const ptCount = pt ? (ptMap.get(pt) || 0) : 0
    if (pt && ptCount >= maxPerPlayerPropType) return false

    if (phase !== "fill" && isPRA(row) && praCount >= praSoftCap) return false

    return true
  }

  const record = (row) => {
    const pk = playerKey(row)
    const pt = propKey(row)
    playerCounts.set(pk, (playerCounts.get(pk) || 0) + 1)
    if (pt) {
      const ptMap = playerPropCounts.get(pk) || new Map()
      ptMap.set(pt, (ptMap.get(pt) || 0) + 1)
      playerPropCounts.set(pk, ptMap)
    }
    if (isPRA(row)) praCount += 1
  }

  // Phase 1: prefer one distinct non-PRA per player (if available).
  for (const row of sorted) {
    if (out.length >= targetCount) break
    if (isPRA(row)) continue
    const pk = playerKey(row)
    if (!pk) continue
    if ((playerCounts.get(pk) || 0) >= 1) continue
    if (!canTake(row, "main")) continue
    out.push(row)
    record(row)
  }

  // Phase 2: fill with best remaining, respecting soft PRA cap + player caps.
  for (const row of sorted) {
    if (out.length >= targetCount) break
    const key = `${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`
    if (out.some((r) => `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}` === key)) continue
    if (!canTake(row, "main")) continue
    out.push(row)
    record(row)
  }

  // Phase 3 (thin honesty): if we’re still short, allow PRA beyond soft cap but keep player/prop caps.
  if (out.length < Math.min(targetCount, 8)) {
    for (const row of sorted) {
      if (out.length >= targetCount) break
      const key = `${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`
      if (out.some((r) => `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}` === key)) continue
      if (!canTake(row, "fill")) continue
      out.push(row)
      record(row)
    }
  }

  return out
}

function diversifySuperstarCeilingBoard(rows = [], options = {}) {
  const maxRows = Math.max(1, Number(options.maxRows || 16))
  const maxPerPlayer = Math.max(1, Number(options.maxPerPlayer || 2))
  const maxLinesPerPlayerProp = Math.max(1, Number(options.maxLinesPerPlayerProp || 1))
  const list = Array.isArray(rows) ? rows : []
  const picked = []
  const playerUses = new Map()
  const playerPropUses = new Map()

  for (const row of list) {
    const pk = String(row?.player || "").trim().toLowerCase()
    if (!pk) continue
    if ((playerUses.get(pk) || 0) >= maxPerPlayer) continue
    const pt = String(row?.propType || "").trim().toLowerCase()
    const propKey = `${pk}|${pt}`
    if ((playerPropUses.get(propKey) || 0) >= maxLinesPerPlayerProp) continue
    picked.push(row)
    playerUses.set(pk, (playerUses.get(pk) || 0) + 1)
    playerPropUses.set(propKey, (playerPropUses.get(propKey) || 0) + 1)
    if (picked.length >= maxRows) break
  }
  return picked
}

/** OOMPH export: diversify then enforce max 2 / player with distinct propTypes (non-destructive vs other boards). */
function selectOomphExportBalanced(rows = [], maxRows = 16) {
  const list = Array.isArray(rows) ? rows : []
  const strip = (row) => {
    if (!row || typeof row !== "object") return row
    const { _oomphRank, _oomphTier, ...rest } = row
    return rest
  }
  const sorted = [...list].sort((a, b) => (Number(b?._oomphRank) || 0) - (Number(a?._oomphRank) || 0))
  const poolCap = Math.min(sorted.length, Math.max(maxRows * 3, maxRows + 12))
  const diversified = diversifySuperstarCeilingBoard(sorted.slice(0, poolCap), {
    maxRows: Math.max(maxRows, Math.min(poolCap, 24)),
    maxPerPlayer: 2,
    maxLinesPerPlayerProp: 1
  })
  const out = []
  const propsByPlayer = new Map()
  for (const row of diversified) {
    const pk = String(row?.player || "").trim().toLowerCase()
    if (!pk) continue
    const used = propsByPlayer.get(pk) || []
    if (used.length >= 2) continue
    const pt = String(row?.propType || "")
    if (!pt || used.includes(pt)) continue
    out.push(strip(row))
    used.push(pt)
    propsByPlayer.set(pk, used)
    if (out.length >= maxRows) break
  }
  return out
}

function oomphLadderTierMeta(propType, threshold) {
  const t = Number(threshold)
  const pt = String(propType || "")
  if (pt === "Points") {
    if (t >= 40) return { tier: "nuclear", boost: 68 }
    if (t >= 35) return { tier: "mid", boost: 48 }
    if (t >= 30) return { tier: "mid", boost: 32 }
    return { tier: "low", boost: 6 }
  }
  if (pt === "Threes") {
    if (t >= 5) return { tier: "nuclear", boost: 64 }
    if (t >= 4) return { tier: "mid", boost: 42 }
    return { tier: "low", boost: 5 }
  }
  if (pt === "Assists") {
    if (t >= 12) return { tier: "nuclear", boost: 62 }
    if (t >= 10) return { tier: "mid", boost: 38 }
    return { tier: "low", boost: 7 }
  }
  if (pt === "Rebounds") {
    if (t >= 15) return { tier: "nuclear", boost: 66 }
    if (t >= 12) return { tier: "mid", boost: 40 }
    return { tier: "low", boost: 8 }
  }
  return { tier: "mid", boost: 20 }
}

/** OOMPH row tags: only stat-relevant ceiling triggers (no assist tags on Points rows). */
function buildOomphTagsForLadder(propType, ladderTag, seed, cc, breakoutCandidate) {
  const pt = String(propType || "")
  const ceiling = Number(seed?.ceilingScore || 0)
  const lpi = Number(seed?.longshotPredictiveIndex || 0)
  const tags = []
  if (ceiling >= 0.72 || lpi >= 0.35) tags.push("superstar ceiling")
  else tags.push("ceiling setup")
  if (breakoutCandidate) tags.push("breakout candidate")
  if (pt === "Points") {
    if (cc?.scoringCeilingTrigger) tags.push("scoring ceiling")
    if (cc?.usageSpikeTrigger) tags.push("usage spike")
  } else if (pt === "Threes") {
    if (cc?.threePointCeilingTrigger) tags.push("threes spike")
    if (cc?.usageSpikeTrigger) tags.push("usage spike")
  } else if (pt === "Assists") {
    if (cc?.assistCeilingTrigger) tags.push("assist spike")
    if (cc?.usageSpikeTrigger) tags.push("usage spike")
  } else if (pt === "Rebounds") {
    if (cc?.reboundCeilingTrigger) tags.push("rebound spike")
    if (cc?.usageSpikeTrigger) tags.push("usage spike")
  }
  if (ladderTag) tags.push(String(ladderTag).trim())
  return [...new Set(tags.filter(Boolean))]
}

function computeMinutesTrendScore(avgMin, recent5MinAvg, recent3MinAvg) {
  const a = Number(avgMin)
  const r5 = Number(recent5MinAvg)
  const r3 = Number(recent3MinAvg)
  if (!Number.isFinite(r3) || !Number.isFinite(r5)) return null
  const shortDelta = r3 - r5
  let w = shortDelta / 6
  if (Number.isFinite(a) && a > 1) {
    w += (r5 - a) / Math.max(a, 12)
  }
  return Number(Math.max(-1, Math.min(1, w)).toFixed(3))
}

function buildNbaSuperstarCeilingBoard({ poolRows = [], propsRows = [], slateMode = "unknown" } = {}) {
  const mode = String(slateMode || "").toLowerCase()
  const maxPlayers = mode === "thin" ? 6 : 8
  const maxRows = mode === "thin" ? 10 : 16

  const safePool = Array.isArray(poolRows) ? poolRows : []
  const safeProps = Array.isArray(propsRows) ? propsRows : []
  const byPlayer = new Map()

  const consider = (row) => {
    if (!row) return
    const player = String(row?.player || "").trim()
    if (!player) return
    const ceiling = Number(row?.ceilingScore || 0)
    const lpi = Number(row?.longshotPredictiveIndex || 0)
    const roleSpike = Number(row?.roleSpikeScore || 0)
    const oppSpike = Number(row?.opportunitySpikeScore || 0)
    const avgMin = Number(row?.avgMin || 0)
    const minutesRisk = String(row?.minutesRisk || "").toLowerCase()

    const spikeOverride = roleSpike >= 0.3 || oppSpike >= 0.38
    if (!spikeOverride && avgMin > 0 && avgMin < 26) return
    if (minutesRisk === "high" && !spikeOverride) return

    // Hard gate: no low-ceiling plays on oomph board (slightly looser than row-level so more players qualify).
    if (ceiling > 0 && ceiling < 0.56 && lpi < 0.21 && roleSpike < 0.2) return

    const rank =
      (ceiling * 100) +
      (lpi * 70) +
      (roleSpike * 55) +
      (oppSpike * 45) +
      (avgMin >= 32 ? 6 : avgMin >= 28 ? 3 : 0)

    const prev = byPlayer.get(player)
    if (!prev || rank > prev.rank) byPlayer.set(player, { player, seed: row, rank })
  }

  for (const r of safePool) consider(r)
  for (const r of safeProps) consider(r)

  const topPlayers = Array.from(byPlayer.values())
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxPlayers)

  const findAlt = (player, propType, threshold) => {
    const matches = safeProps
      .filter((r) => String(r?.player || "") === player)
      .filter((r) => String(r?.propType || "") === propType)
      .filter((r) => String(r?.side || "") === "Over")
      .filter((r) => Number.isFinite(Number(r?.line)) && Number(r.line) >= threshold)
      .sort((a, b) => {
        const dl = Math.abs(Number(a.line) - threshold) - Math.abs(Number(b.line) - threshold)
        if (dl !== 0) return dl
        // prefer closer odds band (use higher payout if same line distance)
        return Number(b?.odds || 0) - Number(a?.odds || 0)
      })
    return matches[0] || null
  }

  const baseLineByPlayerProp = (player, propType) => {
    const base = safeProps
      .filter((r) => String(r?.player || "") === player)
      .filter((r) => String(r?.propType || "") === propType)
      .filter((r) => String(r?.marketKey || "").includes("_alternate") === false)
      .sort((a, b) => {
        const s = Number(b?.score || 0) - Number(a?.score || 0)
        if (s !== 0) return s
        return Number(b?.edge || 0) - Number(a?.edge || 0)
      })[0]
    return base ? Number(base.line || 0) : 0
  }

  const out = []
  const pushRow = (seed, propType, threshold, altRow, tags, playerPregameContext, ladderMeta, breakoutCandidate) => {
    const ceiling = Number(seed?.ceilingScore || 0)
    const lpi = Number(seed?.longshotPredictiveIndex || 0)
    if (ceiling > 0 && ceiling < 0.55 && (!Number.isFinite(lpi) || lpi < 0.21)) return
    const ladderLine = `${threshold}+`
    const teamOut = normalizeNbaExportTeamForRow(seed) || seed?.team || null
    const ctx =
      playerPregameContext && typeof playerPregameContext === "object"
        ? playerPregameContext
        : buildPregameContext({ sport: "nba", row: { ...seed, team: teamOut || seed?.team } })
    const rs = Number(seed?.roleSpikeScore || 0)
    const os = Number(seed?.opportunitySpikeScore || 0)
    const boost = Number(ladderMeta?.boost || 0)
    const _oomphTier = ladderMeta?.tier || "mid"
    const _oomphRank =
      ceiling * 118 +
      lpi * 86 +
      rs * 62 +
      os * 50 +
      boost +
      (breakoutCandidate ? 16 : 0)
    out.push({
      player: seed?.player || null,
      team: teamOut,
      propType,
      ladderLine,
      estimatedOdds: altRow?.odds ?? null,
      book: altRow?.book ?? null,
      ceilingScore: Number.isFinite(ceiling) ? Number(ceiling.toFixed(3)) : null,
      longshotPredictiveIndex: Number.isFinite(lpi) ? Number(lpi.toFixed(3)) : null,
      roleSpikeScore: Number.isFinite(Number(seed?.roleSpikeScore)) ? Number(seed.roleSpikeScore) : null,
      opportunitySpikeScore: Number.isFinite(Number(seed?.opportunitySpikeScore)) ? Number(seed.opportunitySpikeScore) : null,
      pregameContext: ctx,
      // OOMPH rows: keep explanationTags aligned with prop-scoped `tags` (pregameContext can mix stat triggers).
      explanationTags: Array.isArray(tags) ? [...tags] : [],
      tags: Array.isArray(tags) ? [...tags] : [],
      _oomphRank,
      _oomphTier
    })
  }

  for (const entry of topPlayers) {
    const seed = entry.seed || {}
    const player = String(seed?.player || "").trim()
    if (!player) continue

    const ctx = buildPregameContext({ sport: "nba", row: seed })
    const cc = ctx?.ceilingContext || {}
    const minutesTrendScore = computeMinutesTrendScore(seed?.avgMin, seed?.recent5MinAvg, seed?.recent3MinAvg)
    const rs = Number(seed?.roleSpikeScore || 0)
    const os = Number(seed?.opportunitySpikeScore || 0)
    const breakoutCandidate =
      rs >= 0.34 ||
      os >= 0.4 ||
      (Number(seed?.lineupContextScore || 0) >= 0.32 && Number.isFinite(minutesTrendScore) && minutesTrendScore >= 0.12)

    const pointsBase = baseLineByPlayerProp(player, "Points")
    const threesBase = baseLineByPlayerProp(player, "Threes")
    const astBase = baseLineByPlayerProp(player, "Assists")
    const rebBase = baseLineByPlayerProp(player, "Rebounds")

    const ceiling = Number(seed?.ceilingScore || 0)
    const lpi = Number(seed?.longshotPredictiveIndex || 0)
    // Mid-high ceiling entries (30+, 4+, 10+, 12+ reb): ceiling ~0.60+ OR solid LPI.
    const midHigh = ceiling >= 0.6 || lpi >= 0.25 || breakoutCandidate
    const extremeGate =
      ceiling >= 0.69 ||
      lpi >= 0.33 ||
      (breakoutCandidate && ceiling >= 0.6 && lpi >= 0.26)

    const allowPoints = pointsBase >= 19 || ceiling >= 0.58 || lpi >= 0.26 || breakoutCandidate
    const allowThrees = threesBase >= 2.4 || cc.threePointCeilingTrigger || lpi >= 0.26
    const allowAssists = astBase >= 6.8 || cc.assistCeilingTrigger || breakoutCandidate
    const allowRebounds = rebBase >= 8.8 || (cc.reboundCeilingTrigger && ceiling >= 0.58)

    if (allowPoints) {
      const tiers = [
        {
          t: 30,
          gate: () =>
            midHigh ||
            lpi >= 0.24 ||
            pointsBase >= 22.5 ||
            cc.scoringCeilingTrigger ||
            (breakoutCandidate && pointsBase >= 21),
          tag: "points ladder"
        },
        {
          t: 35,
          gate: () =>
            ceiling >= 0.57 ||
            lpi >= 0.26 ||
            cc.scoringCeilingTrigger ||
            (breakoutCandidate && pointsBase >= 19),
          tag: "superstar scoring ladder"
        },
        {
          t: 40,
          gate: () =>
            extremeGate ||
            cc.scoringCeilingTrigger ||
            (breakoutCandidate && ceiling >= 0.58 && (lpi >= 0.24 || pointsBase >= 21)),
          tag: "nuclear points ladder"
        }
      ]
      for (const { t, gate, tag } of tiers) {
        if (!gate()) continue
        const alt = findAlt(player, "Points", t)
        const rowTags = buildOomphTagsForLadder("Points", tag, seed, cc, breakoutCandidate)
        pushRow(seed, "Points", t, alt, rowTags, ctx, oomphLadderTierMeta("Points", t), breakoutCandidate)
      }
    }
    if (allowThrees) {
      const tiers = [
        {
          t: 4,
          gate: () =>
            midHigh ||
            lpi >= 0.24 ||
            threesBase >= 2.45 ||
            cc.threePointCeilingTrigger ||
            (breakoutCandidate && threesBase >= 2.35),
          tag: "threes ladder"
        },
        {
          t: 5,
          gate: () =>
            ceiling >= 0.6 ||
            lpi >= 0.28 ||
            cc.threePointCeilingTrigger ||
            threesBase >= 2.75 ||
            (breakoutCandidate && ceiling >= 0.56 && threesBase >= 2.5),
          tag: "nuclear threes ladder"
        }
      ]
      for (const { t, gate, tag } of tiers) {
        if (!gate()) continue
        const alt = findAlt(player, "Threes", t)
        const rowTags = buildOomphTagsForLadder("Threes", tag, seed, cc, breakoutCandidate)
        pushRow(seed, "Threes", t, alt, rowTags, ctx, oomphLadderTierMeta("Threes", t), breakoutCandidate)
      }
    }
    if (allowAssists) {
      const tiers = [
        {
          t: 10,
          gate: () =>
            midHigh ||
            (astBase >= 6.6 && (ceiling >= 0.56 || lpi >= 0.22)) ||
            cc.assistCeilingTrigger,
          tag: "assists ladder"
        },
        {
          t: 12,
          gate: () =>
            ceiling >= 0.6 ||
            lpi >= 0.26 ||
            cc.assistCeilingTrigger ||
            (breakoutCandidate && astBase >= 7.3),
          tag: "nuclear assists ladder"
        }
      ]
      for (const { t, gate, tag } of tiers) {
        if (!gate()) continue
        const alt = findAlt(player, "Assists", t)
        const rowTags = buildOomphTagsForLadder("Assists", tag, seed, cc, breakoutCandidate)
        pushRow(seed, "Assists", t, alt, rowTags, ctx, oomphLadderTierMeta("Assists", t), breakoutCandidate)
      }
    }
    if (allowRebounds) {
      const tiers = [
        {
          t: 12,
          gate: () =>
            (midHigh && rebBase >= 8.2) ||
            cc.reboundCeilingTrigger ||
            (breakoutCandidate && rebBase >= 8.8),
          tag: "rebounds ladder"
        },
        {
          t: 15,
          gate: () =>
            extremeGate ||
            (cc.reboundCeilingTrigger && ceiling >= 0.6) ||
            (breakoutCandidate && rebBase >= 10.5 && ceiling >= 0.56),
          tag: "nuclear rebounds ladder"
        }
      ]
      for (const { t, gate, tag } of tiers) {
        if (!gate()) continue
        const alt = findAlt(player, "Rebounds", t)
        const rowTags = buildOomphTagsForLadder("Rebounds", tag, seed, cc, breakoutCandidate)
        pushRow(seed, "Rebounds", t, alt, rowTags, ctx, oomphLadderTierMeta("Rebounds", t), breakoutCandidate)
      }
    }
  }

  const rankedAll = out.filter((r) => {
    const c = Number(r?.ceilingScore || 0)
    const l = Number(r?.longshotPredictiveIndex || 0)
    return c >= 0.55 || l >= 0.22
  })
  return selectOomphExportBalanced(rankedAll, maxRows)
}

function buildMlbDualPoolDiagnostics(eligibleRows) {
  const safeRows = Array.isArray(eligibleRows) ? eligibleRows : []
  const books = ["FanDuel", "DraftKings"]
  const byBook = {}
  for (const book of books) {
    const bookRows = safeRows.filter((row) => row?.book === book)
    byBook[book] = {
      total: bookRows.length,
      Hits: bookRows.filter((row) => String(row?.propType) === "Hits").length,
      "Home Runs": bookRows.filter((row) => String(row?.propType) === "Home Runs").length,
      "Total Bases": bookRows.filter((row) => String(row?.propType) === "Total Bases").length,
      RBIs: bookRows.filter((row) => String(row?.propType) === "RBIs").length
    }
  }
  return {
    sportKey: "baseball_mlb",
    rawProps: Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows.length : 0,
    totalEligible: safeRows.length,
    byBook
  }
}

function __mlbLocalTrackingDateKey(nowMs = Date.now()) {
  const d = new Date(nowMs)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function __mlbReadTrackedBestLearning(nowMs = Date.now()) {
  const dateKey = __mlbLocalTrackingDateKey(nowMs)
  const filePath = path.join(__dirname, "runtime", "tracking", `mlb_tracked_best_${dateKey}.json`)

  const emptyBucket = () => ({ totalBets: 0, wins: 0, losses: 0, hitRate: 0 })
  const bump = (map, key, entry) => {
    const k = String(key || "unknown")
    if (!map[k]) map[k] = emptyBucket()
    map[k].totalBets += 1
    if (entry?.result === "win") map[k].wins += 1
    if (entry?.result === "loss") map[k].losses += 1
  }
  const finalize = (map) => {
    const out = {}
    for (const [k, v] of Object.entries(map)) {
      const decided = (v.wins || 0) + (v.losses || 0)
      out[k] = {
        totalBets: v.totalBets,
        wins: v.wins,
        losses: v.losses,
        hitRate: decided > 0 ? v.wins / decided : 0,
      }
    }
    return out
  }

  const normalizePropTypeKey = (pt) => {
    const s = String(pt || "").trim()
    if (!s) return "unknown"
    if (s === "Home Runs") return "HR"
    if (s === "Hits") return "Hits"
    if (s === "Total Bases") return "TB"
    if (s === "RBIs") return "RBI"
    return s
  }

  const edgeBucket = (edge) => {
    const e = Number(edge)
    if (!Number.isFinite(e)) return "unknown"
    if (e < 0.1) return "0-0.1"
    if (e < 0.2) return "0.1-0.2"
    if (e < 0.3) return "0.2-0.3"
    if (e < 0.4) return "0.3-0.4"
    return "0.4+"
  }

  const oddsBucket = (odds) => {
    const o = Number(odds)
    if (!Number.isFinite(o) || o === 0) return "unknown"
    if (o < 0) {
      if (o >= -110) return "fav_-110_to_-101"
      if (o >= -150) return "fav_-150_to_-111"
      if (o >= -250) return "fav_-250_to_-151"
      return "fav_-250+"
    }
    if (o <= 120) return "plus_+1_to_+120"
    if (o <= 200) return "plus_+121_to_+200"
    if (o <= 400) return "plus_+201_to_+400"
    return "plus_+401+"
  }

  let raw = null
  try {
    if (fs.existsSync(filePath)) raw = JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (_) {
    raw = null
  }

  const entries = Array.isArray(raw?.entries)
    ? raw.entries.filter((e) => e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best")
    : []

  const byPropTypeMap = {}
  const byEdgeBucketMap = {}
  const byOddsBucketMap = {}
  for (const e of entries) {
    bump(byPropTypeMap, normalizePropTypeKey(e?.propType), e)
    bump(byEdgeBucketMap, edgeBucket(e?.edgeProbability), e)
    bump(byOddsBucketMap, oddsBucket(e?.odds), e)
  }

  const wins = entries.filter((e) => e?.result === "win").length
  const losses = entries.filter((e) => e?.result === "loss").length
  const decided = wins + losses
  const overallHit = decided > 0 ? wins / decided : 0.5

  return {
    ok: Boolean(raw),
    dateKey,
    filePath,
    totals: { totalBets: entries.length, wins, losses, decided, hitRate: overallHit },
    learning: {
      byPropType: finalize(byPropTypeMap),
      byEdgeBucket: finalize(byEdgeBucketMap),
      byOddsBucket: finalize(byOddsBucketMap),
    },
    overallHit,
  }
}

function __mlbLearningMultiplier(row, learningPack) {
  const learning = learningPack?.learning
  let m = 1

  // Selection prior only (not model scoring): long + money is structurally noisy.
  const american = Number(row?.odds)
  if (Number.isFinite(american) && american >= 600) m *= 0.94
  else if (Number.isFinite(american) && american >= 400) m *= 0.955

  if (!learning || typeof learning !== "object") return Math.min(1.06, Math.max(0.94, m))

  const ptKey = (() => {
    const s = String(row?.propType || "").trim()
    if (s === "Home Runs") return "HR"
    if (s === "Hits") return "Hits"
    if (s === "Total Bases") return "TB"
    if (s === "RBIs") return "RBI"
    return "unknown"
  })()

  const edgeKey = (() => {
    const e = Number(row?.edgeProbability)
    if (!Number.isFinite(e)) return "unknown"
    if (e < 0.1) return "0-0.1"
    if (e < 0.2) return "0.1-0.2"
    if (e < 0.3) return "0.2-0.3"
    if (e < 0.4) return "0.3-0.4"
    return "0.4+"
  })()

  const oddsKey = (() => {
    const o = Number(row?.odds)
    if (!Number.isFinite(o) || o === 0) return "unknown"
    if (o < 0) {
      if (o >= -110) return "fav_-110_to_-101"
      if (o >= -150) return "fav_-150_to_-111"
      if (o >= -250) return "fav_-250_to_-151"
      return "fav_-250+"
    }
    if (o <= 120) return "plus_+1_to_+120"
    if (o <= 200) return "plus_+121_to_+200"
    if (o <= 400) return "plus_+201_to_+400"
    return "plus_+401+"
  })()

  const bucketHit = (obj, key) => {
    const b = obj?.[key]
    const decidedLocal = (b?.wins || 0) + (b?.losses || 0)
    if (!b || decidedLocal < 3) return null
    return Number(b.hitRate || 0)
  }

  const baseline = Number(learningPack.overallHit || 0.5)

  const ptHit = bucketHit(learning.byPropType, ptKey)
  if (ptHit != null) {
    if (ptHit < baseline - 0.05) m *= 0.96
    else if (ptHit > baseline + 0.05) m *= 1.04
  }

  const edgeHit = bucketHit(learning.byEdgeBucket, edgeKey)
  if (edgeHit != null) {
    if (edgeHit < baseline - 0.05) m *= 0.97
    else if (edgeHit > baseline + 0.05) m *= 1.03
  }

  const oddsHit = bucketHit(learning.byOddsBucket, oddsKey)
  if (oddsHit != null) {
    if (oddsKey === "plus_+401+" && oddsHit < baseline) m *= 0.95
    else if (oddsHit < baseline - 0.05) m *= 0.98
    else if (oddsHit > baseline + 0.05) m *= 1.02
  }

  return Math.min(1.06, Math.max(0.94, m))
}

/**
 * Apply tracked-bucket learning as small multipliers on the rows that actually ship
 * as `best` / `finalPlayableRows` (same shapes as API `tracking.learning` buckets).
 * Logs one line every request for grep-friendly ops visibility.
 */
function __mlbApplyLearningToFinalBoardRows(rowArrays, learningPack, primaryResortIndex = 0) {
  const seen = new WeakSet()
  const boosted = {}
  const reduced = {}
  let neutral = 0
  let touched = 0

  for (const arr of rowArrays) {
    if (!Array.isArray(arr)) continue
    for (const row of arr) {
      if (!row || seen.has(row)) continue
      seen.add(row)
      touched += 1
      const mul = __mlbLearningMultiplier(row, learningPack)
      const before = Number(row.mlbPhase3Score || 0)
      row.mlbPhase3Score = before * mul
      if (Number.isFinite(Number(row?.score))) {
        row.score = Number(row.score) * mul
      }
      const label = `${String(row?.propType || "").trim()}|${Number(row?.odds)}`
      if (mul > 1.001) boosted[label] = (boosted[label] || 0) + 1
      else if (mul < 0.999) reduced[label] = (reduced[label] || 0) + 1
      else neutral += 1
    }
  }

  const primary = rowArrays[primaryResortIndex]
  if (Array.isArray(primary) && primary.length > 1) {
    primary.sort((a, b) => Number(b?.mlbPhase3Score || 0) - Number(a?.mlbPhase3Score || 0))
  }

  console.log(
    "[MLB ADJUSTMENT] " +
      JSON.stringify({
        boosted,
        reduced,
        neutral,
        touched,
        decided: learningPack?.totals?.decided ?? null,
        baselineHit: learningPack?.overallHit ?? null,
        filePath: learningPack?.filePath ?? null,
      }),
  )
}

function buildMlbLiveDualBestAvailablePayload() {
  const rows = Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows : []
  console.log("[MLB PIPELINE TRACE]", { stage: "rawProps", count: rows.length })
  const learningPack = __mlbReadTrackedBestLearning()
  const clusters = buildMlbClusters(rows)
  // === MLB adjustment layer (must always run) ===
  // Inserted directly before Phase 3 best selection so it is guaranteed in the MLB request path.
  console.log("[MLB ADJUSTMENT HIT]")
  try {
    // No guards: run even with missing/minimal learning data.
    __mlbApplyLearningToFinalBoardRows(
      [clusters?.hits, clusters?.hr, clusters?.tb, clusters?.rbi],
      learningPack && typeof learningPack === "object" ? learningPack : {},
      0
    )
  } catch (e) {
    console.log("[MLB ADJUSTMENT ERROR]", e?.message || e)
  }
  for (const k of ["hits", "hr", "tb", "rbi"]) {
    if (Array.isArray(clusters?.[k])) {
      clusters[k].sort((a, b) => Number(b?.mlbPhase3Score || 0) - Number(a?.mlbPhase3Score || 0))
    }
  }
  console.log("[MLB PIPELINE TRACE]", {
    stage: "after_scoring",
    count:
      (Array.isArray(clusters?.hits) ? clusters.hits.length : 0) +
      (Array.isArray(clusters?.hr) ? clusters.hr.length : 0) +
      (Array.isArray(clusters?.tb) ? clusters.tb.length : 0) +
      (Array.isArray(clusters?.rbi) ? clusters.rbi.length : 0),
    buckets: {
      hits: Array.isArray(clusters?.hits) ? clusters.hits.length : 0,
      hr: Array.isArray(clusters?.hr) ? clusters.hr.length : 0,
      tb: Array.isArray(clusters?.tb) ? clusters.tb.length : 0,
      rbi: Array.isArray(clusters?.rbi) ? clusters.rbi.length : 0,
    },
  })

  const dedupeMlbLegs = (rowsToDedupe) => {
    const safeRows = Array.isArray(rowsToDedupe) ? rowsToDedupe : []
    const seen = new Set()
    const out = []
    for (const row of safeRows) {
      if (!row) continue
      const key = [
        String(row?.eventId || row?.matchup || ""),
        String(row?.player || ""),
        String(row?.propType || ""),
        String(row?.side || ""),
        String(row?.line ?? ""),
        String(row?.odds ?? ""),
        String(row?.book || ""),
        String(row?.marketKey || ""),
        String(row?.propVariant || "base")
      ].join("|")
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
    return out
  }

  // MLB compatibility: downstream bucket/slip builders assume NBA fields (hitRate/edge/score).
  // For MLB we use Phase 3 `mlbPhase3Score` and treat NBA-only fields as optional.
  console.log("[MLB FINAL FILTER MODE]", {
    using: "mlbPhase3Score",
    skippedHitRateChecks: true
  })

  const __mlbSortByPhase3 = (list) => {
    const safe = Array.isArray(list) ? list.filter(Boolean) : []
    return safe.sort((a, b) => Number(b?.mlbPhase3Score || 0) - Number(a?.mlbPhase3Score || 0))
  }

  const buildMlbMixedBestAvailableBuckets = (rowsPool, { thinSlateMode = true } = {}) => {
    const pool = dedupeMlbLegs(__mlbSortByPhase3(rowsPool))
    if (!pool.length) return { safe: null, balanced: null, aggressive: null, lotto: null }

    const pickLegs = (filterFn, n) => dedupeMlbLegs(pool.filter(filterFn)).slice(0, n)
    const odds = (r) => Number(r?.odds)

    // Keep the return shape identical to the generic builder: { safe, balanced, aggressive, lotto }.
    // No hitRate/edge/score floors; use odds ranges + `mlbPhase3Score` ordering.
    const safeLegs = pickLegs((r) => {
      const o = odds(r)
      return Number.isFinite(o) && o < 0 && o >= -220 && o <= -102
    }, 4)

    const balancedLegs = pickLegs((r) => {
      const o = odds(r)
      return Number.isFinite(o) && o >= -160 && o <= 220
    }, 4)

    const aggressiveLegs = pickLegs((r) => {
      const o = odds(r)
      return Number.isFinite(o) && o >= 150 && o < 400
    }, 5)

    const lottoLegs = pickLegs((r) => {
      const o = odds(r)
      return Number.isFinite(o) && o >= 400
    }, 6)

    const out = {
      safe: safeLegs.length >= 3 ? { book: "MLB", tag: "safe", legs: safeLegs } : null,
      balanced: balancedLegs.length >= 3 ? { book: "MLB", tag: "balanced", legs: balancedLegs } : null,
      aggressive: aggressiveLegs.length >= 3 ? { book: "MLB", tag: "aggressive", legs: aggressiveLegs } : null,
      lotto: lottoLegs.length >= 3 ? { book: "MLB", tag: "lotto", legs: lottoLegs } : null,
    }
    // Never return all-null buckets when we have a real pool.
    if (!out.safe && !out.balanced && !out.aggressive && !out.lotto && pool.length >= 3) {
      out.balanced = { book: "MLB", tag: "balanced", legs: pool.slice(0, 4) }
    }
    return out
  }

  const buildMlbTopPhase3BookSlip = (book, targetLegCount, sourceRows) => {
    const pool = Array.isArray(sourceRows) ? sourceRows : []
    const ranked = dedupeSlipLegs(__mlbSortByPhase3(pool.filter((r) => r?.book === book)))
    if (!ranked.length) return null

    const out = []
    const usedPlayers = new Set()
    for (const row of ranked) {
      if (!row || shouldRemoveLegForPlayerStatus(row)) continue
      const player = String(row.player || row.playerName || "")
      if (!player) continue
      if (usedPlayers.has(player)) continue
      if (hasConflict(out, row)) continue
      out.push(row)
      usedPlayers.add(player)
      if (out.length >= targetLegCount) break
    }
    return out.length === targetLegCount ? out : null
  }

  const fallbackBestPropsLogic = (rowList) => {
    const raw = Array.isArray(rowList) ? rowList : []
    const eligibleFallback = raw.filter(
      (r) =>
        r &&
        String(r.player || "").trim() &&
        String(r.propType || "").trim() &&
        String(r.propType).trim() !== "0" &&
        Number.isFinite(Number(r.odds))
    )
    const rowScore = (r) => Number(r?.score ?? r?.decisionScore ?? r?.edge ?? 0)
    const stamped = eligibleFallback.map((row) => {
      const { score, confidence, category } = scoreMlbProp(row)
      return {
        ...row,
        mlbPhase3Score: score,
        mlbPhase3Confidence: confidence,
        mlbPhase3Category: category || "unknown"
      }
    })
    stamped.sort((a, b) => {
      const pa = Number(a.mlbPhase3Score || 0)
      const pb = Number(b.mlbPhase3Score || 0)
      if (pb !== pa) return pb - pa
      return rowScore(b) - rowScore(a)
    })
    return dedupeMlbLegs(stamped).slice(0, 120)
  }

  const phase3Best = buildMlbBestProps(rows, clusters)

  console.log("[MLB PHASE 3]", {
    rows: rows.length,
    best: phase3Best.length
  })

  const eligible = rows.filter(
    (r) =>
      r &&
      String(r.player || "").trim() &&
      String(r.propType || "").trim() &&
      String(r.propType).trim() !== "0" &&
      Number.isFinite(Number(r.odds))
  )
  console.log("[MLB PIPELINE TRACE]", { stage: "after_filters", count: eligible.length })

  const MLB_COVERAGE_PROP_TYPES = ["Hits", "Home Runs", "Total Bases", "RBIs"]
  const mlbPropCoverage = MLB_COVERAGE_PROP_TYPES.reduce((acc, pt) => {
    acc[pt] = eligible.filter((r) => String(r.propType) === pt).length
    return acc
  }, {})
  console.log("[MLB BEST-AVAILABLE PROP COVERAGE]", {
    rowsTotal: rows.length,
    eligible: eligible.length,
    ...mlbPropCoverage
  })

  const finalPlayableRows =
    Array.isArray(phase3Best) && phase3Best.length > 0 ? phase3Best : fallbackBestPropsLogic(rows)

  console.log("[MLB FINAL SOURCE]", {
    using: phase3Best.length > 0 ? "phase3" : "fallback",
    count: finalPlayableRows.length
  })
  console.log("[MLB PIPELINE TRACE]", {
    stage: "bestProps",
    phase3Best: Array.isArray(phase3Best) ? phase3Best.length : 0,
    finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : 0,
  })

  // Apply learning BEFORE mixed-board selection so it can change membership (not just reorder output).
  __mlbApplyLearningToFinalBoardRows([finalPlayableRows], learningPack, 0)

  // Phase 3 post-processing: build a balanced MLB board that doesn't collapse
  // into only safe/low-variance unders.
  const safeLaneBase = Array.isArray(phase3Best) && phase3Best.length > 0
    ? phase3Best
    : finalPlayableRows
  const safeLane = dedupeMlbLegs(
    (Array.isArray(safeLaneBase) ? safeLaneBase : [])
      .filter(Boolean)
      .sort((a, b) => Number(b?.mlbPhase3Score || 0) - Number(a?.mlbPhase3Score || 0))
  )

  const upsideCandidates = dedupeMlbLegs(
    (Array.isArray(finalPlayableRows) ? finalPlayableRows : [])
      .filter((row) => {
        if (!row) return false
        const propType = String(row?.propType || "").trim()
        const odds = Number(row?.odds)
        const category = String(row?.mlbPhase3Category || "").toLowerCase()
        if (propType === "Home Runs" || propType === "Total Bases") return true
        if (Number.isFinite(odds) && odds >= 150) return true
        if (category === "hr") return true
        return false
      })
      .sort((a, b) => {
        const aEdge = Number(a?.edgeProbability || 0)
        const bEdge = Number(b?.edgeProbability || 0)
        const aSignal = Number(a?.signalScore || 0)
        const bSignal = Number(b?.signalScore || 0)
        const aPhase3 = Number(a?.mlbPhase3Score || 0)
        const bPhase3 = Number(b?.mlbPhase3Score || 0)
        return (bEdge + bSignal + bPhase3) - (aEdge + aSignal + aPhase3)
      })
  )

  const buildMlbMixedBoard = (safeRows, upsideRows, { totalTarget = 40 } = {}) => {
    const safe = Array.isArray(safeRows) ? safeRows : []
    const upside = Array.isArray(upsideRows) ? upsideRows : []

    const target = Math.max(10, Math.min(120, Number(totalTarget) || 40))
    const minOvers = Math.max(0, Math.ceil(target * 0.3))
    const minHrTb = Math.max(0, Math.ceil(target * 0.25))
    const maxHeavyJuiceUnders = Math.max(0, Math.floor(target * 0.4))

    const normalizeSide = (row) => String(row?.side || "").trim().toLowerCase()
    const normalizePropType = (row) => String(row?.propType || "").trim()
    const oddsValue = (row) => Number(row?.odds)

    const isOver = (row) => normalizeSide(row) === "over"
    const isUnder = (row) => normalizeSide(row) === "under"
    const isHeavyJuice = (row) => {
      const o = oddsValue(row)
      return Number.isFinite(o) && o < -200
    }
    const isHrTb = (row) => {
      const pt = normalizePropType(row)
      return pt === "Home Runs" || pt === "Total Bases"
    }
    const isDownweightedUnderType = (row) => {
      if (!isUnder(row)) return false
      const pt = normalizePropType(row)
      return pt === "RBIs" || pt === "Hits"
    }

    const adjustedScore = (row) => {
      const edge = Number(row?.edgeProbability || 0)
      const signal = Number(row?.signalScore || 0)
      const phase3 = Number(row?.mlbPhase3Score || 0)
      let s = edge + signal + phase3

      // DOWNWEIGHT
      if (isHeavyJuice(row)) s -= 1.2
      if (isDownweightedUnderType(row)) s -= 0.8
      const o = oddsValue(row)
      // Additional selection shaping: reduce extreme longshots so they don't dominate final boards.
      if (Number.isFinite(o) && o >= 600) s -= 1.3
      else if (Number.isFinite(o) && o >= 400) s -= 0.9

      // UPWEIGHT
      if (isHrTb(row)) s += 1.0
      if (Number.isFinite(o) && o >= 120 && o < 400) s += 0.5
      if (isOver(row)) s += 0.4

      return s
    }

    const rankedSafe = [...safe].sort((a, b) => adjustedScore(b) - adjustedScore(a))
    const rankedUpside = [...upside].sort((a, b) => adjustedScore(b) - adjustedScore(a))
    const mergedRanked = dedupeMlbLegs([...rankedSafe, ...rankedUpside]).sort((a, b) => adjustedScore(b) - adjustedScore(a))

    const out = []
    const takeIf = (row, counters) => {
      if (!row) return false
      const next = dedupeMlbLegs([...out, row])
      if (next.length === out.length) return false

      const side = normalizeSide(row)
      const isRowHeavyJuiceUnder = isHeavyJuice(row) && side === "under"
      if (isRowHeavyJuiceUnder && counters.heavyJuiceUnders >= maxHeavyJuiceUnders) return false

      out.push(row)
      if (side === "over") counters.overs += 1
      if (side === "under") counters.unders += 1
      if (isHrTb(row)) counters.hrTb += 1
      if (isRowHeavyJuiceUnder) counters.heavyJuiceUnders += 1
      return true
    }

    const counters = { overs: 0, unders: 0, hrTb: 0, heavyJuiceUnders: 0 }

    // 1) Ensure HR/TB quota (upside)
    for (const row of mergedRanked) {
      if (out.length >= target) break
      if (!isHrTb(row)) continue
      takeIf(row, counters)
      if (counters.hrTb >= minHrTb) break
    }

    // 2) Ensure overs quota (prefer overs from upside)
    for (const row of mergedRanked) {
      if (out.length >= target) break
      if (!isOver(row)) continue
      takeIf(row, counters)
      if (counters.overs >= minOvers) break
    }

    // 3) Fill remaining with best adjustedScore under heavy-juice-under cap
    for (const row of mergedRanked) {
      if (out.length >= target) break
      takeIf(row, counters)
    }

    const deduped = dedupeMlbLegs(out).slice(0, target)

    // HARD RULE: never return all unders (when `side` exists on rows).
    const withSide = deduped.filter((r) => String(r?.side || "").trim())
    const overCount = withSide.filter((r) => String(r?.side || "").toLowerCase() === "over").length
    if (withSide.length > 0 && overCount === 0) {
      const oversFromMerged = mergedRanked.filter((r) => String(r?.side || "").toLowerCase() === "over")
      if (oversFromMerged.length > 0) {
        return dedupeMlbLegs([...deduped, oversFromMerged[0]]).slice(0, target)
      }
    }

    return deduped
  }

  const mixedBest = buildMlbMixedBoard(safeLane, upsideCandidates, { totalTarget: 40 })
  const sideRows = Array.isArray(mixedBest) ? mixedBest.filter((r) => String(r?.side || "").trim()) : []
  const overCount = sideRows.filter((r) => String(r?.side || "").toLowerCase() === "over").length
  const underCount = sideRows.filter((r) => String(r?.side || "").toLowerCase() === "under").length
  console.log("[MLB MIX]", {
    safeCount: safeLane.length,
    upsideCount: upsideCandidates.length,
    overCount,
    underCount
  })

  console.log("[MLB BEST TRACE]", {
    rows: Array.isArray(rows) ? rows.length : -1,
    clusters: {
      hits: Array.isArray(clusters?.hits) ? clusters.hits.length : -1,
      hr: Array.isArray(clusters?.hr) ? clusters.hr.length : -1,
      tb: Array.isArray(clusters?.tb) ? clusters.tb.length : -1,
      rbi: Array.isArray(clusters?.rbi) ? clusters.rbi.length : -1
    },
    phase3Best: Array.isArray(phase3Best) ? phase3Best.length : -1,
    finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : -1,
    safeLane: Array.isArray(safeLane) ? safeLane.length : -1,
    upsideCandidates: Array.isArray(upsideCandidates) ? upsideCandidates.length : -1,
    mixedBest: Array.isArray(mixedBest) ? mixedBest.length : -1
  })

  const best = Array.isArray(mixedBest) && mixedBest.length > 0
    ? mixedBest
    : (Array.isArray(finalPlayableRows) ? finalPlayableRows : [])
  console.log("[MLB BEST TRACE] afterBestAssign", {
    best: Array.isArray(best) ? best.length : -1
  })

  const safeBest = Array.isArray(best) ? best : []

  const countBook = (book) => eligible.filter((r) => r?.book === book).length

  const availableCounts = {
    elite: { total: 0, fanduel: 0, draftkings: 0 },
    strong: { total: 0, fanduel: 0, draftkings: 0 },
    playable: {
      total: eligible.length,
      fanduel: countBook("FanDuel"),
      draftkings: countBook("DraftKings")
    },
    flex: { total: 0, fanduel: 0, draftkings: 0 },
    best: {
      total: best.length,
      fanduel: best.filter((r) => r?.book === "FanDuel").length,
      draftkings: best.filter((r) => r?.book === "DraftKings").length
    }
  }

  const flex = []

  // === MLB boards (hitRate-free): use Phase 3 score + odds distribution ===
  const __mlbBoardPoolBase = Array.isArray(finalPlayableRows) && finalPlayableRows.length
    ? finalPlayableRows
    : (Array.isArray(phase3Best) && phase3Best.length ? phase3Best : safeBest)

  const __mlbBoardPool = dedupeMlbLegs((Array.isArray(__mlbBoardPoolBase) ? __mlbBoardPoolBase : []).filter(Boolean))
    .filter((r) =>
      r &&
      String(r?.player || "").trim() &&
      String(r?.propType || "").trim() &&
      Number.isFinite(Number(r?.odds)) &&
      Number.isFinite(Number(r?.mlbPhase3Score))
    )
    .sort((a, b) => Number(b?.mlbPhase3Score || 0) - Number(a?.mlbPhase3Score || 0))

  const __mlbOnePerPlayer = (rowsIn) => {
    const rows = Array.isArray(rowsIn) ? rowsIn : []
    const used = new Set()
    const out = []
    for (const r of rows) {
      const p = String(r?.player || "").trim().toLowerCase()
      if (!p) continue
      if (used.has(p)) continue
      used.add(p)
      out.push(r)
    }
    return out
  }

  const __mlbFill = (target, primaryFilter, fallbackPool) => {
    const primary = __mlbOnePerPlayer(__mlbBoardPool.filter(primaryFilter))
    const base = primary.slice(0, target)
    if (base.length >= target) return base
    const need = target - base.length
    const fallback = __mlbOnePerPlayer((Array.isArray(fallbackPool) ? fallbackPool : __mlbBoardPool))
      .filter((r) => !base.some((x) => String(x?.player || "").trim().toLowerCase() === String(r?.player || "").trim().toLowerCase()))
      .slice(0, need)
    return base.concat(fallback)
  }

  const N = __mlbBoardPool.length
  const sizeSafe = Math.max(1, Math.round(N * 0.28))
  const sizeBalanced = Math.max(1, Math.round(N * 0.28))
  const sizeAggressive = Math.max(1, Math.round(N * 0.24))
  const sizeLotto = Math.max(1, Math.max(0, N - (sizeSafe + sizeBalanced + sizeAggressive)))

  const odds = (r) => Number(r?.odds)
  let safe = __mlbFill(
    sizeSafe,
    (r) => {
      const o = odds(r)
      return Number.isFinite(o) && (o < 0 || o < 200)
    },
    __mlbBoardPool
  )

  const remainingAfterSafe = __mlbBoardPool.filter((r) => !safe.some((x) => String(x?.player || "").trim().toLowerCase() === String(r?.player || "").trim().toLowerCase()))
  let balanced = __mlbOnePerPlayer(remainingAfterSafe.filter((r) => {
    const o = odds(r)
    return Number.isFinite(o) && o >= -180 && o <= 350
  })).slice(0, sizeBalanced)
  if (!balanced.length) balanced = __mlbOnePerPlayer(remainingAfterSafe).slice(0, sizeBalanced)

  const usedPlayersAgg = new Set([...safe, ...balanced].map((r) => String(r?.player || "").trim().toLowerCase()))
  const remainingAfterBalanced = __mlbBoardPool.filter((r) => !usedPlayersAgg.has(String(r?.player || "").trim().toLowerCase()))
  let aggressive = __mlbOnePerPlayer(remainingAfterBalanced.filter((r) => {
    const o = odds(r)
    return Number.isFinite(o) && o >= 200 && o < 400
  })).slice(0, sizeAggressive)
  if (!aggressive.length) aggressive = __mlbOnePerPlayer(remainingAfterBalanced).slice(0, sizeAggressive)

  const usedPlayersLotto = new Set([...safe, ...balanced, ...aggressive].map((r) => String(r?.player || "").trim().toLowerCase()))
  const remainingAfterAggressive = __mlbBoardPool.filter((r) => !usedPlayersLotto.has(String(r?.player || "").trim().toLowerCase()))
  let lotto = __mlbOnePerPlayer(remainingAfterAggressive.filter((r) => {
    const o = odds(r)
    return Number.isFinite(o) && o >= 400
  })).slice(0, Math.max(1, sizeLotto))
  if (!lotto.length) lotto = __mlbOnePerPlayer(remainingAfterAggressive).slice(0, Math.max(1, sizeLotto))

  // Guarantee: if best > 0, no board is empty.
  if (safeBest.length > 0) {
    if (!safe.length) safe = __mlbOnePerPlayer(__mlbBoardPool).slice(0, 1)
    if (!balanced.length) balanced = __mlbOnePerPlayer(__mlbBoardPool.filter((r) => !safe.includes(r))).slice(0, 1)
    if (!aggressive.length) aggressive = __mlbOnePerPlayer(__mlbBoardPool.filter((r) => !safe.includes(r) && !balanced.includes(r))).slice(0, 1)
    if (!lotto.length) lotto = __mlbOnePerPlayer(__mlbBoardPool.filter((r) => !safe.includes(r) && !balanced.includes(r) && !aggressive.includes(r))).slice(0, 1)
  }

  console.log("[MLB BOARD BUILT]", {
    safe: safe.length,
    balanced: balanced.length,
    aggressive: aggressive.length,
    lotto: lotto.length
  })

  console.log("[MODEL REBALANCE ACTIVE]", {
    bias: "probability-first",
    longshotReduced: true
  })

  console.log("[SOFT BIAS ACTIVE]", {
    mode: "realistic selection",
    rigidRulesRemoved: true
  })

  // === MLB auto parlay generation (board-only; no ingest/scoring/learning changes) ===
  const buildMlbAutoParlays = ({ allRows: bAllRows }) => {
    console.log("[PROBABILITY TIERS ACTIVE]")
    console.log("[SOFT LINE BIAS TUNED]")
    console.log("[FOUNDATION BOOST ACTIVE]")
    console.log("[FOUNDATION FINAL TUNE]")
    console.log("[PLAYER DIVERSITY ACTIVE]")

    const toLeg = (r) => ({
      player: r?.player ?? null,
      team: r?.team ?? null,
      propType: r?.propType ?? null,
      line: r?.line ?? null,
      odds: r?.odds ?? null,
    })

    const impliedFromAmerican = (o) => {
      const odds = Number(o)
      if (!Number.isFinite(odds) || odds === 0) return null
      if (odds > 0) return 100 / (odds + 100)
      return Math.abs(odds) / (Math.abs(odds) + 100)
    }

    const americanFromProbability = (p) => {
      const prob = Number(p)
      if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null
      if (prob >= 0.5) return Math.round((-prob / (1 - prob)) * 100)
      return Math.round(((1 - prob) / prob) * 100)
    }

    const estimateParlayOdds = (legs) => {
      const probs = (Array.isArray(legs) ? legs : [])
        .map((l) => impliedFromAmerican(l?.odds))
        .filter((p) => Number.isFinite(p) && p > 0 && p < 1)
      if (!probs.length) return null
      const p = probs.reduce((acc, v) => acc * v, 1)
      return americanFromProbability(p)
    }

    const startMs = (r) => {
      const raw =
        r?.eventStartTime ||
        r?.commenceTime ||
        r?.startTime ||
        r?.gameTime ||
        r?.eventTime ||
        null
      const t = raw ? new Date(raw).getTime() : NaN
      return Number.isFinite(t) ? t : null
    }

    const windowKey = (r) => {
      const ms = startMs(r)
      if (!Number.isFinite(ms)) return "unknown"
      const d = new Date(ms)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, "0")
      const dd = String(d.getDate()).padStart(2, "0")
      const h = d.getHours()
      const slot = h < 16 ? "early" : (h < 19 ? "mid" : "late")
      return `${yyyy}-${mm}-${dd}:${slot}`
    }

    const propPriority = (row) => {
      const pt = String(row?.propType || "").trim()
      // MLB: consistency first (hits > TB > RBI > HR)
      if (pt === "Hits") return 4
      if (pt === "Total Bases") return 3
      if (pt === "RBIs") return 2
      if (pt === "Home Runs") return 1
      return 0
    }

    const likelihoodScore = (row) => {
      const pred = Number(row?.predictedProbability)
      if (Number.isFinite(pred) && pred > 0 && pred < 1) return pred
      // Fallback: implied from odds (lower payout => higher implied probability)
      const p = impliedFromAmerican(row?.odds)
      return Number.isFinite(p) ? p : 0
    }

    const mlbRowLine = (row) => {
      const line = Number(row?.line)
      return Number.isFinite(line) ? line : NaN
    }

    const isMlbStrongLineupSpot = (row) => {
      const bo = Number(row?.battingOrderIndex ?? row?.lineupSpot ?? row?.battingOrder ?? NaN)
      if (Number.isFinite(bo) && bo >= 1 && bo <= 5) return true
      const sig = Number(row?.signalScore)
      if (Number.isFinite(sig) && sig >= 0.56) return true
      const pred = Number(row?.predictedProbability)
      if (Number.isFinite(pred) && pred >= 0.56) return true
      return false
    }

    /**
     * True probability tiers (hitter overs):
     * foundation — 1+ hit (line 0.5), TB 1.5, RBI 0.5 in a strong lineup spot
     * support — Hits 1.5, RBI 1.5, TB 2.5
     * upside — HR, high lines, extreme plus money
     */
    const getMlbProbabilityTier = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      const over = side !== "under"
      const o = Number(row?.odds)

      if (pt === "Home Runs") return "upside"
      if (Number.isFinite(o) && o >= 450) return "upside"

      if (!over) {
        if (pt === "Total Bases" && Number.isFinite(line) && line >= 3) return "upside"
        return "support"
      }

      if (pt === "Hits") {
        if (!Number.isFinite(line)) return "support"
        if (line < 1.0) return "foundation"
        if (line < 2.25) return "support"
        return "upside"
      }

      if (pt === "Total Bases") {
        if (!Number.isFinite(line)) return "support"
        if (line <= 1.5) return "foundation"
        if (line < 3.5) return "support"
        return "upside"
      }

      if (pt === "RBIs") {
        if (!Number.isFinite(line)) return "support"
        if (line <= 0.5) return isMlbStrongLineupSpot(row) ? "foundation" : "support"
        if (line < 2.25) return "support"
        return "upside"
      }

      const p = likelihoodScore(row)
      if (Number.isFinite(p) && p >= 0.72 && Number.isFinite(o) && o < 280) return "foundation"
      return "support"
    }

    const isMlbMediumHitsSupportRow = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      return pt === "Hits" && Number.isFinite(line) && line >= 1.0 && line < 2.25
    }

    const isMlbMidLineRbiRow = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      if (side === "under") return false
      return pt === "RBIs" && Number.isFinite(line) && line >= 1.0 && line < 2.25
    }

    const isMlbMidLineTbRow = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      if (side === "under") return false
      return pt === "Total Bases" && Number.isFinite(line) && line >= 2.25 && line < 3.5
    }

    const isMlbMidLineCountingRow = (row) =>
      isMlbMediumHitsSupportRow(row) || isMlbMidLineRbiRow(row) || isMlbMidLineTbRow(row)

    const sortSupportRowsForStacking = (supports, chosenRows) => {
      const chosen = Array.isArray(chosenRows) ? chosenRows : []
      if (!chosen.some(isMlbMidLineCountingRow)) return supports
      return [...supports].sort((a, b) => {
        const aMid = isMlbMidLineCountingRow(a)
        const bMid = isMlbMidLineCountingRow(b)
        if (aMid === bMid) return 0
        return aMid ? 1 : -1
      })
    }

    const propVolatilityPenalty = (row) => {
      const pt = String(row?.propType || "").trim()
      if (pt === "Home Runs") return 0.05
      if (pt === "RBIs") return 0.02
      return 0
    }

    const oddsVolatilityPenalty = (row) => {
      const o = Number(row?.odds)
      if (!Number.isFinite(o)) return 0
      if (o >= 600) return 0.05
      if (o >= 400) return 0.03
      if (o >= 250) return 0.015
      return 0
    }

    const lowLineBonus = (row) => {
      const line = mlbRowLine(row)
      if (!Number.isFinite(line)) return 0
      const pt = String(row?.propType || "").trim()
      // Gentle preference aligned with probability tiers (never blocks).
      if (pt === "Hits") {
        if (line < 1.0) return 0.064
        if (line < 2.25) return 0.002
        return 0
      }
      if (pt === "Total Bases") {
        if (line <= 1.5) return 0.06
        if (line <= 2.5) return 0.004
        if (line < 3.5) return 0.001
        return 0
      }
      if (pt === "RBIs") {
        if (line <= 0.5) return isMlbStrongLineupSpot(row) ? 0.026 : 0.01
        if (line < 2.25) return 0.001
        return 0
      }
      if (pt === "Home Runs") return line <= 0.5 ? 0.005 : 0
      return 0
    }

    /**
     * Final-selection-only soft line difficulty (never blocks).
     * Penalties shrink when model signal / likelihood is strong so high lines can still rank up.
     */
    const lineSignalBlendForSoftBias = (row) => {
      let m = likelihoodScore(row)
      const pred = Number(row?.predictedProbability)
      const sig = Number(row?.signalScore)
      const edge = Number(row?.edgeProbability ?? row?.edge)
      if (Number.isFinite(pred) && pred > 0 && pred < 1) m = Math.max(m, pred)
      if (Number.isFinite(sig) && sig >= 0 && sig <= 1) m = Math.max(m, sig)
      if (Number.isFinite(edge) && edge > 0 && edge < 1) m = Math.max(m, edge * 0.85)
      return Math.min(1, Math.max(0, m))
    }

    const softLineDifficultyBias = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      if (side === "under") return 0

      let adj = 0
      if (pt === "Hits" && Number.isFinite(line)) {
        if (line < 1.0) adj += 0.025
        if (line >= 1.5) adj -= Math.min(0.024, 0.009 + (line - 1.5) * 0.023)
      } else if (pt === "Total Bases" && Number.isFinite(line)) {
        if (line <= 1.5) adj += 0.023
        if (line >= 2.5 && line < 3.5) adj -= 0.006
        if (line >= 3.5) adj -= Math.min(0.02, 0.009 + (line - 3.5) * 0.006)
      } else if (pt === "RBIs" && Number.isFinite(line)) {
        if (line <= 0.5) adj += 0.009
        if (line >= 1.5) adj -= Math.min(0.022, 0.008 + (line - 1.5) * 0.018)
      } else if (pt === "Home Runs" && Number.isFinite(line) && line > 0.5) {
        adj -= Math.min(0.012, (line - 0.5) * 0.012)
      }

      if (adj < 0) {
        const blend = lineSignalBlendForSoftBias(row)
        adj *= 1 - 0.68 * blend
      }
      return adj
    }

    /** Higher = easier line; used only when softMetric scores are within a tight band (no blocks). */
    const mlbLineTieNudge = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      if (side === "under" || !Number.isFinite(line)) return 0
      if (pt === "Hits") {
        if (line < 1.0) return 0.132 - line * 0.048
        if (line >= 1.5) return -0.062 - (line - 1.5) * 0.052
        return -0.024 - (line - 1.0) * 0.065
      }
      if (pt === "Total Bases") {
        if (line <= 1.5) return 0.112 - line * 0.024
        if (line < 3.5) return -0.02 - (line - 1.5) * 0.028
        return -0.09 - (line - 3.5) * 0.025
      }
      if (pt === "RBIs") {
        if (line <= 0.5) return 0.09 - line * 0.06
        if (line >= 1.5) return -0.06 - (line - 1.5) * 0.045
        return -0.015 - (line - 0.5) * 0.05
      }
      if (pt === "Home Runs") return line <= 0.5 ? 0.04 : -0.04 - (line - 0.5) * 0.06
      return 0
    }

    const realismPenalty = (row) => {
      // Soft check: if we have any "typical" stat fields, avoid extreme lines for the player.
      const line = Number(row?.line)
      const avg =
        Number(row?.avg) ||
        Number(row?.seasonAvg) ||
        Number(row?.statAvg) ||
        Number(row?.projection) ||
        Number(row?.projectedStat) ||
        NaN
      if (!Number.isFinite(line) || !Number.isFinite(avg) || avg <= 0) return 0
      const side = String(row?.side || "").toLowerCase()
      const over = side === "over"
      const ratio = line / avg
      if (over && ratio >= 1.9) return 0.06
      if (over && ratio >= 1.6) return 0.03
      return 0
    }

    const foundationConsistencyBonus = (row) => {
      if (getMlbProbabilityTier(row) !== "foundation") return 0
      let b = 0
      const hr = Number(row?.hitRate)
      if (Number.isFinite(hr) && hr >= 0.56) b += 0.0045
      const sig = Number(row?.signalScore)
      if (Number.isFinite(sig) && sig >= 0.52) b += 0.004
      const pred = Number(row?.predictedProbability)
      if (Number.isFinite(pred) && pred >= 0.58) b += 0.0035
      const recent = row?.recentHitRate ?? row?.l5HitRate ?? row?.last5HitRate
      const r = Number(recent)
      if (Number.isFinite(r) && r >= 0.52) b += 0.003
      return Math.min(0.02, b)
    }

    const softMetric = (row) => {
      const tier = getMlbProbabilityTier(row)
      const tierBoost =
        tier === "foundation" ? 0.037 :
        tier === "support" ? -0.0065 :
        tier === "upside" ? -0.006 :
        0
      return (
        likelihoodScore(row) +
        (propPriority(row) * 0.01) +
        lowLineBonus(row) +
        tierBoost +
        foundationConsistencyBonus(row) +
        softLineDifficultyBias(row) -
        realismPenalty(row) -
        propVolatilityPenalty(row) -
        oddsVolatilityPenalty(row)
      )
    }

    /**
     * Truth-list score: predictedProbability-first when present, plus consistency + realistic lines.
     */
    const topPlayTruthScore = (row) => {
      if (!row) return -1
      const predRaw = Number(row?.predictedProbability)
      const hasModelPred = Number.isFinite(predRaw) && predRaw > 0 && predRaw < 1
      const like = likelihoodScore(row)
      const soft = softMetric(row)
      let lineBoost = 0
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      const over = side !== "under"
      if (over) {
        if (pt === "Hits" && Number.isFinite(line) && line < 1) lineBoost += 0.095
        if (pt === "Total Bases" && Number.isFinite(line) && line <= 1.5) lineBoost += 0.088
        if (pt === "RBIs" && Number.isFinite(line) && line <= 0.5 && isMlbStrongLineupSpot(row)) lineBoost += 0.075
        if (pt === "RBIs" && Number.isFinite(line) && line <= 0.5 && !isMlbStrongLineupSpot(row)) lineBoost -= 0.042
        if (pt === "Hits" && Number.isFinite(line) && line >= 1.5) lineBoost -= 0.062
        if (pt === "RBIs" && Number.isFinite(line) && line >= 1.5) lineBoost -= 0.058
        if (pt === "Total Bases" && Number.isFinite(line) && line >= 3.5) lineBoost -= 0.062
      }
      const hr = Number(row?.hitRate)
      const consistency =
        Number.isFinite(hr) && hr >= 0.56 ? 0.048 : Number.isFinite(hr) && hr >= 0.52 ? 0.024 : 0
      const recent = Number(row?.recentHitRate ?? row?.l5HitRate ?? row?.last5HitRate)
      const recentBump =
        Number.isFinite(recent) && recent >= 0.58 ? 0.022 : Number.isFinite(recent) && recent >= 0.52 ? 0.011 : 0
      const o = Number(row?.odds)
      const extremePlusMoney =
        Number.isFinite(o) && o >= 550 ? -0.07 : Number.isFinite(o) && o >= 420 ? -0.035 : 0

      // Top plays should be likely AND bettable. Do not block extreme odds; just down-rank them.
      // Preference band: -150 to +300. Soft penalties: worse than -500; strong penalties: worse than -1000.
      let bettableAdj = 0
      if (Number.isFinite(o)) {
        if (o <= -1000) bettableAdj -= 0.42
        else if (o <= -500) bettableAdj -= 0.16
        else if (o >= -150 && o <= 300) bettableAdj += 0.028
        else if (o >= 301 && o <= 420) bettableAdj += 0.01
      }

      // Value engine: model probability vs odds-implied probability.
      const implied = impliedFromAmerican(o)
      const edge = Number(row?.edgeProbability ?? row?.edge ?? NaN)
      let modelP = hasModelPred ? predRaw : like
      if (!hasModelPred && Number.isFinite(implied) && Number.isFinite(edge)) {
        modelP = Math.max(0.01, Math.min(0.99, implied + edge))
      }
      const valueScore =
        Number.isFinite(implied) && Number.isFinite(modelP) ? (modelP - implied) : 0
      const valueAdj = Math.max(-0.08, Math.min(0.10, valueScore * 0.7))

      // Target odds band: prefer -120 to +200. Allow safer (-200) if signal is strong.
      let targetBandAdj = 0
      if (Number.isFinite(o)) {
        if (o >= -120 && o <= 200) targetBandAdj += 0.028
        else if (o >= -200 && o < -120) targetBandAdj += 0.012
        else if (o > 200 && o <= 320) targetBandAdj += 0.006
      }

      // Avoid over-prioritizing heavy favorites without clear advantage.
      let heavyFavAdj = 0
      if (Number.isFinite(o) && o <= -300) {
        if (valueScore < 0.015) heavyFavAdj -= 0.11
        else if (valueScore < 0.03) heavyFavAdj -= 0.05
      }

      const gcb = Number(row?.gameContextBoost)
      const gameAdj = Number.isFinite(gcb) ? Math.max(-0.04, Math.min(0.04, gcb)) : 0

      // Opportunity + role layer (Top Plays only): prefer meaningful lineup roles and impact profiles.
      const lineupPosRaw = Number(row?.lineupPosition ?? row?.battingOrderIndex ?? row?.lineupSpot)
      let lineupTier = "unknown"
      if (Number.isFinite(lineupPosRaw) && lineupPosRaw >= 1 && lineupPosRaw <= 9) {
        if (lineupPosRaw <= 3) lineupTier = "top"
        else if (lineupPosRaw <= 6) lineupTier = "middle"
        else lineupTier = "bottom"
      } else {
        // Approximate role when lineup is missing: use strong-signal/importance proxies.
        const sig = Number(row?.signalScore)
        const hr = Number(row?.hitRate)
        const p3 = Number(row?.mlbPhase3Score)
        const strong = isMlbStrongLineupSpot(row) || (Number.isFinite(hr) && hr >= 0.56) || (Number.isFinite(sig) && sig >= 0.58) || (Number.isFinite(p3) && p3 >= 78)
        const elite = (hasModelPred && predRaw >= 0.64) || (Number.isFinite(sig) && sig >= 0.64) || (Number.isFinite(p3) && p3 >= 86)
        lineupTier = elite ? "top" : strong ? "middle" : "bottom"
      }

      let roleAdj = 0
      if (lineupTier === "top") roleAdj += 0.03
      else if (lineupTier === "middle") roleAdj += 0.015
      else if (lineupTier === "bottom") roleAdj -= 0.02

      let productionAdj = 0
      const sig = Number(row?.signalScore)
      const p3 = Number(row?.mlbPhase3Score)
      if (pt === "Home Runs") productionAdj += 0.012
      if (pt === "RBIs") productionAdj += 0.008
      if (Number.isFinite(sig) && sig >= 0.58) productionAdj += 0.012
      else if (Number.isFinite(sig) && sig >= 0.52) productionAdj += 0.006
      if (Number.isFinite(p3) && p3 >= 80) productionAdj += 0.009
      else if (Number.isFinite(p3) && p3 >= 72) productionAdj += 0.004
      if (Number.isFinite(sig) && sig < 0.45 && Number.isFinite(p3) && p3 < 58) productionAdj -= 0.012

      // Amplify role when game environment is strong; soften it when game environment is weak.
      const env = Number.isFinite(gameAdj) ? gameAdj : 0
      const amplify = env > 0 ? (1 + env * 10) : (1 + env * 6) // env is already clamped [-0.04, 0.04]
      const opportunityAdj = (roleAdj * amplify) + (productionAdj * (env > 0 ? 1.15 : 1.0))

      const probBlend = hasModelPred ? like * 0.84 + soft * 0.12 : like * 0.62 + soft * 0.24
      return (
        probBlend +
        lineBoost +
        consistency +
        recentBump +
        extremePlusMoney +
        bettableAdj +
        valueAdj +
        targetBandAdj +
        heavyFavAdj +
        gameAdj +
        opportunityAdj
      )
    }

    const rowIdentityKey = (r) =>
      [
        String(r?.player || "").trim().toLowerCase(),
        String(r?.propType || "").trim(),
        String(r?.line ?? ""),
        String(r?.book || "").trim(),
        String(r?.side || "").trim(),
      ].join("|")

    const pickDiverseTopPlays = (sortedDesc, maxTake) => {
      const pool = [...sortedDesc]
      const out = []
      const usedPlayers = new Set()
      const teamCounts = new Map()
      const teamKey = (r) => String(r?.team || "").trim().toLowerCase() || "unknown"

      while (out.length < maxTake && pool.length) {
        let bestI = -1
        let bestAdj = -Infinity
        for (let i = 0; i < pool.length; i++) {
          const r = pool[i]
          const pk = String(r?.player || "").trim().toLowerCase()
          if (!pk || usedPlayers.has(pk)) continue
          const tk = teamKey(r)
          const tc = teamCounts.get(tk) || 0
          const adj = topPlayTruthScore(r) - tc * 0.017 - Math.max(0, tc - 2) * 0.012
          if (adj > bestAdj) {
            bestAdj = adj
            bestI = i
          }
        }
        if (bestI < 0) break
        const r = pool.splice(bestI, 1)[0]
        const pk = String(r?.player || "").trim().toLowerCase()
        usedPlayers.add(pk)
        const tk = teamKey(r)
        teamCounts.set(tk, (teamCounts.get(tk) || 0) + 1)
        out.push(r)
      }
      out.sort((a, b) => topPlayTruthScore(b) - topPlayTruthScore(a))
      return out
    }

    const gameKeyForRow = (r) => String(r?.eventId || r?.gameId || r?.matchup || "").trim() || "unknown"
    const safeNum = (v) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0))

    const buildGameContextMap = (rowsIn) => {
      const rows = Array.isArray(rowsIn) ? rowsIn : []
      const byGame = new Map()

      const push = (gk, teamKey, row) => {
        if (!byGame.has(gk)) {
          byGame.set(gk, {
            teams: new Map(),
            gameTotals: [],
            moneylines: [],
          })
        }
        const g = byGame.get(gk)
        const teamK = teamKey || "unknown"
        if (!g.teams.has(teamK)) g.teams.set(teamK, { implied: [], recentRuns: [] })
        const t = g.teams.get(teamK)

        const itt = safeNum(row?.impliedTeamTotal ?? row?.teamImpliedTotal ?? row?.impliedTeamRuns ?? row?.teamTotal)
        if (Number.isFinite(itt)) t.implied.push(itt)

        const gt = safeNum(row?.gameTotal)
        if (Number.isFinite(gt)) g.gameTotals.push(gt)

        const ml = safeNum(row?.moneylineOdds ?? row?.teamMoneylineOdds ?? row?.moneylineHomeOdds ?? row?.moneylineAwayOdds)
        if (Number.isFinite(ml)) g.moneylines.push(ml)

        const rr =
          safeNum(row?.teamRecentRunsAvg) ??
          safeNum(row?.recentTeamRunsAvg) ??
          safeNum(row?.teamRunsL5) ??
          safeNum(row?.teamRunsLast5) ??
          safeNum(row?.l5Runs) ??
          safeNum(row?.last5Runs)
        if (Number.isFinite(rr)) t.recentRuns.push(rr)
      }

      for (const r of rows) {
        if (!r) continue
        const gk = gameKeyForRow(r)
        const teamK = String(r?.team || r?.teamResolved || "").trim().toLowerCase()
        push(gk, teamK, r)
      }

      const mean = (vals) => {
        const v = (Array.isArray(vals) ? vals : []).filter((n) => Number.isFinite(n))
        if (!v.length) return null
        return v.reduce((a, b) => a + b, 0) / v.length
      }

      const out = new Map()
      for (const [gk, g] of byGame.entries()) {
        const gt = mean(g.gameTotals)
        const ml = mean(g.moneylines)
        const teamBoost = new Map()
        for (const [tk, t] of g.teams.entries()) {
          const itt = mean(t.implied)
          const rr = mean(t.recentRuns)

          // Very conservative: small bounded nudges only.
          let b = 0
          if (Number.isFinite(itt)) {
            // Typical MLB team implied totals cluster ~3.5–5.5. Favor higher environments.
            const normalized = clamp01((itt - 3.6) / 2.0) // 0 at 3.6, 1 at 5.6+
            b += (normalized - 0.5) * 0.05 // [-0.025, +0.025]
          }
          if (Number.isFinite(gt)) {
            const high = clamp01((gt - 7.5) / 3.0) // 0 at 7.5, 1 at 10.5+
            b += (high - 0.5) * 0.02 // [-0.01, +0.01]
          }
          if (Number.isFinite(ml)) {
            // Being a favorite is a mild positive environment signal.
            if (ml < -140) b += 0.006
            else if (ml > 140) b -= 0.004
          }
          if (Number.isFinite(rr)) {
            const hot = clamp01((rr - 3.8) / 2.2) // 0 at 3.8, 1 at 6.0+
            b += (hot - 0.5) * 0.02 // [-0.01, +0.01]
          }
          teamBoost.set(tk || "unknown", Math.max(-0.04, Math.min(0.04, b)))
        }

        out.set(gk, { teamBoost })
      }
      return out
    }

    /** Full eligible slate → truth-ranked list (15–25 when possible), one row per player, team spread. */
    const buildTopPlaysFromAllRows = (rowsIn) => {
      const byKey = new Map()
      const ctx = buildGameContextMap(rowsIn)
      console.log("[GAME CONTEXT ACTIVE]")
      for (const r of Array.isArray(rowsIn) ? rowsIn : []) {
        if (!r) continue
        if (!String(r?.player || "").trim() || !String(r?.propType || "").trim()) continue
        const gk = gameKeyForRow(r)
        const tk = String(r?.team || r?.teamResolved || "").trim().toLowerCase() || "unknown"
        const gameContextBoost = ctx.get(gk)?.teamBoost?.get?.(tk) ?? 0
        const rowWithContext = gameContextBoost ? { ...r, gameContextBoost } : { ...r, gameContextBoost: 0 }
        const k = rowIdentityKey(r)
        const prev = byKey.get(k)
        if (!prev || topPlayTruthScore(rowWithContext) > topPlayTruthScore(prev)) byKey.set(k, rowWithContext)
      }
      const merged = [...byKey.values()]
      merged.sort((a, b) => topPlayTruthScore(b) - topPlayTruthScore(a))
      const n = merged.length
      const maxTake = n >= 25 ? 25 : n
      return pickDiverseTopPlays(merged, maxTake)
    }

    /** Cross-core-ticket reuse (soft). Extremely strong rows keep most of their score. */
    const globalCorePlayerCounts = new Map()

    const isExtremeCoreReuseSignal = (row) => {
      const b = lineSignalBlendForSoftBias(row)
      const p3 = Number(row?.mlbPhase3Score || 0)
      const e = Number(row?.edgeProbability ?? row?.edge ?? 0)
      return b >= 0.82 || p3 >= 80 || (Number.isFinite(e) && e >= 0.32)
    }

    const corePlayerCrossTicketPenalty = (row) => {
      const pk = String(row?.player || "").trim().toLowerCase()
      if (!pk) return 0
      const n = Number(globalCorePlayerCounts.get(pk) || 0)
      if (n <= 0) return 0
      if (isExtremeCoreReuseSignal(row)) return n * 0.008
      return n * 0.036
    }

    const softMetricCoreDiverse = (row) => softMetric(row) - corePlayerCrossTicketPenalty(row)

    const rankByScore = (rows, scoreRow = softMetric) =>
      (Array.isArray(rows) ? rows : [])
        .filter(Boolean)
        .sort((a, b) => {
          // Priority: likelihood > value > payout (soft)
          const la = scoreRow(a)
          const lb = scoreRow(b)
          const diff = lb - la
          const closeBand = 0.03
          if (Math.abs(diff) >= closeBand) return diff
          const nudge = mlbLineTieNudge(b) - mlbLineTieNudge(a)
          if (Math.abs(nudge) > 1e-12) return nudge
          if (diff !== 0) return diff
          const ea = Number(a?.edgeProbability ?? a?.edge ?? 0)
          const eb = Number(b?.edgeProbability ?? b?.edge ?? 0)
          if (eb !== ea) return eb - ea
          const sa = Number(a?.mlbPhase3Score || 0)
          const sb = Number(b?.mlbPhase3Score || 0)
          if (sb !== sa) return sb - sa
          // Prefer lower payout last (higher implied prob)
          return Number(a?.odds ?? 0) - Number(b?.odds ?? 0)
        })

    const bestWindow = (rows) => {
      const counts = new Map()
      for (const r of Array.isArray(rows) ? rows : []) {
        const k = windowKey(r)
        counts.set(k, (counts.get(k) || 0) + 1)
      }
      let bestK = "unknown"
      let bestC = -1
      for (const [k, c] of counts.entries()) {
        if (c > bestC) {
          bestC = c
          bestK = k
        }
      }
      return bestK
    }

    const pickTicket = (rowsIn, {
      minLegs,
      maxLegs,
      sameStatOnly = false,
      allowMultiHr = false,
      preferDifferentTeams = false,
      diversityBias = false,
      diversityTolerance = 0.04,
      playerDiversityCore = false,
    } = {}) => {
      const rowScore = playerDiversityCore ? softMetricCoreDiverse : softMetric
      const rowsRanked = rankByScore(rowsIn, rowScore)
      if (!rowsRanked.length) return null

      const win = bestWindow(rowsRanked)
      const sameWindowFirst = rowsRanked.filter((r) => windowKey(r) === win)
      // Prefer same window for cashout convenience, but do not sacrifice role balance.
      const poolPreferred = sameWindowFirst.length >= minLegs ? sameWindowFirst : rowsRanked
      const pool = poolPreferred

      const usedPlayers = new Set()
      const usedPropTypes = new Set()
      const usedTeams = new Set()
      const out = []

      const legIsMidLineRisk = (leg) => {
        const rowLike = {
          propType: leg?.propType,
          line: leg?.line,
          side: "over",
        }
        return isMlbMidLineCountingRow(rowLike)
      }

      const canAdd = (r) => {
        if (!r) return false
        const player = String(r?.player || "").trim().toLowerCase()
        if (!player) return false
        if (usedPlayers.has(player)) return false

        const pt = String(r?.propType || "").trim()
        if (sameStatOnly && out.length > 0) {
          const base = String(out[0]?.propType || "").trim()
          if (pt !== base) return false
        }
        if (!allowMultiHr && pt === "Home Runs" && usedPropTypes.has("Home Runs")) return false

        const team = String(r?.team || "").trim().toLowerCase()
        if (preferDifferentTeams && team && usedTeams.has(team)) return false
        return true
      }

      const tryAdd = (r) => {
        if (!r) return false
        const player = String(r?.player || "").trim().toLowerCase()
        if (!player) return false
        if (usedPlayers.has(player)) return false

        const pt = String(r?.propType || "").trim()
        if (sameStatOnly && out.length > 0) {
          const base = String(out[0]?.propType || "").trim()
          if (pt !== base) return false
        }
        if (!allowMultiHr && pt === "Home Runs" && usedPropTypes.has("Home Runs")) return false

        const team = String(r?.team || "").trim().toLowerCase()
        if (preferDifferentTeams && team && usedTeams.has(team)) return false

        out.push(toLeg(r))
        usedPlayers.add(player)
        if (pt) usedPropTypes.add(pt)
        if (team) usedTeams.add(team)
        return true
      }

      // First pass: prefer prop-type variety when close in quality (soft bias, not a hard rule).
      // (Never applied to sameStatOnly fun tickets.)
      const remaining = [...pool]
      while (out.length < maxLegs && remaining.length) {
        let bestIdx = -1
        let bestSc = -Infinity
        let bestReuse = Infinity
        for (let i = 0; i < remaining.length; i++) {
          if (!canAdd(remaining[i])) continue
          const sc = rowScore(remaining[i])
          if (!playerDiversityCore) {
            bestIdx = i
            bestSc = sc
            break
          }
          const pk = String(remaining[i]?.player || "").trim().toLowerCase()
          const reuse = pk ? Number(globalCorePlayerCounts.get(pk) || 0) : 0
          if (sc > bestSc + 1e-9) {
            bestSc = sc
            bestIdx = i
            bestReuse = reuse
          } else if (Math.abs(sc - bestSc) < 0.019 && reuse < bestReuse) {
            bestIdx = i
            bestReuse = reuse
          }
        }
        if (bestIdx === -1) break

        const bestRow = remaining[bestIdx]
        const bestMetric = rowScore(bestRow)
        const bestPt = String(bestRow?.propType || "").trim()

        let chosenRow = bestRow
        if (diversityBias && !sameStatOnly && out.length > 0 && bestPt && usedPropTypes.has(bestPt)) {
          // Look for a near-equal candidate with a different prop type.
          for (let j = 0; j < Math.min(30, remaining.length); j++) {
            const cand = remaining[j]
            const candPt = String(cand?.propType || "").trim()
            if (!candPt || candPt === bestPt) continue
            if (usedPropTypes.has(candPt)) continue
            const m = rowScore(cand)
            const lp = likelihoodScore(cand)
            const lb = likelihoodScore(bestRow)
            const closeInLikelihood = Number.isFinite(lp) && Number.isFinite(lb) ? (lp >= lb - 0.02) : false
            if (m >= bestMetric - diversityTolerance || closeInLikelihood) {
              chosenRow = cand
              break
            }
          }
        }

        // Soft mid-line spread: if a ticket already has a mid-risk line, prefer a foundation / non-mid leg when close in score (no blocks).
        if (diversityBias && !sameStatOnly && out.length > 0 && out.some(legIsMidLineRisk) && isMlbMidLineCountingRow(chosenRow)) {
          const blendChosen = lineSignalBlendForSoftBias(chosenRow)
          const tol = 0.056 + 0.068 * blendChosen
          for (let j = 0; j < Math.min(52, remaining.length); j++) {
            const cand = remaining[j]
            if (!canAdd(cand)) continue
            if (isMlbMidLineCountingRow(cand)) continue
            const m = rowScore(cand)
            const tier = getMlbProbabilityTier(cand)
            if (tier === "foundation" && m >= bestMetric - tol - 0.006) {
              chosenRow = cand
              break
            }
            if (tier !== "foundation" && m >= bestMetric - tol) {
              chosenRow = cand
              break
            }
          }
        }

        // Actually add the chosen row (may still fail; if it does, discard it and continue).
        if (!canAdd(chosenRow) || !tryAdd(chosenRow)) {
          remaining.splice(bestIdx, 1)
          continue
        }

        // Remove the chosen row from remaining.
        const removeIdx = remaining.indexOf(chosenRow)
        if (removeIdx >= 0) remaining.splice(removeIdx, 1)

        if (out.length >= minLegs && (!diversityBias || sameStatOnly || usedPropTypes.size >= Math.min(3, out.length))) {
          break
        }
      }

      // Second pass: fill remaining.
      for (const r of pool) {
        if (out.length >= maxLegs) break
        tryAdd(r)
      }

      if (out.length < minLegs) return null
      const legs = out.slice(0, maxLegs)
      return { legs, estimatedOdds: estimateParlayOdds(legs) }
    }

    // Ticket construction logic: role-based, stacking-aware (soft; never blocks globally).
    const pickTicketWithRoles = (rowsIn, { minLegs, maxLegs, playerDiversityCore = false } = {}) => {
      const rowScore = playerDiversityCore ? softMetricCoreDiverse : softMetric
      const rowsRanked = rankByScore(rowsIn, rowScore)
      if (!rowsRanked.length) return null

      const win = bestWindow(rowsRanked)
      const sameWindowFirst = rowsRanked.filter((r) => windowKey(r) === win)
      // Prefer same window for cashout convenience, but do not sacrifice role balance.
      const poolPreferred = sameWindowFirst.length >= minLegs ? sameWindowFirst : rowsRanked
      const pool = poolPreferred

      const usedPlayers = new Set()
      const propCounts = new Map()
      const outRows = []

      const roleOf = (row) => {
        const tier = getMlbProbabilityTier(row)
        if (tier === "foundation") return "FOUNDATION"
        if (tier === "upside") return "UPSIDE"
        return "SUPPORT"
      }

      const canUse = (row) => {
        const player = String(row?.player || "").trim().toLowerCase()
        if (!player || usedPlayers.has(player)) return false
        return true
      }

      const add = (row) => {
        if (!row || !canUse(row)) return false
        const pt = String(row?.propType || "").trim() || "unknown"
        const count = propCounts.get(pt) || 0

        // Stack control is soft-only: probability tiers + support row ordering (no hard blocks).

        outRows.push(row)
        usedPlayers.add(String(row?.player || "").trim().toLowerCase())
        propCounts.set(pt, count + 1)
        return true
      }

      const sortBucketByRowScore = (arr) =>
        [...(Array.isArray(arr) ? arr : [])].sort((a, b) => rowScore(b) - rowScore(a))

      const target = Math.max(minLegs || 2, Math.min(maxLegs || 4, maxLegs || 4))
      const bucketsFrom = (list) => ({
        foundations: list.filter((r) => roleOf(r) === "FOUNDATION"),
        supports: list.filter((r) => roleOf(r) === "SUPPORT"),
        upsides: list.filter((r) => roleOf(r) === "UPSIDE"),
      })

      let { foundations, supports, upsides } = bucketsFrom(poolPreferred)
      // If the preferred window pool is too one-dimensional, fall back to the full ranked pool for roles.
      if (foundations.length < 1 || supports.length < 1) {
        ;({ foundations, supports, upsides } = bucketsFrom(rowsRanked))
      }

      if (playerDiversityCore) {
        foundations = sortBucketByRowScore(foundations)
        supports = sortBucketByRowScore(supports)
        upsides = sortBucketByRowScore(upsides)
      }

      supports = sortSupportRowsForStacking(supports, outRows)

      // CORE role targets:
      // - 1–2 FOUNDATION
      // - 0–1 SUPPORT
      // - 0–1 UPSIDE
      const wantFoundation = Math.min(2, Math.max(1, target >= 3 ? 2 : 1))
      const wantSupport = target >= 3 ? 1 : 0
      const wantUpside = target >= 3 ? 1 : 0

      // 1) Foundations (if missing, allow SUPPORT as fallback foundation — soft).
      for (const r of foundations) {
        if (outRows.length >= wantFoundation) break
        add(r)
      }
      if (outRows.length < wantFoundation) {
        for (const r of supports) {
          if (outRows.length >= wantFoundation) break
          add(r)
        }
      }

      // 2) Optional support (prefer different prop type than existing when close).
      if (wantSupport && outRows.length < target) {
        supports = sortSupportRowsForStacking(supports, outRows)
        const usedTypes = new Set(outRows.map((r) => String(r?.propType || "").trim()))
        for (const r of supports) {
          const pt = String(r?.propType || "").trim()
          if (pt && usedTypes.has(pt)) continue
          if (add(r)) break
        }
      }

      // 3) Optional upside (one payout driver).
      if (wantUpside && outRows.length < target) {
        const usedTypes = new Set(outRows.map((r) => String(r?.propType || "").trim()))
        for (const r of upsides) {
          const pt = String(r?.propType || "").trim()
          if (pt && usedTypes.has(pt)) continue
          // Only skip if it's far below top quality; otherwise allow.
          const m = rowScore(r)
          const top = pool.length ? rowScore(pool[0]) : m
          if (m < top - 0.18) continue
          if (add(r)) break
        }
        if (outRows.length < target) {
          for (const r of upsides) {
            if (add(r)) break
          }
        }
      }

      // 4) Fill remaining (rare; still stacking-aware), preferring FOUNDATION > SUPPORT > UPSIDE.
      supports = sortSupportRowsForStacking(supports, outRows)
      for (const r of [...foundations, ...supports, ...upsides]) {
        if (outRows.length >= target) break
        add(r)
      }

      if (outRows.length < (minLegs || 2)) return null
      const legs = outRows.slice(0, maxLegs || outRows.length).map(toLeg)
      return { legs, estimatedOdds: estimateParlayOdds(legs) }
    }

    const core = []

    const topPlayRows = buildTopPlaysFromAllRows(bAllRows)
    const topPlays = topPlayRows.map((r) => ({
      player: r?.player ?? null,
      team: r?.team ?? null,
      propType: r?.propType ?? null,
      line: r?.line ?? null,
      odds: r?.odds ?? null,
    }))
    console.log("[BETTABLE FILTER ACTIVE]")
    console.log("[TOP PLAYS ACTIVE]", { count: topPlays.length })
    console.log("[VALUE ENGINE ACTIVE]", { sample: topPlays.slice(0, 5) })
    console.log("[OPPORTUNITY LAYER ACTIVE]", { sample: topPlays.slice(0, 5) })

    // CORE / FUN / LOTTO: tickets draw only from the Top Plays pool (same universe as the list).
    const corePoolRaw = rankByScore(topPlayRows)
    // Soft foundation: take top legs, but gently broaden prop-type coverage when quality is close.
    const safeCandidates = (() => {
      const out = []
      const usedPlayers = new Set()
      const propCounts = new Map()
      const topMetric = corePoolRaw.length ? softMetric(corePoolRaw[0]) : 0
      for (const r of corePoolRaw) {
        if (out.length >= 18) break
        const player = String(r?.player || "").trim().toLowerCase()
        if (!player || usedPlayers.has(player)) continue
        const pt = String(r?.propType || "").trim() || "unknown"
        const m = softMetric(r)
        const closeToTop = m >= topMetric - 0.06
        const count = propCounts.get(pt) || 0
        // Prefer introducing new prop types when close in quality.
        const prefer = closeToTop && count === 0
        if (prefer || out.length < 6) {
          out.push(r)
          usedPlayers.add(player)
          propCounts.set(pt, count + 1)
        } else if (closeToTop && count < 4) {
          out.push(r)
          usedPlayers.add(player)
          propCounts.set(pt, count + 1)
        }
      }
      return out.length ? rankByScore(out) : corePoolRaw.slice(0, 18)
    })()

    const rowIsTrueLowHitsOrTb15 = (row) => {
      const pt = String(row?.propType || "").trim()
      const line = mlbRowLine(row)
      const side = String(row?.side || "over").trim().toLowerCase()
      if (side === "under") return false
      if (pt === "Hits" && Number.isFinite(line) && line < 1.0) return true
      if (pt === "Total Bases" && Number.isFinite(line) && line <= 1.5) return true
      return false
    }

    const legIsTrueLowHitsOrTb15 = (leg) =>
      rowIsTrueLowHitsOrTb15({ propType: leg?.propType, line: leg?.line, side: "over" })

    const legIsMidLineCoreRisk = (leg) =>
      isMlbMidLineCountingRow({ propType: leg?.propType, line: leg?.line, side: "over" })

    const findCorePoolRowForLeg = (leg) => {
      const pk = String(leg?.player || "").trim().toLowerCase()
      const pt = String(leg?.propType || "").trim()
      const line = Number(leg?.line)
      return corePoolRaw.find((r) =>
        String(r?.player || "").trim().toLowerCase() === pk &&
        String(r?.propType || "").trim() === pt &&
        Number.isFinite(Number(r?.line)) &&
        Number.isFinite(line) &&
        Math.abs(Number(r?.line) - line) < 1e-6
      ) || null
    }

    /** Soft core-only: swap one mid-line leg for Hits 0.5 / TB 1.5 when similar softMetric (no blocks). */
    const softSwapOneMidLegForLowLineCore = (ticket) => {
      if (!ticket || !Array.isArray(ticket.legs) || ticket.legs.length < 2) return ticket
      const legs = ticket.legs.map((l) => ({ ...l }))
      const midIdxs = legs.map((l, i) => (legIsMidLineCoreRisk(l) ? i : -1)).filter((i) => i >= 0)
      if (!midIdxs.length) return ticket
      if (legs.some(legIsTrueLowHitsOrTb15)) return ticket

      const scoreTol = 0.068
      let victimIdx = -1
      let worst = Infinity
      for (const i of midIdxs) {
        const row = findCorePoolRowForLeg(legs[i])
        const m = row ? softMetric(row) : likelihoodScore({ odds: legs[i]?.odds })
        if (m < worst) {
          worst = m
          victimIdx = i
        }
      }
      if (victimIdx < 0) return ticket

      const victimRow = findCorePoolRowForLeg(legs[victimIdx])
      const victimMetric = victimRow ? softMetric(victimRow) : worst
      const pk = String(legs[victimIdx]?.player || "").trim().toLowerCase()

      const pickBest = (cands) =>
        (Array.isArray(cands) ? cands : [])
          .filter(Boolean)
          .sort((a, b) => softMetric(b) - softMetric(a))[0] || null

      let repl = pickBest(
        corePoolRaw.filter(
          (r) =>
            String(r?.player || "").trim().toLowerCase() === pk &&
            rowIsTrueLowHitsOrTb15(r) &&
            softMetric(r) >= victimMetric - scoreTol,
        ),
      )

      if (!repl && midIdxs.length >= 2) {
        const used = new Set(legs.map((l) => String(l?.player || "").trim().toLowerCase()).filter(Boolean))
        repl = pickBest(
          corePoolRaw.filter((r) => {
            const rpk = String(r?.player || "").trim().toLowerCase()
            if (!rpk || used.has(rpk)) return false
            return rowIsTrueLowHitsOrTb15(r) && softMetric(r) >= victimMetric - scoreTol - 0.014
          }),
        )
      }

      if (!repl) return ticket
      legs[victimIdx] = toLeg(repl)
      return { legs, estimatedOdds: estimateParlayOdds(legs) }
    }

    console.log("[MLB FOUNDATION POOL]", {
      count: safeCandidates.length
    })

    console.log("[VARIETY BIAS ACTIVE]", {
      diversityApplied: true
    })

    console.log("[TICKET LOGIC ACTIVE]", {
      stackingControlled: true
    })

    console.log("[ROLE ENGINE ACTIVE]", {
      rolesApplied: true
    })

    const recordTicketLegPlayersToCoreCounts = (ticket) => {
      for (const leg of ticket?.legs || []) {
        const pk = String(leg?.player || "").trim().toLowerCase()
        if (pk) globalCorePlayerCounts.set(pk, (globalCorePlayerCounts.get(pk) || 0) + 1)
      }
    }

    const rebuildGlobalCorePlayerCounts = () => {
      globalCorePlayerCounts.clear()
      for (const t of core) recordTicketLegPlayersToCoreCounts(t)
    }

    const pushCore = (t) => {
      if (!t) return
      core.push(t)
      recordTicketLegPlayersToCoreCounts(t)
    }

    const buildCoreTicketWithFoundation = ({ minLegs, maxLegs, foundationMin = 1 } = {}) => {
      if (!corePoolRaw.length) return null
      const base = []
      const usedPlayers = new Set()

      for (const r of safeCandidates) {
        if (base.length >= foundationMin) break
        const player = String(r?.player || "").trim().toLowerCase()
        if (!player || usedPlayers.has(player)) continue
        base.push(r)
        usedPlayers.add(player)
      }

      const fillPool = corePoolRaw.filter((r) => !usedPlayers.has(String(r?.player || "").trim().toLowerCase()))
      const ticket = pickTicket(fillPool, {
        minLegs: Math.max(0, minLegs - base.length),
        maxLegs: Math.max(0, maxLegs - base.length),
        allowMultiHr: true,
        playerDiversityCore: true,
      })
      const legs = [...base.map(toLeg), ...((ticket?.legs || []).slice(0, Math.max(0, maxLegs - base.length)))]
      if (legs.length < minLegs) return null
      return { legs: legs.slice(0, maxLegs), estimatedOdds: estimateParlayOdds(legs.slice(0, maxLegs)) }
    }

    // 2–3 legs (safe-ish)
    pushCore(
      pickTicketWithRoles(corePoolRaw, { minLegs: 2, maxLegs: 3, playerDiversityCore: true }) ||
        buildCoreTicketWithFoundation({ minLegs: 2, maxLegs: 3, foundationMin: 1 }) ||
        pickTicket(corePoolRaw, { minLegs: 2, maxLegs: 3, allowMultiHr: true, diversityBias: true, playerDiversityCore: true })
    )
    // 3–4 legs (balanced)
    pushCore(
      pickTicketWithRoles(corePoolRaw, { minLegs: 3, maxLegs: 4, playerDiversityCore: true }) ||
        buildCoreTicketWithFoundation({ minLegs: 3, maxLegs: 4, foundationMin: 2 }) ||
        pickTicket(corePoolRaw, { minLegs: 3, maxLegs: 4, allowMultiHr: true, diversityBias: true, playerDiversityCore: true })
    )
    if (core.length < 2) {
      pushCore(pickTicket(corePoolRaw, { minLegs: 2, maxLegs: 3, allowMultiHr: true, diversityBias: true, playerDiversityCore: true }))
      pushCore(pickTicket(corePoolRaw, { minLegs: 3, maxLegs: 4, allowMultiHr: true, diversityBias: true, playerDiversityCore: true }))
    }
    if (!core.length) {
      const wideCorePool = rankByScore(topPlayRows)
      pushCore(pickTicket(wideCorePool, { minLegs: 2, maxLegs: 3, allowMultiHr: true, diversityBias: true, playerDiversityCore: true }))
      pushCore(pickTicket(wideCorePool, { minLegs: 3, maxLegs: 4, allowMultiHr: true, diversityBias: true, playerDiversityCore: true }))
    }

    for (let ci = 0; ci < core.length; ci += 1) {
      const upgraded = softSwapOneMidLegForLowLineCore(core[ci])
      if (upgraded) core[ci] = upgraded
    }
    rebuildGlobalCorePlayerCounts()

    const fun = []
    const funPool = rankByScore(topPlayRows)
    const byPropType = (pt) => funPool.filter((r) => String(r?.propType || "").trim() === pt)

    // FUN: stat-pattern tickets (same stat only)
    const hrTicket = pickTicket(byPropType("Home Runs"), { minLegs: 2, maxLegs: 4, sameStatOnly: true, allowMultiHr: true, preferDifferentTeams: true })
    if (hrTicket) fun.push(hrTicket)
    const rbiTicket = pickTicket(byPropType("RBIs"), { minLegs: 3, maxLegs: 5, sameStatOnly: true, preferDifferentTeams: true })
    if (rbiTicket) fun.push(rbiTicket)
    const hitsTicket = pickTicket(byPropType("Hits"), { minLegs: 4, maxLegs: 6, sameStatOnly: true, preferDifferentTeams: true })
    if (hitsTicket) fun.push(hitsTicket)

    const lotto = []
    const lottoPool = rankByScore(topPlayRows, (r) => {
      const o = Number(r?.odds)
      const longNudge =
        Number.isFinite(o) && o >= 360 ? 0.045 : Number.isFinite(o) && o >= 280 ? 0.025 : 0
      return softMetric(r) + longNudge
    })

    const lotto3 = pickTicket(lottoPool, { minLegs: 3, maxLegs: 5, allowMultiHr: true })
    if (lotto3) lotto.push(lotto3)
    const lotto4 = pickTicket(lottoPool, { minLegs: 4, maxLegs: 5, allowMultiHr: true })
    if (lotto4) lotto.push(lotto4)

    // Reassign: anything with huge payout estimate should not sit in core.
    const coreKept = []
    const coreMoved = []
    for (const t of core) {
      const est = Number(t?.estimatedOdds)
      const legs = Array.isArray(t?.legs) ? t.legs : []
      const allLongshot = legs.length > 0 && legs.every((l) => Number(l?.odds) >= 400)
      if (Number.isFinite(est) && est > 5000 && allLongshot) coreMoved.push(t)
      else coreKept.push(t)
    }
    // Keep at least one core ticket to preserve structure on extreme slates.
    if (!coreKept.length && coreMoved.length) {
      coreMoved.sort((a, b) => Number(a?.estimatedOdds ?? 0) - Number(b?.estimatedOdds ?? 0))
      coreKept.push(coreMoved.shift())
    }
    for (const t of coreMoved) lotto.push(t)

    console.log("[MLB PARLAY ENGINE]", {
      core: coreKept.length,
      fun: fun.length,
      lotto: lotto.length
    })

    return { core: coreKept, fun, lotto, topPlays }
  }

  const parlays = buildMlbAutoParlays({ allRows: eligible })

  const dualBestPropsPoolBase = best.length ? best : eligible
  const dualBestPropsPool = buildBestPropVariantPool(dualBestPropsPoolBase)
  console.log("[MLB PIPELINE TRACE]", {
    stage: "final_boards",
    best: Array.isArray(safeBest) ? safeBest.length : 0,
    safe: Array.isArray(safe) ? safe.length : 0,
    balanced: Array.isArray(balanced) ? balanced.length : 0,
    aggressive: Array.isArray(aggressive) ? aggressive.length : 0,
    lotto: Array.isArray(lotto) ? lotto.length : 0,
  })
  const dualPoolDiagnostics = buildMlbDualPoolDiagnostics(eligible)
  const statLeaderboards = buildDualStatLeaderboards(eligible)

  const slipPool = dualBestPropsPool.length ? dualBestPropsPool : eligible
  const fdHighestHitRate2 =
    slipPool.length >= 2
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 2, slipPool), "Highest Hit Rate 2-Leg")
      : null
  const fdHighestHitRate3 =
    slipPool.length >= 3
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 3, slipPool), "Highest Hit Rate 3-Leg")
      : null
  const fdHighestHitRate4 =
    slipPool.length >= 4
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 4, slipPool), "Highest Hit Rate 4-Leg")
      : null
  const fdHighestHitRate5 =
    slipPool.length >= 5
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 5, slipPool), "Highest Hit Rate 5-Leg")
      : null
  const fdHighestHitRate6 =
    slipPool.length >= 6
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 6, slipPool), "Highest Hit Rate 6-Leg")
      : null
  const fdHighestHitRate7 =
    slipPool.length >= 7
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 7, slipPool), "Highest Hit Rate 7-Leg")
      : null
  const fdHighestHitRate8 =
    slipPool.length >= 8
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 8, slipPool), "Highest Hit Rate 8-Leg")
      : null
  const fdHighestHitRate9 =
    slipPool.length >= 9
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 9, slipPool), "Highest Hit Rate 9-Leg")
      : null
  const fdHighestHitRate10 =
    slipPool.length >= 10
      ? makeSlipObject("FanDuel", buildMlbTopPhase3BookSlip("FanDuel", 10, slipPool), "Highest Hit Rate 10-Leg")
      : null

  const dkHighestHitRate2 =
    slipPool.length >= 2
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 2, slipPool), "Highest Hit Rate 2-Leg")
      : null
  const dkHighestHitRate3 =
    slipPool.length >= 3
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 3, slipPool), "Highest Hit Rate 3-Leg")
      : null
  const dkHighestHitRate4 =
    slipPool.length >= 4
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 4, slipPool), "Highest Hit Rate 4-Leg")
      : null
  const dkHighestHitRate5 =
    slipPool.length >= 5
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 5, slipPool), "Highest Hit Rate 5-Leg")
      : null
  const dkHighestHitRate6 =
    slipPool.length >= 6
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 6, slipPool), "Highest Hit Rate 6-Leg")
      : null
  const dkHighestHitRate7 =
    slipPool.length >= 7
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 7, slipPool), "Highest Hit Rate 7-Leg")
      : null
  const dkHighestHitRate8 =
    slipPool.length >= 8
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 8, slipPool), "Highest Hit Rate 8-Leg")
      : null
  const dkHighestHitRate9 =
    slipPool.length >= 9
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 9, slipPool), "Highest Hit Rate 9-Leg")
      : null
  const dkHighestHitRate10 =
    slipPool.length >= 10
      ? makeSlipObject("DraftKings", buildMlbTopPhase3BookSlip("DraftKings", 10, slipPool), "Highest Hit Rate 10-Leg")
      : null

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

  const moneyMakerFd = buildMoneyMakerPortfolio("FanDuel", dualBestPropsPool)
  const moneyMakerDk = buildMoneyMakerPortfolio("DraftKings", dualBestPropsPool)

  console.log("[MLB BEST FIX]", {
    bestLength: safeBest.length,
    finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : 0
  })

  // Phase 4: tracking + validation (MLB only). Additive, never breaks payload.
  try {
    const tracking = recordMlbBestProps(safeBest)
    console.log("[MLB TRACKING]", tracking)
    const perf = evaluateMlbPerformance()
    console.log("[MLB PERFORMANCE]", perf)

    const picks = recordMlbDailyPicks(safeBest)
    console.log("[MLB PICKS]", picks)
    const picksEval = evaluateMlbPicks()
    console.log("[MLB PICKS EVAL]", picksEval)
  } catch (e) {
    console.log("[MLB TRACKING ERROR]", e?.message || e)
  }

  return {
    availableCounts,
    best: safeBest,
    safe,
    balanced,
    aggressive,
    lotto,
    parlays,
    topPlays: Array.isArray(parlays?.topPlays) ? parlays.topPlays : [],
    flexProps: flex,
    highestHitRate2: { fanduel: fdHighestHitRate2, draftkings: dkHighestHitRate2 },
    highestHitRate3: { fanduel: fdHighestHitRate3, draftkings: dkHighestHitRate3 },
    highestHitRate4: { fanduel: fdHighestHitRate4, draftkings: dkHighestHitRate4 },
    highestHitRate5: { fanduel: fdHighestHitRate5, draftkings: dkHighestHitRate5 },
    highestHitRate6: { fanduel: fdHighestHitRate6, draftkings: dkHighestHitRate6 },
    highestHitRate7: { fanduel: fdHighestHitRate7, draftkings: dkHighestHitRate7 },
    highestHitRate8: { fanduel: fdHighestHitRate8, draftkings: dkHighestHitRate8 },
    highestHitRate9: { fanduel: fdHighestHitRate9, draftkings: dkHighestHitRate9 },
    highestHitRate10: { fanduel: fdHighestHitRate10, draftkings: dkHighestHitRate10 },
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
    finalPlayableRows,
    clusters,
    diagnostics: {
      sportPipeline: "baseball_mlb",
      mlbPropCoverage,
      mlbPhase3Clusters: {
        hits: Array.isArray(clusters?.hits) ? clusters.hits.length : 0,
        hr: Array.isArray(clusters?.hr) ? clusters.hr.length : 0,
        tb: Array.isArray(clusters?.tb) ? clusters.tb.length : 0,
        rbi: Array.isArray(clusters?.rbi) ? clusters.rbi.length : 0
      },
      mlbSnapshot: {
        updatedAt: mlbSnapshot?.updatedAt || null,
        snapshotSlateDateKey: mlbSnapshot?.snapshotSlateDateKey || null,
        rowCount: rows.length,
        eligibleCount: eligible.length
      },
      rawCoverage: null,
      stageCounts: {
        mlbRowsTotal: rows.length,
        mlbEligibleRows: eligible.length,
        dualBestPropsPool: dualBestPropsPool.length
      },
      exclusionSummary: null,
      wideLeaderboards: null
    }
  }
}

function buildLiveDualBestAvailablePayload(options = {}) {
  const sportKey = normalizeBestAvailableSportKey(options?.sport ?? options?.sportKey)
  console.log("[SPORT PIPELINE]", sportKey)

  if (isMlbBestAvailableSportKey(sportKey)) {
    return buildMlbLiveDualBestAvailablePayload()
  }

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

  let poolSource = "strict"
  let combinedRows = getAvailablePrimarySlateRows(combinedPrimaryRows)

  // === Adaptive pool expansion (anti-starvation) ===
  // If strict availability/quality filters produce an empty pool, fall back to a
  // relaxed (but still sane) candidate set from the raw props pool.
  if (combinedRows.length === 0) {
    const rawProps = Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length
      ? oddsSnapshot.rawProps
      : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])

    let relaxedPool = (Array.isArray(rawProps) ? rawProps : []).filter((row) =>
      row &&
      row.marketValidity !== "invalid" &&
      row.odds != null
    )

    // Secondary safety filter: avoid broken odds / missing prop type.
    relaxedPool = relaxedPool.filter((row) =>
      Number(row?.odds) > -10000 &&
      row?.propType != null
    )

    // Prefer rows with model signals, but do not require both.
    relaxedPool.sort((a, b) => {
      const aScore = Number(a?.decisionScore || 0) + Number(a?.predictedProbability || 0)
      const bScore = Number(b?.decisionScore || 0) + Number(b?.predictedProbability || 0)
      return bScore - aScore
    })

    const relaxedTop = relaxedPool.slice(0, 100)
    combinedRows = getAvailablePrimarySlateRows(relaxedTop)
    poolSource = combinedRows.length > 0 ? "relaxed" : "strict"

    if (combinedRows.length === 0) {
      // Final fallback: take a small raw slice if everything else fails.
      const fallbackPool = (Array.isArray(rawProps) ? rawProps : []).slice(0, 50)
      combinedRows = getAvailablePrimarySlateRows(fallbackPool)
      if (combinedRows.length > 0) poolSource = "fallback"
    }

    console.log("[POOL-BUILD]", {
      raw: Array.isArray(rawProps) ? rawProps.length : 0,
      final: combinedRows.length,
      mode: poolSource
    })
  }

  console.log("[POST PRIMARY FILTER]", combinedRows.length)

  // Final fallback: if primary slate filtering still yields zero but we have raw props,
  // allow a degraded-but-valid pool so downstream best-available doesn't fully starve.
  const rawPropsFinalFallback = Array.isArray(oddsSnapshot?.rawProps) && oddsSnapshot.rawProps.length
    ? oddsSnapshot.rawProps
    : (Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props : [])

  if (combinedRows.length === 0 && rawPropsFinalFallback.length > 0) {
    console.log("[FINAL FALLBACK TRIGGERED]")
    combinedRows = rawPropsFinalFallback
      .filter((r) =>
        r &&
        r.marketValidity !== "invalid" &&
        r.odds != null &&
        r.propType != null
      )
      .slice(0, 100)
  }

  console.log("[FINAL ROW COUNT]", combinedRows.length)

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
  const thinSnapshotBestPropsMerge =
    !usingFallback &&
    snapshotBest.length > 0 &&
    snapshotBest.length < 6 &&
    Array.isArray(expandedEligibleRows) &&
    expandedEligibleRows.length > 0
  const fallbackMergeRows = thinSnapshotBestPropsMerge
    ? buildBestPropsFallbackRows(expandedEligibleRows, Math.min(60, expandedEligibleRows.length || 60))
    : []
  const best = usingFallback
    ? fallbackBest
    : thinSnapshotBestPropsMerge && fallbackMergeRows.length
      ? dedupeSlipLegs([...snapshotBest, ...fallbackMergeRows])
      : snapshotBest

  console.log("[PAYLOAD-DEBUG] best.length:", best.length)
  logPayloadDebugExclusions("bestProps→best", oddsSnapshot.bestProps || [], snapshotBest)
  console.log("[BEST-PROPS-FALLBACK-DEBUG]", {
    snapshotBest: snapshotBest.length,
    fallbackBest: fallbackBest.length,
    usingFallback,
    thinSnapshotBestPropsMerge: Boolean(thinSnapshotBestPropsMerge),
    fallbackMergeRows: fallbackMergeRows.length,
    mergedBest: best.length
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

/**
 * Snapshot of server module bindings required by `nbaBestAvailable.inlined.js` (compiled with `new Function`,
 * which does not close over this module). Keys must stay aligned with free identifiers in that slice.
 *
 * Every binding (except `bestAvailableSportKey`, which is per-request, and `oddsSnapshot`, passed as a
 * plain function argument each request) is exposed via a getter so `with (deps)` reads the current module value.
 */
const __NBA_BEST_AVAILABLE_BINDING_KEYS = "__dirname,adaptAvailabilitySignal,applyGameAndRoleEdge,attachNbaPregameExportFields,bestValueSortValue,buildBestLadders,buildBestPropsFallbackRows,buildBestSpecials,buildCanonicalSpecialtyPlayerTeamIndex,buildCuratedLayer2BucketsHelper,buildDecisionLayer,buildDecisionSummary,buildExpandedMarketPools,buildExternalEdgeOverlay,buildFeaturedPlays,buildFirstBasketBoard,buildGameEdgeMap,buildLiveDualBestAvailablePayload,buildMlbBetSelector,buildMlbCorrelationClusters,buildMlbDecisionBoard,buildMlbOomphEngine,buildMlbPropClusters,buildMlbSlipEngine,buildMlbSpikeEngine,buildMlbUpsideClusters,buildNbaEnrichmentLegLookup,buildNbaExportHydrationKey,buildNbaExportHydrationKeyPropType,buildNbaTeamByPlayerEventMap,buildNbaTeamByPlayerSingleEventMap,buildPlayerTeamIndex,buildPregameContext,buildSelectiveBoard,buildSlipSeedPool,buildSnapshotMeta,buildSpecialtyOutputs,clamp,classifyBoardRow,createSurfaceRowBuilder,decimalToAmerican,dedupeMarketRows,dedupeSlipLegs,detectSlateMode,enrichSpecialPredictionRow,fillNbaRowTeamFromPlayerEventMap,fillNbaRowTeamFromSingleEventMap,filterSpecialRowsForBoard,finalizeRuntimeExternalOverlay,fs,getAvailablePrimarySlateRows,getLadderVariantsForRow,getMlbTeamTokenSet,getOpponentForRow,highestHitRateSortValue,impliedProbabilityFromAmerican,inferPlayDecision,inferSurfaceTeamLabel,ingestNbaOfficialInjuryReport,ingestRotoWireSignals,isCorePropRow,isFirstBasketLikeRow,isFragileLeg,isLadderRow,isLottoStyleRow,isMilestoneLadderRow,isMlbHighUpsideRow,isSpecialButNotFirstBasketRow,isTeamFirstBasketRow,lastSnapshotSource,logBet,logSnapshotMeta,mergeNbaExportRowWithEnrichmentLookup,mlbCorrelationClusters,mlbOomphSlips,mlbOpeningOddsByLegKey,mlbPicks,mlbSlips,mlbSnapshot,mlbSpikePlayers,mlbUpsideClusters,normalizeNbaExportTeamForRow,normalizePlayerName,normalizePlayerStatusValue,normalizePropTypeBase,parseHitRate,parseMlbMatchupTeams,path,recoverNbaExportRowTeamAndVenue,resolveCanonicalPlayerTeamForRow,resolveMlbTeamFromDiskCacheRow,resolveTeamNameForRowFromCode,rowTeamMatchesMatchup,runCurrentSlateCoverageDiagnostics,saveTrackedSlateSnapshot,shouldRemoveLegForPlayerStatus,snapshotLoadedFromDisk,sortByAdjustedConfidence,sortByPredictionStrength,sortCorePropsBoard,sortFirstBasketBoard,sortLadderBoard,sortLottoBoard,sortSpecialBoard,sortSpecialBoardSmart,SPECIAL_MARKET_KEYS,SPECIAL_PROP_TYPE_NAMES,stripStaleNbaPregameFieldsForRebuild,toNumberOrNull,toPlayerKey,withNbaRowDataState".split(",")

function buildNbaBestAvailableRouteDeps(bestAvailableSportKey) {
  const d = {}
  d.bestAvailableSportKey = bestAvailableSportKey
  for (let i = 0; i < __NBA_BEST_AVAILABLE_BINDING_KEYS.length; i += 1) {
    const k = __NBA_BEST_AVAILABLE_BINDING_KEYS[i]
    Object.defineProperty(d, k, {
      get() {
        return eval(k)
      },
      enumerable: true,
      configurable: true
    })
  }
  return d
}

let __nbaCompiledBestHandler = null
let __nbaBestAvailableSrcPrepared = null
function __getNbaBestAvailableHandler() {
  if (!__nbaCompiledBestHandler) {
    if (__nbaBestAvailableSrcPrepared == null) {
      __nbaBestAvailableSrcPrepared = getNbaBestAvailableSource()
    }
    // Sloppy outer + `with (deps)` so names resolve to live getters (same as NBA refresh); avoid `let {…}=deps` snapshot.
    __nbaCompiledBestHandler = new Function(
      "req",
      "res",
      "deps",
      "oddsSnapshot",
      "return (function(req, res, deps, oddsSnapshot) {\n" +
        "  with (deps) {\n" +
        "    return (async function() {\n" +
        __nbaBestAvailableSrcPrepared +
        "\n    })();\n" +
        "  }\n" +
        "})(req, res, deps, oddsSnapshot);"
    )
  }
  return __nbaCompiledBestHandler
}

// Module `let` bindings the isolated refresh body assigns — must use accessors so `with (deps)` writes hit server scope.
const __NBA_REASSIGNABLE_REFRESH_MODULE_KEYS = new Set([
  "oddsSnapshot",
  "lastSnapshotSource",
  "lastForceRefreshAt",
  "lastSnapshotRefreshAt",
  "lastMarketCoverageFocusDebug",
])

const __NBA_REFRESH_DEPS_KEYS = "__dirname,ACTIVE_BOOKS,aggregateMarketCoverageFocusDebug,aggregateWatchedCountsFromEventDebug,ALL_DK_MARKETS,app,applyPersistentLineHistory,avg,buildCeilingRoleSpikeSignals,buildDataDrivenWhyItRates,buildEvidence,buildExtraMarketRowsForEvents,buildLineHistorySummary,buildLineupRoleContextSignals,buildMarketContextSignals,buildMatchup,buildMixedBestAvailableBuckets,buildModelSummary,buildSlateEvents,buildSnapshotMeta,buildWatchedPlayersCoverage,clamp,dedupeBestProps,dedupeByLegSignature,dedupeMarketRows,dedupeSlipLegs,detectSlateMode,diversifyBestProps,ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH,ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH,enrichPredictionLayer,ensureNbaRefreshEnvConfigured,fetchApiSportsPlayerIdCached,fetchApiSportsPlayerStatsCached,fetchDkScopedEventsForDebug,fetchEventPlayerPropsWithCoverage,fetchNbaUnrestrictedSlateEvents,filterRowsToPrimarySlate,formatDetroitLocalTimestamp,fs,getAvailablePrimarySlateRows,getBadTeamAssignmentRows,getCurrentTeamCodeFromStats,getDistinctGameCount,getDvpScore,getEventIdForDebug,getEventMatchupForDebug,getEventTimeForDebug,getIngestRejectReason,getLocalSlateDateKey,getManualPlayerStatus,getOpponentForRow,getPrimarySlateDateKeyFromRows,getSlateModeFromEvents,getTeamOverride,inferBetTypeFit,inferBookValueScore,inferGameEnvironmentScore,inferMarketTypeFromKey,inferMatchupEdgeScore,inferVolatilityScore,isActiveBook,isFragileLeg,isLooseResolvedMatch,isManualOverridePlayer,isNbaOddsReplayRequest,isPregameEligibleRow,lastForceRefreshAt,lastMarketCoverageFocusDebug,lastSnapshotRefreshAt,lastSnapshotSource,logBestPropsCapDebug,logBestPropsCapExcluded,logFunnelDropSummary,logFunnelExcluded,logFunnelStage,logPlayerResolutionDiagnostics,logPropPipelineStep,logTopPropSample,minVal,maxVal,normalizeDebugPlayerName,normalizePropType,ODDS_API_KEY,oddsSnapshot,parseHitRate,propValueFromApiSportsLog,path,PLAYER_LOOKUP_CONCURRENCY,playerFitsMatchup,playerIdCache,playerLookupMissCache,playerStatsCache,resetFragileFilterAdjustedLogCount,rowTeamMatchesMatchup,runCurrentSlateCoverageDiagnostics,sanitizeSnapshotRows,scorePropRow,sendNbaReplayRefreshResponse,shouldRemoveLegForPlayerStatus,SNAPSHOT_COOLDOWN_MS,snapshotLoadedFromDisk,summarizeBestPropsCapPool,stddev,summarizeIdentityChanges,summarizeInterestingNormalizedRows,summarizeNormalizedMarketCoverage,summarizePropPipelineRows,teamAbbr,toDetroitDateKey,UNSTABLE_GAME_EVENT_IDS,WATCHED_PLAYER_NAMES".split(",")

function buildNbaRefreshSnapshotDepsWithBindings(sportKey) {
  const d = {}
  d.sportKey = sportKey
  for (let i = 0; i < __NBA_REFRESH_DEPS_KEYS.length; i += 1) {
    const k = __NBA_REFRESH_DEPS_KEYS[i]
    const reass = __NBA_REASSIGNABLE_REFRESH_MODULE_KEYS.has(k)
    Object.defineProperty(d, k, {
      get() {
        return eval(k)
      },
      set: reass
        ? function (v) {
            eval(k + " = v")
          }
        : undefined,
      enumerable: true,
      configurable: true,
    })
  }
  return d
}

let __nbaCompiledRefreshHandler = null
function __getNbaRefreshSnapshotHandler() {
  if (!__nbaCompiledRefreshHandler) {
    const __src = getNbaRefreshSnapshotSource()
    // Sloppy outer function so `with (deps)` is legal; inner async is strict but still resolves names through `with`.
    // deps exposes module bindings (getters/setters) so assignments like `oddsSnapshot = …` update this module, not a shadow.
    __nbaCompiledRefreshHandler = new Function(
      "req",
      "res",
      "deps",
      "return (function(req, res, deps) {\n" +
        "  with (deps) {\n" +
        "    return (async function() {\n" +
        __src +
        "\n    })();\n" +
        "  }\n" +
        "})(req, res, deps);"
    )
  }
  return __nbaCompiledRefreshHandler
}

// === Refresh guard (global): prevent repeated Odds API calls ===
let __refreshInProgress = false
let __lastRefreshTime = 0

app.get("/api/best-available", async (req, res) => {
  const bestAvailableSportKey = normalizeBestAvailableSportKey(req.query?.sport)

  if (isMlbBestAvailableSportKey(bestAvailableSportKey)) {
    return handleMlbBestAvailableGet(req, res, {
      bestAvailableSportKey,
      lastSnapshotSource,
      snapshotLoadedFromDisk,
      oddsSnapshot,
      getMlbSnapshot: () => mlbSnapshot,
      setMlbSnapshot: (snap) => {
        mlbSnapshot = snap
      },
      ODDS_API_KEY,
      buildMlbBootstrapSnapshot,
      saveMlbReplaySnapshotToDisk,
      buildLiveDualBestAvailablePayload,
      buildMlbParlays,
      buildSnapshotMeta,
      recordMlbBestProps,
      evaluateMlbPerformance,
    })
  }

  // NBA snapshot policy (simple): never use obviously bad/stale data.
  // - rawProps === 0 -> refresh
  // - events === 0 -> refresh
  // - snapshot age > ~8 minutes -> refresh
  const snapshotEventsCount = Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : 0
  const snapshotRawPropsCount = Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0
  const snapshotUpdatedAtMs = oddsSnapshot?.updatedAt ? new Date(oddsSnapshot.updatedAt).getTime() : null
  const snapshotAgeMinutes = Number.isFinite(snapshotUpdatedAtMs)
    ? (Date.now() - snapshotUpdatedAtMs) / 60000
    : Infinity

  const refreshReasons = []
  if (snapshotEventsCount === 0) refreshReasons.push("events_zero")
  if (snapshotRawPropsCount === 0) refreshReasons.push("rawProps_zero")
  if (snapshotAgeMinutes > 8) refreshReasons.push("stale_over_8m")

  if (refreshReasons.length) {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "refresh",
      reasons: refreshReasons,
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
    })

    // Keep it simple: trigger the existing refresh endpoint in-process, then serve best-available.
    // This avoids duplicating the refresh pipeline here.
    try {
      const now = Date.now()
      if (__refreshInProgress) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "in_progress" })
      } else if (now - __lastRefreshTime < 2 * 60 * 1000) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "cooldown" })
      } else {
        __refreshInProgress = true
        __lastRefreshTime = now
        console.log("[REFRESH GUARD]", { skipped: false, reason: null })

      const port = Number(process.env.PORT || 4000)
      const sportParam = encodeURIComponent(String(bestAvailableSportKey || "basketball_nba"))
      await axios.get(`http://127.0.0.1:${port}/refresh-snapshot?force=1&sport=${sportParam}`, { timeout: 120000 })
      }
    } catch (e) {
      console.warn("[NBA SNAPSHOT POLICY] refresh failed", {
        message: e?.message || String(e),
        status: e?.response?.status || null,
      })
    } finally {
      __refreshInProgress = false
    }
  } else {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "use_snapshot",
      reasons: [],
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
    })
  }

  return __getNbaBestAvailableHandler()(req, res, buildNbaBestAvailableRouteDeps(bestAvailableSportKey), oddsSnapshot)

})

// Read-only snapshot counts (must not live inside compiled refresh body).
app.get("/api/odds", (req, res) => {
  return res.json({
    ok: true,
    snapshotMeta: buildSnapshotMeta(),
    counts: {
      events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : 0,
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
      props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
      bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0
    }
  })
})

// === Tracking (Phase 1): read-only inspection endpoints ===
app.get("/api/tracking/summary", async (req, res) => {
  const date = typeof req.query?.date === "string" ? req.query.date : null
  const dateKey = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)

  const runtimeDir = path.join(__dirname, "runtime", "tracking")
  const summaryPath = path.join(runtimeDir, `tracking_summary_${dateKey}.json`)
  const trackedPath = path.join(runtimeDir, `tracked_props_${dateKey}.json`)
  const gradedPath = path.join(runtimeDir, `graded_props_${dateKey}.json`)
  const mlbTrackedBestPath = path.join(runtimeDir, `mlb_tracked_best_${dateKey}.json`)

  const diagnostics = {
    date: dateKey,
    hasSummary: fs.existsSync(summaryPath),
    hasTracked: fs.existsSync(trackedPath),
    hasGraded: fs.existsSync(gradedPath),
    hasMlbTrackedBest: fs.existsSync(mlbTrackedBestPath),
    mlbTrackedBestPath,
  }

  try {
    if (diagnostics.hasSummary) {
      try {
        const raw = fs.readFileSync(summaryPath, "utf8")
        const json = JSON.parse(raw)
        const versionOk = json?.metadata?.version === "tracking-phase-2"
        const hasPhase2SummaryShape =
          json?.summary &&
          typeof json.summary === "object" &&
          json.summary.comboSummary != null &&
          json.summary.propCategoryBreakdown != null
        if (versionOk && hasPhase2SummaryShape) {
          return res.json({ ok: true, date: dateKey, summary: json?.summary || null, metadata: json?.metadata || null, diagnostics })
        }
      } catch {
        // stale or invalid cache — rebuild below
      }
    }

    // If missing or stale cache, build from tracked/graded (same paths as writers: __dirname-based runtime dir).
    const built = await buildTrackedSlateSummary({ date: dateKey })
    if (!built?.ok) {
      return res.json({ ok: false, date: dateKey, summary: null, metadata: null, diagnostics: { ...diagnostics, error: "unable to build summary" } })
    }

    return res.json({
      ok: true,
      date: dateKey,
      summary: built.payload?.summary || null,
      metadata: built.payload?.metadata || null,
      diagnostics: { ...diagnostics, built: true, summaryPath: built.path }
    })
  } catch (e) {
    return res.json({ ok: false, date: dateKey, summary: null, metadata: null, diagnostics: { ...diagnostics, error: String(e?.message || e) } })
  }
})

app.get("/api/tracking/tracked", (req, res) => {
  const date = typeof req.query?.date === "string" ? req.query.date : null
  const dateKey = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
  const runtimeDir = path.join(__dirname, "runtime", "tracking")
  const filePath = path.join(runtimeDir, `tracked_props_${dateKey}.json`)
  if (!fs.existsSync(filePath)) {
    return res.json({ ok: false, date: dateKey, error: "tracked file not found", path: filePath })
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return res.json({ ok: true, date: dateKey, tracked: JSON.parse(raw) })
  } catch (e) {
    return res.json({ ok: false, date: dateKey, error: String(e?.message || e), path: filePath })
  }
})

// MLB Phase 4 best picks only (isolated from `tracked_props_*` NBA / Phase-1 slate snapshots).
app.get("/api/tracking/mlb-best", (req, res) => {
  const date = typeof req.query?.date === "string" ? req.query.date : null
  const dateKey = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
  const snap = readMlbTrackedBestSnapshot(dateKey)
  if (!fs.existsSync(snap.path)) {
    return res.json({
      ok: false,
      date: dateKey,
      error: "mlb tracked best file not found",
      path: snap.path,
      mlb: { metadata: null, entries: [] },
    })
  }
  try {
    return res.json({
      ok: true,
      date: dateKey,
      path: snap.path,
      mlb: snap.payload,
    })
  } catch (e) {
    return res.json({ ok: false, date: dateKey, error: String(e?.message || e), path: snap.path })
  }
})

app.get("/api/tracking/graded", async (req, res) => {
  const date = typeof req.query?.date === "string" ? req.query.date : null
  const dateKey = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
  const runtimeDir = path.join(__dirname, "runtime", "tracking")
  const filePath = path.join(runtimeDir, `graded_props_${dateKey}.json`)

  try {
    if (!fs.existsSync(filePath)) {
      // If graded is missing but tracked exists, allow manual on-demand grading.
      const trackedPath = path.join(runtimeDir, `tracked_props_${dateKey}.json`)
      if (fs.existsSync(trackedPath)) {
        await gradeTrackedSlateSnapshot({ date: dateKey })
      }
    }
  } catch {
    // never hard-fail
  }

  if (!fs.existsSync(filePath)) {
    return res.json({ ok: false, date: dateKey, error: "graded file not found", path: filePath })
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return res.json({ ok: true, date: dateKey, graded: JSON.parse(raw) })
  } catch (e) {
    return res.json({ ok: false, date: dateKey, error: String(e?.message || e), path: filePath })
  }
})

// === Phase 3: pre-game best 2-leg pairs ===
app.get("/api/decision/pairs", (req, res) => {
  try {
    const payload = buildLiveDualBestAvailablePayload()

    const reqQueryDate = typeof req.query?.date === "string" ? req.query.date : ""
    const requestedDate = String(reqQueryDate || "").slice(0, 10)
    const liveSlateDate = typeof payload?.bestAvailable?.slateDate === "string" ? payload.bestAvailable.slateDate.slice(0, 10) : ""
    const slateDate = requestedDate || liveSlateDate || new Date().toISOString().slice(0, 10)

    const runtimeDir = path.join(__dirname, "runtime", "tracking")
    const trackedPath = path.join(runtimeDir, `tracked_props_${slateDate}.json`)

    let trackedData = null
    try {
      if (fs.existsSync(trackedPath)) {
        trackedData = JSON.parse(fs.readFileSync(trackedPath, "utf8"))
      }
    } catch {
      trackedData = null
    }

    const mlbSnap = readMlbTrackedBestSnapshot(slateDate)
    const mlbEntries = Array.isArray(mlbSnap?.payload?.entries) ? mlbSnap.payload.entries : []
    if (mlbEntries.length) {
      const baseRows = Array.isArray(trackedData?.allTrackedProps) ? trackedData.allTrackedProps : []
      const withoutLegacyMlbBest = baseRows.filter(
        (e) => !(e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best")
      )
      const meta =
        trackedData && typeof trackedData.metadata === "object"
          ? trackedData.metadata
          : { slateDate }
      trackedData = {
        ...(trackedData && typeof trackedData === "object" ? trackedData : {}),
        metadata: { ...meta, slateDate: meta.slateDate || slateDate },
        allTrackedProps: [...withoutLegacyMlbBest, ...mlbEntries],
      }
    }

    const out = buildBestPairs({ bestAvailablePayload: payload, trackedData, reqQueryDate })
    return res.json(out)
  } catch (e) {
    const reqQueryDate = typeof req.query?.date === "string" ? req.query.date : ""
    const requestedDate = String(reqQueryDate || "").slice(0, 10)
    return res.json({
      slateDate: requestedDate || null,
      source: "none",
      propCount: 0,
      safe: [],
      value: [],
      upside: [],
      mixed: [],
      special: []
    })
  }
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
  console.log("[EVENT FETCH START]")
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

  console.log("[EVENTS RETURNED]", unrestrictedFetchedEvents.length)

  const {
    allEvents,
    scheduledEvents
  } = await buildSlateEvents({
    oddsApiKey: ODDS_API_KEY,
    now: Date.now(),
    events: unrestrictedFetchedEvents
  })

  console.log("[EVENTS BUILT]", (Array.isArray(scheduledEvents) ? scheduledEvents.length : 0))
  console.log("[NBA FETCH]", {
    phase: "events",
    eventsFetched: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
    unrestrictedReturned: unrestrictedFetchedEvents.length,
    allEventsBuilt: Array.isArray(allEvents) ? allEvents.length : 0,
    scheduledFromBuildSlate: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
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
  console.log("[FILTER INPUT COUNT]", safeRows.length)
  const isBestPropsVisibilityPass = safeRows === oddsSnapshot.bestProps
  const scheduledEvents = Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : []
  const nowMs = Date.now()
  const currentPregameGameCount = scheduledEvents.filter((e) => {
    const t = e?.commence_time || e?.gameTime || e?.startTime || e?.start_time || e?.game_time || ""
    const ms = new Date(t).getTime()
    return Number.isFinite(ms) && ms > nowMs
  }).length
  const slateMode = currentPregameGameCount > 0 ? "pregame" : "active"
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

  let logged = 0
  const maxRowLogs = 12
  const logRowCheck = (row, rejecting) => {
    if (logged >= maxRowLogs) return
    logged += 1
    console.log("[ROW CHECK]", {
      gameTime: row?.gameTime ?? row?.commence_time ?? null,
      isPregame: (() => {
        const t = row?.gameTime || row?.commence_time || null
        const ms = t ? new Date(t).getTime() : null
        return ms != null && Number.isFinite(ms) ? ms > nowMs : null
      })(),
      marketValidity: row?.marketValidity ?? null,
      odds: row?.odds ?? null,
      eventId: row?.eventId ?? null,
      matchup: row?.matchup ?? null,
      rejecting
    })
  }

  const primarySlateRows = primarySlateInputRows.filter((row) => {
    if (!row) {
      logRowCheck(row, "missing_row")
      return false
    }
    if (!row.eventId || !row.matchup) {
      logRowCheck(row, "missing_eventId_or_matchup")
      return false
    }
    if (scheduledEventIdSet.size === 0) return true

    const inScheduledSet = scheduledEventIdSet.has(String(row.eventId))
    if (inScheduledSet) return true

    // Active slate relaxation: if games are already live/post-start and props are posted,
    // allow valid market rows even if the scheduled event list doesn't include this eventId.
    if (slateMode === "active" && row.marketValidity !== "invalid" && row.odds != null) {
      logRowCheck(row, "allow_active_relaxed")
      return true
    }

    logRowCheck(row, "not_in_scheduled_event_set")
    return false
  })

  const inputGames = [...new Set(primarySlateInputRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const outputGames = [...new Set(primarySlateRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const scheduledGames = scheduledEvents.map((event) => String(event?.matchup || getEventMatchupForDebug(event) || "")).filter(Boolean)
  const propsCoveredGames = [...new Set(primarySlateRows.map((row) => String(row?.matchup || "")).filter(Boolean))]
  const missingFromPropsGames = scheduledGames.filter((matchup) => !propsCoveredGames.includes(matchup))
  console.log("[PRIMARY-SLATE-FILTER-DEBUG]", {
    nowIso: new Date().toISOString(),
    slateMode,
    currentPregameGameCount,
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

  console.log("[FILTER OUTPUT COUNT]", primarySlateRows.length)

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

/**
 * Normalize team labels on exported NBA rows to full franchise names when possible
 * (e.g. LAC -> Los Angeles Clippers) using away/home on the row. Does not change mapping logic.
 */
function normalizeNbaExportTeamForRow(row) {
  const raw = String(row?.team || "").trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const away = String(row?.awayTeam || "").trim()
  const home = String(row?.homeTeam || "").trim()
  if (away && lower === away.toLowerCase()) return away
  if (home && lower === home.toLowerCase()) return home
  const code = raw.toUpperCase()
  if (away) {
    const ab = String(teamAbbr(away) || "").toUpperCase()
    if (ab && code === ab) return away
  }
  if (home) {
    const hb = String(teamAbbr(home) || "").toUpperCase()
    if (hb && code === hb) return home
  }
  if (raw.length > 5 || raw.includes(" ")) return raw
  return raw
}

function attachNbaPregameExportFields(row) {
  if (!row || typeof row !== "object") return row
  const teamNorm = normalizeNbaExportTeamForRow(row)
  const base = teamNorm ? { ...row, team: teamNorm } : { ...row }
  if (base.pregameContext && typeof base.pregameContext === "object") return base
  const ctx = buildPregameContext({ sport: "nba", row: base })
  return {
    ...base,
    pregameContext: ctx,
    explanationTags: Array.isArray(base.explanationTags) && base.explanationTags.length
      ? base.explanationTags
      : ctx.explanationTags
  }
}

// --- NBA export hydration: merge thin best/fallback legs onto scored board rows (same leg key) ---
const NBA_EXPORT_ENRICHMENT_NUMERIC_KEYS = [
  "avgMin",
  "recent5MinAvg",
  "recent3MinAvg",
  "ceilingScore",
  "roleSpikeScore",
  "opportunitySpikeScore",
  "marketLagScore",
  "matchupEdgeScore",
  "gameEnvironmentScore",
  "dvpScore",
  "bookDisagreementScore",
  "longshotPredictiveIndex",
  "lineupContextScore"
]

function buildNbaExportHydrationKey(row) {
  return [
    String(row?.player || "").trim().toLowerCase(),
    String(row?.marketKey || "").trim().toLowerCase(),
    String(row?.side || "").trim().toLowerCase(),
    String(row?.line ?? ""),
    String(row?.book || "").trim().toLowerCase()
  ].join("|")
}

function buildNbaExportHydrationKeyPropType(row) {
  return [
    String(row?.player || "").trim().toLowerCase(),
    String(row?.propType || "").trim().toLowerCase(),
    String(row?.side || "").trim().toLowerCase(),
    String(row?.line ?? ""),
    String(row?.book || "").trim().toLowerCase()
  ].join("|")
}

function buildNbaEnrichmentLegLookup(rows) {
  const byPrimary = new Map()
  const byPropType = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(row?.marketKey || "").trim()) {
      const pk = buildNbaExportHydrationKey(row)
      if (pk && !byPrimary.has(pk)) byPrimary.set(pk, row)
    }
    const qk = buildNbaExportHydrationKeyPropType(row)
    if (qk && !byPropType.has(qk)) byPropType.set(qk, row)
  }
  return { byPrimary, byPropType }
}

const NBA_EXPORT_CORE_BACKFILL_KEYS = [
  "team",
  "playerTeam",
  "awayTeam",
  "homeTeam",
  "matchup",
  "eventId",
  "score",
  "edge",
  "projectedValue",
  "hitRate",
  "playerConfidenceScore",
  "adjustedConfidenceScore",
  "confidenceScore",
  "modelHitProb",
  "gameTime",
  "marketKey",
  "side"
]

function mergeNbaExportRowWithEnrichmentLookup(skinny, lookup) {
  if (!skinny || typeof skinny !== "object" || !lookup) return skinny
  let rich = null
  if (String(skinny?.marketKey || "").trim()) {
    const pk = buildNbaExportHydrationKey(skinny)
    rich = pk ? lookup.byPrimary.get(pk) : null
  }
  if (!rich) {
    const qk = buildNbaExportHydrationKeyPropType(skinny)
    rich = qk ? lookup.byPropType.get(qk) : null
  }
  if (!rich || rich === skinny) return skinny
  const out = { ...skinny }
  for (const key of NBA_EXPORT_ENRICHMENT_NUMERIC_KEYS) {
    const s = out[key]
    const r = rich[key]
    const sMissing = s === null || s === undefined || s === ""
    if (sMissing && r !== null && r !== undefined && r !== "") out[key] = r
  }
  for (const key of NBA_EXPORT_CORE_BACKFILL_KEYS) {
    const s = out[key]
    const r = rich[key]
    const sMissing = s === null || s === undefined || s === ""
    if (sMissing && r !== null && r !== undefined && r !== "") out[key] = r
  }
  return out
}

function splitNbaMatchupVenueSides(matchup) {
  const m = String(matchup || "").trim()
  if (!m) return null
  let parts = null
  if (m.includes("@")) {
    parts = m.split("@").map((s) => String(s || "").trim()).filter(Boolean)
  } else if (/\bvs\.?\b/i.test(m)) {
    parts = m.split(/\bvs\.?\b/i).map((s) => String(s || "").trim()).filter(Boolean)
  }
  if (!parts || parts.length < 2) return null
  return { awayTeam: parts[0], homeTeam: parts[1] }
}

function recoverNbaExportRowTeamAndVenue(row) {
  if (!row || typeof row !== "object") return row
  const out = { ...row }
  const sides = splitNbaMatchupVenueSides(out.matchup)
  if (sides) {
    if (!String(out.awayTeam || "").trim()) out.awayTeam = sides.awayTeam
    if (!String(out.homeTeam || "").trim()) out.homeTeam = sides.homeTeam
  }
  if (String(out.team || "").trim()) return out
  const away = String(out.awayTeam || "").trim()
  const home = String(out.homeTeam || "").trim()
  const pt = String(out.playerTeam || "").trim()
  if (away && home && pt) {
    const aAb = String(teamAbbr(away) || "").toUpperCase()
    const hAb = String(teamAbbr(home) || "").toUpperCase()
    const ptk = pt.toUpperCase()
    if (aAb && ptk === aAb) {
      out.team = away
      return out
    }
    if (hAb && ptk === hAb) {
      out.team = home
      return out
    }
  }
  return out
}

function buildNbaTeamByPlayerEventMap(snapshot) {
  const m = new Map()
  const pool = [
    ...(Array.isArray(snapshot?.props) ? snapshot.props : []),
    ...(Array.isArray(snapshot?.rawProps) ? snapshot.rawProps : [])
  ]
  for (const pl of pool) {
    const t = String(pl?.team || "").trim()
    if (!t) continue
    const eid = String(pl?.eventId || "").trim()
    const player = String(pl?.player || "").trim()
    if (!eid || !player) continue
    const key = `${eid}|${normalizePlayerName(player)}`
    if (!m.has(key)) m.set(key, t)
  }
  return m
}

function fillNbaRowTeamFromPlayerEventMap(row, teamByPlayerEvent) {
  if (!row || typeof row !== "object" || !teamByPlayerEvent || teamByPlayerEvent.size === 0) return row
  if (String(row.team || "").trim()) return row
  const eid = String(row.eventId || "").trim()
  const player = String(row.player || "").trim()
  if (!eid || !player) return row
  const hit = teamByPlayerEvent.get(`${eid}|${normalizePlayerName(player)}`)
  if (!hit) return row
  return { ...row, team: hit }
}

function buildNbaTeamByPlayerSingleEventMap(snapshot) {
  const props = [...(Array.isArray(snapshot?.props) ? snapshot.props : [])]
  const eids = new Set(props.map((p) => String(p?.eventId || "").trim()).filter(Boolean))
  if (eids.size !== 1) return new Map()
  const m = new Map()
  for (const pl of props) {
    const t = String(pl?.team || "").trim()
    const p = normalizePlayerName(String(pl?.player || ""))
    if (!t || !p) continue
    if (!m.has(p)) m.set(p, t)
  }
  return m
}

function fillNbaRowTeamFromSingleEventMap(row, teamByPlayer) {
  if (!row || typeof row !== "object" || !teamByPlayer || teamByPlayer.size === 0) return row
  if (String(row.team || "").trim()) return row
  const p = normalizePlayerName(String(row.player || ""))
  const hit = teamByPlayer.get(p)
  if (!hit) return row
  return { ...row, team: hit }
}

// === NBA row-state system (post-hydration) ===
// "complete": core identity present + >= 2 real quality signals
// "partial":  core identity present + exactly 1 real quality signal
// "invalid":  missing core identity OR 0 quality signals
function countNbaRowQualitySignals(row) {
  if (!row || typeof row !== "object") return 0
  // Some signals can be legitimately 0 (e.g. dvpScore=0), so treat finite as "present"
  // for those, while keeping >0 rules for minutes/ceiling/spike scores.
  let n = 0
  const avgMin = Number(row?.avgMin)
  if (Number.isFinite(avgMin) && avgMin > 0) n += 1
  const ceilingScore = Number(row?.ceilingScore)
  if (Number.isFinite(ceilingScore) && ceilingScore > 0) n += 1
  const score = row?.score
  if (score !== null && score !== undefined && Number.isFinite(Number(score))) n += 1
  const edge = row?.edge
  if (edge !== null && edge !== undefined && Number.isFinite(Number(edge))) n += 1
  const roleSpikeScore = Number(row?.roleSpikeScore)
  if (Number.isFinite(roleSpikeScore) && roleSpikeScore > 0) n += 1
  const opportunitySpikeScore = Number(row?.opportunitySpikeScore)
  if (Number.isFinite(opportunitySpikeScore) && opportunitySpikeScore > 0) n += 1
  const marketLagScore = Number(row?.marketLagScore)
  if (Number.isFinite(marketLagScore) && Math.abs(marketLagScore) >= 0.05) n += 1
  const matchupEdgeScore = Number(row?.matchupEdgeScore)
  if (Number.isFinite(matchupEdgeScore) && Math.abs(matchupEdgeScore) >= 0.05) n += 1
  const gameEnvironmentScore = Number(row?.gameEnvironmentScore)
  if (Number.isFinite(gameEnvironmentScore) && Math.abs(gameEnvironmentScore) >= 0.05) n += 1
  const dvpScore = Number(row?.dvpScore)
  if (Number.isFinite(dvpScore) && Math.abs(dvpScore) >= 0.05) n += 1
  return n
}

function classifyNbaRowDataState(row) {
  const r = recoverNbaExportRowTeamAndVenue(row)
  const hasCoreIdentity =
    Boolean(String(r?.player || "").trim()) &&
    Boolean(String(r?.matchup || "").trim()) &&
    Boolean(String(r?.propType || "").trim()) &&
    Boolean(String(r?.book || "").trim())
  if (!hasCoreIdentity) return "invalid"
  // Hard invalid: "hollow shells" (no minutes/ceiling/score/edge), even if context scores exist.
  const hasCoreQualityAnchor =
    (r?.avgMin !== null && r?.avgMin !== undefined && Number.isFinite(Number(r?.avgMin))) ||
    (r?.ceilingScore !== null && r?.ceilingScore !== undefined && Number.isFinite(Number(r?.ceilingScore))) ||
    (r?.score !== null && r?.score !== undefined && Number.isFinite(Number(r?.score))) ||
    (r?.edge !== null && r?.edge !== undefined && Number.isFinite(Number(r?.edge)))
  if (!hasCoreQualityAnchor) return "invalid"
  const signals = countNbaRowQualitySignals(r)
  if (signals >= 2) return "complete"
  if (signals === 1) return "partial"
  return "invalid"
}

function withNbaRowDataState(row) {
  if (!row || typeof row !== "object") return row
  const recovered = recoverNbaExportRowTeamAndVenue(row)
  const qualitySignalCount = countNbaRowQualitySignals(recovered)
  const dataState = classifyNbaRowDataState(recovered)
  return { ...recovered, dataState, qualitySignalCount }
}

function hasMeaningfulNbaScoreSignal(row) {
  if (!row || typeof row !== "object") return false
  if (row.__forceInclude) return true
  return countNbaRowQualitySignals(row) >= 1
}

const NBA_EXPORT_LINE_REQUIRED_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])

function isNbaExportRowGate(row) {
  const r = recoverNbaExportRowTeamAndVenue(row)
  if (r.__forceInclude) return true
  if (!String(r?.player || "").trim()) return false
  if (!String(r?.matchup || "").trim()) return false
  if (!String(r?.propType || "").trim()) return false
  if (!String(r?.book || "").trim()) return false
  const sigs = countNbaRowQualitySignals(r)
  // If we can't recover team, require stronger signal to avoid "hollow shells" contaminating exports.
  if (!String(r?.team || "").trim() && sigs < 2) return false
  if (NBA_EXPORT_LINE_REQUIRED_PROP_TYPES.has(String(r?.propType || "")) && !Number.isFinite(Number(r?.line))) return false
  if (sigs < 1) return false
  return true
}

function selectNbaExportGateReadyRows(rows, { minKeep = 3 } = {}) {
  const safe = Array.isArray(rows) ? rows : []
  const gated = safe.filter((r) => isNbaExportRowGate(r))
  if (gated.length >= minKeep) return gated
  if (gated.length > 0) return gated
  return safe
}

function stripStaleNbaPregameFieldsForRebuild(row) {
  if (!row || typeof row !== "object") return row
  const { pregameContext, explanationTags, ...rest } = row
  return rest
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
  const recent5MinAvg = Number(row.recent5MinAvg || 0)
  const recent3MinAvg = Number(row.recent3MinAvg || 0)
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
  const roleSpikeScore = Number(row?.roleSpikeScore || 0)
  const opportunitySpikeScore = Number(row?.opportunitySpikeScore || 0)
  const ceilingScore = Number(row?.ceilingScore || 0)
  const longshotPredictiveIndex = Number(row?.longshotPredictiveIndex || 0)
  const propType = String(row?.propType || "")

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

  // --- Minutes/role quality guardrail (prevents low-role hitRate/edge mirages) ---
  const spikeOverride =
    roleSpikeScore >= 0.3 ||
    opportunitySpikeScore >= 0.38

  // Hard penalty for low-minute roles unless we have a real spike signal.
  const lowAvgMinutes = row.avgMin !== null && avgMin > 0 && avgMin < 20
  const lowRecentMinutes = row.recent5MinAvg !== null && recent5MinAvg > 0 && recent5MinAvg < 20
  if (!spikeOverride && (lowAvgMinutes || lowRecentMinutes)) {
    const depth = Math.max(0, 20 - Math.max(avgMin || 0, recent5MinAvg || 0))
    score -= 18 + Math.min(12, depth * 0.9)
  }
  if (!spikeOverride && String(minutesRisk || "").toLowerCase() === "high") {
    score -= 12
  }
  // Bench spike exception still shouldn't look like an "elite" rotation play unless ceiling supports it.
  if (spikeOverride && (lowAvgMinutes || lowRecentMinutes) && ceilingScore < 0.52) {
    score -= 8
  }

  // Reward stable minutes; penalize volatile minutes (recent3 vs recent5 vs avg).
  if (row.avgMin !== null && row.recent5MinAvg !== null && row.recent3MinAvg !== null) {
    const v1 = Math.abs(recent3MinAvg - recent5MinAvg)
    const v2 = Math.abs(recent5MinAvg - avgMin)
    const vol = v1 + v2
    if (avgMin >= 24 && recent5MinAvg >= 24 && vol <= 3) score += 5
    else if (avgMin >= 22 && recent5MinAvg >= 22 && vol <= 4.5) score += 2
    else if (vol >= 8) score -= 8
    else if (vol >= 6) score -= 4
  }

  if (odds >= -135 && odds <= 110) score += 6
  else if (odds < -170) score -= 10
  else if (odds < -150) score -= 5

  // --- Prop-type shaping (favor impactful markets, reduce PRA dominance) ---
  if (propType === "PRA") score -= 8
  else if (propType === "Points") score += 4
  else if (propType === "Threes") score += 5
  else if (propType === "Assists") score += 3
  else if (propType === "Rebounds") {
    if (ceilingScore >= 0.58) score += 4
    else score += 1
  }

  // Penalize very low-impact low lines unless true ceiling setup.
  if (propType === "Threes" && line > 0 && line <= 1.5 && ceilingScore < 0.62) {
    score -= 18
  }

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

  // --- Ceiling emphasis (prefer breakout/ceiling profiles over purely safe blends) ---
  if (Number.isFinite(ceilingScore) && ceilingScore > 0) {
    score += ceilingScore * 18
    // De-rank low-ceiling plays from top boards unless spike-supported.
    const spikeOverride =
      roleSpikeScore >= 0.3 ||
      opportunitySpikeScore >= 0.38
    if (!spikeOverride && ceilingScore < 0.5) {
      score -= (0.5 - ceilingScore) * 65
    }
  }
  if (Number.isFinite(longshotPredictiveIndex) && longshotPredictiveIndex > 0) {
    score += longshotPredictiveIndex * 10
  }

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

function normalizePropTypeBase(propType) {
  const p = String(propType || "").trim().toLowerCase()
  if (!p) return ""
  // Collapse ladder labels + aliases into the same core key.
  return p.replace(/\s+ladder\b/g, "").trim()
}

function diversifyBestProps(bestProps, options = {}) {
  const safe = dedupeSlipLegs(Array.isArray(bestProps) ? bestProps : []).filter(Boolean)
  const mode = String(options?.slateMode || "").toLowerCase()
  const totalCap = Number.isFinite(options?.totalCap) ? Number(options.totalCap) : safe.length
  const maxPerPlayer = Number.isFinite(options?.maxPerPlayer)
    ? Number(options.maxPerPlayer)
    : (mode === "thin" ? 3 : 2)
  const maxPerPlayerPropType = Number.isFinite(options?.maxPerPlayerPropType)
    ? Number(options.maxPerPlayerPropType)
    : 1

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v || 0)))
  const composite = (row) => {
    const hitRate = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
    const score = Number(row?.score || 0)
    const edgeComponent = clamp01((edge + 2) / 8)
    const scoreComponent = clamp01(score / 120)
    const lowRiskBonuses =
      (String(row?.minutesRisk || "").toLowerCase() === "low" ? 0.035 : 0) +
      (String(row?.injuryRisk || "").toLowerCase() === "low" ? 0.03 : 0) +
      (String(row?.trendRisk || "").toLowerCase() === "low" ? 0.02 : 0)
    return hitRate * 0.5 + edgeComponent * 0.25 + scoreComponent * 0.15 + lowRiskBonuses
  }

  const sorted = [...safe].sort((a, b) => {
    const c = composite(b) - composite(a)
    if (c !== 0) return c
    const s = Number(b?.score || 0) - Number(a?.score || 0)
    if (s !== 0) return s
    const e = Number(b?.edge || 0) - Number(a?.edge || 0)
    if (e !== 0) return e
    return Number(b?.odds || 0) - Number(a?.odds || 0)
  })

  const out = []
  const playerCounts = new Map()
  const playerPropCounts = new Map() // player -> Map(propTypeBase -> count)

  const canTake = (row) => {
    const player = String(row?.player || "").trim().toLowerCase()
    if (!player) return false
    const pCount = playerCounts.get(player) || 0
    if (pCount >= maxPerPlayer) return false

    // Prefer true ceiling/impact rows for bestProps shaping.
    const ceiling = Number(row?.ceilingScore || 0)
    const hit = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge ?? 0)
    const score = Number(row?.score || 0)
    if (ceiling > 0 && ceiling < 0.5) {
      const eliteException =
        (score >= 95 && hit >= 0.62) ||
        (Math.abs(edge) >= 6.5 && hit >= 0.6)
      if (!eliteException) return false
    }
    const ptRaw = String(row?.propType || "")
    const line = Number(row?.line || 0)
    if (ptRaw === "Threes" && line > 0 && line <= 1.5 && ceiling < 0.62) return false

    const pt = normalizePropTypeBase(row?.propType)
    const ptMap = playerPropCounts.get(player) || new Map()
    const ptCount = pt ? (ptMap.get(pt) || 0) : 0
    if (pt && ptCount >= maxPerPlayerPropType) return false

    return true
  }

  const record = (row) => {
    const player = String(row?.player || "").trim().toLowerCase()
    const pt = normalizePropTypeBase(row?.propType)
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
    if (pt) {
      const ptMap = playerPropCounts.get(player) || new Map()
      ptMap.set(pt, (ptMap.get(pt) || 0) + 1)
      playerPropCounts.set(player, ptMap)
    }
  }

  for (const row of sorted) {
    if (!canTake(row)) continue
    out.push(row)
    record(row)
    if (out.length >= totalCap) break
  }

  // Thin slate fallback: if we pruned too hard, allow a second propType repeat per player
  // to avoid empty boards, but still respect maxPerPlayer.
  if (mode === "thin" && out.length < Math.min(totalCap, 16)) {
    const relaxedOut = [...out]
    const relaxedCounts = new Map(playerCounts)
    const relaxedPlayerPropCounts = new Map(playerPropCounts)
    const allowRepeat = (row) => {
      const player = String(row?.player || "").trim().toLowerCase()
      if (!player) return false
      if ((relaxedCounts.get(player) || 0) >= maxPerPlayer) return false
      return true
    }
    for (const row of sorted) {
      if (relaxedOut.length >= totalCap) break
      const key = `${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`
      if (relaxedOut.some((r) => `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}` === key)) continue
      if (!allowRepeat(row)) continue
      relaxedOut.push(row)
      const player = String(row?.player || "").trim().toLowerCase()
      relaxedCounts.set(player, (relaxedCounts.get(player) || 0) + 1)
      const pt = normalizePropTypeBase(row?.propType)
      if (pt) {
        const ptMap = relaxedPlayerPropCounts.get(player) || new Map()
        ptMap.set(pt, (ptMap.get(pt) || 0) + 1)
        relaxedPlayerPropCounts.set(player, ptMap)
      }
    }
    return relaxedOut
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

// MLB probability foundation helper (American odds -> implied prob)
// Kept as a wrapper so MLB code doesn't need to know NBA naming.
function impliedProbabilityFromOdds(odds) {
  return impliedProbabilityFromAmerican(odds)
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isMlbPhase2PowerMarket(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const pt = String(row?.propType || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const directionOk = side === "over" || side === "yes"

  if (mk.includes("first_home_run") || pt.includes("first home run")) return true
  if (mk.includes("home_run") || mk.includes("home_runs") || mk.includes("to_hit_home_run") || pt.includes("home run")) {
    return true
  }

  // Power-adjacent lane (still "power universe", not generic counting stats)
  if (mk.includes("total_bases") || pt.includes("total bases")) return true

  // Core counting overs (board diversity + actionable offense markets)
  if (!directionOk) return false
  if (mk.includes("batter_hits") || mk.includes("player_hits") || pt.includes("hits")) return true
  if (mk.includes("batter_rbis") || mk.includes("player_rbis") || pt.includes("rbi")) return true
  if (mk.includes("batter_runs") || mk.includes("runs_scored") || mk.includes("player_runs") || pt.includes("runs")) return true

  return false
}

function computeMlbHrPathProxyScore(row) {
  // Lightweight, odds+shape-driven proxy for HR-ish markets when homeRunPathScore isn't present on the row.
  // Intentionally small + stable (not a full model).
  const mk = String(row?.marketKey || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const odds = toNumberOrNull(row?.odds)
  if (!Number.isFinite(odds) || odds === 0) return null

  const implied = impliedProbabilityFromOdds(odds)
  const impliedSignal = implied == null ? 0.25 : clamp((implied - 0.05) / 0.13, 0, 1)

  const payoutSignal =
    odds >= 450 && odds <= 1200 ? 1 :
    odds >= 300 && odds < 450 ? 0.82 :
    odds > 1200 && odds <= 1800 ? 0.7 :
    odds > 1800 && odds <= 2200 ? 0.42 :
    odds >= 200 && odds < 300 ? 0.54 :
    0.2

  const directionOk = side === "over" || side === "yes" || side === "to hit" || side === "hit" || side === ""
  if (!directionOk) return clamp(impliedSignal * 0.55, 0, 1)

  let marketShape = 0.55
  if (mk.includes("home_run") || mk.includes("home_runs") || mk.includes("to_hit_home_run")) {
    marketShape = Number.isFinite(line) && line <= 0.5 ? 0.95 : 0.78
  } else if (mk.includes("total_bases")) {
    if (!Number.isFinite(line)) marketShape = 0.55
    else if (line >= 2.5) marketShape = 0.9
    else if (line >= 1.5) marketShape = 0.74
    else marketShape = 0.55
  }

  const extremeLongshotPenalty = odds > 1700 ? 0.12 : 0
  const chalkPenalty = odds < -200 ? 0.18 : odds < -120 ? 0.08 : 0

  const score = clamp(
    impliedSignal * 0.42 + payoutSignal * 0.28 + marketShape * 0.30 - extremeLongshotPenalty - chalkPenalty,
    0,
    1
  )
  return Number(score.toFixed(6))
}

function computeMlbOverCountingProxyScore(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const odds = toNumberOrNull(row?.odds)
  if (!Number.isFinite(odds) || odds === 0) return null
  if (!(side === "over" || side === "yes")) return null

  const implied = impliedProbabilityFromOdds(odds)
  const impliedSignal = implied == null ? 0.25 : clamp((implied - 0.35) / 0.35, 0, 1)

  const payoutSignal =
    odds >= 140 && odds <= 260 ? 0.95 :
    odds >= 105 && odds < 140 ? 0.78 :
    odds > 260 && odds <= 420 ? 0.72 :
    odds > 420 && odds <= 700 ? 0.55 :
    0.35

  let lineSignal = 0.55
  if (mk.includes("hits")) {
    if (!Number.isFinite(line)) lineSignal = 0.55
    else if (line >= 2.5) lineSignal = 0.92
    else if (line >= 1.5) lineSignal = 0.78
    else if (line >= 0.5) lineSignal = 0.62
    else lineSignal = 0.45
  } else if (mk.includes("rbis") || mk.includes("rbi")) {
    if (!Number.isFinite(line)) lineSignal = 0.55
    else if (line >= 1.5) lineSignal = 0.9
    else if (line >= 0.5) lineSignal = 0.72
    else lineSignal = 0.48
  } else if (mk.includes("runs") || mk.includes("runs_scored")) {
    if (!Number.isFinite(line)) lineSignal = 0.55
    else if (line >= 1.5) lineSignal = 0.9
    else if (line >= 0.5) lineSignal = 0.72
    else lineSignal = 0.48
  }

  const chalkPenalty = odds < -200 ? 0.18 : odds < -130 ? 0.08 : 0
  const mushPenalty = odds >= -160 && odds <= -105 ? 0.06 : 0

  const score = clamp(
    impliedSignal * 0.34 + payoutSignal * 0.30 + lineSignal * 0.36 - chalkPenalty - mushPenalty,
    0,
    1
  )
  return Number(score.toFixed(6))
}

function normalizeLineupSpotSignal(battingOrderIndex) {
  const idx = toNumberOrNull(battingOrderIndex)
  if (!Number.isFinite(idx)) return null
  // 1 (leadoff) -> 1.0, 9 -> ~0.11
  return clamp((10 - idx) / 9, 0, 1)
}

function normalizeOddsStrengthSignal(impliedProbability) {
  const p = toNumberOrNull(impliedProbability)
  if (!Number.isFinite(p)) return null
  // We want "strong but not absurd chalk" to score well for power outcomes.
  // Center around ~0.10-0.18 (common HR yes band) and softly downweight extremes.
  // Map p in [0.05..0.30] to [0..1] with a peak near 0.16.
  const centered = 1 - Math.abs(p - 0.16) / 0.14
  return clamp(centered, 0, 1)
}

function normalizePowerMarketBonus(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const pt = String(row?.propType || "").toLowerCase()
  const odds = toNumberOrNull(row?.odds)

  const isHr =
    mk.includes("home_run") ||
    mk.includes("home_runs") ||
    mk.includes("to_hit_home_run") ||
    pt.includes("home run")
  const isFirstHr = mk.includes("first_home_run") || pt.includes("first home run")

  if (!isHr || isFirstHr) return null

  // Reward realistic HR "yes" prices; penalize extreme tails a bit.
  if (!Number.isFinite(odds)) return 0.5
  if (odds >= 300 && odds <= 1200) return 1
  if (odds >= 200 && odds < 300) return 0.75
  if (odds > 1200 && odds <= 1800) return 0.65
  if (odds > 1800) return 0.4
  return 0.55
}

function getMlbSignalStrengthTag(signalScore) {
  const s = toNumberOrNull(signalScore)
  if (!Number.isFinite(s)) return "neutral"
  // Narrow the neutral band to create more visible separation.
  if (s >= 0.75) return "elite power"
  if (s >= 0.6) return "strong"
  if (s >= 0.42) return "neutral"
  return "weak"
}

function getMlbPowerSignals(row) {
  // Return 0..1. Must be robust to missing fields.
  // Uses only already-available runtime data (no new API requirements).
  if (!row || typeof row !== "object") return 0.5
  if (!isMlbPhase2PowerMarket(row)) return 0.5

  const implied = impliedProbabilityFromOdds(row?.odds)
  const ctx = buildPregameContext({ sport: "mlb", row })

  const signals = []

  // 1) Odds strength (baseline, but not the whole model)
  const oddsStrength = normalizeOddsStrengthSignal(implied)
  if (oddsStrength != null) signals.push({ v: oddsStrength, w: 0.22 })

  // 1b) Cross-book disagreement / mispricing vs consensus (same slate, no new APIs)
  const dispersion = toNumberOrNull(row?.bookImpliedDispersion)
  if (Number.isFinite(dispersion)) {
    const dispSignal = clamp(dispersion / 0.06, 0, 1)
    signals.push({ v: dispSignal, w: 0.18 })
  }

  const vsConsensus = toNumberOrNull(row?.bookVsConsensusDelta)
  if (Number.isFinite(vsConsensus)) {
    const mispriceSignal = clamp(0.5 + vsConsensus / 0.06, 0, 1)
    signals.push({ v: mispriceSignal, w: 0.14 })
  }

  // 2) Power proxies (if present)
  const mk = String(row?.marketKey || "").toLowerCase()
  const isHrOrTb =
    mk.includes("home_run") ||
    mk.includes("home_runs") ||
    mk.includes("to_hit_home_run") ||
    mk.includes("total_bases")

  if (isHrOrTb) {
    const hrPath = toNumberOrNull(ctx?.powerContext?.homeRunPathScore)
    if (Number.isFinite(hrPath)) signals.push({ v: clamp(hrPath, 0, 1), w: 0.22 })
    else {
      const proxy = computeMlbHrPathProxyScore(row)
      if (proxy != null) signals.push({ v: proxy, w: 0.18 })
    }
  } else {
    const countingProxy = computeMlbOverCountingProxyScore(row)
    if (countingProxy != null) signals.push({ v: countingProxy, w: 0.20 })
  }

  const surface = toNumberOrNull(ctx?.powerContext?.surfaceScore)
  if (Number.isFinite(surface)) signals.push({ v: clamp(surface, 0, 1), w: 0.15 })

  // 3) Lineup position (if present on row; external pipeline may attach later)
  const lineupSpot = normalizeLineupSpotSignal(row?.battingOrderIndex || row?.lineupSpot || row?.battingOrder || null)
  if (lineupSpot != null) signals.push({ v: lineupSpot, w: 0.10 })

  // 4) Context nudges (home spot, identity confidence, matchup sanity)
  const isHome = ctx?.matchupContext?.isHome
  if (isHome === true) signals.push({ v: 0.62, w: 0.04 })
  if (isHome === false) signals.push({ v: 0.48, w: 0.04 })

  const teamMatches = ctx?.matchupContext?.teamMatchesMatchup
  if (teamMatches === false) signals.push({ v: 0.25, w: 0.06 })

  const idc = toNumberOrNull(ctx?.availabilityContext?.identityConfidence)
  if (Number.isFinite(idc)) {
    const idSignal = clamp((idc - 0.55) / 0.35, 0, 1)
    signals.push({ v: idSignal, w: 0.05 })
  }

  // 5) HR market-shape bonus (keeps HR lane from being purely implied-based)
  const hrMarket = normalizePowerMarketBonus(row)
  if (hrMarket != null) signals.push({ v: hrMarket, w: 0.05 })

  if (!signals.length) return 0.5

  const weightSum = signals.reduce((acc, s) => acc + s.w, 0) || 1
  const score = signals.reduce((acc, s) => acc + s.v * s.w, 0) / weightSum
  // Mild stretch to reduce "everyone lands at ~0.50" clustering.
  const stretched = clamp(0.08 + score * 1.18, 0, 1)
  return clamp(Number(stretched.toFixed(6)), 0, 1)
}

function estimateMlbHrProbability(row, context = {}) {
  // Phase 2: signal-driven probability.
  // predictedProbability = (impliedProbability * 0.6) + (signalScore * 0.4)
  const consensusProb = context?.consensusProbability
  const implied = impliedProbabilityFromOdds(row?.odds)

  const impliedBase =
    Number.isFinite(Number(consensusProb)) ? Number(consensusProb) :
    implied !== null ? implied :
    null
  if (impliedBase === null) return null

  if (!isMlbPhase2PowerMarket(row)) {
    // Keep non-power markets stable: probability follows this row's posted price.
    const bookImplied = implied
    return bookImplied == null ? null : clamp(Number(bookImplied.toFixed(6)), 0, 1)
  }

  const signalScore =
    Number.isFinite(toNumberOrNull(context?.signalScore))
      ? toNumberOrNull(context.signalScore)
      : getMlbPowerSignals(row)

  const predictedProbability = (impliedBase * 0.6) + (signalScore * 0.4)
  return clamp(Number(predictedProbability.toFixed(6)), 0, 1)
}

function hydrateMlbProbabilityLayer(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  if (!safeRows.length) return []

  const buildConsensusKey = (row) => ([
    String(row?.eventId || ""),
    String(row?.playerKey || row?.player || ""),
    String(row?.marketKey || ""),
    String(row?.propType || ""),
    String(row?.side || ""),
    String(row?.line ?? "")
  ].join("|"))

  const consensusByKey = new Map()
  for (const row of safeRows) {
    const implied = impliedProbabilityFromOdds(row?.odds)
    if (implied === null) continue
    const key = buildConsensusKey(row)
    if (!key) continue
    if (!consensusByKey.has(key)) consensusByKey.set(key, [])
    consensusByKey.get(key).push(implied)
  }

  const consensusMeanByKey = new Map()
  const consensusDispersionByKey = new Map()
  for (const [key, probs] of consensusByKey.entries()) {
    if (!Array.isArray(probs) || probs.length === 0) continue
    const sum = probs.reduce((acc, v) => acc + Number(v || 0), 0)
    const mean = sum / probs.length
    if (!Number.isFinite(mean)) continue
    consensusMeanByKey.set(key, clamp(mean, 0, 1))

    const finite = probs.filter((p) => Number.isFinite(Number(p)))
    if (finite.length >= 2) {
      let min = Infinity
      let max = -Infinity
      for (const p of finite) {
        const n = Number(p)
        if (n < min) min = n
        if (n > max) max = n
      }
      if (Number.isFinite(min) && Number.isFinite(max)) {
        consensusDispersionByKey.set(key, clamp(max - min, 0, 1))
      }
    } else {
      consensusDispersionByKey.set(key, 0)
    }
  }

  const playerTeamIndex = buildPlayerTeamIndex(safeRows)
  const playerModelCtx = buildMlbPlayerModelContext(safeRows)
  let playerModelLogged = 0
  let mlbModelTuneLogged = 0

  return safeRows.map((row) => {
    const impliedProbability = impliedProbabilityFromOdds(row?.odds)
    const consensusKey = buildConsensusKey(row)
    const consensusProbability = consensusKey ? consensusMeanByKey.get(consensusKey) : null
    const bookImpliedDispersion = consensusKey ? (consensusDispersionByKey.get(consensusKey) ?? null) : null
    const bookVsConsensusDelta =
      impliedProbability != null && consensusProbability != null
        ? Number((impliedProbability - consensusProbability).toFixed(6))
        : null

    const rowForSignals = {
      ...row,
      consensusImpliedProbability: consensusProbability,
      bookImpliedDispersion,
      bookVsConsensusDelta
    }

    const signalScore = isMlbPhase2PowerMarket(rowForSignals) ? getMlbPowerSignals(rowForSignals) : null
    const signalStrengthTag = isMlbPhase2PowerMarket(rowForSignals) ? getMlbSignalStrengthTag(signalScore) : "neutral"
    const predictedProbabilityBase = estimateMlbHrProbability(rowForSignals, {
      consensusProbability,
      signalScore: signalScore == null ? undefined : signalScore
    })
    const tuneLog = mlbModelTuneLogged < 20
    if (tuneLog) mlbModelTuneLogged += 1
    const predictedProbability = modelMlbPredictedProbability(rowForSignals, {
      impliedProbability,
      basePredictedProbability: predictedProbabilityBase,
      signalScore: signalScore == null ? null : signalScore,
      ctx: playerModelCtx,
      tuneLog
    })
    if (playerModelLogged < 10) {
      playerModelLogged += 1
      console.log("[MLB PLAYER MODEL]", {
        player: row?.player || null,
        propType: row?.propType || null,
        side: row?.side || null,
        odds: row?.odds ?? null,
        impliedProbability,
        oldPredictedProbability: predictedProbabilityBase,
        newPredictedProbability: predictedProbability
      })
    }
    const edgeProbability =
      predictedProbability !== null && impliedProbability !== null
        ? Number((predictedProbability - impliedProbability).toFixed(6))
        : null

    const teamSurfaced =
      String(row?.team || "").trim() ||
      inferSurfaceTeamLabel(row, playerTeamIndex) ||
      String(row?.teamResolved || "").trim() ||
      resolveTeamNameForRowFromCode(row?.teamCode, row) ||
      resolveMlbTeamFromDiskCacheRow(row) ||
      null

    return {
      ...row,
      team: teamSurfaced,
      consensusImpliedProbability: consensusProbability,
      bookImpliedDispersion,
      bookVsConsensusDelta,
      impliedProbability,
      predictedProbability,
      edgeProbability,
      signalScore,
      signalStrengthTag
    }
  })
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

  // Reject only clearly corrupt odds. Standard player props routinely sit outside (-350, +400) American.
  if (isSpecial) {
    if (odds < -250000 || odds > 250000) return "odds_out_of_range"
  } else if (isLadder) {
    if (odds < -250000 || odds > 250000) return "odds_out_of_range"
  } else {
    if (odds < -250000 || odds > 250000) return "odds_out_of_range"
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
      const extraResponse = await axios.get(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventId)}/odds`, {
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
  if (!eventApiId) {
    console.log("[NBA FETCH]", {
      phase: "event_odds",
      skipped: true,
      reason: "missing_event_api_id",
      pathLabel
    })
    return {
      rows: [],
      extraRawRows: [],
      extraMarketsFetchSucceeded: false,
      normalizedFirstBasketRows: [],
      debug: {
        path: pathLabel,
        eventId: "",
        matchup,
        requestedMarkets: ALL_DK_MARKETS,
        responseReceived: false,
        dkRequestSucceeded: false,
        dkBookmakerEntries: 0,
        dkMarketEntries: 0,
        dkNormalizedRowsProduced: 0,
        normalizedRowsProduced: 0,
        primary: null,
        fallback: null
      }
    }
  }
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
          const bookNameRaw = String(book?.title || book?.key || book?.name || "").trim()
          const bookName = normalizeBookName(bookNameRaw) || bookNameRaw
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
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventApiId)}/odds`,
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
        `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventApiId)}/odds`,
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
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventApiId)}/odds`,
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
  // === HARD refresh guard (global) ===
  // Must run at the very top of the active refresh route.
  let __refreshInProgress = global.__refreshInProgress || false
  let __lastRefreshTime = global.__lastRefreshTime || 0

  if (__refreshInProgress) {
    console.log("[REFRESH GUARD]", { skipped: true, reason: "in_progress" })
    return res.json({ skipped: true, reason: "in_progress" })
  }

  if (Date.now() - __lastRefreshTime < 120000) {
    console.log("[REFRESH GUARD]", { skipped: true, reason: "cooldown" })
    return res.json({ skipped: true, reason: "cooldown" })
  }

  global.__refreshInProgress = true
  try {
    // Existing refresh logic below (do not change)
    global.__lastRefreshTime = Date.now()
  console.log("[REFRESH TRIGGERED]")
  console.log("[SNAPSHOT-DEBUG] START refresh-snapshot")
  const sportKey = normalizeBestAvailableSportKey(req.query?.sport)
  console.log("[REFRESH SNAPSHOT SPORT]", sportKey)

  if (isMlbBestAvailableSportKey(sportKey)) {
    return handleMlbRefreshSnapshotGet(req, res, {
      isMlbOddsReplayRequest,
      loadMlbReplaySnapshotFromDisk,
      hydrateMlbProbabilityLayer,
      ODDS_API_KEY,
      buildMlbBootstrapSnapshot,
      saveMlbReplaySnapshotToDisk,
      getMlbSnapshot: () => mlbSnapshot,
      setMlbSnapshot: (snap) => {
        mlbSnapshot = snap
      },
    })
  }

  await __getNbaRefreshSnapshotHandler()(req, res, buildNbaRefreshSnapshotDepsWithBindings(sportKey))
  console.log("[NBA SNAPSHOT]", {
    events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : 0,
    props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
    rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
  })
  } finally {
    global.__refreshInProgress = false
    console.log("[REFRESH GUARD]", { skipped: false })
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
      scheduledEvents: rawScheduledEvents
    } = await fetchNbaUnrestrictedSlateEvents()
    const slateNow = Date.now()
    const todayDateKey = toDetroitDateKey(slateNow)
    const getEventTime = (event) =>
      event?.commence_time || event?.gameTime || event?.startTime || event?.start_time || event?.game_time || ""
    const LIVE_SLATE_WINDOW_MS = 8 * 60 * 60 * 1000
    const todayLiveOrUpcoming = (Array.isArray(allEvents) ? allEvents : []).filter((event) => {
      const eventMs = new Date(getEventTime(event)).getTime()
      return Number.isFinite(eventMs) &&
        toDetroitDateKey(getEventTime(event)) === todayDateKey &&
        eventMs > (slateNow - LIVE_SLATE_WINDOW_MS)
    })
    const scheduledEvents = (Array.isArray(rawScheduledEvents) ? rawScheduledEvents : []).length
      ? rawScheduledEvents
      : todayLiveOrUpcoming
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

    const scoredPropsBase = matchupValidProps.map((row) => {
      const logs = statsCache.get(row.player) || []
      const mins = (Array.isArray(logs) ? logs : [])
        .map((log) => Number(log?.min || 0))
        .filter((v) => Number.isFinite(v) && v > 0)
      const recent5MinAvg = avg(mins.slice(-5))
      const recent3MinAvg = avg(mins.slice(-3))

      return {
        ...row,
        score: scorePropRow(row),
        dvpScore: scorePropRowForDvp(row),
        avgMin: getPlayerAvgMin(row.player, logs),
        recent5MinAvg: recent5MinAvg == null ? null : Number(recent5MinAvg.toFixed(1)),
        recent3MinAvg: recent3MinAvg == null ? null : Number(recent3MinAvg.toFixed(1)),
        minFloor: getPlayerMinFloor(row.player, logs),
        minStd: getPlayerMinStd(row.player, logs),
        valueStd: getPlayerValueStd(row.player, logs, row.propType),
        recent3Avg: getPlayerRecentAvg(row.player, logs, 3, row.propType),
        recent5Avg: getPlayerRecentAvg(row.player, logs, 5, row.propType),
        l10Avg: getPlayerRecentAvg(row.player, logs, 10, row.propType),
        minutesRisk: getPlayerMinutesRisk(row.player, logs),
        trendRisk: getPlayerTrendRisk(row.player, logs, row.propType),
        injuryRisk: getPlayerInjuryRisk(row.player, logs),
        hitRate: getPlayerHitRate(row.player, logs, row.propType, row.line, row.side),
        edge: getPlayerEdge(row.player, logs, row.propType, row.line, row.side, row.odds)
      }
    })
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

    const hardResetTierSlateMode = detectSlateMode({
      sportKey: "nba",
      snapshotMeta: { snapshotSlateGameCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0 },
      snapshot: { events: scheduledEvents, rawProps: rawPropsRows, props: activeBookRawPropsRows, bestProps: [] },
      runtime: { loadedSlateQualityPassEnabled: true }
    })
    console.log("[TIER-SLATE-MODE]", {
      path: "refresh-snapshot-hard-reset",
      mode: hardResetTierSlateMode.mode,
      metrics: hardResetTierSlateMode.metrics
    })

    const bestPropsSource = dedupedBestCandidates.filter((row) => qualifiesBestPropsSource(row, hardResetTierSlateMode.mode))
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

    // Thin slate adaptation: same as refresh-snapshot path.
    {
      const mode = String(hardResetTierSlateMode?.mode || "").toLowerCase()
      const shouldPromote = mode === "thin" && Array.isArray(bestProps) && bestProps.length < 25 && Array.isArray(playableProps) && playableProps.length > 0
      if (shouldPromote) {
        const target = Math.min(32, Math.max(16, 25))
        const existing = new Set(bestProps.map((r) => `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}`))
        let added = 0
        const rankedPlayable = [...playableProps].sort((a, b) => bestPropsCompositeScore(b) - bestPropsCompositeScore(a))
        for (const r of rankedPlayable) {
          if (bestProps.length >= target) break
          const key = `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}`
          if (!key || existing.has(key)) continue
          if (!playerFitsMatchup(r) || shouldRemoveLegForPlayerStatus(r)) continue
          bestProps.push(r)
          existing.add(key)
          added += 1
        }
        bestProps = dedupeSlipLegs(bestProps).slice(0, BEST_PROPS_BALANCE_CONFIG.totalCap)
        console.log("[THIN-SLATE-BESTPROPS-PROMOTION]", {
          path: "refresh-snapshot-hard-reset",
          mode,
          target,
          added,
          finalBestProps: bestProps.length
        })
      }
    }

    // Final bestProps diversification (player cap + per-propType cap).
    {
      const mode = String(hardResetTierSlateMode?.mode || "").toLowerCase()
      const before = Array.isArray(bestProps) ? bestProps.length : 0
      bestProps = diversifyBestProps(bestProps, {
        slateMode: mode,
        totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
        maxPerPlayer: mode === "thin" ? 3 : 2,
        maxPerPlayerPropType: 1
      })
      console.log("[BEST-PROPS-DIVERSIFY]", {
        path: "refresh-snapshot-hard-reset",
        mode,
        before,
        after: Array.isArray(bestProps) ? bestProps.length : 0
      })
    }
    const eliteProps = bestProps.filter((row) => qualifiesEliteTier(row, hardResetTierSlateMode.mode))
    logFunnelStage("refresh-snapshot-hard-reset", "eliteProps-from-bestProps", bestProps, eliteProps, { threshold: "hit>=0.72,score>=88,minFloor>=24,minStd<=7.5,valueStd<=10.5/5.5" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "eliteProps-from-bestProps", bestProps, eliteProps)
    const strongProps = bestProps.filter((row) => qualifiesStrongTier(row, hardResetTierSlateMode.mode))
    logFunnelStage("refresh-snapshot-hard-reset", "strongProps-from-bestProps", bestProps, strongProps, { threshold: "hit>=0.61,score>=62,minFloor>=22,minStd<=9.5,valueStd<=12/6.5" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "strongProps-from-bestProps", bestProps, strongProps)
    const playableProps = bestProps.filter((row) => qualifiesPlayableTier(row, hardResetTierSlateMode.mode))
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
    oddsSnapshot.props = sanitizeSnapshotRows(oddsSnapshot.props, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
    console.log("[UNSTABLE-GAME-INGEST-DEBUG]", {
      path: "refresh-snapshot-hard-reset",
      targets: targetMissingEventStages.map((stage) => ({
        ...stage,
        inFinalSavedRawProps: (oddsSnapshot.rawProps || []).some((row) => String(row?.eventId || "") === stage.eventId),
        inFinalSavedProps: (oddsSnapshot.props || []).some((row) => String(row?.eventId || "") === stage.eventId)
      }))
    })
    oddsSnapshot.eliteProps = eliteCapped.filter((row) => playerFitsMatchup(row))
    oddsSnapshot.eliteProps = sanitizeSnapshotRows(oddsSnapshot.eliteProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
    logFunnelStage("refresh-snapshot-hard-reset", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps, { filter: "playerFitsMatchup" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps)
    oddsSnapshot.strongProps = strongCapped.filter((row) => playerFitsMatchup(row))
    oddsSnapshot.strongProps = sanitizeSnapshotRows(oddsSnapshot.strongProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
    logFunnelStage("refresh-snapshot-hard-reset", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps, { filter: "playerFitsMatchup" })
    logFunnelExcluded("refresh-snapshot-hard-reset", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps)
    oddsSnapshot.playableProps = playableCapped.filter((row) => playerFitsMatchup(row))
    oddsSnapshot.playableProps = sanitizeSnapshotRows(oddsSnapshot.playableProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
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
    oddsSnapshot.bestProps = sanitizeSnapshotRows(oddsSnapshot.bestProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
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

// === Bet tracker (JSON storage) ===
app.get("/api/bets", async (req, res) => {
  try {
    const bets = await loadBets()
    return res.json({ ok: true, bets })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed loading bets" })
  }
})

app.get("/api/bets/metrics", async (req, res) => {
  try {
    const bets = await loadBets()
    const metrics = computeBetMetrics(bets)
    return res.json({ ok: true, metrics })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed computing bet metrics" })
  }
})

app.get("/api/mlb/picks", (req, res) => {
  try {
    // If picks aren't computed yet (e.g. after /mlb/refresh), compute them from current board.
    // This does not modify the model; it only filters the already-built board.
    if (!mlbPicks || typeof mlbPicks !== "object") {
      mlbPicks = { safeCore: [], valueCore: [], powerCore: [] }
    }
    return res.json({ ok: true, picks: mlbPicks })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed building MLB picks" })
  }
})

app.get("/api/mlb/slips", (req, res) => {
  try {
    if (!Array.isArray(mlbSlips)) mlbSlips = []
    return res.json({ ok: true, slips: mlbSlips })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed building MLB slips" })
  }
})

app.get("/api/mlb/oomph", (req, res) => {
  try {
    return res.json({ ok: true, oomph: mlbOomphSlips })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed building MLB oomph" })
  }
})

app.get("/api/mlb/spikes", (req, res) => {
  try {
    return res.json({ ok: true, spikes: mlbSpikePlayers })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed building MLB spikes" })
  }
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

      mlbSnapshot = {
        ...replaySnapshot,
        rows: hydrateMlbProbabilityLayer(replaySnapshot?.rows)
      }

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
    .map((row) => {
      const pregameContext = buildPregameContext({ sport: "mlb", row })
      return {
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
        impliedProbability: row?.impliedProbability ?? null,
        predictedProbability: row?.predictedProbability ?? null,
        edgeProbability: row?.edgeProbability ?? null,
        signalScore: row?.signalScore ?? null,
        signalStrengthTag: row?.signalStrengthTag ?? null,
        isPitcherMarket: row?.isPitcherMarket === true,
        teamMatchesMatchup: row?.teamMatchesMatchup !== false,
        pregameContext,
        explanationTags: pregameContext.explanationTags
      }
    })

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
