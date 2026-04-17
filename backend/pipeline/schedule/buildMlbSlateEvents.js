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

  const todayEvents = allEvents.filter((event) => getEventDetroitDateKey(event) === todayDateKey)
  const tomorrowEvents = allEvents.filter((event) => getEventDetroitDateKey(event) === tomorrowDateKey)

  // MLB boards can be posted mostly for the next Detroit date during overnight windows.
  // If no same-day events exist, roll to tomorrow rather than returning an empty slate.
  let chosenSlateDateKey = todayDateKey
  let scheduledEvents = todayEvents

  const nowMs = Number(now)
  const hasUpcoming = (evts) => {
    const safe = Array.isArray(evts) ? evts : []
    for (const e of safe) {
      const t = new Date(getEventTimeForSchedule(e)).getTime()
      if (Number.isFinite(t) && (!Number.isFinite(nowMs) || t >= nowMs)) return true
    }
    return false
  }

  // If today's Detroit slate exists but is already finished (no upcoming starts),
  // treat it as empty and roll to tomorrow.
  const todayUsable = scheduledEvents.length > 0 && hasUpcoming(scheduledEvents)

  if ((!scheduledEvents.length || !todayUsable) && tomorrowEvents.length) {
    chosenSlateDateKey = tomorrowDateKey
    scheduledEvents = tomorrowEvents
  }

  console.log("[MLB-SCHEDULED-EVENTS-FINAL-DEBUG]", {
    slateDateKey: chosenSlateDateKey,
    todayDateKey,
    tomorrowDateKey,
    todayEventCount: todayEvents.length,
    tomorrowEventCount: tomorrowEvents.length,
    totalEvents: scheduledEvents.length,
    events: scheduledEvents.map((event) => ({
      eventId: getEventIdForSchedule(event),
      matchup: event.matchup,
      commenceTime: String(getEventTimeForSchedule(event)),
      detroitDateKey: toDetroitDateKey(getEventTimeForSchedule(event))
    }))
  })

  return {
    slateDateKey: chosenSlateDateKey,
    allEvents,
    scheduledEvents
  }
}

module.exports = {
  buildMlbSlateEvents,
  normalizeMlbSlateEvent
}
