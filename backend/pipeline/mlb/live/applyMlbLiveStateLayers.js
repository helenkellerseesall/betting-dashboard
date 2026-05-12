"use strict"

/**
 * MLB Phase 2 — Live State Coordinator + Apply
 *
 * Single entry point. Coordinates the Phase 2 live-state derivers and
 * (optionally) the in-progress bullpen fetcher. Reads prior history (no
 * network); fetches in-progress bullpen state if not gated off. Attaches
 * `mlbLiveState` to each row purely additively. Never mutates existing
 * contextual fields or row identity.
 *
 * Inputs:
 *   rows                            — current bootstrap rows (post-Phase 1B)
 *   events                          — slate events
 *   externalSnapshotDeep            — full snapshot from fetchMlbExternalSnapshot
 *                                     (we read lineupConfirmationByEventId,
 *                                      probablePitchersByEventId, playersByEventId)
 *   pitcherStatsByName              — Phase 1B map (for opener heuristics)
 *   bullpenByTeam                   — Phase 1B baseline
 *   slateDate                       — YYYY-MM-DD
 *   capturedAtIso                   — observation timestamp (defaults to now)
 *   skipBullpenLive                 — bypass the live bullpen fetch
 *
 * Architectural rules honored:
 *   - Additive only — adds row.mlbLiveState; never overwrites
 *   - Immutability — history records are append-only; we read only
 *   - Future-only slate integrity — operates only on the rows we are given
 *   - Fail-open — every block wrapped in try/catch; partial output is fine
 *   - No runaway polling — runs once per call; no timers
 */

const { deriveMlbConfirmedLineupState }     = require("./deriveMlbConfirmedLineupState")
const { deriveMlbStarterConfirmationState } = require("./deriveMlbStarterConfirmationState")
const { deriveMlbLineMovementState }        = require("./deriveMlbLineMovementState")
const { deriveMlbLiveWeatherDelta }         = require("./deriveMlbLiveWeatherDelta")
const { refreshMlbLiveBullpenState }        = require("./refreshMlbLiveBullpenState")
const {
	buildHistoryRecord, appendHistoryRecord, readRecentRecords,
} = require("./mlbLiveStateHistory")

function isPitcherRow(row) {
	const fam = String(row?.marketFamily || "").toLowerCase()
	const mk = String(row?.marketKey || "").toLowerCase()
	if (fam === "pitcher" || fam === "pitching") return true
	if (mk.startsWith("pitcher_")) return true
	return false
}

function teamKey(s) { return String(s || "").trim().toLowerCase() }

function gameTimeForEvent(events, eventId) {
	if (!Array.isArray(events)) return null
	const target = String(eventId || "")
	for (const e of events) {
		const id = String(e?.eventId || e?.id || "")
		if (id === target) return e?.gameTime || e?.commenceTime || e?.commence_time || null
	}
	return null
}

function buildTagsFromLiveState({ lineup, starter, lineMovement, bullpenLive, weatherDelta }) {
	const tags = []
	if (lineup?.scratched === true)         tags.push("LINEUP_SCRATCHED")
	if (lineup?.lateSwap === true)          tags.push("LINEUP_LATE_SWAP")
	if (lineup?.lineupSpotChanged === true) tags.push("LINEUP_SPOT_CHANGED")
	if (lineup?.confirmedForRow === true)   tags.push("LINEUP_CONFIRMED")

	if (starter?.changeType === "scratch")          tags.push("STARTER_SCRATCHED")
	if (starter?.changeType === "opener_pivot")     tags.push("OPENER_PIVOT")
	if (starter?.changeType === "emergency_callup") tags.push("EMERGENCY_CALLUP")

	if (lineMovement?.steamFlag === true)               tags.push("STEAM_MOVE")
	if (lineMovement?.directionTag === "tightening")    tags.push("LINE_TIGHTENING")
	if (lineMovement?.directionTag === "drifting_out")  tags.push("LINE_DRIFTING_OUT")

	if (bullpenLive?.exhaustionFlag === true)           tags.push("BULLPEN_EXHAUSTED_LIVE")
	if (bullpenLive?.extraInningsRecentlyPlayed === true) tags.push("BULLPEN_EXTRA_INNINGS_FATIGUE")

	if (weatherDelta?.materialShift === true)           tags.push("WEATHER_MATERIAL_SHIFT")
	if (weatherDelta?.rainStarted === true)             tags.push("RAIN_STARTED")
	if (weatherDelta?.rainStopped === true)             tags.push("RAIN_STOPPED")
	if (weatherDelta?.windDirectionChanged === true)    tags.push("WIND_DIRECTION_CHANGED")
	return tags
}

