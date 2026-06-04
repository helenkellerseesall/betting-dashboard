"use strict"

/**
 * MLB Phase 1B — Real Environmental Data verification script.
 *
 * Phase 1A already validated the contextual scaffolding (Phase 1 test still
 * passes — see verifyMlbContextualPhase1.js). Phase 1B adds:
 *   - Real weather fields (humidity, precipitation)
 *   - Dome / retractable handling via mlbParkMeta.json
 *   - Real pitcher stat plumbing (kRate now drives kEnvironmentShift)
 *   - Real bullpen workload plumbing (fatigueScore drives bullpenShift)
 *   - Market sanity filter (synthetic / non-player markets get skipped)
 *
 * This file does NOT hit the network — it provides fixture overrides through
 * applyMlbContextualLayers' `overrides` param to deterministically exercise
 * every Phase 1B branch.
 *
 *   node backend/scripts/verifyMlbContextualPhase1B.js
 */

const { applyMlbContextualLayers } =
	require("../pipeline/mlb/context/applyMlbContextualLayers")

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
		// 1. Coors HR — outdoor, hot, wind out, real pitcher with high kRate
		{
			eventId: "evt-coors-001", player: "Synthetic Slugger",
			homeTeam: "Colorado Rockies", awayTeam: "Los Angeles Dodgers",
			team: "Colorado Rockies", opponentTeam: "Los Angeles Dodgers",
			marketKey: "batter_home_runs", marketFamily: "homeruns",
			propType: "home runs", side: "over", line: 0.5, odds: 450,
			batterHand: "R", pitcherHand: "L", lineupPosition: 4,
			opposingPitcher: "Synthetic LH Ace",
		},
		// 2. Tampa Bay Rays — DOME → indoor, no wind/precip effect
		{
			eventId: "evt-tropicana-002", player: "Synthetic Dome Bat",
			homeTeam: "Tampa Bay Rays", awayTeam: "Boston Red Sox",
			team: "Tampa Bay Rays", opponentTeam: "Boston Red Sox",
			marketKey: "batter_home_runs", marketFamily: "homeruns",
			propType: "home runs", side: "over", line: 0.5, odds: 500,
			batterHand: "R", pitcherHand: "R", lineupPosition: 3,
			opposingPitcher: null,
		},
		// 3. Pitcher Ks WITH real pitcher stats (kRate=0.31 → kEnv shift)
		{
			eventId: "evt-nyy-003", player: "Synthetic K-Pitcher",
			homeTeam: "New York Yankees", awayTeam: "Boston Red Sox",
			team: "New York Yankees", opponentTeam: "Boston Red Sox",
			marketKey: "pitcher_strikeouts", marketFamily: "pitcher",
			propType: "pitcher strikeouts", side: "over", line: 6.5, odds: -120,
			batterHand: null, pitcherHand: "R", lineupPosition: null,
		},
		// 4. Batter row with tired opponent bullpen (fatigueScore=0.85)
		{
			eventId: "evt-bos-004", player: "Synthetic Late Inning Bat",
			homeTeam: "Boston Red Sox", awayTeam: "Toronto Blue Jays",
			team: "Boston Red Sox", opponentTeam: "Toronto Blue Jays",
			marketKey: "batter_total_bases", marketFamily: "batting",
			propType: "total bases", side: "over", line: 1.5, odds: 120,
			batterHand: "R", pitcherHand: "L", lineupPosition: 5,
			opposingPitcher: "Synthetic LH Starter",
		},
		// 5. Synthetic market — NRFI (marketFamily="special") → SKIP
		{
			eventId: "evt-mil-005", player: null,
			homeTeam: "Milwaukee Brewers", awayTeam: "Chicago Cubs",
			team: null, opponentTeam: null,
			marketKey: "no_run_first_inning", marketFamily: "special",
			propType: "NRFI", side: "yes", line: null, odds: -110,
		},
		// 6. Synthetic market — first_home_run with player attribution
		//    But classified as "special" → SKIP regardless
		{
			eventId: "evt-tex-006", player: "Synthetic FirstHR",
			homeTeam: "Texas Rangers", awayTeam: "Oakland Athletics",
			team: "Texas Rangers", opponentTeam: "Oakland Athletics",
			marketKey: "batter_first_home_run", marketFamily: "special",
			propType: "first home run", side: "over", line: 0.5, odds: 1500,
			batterHand: "L", pitcherHand: "R", lineupPosition: 2,
		},
		// 7. Game market (moneyline) → SKIP
		{
			eventId: "evt-cle-007", player: null,
			homeTeam: "Cleveland Guardians", awayTeam: "Chicago White Sox",
			team: "Cleveland Guardians", opponentTeam: "Chicago White Sox",
			marketKey: "h2h", marketFamily: "game",
			propType: "moneyline", side: "home", line: null, odds: -150,
		},
		// 8. Rainy outdoor game — precipitation flag fires
		{
			eventId: "evt-bal-008", player: "Synthetic Wet Bat",
			homeTeam: "Baltimore Orioles", awayTeam: "Washington Nationals",
			team: "Baltimore Orioles", opponentTeam: "Washington Nationals",
			marketKey: "batter_hits", marketFamily: "batting",
			propType: "hits", side: "over", line: 1.5, odds: 110,
			batterHand: "R", pitcherHand: "R", lineupPosition: 2,
		},
	]
}

