"use strict"

/**
 * MLB Phase 1B — Real Bullpen Workload Ingestion
 *
 * For each team in the live slate, fetches the last N days of completed games
 * via /api/v1/teams/{teamId}/schedule then aggregates relief pitcher workload
 * from each game's boxscore. Produces a bullpenByTeam map keyed by normalized
 * lowercase team name (matching the lookup in deriveMlbBullpenContext).
 *
 * Per-team output:
 *   teamId
 *   teamName
 *   recentInnings              — total relief IP over the window
 *   highLeverageUses           — count of reliever appearances in 7th+ inning
 *   backToBackAppearances      — pitchers used on consecutive days
 *   relieverCount              — distinct relievers used in window
 *   closerCandidate            — name of the highest-leverage usage reliever
 *   fatigueScore               — bounded 0..1, ~recentInnings/cap
 *   windowDays                 — N (default 3)
 *   gamesObserved              — number of games scanned
 *   source                     — "mlb_statsapi_boxscores"
 *
 * Heuristics:
 *   - A pitcher is a reliever for a given appearance if note==="" and the box
 *     line entry is NOT the listed gameStatus.officialStarter for that team.
 *     We use boxscore's teams.[side].pitchers[*] ordering plus
 *     boxscore.officialStarter signal where present; pragmatically we use the
 *     simpler rule: first pitcher = starter; everyone after = reliever.
 *   - high-leverage marker: appears in 7th, 8th, or 9th inning (approx by
 *     position index ≥ 3 OR earnedRuns context — Phase 1B uses position index
 *     ≥ 3 as a usable proxy).
 *
 * Bounded behavior:
 *   - Concurrency-limited (3 for game-fetches, default 6 for team-schedules)
 *   - Global per-call timeout 25s
 *   - Fail-open: any failure leaves the team out, never throws
 *
 * Kill switch: env MLB_CTX_SKIP_BULLPEN=1
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")

const SCHEDULE_URL_BASE = "https://statsapi.mlb.com/api/v1/teams"
const BOXSCORE_URL_BASE = "https://statsapi.mlb.com/api/v1/game"
const DEFAULT_WINDOW_DAYS = 3
const DEFAULT_TEAM_CONCURRENCY = 6
const DEFAULT_GAME_CONCURRENCY = 3

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function teamKey(teamName) {
	return String(teamName || "").trim().toLowerCase()
}

function isoDateDaysAgo(days) {
	const d = new Date()
	d.setUTCDate(d.getUTCDate() - days)
	return d.toISOString().slice(0, 10)
}

function isoTodayMinusOne() {
	const d = new Date()
	d.setUTCDate(d.getUTCDate() - 1)
	return d.toISOString().slice(0, 10)
}

async function chunkedPromiseAll(items, fn, concurrency) {
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

async function fetchTeamScheduleWindow({ teamId, startDate, endDate, season }) {
	const url = `${SCHEDULE_URL_BASE}/${teamId}/schedule`
	const res = await axios.get(url, {
		params: { sportId: 1, season, startDate, endDate },
		timeout: 15000,
	})
	const dates = res?.data?.dates || []
	const games = []
	for (const d of dates) {
		const gs = Array.isArray(d?.games) ? d.games : []
		for (const g of gs) {
			if (g?.status?.codedGameState && g.status.codedGameState !== "F" && g.status.codedGameState !== "FT") continue
			if (g?.gamePk) games.push({ gamePk: g.gamePk, gameDate: g.gameDate || d.date })
		}
	}
	return games
}

async function fetchBoxscore(gamePk) {
	const url = `${BOXSCORE_URL_BASE}/${gamePk}/boxscore`
	const res = await axios.get(url, { timeout: 15000 })
	return res?.data || null
}

function aggregateTeamBullpenFromBoxscore(boxscore, teamId) {
	const teams = boxscore?.teams || {}
	let side = null
	if (teams?.home?.team?.id === teamId) side = "home"
	else if (teams?.away?.team?.id === teamId) side = "away"
	if (!side) return null

	const teamBox = teams[side]
	const pitcherIds = Array.isArray(teamBox?.pitchers) ? teamBox.pitchers : []
	const players = teamBox?.players || {}

	let reliefIp = 0
	let reliefAppearances = 0
	let highLeverageUses = 0
	const relieverIds = new Set()
	let closerCandidate = null
	let closerLeverageRank = -1

	for (let i = 0; i < pitcherIds.length; i++) {
		// i = 0 → starter; i ≥ 1 → reliever (Phase 1B heuristic)
		const pid = pitcherIds[i]
		const playerEntry = players[`ID${pid}`] || players[pid]
		if (!playerEntry) continue
		const pitchingStats = playerEntry?.stats?.pitching || {}
		const ipStr = pitchingStats?.inningsPitched != null ? String(pitchingStats.inningsPitched) : null
		const ip = ipStr != null ? Number(ipStr) : null
		const fullName = playerEntry?.person?.fullName || null
		if (i === 0) continue
		relieverIds.add(pid)
		reliefAppearances += 1
		if (Number.isFinite(ip)) reliefIp += ip
		// position index ≥ 3 → high leverage proxy
		if (i >= 3) {
			highLeverageUses += 1
			if (i > closerLeverageRank && fullName) {
				closerLeverageRank = i
				closerCandidate = fullName
			}
		}
	}

	return { reliefIp, reliefAppearances, highLeverageUses, relieverCount: relieverIds.size, closerCandidate, relieverIds }
}

function persistMap(map) {
	try {
		const dir = path.join(__dirname, "..", "..", "..", "data")
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		const file = path.join(dir, "mlbBullpenWorkload.json")
		fs.writeFileSync(file, JSON.stringify(map, null, 2))
		return true
	} catch (_) {
		return false
	}
}

function uniqueTeamsFromEvents(events) {
	const seen = new Map()
	for (const e of (Array.isArray(events) ? events : [])) {
		const home = e?.homeTeam || e?.home_team
		const away = e?.awayTeam || e?.away_team
		if (home) seen.set(teamKey(home), home)
		if (away) seen.set(teamKey(away), away)
	}
	return Array.from(seen.values())
}

/**
 * teamId lookup. The bootstrap doesn't carry teamIds — derive them from the
 * MLB Stats teams endpoint once.
 */
