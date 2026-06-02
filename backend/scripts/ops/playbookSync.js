#!/usr/bin/env node
"use strict"

/**
 * playbookSync.js — OPERATOR_RUNBOOK auto-update trigger on slice close.
 *
 * Fires when a slice transitions to "shipped". Performs two actions:
 *
 *   1. Appends a one-line phase-ledger entry to the OPERATOR_RUNBOOK.md
 *      header sentence ("Phase <slice-id> appended <today>.").
 *   2. Asserts the four continuity-propagation surfaces all reference the
 *      shipped slice id (EXECUTION_BACKLOG, BETTOR_BACKLOG,
 *      OPERATOR_RUNBOOK, ARCHITECTURE_LAWS — last is optional).
 *
 * If any propagation check fails, the script exits non-zero and the slice
 * close is BLOCKED — assistant must reconcile before re-running.
 *
 * Usage:
 *   node backend/scripts/ops/playbookSync.js <slice-id> "<one-line summary>" [commit-sha]
 *
 * Phase OO-2 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../../pipeline/shared/slateDate")

const REPO = path.join(__dirname, "..", "..", "..")
const DOCS = path.join(REPO, "docs")

const RUNBOOK_PATH = path.join(DOCS, "OPERATOR_RUNBOOK.md")
const EXEC_PATH    = path.join(DOCS, "EXECUTION_BACKLOG.md")
const BBL_PATH     = path.join(DOCS, "BETTOR_BACKLOG.md")
const LAWS_PATH    = path.join(REPO, "backend", "runtime", "brain", "ARCHITECTURE_LAWS.md")

function appendRunbookPhaseLedger(slice, today) {
  let rb = fs.readFileSync(RUNBOOK_PATH, "utf8")
  // The RUNBOOK header sentence already lists "Phase X appended YYYY-MM-DD."
  // Append one more period-separated phrase to that sentence. Match the
  // bolded header sentence to be conservative.
  const phaseStr = `Phase ${slice} appended ${today}.`
  if (rb.includes(phaseStr)) {
    return { rb, alreadyPresent: true }
  }
  const headerRe = /(\*\*Single source-of-truth for daily repo operation\.[^*]*?)(\*\*)/
  const m = rb.match(headerRe)
  if (!m) {
    // Header shape changed; append a top-of-file phase ledger line under the H1.
    rb = rb.replace(/^# OPERATOR RUNBOOK\n/, `# OPERATOR RUNBOOK\n\n_${phaseStr}_\n`)
  } else {
    rb = rb.replace(headerRe, `$1 ${phaseStr}$2`)
  }
  fs.writeFileSync(RUNBOOK_PATH, rb)
  return { rb, alreadyPresent: false }
}

function assertReference(src, slice, label) {
  if (src.includes(slice)) return { ok: true, label }
  return { ok: false, label }
}

function main() {
  const [, , slice, summary, commitSha] = process.argv
  if (!slice || !summary) {
    console.error("usage: playbookSync.js <slice-id> \"<one-line summary>\" [commit-sha]")
    process.exit(1)
  }
  const today = currentSlateDateEt()  // Phase Date-Doctrine-1B

  // 1. Append phase ledger entry
  const { alreadyPresent } = appendRunbookPhaseLedger(slice, today)

  // 2. Continuity propagation assertions
  const checks = []
  checks.push(assertReference(fs.readFileSync(EXEC_PATH, "utf8"), slice, "EXECUTION_BACKLOG.md"))
  checks.push(assertReference(fs.readFileSync(BBL_PATH,  "utf8"), slice, "BETTOR_BACKLOG.md"))
  checks.push(assertReference(fs.readFileSync(RUNBOOK_PATH, "utf8"), slice, "OPERATOR_RUNBOOK.md"))
  if (fs.existsSync(LAWS_PATH)) {
    // ARCHITECTURE_LAWS reference is optional unless a new Law landed; we
    // emit a warning but do not block.
    const lawsRef = assertReference(fs.readFileSync(LAWS_PATH, "utf8"), slice, "ARCHITECTURE_LAWS.md")
    if (!lawsRef.ok) console.warn(`  warn: ${lawsRef.label} does not reference ${slice} (OK if no Law landed)`)
  }

  console.log("")
  console.log("playbookSync — slice " + slice + " (" + (alreadyPresent ? "already in RUNBOOK ledger" : "appended") + ")")
  console.log("")
  let failed = 0
  for (const c of checks) {
    if (c.ok) console.log("  ✓ " + c.label + " references " + slice)
    else      { console.error("  ✗ " + c.label + " missing reference to " + slice); failed++ }
  }
  console.log("")
  if (commitSha) console.log("  commit: " + commitSha)
  if (failed > 0) {
    console.error("playbookSync FAIL — " + failed + " continuity surface(s) out of sync; slice close BLOCKED")
    process.exit(1)
  }
  console.log("playbookSync PASS — slice " + slice + " safe to mark shipped")
}

if (require.main === module) main()
module.exports = { appendRunbookPhaseLedger }
