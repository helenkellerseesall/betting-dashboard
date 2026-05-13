"use strict"

/**
 * Snapshot Freshness — operational trust hardening (read-only utility).
 *
 * Single source of truth for "is this snapshot fresh enough to be served as
 * if it were current?" — answers four questions:
 *   1. How old is the snapshot (by its own `snapshotGeneratedAt` claim)?
 *   2. How old is the disk file (by mtime)?
 *   3. Is the snapshot considered fresh / warning / stale / absent?
 *   4. Why? (machine-readable reason; for response payloads + logs.)
 *
 * Architectural rules honored:
 *   - Pure functions; no I/O outside `computeFromDisk`.
 *   - Read-only — never writes to disk, never mutates snapshots.
 *   - Truthful nulls — when a timestamp source is missing, the matching
 *     age field is null, not 0.
 *   - Fail-open — every helper has a defensive try/catch and returns a
 *     shape-stable payload on error.
 *   - Env-driven thresholds — operators can tighten/relax without code edits.
 *   - No refresh loops, no API spam — this module never triggers rebuilds.
 *     Callers may opt in to auto-rebuild externally with their own cooldown.
 *
 * Per-sport defaults (minutes):
 *   - warningMinutes: 10
 *   - staleMinutes:   25
 *   Operators can override with:
 *     NBA_SNAPSHOT_WARN_MINUTES, NBA_SNAPSHOT_STALE_MINUTES
 *     MLB_SNAPSHOT_WARN_MINUTES, MLB_SNAPSHOT_STALE_MINUTES
 *
 * Status enum:
 *   "fresh"   — within warning threshold
 *   "warning" — older than warning but younger than stale
 *   "stale"   — exceeds stale threshold
 *   "absent"  — file does not exist or has no usable timestamp
 *   "error"   — internal failure during evaluation (rare; shape preserved)
 */

const fs = require("fs")
const path = require("path")

const DEFAULTS = {
	nba: { warningMinutes: 10, staleMinutes: 25 },
	mlb: { warningMinutes: 10, staleMinutes: 25 },
	// generic fallback for any future sport
	default: { warningMinutes: 10, staleMinutes: 25 },
}

