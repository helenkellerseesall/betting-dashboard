#!/usr/bin/env node
"use strict"

/**
 * gradingStatus.js — Phase Grading-Calibration-Operations-1B (2026-05-14)
 *
 *   Usage:
 *     npm run grading:status
 *     npm run grading:status -- --sport=mlb
 *
 * Canonical read-only parity inspector for the grading layer.
 *
 * Shows per-date breakdown of:
 *   - tracked_bets_{sport}_{date}.json     — total + settled count
 *   - tracked_slips_{sport}_{date}.json    — total + settled count
 *   - SQLite outcome_snapshots             — row count for that sport+date
 *   - SQLite slip_outcomes                 — row count for that sport+date
 *   - personal_ledger settled count        — JSON ledger entries with result≠pending for that date
 *   - JSON vs SQLite delta                 — visualizes lag (positive = SQLite missing rows)
 *
 * Pure observability. Read-only. Never mutates. Mirrors the existing
 * `persistence:status` / `epoch:status` inspector pattern (Phase
 * Persistence-1B + Phase Longitudinal-Integrity-1B precedents).
 *
 * Tracking-file-grouping pattern matches `persistenceStatus.js`.
 */

const fs   = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

function parseArgs() {
  const out = { sport: null }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length).toLowerCase()
  }
  return out
}

function listBetFiles(sport) {
  const prefix = `${sport}_tracked_bets_`
  let files = []
  try {
    files = fs.readdirSync(TRACKING_DIR).filter((f) =>
      f.startsWith(prefix) && f.endsWith(".json") && !f.includes("9999")
    ).sort()
  } catch (_) {}
  return files
}

function listSlipFiles(sport) {
  const prefix = `${sport}_tracked_slips_`
  let files = []
  try {
    files = fs.readdirSync(TRACKING_DIR).filter((f) =>
      f.startsWith(prefix) && f.endsWith(".json") && !f.includes("9999")
    ).sort()
  } catch (_) {}
  return files
}

function countSettledInJson(filePath) {
  try {
    const arr = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const bets = Array.isArray(arr) ? arr : []
    return {
      total:   bets.length,
      settled: bets.filter((b) => b.result && ["win", "loss", "push", "unresolved"].includes(b.result)).length,
    }
  } catch (_) {
    return { total: 0, settled: 0 }
  }
}

