"use strict"

/**
 * MLB Phase 2 — Starter Confirmation / Scratch Detection (per-row)
 *
 * Pure function. Diffs current probable-pitcher state against the prior
 * history record. Useful for detecting:
 *   - scratch: probable becomes null (or different name) close to first pitch
 *   - opener_pivot: probable confirmed but expected to throw only 1-2 IP
 *     (Phase 2 heuristic: low season inningsPitched relative to gamesPitched)
 *   - emergency_callup: probable replaced; new pitcher has very low
 *     career inningsPitched (under 20) — proxy for callup
 *
 * Inputs:
 *   row.eventId, row.player (when pitcher prop), row.opposingPitcher (batter prop)
 *   row.isHome (used to pick side from probable map)
 *   currentProbablePitchersByEventId    (from snapshot externalSnapshotMeta)
 *   previousProbablePitchersByEventId   (from prior history)
 *   pitcherStatsByName                  (Phase 1B map; optional for openerHeuristic)
 *
 * Output (shape-stable; honest nulls when no history available):
 *   {
 *     pitcherName,
 *     previousPitcher,
 *     pitcherChanged,
 *     changeType,                  // null | "scratch" | "opener_pivot" | "emergency_callup"
 *     confidence,                  // "low" | "medium" | "high"
 *     reasonCodes: [],             // e.g. ["NAME_MISMATCH", "LOW_IP_NEW_PITCHER"]
 *     source,
 *   }
 */

const { normalizeName } = require("./deriveMlbConfirmedLineupState")

function isPitcherRow(row) {
	const fam = String(row?.marketFamily || "").toLowerCase()
	const mk = String(row?.marketKey || "").toLowerCase()
	if (fam === "pitcher" || fam === "pitching") return true
	if (mk.startsWith("pitcher_")) return true
	return false
}

function pickProbableSide(row, probables) {
	if (!probables || typeof probables !== "object") return null
	// For pitcher props, we want THE pitcher of the row's team.
	// For batter props, we want the OPPOSING pitcher.
	if (isPitcherRow(row)) {
		if (row?.isHome === true) return probables?.home || null
		if (row?.isHome === false) return probables?.away || null
		// Fallback: try to match by name to either side.
		const target = normalizeName(row?.player)
		if (target && normalizeName(probables?.home?.playerName) === target) return probables.home
		if (target && normalizeName(probables?.away?.playerName) === target) return probables.away
		return null
	}
	if (row?.isHome === true) return probables?.away || null  // opposing
	if (row?.isHome === false) return probables?.home || null
	const target = normalizeName(row?.opposingPitcher)
	if (target && normalizeName(probables?.home?.playerName) === target) return probables.home
	if (target && normalizeName(probables?.away?.playerName) === target) return probables.away
	return null
}

function lookupPitcherStatsByName(map, name) {
	if (!map || typeof map !== "object") return null
	const target = normalizeName(name)
	if (!target) return null
	if (map[target]) return map[target]
	for (const k of Object.keys(map)) {
		if (normalizeName(k) === target) return map[k]
	}
	return null
}

function inferChangeType({ currentName, previousName, pitcherStatsByName }) {
	const cur = normalizeName(currentName)
	const prev = normalizeName(previousName)
	const reasonCodes = []

	if (!prev) return { changeType: null, reasonCodes, confidence: "low" }

	if (prev && !cur) {
		reasonCodes.push("PROBABLE_REMOVED")
		return { changeType: "scratch", reasonCodes, confidence: "medium" }
	}

	if (prev && cur && prev !== cur) {
		reasonCodes.push("NAME_MISMATCH")
		const newStats = lookupPitcherStatsByName(pitcherStatsByName, currentName)
		const newIp = Number(newStats?.inningsPitched)
		if (Number.isFinite(newIp) && newIp < 20) {
			reasonCodes.push("LOW_IP_NEW_PITCHER")
			return { changeType: "emergency_callup", reasonCodes, confidence: "high" }
		}
		return { changeType: "scratch", reasonCodes, confidence: "high" }
	}

	// Same name — opener pivot check. Heuristic: a pitcher with gamesStarted = 0
	// but gamesPitched > 0 in season → opener role.
	const curStats = lookupPitcherStatsByName(pitcherStatsByName, currentName)
	if (curStats) {
		const gp = Number(curStats?.gamesPitched)
		const gs = Number(curStats?.gamesStarted)
		if (Number.isFinite(gp) && Number.isFinite(gs) && gp > 0 && gs === 0) {
			reasonCodes.push("OPENER_ROLE_HEURISTIC")
			return { changeType: "opener_pivot", reasonCodes, confidence: "medium" }
		}
	}

	return { changeType: null, reasonCodes, confidence: "low" }
}

function deriveMlbStarterConfirmationState(row, {
	currentProbablePitchersByEventId,
	previousProbablePitchersByEventId,
	pitcherStatsByName,
} = {}) {
	if (!row) return null
	const eventId = String(row?.eventId || "")
	if (!eventId) return null

	const curMap = currentProbablePitchersByEventId?.[eventId] || null
	const prevMap = previousProbablePitchersByEventId?.[eventId] || null
	if (!curMap && !prevMap) return null

	const curSide = pickProbableSide(row, curMap)
	const prevSide = pickProbableSide(row, prevMap)

	const currentName = curSide?.playerName || null
	const previousName = prevSide?.playerName || null
	const pitcherChanged = (currentName && previousName)
		? normalizeName(currentName) !== normalizeName(previousName)
		: (!!previousName && !currentName) ? true
		: null

	const inference = inferChangeType({ currentName, previousName, pitcherStatsByName })

	return {
		pitcherName: currentName,
		previousPitcher: previousName,
		pitcherChanged,
		changeType: inference.changeType,
		confidence: inference.confidence,
		reasonCodes: inference.reasonCodes,
		source: prevMap ? "live_vs_history" : "live_only",
	}
}

module.exports = { deriveMlbStarterConfirmationState, inferChangeType }
