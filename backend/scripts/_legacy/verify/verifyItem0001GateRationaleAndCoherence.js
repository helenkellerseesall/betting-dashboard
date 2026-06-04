"use strict"

/**
 * Phase CA-3d Item 0001 Increment 1-bis — verifyItem0001GateRationaleAndCoherence.js
 *
 * VOLATILITY-ISOLATION + ADMIT-RATIONALE + SCOPE-COHERENCE VERIFIER.
 *
 * Authored as Increment 1-bis supplement BEFORE Increment 3 cognition
 * activation. Closes the verifier coverage gaps identified in pre-flight
 * disposition:
 *
 *   1. Silent admit-all fallback without explicit rationale (failure mode 1)
 *   2. Scope registration without threshold-or-explicit-empty-singleton-fallback
 *      coherence (failure mode 2)
 *   3. Volatility-isolation paired-discrimination (Law 26 load-bearing test)
 *   4. Four-axis explanation scaffold integrity (Law 30)
 *
 * ASSERTION CLUSTERS (assertion-conditional logic):
 *
 *   C1 — Paired discrimination (Law 26 volatility-isolation):
 *     For each of 6 family/line combinations, synthesize (robust, fragile)
 *     candidate pairs under IDENTICAL probability/odds/volatility. Assert
 *     differential gate outcome: robust admits, fragile rejects.
 *     PRE-CONDITION mode (mlbSurvivabilityGate absent): defers C1 — dispatcher
 *     shell returns admit-all for every input including paired inputs.
 *     GATE-AWARE mode (Increment 3+ ships): full C1 enforcement.
 *
 *   C2 — Four-axis scaffold integrity (Law 30):
 *     Every gate result has exactly the keys {who, when, survives, marketEdge}
 *     in signals. No extra keys. No missing keys.
 *     Active from Increment 2 (dispatcher shell already provides scaffold).
 *
 *   C3 — Admit-rationale coherence (failure mode 1):
 *     For every gate call returning admit=true:
 *       - predicate is a non-empty non-null non-undefined string
 *       - reasonTag is non-null OR predicate is in the known-explicit-fallback
 *         set: {"shell-no-op", "neutral-fallback-*"}
 *     This prevents silent admit-all where admit=true but no rationale is
 *     documented.
 *     Active from Increment 2 (shell predicate is "shell-no-op" — explicit).
 *
 *   C4 — Rejection-explainability:
 *     For every gate call returning admit=false:
 *       - reasonTag is non-null
 *       - predicate is non-shell-no-op (rejection MUST be explained by a real
 *         predicate; the shell never rejects)
 *     PRE-CONDITION mode: defers C4 (shell never rejects).
 *     GATE-AWARE mode (Increment 3+): full C4 enforcement on fragile-fail cases.
 *
 *   C5 — Scope coherence (failure mode 2):
 *     Dispatcher source contains:
 *       (a) routing structure compatible with sport-aware dispatch
 *       (b) canonical empty-singleton-fallback constant
 *           (NEUTRAL_RESULT_SHELL with documented frozen properties)
 *     MLB gate source (when present, Increment 3+) contains explicit canonical
 *     out-of-scope fallback identifiers for:
 *       - pitcher families (Outs/Strikeouts/Walks)
 *       - under-side
 *       - minor families (Doubles/Triples/XBH/First Basket)
 *       - missing canonical signals
 *     No silent fall-through paths — every input has a named outcome.
 *
 * DRIFT-DETECTION SELF-TEST (gated by env var ITEM_0001_DRIFT_SELF_TEST=1):
 *   When invoked with this env var, runs synthetic non-compliant inputs
 *   through the assertion functions and confirms drift correctly fires.
 *   Provides mechanical proof that the verifier catches:
 *     - silent admit-all (admit=true with reasonTag=null AND
 *       predicate not in explicit-fallback set)
 *     - missing four-axis key (e.g., signals lacking 'survives')
 *     - extra four-axis key (e.g., signals carrying 'extra-key')
 *     - silent rejection (admit=false with reasonTag=null)
 *
 * Doctrine:
 *   - Verifier-only. Observation. No semantic side effects. No mutation.
 *   - Additive-only. Single new file.
 *   - Auto-discovered by runAllVerifiers.js matrix (filename verify*.js).
 *   - PRE-CONDITION mode acknowledges Increment 2 shell as compliant.
 *
 * Run via:
 *   node backend/scripts/verifyItem0001GateRationaleAndCoherence.js
 *
 * Drift-detection self-test:
 *   ITEM_0001_DRIFT_SELF_TEST=1 node backend/scripts/verifyItem0001GateRationaleAndCoherence.js
 *
 * Or via canonical ops layer:
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const dispatcherPath        = path.join(BACKEND, "pipeline", "shared", "survivabilityGate.js")
const mlbGatePath           = path.join(BACKEND, "pipeline", "mlb",    "mlbSurvivabilityGate.js")

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}

console.log("verifyItem0001GateRationaleAndCoherence — Phase CA-3d Item 0001 Increment 1-bis")
console.log("─".repeat(70))

const dispatcherExists = fs.existsSync(dispatcherPath)
const mlbGateExists    = fs.existsSync(mlbGatePath)

if (!dispatcherExists) {
  console.log(`  ℹ pre-Increment-2 mode — survivabilityGate.js absent; all clusters deferred`)
} else if (!mlbGateExists) {
  console.log(`  ℹ Increment-2 mode — dispatcher shell present; mlbSurvivabilityGate.js absent`)
  console.log(`  ℹ                    C1 (paired discrimination) + C4 (rejection-explainability) deferred to Increment 3+`)
} else {
  console.log(`  ℹ Increment-3+ mode — full gate present; all assertion clusters active`)
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION HELPER FUNCTIONS (exported for drift-detection self-test)
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_EXPLICIT_FALLBACK_PREDICATES = new Set([
  "shell-no-op",
])
function isExplicitFallbackPredicate(p) {
  if (typeof p !== "string") return false
  if (KNOWN_EXPLICIT_FALLBACK_PREDICATES.has(p)) return true
  if (p.startsWith("neutral-fallback-")) return true
  return false
}

function checkC2_FourAxisScaffold(result) {
  // C2: signals object has exactly {who, when, survives, marketEdge} keys.
  if (!result || typeof result !== "object") return { ok: false, why: "result not an object" }
  if (!result.signals || typeof result.signals !== "object") return { ok: false, why: "result.signals missing or not an object" }
  const keys = Object.keys(result.signals).sort()
  const expected = ["marketEdge", "survives", "when", "who"]
  if (keys.length !== expected.length) return { ok: false, why: `signals has ${keys.length} keys (expected 4): ${keys.join(",")}` }
  for (let i = 0; i < expected.length; i++) {
    if (keys[i] !== expected[i]) return { ok: false, why: `signals key mismatch at [${i}]: got "${keys[i]}", expected "${expected[i]}"` }
  }
  return { ok: true }
}

function checkC3_AdmitRationale(result) {
  // C3: admit=true requires non-empty predicate AND (non-null reasonTag OR explicit-fallback predicate).
  if (result.admit !== true) return { ok: true, why: "C3 applies only to admit=true" }
  if (typeof result.predicate !== "string" || result.predicate.length === 0) {
    return { ok: false, why: `admit=true with predicate=${JSON.stringify(result.predicate)} (must be non-empty string)` }
  }
  if (result.reasonTag !== null && result.reasonTag !== undefined) return { ok: true }
  if (isExplicitFallbackPredicate(result.predicate)) return { ok: true }
  return { ok: false, why: `admit=true with reasonTag=null and predicate="${result.predicate}" (must be in known-explicit-fallback set or carry non-null reasonTag)` }
}

function checkC4_RejectionExplainability(result) {
  // C4: admit=false requires non-null reasonTag AND non-shell-no-op predicate.
  if (result.admit !== false) return { ok: true, why: "C4 applies only to admit=false" }
  if (result.reasonTag === null || result.reasonTag === undefined) {
    return { ok: false, why: `admit=false with reasonTag=${JSON.stringify(result.reasonTag)} (must be non-null)` }
  }
  if (result.predicate === "shell-no-op") {
    return { ok: false, why: `admit=false with predicate="shell-no-op" (rejection must be from a real predicate, not the shell)` }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// C5 — SCOPE COHERENCE (source-text inspection; active when dispatcher ships)
// ─────────────────────────────────────────────────────────────────────────────

if (dispatcherExists) {
  const dispatcherSrc = fs.readFileSync(dispatcherPath, "utf8")

  // C5.a — dispatcher exports canonical empty-singleton-fallback constant
  assert(/NEUTRAL_RESULT_SHELL/.test(dispatcherSrc),
    "C5.a — dispatcher exports NEUTRAL_RESULT_SHELL canonical empty-singleton-fallback constant")

  // C5.b — empty-singleton is Object.freeze'd (immutable; structurally cannot drift)
  assert(/Object\.freeze\(/.test(dispatcherSrc),
    "C5.b — NEUTRAL_RESULT_SHELL or its signals scaffold uses Object.freeze (immutable singleton)")

  // C5.c — dispatcher signature includes sport parameter (sport-aware routing per Law 28)
  assert(/function\s+survivabilityGate\s*\(\s*candidate\s*,\s*sport\s*\)/.test(dispatcherSrc),
    "C5.c — dispatcher signature: survivabilityGate(candidate, sport) — sport-aware per Law 28")

  // C5.d — dispatcher returns the singleton (admit-by-neutral path canonical)
  assert(/return\s+NEUTRAL_RESULT_SHELL/.test(dispatcherSrc),
    "C5.d — dispatcher returns NEUTRAL_RESULT_SHELL as explicit empty-singleton-fallback")

  if (mlbGateExists) {
    const mlbGateSrc = fs.readFileSync(mlbGatePath, "utf8")

    // C5.e — MLB gate contains canonical out-of-scope fallback identifiers
    const outOfScopeIdentifiers = [
      "neutral-fallback-pitcher",
      "neutral-fallback-under-side",
      "neutral-fallback-minor-family",
      "neutral-fallback-missing-signals",
    ]
    for (const id of outOfScopeIdentifiers) {
      assert(new RegExp(id.replace(/-/g, "\\-")).test(mlbGateSrc),
        `C5.e — MLB gate source contains "${id}" canonical fallback identifier (no silent fall-through for out-of-scope)`)
    }

    // C5.f — dispatcher dispatches to MLB gate when sport==="mlb"
    assert(/sport\s*===\s*["']mlb["']/.test(dispatcherSrc) || /sport\s*==\s*["']mlb["']/.test(dispatcherSrc),
      "C5.f — dispatcher branches on sport === 'mlb' (post-Increment-3 routing)")
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C2/C3 LIVE ASSERTIONS (run dispatcher; check every result)
// ─────────────────────────────────────────────────────────────────────────────

if (dispatcherExists) {
  const dispatcher = require(dispatcherPath)
  const survivabilityGate = dispatcher.survivabilityGate

  // Sample inputs: cover both admit-true (Increment 2 shell) and (post-3) admit-false
  const sampleInputs = [
    { candidate: { statFamily: "Home Runs", side: "Over", line: 0.5 }, sport: "mlb" },
    { candidate: { statFamily: "Hits", side: "Over", line: 1.5 }, sport: "mlb" },
    { candidate: { statFamily: "Total Bases", side: "Over", line: 3.5 }, sport: "mlb" },
    { candidate: { statFamily: "Pitcher Outs", side: "Over" }, sport: "mlb" },
    { candidate: { statFamily: "Doubles", side: "Over" }, sport: "mlb" },
    { candidate: { statFamily: "Hits", side: "Under" }, sport: "mlb" },
    { candidate: null, sport: "mlb" },
    { candidate: { statFamily: "Home Runs", side: "Over" }, sport: "nba" },
    { candidate: { statFamily: "Home Runs", side: "Over" }, sport: "unknown-sport" },
    { candidate: undefined, sport: undefined },
  ]

  for (const { candidate, sport } of sampleInputs) {
    const result = survivabilityGate(candidate, sport)
    const labelTag = `sport=${sport}, fam=${candidate && candidate.statFamily}, side=${candidate && candidate.side}`

    // C2 — four-axis scaffold integrity
    const c2 = checkC2_FourAxisScaffold(result)
    assert(c2.ok, `C2 — four-axis scaffold integrity (${labelTag}) ${c2.ok ? "" : "- " + c2.why}`)

    // C3 — admit-rationale coherence (active for admit=true)
    const c3 = checkC3_AdmitRationale(result)
    assert(c3.ok, `C3 — admit-rationale coherence (${labelTag}) ${c3.ok ? "" : "- " + c3.why}`)

    // C4 — rejection-explainability (active for admit=false; shell never rejects)
    const c4 = checkC4_RejectionExplainability(result)
    assert(c4.ok, `C4 — rejection-explainability (${labelTag}) ${c4.ok ? "" : "- " + c4.why}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C1 — PAIRED DISCRIMINATION (Law 26 volatility-isolation)
// Active only when mlbSurvivabilityGate is present (Increment 3+).
// In Increment 2 shell, the dispatcher returns admit-all for every input;
// paired discrimination cannot fire — defer.
// ─────────────────────────────────────────────────────────────────────────────

if (dispatcherExists && mlbGateExists) {
  const dispatcher = require(dispatcherPath)
  const survivabilityGate = dispatcher.survivabilityGate

  // Six family/line combinations × {robust, fragile} candidate pairs
  const SHARED_PROB = { modelProb: 0.20, odds: 700, volatility: "lotto" }
  function makeCandidate(family, line, role) {
    const c = {
      statFamily: family,
      line: line,
      side: "Over",
      lineupSpot:            role === "robust" ? 2     : 8,
      plateAppearancesProxy: role === "robust" ? 4.5   : 2.5,
      runEnvironment:        role === "robust" ? 0.65  : 0.30,
      ...SHARED_PROB,
    }
    if (role === "robust") {
      c.hrEnvironmentTag = "HR_FRIENDLY"
      c.windDirectionTag = "wind-out"
      c.carryShift       = 0.04
      c.temperatureF     = 80
    } else {
      c.hrEnvironmentTag = "HR_SUPPRESSING"
      c.windDirectionTag = "wind-in"
      c.carryShift       = -0.02
      c.temperatureF     = 65
    }
    return c
  }

  const PAIRS = [
    { family: "Home Runs",   line: 0.5 },
    { family: "Total Bases", line: 2.5 },
    { family: "Total Bases", line: 3.5 },
    { family: "Hits",        line: 1.5 },
    { family: "Hits",        line: 2.5 },
    { family: "RBIs",        line: 0.5 },
  ]

  for (const p of PAIRS) {
    const robust  = makeCandidate(p.family, p.line, "robust")
    const fragile = makeCandidate(p.family, p.line, "fragile")
    const rResult = survivabilityGate(robust,  "mlb")
    const fResult = survivabilityGate(fragile, "mlb")

    assert(rResult.admit === true,
      `C1 — ${p.family} ${p.line}: ROBUST candidate admits (modelProb=${SHARED_PROB.modelProb}, odds=+${SHARED_PROB.odds}, lineupSpot=2, paProxy=4.5, runEnv=0.65, favorable env)`)
    assert(fResult.admit === false,
      `C1 — ${p.family} ${p.line}: FRAGILE candidate rejects (same probability/odds/volatility; lineupSpot=8, paProxy=2.5, runEnv=0.30, dead env) — proves Law 26 volatility-isolation`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIFT-DETECTION SELF-TEST (gated by env var)
// Mechanical proof that the verifier's assertion functions fire on synthetic
// non-compliant inputs. Provides observable drift-detection sensitivity.
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.ITEM_0001_DRIFT_SELF_TEST === "1") {
  console.log("")
  console.log("─".repeat(70))
  console.log("DRIFT-DETECTION SELF-TEST (verifier-firing-on-drift proof)")
  console.log("─".repeat(70))

  const DRIFT_CASES = [
    {
      label: "SILENT ADMIT-ALL — admit=true with reasonTag=null and predicate not in known-explicit-fallback set",
      input: { admit: true, predicate: "made-up-undocumented-predicate", signals: { who: null, when: null, survives: null, marketEdge: null }, reasonTag: null, phrase: null },
      fn:    "checkC3_AdmitRationale",
      check: (input) => checkC3_AdmitRationale(input),
      expectDetected: true,
    },
    {
      label: "SILENT ADMIT-ALL — admit=true with predicate=undefined",
      input: { admit: true, predicate: undefined, signals: { who: null, when: null, survives: null, marketEdge: null }, reasonTag: null, phrase: null },
      fn:    "checkC3_AdmitRationale",
      check: (input) => checkC3_AdmitRationale(input),
      expectDetected: true,
    },
    {
      label: "MISSING four-axis key — signals lacks 'survives'",
      input: { admit: true, predicate: "shell-no-op", signals: { who: null, when: null, marketEdge: null }, reasonTag: null, phrase: null },
      fn:    "checkC2_FourAxisScaffold",
      check: (input) => checkC2_FourAxisScaffold(input),
      expectDetected: true,
    },
    {
      label: "EXTRA four-axis key — signals carries 'unknown-extra'",
      input: { admit: true, predicate: "shell-no-op", signals: { who: null, when: null, survives: null, marketEdge: null, "unknown-extra": null }, reasonTag: null, phrase: null },
      fn:    "checkC2_FourAxisScaffold",
      check: (input) => checkC2_FourAxisScaffold(input),
      expectDetected: true,
    },
    {
      label: "SILENT REJECTION — admit=false with reasonTag=null",
      input: { admit: false, predicate: "mlb-hr-fragile", signals: { who: null, when: null, survives: null, marketEdge: null }, reasonTag: null, phrase: null },
      fn:    "checkC4_RejectionExplainability",
      check: (input) => checkC4_RejectionExplainability(input),
      expectDetected: true,
    },
    {
      label: "SHELL REJECTING — admit=false with predicate='shell-no-op' (shell never rejects; if it does, regression)",
      input: { admit: false, predicate: "shell-no-op", signals: { who: null, when: null, survives: null, marketEdge: null }, reasonTag: "some-tag", phrase: null },
      fn:    "checkC4_RejectionExplainability",
      check: (input) => checkC4_RejectionExplainability(input),
      expectDetected: true,
    },
    {
      label: "COMPLIANT shell — admit=true, predicate='shell-no-op', null reasonTag (Increment 2 expected)",
      input: { admit: true, predicate: "shell-no-op", signals: { who: null, when: null, survives: null, marketEdge: null }, reasonTag: null, phrase: null },
      fn:    "checkC3_AdmitRationale",
      check: (input) => checkC3_AdmitRationale(input),
      expectDetected: false,
    },
    {
      label: "COMPLIANT neutral-fallback — admit=true, predicate='neutral-fallback-pitcher', null reasonTag (post-Increment-3 expected)",
      input: { admit: true, predicate: "neutral-fallback-pitcher", signals: { who: null, when: null, survives: null, marketEdge: null }, reasonTag: null, phrase: null },
      fn:    "checkC3_AdmitRationale",
      check: (input) => checkC3_AdmitRationale(input),
      expectDetected: false,
    },
  ]

  let driftSelfTestPass = 0
  let driftSelfTestFail = 0
  for (const c of DRIFT_CASES) {
    const r = c.check(c.input)
    const detected = !r.ok
    const matchExpected = detected === c.expectDetected
    const marker = matchExpected ? "✅" : "❌"
    const expectedTxt = c.expectDetected ? "drift-detected" : "compliant"
    const actualTxt   = detected         ? "drift-detected" : "compliant"
    console.log(`  ${marker} [${c.fn}] ${c.label}`)
    console.log(`      expected: ${expectedTxt} · actual: ${actualTxt}${r.why ? " · why: " + r.why : ""}`)
    if (matchExpected) driftSelfTestPass++; else driftSelfTestFail++
  }
  console.log("─".repeat(70))
  console.log(`Drift-detection self-test: ${driftSelfTestPass} / ${DRIFT_CASES.length} cases correctly classified`)
  if (driftSelfTestFail > 0) {
    console.log("❌ DRIFT-DETECTION SELF-TEST FAILED — verifier's assertion logic may have a hole")
    process.exit(2)
  }
  console.log("✅ DRIFT-DETECTION SELF-TEST PASSED — verifier's assertion logic correctly fires on each drift class")
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
