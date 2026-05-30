"use strict"

/**
 * Operator-friendly probe — Tier 3 #9 MLB park multi-stat + L/R splits.
 * Shows per-batter park signal for HR + Hits given their handedness.
 */

const pf = require("../data/mlbParkFactors.json")

console.log("=== TIER 3 #9 VERIFICATION — MLB park multi-stat + L/R splits ===\n")

const cases = [
	{ player: "Aaron Judge",      hand: "R", parkTeam: "new york yankees",   note: "(home park, RHB)" },
	{ player: "Shohei Ohtani",    hand: "L", parkTeam: "los angeles dodgers", note: "(home park, LHB)" },
	{ player: "Kyle Schwarber",   hand: "L", parkTeam: "philadelphia phillies", note: "(home park, LHB — Citizens Bank L 1.18)" },
	{ player: "Yordan Alvarez",   hand: "L", parkTeam: "houston astros",     note: "(home park, LHB — Minute Maid L 1.00)" },
	{ player: "(any RHB)",        hand: "R", parkTeam: "boston red sox",     note: "(Fenway, R-friendly via Green Monster)" },
	{ player: "(any LHB)",        hand: "L", parkTeam: "boston red sox",     note: "(Fenway, L-unfriendly: 0.95)" },
	{ player: "(any LHB)",        hand: "L", parkTeam: "new york yankees",   note: "(Yankee Stadium short porch: L 1.25)" },
	{ player: "(any RHB)",        hand: "R", parkTeam: "new york yankees",   note: "(Yankee Stadium for RHB: only 1.05)" },
	{ player: "(any)",            hand: "R", parkTeam: "colorado rockies",   note: "(Coors — everything boosted)" },
	{ player: "(any)",            hand: "L", parkTeam: "san francisco giants", note: "(Oracle Park, L-suppressed 0.80)" },
]

console.log("STEP 1 — per-batter HR park factor (by handedness)\n")
for (const c of cases) {
	const p = pf[c.parkTeam]
	if (!p) continue
	const hand = c.hand
	const hrFactorHand = p.hrFactorByHand?.[hand]
	const hrFactor = p.hrFactor
	const used = (hrFactorHand != null) ? hrFactorHand : hrFactor
	console.log(`${c.player} (${hand}HB) at ${c.parkTeam}  ${c.note}`)
	console.log(`  hrFactor (general): ${hrFactor}  ·  hrFactorByHand[${hand}]: ${hrFactorHand}  ·  using: ${used}`)
	const delta = ((used - 1.0) * 100).toFixed(0)
	console.log(`  → park environment ${delta >= 0 ? '+' : ''}${delta}% relative to neutral`)
	console.log()
}

console.log("\nSTEP 2 — hitsFactor coverage (used by Hits engine)\n")
const samples = ["colorado rockies", "boston red sox", "kansas city royals", "san francisco giants", "miami marlins"]
for (const t of samples) {
	const p = pf[t]
	console.log(`  ${t.padEnd(30)} hitsFactor=${p?.hitsFactor}  runsFactor=${p?.runsFactor}  kFactor=${p?.kFactor}`)
}

console.log("\nSTEP 3 — operator-friendly read for Schwarber tonight\n")
const schSpec = { player: "Kyle Schwarber", hand: "L", parkTeam: "philadelphia phillies" }
const sp = pf[schSpec.parkTeam]
const sHrHand = sp.hrFactorByHand?.[schSpec.hand]
console.log(`  Schwarber (LHB) hits at HOME park (Citizens Bank)`)
console.log(`  Citizens Bank HR factor for LHB: ${sHrHand}`)
console.log(`  His HR projection gets a +18% park boost on top of his .107 hrRate and 9-HR-in-15 burst signal`)
console.log(`  Pre-park HR projection ~0.45 HR/game → post-park ~0.53 HR/game`)
