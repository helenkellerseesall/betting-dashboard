"use strict"

/**
 * Operator-friendly verification probe for Tier 2 #6 — opp steals-allowed.
 */

const { enrichRowWithTeamStats } = require("../pipeline/nba/nbaTeamStatsCache")

console.log("=== TIER 2 #6 VERIFICATION — opp steals-allowed → player_steals ===")
console.log("Tonight Game 7: San Antonio Spurs @ Oklahoma City Thunder\n")

const cases = [
	{ player: "Shai Gilgeous-Alexander", playsFor: "OKC", opponent: "San Antonio Spurs",     role: "guard" },
	{ player: "Alex Caruso",             playsFor: "OKC", opponent: "San Antonio Spurs",     role: "wing"  },
	{ player: "Chet Holmgren",           playsFor: "OKC", opponent: "San Antonio Spurs",     role: "big"   },
	{ player: "Victor Wembanyama",       playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "big"   },
	{ player: "De'Aaron Fox",            playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "guard" },
	{ player: "Devin Vassell",           playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "wing"  },
]

const BASELINES = { guard: 1.0, wing: 0.8, big: 0.5 }

for (const c of cases) {
	const row = { player: c.player, opponent: c.opponent, role: c.role }
	enrichRowWithTeamStats(row)
	const allowed = row.opponentStealsAllowedForRole
	const mul = row.opponentStealsMultiplier
	const base = BASELINES[c.role]
	const shortOpp = c.opponent.includes("Oklahoma") ? "OKC" : "SAS"
	console.log(`${c.player} plays for ${c.playsFor}, tonight faces ${shortOpp}`)
	console.log(`  ${shortOpp} allows opposing ${c.role}s ${allowed} steals/game (vs league baseline ${base})`)
	let outcome
	if (mul > 1.05) outcome = `BOOST his steals projection +${((mul-1)*100).toFixed(1)}% — OVER bets look attractive`
	else if (mul < 0.95) outcome = `DAMPEN his steals projection ${((mul-1)*100).toFixed(1)}% — OVER bets look fadeable`
	else outcome = `near-neutral matchup — no significant shift`
	console.log(`  → multiplier: ${mul}  ·  ${outcome}`)
	console.log()
}

console.log("=== END-TO-END: defensive engine reading row.opponentStealsMultiplier ===\n")
const { buildNbaDefensiveProps } = require("../pipeline/nba/buildNbaDefensiveProps")
const universe = cases.map((c) => {
	const row = {
		player: c.player,
		eventId: "G7_OKC_SAS",
		opponent: c.opponent,
		role: c.role,
		position: c.role === "big" ? "C" : c.role === "wing" ? "SF" : "PG",
		projectedMinutes: 36,
		eventPace: 99,
		usageRate: c.role === "guard" ? 28 : 22,
	}
	enrichRowWithTeamStats(row)
	return row
})
const predictions = { players: cases.map((c) => ({ player: c.player, eventId: "G7_OKC_SAS", matchup: "San Antonio Spurs @ Oklahoma City Thunder" })) }
const result = buildNbaDefensiveProps({ predictions, completeUniverse: universe })
for (const r of result.players) {
	const baseline = r.archetype === "guard" ? 1.05 : r.archetype === "wing" ? 0.85 : 0.60
	console.log(`  ${r.player.padEnd(28)} (${r.archetype}) STL median=${r.steals.mostLikely}  basis=${r.stealsBasis}  ladder@1.5+=${r.stealsLadder?.["1.5+"]}`)
}
