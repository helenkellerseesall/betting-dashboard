"use strict"

/**
 * Operational Trust — Snapshot Freshness verification.
 *
 * Exercises every branch of computeSnapshotFreshness against synthetic inputs
 * (no I/O, no network). Plus one disk-read smoke test against the actual
 * repo snapshot files (read-only; verifies pure-utility wiring).
 *
 * Usage:
 *   node backend/scripts/verifySnapshotFreshness.js
 *
 * Exit 0 = PASS, 1 = FAIL.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const {
	computeSnapshotFreshness,
	computeSnapshotFreshnessFromDisk,
	buildFreshnessPayload,
	logStaleProbe,
	getThresholds,
	pickSnapshotTimestampMs,
} = require("../pipeline/shared/snapshotFreshness")

function assert(cond, msg, ctx) {
	if (!cond) {
		console.log("FAIL —", msg)
		if (ctx !== undefined) console.log("  ctx:", JSON.stringify(ctx, null, 2))
		process.exitCode = 1
		return false
	}
	console.log("  OK —", msg)
	return true
}

function nowMs() { return Date.now() }
function minutesAgoIso(min) { return new Date(Date.now() - min * 60000).toISOString() }
function minutesAgoMs(min)  { return Date.now() - min * 60000 }

function run() {
	console.log("\n=== Snapshot Freshness verification ===\n")

	// ── 1. Fresh snapshot (snapshotGeneratedAt 3 minutes ago) ──────────────
	console.log("\n--- fresh ---")
	{
		const f = computeSnapshotFreshness({
			sport: "mlb",
			snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(3) } },
			file: "/fake/snapshot-mlb.json",
			fileModifiedMs: minutesAgoMs(3),
			fileExists: true,
		})
		assert(f.status === "fresh", "fresh status")
		assert(f.isStale === false, "fresh not stale")
		assert(f.thresholdBreached === null, "no threshold breached")
		assert(f.primaryAgeSource === "snapshotGeneratedAt", "uses snapshotGeneratedAt")
		assert(Number.isFinite(f.snapshotAgeMinutes), "ageMinutes numeric")
		assert(f.warnings.length === 0, "no warnings")
	}

	// ── 2. Warning band (15 min old, default warn=10, stale=25) ────────────
	console.log("\n--- warning band ---")
	{
		const f = computeSnapshotFreshness({
			sport: "nba",
			snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(15) } },
			file: "/fake/snapshot.json",
			fileModifiedMs: minutesAgoMs(15),
			fileExists: true,
		})
		assert(f.status === "warning", "status=warning", { v: f.status })
		assert(f.isStale === false, "warning band is NOT 'isStale' (only true 'stale' or 'absent' are)")
		assert(f.thresholdBreached === "warning", "thresholdBreached=warning")
		assert(f.warnings.includes("snapshot_age_in_warning_band"), "warning tag present")
		assert(f.staleReason && /warning/i.test(f.staleReason), "staleReason describes warning")
	}

	// ── 3. Stale (60 min old) ───────────────────────────────────────────────
	console.log("\n--- stale ---")
	{
		const f = computeSnapshotFreshness({
			sport: "mlb",
			snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(60) } },
			file: "/fake/snapshot-mlb.json",
			fileModifiedMs: minutesAgoMs(60),
			fileExists: true,
		})
		assert(f.status === "stale", "status=stale")
		assert(f.isStale === true, "isStale=true")
		assert(f.thresholdBreached === "stale", "thresholdBreached=stale")
		assert(f.warnings.includes("snapshot_age_exceeds_stale_threshold"), "stale warning tag")
		assert(f.staleReason && /stale/i.test(f.staleReason), "staleReason describes stale")
	}

	// ── 4. Absent (file missing) ───────────────────────────────────────────
	console.log("\n--- absent (file missing) ---")
	{
		const f = computeSnapshotFreshness({
			sport: "mlb",
			snapshot: null,
			file: "/fake/missing.json",
			fileModifiedMs: null,
			fileExists: false,
		})
		assert(f.status === "absent", "status=absent when file missing")
		assert(f.isStale === true, "absent is treated as stale")
		assert(f.warnings.includes("snapshot_file_missing"), "file missing tag")
	}

	// ── 5. No-self-timestamp fallback to mtime ─────────────────────────────
	console.log("\n--- no snapshot.generatedAt, fallback to mtime ---")
	{
		const f = computeSnapshotFreshness({
			sport: "mlb",
			snapshot: { data: { rows: [] } }, // no snapshotGeneratedAt
			file: "/fake/snapshot-mlb.json",
			fileModifiedMs: minutesAgoMs(5),
			fileExists: true,
		})
		assert(f.primaryAgeSource === "fileModifiedAt", "falls back to fileModifiedAt")
		assert(f.warnings.includes("snapshot_lacks_self_timestamp_falling_back_to_mtime"), "warns about fallback")
		assert(f.status === "fresh", "5-min mtime is fresh")
	}

	// ── 6. Snapshot has no usable timestamp AND no mtime → absent ─────────
	console.log("\n--- file exists but no usable timestamps ---")
	{
		const f = computeSnapshotFreshness({
			sport: "mlb",
			snapshot: { data: { rows: [] } },
			file: "/fake/snapshot-mlb.json",
			fileModifiedMs: null,
			fileExists: true,
		})
		assert(f.status === "absent", "absent (no timestamps usable)")
		assert(f.warnings.includes("snapshot_has_no_usable_timestamp"), "no_usable_timestamp tag")
	}

	// ── 7. env override of stale threshold ─────────────────────────────────
	console.log("\n--- env override (NBA_SNAPSHOT_STALE_MINUTES=3) ---")
	{
		const prev = process.env.NBA_SNAPSHOT_STALE_MINUTES
		process.env.NBA_SNAPSHOT_STALE_MINUTES = "3"
		try {
			const f = computeSnapshotFreshness({
				sport: "nba",
				snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(5) } },
				file: "/fake/snapshot.json",
				fileModifiedMs: minutesAgoMs(5),
				fileExists: true,
			})
			assert(f.thresholds.staleMinutes === 3, "env override applied")
			assert(f.status === "stale", "5min snapshot is stale when threshold=3")
		} finally {
			if (prev == null) delete process.env.NBA_SNAPSHOT_STALE_MINUTES
			else process.env.NBA_SNAPSHOT_STALE_MINUTES = prev
		}
	}

	// ── 8. savedAt epoch fallback (MLB save wrap uses savedAt: Date.now()) ─
	console.log("\n--- savedAt ms epoch fallback ---")
	{
		const f = computeSnapshotFreshness({
			sport: "mlb",
			snapshot: { savedAt: minutesAgoMs(2), data: {} },
			file: "/fake/snapshot-mlb.json",
			fileModifiedMs: minutesAgoMs(2),
			fileExists: true,
		})
		assert(f.snapshotGeneratedAtMs != null, "savedAt resolved to ms")
		assert(f.status === "fresh", "2 min ago is fresh")
	}

	// ── 9. buildFreshnessPayload sanitization ──────────────────────────────
	console.log("\n--- buildFreshnessPayload shape ---")
	{
		const f = computeSnapshotFreshness({
			sport: "nba",
			snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(2) } },
			file: "/fake/snapshot.json",
			fileModifiedMs: minutesAgoMs(2),
			fileExists: true,
		})
		const payload = buildFreshnessPayload(f)
		for (const k of ["sport", "status", "isStale", "snapshotAgeMinutes", "thresholds", "warnings"]) {
			assert(Object.prototype.hasOwnProperty.call(payload, k), `payload has key: ${k}`)
		}
		assert(payload.file === undefined, "payload omits file path by default")
		const payloadWithFile = buildFreshnessPayload(f, { includeFilePath: true })
		assert(payloadWithFile.file === "/fake/snapshot.json", "payload includes file when asked")
	}

	// ── 10. logStaleProbe is a no-op for fresh ─────────────────────────────
	console.log("\n--- logStaleProbe gating ---")
	{
		// Spy: temporarily intercept console.log
		const orig = console.log
		let captured = []
		console.log = (...args) => captured.push(args.join(" "))
		try {
			const fresh = computeSnapshotFreshness({
				sport: "mlb",
				snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(1) } },
				file: "/fake/snapshot-mlb.json",
				fileModifiedMs: minutesAgoMs(1),
				fileExists: true,
			})
			logStaleProbe(fresh)
			console.log = orig
			assert(captured.length === 0, "no log emitted for fresh snapshot")

			captured = []
			console.log = (...args) => captured.push(args.join(" "))
			const stale = computeSnapshotFreshness({
				sport: "mlb",
				snapshot: { data: { snapshotGeneratedAt: minutesAgoIso(45) } },
				file: "/fake/snapshot-mlb.json",
				fileModifiedMs: minutesAgoMs(45),
				fileExists: true,
			})
			logStaleProbe(stale, { context: "test" })
			console.log = orig
			assert(captured.length === 1, "exactly 1 log line for stale snapshot")
			assert(captured[0].includes("[STALE-SNAPSHOT-DETECTED]"), "uses [STALE-SNAPSHOT-DETECTED] tag")
		} finally {
			console.log = orig
		}
	}

	// ── 11. Disk smoke test (read-only) ────────────────────────────────────
	console.log("\n--- disk smoke test (read-only) ---")
	{
		try {
			const f = computeSnapshotFreshnessFromDisk("mlb")
			assert(typeof f === "object" && f !== null, "returns object")
			assert(typeof f.status === "string", "status string")
			assert(Object.prototype.hasOwnProperty.call(f, "fileExists"), "has fileExists key")
			console.log("  (info) disk MLB status =", f.status, "ageMin =", f.snapshotAgeMinutes)
		} catch (e) {
			assert(false, "disk read should not throw", { err: e?.message })
		}
		try {
			const f = computeSnapshotFreshnessFromDisk("nba")
			assert(typeof f === "object" && f !== null, "returns object (nba)")
			console.log("  (info) disk NBA status =", f.status, "ageMin =", f.snapshotAgeMinutes)
		} catch (e) {
			assert(false, "disk NBA read should not throw", { err: e?.message })
		}
	}

	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
