#!/usr/bin/env node
"use strict"

/**
 * deriveNbaTeamDefensive.js — 2026-06-01
 *
 * Phase Truth-Fix-1B (audit RED #14) — closes the oppDef wiring gap.
 *
 * Why this exists:
 *   ESPN's NBA team statistics endpoint (used by populateNbaTeamStats.js)
 *   exposes only 3 stat categories — general / offensive / defensive — and
 *   the "defensive" category contains ONLY each team's own defensive
 *   production (def rebounds, blocks, steals). It does NOT expose
 *   defensiveRating, pointsAllowedPerGame, opponent-against statistics,
 *   or pace. The original populateNbaTeamStats NAME_MAP guessed names like
 *   `avgPointsAgainst` and `opponentPointsPerGame` that simply don't exist
 *   on this endpoint. Result: nbaTeamStats.json has 0/30 teams with
 *   defensiveRating or pointsAllowedPerGame, which means
 *   nbaTeamStatsCache.js:217 never sets `row.oppDef`, which means
 *   tracked_best entries persist with oppDef=null on every entry (0/331
 *   today per the truth audit).
 *
 *   Path A from the dispatch: derive these from per-game logs we already
 *   cache. For each NBA game in nbaPlayerGameLogs.json, sum the points
 *   scored by all players on each team to reconstruct the team's score
 *   in that game. Then per opponent team, average the points scored
 *   AGAINST them across games. Real signal from real data, no fabrication.
 *
 * INGESTION SOURCE: data/nbaPlayerGameLogs.json (already populated nightly
 *   by populateNbaGameLogs.js + per-team enrichment).
 *
 * OUTPUT: merges these fields PER TEAM into data/nbaTeamStats.json:
 *   - pointsAllowedPerGame    (avg opponent score against this team)
 *   - reboundsAllowedPerGame  (avg opponent total rebounds)
 *   - assistsAllowedPerGame   (avg opponent assists)
 *   - threePMAllowedPerGame   (avg opponent 3PM)
 *   - threePAAllowedPerGame   (avg opponent 3PA)
 *   - fgAttemptsAllowedPerGame
 *   - gamesPlayedAgainst      (sample size — caller can gate on minimum)
 *   - defensiveRating         (derived: pointsAllowedPerGame, the simple version)
 *   - derivedAt               (ISO timestamp of this derivation run)
 *
 * Preserves all existing offensive fields populated by populateNbaTeamStats.
 *
 * Sample-size honesty: teams with few games cached (early playoff exit) get
 * the fields with small `gamesPlayedAgainst` — caller can filter. We do NOT
 * fabricate league averages or "default" values to fill gaps.
 *
 * Run:
 *   node backend/scripts/deriveNbaTeamDefensive.js
 *   node backend/scripts/deriveNbaTeamDefensive.js --dry-run
 */

const fs = require("fs")
const path = require("path")

const GAME_LOGS    = path.join(__dirname, "..", "data", "nbaPlayerGameLogs.json")
const TEAM_STATS   = path.join(__dirname, "..", "data", "nbaTeamStats.json")

function parseArgs() {
  const out = { dry: false }
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") out.dry = true
  }
  return out
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null }
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normTeamKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Build a map: normalized full team name → team abbreviation, using the
 * existing nbaTeamStats.json which keys by abbr and carries displayName.
 *
 * Falls back to a hand-coded map for any name not in the cache (handles
 * mid-season name drift / display vs official mismatches).
 */
function buildNameToAbbrMap(teamStats) {
  const out = {}
  const teams = teamStats?.teams || {}
  for (const [abbr, t] of Object.entries(teams)) {
    if (t?.displayName) out[normTeamKey(t.displayName)] = abbr
    if (t?.abbr) out[normTeamKey(t.abbr)] = abbr
  }
  // Common shorthand fallbacks (game logs sometimes use short forms)
  const fallbacks = {
    "la clippers": "LAC",
    "la lakers": "LAL",
    "ny knicks": "NY",
    "ny nets": "BKN",
    "brooklyn": "BKN",
  }
  for (const [k, v] of Object.entries(fallbacks)) if (!out[k]) out[k] = v
  return out
}

/**
 * Core derivation. Walks every player's game logs, groups by
 * (date, player.team) → sum stats → team-game record. Then walks team-games
 * grouped by opponent.
 */
