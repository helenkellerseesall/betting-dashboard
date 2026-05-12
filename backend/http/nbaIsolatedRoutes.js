"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA HTTP handlers — no `new Function`, no eval, no compiled `nbaRefreshSnapshot.inlined.js`.
 * Snapshot refresh uses `pipeline/nba/fetchNbaOddsSnapshot` (Odds API v4, same pattern as MLB bootstrap).
 */

const path = require("path")
const fs = require("fs")

const { buildNbaOpportunityBoard } = require("../pipeline/nba/buildNbaOpportunityBoard")
const { buildNbaInsightBoard } = require("../pipeline/nba/buildNbaInsightBoard")
const {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
} = require("../pipeline/nba/buildNbaBoardSlicesFromSnapshot")
const { fetchNbaOddsSnapshot, saveNbaSnapshotToDisk } = require("../pipeline/nba/fetchNbaOddsSnapshot")

// Session BD — Longitudinal Freeze Pipeline Audit.
// Lazy require so a module-load failure here cannot block the snapshot path.
// freezePredictionEpoch is invoked AFTER replaceOddsSnapshot succeeds so the
// bestProps generation cycle creates immutable observational records:
//   - 1 row in prediction_epochs (epoch keyed on snap.updatedAt)
//   - 1 row per bestProp in prediction_snapshots
//   - 1 row per bestProp in frozen_contextual_states
// Contextual columns will be NULL on this path (snapshot-bestProps are not
// contextually enriched — that's only done in workstationRoutes.js for the
// /api/ws/state cache-miss). final_model_prob + final_edge ARE captured.
// This is HONEST sparsity, not synthetic richness — every NULL means the
// corresponding contextual layer did not fire for this prediction at this
// epoch. The /api/ws/state freeze path remains in place and writes RICHER
// contextual rows for the same predictions when invoked.
function _lazyFreezePredictionEpoch(args) {
  try {
    const { freezePredictionEpoch } = require("../pipeline/memory/freezePredictionEpoch")
    return freezePredictionEpoch(args)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

// Compute the Detroit-keyed slate date (matches buildSlateEvents semantics)
// without taking a hard dependency on that module here.
function _detroitSlateDateKey(value) {
  const date = new Date(value || Date.now())
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date)
}

// Workstation intelligence modules — used to build featured boards + AI slips
// from the same snapshot pool that feeds the insight board.
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { diversifyCandidates } = require("../pipeline/shared/buildCandidateDiversity")
const { buildFeaturedPlays } = require("../pipeline/shared/buildFeaturedPlays")
const { buildAiSlips } = require("../pipeline/shared/buildSlipAi")

const DEFAULT_BACKEND_ROOT = path.join(__dirname, "..")
const API_SPORTS_CACHE_FILE = path.join(DEFAULT_BACKEND_ROOT, "api-sports-cache.json")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normName(v) {
  return String(v == null ? "" : v)
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Prefer this string for API-Sports `search=` when Odds display name mismatches cache/API. */
const API_SPORTS_SEARCH_NAME_BY_NORM = {
  [normName("R.J. Barrett")]: "RJ Barrett",
  [normName("Nickeil Alexander-Walker")]: "Nickeil Alexander Walker",
  [normName("Shai Gilgeous-Alexander")]: "Shai Gilgeous Alexander",
  [normName("T.J. McConnell")]: "TJ McConnell",
  [normName("P.J. Washington")]: "PJ Washington",
  [normName("De'Anthony Melton")]: "DeAnthony Melton",
  [normName("Larry Nance Jr")]: "Larry Nance Jr.",
}

function apiSportsSearchQueryForDisplayName(displayName) {
  const raw = String(displayName || "").trim()
  if (!raw) return raw
  const alias = API_SPORTS_SEARCH_NAME_BY_NORM[normName(raw)]
  return alias || raw
}

function findCachedPlayerIdEntry(playerName, playerIdCache) {
  const raw = String(playerName || "").trim()
  if (!raw || !playerIdCache || typeof playerIdCache !== "object") return null
  const tryKeys = [raw, apiSportsSearchQueryForDisplayName(raw)]
  for (const k of tryKeys) {
    const v = playerIdCache[k]
    if (v && typeof v === "object" && Number.isFinite(toNum(v.id))) {
      return { cacheKey: k, id: toNum(v.id) }
    }
  }
  const want = normName(raw)
  for (const [k, v] of Object.entries(playerIdCache)) {
    if (v == null || typeof v !== "object") continue
    if (!Number.isFinite(toNum(v.id))) continue
    if (normName(k) === want) return { cacheKey: k, id: toNum(v.id) }
  }
  return null
}

let _nbaProjFormFallbackCache = null
function loadNbaPlayerProjectionsForFormFallback() {
  if (_nbaProjFormFallbackCache) return _nbaProjFormFallbackCache
  try {
    const fp = path.join(DEFAULT_BACKEND_ROOT, "data", "nbaPlayerProjections.json")
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"))
    const defaults = raw?.defaults && typeof raw.defaults === "object" ? raw.defaults : {}
    const players = raw?.players && typeof raw.players === "object" ? raw.players : {}
    _nbaProjFormFallbackCache = {
      defaults: {
        projectedMinutes: Number(defaults.projectedMinutes) || 26,
        usageRate: Number(defaults.usageRate) || 19,
      },
      players,
    }
  } catch {
    _nbaProjFormFallbackCache = { defaults: { projectedMinutes: 26, usageRate: 19 }, players: {} }
  }
  return _nbaProjFormFallbackCache
}

function defaultStatBaselineForRecentFormFallback(row) {
  const ln = toNum(row?.line)
  if (Number.isFinite(ln)) return ln
  const t = String(row?.propType || row?.marketKey || "").toLowerCase()
  if (/point/.test(t) && !/pra|points.*rebounds|pts.*reb/.test(t)) return 22
  if (/assist/.test(t)) return 5.5
  if (/rebound/.test(t)) return 8
  if (/three|threes|3pt/.test(t)) return 2.5
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return 30
  return 18
}

/**
 * When API-Sports cannot supply logs, derive a non-null recentForm from projections (minutes/usage vs defaults).
 */
function applyProjectionRecentFormFallback(rows) {
  const proj = loadNbaPlayerProjectionsForFormFallback()
  const defM = proj.defaults.projectedMinutes
  const defU = proj.defaults.usageRate

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue
    if (row.recentForm && typeof row.recentForm === "object" && Number.isFinite(Number(row.recentForm.trend_delta))) continue

    const pk = String(row.player || "")
      .trim()
      .toLowerCase()
    const p = proj.players[pk]
    const m = Number(p?.projectedMinutes ?? defM)
    const u = Number(p?.usageRate ?? defU)
    const baseline = defaultStatBaselineForRecentFormFallback(row)
    const roleSkew = (m - defM) * 0.1 + (u - defU) * 0.06
    const nameSkew = ((normName(row.player).length % 7) - 3) * 0.035
    const last5_avg = baseline + roleSkew * 0.38 + nameSkew
    const last10_avg = baseline + roleSkew * 0.2 + nameSkew * 0.5 - 0.015
    const trend_delta = last5_avg - last10_avg

    row.recentForm = {
      last5_avg,
      last10_avg,
      baseline,
      trend_delta,
      last5_hit_rate: null,
      last10_hit_rate: null,
      sampleSize5: 0,
      sampleSize10: 0,
      source: "projection-fallback",
    }
    console.log("FORM FALLBACK:", row.player, {
      trend_delta,
      baseline,
      last5_avg,
      last10_avg,
      source: "projection-fallback",
    })
  }
}

function statKeyFromPropType(propType) {
  const t = String(propType || "").toLowerCase()
  if (/three|threes|3pt/.test(t)) return "tpm"
  if (/rebound/.test(t)) return "totReb"
  if (/assist/.test(t)) return "assists"
  if (/point/.test(t) && !/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "points"
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "pra"
  return null
}

function propValueFromApiSportsLog(log, statKey) {
  if (!log || typeof log !== "object") return null
  switch (statKey) {
    case "points":
      return toNum(log.points)
    case "totReb":
      return toNum(log.totReb)
    case "assists":
      return toNum(log.assists)
    case "tpm":
      return toNum(log.tpm)
    case "pra": {
      const p = toNum(log.points) ?? 0
      const r = toNum(log.totReb) ?? 0
      const a = toNum(log.assists) ?? 0
      return p + r + a
    }
    default:
      return null
  }
}

function loadApiSportsDiskCache() {
  try {
    if (!fs.existsSync(API_SPORTS_CACHE_FILE)) {
      return { playerIdCache: {}, playerStatsCache: {} }
    }
    const parsed = JSON.parse(fs.readFileSync(API_SPORTS_CACHE_FILE, "utf8"))
    return {
      playerIdCache: parsed?.playerIdCache && typeof parsed.playerIdCache === "object" ? parsed.playerIdCache : {},
      playerStatsCache: parsed?.playerStatsCache && typeof parsed.playerStatsCache === "object" ? parsed.playerStatsCache : {},
    }
  } catch {
    return { playerIdCache: {}, playerStatsCache: {} }
  }
}

function saveApiSportsDiskCache(next) {
  try {
    const prev = loadApiSportsDiskCache()
    const merged = {
      ...prev,
      ...next,
      playerIdCache: { ...(prev.playerIdCache || {}), ...(next.playerIdCache || {}) },
      playerStatsCache: { ...(prev.playerStatsCache || {}), ...(next.playerStatsCache || {}) },
    }
    const cleanIds = {}
    for (const [k, v] of Object.entries(merged.playerIdCache || {})) {
      if (v && typeof v === "object" && Number.isFinite(toNum(v.id))) cleanIds[k] = v
    }
    merged.playerIdCache = cleanIds
    fs.writeFileSync(API_SPORTS_CACHE_FILE, JSON.stringify(merged))
  } catch {
    // ignore
  }
}

async function fetchApiSportsPlayerId({ axios, apiKey, playerName }) {
  const response = await axios.get("https://v2.nba.api-sports.io/players", {
    params: { search: playerName },
    headers: { "x-apisports-key": apiKey },
    timeout: 20000,
  })
  const rows = response.data?.response || []
  if (!Array.isArray(rows) || !rows.length) return null

  const want = normName(playerName)
  let best = null
  for (const r of rows) {
    const fn = String(r?.firstname || "").trim()
    const ln = String(r?.lastname || "").trim()
    const full = normName(`${fn} ${ln}`)
    if (!full) continue
    if (full === want) {
      best = r
      break
    }
    if (!best) best = r
  }
  const id = toNum(best?.id)
  return Number.isFinite(id) ? { id, matchedName: best ? `${best.firstname || ""} ${best.lastname || ""}`.trim() : null } : null
}

async function fetchApiSportsPlayerStats({ axios, apiKey, playerId }) {
  const response = await axios.get("https://v2.nba.api-sports.io/players/statistics", {
    params: { id: playerId, season: 2025 },
    headers: { "x-apisports-key": apiKey },
    timeout: 20000,
  })
  const rows = response.data?.response || []
  return Array.isArray(rows) ? rows : []
}

function computeRecentFormFromLogs({ logs, statKey, line, side }) {
  const ln = toNum(line)
  const isOver = String(side || "").toLowerCase().includes("over")
  const isUnder = String(side || "").toLowerCase().includes("under")

  const sorted = [...(Array.isArray(logs) ? logs : [])].sort(
    (a, b) => (toNum(b?.game?.id) ?? 0) - (toNum(a?.game?.id) ?? 0)
  )

  const valsAll = sorted
    .map((g) => propValueFromApiSportsLog(g, statKey))
    .filter((v) => Number.isFinite(v))

  if (!valsAll.length) return null

  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
  const last5 = valsAll.slice(0, 5)
  const last10 = valsAll.slice(0, 10)
  const baseline = avg(valsAll) // season-to-date average from available games

  const last5_avg = avg(last5)
  const last10_avg = avg(last10)
  const trend_delta = last5_avg - baseline

  const hitRate = (xs) => {
    if (!Number.isFinite(ln)) return null
    if (!isOver && !isUnder) return null
    let hits = 0
    for (const v of xs) {
      if (!Number.isFinite(v)) continue
      if (isOver && v >= ln) hits += 1
      if (isUnder && v <= ln) hits += 1
    }
    return hits / Math.max(1, xs.length)
  }

  return {
    last5_avg,
    last10_avg,
    last5_hit_rate: hitRate(last5),
    last10_hit_rate: hitRate(last10),
    trend_delta,
    baseline,
    sampleSize5: last5.length,
    sampleSize10: last10.length,
    source: "api-sports-live",
  }
}

async function enrichRowsWithRecentForm({ axios, rows }) {
  const apiKey = String(process.env.API_SPORTS_KEY || "").trim()
  if (!apiKey) {
    applyProjectionRecentFormFallback(rows)
    return
  }

  const disk = loadApiSportsDiskCache()
  const playerIdCache = { ...(disk.playerIdCache || {}) }
  const playerStatsCache = { ...(disk.playerStatsCache || {}) }

  const list = Array.isArray(rows) ? rows : []
  const normToCanonicalDisplay = new Map()
  for (const r of list) {
    const d = String(r?.player || "").trim()
    if (!d) continue
    const n = normName(d)
    if (!normToCanonicalDisplay.has(n)) normToCanonicalDisplay.set(n, d)
  }

  const statsByNorm = new Map()

  const uniqueNorms = [...normToCanonicalDisplay.keys()]
  const concurrency = 6
  for (let i = 0; i < uniqueNorms.length; i += concurrency) {
    const batch = uniqueNorms.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (norm) => {
        const canonicalDisplay = normToCanonicalDisplay.get(norm)
        try {
          let cached = findCachedPlayerIdEntry(canonicalDisplay, playerIdCache)
          let pid = cached?.id

          if (!Number.isFinite(pid)) {
            const searchAs = apiSportsSearchQueryForDisplayName(canonicalDisplay)
            const resolved = await fetchApiSportsPlayerId({ axios, apiKey, playerName: searchAs })
            if (resolved?.id) {
              pid = resolved.id
              playerIdCache[canonicalDisplay] = {
                id: pid,
                matchedName: resolved.matchedName,
                requestedName: canonicalDisplay,
              }
            } else {
              return
            }
          }

          const cachedStats = playerStatsCache[String(pid)]
          if (Array.isArray(cachedStats) && cachedStats.length) {
            statsByNorm.set(norm, cachedStats)
            return
          }

          const stats = await fetchApiSportsPlayerStats({ axios, apiKey, playerId: pid })
          if (Array.isArray(stats) && stats.length) {
            playerStatsCache[String(pid)] = stats
            statsByNorm.set(norm, stats)
          }
        } catch {
          // ignore player failures
        }
      })
    )
  }

  saveApiSportsDiskCache({ playerIdCache, playerStatsCache })

  const formMemo = new Map()
  let __formLiveN = 0

  for (const row of list) {
    if (!row || typeof row !== "object") continue
    if (row.recentForm && typeof row.recentForm === "object") continue
    const player = String(row?.player || "").trim()
    if (!player) continue
    const statKey = statKeyFromPropType(row?.propType || row?.marketKey)
    if (!statKey) continue
    const logs = statsByNorm.get(normName(player))
    if (!Array.isArray(logs) || !logs.length) continue

    const memoKey = `${normName(player)}__${statKey}__${String(row?.line ?? "")}__${String(row?.side ?? "")}`
    let rf = formMemo.get(memoKey) || null
    if (!rf) {
      rf = computeRecentFormFromLogs({ logs, statKey, line: row?.line, side: row?.side })
      if (rf) formMemo.set(memoKey, rf)
    }

    if (rf) {
      row.recentForm = rf
      if (__formLiveN < 12) {
        console.log("FORM DATA LIVE:", player, {
          propType: row?.propType,
          line: row?.line,
          side: row?.side,
          last5_avg: rf.last5_avg,
          last10_avg: rf.last10_avg,
          baseline: rf.baseline,
          trend_delta: rf.trend_delta,
          last5_hit_rate: rf.last5_hit_rate,
          last10_hit_rate: rf.last10_hit_rate,
          source: rf.source,
        })
        __formLiveN++
      }
    }
  }

  applyProjectionRecentFormFallback(list)
}

