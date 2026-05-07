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
// getDb() — returns a live DatabaseSync, throws if unavailable
// ─────────────────────────────────────────────────────────────────────────────
function getDb() {
  if (_db) return _db

  const { DatabaseSync } = require("node:sqlite")
  _db = new DatabaseSync(DB_PATH)
  applySchema(_db)
  _ok = true
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

module.exports = { getDb, tryGetDb, closeDb, dbPath }
