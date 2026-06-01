#!/usr/bin/env node
"use strict"

/**
 * populateNbaSeriesState.js — Phase NBA-Series-State-Auto-1A (2026-06-01)
 *
 * Auto-derives NBA playoff series state from the ESPN public API. Eliminates
 * the maintenance burden of `backend/data/nbaSeriesState.json` (the
 * hand-curated MVP file that fell stale immediately after each Finals/Conf
 * Finals game).
 *
 * INGESTION SOURCE: site.api.espn.com — same domain already used by
 * populateNbaInjuryReport, populateNbaGameLogs, fetchNbaGameResults.
 *
 * Endpoint: /apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
 *
 * ESPN scoreboard event structure (relevant subset):
 *   {
 *     id: "401771234",
 *     date: "2026-06-01T...",
 *     season: { year, type: 3 },     // type 3 = post-season (playoff)
 *     competitions: [{
 *       competitors: [
 *         { team: { displayName }, homeAway: "home" },
 *         { team: { displayName }, homeAway: "away" }
 *       ],
 *       series: {
 *         type: "playoff",
 *         title: "NBA Finals" | "Conference Finals" | "Conference Semifinals" | "First Round",
 *         summary: "Series tied 0-0" | "NYK leads 3-2" | ...,
 *         competitors: [{ id, wins: 0 }, { id, wins: 1 }]
 *       },
 *       notes: [{ type, headline: "NBA FINALS - GAME 1" }]
 *     }]
 *   }
 *
 * Derives per-game:
 *   - isPlayoff       — season.type === 3
 *   - isElimination   — at least one team has (wins === seriesLength-1 = 3 in best-of-7)
 *   - isGame7         — both teams have 3 wins (next game decides)
 *   - seriesStatus    — from series.summary
 *   - facingElimination — team names at series point (3 wins against them)
 *   - round           — first_round | conference_semis | conference_finals | finals
 *   - gameNumber      — parsed from notes headline (e.g. "GAME 5" → 5)
 *
 * Anti-fabrication doctrine: events without playoff series data are omitted
 * from the output. No invented series state.
 *
 * Output schema (matches hand-curated nbaSeriesState.json games[] entries):
 *   {
 *     generatedAt: ISO,
 *     source: "espn-scoreboard",
 *     games: {
 *       "2026-06-01": [
 *         {
 *           matchup: "New York Knicks @ San Antonio Spurs",
 *           homeTeam: "San Antonio Spurs",
 *           awayTeam: "New York Knicks",
 *           isPlayoff: true,
 *           isElimination: false,
 *           isGame7: false,
 *           seriesStatus: "Series tied 0-0",
 *           facingElimination: [],
 *           round: "finals",
 *           gameNumber: 1
 *         }
 *       ]
 *     }
 *   }
 *
 * Usage:
 *   node backend/scripts/populateNbaSeriesState.js               # today (UTC-shifted to ET)
 *   node backend/scripts/populateNbaSeriesState.js 2026-06-01    # specific date
 *   node backend/scripts/populateNbaSeriesState.js --dry-run     # log, no persist
 */

const fs   = require("fs")
const path = require("path")
let axios; try { axios = require("axios") } catch (_) { axios = null }

const ESPN_BASE       = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const REQUEST_TIMEOUT = 15000
const CACHE_PATH      = path.join(__dirname, "..", "data", "nbaSeriesStateAuto.json")
const SERIES_LENGTH   = 4   // best-of-7 → 4 wins needed to clinch

function toEspnDate(iso) { return String(iso || "").replace(/-/g, "") }

function todayEtKey() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  })
  return fmt.format(new Date())
}

function normalizeRoundLabel(title) {
  const t = String(title || "").toLowerCase()
  if (t.includes("finals") && !t.includes("conference")) return "finals"
  if (t.includes("conference final")) return "conference_finals"
  if (t.includes("semifinal") || t.includes("conference semi")) return "conference_semis"
  if (t.includes("first round") || t.includes("round 1")) return "first_round"
  return null
}

function parseGameNumberFromNotes(notes) {
  const headline = String(notes?.[0]?.headline || "")
  const m = headline.match(/GAME\s+(\d+)/i)
  return m ? Number(m[1]) : null
}

/**
 * Build per-game series state from a single ESPN event.
 * Returns null when the event isn't a playoff game (missing series block).
 */
