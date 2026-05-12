"use strict"
process.chdir(__dirname)
// Unit-test populator parser + merger using a real-shape ESPN summary fixture.
// NO network. NO synthetic player names invented for the cache — fixture is
// labeled fixture-only and is only used to verify parsing/merging code paths.

const path = require("path")
const fs   = require("fs")
const { parseSummary, mergeIntoCache, loadCache, parseEspnStat, parseEspnRatio } =
  require("./backend/scripts/populateNbaGameLogs")

// Real-shape ESPN summary fixture (NOT injected into actual cache; used to
// validate the parser only). Field names + structure mirror the live ESPN
// payload that fetchNbaGameResults.js was built against.
const fixture = {
  boxscore: {
    teams: [
      { team: { id: "1", displayName: "Cleveland Cavaliers", abbreviation: "CLE" }, homeAway: "home" },
      { team: { id: "2", displayName: "Detroit Pistons",     abbreviation: "DET" }, homeAway: "away" },
    ],
    players: [
      {
        team: { id: "1", displayName: "Cleveland Cavaliers" },
        statistics: [
          {
            keys:  ["minutes","fieldGoalsAttempted","threePointFieldGoals","freeThrows","offensiveRebounds","defensiveRebounds","rebounds","assists","steals","blocks","turnovers","fouls","plusMinus","points"],
            athletes: [
              { athlete: { displayName: "Donovan Mitchell" }, starter: true,
                stats: ["38:12","18-32","3-9","6-7","1","4","5","7","2","0","3","2","+8","32"] },
              { athlete: { displayName: "Evan Mobley" }, starter: true,
                stats: ["34:55","9-15","0-1","2-3","2","6","8","4","1","2","2","3","+5","20"] },
              { athlete: { displayName: "Bench Guy" }, didNotPlay: true, stats: [] },
            ],
          },
        ],
      },
      {
        team: { id: "2", displayName: "Detroit Pistons" },
        statistics: [
          {
            keys:  ["minutes","fieldGoalsAttempted","threePointFieldGoals","freeThrows","offensiveRebounds","defensiveRebounds","rebounds","assists","steals","blocks","turnovers","fouls","plusMinus","points"],
            athletes: [
              { athlete: { displayName: "Cade Cunningham" }, starter: true,
                stats: ["41:03","21-25","2-7","6-8","0","3","3","11","1","0","4","2","-8","30"] },
              { athlete: { displayName: "Jalen Duren" }, starter: true,
                stats: ["29:30","6-8","0-0","0-2","4","8","12","2","1","1","2","4","-3","12"] },
            ],
          },
        ],
      },
    ],
  },
}

console.log("=== Parser sanity ===")
console.log("parseEspnStat('38:12') =>", parseEspnStat("38:12"))
console.log("parseEspnStat('32')    =>", parseEspnStat("32"))
console.log("parseEspnStat('--')    =>", parseEspnStat("--"))
console.log("parseEspnRatio('3-9','made') =>", parseEspnRatio("3-9","made"))
console.log("parseEspnRatio('3-9','att')  =>", parseEspnRatio("3-9","att"))
console.log()

const parsed = parseSummary(fixture, "2026-05-09")
console.log(`=== parseSummary on fixture: ${parsed.length} player-game rows ===`)
for (const e of parsed) {
  console.log(JSON.stringify({
    player: e.player, team: e.team, opponent: e.opponent, isHome: e.isHome, starter: e.starter,
    date: e.date, stats: e.stats,
  }))
}

console.log("\n=== Merger sanity (does NOT clobber settled-bets entries) ===")
// Load real persisted cache (Session AP populated it from settled bets)
const cache = loadCache()
const beforePlayers = Object.keys(cache.players).length
const beforeGames   = Object.values(cache.players).reduce((s,p)=>s+(p.games?.length||0),0)
console.log("BEFORE merge: players=", beforePlayers, " games=", beforeGames)

// Show pre-merge Donovan entry
console.log("BEFORE Donovan Mitchell games:", JSON.stringify(cache.players["donovan mitchell"]?.games || [], null, 2))

const result = mergeIntoCache(cache, parsed)
console.log("\nmerge result:", result)

const afterPlayers = Object.keys(cache.players).length
const afterGames   = Object.values(cache.players).reduce((s,p)=>s+(p.games?.length||0),0)
console.log("AFTER  merge: players=", afterPlayers, " games=", afterGames)

console.log("\nAFTER Donovan Mitchell games (settled-bets entry should be UNION-MERGED with ESPN entry):")
console.log(JSON.stringify(cache.players["donovan mitchell"]?.games || [], null, 2))

// IMPORTANT: do not persist this fixture-derived test merge to disk —
// the populator script handles real persistence; this probe only validates code paths.
console.log("\n[unit-test] NOT writing cache (fixture-only).")
