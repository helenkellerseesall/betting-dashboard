#!/usr/bin/env node
"use strict"
process.chdir(__dirname)

/**
 * probe_grading_backfill_v1.js — Phase Grading-Calibration-Operations-1B (2026-05-14)
 *                                + Phase 1E classification verification (2026-05-14)
 *
 * Validates the grading writers (`intel.recordOutcomes` + `intel.recordSlipOutcome`)
 * directly against a /tmp DB without invoking the full orchestrator. This
 * isolates the writer-correctness contract from the orchestrator file-IO
 * surface (which reads `runtime/tracking/` paths the sandbox can't write).
 *
 * Six assertion blocks:
 *
 *   1. SCHEMA — outcome_snapshots, slip_outcomes, calibration_records,
 *      ecology_grades, daily_intelligence_reports, process_classifications,
 *      eruption_events, volatility_realizations all exist after applySchema.
 *
 *   2. RECORD-OUTCOMES — intel.recordOutcomes writes N rows to
 *      outcome_snapshots; counters increment correctly; hit/delta_prob shape.
 *
 *   3. RECORD-SLIP-OUTCOME — intel.recordSlipOutcome writes a slip_outcomes
 *      row; legs_hit, payout_dec shape correct.
 *
 *   4. IDEMPOTENCY — re-recording the same outcome is INSERT OR REPLACE
 *      (correction-friendly); re-recording with same hit/no-change preserves
 *      row count.
 *
 *   5. JOIN — outcome_snapshots × prediction_snapshots join is non-empty for
 *      the synthetic fixture; calibration query shape is correct.
 *
 *   6. CLASSIFICATION (Phase 1E — INC-013 fix verification) — classifyBet
 *      reads `actualValue` (tracked_bets path) AND `actualStat` (legacy
 *      mergeActualsOntoBets path). Verifies the backward-compatible
 *      `actualValue ?? actualStat` precedence and result/push override.
 *
 * Sandbox-safe: uses /tmp DB only. Does NOT touch production betting.db.
 */

const fs   = require("fs")
const os   = require("os")
const path = require("path")
const { DatabaseSync } = require("node:sqlite")

const checks = []
function ok(label, cond, payload) {
  checks.push({ label, pass: !!cond, payload: payload || null })
  console.log(`  ${cond ? "✓" : "✗"} ${label}`)
  if (!cond && payload) console.log(`      payload: ${JSON.stringify(payload).slice(0, 220)}`)
}

