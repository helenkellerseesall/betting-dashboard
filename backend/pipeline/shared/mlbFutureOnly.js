"use strict"

/**
 * MLB Future-Only Filtering — canonical helper for predictive-integrity hardening.
 *
 * Single source of truth for "is this event/row eligible for future-only
 * snapshot generation?" Replaces inline `>= now` / `> now` comparisons that
 * had drifted out of sync between sport modules.
 *
 * Architectural rules honored:
 *   - Pure functions; no I/O, no module-load side effects.
 *   - UTC-safe: every comparison is normalized to millisecond epochs via
 *     `Date(x).getTime()` — ISO strings, numeric epoch, and Date instances
 *     all collapse to the same comparable value.
 *   - Deterministic: strict `> nowMs` (NOT `>= nowMs`). A game whose
 *     commence_time equals `now` is treated as STARTED.
 *   - Truthful nulls: a row/event with no usable timestamp is EXCLUDED
 *     (never silently kept), and counted in diagnostics as
 *     `excludedWithoutTimestamp`.
 *   - Configurable grace: env `MLB_FUTURE_GRACE_MS` shifts the boundary
 *     forward by N milliseconds (default 0). Useful only when the upstream
 *     source rounds commence_time to coarse minutes. Anything > 60_000ms
 *     defeats the purpose of the filter — capped at 60_000.
 *
 * Replay safety:
 *   - The filter operates on a caller-supplied `nowMs`. Callers in replay
 *     mode MUST supply the historical `nowMs` of the replay frame so the
 *     filter reproduces the same eligibility set deterministically.
 *
 * Public API:
 *   getNowMs(opts?)                   → resolves the canonical `now` ms
 *   getEventCommenceMs(event)         → ms epoch of game-time, or null
 *   getRowCommenceMs(row)             → same, for row objects
 *   isFutureOnlyEvent(event, nowMs)   → boolean (strict >; honors grace)
 *   isFutureOnlyRow(row, nowMs)       → boolean
 *   filterFutureOnlyEvents(events, opts) → { kept, dropped, diagnostics }
 *   filterFutureOnlyRows(rows, opts)     → { kept, dropped, diagnostics }
 *   summarizeFutureFilter(...)        → diagnostics envelope
 *
 * Diagnostics shape:
 *   {
 *     phase: "mlb-future-only-filter-v1",
 *     futureFilterTimestamp,          // ISO of nowMs used
 *     futureFilterNowMs,
 *     futureGraceMs,
 *     timezoneContext: "UTC_ms_epoch",
 *     totalConsidered,
 *     futureEligibleGames,            // kept count
 *     filteredStartedGames,           // dropped count, finite ms but <= now
 *     excludedWithoutTimestamp,       // dropped count, no usable timestamp
 *     excludedGameIds,                // up to 50 ids of dropped events
 *     boundaryStrictness: "strict_gt",
 *   }
 */

const MAX_GRACE_MS = 60_000

function safeInt(v) {
	const n = Number(v)
	return Number.isFinite(n) ? Math.trunc(n) : null
}

function readGraceMs() {
	const raw = safeInt(process.env.MLB_FUTURE_GRACE_MS)
	if (raw == null) return 0
	if (raw < 0) return 0
	if (raw > MAX_GRACE_MS) return MAX_GRACE_MS
	return raw
}

function getNowMs(opts) {
	if (opts && Number.isFinite(opts.nowMs)) return Math.trunc(opts.nowMs)
	if (opts && opts.now != null) {
		const t = opts.now instanceof Date ? opts.now.getTime() : new Date(opts.now).getTime()
		if (Number.isFinite(t)) return t
	}
	return Date.now()
}

function toMs(v) {
	if (v == null) return null
	if (typeof v === "number" && Number.isFinite(v)) return v
	const t = new Date(v).getTime()
	return Number.isFinite(t) ? t : null
}

function getEventCommenceMs(event) {
	if (!event || typeof event !== "object") return null
	// Source priority: explicit gameTime → commenceTime → commence_time →
	// startTime → gameDate. The first non-null usable value wins.
	const candidates = [
		event?.gameTime,
		event?.commenceTime,
		event?.commence_time,
		event?.startTime,
		event?.gameDate,
	]
	for (const c of candidates) {
		const t = toMs(c)
		if (t != null) return t
	}
	return null
}

function getRowCommenceMs(row) {
	if (!row || typeof row !== "object") return null
	const candidates = [
		row?.gameTime,
		row?.commenceTime,
		row?.commence_time,
		row?.startTime,
	]
	for (const c of candidates) {
		const t = toMs(c)
		if (t != null) return t
	}
	return null
}

function getEventId(event) {
	if (!event || typeof event !== "object") return null
	const id = event?.eventId ?? event?.id ?? event?.event_id ?? event?.game_id ?? event?.gamePk
	if (id == null) return null
	const s = String(id).trim()
	return s.length ? s : null
}

