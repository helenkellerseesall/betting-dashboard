"use strict"

/**
 * Probe: confirms NBA defensive engine now reads cached L5 STL/BLK for
 * known defensive-prop players. Real cache, no slate refresh, no backend.
 *
 *   node backend/scripts/probeNbaDefensiveL5Wire.js > .scratch/last.txt 2>&1
 */

const { buildNbaDefensiveProps } = require("../pipeline/mlb/../nba/buildNbaDefensiveProps")
const { getRecentForm } = require("../pipeline/nba/nbaRecentFormCache")

// Synthetic prediction object with players that should have rich L5 history.
const predictions = {
	players: [
		{ player: "Victor Wembanyama", eventId: "G7_OKC_SAS", matchup: "San Antonio Spurs @ Oklahoma City Thunder" },
		{ player: "Chet Holmgren",     eventId: "G7_OKC_SAS", matchup: "San Antonio Spurs @ Oklahoma City Thunder" },
		{ player: "Shai Gilgeous-Alexander", eventId: "G7_OKC_SAS", matchup: "San Antonio Spurs @ Oklahoma City Thunder" },
		{ player: "De'Aaron Fox",       eventId: "G7_OKC_SAS", matchup: "San Antonio Spurs @ Oklahoma City Thunder" },
	],
}

// Show direct cache reads first
console.log("=== direct recentForm cache reads ===")
for (const p of predictions.players) {
	const stl = getRecentForm(p.player, "steals")
	const blk = getRecentForm(p.player, "blocks")
	console.log(`  ${p.player.padEnd(28)}  STL: ${JSON.stringify(stl)}   BLK: ${JSON.stringify(blk)}`)
}

const completeUniverse = [
	{ player: "Victor Wembanyama", eventId: "G7_OKC_SAS", position: "C", projectedMinutes: 38, eventPace: 99, usageRate: 28 },
	{ player: "Chet Holmgren",     eventId: "G7_OKC_SAS", position: "C", projectedMinutes: 36, eventPace: 99, usageRate: 22 },
	{ player: "Shai Gilgeous-Alexander", eventId: "G7_OKC_SAS", position: "PG", projectedMinutes: 40, eventPace: 99, usageRate: 35 },
	{ player: "De'Aaron Fox",      eventId: "G7_OKC_SAS", position: "PG", projectedMinutes: 36, eventPace: 99, usageRate: 30 },
]

const result = buildNbaDefensiveProps({ predictions, completeUniverse })

console.log("\n=== defensive engine output ===")
for (const r of result.players) {
	console.log(`\n  ${r.player} (${r.archetype})`)
	console.log(`    STL band:   floor=${r.steals.floor} median=${r.steals.mostLikely} ceiling=${r.steals.ceiling}  basis=${r.stealsBasis}`)
	console.log(`    STL ladder: ${Object.entries(r.stealsLadder || {}).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join("  ")}`)
	console.log(`    BLK band:   floor=${r.blocks.floor} median=${r.blocks.mostLikely} ceiling=${r.blocks.ceiling}  basis=${r.blocksBasis}`)
	console.log(`    BLK ladder: ${Object.entries(r.blocksLadder || {}).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join("  ")}`)
}

const L5wired = result.players.some((r) => r.stealsBasis !== "archetype" || r.blocksBasis !== "archetype")
console.log("\n=== WIRE STATUS ===")
console.log(L5wired ? "PASS — at least one player projected from L5 form." : "FAIL — all players still on archetype baseline (cache may be empty or sample threshold not met)")
process.exit(L5wired ? 0 : 1)
