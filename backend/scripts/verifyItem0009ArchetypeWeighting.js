"use strict"

/**
 * verifyItem0009ArchetypeWeighting.js — Phase Item-0009 (2026-05-20).
 *
 * Asserts archetype-weighting invariants. Closes BBL-0005 verifier link.
 *
 * Clusters:
 *   A — STRUCTURAL: module exists; exports canonical functions.
 *   B — INVARIANTS: weight ∈ [0.5, 1.4]; pure/deterministic; NEUTRAL_RESULT on missing.
 *   C — CONSUMER WIRING: buildFeaturedPlays imports + applies the weight in scoreCandidate.
 *   D — EMPIRICAL BIAS: cleanup HR > bench RBI (gravity); rare-but-robust deep-cut ≥ 0.75 (preservation).
 *   E — ANTI-CELEBRITY: no per-player identifier reference in the module source.
 *   F — REGISTRY: runtime.js registers verify-archetype.
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const MOD     = path.join(BACKEND, "pipeline", "shared", "archetypeWeighting.js")
const CONS    = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const RUNTIME = path.join(BACKEND, "scripts", "ops", "runtime.js")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyItem0009ArchetypeWeighting.js")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── A ────────────────────────────────────────────────────────────────────
console.log("Cluster A — STRUCTURAL")
assert(fs.existsSync(MOD), "A1 — archetypeWeighting.js exists at canonical path")
let mod = null
try { mod = require(MOD) } catch (e) { failed++; failures.push("A2 — module load: " + e.message) }
if (mod) {
  for (const k of ["computeArchetypeWeight","normalizePropFamily","roleLegitimacyFor","propFamilyLegitimacyFor","archetypeTierFor","archetypeWeightFor","NEUTRAL_RESULT","NEUTRAL_WEIGHT","MIN_WEIGHT","MAX_WEIGHT"]) {
    assert(k in mod, `A3 — exports ${k}`)
  }
  assert(Object.isFrozen(mod), "A4 — module export object is Object.frozen")
}

// ── B ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — INVARIANTS")
if (mod) {
  assert(mod.MIN_WEIGHT === 0.5, "B1 — MIN_WEIGHT === 0.5 (anti-suppression floor)")
  assert(mod.MAX_WEIGHT === 1.4, "B2 — MAX_WEIGHT === 1.4 (anti-runaway ceiling)")
  // Sweep a representative set of cases; every weight must clamp.
  const samples = []
  for (const spot of [null, 1, 4, 7, 9]) {
    for (const depth of [null, "top", "middle", "back"]) {
      for (const pt of ["Home Runs","Total Bases","RBIs","Hits","Runs Scored","Stolen Bases","Pitcher Strikeouts","Pitcher Walks"]) {
        for (const side of ["over","under"]) {
          for (const bc of [1, 3, 5]) {
            for (const cc of [0.3, 0.5, 0.75]) {
              samples.push(mod.computeArchetypeWeight({ lineupSpot: spot, depth, propType: pt, side, bookCount: bc, consensusConfidence: cc, impliedTeamTotal: 4.2 }))
            }
          }
        }
      }
    }
  }
  const allInRange = samples.every(r => r.archetypeWeight >= 0.5 && r.archetypeWeight <= 1.4)
  assert(allInRange, `B3 — every weight ∈ [0.5, 1.4] across ${samples.length} samples`)
  // Determinism — two consecutive calls produce identical output
  const a = mod.computeArchetypeWeight({ lineupSpot: 4, depth: "middle", propType: "Home Runs", side: "over", bookCount: 4, consensusConfidence: 0.75, impliedTeamTotal: 5.0 })
  const b = mod.computeArchetypeWeight({ lineupSpot: 4, depth: "middle", propType: "Home Runs", side: "over", bookCount: 4, consensusConfidence: 0.75, impliedTeamTotal: 5.0 })
  assert(JSON.stringify(a) === JSON.stringify(b), "B4 — deterministic across consecutive calls")
  // Missing signals → NEUTRAL_WEIGHT
  const neutral = mod.computeArchetypeWeight({ lineupSpot: null, depth: null, propType: null, side: null })
  assert(neutral.archetypeWeight === 1.0, "B5 — missing signals → NEUTRAL_WEIGHT (1.0)")
  assert(neutral.archetypeReasonTag === "neutral_missing_signals", "B6 — missing signals → neutral_missing_signals reasonTag")
}

// ── C ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster C — CONSUMER WIRING")
const consSrc = fs.readFileSync(CONS, "utf8")
assert(/require\([^)]*archetypeWeighting[^)]*\)/.test(consSrc),
  "C1 — buildFeaturedPlays imports archetypeWeighting")
assert(/_computeArchetypeWeight\s*\(/.test(consSrc),
  "C2 — buildFeaturedPlays invokes computeArchetypeWeight")
assert(/composite\s*=\s*clamp\(\s*0\s*,\s*1\s*,\s*compositePreArchetype\s*\*\s*_aw\.archetypeWeight\s*\)/.test(consSrc),
  "C3 — composite multiplied by archetypeWeight (post-tier-boost; pre-clamp)")
assert(/f\.archetypeTier\s*=/.test(consSrc) && /f\.archetypeWeight\s*=/.test(consSrc),
  "C4 — factors expose archetypeTier + archetypeWeight for FE surfacing")

// ── D ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster D — EMPIRICAL BIAS (cleanup gravity vs bench-RBI suppression)")
if (mod) {
  const cleanupHr = mod.computeArchetypeWeight({ lineupSpot: 4, depth: "middle", propType: "Home Runs", side: "over", bookCount: 5, consensusConfidence: 0.75, impliedTeamTotal: 5.0 })
  const benchRbi  = mod.computeArchetypeWeight({ lineupSpot: 8, depth: "back",   propType: "RBIs",      side: "over", bookCount: 1, consensusConfidence: 0.48, impliedTeamTotal: 3.2 })
  assert(cleanupHr.archetypeWeight > benchRbi.archetypeWeight + 0.30,
    `D1 — cleanup HR (${cleanupHr.archetypeWeight.toFixed(2)}) outweighs bench RBI ladder (${benchRbi.archetypeWeight.toFixed(2)}) by ≥ 0.30`)
  assert(cleanupHr.archetypeTier === "superstar",
    "D2 — cleanup HR + multi-book → superstar tier")
  assert(benchRbi.archetypeTier === "no-name" || benchRbi.archetypeTier === "bench",
    `D3 — bench RBI ladder → bench/no-name tier (got: ${benchRbi.archetypeTier})`)
  // Rare-but-robust preservation — back-of-order HR with multi-book consensus
  // must NOT be crushed. Operator-cemented: sharp sleeper preservation.
  const rareRobust = mod.computeArchetypeWeight({ lineupSpot: 7, depth: "back", propType: "Home Runs", side: "over", bookCount: 4, consensusConfidence: 0.70, impliedTeamTotal: 4.6 })
  assert(rareRobust.archetypeWeight >= 0.75,
    `D4 — rare-but-robust deep-cut preserved ≥ 0.75 (got ${rareRobust.archetypeWeight.toFixed(2)})`)
  // Anti-sterilization: NEVER zeroes
  assert(benchRbi.archetypeWeight >= 0.50,
    `D5 — even worst-case bench RBI ladder ≥ 0.50 (got ${benchRbi.archetypeWeight.toFixed(2)})`)
}

// ── E ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster E — ANTI-CELEBRITY (class-not-identity Law 27)")
const modSrc = fs.readFileSync(MOD, "utf8")
// No per-player names. Heuristic: forbid common surname patterns + first-name
// references. Source must operate purely on class fields.
const NAME_RE = /\b(Trout|Ohtani|Judge|Acuna|Soto|Betts|Freeman|Tatis|Harper|Bichette|Buxton|Witt|Langeliers|Guerrero|Caissie|Riley|Ozuna|Raley)\b/
assert(!NAME_RE.test(modSrc), "E1 — archetypeWeighting.js contains no per-player identifier")

// ── F ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster F — REGISTRY")
try {
  delete require.cache[RUNTIME]
  const { COMMANDS } = require(RUNTIME)
  assert("verify-archetype" in COMMANDS, "F1 — runtime.js registers verify-archetype")
} catch (e) {
  failed++; failures.push("F1 — registry load: " + e.message)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyItem0009ArchetypeWeighting — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
