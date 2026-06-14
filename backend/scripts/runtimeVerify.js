#!/usr/bin/env node
"use strict"

/**
 * runtimeVerify.js — Phase Operator-Operations-1 (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/runtimeVerify.js
 *     npm run runtime:verify
 *
 * Canonical operator entrypoint to run the 14-suite regression matrix
 * with operator-friendly summary. Replaces the embedded shell `for f in ...`
 * loop from NEXT_SESSION.md.
 *
 * For each verify*.js script:
 *   - prints a status line
 *   - captures exit code
 *   - reports PASS/FAIL
 *
 * Final summary: N/14 PASS + overall verdict.
 *
 * Pure observability — runs the same scripts the existing
 * `npm run brain:checkpoint` matrix invokes. Exits 0 on all-PASS,
 * non-zero on any failure.
 */

const path = require("path")
const { spawnSync } = require("child_process")

// 2026-05-31 Phase ESPN-Enrichment-1A — retired 3 obsolete F-series fixtures
// that asserted on Owner-B API-Sports instrumentation (dead since 2026-05-26
// when operator killed api-basketball subscription). Owner-B helpers are now
// @orphan-marked per Law 11 in nbaIsolatedRoutes.js. Replacement fixture
// `verifyNbaEspnEnrichment` asserts on the live ESPN canonical path.
// Retired (preserved verbatim under additive-only doctrine — fixture files
// stay on disk for archaeology, just not in the matrix):
//   verifyNbaApiSportsContractFix  (Phase F5/F5-A/F5-B/F5-C/F6/F6.3)
//   verifyNbaCacheObservability    (Phase F2)
//   verifyNbaCacheabilityGate      (Phase F3)
const SUITES = [
  "verifyCalibrationHonesty",
  "verifyCompositeKeyIntegrity",
  "verifyLegacyApiSportsCacheGate",
  "verifyMlbContextualPhase1",
  "verifyMlbContextualPhase1B",
  "verifyMlbFutureOnlyHardening",
  "verifyMlbImmutabilityHardening",
  "verifyMlbLiveStatePhase2",
  "verifyNbaEspnEnrichment",
  "verifyOrphanAuthorityHardening",
  "verifyResponseAuthority",
  "verifySnapshotFreshness",
  "verifySlateGamesControl",   // Phase Status-CLV-Display-Honesty-1A — /status never lies "no games" while games happened
  "verifyMlbTierPolicyR2",     // R2 mlb-r2-v1 (2026-06-11) — badge caps + kill-switch byte-identity + tierPolicy stamp
  "verifyNbLadderStep1",       // T2-L1 mlb-nb-ladder-v1 (2026-06-12) — NB shadow ladder math + freeze guard (scoring never reads ladderNB)
  "verifySeasonGate",          // Season-Switch-1A (2026-06-14) — per-sport ON/OFF gate: fresh-read, fail-open, slate-gate-before-call, scheduler 6NBA/3MLB gated + grading/settlement/audit ungated
  "verifyCorrelation",         // T2-Correlation-1A (2026-06-14) — Gaussian copula joint prob: sign BOTH ways, Φ₂ closed-form anchors, kill-switch, freeze guard (scoring never references correlation)
]

function pad(s, n) { return String(s).padEnd(n) }

function main() {
  const t0 = Date.now()
  console.log("=== runtime:verify — Phase Operator-Operations-1 ===")
  console.log(`Running ${SUITES.length} regression suites.\n`)

  const results = []
  for (const name of SUITES) {
    const fp = path.join(__dirname, `${name}.js`)
    const tStart = Date.now()
    const r = spawnSync("node", [fp], { encoding: "utf8" })
    const ms = Date.now() - tStart
    const ok = r.status === 0
    results.push({ name, ok, status: r.status, ms })
    const verdict = ok ? "PASS" : "FAIL"
    console.log(`  ${pad(name, 38)} ${pad(verdict, 6)} (exit=${r.status ?? "?"}, ${ms}ms)`)
    if (!ok && r.stderr) {
      const last = r.stderr.split("\n").filter(Boolean).slice(-3).join("\n      ")
      console.log("      stderr tail: " + last)
    }
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  const totalMs = Date.now() - t0

  console.log("")
  console.log("─".repeat(70))
  console.log(`SUMMARY: ${passed}/${results.length} PASS  (${totalMs}ms total)`)
  console.log(`RESULT:  ${failed === 0 ? "PASS" : "FAIL"}`)
  if (failed > 0) {
    console.log("\nFailed suites:")
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name} (exit=${r.status})`)
    }
  }
  process.exit(failed === 0 ? 0 : 1)
}

main()
