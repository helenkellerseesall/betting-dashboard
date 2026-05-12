"use strict"

/**
 * MLB Phase 2 — Confirmed Lineup State Derivation (per-row)
 *
 * Pure function. Reads:
 *   row.eventId, row.player, row.lineupPosition, row.playerIdExternal
 *   currentLineupConfirmation map (from snapshot externalSnapshotMeta —
 *     comes from fetchMlbOfficialLineupsSnapshot)
 *   previousLineupConfirmation map (from prior history record)
 *   currentLineupsByEventId map → list of {playerName, playerKey, batterHand,
 *     battingOrderIndex, ...}
 *   previousLineupsByEventId map (same shape from prior history)
 *
 * Output (per row, batter rows only — pitcher rows skipped):
 *   {
 *     awayConfirmed, homeConfirmed,
 *     confirmedForRow,             // true when row.lineupPosition is present
 *                                  // AND the row.player appears in the live lineup
 *     currentLineupSpot,           // from row.lineupPosition (already enriched)
 *     previousLineupSpot,
 *     lineupSpotChanged,           // current ≠ previous AND both non-null
 *     scratched,                   // row.lineupPosition is null but the player
 *                                  // appeared in the PREVIOUS lineup
 *     lateSwap,                    // lineup confirmed but spot moved within 60min
 *                                  // of game time (heuristic)
 *     source,
 *   }
 *
 * Truthful nulls: when previous-state is unavailable (first ingest), delta
 * fields are null rather than false-positives. Never fabricates.
 */

function normalizeName(s) {
	return String(s || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z\s'-]/g, "")
		.replace(/\s+/g, " ")
		.trim()
}

function isPitcherRow(row) {
	const fam = String(row?.marketFamily || "").toLowerCase()
	const mk = String(row?.marketKey || "").toLowerCase()
	if (fam === "pitcher" || fam === "pitching") return true
	if (mk.startsWith("pitcher_")) return true
	return false
}

function findPlayerInLineup(lineupList, rowPlayerKey, rowPlayerName) {
	if (!Array.isArray(lineupList)) return null
	const keyTarget = String(rowPlayerKey || "").trim().toLowerCase()
	const nameTarget = normalizeName(rowPlayerName)
	for (const p of lineupList) {
		const pk = String(p?.playerKey || "").trim().toLowerCase()
		const pn = normalizeName(p?.playerName)
		if ((keyTarget && pk === keyTarget) || (nameTarget && pn === nameTarget)) return p
	}
	return null
}

function minutesUntil(gameTimeIso, nowMs) {
	if (!gameTimeIso) return null
	const gt = new Date(gameTimeIso).getTime()
	if (!Number.isFinite(gt)) return null
	return Math.round((gt - (nowMs || Date.now())) / 60000)
}

function deriveMlbConfirmedLineupState(row, {
	currentLineupConfirmationByEventId,
	previousLineupConfirmationByEventId,
	currentLineupsByEventId,
	previousLineupsByEventId,
	gameTimeIso,
	nowMs,
} = {}) {
	if (!row) return null
	if (isPitcherRow(row)) {
		return {
			awayConfirmed: null,
			homeConfirmed: null,
			confirmedForRow: null,
			currentLineupSpot: null,
			previousLineupSpot: null,
			lineupSpotChanged: null,
			scratched: null,
			lateSwap: null,
			source: "skipped_pitcher_prop",
		}
	}

	const eventId = String(row?.eventId || "")
	if (!eventId) return null

	const curConfirm = currentLineupConfirmationByEventId?.[eventId] || null
	const prevConfirm = previousLineupConfirmationByEventId?.[eventId] || null

	const curList = currentLineupsByEventId?.[eventId] || null
	const prevList = previousLineupsByEventId?.[eventId] || null

	const curEntry = findPlayerInLineup(curList, row?.playerKey, row?.player)
	const prevEntry = findPlayerInLineup(prevList, row?.playerKey, row?.player)

	const currentLineupSpot = Number(row?.lineupPosition ?? curEntry?.battingOrderIndex ?? null)
	const previousLineupSpot = Number(prevEntry?.battingOrderIndex ?? null)
	const curSpotOk = Number.isFinite(currentLineupSpot) && currentLineupSpot >= 1 && currentLineupSpot <= 9
	const prevSpotOk = Number.isFinite(previousLineupSpot) && previousLineupSpot >= 1 && previousLineupSpot <= 9

	const awayConfirmed = curConfirm?.awayConfirmed === true ? true
		: curConfirm?.awayConfirmed === false ? false : null
	const homeConfirmed = curConfirm?.homeConfirmed === true ? true
		: curConfirm?.homeConfirmed === false ? false : null

	// "confirmedForRow": this player appears in a confirmed batting order today.
	const confirmedForRow = !!curEntry

	// "scratched": player was in previous lineup, but current lineup is confirmed
	// AND this player is not in it (or has no spot in the row).
	let scratched = null
	if (prevEntry && curList && (awayConfirmed === true || homeConfirmed === true)) {
		scratched = !curEntry
	}

	const lineupSpotChanged = (curSpotOk && prevSpotOk) ? currentLineupSpot !== previousLineupSpot : null

	// "lateSwap": spot changed within 60 min of game start.
	const minsUntil = minutesUntil(gameTimeIso, nowMs)
	const lateSwap = (lineupSpotChanged === true && minsUntil != null && minsUntil <= 60 && minsUntil >= -15) ? true : null

	return {
		awayConfirmed,
		homeConfirmed,
		confirmedForRow,
		currentLineupSpot: curSpotOk ? currentLineupSpot : null,
		previousLineupSpot: prevSpotOk ? previousLineupSpot : null,
		lineupSpotChanged,
		scratched,
		lateSwap,
		source: prevList ? "live_vs_history" : "live_only",
	}
}

module.exports = { deriveMlbConfirmedLineupState, findPlayerInLineup, normalizeName }
