"use strict"

/**
 * MLB Phase 2 — Manual Live-State Refresh Operator Script
 *
 * Builds an MLB snapshot and runs the Phase 2 live-state layer on it, then
 * optionally freezes the resulting state into a new prediction_epoch.
 *
 * Usage:
 *   node backend/scripts/refreshMlbLiveState.js [--freeze] [--dry-run]
 *
 * Env:
 *   MLB_LIVE_STATE_ENABLED=1   (informational; this script bypasses the gate)
 *   MLB_CTX_SKIP_BULLPEN_LIVE  (skip the same-day boxscore fetch)
 *
 * The script never starts a server, never opens sockets, never enters a loop.
 * It runs once and exits. If you want periodic refreshes, schedule this
 * script via cron or your system task scheduler — there is no internal
 * polling loop here by design.
 */

const path = require("path")

async function main() {
	const args = new Set(process.argv.slice(2))
	const wantFreeze = args.has("--freeze")
	const dryRun = args.has("--dry-run")

	const { buildMlbBootstrapSnapshot } = require(path.join("..", "pipeline", "mlb", "buildMlbBootstrapSnapshot"))
	const { applyMlbLiveStateLayers }   = require(path.join("..", "pipeline", "mlb", "live", "applyMlbLiveStateLayers"))
	const { freezeMlbLiveStateEpoch }   = require(path.join("..", "pipeline", "mlb", "live", "freezeMlbLiveStateEpoch"))

	const oddsApiKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || null
	if (!oddsApiKey && !dryRun) {
		console.log("[refreshMlbLiveState] ODDS_API_KEY not set — pass --dry-run to skip live fetch.")
		process.exit(1)
	}

	console.log("[refreshMlbLiveState] starting build", { wantFreeze, dryRun })

	let snapshot
	try {
		snapshot = await buildMlbBootstrapSnapshot({
			oddsApiKey: oddsApiKey || "dry-run-placeholder",
			now: Date.now(),
		})
	} catch (e) {
		console.log("[refreshMlbLiveState] snapshot build failed:", e?.message || e)
		process.exit(2)
	}

	const rowCount = Array.isArray(snapshot?.rows) ? snapshot.rows.length : 0
	console.log("[refreshMlbLiveState] snapshot built", { rows: rowCount, events: snapshot?.events?.length })

	// Re-derive live state explicitly (bootstrap may have skipped it if env was off)
	let live
	try {
		// We need the deep external snapshot — bootstrap doesn't expose it on the
		// returned object. For the operator script we fall back to the flat meta
		// (probable pitchers + lineup confirmation that survive at the surface).
		// Tags will be reduced compared to in-bootstrap mode, but the path is honest.
		live = await applyMlbLiveStateLayers({
			rows: snapshot?.rows,
			events: snapshot?.events,
			externalSnapshotDeep: snapshot?.externalSnapshotMeta || {},
			slateDate: snapshot?.snapshotSlateDateKey,
			capturedAtIso: snapshot?.snapshotGeneratedAt,
			skipBullpenLive: process.env.MLB_CTX_SKIP_BULLPEN_LIVE === "1",
		})
	} catch (e) {
		console.log("[refreshMlbLiveState] live state derive failed:", e?.message || e)
		process.exit(3)
	}

	console.log("[refreshMlbLiveState] live state diagnostics:", JSON.stringify(live?.diagnostics, null, 2))

	if (wantFreeze && !dryRun) {
		try {
			const r = freezeMlbLiveStateEpoch({
				liveRows: live.rows,
				slateDate: snapshot?.snapshotSlateDateKey,
				snapshotUpdatedAt: snapshot?.updatedAt,
				capturedAtIso: snapshot?.snapshotGeneratedAt,
				source: "manual_refresh",
				notes: "phase-2 live state freeze (operator script)",
			})
			console.log("[refreshMlbLiveState] freeze result:", r)
		} catch (e) {
			console.log("[refreshMlbLiveState] freeze failed:", e?.message || e)
		}
	}

	console.log("[refreshMlbLiveState] done.")
}

if (require.main === module) main()
