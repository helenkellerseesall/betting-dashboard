"use strict"

/**
 * MLB batter L5/L15 form cache reader.
 *
 * Reads backend/data/mlbBatterGameLogs.json (produced by
 * refreshMlbBatterGameLogs) and computes streak metrics on demand.
 *
 * API:
 *   getBatterForm(playerName, window = 5) → {
 *     window, sample_count, avg, obp, slg, ops, iso, hrRate, kRate, xbhRate,
 *     hitsPerGame, hrPerGame, rbiPerGame, runsPerGame, totalBasesPerGame,
 *     hitStreak,         // count of consecutive games ≥1 hit (newest-first)
 *     hrInWindow,        // total HR in the window (binary streak signal)
 *     daysSinceLastGame, source
 *   } | null
 *
 * Returns null when player not in cache OR sample_count < window.
 *
 * Lazy load + in-process memoize.
 */

const fs = require("fs")
const path = require("path")
const normalizeName = require("../../utils/normalizeName")
const { currentSlateDateEt } = require("../shared/slateDate")

const CACHE_FILE = path.join(__dirname, "..", "..", "data", "mlbBatterGameLogs.json")
const DEFAULT_WINDOWS = [5, 10, 15]
const MIN_SAMPLE_FOR_FORM = 3

let _loaded = false
let _normalizedMap = null
let _generatedAt = null

