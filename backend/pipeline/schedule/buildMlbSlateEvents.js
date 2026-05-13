"use strict"

/**
 * buildMlbSlateEvents
 *
 * Parallel MLB schedule builder. Wraps the same normalization pattern as
 * pipeline/schedule/buildSlateEvents.js but targets the baseball_mlb
 * Odds API endpoint and uses MLB-appropriate defaults.
 *
 * Does NOT modify or replace the existing buildSlateEvents.js NBA path.
 * This module is only imported by the Phase 1 /mlb/refresh endpoint.
 *
 * Reuses:
 *   - toDetroitDateKey  (re-exported from buildSlateEvents.js — same timezone logic)
 *   - normalizeSlateEvent shape — identical field set, just a different API URL
 */

const axios = require("axios")
const {
  toDetroitDateKey,
  getEventIdForSchedule,
  getEventTimeForSchedule,
  getEventMatchupForSchedule
} = require("./buildSlateEvents")
// Predictive-integrity hardening — canonical future-only filter.
// Replaces the prior inline `>= nowMs` check that allowed in-progress and
// completed games to leak into scheduled slates. Strict `> nowMs + grace`
// semantics; UTC-safe; truthful-null on missing timestamps.
const { filterFutureOnlyEvents } = require("../shared/mlbFutureOnly")

// ---------------------------------------------------------------------------
// MLB-specific event normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Odds API baseball_mlb event into the canonical shape
 * used by the rest of the pipeline.
 *
 * The field names produced here match those expected by buildDecisionLayer,
 * buildSurfaceRow, and the resolution helpers.
 *
 * @param {object} event - Raw event object from the Odds API response.
 * @returns {object} Normalized event with canonical fields.
 */
