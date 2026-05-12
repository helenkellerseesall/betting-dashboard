"use strict"

/**
 * MLB Phase 1 + 1B — Weather Context Derivation
 *
 * Pure function. Reads:
 *   row.eventId
 *   row.homeTeam (used to consult parkMeta for dome status)
 *   weatherByEventId map (built live by refreshMlbWeatherForSlate.js OR
 *                         loaded from /backend/data/mlbGameWeather.json)
 *   parkMetaByTeam map   (from /backend/data/mlbParkMeta.json) — Phase 1B
 *
 * Returns null when no weather data is available for the row's eventId.
 * Returns a structured contextual object otherwise. Fields:
 *
 *   temperatureF           — Fahrenheit (converted from C if necessary)
 *   windSpeedMph
 *   windDirectionDeg       — meteorological convention (FROM which dir)
 *   windDirectionTag       — "out_to_cf" | "in_from_cf" | "cross" | "calm" | "unknown" | "indoor"
 *   humidityPct            — 0..100 or null (Phase 1B)
 *   precipitationMm        — mm or null (Phase 1B)
 *   isIndoor               — true when isDome OR (isRetractable AND roofUsuallyClosed)
 *   parkName               — string or null
 *   tempCarryShift         — bounded [-0.04, +0.04] HR-carry contribution from temp
 *   windCarryShift         — bounded [-0.04, +0.04] HR-carry contribution from wind
 *   precipShift            — bounded [-0.03, 0] when precipitation present (offense damp)
 *   carryShift             — sum of the above, clamped [-0.05, 0.05]
 *
 * Phase 1B rules:
 *   - When isIndoor=true: windCarryShift=0, precipShift=0, tempCarryShift uses
 *     a controlled-environment baseline (72F) so it stays near zero. Wind tag
 *     becomes "indoor".
 *   - Heavy precip (≥ 1.0 mm) → small negative offensive shift, tag "PRECIP".
 *   - Humidity is informational only in Phase 1B (no shift) — physics is small
 *     and direction depends on context (humid air is less dense, but ball is
 *     slightly heavier; net effect tiny). We expose the value for grading.
 *
 * Phase 1 properties preserved:
 *   - Observational only: nothing here mutates predictedProbability.
 *   - Bounded magnitudes ensure no single layer dominates.
 *   - Truthful nulls: when a source field is null, derived shifts default to 0.
 */

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function celsiusLikely(v) {
	// MLB game-time temps in F are typically 30..115. Open-Meteo default is C.
	// Treat values below 50 (or negative) as Celsius and convert.
	return Number.isFinite(v) && v < 50
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v))
}

/**
 * Classify wind direction (meteorological FROM) into one of:
 *   "calm"        — windSpeed < 4 mph
 *   "out_to_cf"   — wind FROM 180..270 (SW), blows toward NE (CF in most parks)
 *   "in_from_cf"  — wind FROM 0..90    (NE), blows toward SW (in from CF)
 *   "cross"       — anything else
 *   "unknown"     — missing direction
 *
 * This is a conservative band classifier — true HR carry depends on park
 * orientation, which is not modelled in Phase 1.
 */
function classifyWindDirection(windSpeedMph, windDirectionDeg) {
	if (windSpeedMph == null || windSpeedMph < 4) return "calm"
	if (windDirectionDeg == null) return "unknown"
	const d = ((Number(windDirectionDeg) % 360) + 360) % 360
	if (d >= 180 && d <= 270) return "out_to_cf"
	if (d <= 90 || d >= 330) return "in_from_cf"
	return "cross"
}

function lookupParkMeta(parkMetaByTeam, homeTeamRaw) {
	if (!parkMetaByTeam || typeof parkMetaByTeam !== "object") return null
	const raw = String(homeTeamRaw || "").trim().toLowerCase()
	if (!raw) return null
	if (parkMetaByTeam[raw]) return parkMetaByTeam[raw]
	for (const k of Object.keys(parkMetaByTeam)) {
		if (k.startsWith("_")) continue
		if (k === raw || raw.includes(k) || k.includes(raw)) return parkMetaByTeam[k]
	}
	return null
}

