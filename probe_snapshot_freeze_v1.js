"use strict"
process.chdir(__dirname)

// Session BD — Snapshot-bestProps Freeze verification probe.
//
// Proves the freeze pipeline now fires from the bestProps generation path
// (not just /api/ws/state cache miss).
//
// Six checks:
//   1. Loading nbaIsolatedRoutes successfully (lazy-require pattern works)
//   2. Calling handleNbaRefreshSnapshotAfterMlbBranch in REPLAY mode (no
//      live API call) freezes the bestProps from disk snapshot
//   3. After freeze: prediction_epochs has +1 row keyed on snap.updatedAt
//   4. prediction_snapshots has +N rows (one per bestProp)
//   5. frozen_contextual_states has +N rows; contextual columns NULL
//      (honest sparsity), final_model_prob + final_edge populated
//   6. Re-invoking with same snap.updatedAt is idempotent (no duplicate rows)

const path = require("path")
const fs   = require("fs")
const { DatabaseSync } = require("node:sqlite")

const TMP_DB        = "/tmp/.probe_snapshot_freeze_tmp.db"
const TMP_SNAPSHOT  = "/tmp/.probe_snapshot_freeze_snap.json"
function clean() {
	for (const ext of ["", "-journal", "-wal", "-shm"]) {
		try { fs.unlinkSync(TMP_DB + ext) } catch (_) {}
	}
	try { fs.unlinkSync(TMP_SNAPSHOT) } catch (_) {}
}
clean()

let pass = 0, fail = 0
function check(label, ok, detail = "") {
	if (ok) { console.log("  ✓", label); pass++ }
	else    { console.log("  ✗", label, detail); fail++ }
}

// Override db.js path BEFORE any other module loads
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

const { initializeAtBoot, tryGetDb } = require("./backend/storage/db")
initializeAtBoot()
const db = tryGetDb()

// Build a fixture snapshot that mirrors the user's actual snapshot shape
// (MIN @ SAS, ~26 bestProps). Contains bestProps as produced by buildNbaBestProps.
const FIXTURE_SNAP = {
	updatedAt: "2026-05-13T01:30:00.000Z",
	snapshotGeneratedAt: "2026-05-13T01:30:00.000Z",
	events: [
		{ id: "evt_min_sas", commence_time: "2026-05-13T23:00:00Z",
		  away_team: "Minnesota Timberwolves", home_team: "San Antonio Spurs", awayTeam: "Minnesota Timberwolves", homeTeam: "San Antonio Spurs",
		  matchup: "Minnesota Timberwolves @ San Antonio Spurs" },
	],
	rawProps: [],
	props: [],
	bestProps: [
		{ player: "Anthony Edwards",       statFamily: "points",   side: "over",  line: 28.5, odds: -110, sportsbook: "DraftKings",
		  modelProb: 0.61, edge: 0.067, impliedProb: 0.524, volatility: "balanced",   tier: "PLAYABLE", snapshotSourced: true,
		  matchup: "Minnesota Timberwolves @ San Antonio Spurs" },
		{ player: "Anthony Edwards",       statFamily: "threes",   side: "over",  line: 3.5,  odds: +105, sportsbook: "FanDuel",
		  modelProb: 0.56, edge: 0.072, impliedProb: 0.488, volatility: "aggressive", tier: "PLAYABLE", snapshotSourced: true,
		  matchup: "Minnesota Timberwolves @ San Antonio Spurs" },
		{ player: "Victor Wembanyama",     statFamily: "rebounds", side: "over",  line: 12.5, odds: -115, sportsbook: "DraftKings",
		  modelProb: 0.63, edge: 0.095, impliedProb: 0.535, volatility: "balanced",   tier: "STRONG",   snapshotSourced: true,
		  matchup: "Minnesota Timberwolves @ San Antonio Spurs" },
		{ player: "Karl-Anthony Towns",    statFamily: "pra",      side: "over",  line: 32.5, odds: -120, sportsbook: "DraftKings",
		  modelProb: 0.59, edge: 0.045, impliedProb: 0.545, volatility: "lotto",      tier: "PLAYABLE", snapshotSourced: true,
		  matchup: "Minnesota Timberwolves @ San Antonio Spurs" },
		{ player: "Devin Vassell",         statFamily: "points",   side: "under", line: 17.5, odds: -110, sportsbook: "FanDuel",
		  modelProb: 0.57, edge: 0.046, impliedProb: 0.524, volatility: "balanced",   tier: "PLAYABLE", snapshotSourced: true,
		  matchup: "Minnesota Timberwolves @ San Antonio Spurs" },
	],
	flexProps: [], strongProps: [], eliteProps: [], playableProps: [],
}

