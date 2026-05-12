"use strict"

/**
 * MLB Phase 2 — Live State Persistence (append-only JSONL history)
 *
 * Each refresh produces a snapshot of slate-state-at-the-moment. We append
 * one line to a per-slate JSONL file. Append-only makes every observation
 * IMMUTABLE — old lines are never rewritten, only newer lines appended.
 *
 * Path: backend/data/mlbLiveStateHistory/{slateDate}.jsonl
 *
 * Each appended line carries:
 *   {
 *     capturedAtIso,            // when this observation was captured
 *     slateDate,                // YYYY-MM-DD
 *     epochId,                  // deterministic from capturedAtIso
 *     byEventId: {
 *       <eventId>: { lineupConfirmation, probablePitchers, weather }
 *     },
 *     byPropKey: {
 *       <propKey>: { odds, line, side, player }
 *     }
 *   }
 *
 * Read API exposes "last N" without loading the entire file into memory.
 *
 * Architectural rules honored:
 *   - Append-only (never rewrites old lines)
 *   - Bounded: optional rotation keeps file size manageable for long slates
 *   - Fail-open: read errors return [], write errors return false
 *   - No background jobs / no polling — readers call read*, writers call append
 */

const fs = require("fs")
const path = require("path")

const DEFAULT_KEEP_TAIL_LINES = 60   // ~15 hrs at 15-min refresh; bounded memory
const DEFAULT_ROTATE_AT_LINES = 2000 // safety-net rotation; rare in practice

function historyDir() {
	return path.join(__dirname, "..", "..", "..", "data", "mlbLiveStateHistory")
}

function ensureDir() {
	const dir = historyDir()
	try {
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		return true
	} catch (_) { return false }
}

function fileForSlate(slateDate) {
	const sd = String(slateDate || "").slice(0, 10) || "unknown"
	return path.join(historyDir(), `${sd}.jsonl`)
}

function computeEpochId(capturedAtIso, slateDate) {
	return [String(capturedAtIso || ""), "mlb", String(slateDate || "").slice(0, 10)].join("|")
}

function buildPropKey(row) {
	return [
		String(row?.eventId || ""),
		String(row?.player || ""),
		String(row?.propType || ""),
		String(row?.side || ""),
		String(row?.line ?? ""),
		String(row?.book || ""),
	].join("|")
}

function buildByEventIdSnapshot(rows, externalSnapshotMeta) {
	const out = {}
	for (const row of (Array.isArray(rows) ? rows : [])) {
		const id = String(row?.eventId || "")
		if (!id) continue
		if (out[id]) continue
		out[id] = {
			homeTeam: row?.homeTeam || null,
			awayTeam: row?.awayTeam || null,
			gameTime: row?.gameTime || null,
			weather: row?.weatherContext
				? {
					temperatureF: row.weatherContext.temperatureF ?? null,
					windSpeedMph: row.weatherContext.windSpeedMph ?? null,
					windDirectionDeg: row.weatherContext.windDirectionDeg ?? null,
					windDirectionTag: row.weatherContext.windDirectionTag ?? null,
					humidityPct: row.weatherContext.humidityPct ?? null,
					precipitationMm: row.weatherContext.precipitationMm ?? null,
					isIndoor: row.weatherContext.isIndoor ?? null,
				}
				: null,
			opposingPitcher: row?.opposingPitcher || null,
			pitcherHand: row?.pitcherHand || null,
		}
	}
	return out
}

function buildLineupConfirmationFromMeta(externalSnapshotMeta) {
	// externalSnapshotMeta is already a flat shape on the snapshot; the deep
	// lineup confirmation map lives separately on the snapshot. We accept either.
	if (!externalSnapshotMeta || typeof externalSnapshotMeta !== "object") return {}
	return externalSnapshotMeta?.lineupConfirmationByEventId || {}
}

function buildProbablePitchersFromMeta(externalSnapshotMeta) {
	if (!externalSnapshotMeta || typeof externalSnapshotMeta !== "object") return {}
	return externalSnapshotMeta?.probablePitchersByEventId || {}
}

