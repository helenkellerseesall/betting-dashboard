"use strict"

const axios = require("axios")

const { getSportConfig } = require("../sports/sportConfig")
const { buildMlbSlateEvents } = require("../schedule/buildMlbSlateEvents")
const {
  inferMlbMarketTypeFromKey,
  isMlbPitcherMarketKey,
  classifyMlbPropFamilyKey
} = require("../markets/mlbClassification")
const { buildPregameContext } = require("../context/pregameContext")
const { mlbRowTeamMatchesMatchup } = require("../resolution/mlbTeamResolution")
const {
  createEmptyMlbExternalSnapshot,
  normalizeMlbExternalSnapshotShape
} = require("./enrichment/buildMlbExternalSnapshotScaffold")
const { enrichMlbRowsWithExternalContext } = require("./enrichment/mergeMlbExternalContext")
const { fetchMlbExternalSnapshot } = require("./external/fetchMlbExternalSnapshot")
const { buildPlayerTeamIndex, inferSurfaceTeamLabel } = require("./buildMlbInspectionBoard")
const { resolveMlbTeamFromDiskCacheRow } = require("../resolution/mlbTeamResolution")

function createEmptyMlbSnapshot() {
  return {
    sport: "mlb",
    updatedAt: null,
    snapshotGeneratedAt: null,
    snapshotSlateDateKey: null,
    events: [],
    rawOddsEvents: [],
    rows: [],
    externalSnapshotMeta: createEmptyMlbExternalSnapshot().diagnostics,
    diagnostics: {
      requestedEventCount: 0,
      fetchedEventCount: 0,
      failedEventCount: 0,
      totalBookmakersSeen: 0,
      totalMarketsSeen: 0,
      totalOutcomesSeen: 0,
      byBook: {},
      byMarketKey: {},
      byMarketFamily: {},
      enrichmentCoverage: {
        totals: {
          totalRows: 0,
          playerRows: 0,
          matchedRows: 0,
          unresolvedRows: 0,
          lowConfidenceRows: 0,
          overallMatchRate: 0
        },
        byMarketFamily: {},
        unresolvedSamples: [],
        lowConfidenceSamples: []
      },
      failedEvents: []
    }
  }
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// American odds (+/-) -> implied probability (0..1)
// Returns null if odds are missing/invalid.
function impliedProbabilityFromOdds(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return null
  if (o > 0) return 100 / (o + 100)
  return Math.abs(o) / (Math.abs(o) + 100)
}

function normalizeOddsStrengthSignal(impliedProbability) {
  const p = Number(impliedProbability)
  if (!Number.isFinite(p)) return null
  const centered = 1 - Math.abs(p - 0.16) / 0.14
  return clamp(centered, 0, 1)
}

function normalizeLineupSpotSignal(battingOrderIndex) {
  const idx = Number(battingOrderIndex)
  if (!Number.isFinite(idx)) return null
  return clamp((10 - idx) / 9, 0, 1)
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
  if (mk.includes("total_bases") || pt.includes("total bases")) return true

  if (!directionOk) return false
  if (mk.includes("batter_hits") || mk.includes("player_hits") || pt.includes("hits")) return true
  if (mk.includes("batter_rbis") || mk.includes("player_rbis") || pt.includes("rbi")) return true
  if (mk.includes("batter_runs") || mk.includes("runs_scored") || mk.includes("player_runs") || pt.includes("runs")) return true
  return false
}

function computeMlbHrPathProxyScore(row) {
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

function normalizePowerMarketBonus(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const pt = String(row?.propType || "").toLowerCase()
  const odds = Number(row?.odds)

  const isHr =
    mk.includes("home_run") ||
    mk.includes("home_runs") ||
    mk.includes("to_hit_home_run") ||
    pt.includes("home run")
  const isFirstHr = mk.includes("first_home_run") || pt.includes("first home run")
  if (!isHr || isFirstHr) return null

  if (!Number.isFinite(odds)) return 0.5
  if (odds >= 300 && odds <= 1200) return 1
  if (odds >= 200 && odds < 300) return 0.75
  if (odds > 1200 && odds <= 1800) return 0.65
  if (odds > 1800) return 0.4
  return 0.55
}

function getMlbSignalStrengthTag(signalScore) {
  const s = Number(signalScore)
  if (!Number.isFinite(s)) return "neutral"
  // Narrow the neutral band to create more visible separation.
  if (s >= 0.75) return "elite power"
  if (s >= 0.6) return "strong"
  if (s >= 0.42) return "neutral"
  return "weak"
}

function getMlbPowerSignals(row) {
  if (!row || typeof row !== "object") return 0.5
  if (!isMlbPhase2PowerMarket(row)) return 0.5
  const implied = impliedProbabilityFromOdds(row?.odds)
  const ctx = buildPregameContext({ sport: "mlb", row })

  const signals = []
  const oddsStrength = normalizeOddsStrengthSignal(implied)
  if (oddsStrength != null) signals.push({ v: oddsStrength, w: 0.22 })

  const dispersion = Number(row?.bookImpliedDispersion)
  if (Number.isFinite(dispersion)) {
    const dispSignal = clamp(dispersion / 0.06, 0, 1)
    signals.push({ v: dispSignal, w: 0.18 })
  }

  const vsConsensus = Number(row?.bookVsConsensusDelta)
  if (Number.isFinite(vsConsensus)) {
    const mispriceSignal = clamp(0.5 + vsConsensus / 0.06, 0, 1)
    signals.push({ v: mispriceSignal, w: 0.14 })
  }

  const mk = String(row?.marketKey || "").toLowerCase()
  const isHrOrTb =
    mk.includes("home_run") ||
    mk.includes("home_runs") ||
    mk.includes("to_hit_home_run") ||
    mk.includes("total_bases")

  if (isHrOrTb) {
    const hrPath = Number(ctx?.powerContext?.homeRunPathScore)
    if (Number.isFinite(hrPath)) signals.push({ v: clamp(hrPath, 0, 1), w: 0.22 })
    else {
      const proxy = computeMlbHrPathProxyScore(row)
      if (proxy != null) signals.push({ v: proxy, w: 0.18 })
    }
  } else {
    const countingProxy = computeMlbOverCountingProxyScore(row)
    if (countingProxy != null) signals.push({ v: countingProxy, w: 0.20 })
  }

  const surface = Number(ctx?.powerContext?.surfaceScore)
  if (Number.isFinite(surface)) signals.push({ v: clamp(surface, 0, 1), w: 0.15 })

  const lineupSpot = normalizeLineupSpotSignal(row?.battingOrderIndex || row?.lineupSpot || row?.battingOrder || null)
  if (lineupSpot != null) signals.push({ v: lineupSpot, w: 0.10 })

  const isHome = ctx?.matchupContext?.isHome
  if (isHome === true) signals.push({ v: 0.62, w: 0.04 })
  if (isHome === false) signals.push({ v: 0.48, w: 0.04 })

  const teamMatches = ctx?.matchupContext?.teamMatchesMatchup
  if (teamMatches === false) signals.push({ v: 0.25, w: 0.06 })

  const idc = Number(ctx?.availabilityContext?.identityConfidence)
  if (Number.isFinite(idc)) {
    const idSignal = clamp((idc - 0.55) / 0.35, 0, 1)
    signals.push({ v: idSignal, w: 0.05 })
  }

  const hrMarket = normalizePowerMarketBonus(row)
  if (hrMarket != null) signals.push({ v: hrMarket, w: 0.05 })

  if (!signals.length) return 0.5
  const weightSum = signals.reduce((acc, s) => acc + s.w, 0) || 1
  const score = signals.reduce((acc, s) => acc + s.v * s.w, 0) / weightSum
  const stretched = clamp(0.08 + score * 1.18, 0, 1)
  return clamp(Number(stretched.toFixed(6)), 0, 1)
}

function mean(values) {
  const safe = Array.isArray(values) ? values.filter((v) => Number.isFinite(Number(v))) : []
  if (!safe.length) return null
  const sum = safe.reduce((acc, v) => acc + Number(v), 0)
  return sum / safe.length
}

function buildConsensusKey(row) {
  // Key should group "same bet" across books; keep it conservative to avoid mixing.
  return [
    String(row?.eventId || ""),
    String(row?.playerKey || row?.player || ""),
    String(row?.marketKey || ""),
    String(row?.propType || ""),
    String(row?.side || ""),
    // Some HR markets have no point/line; still include stable placeholder.
    String(row?.line ?? "")
  ].join("|")
}

function estimateMlbHrProbability(row, context = {}) {
  // Phase 1 foundation: prediction-first layer.
  // If we have no advanced stats yet, default to a consensus odds-derived probability.
  const consensusProb = context?.consensusProbability
  const implied = impliedProbabilityFromOdds(row?.odds)

  const impliedBase =
    Number.isFinite(consensusProb) ? Number(consensusProb) :
    implied !== null ? implied :
    null
  if (impliedBase === null) return null

  if (!isMlbPhase2PowerMarket(row)) {
    return implied == null ? null : clamp(Number(implied.toFixed(6)), 0, 1)
  }

  const signalScore =
    Number.isFinite(Number(context?.signalScore))
      ? Number(context.signalScore)
      : getMlbPowerSignals(row)

  const predictedProbability = (impliedBase * 0.6) + (signalScore * 0.4)
  return clamp(Number(predictedProbability.toFixed(6)), 0, 1)
}

function normalizeSide(outcomeName) {
  const normalized = String(outcomeName || "").trim().toLowerCase()
  if (normalized === "over") return "Over"
  if (normalized === "under") return "Under"
  if (normalized === "yes") return "Yes"
  if (normalized === "no") return "No"
  return null
}

function resolvePlayerName(outcome, normalizedSide) {
  const description = String(outcome?.description || "").trim()
  if (description) return description

  const participant = String(outcome?.participant || "").trim()
  if (participant) return participant

  const name = String(outcome?.name || "").trim()
  if (!name) return ""
  if (normalizedSide && name.toLowerCase() === normalizedSide.toLowerCase()) return ""
  return name
}

function buildRowOutcomeName(outcome) {
  const name = String(outcome?.name || "").trim()
  const description = String(outcome?.description || "").trim()
  if (description && name) return `${description} ${name}`.trim()
  return description || name || ""
}

function canonicalizeMlbPropType(marketKey, internalType) {
  const mk = String(marketKey || "").trim().toLowerCase()
  const it = String(internalType || "").trim()
  if (!it) return null

  // Canonical pitcher prop labels (used downstream in bestProps displays).
  if (mk.startsWith("pitcher_strikeouts")) return "Strikeouts"
  if (mk.startsWith("pitcher_outs")) return "Outs"
  if (mk.startsWith("pitcher_earned_runs")) return "Earned Runs"
  if (mk.startsWith("pitcher_walks")) return "Walks"

  // Canonical specials
  if (mk.startsWith("batter_stolen_bases")) return "Stolen Bases"

  return it
}

function normalizeMlbEventRows({ event, oddsPayload, observedAtIso }) {
  const bookmakers = Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers : []
  const matchup = String(event?.matchup || `${event?.away_team || event?.awayTeam || ""} @ ${event?.home_team || event?.homeTeam || ""}`).trim()

  const rows = []
  const counters = {
    bookmakers: bookmakers.length,
    markets: 0,
    outcomes: 0
  }

  for (const bookmaker of bookmakers) {
    const book = String(bookmaker?.title || bookmaker?.key || "Unknown")
    const markets = Array.isArray(bookmaker?.markets) ? bookmaker.markets : []

    for (const market of markets) {
      counters.markets += 1

      const marketKey = String(market?.key || market?.name || "").trim()
      const inferredBase = inferMlbMarketTypeFromKey(marketKey)
      let inferred = inferredBase
      // Defensive runtime fallback for common game lines seen in bootstrap fallbacks.
      if (String(inferredBase?.family || "") === "unknown") {
        const mk = marketKey.toLowerCase()
        if (mk === "h2h" || mk.includes("moneyline")) {
          inferred = { internalType: "Moneyline", family: "game" }
        } else if (mk === "spreads" || mk.includes("run line") || mk.includes("runline")) {
          inferred = { internalType: "Run Line", family: "game" }
        } else if (mk === "totals" || mk.includes("total runs") || mk.includes("game total")) {
          inferred = { internalType: "Game Total", family: "game" }
        }
      }
      const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : []

      for (const outcome of outcomes) {
        counters.outcomes += 1

        const side = normalizeSide(outcome?.name)
        const player = resolvePlayerName(outcome, side)
        const odds = toNumberOrNull(outcome?.price)
        const line = toNumberOrNull(outcome?.point)
        const propType = canonicalizeMlbPropType(marketKey, inferred.internalType || null)

        // Clean skipping rules (never break pipeline):
        // - player must exist (otherwise can't be tracked/selected)
        // - propType must be a non-empty string (avoid "0" or null)
        // - odds must exist
        // - for standard/ladder markets, line must exist (0.5/1.5/2.5 are valid)
        if (!String(player || "").trim()) continue
        if (!String(propType || "").trim() || String(propType).trim() === "0") continue
        if (!Number.isFinite(Number(odds))) continue
        if ((inferred.family === "standard" || inferred.family === "ladder") && !Number.isFinite(Number(line))) continue

        const row = {
          sport: "mlb",
          source: "odds-api-v4",
          fetchedAt: observedAtIso,

          eventId: String(event?.eventId || event?.id || ""),
          gameTime: event?.gameTime || event?.commence_time || null,
          matchup,
          awayTeam: event?.awayTeam || event?.away_team || "",
          homeTeam: event?.homeTeam || event?.home_team || "",

          book,
          marketKey,
          marketFamily: inferred.family,
          propType,
          propFamilyKey: classifyMlbPropFamilyKey(marketKey, inferred.internalType || null),
          marketName: String(market?.name || marketKey || "").trim() || null,

          player,
          team: null,
          side,
          line,
          odds,
          outcomeName: buildRowOutcomeName(outcome),

          isPitcherMarket: isMlbPitcherMarketKey(marketKey),

          // Game context (populated later per-event; attached here as placeholders so rows have stable keys)
          gameTotal: null,
          moneylineHomeOdds: null,
          moneylineAwayOdds: null
        }

        row.teamMatchesMatchup = mlbRowTeamMatchesMatchup(row)
        rows.push(row)
      }
    }
  }

  return {
    rows,
    counters
  }
}

function buildMlbRowKey(row) {
  return [
    String(row?.eventId || ""),
    String(row?.book || ""),
    String(row?.marketKey || ""),
    String(row?.player || ""),
    String(row?.side || ""),
    String(row?.line ?? ""),
    String(row?.odds ?? ""),
    String(row?.outcomeName || "")
  ].join("|")
}

function dedupeMlbRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const out = []
  for (const row of safeRows) {
    const key = buildMlbRowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function payloadHasMarketKey(payload, marketKey) {
  const target = String(marketKey || "").trim().toLowerCase()
  if (!target) return false
  const bookmakers = Array.isArray(payload?.bookmakers) ? payload.bookmakers : []
  for (const bookmaker of bookmakers) {
    const markets = Array.isArray(bookmaker?.markets) ? bookmaker.markets : []
    for (const market of markets) {
      const key = String(market?.key || market?.name || "").trim().toLowerCase()
      if (key === target) return true
    }
  }
  return false
}

function payloadHasAnyMarketKey(payload, marketKeys) {
  const safeMarketKeys = Array.isArray(marketKeys) ? marketKeys : []
  for (const key of safeMarketKeys) {
    if (payloadHasMarketKey(payload, key)) return true
  }
  return false
}

function extractMlbGameContextFromOddsPayload({ oddsPayload, event }) {
  const bookmakers = Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers : []
  const awayTeam = String(event?.awayTeam || event?.away_team || "").trim()
  const homeTeam = String(event?.homeTeam || event?.home_team || "").trim()
  const awayNorm = awayTeam ? String(awayTeam).trim().toLowerCase() : ""
  const homeNorm = homeTeam ? String(homeTeam).trim().toLowerCase() : ""

  let gameTotal = null
  let moneylineHomeOdds = null
  let moneylineAwayOdds = null

  const preferredBooks = new Set(["DraftKings", "FanDuel", "draftkings", "fanduel"])

  const scan = (preferBookmakers) => {
    for (const bookmaker of preferBookmakers) {
      const markets = Array.isArray(bookmaker?.markets) ? bookmaker.markets : []
      for (const market of markets) {
        const key = String(market?.key || market?.name || "").trim().toLowerCase()
        const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : []

        if (key === "totals" && gameTotal == null) {
          const pts = []
          for (const o of outcomes) {
            const p = toNumberOrNull(o?.point)
            // Ignore bogus/empty totals (0/negative). MLB totals should be > 0.
            if (Number.isFinite(Number(p)) && Number(p) > 0.5) pts.push(Number(p))
          }
          if (pts.length) {
            // Use the most common line if multiple are present.
            const counts = new Map()
            for (const p of pts) counts.set(p, (counts.get(p) || 0) + 1)
            let best = pts[0]
            let bestC = 0
            for (const [p, c] of counts.entries()) {
              if (c > bestC) {
                bestC = c
                best = p
              }
            }
            gameTotal = best
          }
        }

        if (key === "h2h" && (moneylineHomeOdds == null || moneylineAwayOdds == null)) {
          for (const o of outcomes) {
            const name = String(o?.name || "").trim()
            const nameNorm = name ? String(name).trim().toLowerCase() : ""
            const price = toNumberOrNull(o?.price)
            if (!Number.isFinite(Number(price))) continue
            if (homeNorm && nameNorm && nameNorm == homeNorm) moneylineHomeOdds = price
            if (awayNorm && nameNorm && nameNorm == awayNorm) moneylineAwayOdds = price
          }
        }
      }
    }
  }

  const preferred = bookmakers.filter((b) => preferredBooks.has(String(b?.title || b?.key || "").trim()))
  scan(preferred.length ? preferred : bookmakers)
  if (preferred.length) scan(bookmakers) // fill gaps

  return {
    gameTotal: gameTotal != null && Number.isFinite(Number(gameTotal)) ? Number(gameTotal) : null,
    moneylineHomeOdds: moneylineHomeOdds != null && Number.isFinite(Number(moneylineHomeOdds)) ? Number(moneylineHomeOdds) : null,
    moneylineAwayOdds: moneylineAwayOdds != null && Number.isFinite(Number(moneylineAwayOdds)) ? Number(moneylineAwayOdds) : null
  }
}

const ANYTIME_HOME_RUN_MARKET_KEYS = [
  "batter_home_runs",
  "player_home_runs",
  "anytime_home_run",
  "to_hit_home_run",
  "home_runs"
]

function addCount(bucket, key) {
  const normalizedKey = String(key || "Unknown")
  bucket[normalizedKey] = Number(bucket[normalizedKey] || 0) + 1
}

function summarizeRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const summary = {
    byBook: {},
    byMarketKey: {},
    byMarketFamily: {}
  }

  for (const row of safeRows) {
    addCount(summary.byBook, row?.book)
    addCount(summary.byMarketKey, row?.marketKey)
    addCount(summary.byMarketFamily, row?.marketFamily)
  }

  return summary
}

function extractOddsPayload(rawResponseData, eventId) {
  const data = rawResponseData

  // Common shape for event odds endpoint.
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.bookmakers)) {
    return data
  }

  // Some clients/providers can wrap payload under `data`.
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data.data &&
    typeof data.data === "object" &&
    Array.isArray(data.data.bookmakers)
  ) {
    return data.data
  }

  // Fallback: array payload. Use matching event if present, else first row with bookmakers.
  if (Array.isArray(data)) {
    const id = String(eventId || "")
    const byId = data.find((row) => {
      const rowId = String(row?.id || row?.eventId || "")
      return id && rowId === id
    })
    if (byId && Array.isArray(byId?.bookmakers)) return byId

    const firstWithBooks = data.find((row) => Array.isArray(row?.bookmakers))
    if (firstWithBooks) return firstWithBooks
  }

  return {}
}

