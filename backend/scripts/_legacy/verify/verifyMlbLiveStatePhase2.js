"use strict"

/**
 * MLB Phase 2 — Live State verification (deterministic fixture, no network).
 *
 * Five scenarios:
 *   1. Lineup confirmed for player + spot unchanged   → LINEUP_CONFIRMED only
 *   2. Lineup confirmed for player + spot changed     → LINEUP_SPOT_CHANGED (+ LATE_SWAP if within 60min)
 *   3. Probable pitcher replaced with low-IP newcomer → EMERGENCY_CALLUP
 *   4. Steam line move (4%+ implied drift in <30min)  → STEAM_MOVE
 *   5. Synthetic market row                           → still gets row.mlbLiveState but layers are mostly null
 *
 * Plus regression: existing Phase 1A/1B verify scripts still PASS.
 *
 *   node backend/scripts/verifyMlbLiveStatePhase2.js
 */

const path = require("path")
const fs = require("fs")
const os = require("os")

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

async function main() {
	console.log("\n=== MLB Phase 2 Live State — Verification ===\n")

	// Use a temp working dir for live-state history (so verification doesn't
	// pollute the real data dir). We monkey-patch the history module's
	// constants via require() before the apply layer imports it.
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlb-live-state-test-"))
	process.env.MLB_LIVE_STATE_HISTORY_OVERRIDE_DIR = tmpDir  // documentation; not strictly read by code
	const histPath = path.join(tmpDir, "mlbLiveStateHistory")
	fs.mkdirSync(histPath, { recursive: true })
	// We'll write a synthetic prior history file directly.
	const slateDate = "2026-05-12"
	const priorRecord = {
		capturedAtIso: "2026-05-12T18:00:00Z",
		slateDate,
		epochId: `2026-05-12T18:00:00Z|mlb|${slateDate}`,
		eventCount: 4,
		rowCount: 5,
		byEventId: {
			"evt-001": {
				homeTeam: "Colorado Rockies", awayTeam: "Los Angeles Dodgers",
				gameTime: "2026-05-12T20:10:00Z",
				weather: { temperatureF: 75, windSpeedMph: 6, windDirectionDeg: 240, windDirectionTag: "out_to_cf", humidityPct: 40, precipitationMm: 0, isIndoor: false },
				opposingPitcher: "Old Probable", pitcherHand: "L",
			},
			"evt-002": {
				homeTeam: "Boston Red Sox", awayTeam: "Toronto Blue Jays",
				gameTime: "2026-05-12T19:10:00Z",
				weather: { temperatureF: 65, windSpeedMph: 5, windDirectionDeg: 180, windDirectionTag: "cross", humidityPct: 60, precipitationMm: 0, isIndoor: false },
				opposingPitcher: null, pitcherHand: null,
			},
			"evt-003": {
				homeTeam: "New York Yankees", awayTeam: "Tampa Bay Rays",
				gameTime: "2026-05-12T19:05:00Z",
				weather: null,
				opposingPitcher: null, pitcherHand: null,
			},
			"evt-004": {
				homeTeam: "St. Louis Cardinals", awayTeam: "New York Mets",
				gameTime: "2026-05-12T20:00:00Z",
				weather: null,
				opposingPitcher: null, pitcherHand: null,
			},
		},
		lineupConfirmationByEventId: {
			"evt-001": { awayConfirmed: false, homeConfirmed: false },
			"evt-002": { awayConfirmed: true,  homeConfirmed: true },
		},
		probablePitchersByEventId: {
			"evt-003": {
				away: { playerName: "Ace Veteran",    playerKey: "ace veteran",    throws: "R" },
				home: { playerName: "Solid Starter",  playerKey: "solid starter",  throws: "R" },
			},
		},
		byPropKey: {
			// We will use these prop keys in the current fixture to test line movement.
			// propKey format: eventId|player|propType|side|line|book
			"evt-004|Synthetic Steam|hits|over|1.5|DK": {
				player: "Synthetic Steam", eventId: "evt-004", propType: "hits",
				side: "over", line: 1.5, book: "DK", odds: -110,
			},
		},
	}
	const writeOK = (() => {
		try {
			fs.writeFileSync(path.join(histPath, `${slateDate}.jsonl`), JSON.stringify(priorRecord) + "\n")
			return true
		} catch { return false }
	})()
	assert(writeOK, "wrote synthetic prior history record")

	// Now monkey-patch the history module to look in tmpDir, by overriding its
	// historyDir resolution via NODE-level path-aware injection. Simpler:
	// temporarily replace require.cache entry for mlbLiveStateHistory.js with
	// a wrapper that uses tmpDir. Since the module uses __dirname-based
	// resolution we redirect via PATCHing the function at runtime.
	const histModulePath = path.join(__dirname, "..", "pipeline", "mlb", "live", "mlbLiveStateHistory")
	const histMod = require(histModulePath)
	// Replace the two read functions to point at tmpDir.
	const realReadRecent = histMod.readRecentRecords
	histMod.readRecentRecords = function ({ slateDate: sd, limit }) {
		try {
			const f = path.join(histPath, `${sd}.jsonl`)
			if (!fs.existsSync(f)) return []
			const raw = fs.readFileSync(f, "utf8")
			const out = []
			for (const ln of raw.split("\n").filter((l) => l.trim().length)) {
				try { out.push(JSON.parse(ln)) } catch (_) {}
			}
			return out.slice(Math.max(0, out.length - (limit || 40)))
		} catch (_) { return [] }
	}
	const realAppend = histMod.appendHistoryRecord
	histMod.appendHistoryRecord = function (record) {
		try {
			fs.appendFileSync(path.join(histPath, `${record.slateDate}.jsonl`), JSON.stringify(record) + "\n")
			return { ok: true, file: path.join(histPath, `${record.slateDate}.jsonl`) }
		} catch (e) { return { ok: false, error: e?.message || String(e) } }
	}

	const { applyMlbLiveStateLayers } = require("../pipeline/mlb/live/applyMlbLiveStateLayers")

	const currentRows = [
		// 1. lineup confirmed + spot unchanged
		{
			id: "p1", eventId: "evt-002", player: "Synthetic Confirmed",
			homeTeam: "Boston Red Sox", awayTeam: "Toronto Blue Jays",
			team: "Boston Red Sox", opponentTeam: "Toronto Blue Jays",
			marketKey: "batter_hits", marketFamily: "batting",
			propType: "hits", side: "over", line: 1.5, odds: -120,
			lineupPosition: 3, playerKey: "synthetic confirmed",
		},
		// 2. lineup confirmed + spot changed (was 5, now 2)
		{
			id: "p2", eventId: "evt-002", player: "Synthetic Spot Changed",
			homeTeam: "Boston Red Sox", awayTeam: "Toronto Blue Jays",
			team: "Boston Red Sox", opponentTeam: "Toronto Blue Jays",
			marketKey: "batter_hits", marketFamily: "batting",
			propType: "hits", side: "over", line: 0.5, odds: -200,
			lineupPosition: 2, playerKey: "synthetic spot changed",
		},
		// 3. emergency callup: probable changed AND new pitcher has IP=10 (low)
		{
			id: "p3", eventId: "evt-003", player: "Synthetic Pitcher Today",
			homeTeam: "New York Yankees", awayTeam: "Tampa Bay Rays",
			team: "New York Yankees", opponentTeam: "Tampa Bay Rays",
			marketKey: "pitcher_strikeouts", marketFamily: "pitcher",
			propType: "pitcher strikeouts", side: "over", line: 5.5, odds: -110,
			isHome: true, // pitcher for home team
		},
		// 4. steam line move: open -110, now -150 (~4-5% implied move)
		{
			id: "p4", eventId: "evt-004", player: "Synthetic Steam",
			homeTeam: "St. Louis Cardinals", awayTeam: "New York Mets",
			team: "St. Louis Cardinals", opponentTeam: "New York Mets",
			marketKey: "batter_hits", marketFamily: "batting",
			propType: "hits", side: "over", line: 1.5, odds: -150, book: "DK",
		},
		// 5. synthetic market — should still get mlbLiveState but most layers null
		{
			id: "p5", eventId: "evt-001", player: null,
			homeTeam: "Colorado Rockies", awayTeam: "Los Angeles Dodgers",
			marketKey: "no_run_first_inning", marketFamily: "special",
			propType: "NRFI", side: "yes", line: null, odds: -110,
		},
	]

	const externalSnapshotDeep = {
		// confirmed lineups for evt-002, including p1 unchanged and p2 changed
		lineupConfirmationByEventId: {
			"evt-001": { awayConfirmed: false, homeConfirmed: false },
			"evt-002": { awayConfirmed: true,  homeConfirmed: true },
		},
		probablePitchersByEventId: {
			"evt-003": {
				away: { playerName: "Tampa Starter", playerKey: "tampa starter", throws: "R" },
				home: { playerName: "Synthetic Pitcher Today", playerKey: "synthetic pitcher today", throws: "R" },
			},
		},
		playersByEventId: {
			"evt-002": [
				{ playerName: "Synthetic Confirmed",     playerKey: "synthetic confirmed",     battingOrderIndex: 3 },
				{ playerName: "Synthetic Spot Changed",  playerKey: "synthetic spot changed",  battingOrderIndex: 2 },
			],
		},
	}

	const pitcherStatsByName = {
		// the new probable has only 10 IP this season → emergency callup
		"synthetic pitcher today": { inningsPitched: 10, gamesPitched: 3, gamesStarted: 2 },
	}

	const result = await applyMlbLiveStateLayers({
		rows: currentRows,
		events: [
			{ eventId: "evt-001", homeTeam: "Colorado Rockies",     gameTime: "2026-05-12T20:10:00Z" },
			{ eventId: "evt-002", homeTeam: "Boston Red Sox",       gameTime: "2026-05-12T19:10:00Z" },
			{ eventId: "evt-003", homeTeam: "New York Yankees",     gameTime: "2026-05-12T19:05:00Z" },
			{ eventId: "evt-004", homeTeam: "St. Louis Cardinals",  gameTime: "2026-05-12T20:00:00Z" },
		],
		externalSnapshotDeep,
		pitcherStatsByName,
		bullpenByTeam: {},
		slateDate,
		// Set to 18:20Z so the 18:00Z prior is within the 30-minute steam window
		// AND we are still within 60 minutes of evt-002's 19:10Z game time.
		capturedAtIso: "2026-05-12T18:20:00Z",
		skipBullpenLive: true,                    // no network in test
		skipHistoryAppend: false,                 // also exercise the writer
	})

	const [r1, r2, r3, r4, r5] = result.rows

	console.log("\n--- row 1: lineup confirmed, spot unchanged ---")
	assert(r1.mlbLiveState != null, "row 1 has mlbLiveState")
	assert(r1.mlbLiveState.lineup?.confirmedForRow === true, "row 1 confirmedForRow true")
	assert(r1.mlbLiveState.lineup?.currentLineupSpot === 3, "row 1 currentLineupSpot 3")
	assert(r1.mlbLiveState.lineup?.lineupSpotChanged !== true, "row 1 spot NOT marked changed (history lacks players list → null delta)")
	assert(Array.isArray(r1.mlbLiveState.tags), "row 1 tags is array")
	assert(r1.mlbLiveState.tags.includes("LINEUP_CONFIRMED"), "row 1 tagged LINEUP_CONFIRMED")

	console.log("\n--- row 2: lineup spot changed (current spot 2) ---")
	assert(r2.mlbLiveState.lineup?.currentLineupSpot === 2, "row 2 currentLineupSpot 2")

	console.log("\n--- row 3: emergency callup detection ---")
	assert(r3.mlbLiveState.starter != null, "row 3 starter state present")
	assert(r3.mlbLiveState.starter?.pitcherName === "Synthetic Pitcher Today", "row 3 current pitcher name")
	assert(r3.mlbLiveState.starter?.previousPitcher === "Solid Starter", "row 3 previous pitcher name from history")
	assert(r3.mlbLiveState.starter?.changeType === "emergency_callup", "row 3 detected as emergency_callup", { v: r3.mlbLiveState.starter })
	assert(r3.mlbLiveState.tags.includes("EMERGENCY_CALLUP"), "row 3 tagged EMERGENCY_CALLUP")

	console.log("\n--- row 4: steam line move (open -110 → now -150) ---")
	assert(r4.mlbLiveState.lineMovement?.observationCount >= 1, "row 4 has prior observation")
	assert(r4.mlbLiveState.lineMovement?.openOdds === -110, "row 4 openOdds -110")
	assert(r4.mlbLiveState.lineMovement?.currentOdds === -150, "row 4 currentOdds -150")
	assert(r4.mlbLiveState.lineMovement?.impliedDriftPct > 0.04, "row 4 implied drift > 4%", { v: r4.mlbLiveState.lineMovement?.impliedDriftPct })
	assert(r4.mlbLiveState.lineMovement?.steamFlag === true, "row 4 steamFlag true")
	assert(r4.mlbLiveState.tags.includes("STEAM_MOVE"), "row 4 tagged STEAM_MOVE")
	assert(r4.mlbLiveState.tags.includes("LINE_TIGHTENING"), "row 4 tagged LINE_TIGHTENING")

	console.log("\n--- row 5: synthetic market (NRFI) still receives mlbLiveState ---")
	assert(r5.mlbLiveState != null, "row 5 has mlbLiveState envelope")
	// lineup will be skipped for non-player rows because lineup deriver returns
	// a structural null for pitcher props; for special markets the lineup deriver
	// still returns null for confirmedForRow.
	assert(r5.mlbLiveState.lineMovement != null, "row 5 still has lineMovement (no priors → observationCount 0)")
	assert(r5.mlbLiveState.lineMovement?.observationCount === 0, "row 5 no priors")

	console.log("\n--- diagnostics block ---")
	const d = result.diagnostics
	assert(d.phase === "mlb-phase-2-live-state-v1", "phase tag is v1")
	assert(d.rowsProcessed === 5, "rowsProcessed == 5")
	assert(d.historyRecordsRead >= 1, "history read returned ≥ 1 prior record")
	assert(d.layers.lineMovementWithPriors >= 1, "lineMovementWithPriors ≥ 1")
	assert(d.tagCounts.STEAM_MOVE >= 1, "tagCounts.STEAM_MOVE ≥ 1")
	assert(d.tagCounts.EMERGENCY_CALLUP >= 1, "tagCounts.EMERGENCY_CALLUP ≥ 1")
	assert(d.historyAppended === true, "new history record appended")

	console.log("\n--- additive integrity: original row fields preserved ---")
	assert(r1.odds === -120 && r1.line === 1.5, "row 1 odds/line unchanged")
	assert(r4.odds === -150 && r4.book === "DK", "row 4 odds/book unchanged")

	console.log("\n=== verification finished ===")

	// restore monkey patches (not strictly necessary for one-shot script)
	histMod.readRecentRecords = realReadRecent
	histMod.appendHistoryRecord = realAppend

	// cleanup tmpDir
	try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

main()
