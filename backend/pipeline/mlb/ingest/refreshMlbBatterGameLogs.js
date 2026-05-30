"use strict"

/**
 * MLB Batter Game Logs Ingestion — 2026-05-30
 *
 * Hot/cold streak detection — companion to refreshMlbBatterStats.js which
 * only emits season-aggregate. This module fetches per-game stats for the
 * last ~21 days so engines can compute L5/L15 streak metrics.
 *
 * Source: MLB StatsAPI `/api/v1/people/{playerId}/stats?stats=gameLog&season=YYYY`
 * Per-batter we keep games where stat.dateString is within the window.
 *
 * Persisted file: backend/data/mlbBatterGameLogs.json
 *
 * Output schema:
 *   {
 *     generatedAt: ISO,
 *     source: "mlb_statsapi_gamelog",
 *     windowDays: 21,
 *     players: {
 *       "aaron judge": {
 *         playerId, fullName, batSide, teamId, teamName,
 *         games: [
 *           { date: "2026-05-29", opponent: "...", isHome: true, starter: true,
 *             stats: { atBats, hits, doubles, triples, homeRuns, rbi, runs,
 *                      baseOnBalls, strikeOuts, stolenBases, totalBases, plateAppearances } },
 *           ...
 *         ],
 *         lastUpdated: "2026-05-30"
 *       }
 *     }
 *   }
 *
 * Bounded behavior:
 *   - sources player IDs from existing mlbBatterStats.json (must run AFTER batterStats)
 *   - batch fetch via /people?personIds=... in chunks of 50
 *   - per-request timeout 15s
 *   - fail-open: any failed batch drops only its chunk
 *
 * Kill switch: env MLB_CTX_SKIP_GAMELOGS=1
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")
const normalizeName = require("../../../utils/normalizeName")

const PEOPLE_URL = "https://statsapi.mlb.com/api/v1/people"
const BATCH_SIZE = 50
const WINDOW_DAYS = 21
const BATTER_CACHE = path.join(__dirname, "..", "..", "..", "data", "mlbBatterStats.json")
const OUT_PATH = path.join(__dirname, "..", "..", "..", "data", "mlbBatterGameLogs.json")

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

function deriveSlateDate(date) {
	if (date) return String(date).slice(0, 10)
	return new Date().toISOString().slice(0, 10)
}

function withinWindow(dateStr, slateDate, windowDays) {
	if (!dateStr) return false
	const g = Date.parse(dateStr)
	const s = Date.parse(slateDate)
	if (!Number.isFinite(g) || !Number.isFinite(s)) return false
	const diffDays = Math.floor((s - g) / (1000 * 60 * 60 * 24))
	return diffDays >= 0 && diffDays <= windowDays
}

function extractGameLogs(person, season, slateDate, windowDays) {
	const statsArr = Array.isArray(person?.stats) ? person.stats : []
	let logs = null
	for (const block of statsArr) {
		const grp = block?.group?.displayName?.toLowerCase()
		const typ = block?.type?.displayName?.toLowerCase()
		if (grp === "hitting" && (typ === "gamelog" || typ === "game log")) {
			logs = Array.isArray(block?.splits) ? block.splits : []
			break
		}
	}
	if (!logs) return []
	const out = []
	for (const sp of logs) {
		const date = sp?.date || sp?.gameDate || sp?.stat?.date
		if (!withinWindow(date, slateDate, windowDays)) continue
		const s = sp?.stat || {}
		out.push({
			date,
			opponent: sp?.opponent?.name || null,
			isHome: sp?.isHome === true,
			stats: {
				atBats: toNum(s.atBats),
				plateAppearances: toNum(s.plateAppearances),
				hits: toNum(s.hits),
				doubles: toNum(s.doubles),
				triples: toNum(s.triples),
				homeRuns: toNum(s.homeRuns),
				rbi: toNum(s.rbi),
				runs: toNum(s.runs),
				baseOnBalls: toNum(s.baseOnBalls),
				strikeOuts: toNum(s.strikeOuts),
				stolenBases: toNum(s.stolenBases),
				totalBases: toNum(s.totalBases),
			},
		})
	}
	// Sort newest-first so L5/L10 lookups can slice from the front.
	out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
	return out
}

async function fetchBatchGameLogs(batters, season) {
	if (!batters.length) return []
	const personIds = batters.map((b) => b.playerId).join(",")
	const res = await axios.get(PEOPLE_URL, {
		params: {
			personIds,
			hydrate: `stats(type=gameLog,group=hitting,season=${season})`,
		},
		timeout: 15000,
	})
	const people = res?.data?.people || []
	const byId = new Map()
	for (const p of people) byId.set(Number(p.id), p)
	const out = []
	for (const b of batters) {
		const p = byId.get(b.playerId)
		if (!p) { out.push({ __error: "no_person", batter: b }); continue }
		out.push({ batter: b, person: p })
	}
	return out
}

function persistMap(map) {
	try {
		const dir = path.dirname(OUT_PATH)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(OUT_PATH, JSON.stringify(map, null, 2))
		return true
	} catch (_) {
		return false
	}
}

async function refreshMlbBatterGameLogs({ slateDate, season, windowDays = WINDOW_DAYS } = {}) {
	const diagnostics = {
		layer: "batter_game_logs",
		slateDate: null,
		season: null,
		windowDays,
		battersFromCache: 0,
		batches: 0,
		playersFetched: 0,
		gamesIngested: 0,
		skipped: false,
		persistedToDisk: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_GAMELOGS === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { playersByName: {}, diagnostics }
	}

	if (!fs.existsSync(BATTER_CACHE)) {
		diagnostics.errors.push({ stage: "preflight", message: "mlbBatterStats.json missing — run populateMlbBatterStats first" })
		diagnostics.finishedAt = new Date().toISOString()
		return { playersByName: {}, diagnostics }
	}

	const date = deriveSlateDate(slateDate)
	const seasonResolved = season ? String(season) : String(new Date(date).getUTCFullYear())
	diagnostics.slateDate = date
	diagnostics.season = seasonResolved

	const batterCache = JSON.parse(fs.readFileSync(BATTER_CACHE, "utf8"))
	const batters = Object.values(batterCache)
		.filter((b) => b?.playerId && b?.fullName)
		.map((b) => ({
			playerId: b.playerId,
			fullName: b.fullName,
			batSide: b.batSide,
			teamId: b.teamId,
			teamName: b.teamName,
		}))
	diagnostics.battersFromCache = batters.length

	const playersByName = {}
	for (let i = 0; i < batters.length; i += BATCH_SIZE) {
		const chunk = batters.slice(i, i + BATCH_SIZE)
		diagnostics.batches += 1
		let results = []
		try {
			results = await fetchBatchGameLogs(chunk, seasonResolved)
		} catch (e) {
			if (diagnostics.errors.length < 5) {
				diagnostics.errors.push({ stage: "people_batch", batchIndex: i / BATCH_SIZE, reason: e?.message || String(e) })
			}
			continue
		}
		for (const r of results) {
			if (r.__error) continue
			const games = extractGameLogs(r.person, seasonResolved, date, windowDays)
			if (!games.length) continue
			const key = normalizeName(r.batter.fullName)
			if (!key) continue
			playersByName[key] = {
				playerId: r.batter.playerId,
				fullName: r.batter.fullName,
				batSide: r.batter.batSide,
				teamId: r.batter.teamId,
				teamName: r.batter.teamName,
				games,
				lastUpdated: date,
			}
			diagnostics.playersFetched += 1
			diagnostics.gamesIngested += games.length
		}
	}

	const payload = {
		generatedAt: new Date().toISOString(),
		source: "mlb_statsapi_gamelog",
		windowDays,
		players: playersByName,
	}
	diagnostics.persistedToDisk = persistMap(payload)
	diagnostics.finishedAt = new Date().toISOString()

	console.log("[MLB-INGEST-BATTER-GAMELOGS]", {
		slateDate: date,
		season: seasonResolved,
		windowDays,
		battersFromCache: diagnostics.battersFromCache,
		playersFetched: diagnostics.playersFetched,
		gamesIngested: diagnostics.gamesIngested,
		batches: diagnostics.batches,
		persistedToDisk: diagnostics.persistedToDisk,
		errors: diagnostics.errors.length,
	})

	return { playersByName, diagnostics }
}

module.exports = { refreshMlbBatterGameLogs }
