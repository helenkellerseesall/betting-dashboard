"use strict"

/**
 * calibrationFeedback.js — 2026-05-29 — Lane B Phase 3 v0.3.0
 *
 * THE CALIBRATION FEEDBACK WIRE.
 *
 * Reads historical hit rates from outcome_snapshots × prediction_snapshots
 * and returns adjustment factors that the slate engine's model confidence
 * calculations consume. Closes the learning loop: nightly graded results
 * directly nudge tomorrow's pick confidence.
 *
 * Without this module, the slate engine's confidence multipliers (e.g.
 * calibrateMlbConfidence) are hardcoded human-tuned values from Lane D
 * series — the model never improves from measurement. With this module:
 *
 *   threes hit 14% historically vs 42% model_avg → confidence × 0.34
 *   unders hit 51% (vs overs 24%) → conf × 1.05 for unders, × 0.65 for overs
 *   ELITE picks hit 44% vs 60% model said → tier criteria self-tighten
 *
 * Design:
 *   - Lazy SQLite connection (one shot per process boot)
 *   - In-memory cache, 1 hour TTL (slate runs hourly, cache hits between)
 *   - Bayesian shrinkage to a 0.50 prior:
 *       adjusted_rate = (n × live_rate + N_PRIOR × 0.50) / (n + N_PRIOR)
 *     where N_PRIOR = 30 means it takes 30+ live samples to half-weight live
 *     data vs prior. Avoids over-correcting on small samples.
 *   - Returns 1.0 when no data exists or DB is unavailable (safe default)
 *   - Adjustment factor = adjusted_rate / 0.50 (1.0 = no change)
 *
 * Read-only. Pure deterministic given the same DB state.
 */

const path = require("path")

const N_PRIOR = 30        // Sample-size weight: 30 picks to half-weight prior
const MODEL_PRIOR = 0.50  // Assumes 50% base rate when no data
const CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour
const MIN_SAMPLE_FOR_USE = 5  // Below this, return 1.0 (no adjustment)
const DAYS_BACK_DEFAULT = 30  // Rolling 30-day window

const cache = new Map()  // key: `${sport}|${family}|${side}` → { factor, ts }
let _dbHandle = null
let _dbTriedAndFailed = false

function _tryGetDb() {
  if (_dbHandle) return _dbHandle
  if (_dbTriedAndFailed) return null
  try {
    const { tryGetDb } = require("../../storage/db")
    const db = tryGetDb()
    if (!db) { _dbTriedAndFailed = true; return null }
    _dbHandle = db
    return db
  } catch (_) {
    _dbTriedAndFailed = true
    return null
  }
}

/**
 * Get the calibration adjustment factor for a (sport, family, side) tuple.
 *
 * @param {Object} args
 * @param {string} args.sport       — "mlb" or "nba"
 * @param {string} args.statFamily  — "points", "threes", "totalbases", etc.
 * @param {string} args.side        — "over", "under", "yes", "no"
 * @param {number} [args.daysBack]  — rolling window (default 30)
 * @returns {number} adjustment factor in [0.1, 2.0]; 1.0 = no change
 */
function getCalibrationFactor({ sport, statFamily, side, daysBack = DAYS_BACK_DEFAULT } = {}) {
  if (!statFamily || !side) return 1.0
  const sportKey = String(sport || "").toLowerCase()
  const famKey = String(statFamily || "").toLowerCase()
  const sideKey = String(side || "").toLowerCase()
  const cacheKey = `${sportKey}|${famKey}|${sideKey}`

  // Cache hit?
  const cached = cache.get(cacheKey)
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.factor
  }

  const db = _tryGetDb()
  if (!db) {
    cache.set(cacheKey, { factor: 1.0, ts: Date.now() })
    return 1.0
  }

  try {
    const sportFilter = sportKey ? `AND LOWER(ps.sport) = ?` : ``
    const params = sportKey
      ? [famKey, sideKey, sportKey]
      : [famKey, sideKey]

    const row = db.prepare(`
      SELECT COUNT(*) AS n, AVG(os.hit) AS hit_rate
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        AND LOWER(ps.stat_family) = ?
        AND LOWER(ps.side) = ?
        ${sportFilter}
        AND ps.run_date >= date('now', '-${Number(daysBack) || 30} days')
    `).get(...params)

    if (!row || !row.n || row.n < MIN_SAMPLE_FOR_USE) {
      cache.set(cacheKey, { factor: 1.0, ts: Date.now() })
      return 1.0
    }

    const n = Number(row.n)
    const liveRate = Number(row.hit_rate)
    // Bayesian shrinkage to MODEL_PRIOR
    const adjustedRate = (n * liveRate + N_PRIOR * MODEL_PRIOR) / (n + N_PRIOR)
    let factor = adjustedRate / MODEL_PRIOR
    // Clamp to sane range — even if a family hit 0% over a small window we
    // shouldn't completely zero out tomorrow's picks; even if it hit 100% we
    // shouldn't double model conf.
    factor = Math.max(0.1, Math.min(2.0, factor))

    cache.set(cacheKey, { factor, ts: Date.now() })
    return factor
  } catch (_) {
    cache.set(cacheKey, { factor: 1.0, ts: Date.now() })
    return 1.0
  }
}

/**
 * Diagnostic dump: return the current calibration table for all known (sport,
 * family, side) tuples that have data. Used by status.sh / calibration:status
 * for operator visibility into what the wire is actually doing.
 */
function dumpCalibrationTable({ daysBack = DAYS_BACK_DEFAULT } = {}) {
  const db = _tryGetDb()
  if (!db) return []
  try {
    return db.prepare(`
      SELECT
        LOWER(ps.sport)       AS sport,
        LOWER(ps.stat_family) AS stat_family,
        LOWER(ps.side)        AS side,
        COUNT(*)              AS n,
        AVG(os.hit)           AS hit_rate,
        AVG(ps.model_prob)    AS model_avg
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        AND ps.run_date >= date('now', '-${Number(daysBack) || 30} days')
      GROUP BY ps.sport, ps.stat_family, ps.side
      ORDER BY COUNT(*) DESC
    `).all().map((r) => {
      const adjustedRate = r.n >= MIN_SAMPLE_FOR_USE
        ? (r.n * r.hit_rate + N_PRIOR * MODEL_PRIOR) / (r.n + N_PRIOR)
        : MODEL_PRIOR
      const factor = Math.max(0.1, Math.min(2.0, adjustedRate / MODEL_PRIOR))
      return { ...r, adjustedRate, factor }
    })
  } catch (_) {
    return []
  }
}

/**
 * Clear the in-memory cache. Used by tests or after a manual grading backfill
 * when we want the slate engine to immediately see new data without waiting
 * for the 1h TTL.
 */
function clearCache() {
  cache.clear()
}

module.exports = {
  getCalibrationFactor,
  dumpCalibrationTable,
  clearCache,
  // Constants exported for inspection / verification
  N_PRIOR,
  MODEL_PRIOR,
  MIN_SAMPLE_FOR_USE,
  DAYS_BACK_DEFAULT,
  CACHE_TTL_MS,
}
