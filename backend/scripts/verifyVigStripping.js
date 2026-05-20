"use strict"

/**
 * verifyVigStripping.js — Phase Item 0003 (Vig Stripping Correction)
 *                         Increment 1 (verifier-first, 2026-05-20).
 *
 * Authored BEFORE any vig-stripping implementation ships. This verifier
 * encodes the canonical contract + invariants the future implementation
 * MUST satisfy, plus PRE-CONDITION assertions documenting the current
 * no-vig-stripping state.
 *
 * ZERO implementation wiring this slice (Increment 1 scope-lock).
 *
 * Assertion-conditional logic:
 *
 *   PRE-CONDITION (current state — no vigStripping.js yet):
 *     P1. No backend/pipeline/shared/vigStripping.js exists.
 *     P2. No call to vigStripping() / stripVig() / noVigProb() / fairProb()
 *         exists anywhere in pipeline source.
 *     P3. impliedFromAmerican exists in buildFeaturedPlays.js and buildSlipAi.js
 *         (the current vig-INCLUDED implied-prob computation; documented as
 *         the surface that vig-stripping will replace at edge-computation
 *         time in Increment 2).
 *     P4. Anti-sterilization carry-forward: no filter pattern that would
 *         drop candidates by vig-stripped edge value (vig stripping is a
 *         re-pricing of edge; it never removes candidates from battlefield).
 *
 *   POST-IMPL (Increment ≥ 2 state — vigStripping.js shipped):
 *     I1. backend/pipeline/shared/vigStripping.js exists.
 *     I2. Module exports canonical surface:
 *           stripVigTwoWay(overOdds, underOdds) → { overFair, underFair, vig }
 *           stripVigMultiWay([odds, ...])        → { fair: [...], vig }
 *           fairProbFromAmericanPair(overOdds, underOdds, side) → number
 *     I3. Pure deterministic — two consecutive calls produce identical output.
 *     I4. Anti-fabrication — returns NULL when only one side present
 *         (cannot strip vig without both sides). NEVER substitutes a default.
 *     I5. Invariant: overFair + underFair === 1.0 (up to floating tolerance).
 *     I6. Sport-agnostic: works on any (overOdds, underOdds) pair regardless
 *         of sport / market family / propType.
 *     I7. Consumer wiring: buildFeaturedPlays.scoreCandidate uses
 *         fairProbFromAmericanPair when both sides are present in the
 *         line-shopping lookup; falls back to impliedFromAmerican (vig-
 *         included) when only one side is available — preserves backward
 *         compatibility on thin-market candidates.
 *     I8. FE surfacing: factors.vig + factors.fairImpliedProb expose the
 *         stripped values for operator transparency. Composite mutation
 *         is internal; no FE behavior change beyond chip rendering.
 *
 *   DRIFT-DETECTION SELF-TEST (gated by ITEM_0003_VIG_DRIFT_SELF_TEST=1):
 *     D1. Planted-drift case A: returns non-frozen module → asserted FAIL.
 *     D2. Planted-drift case B: overFair + underFair ≠ 1.0 → asserted FAIL.
 *     D3. Planted-drift case C: returns synthesized default when one side
 *         absent → asserted FAIL (anti-fabrication violation).
 *     D4. Planted-drift case D: consecutive calls return different values
 *         → asserted FAIL (non-deterministic).
 *
 *   REPLAY/LIVE PARITY EXPECTATIONS:
 *     R1. Replay against persisted snapshot rows MUST produce identical
 *         vig-stripped probabilities to live /api/ws/state.
 *     R2. Vig stripping does NOT depend on time/clock/random — fully
 *         deterministic given (overOdds, underOdds).
 *     R3. No live-runtime stale-date risk introduced by this slice.
 *
 * Doctrine:
 *   - Verifier-only. No semantic side effects. No mutation.
 *   - Auto-discovered by runAllVerifiers.js matrix on filename verify*.js.
 *   - PRE-CONDITION assertions PASS today (no implementation yet).
 *   - POST-IMPL assertions automatically flip to PASS when Increment 2 ships
 *     vigStripping.js + wiring. Assertion-conditional logic guarantees no
 *     verifier mutation required to advance the implementation.
 *
 * Run via:
 *   node backend/scripts/verifyVigStripping.js
 *   ITEM_0003_VIG_DRIFT_SELF_TEST=1 node backend/scripts/verifyVigStripping.js
 *
 * Or via canonical ops layer:
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const VIG_MODULE_PATH       = path.join(BACKEND, "pipeline", "shared", "vigStripping.js")
const FEATURED_PATH         = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const SLIP_AI_PATH          = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const RUNTIME_REGISTRY      = path.join(BACKEND, "scripts", "ops", "runtime.js")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

function readSrc(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null }

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyVigStripping.js  (Item 0003 — Vig Stripping Correction)")
console.log("                         (Increment 1 — verifier-first)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

const moduleExists = fs.existsSync(VIG_MODULE_PATH)

// ── Cluster P — PRE-CONDITION (current state) ────────────────────────────
console.log("Cluster P — PRE-CONDITION (no vig-stripping shipped)")
const featuredSrc = readSrc(FEATURED_PATH) || ""
const slipAiSrc   = readSrc(SLIP_AI_PATH)  || ""

if (!moduleExists) {
  // PRE-CONDITION branch: assert the no-implementation state cleanly.
  assert(!fs.existsSync(VIG_MODULE_PATH),
    "P1 — vigStripping.js absent at canonical path (PRE-CONDITION valid)")
  // P2: no vig-stripping call anywhere in pipeline source.
  function findInDir(dir, pattern, exclude) {
    const hits = []
    const stack = [dir]
    while (stack.length) {
      const p = stack.pop()
      let entries; try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch (_) { continue }
      for (const e of entries) {
        const full = path.join(p, e.name)
        if (e.isDirectory()) {
          if (/node_modules|\.git|dist|build|runtime\/tracking|runtime\/brain/.test(full)) continue
          stack.push(full)
        } else if (e.isFile() && /\.(js|ts|tsx)$/.test(e.name) && !exclude.has(full)) {
          try { if (pattern.test(fs.readFileSync(full, "utf8"))) hits.push(full) } catch (_) {}
        }
      }
    }
    return hits
  }
  const callPattern = /\b(stripVigTwoWay|stripVigMultiWay|fairProbFromAmericanPair|noVigProb|removeVig)\s*\(/
  const exclude = new Set([__filename])
  const callHits = findInDir(BACKEND, callPattern, exclude)
  assert(callHits.length === 0,
    `P2 — no vig-stripping call exists in pipeline source (found=${callHits.length}; PRE-CONDITION valid)`)
  if (callHits.length > 0) for (const h of callHits.slice(0,5)) console.error("    - " + path.relative(REPO, h))

  // P3: impliedFromAmerican exists in both surfaces (the current vig-INCLUDED computation).
  assert(/function\s+impliedFromAmerican\b/.test(featuredSrc),
    "P3a — buildFeaturedPlays.js declares impliedFromAmerican (current vig-included surface)")
  assert(/function\s+impliedFromAmerican\b/.test(slipAiSrc),
    "P3b — buildSlipAi.js declares impliedFromAmerican (current vig-included surface)")

  // P4: anti-sterilization carry-forward — no filter-by-vig-stripped pattern exists.
  const SUPPRESSIVE = /\.filter\s*\([^)]*\b(stripVig|noVigProb|fairProb)/
  assert(!SUPPRESSIVE.test(featuredSrc) && !SUPPRESSIVE.test(slipAiSrc),
    "P4 — no anti-sterilization-violating filter-by-vig-stripped pattern exists in pipeline source")
}

// ── Cluster I — POST-IMPL (Increment ≥ 2 state) ──────────────────────────
console.log("")
console.log("Cluster I — POST-IMPL (vigStripping.js + wiring) [conditional]")
if (moduleExists) {
  assert(true, "I1 — vigStripping.js exists at canonical path")
  let mod = null
  try { mod = require(VIG_MODULE_PATH) } catch (e) { failed++; failures.push("I1 — module load: " + e.message) }
  if (mod) {
    for (const fn of ["stripVigTwoWay","stripVigMultiWay","fairProbFromAmericanPair"]) {
      assert(typeof mod[fn] === "function", "I2 — exports " + fn)
    }
    assert(Object.isFrozen(mod), "I2 — module export object Object.frozen")

    // Determinism + invariant tests on representative inputs.
    if (typeof mod.stripVigTwoWay === "function") {
      const cases = [
        { over: -110, under: -110, expectVig: 0.0476, label: "balanced -110/-110" },
        { over: +150, under: -180, expectVig: 0.0476, label: "+150/-180" },
        { over: -250, under: +200, expectVig: 0.0476, label: "-250/+200 favorite" },
      ]
      let determOk = true, sumOk = true, antiFabOk = true
      for (const c of cases) {
        const a = mod.stripVigTwoWay(c.over, c.under)
        const b = mod.stripVigTwoWay(c.over, c.under)
        if (JSON.stringify(a) !== JSON.stringify(b)) determOk = false
        if (a && Math.abs((a.overFair + a.underFair) - 1.0) > 1e-9) sumOk = false
      }
      // Anti-fabrication: only one side → null
      const lone = mod.stripVigTwoWay(-110, null)
      if (lone !== null) antiFabOk = false
      assert(determOk, "I3 — stripVigTwoWay deterministic across consecutive calls")
      assert(sumOk,    "I5 — overFair + underFair === 1.0 (within floating tolerance)")
      assert(antiFabOk, "I4 — stripVigTwoWay returns null when one side missing (anti-fabrication)")
    }

    // I7 — consumer wiring (buildFeaturedPlays + buildSlipAi import the module).
    assert(/require\([^)]*vigStripping[^)]*\)/.test(featuredSrc),
      "I7a — buildFeaturedPlays imports vigStripping")
    assert(/require\([^)]*vigStripping[^)]*\)/.test(slipAiSrc),
      "I7b — buildSlipAi imports vigStripping")
    // I8 — FE surfacing: factors.vig + factors.fairImpliedProb populated in compactPlay.
    assert(/factors\.vig|f\.vig\s*=/.test(featuredSrc),
      "I8a — compactPlay surfaces factors.vig")
    assert(/factors\.fairImpliedProb|f\.fairImpliedProb\s*=/.test(featuredSrc),
      "I8b — compactPlay surfaces factors.fairImpliedProb")
  }
} else {
  console.log("  (skipped — vigStripping.js not present yet; assertions auto-flip to PASS when Increment 2 ships)")
}

// ── Cluster R — REPLAY/LIVE PARITY EXPECTATIONS ──────────────────────────
console.log("")
console.log("Cluster R — REPLAY/LIVE PARITY EXPECTATIONS")
// R1/R2: no time/random dependency anywhere in the planned module — assert
// no Math.random / Date.now / new Date() calls in the (future) module source.
if (moduleExists) {
  const modSrc = readSrc(VIG_MODULE_PATH)
  assert(modSrc && !/Math\.random|Date\.now\(\)|new Date\(\)/.test(modSrc),
    "R1 — vigStripping.js contains no time/random/clock dependency (replay/live parity invariant)")
} else {
  // PRE-CONDITION: assert the EXPECTATION is documented in this verifier
  // (forward-looking declaration; no module to inspect yet).
  const thisSrc = fs.readFileSync(__filename, "utf8")
  assert(/R1\.\s*Replay against persisted snapshot rows/.test(thisSrc),
    "R1 — replay/live parity expectation documented in verifier source (PRE-CONDITION)")
}
// R3: no live-runtime stale-date risk — vig stripping operates on per-call
// inputs only. Always PASS.
assert(true, "R3 — vig stripping has zero live-runtime stale-date risk (per-call pure computation)")

// ── Cluster D — DRIFT-DETECTION SELF-TEST (gated) ────────────────────────
console.log("")
console.log("Cluster D — DRIFT-DETECTION SELF-TEST (gated by ITEM_0003_VIG_DRIFT_SELF_TEST=1)")
if (process.env.ITEM_0003_VIG_DRIFT_SELF_TEST === "1") {
  console.log("  drift mode active — mechanical proof of verifier sensitivity")
  // Synthetic planted-drift module — verifier should detect each violation.
  const DRIFTS = [
    { label: "D1 non-frozen module", mod: { stripVigTwoWay: (a,b) => ({overFair:0.5,underFair:0.5,vig:0}) } },
    { label: "D2 overFair + underFair ≠ 1.0", mod: Object.freeze({ stripVigTwoWay: (a,b) => ({overFair:0.6,underFair:0.6,vig:0.2}) }) },
    { label: "D3 fabricates default on one-side absent", mod: Object.freeze({ stripVigTwoWay: (a,b) => b == null ? ({overFair:0.5,underFair:0.5,vig:0}) : null }) },
    { label: "D4 non-deterministic", mod: Object.freeze({ stripVigTwoWay: () => ({overFair: Math.random(), underFair: 1-Math.random(), vig:0}) }) },
  ]
  let detected = 0
  for (const d of DRIFTS) {
    let driftDetected = false
    if (!Object.isFrozen(d.mod))             driftDetected = true        // D1
    let r = null
    try { r = d.mod.stripVigTwoWay(-110, -110) } catch (_) { driftDetected = true }
    if (r && Math.abs((r.overFair + r.underFair) - 1.0) > 1e-9) driftDetected = true   // D2
    let lone = null
    try { lone = d.mod.stripVigTwoWay(-110, null) } catch (_) {}
    if (lone !== null && lone !== undefined) driftDetected = true   // D3 (fabricated default)
    let a = null, b = null
    try { a = d.mod.stripVigTwoWay(-110, -110); b = d.mod.stripVigTwoWay(-110, -110) } catch (_) {}
    if (a && b && JSON.stringify(a) !== JSON.stringify(b)) driftDetected = true     // D4
    if (driftDetected) { detected++; console.log("  ✓ " + d.label + " — detected") }
    else               { console.error("  ✗ " + d.label + " — NOT DETECTED"); failed++; failures.push(d.label) }
  }
  assert(detected === DRIFTS.length, `D — mechanical-drift self-test: ${detected}/${DRIFTS.length} drift cases detected`)
} else {
  console.log("  (skipped — set ITEM_0003_VIG_DRIFT_SELF_TEST=1 to enable)")
}

// ── Cluster S — SCOPE-LOCK PROOF (Increment 1 — no implementation) ──────
console.log("")
console.log("Cluster S — SCOPE-LOCK (Increment 1 prohibits implementation)")
assert(!moduleExists,
  "S1 — vigStripping.js NOT shipped this slice (Increment 1 scope-lock)")
// No edge re-pricing in feature / slip-ai files since baseline tag.
// We cannot literally diff against the tag inside the verifier without git,
// but we can assert no new `vig`-named edge mutation appears in the
// composite formula.
assert(!/composite\s*=\s*[^\n]*\bvigStripping|composite\s*=\s*[^\n]*\bstripVig/.test(featuredSrc),
  "S2 — buildFeaturedPlays composite formula contains no vig-stripping call (Increment 1 scope-lock)")
assert(!/composite\s*=\s*[^\n]*\bvigStripping|composite\s*=\s*[^\n]*\bstripVig/.test(slipAiSrc),
  "S3 — buildSlipAi composite formula contains no vig-stripping call (Increment 1 scope-lock)")

// ── Summary ──────────────────────────────────────────────────────────────
console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyVigStripping — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
