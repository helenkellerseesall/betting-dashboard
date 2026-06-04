"use strict"
process.chdir(__dirname)

// Session AZ — Frozen Prediction + Grading Architecture V1 verification probe.
//
// Six checks:
//   1. Schema applies cleanly; both new tables exist with expected columns
//   2. Single freeze captures expected counts (predictions + contextual + ecology)
//   3. Re-freeze with identical inputs is a no-op (immutability — predictions
//      not overwritten, epoch not duplicated, contextual states not reinserted)
//   4. Grading linkage: insert outcome via existing intel.recordOutcome →
//      retrieval via getFrozenPredictionWithContext returns hit + delta_prob
//   5. Contextual replay: getEpochPredictions returns predictions joined with
//      their original contextual state — values MATCH the original input
//   6. New epoch (different snapshotUpdatedAt) for same predictions creates
//      a new contextual snapshot row (composite PK preserves history)
//
// Uses an in-memory SQLite database to avoid touching the live betting.db
// and to bypass sandbox disk I/O quirks.

const path = require("path")
const fs   = require("fs")

// Force in-memory DB by overriding the path BEFORE db.js is required.
// The simplest way: copy schemas + intelligence module references and use a
// local DatabaseSync instance. We avoid deep monkey-patching by instead just
// using a temp file path, which we then unlink.
// Use /tmp (sandbox-local fs) — the workspace mount has issues with SQLite journals.
// Fall back to project dir if /tmp not writable.
let TMP_DB = "/tmp/.probe_frozen_epoch_tmp.db"
try { fs.writeFileSync(TMP_DB + ".write_test", "ok"); fs.unlinkSync(TMP_DB + ".write_test") }
catch (_) { TMP_DB = path.join(__dirname, ".probe_frozen_epoch_tmp.db") }
try { fs.unlinkSync(TMP_DB) } catch (_) {}

// Monkey-patch db.js's path before anyone requires it. We do this by
// overriding the path module's join briefly OR by directly instantiating
// the DB ourselves. The cleanest way is to require db.js with a side-channel
// — but db.js hardcodes its path. So we instead override require cache.
const dbModulePath = path.resolve("./backend/storage/db.js")
delete require.cache[dbModulePath]
require.cache[dbModulePath] = {
	exports: (() => {
		const { DatabaseSync } = require("node:sqlite")
		const { applySchema }  = require("./backend/storage/schema")
		let _db = null
		function tryGetDb() {
			if (_db) return _db
			_db = new DatabaseSync(TMP_DB)
			applySchema(_db)
			return _db
		}
		return { tryGetDb, getDb: tryGetDb, dbPath: () => TMP_DB, closeDb: () => {} }
	})(),
	loaded: true,
	filename: dbModulePath,
	id: dbModulePath,
}

// Now require the modules under test
const { freezePredictionEpoch, computeEpochId } = require("./backend/pipeline/memory/freezePredictionEpoch")
const { listEpochs, getEpoch, getEpochPredictions, getFrozenPredictionWithContext } = require("./backend/pipeline/memory/readFrozenEpoch")
const intel = require("./backend/storage/intelligence")
const { tryGetDb } = require("./backend/storage/db")

