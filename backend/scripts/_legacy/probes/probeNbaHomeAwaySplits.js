"use strict"

/**
 * Operator-friendly verification probe for Tier 3 #8 — NBA home/away splits.
 *
 * Tonight Game 7 is AT OKC. OKC players are HOME tonight, SAS players are AWAY.
 */

const { getHomeAwaySplit, homeAwayMultiplier, enrichRowWithHomeAwaySplit } = require("../pipeline/nba/nbaHomeAwaySplits")

console.log("=== TIER 3 #8 VERIFICATION — NBA home/away splits ===")
console.log("Tonight Game 7: SAS @ OKC (game played AT OKC)\n")

const cases = [
	// OKC players are HOME tonight
	{ player: "Shai Gilgeous-Alexander", playsFor: "OKC", isHome: true,  family: "points",   statKey: "points"   },
	{ player: "Chet Holmgren",           playsFor: "OKC", isHome: true,  family: "rebounds", statKey: "rebounds" },
	{ player: "Alex Caruso",             playsFor: "OKC", isHome: true,  family: "points",   statKey: "points"   },
	// SAS players are AWAY tonight
	{ player: "Victor Wembanyama",       playsFor: "SAS", isHome: false, family: "points",   statKey: "points"   },
	{ player: "Victor Wembanyama",       playsFor: "SAS", isHome: false, family: "rebounds", statKey: "rebounds" },
	{ player: "De'Aaron Fox",            playsFor: "SAS", isHome: false, family: "assists",  statKey: "assists"  },
	{ player: "Devin Vassell",           playsFor: "SAS", isHome: false, family: "threes",   statKey: "threes"   },
]

console.log("=== STEP 1 — per-player split + tonight's multiplier ===\n")
for (const c of cases) {
	const split = getHomeAwaySplit(c.player, c.statKey)
	const row = { player: c.player, isHome: c.isHome, statFamily: c.family }
	enrichRowWithHomeAwaySplit(row)
	const mul = row.homeAwayMultiplier ?? "n/a"
	const venue = c.isHome ? "HOME" : "AWAY"

	console.log(`${c.player} plays for ${c.playsFor}, tonight is ${venue} (Game 7 is at OKC)`)
	if (!split) {
		console.log(`  no split data (need ≥3 home + ≥3 away ${c.statKey} games in cache)`)
	} else {
		console.log(`  ${c.statKey}: home avg ${split.homeAvg} (${split.homeGames} games), away avg ${split.awayAvg} (${split.awayGames} games), overall ${split.overallAvg}`)
		const lean = c.isHome ? split.homeAvg : split.awayAvg
		const delta = ((mul - 1) * 100).toFixed(1)
		let outcome
		if (mul > 1.025) outcome = `BOOST projection +${delta}% — OVER bets gain ground`
		else if (mul < 0.975) outcome = `DAMPEN projection ${delta}% — UNDER bets gain ground`
		else outcome = `near-neutral home/away split`
		console.log(`  → tonight's ${venue} avg: ${lean}  ·  multiplier: ${mul}  ·  ${outcome}`)
	}
	console.log()
}
