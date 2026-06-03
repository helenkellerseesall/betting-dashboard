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

// ── Cross-reference with PERSONAL_LEDGER for "withPicks" count ──────────────
//
// Phase True-Game-Schedule-1A-fix1 (2026-06-03) — was reading tracked_bets,
// which is the Layer-1-filtered current CLV window (drops games >1hr past
// tip). At any point past mid-afternoon, early-tipped games are GONE from
// tracked_bets even though the engine fully covered them. Caught when the
// route reported 3 "missing" MLB matchups for today (Marlins@Nationals,
// Tigers@Rays, WhiteSox@Twins) — all 3 had 200+ picks in personal_ledger
// with 100+ close-stamped each. They tipped at 1 PM ET and finished by ~4 PM,
// so Layer-1 dropped them from tracked_bets by the time the probe ran at
// 4:21 PM ET.
//
// Fix per [[ledger-vs-tracked-bets-canonical-source]]: "did we cover X games"
// is a personal_ledger question (append-only history), NOT a tracked_bets
// question (Layer-1-filtered current window). Switching source. The function
// signature stays the same so the caller in the route handler doesn't change.
//
// Per [[status-must-be-real]]: every "withPicks" number now traces to ledger
// entries with sport=X AND date=slateDate AND matchup matches. No defaults.

const PERSONAL_LEDGER = path.join(REPO_ROOT, "backend", "runtime", "tracking", "personal_ledger.json")

function crossReferenceCoverage(scheduleGames, sport, slateDate) {
  const ledger = safeReadJson(PERSONAL_LEDGER)
  if (!ledger) {
    return {
      ok: false,
      source: PERSONAL_LEDGER,
      error: "personal_ledger.json not readable",
      withPicks: 0,
      missing: [],
    }
  }
  const entries = Array.isArray(ledger) ? ledger : (ledger.entries || ledger.bets || [])

  // Build set of matchups WITH at least one pick for this sport+slate.
  // Also build eventId set as fallback (some entries may have eventId but not matchup).
  const matchupsWithPicks = new Set()
  let scannedForSport = 0
  let inScopeEntries = 0
  for (const e of entries) {
    if (String(e.sport || "").toLowerCase() !== sport) continue
    scannedForSport++
    if (e.date !== slateDate) continue
    inScopeEntries++
    if (e.matchup) {
      matchupsWithPicks.add(e.matchup)
    } else if (e.awayTeam && e.homeTeam) {
      matchupsWithPicks.add(`${e.awayTeam} @ ${e.homeTeam}`)
    }
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
        reason: "no_picks_for_matchup_in_personal_ledger",
      })
    }
  }
  return {
    ok: true,
    source: PERSONAL_LEDGER,
    withPicks,
    missing,
    diagnostics: {
      ledgerEntriesScannedForSport: scannedForSport,
      inScopeEntriesForSlate: inScopeEntries,
      distinctMatchupsWithPicks: matchupsWithPicks.size,
    },
  }
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
