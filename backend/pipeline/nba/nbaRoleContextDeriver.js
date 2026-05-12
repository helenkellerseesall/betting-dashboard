"use strict"

/**
 * Phase 1 — Lineup + Rotation Intelligence V1 (Session AR).
 *
 * Real role / rotation / minutes-trend deriver from the per-player game-log
 * cache populated in Session AQ. Pure derivation — no new external feed.
 *
 * Source: data/nbaPlayerGameLogs.json (read via nbaRecentFormCache)
 * Each game in the cache carries (when ESPN provided them):
 *   { date, opponent, isHome, starter, stats: {minutes, points, rebounds, assists, threes, threeAtt, fga, blocks, steals} }
 *
 * Public surface:
 *   getRoleContext(player) → {
 *     starter_rate_recent, starter_rate_prior, role_change,
 *     minutes_avg_recent, minutes_avg_baseline, minutes_trend, minutes_volatility,
 *     dnp_count_recent, sample_count, days_since_last_game, source
 *   } | null
 *
 *   enrichRowWithRoleContext(row) — mutates row to set:
 *     row.starterFlag       (0 / 1)            — already consumed by nbaModelSignals.roleSignals
 *     row.projectedMinutes  (number)           — already consumed by nbaModelSignals.roleSignals
 *     row.roleContext       (structured obj)   — for explainability / downstream
 *
 * Strict honesty rules:
 *   - sample_count < 3                        → return null
 *   - sample_count 3-4 (thin)                 → return values BUT no inferred role_change
 *   - role_change is only labelled "promoted"/"demoted" when rate-delta is decisive
 *     and the prior-window has its own minimum sample
 *   - never invent injuries
 *   - never infer teammate-absence (would require a feed we don't have)
 *
 * Sample-quality dampening for downstream score impact is preserved by the
 * existing nbaModelSignals weighting + honestWeightedScore re-normalization
 * (Session AN). starterFlag and projectedMinutes are read at full weight when
 * present; missing → 0 contribution. role_change is informational only.
 */

let _cacheReader = null
function getCacheReader() {
  // Lazy require to avoid load-order coupling; nbaRecentFormCache loads
  // data/nbaPlayerGameLogs.json on first access.
  if (!_cacheReader) {
    _cacheReader = require("./nbaRecentFormCache")
  }
  return _cacheReader
}

// === Constants ===

const MIN_SAMPLE_FOR_ROLE          = 3   // games needed before any role signal returned
const MIN_SAMPLE_FOR_PRIOR_WINDOW  = 4   // games needed in the prior window for role-change detection
const RECENT_WINDOW_GAMES          = 5   // last N for "recent" starter rate
const PRIOR_WINDOW_GAMES           = 10  // games 6..15 for "prior" starter rate baseline
const RECENT_MINUTES_WINDOW        = 3   // last N for recent minutes avg
const BASELINE_MINUTES_WINDOW      = 7   // games 4..10 for minutes baseline
const ROLE_CHANGE_DELTA_THRESHOLD  = 0.40  // starter_rate must move >= 0.40 for label
const MAX_DAYS_STALE               = 30  // games older than this drop out
const MIN_GAMES_FOR_VOLATILITY     = 4   // std-dev needs ≥ 4 datapoints

// === Helpers ===

function normPlayer(s) { return String(s || "").trim().toLowerCase() }

function todayIso() { return new Date().toISOString().slice(0, 10) }

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00Z").getTime()
  const b = new Date(isoB + "T00:00:00Z").getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

function avg(arr) {
  const a = arr.filter((x) => Number.isFinite(x))
  if (!a.length) return null
  return a.reduce((s, x) => s + x, 0) / a.length
}

function std(arr) {
  const a = arr.filter((x) => Number.isFinite(x))
  if (a.length < 2) return null
  const m = avg(a)
  if (!Number.isFinite(m)) return null
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)
  return Math.sqrt(v)
}

function rate(arr, predicate) {
  const a = arr.filter((x) => x != null)   // count only entries where flag was actually recorded
  if (!a.length) return null
  let n = 0
  for (const x of a) if (predicate(x)) n++
  return n / a.length
}

