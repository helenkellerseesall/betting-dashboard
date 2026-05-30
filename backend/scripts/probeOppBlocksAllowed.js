"use strict"

/**
 * Operator-friendly verification probe for Tier 2 #7 — opp blocks-allowed.
 */

const { enrichRowWithTeamStats } = require("../pipeline/nba/nbaTeamStatsCache")

console.log("=== TIER 2 #7 VERIFICATION — opp blocks-allowed → player_blocks ===")
console.log("Tonight Game 7: San Antonio Spurs @ Oklahoma City Thunder\n")

const cases = [
	{ player: "Shai Gilgeous-Alexander", playsFor: "OKC", opponent: "San Antonio Spurs",     role: "guard" },
	{ player: "Alex Caruso",             playsFor: "OKC", opponent: "San Antonio Spurs",     role: "wing"  },
	{ player: "Chet Holmgren",           playsFor: "OKC", opponent: "San Antonio Spurs",     role: "big"   },
	{ player: "Victor Wembanyama",       playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "big"   },
	{ player: "De'Aaron Fox",            playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "guard" },
	{ player: "Devin Vassell",           playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "wing"  },
]
const BASELINES = { guard: 0.3, wing: 0.4, big: 1.0 }

for (const c of cases) {
	const row = { player: c.player, opponent: c.opponent, role: c.role }
	enrichRowWithTeamStats(row)
	const allowed = row.opponentBlocksAllowedForRole
	const mul = row.opponentBlocksMultiplier
	const base = BASELINES[c.role]
	const shortOpp = c.opponent.includes("Oklahoma") ? "OKC" : "SAS"
	console.log(`${c.player} plays for ${c.playsFor}, tonight faces ${shortOpp}`)
	console.log(`  ${shortOpp} allows opposing ${c.role}s ${allowed} blocks/game (vs league baseline ${base})`)
	let outcome
	if (mul > 1.05) outcome = `BOOST his blocks projection +${((mul-1)*100).toFixed(1)}% — OVER bets look attractive`
	else if (mul < 0.95) outcome = `DAMPEN his blocks projection ${((mul-1)*100).toFixed(1)}% — OVER bets look fadeable`
	else outcome = `near-neutral matchup — no significant shift`
	console.log(`  → multiplier: ${mul}  ·  ${outcome}`)
	console.log()
}

console.log("=== END-TO-END: defensive engine reading row.opponentBlocksMultiplier ===\n")
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
	console.log(`  ${r.player.padEnd(28)} (${r.archetype}) BLK median=${r.blocks.mostLikely}  basis=${r.blocksBasis}  ladder@1.5+=${r.blocksLadder?.["1.5+"]}  @2.5+=${r.blocksLadder?.["2.5+"]}  @3.5+=${r.blocksLadder?.["3.5+"]}`)
}
