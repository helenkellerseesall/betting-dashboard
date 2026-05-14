#!/usr/bin/env node
"use strict"

/**
 * BRAIN CHECKPOINT ENFORCEMENT — end-of-session discipline gate.
 *
 *   node backend/scripts/brain/enforceBrainCheckpoint.js [--since=ISO_TS|--since-minutes=N]
 *   npm run brain:checkpoint
 *   npm run brain:checkpoint -- --since-minutes=120
 *
 * Purpose: catch the case where a session modified runtime code but forgot to
 * update the brain. Per ARCHITECTURE_LAWS.md Law 12 (memory docs are part of
 * the patch).
 *
 * Logic:
 *   1. Determine a `since` timestamp (default: oldest of any runtime-code mtime
 *      in the last 24h that is newer than the corresponding brain mtime; can
 *      override via --since=<ISO> or --since-minutes=N).
 *   2. Enumerate runtime-code files modified after `since`.
 *   3. Enumerate brain-doc files modified after `since`.
 *   4. If any code was modified but the REQUIRED brain docs were NOT, FAIL.
 *      Required-on-patch set: MASTER_BRAIN.md, CURRENT_RUNTIME_STATE.md,
 *      MODEL_EVOLUTION_LOG.md.
 *   5. Also runs the freshness verifier as a sub-step.
 *   6. Also runs the full regression matrix (verify*.js) and requires all PASS.
 *
 * This script is advisory but exits non-zero on failure so it can be wired
 * into checkpoint commands or pre-commit hooks at the operator's discretion.
 */

const fs   = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const lib  = require("./_brainLib")

function parseArgs() {
  const args = { since: null, sinceMinutes: null, skipMatrix: false }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--since=")) args.since = a.slice("--since=".length)
    else if (a.startsWith("--since-minutes=")) args.sinceMinutes = Number(a.slice("--since-minutes=".length))
    else if (a === "--skip-matrix") args.skipMatrix = true
  }
  return args
}

function listFilesModifiedSince(roots, since) {
  const out = []
  function visit(p) {
    if (!fs.existsSync(p)) return
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
        visit(path.join(p, entry.name))
      }
    } else if (st.isFile()) {
      if (st.mtime > since) out.push({ path: p, mtime: st.mtime })
    }
  }
  for (const r of roots) visit(r)
  return out
}

function fmtRel(p) {
  return p.replace(lib.REPO_ROOT + "/", "")
}

