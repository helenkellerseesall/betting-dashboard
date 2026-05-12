"use strict"

/**
 * Frozen Prediction + Grading Architecture V1 — write side
 * (Session AZ — observational memory infrastructure)
 *
 * Captures an immutable observational snapshot of:
 *   1. The predictions the system surfaced (delegated to intel.snapshotPredictions —
 *      reuses the existing prediction_snapshots writer; NEVER duplicates that logic)
 *   2. The contextual reasoning behind each prediction (matchup, recent form, role,
 *      teammate redistribution, market consensus, availability) — this is the new
 *      capability that did not exist before Session AZ.
 *   3. The epoch grouping (prediction_epochs) that ties predictions captured from
 *      the same snapshot lifecycle together so they can be replayed as a coherent
 *      moment in time.
 *
 * Architecture rules (per project):
 *   - Additive only. No mutation of existing intelligence writers.
 *   - INSERT OR IGNORE for predictions + epochs (immutability — re-running never
 *     overwrites prior frozen state).
 *   - INSERT OR REPLACE for contextual_states (a contextual layer can be re-derived
 *     for the same prediction within the same epoch — but the prediction itself
 *     remains immutable).
 *   - Honest no-op when SQLite is unavailable. Never throws into the request path.
 *   - No synthetic data. If a contextual layer didn't fire for a given row,
 *     the column stays NULL — we never invent a value.
 *
 * Public API:
 *   freezePredictionEpoch({ predictions, slips, sport, slateDate, source,
 *                           snapshotUpdatedAt, notes }) → { epochId, ... }
 *   computeEpochId(snapshotUpdatedAt, sport, slateDate) → string
 */

const { tryGetDb }                = require("../../storage/db")
const { applyIntelligenceSchema } = require("../../storage/intelligenceSchema")
const intel                       = require("../../storage/intelligence")

// ── Schema init (idempotent) ─────────────────────────────────────────────────

let _schemaApplied = false

