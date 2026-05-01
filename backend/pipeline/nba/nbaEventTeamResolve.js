"use strict"

const fs = require("fs")
const path = require("path")

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

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Per-event pace / total + sides (for matchup + environment wiring onto prop rows).
 * @param {object[]} events
 * @returns {Map<string, { homeTeam: string|null, awayTeam: string|null, pace: number|null, gameTotal: number|null }>}
 */
function buildNbaEventGameContextMap(events) {
  const map = new Map()
  for (const ev of Array.isArray(events) ? events : []) {
    const id = String(ev?.eventId ?? ev?.id ?? ev?.event_id ?? "").trim()
    if (!id) continue
    const homeTeam = clampStr(ev?.homeTeam ?? ev?.home_team ?? ev?.home)
    const awayTeam = clampStr(ev?.awayTeam ?? ev?.away_team ?? ev?.away)
    const pace = toNum(ev?.pace ?? ev?.projectedPace ?? ev?.gamePace ?? ev?.eventPace)
    const gameTotal = toNum(ev?.gameTotal ?? ev?.total ?? ev?.overUnder ?? ev?.eventTotal)
    map.set(id, { homeTeam, awayTeam, pace, gameTotal })
  }
  return map
}

/**
 * Derive pace / total / sides from prop rows when slate events omit them (same signals as nightly report).
 * @param {object[]} rows merged snapshot prop rows
 * @returns {Map<string, { homeTeam: string|null, awayTeam: string|null, pace: number|null, gameTotal: number|null }>}
 */
function inferNbaEventGameContextFromPropRows(rows) {
  const agg = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const eid = String(row?.eventId || "").trim()
    if (!eid) continue
    if (!agg.has(eid)) {
      agg.set(eid, {
        gameTotals: [],
        paces: [],
        spreads: [],
        homeTeam: null,
        awayTeam: null,
      })
    }
    const a = agg.get(eid)
    const gt = toNum(row?.gameTotal ?? row?.eventTotal ?? row?.total ?? row?.overUnder)
    if (Number.isFinite(gt)) a.gameTotals.push(gt)
    const pc = toNum(row?.pace ?? row?.projectedPace ?? row?.eventPace ?? row?.gamePace)
    if (Number.isFinite(pc)) a.paces.push(pc)
    const sp = toNum(row?.spread ?? row?.gameSpread ?? row?.lineSpread)
    if (Number.isFinite(sp)) a.spreads.push(Math.abs(sp))
    const ht = clampStr(row?.homeTeam ?? row?.home_team)
    const at = clampStr(row?.awayTeam ?? row?.away_team)
    if (ht && !a.homeTeam) a.homeTeam = ht
    if (at && !a.awayTeam) a.awayTeam = at
  }

  const map = new Map()
  for (const [eid, a] of agg) {
    const gameTotal = a.gameTotals.length ? Math.max(...a.gameTotals) : null
    let pace = a.paces.length ? a.paces.reduce((s, x) => s + x, 0) / a.paces.length : null
    if (!Number.isFinite(pace) && Number.isFinite(gameTotal)) {
      const spreadAdj = a.spreads.length ? Math.max(...a.spreads) / 18 : 0
      pace = Math.max(92, Math.min(107, 99 + (gameTotal - 220) / 3 - spreadAdj))
    }
    map.set(eid, { homeTeam: a.homeTeam, awayTeam: a.awayTeam, pace, gameTotal })
  }
  return map
}

/**
 * @param {Map} fromEvents from buildNbaEventGameContextMap(snapshot.events)
 * @param {Map} fromProps from inferNbaEventGameContextFromPropRows(mergedRows)
 */
function mergeNbaEventGameContextMaps(fromEvents, fromProps) {
  const out = new Map(fromEvents)
  for (const [eid, pctx] of fromProps) {
    const cur = out.get(eid) || { homeTeam: null, awayTeam: null, pace: null, gameTotal: null }
    out.set(eid, {
      homeTeam: cur.homeTeam || pctx.homeTeam,
      awayTeam: cur.awayTeam || pctx.awayTeam,
      pace: Number.isFinite(cur.pace) ? cur.pace : pctx.pace,
      gameTotal: Number.isFinite(cur.gameTotal) ? cur.gameTotal : pctx.gameTotal,
    })
  }
  return out
}

function inferOpponentFromEventSides(team, homeTeam, awayTeam) {
  const t = clampStr(team)
  const h = clampStr(homeTeam)
  const a = clampStr(awayTeam)
  if (!t || !h || !a) return null
  if (teamsLikelyEqual(t, h)) return a
  if (teamsLikelyEqual(t, a)) return h
  const tl = normTeamToken(t)
  const hl = normTeamToken(h)
  const al = normTeamToken(a)
  if (tl && hl && (tl.includes(hl) || hl.includes(tl))) return a
  if (tl && al && (tl.includes(al) || al.includes(tl))) return h
  return null
}

