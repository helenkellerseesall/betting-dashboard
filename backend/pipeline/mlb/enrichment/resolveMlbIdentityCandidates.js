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
    batterHand: String(value.batterHand || "").trim().toUpperCase() || null,
    pitcherHand: String(value.pitcherHand || "").trim().toUpperCase() || null,
    battingOrderIndex: Number.isFinite(Number(value.battingOrderIndex)) ? Number(value.battingOrderIndex) : null,
    source: String(value.source || "external-unknown").trim() || "external-unknown",
    eventIds: normalizeArray(value.eventIds)
      .map((eventId) => String(eventId || "").trim())
      .filter(Boolean)
  }
}

function normalizeNameForAlias(value) {
  return normalizeMlbText(value)
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function candidateMatchesPlayerAliases(candidate, aliasKeySet, playerNameNormalized) {
  const candidatePlayerKey = String(candidate?.playerKey || "").trim()
  if (candidatePlayerKey && aliasKeySet.has(candidatePlayerKey)) return true

  const candidateNameNormalized = normalizeNameForAlias(String(candidate?.playerName || ""))
  if (candidateNameNormalized && playerNameNormalized && candidateNameNormalized === playerNameNormalized) return true

  return false
}

function buildPlayerKeyAliases(playerName) {
  const original = String(playerName || "").trim()
  const aliases = new Set()

  const canonical = normalizeMlbPlayerKey(original)
  if (canonical) aliases.add(canonical)

  const simplified = normalizeNameForAlias(original)
  if (simplified) {
    aliases.add(normalizeMlbPlayerKey(simplified))
    const parts = simplified.split(" ").filter(Boolean)
    if (parts.length >= 2) {
      const initial = String(parts[0] || "").slice(0, 1)
      const last = String(parts[parts.length - 1] || "")
      const initialLast = normalizeMlbPlayerKey(`${initial} ${last}`)
      if (initialLast) aliases.add(initialLast)
    }
  }

  return [...aliases].filter(Boolean)
}

function matchesAnyEventTeam(candidate, eventTeams) {
  const teams = Array.isArray(eventTeams) ? eventTeams : []
  if (teams.length === 0) return false

  const candidateTeam = normalizeMlbText(candidate?.teamResolved || "")
  if (!candidateTeam) return false
  return teams.some((teamName) => normalizeMlbText(teamName) === candidateTeam)
}

function dedupeCandidates(rows) {
  const seen = new Set()
  const out = []
  for (const row of normalizeArray(rows)) {
    const candidate = toCandidate(row)
    if (!candidate) continue
    const key = [
      String(candidate.playerKey || ""),
      String(candidate.playerName || ""),
      String(candidate.teamResolved || ""),
      String(candidate.source || "")
    ].join("|")
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

function collectProbablePitcherCandidates({ probablePitchersByEventId, eventId }) {
  const out = []
  const probable = normalizeObject(probablePitchersByEventId)[String(eventId || "")]
  if (!probable || typeof probable !== "object") return out

  for (const side of ["home", "away"]) {
    const pitcher = probable?.[side]
    const playerName = String(pitcher?.playerName || "").trim()
    if (!playerName) continue
    out.push({
      playerIdExternal: pitcher?.playerIdExternal ?? null,
      playerName,
      playerKey: normalizeMlbPlayerKey(playerName),
      teamResolved: null,
      teamCode: null,
      source: "event-probable-pitcher",
      eventIds: [String(eventId || "").trim()].filter(Boolean)
    })
  }

  return out
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
  const eventIdsMatched = eventCandidates.filter((candidate) => candidateMatchesEvent(candidate, eventId))
  if (eventIdsMatched.length > 0) {
    return { candidate: eventIdsMatched[0], confidence: 0.94, source: "external-event-playerkey" }
  }

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

function pickBestCandidateTeamAware({ eventCandidates, keyCandidates, eventId, eventTeams }) {
  const eventTeamFiltered = eventCandidates.filter((candidate) => matchesAnyEventTeam(candidate, eventTeams))
  if (eventTeamFiltered.length > 0) {
    const withEventId = eventTeamFiltered.find((candidate) => candidateMatchesEvent(candidate, eventId))
    if (withEventId) {
      return { candidate: withEventId, confidence: 0.95, source: "external-event-team-aware" }
    }
    return { candidate: eventTeamFiltered[0], confidence: 0.84, source: "external-event-team-aware" }
  }

  const keyTeamFiltered = keyCandidates.filter((candidate) => matchesAnyEventTeam(candidate, eventTeams))
  if (keyTeamFiltered.length === 1) {
    return { candidate: keyTeamFiltered[0], confidence: 0.72, source: "external-playerkey-team-aware" }
  }

  if (keyTeamFiltered.length > 1) {
    return { candidate: null, confidence: 0, source: "unresolved-team-ambiguous" }
  }

  return pickBestCandidate({ eventCandidates, keyCandidates, eventId })
}

function resolveMlbIdentityForRow({ row, externalSnapshot }) {
  const safeRow = row || {}
  const safeExternal = normalizeObject(externalSnapshot)
  const player = String(safeRow?.player || "").trim()
  const eventId = String(safeRow?.eventId || "").trim()
  const marketFamily = String(safeRow?.marketFamily || "")

  const matchupContext = deriveMatchupContext(safeRow)
  const playerKey = normalizeMlbPlayerKey(player)
  const aliasKeys = buildPlayerKeyAliases(player)
  const aliasKeySet = new Set(aliasKeys)
  const playerNameNormalized = normalizeNameForAlias(player)

  // Non-player game markets still get team/opponent context fields for consistency.
  if (!player || marketFamily === "game") {
    return {
      playerKey: playerKey || null,
      teamResolved: matchupContext.teamResolved,
      teamCode: matchupContext.teamCode,
      opponentTeam: matchupContext.opponentTeam,
      isHome: matchupContext.isHome,
      batterHand: null,
      battingOrderIndex: null,
      playerIdExternal: null,
      identityConfidence: null,
      identitySource: "matchup-context-only",
      unresolvedReason: null
    }
  }

  const playersByPlayerKey = normalizeObject(safeExternal.playersByPlayerKey)
  const playersByEventId = normalizeObject(safeExternal.playersByEventId)
  const probablePitchersByEventId = normalizeObject(safeExternal.probablePitchersByEventId)
  const teamContextByEventId = normalizeObject(safeExternal.teamContextByEventId)

  const eventTeams = []
  const teamContext = normalizeObject(teamContextByEventId[eventId])
  const externalHome = String(teamContext?.homeTeam?.name || "").trim()
  const externalAway = String(teamContext?.awayTeam?.name || "").trim()
  if (externalHome) eventTeams.push(externalHome)
  if (externalAway) eventTeams.push(externalAway)
  if (matchupContext.homeTeam) eventTeams.push(matchupContext.homeTeam)
  if (matchupContext.awayTeam) eventTeams.push(matchupContext.awayTeam)

  const keyCandidateRows = []
  for (const aliasKey of aliasKeys) {
    keyCandidateRows.push(...normalizeArray(playersByPlayerKey[aliasKey]))
  }

  const keyCandidates = dedupeCandidates(keyCandidateRows)
  const probablePitcherCandidates = collectProbablePitcherCandidates({ probablePitchersByEventId, eventId })
  const eventCandidatesRaw = dedupeCandidates([
    ...normalizeArray(playersByEventId[eventId]),
    ...probablePitcherCandidates
  ])
  const eventCandidates = eventCandidatesRaw.filter((candidate) => candidateMatchesPlayerAliases(candidate, aliasKeySet, playerNameNormalized))

  const chosen = pickBestCandidateTeamAware({
    eventCandidates,
    keyCandidates,
    eventId,
    eventTeams
  })

  const candidate = chosen.candidate

  // If we have no external match, keep neutral scaffold fields so current behavior is unchanged.
  if (!candidate) {
    let unresolvedReason = "no-candidate"
    if (eventCandidates.length === 0 && keyCandidates.length === 0) {
      unresolvedReason = "no-external-player-candidates"
    } else if (String(chosen.source || "").includes("ambiguous")) {
      unresolvedReason = "team-ambiguous-candidates"
    } else if (eventCandidates.length > 0 && keyCandidates.length === 0) {
      unresolvedReason = "event-candidates-no-playerkey-match"
    } else if (eventCandidates.length === 0 && keyCandidates.length > 0) {
      unresolvedReason = "playerkey-candidates-no-event-match"
    }

    return {
      playerKey: playerKey || null,
      teamResolved: null,
      teamCode: null,
      opponentTeam: null,
      isHome: null,
      batterHand: null,
      battingOrderIndex: null,
      playerIdExternal: null,
      identityConfidence: 0,
      identitySource: chosen.source,
      unresolvedReason
    }
  }

  const candidateTeam = String(candidate.teamResolved || "").trim() || null
  const teamMatchesEvent = candidateTeam
    ? eventTeams.some((teamName) => normalizeMlbText(teamName) === normalizeMlbText(candidateTeam))
    : false

  // Keep null over wrong-team assignment when identity exists but event-team alignment is not trustworthy.
  if (candidateTeam && eventTeams.length > 0 && !teamMatchesEvent) {
    return {
      playerKey: playerKey || candidate.playerKey || null,
      teamResolved: null,
      teamCode: null,
      opponentTeam: null,
      isHome: null,
      batterHand: null,
      battingOrderIndex: null,
      playerIdExternal: candidate.playerIdExternal,
      identityConfidence: 0,
      identitySource: "unresolved-event-team-mismatch",
      unresolvedReason: "candidate-team-not-in-event"
    }
  }

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
    batterHand: candidate?.batterHand || null,
    battingOrderIndex: Number.isFinite(Number(candidate?.battingOrderIndex)) ? Number(candidate.battingOrderIndex) : null,
    playerIdExternal: candidate.playerIdExternal,
    identityConfidence: Number(chosen.confidence.toFixed(3)),
    identitySource: chosen.source,
    unresolvedReason: null
  }
}

module.exports = {
  resolveMlbIdentityForRow,
  resolveTeamCode
}
