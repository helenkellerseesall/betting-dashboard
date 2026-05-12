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
    return { ok: true, dbPath: DB_PATH, criticalTablesOk: v.missing.length === 0, missing: v.missing }
  } catch (err) {
    return { ok: false, dbPath: DB_PATH, criticalTablesOk: false, error: err?.message || String(err) }
  }
}

module.exports = { getDb, tryGetDb, closeDb, dbPath, verifyCriticalTables, CRITICAL_TABLES, initializeAtBoot }
