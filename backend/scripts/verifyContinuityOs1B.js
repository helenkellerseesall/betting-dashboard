"use strict"

/**
 * Phase Continuity-OS-1B — helper unit-test fixture.
 *
 * PORTABLE CROSS-CHAT RECONSTRUCTION ARTIFACT — single file optimized for
 * fresh GPT chat upload-and-continue.
 *
 * Pure deterministic source-text contract assertions.
 * NO HTTP. NO SQLite. NO ML. NO LLM. NO OCR.
 *
 * Doctrine guarded:
 *   • `GPT_RECONSTRUCTION_BOOTSTRAP.md` exists at repo root.
 *   • All 10 required canonical sections present (§ 1 through § 10).
 *   • Line budget: ~400-1200 lines (compressed, scannable, not essay drift).
 *   • Active phase synced with `ACTIVE_PHASE.md`.
 *   • Bottlenecks synced with `CURRENT_PROBLEMS.md` (active items match).
 *   • Operational flow synced with `OPERATIONAL_FLOW.md` (canonical commands present).
 *   • Forbidden directions preserved (all 12 cemented X-1..X-12).
 *   • Deferred items synced with `DEFERRED_PHASES.md` (top forbidden items present).
 *   • No contradiction drift — repo identity 4-word doctrine matches PRODUCT_IDENTITY.md.
 *   • Reconstruction instructions present at TOP AND BOTTOM (operator directive).
 *   • Anchor reconciliation ritual mentions this file as REGENERATE-on-seal.
 *
 * Run via:
 *   node backend/scripts/verifyContinuityOs1B.js
 */

const fs   = require("fs")
const path = require("path")

const REPO     = path.join(__dirname, "..", "..")

