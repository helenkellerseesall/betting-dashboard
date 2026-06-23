#!/usr/bin/env node
"use strict"

/**
 * runHistoricalGrade — automated historical grading + reconciliation runner.
 *
 * Usage:
 *   node backend/scripts/runHistoricalGrade.js --sport=mlb --date=2026-05-08
 *   node backend/scripts/runHistoricalGrade.js --sport=nba --date=2026-05-07
 *   node backend/scripts/runHistoricalGrade.js --sport=all --date=2026-05-08
 *   node backend/scripts/runHistoricalGrade.js --sport=mlb --backfill
 *   node backend/scripts/runHistoricalGrade.js --sport=all --backfill
 *   node backend/scripts/runHistoricalGrade.js --sport=mlb --backfill --retry-unresolved
 *
 * Flags:
 *   --sport=mlb|nba|all   Sport to grade (required)
 *   --date=YYYY-MM-DD     Grade a single date
 *   --backfill            Grade ALL dates with pending/unresolved tracked_bets
 *   --retry-unresolved    Also re-attempt bets marked "unresolved" (not just "pending")
 *   --summary-only        Skip grading; just regenerate summaries from existing data
 *   --dry-run             Run without writing any files (print what would happen)
 *   --verbose             Print per-bet debug output
 *   --no-orchestrate      Phase Settlement-1A (AUTO-1) — suppress the post-grading
 *                          automatic chain to nightlyReview.js. By default, every
 *                          successful per-date grading pass automatically invokes
 *                          the nightly orchestrator for the same (sport,date) so
 *                          outcome_snapshots / personal_ledger / process_classifications
 *                          populate without a second operator command.
 *
 * Pipeline per sport+date:
 *   1. fetchGameResults     — fetch player stat lines from API
 *   2. gradeTrackedBets     — settle individual bets in tracked_bets_{date}.json
 *   3. gradeTrackedSlips    — settle slip parlays in tracked_slips_{date}.json
 *   4. buildGradingSummary  — write grading_summary_{sport}_{date}.json
 *
 * All unresolved records are explicitly stamped result="unresolved" with a
 * settledAt timestamp so they can be identified and retried. "pending" means
 * the game data wasn't fetched at all.
 *
 * Exit codes:
 *   0 — all dates graded (or no pending dates found)
 *   1 — partial failure (some dates had API errors, printed to stderr)
 *   2 — bad arguments
 */

const fs   = require("fs/promises")
const path = require("path")
const { spawnSync } = require("child_process")

const RUNTIME_DIR = path.join(__dirname, "..", "runtime", "tracking")
// Phase Settlement-GameDate-1A (2026-06-04) — canonical ET calendar date for a
// timestamp, used to derive a game's actual play-date from its gameTime.
const { calendarDateForTimestamp, currentSlateDateEt } = require("../pipeline/shared/slateDate")

// Phase Settlement-Orchestration-1A (AUTO-1): post-grading chain to the
// canonical nightlyReview.js orchestrator. After every successful per-date
// grading pass, we automatically invoke the orchestrator for the same
// (sport, date) — closing the historical gap where graded JSON sat without
// being mirrored into outcome_snapshots / personal_ledger / process_classifications.
//
// The chain hook respects the existing acquireLock contract in
// buildNightlyOrchestrator.js (Phase 1F + 1G PID-liveness + age-aware reclaim);
// it does NOT bypass any safety mechanism. The orchestrator's INSERT OR REPLACE
// semantics on outcome_snapshots make this idempotent on re-runs.
//
// The hook is suppressed in any of these cases (anti-fabrication discipline):
//   - opts.dryRun        — no grading writes occurred
//   - opts.summaryOnly   — no grading writes occurred
//   - opts.noOrchestrate — operator opted out via --no-orchestrate
//   - betSummary.settled === 0 — grading produced no settled rows for this date
//
// Logging is operator-visible at every transition (start / success / failure /
// skip). The orchestrator's own per-step logs continue to print normally.
const NIGHTLY_CLI = path.join(__dirname, "..", "..", "scripts", "nightlyReview.js")

