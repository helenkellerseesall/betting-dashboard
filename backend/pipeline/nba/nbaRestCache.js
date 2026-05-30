"use strict"

/**
 * NBA rest tracker — reads existing nbaPlayerGameLogs.json (no new data
 * fetch) and computes per-player rest metrics on demand:
 *
 *   daysSinceLastGame   — integer days between today and player's most recent game
 *   isBackToBack        — true when player played yesterday AND has a game today
 *   gamesInLast3Days    — minutes-load proxy (3+ games in 3 days = tired)
 *   gamesInLast7Days    — same idea, weekly view
 *
 * API:
 *   getRestStatus(playerName, slateDate?) → {
 *     daysSinceLastGame, lastGameDate, isBackToBack,
 *     gamesInLast3Days, gamesInLast7Days, source
 *   } | null
 *
 * Returns null when player not in cache.
 *
 * Lazy load + in-process memoize.
 */

const fs = require("fs")
const path = require("path")
const normalizeName = require("../../utils/normalizeName")

const CACHE_FILE = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")

let _loaded = false
let _normalizedMap = null

function loadCache() {
	if (_loaded) return _normalizedMap
	_loaded = true
	try {
		if (!fs.existsSync(CACHE_FILE)) return _normalizedMap = null
		const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
		const players = raw?.players || {}
		const out = {}
		for (const k of Object.keys(players)) {
			const norm = normalizeName(k)
			if (norm) out[norm] = players[k]
		}
		_normalizedMap = out
	} catch (_) {
		_normalizedMap = null
	}
	return _normalizedMap
}

function resetCache() { _loaded = false; _normalizedMap = null }

function daysBetween(a, b) {
	const ax = Date.parse(a)
	const bx = Date.parse(b)
	if (!Number.isFinite(ax) || !Number.isFinite(bx)) return null
	return Math.floor(Math.abs(bx - ax) / (1000 * 60 * 60 * 24))
}

function todayKey() {
	return new Date().toISOString().slice(0, 10)
}

function getRestStatus(playerName, slateDate) {
	const map = loadCache()
	if (!map) return null
	const entry = map[normalizeName(playerName)]
	if (!entry || !Array.isArray(entry.games) || !entry.games.length) return null

	const ref = slateDate || todayKey()
	// Games are sorted newest-first by populator. Find most recent that's
	// strictly BEFORE the slate date (so we don't count today's game).
	let lastGameDate = null
	for (const g of entry.games) {
		if (!g?.date) continue
		const d = String(g.date).slice(0, 10)
		if (d < ref) { lastGameDate = d; break }
	}
	if (!lastGameDate) return null

	const dsl = daysBetween(ref, lastGameDate)
	const isBackToBack = dsl === 1

	// Games in last 3 / 7 calendar days (strictly before slate date)
	let g3 = 0, g7 = 0
	for (const g of entry.games) {
		if (!g?.date) continue
		const d = String(g.date).slice(0, 10)
		if (d >= ref) continue
		const gap = daysBetween(ref, d)
		if (gap == null) continue
		if (gap <= 3) g3 += 1
		if (gap <= 7) g7 += 1
	}

	return {
		daysSinceLastGame: dsl,
		lastGameDate,
		isBackToBack,
		gamesInLast3Days: g3,
		gamesInLast7Days: g7,
		source: "nbaPlayerGameLogs",
	}
}

/**
 * Attach row.restContext when player is in the game-logs cache.
 * No-op otherwise.
 */
function enrichRowWithRestContext(row, slateDate) {
	if (!row || typeof row !== "object") return row
	const player = row.player || row.playerName
	if (!player) return row
	const r = getRestStatus(player, slateDate)
	if (r) row.restContext = r
	return row
}

/**
 * Multiplier to scale projected MINUTES based on rest.
 *   B2B → 0.95 (5% minutes reduction — tired starters often play less)
 *   3 games in 3 days → 0.93
 *   1+ day rest → 1.00 (neutral)
 *   3+ days rest → 1.02 (fresh, slight bump)
 * Clamped ±5%.
 */
function restMinutesMultiplier(row) {
	const r = row?.restContext
	if (!r) return 1
	if (r.isBackToBack) return 0.95
	if (r.gamesInLast3Days >= 3) return 0.93
	if (r.daysSinceLastGame != null && r.daysSinceLastGame >= 3) return 1.02
	return 1.00
}

module.exports = {
	getRestStatus,
	enrichRowWithRestContext,
	restMinutesMultiplier,
	loadCache,
	resetCache,
}