const bootstrapPath      = path.join(REPO, "GPT_RECONSTRUCTION_BOOTSTRAP.md")
const activePhasePath    = path.join(REPO, "ACTIVE_PHASE.md")
const productIdentityPath= path.join(REPO, "PRODUCT_IDENTITY.md")
const currentProblemsPath= path.join(REPO, "CURRENT_PROBLEMS.md")
const nextPhasePath      = path.join(REPO, "NEXT_PHASE.md")
const operationalFlowPath= path.join(REPO, "OPERATIONAL_FLOW.md")
const deferredPhasesPath = path.join(REPO, "DEFERRED_PHASES.md")
const bootstrapPromptPath= path.join(REPO, "BOOTSTRAP_PROMPT.md")

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}
function contains(src, needle, label) {
  assert(src.indexOf(needle) !== -1, `${label} — contains "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}
function notContains(src, needle, label) {
  assert(src.indexOf(needle) === -1, `${label} — does NOT contain "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// File exists
// ─────────────────────────────────────────────────────────────────────────────
assert(fs.existsSync(bootstrapPath),
  "GPT_RECONSTRUCTION_BOOTSTRAP.md exists at repo root")
const bootstrapSrc = fs.readFileSync(bootstrapPath, "utf8")
const activePhaseSrc     = fs.readFileSync(activePhasePath, "utf8")
const productIdentitySrc = fs.readFileSync(productIdentityPath, "utf8")
const currentProblemsSrc = fs.readFileSync(currentProblemsPath, "utf8")
const operationalFlowSrc = fs.readFileSync(operationalFlowPath, "utf8")
const deferredPhasesSrc  = fs.readFileSync(deferredPhasesPath, "utf8")
const bootstrapPromptSrc = fs.readFileSync(bootstrapPromptPath, "utf8")

// ─────────────────────────────────────────────────────────────────────────────
// 10 required canonical sections
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_SECTIONS = [
  ["§ 1 — REPO IDENTITY",                    "§ 1 REPO IDENTITY"],
  ["§ 2 — CURRENT ACTIVE PHASE",             "§ 2 CURRENT ACTIVE PHASE"],
  ["§ 3 — CURRENT PRODUCT STATE",            "§ 3 CURRENT PRODUCT STATE"],
  ["§ 4 — CURRENT BOTTLENECKS",              "§ 4 CURRENT BOTTLENECKS"],
  ["§ 5 — FORBIDDEN DIRECTIONS",             "§ 5 FORBIDDEN DIRECTIONS"],
  ["§ 6 — CURRENT FE DIRECTION",             "§ 6 CURRENT FE DIRECTION"],
  ["§ 7 — OPERATIONAL FLOW",                 "§ 7 OPERATIONAL FLOW"],
  ["§ 8 — DEFERRED SYSTEMS",                 "§ 8 DEFERRED SYSTEMS"],
  ["§ 9 — CURRENT NEXT-PHASE OPTIONS",       "§ 9 CURRENT NEXT-PHASE OPTIONS"],
  ["§ 10 — RECONSTRUCTION INSTRUCTIONS",     "§ 10 RECONSTRUCTION INSTRUCTIONS"],
]
for (const [needle, label] of REQUIRED_SECTIONS) {
  contains(bootstrapSrc, needle, `Required canonical section present: ${label}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconstruction instructions at TOP and BOTTOM (operator directive)
// ─────────────────────────────────────────────────────────────────────────────
{
  const lines = bootstrapSrc.split("\n")
  const topThird    = lines.slice(0, Math.floor(lines.length / 3)).join("\n")
  const bottomThird = lines.slice(Math.floor(lines.length * 2 / 3)).join("\n")
  contains(topThird, "READ THIS FIRST",
    "Reconstruction instructions appear at TOP (operator directive: 'at TOP and BOTTOM')")
  contains(bottomThird, "RECONSTRUCTION INSTRUCTIONS",
    "Reconstruction instructions appear at BOTTOM (operator directive: 'at TOP and BOTTOM')")
  contains(topThird, "DO NOT rediscover architecture",
    "TOP instructions explicitly forbid architecture rediscovery")
  contains(topThird, "DO NOT re-solve solved problems",
    "TOP instructions explicitly forbid re-solving solved problems")
  contains(topThird, "DO NOT propose forbidden directions",
    "TOP instructions explicitly forbid proposing forbidden directions")
  contains(bottomThird, "MANDATORY CHECKPOINT BEHAVIOR",
    "BOTTOM instructions include mandatory checkpoint behavior (regenerate-on-seal)")
}

// ─────────────────────────────────────────────────────────────────────────────
// Size discipline — 400-1200 line budget per operator spec
// ─────────────────────────────────────────────────────────────────────────────
{
  const lineCount = bootstrapSrc.split("\n").length
  assert(lineCount >= 400,
    `GPT_RECONSTRUCTION_BOOTSTRAP is substantial enough (${lineCount} lines >= 400 floor)`)
  assert(lineCount <= 1200,
    `GPT_RECONSTRUCTION_BOOTSTRAP stays compressed (${lineCount} lines <= 1200 operator-cemented ceiling — no essay drift)`)
  console.log(`  ✓ LINE BUDGET: ${lineCount} lines (target 400-1200)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Active phase synced with ACTIVE_PHASE.md
// ─────────────────────────────────────────────────────────────────────────────
{
  // ACTIVE_PHASE.md should reference Continuity-OS-1B as the current phase
  contains(activePhaseSrc, "Continuity-OS-1B",
    "ACTIVE_PHASE.md current phase reflects Continuity-OS-1B")
  // GPT_RECONSTRUCTION_BOOTSTRAP.md should mirror that
  contains(bootstrapSrc, "Continuity-OS-1B",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 2 reflects Continuity-OS-1B as current active phase")
  contains(bootstrapSrc, "26th approved phase",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 2 reflects 26 total approved phases (Continuity-OS-1B sealed)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 canonical identity words synced with PRODUCT_IDENTITY.md
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const word of ["Deterministic", "Anti-fabrication", "Bettor-native", "Operating system"]) {
    contains(productIdentitySrc, `**${word}**`,
      `PRODUCT_IDENTITY.md defines canonical word: ${word}`)
    contains(bootstrapSrc, `**${word}**`,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 1 mirrors canonical word: ${word}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-layer architecture synced
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const layer of ["Battlefield", "Curated Edge", "Compression"]) {
    contains(productIdentitySrc, layer,
      `PRODUCT_IDENTITY.md defines layer: ${layer}`)
    contains(bootstrapSrc, layer,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 1 mirrors layer: ${layer}`)
  }
  contains(bootstrapSrc, "state.discoveryCandidates",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 1 mirrors Battlefield pool (state.discoveryCandidates)")
  contains(bootstrapSrc, "state.aiSlips",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 1 mirrors Compression pool (state.aiSlips)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 5-status legend synced with CURRENT_PROBLEMS.md
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const status of ["🟢 SOLVED", "🟡 ACTIVE", "🔵 DEFERRED", "🔴 DANGEROUS", "⚪ FUTURE"]) {
    contains(currentProblemsSrc, status,
      `CURRENT_PROBLEMS.md includes canonical status: ${status}`)
    contains(bootstrapSrc, status,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 4 mirrors canonical status: ${status}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Active bottlenecks (A-1..A-5) synced with CURRENT_PROBLEMS.md
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const id of ["A-1", "A-2", "A-3", "A-4", "A-5"]) {
    contains(currentProblemsSrc, `| ${id} |`,
      `CURRENT_PROBLEMS.md has active bottleneck ${id}`)
    contains(bootstrapSrc, `| ${id} |`,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 4 mirrors active bottleneck ${id}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// All 12 forbidden directions (X-1..X-12) preserved verbatim
// ─────────────────────────────────────────────────────────────────────────────
{
  for (let i = 1; i <= 12; i++) {
    contains(bootstrapSrc, `| X-${i} |`,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 5 preserves forbidden direction X-${i}`)
  }
  // Critical individual forbidden directions explicitly referenced
  for (const forbidden of ["LLM / GPT narration", "Celebrity", "Auto-bet", "Vision API", "OCR pipeline", "Hard-filtering props upstream", "Adaptive AI styling"]) {
    contains(bootstrapSrc, forbidden,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 5 explicitly names forbidden direction: ${forbidden}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational flow canonical commands synced with OPERATIONAL_FLOW.md
// ─────────────────────────────────────────────────────────────────────────────
{
  for (const cmd of ["npm run brain:bootstrap", "npm run brain:continuity", "npm run brain:verify", "npm run brain:checkpoint"]) {
    contains(operationalFlowSrc, cmd,
      `OPERATIONAL_FLOW.md documents ${cmd}`)
    contains(bootstrapSrc, cmd,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 7 mirrors ${cmd}`)
  }
  // Terminal conventions synced
  contains(bootstrapSrc, "TERM 1",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 7 documents TERM 1 backend convention")
  contains(bootstrapSrc, "TERM 2",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 7 documents TERM 2 verifier convention")
  contains(bootstrapSrc, "audit-first",
    "GPT_RECONSTRUCTION_BOOTSTRAP § 7 documents audit-first doctrine")
}

// ─────────────────────────────────────────────────────────────────────────────
// Deferred systems synced with DEFERRED_PHASES.md
// ─────────────────────────────────────────────────────────────────────────────
{
  // Critical INDEFINITELY DEFERRED items must appear in both
  for (const def of ["OCR", "NBA-parity", "Longitudinal", "Bullpen", "OE-14", "OE-15"]) {
    contains(deferredPhasesSrc, def,
      `DEFERRED_PHASES.md references deferral: ${def}`)
    contains(bootstrapSrc, def,
      `GPT_RECONSTRUCTION_BOOTSTRAP § 8 mirrors deferral: ${def}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPERATIONAL_FLOW.md anchor-reconciliation ritual includes THIS file
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(operationalFlowSrc, "GPT_RECONSTRUCTION_BOOTSTRAP.md",
    "OPERATIONAL_FLOW.md anchor-file reconciliation ritual includes GPT_RECONSTRUCTION_BOOTSTRAP.md")
  contains(operationalFlowSrc, "REGENERATE on EVERY phase seal",
    "OPERATIONAL_FLOW.md marks GPT_RECONSTRUCTION_BOOTSTRAP.md as REGENERATE on every phase seal")
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP_PROMPT.md has FASTEST PATH entry for fresh GPT chats
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(bootstrapPromptSrc, "FASTEST PATH",
    "BOOTSTRAP_PROMPT.md has FASTEST PATH entry block (COS-1B addition)")
  contains(bootstrapPromptSrc, "GPT_RECONSTRUCTION_BOOTSTRAP.md",
    "BOOTSTRAP_PROMPT.md references GPT_RECONSTRUCTION_BOOTSTRAP.md as the single-file path")
  contains(bootstrapPromptSrc, "Continuity-OS-1B",
    "BOOTSTRAP_PROMPT.md cites Continuity-OS-1B as the source of FASTEST PATH")
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-FILE NON-CONTRADICTION (active phase, identity, layers all agree)
// ─────────────────────────────────────────────────────────────────────────────
{
  // ACTIVE_PHASE says Continuity-OS-1B is current; bootstrap must agree
  const activeNamesCurrent = activePhaseSrc.indexOf("Continuity-OS-1B") !== -1
  const bootstrapNamesCurrent = bootstrapSrc.indexOf("Continuity-OS-1B") !== -1
  assert(activeNamesCurrent === bootstrapNamesCurrent,
    "Active-phase identity is CONSISTENT between ACTIVE_PHASE.md and GPT_RECONSTRUCTION_BOOTSTRAP.md")
  // PRODUCT_IDENTITY 4-word doctrine must appear in bootstrap (asserted above)
  // CURRENT_PROBLEMS active items must appear in bootstrap (asserted above)
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTI-FABRICATION SENTINELS — phase-wide
// ─────────────────────────────────────────────────────────────────────────────
{
  // Reconstruction artifact must not contain marketing hype in non-forbidden contexts
  // (the FORBIDDEN section legitimately enumerates the forbidden words)
  // Check that bullish hype phrases like "revolutionary" or "magic" never appear
  notContains(bootstrapSrc, "revolutionary",
    "Anti-fabrication: GPT_RECONSTRUCTION_BOOTSTRAP contains NO marketing hype word 'revolutionary'")
  notContains(bootstrapSrc, "AI magic",
    "Anti-fabrication: GPT_RECONSTRUCTION_BOOTSTRAP contains NO marketing hype phrase 'AI magic'")
  // Deterministic — no Math.random or fetch references in the doc-as-state
  notContains(bootstrapSrc, "Math.random",
    "Anti-fabrication: GPT_RECONSTRUCTION_BOOTSTRAP describes NO Math.random behavior")
}

// ─────────────────────────────────────────────────────────────────────────────
// METADATA section present (versioning + drift quantification)
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(bootstrapSrc, "## METADATA",
    "GPT_RECONSTRUCTION_BOOTSTRAP has METADATA section")
  contains(bootstrapSrc, "Total approved phases",
    "METADATA section lists total approved phases")
  contains(bootstrapSrc, "Reconstruction surface",
    "METADATA section quantifies reconstruction surface (pre/post measurements)")
  contains(bootstrapSrc, "drift reduction",
    "METADATA section quantifies drift reduction percentage")
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Continuity-OS-1B — PORTABLE CROSS-CHAT RECONSTRUCTION ARTIFACT")
console.log("Single file consolidating 6-anchor chain for fresh GPT upload-and-continue")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`Required sections (10)   : § 1 IDENTITY · § 2 ACTIVE PHASE · § 3 STATE · § 4 BOTTLENECKS · § 5 FORBIDDEN · § 6 FE · § 7 OPS · § 8 DEFERRED · § 9 NEXT · § 10 INSTRUCTIONS`)
console.log(`Cross-file consistency   : active phase + identity 4-words + 3 layers + 5-status legend + 5 active bottlenecks + 12 forbidden + 6 deferred items`)
console.log(`Operational sync         : 4 canonical brain commands + TERM 1/2 conventions + audit-first doctrine`)
console.log(`Reconciliation wiring    : OPERATIONAL_FLOW REGENERATE-on-seal + BOOTSTRAP_PROMPT FASTEST PATH entry`)
console.log(`Size discipline          : 400-1200 line budget (operator-cemented ceiling)`)
console.log("")
console.log(`SUMMARY: ${passed} / ${total} assertions PASS`)
if (failed > 0) {
  console.log(`         ${failed} FAIL`)
  for (const f of failures) console.log(`           - ${f}`)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
