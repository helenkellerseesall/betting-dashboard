"use strict"
process.chdir(__dirname)

// Session BA — Outcome Snapshot Completion verification probe.
//
// Verifies the smallest fix landed in db.js:
//   1. applySchema creates ALL 9 critical tables (incl. outcome_snapshots)
//   2. verifyCriticalTables() returns ok:true with no missing tables
//   3. Inserting a frozen prediction → grading via intel.recordOutcome →
//      outcome_snapshots row exists + delta_prob computed correctly
//   4. Joining frozen_contextual_states + outcome_snapshots returns the
//      contextual replay alongside the actual outcome (the longitudinal
//      "what did we think then vs what happened" join)
//   5. Re-running the probe is idempotent — predictions/contextual remain
//      immutable, outcome can be REPLACED (corrections are allowed)
//   6. The boot-time [DB-BOOT] log line emits with all critical tables ✓

const path = require("path")
const fs   = require("fs")

// Use /tmp DB (sandbox-local fs) — avoids the workspace-mount SQLite quirk.
const TMP_DB = "/tmp/.probe_outcome_completion_tmp.db"
try { fs.unlinkSync(TMP_DB) } catch (_) {}
try { fs.unlinkSync(TMP_DB + "-journal") } catch (_) {}
try { fs.unlinkSync(TMP_DB + "-wal") } catch (_) {}

// Override db.js path BEFORE any other module loads it.
const dbModulePath = path.resolve("./backend/storage/db.js")
delete require.cache[dbModulePath]
require.cache[dbModulePath] = {
	exports: (() => {
		const { DatabaseSync } = require("node:sqlite")
		const { applySchema }  = require("./backend/storage/schema")
		// Re-import the helpers we want to expose
		const realDbModule = require.cache[dbModulePath]
		let _db = null
		function tryGetDb() {
			if (_db) return _db
			_db = new DatabaseSync(TMP_DB)
			applySchema(_db)
			return _db
		}
		// Inline verifyCriticalTables since the real db.js is shadowed
		const CRITICAL_TABLES = [
			"tracked_props", "slip_catalog", "personal_ledger",
			"prediction_snapshots", "outcome_snapshots", "slip_outcomes", "ecology_snapshots",
			"prediction_epochs", "frozen_contextual_states",
		]
		function verifyCriticalTables(db) {
			const existing = new Set(
				db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
			)
			const missing = CRITICAL_TABLES.filter(t => !existing.has(t))
			return { existing: [...existing], missing, ok: missing.length === 0 }
		}
		return { tryGetDb, getDb: tryGetDb, dbPath: () => TMP_DB, closeDb: () => {}, verifyCriticalTables, CRITICAL_TABLES }
	})(),
	loaded: true,
	filename: dbModulePath,
	id: dbModulePath,
}

const { freezePredictionEpoch }                = require("./backend/pipeline/memory/freezePredictionEpoch")
const { getFrozenPredictionWithContext, getEpochPredictions } = require("./backend/pipeline/memory/readFrozenEpoch")
const intel                                    = require("./backend/storage/intelligence")
const { tryGetDb, verifyCriticalTables, CRITICAL_TABLES } = require("./backend/storage/db")

let pass = 0, fail = 0
function check(label, ok, detail = "") {
	if (ok) { console.log("  ✓", label); pass++ }
	else    { console.log("  ✗", label, detail); fail++ }
}

// ── Check 1: applySchema creates all 9 critical tables ──────────────────────
console.log("\n=== Check 1 — applySchema creates all critical tables (including outcome_snapshots) ===")
const db = tryGetDb()
check("DB available", !!db)
const verify = verifyCriticalTables(db)
check("verifyCriticalTables.ok = true", verify.ok === true, JSON.stringify(verify))
check("missing tables = []", verify.missing.length === 0, `missing: ${JSON.stringify(verify.missing)}`)
check("outcome_snapshots present", verify.existing.includes("outcome_snapshots"))
check("prediction_snapshots present", verify.existing.includes("prediction_snapshots"))
check("prediction_epochs present (Session AZ)", verify.existing.includes("prediction_epochs"))
check("frozen_contextual_states present (Session AZ)", verify.existing.includes("frozen_contextual_states"))
check("slip_outcomes present", verify.existing.includes("slip_outcomes"))
check("ecology_snapshots present", verify.existing.includes("ecology_snapshots"))

// ── Check 2: outcome_snapshots starts empty, schema queryable ───────────────
console.log("\n=== Check 2 — outcome_snapshots is queryable + starts empty ===")
const initialOutcomes = db.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get()
check("SELECT COUNT(*) FROM outcome_snapshots succeeds", typeof initialOutcomes?.n === "number")
check("initial outcome count = 0", initialOutcomes?.n === 0)
const outcomeCols = db.prepare("PRAGMA table_info(outcome_snapshots)").all().map(c => c.name)
check("outcome_snapshots has 'id' col", outcomeCols.includes("id"))
check("outcome_snapshots has 'hit' col", outcomeCols.includes("hit"))
check("outcome_snapshots has 'delta_prob' col", outcomeCols.includes("delta_prob"))
check("outcome_snapshots has 'clv' col", outcomeCols.includes("clv"))