function makeFixtureEvents() {
	return [
		{ eventId: "evt-coors-001",     homeTeam: "Colorado Rockies",     gameTime: "2026-05-12T20:10:00Z" },
		{ eventId: "evt-tropicana-002", homeTeam: "Tampa Bay Rays",       gameTime: "2026-05-12T18:10:00Z" },
		{ eventId: "evt-nyy-003",       homeTeam: "New York Yankees",     gameTime: "2026-05-12T19:05:00Z" },
		{ eventId: "evt-bos-004",       homeTeam: "Boston Red Sox",       gameTime: "2026-05-12T19:10:00Z" },
		{ eventId: "evt-mil-005",       homeTeam: "Milwaukee Brewers",    gameTime: "2026-05-12T20:10:00Z" },
		{ eventId: "evt-tex-006",       homeTeam: "Texas Rangers",        gameTime: "2026-05-12T20:05:00Z" },
		{ eventId: "evt-cle-007",       homeTeam: "Cleveland Guardians",  gameTime: "2026-05-12T18:10:00Z" },
		{ eventId: "evt-bal-008",       homeTeam: "Baltimore Orioles",    gameTime: "2026-05-12T18:35:00Z" },
	]
}

function makeFixtureWeather() {
	return {
		"evt-coors-001": {
			temperature: 88, temp: 88, windSpeed: 12, windDirectionDeg: 225,
			humidityPct: 45, precipitationMm: 0,
			forecastTimeUtc: "2026-05-12T20:00:00Z",
			_meta: { ingestedAt: "2026-05-12T19:55:00Z" },
		},
		// evt-tropicana-002 intentionally omitted — park meta should infer indoor
		"evt-nyy-003": {
			temperature: 70, temp: 70, windSpeed: 3, windDirectionDeg: 180,
			humidityPct: 60, precipitationMm: 0,
			forecastTimeUtc: "2026-05-12T19:00:00Z",
			_meta: { ingestedAt: "2026-05-12T18:55:00Z" },
		},
		"evt-bos-004": {
			temperature: 72, temp: 72, windSpeed: 6, windDirectionDeg: 200,
			humidityPct: 55, precipitationMm: 0,
			forecastTimeUtc: "2026-05-12T19:00:00Z",
		},
		"evt-bal-008": {
			temperature: 64, temp: 64, windSpeed: 8, windDirectionDeg: 90,
			humidityPct: 85, precipitationMm: 2.4,
			forecastTimeUtc: "2026-05-12T18:30:00Z",
		},
	}
}

function makeFixtureParkFactors() {
	return {
		"colorado rockies":     { hrFactor: 1.30 },
		"tampa bay rays":       { hrFactor: 0.95 },
		"new york yankees":     { hrFactor: 1.15 },
		"boston red sox":       { hrFactor: 1.10 },
		"milwaukee brewers":    { hrFactor: 1.05 },
		"texas rangers":        { hrFactor: 1.10 },
		"cleveland guardians":  { hrFactor: 1.00 },
		"baltimore orioles":    { hrFactor: 1.05 },
	}
}

