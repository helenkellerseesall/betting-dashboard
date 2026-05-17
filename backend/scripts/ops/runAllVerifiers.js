#!/usr/bin/env node
"use strict"

/**
 * ops:verify — canonical regression matrix orchestrator
 *
 * Single-command replacement for the legacy inline chains documented across
 * BOOTSTRAP_PROMPT / OPERATIONAL_FLOW / GPT_RECONSTRUCTION_BOOTSTRAP:
 *
 *   for f in backend/scripts/verify*.js; do node "$f" | tail -1; done
 *   for p in probe_*_v1.js; do node "$p" | tail -2; done
 *   cd backend && npm run runtime:verify
 *
 * Combined into one canonical operation. No behavior change — every
 * verifier + every probe + the 14-suite runtime:verify run sequentially
 * and their results are aggregated.
 *
 * Exit codes:
 *   0 — every verifier + probe + runtime suite PASS
 *   1 — at least one FAIL (failure list printed at bottom)
 *
 * Shipped Continuity-OS-1C (2026-05-17) — operator-cemented canonical ops layer.
 */

const fs           = require("fs")
const path         = require("path")
const { execSync } = require("child_process")

const REPO    = path.join(__dirname, "..", "..", "..")
const BACKEND = path.join(REPO, "backend")
const SCRIPTS = path.join(BACKEND, "scripts")

const HARD_RULE  = "════════════════════════════════════════════════════════════════════"
const SOFT_RULE  = "────────────────────────────────────────────────────────────────────"

function header(title) {
  console.log("")
  console.log(HARD_RULE)
  console.log(title)
  console.log(HARD_RULE)
}

function runCmd(label, cmd, opts = {}) {
  let stdout = ""
  let stderr = ""
  let ok     = true
  try {
    stdout = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts })
  } catch (e) {
    ok     = false
    stdout = e.stdout ? e.stdout.toString() : ""
    stderr = e.stderr ? e.stderr.toString() : (e.message || "")
  }
  return { label, ok, stdout, stderr }
}

const results = []

// ── 1. 14-suite runtime:verify ──────────────────────────────────────────────
header("STEP 1 — RUNTIME:VERIFY (14-suite regression)")
{
  const r = runCmd("runtime:verify", "npm run --silent runtime:verify", { cwd: BACKEND })
  // Print the final result lines for operator visibility
  const tail = r.stdout.split("\n").slice(-8).join("\n")
  console.log(tail)
  results.push(r)
}

// ── 2. Every verify*.js helper unit ─────────────────────────────────────────
header("STEP 2 — verify*.js HELPER UNIT SUITE")
const verifiers = fs.readdirSync(SCRIPTS)
  .filter((f) => /^verify.+\.js$/.test(f) && fs.statSync(path.join(SCRIPTS, f)).isFile())
  .sort()
console.log(`Discovered ${verifiers.length} verifier(s).`)
console.log(SOFT_RULE)
for (const f of verifiers) {
  const label = `scripts/${f}`
  const r = runCmd(label, `node "${path.join(SCRIPTS, f)}"`, { cwd: REPO })
  // Print just the RESULT line for compactness
  const resultLine = r.stdout.split("\n").reverse().find((l) => /^RESULT:/.test(l)) || "(no RESULT line)"
  console.log(`  ${r.ok ? "✓" : "✗"} ${label.padEnd(50)} ${resultLine}`)
  results.push(r)
}

// ── 3. 5-probe canonical integrity matrix ──────────────────────────────────
header("STEP 3 — 5-PROBE CANONICAL INTEGRITY MATRIX")
const probes = [
  "probe_grading_backfill_v1.js",
  "probe_lineage_v1.js",
  "probe_epoch_authority_v1.js",
  "probe_persistence_idempotency_v1.js",
  "probe_ledger_mirror_v1.js",
]
for (const p of probes) {
  const probePath = path.join(REPO, p)
  if (!fs.existsSync(probePath)) {
    console.log(`  ✗ ${p.padEnd(40)} (script not found)`)
    results.push({ label: p, ok: false, stdout: "", stderr: "missing probe script" })
    continue
  }
  const r = runCmd(p, `node "${probePath}"`, { cwd: REPO })
  const tailLine = r.stdout.split("\n").reverse().find((l) => /pass:|fail:|RESULT:/.test(l)) || "(no result line)"
  console.log(`  ${r.ok ? "✓" : "✗"} ${p.padEnd(40)} ${tailLine}`)
  results.push(r)
}

// ── SUMMARY ────────────────────────────────────────────────────────────────
header("ops:verify SUMMARY")
const failed = results.filter((r) => !r.ok)
const total  = results.length
console.log(`Total checks: ${total} · PASS: ${total - failed.length} · FAIL: ${failed.length}`)
if (failed.length > 0) {
  console.log("")
  console.log("Failures:")
  for (const f of failed) {
    console.log(`  ✗ ${f.label}`)
    if (f.stderr) console.log(`     stderr: ${f.stderr.split("\n").slice(0, 3).join(" | ")}`)
  }
  console.log("")
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
