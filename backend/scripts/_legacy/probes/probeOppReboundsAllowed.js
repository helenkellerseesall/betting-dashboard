"use strict"

/**
 * Operator-friendly verification probe for Tier 2 #5 — opp rebounds-allowed.
 *
 * Format follows feedback_operator_language: every line says who plays for
 * whom, who they FACE tonight, baseline comparison, bettor-action outcome.
 */

const { enrichRowWithTeamStats } = require("../pipeline/nba/nbaTeamStatsCache")

console.log("=== TIER 2 #5 VERIFICATION — opp rebounds-allowed → player_rebounds ===")
console.log("Tonight Game 7: San Antonio Spurs @ Oklahoma City Thunder\n")

const cases = [
	// OKC players face SAS tonight
	{ player: "Shai Gilgeous-Alexander", playsFor: "OKC", opponent: "San Antonio Spurs",     role: "guard", betNote: "(YOUR BET: SGA reb UNDER 3.5)" },
	{ player: "Chet Holmgren",           playsFor: "OKC", opponent: "San Antonio Spurs",     role: "big",   betNote: "" },
	{ player: "Alex Caruso",             playsFor: "OKC", opponent: "San Antonio Spurs",     role: "wing",  betNote: "(YOUR BET: Caruso reb UNDER 3.5)" },
	// SAS players face OKC tonight
	{ player: "Victor Wembanyama",       playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "big",   betNote: "(YOUR BET: Wemby reb UNDER 12.5)" },
	{ player: "Devin Vassell",           playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "wing",  betNote: "" },
	{ player: "De'Aaron Fox",            playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "guard", betNote: "" },
]

const BASELINES = { guard: 3.5, wing: 4.5, big: 8.5 }

for (const c of cases) {
	const row = { player: c.player, opponent: c.opponent, role: c.role }
	enrichRowWithTeamStats(row)
	const allowed = row.opponentReboundsAllowedForRole
	const mul = row.opponentReboundsMultiplier
	const base = BASELINES[c.role]
	const shortOpp = c.opponent.includes("Oklahoma") ? "OKC" : "SAS"

	console.log(`${c.player} plays for ${c.playsFor}, tonight faces ${shortOpp}  ${c.betNote}`)
	console.log(`  ${shortOpp} allows opposing ${c.role}s ${allowed} rebounds/game (vs league baseline ${base})`)
	let outcome
	if (mul > 1.05) outcome = `BOOST his rebounds projection +${((mul-1)*100).toFixed(1)}% — UNDER bets look fadeable`
	else if (mul < 0.95) outcome = `DAMPEN his rebounds projection ${((mul-1)*100).toFixed(1)}% — UNDER bets look attractive`
	else outcome = `near-neutral matchup — no significant shift`
	console.log(`  → multiplier: ${mul}  ·  ${outcome}`)
	console.log()
}

console.log("=== END-TO-END: rebounds projection for a 9.0 reb/game big ===\n")
for (const c of cases) {
	const row = { player: c.player, opponent: c.opponent, role: c.role }
	enrichRowWithTeamStats(row)
	const mul = Number(row.opponentReboundsMultiplier) || 1
	const sampleBaseProj = c.role === "big" ? 9.0 : c.role === "wing" ? 4.5 : 3.5
	const adjusted = (sampleBaseProj * mul).toFixed(2)
	const delta = ((mul - 1) * 100).toFixed(1)
	console.log(`  ${c.player.padEnd(28)} (${c.playsFor} ${c.role}) baseline ${sampleBaseProj} reb → adjusted ${adjusted} reb  (${delta >= 0 ? '+' : ''}${delta}%)`)
}