function run() {
  const args = parseArgs()

  console.log("╔" + "═".repeat(68) + "╗")
  console.log("║  BRAIN CHECKPOINT ENFORCEMENT                                       ║")
  console.log("╚" + "═".repeat(68) + "╝")

  // Resolve `since`
  let since
  if (args.since) {
    since = new Date(args.since)
  } else if (Number.isFinite(args.sinceMinutes)) {
    since = new Date(Date.now() - args.sinceMinutes * 60 * 1000)
  } else {
    // Default: look at runtime files modified within the last 24h.
    since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  }
  console.log(`\nSince: ${lib.fmt(since)} (${args.since ? "operator-supplied" : args.sinceMinutes ? "minutes-arg" : "default: last 24h"})\n`)

  // 1. Code changes since `since`
  const codeMods = listFilesModifiedSince(lib.RUNTIME_CODE_DIRS, since)
    // Filter to source files only
    .filter((f) => /\.js$/.test(f.path))
    // Sort newest-first
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  console.log("─".repeat(70))
  console.log(`RUNTIME CODE FILES MODIFIED (count: ${codeMods.length})`)
  console.log("─".repeat(70))
  if (codeMods.length === 0) {
    console.log("  (none — no meaningful code work to validate)")
  } else {
    codeMods.slice(0, 20).forEach((f) => console.log("  • " + lib.fmt(f.mtime) + "  " + fmtRel(f.path)))
    if (codeMods.length > 20) console.log(`  … and ${codeMods.length - 20} more`)
  }

  // 2. Brain mods since `since`
  const brainMods = lib.BRAIN_FILES
    .map((f) => ({ name: f, ...lib.brainFileStats(f) }))
    .filter((s) => s.exists && s.mtime > since)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  console.log("\n" + "─".repeat(70))
  console.log(`BRAIN DOCS MODIFIED (count: ${brainMods.length})`)
  console.log("─".repeat(70))
  if (brainMods.length === 0) {
    console.log("  (none)")
  } else {
    brainMods.forEach((s) => console.log("  • " + lib.fmt(s.mtime) + "  " + s.name))
  }

  // 3. Required-on-patch reconciliation
  console.log("\n" + "─".repeat(70))
  console.log("REQUIRED-ON-PATCH RECONCILIATION (per ARCHITECTURE_LAWS.md Law 12)")
  console.log("─".repeat(70))
  let fails = 0
  if (codeMods.length === 0) {
    console.log("  SKIPPED — no runtime code mods to reconcile against")
  } else {
    for (const required of lib.BRAIN_REQUIRED_ON_PATCH) {
      const updated = brainMods.find((b) => b.name === required)
      if (updated) {
        console.log(`  OK   — ${required} updated at ${lib.fmt(updated.mtime)}`)
      } else {
        console.log(`  FAIL — ${required} NOT updated since ${lib.fmt(since)} but runtime code WAS`)
        fails += 1
      }
    }
    console.log("\n  Note: ACTIVE_INCIDENTS.md, PIPELINE_AUTHORITY_MAP.md, SPORTSBOOK_CONTRACTS.md")
    console.log("  should also be updated when those areas are affected — verify manually.")
  }

  // 4. Freshness verifier sub-run
  console.log("\n" + "─".repeat(70))
  console.log("FRESHNESS VERIFICATION (delegating to verifyBrainFreshness.js)")
  console.log("─".repeat(70))
  const freshness = spawnSync(process.execPath,
    [path.join(__dirname, "verifyBrainFreshness.js")],
    { encoding: "utf8" })
  if (freshness.status === 0) {
    console.log("  OK — freshness PASS")
  } else {
    console.log("  FAIL — freshness verifier reported FAILs (run `npm run brain:verify` to see details)")
    fails += 1
  }

  // 5. Regression matrix
  if (!args.skipMatrix) {
    console.log("\n" + "─".repeat(70))
    console.log("REGRESSION MATRIX (verify*.js scripts in backend/scripts/)")
    console.log("─".repeat(70))
    const fixtures = lib.listRegressionMatrix()
    let suiteFails = 0
    for (const f of fixtures) {
      const r = spawnSync(process.execPath,
        [path.join(lib.BACKEND_ROOT, "scripts", f)],
        { encoding: "utf8" })
      const result = (r.stdout || "").match(/^RESULT:\s*(PASS|FAIL)/m)
      const passed = r.status === 0 && result && result[1] === "PASS"
      console.log(`  ${passed ? "OK  " : "FAIL"} — ${f}${passed ? "" : `  (node_exit=${r.status})`}`)
      if (!passed) suiteFails += 1
    }
    if (suiteFails > 0) {
      console.log(`  ${suiteFails} suite(s) FAILED`)
      fails += suiteFails
    }
  } else {
    console.log("\n  (regression matrix skipped via --skip-matrix)")
  }

  // 6. Summary
  console.log("\n══════════════════════════════════════════════════════════════════════")
  console.log(`CHECKPOINT RESULT: ${fails === 0 ? "PASS" : "FAIL"}  (${fails} failure(s))`)
  console.log("══════════════════════════════════════════════════════════════════════")
  if (fails > 0) {
    console.log("\nWhat to do:")
    console.log("  1. Update the missing brain docs (MASTER_BRAIN.md, CURRENT_RUNTIME_STATE.md,")
    console.log("     MODEL_EVOLUTION_LOG.md) to reflect the runtime-code changes.")
    console.log("  2. Run `npm run brain:verify` to see freshness details.")
    console.log("  3. Re-run any failed regression suites; investigate before declaring done.")
    console.log("  4. Re-run `npm run brain:checkpoint` to confirm PASS.")
    process.exitCode = 1
  } else {
    console.log("\nCheckpoint clean. Brain is synchronized with runtime state.")
    console.log("Update repo-root CURRENT_STATE.md + NEXT_SESSION.md if operator-facing details changed.")
  }
}

run()
