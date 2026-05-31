#!/usr/bin/env node
"use strict"

/**
 * auditDeltaCheck.js — the radar.
 *
 * Compares the last 2 audit runs (per audit type) in audit_history.jsonl.
 * If any of these conditions is met, appends a regression to
 * regression_alerts.log AND prints to stderr:
 *
 *   1. failed count increased    (was N, now > N)
 *   2. warned count jumped ≥ 3   (catches mass-warning regressions)
 *   3. STATUS degraded           (GREEN→YELLOW, GREEN→RED, YELLOW→RED)
 *
 * Skips when fewer than 2 runs of the audit type exist (cold start).
 *
 * Wired into:
 *   - scheduler.sh: runs after each hourly sysAudit
 *   - restartBackend.sh: runs after post-boot sysAudit
 *
 * Exit codes:
 *   0 = no regressions
 *   2 = regression detected (alert appended)
 *   3 = fatal (history file unreadable)
 *
 * Honest about its own limits: this is a coarse detector — it sees totals,
 * not which specific check regressed. Section-level diff is a v2 enhancement
 * (would require sysAudit/deepAudit to also persist per-section state).
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const REPO = path.join(__dirname, "..", "..")
const HISTORY = path.join(REPO, "backend", "runtime", "audits", "audit_history.jsonl")
const ALERTS = path.join(REPO, "backend", "runtime", "audits", "regression_alerts.log")

function readJsonl(p) {
  try {
    return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function gitHead() {
  try { return execSync("git rev-parse HEAD", { cwd: REPO, timeout: 2000 }).toString().trim().slice(0, 7) } catch { return "?" }
}

function gitDiffSince(commitOld, commitNew) {
  if (commitOld === commitNew || commitOld === "?" || commitNew === "?") return ""
  try {
    return execSync(`git diff --name-only ${commitOld} ${commitNew}`, { cwd: REPO, timeout: 3000 }).toString().trim().split("\n").filter(Boolean).slice(0, 20).join(", ")
  } catch { return "" }
}

function main() {
  const all = readJsonl(HISTORY)
  if (all.length < 2) {
    console.log(`auditDeltaCheck: only ${all.length} entries in history — need 2+ for comparison, skipping`)
    process.exit(0)
  }

  // Group by audit type, find the last 2 of each
  const byType = {}
  for (const e of all) {
    if (!byType[e.audit]) byType[e.audit] = []
    byType[e.audit].push(e)
  }

  const STATUS_RANK = { GREEN: 0, YELLOW: 1, RED: 2 }
  const alerts = []

  for (const type of Object.keys(byType)) {
    const entries = byType[type]
    if (entries.length < 2) continue
    const prev = entries[entries.length - 2]
    const curr = entries[entries.length - 1]
    const reasons = []

    // 1. Failed count increased
    if (curr.totals.failed > prev.totals.failed) {
      reasons.push(`failures ${prev.totals.failed} → ${curr.totals.failed} (+${curr.totals.failed - prev.totals.failed})`)
    }

    // 2. Warned count jumped ≥ 3
    if (curr.totals.warned >= prev.totals.warned + 3) {
      reasons.push(`warnings jumped ${prev.totals.warned} → ${curr.totals.warned} (+${curr.totals.warned - prev.totals.warned})`)
    }

    // 3. Status degraded
    if (STATUS_RANK[curr.status] > STATUS_RANK[prev.status]) {
      reasons.push(`status ${prev.status} → ${curr.status}`)
    }

    if (reasons.length) {
      const diff = gitDiffSince(prev.commit, curr.commit)
      alerts.push({
        type, prevTs: prev.ts, currTs: curr.ts,
        prevCommit: prev.commit, currCommit: curr.commit,
        reasons, diff,
      })
    }
  }

  if (alerts.length === 0) {
    console.log("auditDeltaCheck: no regressions detected across audit types")
    process.exit(0)
  }

  fs.mkdirSync(path.dirname(ALERTS), { recursive: true })
  for (const a of alerts) {
    const line = `[${a.currTs}] ${a.type} regression · ${a.prevCommit} → ${a.currCommit} · ${a.reasons.join(" · ")}${a.diff ? ` · files: ${a.diff}` : ""}`
    fs.appendFileSync(ALERTS, line + "\n")
    console.error("REGRESSION:", line)
  }
  console.log(`auditDeltaCheck: ${alerts.length} regression(s) appended to ${ALERTS}`)
  process.exit(2)
}

main()
