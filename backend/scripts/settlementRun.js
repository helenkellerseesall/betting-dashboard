#!/usr/bin/env node
"use strict"

/**
 * settlementRun.js — Phase Settlement-Orchestration-1A (AUTO-2) (2026-05-15)
 *
 * Canonical single-command settlement entrypoint.
 *
 *   Usage:
 *     npm run settlement:run                             # both sports, today
 *     npm run settlement:run -- --sport=mlb              # MLB only, today
 *     npm run settlement:run -- --sport=nba --date=2026-05-08
 *     npm run settlement:run -- --check                  # detect-only; no writes
 *     npm run settlement:run -- --clear-locks            # pre-flight lock sweep
 *     npm run settlement:run -- --no-orchestrate         # grade only; skip nightlyReview chain
 *     npm run settlement:run -- --sport=all --date=2026-05-08 --clear-locks
 *
 * What it does (in this order):
 *   1. (--check) — calls `nightlyReview.js --check` per sport+date and exits.
 *   2. (--clear-locks) — pre-flight stale-lock sweep via `grading:backfill-all -- --clear-locks --dry`.
 *   3. Run grading: `runHistoricalGrade.js --sport=X --date=Y [...]`.
 *      The post-grading AUTO-1 hook inside runHistoricalGrade then automatically
 *      chains to `nightlyReview.js` for the same (sport, date). When --no-orchestrate
 *      is passed, AUTO-1 is suppressed and this wrapper does not chain either.
 *   4. Verify outcome_snapshots populated: query SQLite (if available) for the
 *      per-date outcome count vs the JSON tracked_bets settled count. Surface any
 *      gap loudly. SQLite-unavailable is OK in sandbox; verification surfaces
 *      "SQLite unavailable" rather than failing silently.
 *   5. Print a summary block: settled count / outcome count / orchestration status
 *      per (sport, date).
 *   6. Exit 0 only if every (sport, date) pair completed grading AND
 *      orchestration AND verification. Exit 1 on any failure.
 *
 * Doctrine (Phase Settlement-1A):
 *   - Replay-safe — every downstream step is the existing CLI (no new write path).
 *   - Lockfile-protected — relies on Phase 1F+1G acquireLock semantics.
 *   - API-conscious — exactly one grading-API fetch per date (same as today's
 *     `grading:run`); no polling, no retries, no background loops.
 *   - Deterministic — same input → same outcome_snapshots writes (INSERT OR REPLACE).
 *   - Fails loudly — non-zero exit and explicit per-step error messages.
 *
 * Phase Settlement-1A explicitly defers AUTO-3 (watchdog), AUTO-4 (background
 * scheduler), AUTO-5 (cron/systemd unit), and AUTO-6 (workstation button) to
 * later operator-approval gates.
 */

const fs   = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const BACKEND_DIR    = path.join(__dirname, "..")
const REPO_ROOT      = path.join(BACKEND_DIR, "..")
const TRACKING_DIR   = path.join(BACKEND_DIR, "runtime", "tracking")
const GRADE_CLI      = path.join(__dirname, "runHistoricalGrade.js")
const NIGHTLY_CLI    = path.join(REPO_ROOT, "scripts", "nightlyReview.js")
const BACKFILL_ALL   = path.join(__dirname, "runGradingBackfillAll.js")

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function parseArgs() {
  const out = {
    sport: "all",
    date: todayKey(),
    check: false,
    clearLocks: false,
    noOrchestrate: false,
    verbose: false,
  }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length).toLowerCase()
    else if (a.startsWith("--date=")) out.date = a.slice("--date=".length)
    else if (a === "--check")         out.check = true
    else if (a === "--clear-locks")   out.clearLocks = true
    else if (a === "--no-orchestrate") out.noOrchestrate = true
    else if (a === "--verbose")       out.verbose = true
    else {
      console.error(`[settlement:run] unknown arg: ${a}`)
      process.exit(2)
    }
  }
  if (!["mlb", "nba", "all"].includes(out.sport)) {
    console.error(`[settlement:run] --sport must be mlb / nba / all (got: ${out.sport})`)
    process.exit(2)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) {
    console.error(`[settlement:run] --date must be YYYY-MM-DD (got: ${out.date})`)
    process.exit(2)
  }
  return out
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countSettledInTrackedBets(sport, date) {
  const f = path.join(TRACKING_DIR, `${sport}_tracked_bets_${date}.json`)
  try {
    const arr = JSON.parse(fs.readFileSync(f, "utf8"))
    if (!Array.isArray(arr)) return { exists: true, total: 0, settled: 0 }
    const total = arr.length
    const settled = arr.filter((b) => b && b.result && ["win", "loss", "push", "void", "unresolved"].includes(b.result)).length
    return { exists: true, total, settled }
  } catch (_) {
    return { exists: false, total: 0, settled: 0 }
  }
}

