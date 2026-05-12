"use strict"

/**
 * MLB Phase 1 Contextual Intelligence — local verification script.
 *
 * Runs applyMlbContextualLayers against a synthetic fixture slate that
 * exercises every contextual layer:
 *   - HR prop in Coors (HR_FRIENDLY) with hot temp and out-to-CF wind
 *   - HR prop in Oracle (HR_SUPPRESSING) with cold temp and in-from-CF wind
 *   - batter strikeout prop with platoon-opp matchup
 *   - pitcher strikeouts prop (no opposing-pitcher data → kEnv shift = 0)
 *   - RBI prop with #4 lineup spot (LINEUP_HEART expected)
 *   - row missing handedness entirely (handednessContext stays null)
 *
 * Verifies:
 *   - module loads without exception
 *   - every row produces a deterministic, bounded shift
 *   - coverage diagnostics match expectations
 *   - no synthetic fields invented when data missing
 *
 * Exit codes: 0 = PASS, 1 = FAIL.
 *
 *   node backend/scripts/verifyMlbContextualPhase1.js
 */

const path = require("path")
const { applyMlbContextualLayers } =
	require("../pipeline/mlb/context/applyMlbContextualLayers")

function approxEqual(a, b, tol = 0.001) {
	return Math.abs(Number(a) - Number(b)) <= tol
}

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

function makeFixtureRows() {
	return [
		// 1. HR prop in Coors — HR_FRIENDLY park, hot temp, wind out
		{
			eventId: "evt-coors-001",
			player: "Synthetic Slugger",
			homeTeam: "Colorado Rockies",
			awayTeam: "Los Angeles Dodgers",
			team: "Colorado Rockies",
			opponentTeam: "Los Angeles Dodgers",
			marketKey: "batter_home_runs",
			marketFamily: "homeruns",
			propType: "home runs",
			side: "over",
			line: 0.5,
			odds: 450,
			batterHand: "R",
			pitcherHand: "L",
			lineupPosition: 4,
		},
		// 2. HR prop at Oracle Park — HR_SUPPRESSING, cold, wind in
		{
			eventId: "evt-oracle-002",
			player: "Synthetic Pull-Hitter",
			homeTeam: "San Francisco Giants",
			awayTeam: "Los Angeles Dodgers",
			team: "Los Angeles Dodgers",
			opponentTeam: "San Francisco Giants",
			marketKey: "batter_home_runs",
			marketFamily: "homeruns",
			propType: "home runs",
			side: "over",
			line: 0.5,
			odds: 700,
			batterHand: "L",
			pitcherHand: "R",
			lineupPosition: 3,
		},
		// 3. Batter strikeouts — platoon-opp matchup (L vs R)
		{
			eventId: "evt-stl-003",
			player: "Synthetic K-Magnet",
			homeTeam: "St. Louis Cardinals",
			awayTeam: "New York Mets",
			team: "New York Mets",
			opponentTeam: "St. Louis Cardinals",
			marketKey: "batter_strikeouts",
			marketFamily: "batting",
			propType: "batter strikeouts",
			side: "over",
			line: 1.5,
			odds: -110,
			batterHand: "L",
			pitcherHand: "R",
			lineupPosition: 7,
		},
		// 4. Pitcher Ks prop — no pitcher stat data → kEnvironmentShift = 0
		{
			eventId: "evt-nyy-004",
			player: "Synthetic Starter",
			homeTeam: "New York Yankees",
			awayTeam: "Boston Red Sox",
			team: "New York Yankees",
			opponentTeam: "Boston Red Sox",
			marketKey: "pitcher_strikeouts",
			marketFamily: "pitcher",
			propType: "pitcher strikeouts",
			side: "over",
			line: 6.5,
			odds: -120,
			batterHand: null,
			pitcherHand: "R",
			lineupPosition: null,
		},
		// 5. RBI prop, #4 lineup spot → LINEUP_HEART expected
		{
			eventId: "evt-bos-005",
			player: "Synthetic Cleanup",
			homeTeam: "Boston Red Sox",
			awayTeam: "Toronto Blue Jays",
			team: "Boston Red Sox",
			opponentTeam: "Toronto Blue Jays",
			marketKey: "batter_rbis",
			marketFamily: "batting",
			propType: "rbis",
			side: "over",
			line: 0.5,
			odds: 120,
			batterHand: "R",
			pitcherHand: "L",
			lineupPosition: 4,
		},
		// 6. Row with no handedness data — handednessContext null, lineup null
		{
			eventId: "evt-sea-006",
			player: "Synthetic Unknown",
			homeTeam: "Seattle Mariners",
			awayTeam: "Texas Rangers",
			team: "Seattle Mariners",
			opponentTeam: "Texas Rangers",
			marketKey: "batter_hits",
			marketFamily: "batting",
			propType: "hits",
			side: "over",
			line: 0.5,
			odds: -150,
			batterHand: null,
			pitcherHand: null,
			lineupPosition: null,
		},
	]
}

