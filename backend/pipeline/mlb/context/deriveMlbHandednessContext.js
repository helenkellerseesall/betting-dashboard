"use strict"

/**
 * MLB Phase 1 — Handedness / Platoon Context Derivation
 *
 * Pure function. Reads:
 *   row.batterHand   — "L" | "R" | "S" (switch) | "B" (both) | null
 *   row.pitcherHand  — "L" | "R" | null   (pitcher throws)
 *
 * Both fields are already populated upstream by enrichMlbRowsWithExternalContext
 * (see backend/pipeline/mlb/enrichment/mergeMlbExternalContext.js — fields
 *  batterHand and pitcherHand). We never fabricate.
 *
 * Returns null when EITHER side is missing — handedness reasoning requires both.
 *
 * Output shape:
 *   batterHand            — normalized "L" | "R" | "S"
 *   pitcherHand           — normalized "L" | "R"
 *   platoonRelation       — "opp"  (platoon advantage for batter)
 *                          "same" (platoon disadvantage for batter)
 *   platoonTag            — human-readable: e.g. "L_vs_R", "R_vs_R", "S_vs_L"
 *   batterPlatoonShift    — small probability shift (+ favors batter overs,
 *                           - favors batter unders / pitcher overs)
 *
 * Switch hitters (S/B) always get "opp" — they choose the favorable side.
 *
 * Magnitudes are intentionally small (±0.025). Phase 1 is observational.
 * Real platoon split magnitudes vary by player/sample; we do NOT fake those —
 * future phases will replace this with per-player splits when wired.
 */

function normalizeBatterHand(h) {
	const s = String(h || "").trim().toUpperCase()
	if (s === "L" || s === "LEFT" || s === "LH" || s === "LHB") return "L"
	if (s === "R" || s === "RIGHT" || s === "RH" || s === "RHB") return "R"
	if (s === "S" || s === "B" || s === "SWITCH") return "S"
	return null
}

function normalizePitcherHand(h) {
	const s = String(h || "").trim().toUpperCase()
	if (s === "L" || s === "LEFT" || s === "LHP") return "L"
	if (s === "R" || s === "RIGHT" || s === "RHP") return "R"
	return null
}

function deriveMlbHandednessContext(row) {
	if (!row) return null
	const batterHand = normalizeBatterHand(row?.batterHand)
	const pitcherHand = normalizePitcherHand(row?.pitcherHand)
	if (!batterHand || !pitcherHand) return null

	let platoonRelation
	if (batterHand === "S") platoonRelation = "opp"
	else if (batterHand === pitcherHand) platoonRelation = "same"
	else platoonRelation = "opp"

	const platoonTag = `${batterHand}_vs_${pitcherHand}`

	// Bounded ±0.025 — small, observational. Switch hitters get a softer edge
	// because their advantage is structural rather than per-AB.
	let batterPlatoonShift = 0
	if (platoonRelation === "opp") batterPlatoonShift = batterHand === "S" ? 0.012 : 0.022
	else if (platoonRelation === "same") batterPlatoonShift = -0.020

	return {
		batterHand,
		pitcherHand,
		platoonRelation,
		platoonTag,
		batterPlatoonShift: Number(batterPlatoonShift.toFixed(4)),
		source: "row.batterHand + row.pitcherHand",
	}
}

module.exports = { deriveMlbHandednessContext, normalizeBatterHand, normalizePitcherHand }
