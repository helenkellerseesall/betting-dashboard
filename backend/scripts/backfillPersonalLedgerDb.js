#!/usr/bin/env node
"use strict"

/**
 * backfillPersonalLedgerDb.js — one-shot mirror of current personal_ledger.json
 * into personal_ledger.db. Run once after Step 2 ships so the SQLite shadow
 * starts in parity with JSON.
 *
 * Safe to re-run: upsertBet is idempotent on bet.id, so re-running just
 * touches the _updatedAt column on existing rows.
 *
 * Reports before/after counts and verifies parity at the end.
 */

const fs = require("fs")
const path = require("path")

const REPO = path.join(__dirname, "..", "..")
const LEDGER_JSON = path.join(REPO, "backend", "runtime", "tracking", "personal_ledger.json")
const db = require(path.join(REPO, "backend", "pipeline", "shared", "personalLedgerDb.js"))

console.log(`=== backfillPersonalLedgerDb — ${new Date().toISOString()} ===\n`)

let ledger
try {
  console.log(`Reading ${LEDGER_JSON}…`)
  ledger = JSON.parse(fs.readFileSync(LEDGER_JSON, "utf8"))
} catch (e) {
  console.error(`FATAL: couldn't read JSON ledger: ${e.message}`)
  process.exit(1)
}

const bets = ledger.bets || []
console.log(`JSON ledger: ${bets.length} bets`)

const beforeCount = db.getBetCount()
console.log(`SQLite before backfill: ${beforeCount} bets`)
console.log()

console.log(`Bulk-upserting ${bets.length} bets to SQLite (single transaction)…`)
const t0 = Date.now()
let inserted = 0
try {
  inserted = db.upsertManyBets(bets)
} catch (e) {
  console.error(`FATAL during upsertManyBets: ${e.message}`)
  process.exit(2)
}
const elapsed = Date.now() - t0

const afterCount = db.getBetCount()
console.log(`SQLite after backfill: ${afterCount} bets`)
console.log(`Upserted ${inserted} bets in ${elapsed}ms`)
console.log()

// Parity check
console.log("=== PARITY CHECK ===")
const jsonCount = bets.length
const sqliteCount = afterCount
const drift = Math.abs(jsonCount - sqliteCount)
console.log(`JSON:   ${jsonCount} bets`)
console.log(`SQLite: ${sqliteCount} bets`)
console.log(`Drift:  ${drift}`)

if (drift === 0) {
  console.log("STATUS: PARITY — JSON and SQLite agree, safe to enable hourly audit comparison")
} else if (drift < 10) {
  console.log("STATUS: NEAR PARITY — small drift, investigate before relying on SQLite")
} else {
  console.log("STATUS: DRIFT — significant mismatch, do NOT proceed to Phase 2")
}

// Show placed bets (the ones that mattered for the FIFO bug)
const placed = db.getPlacedBets()
console.log()
console.log(`Placed bets in SQLite: ${placed.length}`)
for (const p of placed) {
  console.log(`  · ${p.id} · ${p.sport} · ${p.sportsbook} · $${p.stake} @ ${p.odds} · ${p.result}`)
}

db.close()
process.exit(drift === 0 ? 0 : (drift < 10 ? 1 : 2))
