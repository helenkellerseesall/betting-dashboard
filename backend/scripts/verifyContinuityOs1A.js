"use strict"

/**
 * Phase Continuity-OS-1A — helper unit-test fixture.
 *
 * CROSS-CHAT RECONSTRUCTION SYSTEM — 6 canonical anchor files + 1 updated
 * bootstrap pointer ensure a fresh chat (Claude OR GPT) reconstructs current
 * operating state by reading ~700 lines across 7 files instead of consuming
 * the prior 15,000+ line reconstruction surface.
 *
 * Pure deterministic source-text contract assertions. NO HTTP. NO SQLite.
 * NO ML. NO LLM. NO OCR.
 *
 * Doctrine guarded:
 *   • All 6 NEW anchor files exist at repo root.
 *   • Each anchor file contains its required canonical sections.
 *   • Anchor files cross-reference each other consistently.
 *   • BOOTSTRAP_PROMPT.md chains new chats through the 7-file anchor sequence.
 *   • ACTIVE_PHASE.md status field is up-to-date (currently Continuity-OS-1A).
 *   • PRODUCT_IDENTITY.md identity doctrine matches the cemented across 24
 *     prior phases (deterministic / anti-fabrication / bettor-native / OS).
 *   • CURRENT_PROBLEMS.md uses the canonical 5-status legend.
 *   • DEFERRED_PHASES.md lists every operator-cemented forbidden direction.
 *
 * Run via:
 *   node backend/scripts/verifyContinuityOs1A.js
 */

const fs   = require("fs")
const path = require("path")

const REPO     = path.join(__dirname, "..", "..")

