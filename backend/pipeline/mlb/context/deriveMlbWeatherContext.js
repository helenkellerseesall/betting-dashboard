"use strict"

/**
 * MLB Phase 1 — Weather Context Derivation
 *
 * Pure function. Reads:
 *   row.eventId
 *   weatherByEventId map (from /backend/data/mlbGameWeather.json) — already
 *   built by buildMlbWeather.js. We never fetch here.
 *
 * Returns null when no weather data is available for the row's eventId.
 * Returns a structured contextual object otherwise. Fields:
 *
 *   temperatureF           — Fahrenheit (converted from C if necessary)
 *   windSpeedMph
 *   windDirectionDeg       — meteorological convention (FROM which dir)
 *   windDirectionTag       — "out_to_cf" | "in_from_cf" | "cross" | "calm" | "unknown"
 *                            (qualitative band only; park-specific orientation
 *                            modelling is deferred to a later phase)
 *   tempCarryShift         — bounded [-0.04, +0.04] HR-carry contribution
 *                            from temperature (Alan Nathan style: ~3 ft per 10F
 *                            above 70F; we soften this to a probability shift)
 *   windCarryShift         — bounded [-0.04, +0.04] HR-carry contribution
 *                            from wind. Only nonzero when band ≠ "cross"/"calm"
 *   carryShift             — tempCarryShift + windCarryShift (clamped)
 *
 * Notes:
 *   - Fallback weather entries from buildMlbWeather (temperature: 70, windSpeed: 0)
 *     produce a neutral shift naturally — no special-casing required.
 *   - We never invent missing fields. If a field is null in source, downstream
 *     shifts derived from it are 0.
 *   - This is observational only: it does NOT mutate predictedProbability.
 *     composeMlbContextualSignal aggregates these shifts into mlbContextualShift
 *     which downstream layers may consume in later phases.
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

function deriveMlbWeatherContext(row, { weatherByEventId } = {}) {
	if (!row) return null
	const eventKey = String(row?.eventId || "")
	if (!eventKey) return null
	const entry = (weatherByEventId && weatherByEventId[eventKey]) || null
	if (!entry || typeof entry !== "object") return null

	let temp = toNum(entry.temperature ?? entry.temp)
	if (temp != null && celsiusLikely(temp)) {
		temp = temp * 9 / 5 + 32
	}
	const temperatureF = temp != null ? Number(temp.toFixed(1)) : null

	let wind = toNum(entry.windSpeed)
	// Open-Meteo wind_speed_10m is in m/s when no unit override is requested.
	// buildMlbWeather.js does not override units, so we convert m/s → mph.
	// Heuristic: typical baseball wind 0..40 mph. m/s for the same range is 0..18.
	// We treat values ≤ 25 as m/s and convert. Above 25 we assume mph already.
	if (wind != null && wind <= 25) {
		wind = wind * 2.23694
	}
	const windSpeedMph = wind != null ? Number(wind.toFixed(1)) : null
	const windDirectionDeg = toNum(entry.windDirectionDeg)
	const windDirectionTag = classifyWindDirection(windSpeedMph, windDirectionDeg)

	// Temperature shift: ~+0.5 mph carry per 10F over 70F → tiny prob shift.
	// We cap at ±0.04 to keep contextual layers observational.
	let tempCarryShift = 0
	if (temperatureF != null) {
		tempCarryShift = clamp((temperatureF - 70) * 0.0015, -0.04, 0.04)
	}

	// Wind shift: only band classifier; magnitude scales with windSpeedMph.
	let windCarryShift = 0
	if (windSpeedMph != null) {
		const mag = clamp((windSpeedMph - 4) * 0.003, 0, 0.04)
		if (windDirectionTag === "out_to_cf") windCarryShift = mag
		else if (windDirectionTag === "in_from_cf") windCarryShift = -mag
		else windCarryShift = 0
	}

	const carryShift = clamp(tempCarryShift + windCarryShift, -0.05, 0.05)

	return {
		temperatureF,
		windSpeedMph,
		windDirectionDeg,
		windDirectionTag,
		tempCarryShift: Number(tempCarryShift.toFixed(4)),
		windCarryShift: Number(windCarryShift.toFixed(4)),
		carryShift: Number(carryShift.toFixed(4)),
		source: "openmeteo_cached",
		forecastTimeUtc: entry.forecastTimeUtc || null,
	}
}

module.exports = { deriveMlbWeatherContext, classifyWindDirection }
