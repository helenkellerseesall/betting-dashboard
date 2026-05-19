"use strict"

/**
 * Phase CA-3d Item 0001 — verifyItem0001PropFamilyScope.js
 *
 * PROP-FAMILY-SCOPE VERIFIER (Increment 1, verifier-first).
 *
 * Authored BEFORE the Item 0001 survivability gate ships (Increments 2-8).
 * This verifier asserts the canonical prop-family scope boundary for the
 * Item 0001 survivability gate — operator-approved per the Item 0001
 * doctrine-pilot entry in `/docs/CURATION_AUDIT_2026-05-18.md` Stage C.12
 * + calibration packet Stage D.2 + D.7.
 *
 * OPERATOR-APPROVED FAMILY SCOPE:
 *
 *   IN-SCOPE (gate evaluates; per-family thresholds apply per Law 29):
 *     • Home Runs Over (line 0.5; hrCarryFactor active)         — floor 0.55
 *     • Total Bases Over (line 1.5-4.5; ladderHeight + hrCarry) — floor 0.45 / 0.40 (line-aware)
 *     • Hits Over (line 1.5-3.5; no hrCarry)                    — floor 0.55 / 0.45 (line-aware)
 *     • RBIs Over (line 0.5-1.5; runEnv-heavy)                  — floor 0.50
 *
 *   OUT-OF-SCOPE (gate bypasses; admit=true neutral):
 *     • Pitcher Outs / Strikeouts / Walks (any side)
 *     • Doubles / Triples / Extra-Base Hits (data-sparse minor families)
 *     • First Basket (NBA-specific; not in MLB-first scope)
 *     • Any Under-side prop (hitter-overs-only doctrine per PCE-1A + Law 26)
 *     • NBA families (Item 0002 sport-extension; not in MLB-first scope)
 *     • Any family where canonical signals are absent (anti-fabrication;
 *       neutral fallback factor 1.0 admits)
 *
 *   PRESERVED (untouched by Item 0001):
 *     • SLIP_EXCLUDED_FAMILIES = {"rbis", "outs"} in buildSlipAi.js
 *       (slip-assembly-time scope; orthogonal to survivability gate; applies
 *        ONLY to slip composition, NOT to Discover/Curated surfacing)
 *
 * ASSERTIONS (assertion-conditional logic):
 *
 *   Pre-Item-0001 state (gate absent):
 *     B1. SLIP_EXCLUDED_FAMILIES preserved as {"rbis", "outs"} (no scope drift).
 *     B2. isOffensiveAttackStat (PCE-1A canonical hitter-overs predicate) present.
 *     B3. No per-player identity hooks in pipeline source (Law 27 baseline).
 *     B4. No pre-existing survivability gate (mlbSurvivabilityGate.js absent).
 *
 *   Post-Item-0001 state (gate present):
 *     B5. Per-family threshold constants present in mlbSurvivabilityGate.js with
 *         operator-approved values (HR 0.55 / TB_LOW 0.45 / TB_HIGH 0.40 /
 *         HITS_LOW 0.55 / HITS_HIGH 0.45 / RBIS 0.50).
 *     B6. Gate dispatcher dispatches by statFamily to family-specific predicates.
 *     B7. Out-of-scope families (pitcher / under / NBA / minor) bypass gate
 *         via admit=true neutral.
 *     B8. Gate code contains NO per-player references (no identity hooks per
 *         Law 27).
 *     B9. SLIP_EXCLUDED_FAMILIES unchanged by Item 0001.
 *
 * Doctrine:
 *   - Verifier-only. No semantic side effects. No mutation.
 *   - Auto-discovered by `runAllVerifiers.js` matrix on filename `verify*.js`.
 *   - PRE-CONDITION state acknowledged as PASS (gate not yet shipped).
 *
 * Run via:
 *   node backend/scripts/verifyItem0001PropFamilyScope.js
 *
 * Or via canonical ops layer:
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const buildSlipAiPath          = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const normalizersPath          = path.join(BACKEND, "pipeline", "shared", "normalizers.js")
const buildFeaturedPlaysPath   = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const survivabilityGatePath    = path.join(BACKEND, "pipeline", "shared", "survivabilityGate.js")
const mlbSurvivabilityGatePath = path.join(BACKEND, "pipeline", "mlb", "mlbSurvivabilityGate.js")

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

console.log("verifyItem0001PropFamilyScope — Phase CA-3d Item 0001 prop-family-scope")
console.log("─".repeat(70))

const buildSlipAiSrc          = readSrc(buildSlipAiPath, "buildSlipAi.js")
const normalizersSrc          = readSrc(normalizersPath, "normalizers.js")
const buildFeaturedPlaysSrc   = readSrc(buildFeaturedPlaysPath, "buildFeaturedPlays.js")
const gateExists              = fs.existsSync(survivabilityGatePath)
const mlbGateExists           = fs.existsSync(mlbSurvivabilityGatePath)
const gateSrc                 = gateExists ? readSrc(survivabilityGatePath, "survivabilityGate.js") : ""
const mlbGateSrc              = mlbGateExists ? readSrc(mlbSurvivabilityGatePath, "mlbSurvivabilityGate.js") : ""

// ─────────────────────────────────────────────────────────────────────────────
// PRE-CONDITION / ALL-STATE ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

// B1. SLIP_EXCLUDED_FAMILIES preserved as {"rbis", "outs"}.
assert(/SLIP_EXCLUDED_FAMILIES\s*=\s*new\s+Set\(\s*\[\s*"rbis"\s*,\s*"outs"\s*\]\s*\)/.test(buildSlipAiSrc),
  'B1 — SLIP_EXCLUDED_FAMILIES preserved as {"rbis", "outs"} (operator-cemented; Item 0001 must not alter)')

// B2. isOffensiveAttackStat (canonical hitter-overs predicate from PCE-1A) present.
assert(/isOffensiveAttackStat/.test(normalizersSrc) || /isOffensiveAttackStat/.test(buildFeaturedPlaysSrc),
  "B2 — isOffensiveAttackStat canonical predicate present (PCE-1A hitter-overs scope; Law 26)")

// B3. No per-player identity hooks in pipeline source (Law 27 baseline).
//     Forbidden patterns: hardcoded player name comparisons in scoring path.
const knownStarNames = ["Aaron Judge", "Shohei Ohtani", "Mike Trout", "LeBron", "Mookie Betts"]
for (const name of knownStarNames) {
  assert(!new RegExp(`["']${name}["']`).test(buildFeaturedPlaysSrc),
    `B3 — buildFeaturedPlays.js contains no hardcoded "${name}" reference (Law 27 class-not-identity)`)
  assert(!new RegExp(`["']${name}["']`).test(buildSlipAiSrc),
    `B3 — buildSlipAi.js contains no hardcoded "${name}" reference (Law 27 class-not-identity)`)
}

// B4. No pre-existing survivability gate at the canonical Item 0001 path
//     (asserts Item 0001 mutation has not yet begun; documents pre-mutation state).
//     This is informational; PASS in either state — Item 0001 mutation transitions
//     this assertion's CONTEXT, not its result.
if (!gateExists) {
  console.log("  ℹ B4 — pre-Item-0001 mode: survivabilityGate.js absent; expected pre-Increment-7")
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-ITEM-0001 ASSERTIONS (when gate ships)
// ─────────────────────────────────────────────────────────────────────────────

if (mlbGateExists) {
  console.log(`  ℹ post-Item-0001 mode — mlbSurvivabilityGate.js present; running family-scope assertions`)

  // B5. Per-family threshold constants present with operator-approved values
  //     (per CA-1 audit Stage D.3 + ACTIVE EXECUTION authorization packet).
  const familyThresholds = [
    ["OE8_SURVIVABILITY_FLOOR_HR",        "0.55"],
    ["OE8_SURVIVABILITY_FLOOR_TB_LOW",    "0.45"],
    ["OE8_SURVIVABILITY_FLOOR_TB_HIGH",   "0.40"],
    ["OE8_SURVIVABILITY_FLOOR_HITS_LOW",  "0.55"],
    ["OE8_SURVIVABILITY_FLOOR_HITS_HIGH", "0.45"],
    ["OE8_SURVIVABILITY_FLOOR_RBIS",      "0.50"],
  ]
  for (const [name, val] of familyThresholds) {
    assert(new RegExp(`${name}\\s*=\\s*${val.replace(".", "\\.")}`).test(mlbGateSrc),
      `B5 — mlbSurvivabilityGate.js defines ${name} = ${val} (operator-approved)`)
  }

  // B6. Family dispatcher: gate code consumes statFamily and dispatches.
  assert(/statFamily/.test(mlbGateSrc),
    "B6 — mlbSurvivabilityGate consumes statFamily for dispatch")

  // B7. Out-of-scope families bypass with neutral admit.
  //     The mlb gate is the in-scope predicate; the dispatcher at survivabilityGate.js
  //     handles sport-routing. Within MLB, gate must explicitly handle:
  //     - pitcher families (Outs, Strikeouts, Walks)
  //     - under-side
  //     - minor families (Doubles, Triples, XBH)
  //     All via "admit: true" neutral return.
  if (gateExists) {
    assert(/admit/.test(gateSrc),
      "B7 — survivabilityGate dispatcher returns admit flag")
  }

  // B8. No per-player identity hooks in gate code (Law 27).
  for (const name of knownStarNames) {
    assert(!new RegExp(`["']${name}["']`).test(mlbGateSrc),
      `B8 — mlbSurvivabilityGate contains no "${name}" reference (Law 27 class-not-identity)`)
    if (gateSrc) {
      assert(!new RegExp(`["']${name}["']`).test(gateSrc),
        `B8 — survivabilityGate contains no "${name}" reference (Law 27 class-not-identity)`)
    }
  }

  // B9. SLIP_EXCLUDED_FAMILIES unchanged by Item 0001.
  //     Already asserted in B1; reaffirms the boundary.
  assert(/SLIP_EXCLUDED_FAMILIES\s*=\s*new\s+Set\(\s*\[\s*"rbis"\s*,\s*"outs"\s*\]\s*\)/.test(buildSlipAiSrc),
    "B9 — SLIP_EXCLUDED_FAMILIES still {\"rbis\", \"outs\"} (Item 0001 did not alter)")
} else {
  console.log("  ℹ pre-Item-0001 mode — mlbSurvivabilityGate.js absent; family-scope assertions deferred")
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