function makeFixtureEvents() {
	return [
		{ eventId: "evt-coors-001", homeTeam: "Colorado Rockies",     gameTime: "2026-05-12T20:10:00Z" },
		{ eventId: "evt-oracle-002", homeTeam: "San Francisco Giants", gameTime: "2026-05-12T20:15:00Z" },
		{ eventId: "evt-stl-003",   homeTeam: "St. Louis Cardinals",  gameTime: "2026-05-12T19:45:00Z" },
		{ eventId: "evt-nyy-004",   homeTeam: "New York Yankees",     gameTime: "2026-05-12T19:05:00Z" },
		{ eventId: "evt-bos-005",   homeTeam: "Boston Red Sox",       gameTime: "2026-05-12T19:10:00Z" },
		{ eventId: "evt-sea-006",   homeTeam: "Seattle Mariners",     gameTime: "2026-05-12T22:10:00Z" },
	]
}

function makeFixtureWeather() {
	return {
		"evt-coors-001": {
			temperature: 88, temp: 88, windSpeed: 12, windDirectionDeg: 225, forecastTimeUtc: "2026-05-12T20:00:00Z",
		},
		"evt-oracle-002": {
			temperature: 52, temp: 52, windSpeed: 14, windDirectionDeg: 45, forecastTimeUtc: "2026-05-12T20:00:00Z",
		},
		"evt-stl-003": {
			temperature: 70, temp: 70, windSpeed: 3, windDirectionDeg: 180, forecastTimeUtc: "2026-05-12T19:00:00Z",
		},
		"evt-bos-005": {
			temperature: 65, temp: 65, windSpeed: 5, windDirectionDeg: 200, forecastTimeUtc: "2026-05-12T19:00:00Z",
		},
		// evt-nyy-004 and evt-sea-006 intentionally missing → coverage check
	}
}

function makeFixtureParkFactors() {
	// Mirror the real shape; we only need a few teams for the fixture.
	return {
		"colorado rockies":     { hrFactor: 1.30 },
		"san francisco giants": { hrFactor: 0.85 },
		"st. louis cardinals":  { hrFactor: 1.00 },
		"new york yankees":     { hrFactor: 1.15 },
		"boston red sox":       { hrFactor: 1.10 },
		"seattle mariners":     { hrFactor: 0.95 },
	}
}