async function applyMlbLiveStateLayers(args = {}) {
	const {
		rows,
		events,
		externalSnapshotDeep,
		pitcherStatsByName,
		bullpenByTeam,
		slateDate,
		capturedAtIso,
		skipBullpenLive = false,
		skipHistoryAppend = false,
	} = args

	const ts = capturedAtIso || new Date().toISOString()
	const safeRows = Array.isArray(rows) ? rows : []

	const diagnostics = {
		phase: "mlb-phase-2-live-state-v1",
		capturedAtIso: ts,
		slateDate: slateDate || null,
		rowsProcessed: 0,
		rowsSkippedPitcher: 0,
		layers: {
			lineupDerived: 0,
			starterDerived: 0,
			lineMovementDerived: 0,
			lineMovementWithPriors: 0,
			weatherDeltaDerived: 0,
			weatherDeltaMaterial: 0,
			bullpenLiveAttached: 0,
		},
		tagCounts: {},
		historyRecordsRead: 0,
		historyAppended: false,
		liveBullpenDiagnostics: null,
		errors: [],
	}

	// 1. Read history once (bounded; pure I/O)
	let historyRecords = []
	try {
		historyRecords = readRecentRecords({ slateDate, limit: 40 })
		diagnostics.historyRecordsRead = historyRecords.length
	} catch (e) {
		diagnostics.errors.push({ stage: "read_history", message: e?.message || String(e) })
	}

	// 2. Phase 1B bullpen baseline + Phase 2 live augmentation (fail-open)
	let liveBullpenByTeam = {}
	if (!skipBullpenLive) {
		try {
			const live = await refreshMlbLiveBullpenState({
				events, baselineBullpenByTeam: bullpenByTeam,
			})
			liveBullpenByTeam = live?.liveBullpenByTeam || {}
			diagnostics.liveBullpenDiagnostics = live?.diagnostics || null
		} catch (e) {
			diagnostics.errors.push({ stage: "bullpen_live", message: e?.message || String(e) })
		}
	} else {
		diagnostics.liveBullpenDiagnostics = { skipped: true }
	}

	// 3. Extract current confirmation/probable maps from snapshot
	const curLineupConfirmation = externalSnapshotDeep?.lineupConfirmationByEventId || {}
	const curProbablePitchers   = externalSnapshotDeep?.probablePitchersByEventId   || {}
	const curLineupsByEventId   = externalSnapshotDeep?.playersByEventId            || {}

	// 4. Roll up "previous" maps from the most-recent prior history record
	const prevRecord = historyRecords.length ? historyRecords[historyRecords.length - 1] : null
	const prevLineupConfirmation = prevRecord?.lineupConfirmationByEventId || {}
	const prevProbablePitchers   = prevRecord?.probablePitchersByEventId   || {}
	const prevLineupsByEventId   = {} // pure deltas use the per-record byEventId we don't persist
	// (we don't currently persist players-by-event in history; this stays empty → lineup spot deltas use confirmation only)

	// 5. Derive per-row
	const enriched = safeRows.map((row) => {
		diagnostics.rowsProcessed += 1

		const eventId = String(row?.eventId || "")
		const gameTimeIso = gameTimeForEvent(events, eventId)

		// Lineup state — skipped for pitcher rows
		let lineup = null
		if (isPitcherRow(row)) {
			diagnostics.rowsSkippedPitcher += 1
		} else {
			try {
				lineup = deriveMlbConfirmedLineupState(row, {
					currentLineupConfirmationByEventId:  curLineupConfirmation,
					previousLineupConfirmationByEventId: prevLineupConfirmation,
					currentLineupsByEventId:             curLineupsByEventId,
					previousLineupsByEventId:            prevLineupsByEventId,
					gameTimeIso,
					nowMs: Date.now(),
				})
				if (lineup) diagnostics.layers.lineupDerived += 1
			} catch (e) {
				diagnostics.errors.push({ stage: "lineup", message: e?.message || String(e) })
			}
		}

		// Starter confirmation
		let starter = null
		try {
			starter = deriveMlbStarterConfirmationState(row, {
				currentProbablePitchersByEventId:  curProbablePitchers,
				previousProbablePitchersByEventId: prevProbablePitchers,
				pitcherStatsByName,
			})
			if (starter) diagnostics.layers.starterDerived += 1
		} catch (e) {
			diagnostics.errors.push({ stage: "starter", message: e?.message || String(e) })
		}

		// Line movement
		let lineMovement = null
		try {
			lineMovement = deriveMlbLineMovementState(row, {
				historyRecords,
				currentCapturedAtIso: ts,
			})
			if (lineMovement) {
				diagnostics.layers.lineMovementDerived += 1
				if (lineMovement.observationCount > 0) diagnostics.layers.lineMovementWithPriors += 1
			}
		} catch (e) {
			diagnostics.errors.push({ stage: "line_movement", message: e?.message || String(e) })
		}

		// Weather delta
		let weatherDelta = null
		try {
			weatherDelta = deriveMlbLiveWeatherDelta(row, { historyRecords, capturedAtIso: ts })
			if (weatherDelta) {
				diagnostics.layers.weatherDeltaDerived += 1
				if (weatherDelta.materialShift) diagnostics.layers.weatherDeltaMaterial += 1
			}
		} catch (e) {
			diagnostics.errors.push({ stage: "weather_delta", message: e?.message || String(e) })
		}

		// Bullpen live (per team)
		let bullpenLive = null
		const opp = isPitcherRow(row) ? null : (row?.opponentTeam || null)
		if (opp) {
			const k = teamKey(opp)
			if (liveBullpenByTeam[k]) {
				bullpenLive = liveBullpenByTeam[k]
				diagnostics.layers.bullpenLiveAttached += 1
			}
		}

		const tags = buildTagsFromLiveState({ lineup, starter, lineMovement, bullpenLive, weatherDelta })
		for (const t of tags) diagnostics.tagCounts[t] = (diagnostics.tagCounts[t] || 0) + 1

		const hasAnyLive = !!(
			(lineup && (lineup.scratched === true || lineup.lineupSpotChanged === true || lineup.confirmedForRow === true)) ||
			(starter && (starter.changeType || starter.pitcherChanged === true)) ||
			(lineMovement && lineMovement.observationCount > 0) ||
			(weatherDelta && weatherDelta.materialShift === true) ||
			bullpenLive
		)

		return {
			...row,
			mlbLiveState: {
				capturedAt: ts,
				lineup,
				starter,
				lineMovement,
				bullpenLive,
				weatherDelta,
				tags,
				hasAnyLive,
			},
		}
	})

	// 6. Append a new history record (additive, immutable). Captures the
	//    POST-Phase-1B snapshot view; the next refresh will compare against it.
	let historyResult = null
	if (!skipHistoryAppend) {
		try {
			const record = buildHistoryRecord({
				snapshot: {
					rows: safeRows,
					events,
					externalSnapshotMeta: {
						lineupConfirmationByEventId: curLineupConfirmation,
						probablePitchersByEventId:   curProbablePitchers,
					},
					snapshotSlateDateKey: slateDate,
				},
				slateDate,
				capturedAtIso: ts,
			})
			historyResult = appendHistoryRecord(record)
			diagnostics.historyAppended = !!historyResult?.ok
			if (!historyResult?.ok) {
				diagnostics.errors.push({ stage: "history_append", message: historyResult?.error || "unknown" })
			}
		} catch (e) {
			diagnostics.errors.push({ stage: "history_append", message: e?.message || String(e) })
		}
	} else {
		diagnostics.historyAppended = false
	}

	console.log("[MLB-LIVE-STATE-PHASE-2]", {
		capturedAt: ts,
		rows: diagnostics.rowsProcessed,
		historyRecordsRead: diagnostics.historyRecordsRead,
		lineupDerived: diagnostics.layers.lineupDerived,
		starterDerived: diagnostics.layers.starterDerived,
		lineMovementWithPriors: diagnostics.layers.lineMovementWithPriors,
		weatherDeltaMaterial: diagnostics.layers.weatherDeltaMaterial,
		bullpenLiveAttached: diagnostics.layers.bullpenLiveAttached,
		topTags: Object.entries(diagnostics.tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
		historyAppended: diagnostics.historyAppended,
	})

	return { rows: enriched, diagnostics }
}

module.exports = { applyMlbLiveStateLayers }