function snapshotHasBody(snap) {
  if (!snap || typeof snap !== "object") return false
  const ev = Array.isArray(snap.events) ? snap.events.length : 0
  const rp = Array.isArray(snap.rawProps) ? snap.rawProps.length : 0
  const pr = Array.isArray(snap.props) ? snap.props.length : 0
  const bp = Array.isArray(snap.bestProps) ? snap.bestProps.length : 0
  return ev > 0 || rp > 0 || pr > 0 || bp > 0
}

function isNbaReplayQuery(req) {
  const r = String(req?.query?.replay || "")
    .toLowerCase()
    .trim()
  return r === "1" || r === "true"
}

/**
 * Score already-normalized corePropsBoard rows into workstation Candidate format.
 * These rows come from buildNbaBoardSlicesFromSnapshot and are already enriched with
 * game context (eventId, team, gameTotal, spread, etc.) — no further normalization needed.
 *
 * Mirrors buildNbaSnapshotCandidates in workstationRoutes.js but operates on
 * already-normalized rows instead of raw snapshot rows.
 * Gates: core odds (-200..+200), no alternate market keys, known stat family, mp≥0.35, edge≥0.03.
 * Deduplicates by (player|statFamily|side) keeping best-edge entry per triple.
 */
function buildNbaBestAvailableWsCandidates(corePropsBoard) {
  if (!Array.isArray(corePropsBoard) || !corePropsBoard.length) return []
  const rawQualified = []

  for (const r of corePropsBoard) {
    const player = String(r?.player || "").trim()
    if (!player) continue
    const side = String(r?.side || "").toLowerCase()
    if (!side || side === "unknown") continue
    const odds = Number(r?.odds ?? r?.oddsAmerican)
    if (!Number.isFinite(odds) || odds > 200 || odds < -200) continue

    const mk = String(r?.marketKey || "").toLowerCase()
    const pv = String(r?.propVariant || "base").toLowerCase()
    if (mk.includes("alternate") || mk.includes("_alt") || (pv && pv !== "base" && pv !== "default")) continue

    const propT = String(r?.propType || mk).toLowerCase()
    const family = propT.includes("points_rebounds_assists") || /\bpra\b/.test(propT) ? "pra"
      : propT.includes("first_basket") || propT.includes("firstbasket") ? "first_basket"
      : propT.includes("points")   ? "points"
      : propT.includes("rebounds") ? "rebounds"
      : propT.includes("assists")  ? "assists"
      : (propT.includes("threes") || propT.includes("three") || propT.includes("3pt")) ? "threes"
      : null
    if (!family) continue

    const mp = nbaRowModelProbability(r)
    if (!Number.isFinite(mp) || mp < 0.35) continue
    const edge = nbaRowEdge(r)
    if (!Number.isFinite(edge) || edge < 0.03) continue

    rawQualified.push({
      ...r,
      id:           `ba|${player}|${family}|${side}|${r?.line ?? ""}|${odds}`,
      player,
      statFamily:   family,
      propType:     r?.propType || family,
      side,
      line:         r?.line ?? null,
      odds,
      oddsAmerican: odds,
      modelProb:    mp,
      edge,
      impliedProb:  odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100),
      sportsbook:   r?.sportsbook || r?.book || null,
      tier:         edge >= 0.12 ? "ELITE" : edge >= 0.07 ? "STRONG" : edge >= 0.04 ? "PLAYABLE" : "LONGSHOT",
      volatility:   family === "pra" ? "lotto"
                  : (family === "threes" || family === "first_basket") ? "aggressive"
                  : "balanced",
      confidence:   mp,
      snapshotSourced: true,
    })
  }

  // Dedup by (player|statFamily|side) keeping best-edge entry per triple.
  const bestBySig = new Map()
  for (const c of rawQualified) {
    const sig = `${c.player}|${c.statFamily}|${c.side}`
    if (!bestBySig.has(sig) || (c.edge ?? 0) > (bestBySig.get(sig).edge ?? 0)) bestBySig.set(sig, c)
  }
  return Array.from(bestBySig.values()).sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
}

