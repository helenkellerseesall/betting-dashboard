"use strict"

/**
 * responseShapeResolvers.js — Phase Canonical-Shape-Hardening-1A (HARDEN-1)
 * 2026-05-15
 *
 * Single source of truth for resolving canonical operator payload shapes.
 * Every observability / diagnostic / status consumer in the repo must import
 * its readers from this module rather than fork its own optional-chain.
 *
 * Why this module exists
 * ──────────────────────
 * Phase Snapshot-Authority-1A (INC-016) and Phase Intelligence-Shaping-1A
 * (INC-017) both fixed point symptoms of one architectural anti-pattern:
 * each observability surface wrote its own ad-hoc resolver for the same
 * canonical payload key, then drifted independently when the upstream API
 * shape evolved. This module centralizes the resolution so future API
 * evolution updates one file, not N consumers.
 *
 * Anti-fabrication doctrine
 * ─────────────────────────
 * When the canonical field is absent on the input payload, helpers return
 * the literal string "n/a" — never a synthesized default. The operator-
 * visible distinction between "unknown" and "0" is preserved.
 *
 * Canonical authority cross-reference
 * ───────────────────────────────────
 * The shape contracts these helpers conform to are owned by the route /
 * writer files; the helpers MUST NOT redefine the shape. If a helper here
 * diverges from the authority file, the helper is wrong by definition.
 *
 *   • /api/best-available?sport=basketball_nba
 *     authority: backend/http/nbaIsolatedRoutes.js (~line 1477,
 *                handleNbaBestAvailableGet)
 *     returns:    { bestAvailable: { best, elite, strong, ladders,
 *                                    firstBasket, aiSlips, featured,
 *                                    wsCandidates },
 *                   nbaOpportunityBoard, nbaInsightBoard,
 *                   nbaCacheDiagnostics }
 *
 *   • /api/best-available?sport=baseball_mlb
 *     authority: backend/http/mlbIsolatedRoutes.js (~line 103-612,
 *                handleMlbBestAvailableGet)
 *     returns:    { ok, sport, mlbSnapshot, best, finalPlayableRows,
 *                   parlays: { core, fun, lotto, topPlays },
 *                   topPlays, liveTickets, ceilingPlays,
 *                   coreStandardProps, ladderProps, specialProps }
 *
 *   • /api/ws/state?sport={nba|mlb}
 *     authority: backend/routes/workstationRoutes.js (~line 693-712)
 *     returns:    { sport, date,
 *                   counts: { candidates, urgent, propsWithMultiBook,
 *                             steam, stale },
 *                   candidates, slipBets,
 *                   lineShopping, timing, portfolio,
 *                   aiSlips: { safe, balanced, aggressive, lotto },
 *                   aiSlipsSummary,
 *                   featured,
 *                   snapshotFreshness }
 *
 *   • backend/snapshot.json (NBA on-disk)
 *     authority: backend/pipeline/nba/fetchNbaOddsSnapshot.js:673-687
 *                (saveNbaSnapshotToDisk)
 *     shape:      { data: { events, rawProps, props, eliteProps:[],
 *                           strongProps:[], playableProps:[], bestProps,
 *                           flexProps:[], diagnostics, parlays,
 *                           dualParlays },
 *                   savedAt }
 *     row key:    data.props (canonical for NBA)
 *
 *   • backend/snapshot-mlb.json (MLB on-disk)
 *     authority: backend/server.js:11006-11020 (saveMlbReplaySnapshotToDisk)
 *     shape:      { data: { sport, events, rows, props,
 *                           externalSnapshotMeta, diagnostics },
 *                   savedAt }
 *     row key:    data.rows (canonical for MLB; data.props also present)
 *
 * Behavior contract
 * ─────────────────
 * Every exported function:
 *   1. is pure — no I/O, no logging, no side effects.
 *   2. is deterministic — same input → same output, every time.
 *   3. returns either a finite number OR the literal string "n/a".
 *      Never returns null / undefined / NaN / synthetic defaults.
 *   4. cross-references the authority file in its JSDoc.
 *
 * Migration policy
 * ────────────────
 * Phase Canonical-Shape-Hardening-1A migrates ONE existing consumer
 * (slateMlb.js — the still-open drift site). Phase 1B will sweep
 * slateNba.js / marketStatus.js / buildIntelligencePresentation.js /
 * buildMlbWeather.js onto these helpers. Until then, those consumers
 * retain their existing (correct-but-duplicated) inline logic.
 */

const NA = "n/a"

// ── shared internal helpers (not exported) ───────────────────────────────────

function _arrLen(v) {
  return Array.isArray(v) ? v.length : null
}

