"use strict"

/**
 * Game 7 ladder report — produces P(stat ≥ rung) for every key Game 7 player
 * across points, rebounds, assists, threes, steals, blocks.
 *
 * Methodology (lightweight, MVP):
 *   - For each stat, pull L5 + L10 from recentFormCache (player's true recent rate)
 *   - Project a band: median = blend(L5, L10), sigma = max(0.5, median * 0.30)
 *   - Apply matchup adjustment from opponentDvPForRole when available
 *   - Compute P(stat ≥ rung) at common market rungs via logistic CDF
 *
 *   node backend/scripts/game7Ladders.js > .scratch/last.txt 2>&1
 *
 * The ladders here use SAME math as the new ladder function in
 * buildNbaDefensiveProps for blocks/steals — extended to other stats.
 */

const path = require("path")
const fs = require("fs")
const { getRecentForm } = require("../pipeline/nba/nbaRecentFormCache")

const ROSTERS = {
	"Oklahoma City Thunder": ["Shai Gilgeous-Alexander", "Chet Holmgren", "Jalen Williams", "Luguentz Dort", "Alex Caruso", "Isaiah Joe", "Aaron Wiggins", "Cason Wallace", "Isaiah Hartenstein"],
	"San Antonio Spurs":     ["Victor Wembanyama", "De'Aaron Fox", "Devin Vassell", "Stephon Castle", "Harrison Barnes", "Keldon Johnson", "Kelly Olynyk", "Jeremy Sochan", "Julian Champagnie"],
}

const DvP = (() => {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "nbaDvP.json"), "utf8"))
		return raw.teams || raw || {}
	} catch (_) { return {} }
})()

const INJURY = (() => {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "nbaInjuryReport.json"), "utf8"))
		return raw.players || {}
	} catch (_) { return {} }
})()

const RUNGS = {
	points:   [10.5, 14.5, 18.5, 22.5, 26.5, 30.5, 35.5],
	rebounds: [3.5, 5.5, 7.5, 9.5, 11.5, 13.5, 15.5],
	assists:  [1.5, 3.5, 5.5, 7.5, 9.5],
	threes:   [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
	steals:   [0.5, 1.5, 2.5, 3.5],
	blocks:   [0.5, 1.5, 2.5, 3.5, 4.5],
}

function probAtLeast(median, sigma, rung) {
	if (median == null || !Number.isFinite(rung)) return null
	const sigEff = Math.max(0.4, sigma * 0.6)
	const z = (rung - median) / sigEff
	const pOver = 1 - 1 / (1 + Math.exp(-z))
	return Math.max(0.001, Math.min(0.999, pOver))
}

function rolePosition(player) {
	// Crude — use archetype hints
	if (/wemb|holm|hart|olyn/i.test(player)) return "big"
	if (/sga|gilgeous|fox|jalen will|wallace|cason|alex caruso/i.test(player)) return "guard"
	return "wing"
}

function buildLadderForStat(player, stat, opponent) {
	const F_MAP = { ptsreb: "rebounds", ptsast: "assists", rebast: "rebounds" }
	const f = getRecentForm(player, stat)
	if (!f || (f.last5_avg == null && f.last10_avg == null)) return null
	const l5 = f.last5_avg
	const l10 = f.last10_avg
	const median = (l5 != null && l10 != null) ? 0.6 * l5 + 0.4 * l10 : (l5 ?? l10)
	let sigma = Math.max(0.5, median * 0.30)
	// Matchup adjustment via DvP
	let dvpNote = ""
	const role = rolePosition(player)
	const dvp = DvP[opponent]?.[role]
	if (dvp && dvp[stat]?.mean != null) {
		const oppAvg = dvp[stat].mean
		// Anchor 1/3 toward DvP, 2/3 toward player's own form.
		const adjusted = median * (2 / 3) + oppAvg * (1 / 3)
		dvpNote = ` (vs ${opponent} allows ${oppAvg} ${stat}/${role}, adj median ${adjusted.toFixed(1)})`
		// Use the adjusted median for the ladder.
		return { median: Number(adjusted.toFixed(1)), sigma, l5, l10, sample: f.sample_count, dvpNote }
	}
	return { median: Number(median.toFixed(1)), sigma, l5, l10, sample: f.sample_count, dvpNote: "" }
}

function renderLadder(player, opponent) {
	console.log(`\n${"=".repeat(80)}`)
	console.log(`  ${player.toUpperCase()}  vs  ${opponent}`)
	const inj = INJURY[player.toLowerCase()]
	if (inj) console.log(`  ⚠ INJURY STATUS: ${inj.status.toUpperCase()} (${inj.raw_status}) — ${inj.description || ""}`)
	console.log(`${"=".repeat(80)}`)
	for (const [stat, rungs] of Object.entries(RUNGS)) {
		const b = buildLadderForStat(player, stat, opponent)
		if (!b) {
			console.log(`  ${stat.padEnd(10)} — no L5 data`)
			continue
		}
		const cells = rungs.map((r) => {
			const p = probAtLeast(b.median, b.sigma, r)
			return `${String(r).padStart(5)}+ = ${(p * 100).toFixed(0).padStart(2)}%`
		})
		console.log(`  ${stat.padEnd(10)} [L5=${b.l5}  L10=${b.l10}  median=${b.median}]${b.dvpNote}`)
		console.log(`    ${cells.join("   ")}`)
	}
}

console.log("================================================================================")
console.log("GAME 7 LADDERS — OKLAHOMA CITY THUNDER vs SAN ANTONIO SPURS — 2026-05-30")
console.log("================================================================================")
console.log("\nMethodology: blend(0.6×L5, 0.4×L10) + matchup adjustment from DvP cache (1/3 weight).")
console.log("Each cell is P(stat ≥ rung). Use these to build engineered parlays.")
console.log("Legs at 25-50% are the sweet spot for milestone-style parlays.")

console.log("\n\n──── SAN ANTONIO SPURS ────")
for (const player of ROSTERS["San Antonio Spurs"]) {
	renderLadder(player, "Oklahoma City Thunder")
}

console.log("\n\n──── OKLAHOMA CITY THUNDER ────")
for (const player of ROSTERS["Oklahoma City Thunder"]) {
	renderLadder(player, "San Antonio Spurs")
}

console.log("\n\n================================================================================")
console.log("END LADDER REPORT")
console.log("================================================================================")
