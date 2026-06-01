"use strict"

/**
 * Phase ESPN-Enrichment-1A verification — replaces 3 obsolete F-series fixtures
 * (verifyNbaApiSportsContractFix, verifyNbaCacheObservability,
 *  verifyNbaCacheabilityGate) which asserted on Owner-B API-Sports
 * instrumentation that became dead code on 2026-05-26 when the operator
 * killed the api-basketball subscription.
 *
 * Canonical NBA enrichment source: ESPN game logs via
 *   `backend/pipeline/nba/nbaRecentFormCache.js`
 * with the orchestrator hook in
 *   `backend/http/nbaIsolatedRoutes.js:enrichRowsWithRecentForm`
 * importing `enrichRowWithRecentForm` under the alias `enrichNbaRowFromEspn`.
 *
 * This fixture asserts:
 *   1. nbaRecentFormCache module exists with the canonical export surface.
 *   2. Constants present (MIN_SAMPLE_FOR_LAST5, MIN_SAMPLE_FOR_LAST10,
 *      MAX_DAYS_STALE, DEFAULT_DAYS_BACK).
 *   3. nbaIsolatedRoutes.js imports the canonical `enrichRowWithRecentForm`
 *      under the alias `enrichNbaRowFromEspn`.
 *   4. The orchestrator `enrichRowsWithRecentForm` calls `enrichNbaRowFromEspn`
 *      on each row (no API-Sports call sites remain in the body).
 *   5. The `[NBA-RECENT-FORM]` probe with `source:"espn_game_logs"` is emitted
 *      so operators can confirm ESPN canonical at runtime.
 *   6. Multiple downstream NBA pipeline modules consume nbaRecentFormCache —
 *      proving ESPN is the canonical authority across the NBA pipeline, not
 *      just a one-off enrichment helper.
 *   7. The retired Owner-B helpers remain `@orphan`-marked per Law 11 —
 *      they're preserved verbatim with their canonical-doctrine markers
 *      so the supersession lineage stays auditable.
 *
 *   node backend/scripts/verifyNbaEspnEnrichment.js
 */

const fs = require("fs")
const path = require("path")

function assert(cond, msg, ctx) {
	if (!cond) {
		console.log("FAIL —", msg)
		if (ctx !== undefined) console.log("  ctx:", JSON.stringify(ctx, null, 2))
		process.exitCode = 1
	} else {
		console.log("  OK —", msg)
	}
}

const NBA_RECENT_FORM_CACHE_PATH = path.join(__dirname, "..", "pipeline", "nba", "nbaRecentFormCache.js")
const NBA_ISOLATED_ROUTES_PATH   = path.join(__dirname, "..", "http", "nbaIsolatedRoutes.js")

function part1_nbaRecentFormCacheModuleExists() {
	console.log("\n=== PART 1 — ESPN canonical: nbaRecentFormCache module + exports ===\n")
	assert(fs.existsSync(NBA_RECENT_FORM_CACHE_PATH), "nbaRecentFormCache.js exists at canonical path")
	const mod = require(NBA_RECENT_FORM_CACHE_PATH)
	assert(typeof mod.enrichRowWithRecentForm === "function", "enrichRowWithRecentForm exported (canonical entry)")
	assert(typeof mod.getRecentForm === "function",           "getRecentForm exported")
	assert(typeof mod.getBinaryHitRates === "function",       "getBinaryHitRates exported")
	assert(typeof mod.enrichRowWithBinaryHitRates === "function", "enrichRowWithBinaryHitRates exported")
	assert(typeof mod.loadCacheFromDisk === "function",       "loadCacheFromDisk exported")
	assert(typeof mod.resetCache === "function",              "resetCache exported")
}

function part2_canonicalConstants() {
	console.log("\n=== PART 2 — canonical constants (calibration thresholds) ===\n")
	const mod = require(NBA_RECENT_FORM_CACHE_PATH)
	assert(Number.isFinite(Number(mod.MIN_SAMPLE_FOR_LAST5)),  "MIN_SAMPLE_FOR_LAST5 numeric")
	assert(Number.isFinite(Number(mod.MIN_SAMPLE_FOR_LAST10)), "MIN_SAMPLE_FOR_LAST10 numeric")
	assert(Number.isFinite(Number(mod.MAX_DAYS_STALE)),        "MAX_DAYS_STALE numeric")
	assert(Number.isFinite(Number(mod.DEFAULT_DAYS_BACK)),     "DEFAULT_DAYS_BACK numeric")
	assert(Number(mod.MIN_SAMPLE_FOR_LAST5) >= 1,              "MIN_SAMPLE_FOR_LAST5 ≥ 1 (sane lower bound)")
	assert(Number(mod.MAX_DAYS_STALE) >= 1,                    "MAX_DAYS_STALE ≥ 1 (sane lower bound)")
}