function countOutcomeSnapshotsForDate(sport, date) {
  try {
    const { tryGetDb } = require("../storage/db")
    const db = tryGetDb()
    if (!db) return { ok: false, reason: "sqlite_unavailable" }
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM outcome_snapshots WHERE sport = ? AND run_date = ?")
      .get(sport, date)
    return { ok: true, count: Number(row?.n ?? 0) }
  } catch (e) {
    return { ok: false, reason: `query_error: ${String(e?.message || e).slice(0, 120)}` }
  }
}

function runCheck(sport, date) {
  console.log(`[settlement:run] ── CHECK ${sport}/${date} ──`)
  const r = spawnSync(
    "node",
    [NIGHTLY_CLI, `--sport=${sport}`, `--date=${date}`, "--check"],
    { stdio: "inherit" }
  )
  return { ok: r.status === 0, exitCode: r.status }
}

function runClearLocksSweep(sport) {
  console.log(`[settlement:run] ── PRE-FLIGHT STALE-LOCK SWEEP ${sport === "all" ? "(both sports)" : sport} ──`)
  const args = [BACKFILL_ALL, "--clear-locks", "--dry"]
  if (sport !== "all") args.push(`--sport=${sport}`)
  const r = spawnSync("node", args, { stdio: "inherit" })
  return { ok: r.status === 0, exitCode: r.status }
}

function runGradingChain(sport, date, opts) {
  console.log(`[settlement:run] ── GRADING ${sport}/${date} ──`)
  const args = [GRADE_CLI, `--sport=${sport}`, `--date=${date}`]
  if (opts.noOrchestrate) args.push("--no-orchestrate")
  if (opts.verbose)       args.push("--verbose")
  const r = spawnSync("node", args, { stdio: "inherit" })
  return { ok: r.status === 0, exitCode: r.status }
}

// ── Per-pair execution ───────────────────────────────────────────────────────

function executePair(sport, date, opts, summary) {
  const pair = { sport, date }
  // 1. Pre-state
  const before = countSettledInTrackedBets(sport, date)
  pair.before = before
  if (!before.exists) {
    console.log(`[settlement:run] ⚠ ${sport}/${date} — no tracked_bets file; skipping`)
    pair.status = "skipped_no_tracked_bets"
    summary.push(pair)
    return { ok: true, skipped: true }
  }

  const outcomesBefore = countOutcomeSnapshotsForDate(sport, date)
  pair.outcomesBefore = outcomesBefore

  // 2. Grading (chains to nightlyReview unless --no-orchestrate)
  const grading = runGradingChain(sport, date, opts)
  pair.gradingExitCode = grading.exitCode
  if (!grading.ok) {
    console.log(`[settlement:run] ✗ grading exited non-zero for ${sport}/${date}`)
    pair.status = "grading_failed"
    summary.push(pair)
    return { ok: false }
  }

  // 3. Post-state — outcome_snapshots verification
  const after = countSettledInTrackedBets(sport, date)
  pair.after = after
  const outcomesAfter = countOutcomeSnapshotsForDate(sport, date)
  pair.outcomesAfter = outcomesAfter

  // 4. Loud verification
  const settled = after.settled
  const sqliteOK = outcomesAfter.ok
  const outcomeCount = sqliteOK ? outcomesAfter.count : null

  if (opts.noOrchestrate) {
    pair.status = "grading_only_no_orchestrate"
  } else if (!sqliteOK) {
    pair.status = `verified_via_json_only_${outcomesAfter.reason}`
    console.log(`[settlement:run] ℹ ${sport}/${date} — SQLite verification unavailable (${outcomesAfter.reason}); JSON layer has ${settled} settled rows`)
  } else if (outcomeCount >= settled) {
    pair.status = "settled_verified"
    console.log(`[settlement:run] ✓ ${sport}/${date} verified: outcome_snapshots=${outcomeCount} ≥ tracked_bets.settled=${settled}`)
  } else if (settled > 0 && outcomeCount === 0) {
    pair.status = "orchestration_INCOMPLETE"
    console.log(`[settlement:run] ✗ ${sport}/${date} INCOMPLETE: tracked_bets has ${settled} settled rows but outcome_snapshots=0 — orchestration did not record outcomes`)
  } else {
    pair.status = "partial"
    console.log(`[settlement:run] ⚠ ${sport}/${date} partial: outcome_snapshots=${outcomeCount} < tracked_bets.settled=${settled}`)
  }

  summary.push(pair)
  return { ok: pair.status === "settled_verified" || pair.status === "grading_only_no_orchestrate" || pair.status.startsWith("verified_via_json_only") }
}