let pass = 0, fail = 0
function check(label, ok, detail = "") {
	if (ok) { console.log("  ✓", label); pass++ }
	else    { console.log("  ✗", label, detail); fail++ }
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const SPORT       = "nba"
const SLATE_DATE  = "2026-05-13"
const SNAPSHOT_T1 = "2026-05-13T01:30:00.000Z"
const SNAPSHOT_T2 = "2026-05-13T03:00:00.000Z"

const fixturePredictions = [
	{
		player: "Stephen Curry",
		statFamily: "threes",
		side: "over",
		line: 4.5,
		odds: -110,
		sportsbook: "DraftKings",
		modelProb: 0.58,
		impliedProb: 0.524,
		edge: 0.056,
		// Session AO — matchup
		matchupShift: 0.012,
		matchupContext: { score: 0.65 },
		// Session AP — recent form
		recentForm: { formZ: 1.4, sample: 8 },
		recentFormShift: 0.018,
		// Session AR — role + minutes
		starterFlag: true,
		projectedMinutes: 33.5,
		roleContext: { starterFlag: true, projectedMinutes: 33.5 },
		// Session AS — teammate
		teammateContext: { absent_teammates: ["Andrew Wiggins"], redistribution_shift: 0.022 },
		teammateRedistShift: 0.022,
		// Session AT — market
		marketContext: { consensus_implied: 0.518, dispersion: 0.014, book_count: 4 },
		marketShift: -0.006,
		// Session AV — availability
		playerStatus: "active",
		availabilityContext: { status: "active" },
		availabilityShift: 0,
	},
	{
		player: "LeBron James",
		statFamily: "points",
		side: "over",
		line: 24.5,
		odds: +105,
		sportsbook: "FanDuel",
		modelProb: 0.55,
		impliedProb: 0.488,
		edge: 0.062,
		// Sparse contextual data — only role context fired
		starterFlag: true,
		projectedMinutes: 35.0,
		roleContext: { starterFlag: true, projectedMinutes: 35.0 },
	},
	{
		player: "Anthony Edwards",
		statFamily: "pra",
		side: "over",
		line: 41.5,
		odds: -115,
		sportsbook: "DraftKings",
		modelProb: 0.61,
		impliedProb: 0.535,
		edge: 0.075,
		// No contextual data — bare prediction
	},
]

const fixtureSlips = {
	safe:       [{ id: "s1", legs: [{}, {}] }],
	balanced:   [{ id: "b1", legs: [{}, {}, {}] }, { id: "b2", legs: [{}, {}] }],
	aggressive: [{ id: "a1", legs: [{}, {}, {}, {}] }],
	lotto:      [],
}

// ── 1. Schema applies + tables present ───────────────────────────────────────
console.log("\n=== Check 1 — schema applies cleanly ===")
const db = tryGetDb()
check("DB available", !!db)
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)
check("prediction_epochs table exists", tables.includes("prediction_epochs"))
check("frozen_contextual_states table exists", tables.includes("frozen_contextual_states"))
check("prediction_snapshots table exists (pre-existing)", tables.includes("prediction_snapshots"))
check("outcome_snapshots table exists (pre-existing)", tables.includes("outcome_snapshots"))
const fcsCols = db.prepare("PRAGMA table_info(frozen_contextual_states)").all().map(c => c.name)
check("frozen_contextual_states has matchup_score col", fcsCols.includes("matchup_score"))
check("frozen_contextual_states has recent_form_z col", fcsCols.includes("recent_form_z"))
check("frozen_contextual_states has starter_flag col", fcsCols.includes("starter_flag"))
check("frozen_contextual_states has teammate_redist_shift col", fcsCols.includes("teammate_redist_shift"))
check("frozen_contextual_states has market_shift col", fcsCols.includes("market_shift"))
check("frozen_contextual_states has availability_shift col", fcsCols.includes("availability_shift"))
check("frozen_contextual_states has raw_context_json col", fcsCols.includes("raw_context_json"))

// ── 2. Single freeze captures expected counts ────────────────────────────────
console.log("\n=== Check 2 — single freeze captures predictions + contextual + ecology ===")
const r1 = freezePredictionEpoch({
	predictions:       fixturePredictions,
	slipsByTier:       fixtureSlips,
	sport:             SPORT,
	slateDate:         SLATE_DATE,
	source:            "manual",
	snapshotUpdatedAt: SNAPSHOT_T1,
	notes:             "probe-pass-1",
})
check("ok", r1.ok === true, JSON.stringify(r1))
check("epochId is deterministic", r1.epochId === computeEpochId(SNAPSHOT_T1, SPORT, SLATE_DATE))
check("epochInserted = true (new epoch)", r1.epochInserted === true)
check("predictionsInserted = 3", r1.predictionsInserted === 3, `got ${r1.predictionsInserted}`)
check("predictionsSkipped = 0", r1.predictionsSkipped === 0)
check("contextualInserted = 3", r1.contextualInserted === 3, `got ${r1.contextualInserted}`)
check("ecologyRecorded = true", r1.ecologyRecorded === true)
const epoch1 = getEpoch(r1.epochId)
check("epoch row prediction_count = 3", epoch1?.prediction_count === 3)
check("epoch row contextual_count = 2 (Curry + LeBron had ctx; Edwards had none)", epoch1?.contextual_count === 2, `got ${epoch1?.contextual_count}`)
check("epoch row slip_count = 4", epoch1?.slip_count === 4, `got ${epoch1?.slip_count}`)

