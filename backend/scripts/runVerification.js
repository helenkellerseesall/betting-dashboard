#!/usr/bin/env node
"use strict"

/**
 * runVerification.js — Session AK
 *
 * Runtime verification script for NBA/MLB workstation payloads.
 * Replaces manual TERM 2 curl commands with a deterministic, artifact-generating runner.
 * Implements Verification Telemetry V1.
 *
 * Usage:
 *   node backend/scripts/runVerification.js --sport=nba --session=AK
 *   node backend/scripts/runVerification.js --sport=mlb --session=AK
 *   node backend/scripts/runVerification.js --sport=all --session=AK
 *   node backend/scripts/runVerification.js --sport=nba --session=AK --host=http://localhost:4000
 *   node backend/scripts/runVerification.js --sport=nba --session=AK --no-artifact
 *   node backend/scripts/runVerification.js --sport=nba --session=AK --verbose
 *
 * Flags:
 *   --sport=<nba|mlb|all>    Sport(s) to verify (default: nba)
 *   --session=<label>         Session label for artifact filename (default: unknown)
 *   --host=<url>              Backend host (default: http://localhost:4000)
 *   --no-artifact             Skip writing JSON artifact (stdout only)
 *   --verbose                 Print all check details, not just failures
 *
 * Output:
 *   - JSON artifact: backend/runtime/verifications/verification_<sport>_<date>_<session>.json
 *   - Stdout: concise PASS/FAIL summary per sport
 *   - Exit code: 0 = all error-severity checks pass | 1 = any error check fails
 *
 * Verification class: D
 * Prerequisites: TERM 1 restart + /refresh-snapshot/hard-reset BEFORE running this script.
 * Skipping either produces false failures (empty snapshot) or false passes (stale code).
 */

const http  = require("http")
const https = require("https")
const path  = require("path")

const { NBA_CHECKS, MLB_CHECKS } = require("../pipeline/verification/verificationSchema")
const { writeVerificationArtifact, VERIFICATIONS_DIR } = require("../pipeline/verification/writeVerificationArtifact")

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    sport:    "nba",
    session:  "unknown",
    host:     "http://localhost:4000",
    artifact: true,
    verbose:  false,
  }
  for (const arg of argv.slice(2)) {
    if (arg === "--no-artifact") { args.artifact = false; continue }
    if (arg === "--verbose")     { args.verbose  = true;  continue }
    const eq = arg.indexOf("=")
    if (eq > 2) {
      const k = arg.slice(2, eq)
      const v = arg.slice(eq + 1)
      if (k in args) args[k] = v
    }
  }
  return args
}

// ── HTTP fetch — zero external deps ──────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const driver = url.startsWith("https") ? https : http
    const timer  = setTimeout(() => reject(new Error("Request timed out after 15s")), 15000)
    driver.get(url, (res) => {
      let raw = ""
      res.on("data", chunk => raw += chunk)
      res.on("end", () => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(new Error(`Non-JSON response from ${url} (status ${res.statusCode}): ${raw.slice(0, 120)}`))
        }
      })
    }).on("error", e => { clearTimeout(timer); reject(e) })
  })
}

// ── Check runner ──────────────────────────────────────────────────────────────

function runChecks(checkDefs, payload) {
  return checkDefs.map(def => {
    try {
      const result = def.run(payload)
      return { ...result, severity: def.severity, description: def.description }
    } catch (e) {
      return {
        id:          def.id,
        pass:        false,
        severity:    def.severity,
        description: def.description,
        value:       null,
        expected:    "no runtime error",
        message:     `Check threw: ${e.message}`,
      }
    }
  })
}

// ── Summary printer ───────────────────────────────────────────────────────────

