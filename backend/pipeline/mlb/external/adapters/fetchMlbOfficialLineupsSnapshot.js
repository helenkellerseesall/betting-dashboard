"use strict"

const axios = require("axios")

const { normalizeMlbPlayerKey, normalizeMlbText } = require("../../enrichment/mlbPlayerKey")
const { resolveTeamCode } = require("../../enrichment/resolveMlbIdentityCandidates")

const MLB_STATS_API_BASE_URL = "https://statsapi.mlb.com/api/v1"
const MLB_STATS_API_LIVE_BASE_URL = "https://statsapi.mlb.com/api/v1.1"
const MLB_STATS_TIMEOUT_MS = 12000

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function toEventId(event) {
  return String(event?.eventId || event?.id || "").trim()
}

function toUtcDateKey(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

function buildMatchKey(awayTeam, homeTeam, dateKey) {
  return [
    normalizeMlbText(awayTeam),
    normalizeMlbText(homeTeam),
    String(dateKey || "").trim()
  ].join("|")
}

function toTeamFromEvent(event, side) {
  if (String(side || "") === "home") {
    return String(event?.homeTeam || event?.home_team || "").trim()
  }
  return String(event?.awayTeam || event?.away_team || "").trim()
}

async function fetchOfficialScheduleForDate({ dateKey }) {
  const response = await axios.get(`${MLB_STATS_API_BASE_URL}/schedule`, {
    params: {
      sportId: 1,
      date: dateKey,
      hydrate: "probablePitcher,team"
    },
    timeout: MLB_STATS_TIMEOUT_MS
  })

  return ensureArray(response?.data?.dates)
    .flatMap((dateRow) => ensureArray(dateRow?.games))
}

async function fetchOfficialGameFeed({ gamePk }) {
  const response = await axios.get(`${MLB_STATS_API_LIVE_BASE_URL}/game/${gamePk}/feed/live`, {
    timeout: MLB_STATS_TIMEOUT_MS
  })
  return ensureObject(response?.data)
}

function toProbablePitcher(person, source) {
  if (!person || typeof person !== "object") return null
  const playerName = String(person?.fullName || person?.name || "").trim()
  if (!playerName) return null

  return {
    playerName,
    playerIdExternal: person?.id ?? null,
    playerKey: normalizeMlbPlayerKey(playerName),
    source
  }
}

function extractLineupPlayersFromFeed(teamBoxscore, teamName) {
  const safeTeamBoxscore = ensureObject(teamBoxscore)
  const battingOrder = ensureArray(safeTeamBoxscore?.battingOrder)
  const players = ensureObject(safeTeamBoxscore?.players)
  const out = []

  for (const batterId of battingOrder) {
    const playerKey = `ID${String(batterId || "").trim()}`
    const player = ensureObject(players[playerKey])
    const person = ensureObject(player?.person)
    const playerName = String(person?.fullName || player?.name || "").trim()
    if (!playerName) continue

    out.push({
      playerIdExternal: person?.id ?? null,
      playerName,
      playerKey: normalizeMlbPlayerKey(playerName),
      teamResolved: String(teamName || "").trim() || null,
      teamCode: resolveTeamCode(teamName || "") || null,
      battingOrderIndex: out.length + 1,
      source: "mlb-official-lineup-feed"
    })
  }

  return out
}

function appendCandidate(playersByPlayerKey, candidate) {
  const playerKey = String(candidate?.playerKey || "").trim()
  if (!playerKey) return

  if (!Array.isArray(playersByPlayerKey[playerKey])) {
    playersByPlayerKey[playerKey] = []
  }

  const exists = playersByPlayerKey[playerKey].some((existing) => {
    const sameName = String(existing?.playerName || "") === String(candidate?.playerName || "")
    const sameTeam = String(existing?.teamResolved || "") === String(candidate?.teamResolved || "")
    const sameSource = String(existing?.source || "") === String(candidate?.source || "")
    return sameName && sameTeam && sameSource
  })
  if (!exists) {
    playersByPlayerKey[playerKey].push(candidate)
  }
}

async function fetchMlbOfficialLineupsSnapshot({ events = [], now = Date.now() } = {}) {
  const safeEvents = Array.isArray(events) ? events : []
  const generatedAt = new Date(now).toISOString()

  const eventContextByEventId = {}
  const probablePitchersByEventId = {}
  const lineupConfirmationByEventId = {}
  const playersByEventId = {}
  const playersByPlayerKey = {}

  const fetchErrors = []
  const notes = []
  let scheduleGamesFetched = 0
  let scheduleGamesMatchedToSlate = 0
  let liveFeedCalls = 0
  let liveFeedLineupEvents = 0
  let liveFeedProbablePitcherEvents = 0

  const eventByMatchKey = new Map()
  const requestDateKeys = new Set()
  for (const event of safeEvents) {
    const eventId = toEventId(event)
    if (!eventId) continue
    const awayTeam = toTeamFromEvent(event, "away")
    const homeTeam = toTeamFromEvent(event, "home")
    const dateKey = toUtcDateKey(event?.gameTime || event?.commence_time)
    if (!dateKey) continue

    requestDateKeys.add(dateKey)
    eventByMatchKey.set(buildMatchKey(awayTeam, homeTeam, dateKey), { eventId, awayTeam, homeTeam, dateKey })
  }

  const scheduleByMatchKey = new Map()
  for (const dateKey of [...requestDateKeys]) {
    try {
      const games = await fetchOfficialScheduleForDate({ dateKey })
      scheduleGamesFetched += games.length
      for (const game of games) {
        const matchKey = buildMatchKey(
          game?.teams?.away?.team?.name,
          game?.teams?.home?.team?.name,
          toUtcDateKey(game?.gameDate)
        )
        if (matchKey) scheduleByMatchKey.set(matchKey, game)
      }
    } catch (error) {
      fetchErrors.push({
        stage: "official-schedule",
        dateKey,
        error: String(error?.response?.data?.message || error?.message || error)
      })
    }
  }

  for (const event of safeEvents) {
    const eventId = toEventId(event)
    if (!eventId) continue

    const matchKey = buildMatchKey(
      toTeamFromEvent(event, "away"),
      toTeamFromEvent(event, "home"),
      toUtcDateKey(event?.gameTime || event?.commence_time)
    )

    const scheduleGame = scheduleByMatchKey.get(matchKey)
    if (!scheduleGame) continue
    scheduleGamesMatchedToSlate += 1

    const gamePk = Number(scheduleGame?.gamePk)
    if (!Number.isFinite(gamePk)) continue

    try {
      const liveFeed = await fetchOfficialGameFeed({ gamePk })
      liveFeedCalls += 1

      const awayTeamName = String(scheduleGame?.teams?.away?.team?.name || toTeamFromEvent(event, "away") || "").trim() || null
      const homeTeamName = String(scheduleGame?.teams?.home?.team?.name || toTeamFromEvent(event, "home") || "").trim() || null

      const awayProbable = toProbablePitcher(scheduleGame?.teams?.away?.probablePitcher, "mlb-official-schedule-probable")
      const homeProbable = toProbablePitcher(scheduleGame?.teams?.home?.probablePitcher, "mlb-official-schedule-probable")
      if (awayProbable || homeProbable) {
        probablePitchersByEventId[eventId] = {
          away: awayProbable ? {
            playerName: awayProbable.playerName,
            playerIdExternal: awayProbable.playerIdExternal,
            playerKey: awayProbable.playerKey,
            source: awayProbable.source
          } : null,
          home: homeProbable ? {
            playerName: homeProbable.playerName,
            playerIdExternal: homeProbable.playerIdExternal,
            playerKey: homeProbable.playerKey,
            source: homeProbable.source
          } : null,
          source: "mlb-official-schedule-probable"
        }
        liveFeedProbablePitcherEvents += 1
      }

      const awayPlayers = extractLineupPlayersFromFeed(liveFeed?.liveData?.boxscore?.teams?.away, awayTeamName)
      const homePlayers = extractLineupPlayersFromFeed(liveFeed?.liveData?.boxscore?.teams?.home, homeTeamName)

      const lineupConfirmation = {
        awayConfirmed: awayPlayers.length >= 9,
        homeConfirmed: homePlayers.length >= 9,
        awayStarterCount: awayPlayers.length,
        homeStarterCount: homePlayers.length,
        source: "mlb-official-lineup-feed"
      }

      eventContextByEventId[eventId] = {
        eventId,
        matchup: String(event?.matchup || `${awayTeamName || ""} @ ${homeTeamName || ""}`).trim() || null,
        gameTime: scheduleGame?.gameDate || event?.gameTime || event?.commence_time || null,
        awayTeam: awayTeamName,
        homeTeam: homeTeamName,
        probablePitchers: probablePitchersByEventId[eventId] || {
          away: null,
          home: null,
          source: "mlb-official-schedule-probable"
        },
        lineupConfirmation
      }

      if (awayPlayers.length > 0 || homePlayers.length > 0) {
        lineupConfirmationByEventId[eventId] = lineupConfirmation
        playersByEventId[eventId] = []
        liveFeedLineupEvents += 1
      }

      for (const candidate of [...awayPlayers, ...homePlayers]) {
        const candidateRow = {
          playerIdExternal: candidate.playerIdExternal,
          playerName: candidate.playerName,
          playerKey: candidate.playerKey,
          teamResolved: candidate.teamResolved,
          teamCode: candidate.teamCode,
          source: candidate.source,
          battingOrderIndex: candidate.battingOrderIndex,
          eventIds: [eventId]
        }
        if (!Array.isArray(playersByEventId[eventId])) {
          playersByEventId[eventId] = []
        }
        playersByEventId[eventId].push(candidateRow)
        appendCandidate(playersByPlayerKey, candidateRow)
      }
    } catch (error) {
      fetchErrors.push({
        stage: "official-live-feed",
        eventId,
        gamePk,
        error: String(error?.response?.data?.message || error?.message || error)
      })
    }
  }

  if (scheduleGamesMatchedToSlate === 0) {
    notes.push("MLB official schedule did not match any current slate events by matchup/date.")
  }
  if (liveFeedProbablePitcherEvents === 0) {
    notes.push("MLB official schedule/live feed returned no probable pitchers for matched events in current window.")
  }
  if (liveFeedLineupEvents === 0) {
    notes.push("MLB official live feed returned no posted batting orders for matched events in current window.")
  }

  return {
    sport: "mlb",
    generatedAt,
    source: "mlb_official_lineups",
    version: "phase-8a-mlb-official-lineups-v1",
    eventContextByEventId,
    probablePitchersByEventId,
    lineupConfirmationByEventId,
    teamContextByEventId: {},
    playersByEventId,
    playersByPlayerKey,
    recentStatsByPlayerKey: {},
    diagnostics: {
      hasExternalData:
        Object.keys(playersByPlayerKey).length > 0 ||
        Object.keys(playersByEventId).length > 0 ||
        Object.keys(probablePitchersByEventId).length > 0 ||
        Object.keys(lineupConfirmationByEventId).length > 0,
      playerKeyCount: Object.keys(playersByPlayerKey).length,
      eventContextCount: Object.keys(eventContextByEventId).length,
      playersByEventCount: Object.keys(playersByEventId).length,
      probablePitcherEventCount: Object.keys(probablePitchersByEventId).length,
      lineupConfirmationEventCount: Object.keys(lineupConfirmationByEventId).length,
      teamContextEventCount: 0,
      recentStatsPlayerCount: 0,
      fetchReadiness: {
        selectedSource: "mlb_official_lineups",
        adapter: "fetchMlbOfficialLineupsSnapshot",
        mode: fetchErrors.length > 0 ? "live-fetch-partial" : "live-fetch-ok",
        fetchAttempted: true,
        eventCountInput: safeEvents.length,
        scheduleGamesFetched,
        scheduleGamesMatchedToSlate,
        liveFeedCalls,
        liveFeedLineupEvents,
        liveFeedProbablePitcherEvents,
        sourceContribution: {
          playersByEventCount: Object.keys(playersByEventId).length,
          playersByPlayerKeyCount: Object.keys(playersByPlayerKey).length,
          probablePitcherEventCount: Object.keys(probablePitchersByEventId).length,
          lineupConfirmationEventCount: Object.keys(lineupConfirmationByEventId).length
        },
        fetchErrors,
        notes
      }
    }
  }
}

module.exports = {
  fetchMlbOfficialLineupsSnapshot
}