function makeFixturePitcherStats() {
	// Keys match the deriver's normalizePitcherKey output (hyphens preserved).
	return {
		"synthetic k-pitcher": {
			playerId: 99001, fullName: "Synthetic K-Pitcher", throws: "R",
			kRate: 0.31, bbRate: 0.07, era: 3.20, source: "fixture",
		},
		"synthetic lh ace": {
			playerId: 99002, fullName: "Synthetic LH Ace", throws: "L",
			kRate: 0.27, bbRate: 0.08, era: 2.95, source: "fixture",
		},
		"synthetic lh starter": {
			playerId: 99003, fullName: "Synthetic LH Starter", throws: "L",
			kRate: 0.22, bbRate: 0.09, era: 4.10, source: "fixture",
		},
	}
}

function makeFixtureBullpenByTeam() {
	return {
		"toronto blue jays": {
			teamId: 141, teamName: "Toronto Blue Jays",
			recentInnings: 11.5, reliefAppearances: 12, highLeverageUses: 5,
			backToBackAppearances: 3, relieverCount: 7,
			closerCandidate: "Synthetic Closer", fatigueScore: 0.85,
			source: "fixture",
		},
	}
}

function makeFixtureParkMeta() {
	return {
		"colorado rockies":     { parkName: "Coors Field",     isDome: false, isRetractable: false, roofUsuallyClosed: false },
		"tampa bay rays":       { parkName: "Tropicana Field", isDome: true,  isRetractable: false, roofUsuallyClosed: true  },
		"new york yankees":     { parkName: "Yankee Stadium",  isDome: false, isRetractable: false, roofUsuallyClosed: false },
		"boston red sox":       { parkName: "Fenway Park",     isDome: false, isRetractable: false, roofUsuallyClosed: false },
		"texas rangers":        { parkName: "Globe Life Field", isDome: false, isRetractable: true,  roofUsuallyClosed: true },
		"baltimore orioles":    { parkName: "Oriole Park",     isDome: false, isRetractable: false, roofUsuallyClosed: false },
	}
}