function shouldChainOrchestrator(opts, gradeResult) {
  if (!opts) return false
  if (opts.dryRun)        return false
  if (opts.summaryOnly)   return false
  if (opts.noOrchestrate) return false
  if (!gradeResult || gradeResult.success !== true) return false
  // `betSummary` shape from gradeTrackedBets:
  //   { graded, wins, losses, pushes, unresolved, alreadySettled, total }
  // Chain whenever there is ANY settled row on the date (newly settled in this
  // pass OR previously settled). Idempotent: nightlyReview uses INSERT OR REPLACE
  // on outcome_snapshots so re-running is safe. We only skip when the date has
  // zero settled rows (nothing to record).
  const bs = gradeResult.betSummary || {}
  const settledTotal = Number(bs.graded ?? 0) + Number(bs.alreadySettled ?? 0)
  if (!Number.isFinite(settledTotal) || settledTotal <= 0) return false
  return true
}

function chainNightlyReview(sport, date) {
  console.log(`[settlement-1A] ── chaining nightlyReview ${sport}/${date} ──`)
  console.log(`[settlement-1A] exec: node ${NIGHTLY_CLI} --sport=${sport} --date=${date} --force --quiet`)
  const t0 = Date.now()
  const r = spawnSync(
    "node",
    [NIGHTLY_CLI, `--sport=${sport}`, `--date=${date}`, "--force", "--quiet"],
    { stdio: "inherit" }
  )
  const ms = Date.now() - t0
  if (r.status === 0) {
    console.log(`[settlement-1A] ✓ nightlyReview ${sport}/${date} succeeded (${ms}ms) — outcome_snapshots / personal_ledger / process_classifications updated`)
    return { ok: true, ms }
  }
  console.log(`[settlement-1A] ✗ nightlyReview ${sport}/${date} FAILED (exit=${r.status}, ${ms}ms) — outcome_snapshots may be missing for this date`)
  console.log(`[settlement-1A]   diagnose: \`npm run grading:backfill-all -- --sport=${sport} --clear-locks --dry\``)
  return { ok: false, ms, exitCode: r.status }
}

// ── Lazy imports (avoid loading heavy modules until needed) ──────────────────

function getMlbFetcher() {
  const { fetchMlbGameResults, getStatValue } = require("../pipeline/grading/fetchMlbGameResults")
  return { fetchGameResults: fetchMlbGameResults, getStatValue }
}

function getNbaFetcher() {
  const { fetchNbaGameResults, getNbaStatValue } = require("../pipeline/grading/fetchNbaGameResults")
  return { fetchGameResults: fetchNbaGameResults, getStatValue: getNbaStatValue }
}

const { gradeTrackedBets }    = require("../pipeline/grading/gradeTrackedBets")
const { gradeTrackedSlips }   = require("../pipeline/grading/gradeTrackedSlips")
const { buildGradingSummary } = require("../pipeline/grading/buildGradingSummary")

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    sport: null,
    date: null,
    backfill: false,
    retryUnresolved: false,
    summaryOnly: false,
    dryRun: false,
    verbose: false,
    // Phase Settlement-Orchestration-1A (AUTO-1): default ON.
    // Operator can suppress via --no-orchestrate.
    noOrchestrate: false,
  }
  for (const arg of args) {
    if (arg.startsWith("--sport="))  opts.sport = arg.slice(8).toLowerCase()
    else if (arg.startsWith("--date="))   opts.date  = arg.slice(7)
    else if (arg === "--backfill")        opts.backfill = true
    else if (arg === "--retry-unresolved") opts.retryUnresolved = true
    else if (arg === "--summary-only")    opts.summaryOnly = true
    else if (arg === "--dry-run")         opts.dryRun = true
    else if (arg === "--verbose")         opts.verbose = true
    else if (arg === "--no-orchestrate")  opts.noOrchestrate = true   // Phase Settlement-1A (AUTO-1)
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return opts
}

