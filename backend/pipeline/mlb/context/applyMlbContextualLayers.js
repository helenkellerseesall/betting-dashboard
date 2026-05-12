"use strict"

/**
 * MLB Phase 1 — Contextual Intelligence Coordinator
 *
 * Single entry point for applying the Phase 1 causal contextual layers to a
 * built MLB snapshot. Purely additive:
 *   - Never mutates existing row fields.
 *   - Adds new namespaced fields: weatherContext, parkContext, handednessContext,
 *     pitcherEnvironmentContext, bullpenContext, lineupContextV2,
 *     mlbContextualSignal, mlbContextualShift, mlbContextualTags.
 *   - Returns the enriched rows alongside an observable diagnostics object.
 *
 * Architecture rules honored:
 *   - additive only (no override of existing row fields)
 *   - future-only slate integrity preserved (we touch only the rows we are given)
 *   - immutable upstream contracts preserved (caller spreads ...snapshot)
 *   - no synthetic data — when a lookup file is absent, fields stay null
 *   - no fake AI confidence — derivers expose bounded, named shifts only
 *   - no probability override in Phase 1 — hydrate still computes
 *     predictedProbability without consuming mlbContextualShift
 *
 * Wiring (single line addition in mlbIsolatedRoutes.js):
 *
 *   const { applyMlbContextualLayers } =
 *       require("../pipeline/mlb/context/applyMlbContextualLayers")
 *
 *   const ctxResult = applyMlbContextualLayers({
 *       rows: snapshot?.rows,
 *       events: snapshot?.events,
 *   })
 *   setMlbSnapshot({
 *       ...snapshot,
 *       rows: hydrateMlbProbabilityLayer(ctxResult.rows),
 *       diagnostics: {
 *           ...snapshot.diagnostics,
 *           contextual: ctxResult.diagnostics,
 *       },
 *   })
 */

const fs = require("fs")
const path = require("path")

const { deriveMlbWeatherContext }              = require("./deriveMlbWeatherContext")
const { deriveMlbParkContext }                 = require("./deriveMlbParkContext")
const { deriveMlbHandednessContext }           = require("./deriveMlbHandednessContext")
const { deriveMlbPitcherEnvironmentContext }   = require("./deriveMlbPitcherEnvironmentContext")
const { deriveMlbBullpenContext }              = require("./deriveMlbBullpenContext")
const { deriveMlbLineupContext }               = require("./deriveMlbLineupContext")
const { composeMlbContextualSignal }           = require("./composeMlbContextualSignal")

// ── Data file loading (additive, fail-open) ──────────────────────────────────

function safeReadJson(filePath) {
	try {
		if (!fs.existsSync(filePath)) return null
		const raw = fs.readFileSync(filePath, "utf8")
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === "object" ? parsed : null
	} catch {
		return null
	}
}

function loadWeatherMap(dataDir) {
	return safeReadJson(path.join(dataDir, "mlbGameWeather.json")) || {}
}

function loadParkFactors(dataDir) {
	return safeReadJson(path.join(dataDir, "mlbParkFactors.json")) || {}
}

function loadPitcherStats(dataDir) {
	// Optional. Not yet wired upstream; shape stub stays null until present.
	return safeReadJson(path.join(dataDir, "mlbPitcherStats.json")) || {}
}

function loadBullpenStats(dataDir) {
	// Optional. Not yet wired upstream; shape stub stays null until present.
	return safeReadJson(path.join(dataDir, "mlbBullpenWorkload.json")) || {}
}

// ── Coordinator ──────────────────────────────────────────────────────────────

function defaultDataDir() {
	// repo-root/backend/data — applyMlbContextualLayers.js lives at
	// repo-root/backend/pipeline/mlb/context/.  Three levels up.
	return path.join(__dirname, "..", "..", "..", "data")
}

function buildEventsIndex(events) {
	const idx = new Map()
	if (!Array.isArray(events)) return idx
	for (const e of events) {
		const id = e?.eventId || e?.id || e?.event_id
		if (id == null) continue
		idx.set(String(id), e)
	}
	return idx
}