function ensureSchema() {
	if (_schemaApplied) return
	const db = tryGetDb()
	if (!db) return
	applyIntelligenceSchema(db)
	_schemaApplied = true
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function safeInt(v) {
	const n = Number(v)
	return Number.isFinite(n) ? Math.trunc(n) : null
}

function safeStr(v) {
	if (v == null) return null
	const s = String(v).trim()
	return s.length ? s : null
}

function boolToInt(v) {
	if (v == null) return null
	if (typeof v === "boolean") return v ? 1 : 0
	if (typeof v === "number") return v ? 1 : 0
	const s = String(v).toLowerCase()
	if (s === "true" || s === "1" || s === "yes") return 1
	if (s === "false" || s === "0" || s === "no") return 0
	return null
}

/**
 * Compute a deterministic epoch_id.
 * Two captures from the SAME snapshot updatedAt → same epoch_id → INSERT OR
 * IGNORE makes the second a no-op. New snapshot updatedAt → new epoch.
 */
function computeEpochId(snapshotUpdatedAt, sport, slateDate) {
	const ts = safeStr(snapshotUpdatedAt) || new Date().toISOString()
	return [
		ts,
		String(sport || "").toLowerCase(),
		String(slateDate || "").slice(0, 10),
	].join("|")
}

/**
 * Extract contextual state from an enriched prediction row.
 * Returns NULL for any layer that didn't fire — never invents values.
 */
function extractContextualState(row) {
	const recentForm     = row?.recentForm || row?.recent_form || null
	const roleContext    = row?.roleContext || row?.role_context || null
	const teammateCtx    = row?.teammateContext || row?.teammate_context || null
	const marketCtx      = row?.marketContext || row?.market_context || null
	const availabilityCtx = row?.availabilityContext || row?.availability_context || null
	const matchup        = row?.matchupContext || row?.matchup_context || null

	return {
		// Matchup (Session AO)
		matchup_score:           safeNum(matchup?.score ?? row?.matchupScore),
		matchup_shift:           safeNum(row?.matchupShift),
		// Recent Form (Session AP)
		recent_form_z:           safeNum(recentForm?.formZ ?? recentForm?.z ?? row?.recentFormZ),
		recent_form_sample:      safeInt(recentForm?.sample ?? recentForm?.n ?? row?.recentFormSample),
		recent_form_shift:       safeNum(row?.recentFormShift ?? recentForm?.shift),
		// Role + Minutes (Session AR)
		starter_flag:            boolToInt(row?.starterFlag ?? roleContext?.starterFlag),
		projected_minutes:       safeNum(row?.projectedMinutes ?? roleContext?.projectedMinutes),
		// Teammate (Session AS)
		teammate_absent_count:   safeInt(
			(Array.isArray(teammateCtx?.absent_teammates) && teammateCtx.absent_teammates.length) ||
			teammateCtx?.absentCount,
		),
		teammate_redist_shift:   safeNum(row?.teammateRedistShift ?? teammateCtx?.redistribution_shift),
		// Market (Session AT)
		market_consensus_implied: safeNum(marketCtx?.consensus_implied ?? marketCtx?.consensusImplied),
		market_dispersion:       safeNum(marketCtx?.dispersion),
		market_book_count:       safeInt(marketCtx?.book_count ?? marketCtx?.bookCount),
		market_shift:            safeNum(row?.marketShift),
		// Availability (Session AV)
		player_status:           safeStr(row?.playerStatus ?? availabilityCtx?.status),
		availability_shift:      safeNum(row?.availabilityShift),
		// Final composed output
		final_model_prob:        safeNum(row?.modelProb ?? row?.predictedProbability),
		final_edge:              safeNum(row?.edge ?? row?.edgeProbability),
	}
}

/**
 * Returns true if the row had ANY non-null contextual signal (i.e. the
 * contextual systems actually fired for this player). Used to count
 * `contextual_count` on prediction_epochs.
 */
function hasContextualSignal(state) {
	return (
		state.matchup_score          != null ||
		state.matchup_shift          != null ||
		state.recent_form_z          != null ||
		state.starter_flag           != null ||
		state.projected_minutes      != null ||
		state.teammate_absent_count  != null ||
		state.teammate_redist_shift  != null ||
		state.market_consensus_implied != null ||
		state.market_shift           != null ||
		state.player_status          != null ||
		state.availability_shift     != null
	)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Freeze a prediction epoch.
 *
 * @param {object}   args
 * @param {object[]} args.predictions       — enriched prediction rows (player, statFamily,
 *                                            side, line, odds, modelProb, edge, plus
 *                                            optional contextual fields recentForm,
 *                                            roleContext, teammateContext, marketContext,
 *                                            availabilityContext, matchupShift, etc.)
 * @param {object}   [args.slipsByTier]     — { safe: [], balanced: [], aggressive: [], lotto: [] }
 *                                            optional; if provided we also call
 *                                            intel.snapshotEcology for pool composition.
 * @param {string}   args.sport             — 'nba' | 'mlb' | etc
 * @param {string}   args.slateDate         — 'YYYY-MM-DD'
 * @param {string}   [args.source='workstation_state']
 * @param {string}   [args.snapshotUpdatedAt] — ISO timestamp from oddsSnapshot.updatedAt
 *                                              (defaults to now if missing)
 * @param {string}   [args.notes]
 *
 * @returns {{
 *   ok: boolean,
 *   epochId: string|null,
 *   epochInserted: boolean,
 *   predictionsInserted: number,
 *   predictionsSkipped: number,
 *   contextualInserted: number,
 *   ecologyRecorded: boolean,
 *   error: string|null
 * }}
 */
function freezePredictionEpoch(args = {}) {
	const out = {
		ok:                  false,
		epochId:             null,
		epochInserted:       false,
		predictionsInserted: 0,
		predictionsSkipped:  0,
		contextualInserted:  0,
		ecologyRecorded:     false,
		error:               null,
	}

	try {
		ensureSchema()
		const db = tryGetDb()
		if (!db) {
			out.error = "sqlite-unavailable"
			return out
		}

		const sport     = String(args.sport || "").toLowerCase()
		const slateDate = String(args.slateDate || "").slice(0, 10)
		if (!sport || !slateDate) {
			out.error = "missing-sport-or-slate-date"
			return out
		}

		const predictions = Array.isArray(args.predictions) ? args.predictions : []
		const source      = safeStr(args.source) || "workstation_state"

		const epochId = computeEpochId(args.snapshotUpdatedAt, sport, slateDate)
		out.epochId = epochId

		// 1) Delegate prediction freezing to existing intel writer (no duplication)
		const predResult = intel.snapshotPredictions(predictions, {
			sport,
			date:          slateDate,
			ecologyBucket: source,
		})
		if (predResult) {
			out.predictionsInserted = predResult.inserted || 0
			out.predictionsSkipped  = predResult.skipped  || 0
		}

		// 2) Insert epoch row (idempotent)
		const epochStmt = db.prepare(`
			INSERT OR IGNORE INTO prediction_epochs (
				epoch_id, snapshot_updated_at, slate_date, sport, source,
				prediction_count, contextual_count, slip_count, notes
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
		// Compute contextual + slip counts before insert
		const states = predictions.map((row) => ({ row, state: extractContextualState(row) }))
		const contextualCount = states.reduce((n, s) => n + (hasContextualSignal(s.state) ? 1 : 0), 0)
		let slipCount = 0
		if (args.slipsByTier && typeof args.slipsByTier === "object") {
			for (const tier of Object.keys(args.slipsByTier)) {
				const arr = args.slipsByTier[tier]
				if (Array.isArray(arr)) slipCount += arr.length
			}
		}
		const epochRes = epochStmt.run(
			epochId,
			safeStr(args.snapshotUpdatedAt),
			slateDate,
			sport,
			source,
			predictions.length,
			contextualCount,
			slipCount,
			safeStr(args.notes),
		)
		out.epochInserted = (epochRes?.changes || 0) > 0

		// 3) Per-prediction contextual freeze
		// INSERT OR IGNORE: composite PK (prediction_id, epoch_id) ensures true
		// immutability — once a prediction's contextual state is captured for
		// an epoch, it is never overwritten. Same prediction in a later epoch
		// (different snapshot updatedAt) gets its own row.
		const fcsStmt = db.prepare(`
			INSERT OR IGNORE INTO frozen_contextual_states (
				prediction_id, epoch_id,
				matchup_score, matchup_shift,
				recent_form_z, recent_form_sample, recent_form_shift,
				starter_flag, projected_minutes,
				teammate_absent_count, teammate_redist_shift,
				market_consensus_implied, market_dispersion, market_book_count, market_shift,
				player_status, availability_shift,
				final_model_prob, final_edge,
				raw_context_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)

		db.exec("BEGIN")
		try {
			for (const { row, state } of states) {
				const player     = row?.player || row?.playerName
				const statFamily = String(row?.statFamily || row?.propType || row?.prop || "")
					.toLowerCase().replace(/\s+/g, "")
				const side       = String(row?.side || "").toLowerCase()
				const line       = safeNum(row?.line)
				const book       = row?.sportsbook || row?.book
				if (!player || !statFamily) continue

				const predId = intel.predictionId(slateDate, sport, player, statFamily, side, line, book)

				const ctxJson = JSON.stringify({
					matchupContext:      row?.matchupContext || null,
					recentForm:          row?.recentForm || null,
					roleContext:         row?.roleContext || null,
					teammateContext:     row?.teammateContext || null,
					marketContext:       row?.marketContext || null,
					availabilityContext: row?.availabilityContext || null,
					shifts: {
						matchupShift:       safeNum(row?.matchupShift),
						recentFormShift:    safeNum(row?.recentFormShift),
						teammateRedistShift: safeNum(row?.teammateRedistShift),
						marketShift:        safeNum(row?.marketShift),
						availabilityShift:  safeNum(row?.availabilityShift),
					},
				})

				const r = fcsStmt.run(
					predId, epochId,
					state.matchup_score, state.matchup_shift,
					state.recent_form_z, state.recent_form_sample, state.recent_form_shift,
					state.starter_flag, state.projected_minutes,
					state.teammate_absent_count, state.teammate_redist_shift,
					state.market_consensus_implied, state.market_dispersion, state.market_book_count, state.market_shift,
					state.player_status, state.availability_shift,
					state.final_model_prob, state.final_edge,
					ctxJson,
				)
				if ((r?.changes || 0) > 0) out.contextualInserted++
			}
			db.exec("COMMIT")
		} catch (txErr) {
			try { db.exec("ROLLBACK") } catch (_) {}
			throw txErr
		}

		// 4) Optional ecology snapshot — uses existing intel writer
		if (args.slipsByTier && predictions.length) {
			try {
				out.ecologyRecorded = intel.snapshotEcology(
					predictions,
					args.slipsByTier,
					{ sport, date: slateDate, notes: source },
				)
			} catch (ecoErr) {
				console.warn("[freezePredictionEpoch] ecology snapshot skipped:", ecoErr.message)
			}
		}

		out.ok = true
		return out
	} catch (err) {
		out.error = err?.message || String(err)
		console.warn("[freezePredictionEpoch] error:", out.error)
		return out
	}
}

module.exports = {
	freezePredictionEpoch,
	computeEpochId,
	extractContextualState,
	hasContextualSignal,
}
