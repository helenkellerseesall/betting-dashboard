#!/usr/bin/env node
"use strict"

/**
 * BRAIN STATUS — quick snapshot of brain-doc state.
 *
 *   node backend/scripts/brain/brainSyncSummary.js
 *   npm run brain:status
 *
 * Output:
 *   - Each brain doc: line count, bytes, mtime, "Last updated" header value
 *   - Current phase one-liner
 *   - Open incident count
 *   - Runtime code mtime vs brain mtime gap
 *   - Regression matrix scripts present (file existence count)
 *
 * No side effects. Truthful diagnostics only.
 */

const lib = require("./_brainLib")

function run() {
  console.log("╔" + "═".repeat(68) + "╗")
  console.log("║  BRAIN STATUS                                                       ║")
  console.log("╚" + "═".repeat(68) + "╝")

  // Per-file status
  console.log("")
  console.log("FILE                              LINES      BYTES   LAST-MOD (UTC)        LAST-UPDATED HEADER")
  console.log("───────────────────────────────  ──────  ─────────  ────────────────────  ───────────────────")
  for (const f of lib.BRAIN_FILES) {
    const st = lib.brainFileStats(f)
    if (!st.exists) {
      console.log(`  ${f.padEnd(31, " ")}  MISSING`)
      continue
    }
    const content = lib.readBrainFile(f)
    const hdr = lib.extractLastUpdated(content) || "—"
    console.log(
      "  " + f.padEnd(31, " ") +
      "  " + String(st.lines).padStart(5, " ") +
      "  " + String(st.bytes).padStart(8, " ") +
      "   " + lib.fmt(st.mtime) +
      "  " + hdr.slice(0, 50)
    )
  }

  // Current phase
  console.log("")
  console.log("CURRENT PROJECT PHASE")
  console.log("─────────────────────")
  const phase = lib.extractCurrentProjectPhase(lib.readBrainFile("MASTER_BRAIN.md"))
  console.log(phase ? phase.split("\n").slice(0, 4).join("\n") : "  (MASTER_BRAIN missing)")

  // Open incidents count
  console.log("")
  console.log("OPEN / WATCH INCIDENTS")
  console.log("──────────────────────")
  const incs = lib.extractOpenIncidents(lib.readBrainFile("ACTIVE_INCIDENTS.md"))
  console.log(`  count: ${incs.length}`)
  incs.slice(0, 8).forEach((i) => {
    const status = i.status ? ` [${i.status}]` : ""
    console.log(`  • ${i.id}${status} — ${i.title}`)
  })
  if (incs.length > 8) console.log(`  … and ${incs.length - 8} more`)

  // Brain mtime vs runtime-code mtime
  console.log("")
  console.log("BRAIN vs RUNTIME-CODE MTIME COMPARISON")
  console.log("──────────────────────────────────────")
  const brainM = lib.brainDirMostRecentMtime()
  const codeM  = lib.runtimeCodeMostRecentMtime()
  console.log(`  most recent brain mtime         : ${lib.fmt(brainM)}`)
  console.log(`  most recent runtime-code mtime  : ${lib.fmt(codeM)}`)
  if (brainM && codeM) {
    const lag = lib.diffMinutes(codeM, brainM)
    if (lag > 0) {
      console.log(`  LAG: runtime code is ${lag} minute(s) newer than brain — brain may be stale`)
    } else if (lag < 0) {
      console.log(`  brain is ${-lag} minute(s) newer than runtime code (typical post-patch state)`)
    } else {
      console.log(`  brain and runtime code touched within the same minute`)
    }
  }

  // Continuity receipt + drift summary
  console.log("")
  console.log("CONTINUITY RECEIPT")
  console.log("──────────────────")
  const a = lib.assessContinuity()
  if (!a.receiptPresent) {
    console.log("  (no receipt — run `npm run brain:bootstrap`)")
  } else {
    const r = a.receipt
    console.log("  lastBootstrapAt        : " + (r.lastBootstrapAt || "—") +
      (Number.isFinite(a.bootstrapAgeMinutes) ? `  (${a.bootstrapAgeMinutes} min ago)` : ""))
    console.log("  lastCheckpointAt       : " + (r.lastCheckpointAt || "—") +
      (Number.isFinite(a.checkpointAgeMinutes) ? `  (${a.checkpointAgeMinutes} min ago)` : "") +
      (r.lastCheckpointResult ? `  [${r.lastCheckpointResult}]` : ""))
    console.log("  runtime changed since bootstrap : " + (a.runtimeChangedSinceBootstrap ? "yes" : "no"))
    console.log("  brain    changed since bootstrap : " + (a.brainChangedSinceBootstrap ? "yes" : "no"))
    console.log("  warnings : " + a.warnings.length)
    console.log("  issues   : " + a.issues.length)
    for (const w of a.warnings) console.log("    WARN — [" + w.code + "] " + w.message)
    for (const i of a.issues)   console.log("    FAIL — [" + i.code + "] " + i.message)
  }

  // Regression matrix presence
  console.log("")
  console.log("REGRESSION MATRIX (verify*.js files in backend/scripts/)")
  console.log("──────────────────────────────────────────────────────")
  const fixtures = lib.listRegressionMatrix()
  console.log(`  count: ${fixtures.length}`)
  fixtures.forEach((f) => console.log("  • " + f))

  console.log("")
}

run()
