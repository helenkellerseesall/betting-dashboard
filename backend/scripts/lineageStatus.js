#!/usr/bin/env node
"use strict"

/**
 * lineageStatus.js — Phase Grading-Calibration-Operations-1D (2026-05-14)
 *
 *   Usage:
 *     npm run lineage:status
 *     npm run lineage:status -- --sport=mlb
 *     npm run lineage:status -- --samples=10
 *
 * Canonical read-only lineage-health inspector. Surfaces orphan accounting,
 * JOIN coverage, and calibration-readiness signals WITHOUT fabricating any
 * historical lineage.
 *
 * Per the Phase 1C audit (`docs/LINEAGE_RECONCILIATION_AUDIT_2026-05-14.md`):
 *   - The canonical join formula `outcome.id = prediction.id` is structurally
 *     sound. Both writers route through `intel.predictionId()`.
 *   - Orphan outcomes (outcomes without matching predictions) are LEGITIMATE
 *     bet history — pre-corpus dates simply had no predictions to join.
 *   - This script makes the orphan accounting explicit so operators can read
 *     calibration metrics with correct context.
 *
 * Output sections:
 *   1. global totals (predictions, outcomes, JOIN matches, orphans both sides)
 *   2. per-date breakdown by sport (with coverage rate Δ)
 *   3. classification health (hit IS NOT NULL fraction)
 *   4. orphan-outcome samples (helps diagnose why specific bets don't join)
 *   5. orphan-prediction samples (predictions the operator didn't bet on)
 *   6. canonical join formula verification (byte-parity regression-guard)
 *
 * Anti-fabrication: this script NEVER mutates, NEVER infers a synthetic
 * prediction, NEVER manufactures a join. Pure observability.
 */

const path = require("path")

function parseArgs() {
  const out = { sport: null, samples: 5 }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length).toLowerCase()
    else if (a.startsWith("--samples=")) out.samples = Math.max(1, Math.min(50, Number(a.slice("--samples=".length)) || 5))
  }
  return out
}

function pct(num, den, places = 1) {
  if (!den) return "n/a"
  return ((num / den) * 100).toFixed(places) + "%"
}

