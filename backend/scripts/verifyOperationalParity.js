"use strict"

/**
 * Phase Operational-Parity-1A — verifyOperationalParity.js
 *
 * CANONICAL OPERATIONAL PARITY ENFORCER.
 *
 * Asserts that the `npm run ops:*` canonical layer preserves the FULL
 * historical orchestration depth — never simplifies away the authoritative
 * workflow.
 *
 * Doctrine (operator-cemented):
 *   "Canonical ops commands are WRAPPERS around historical authoritative
 *    workflows. Behavior parity is mandatory. Operational compression must
 *    NEVER reduce orchestration depth."
 *
 * Asserts:
 *   1. All 6 canonical ops:* scripts exist (ops:term1 / ops:term2 /
 *      ops:continuity / ops:verify / ops:checkpoint / ops:state / ops:nightly).
 *   2. ops:term2 invokes runTerm2Workflow.js (the full historical-depth
 *      orchestrator) — NOT a shallow inline 3-step chain.
 *   3. runTerm2Workflow.js chains the FULL historical depth:
 *        • brain governance (bootstrap + continuity + verify)
 *        • runtime regression matrix (runtime:verify — 14 suites)
 *        • full helper-unit + probe matrix (ops:verify orchestrator)
 *        • Verification Telemetry V1 (runVerification.js live TERM 1 probe)
 *        • slate / market / lineage / calibration / epoch status checks
 *      Each must appear in the orchestrator source.
 *   4. ops:checkpoint invokes runCheckpointSeal.js (the full seal chain)
 *      — NOT a shallow inline 4-brain-step chain.
 *   5. runCheckpointSeal.js chains the FULL historical seal depth:
 *        • Pre-seal verification (ops:term2 / runTerm2Workflow.js)
 *        • Git checkpoint manifest preparer (checkpointRepo.js)
 *        • Git commit finalizer (finalizeCheckpoint.sh)
 *        • Git push (git push origin stable-nba-engine)
 *        • Continuity seal (brain:checkpoint)
 *      Each must appear in the orchestrator source.
 *   6. ops:term1 invokes showTerm1Status.js (TERM 1 health introspection).
 *      MUST NOT auto-start / restart TERM 1 (operator-cemented invariant
 *      from WORKFLOW_RULES.md + BOOTSTRAP_PROMPT.md).
 *   7. Doctrine docs (OPERATIONAL_FLOW + GPT_RECONSTRUCTION_BOOTSTRAP +
 *      OPERATOR_RUNBOOK) explicitly state "wrappers must preserve
 *      historical orchestration depth" doctrine.
 *   8. Operational parity audit doc exists at
 *      docs/OPERATIONAL_PARITY_AUDIT.md.
 *
 * Pure deterministic source-text contract. NO HTTP. NO SQLite. NO ML.
 *
 * Run via:
 *   node backend/scripts/verifyOperationalParity.js
 *
 * Or via canonical ops layer (this verifier runs in the 28-verifier matrix):
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const OPS_DIR = path.join(BACKEND, "scripts", "ops")

const packageJsonPath          = path.join(BACKEND, "package.json")
const runTerm2WorkflowPath     = path.join(OPS_DIR, "runTerm2Workflow.js")
const runCheckpointSealPath    = path.join(OPS_DIR, "runCheckpointSeal.js")
const showTerm1StatusPath      = path.join(OPS_DIR, "showTerm1Status.js")
const runAllVerifiersPath      = path.join(OPS_DIR, "runAllVerifiers.js")
const checkpointRepoPath       = path.join(BACKEND, "scripts", "checkpointRepo.js")
const finalizeCheckpointShPath = path.join(BACKEND, "scripts", "finalizeCheckpoint.sh")
const runVerificationPath      = path.join(BACKEND, "scripts", "runVerification.js")

const operationalFlowPath      = path.join(REPO, "OPERATIONAL_FLOW.md")
const gptReconstructionPath    = path.join(REPO, "GPT_RECONSTRUCTION_BOOTSTRAP.md")
const operatorRunbookPath      = path.join(REPO, "docs", "OPERATOR_RUNBOOK.md")
const parityAuditPath          = path.join(REPO, "docs", "OPERATIONAL_PARITY_AUDIT.md")

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
function notContains(src, needle, label) {
  assert(src.indexOf(needle) === -1, `${label} — does NOT contain "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. All 6 canonical ops:* scripts present + correct invocations
// ─────────────────────────────────────────────────────────────────────────────
{
  assert(fs.existsSync(packageJsonPath), "backend/package.json exists")
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
  const scripts = pkg.scripts || {}
  const required = {
    "ops:term1":      "showTerm1Status.js",
    "ops:term2":      "runTerm2Workflow.js",
    "ops:continuity": "brain:continuity",
    "ops:verify":     "runAllVerifiers.js",
    "ops:checkpoint": "runCheckpointSeal.js",
    "ops:state":      "showState.js",
    "ops:nightly":    "runNightlyReview.js",
  }
  for (const [opsScript, marker] of Object.entries(required)) {
    assert(typeof scripts[opsScript] === "string" && scripts[opsScript].includes(marker),
      `Canonical ${opsScript} invokes expected entry-point (${marker})`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ops:term2 invokes the FULL historical-depth orchestrator
// ─────────────────────────────────────────────────────────────────────────────
fileExists(runTerm2WorkflowPath,
  "Orchestrator exists: backend/scripts/ops/runTerm2Workflow.js")
const term2Src = fs.readFileSync(runTerm2WorkflowPath, "utf8")
{
  contains(term2Src, `"use strict"`,                  "runTerm2Workflow.js uses strict mode")
  contains(term2Src, "Operational-Parity-1A",         "runTerm2Workflow.js cites Operational-Parity-1A provenance")
  contains(term2Src, "historical orchestration",      "runTerm2Workflow.js cites historical-orchestration doctrine")
  // FULL historical depth — every required step present in source
  contains(term2Src, "brain:bootstrap",               "runTerm2Workflow chains brain:bootstrap")
  contains(term2Src, "brain:continuity",              "runTerm2Workflow chains brain:continuity")
  contains(term2Src, "brain:verify",                  "runTerm2Workflow chains brain:verify")
  contains(term2Src, "runtime:verify",                "runTerm2Workflow chains runtime:verify (14-suite matrix)")
  contains(term2Src, "runAllVerifiers.js",            "runTerm2Workflow chains runAllVerifiers (helper unit + probe matrix)")
  contains(term2Src, "runVerification.js",            "runTerm2Workflow chains runVerification.js (Verification Telemetry V1)")
  contains(term2Src, "market:status",                 "runTerm2Workflow chains market:status")
  contains(term2Src, "calibration:status",            "runTerm2Workflow chains calibration:status")
  contains(term2Src, "lineage:status",                "runTerm2Workflow chains lineage:status")
  contains(term2Src, "epoch:status",                  "runTerm2Workflow chains epoch:status")
  contains(term2Src, "slate:refresh",                 "runTerm2Workflow chains slate:refresh")
  contains(term2Src, "slate:nba",                     "runTerm2Workflow chains slate:nba")
  contains(term2Src, "slate:mlb",                     "runTerm2Workflow chains slate:mlb")
  // Anti-fabrication: no openai / tesseract / vision
  notContains(term2Src, "openai",   "runTerm2Workflow does NOT import openai")
  notContains(term2Src, "tesseract","runTerm2Workflow does NOT import tesseract")
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ops:checkpoint invokes the FULL historical-seal orchestrator
// ─────────────────────────────────────────────────────────────────────────────
fileExists(runCheckpointSealPath,
  "Orchestrator exists: backend/scripts/ops/runCheckpointSeal.js")
const sealSrc = fs.readFileSync(runCheckpointSealPath, "utf8")
{
  contains(sealSrc, `"use strict"`,            "runCheckpointSeal.js uses strict mode")
  contains(sealSrc, "Operational-Parity-1A",   "runCheckpointSeal.js cites Operational-Parity-1A provenance")
  contains(sealSrc, "historical orchestration","runCheckpointSeal.js cites historical-orchestration doctrine")
  // STAGE 1 — Pre-seal verification (ops:term2 / runTerm2Workflow.js)
  contains(sealSrc, "runTerm2Workflow.js",     "runCheckpointSeal chains pre-seal verification (runTerm2Workflow.js)")
  // STAGE 2 — Git checkpoint manifest preparer
  contains(sealSrc, "checkpointRepo.js",       "runCheckpointSeal chains checkpointRepo.js (git manifest preparer)")
  // STAGE 3 — Git commit finalizer
  contains(sealSrc, "finalizeCheckpoint.sh",   "runCheckpointSeal chains finalizeCheckpoint.sh (macOS git commit)")
  // STAGE 4 — Git push
  contains(sealSrc, "git push origin stable-nba-engine",
    "runCheckpointSeal chains git push origin stable-nba-engine")
  // STAGE 5 — Continuity seal
  contains(sealSrc, "brain:checkpoint",        "runCheckpointSeal chains brain:checkpoint (continuity seal)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Required upstream scripts exist (sealed historical authority)
// ─────────────────────────────────────────────────────────────────────────────
{
  fileExists(checkpointRepoPath,       "Historical: backend/scripts/checkpointRepo.js exists (sandbox-safe git manifest preparer)")
  fileExists(finalizeCheckpointShPath, "Historical: backend/scripts/finalizeCheckpoint.sh exists (macOS git commit finalizer)")
  fileExists(runVerificationPath,      "Historical: backend/scripts/runVerification.js exists (Verification Telemetry V1)")
  fileExists(runAllVerifiersPath,      "COS-1C: backend/scripts/ops/runAllVerifiers.js exists (helper-unit + probe orchestrator)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ops:term1 invariant — never auto-starts / restarts TERM 1
// ─────────────────────────────────────────────────────────────────────────────
fileExists(showTerm1StatusPath, "Orchestrator exists: backend/scripts/ops/showTerm1Status.js")
const term1Src = fs.readFileSync(showTerm1StatusPath, "utf8")
{
  contains(term1Src, `"use strict"`,             "showTerm1Status.js uses strict mode")
  contains(term1Src, "Operational-Parity-1A",    "showTerm1Status.js cites Operational-Parity-1A provenance")
  contains(term1Src, "NEVER auto-starts",        "showTerm1Status.js cites NEVER-auto-start invariant in doctrine comment")
  // MUST NOT contain engine:start / engine:restart invocations (read-only)
  notContains(term1Src, `execSync("npm run engine:start"`,
    "showTerm1Status.js does NOT auto-start TERM 1 (operator-cemented invariant)")
  notContains(term1Src, `execSync("npm run engine:restart"`,
    "showTerm1Status.js does NOT auto-restart TERM 1 (operator-cemented invariant)")
  notContains(term1Src, `execSync('npm run engine:start'`,
    "showTerm1Status.js does NOT auto-start TERM 1 (single-quote variant)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Doctrine docs state parity doctrine explicitly
// ─────────────────────────────────────────────────────────────────────────────
const operationalFlowSrc   = fs.readFileSync(operationalFlowPath, "utf8")
const gptReconstructionSrc = fs.readFileSync(gptReconstructionPath, "utf8")
const operatorRunbookSrc   = fs.readFileSync(operatorRunbookPath, "utf8")

const PARITY_DOCS = [
  ["OPERATIONAL_FLOW.md",             operationalFlowSrc],
  ["GPT_RECONSTRUCTION_BOOTSTRAP.md", gptReconstructionSrc],
  ["docs/OPERATOR_RUNBOOK.md",        operatorRunbookSrc],
]
for (const [name, src] of PARITY_DOCS) {
  contains(src, "Operational-Parity-1A",
    `${name} cites Operational-Parity-1A doctrine`)
  contains(src, "historical orchestration depth",
    `${name} states "historical orchestration depth" doctrine string`)
  contains(src, "WRAPPERS",
    `${name} explicitly names canonical ops commands as WRAPPERS (parity language)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Operational parity audit doc exists
// ─────────────────────────────────────────────────────────────────────────────
{
  fileExists(parityAuditPath, "docs/OPERATIONAL_PARITY_AUDIT.md exists")
  const auditSrc = fs.readFileSync(parityAuditPath, "utf8")
  contains(auditSrc, "Operational-Parity-1A", "Audit doc cites Operational-Parity-1A")
  contains(auditSrc, "Term 2",                "Audit doc references historical Term 2")
  contains(auditSrc, "parity",                "Audit doc uses 'parity' terminology")
  contains(auditSrc, "checkpointRepo",        "Audit doc references checkpointRepo.js historical authority")
  contains(auditSrc, "finalizeCheckpoint",    "Audit doc references finalizeCheckpoint.sh historical authority")
  contains(auditSrc, "runVerification",       "Audit doc references runVerification.js Verification Telemetry V1")
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Anti-regression — historical authoritative scripts preserved verbatim
// ─────────────────────────────────────────────────────────────────────────────
{
  const cpRepoSrc = fs.readFileSync(checkpointRepoPath, "utf8")
  contains(cpRepoSrc, "Sandbox-safe checkpoint",
    "checkpointRepo.js preserves Session K sandbox-safe doctrine")
  contains(cpRepoSrc, ".checkpoint/pending.json",
    "checkpointRepo.js preserves canonical pending manifest path")

  const finSrc = fs.readFileSync(finalizeCheckpointShPath, "utf8")
  contains(finSrc, "finalizeCheckpoint.sh",
    "finalizeCheckpoint.sh header preserved")
  contains(finSrc, "STALE_THRESHOLD",
    "finalizeCheckpoint.sh preserves stale-lock detection doctrine")

  const runVSrc = fs.readFileSync(runVerificationPath, "utf8")
  contains(runVSrc, "Verification Telemetry V1",
    "runVerification.js preserves Verification Telemetry V1 provenance")
  contains(runVSrc, "--sport=",
    "runVerification.js preserves --sport flag interface")
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Operational-Parity-1A — CANONICAL OPERATIONAL PARITY ENFORCER")
console.log("Wrappers MUST preserve full historical orchestration depth")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`ops:term1     : showTerm1Status.js (read-only TERM 1 health; NEVER auto-starts)`)
console.log(`ops:term2     : runTerm2Workflow.js chains FULL historical depth (brain governance + runtime:verify + ops:verify + Verification Telemetry V1 + status helpers)`)
console.log(`ops:checkpoint: runCheckpointSeal.js chains FULL historical seal (ops:term2 + checkpointRepo + finalizeCheckpoint + git push + brain:checkpoint)`)
console.log(`Historical scripts preserved: checkpointRepo.js / finalizeCheckpoint.sh / runVerification.js`)
console.log(`Doctrine docs: 3 canonical docs cite Operational-Parity-1A + "historical orchestration depth" + "WRAPPERS"`)
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
