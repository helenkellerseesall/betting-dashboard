"use strict"

/**
 * MLB Phase 2 — Live Bullpen State Refresh
 *
 * Augments Phase 1B's 3-day bullpen baseline with TODAY's intra-day usage:
 *   - in-progress games (codedGameState in I/M)
 *   - games completed today
 * For each slate team, sums relief IP from same-day appearances and detects
 * "exhaustion" by combining intra-day usage with baseline fatigue.
 *
 * The output map is keyed by lowercase team name, matching the lookup used
 * by deriveMlbBullpenContext. We do NOT replace the Phase 1B map — we
 * EXTEND it (per-team merge) so the same deriver path keeps working.
 *
 * Bounded:
 *   - Concurrency cap per fetch type
 *   - Per-call timeouts (15s)
 *   - Fail-open: any failure leaves a team out, never throws
 *
 * Kill switch: env MLB_CTX_SKIP_BULLPEN_LIVE=1
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")

const SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
const BOXSCORE_URL_BASE = "https://statsapi.mlb.com/api/v1/game"
const TEAMS_URL = "https://statsapi.mlb.com/api/v1/teams"
const DEFAULT_CONCURRENCY = 4

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
function teamKey(s) { return String(s || "").trim().toLowerCase() }
function isoToday() { return new Date().toISOString().slice(0, 10) }

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

let _teamIdMap = null
async function loadTeamIdMap() {
	if (_teamIdMap) return _teamIdMap
	try {
		const res = await axios.get(TEAMS_URL, { params: { sportId: 1 }, timeout: 15000 })
		const teams = res?.data?.teams || []
		const m = new Map()
		for (const t of teams) {
			if (t?.id && t?.name) m.set(teamKey(t.name), { id: t.id, name: t.name })
		}
		_teamIdMap = m
		return m
	} catch (_) { return new Map() }
}

function uniqueTeamsFromEvents(events) {
	const seen = new Map()
	for (const e of (Array.isArray(events) ? events : [])) {
		const h = e?.homeTeam || e?.home_team
		const a = e?.awayTeam || e?.away_team
		if (h) seen.set(teamKey(h), h)
		if (a) seen.set(teamKey(a), a)
	}
	return Array.from(seen.values())
}

async function fetchTodaysGames(dateKey) {
	const res = await axios.get(SCHEDULE_URL, {
		params: { sportId: 1, date: dateKey, hydrate: "linescore,team" },
		timeout: 15000,
	})
	const games = []
	for (const d of (res?.data?.dates || [])) {
		for (const g of (d?.games || [])) {
			const state = g?.status?.codedGameState
			// Include In-Progress (I), Manager Challenge (M), Final (F/FT), Game Over (O)
			if (!state) continue
			if (["P", "S", "PR", "PW", "C"].includes(state)) continue // postponed/canceled/scheduled
			games.push({
				gamePk: g?.gamePk,
				state,
				homeTeam: g?.teams?.home?.team?.name || null,
				awayTeam: g?.teams?.away?.team?.name || null,
				homeTeamId: g?.teams?.home?.team?.id || null,
				awayTeamId: g?.teams?.away?.team?.id || null,
				linescore: g?.linescore || null,
			})
		}
	}
	return games
}

async function fetchBoxscore(gamePk) {
	const url = `${BOXSCORE_URL_BASE}/${gamePk}/boxscore`
	const res = await axios.get(url, { timeout: 15000 })
	return res?.data || null
}

function reliefStatsForTeam(boxscore, teamId) {
	const teams = boxscore?.teams || {}
	let side = null
	if (teams?.home?.team?.id === teamId) side = "home"
	else if (teams?.away?.team?.id === teamId) side = "away"
	if (!side) return null

	const teamBox = teams[side]
	const pitcherIds = Array.isArray(teamBox?.pitchers) ? teamBox.pitchers : []
	const players = teamBox?.players || {}

	let intraDayIp = 0
	let intraDayAppearances = 0
	let intraDayHighLeverage = 0
	const intraDayRelievers = []

	for (let i = 0; i < pitcherIds.length; i++) {
		if (i === 0) continue // skip starter
		const pid = pitcherIds[i]
		const playerEntry = players[`ID${pid}`] || players[pid]
		if (!playerEntry) continue
		const pitchingStats = playerEntry?.stats?.pitching || {}
		const ipStr = pitchingStats?.inningsPitched != null ? String(pitchingStats.inningsPitched) : null
		const ip = ipStr != null ? Number(ipStr) : null
		const fullName = playerEntry?.person?.fullName || null
		intraDayAppearances += 1
		if (Number.isFinite(ip)) intraDayIp += ip
		if (i >= 3) intraDayHighLeverage += 1
		if (fullName) intraDayRelievers.push(fullName)
	}

	const innings = Number(boxscore?.info?.find?.((row) => /innings/i.test(row?.label))?.value) || null
	const extraInnings = Number.isFinite(innings) ? innings > 9 : null

	return {
		intraDayIp: Number(intraDayIp.toFixed(2)),
		intraDayAppearances,
		intraDayHighLeverageUses: intraDayHighLeverage,
		intraDayRelievers,
		extraInningsRecentlyPlayed: extraInnings,
	}
}

async function refreshMlbLiveBullpenState({ events, baselineBullpenByTeam, concurrency = DEFAULT_CONCURRENCY } = {}) {
	const diagnostics = {
		layer: "bullpen_live",
		teamsRequested: 0,
		gamesFetchedToday: 0,
		boxscoresScanned: 0,
		teamsAugmented: 0,
		skipped: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_BULLPEN_LIVE === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { liveBullpenByTeam: {}, diagnostics }
	}

	const teams = uniqueTeamsFromEvents(events)
	diagnostics.teamsRequested = teams.length
	if (!teams.length) {
		diagnostics.finishedAt = new Date().toISOString()
		return { liveBullpenByTeam: {}, diagnostics }
	}

	const teamIdMap = await loadTeamIdMap()
	const today = isoToday()

	let games = []
	try {
		games = await fetchTodaysGames(today)
		diagnostics.gamesFetchedToday = games.length
	} catch (e) {
		diagnostics.errors.push({ stage: "schedule_today", message: e?.message || String(e) })
	}

	// Filter to slate-team games only
	const slateTeamIds = new Set()
	for (const name of teams) {
		const info = teamIdMap.get(teamKey(name))
		if (info?.id) slateTeamIds.add(info.id)
	}
	const slateGames = games.filter((g) => slateTeamIds.has(g.homeTeamId) || slateTeamIds.has(g.awayTeamId))

	const liveBullpenByTeam = {}

	await chunkedPromiseAll(slateGames, async (g) => {
		try {
			const box = await fetchBoxscore(g.gamePk)
			diagnostics.boxscoresScanned += 1
			for (const side of ["home", "away"]) {
				const teamId = g[`${side}TeamId`]
				const teamName = g[`${side}Team`]
				if (!teamId || !teamName) continue
				const stats = reliefStatsForTeam(box, teamId)
				if (!stats) continue
				const k = teamKey(teamName)
				if (!liveBullpenByTeam[k]) {
					liveBullpenByTeam[k] = {
						teamId, teamName,
						intraDayIp: 0, intraDayAppearances: 0, intraDayHighLeverageUses: 0,
						intraDayRelievers: [],
						extraInningsRecentlyPlayed: false,
						gamesScanned: 0,
					}
				}
				liveBullpenByTeam[k].intraDayIp += stats.intraDayIp
				liveBullpenByTeam[k].intraDayAppearances += stats.intraDayAppearances
				liveBullpenByTeam[k].intraDayHighLeverageUses += stats.intraDayHighLeverageUses
				for (const r of stats.intraDayRelievers) {
					if (!liveBullpenByTeam[k].intraDayRelievers.includes(r)) liveBullpenByTeam[k].intraDayRelievers.push(r)
				}
				if (stats.extraInningsRecentlyPlayed === true) liveBullpenByTeam[k].extraInningsRecentlyPlayed = true
				liveBullpenByTeam[k].gamesScanned += 1
			}
			return { ok: true }
		} catch (e) {
			diagnostics.errors.push({ stage: "boxscore", gamePk: g.gamePk, message: e?.message || String(e) })
			return { __error: e?.message || String(e) }
		}
	}, concurrency)

	// Merge with Phase 1B baseline and emit exhaustion flag.
	const baseline = baselineBullpenByTeam || {}
	for (const k of Object.keys(liveBullpenByTeam)) {
		const live = liveBullpenByTeam[k]
		const base = baseline[k] || null
		const baselineFatigue = Number(base?.fatigueScore)
		const exhaustionFlag = (Number.isFinite(baselineFatigue) && baselineFatigue >= 0.6 && live.intraDayIp > 2)
		live.intraDayIp = Number(live.intraDayIp.toFixed(2))
		live.exhaustionFlag = exhaustionFlag
		live.baselineFatigueScore = Number.isFinite(baselineFatigue) ? Number(baselineFatigue.toFixed(3)) : null
		live.source = "mlb_statsapi_live_today"
		live.ingestedAt = new Date().toISOString()
	}

	diagnostics.teamsAugmented = Object.keys(liveBullpenByTeam).length
	diagnostics.finishedAt = new Date().toISOString()

	console.log("[MLB-INGEST-BULLPEN-LIVE]", {
		teamsRequested: diagnostics.teamsRequested,
		gamesFetchedToday: diagnostics.gamesFetchedToday,
		boxscoresScanned: diagnostics.boxscoresScanned,
		teamsAugmented: diagnostics.teamsAugmented,
	})

	return { liveBullpenByTeam, diagnostics }
}

module.exports = { refreshMlbLiveBullpenState }
