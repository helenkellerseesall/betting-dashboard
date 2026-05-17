#!/usr/bin/env node
"use strict"

/**
 * ops:term2 — FULL historical Term 2 verification workflow.
 *
 * Phase Operational-Parity-1A (2026-05-17): restored to full historical
 * orchestration depth. The previous COS-1C ops:term2 wrapped only
 * `brain:bootstrap && brain:continuity && brain:verify` (3 steps, ~5s) —
 * severely under-wired vs the historical canonical Term 2 chain (~60s+)
 * which included verification telemetry + status helpers + ecology +
 * BNDS verifiers + brain governance.
 *
 * Historical Term 2 chain (canonical, per operator directive):
 *   1. Slate / market context read-only status (slate:refresh + market:status
 *      + slate:nba + slate:mlb + calibration:status + lineage:status)
 *   2. Runtime regression matrix (runtime:verify — 14 suites)
 *   3. Brain governance (brain:bootstrap + brain:continuity + brain:verify)
 *   4. Full helper-unit + probe matrix (every verify*.js + 5-probe canonical
 *      integrity matrix — invoked via runAllVerifiers.js orchestrator)
 *   5. Verification Telemetry V1 against live TERM 1 backend
 *      (runVerification.js --sport=all) — graceful degradation when TERM 1
 *      not reachable (the verification artifact + summary are skipped, the
 *      Term 2 chain still completes)
 *
 * Anti-fabrication doctrine:
 *   • Pure orchestrator. Invokes existing npm scripts + Node entry points.
 *   • Never modifies any state itself.
 *   • Status-only by default — mutations (settlement / grading) are
 *     intentionally EXCLUDED from Term 2 (they belong in ops:nightly with
 *     opt-in --settle flag).
 *   • Read-only behavior preserved: same canonical commands operator would
 *     run manually, just chained in canonical order with aggregated summary.
 *
 * Exit codes:
 *   0 — all required steps PASS (Verification Telemetry skipped is OK)
 *   1 — at least one REQUIRED step FAILED (failure list printed)
 *
 * Usage:
 *   node scripts/ops/runTerm2Workflow.js              # full chain, tolerates TERM 1 down
 *   node scripts/ops/runTerm2Workflow.js --strict     # require TERM 1 reachable
 *   node scripts/ops/runTerm2Workflow.js --quick      # skip slate status helpers (brain + verify + telemetry only)
 *
 * Provenance: Phase Operational-Parity-1A doctrine — wrappers MUST
 * preserve historical orchestration depth; never simplify away the
 * authoritative chain.
 */

const path         = require("path")
const http         = require("http")
const { execSync } = require("child_process")

const BACKEND = path.join(__dirname, "..", "..")
const REPO    = path.join(BACKEND, "..")
const SCRIPTS = path.join(BACKEND, "scripts")

const STRICT = process.argv.includes("--strict")
const QUICK  = process.argv.includes("--quick")

const RULE = "════════════════════════════════════════════════════════════════════"
const SUB  = "────────────────────────────────────────────────────────────────────"

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
  console.log(`▸ ${label} (optional — tolerates failure)`)
  console.log(`  $ ${cmd}`)
  try {
    execSync(cmd, { cwd: opts.cwd || BACKEND, stdio: "inherit" })
    console.log(`✓ ${label} PASS`)
    return { ok: true, required: false, label }
  } catch (e) {
    console.warn(`⚠ ${label} skipped/failed (exit ${e.status ?? "?"}) — non-fatal`)
    return { ok: false, required: false, label }
  }
}

function isTerm1Reachable(host = "http://localhost:4000") {
  return new Promise((resolve) => {
    const req = http.get(`${host}/api/ws/health`, (res) => {
      resolve(res.statusCode === 200)
      res.resume()
    })
    req.on("error", () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

const results = []

;(async () => {

// ── STEP 1 — Slate + market context status (read-only) ───────────────────────
if (!QUICK) {
  section("STEP 1 — SLATE + MARKET CONTEXT STATUS (read-only)")
  results.push(runRequired("market:status",      "npm run --silent market:status"))
  results.push(runOptional("calibration:status", "npm run --silent calibration:status"))
  results.push(runOptional("lineage:status",     "npm run --silent lineage:status"))
  results.push(runOptional("epoch:status",       "npm run --silent epoch:status"))
  // slate:refresh + slate:nba + slate:mlb are network-bound; treat as optional
  // (they hit upstream odds API + may fail in sandbox / offline environments)
  results.push(runOptional("slate:refresh",      "npm run --silent slate:refresh"))
  results.push(runOptional("slate:nba",          "npm run --silent slate:nba"))
  results.push(runOptional("slate:mlb",          "npm run --silent slate:mlb"))
} else {
  console.log("Skipping STEP 1 (slate + market context) per --quick flag.")
}

// ── STEP 2 — Brain governance pre-checks ────────────────────────────────────
section("STEP 2 — BRAIN GOVERNANCE (bootstrap + continuity + verify)")
results.push(runRequired("brain:bootstrap",  "npm run --silent brain:bootstrap"))
results.push(runRequired("brain:continuity", "npm run --silent brain:continuity"))
results.push(runRequired("brain:verify",     "npm run --silent brain:verify"))

// ── STEP 3 — Runtime regression matrix (14 suites) ──────────────────────────
section("STEP 3 — RUNTIME REGRESSION MATRIX (runtime:verify)")
results.push(runRequired("runtime:verify", "npm run --silent runtime:verify"))

// ── STEP 4 — Full helper-unit + probe matrix via runAllVerifiers ────────────
section("STEP 4 — HELPER-UNIT + PROBE MATRIX (ops:verify orchestrator)")
results.push(runRequired("ops:verify", "node " + path.join(SCRIPTS, "ops", "runAllVerifiers.js"), { cwd: REPO }))

// ── STEP 5 — Verification Telemetry V1 against live TERM 1 ──────────────────
section("STEP 5 — VERIFICATION TELEMETRY V1 (live TERM 1 probe)")
const term1Up = await isTerm1Reachable()
if (term1Up) {
  console.log("✓ TERM 1 backend reachable on port 4000 — running telemetry against live state")
  const runVerificationCmd = `node "${path.join(SCRIPTS, "runVerification.js")}" --sport=all --session=ops-term2`
  results.push(STRICT
    ? runRequired("runVerification --sport=all", runVerificationCmd, { cwd: REPO })
    : runOptional("runVerification --sport=all", runVerificationCmd, { cwd: REPO }))
} else {
  if (STRICT) {
    console.error("✗ TERM 1 backend NOT reachable on port 4000 — --strict flag requires TERM 1 up")
    results.push({ ok: false, required: true, label: "runVerification (TERM 1 unreachable, --strict)" })
  } else {
    console.warn("⚠ TERM 1 backend NOT reachable on port 4000 — skipping live telemetry (non-fatal without --strict)")
    console.warn("  To enable: start backend dev server then re-run ops:term2 (or use --strict)")
    results.push({ ok: true, required: false, label: "runVerification (skipped — TERM 1 down)" })
  }
}

// ── SUMMARY ─────────────────────────────────────────────────────────────────
section("ops:term2 SUMMARY")
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

})().catch((e) => {
  console.error("ops:term2 orchestrator error:", e)
  process.exit(1)
})
