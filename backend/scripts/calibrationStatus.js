#!/usr/bin/env node
"use strict"

/**
 * calibrationStatus.js — Phase Grading-Calibration-Operations-1B (2026-05-14)
 *
 *   Usage:
 *     npm run calibration:status
 *     npm run calibration:status -- --sport=mlb
 *
 * Canonical read-only calibration-health inspector.
 *
 * Joins outcome_snapshots × prediction_snapshots to surface:
 *   - per-tier hit rate (ELITE / STRONG / PLAYABLE / VALUE / BASE)
 *   - per-volatility hit rate (safe / balanced / aggressive / lotto)
 *   - per-side hit rate (over / under)
 *   - per-stat-family hit rate (top families by sample size)
 *   - avg delta_prob (model_prob − hit) for calibration drift signal
 *   - sample size + signed-square error
 *
 * Shows Session W table population (daily_intelligence_reports etc.) since
 * those are populated by `stepDailyIntelligenceReview` in the orchestrator.
 *
 * Empty by design today (pre-Phase Grading-Calibration-Operations-1B
 * orchestrator activation). Once `npm run grading:backfill-all` runs, the
 * outcome corpus populates and this script becomes the canonical health
 * check for the learning loop.
 *
 * Pure observability. Read-only. Never mutates.
 */

const path = require("path")

function parseArgs() {
  const out = { sport: null }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length).toLowerCase()
  }
  return out
}

function rateOrNull(n, d) {
  if (!d) return null
  return n / d
}

function fmt(n, places = 3) {
  if (n == null) return "n/a"
  return Number(n).toFixed(places)
}

function fmtPct(n, places = 1) {
  if (n == null) return "n/a"
  return (n * 100).toFixed(places) + "%"
}

