#!/usr/bin/env node
"use strict"

/**
 * runPersistenceProbes.js — Phase Persistence-1B (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/runPersistenceProbes.js
 *     npm run persistence:probe
 *
 * Runs the two Phase Persistence-1B probes and reports a unified verdict.
 * Each probe runs in isolated temp directories (no production-state risk).
 *
 * Exits 0 on all-PASS, non-zero on any failure.
 */

const path = require("path")
const { spawnSync } = require("child_process")

const REPO_ROOT = path.join(__dirname, "..", "..")

const probes = [
  { name: "probe_persistence_idempotency_v1", file: "probe_persistence_idempotency_v1.js" },
  { name: "probe_ledger_mirror_v1",          file: "probe_ledger_mirror_v1.js" },
]

let totalFail = 0
for (const p of probes) {
  console.log("\n╔" + "═".repeat(68) + "╗")
  console.log("║  " + p.name.padEnd(66) + "║")
  console.log("╚" + "═".repeat(68) + "╝")
  const r = spawnSync("node", [path.join(REPO_ROOT, p.file)], { stdio: "inherit" })
  if (r.status !== 0) {
    totalFail++
    console.log(`\n[runPersistenceProbes] ${p.name} FAILED (exit ${r.status})`)
  }
}

console.log("\n" + "─".repeat(70))
console.log(`SUMMARY: ${probes.length - totalFail}/${probes.length} probes PASS`)
console.log(`RESULT: ${totalFail === 0 ? "PASS" : "FAIL"}`)
process.exit(totalFail === 0 ? 0 : 1)