function loadCache() {
	if (_loaded) return _normalizedMap
	_loaded = true
	try {
		if (!fs.existsSync(CACHE_FILE)) return _normalizedMap = null
		const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
		_generatedAt = raw?.generatedAt || null
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

function resetCache() {
	_loaded = false
	_normalizedMap = null
	_generatedAt = null
}

function sumStat(games, key) {
	let total = 0
	let count = 0
	for (const g of games) {
		const v = Number(g?.stats?.[key])
		if (Number.isFinite(v)) { total += v; count += 1 }
	}
	return { total, count }
}

function daysBetween(a, b) {
	const ax = Date.parse(a)
	const bx = Date.parse(b)
	if (!Number.isFinite(ax) || !Number.isFinite(bx)) return null
	return Math.floor(Math.abs(bx - ax) / (1000 * 60 * 60 * 24))
}

/**
 * Build a form summary for a player over their most-recent `window` games.
 */
function getBatterForm(playerName, window = 5) {
	const map = loadCache()
	if (!map) return null
	const entry = map[normalizeName(playerName)]
	if (!entry || !Array.isArray(entry.games) || !entry.games.length) return null

	// Games already sorted newest-first by refreshMlbBatterGameLogs.
	const recent = entry.games.slice(0, window)
	if (recent.length < MIN_SAMPLE_FOR_FORM) return null

	const atBats = sumStat(recent, "atBats").total
	const pa     = sumStat(recent, "plateAppearances").total
	const hits   = sumStat(recent, "hits").total
	const doubles= sumStat(recent, "doubles").total
	const triples= sumStat(recent, "triples").total
	const hr     = sumStat(recent, "homeRuns").total
	const rbi    = sumStat(recent, "rbi").total
	const runs   = sumStat(recent, "runs").total
	const bb     = sumStat(recent, "baseOnBalls").total
	const k      = sumStat(recent, "strikeOuts").total
	const tb     = sumStat(recent, "totalBases").total

	const avg = atBats > 0 ? hits / atBats : null
	const obp = pa > 0 ? (hits + bb) / pa : null
	const slg = atBats > 0 ? tb / atBats : null
	const iso = (avg != null && slg != null) ? slg - avg : null
	const hrRate = atBats > 0 ? hr / atBats : null
	const kRate = pa > 0 ? k / pa : null
	const xbhRate = atBats > 0 ? (doubles + triples + hr) / atBats : null
	const ops = (obp != null && slg != null) ? obp + slg : null

	// Hit streak: consecutive newest-first games with ≥1 hit
	let hitStreak = 0
	for (const g of entry.games) {
		const h = Number(g?.stats?.hits)
		if (Number.isFinite(h) && h >= 1) hitStreak += 1
		else break
	}
	const hrInWindow = sumStat(recent, "homeRuns").total

	// Days since last game (versus today)
	// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
	const today = currentSlateDateEt()
	const lastDate = recent[0]?.date
	const daysSinceLastGame = lastDate ? daysBetween(today, lastDate) : null

	return {
		window,
		sample_count: recent.length,
		avg: avg != null ? Number(avg.toFixed(4)) : null,
		obp: obp != null ? Number(obp.toFixed(4)) : null,
		slg: slg != null ? Number(slg.toFixed(4)) : null,
		ops: ops != null ? Number(ops.toFixed(4)) : null,
		iso: iso != null ? Number(iso.toFixed(4)) : null,
		hrRate: hrRate != null ? Number(hrRate.toFixed(4)) : null,
		kRate: kRate != null ? Number(kRate.toFixed(4)) : null,
		xbhRate: xbhRate != null ? Number(xbhRate.toFixed(4)) : null,
		hitsPerGame: Number((hits / recent.length).toFixed(2)),
		hrPerGame: Number((hr / recent.length).toFixed(2)),
		rbiPerGame: Number((rbi / recent.length).toFixed(2)),
		runsPerGame: Number((runs / recent.length).toFixed(2)),
		totalBasesPerGame: Number((tb / recent.length).toFixed(2)),
		hitStreak,
		hrInWindow,
		daysSinceLastGame,
		source: "mlb_statsapi_gamelog",
	}
}

/**
 * Attach L5 + L15 form to a batter row. No-op when player not in cache.
 */
function enrichRowWithBatterForm(row) {
	if (!row || typeof row !== "object") return row
	if (row.isPitcherMarket === true) return row
	const player = row.player || row.playerName
	if (!player) return row
	const l5 = getBatterForm(player, 5)
	const l15 = getBatterForm(player, 15)
	if (l5) row.batterL5 = l5
	if (l15) row.batterL15 = l15
	return row
}

/**
 * 2026-05-30 — streak-momentum multiplier. Compares L5 to L15 on the chosen
 * metric and returns a clamped multiplier engines can apply to their
 * projection. Conservative by design: max ±8% adjustment per call.
 *
 *   metric: one of "avg" | "slg" | "hrRate" | "iso" | "hitsPerGame" | "hrPerGame" | "totalBasesPerGame"
 *
 * Returns 1.0 (neutral) when either window is missing or when their delta
 * is within a small noise band. Hot streak (L5 > L15) → multiplier > 1.
 * Cold streak (L5 < L15) → multiplier < 1.
 */
function streakMomentumMultiplier(row, metric) {
	const l5 = row?.batterL5
	const l15 = row?.batterL15
	if (!l5 || !l15) return 1
	const a = Number(l5[metric])
	const b = Number(l15[metric])
	if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 1
	const ratio = a / b
	// Within ±20% is noise; outside that, apply graduated shift.
	if (ratio >= 0.80 && ratio <= 1.20) return 1
	// Hot streak: linear ramp from 1.00 → 1.08 as ratio goes 1.20 → 1.80
	if (ratio > 1.20) {
		const excess = Math.min(0.60, ratio - 1.20)
		return 1 + (excess / 0.60) * 0.08
	}
	// Cold streak: 1.00 → 0.92 as ratio goes 0.80 → 0.30
	const deficit = Math.min(0.50, 0.80 - ratio)
	return 1 - (deficit / 0.50) * 0.08
}

/**
 * Returns "hot" | "cold" | "neutral" classification for human readability.
 */
function streakLabel(row, metric) {
	const m = streakMomentumMultiplier(row, metric)
	if (m > 1.025) return "hot"
	if (m < 0.975) return "cold"
	return "neutral"
}

module.exports = {
	getBatterForm,
	enrichRowWithBatterForm,
	streakMomentumMultiplier,
	streakLabel,
	loadCache,
	resetCache,
	DEFAULT_WINDOWS,
}
