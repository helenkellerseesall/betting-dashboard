"use strict"

/**
 * MLB Phase 1B — Slate-aware Weather Ingestion
 *
 * Replaces the disk-snapshot dependency of buildMlbWeather.js. Instead of
 * reading the (often stale) snapshot-mlb.json, this module accepts the LIVE
 * events array directly from the bootstrap caller and produces a fresh
 * weatherByEventId map keyed by current slate eventIds.
 *
 * Adds Phase 1B environmental fields:
 *   - relative_humidity_2m
 *   - precipitation
 *
 * Outputs (per eventId):
 *   temperatureF       — Fahrenheit
 *   windSpeedMph       — mph
 *   windDirectionDeg   — meteorological from-direction (degrees)
 *   humidityPct        — 0..100
 *   precipitationMm    — mm in the forecast hour
 *   forecastTimeUtc    — closest hour to game start
 *   geocode            — { lat, lon, nameUsed }
 *   source             — "openmeteo_live"
 *
 * Bounded behavior:
 *   - per-event timeout (10s geocode, 15s forecast)
 *   - global concurrency cap (5)
 *   - fail-open: a failed event yields a fallback null entry, never throws
 *   - geocode results memoized per process
 *
 * Side effect: persists the map to backend/data/mlbGameWeather.json so cold
 * starts can still serve from disk. Persistence failure is non-fatal.
 *
 * Kill switch: env var MLB_CTX_SKIP_WEATHER=1 disables network calls entirely
 * (returns existing on-disk map or empty).
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")

const GEOCODE_URL  = "https://geocoding-api.open-meteo.com/v1/search"
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
const DEFAULT_CONCURRENCY = 5
const DEFAULT_PER_EVENT_TIMEOUT_MS = 18000

const _geocodeCache = new Map()

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function eventIdOf(e) {
	const id = e?.eventId ?? e?.id ?? e?.event_id ?? e?.game_id ?? e?.gameId
	return id != null ? String(id) : null
}

function homeTeamOf(e) {
	return e?.homeTeam || e?.home_team || e?.home || null
}

function gameTimeOf(e) {
	return e?.gameTime || e?.commenceTime || e?.commence_time || e?.startTime || e?.gameDate || null
}

async function geocodeHomeTeam(homeTeam) {
	const raw = String(homeTeam || "").trim()
	if (!raw) return null
	if (_geocodeCache.has(raw)) return _geocodeCache.get(raw)

	const queries = [raw, raw.split(" ").slice(0, -1).join(" ").trim()].filter(Boolean)

	for (const name of queries) {
		try {
			const res = await axios.get(GEOCODE_URL, {
				params: { name, count: 1, language: "en", format: "json" },
				timeout: 10000,
			})
			const hit = res?.data?.results?.[0]
			const lat = toNum(hit?.latitude)
			const lon = toNum(hit?.longitude)
			if (Number.isFinite(lat) && Number.isFinite(lon)) {
				const result = { lat, lon, nameUsed: name }
				_geocodeCache.set(raw, result)
				return result
			}
		} catch (_) { /* fall through */ }
	}
	_geocodeCache.set(raw, null)
	return null
}

function pickClosestHourIndex(times, targetIso) {
	const targetMs = new Date(targetIso).getTime()
	if (!Number.isFinite(targetMs)) return -1
	let bestIdx = -1
	let bestDist = Infinity
	for (let i = 0; i < times.length; i++) {
		const ms = new Date(times[i]).getTime()
		if (!Number.isFinite(ms)) continue
		const d = Math.abs(ms - targetMs)
		if (d < bestDist) { bestDist = d; bestIdx = i }
	}
	return bestIdx
}

async function fetchForecastAtGameTime({ lat, lon, gameTimeIso }) {
	const res = await axios.get(FORECAST_URL, {
		params: {
			latitude: lat,
			longitude: lon,
			hourly: "temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,precipitation",
			timezone: "UTC",
		},
		timeout: 15000,
	})
	const h = res?.data?.hourly || {}
	const times = Array.isArray(h.time) ? h.time : []
	const idx = pickClosestHourIndex(times, gameTimeIso)
	if (idx < 0) return null

	return {
		temperatureC:    toNum(h.temperature_2m?.[idx]),
		windSpeedMs:     toNum(h.wind_speed_10m?.[idx]),
		windDirectionDeg: toNum(h.wind_direction_10m?.[idx]),
		humidityPct:     toNum(h.relative_humidity_2m?.[idx]),
		precipitationMm: toNum(h.precipitation?.[idx]),
		forecastTimeUtc: times[idx] || null,
	}
}

function celsiusToFahrenheit(c) {
	if (c == null) return null
	return c * 9 / 5 + 32
}

