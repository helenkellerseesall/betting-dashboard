"use strict"
process.chdir(__dirname)

// Session BC — Eager Init verification probe.
//
// PROVES the bootstrap fix works end-to-end in a clean environment that
// mirrors what the operator's restart will produce:
//
//   1. require("./storage/db") then call initializeAtBoot()
//      — simulates server.js's eager-init line
//   2. Verify [SERVER-BOOT-DB-INIT] would print correct ok=true
//   3. Verify [DB-BOOT] line emits with all critical tables ✓
//   4. Verify AZ tables created (prediction_epochs + frozen_contextual_states)
//   5. Verify subsequent calls are idempotent (singleton pattern preserved)
//   6. Verify the live functional path (freeze + grade) works against the DB
//
// Uses /tmp DB to mirror operator-environment SQLite write semantics
// (the workspace mount in this sandbox blocks SQLite -journal/-wal files).

const path = require("path")
const fs   = require("fs")
const { DatabaseSync } = require("node:sqlite")

const TMP_DB = "/tmp/.probe_eager_init_tmp.db"
function clean() {
	for (const ext of ["", "-journal", "-wal", "-shm"]) {
		try { fs.unlinkSync(TMP_DB + ext) } catch (_) {}
	}
}
clean()

let pass = 0, fail = 0
function check(label, ok, detail = "") {
	if (ok) { console.log("  ✓", label); pass++ }
	else    { console.log("  ✗", label, detail); fail++ }
}