function deriveDefensiveStats(playerGameLogs, nameToAbbr) {
  // gameKey: "YYYY-MM-DD|TEAM" → aggregated stats (this team's totals in that game)
  const teamGameStats = new Map()

  const players = playerGameLogs?.players || {}
  for (const playerName of Object.keys(players)) {
    const p = players[playerName]
    if (!p || typeof p !== "object") continue
    const teamFullName = p.team
    const teamAbbr = nameToAbbr[normTeamKey(teamFullName)]
    if (!teamAbbr) continue  // unmappable team — skip
    const games = Array.isArray(p.games) ? p.games : []
    for (const g of games) {
      if (!g?.date || !g?.opponent) continue
      const oppAbbr = nameToAbbr[normTeamKey(g.opponent)]
      if (!oppAbbr) continue
      const gameKey = g.date + "|" + teamAbbr
      let agg = teamGameStats.get(gameKey)
      if (!agg) {
        agg = {
          date: g.date,
          team: teamAbbr,
          opponent: oppAbbr,
          points: 0, rebounds: 0, assists: 0,
          threes: 0, threeAtt: 0, fga: 0,
        }
        teamGameStats.set(gameKey, agg)
      }
      const s = g.stats || {}
      agg.points    += toNum(s.points)
      agg.rebounds  += toNum(s.rebounds)
      agg.assists   += toNum(s.assists)
      agg.threes    += toNum(s.threes)
      agg.threeAtt  += toNum(s.threeAtt)
      agg.fga       += toNum(s.fga)
    }
  }

  // Now per-opponent: collect every team-game where THIS team was the opponent.
  // points scored against opponent = the OTHER team's points in that game.
  // We have team-games keyed by (date, team) — for each one, its `opponent` is
  // the team that ALLOWED these points.
  const allowedByOpp = {}   // oppAbbr → { games, pts, reb, ast, threes, threeAtt, fga }
  for (const tg of teamGameStats.values()) {
    const opp = tg.opponent
    if (!allowedByOpp[opp]) {
      allowedByOpp[opp] = { games: 0, pts: 0, reb: 0, ast: 0, threes: 0, threeAtt: 0, fga: 0 }
    }
    const a = allowedByOpp[opp]
    a.games    += 1
    a.pts      += tg.points
    a.reb      += tg.rebounds
    a.ast      += tg.assists
    a.threes   += tg.threes
    a.threeAtt += tg.threeAtt
    a.fga      += tg.fga
  }

  const out = {}
  for (const [opp, a] of Object.entries(allowedByOpp)) {
    if (a.games === 0) continue
    out[opp] = {
      pointsAllowedPerGame:    Number((a.pts / a.games).toFixed(2)),
      reboundsAllowedPerGame:  Number((a.reb / a.games).toFixed(2)),
      assistsAllowedPerGame:   Number((a.ast / a.games).toFixed(2)),
      threePMAllowedPerGame:   Number((a.threes / a.games).toFixed(2)),
      threePAAllowedPerGame:   Number((a.threeAtt / a.games).toFixed(2)),
      fgAttemptsAllowedPerGame: Number((a.fga / a.games).toFixed(2)),
      gamesPlayedAgainst:      a.games,
      // defensiveRating shorthand — used by nbaTeamStatsCache.js:217 fallback.
      // The cache code does `row.oppDef = stats.defensiveRating - 113` so we
      // emit the raw points-allowed-per-game value here. Higher = WORSE defense.
      defensiveRating:         Number((a.pts / a.games).toFixed(2)),
      derivedAt:               new Date().toISOString(),
    }
  }
  return out
}

function mergeIntoTeamStats(teamStats, derived) {
  // Preserve existing offensive fields; add/overwrite the derived defensive ones.
  // Anti-fabrication: only writes fields we actually derived.
  const teams = teamStats?.teams || {}
  let mergedTeamCount = 0
  for (const [abbr, defFields] of Object.entries(derived)) {
    if (!teams[abbr]) {
      // Team not in existing cache — create a stub so the defensive fields
      // are persisted. Subsequent populateNbaTeamStats fire will fill offense.
      teams[abbr] = { abbr, displayName: abbr, lastUpdated: new Date().toISOString() }
    }
    Object.assign(teams[abbr], defFields)
    mergedTeamCount += 1
  }
  return { teams, mergedTeamCount }
}

function atomicWrite(p, payload) {
  const tmp = p + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
  fs.renameSync(tmp, p)
}

function main() {
  const opts = parseArgs()
  const gameLogs = loadJson(GAME_LOGS)
  if (!gameLogs) {
    console.error("[deriveNbaTeamDefensive] cannot read " + GAME_LOGS)
    process.exit(1)
  }
  const teamStats = loadJson(TEAM_STATS)
  if (!teamStats) {
    console.error("[deriveNbaTeamDefensive] cannot read " + TEAM_STATS + " — run populateNbaTeamStats first to seed offensive fields")
    process.exit(1)
  }

  const nameToAbbr = buildNameToAbbrMap(teamStats)
  console.log("[deriveNbaTeamDefensive] team-name map: " + Object.keys(nameToAbbr).length + " entries")

  const derived = deriveDefensiveStats(gameLogs, nameToAbbr)
  const derivedTeams = Object.keys(derived).length
  console.log("[deriveNbaTeamDefensive] derived defensive stats for " + derivedTeams + " teams")
  console.log("  sample:")
  for (const abbr of Object.keys(derived).slice(0, 5)) {
    const d = derived[abbr]
    console.log("    " + abbr + ": " + d.pointsAllowedPerGame + " pts/g allowed (n=" + d.gamesPlayedAgainst + ") · " + d.threePMAllowedPerGame + " 3PM/g · " + d.reboundsAllowedPerGame + " reb/g")
  }

  if (opts.dry) {
    console.log("[deriveNbaTeamDefensive] --dry-run, not writing")
    return
  }

  const { teams, mergedTeamCount } = mergeIntoTeamStats(teamStats, derived)
  const payload = {
    ...teamStats,
    teams,
    defensiveDerivedAt: new Date().toISOString(),
    defensiveSource: "deriveNbaTeamDefensive (from nbaPlayerGameLogs)",
  }
  atomicWrite(TEAM_STATS, payload)
  console.log("[deriveNbaTeamDefensive] merged " + mergedTeamCount + " teams into " + TEAM_STATS)
  console.log("[deriveNbaTeamDefensive] OK")
}

if (require.main === module) main()

module.exports = { deriveDefensiveStats, buildNameToAbbrMap }