function dateFromFilename(f) {
  const m = f.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function main() {
  const t0 = Date.now()
  const args = parseArgs()
  const sports = args.sport ? [args.sport] : ["mlb", "nba"]

  console.log("=== grading:status — Phase Grading-Calibration-Operations-1B ===")
  console.log(`sports         : ${sports.join(", ")}`)
  console.log("")

  // SQLite outcome counts grouped by (sport, run_date)
  const { tryGetDb, dbPath } = require("../storage/db")
  const db = tryGetDb()
  if (!db) {
    console.error("FATAL: SQLite unavailable.")
    process.exit(1)
  }
  console.log(`DB             : ${dbPath()}`)
  console.log("")

  for (const sport of sports) {
    console.log(`── ${sport.toUpperCase()} ──`)

    const betFiles = listBetFiles(sport)
    const slipFiles = listSlipFiles(sport)

    let outcomeRows = []
    let slipOutcomeRows = []
    let joinRows = []
    try {
      outcomeRows = db
        .prepare("SELECT run_date AS date, COUNT(*) AS n FROM outcome_snapshots WHERE sport = ? GROUP BY run_date")
        .all(sport)
      slipOutcomeRows = db
        .prepare("SELECT run_date AS date, COUNT(*) AS n FROM slip_outcomes WHERE sport = ? GROUP BY run_date")
        .all(sport)
      // Phase Grading-Calibration-Operations-1D — JOIN-success per date.
      joinRows = db
        .prepare(`
          SELECT ps.run_date AS date, COUNT(*) AS n
          FROM outcome_snapshots os
          JOIN prediction_snapshots ps ON ps.id = os.id
          WHERE ps.sport = ?
          GROUP BY ps.run_date
        `)
        .all(sport)
    } catch (_) { /* tables may not exist on fresh repo */ }

    const outcomeByDate = {}
    for (const r of outcomeRows) outcomeByDate[r.date] = r.n
    const slipOutcomeByDate = {}
    for (const r of slipOutcomeRows) slipOutcomeByDate[r.date] = r.n
    const joinByDate = {}
    for (const r of joinRows) joinByDate[r.date] = r.n

    if (betFiles.length === 0) {
      console.log(`  (no ${sport}_tracked_bets_*.json files)`)
      console.log("")
      continue
    }

    // Header (Phase 1D adds JOIN column)
    console.log(
      "  " +
      "date".padEnd(12) +
      "bets/total".padStart(12) +
      "bets/settled".padStart(14) +
      "sqlite/outc".padStart(13) +
      "Δ bets".padStart(8) +
      "JOIN".padStart(7) +
      "slips/total".padStart(13) +
      "slips/settled".padStart(15) +
      "sqlite/slip".padStart(13) +
      "Δ slips".padStart(9)
    )
    console.log("  " + "─".repeat(117))

    const allDates = new Set()
    for (const f of betFiles)  { const d = dateFromFilename(f); if (d) allDates.add(d) }
    for (const f of slipFiles) { const d = dateFromFilename(f); if (d) allDates.add(d) }
    const sortedDates = [...allDates].sort()

    let totals = { betsTotal: 0, betsSettled: 0, outcome: 0, slipsTotal: 0, slipsSettled: 0, slipOutc: 0 }
    for (const date of sortedDates) {
      const betFile = `${sport}_tracked_bets_${date}.json`
      const slipFile = `${sport}_tracked_slips_${date}.json`
      const bets = fs.existsSync(path.join(TRACKING_DIR, betFile))
        ? countSettledInJson(path.join(TRACKING_DIR, betFile))
        : { total: 0, settled: 0 }
      const slips = fs.existsSync(path.join(TRACKING_DIR, slipFile))
        ? countSettledInJson(path.join(TRACKING_DIR, slipFile))
        : { total: 0, settled: 0 }
      const outcome = outcomeByDate[date] || 0
      const slipOutc = slipOutcomeByDate[date] || 0
      const joinHit = joinByDate[date] || 0
      const deltaBets = bets.settled - outcome
      const deltaSlips = slips.settled - slipOutc

      totals.betsTotal    += bets.total
      totals.betsSettled  += bets.settled
      totals.outcome      += outcome
      totals.join         = (totals.join || 0) + joinHit
      totals.slipsTotal   += slips.total
      totals.slipsSettled += slips.settled
      totals.slipOutc     += slipOutc

      console.log(
        "  " +
        date.padEnd(12) +
        String(bets.total).padStart(12) +
        String(bets.settled).padStart(14) +
        String(outcome).padStart(13) +
        String(deltaBets).padStart(8) +
        String(joinHit).padStart(7) +
        String(slips.total).padStart(13) +
        String(slips.settled).padStart(15) +
        String(slipOutc).padStart(13) +
        String(deltaSlips).padStart(9)
      )
    }

    console.log("  " + "─".repeat(117))
    console.log(
      "  " +
      "TOTAL".padEnd(12) +
      String(totals.betsTotal).padStart(12) +
      String(totals.betsSettled).padStart(14) +
      String(totals.outcome).padStart(13) +
      String(totals.betsSettled - totals.outcome).padStart(8) +
      String(totals.join || 0).padStart(7) +
      String(totals.slipsTotal).padStart(13) +
      String(totals.slipsSettled).padStart(15) +
      String(totals.slipOutc).padStart(13) +
      String(totals.slipsSettled - totals.slipOutc).padStart(9)
    )
    console.log("")
  }

  // Personal-ledger snapshot
  console.log("── personal_ledger settlement state ──")
  const ledgerPath = path.join(TRACKING_DIR, "personal_ledger.json")
  if (fs.existsSync(ledgerPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
      const bets = Array.isArray(data?.bets) ? data.bets : []
      const counts = {
        total:      bets.length,
        pending:    bets.filter((b) => !b.result || b.result === "pending").length,
        win:        bets.filter((b) => b.result === "win").length,
        loss:       bets.filter((b) => b.result === "loss").length,
        push:       bets.filter((b) => b.result === "push").length,
        unresolved: bets.filter((b) => b.result === "unresolved").length,
      }
      console.log(`  JSON  total=${counts.total}  pending=${counts.pending}  win=${counts.win}  loss=${counts.loss}  push=${counts.push}  unresolved=${counts.unresolved}`)
    } catch (e) {
      console.log(`  (parse error: ${e.message})`)
    }
  }
  try {
    const sqliteCount = db.prepare("SELECT COUNT(*) AS n FROM personal_ledger").get().n
    const sqliteSettled = db.prepare("SELECT COUNT(*) AS n FROM personal_ledger WHERE result IS NOT NULL AND result != 'pending'").get().n
    console.log(`  SQLite total=${sqliteCount}  settled=${sqliteSettled}`)
  } catch (_) {
    console.log("  SQLite (table missing or unreadable)")
  }
  console.log("")

  // Grading-pipeline interpretation guide
  console.log("── interpretation ──")
  console.log("  Δ bets / Δ slips > 0  →  SQLite outcome layer is missing rows JSON has — run grading:backfill-all")
  console.log("  Δ = 0                  →  Parity intact for that (sport, date)")
  console.log("  Δ < 0                  →  SQLite has more rows than JSON (unusual; may indicate a backfill from another source)")
  console.log("  JOIN column            →  per-date count of outcomes that match a prediction in prediction_snapshots.")
  console.log("                              Low/zero JOIN with high outcome count = pre-corpus or partial-coverage date")
  console.log("                              (predictions corpus only began populating ~2026-05-07; see lineage:status).")
  console.log("")

  const elapsedMs = Date.now() - t0
  console.log(`grading:status completed in ${elapsedMs}ms`)
}

main()
