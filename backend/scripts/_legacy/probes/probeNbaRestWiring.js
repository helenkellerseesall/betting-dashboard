"use strict"

/**
 * Verification probe — proves NBA rest tracker fires on real cache data.
 *   1. getRestStatus returns real values for Game 7 starters
 *   2. restMinutesMultiplier produces correct B2B / rest adjustments
 *   3. End-to-end: roleContext picks up restContext and adjusts projectedMinutes
 */

const { getRestStatus, restMinutesMultiplier } = require("../pipeline/nba/nbaRestCache")
const { enrichRowWithRoleContext } = require("../pipeline/nba/nbaRoleContextDeriver")

const players = [
	"Victor Wembanyama",
	"Shai Gilgeous-Alexander",
	"Chet Holmgren",
	"De'Aaron Fox",
	"Devin Vassell",
	"Alex Caruso",
]
const slateDate = "2026-05-30"

console.log("=== STEP 1 — rest status per player (slateDate = " + slateDate + ") ===\n")
for (const p of players) {
	const r = getRestStatus(p, slateDate)
	if (!r) { console.log(`${p.padEnd(28)} NO CACHE ENTRY`); continue }
	console.log(`${p.padEnd(28)} lastGame=${r.lastGameDate}  dsl=${r.daysSinceLastGame}  B2B=${r.isBackToBack}  3day=${r.gamesInLast3Days}  7day=${r.gamesInLast7Days}`)
}

console.log("\n=== STEP 2 — minutes multiplier per scenario ===\n")
const scenarios = [
	{ label: "back-to-back",    row: { restContext: { isBackToBack: true,  daysSinceLastGame: 1, gamesInLast3Days: 2 } } },
	{ label: "1 day rest",      row: { restContext: { isBackToBack: false, daysSinceLastGame: 1, gamesInLast3Days: 1 } } },
	{ label: "2 days rest",     row: { restContext: { isBackToBack: false, daysSinceLastGame: 2, gamesInLast3Days: 1 } } },
	{ label: "3 days rest",     row: { restContext: { isBackToBack: false, daysSinceLastGame: 3, gamesInLast3Days: 1 } } },
	{ label: "3 games in 3 days", row: { restContext: { isBackToBack: false, daysSinceLastGame: 1, gamesInLast3Days: 3 } } },
	{ label: "no restContext",  row: {} },
]
for (const s of scenarios) {
	const m = restMinutesMultiplier(s.row)
	console.log(`  ${s.label.padEnd(22)} → multiplier=${m}`)
}

console.log("\n=== STEP 3 — end-to-end: roleContext applies multiplier ===\n")
for (const p of players) {
	const r = getRestStatus(p, slateDate)
	if (!r) continue
	// Simulate a row that goes through roleContext after restContext attached.
	const baselineMin = 36
	const row = {
		player: p,
		statFamily: "points",
		eventId: "G7_OKC_SAS",
		matchup: "San Antonio Spurs @ Oklahoma City Thunder",
		projectedMinutes: baselineMin,
		restContext: r,
	}
	enrichRowWithRoleContext(row)
	const after = row.projectedMinutes
	const delta = (after - baselineMin).toFixed(2)
	console.log(`  ${p.padEnd(28)} baseline=${baselineMin}min  → adjusted=${after}min  (Δ=${delta})  restMul=${row.restMinutesAdjustment ?? "1.00"}`)
}
