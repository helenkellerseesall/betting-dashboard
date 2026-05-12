#!/usr/bin/env node
"use strict"

/**
 * Session BB — One-shot migration: ensure Session AZ longitudinal memory
 * tables exist in the canonical betting.db.
 *
 * Idempotent. Safe to run any number of times. Does NOT modify existing
 * tables, does NOT drop or alter anything, does NOT touch contextual or
 * grading code.
 *
 * Use cases:
 *   - First-time repair after the operator observes prediction_epochs /
 *     frozen_contextual_states missing despite applySchema appearing to
 *     have run (long-lived process, module-cache staleness)
 *   - Belt-and-suspenders rerun after a server restart
 *   - Verification: prints before / after table presence
 *
 * Usage:
 *   node backend/scripts/migrateLongitudinalMemory.js
 *
 * Exit codes:
 *   0  all 4 longitudinal tables present after migration
 *   1  migration failed or table still missing
 */

const path = require("path")
const { DatabaseSync } = require("node:sqlite")
const { migrateAZTables } = require("../storage/intelligenceSchema")

const DB_PATH = path.resolve(__dirname, "..", "storage", "betting.db")

console.log("[migrate-longitudinal-memory] canonical DB:", DB_PATH)

let db
try {
	db = new DatabaseSync(DB_PATH)
} catch (e) {
	console.error("[migrate-longitudinal-memory] cannot open DB:", e.message)
	process.exit(1)
}

const REQUIRED = [
	"prediction_snapshots",       // Session AZ-pre (intel.snapshotPredictions)
	"outcome_snapshots",          // Session AZ-pre (intel.recordOutcome)
	"prediction_epochs",          // Session AZ
	"frozen_contextual_states",   // Session AZ
]

function listTables() {
	return new Set(
		db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
	)
}

const before = listTables()
console.log("\n=== BEFORE ===")
REQUIRED.forEach(t => console.log("  " + t.padEnd(28) + ":", before.has(t) ? "✓ present" : "✗ MISSING"))

console.log("\n=== applying migrateAZTables() ===")
const result = migrateAZTables(db)
console.log("  result:", JSON.stringify(result))

const after = listTables()
console.log("\n=== AFTER ===")
let allOk = true
REQUIRED.forEach(t => {
	const ok = after.has(t)
	console.log("  " + t.padEnd(28) + ":", ok ? "✓ present" : "✗ STILL MISSING")
	if (!ok) allOk = false
})

console.log("\n=== ROW COUNTS ===")
for (const t of REQUIRED) {
	if (after.has(t)) {
		try {
			const n = db.prepare("SELECT COUNT(*) AS n FROM " + t).get()
			console.log("  " + t.padEnd(28) + ":", n.n)
		} catch (e) {
			console.log("  " + t.padEnd(28) + ": ERR", e.message)
		}
	}
}

try { db.close() } catch (_) {}

if (allOk) {
	console.log("\n[migrate-longitudinal-memory] ✓ all required tables present")
	process.exit(0)
} else {
	console.error("\n[migrate-longitudinal-memory] ✗ migration incomplete")
	process.exit(1)
}
