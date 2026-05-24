#!/usr/bin/env node
"use strict"

/**
 * computeOppDefFromGameLogs — derive opponent defensive rating from existing
 * nbaPlayerGameLogs.json. ESPN /teams/{id}/statistics returns only the team's
 * own OFFENSIVE stats (not what opponents do against them), so we compute
 * defensive rating ourselves from the data we already have.
 *
 * Method:
 *   1. Walk every player → every game record (date, opponent, points scored).
 *   2. Group by (date, opponent) to get a single "team total scored against
 *      opponent T on day D" number.
 *   3. Per opponent T: average those team totals → pointsAllowedPerGame.
 *      Lower number = better defense.
 *   4. defensiveRating = pointsAllowedPerGame (use directly — cache enricher
 *      already negates around league avg ~113 when oppDef populates).
 *
 * Writes back into backend/data/nbaTeamStats.json, adding these fields per team:
 *   - pointsAllowedPerGame
 *   - reboundsAllowedPerGame
 *   - assistsAllowedPerGame
 *   - threePAAllowedPerGame
 *   - threePMAllowedPerGame
 *   - defensiveRating (= pointsAllowedPerGame)
 *   - opponentGamesObserved (sample size for transparency)
 *
 * Safe to re-run. Honest no-op when gameLogs cache missing or empty.
 *
 * Usage:
 *   node backend/scripts/computeOppDefFromGameLogs.js
 *   node backend/scripts/computeOppDefFromGameLogs.js --dry-run
 */

const fs   = require("fs")
const path = require("path")

const LOGS_PATH       = path.join(__dirname, "..", "data", "nbaPlayerGameLogs.json")
const TEAM_STATS_PATH = path.join(__dirname, "..", "data", "nbaTeamStats.json")

const CITY_TO_ABBR = {
  "atlanta hawks": "ATL", "boston celtics": "BOS", "brooklyn nets": "BKN",
  "charlotte hornets": "CHA", "chicago bulls": "CHI", "cleveland cavaliers": "CLE",
  "dallas mavericks": "DAL", "denver nuggets": "DEN", "detroit pistons": "DET",
  "golden state warriors": "GS", "houston rockets": "HOU", "indiana pacers": "IND",
  "la clippers": "LAC", "los angeles clippers": "LAC",
  "los angeles lakers": "LAL", "la lakers": "LAL",
  "memphis grizzlies": "MEM", "miami heat": "MIA", "milwaukee bucks": "MIL",
  "minnesota timberwolves": "MIN", "new orleans pelicans": "NO",
  "new york knicks": "NY", "oklahoma city thunder": "OKC",
  "orlando magic": "ORL", "philadelphia 76ers": "PHI", "phoenix suns": "PHX",
  "portland trail blazers": "POR", "sacramento kings": "SAC",
  "san antonio spurs": "SA", "toronto raptors": "TOR",
  "utah jazz": "UTAH", "washington wizards": "WSH",
}

function normalizeTeamToAbbr(s) {
  if (!s) return null
  const key = String(s).trim().toLowerCase()
  if (CITY_TO_ABBR[key]) return CITY_TO_ABBR[key]
  // Try contains-match for partials
  for (const [city, abbr] of Object.entries(CITY_TO_ABBR)) {
    if (key.includes(city) || city.includes(key)) return abbr
  }
  return null
}

function parseArgs() {
  return { dry: process.argv.includes("--dry-run") }
}

function loadLogs() {
  try {
    if (!fs.existsSync(LOGS_PATH)) return { players: {} }
    return JSON.parse(fs.readFileSync(LOGS_PATH, "utf8")) || { players: {} }
  } catch (_) { return { players: {} } }
}

function loadTeamStats() {
  try {
    if (!fs.existsSync(TEAM_STATS_PATH)) return { teams: {}, generatedAt: null }
    return JSON.parse(fs.readFileSync(TEAM_STATS_PATH, "utf8")) || { teams: {} }
  } catch (_) { return { teams: {} } }
}

