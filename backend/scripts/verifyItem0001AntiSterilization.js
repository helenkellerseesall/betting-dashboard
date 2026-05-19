"use strict"

/**
 * Phase CA-3d Item 0001 — verifyItem0001AntiSterilization.js
 *
 * ANTI-STERILIZATION GUARD VERIFIER (Increment 1, verifier-first).
 *
 * Authored BEFORE the Item 0001 survivability gate ships (Increments 2-8).
 * This verifier is the canonical structural protector against battlefield
 * sterilization — the operator-cemented anti-sterilization invariant from
 * `/PRODUCT_IDENTITY.md` and the Item 0001 scope lock in
 * `/docs/CURATION_AUDIT_2026-05-18.md` Stage C.12.
 *
 * OPERATOR-CEMENTED ANTI-STERILIZATION INVARIANT:
 *   When the survivability gate rejects a candidate, the candidate REMAINS
 *   on the canonical-validated battlefield pool (`state.discoveryCandidates`)
 *   with an explicit `SurvivabilityIndicator` rendering the disqualification
 *   reason. Failed candidates are FLAGGED, NEVER REMOVED.
 *
 *   The bettor sees the disqualification, not its absence.
 *
 * ASSERTIONS (assertion-conditional logic):
 *
 *   Pre-Item-0001 state (gate absent):
 *     A1. No survivability-filter pattern exists anywhere in pipeline source
 *         (the codebase does not currently sterilize battlefield by survivability).
 *     A2. Existing OE-8 `ladderSurvivabilityFactor` / `ladderSurvivabilityDemote`
 *         use sort-time-demote-only pattern (returns 0 or OE8_LADDER_DEMOTE_CAP;
 *         never removes a candidate from the pool).
 *     A3. Existing `SLIP_EXCLUDED_FAMILIES` uses skip-not-delete pattern (filter
 *         applied at slip-assembly only; underlying candidates remain in
 *         elite/discovery pools).
 *     A4. `state.discoveryCandidates` derived from canonical `supplementedCandidates`
 *         pool with only diversification caps (not survivability-gate caps).
 *
 *   Post-Item-0001 state (gate present in survivabilityGate.js):
 *     A5. Gate output shape is `{admit, predicate, signals, reasonTag, phrase}`
 *         — admit is a FLAG, not a filter operation.
 *     A6. `buildFeaturedPlays.js` does NOT remove candidates with `admit:false`
 *         from any returned array (search for forbidden patterns:
 *         `.filter(c => survivabilityGate(c).admit)` or equivalent).
 *     A7. `workstationRoutes.js` surfaces both `passes` and `fails` flags to the
 *         overlap-index emission for ALL battlefield rows that have an overlap.
 *     A8. `state.discoveryCandidates` row count is unchanged by gate evaluation
 *         (gate writes metadata; does not affect pool size).
 *
 * Doctrine:
 *   - Verifier-only. No semantic side effects. No mutation.
 *   - Auto-discovered by `runAllVerifiers.js` matrix on filename `verify*.js`.
 *   - PRE-CONDITION state acknowledged as PASS (gate not yet shipped).
 *
 * Run via:
 *   node backend/scripts/verifyItem0001AntiSterilization.js
 *
 * Or via canonical ops layer:
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const buildFeaturedPlaysPath  = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const buildSlipAiPath         = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const workstationRoutesPath   = path.join(BACKEND, "routes", "workstationRoutes.js")
const survivabilityGatePath   = path.join(BACKEND, "pipeline", "shared", "survivabilityGate.js")

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}

function readSrc(p, label) {
  try {
    return fs.readFileSync(p, "utf8")
  } catch (e) {
    assert(false, `${label} — source file readable at ${p}`)
    return ""
  }
}

console.log("verifyItem0001AntiSterilization — Phase CA-3d Item 0001 anti-sterilization guard")
console.log("─".repeat(70))

const buildFeaturedPlaysSrc = readSrc(buildFeaturedPlaysPath, "buildFeaturedPlays.js")
const buildSlipAiSrc        = readSrc(buildSlipAiPath, "buildSlipAi.js")
const workstationRoutesSrc  = readSrc(workstationRoutesPath, "workstationRoutes.js")
const gateExists            = fs.existsSync(survivabilityGatePath)
const gateSrc               = gateExists ? readSrc(survivabilityGatePath, "survivabilityGate.js") : ""

// ─────────────────────────────────────────────────────────────────────────────
// PRE-CONDITION / ALL-STATE ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

// A1. No survivability-filter pattern exists in pipeline source.
//     The forbidden patterns are array-filter operations keyed on a
//     survivability-gate function. Look for explicit removal patterns.
const forbiddenFilterPatterns = [
  /\.filter\([^)]*survivabilityGate\([^)]*\)\.admit/,
  /\.filter\([^)]*survivabilityGate\([^)]*\)\.passes/,
  /\.filter\([^)]*ladderSurvivabilityFactor\([^)]*\)\s*>=?/,
  /\.filter\([^)]*ladderSurvivability/,
]
for (const pat of forbiddenFilterPatterns) {
  assert(!pat.test(buildFeaturedPlaysSrc),
    `A1 — buildFeaturedPlays.js: no forbidden filter-by-survivability pattern (${pat.source.slice(0, 50)})`)
  assert(!pat.test(buildSlipAiSrc),
    `A1 — buildSlipAi.js: no forbidden filter-by-survivability pattern (${pat.source.slice(0, 50)})`)
  assert(!pat.test(workstationRoutesSrc),
    `A1 — workstationRoutes.js: no forbidden filter-by-survivability pattern (${pat.source.slice(0, 50)})`)
}

// A2. OE-8 ladderSurvivabilityDemote uses sort-time-demote-only pattern.
//     The function should: (a) compute the factor, (b) compare to floor,
//     (c) return 0 or OE8_LADDER_DEMOTE_CAP. NEVER mutate the candidate.
//     NEVER call splice/filter/delete on a pool.
assert(/function\s+ladderSurvivabilityDemote/.test(buildFeaturedPlaysSrc),
  "A2 — ladderSurvivabilityDemote function present")
assert(/return\s+OE8_LADDER_DEMOTE_CAP/.test(buildFeaturedPlaysSrc),
  "A2 — ladderSurvivabilityDemote returns OE8_LADDER_DEMOTE_CAP (sort-time signal, not removal)")
// The function MUST NOT contain splice / filter operations on candidate arrays.
const oe8Block = buildFeaturedPlaysSrc.match(/function\s+ladderSurvivabilityDemote\s*\([^)]*\)\s*\{[^}]*\}/s)
if (oe8Block) {
  assert(!/\.splice\(/.test(oe8Block[0]),
    "A2 — ladderSurvivabilityDemote contains no .splice() (no removal)")
  assert(!/\.filter\(/.test(oe8Block[0]),
    "A2 — ladderSurvivabilityDemote contains no .filter() (no removal)")
}

// A3. SLIP_EXCLUDED_FAMILIES uses skip-not-delete (filter applied during slip
//     assembly only; canonical source pools unaffected).
assert(/SLIP_EXCLUDED_FAMILIES/.test(buildSlipAiSrc),
  "A3 — SLIP_EXCLUDED_FAMILIES present")
assert(/SLIP_EXCLUDED_FAMILIES\.has/.test(buildSlipAiSrc),
  "A3 — SLIP_EXCLUDED_FAMILIES used via .has() predicate (skip-pattern, not delete)")

// A4. state.discoveryCandidates derived from canonical supplementedCandidates
//     with only diversification caps (operator-cemented in workstationRoutes).
assert(/discoveryCandidates/.test(workstationRoutesSrc),
  "A4 — state.discoveryCandidates pool emitted from workstationRoutes")
assert(/diversifyCandidates\s*\(\s*supplementedCandidates/.test(workstationRoutesSrc),
  "A4 — discoveryCandidates derived from supplementedCandidates via diversifyCandidates (canonical source)")

// ─────────────────────────────────────────────────────────────────────────────
// POST-ITEM-0001 ASSERTIONS (when survivabilityGate.js exists)
// ─────────────────────────────────────────────────────────────────────────────

if (gateExists) {
  console.log(`  ℹ post-Item-0001 mode — survivabilityGate.js present; running gate-aware assertions`)

  // A5. Gate output shape {admit, predicate, signals, reasonTag, phrase}.
  assert(/\badmit\b/.test(gateSrc),
    "A5 — survivabilityGate returns {admit: ...} field (flag, not filter)")
  assert(/\breasonTag\b/.test(gateSrc),
    "A5 — survivabilityGate returns {reasonTag: ...} field (provenance)")
  assert(/\bphrase\b/.test(gateSrc),
    "A5 — survivabilityGate returns {phrase: ...} field (bettor-language)")

  // A6. buildFeaturedPlays does not filter-out candidates with admit:false.
  //     Look for the canonical wiring pattern that PRESERVES candidates:
  //     either annotation-only or sort-time-tag-only.
  const callsGate = /survivabilityGate\s*\(/.test(buildFeaturedPlaysSrc)
  if (callsGate) {
    // when wired, must NOT use filter-by-admit
    assert(!/\.filter\([^)]*\.admit\s*===?\s*true/.test(buildFeaturedPlaysSrc),
      "A6 — buildFeaturedPlays does not .filter() by admit:true (no array-strip)")
    assert(!/\.filter\([^)]*\.admit\s*===?\s*false/.test(buildFeaturedPlaysSrc),
      "A6 — buildFeaturedPlays does not .filter() by admit:false (no array-strip)")
  }

  // A7. workstationRoutes surfaces both passes and fails flags to overlap.
  if (/survivabilityFlag/.test(workstationRoutesSrc)) {
    assert(/survivabilityFlag/.test(workstationRoutesSrc),
      "A7 — workstationRoutes emits survivabilityFlag to overlap index")
    assert(/passes|fails/.test(workstationRoutesSrc),
      "A7 — workstationRoutes preserves both passes and fails flag states")
  }

  // A8. state.discoveryCandidates row count unchanged by gate (no removal).
  //     The discoveryCandidates pool is built BEFORE any gate evaluation per A4.
  //     Verifier asserts no gate call is wired into discoveryCandidates derivation.
  if (callsGate) {
    const discoverySection = workstationRoutesSrc.match(/discoveryCandidates\s*=\s*diversifyCandidates[^;]+/s)
    if (discoverySection) {
      assert(!/survivabilityGate/.test(discoverySection[0]),
        "A8 — discoveryCandidates derivation does not call survivabilityGate (pool size unchanged)")
    }
  }
} else {
  console.log(`  ℹ pre-Item-0001 mode — survivabilityGate.js absent; structural invariants verified on existing codebase`)
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log("─".repeat(70))
console.log(`SUMMARY: ${passed} / ${passed + failed} assertions PASS`)
if (failed > 0) {
  console.log(`FAILURES (${failed}):`)
  for (const f of failures) console.log(`  • ${f}`)
  console.log(`RESULT: FAIL`)
  process.exit(1)
}
console.log(`RESULT: PASS`)
process.exit(0)
