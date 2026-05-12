"use strict"

/**
 * MLB Phase 1 — Lineup / Batting Order Context Derivation
 *
 * Pure function. Reads:
 *   row.lineupPosition (1..9) or row.battingOrderIndex (1..9)
 *
 * These fields are populated upstream by enrichMlbRowsWithExternalContext
 * (see backend/pipeline/mlb/enrichment/mergeMlbExternalContext.js).
 *
 * Returns null when no lineup data is available.
 *
 * Output shape:
 *   lineupSpot          — 1..9
 *   depth               — "top" | "middle" | "back"
 *   plateAppearancesProxy — expected PAs (4.6 for spot 1 → 3.7 for spot 9)
 *   runEnvironment      — 0..1 (top of order scores higher; runs/SB props)
 *   rbiEnvironment      — 0..1 (3-5 spots score higher; RBI/total bases)
 *   opportunityShift    — bounded ± shift relative to prop family
 *
 * Pure derivation from spot position. We never invent who hits behind whom
 * in Phase 1 (would require live lineup card with sequence); that is a
 * deferred enrichment for a later phase. The current implementation is
 * intentionally conservative.
 */

function toInt(v) {
	const n = Number(v)
	return Number.isFinite(n) ? Math.trunc(n) : null
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v))
}

// Roughly average MLB PA-per-spot over a 9-inning game (sabermetric folklore).
const PA_BY_SPOT = {
	1: 4.61, 2: 4.51, 3: 4.41, 4: 4.31, 5: 4.21,
	6: 4.11, 7: 4.01, 8: 3.91, 9: 3.81,
}

function depthOf(spot) {
	if (spot >= 1 && spot <= 2) return "top"
	if (spot >= 3 && spot <= 5) return "middle"
	if (spot >= 6 && spot <= 9) return "back"
	return "unknown"
}

function runEnvOf(spot) {
	// top of order has more chances to score (gets on, gets driven in)
	const table = { 1: 0.85, 2: 0.80, 3: 0.65, 4: 0.55, 5: 0.50, 6: 0.45, 7: 0.40, 8: 0.35, 9: 0.30 }
	return table[spot] ?? null
}

function rbiEnvOf(spot) {
	// heart of order has best RBI environment
	const table = { 1: 0.30, 2: 0.45, 3: 0.80, 4: 0.90, 5: 0.85, 6: 0.65, 7: 0.50, 8: 0.40, 9: 0.30 }
	return table[spot] ?? null
}

function propFamilyTag(row) {
	const pt = String(row?.propType || "").toLowerCase()
	const mk = String(row?.marketKey || "").toLowerCase()
	if (pt.includes("rbi") || mk.includes("rbi")) return "rbi"
	if (pt.includes("runs scored") || mk.includes("runs_scored") || pt === "runs") return "runs"
	if (pt.includes("stolen") || mk.includes("stolen")) return "sb"
	if (pt.includes("home run") || mk.includes("home_run")) return "hr"
	if (pt.includes("total bases") || mk.includes("total_bases")) return "tb"
	if (pt.includes("hits") || mk.includes("hits")) return "hits"
	if (pt.includes("strikeout") && !mk.includes("pitcher")) return "batter_k"
	return "other"
}

function deriveMlbLineupContext(row) {
	if (!row) return null
	const spot = toInt(row?.lineupPosition ?? row?.battingOrderIndex)
	if (spot == null || spot < 1 || spot > 9) return null

	const depth = depthOf(spot)
	const plateAppearancesProxy = PA_BY_SPOT[spot] ?? null
	const runEnvironment = runEnvOf(spot)
	const rbiEnvironment = rbiEnvOf(spot)
	const family = propFamilyTag(row)

	// opportunityShift wires lineup spot to family relevance, bounded ±0.04.
	let opportunityShift = 0
	const side = String(row?.side || "").toLowerCase()
	const signFromSide = side === "under" ? -1 : 1

	if (family === "rbi" && rbiEnvironment != null) {
		opportunityShift = (rbiEnvironment - 0.55) * 0.08
	} else if (family === "runs" && runEnvironment != null) {
		opportunityShift = (runEnvironment - 0.55) * 0.08
	} else if (family === "hits" || family === "tb") {
		// More PAs = more chances → slight shift on PA proxy.
		if (plateAppearancesProxy != null) {
			opportunityShift = (plateAppearancesProxy - 4.2) * 0.020
		}
	} else if (family === "sb" && runEnvironment != null) {
		opportunityShift = (runEnvironment - 0.55) * 0.06
	}

	opportunityShift = signFromSide * clamp(opportunityShift, -0.04, 0.04)

	return {
		lineupSpot: spot,
		depth,
		plateAppearancesProxy,
		runEnvironment,
		rbiEnvironment,
		propFamilyTag: family,
		opportunityShift: Number(opportunityShift.toFixed(4)),
		source: "row.lineupPosition",
	}
}

module.exports = { deriveMlbLineupContext, depthOf, propFamilyTag }
