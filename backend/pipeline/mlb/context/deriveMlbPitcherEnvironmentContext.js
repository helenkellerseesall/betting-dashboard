"use strict"

/**
 * MLB Phase 1 — Pitcher Environment Context Derivation
 *
 * Pure function. Reads:
 *   row.opposingPitcher  — full name of opposing pitcher (when row is batter prop)
 *                          OR row.player (when row is a pitcher prop itself)
 *   pitcherStatsByName   — OPTIONAL lookup map keyed by normalized full name
 *                          (currently absent in repo; fields stay null until wired)
 *
 * Returns a SHAPE-STABLE object so frozen state can rely on consistent columns
 * even when no upstream pitcher-stat source is wired yet. Fields that lack
 * data are null — never invented.
 *
 *   pitcherName        — string or null
 *   isPitcherProp      — true when the row is a pitcher prop (K, outs, ER, etc.)
 *   kRate              — strikeout rate per batter faced, 0..1, or null
 *   gbRate             — ground-ball rate, 0..1, or null
 *   fbRate             — fly-ball rate, 0..1, or null
 *   velocityMph        — avg fastball velocity, or null
 *   recentWorkloadPitches — last-7-days pitch count, or null
 *   restDays           — days since last appearance, or null
 *   fatigueFlag        — true when recent workload high AND short rest, else null
 *   dataAvailable      — true when ANY non-null pitcher stat resolved
 *
 * Shifts (Phase 1 observational, bounded ±0.04):
 *   kEnvironmentShift  — small + when pitcher has high kRate AND prop relates
 *                        to strikeout-side outcomes (only set when relevant
 *                        to the prop family); else 0
 */

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v))
}

function isPitcherPropFamily(row) {
	const fam = String(row?.marketFamily || "").toLowerCase()
	const pt = String(row?.propType || "").toLowerCase()
	const mk = String(row?.marketKey || "").toLowerCase()
	// Explicit family wins.
	if (fam === "pitcher" || fam === "pitching") return true
	// marketKey is the canonical signal: pitcher props start with "pitcher_".
	// We deliberately do NOT match a bare "strikeout" substring because
	// "batter_strikeouts" also contains it and is NOT a pitcher prop.
	if (mk.startsWith("pitcher_")) return true
	if (mk.includes("pitcher")) return true
	// propType text — only when "pitcher" appears explicitly. "outs"/"strikeout"
	// alone are ambiguous (batter strikeouts is a thing).
	if (pt.includes("pitcher")) return true
	return false
}

function isBatterStrikeoutProp(row) {
	const pt = String(row?.propType || "").toLowerCase()
	const mk = String(row?.marketKey || "").toLowerCase()
	return pt.includes("batter_strikeouts") || mk.includes("batter_strikeouts")
}

function normalizePitcherKey(name) {
	if (!name) return null
	return String(name)
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z\s'-]/g, "")
		.replace(/\s+/g, " ")
		.trim()
}

function lookupPitcherStats(pitcherStatsByName, fullName) {
	if (!pitcherStatsByName || typeof pitcherStatsByName !== "object") return null
	const key = normalizePitcherKey(fullName)
	if (!key) return null
	if (pitcherStatsByName[key]) return pitcherStatsByName[key]
	// permissive lookup: try first+last surname variants
	for (const k of Object.keys(pitcherStatsByName)) {
		if (normalizePitcherKey(k) === key) return pitcherStatsByName[k]
	}
	return null
}

function deriveMlbPitcherEnvironmentContext(row, { pitcherStatsByName } = {}) {
	if (!row) {
		return null
	}
	const pitcherProp = isPitcherPropFamily(row)
	const pitcherName = pitcherProp
		? (row?.player || null)
		: (row?.opposingPitcher || null)

	const stats = lookupPitcherStats(pitcherStatsByName, pitcherName)

	const kRate     = stats ? toNum(stats.kRate ?? stats.k_rate) : null
	const gbRate    = stats ? toNum(stats.gbRate ?? stats.gb_rate) : null
	const fbRate    = stats ? toNum(stats.fbRate ?? stats.fb_rate) : null
	const velocityMph = stats ? toNum(stats.velocityMph ?? stats.velocity_mph) : null
	const recentWorkloadPitches = stats ? toNum(stats.recentPitches ?? stats.recent_pitches) : null
	const restDays  = stats ? toNum(stats.restDays ?? stats.rest_days) : null

	let fatigueFlag = null
	if (recentWorkloadPitches != null && restDays != null) {
		fatigueFlag = (recentWorkloadPitches > 220 && restDays < 5) ? true : false
	}

	const dataAvailable = stats != null && (
		kRate != null || gbRate != null || fbRate != null ||
		velocityMph != null || recentWorkloadPitches != null
	)

	// kEnvironmentShift only fires when:
	//   - we actually have kRate
	//   - the prop is strikeout-relevant (pitcher K prop OR batter strikeout prop)
	// We do NOT fabricate a baseline league k%; we anchor to a typical 0.22.
	let kEnvironmentShift = 0
	if (kRate != null && (pitcherProp || isBatterStrikeoutProp(row))) {
		const delta = clamp((kRate - 0.22) * 0.20, -0.04, 0.04)
		// For a batter strikeout prop, high pitcher kRate favors the OVER (more Ks).
		// For a pitcher K prop, high kRate favors the OVER as well.
		// For a pitcher props "over X outs" — same direction. side=under inverts.
		const side = String(row?.side || "").toLowerCase()
		kEnvironmentShift = side === "under" ? -delta : delta
	}

	return {
		pitcherName: pitcherName || null,
		isPitcherProp: pitcherProp,
		kRate,
		gbRate,
		fbRate,
		velocityMph,
		recentWorkloadPitches,
		restDays,
		fatigueFlag,
		dataAvailable: Boolean(dataAvailable),
		kEnvironmentShift: Number(kEnvironmentShift.toFixed(4)),
		source: dataAvailable ? "pitcherStatsByName" : "shape_only_no_data",
	}
}

module.exports = {
	deriveMlbPitcherEnvironmentContext,
	isPitcherPropFamily,
	isBatterStrikeoutProp,
	normalizePitcherKey,
}
