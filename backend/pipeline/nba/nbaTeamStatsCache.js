"use strict"

/**
 * nbaTeamStatsCache — exposes opponent defense / pace / opp-allowed signals
 * to nbaModelSignals via enrichRowWithTeamStats(row).
 *
 * Source: backend/data/nbaTeamStats.json (populated by populateNbaTeamStats.js)
 *
 * What it sets on the row:
 *   row.oppDef               — opponent defensive rating (lower = better D)
 *   row.oppDefRating         — same, more descriptive alias
 *   row.pace                 — actual game pace (replaces the default 100)
 *   row.opponentStats        — { pointsAllowed, reboundsAllowed, assistsAllowed, threePAAllowed, ... }
 *
 * Honest no-op when:
 *   - cache file missing or empty
 *   - team abbreviation can't be resolved from row.opponent
 *   - stats data simply isn't in the team entry (ESPN didn't expose it)
 *
 * Never fabricates values. The cognition handles null gracefully.
 */

const fs   = require("fs")
const path = require("path")

const CACHE_PATH = path.join(__dirname, "..", "..", "data", "nbaTeamStats.json")

let _cache = null
let _loadedAt = 0
const RELOAD_AFTER_MS = 5 * 60 * 1000  // 5min — refresh in long-running processes

function loadCacheFromDisk() {
  try {
    if (!fs.existsSync(CACHE_PATH)) {
      _cache = { teams: {}, generatedAt: null }
      _loadedAt = Date.now()
      return _cache
    }
    _cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) || { teams: {} }
    _loadedAt = Date.now()
    return _cache
  } catch (_) {
    _cache = { teams: {}, generatedAt: null }
    _loadedAt = Date.now()
    return _cache
  }
}

function ensureLoaded() {
  if (_cache && Date.now() - _loadedAt < RELOAD_AFTER_MS) return _cache
  return loadCacheFromDisk()
}

// Normalize an opponent identifier (could be team name, abbrev, or city).
// Tries multiple strategies because row.opponent in the snapshot can be in
// any format depending on which enrichment ran upstream.
function normalizeTeamKey(opponent) {
  if (!opponent) return null
  const raw = String(opponent).trim()
  if (!raw) return null
  const upper = raw.toUpperCase()

  const cache = ensureLoaded()
  const teams = cache.teams || {}

  // Exact abbreviation hit
  if (teams[upper]) return upper

  // Try matching by displayName substring
  const lower = raw.toLowerCase()
  for (const [abbr, entry] of Object.entries(teams)) {
    const dn = String(entry.displayName || "").toLowerCase()
    if (dn === lower) return abbr
    if (dn && lower.includes(dn)) return abbr
    if (dn && dn.includes(lower)) return abbr
  }

  // Common city-only fallbacks
  const CITY_TO_ABBR = {
    "boston":"BOS","cleveland":"CLE","new york":"NYK","brooklyn":"BKN","philadelphia":"PHI","toronto":"TOR",
    "atlanta":"ATL","charlotte":"CHA","chicago":"CHI","detroit":"DET","indiana":"IND","miami":"MIA",
    "milwaukee":"MIL","orlando":"ORL","washington":"WAS","dallas":"DAL","denver":"DEN","golden state":"GSW",
    "houston":"HOU","la clippers":"LAC","los angeles clippers":"LAC","la lakers":"LAL","los angeles lakers":"LAL",
    "memphis":"MEM","minnesota":"MIN","new orleans":"NOP","oklahoma city":"OKC","phoenix":"PHX",
    "portland":"POR","sacramento":"SAC","san antonio":"SAS","utah":"UTA",
  }
  for (const [city, abbr] of Object.entries(CITY_TO_ABBR)) {
    if (lower.includes(city) && teams[abbr]) return abbr
  }
  return null
}

function getTeamStats(opponent) {
  const key = normalizeTeamKey(opponent)
  if (!key) return null
  const cache = ensureLoaded()
  return cache.teams?.[key] || null
}

