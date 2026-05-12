"use strict"

/**
 * MLB Phase 1B — Real Pitcher Stats Ingestion
 *
 * For the live slate, fetches:
 *   - probable pitchers via /api/v1/schedule (already has player IDs)
 *   - per-pitcher season stats via /api/v1/people/{id}?hydrate=stats(...)
 *
 * Produces a map keyed by normalized pitcher name (matching the lookup in
 * deriveMlbPitcherEnvironmentContext.lookupPitcherStats), each entry:
 *
 *   playerId
 *   fullName
 *   teamId
 *   throws                  — "L" | "R"
 *   season                  — year string
 *   gamesPitched
 *   gamesStarted
 *   inningsPitched          — total IP (decimal)
 *   battersFaced
 *   strikeOuts
 *   walks
 *   hits
 *   earnedRuns
 *   homeRunsAllowed
 *   pitchCount              — total season pitches (when available)
 *   kRate                   — strikeOuts / battersFaced  (0..1)
 *   bbRate                  — walks / battersFaced
 *   k9                      — strikeOuts * 9 / innings
 *   whip                    — (walks + hits) / innings
 *   era
 *   recentPitches           — null in Phase 1B (we don't fetch last-game boxscore
 *                             here; that is deferred to refreshMlbBullpenWorkload
 *                             which already fetches recent boxscores)
 *   restDays                — null in Phase 1B (computed by bullpen module if needed)
 *   velocityMph             — null (not in season stats endpoint; would require
 *                             Statcast which is a heavier integration)
 *   source                  — "mlb_statsapi_season"
 *
 * Bounded behavior:
 *   - chunked concurrency 5
 *   - per-pitcher timeout 15s
 *   - global timeout via wrapper
 *   - fail-open: missing pitcher → no entry; still returns what succeeded
 *
 * Kill switch: env MLB_CTX_SKIP_PITCHERS=1
 */

const fs = require("fs")
const path = require("path")
const axios = require("axios")

const SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
const PERSON_URL_BASE = "https://statsapi.mlb.com/api/v1/people"
const DEFAULT_CONCURRENCY = 5

function toNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function normalizePitcherKey(name) {
	if (!name) return null
	return String(name)
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z\s'-]/g, "")
		.replace(/\s+/g, " ")
		.trim()
}