function deriveMlbWeatherContext(row, { weatherByEventId, parkMetaByTeam } = {}) {
	if (!row) return null
	const eventKey = String(row?.eventId || "")
	if (!eventKey) return null
	const entry = (weatherByEventId && weatherByEventId[eventKey]) || null

	const meta = lookupParkMeta(parkMetaByTeam, row?.homeTeam)
	const isIndoor = Boolean(
		(meta && meta.isDome === true) ||
		(meta && meta.isRetractable === true && meta.roofUsuallyClosed === true)
	)

	// Indoor venues: even when no live weather entry is present we can still
	// emit a controlled-environment context so downstream consumers know the
	// weather layer is structurally null-for-good-reason rather than missing.
	if (!entry || typeof entry !== "object") {
		if (isIndoor) {
			return {
				temperatureF: 72,
				windSpeedMph: 0,
				windDirectionDeg: null,
				windDirectionTag: "indoor",
				humidityPct: null,
				precipitationMm: null,
				isIndoor: true,
				parkName: meta?.parkName || null,
				tempCarryShift: 0,
				windCarryShift: 0,
				precipShift: 0,
				carryShift: 0,
				source: "park_meta_indoor",
				forecastTimeUtc: null,
			}
		}
		return null
	}

	let temp = toNum(entry.temperature ?? entry.temp)
	if (temp != null && celsiusLikely(temp)) {
		temp = temp * 9 / 5 + 32
	}
	const temperatureF = temp != null ? Number(temp.toFixed(1)) : null

	let wind = toNum(entry.windSpeed)
	if (wind != null && wind <= 25) wind = wind * 2.23694
	const windSpeedMph = wind != null ? Number(wind.toFixed(1)) : null
	const windDirectionDeg = toNum(entry.windDirectionDeg)
	const humidityPct = toNum(entry.humidityPct ?? entry.relative_humidity_2m)
	const precipitationMm = toNum(entry.precipitationMm ?? entry.precipitation)

	const windDirectionTag = isIndoor ? "indoor" : classifyWindDirection(windSpeedMph, windDirectionDeg)

	let tempCarryShift = 0
	if (temperatureF != null) {
		// Indoor stadiums are climate-controlled near 72F; the temp signal is
		// near zero either way, but we anchor to 72 for stability.
		const baseline = isIndoor ? 72 : 70
		tempCarryShift = clamp((temperatureF - baseline) * 0.0015, -0.04, 0.04)
	}

	let windCarryShift = 0
	if (!isIndoor && windSpeedMph != null) {
		const mag = clamp((windSpeedMph - 4) * 0.003, 0, 0.04)
		if (windDirectionTag === "out_to_cf") windCarryShift = mag
		else if (windDirectionTag === "in_from_cf") windCarryShift = -mag
	}

	let precipShift = 0
	if (!isIndoor && precipitationMm != null) {
		// Heavy precipitation suppresses offense — small negative shift; cap -0.03.
		precipShift = -clamp((precipitationMm - 0.2) * 0.012, 0, 0.03)
	}

	const carryShift = clamp(tempCarryShift + windCarryShift + precipShift, -0.05, 0.05)

	return {
		temperatureF,
		windSpeedMph,
		windDirectionDeg,
		windDirectionTag,
		humidityPct,
		precipitationMm,
		isIndoor,
		parkName: meta?.parkName || null,
		tempCarryShift: Number(tempCarryShift.toFixed(4)),
		windCarryShift: Number(windCarryShift.toFixed(4)),
		precipShift: Number(precipShift.toFixed(4)),
		carryShift: Number(carryShift.toFixed(4)),
		source: entry?._meta?.ingestedAt ? "openmeteo_live" : "openmeteo_cached",
		forecastTimeUtc: entry.forecastTimeUtc || null,
	}
}

module.exports = { deriveMlbWeatherContext, classifyWindDirection, lookupParkMeta }