// ── Summary printer ──────────────────────────────────────────────────────────

function printSummary(summary, totalElapsed) {
  console.log("")
  console.log("─".repeat(70))
  console.log("SETTLEMENT SUMMARY")
  console.log("─".repeat(70))
  for (const p of summary) {
    const ob = p.outcomesBefore?.ok ? p.outcomesBefore.count : (p.outcomesBefore?.reason || "n/a")
    const oa = p.outcomesAfter?.ok ? p.outcomesAfter.count : (p.outcomesAfter?.reason || "n/a")
    const before = p.before ? `${p.before.settled}/${p.before.total}` : "—"
    const after  = p.after  ? `${p.after.settled}/${p.after.total}`   : "—"
    console.log(`  ${p.sport.padEnd(4)} ${p.date}  tracked_bets[settled/total]: ${before} → ${after}  |  outcome_snapshots: ${ob} → ${oa}  |  ${p.status}`)
  }
  console.log("─".repeat(70))
  console.log(`elapsed: ${totalElapsed}ms`)
}

function exitVerdict(summary) {
  const failing = summary.filter((p) =>
    p.status === "grading_failed" || p.status === "orchestration_INCOMPLETE" || p.status === "partial"
  )
  const verdict = failing.length === 0 ? "PASS" : "FAIL"
  console.log(`RESULT: ${verdict}${failing.length ? `  (${failing.length} pair${failing.length === 1 ? "" : "s"} failed)` : ""}`)
  return failing.length === 0 ? 0 : 1
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const t0 = Date.now()
  const args = parseArgs()
  const sports = args.sport === "all" ? ["mlb", "nba"] : [args.sport]

  console.log("=== settlement:run — Phase Settlement-Orchestration-1A (AUTO-2) ===")
  console.log(`sports        : ${sports.join(", ")}`)
  console.log(`date          : ${args.date}`)
  console.log(`mode          : ${args.check ? "CHECK (detect-only, no writes)" : "EXECUTE (grading + chained nightlyReview)"}`)
  console.log(`clear-locks   : ${args.clearLocks}`)
  console.log(`no-orchestrate: ${args.noOrchestrate}`)
  console.log("")

  // CHECK mode — detect-only, exit
  if (args.check) {
    let anyFail = false
    for (const sport of sports) {
      const r = runCheck(sport, args.date)
      if (!r.ok) anyFail = true
    }
    console.log("─".repeat(70))
    console.log(`RESULT: ${anyFail ? "FAIL (one or more pairs not ready)" : "PASS (all pairs ready or partial)"}`)
    process.exit(anyFail ? 1 : 0)
  }

  // Optional pre-flight stale-lock sweep
  if (args.clearLocks) {
    const sportFilter = sports.length === 1 ? sports[0] : "all"
    const sweep = runClearLocksSweep(sportFilter)
    if (!sweep.ok) {
      console.log("[settlement:run] ⚠ stale-lock sweep returned non-zero — proceeding anyway")
    }
    console.log("")
  }

  // Sanity: nightly CLI must exist (the chain target)
  if (!fs.existsSync(NIGHTLY_CLI)) {
    console.error(`[settlement:run] FATAL: nightlyReview CLI not found at ${NIGHTLY_CLI}`)
    process.exit(2)
  }

  // Execute per (sport, date) pair
  const summary = []
  for (const sport of sports) {
    executePair(sport, args.date, args, summary)
  }

  // Final summary + exit
  printSummary(summary, Date.now() - t0)
  process.exit(exitVerdict(summary))
}

main()
