"use strict"

/**
 * MLB Phase 2 — Frozen Live-State Epoch writer
 *
 * Mints a NEW prediction_epoch per live refresh and writes new rows into
 * frozen_contextual_states for each row that carries `mlbLiveState`. The
 * composite PRIMARY KEY (prediction_id, epoch_id) on frozen_contextual_states
 * guarantees IMMUTABILITY: a fresh live refresh creates new rows; prior
 * epochs are NEVER overwritten.
 *
 * NBA-specific columns stay NULL — MLB live state lands in raw_context_json.
 *
 * Architectural rules honored:
 *   - Additive: never modifies prior epochs or prior state rows
 *   - Idempotent within a single epoch: INSERT OR IGNORE on the epoch
 *   - INSERT OR REPLACE on contextual states: re-deriving the same epoch
 *     refreshes its envelope, but other epochs remain untouched
 *   - Honest no-op when SQLite is unavailable
 *
 * Usage from the operator script after applyMlbLiveStateLayers returns:
 *
 *   freezeMlbLiveStateEpoch({
 *     liveRows: result.rows,
 *     slateDate,
 *     snapshotUpdatedAt,
 *     source: "live_refresh",
 *     notes: "phase-2 live state",
 *   })
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

function safeStr(v) {
	if (v == null) return null
	const s = String(v).trim()
	return s.length ? s : null
}
function safeNum(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function computeLiveEpochId(snapshotUpdatedAt, capturedAtIso, slateDate) {
	const ts = safeStr(capturedAtIso) || safeStr(snapshotUpdatedAt) || new Date().toISOString()
	return ["LIVE", ts, "mlb", String(slateDate || "").slice(0, 10)].join("|")
}

function buildLiveRawContext(row) {
	const live = row?.mlbLiveState || null
	if (!live) return null
	return {
		capturedAt: live.capturedAt || null,
		// Phase 1B contextual snapshot at the moment of live freeze (immutable in this epoch)
		preserved: {
			weatherContext:            row?.weatherContext            || null,
			parkContext:               row?.parkContext               || null,
			handednessContext:         row?.handednessContext         || null,
			pitcherEnvironmentContext: row?.pitcherEnvironmentContext || null,
			bullpenContext:            row?.bullpenContext            || null,
			lineupContextV2:           row?.lineupContextV2           || null,
			mlbContextualSignal:       row?.mlbContextualSignal       || null,
			mlbContextualShift:        safeNum(row?.mlbContextualShift),
			mlbContextualTags:         Array.isArray(row?.mlbContextualTags) ? row.mlbContextualTags : [],
		},
		// New Phase 2 envelope
		live: {
			lineup:        live.lineup        || null,
			starter:       live.starter       || null,
			lineMovement:  live.lineMovement  || null,
			bullpenLive:   live.bullpenLive   || null,
			weatherDelta:  live.weatherDelta  || null,
			tags:          Array.isArray(live.tags) ? live.tags : [],
			hasAnyLive:    Boolean(live.hasAnyLive),
		},
	}
}

function freezeMlbLiveStateEpoch(args = {}) {
	const out = {
		ok: false,
		epochId: null,
		predictionsConsidered: 0,
		contextualInserted: 0,
		skippedNoPredictionId: 0,
		error: null,
	}

	try {
		ensureSchema()
		const db = tryGetDb()
		if (!db) { out.error = "sqlite_unavailable"; return out }

		const liveRows = Array.isArray(args.liveRows) ? args.liveRows : []
		const slateDate = safeStr(args.slateDate) || new Date().toISOString().slice(0, 10)
		const capturedAtIso = safeStr(args.capturedAtIso) || liveRows[0]?.mlbLiveState?.capturedAt || new Date().toISOString()
		const snapshotUpdatedAt = safeStr(args.snapshotUpdatedAt)
		const source = safeStr(args.source) || "live_refresh"
		const notes = safeStr(args.notes)

		const epochId = computeLiveEpochId(snapshotUpdatedAt, capturedAtIso, slateDate)
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

		let contextualCount = 0
		let predictionCount = 0
		let skipped = 0

		const tx = db.transaction(() => {
			for (const row of liveRows) {
				const predictionId = safeStr(row?.id) || safeStr(row?.predictionId)
				if (!predictionId) { skipped += 1; continue }
				predictionCount += 1
				const raw = buildLiveRawContext(row)
				if (!raw) continue
				insertCtx.run(
					predictionId, epochId,
					safeNum(row?.consensusImpliedProbability), safeNum(row?.bookImpliedDispersion),
					safeNum(row?.predictedProbability), safeNum(row?.edgeProbability),
					JSON.stringify(raw),
				)
				contextualCount += 1
			}
			insertEpoch.run(epochId, snapshotUpdatedAt, slateDate, source, predictionCount, contextualCount, notes)
		})

		tx()
		out.predictionsConsidered = predictionCount
		out.contextualInserted = contextualCount
		out.skippedNoPredictionId = skipped
		out.ok = true
		return out
	} catch (err) {
		out.error = err?.message || String(err)
		return out
	}
}

module.exports = { freezeMlbLiveStateEpoch, computeLiveEpochId, buildLiveRawContext }
