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

async function fetchOfficialTeamRoster({ teamId }) {
  const response = await axios.get(`${MLB_STATS_API_BASE_URL}/teams/${teamId}/roster`, {
    params: {
      rosterType: "active"
    },
    timeout: MLB_STATS_TIMEOUT_MS
  })
  return ensureArray(response?.data?.roster)
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

  const pushCandidate = (player, orderIndex) => {
    const safePlayer = ensureObject(player)
    const person = ensureObject(safePlayer?.person)
    const playerName = String(person?.fullName || safePlayer?.name || "").trim()
    if (!playerName) return
    out.push({
      playerIdExternal: person?.id ?? null,
      playerName,
      playerKey: normalizeMlbPlayerKey(playerName),
      teamResolved: String(teamName || "").trim() || null,
      teamCode: resolveTeamCode(teamName || "") || null,
      battingOrderIndex: Number.isFinite(orderIndex) ? orderIndex : out.length + 1,
      source: "mlb-official-lineup-feed"
    })
  }

  // Primary path: battingOrder array (in-game and some pregame states).
  for (const batterId of battingOrder) {
    const playerKey = `ID${String(batterId || "").trim()}`
    const player = ensureObject(players[playerKey])
    if (!Object.keys(player).length) continue
    pushCandidate(player, out.length + 1)
  }

  // Fallback path (pregame): some feeds populate per-player battingOrder fields
  // even when the battingOrder array is empty.
  if (out.length === 0) {
    const inferred = []
    for (const player of Object.values(players)) {
      const safePlayer = ensureObject(player)
      const bo = String(safePlayer?.battingOrder || "").trim()
      if (!bo) continue
      // StatsAPI uses "100", "200", ... for lineup slots; ignore "0"/"000".
      const n = Number(bo)
      if (!Number.isFinite(n) || n <= 0) continue
      inferred.push({ n, player: safePlayer })
    }
    inferred.sort((a, b) => a.n - b.n)
    for (let i = 0; i < Math.min(9, inferred.length); i++) {
      pushCandidate(inferred[i].player, i + 1)
    }
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
  let rosterCalls = 0
  let rosterPlayersAdded = 0

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

      // If lineups are not posted yet, fall back to active rosters for each club.
      // This stays within the same MLB official data source and dramatically improves
      // player→team mapping integrity vs leaving all rows unresolved.
      if (awayPlayers.length === 0 && homePlayers.length === 0) {
        const awayTeamId = Number(scheduleGame?.teams?.away?.team?.id)
        const homeTeamId = Number(scheduleGame?.teams?.home?.team?.id)
        const rosterCandidates = []
        try {
          if (Number.isFinite(awayTeamId)) {
            rosterCalls += 1
            const roster = await fetchOfficialTeamRoster({ teamId: awayTeamId })
            for (const rr of roster) {
              const person = ensureObject(rr?.person)
              const playerName = String(person?.fullName || "").trim()
              if (!playerName) continue
              rosterCandidates.push({
                playerIdExternal: person?.id ?? null,
                playerName,
                playerKey: normalizeMlbPlayerKey(playerName),
                teamResolved: awayTeamName,
                teamCode: resolveTeamCode(awayTeamName || "") || null,
                source: "mlb-official-active-roster",
                eventIds: [eventId]
              })
            }
          }
        } catch (error) {
          fetchErrors.push({
            stage: "official-active-roster-away",
            eventId,
            teamId: awayTeamId,
            error: String(error?.response?.data?.message || error?.message || error)
          })
        }
        try {
          if (Number.isFinite(homeTeamId)) {
            rosterCalls += 1
            const roster = await fetchOfficialTeamRoster({ teamId: homeTeamId })
            for (const rr of roster) {
              const person = ensureObject(rr?.person)
              const playerName = String(person?.fullName || "").trim()
              if (!playerName) continue
              rosterCandidates.push({
                playerIdExternal: person?.id ?? null,
                playerName,
                playerKey: normalizeMlbPlayerKey(playerName),
                teamResolved: homeTeamName,
                teamCode: resolveTeamCode(homeTeamName || "") || null,
                source: "mlb-official-active-roster",
                eventIds: [eventId]
              })
            }
          }
        } catch (error) {
          fetchErrors.push({
            stage: "official-active-roster-home",
            eventId,
            teamId: homeTeamId,
            error: String(error?.response?.data?.message || error?.message || error)
          })
        }

        if (rosterCandidates.length > 0) {
          if (!Array.isArray(playersByEventId[eventId])) playersByEventId[eventId] = []
          for (const candidateRow of rosterCandidates) {
            playersByEventId[eventId].push(candidateRow)
            appendCandidate(playersByPlayerKey, candidateRow)
            rosterPlayersAdded += 1
          }
        }
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
  if (rosterPlayersAdded === 0) {
    notes.push("MLB official roster fallback added no players for matched events in current window.")
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
          rosterCalls,
          rosterPlayersAdded,
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