"use strict"

/**
 * Execution-Path / Orphan-Code Hardening — verification.
 *
 * Confirms:
 *   - Identified orphan files carry @orphan JSDoc headers (additive marker).
 *   - Identified duplicate-ownership sites carry @duplicate-ownership markers
 *     and runtime [EXECUTION-AUTHORITY] probes.
 *   - The execution-authority probe utility works as designed (duplicates
 *     are surfaced; canonical mark wins; bounded entry count).
 *   - All marked orphans are STILL orphans (no live caller was added without
 *     also removing the @orphan marker).
 *   - All other live modules still load cleanly (no regression).
 *
 *   node backend/scripts/verifyOrphanAuthorityHardening.js
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

function readFileSafe(rel) {
	try {
		return fs.readFileSync(path.join(__dirname, "..", rel), "utf8")
	} catch (e) {
		return null
	}
}

function part1_orphanMarkers() {
	console.log("\n=== PART 1 — orphan markers present ===\n")

	console.log("\n--- buildMlbStatcastPower.js (type-A orphan) ---")
	const a = readFileSafe("pipeline/mlb/buildMlbStatcastPower.js")
	assert(a != null, "file exists")
	assert(/@orphan\b/.test(a), "@orphan JSDoc tag present")
	assert(/type-A orphan/.test(a), "type-A classification stated")
	assert(/zero references/i.test(a), "explains zero references")

	console.log("\n--- buildMlbWeather.js (type-B script-only legacy) ---")
	const b = readFileSafe("pipeline/mlb/buildMlbWeather.js")
	assert(b != null, "file exists")
	assert(/@orphan\b/.test(b), "@orphan JSDoc tag present")
	assert(/script-only legacy/.test(b), "script-only legacy classification")
	assert(/refreshMlbWeatherForSlate/.test(b), "points to live replacement")

	console.log("\n--- handleMlbGradeHrTestGet (type-A orphan, exported but unbound) ---")
	const c = readFileSafe("http/mlbIsolatedRoutes.js")
	assert(c != null, "mlbIsolatedRoutes.js exists")
	assert(/@orphan \(exported but never bound\)/.test(c), "@orphan tag on handleMlbGradeHrTestGet")
	assert(/Triple ownership/.test(c), "triple-ownership note present")

	console.log("\n--- /mlb/refresh duplicate-ownership marker ---")
	const s = readFileSafe("server.js")
	assert(s != null, "server.js exists")
	assert(/@duplicate-ownership/.test(s), "@duplicate-ownership marker present")
	assert(/OLDER inline implementation/.test(s) || /legacy inline/.test(s),
		"legacy/older inline note present")
	assert(/EXECUTION-AUTHORITY/.test(s), "EXECUTION-AUTHORITY probe wired")
}

function part2_authorityProbeUtility() {
	console.log("\n=== PART 2 — executionAuthority probe ===\n")
	const {
		createExecutionAuthorityProbe,
		emptyExecutionAuthorityDiagnostics,
	} = require("../pipeline/shared/executionAuthority")

	console.log("\n--- single owner: no duplicate ---")
	const p1 = createExecutionAuthorityProbe("test_single")
	p1.recordCanonical("op_A", "canonical/path.js")
	const s1 = p1.summary()
	assert(s1.count === 1, "1 authority entry")
	assert(s1.canonicalByOperation.op_A === "canonical/path.js", "canonical mark recorded")
	assert(s1.duplicateOwnershipDetected.length === 0, "no duplicates")

	console.log("\n--- duplicate ownership: surface in diagnostics ---")
	const p2 = createExecutionAuthorityProbe("test_dup")
	p2.recordCanonical("op_X", "canonical/owner.js")
	p2.record("op_X", "alternate/path.js")
	const s2 = p2.summary()
	assert(s2.duplicateOwnershipDetected.length === 1, "one duplicate operation flagged")
	assert(s2.duplicateOwnershipDetected[0].operation === "op_X", "correct operation flagged")
	assert(s2.duplicateOwnershipDetected[0].owners.length === 2, "two owners listed")
	assert(s2.canonicalByOperation.op_X === "canonical/owner.js", "canonical still labeled")

	console.log("\n--- bounded entries (max 50) ---")
	const p3 = createExecutionAuthorityProbe("test_bounded")
	for (let i = 0; i < 60; i++) p3.record(`op_${i}`, `path_${i}`)
	const s3 = p3.summary()
	assert(s3.count === 50, "entries capped at 50", { v: s3.count })

	console.log("\n--- fail-open on malformed input ---")
	const p4 = createExecutionAuthorityProbe("test_failopen")
	p4.record(null, undefined)
	p4.record({}, [])
	const s4 = p4.summary()
	assert(s4.count >= 0, "fail-open: still produces summary")
	assert(typeof s4.label === "string", "label preserved")

	console.log("\n--- emptyExecutionAuthorityDiagnostics shape ---")
	const empty = emptyExecutionAuthorityDiagnostics()
	for (const k of ["label", "authorities", "canonicalByOperation", "duplicateOwnershipDetected", "count"]) {
		assert(Object.prototype.hasOwnProperty.call(empty, k), `empty has key: ${k}`)
	}
}

function part3_orphanStillUnreferenced() {
	console.log("\n=== PART 3 — orphans STILL have no live callers ===\n")

	// Re-grep to confirm that marking them did not coincide with someone
	// (concurrent commit) wiring them in. If the orphans gained callers
	// without the @orphan marker being removed, this test SHOULD fail
	// (signal that the marker is now stale).
	const repoRoot = path.join(__dirname, "..")

	function listJsFiles(dir, acc) {
		acc = acc || []
		let entries = []
		try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
		for (const e of entries) {
			if (e.name === "node_modules" || e.name === ".git") continue
			const p = path.join(dir, e.name)
			if (e.isDirectory()) listJsFiles(p, acc)
			else if (e.isFile() && e.name.endsWith(".js")) acc.push(p)
		}
		return acc
	}

	const allJs = listJsFiles(repoRoot)

	function refsTo(pattern, excludeSelf) {
		const out = []
		for (const p of allJs) {
			if (excludeSelf && p.endsWith(excludeSelf)) continue
			if (p.endsWith("/verifyOrphanAuthorityHardening.js")) continue
			let src
			try { src = fs.readFileSync(p, "utf8") } catch { continue }
			if (pattern.test(src)) out.push(p.replace(repoRoot + path.sep, ""))
		}
		return out
	}

	console.log("\n--- buildMlbStatcastPower references ---")
	const statcastRefs = refsTo(/buildMlbStatcastPower/, "buildMlbStatcastPower.js")
	// docs / fixtures could mention the name; live require is the test.
	const statcastRequires = refsTo(/require\([^)]*buildMlbStatcastPower/, "buildMlbStatcastPower.js")
	console.log("  (info) name mentions:", statcastRefs.length, "files")
	console.log("  (info) require() callers:", statcastRequires.length)
	assert(statcastRequires.length === 0, "buildMlbStatcastPower has zero require() callers — still orphan")

	console.log("\n--- buildMlbWeather require() callers ---")
	const weatherRequires = refsTo(/require\([^)]*buildMlbWeather(?!ForSlate)/, "buildMlbWeather.js")
		.filter((p) => !p.endsWith("buildMlbWeather.js"))
	console.log("  (info) require() callers:", weatherRequires)
	assert(weatherRequires.every((p) => p.startsWith("scripts/") || p.includes("/scripts/")),
		"buildMlbWeather only required by scripts/ — still type-B orphan",
		{ callers: weatherRequires })

	console.log("\n--- handleMlbGradeHrTestGet — exported but unbound ---")
	// The exported function name should only appear in:
	//   - the file that defines it (http/mlbIsolatedRoutes.js)
	//   - any test/verify scripts (excluded above)
	const handlerRefs = refsTo(/handleMlbGradeHrTestGet/, null)
	const liveHandlerImports = handlerRefs.filter((p) =>
		!p.endsWith("http/mlbIsolatedRoutes.js") &&
		!p.includes("/scripts/") &&
		!p.endsWith("verifyOrphanAuthorityHardening.js")
	)
	console.log("  (info) live-path callers:", liveHandlerImports)
	assert(liveHandlerImports.length === 0,
		"handleMlbGradeHrTestGet not imported by any live module")
}

function part4_liveModulesStillLoad() {
	console.log("\n=== PART 4 — live module load smoke ===\n")
	try {
		require("../pipeline/shared/executionAuthority")
		console.log("  OK — executionAuthority loads")
	} catch (e) { assert(false, "executionAuthority load failed", { err: e?.message }) }
	try {
		require("../pipeline/shared/snapshotFreshness")
		console.log("  OK — snapshotFreshness loads")
	} catch (e) { assert(false, "snapshotFreshness load failed", { err: e?.message }) }
	try {
		require("../pipeline/shared/mlbFutureOnly")
		console.log("  OK — mlbFutureOnly loads")
	} catch (e) { assert(false, "mlbFutureOnly load failed", { err: e?.message }) }
	try {
		require("../pipeline/shared/probabilityHonesty")
		console.log("  OK — probabilityHonesty loads")
	} catch (e) { assert(false, "probabilityHonesty load failed", { err: e?.message }) }
	try {
		require("../pipeline/mlb/buildMlbBootstrapSnapshot")
		console.log("  OK — buildMlbBootstrapSnapshot loads")
	} catch (e) { assert(false, "buildMlbBootstrapSnapshot load failed", { err: e?.message }) }
	try {
		require("../http/mlbIsolatedRoutes")
		console.log("  OK — http/mlbIsolatedRoutes loads")
	} catch (e) { assert(false, "http/mlbIsolatedRoutes load failed", { err: e?.message }) }
	// The two MARKED orphan files MUST still load (we did not delete them).
	try {
		require("../pipeline/mlb/buildMlbStatcastPower")
		console.log("  OK — buildMlbStatcastPower (orphan) still loads")
	} catch (e) { assert(false, "buildMlbStatcastPower load failed", { err: e?.message }) }
	try {
		require("../pipeline/mlb/buildMlbWeather")
		console.log("  OK — buildMlbWeather (orphan) still loads")
	} catch (e) { assert(false, "buildMlbWeather load failed", { err: e?.message }) }
}

function run() {
	try {
		part1_orphanMarkers()
		part2_authorityProbeUtility()
		part3_orphanStillUnreferenced()
		part4_liveModulesStillLoad()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