// ── 3. Re-freeze identical inputs is no-op (immutability) ─────────────────────
console.log("\n=== Check 3 — re-freeze identical inputs is a no-op (immutability) ===")
const r2 = freezePredictionEpoch({
	predictions:       fixturePredictions,
	slipsByTier:       fixtureSlips,
	sport:             SPORT,
	slateDate:         SLATE_DATE,
	source:            "manual",
	snapshotUpdatedAt: SNAPSHOT_T1,
	notes:             "probe-pass-1-replay",
})
check("ok on replay", r2.ok === true)
check("same epochId", r2.epochId === r1.epochId)
check("epochInserted = false (no duplicate epoch)", r2.epochInserted === false)
check("predictionsInserted = 0 (predictions immutable)", r2.predictionsInserted === 0, `got ${r2.predictionsInserted}`)
check("predictionsSkipped = 3 (all already present)", r2.predictionsSkipped === 3, `got ${r2.predictionsSkipped}`)
check("contextualInserted = 0 (frozen states immutable per epoch)", r2.contextualInserted === 0, `got ${r2.contextualInserted}`)
const allEpochs = listEpochs({ sport: SPORT, slateDate: SLATE_DATE })
check("only 1 epoch after replay", allEpochs?.length === 1, `got ${allEpochs?.length}`)

// ── 4. Grading linkage via existing intel.recordOutcome ──────────────────────
console.log("\n=== Check 4 — grading linkage (existing intel.recordOutcome path) ===")
const curryPredId = intel.predictionId(SLATE_DATE, SPORT, "Stephen Curry", "threes", "over", 4.5, "DraftKings")
const beforeOutcome = getFrozenPredictionWithContext(curryPredId)
check("frozen prediction exists pre-grade", !!beforeOutcome?.prediction)
check("contextual state attached", !!beforeOutcome?.contextual)
check("outcome is null pre-grade", beforeOutcome?.outcome === null)
intel.recordOutcome(curryPredId, {
	hit: 1,
	actualValue: 6,
	settledAt: "2026-05-13T05:30:00Z",
	notes: "win",
}, { sport: SPORT, date: SLATE_DATE })
const afterOutcome = getFrozenPredictionWithContext(curryPredId)
check("outcome exists post-grade", !!afterOutcome?.outcome)
check("outcome.hit = 1", afterOutcome?.outcome?.hit === 1)
check("delta_prob computed (0.58 - 1 = -0.42)", Math.abs((afterOutcome?.outcome?.delta_prob ?? 999) - (-0.42)) < 1e-6,
	`got ${afterOutcome?.outcome?.delta_prob}`)
check("contextual still present post-grade (immutable)", afterOutcome?.contextual?.market_shift === -0.006,
	`market_shift got ${afterOutcome?.contextual?.market_shift}`)

// ── 5. Contextual replay returns original values ─────────────────────────────
console.log("\n=== Check 5 — contextual replay returns ORIGINAL values ===")
const epochPredictions = getEpochPredictions(r1.epochId)
check("getEpochPredictions returns 3 rows", epochPredictions?.length === 3, `got ${epochPredictions?.length}`)
const curryRow = epochPredictions.find(r => r.prediction_player === "Stephen Curry")
check("Curry row found", !!curryRow)
check("Curry matchup_shift preserved (0.012)", Math.abs(curryRow?.ctx_matchup_shift - 0.012) < 1e-9)
check("Curry recent_form_z preserved (1.4)", Math.abs(curryRow?.ctx_recent_form_z - 1.4) < 1e-9)
check("Curry recent_form_sample preserved (8)", curryRow?.ctx_recent_form_sample === 8)
check("Curry starter_flag preserved (1)", curryRow?.ctx_starter_flag === 1)
check("Curry projected_minutes preserved (33.5)", Math.abs(curryRow?.ctx_projected_minutes - 33.5) < 1e-9)
check("Curry teammate_absent_count preserved (1)", curryRow?.ctx_teammate_absent_count === 1)
check("Curry teammate_redist_shift preserved (0.022)", Math.abs(curryRow?.ctx_teammate_redist_shift - 0.022) < 1e-9)
check("Curry market_consensus_implied preserved (0.518)", Math.abs(curryRow?.ctx_market_consensus_implied - 0.518) < 1e-9)
check("Curry market_shift preserved (-0.006)", Math.abs(curryRow?.ctx_market_shift - (-0.006)) < 1e-9)
check("Curry market_book_count preserved (4)", curryRow?.ctx_market_book_count === 4)
check("Curry player_status preserved ('active')", curryRow?.ctx_player_status === "active")
check("Curry final_model_prob preserved (0.58)", Math.abs(curryRow?.ctx_final_model_prob - 0.58) < 1e-9)
check("Curry outcome_hit joined (1)", curryRow?.outcome_hit === 1)
const edwardsRow = epochPredictions.find(r => r.prediction_player === "Anthony Edwards")
check("Edwards row found", !!edwardsRow)
check("Edwards matchup_shift = NULL (no signal)", edwardsRow?.ctx_matchup_shift == null)
check("Edwards recent_form_z = NULL (no signal)", edwardsRow?.ctx_recent_form_z == null)
check("Edwards starter_flag = NULL (no signal)", edwardsRow?.ctx_starter_flag == null)

