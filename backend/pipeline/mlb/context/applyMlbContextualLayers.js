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
const normalizeName                            = require("../../../utils/normalizeName")
// 2026-05-30 — batter L5/L15 form (hot/cold streak detection)
let _enrichRowWithBatterForm = null
try { _enrichRowWithBatterForm = require("../mlbBatterFormCache").enrichRowWithBatterForm }
catch (_) { _enrichRowWithBatterForm = null }
// 2026-05-30 — pitcher L3/L5 form (per-start streak detection)
let _enrichRowWithPitcherForm = null
try { _enrichRowWithPitcherForm = require("../mlbPitcherFormCache").enrichRowWithPitcherForm }
catch (_) { _enrichRowWithPitcherForm = null }

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

function loadParkMeta(dataDir) {
	// Phase 1B — optional. When present, enables dome/retractable detection
	// in the weather deriver (indoor venues zero out wind + precip shifts).
	return safeReadJson(path.join(dataDir, "mlbParkMeta.json")) || {}
}

function loadBatterStats(dataDir) {
	// 2026-05-30 — batter cache landed. Keyed by normalized lowercase full name
	// (matching the normalizeName util). Used to fill row.batterHand + per-batter
	// HR/AB, ISO, K%, SLG for the HR / Hits / RBI / TB / Runs engines.
	return safeReadJson(path.join(dataDir, "mlbBatterStats.json")) || {}
}

// ── Row prep: fill batterHand + pitcherHand + batterStats from caches ──────

function buildNormalizedLookup(map) {
	const out = {}
	if (!map || typeof map !== "object") return out
	for (const k of Object.keys(map)) {
		const norm = normalizeName(k)
		if (norm) out[norm] = map[k]
	}
	return out
}

/**
 * 2026-05-30 — until tonight, row.batterHand was null on every row (no batter
 * cache existed). Handedness derivation returned null on every row as a result,
 * and HR engine fell back to defaulting every pitcher to "R". Now we look the
 * batter up in mlbBatterStats and attach batterHand + batterStats so the
 * existing derivers and downstream engines can read real signal.
 *
 * Pitcher side: probable-pitcher resolution is already handled by other
 * pipeline steps; we additionally backfill pitcherHand from the pitcher cache
 * if the row arrives without it.
 */
function attachIdentityAndStats(row, { batterByNormName, pitcherByNormName }) {
	if (!row || typeof row !== "object") return row
	const isPitcherMarket = row.isPitcherMarket === true
	const playerKey = row.player ? normalizeName(row.player) : null

	if (!isPitcherMarket && playerKey) {
		const bEntry = batterByNormName[playerKey] || null
		if (bEntry) {
			if (!row.batterHand && bEntry.batSide) row.batterHand = bEntry.batSide
			// Attach a compact stats blob — engines read it without re-loading the
			// 282KB JSON every row.
			row.batterStats = {
				batSide: bEntry.batSide,
				avg: bEntry.avg,
				obp: bEntry.obp,
				slg: bEntry.slg,
				ops: bEntry.ops,
				iso: bEntry.iso,
				hrRate: bEntry.hrRate,
				kRate: bEntry.kRate,
				bbRate: bEntry.bbRate,
				xbhRate: bEntry.xbhRate,
				atBats: bEntry.atBats,
				plateAppearances: bEntry.plateAppearances,
				homeRuns: bEntry.homeRuns,
				// 2026-06-08 SHIP 2 — stolen-base rate plumbing (additive). The
				// stolenBases Poisson projection (projectHitterStats) needs
				// lambda = stolenBases / gamesPlayed; both from the season cache.
				// Additive — every existing reader is unaffected.
				stolenBases: bEntry.stolenBases,
				gamesPlayed: bEntry.gamesPlayed,
			}
		}
	}

	// Opposing pitcher handedness — fill from cache when absent on the row.
	if (!row.pitcherHand) {
		const oppName = row.opposingPitcher || row.opposingPitcherName || row.oppPitcher
		const oppKey = oppName ? normalizeName(oppName) : null
		if (oppKey) {
			const pEntry = pitcherByNormName[oppKey] || null
			if (pEntry?.throws) row.pitcherHand = pEntry.throws
		}
	}

	// Pitcher-market rows (Ks, outs): the row's player IS the pitcher. Attach
	// their stats blob and fill `throws` if missing.
	if (isPitcherMarket && playerKey) {
		const pEntry = pitcherByNormName[playerKey] || null
		if (pEntry) {
			if (!row.pitcherHand && pEntry.throws) row.pitcherHand = pEntry.throws
			row.pitcherStats = {
				throws: pEntry.throws,
				kRate: pEntry.kRate,
				bbRate: pEntry.bbRate,
				k9: pEntry.k9,
				whip: pEntry.whip,
				era: pEntry.era,
				inningsPitched: pEntry.inningsPitched,
				battersFaced: pEntry.battersFaced,
				strikeOuts: pEntry.strikeOuts,
				homeRunsAllowed: pEntry.homeRunsAllowed,
				gamesStarted: pEntry.gamesStarted,
			}
		}
	}

	return row
}

