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

function part2_playerIdRequestSendsTeamAndSeason() {
	console.log("\n=== PART 2 — F6.3: fetchApiSportsPlayerId uses team-roster contract (team+season, no search) ===\n")

	// requestParams object form: `{ team: Number(resolvedApiTeamId), season: NBA_API_SPORTS_SEASON }`
	assert(/requestParams\s*=\s*\{\s*team:\s*Number\(resolvedApiTeamId\),\s*season:\s*NBA_API_SPORTS_SEASON\s*\}/.test(nbaSrc),
		"requestParams = { team: Number(resolvedApiTeamId), season: NBA_API_SPORTS_SEASON }")

	// axios call uses params: requestParams against /players
	assert(/v2\.nba\.api-sports\.io\/players[\s\S]{0,200}params:\s*requestParams/.test(nbaSrc),
		"axios.get('/players') uses params: requestParams")

	// `search` parameter must NOT be present in fetchApiSportsPlayerId anymore —
	// it's incompatible with the team-roster contract. The only `search:` form
	// the regex would catch is inside requestParams — which we've eliminated.
	assert(!/requestParams\s*=\s*\{\s*search:/.test(nbaSrc),
		"no `requestParams = { search: ... }` form remains (was the pre-F6.3 broken contract)")
	assert(!/params:\s*\{\s*search:\s*playerName/.test(nbaSrc),
		"no bare `params: { search: playerName, ... }` axios call remains")
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

	// Phase F6.3 refactored to read from a `responseEnvelope` local instead
	// of `response?.data` directly. Accept either form.
	assert(/lastPlayerIdResponseErrors\s*=\s*[\s\S]{0,80}?(response\?\.data\?\.errors|responseEnvelope\?\.errors)/.test(nbaSrc),
		"lastPlayerIdResponseErrors sourced from API envelope (.errors)")
	assert(/lastPlayerIdResponseResults\s*=\s*[\s\S]{0,120}?(response\?\.data\?\.results|responseEnvelope\?\.results)/.test(nbaSrc),
		"lastPlayerIdResponseResults sourced from API envelope (.results)")
	assert(/lastPlayerIdResponseParameters\s*=\s*[\s\S]{0,80}?(response\?\.data\?\.parameters|responseEnvelope\?\.parameters)/.test(nbaSrc),
		"lastPlayerIdResponseParameters sourced from API envelope (.parameters)")
}

function part6_resolutionProbeRateLimited() {
	console.log("\n=== PART 6 — F5-C: [NBA-API-SPORTS-PLAYER-RESOLUTION] probe rate-limited ===\n")

	// Phase F6.3 introduced an additional emission site for the early-exit
	// `no_team_skipped` branch. Both emission sites share the same
	// _loggedFirstPlayerResolution flag, so runtime emission is still
	// once-per-process. The fixture verifies that EVERY emission site is
	// preceded by a rate-limit guard, rather than counting sites.
	const probeRegex = /console\.log\("\[NBA-API-SPORTS-PLAYER-RESOLUTION\]"/g
	const probeMatches = [...nbaSrc.matchAll(probeRegex)]
	assert(probeMatches.length >= 1,
		"at least one [NBA-API-SPORTS-PLAYER-RESOLUTION] emission site present",
		{ count: probeMatches.length })

	// Each emission site must be preceded by the rate-limit guard within
	// a small window (the if-block opening + the flag flip).
	for (const m of probeMatches) {
		const start = Math.max(0, m.index - 200)
		const window = nbaSrc.slice(start, m.index)
		assert(/if \(!__nbaCacheDiag\._loggedFirstPlayerResolution\)/.test(window),
			"emission site at index " + m.index + " is preceded by _loggedFirstPlayerResolution guard")
	}

	assert(/_loggedFirstPlayerResolution/.test(nbaSrc),
		"_loggedFirstPlayerResolution flag present on __nbaCacheDiag")
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

function part14_phaseF6RegistryAndDualResolver() {
	console.log("\n=== PART 14 — Phase F6.2 canonical NBA team registry + dual resolver ===\n")
	// Registry presence + correct entry count
	assert(/const NBA_TEAM_REGISTRY = \[/.test(nbaSrc),
		"NBA_TEAM_REGISTRY constant declared at module scope")
	const entryMatches = nbaSrc.match(/\{ abbr: "[A-Z]{3}",\s*apiTeamId:\s*\d+,/g) || []
	assert(entryMatches.length === 30,
		"NBA_TEAM_REGISTRY contains exactly 30 entries",
		{ found: entryMatches.length })

	// Both resolvers present; abbr wrapper preserved for backward compat
	assert(/function resolveCanonicalNbaTeam\(raw\)/.test(nbaSrc),
		"resolveCanonicalNbaTeam(raw) → { abbr, apiTeamId } | null present")
	assert(/function resolveCanonicalNbaTeamAbbr\(raw\)/.test(nbaSrc),
		"resolveCanonicalNbaTeamAbbr(raw) wrapper preserved")

	// Numeric id placed on the wire — NOT abbreviation. Phase F6.3 inlined
	// this inside the requestParams object literal (different shape from F6.2,
	// where it was assigned conditionally after construction).
	assert(/team:\s*Number\(resolvedApiTeamId\)/.test(nbaSrc),
		"fetchApiSportsPlayerId places `team: Number(resolvedApiTeamId)` inside requestParams")
	assert(/Number\.isFinite\(resolvedApiTeamId\)/.test(nbaSrc),
		"numeric guard around team param (no NaN/null leakage onto wire)")

	// Env override hook present
	assert(/NBA_API_SPORTS_TEAM_ID_OVERRIDES/.test(nbaSrc),
		"env override hook (NBA_API_SPORTS_TEAM_ID_OVERRIDES) present")
}

function part15_phaseF6DiagnosticsSurface() {
	console.log("\n=== PART 15 — Phase F6.2 diagnostics surface ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	for (const k of [
		"lastPlayerIdRequestTeam",
		"lastPlayerIdResolvedTeamAbbr",
		"lastPlayerIdResolvedApiTeamId",
	]) {
		assert(Object.prototype.hasOwnProperty.call(d.apiSportsResponseDiagnostics, k),
			`apiSportsResponseDiagnostics has key: ${k}`)
		assert(d.apiSportsResponseDiagnostics[k] === null,
			`${k} starts null after reset (no synthesis)`)
	}
	// Defensive copy semantics
	d.apiSportsResponseDiagnostics.lastPlayerIdResolvedApiTeamId = 99999
	const d2 = getNbaCacheDiagnostics()
	assert(d2.apiSportsResponseDiagnostics.lastPlayerIdResolvedApiTeamId === null,
		"defensive copy: internal lastPlayerIdResolvedApiTeamId unmutated")

	// Static check — reset path includes the new field
	assert(/lastPlayerIdResolvedApiTeamId:\s+null/.test(nbaSrc),
		"reset path explicitly clears lastPlayerIdResolvedApiTeamId")
}

function part16_phaseF6ResolverBehavior() {
	console.log("\n=== PART 16 — Phase F6.2 resolver behavior (in-process) ===\n")
	// Extract the registry + resolver block and exercise it via Function().
	const block = nbaSrc.match(/const NBA_TEAM_REGISTRY = \[[\s\S]*?\]\n\n\/\/ Optional override[\s\S]*?function resolveCanonicalNbaTeamAbbr\(raw\) \{[\s\S]*?\n\}/)?.[0]
	assert(!!block, "isolated registry+resolver block extractable from source")
	if (!block) return
	const factory = new Function("process",
		block + "; return { resolveCanonicalNbaTeam };")
	const { resolveCanonicalNbaTeam } = factory({ env: {} })

	// Operator's failing case — full franchise name MUST resolve now.
	const sac = resolveCanonicalNbaTeam("SACRAMENTO KINGS")
	assert(sac && sac.abbr === "SAC" && Number.isFinite(sac.apiTeamId),
		'"SACRAMENTO KINGS" → { abbr:"SAC", apiTeamId:<finite> }',
		{ resolved: sac })

	// All 30 canonical abbrs resolve to a finite, unique apiTeamId
	const abbrs = ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW",
		"HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK",
		"OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"]
	const seen = new Set()
	let allOk = true
	for (const a of abbrs) {
		const r = resolveCanonicalNbaTeam(a)
		if (!r || r.abbr !== a || !Number.isFinite(r.apiTeamId) || seen.has(r.apiTeamId)) {
			allOk = false
			break
		}
		seen.add(r.apiTeamId)
	}
	assert(allOk && seen.size === 30,
		"all 30 canonical abbrs resolve to unique finite apiTeamIds")

	// Full franchise names + cities + nicknames
	const cases = [
		["Detroit Pistons",     "DET"],
		["Los Angeles Lakers",  "LAL"],
		["Trail Blazers",       "POR"],
		["Philadelphia 76ers",  "PHI"],
		["Brooklyn Nets",       "BKN"],
		["Boston",              "BOS"],
		["Heat",                "MIA"],
		["Kings",               "SAC"],
		["BRK",                 "BKN"], // alias
		["WSH",                 "WAS"], // alias
		["CAVS",                "CLE"], // nickname alias
	]
	for (const [input, expectedAbbr] of cases) {
		const r = resolveCanonicalNbaTeam(input)
		assert(r && r.abbr === expectedAbbr && Number.isFinite(r.apiTeamId),
			`resolve(${JSON.stringify(input)}) → abbr=${expectedAbbr}, finite apiTeamId`,
			{ resolved: r })
	}

	// Rejections
	for (const bad of ["", "Unknown Team", "ZZZ", "ABC"]) {
		assert(resolveCanonicalNbaTeam(bad) === null,
			`resolve(${JSON.stringify(bad)}) === null`)
	}
	assert(resolveCanonicalNbaTeam(null) === null, "resolve(null) === null")
	assert(resolveCanonicalNbaTeam(undefined) === null, "resolve(undefined) === null")
}

function part17_phaseF6_3TeamRosterContract() {
	console.log("\n=== PART 17 — Phase F6.3 team-roster contract ===\n")
	// Doc header present near the function
	assert(/Phase F6\.3 — canonical API-NBA player-resolution contract/.test(nbaSrc),
		"Phase F6.3 doc header present in fetchApiSportsPlayerId")
	// The only roster-fetch request shape is { team, season }
	assert(/requestParams\s*=\s*\{\s*team:\s*Number\(resolvedApiTeamId\),\s*season:\s*NBA_API_SPORTS_SEASON\s*\}/.test(nbaSrc),
		"sole request-params shape: { team: Number, season }")
	// `search` is never inside an axios.get('/players') params block
	const playerCalls = (nbaSrc.match(/v2\.nba\.api-sports\.io\/players[\s\S]{0,300}?\}\)/g) || [])
	let anyHasSearch = false
	for (const call of playerCalls) {
		if (!/\/players\/statistics/.test(call) && /\bsearch:/.test(call)) anyHasSearch = true
	}
	assert(!anyHasSearch,
		"no `search:` param survives in any /players axios call (excluding /players/statistics)")
	// Client-side name matching present
	assert(/const want = normName\(playerName\)/.test(nbaSrc),
		"client-side name match: const want = normName(playerName)")
	assert(/for \(const r of roster\)/.test(nbaSrc),
		"client-side name match iterates the roster array")
	// Process-scoped memo
	assert(/const __nbaTeamRosterCache = new Map\(\)/.test(nbaSrc),
		"__nbaTeamRosterCache Map declared at module scope")
	assert(/__nbaTeamRosterCache\.get\(rosterKey\)/.test(nbaSrc),
		"roster memo: get(rosterKey)")
	assert(/__nbaTeamRosterCache\.set\(rosterKey, roster\)/.test(nbaSrc),
		"roster memo: set(rosterKey, roster) after fetch")
	assert(/const rosterKey = `\$\{resolvedApiTeamId\}\|\$\{NBA_API_SPORTS_SEASON\}`/.test(nbaSrc),
		"roster memo key shape: `<apiTeamId>|<season>`")
}

function part18_phaseF6_3DiagnosticsSurface() {
	console.log("\n=== PART 18 — Phase F6.3 diagnostics surface (match strategy + cache size) ===\n")
	resetNbaCacheDiagnostics()
	const d = getNbaCacheDiagnostics()
	// teamRosterCacheSize at top-level
	assert(Object.prototype.hasOwnProperty.call(d, "teamRosterCacheSize"),
		"top-level diagnostics expose teamRosterCacheSize")
	assert(d.teamRosterCacheSize === 0, "teamRosterCacheSize starts at 0 after reset")
	// lastPlayerIdMatchStrategy under apiSportsResponseDiagnostics
	assert(Object.prototype.hasOwnProperty.call(d.apiSportsResponseDiagnostics, "lastPlayerIdMatchStrategy"),
		"apiSportsResponseDiagnostics exposes lastPlayerIdMatchStrategy")
	assert(d.apiSportsResponseDiagnostics.lastPlayerIdMatchStrategy === null,
		"lastPlayerIdMatchStrategy starts null after reset")
	// Static: reset path clears the new fields
	assert(/lastPlayerIdMatchStrategy:\s+null/.test(nbaSrc),
		"reset path explicitly clears lastPlayerIdMatchStrategy")
	assert(/__nbaTeamRosterCache\.clear\(\)/.test(nbaSrc),
		"reset path clears __nbaTeamRosterCache")
}

function part19_syntaxCheck() {
	console.log("\n=== PART 19 — nbaIsolatedRoutes + server still parse cleanly ===\n")
	const { spawnSync } = require("child_process")
	for (const f of ["http/nbaIsolatedRoutes.js", "server.js"]) {
		const r = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", f)], { encoding: "utf8" })
		assert(r.status === 0, `node --check ${f} → exit 0`, { stderr: r.stderr?.slice(0, 400) })
	}
}

function run() {
	try {
		part1_sharedSeasonConstant()
		part2_playerIdRequestSendsTeamAndSeason()
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
		part14_phaseF6RegistryAndDualResolver()
		part15_phaseF6DiagnosticsSurface()
		part16_phaseF6ResolverBehavior()
		part17_phaseF6_3TeamRosterContract()
		part18_phaseF6_3DiagnosticsSurface()
		part19_syntaxCheck()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
