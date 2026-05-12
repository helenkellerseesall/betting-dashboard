"use strict"

/**
 * MLB Phase 1 — Park Context Derivation
 *
 * Pure function. Reads:
 *   row.homeTeam (the park is the home team's park)
 *   parkFactorsByTeam map (from /backend/data/mlbParkFactors.json)
 *
 * Returns null when no park-factor entry is available.
 *
 * Phase 1 only models the HR factor that is currently in the JSON.
 * Doubles/triples/altitude/foul-territory are NOT fabricated — those columns
 * stay absent until a real data source is wired. Schema-stable shape:
 *
 *   hrFactor              — multiplier (e.g. 1.30 Coors, 0.85 Oracle)
 *   hrEnvironmentTag      — "HR_FRIENDLY" | "NEUTRAL" | "HR_SUPPRESSING"
 *   hrFactorShift         — bounded probability shift contribution
 *
 * Park lookup is case-insensitive and tries a few common shapes
 * (full name lowercased; trimmed). If the key doesn't resolve, returns null.
 */

const HR_FRIENDLY_THRESHOLD = 1.07
const HR_SUPPRESS_THRESHOLD = 0.93

function classifyHrEnvironment(hrFactor) {
	if (!Number.isFinite(hrFactor)) return "UNKNOWN"
	if (hrFactor >= HR_FRIENDLY_THRESHOLD) return "HR_FRIENDLY"
	if (hrFactor <= HR_SUPPRESS_THRESHOLD) return "HR_SUPPRESSING"
	return "NEUTRAL"
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v))
}

function lookupParkEntry(parkFactorsByTeam, homeTeamRaw) {
	if (!parkFactorsByTeam || typeof parkFactorsByTeam !== "object") return null
	const raw = String(homeTeamRaw || "").trim().toLowerCase()
	if (!raw) return null
	if (parkFactorsByTeam[raw]) return parkFactorsByTeam[raw]
	// Tolerate variants: "ny yankees" / "yankees" / "new york yankees"
	const collapsed = raw.replace(/\s+/g, " ")
	if (parkFactorsByTeam[collapsed]) return parkFactorsByTeam[collapsed]
	for (const key of Object.keys(parkFactorsByTeam)) {
		if (key === raw || key === collapsed) return parkFactorsByTeam[key]
		if (raw.includes(key) || key.includes(raw)) return parkFactorsByTeam[key]
	}
	return null
}

function deriveMlbParkContext(row, { parkFactorsByTeam } = {}) {
	if (!row) return null
	const homeTeam = row?.homeTeam || row?.home_team || null
	if (!homeTeam) return null
	const entry = lookupParkEntry(parkFactorsByTeam, homeTeam)
	if (!entry || typeof entry !== "object") return null

	const hrFactor = Number(entry.hrFactor)
	if (!Number.isFinite(hrFactor)) return null

	const hrEnvironmentTag = classifyHrEnvironment(hrFactor)
	const hrFactorShift = clamp((hrFactor - 1.0) * 0.20, -0.06, 0.06)

	return {
		homeTeam: String(homeTeam),
		hrFactor: Number(hrFactor.toFixed(3)),
		hrEnvironmentTag,
		hrFactorShift: Number(hrFactorShift.toFixed(4)),
		// Future fields kept null intentionally — never fabricate.
		doublesFactor: null,
		triplesFactor: null,
		foulTerritoryFactor: null,
		altitudeFt: null,
		source: "mlbParkFactors.json",
	}
}

module.exports = { deriveMlbParkContext, classifyHrEnvironment }
