"use strict"
// ============================================================================
// playerPropHistory — per-player "under/over the line in X of Y games" from the
// player's own game logs. Replaces the SHARED family+side archetype bucket on the
// card (which had no playerId, so Wembanyama and Vassell read the same number).
//
//   getPlayerPropHistory({ sport, player, statFamily, side, line })
//     → { player, family, side, line, n, hits, rate, perPlayer:true, source } | null
//
// Counts the games where the player's stat was UNDER (stat < line) or OVER
// (stat > line) the prop line, over his cached game log. Returns null when the
// family isn't a countable box-score stat, or the sample is too thin (n < MIN_GAMES)
// — the CALLER then falls back honestly (a clearly-labeled type bucket, or "not
// enough games yet"), NEVER a type rate dressed as the player's.
//
// ANTI-FABRICATION: reads only real game logs; a missing player / family / sample
// yields null, never an invented rate. Reusing the hardened gamelog caches.
// ============================================================================
const fs = require("fs")
const path = require("path")

let normPlayer
try { normPlayer = require("../../storage/intelligence").normPlayer }
catch (_) { normPlayer = (s) => String(s || "").toLowerCase().trim() }

const DATA_DIR = path.join(__dirname, "..", "..", "data")
const MIN_GAMES = 10        // below this → null (caller shows a labeled fallback)
const CACHE_TTL_MS = 5 * 60 * 1000

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
function loadJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null } }

// ── lazy per-file player-game caches ────────────────────────────────────────
let _nba = null, _mlbBat = null, _mlbPit = null, _at = 0
function _players(wrap) { return (wrap && wrap.players) || (wrap && typeof wrap === "object" ? wrap : {}) }
function _caches() {
  const now = Date.now()
  if (_nba && (now - _at) < CACHE_TTL_MS) return
  _nba    = _players(loadJsonSafe(path.join(DATA_DIR, "nbaPlayerGameLogs.json")))
  _mlbBat = _players(loadJsonSafe(path.join(DATA_DIR, "mlbBatterGameLogs.json")))
  _mlbPit = _players(loadJsonSafe(path.join(DATA_DIR, "mlbPitcherGameLogs.json")))
  _at = now
}
function _lookup(map, player) {
  if (!map || !player) return null
  const k = normPlayer(player)
  if (map[k]) return map[k]
  // tolerate caches keyed by un-normalized name
  const hit = Object.keys(map).find((x) => normPlayer(x) === k)
  return hit ? map[hit] : null
}
function _games(entry) {
  if (!entry) return []
  if (Array.isArray(entry)) return entry
  return entry.games || entry.logs || entry.gameLog || entry.starts || []
}

// family → (game) → stat value. Returns null when the family isn't countable here.
function _statFor(sport, family, game) {
  const s = (game && (game.stats || game)) || {}
  const f = String(family || "").toLowerCase().replace(/[\s_]+/g, "")
  const g = (...keys) => { for (const k of keys) { const v = num(s[k]); if (v != null) return v } return null }
  if (sport === "nba") {
    if (f === "threes" || f === "threepointersmade") return g("threes", "fg3m", "threePointersMade", "fg3", "threePointers")
    if (f === "points" || f === "pts") return g("points", "pts")
    if (f === "rebounds" || f === "reb") return g("rebounds", "reb", "totalRebounds")
    if (f === "assists" || f === "ast") return g("assists", "ast")
    if (f === "steals") return g("steals", "stl")
    if (f === "blocks") return g("blocks", "blk")
    if (f === "pra") { const p = g("points", "pts"), r = g("rebounds", "reb"), a = g("assists", "ast"); return (p != null && r != null && a != null) ? p + r + a : null }
    return null
  }
  // mlb
  if (f === "totalbases") return g("totalBases")
  if (f === "hits") return g("hits")
  if (f === "homeruns" || f === "hr") return g("homeRuns")
  if (f === "rbis" || f === "rbi") return g("rbi", "rbis")
  if (f === "runs" || f === "runsscored") return g("runs")
  if (f === "stolenbases" || f === "sb") return g("stolenBases")
  if (f === "ks" || f === "strikeouts") return g("strikeOuts")          // pitcher gamelog
  if (f === "walks") return g("walks", "baseOnBalls")
  if (f === "outs") { const ip = g("inningsPitched"); return ip != null ? Math.round(ip * 3) : null }
  return null
}

function getPlayerPropHistory({ sport, player, statFamily, side, line } = {}) {
  const sp = String(sport || "").toLowerCase()
  const ln = num(line)
  const sd = String(side || "").toLowerCase()
  if (!player || ln == null || (sd !== "over" && sd !== "under")) return null
  _caches()

  const fam = String(statFamily || "").toLowerCase().replace(/[\s_]+/g, "")
  const isPitcherFam = sp === "mlb" && (fam === "ks" || fam === "strikeouts" || fam === "outs" || fam === "walks")
  const map = sp === "nba" ? _nba : (isPitcherFam ? _mlbPit : _mlbBat)
  const entry = _lookup(map, player)
  const games = _games(entry)
  if (!games.length) return null

  let n = 0, hits = 0
  for (const game of games) {
    const v = _statFor(sp, statFamily, game)
    if (v == null) continue
    n++
    if (sd === "under" ? (v < ln) : (v > ln)) hits++
  }
  if (n < MIN_GAMES) return null                 // too thin → caller falls back honestly

  return {
    player,
    family: statFamily,
    side: sd,
    line: ln,
    n,
    hits,
    rate: Math.round((hits / n) * 1000) / 1000,
    perPlayer: true,
    source: "mlb_statsapi_gamelog/espn",
  }
}

module.exports = { getPlayerPropHistory, MIN_GAMES }