function applyMlbContextualLayers({ rows, events, dataDir, overrides } = {}) {
	const safeRows = Array.isArray(rows) ? rows : []
	const dir = dataDir || defaultDataDir()

	const weatherByEventId   = (overrides && overrides.weatherByEventId)   || loadWeatherMap(dir)
	const parkFactorsByTeam  = (overrides && overrides.parkFactorsByTeam)  || loadParkFactors(dir)
	const pitcherStatsByName = (overrides && overrides.pitcherStatsByName) || loadPitcherStats(dir)
	const bullpenByTeam      = (overrides && overrides.bullpenByTeam)      || loadBullpenStats(dir)

	const eventsIndex = buildEventsIndex(events)

	const diagnostics = {
		phase: "mlb-phase-1-contextual-v1",
		rowsProcessed: 0,
		coverage: {
			weather: 0,
			park: 0,
			handedness: 0,
			pitcherEnvData: 0,
			bullpenData: 0,
			lineup: 0,
		},
		shiftStats: {
			withShift: 0,
			abs: { min: null, max: null, mean: null },
		},
		dataSources: {
			weatherMapEntries: Object.keys(weatherByEventId || {}).length,
			parkFactorTeams:   Object.keys(parkFactorsByTeam || {}).length,
			pitcherStatNames:  Object.keys(pitcherStatsByName || {}).length,
			bullpenTeams:      Object.keys(bullpenByTeam || {}).length,
			eventsIndexed:     eventsIndex.size,
		},
		samples: {
			firstWithSignal: null,
			firstHrSignal: null,
			firstPitcherSignal: null,
			firstRbiSignal: null,
		},
		tagCounts: {},
	}

	let absSum = 0
	let absCount = 0
	let absMin = Infinity
	let absMax = -Infinity

	const enriched = safeRows.map((row) => {
		diagnostics.rowsProcessed += 1

		const weather    = deriveMlbWeatherContext(row, { weatherByEventId })
		const park       = deriveMlbParkContext(row, { parkFactorsByTeam })
		const handedness = deriveMlbHandednessContext(row)
		const pitcherEnv = deriveMlbPitcherEnvironmentContext(row, { pitcherStatsByName })
		const bullpen    = deriveMlbBullpenContext(row, { bullpenByTeam })
		const lineup     = deriveMlbLineupContext(row)

		if (weather)    diagnostics.coverage.weather    += 1
		if (park)       diagnostics.coverage.park       += 1
		if (handedness) diagnostics.coverage.handedness += 1
		if (pitcherEnv && pitcherEnv.dataAvailable) diagnostics.coverage.pitcherEnvData += 1
		if (bullpen    && bullpen.dataAvailable)    diagnostics.coverage.bullpenData    += 1
		if (lineup)     diagnostics.coverage.lineup     += 1

		const composed = composeMlbContextualSignal({ row, weather, park, handedness, pitcherEnv, bullpen, lineup })
		const shift = composed?.contextualShift
		const tags  = composed?.contextualTags || []

		if (shift != null) {
			diagnostics.shiftStats.withShift += 1
			const a = Math.abs(shift)
			absSum += a
			absCount += 1
			if (a < absMin) absMin = a
			if (a > absMax) absMax = a
		}
		for (const t of tags) {
			diagnostics.tagCounts[t] = (diagnostics.tagCounts[t] || 0) + 1
		}

		// capture lightweight samples for observability (no sensitive data)
		const sampleSnap = {
			player: row?.player || null,
			propType: row?.propType || null,
			side: row?.side || null,
			line: row?.line ?? null,
			contextualShift: shift,
			contextualTags: tags,
			contextualSignal: composed?.contextualSignal || null,
		}
		if (shift != null) {
			if (!diagnostics.samples.firstWithSignal) {
				diagnostics.samples.firstWithSignal = sampleSnap
			}
			if (!diagnostics.samples.firstHrSignal && composed?.contextualSignal?.family === "hr") {
				diagnostics.samples.firstHrSignal = sampleSnap
			}
			if (!diagnostics.samples.firstPitcherSignal && composed?.contextualSignal?.family === "pitcher") {
				diagnostics.samples.firstPitcherSignal = sampleSnap
			}
			if (!diagnostics.samples.firstRbiSignal && composed?.contextualSignal?.family === "rbi_runs_sb") {
				diagnostics.samples.firstRbiSignal = sampleSnap
			}
		}

		return {
			...row,
			weatherContext:                 weather    || null,
			parkContext:                    park       || null,
			handednessContext:              handedness || null,
			pitcherEnvironmentContext:      pitcherEnv || null,
			bullpenContext:                 bullpen    || null,
			lineupContextV2:                lineup     || null,
			mlbContextualSignal:            composed?.contextualSignal || null,
			mlbContextualShift:             shift ?? null,
			mlbContextualTags:              tags,
		}
	})

	if (absCount > 0) {
		diagnostics.shiftStats.abs.min  = Number(absMin.toFixed(4))
		diagnostics.shiftStats.abs.max  = Number(absMax.toFixed(4))
		diagnostics.shiftStats.abs.mean = Number((absSum / absCount).toFixed(4))
	}

	console.log("[MLB-CONTEXTUAL-PHASE-1]", {
		rows: diagnostics.rowsProcessed,
		weather: diagnostics.coverage.weather,
		park: diagnostics.coverage.park,
		handedness: diagnostics.coverage.handedness,
		pitcherEnvData: diagnostics.coverage.pitcherEnvData,
		bullpenData: diagnostics.coverage.bullpenData,
		lineup: diagnostics.coverage.lineup,
		withShift: diagnostics.shiftStats.withShift,
		topTags: Object.entries(diagnostics.tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
		dataSources: diagnostics.dataSources,
	})

	return { rows: enriched, diagnostics }
}

module.exports = { applyMlbContextualLayers }