function safeInt(v) {
	const n = Number(v)
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

function getThresholds(sport) {
	const sp = String(sport || "").toLowerCase()
	const baseline = DEFAULTS[sp] || DEFAULTS.default
	const warnEnv  = safeInt(process.env[`${sp.toUpperCase()}_SNAPSHOT_WARN_MINUTES`])
	const staleEnv = safeInt(process.env[`${sp.toUpperCase()}_SNAPSHOT_STALE_MINUTES`])
	return {
		warningMinutes: warnEnv  != null ? warnEnv  : baseline.warningMinutes,
		staleMinutes:   staleEnv != null ? staleEnv : baseline.staleMinutes,
	}
}

function snapshotFilePath(sport) {
	const sp = String(sport || "").toLowerCase()
	const root = path.join(__dirname, "..", "..")
	if (sp === "nba") return path.join(root, "snapshot.json")
	return path.join(root, `snapshot-${sp}.json`)
}

function pickSnapshotTimestampMs(snapshot) {
	if (!snapshot || typeof snapshot !== "object") return null
	const data = snapshot?.data || snapshot
	const candidates = [
		data?.snapshotGeneratedAt,
		data?.updatedAt,
		snapshot?.savedAt, // number (ms) per saveMlbReplaySnapshotToDisk
	]
	for (const c of candidates) {
		if (c == null) continue
		if (typeof c === "number" && Number.isFinite(c)) return c
		const t = new Date(c).getTime()
		if (Number.isFinite(t)) return t
	}
	return null
}

function pickSnapshotIso(snapshot) {
	const data = snapshot?.data || snapshot
	const iso = data?.snapshotGeneratedAt || data?.updatedAt || null
	if (!iso) return null
	const t = new Date(iso).getTime()
	return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function classifyStatus({ ageMs, thresholdsMin, fileExists }) {
	if (!fileExists) return { status: "absent", thresholdBreached: null }
	if (ageMs == null) return { status: "absent", thresholdBreached: null }
	const ageMin = ageMs / 60000
	if (ageMin > thresholdsMin.staleMinutes)   return { status: "stale",   thresholdBreached: "stale" }
	if (ageMin > thresholdsMin.warningMinutes) return { status: "warning", thresholdBreached: "warning" }
	return { status: "fresh", thresholdBreached: null }
}

function buildStaleReason({ status, snapshotAgeMinutes, fileAgeMinutes, thresholds, fileExists }) {
	if (status === "fresh") return null
	if (status === "absent") return fileExists ? "snapshot_has_no_usable_timestamp" : "snapshot_file_missing"
	const reasons = []
	if (Number.isFinite(snapshotAgeMinutes) && snapshotAgeMinutes > thresholds.staleMinutes) {
		reasons.push(`snapshotGeneratedAt is ${snapshotAgeMinutes.toFixed(1)}min old (stale ≥ ${thresholds.staleMinutes}min)`)
	} else if (Number.isFinite(snapshotAgeMinutes) && snapshotAgeMinutes > thresholds.warningMinutes) {
		reasons.push(`snapshotGeneratedAt is ${snapshotAgeMinutes.toFixed(1)}min old (warning ≥ ${thresholds.warningMinutes}min)`)
	}
	if (Number.isFinite(fileAgeMinutes) && fileAgeMinutes > thresholds.staleMinutes) {
		reasons.push(`file mtime is ${fileAgeMinutes.toFixed(1)}min old`)
	}
	return reasons.length ? reasons.join("; ") : `status=${status}`
}

/**
 * Pure computation: given a parsed snapshot object + a file path, compute
 * the full freshness payload. Does no I/O — caller supplies parsed JSON.
 *
 * Use this from API handlers that already hold the parsed snapshot.
 *
 * @param {object} args
 * @param {string} args.sport               — "nba" | "mlb" | etc.
 * @param {object|null} args.snapshot       — parsed snapshot (may be null)
 * @param {string|null} args.file           — disk path (for error reporting)
 * @param {number|null} args.fileModifiedMs — fs.statSync(file).mtimeMs (optional)
 * @param {boolean} args.fileExists
 * @param {number} [args.nowMs]             — defaults to Date.now()
 * @returns {object} freshness payload
 */
function computeSnapshotFreshness({ sport, snapshot, file = null, fileModifiedMs = null, fileExists = false, nowMs = null }) {
	try {
		const now = Number.isFinite(nowMs) ? nowMs : Date.now()
		const thresholds = getThresholds(sport)
		const snapshotMs   = pickSnapshotTimestampMs(snapshot)
		const snapshotIso  = pickSnapshotIso(snapshot)
		const fileMs       = Number.isFinite(fileModifiedMs) ? fileModifiedMs : null

		// Prefer snapshot's own claim; fall back to file mtime.
		let primaryAgeSource = null
		let ageMs = null
		if (Number.isFinite(snapshotMs)) {
			primaryAgeSource = "snapshotGeneratedAt"
			ageMs = Math.max(0, now - snapshotMs)
		} else if (Number.isFinite(fileMs)) {
			primaryAgeSource = "fileModifiedAt"
			ageMs = Math.max(0, now - fileMs)
		}

		const snapshotAgeMs       = Number.isFinite(snapshotMs) ? Math.max(0, now - snapshotMs) : null
		const fileAgeMs           = Number.isFinite(fileMs)     ? Math.max(0, now - fileMs)     : null
		const snapshotAgeMinutes  = snapshotAgeMs != null ? Number((snapshotAgeMs / 60000).toFixed(2)) : null
		const fileAgeMinutes      = fileAgeMs     != null ? Number((fileAgeMs     / 60000).toFixed(2)) : null

		const cls = classifyStatus({ ageMs, thresholdsMin: thresholds, fileExists })

		const staleReason = buildStaleReason({
			status: cls.status, snapshotAgeMinutes, fileAgeMinutes, thresholds, fileExists,
		})

		const isStale = cls.status === "stale" || cls.status === "absent"

		const warnings = []
		if (cls.status === "warning") warnings.push("snapshot_age_in_warning_band")
		if (cls.status === "stale")   warnings.push("snapshot_age_exceeds_stale_threshold")
		if (cls.status === "absent")  warnings.push(fileExists ? "snapshot_has_no_usable_timestamp" : "snapshot_file_missing")
		if (primaryAgeSource === "fileModifiedAt") warnings.push("snapshot_lacks_self_timestamp_falling_back_to_mtime")

		return {
			sport: String(sport || "").toLowerCase(),
			file: file || null,
			fileExists: Boolean(fileExists),
			snapshotGeneratedAt: snapshotIso,
			snapshotGeneratedAtMs: Number.isFinite(snapshotMs) ? snapshotMs : null,
			fileModifiedAt: Number.isFinite(fileMs) ? new Date(fileMs).toISOString() : null,
			fileModifiedAtMs: Number.isFinite(fileMs) ? fileMs : null,
			nowMs: now,
			snapshotAgeMs,
			snapshotAgeMinutes,
			fileAgeMs,
			fileAgeMinutes,
			primaryAgeSource,
			thresholds: {
				warningMinutes: thresholds.warningMinutes,
				staleMinutes:   thresholds.staleMinutes,
			},
			status: cls.status,
			thresholdBreached: cls.thresholdBreached,
			isStale: Boolean(isStale),
			staleReason,
			warnings,
		}
	} catch (err) {
		return {
			sport: String(sport || "").toLowerCase(),
			file: file || null,
			fileExists: false,
			snapshotGeneratedAt: null,
			snapshotGeneratedAtMs: null,
			fileModifiedAt: null,
			fileModifiedAtMs: null,
			nowMs: Date.now(),
			snapshotAgeMs: null,
			snapshotAgeMinutes: null,
			fileAgeMs: null,
			fileAgeMinutes: null,
			primaryAgeSource: null,
			thresholds: getThresholds(sport),
			status: "error",
			thresholdBreached: null,
			isStale: true,
			staleReason: `freshness_eval_failed:${err?.message || String(err)}`,
			warnings: ["freshness_eval_threw"],
		}
	}
}

/**
 * Disk-aware variant: takes only a sport name, reads the canonical snapshot
 * file (snapshot.json for NBA, snapshot-mlb.json for MLB), and returns the
 * freshness payload. Safe to call repeatedly; never throws.
 */
function computeSnapshotFreshnessFromDisk(sport) {
	const file = snapshotFilePath(sport)
	let fileExists = false
	let fileModifiedMs = null
	let snapshot = null
	try {
		const stat = fs.statSync(file)
		fileExists = true
		fileModifiedMs = stat.mtimeMs
	} catch (_) {
		fileExists = false
	}
	if (fileExists) {
		try {
			const raw = fs.readFileSync(file, "utf8")
			if (raw && raw.trim().length) snapshot = JSON.parse(raw)
		} catch (_) {
			snapshot = null
		}
	}
	return computeSnapshotFreshness({ sport, snapshot, file, fileModifiedMs, fileExists })
}

/**
 * Emit a single-line stale-state probe to stdout. Always-on, low-volume,
 * one line per call. Caller decides when to invoke; usually:
 *   - at API request time when freshness.isStale === true
 *   - at server boot for every configured sport
 *   - inside scheduled diagnostics scripts
 *
 * Returns the freshness object for chaining.
 */
function logStaleProbe(freshness, { context = "request" } = {}) {
	if (!freshness) return freshness
	if (freshness.status === "fresh") return freshness
	const tag = freshness.status === "stale" || freshness.status === "absent"
		? "[STALE-SNAPSHOT-DETECTED]"
		: "[STALE-SNAPSHOT-WARNING]"
	console.log(
		tag,
		JSON.stringify({
			context,
			sport: freshness.sport,
			file: freshness.file,
			status: freshness.status,
			snapshotAgeMinutes: freshness.snapshotAgeMinutes,
			fileAgeMinutes: freshness.fileAgeMinutes,
			thresholdBreached: freshness.thresholdBreached,
			thresholds: freshness.thresholds,
			staleReason: freshness.staleReason,
		})
	)
	return freshness
}

/**
 * Build a compact API-safe payload (no internal paths exposed by default).
 * Used inside `/api/ws/state` and `/api/ws/health` responses.
 */
function buildFreshnessPayload(freshness, { includeFilePath = false } = {}) {
	if (!freshness) return null
	const payload = {
		sport: freshness.sport,
		status: freshness.status,
		isStale: freshness.isStale,
		snapshotGeneratedAt: freshness.snapshotGeneratedAt,
		snapshotAgeMinutes: freshness.snapshotAgeMinutes,
		fileAgeMinutes: freshness.fileAgeMinutes,
		primaryAgeSource: freshness.primaryAgeSource,
		thresholdBreached: freshness.thresholdBreached,
		thresholds: freshness.thresholds,
		staleReason: freshness.staleReason,
		warnings: freshness.warnings,
	}
	if (includeFilePath) payload.file = freshness.file
	return payload
}

module.exports = {
	computeSnapshotFreshness,
	computeSnapshotFreshnessFromDisk,
	logStaleProbe,
	buildFreshnessPayload,
	snapshotFilePath,
	getThresholds,
	pickSnapshotTimestampMs,
}