// 2026-05-30 — Defense-vs-position cache. Lazy load + memoize.
let _dvpCache = null
let _dvpLoaded = false
function loadDvpCache() {
  if (_dvpLoaded) return _dvpCache
  _dvpLoaded = true
  try {
    const fs = require("fs")
    const path = require("path")
    const p = path.join(__dirname, "..", "..", "data", "nbaDvP.json")
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"))
      _dvpCache = raw?.teams || raw || {}
    }
  } catch (_) { _dvpCache = null }
  return _dvpCache
}

function attachOpponentDvP(row, opp) {
  const dvp = loadDvpCache()
  if (!dvp || !opp) return
  const teamEntry = dvp[opp]
  if (!teamEntry) return
  // Match the row's player role to the DvP bucket. Read from playerSeasonStats
  // or roleContext if available; otherwise leave per-role data on row for
  // downstream consumers to pick the right bucket.
  const playerRole = (() => {
    const r = String(row.role || row.roleContext?.role || row.archetype || "").toLowerCase()
    if (r === "guard" || r === "pg" || r === "sg") return "guard"
    if (r === "big" || r === "c" || r === "pf") return "big"
    if (r === "wing" || r === "sf") return "wing"
    return null
  })()
  row.opponentDvP = teamEntry  // full per-role table so any consumer can pick
  if (playerRole && teamEntry[playerRole]) {
    row.opponentDvPForRole = { role: playerRole, ...teamEntry[playerRole] }
  }

  // 2026-05-30 — Per-role opp 3PA-allowed. Per-player-game avg from DvP cache.
  // For player_threes projections we want to compare THIS player's role's
  // 3PA-allowed against the league baseline FOR THAT ROLE. League per-role
  // baselines (approximate, per opposing player-game):
  //   guards: 3.5  ·  wings: 2.8  ·  bigs: 1.5
  // Multiplier = opp_role_3PA_allowed / role_baseline. Capped ±15%.
  if (playerRole && teamEntry[playerRole]?.threeAtt?.mean != null) {
    const opp3PA = Number(teamEntry[playerRole].threeAtt.mean)
    const baselineByRole = { guard: 3.5, wing: 2.8, big: 1.5 }
    const baseline = baselineByRole[playerRole]
    if (Number.isFinite(opp3PA) && baseline > 0) {
      row.opponentThreePAAllowedForRole = Number(opp3PA.toFixed(2))
      row.opponentThreePAMultiplier = Number(Math.max(0.85, Math.min(1.15, opp3PA / baseline)).toFixed(3))
    }
  }

  // 2026-05-30 — Tier 2 #5: per-role opp rebounds-allowed.
  // Same pattern as threes. Per-opposing-player-game baselines:
  //   guards: 3.5 reb  ·  wings: 4.5 reb  ·  bigs: 8.5 reb
  // Multiplier capped ±15%. A team that gives up MORE rebounds to bigs
  // boosts an opposing big's rebound projection; stingy teams dampen.
  if (playerRole && teamEntry[playerRole]?.rebounds?.mean != null) {
    const oppReb = Number(teamEntry[playerRole].rebounds.mean)
    const baselineByRole = { guard: 3.5, wing: 4.5, big: 8.5 }
    const baseline = baselineByRole[playerRole]
    if (Number.isFinite(oppReb) && baseline > 0) {
      row.opponentReboundsAllowedForRole = Number(oppReb.toFixed(2))
      row.opponentReboundsMultiplier = Number(Math.max(0.85, Math.min(1.15, oppReb / baseline)).toFixed(3))
    }
  }

  // 2026-05-30 — Tier 2 #6: per-role opp steals-allowed (opposing-player steals
  // generated AGAINST team Y). High-TOV teams = more steal opportunities for
  // opposing defenders. Per-opposing-player-game baselines:
  //   guards: 1.0 stl  ·  wings: 0.8 stl  ·  bigs: 0.5 stl
  // Multiplier capped ±15%.
  if (playerRole && teamEntry[playerRole]?.steals?.mean != null) {
    const oppStl = Number(teamEntry[playerRole].steals.mean)
    const baselineByRole = { guard: 1.0, wing: 0.8, big: 0.5 }
    const baseline = baselineByRole[playerRole]
    if (Number.isFinite(oppStl) && baseline > 0) {
      row.opponentStealsAllowedForRole = Number(oppStl.toFixed(2))
      row.opponentStealsMultiplier = Number(Math.max(0.85, Math.min(1.15, oppStl / baseline)).toFixed(3))
    }
  }
}

