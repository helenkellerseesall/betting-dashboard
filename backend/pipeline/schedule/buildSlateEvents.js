const axios = require("axios")

function getEventIdForSchedule(event) {
	const id = event?.id ?? event?.eventId ?? event?.event_id ?? event?.key
	return id == null ? "" : String(id)
}

function getEventTimeForSchedule(event) {
	return event?.commence_time || event?.gameTime || event?.startTime || event?.start_time || event?.game_time || ""
}

function getEventMatchupForSchedule(event) {
	const away = event?.away_team || event?.awayTeam || event?.teams?.[0] || ""
	const home = event?.home_team || event?.homeTeam || event?.teams?.[1] || ""
	if (away && home) return `${away} @ ${home}`
	if (event?.matchup) return String(event.matchup)
	return "UNKNOWN_MATCHUP"
}

function normalizeSlateEvent(event) {
	const eventId = getEventIdForSchedule(event)
	const eventTime = getEventTimeForSchedule(event)
	const awayTeam = event?.away_team || event?.awayTeam || event?.teams?.[0] || ""
	const homeTeam = event?.home_team || event?.homeTeam || event?.teams?.[1] || ""
	const matchup = getEventMatchupForSchedule(event)

	return {
		...event,
		id: event?.id ?? eventId,
		eventId: event?.eventId ?? eventId,
		commence_time: event?.commence_time || eventTime,
		gameTime: event?.gameTime || eventTime,
		startTime: event?.startTime || eventTime,
		away_team: event?.away_team || awayTeam,
		awayTeam: event?.awayTeam || awayTeam,
		home_team: event?.home_team || homeTeam,
		homeTeam: event?.homeTeam || homeTeam,
		matchup
	}
}

function toDetroitDateKey(value) {
	const date = new Date(value)
	if (!Number.isFinite(date.getTime())) return ""
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Detroit",
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).format(date)
}

async function buildSlateEvents({
	oddsApiKey,
	now = Date.now(),
	events
}) {
	const slateDateKey = toDetroitDateKey(now)
	let fetchedEvents = Array.isArray(events) ? events : null

	if (!Array.isArray(fetchedEvents)) {
		const response = await axios.get("https://api.the-odds-api.com/v4/sports/basketball_nba/events", {
			params: {
				apiKey: oddsApiKey
			},
			timeout: 15000
		})
		fetchedEvents = Array.isArray(response?.data) ? response.data : []
	}

	const allEvents = fetchedEvents.map((event) => normalizeSlateEvent(event))

	console.log("[RAW-EVENTS-FETCH-DEBUG]", {
		totalFetched: allEvents.length,
		events: allEvents.map((event) => ({
			eventId: getEventIdForSchedule(event),
			matchup: getEventMatchupForSchedule(event),
			commenceTime: String(getEventTimeForSchedule(event)),
			detroitDateKey: toDetroitDateKey(getEventTimeForSchedule(event))
		}))
	})

	// Session AW — Slate Integrity Repair V1.
	// scheduledEvents previously matched only by Detroit calendar date.
	// A completed game on today's date stayed in scheduledEvents for hours
	// after the game ended (Odds API still returns it). That stale event
	// then drove per-event odds fetching → stale props → stale bestProps →
	// contaminated workstation outputs. Two-stage filter below:
	//   1. same Detroit calendar date as slate (existing)
	//   2. commence_time STRICTLY in the future relative to `now` (new)
	// Effect: only PRE-GAME events drive snapshot generation. In-progress
	// and completed games are correctly excluded — props for those games
	// are no longer fetched, persisted, or surfaced.
	const eventsOnSlateDate = allEvents.filter((event) => {
		const eventTime = getEventTimeForSchedule(event)
		return toDetroitDateKey(eventTime) === slateDateKey
	})
	const scheduledEvents = eventsOnSlateDate.filter((event) => {
		const eventTime = getEventTimeForSchedule(event)
		const ms = new Date(eventTime).getTime()
		return Number.isFinite(ms) && ms > now
	})
	const completedOrInProgressDropped = eventsOnSlateDate.length - scheduledEvents.length

	// Session AX — Future-slate acceptance fix.
	// Session AW correctly excluded completed games but the date-key restriction
	// in scheduledEvents means TOMORROW's NBA games are also excluded (different
	// Detroit calendar date). When today's games are all complete and tomorrow's
	// games are upcoming on the sportsbook, every consumer of scheduledEvents
	// (including server.js hard-reset which returns 404 on empty) treats the
	// slate as ended. `upcomingEvents` is the ANY-DATE future-only filter:
	// consumers should prefer scheduledEvents (today pregame) when populated,
	// and fall back to upcomingEvents (tomorrow / next pregame day) when today
	// has no remaining pregame games.
	const upcomingEvents = allEvents.filter((event) => {
		const eventTime = getEventTimeForSchedule(event)
		const ms = new Date(eventTime).getTime()
		return Number.isFinite(ms) && ms > now
	})

	console.log("[SCHEDULED-EVENTS-FINAL-DEBUG]", {
		slateDateKey,
		nowIso: new Date(now).toISOString(),
		eventsOnSlateDate: eventsOnSlateDate.length,
		completedOrInProgressDropped,
		totalEvents: scheduledEvents.length,
		upcomingEventsAnyDate: upcomingEvents.length,
		events: scheduledEvents.map((event) => ({
			eventId: getEventIdForSchedule(event),
			matchup: getEventMatchupForSchedule(event),
			commenceTime: String(getEventTimeForSchedule(event)),
			detroitDateKey: toDetroitDateKey(getEventTimeForSchedule(event))
		}))
	})

	return {
		slateDateKey,
		allEvents,
		scheduledEvents,
		upcomingEvents
	}
}

module.exports = {
	buildSlateEvents,
	toDetroitDateKey,
	getEventIdForSchedule,
	getEventMatchupForSchedule,
	getEventTimeForSchedule
}
