#!/usr/bin/env node
"use strict"

/**
 * runGradingBackfillAll.js — Phase Grading-Calibration-Operations-1B (2026-05-14)
 *
 *   Usage:
 *     npm run grading:backfill-all                          # both sports, every settled date
 *     npm run grading:backfill-all -- --sport=mlb
 *     npm run grading:backfill-all -- --sport=nba --dry
 *
 * Iterates every `(sport, date)` pair where `tracked_bets_{sport}_{date}.json`
 * has at least one settled bet (result ∈ {win,loss,push,unresolved}) AND
 * either:
 *   - the corresponding SQLite outcome_snapshots row count is < the JSON
 *     settled count, OR
 *   - --force is passed.
 *
 * For each qualifying (sport, date), invokes the existing canonical CLI:
 *   node scripts/nightlyReview.js --sport=<X> --date=<YYYY-MM-DD>
 *
 * Reuses (does NOT duplicate) the existing orchestrator entry point at
 * `scripts/nightlyReview.js`, which itself calls `runNightlyReview()` in
 * `pipeline/shared/buildNightlyOrchestrator.js`.
 *
 * Architectural compliance:
 *   - Additive only — no existing CLI / orchestrator / writer modified.
 *   - Idempotent — every underlying writer uses INSERT OR IGNORE / REPLACE.
 *     Re-running this against a fully-backfilled state is a no-op.
 *   - Replay-safe — invokes the same handler the operator would call manually.
 *   - Transparent — echoes every `(sport, date)` decision (skip / run / fail)
 *     with per-date elapsed timing.
 *   - Single canonical owner (Law 1) — wraps `scripts/nightlyReview.js`,
 *     does not duplicate orchestrator logic.
 *
 * Failure behavior:
 *   - Per-date failures are recorded in a tally but NEVER halt the loop.
 *   - Exit code 0 if every qualifying date succeeded; 1 if any failed.
 */

const fs   = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const REPO_ROOT    = path.join(__dirname, "..", "..")
const NIGHTLY_CLI  = path.join(REPO_ROOT, "scripts", "nightlyReview.js")
// H2: one game-date authority (Law 1) — reuse settlementRun's exported helper to decide
// whether a slate's GAMES are PAST (so 0-settled = real failure) vs today/future (expected pending).
const { slateGameDateStatus } = require("./settlementRun")

function parseArgs() {
  const out = { sport: null, dry: false, force: false, verbose: false, clearLocks: false }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length).toLowerCase()
    else if (a === "--dry")          out.dry = true
    else if (a === "--force")        out.force = true
    else if (a === "--verbose")      out.verbose = true
    else if (a === "--clear-locks")  out.clearLocks = true   // Phase 1F (INC-014)
  }
  return out
}

// Phase Grading-Diagnostic-1A (2026-06-21): build the diagnostic tail lines for a
// failed per-date spawn. nightlyReview writes its failure reason to STDOUT (not
// stderr), so surface BOTH. Exported for unit testing.
function failTailLines(res) {
  const lines = []
  const tail = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-3).join(" | ")
  if (res && res.stderr) lines.push(`       stderr tail: ${tail(res.stderr)}`)
  if (res && res.stdout) lines.push(`       stdout tail: ${tail(res.stdout)}`)
  return lines
}

/**
 * Phase 1F (INC-014 fix — deterministic backfill restoration).
 *
 * Scan TRACKING_DIR for `.nightly_lock_*` files. For each, probe the recorded
 * pid with `process.kill(pid, 0)`:
 *   - dead owner (ESRCH)         → safe to unlink (crash leftover)
 *   - live owner                 → leave alone (legitimate concurrent run)
 *   - missing pid / parse error  → leave alone (operator can `--force` to reclaim
 *                                  the underlying orchestrator's age-based path)
 *
 * Operator usage:
 *     npm run grading:backfill-all -- --clear-locks            # both sports
 *     npm run grading:backfill-all -- --sport=mlb --clear-locks # mlb only
 *
 * Always followed by the normal backfill loop — the flag is additive.
 */