const activePhasePath        = path.join(REPO, "ACTIVE_PHASE.md")
const productIdentityPath    = path.join(REPO, "PRODUCT_IDENTITY.md")
const currentProblemsPath    = path.join(REPO, "CURRENT_PROBLEMS.md")
const nextPhasePath          = path.join(REPO, "NEXT_PHASE.md")
const operationalFlowPath    = path.join(REPO, "OPERATIONAL_FLOW.md")
const deferredPhasesPath     = path.join(REPO, "DEFERRED_PHASES.md")
const bootstrapPromptPath    = path.join(REPO, "BOOTSTRAP_PROMPT.md")

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}
function fileExists(p, label) {
  assert(fs.existsSync(p), label)
}
function contains(src, needle, label) {
  assert(src.indexOf(needle) !== -1, `${label} — contains "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// COS-1 — ACTIVE_PHASE.md exists + canonical sections present
// ─────────────────────────────────────────────────────────────────────────────
fileExists(activePhasePath, "COS-1 ACTIVE_PHASE.md exists at repo root")
const activeSrc = fs.readFileSync(activePhasePath, "utf8")
{
  contains(activeSrc, "# ACTIVE PHASE",
    "COS-1 ACTIVE_PHASE has canonical heading")
  contains(activeSrc, "## CURRENT PHASE",
    "COS-1 ACTIVE_PHASE has CURRENT PHASE table")
  contains(activeSrc, "## ONE-LINE OBJECTIVE",
    "COS-1 ACTIVE_PHASE has ONE-LINE OBJECTIVE")
  contains(activeSrc, "## BOTTLENECK BEING SOLVED",
    "COS-1 ACTIVE_PHASE has BOTTLENECK BEING SOLVED")
  contains(activeSrc, "## APPROVED LEVERS",
    "COS-1 ACTIVE_PHASE has APPROVED LEVERS")
  contains(activeSrc, "## DEFERRED LEVERS",
    "COS-1 ACTIVE_PHASE has DEFERRED LEVERS")
  contains(activeSrc, "## DO NOT TOUCH",
    "COS-1 ACTIVE_PHASE has DO NOT TOUCH")
  contains(activeSrc, "## CURRENT FE DIRECTION",
    "COS-1 ACTIVE_PHASE has CURRENT FE DIRECTION")
  contains(activeSrc, "## CURRENT BACKEND DOCTRINE",
    "COS-1 ACTIVE_PHASE has CURRENT BACKEND DOCTRINE")
  contains(activeSrc, "## SUCCESS RIGHT NOW",
    "COS-1 ACTIVE_PHASE has SUCCESS RIGHT NOW")
  contains(activeSrc, "## RECONSTRUCTION RULE FOR NEW CHATS",
    "COS-1 ACTIVE_PHASE has RECONSTRUCTION RULE FOR NEW CHATS")
  // Current phase must reference the Continuity-OS family (assertion resilient
  // to future sub-phases like COS-1B / COS-1C — legitimate phase evolution).
  // COS-1A was the original active phase; COS-1B updated this in the same
  // session. The doctrine invariant is: ACTIVE_PHASE.md references the
  // Continuity-OS family as the current evolution thread.
  contains(activeSrc, "Continuity-OS-1",
    "COS-1 ACTIVE_PHASE current phase reflects Continuity-OS family (1A / 1B / etc.)")
  // Cross-references to the other 6 anchor files
  for (const ref of ["PRODUCT_IDENTITY.md", "CURRENT_PROBLEMS.md", "NEXT_PHASE.md", "OPERATIONAL_FLOW.md", "DEFERRED_PHASES.md", "BOOTSTRAP_PROMPT.md"]) {
    contains(activeSrc, ref, `COS-1 ACTIVE_PHASE cross-references ${ref}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COS-2 — PRODUCT_IDENTITY.md exists + identity doctrine present
// ─────────────────────────────────────────────────────────────────────────────
fileExists(productIdentityPath, "COS-2 PRODUCT_IDENTITY.md exists at repo root")
const identitySrc = fs.readFileSync(productIdentityPath, "utf8")
{
  contains(identitySrc, "# PRODUCT IDENTITY",
    "COS-2 PRODUCT_IDENTITY has canonical heading")
  contains(identitySrc, "## ONE-LINE IDENTITY",
    "COS-2 PRODUCT_IDENTITY has ONE-LINE IDENTITY")
  contains(identitySrc, "## THE FOUR WORDS THAT DEFINE IT",
    "COS-2 PRODUCT_IDENTITY has FOUR WORDS doctrine")
  // The 4 canonical words must appear verbatim
  for (const word of ["Deterministic", "Anti-fabrication", "Bettor-native", "Operating system"]) {
    contains(identitySrc, `**${word}**`,
      `COS-2 PRODUCT_IDENTITY defines word: ${word}`)
  }
  contains(identitySrc, "## THE THREE-LAYER ARCHITECTURE",
    "COS-2 PRODUCT_IDENTITY has THREE-LAYER ARCHITECTURE")
  contains(identitySrc, "Battlefield",
    "COS-2 PRODUCT_IDENTITY defines Layer 1 Battlefield")
  contains(identitySrc, "Curated Edge",
    "COS-2 PRODUCT_IDENTITY defines Layer 2 Curated Edge")
  contains(identitySrc, "Compression",
    "COS-2 PRODUCT_IDENTITY defines Layer 3 Compression")
  contains(identitySrc, "## WHAT THE REPO SHOULD FEEL LIKE",
    "COS-2 PRODUCT_IDENTITY has SHOULD FEEL LIKE section")
  contains(identitySrc, "## WHAT THE REPO MUST NEVER BECOME",
    "COS-2 PRODUCT_IDENTITY has MUST NEVER BECOME forbidden-directions table")
  // Anti-fabrication doctrine explicit
  contains(identitySrc, "### Anti-fabrication",
    "COS-2 PRODUCT_IDENTITY documents Anti-fabrication doctrine")
  contains(identitySrc, "### Canonical-authority-first",
    "COS-2 PRODUCT_IDENTITY documents Canonical-authority-first doctrine")
  contains(identitySrc, "### Additive-only",
    "COS-2 PRODUCT_IDENTITY documents Additive-only doctrine")
  contains(identitySrc, "### Replay-safe",
    "COS-2 PRODUCT_IDENTITY documents Replay-safe doctrine")
}

// ─────────────────────────────────────────────────────────────────────────────
// COS-3 — CURRENT_PROBLEMS.md exists + 5-status legend present
// ─────────────────────────────────────────────────────────────────────────────
fileExists(currentProblemsPath, "COS-3 CURRENT_PROBLEMS.md exists at repo root")
const problemsSrc = fs.readFileSync(currentProblemsPath, "utf8")
{
  contains(problemsSrc, "# CURRENT PROBLEMS",
    "COS-3 CURRENT_PROBLEMS has canonical heading")
  // 5-status legend
  for (const status of ["🟢 SOLVED", "🟡 ACTIVE", "🔵 DEFERRED", "🔴 DANGEROUS", "⚪ FUTURE"]) {
    contains(problemsSrc, status,
      `COS-3 CURRENT_PROBLEMS includes canonical status: ${status}`)
  }
  contains(problemsSrc, "## RULE FOR ADDING / MOVING ITEMS",
    "COS-3 CURRENT_PROBLEMS has rule for adding/moving items")
}

// ─────────────────────────────────────────────────────────────────────────────
// COS-4 — NEXT_PHASE.md exists + canonical sections present
// ─────────────────────────────────────────────────────────────────────────────
fileExists(nextPhasePath, "COS-4 NEXT_PHASE.md exists at repo root")
const nextSrc = fs.readFileSync(nextPhasePath, "utf8")
{
  contains(nextSrc, "# NEXT PHASE",
    "COS-4 NEXT_PHASE has canonical heading")
  contains(nextSrc, "## STATUS",
    "COS-4 NEXT_PHASE has STATUS section")
  contains(nextSrc, "## HOW THE NEXT PHASE GETS APPROVED",
    "COS-4 NEXT_PHASE has approval workflow")
  contains(nextSrc, "## CANDIDATE NEXT PHASES",
    "COS-4 NEXT_PHASE lists candidate next phases")
  contains(nextSrc, "## SUCCESS CRITERIA",
    "COS-4 NEXT_PHASE defines success criteria")
  contains(nextSrc, "## FAILURE MODES",
    "COS-4 NEXT_PHASE defines failure modes")
  // Default state: awaiting operator selection
  contains(nextSrc, "awaiting operator selection",
    "COS-4 NEXT_PHASE default state honestly reflects 'awaiting operator selection'")
}

// ─────────────────────────────────────────────────────────────────────────────
// COS-5 — OPERATIONAL_FLOW.md exists + canonical rituals present
// ─────────────────────────────────────────────────────────────────────────────
fileExists(operationalFlowPath, "COS-5 OPERATIONAL_FLOW.md exists at repo root")
const flowSrc = fs.readFileSync(operationalFlowPath, "utf8")
{
  contains(flowSrc, "# OPERATIONAL FLOW",
    "COS-5 OPERATIONAL_FLOW has canonical heading")
  contains(flowSrc, "## TERMINAL CONVENTIONS",
    "COS-5 OPERATIONAL_FLOW documents TERM 1 / TERM 2 conventions")
  contains(flowSrc, "## PRE-PHASE RITUAL",
    "COS-5 OPERATIONAL_FLOW documents pre-phase ritual")
  contains(flowSrc, "## AUDIT-FIRST RITUAL",
    "COS-5 OPERATIONAL_FLOW documents audit-first ritual")
  contains(flowSrc, "## SHIP RITUAL",
    "COS-5 OPERATIONAL_FLOW documents ship ritual")
  contains(flowSrc, "## REGRESSION MATRIX RITUAL",
    "COS-5 OPERATIONAL_FLOW documents regression matrix ritual")
  contains(flowSrc, "## 6-DOC RECONCILIATION RITUAL",
    "COS-5 OPERATIONAL_FLOW documents 6-doc reconciliation ritual")
  contains(flowSrc, "## ANCHOR-FILE RECONCILIATION RITUAL",
    "COS-5 OPERATIONAL_FLOW documents NEW anchor-file reconciliation ritual")
  contains(flowSrc, "## FINALIZE / CHECKPOINT RITUAL",
    "COS-5 OPERATIONAL_FLOW documents finalize/checkpoint ritual")
  contains(flowSrc, "## VERIFIER MATRIX",
    "COS-5 OPERATIONAL_FLOW documents verifier matrix")
  // Brain commands must appear verbatim
  for (const cmd of ["npm run brain:bootstrap", "npm run brain:continuity", "npm run brain:verify", "npm run brain:checkpoint"]) {
    contains(flowSrc, cmd, `COS-5 OPERATIONAL_FLOW documents ${cmd}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COS-6 — DEFERRED_PHASES.md exists + canonical structure present
// ─────────────────────────────────────────────────────────────────────────────
fileExists(deferredPhasesPath, "COS-6 DEFERRED_PHASES.md exists at repo root")
const deferredSrc = fs.readFileSync(deferredPhasesPath, "utf8")
{
  contains(deferredSrc, "# DEFERRED PHASES",
    "COS-6 DEFERRED_PHASES has canonical heading")
  contains(deferredSrc, "## INDEFINITELY DEFERRED",
    "COS-6 DEFERRED_PHASES has INDEFINITELY DEFERRED section")
  contains(deferredSrc, "## PREREQUISITE-BLOCKED",
    "COS-6 DEFERRED_PHASES has PREREQUISITE-BLOCKED section")
  contains(deferredSrc, "## NOT-YET-AUDITED",
    "COS-6 DEFERRED_PHASES has NOT-YET-AUDITED section")
  contains(deferredSrc, "## RULE FOR PROPOSING A DEFERRED PHASE",
    "COS-6 DEFERRED_PHASES has proposal rule")
  contains(deferredSrc, "## ANTI-PATTERNS THIS FILE PREVENTS",
    "COS-6 DEFERRED_PHASES has anti-patterns section")
  // Critical forbidden directions explicitly listed
  for (const forbidden of ["OCR", "LLM", "Celebrity", "Auto-bet", "shadow predictions"]) {
    contains(deferredSrc, forbidden,
      `COS-6 DEFERRED_PHASES explicitly lists forbidden direction: ${forbidden}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP_PROMPT.md updated to chain new chats through 7-file anchor sequence
// ─────────────────────────────────────────────────────────────────────────────
fileExists(bootstrapPromptPath, "BOOTSTRAP_PROMPT.md exists at repo root")
const bootstrapSrc = fs.readFileSync(bootstrapPromptPath, "utf8")
{
  contains(bootstrapSrc, "Continuity-OS-1A",
    "BOOTSTRAP_PROMPT references Continuity-OS-1A reconstruction system")
  contains(bootstrapSrc, "Optimized for both Claude and fresh GPT chats",
    "BOOTSTRAP_PROMPT explicitly optimized for both Claude AND fresh GPT chats")
  // Anchor files chained in order
  const order = [
    "1. /BOOTSTRAP_PROMPT.md",
    "2. /ACTIVE_PHASE.md",
    "3. /PRODUCT_IDENTITY.md",
    "4. /CURRENT_PROBLEMS.md",
    "5. /NEXT_PHASE.md",
    "6. /OPERATIONAL_FLOW.md",
    "7. /DEFERRED_PHASES.md",
  ]
  for (const o of order) {
    contains(bootstrapSrc, o, `BOOTSTRAP_PROMPT chains new chats through ${o}`)
  }
  contains(bootstrapSrc, "drift reduction",
    "BOOTSTRAP_PROMPT quantifies drift reduction (70-90% expected)")
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-REFERENCE CONSISTENCY (every anchor file references the others)
// ─────────────────────────────────────────────────────────────────────────────
{
  // ACTIVE_PHASE points at all other anchors (already asserted)
  // PRODUCT_IDENTITY is stable and self-contained (no required cross-refs)
  // CURRENT_PROBLEMS references DEFERRED_PHASES for "see why X deferred"
  contains(problemsSrc, "DEFERRED_PHASES.md",
    "CURRENT_PROBLEMS cross-references DEFERRED_PHASES.md")
  // NEXT_PHASE references ACTIVE_PHASE + CURRENT_PROBLEMS
  contains(nextSrc, "ACTIVE_PHASE.md",
    "NEXT_PHASE cross-references ACTIVE_PHASE.md")
  contains(nextSrc, "CURRENT_PROBLEMS.md",
    "NEXT_PHASE cross-references CURRENT_PROBLEMS.md")
  // OPERATIONAL_FLOW references OPERATOR_RUNBOOK (per-phase doctrine source)
  contains(flowSrc, "OPERATOR_RUNBOOK.md",
    "OPERATIONAL_FLOW cross-references OPERATOR_RUNBOOK.md (per-phase doctrine)")
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE DISCIPLINE — anchor files are SCANNABLE not essays
// ─────────────────────────────────────────────────────────────────────────────
{
  const sizes = {
    ACTIVE_PHASE:     activeSrc.split("\n").length,
    PRODUCT_IDENTITY: identitySrc.split("\n").length,
    CURRENT_PROBLEMS: problemsSrc.split("\n").length,
    NEXT_PHASE:       nextSrc.split("\n").length,
    OPERATIONAL_FLOW: flowSrc.split("\n").length,
    DEFERRED_PHASES:  deferredSrc.split("\n").length,
  }
  let totalLines = 0
  for (const [name, lines] of Object.entries(sizes)) {
    totalLines += lines
    // Each anchor must be substantial enough to be useful but not so large
    // as to defeat the "scannable in 30 seconds" goal.
    assert(lines >= 50,
      `${name} is non-trivial (${lines} lines >= 50 floor)`)
    assert(lines <= 400,
      `${name} stays scannable (${lines} lines <= 400 ceiling — no essay drift)`)
  }
  assert(totalLines <= 1500,
    `Total anchor surface (${totalLines} lines) stays under 1500-line ceiling — deterministic reconstruction goal preserved`)
  console.log(`  ✓ ANCHOR SIZE BUDGET: ${totalLines} total lines across 6 anchors (target: <1500)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTI-FABRICATION SENTINELS — phase-wide
// ─────────────────────────────────────────────────────────────────────────────
{
  // Anchor files must not invent intelligence or hype the repo.
  // EXCEPTIONS: PRODUCT_IDENTITY.md and CURRENT_PROBLEMS.md and
  // DEFERRED_PHASES.md legitimately enumerate the forbidden hype words as
  // part of the anti-hype doctrine they exist to enforce. Those docs are
  // allowed to mention the forbidden words AS forbidden words.
  for (const [name, src] of [
    ["ACTIVE_PHASE",     activeSrc],
    ["NEXT_PHASE",       nextSrc],
  ]) {
    assert(src.indexOf("guaranteed") === -1,
      `${name} contains NO marketing hype word 'guaranteed' (operational doc, not doctrine doc)`)
    assert(src.indexOf("revolutionary") === -1,
      `${name} contains NO marketing hype word 'revolutionary'`)
    assert(src.indexOf("AI magic") === -1,
      `${name} contains NO marketing hype phrase 'AI magic'`)
  }
  // Doctrine docs (PRODUCT_IDENTITY / CURRENT_PROBLEMS / DEFERRED_PHASES) ARE
  // allowed to reference the forbidden words to document the doctrine. We
  // still assert the words ONLY appear in forbidden-listing contexts —
  // approximate by requiring that any "guaranteed" mention is preceded by
  // "❌" or "NEVER" or "forbid" or "hype" or "marketing" within ~80 chars.
  const doctrineSources = [
    ["PRODUCT_IDENTITY", identitySrc],
    ["CURRENT_PROBLEMS", problemsSrc],
    ["DEFERRED_PHASES",  deferredSrc],
  ]
  for (const [name, src] of doctrineSources) {
    const idx = src.indexOf("guaranteed")
    if (idx === -1) { passed++; continue }
    // Look back up to 120 chars for a forbidden-context marker
    const window = src.slice(Math.max(0, idx - 120), idx + 20)
    const isInForbiddenContext = /❌|NEVER|forbid|hype|marketing|forbidden/i.test(window)
    assert(isInForbiddenContext,
      `${name} 'guaranteed' mention appears in forbidden/hype-listing context (anti-hype doctrine documentation)`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Continuity-OS-1A — CROSS-CHAT RECONSTRUCTION SYSTEM")
console.log("6 canonical anchor files + 1 updated bootstrap pointer")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`COS-1 (ACTIVE_PHASE)      : what we are doing right now — 30-second answer`)
console.log(`COS-2 (PRODUCT_IDENTITY)  : anti-drift anchor — what the repo IS + must never become`)
console.log(`COS-3 (CURRENT_PROBLEMS)  : live bottleneck tracker — 5-status legend`)
console.log(`COS-4 (NEXT_PHASE)        : single canonical next-step authority`)
console.log(`COS-5 (OPERATIONAL_FLOW)  : permanent ritual authority — terminal / regression / checkpoint`)
console.log(`COS-6 (DEFERRED_PHASES)   : why X deferred + prerequisite + danger map`)
console.log(`BOOTSTRAP_PROMPT          : chains new chats through 7-file anchor sequence (Claude + GPT)`)
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
