"use strict"

/**
 * MLB pitcher L3/L5 form cache reader.
 *
 * Reads backend/data/mlbPitcherGameLogs.json (produced by
 * refreshMlbPitcherGameLogs) and computes per-window streak metrics.
 *
 * Windows are SMALLER than batter L5/L15 because pitchers start every 5 days:
 *   L3 = last 3 starts (~15 days)
 *   L5 = last 5 starts (~25 days, may exceed window if available)
 *
 * API:
 *   getPitcherForm(playerName, window = 3) → {
 *     window, sample_count, totalIp, totalK, totalBb, totalHits, totalEr,
 *     totalHr, totalBfp, totalPitches,
 *     kRate, bbRate, k9, era, whip, hrRate, pitchesPerStart, ipPerStart,
 *     hitsPerStart, krPerStart, daysSinceLastStart, source
 *   } | null
 *
 * Returns null when pitcher not in cache OR fewer than 2 starts in window.
 */

const fs = require("fs")
const path = require("path")
const normalizeName = require("../../utils/normalizeName")
const { currentSlateDateEt } = require("../shared/slateDate")

const CACHE_FILE = path.join(__dirname, "..", "..", "data", "mlbPitcherGameLogs.json")
const MIN_STARTS_FOR_FORM = 2

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

function resetCache() {
	_loaded = false
	_normalizedMap = null
}

function sumStat(starts, key) {
	let total = 0
	let count = 0
	for (const s of starts) {
		const v = Number(s?.stats?.[key])
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

function getPitcherForm(playerName, window = 3) {
	const map = loadCache()
	if (!map) return null
	const entry = map[normalizeName(playerName)]
	if (!entry || !Array.isArray(entry.starts) || !entry.starts.length) return null

	const recent = entry.starts.slice(0, window)
	if (recent.length < MIN_STARTS_FOR_FORM) return null

	const ip   = sumStat(recent, "inningsPitched").total
	const k    = sumStat(recent, "strikeOuts").total
	const bb   = sumStat(recent, "walks").total
	const hits = sumStat(recent, "hits").total
	const er   = sumStat(recent, "earnedRuns").total
	const hr   = sumStat(recent, "homeRunsAllowed").total
	const bfp  = sumStat(recent, "battersFaced").total
	const pitches = sumStat(recent, "pitchCount").total

	const kRate = bfp > 0 ? k / bfp : null
	const bbRate = bfp > 0 ? bb / bfp : null
	const k9 = ip > 0 ? (k * 9) / ip : null
	const era = ip > 0 ? (er * 9) / ip : null
	const whip = ip > 0 ? (bb + hits) / ip : null
	const hrRate = bfp > 0 ? hr / bfp : null
	const pitchesPerStart = recent.length > 0 ? pitches / recent.length : null
	const ipPerStart = recent.length > 0 ? ip / recent.length : null
	const hitsPerStart = recent.length > 0 ? hits / recent.length : null
	const krPerStart = recent.length > 0 ? k / recent.length : null

	// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
	const today = currentSlateDateEt()
	const lastDate = recent[0]?.date
	const daysSinceLastStart = lastDate ? daysBetween(today, lastDate) : null

	return {
		window,
		sample_count: recent.length,
		totalIp: ip,
		totalK: k,
		totalBb: bb,
		totalHits: hits,
		totalEr: er,
		totalHr: hr,
		totalBfp: bfp,
		totalPitches: pitches,
		kRate: kRate != null ? Number(kRate.toFixed(4)) : null,
		bbRate: bbRate != null ? Number(bbRate.toFixed(4)) : null,
		k9: k9 != null ? Number(k9.toFixed(2)) : null,
		era: era != null ? Number(era.toFixed(2)) : null,
		whip: whip != null ? Number(whip.toFixed(2)) : null,
		hrRate: hrRate != null ? Number(hrRate.toFixed(4)) : null,
		pitchesPerStart: pitchesPerStart != null ? Number(pitchesPerStart.toFixed(1)) : null,
		ipPerStart: ipPerStart != null ? Number(ipPerStart.toFixed(2)) : null,
		hitsPerStart: hitsPerStart != null ? Number(hitsPerStart.toFixed(1)) : null,
		krPerStart: krPerStart != null ? Number(krPerStart.toFixed(1)) : null,
		daysSinceLastStart,
		source: "mlb_statsapi_gamelog_pitching",
	}
}

/**
 * Attach L3 + L5 form to a pitcher row (or batter row's opposing pitcher).
 * For pitcher-market rows the player IS the pitcher; for batter-market rows
 * the row.opposingPitcher field holds the pitcher name.
 */
function enrichRowWithPitcherForm(row) {
	if (!row || typeof row !== "object") return row
	const isPitcherMarket = row.isPitcherMarket === true
	const player = isPitcherMarket
		? (row.player || row.playerName)
		: (row.opposingPitcher || row.opposingPitcherName || row.oppPitcher)
	if (!player) return row
	const l3 = getPitcherForm(player, 3)
	const l5 = getPitcherForm(player, 5)
	if (isPitcherMarket) {
		if (l3) row.pitcherL3 = l3
		if (l5) row.pitcherL5 = l5
	} else {
		// Opposing pitcher's recent form — affects batter projections
		if (l3) row.opposingPitcherL3 = l3
		if (l5) row.opposingPitcherL5 = l5
	}
	return row
}

/**
 * Streak momentum multiplier for pitcher metrics (mirror of batter helper).
 * Hotter recent form = higher multiplier. Conservative ±8% cap.
 *
 *   metric: "kRate" | "k9" | "whip" | "era" | "pitchesPerStart" | "krPerStart"
 *
 * NOTE for some metrics (whip, era, hrRate) LOWER is BETTER for the pitcher.
 * Pass `invert: true` and the helper flips the direction so "hotter" still
 * means "better for the pitcher's success."
 */
function streakMomentumMultiplier(row, metric, { invert = false } = {}) {
	const isPitcherMarket = row?.isPitcherMarket === true
	const l3 = isPitcherMarket ? row?.pitcherL3 : row?.opposingPitcherL3
	const l5 = isPitcherMarket ? row?.pitcherL5 : row?.opposingPitcherL5
	if (!l3 || !l5) return 1
	const a = Number(l3[metric])
	const b = Number(l5[metric])
	if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 1
	let ratio = a / b
	if (invert) ratio = 1 / ratio
	if (ratio >= 0.80 && ratio <= 1.20) return 1
	if (ratio > 1.20) {
		const excess = Math.min(0.60, ratio - 1.20)
		return 1 + (excess / 0.60) * 0.08
	}
	const deficit = Math.min(0.50, 0.80 - ratio)
	return 1 - (deficit / 0.50) * 0.08
}

module.exports = {
	getPitcherForm,
	enrichRowWithPitcherForm,
	streakMomentumMultiplier,
	loadCache,
	resetCache,
}
