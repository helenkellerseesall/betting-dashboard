#!/usr/bin/env node
"use strict"

/**
 * ops:nightly — canonical nightly review orchestrator
 *
 * Single-command chain of the existing nightly status helpers + settlement
 * run. Replaces the implicit 4-step manual sequence:
 *
 *   npm run grading:status
 *   npm run calibration:status
 *   npm run lineage:status
 *   npm run settlement:run
 *
 * Pure orchestrator — each underlying script is invoked verbatim; their
 * behavior + output preserved. ops:nightly only adds canonical
 * sectioning + final summary.
 *
 * Read-only by default; pass `--settle` to ALSO run settlement:run
 * (settlement:run is mutation-capable so it's opt-in to avoid surprise
 * mutation during a pure status pass).
 *
 * Usage:
 *   node scripts/ops/runNightlyReview.js               # status-only
 *   node scripts/ops/runNightlyReview.js --settle      # also run settlement:run
 *
 * Shipped Continuity-OS-1C (2026-05-17) — operator-cemented canonical ops layer.
 */

const path         = require("path")
const { execSync } = require("child_process")

const BACKEND = path.join(__dirname, "..", "..")
const SETTLE  = process.argv.includes("--settle")

const RULE = "════════════════════════════════════════════════════════════════════"

function section(title) {
  console.log("")
  console.log(RULE)
  console.log(title)
  console.log(RULE)
}

function runStep(label, npmScript) {
  console.log(`▸ ${label} — npm run --silent ${npmScript}`)
  try {
    execSync(`npm run --silent ${npmScript}`, { cwd: BACKEND, stdio: "inherit" })
    return true
  } catch (e) {
    console.error(`✗ ${label} FAILED (exit ${e.status ?? "?"})`)
    return false
  }
}

const results = []

section("STEP 1 — GRADING STATUS")
results.push(["grading:status", runStep("grading:status", "grading:status")])

section("STEP 2 — CALIBRATION STATUS")
results.push(["calibration:status", runStep("calibration:status", "calibration:status")])

section("STEP 3 — LINEAGE STATUS")
results.push(["lineage:status", runStep("lineage:status", "lineage:status")])

if (SETTLE) {
  section("STEP 4 — SETTLEMENT RUN (--settle)")
  results.push(["settlement:run", runStep("settlement:run", "settlement:run")])
} else {
  section("STEP 4 — SETTLEMENT RUN (SKIPPED — pass --settle to enable)")
  console.log("Skipped. settlement:run is mutation-capable; opt-in only.")
  console.log("To include settlement: node scripts/ops/runNightlyReview.js --settle")
}

section("ops:nightly SUMMARY")
const failed = results.filter(([_, ok]) => !ok)
console.log(`Total steps: ${results.length} · PASS: ${results.length - failed.length} · FAIL: ${failed.length}`)
if (failed.length > 0) {
  for (const [label, _] of failed) console.log(`  ✗ ${label}`)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
