"use strict"

/**
 * Phase 1 — Live Injury + Availability V1 (Session AV).
 *
 * Real per-player availability cache reader + workstation row enricher.
 * Reads data/nbaInjuryReport.json (populated by scripts/populateNbaInjuryReport.js)
 * which itself uses ESPN's /teams/{id}/injuries endpoint and the EXISTING
 * dormant normaliser pipeline/edge/ingestNbaOfficialInjuryReport.normalize-
 * NbaOfficialAvailabilityStatus.
 *
 * Status taxonomy (from the dormant normaliser):
 *   "out"          — confirmed inactive
 *   "doubtful"     — very unlikely to play
 *   "questionable" — game-time decision
 *   "probable"     — limited but expected to play
 *   "active"       — confirmed available
 *   "unknown"      — not in cache OR unrecognised raw status
 *
 * Modeling rule: availability shapes UNCERTAINTY, never creates fake certainty.
 *   - "out"          → row.playerStatus marked; row should typically not exist
 *                       on tonight's slate (sportsbooks pull props for OUT players).
 *                       If it does, suppress modelProb confidence further.
 *   - "doubtful"     → -1.5 pp confidence suppression
 *   - "questionable" → -1.0 pp confidence suppression (uncertainty)
 *   - "probable"     → +0.5 pp confidence boost (uncertainty resolved up)
 *   - "active"       → 0 (no shift; baseline)
 *   - "unknown"      → 0 (honest no-signal — never invent status)
 *
 * Hard caps:
 *   MAX_AVAILABILITY_SHIFT_PP = 0.020 (2 pp)
 *
 * The shift composes alongside Sessions AO/AS/AT shifts via the same
 * `nbaRowIndependentModelProbability` summation. No score-formula changes.
 *
 * Public surface:
 *   loadAvailabilityCache()                      — reads JSON, in-memory cache
 *   getAvailability(player)                       — returns { status, raw_status, description, team, lastUpdated } | null
 *   enrichRowWithAvailability(row)                — mutates row to set playerStatus + availabilityContext + availabilityShift
 *   resetCache()                                  — for tests
 */

const fs   = require("fs")
const path = require("path")

const CACHE_PATH = path.join(__dirname, "..", "..", "data", "nbaInjuryReport.json")

// === Constants — bounded shift values, sample-quality dampened by status strength ===
const STATUS_SHIFT_PP = {
  out:          -0.020,  // confirmed OUT: max suppression (typically row shouldn't exist on slate)
  doubtful:     -0.015,
  questionable: -0.010,
  probable:     +0.005,
  active:        0,
  unknown:       0,
}
const MAX_AVAILABILITY_SHIFT_PP = 0.020

// === Helpers ===

function normPlayer(s) { return String(s || "").trim().toLowerCase() }

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fb }
}

function clamp(min, max, v) { return Math.max(min, Math.min(max, v)) }

// === In-memory cache ===
let _memCache = null

function loadAvailabilityCache() {
  if (_memCache) return _memCache
  const raw = readJsonSafe(CACHE_PATH, null)
  if (!raw || !raw.players) {
    _memCache = { generatedAt: null, players: {} }
    return _memCache
  }
  _memCache = raw
  return _memCache
}

function resetCache() { _memCache = null }

// === Public reader ===

/**
 * Returns availability record for a single player, or null when the player is
 * absent from the cache (honest unknown — NOT "active by default").
 *
 * @param {string} player
 * @returns {{ status, raw_status, description, team, team_id, lastUpdated } | null}
 */
function getAvailability(player) {
  const cache = loadAvailabilityCache()
  const pk = normPlayer(player)
  if (!pk) return null
  const r = cache.players[pk]
  return r || null
}

/**
 * Mutates row to inject availability context + bounded shift.
 *
 * Sets:
 *   - row.playerStatus            normalised status string ("out" | "questionable" | ...)
 *   - row.availabilityContext     structured object (status, raw_status, description, source)
 *   - row.availabilityShift       signed probability-units shift consumed by
 *                                 nbaRowIndependentModelProbability
 *
 * No-op when player not in cache (honest unknown). The deriver does NOT
 * fabricate "active" status when the player is absent — absence in cache
 * means "no signal", which downstream contributes 0 to the score.
 *
 * Side-aware: status shifts apply to OVER side as listed above. For UNDER
 * side, the shift is INVERTED (a questionable player is LESS likely to go
 * over but MORE likely to go under).
 */
function enrichRowWithAvailability(row) {
  if (!row || typeof row !== "object") return row
  const player = row.player || row.playerName
  if (!player) return row
  const a = getAvailability(player)
  if (!a) return row

  row.playerStatus = a.status   // overrides snapshot row's null playerStatus field
  row.availabilityContext = {
    status:      a.status,
    raw_status:  a.raw_status,
    description: a.description,
    team:        a.team,
    lastUpdated: a.lastUpdated,
    source:      "espn_team_injuries",
  }

  // Compute bounded shift. Side-aware: for under, invert.
  const baseShift = STATUS_SHIFT_PP[a.status] ?? 0
  if (baseShift === 0) {
    row.availabilityShift = 0
    return row
  }

  // baseShift sign convention is for the over-side bettor. For the under-side
  // bettor, a status that suppresses overs (e.g. "out") supports unders.
  const side = String(row.side || "").toLowerCase()
  const sideAware = side === "under" ? -baseShift : baseShift
  const shift = clamp(-MAX_AVAILABILITY_SHIFT_PP, MAX_AVAILABILITY_SHIFT_PP, sideAware)

  row.availabilityShift = Number(shift.toFixed(4))
  row.availabilityContext.applied_shift_pp = Number((shift * 100).toFixed(2))
  return row
}

// === Slate-level helper for teammate-context confidence upgrade ===

/**
 * Given the slate's snapshot rows, return a Map<playerLower, "out"|"doubtful"|...>
 * for ALL players on tonight's slate teams that have a cache record.
 *
 * Useful for teammate-context-deriver to upgrade absence detections from
 * "medium confidence" (slate-derived) to "high confidence" (CACHE-CONFIRMED OUT).
 *
 * @param {Array<object>} snapshotRows
 * @returns {Map<string, string>}
 */
function getSlateAvailabilityMap(snapshotRows) {
  loadAvailabilityCache()
  const out = new Map()
  if (!Array.isArray(snapshotRows)) return out
  // Collect the set of teams playing tonight to bound the look-up
  const slateTeams = new Set()
  for (const r of snapshotRows) {
    if (r?.homeTeam) slateTeams.add(String(r.homeTeam).toLowerCase())
    if (r?.awayTeam) slateTeams.add(String(r.awayTeam).toLowerCase())
  }
  // Iterate cache, return entries whose team is in tonight's slate
  for (const [pk, rec] of Object.entries(_memCache?.players || {})) {
    if (rec?.team && slateTeams.has(String(rec.team).toLowerCase())) {
      out.set(pk, rec.status)
    }
  }
  return out
}

module.exports = {
  loadAvailabilityCache,
  getAvailability,
  enrichRowWithAvailability,
  getSlateAvailabilityMap,
  resetCache,
  // exposed for tests
  STATUS_SHIFT_PP,
  MAX_AVAILABILITY_SHIFT_PP,
}
