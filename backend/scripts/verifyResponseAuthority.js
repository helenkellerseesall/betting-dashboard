"use strict"

/**
 * Response-Authority Probe verification.
 *
 * Six scenarios:
 *   1. all empty (runtime/canonical/endpoint) — probe silent
 *   2. all populated, no disconnect — probe logs AUTHORITY, no DISCONNECT
 *   3. runtime populated, canonical empty — pipeline-side disconnect detected
 *   4. canonical populated, endpoint empty — serializer-side disconnect detected
 *   5. partial populated, hydration source identified
 *   6. malformed inputs handled gracefully
 *
 *   node backend/scripts/verifyResponseAuthority.js
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
	captureRuntimeBoardCounts,
	captureCanonicalBoardCounts,
	captureEndpointBoardCounts,
	compareAuthority,
	buildResponseAuthoritySummary,
	emptyResponseAuthoritySummary,
} = require("../pipeline/shared/responseAuthority")

function part1_helperPurity() {
	console.log("\n=== PART 1 — pure capture helpers ===\n")

	console.log("\n--- captureRuntimeBoardCounts ---")
	const r1 = captureRuntimeBoardCounts({ rows: [{ a: 1 }, { a: 2 }, { a: 3 }], updatedAt: "2026-05-12T20:00:00Z" }, "baseball_mlb")
	assert(r1.rowsTotal === 3, "rowsTotal correct", { v: r1.rowsTotal })
	assert(typeof r1.snapshotUpdatedAt === "string", "snapshotUpdatedAt preserved")
	const r2 = captureRuntimeBoardCounts(null, "baseball_mlb")
	assert(r2.rowsTotal === 0, "null snapshot → 0")
	const r3 = captureRuntimeBoardCounts({ rows: [{ mlbLiveState: {} }] }, "baseball_mlb")
	assert(r3.hasMlbLiveState === true, "hasMlbLiveState detected")

	console.log("\n--- captureCanonicalBoardCounts ---")
	const c1 = captureCanonicalBoardCounts({
		best: [{}, {}, {}],
		finalPlayableRows: [{}, {}, {}, {}],
		safe: { legs: [1, 2, 3] },
		balanced: { legs: [1, 2] },
		parlays: { core: [1, 2, 3], topPlays: [{}, {}] },
	})
	assert(c1.best === 3, "best count")
	assert(c1.finalPlayableRows === 4, "finalPlayableRows count")
	assert(c1.safe === 3, "safe legs count")
	assert(c1.balanced === 2, "balanced legs count")
	assert(c1.parlaysCore === 3, "parlays.core count")
	assert(c1.parlaysTopPlays === 2, "parlays.topPlays count")
	assert(c1.payloadShape === "present", "payload present")

	const c2 = captureCanonicalBoardCounts(null)
	assert(c2.best === 0 && c2.payloadShape === "missing", "null canonical → missing shape")

	console.log("\n--- captureEndpointBoardCounts ---")
	const e1 = captureEndpointBoardCounts({
		bestProps: [{}, {}],
		allProps: [{}, {}, {}, {}, {}],
		hrSlips: [{}, {}, {}],
	})
	assert(e1.bestProps === 2, "endpoint bestProps")
	assert(e1.allProps === 5, "endpoint allProps")
	assert(e1.hrSlipsCount === 3, "hrSlips array count")
	const e2 = captureEndpointBoardCounts({ hrSlips: { a: 1, b: 2 } })
	assert(e2.hrSlipsCount === 2, "hrSlips object → Object.keys count")
}

function part2_allEmpty() {
	console.log("\n=== PART 2 — all empty (no signal) ===\n")
	const runtime = captureRuntimeBoardCounts({ rows: [] })
	const canonical = captureCanonicalBoardCounts({})
	const endpoint = captureEndpointBoardCounts({})
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport: "baseball_mlb", owner: "test" })
	assert(envelope.disconnects.runtimePopulatedButCanonicalEmpty === false, "no disconnect 1")
	assert(envelope.disconnects.canonicalPopulatedButEndpointEmpty === false, "no disconnect 2")
	assert(envelope.disconnects.runtimePopulatedButEndpointEmpty === false, "no disconnect 3")
	assert(envelope.responseHydrationSource === "fallback_empty", "fallback_empty when all empty")
	assert(envelope.fallbackPayloadUsed === true, "fallbackPayloadUsed=true")
}

function part3_allPopulatedHealthy() {
	console.log("\n=== PART 3 — populated end-to-end (healthy state) ===\n")
	const runtime = captureRuntimeBoardCounts({
		rows: new Array(11000),
		updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
	})
	const canonical = captureCanonicalBoardCounts({
		best: new Array(45),
		finalPlayableRows: new Array(45),
	})
	const endpoint = captureEndpointBoardCounts({
		bestProps: new Array(45),
		allProps: new Array(11000),
	})
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport: "baseball_mlb", owner: "test" })
	assert(envelope.disconnects.runtimePopulatedButCanonicalEmpty === false, "no disconnect: runtime → canonical")
	assert(envelope.disconnects.canonicalPopulatedButEndpointEmpty === false, "no disconnect: canonical → endpoint")
	assert(envelope.disconnects.runtimePopulatedButEndpointEmpty === false, "no disconnect: runtime → endpoint")
	assert(envelope.fallbackPayloadUsed === false, "fallback NOT used in healthy state")
	assert(envelope.stalePayloadDetected === false, "fresh snapshot not stale")
	assert(["canonical_finalPlayable", "canonical_best"].includes(envelope.responseHydrationSource),
		"hydration source identified", { v: envelope.responseHydrationSource })
}

function part4_runtimePopulatedCanonicalEmpty() {
	console.log("\n=== PART 4 — runtime → canonical disconnect ===\n")
	const runtime = captureRuntimeBoardCounts({
		rows: new Array(11000),
		updatedAt: new Date().toISOString(),
	})
	const canonical = captureCanonicalBoardCounts({ best: [], finalPlayableRows: [] })
	const endpoint = captureEndpointBoardCounts({ bestProps: [] })
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport: "baseball_mlb", owner: "test" })
	assert(envelope.disconnects.runtimePopulatedButCanonicalEmpty === true,
		"runtime→canonical disconnect FLAGGED")
	assert(envelope.disconnects.canonicalPopulatedButEndpointEmpty === false,
		"canonical→endpoint not flagged when canonical empty")
	assert(envelope.disconnects.runtimePopulatedButEndpointEmpty === true,
		"runtime→endpoint also flagged (transitively)")
}

function part5_canonicalPopulatedEndpointEmpty() {
	console.log("\n=== PART 5 — canonical → endpoint disconnect (the user's symptom) ===\n")
	const runtime = captureRuntimeBoardCounts({
		rows: new Array(11000),
		updatedAt: new Date().toISOString(),
	})
	const canonical = captureCanonicalBoardCounts({
		best: new Array(16),
		finalPlayableRows: new Array(16),
	})
	const endpoint = captureEndpointBoardCounts({
		bestProps: [],
		allProps: new Array(11000),
	})
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport: "baseball_mlb", owner: "test" })
	assert(envelope.disconnects.canonicalPopulatedButEndpointEmpty === true,
		"canonical→endpoint disconnect FLAGGED (this is the user's reported symptom)")
	assert(envelope.disconnects.runtimePopulatedButCanonicalEmpty === false,
		"runtime→canonical not flagged when canonical IS populated")
	assert(envelope.responseHydrationSource === "fallback_empty",
		"hydration source = fallback_empty when endpoint empty",
		{ v: envelope.responseHydrationSource })
}

function part6_staleness() {
	console.log("\n=== PART 6 — stale-payload detection ===\n")
	const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
	const runtime = captureRuntimeBoardCounts({ rows: new Array(5), updatedAt: old })
	const canonical = captureCanonicalBoardCounts({ best: [{}, {}], finalPlayableRows: [{}, {}] })
	const endpoint = captureEndpointBoardCounts({ bestProps: [{}, {}], allProps: new Array(5) })
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport: "baseball_mlb", owner: "test" })
	assert(envelope.stalePayloadDetected === true,
		"snapshot 2h old → stalePayloadDetected=true")

	const fresh = new Date(Date.now() - 5 * 60 * 1000).toISOString()
	const runtime2 = captureRuntimeBoardCounts({ rows: new Array(5), updatedAt: fresh })
	const envelope2 = compareAuthority({
		runtime: runtime2,
		canonical,
		endpoint,
		sport: "baseball_mlb",
		owner: "test",
	})
	assert(envelope2.stalePayloadDetected === false,
		"snapshot 5m old → stalePayloadDetected=false")
}

function part7_summaryShape() {
	console.log("\n=== PART 7 — summary shape + empty diagnostics ===\n")
	const runtime = captureRuntimeBoardCounts({ rows: new Array(3) })
	const canonical = captureCanonicalBoardCounts({ best: [{}] })
	const endpoint = captureEndpointBoardCounts({ bestProps: [{}] })
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport: "baseball_mlb", owner: "test" })
	const summary = buildResponseAuthoritySummary(envelope)
	for (const k of ["sport", "canonicalOwner", "hydrationSource", "fallbackPayloadUsed", "stalePayloadDetected", "counts", "disconnects"]) {
		assert(Object.prototype.hasOwnProperty.call(summary, k), `summary has key: ${k}`)
	}
	for (const k of ["runtimeRows", "canonicalBest", "canonicalFinalPlayable", "endpointBestProps", "endpointAllProps"]) {
		assert(Object.prototype.hasOwnProperty.call(summary.counts, k), `summary.counts has key: ${k}`)
	}
	const empty = emptyResponseAuthoritySummary()
	assert(empty.sport === null && empty.counts.runtimeRows === 0, "empty diagnostics shape")
}

function part8_malformedInputs() {
	console.log("\n=== PART 8 — malformed inputs handled gracefully ===\n")
	assert(captureRuntimeBoardCounts(undefined).rowsTotal === 0, "undefined snapshot ok")
	assert(captureRuntimeBoardCounts(42).rowsTotal === 0, "non-object snapshot ok")
	assert(captureCanonicalBoardCounts("string").best === 0, "non-object payload ok")
	assert(captureEndpointBoardCounts(null).bestProps === 0, "null response ok")
	const envelope = compareAuthority({
		runtime: undefined,
		canonical: null,
		endpoint: 0,
		sport: null,
		owner: null,
	})
	assert(typeof envelope === "object", "compare returns envelope object even with bad inputs")
}

function run() {
	try {
		part1_helperPurity()
		part2_allEmpty()
		part3_allPopulatedHealthy()
		part4_runtimePopulatedCanonicalEmpty()
		part5_canonicalPopulatedEndpointEmpty()
		part6_staleness()
		part7_summaryShape()
		part8_malformedInputs()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