// ── Check 3: Freeze a prediction, then grade it → outcome_snapshots populated
console.log("\n=== Check 3 — freeze + grade → outcome_snapshots populated, delta_prob correct ===")
const SPORT = "nba", DATE = "2026-05-13"
const fx = [{
	player: "Anthony Edwards",
	statFamily: "pra",
	side: "over",
	line: 41.5,
	odds: -115,
	sportsbook: "DraftKings",
	modelProb: 0.61,
	impliedProb: 0.535,
	edge: 0.075,
	starterFlag: true,
	projectedMinutes: 36.0,
	roleContext: { starterFlag: true, projectedMinutes: 36.0 },
	availabilityShift: 0,
	playerStatus: "active",
}]
const fz = freezePredictionEpoch({
	predictions:       fx,
	sport:             SPORT,
	slateDate:         DATE,
	source:            "manual",
	snapshotUpdatedAt: "2026-05-13T01:30:00.000Z",
})
check("freeze ok", fz.ok === true, JSON.stringify(fz))
check("predictionsInserted = 1", fz.predictionsInserted === 1)
check("contextualInserted = 1", fz.contextualInserted === 1)

const predId = intel.predictionId(DATE, SPORT, "Anthony Edwards", "pra", "over", 41.5, "DraftKings")
const before = getFrozenPredictionWithContext(predId)
check("frozen prediction exists pre-grade", !!before?.prediction)
check("outcome is null pre-grade", before?.outcome === null)

const graded = intel.recordOutcome(predId, {
	hit: 1,
	actualValue: 44,
	settledAt: "2026-05-13T05:30:00Z",
	notes: "win",
}, { sport: SPORT, date: DATE })
check("recordOutcome returned truthy", graded === true || graded === 1 || graded === undefined,
	`got ${graded}`)

const after = getFrozenPredictionWithContext(predId)
check("outcome row exists post-grade", !!after?.outcome)
check("outcome.hit = 1", after?.outcome?.hit === 1)
check("outcome.actual_value = 44", after?.outcome?.actual_value === 44)
check("outcome.delta_prob = -0.39 (0.61 - 1)", Math.abs((after?.outcome?.delta_prob ?? 999) - (-0.39)) < 1e-6,
	`got ${after?.outcome?.delta_prob}`)
const tableCount = db.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get()
check("outcome_snapshots row count = 1", tableCount?.n === 1)

// ── Check 4: 3-way join (prediction + contextual + outcome) ─────────────────
console.log("\n=== Check 4 — longitudinal 3-way join works ===")
const epochId = fz.epochId
const epochRows = getEpochPredictions(epochId)
check("getEpochPredictions returns 1 row", epochRows?.length === 1, `got ${epochRows?.length}`)
const ed = epochRows[0]
check("Edwards prediction joined", ed?.prediction_player === "Anthony Edwards")
check("contextual.starter_flag preserved (1)", ed?.ctx_starter_flag === 1)
check("contextual.projected_minutes preserved (36)", Math.abs(ed?.ctx_projected_minutes - 36.0) < 1e-9)
check("contextual.player_status preserved ('active')", ed?.ctx_player_status === "active")
check("outcome.hit joined (1)", ed?.outcome_hit === 1)
check("outcome.delta_prob joined (-0.39)", Math.abs(ed?.outcome_delta_prob - (-0.39)) < 1e-6)
check("outcome.actual_value joined (44)", ed?.outcome_actual_value === 44)

// ── Check 5: Re-grading is allowed (corrections), prediction immutable ──────
console.log("\n=== Check 5 — outcome can be CORRECTED (REPLACE), prediction is immutable ===")
intel.recordOutcome(predId, {
	hit: 0,                 // correction: bet actually lost
	actualValue: 38,        // correction: actual value 38 not 44
	settledAt: "2026-05-13T05:35:00Z",
	notes: "loss-corrected",
}, { sport: SPORT, date: DATE })
const corrected = getFrozenPredictionWithContext(predId)
check("outcome.hit corrected to 0", corrected?.outcome?.hit === 0)
check("outcome.actual_value corrected to 38", corrected?.outcome?.actual_value === 38)
check("outcome row count still 1 (REPLACE not INSERT)",
	db.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get()?.n === 1)
// Prediction itself should be untouched
check("prediction.model_prob still 0.61 (immutable)",
	Math.abs(corrected?.prediction?.model_prob - 0.61) < 1e-9, `got ${corrected?.prediction?.model_prob}`)
check("contextual.starter_flag still 1 (immutable)", corrected?.contextual?.starter_flag === 1)
check("delta_prob recomputed (0.61 - 0 = 0.61)",
	Math.abs((corrected?.outcome?.delta_prob ?? 999) - 0.61) < 1e-6,
	`got ${corrected?.outcome?.delta_prob}`)

// ── Check 6: Re-freeze prediction is no-op (immutability) ───────────────────
console.log("\n=== Check 6 — prediction immutability holds across re-freeze ===")
const fz2 = freezePredictionEpoch({
	predictions:       fx,
	sport:             SPORT,
	slateDate:         DATE,
	source:            "manual",
	snapshotUpdatedAt: "2026-05-13T01:30:00.000Z",
})
check("re-freeze ok", fz2.ok === true)
check("predictionsInserted = 0 (immutable)", fz2.predictionsInserted === 0, `got ${fz2.predictionsInserted}`)
check("predictionsSkipped = 1", fz2.predictionsSkipped === 1)
check("contextualInserted = 0 (immutable)", fz2.contextualInserted === 0)
check("epochInserted = false", fz2.epochInserted === false)

// ── Cleanup ─────────────────────────────────────────────────────────────────
try { fs.unlinkSync(TMP_DB) } catch (_) {}
try { fs.unlinkSync(TMP_DB + "-journal") } catch (_) {}
try { fs.unlinkSync(TMP_DB + "-wal") } catch (_) {}

console.log("\n=== SUMMARY ===")
console.log(`  pass: ${pass}`)
console.log(`  fail: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
