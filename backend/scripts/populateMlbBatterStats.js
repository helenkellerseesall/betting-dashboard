"use strict"

/**
 * Runner for refreshMlbBatterStats — usable standalone or from auditNightly.
 *
 *   node backend/scripts/populateMlbBatterStats.js
 *   node backend/scripts/populateMlbBatterStats.js 2026-05-30
 */

const { refreshMlbBatterStats } = require("../pipeline/mlb/ingest/refreshMlbBatterStats")

async function main() {
	const arg = process.argv[2]
	const opts = arg ? { slateDate: arg } : {}
	const { diagnostics } = await refreshMlbBatterStats(opts)
	console.log(JSON.stringify(diagnostics, null, 2))
	if (!diagnostics.persistedToDisk) process.exit(1)
}

main().catch((e) => {
	console.error("[populateMlbBatterStats] fatal:", e?.message || e)
	process.exit(1)
})