function main() {
  const t0 = Date.now()
  const args = parseArgs()

  console.log("=== calibration:status — Phase Grading-Calibration-Operations-1B ===")
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

  // ── 1. Corpus size ──────────────────────────────────────────────────────
  let totalOutcomes = 0
  let totalPredictions = 0
  let totalSlipOutcomes = 0
  try { totalOutcomes      = db.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get().n } catch (_) {}
  try { totalPredictions   = db.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots").get().n } catch (_) {}
  try { totalSlipOutcomes  = db.prepare("SELECT COUNT(*) AS n FROM slip_outcomes").get().n } catch (_) {}

  console.log("── corpus size ──")
  console.log(`  prediction_snapshots          : ${totalPredictions}`)
  console.log(`  outcome_snapshots             : ${totalOutcomes}`)
  console.log(`  slip_outcomes                 : ${totalSlipOutcomes}`)
  console.log("")

  if (totalOutcomes === 0) {
    console.log("── calibration corpus is EMPTY ──")
    console.log("  No outcome_snapshots rows yet. The learning loop has no data.")
    console.log("  Activation path:")
    console.log("    1) npm run grading:run        -- --date=<YYYY-MM-DD>   (settle bets in JSON)")
    console.log("    2) npm run grading:backfill   -- --sport=<X> --date=<YYYY-MM-DD>  (orchestrator → SQLite)")
    console.log("       OR npm run grading:backfill-all")
    console.log("  See docs/GRADING_TOPOLOGY_AUDIT_2026-05-14.md for the full chain.")
    console.log("")
    process.exit(0)
  }

  // ── Phase Grading-Calibration-Operations-1D additions ───────────────────
  // JOIN-restricted coverage + classification-health checks.
  // Per Phase 1C audit: prior code reported "(no rows in join — see
  // prediction_id_aliases)" which was MISLEADING when the join is empty
  // for non-alias reasons (empty hit fields, pre-corpus orphans, etc.).
  // Below we replace that hint with explicit, structured diagnostics.

  let totalJoin = 0
  let hitPopulated = 0
  try {
    totalJoin = db
      .prepare(`
        SELECT COUNT(*) AS n
        FROM outcome_snapshots os
        JOIN prediction_snapshots ps ON ps.id = os.id
        WHERE 1=1 ${sportClause.replace(/ps\.sport/, "ps.sport").replace(/ AND ps\.sport/, " AND ps.sport") || ""}
      `)
      .get(...sportParam).n
    hitPopulated = db
      .prepare(`
        SELECT COUNT(*) AS n FROM outcome_snapshots
        WHERE hit IS NOT NULL
          ${args.sport ? "AND sport = ?" : ""}
      `)
      .get(...(args.sport ? [args.sport] : [])).n
  } catch (_) {}

  const coverageRate = totalOutcomes ? (totalJoin / totalOutcomes) : 0
  const hitRate      = totalOutcomes ? (hitPopulated / totalOutcomes) : 0

  console.log("── Phase 1D coverage diagnostics ──")
  console.log(`  outcomes total                : ${totalOutcomes}`)
  console.log(`  outcomes with hit populated   : ${hitPopulated}  (${(hitRate * 100).toFixed(1)}%)`)
  console.log(`  JOIN matches (canonical id)   : ${totalJoin}  (${(coverageRate * 100).toFixed(1)}% of outcomes)`)
  console.log(`  orphan outcomes (no prediction): ${totalOutcomes - totalJoin}  — legitimate bet history; see lineage:status`)
  if (hitPopulated === 0 && totalOutcomes > 0) {
    console.log("")
    console.log("  ⚠  CALIBRATION BLOCKED — every outcome has hit=NULL.")
    console.log("     The settlement classifier reads `bet.actualStat` but tracked_bets stores `actualValue`")
    console.log("     (INC-013). Calibration cannot compute hit rates until the field-name mismatch is fixed.")
    console.log("     Phase 1D surfaces this; remediation is a separate phase (Phase 1E candidate).")
    console.log("")
    console.log("     Until then, all per-tier / per-volatility / per-side / per-family hit rates below")
    console.log("     will show as n/a or 0.0% — NOT because the model is wrong, but because the")
    console.log("     classification pipeline is dropping the hit signal.")
    console.log("")
  } else if (totalJoin < 30 && totalJoin > 0) {
    console.log("")
    console.log(`  ⚠  LOW SAMPLE — only ${totalJoin} JOIN-matched outcomes. Per-tier breakdowns may have <10 samples.`)
    console.log(`     Treat per-tier hit rates as preliminary until sample size grows.`)
    console.log("")
  } else if (coverageRate < 0.50 && totalOutcomes > 30) {
    console.log("")
    console.log(`  ⚠  LOW COVERAGE — only ${(coverageRate * 100).toFixed(1)}% of outcomes have matching predictions.`)
    console.log(`     ${totalOutcomes - totalJoin} orphan outcomes are pre-corpus bet history (see lineage:status).`)
    console.log(`     Calibration metrics below are JOIN-restricted to the matching subset.`)
    console.log("")
  }
  console.log("")

  const sportClause = args.sport ? "AND ps.sport = ?" : ""
  const sportParam  = args.sport ? [args.sport] : []

  // ── 2. Per-tier hit rate ────────────────────────────────────────────────
  console.log("── per-tier hit rate (outcome × prediction join) ──")
  let tierRows = []
  try {
    tierRows = db.prepare(`
      SELECT
        ps.tier            AS tier,
        COUNT(*)           AS n,
        SUM(os.hit)        AS hits,
        AVG(ps.model_prob - os.hit) AS delta_prob_avg,
        AVG(ps.model_prob) AS model_prob_avg,
        AVG(os.hit)        AS hit_rate
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        ${sportClause}
      GROUP BY ps.tier
      ORDER BY COUNT(*) DESC
    `).all(...sportParam)
  } catch (e) {
    console.log(`  (query failed: ${e.message})`)
  }
  if (tierRows.length === 0) {
    console.log("  (no rows in join — outcome_snapshots may lack matching prediction_snapshots ids — see prediction_id_aliases)")
  } else {
    console.log("  " + "tier".padEnd(12) + "n".padStart(6) + "hit_rate".padStart(11) + "model_avg".padStart(12) + "delta_avg".padStart(12))
    for (const r of tierRows) {
      console.log("  " +
        String(r.tier || "null").padEnd(12) +
        String(r.n).padStart(6) +
        fmtPct(r.hit_rate).padStart(11) +
        fmt(r.model_prob_avg, 3).padStart(12) +
        fmt(r.delta_prob_avg, 4).padStart(12)
      )
    }
  }
  console.log("")

  // ── 3. Per-volatility hit rate ──────────────────────────────────────────
  console.log("── per-volatility hit rate ──")
  let volRows = []
  try {
    volRows = db.prepare(`
      SELECT
        ps.volatility      AS volatility,
        COUNT(*)           AS n,
        SUM(os.hit)        AS hits,
        AVG(ps.model_prob - os.hit) AS delta_prob_avg,
        AVG(ps.model_prob) AS model_prob_avg,
        AVG(os.hit)        AS hit_rate
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        ${sportClause}
      GROUP BY ps.volatility
      ORDER BY COUNT(*) DESC
    `).all(...sportParam)
  } catch (_) {}
  if (volRows.length === 0) {
    console.log("  (no rows)")
  } else {
    console.log("  " + "volatility".padEnd(14) + "n".padStart(6) + "hit_rate".padStart(11) + "model_avg".padStart(12) + "delta_avg".padStart(12))
    for (const r of volRows) {
      console.log("  " +
        String(r.volatility || "null").padEnd(14) +
        String(r.n).padStart(6) +
        fmtPct(r.hit_rate).padStart(11) +
        fmt(r.model_prob_avg, 3).padStart(12) +
        fmt(r.delta_prob_avg, 4).padStart(12)
      )
    }
  }
  console.log("")

  // ── 4. Per-side hit rate ────────────────────────────────────────────────
  console.log("── per-side hit rate ──")
  let sideRows = []
  try {
    sideRows = db.prepare(`
      SELECT
        ps.side            AS side,
        COUNT(*)           AS n,
        AVG(ps.model_prob - os.hit) AS delta_prob_avg,
        AVG(os.hit)        AS hit_rate
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        ${sportClause}
      GROUP BY ps.side
      ORDER BY COUNT(*) DESC
    `).all(...sportParam)
  } catch (_) {}
  if (sideRows.length === 0) {
    console.log("  (no rows)")
  } else {
    console.log("  " + "side".padEnd(8) + "n".padStart(6) + "hit_rate".padStart(11) + "delta_avg".padStart(12))
    for (const r of sideRows) {
      console.log("  " +
        String(r.side || "null").padEnd(8) +
        String(r.n).padStart(6) +
        fmtPct(r.hit_rate).padStart(11) +
        fmt(r.delta_prob_avg, 4).padStart(12)
      )
    }
  }
  console.log("")

  // ── 5. Per-stat-family (top 10 by sample size) ──────────────────────────
  console.log("── per-stat-family hit rate (top 10 by sample size) ──")
  let famRows = []
  try {
    famRows = db.prepare(`
      SELECT
        ps.stat_family     AS stat_family,
        COUNT(*)           AS n,
        AVG(ps.model_prob - os.hit) AS delta_prob_avg,
        AVG(os.hit)        AS hit_rate
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        ${sportClause}
      GROUP BY ps.stat_family
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `).all(...sportParam)
  } catch (_) {}
  if (famRows.length === 0) {
    console.log("  (no rows)")
  } else {
    console.log("  " + "stat_family".padEnd(20) + "n".padStart(6) + "hit_rate".padStart(11) + "delta_avg".padStart(12))
    for (const r of famRows) {
      console.log("  " +
        String(r.stat_family || "null").padEnd(20) +
        String(r.n).padStart(6) +
        fmtPct(r.hit_rate).padStart(11) +
        fmt(r.delta_prob_avg, 4).padStart(12)
      )
    }
  }
  console.log("")

  // ── 6. Session W table population ───────────────────────────────────────
  console.log("── Session W review tables ──")
  const reviewTables = [
    "daily_intelligence_reports",
    "calibration_records",
    "ecology_grades",
    "volatility_realizations",
    "eruption_events",
    "process_classifications",
  ]
  for (const t of reviewTables) {
    try {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
      console.log(`  ${t.padEnd(34)} : ${n}`)
    } catch (e) {
      console.log(`  ${t.padEnd(34)} : ERR ${e.message}`)
    }
  }
  console.log("")

  // ── 7. delta_prob global health signal ──────────────────────────────────
  let global = null
  try {
    global = db.prepare(`
      SELECT
        COUNT(*) AS n,
        AVG(ps.model_prob - os.hit) AS delta_prob_avg,
        AVG((ps.model_prob - os.hit) * (ps.model_prob - os.hit)) AS brier
      FROM outcome_snapshots os
      JOIN prediction_snapshots ps ON ps.id = os.id
      WHERE os.hit IS NOT NULL
        ${sportClause}
    `).get(...sportParam)
  } catch (_) {}
  console.log("── global calibration signal ──")
  if (global && global.n) {
    console.log(`  n                    : ${global.n}`)
    console.log(`  avg delta_prob       : ${fmt(global.delta_prob_avg, 4)}    (closer to 0 = better calibrated)`)
    console.log(`  Brier score (approx) : ${fmt(global.brier, 4)}              (lower = better; 0.25 = always-50% baseline)`)
  } else {
    console.log("  (no joined rows)")
  }
  console.log("")

  const elapsedMs = Date.now() - t0
  console.log(`calibration:status completed in ${elapsedMs}ms`)
}

main()
