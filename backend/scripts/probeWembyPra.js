"use strict"

/**
 * Probe Wemby's PRA projection chain. Goal: find where his projection drops
 * from 38 (cache truth) to ~18 (model output).
 */

const { getRecentForm } = require("../pipeline/nba/nbaRecentFormCache")

// Step 1: cache truth
console.log("=== STEP 1: cache truth for Wemby ===")
for (const fam of ["points", "rebounds", "assists", "pra"]) {
	const f = getRecentForm("Victor Wembanyama", fam)
	console.log(`  ${fam.padEnd(10)}  ${JSON.stringify(f)}`)
}

// Step 2: simulate what projectStat sees
console.log("\n=== STEP 2: simulate projectStat for each component ===")
const { enrichRowWithRecentForm } = require("../pipeline/nba/nbaRecentFormCache")

function makeRow(family) {
	return {
		player: "Victor Wembanyama",
		statFamily: family,
		propType: family,
		eventId: "G7_OKC_SAS",
		opponent: "Oklahoma City Thunder",
		gameTotal: 215,
		eventPace: 99,
		usageRate: 28,
		projectedMinutes: 38,
		archetype: "big",
		role: "big",
		position: "C",
		matchup: "San Antonio Spurs @ Oklahoma City Thunder",
		line: 16.5,
		odds: -110,
	}
}

for (const fam of ["points", "rebounds", "assists"]) {
	const row = makeRow(fam)
	enrichRowWithRecentForm(row)
	console.log(`\n  ${fam}:`)
	console.log(`    statFamily on row: ${row.statFamily}`)
	console.log(`    recentForm on row: ${JSON.stringify(row.recentForm)}`)
	console.log(`    last5Avg on row: ${row.last5Avg}`)
}

// Step 3: call projectStat directly with a points row
console.log("\n=== STEP 3: invoke buildNbaPlayerOutcomePredictions internals ===")
const bn = require("../pipeline/nba/buildNbaPlayerOutcomePredictions")
// projectStat isn't exported, so we'll inspect what the full module produces.
// Build a synthetic predictions input.

// Minimal opportunityBoard shape — completeUniverse is the universe of rows.
const universe = []
for (const fam of ["points", "rebounds", "assists"]) {
	const row = makeRow(fam)
	enrichRowWithRecentForm(row)
	universe.push(row)
}

const opportunityBoard = {
	completeUniverse: universe,
	// other fields the module might iterate
	ladderPools: { points: [], rebounds: [], assists: [], pra: [] },
	corePools: { points: [], rebounds: [], assists: [], pra: [] },
}

let predictions
try {
	predictions = bn.buildNbaPlayerOutcomePredictions({ opportunityBoard })
} catch (e) {
	console.log("  buildNbaPlayerOutcomePredictions threw:", e?.message)
	console.log("  stack:", e?.stack?.split("\n").slice(0, 5).join("\n"))
}

if (predictions) {
	console.log("  predictions keys:", Object.keys(predictions).slice(0, 10))
	const players = predictions?.players || []
	console.log("  player count:", players.length)
	const wemby = players.find((p) => /wemb/i.test(p.player || ""))
	if (wemby) {
		console.log("\n  Wemby projection:")
		console.log("    points:", JSON.stringify(wemby.stats?.points))
		console.log("    rebounds:", JSON.stringify(wemby.stats?.rebounds))
		console.log("    assists:", JSON.stringify(wemby.stats?.assists))
		console.log("    pra:", JSON.stringify(wemby.stats?.pra))
	} else {
		console.log("\n  Wemby NOT in predictions output")
	}
}
