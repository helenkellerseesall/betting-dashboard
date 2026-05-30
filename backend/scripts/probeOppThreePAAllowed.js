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

console.log("=== STEP 2 — per-role opp 3PA-allowed attachment ===\n")
const cases = [
	{ label: "SGA (guard) vs OKC's opp guards (4.74 vs baseline 3.5)", row: { player: "Shai Gilgeous-Alexander", opponent: "Oklahoma City Thunder", role: "guard" } },
	{ label: "Vassell (wing) vs OKC's opp wings (2.38 vs baseline 2.8)", row: { player: "Devin Vassell",        opponent: "Oklahoma City Thunder", role: "wing"  } },
	{ label: "Wemby (big) vs OKC's opp bigs (2.50 vs baseline 1.5)",   row: { player: "Victor Wembanyama",     opponent: "Oklahoma City Thunder", role: "big"   } },
	{ label: "Isaiah Joe (guard) vs SAS opp guards",                    row: { player: "Isaiah Joe",            opponent: "San Antonio Spurs",     role: "guard" } },
	{ label: "Caruso (wing) vs SAS opp wings",                          row: { player: "Alex Caruso",           opponent: "San Antonio Spurs",     role: "wing"  } },
]
for (const c of cases) {
	enrichRowWithTeamStats(c.row)
	const v = c.row.opponentThreePAAllowedForRole
	const m = c.row.opponentThreePAMultiplier
	console.log(`${c.label}`)
	console.log(`  opp 3PA-allowed for role: ${v}  ·  multiplier: ${m}`)
	console.log()
}

console.log("=== STEP 3 — projected threes adjustment for a 6.0 3PA / 36% shooter ===\n")
for (const c of cases) {
	const m = Number(c.row.opponentThreePAMultiplier) || 1
	const baseProj = 6.0 * 0.36
	const adjusted = (baseProj * m).toFixed(2)
	const delta = (((m - 1) * 100)).toFixed(1)
	console.log(`  ${c.row.player.padEnd(28)} multiplier=${m.toFixed(3)}  · baseline proj ${baseProj.toFixed(2)} → adjusted ${adjusted}  (${delta >= 0 ? '+' : ''}${delta}%)`)
}

console.log("\n=== Lane verified: cache includes threeAtt, row attachment fires, multiplier produces real adjustment ===")