function deriveSeriesStateFromEvent(event) {
  const isPostSeason = Number(event?.season?.type) === 3
  const comp = event?.competitions?.[0]
  if (!comp) return null

  const series = comp.series
  if (!series || series.type !== "playoff") return null

  // Find home/away by homeAway field
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : []
  const homeRec = competitors.find(c => String(c.homeAway).toLowerCase() === "home")
  const awayRec = competitors.find(c => String(c.homeAway).toLowerCase() === "away")
  if (!homeRec || !awayRec) return null

  const homeTeam = String(homeRec.team?.displayName || "").trim()
  const awayTeam = String(awayRec.team?.displayName || "").trim()
  if (!homeTeam || !awayTeam) return null

  // Per-team current wins (from series.competitors keyed by team id)
  const seriesCompetitors = Array.isArray(series.competitors) ? series.competitors : []
  const winsByTeamId = new Map()
  for (const sc of seriesCompetitors) {
    if (sc?.id != null) winsByTeamId.set(String(sc.id), Number(sc.wins ?? 0))
  }
  const homeWins = winsByTeamId.get(String(homeRec.id)) ?? Number(homeRec.records?.[0]?.summary?.split("-")?.[0] || 0)
  const awayWins = winsByTeamId.get(String(awayRec.id)) ?? Number(awayRec.records?.[0]?.summary?.split("-")?.[0] || 0)

  // Series math (best-of-7, 4 wins to clinch, 3 = series point)
  const homeAtSeriesPoint = homeWins === SERIES_LENGTH - 1  // 3
  const awayAtSeriesPoint = awayWins === SERIES_LENGTH - 1
  const facingElimination = []
  if (awayAtSeriesPoint && !homeAtSeriesPoint) facingElimination.push(homeTeam)   // away team can clinch → home faces elim
  if (homeAtSeriesPoint && !awayAtSeriesPoint) facingElimination.push(awayTeam)   // home team can clinch → away faces elim
  if (homeAtSeriesPoint && awayAtSeriesPoint) {
    // Both at 3 wins → Game 7 → both face elimination
    facingElimination.push(homeTeam, awayTeam)
  }
  const isElimination = facingElimination.length > 0
  const isGame7 = homeWins === 3 && awayWins === 3

  return {
    matchup: `${awayTeam} @ ${homeTeam}`,
    homeTeam,
    awayTeam,
    isPlayoff: isPostSeason,
    isElimination,
    isGame7,
    seriesStatus: String(series.summary || "").trim() || null,
    facingElimination,
    round: normalizeRoundLabel(series.title) || null,
    gameNumber: parseGameNumberFromNotes(comp.notes),
    source: "espn-scoreboard",
  }
}

async function fetchEspnScoreboard(slateDate) {
  if (!axios) throw new Error("axios not installed — `npm install axios` (should already be present)")
  const dateStr = toEspnDate(slateDate)
  const url = `${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=30`
  const res = await axios.get(url, { timeout: REQUEST_TIMEOUT })
  return Array.isArray(res?.data?.events) ? res.data.events : []
}

function persistCache(payload) {
  // Atomic write (temp file + rename) to avoid readers seeing partial JSON
  const tmp = CACHE_PATH + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
  fs.renameSync(tmp, CACHE_PATH)
}

function loadExistingAutoCache() {
  if (!fs.existsSync(CACHE_PATH)) return { generatedAt: null, source: "espn-scoreboard", games: {} }
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) }
  catch (_) { return { generatedAt: null, source: "espn-scoreboard", games: {} } }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a))
  const slateDate = dateArg || todayEtKey()

  console.log(`[populateNbaSeriesState] fetching ESPN scoreboard for ${slateDate}`)

  let events
  try {
    events = await fetchEspnScoreboard(slateDate)
  } catch (e) {
    console.error(`[populateNbaSeriesState] ESPN fetch failed: ${e?.message || e}`)
    process.exit(1)
  }

  console.log(`[populateNbaSeriesState] ESPN returned ${events.length} events for ${slateDate}`)

  const games = []
  let skippedNonPlayoff = 0
  for (const event of events) {
    const derived = deriveSeriesStateFromEvent(event)
    if (!derived) { skippedNonPlayoff += 1; continue }
    games.push(derived)
  }

  console.log(`[populateNbaSeriesState] derived ${games.length} playoff games (skipped ${skippedNonPlayoff} non-playoff/no-series)`)
  for (const g of games) {
    console.log(`  ${g.matchup} | ${g.round} | game ${g.gameNumber || "?"} | ${g.seriesStatus || "—"}${g.isElimination ? " | ELIMINATION" : ""}${g.isGame7 ? " | GAME 7" : ""}`)
  }

  if (dryRun) {
    console.log("[populateNbaSeriesState] --dry-run: not persisting")
    return
  }

  // Merge into existing cache — preserve prior dates, overwrite the date being refreshed
  const existing = loadExistingAutoCache()
  const merged = {
    generatedAt: new Date().toISOString(),
    source: "espn-scoreboard",
    games: { ...(existing.games || {}), [slateDate]: games },
  }

  persistCache(merged)
  console.log(`[populateNbaSeriesState] wrote ${CACHE_PATH}`)
  console.log(`[populateNbaSeriesState] OK — ${games.length} games persisted for ${slateDate}`)
}

main().catch((e) => {
  console.error(`[populateNbaSeriesState] fatal: ${e?.message || e}`)
  process.exit(1)
})
