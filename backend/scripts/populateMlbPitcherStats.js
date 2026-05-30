"use strict"

/**
 * Standalone runner for refreshMlbPitcherStats — useful for smoke-testing the
 * pitcher cache (e.g., after the 2026-05-30 pitchHand fix) without waiting
 * for the next slate:mlb cycle.
 *
 *   node backend/scripts/populateMlbPitcherStats.js
 *   node backend/scripts/populateMlbPitcherStats.js 2026-05-30
 *
 * Writes to backend/data/mlbPitcherStats.json.
 */

const { refreshMlbPitcherStats } = require("../pipeline/mlb/ingest/refreshMlbPitcherStats")

async function main() {
	const arg = process.argv[2]
	const opts = arg ? { slateDate: arg } : {}
	const { diagnostics } = await refreshMlbPitcherStats(opts)
	console.log(JSON.stringify(diagnostics, null, 2))
	if (!diagnostics.persistedToDisk) process.exit(1)
}

main().catch((e) => {
	console.error("[populateMlbPitcherStats] fatal:", e?.message || e)
	process.exit(1)
})