function run() {
	console.log("\n=== MLB Phase 1B Contextual Intelligence — Verification ===\n")
	const result = applyMlbContextualLayers({
		rows: makeFixtureRows(),
		events: makeFixtureEvents(),
		overrides: {
			weatherByEventId: makeFixtureWeather(),
			parkFactorsByTeam: makeFixtureParkFactors(),
			pitcherStatsByName: makeFixturePitcherStats(),
			bullpenByTeam: makeFixtureBullpenByTeam(),
			parkMetaByTeam: makeFixtureParkMeta(),
		},
	})

	const [r1, r2, r3, r4, r5, r6, r7, r8] = result.rows

	console.log("\n--- row 1: Coors HR (outdoor, real weather + park) ---")
	assert(r1.weatherContext != null, "row 1 weather present")
	assert(r1.weatherContext?.isIndoor === false, "row 1 not indoor")
	assert(r1.weatherContext?.humidityPct === 45, "row 1 humidity 45%")
	assert(r1.weatherContext?.precipitationMm === 0, "row 1 precip 0")
	assert(r1.weatherContext?.windDirectionTag === "out_to_cf", "row 1 wind out_to_cf")
	assert(r1.weatherContext?.source === "openmeteo_live", "row 1 source openmeteo_live (entry has _meta.ingestedAt)")
	assert(r1.weatherContext?.parkName === "Coors Field", "row 1 parkName Coors Field")
	assert(r1.mlbContextualShift > 0, "row 1 contextualShift > 0", { v: r1.mlbContextualShift })

	console.log("\n--- row 2: Tampa Bay (DOME, no live weather) ---")
	assert(r2.weatherContext != null, "row 2 weather present (synthesized from park meta)")
	assert(r2.weatherContext?.isIndoor === true, "row 2 isIndoor=true")
	assert(r2.weatherContext?.windDirectionTag === "indoor", "row 2 windTag=indoor")
	assert(r2.weatherContext?.carryShift === 0, "row 2 dome carryShift=0")
	assert(r2.weatherContext?.precipShift === 0, "row 2 dome precipShift=0")
	assert(r2.weatherContext?.source === "park_meta_indoor", "row 2 source park_meta_indoor")

	console.log("\n--- row 3: Pitcher Ks WITH real pitcher stats ---")
	assert(r3.pitcherEnvironmentContext?.dataAvailable === true, "row 3 pitcher data available")
	assert(approxEqual(r3.pitcherEnvironmentContext?.kRate, 0.31), "row 3 kRate 0.31")
	assert(r3.pitcherEnvironmentContext?.kEnvironmentShift > 0, "row 3 kEnvShift > 0 (over side, kRate above 0.22)")
	assert(r3.mlbContextualTags.includes("PITCHER_K_HEAVY"), "row 3 tagged PITCHER_K_HEAVY (kRate ≥ 0.27)")

	console.log("\n--- row 4: Tired opponent bullpen (Blue Jays fatigue 0.85) ---")
	assert(r4.bullpenContext?.dataAvailable === true, "row 4 bullpen data available")
	assert(approxEqual(r4.bullpenContext?.reliefFatigueScore, 0.85), "row 4 reliefFatigueScore 0.85")
	assert(r4.bullpenContext?.bullpenShift > 0, "row 4 bullpen shift > 0 (over side, fatigued)")
	assert(r4.mlbContextualTags.includes("BULLPEN_FATIGUED"), "row 4 tagged BULLPEN_FATIGUED")

	console.log("\n--- row 5: NRFI synthetic market → SKIPPED ---")
	assert(r5.mlbContextualSkipReason === "synthetic_market", "row 5 skip reason set")
	assert(r5.weatherContext === null && r5.parkContext === null, "row 5 all contexts null")
	assert(r5.mlbContextualShift === null, "row 5 shift null")
	assert(Array.isArray(r5.mlbContextualTags) && r5.mlbContextualTags.length === 0, "row 5 tags empty")

	console.log("\n--- row 6: first_home_run synthetic special → SKIPPED ---")
	assert(r6.mlbContextualSkipReason === "synthetic_market", "row 6 skip reason set")
	assert(r6.parkContext === null, "row 6 park ctx null even though Texas listed (special skipped)")

	console.log("\n--- row 7: moneyline (game family) → SKIPPED ---")
	assert(r7.mlbContextualSkipReason === "synthetic_market", "row 7 skip reason set")

	console.log("\n--- row 8: rain in Baltimore ---")
	assert(r8.weatherContext?.precipitationMm === 2.4, "row 8 precip 2.4mm")
	assert(r8.weatherContext?.precipShift < 0, "row 8 precipShift < 0", { v: r8.weatherContext?.precipShift })
	assert(r8.weatherContext?.humidityPct === 85, "row 8 humidity 85%")

	console.log("\n--- diagnostics block (Phase 1B) ---")
	const d = result.diagnostics
	assert(d.phase === "mlb-phase-1b-contextual-v1", "phase tag updated to 1b")
	assert(d.rowsProcessed === 8, "rowsProcessed == 8")
	assert(d.rowsSkippedSynthetic === 3, "3 synthetic rows skipped (NRFI + first_home_run + moneyline)", { v: d.rowsSkippedSynthetic })
	assert(d.coverage.weather >= 4, "weather coverage ≥ 4 (4 outdoor + dome synthesizes too)")
	assert(d.coverage.indoorVenues >= 1, "indoorVenues ≥ 1")
	assert(d.coverage.pitcherEnvData >= 1, "pitcherEnvData ≥ 1 (real pitcher stats fixture)")
	assert(d.coverage.bullpenData >= 1, "bullpenData ≥ 1 (Blue Jays fixture)")
	assert(d.dataSources.parkMetaTeams >= 6, "parkMetaTeams loaded from fixture")
	assert(d.dataSources.pitcherStatNames >= 3, "pitcherStatNames loaded")
	assert(d.dataSources.bullpenTeams >= 1, "bullpenTeams loaded")

	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

function approxEqual(a, b, tol = 0.001) {
	return Math.abs(Number(a) - Number(b)) <= tol
}

run()