function normalizeMlbSlateEvent(event) {
  const eventId = getEventIdForSchedule(event)
  const eventTime = getEventTimeForSchedule(event)
  const detroitDateKey = toDetroitDateKey(eventTime)
  const awayTeam = event?.away_team || event?.awayTeam || event?.teams?.[0] || ""
  const homeTeam = event?.home_team || event?.homeTeam || event?.teams?.[1] || ""

  const matchup = (awayTeam && homeTeam)
    ? `${awayTeam} @ ${homeTeam}`
    : (getEventMatchupForSchedule(event) || "UNKNOWN_MATCHUP")

  return {
    ...event,
    sport: "mlb",
    id: event?.id ?? eventId,
    eventId: event?.eventId ?? eventId,
    commence_time: event?.commence_time || eventTime,
    gameTime: event?.gameTime || eventTime,
    startTime: event?.startTime || eventTime,
    detroitDateKey: event?.detroitDateKey || detroitDateKey || null,
    away_team: event?.away_team || awayTeam,
    awayTeam: event?.awayTeam || awayTeam,
    home_team: event?.home_team || homeTeam,
    homeTeam: event?.homeTeam || homeTeam,
    matchup
  }
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Fetch and filter today's MLB slate events from the Odds API.
 *
 * Mirrors the buildSlateEvents interface so Phase 1 can call it with
 * the same argument shape. The `events` parameter allows injecting a
 * pre-fetched array (useful for tests and offline passes).
 *
 * @param {{ oddsApiKey: string, now?: number, events?: object[] }} options
 * @returns {Promise<{
 *   slateDateKey: string,
 *   allEvents: object[],
 *   scheduledEvents: object[]
 * }>}
 */
async function buildMlbSlateEvents({
  oddsApiKey,
  now = Date.now(),
  events
}) {
  const todayDateKey = toDetroitDateKey(now)
  const tomorrowDateKey = toDetroitDateKey(now + 24 * 60 * 60 * 1000)
  let fetchedEvents = Array.isArray(events) ? events : null

  if (!Array.isArray(fetchedEvents)) {
    const response = await axios.get(
      "https://api.the-odds-api.com/v4/sports/baseball_mlb/events",
      {
        params: {
          apiKey: oddsApiKey
        },
        timeout: 15000
      }
    )
    fetchedEvents = Array.isArray(response?.data) ? response.data : []
  }

  const allEvents = fetchedEvents.map((event) => normalizeMlbSlateEvent(event))

  console.log("[MLB-RAW-EVENTS-FETCH-DEBUG]", {
    totalFetched: allEvents.length,
    events: allEvents.map((event) => ({
      eventId: getEventIdForSchedule(event),
      matchup: event.matchup,
      commenceTime: String(getEventTimeForSchedule(event)),
      detroitDateKey: toDetroitDateKey(getEventTimeForSchedule(event))
    }))
  })

  const getEventDetroitDateKey = (event) => {
    const normalizedKey = String(event?.detroitDateKey || "").trim()
    if (normalizedKey) return normalizedKey
    const eventTime = getEventTimeForSchedule(event)
    const computed = toDetroitDateKey(eventTime)
    return computed || ""
  }

  const todayEventsOnDate = allEvents.filter((event) => getEventDetroitDateKey(event) === todayDateKey)
  const tomorrowEventsOnDate = allEvents.filter((event) => getEventDetroitDateKey(event) === tomorrowDateKey)

  // Strict future-only filter — replaces the prior `t >= nowMs` rollover-only
  // check. Games whose commence_time is in the past OR exactly equal to now
  // are treated as STARTED and excluded. Diagnostics carry the dropped IDs.
  const nowMs = Number(now)
  const todayFutureFilter    = filterFutureOnlyEvents(todayEventsOnDate,    { nowMs })
  const tomorrowFutureFilter = filterFutureOnlyEvents(tomorrowEventsOnDate, { nowMs })
  const todayEvents    = todayFutureFilter.kept
  const tomorrowEvents = tomorrowFutureFilter.kept

  // MLB boards can be posted mostly for the next Detroit date during overnight windows.
  // If no same-day FUTURE events exist, roll to tomorrow rather than returning an empty slate.
  let chosenSlateDateKey = todayDateKey
  let scheduledEvents = todayEvents
  let chosenFutureFilter = todayFutureFilter

  if (!scheduledEvents.length && tomorrowEvents.length) {
    chosenSlateDateKey = tomorrowDateKey
    scheduledEvents = tomorrowEvents
    chosenFutureFilter = tomorrowFutureFilter
  }

  console.log("[MLB-SCHEDULED-EVENTS-FINAL-DEBUG]", {
    slateDateKey: chosenSlateDateKey,
    todayDateKey,
    tomorrowDateKey,
    todayOnDate: todayEventsOnDate.length,
    todayFutureOnly: todayEvents.length,
    todayStartedDropped: todayFutureFilter.diagnostics.filteredStartedGames,
    todayNoTimestampDropped: todayFutureFilter.diagnostics.excludedWithoutTimestamp,
    tomorrowOnDate: tomorrowEventsOnDate.length,
    tomorrowFutureOnly: tomorrowEvents.length,
    totalScheduled: scheduledEvents.length,
    futureFilterTimestamp: chosenFutureFilter.diagnostics.futureFilterTimestamp,
    futureGraceMs: chosenFutureFilter.diagnostics.futureGraceMs,
    events: scheduledEvents.map((event) => ({
      eventId: getEventIdForSchedule(event),
      matchup: event.matchup,
      commenceTime: String(getEventTimeForSchedule(event)),
      detroitDateKey: toDetroitDateKey(getEventTimeForSchedule(event))
    }))
  })

  // Emit a high-visibility probe whenever started games were excluded so the
  // operator can see future-only enforcement in action.
  if (chosenFutureFilter.diagnostics.filteredStartedGames > 0 ||
      chosenFutureFilter.diagnostics.excludedWithoutTimestamp > 0) {
    console.log("[MLB-FUTURE-ONLY-FILTER]", JSON.stringify(chosenFutureFilter.diagnostics))
  }

  return {
    slateDateKey: chosenSlateDateKey,
    allEvents,
    scheduledEvents,
    // Additive diagnostics — consumed by buildMlbBootstrapSnapshot so the
    // snapshot's diagnostics.futureOnlyFilter block carries the filter trace.
    futureOnlyFilter: chosenFutureFilter.diagnostics,
    futureOnlyFilterTodayDate: todayFutureFilter.diagnostics,
    futureOnlyFilterTomorrowDate: tomorrowFutureFilter.diagnostics,
  }
}

module.exports = {
  buildMlbSlateEvents,
  normalizeMlbSlateEvent
}
