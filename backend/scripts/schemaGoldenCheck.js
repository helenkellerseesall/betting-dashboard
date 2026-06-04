#!/usr/bin/env node
"use strict"

/**
 * schemaGoldenCheck.js — Wave 1 A3 runnable probe
 *
 *   node scripts/schemaGoldenCheck.js          operator-readable summary
 *   node scripts/schemaGoldenCheck.js --json    raw JSON (for /status + scratch)
 *
 * Validates the five core JSON shapes against their golden schemas. WARN-ONLY:
 * always exits 0 — this probe reports drift, it never blocks anything. It is a
 * mirror, not a gate (operator decision 2026-06-04).
 */

const { runSchemaGoldenCheck } = require("../pipeline/shared/schemaGoldenValidator")

function main() {
  const json = process.argv.includes("--json")
  const out = runSchemaGoldenCheck()

  if (json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n")
    process.exit(0)
  }

  console.log("=== Schema Golden Check (Wave 1 A3) — WARN ONLY, never blocks ===")
  console.log("generatedAt: " + out.generatedAt)
  console.log("")

  for (const r of out.results) {
    for (const t of r.targets) {
      const tag = t.violations.length === 0 ? "OK  " : "DRIFT"
      console.log(`[${tag}] ${r.name}  <-  ${t.file}`)
      if (!t.exists) console.log("        (file missing)")
      for (const v of t.violations) {
        console.log(`        - ${v.severity}: ${v.where} — ${v.msg}`)
      }
    }
  }

  const s = out.summary
  console.log("")
  console.log("-".repeat(64))
  if (s.status === "error") {
    console.log("RESULT: ERROR — " + s.message)
  } else {
    console.log(
      `RESULT: ${s.status.toUpperCase()}  ` +
        `(${s.filesChecked} files checked, ${s.driftFiles} with drift, ` +
        `${s.filesMissing} missing, ${s.filesParseFail} parse-fail, ` +
        `${s.totalViolations} total findings)`
    )
  }
  process.exit(0) // WARN-ONLY: never non-zero
}

main()
