"use strict"

/**
 * SQLite database layer — Phase 1
 *
 * Uses Node.js built-in node:sqlite (available Node 22.5+).
 * Zero npm dependencies.
 *
 * JSON files in backend/runtime/tracking/ remain CANONICAL.
 * This module is additive — analytics history only.
 *
 * Usage:
 *   const { tryGetDb } = require("../storage/db")
 *   const db = tryGetDb()
 *   if (db) { ... } // null if unavailable (graceful degradation)
 *
 * Database file: backend/storage/betting.db  (gitignored)
 */

const path  = require("path")
const fs    = require("fs")
const { applySchema } = require("./schema")

const DB_PATH = path.join(__dirname, "betting.db")

let _db   = null   // singleton DatabaseSync instance
let _ok   = null   // tri-state: null=not tried, true=ok, false=failed

// ─────────────────────────────────────────────────────────────────────────────
// Suppress the node:sqlite ExperimentalWarning.
// It fires once per process; we silence it so nightly output stays clean.
// This only intercepts that specific warning — all others pass through.
// ─────────────────────────────────────────────────────────────────────────────
const _origEmit = process.emit.bind(process)
process.emit = function _filteredEmit(name, event, ...rest) {
  if (
    name    === "warning" &&
    event   != null &&
    event.name === "ExperimentalWarning" &&
    typeof event.message === "string" &&
    event.message.includes("SQLite")
  ) {
    return false
  }
  return _origEmit(name, event, ...rest)
}

// ─────────────────────────────────────────────────────────────────────────────
// Critical tables that MUST exist after applySchema completes. Used by the
// boot-time post-condition check (Session BA) so any future schema-application
// regression is loud and obvious in the boot log instead of silent.
// ─────────────────────────────────────────────────────────────────────────────
const CRITICAL_TABLES = [
  // Phase 1 (schema.js)
  "tracked_props",
  "slip_catalog",
  "personal_ledger",
  // Intelligence layer (intelligenceSchema.js)
  "prediction_snapshots",
  "outcome_snapshots",
  "slip_outcomes",
  "ecology_snapshots",
  // Session AZ (intelligenceSchema.js — Frozen Prediction + Grading Architecture)
  "prediction_epochs",
  "frozen_contextual_states",
]

function _verifyCriticalTables(db) {
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  )
  const missing = CRITICAL_TABLES.filter(t => !existing.has(t))
  return { existing: [...existing], missing }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Persistence-1B (2026-05-14) — Ledger parity integrity check.
