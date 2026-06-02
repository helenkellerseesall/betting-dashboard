"use strict"

/**
 * MLB Batter Stats Ingestion — 2026-05-30
 *
 * Closes the single biggest blind spot in MLB cognition:
 *   no per-batter HR/AB, ISO, K%, BB%, OBP/SLG, or batter handedness anywhere.
 *
 * For the live slate, fetches:
 *   - active rosters for every team playing that date (via /schedule hydrate)
 *   - per-batter season hitting stats in batched /people calls
 *
 * Produces a map keyed by normalized lowercase player name (matching the same
 * normalizeName util the HR engine uses to look up power score), each entry:
 *
 *   playerId
 *   fullName
 *   batSide                 — "L" | "R" | "S" (switch)
 *   throws                  — "L" | "R" (for completeness, rarely used downstream)
 *   position                — "1B" | "OF" | etc. (positionCode)
 *   teamId
 *   teamName
 *   season                  — year string
 *   gamesPlayed
 *   atBats
 *   plateAppearances
 *   hits
 *   doubles
 *   triples
 *   homeRuns
 *   rbi
 *   runs
 *   baseOnBalls
 *   strikeOuts
 *   stolenBases
 *   totalBases
 *   avg                     — hits / AB
 *   obp                     — on-base %
 *   slg                     — slugging
 *   ops                     — obp + slg
 *   iso                     — slg - avg (isolated power)
 *   kRate                   — K / PA
 *   bbRate                  — BB / PA
 *   hrRate                  — HR / AB  (key signal for HR engine)
 *   xbhRate                 — (2B + 3B + HR) / AB
 *   source                  — "mlb_statsapi_season"
 *   ingestedAt
 *
 * Bounded behavior:
 *   - schedule call once, then 1 batch /people call per ~50 batter IDs
 *   - per-call timeout 15s
 *   - fail-open: any failed call drops only its batch; succeeded batches persist
 *
 * Kill switch: env MLB_CTX_SKIP_BATTERS=1
 *
 * Persisted file: backend/data/mlbBatterStats.json
 *
 * Lookup pattern (downstream engines):
 *   const map = require("../../data/mlbBatterStats.json")
 *   const normalized = {}
 *   for (const k of Object.keys(map)) normalized[normalizeName(k)] = map[k]
 *   const entry = normalized[normalizeName(row.player)]
 *   row.batterHand = entry?.batSide || row.batterHand
 *   row.batterHrRate = entry?.hrRate
 *   row.batterIso = entry?.iso
 *   ... etc.
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")
const normalizeName = require("../../../utils/normalizeName")
const { currentSlateDateEt } = require("../../shared/slateDate")

const SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
const PEOPLE_URL = "https://statsapi.mlb.com/api/v1/people"
const ROSTER_URL_BASE = "https://statsapi.mlb.com/api/v1/teams"
const BATCH_SIZE = 50
const ROSTER_CONCURRENCY = 5

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function deriveSlateDate(date) {
	if (date) return String(date).slice(0, 10)
	// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
	return currentSlateDateEt()
}

async function fetchTeamsPlayingOnDate(date) {
	const res = await axios.get(SCHEDULE_URL, {
		params: { sportId: 1, date },
		timeout: 15000,
	})
	const games = res?.data?.dates?.[0]?.games || []
	const teams = []
	const seenTeamIds = new Set()
	for (const g of games) {
		for (const side of ["home", "away"]) {
			const team = g?.teams?.[side]?.team
			if (!team?.id) continue
			if (seenTeamIds.has(team.id)) continue
			seenTeamIds.add(team.id)
			teams.push({ teamId: Number(team.id), teamName: team.name || null })
		}
	}
	return teams
}

async function fetchTeamRoster(teamId) {
	const url = `${ROSTER_URL_BASE}/${teamId}/roster`
	const res = await axios.get(url, {
		params: { rosterType: "active" },
		timeout: 15000,
	})
	return res?.data?.roster || []
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

async function collectBatters(teams) {
	const rosters = await chunkedPromiseAll(teams, async (t) => {
		const roster = await fetchTeamRoster(t.teamId)
		return { team: t, roster }
	}, ROSTER_CONCURRENCY)

	const out = []
	const seenPersonIds = new Set()
	for (const r of rosters) {
		if (!r || r.__error) continue
		const { team, roster } = r
		for (const slot of roster) {
			const person = slot?.person
			const positionCode = slot?.position?.code || null
			const positionType = slot?.position?.type || null
			if (!person?.id) continue
			// Filter pitchers — they live in mlbPitcherStats.json. positionCode "1" = pitcher.
			if (positionType === "Pitcher" || positionCode === "1" || positionCode === "P") continue
			if (seenPersonIds.has(person.id)) continue
			seenPersonIds.add(person.id)
			out.push({
				playerId: Number(person.id),
				fullName: person.fullName || null,
				teamId: team.teamId,
				teamName: team.teamName,
				positionCode,
				positionType,
			})
		}
	}
	return out
}

function extractSeasonHittingAndBio(person, season) {
	const statsArr = Array.isArray(person?.stats) ? person.stats : []
	let target = null
	for (const block of statsArr) {
		const grp = block?.group?.displayName?.toLowerCase()
		if (grp !== "hitting") continue
		const splits = Array.isArray(block?.splits) ? block.splits : []
		for (const sp of splits) {
			if (!target) target = sp
			if (String(sp?.season || "") === String(season)) {
				target = sp
				break
			}
		}
		if (target) break
	}
	const s = target?.stat || {}

	const atBats = toNum(s.atBats)
	const plateAppearances = toNum(s.plateAppearances)
	const hits = toNum(s.hits)
	const doubles = toNum(s.doubles)
	const triples = toNum(s.triples)
	const homeRuns = toNum(s.homeRuns)
	const rbi = toNum(s.rbi)
	const runs = toNum(s.runs)
	const baseOnBalls = toNum(s.baseOnBalls)
	const strikeOuts = toNum(s.strikeOuts)
	const stolenBases = toNum(s.stolenBases)
	const totalBases = toNum(s.totalBases)
	const gamesPlayed = toNum(s.gamesPlayed)

	const avg = (atBats && atBats > 0) ? hits / atBats : null
	const obp = toNum(s.obp) ?? (
		(plateAppearances && plateAppearances > 0 && hits != null && baseOnBalls != null)
			? (hits + baseOnBalls) / plateAppearances : null
	)
	const slg = (atBats && atBats > 0 && totalBases != null) ? totalBases / atBats : null
	const ops = (obp != null && slg != null) ? obp + slg : null
	const iso = (slg != null && avg != null) ? slg - avg : null
	const kRate = (plateAppearances && plateAppearances > 0 && strikeOuts != null)
		? strikeOuts / plateAppearances : null
	const bbRate = (plateAppearances && plateAppearances > 0 && baseOnBalls != null)
		? baseOnBalls / plateAppearances : null
	const hrRate = (atBats && atBats > 0 && homeRuns != null) ? homeRuns / atBats : null
	const xbhRate = (atBats && atBats > 0 && doubles != null && triples != null && homeRuns != null)
		? (doubles + triples + homeRuns) / atBats : null

	return {
		batSide: person?.batSide?.code || null,
		throws: person?.pitchHand?.code || null,
		season: String(target?.season ?? season),
		gamesPlayed,
		atBats,
		plateAppearances,
		hits,
		doubles,
		triples,
		homeRuns,
		rbi,
		runs,
		baseOnBalls,
		strikeOuts,
		stolenBases,
		totalBases,
		avg: avg != null ? Number(avg.toFixed(4)) : null,
		obp: obp != null ? Number(obp.toFixed(4)) : null,
		slg: slg != null ? Number(slg.toFixed(4)) : null,
		ops: ops != null ? Number(ops.toFixed(4)) : null,
		iso: iso != null ? Number(iso.toFixed(4)) : null,
		kRate: kRate != null ? Number(kRate.toFixed(4)) : null,
		bbRate: bbRate != null ? Number(bbRate.toFixed(4)) : null,
		hrRate: hrRate != null ? Number(hrRate.toFixed(4)) : null,
		xbhRate: xbhRate != null ? Number(xbhRate.toFixed(4)) : null,
	}
}

async function fetchBatchSeasonStats(batters, season) {
	if (!batters.length) return []
	const personIds = batters.map(b => b.playerId).join(",")
	const res = await axios.get(PEOPLE_URL, {
		params: {
			personIds,
			hydrate: `stats(type=season,group=hitting,season=${season})`,
		},
		timeout: 15000,
	})
	const people = res?.data?.people || []
	const byId = new Map()
	for (const p of people) byId.set(Number(p.id), p)
	const out = []
	for (const b of batters) {
		const p = byId.get(b.playerId)
		if (!p) {
			out.push({ __error: "no_person", batter: b })
			continue
		}
		const stats = extractSeasonHittingAndBio(p, season)
		// Skip players with no PA — bench guys / call-ups with no track record.
		if (!stats.plateAppearances || stats.plateAppearances < 1) {
			out.push({ __error: "no_pa", batter: b, stats })
			continue
		}
		out.push({ batter: b, stats })
	}
	return out
}

function persistMap(map) {
	try {
		const dir = path.join(__dirname, "..", "..", "..", "data")
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		const file = path.join(dir, "mlbBatterStats.json")
		fs.writeFileSync(file, JSON.stringify(map, null, 2))
		return true
	} catch (_) {
		return false
	}
}

async function refreshMlbBatterStats({ slateDate, season } = {}) {
	const diagnostics = {
		layer: "batter_stats",
		slateDate: null,
		season: null,
		teamsFound: 0,
		battersFound: 0,
		statsFetched: 0,
		skippedNoPA: 0,
		failed: 0,
		batches: 0,
		skipped: false,
		persistedToDisk: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_BATTERS === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { batterStatsByName: {}, diagnostics }
	}

	const date = deriveSlateDate(slateDate)
	const seasonResolved = season ? String(season) : String(new Date(date).getUTCFullYear())
	diagnostics.slateDate = date
	diagnostics.season = seasonResolved

	let teams = []
	try {
		teams = await fetchTeamsPlayingOnDate(date)
	} catch (e) {
		diagnostics.errors.push({ stage: "schedule", message: e?.message || String(e) })
		diagnostics.finishedAt = new Date().toISOString()
		return { batterStatsByName: {}, diagnostics }
	}
	diagnostics.teamsFound = teams.length

	let batters = []
	try {
		batters = await collectBatters(teams)
	} catch (e) {
		diagnostics.errors.push({ stage: "rosters", message: e?.message || String(e) })
		diagnostics.finishedAt = new Date().toISOString()
		return { batterStatsByName: {}, diagnostics }
	}
	diagnostics.battersFound = batters.length

	const batterStatsByName = {}
	for (let i = 0; i < batters.length; i += BATCH_SIZE) {
		const chunk = batters.slice(i, i + BATCH_SIZE)
		diagnostics.batches += 1
		let results = []
		try {
			results = await fetchBatchSeasonStats(chunk, seasonResolved)
		} catch (e) {
			diagnostics.failed += chunk.length
			if (diagnostics.errors.length < 5) {
				diagnostics.errors.push({ stage: "people_batch", batchIndex: i / BATCH_SIZE, reason: e?.message || String(e) })
			}
			continue
		}
		for (const r of results) {
			if (r.__error === "no_person") {
				diagnostics.failed += 1
				continue
			}
			if (r.__error === "no_pa") {
				diagnostics.skippedNoPA += 1
				continue
			}
			const key = normalizeName(r.batter?.fullName)
			if (!key) continue
			batterStatsByName[key] = {
				playerId: r.batter.playerId,
				fullName: r.batter.fullName,
				teamId: r.batter.teamId,
				teamName: r.batter.teamName,
				positionCode: r.batter.positionCode,
				...r.stats,
				source: "mlb_statsapi_season",
				ingestedAt: new Date().toISOString(),
			}
			diagnostics.statsFetched += 1
		}
	}

	diagnostics.persistedToDisk = persistMap(batterStatsByName)
	diagnostics.finishedAt = new Date().toISOString()

	console.log("[MLB-INGEST-BATTERS]", {
		slateDate: date,
		season: seasonResolved,
		batters: diagnostics.battersFound,
		fetched: diagnostics.statsFetched,
		skippedNoPA: diagnostics.skippedNoPA,
		failed: diagnostics.failed,
		batches: diagnostics.batches,
		persistedToDisk: diagnostics.persistedToDisk,
	})

	return { batterStatsByName, diagnostics }
}

module.exports = { refreshMlbBatterStats }