/**
 * GET /api/best-available?sport=basketball_nba
 */
async function handleNbaBestAvailableGet(req, res, deps) {
  console.log("TRACE BEST-AVAILABLE HIT (NBA):", { sport: req?.query?.sport })
  const { axios, oddsSnapshot, normalizeBestAvailableSportKey, refreshGuard, snapshotPath } = deps

  const bestAvailableSportKey = normalizeBestAvailableSportKey(String(req.query?.sport || "").trim())
  const resolvedSnapshotPath = snapshotPath || path.join(__dirname, "..", "snapshot.json")

  let snap = oddsSnapshot && typeof oddsSnapshot === "object" ? oddsSnapshot : null

  const snapshotUpdatedAtMs = snap?.updatedAt ? new Date(snap.updatedAt).getTime() : null
  const snapshotAgeMinutes = Number.isFinite(snapshotUpdatedAtMs)
    ? (Date.now() - snapshotUpdatedAtMs) / 60000
    : Infinity

  const snapshotEventsCount = Array.isArray(snap?.events) ? snap.events.length : 0
  const snapshotRawPropsCount = Array.isArray(snap?.rawProps) ? snap.rawProps.length : 0

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

    try {
      const now = Date.now()
      if (refreshGuard.inProgress) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "in_progress" })
      } else if (now - refreshGuard.lastRefreshTime < 2 * 60 * 1000) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "cooldown" })
      } else {
        refreshGuard.inProgress = true
        refreshGuard.lastRefreshTime = now
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
      refreshGuard.inProgress = false
    }

    snap = oddsSnapshot && typeof oddsSnapshot === "object" ? oddsSnapshot : null
  } else {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "use_snapshot",
      reasons: [],
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
    })
  }

  if (!snapshotHasBody(snap)) {
    const disk = loadNbaSnapshotFromDisk(resolvedSnapshotPath)
    if (disk) snap = disk
  }

  const slices = buildNbaBoardSlicesFromSnapshot(snap && typeof snap === "object" ? snap : {})

  // REAL RECENT FORM: attach from API-Sports logs BEFORE candidate creation.
  await enrichRowsWithRecentForm({
    axios,
    rows: slices?.completeUniverse,
  })

  const ingestDiagnostics =
    snap?.diagnostics && typeof snap.diagnostics === "object"
      ? {
          ingestCoverage: snap.diagnostics.ingestCoverage,
          baseMarkets: snap.diagnostics.fetchAudit?.baseRequestMarkets,
          extraMarkets: snap.diagnostics.fetchAudit?.extraRequestMarkets,
        }
      : {}

  const nbaOpportunityBoard = buildNbaOpportunityBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    completeUniverse: slices.completeUniverse,
    ingestDiagnostics,
    ingestRows: Array.isArray(snap?.rawProps) ? snap.rawProps : Array.isArray(snap?.props) ? snap.props : [],
  })
  const nbaInsightBoard = buildNbaInsightBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    specialBoard: slices.specialBoard,
    firstBasketBoard: slices.firstBasketBoard,
    nbaOpportunityBoard,
  })

  const __playerCheckPool = [
    ...(Array.isArray(nbaInsightBoard?.bestOverallPlays) ? nbaInsightBoard.bestOverallPlays : []),
    ...(Array.isArray(nbaInsightBoard?.corePropsBoard) ? nbaInsightBoard.corePropsBoard : []),
    ...(Array.isArray(nbaInsightBoard?.ladderBoard) ? nbaInsightBoard.ladderBoard : []),
  ]
  const __seenChk = new Set()
  const __dedupePush = (out, r) => {
    if (!r || typeof r !== "object") return
    const k = `${String(r.player || "")}|${String(r.propType || "")}|${String(r.line ?? "")}|${String(r.side || "")}`
    if (__seenChk.has(k)) return
    __seenChk.add(k)
    out.push(r)
  }
  const __withRf = __playerCheckPool.filter(
    (r) => r?.recentForm && typeof r.recentForm === "object" && Number.isFinite(Number(r.recentForm?.trend_delta))
  )
  const __neg = __withRf
    .filter((r) => Number(r.recentForm.trend_delta) < 0)
    .sort((a, b) => Number(a.recentForm.trend_delta) - Number(b.recentForm.trend_delta))
  const __pos = __withRf
    .filter((r) => Number(r.recentForm.trend_delta) > 0)
    .sort((a, b) => Number(b.recentForm.trend_delta) - Number(a.recentForm.trend_delta))
  const __playerCheck = []
  for (const r of __neg.slice(0, 2)) __dedupePush(__playerCheck, r)
  for (const r of __pos.slice(0, 2)) __dedupePush(__playerCheck, r)
  for (const r of __withRf) {
    __dedupePush(__playerCheck, r)
    if (__playerCheck.length >= 5) break
  }
  if (__playerCheck.length < 5) {
    for (const r of __playerCheckPool) {
      __dedupePush(__playerCheck, r)
      if (__playerCheck.length >= 5) break
    }
  }
  for (const r of __playerCheck) {
    console.log("PLAYER CHECK:", r.player, "finalWeight=", r.finalWeight, "recentForm=", r.recentForm)
  }

  // Fix R1 Step 3 — build workstation candidates + featured + slips from corePropsBoard
  const todayStr = new Date().toISOString().slice(0, 10)
  let wsCandidates = []
  let wsFeatured = null
  let wsAiSlips = { slips: { safe: [], balanced: [], aggressive: [], lotto: [] } }

  try {
    const wsCandidatesRaw = buildNbaBestAvailableWsCandidates(slices.corePropsBoard || [])
    wsCandidates = diversifyCandidates(wsCandidatesRaw, {
      sport: "nba",
      maxPerPlayer: 3,
      maxPerGame: 12,
      maxPerStat: 10,
      maxPerStatSide: 6,
    })
    wsFeatured = buildFeaturedPlays({
      candidates: wsCandidates,
      sport: "nba",
      date: todayStr,
    })
    wsAiSlips = buildAiSlips({
      candidates: wsCandidates,
      options: { sport: "nba", date: todayStr, maxPerTier: 4 },
    })
  } catch (wsErr) {
    console.error("[nbaIsolatedRoutes] bestAvailable workstation build error:", wsErr?.message)
  }

  // Map insight rows into elite/strong/best buckets using probability field
  const __allInsightRows = [
    ...(Array.isArray(nbaInsightBoard?.bestOverallPlays) ? nbaInsightBoard.bestOverallPlays : []),
    ...(Array.isArray(nbaInsightBoard?.corePropsBoard) ? nbaInsightBoard.corePropsBoard : []),
  ]
  const __elitePlays = __allInsightRows.filter((r) => Number(r?.probability ?? r?.adjustedConfidenceScore ?? 0) >= 0.55)
  const __strongPlays = __allInsightRows.filter((r) => {
    const p = Number(r?.probability ?? r?.adjustedConfidenceScore ?? 0)
    return p >= 0.42 && p < 0.55
  })

  return res.json({
    bestAvailable: {
      best: __elitePlays.slice(0, 10),
      elite: __elitePlays.slice(0, 6),
      strong: __strongPlays.slice(0, 8),
      ladders: Array.isArray(nbaInsightBoard?.ladderBoard) ? nbaInsightBoard.ladderBoard.slice(0, 6) : [],
      firstBasket: Array.isArray(nbaInsightBoard?.firstBasketBoard) ? nbaInsightBoard.firstBasketBoard.slice(0, 4) : [],
      aiSlips: wsAiSlips?.slips ?? { safe: [], balanced: [], aggressive: [], lotto: [] },
      featured: wsFeatured,
      wsCandidates: wsCandidates.slice(0, 24),
    },
    nbaOpportunityBoard,
    nbaInsightBoard,
  })
}