// Pre-create the DB to mirror the operator's exact pre-restart state:
// pre-AZ intelligence tables present, AZ tables MISSING.
{
	const { applyIntelligenceSchema } = require("./backend/storage/intelligenceSchema")
	const setupDb = new DatabaseSync(TMP_DB)
	applyIntelligenceSchema(setupDb)
	setupDb.exec("DROP TABLE IF EXISTS prediction_epochs")
	setupDb.exec("DROP TABLE IF EXISTS frozen_contextual_states")
	// Also pre-populate prediction_snapshots so we can verify data preservation
	setupDb.prepare(`INSERT INTO prediction_snapshots (id, run_date, sport, player, stat_family, side, line, odds, model_prob, edge, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.run("preexist|nba|test|points|over|20|fanduel", "2026-05-12", "nba", "Pre-existing", "points", "over", 20, -110, 0.55, 0.05, "{}")
	setupDb.close()
}

// Now monkey-patch db.js to use /tmp/test_eager.db, simulating what server.js
// will do at boot in the operator's environment.
const dbModulePath = path.resolve("./backend/storage/db.js")
delete require.cache[dbModulePath]
const realCode = fs.readFileSync(dbModulePath, "utf8")
const Module = require("module")
const m = new Module(dbModulePath)
m.filename = dbModulePath
m.paths = Module._nodeModulePaths(path.dirname(dbModulePath))
m._compile(realCode.replace(
	`const DB_PATH = path.join(__dirname, "betting.db")`,
	`const DB_PATH = ${JSON.stringify(TMP_DB)}`,
), dbModulePath)
require.cache[dbModulePath] = { exports: m.exports, loaded: true, filename: dbModulePath, id: dbModulePath }

// ── 1. Capture server.js eager-init behavior ─────────────────────────────────
console.log("\n=== Check 1 — server.js eager-init via initializeAtBoot() ===")
const captured = []
const origLog  = console.log
const origWarn = console.warn
console.log  = (...args) => { captured.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); origLog.apply(console, args) }
console.warn = (...args) => { captured.push("WARN " + args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); origWarn.apply(console, args) }
let initResult
try {
	const dbMod = require("./backend/storage/db")
	check("initializeAtBoot is exported", typeof dbMod.initializeAtBoot === "function")
	initResult = dbMod.initializeAtBoot()
} finally {
	console.log  = origLog
	console.warn = origWarn
}
check("initializeAtBoot returned ok=true", initResult?.ok === true, JSON.stringify(initResult))
check("initializeAtBoot reports criticalTablesOk=true", initResult?.criticalTablesOk === true,
	JSON.stringify(initResult))
check("initializeAtBoot.dbPath = our TMP_DB", initResult?.dbPath === TMP_DB)
check("[DB-BOOT] log line emitted", captured.some(l => l.includes("[DB-BOOT]")),
	captured.find(l => l.includes("DB-BOOT"))?.slice(0, 100) || "no DB-BOOT line")

// ── 2. AZ tables NOW present in the DB ───────────────────────────────────────
console.log("\n=== Check 2 — AZ tables created by eager-init ===")
const liveDb = require("./backend/storage/db").getDb()
const t = new Set(liveDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name))
check("prediction_snapshots present (was pre-existing)", t.has("prediction_snapshots"))
check("outcome_snapshots present", t.has("outcome_snapshots"))
check("prediction_epochs CREATED by eager-init", t.has("prediction_epochs"))
check("frozen_contextual_states CREATED by eager-init", t.has("frozen_contextual_states"))
const psCount = liveDb.prepare("SELECT COUNT(*) AS c FROM prediction_snapshots").get().c
check("prediction_snapshots data PRESERVED (1 pre-existing row)", psCount === 1, `got ${psCount}`)

// ── 3. Idempotent — second initializeAtBoot is a no-op ───────────────────────
console.log("\n=== Check 3 — initializeAtBoot is idempotent ===")
const dbMod = require("./backend/storage/db")
const r2 = dbMod.initializeAtBoot()
check("second call ok=true", r2?.ok === true)
check("second call criticalTablesOk=true", r2?.criticalTablesOk === true)
const liveDb2 = dbMod.getDb()
check("getDb returns same singleton", liveDb2 === liveDb)

// ── 4. Live functional path — freeze + grade against eager-init DB ──────────
console.log("\n=== Check 4 — functional end-to-end against eager-init DB ===")
// Force re-require of memory + intelligence modules so they pick up the patched db.js
for (const p of [
	path.resolve("./backend/storage/intelligence.js"),
	path.resolve("./backend/pipeline/memory/freezePredictionEpoch.js"),
	path.resolve("./backend/pipeline/memory/readFrozenEpoch.js"),
]) { delete require.cache[p] }
const { freezePredictionEpoch } = require("./backend/pipeline/memory/freezePredictionEpoch")
const intel                     = require("./backend/storage/intelligence")
const { getFrozenPredictionWithContext } = require("./backend/pipeline/memory/readFrozenEpoch")

const SPORT = "nba", DATE = "2026-05-13"
const fz = freezePredictionEpoch({
	predictions: [{
		player: "BC Test Player", statFamily: "threes", side: "over", line: 3.5,
		odds: -120, sportsbook: "DraftKings",
		modelProb: 0.59, edge: 0.063,
		starterFlag: true, projectedMinutes: 30, marketShift: -0.003,
		playerStatus: "active", availabilityShift: 0,
	}],
	sport: SPORT, slateDate: DATE, source: "manual",
	snapshotUpdatedAt: "2026-05-13T02:00:00Z",
})
check("freeze ok", fz.ok === true)
check("epoch row written", fz.epochInserted === true)
check("prediction row written", fz.predictionsInserted === 1)
check("contextual row written", fz.contextualInserted === 1)

const predId = intel.predictionId(DATE, SPORT, "BC Test Player", "threes", "over", 3.5, "DraftKings")
intel.recordOutcome(predId, { hit: 1, actualValue: 5, settledAt: "2026-05-13T05:00:00Z" }, { sport: SPORT, date: DATE })
const replay = getFrozenPredictionWithContext(predId)
check("3-way join works: prediction present", !!replay?.prediction)
check("3-way join: contextual present", !!replay?.contextual)
check("3-way join: outcome present (hit=1)", replay?.outcome?.hit === 1)
check("contextual.starter_flag preserved (1)", replay?.contextual?.starter_flag === 1)
check("contextual.market_shift preserved (-0.003)", Math.abs(replay?.contextual?.market_shift - (-0.003)) < 1e-9)

// Cleanup
try { dbMod.closeDb() } catch (_) {}
clean()

console.log("\n=== SUMMARY ===")
console.log(`  pass: ${pass}`)
console.log(`  fail: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
