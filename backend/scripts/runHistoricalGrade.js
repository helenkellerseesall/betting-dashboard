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

const RUNTIME_DIR = path.join(__dirname, "..", "runtime", "tracking")

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
  }
  for (const arg of args) {
    if (arg.startsWith("--sport="))  opts.sport = arg.slice(8).toLowerCase()
    else if (arg.startsWith("--date="))   opts.date  = arg.slice(7)
    else if (arg === "--backfill")        opts.backfill = true
    else if (arg === "--retry-unresolved") opts.retryUnresolved = true
    else if (arg === "--summary-only")    opts.summaryOnly = true
    else if (arg === "--dry-run")         opts.dryRun = true
    else if (arg === "--verbose")         opts.verbose = true
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

// ── Per-date grading ─────────────────────────────────────────────────────────

async function gradeDate({ sport, date, fetcher, opts }) {
  const { dryRun, verbose, summaryOnly } = opts

  console.log(`\n── ${sport.toUpperCase()} ${date} ──`)

  if (summaryOnly) {
    const summary = await buildGradingSummary({ sport, date, write: !dryRun })
    printSummary(sport, date, summary)
    return { success: true, summary }
  }

  // 1. Fetch game results
  let resultsMap = new Map()
  if (!dryRun) {
    try {
      resultsMap = await fetcher.fetchGameResults(date)
    } catch (err) {
      console.error(`  ✗ fetchGameResults failed: ${err.message}`)
      return { success: false, error: err.message }
    }

    if (resultsMap.size === 0) {
      console.warn(`  ⚠ No game results fetched for ${date} — bets will remain pending`)
    } else {
      console.log(`  ✓ Fetched ${resultsMap.size} player stat lines`)
      if (verbose) {
        for (const [name, stats] of resultsMap) {
          console.log(`    ${name}: ${JSON.stringify(stats)}`)
        }
      }
    }
  } else {
    console.log(`  [dry-run] Would fetch game results for ${date}`)
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

  return { success: true, betSummary, slipSummary, summary }
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
    }
  }

  console.log("\n── Done ──")
  process.exit(anyFailure ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal:", err.message)
  process.exit(1)
})
