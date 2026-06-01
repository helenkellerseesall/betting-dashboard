"use strict"

/**
 * archetypeHistoryLookup — per-(sport, volatility, tier) historical archetype
 * performance, surfaced on TOP PICKS + GAMES BROWSER picks so the bettor can
 * see "plays like this hit X% historically" in dimension terms (Law 24 +
 * Law 27 class-not-identity recognition).
 *
 * Phase Archetype-Surfacing-1A (2026-05-31):
 *   Wraps the canonical SQLite reader `getArchetypePerf` in
 *   `backend/storage/intelligence.js`. NO parallel computation — single
 *   authority per Law 1. Adds in-memory cache (5 min TTL) since this is
 *   called per-pick across N picks per request.
 *
 * API:
 *   getArchetypeHistoryForPick(sport, volatility, tier)
 *     Returns { n, hitRate, avgModelProb, avgDeltaProb, avgEdge } or null.
 *     Returns null when the (sport, volatility, tier) bucket has fewer than
 *     MIN_SAMPLE (10) historical plays — anti-fabrication doctrine: low
 *     samples produce noisy hit rates that mislead the bettor.
 *
 *   reload() — clear cache, force fresh read on next call (used by tests).
 *
 * Data source: outcome_snapshots GROUP BY (volatility, tier) per sport.
 * Same join the daily intelligence review writes; we just READ it.
 */

const path = require("path")

const MIN_SAMPLE        = 10
const CACHE_TTL_MS      = 5 * 60 * 1000
const SUPPORTED_SPORTS  = ["nba", "mlb"]

let _cache    = null   // Map<"sport|volatility|tier", {...}>
let _loadedAt = 0
let _lastError = null

function _norm(s) { return String(s || "").toLowerCase().trim() }
function _key(sport, volatility, tier) {
  return `${_norm(sport)}|${_norm(volatility)}|${_norm(tier).toUpperCase()}`
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
    let rows = null
    try { rows = intel.getArchetypePerf({ sport }) } catch (e) {
      _lastError = `getArchetypePerf-threw: ${e.message}`
      continue
    }
    if (!Array.isArray(rows)) continue
    for (const r of rows) {
      if (!r || !Number.isFinite(Number(r.total)) || Number(r.total) < MIN_SAMPLE) continue
      map.set(_key(sport, r.volatility, r.tier), {
        n:             Number(r.total) || 0,
        hitRate:       Number(r.hit_rate)       || null,
        avgModelProb:  Number(r.avg_model_prob) || null,
        avgDeltaProb:  Number(r.avg_delta_prob) || null,
        avgEdge:       Number(r.avg_edge)       || null,
      })
    }
  }
  _lastError = null
  _cache = map
  _loadedAt = now
  return _cache
}

function reload() { _cache = null; _loadedAt = 0 }

/**
 * Resolve archetype history for a single pick.
 *
 * @param {string} sport       — "nba" or "mlb"
 * @param {string} volatility  — "safe" / "balanced" / "aggressive" / "lotto"
 * @param {string} tier        — "ELITE" / "STRONG" / "PLAYABLE" / etc.
 * @returns {object|null}
 */
function getArchetypeHistoryForPick(sport, volatility, tier) {
  const m = _load()
  return m.get(_key(sport, volatility, tier)) || null
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
      "  " + k.padEnd(28),
      "n=" + String(v.n).padStart(4),
      "  hit=" + (v.hitRate != null ? (v.hitRate * 100).toFixed(1) + "%" : "  -  "),
      "  avgMP=" + (v.avgModelProb != null ? v.avgModelProb.toFixed(3) : "  -  "),
      "  avgDP=" + (v.avgDeltaProb != null ? v.avgDeltaProb.toFixed(4) : "  -  "),
      "  avgEdge=" + (v.avgEdge != null ? v.avgEdge.toFixed(4) : "  -  ")
    )
  }
  console.log("")
}
