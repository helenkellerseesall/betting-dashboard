"use strict"

/**
 * trueScheduleRoute.js — Phase True-Game-Schedule-1A (2026-06-03)
 *
 * GET /api/ws/true-schedule-today
 *
 * The canonical operator-facing answer to: "How many games are ACTUALLY
 * scheduled today by the official league schedule, and how many of those
 * has the engine generated picks for?"
 *
 * Adds the EXTERNAL schedule as a THIRD canonical source per
 * [[ledger-vs-tracked-bets-canonical-source]]:
 *   - personal_ledger   = append-only history of all picks generated
 *   - tracked_bets      = Layer-1-filtered current CLV window
 *   - external-schedule = official league schedule (THIS ROUTE)
 *
 * Before this route, the system had no canonical "what games exist today"
 * source independent of the engine. Operator hit this gap three times
 * tonight ("10 vs 5 MLB games", "6 today, 15 actual", "NBA Finals tomorrow")
 * because triangulating from internal sources cannot answer "did we MISS a
 * game the schedule says is happening."
 *
 * Data sources (both auth-free, both already used in this codebase):
 *   - MLB Stats API: GET statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD
 *   - ESPN NBA:      GET site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
 *
 * Date semantics: uses CALENDAR-today (wall-clock day) for the schedule API
 * calls because operator's "today's games" matches the league's wall-clock
 * day, not the 4 AM ET slate boundary. tracked_bets cross-reference uses
 * the slate-date file because that's where today's slate's picks live.
 *
 * Per [[status-must-be-real]]: every count traces to a real source.
 * Per [[deep-dive-and-verify-downstream]]: zero impact on /status route.
 */

const express = require("express")
const fs = require("fs")
const path = require("path")
const axios = require("axios")

const router = express.Router()

const REPO_ROOT     = path.join(__dirname, "..", "..")
const TRACKING_DIR  = path.join(REPO_ROOT, "backend", "runtime", "tracking")

const MLB_API_BASE     = "https://statsapi.mlb.com/api/v1"
const ESPN_NBA_BASE    = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const REQUEST_TIMEOUT  = 12000

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null }
}

function calendarDateEt(d = new Date()) {
  // Wall-clock ET calendar date — what operator means by "today"
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "02-digit".replace("02-",""), day: "02-digit".replace("02-","") })
  return fmt.format(d)
}

function calendarDateEtClean() {
  // Robust YYYY-MM-DD via Intl with explicit parts
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
  return fmt.format(new Date())
}

