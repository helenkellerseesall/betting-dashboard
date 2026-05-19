"use strict"

/**
 * Phase CA-3d Item 0001 Increment 2 — survivabilityGate.js
 *
 * SHAPE γ HARD-GATE: SURVIVABILITY DIMENSION DISPATCHER (sport-aware).
 *
 * Increment 2 scope: DISPATCHER SHELL ONLY.
 *
 *   ── What this file IS in Increment 2 ────────────────────────────────────
 *   - The canonical entry point for the survivability dimension under
 *     Shape γ (Law 25). Sport-aware routing scaffold per Law 28.
 *   - Result shape canonicalized; consumer contract published.
 *   - Four-axis explanation scaffolding established (Law 30 signals slots).
 *   - admit-all NEUTRAL for every input regardless of sport.
 *
 *   ── What this file IS NOT in Increment 2 ────────────────────────────────
 *   - NOT consuming any canonical signal yet (zero canonical-signal reads).
 *   - NOT applying any per-family threshold (zero threshold activation).
 *   - NOT wired into buildFeaturedPlays / workstationRoutes / any FE surface.
 *   - NOT widening Candidate or FeaturedPlay (Law 18 + Law 21 — the result
 *     is a sidecar shape, NEVER a candidate-type extension).
 *   - NOT consulting the volatility class (Law 26 — fragility ≠ volatility;
 *     the dispatcher signature accepts no volatility input).
 *   - NOT referencing any per-player identity (Law 27).
 *
 *   ── Where the future cognition gate physically lives ────────────────────
 *   - This file is the canonical sport-aware dispatcher at workstation scope.
 *   - Increment 3 wires the MLB-specific gate predicate by importing
 *     `mlbSurvivabilityGate` from `backend/pipeline/mlb/mlbSurvivabilityGate.js`
 *     (does not yet exist; deferred to Increment 3 per operator-cemented
 *     scope lock).
 *   - Item 0002 (NBA sport-extension) wires NBA-specific predicate.
 *   - The dispatcher remains the single entry point; sport-specific
 *     predicates are sidecar modules dispatched FROM here, not invoked
 *     directly by consumers.
 *
 *   ── How qualification decisions are structurally represented ────────────
 *   - Every gate evaluation returns a `SurvivabilityGateResult` (typedef
 *     below). Result is a SIDECAR — never widens Candidate; never widens
 *     FeaturedPlay. Consumers reference this dispatcher's type, not the
 *     pipeline types.
 *   - `admit` is a BOOLEAN flag (Law 23 hard-gate-then-tune; binary
 *     admit/reject). NEVER a fractional contribution. NEVER mutated by
 *     downstream consumers.
 *   - `predicate` is a deterministic string identifier indicating which
 *     canonical predicate fired (shell-no-op in Increment 2; real predicate
 *     names in Increment 3+).
 *   - `signals` is the four-axis explanation scaffold (Law 30 four-question
 *     schema). Currently all axes are null in the shell; populated by
 *     subsequent CA-3d items as their dimensions ship.
 *   - `reasonTag` is a canonical SIGNAL_ID matching the bettorLanguage
 *     taxonomy when real (Increment 4 adds SURVIVABILITY_PHRASES library).
 *   - `phrase` is a deterministic bettor-language string (Law 24 + Law 30
 *     output explainability requirement); also deferred to Increment 4.
 *
 *   ── How four-axis explanations are scaffolded ──────────────────────────
 *   - `signals.who`         — Role ownership   (Law 30 question 1)
 *   - `signals.when`        — Game-flow         (Law 30 question 2)
 *   - `signals.survives`    — Ecology + survivability (Law 30 question 3)
 *   - `signals.marketEdge`  — Market + edge + payout (Law 30 question 4)
 *
 *   The structural shape is established here in Increment 2. The
 *   `survives` axis is populated by THIS gate when Increment 3+ adds real
 *   per-family qualification logic. The other three axes (`who` / `when`
 *   / `marketEdge`) are populated by future role-ownership / game-flow
 *   / market-psychology gates — they live in their own canonical helpers
 *   (not yet authored; subsequent CA-3d items per Stage C.10).
 *
 *   This means: a candidate eventually carries provenance from up to four
 *   dimensional gates, each writing its own slot in the four-axis schema.
 *   No single dimension widens another; no dimension can populate another's
 *   slot. Dimension boundaries are CANONICAL (Law 23 co-equality clause).
 *
 *   ── Doctrine constraints (operator-cemented; verifier-protected) ───────
 *   Verifier coverage from Increment 1:
 *     - verifyItem0001AntiSterilization.js (A5-A8 activate when this file
 *       ships) — asserts gate output shape, no filter-by-admit pattern in
 *       consumers, battlefield preservation.
 *     - verifyItem0001PropFamilyScope.js (B7 activates when this file
 *       ships) — asserts dispatcher returns admit flag, no per-player
 *       identity hooks.
 *
 * @typedef {Object} SurvivabilityGateSignals
 * @property {null} who          - Role ownership axis (Law 30 question 1; populated by future role gate)
 * @property {null} when         - Game-flow activation axis (Law 30 question 2; populated by future flow gate)
 * @property {null} survives     - Survivability axis (Law 30 question 3; populated by THIS gate when Increment 3+ ships real semantics)
 * @property {null} marketEdge   - Market + edge + payout-realizability axis (Law 30 question 4; populated by future market/edge tuner)
 *
 * @typedef {Object} SurvivabilityGateResult
 * @property {boolean} admit                 - Qualifying decision (Law 23 hard-gate-then-tune; binary admit/reject)
 * @property {string} predicate              - Canonical predicate identifier ("shell-no-op" in Increment 2)
 * @property {SurvivabilityGateSignals} signals - Four-axis Law 30 explanation scaffold
 * @property {string|null} reasonTag         - Canonical SIGNAL_ID (matches bettorLanguage taxonomy when real)
 * @property {string|null} phrase            - Deterministic bettor-language phrase (deferred to Increment 4)
 */

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL NEUTRAL RESULT SHELL
// Frozen immutable singleton. Returned for every Increment-2 invocation.
// Dispatcher-local type isolation: this is the ONLY shape consumers should
// pattern-match against. Consumers MUST NOT augment / mutate / extend it.
// ─────────────────────────────────────────────────────────────────────────────

