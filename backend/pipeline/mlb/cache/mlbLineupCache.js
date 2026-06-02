"use strict"

/**
 * mlbLineupCache.js — Phase MLB-Lineup-Cache-1A (2026-06-02)
 *
 * Persistent same-day cache for MLB lineup data fetched by
 * fetchMlbStatsApiLineups + fetchMlbApiSportsScaffold.
 *
 * WHY this exists:
 *   Every slate fire previously called the adapter inline with no
 *   persistence. When fire N+1 hit a rate limit / transient API error /
 *   different timing window, all lineup data fire N had pulled was LOST
 *   for that fire. tracked_bets entries written by fire N+1 had
 *   lineupPosition=null even though we had the data hours earlier.
 *
 *   2026-06-01 evening snapshot: 46/172 (27%) of MLB tracked_best
 *   entries had lineupSpot. Cause: half the slate fires had been hitting
 *   adapter failures and 0% of those fires' entries got lineup data.
 *
 * Shape on disk (backend/data/mlbLineupCache.json):
 *   {
 *     slateDate: "YYYY-MM-DD",          // canonical ET slate date this cache belongs to
 *     writtenAt: "ISO timestamp",       // last write
 *     playersByEventId: {
 *       "<eventId>": [ {playerId, name, lineupPosition, team, ...}, ... ]
 *     },
 *     lineupConfirmationByEventId: {
 *       "<eventId>": { confirmed: bool, source: "..." }
 *     }
 *   }
 *
 * Anti-fabrication rules:
 *   - Read returns empty if cache.slateDate ≠ current slate date (no
 *     stale cross-day data)
 *   - Read returns empty if cache file is malformed/missing (silent
 *     pass-through; never invents)
 *   - Write only persists data the adapter actually returned (never
 *     constructs synthetic entries)
 *   - mergeIntoFresh prefers FRESH adapter data over cached (live always
 *     wins; cache fills gaps only)
 *
 * Read pattern (in mergeMlbExternalContext):
 *   1. Get fresh data from adapter
 *   2. Load cache for current slate date
 *   3. For any eventId in cache that's NOT in fresh data → add from cache
 *   4. Process merged dataset normally
 *
 * Write pattern (in fetchMlbApiSportsScaffold after fallback):
 *   1. Adapter returns fresh data for all events it could fetch
 *   2. Load existing cache for current slate date
 *   3. Merge fresh INTO cache (fresh wins on conflict)
 *   4. Persist atomically
 */

const fs = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../../shared/slateDate")

const CACHE_PATH = path.join(__dirname, "..", "..", "..", "data", "mlbLineupCache.json")

function safeReadJson(p) {
	try {
		if (!fs.existsSync(p)) return null
		return JSON.parse(fs.readFileSync(p, "utf8"))
	} catch (_) {
		return null
	}
}

function writeAtomic(p, data) {
	try {
		const dir = path.dirname(p)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
		fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
		fs.renameSync(tmp, p)
		return true
	} catch (e) {
		console.warn("[mlbLineupCache] write failed:", e?.message || e)
		return false
	}
}

/**
 * Load lineup cache IF AND ONLY IF it belongs to the current slate date.
 * Returns {playersByEventId, lineupConfirmationByEventId} or empty objects.
 * Anti-fabrication: cross-day entries silently discarded — never returned.
 */
function loadCacheForCurrentSlate() {
	const cache = safeReadJson(CACHE_PATH)
	if (!cache || typeof cache !== "object") {
		return { playersByEventId: {}, lineupConfirmationByEventId: {}, slateDate: null, writtenAt: null, eventCount: 0 }
	}
	const today = currentSlateDateEt()
	if (cache.slateDate !== today) {
		return { playersByEventId: {}, lineupConfirmationByEventId: {}, slateDate: null, writtenAt: null, eventCount: 0 }
	}
	const playersByEventId = cache.playersByEventId && typeof cache.playersByEventId === "object" ? cache.playersByEventId : {}
	const lineupConfirmationByEventId = cache.lineupConfirmationByEventId && typeof cache.lineupConfirmationByEventId === "object" ? cache.lineupConfirmationByEventId : {}
	return {
		playersByEventId,
		lineupConfirmationByEventId,
		slateDate: cache.slateDate,
		writtenAt: cache.writtenAt,
		eventCount: Object.keys(playersByEventId).length,
	}
}

