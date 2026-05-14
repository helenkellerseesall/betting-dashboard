#!/usr/bin/env node
"use strict"

/**
 * BRAIN CONTINUITY ASSESSMENT — autonomous drift detector.
 *
 *   node backend/scripts/brain/assessContinuity.js
 *   npm run brain:continuity
 *
 * Reads `.brain_bootstrap_state.json` and compares against the current state
 * of brain docs + runtime code (SHA-256 file hashes). Reports:
 *
 *   - Whether the bootstrap receipt exists.
 *   - How long ago `npm run brain:bootstrap` was last run.
 *   - Whether runtime code has changed since that bootstrap.
 *   - Whether brain docs have changed since that bootstrap.
 *   - Whether a passing `npm run brain:checkpoint` has reconciled the receipt.
 *
 * Exit code: 0 if continuity intact, 1 if any hard `issues` raised.
 * WARNs do not fail.
 *
 * Threshold knobs (env vars, defaults shown):
 *   BRAIN_BOOTSTRAP_WARN_MINUTES        480   (8h)
 *   BRAIN_BOOTSTRAP_FAIL_MINUTES        10080 (7d)
 *   BRAIN_RUNTIME_LAG_FAIL_MINUTES      60    (1h)
 */

const lib = require("./_brainLib")

function run() {
  console.log("╔" + "═".repeat(68) + "╗")
  console.log("║  BRAIN CONTINUITY ASSESSMENT                                        ║")
  console.log("╚" + "═".repeat(68) + "╝")

  const a = lib.assessContinuity()

  console.log("")
  console.log("RECEIPT")
  console.log("───────")
  if (!a.receiptPresent) {
    console.log("  (none — bootstrap has never been run on this clone)")
  } else {
    const r = a.receipt
    console.log("  file               : " + lib.BOOTSTRAP_RECEIPT_PATH.replace(lib.REPO_ROOT + "/", ""))
    console.log("  lastBootstrapAt    : " + (r.lastBootstrapAt || "—") +
      (Number.isFinite(a.bootstrapAgeMinutes) ? `  (${a.bootstrapAgeMinutes} min ago)` : ""))
    console.log("  lastBootstrapId    : " + (r.lastBootstrapSessionId || "—"))
    console.log("  lastCheckpointAt   : " + (r.lastCheckpointAt || "—") +
      (Number.isFinite(a.checkpointAgeMinutes) ? `  (${a.checkpointAgeMinutes} min ago)` : ""))
    console.log("  lastCheckpointResult: " + (r.lastCheckpointResult || "—"))
  }

  console.log("")
  console.log("CURRENT vs BOOTSTRAP HASHES")
  console.log("───────────────────────────")
  console.log("  brain docs (now)        : " + a.currentBrainHash.slice(0, 32) + "…")
  console.log("  brain docs (@bootstrap) : " + ((a.receipt && a.receipt.brainDocHashAtBootstrap) || "—").slice(0, 32) + (a.receipt && a.receipt.brainDocHashAtBootstrap ? "…" : ""))
  console.log("  runtime  (now)          : " + a.currentRuntimeHash.slice(0, 32) + "…")
  console.log("  runtime  (@bootstrap)   : " + ((a.receipt && a.receipt.runtimeCodeHashAtBootstrap) || "—").slice(0, 32) + (a.receipt && a.receipt.runtimeCodeHashAtBootstrap ? "…" : ""))
  console.log("  runtime  (@checkpoint)  : " + ((a.receipt && a.receipt.runtimeCodeHashAtCheckpoint) || "—").slice(0, 32) + (a.receipt && a.receipt.runtimeCodeHashAtCheckpoint ? "…" : ""))

  console.log("")
  console.log("THRESHOLDS (env-tunable)")
  console.log("────────────────────────")
  console.log("  WARN_MINUTES (bootstrap age) : " + lib.CONTINUITY_BOOTSTRAP_WARN_MINUTES)
  console.log("  FAIL_MINUTES (bootstrap age) : " + lib.CONTINUITY_BOOTSTRAP_FAIL_MINUTES)
  console.log("  RUNTIME_LAG_FAIL_MINUTES     : " + lib.CONTINUITY_RUNTIME_LAG_FAIL_MINUTES)

  console.log("")
  console.log("ASSESSMENT")
  console.log("──────────")
  if (a.warnings.length === 0 && a.issues.length === 0) {
    console.log("  OK — continuity intact")
  }
  for (const w of a.warnings) console.log("  WARN — [" + w.code + "] " + w.message)
  for (const i of a.issues)   console.log("  FAIL — [" + i.code + "] " + i.message)

  console.log("")
  console.log(`RESULT: ${a.issues.length === 0 ? "PASS" : "FAIL"}  (${a.issues.length} issue, ${a.warnings.length} warn)`)
  if (a.issues.length > 0) process.exitCode = 1
}

run()