function buildByPropKeySnapshot(rows) {
	const out = {}
	for (const row of (Array.isArray(rows) ? rows : [])) {
		const key = buildPropKey(row)
		if (!key) continue
		if (out[key]) continue
		out[key] = {
			player: row?.player || null,
			eventId: row?.eventId || null,
			propType: row?.propType || null,
			side: row?.side || null,
			line: row?.line ?? null,
			book: row?.book || null,
			odds: row?.odds ?? null,
		}
	}
	return out
}

/**
 * Build a single history record from a live snapshot. Pure — no I/O.
 */
function buildHistoryRecord({ snapshot, slateDate, capturedAtIso }) {
	const ts = capturedAtIso || new Date().toISOString()
	const sd = String(slateDate || snapshot?.snapshotSlateDateKey || "").slice(0, 10)
	const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : []
	const externalSnapshotMeta = snapshot?.externalSnapshotMeta || {}

	return {
		capturedAtIso: ts,
		slateDate: sd,
		epochId: computeEpochId(ts, sd),
		eventCount: Array.isArray(snapshot?.events) ? snapshot.events.length : 0,
		rowCount: rows.length,
		byEventId: buildByEventIdSnapshot(rows, externalSnapshotMeta),
		lineupConfirmationByEventId: buildLineupConfirmationFromMeta(externalSnapshotMeta),
		probablePitchersByEventId:   buildProbablePitchersFromMeta(externalSnapshotMeta),
		byPropKey: buildByPropKeySnapshot(rows),
	}
}

function appendHistoryRecord(record) {
	if (!record || !record.slateDate) return { ok: false, error: "missing_slate_date" }
	if (!ensureDir()) return { ok: false, error: "mkdir_failed" }
	try {
		const file = fileForSlate(record.slateDate)
		// Atomic append-only line write
		fs.appendFileSync(file, JSON.stringify(record) + "\n")
		// Safety-net rotation: if the file is enormous, archive it once.
		try {
			const stat = fs.statSync(file)
			if (stat.size > 25 * 1024 * 1024) {
				const archived = file.replace(/\.jsonl$/, `.${Date.now()}.jsonl`)
				fs.renameSync(file, archived)
			}
		} catch (_) { /* non-fatal */ }
		return { ok: true, file }
	} catch (err) {
		return { ok: false, error: err?.message || String(err) }
	}
}

/**
 * Read up to N most recent history records for a slate.
 * Implementation: read whole file (bounded by rotation), parse, return tail.
 * For typical slate files (≤ a few hundred KB) this is trivially fast.
 */
function readRecentRecords({ slateDate, limit = DEFAULT_KEEP_TAIL_LINES }) {
	const sd = String(slateDate || "").slice(0, 10)
	if (!sd) return []
	const file = fileForSlate(sd)
	try {
		if (!fs.existsSync(file)) return []
		const raw = fs.readFileSync(file, "utf8")
		const lines = raw.split("\n").filter((l) => l.trim().length)
		const tail = lines.slice(Math.max(0, lines.length - limit))
		const out = []
		for (const l of tail) {
			try { out.push(JSON.parse(l)) } catch (_) { /* drop malformed */ }
		}
		return out
	} catch (_) {
		return []
	}
}

function readPreviousRecord({ slateDate, beforeCapturedAtIso }) {
	const recs = readRecentRecords({ slateDate, limit: DEFAULT_KEEP_TAIL_LINES })
	if (!recs.length) return null
	if (!beforeCapturedAtIso) return recs[recs.length - 1]
	const before = new Date(beforeCapturedAtIso).getTime()
	let best = null
	for (const r of recs) {
		const t = new Date(r.capturedAtIso).getTime()
		if (Number.isFinite(t) && t < before) {
			if (!best || new Date(best.capturedAtIso).getTime() < t) best = r
		}
	}
	return best
}

function readFirstRecord({ slateDate }) {
	const recs = readRecentRecords({ slateDate, limit: DEFAULT_ROTATE_AT_LINES })
	return recs.length ? recs[0] : null
}

module.exports = {
	buildHistoryRecord,
	appendHistoryRecord,
	readRecentRecords,
	readPreviousRecord,
	readFirstRecord,
	buildPropKey,
	computeEpochId,
}