// ── File discovery ───────────────────────────────────────────────────────────

/**
 * Find all tracked_bets files for a sport that have any pending/unresolved rows.
 * Returns an array of date strings (YYYY-MM-DD), sorted ascending.
 */
async function findPendingDates(sport, retryUnresolved) {
  let files
  try {
    files = await fs.readdir(RUNTIME_DIR)
  } catch {
    return []
  }

  const pattern = new RegExp(`^${sport}_tracked_bets_(\\d{4}-\\d{2}-\\d{2})\\.json$`)
  const dates = []

  for (const f of files) {
    const m = f.match(pattern)
    if (!m) continue

    // Skip sentinel file
    if (m[1] === "9999-12-31") continue

    const filePath = path.join(RUNTIME_DIR, f)
    let bets
    try {
      const raw = await fs.readFile(filePath, "utf8")
      bets = JSON.parse(raw)
    } catch {
      continue
    }

    if (!Array.isArray(bets)) continue

    const hasPending     = bets.some((b) => !b.result || b.result === "pending")
    const hasUnresolved  = retryUnresolved && bets.some((b) => b.result === "unresolved")

    if (hasPending || hasUnresolved) {
      dates.push(m[1])
    }
  }

  return dates.sort()
}

/**
 * Phase Settlement-GameDate-1A (2026-06-04) — derive the ACTUAL game calendar
 * dates a slate's bets need, from each bet's gameTime (ET).
 *
 * Why: tracked_bets files are named by SLATE date (when the slate was built),
 * but the games they cover often play on a DIFFERENT calendar day (slate built
 * Tuesday -> games Wednesday). The settler used to fetch results for the slate
 * date, so off-date games never matched and bets sat "pending" forever, freezing
 * the calibration corpus. We fetch results for every distinct ET game-date in
 * the file instead. Slate-date doctrine is UNCHANGED — file naming stays slate
 * date; only the results FETCH keys off game-date.
 *
 * Returns dates SORTED ASCENDING. Falls back to [slateDate] when no usable
 * gameTime exists, so nothing is ever skipped.
 */
async function gameDatesForSlate(sport, slateDate) {
  const filePath = path.join(RUNTIME_DIR, `${sport}_tracked_bets_${slateDate}.json`)
  let bets
  try {
    bets = JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return [slateDate]
  }
  if (!Array.isArray(bets)) return [slateDate]
  const dates = new Set()
  for (const b of bets) {
    const gt = b && b.gameTime
    if (!gt) continue
    const ms = new Date(gt).getTime()
    if (!Number.isFinite(ms)) continue
    dates.add(calendarDateForTimestamp(ms)) // game's ET calendar date
  }
  if (dates.size === 0) return [slateDate]
  return [...dates].sort() // ascending — the merge below relies on this order
}

// ── Per-date grading ─────────────────────────────────────────────────────────