// Save fixture as a snapshot.json the replay path can load
fs.writeFileSync(TMP_SNAPSHOT, JSON.stringify({ data: FIXTURE_SNAP, savedAt: Date.now() }))

// ── Check 1 — module loads cleanly ───────────────────────────────────────────
console.log("\n=== Check 1 — nbaIsolatedRoutes loads with freeze hook ===")
let nbaRoutes
try {
	nbaRoutes = require("./backend/http/nbaIsolatedRoutes")
	check("nbaIsolatedRoutes module loaded", true)
	check("handleNbaRefreshSnapshotAfterMlbBranch exported", typeof nbaRoutes.handleNbaRefreshSnapshotAfterMlbBranch === "function")
} catch (e) {
	check("nbaIsolatedRoutes module loaded", false, e.message)
	process.exit(1)
}

// ── Check 2 — invoking the handler in replay mode triggers freeze ────────────
console.log("\n=== Check 2 — replay-mode invocation triggers [NBA-SNAPSHOT-FREEZE-REPLAY] ===")
const captured = []
const origLog  = console.log
const origWarn = console.warn
console.log  = (...args) => { captured.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); origLog.apply(console, args) }
console.warn = (...args) => { captured.push("WARN " + args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); origWarn.apply(console, args) }

let liveSnap = null
const fakeReq = { query: { replay: "1" } }
const fakeRes = {
	statusCode: 0, body: null,
	status(c) { this.statusCode = c; return this },
	json(b)   { this.body = b; return this },
}
const deps = {
	ODDS_API_KEY: "test-key-not-actually-called",
	backendRoot:  path.dirname(TMP_SNAPSHOT),
	replaceOddsSnapshot(snap) { liveSnap = snap },
}

// Override the snapshot path so the replay loads our fixture
const fnsModulePath = path.resolve("./backend/pipeline/nba/fetchNbaOddsSnapshot.js")
const fnsExports = require(fnsModulePath)
const realLoad = fnsExports.loadNbaSnapshotFromDisk

