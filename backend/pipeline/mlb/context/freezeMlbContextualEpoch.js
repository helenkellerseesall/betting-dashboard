"use strict"

/**
 * MLB Phase 1 — Frozen Contextual Replay Memory wrapper
 *
 * Mirrors the NBA pattern in backend/pipeline/memory/freezePredictionEpoch.js
 * but for MLB-flavored rows. NBA-specific columns (matchup_score, recent_form_z,
 * starter_flag, projected_minutes, teammate_*, market_*, player_status,
 * availability_shift) are left NULL — they have no semantic meaning for MLB.
 *
 * MLB context lands in `raw_context_json` (forward-compat column documented in
 * intelligenceSchema.js): a serialized JSON envelope carrying
 * { weatherContext, parkContext, handednessContext, pitcherEnvironmentContext,
 *   bullpenContext, lineupContextV2, mlbContextualSignal, mlbContextualShift,
 *   mlbContextualTags }.
 *
 * This module deliberately does NOT alter freezePredictionEpoch.js. It provides
 * an MLB extractor that the future grading wiring can use. Phase 1 ships the
 * EXTRACTOR + a callable freeze entry — wiring it into the snapshot lifecycle
 * is deferred to the grading session per project guidance.
 *
 * Public API:
 *   extractMlbContextualState(row)  → contextual state row for SQLite write
 *   freezeMlbContextualEpoch(args)  → INSERT epoch + states (additive, idempotent)
 */

const { tryGetDb }                = require("../../../storage/db")
const { applyIntelligenceSchema } = require("../../../storage/intelligenceSchema")

let _schemaApplied = false

function ensureSchema() {
	if (_schemaApplied) return
	const db = tryGetDb()
	if (!db) return
	applyIntelligenceSchema(db)
	_schemaApplied = true
}

function safeNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function safeStr(v) {
	if (v == null) return null
	const s = String(v).trim()
	return s.length ? s : null
}

function computeMlbEpochId(snapshotUpdatedAt, slateDate) {
	const ts = safeStr(snapshotUpdatedAt) || new Date().toISOString()
	return [ts, "mlb", String(slateDate || "").slice(0, 10)].join("|")
}

/**
 * Build the row payload for frozen_contextual_states.
 * NBA-specific columns are NULL by design. MLB context goes into
 * raw_context_json so the existing schema is untouched.
 */
function extractMlbContextualState(row) {
	const ctxEnvelope = {
		weatherContext:            row?.weatherContext            || null,
		parkContext:               row?.parkContext               || null,
		handednessContext:         row?.handednessContext         || null,
		pitcherEnvironmentContext: row?.pitcherEnvironmentContext || null,
		bullpenContext:            row?.bullpenContext            || null,
		lineupContextV2:           row?.lineupContextV2           || null,
		mlbContextualSignal:       row?.mlbContextualSignal       || null,
		mlbContextualShift:        safeNum(row?.mlbContextualShift),
		mlbContextualTags:         Array.isArray(row?.mlbContextualTags) ? row.mlbContextualTags : [],
	}

	const hasAnyContext =
		ctxEnvelope.weatherContext            != null ||
		ctxEnvelope.parkContext               != null ||
		ctxEnvelope.handednessContext         != null ||
		(ctxEnvelope.pitcherEnvironmentContext && ctxEnvelope.pitcherEnvironmentContext.dataAvailable) ||
		(ctxEnvelope.bullpenContext            && ctxEnvelope.bullpenContext.dataAvailable) ||
		ctxEnvelope.lineupContextV2           != null ||
		ctxEnvelope.mlbContextualShift        != null

	return {
		// NBA-specific columns intentionally NULL
		matchup_score:            null,
		matchup_shift:            null,
		recent_form_z:            null,
		recent_form_sample:       null,
		recent_form_shift:        null,
		starter_flag:             null,
		projected_minutes:        null,
		teammate_absent_count:    null,
		teammate_redist_shift:    null,
		market_consensus_implied: safeNum(row?.consensusImpliedProbability),
		market_dispersion:        safeNum(row?.bookImpliedDispersion),
		market_book_count:        null,
		market_shift:             null,
		player_status:            null,
		availability_shift:       null,
		// MLB final composed output (post-shift = pre-shift in Phase 1: shift is observational)
		final_model_prob:         safeNum(row?.predictedProbability),
		final_edge:               safeNum(row?.edgeProbability),
		// Forward-compat envelope
		raw_context_json:         hasAnyContext ? JSON.stringify(ctxEnvelope) : null,
		_hasContextualSignal:     hasAnyContext,
	}
}

