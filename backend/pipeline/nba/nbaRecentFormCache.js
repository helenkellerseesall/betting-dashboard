"use strict"

/**
 * Phase 1 — Recent Form V1 (Session AP).
 *
 * Real per-player per-stat recent-form aggregator + cache reader.
 *
 * Data sources, in priority:
 *   1. `data/nbaPlayerGameLogs.json` — persisted cache (rich format, written by
 *      any populator; ESPN-fetcher populator is deferred to a follow-up session).
 *   2. `runtime/tracking/nba_tracked_bets_*.json` — settled bets we've graded
 *      against ESPN scoreboards. REAL `actualValue` per player per stat per
 *      date. Sparse coverage but honest. Used as a fallback populator on first
 *      boot (auto-aggregates if persisted cache is empty).
 *
 * Strict rules (per Phase 1 V1 mandate):
 *   - NEVER synthesise. If sample is too thin, return null. The downstream
 *     prediction core (`nbaModelSignals.recentFormSignal`) treats null as
 *     "no signal — contribute 0", which is the honest answer.
 *   - Sample-quality threshold: `last5_avg` requires ≥ 3 datapoints; `last10_avg`
 *     requires ≥ 5. Below those, the function returns null for that field.
 *   - Influence not dominance: enforced upstream by the existing
 *     `honestWeightedScore` re-normalisation. Recent form is one signal among
 *     spread / gameTotal / matchup; never overrides them.
 *
 * Public surface:
 *   getRecentForm(player, statFamily) → {last5_avg,last10_avg,sample_count,days_since_last_game,source}|null
 *   enrichRowWithRecentForm(row)      → mutates row.last5Avg / last10Avg / recentForm if found, else no-op
 *   aggregateFromSettledBets({daysBack})  → builds + persists cache from tracked_bets
 *   loadCacheFromDisk()               → re-reads persisted cache
 *   resetCache()                      → for tests
 */

const fs   = require("fs")
const path = require("path")

const TRACKING_DIR  = path.join(__dirname, "..", "..", "runtime", "tracking")
const CACHE_PATH    = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")

// === Constants ===

const DEFAULT_DAYS_BACK     = 14
// Sample-size floors. Below MIN_SAMPLE_FOR_LAST5 we return null (honest "no
// signal"). Between MIN_SAMPLE_FOR_LAST5 and 5, sample is REAL but THIN —
// downstream `nbaModelSignals.recentFormSignal` blends toward the line based
// on `sample_count`, so a 2-game average never dominates the score the way a
// well-sampled 5-game average can. This is the "influence not dominate" rule
// expressed mathematically.
const MIN_SAMPLE_FOR_LAST5  = 2
const MIN_SAMPLE_FOR_LAST10 = 5
const MAX_DAYS_STALE        = 30   // games older than this drop out of rolling window

// === Helpers ===

function normPlayer(s) { return String(s || "").trim().toLowerCase() }
function normStat(s) {
  // 2026-05-24 — Lane 5 stat-key alias fix. The recentForm cache is keyed
  // by basic stat names ("points", "rebounds", "assists", "threes", ...)
  // but live snapshot rows pass the Odds-API form ("player_points",
  // "player_rebounds", "player_threes", "player_points_rebounds_assists").
  // Strip the leading "player" + apply common aliases so the lookup
  // actually matches the cache. Before this fix, ~75% of cognition calls
  // passed "playerpoints" through and got null recentForm back — the
  // structural cause of Lane 5 brokenness.
  let s2 = String(s || "").trim().toLowerCase().replace(/[\s_\-]+/g, "")
  if (s2.startsWith("player")) s2 = s2.slice(6)
  // 2026-05-24 — strip alt/alternate/ladder suffix. Snapshot rows for alt
  // lines pass propType="player_points_alternate" which normalizes to
  // "pointsalternate" — same stat family, just an alternate ladder line.
  // Discovered when SGA had 56 rows with form (main lines) but 145 without
  // (alt-line rows) in the trace. Fixing here lifts coverage on all alt
  // ladders.
  if (s2.endsWith("alternate")) s2 = s2.slice(0, -9)
  if (s2.endsWith("alt"))       s2 = s2.slice(0, -3)
  if (s2.endsWith("ladder"))    s2 = s2.slice(0, -6)
  const ALIASES = {
    pts: "points",
    threepointersmade: "threes",
    threespointersmade: "threes",
    threepointers: "threes",
    threesmade: "threes",
    "3pm": "threes",
    rebs: "rebounds",
    reb:  "rebounds",
    ast: "assists",
    asts: "assists",
    stl: "steals",
    blk: "blocks",
    pointsreboundsassists: "pra",
    pointsrebounds: "ptsreb",
    pointsassists: "ptsast",
    reboundsassists: "rebast",
  }
  return ALIASES[s2] || s2
}

