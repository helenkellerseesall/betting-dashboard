"use strict"

/**
 * Historical-Truth Hardening — MLB freeze immutability verification.
 *
 * Verifies two layers:
 *   1. PURE-SQL semantics on an isolated in-memory DB:
 *      - INSERT OR IGNORE preserves the first row
 *      - INSERT OR REPLACE overwrites
 *      - composite PK (prediction_id, epoch_id) routes correctly
 *
 *   2. END-TO-END behavior of freezeMlbContextualEpoch +
 *      freezeMlbLiveStateEpoch against the production DB using SENTINEL
 *      prediction_ids (prefixed `IMM_TEST_`) and a slate_date sentinel
 *      (`9999-01-01`). The fixture inserts, asserts, then cleans up so
 *      production data is never affected.
 *
 *   node backend/scripts/verifyMlbImmutabilityHardening.js
 *
 * Exit 0 = PASS, 1 = FAIL. Safe to run on a live runtime.
 */

const path = require("path")
const { DatabaseSync } = require("node:sqlite")
const { applyIntelligenceSchema } = require("../storage/intelligenceSchema")

function assert(cond, msg, ctx) {
	if (!cond) {
		console.log("FAIL —", msg)
		if (ctx !== undefined) console.log("  ctx:", JSON.stringify(ctx, null, 2))
		process.exitCode = 1
		return false
	}
	console.log("  OK —", msg)
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — pure SQL semantics (in-memory DB; production-safe)
// ─────────────────────────────────────────────────────────────────────────────

function part1_pureSemantics() {
	console.log("\n=== PART 1 — pure SQL semantics (in-memory) ===\n")
	const db = new DatabaseSync(":memory:")
	applyIntelligenceSchema(db)

	const insertEpoch = db.prepare(`
		INSERT OR IGNORE INTO prediction_epochs
			(epoch_id, snapshot_updated_at, slate_date, sport, source, prediction_count, contextual_count, slip_count, notes)
		VALUES (?, ?, ?, 'mlb', ?, ?, ?, 0, ?)
	`)
	const insertIgnore = db.prepare(`
		INSERT OR IGNORE INTO frozen_contextual_states
			(prediction_id, epoch_id, raw_context_json)
		VALUES (?, ?, ?)
	`)
	const insertReplace = db.prepare(`
		INSERT OR REPLACE INTO frozen_contextual_states
			(prediction_id, epoch_id, raw_context_json)
		VALUES (?, ?, ?)
	`)
	const selectOne = db.prepare(`
		SELECT raw_context_json FROM frozen_contextual_states
		WHERE prediction_id = ? AND epoch_id = ?
	`)

	const epochId = "TEST_EPOCH_001"
	insertEpoch.run(epochId, "2026-05-12T00:00:00Z", "2026-05-12", "test", 0, 0, "fixture")

	console.log("\n--- INSERT OR IGNORE preserves first write ---")
	const r1 = insertIgnore.run("pred-1", epochId, JSON.stringify({ first: true }))
	assert(r1.changes === 1, "first insert changes=1")
	const r2 = insertIgnore.run("pred-1", epochId, JSON.stringify({ second: true }))
	assert(r2.changes === 0, "second insert (same PK) changes=0 — IGNORED")
	const after = selectOne.get("pred-1", epochId)
	assert(after?.raw_context_json === JSON.stringify({ first: true }),
		"raw_context_json still reflects FIRST write — historical truth preserved",
		{ stored: after?.raw_context_json })

	console.log("\n--- INSERT OR REPLACE overwrites (admin bypass mode) ---")
	const r3 = insertReplace.run("pred-1", epochId, JSON.stringify({ admin_overwrite: true }))
	assert(r3.changes === 1, "REPLACE returns changes=1 (overwrite happened)")
	const after2 = selectOne.get("pred-1", epochId)
	assert(after2?.raw_context_json === JSON.stringify({ admin_overwrite: true }),
		"REPLACE successfully overwrote the row",
		{ stored: after2?.raw_context_json })

	console.log("\n--- composite PK isolates different epochs ---")
	const altEpoch = "TEST_EPOCH_002"
	insertEpoch.run(altEpoch, "2026-05-12T00:05:00Z", "2026-05-12", "test", 0, 0, "fixture")
	const r4 = insertIgnore.run("pred-1", altEpoch, JSON.stringify({ altEpoch: true }))
	assert(r4.changes === 1, "same prediction_id, DIFFERENT epoch_id → new row inserted")
	const original = selectOne.get("pred-1", epochId)
	const alt = selectOne.get("pred-1", altEpoch)
	assert(original?.raw_context_json !== alt?.raw_context_json,
		"two epochs preserve independent contextual snapshots",
		{ original: original?.raw_context_json, alt: alt?.raw_context_json })

	db.close()
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — end-to-end against the production DB with sentinel IDs
// ─────────────────────────────────────────────────────────────────────────────

function part2_endToEndAgainstProductionDb() {
	console.log("\n=== PART 2 — end-to-end with isolated in-memory DB ===\n")
	// Build an isolated in-memory DB and inject it via require-cache override
	// of the storage/db module BEFORE requiring the freeze writers. This means
	// we exercise the REAL freeze writer code paths without touching production.
	const memDb = new DatabaseSync(":memory:")
	applyIntelligenceSchema(memDb)

	const dbModulePath = require.resolve("../storage/db")
	const realDbModule = require.cache[dbModulePath]
	// Replace tryGetDb with one returning our in-memory DB.
	require.cache[dbModulePath] = {
		id: dbModulePath,
		filename: dbModulePath,
		loaded: true,
		exports: {
			tryGetDb: () => memDb,
			getDb: () => memDb,
		},
		children: [],
		paths: [],
	}

	// Invalidate the freeze writer cache so they re-require the mocked db module.
	const ctxModulePath  = require.resolve("../pipeline/mlb/context/freezeMlbContextualEpoch")
	const liveModulePath = require.resolve("../pipeline/mlb/live/freezeMlbLiveStateEpoch")
	delete require.cache[ctxModulePath]
	delete require.cache[liveModulePath]

	const { freezeMlbContextualEpoch } = require("../pipeline/mlb/context/freezeMlbContextualEpoch")
	const { freezeMlbLiveStateEpoch }   = require("../pipeline/mlb/live/freezeMlbLiveStateEpoch")

	// `db` is the in-memory DB used by both freezers via the stubbed require.
	const db = memDb
	// Restore the real db module on the way out so other tests see the truth.
	const restoreDbModule = () => {
		if (realDbModule) require.cache[dbModulePath] = realDbModule
		else delete require.cache[dbModulePath]
	}

	// Sentinel slate_date keeps test rows segregated from real data.
	const SENTINEL_SLATE = "9999-01-01"
	const SENTINEL_PREFIX = "IMM_TEST_" + Date.now() + "_"

	// In-memory DB is fresh per run — no cleanup needed up front.
	function cleanup() {
		try {
			db.prepare(`DELETE FROM frozen_contextual_states WHERE prediction_id LIKE 'IMM_TEST_%'`).run()
			db.prepare(`DELETE FROM prediction_epochs WHERE slate_date = ?`).run(SENTINEL_SLATE)
		} catch (_) {}
	}

	const makePredictions = (n, withSignal = true) => {
		const out = []
		for (let i = 0; i < n; i++) {
			const row = {
				id: SENTINEL_PREFIX + i,
				predictedProbability: 0.5 + i * 0.001,
				edgeProbability: 0.01,
				consensusImpliedProbability: 0.5,
				bookImpliedDispersion: 0.02,
			}
			if (withSignal) {
				// Provide a contextual layer so _hasContextualSignal=true.
				row.weatherContext = { temperatureF: 70 + i, source: "fixture" }
				row.mlbContextualSignal = { family: "test" }
				row.mlbContextualShift = 0.01
			}
			out.push(row)
		}
		return out
	}

	const epochSnapshotIso = "2099-12-31T23:59:59Z"  // unique sentinel for epoch_id

	try {
		console.log("\n--- contextual freezer: first write inserts all rows ---")
		const r1 = freezeMlbContextualEpoch({
			predictions: makePredictions(5),
			slateDate: SENTINEL_SLATE,
			snapshotUpdatedAt: epochSnapshotIso,
			source: "fixture",
			notes: "IMM_TEST first",
		})
		console.log("  [debug] r1:", JSON.stringify(r1))
		assert(r1.ok === true, "first write ok=true", { r1 })
		assert(r1.historicalWriteMode === "insert_or_ignore", "mode=insert_or_ignore")
		assert(r1.contextualInserted === 5, "5 rows inserted", { inserted: r1.contextualInserted })
		assert(r1.duplicateHistoricalWrite === 0, "0 collisions on first write")
		assert(r1.immutableWriteRejected === 0, "immutableWriteRejected=0 (alias) on first write")
		assert(r1.overwriteAttemptDetected === false, "no overwrite attempted")

		console.log("\n--- contextual freezer: second IDENTICAL write is fully IGNOREd ---")
		const r2 = freezeMlbContextualEpoch({
			predictions: makePredictions(5),
			slateDate: SENTINEL_SLATE,
			snapshotUpdatedAt: epochSnapshotIso,
			source: "fixture",
			notes: "IMM_TEST second",
		})
		assert(r2.ok === true, "second write ok=true")
		assert(r2.contextualInserted === 0, "0 NEW rows inserted second time", { inserted: r2.contextualInserted })
		assert(r2.duplicateHistoricalWrite === 5, "5 collisions counted (one per row)", { collisions: r2.duplicateHistoricalWrite })
		assert(r2.immutableWriteRejected === 5, "immutableWriteRejected mirrors duplicateHistoricalWrite")

		console.log("\n--- contextual freezer: historical state PRESERVED (first-write data intact) ---")
		// Pull back the rows and verify the stored raw_context_json reflects the
		// FIRST write's data, not any mutation from the second call.
		const stmt = db.prepare(`
			SELECT prediction_id, raw_context_json
			FROM frozen_contextual_states
			WHERE prediction_id LIKE 'IMM_TEST_%'
			ORDER BY prediction_id
		`)
		const stored = stmt.all()
		assert(stored.length === 5, "5 rows present in DB")
		// First write set temperatureF = 70 + i (70..74); second call would have
		// passed identical data so we can't differentiate THAT way, but the
		// important guarantee is structural: only ONE row per (pred_id, epoch_id).
		// Inserting different data on the second call must NOT change stored rows.
		console.log("\n--- contextual freezer: re-write with DIFFERENT data is still IGNOREd ---")
		const mutatedPredictions = makePredictions(5).map((p) => ({
			...p,
			predictedProbability: 0.999,  // mutated
			weatherContext: { temperatureF: 999, source: "mutated_fixture" },
		}))
		const r3 = freezeMlbContextualEpoch({
			predictions: mutatedPredictions,
			slateDate: SENTINEL_SLATE,
			snapshotUpdatedAt: epochSnapshotIso,
			source: "fixture",
			notes: "IMM_TEST mutation_attempt",
		})
		assert(r3.contextualInserted === 0, "0 new rows from mutation attempt")
		assert(r3.duplicateHistoricalWrite === 5, "5 collisions on mutation attempt")
		// Verify stored data did not change.
		const storedAfter = stmt.all()
		const beforeJsons = stored.map((r) => r.raw_context_json).join("|")
		const afterJsons  = storedAfter.map((r) => r.raw_context_json).join("|")
		assert(beforeJsons === afterJsons, "stored raw_context_json unchanged after mutation attempt — IMMUTABILITY HOLDS")

		console.log("\n--- contextual freezer: admin bypass DOES overwrite, with explicit log ---")
		const r4 = freezeMlbContextualEpoch({
			predictions: mutatedPredictions,
			slateDate: SENTINEL_SLATE,
			snapshotUpdatedAt: epochSnapshotIso,
			source: "fixture",
			notes: "IMM_TEST admin_bypass",
			allowOverwrite: true,
			overwriteReason: "fixture_test_admin_bypass",
		})
		assert(r4.historicalWriteMode === "insert_or_replace_admin_bypass", "mode flipped to admin bypass")
		assert(r4.overwriteAttemptDetected === true, "overwriteAttemptDetected=true")
		assert(r4.contextualInserted === 5, "5 rows updated (REPLACE counts as insert)")
		// Verify stored data NOW reflects the mutation.
		const storedAfterAdmin = stmt.all()
		const someChanged = storedAfterAdmin.some((r) => /mutated_fixture/.test(r.raw_context_json || ""))
		assert(someChanged, "stored data NOW reflects admin-bypass mutation")

		console.log("\n--- live-state freezer: same immutability semantics ---")
		// Build the live envelope shape expected by freezeMlbLiveStateEpoch
		const liveRows = makePredictions(3).map((p) => ({
			...p,
			id: "IMM_TEST_LIVE_" + Date.now() + "_" + p.id,
			mlbLiveState: {
				capturedAt: epochSnapshotIso,
				lineup: { confirmedForRow: true },
				starter: null, lineMovement: null, bullpenLive: null, weatherDelta: null,
				tags: ["LINEUP_CONFIRMED"],
				hasAnyLive: true,
			},
		}))
		// First live write
		const rl1 = freezeMlbLiveStateEpoch({
			liveRows,
			slateDate: SENTINEL_SLATE,
			snapshotUpdatedAt: epochSnapshotIso,
			capturedAtIso: epochSnapshotIso,
			source: "fixture_live",
			notes: "IMM_TEST live",
		})
		assert(rl1.ok === true, "live first write ok=true")
		assert(rl1.contextualInserted === 3, "3 live rows inserted", { v: rl1.contextualInserted })
		assert(rl1.duplicateHistoricalWrite === 0, "0 collisions first live write")
		assert(rl1.historicalWriteMode === "insert_or_ignore", "live default mode = insert_or_ignore")
		// Second identical live write — must be 0 inserts, 3 collisions
		const rl2 = freezeMlbLiveStateEpoch({
			liveRows,
			slateDate: SENTINEL_SLATE,
			snapshotUpdatedAt: epochSnapshotIso,
			capturedAtIso: epochSnapshotIso,
			source: "fixture_live",
			notes: "IMM_TEST live second",
		})
		assert(rl2.contextualInserted === 0, "live second write: 0 inserts")
		assert(rl2.duplicateHistoricalWrite === 3, "live second write: 3 collisions")
	} finally {
		cleanup()
		restoreDbModule()
		try { memDb.close() } catch (_) {}
	}
}

function run() {
	try {
		part1_pureSemantics()
		part2_endToEndAgainstProductionDb()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