function deriveSlateDate(date) {
	if (date) return String(date).slice(0, 10)
	const d = new Date()
	return d.toISOString().slice(0, 10)
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

async function fetchProbablePitchersForDate(date) {
	const res = await axios.get(SCHEDULE_URL, {
		params: { sportId: 1, date, hydrate: "probablePitcher,team" },
		timeout: 15000,
	})
	const games = res?.data?.dates?.[0]?.games || []
	const out = []
	for (const g of games) {
		for (const side of ["home", "away"]) {
			const pitcher = g?.teams?.[side]?.probablePitcher
			if (!pitcher?.id) continue
			out.push({
				playerId: Number(pitcher.id),
				fullName: pitcher.fullName || null,
				throws: pitcher.pitchHand?.code || null,
				teamId: g?.teams?.[side]?.team?.id ?? null,
				teamName: g?.teams?.[side]?.team?.name || null,
				gamePk: g?.gamePk || null,
				side,
			})
		}
	}
	// de-dup by playerId
	const seen = new Set()
	const deduped = []
	for (const p of out) {
		if (seen.has(p.playerId)) continue
		seen.add(p.playerId)
		deduped.push(p)
	}
	return deduped
}

function extractSeasonPitchingStats(personJson, season) {
	const person = personJson?.people?.[0]
	if (!person) return null

	const statsArr = Array.isArray(person?.stats) ? person.stats : []
	// Prefer a season-group=pitching, season=YYYY block; fall back to the first pitching season we find.
	let target = null
	for (const block of statsArr) {
		const grp = block?.group?.displayName?.toLowerCase()
		if (grp !== "pitching") continue
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
	const stats = target?.stat || null
	if (!stats) return null

	const inningsPitchedRaw = stats.inningsPitched
	const inningsPitched = inningsPitchedRaw != null ? Number(String(inningsPitchedRaw)) : null

	const strikeOuts = toNum(stats.strikeOuts)
	const battersFaced = toNum(stats.battersFaced)
	const walks = toNum(stats.baseOnBalls)
	const hits = toNum(stats.hits)
	const earnedRuns = toNum(stats.earnedRuns)
	const homeRunsAllowed = toNum(stats.homeRuns)
	const era = toNum(stats.era)
	const pitchCount = toNum(stats.pitchesThrown)
	const gamesPitched = toNum(stats.gamesPitched)
	const gamesStarted = toNum(stats.gamesStarted)

	const kRate = (strikeOuts != null && battersFaced != null && battersFaced > 0)
		? strikeOuts / battersFaced : null
	const bbRate = (walks != null && battersFaced != null && battersFaced > 0)
		? walks / battersFaced : null
	const k9 = (strikeOuts != null && inningsPitched != null && inningsPitched > 0)
		? (strikeOuts * 9 / inningsPitched) : null
	const whip = (walks != null && hits != null && inningsPitched != null && inningsPitched > 0)
		? ((walks + hits) / inningsPitched) : null

	return {
		season: String(target?.season ?? season),
		gamesPitched,
		gamesStarted,
		inningsPitched,
		battersFaced,
		strikeOuts,
		walks,
		hits,
		earnedRuns,
		homeRunsAllowed,
		pitchCount,
		kRate: kRate != null ? Number(kRate.toFixed(4)) : null,
		bbRate: bbRate != null ? Number(bbRate.toFixed(4)) : null,
		k9: k9 != null ? Number(k9.toFixed(2)) : null,
		whip: whip != null ? Number(whip.toFixed(2)) : null,
		era,
	}
}

async function fetchSeasonStatsForPitcher({ playerId, season }) {
	const url = `${PERSON_URL_BASE}/${playerId}`
	const res = await axios.get(url, {
		params: { hydrate: `stats(type=season,season=${season})` },
		timeout: 15000,
	})
	return extractSeasonPitchingStats(res?.data, season)
}

function persistMap(map) {
	try {
		const dir = path.join(__dirname, "..", "..", "..", "data")
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		const file = path.join(dir, "mlbPitcherStats.json")
		fs.writeFileSync(file, JSON.stringify(map, null, 2))
		return true
	} catch (_) {
		return false
	}
}

async function refreshMlbPitcherStats({ slateDate, season, concurrency = DEFAULT_CONCURRENCY } = {}) {
	const diagnostics = {
		layer: "pitcher_stats",
		slateDate: null,
		season: null,
		probablesFound: 0,
		statsFetched: 0,
		failed: 0,
		skipped: false,
		persistedToDisk: false,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		errors: [],
	}

	if (process.env.MLB_CTX_SKIP_PITCHERS === "1") {
		diagnostics.skipped = true
		diagnostics.finishedAt = new Date().toISOString()
		return { pitcherStatsByName: {}, diagnostics }
	}

	const date = deriveSlateDate(slateDate)
	const seasonResolved = season ? String(season) : String(new Date(date).getUTCFullYear())
	diagnostics.slateDate = date
	diagnostics.season = seasonResolved

	let probables = []
	try {
		probables = await fetchProbablePitchersForDate(date)
	} catch (e) {
		diagnostics.errors.push({ stage: "schedule", message: e?.message || String(e) })
		diagnostics.finishedAt = new Date().toISOString()
		return { pitcherStatsByName: {}, diagnostics }
	}
	diagnostics.probablesFound = probables.length

	const results = await chunkedPromiseAll(probables, async (p) => {
		try {
			const stats = await fetchSeasonStatsForPitcher({ playerId: p.playerId, season: seasonResolved })
			if (!stats) return { __error: "no_stats_block", pitcher: p }
			return { pitcher: p, stats }
		} catch (e) {
			return { __error: e?.message || String(e), pitcher: p }
		}
	}, concurrency)

	const pitcherStatsByName = {}
	for (const r of results) {
		if (!r) continue
		if (r.__error) {
			diagnostics.failed += 1
			if (diagnostics.errors.length < 5) {
				diagnostics.errors.push({ stage: "season", pitcher: r.pitcher?.fullName, reason: r.__error })
			}
			continue
		}
		const key = normalizePitcherKey(r.pitcher?.fullName)
		if (!key) continue
		pitcherStatsByName[key] = {
			playerId: r.pitcher.playerId,
			fullName: r.pitcher.fullName,
			throws: r.pitcher.throws,
			teamId: r.pitcher.teamId,
			teamName: r.pitcher.teamName,
			...r.stats,
			recentPitches: null,
			restDays: null,
			velocityMph: null,
			source: "mlb_statsapi_season",
			ingestedAt: new Date().toISOString(),
		}
		diagnostics.statsFetched += 1
	}

	diagnostics.persistedToDisk = persistMap(pitcherStatsByName)
	diagnostics.finishedAt = new Date().toISOString()

	console.log("[MLB-INGEST-PITCHERS]", {
		slateDate: date,
		season: seasonResolved,
		probables: diagnostics.probablesFound,
		fetched: diagnostics.statsFetched,
		failed: diagnostics.failed,
		persistedToDisk: diagnostics.persistedToDisk,
	})

	return { pitcherStatsByName, diagnostics }
}

module.exports = { refreshMlbPitcherStats, normalizePitcherKey }
