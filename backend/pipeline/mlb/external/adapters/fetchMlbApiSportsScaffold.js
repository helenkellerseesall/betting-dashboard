"use strict"

function toEventId(event) {
  return String(event?.eventId || event?.id || "").trim()
}

function toEventContext(event) {
  return {
    eventId: toEventId(event) || null,
    matchup: String(event?.matchup || "").trim() || null,
    gameTime: event?.gameTime || event?.commence_time || null,
    homeTeam: String(event?.homeTeam || event?.home_team || "").trim() || null,
    awayTeam: String(event?.awayTeam || event?.away_team || "").trim() || null,
    probablePitchers: {
      home: null,
      away: null,
      source: "scaffold"
    },
    lineupConfirmation: {
      homeConfirmed: false,
      awayConfirmed: false,
      source: "scaffold"
    }
  }
}

async function fetchMlbApiSportsScaffold({ events = [], now = Date.now() } = {}) {
  const safeEvents = Array.isArray(events) ? events : []
  const generatedAt = new Date(now).toISOString()

  const eventContextByEventId = {}
  const probablePitchersByEventId = {}
  const lineupConfirmationByEventId = {}
  const teamContextByEventId = {}

  for (const event of safeEvents) {
    const eventId = toEventId(event)
    if (!eventId) continue

    const context = toEventContext(event)
    eventContextByEventId[eventId] = context
    probablePitchersByEventId[eventId] = context.probablePitchers
    lineupConfirmationByEventId[eventId] = context.lineupConfirmation
    teamContextByEventId[eventId] = {
      homeTeam: context.homeTeam,
      awayTeam: context.awayTeam,
      matchup: context.matchup
    }
  }

  return {
    sport: "mlb",
    generatedAt,
    source: "mlb_api_sports",
    version: "phase-6-external-fetch-scaffold-v1",
    eventContextByEventId,
    probablePitchersByEventId,
    lineupConfirmationByEventId,
    teamContextByEventId,
    playersByPlayerKey: {},
    playersByEventId: {},
    recentStatsByPlayerKey: {},
    diagnostics: {
      hasExternalData: false,
      playerKeyCount: 0,
      eventContextCount: Object.keys(eventContextByEventId).length,
      playersByEventCount: 0,
      probablePitcherEventCount: Object.keys(probablePitchersByEventId).length,
      lineupConfirmationEventCount: Object.keys(lineupConfirmationByEventId).length,
      teamContextEventCount: Object.keys(teamContextByEventId).length,
      recentStatsPlayerCount: 0,
      fetchReadiness: {
        selectedSource: "mlb_api_sports",
        adapter: "fetchMlbApiSportsScaffold",
        mode: "scaffold-noop",
        fetchAttempted: false,
        eventCountInput: safeEvents.length,
        notes: [
          "Adapter boundary is live.",
          "No external HTTP calls are made in scaffold mode.",
          "Snapshot slots for probable pitchers, lineups, team context, and recent stats are initialized."
        ]
      }
    }
  }
}

module.exports = {
  fetchMlbApiSportsScaffold
}
