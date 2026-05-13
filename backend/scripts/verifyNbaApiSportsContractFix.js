"use strict"

/**
 * Phase F5 — API-Sports player-resolution contract fix verification.
 *
 * Confirms the three F5 patches landed correctly in
 * backend/http/nbaIsolatedRoutes.js:
 *
 *   F5-A — Shared NBA_API_SPORTS_SEASON constant used by BOTH player-id lookup
 *          AND player-stats lookup. The literal `season: 2025` must be gone
 *          from the two axios call sites; the only remaining literal is the
 *          constant's own declaration.
 *
 *   F5-B — apiSportsResponseDiagnostics surfaces the upstream envelope:
 *          lastPlayerIdResponseErrors, lastPlayerIdResponseResults,
 *          lastPlayerIdResponseParameters. These are populated unconditionally
 *          on every fetchApiSportsPlayerId call.
 *
 *   F5-C — exactly one rate-limited [NBA-API-SPORTS-PLAYER-RESOLUTION] probe
 *          per process, gated on _loggedFirstPlayerResolution. The Phase F3
 *          [NBA-CACHEABILITY-GATE] probe must still be present and remain
 *          its own emission site (no collapse).
 *
 * Also confirms no regression in:
 *   - Phase F3 cacheability-gate instrumentation
 *   - Phase F2 cache observability
 *   - Phase F1 legacy cache gating
 *   - Module export shape (getNbaCacheDiagnostics, resetNbaCacheDiagnostics)
 *   - Source files still parse cleanly under `node --check`.
 *
 *   node backend/scripts/verifyNbaApiSportsContractFix.js
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

function part1_sharedSeasonConstant() {
	console.log("\n=== PART 1 — F5-A: shared NBA_API_SPORTS_SEASON constant ===\n")

	// Constant declared exactly once at module scope, equal to 2025.
	const declMatches = nbaSrc.match(/^const\s+NBA_API_SPORTS_SEASON\s*=\s*(\d+)\s*$/gm) || []
	assert(declMatches.length === 1,
		"NBA_API_SPORTS_SEASON declared exactly once at module scope",
		{ count: declMatches.length, matches: declMatches })

	const m = /const\s+NBA_API_SPORTS_SEASON\s*=\s*(\d+)/.exec(nbaSrc)
	assert(m && Number(m[1]) === 2025,
		"NBA_API_SPORTS_SEASON === 2025 (the YYYY in YYYY-YYYY+1 API-Sports convention)",
		{ value: m && m[1] })

	// Both axios call sites reference the constant name.
	const usageCount = (nbaSrc.match(/season:\s*NBA_API_SPORTS_SEASON/g) || []).length
	assert(usageCount >= 2,
		"NBA_API_SPORTS_SEASON referenced by BOTH player-id and player-stats axios calls",
		{ usageCount })

	// The pre-F5 hardcoded literal `season: 2025` (with the literal, not the
	// constant) is no longer present in either call site.
	assert(!/season:\s*2025/.test(nbaSrc),
		"no `season: 2025` literal remains (all replaced with constant)",
		{ stillPresent: /season:\s*2025/.test(nbaSrc) })
}

function part2_playerIdRequestSendsSeason() {
	console.log("\n=== PART 2 — F5-A: fetchApiSportsPlayerId sends season alongside search ===\n")

	// The new requestParams object form: `{ search: playerName, season: NBA_API_SPORTS_SEASON }`
	assert(/const\s+requestParams\s*=\s*\{\s*search:\s*playerName,\s*season:\s*NBA_API_SPORTS_SEASON\s*\}/.test(nbaSrc),
		"requestParams = { search: playerName, season: NBA_API_SPORTS_SEASON }")

	// axios is called with that requestParams (not a bare `{ search }`).
	assert(/v2\.nba\.api-sports\.io\/players[\s\S]{0,200}params:\s*requestParams/.test(nbaSrc),
		"axios.get('/players') uses params: requestParams")

	// Defensive: no bare `{ search: playerName }` axios call remains (which
	// would be the pre-F5 broken contract).
	assert(!/params:\s*\{\s*search:\s*playerName\s*\}/.test(nbaSrc),
		"no bare `params: { search: playerName }` (pre-F5 broken contract) remains")
}

function part3_playerStatsRequestSendsSharedSeason() {
	console.log("\n=== PART 3 — F5-A: fetchApiSportsPlayerStats uses shared constant ===\n")

	assert(/params:\s*\{\s*id:\s*playerId,\s*season:\s*NBA_API_SPORTS_SEASON\s*\}/.test(nbaSrc),
		"fetchApiSportsPlayerStats sends { id: playerId, season: NBA_API_SPORTS_SEASON }")
}

function part4_envelopeFieldsExposed() {
	console.log("\n=== PART 4 — F5-B: response-envelope fields on diagnostics ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()

	for (const k of [
		"lastPlayerIdResponseErrors",
		"lastPlayerIdResponseResults",
		"lastPlayerIdResponseParameters",
	]) {
		assert(Object.prototype.hasOwnProperty.call(d.apiSportsResponseDiagnostics, k),
			`apiSportsResponseDiagnostics has key: ${k}`)
		assert(d.apiSportsResponseDiagnostics[k] === null,
			`${k} starts as null after reset (no synthesis)`)
	}
}

function part5_envelopeCapturedFromResponse() {
	console.log("\n=== PART 5 — F5-B: envelope fields populated from response.data on every call ===\n")

	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdResponseErrors\s*=\s*[\s\S]*?response\?\.data\?\.errors/.test(nbaSrc),
		"lastPlayerIdResponseErrors sourced from response.data.errors")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdResponseResults\s*=\s*[\s\S]*?response\?\.data\?\.results/.test(nbaSrc),
		"lastPlayerIdResponseResults sourced from response.data.results (coerced via Number)")
	assert(/__nbaCacheDiag\.apiSportsResponseDiagnostics\.lastPlayerIdResponseParameters\s*=\s*[\s\S]*?response\?\.data\?\.parameters/.test(nbaSrc),
		"lastPlayerIdResponseParameters sourced from response.data.parameters")
}

function part6_resolutionProbeRateLimited() {
	console.log("\n=== PART 6 — F5-C: [NBA-API-SPORTS-PLAYER-RESOLUTION] probe rate-limited ===\n")

	const probeCount = (nbaSrc.match(/console\.log\("\[NBA-API-SPORTS-PLAYER-RESOLUTION\]"/g) || []).length
	assert(probeCount === 1,
		"exactly one console.log emission site for [NBA-API-SPORTS-PLAYER-RESOLUTION]",
		{ probeCount })

	assert(/_loggedFirstPlayerResolution/.test(nbaSrc),
		"_loggedFirstPlayerResolution flag present on __nbaCacheDiag")
	assert(/if \(!__nbaCacheDiag\._loggedFirstPlayerResolution\)/.test(nbaSrc),
		"rate-limit guard checks _loggedFirstPlayerResolution before logging")
	assert(/__nbaCacheDiag\._loggedFirstPlayerResolution\s*=\s*true/.test(nbaSrc),
		"flag flips to true after first emission")
}

function part7_phaseF3CacheabilityGateIntact() {
	console.log("\n=== PART 7 — Phase F3 [NBA-CACHEABILITY-GATE] probe still present (no regression) ===\n")
	const probeCount = (nbaSrc.match(/console\.log\("\[NBA-CACHEABILITY-GATE\]"/g) || []).length
	assert(probeCount === 1, "Phase F3 cacheability-gate probe still emits exactly once per reason kind",
		{ probeCount })
	assert(/__nbaCacheDiag\._loggedReasonKinds = new Set\(\)/.test(nbaSrc),
		"_loggedReasonKinds Set still present from Phase F3")
}

function part8_phaseF3SkipSitesIntact() {
	console.log("\n=== PART 8 — Phase F3 recordCacheWriteSkip call sites preserved ===\n")
	const totalRefs = (nbaSrc.match(/recordCacheWriteSkip\(/g) || []).length
	const definitions = (nbaSrc.match(/function recordCacheWriteSkip\(/g) || []).length
	const skipCalls = totalRefs - definitions
	assert(skipCalls === 3, "still exactly 3 recordCacheWriteSkip call sites",
		{ totalRefs, definitions, skipCalls })

	assert(/recordCacheWriteSkip\(\s*["']PLAYER_ID_API_RETURNED_NULL["']/.test(nbaSrc),
		"PLAYER_ID_API_RETURNED_NULL skip site preserved")
	assert(/recordCacheWriteSkip\(\s*["']STATS_API_RETURNED_EMPTY["']/.test(nbaSrc),
		"STATS_API_RETURNED_EMPTY skip site preserved")
	assert(/recordCacheWriteSkip\(\s*["']PLAYER_THROWN_ERROR["']/.test(nbaSrc),
		"PLAYER_THROWN_ERROR skip site preserved")
}

function part9_resetClearsEnvelopeFields() {
	console.log("\n=== PART 9 — resetNbaCacheDiagnostics clears F5-B fields + F5-C flag ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	assert(d.apiSportsResponseDiagnostics.lastPlayerIdResponseErrors === null,
		"lastPlayerIdResponseErrors === null after reset")
	assert(d.apiSportsResponseDiagnostics.lastPlayerIdResponseResults === null,
		"lastPlayerIdResponseResults === null after reset")
	assert(d.apiSportsResponseDiagnostics.lastPlayerIdResponseParameters === null,
		"lastPlayerIdResponseParameters === null after reset")

	// Static check: reset function explicitly resets the F5-C flag
	assert(/__nbaCacheDiag\._loggedFirstPlayerResolution\s*=\s*false/.test(nbaSrc),
		"reset path flips _loggedFirstPlayerResolution back to false")
}

function part10_diagnosticsReturnsDefensiveCopies() {
	console.log("\n=== PART 10 — getNbaCacheDiagnostics returns defensive copies of F5-B fields ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	// Mutate caller-side and confirm internal state immune.
	d.apiSportsResponseDiagnostics.lastPlayerIdResponseErrors = { synthetic: "MUTATED" }
	d.apiSportsResponseDiagnostics.lastPlayerIdResponseResults = 999
	d.apiSportsResponseDiagnostics.lastPlayerIdResponseParameters = { synthetic: "MUTATED" }
	const d2 = getNbaCacheDiagnostics()
	assert(d2.apiSportsResponseDiagnostics.lastPlayerIdResponseErrors === null,
		"internal lastPlayerIdResponseErrors unmutated")
	assert(d2.apiSportsResponseDiagnostics.lastPlayerIdResponseResults === null,
		"internal lastPlayerIdResponseResults unmutated")
	assert(d2.apiSportsResponseDiagnostics.lastPlayerIdResponseParameters === null,
		"internal lastPlayerIdResponseParameters unmutated")
}

function part11_phaseF2SemanticsIntact() {
	console.log("\n=== PART 11 — Phase F2 cache observability fields still present ===\n")
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

function part12_phaseF1LegacyGateIntact() {
	console.log("\n=== PART 12 — Phase F1 legacy cache gate still present in server.js ===\n")
	const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8")
	assert(/ENABLE_LEGACY_API_SPORTS_CACHE/.test(serverSrc),
		"server.js still gates the legacy owner-A cache loader on ENABLE_LEGACY_API_SPORTS_CACHE")
}

function part13_phaseF5DocBlockPresent() {
	console.log("\n=== PART 13 — Phase F5 documentation block present ===\n")
	assert(/Phase F5\s*[—-]\s*API-Sports request-contract correction/.test(nbaSrc),
		"Phase F5 doc block present near constant declaration")
	assert(/Phase F5-A\b/.test(nbaSrc), "Phase F5-A site documented inline at fetchApiSportsPlayerId")
	assert(/Phase F5-B\b/.test(nbaSrc), "Phase F5-B site documented inline at envelope-capture")
	assert(/Phase F5-C\b/.test(nbaSrc), "Phase F5-C site documented inline at probe emission")
}

function part14_syntaxCheck() {
	console.log("\n=== PART 14 — nbaIsolatedRoutes + server still parse cleanly ===\n")
	const { spawnSync } = require("child_process")
	for (const f of ["http/nbaIsolatedRoutes.js", "server.js"]) {
		const r = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", f)], { encoding: "utf8" })
		assert(r.status === 0, `node --check ${f} → exit 0`, { stderr: r.stderr?.slice(0, 400) })
	}
}

function run() {
	try {
		part1_sharedSeasonConstant()
		part2_playerIdRequestSendsSeason()
		part3_playerStatsRequestSendsSharedSeason()
		part4_envelopeFieldsExposed()
		part5_envelopeCapturedFromResponse()
		part6_resolutionProbeRateLimited()
		part7_phaseF3CacheabilityGateIntact()
		part8_phaseF3SkipSitesIntact()
		part9_resetClearsEnvelopeFields()
		part10_diagnosticsReturnsDefensiveCopies()
		part11_phaseF2SemanticsIntact()
		part12_phaseF1LegacyGateIntact()
		part13_phaseF5DocBlockPresent()
		part14_syntaxCheck()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
