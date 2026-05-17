#!/usr/bin/env node
"use strict"

/**
 * ops:checkpoint — FULL historical canonical seal.
 *
 * Phase Operational-Parity-1A (2026-05-17): restored to full historical
 * orchestration depth. The previous COS-1C ops:checkpoint wrapped only
 * `brain:bootstrap && brain:continuity && brain:verify && brain:checkpoint`
 * (4 brain steps) — missing the historical git-checkpoint stages.
 *
 * Historical canonical checkpoint chain (per operator directive):
 *   1. ops:term2  → full Term 2 verification chain
 *      (slate context + brain governance + runtime regression + 28-verifier
 *      matrix + 5-probe canonical integrity matrix + live TERM 1 telemetry)
 *   2. checkpointRepo.js "<commit message>"  → sandbox-safe git checkpoint
 *      manifest preparer (writes .checkpoint/pending.json; NEVER touches
 *      .git/ — Claude/sandbox can prepare; finalizeCheckpoint.sh executes)
 *   3. finalizeCheckpoint.sh  → operator-finalized git commit using the
 *      prepared manifest (must run from macOS / non-sandbox terminal with
 *      .git write access; tolerated as optional under --sandbox flag)
 *   4. git push origin stable-nba-engine  → push the sealed commit
 *      (tolerated as optional; only runs if step 3 succeeded)
 *   5. brain:checkpoint  → continuity seal (3+3 doc + 14 verify + 5 probes;
 *      stamps receipt hash chain)
 *
 * The brain:checkpoint at step 5 is the canonical continuity authority.
 * Steps 2-4 are git-checkpoint (preserves history); step 5 is brain-checkpoint
 * (preserves operational receipt). Both are part of a "checkpoint" historically.
 *
 * Anti-fabrication doctrine:
 *   • Pure orchestrator. Invokes existing scripts in canonical order.
 *   • Git steps (2/3/4) are tolerated as optional in sandbox environments
 *     (Claude sandbox cannot unlink files under .git/ due to virtiofs
 *     permission limits — see checkpointRepo.js header). Operator running
 *     from macOS terminal gets full chain. Use --strict to require all
 *     steps PASS regardless of environment.
 *   • Default commit message includes phase + timestamp; operator can
 *     override via --message="..." or COMMIT_MSG env var.
 *
 * Usage:
 *   node scripts/ops/runCheckpointSeal.js                              # full chain, tolerant
 *   node scripts/ops/runCheckpointSeal.js --message="MY COMMIT MSG"    # custom commit message
 *   node scripts/ops/runCheckpointSeal.js --strict                     # require git steps
 *   node scripts/ops/runCheckpointSeal.js --skip-term2                 # skip pre-seal verification
 *   node scripts/ops/runCheckpointSeal.js --skip-push                  # skip git push
 *
 * Provenance: Phase Operational-Parity-1A doctrine — wrappers MUST
 * preserve historical orchestration depth; never simplify away the
 * authoritative chain.
 */

const path         = require("path")
const fs           = require("fs")
const { execSync } = require("child_process")

const BACKEND = path.join(__dirname, "..", "..")
const REPO    = path.join(BACKEND, "..")
const SCRIPTS = path.join(BACKEND, "scripts")

const STRICT     = process.argv.includes("--strict")
const SKIP_TERM2 = process.argv.includes("--skip-term2")
const SKIP_PUSH  = process.argv.includes("--skip-push")

let commitMessage = process.env.COMMIT_MSG ||
  `checkpoint via ops:checkpoint at ${new Date().toISOString()}`
const msgFlag = process.argv.find((a) => a.startsWith("--message="))
if (msgFlag) commitMessage = msgFlag.slice("--message=".length)

const RULE = "════════════════════════════════════════════════════════════════════"

function section(title) {
  console.log("")
  console.log(RULE)
  console.log(title)
  console.log(RULE)
}

function runRequired(label, cmd, opts = {}) {
  console.log(`▸ ${label}`)
  console.log(`  $ ${cmd}`)
  try {
    execSync(cmd, { cwd: opts.cwd || BACKEND, stdio: "inherit" })
    console.log(`✓ ${label} PASS`)
    return { ok: true, required: true, label }
  } catch (e) {
    console.error(`✗ ${label} FAILED (exit ${e.status ?? "?"})`)
    return { ok: false, required: true, label }
  }
}