let _nbaProjTeamFallbackCache = null
function loadNbaPlayerProjectionsTeamFallback() {
  if (_nbaProjTeamFallbackCache) return _nbaProjTeamFallbackCache
  try {
    const fp = path.join(__dirname, "..", "..", "data", "nbaPlayerProjections.json")
    _nbaProjTeamFallbackCache = JSON.parse(fs.readFileSync(fp, "utf8"))
  } catch {
    _nbaProjTeamFallbackCache = { players: {} }
  }
  return _nbaProjTeamFallbackCache
}

/**
 * Fill `team` from nbaPlayerProjections.json and infer `opponent` from home/away or `matchup` string.
 * Call immediately before computeFinalWeight / matchup so API clients without upstream normalize still work.
 */
function applyTeamFallbackFromProjections(row) {
  if (!row || typeof row !== "object") return row
  const out = { ...row }

  const parsed = parseMatchupTeams(out.matchup)
  if (!clampStr(out.homeTeam) && parsed.homeTeam) out.homeTeam = parsed.homeTeam
  if (!clampStr(out.awayTeam) && parsed.awayTeam) out.awayTeam = parsed.awayTeam

  if (!clampStr(out.team)) {
    const proj = loadNbaPlayerProjectionsTeamFallback()
    const pk = String(out.player || "")
      .trim()
      .toLowerCase()
    const t = String(proj?.players?.[pk]?.team || "").trim()
    if (t) out.team = t
  }

  const homeTeam = clampStr(out.homeTeam)
  const awayTeam = clampStr(out.awayTeam)
  if (!clampStr(out.opponent) && clampStr(out.team) && homeTeam && awayTeam) {
    const opp = inferOpponentFromEventSides(out.team, homeTeam, awayTeam)
    if (opp) {
      out.opponent = opp
      out.opponentTeam = opp
    }
  }

  return out
}

/**
 * Copy slate pace/total onto the row and infer opponent when team + sides are known.
 * @param {object} row
 * @param {Map<string, { homeTeam: string|null, awayTeam: string|null, pace: number|null, gameTotal: number|null }>} gameMap
 */
function attachNbaEventGameContextToRow(row, gameMap) {
  if (!row || typeof row !== "object") return row
  const eid = clampStr(row?.eventId)
  if (!eid || !gameMap || !gameMap.has(eid)) return row
  const g = gameMap.get(eid)
  const out = { ...row }

  if (Number.isFinite(g.pace)) {
    out.eventPace = g.pace
    if (out.pace == null) out.pace = g.pace
  }
  if (Number.isFinite(g.gameTotal)) {
    out.gameTotal = g.gameTotal
    if (out.eventTotal == null) out.eventTotal = g.gameTotal
  }

  if (g.homeTeam && !out.homeTeam) out.homeTeam = g.homeTeam
  if (g.awayTeam && !out.awayTeam) out.awayTeam = g.awayTeam

  const homeTeam = out.homeTeam || g.homeTeam
  const awayTeam = out.awayTeam || g.awayTeam
  const teamForOpp = clampStr(
    out.team || out.playerTeam || out.teamResolved || out.participantTeam || out.participant_team || out.player_team
  )
  if (!clampStr(out.opponent) && teamForOpp && homeTeam && awayTeam) {
    const opp = inferOpponentFromEventSides(teamForOpp, homeTeam, awayTeam)
    if (opp) {
      out.opponent = opp
      out.opponentTeam = opp
    }
  }

  return out
}

/**
 * After event home/away exist on the row, apply specialty player→team vote when `team` was still missing.
 */
function enrichNbaRowTeamFromVoteAfterContext(row, playerTeamIndex) {
  if (!row || typeof row !== "object" || !playerTeamIndex || typeof playerTeamIndex !== "object") return row
  const pk = String(row.player || "")
    .trim()
    .toLowerCase()
  if (!pk) return row
  const voted = playerTeamIndex[pk]
  if (!voted) return row

  const out = { ...row }
  const homeTeam = clampStr(out.homeTeam)
  const awayTeam = clampStr(out.awayTeam)
  if (!homeTeam || !awayTeam) return out

  if (!clampStr(out.team)) {
    if (!teamsLikelyEqual(voted, homeTeam) && !teamsLikelyEqual(voted, awayTeam)) return out
    out.team = voted
    out.opponent = teamsLikelyEqual(voted, homeTeam) ? awayTeam : homeTeam
    out.opponentTeam = out.opponent
    return out
  }

  if (!clampStr(out.opponent)) {
    const opp = inferOpponentFromEventSides(out.team, homeTeam, awayTeam)
    if (opp) {
      out.opponent = opp
      out.opponentTeam = opp
    }
  }

  return out
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
  buildNbaEventGameContextMap,
  inferNbaEventGameContextFromPropRows,
  mergeNbaEventGameContextMaps,
  enrichNbaRowWithEventTeams,
  attachNbaEventGameContextToRow,
  enrichNbaRowTeamFromVoteAfterContext,
  applyTeamFallbackFromProjections,
  inferOpponentFromEventSides,
}