// Phase 1G (INC-015): mirror the orchestrator's age-aware reclaim heuristic.
// A lock whose startedAt is older than this threshold is almost certainly
// pid-reuse if the probed pid still reports alive — the original orchestrator
// always finishes in well under 60 seconds.
const ALIVE_PID_STALE_THRESHOLD_MS = 10 * 60 * 1000  // 10 minutes

function clearStaleLocks(sportFilter) {
  let files = []
  try {
    files = fs.readdirSync(TRACKING_DIR).filter((f) => f.startsWith(".nightly_lock_"))
  } catch (_) { return { scanned: 0, reclaimed: 0, alive: 0, reclaimedStale: 0, skipped: 0 } }
  const tally = { scanned: 0, reclaimed: 0, alive: 0, reclaimedStale: 0, skipped: 0 }
  for (const f of files) {
    tally.scanned++
    // Filename shape: .nightly_lock_<sport>_<date>
    const m = f.match(/^\.nightly_lock_(mlb|nba)_(\d{4}-\d{2}-\d{2})$/)
    if (!m) { tally.skipped++; continue }
    const lockSport = m[1]
    if (sportFilter && lockSport !== sportFilter) { tally.skipped++; continue }
    const lp = path.join(TRACKING_DIR, f)
    let pid = null
    let startedAt = null
    try {
      const content = JSON.parse(fs.readFileSync(lp, "utf8"))
      pid = Number(content.pid)
      startedAt = content.startedAt
    } catch (_) {}
    if (!Number.isFinite(pid) || pid <= 0) {
      console.log(`  ${f}  → SKIP (no pid recorded)`)
      tally.skipped++
      continue
    }
    const age = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity
    try {
      process.kill(pid, 0)
      // Phase 1G: alive pid but lock is older than stale threshold → pid reuse → reclaim.
      if (age > ALIVE_PID_STALE_THRESHOLD_MS) {
        try {
          fs.unlinkSync(lp)
          console.log(`  ${f}  → RECLAIMED-STALE pid=${pid} alive but ${Math.round(age/1000)}s old (likely pid reuse)`)
          tally.reclaimedStale++
        } catch (unlinkErr) {
          console.log(`  ${f}  → SKIP (pid-reuse suspected pid=${pid} age=${Math.round(age/1000)}s but unlink failed: ${unlinkErr.code})`)
          tally.skipped++
        }
      } else {
        console.log(`  ${f}  → ALIVE pid=${pid} age=${Math.round(age/1000)}s (legitimate concurrent run; not unlinked)`)
        tally.alive++
      }
    } catch (e) {
      if (e && e.code === "ESRCH") {
        try {
          fs.unlinkSync(lp)
          console.log(`  ${f}  → RECLAIMED (dead pid=${pid})`)
          tally.reclaimed++
        } catch (unlinkErr) {
          console.log(`  ${f}  → SKIP (dead pid=${pid} but unlink failed: ${unlinkErr.code})`)
          tally.skipped++
        }
      } else {
        console.log(`  ${f}  → SKIP (probe error ${e?.code || e?.message}; pid=${pid})`)
        tally.skipped++
      }
    }
  }
  return tally
}