async function gradeDate({ sport, date, fetcher, opts }) {
  const { dryRun, verbose, summaryOnly } = opts

  console.log(`\n── ${sport.toUpperCase()} ${date} ──`)

  if (summaryOnly) {
    const summary = await buildGradingSummary({ sport, date, write: !dryRun })
    printSummary(sport, date, summary)
    return { success: true, summary }
  }

  // 1. Fetch game results — for the ACTUAL game date(s), not the slate date.
  // tracked_bets are slate-date-named but cover games that may play on another
  // calendar day (Phase Settlement-GameDate-1A). Fetch each distinct ET
  // game-date and MERGE into one map (gradeTrackedBets matches by player name).
  let resultsMap = new Map()
  let gameResultsFailure = false   // H2: a PAST slate that fetched 0 results = real failure → caller exits non-zero (not a green)
  if (!dryRun) {
    const gameDates = await gameDatesForSlate(sport, date)
    try {
      // MERGE collision rule (deterministic): iterate gameDates ASCENDING and
      // let later (NEWER) dates overwrite earlier ones — last-write-wins. So if
      // the same player has stats on two fetched dates (rare: late game crossing
      // midnight, doubleheader spanning the slate, mid-series), the NEWER date's
      // line wins. Deterministic because gameDates is sorted, not Set/object
      // order. Precise fix for that rare case = match each bet to its own
      // gameTime-date map; refinement, not needed for the common single-date slate.
      for (const gd of gameDates) {
        const dayMap = await fetcher.fetchGameResults(gd)
        for (const [name, stats] of dayMap) resultsMap.set(name, stats)
      }
    } catch (err) {
      console.error(`  ✗ fetchGameResults failed: ${err.message}`)
      return { success: false, error: err.message }
    }

    const dlabel = (gameDates.length === 1 && gameDates[0] === date)
      ? date
      : `${gameDates.join(", ")} (slate ${date})`
    if (resultsMap.size === 0) {
      // #4 future-aware: 0 results is EXPECTED when the slate's games haven't been played yet
      // (its game-date(s) are today/future). It's a real failure only once the games are PAST.
      const maxGameDate = gameDates.length ? gameDates[gameDates.length - 1] : date
      const gamesPast = currentSlateDateEt() > maxGameDate   // 4 AM boundary: grade for game-date D runs at 4 AM D+1
      if (!gamesPast) {
        console.log(`  ⏳ pending: games for slate ${date} play ${maxGameDate} (not yet played) — bets stay pending (expected, not a failure)`)
      } else {
        gameResultsFailure = true   // H2: PAST games + 0 results → this date FAILED; caller must exit non-zero, never green
        console.warn(`  ⚠ RED: games for ${dlabel} are PAST but 0 results fetched — real data/grading failure, bets stuck pending`)
      }
    } else {
      console.log(`  ✓ Fetched ${resultsMap.size} player stat lines for game-date(s) ${dlabel}`)
      if (verbose) {
        for (const [name, stats] of resultsMap) {
          console.log(`    ${name}: ${JSON.stringify(stats)}`)
        }
      }
    }
  } else {
    console.log(`  [dry-run] Would fetch game results for slate ${date} (resolved to game-date(s))`)
  }

  // 2. Grade individual bets
  let betSummary = {}
  if (!dryRun) {
    betSummary = await gradeTrackedBets({
      sport,
      date,
      resultsMap,
      getStatValue: fetcher.getStatValue,
    })
  } else {
    console.log(`  [dry-run] Would grade bets for ${sport} ${date}`)
  }

  // 3. Grade slip parlays
  let slipSummary = {}
  if (!dryRun) {
    slipSummary = await gradeTrackedSlips({ sport, date })
  } else {
    console.log(`  [dry-run] Would grade slips for ${sport} ${date}`)
  }

  // 4. Build grading summary
  let summary = null
  if (!dryRun) {
    summary = await buildGradingSummary({ sport, date, write: true })
    printSummary(sport, date, summary)
  } else {
    console.log(`  [dry-run] Would write grading_summary_${sport}_${date}.json`)
  }

  return { success: !gameResultsFailure, betSummary, slipSummary, summary }
}

