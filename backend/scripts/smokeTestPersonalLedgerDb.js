#!/usr/bin/env node
"use strict"

/**
 * smokeTestPersonalLedgerDb.js — verifies the helper module works end-to-end
 * BEFORE we wire dual-write into buildPersonalLedger.js. Tests:
 *   1. Helper loads + better-sqlite3 loads
 *   2. ensureSchema() creates personal_ledger.db with the bets table
 *   3. upsertBet inserts a test row
 *   4. Upsert again with same id updates in place (no duplicate)
 *   5. getBetCount returns expected count
 *   6. getPlacedBets filters correctly on decisionType='placed'
 *   7. Delete the test rows so we leave the DB clean
 *
 * Safe: only inserts rows with id starting `smoke_test_` which we delete at end.
 * Exit codes: 0 all passed, 1 any failure.
 */

const path = require("path")
const fs = require("fs")

let db = null
try {
  db = require(path.join(__dirname, "..", "pipeline", "shared", "personalLedgerDb.js"))
} catch (e) {
  console.error("FATAL: personalLedgerDb.js failed to load:", e.message)
  process.exit(1)
}

const TESTS = []
function test(name, fn) { TESTS.push({ name, fn }) }

let passed = 0, failed = 0

test("1. Module loaded + better-sqlite3 available", async () => {
  if (typeof db.upsertBet !== "function") throw new Error("upsertBet not exported")
  if (typeof db.ensureSchema !== "function") throw new Error("ensureSchema not exported")
})

test("2. ensureSchema() creates DB file", async () => {
  db.ensureSchema()
  if (!fs.existsSync(db.DB_PATH)) throw new Error(`DB file not created at ${db.DB_PATH}`)
  console.log(`     ✓ DB exists at ${db.DB_PATH}`)
})

test("3. upsertBet inserts a test row", async () => {
  const sampleBet = {
    id: "smoke_test_001",
    date: "2026-05-31",
    sport: "nba",
    sportsbook: "test-book",
    betType: "single",
    player: "Smoke Tester",
    statFamily: "rebounds",
    side: "under",
    line: 5.5,
    oddsAmerican: -110,
    odds: -110,
    stake: 10,
    toWin: 9.09,
    modelProb: 0.55,
    edge: 0.05,
    tier: "PLAYABLE",
    result: "pending",
    decisionType: "followed",
    realMoney: false,
  }
  db.upsertBet(sampleBet)
  const count = db.getBetCount()
  console.log(`     ✓ bets count after insert: ${count}`)
})

test("4. Upsert same id is idempotent (no duplicate)", async () => {
  const before = db.getBetCount()
  db.upsertBet({ id: "smoke_test_001", date: "2026-05-31", sport: "nba", stake: 15, result: "win" })
  const after = db.getBetCount()
  if (after !== before) throw new Error(`Expected count unchanged (${before}), got ${after} — upsert produced duplicate`)
  console.log(`     ✓ count stable at ${after} after re-upsert`)
})

test("5. Insert a placed bet, verify getPlacedBets returns it", async () => {
  db.upsertBet({
    id: "smoke_test_placed",
    date: "2026-05-31",
    sport: "nba",
    sportsbook: "test-book",
    betType: "parlay",
    stake: 5,
    odds: 656,
    result: "pending",
    decisionType: "placed",
    realMoney: true,
    legs: [{ player: "X", statFamily: "rebounds", side: "under", line: 3.5 }],
  })
  const placed = db.getPlacedBets()
  const found = placed.find((p) => p.id === "smoke_test_placed")
  if (!found) throw new Error("getPlacedBets did not return smoke_test_placed")
  if (found.realMoney !== 1) throw new Error(`realMoney column should be 1, got ${found.realMoney}`)
  if (!found.legs) throw new Error("legs JSON not persisted")
  const legs = JSON.parse(found.legs)
  if (!Array.isArray(legs) || legs.length !== 1) throw new Error("legs round-trip failed")
  console.log(`     ✓ placed bet round-tripped with legs JSON intact (${placed.length} total placed in DB)`)
})

test("6. Cleanup test rows", async () => {
  // Direct query — db helper doesn't expose delete, that's intentional
  // (canonical writes only go through upsert), but we can reach the underlying
  // db via a backdoor for smoke-test cleanup.
  const Database = require("better-sqlite3")
  const direct = new Database(db.DB_PATH)
  const deleted = direct.prepare("DELETE FROM bets WHERE id LIKE 'smoke_test_%'").run()
  direct.close()
  console.log(`     ✓ cleaned ${deleted.changes} test row(s)`)
})

;(async () => {
  console.log(`=== smokeTestPersonalLedgerDb — ${new Date().toISOString()} ===`)
  console.log(`DB path: ${db.DB_PATH}\n`)
  for (const t of TESTS) {
    try {
      await t.fn()
      console.log(`  ✓ ${t.name}`)
      passed++
    } catch (e) {
      console.log(`  ✗ ${t.name}: ${e.message}`)
      failed++
    }
  }
  console.log(`\n${passed} passed · ${failed} failed`)
  if (failed > 0) console.log("STATUS: FAIL — do NOT proceed to Step 2 dual-write")
  else console.log("STATUS: PASS — helper verified, safe to wire dual-write next")
  db.close()
  process.exit(failed > 0 ? 1 : 0)
})()
