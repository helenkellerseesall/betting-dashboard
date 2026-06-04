#!/usr/bin/env node
"use strict"
process.chdir(__dirname)

/**
 * probe_persistence_idempotency_v1.js — Phase Persistence-1B (2026-05-14)
 *
 * Validates the Law-4 (replay/freeze/grading preservation) invariant for
 * persistence backfill: running the import twice MUST produce zero new
 * inserts on the second run. Every insert in importHistoricalData.js uses
 * INSERT OR IGNORE or INSERT OR REPLACE; this probe verifies that contract.
 *
 * Strategy:
 *   1. Set up a temp DB path under /tmp.
 *   2. Apply full schema.
 *   3. Seed a tiny fixture (5 tracked_props rows, 3 slips, 2 hr_predictions,
 *      1 personal_ledger bet) directly via queries.js helpers.
 *   4. Count rows.
 *   5. Re-run the same fixture (idempotency assertion #1).
 *   6. Count rows again — MUST be unchanged.
 *   7. Mutate one row by deleting it, re-run fixture, MUST be restored
 *      (idempotency reseed assertion).
 *
 * Pass criteria: every count assertion passes.
 */

const fs   = require("fs")
const os   = require("os")
const path = require("path")

const checks = []
function ok(label, cond, payload) {
  checks.push({ label, pass: !!cond, payload: payload || null })
  console.log(`  ${cond ? "✓" : "✗"} ${label}`)
  if (!cond && payload) console.log(`      payload: ${JSON.stringify(payload)}`)
}