function printSummary(sport, date, summary) {
  const b = summary?.bets
  const s = summary?.slips
  if (!b) return

  const betHit = b.hitRate != null ? (b.hitRate * 100).toFixed(1) + "%" : "n/a"
  const slipHit = s?.hitRate != null ? (s.hitRate * 100).toFixed(1) + "%" : "n/a"
  const roi = b.roi != null ? b.roi.toFixed(1) + "%" : "n/a"

  console.log(
    `  BETS  → ${b.settled}/${b.total} settled` +
    ` | ${b.wins}W ${b.losses}L ${b.pushes}P` +
    ` | hit=${betHit}` +
    ` | roi=${roi}` +
    (b.unresolved > 0 ? ` | ⚠ ${b.unresolved} unresolved` : "") +
    (b.pending > 0    ? ` | ⏳ ${b.pending} pending` : "")
  )
  console.log(
    `  SLIPS → ${s?.settled || 0}/${s?.total || 0} settled` +
    ` | ${s?.wins || 0}W ${s?.losses || 0}L ${s?.pushes || 0}P` +
    ` | hit=${slipHit}` +
    (s?.unresolved > 0 ? ` | ⚠ ${s.unresolved} unresolved` : "") +
    (s?.pending > 0    ? ` | ⏳ ${s.pending} pending` : "")
  )

  // Per-tier breakdown
  if (b.byTier) {
    const tierLines = Object.entries(b.byTier)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([tier, g]) => {
        const hr = g.hitRate != null ? (g.hitRate * 100).toFixed(0) + "%" : "n/a"
        return `${tier}:${g.wins}W/${g.losses}L(${hr})`
      })
      .join("  ")
    if (tierLines) console.log(`  TIERS → ${tierLines}`)
  }

  // Per-statFamily breakdown
  if (b.byStatFamily) {
    const famLines = Object.entries(b.byStatFamily)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([fam, g]) => {
        const hr = g.hitRate != null ? (g.hitRate * 100).toFixed(0) + "%" : "n/a"
        return `${fam}:${g.wins}W/${g.losses}L(${hr})`
      })
      .join("  ")
    if (famLines) console.log(`  STATS → ${famLines}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()

  if (!opts.sport) {
    console.error("Error: --sport=mlb|nba|all is required")
    process.exit(2)
  }
  if (!opts.date && !opts.backfill) {
    console.error("Error: --date=YYYY-MM-DD or --backfill is required")
    process.exit(2)
  }

  const sports = opts.sport === "all" ? ["mlb", "nba"] : [opts.sport]
  let anyFailure = false

  for (const sport of sports) {
    let fetcher
    try {
      fetcher = sport === "mlb" ? getMlbFetcher() : getNbaFetcher()
    } catch (err) {
      console.error(`Failed to load fetcher for ${sport}: ${err.message}`)
      anyFailure = true
      continue
    }

    let dates = []
    if (opts.backfill) {
      dates = await findPendingDates(sport, opts.retryUnresolved)
      if (!dates.length) {
        console.log(`${sport.toUpperCase()}: No pending dates found — all bets settled ✓`)
        continue
      }
      console.log(`${sport.toUpperCase()}: Backfilling ${dates.length} date(s): ${dates.join(", ")}`)
    } else {
      dates = [opts.date]
    }

    for (const date of dates) {
      const result = await gradeDate({ sport, date, fetcher, opts })
      if (!result.success) {
        anyFailure = true
      }
      // Phase Settlement-Orchestration-1A (AUTO-1): chain to nightlyReview.js for
      // this (sport, date) so outcome_snapshots / personal_ledger / process_classifications
      // are populated automatically. Respects --no-orchestrate / --dry-run /
      // --summary-only flags; skipped when zero rows actually settled.
      if (shouldChainOrchestrator(opts, result)) {
        const chain = chainNightlyReview(sport, date)
        if (!chain.ok) anyFailure = true
      } else if (!opts.noOrchestrate && !opts.dryRun && !opts.summaryOnly) {
        const bs = result?.betSummary || {}
        const settledTotal = Number(bs.graded ?? 0) + Number(bs.alreadySettled ?? 0)
        if (settledTotal <= 0) {
          console.log(`[settlement-1A] · skipping nightlyReview ${sport}/${date} — no settled rows on this date (nothing to record)`)
        }
      }
    }
  }

  console.log("\n── Done ──")
  process.exit(anyFailure ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal:", err.message)
  process.exit(1)
})
