"use strict"

/**
 * Phase F3 — NBA cacheability-gate tracing verification.
 *
 * Confirms the new Phase F3 instrumentation:
 *   1. cacheWriteSkipReasonCounts exists with three documented reasons
 *      (PLAYER_ID_API_RETURNED_NULL, STATS_API_RETURNED_EMPTY, PLAYER_THROWN_ERROR)
 *      pre-populated to 0.
 *   2. unresolvedPlayerSamples + rejectedCacheabilitySamples exposed as arrays.
 *   3. apiSportsResponseDiagnostics block exposes API response shape.
 *   4. Three skip-site replacements present in source (no bare cacheWriteSkips
 *      increments remain in enrichRowsWithRecentForm).
 *   5. recordCacheWriteSkip helper exists with ring-buffer + first-seen log.
 *   6. [NBA-CACHEABILITY-GATE] probe tag present (rate-limited via _loggedReasonKinds Set).
 *   7. fetchApiSportsPlayerId + fetchApiSportsPlayerStats updated to write into
 *      apiSportsResponseDiagnostics on every call.
 *   8. Phase F2 diagnostics still surfaced.
 *   9. Reset semantics clear the new fields.
 *
 *   node backend/scripts/verifyNbaCacheabilityGate.js
 */

const fs = require("fs")
const path = require("path")

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

const nbaModule = require("../http/nbaIsolatedRoutes")
const { getNbaCacheDiagnostics, resetNbaCacheDiagnostics } = nbaModule
const nbaSrc = fs.readFileSync(path.join(__dirname, "..", "http", "nbaIsolatedRoutes.js"), "utf8")

function part1_exportShape() {
	console.log("\n=== PART 1 — Phase F3 fields exposed via diagnostics ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	for (const k of [
		"cacheWriteSkipReasonCounts",
		"unresolvedPlayerSamples",
		"rejectedCacheabilitySamples",
		"apiSportsResponseDiagnostics",
	]) {
		assert(Object.prototype.hasOwnProperty.call(d, k), `diagnostics has key: ${k}`)
	}
	for (const k of [
		"lastPlayerIdRequestPlayer",
		"lastPlayerIdResponseRowsReturned",
		"lastPlayerIdResponseSampleNames",
		"lastPlayerIdResponseHadFiniteId",
		"lastStatsRequestPlayerId",
		"lastStatsResponseRowsReturned",
		"lastObservedAt",
	]) {
		assert(Object.prototype.hasOwnProperty.call(d.apiSportsResponseDiagnostics, k),
			`apiSportsResponseDiagnostics has key: ${k}`)
	}
	assert(Array.isArray(d.unresolvedPlayerSamples), "unresolvedPlayerSamples is array")
	assert(Array.isArray(d.rejectedCacheabilitySamples), "rejectedCacheabilitySamples is array")
	assert(d.unresolvedPlayerSamples.length === 0, "fresh (empty) after reset")
	assert(d.rejectedCacheabilitySamples.length === 0, "fresh (empty) after reset")
}

function part2_reasonCountsPrePopulated() {
	console.log("\n=== PART 2 — three reason keys pre-populated ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	for (const reason of ["PLAYER_ID_API_RETURNED_NULL", "STATS_API_RETURNED_EMPTY", "PLAYER_THROWN_ERROR"]) {
		assert(Object.prototype.hasOwnProperty.call(d.cacheWriteSkipReasonCounts, reason),
			`cacheWriteSkipReasonCounts has key: ${reason}`)
		assert(d.cacheWriteSkipReasonCounts[reason] === 0, `${reason} starts at 0`)
	}
}

