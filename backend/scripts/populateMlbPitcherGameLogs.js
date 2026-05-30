"use strict"

/**
 * Runner for refreshMlbPitcherGameLogs.
 *   node backend/scripts/populateMlbPitcherGameLogs.js
 *   node backend/scripts/populateMlbPitcherGameLogs.js 2026-05-30
 * Must run AFTER populateMlbPitcherStats.
 */

const { refreshMlbPitcherGameLogs } = require("../pipeline/mlb/ingest/refreshMlbPitcherGameLogs")

async function main() {
	const arg = process.argv[2]
	const opts = arg ? { slateDate: arg } : {}
	const { diagnostics } = await refreshMlbPitcherGameLogs(opts)
	console.log(JSON.stringify(diagnostics, null, 2))
	if (!diagnostics.persistedToDisk) process.exit(1)
}

main().catch((e) => { console.error("[populateMlbPitcherGameLogs] fatal:", e?.message || e); process.exit(1) })