function msToMph(ms) {
	if (ms == null) return null
	return ms * 2.23694
}

async function chunkedPromiseAll(items, fn, concurrency = DEFAULT_CONCURRENCY) {
	const out = new Array(items.length)
	let i = 0
	const workers = new Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
		while (true) {
			const idx = i++
			if (idx >= items.length) return
			try { out[idx] = await fn(items[idx], idx) }
			catch (e) { out[idx] = { __error: e?.message || String(e) } }
		}
	})
	await Promise.all(workers)
	return out
}

async function refreshOneEvent(event) {
	const eventId = eventIdOf(event)
	const homeTeam = homeTeamOf(event)
	const gameTimeIso = gameTimeOf(event)

	if (!eventId) return { __error: "missing_event_id" }
	if (!homeTeam) return { eventId, __error: "missing_home_team" }
	if (!gameTimeIso) return { eventId, __error: "missing_game_time" }

	const geo = await geocodeHomeTeam(homeTeam)
	if (!geo) return { eventId, __error: "geocode_failed" }

	const wx = await fetchForecastAtGameTime({ lat: geo.lat, lon: geo.lon, gameTimeIso })
	if (!wx) return { eventId, __error: "forecast_failed" }

	return {
		eventId,
		entry: {
			// Phase 1 deriver compat fields (existing context loader reads these)
			temperature: celsiusToFahrenheit(wx.temperatureC),
			temp:        celsiusToFahrenheit(wx.temperatureC),
			windSpeed:   msToMph(wx.windSpeedMs),
			windDirectionDeg: wx.windDirectionDeg,
			windOut: false, // structural; deriver re-classifies from direction
			windIn:  false,
			windDir: "neutral",
			forecastTimeUtc: wx.forecastTimeUtc,
			// Phase 1B new fields
			humidityPct:     wx.humidityPct,
			precipitationMm: wx.precipitationMm,
			_meta: {
				homeTeam,
				geocode: geo,
				ingestedAt: new Date().toISOString(),
			},
		},
	}
}

function persistMap(map) {
	try {
		const dir = path.join(__dirname, "..", "..", "..", "data")
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		const file = path.join(dir, "mlbGameWeather.json")
		fs.writeFileSync(file, JSON.stringify(map, null, 2))
		return true
	} catch (_) {
		return false
	}
}

async function refreshMlbWeatherForSlate({ events, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_PER_EVENT_TIMEOUT_MS } = {}) {
	const diagnostics = {
		layer: "weather",
		requested: 0,
		geocoded: 0,
		fetched: 0,
		failed: 0,
		failuresByReason: {},
		skipped: false,
		persistedToDisk: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_WEATHER === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { weatherByEventId: {}, diagnostics }
	}

	const safeEvents = Array.isArray(events) ? events.filter((e) => eventIdOf(e)) : []
	diagnostics.requested = safeEvents.length

	if (!safeEvents.length) {
		diagnostics.finishedAt = new Date().toISOString()
		return { weatherByEventId: {}, diagnostics }
	}

	const wrap = (event) => new Promise((resolve) => {
		const timer = setTimeout(() => resolve({ eventId: eventIdOf(event), __error: "timeout" }), timeoutMs)
		refreshOneEvent(event).then((r) => { clearTimeout(timer); resolve(r) })
			.catch((e) => { clearTimeout(timer); resolve({ eventId: eventIdOf(event), __error: e?.message || String(e) }) })
	})

	const results = await chunkedPromiseAll(safeEvents, wrap, concurrency)

	const weatherByEventId = {}
	for (const r of results) {
		if (!r) continue
		if (r.__error) {
			diagnostics.failed += 1
			diagnostics.failuresByReason[r.__error] = (diagnostics.failuresByReason[r.__error] || 0) + 1
			if (diagnostics.errors.length < 5) diagnostics.errors.push({ eventId: r.eventId, reason: r.__error })
			continue
		}
		if (r.eventId && r.entry) {
			weatherByEventId[r.eventId] = r.entry
			diagnostics.fetched += 1
			diagnostics.geocoded += 1
		}
	}

	diagnostics.persistedToDisk = persistMap(weatherByEventId)
	diagnostics.finishedAt = new Date().toISOString()

	console.log("[MLB-INGEST-WEATHER]", {
		requested: diagnostics.requested,
		fetched: diagnostics.fetched,
		failed: diagnostics.failed,
		failuresByReason: diagnostics.failuresByReason,
		persistedToDisk: diagnostics.persistedToDisk,
	})

	return { weatherByEventId, diagnostics }
}

module.exports = { refreshMlbWeatherForSlate }
