"use strict"

/**
 * Operator-friendly verification probe for Tier 3 #10 —
 * pitcher pitch count / IP-per-start / rest signal in pitcher_outs surface bonus.
 */

const { getPitcherForm } = require("../pipeline/mlb/mlbPitcherFormCache")
const ib = require("../pipeline/mlb/buildMlbInspectionBoard")

const tonightPitchers = ["Framber Valdez", "Anthony Kay"]

console.log("=== TIER 3 #10 VERIFICATION — pitcher_outs context bonus from L3 form ===\n")

for (const p of tonightPitchers) {
	const l3 = getPitcherForm(p, 3)
	const l5 = getPitcherForm(p, 5)
	if (!l3) { console.log(`${p}: no L3 cache entry`); continue }
	console.log(`${p} — recent form (last ~3 starts):`)
	console.log(`  ipPerStart=${l3.ipPerStart}  pitchesPerStart=${l3.pitchesPerStart}  daysSinceLastStart=${l3.daysSinceLastStart}`)
	console.log(`  whip=${l3.whip}  era=${l3.era}  k9=${l3.k9}`)
	console.log()

	// Synth pitcher_outs OVER row with the L3 form attached
	const row = {
		player: p,
		marketKey: "pitcher_outs",
		side: "over",
		line: 16.5,
		isPitcherMarket: true,
		pitcherStats: {
			inningsPitched: l5?.totalIp ?? 50,
			gamesStarted: 8,
			whip: l3.whip, era: l3.era, kRate: l5?.kRate ?? 0.20,
		},
		pitcherL3: l3,
	}
	const bonus = ib.__test__.computePitcherContextBonus(row)
	console.log(`  → pitcher_outs OVER surface bonus = ${bonus.toFixed(4)}`)
	console.log(`    (positive = boost OVER picks · negative = dampen)`)
	console.log()
}

console.log("=== L3 signal sources at play ===")
console.log("  ipPerStart > 5.5     → bonus +")
console.log("  pitchesPerStart > 95 → bonus +")
console.log("  daysSinceLastStart >= 5 → +0.02 (fresh)")
console.log("  daysSinceLastStart <= 3 → -0.03 (short rest = early hook risk)")
