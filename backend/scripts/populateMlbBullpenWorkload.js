"use strict"

/**
 * Runner for refreshMlbBullpenWorkload. The underlying refresher requires an
 * `events` array — fetches today's slate to populate the team list, then
 * calls the refresher.
 *
 *   node backend/scripts/populateMlbBullpenWorkload.js
 *   node backend/scripts/populateMlbBullpenWorkload.js 2026-05-30
 *
 * Writes to backend/data/mlbBullpenWorkload.json.
 */

const axios = require("axios")
const { refreshMlbBullpenWorkload } = require("../pipeline/mlb/ingest/refreshMlbBullpenWorkload")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"

async function fetchEventsForDate(date) {
	const res = await axios.get(SCHEDULE_URL, {
		params: { sportId: 1, date },
		timeout: 15000,
	})
	const games = res?.data?.dates?.[0]?.games || []
	const events = []
	for (const g of games) {
		const home = g?.teams?.home?.team?.name
		const away = g?.teams?.away?.team?.name
		if (!home || !away) continue
		events.push({
			eventId: String(g?.gamePk ?? ""),
			home_team: home,
			away_team: away,
			homeTeam: home,
			awayTeam: away,
		})
	}
	return events
}

async function main() {
	// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
	const slateDate = process.argv[2] || currentSlateDateEt()
	const events = await fetchEventsForDate(slateDate)
	console.log(`[populateBullpen] events found for ${slateDate}: ${events.length}`)
	for (const e of events.slice(0, 5)) {
		console.log(`  ${e.away_team} @ ${e.home_team}`)
	}
	if (!events.length) {
		console.log("(no events; nothing to do)")
		process.exit(0)
	}
	const { diagnostics } = await refreshMlbBullpenWorkload({ events })
	console.log(JSON.stringify(diagnostics, null, 2))
	if (!diagnostics.persistedToDisk) process.exit(1)
}

main().catch((e) => { console.error("[populateMlbBullpenWorkload] fatal:", e?.message || e); process.exit(1) })
