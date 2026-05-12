"use strict"

/**
 * MLB Phase 2 — Live Weather Delta Derivation (per-row)
 *
 * Pure function. Computes per-row weather delta from current weatherContext
 * (already attached by Phase 1B) versus the prior history record's stored
 * weather snapshot. Does NOT re-fetch — re-fetching is handled by the Phase 1B
 * ingester whenever a live refresh runs. This is the OBSERVABILITY layer.
 *
 * Output (shape-stable; honest nulls when no prior record):
 *   {
 *     refreshedAt,
 *     previousTemperatureF, currentTemperatureF, tempShiftF,
 *     previousWindMph, currentWindMph, windShiftMph,
 *     previousPrecipMm, currentPrecipMm, precipShiftMm,
 *     windDirectionChanged,            // true when out_to_cf ↔ in_from_cf
 *     rainStarted,                     // false → true precipitation
 *     rainStopped,                     // true → false precipitation
 *     materialShift,                   // any of: |tempShift|>=5, |windShift|>=4, precip change
 *     source,
 *   }
 */

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

function deriveMlbLiveWeatherDelta(row, { historyRecords, capturedAtIso } = {}) {
	if (!row) return null
	const eventId = String(row?.eventId || "")
	if (!eventId) return null

	const curW = row?.weatherContext || null
	if (!curW) return null

	const records = Array.isArray(historyRecords) ? historyRecords : []
	let prev = null
	for (let i = records.length - 1; i >= 0; i--) {
		const cand = records[i]?.byEventId?.[eventId]?.weather
		if (cand) { prev = cand; break }
	}

	const previousTemperatureF = toNum(prev?.temperatureF)
	const currentTemperatureF  = toNum(curW?.temperatureF)
	const previousWindMph      = toNum(prev?.windSpeedMph)
	const currentWindMph       = toNum(curW?.windSpeedMph)
	const previousPrecipMm     = toNum(prev?.precipitationMm)
	const currentPrecipMm      = toNum(curW?.precipitationMm)

	const tempShiftF =
		(previousTemperatureF != null && currentTemperatureF != null)
			? Number((currentTemperatureF - previousTemperatureF).toFixed(1)) : null
	const windShiftMph =
		(previousWindMph != null && currentWindMph != null)
			? Number((currentWindMph - previousWindMph).toFixed(1)) : null
	const precipShiftMm =
		(previousPrecipMm != null && currentPrecipMm != null)
			? Number((currentPrecipMm - previousPrecipMm).toFixed(2)) : null

	const previousDirTag = String(prev?.windDirectionTag || "")
	const currentDirTag  = String(curW?.windDirectionTag || "")
	const directionChanged =
		previousDirTag && currentDirTag && previousDirTag !== currentDirTag
			? true : (previousDirTag && currentDirTag) ? false : null

	const rainStarted =
		(previousPrecipMm != null && currentPrecipMm != null)
			? (previousPrecipMm <= 0.05 && currentPrecipMm > 0.5) : null
	const rainStopped =
		(previousPrecipMm != null && currentPrecipMm != null)
			? (previousPrecipMm > 0.5 && currentPrecipMm <= 0.05) : null

	const materialShift = (
		(tempShiftF   != null && Math.abs(tempShiftF)   >= 5) ||
		(windShiftMph != null && Math.abs(windShiftMph) >= 4) ||
		rainStarted === true ||
		rainStopped === true ||
		directionChanged === true
	)

	return {
		refreshedAt: capturedAtIso || new Date().toISOString(),
		previousTemperatureF, currentTemperatureF, tempShiftF,
		previousWindMph, currentWindMph, windShiftMph,
		previousPrecipMm, currentPrecipMm, precipShiftMm,
		previousWindDirectionTag: previousDirTag || null,
		currentWindDirectionTag:  currentDirTag  || null,
		windDirectionChanged: directionChanged,
		rainStarted, rainStopped,
		materialShift: Boolean(materialShift),
		source: prev ? "live_vs_history" : "live_only",
	}
}

module.exports = { deriveMlbLiveWeatherDelta }