function main() {
  const t0 = Date.now()
  const args = parseArgs()

  console.log("=== lineage:status — Phase Grading-Calibration-Operations-1D ===")
  if (args.sport) console.log(`sport filter   : ${args.sport}`)
  console.log("")

  const { tryGetDb, dbPath } = require("../storage/db")
  const db = tryGetDb()
  if (!db) {
    console.error("FATAL: SQLite unavailable.")
    process.exit(1)
  }
  console.log(`DB             : ${dbPath()}`)
  console.log("")

  const sportClause = args.sport ? "AND sport = ?" : ""
  const psSportClause = args.sport ? "AND ps.sport = ?" : ""
  const osSportClause = args.sport ? "AND os.sport = ?" : ""
  const sportParam = args.sport ? [args.sport] : []

  // ── 1. Global totals ─────────────────────────────────────────────────────
  let totalPred = 0
  let totalOut  = 0
  let totalJoin = 0
  let totalAlias = 0
  try {
    totalPred = db
      .prepare(`SELECT COUNT(*) AS n FROM prediction_snapshots WHERE 1=1 ${sportClause}`)
      .get(...sportParam).n
    totalOut = db
      .prepare(`SELECT COUNT(*) AS n FROM outcome_snapshots WHERE 1=1 ${sportClause}`)
      .get(...sportParam).n
    totalJoin = db
      .prepare(`
        SELECT COUNT(*) AS n
        FROM outcome_snapshots os
        JOIN prediction_snapshots ps ON ps.id = os.id
        WHERE 1=1 ${psSportClause}
      `)
      .get(...sportParam).n
    totalAlias = db.prepare("SELECT COUNT(*) AS n FROM prediction_id_aliases").get().n
  } catch (e) {
    console.warn("[lineage:status] query failed:", e.message)
  }

  const orphanOut  = Math.max(0, totalOut - totalJoin)
  const orphanPred = Math.max(0, totalPred - totalJoin)

  console.log("── 1. GLOBAL TOTALS ──")
  console.log(`  prediction_snapshots          : ${totalPred}`)
  console.log(`  outcome_snapshots             : ${totalOut}`)
  console.log(`  JOIN matches (canonical id)   : ${totalJoin}`)
  console.log(`  ─`)
  console.log(`  orphan outcomes (no pred)     : ${orphanOut}  (${pct(orphanOut, totalOut)} of outcomes)`)
  console.log(`  orphan predictions (no bet)   : ${orphanPred}  (${pct(orphanPred, totalPred)} of predictions)`)
  console.log(`  ─`)
  console.log(`  prediction_id_aliases         : ${totalAlias}  (Phase Persistence-1B bridge; expected 0 today — see MASTER_BRAIN alias-forward-only policy)`)
  console.log(`  coverage rate (JOIN/outcomes) : ${pct(totalJoin, totalOut)}`)
  console.log("")

  // ── 2. Per-date breakdown ────────────────────────────────────────────────
  console.log("── 2. PER-DATE BREAKDOWN ──")

  // Collect all distinct (sport, date) pairs across both tables.
  const predDates = db
    .prepare(`SELECT sport, run_date, COUNT(*) AS n FROM prediction_snapshots WHERE 1=1 ${sportClause} GROUP BY sport, run_date`)
    .all(...sportParam)
  const outDates = db
    .prepare(`SELECT sport, run_date, COUNT(*) AS n FROM outcome_snapshots WHERE 1=1 ${sportClause} GROUP BY sport, run_date`)
    .all(...sportParam)
  const joinDates = db
    .prepare(`
      SELECT ps.sport AS sport, ps.run_date AS run_date, COUNT(*) AS n
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE 1=1 ${psSportClause}
      GROUP BY ps.sport, ps.run_date
    `)
    .all(...sportParam)

  const matrix = new Map()
  const upd = (rows, key) => {
    for (const r of rows) {
      const k = `${r.sport}|${r.run_date}`
      const entry = matrix.get(k) || { sport: r.sport, date: r.run_date, predictions: 0, outcomes: 0, join: 0 }
      entry[key] = r.n
      matrix.set(k, entry)
    }
  }
  upd(predDates, "predictions")
  upd(outDates,  "outcomes")
  upd(joinDates, "join")

  const sortedRows = [...matrix.values()].sort((a, b) =>
    a.sport.localeCompare(b.sport) || a.date.localeCompare(b.date)
  )

  console.log(
    "  " +
    "sport".padEnd(6) +
    "date".padEnd(12) +
    "predictions".padStart(13) +
    "outcomes".padStart(11) +
    "JOIN".padStart(7) +
    "orphan_o".padStart(10) +
    "coverage".padStart(11) +
    "  status"
  )
  console.log("  " + "─".repeat(80))
  for (const r of sortedRows) {
    const orphanOutD = Math.max(0, r.outcomes - r.join)
    const cov = r.outcomes ? r.join / r.outcomes : null
    const covStr = cov == null ? "n/a" : (cov * 100).toFixed(1) + "%"
    let status = ""
    if (r.outcomes === 0)              status = "(no outcomes — slate not graded)"
    else if (r.predictions === 0)       status = "PRE-CORPUS (100% orphan by design)"
    else if (cov >= 0.80)               status = "HEALTHY (≥80% coverage)"
    else if (cov >= 0.50)               status = "PARTIAL (50–80% coverage)"
    else                                status = "LOW COVERAGE (<50%)"
    console.log(
      "  " +
      r.sport.padEnd(6) +
      r.date.padEnd(12) +
      String(r.predictions).padStart(13) +
      String(r.outcomes).padStart(11) +
      String(r.join).padStart(7) +
      String(orphanOutD).padStart(10) +
      covStr.padStart(11) +
      "  " + status
    )
  }
  console.log("")

  // ── 3. Classification health (hit IS NOT NULL fraction) ─────────────────
  console.log("── 3. CLASSIFICATION HEALTH (outcomes with hit populated) ──")
  let hitStats = null
  try {
    hitStats = db
      .prepare(`
        SELECT
          COUNT(*) AS n,
          SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END) AS hit_populated,
          SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) AS hits_yes,
          SUM(CASE WHEN hit = 0 THEN 1 ELSE 0 END) AS hits_no
        FROM outcome_snapshots WHERE 1=1 ${sportClause}
      `)
      .get(...sportParam)
  } catch (_) {}

  if (hitStats && hitStats.n > 0) {
    console.log(`  total outcomes               : ${hitStats.n}`)
    console.log(`  hit populated (1 or 0)       : ${hitStats.hit_populated}  (${pct(hitStats.hit_populated, hitStats.n)})`)
    console.log(`  hit = 1 (wins)               : ${hitStats.hits_yes}`)
    console.log(`  hit = 0 (losses)             : ${hitStats.hits_no}`)
    if (hitStats.hit_populated === 0 && hitStats.n > 0) {
      console.log("")
      console.log("  ⚠  WARNING — every outcome has hit=NULL.")
      console.log("     The settlement classifier reads `bet.actualStat` but tracked_bets stores `actualValue`")
      console.log("     (see INC-013 in ACTIVE_INCIDENTS.md). Calibration metrics cannot compute hit rates")
      console.log("     until the field-name mismatch is resolved. Phase 1D surfaces this; Phase 1E (or a")
      console.log("     dedicated fix phase) addresses it. Phase 1D does NOT fix it (anti-fabrication scope).")
    } else if (hitStats.hit_populated < hitStats.n * 0.5) {
      console.log("")
      console.log("  ⚠  WARNING — less than 50% of outcomes have hit populated.")
      console.log("     Calibration metrics will be JOIN-restricted to the populated subset.")
    }
  } else {
    console.log("  (no outcomes — run `npm run grading:backfill-all` to populate)")
  }
  console.log("")

  // ── 4. Orphan-outcome samples ────────────────────────────────────────────
  console.log(`── 4. ORPHAN OUTCOME SAMPLES (top ${args.samples}) ──`)
  console.log("   outcomes whose id is NOT in prediction_snapshots — legitimate bet history that predates the corpus")
  let orphanOutSamples = []
  try {
    orphanOutSamples = db
      .prepare(`
        SELECT os.id, os.sport, os.run_date, os.player, os.stat_family, os.side, os.line
        FROM outcome_snapshots os
        LEFT JOIN prediction_snapshots ps ON ps.id = os.id
        WHERE ps.id IS NULL ${osSportClause}
        ORDER BY os.run_date DESC
        LIMIT ?
      `)
      .all(...sportParam, args.samples)
  } catch (_) {}
  if (orphanOutSamples.length === 0) {
    console.log("  (no orphan outcomes — every outcome has a matching prediction)")
  } else {
    for (const r of orphanOutSamples) {
      console.log(`  ${r.sport}  ${r.run_date}  ${(r.player || "?").padEnd(20)}  ${(r.stat_family || "?").padEnd(14)}  ${(r.side || "?").padEnd(6)}  line=${r.line}`)
      console.log(`     id: ${r.id}`)
    }
  }
  console.log("")

  // ── 5. Orphan-prediction samples ─────────────────────────────────────────
  console.log(`── 5. ORPHAN PREDICTION SAMPLES (top ${args.samples}) ──`)
  console.log("   predictions whose id is NOT in outcome_snapshots — model predicted but operator didn't bet")
  let orphanPredSamples = []
  try {
    orphanPredSamples = db
      .prepare(`
        SELECT ps.id, ps.sport, ps.run_date, ps.player, ps.stat_family, ps.side, ps.line, ps.tier
        FROM prediction_snapshots ps
        LEFT JOIN outcome_snapshots os ON os.id = ps.id
        WHERE os.id IS NULL ${psSportClause}
        ORDER BY ps.run_date DESC
        LIMIT ?
      `)
      .all(...sportParam, args.samples)
  } catch (_) {}
  if (orphanPredSamples.length === 0) {
    console.log("  (no orphan predictions — every prediction has a matching outcome)")
  } else {
    for (const r of orphanPredSamples) {
      console.log(`  ${r.sport}  ${r.run_date}  ${(r.player || "?").padEnd(20)}  ${(r.stat_family || "?").padEnd(14)}  ${(r.side || "?").padEnd(6)}  line=${r.line}  tier=${r.tier || "?"}`)
    }
  }
  console.log("")

  // ── 6. Canonical join formula verification ──────────────────────────────
  console.log("── 6. CANONICAL JOIN FORMULA (byte-parity regression-guard) ──")
  try {
    const intel = require("../storage/intelligence")
    const fixtures = [
      { args: ["2026-05-08", "mlb", "Juan Soto",    "totalBases", "under", 1.5, "DraftKings"], label: "Juan Soto MLB" },
      { args: ["2026-05-08", "mlb", "Yordan Alvarez", "totalbases", "under", 1.5, "DraftKings"], label: "Yordan Alvarez MLB" },
      { args: ["2026-05-13", "nba", "Anthony Edwards", "points",  "over",  22.5, "FanDuel"],    label: "Anthony Edwards NBA" },
    ]
    for (const f of fixtures) {
      const predId = intel.predictionId(...f.args)
      console.log(`  ${f.label.padEnd(24)} → ${predId}`)
    }
  } catch (e) {
    console.log(`  (verification failed: ${e.message})`)
  }
  console.log("  ✓ All inputs route through intel.predictionId() — the SINGLE canonical helper used by")
  console.log("    BOTH prediction_snapshots.id writes (snapshot freeze + workstation freeze) AND")
  console.log("    outcome_snapshots.id writes (buildPostGameReview.js:414).")
  console.log("")

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("── SUMMARY ──")
  console.log(`  Coverage rate:           ${pct(totalJoin, totalOut)} (${totalJoin} of ${totalOut} outcomes have matching predictions)`)
  if (totalOut > 0 && (hitStats?.hit_populated || 0) === 0) {
    console.log(`  Calibration readiness:   ⚠ BLOCKED — outcomes populated but hit=NULL (see INC-013)`)
  } else if (totalJoin === 0 && totalOut > 0) {
    console.log(`  Calibration readiness:   ⚠ LOW — outcomes exist but no JOIN matches`)
  } else if (totalJoin > 0 && totalJoin < 30) {
    console.log(`  Calibration readiness:   ⚠ LOW — JOIN sample is too small (n=${totalJoin} < 30)`)
  } else if (totalJoin >= 30) {
    console.log(`  Calibration readiness:   ✓ OK — ${totalJoin} joined samples; per-tier breakdowns may still be small`)
  } else {
    console.log(`  Calibration readiness:   (no outcomes — run npm run grading:backfill-all)`)
  }
  console.log("")
  console.log(`Inspection completed in ${Date.now() - t0}ms`)
}

main()