function getRowEventId(row) {
	if (!row || typeof row !== "object") return null
	const id = row?.eventId ?? row?.event_id ?? row?.gameId ?? row?.game_id
	if (id == null) return null
	const s = String(id).trim()
	return s.length ? s : null
}

/**
 * Strict future-only boundary check.
 *   STRICT: `t > nowMs + graceMs`
 * A game at `t == nowMs` is treated as STARTED (excluded). This is the
 * canonical semantic across the repo. NBA `buildSlateEvents.js` already
 * uses this rule — MLB now matches.
 */
function isFutureOnlyEvent(event, nowMs, graceMs) {
	const t = getEventCommenceMs(event)
	if (!Number.isFinite(t)) return false
	const n = Number.isFinite(nowMs) ? nowMs : Date.now()
	const g = Number.isFinite(graceMs) ? graceMs : readGraceMs()
	return t > n + g
}

function isFutureOnlyRow(row, nowMs, graceMs) {
	const t = getRowCommenceMs(row)
	if (!Number.isFinite(t)) return false
	const n = Number.isFinite(nowMs) ? nowMs : Date.now()
	const g = Number.isFinite(graceMs) ? graceMs : readGraceMs()
	return t > n + g
}

function summarizeFutureFilter({
	nowMs,
	graceMs,
	totalConsidered,
	keptCount,
	startedDroppedIds,
	noTimestampDroppedIds,
}) {
	const droppedIds = []
	const seen = new Set()
	for (const arr of [startedDroppedIds, noTimestampDroppedIds]) {
		for (const id of arr) {
			if (id == null) continue
			const s = String(id)
			if (seen.has(s)) continue
			seen.add(s)
			droppedIds.push(s)
			if (droppedIds.length >= 50) break
		}
		if (droppedIds.length >= 50) break
	}
	return {
		phase: "mlb-future-only-filter-v1",
		futureFilterNowMs: nowMs,
		futureFilterTimestamp: new Date(nowMs).toISOString(),
		futureGraceMs: graceMs,
		timezoneContext: "UTC_ms_epoch",
		boundaryStrictness: "strict_gt",
		totalConsidered,
		futureEligibleGames: keptCount,
		filteredStartedGames: startedDroppedIds.length,
		excludedWithoutTimestamp: noTimestampDroppedIds.length,
		excludedGameIds: droppedIds,
	}
}

/**
 * Apply the strict future-only filter to an array of events.
 * Returns kept, dropped, and a diagnostics envelope ready for embedding
 * in snapshot.diagnostics.futureOnlyFilter.
 *
 * @param {object[]} events
 * @param {object}   [opts]
 * @param {number}   [opts.nowMs]
 * @param {number|Date|string} [opts.now]
 * @param {number}   [opts.graceMs]
 * @returns {{ kept: object[], dropped: object[], diagnostics: object }}
 */
function filterFutureOnlyEvents(events, opts = {}) {
	const safe = Array.isArray(events) ? events : []
	const nowMs = getNowMs(opts)
	const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : readGraceMs()

	const kept = []
	const dropped = []
	const startedIds = []
	const noTsIds = []

	for (const e of safe) {
		const t = getEventCommenceMs(e)
		const id = getEventId(e)
		if (!Number.isFinite(t)) {
			noTsIds.push(id)
			dropped.push(e)
			continue
		}
		if (t > nowMs + graceMs) {
			kept.push(e)
		} else {
			startedIds.push(id)
			dropped.push(e)
		}
	}

	return {
		kept,
		dropped,
		diagnostics: summarizeFutureFilter({
			nowMs,
			graceMs,
			totalConsidered: safe.length,
			keptCount: kept.length,
			startedDroppedIds: startedIds,
			noTimestampDroppedIds: noTsIds,
		}),
	}
}

/**
 * Apply the strict future-only filter to row objects. Same rules.
 */
function filterFutureOnlyRows(rows, opts = {}) {
	const safe = Array.isArray(rows) ? rows : []
	const nowMs = getNowMs(opts)
	const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : readGraceMs()

	const kept = []
	const dropped = []
	const startedIds = []
	const noTsIds = []

	for (const r of safe) {
		const t = getRowCommenceMs(r)
		const id = getRowEventId(r)
		if (!Number.isFinite(t)) {
			noTsIds.push(id)
			dropped.push(r)
			continue
		}
		if (t > nowMs + graceMs) {
			kept.push(r)
		} else {
			startedIds.push(id)
			dropped.push(r)
		}
	}

	return {
		kept,
		dropped,
		diagnostics: summarizeFutureFilter({
			nowMs,
			graceMs,
			totalConsidered: safe.length,
			keptCount: kept.length,
			startedDroppedIds: startedIds,
			noTimestampDroppedIds: noTsIds,
		}),
	}
}

module.exports = {
	getNowMs,
	getEventCommenceMs,
	getRowCommenceMs,
	getEventId,
	isFutureOnlyEvent,
	isFutureOnlyRow,
	filterFutureOnlyEvents,
	filterFutureOnlyRows,
	summarizeFutureFilter,
	readGraceMs,
}