;(async () => {
	// Run the handler against our TMP snapshot directory
	const altRoot = path.dirname(TMP_SNAPSHOT)
	const realSnapJson = path.join(altRoot, "snapshot.json")
	try { fs.copyFileSync(TMP_SNAPSHOT, realSnapJson) } catch (_) {}

	await nbaRoutes.handleNbaRefreshSnapshotAfterMlbBranch(fakeReq, fakeRes, {
		...deps,
		backendRoot: altRoot,
	})

	console.log = origLog
	console.warn = origWarn

	check("handler returned 200", fakeRes.statusCode === 200, `status=${fakeRes.statusCode}`)
	check("replay flag in response", fakeRes.body?.replay === true)
	check("replaceOddsSnapshot called", liveSnap !== null)
	const freezeLine = captured.find(l => l.includes("[NBA-SNAPSHOT-FREEZE-REPLAY]"))
	check("[NBA-SNAPSHOT-FREEZE-REPLAY] log line emitted", !!freezeLine,
		freezeLine ? freezeLine.slice(0, 100) : "no freeze line")

	// ── Check 3 — prediction_epochs row appeared ─────────────────────────────
	console.log("\n=== Check 3 — prediction_epochs row appeared ===")
	const epochs = db.prepare("SELECT * FROM prediction_epochs WHERE sport='nba' AND slate_date='2026-05-12'").all()
	check("epoch count = 1", epochs.length === 1, `got ${epochs.length}`)
	const epoch = epochs[0]
	check("epoch.snapshot_updated_at matches fixture", epoch?.snapshot_updated_at === FIXTURE_SNAP.updatedAt)
	check("epoch.source = 'snapshot_bestprops_replay'", epoch?.source === "snapshot_bestprops_replay")
	check("epoch.prediction_count = 5", epoch?.prediction_count === 5, `got ${epoch?.prediction_count}`)
	check("epoch.contextual_count = 0 (no contextual layers fired)", epoch?.contextual_count === 0)

	// ── Check 4 — prediction_snapshots populated ────────────────────────────
	console.log("\n=== Check 4 — prediction_snapshots populated ===")
	const ps = db.prepare("SELECT * FROM prediction_snapshots WHERE sport='nba' AND run_date='2026-05-12'").all()
	check("prediction_snapshots row count = 5", ps.length === 5, `got ${ps.length}`)
	const edwardsPoints = ps.find(r => r.player === "Anthony Edwards" && r.stat_family === "points")
	check("Edwards points row exists", !!edwardsPoints)
	check("Edwards points model_prob = 0.61", Math.abs(edwardsPoints?.model_prob - 0.61) < 1e-9)
	check("Edwards points edge = 0.067", Math.abs(edwardsPoints?.edge - 0.067) < 1e-9)
	check("Edwards points sportsbook preserved", edwardsPoints?.sportsbook === "DraftKings")

	// ── Check 5 — frozen_contextual_states populated, contextual NULL ───────
	console.log("\n=== Check 5 — frozen_contextual_states (honest sparsity) ===")
	const fcs = db.prepare("SELECT * FROM frozen_contextual_states WHERE epoch_id = ?").all(epoch.epoch_id)
	check("contextual row count = 5", fcs.length === 5, `got ${fcs.length}`)
	const edFcs = fcs.find(r => {
		const ps = db.prepare("SELECT * FROM prediction_snapshots WHERE id = ?").get(r.prediction_id)
		return ps?.player === "Anthony Edwards" && ps?.stat_family === "points"
	})
	check("Edwards contextual row exists", !!edFcs)
	check("matchup_shift = NULL (no enrichment)", edFcs?.matchup_shift == null)
	check("recent_form_z = NULL (no enrichment)", edFcs?.recent_form_z == null)
	check("starter_flag = NULL (no enrichment)", edFcs?.starter_flag == null)
	check("teammate_redist_shift = NULL (no enrichment)", edFcs?.teammate_redist_shift == null)
	check("market_shift = NULL (no enrichment)", edFcs?.market_shift == null)
	check("availability_shift = NULL (no enrichment)", edFcs?.availability_shift == null)
	check("final_model_prob preserved (0.61)", Math.abs(edFcs?.final_model_prob - 0.61) < 1e-9)
	check("final_edge preserved (0.067)", Math.abs(edFcs?.final_edge - 0.067) < 1e-9)

	// ── Check 6 — idempotent: re-invoking with same updatedAt is a no-op ────
	console.log("\n=== Check 6 — re-invocation with same snapshot updatedAt is no-op ===")
	const beforeReinvoke = {
		epochs: db.prepare("SELECT COUNT(*) AS c FROM prediction_epochs").get().c,
		ps:     db.prepare("SELECT COUNT(*) AS c FROM prediction_snapshots").get().c,
		fcs:    db.prepare("SELECT COUNT(*) AS c FROM frozen_contextual_states").get().c,
	}
	const fakeRes2 = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b){ this.body = b; return this } }
	await nbaRoutes.handleNbaRefreshSnapshotAfterMlbBranch(fakeReq, fakeRes2, { ...deps, backendRoot: path.dirname(TMP_SNAPSHOT) })
	const afterReinvoke = {
		epochs: db.prepare("SELECT COUNT(*) AS c FROM prediction_epochs").get().c,
		ps:     db.prepare("SELECT COUNT(*) AS c FROM prediction_snapshots").get().c,
		fcs:    db.prepare("SELECT COUNT(*) AS c FROM frozen_contextual_states").get().c,
	}
	check("epochs unchanged", afterReinvoke.epochs === beforeReinvoke.epochs)
	check("prediction_snapshots unchanged", afterReinvoke.ps === beforeReinvoke.ps)
	check("frozen_contextual_states unchanged", afterReinvoke.fcs === beforeReinvoke.fcs)

	// ── Cleanup ─────────────────────────────────────────────────────────────
	try { db.close() } catch (_) {}
	clean()

	console.log("\n=== SUMMARY ===")
	console.log(`  pass: ${pass}`)
	console.log(`  fail: ${fail}`)
	process.exit(fail === 0 ? 0 : 1)
})()