const NEUTRAL_FOUR_AXIS_SCAFFOLD = Object.freeze({
  who: null,
  when: null,
  survives: null,
  marketEdge: null,
})

/** @type {SurvivabilityGateResult} */
const NEUTRAL_RESULT_SHELL = Object.freeze({
  admit:     true,                          // admit-all behavior per Increment 2 doctrine
  predicate: "shell-no-op",                 // diagnostic tag; transitions in Increment 3+
  signals:   NEUTRAL_FOUR_AXIS_SCAFFOLD,    // four-axis scaffold (all null in shell)
  reasonTag: null,                          // canonical SIGNAL_ID — deferred to Increment 4
  phrase:    null,                          // bettor-language phrase — deferred to Increment 4
})

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCHER (sport-aware; Law 28)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * survivabilityGate(candidate, sport)
 *
 * Sport-aware dispatcher for the survivability dimension gate (Law 25 hard
 * gate; Law 28 sport-agnostic taxonomy with sport-specific implementations).
 *
 * INCREMENT 2 BEHAVIOR (current):
 *   Returns admit-all NEUTRAL for every input regardless of sport.
 *   No canonical signal consumed. No threshold evaluated. No phrase emitted.
 *
 * INCREMENT 3+ BEHAVIOR (deferred):
 *   Sport-specific gate predicates dispatch from here:
 *     if (sport === "mlb") return mlbSurvivabilityGate(candidate)
 *     if (sport === "nba") return nbaSurvivabilityGate(candidate)  // Item 0002
 *     return NEUTRAL_RESULT_SHELL                                   // unsupported sport → neutral admit
 *
 * Anti-fabrication discipline (Law 6 + Law 16):
 *   - null / malformed candidate          → return NEUTRAL_RESULT_SHELL (admit)
 *   - unknown sport                       → return NEUTRAL_RESULT_SHELL (admit)
 *   - missing canonical signals downstream → sport-specific gate returns admit (neutral fallback)
 *   - NEVER throws. NEVER returns undefined.
 *
 * Anti-sterilization invariant (PRODUCT_IDENTITY anti-sterilization guard):
 *   - When admit=false (in future Increments), the candidate is FLAGGED, not
 *     removed. Consumers MUST preserve the candidate in the source array and
 *     attach the result as metadata (typically via the canonical overlap
 *     helper's narrow-interface extension per Law 21 Invariant 3).
 *
 * Law 26 isolation (volatility ≠ fragility):
 *   - Dispatcher signature accepts NO `volatility` input. The gate never
 *     references volatility class. Texture (volatility) and structural
 *     survivability (fragility) are orthogonal dimensions.
 *
 * Law 27 isolation (class-not-identity):
 *   - Dispatcher contains no per-player references. Sport-specific predicates
 *     consume canonical class predicates over canonical signals
 *     (lineupSpot / plateAppearancesProxy / runEnvironment / hrCarryEnvironment
 *     / statFamily) — never player names.
 *
 * @param {Object} candidate - Candidate row from upstream pipeline (Candidate type from frontend/src/workstation/types.ts; backend equivalent in pipeline normalizers)
 * @param {string} sport     - Sport tag ("mlb" | "nba" | future)
 * @returns {SurvivabilityGateResult}
 */
function survivabilityGate(candidate, sport) {
  // Increment 2 shell: admit-all for every input.
  //
  // The `candidate` and `sport` parameters are part of the canonical signature
  // (verifier-asserted) but no semantic consumption fires in this shell. They
  // are declared via `void` to make the no-op explicit and prevent lint
  // warnings about unused parameters.
  void candidate
  void sport
  return NEUTRAL_RESULT_SHELL
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// Consumers call `survivabilityGate(candidate, sport)` only. The neutral
// shell constant + doctrine constant are exported for VERIFIER INSPECTION
// only — not for direct consumer use.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  survivabilityGate,
  // Exported for verifier inspection only.
  NEUTRAL_RESULT_SHELL,
  __INCREMENT_2_DOCTRINE: Object.freeze({
    phase: "CA-3d Item 0001 Increment 2",
    scope: "dispatcher-shell-only",
    behavior: "admit-all NEUTRAL for every input regardless of sport",
    typeIsolation: "SurvivabilityGateResult is a sidecar shape; never widens Candidate or FeaturedPlay (Laws 18 + 21)",
    fourAxisScaffold: ["who", "when", "survives", "marketEdge"],
    sportsSupportedNeutralAdmit: ["mlb", "nba", "any-other"],
    sportsWithSpecificPredicates: [],    // empty in Increment 2; Increment 3 adds "mlb"
    forbiddenInThisIncrement: Object.freeze([
      "qualification-semantics",
      "threshold-activation",
      "canonical-signal-consumption",
      "per-family-floor-evaluation",
      "curated-mutation",
      "battlefield-mutation",
      "Candidate-widening",
      "FeaturedPlay-widening",
      "FE-wiring",
      "buildFeaturedPlays-wiring",
      "workstationRoutes-wiring",
      "bettorLanguage-extension",
      "canonicalOverlap-interface-extension",
      "volatility-class-reference",
      "per-player-identity-reference",
    ]),
    nextIncrement: {
      "Increment 3": "Author backend/pipeline/mlb/mlbSurvivabilityGate.js with per-family threshold canonicals (HR 0.55 / TB 0.45 line-aware / Hits 0.55 line-aware / RBIs 0.50 per CA-1 Stage D.3); wire from this dispatcher when sport === 'mlb'; NO consumer wiring yet (still no curated mutation).",
    },
  }),
}
