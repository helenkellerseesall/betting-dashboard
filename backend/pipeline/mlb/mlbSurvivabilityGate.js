"use strict"

/**
 * Phase CA-3d Item 0001 Increment 3 — mlbSurvivabilityGate.js
 *
 * SHAPE γ HARD-GATE: MLB SPORT-SPECIFIC SURVIVABILITY PREDICATE.
 *
 * Dispatched from `backend/pipeline/shared/survivabilityGate.js` when
 * `sport === "mlb"`. Distinguishes structurally-robust volatility from
 * structurally-fragile volatility under identical probability conditions
 * (Law 26 — volatility ≠ fragility).
 *
 * Operator-approved per-family floor canonicals (CA-1 audit Stage D.3):
 *   - HR Over (any line):       floor 0.55
 *   - TB Over line < 3.5:       floor 0.45
 *   - TB Over line >= 3.5:      floor 0.40
 *   - Hits Over line < 2.5:     floor 0.55
 *   - Hits Over line >= 2.5:    floor 0.45
 *   - RBIs Over (any line):     floor 0.50
 *
 * Out-of-scope families (Increment 3 scope; deferred to subsequent items):
 *   - Pitcher Outs / Strikeouts / Walks  → admit by `neutral-fallback-pitcher`
 *   - Under-side                         → admit by `neutral-fallback-under-side`
 *   - Doubles / Triples / XBH / First Basket → admit by `neutral-fallback-minor-family`
 *   - Missing canonical signals          → admit by `neutral-fallback-missing-signals`
 *
 * Anti-fabrication discipline (Laws 6 / 16):
 *   - Null candidate / malformed → admit by neutral fallback
 *   - Missing structural signals → admit by neutral fallback (NEVER reject for absence)
 *   - NEVER throws. NEVER returns undefined.
 *
 * Law 27 isolation (class-not-identity):
 *   - No per-player references in this module
 *   - Predicates derive entirely from canonical structural signals
 *
 * Law 30 four-axis explanation schema:
 *   - This gate populates the `signals.survives` axis only
 *   - `signals.who` / `signals.when` / `signals.marketEdge` remain null
 *     (populated by future role / flow / market gates as subsequent CA-3d items ship)
 *
 * Verifier coverage (Increment 1 + 1-bis):
 *   - verifyItem0001AntiSterilization.js asserts no filter-by-survivability pattern
 *   - verifyItem0001PropFamilyScope.js asserts per-family threshold constants
 *   - verifyItem0001GateRationaleAndCoherence.js asserts:
 *       C1 paired discrimination under identical probability
 *       C2 four-axis scaffold integrity
 *       C3 admit-rationale coherence (admit-true requires explicit rationale)
 *       C4 rejection-explainability
 *       C5 source-text canonical fallback identifiers
 */

const path = require("path")

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL THRESHOLD CONSTANTS (operator-approved; per Law 29 family-aware)
// ─────────────────────────────────────────────────────────────────────────────

const OE8_SURVIVABILITY_FLOOR_HR        = 0.55
const OE8_SURVIVABILITY_FLOOR_TB_LOW    = 0.45
const OE8_SURVIVABILITY_FLOOR_TB_HIGH   = 0.40
const OE8_SURVIVABILITY_FLOOR_HITS_LOW  = 0.55
const OE8_SURVIVABILITY_FLOOR_HITS_HIGH = 0.45
const OE8_SURVIVABILITY_FLOOR_RBIS      = 0.50

const TB_HIGH_LINE_THRESHOLD    = 3.5
const HITS_HIGH_LINE_THRESHOLD  = 2.5

// OE-8 formula constants (mirrored from backend/pipeline/shared/buildFeaturedPlays.js
// canonical lines 457-459; not re-imported because the gate must remain
// self-contained per Law 28 sport-specific implementation pattern).
const OE3_HR_BOOST_CAP        = 0.03
const OE8_NEUTRAL_PA_PROXY    = 4.2

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(lo, hi, x) {
  return Math.max(lo, Math.min(hi, Number(x)))
}

