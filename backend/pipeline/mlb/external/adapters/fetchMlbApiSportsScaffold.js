"use strict"

const axios = require("axios")

const { normalizeMlbPlayerKey, normalizeMlbText } = require("../../enrichment/mlbPlayerKey")
const { resolveTeamCode } = require("../../enrichment/resolveMlbIdentityCandidates")
const {
  getMlbExternalCacheEntry,
  setMlbExternalCacheEntry
} = require("../mlbExternalCache")
const {
  getMlbPlayerIdentityCache,
  mergeMlbPlayerIdentityCache
} = require("../mlbPlayerIdentityCache")

const API_SPORTS_BASE_URL = "https://v1.baseball.api-sports.io"
const API_SPORTS_TIMEOUT_MS = 12000
const MLB_LEAGUE_ID = 1

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
      source: "api-sports-lineups"
    },
    lineupConfirmation: {
      homeConfirmed: false,
      awayConfirmed: false,
      homeStarterCount: 0,
      awayStarterCount: 0,
      source: "api-sports-lineups"
    }
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function hasEndpointUnsupportedError(errors) {
  const endpointError = String(errors?.endpoint || "").toLowerCase()
  return endpointError.includes("do not exist")
}

function extractLineupPlayers(lineupRow) {
  const out = []
  const candidateArrays = [
    lineupRow?.lineup,
    lineupRow?.players,
    lineupRow?.starters,
    lineupRow?.starting_lineup,
    lineupRow?.batting_order,
    lineupRow?.roster
  ]

  for (const candidateArray of candidateArrays) {
    for (const row of ensureArray(candidateArray)) {
      const nested = row?.player && typeof row.player === "object" ? row.player : row
      const playerName = String(
        nested?.name ||
        nested?.player_name ||
        nested?.fullname ||
        row?.name ||
        row?.player_name ||
        ""
      ).trim()
      if (!playerName) continue

      const rawPos = String(
        nested?.pos ||
        nested?.position ||
        row?.pos ||
        row?.position ||
        ""
      ).trim()
      const normalizedPos = rawPos.toUpperCase()

      out.push({
        playerName,
        playerIdExternal: nested?.id ?? row?.id ?? null,
        position: rawPos || null,
        isPitcher: normalizedPos === "P" || normalizedPos.includes("PITCH")
      })
    }
  }

  const deduped = []
  const seen = new Set()
  for (const player of out) {
    const key = `${normalizeMlbText(player.playerName)}|${String(player.position || "")}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(player)
  }

  return deduped
}

function extractProbablePitcher(players) {
  const safePlayers = Array.isArray(players) ? players : []
  const found = safePlayers.find((player) => player?.isPitcher)
  if (!found) return null
  return {
    playerName: found.playerName,
    playerIdExternal: found.playerIdExternal,
    position: found.position || "P"
  }
}

function buildLineupBySide(lineups, game) {
  const out = { home: null, away: null }

  const homeNameNorm = normalizeMlbText(game?.teams?.home?.name)
  const awayNameNorm = normalizeMlbText(game?.teams?.away?.name)

  for (const lineup of ensureArray(lineups)) {
    const lineupTeamName = String(lineup?.team?.name || lineup?.name || "").trim()
    const lineupTeamNorm = normalizeMlbText(lineupTeamName)
    if (!lineupTeamNorm) continue

    if (homeNameNorm && lineupTeamNorm === homeNameNorm) {
      out.home = lineup
    } else if (awayNameNorm && lineupTeamNorm === awayNameNorm) {
      out.away = lineup
    }
  }

  return out
}

async function fetchApiSportsGamesForDate({ dateKey, season, apiSportsKey }) {
  const response = await axios.get(`${API_SPORTS_BASE_URL}/games`, {
    params: {
      date: dateKey,
      season,
      league: MLB_LEAGUE_ID
    },
    headers: {
      "x-apisports-key": apiSportsKey
    },
    timeout: API_SPORTS_TIMEOUT_MS
  })

  return ensureArray(response?.data?.response)
}

async function fetchApiSportsLineupsForGame({ gameId, apiSportsKey }) {
  const response = await axios.get(`${API_SPORTS_BASE_URL}/lineups`, {
    params: { game: gameId },
    headers: {
      "x-apisports-key": apiSportsKey
    },
    timeout: API_SPORTS_TIMEOUT_MS
  })

  const errors = ensureObject(response?.data?.errors)
  if (hasEndpointUnsupportedError(errors)) {
    const unsupported = new Error("lineups-endpoint-unsupported")
    unsupported.code = "LINEUPS_ENDPOINT_UNSUPPORTED"
    unsupported.apiSportsErrors = errors
    throw unsupported
  }

  return ensureArray(response?.data?.response)
}

function extractRosterPlayers(responseRows) {
  const out = []

  for (const row of ensureArray(responseRows)) {
    const player = row?.player && typeof row.player === "object" ? row.player : row
    const playerName = String(
      player?.name ||
      player?.player_name ||
      player?.fullname ||
      row?.name ||
      row?.player_name ||
      ""
    ).trim()
    if (!playerName) continue

    out.push({
      playerIdExternal: player?.id ?? row?.id ?? null,
      playerName,
      position: String(player?.pos || player?.position || row?.pos || row?.position || "").trim() || null,
      source: "api-sports-team-roster"
    })
  }

  const seen = new Set()
  const deduped = []
  for (const row of out) {
    const key = normalizeMlbText(row.playerName)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }

  return deduped
}

async function fetchApiSportsRosterForTeam({ teamId, season, apiSportsKey }) {
  const response = await axios.get(`${API_SPORTS_BASE_URL}/players`, {
    params: {
      team: teamId,
      season,
      league: MLB_LEAGUE_ID
    },
    headers: {
      "x-apisports-key": apiSportsKey
    },
    timeout: API_SPORTS_TIMEOUT_MS
  })

  const errors = ensureObject(response?.data?.errors)
  if (hasEndpointUnsupportedError(errors)) {
    const unsupported = new Error("players-endpoint-unsupported")
    unsupported.code = "PLAYERS_ENDPOINT_UNSUPPORTED"
    unsupported.apiSportsErrors = errors
    throw unsupported
  }

  return extractRosterPlayers(response?.data?.response)
}

async function fetchApiSportsTeamStatistics({ teamId, season, apiSportsKey }) {
  const response = await axios.get(`${API_SPORTS_BASE_URL}/teams/statistics`, {
    params: {
      team: teamId,
      season,
      league: MLB_LEAGUE_ID
    },
    headers: {
      "x-apisports-key": apiSportsKey
    },
    timeout: API_SPORTS_TIMEOUT_MS
  })

  const data = response?.data?.response
  return data && typeof data === "object" && !Array.isArray(data) ? data : null
}

function toTeamContextFromStats(teamStats) {
  const stats = teamStats && typeof teamStats === "object" ? teamStats : null
  if (!stats) return null

  return {
    teamId: stats?.team?.id ?? null,
    teamName: String(stats?.team?.name || "").trim() || null,
    played: Number(stats?.games?.played?.all || 0),
    wins: Number(stats?.games?.wins?.all?.total || 0),
    losses: Number(stats?.games?.loses?.all?.total || 0),
    runsForAvg: Number(stats?.points?.for?.average?.all || 0),
    runsAgainstAvg: Number(stats?.points?.against?.average?.all || 0)
  }
}

async function fetchMlbApiSportsScaffold({ events = [], now = Date.now(), sourceOptions = {} } = {}) {
  const safeEvents = Array.isArray(events) ? events : []
  const generatedAt = new Date(now).toISOString()
  const apiSportsKey = String(process.env.API_SPORTS_KEY || "").trim()

  const defaultSnapshot = {
    sport: "mlb",
    generatedAt,
    source: "mlb_api_sports",
    version: "phase-7-api-sports-live-v1",
    eventContextByEventId: {},
    probablePitchersByEventId: {},
    lineupConfirmationByEventId: {},
    teamContextByEventId: {},
    playersByPlayerKey: {},
    playersByEventId: {},
    recentStatsByPlayerKey: {},
    diagnostics: {
      hasExternalData: false,
      playerKeyCount: 0,
      eventContextCount: 0,
      playersByEventCount: 0,
      probablePitcherEventCount: 0,
      lineupConfirmationEventCount: 0,
      teamContextEventCount: 0,
      recentStatsPlayerCount: 0,
      fetchReadiness: {
        selectedSource: "mlb_api_sports",
        adapter: "fetchMlbApiSportsScaffold",
        mode: "live-fetch",
        fetchAttempted: false,
        eventCountInput: safeEvents.length,
        lineupsEndpointSupported: null,
        playersEndpointSupported: null,
        fallbackIdentityCacheKeys: 0,
        fallbackIdentityCandidatesApplied: 0,
        fallbackIdentityCandidatesAdded: 0,
        notes: []
      }
    }
  }

  if (!apiSportsKey) {
    return {
      ...defaultSnapshot,
      diagnostics: {
        ...defaultSnapshot.diagnostics,
        fetchReadiness: {
          ...defaultSnapshot.diagnostics.fetchReadiness,
          mode: "missing-api-key",
          notes: ["API_SPORTS_KEY is missing; no live MLB external fetch attempted."]
        }
      }
    }
  }

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
    eventByMatchKey.set(buildMatchKey(awayTeam, homeTeam, dateKey), {
      eventId,
      awayTeam,
      homeTeam,
      dateKey
    })
  }

  const cacheTtlMs = Number(sourceOptions?.cacheTtlMs || 15 * 60 * 1000)
  const cacheKey = [
    "phase-7-6-identity-seeding-v1",
    "mlb_api_sports",
    [...requestDateKeys].sort().join(","),
    `events=${safeEvents.length}`
  ].join("|")

  const cached = await getMlbExternalCacheEntry({
    cacheKey,
    maxAgeMs: Number.isFinite(cacheTtlMs) ? cacheTtlMs : 15 * 60 * 1000
  })
  if (cached?.data && typeof cached.data === "object") {
    return {
      ...cached.data,
      generatedAt,
      diagnostics: {
        ...(cached.data.diagnostics || {}),
        fetchReadiness: {
          ...(cached.data?.diagnostics?.fetchReadiness || {}),
          selectedSource: "mlb_api_sports",
          adapter: "fetchMlbApiSportsScaffold",
          mode: "cache-hit",
          fetchAttempted: true,
          eventCountInput: safeEvents.length,
          cacheAgeMs: Number(cached.ageMs || 0)
        }
      }
    }
  }

  const eventContextByEventId = {}
  const probablePitchersByEventId = {}
  const lineupConfirmationByEventId = {}
  const teamContextByEventId = {}
  const playersByPlayerKey = {}
  const playersByEventId = {}

  const cachedIdentityState = await getMlbPlayerIdentityCache()
  const cachedPlayersByPlayerKey = ensureObject(cachedIdentityState?.playersByPlayerKey)

  const notes = []
  const fetchErrors = []
  let apiGamesFetched = 0
  let apiGamesMatchedToSlate = 0
  let lineupsFetched = 0
  let lineupRowsFound = 0
  let lineupGamesWithData = 0
  let lineupsEndpointUnsupported = false
  let teamStatsFetched = 0
  let teamStatsMissing = 0
  let teamRosterCalls = 0
  let teamRosterRowsFound = 0
  let teamRosterTeamsWithData = 0
  let playersEndpointUnsupported = false
  let fallbackIdentityCandidatesApplied = 0

  const apiGameByMatchKey = new Map()

  for (const dateKey of [...requestDateKeys]) {
    try {
      const season = Number(String(dateKey).slice(0, 4))
      const games = await fetchApiSportsGamesForDate({ dateKey, season, apiSportsKey })
      apiGamesFetched += games.length

      for (const game of games) {
        const gameDateKey = toUtcDateKey(game?.date)
        const matchKey = buildMatchKey(game?.teams?.away?.name, game?.teams?.home?.name, gameDateKey)
        if (matchKey) apiGameByMatchKey.set(matchKey, game)
      }
    } catch (error) {
      fetchErrors.push({
        stage: "games",
        dateKey,
        error: String(error?.response?.data?.message || error?.message || error)
      })
    }
  }

  const lineupsByGameId = new Map()
  const teamStatsByTeamId = new Map()
  const rosterPlayersByTeamId = new Map()

  for (const [matchKey, eventRef] of eventByMatchKey.entries()) {
    const game = apiGameByMatchKey.get(matchKey)
    if (!game) continue

    apiGamesMatchedToSlate += 1
    const gameId = Number(game?.id)

    if (Number.isFinite(gameId) && !lineupsEndpointUnsupported) {
      try {
        const lineups = await fetchApiSportsLineupsForGame({ gameId, apiSportsKey })
        lineupsByGameId.set(gameId, lineups)
        lineupsFetched += 1
        lineupRowsFound += lineups.length
        if (lineups.length > 0) lineupGamesWithData += 1
      } catch (error) {
        if (String(error?.code || "") === "LINEUPS_ENDPOINT_UNSUPPORTED") {
          lineupsEndpointUnsupported = true
          notes.push("API-Sports lineups endpoint is unsupported for current account/source; lineup-based identity seeding disabled.")
        } else {
          fetchErrors.push({
            stage: "lineups",
            gameId,
            eventId: eventRef.eventId,
            error: String(error?.response?.data?.message || error?.message || error)
          })
        }
        lineupsByGameId.set(gameId, [])
      }
    } else if (Number.isFinite(gameId)) {
      lineupsByGameId.set(gameId, [])
    }

    const season = Number(game?.league?.season || String(eventRef.dateKey || "").slice(0, 4))
    for (const sideTeam of [game?.teams?.home, game?.teams?.away]) {
      const teamId = Number(sideTeam?.id)
      if (!Number.isFinite(teamId) || teamStatsByTeamId.has(teamId)) continue

      try {
        const teamStats = await fetchApiSportsTeamStatistics({ teamId, season, apiSportsKey })
        if (teamStats) {
          teamStatsByTeamId.set(teamId, teamStats)
          teamStatsFetched += 1
        } else {
          teamStatsMissing += 1
        }
      } catch (error) {
        teamStatsMissing += 1
        fetchErrors.push({
          stage: "team-statistics",
          teamId,
          error: String(error?.response?.data?.message || error?.message || error)
        })
      }

      if (!playersEndpointUnsupported && !rosterPlayersByTeamId.has(teamId)) {
        try {
          const rosterPlayers = await fetchApiSportsRosterForTeam({ teamId, season, apiSportsKey })
          rosterPlayersByTeamId.set(teamId, rosterPlayers)
          teamRosterCalls += 1
          teamRosterRowsFound += rosterPlayers.length
          if (rosterPlayers.length > 0) teamRosterTeamsWithData += 1
        } catch (error) {
          if (String(error?.code || "") === "PLAYERS_ENDPOINT_UNSUPPORTED") {
            playersEndpointUnsupported = true
            notes.push("API-Sports players endpoint is unsupported for current account/source; roster-based identity seeding disabled.")
          } else {
            fetchErrors.push({
              stage: "players-team-roster",
              teamId,
              error: String(error?.response?.data?.message || error?.message || error)
            })
          }
          rosterPlayersByTeamId.set(teamId, [])
        }
      }
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

    const game = apiGameByMatchKey.get(matchKey)
    if (!game) continue

    const gameId = Number(game?.id)
    const lineups = Number.isFinite(gameId) ? (lineupsByGameId.get(gameId) || []) : []
    const lineupBySide = buildLineupBySide(lineups, game)
    const homePlayers = extractLineupPlayers(lineupBySide.home)
    const awayPlayers = extractLineupPlayers(lineupBySide.away)
    const homePitcher = extractProbablePitcher(homePlayers)
    const awayPitcher = extractProbablePitcher(awayPlayers)

    const context = {
      ...toEventContext(event),
      eventId,
      matchup: `${String(game?.teams?.away?.name || "").trim()} @ ${String(game?.teams?.home?.name || "").trim()}`,
      gameTime: game?.date || event?.gameTime || event?.commence_time || null,
      homeTeam: String(game?.teams?.home?.name || toTeamFromEvent(event, "home") || "").trim() || null,
      awayTeam: String(game?.teams?.away?.name || toTeamFromEvent(event, "away") || "").trim() || null,
      probablePitchers: {
        home: homePitcher,
        away: awayPitcher,
        source: "api-sports-lineups"
      },
      lineupConfirmation: {
        homeConfirmed: homePlayers.length >= 9,
        awayConfirmed: awayPlayers.length >= 9,
        homeStarterCount: homePlayers.length,
        awayStarterCount: awayPlayers.length,
        source: "api-sports-lineups"
      }
    }

    eventContextByEventId[eventId] = context

    if (homePitcher || awayPitcher) {
      probablePitchersByEventId[eventId] = context.probablePitchers
    }

    if (homePlayers.length > 0 || awayPlayers.length > 0) {
      lineupConfirmationByEventId[eventId] = context.lineupConfirmation
    }

    teamContextByEventId[eventId] = {
      eventId,
      apiSportsGameId: Number.isFinite(gameId) ? gameId : null,
      status: String(game?.status?.short || game?.status?.long || "").trim() || null,
      league: {
        id: game?.league?.id ?? null,
        name: String(game?.league?.name || "").trim() || null,
        season: game?.league?.season ?? null
      },
      homeTeam: {
        id: game?.teams?.home?.id ?? null,
        name: String(game?.teams?.home?.name || "").trim() || null,
        teamCode: resolveTeamCode(game?.teams?.home?.name || "") || null,
        stats: toTeamContextFromStats(teamStatsByTeamId.get(Number(game?.teams?.home?.id)) || null)
      },
      awayTeam: {
        id: game?.teams?.away?.id ?? null,
        name: String(game?.teams?.away?.name || "").trim() || null,
        teamCode: resolveTeamCode(game?.teams?.away?.name || "") || null,
        stats: toTeamContextFromStats(teamStatsByTeamId.get(Number(game?.teams?.away?.id)) || null)
      },
      source: "api-sports-live"
    }

    const lineupCandidates = [
      ...homePlayers.map((player) => ({ ...player, teamName: game?.teams?.home?.name })),
      ...awayPlayers.map((player) => ({ ...player, teamName: game?.teams?.away?.name }))
    ]

    const homeTeamId = Number(game?.teams?.home?.id)
    const awayTeamId = Number(game?.teams?.away?.id)
    const homeRosterCandidates = Number.isFinite(homeTeamId)
      ? ensureArray(rosterPlayersByTeamId.get(homeTeamId)).map((player) => ({
          ...player,
          teamName: game?.teams?.home?.name,
          source: "api-sports-team-roster"
        }))
      : []
    const awayRosterCandidates = Number.isFinite(awayTeamId)
      ? ensureArray(rosterPlayersByTeamId.get(awayTeamId)).map((player) => ({
          ...player,
          teamName: game?.teams?.away?.name,
          source: "api-sports-team-roster"
        }))
      : []

    const eventPlayerCandidates = [
      ...lineupCandidates,
      ...homeRosterCandidates,
      ...awayRosterCandidates
    ]

    if (eventPlayerCandidates.length > 0) {
      playersByEventId[eventId] = []
    }

    for (const candidate of eventPlayerCandidates) {
      const playerName = String(candidate?.playerName || "").trim()
      const playerKey = normalizeMlbPlayerKey(playerName)
      if (!playerKey) continue

      const candidateRow = {
        playerIdExternal: candidate?.playerIdExternal ?? null,
        playerName,
        playerKey,
        teamResolved: String(candidate?.teamName || "").trim() || null,
        teamCode: resolveTeamCode(candidate?.teamName || "") || null,
        source: String(candidate?.source || "api-sports-lineups").trim() || "api-sports-lineups",
        eventIds: [eventId]
      }

      playersByEventId[eventId].push(candidateRow)

      if (!Array.isArray(playersByPlayerKey[playerKey])) {
        playersByPlayerKey[playerKey] = []
      }

      const alreadyExists = playersByPlayerKey[playerKey].some((row) => {
        return String(row?.teamResolved || "") === String(candidateRow.teamResolved || "")
      })

      if (!alreadyExists) {
        playersByPlayerKey[playerKey].push(candidateRow)
      }
    }
  }

  for (const [playerKey, cachedCandidates] of Object.entries(cachedPlayersByPlayerKey)) {
    const safeKey = String(playerKey || "").trim()
    if (!safeKey) continue

    if (!Array.isArray(playersByPlayerKey[safeKey])) {
      playersByPlayerKey[safeKey] = []
    }

    for (const cachedCandidate of ensureArray(cachedCandidates)) {
      const candidateRow = {
        playerIdExternal: cachedCandidate?.playerIdExternal ?? null,
        playerName: String(cachedCandidate?.playerName || "").trim() || null,
        playerKey: String(cachedCandidate?.playerKey || safeKey).trim() || safeKey,
        teamResolved: String(cachedCandidate?.teamResolved || "").trim() || null,
        teamCode: String(cachedCandidate?.teamCode || resolveTeamCode(cachedCandidate?.teamResolved || "") || "").trim() || null,
        source: "identity-cache",
        eventIds: ensureArray(cachedCandidate?.eventIds)
          .map((eventId) => String(eventId || "").trim())
          .filter(Boolean)
      }

      if (!candidateRow.playerName) continue

      const exists = playersByPlayerKey[safeKey].some((existing) => {
        const sameName = String(existing?.playerName || "") === String(candidateRow.playerName || "")
        const sameTeam = String(existing?.teamResolved || "") === String(candidateRow.teamResolved || "")
        return sameName && sameTeam
      })
      if (exists) continue

      playersByPlayerKey[safeKey].push(candidateRow)
      fallbackIdentityCandidatesApplied += 1
    }
  }

  const identityCandidatesToPersist = []
  for (const rowsForKey of Object.values(playersByPlayerKey)) {
    for (const row of ensureArray(rowsForKey)) {
      if (String(row?.source || "") === "identity-cache") continue
      identityCandidatesToPersist.push(row)
    }
  }
  const identityCacheMerge = await mergeMlbPlayerIdentityCache({
    candidates: identityCandidatesToPersist
  })

  if (apiGamesFetched === 0) {
    notes.push("API-Sports games endpoint returned no MLB games for requested slate dates.")
  }
  if (apiGamesMatchedToSlate === 0) {
    notes.push("No API-Sports MLB games matched Odds API slate events by matchup/date.")
  }
  if (lineupGamesWithData === 0) {
    notes.push("API-Sports lineups endpoint returned no starter rows for matched games; probable pitcher coverage unavailable in current window.")
  }
  if (teamRosterTeamsWithData === 0) {
    notes.push("No team-roster player rows were available for matched event teams in current window.")
  }
  if (Object.keys(cachedPlayersByPlayerKey).length === 0) {
    notes.push("Fallback MLB identity cache has no player keys yet; unresolved rows will remain high until lineup/player identity data is observed.")
  }
  if (Object.keys(cachedPlayersByPlayerKey).length > 0 && fallbackIdentityCandidatesApplied === 0) {
    notes.push("Fallback MLB identity cache loaded but did not add new candidates for current snapshot keys.")
  }
  if (teamStatsFetched === 0) {
    notes.push("API-Sports team statistics endpoint returned no team stats for matched teams.")
  }

  const liveSnapshot = {
    ...defaultSnapshot,
    eventContextByEventId,
    probablePitchersByEventId,
    lineupConfirmationByEventId,
    teamContextByEventId,
    playersByPlayerKey,
    playersByEventId,
    diagnostics: {
      ...defaultSnapshot.diagnostics,
      hasExternalData:
        Object.keys(eventContextByEventId).length > 0 ||
        Object.keys(teamContextByEventId).length > 0 ||
        Object.keys(playersByEventId).length > 0,
      fetchReadiness: {
        ...defaultSnapshot.diagnostics.fetchReadiness,
        mode: fetchErrors.length > 0 ? "live-fetch-partial" : "live-fetch-ok",
        fetchAttempted: true,
        apiGamesFetched,
        apiGamesMatchedToSlate,
        lineupCalls: lineupsFetched,
        lineupRowsFound,
        lineupGamesWithData,
        lineupsEndpointSupported: !lineupsEndpointUnsupported,
        teamStatsFetched,
        teamStatsMissing,
        teamRosterCalls,
        teamRosterRowsFound,
        teamRosterTeamsWithData,
        playersEndpointSupported: !playersEndpointUnsupported,
        fallbackIdentityCacheKeys: Object.keys(cachedPlayersByPlayerKey).length,
        fallbackIdentityCandidatesApplied,
        fallbackIdentityCandidatesAdded: Number(identityCacheMerge?.added || 0),
        fallbackIdentityCacheTotalKeys: Number(identityCacheMerge?.totalKeys || 0),
        fetchErrors,
        notes
      }
    }
  }

  await setMlbExternalCacheEntry({
    cacheKey,
    data: liveSnapshot
  })

  return liveSnapshot
}

module.exports = {
  fetchMlbApiSportsScaffold
}
