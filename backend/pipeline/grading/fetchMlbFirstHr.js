"use strict"

/**
 * fetchMlbFirstHr.js — F FIRST-HR CURE (2026-07-11). Derives WHO HIT THE GAME'S
 * FIRST HOME RUN per game for a date, from MLB StatsAPI play-by-play (the box
 * score CANNOT settle this market — it has totals, not order; that gap is how
 * every first-HR bet mis-settled: line=0 + total-HR stat ⇒ any-HR = false WIN,
 * no-HR = push instead of loss).
 *
 * Settlement rule (book convention, GRADING_RULES amendment pending):
 *   player hit the game's FIRST HR  ⇒ WIN
 *   someone else hit the first HR   ⇒ LOSS
 *   game finished with NO HR        ⇒ VOID
 *   game not final / data missing   ⇒ pending (never guessed)
 *
 * Same client pattern as fetchMlbGameResults (statsapi.mlb.com, axios, capped
 * concurrency). Join to tracked bets is by normalized TEAM PAIR (tracked rows
 * carry awayTeam/homeTeam; odds-api eventIds don't map to gamePks).
 */

const axios = require("axios")
const MLB_API_BASE = "https://statsapi.mlb.com/api/v1"

const normName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, "").trim()
const normTeam = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "")

/**
 * @returns {Promise<{ games: Array<{gamePk, teamKey, final, firstHrBatter|null, noHr}>, byTeamKey: Map, gamesChecked: number }>}
 * teamKey = `${normTeam(away)}@${normTeam(home)}`
 */
async function fetchMlbFirstHr(date) {
  const games = []
  let sched
  try {
    sched = await axios.get(`${MLB_API_BASE}/schedule?sportId=1&date=${date}`, { timeout: 15000 })
  } catch (e) {
    return { games, byTeamKey: new Map(), gamesChecked: 0, error: `schedule fetch failed: ${e?.message}` }
  }
  const dayGames = []
  for (const d of (sched?.data?.dates || [])) for (const g of (d?.games || [])) dayGames.push(g)

  const CONCURRENCY = 8
  for (let i = 0; i < dayGames.length; i += CONCURRENCY) {
    await Promise.all(dayGames.slice(i, i + CONCURRENCY).map(async (g) => {
      const gamePk = g?.gamePk
      const away = g?.teams?.away?.team?.name, home = g?.teams?.home?.team?.name
      const teamKey = `${normTeam(away)}@${normTeam(home)}`
      const final = String(g?.status?.abstractGameState || "").toLowerCase() === "final"
      const entry = { gamePk, teamKey, away, home, final, firstHrBatter: null, noHr: false }
      if (!final) { games.push(entry); return } // never settle a non-final game
      try {
        const pbp = await axios.get(`${MLB_API_BASE}/game/${gamePk}/playByPlay`, { timeout: 20000 })
        const plays = Array.isArray(pbp?.data?.allPlays) ? pbp.data.allPlays : []
        const hrs = plays
          .filter((p) => String(p?.result?.eventType || p?.result?.event || "").toLowerCase().replace(/[\s_]/g, "") === "homerun")
          .sort((a, b) => (a?.about?.atBatIndex ?? 1e9) - (b?.about?.atBatIndex ?? 1e9))
        if (!hrs.length) entry.noHr = true
        else entry.firstHrBatter = normName(hrs[0]?.matchup?.batter?.fullName)
      } catch (_) { entry.final = false /* pbp unavailable ⇒ treat as not settleable */ }
      games.push(entry)
    }))
  }
  const byTeamKey = new Map()
  for (const g of games) byTeamKey.set(g.teamKey, g)
  return { games, byTeamKey, gamesChecked: games.length }
}

/**
 * Build the settle context gradeTrackedBets consumes: findGame(bet) resolves the
 * bet's game by team pair (either orientation tolerated).
 */
function buildFirstHrCtx(fetched) {
  const byTeamKey = fetched?.byTeamKey || new Map()
  return {
    findGame(bet) {
      const a = normTeam(bet?.awayTeam), h = normTeam(bet?.homeTeam)
      if (!a || !h) return null
      return byTeamKey.get(`${a}@${h}`) || byTeamKey.get(`${h}@${a}`) || null
    },
    normPlayer: normName,
  }
}

module.exports = { fetchMlbFirstHr, buildFirstHrCtx }
