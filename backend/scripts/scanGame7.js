"use strict"

/**
 * Pre-game tactical scan for tonight's NBA Game 7 picks.
 * Reads tracked_bets, joins with recentFormCache L5 truth, and surfaces:
 *   1. ELITE picks with L5 reasoning
 *   2. STRONG picks grouped by player
 *   3. Consensus calls (multiple high-tier picks aligning on same player + direction)
 *   4. Conflicts where L5 truth disagrees with model output (flag for fade vs follow)
 *
 *   node backend/scripts/scanGame7.js > .scratch/last.txt 2>&1
 */

const fs = require("fs")
const path = require("path")
const { getRecentForm } = require("../pipeline/nba/nbaRecentFormCache")

const FILE = path.join(__dirname, "..", "runtime", "tracking", "nba_tracked_bets_2026-05-30.json")
const picks = JSON.parse(fs.readFileSync(FILE, "utf8"))

const dedup = new Map()
for (const p of picks) {
	const key = `${p.player}|${p.statFamily}|${p.line}|${p.side}`
	const existing = dedup.get(key)
	if (!existing || (p.edge ?? 0) > (existing.edge ?? 0)) dedup.set(key, p)
}
const unique = Array.from(dedup.values())
console.log(`Total picks: ${picks.length}, unique (player×stat×line×side): ${unique.length}`)
console.log("")

function formatPick(p) {
	const mp = (p.modelProb ?? 0).toFixed(3)
	const ed = (p.edge ?? 0).toFixed(3)
	const book = (p.sportsbook || "?").padEnd(10)
	return `${p.player.padEnd(28)} ${p.statFamily.padEnd(28)} ${String(p.line).padStart(5)} ${p.side.padEnd(5)} ${book} mp=${mp} edge=${ed}`
}

function l5Truth(player, family) {
	const F_MAP = {
		points_rebounds_assists: "pra",
		points_rebounds: "ptsreb",
		points_assists: "ptsast",
		rebounds_assists: "rebast",
	}
	const key = F_MAP[family] || family
	const f = getRecentForm(player, key)
	return f ? { l5: f.last5_avg, l10: f.last10_avg, sample: f.sample_count } : null
}

function probUnder(line, l5) {
	if (l5 == null) return null
	const gap = line - l5
	const sigma = Math.max(0.5, l5 * 0.25)
	const z = gap / sigma
	const pUnder = 1 / (1 + Math.exp(-z))
	return pUnder
}

console.log("================================================================================")
console.log("ELITE PICKS — 18 picks, all UNDER")
console.log("================================================================================")
const elites = unique.filter(p => p.tier === "ELITE")
elites.sort((a, b) => b.edge - a.edge)
for (const p of elites) {
	const truth = l5Truth(p.player, p.statFamily)
	const realUnder = truth ? probUnder(p.line, truth.l5) : null
	const mp = p.modelProb
	const flag = (realUnder != null && Math.abs(realUnder - mp) > 0.12) ? " ⚠ DISAGREE" : ""
	console.log("")
	console.log(`  ${p.player} ${p.statFamily.toUpperCase()} ${p.side.toUpperCase()} ${p.line}  @ ${p.sportsbook || "?"}  (odds ${p.oddsAmerican > 0 ? "+" : ""}${p.oddsAmerican})`)
	console.log(`    model: ${(mp * 100).toFixed(1)}% confidence  edge: ${(p.edge * 100).toFixed(1)}%`)
	if (truth) {
		const realPct = realUnder != null ? `${(realUnder * 100).toFixed(0)}%` : "n/a"
		console.log(`    L5 truth: avg ${truth.l5} (${truth.sample} games)  →  estimated ${p.side.toUpperCase()} probability ${realPct}${flag}`)
	} else {
		console.log(`    L5 truth: NOT IN CACHE`)
	}
}