function main() {
  console.log("=== probe_persistence_idempotency_v1 — Phase Persistence-1B ===")

  // ── Setup a temp DB so we don't touch production ─────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-idem-"))
  const tmpDbPath = path.join(tmpDir, "test.db")
  console.log(`temp DB: ${tmpDbPath}\n`)

  const { DatabaseSync } = require("node:sqlite")
  const { applySchema } = require("./backend/storage/schema")
  const { applyIntelligenceSchema } = require("./backend/storage/intelligenceSchema")
  const {
    insertManyTrackedProps,
    insertManySlips,
    insertManyHrPredictions,
    upsertManyLedgerBets,
    recordNightlyRun,
  } = require("./backend/storage/queries")

  const db = new DatabaseSync(tmpDbPath)
  applySchema(db)
  applyIntelligenceSchema(db)

  ok("schema applied to temp DB", true)

  // ── Fixture ──────────────────────────────────────────────────────────────
  const props = [
    { id: "p1", date: "2026-05-09", sport: "mlb", player: "test 1", statFamily: "totalbases", side: "over", line: 1.5, odds: -110 },
    { id: "p2", date: "2026-05-09", sport: "mlb", player: "test 2", statFamily: "hits",       side: "over", line: 0.5, odds: -120 },
    { id: "p3", date: "2026-05-09", sport: "nba", player: "test 3", statFamily: "points",     side: "over", line: 22.5, odds: -115 },
    { id: "p4", date: "2026-05-09", sport: "nba", player: "test 4", statFamily: "rebounds",   side: "over", line: 7.5, odds: -110 },
    { id: "p5", date: "2026-05-09", sport: "nba", player: "test 5", statFamily: "assists",    side: "over", line: 5.5, odds: -110 },
  ]

  const slips = [
    { id: "s1", date: "2026-05-09", sport: "mlb", tier: "safe",     legCount: 2, combinedAmericanOdds: -250 },
    { id: "s2", date: "2026-05-09", sport: "mlb", tier: "balanced", legCount: 3, combinedAmericanOdds: -150 },
    { id: "s3", date: "2026-05-09", sport: "nba", tier: "aggressive", legCount: 4, combinedAmericanOdds: 450 },
  ]

  const hrPreds = [
    { player: "test slugger 1", eventId: "ev1", team: "NYY", odds: 350, hrScore: 0.72, tag: "ELITE", result: "pending" },
    { player: "test slugger 2", eventId: "ev2", team: "BOS", odds: 280, hrScore: 0.64, tag: "STRONG", result: "pending" },
  ]

  const bets = [
    {
      id: "b1", date: "2026-05-09", sport: "mlb", sportsbook: "DraftKings",
      player: "test bettor 1", statFamily: "totalbases", side: "over", line: 1.5, odds: -110,
      stake: 10, result: "pending",
    },
  ]

  // ── First import ─────────────────────────────────────────────────────────
  const r1Props = insertManyTrackedProps(db, props, "mlb")
  const r1Slips = insertManySlips(db, slips, "mlb")
  const r1Hr    = insertManyHrPredictions(db, hrPreds, "2026-05-09")
  const r1Bets  = upsertManyLedgerBets(db, bets)
  recordNightlyRun(db, { runDate: "2026-05-09", sport: "mlb", runType: "import", candidateCount: 5 })

  ok("first import inserted props", r1Props.inserted === 5, r1Props)
  ok("first import inserted slips", r1Slips.inserted === 3, r1Slips)
  ok("first import inserted hr",    r1Hr.inserted === 2,    r1Hr)
  ok("first import upserted bets",  r1Bets.upserted === 1,  r1Bets)

  const cAfter1 = {
    tracked_props:   db.prepare("SELECT COUNT(*) AS n FROM tracked_props").get().n,
    slip_catalog:    db.prepare("SELECT COUNT(*) AS n FROM slip_catalog").get().n,
    hr_predictions:  db.prepare("SELECT COUNT(*) AS n FROM hr_predictions").get().n,
    personal_ledger: db.prepare("SELECT COUNT(*) AS n FROM personal_ledger").get().n,
    nightly_runs:    db.prepare("SELECT COUNT(*) AS n FROM nightly_runs").get().n,
  }
  ok("after run 1: tracked_props=5",   cAfter1.tracked_props === 5,   cAfter1)
  ok("after run 1: slip_catalog=3",    cAfter1.slip_catalog === 3,    cAfter1)
  ok("after run 1: hr_predictions=2",  cAfter1.hr_predictions === 2,  cAfter1)
  ok("after run 1: personal_ledger=1", cAfter1.personal_ledger === 1, cAfter1)
  ok("after run 1: nightly_runs=1",    cAfter1.nightly_runs === 1,    cAfter1)

  // ── Second import (idempotency assertion) ─────────────────────────────────
  const r2Props = insertManyTrackedProps(db, props, "mlb")
  const r2Slips = insertManySlips(db, slips, "mlb")
  const r2Hr    = insertManyHrPredictions(db, hrPreds, "2026-05-09")
  const r2Bets  = upsertManyLedgerBets(db, bets)
  recordNightlyRun(db, { runDate: "2026-05-09", sport: "mlb", runType: "import", candidateCount: 5 })

  ok("second import: 0 NEW prop inserts",  r2Props.inserted === 0, r2Props)
  ok("second import: 0 NEW slip inserts",  r2Slips.inserted === 0, r2Slips)
  ok("second import: 0 NEW hr inserts",    r2Hr.inserted === 0,    r2Hr)
  // upsertManyLedgerBets uses INSERT OR REPLACE so it counts as "upserted"
  // even on no-change. The real assertion is that the row count didn't grow.
  ok("second import: upsert returned 1 (replace-not-insert)", r2Bets.upserted === 1, r2Bets)

  const cAfter2 = {
    tracked_props:   db.prepare("SELECT COUNT(*) AS n FROM tracked_props").get().n,
    slip_catalog:    db.prepare("SELECT COUNT(*) AS n FROM slip_catalog").get().n,
    hr_predictions:  db.prepare("SELECT COUNT(*) AS n FROM hr_predictions").get().n,
    personal_ledger: db.prepare("SELECT COUNT(*) AS n FROM personal_ledger").get().n,
    nightly_runs:    db.prepare("SELECT COUNT(*) AS n FROM nightly_runs").get().n,
  }
  ok("idempotency: tracked_props unchanged",   cAfter2.tracked_props === cAfter1.tracked_props,     cAfter2)
  ok("idempotency: slip_catalog unchanged",    cAfter2.slip_catalog === cAfter1.slip_catalog,       cAfter2)
  ok("idempotency: hr_predictions unchanged",  cAfter2.hr_predictions === cAfter1.hr_predictions,   cAfter2)
  ok("idempotency: personal_ledger unchanged", cAfter2.personal_ledger === cAfter1.personal_ledger, cAfter2)
  ok("idempotency: nightly_runs unchanged",    cAfter2.nightly_runs === cAfter1.nightly_runs,       cAfter2)

  // ── Reseed assertion (delete a row, re-run, must restore) ────────────────
  db.exec("DELETE FROM tracked_props WHERE id = 'p3'")
  const cAfterDel = db.prepare("SELECT COUNT(*) AS n FROM tracked_props").get().n
  ok("after delete: tracked_props=4", cAfterDel === 4, { count: cAfterDel })

  const r3 = insertManyTrackedProps(db, props, "mlb")
  ok("reseed: 1 NEW prop insert", r3.inserted === 1, r3)
  const cAfterReseed = db.prepare("SELECT COUNT(*) AS n FROM tracked_props").get().n
  ok("after reseed: tracked_props=5 (restored)", cAfterReseed === 5, { count: cAfterReseed })

  db.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

  // ── Verdict ──────────────────────────────────────────────────────────────
  const pass = checks.filter((c) => c.pass).length
  const fail = checks.filter((c) => !c.pass).length
  console.log("")
  console.log(`pass: ${pass}    fail: ${fail}`)
  console.log(`RESULT: ${fail === 0 ? "PASS" : "FAIL"}`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