function _finiteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function _orNA(v) {
  return v == null ? NA : v
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the canonical rows array from a snapshot file payload.
 *
 * NBA's `fetchNbaOddsSnapshot` persists rows at `data.props`; MLB's
 * `buildMlbBootstrapSnapshot` persists at `data.rows`. Both shapes are
 * deterministic on their respective writers and never overlap with each
 * other on the same file. The helper returns the rows array regardless of
 * which key the upstream writer used.
 *
 * @param {object|null|undefined} snap   On-disk snapshot payload — the full
 *                                       `{ data, savedAt }` shape as written
 *                                       to backend/snapshot.json or
 *                                       backend/snapshot-mlb.json.
 * @returns {Array} The canonical rows array. Returns `[]` (empty array — NOT
 *                  "n/a") when the snapshot is missing or no row key is
 *                  present, preserving the existing operator semantics in
 *                  every site this helper replaces (workstationRoutes.js:135,
 *                  workstationRoutes.js:190, marketStatus.js:80,
 *                  buildIntelligencePresentation.js:736).
 */
function resolveSnapshotRows(snap) {
  if (snap == null) return []
  // Authority order (must mirror workstationRoutes.js:135 + :190 canonical):
  //   1. data.rows  (MLB writer canonical key)
  //   2. data.props (NBA writer canonical key)
  //   3. rows       (legacy top-level fallback)
  if (Array.isArray(snap?.data?.rows))  return snap.data.rows
  if (Array.isArray(snap?.data?.props)) return snap.data.props
  if (Array.isArray(snap?.rows))        return snap.rows
  return []
}

/**
 * Resolve the count of featured plays from `/api/ws/state` response.
 *
 * Canonical key: `state.featured` (workstationRoutes.js:~705).
 *
 * Earlier consumers wrote `state.featuredPlays` — that key was never emitted
 * by the canonical API and produced the operator-visible "n/a" cascade in
 * INC-017. This resolver consults only the canonical path.
 *
 * @param {object|null|undefined} state  `/api/ws/state` response body
 * @returns {number|"n/a"}               Length of `state.featured`, or "n/a"
 */
function resolveFeaturedCount(state) {
  return _orNA(_arrLen(state?.featured))
}

/**
 * Resolve the total AI-slip count from `/api/ws/state` response.
 *
 * Canonical shape: `state.aiSlips` IS the tier-object
 * `{ safe, balanced, aggressive, lotto }` (workstationRoutes.js:~703).
 * There is NO `.slips` wrapper inside `aiSlips`; that misreading was the
 * INC-017 bug.
 *
 * The total is the sum of the four tier arrays' lengths. If `state.aiSlips`
 * is absent, returns "n/a". If `state.aiSlips` is present but all four
 * tier arrays are missing/non-array, returns 0 (every tier was deterministically
 * empty in the API).
 *
 * @param {object|null|undefined} state  `/api/ws/state` response body
 * @returns {number|"n/a"}               Sum of four tier-array lengths
 */
function resolveAiSlipCount(state) {
  const tiers = state?.aiSlips
  if (tiers == null) return NA
  // Each tier array is canonically `[]` when empty (per workstationRoutes.js
  // default at line 703); we sum the four canonical tier keys.
  const safe       = _arrLen(tiers?.safe)       ?? 0
  const balanced   = _arrLen(tiers?.balanced)   ?? 0
  const aggressive = _arrLen(tiers?.aggressive) ?? 0
  const lotto      = _arrLen(tiers?.lotto)      ?? 0
  return safe + balanced + aggressive + lotto
}

/**
 * Resolve the candidate-pool size from `/api/ws/state` response.
 *
 * Canonical shape: `state.counts.candidates` is the count;
 * `state.candidates` is the array (workstationRoutes.js:~640, :~698).
 *
 * Prefers the explicit counts field; falls back to array length. Returns
 * "n/a" when neither is available.
 *
 * @param {object|null|undefined} state  `/api/ws/state` response body
 * @returns {number|"n/a"}
 */
function resolveCandidateCount(state) {
  const explicit = _finiteNumber(state?.counts?.candidates)
  if (explicit != null) return explicit
  const arr = _arrLen(state?.candidates)
  if (arr != null) return arr
  return NA
}

/**
 * Resolve the best-available pick count from `/api/best-available` response.
 * The shape is sport-asymmetric (a known longstanding divergence):
 *
 *   • NBA: `payload.bestAvailable.best` — array of top-N elite plays
 *     (nbaIsolatedRoutes.js:~1477).
 *   • MLB: `payload.best` — array of top picks
 *     (mlbIsolatedRoutes.js:~103-612). MLB does NOT nest under `bestAvailable`.
 *
 * @param {object|null|undefined} payload  `/api/best-available` response body
 * @param {string} sport                    "nba" | "basketball_nba" | "mlb" |
 *                                          "baseball_mlb" — case-insensitive
 * @returns {number|"n/a"}
 */
function resolveBestAvailableCount(payload, sport) {
  if (payload == null) return NA
  const s = String(sport || "").toLowerCase()
  // NBA-shape: nested under bestAvailable.best
  if (s.includes("nba") || s.includes("basketball")) {
    return _orNA(_arrLen(payload?.bestAvailable?.best))
  }
  // MLB-shape: top-level best (no bestAvailable nesting)
  if (s.includes("mlb") || s.includes("baseball")) {
    // Try top-level "best" first; fall back to legacy "bestAvailable.best"
    // only if the MLB route ever evolves to the nested shape.
    if (Array.isArray(payload?.best)) return payload.best.length
    if (Array.isArray(payload?.bestAvailable?.best)) return payload.bestAvailable.best.length
    return NA
  }
  // Unknown sport — try both shapes deterministically, NA if neither matches.
  if (Array.isArray(payload?.bestAvailable?.best)) return payload.bestAvailable.best.length
  if (Array.isArray(payload?.best))                return payload.best.length
  return NA
}

module.exports = {
  // canonical helpers (exported for migration by future Phase Canonical-Shape-Hardening sub-phases)
  resolveSnapshotRows,
  resolveFeaturedCount,
  resolveAiSlipCount,
  resolveCandidateCount,
  resolveBestAvailableCount,
  // exported for tests / future probe (HARDEN-5)
  NA,
}
