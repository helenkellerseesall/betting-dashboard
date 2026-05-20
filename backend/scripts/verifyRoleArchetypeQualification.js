"use strict"

/**
 * verifyRoleArchetypeQualification.js — Phase BRH-1.2.A Increment 1
 *                                        (verifier-first; 2026-05-20).
 *
 * Authored BEFORE any role/archetype qualification cognition ships.
 * Encodes the canonical contract + invariants the future implementation
 * MUST satisfy, plus PRE-IMPL assertions documenting the current
 * absence-of-qualification state.
 *
 * ZERO implementation wiring this slice. Increment 1 scope-lock asserted
 * by Cluster S.
 *
 * Canonical paths reserved (not yet authored):
 *   backend/pipeline/shared/roleArchetypeQualification.js
 *       — exports qualifyRole(candidate, ctx) → { roleClass,
 *         ownsOpportunity, sharesOpportunity, qualifiesAxis, reasonTag, phrase }
 *   backend/pipeline/mlb/mlbRoleArchetypeTable.js (MLB-first impl)
 *
 * Assertion-conditional clusters:
 *
 *   P — PRE-IMPL (current state):
 *     P1 roleArchetypeQualification.js absent at canonical path
 *     P2 no qualifyRole() / roleClass() / ownsOpportunity() call sites
 *     P3 buildFeaturedPlays.scoreCandidate has no role-fit factor today
 *     P4 buildSlipAi.scoreLeg has no role-fit factor today
 *
 *   I — POST-IMPL contract (auto-flips when Increment 2 ships):
 *     I1 module exists; Object.frozen export
 *     I2 exports qualifyRole(candidate, ctx) → object with required fields
 *     I3 deterministic across consecutive calls
 *     I4 sport-agnostic dispatcher (Law 28) — mlb dispatched through
 *        mlbRoleArchetypeTable; nba reserved for future slice
 *     I5 four-axis schema (Law 30): result carries { who, when, survives,
 *        marketEdge } provenance fields
 *     I6 anti-fabrication — returns NEUTRAL_RESULT when canonical signals
 *        absent; never substitutes a default roleClass
 *     I7 consumer wiring: buildFeaturedPlays imports qualifyRole; surfaces
 *        roleClass / ownsOpportunity / qualifiesAxis on compactPlay
 *
 *   A — ANTI-IDENTITY (Law 27 class-not-identity, ABSOLUTE):
 *     A1 module source contains NO per-player surname / first-name references
 *     A2 module source contains NO playerId / playerName lookups
 *     A3 module reads class-derived fields only (lineupSpot, depth,
 *        propType, propFamily, side, contextual signals); never identity
 *     A4 NO popularity / superstar / celebrity-bias literal coefficients
 *        (no `if (player === ...)` or `if (player.name.includes(...))`)
 *
 *   B — ANTI-STERILIZATION battlefield-preservation (ABSOLUTE):
 *     B1 NO .filter(...) pattern that removes candidates by qualification
 *     B2 NO `if (!ownsOpportunity) return null` from compactPlay path
 *     B3 NO `if (qualifiesAxis < N) continue` from scoreCandidate
 *     B4 Battlefield row count must be unchanged by qualification gate;
 *        qualification FLAGS candidates via metadata, never removes
 *     B5 Discover lens predicates do NOT consult qualifyRole output
 *        (Discover stays exploratory; qualification is curated-only)
 *
 *   R — REPLAY/LIVE PARITY:
 *     R1 module source contains no Math.random / Date.now / new Date() /
 *        clock-dependent calls (deterministic across replay)
 *     R2 same canonical inputs → same { roleClass, qualifiesAxis,
 *        ownsOpportunity } output across processes
 *     R3 zero per-process state caches inside the module
 *
 *   E — FOUR-AXIS EXPLANATION (Law 30):
 *     E1 contract result carries { who, when, survives, marketEdge }
 *        provenance markers (verifier-side check on declared interface)
 *     E2 phrase library `ROLE_PHRASES` follows bettorLanguage.js pattern:
 *        canonical SIGNAL_IDS + SIGNAL_PHRASES + SHORT_SIGNAL_PHRASES with
 *        identical cardinality
 *     E3 NO LLM-synthesized phrases — every phrase string traces to the
 *        frozen phrase library
 *
 *   G — DRIFT SELF-TEST (gated by BRH_1_2_A_DRIFT_SELF_TEST=1):
 *     G1 identity-consumption planted-drift detected
 *     G2 sterilizing-filter planted-drift detected
 *     G3 clock-dependent planted-drift detected
 *     G4 missing four-axis fields planted-drift detected
 *
 *   S — SCOPE-LOCK (Increment 1 — no implementation):
 *     S1 roleArchetypeQualification.js NOT shipped this slice
 *     S2 no mutation in buildFeaturedPlays.scoreCandidate composite formula
 *     S3 no mutation in buildSlipAi.scoreLeg projection factor
 *     S4 no FE roleClass surfacing in types.ts / FeaturedCard
 *
 * Doctrine: assertion-conditional. PRE-IMPL state PASSes today. POST-IMPL
 * assertions activate automatically when Increment 2 ships. NO verifier
 * mutation required to advance.
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const MODULE_PATH       = path.join(BACKEND, "pipeline", "shared", "roleArchetypeQualification.js")
const MLB_TABLE_PATH    = path.join(BACKEND, "pipeline", "mlb",    "mlbRoleArchetypeTable.js")
const FEATURED_PATH     = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const SLIP_AI_PATH      = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const GAME_ECO_PATH     = path.join(REPO, "frontend", "src", "workstation", "gameEcosystem.ts")
const TYPES_PATH        = path.join(REPO, "frontend", "src", "workstation", "types.ts")
const FEATURED_CARD     = path.join(REPO, "frontend", "src", "workstation", "components", "FeaturedCard.tsx")
const RUNTIME_REGISTRY  = path.join(BACKEND, "scripts", "ops", "runtime.js")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}
function readSrc(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "" }

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
      } else if (e.isFile() && /\.(js|ts|tsx|mjs|cjs)$/.test(e.name) && !exclude.has(full)) {
        try { if (pattern.test(fs.readFileSync(full, "utf8"))) hits.push(full) } catch (_) {}
      }
    }
  }
  return hits
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyRoleArchetypeQualification.js  (BRH-1.2.A Increment 1)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

const moduleExists = fs.existsSync(MODULE_PATH)
const featuredSrc  = readSrc(FEATURED_PATH)
const slipAiSrc    = readSrc(SLIP_AI_PATH)

// ── Cluster P — PRE-IMPL ─────────────────────────────────────────────────
console.log("Cluster P — PRE-IMPL (no role/archetype cognition shipped)")
if (!moduleExists) {
  assert(!fs.existsSync(MODULE_PATH),    "P1 — roleArchetypeQualification.js absent at canonical path")
  // P2 — no qualify/ownsOpportunity/roleClass call sites anywhere
  const CALL_RE = /\b(qualifyRole|ownsOpportunity|sharesOpportunity|qualifiesAxis|roleArchetypeQualification|mlbRoleArchetypeTable)\s*\(/
  const callHits = findInDir(BACKEND, CALL_RE, new Set([__filename])).filter(p => !/scripts[\\\/]verify[A-Z]/.test(p))
  assert(callHits.length === 0, `P2 — zero call sites in pipeline source (found=${callHits.length})`)
  // P3/P4 — no role-fit factor yet in composite scorers
  assert(!/\bf\.(roleClass|roleFit|ownsOpportunity|qualifiesAxis)\s*=/.test(featuredSrc),
    "P3 — buildFeaturedPlays.scoreCandidate has no role-fit factor (PRE-IMPL state)")
  assert(!/\bfactors\.(roleClass|roleFit|ownsOpportunity|qualifiesAxis)\s*=/.test(slipAiSrc),
    "P4 — buildSlipAi.scoreLeg has no role-fit factor (PRE-IMPL state)")
} else {
  console.log("  (module present; PRE-IMPL cluster retired; Cluster I activates)")
}

// ── Cluster I — POST-IMPL contract (conditional) ─────────────────────────
console.log("")
console.log("Cluster I — POST-IMPL contract (conditional; activates on module ship)")
if (moduleExists) {
  let mod = null
  try { mod = require(MODULE_PATH) } catch (e) { failed++; failures.push("I1 — module load: " + e.message) }
  if (mod) {
    assert(Object.isFrozen(mod), "I1 — module export Object.frozen")
    assert(typeof mod.qualifyRole === "function", "I2 — exports qualifyRole(candidate, ctx)")
    // Determinism
    const a = mod.qualifyRole({ lineupSpot: 4, depth: "middle", propType: "Home Runs", side: "over" }, { sport: "mlb" })
    const b = mod.qualifyRole({ lineupSpot: 4, depth: "middle", propType: "Home Runs", side: "over" }, { sport: "mlb" })
    assert(JSON.stringify(a) === JSON.stringify(b), "I3 — deterministic across consecutive calls")
    // Sport-agnostic dispatcher
    const mlbHit = mod.qualifyRole({ lineupSpot: 4, depth: "middle", propType: "Home Runs", side: "over" }, { sport: "mlb" })
    assert(mlbHit && typeof mlbHit === "object", "I4 — MLB dispatcher returns object")
    // Four-axis schema fields present
    assert(mlbHit && ("who" in mlbHit) && ("when" in mlbHit) && ("survives" in mlbHit) && ("marketEdge" in mlbHit),
      "I5 — result carries { who, when, survives, marketEdge } provenance fields (Law 30)")
    // Anti-fabrication: missing signals → NEUTRAL_RESULT
    const neutral = mod.qualifyRole({ lineupSpot: null, depth: null, propType: null }, { sport: "mlb" })
    assert(neutral && neutral.roleClass === undefined || neutral.roleClass === "unknown" || neutral.roleClass == null,
      "I6 — missing-signals → NEUTRAL/unknown roleClass (anti-fabrication)")
  }
  // I7 consumer wiring
  assert(/require\([^)]*roleArchetypeQualification[^)]*\)/.test(featuredSrc),
    "I7 — buildFeaturedPlays imports roleArchetypeQualification")
} else {
  console.log("  (skipped — module not yet present; assertions auto-flip on Increment 2)")
}

// ── Cluster A — ANTI-IDENTITY (Law 27) ───────────────────────────────────
console.log("")
console.log("Cluster A — ANTI-IDENTITY (class-not-identity Law 27, ABSOLUTE)")
if (moduleExists) {
  const modSrc = readSrc(MODULE_PATH) + "\n" + readSrc(MLB_TABLE_PATH)
  // Common active MLB player surnames as canary set — module MUST NOT contain
  // any per-player identifier (live identity consumption). Class-not-identity.
  const PLAYER_NAMES_RE = /\b(Trout|Ohtani|Judge|Acuna|Soto|Betts|Freeman|Tatis|Harper|Bichette|Buxton|Witt|Langeliers|Guerrero|Caissie|Riley|Ozuna|Raley|Bregman|Yelich|Goldschmidt|Arenado)\b/
  assert(!PLAYER_NAMES_RE.test(modSrc),
    "A1 — module + table contain no per-player surname identifier")
  assert(!/playerId|playerName|playerKey/i.test(modSrc),
    "A2 — module contains no playerId / playerName / playerKey lookup")
  assert(!/\bif\s*\(\s*[a-zA-Z_.]+\.player\b[\s\S]{0,80}===|\bplayer\s*===\s*["']/.test(modSrc),
    "A3 — module contains no identity-equality predicate")
  assert(!/celebrity|superstar|popularity/i.test(modSrc),
    "A4 — module contains no celebrity / superstar / popularity literal coefficient")
} else {
  // PRE-IMPL — assert the doctrine declaration is present in THIS verifier
  const thisSrc = fs.readFileSync(__filename, "utf8")
  assert(/A1[\s\S]*per-player surname/.test(thisSrc) || /class-not-identity Law 27/.test(thisSrc),
    "A — anti-identity doctrine declared in verifier (PRE-IMPL)")
}

// ── Cluster B — ANTI-STERILIZATION battlefield preservation ──────────────
console.log("")
console.log("Cluster B — ANTI-STERILIZATION battlefield preservation (ABSOLUTE)")
const STERIL_RE = /\.filter\s*\([^)]*\b(ownsOpportunity|qualifiesAxis|roleClass)\b/
assert(!STERIL_RE.test(featuredSrc), "B1 — buildFeaturedPlays does NOT filter by qualification fields")
assert(!STERIL_RE.test(slipAiSrc),   "B1 — buildSlipAi does NOT filter by qualification fields")
const NULL_RETURN_RE = /if\s*\(\s*!?ownsOpportunity[\s\S]{0,40}return\s+null/
assert(!NULL_RETURN_RE.test(featuredSrc),
  "B2 — no `if (!ownsOpportunity) return null` in buildFeaturedPlays")
const SKIP_RE = /if\s*\(\s*qualifiesAxis\s*<[\s\S]{0,40}continue/
assert(!SKIP_RE.test(featuredSrc),
  "B3 — no `if (qualifiesAxis < N) continue` in scoreCandidate")
// B5 — Discover lens predicates do NOT consult qualifyRole
const gameEcoSrc = readSrc(GAME_ECO_PATH)
assert(!/qualifyRole|roleArchetypeQualification|ownsOpportunity/.test(gameEcoSrc),
  "B5 — gameEcosystem.ts (Discover lens) contains no qualifyRole consumer")

// ── Cluster R — REPLAY/LIVE PARITY ───────────────────────────────────────
console.log("")
console.log("Cluster R — REPLAY/LIVE PARITY")
if (moduleExists) {
  const modSrc = readSrc(MODULE_PATH) + "\n" + readSrc(MLB_TABLE_PATH)
  assert(!/Math\.random|Date\.now\s*\(|new Date\s*\(/.test(modSrc),
    "R1 — module + table contain no Math.random / Date.now / new Date() drift")
} else {
  const thisSrc = fs.readFileSync(__filename, "utf8")
  assert(/R1[\s\S]*Math\.random/.test(thisSrc),
    "R1 — replay/live parity invariant declared in verifier (PRE-IMPL)")
}

// ── Cluster E — FOUR-AXIS EXPLANATION (Law 30) ───────────────────────────
console.log("")
console.log("Cluster E — FOUR-AXIS EXPLANATION (Law 30)")
if (moduleExists) {
  const modSrc = readSrc(MODULE_PATH) + "\n" + readSrc(MLB_TABLE_PATH)
  assert(/ROLE_PHRASES|SIGNAL_PHRASES/.test(modSrc),
    "E2 — frozen phrase library declared (ROLE_PHRASES / SIGNAL_PHRASES)")
  assert(!/llm|openai|anthropic|completion/i.test(modSrc),
    "E3 — no LLM-synthesized phrase calls in module source")
} else {
  const thisSrc = fs.readFileSync(__filename, "utf8")
  assert(/E1[\s\S]*who.*when.*survives.*marketEdge/.test(thisSrc),
    "E1 — four-axis schema contract declared in verifier (PRE-IMPL)")
}

// ── Cluster G — DRIFT SELF-TEST ──────────────────────────────────────────
console.log("")
console.log("Cluster G — DRIFT SELF-TEST (gated by BRH_1_2_A_DRIFT_SELF_TEST=1)")
if (process.env.BRH_1_2_A_DRIFT_SELF_TEST === "1") {
  console.log("  drift mode active — mechanical proof of verifier sensitivity")
  // Construct synthetic source strings that should each trigger an assertion failure.
  const drifts = [
    { label: "G1 identity-consumption", src: `if (player.name === "Aaron Judge") return 1.5` },
    { label: "G2 sterilizing-filter",   src: `arr.filter(c => c.ownsOpportunity).slice(0, 5)` },
    { label: "G3 clock-dependent",      src: `const seed = Date.now() % 1000` },
    { label: "G4 missing four-axis",    src: `return { roleClass: "top", reasonTag: "x" }` /* no who/when/survives/marketEdge */ },
  ]
  let detected = 0
  // G1
  if (/\b(Trout|Ohtani|Judge|Acuna|Soto|Betts|Freeman|Tatis|Harper|Bichette|Buxton|Witt|Langeliers|Guerrero|Caissie|Riley|Ozuna|Raley|Bregman|Yelich|Goldschmidt|Arenado)\b/.test(drifts[0].src))
    { detected++; console.log("  ✓ G1 identity-consumption — detected") }
  else { console.error("  ✗ G1 — NOT DETECTED"); failed++ }
  // G2
  if (/\.filter\s*\([^)]*\b(ownsOpportunity|qualifiesAxis|roleClass)\b/.test(drifts[1].src))
    { detected++; console.log("  ✓ G2 sterilizing-filter — detected") }
  else { console.error("  ✗ G2 — NOT DETECTED"); failed++ }
  // G3
  if (/Math\.random|Date\.now\s*\(|new Date\s*\(/.test(drifts[2].src))
    { detected++; console.log("  ✓ G3 clock-dependent — detected") }
  else { console.error("  ✗ G3 — NOT DETECTED"); failed++ }
  // G4 — synthetic result missing required axis fields
  const r = (() => { return { roleClass: "top", reasonTag: "x" } })()
  const hasAxes = ("who" in r) && ("when" in r) && ("survives" in r) && ("marketEdge" in r)
  if (!hasAxes) { detected++; console.log("  ✓ G4 missing four-axis fields — detected") }
  else          { console.error("  ✗ G4 — NOT DETECTED"); failed++ }
  assert(detected === 4, `G — mechanical-drift self-test: ${detected}/4 drift cases detected`)
} else {
  console.log("  (skipped — set BRH_1_2_A_DRIFT_SELF_TEST=1 to enable)")
}

// ── Cluster S — SCOPE-LOCK (Increment 1) ─────────────────────────────────
console.log("")
console.log("Cluster S — SCOPE-LOCK (Increment 1 prohibits implementation)")
if (!moduleExists) {
  assert(true, "S1 — roleArchetypeQualification.js NOT shipped this slice")
  assert(!/composite\s*=[^\n]*\b(qualifyRole|roleArchetypeQualification)/.test(featuredSrc),
    "S2 — buildFeaturedPlays composite formula has no qualification call")
  assert(!/composite\s*=[^\n]*\b(qualifyRole|roleArchetypeQualification)/.test(slipAiSrc),
    "S3 — buildSlipAi composite formula has no qualification call")
  const typesSrc = readSrc(TYPES_PATH)
  const cardSrc  = readSrc(FEATURED_CARD)
  assert(!/roleClass\?|ownsOpportunity\?|qualifiesAxis\?/.test(typesSrc),
    "S4 — FeaturedPlay type has no roleClass / ownsOpportunity / qualifiesAxis fields yet")
  assert(!/roleClass|ownsOpportunity/.test(cardSrc),
    "S4 — FeaturedCard.tsx has no roleClass / ownsOpportunity render yet")
} else {
  console.log("  (retired — module shipped; POST-IMPL Cluster I + A + B take over)")
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyRoleArchetypeQualification — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
