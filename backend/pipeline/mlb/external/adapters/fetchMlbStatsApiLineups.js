"use strict"

/**
 * fetchMlbStatsApiLineups.js — Phase MLB-Lineup-Adapter-Fix (2026-06-01)
 *
 * Free-tier fallback for confirmed MLB lineups when the primary adapter's
 * lineups endpoint is unsupported (paid API-Sports tier gate). Uses MLB's
 * official statsapi.mlb.com — same data source as
 * populateMlbBullpenWorkload.js — no subscription cost, no fabrication.
 *
 * Closes the silent-failure window surfaced by Phase Status-Dashboard rollout
 * 2026-06-01: lineupSpot 0/71 (0%) — never populated alert. Per
 * [[project-pick-origin-architecture]], lineupPosition is one of four
 * canonical inputs to buildMlbBestBetsBoard. Without this fallback, MLB picks
 * generated before lineups confirm (which is most of the day, since the paid
 * lineups endpoint is gated and the free one wasn't wired in) flow through
 * with lineupPosition=null, defeating projection precision and forcing the
 * dampener to crush MLB families (rbis 0.20, totalBases 0.26, hits 0.27,
 * hr 0.36 per 2026-06-01 corpus).
 *
 * Endpoint contract (statsapi.mlb.com):
 *   GET /api/v1/game/{gamePk}/boxscore
 *
 *   Response shape (relevant subset):
 *     teams: {
 *       home: {
 *         team: { id, name },
 *         players: {
 *           "ID660271": {
 *             person: { id, fullName },
 *             battingOrder: "100",     // 100, 200, ... 900 = spots 1-9
 *                                       // "101", "201" = pinch hitter substitutes
 *             stats: { ... },
 *             ...
 *           },
 *           ...
 *         }
 *       },
 *       away: { ... same shape }
 *     }
 *
 * Pre-game (before lineups are posted), the boxscore may exist but
 * `battingOrder` will be missing or empty. We honor that — players without
 * a battingOrder field are skipped, never invented. The existing
 * `lineupPositionFromExternalPlayer` in mergeMlbExternalContext.js normalizes
 * "100" / 100 → spot 1 via the `raw > 20 ? floor(raw/100)` branch — no
 * translation needed here.
 *
 * Anti-fabrication doctrine: returns ONLY confirmed lineup positions from
 * the live MLB API. If a game's lineup isn't posted yet, that game's entry
 * is omitted from the return (caller's existing merge logic respects this —
 * empty entry means no fallback signal, never a synthetic placeholder).
 *
 *
 * Output shape (matches what fetchMlbApiSportsScaffold accumulates so the
 * caller can merge into the same maps):
 *   {
 *     playersByEventId: {
 *       "[eventId]": [
 *         { playerIdExternal, playerName, battingOrderIndex, teamResolved, source: "statsapi-boxscore" }
 *       ]
 *     },
 *     lineupConfirmationByEventId: {
 *       "[eventId]": {
 *         homeConfirmed: boolean,
 *         awayConfirmed: boolean,
 *         homeStarterCount: number,
 *         awayStarterCount: number,
 *         source: "statsapi-boxscore"
 *       }
 *     },
 *     diagnostics: {
 *       gamesAttempted, gamesWithData, errors[]
 *     }
 *   }
 */

const axios = require("axios")

const STATSAPI_BASE = "https://statsapi.mlb.com/api/v1"
const SCHEDULE_URL = `${STATSAPI_BASE}/schedule`
const REQUEST_TIMEOUT_MS = 8000  // per-game; total bounded by Promise.all + caller's own timeout

function ensureArray(x) { return Array.isArray(x) ? x : [] }

function safeName(p) {
  return String(p?.person?.fullName || p?.person?.firstLastName || "").trim() || null
}

/**
 * Lowercase + collapse-whitespace key for team-name matching. Handles common
 * formatting drift between source feeds ("Boston Red Sox" / "boston red sox").
 * Does NOT alias common nicknames — keep matching strict to avoid wrong-team
 * collisions (fabrication risk if "Yankees" matched "New York Mets" by
 * loose substring).
 */
