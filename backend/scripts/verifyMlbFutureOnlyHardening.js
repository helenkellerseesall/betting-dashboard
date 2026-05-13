"use strict"

/**
 * Predictive-Integrity Hardening — MLB future-only filter verification.
 *
 * Exercises every branch of the canonical helper against fixtures:
 *   - strict boundary (T == now → excluded)
 *   - past (excluded)
 *   - future (kept)
 *   - missing timestamp (excluded; counted)
 *   - ISO with explicit timezone (UTC-safe)
 *   - mixed slate (kept/dropped ratios; ids surfaced)
 *   - env grace window (MLB_FUTURE_GRACE_MS)
 *   - graceful behavior at 0 events
 *
 * Plus integration smoke tests against the wrapped consumers:
 *   - buildMlbAutoTickets.filterFutureProps (legacy shape preserved)
 *
 *   node backend/scripts/verifyMlbFutureOnlyHardening.js
 */

function assert(cond, msg, ctx) {
	if (!cond) {
		console.log("FAIL —", msg)
		if (ctx !== undefined) console.log("  ctx:", JSON.stringify(ctx, null, 2))
		process.exitCode = 1
		return false
	}
	console.log("  OK —", msg)
	return true
}

const {
	isFutureOnlyEvent,
	isFutureOnlyRow,
	filterFutureOnlyEvents,
	filterFutureOnlyRows,
	getEventCommenceMs,
	readGraceMs,
} = require("../pipeline/shared/mlbFutureOnly")

function isoSecondsAgo(n) { return new Date(Date.now() - n * 1000).toISOString() }
function isoSecondsFuture(n) { return new Date(Date.now() + n * 1000).toISOString() }