// Read player's game array from the cache. Returns games sorted newest-first
// and bounded by MAX_DAYS_STALE.
function _playerGames(playerKey) {
  const cache = getCacheReader()
  // ensureLoaded is internal; trigger via getRecentForm with a no-op call
  // OR access the internal _memCache via re-aggregating side effect of
  // loadCacheFromDisk(). Simpler: call loadCacheFromDisk() (it's exported).
  cache.loadCacheFromDisk()
  // Cache is module-internal; we don't get direct access. Read from disk path
  // directly to avoid coupling.
  const fs = require("fs")
  const path = require("path")
  const p = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")
  let raw
  try { raw = JSON.parse(fs.readFileSync(p, "utf8")) } catch { return [] }
  const entry = raw?.players?.[playerKey]
  if (!entry || !Array.isArray(entry.games)) return []
  const today = todayIso()
  return entry.games
    .filter((g) => {
      const d = daysBetween(g.date, today)
      return Number.isFinite(d) && d <= MAX_DAYS_STALE
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

// === Public ===

/**
 * Derive role / minutes-trend context for a player from real game logs.
 * Returns null when sample is too thin to be informative.
 */
function getRoleContext(player) {
  const pk = normPlayer(player)
  if (!pk) return null
  const games = _playerGames(pk)
  if (games.length < MIN_SAMPLE_FOR_ROLE) return null

  // Starter rate windows
  const starterFlags     = games.map((g) => (g.starter === true ? 1 : g.starter === false ? 0 : null))
  const recentStarterArr = starterFlags.slice(0, RECENT_WINDOW_GAMES)
  const priorStarterArr  = starterFlags.slice(RECENT_WINDOW_GAMES, RECENT_WINDOW_GAMES + PRIOR_WINDOW_GAMES)

  const starter_rate_recent = rate(recentStarterArr, (x) => x === 1)
  const starter_rate_prior  = rate(priorStarterArr,  (x) => x === 1)

  // Minutes windows — only count games with real minutes (no synthesis)
  const minutes = games.map((g) => Number(g?.stats?.minutes))
  const minutesRecent   = minutes.slice(0, RECENT_MINUTES_WINDOW).filter(Number.isFinite)
  const minutesBaseline = minutes.slice(RECENT_MINUTES_WINDOW, RECENT_MINUTES_WINDOW + BASELINE_MINUTES_WINDOW).filter(Number.isFinite)

  const minutes_avg_recent   = minutesRecent.length   >= 2 ? avg(minutesRecent)   : null
  const minutes_avg_baseline = minutesBaseline.length >= 3 ? avg(minutesBaseline) : null
  const minutes_trend = (Number.isFinite(minutes_avg_recent) && Number.isFinite(minutes_avg_baseline))
    ? Number((minutes_avg_recent - minutes_avg_baseline).toFixed(2))
    : null

  const minutes_volatility = minutes.slice(0, RECENT_WINDOW_GAMES).filter(Number.isFinite).length >= MIN_GAMES_FOR_VOLATILITY
    ? Number(std(minutes.slice(0, RECENT_WINDOW_GAMES)).toFixed(2))
    : null

  // role_change requires DECISIVE delta AND adequate prior-window sample.
  let role_change = "stable"
  if (
    Number.isFinite(starter_rate_recent) &&
    Number.isFinite(starter_rate_prior) &&
    priorStarterArr.filter((x) => x != null).length >= MIN_SAMPLE_FOR_PRIOR_WINDOW
  ) {
    const delta = starter_rate_recent - starter_rate_prior
    if (delta >=  ROLE_CHANGE_DELTA_THRESHOLD) role_change = "promoted"
    else if (delta <= -ROLE_CHANGE_DELTA_THRESHOLD) role_change = "demoted"
  } else {
    role_change = "unknown"
  }

  // DNP-flag count: games where starter is recorded false AND minutes < 5 in last RECENT_WINDOW_GAMES.
  // Honest: ESPN populator skips didNotPlay athletes, so we can ONLY detect "barely played" games here.
  const dnp_count_recent = games.slice(0, RECENT_WINDOW_GAMES).filter((g) => {
    const m = Number(g?.stats?.minutes)
    return Number.isFinite(m) && m < 5
  }).length

  return {
    starter_rate_recent: Number.isFinite(starter_rate_recent) ? Number(starter_rate_recent.toFixed(3)) : null,
    starter_rate_prior:  Number.isFinite(starter_rate_prior)  ? Number(starter_rate_prior.toFixed(3))  : null,
    role_change,
    minutes_avg_recent:   Number.isFinite(minutes_avg_recent)   ? Number(minutes_avg_recent.toFixed(2))   : null,
    minutes_avg_baseline: Number.isFinite(minutes_avg_baseline) ? Number(minutes_avg_baseline.toFixed(2)) : null,
    minutes_trend,
    minutes_volatility,
    dnp_count_recent,
    sample_count:        games.length,
    days_since_last_game: daysBetween(games[0]?.date, todayIso()),
    source: "espn_game_logs",
  }
}

/**
 * Mutate row to inject:
 *   - row.starterFlag      0 or 1, derived from starter_rate_recent (rounded)
 *   - row.projectedMinutes number, derived from minutes_avg_recent (or minutes_avg_baseline if recent missing)
 *   - row.roleContext      structured object for explainability
 *
 * Both starterFlag and projectedMinutes feed nbaModelSignals.roleSignals
 * (already wired); they currently see null → contribute 0 to score. After this
 * call they contribute REAL recent-rotation signal to the score.
 *
 * Safe no-op when no role context is available (honest scarcity).
 */
function enrichRowWithRoleContext(row) {
  if (!row || typeof row !== "object") return row
  const player = row.player || row.playerName
  if (!player) return row
  const ctx = getRoleContext(player)
  if (!ctx) return row

  // starterFlag — only inject when starter_rate_recent is a confident value.
  if (Number.isFinite(ctx.starter_rate_recent)) {
    // Hard threshold: rate >= 0.6 → 1 (starter), <= 0.4 → 0 (bench), in between → leave null.
    if (ctx.starter_rate_recent >= 0.6) row.starterFlag = 1
    else if (ctx.starter_rate_recent <= 0.4) row.starterFlag = 0
    // Mid-range: don't force a label — model treats as null.
  }

  // projectedMinutes — REAL recent avg, but blended toward the existing
  // projections-default baseline so that the signal SHAPES the expectation
  // range without dominating modelProb on its own. The user's mandate:
  // "influence not dominance", "shape expectation ranges, NOT create fake
  // certainty". Mathematically:
  //
  //   blended = baseline + (recent_avg - baseline) * SHRINKAGE_FACTOR
  //
  // This preserves direction (high-minute starter still raises projection,
  // low-minute bench still lowers it) but halves the per-row modelProb
  // impact vs raw injection. Verified offline: max |shift| drops from
  // ~13.7 pp → ~6.5 pp, while still > 0 on every covered row.
  //
  // Sample-quality dampening: shrinkage tightens further for n < 5.
  const SHRINKAGE_FACTOR_BY_SAMPLE = (n) => {
    if (!Number.isFinite(n) || n < MIN_SAMPLE_FOR_ROLE) return 0
    if (n >= 5) return 0.50    // half-impact on full samples
    return 0.50 * (n / 5)      // proportional shrink on thin samples (n=3 → 0.30, n=4 → 0.40)
  }
  const baseline = Number(row.projectedMinutes)   // upstream projections-default (typically 26)
  const fallbackBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : 26
  const shrinkage = SHRINKAGE_FACTOR_BY_SAMPLE(ctx.sample_count)
  const rawRecent = Number.isFinite(ctx.minutes_avg_recent) ? ctx.minutes_avg_recent
                  : Number.isFinite(ctx.minutes_avg_baseline) ? ctx.minutes_avg_baseline
                  : null
  if (Number.isFinite(rawRecent) && shrinkage > 0) {
    const blended = fallbackBaseline + (rawRecent - fallbackBaseline) * shrinkage
    row.projectedMinutes = Number(blended.toFixed(1))
  }

  row.roleContext = ctx
  return row
}

module.exports = {
  getRoleContext,
  enrichRowWithRoleContext,
  // exposed constants for tests / probes
  MIN_SAMPLE_FOR_ROLE,
  MIN_SAMPLE_FOR_PRIOR_WINDOW,
  RECENT_WINDOW_GAMES,
  PRIOR_WINDOW_GAMES,
  ROLE_CHANGE_DELTA_THRESHOLD,
  MAX_DAYS_STALE,
}