function slateDateEt() {
  // 4 AM ET boundary slate-date — used for tracked_bets file lookup
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
  const parts = fmt.formatToParts(new Date()).reduce((a, p) => { if (p.type !== "literal") a[p.type] = Number(p.value); return a }, {})
  // If wall-clock hour < 4, slate-date is yesterday's calendar
  let y = parts.year, m = parts.month, d = parts.day
  if (parts.hour < 4) {
    const yesterday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    y = yesterday.getUTCFullYear()
    m = yesterday.getUTCMonth() + 1
    d = yesterday.getUTCDate()
  }
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`
}

// ── MLB schedule via statsapi.mlb.com ────────────────────────────────────────

async function fetchMlbSchedule(yyyymmdd) {
  // yyyymmdd = "2026-06-03" (with dashes, MLB API format)
  const url = `${MLB_API_BASE}/schedule?sportId=1&date=${yyyymmdd}`
  try {
    const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
    const dates = r?.data?.dates || []
    const games = []
    for (const d of dates) {
      for (const g of (d.games || [])) {
        games.push({
          gamePk: g.gamePk,
          gameTimeUtc: g.gameDate,
          status: g.status?.detailedState || g.status?.abstractGameState || "unknown",
          awayTeam: g?.teams?.away?.team?.name,
          homeTeam: g?.teams?.home?.team?.name,
          matchup: g?.teams?.away?.team?.name && g?.teams?.home?.team?.name
            ? `${g.teams.away.team.name} @ ${g.teams.home.team.name}`
            : "(missing teams)",
          venue: g?.venue?.name,
        })
      }
    }
    return { ok: true, source: url, totalScheduled: games.length, games }
  } catch (e) {
    return { ok: false, source: url, error: String(e?.message || e), totalScheduled: 0, games: [] }
  }
}

// ── NBA schedule via ESPN scoreboard ────────────────────────────────────────

async function fetchNbaSchedule(yyyymmdd) {
  // ESPN scoreboard uses YYYYMMDD format (no dashes)
  const espnDate = yyyymmdd.replace(/-/g, "")
  const url = `${ESPN_NBA_BASE}/scoreboard?dates=${espnDate}`
  try {
    const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
    const events = r?.data?.events || []
    const games = events.map(e => {
      // ESPN packs both teams in the `competitions[0].competitors` array
      const comp = (e.competitions || [])[0] || {}
      const competitors = comp.competitors || []
      const away = competitors.find(c => c.homeAway === "away")
      const home = competitors.find(c => c.homeAway === "home")
      const awayName = away?.team?.displayName || away?.team?.name
      const homeName = home?.team?.displayName || home?.team?.name
      return {
        espnId: e.id,
        gameTimeUtc: e.date,
        status: e.status?.type?.description || e.status?.type?.state || "unknown",
        awayTeam: awayName,
        homeTeam: homeName,
        matchup: (awayName && homeName) ? `${awayName} @ ${homeName}` : "(missing teams)",
        venue: comp.venue?.fullName,
      }
    })
    return { ok: true, source: url, totalScheduled: games.length, games }
  } catch (e) {
    return { ok: false, source: url, error: String(e?.message || e), totalScheduled: 0, games: [] }
  }
}

// ── Cross-reference with tracked_bets for "withPicks" count ──────────────────

function crossReferenceCoverage(scheduleGames, sport, slateDate) {
  const file = path.join(TRACKING_DIR, `${sport}_tracked_bets_${slateDate}.json`)
  if (!fs.existsSync(file)) {
    return {
      ok: true,
      source: file,
      withPicks: 0,
      missing: scheduleGames.map(g => ({ matchup: g.matchup, gameTimeUtc: g.gameTimeUtc, reason: "no_tracked_bets_file_yet" })),
      note: `tracked_bets file for slate-date ${slateDate} does not exist yet — slate engine has not generated picks`,
    }
  }
  const j = safeReadJson(file)
  const arr = Array.isArray(j) ? j : (j?.entries || j?.bets || [])
  // Build set of distinct matchups (awayTeam @ homeTeam) that have ANY pick
  const matchupsWithPicks = new Set()
  for (const e of arr) {
    if (e.matchup) matchupsWithPicks.add(e.matchup)
    else if (e.awayTeam && e.homeTeam) matchupsWithPicks.add(`${e.awayTeam} @ ${e.homeTeam}`)
  }
  let withPicks = 0
  const missing = []
  for (const g of scheduleGames) {
    if (matchupsWithPicks.has(g.matchup)) {
      withPicks++
    } else {
      missing.push({
        matchup: g.matchup,
        gameTimeUtc: g.gameTimeUtc,
        reason: "no_picks_for_matchup_in_tracked_bets",
      })
    }
  }
  return { ok: true, source: file, withPicks, missing }
}

// ── Route handler ────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const t0 = Date.now()
  const calDate    = calendarDateEtClean()  // YYYY-MM-DD for API calls
  const slateDate  = slateDateEt()          // YYYY-MM-DD for tracked_bets lookup

  // Fetch both schedules in parallel
  const [mlbSched, nbaSched] = await Promise.all([
    fetchMlbSchedule(calDate),
    fetchNbaSchedule(calDate),
  ])

  const mlbCoverage = mlbSched.ok ? crossReferenceCoverage(mlbSched.games, "mlb", slateDate) : { ok: false, error: "schedule fetch failed" }
  const nbaCoverage = nbaSched.ok ? crossReferenceCoverage(nbaSched.games, "nba", slateDate) : { ok: false, error: "schedule fetch failed" }

  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    calendarDateKey: calDate,
    slateDateKey: slateDate,
    mlb: {
      schedule: mlbSched,
      coverage: mlbCoverage,
    },
    nba: {
      schedule: nbaSched,
      coverage: nbaCoverage,
    },
    elapsedMs: Date.now() - t0,
  })
})

module.exports = router
