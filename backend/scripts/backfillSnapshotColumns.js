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

const fs = require("fs")
const path = require("path")
const { tryGetDb } = require(path.join(__dirname, "..", "storage", "db"))
// 2026-07-06 H1 corpus fix — phase 3 sources model_prob from the JSON tracked_bets
// (the REAL source; prediction_snapshots is a ~1/5 subset, audit 2026-06-29) on
// the RAW axis via the era rule's ONE owner (calibration-on-calibration doctrine).
const intel = require(path.join(__dirname, "..", "storage", "intelligence"))
const { statedRawProb } = require(path.join(__dirname, "..", "pipeline", "mlb", "mlbCalibTraining"))

function parseId(id) {
  const p = String(id).split("|")
  const lnRaw = p[5]
  const ln = (lnRaw != null && lnRaw !== "" && Number.isFinite(parseFloat(lnRaw))) ? parseFloat(lnRaw) : null
  return { player: p[2] || null, stat: p[3] || null, side: p[4] || null, line: ln }
}

// ── H1 phase 3: fill outcome_snapshots.model_prob (NULL rows ONLY) from JSON ──
// Pass 1: exact canonical-id join (predictionId(bet) === os.id — book included).
// Pass 2: book-agnostic tuple join (run_date|sport|player|stat|side|line) for
//         book-string-divergent ids; CONFLICTING candidates (spread > 1pp) are
//         SKIPPED and counted — ambiguity is never papered over.
// Era rule (MLB only): raw axis = modelProbRaw ?? pre-flip modelProb ?? EXCLUDE.
// NBA was never calibrated ⇒ modelProb is raw. Existing model_prob values are
// NEVER overwritten (settled data immutability).
function backfillModelProb(db, dry) {
  const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
  const byId = new Map()          // predId → raw prob
  const byTuple = new Map()       // date|sport|player|stat|side|line → [raw probs]
  let jsonRows = 0, excludedContaminated = 0
  for (const sport of ["mlb", "nba"]) {
    const files = fs.readdirSync(TRACKING).filter((f) => new RegExp(`^${sport}_tracked_bets_\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f)).sort()
    for (const f of files) {
      const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
      let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
      for (const b of a) {
        if (!b || !b.player || String(b.player).toLowerCase().startsWith("no ")) continue
        const raw = sport === "mlb" ? statedRawProb(b, b.date || day) : (Number.isFinite(Number(b.modelProb)) ? Number(b.modelProb) : null)
        if (raw == null) { if (Number.isFinite(Number(b.modelProb))) excludedContaminated++; continue }
        jsonRows++
        const d = b.date || day
        const predId = intel.predictionId(d, sport, b.player, b.statFamily, b.side, b.line, b.sportsbook)
        if (predId && !byId.has(predId)) byId.set(predId, raw)
        const norm = (v) => String(v ?? "").toLowerCase().trim()
        const tk = [d, sport, norm(b.player).replace(/[^a-z0-9]+/g, ""), norm(b.statFamily), norm(b.side), String(Number(b.line))].join("|")
        if (!byTuple.has(tk)) byTuple.set(tk, [])
        byTuple.get(tk).push(raw)
      }
    }
  }

  const nullRows = db.prepare("SELECT id, run_date, sport, player, stat_family, side, line FROM outcome_snapshots WHERE model_prob IS NULL").all()
  const upd = db.prepare("UPDATE outcome_snapshots SET model_prob = ? WHERE id = ? AND model_prob IS NULL")
  let filledId = 0, filledTuple = 0, ambiguous = 0, unmatched = 0
  if (!dry) db.exec("BEGIN")
  try {
    for (const r of nullRows) {
      const exact = byId.get(r.id)
      if (exact != null) { filledId++; if (!dry) upd.run(exact, r.id); continue }
      const norm = (v) => String(v ?? "").toLowerCase().trim()
      const tk = [r.run_date, norm(r.sport), norm(r.player).replace(/[^a-z0-9]+/g, ""), norm(r.stat_family), norm(r.side), String(Number(r.line))].join("|")
      const cands = byTuple.get(tk)
      if (!cands || !cands.length) { unmatched++; continue }
      const mn = Math.min(...cands), mx = Math.max(...cands)
      if (mx - mn > 0.01) { ambiguous++; continue }   // conflicting probs across books — skip, never guess
      filledTuple++
      if (!dry) upd.run((mn + mx) / 2, r.id)
    }
    if (!dry) db.exec("COMMIT")
  } catch (e) {
    if (!dry) { try { db.exec("ROLLBACK") } catch (_) {} }
    console.log(`  model_prob phase: WRITE FAIL ${e.message}`)
    return { failed: true }
  }
  console.log(`  model_prob (H1): os-NULL-rows=${nullRows.length} json-raw-rows=${jsonRows} era-excluded=${excludedContaminated}`)
  console.log(`    ${dry ? "would-fill" : "filled"}: exact-id=${filledId} tuple=${filledTuple} | skipped: ambiguous=${ambiguous} unmatched=${unmatched}`)
  return { failed: false, filledId, filledTuple, ambiguous, unmatched, nullRows: nullRows.length, excludedContaminated }
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

  // 2026-07-06 H1 corpus fix — phase 3: fill NULL outcome_snapshots.model_prob
  // from the JSON tracked_bets on the raw axis (era rule). See backfillModelProb.
  console.log("")
  const mp = backfillModelProb(db, dry)
  if (mp.failed) failed = true

  console.log("")
  console.log(failed ? "done WITH ERRORS." : "done.")
  process.exit(failed ? 1 : 0)
}

main()