function part3_canonicalAliasImport() {
	console.log("\n=== PART 3 — nbaIsolatedRoutes.js imports canonical alias ===\n")
	const src = fs.readFileSync(NBA_ISOLATED_ROUTES_PATH, "utf8")
	assert(
		/const\s*\{\s*enrichRowWithRecentForm\s*:\s*enrichNbaRowFromEspn\s*\}\s*=\s*require\(\s*["']\.\.\/pipeline\/nba\/nbaRecentFormCache["']\s*\)/.test(src),
		"nbaIsolatedRoutes imports `enrichRowWithRecentForm: enrichNbaRowFromEspn` from nbaRecentFormCache"
	)
}

function part4_orchestratorBody() {
	console.log("\n=== PART 4 — enrichRowsWithRecentForm orchestrator calls ESPN canonical ===\n")
	const src = fs.readFileSync(NBA_ISOLATED_ROUTES_PATH, "utf8")
	const fnMatch = src.match(/async\s+function\s+enrichRowsWithRecentForm\s*\([^)]*\)\s*\{[\s\S]*?\n\}/m)
	assert(fnMatch !== null, "enrichRowsWithRecentForm function body extractable")
	if (!fnMatch) return
	const body = fnMatch[0]
	assert(/enrichNbaRowFromEspn\s*\(\s*row\s*\)/.test(body),
		"orchestrator body calls enrichNbaRowFromEspn(row) per-row")
	assert(!/fetchApiSportsPlayerId\s*\(/.test(body),
		"orchestrator body does NOT call dead-orphan fetchApiSportsPlayerId")
	assert(!/fetchApiSportsPlayerStats\s*\(/.test(body),
		"orchestrator body does NOT call dead-orphan fetchApiSportsPlayerStats")
	assert(!/recordCacheWriteSkip\s*\(/.test(body),
		"orchestrator body does NOT call dead-orphan recordCacheWriteSkip")
}

function part5_runtimeProbe() {
	console.log("\n=== PART 5 — runtime probe [NBA-RECENT-FORM] with source:\"espn_game_logs\" ===\n")
	const src = fs.readFileSync(NBA_ISOLATED_ROUTES_PATH, "utf8")
	assert(/\[NBA-RECENT-FORM\]/.test(src),
		"[NBA-RECENT-FORM] probe tag emitted at runtime")
	assert(/source:\s*["']espn_game_logs["']/.test(src),
		"probe payload carries source:\"espn_game_logs\" for operator observability")
}

function part6_downstreamConsumers() {
	console.log("\n=== PART 6 — multiple downstream NBA pipeline modules consume nbaRecentFormCache ===\n")
	const consumers = [
		"backend/pipeline/nba/buildNbaBestBetsBoard.js",
		"backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js",
		"backend/pipeline/nba/buildNbaDefensiveProps.js",
		"backend/pipeline/nba/nbaRoleContextDeriver.js",
	]
	for (const rel of consumers) {
		const fp = path.join(__dirname, "..", "..", rel)
		const exists = fs.existsSync(fp)
		assert(exists, `consumer source present: ${rel}`)
		if (!exists) continue
		const src = fs.readFileSync(fp, "utf8")
		assert(/require\(\s*["']\.\/nbaRecentFormCache["']\s*\)/.test(src) ||
		       /require\(\s*["']\.\.\/nba\/nbaRecentFormCache["']\s*\)/.test(src),
			`${rel} requires nbaRecentFormCache`)
	}
}

function part7_ownerBOrphanPreservation() {
	console.log("\n=== PART 7 — Owner-B (dead API-Sports) helpers still @orphan-marked (Law 11) ===\n")
	const src = fs.readFileSync(NBA_ISOLATED_ROUTES_PATH, "utf8")
	// Limit bumped to 2000 chars because the F3 cacheability-gate JSDoc is the
	// longest of the three (~1330 chars) per the verbatim @orphan-doctrine cite.
	const fetchIdMatch = src.match(/(@orphan \(Law 11\) — Phase F6\.3[\s\S]{0,2000}?)async\s+function\s+fetchApiSportsPlayerId/)
	assert(fetchIdMatch !== null, "fetchApiSportsPlayerId preceded by @orphan (Law 11) marker")
	const fetchStatsMatch = src.match(/(@orphan \(Law 11\) — Phase F5-A[\s\S]{0,2000}?)async\s+function\s+fetchApiSportsPlayerStats/)
	assert(fetchStatsMatch !== null, "fetchApiSportsPlayerStats preceded by @orphan (Law 11) marker")
	const recordSkipMatch = src.match(/(@orphan \(Law 11\) — Phase F3[\s\S]{0,2000}?)function\s+recordCacheWriteSkip/)
	assert(recordSkipMatch !== null, "recordCacheWriteSkip preceded by @orphan (Law 11) marker")
}

function run() {
	try {
		part1_nbaRecentFormCacheModuleExists()
		part2_canonicalConstants()
		part3_canonicalAliasImport()
		part4_orchestratorBody()
		part5_runtimeProbe()
		part6_downstreamConsumers()
		part7_ownerBOrphanPreservation()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
