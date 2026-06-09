"use strict"

/**
 * MLB Pitcher Game Logs Ingestion — 2026-05-30
 *
 * Per-start pitching stats for every pitcher already in mlbPitcherStats.json.
 * Pitchers throw every 5 days so we keep a 14-day window (~3 starts).
 *
 * Source: statsapi `/api/v1/people/{playerId}/stats?stats=gameLog&group=pitching&season=YYYY`
 *
 * Output: backend/data/mlbPitcherGameLogs.json
 *
 * Schema:
 *   {
 *     generatedAt, source, windowDays,
 *     players: {
 *       "anthony kay": {
 *         playerId, fullName, throws, teamId, teamName,
 *         starts: [
 *           { date, opponent, isHome,
 *             stats: { inningsPitched, strikeOuts, walks, hits, earnedRuns,
 *                      homeRunsAllowed, battersFaced, pitchCount, decision } },
 *           ...
 *         ],
 *         lastUpdated
 *       }
 *     }
 *   }
 *
 * Kill switch: env MLB_CTX_SKIP_PITCHER_GAMELOGS=1
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")
const normalizeName = require("../../../utils/normalizeName")
const { currentSlateDateEt } = require("../../shared/slateDate")
// 2026-06-09 sibling hardening — shared retry + merge-not-overwrite + meta.
const { withRetry, loadJsonSafe, mergeNoShrink, writeMeta } = require("./mlbIngestHardening")

const PEOPLE_URL = "https://statsapi.mlb.com/api/v1/people"
const BATCH_SIZE = 30
const WINDOW_DAYS = 14
const PITCHER_CACHE = path.join(__dirname, "..", "..", "..", "data", "mlbPitcherStats.json")
const OUT_PATH = path.join(__dirname, "..", "..", "..", "data", "mlbPitcherGameLogs.json")
const OUT_META_PATH = path.join(__dirname, "..", "..", "..", "data", "mlbPitcherGameLogs.meta.json")

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

function deriveSlateDate(date) {
	if (date) return String(date).slice(0, 10)
	// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
	return currentSlateDateEt()
}

function withinWindow(dateStr, slateDate, windowDays) {
	if (!dateStr) return false
	const g = Date.parse(dateStr)
	const s = Date.parse(slateDate)
	if (!Number.isFinite(g) || !Number.isFinite(s)) return false
	const diffDays = Math.floor((s - g) / (1000 * 60 * 60 * 24))
	return diffDays >= 0 && diffDays <= windowDays
}

function extractStartLogs(person, season, slateDate, windowDays) {
	const statsArr = Array.isArray(person?.stats) ? person.stats : []
	let logs = null
	for (const block of statsArr) {
		const grp = block?.group?.displayName?.toLowerCase()
		const typ = block?.type?.displayName?.toLowerCase()
		if (grp === "pitching" && (typ === "gamelog" || typ === "game log")) {
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
		const ipRaw = s.inningsPitched
		const ip = ipRaw != null ? Number(String(ipRaw)) : null
		// Only count starts (or appearances ≥ 3 IP — relief outings of <3 IP add noise)
		if (!Number.isFinite(ip) || ip < 1) continue
		out.push({
			date,
			opponent: sp?.opponent?.name || null,
			isHome: sp?.isHome === true,
			stats: {
				inningsPitched: ip,
				battersFaced: toNum(s.battersFaced),
				strikeOuts: toNum(s.strikeOuts),
				walks: toNum(s.baseOnBalls),
				hits: toNum(s.hits),
				earnedRuns: toNum(s.earnedRuns),
				homeRunsAllowed: toNum(s.homeRuns),
				pitchCount: toNum(s.pitchesThrown ?? s.numberOfPitches),
				decision: s.decisionType || null,
			},
		})
	}
	out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
	return out
}

async function fetchBatchGameLogs(pitchers, season) {
	if (!pitchers.length) return []
	const personIds = pitchers.map((p) => p.playerId).join(",")
	const res = await withRetry(() => axios.get(PEOPLE_URL, {
		params: {
			personIds,
			hydrate: `stats(type=gameLog,group=pitching,season=${season})`,
		},
		timeout: 15000,
	}), { label: "pitcher-gamelogs-batch" })
	const people = res?.data?.people || []
	const byId = new Map()
	for (const p of people) byId.set(Number(p.id), p)
	const out = []
	for (const p of pitchers) {
		const px = byId.get(p.playerId)
		if (!px) { out.push({ __error: "no_person", pitcher: p }); continue }
		out.push({ pitcher: p, person: px })
	}
	return out
}

function persistMap(payload) {
	try {
		const dir = path.dirname(OUT_PATH)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2))
		return true
	} catch (_) {
		return false
	}
}

async function refreshMlbPitcherGameLogs({ slateDate, season, windowDays = WINDOW_DAYS } = {}) {
	const diagnostics = {
		layer: "pitcher_game_logs",
		slateDate: null,
		season: null,
		windowDays,
		pitchersFromCache: 0,
		batches: 0,
		playersFetched: 0,
		startsIngested: 0,
		skipped: false,
		persistedToDisk: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_PITCHER_GAMELOGS === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { playersByName: {}, diagnostics }
	}

	if (!fs.existsSync(PITCHER_CACHE)) {
		diagnostics.errors.push({ stage: "preflight", message: "mlbPitcherStats.json missing — run populateMlbPitcherStats first" })
		diagnostics.finishedAt = new Date().toISOString()
		return { playersByName: {}, diagnostics }
	}

	const date = deriveSlateDate(slateDate)
	const seasonResolved = season ? String(season) : String(new Date(date).getUTCFullYear())
	diagnostics.slateDate = date
	diagnostics.season = seasonResolved

	const pitcherCache = JSON.parse(fs.readFileSync(PITCHER_CACHE, "utf8"))
	const pitchers = Object.values(pitcherCache)
		.filter((p) => p?.playerId && p?.fullName)
		.map((p) => ({
			playerId: p.playerId,
			fullName: p.fullName,
			throws: p.throws,
			teamId: p.teamId,
			teamName: p.teamName,
		}))
	diagnostics.pitchersFromCache = pitchers.length

	const playersByName = {}
	for (let i = 0; i < pitchers.length; i += BATCH_SIZE) {
		const chunk = pitchers.slice(i, i + BATCH_SIZE)
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
			const starts = extractStartLogs(r.person, seasonResolved, date, windowDays)
			if (!starts.length) continue
			const key = normalizeName(r.pitcher.fullName)
			if (!key) continue
			playersByName[key] = {
				playerId: r.pitcher.playerId,
				fullName: r.pitcher.fullName,
				throws: r.pitcher.throws,
				teamId: r.pitcher.teamId,
				teamName: r.pitcher.teamName,
				starts,
				lastUpdated: date,
			}
			diagnostics.playersFetched += 1
			diagnostics.startsIngested += starts.length
		}
	}

	// 2026-06-09 hardening — MERGE-not-overwrite the inner players map: a partial run
	// keeps prior pitchers (game logs are day-stable). Never shrink coverage.
	const _prior = loadJsonSafe(OUT_PATH) || {}
	const _priorPlayers = (_prior && typeof _prior.players === "object" && _prior.players) || {}
	const _m = mergeNoShrink(_priorPlayers, playersByName)
	diagnostics.priorPlayers = _m.priorCount
	diagnostics.thisRunPlayers = _m.thisRunCount
	diagnostics.mergedPlayers = _m.mergedCount
	diagnostics.priorPlayersRetained = _m.retained
	const payload = {
		generatedAt: new Date().toISOString(),
		source: "mlb_statsapi_gamelog_pitching",
		windowDays,
		players: _m.shrank ? _priorPlayers : _m.merged,
	}
	if (_m.shrank) {
		diagnostics.errors.push({ stage: "merge", message: `merged ${_m.mergedCount} < prior ${_m.priorCount} — kept prior` })
	}
	diagnostics.persistedToDisk = persistMap(payload)
	diagnostics.finishedAt = new Date().toISOString()
	writeMeta(OUT_META_PATH, {
		slateDate: date, windowDays, pitchersFromCache: diagnostics.pitchersFromCache,
		thisRunPlayers: _m.thisRunCount, totalPlayers: Object.keys(payload.players).length,
		priorPlayersRetained: _m.retained, finishedAt: diagnostics.finishedAt,
	})

	console.log("[MLB-INGEST-PITCHER-GAMELOGS]", {
		slateDate: date,
		season: seasonResolved,
		windowDays,
		pitchersFromCache: diagnostics.pitchersFromCache,
		playersFetched: diagnostics.playersFetched,
		startsIngested: diagnostics.startsIngested,
		batches: diagnostics.batches,
		persistedToDisk: diagnostics.persistedToDisk,
		errors: diagnostics.errors.length,
	})

	return { playersByName, diagnostics }
}

module.exports = { refreshMlbPitcherGameLogs }
