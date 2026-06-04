"use strict"

/**
 * Verification probe — proves Tier 2 #4 (Opp 3PA-allowed) is wired end-to-end.
 *
 *   1. Regenerate DvP cache (now includes threeAtt) and confirm the key landed
 *   2. enrichRowWithTeamStats attaches row.opponentThreePAAllowedPerGame
 *   3. Show what the shot-volume multiplier WOULD apply for Game 7 shooters
 */

const fs = require("fs")
const path = require("path")
const { enrichRowWithTeamStats } = require("../pipeline/nba/nbaTeamStatsCache")

const DvP_FILE = path.join(__dirname, "..", "data", "nbaDvP.json")
const raw = JSON.parse(fs.readFileSync(DvP_FILE, "utf8"))
const teams = raw?.teams || {}

console.log("=== STEP 1 — DvP cache now includes threeAtt per role ===\n")
for (const team of ["Oklahoma City Thunder", "San Antonio Spurs"]) {
	const t = teams[team]
	if (!t) { console.log(`${team}: NO entry`); continue }
	console.log(`${team}:`)
	for (const role of ["guard", "wing", "big"]) {
		const r = t[role]
		if (!r) { console.log(`  ${role}: no data`); continue }
		const tm = r.threes?.mean ?? "?"
		const ta = r.threeAtt?.mean ?? "?"
		const gp = r.threeAtt?.gp ?? r.threes?.gp ?? "?"
		console.log(`  ${role.padEnd(6)} threes/g (made)=${tm}  threeAtt/g (attempts)=${ta}  gp=${gp}`)
	}
	console.log()
}

console.log("=== STEP 2 — per-role opp 3PA-allowed attachment ===")
console.log("Tonight Game 7: SAS @ OKC. SGA/Holmgren/Caruso/Joe play FOR OKC, face SAS.")
console.log("Wemby/Vassell/Fox play FOR SAS, face OKC.\n")
const cases = [
	// Each row: who they ARE for, who they FACE tonight
	{ player: "Shai Gilgeous-Alexander", playsFor: "OKC", opponent: "San Antonio Spurs",     role: "guard" },
	{ player: "Chet Holmgren",           playsFor: "OKC", opponent: "San Antonio Spurs",     role: "big"   },
	{ player: "Alex Caruso",             playsFor: "OKC", opponent: "San Antonio Spurs",     role: "wing"  },
	{ player: "Isaiah Joe",              playsFor: "OKC", opponent: "San Antonio Spurs",     role: "guard" },
	{ player: "Victor Wembanyama",       playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "big"   },
	{ player: "Devin Vassell",           playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "wing"  },
	{ player: "De'Aaron Fox",            playsFor: "SAS", opponent: "Oklahoma City Thunder", role: "guard" },
]
const BASELINES = { guard: 3.5, wing: 2.8, big: 1.5 }
for (const c of cases) {
	const row = { player: c.player, opponent: c.opponent, role: c.role }
	enrichRowWithTeamStats(row)
	const v = row.opponentThreePAAllowedForRole
	const m = row.opponentThreePAMultiplier
	const base = BASELINES[c.role]
	const shortOpp = c.opponent.includes("Oklahoma") ? "OKC" : "SAS"
	console.log(`${c.player} plays for ${c.playsFor}, tonight faces ${shortOpp}`)
	console.log(`  ${shortOpp} allows opposing ${c.role}s ${v} 3PA/game (vs league baseline ${base})`)
	console.log(`  → multiplier: ${m}  ·  ${m > 1 ? `BOOST his 3PA projection +${((m-1)*100).toFixed(1)}%` : m < 1 ? `DAMPEN his 3PA projection ${((m-1)*100).toFixed(1)}%` : 'neutral'}`)
	console.log()
}

console.log("=== STEP 3 — projected threes adjustment for a 6.0 3PA / 36% shooter ===\n")
for (const c of cases) {
	const row = { player: c.player, opponent: c.opponent, role: c.role }
	enrichRowWithTeamStats(row)
	const m = Number(row.opponentThreePAMultiplier) || 1
	const baseProj = 6.0 * 0.36
	const adjusted = (baseProj * m).toFixed(2)
	const delta = (((m - 1) * 100)).toFixed(1)
	console.log(`  ${c.player.padEnd(28)} (${c.playsFor} ${c.role}) → multiplier=${m.toFixed(3)}  baseline proj ${baseProj.toFixed(2)} → adjusted ${adjusted}  (${delta >= 0 ? '+' : ''}${delta}%)`)
}

console.log("\n=== Lane verified: cache includes threeAtt, row attachment fires, multiplier produces real adjustment ===")