function runOptional(label, cmd, opts = {}) {
  console.log(`▸ ${label} (optional — tolerates failure under non-strict)`)
  console.log(`  $ ${cmd}`)
  try {
    execSync(cmd, { cwd: opts.cwd || BACKEND, stdio: "inherit" })
    console.log(`✓ ${label} PASS`)
    return { ok: true, required: false, label }
  } catch (e) {
    if (STRICT) {
      console.error(`✗ ${label} FAILED (exit ${e.status ?? "?"}) — --strict flag treats as required failure`)
      return { ok: false, required: true, label }
    }
    console.warn(`⚠ ${label} skipped/failed (exit ${e.status ?? "?"}) — non-fatal without --strict`)
    return { ok: false, required: false, label }
  }
}

const results = []

// ── STAGE 1 — Pre-seal verification (ops:term2 full chain) ──────────────────
if (SKIP_TERM2) {
  section("STAGE 1 — PRE-SEAL VERIFICATION (skipped per --skip-term2)")
} else {
  section("STAGE 1 — PRE-SEAL VERIFICATION (ops:term2 full chain)")
  results.push(runRequired(
    "ops:term2 (full Term 2 verification chain)",
    `node "${path.join(SCRIPTS, "ops", "runTerm2Workflow.js")}"`,
    { cwd: REPO },
  ))
}

// ── STAGE 2 — Git checkpoint manifest preparer (sandbox-safe) ───────────────
section("STAGE 2 — CHECKPOINT REPO (sandbox-safe git manifest preparer)")
results.push(runOptional(
  "checkpointRepo.js (prepare git checkpoint manifest)",
  `node "${path.join(SCRIPTS, "checkpointRepo.js")}" ${JSON.stringify(commitMessage)}`,
  { cwd: REPO },
))

// ── STAGE 3 — finalizeCheckpoint.sh (operator macOS git commit) ─────────────
section("STAGE 3 — FINALIZE CHECKPOINT (macOS git commit)")
const pendingPath = path.join(REPO, ".checkpoint", "pending.json")
if (fs.existsSync(pendingPath)) {
  results.push(runOptional(
    "finalizeCheckpoint.sh (git add + commit using pending manifest)",
    `bash "${path.join(SCRIPTS, "finalizeCheckpoint.sh")}"`,
    { cwd: REPO },
  ))
} else {
  console.log(`⚠ no .checkpoint/pending.json — STAGE 2 must run first (or no changes to commit)`)
  results.push({ ok: true, required: false, label: "finalizeCheckpoint.sh (skipped — no pending manifest)" })
}

// ── STAGE 4 — git push origin stable-nba-engine ─────────────────────────────
if (SKIP_PUSH) {
  section("STAGE 4 — GIT PUSH (skipped per --skip-push)")
} else {
  section("STAGE 4 — GIT PUSH (origin stable-nba-engine)")
  results.push(runOptional(
    "git push origin stable-nba-engine",
    `git push origin stable-nba-engine`,
    { cwd: REPO },
  ))
}

// ── STAGE 5 — Brain continuity seal (canonical continuity authority) ────────
section("STAGE 5 — BRAIN CHECKPOINT (continuity seal)")
results.push(runRequired("brain:checkpoint (continuity seal)", "npm run --silent brain:checkpoint"))

// ── SUMMARY ─────────────────────────────────────────────────────────────────
section("ops:checkpoint SUMMARY")
const required = results.filter((r) => r.required)
const optional = results.filter((r) => !r.required)
const failedRequired = required.filter((r) => !r.ok)
const failedOptional = optional.filter((r) => !r.ok)
console.log(`Required steps:  ${required.length} · PASS: ${required.length - failedRequired.length} · FAIL: ${failedRequired.length}`)
console.log(`Optional steps:  ${optional.length} · PASS: ${optional.length - failedOptional.length} · SKIPPED/FAIL: ${failedOptional.length}`)
if (failedRequired.length > 0) {
  console.log("")
  console.log("Required failures:")
  for (const f of failedRequired) console.log(`  ✗ ${f.label}`)
  console.log("")
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("")
console.log("RESULT: PASS")
process.exit(0)
