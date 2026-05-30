"use strict"

/**
 * NBA home/away splits — derived from existing nbaPlayerGameLogs.json
 * (each game has isHome). No new data fetch.
 *
 * For each player + stat, computes home-game avg and away-game avg + an
 * "advantage multiplier" the engine can apply based on tonight's venue.
 *
 * API:
 *   getHomeAwaySplit(playerName, statKey) → {
 *     homeAvg, awayAvg, homeGames, awayGames, overallAvg, source
 *   } | null
 *
 *   enrichRowWithHomeAwaySplit(row) — attaches row.homeAwaySplit per stat.
 *     Uses row.statFamily to pick the relevant stat key.
 *     Uses row.isHome to know which side to compare.
 *
 *   homeAwayMultiplier(row, statKey) → number (0.93..1.07)
 *     If tonight player is HOME and home avg > overall, returns 1+.
 *     If tonight player is AWAY and away avg < overall, returns 1-.
 *     Capped ±7%.
 */

const fs = require("fs")
const path = require("path")
const normalizeName = require("../../utils/normalizeName")

const CACHE_FILE = path.join(__dirname, "..", "..", "data", "nbaPlayerGameLogs.json")
const MIN_GAMES_PER_SIDE = 3  // require ≥3 home AND ≥3 away games to trust

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

/**
 * Stat key resolver — translate row.statFamily to game-log stat field.
 */
function statKeyForFamily(family) {
	const s = String(family || "").toLowerCase()
	if (s.includes("rebound")) return "rebounds"
	if (s.includes("assist")) return "assists"
	if (s.includes("three")) return "threes"
	if (s.includes("block")) return "blocks"
	if (s.includes("steal")) return "steals"
	if (s.includes("point") && !s.includes("rebound") && !s.includes("assist")) return "points"
	return null
}

function getHomeAwaySplit(playerName, statKey) {
	const map = loadCache()
	if (!map) return null
	const entry = map[normalizeName(playerName)]
	if (!entry || !Array.isArray(entry.games)) return null
	let homeSum = 0, homeN = 0, awaySum = 0, awayN = 0
	for (const g of entry.games) {
		const v = Number(g?.stats?.[statKey])
		if (!Number.isFinite(v)) continue
		if (g.isHome === true) { homeSum += v; homeN += 1 }
		else if (g.isHome === false) { awaySum += v; awayN += 1 }
	}
	if (homeN < MIN_GAMES_PER_SIDE || awayN < MIN_GAMES_PER_SIDE) return null
	const homeAvg = homeSum / homeN
	const awayAvg = awaySum / awayN
	const overallAvg = (homeSum + awaySum) / (homeN + awayN)
	return {
		homeAvg: Number(homeAvg.toFixed(2)),
		awayAvg: Number(awayAvg.toFixed(2)),
		homeGames: homeN,
		awayGames: awayN,
		overallAvg: Number(overallAvg.toFixed(2)),
		source: "nbaPlayerGameLogs",
	}
}

/**
 * Multiplier the engine applies to projection. Conservative ±7%.
 *   If player is HOME tonight, lean toward homeAvg / overallAvg.
 *   If player is AWAY tonight, lean toward awayAvg / overallAvg.
 */
function homeAwayMultiplier(row, statKey) {
	if (!row || row.isHome == null) return 1
	const split = getHomeAwaySplit(row.player, statKey)
	if (!split || !Number.isFinite(split.overallAvg) || split.overallAvg <= 0) return 1
	const thisLeg = row.isHome === true ? split.homeAvg : split.awayAvg
	if (!Number.isFinite(thisLeg)) return 1
	const ratio = thisLeg / split.overallAvg
	return Math.max(0.93, Math.min(1.07, ratio))
}

/**
 * Attaches row.homeAwaySplit (for the row's statFamily) and
 * row.homeAwayMultiplier (signed clamped multiplier).
 */
function enrichRowWithHomeAwaySplit(row) {
	if (!row || typeof row !== "object") return row
	if (!row.player) return row
	const statKey = statKeyForFamily(row.statFamily)
	if (!statKey) return row
	const split = getHomeAwaySplit(row.player, statKey)
	if (!split) return row
	row.homeAwaySplit = { ...split, statKey }
	row.homeAwayMultiplier = Number(homeAwayMultiplier(row, statKey).toFixed(3))
	return row
}

module.exports = {
	getHomeAwaySplit,
	homeAwayMultiplier,
	enrichRowWithHomeAwaySplit,
	statKeyForFamily,
	loadCache,
	resetCache,
	MIN_GAMES_PER_SIDE,
}
