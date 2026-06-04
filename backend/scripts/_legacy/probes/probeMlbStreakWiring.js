"use strict"

/**
 * Probe: confirms L5/L15 streak signal fires across HR/Hits/RBI/InspectionBoard.
 * Uses hot (Schwarber), cold (relative to L15), and neutral cases.
 */

const { streakMomentumMultiplier, streakLabel, getBatterForm, enrichRowWithBatterForm } = require("../pipeline/mlb/mlbBatterFormCache")

const cases = ["Kyle Schwarber", "Shohei Ohtani", "Aaron Judge", "Mike Trout"]

console.log("=== STREAK MOMENTUM PROBE ===\n")
for (const player of cases) {
	const l5 = getBatterForm(player, 5)
	const l15 = getBatterForm(player, 15)
	if (!l5 || !l15) { console.log(`${player}: no cache`); continue }
	const row = { player, batterL5: l5, batterL15: l15 }
	console.log(`${player}`)
	for (const metric of ["hitsPerGame", "hrPerGame", "slg", "rbiPerGame", "totalBasesPerGame"]) {
		const m = streakMomentumMultiplier(row, metric)
		const lbl = streakLabel(row, metric)
		const l5v = l5[metric] ?? "?"
		const l15v = l15[metric] ?? "?"
		console.log(`  ${metric.padEnd(20)} L5=${String(l5v).padEnd(6)} L15=${String(l15v).padEnd(6)} → mult=${m.toFixed(3)}  [${lbl}]`)
	}
	console.log()
}

// End-to-end test: synth a Hits engine row and verify expectedHitsRaw shifts.
console.log("=== HITS ENGINE END-TO-END ===\n")
const { buildMlbHitsToday } = require("../pipeline/mlb/buildMlbHitsProbabilityEngine")
for (const player of cases) {
	const l5 = getBatterForm(player, 5)
	const l15 = getBatterForm(player, 15)
	if (!l5) continue
	const synth = {
		player,
		batterL5: l5,
		batterL15: l15,
		propType: "Hits",
		marketKey: "batter_hits",
		line: 0.5,
		side: "over",
		odds: -150,
		predictedProbability: 0.65,
		impliedProbability: 0.60,
		impliedTeamTotal: 5,
		battingOrderIndex: 3,
		gameTotal: 9,
		opposingPitcherWhip: 1.30,
		batterStats: { avg: 0.265 },
		eventId: `evt_${player.replace(/\s+/g,'_')}`,
		teamResolved: "Test Team",
		opponentTeam: "Other Team",
	}
	const result = buildMlbHitsToday({ rows: [synth] })
	const top = (result?.topPlayers || []).find((p) => p.player === player) || (result?.players || [])[0]
	if (!top) { console.log(`${player}: no engine output`); continue }
	console.log(`${player.padEnd(28)} expectedHits=${top.expectedHits} modelProb=${(top.modelProbability * 100).toFixed(1)}%`)
}