function listDatesForSport(sport) {
  const prefix = `${sport}_tracked_bets_`
  let files = []
  try {
    files = fs.readdirSync(TRACKING_DIR).filter((f) =>
      f.startsWith(prefix) && f.endsWith(".json") && !f.includes("9999")
    )
  } catch (_) {}
  const out = []
  for (const f of files) {
    const m = f.match(/(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    const date = m[1]
    const fp = path.join(TRACKING_DIR, f)
    let settled = 0
    let total   = 0
    try {
      const arr = JSON.parse(fs.readFileSync(fp, "utf8"))
      const bets = Array.isArray(arr) ? arr : []
      total   = bets.length
      settled = bets.filter((b) => b.result && ["win", "loss", "push", "unresolved"].includes(b.result)).length
    } catch (_) {}
    out.push({ sport, date, total, settled, file: f })
  }
  return out
}

function getSqliteOutcomeCountByDate(sport) {
  try {
    const { tryGetDb } = require("../storage/db")
    const db = tryGetDb()
    if (!db) return null
    const rows = db
      .prepare("SELECT run_date AS date, COUNT(*) AS n FROM outcome_snapshots WHERE sport = ? GROUP BY run_date")
      .all(sport)
    const out = {}
    for (const r of rows) out[r.date] = r.n
    return out
  } catch (_) {
    return null
  }
}

function main() {
  const t0 = Date.now()
  const args = parseArgs()
  const sports = args.sport ? [args.sport] : ["mlb", "nba"]

  console.log("=== grading:backfill-all — Phase Grading-Calibration-Operations-1B ===")
  console.log(`sports        : ${sports.join(", ")}`)
  console.log(`dry-run       : ${args.dry}`)
  console.log(`force         : ${args.force}`)
  console.log(`clear-locks   : ${args.clearLocks}`)
  console.log(`nightly CLI   : ${NIGHTLY_CLI}`)
  console.log("")

  if (!fs.existsSync(NIGHTLY_CLI)) {
    console.error(`FATAL: nightlyReview CLI not found at ${NIGHTLY_CLI}`)
    process.exit(2)
  }

  // Phase 1F (INC-014) + Phase 1G (INC-015): optional pre-flight stale-lock sweep.
  if (args.clearLocks) {
    console.log("── stale-lock pre-flight sweep ──")
    const filterSport = args.sport && ["mlb", "nba"].includes(args.sport) ? args.sport : null
    const lockTally = clearStaleLocks(filterSport)
    console.log(`  scanned=${lockTally.scanned}  reclaimed-dead=${lockTally.reclaimed}  reclaimed-stale=${lockTally.reclaimedStale}  alive=${lockTally.alive}  skipped=${lockTally.skipped}\n`)
  }

  const tally = { considered: 0, skipped: 0, run: 0, failed: 0, errors: [] }
  const perDate = []

  for (const sport of sports) {
    const dateRows = listDatesForSport(sport).sort((a, b) => a.date.localeCompare(b.date))
    const outcomeCounts = getSqliteOutcomeCountByDate(sport) || {}

    console.log(`── ${sport.toUpperCase()} ──`)
    if (dateRows.length === 0) {
      console.log(`  (no tracked_bets_*.json files found)\n`)
      continue
    }

    for (const r of dateRows) {
      tally.considered++
      const sqliteCount = outcomeCounts[r.date] || 0
      const needsBackfill = r.settled > sqliteCount

      // H2: a slate that settled ZERO is a real FAILURE only if its GAMES are PAST (graded too late /
      // settlement gap). Before its games play, 0 settled is expected pending — keep the benign SKIP.
      const gs0 = r.settled === 0 ? slateGameDateStatus(sport, r.date) : null
      const past0 = r.settled === 0 && gs0 && gs0.gamesPast === true

      const decision = r.settled === 0
        ? (past0 ? `FAIL (0 settled · games ${gs0.maxGameDate} PAST)` : "SKIP (no settled · games not played yet)")
        : (!needsBackfill && !args.force)
          ? `SKIP (SQLite already has ${sqliteCount} ≥ JSON ${r.settled})`
          : args.dry
            ? `WOULD RUN (settled=${r.settled} sqlite=${sqliteCount})`
            : `RUN (settled=${r.settled} sqlite=${sqliteCount}${needsBackfill ? " — backfill" : " — force"})`

      console.log(`  ${r.date}  total=${String(r.total).padStart(4)}  settled=${String(r.settled).padStart(4)}  sqlite=${String(sqliteCount).padStart(4)}   ${decision}`)

      if (r.settled === 0) {
        if (past0) {
          tally.failed++   // H2: PAST games, 0 settled → RESULT: FAIL → exit 1 (never a silent SKIP/PASS)
          tally.errors.push({ sport, date: r.date, exitCode: "PAST_0_SETTLED", stderr: "", stdout: `games ${gs0.maxGameDate} are PAST but 0 bets settled — settlement/grading gap` })
          console.log(`    → FAIL  (0 settled on a PLAYED slate — not graded)`)
          perDate.push({ sport, date: r.date, status: "fail", reason: "past_0_settled" })
        } else {
          tally.skipped++   // games today/future (or no gameTime) → expected pending
        }
        continue
      }
      if (!needsBackfill && !args.force) {
        tally.skipped++
        continue
      }
      if (args.dry) {
        tally.skipped++
        continue
      }

      // Invoke the canonical CLI synchronously
      const stepArgs = [
        NIGHTLY_CLI,
        `--sport=${sport}`,
        `--date=${r.date}`,
        ...(args.force ? ["--force"] : []),
        ...(args.verbose ? [] : ["--quiet"]),
      ]
      const tStart = Date.now()
      const res = spawnSync("node", stepArgs, { stdio: args.verbose ? "inherit" : "pipe", encoding: "utf8" })
      const ms = Date.now() - tStart

      if (res.status === 0) {
        tally.run++
        console.log(`    → PASS  (${ms}ms)`)
        perDate.push({ sport, date: r.date, status: "pass", ms })
      } else {
        tally.failed++
        tally.errors.push({ sport, date: r.date, exitCode: res.status, stderr: (res.stderr || "").slice(-400), stdout: (res.stdout || "").slice(-400) })
        console.log(`    → FAIL  (exit=${res.status}, ${ms}ms)`)
        // Phase Grading-Diagnostic-1A (2026-06-21): nightlyReview prints its failure
        // reason (e.g. "Already running: already_running", "DEFERRED") to STDOUT via
        // console.log, not stderr — so showing only stderr left the actual cause invisible
        // in the nightly log. Surface BOTH tails on failure.
        if (!args.verbose) for (const line of failTailLines(res)) console.log(line)
        perDate.push({ sport, date: r.date, status: "fail", ms, exitCode: res.status })
      }
    }
    console.log("")
  }

  const elapsedMs = Date.now() - t0
  console.log("─".repeat(70))
  console.log(`SUMMARY  considered=${tally.considered}  ran=${tally.run}  skipped=${tally.skipped}  failed=${tally.failed}`)
  console.log(`         total elapsed=${elapsedMs}ms`)
  console.log(`RESULT: ${tally.failed === 0 ? "PASS" : "FAIL"}`)

  if (tally.errors.length > 0) {
    console.log("\nFailed dates:")
    for (const e of tally.errors) {
      console.log(`  - ${e.sport}/${e.date} exit=${e.exitCode}`)
    }
  }

  // Phase Outcome-Links-Wire-1A (2026-06-03) — after settling all tracked_bets
  // via the per-date loop above, grade the parsed_slips against those outcomes
  // via outcomeLinksPopulator. This populator was shipped as task #3
  // (Screenshot-Loop-Close-2B) but never wired into any autopilot path —
  // outcome_links table stayed at 0 rows, breaking the screenshot intelligence
  // learning loop at the second hop (bettorProfiles updated on classification
  // but no settled-outcome feedback). Inline call here so it runs in the
  // same nightly window as bet settlement. Wrapped in try/catch — any failure
  // here does NOT fail the whole grading job (we still want to exit 0 if the
  // per-date bet settlement succeeded).
  try {
    const Database = require("better-sqlite3")
    const dbPath = path.join(__dirname, "..", "storage", "betting.db")
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: false })
      try {
        const { gradeAllUngraded, refreshBettorProfileOutcomeStats } = require("../pipeline/screenshots/outcomeLinksPopulator")
        const r1 = gradeAllUngraded(db)
        const r2 = refreshBettorProfileOutcomeStats(db)
        const cov = r1.totalLegs > 0 ? (100 * r1.gradedLegs / r1.totalLegs).toFixed(1) : "n/a"
        console.log(`[outcomeLinks] slipsProcessed=${r1.slipsProcessed} fullyGraded=${r1.fullyGradedSlips} legCoverage=${cov}% (${r1.gradedLegs}/${r1.totalLegs}) · profilesUpdated=${r2.profilesUpdated}`)
      } finally {
        db.close()
      }
    } else {
      console.log("[outcomeLinks] betting.db not found at " + dbPath + " — skipping")
    }
  } catch (e) {
    console.error("[outcomeLinks] failed:", (e && e.message) || e)
    // do not fail the whole grading job
  }

  process.exit(tally.failed === 0 ? 0 : 1)
}

// Phase Grading-Diagnostic-1A (2026-06-21): export pure helper for unit testing.
// main() only auto-runs when invoked directly via `node scripts/runGradingBackfillAll.js`;
// require()ing this file (e.g. from a probe) does NOT mutate the DB.
module.exports = { failTailLines }

if (require.main === module) main()
