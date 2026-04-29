"use strict"

const { rowTeamMatchesMatchup } = require("../resolution/playerTeamResolution")

function clampStr(v) {
  const s = String(v == null ? "" : v).trim()
  return s ? s : null
}

function normTeamToken(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
}

/**
 * True if `candidate` refers to the same franchise as `reference` (abbr vs full name safe).
 */
function teamsLikelyEqual(candidate, reference) {
  const a = normTeamToken(candidate)
  const b = normTeamToken(reference)
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true
  return false
}

function parseMatchupTeams(matchup) {
  const m = String(matchup || "").trim()
  const parts = m.split("@").map((s) => s.trim())
  if (parts.length !== 2) return { awayTeam: null, homeTeam: null }
  return { awayTeam: parts[0] || null, homeTeam: parts[1] || null }
}

/**
 * @param {object[]} events - snapshot.events (Odds API / slate-normalized)
 * @returns {Map<string, { homeTeam: string|null, awayTeam: string|null, matchup: string|null }>}
 */
function buildNbaEventTeamIndex(events) {
  const map = new Map()
  for (const ev of Array.isArray(events) ? events : []) {
    const id = String(ev?.eventId ?? ev?.id ?? ev?.event_id ?? "").trim()
    if (!id) continue
    const homeTeam = clampStr(ev?.homeTeam ?? ev?.home_team ?? ev?.home)
    const awayTeam = clampStr(ev?.awayTeam ?? ev?.away_team ?? ev?.away)
    const matchup = clampStr(ev?.matchup)
    map.set(id, { homeTeam, awayTeam, matchup })
  }
  return map
}

function eventMetaFromRow(row, eventIndex) {
  const eid = clampStr(row?.eventId)
  if (eid && eventIndex.has(eid)) return eventIndex.get(eid)

  const parsed = parseMatchupTeams(row?.matchup)
  if (parsed.homeTeam || parsed.awayTeam) {
    return {
      homeTeam: parsed.homeTeam,
      awayTeam: parsed.awayTeam,
      matchup: clampStr(row?.matchup),
    }
  }

  const homeTeam = clampStr(row?.homeTeam ?? row?.home_team)
  const awayTeam = clampStr(row?.awayTeam ?? row?.away_team)
  if (homeTeam || awayTeam) return { homeTeam, awayTeam, matchup: clampStr(row?.matchup) }

  return null
}

/**
 * Resolve `team` / `opponent` from event home/away + row hints. Never invent a third team.
 * @returns {{ team: string|null, opponent: string|null, homeTeam: string|null, awayTeam: string|null }}
 */
function resolveNbaRowTeamContext(row, eventMeta) {
  let homeTeam = eventMeta?.homeTeam || null
  let awayTeam = eventMeta?.awayTeam || null

  const rh = clampStr(row?.homeTeam ?? row?.home_team)
  const ra = clampStr(row?.awayTeam ?? row?.away_team)
  if (homeTeam && awayTeam) {
    /* keep event meta */
  } else if (rh && ra) {
    homeTeam = rh
    awayTeam = ra
  } else if (rh || ra) {
    homeTeam = homeTeam || rh
    awayTeam = awayTeam || ra
  }

  if (!homeTeam && !awayTeam) {
    return { team: null, opponent: null, homeTeam: null, awayTeam: null }
  }

  const candidates = [
    row?.teamResolved,
    row?.teamCanonical,
    row?.playerTeam,
    row?.participantTeam,
    row?.participant_team,
    row?.player_team,
    row?.outcomeTeam,
    row?.team,
  ]
    .map(clampStr)
    .filter(Boolean)

  function pickCanonical(sideTeam, otherTeam) {
    const probe = { ...row, team: sideTeam, homeTeam, awayTeam }
    if (!rowTeamMatchesMatchup(probe)) return null
    return { team: sideTeam, opponent: otherTeam || null, homeTeam, awayTeam }
  }

  for (const cand of candidates) {
    if (homeTeam && teamsLikelyEqual(cand, homeTeam)) {
      const picked = pickCanonical(homeTeam, awayTeam)
      if (picked) return picked
    }
    if (awayTeam && teamsLikelyEqual(cand, awayTeam)) {
      const picked = pickCanonical(awayTeam, homeTeam)
      if (picked) return picked
    }
  }

  return { team: null, opponent: null, homeTeam, awayTeam }
}

/**
 * Attach canonical home/away + resolved team/opponent when confident.
 * @param {Map<string, object>} eventIndex
 * @param {Record<string, string>|null} playerTeamIndex from `buildSpecialtyPlayerTeamIndex` (cross-row vote)
 */
function enrichNbaRowWithEventTeams(row, eventIndex, playerTeamIndex = null) {
  if (!row || typeof row !== "object") return row
  const meta = eventMetaFromRow(row, eventIndex)
  const ctx = resolveNbaRowTeamContext(row, meta)

  const out = { ...row }
  if (ctx.homeTeam) out.homeTeam = ctx.homeTeam
  if (ctx.awayTeam) out.awayTeam = ctx.awayTeam
  if (ctx.team) {
    out.team = ctx.team
    out.opponent = ctx.opponent
    out.opponentTeam = ctx.opponent
  }

  const homeTeam = out.homeTeam || ctx.homeTeam || null
  const awayTeam = out.awayTeam || ctx.awayTeam || null
  const pk = String(row.player || "")
    .trim()
    .toLowerCase()
  const voted = playerTeamIndex && pk ? playerTeamIndex[pk] : null

  if (voted && homeTeam && awayTeam) {
    const probeBase = { ...out, homeTeam, awayTeam }
    if (!rowTeamMatchesMatchup({ ...probeBase, team: voted })) return out
    const same = out.team && teamsLikelyEqual(out.team, voted)
    if (!same) {
      out.team = voted
      out.opponent = teamsLikelyEqual(voted, homeTeam) ? awayTeam : homeTeam
      out.opponentTeam = out.opponent
    }
  }

  return out
}

module.exports = {
  buildNbaEventTeamIndex,
  enrichNbaRowWithEventTeams,
}