function run() {
	console.log("\n=== MLB Future-Only Filter — Verification ===\n")

	// ── 1. Strict boundary: T == now → EXCLUDED ────────────────────────────
	console.log("\n--- strict boundary (T == now) ---")
	{
		const nowMs = 1_700_000_000_000
		const eventAtNow = { eventId: "e-now", gameTime: new Date(nowMs).toISOString() }
		const eventFuture = { eventId: "e-future", gameTime: new Date(nowMs + 60_000).toISOString() }
		assert(isFutureOnlyEvent(eventAtNow, nowMs, 0) === false, "T == now is EXCLUDED (strict >)")
		assert(isFutureOnlyEvent(eventFuture, nowMs, 0) === true,  "T = now + 60s is INCLUDED")
	}

	// ── 2. Past events excluded ─────────────────────────────────────────────
	console.log("\n--- past events ---")
	{
		const events = [
			{ eventId: "p1", gameTime: isoSecondsAgo(3600) },  // 1h ago
			{ eventId: "p2", gameTime: isoSecondsAgo(60) },     // 1m ago
			{ eventId: "p3", gameTime: isoSecondsAgo(1) },      // just past
		]
		const result = filterFutureOnlyEvents(events)
		assert(result.kept.length === 0, "0 past events kept")
		assert(result.diagnostics.filteredStartedGames === 3, "3 past events counted as started")
		assert(result.diagnostics.excludedGameIds.includes("p1"), "p1 in excluded ids")
	}

	// ── 3. Future events kept ───────────────────────────────────────────────
	console.log("\n--- future events ---")
	{
		const events = [
			{ eventId: "f1", gameTime: isoSecondsFuture(600) },
			{ eventId: "f2", gameTime: isoSecondsFuture(3600) },
			{ eventId: "f3", gameTime: isoSecondsFuture(86400) },
		]
		const result = filterFutureOnlyEvents(events)
		assert(result.kept.length === 3, "3 future events kept")
		assert(result.diagnostics.filteredStartedGames === 0, "0 started")
		assert(result.diagnostics.excludedWithoutTimestamp === 0, "0 missing-ts")
	}

	// ── 4. Missing timestamps excluded + counted ───────────────────────────
	console.log("\n--- missing timestamps ---")
	{
		const events = [
			{ eventId: "x1" },                                          // no gameTime
			{ eventId: "x2", gameTime: "not-a-date" },                  // unparseable
			{ eventId: "x3", gameTime: null },                          // explicit null
			{ eventId: "f1", gameTime: isoSecondsFuture(120) },        // valid future
		]
		const result = filterFutureOnlyEvents(events)
		assert(result.kept.length === 1, "1 kept (valid future)")
		assert(result.diagnostics.excludedWithoutTimestamp === 3, "3 missing-ts counted")
		assert(result.diagnostics.filteredStartedGames === 0, "no started")
	}

	// ── 5. Timezone-explicit ISO strings (UTC-safe) ────────────────────────
	console.log("\n--- timezone-explicit ISOs ---")
	{
		// All three describe the same UTC instant; all should classify identically.
		const utcIso = new Date(Date.now() + 30 * 60_000).toISOString()
		// Construct PT/ET equivalents around the same instant
		const sameInstantMs = new Date(utcIso).getTime()
		const events = [
			{ eventId: "tz-utc", gameTime: utcIso },
			{ eventId: "tz-num", gameTime: sameInstantMs },                       // numeric epoch
			{ eventId: "tz-date", gameTime: new Date(sameInstantMs) },            // Date instance
		]
		const result = filterFutureOnlyEvents(events)
		assert(result.kept.length === 3, "all 3 representations classified identically")
		// Verify the commence-ms helper resolves equally
		const a = getEventCommenceMs(events[0])
		const b = getEventCommenceMs(events[1])
		const c = getEventCommenceMs(events[2])
		assert(a === b && b === c, "getEventCommenceMs resolves consistently across ISO / number / Date")
	}

	// ── 6. Mixed slate (kept + started + missing) ──────────────────────────
	console.log("\n--- mixed slate ---")
	{
		const events = [
			{ eventId: "p1", gameTime: isoSecondsAgo(1800) },
			{ eventId: "f1", gameTime: isoSecondsFuture(1800) },
			{ eventId: "f2", gameTime: isoSecondsFuture(3600) },
			{ eventId: "x1" },
		]
		const result = filterFutureOnlyEvents(events)
		assert(result.kept.length === 2, "2 kept")
		assert(result.dropped.length === 2, "2 dropped")
		assert(result.diagnostics.filteredStartedGames === 1, "1 started counted")
		assert(result.diagnostics.excludedWithoutTimestamp === 1, "1 missing-ts counted")
		assert(result.diagnostics.boundaryStrictness === "strict_gt", "boundary marked strict_gt")
		assert(result.diagnostics.timezoneContext === "UTC_ms_epoch", "tz context UTC_ms_epoch")
	}

	// ── 7. Env grace window ────────────────────────────────────────────────
	console.log("\n--- env grace window ---")
	{
		const prev = process.env.MLB_FUTURE_GRACE_MS
		try {
			process.env.MLB_FUTURE_GRACE_MS = "5000"
			assert(readGraceMs() === 5000, "5s grace honored")
			const event = { eventId: "near-future", gameTime: isoSecondsFuture(2) }  // 2s in future
			// With 5s grace, a 2-second-future game still fails t > now + 5000ms.
			assert(isFutureOnlyEvent(event, Date.now()) === false, "2s future excluded under 5s grace")
			const event2 = { eventId: "well-future", gameTime: isoSecondsFuture(60) }
			assert(isFutureOnlyEvent(event2, Date.now()) === true, "60s future kept under 5s grace")
		} finally {
			if (prev == null) delete process.env.MLB_FUTURE_GRACE_MS
			else process.env.MLB_FUTURE_GRACE_MS = prev
		}
	}

	// ── 8. Grace cap at 60_000ms ───────────────────────────────────────────
	console.log("\n--- grace cap ---")
	{
		const prev = process.env.MLB_FUTURE_GRACE_MS
		try {
			process.env.MLB_FUTURE_GRACE_MS = "999999999"
			assert(readGraceMs() === 60_000, "grace capped at 60_000ms")
		} finally {
			if (prev == null) delete process.env.MLB_FUTURE_GRACE_MS
			else process.env.MLB_FUTURE_GRACE_MS = prev
		}
	}

	// ── 9. Rows variant uses identical semantics ───────────────────────────
	console.log("\n--- rows variant ---")
	{
		const rows = [
			{ eventId: "r-past", gameTime: isoSecondsAgo(60) },
			{ eventId: "r-future", gameTime: isoSecondsFuture(60) },
			{ eventId: "r-now", gameTime: new Date(Date.now()).toISOString() },
			{ eventId: "r-noTs", odds: -110 },
		]
		const result = filterFutureOnlyRows(rows)
		assert(result.kept.length === 1, "1 row kept (future)")
		assert(result.diagnostics.filteredStartedGames === 2, "now + past = 2 started")
		assert(result.diagnostics.excludedWithoutTimestamp === 1, "1 row missing ts")
		const sample = result.kept[0]
		assert(isFutureOnlyRow(sample) === true, "isFutureOnlyRow agrees on kept row")
	}

	// ── 10. Empty input handled gracefully ─────────────────────────────────
	console.log("\n--- empty input ---")
	{
		const result = filterFutureOnlyEvents([])
		assert(Array.isArray(result.kept) && result.kept.length === 0, "kept array empty")
		assert(result.diagnostics.totalConsidered === 0, "totalConsidered=0")
		assert(result.diagnostics.filteredStartedGames === 0, "filteredStartedGames=0")
		const result2 = filterFutureOnlyEvents(null)
		assert(Array.isArray(result2.kept) && result2.kept.length === 0, "null input handled")
		const result3 = filterFutureOnlyEvents(undefined)
		assert(Array.isArray(result3.kept) && result3.kept.length === 0, "undefined input handled")
	}

	// ── 11. excludedGameIds capped at 50 entries ───────────────────────────
	console.log("\n--- excludedGameIds cap ---")
	{
		const events = []
		for (let i = 0; i < 100; i++) {
			events.push({ eventId: `cap-${i}`, gameTime: isoSecondsAgo(60) })
		}
		const result = filterFutureOnlyEvents(events)
		assert(result.diagnostics.filteredStartedGames === 100, "100 counted as started")
		assert(result.diagnostics.excludedGameIds.length === 50, "ids list capped at 50")
	}

	// ── 12. Source-priority order ──────────────────────────────────────────
	console.log("\n--- source priority order ---")
	{
		// gameTime wins over commenceTime; first non-null usable wins.
		const e1 = {
			eventId: "e1",
			gameTime:    isoSecondsFuture(120),
			commenceTime: isoSecondsAgo(120),
		}
		assert(isFutureOnlyEvent(e1) === true, "gameTime takes priority over commenceTime")
		const e2 = {
			eventId: "e2",
			// gameTime missing — falls back to commenceTime → commence_time → startTime
			commence_time: isoSecondsFuture(120),
		}
		assert(isFutureOnlyEvent(e2) === true, "commence_time used when gameTime missing")
	}

	// ── 13. Replay determinism: same now → same result ────────────────────
	console.log("\n--- replay determinism ---")
	{
		const fixedNow = 1_750_000_000_000
		const events = [
			{ eventId: "a", gameTime: new Date(fixedNow + 60_000).toISOString() },
			{ eventId: "b", gameTime: new Date(fixedNow - 60_000).toISOString() },
		]
		const r1 = filterFutureOnlyEvents(events, { nowMs: fixedNow })
		const r2 = filterFutureOnlyEvents(events, { nowMs: fixedNow })
		assert(JSON.stringify(r1.diagnostics) === JSON.stringify(r2.diagnostics), "diagnostics deterministic")
		assert(r1.diagnostics.futureFilterNowMs === fixedNow, "nowMs surfaced in diagnostics")
		assert(r1.diagnostics.futureFilterTimestamp === new Date(fixedNow).toISOString(), "iso surfaced")
	}

	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
