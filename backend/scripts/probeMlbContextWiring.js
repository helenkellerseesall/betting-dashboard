"use strict"

/**
 * Probe: confirms applyMlbContextualLayers attaches batter+pitcher identity +
 * stats blobs from the new caches, and that downstream context derivers light up.
 *
 * Runs offline — no backend, no slate refresh, no network.
 *
 *   node backend/scripts/probeMlbContextWiring.js > .scratch/last.txt 2>&1
 */

const fs = require("fs")
const path = require("path")
const { applyMlbContextualLayers } = require("../pipeline/mlb/context/applyMlbContextualLayers")

const dataDir = path.join(__dirname, "..", "data")
const batterCache = JSON.parse(fs.readFileSync(path.join(dataDir, "mlbBatterStats.json"), "utf8"))
const pitcherCache = JSON.parse(fs.readFileSync(path.join(dataDir, "mlbPitcherStats.json"), "utf8"))

// Pick one real batter and one real pitcher from the caches.
const batterEntry = Object.values(batterCache).find((v) => v.batSide && v.hrRate != null) || Object.values(batterCache)[0]
const pitcherEntry = Object.values(pitcherCache).find((v) => v.throws && v.kRate != null) || Object.values(pitcherCache)[0]

console.log("=== probe inputs ===")
console.log("batterCache entries:", Object.keys(batterCache).length)
console.log("pitcherCache entries:", Object.keys(pitcherCache).length)
console.log("sample batter:", batterEntry?.fullName, "batSide:", batterEntry?.batSide, "hrRate:", batterEntry?.hrRate, "iso:", batterEntry?.iso)
console.log("sample pitcher:", pitcherEntry?.fullName, "throws:", pitcherEntry?.throws, "kRate:", pitcherEntry?.kRate, "whip:", pitcherEntry?.whip)

const rows = [
	// Batter row (HR market) — no handedness on the row yet, like sportsbook ingest.
	{
		player: batterEntry?.fullName,
		marketKey: "batter_home_runs",
		marketFamily: "standard",
		propType: "hr",
		eventId: "test_evt_hr_1",
		line: 0.5,
		odds: 320,
		side: "Over",
		opposingPitcher: pitcherEntry?.fullName,
		isPitcherMarket: false,
	},
	// Hits market row
	{
		player: batterEntry?.fullName,
		marketKey: "batter_hits",
		marketFamily: "standard",
		propType: "hits",
		eventId: "test_evt_hits_1",
		line: 1.5,
		odds: 180,
		side: "Over",
		opposingPitcher: pitcherEntry?.fullName,
		isPitcherMarket: false,
	},
	// Pitcher Ks row — player IS the pitcher
	{
		player: pitcherEntry?.fullName,
		marketKey: "pitcher_strikeouts_alternate",
		marketFamily: "standard",
		propType: "Ks",
		eventId: "test_evt_ks_1",
		line: 6.5,
		odds: -110,
		side: "Over",
		isPitcherMarket: true,
	},
]

const result = applyMlbContextualLayers({ rows, events: [] })

console.log("\n=== applyMlbContextualLayers diagnostics ===")
console.log("rowsProcessed:", result.diagnostics.rowsProcessed)
console.log("coverage:", JSON.stringify(result.diagnostics.coverage))
console.log("dataSources:", JSON.stringify(result.diagnostics.dataSources))

console.log("\n=== enriched rows ===")
for (const r of result.rows) {
	console.log("\n--", r.player, "(", r.marketKey, ")")
	console.log("  batterHand:    ", r.batterHand)
	console.log("  pitcherHand:   ", r.pitcherHand)
	console.log("  batterStats:   ", r.batterStats ? `{ avg:${r.batterStats.avg}, hrRate:${r.batterStats.hrRate}, iso:${r.batterStats.iso}, kRate:${r.batterStats.kRate} }` : null)
	console.log("  pitcherStats:  ", r.pitcherStats ? `{ kRate:${r.pitcherStats.kRate}, whip:${r.pitcherStats.whip}, k9:${r.pitcherStats.k9} }` : null)
	console.log("  handednessCtx: ", r.handednessContext ? `${r.handednessContext.platoonTag} (${r.handednessContext.platoonRelation})` : null)
}

const ok =
	result.rows[0].batterHand &&
	result.rows[0].batterStats &&
	result.rows[2].pitcherHand &&
	result.rows[2].pitcherStats &&
	result.rows[0].handednessContext
console.log("\n=== WIRE STATUS ===")
console.log(ok ? "PASS — context layer attaches batter+pitcher identity+stats and handedness lights up." : "FAIL — see fields above")
process.exit(ok ? 0 : 1)