function main() {
  const opts = parseArgs()
  const logs = loadLogs()
  const playerEntries = Object.entries(logs.players || {})
  if (!playerEntries.length) {
    console.error("[oppDef] nbaPlayerGameLogs.json empty or missing — run populateNbaGameLogs first")
    process.exit(2)
  }

  // gameTotalsByOpponent[oppAbbr] = Map<gameKey, { points, rebounds, assists, threePM, threePA }>
  // where gameKey = `${date}|${attackingTeam}` so all players from same attacking team
  // on same day collapse into ONE team total.
  const gameTotalsByOpponent = new Map()

  for (const [, entry] of playerEntries) {
    const attackingTeamRaw = entry.team || null
    const attackingTeamAbbr = normalizeTeamToAbbr(attackingTeamRaw)
    if (!attackingTeamAbbr) continue
    const games = Array.isArray(entry.games) ? entry.games : []
    for (const g of games) {
      const oppAbbr = normalizeTeamToAbbr(g.opponent)
      if (!oppAbbr || !g.date) continue
      const s = g.stats || {}
      const gameKey = `${g.date}|${attackingTeamAbbr}`
      if (!gameTotalsByOpponent.has(oppAbbr)) gameTotalsByOpponent.set(oppAbbr, new Map())
      const teamGames = gameTotalsByOpponent.get(oppAbbr)
      if (!teamGames.has(gameKey)) {
        teamGames.set(gameKey, { points: 0, rebounds: 0, assists: 0, threePM: 0, threePA: 0, fga: 0 })
      }
      const t = teamGames.get(gameKey)
      t.points   += Number(s.points)   || 0
      t.rebounds += Number(s.rebounds) || 0
      t.assists  += Number(s.assists)  || 0
      t.threePM  += Number(s.threes)   || 0
      t.threePA  += Number(s.threeAtt) || 0
      t.fga      += Number(s.fga)      || 0
    }
  }

  // Compute averages per opponent
  const oppStats = {}
  for (const [oppAbbr, teamGames] of gameTotalsByOpponent.entries()) {
    const gameTotals = Array.from(teamGames.values())
    const n = gameTotals.length
    if (n === 0) continue
    const sum = gameTotals.reduce(
      (a, t) => ({
        points:   a.points + t.points,
        rebounds: a.rebounds + t.rebounds,
        assists:  a.assists + t.assists,
        threePM:  a.threePM + t.threePM,
        threePA:  a.threePA + t.threePA,
        fga:      a.fga + t.fga,
      }),
      { points: 0, rebounds: 0, assists: 0, threePM: 0, threePA: 0, fga: 0 }
    )
    oppStats[oppAbbr] = {
      pointsAllowedPerGame:    +(sum.points / n).toFixed(2),
      reboundsAllowedPerGame:  +(sum.rebounds / n).toFixed(2),
      assistsAllowedPerGame:   +(sum.assists / n).toFixed(2),
      threePMAllowedPerGame:   +(sum.threePM / n).toFixed(2),
      threePAAllowedPerGame:   +(sum.threePA / n).toFixed(2),
      fgaAllowedPerGame:       +(sum.fga / n).toFixed(2),
      defensiveRating:         +(sum.points / n).toFixed(2),
      opponentGamesObserved:   n,
    }
  }

  // Merge into nbaTeamStats.json
  const teamStats = loadTeamStats()
  const teamsOut = teamStats.teams || {}
  let updated = 0
  for (const [abbr, stats] of Object.entries(oppStats)) {
    if (!teamsOut[abbr]) {
      console.warn(`[oppDef] ${abbr}: no existing team entry; skipping (run populateNbaTeamStats first)`)
      continue
    }
    Object.assign(teamsOut[abbr], stats, { oppDefLastComputed: new Date().toISOString() })
    updated++
    const dr = stats.defensiveRating
    const n = stats.opponentGamesObserved
    console.log(`  ${abbr.padEnd(4)} ✓ allows ${dr.toFixed(1)} ppg over ${n} games observed`)
  }

  console.log(`\n[oppDef] updated ${updated} teams`)

  if (opts.dry) {
    console.log("[oppDef] --dry-run, NOT writing")
    return
  }

  const payload = {
    ...teamStats,
    teams: teamsOut,
    oppDefMergedAt: new Date().toISOString(),
  }
  fs.writeFileSync(TEAM_STATS_PATH, JSON.stringify(payload, null, 2), "utf8")
  console.log(`[oppDef] wrote ${TEAM_STATS_PATH}`)
}

if (require.main === module) {
  try { main() } catch (err) {
    console.error("[oppDef] fatal:", err)
    process.exit(1)
  }
}
