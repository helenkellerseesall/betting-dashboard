"use strict"

const { MLB_TEAM_ABBR_MAP } = require("../../resolution/mlbTeamResolution")
const { normalizeArray, normalizeObject } = require("./buildMlbExternalSnapshotScaffold")
const { normalizeMlbPlayerKey, normalizeMlbText } = require("./mlbPlayerKey")

function buildTeamCodeByName() {
  const out = {}

  for (const [abbr, fullName] of Object.entries(MLB_TEAM_ABBR_MAP || {})) {
    const normalizedName = normalizeMlbText(fullName)
    if (!normalizedName) continue

    // Prefer common 3-letter code for canonical output.
    if (!out[normalizedName] || String(abbr).length === 3) {
      out[normalizedName] = String(abbr).toUpperCase()
    }
  }

  return out
}

const TEAM_CODE_BY_NAME = buildTeamCodeByName()

function resolveTeamCode(teamName) {
  const normalized = normalizeMlbText(teamName)
  if (!normalized) return null
  return TEAM_CODE_BY_NAME[normalized] || null
}

function toCandidate(value) {
  if (!value || typeof value !== "object") return null

  return {
    playerIdExternal: value.playerIdExternal ?? value.playerId ?? null,
    playerName: String(value.playerName || value.name || "").trim() || null,
    playerKey: String(value.playerKey || normalizeMlbPlayerKey(value.playerName || value.name || "")).trim() || null,
    teamResolved: String(value.teamResolved || value.team || "").trim() || null,
    teamCode: String(value.teamCode || resolveTeamCode(value.teamResolved || value.team || "") || "").trim() || null,
    source: String(value.source || "external-unknown").trim() || "external-unknown",
    eventIds: normalizeArray(value.eventIds)
      .map((eventId) => String(eventId || "").trim())
      .filter(Boolean)
  }
}

function candidateMatchesEvent(candidate, eventId) {
  if (!candidate) return false
  const safeEventId = String(eventId || "").trim()
  if (!safeEventId) return false
  return Array.isArray(candidate.eventIds) && candidate.eventIds.includes(safeEventId)
}

function deriveMatchupContext(row) {
  const awayTeam = String(row?.awayTeam || "").trim() || null
  const homeTeam = String(row?.homeTeam || "").trim() || null

  let teamResolved = null
  let teamCode = null
  let opponentTeam = null
  let isHome = null

  // For non-player markets, player often holds team name in h2h/spreads/totals rows.
  const playerAsTeam = String(row?.player || "").trim()
  const playerAsTeamNorm = normalizeMlbText(playerAsTeam)

  const awayNorm = normalizeMlbText(awayTeam)
  const homeNorm = normalizeMlbText(homeTeam)

  if (playerAsTeamNorm && awayNorm && playerAsTeamNorm === awayNorm) {
    teamResolved = awayTeam
    teamCode = resolveTeamCode(awayTeam)
    opponentTeam = homeTeam
    isHome = false
  } else if (playerAsTeamNorm && homeNorm && playerAsTeamNorm === homeNorm) {
    teamResolved = homeTeam
    teamCode = resolveTeamCode(homeTeam)
    opponentTeam = awayTeam
    isHome = true
  }

  return {
    awayTeam,
    homeTeam,
    teamResolved,
    teamCode,
    opponentTeam,
    isHome
  }
}

function pickBestCandidate({ eventCandidates, keyCandidates, eventId }) {
  for (const candidate of eventCandidates) {
    if (candidateMatchesEvent(candidate, eventId)) {
      return { candidate, confidence: 0.92, source: "external-event-playerkey" }
    }
  }

  if (eventCandidates.length > 0) {
    return { candidate: eventCandidates[0], confidence: 0.78, source: "external-event" }
  }

  if (keyCandidates.length > 0) {
    return { candidate: keyCandidates[0], confidence: 0.66, source: "external-playerkey" }
  }

  return { candidate: null, confidence: 0, source: "unresolved" }
}

function resolveMlbIdentityForRow({ row, externalSnapshot }) {
  const safeRow = row || {}
  const safeExternal = normalizeObject(externalSnapshot)
  const player = String(safeRow?.player || "").trim()
  const eventId = String(safeRow?.eventId || "").trim()
  const marketFamily = String(safeRow?.marketFamily || "")

  const matchupContext = deriveMatchupContext(safeRow)
  const playerKey = normalizeMlbPlayerKey(player)

  // Non-player game markets still get team/opponent context fields for consistency.
  if (!player || marketFamily === "game") {
    return {
      playerKey: playerKey || null,
      teamResolved: matchupContext.teamResolved,
      teamCode: matchupContext.teamCode,
      opponentTeam: matchupContext.opponentTeam,
      isHome: matchupContext.isHome,
      playerIdExternal: null,
      identityConfidence: null,
      identitySource: "matchup-context-only"
    }
  }

  const playersByPlayerKey = normalizeObject(safeExternal.playersByPlayerKey)
  const playersByEventId = normalizeObject(safeExternal.playersByEventId)

  const keyCandidates = normalizeArray(playersByPlayerKey[playerKey]).map(toCandidate).filter(Boolean)
  const eventCandidates = normalizeArray(playersByEventId[eventId]).map(toCandidate).filter(Boolean)

  const chosen = pickBestCandidate({
    eventCandidates,
    keyCandidates,
    eventId
  })

  const candidate = chosen.candidate

  // If we have no external match, keep neutral scaffold fields so current behavior is unchanged.
  if (!candidate) {
    return {
      playerKey: playerKey || null,
      teamResolved: null,
      teamCode: null,
      opponentTeam: null,
      isHome: null,
      playerIdExternal: null,
      identityConfidence: 0,
      identitySource: chosen.source
    }
  }

  const candidateTeam = String(candidate.teamResolved || "").trim() || null
  const candidateTeamCode = String(candidate.teamCode || "").trim() || resolveTeamCode(candidateTeam)

  let isHome = null
  let opponentTeam = null
  if (candidateTeam && matchupContext.homeTeam && normalizeMlbText(candidateTeam) === normalizeMlbText(matchupContext.homeTeam)) {
    isHome = true
    opponentTeam = matchupContext.awayTeam
  } else if (candidateTeam && matchupContext.awayTeam && normalizeMlbText(candidateTeam) === normalizeMlbText(matchupContext.awayTeam)) {
    isHome = false
    opponentTeam = matchupContext.homeTeam
  }

  return {
    playerKey: playerKey || candidate.playerKey || null,
    teamResolved: candidateTeam,
    teamCode: candidateTeamCode || null,
    opponentTeam: opponentTeam || null,
    isHome,
    playerIdExternal: candidate.playerIdExternal,
    identityConfidence: Number(chosen.confidence.toFixed(3)),
    identitySource: chosen.source
  }
}

module.exports = {
  resolveMlbIdentityForRow,
  resolveTeamCode
}
