"use strict"

/**
 * archetypeHistoryLookup — historical archetype performance surfaced on
 * TOP PICKS + GAMES BROWSER picks so the bettor can see "plays like this
 * hit X% historically" in dimension terms (Law 24 + Law 27 class-not-
 * identity recognition).
 *
 * Phase Archetype-Surfacing-1A (2026-05-31):
 *   Wraps the canonical SQLite reader `getArchetypePerf` in
 *   `backend/storage/intelligence.js` and adds a second SQL aggregation
 *   for per-(sport, stat_family) hit rate. NO parallel computation — extends
 *   the canonical authority per Law 1.
 *
 * Phase Archetype-Surfacing-1A.1 (2026-05-31):
 *   Discovery — tracked_best response entries (the source of TOP PICKS) do
 *   NOT carry volatility/tier fields. Those exist on tracked_bets / on
 *   prediction_snapshots but never propagate through to the /top-picks
 *   response shape (queued as #71 wiring gap). Adding family-based fallback
 *   so the surface still fires on the bulk of picks. Lookup ladder:
 *     1. (sport, volatility, tier) bucket — best signal when available
 *     2. (sport, family) bucket — universal fallback
 *     3. null
 *
 * API:
 *   getArchetypeHistoryForPick(sport, volatility, tier, statFamily)
 *     Returns { n, hitRate, avgModelProb, avgDeltaProb, avgEdge, bucket }
 *     or null. `bucket` is "tier" or "family".
 *
 *   reload() — clear cache, force fresh read on next call.
 *
 * Data source: outcome_snapshots — same join `calibration:status` reads.
 */

const path = require("path")

const MIN_SAMPLE        = 10
const CACHE_TTL_MS      = 5 * 60 * 1000
const SUPPORTED_SPORTS  = ["nba", "mlb"]

let _cache    = null   // Map<"key", {...}>
let _loadedAt = 0
let _lastError = null

function _norm(s) { return String(s || "").toLowerCase().trim() }
function _normFam(s) {
  // Match the dampener's family alias normalization for join-key consistency.
  return _norm(s)
    .replace(/\s+/g, "")
    .replace(/_+/g, "")
}
function _keyTier(sport, volatility, tier) {
  return `T|${_norm(sport)}|${_norm(volatility)}|${_norm(tier).toUpperCase()}`
}
function _keyFam(sport, family) {
  return `F|${_norm(sport)}|${_normFam(family)}`
}

function _load() {
  const now = Date.now()
  if (_cache && (now - _loadedAt) < CACHE_TTL_MS) return _cache
  const map = new Map()
  let intel
  try {
    intel = require(path.join(__dirname, "..", "..", "storage", "intelligence"))
  } catch (e) {
    _lastError = `intelligence-module-missing: ${e.message}`
    _cache = map
    _loadedAt = now
    return _cache
  }
  if (typeof intel.getArchetypePerf !== "function") {
    _lastError = "getArchetypePerf-not-exported"
    _cache = map
    _loadedAt = now
    return _cache
  }
  for (const sport of SUPPORTED_SPORTS) {
    // (1) per-(volatility, tier) — uses canonical intel.getArchetypePerf
    let rows = null
    try { rows = intel.getArchetypePerf({ sport }) } catch (e) {
      _lastError = `getArchetypePerf-threw: ${e.message}`
    }
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (!r || !Number.isFinite(Number(r.total)) || Number(r.total) < MIN_SAMPLE) continue
        map.set(_keyTier(sport, r.volatility, r.tier), {
          n:             Number(r.total) || 0,
          hitRate:       Number(r.hit_rate)       || null,
          avgModelProb:  Number(r.avg_model_prob) || null,
          avgDeltaProb:  Number(r.avg_delta_prob) || null,
          avgEdge:       Number(r.avg_edge)       || null,
          bucket:        "tier",
        })
      }
    }
    // (2) per-(sport, stat_family) — fallback when picks lack volatility/tier.
    // Direct SQL because intel has no per-family helper (could be lifted
    // later, but inline keeps this single canonical surface for archetype
    // surfacing without disturbing intel.js authority).
    try {
      const db = require(path.join(__dirname, "..", "..", "storage", "db")).tryGetDb()
      if (db) {
        const famRows = db.prepare(`
          SELECT
            stat_family,
            COUNT(*)                                              AS total,
            ROUND(
              1.0 * SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)
                   / NULLIF(SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END), 0),
              4
            )                                                     AS hit_rate,
            ROUND(AVG(model_prob), 4)                             AS avg_model_prob,
            ROUND(AVG(delta_prob), 4)                             AS avg_delta_prob,
            ROUND(AVG(edge), 4)                                   AS avg_edge
          FROM outcome_snapshots
          WHERE sport       = ?
            AND hit IS NOT NULL
            AND stat_family IS NOT NULL
          GROUP BY stat_family
          ORDER BY total DESC
        `).all(sport)
        for (const r of famRows || []) {
          if (!r || Number(r.total) < MIN_SAMPLE) continue
          map.set(_keyFam(sport, r.stat_family), {
            n:             Number(r.total) || 0,
            hitRate:       Number(r.hit_rate)       || null,
            avgModelProb:  Number(r.avg_model_prob) || null,
            avgDeltaProb:  Number(r.avg_delta_prob) || null,
            avgEdge:       Number(r.avg_edge)       || null,
            bucket:        "family",
          })
        }
      }
    } catch (e) {
      _lastError = `family-aggregation-threw: ${e.message}`
    }
  }
  _lastError = _lastError || null
  _cache = map
  _loadedAt = now
  return _cache
}

function reload() { _cache = null; _loadedAt = 0 }

/**
 * Resolve archetype history for a single pick. Lookup ladder:
 *   1. (sport, volatility, tier) bucket — best signal
 *   2. (sport, statFamily) bucket — fallback when picks lack volatility/tier
 *   3. null
 *
 * @returns {object|null}  { n, hitRate, avgModelProb, avgDeltaProb, avgEdge, bucket }
 */
function getArchetypeHistoryForPick(sport, volatility, tier, statFamily) {
  const m = _load()
  if (volatility && tier) {
    const hit = m.get(_keyTier(sport, volatility, tier))
    if (hit) return hit
  }
  if (statFamily) {
    const hit = m.get(_keyFam(sport, statFamily))
    if (hit) return hit
  }
  return null
}

function getLastError() { return _lastError }

module.exports = {
  getArchetypeHistoryForPick,
  getLastError,
  reload,
  _constants: { MIN_SAMPLE, CACHE_TTL_MS, SUPPORTED_SPORTS },
}

// ── CLI mode: `node archetypeHistoryLookup.js` dumps the full map ──────────
if (require.main === module) {
  const m = _load()
  console.log("=== archetypeHistoryLookup snapshot ===")
  console.log(`entries        : ${m.size}`)
  console.log(`minSample      : ${MIN_SAMPLE}`)
  if (getLastError()) console.log(`LAST ERROR     : ${getLastError()}`)
  console.log("")
  const sorted = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [k, v] of sorted) {
    console.log(
      "  " + k.padEnd(34),
      "n=" + String(v.n).padStart(4),
      "  hit=" + (v.hitRate != null ? (v.hitRate * 100).toFixed(1) + "%" : "  -  "),
      "  avgMP=" + (v.avgModelProb != null ? v.avgModelProb.toFixed(3) : "  -  "),
      "  avgEdge=" + (v.avgEdge != null ? v.avgEdge.toFixed(4) : "  -  "),
      "  [" + v.bucket + "]"
    )
  }
  console.log("")
}