// ── 6. New epoch for same predictions captures separate contextual snapshot ──
console.log("\n=== Check 6 — new epoch creates separate contextual snapshot ===")
// Modify Curry's projected_minutes (simulating role re-derivation) and freeze new epoch
const fixtureT2 = fixturePredictions.map(r => ({ ...r }))
fixtureT2[0].projectedMinutes = 28.0           // simulating injury concern
fixtureT2[0].roleContext = { starterFlag: true, projectedMinutes: 28.0 }
fixtureT2[0].playerStatus = "questionable"     // simulating injury report update
fixtureT2[0].availabilityShift = -0.014
const r3 = freezePredictionEpoch({
	predictions:       fixtureT2,
	slipsByTier:       fixtureSlips,
	sport:             SPORT,
	slateDate:         SLATE_DATE,
	source:            "manual",
	snapshotUpdatedAt: SNAPSHOT_T2,
	notes:             "probe-pass-3-new-snapshot",
})
check("ok", r3.ok === true)
check("new epochId (different snapshotUpdatedAt)", r3.epochId !== r1.epochId)
check("epochInserted = true (new epoch)", r3.epochInserted === true)
check("predictionsInserted = 0 (same line+book → same predictionId, INSERT OR IGNORE)", r3.predictionsInserted === 0,
	`got ${r3.predictionsInserted}`)
check("contextualInserted = 3 (new epoch → new (predId, epochId) rows)", r3.contextualInserted === 3,
	`got ${r3.contextualInserted}`)
const allEpochsAfter = listEpochs({ sport: SPORT, slateDate: SLATE_DATE })
check("now 2 epochs", allEpochsAfter?.length === 2, `got ${allEpochsAfter?.length}`)
const t1Predictions = getEpochPredictions(r1.epochId)
const t2Predictions = getEpochPredictions(r3.epochId)
const curryT1 = t1Predictions.find(r => r.prediction_player === "Stephen Curry")
const curryT2 = t2Predictions.find(r => r.prediction_player === "Stephen Curry")
check("T1 Curry projected_minutes still 33.5 (immutable)", Math.abs(curryT1?.ctx_projected_minutes - 33.5) < 1e-9,
	`got ${curryT1?.ctx_projected_minutes}`)
check("T2 Curry projected_minutes is 28.0 (new context)", Math.abs(curryT2?.ctx_projected_minutes - 28.0) < 1e-9,
	`got ${curryT2?.ctx_projected_minutes}`)
check("T1 Curry player_status = active", curryT1?.ctx_player_status === "active")
check("T2 Curry player_status = questionable", curryT2?.ctx_player_status === "questionable")
check("T1 Curry availability_shift = 0", curryT1?.ctx_availability_shift === 0)
check("T2 Curry availability_shift = -0.014", Math.abs(curryT2?.ctx_availability_shift - (-0.014)) < 1e-9)

// ── Cleanup ──────────────────────────────────────────────────────────────────
try { fs.unlinkSync(TMP_DB) } catch (_) {}

console.log("\n=== SUMMARY ===")
console.log(`  pass: ${pass}`)
console.log(`  fail: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