function teamKey(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Fetch MLB Stats API schedule for a given date and return a map keyed by
 * "<away>@<home>" → gamePk. Used to resolve eventId → gamePk when the caller
 * doesn't pre-resolve.
 */
async function fetchScheduleGamePkMap({ slateDate, axiosInstance = axios }) {
  try {
    const res = await axiosInstance.get(SCHEDULE_URL, {
      params: { sportId: 1, date: slateDate },
      timeout: REQUEST_TIMEOUT_MS,
    })
    const games = ensureArray(res?.data?.dates?.[0]?.games)
    const byMatchKey = new Map()
    const byHome = new Map()
    const byAway = new Map()
    for (const g of games) {
      const home = teamKey(g?.teams?.home?.team?.name)
      const away = teamKey(g?.teams?.away?.team?.name)
      const gamePk = Number(g?.gamePk)
      if (!Number.isFinite(gamePk)) continue
      if (home) byHome.set(home, gamePk)
      if (away) byAway.set(away, gamePk)
      if (home && away) byMatchKey.set(`${away}@${home}`, gamePk)
    }
    return { byMatchKey, byHome, byAway, total: games.length, ok: true }
  } catch (e) {
    return { byMatchKey: new Map(), byHome: new Map(), byAway: new Map(), total: 0, ok: false, error: String(e?.message || e) }
  }
}

function resolveGamePk({ event, scheduleIdx }) {
  // Best precision: away@home match
  const home = teamKey(event?.homeTeam || event?.home_team)
  const away = teamKey(event?.awayTeam || event?.away_team)
  if (home && away) {
    const k = `${away}@${home}`
    if (scheduleIdx.byMatchKey.has(k)) return scheduleIdx.byMatchKey.get(k)
  }
  // Fallback: match by home alone (one game per home team per day in regular season)
  if (home && scheduleIdx.byHome.has(home)) return scheduleIdx.byHome.get(home)
  // Last resort: match by away alone
  if (away && scheduleIdx.byAway.has(away)) return scheduleIdx.byAway.get(away)
  return null
}

/**
 * Extract starting-9 entries from one team-side of a boxscore players map.
 * Returns array of { playerIdExternal, playerName, battingOrderIndex }.
 *
 * battingOrder logic: MLB Stats API uses string codes:
 *   "100", "200", ..., "900"  → starters (spots 1-9)
 *   "101", "201", ..., "901"  → substitutes / pinch hitters
 * We keep only starters (last two chars === "00").
 */
function extractStarters(playersMap) {
  if (!playersMap || typeof playersMap !== "object") return []
  const out = []
  for (const key of Object.keys(playersMap)) {
    const p = playersMap[key]
    const bo = String(p?.battingOrder ?? "").trim()
    // Skip players without a batting order (bench / unconfirmed)
    if (!bo) continue
    // Only keep STARTERS (the "00" suffix). Substitutes like "101" mean
    // batter who pinch-hit for the original starter — not their lineup spot.
    if (!/^[1-9]00$/.test(bo)) continue
    const playerName = safeName(p)
    if (!playerName) continue
    out.push({
      playerIdExternal: p?.person?.id ?? null,
      playerName,
      battingOrderIndex: Number(bo),  // 100, 200, ... — existing normalizer reads /100 = spot
      source: "statsapi-boxscore",
    })
  }
  // Sort by batting order so consumers see spot 1 first
  out.sort((a, b) => Number(a.battingOrderIndex) - Number(b.battingOrderIndex))
  return out
}

async function fetchOneGame({ eventId, gamePk, axiosInstance = axios }) {
  try {
    const url = `${STATSAPI_BASE}/game/${gamePk}/boxscore`
    const res = await axiosInstance.get(url, { timeout: REQUEST_TIMEOUT_MS })
    const teams = res?.data?.teams || {}
    const homePlayers = extractStarters(teams.home?.players)
    const awayPlayers = extractStarters(teams.away?.players)
    const homeTeamName = String(teams.home?.team?.name || "").trim() || null
    const awayTeamName = String(teams.away?.team?.name || "").trim() || null
    // Tag each player with their team so downstream identity matching can
    // disambiguate same-name players (rare but happens — Pirates vs Yankees
    // Doug Davis, etc.).
    for (const p of homePlayers) p.teamResolved = homeTeamName
    for (const p of awayPlayers) p.teamResolved = awayTeamName
    const allPlayers = [...homePlayers, ...awayPlayers]
    return {
      eventId,
      players: allPlayers,
      homeStarterCount: homePlayers.length,
      awayStarterCount: awayPlayers.length,
      homeConfirmed: homePlayers.length >= 9,
      awayConfirmed: awayPlayers.length >= 9,
    }
  } catch (e) {
    return {
      eventId,
      players: [],
      homeStarterCount: 0,
      awayStarterCount: 0,
      homeConfirmed: false,
      awayConfirmed: false,
      error: String(e?.response?.status || e?.code || e?.message || e),
    }
  }
}

/**
 * Main entry point.
 *
 * @param {{ events: Array<{eventId, gamePk?, mlbStatsApiGamePk?}>, axiosInstance? }} input
 *
 * `events` items must have an MLB Stats API gamePk to look up. Caller is
 * responsible for resolving gamePk from the slate (events without gamePk are
 * silently skipped — same anti-fabrication pattern).
 *
 * @returns {Promise<{ playersByEventId, lineupConfirmationByEventId, diagnostics }>}
 */
async function fetchMlbStatsApiLineups({ events = [], slateDate = null, axiosInstance = axios } = {}) {
  const safeEvents = Array.isArray(events) ? events : []
  const playersByEventId = {}
  const lineupConfirmationByEventId = {}
  const diagnostics = {
    gamesAttempted: 0,
    gamesWithData: 0,
    gamesResolved: 0,
    gamesUnresolved: 0,
    errors: [],
    source: "statsapi.mlb.com/boxscore",
  }

  if (safeEvents.length === 0) {
    diagnostics.note = "no events supplied"
    return { playersByEventId, lineupConfirmationByEventId, diagnostics }
  }

  // Step 1: resolve gamePk for each event. If event already has gamePk on it,
  // use that. Otherwise, fetch the MLB Stats schedule and match by team names.
  const derivedSlateDate = slateDate || new Date().toISOString().slice(0, 10)
  let scheduleIdx = null
  const needSchedule = safeEvents.some(e => e?.gamePk == null && e?.mlbStatsApiGamePk == null)
  if (needSchedule) {
    scheduleIdx = await fetchScheduleGamePkMap({ slateDate: derivedSlateDate, axiosInstance })
    diagnostics.scheduleFetch = {
      slateDate: derivedSlateDate,
      ok: scheduleIdx.ok,
      gamesFound: scheduleIdx.total,
      error: scheduleIdx.error || null,
    }
  }

  const resolvedEvents = []
  for (const e of safeEvents) {
    let gamePk = e?.gamePk ?? e?.mlbStatsApiGamePk ?? null
    if (gamePk == null && scheduleIdx) gamePk = resolveGamePk({ event: e, scheduleIdx })
    if (gamePk != null && Number.isFinite(Number(gamePk))) {
      resolvedEvents.push({ eventId: String(e.eventId), gamePk: Number(gamePk) })
      diagnostics.gamesResolved += 1
    } else {
      diagnostics.gamesUnresolved += 1
    }
  }
  diagnostics.gamesAttempted = resolvedEvents.length

  if (resolvedEvents.length === 0) {
    diagnostics.note = "no events could be resolved to a MLB Stats API gamePk"
    return { playersByEventId, lineupConfirmationByEventId, diagnostics }
  }

  // Step 2: parallel fetch boxscores — each game capped at REQUEST_TIMEOUT_MS.
  const results = await Promise.all(
    resolvedEvents.map(e => fetchOneGame({
      eventId: e.eventId,
      gamePk: e.gamePk,
      axiosInstance,
    }))
  )

  for (const r of results) {
    if (r.error) {
      diagnostics.errors.push({ eventId: r.eventId, error: r.error })
      continue
    }
    if (r.players.length > 0) {
      playersByEventId[r.eventId] = r.players
      diagnostics.gamesWithData += 1
    }
    if (r.homeStarterCount > 0 || r.awayStarterCount > 0) {
      lineupConfirmationByEventId[r.eventId] = {
        homeConfirmed: r.homeConfirmed,
        awayConfirmed: r.awayConfirmed,
        homeStarterCount: r.homeStarterCount,
        awayStarterCount: r.awayStarterCount,
        source: "statsapi-boxscore",
      }
    }
  }

  return { playersByEventId, lineupConfirmationByEventId, diagnostics }
}

module.exports = {
  fetchMlbStatsApiLineups,
  // Exported for unit testing only — not for direct consumer use.
  extractStarters,
}