function part3_staticSourceProbes() {
	console.log("\n=== PART 3 — instrumentation present in source ===\n")
	assert(/function recordCacheWriteSkip\(reason, sample\)/.test(nbaSrc),
		"recordCacheWriteSkip helper present")
	assert(/__nbaCacheDiag\.cacheWriteSkips \+= 1/.test(nbaSrc),
		"helper still increments cacheWriteSkips (preserves F2 contract)")
	assert(/__nbaCacheDiag\.cacheWriteSkipReasonCounts\[reasonKey\] \+= 1/.test(nbaSrc),
		"helper increments per-reason counter")
	assert(/__nbaCacheDiag\.rejectedCacheabilitySamples\.shift\(\)/.test(nbaSrc),
		"ring-buffer eviction at cap")
	assert(/__NBA_REJECTION_SAMPLE_CAP\s*=\s*25/.test(nbaSrc),
		"rejection sample cap = 25")
	assert(/__NBA_UNRESOLVED_SAMPLE_CAP\s*=\s*25/.test(nbaSrc),
		"unresolved sample cap = 25")

	// All three skip sites now call recordCacheWriteSkip — count CALLS only,
	// excluding the function definition itself.
	const totalRefs = (nbaSrc.match(/recordCacheWriteSkip\(/g) || []).length
	const definitions = (nbaSrc.match(/function recordCacheWriteSkip\(/g) || []).length
	const skipCalls = totalRefs - definitions
	assert(skipCalls === 3, "exactly 3 recordCacheWriteSkip call sites (PLAYER_ID + STATS + THROWN_ERROR)",
		{ totalRefs, definitions, skipCalls })

	// Each documented reason is referenced in source
	assert(/recordCacheWriteSkip\(\s*["']PLAYER_ID_API_RETURNED_NULL["']/.test(nbaSrc),
		"PLAYER_ID_API_RETURNED_NULL skip site present")
	assert(/recordCacheWriteSkip\(\s*["']STATS_API_RETURNED_EMPTY["']/.test(nbaSrc),
		"STATS_API_RETURNED_EMPTY skip site present")
	assert(/recordCacheWriteSkip\(\s*["']PLAYER_THROWN_ERROR["']/.test(nbaSrc),
		"PLAYER_THROWN_ERROR skip site present")

	// No bare `__nbaCacheDiag.cacheWriteSkips += 1` increments remain inside the
	// player loop. The only legitimate increment is now inside the helper body.
	// We strip both single-line comments and the helper body before counting.
	const noComments = nbaSrc.split("\n").map((line) => {
		const idx = line.indexOf("//")
		return idx >= 0 ? line.slice(0, idx) : line
	}).join("\n")
	const helperBodyOnly = noComments.match(/function recordCacheWriteSkip[\s\S]*?\n\}/m)
	const outsideHelperSrc = helperBodyOnly ? noComments.replace(helperBodyOnly[0], "") : noComments
	const bareIncrementsOutsideHelper = (outsideHelperSrc.match(/__nbaCacheDiag\.cacheWriteSkips \+= 1/g) || []).length
	assert(bareIncrementsOutsideHelper === 0,
		"no bare cacheWriteSkips increments outside the helper (all replaced)",
		{ count: bareIncrementsOutsideHelper })
}

function part4_apiResponseDiagnosticsCaptured() {
	console.log("\n=== PART 4 — API response shape captured ===\n")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdRequestPlayer = String/.test(nbaSrc),
		"fetchApiSportsPlayerId records request player")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdResponseRowsReturned = Array\.isArray\(rows\)/.test(nbaSrc),
		"fetchApiSportsPlayerId records rows.length")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdResponseSampleNames = __sampleNames/.test(nbaSrc),
		"fetchApiSportsPlayerId records first 3 returned names")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdResponseHadFiniteId = Number\.isFinite\(id\)/.test(nbaSrc),
		"fetchApiSportsPlayerId records whether resolution succeeded")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastStatsRequestPlayerId = playerId/.test(nbaSrc),
		"fetchApiSportsPlayerStats records request player id")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastStatsResponseRowsReturned = Array\.isArray\(rows\) \? rows\.length : 0/.test(nbaSrc),
		"fetchApiSportsPlayerStats records rows.length")
}

function part5_logProbeRateLimited() {
	console.log("\n=== PART 5 — [NBA-CACHEABILITY-GATE] probe rate-limited ===\n")
	const logCount = (nbaSrc.match(/console\.log\("\[NBA-CACHEABILITY-GATE\]"/g) || []).length
	assert(logCount === 1, "exactly one console.log emission site for [NBA-CACHEABILITY-GATE]",
		{ count: logCount })
	assert(/__nbaCacheDiag\._loggedReasonKinds = new Set\(\)/.test(nbaSrc),
		"_loggedReasonKinds Set used for rate-limiting")
	assert(/if \(!__nbaCacheDiag\._loggedReasonKinds\.has\(reasonKey\)\)/.test(nbaSrc),
		"rate-limit guard checks Set membership before logging")
}

function part6_helperBehaviorViaModule() {
	console.log("\n=== PART 6 — direct helper invocation (module-level test) ===\n")
	resetNbaCacheDiagnostics()
	// recordCacheWriteSkip is not exported, so we exercise it indirectly by
	// confirming the diagnostics object behaves correctly when populated via
	// our exported reset/get path. (Direct invocation would require white-box
	// access; the static source assertions in PART 3 cover the call sites.)
	const d = getNbaCacheDiagnostics()
	assert(d.cacheWriteSkips === 0, "fresh state")
	assert(d.cacheWriteSkipReasonCounts.PLAYER_ID_API_RETURNED_NULL === 0,
		"PLAYER_ID counter starts at 0")
}

function part7_responseEmbeddingPersists() {
	console.log("\n=== PART 7 — nbaCacheDiagnostics still embedded in /api/best-available response ===\n")
	assert(/nbaCacheDiagnostics:\s*getNbaCacheDiagnostics\(\)/.test(nbaSrc),
		"response embeds full diagnostics (now includes Phase F3 fields)")
}

function part8_resetSemantics() {
	console.log("\n=== PART 8 — reset clears Phase F3 fields ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	assert(d.cacheWriteSkipReasonCounts.PLAYER_ID_API_RETURNED_NULL === 0, "reason counter zero")
	assert(d.cacheWriteSkipReasonCounts.STATS_API_RETURNED_EMPTY === 0, "reason counter zero")
	assert(d.cacheWriteSkipReasonCounts.PLAYER_THROWN_ERROR === 0, "reason counter zero")
	assert(d.unresolvedPlayerSamples.length === 0, "unresolved samples cleared")
	assert(d.rejectedCacheabilitySamples.length === 0, "rejected samples cleared")
	assert(d.apiSportsResponseDiagnostics.lastPlayerIdRequestPlayer === null, "API request snapshot cleared")
	assert(d.apiSportsResponseDiagnostics.lastObservedAt === null, "API timestamp cleared")
}

function part9_isolation() {
	console.log("\n=== PART 9 — returned diagnostics is a defensive copy ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	// Mutate returned object — internal state must not change
	d.cacheWriteSkipReasonCounts.PLAYER_ID_API_RETURNED_NULL = 999
	d.unresolvedPlayerSamples.push({ playerName: "test" })
	d.rejectedCacheabilitySamples.push({ reason: "test" })
	d.apiSportsResponseDiagnostics.lastPlayerIdRequestPlayer = "MUTATED"
	const d2 = getNbaCacheDiagnostics()
	assert(d2.cacheWriteSkipReasonCounts.PLAYER_ID_API_RETURNED_NULL === 0, "internal counter unmutated")
	assert(d2.unresolvedPlayerSamples.length === 0, "internal unresolved samples unmutated")
	assert(d2.rejectedCacheabilitySamples.length === 0, "internal rejected samples unmutated")
	assert(d2.apiSportsResponseDiagnostics.lastPlayerIdRequestPlayer === null,
		"internal API diagnostics unmutated")
}

function part10_phaseF2SemanticsIntact() {
	console.log("\n=== PART 10 — Phase F2 diagnostics still present (no regression) ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	for (const k of [
		"enrichmentInvocations", "cacheReadHitsPlayerId", "cacheReadMissesPlayerId",
		"cacheWriteAttemptsPlayerId", "cacheWriteSuccessesPlayerId", "cacheWriteSkips",
		"saveApiSportsDiskCacheInvoked", "memoryPlayerIdCount", "diskPlayerIdCount",
		"cachePersistenceHealthy",
	]) {
		assert(Object.prototype.hasOwnProperty.call(d, k), `Phase F2 field still present: ${k}`)
	}
}

function part11_syntaxCheck() {
	console.log("\n=== PART 11 — nbaIsolatedRoutes + server still parse cleanly ===\n")
	const { spawnSync } = require("child_process")
	for (const f of ["http/nbaIsolatedRoutes.js", "server.js"]) {
		const r = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", f)], { encoding: "utf8" })
		assert(r.status === 0, `node --check ${f} → exit 0`, { stderr: r.stderr?.slice(0, 400) })
	}
}

function run() {
	try {
		part1_exportShape()
		part2_reasonCountsPrePopulated()
		part3_staticSourceProbes()
		part4_apiResponseDiagnosticsCaptured()
		part5_logProbeRateLimited()
		part6_helperBehaviorViaModule()
		part7_responseEmbeddingPersists()
		part8_resetSemantics()
		part9_isolation()
		part10_phaseF2SemanticsIntact()
		part11_syntaxCheck()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
