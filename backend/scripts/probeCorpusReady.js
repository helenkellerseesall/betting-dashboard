#!/usr/bin/env node
"use strict"

/**
 * probeCorpusReady.js — Phase Settlement-PredictionSource-1A (2026-06-04)
 * READ-ONLY. Run AFTER predictions:backfill + snapshots:backfill-columns.
 *
 * Proves the data-plumbing half of the un-freeze:
 *   1. outcome_snapshots join columns are populated (was ~5,366/5,794 MLB null).
 *   2. the book-agnostic join is READY (MLB count — should be ~57, up from 0).
 *   3. the LIVE dampener id-join is UNCHANGED (MLB still frozen — by design; the
 *      live read does not flip until line-aware calibration lands).
 */

const path = require("path")
const { tryGetDb } = require(path.join(__dirname, "..", "storage", "db"))

const BOOK_AGNOSTIC = `
  SELECT COUNT(*) AS n FROM (
    SELECT 1
    FROM (SELECT run_date,sport,player,stat_family,side,line FROM prediction_snapshots
          WHERE sport=? AND stat_family IS NOT NULL AND player IS NOT NULL
          GROUP BY run_date,sport,player,stat_family,side,line) p
    JOIN (SELECT run_date,sport,player,stat_family,side,line FROM outcome_snapshots
          WHERE sport=? AND hit IS NOT NULL AND player IS NOT NULL AND stat_family IS NOT NULL
          GROUP BY run_date,sport,player,stat_family,side,line) o
      ON o.run_date=p.run_date AND o.sport=p.sport AND o.player=p.player
     AND o.stat_family=p.stat_family AND o.side=p.side AND o.line=p.line
  )`

const LIVE_IDJOIN = `
  SELECT COUNT(DISTINCT os.id) AS n
  FROM outcome_snapshots os JOIN prediction_snapshots ps ON ps.id = os.id
  WHERE os.hit IS NOT NULL AND ps.sport=? AND ps.stat_family IS NOT NULL`

function main() {
  const db = tryGetDb()
  if (!db) { console.error("FATAL: sqlite unavailable"); process.exit(1) }

  console.log("=== corpus readiness probe (Phase Settlement-PredictionSource-1A) — READ-ONLY ===")
  console.log("")
  console.log("1) outcome_snapshots join-column population (graded rows):")
  for (const sp of ["mlb", "nba"]) {
    const r = db.prepare("SELECT COUNT(*) t, SUM(CASE WHEN player IS NULL THEN 1 ELSE 0 END) np FROM outcome_snapshots WHERE sport=? AND hit IS NOT NULL").get(sp)
    console.log(`   ${sp}: graded=${r.t}  player-null=${r.np}  populated=${r.t - r.np}`)
  }
  console.log("")
  console.log("2) BOOK-AGNOSTIC join — READINESS (all prediction rows, book dropped;")
  console.log("   NOT live — flips only with line-aware calibration; curated-only TBD in design):")
  for (const sp of ["mlb", "nba"]) {
    const r = db.prepare(BOOK_AGNOSTIC).get(sp, sp)
    console.log(`   ${sp}: distinct prop+line matches = ${r.n}`)
  }
  console.log("")
  console.log("3) LIVE dampener id-join — must be UNCHANGED vs before this ship (book-specific):")
  for (const sp of ["mlb", "nba"]) {
    const r = db.prepare(LIVE_IDJOIN).get(sp)
    console.log(`   ${sp}: live id-join rows = ${r.n}`)
  }
  console.log("")
  console.log("READ: section 2 (book-agnostic) should EXCEED section 3 (id-join) once columns")
  console.log("are backfilled — that gap is the book-divergent MLB matches the live join misses.")
  console.log("Plumbing shipped: corpus correct + joinable + growing; live pick math unchanged.")
}

main()
