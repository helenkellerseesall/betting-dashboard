#!/usr/bin/env node
"use strict"

/**
 * backfillPredictionSnapshots.js — Phase Settlement-PredictionSource-1A (2026-06-04)
 *
 *   node scripts/backfillPredictionSnapshots.js                 # both sports, all dates
 *   node scripts/backfillPredictionSnapshots.js --sport=mlb     # MLB only
 *   node scripts/backfillPredictionSnapshots.js --dry           # enumerate only, no writes
 *
 * WHY: prediction_snapshots was written from live workstation_state, stamped with
 * "today's" slateDate — so a bet's prediction id drifted off the slate-date its
 * settled outcome uses (recordOutcome stamps the tracked_bets FILE's slate-date).
 * The ids never matched, so the calibration dampener's join produced nothing for
 * MLB after 2026-05-17. This re-snapshots each {sport}_tracked_best_{date}.json
 * under THAT file's slate-date — the same source/date the settler uses — so a
 * curated pick's prediction id finally equals its outcome id and the join
 * un-freezes. Idempotent: snapshotPredictions uses INSERT OR IGNORE on the id, so
 * re-running adds only the correctly-dated rows and never overwrites.
 *
 * Pairs with the forward fix in pipeline/memory/freezePredictionEpoch.js (which
 * now sources predictions from tracked_best for new snapshots).
 */

const fs   = require("fs")
const path = require("path")
const intel = require("../storage/intelligence")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const RE = /^(mlb|nba)_tracked_best_(\d{4}-\d{2}-\d{2})\.json$/

function main() {
  const args   = process.argv.slice(2)
  const dry    = args.includes("--dry")
  const sportA = (args.find((a) => a.startsWith("--sport=")) || "").slice("--sport=".length).toLowerCase() || null

  let files = []
  try {
    files = fs.readdirSync(TRACKING_DIR)
  } catch (e) {
    console.error("FATAL: cannot read tracking dir " + TRACKING_DIR + ": " + e.message)
    process.exit(1)
  }

  const targets = files
    .map((f) => { const m = f.match(RE); return m ? { file: f, sport: m[1], date: m[2] } : null })
    .filter(Boolean)
    .filter((t) => t.date !== "9999-12-31" && (!sportA || t.sport === sportA))
    .sort((a, b) => a.date.localeCompare(b.date))

  console.log("=== backfill prediction_snapshots from tracked_best (Phase Settlement-PredictionSource-1A) ===")
  console.log(`mode    : ${dry ? "DRY (no writes)" : "WRITE"}`)
  console.log(`sport   : ${sportA || "all"}`)
  console.log(`targets : ${targets.length} tracked_best files`)
  console.log("")

  let totalEntries = 0, totalIns = 0, totalSkip = 0, failed = 0
  for (const t of targets) {
    let entries = []
    try {
      const j = JSON.parse(fs.readFileSync(path.join(TRACKING_DIR, t.file), "utf8"))
      entries = Array.isArray(j && j.entries) ? j.entries : (Array.isArray(j) ? j : [])
    } catch (e) {
      console.log(`  ${t.sport} ${t.date}: READ FAIL ${e.message}`)
      failed++
      continue
    }
    totalEntries += entries.length
    if (dry) {
      console.log(`  ${t.sport} ${t.date}: entries=${entries.length} (dry — would snapshot under run_date=${t.date})`)
      continue
    }
    let ins = 0, skip = 0
    try {
      const r = intel.snapshotPredictions(entries, { sport: t.sport, date: t.date, ecologyBucket: "tracked_best_backfill" })
      ins = r ? (r.inserted || 0) : 0
      skip = r ? (r.skipped || 0) : 0
    } catch (e) {
      console.log(`  ${t.sport} ${t.date}: SNAPSHOT FAIL ${e.message}`)
      failed++
      continue
    }
    totalIns += ins
    totalSkip += skip
    console.log(`  ${t.sport} ${t.date}: entries=${entries.length} inserted=${ins} skipped(dedup)=${skip}`)
  }

  console.log("")
  console.log("-".repeat(60))
  console.log(`SUMMARY: files=${targets.length} entries=${totalEntries} inserted=${totalIns} skipped=${totalSkip} failed=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