function printSummary({ sport, checks, overall, summary, runtime_snapshot: snap, outPath, verbose }) {
  const icon = overall === "PASS" ? "✓" : "✗"
  console.log(
    `\n${icon} [${sport.toUpperCase()}] ${overall}` +
    ` — ${summary.passed}/${summary.total} passed` +
    (summary.warned  > 0 ? `, ${summary.warned} warned`  : "") +
    (summary.failed  > 0 ? `, ${summary.failed} FAILED`  : "")
  )

  const errors = checks.filter(c => !c.pass && c.severity === "error")
  const warns  = checks.filter(c => !c.pass && c.severity === "warn")

  if (errors.length) {
    console.log("  ERRORS:")
    for (const c of errors) console.log(`    ✗ ${c.id}: ${c.message}  (expected ${c.expected})`)
  }
  if (warns.length) {
    console.log("  WARNINGS:")
    for (const c of warns) console.log(`    ⚠ ${c.id}: ${c.message}`)
  }
  if (verbose) {
    console.log("  ALL CHECKS:")
    for (const c of checks) {
      const s = c.pass ? "✓" : (c.severity === "error" ? "✗" : "⚠")
      console.log(`    ${s} ${c.id}: ${c.message}`)
    }
  }

  if (snap) {
    const altInfo = snap.alt_line_legs_in_slips > 0
      ? ` alt-legs=${snap.alt_line_legs_in_slips}(${snap.alt_line_families.join(",")})`
      : ""
    console.log(
      `  runtime: candidates=${snap.candidates ?? "?"}` +
      ` slips=${snap.total_slips}` +
      ` anchors=${snap.featured_anchors ?? "?"}` +
      ` corrFields=${snap.correlation_fields}` +
      altInfo
    )
  }

  if (outPath) {
    console.log(`  artifact: ${path.relative(process.cwd(), outPath)}`)
  }
}

// ── Per-sport verification ────────────────────────────────────────────────────

async function verifySport(sport, args) {
  // NBA uses sport=nba; MLB uses sport=baseball_mlb (workstation API convention)
  const sportParam = sport === "nba" ? "nba" : "baseball_mlb"
  const url        = `${args.host}/api/ws/state?sport=${sportParam}`
  const checkDefs  = sport === "nba" ? NBA_CHECKS : MLB_CHECKS

  console.log(`\n→ Fetching ${url} ...`)

  let payload
  try {
    payload = await fetchJson(url)
  } catch (e) {
    console.log(`✗ [${sport.toUpperCase()}] FAIL — server unreachable: ${e.message}`)
    console.log("  Prerequisites: TERM 1 running + /refresh-snapshot/hard-reset completed")
    return false
  }

  const checks  = runChecks(checkDefs, payload)
  const failed  = checks.filter(c => !c.pass && c.severity === "error").length
  const passed  = checks.filter(c => c.pass).length
  const warned  = checks.filter(c => !c.pass && c.severity === "warn").length
  const overall = failed === 0 ? "PASS" : "FAIL"
  const summary = { total: checks.length, passed, failed, warned }

  let outPath        = null
  let runtime_snapshot = null

  if (args.artifact) {
    const result = writeVerificationArtifact({
      sport,
      session: args.session,
      checks,
      payload,
      options: { host: args.host, verbose: args.verbose },
    })
    outPath          = result.outPath
    runtime_snapshot = result.artifact.runtime_snapshot
  } else {
    // Compute snapshot inline when not writing artifact
    const allSlips = Object.values(payload?.aiSlips || {}).flat()
    const altLegs  = allSlips.flatMap(s => s.legs || []).filter(l => l.isAltLine === true)
    runtime_snapshot = {
      candidates:              payload?.counts?.candidates ?? null,
      total_slips:             allSlips.length,
      alt_line_legs_in_slips:  altLegs.length,
      alt_line_families:       [...new Set(altLegs.map(l => l.statFamily))].sort(),
      featured_anchors:        payload?.featured?.anchors?.length ?? null,
      correlation_fields:      allSlips.filter(s => "correlationScore" in s).length,
    }
  }

  printSummary({ sport, checks, overall, summary, runtime_snapshot, outPath, verbose: args.verbose })
  return overall === "PASS"
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args   = parseArgs(process.argv)
  const sports = args.sport === "all" ? ["nba", "mlb"] : [args.sport]

  console.log(`\n${"═".repeat(52)}`)
  console.log(` Verification Telemetry V1  —  Session ${args.session}`)
  console.log(`${"═".repeat(52)}`)
  console.log(` Sports : ${sports.join(", ")}`)
  console.log(` Host   : ${args.host}`)
  console.log(` Artifacts: ${args.artifact ? VERIFICATIONS_DIR : "disabled"}`)
  console.log(`${"─".repeat(52)}`)

  let allPass = true
  for (const sport of sports) {
    const pass = await verifySport(sport, args)
    if (!pass) allPass = false
  }

  console.log(`\n${"═".repeat(52)}`)
  console.log(` Overall: ${allPass ? "✓ PASS" : "✗ FAIL"}`)
  console.log(`${"═".repeat(52)}\n`)

  process.exit(allPass ? 0 : 1)
}

main().catch(e => {
  console.error("Fatal:", e.message)
  process.exit(1)
})
