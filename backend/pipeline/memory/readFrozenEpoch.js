"use strict"

/**
 * Frozen Prediction + Grading Architecture V1 — read side
 * (Session AZ — observational memory infrastructure)
 *
 * Pure read API over prediction_epochs + prediction_snapshots +
 * frozen_contextual_states + outcome_snapshots. NEVER writes — never mutates.
 *
 * Used by:
 *   - probes / verification scripts
 *   - operator inspection
 *   - future longitudinal analysis (which contexts work / which fail)
 *
 * Public API:
 *   listEpochs({ sport, slateDate, limit, offset, source })
 *   getEpoch(epochId)
 *   getEpochPredictions(epochId)            — predictions + contextual + (joined) outcome
 *   getFrozenPredictionWithContext(predId)  — single prediction; contextual replay
 */

const { tryGetDb } = require("../../storage/db")

// ── Helpers ──────────────────────────────────────────────────────────────────

function _safeQuery(fn) {
	try {
		const db = tryGetDb()
		if (!db) return null
		return fn(db)
	} catch (err) {
		console.warn("[readFrozenEpoch] query error:", err.message)
		return null
	}
}

function _parseRawJson(row) {
	if (!row || !row.raw_json) return row
	try { row.raw = JSON.parse(row.raw_json) } catch (_) {}
	return row
}

function _parseRawContext(row) {
	if (!row) return row
	if (row.raw_context_json) {
		try { row.context = JSON.parse(row.raw_context_json) } catch (_) {}
	}
	return row
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * List recent epochs, newest first.
 *
 * @param {object} [opts]
 * @param {string} [opts.sport]
 * @param {string} [opts.slateDate]    — exact match 'YYYY-MM-DD'
 * @param {string} [opts.source]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 *
 * @returns {object[]|null}  Array of epoch rows, or null if SQLite unavailable.
 */
function listEpochs(opts = {}) {
	return _safeQuery((db) => {
		const where = []
		const params = []
		if (opts.sport)     { where.push("sport = ?");      params.push(String(opts.sport).toLowerCase()) }
		if (opts.slateDate) { where.push("slate_date = ?"); params.push(String(opts.slateDate).slice(0, 10)) }
		if (opts.source)    { where.push("source = ?");     params.push(String(opts.source)) }
		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
		const limit  = Number.isFinite(opts.limit)  ? Math.min(500, Math.max(1, Math.trunc(opts.limit)))   : 50
		const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.trunc(opts.offset)) : 0

		return db.prepare(`
			SELECT * FROM prediction_epochs
			${whereSql}
			ORDER BY captured_at DESC, epoch_id DESC
			LIMIT ${limit} OFFSET ${offset}
		`).all(...params)
	})
}

/**
 * Get a single epoch by id.
 */
function getEpoch(epochId) {
	if (!epochId) return null
	return _safeQuery((db) =>
		db.prepare("SELECT * FROM prediction_epochs WHERE epoch_id = ?").get(epochId) || null,
	)
}

/**
 * Get all predictions belonging to an epoch, joined with their contextual state
 * and outcome (when available).
 *
 * Schema of returned rows:
 *   prediction_*     (from prediction_snapshots)
 *   ctx_*            (from frozen_contextual_states)
 *   outcome_*        (from outcome_snapshots — null when ungraded)
 *
 * Result is sorted by edge desc, then model_prob desc.
 */
function getEpochPredictions(epochId) {
	if (!epochId) return null
	return _safeQuery((db) => {
		// Find the run_date + sport for this epoch
		const epoch = db.prepare("SELECT slate_date, sport FROM prediction_epochs WHERE epoch_id = ?").get(epochId)
		if (!epoch) return []

		// Join predictions to contextual states. We restrict by the epoch's slate_date + sport
		// AND require the prediction_id to appear in frozen_contextual_states with this epoch_id —
		// that's what links a prediction to an epoch (predictions could appear in multiple epochs
		// across days; contextual_states.epoch_id is the actual binding).
		const rows = db.prepare(`
			SELECT
				ps.id              AS prediction_id,
				ps.run_date        AS prediction_run_date,
				ps.sport           AS prediction_sport,
				ps.player          AS prediction_player,
				ps.team            AS prediction_team,
				ps.matchup         AS prediction_matchup,
				ps.stat_family     AS prediction_stat_family,
				ps.side            AS prediction_side,
				ps.line            AS prediction_line,
				ps.odds            AS prediction_odds,
				ps.model_prob      AS prediction_model_prob,
				ps.implied_prob    AS prediction_implied_prob,
				ps.edge            AS prediction_edge,
				ps.tier            AS prediction_tier,
				ps.volatility      AS prediction_volatility,
				ps.sportsbook      AS prediction_sportsbook,
				ps.created_at      AS prediction_created_at,

				fcs.epoch_id                  AS ctx_epoch_id,
				fcs.matchup_score             AS ctx_matchup_score,
				fcs.matchup_shift             AS ctx_matchup_shift,
				fcs.recent_form_z             AS ctx_recent_form_z,
				fcs.recent_form_sample        AS ctx_recent_form_sample,
				fcs.recent_form_shift         AS ctx_recent_form_shift,
				fcs.starter_flag              AS ctx_starter_flag,
				fcs.projected_minutes         AS ctx_projected_minutes,
				fcs.teammate_absent_count     AS ctx_teammate_absent_count,
				fcs.teammate_redist_shift     AS ctx_teammate_redist_shift,
				fcs.market_consensus_implied  AS ctx_market_consensus_implied,
				fcs.market_dispersion         AS ctx_market_dispersion,
				fcs.market_book_count         AS ctx_market_book_count,
				fcs.market_shift              AS ctx_market_shift,
				fcs.player_status             AS ctx_player_status,
				fcs.availability_shift        AS ctx_availability_shift,
				fcs.final_model_prob          AS ctx_final_model_prob,
				fcs.final_edge                AS ctx_final_edge,
				fcs.raw_context_json          AS ctx_raw_context_json,

				os.actual_value    AS outcome_actual_value,
				os.hit             AS outcome_hit,
				os.delta_prob      AS outcome_delta_prob,
				os.clv             AS outcome_clv,
				os.closing_odds    AS outcome_closing_odds,
				os.settled_at      AS outcome_settled_at,
				os.notes           AS outcome_notes
			FROM frozen_contextual_states fcs
			INNER JOIN prediction_snapshots ps ON ps.id = fcs.prediction_id
			LEFT JOIN  outcome_snapshots    os ON os.id = ps.id
			WHERE fcs.epoch_id = ?
			ORDER BY ps.edge DESC, ps.model_prob DESC
		`).all(epochId)

		return rows.map(_parseRawContext)
	})
}

/**
 * Get a single frozen prediction with contextual state + outcome (if any).
 * Useful for replaying the system's reasoning at the moment a prediction was made.
 */
function getFrozenPredictionWithContext(predId) {
	if (!predId) return null
	return _safeQuery((db) => {
		const ps  = db.prepare("SELECT * FROM prediction_snapshots WHERE id = ?").get(predId)
		if (!ps) return null
		const fcs = db.prepare("SELECT * FROM frozen_contextual_states WHERE prediction_id = ?").get(predId) || null
		const os  = db.prepare("SELECT * FROM outcome_snapshots WHERE id = ?").get(predId) || null
		return {
			prediction: _parseRawJson(ps),
			contextual: fcs ? _parseRawContext(fcs) : null,
			outcome:    os,
		}
	})
}

module.exports = {
	listEpochs,
	getEpoch,
	getEpochPredictions,
	getFrozenPredictionWithContext,
}