function readJsonSafe(p, fb = null) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fb }
}

function writeJsonSafe(p, obj) {
  try {
    const tmp = p + ".tmp." + process.pid + "." + Date.now()
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
    fs.renameSync(tmp, p)
    return true
  } catch (_) { return false }
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00Z").getTime()
  const b = new Date(isoB + "T00:00:00Z").getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

function todayIso() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function avg(arr) {
  const a = arr.filter((x) => Number.isFinite(x))
  if (!a.length) return null
  return a.reduce((s, x) => s + x, 0) / a.length
}

// === In-memory cache ===
//
// Shape: Map<"playerLower", { team?, games: [{date, stats:{statKey:value}}, ...], lastUpdated }>
//
let _memCache = null

function ensureLoaded() {
  if (_memCache) return _memCache
  const persisted = readJsonSafe(CACHE_PATH, null)
  if (persisted && persisted.players && Object.keys(persisted.players).length) {
    _memCache = new Map(Object.entries(persisted.players))
    return _memCache
  }
  // Cache empty / missing → auto-populate from settled bets (sparse but real).
  console.log("[RECENT-FORM] cache empty — auto-aggregating from settled bets")
  aggregateFromSettledBets({ daysBack: DEFAULT_DAYS_BACK })
  return _memCache
}

function loadCacheFromDisk() {
  _memCache = null
  return ensureLoaded()
}

function resetCache() {
  _memCache = null
}

// === Aggregator: pulls from settled bets (real data we already have) ===

function aggregateFromSettledBets({ daysBack = DEFAULT_DAYS_BACK } = {}) {
  const out = new Map()
  let files = []
  try {
    files = fs.readdirSync(TRACKING_DIR)
      .filter((f) => f.startsWith("nba_tracked_bets_") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, daysBack)
  } catch (_) { files = [] }

  for (const f of files) {
    const rows = readJsonSafe(path.join(TRACKING_DIR, f), [])
    if (!Array.isArray(rows)) continue
    for (const b of rows) {
      // Only graded bets carry real actualValue. Pending bets contribute nothing.
      if (typeof b?.actualValue !== "number") continue
      if (!["win", "loss", "push"].includes(b?.result)) continue
      const player = normPlayer(b.player)
      const stat   = normStat(b.statFamily || b.propType)
      if (!player || !stat) continue
      const date   = String(b.date || "").trim()
      if (!date) continue

      let entry = out.get(player)
      if (!entry) {
        entry = { team: b.team || null, games: new Map(), lastUpdated: todayIso(), source: "settled_bets" }
        out.set(player, entry)
      }
      let game = entry.games.get(date)
      if (!game) {
        game = { date, stats: {} }
        entry.games.set(date, game)
      }
      // Each settled bet contributes ONE stat datapoint per (player, date, stat).
      // Multiple bets on same player+date+stat (e.g. over+under at different lines) all share the same actualValue.
      game.stats[stat] = b.actualValue
    }
  }

  // Convert games Map → sorted array (most recent first) per player
  const persistedShape = { players: {}, generatedAt: new Date().toISOString(), source: "settled_bets_aggregator" }
  const memShape = new Map()
  for (const [player, entry] of out) {
    const games = Array.from(entry.games.values()).sort((a, b) => b.date.localeCompare(a.date))
    persistedShape.players[player] = { team: entry.team, games, lastUpdated: entry.lastUpdated, source: entry.source }
    memShape.set(player, persistedShape.players[player])
  }
  _memCache = memShape
  writeJsonSafe(CACHE_PATH, persistedShape)
  console.log("[RECENT-FORM] aggregated " + out.size + " players from " + files.length + " settled-bets files")
  return memShape
}

// === Public reader ===

/**
 * Returns recent-form rolling stats for one player+stat.
 *
 * @param {string} player
 * @param {string} statFamily   normalised stat key (e.g. "threes","points","rebounds","assists","pra")
 * @returns {{
 *   last5_avg: number|null, last10_avg: number|null,
 *   sample_count: number,
 *   days_since_last_game: number|null,
 *   source: string
 * }|null}
 */
// 2026-05-29 — Composite-stat L5 support. The cache stores single stats
// (points, rebounds, assists, threes, blocks, steals) but slate engines
// frequently ask for composites: pra, points_rebounds, points_assists,
// rebounds_assists, double_double, triple_double. Without per-composite
// handling, getRecentForm returned NULL on every composite query, so
// composite picks (e.g. 25 Wemby PRA picks tomorrow) had ZERO recent-form
// signal feeding their model probability. Fix: compute composites at lookup
// time by summing component stats per game. Component combos:
//   pra              → points + rebounds + assists
//   points_rebounds  → points + rebounds
//   points_assists   → points + assists
//   rebounds_assists → rebounds + assists
//   double_double    → count of stats >=10 across (points, rebounds, assists)
//   triple_double    → count of stats >=10 across (points, rebounds, assists, steals, blocks)
//                       — these last two are binary per game (0 or 1); avg becomes a rate
// 2026-05-29 — composite keys MUST match normStat output. normStat strips
// underscores+spaces and applies aliases, so "points_rebounds" becomes
// "ptsreb", "double_double" becomes "doubledouble", etc. The keys below
// reflect the POST-normStat values.
const COMPOSITE_STAT_COMPONENTS = {
  pra:              ["points", "rebounds", "assists"],
  ptsreb:           ["points", "rebounds"],
  ptsast:           ["points", "assists"],
  rebast:           ["rebounds", "assists"],
}
const COMPOSITE_BINARY_STATS = ["doubledouble", "tripledouble"]

function computeCompositeValue(stats, statFamily) {
  if (!stats || typeof stats !== "object") return null
  if (statFamily === "doubledouble" || statFamily === "tripledouble") {
    const components = ["points", "rebounds", "assists", "steals", "blocks"]
    const doubleCount = components.filter((c) => Number.isFinite(stats[c]) && stats[c] >= 10).length
    if (statFamily === "doubledouble") return doubleCount >= 2 ? 1 : 0
    return doubleCount >= 3 ? 1 : 0
  }
  const components = COMPOSITE_STAT_COMPONENTS[statFamily]
  if (!components) return null
  let sum = 0
  let hasAny = false
  for (const c of components) {
    const v = stats[c]
    if (Number.isFinite(v)) { sum += v; hasAny = true }
  }
  return hasAny ? sum : null
}

function getRecentForm(player, statFamily) {
  const cache = ensureLoaded()
  const p = normPlayer(player); const s = normStat(statFamily)
  if (!p || !s) return null
  const entry = cache.get(p)
  if (!entry || !Array.isArray(entry.games)) return null

  // Pull values for this stat from games, most recent first, bounded by MAX_DAYS_STALE.
  // Composite stats (pra, double_double, etc) computed at lookup from components.
  const isComposite = (s in COMPOSITE_STAT_COMPONENTS) || COMPOSITE_BINARY_STATS.includes(s)
  const today = todayIso()
  const values = []
  let lastGameDate = null
  for (const g of entry.games) {
    const days = daysBetween(g.date, today)
    if (Number.isFinite(days) && days > MAX_DAYS_STALE) continue
    let v
    if (isComposite) {
      v = computeCompositeValue(g.stats, s)
    } else {
      v = g.stats?.[s]
    }
    if (!Number.isFinite(v)) continue
    values.push(v)
    if (!lastGameDate) lastGameDate = g.date
  }

  if (!values.length) return null

  const last5  = values.slice(0, 5)
  const last10 = values.slice(0, 10)
  const last5_avg  = last5.length  >= MIN_SAMPLE_FOR_LAST5  ? avg(last5)  : null
  const last10_avg = last10.length >= MIN_SAMPLE_FOR_LAST10 ? avg(last10) : null

  // If neither rolling window meets minimum, return null (honest no-signal).
  if (last5_avg == null && last10_avg == null) return null

  return {
    last5_avg,
    last10_avg,
    sample_count: values.length,
    days_since_last_game: lastGameDate ? daysBetween(lastGameDate, today) : null,
    source: entry.source || "unknown",
  }
}

/**
 * Mutates `row` to set last5Avg / last10Avg / recentForm IF a real form exists
 * for this player+stat. No-op when null (honest scarcity).
 *
 * Sets fields the existing prediction-core consumers already read:
 *   - nbaModelSignals.recentFormSignal → reads row.last5Avg / row.recentForm
 *   - buildNbaPlayerOutcomePredictions → reads row.recentForm.last5_avg / last10_avg
 *   - buildNbaAiPicks                  → reads row.recentForm.last5_avg / last10_avg / baseline
 *   - nbaAiStatFamilyRank              → reads row.recentForm.baseline
 */
function enrichRowWithRecentForm(row) {
  if (!row || typeof row !== "object") return row
  const player = row.player || row.playerName
  const stat   = row.statFamily || row.propFamilyKey || row.propType
  if (!player || !stat) return row
  const rf = getRecentForm(player, stat)
  if (!rf) return row

  // Wire into the field names existing consumers expect.
  if (Number.isFinite(rf.last5_avg))  row.last5Avg  = rf.last5_avg
  if (Number.isFinite(rf.last10_avg)) row.last10Avg = rf.last10_avg
  // Surface structured recentForm object — buildNbaAiPicks reads .baseline,
  // .last5_avg, .last10_avg; buildNbaPlayerOutcomePredictions reads same.
  row.recentForm = {
    last5_avg:  rf.last5_avg,
    last10_avg: rf.last10_avg,
    baseline:   rf.last10_avg ?? rf.last5_avg,   // long window preferred when available
    sample_count: rf.sample_count,
    days_since_last_game: rf.days_since_last_game,
    source: rf.source,
  }
  return row
}

// 2026-05-26 — Lane A1: Binary-event hit rate (double_double, triple_double)
// directly from gameLogs cache. NOT keyed through the existing recentForm
// cache (which is family→avg). Computed on-demand from per-game stats:
//   DD = ≥2 of {points, rebounds, assists, steals, blocks} reaching 10
//   TD = ≥3 of those reaching 10
//
// Returns { hr_l5, hr_l10, hr_season, sample_l5, sample_l10, sample_season }
// (rates 0..1, samples are game counts). Honest null when player not in cache.
function getBinaryHitRates(player) {
  if (!player) return null
  try {
    const path = require("path")
    const fs   = require("fs")
    const cachePath = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")
    if (!fs.existsSync(cachePath)) return null
    const blob = JSON.parse(fs.readFileSync(cachePath, "utf8"))
    const players = blob?.players || {}
    const key  = normPlayer(player)
    const pdata = players[key]
    if (!pdata || !Array.isArray(pdata.games)) return null
    const games = pdata.games

    function isDoubleDouble(s) {
      if (!s) return false
      let n = 0
      for (const k of ["points","rebounds","assists","steals","blocks"]) {
        if (Number(s[k]) >= 10) n++
        if (n >= 2) return true
      }
      return false
    }
    function isTripleDouble(s) {
      if (!s) return false
      let n = 0
      for (const k of ["points","rebounds","assists","steals","blocks"]) {
        if (Number(s[k]) >= 10) n++
      }
      return n >= 3
    }

    const ddArr = games.map(g => isDoubleDouble(g?.stats) ? 1 : 0)
    const tdArr = games.map(g => isTripleDouble(g?.stats) ? 1 : 0)
    const slice = (arr, n) => arr.slice(0, Math.min(n, arr.length))
    const rate  = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null

    return {
      dd_l5:    rate(slice(ddArr, 5)),
      dd_l10:   rate(slice(ddArr, 10)),
      dd_season: rate(ddArr),
      dd_sample_l5:  Math.min(5, ddArr.length),
      dd_sample_l10: Math.min(10, ddArr.length),
      dd_sample_season: ddArr.length,
      td_l5:    rate(slice(tdArr, 5)),
      td_l10:   rate(slice(tdArr, 10)),
      td_season: rate(tdArr),
      td_sample_l5:  Math.min(5, tdArr.length),
      td_sample_l10: Math.min(10, tdArr.length),
      td_sample_season: tdArr.length,
    }
  } catch (_) {
    return null
  }
}

/**
 * Idempotent row enricher — stamps DD/TD hit rates onto a snapshot/candidate row.
 * No-op when player not in gameLogs cache.
 */
function enrichRowWithBinaryHitRates(row) {
  if (!row || typeof row !== "object") return row
  const player = row.player || row.playerName
  if (!player) return row
  // Skip if already enriched (idempotent — cheap short-circuit).
  if (Number.isFinite(Number(row.ddHitRateL5)) || Number.isFinite(Number(row.tdHitRateL5))) {
    return row
  }
  const r = getBinaryHitRates(player)
  if (!r) return row
  row.ddHitRateL5     = r.dd_l5
  row.ddHitRateL10    = r.dd_l10
  row.ddHitRateSeason = r.dd_season
  row.ddSampleL5      = r.dd_sample_l5
  row.ddSampleL10     = r.dd_sample_l10
  row.tdHitRateL5     = r.td_l5
  row.tdHitRateL10    = r.td_l10
  row.tdHitRateSeason = r.td_season
  row.tdSampleL5      = r.td_sample_l5
  row.tdSampleL10     = r.td_sample_l10
  return row
}

module.exports = {
  getRecentForm,
  enrichRowWithRecentForm,
  getBinaryHitRates,
  enrichRowWithBinaryHitRates,
  aggregateFromSettledBets,
  loadCacheFromDisk,
  resetCache,
  // constants exposed for tests
  MIN_SAMPLE_FOR_LAST5,
  MIN_SAMPLE_FOR_LAST10,
  MAX_DAYS_STALE,
  DEFAULT_DAYS_BACK,
}
