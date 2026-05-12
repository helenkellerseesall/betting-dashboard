"use strict"

/**
 * MLB Phase 1 — Bullpen Fatigue Context Derivation
 *
 * Pure function. Reads:
 *   row.opponentTeam      — team whose bullpen will be facing this batter
 *                           (for pitcher props row.team is used — own bullpen
 *                            doesn't matter to a starter's K count, so this
 *                            module returns dataAvailable:false for those)
 *   bullpenByTeam         — OPTIONAL lookup map (team -> bullpen stats)
 *                           Currently absent in repo; shape stub only.
 *
 * Why a stub: the project explicitly forbids fabricating data. Bullpen
 * workload requires a real feed (gamelog ingestion) that does not yet exist.
 * This module reserves the schema column so:
 *   1. frozen_contextual_states.raw_context_json has a stable shape
 *   2. composeMlbContextualSignal can wire in the shift the day data lands
 *   3. diagnostics can report bullpenCoverage = 0 honestly until then
 *
 * Output (shape-stable):
 *   opponentTeam              — string or null
 *   recentInningsLast3Days    — null until wired
 *   highLeverageUsesLast3Days — null until wired
 *   reliefFatigueScore        — 0..1 or null
 *   openerOrFollowerFlag      — null
 *   dataAvailable             — boolean
 *   bullpenShift              — 0 until data wired
 */

const { isPitcherPropFamily } = require("./deriveMlbPitcherEnvironmentContext")

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v))
}

function lookupBullpen(bullpenByTeam, teamRaw) {
	if (!bullpenByTeam || typeof bullpenByTeam !== "object") return null
	const t = String(teamRaw || "").trim().toLowerCase()
	if (!t) return null
	if (bullpenByTeam[t]) return bullpenByTeam[t]
	for (const k of Object.keys(bullpenByTeam)) {
		const lk = String(k).toLowerCase()
		if (lk === t || lk.includes(t) || t.includes(lk)) return bullpenByTeam[k]
	}
	return null
}

function deriveMlbBullpenContext(row, { bullpenByTeam } = {}) {
	if (!row) return null
	// For pitcher props, the opposing bullpen is not directly material to
	// the pitcher's own K count; skip with null.
	if (isPitcherPropFamily(row)) {
		return {
			opponentTeam: null,
			recentInningsLast3Days: null,
			highLeverageUsesLast3Days: null,
			reliefFatigueScore: null,
			openerOrFollowerFlag: null,
			dataAvailable: false,
			bullpenShift: 0,
			source: "skipped_pitcher_prop",
		}
	}

	const opponentTeam = row?.opponentTeam || null
	const entry = lookupBullpen(bullpenByTeam, opponentTeam)

	if (!entry) {
		return {
			opponentTeam: opponentTeam || null,
			recentInningsLast3Days: null,
			highLeverageUsesLast3Days: null,
			reliefFatigueScore: null,
			openerOrFollowerFlag: null,
			dataAvailable: false,
			bullpenShift: 0,
			source: "shape_only_no_data",
		}
	}

	const recentInnings = toNum(entry.recentInnings ?? entry.recent_innings)
	const highLeverage = toNum(entry.highLeverageUses ?? entry.high_leverage_uses)
	let reliefFatigueScore = toNum(entry.fatigueScore)
	if (reliefFatigueScore == null && recentInnings != null) {
		reliefFatigueScore = clamp((recentInnings - 8) / 12, 0, 1)
	}

	// Tired bullpen → small + shift for batter overs (more contact, weaker arms).
	let bullpenShift = 0
	if (reliefFatigueScore != null) {
		const side = String(row?.side || "").toLowerCase()
		const mag = clamp(reliefFatigueScore * 0.03, 0, 0.03)
		bullpenShift = side === "under" ? -mag : mag
	}

	return {
		opponentTeam: String(opponentTeam),
		recentInningsLast3Days: recentInnings,
		highLeverageUsesLast3Days: highLeverage,
		reliefFatigueScore: reliefFatigueScore != null ? Number(reliefFatigueScore.toFixed(3)) : null,
		openerOrFollowerFlag: entry.openerOrFollower != null ? Boolean(entry.openerOrFollower) : null,
		dataAvailable: true,
		bullpenShift: Number(bullpenShift.toFixed(4)),
		source: "bullpenByTeam",
	}
}

module.exports = { deriveMlbBullpenContext }