function run() {
	console.log("\n=== MLB Phase 1 Contextual Intelligence — Verification ===\n")
	const rows = makeFixtureRows()
	const events = makeFixtureEvents()
	const overrides = {
		weatherByEventId: makeFixtureWeather(),
		parkFactorsByTeam: makeFixtureParkFactors(),
		pitcherStatsByName: {},  // intentionally empty
		bullpenByTeam: {},       // intentionally empty
	}

	const result = applyMlbContextualLayers({ rows, events, overrides })

	console.log("\n--- coordinator output ---")
	assert(Array.isArray(result?.rows), "result.rows is array")
	assert(result.rows.length === 6, "6 rows in/out", { length: result.rows.length })
	assert(result.diagnostics != null, "diagnostics present")

	const [r1, r2, r3, r4, r5, r6] = result.rows

	console.log("\n--- row 1: Coors HR (HR_FRIENDLY park, hot, wind out) ---")
	assert(r1.parkContext?.hrEnvironmentTag === "HR_FRIENDLY", "Coors classified HR_FRIENDLY")
	assert(r1.weatherContext?.windDirectionTag === "out_to_cf", "Coors wind tag out_to_cf")
	assert(r1.weatherContext?.temperatureF === 88, "Coors temp 88F", { t: r1.weatherContext?.temperatureF })
	assert(r1.weatherContext?.carryShift > 0, "Coors carryShift > 0", { v: r1.weatherContext?.carryShift })
	assert(r1.parkContext?.hrFactorShift > 0, "Coors park hrFactorShift > 0", { v: r1.parkContext?.hrFactorShift })
	assert(r1.handednessContext?.platoonRelation === "opp", "Coors platoon opp (R vs L)")
	assert(r1.mlbContextualTags.includes("PARK_HR_FRIENDLY"), "Coors tagged PARK_HR_FRIENDLY")
	assert(r1.mlbContextualTags.includes("WIND_OUT"), "Coors tagged WIND_OUT")
	assert(r1.mlbContextualTags.includes("HOT_AIR_CARRY"), "Coors tagged HOT_AIR_CARRY")
	assert(r1.mlbContextualShift > 0, "Coors contextualShift > 0", { v: r1.mlbContextualShift })
	assert(r1.mlbContextualShift <= 0.10, "Coors contextualShift bounded ≤ 0.10")

	console.log("\n--- row 2: Oracle HR (HR_SUPPRESSING, cold, wind in) ---")
	assert(r2.parkContext?.hrEnvironmentTag === "HR_SUPPRESSING", "Oracle classified HR_SUPPRESSING")
	assert(r2.weatherContext?.windDirectionTag === "in_from_cf", "Oracle wind tag in_from_cf")
	assert(r2.weatherContext?.carryShift < 0, "Oracle carryShift < 0", { v: r2.weatherContext?.carryShift })
	assert(r2.parkContext?.hrFactorShift < 0, "Oracle park hrFactorShift < 0")
	assert(r2.mlbContextualTags.includes("PARK_HR_SUPPRESSING"), "Oracle tagged PARK_HR_SUPPRESSING")
	assert(r2.mlbContextualTags.includes("WIND_IN"), "Oracle tagged WIND_IN")
	assert(r2.mlbContextualTags.includes("COLD_DEAD_AIR"), "Oracle tagged COLD_DEAD_AIR")
	assert(r2.mlbContextualShift < 0, "Oracle contextualShift < 0", { v: r2.mlbContextualShift })

	console.log("\n--- row 3: Batter K, L vs R (PLATOON_OPP) ---")
	assert(r3.handednessContext?.platoonRelation === "opp", "row 3 platoon opp")
	assert(r3.handednessContext?.platoonTag === "L_vs_R", "row 3 platoonTag L_vs_R")
	assert(r3.mlbContextualSignal?.family === "batter_k", "row 3 family batter_k")
	// kEnvironmentShift = 0 because no pitcher stat data
	assert(r3.pitcherEnvironmentContext?.dataAvailable === false, "row 3 pitcher env shape-only")
	assert(r3.pitcherEnvironmentContext?.kEnvironmentShift === 0, "row 3 kEnvShift = 0")

	console.log("\n--- row 4: Pitcher Ks prop (no opposing-pitcher data) ---")
	assert(r4.mlbContextualSignal?.family === "pitcher", "row 4 family pitcher")
	assert(r4.pitcherEnvironmentContext != null, "row 4 pitcher env shape present")
	assert(r4.pitcherEnvironmentContext?.dataAvailable === false, "row 4 pitcher env no data")
	assert(r4.handednessContext == null, "row 4 handedness null (batterHand missing)")
	assert(r4.lineupContextV2 == null, "row 4 lineup null (lineupPosition missing)")

	console.log("\n--- row 5: RBI #4 (LINEUP_HEART) ---")
	assert(r5.lineupContextV2?.depth === "middle", "row 5 lineup middle")
	assert(r5.lineupContextV2?.lineupSpot === 4, "row 5 lineupSpot 4")
	assert(r5.mlbContextualSignal?.family === "rbi_runs_sb", "row 5 family rbi_runs_sb")
	assert(r5.mlbContextualTags.includes("LINEUP_HEART"), "row 5 tagged LINEUP_HEART")
	assert(r5.lineupContextV2?.opportunityShift > 0, "row 5 lineup opportunityShift > 0")

	console.log("\n--- row 6: missing handedness + lineup → null contexts ---")
	assert(r6.handednessContext == null, "row 6 handednessContext null")
	assert(r6.lineupContextV2 == null, "row 6 lineupContextV2 null")
	// park IS present (Seattle); weather absent (eventId not in fixture map)
	assert(r6.parkContext != null, "row 6 park context present (Seattle)")
	assert(r6.weatherContext == null, "row 6 weatherContext null (no fixture entry)")
	assert(r6.bullpenContext?.dataAvailable === false, "row 6 bullpen shape-only")

	console.log("\n--- diagnostics block ---")
	const d = result.diagnostics
	assert(d.rowsProcessed === 6, "rowsProcessed == 6")
	assert(d.coverage.weather === 4, "weather coverage == 4 (4 events with weather fixture)", d.coverage)
	assert(d.coverage.park === 6, "park coverage == 6 (all teams in fixture)")
	assert(d.coverage.handedness === 4, "handedness coverage == 4 (4 rows with both hands)")
	assert(d.coverage.pitcherEnvData === 0, "pitcherEnvData == 0 (no stats wired)")
	assert(d.coverage.bullpenData === 0, "bullpenData == 0 (no stats wired)")
	assert(d.coverage.lineup === 4, "lineup coverage == 4 (4 rows with spot)")
	assert(d.shiftStats.withShift >= 5, "≥5 rows produced a non-null shift")
	assert(d.shiftStats.abs.max <= 0.10, "|shift| max ≤ 0.10 (bounded)")
	assert(Object.keys(d.tagCounts || {}).length > 0, "tagCounts non-empty")

	console.log("\n--- sample diagnostic samples ---")
	assert(d.samples.firstHrSignal != null, "firstHrSignal captured")
	assert(d.samples.firstPitcherSignal != null, "firstPitcherSignal captured")
	assert(d.samples.firstRbiSignal != null, "firstRbiSignal captured")

	console.log("\n--- additive integrity ---")
	// Confirm we didn't overwrite existing fields
	assert(r1.player === "Synthetic Slugger", "row 1 player unchanged")
	assert(r1.odds === 450, "row 1 odds unchanged")
	assert(r1.line === 0.5, "row 1 line unchanged")
	assert(r1.marketKey === "batter_home_runs", "row 1 marketKey unchanged")

	console.log("\n--- contextual signal envelope shape (for raw_context_json) ---")
	const env = r1.mlbContextualSignal
	for (const k of ["family", "side", "weatherShift", "parkShift", "handednessShift", "pitcherEnvShift", "bullpenShift", "lineupShift", "total", "layersFired"]) {
		assert(Object.prototype.hasOwnProperty.call(env, k), `signal has key: ${k}`)
	}

	console.log("\n=== verification finished ===")
	if (process.exitCode === 1) {
		console.log("RESULT: FAIL")
	} else {
		console.log("RESULT: PASS")
	}
}

run()