function main() {
  console.log("=== probe_grading_backfill_v1 — Phase Grading-Calibration-Operations-1B ===")

  // ── Setup temp DB ────────────────────────────────────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grading-backfill-"))
  const tmpDbPath = path.join(tmpDir, "test.db")
  console.log(`temp DB: ${tmpDbPath}\n`)

  // Override the storage/db module to use our temp path BEFORE requiring intelligence.
  // The intelligence module uses tryGetDb() lazily; we monkey-patch via require cache.
  const dbModulePath = require.resolve("./backend/storage/db")
  // Force tryGetDb to return our DB
  const dbModule = require("./backend/storage/db")
  const originalTryGetDb = dbModule.tryGetDb
  // Apply schema to a fresh DB at the temp path
  const liveDb = new DatabaseSync(tmpDbPath)
  const { applySchema } = require("./backend/storage/schema")
  const { applyIntelligenceSchema } = require("./backend/storage/intelligenceSchema")
  applySchema(liveDb)
  applyIntelligenceSchema(liveDb)
  dbModule.tryGetDb = () => liveDb

  // Now require intelligence — its tryGetDb call will resolve to our temp DB.
  const intel = require("./backend/storage/intelligence")

  // ── Block 1: SCHEMA ──────────────────────────────────────────────────────
  console.log("── Block 1: schema present ──")
  const tables = new Set(
    liveDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  )
  const required = [
    "prediction_snapshots", "outcome_snapshots", "slip_outcomes",
    "calibration_records", "ecology_grades", "daily_intelligence_reports",
    "process_classifications", "eruption_events", "volatility_realizations",
  ]
  for (const t of required) {
    ok(`table present: ${t}`, tables.has(t))
  }

  // ── Seed prediction_snapshots fixture ────────────────────────────────────
  console.log("\n── Seed prediction_snapshots fixture (5 candidates) ──")
  const fixtureRunDate = "2026-05-09"
  const fixtureSport   = "mlb"
  const candidates = [
    { player: "test slugger 1", statFamily: "totalbases", side: "over",  line: 1.5,  odds: -110, modelProb: 0.62, edge: 0.07, tier: "STRONG",  volatility: "balanced",   sportsbook: "DraftKings", date: fixtureRunDate, sport: fixtureSport },
    { player: "test slugger 2", statFamily: "hits",       side: "over",  line: 0.5,  odds: -120, modelProb: 0.71, edge: 0.05, tier: "ELITE",   volatility: "safe",       sportsbook: "FanDuel",     date: fixtureRunDate, sport: fixtureSport },
    { player: "test slugger 3", statFamily: "hr",         side: "over",  line: 0.5,  odds:  280, modelProb: 0.32, edge: 0.07, tier: "PLAYABLE", volatility: "aggressive", sportsbook: "DraftKings", date: fixtureRunDate, sport: fixtureSport },
    { player: "test slugger 4", statFamily: "rbi",        side: "under", line: 0.5,  odds: -130, modelProb: 0.58, edge: 0.03, tier: "VALUE",    volatility: "balanced",   sportsbook: "FanDuel",     date: fixtureRunDate, sport: fixtureSport },
    { player: "test slugger 5", statFamily: "runs",       side: "over",  line: 0.5,  odds: -110, modelProb: 0.55, edge: 0.05, tier: "PLAYABLE", volatility: "balanced",   sportsbook: "DraftKings", date: fixtureRunDate, sport: fixtureSport },
  ]
  const snapResult = intel.snapshotPredictions(candidates, { sport: fixtureSport, date: fixtureRunDate })
  // intel.snapshotPredictions returns { inserted, skipped } (verified from live source 2026-05-14)
  ok("snapshotPredictions inserted >= 5", snapResult && (snapResult.inserted >= 5), snapResult)
  const predCount = liveDb.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots").get().n
  ok("prediction_snapshots populated", predCount >= 5, { predCount })

  // Read back IDs so we can settle them
  const predRows = liveDb.prepare("SELECT id, player FROM prediction_snapshots ORDER BY id").all()
  ok("can read prediction rows", predRows.length >= 5, { count: predRows.length })

  // ── Block 2: RECORD-OUTCOMES ─────────────────────────────────────────────
  console.log("\n── Block 2: intel.recordOutcomes (3 hits / 2 misses) ──")
  const settlements = [
    { id: predRows[0].id, hit: 1, actualValue: 2.0, settledAt: new Date().toISOString(), notes: "win" },
    { id: predRows[1].id, hit: 1, actualValue: 2.0, settledAt: new Date().toISOString(), notes: "win" },
    { id: predRows[2].id, hit: 0, actualValue: 0,   settledAt: new Date().toISOString(), notes: "loss" },
    { id: predRows[3].id, hit: 1, actualValue: 0,   settledAt: new Date().toISOString(), notes: "win" },
    { id: predRows[4].id, hit: 0, actualValue: 0,   settledAt: new Date().toISOString(), notes: "loss" },
  ]
  const recResult = intel.recordOutcomes(settlements, { sport: fixtureSport, date: fixtureRunDate })
  ok("recordOutcomes returns ok", recResult && recResult.recorded >= 5, recResult)
  ok("recordOutcomes errors = 0", recResult && (recResult.errors || 0) === 0, recResult)

  const outcomeCount = liveDb.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get().n
  ok("outcome_snapshots row count == 5", outcomeCount === 5, { outcomeCount })

  const winRowCount = liveDb.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots WHERE hit = 1").get().n
  const lossRowCount = liveDb.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots WHERE hit = 0").get().n
  ok("hit=1 rows == 3", winRowCount === 3, { winRowCount })
  ok("hit=0 rows == 2", lossRowCount === 2, { lossRowCount })

  // delta_prob shape
  const deltaShape = liveDb.prepare(`
    SELECT id, model_prob, hit, delta_prob FROM outcome_snapshots
    ORDER BY id LIMIT 1
  `).get()
  ok("delta_prob populated (not null)", deltaShape && deltaShape.delta_prob != null, deltaShape)
  ok("delta_prob = model_prob - hit", deltaShape && Math.abs(deltaShape.delta_prob - (deltaShape.model_prob - deltaShape.hit)) < 1e-9, deltaShape)

  // ── Block 3: RECORD-SLIP-OUTCOME ─────────────────────────────────────────
  console.log("\n── Block 3: intel.recordSlipOutcome (1 winning slip) ──")
  const slipFixture = {
    id: "test-slip-1",
    date: fixtureRunDate,
    sport: fixtureSport,
    tier: "balanced",
    legCount: 3,
    combinedDecimalOdds: 5.5,
    legs: [
      { player: "test slugger 1", statFamily: "totalbases", side: "over", line: 1.5, result: "win" },
      { player: "test slugger 2", statFamily: "hits",       side: "over", line: 0.5, result: "win" },
      { player: "test slugger 3", statFamily: "hr",         side: "over", line: 0.5, result: "loss" },
    ],
  }
  const slipR = intel.recordSlipOutcome(slipFixture, {
    legsHit:   2,
    result:    "loss",
    payoutDec: 0,
    settledAt: new Date().toISOString(),
  }, { sport: fixtureSport, date: fixtureRunDate })
  ok("recordSlipOutcome returns ok", slipR && (slipR.recorded || slipR === true), slipR)

  const slipOutCount = liveDb.prepare("SELECT COUNT(*) AS n FROM slip_outcomes").get().n
  ok("slip_outcomes row count == 1", slipOutCount === 1, { slipOutCount })

  const slipRow = liveDb.prepare("SELECT id, tier, legs_hit, result FROM slip_outcomes WHERE id = ?").get("test-slip-1")
  ok("slip_outcomes row by id", !!slipRow, slipRow)
  ok("slip tier preserved", slipRow?.tier === "balanced", slipRow)
  ok("slip legs_hit preserved", slipRow?.legs_hit === 2, slipRow)
  ok("slip result preserved", slipRow?.result === "loss", slipRow)

  // ── Block 4: IDEMPOTENCY ─────────────────────────────────────────────────
  console.log("\n── Block 4: idempotency (re-record same outcomes) ──")
  const beforeRe = liveDb.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get().n
  const recR2 = intel.recordOutcomes(settlements, { sport: fixtureSport, date: fixtureRunDate })
  const afterRe = liveDb.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get().n
  ok("re-record: no new rows (INSERT OR REPLACE)", beforeRe === afterRe, { beforeRe, afterRe, recR2 })

  // Correction case: change hit value, re-record, expect updated row (not new)
  const beforeCorr = liveDb.prepare("SELECT hit FROM outcome_snapshots WHERE id = ?").get(predRows[2].id)
  const corrSettlements = [{ id: predRows[2].id, hit: 1, actualValue: 1, settledAt: new Date().toISOString(), notes: "corrected" }]
  intel.recordOutcomes(corrSettlements, { sport: fixtureSport, date: fixtureRunDate })
  const afterCorr = liveDb.prepare("SELECT hit FROM outcome_snapshots WHERE id = ?").get(predRows[2].id)
  ok("correction: hit can be updated via INSERT OR REPLACE", beforeCorr?.hit === 0 && afterCorr?.hit === 1, { beforeCorr, afterCorr })
  // Restore for clean joins
  intel.recordOutcomes([{ id: predRows[2].id, hit: 0, actualValue: 0, settledAt: new Date().toISOString(), notes: "loss" }], { sport: fixtureSport, date: fixtureRunDate })
  const restored = liveDb.prepare("SELECT hit FROM outcome_snapshots WHERE id = ?").get(predRows[2].id)
  ok("restore: hit can be re-corrected", restored?.hit === 0, restored)

  // ── Block 5: JOIN + calibration shape ────────────────────────────────────
  console.log("\n── Block 5: outcome × prediction join (calibration query shape) ──")
  let joined = null
  try {
    joined = liveDb.prepare(`
      SELECT
        ps.tier            AS tier,
        COUNT(*)           AS n,
        AVG(os.hit)        AS hit_rate,
        AVG(ps.model_prob - os.hit) AS delta_prob_avg
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
      GROUP BY ps.tier
      ORDER BY n DESC
    `).all()
  } catch (_) {}
  ok("calibration JOIN returns rows", Array.isArray(joined) && joined.length >= 1, { joinedLength: joined?.length })
  ok("calibration JOIN includes hit_rate column", joined?.[0] && "hit_rate" in joined[0], joined?.[0])
  ok("calibration JOIN includes delta_prob_avg column", joined?.[0] && "delta_prob_avg" in joined[0], joined?.[0])

  const sumN = (joined || []).reduce((s, r) => s + r.n, 0)
  ok("calibration JOIN total n == 5", sumN === 5, { sumN })

  // ── Block 6: CLASSIFICATION (Phase 1E — INC-013 fix verification) ────────
  console.log("\n── Block 6: classifyBet reads actualValue ?? actualStat (INC-013 fix) ──")
  const { classifyBet } = require("./backend/pipeline/shared/buildPostGameReview")

  // 6a — tracked_bets shape: gradeTrackedBets writes `actualValue` only.
  // Before the Phase 1E fix this returned { hit: null } because classifyBet
  // read `bet.actualStat` (undefined). After fix, hit must be computed.
  const trackedBet = { side: "under", line: 1.5, actualValue: 0 }
  const trackedClass = classifyBet("mlb", trackedBet)
  ok("tracked_bets shape: hit computed (under 1.5, actual=0 → hit=true)",
     trackedClass.hit === true, trackedClass)
  ok("tracked_bets shape: delta computed (0 - 1.5 = -1.5)",
     Math.abs((trackedClass.delta ?? NaN) - (-1.5)) < 1e-9, trackedClass)

  // 6b — legacy mergeActualsOntoBets shape: only `actualStat` present.
  // Backward compatibility — must still classify correctly.
  const legacyBet = { side: "over", line: 0.5, actualStat: 1 }
  const legacyClass = classifyBet("mlb", legacyBet)
  ok("legacy shape: hit computed (over 0.5, stat=1 → hit=true)",
     legacyClass.hit === true, legacyClass)
  ok("legacy shape: delta computed (1 - 0.5 = 0.5)",
     Math.abs((legacyClass.delta ?? NaN) - 0.5) < 1e-9, legacyClass)

  // 6c — both fields present: `actualValue` wins (priority test).
  const bothBet = { side: "over", line: 0.5, actualValue: 1, actualStat: 0 }
  const bothClass = classifyBet("mlb", bothBet)
  ok("both fields: actualValue takes precedence (over 0.5, value=1 → hit=true)",
     bothClass.hit === true, bothClass)

  // 6d — neither field present: hit must remain null (no fabrication).
  const noneBet = { side: "over", line: 0.5 }
  const noneClass = classifyBet("mlb", noneBet)
  ok("no actuals: hit remains null (no fabrication)",
     noneClass.hit === null, noneClass)
  ok("no actuals: delta remains null",
     noneClass.delta === null, noneClass)

  // 6e — push/void result overrides hit computation.
  const pushBet = { side: "over", line: 0.5, actualValue: 1, result: "push" }
  const pushClass = classifyBet("mlb", pushBet)
  ok("result=push: hit overridden to null",
     pushClass.hit === null, pushClass)

  // 6f — under-side: tracked_bets MLB totalbases under 1.5, actual = 0 → win.
  // (Exact shape used by gradeTrackedBets for the 122-bet fixture.)
  const underWin = classifyBet("mlb", { side: "under", line: 1.5, actualValue: 0 })
  ok("under-side win: hit=true (under 1.5, value=0)",
     underWin.hit === true, underWin)
  const underLoss = classifyBet("mlb", { side: "under", line: 1.5, actualValue: 3 })
  ok("under-side loss: hit=false (under 1.5, value=3)",
     underLoss.hit === false, underLoss)

  // ── Cleanup ──────────────────────────────────────────────────────────────
  liveDb.close()
  dbModule.tryGetDb = originalTryGetDb
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