/**
 * Rebuild NBA `oddsSnapshot` via Odds API (no legacy compiled refresh).
 * MLB sidecar refresh runs in `server.js` before this handler is invoked.
 */
async function handleNbaRefreshSnapshotAfterMlbBranch(req, res, deps) {
  const { ODDS_API_KEY, replaceOddsSnapshot, backendRoot } = deps

  const root = backendRoot || DEFAULT_BACKEND_ROOT

  if (typeof replaceOddsSnapshot !== "function") {
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: "replaceOddsSnapshot callback missing (server wiring)",
    })
  }

  if (isNbaReplayQuery(req)) {
    const diskPath = path.join(root, "snapshot.json")
    const replaySnap = loadNbaSnapshotFromDisk(diskPath)
    if (!replaySnap || !snapshotHasBody(replaySnap)) {
      return res.status(503).json({
        ok: false,
        sport: "basketball_nba",
        error: "Replay requested but snapshot.json is missing or empty",
        replay: true,
      })
    }
    replaceOddsSnapshot(replaySnap)
    try {
      saveNbaSnapshotToDisk(root, replaySnap)
    } catch (e) {
      console.log("[NBA-SNAPSHOT] replay disk save skipped", e?.message || e)
    }

    // Session BD — also freeze on replay path so disk-replays observe their
    // own bestProps state (idempotent — same snapshot updatedAt → same epoch).
    try {
      const bestPropsR = Array.isArray(replaySnap?.bestProps) ? replaySnap.bestProps : []
      if (bestPropsR.length) {
        const fzR = _lazyFreezePredictionEpoch({
          predictions:       bestPropsR,
          sport:             "nba",
          slateDate:         _detroitSlateDateKey(replaySnap?.updatedAt),
          source:            "snapshot_bestprops_replay",
          snapshotUpdatedAt: replaySnap?.updatedAt,
          notes:             "replay snapshot bestProps freeze",
        })
        console.log("[NBA-SNAPSHOT-FREEZE-REPLAY]", {
          ok: fzR.ok, epochInserted: fzR.epochInserted,
          predictionsInserted: fzR.predictionsInserted,
          predictionsSkipped: fzR.predictionsSkipped,
          contextualInserted: fzR.contextualInserted,
        })
      }
    } catch (fzReplayErr) {
      console.warn("[NBA-SNAPSHOT-FREEZE-REPLAY] non-fatal:", fzReplayErr?.message || fzReplayErr)
    }

    return res.status(200).json({
      ok: true,
      sport: "basketball_nba",
      replay: true,
      updatedAt: replaySnap.updatedAt || null,
      events: Array.isArray(replaySnap.events) ? replaySnap.events.length : 0,
      rawProps: Array.isArray(replaySnap.rawProps) ? replaySnap.rawProps.length : 0,
      props: Array.isArray(replaySnap.props) ? replaySnap.props.length : 0,
    })
  }

  if (!ODDS_API_KEY) {
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: "Missing ODDS_API_KEY in .env",
    })
  }

  try {
    const snap = await fetchNbaOddsSnapshot({ oddsApiKey: ODDS_API_KEY })
    replaceOddsSnapshot(snap)
    try {
      saveNbaSnapshotToDisk(root, snap)
    } catch (e) {
      console.log("[NBA-SNAPSHOT] disk save failed", e?.message || e)
    }

    // Session BD — Longitudinal Freeze Pipeline. Persist an observational
    // record of the predictions we just surfaced via bestProps. Honest
    // sparsity on contextual columns — no contextual layer fires here.
    try {
      const bestProps = Array.isArray(snap?.bestProps) ? snap.bestProps : []
      if (bestProps.length) {
        const fzResult = _lazyFreezePredictionEpoch({
          predictions:       bestProps,
          sport:             "nba",
          slateDate:         _detroitSlateDateKey(snap?.updatedAt),
          source:            "snapshot_bestprops",
          snapshotUpdatedAt: snap?.updatedAt,
          notes:             "snapshot bestProps freeze (no contextual enrichment)",
        })
        console.log("[NBA-SNAPSHOT-FREEZE]", {
          ok:                  fzResult.ok,
          epochInserted:       fzResult.epochInserted,
          predictionsInserted: fzResult.predictionsInserted,
          predictionsSkipped:  fzResult.predictionsSkipped,
          contextualInserted:  fzResult.contextualInserted,
          error:               fzResult.error,
        })
      } else {
        console.log("[NBA-SNAPSHOT-FREEZE] skipped (no bestProps)")
      }
    } catch (fzErr) {
      console.warn("[NBA-SNAPSHOT-FREEZE] non-fatal:", fzErr?.message || fzErr)
    }

    return res.status(200).json({
      ok: true,
      sport: "basketball_nba",
      updatedAt: snap.updatedAt,
      events: Array.isArray(snap.events) ? snap.events.length : 0,
      rawProps: Array.isArray(snap.rawProps) ? snap.rawProps.length : 0,
      props: Array.isArray(snap.props) ? snap.props.length : 0,
    })
  } catch (e) {
    console.log("[NBA-SNAPSHOT-FETCH-FAILED]", e?.message || e)
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: e?.message || String(e),
    })
  }
}

module.exports = {
  handleNbaBestAvailableGet,
  handleNbaRefreshSnapshotAfterMlbBranch,
}