/**
 * Merge fresh adapter data into the persisted cache, fresh-wins on
 * conflicts. Only writes if there's actual new data (no-op if fresh is
 * empty AND cache is empty).
 *
 * Returns { written: bool, mergedEventCount: number, diagnostics: {...} }
 */
function persistFreshIntoCache({ playersByEventId = {}, lineupConfirmationByEventId = {} } = {}) {
	const today = currentSlateDateEt()
	const existing = loadCacheForCurrentSlate()

	// Merge: fresh wins where both have data
	const mergedPlayers = { ...existing.playersByEventId, ...playersByEventId }
	const mergedConf    = { ...existing.lineupConfirmationByEventId, ...lineupConfirmationByEventId }

	const eventsAdded = Object.keys(playersByEventId).filter(eid => !existing.playersByEventId[eid]).length
	const eventsUpdated = Object.keys(playersByEventId).filter(eid => existing.playersByEventId[eid]).length
	const eventsPreservedFromCache = Object.keys(existing.playersByEventId).filter(eid => !playersByEventId[eid]).length

	// Nothing to persist
	if (Object.keys(mergedPlayers).length === 0) {
		return { written: false, mergedEventCount: 0, diagnostics: { reason: "no_data" } }
	}

	const next = {
		slateDate: today,
		writtenAt: new Date().toISOString(),
		playersByEventId: mergedPlayers,
		lineupConfirmationByEventId: mergedConf,
	}

	const written = writeAtomic(CACHE_PATH, next)
	return {
		written,
		mergedEventCount: Object.keys(mergedPlayers).length,
		diagnostics: { eventsAdded, eventsUpdated, eventsPreservedFromCache, slateDate: today, cachePath: CACHE_PATH },
	}
}

/**
 * Take fresh adapter output, fill any missing eventIds from cache.
 * Returns { playersByEventId, lineupConfirmationByEventId, diagnostics }.
 *
 * Live data ALWAYS wins for events the adapter successfully fetched —
 * cache only fills events the adapter MISSED.
 */
function mergeCacheIntoFresh({ playersByEventId = {}, lineupConfirmationByEventId = {} } = {}) {
	const cached = loadCacheForCurrentSlate()
	const filledFromCache = []

	const mergedPlayers = { ...playersByEventId }
	for (const [eventId, players] of Object.entries(cached.playersByEventId)) {
		if (!mergedPlayers[eventId] || (Array.isArray(mergedPlayers[eventId]) && mergedPlayers[eventId].length === 0)) {
			mergedPlayers[eventId] = players
			filledFromCache.push(eventId)
		}
	}

	const mergedConf = { ...lineupConfirmationByEventId }
	for (const [eventId, conf] of Object.entries(cached.lineupConfirmationByEventId)) {
		if (!mergedConf[eventId]) mergedConf[eventId] = conf
	}

	return {
		playersByEventId: mergedPlayers,
		lineupConfirmationByEventId: mergedConf,
		diagnostics: {
			freshEventCount: Object.keys(playersByEventId).length,
			cachedEventCount: cached.eventCount,
			filledFromCacheCount: filledFromCache.length,
			filledEventIds: filledFromCache,
			cacheSlateDate: cached.slateDate,
			cacheWrittenAt: cached.writtenAt,
		},
	}
}

module.exports = {
	loadCacheForCurrentSlate,
	persistFreshIntoCache,
	mergeCacheIntoFresh,
	CACHE_PATH,
}