function enrichRowWithTeamStats(row) {
  if (!row || typeof row !== "object") return row
  const opp = row.opponent || row.opponentTeam || row.opp || null
  if (!opp) return row
  // 2026-05-30 — Attach opponent DvP (derived from game logs) regardless of
  // whether nbaTeamStats has the team. DvP file may have coverage where
  // nbaTeamStats doesn't, and vice versa.
  attachOpponentDvP(row, opp)
  const stats = getTeamStats(opp)
  if (!stats) return row

  // oppDef = defensive rating (lower = better defense). When defensiveRating
  // isn't directly exposed, fall back to opp points allowed per game (higher
  // = worse defense). Negate so the model's "negative oppDef = good defense"
  // semantic is preserved.
  if (Number.isFinite(stats.defensiveRating) && row.oppDef == null) {
    row.oppDef = stats.defensiveRating
  } else if (Number.isFinite(stats.pointsAllowedPerGame) && row.oppDef == null) {
    // Center around league average (~113 pts allowed). Below 113 = good D
    // (negative oppDef), above = bad D (positive oppDef).
    row.oppDef = stats.pointsAllowedPerGame - 113
  }
  // 2026-05-24 — oppDef honest no-op when ESPN doesn't expose defensive stats.
  // ESPN /teams/{id}/statistics returns team's own offensive stats, not opponent-
  // allowed. We leave oppDef null rather than fabricate. A future mutation will
  // wire a dedicated defensive-rating source (NBA.com stats API or ESPN standings).

  // pace: opponent's pace as a proxy for game pace. Real game pace is avg
  // of both, but opponent-side alone is still directional. Don't overwrite
  // a non-default value already on the row.
  if (Number.isFinite(stats.pace) && (row.pace == null || row.pace === 100)) {
    row.pace = stats.pace
  } else if (Number.isFinite(stats.pointsPerGame) && (row.pace == null || row.pace === 100)) {
    // 2026-05-24 — derive pace from team's own offensive stats. Game pace ≈
    // possessions per 48 min. PPP ≈ 1.13 league average. So team's possessions
    // ≈ pointsPerGame / 1.13. Both teams roughly equal → that's also game pace.
    // Honest, mathematically grounded estimate; not a fabrication.
    row.pace = stats.pointsPerGame / 1.13
  }
  // Per-stat opponent-allowed (used by future per-stat refinements).
  row.opponentStats = {
    pointsAllowed:    stats.pointsAllowedPerGame    ?? null,
    reboundsAllowed:  stats.reboundsAllowedPerGame  ?? null,
    assistsAllowed:   stats.assistsAllowedPerGame   ?? null,
    threePAAllowed:   stats.threePAAllowedPerGame   ?? null,
    threePMAllowed:   stats.threePMAllowedPerGame   ?? null,
    defensiveRating:  stats.defensiveRating         ?? null,
    pace:             stats.pace                    ?? null,
    fgPct:            stats.fgPct                   ?? null,
    threePointPct:    stats.threePointPct           ?? null,
  }
  return row
}

module.exports = {
  loadCacheFromDisk,
  getTeamStats,
  enrichRowWithTeamStats,
  normalizeTeamKey,
}
