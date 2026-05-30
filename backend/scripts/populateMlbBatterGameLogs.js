"use strict"

/**
 * Runner for refreshMlbBatterGameLogs — fetches last 21 days of per-game
 * hitting stats for every batter already in mlbBatterStats.json.
 *
 *   node backend/scripts/populateMlbBatterGameLogs.js
 *   node backend/scripts/populateMlbBatterGameLogs.js 2026-05-30
 *
 * IMPORTANT: Must run AFTER populateMlbBatterStats — that's the source of
 * the player ID list.
 */

const { refreshMlbBatterGameLogs } = require("../pipeline/mlb/ingest/refreshMlbBatterGameLogs")

async function main() {
	const arg = process.argv[2]
	const opts = arg ? { slateDate: arg } : {}
	const { diagnostics } = await refreshMlbBatterGameLogs(opts)
	console.log(JSON.stringify(diagnostics, null, 2))
	if (!diagnostics.persistedToDisk) process.exit(1)
}

main().catch((e) => {
	console.error("[populateMlbBatterGameLogs] fatal:", e?.message || e)
	process.exit(1)
})
