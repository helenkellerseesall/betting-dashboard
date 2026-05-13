"use strict"

/**
 * Phase F1 — API-Sports legacy-cache authority hardening verification.
 *
 * Confirms via static source inspection (no server boot, no SQLite, no
 * network calls — this fixture is safe to run anywhere) that:
 *
 *   1. ENABLE_LEGACY_API_SPORTS_CACHE env constant is defined and defaults
 *      to false-unless-truthy.
 *   2. The [NBA-LEGACY-CACHE-DISABLED] boot probe is emitted at module
 *      load with the expected fields.
 *   3. saveApiSportsCachesToDisk early-returns when the flag is off
 *      (no-op semantics — the disk file is not touched).
 *   4. The 60-second setInterval at line ~19398 is gated by the flag.
 *   5. All four module-globals + the two cached fetchers + the load/save
 *      functions carry @orphan markers.
 *   6. The canonical owner is documented inline as
 *      http/nbaIsolatedRoutes.js:saveApiSportsDiskCache.
 *   7. No code was DELETED — all original behavior survives behind the
 *      flag for emergency rollback.
 *   8. Owner B (nbaIsolatedRoutes.js) is unchanged.
 *
 *   node backend/scripts/verifyLegacyApiSportsCacheGate.js
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

const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8")
const nbaIsoSrc = fs.readFileSync(path.join(__dirname, "..", "http", "nbaIsolatedRoutes.js"), "utf8")
const cacheFile = path.join(__dirname, "..", "api-sports-cache.json")

function part1_envFlagConstant() {
	console.log("\n=== PART 1 — ENABLE_LEGACY_API_SPORTS_CACHE constant ===\n")
	assert(/const\s+ENABLE_LEGACY_API_SPORTS_CACHE\s*=\s*\n?\s*String\(process\.env\.ENABLE_LEGACY_API_SPORTS_CACHE/.test(serverSrc),
		"ENABLE_LEGACY_API_SPORTS_CACHE constant defined from env")
	assert(/=== "true"/.test(serverSrc) && serverSrc.indexOf("ENABLE_LEGACY_API_SPORTS_CACHE") !== -1,
		"strict equality check against 'true' (default = false)")
}

function part2_bootProbe() {
	console.log("\n=== PART 2 — [NBA-LEGACY-CACHE-DISABLED] boot probe ===\n")
	assert(/\[NBA-LEGACY-CACHE-DISABLED\]/.test(serverSrc),
		"[NBA-LEGACY-CACHE-DISABLED] log probe present")
	assert(/flag:\s*['"]ENABLE_LEGACY_API_SPORTS_CACHE['"]/.test(serverSrc),
		"probe carries flag name")
	assert(/defaultIsOff:\s*true/.test(serverSrc),
		"probe documents defaultIsOff")
	assert(/canonicalOwner:\s*['"]http\/nbaIsolatedRoutes\.js:saveApiSportsDiskCache['"]/.test(serverSrc),
		"probe documents canonical owner")
	// Two probe sites are expected: module-load + flag-on-only at setInterval.
	const probeCount = (serverSrc.match(/\[NBA-LEGACY-CACHE-DISABLED\]/g) || []).length
	assert(probeCount >= 2, "probe emitted in ≥2 places (module-load + flag-on setInterval log)",
		{ count: probeCount })
}

function part3_saveFunctionNoOp() {
	console.log("\n=== PART 3 — saveApiSportsCachesToDisk no-op gate ===\n")
	// The function body must contain an early-return on the flag.
	const fnMatch = serverSrc.match(/function saveApiSportsCachesToDisk\(\)\s*\{[\s\S]*?\n\}/m)
	assert(fnMatch != null, "saveApiSportsCachesToDisk function located")
	const fnBody = fnMatch ? fnMatch[0] : ""
	assert(/if\s*\(\s*!ENABLE_LEGACY_API_SPORTS_CACHE\s*\)\s*return\s*Promise\.resolve\(\)/.test(fnBody),
		"early-return no-op when flag is off")
	// Original full-overwrite body still present (for rollback).
	assert(/fs\.promises\.writeFile\(CACHE_FILE/.test(fnBody),
		"original writeFile path preserved behind the gate (rollback works)")
}

function part4_setIntervalGated() {
	console.log("\n=== PART 4 — 60s setInterval gated by env flag ===\n")
	assert(/if\s*\(\s*ENABLE_LEGACY_API_SPORTS_CACHE\s*\)\s*\{[\s\S]{0,800}?setInterval\(/.test(serverSrc),
		"setInterval wrapped in `if (ENABLE_LEGACY_API_SPORTS_CACHE)` block")
	// The 60s cadence is preserved inside the gate.
	const intervalGate = serverSrc.match(/if\s*\(\s*ENABLE_LEGACY_API_SPORTS_CACHE\s*\)\s*\{[\s\S]{0,800}?\}\s*\n/m)
	assert(intervalGate != null, "gate block extracted")
	const gateBody = intervalGate ? intervalGate[0] : ""
	assert(/setInterval\(/.test(gateBody) && /60000\)/.test(gateBody),
		"60s cadence (60000ms) preserved inside the gate")
}

function part5_orphanMarkers() {
	console.log("\n=== PART 5 — @orphan markers present ===\n")
	// Header marker on module-globals
	assert(/@orphan \(Phase F1 — gated behind ENABLE_LEGACY_API_SPORTS_CACHE\)/.test(serverSrc),
		"module-global header @orphan marker")
	// Save function
	assert(/@orphan \(Phase F1 — overwrite path disabled by default\)/.test(serverSrc),
		"saveApiSportsCachesToDisk @orphan marker")
	// Load function
	assert(/@orphan \(Phase F1 — populates module-globals that no live caller reads\)/.test(serverSrc),
		"loadApiSportsCachesFromDisk @orphan marker")
	// setInterval
	assert(/@orphan \(Phase F1 — 60s autosave interval gated by ENABLE_LEGACY_API_SPORTS_CACHE\)/.test(serverSrc),
		"setInterval @orphan marker")
	// playerStatsCacheTimes fourth module-global
	assert(/@orphan \(Phase F1 — fourth legacy module-global/.test(serverSrc),
		"playerStatsCacheTimes @orphan marker")
	// Cached fetchers
	assert(/@orphan \(Phase F1 — legacy cached fetcher; no live caller\)/.test(serverSrc),
		"cached fetcher @orphan marker present")
	const fetcherOrphanCount = (serverSrc.match(/@orphan \(Phase F1 — legacy cached fetcher; no live caller\)/g) || []).length
	assert(fetcherOrphanCount === 2, "both cached fetchers marked @orphan",
		{ count: fetcherOrphanCount })
}

function part6_canonicalOwnerReferenced() {
	console.log("\n=== PART 6 — canonical owner B referenced ===\n")
	assert(/http\/nbaIsolatedRoutes\.js:saveApiSportsDiskCache/.test(serverSrc),
		"canonical owner saveApiSportsDiskCache referenced")
	assert(/http\/nbaIsolatedRoutes\.js:loadApiSportsDiskCache/.test(serverSrc),
		"canonical owner loadApiSportsDiskCache referenced")
	assert(/http\/nbaIsolatedRoutes\.js:enrichRowsWithRecentForm/.test(serverSrc),
		"canonical consumer enrichRowsWithRecentForm referenced")
}

function part7_noCodeDeletion() {
	console.log("\n=== PART 7 — no code DELETED (rollback safe) ===\n")
	// Original full-overwrite body still present inside the save function.
	assert(/Object\.fromEntries\(playerIdCache\.entries\(\)\)/.test(serverSrc),
		"playerIdCache serialization still present (gated)")
	assert(/Object\.fromEntries\(playerStatsCache\.entries\(\)\)/.test(serverSrc),
		"playerStatsCache serialization still present (gated)")
	assert(/Object\.fromEntries\(playerStatsCacheTimes\.entries\(\)\)/.test(serverSrc),
		"playerStatsCacheTimes serialization still present (gated)")
	assert(/Array\.from\(playerLookupMissCache\.values\(\)\)/.test(serverSrc),
		"playerLookupMissCache serialization still present (gated)")
	// Cached fetchers still present
	assert(/async function fetchApiSportsPlayerIdCached/.test(serverSrc),
		"fetchApiSportsPlayerIdCached body still present")
	assert(/async function fetchApiSportsPlayerStatsCached/.test(serverSrc),
		"fetchApiSportsPlayerStatsCached body still present")
}

function part8_ownerBUnchanged() {
	console.log("\n=== PART 8 — owner B (nbaIsolatedRoutes.js) untouched ===\n")
	assert(/function loadApiSportsDiskCache\(\)/.test(nbaIsoSrc),
		"loadApiSportsDiskCache present")
	assert(/function saveApiSportsDiskCache\(next\)/.test(nbaIsoSrc),
		"saveApiSportsDiskCache present")
	// The read-merge-write pattern must still be intact.
	assert(/const prev = loadApiSportsDiskCache\(\)/.test(nbaIsoSrc),
		"read-merge-write read step present")
	assert(/const merged = \{[\s\S]*?\.\.\.prev,/.test(nbaIsoSrc),
		"read-merge-write merge step present")
	assert(/fs\.writeFileSync\(API_SPORTS_CACHE_FILE/.test(nbaIsoSrc),
		"read-merge-write write step present")
	// And the canonical disk-cache filename is shared with owner A by intent.
	assert(/path\.join\(DEFAULT_BACKEND_ROOT,\s*["']api-sports-cache\.json["']\)/.test(nbaIsoSrc),
		"API_SPORTS_CACHE_FILE path constant points to shared file")
}

function part9_diskFileState() {
	console.log("\n=== PART 9 — current disk file inspection (informational) ===\n")
	if (!fs.existsSync(cacheFile)) {
		console.log("  (info) api-sports-cache.json does not exist yet — first boot will create it")
		return
	}
	const raw = fs.readFileSync(cacheFile, "utf8")
	let parsed = null
	try { parsed = JSON.parse(raw) } catch (_) {}
	assert(parsed != null, "disk file parses as JSON",
		{ rawHead: raw.slice(0, 120) })
	console.log("  (info) playerIdCache size:",   parsed?.playerIdCache   ? Object.keys(parsed.playerIdCache).length   : 0)
	console.log("  (info) playerStatsCache size:", parsed?.playerStatsCache ? Object.keys(parsed.playerStatsCache).length : 0)
	console.log("  (info) playerStatsCacheTimes size:", parsed?.playerStatsCacheTimes ? Object.keys(parsed.playerStatsCacheTimes).length : 0)
	console.log("  (info) playerLookupMissCache size:", Array.isArray(parsed?.playerLookupMissCache) ? parsed.playerLookupMissCache.length : 0)
	console.log("  (info) Post Phase F1: subsequent owner-B writes will accumulate; owner-A no longer overwrites.")
}

function part10_serverModuleLoadsCleanly() {
	console.log("\n=== PART 10 — server.js parses cleanly (no syntax regression) ===\n")
	// We can't safely `require('./server')` here (it would start the listener);
	// instead, use Node's --check-equivalent via a child process.
	const { spawnSync } = require("child_process")
	const r = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", "server.js")],
		{ encoding: "utf8" })
	assert(r.status === 0, "node --check server.js → exit 0",
		{ stderr: r.stderr?.slice(0, 400) })
}

function run() {
	try {
		part1_envFlagConstant()
		part2_bootProbe()
		part3_saveFunctionNoOp()
		part4_setIntervalGated()
		part5_orphanMarkers()
		part6_canonicalOwnerReferenced()
		part7_noCodeDeletion()
		part8_ownerBUnchanged()
		part9_diskFileState()
		part10_serverModuleLoadsCleanly()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