// ── Market sanity (Phase 1B) ─────────────────────────────────────────────────

/**
 * Phase 1B — Synthetic / non-player markets must not receive causal contextual
 * treatment. These are markets like NRFI/YRFI, first-home-run, first-hit,
 * stolen-bases (yes/no), and any market without a real `player` field. Treating
 * them with weather/handedness/lineup signals would be semantic noise.
 *
 * Per the existing classifier in pipeline/markets/mlbClassification.js, the
 * "special" family carries first-* and yes-no constructs, and "game" carries
 * moneyline/runline/total. Both are excluded. "unknown" is also excluded —
 * never decorate an uncategorized row.
 *
 * Returns true when the row SHOULD be skipped (no contextual derivation).
 */
function shouldSkipContextualForRow(row) {
	const fam = String(row?.marketFamily || "").toLowerCase()
	if (fam === "game" || fam === "special" || fam === "unknown") return true
	const player = String(row?.player || "").trim()
	if (!player) return true
	// Extra defense: side="no" / side="yes" appear on yes/no constructs; even
	// inside "standard" family these should not get contextual reasoning.
	const side = String(row?.side || "").toLowerCase()
	if (side === "no" || side === "yes") return true
	return false
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
	const batterStatsByName  = (overrides && overrides.batterStatsByName)  || loadBatterStats(dir)
	const bullpenByTeam      = (overrides && overrides.bullpenByTeam)      || loadBullpenStats(dir)
	const parkMetaByTeam     = (overrides && overrides.parkMetaByTeam)     || loadParkMeta(dir)

	// Normalized-name indexes built ONCE per slate — engines look up via the
	// same normalizeName the caches were keyed with.
	const batterByNormName  = buildNormalizedLookup(batterStatsByName)
	const pitcherByNormName = buildNormalizedLookup(pitcherStatsByName)

	const eventsIndex = buildEventsIndex(events)

	const diagnostics = {
		phase: "mlb-phase-1b-contextual-v1",
		rowsProcessed: 0,
		rowsSkippedSynthetic: 0,
		coverage: {
			weather: 0,
			park: 0,
			handedness: 0,
			pitcherEnvData: 0,
			bullpenData: 0,
			lineup: 0,
			indoorVenues: 0,
		},
		shiftStats: {
			withShift: 0,
			abs: { min: null, max: null, mean: null },
		},
		dataSources: {
			weatherMapEntries: Object.keys(weatherByEventId || {}).length,
			parkFactorTeams:   Object.keys(parkFactorsByTeam || {}).length,
			pitcherStatNames:  Object.keys(pitcherStatsByName || {}).length,
			batterStatNames:   Object.keys(batterStatsByName || {}).length,
			bullpenTeams:      Object.keys(bullpenByTeam || {}).length,
			parkMetaTeams:     Object.keys(parkMetaByTeam || {}).filter(k => !k.startsWith("_")).length,
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

		// Phase 1B — synthetic / non-player markets are not eligible for causal
		// reasoning. Attach explicit nulls + a contextual envelope so the row
		// shape stays stable (no missing keys) without inventing context.
		if (shouldSkipContextualForRow(row)) {
			diagnostics.rowsSkippedSynthetic += 1
			return {
				...row,
				weatherContext: null,
				parkContext: null,
				handednessContext: null,
				pitcherEnvironmentContext: null,
				bullpenContext: null,
				lineupContextV2: null,
				mlbContextualSignal: null,
				mlbContextualShift: null,
				mlbContextualTags: [],
				mlbContextualSkipReason: "synthetic_market",
			}
		}

		// 2026-05-30 — fill row.batterHand + row.pitcherHand + per-side stats
		// blobs from caches before derivers run. Until this hop existed, the
		// handedness deriver returned null on ~100% of rows.
		attachIdentityAndStats(row, { batterByNormName, pitcherByNormName })

		// 2026-05-30 — attach L5 + L15 hitting form when game-log cache exists.
		// No-op when player not in cache. Engines read row.batterL5 / row.batterL15
		// for hot/cold streak adjustments (HR/Hits/RBI/TB/Runs).
		if (_enrichRowWithBatterForm) {
			try { _enrichRowWithBatterForm(row) } catch (_) {}
		}

		// 2026-05-30 — attach L3 + L5 pitcher form. For pitcher-market rows
		// this sets row.pitcherL3/L5. For batter-market rows it sets
		// row.opposingPitcherL3/L5 so hits/HR engines can dampen vs hot starters.
		if (_enrichRowWithPitcherForm) {
			try { _enrichRowWithPitcherForm(row) } catch (_) {}
		}

		// 2026-05-30 — Vegas team total backfill. buildMlbBootstrapSnapshot's
		// primary path requires gameTotal + BOTH moneyline odds + isHome. When
		// ANY missing → impliedTeamTotal stays null → RBI + Runs engines
		// silently drop the row. Conservative fallback: split gameTotal evenly
		// (50/50 neutral assumption). Better than null; degrades gracefully
		// for non-pitcher rows on games without moneyline data.
		if ((row.impliedTeamTotal == null) && Number.isFinite(Number(row.gameTotal))) {
			row.impliedTeamTotal = Number((Number(row.gameTotal) / 2).toFixed(3))
			row._impliedTeamTotalSource = "fallback_half_total"
		}

		const weather    = deriveMlbWeatherContext(row, { weatherByEventId, parkMetaByTeam })
		const park       = deriveMlbParkContext(row, { parkFactorsByTeam })
		const handedness = deriveMlbHandednessContext(row)
		const pitcherEnv = deriveMlbPitcherEnvironmentContext(row, { pitcherStatsByName })
		const bullpen    = deriveMlbBullpenContext(row, { bullpenByTeam })
		const lineup     = deriveMlbLineupContext(row)

		if (weather)    diagnostics.coverage.weather    += 1
		if (weather && weather.isIndoor) diagnostics.coverage.indoorVenues += 1
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

		// 2026-05-30 — surface a top-level isPlatoonAdvantage flag so
		// buildMlbBestBetsBoard (which writes the persistent tracked_bets
		// picks for Hits/TB/RBI/Runs) can read the platoon signal. The flag
		// existed in the cluster engine as a row reader but nothing was
		// writing it upstream — wiring it from handednessContext closes that.
		const isPlatoonAdvantage = handedness?.platoonRelation === "opp"

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
			isPlatoonAdvantage,
		}
	})

	if (absCount > 0) {
		diagnostics.shiftStats.abs.min  = Number(absMin.toFixed(4))
		diagnostics.shiftStats.abs.max  = Number(absMax.toFixed(4))
		diagnostics.shiftStats.abs.mean = Number((absSum / absCount).toFixed(4))
	}

	console.log("[MLB-CONTEXTUAL-PHASE-1B]", {
		rows: diagnostics.rowsProcessed,
		skippedSynthetic: diagnostics.rowsSkippedSynthetic,
		weather: diagnostics.coverage.weather,
		indoorVenues: diagnostics.coverage.indoorVenues,
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
