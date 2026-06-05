#!/usr/bin/env node
"use strict"

/**
 * backfillSnapshotColumns.js — Phase Settlement-PredictionSource-1A (2026-06-04)
 *
 *   node scripts/backfillSnapshotColumns.js          # write both tables
 *   node scripts/backfillSnapshotColumns.js --dry     # report only, no writes
 *
 * Re-derives the book-agnostic join columns (player / stat_family / side / line)
 * on BOTH snapshot tables from each row's canonical id. The id is
 * `date|sport|player|stat|side|line|book` and is already fully normalized by
 * predictionId (normPlayer/normFam), so the id is the single source of truth for
 * the columns. predictionId itself is NOT touched.
 *
 * Fixes two things that block the book-agnostic calibration join:
 *   1. outcome_snapshots — recordOutcome historically wrote these columns from a
 *      prediction lookup that returned null on a book-divergent id, leaving
 *      player/stat/side/line NULL on ~5,366/5,794 MLB graded rows. The column
 *      join had nothing to match.
 *   2. prediction_snapshots — the player column stored the RAW display name
 *      ("Brandon Lowe"); the join needs the normalized form ("brandon lowe").
 *
 * Idempotent: re-deriving from the id yields the same values, so re-running is a
 * no-op. Pairs with the forward fixes in intelligence.js (normalizeCandidate
 * stores normalized player; recordOutcome recovers columns from the id) and the
 * book-agnostic join in calibrationDampener.js.
 */

const path = require("path")
const { tryGetDb } = require(path.join(__dirname, "..", "storage", "db"))

function parseId(id) {
  const p = String(id).split("|")
  const lnRaw = p[5]
  const ln = (lnRaw != null && lnRaw !== "" && Number.isFinite(parseFloat(lnRaw))) ? parseFloat(lnRaw) : null
  return { player: p[2] || null, stat: p[3] || null, side: p[4] || null, line: ln }
}

function main() {
  const dry = process.argv.includes("--dry")
  const db = tryGetDb()
  if (!db) { console.error("FATAL: sqlite unavailable (tryGetDb returned null)"); process.exit(1) }

  console.log("=== backfill snapshot join columns from id (Phase Settlement-PredictionSource-1A) ===")
  console.log("mode: " + (dry ? "DRY (no writes)" : "WRITE"))
  console.log("")

  let failed = false
  for (const table of ["prediction_snapshots", "outcome_snapshots"]) {
    let rows
    try {
      rows = db.prepare(`SELECT id, player, stat_family, side, line FROM ${table}`).all()
    } catch (e) {
      console.log(`  ${table}: READ FAIL ${e.message}`); failed = true; continue
    }
    const upd = db.prepare(`UPDATE ${table} SET player = ?, stat_family = ?, side = ?, line = ? WHERE id = ?`)
    let changed = 0, nullPlayerBefore = 0
    if (!dry) db.exec("BEGIN")
    try {
      for (const r of rows) {
        if (r.player == null) nullPlayerBefore++
        const d = parseId(r.id)
        const lineDiff = (r.line == null && d.line == null) ? false : (Number(r.line) !== Number(d.line))
        const diff = (r.player !== d.player) || (r.stat_family !== d.stat) || (r.side !== d.side) || lineDiff
        if (diff) {
          changed++
          if (!dry) upd.run(d.player, d.stat, d.side, d.line, r.id)
        }
      }
      if (!dry) db.exec("COMMIT")
    } catch (e) {
      if (!dry) { try { db.exec("ROLLBACK") } catch (_) {} }
      console.log(`  ${table}: WRITE FAIL ${e.message}`); failed = true; continue
    }
    console.log(`  ${table}: rows=${rows.length} player-null-before=${nullPlayerBefore} rows-${dry ? "would-update" : "updated"}=${changed}`)
  }

  console.log("")
  console.log(failed ? "done WITH ERRORS." : "done.")
  process.exit(failed ? 1 : 0)
}

main()