console.log("\n")
console.log("================================================================================")
console.log("STRONG PICKS — 32 picks, grouped by player")
console.log("================================================================================")
const strongs = unique.filter(p => p.tier === "STRONG")
const byPlayer = {}
for (const p of strongs) {
	if (!byPlayer[p.player]) byPlayer[p.player] = []
	byPlayer[p.player].push(p)
}
for (const [player, ps] of Object.entries(byPlayer).sort((a, b) => b[1].length - a[1].length)) {
	console.log(`\n  ${player} (${ps.length}):`)
	ps.sort((a, b) => b.edge - a.edge)
	for (const p of ps) {
		const truth = l5Truth(p.player, p.statFamily)
		const realUnder = truth ? probUnder(p.line, truth.l5) : null
		const mp = p.modelProb
		const flag = (realUnder != null && Math.abs(realUnder - mp) > 0.12) ? " ⚠" : ""
		const realPct = realUnder != null ? `~${(realUnder * 100).toFixed(0)}%${p.side === "under" ? "" : " UNDER"}` : "n/a"
		console.log(`    ${p.statFamily.padEnd(28)} ${p.side.toUpperCase().padEnd(5)} ${String(p.line).padStart(5)}  ${(p.sportsbook || "?").padEnd(10)} model ${(mp * 100).toFixed(0)}%  L5=${truth ? truth.l5 : "?"}  est ${realPct}${flag}`)
	}
}

console.log("\n")
console.log("================================================================================")
console.log("CONSENSUS CALLS — players with ≥3 ELITE+STRONG picks aligning on same direction")
console.log("================================================================================")
const highTier = unique.filter(p => p.tier === "ELITE" || p.tier === "STRONG")
const byPlayerHigh = {}
for (const p of highTier) {
	if (!byPlayerHigh[p.player]) byPlayerHigh[p.player] = []
	byPlayerHigh[p.player].push(p)
}
for (const [player, ps] of Object.entries(byPlayerHigh)) {
	if (ps.length < 3) continue
	const sides = ps.reduce((acc, p) => { acc[p.side] = (acc[p.side] || 0) + 1; return acc }, {})
	const dominant = Object.entries(sides).sort((a, b) => b[1] - a[1])[0]
	if (dominant[1] / ps.length < 0.7) continue
	console.log(`\n  ${player}: ${dominant[1]}/${ps.length} high-tier picks ${dominant[0].toUpperCase()}`)
	const families = new Set()
	for (const p of ps) families.add(p.statFamily)
	console.log(`    Families touched: ${[...families].join(", ")}`)
	console.log(`    Avg modelProb: ${(ps.reduce((s, p) => s + p.modelProb, 0) / ps.length).toFixed(3)}`)
	console.log(`    Avg edge:      ${(ps.reduce((s, p) => s + p.edge, 0) / ps.length * 100).toFixed(1)}%`)
}

console.log("\n")
console.log("================================================================================")
console.log("L5-vs-MODEL CONFLICTS — ELITE/STRONG picks where L5 truth disagrees with model")
console.log("================================================================================")
let foundConflicts = 0
for (const p of highTier) {
	const truth = l5Truth(p.player, p.statFamily)
	if (!truth) continue
	const realUnder = probUnder(p.line, truth.l5)
	if (realUnder == null) continue
	const sideProb = p.side === "under" ? realUnder : (1 - realUnder)
	const gap = sideProb - p.modelProb
	if (Math.abs(gap) >= 0.15) {
		foundConflicts += 1
		const direction = gap > 0 ? "L5 says MORE likely than model (FOLLOW with confidence)" : "L5 says LESS likely than model (consider FADE)"
		console.log(`\n  ${p.player} ${p.statFamily} ${p.side.toUpperCase()} ${p.line}`)
		console.log(`    Model says: ${(p.modelProb * 100).toFixed(0)}%`)
		console.log(`    L5 implies: ${(sideProb * 100).toFixed(0)}%`)
		console.log(`    → ${direction}`)
	}
}
if (!foundConflicts) console.log("\n  (no significant disagreements)")

console.log("\n================================================================================")
console.log("DONE")
console.log("================================================================================")