//
// Reads personal_ledger.json (bets[] length) and compares to the SQLite
// personal_ledger COUNT(*). Emits [LEDGER-DIVERGENCE-DETECTED] and inserts a
// row into ledger_divergence_log ONLY when SQLite is missing rows the JSON
// has (delta > 0). The reverse case (delta < 0) is expected once the JSON
// ring buffer has cycled past MAX_BETS=2000 and is NOT a divergence.
//
// Pure observability. NEVER blocks boot. NEVER auto-repairs. Wrapped in
// try/catch — any error returns gracefully.
//
// Source = 'boot_check' for this call site. Other callers (probes, manual
// scripts) can invoke checkLedgerIntegrity(db, { source: 'probe' }) directly.
// ─────────────────────────────────────────────────────────────────────────────
function checkLedgerIntegrity(db, opts = {}) {
  const source = String(opts.source || "boot_check")
  try {
    const ledgerPath = path.join(__dirname, "..", "runtime", "tracking", "personal_ledger.json")
    if (!fs.existsSync(ledgerPath)) {
      return { ok: true, reason: "json_missing_fresh_repo", jsonBetCount: 0, sqliteBetCount: 0, delta: 0 }
    }
    const raw = fs.readFileSync(ledgerPath, "utf8")
    const data = JSON.parse(raw)
    const jsonBetCount = Array.isArray(data?.bets) ? data.bets.length : 0

    let sqliteBetCount = 0
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM personal_ledger").get()
      sqliteBetCount = row?.n || 0
    } catch (queryErr) {
      // Table may not exist on a brand-new DB; treat as 0 and continue.
      sqliteBetCount = 0
    }

    const delta = jsonBetCount - sqliteBetCount

    // Only delta > 0 is a divergence we care about. delta < 0 happens after
    // the JSON ring buffer cycles past MAX_BETS=2000 (SQLite uncapped) —
    // that's expected steady-state, not a problem.
    if (delta > 0) {
      console.log("[LEDGER-DIVERGENCE-DETECTED]", {
        jsonBetCount,
        sqliteBetCount,
        delta,
        source,
        note:
          sqliteBetCount === 0
            ? "SQLite mirror cold — run `npm run persistence:import` to backfill 2,000 JSON bets into SQLite"
            : "SQLite mirror is missing " + delta + " bets — investigate saveLedger write path or run `npm run persistence:import`",
      })
      // Best-effort log row. If the table doesn't exist yet (very early boot
      // before applySchema), swallow the error.
      try {
        db.prepare(
          "INSERT INTO ledger_divergence_log (json_bet_count, sqlite_bet_count, divergence, source, notes) VALUES (?, ?, ?, ?, ?)"
        ).run(
          jsonBetCount,
          sqliteBetCount,
          delta,
          source,
          sqliteBetCount === 0 ? "cold_mirror" : "partial_divergence"
        )
      } catch (_) {
        /* table missing or write failed — observability only, skip */
      }
      return { ok: false, jsonBetCount, sqliteBetCount, delta, source }
    }

    return { ok: true, jsonBetCount, sqliteBetCount, delta, source }
  } catch (err) {
    // Never block boot on integrity check failure.
    return { ok: null, error: err?.message || String(err), source }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getDb() — returns a live DatabaseSync, throws if unavailable
// ─────────────────────────────────────────────────────────────────────────────
function getDb() {
  if (_db) return _db

  const { DatabaseSync } = require("node:sqlite")
  _db = new DatabaseSync(DB_PATH)
  applySchema(_db)
  _ok = true

  // Session BA — Outcome Snapshot Completion. Boot-time post-condition check:
  // verify every critical table exists after applySchema completes. Logs a
  // single observable line so the operator can confirm the canonical DB path
  // and the inventory of intelligence tables in one glance. Any missing table
  // is logged as CRITICAL — does NOT throw (graceful) but ensures schema
  // regressions are immediately visible instead of silent.
  //
  // Session BB — Longitudinal Memory Completion Audit. If the boot check
  // observes the Session AZ tables (prediction_epochs / frozen_contextual_states)
  // missing AFTER applySchema, run the isolated migrateAZTables() self-heal
  // BEFORE re-verifying. This is defensive against module-cache staleness
  // (e.g. a long-lived process that loaded intelligenceSchema.js BEFORE the
  // AZ DDL was added, then "restarted" without a true Node process replacement)
  // and against any future regression in the larger DDL string.
  try {
    let { existing, missing } = _verifyCriticalTables(_db)
    const azTables = ["prediction_epochs", "frozen_contextual_states"]
    const azMissing = missing.filter(t => azTables.includes(t))
    let azRepair = null
    if (azMissing.length) {
      try {
        const { migrateAZTables } = require("./intelligenceSchema")
        azRepair = migrateAZTables(_db)
        console.warn("[DB-BOOT-REPAIR] AZ table self-heal:", azRepair)
        const reverify = _verifyCriticalTables(_db)
        existing = reverify.existing
        missing  = reverify.missing
      } catch (repairErr) {
        console.error("[DB-BOOT-REPAIR-FAILED]", repairErr?.message || repairErr)
      }
    }
    console.log("[DB-BOOT]", {
      canonicalPath:  DB_PATH,
      tablesPresent:  existing.length,
      criticalTables: CRITICAL_TABLES.reduce((acc, t) => {
        acc[t] = existing.includes(t) ? "✓" : "✗"
        return acc
      }, {}),
      azRepairApplied: azRepair && azRepair.created.length ? azRepair.created : null,
    })
    if (missing.length) {
      console.error("[DB-BOOT-CRITICAL] Missing critical tables after applySchema:", missing)
    }
  } catch (verifyErr) {
    console.warn("[DB-BOOT] verification skipped (non-fatal):", verifyErr.message)
  }

  return _db
}

// ─────────────────────────────────────────────────────────────────────────────
// tryGetDb() — safe wrapper; returns null if SQLite is unavailable
// Use this everywhere in production code so SQLite failure never breaks runtime.
// ─────────────────────────────────────────────────────────────────────────────
function tryGetDb() {
  if (_ok === false) return null
  try {
    return getDb()
  } catch (err) {
    _ok = false
    console.warn("[storage/db] SQLite unavailable:", err.message)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// closeDb() — clean shutdown (call from process exit handlers if needed)
// ─────────────────────────────────────────────────────────────────────────────
function closeDb() {
  if (_db) {
    try { _db.close() } catch (_) {}
    _db = null
    _ok = null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// dbPath() — returns the absolute path to the db file
// ─────────────────────────────────────────────────────────────────────────────
function dbPath() { return DB_PATH }

// ─────────────────────────────────────────────────────────────────────────────
// verifyCriticalTables() — public introspection (Session BA)
// Returns { existing, missing, ok } against an open DB. Does NOT open the DB.
// Used by probes + operator scripts for offline schema validation.
// ─────────────────────────────────────────────────────────────────────────────
function verifyCriticalTables(db) {
  const r = _verifyCriticalTables(db)
  return { ...r, ok: r.missing.length === 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// initializeAtBoot() — Session BC.
//
// EAGERLY opens the DB at server-boot time (before app.listen) so that
// applySchema + the [DB-BOOT] diagnostic + the AZ-table auto-repair fire
// IMMEDIATELY at startup — not lazily on the first DB-using request.
//
// The Session BC bug this fixes: getDb() was previously dead code at boot
// because nothing in server.js's module-load sequence called tryGetDb().
// Operators verifying the DB state right after a "restart" saw stale tables
// because the DB had not been opened yet by the new process.
//
// Safe to call multiple times (idempotent — getDb() returns the singleton).
// Wrapped in tryGetDb() semantics so SQLite-unavailable does NOT crash boot.
// Returns { ok, dbPath, criticalTablesOk } so server.js can log the result.
// ─────────────────────────────────────────────────────────────────────────────
function initializeAtBoot() {
  const db = tryGetDb()
  if (!db) {
    return { ok: false, dbPath: DB_PATH, criticalTablesOk: false, error: "sqlite-unavailable" }
  }
  // The [DB-BOOT] log already fired inside getDb() during the call above.
  // Re-verify so the caller can react to a missing-table state if it wants.
  try {
    const v = _verifyCriticalTables(db)
    // Phase Persistence-1B (2026-05-14): boot-time ledger integrity check.
    // Pure observability — never blocks boot, never auto-repairs.
    let ledgerIntegrity = null
    try {
      ledgerIntegrity = checkLedgerIntegrity(db, { source: "boot_check" })
    } catch (_) { /* defensive — should never reach here, checkLedgerIntegrity already swallows */ }
    return {
      ok: true,
      dbPath: DB_PATH,
      criticalTablesOk: v.missing.length === 0,
      missing: v.missing,
      ledgerIntegrity,
    }
  } catch (err) {
    return { ok: false, dbPath: DB_PATH, criticalTablesOk: false, error: err?.message || String(err) }
  }
}

module.exports = {
  getDb,
  tryGetDb,
  closeDb,
  dbPath,
  verifyCriticalTables,
  CRITICAL_TABLES,
  initializeAtBoot,
  checkLedgerIntegrity,   // Phase Persistence-1B (2026-05-14) — exported for probes + manual invocation
}