function normFam(v) {
  return String(v || "").toLowerCase().replace(/[\s_]+/g, "")
}

function normSide(v) {
  return String(v || "").toLowerCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY CLASSIFICATION (Law 29 + Law 28 family-aware dispatch)
// ─────────────────────────────────────────────────────────────────────────────

const IN_SCOPE_FAMILIES = ["homeruns", "homerun", "hr", "totalbases", "hits", "rbis"]
const PITCHER_FAMILIES   = ["pitcherouts", "strikeouts", "pitcherk", "pitcherks", "walks", "outs"]
const MINOR_FAMILIES     = ["doubles", "triples", "extrabasehits", "xbh", "firstbasket"]

function classifyFamily(statFamily) {
  const f = normFam(statFamily)
  if (PITCHER_FAMILIES.some((p) => f.includes(p))) return "pitcher"
  if (MINOR_FAMILIES.some((m) => f.includes(m)))   return "minor"
  if (IN_SCOPE_FAMILIES.some((s) => f.includes(s))) return "in-scope"
  return "unknown"
}

function familyFloor(statFamily, line) {
  const f = normFam(statFamily)
  const ln = num(line)
  if (f.includes("homerun") || f === "hr" || f === "homeruns") return OE8_SURVIVABILITY_FLOOR_HR
  if (f.includes("totalbase")) {
    return (ln != null && ln >= TB_HIGH_LINE_THRESHOLD) ? OE8_SURVIVABILITY_FLOOR_TB_HIGH : OE8_SURVIVABILITY_FLOOR_TB_LOW
  }
  if (f.includes("hits")) {
    return (ln != null && ln >= HITS_HIGH_LINE_THRESHOLD) ? OE8_SURVIVABILITY_FLOOR_HITS_HIGH : OE8_SURVIVABILITY_FLOOR_HITS_LOW
  }
  if (f.includes("rbis")) return OE8_SURVIVABILITY_FLOOR_RBIS
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SURVIVABILITY FACTOR FORMULA (canonical OE-8 mirror)
// Anti-fabrication: missing signals → neutral 1.0 component
// ─────────────────────────────────────────────────────────────────────────────

function hrCarryBoost(candidate) {
  // Returns 0 to OE3_HR_BOOST_CAP based on canonical env predicates.
  // Mirrors buildFeaturedPlays.hrCarryEnvironment gating logic.
  if (candidate.hrEnvironmentTag === "HR_FRIENDLY"
      && candidate.windDirectionTag === "wind-out"
      && (candidate.carryShift || 0) > 0
      && (candidate.temperatureF || 0) >= 75) {
    return OE3_HR_BOOST_CAP
  }
  return 0
}

function survivabilityFactor(candidate) {
  if (!candidate) return 1.00
  const line = num(candidate.line)
  const ladderHeightFactor = (line != null && line >= 1.5)
    ? clamp(0, 1.5, 1 / (1 + (line - 1.5) * 0.3))
    : 1.00
  const paProxy = num(candidate.plateAppearancesProxy)
  const paFactor = paProxy != null
    ? clamp(0.5, 1.5, paProxy / OE8_NEUTRAL_PA_PROXY)
    : 1.00
  const runEnv = num(candidate.runEnvironment)
  const runEnvFactor = runEnv != null ? clamp(0, 1.0, runEnv) + 0.5 : 1.00
  const fam = normFam(candidate.statFamily)
  const isHrOrTb = /home.?run|^hr$|homeruns|totalbase/.test(fam)
  let hrCarryFactor = 1.00
  if (isHrOrTb) {
    const hrBoost = hrCarryBoost(candidate)
    hrCarryFactor = 1.0 + (hrBoost / OE3_HR_BOOST_CAP) * 0.2
  }
  return clamp(0, 2, ladderHeightFactor * paFactor * runEnvFactor * hrCarryFactor)
}

function hasStructuralSignals(candidate) {
  // The gate requires at least ONE canonical structural signal to compute
  // a meaningful factor. Missing all signals → degrade to neutral-fallback.
  if (!candidate) return false
  return num(candidate.plateAppearancesProxy) != null
      || num(candidate.runEnvironment) != null
      || num(candidate.lineupSpot) != null
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL RESULT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function makeResult({ admit, predicate, reasonTag, phrase, survivesAxis }) {
  return {
    admit,
    predicate,
    signals: {
      who:        null,
      when:       null,
      survives:   survivesAxis,
      marketEdge: null,
    },
    reasonTag,
    phrase,
  }
}

function neutralFallback(reason) {
  return makeResult({
    admit: true,
    predicate: `neutral-fallback-${reason}`,
    reasonTag: null,
    phrase: null,
    survivesAxis: null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE PREDICATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mlbSurvivabilityGate(candidate)
 *
 * Returns a SurvivabilityGateResult per the dispatcher contract in
 * `backend/pipeline/shared/survivabilityGate.js`. Hitter-overs-only scope
 * (PCE-1A scope inherited); pitcher / under / minor / NBA families bypass
 * via neutral-fallback predicates.
 */
function mlbSurvivabilityGate(candidate) {
  // Anti-fabrication: null / malformed candidate admits by neutral fallback
  if (!candidate || typeof candidate !== "object") {
    return neutralFallback("missing-signals")
  }

  // Under-side bypasses (Law 26 + PCE-1A hitter-overs scope)
  if (normSide(candidate.side) !== "over") {
    return neutralFallback("under-side")
  }

  // Family classification
  const familyClass = classifyFamily(candidate.statFamily)
  if (familyClass === "pitcher") return neutralFallback("pitcher")
  if (familyClass === "minor")   return neutralFallback("minor-family")
  if (familyClass === "unknown") return neutralFallback("missing-signals")

  // Missing structural signals → neutral fallback (anti-fabrication; never reject for absence)
  if (!hasStructuralSignals(candidate)) {
    return neutralFallback("missing-signals")
  }

  // Compute survivability factor + per-family floor (Law 29)
  const factor = survivabilityFactor(candidate)
  const floor  = familyFloor(candidate.statFamily, candidate.line)
  if (floor == null) {
    return neutralFallback("missing-signals")  // belt-and-suspenders
  }

  const fam  = normFam(candidate.statFamily)
  const famDisplay = (
    fam.includes("homerun") || fam === "hr" ? "HR" :
    fam.includes("totalbase") ? "TB" :
    fam.includes("hits") ? "HITS" :
    fam.includes("rbis") ? "RBIS" :
    "OTHER"
  )

  if (factor >= floor) {
    // Robust admit — explicit predicate identifier + canonical reasonTag
    return makeResult({
      admit: true,
      predicate: `mlb-${famDisplay.toLowerCase()}-robust`,
      reasonTag: `MLB_SURV_ROBUST_${famDisplay}`,
      phrase:    null,  // Increment 4 wires SURVIVABILITY_PHRASES — null here is rationale-coherent (non-default predicate)
      survivesAxis: { factor: Math.round(factor * 10000) / 10000, floor, family: famDisplay, classification: "robust" },
    })
  }

  // Fragile reject — explicit predicate + reasonTag
  return makeResult({
    admit: false,
    predicate: `mlb-${famDisplay.toLowerCase()}-fragile`,
    reasonTag: `MLB_SURV_FRAGILE_${famDisplay}`,
    phrase:    null,  // Increment 4 wires SURVIVABILITY_PHRASES
    survivesAxis: { factor: Math.round(factor * 10000) / 10000, floor, family: famDisplay, classification: "fragile" },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  mlbSurvivabilityGate,

  // Canonical threshold constants (verifier-asserted)
  OE8_SURVIVABILITY_FLOOR_HR,
  OE8_SURVIVABILITY_FLOOR_TB_LOW,
  OE8_SURVIVABILITY_FLOOR_TB_HIGH,
  OE8_SURVIVABILITY_FLOOR_HITS_LOW,
  OE8_SURVIVABILITY_FLOOR_HITS_HIGH,
  OE8_SURVIVABILITY_FLOOR_RBIS,

  // Helpers exported for unit testing / verifier introspection
  survivabilityFactor,
  classifyFamily,
  familyFloor,
}
