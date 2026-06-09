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
	// 2026-06-09 hardening — surface coverage as a one-line human summary.
	const cov = `${diagnostics.teamsCaptured ?? "?"}/${diagnostics.teamsOnSlate ?? "?"}`
	console.log(`\n[batter-stats] coverage ${cov} slate teams · ${diagnostics.mergedBatters ?? "?"} batters in cache · ${diagnostics.priorEntriesRetained ?? 0} prior entries retained (merge)`)
	if (diagnostics.missingTeams && diagnostics.missingTeams.length) {
		console.log(`[batter-stats] STILL MISSING after retry + targeted re-fetch: ${diagnostics.missingTeams.join(", ")}`)
	} else if (diagnostics.coverageComplete) {
		console.log("[batter-stats] coverage COMPLETE — all slate teams cached.")
	}
	if (!diagnostics.persistedToDisk) process.exit(1)
}

main().catch((e) => {
	console.error("[populateMlbBatterStats] fatal:", e?.message || e)
	process.exit(1)
})