/**
 * Freeze an MLB epoch. INSERT OR IGNORE on epoch + predictions, INSERT OR
 * REPLACE on contextual states. Honest no-op when SQLite is unavailable.
 *
 * @param {object}   args
 * @param {object[]} args.predictions          — enriched rows from the snapshot
 *                                                (must have id available via the
 *                                                same composite key contract used
 *                                                by prediction_snapshots)
 * @param {string}   args.slateDate            — YYYY-MM-DD
 * @param {string}   [args.snapshotUpdatedAt]
 * @param {string}   [args.source='workstation_state']
 * @param {string}   [args.notes]
 *
 * @returns {{ ok, epochId, contextualInserted, error }}
 */
function freezeMlbContextualEpoch(args = {}) {
	const out = { ok: false, epochId: null, contextualInserted: 0, error: null }
	try {
		ensureSchema()
		const db = tryGetDb()
		if (!db) { out.error = "sqlite_unavailable"; return out }

		const predictions = Array.isArray(args.predictions) ? args.predictions : []
		const slateDate   = safeStr(args.slateDate) || new Date().toISOString().slice(0, 10)
		const snapshotUpdatedAt = safeStr(args.snapshotUpdatedAt)
		const source      = safeStr(args.source) || "workstation_state"
		const notes       = safeStr(args.notes)

		const epochId = computeMlbEpochId(snapshotUpdatedAt, slateDate)
		out.epochId = epochId

		const insertEpoch = db.prepare(`
			INSERT OR IGNORE INTO prediction_epochs
				(epoch_id, snapshot_updated_at, slate_date, sport, source, prediction_count, contextual_count, slip_count, notes)
			VALUES (?, ?, ?, 'mlb', ?, ?, ?, 0, ?)
		`)

		const insertCtx = db.prepare(`
			INSERT OR REPLACE INTO frozen_contextual_states
				(prediction_id, epoch_id,
				 matchup_score, matchup_shift,
				 recent_form_z, recent_form_sample, recent_form_shift,
				 starter_flag, projected_minutes,
				 teammate_absent_count, teammate_redist_shift,
				 market_consensus_implied, market_dispersion, market_book_count, market_shift,
				 player_status, availability_shift,
				 final_model_prob, final_edge,
				 raw_context_json)
			VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			        ?, ?, NULL, NULL,
			        NULL, NULL,
			        ?, ?, ?)
		`)

		let predictionCount = 0
		let contextualCount = 0

		const tx = db.transaction(() => {
			for (const row of predictions) {
				const predictionId = safeStr(row?.id) || safeStr(row?.predictionId)
				if (!predictionId) continue
				const state = extractMlbContextualState(row)
				predictionCount += 1
				if (!state._hasContextualSignal) continue
				insertCtx.run(
					predictionId, epochId,
					state.market_consensus_implied, state.market_dispersion,
					state.final_model_prob, state.final_edge,
					state.raw_context_json,
				)
				contextualCount += 1
			}
			insertEpoch.run(epochId, snapshotUpdatedAt, slateDate, source, predictionCount, contextualCount, notes)
		})

		tx()
		out.ok = true
		out.contextualInserted = contextualCount
		return out
	} catch (err) {
		out.error = err?.message || String(err)
		return out
	}
}

module.exports = {
	extractMlbContextualState,
	freezeMlbContextualEpoch,
	computeMlbEpochId,
}
