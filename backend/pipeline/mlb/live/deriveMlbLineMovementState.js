"use strict"

/**
 * MLB Phase 2 — Line Movement / Closing-Line Drift Derivation
 *
 * Pure function. Reads:
 *   currentRow.odds, currentRow.line
 *   previousRecords[*].byPropKey[propKey] (from history; one record per refresh)
 *
 * Output (per row):
 *   {
 *     observationCount,            // how many prior observations exist for this propKey
 *     openOdds, openLine,          // earliest observed in window
 *     currentOdds, currentLine,
 *     oddsDriftAmerican,           // current - open  (American odds units)
 *     lineDrift,                   // numeric line drift
 *     impliedOpen, impliedCurrent,
 *     impliedDriftPct,             // (current - open) / open
 *     steamFlag,                   // movement > 4% in <= 30 min
 *     directionTag,                // "tightening" | "drifting_out" | "stable" | null
 *     firstObservedAt,
 *     latestObservedAt,
 *     source,
 *   }
 *
 * Truthful nulls when no prior history exists. Magnitudes bounded — no
 * fabricated values.
 */

const { buildPropKey } = require("./mlbLiveStateHistory")

function impliedFromAmerican(o) {
	const n = Number(o)
	if (!Number.isFinite(n) || n === 0) return null
	return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

function classifyDirection(impliedDriftPct) {
	if (impliedDriftPct == null) return null
	if (Math.abs(impliedDriftPct) < 0.005) return "stable"
	return impliedDriftPct > 0 ? "tightening" : "drifting_out"
}

function deriveMlbLineMovementState(row, { historyRecords, currentCapturedAtIso } = {}) {
	if (!row) return null
	const propKey = buildPropKey(row)
	if (!propKey) return null

	const recs = Array.isArray(historyRecords) ? historyRecords : []
	const priors = []
	for (const r of recs) {
		const entry = r?.byPropKey?.[propKey]
		if (!entry) continue
		const odds = Number(entry.odds)
		if (!Number.isFinite(odds)) continue
		priors.push({
			capturedAtIso: r.capturedAtIso,
			odds,
			line: Number.isFinite(Number(entry.line)) ? Number(entry.line) : null,
		})
	}

	if (priors.length === 0) {
		return {
			observationCount: 0,
			openOdds: null, openLine: null,
			currentOdds: Number.isFinite(Number(row?.odds)) ? Number(row.odds) : null,
			currentLine: Number.isFinite(Number(row?.line)) ? Number(row.line) : null,
			oddsDriftAmerican: null, lineDrift: null,
			impliedOpen: null, impliedCurrent: null,
			impliedDriftPct: null, steamFlag: null,
			directionTag: null,
			firstObservedAt: null, latestObservedAt: null,
			source: "no_history",
		}
	}

	priors.sort((a, b) => new Date(a.capturedAtIso) - new Date(b.capturedAtIso))
	const open = priors[0]
	const latest = priors[priors.length - 1]
	const currentOdds = Number.isFinite(Number(row?.odds)) ? Number(row.odds) : latest.odds
	const currentLine = Number.isFinite(Number(row?.line)) ? Number(row.line) : latest.line

	const impliedOpen = impliedFromAmerican(open.odds)
	const impliedCurrent = impliedFromAmerican(currentOdds)
	const impliedDriftPct = (impliedOpen != null && impliedCurrent != null && impliedOpen > 0)
		? (impliedCurrent - impliedOpen) / impliedOpen
		: null

	const oddsDriftAmerican = currentOdds - open.odds
	const lineDrift = (currentLine != null && open.line != null) ? Number((currentLine - open.line).toFixed(2)) : null

	// Steam flag: > 4% implied move within the last 30 minutes against an earlier observation.
	let steamFlag = false
	if (impliedCurrent != null) {
		const cutoff = new Date(currentCapturedAtIso || new Date().toISOString()).getTime() - 30 * 60 * 1000
		for (const p of priors) {
			const t = new Date(p.capturedAtIso).getTime()
			if (!Number.isFinite(t) || t < cutoff) continue
			const ip = impliedFromAmerican(p.odds)
			if (ip == null || ip <= 0) continue
			const recentDriftPct = (impliedCurrent - ip) / ip
			if (Math.abs(recentDriftPct) >= 0.04) { steamFlag = true; break }
		}
	}

	return {
		observationCount: priors.length,
		openOdds: open.odds,
		openLine: open.line,
		currentOdds,
		currentLine,
		oddsDriftAmerican,
		lineDrift,
		impliedOpen: impliedOpen != null ? Number(impliedOpen.toFixed(4)) : null,
		impliedCurrent: impliedCurrent != null ? Number(impliedCurrent.toFixed(4)) : null,
		impliedDriftPct: impliedDriftPct != null ? Number(impliedDriftPct.toFixed(4)) : null,
		steamFlag,
		directionTag: classifyDirection(impliedDriftPct),
		firstObservedAt: open.capturedAtIso,
		latestObservedAt: latest.capturedAtIso,
		source: "snapshot_history",
	}
}

module.exports = { deriveMlbLineMovementState, impliedFromAmerican }