function describePayloadShape(rawResponseData, normalizedPayload) {
  const raw = rawResponseData
  const normalized = normalizedPayload
  return {
    rawType: Array.isArray(raw) ? "array" : typeof raw,
    rawKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw).slice(0, 20) : [],
    rawArrayLength: Array.isArray(raw) ? raw.length : null,
    normalizedBookmakersCount: Array.isArray(normalized?.bookmakers) ? normalized.bookmakers.length : 0,
    normalizedKeys: normalized && typeof normalized === "object" ? Object.keys(normalized).slice(0, 20) : []
  }
}

async function fetchMlbEventOdds({ oddsApiKey, eventId, bookmakersCsv, marketsCsv }) {
  const endpoint = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`

  const params = {
    apiKey: oddsApiKey,
    regions: "us",
    oddsFormat: "american"
  }

  if (bookmakersCsv) params.bookmakers = bookmakersCsv
  if (marketsCsv) params.markets = marketsCsv

  return axios.get(endpoint, {
    params,
    timeout: 15000
  })
}

function parseInvalidMarketsFromError(error) {
  const data = error?.response?.data
  const message = String(data?.message || "")
  if (!message.toLowerCase().includes("invalid markets:")) return []

  const invalidPortion = message.split(":").slice(1).join(":")
  if (!invalidPortion) return []

  return invalidPortion
    .split(",")
    .map((v) => String(v || "").trim())
    .filter(Boolean)
}

function normalizeMarketList(values) {
  const safeValues = Array.isArray(values) ? values : []
  return [...new Set(safeValues.map((v) => String(v || "").trim()).filter(Boolean))]
}

function buildMarketRequestList(mlbConfig) {
  const base = Array.isArray(mlbConfig?.baseMarkets) ? mlbConfig.baseMarkets : []
  const extra = Array.isArray(mlbConfig?.extraMarkets) ? mlbConfig.extraMarkets : []
  const merged = normalizeMarketList([...base, ...extra])

  if (merged.length > 0) return merged

  // Safety fallback in case config is missing.
  return [
    "player_hits",
    "player_total_bases",
    "player_home_runs",
    "player_strikeouts",
    "player_pitcher_strikeouts"
  ]
}

async function buildMlbBootstrapSnapshot({ oddsApiKey, now = Date.now(), externalSnapshot = null, externalSourceName = null }) {
  const mlbConfig = getSportConfig("mlb")
  if (!mlbConfig) {
    throw new Error("MLB sport config missing")
  }

  const bookmakersCsv = (Array.isArray(mlbConfig.activeBooks) ? mlbConfig.activeBooks : ["DraftKings", "FanDuel"])
    .map((book) => String(book || "").toLowerCase())
    .join(",")

  const marketRequestList = buildMarketRequestList(mlbConfig)
  const marketsCsv = marketRequestList.join(",")

  const observedAtIso = new Date(now).toISOString()
  const { slateDateKey, allEvents, scheduledEvents } = await buildMlbSlateEvents({
    oddsApiKey,
    now
  })
  const allEventsSafe = Array.isArray(allEvents) ? allEvents : []
  const scheduledEventsSafe = Array.isArray(scheduledEvents) ? scheduledEvents : []
  const scheduledEventIds = new Set(
    scheduledEventsSafe
      .map((event) => String(event?.eventId || event?.id || "").trim())
      .filter(Boolean)
  )
  const outOfSlateEventsSample = allEventsSafe
    .filter((event) => {
      const eventId = String(event?.eventId || event?.id || "").trim()
      return eventId && !scheduledEventIds.has(eventId)
    })
    .slice(0, 8)
    .map((event) => ({
      eventId: String(event?.eventId || event?.id || "").trim() || null,
      matchup: event?.matchup || null,
      commenceTime: event?.commence_time || event?.gameTime || null,
      detroitDateKey: event?.detroitDateKey || null
    }))

  const rows = []
  const rawOddsEvents = []
  const failedEvents = []
  const invalidMarketsDetected = new Set()
  const fallbackRetryEvents = []
  const emptyBookmakerFallbackEvents = []
  const supplementalAnytimeHomeRunFetchEvents = []
  const supplementalSpecialFetchEvents = []
  const payloadShapes = []

  let totalBookmakersSeen = 0
  let totalMarketsSeen = 0
  let totalOutcomesSeen = 0

  // Sequential fetch is safer for initial bootstrap and easier on API limits.
  for (const event of scheduledEventsSafe) {
    const eventId = String(event?.eventId || event?.id || "")
    if (!eventId) continue

    try {
      const startedAtMs = Date.now()
      let response
      let marketsUsed = marketRequestList

      try {
        response = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          bookmakersCsv,
          marketsCsv
        })
      } catch (error) {
        const invalidMarkets = parseInvalidMarketsFromError(error)
        if (!invalidMarkets.length) throw error

        for (const invalidMarket of invalidMarkets) {
          invalidMarketsDetected.add(invalidMarket)
        }

        const invalidSet = new Set(invalidMarkets)
        const fallbackMarkets = normalizeMarketList(
          marketRequestList.filter((market) => !invalidSet.has(market))
        )

        if (!fallbackMarkets.length) throw error

        marketsUsed = fallbackMarkets
        response = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          bookmakersCsv,
          marketsCsv: fallbackMarkets.join(",")
        })

        fallbackRetryEvents.push({
          eventId,
          matchup: event?.matchup || null,
          removedInvalidMarkets: invalidMarkets,
          fallbackMarketsUsed: fallbackMarkets
        })
      }

      let oddsPayload = extractOddsPayload(response?.data, eventId)

      // If request succeeded but yielded no bookmaker payload, broaden the query
      // so bootstrap can still materialize inspectable MLB rows.
      const initialBookmakerCount = Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers.length : 0
      if (initialBookmakerCount === 0) {
        const fallbackAttempts = []

        const noBookFilterResponse = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          marketsCsv: Array.isArray(marketsUsed) && marketsUsed.length ? marketsUsed.join(",") : null
        })
        let noBookFilterPayload = extractOddsPayload(noBookFilterResponse?.data, eventId)
        let noBookFilterCount = Array.isArray(noBookFilterPayload?.bookmakers) ? noBookFilterPayload.bookmakers.length : 0
        fallbackAttempts.push({ type: "all-books-same-markets", bookmakers: noBookFilterCount })

        if (noBookFilterCount === 0) {
          const broadMarketResponse = await fetchMlbEventOdds({
            oddsApiKey,
            eventId,
            marketsCsv: "h2h,spreads,totals"
          })
          noBookFilterPayload = extractOddsPayload(broadMarketResponse?.data, eventId)
          noBookFilterCount = Array.isArray(noBookFilterPayload?.bookmakers) ? noBookFilterPayload.bookmakers.length : 0
          fallbackAttempts.push({ type: "all-books-broad-markets", bookmakers: noBookFilterCount })
        }

        if (noBookFilterCount > 0) {
          oddsPayload = noBookFilterPayload
        }

        emptyBookmakerFallbackEvents.push({
          eventId,
          matchup: event?.matchup || null,
          initialBookmakers: initialBookmakerCount,
          finalBookmakers: noBookFilterCount,
          attempts: fallbackAttempts
        })
      }

      const payloadShape = describePayloadShape(response?.data, oddsPayload)
      payloadShapes.push({ eventId, source: "primary", ...payloadShape })

      const payloadsForNormalization = [oddsPayload]

      // Preserve true anytime-HR availability even when configured books are sparse.
      // We supplement with all-books anytime-HR if primary payload does not contain it.
      if (!payloadHasAnyMarketKey(oddsPayload, ANYTIME_HOME_RUN_MARKET_KEYS)) {
        try {
          const supplementalAnytimeResponse = await fetchMlbEventOdds({
            oddsApiKey,
            eventId,
            marketsCsv: "batter_home_runs"
          })
          const supplementalAnytimePayload = extractOddsPayload(supplementalAnytimeResponse?.data, eventId)
          const supplementalAnytimeBookCount = Array.isArray(supplementalAnytimePayload?.bookmakers)
            ? supplementalAnytimePayload.bookmakers.length
            : 0

          if (supplementalAnytimeBookCount > 0 && payloadHasAnyMarketKey(supplementalAnytimePayload, ANYTIME_HOME_RUN_MARKET_KEYS)) {
            payloadsForNormalization.push(supplementalAnytimePayload)
            payloadShapes.push({
              eventId,
              source: "supplemental-anytime-hr",
              ...describePayloadShape(supplementalAnytimeResponse?.data, supplementalAnytimePayload)
            })
            supplementalAnytimeHomeRunFetchEvents.push({
              eventId,
              matchup: event?.matchup || null,
              bookmakers: supplementalAnytimeBookCount,
              market: "batter_home_runs",
              added: true
            })
          }
        } catch (_) {
          // Non-fatal: true HR supplemental is additive for inspection/surfacing only.
        }
      }

      // Preserve a special lane even when configured books focus on standard props.
      // We supplement with all-books first-home-run if primary payload does not contain it.
      if (!payloadHasMarketKey(oddsPayload, "batter_first_home_run")) {
        try {
          const supplementalResponse = await fetchMlbEventOdds({
            oddsApiKey,
            eventId,
            marketsCsv: "batter_first_home_run"
          })
          const supplementalPayload = extractOddsPayload(supplementalResponse?.data, eventId)
          const supplementalBookCount = Array.isArray(supplementalPayload?.bookmakers)
            ? supplementalPayload.bookmakers.length
            : 0
          if (supplementalBookCount > 0) {
            payloadsForNormalization.push(supplementalPayload)
            payloadShapes.push({
              eventId,
              source: "supplemental-special",
              ...describePayloadShape(supplementalResponse?.data, supplementalPayload)
            })
            supplementalSpecialFetchEvents.push({
              eventId,
              matchup: event?.matchup || null,
              bookmakers: supplementalBookCount,
              market: "batter_first_home_run",
              added: true
            })
          }
        } catch (_) {
          // Non-fatal: special market is additive for inspection only.
        }
      }

      // Game context (totals + moneylines) is attach-only. Fetch it separately so
      // game-market availability/shape cannot degrade the player-prop request list.
      const payloadsForGameContext = [...payloadsForNormalization]
      try {
        const ctxResponse = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          marketsCsv: "h2h,totals"
        })
        const ctxPayload = extractOddsPayload(ctxResponse?.data, eventId)
        if (ctxPayload && Array.isArray(ctxPayload?.bookmakers) && ctxPayload.bookmakers.length > 0) {
          payloadsForGameContext.push(ctxPayload)
        }
      } catch (_) {
        // Non-fatal: context is additive only.
      }

      rawOddsEvents.push({
        eventId,
        awayTeam: event?.awayTeam || event?.away_team || "",
        homeTeam: event?.homeTeam || event?.home_team || "",
        commenceTime: event?.commence_time || event?.gameTime || null,
        bookmakers: Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers.length : 0,
        marketsRequested: marketsUsed,
        payloadShape
      })

      const eventRowsMerged = []
      let eventBookmakersSeen = 0
      let eventMarketsSeen = 0
      let eventOutcomesSeen = 0

      // Attach game context (totals + moneylines) to every player prop row for this event.
      // This is enrichment only; scoring/selection layers may choose to use it later.
      let mergedGameCtx = { gameTotal: null, moneylineHomeOdds: null, moneylineAwayOdds: null }
      for (const payloadForCtx of payloadsForGameContext) {
        const ctx = extractMlbGameContextFromOddsPayload({ oddsPayload: payloadForCtx, event })
        if (mergedGameCtx.gameTotal == null && ctx.gameTotal != null) mergedGameCtx.gameTotal = ctx.gameTotal
        if (mergedGameCtx.moneylineHomeOdds == null && ctx.moneylineHomeOdds != null) mergedGameCtx.moneylineHomeOdds = ctx.moneylineHomeOdds
        if (mergedGameCtx.moneylineAwayOdds == null && ctx.moneylineAwayOdds != null) mergedGameCtx.moneylineAwayOdds = ctx.moneylineAwayOdds
      }

      for (const payloadForNormalization of payloadsForNormalization) {
        const normalized = normalizeMlbEventRows({
          event,
          oddsPayload: payloadForNormalization,
          observedAtIso
        })
        const normalizedRows = Array.isArray(normalized?.rows) ? normalized.rows : []
        for (const r of normalizedRows) {
          r.gameTotal = mergedGameCtx.gameTotal
          r.moneylineHomeOdds = mergedGameCtx.moneylineHomeOdds
          r.moneylineAwayOdds = mergedGameCtx.moneylineAwayOdds
        }
        eventRowsMerged.push(...normalizedRows)
        eventBookmakersSeen += Number(normalized?.counters?.bookmakers || 0)
        eventMarketsSeen += Number(normalized?.counters?.markets || 0)
        eventOutcomesSeen += Number(normalized?.counters?.outcomes || 0)
      }

      const eventRows = dedupeMlbRows(eventRowsMerged)
      rows.push(...eventRows)

      totalBookmakersSeen += eventBookmakersSeen
      totalMarketsSeen += eventMarketsSeen
      totalOutcomesSeen += eventOutcomesSeen

      if (eventRows.length === 0) {
        console.log("[MLB-EVENT-ODDS-DEBUG]", {
          eventId,
          matchup: event?.matchup || null,
          ms: Date.now() - startedAtMs,
          bookmakersSeen: eventBookmakersSeen,
          marketsSeen: eventMarketsSeen,
          outcomesSeen: eventOutcomesSeen,
          rowsProduced: eventRows.length,
          payloadShape
        })
      }
    } catch (error) {
      failedEvents.push({
        eventId,
        matchup: event?.matchup || null,
        error: error?.response?.data || error?.message || "Unknown error"
      })
    }
  }

  let resolvedExternalSnapshot
  if (externalSnapshot && typeof externalSnapshot === "object") {
    resolvedExternalSnapshot = normalizeMlbExternalSnapshotShape(externalSnapshot, { now })
  } else {
    resolvedExternalSnapshot = await fetchMlbExternalSnapshot({
      events: scheduledEvents,
      now,
      sourceName: externalSourceName,
      sourceOptions: {
        ...(mlbConfig?.externalData && typeof mlbConfig.externalData === "object"
          ? mlbConfig.externalData
          : {})
      }
    })
  }

  const normalizedExternalSnapshot = normalizeMlbExternalSnapshotShape(
    resolvedExternalSnapshot || createEmptyMlbExternalSnapshot({ now }),
    { now }
  )

  const enrichmentResult = enrichMlbRowsWithExternalContext({
    rows,
    externalSnapshot: normalizedExternalSnapshot
  })

  const enrichedRows = Array.isArray(enrichmentResult?.rows) ? enrichmentResult.rows : []

  // -------------------------------------------------------------------------
  // Phase 2: Signal-driven probability for HR/power markets
  // - impliedProbability from each row's posted odds
  // - predictedProbability blends consensus implied (cross-book) + signalScore (0..1)
  // - non-power markets keep predicted == implied (stable)
  // -------------------------------------------------------------------------

  const consensusByKey = new Map()
  for (const row of enrichedRows) {
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
    const meanVal = sum / probs.length
    if (!Number.isFinite(meanVal)) continue
    consensusMeanByKey.set(key, clamp(meanVal, 0, 1))

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

  const playerTeamIndex = buildPlayerTeamIndex(enrichedRows)

  const rowsWithProbability = enrichedRows.map((row) => {
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
    const predictedProbability = estimateMlbHrProbability(rowForSignals, {
      consensusProbability,
      signalScore: signalScore == null ? undefined : signalScore
    })
    const edgeProbability =
      predictedProbability !== null && impliedProbability !== null
        ? Number((predictedProbability - impliedProbability).toFixed(6))
        : null

    const gameTotal = toNumberOrNull(row?.gameTotal)
    const mlHome = toNumberOrNull(row?.moneylineHomeOdds)
    const mlAway = toNumberOrNull(row?.moneylineAwayOdds)
    let impliedTeamTotal = null
    if (Number.isFinite(Number(gameTotal)) && Number.isFinite(Number(mlHome)) && Number.isFinite(Number(mlAway))) {
      const pHome = impliedProbabilityFromOdds(mlHome)
      const pAway = impliedProbabilityFromOdds(mlAway)
      if (pHome != null && pAway != null && (pHome + pAway) > 0) {
        const shareHome = pHome / (pHome + pAway)
        const homeRuns = Number((Number(gameTotal) * shareHome).toFixed(3))
        const awayRuns = Number((Number(gameTotal) - homeRuns).toFixed(3))
        if (row?.isHome === true) impliedTeamTotal = homeRuns
        else if (row?.isHome === false) impliedTeamTotal = awayRuns
      }
    }

    const teamSurfaced =
      String(row?.team || "").trim() ||
      inferSurfaceTeamLabel(row, playerTeamIndex) ||
      String(row?.teamResolved || "").trim() ||
      resolveMlbTeamFromDiskCacheRow(row) ||
      null

    return {
      ...row,
      gameTotal: gameTotal,
      impliedTeamTotal,
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

  const summary = summarizeRows(enrichedRows)

  console.log("[MLB PIPELINE DEBUG]", {
    events: Array.isArray(scheduledEventsSafe) ? scheduledEventsSafe.length : 0,
    props: Number(totalOutcomesSeen || 0),
    rows: Array.isArray(rowsWithProbability) ? rowsWithProbability.length : 0,
    rawOddsEvents: Array.isArray(rawOddsEvents) ? rawOddsEvents.length : 0,
    totalBookmakersSeen,
    totalMarketsSeen,
    totalOutcomesSeen,
    failedEvents: Array.isArray(failedEvents) ? failedEvents.length : 0,
    payloadShapes: Array.isArray(payloadShapes) ? payloadShapes.length : 0,
    samplePayloadShapes: Array.isArray(payloadShapes) ? payloadShapes.slice(0, 4) : []
  })

  return {
    sport: "mlb",
    updatedAt: observedAtIso,
    snapshotGeneratedAt: observedAtIso,
    snapshotSlateDateKey: slateDateKey,
    events: scheduledEventsSafe,
    rawOddsEvents,
    rows: rowsWithProbability,
    externalSnapshotMeta: enrichmentResult?.externalSnapshotMeta || {
      generatedAt: normalizedExternalSnapshot.generatedAt,
      source: normalizedExternalSnapshot.source,
      version: normalizedExternalSnapshot.version,
      hasExternalData: normalizedExternalSnapshot?.diagnostics?.hasExternalData === true,
      playerKeyCount: Number(normalizedExternalSnapshot?.diagnostics?.playerKeyCount || 0),
      eventContextCount: Number(normalizedExternalSnapshot?.diagnostics?.eventContextCount || 0),
      playersByEventCount: Number(normalizedExternalSnapshot?.diagnostics?.playersByEventCount || 0)
    },
    diagnostics: {
      totalDiscoveredEventCount: allEventsSafe.length,
      requestedEventCount: scheduledEventsSafe.length,
      fetchedEventCount: rawOddsEvents.length,
      failedEventCount: failedEvents.length,
      outOfSlateEventCount: Math.max(allEventsSafe.length - scheduledEventsSafe.length, 0),
      outOfSlateEventsSample,
      totalBookmakersSeen,
      totalMarketsSeen,
      totalOutcomesSeen,
      byBook: summary.byBook,
      byMarketKey: summary.byMarketKey,
      byMarketFamily: summary.byMarketFamily,
      marketRequestList,
      invalidMarketsDetected: [...invalidMarketsDetected],
      fallbackRetryEventCount: fallbackRetryEvents.length,
      fallbackRetryEvents,
      emptyBookmakerFallbackEventCount: emptyBookmakerFallbackEvents.length,
      emptyBookmakerFallbackEvents,
      supplementalAnytimeHomeRunFetchEventCount: supplementalAnytimeHomeRunFetchEvents.length,
      supplementalAnytimeHomeRunFetchEvents,
      supplementalSpecialFetchEventCount: supplementalSpecialFetchEvents.length,
      supplementalSpecialFetchEvents,
      enrichmentCoverage: enrichmentResult?.diagnostics || {
        totals: {
          totalRows: enrichedRows.length,
          playerRows: 0,
          matchedRows: 0,
          unresolvedRows: 0,
          lowConfidenceRows: 0,
          overallMatchRate: 0
        },
        byMarketFamily: {},
        unresolvedSamples: [],
        lowConfidenceSamples: []
      },
      externalFetchReadiness: (normalizedExternalSnapshot?.diagnostics && normalizedExternalSnapshot.diagnostics.fetchReadiness) || null,
      payloadShapes,
      failedEvents
    }
  }
}

module.exports = {
  createEmptyMlbSnapshot,
  buildMlbBootstrapSnapshot
}
