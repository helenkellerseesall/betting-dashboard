"use strict"

/**
 * Direct test of the applyMlbContextualLayers backfill — proves
 * row.impliedTeamTotal gets attached when gameTotal exists.
 */

const { applyMlbContextualLayers } = require("../pipeline/mlb/context/applyMlbContextualLayers")

const cases = [
	{ label: "row WITH gameTotal but no impliedTeamTotal",  row: { player: "Aaron Judge", marketKey: "batter_home_runs", marketFamily: "standard", propType: "hr", eventId: "e1", line: 0.5, side: "Over", odds: 320, gameTotal: 9.5 } },
	{ label: "row WITH gameTotal AND existing impliedTeamTotal",  row: { player: "Aaron Judge", marketKey: "batter_hits", marketFamily: "standard", propType: "hits", eventId: "e2", line: 1.5, side: "Over", odds: 180, gameTotal: 9, impliedTeamTotal: 5.2 } },
	{ label: "row WITHOUT gameTotal (no fallback possible)",  row: { player: "Aaron Judge", marketKey: "batter_rbis", marketFamily: "standard", propType: "rbis", eventId: "e3", line: 0.5, side: "Over", odds: 200 } },
	{ label: "synthetic pitcher row (should not get backfill)",  row: { player: "Anthony Kay", marketKey: "pitcher_strikeouts", marketFamily: "standard", propType: "Ks", eventId: "e4", line: 6.5, side: "Over", odds: -110, isPitcherMarket: true, gameTotal: 9.5 } },
]

console.log("=== applyMlbContextualLayers backfill probe ===\n")
for (const c of cases) {
	const before = { gameTotal: c.row.gameTotal, impliedTeamTotal: c.row.impliedTeamTotal }
	const result = applyMlbContextualLayers({ rows: [c.row], events: [] })
	const after = result.rows[0]
	console.log(c.label)
	console.log(`  before: gameTotal=${before.gameTotal}  impliedTeamTotal=${before.impliedTeamTotal}`)
	console.log(`  after:  gameTotal=${after.gameTotal}  impliedTeamTotal=${after.impliedTeamTotal}  source=${after._impliedTeamTotalSource || "primary"}`)
	console.log()
}
