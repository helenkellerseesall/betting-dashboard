#!/usr/bin/env node
"use strict"

/**
 * backfillLedgerFromTracked — Lane B Phase 3 v0.2 (2026-05-27).
 *
 * One-shot backfill: import tracked_bets entries into personal_ledger for dates
 * where the auto-mirror stopped. Operator's personal_ledger had data through
 * 2026-05-23 but tracked_bets accumulated picks through 2026-05-27. Without
 * this backfill, the FE GRADES tab shows stale data from May 23.
 *
 *   Usage:
 *     npm run ledger:backfill                    # backfill last 7 days, both sports
 *     npm run ledger:backfill -- --from=2026-05-24 --to=2026-05-27
 *     npm run ledger:backfill -- --sport=nba     # NBA only
 *     npm run ledger:backfill -- --dry-run       # don't write, just count
 *
 * Idempotent — `importFromTrackedBets` checks for existing IDs and skips
 * already-imported bets. Safe to re-run.
 */

const path = require("path")
const fs = require("fs")
const { importFromTrackedBets } = require(path.join(__dirname, "..", "pipeline", "shared", "buildPersonalLedger"))

function parseArgs() {
  const out = { from: null, to: null, sport: null, dryRun: false, days: 7 }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--from=")) out.from = a.slice(7)
    else if (a.startsWith("--to=")) out.to = a.slice(5)
    else if (a.startsWith("--sport=")) out.sport = a.slice(8).toLowerCase()
    else if (a.startsWith("--days=")) out.days = Number(a.slice(7)) || 7
    else if (a === "--dry-run") out.dryRun = true
  }
  return out
}

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function dateRange(from, to) {
  const out = []
  const start = new Date(from + "T00:00:00")
  const end = new Date(to + "T00:00:00")
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(localDateKey(d))
  }
  return out
}

function main() {
  const args = parseArgs()
  const today = new Date()
  const fromDate = args.from || localDateKey(new Date(today.getTime() - (args.days - 1) * 86400 * 1000))
  const toDate = args.to || localDateKey(today)
  const dates = dateRange(fromDate, toDate)
  const sports = args.sport ? [args.sport] : ["nba", "mlb"]

  console.log(`=== Ledger backfill ===`)
  console.log(`Window: ${fromDate} → ${toDate} (${dates.length} dates)`)
  console.log(`Sports: ${sports.join(", ")}`)
  console.log(`Dry run: ${args.dryRun}`)
  console.log("")

  const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
  let totalAdded = 0
  let totalSkipped = 0
  const perDate = []
  for (const date of dates) {
    for (const sport of sports) {
      const trackedPath = path.join(TRACKING_DIR, `${sport}_tracked_bets_${date}.json`)
      if (!fs.existsSync(trackedPath)) {
        console.log(`  skip   ${sport} ${date} — no tracked_bets file`)
        continue
      }
      if (args.dryRun) {
        // Count what WOULD be added without actually writing
        const tracked = JSON.parse(fs.readFileSync(trackedPath, "utf8"))
        console.log(`  dry    ${sport} ${date} — ${tracked.length} tracked_bets (would attempt import)`)
        continue
      }
      try {
        const r = importFromTrackedBets({ sport, date })
        if (r.ok === false) {
          console.log(`  empty  ${sport} ${date} — ${r.reason}`)
          continue
        }
        // importFromTrackedBets returns { ok, added, skipped } where added and
        // skipped are NUMBERS (counts), not arrays. Don't .length them.
        const added = typeof r?.added === "number" ? r.added : (r?.added?.length || 0)
        const skipped = typeof r?.skipped === "number" ? r.skipped : (r?.skipped?.length || 0)
        totalAdded += added
        totalSkipped += skipped
        perDate.push({ sport, date, added, skipped })
        console.log(`  done   ${sport} ${date} — added ${added}, skipped ${skipped} (already in ledger)`)
      } catch (e) {
        console.error(`  ERROR  ${sport} ${date} — ${e.message}`)
      }
    }
  }
  console.log("")
  console.log(`=== Summary ===`)
  console.log(`Total new entries added: ${totalAdded}`)
  console.log(`Total skipped (already in ledger): ${totalSkipped}`)
  if (totalAdded > 0) {
    console.log(`Personal ledger updated. iPhone GRADES tab will show fresh data on next refresh.`)
  } else {
    console.log(`No new entries to add — ledger already in sync.`)
  }
}

main()