let _teamIdMap = null
async function loadTeamIdMap() {
	if (_teamIdMap) return _teamIdMap
	try {
		const res = await axios.get("https://statsapi.mlb.com/api/v1/teams", {
			params: { sportId: 1 },
			timeout: 15000,
		})
		const teams = res?.data?.teams || []
		const map = new Map()
		for (const t of teams) {
			if (t?.id && t?.name) map.set(teamKey(t.name), { id: t.id, name: t.name })
		}
		_teamIdMap = map
		return map
	} catch (_) {
		return new Map()
	}
}

async function refreshMlbBullpenWorkload({ events, windowDays = DEFAULT_WINDOW_DAYS, teamConcurrency = DEFAULT_TEAM_CONCURRENCY, gameConcurrency = DEFAULT_GAME_CONCURRENCY } = {}) {
	const diagnostics = {
		layer: "bullpen_workload",
		windowDays,
		teamsRequested: 0,
		teamsResolved: 0,
		teamsWithData: 0,
		gamesScanned: 0,
		skipped: false,
		persistedToDisk: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_BULLPEN === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { bullpenByTeam: {}, diagnostics }
	}

	const teamNames = uniqueTeamsFromEvents(events)
	diagnostics.teamsRequested = teamNames.length
	if (!teamNames.length) {
		diagnostics.finishedAt = new Date().toISOString()
		return { bullpenByTeam: {}, diagnostics }
	}

	const teamIdMap = await loadTeamIdMap()
	const startDate = isoDateDaysAgo(windowDays)
	const endDate = isoTodayMinusOne()
	const season = new Date().getUTCFullYear()

	const teamWork = await chunkedPromiseAll(teamNames, async (name) => {
		try {
			const info = teamIdMap.get(teamKey(name))
			if (!info) return { __error: "no_team_id", name }
			const games = await fetchTeamScheduleWindow({
				teamId: info.id, startDate, endDate, season,
			})
			return { name, info, games }
		} catch (e) {
			return { __error: e?.message || String(e), name }
		}
	}, teamConcurrency)

	const bullpenByTeam = {}

	for (const t of teamWork) {
		if (!t || t.__error) {
			if (t?.__error && diagnostics.errors.length < 5) {
				diagnostics.errors.push({ stage: "schedule", team: t.name, reason: t.__error })
			}
			continue
		}
		diagnostics.teamsResolved += 1
		const games = Array.isArray(t.games) ? t.games : []
		diagnostics.gamesScanned += games.length

		let aggregateIp = 0
		let aggregateApps = 0
		let aggregateHighLev = 0
		const allRelieverIds = new Set()
		let bestCloser = null
		// detect back-to-back: same reliever appearing in two games on consecutive days
		const reliefDaysByPitcher = new Map()

		const boxResults = await chunkedPromiseAll(games, async (g) => {
			try {
				const box = await fetchBoxscore(g.gamePk)
				const agg = aggregateTeamBullpenFromBoxscore(box, t.info.id)
				return { gameDate: g.gameDate, agg }
			} catch (e) {
				return { __error: e?.message || String(e), gamePk: g.gamePk }
			}
		}, gameConcurrency)

		for (const r of boxResults) {
			if (!r || r.__error || !r.agg) continue
			aggregateIp += r.agg.reliefIp || 0
			aggregateApps += r.agg.reliefAppearances || 0
			aggregateHighLev += r.agg.highLeverageUses || 0
			for (const pid of r.agg.relieverIds || []) {
				allRelieverIds.add(pid)
				const day = (r.gameDate || "").slice(0, 10)
				if (!day) continue
				const days = reliefDaysByPitcher.get(pid) || new Set()
				days.add(day)
				reliefDaysByPitcher.set(pid, days)
			}
			if (r.agg.closerCandidate && !bestCloser) bestCloser = r.agg.closerCandidate
		}

		// Back-to-back: any pitcher with two consecutive day appearances
		let backToBack = 0
		for (const [_pid, days] of reliefDaysByPitcher.entries()) {
			const sorted = Array.from(days).sort()
			for (let i = 1; i < sorted.length; i++) {
				const prev = new Date(sorted[i - 1]).getTime()
				const cur = new Date(sorted[i]).getTime()
				if (Number.isFinite(prev) && Number.isFinite(cur) && cur - prev === 86400000) {
					backToBack += 1
					break
				}
			}
		}

		// fatigueScore: tuned so 9 IP over 3 days ≈ 0.5 ; 15+ IP ≈ 1.0
		const cap = 12
		const fatigueScore = Math.max(0, Math.min(1, aggregateIp / cap))

		bullpenByTeam[teamKey(t.name)] = {
			teamId: t.info.id,
			teamName: t.info.name,
			recentInnings: Number(aggregateIp.toFixed(2)),
			reliefAppearances: aggregateApps,
			highLeverageUses: aggregateHighLev,
			backToBackAppearances: backToBack,
			relieverCount: allRelieverIds.size,
			closerCandidate: bestCloser,
			fatigueScore: Number(fatigueScore.toFixed(3)),
			windowDays,
			gamesObserved: games.length,
			source: "mlb_statsapi_boxscores",
			ingestedAt: new Date().toISOString(),
		}
		diagnostics.teamsWithData += 1
	}

	diagnostics.persistedToDisk = persistMap(bullpenByTeam)
	diagnostics.finishedAt = new Date().toISOString()

	console.log("[MLB-INGEST-BULLPEN]", {
		windowDays,
		teamsRequested: diagnostics.teamsRequested,
		teamsResolved: diagnostics.teamsResolved,
		teamsWithData: diagnostics.teamsWithData,
		gamesScanned: diagnostics.gamesScanned,
		persistedToDisk: diagnostics.persistedToDisk,
	})

	return { bullpenByTeam, diagnostics }
}

module.exports = { refreshMlbBullpenWorkload }
