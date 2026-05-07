#!/usr/bin/env node
"use strict"

/**
 * importHistoricalData.js
 *
 * One-time (and idempotent) backfill of all existing JSON tracking files
 * into the SQLite database.
 *
 * Safe to run multiple times — all inserts use INSERT OR IGNORE.
 * Only NEW rows are added on repeat runs.
 *
 * Usage:
 *   node backend/storage/importHistoricalData.js
 *
 * What it imports:
 *   mlb_tracked_bets_*.json     → tracked_props
 *   nba_tracked_bets_*.json     → tracked_props
 *   mlb_tracked_slips_*.json    → slip_catalog
 *   nba_tracked_slips_*.json    → slip_catalog
 *   tracked_props_*.json        → hr_predictions
 *   graded_props_*.json         → hr_predictions
 *
 * What it does NOT touch:
 *   personal_ledger.json        (separate migration — Phase 2)
 *   timing_intelligence_state.json (separate migration — Phase 3)
 *   post_game_review_state_*.json  (separate migration — Phase 4)
 *   mlb_tracked_best_*.json        (attack board — different schema, future phase)
 *
 * JSON files remain CANONICAL. This script is analytics infrastructure only.
 */

const fs   = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const { tryGetDb } = require("./db")
const {
  insertManyTrackedProps,
  insertManyHrPredictions,
  insertManySlips,
  recordNightlyRun,
} = require("./queries")

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw)
  } catch (e) {
    console.warn(`  [skip] Cannot read ${path.basename(filePath)}: ${e.message}`)
    return null
  }
}

function pad(n, width = 4) {
  return String(n).padStart(width, " ")
}

/** Extract YYYY-MM-DD from a filename like mlb_tracked_bets_2026-05-06.json */
function dateFromFilename(filename) {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** List tracking files matching a glob-style prefix. */
function listFiles(prefix) {
  try {
    return fs.readdirSync(TRACKING_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .map(f => path.join(TRACKING_DIR, f))
      .sort()
  } catch (_) {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Import passes
// ─────────────────────────────────────────────────────────────────────────────

function importTrackedBets(db) {
  console.log("\n── tracked_props (mlb_tracked_bets + nba_tracked_bets) ──")

  let totalInserted = 0
  let totalSkipped  = 0
  const runSummary  = {}   // runDate → { sport, candidateCount }

  for (const sport of ["mlb", "nba"]) {
    const files = listFiles(`${sport}_tracked_bets_`)
    for (const filePath of files) {
      const filename = path.basename(filePath)
      const runDate  = dateFromFilename(filename)
      const data     = readJsonSafe(filePath)
      if (!Array.isArray(data) || data.length === 0) continue

      const { inserted, skipped } = insertManyTrackedProps(db, data, sport)
      totalInserted += inserted
      totalSkipped  += skipped

      console.log(`  ${filename}: +${pad(inserted)} inserted, ${pad(skipped)} already present`)

      // accumulate for nightly_runs
      if (runDate) {
        const key = `${runDate}|${sport}`
        runSummary[key] = (runSummary[key] || 0) + data.length
      }
    }
  }

  // Record run metadata
  for (const [key, count] of Object.entries(runSummary)) {
    const [runDate, sport] = key.split("|")
    recordNightlyRun(db, { runDate, sport, runType: "import", candidateCount: count })
  }

  console.log(`  TOTAL: +${totalInserted} inserted, ${totalSkipped} already present`)
  return totalInserted
}

function importSlips(db) {
  console.log("\n── slip_catalog (mlb_tracked_slips + nba_tracked_slips) ──")

  let totalInserted = 0
  let totalSkipped  = 0

  for (const sport of ["mlb", "nba"]) {
    const files = listFiles(`${sport}_tracked_slips_`)
    for (const filePath of files) {
      const filename = path.basename(filePath)
      const runDate  = dateFromFilename(filename)
      const data     = readJsonSafe(filePath)
      if (!Array.isArray(data) || data.length === 0) continue

      const { inserted, skipped } = insertManySlips(db, data, sport)
      totalInserted += inserted
      totalSkipped  += skipped

      console.log(`  ${filename}: +${pad(inserted)} inserted, ${pad(skipped)} already present`)

      // Update nightly_runs slip count
      if (runDate) {
        recordNightlyRun(db, { runDate, sport, runType: "import", slipCount: data.length })
      }
    }
  }

  console.log(`  TOTAL: +${totalInserted} inserted, ${totalSkipped} already present`)
  return totalInserted
}

function importHrPredictions(db) {
  console.log("\n── hr_predictions (tracked_props_* + graded_props_*) ──")

  let totalInserted = 0
  let totalSkipped  = 0

  for (const prefix of ["tracked_props_", "graded_props_"]) {
    const files = listFiles(prefix)
    for (const filePath of files) {
      const filename = path.basename(filePath)
      const runDate  = dateFromFilename(filename)
      const data     = readJsonSafe(filePath)
      if (!Array.isArray(data) || data.length === 0) continue

      const { inserted, skipped } = insertManyHrPredictions(db, data, runDate)
      totalInserted += inserted
      totalSkipped  += skipped

      console.log(`  ${filename}: +${pad(inserted)} inserted, ${pad(skipped)} already present`)
    }
  }

  console.log(`  TOTAL: +${totalInserted} inserted, ${totalSkipped} already present`)
  return totalInserted
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification report
// ─────────────────────────────────────────────────────────────────────────────

function printVerification(db) {
  console.log("\n── Database verification ──")

  const tables = [
    "tracked_props",
    "hr_predictions",
    "slip_catalog",
    "nightly_runs",
  ]

  for (const t of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()
    console.log(`  ${t.padEnd(22)}: ${pad(row.n)} rows`)
  }

  // Date range in tracked_props
  const range = db.prepare(
    "SELECT MIN(run_date) AS earliest, MAX(run_date) AS latest FROM tracked_props"
  ).get()
  if (range && range.earliest) {
    console.log(`  tracked_props span : ${range.earliest} → ${range.latest}`)
  }

  // Tier breakdown in slip_catalog
  const tiers = db.prepare(
    "SELECT sport, tier, COUNT(*) AS n FROM slip_catalog GROUP BY sport, tier ORDER BY sport, tier"
  ).all()
  if (tiers.length) {
    console.log("  slip_catalog tiers :")
    for (const t of tiers) {
      console.log(`    ${t.sport.padEnd(5)} ${t.tier.padEnd(12)}: ${t.n}`)
    }
  }

  // Pending vs settled in tracked_props
  const results = db.prepare(
    "SELECT result, COUNT(*) AS n FROM tracked_props GROUP BY result"
  ).all()
  if (results.length) {
    console.log("  tracked_props results:")
    for (const r of results) {
      console.log(`    ${String(r.result || "null").padEnd(10)}: ${r.n}`)
    }
  }

  console.log(`\n  DB file: ${require("./db").dbPath()}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const t0 = Date.now()
  console.log("=== importHistoricalData — SQLite Phase 1 backfill ===")
  console.log(`Tracking dir : ${TRACKING_DIR}`)

  const db = tryGetDb()
  if (!db) {
    console.error("FATAL: SQLite unavailable. Cannot run import.")
    process.exit(1)
  }

  importTrackedBets(db)
  importSlips(db)
  importHrPredictions(db)
  printVerification(db)

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
  console.log(`\n=== Done in ${elapsed}s ===`)
  console.log("JSON runtime files unchanged — SQLite is additive only.")
}

main()
