#!/usr/bin/env node
"use strict"

/**
 * populateNbaInjuryReport.js — Phase 1 — Live Availability V1 (Session AV)
 *
 * Pulls real per-player NBA injury / availability data from the ESPN public API
 * and persists into backend/data/nbaInjuryReport.json (the cache that
 * nbaAvailabilityCache reads).
 *
 * INGESTION SOURCE: site.api.espn.com — same endpoints fetchNbaGameResults.js
 * and populateNbaGameLogs.js already use. No new external dependency. No
 * scraping. No NLP. No fake "insider" logic.
 *
 * Two endpoints used:
 *   1. /apis/site/v2/sports/basketball/nba/teams/{TEAM_ID}/injuries
 *      Returns per-team injury list with athlete + status + description
 *   2. /apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD&limit=30
 *      (Optional — used to discover which teams play tonight if --slate-only)
 *
 * Status normalisation reuses the EXISTING dormant utility:
 *   pipeline/edge/ingestNbaOfficialInjuryReport.normalizeNbaOfficialAvailabilityStatus
 * (Buckets: out / doubtful / questionable / probable / active / unknown)
 *
 * Output schema (data/nbaInjuryReport.json):
 *   {
 *     "generatedAt": ISO,
 *     "source": "espn_team_injuries",
 *     "players": {
 *       "donovan mitchell": {
 *         "team":          "Cleveland Cavaliers",
 *         "team_id":       "5",
 *         "status":        "out",                  // normalised
 *         "raw_status":    "Out",                  // ESPN's actual string
 *         "description":   "Hand soreness",
 *         "lastUpdated":   "2026-05-12"
 *       }
 *     }
 *   }
 *
 * Usage (from operator's TERM 1 with network access):
 *   node backend/scripts/populateNbaInjuryReport.js               # all 30 teams
 *   node backend/scripts/populateNbaInjuryReport.js --slate-only  # only teams playing tonight
 *   node backend/scripts/populateNbaInjuryReport.js --dry-run     # parse + log, no persist
 *   node backend/scripts/populateNbaInjuryReport.js --fixture=/abs/path/to/team_injuries.json --team=5
 *                  # parse a single captured ESPN team-injury payload (offline test)
 *
 * No new endpoints. No HTML scraping. No synthetic injuries. If ESPN returns
 * empty injuries for a team, that team's players are absent from the cache —
 * the deriver treats that as "no signal" (honest unknown), NOT "all healthy".
 */

const fs   = require("fs")
const path = require("path")
let axios; try { axios = require("axios") } catch (_) { axios = null }

const { normalizeNbaOfficialAvailabilityStatus } =
  require("../pipeline/edge/ingestNbaOfficialInjuryReport")

const ESPN_BASE       = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const REQUEST_TIMEOUT = 15000
const CACHE_PATH      = path.join(__dirname, "..", "data", "nbaInjuryReport.json")

// Static NBA team displayName → ESPN team_id map. ESPN team IDs are stable.
// Maintained here (≈30 entries, low maintenance) rather than a dynamic /teams
// fetch to keep the script offline-startable.
const NBA_TEAM_ID_BY_NAME = {
  "atlanta hawks": "1",
  "boston celtics": "2",
  "new orleans pelicans": "3",
  "chicago bulls": "4",
  "cleveland cavaliers": "5",
  "dallas mavericks": "6",
  "denver nuggets": "7",
  "detroit pistons": "8",
  "golden state warriors": "9",
  "houston rockets": "10",
  "indiana pacers": "11",
  "los angeles clippers": "12",
  "la clippers": "12",
  "los angeles lakers": "13",
  "miami heat": "14",
  "milwaukee bucks": "15",
  "minnesota timberwolves": "16",
  "brooklyn nets": "17",
  "new york knicks": "18",
  "orlando magic": "19",
  "philadelphia 76ers": "20",
  "phoenix suns": "21",
  "portland trail blazers": "22",
  "sacramento kings": "23",
  "san antonio spurs": "24",
  "oklahoma city thunder": "25",
  "utah jazz": "26",
  "washington wizards": "27",
  "toronto raptors": "28",
  "memphis grizzlies": "29",
  "charlotte hornets": "30",
}

// === Helpers ===

function normPlayer(s) { return String(s || "").trim().toLowerCase() }
function normTeam(s)   { return String(s || "").trim().toLowerCase() }
function todayIso()    { return new Date().toISOString().slice(0, 10) }

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fb }
}
function writeJsonSafe(p, obj) {
  const tmp = p + ".tmp." + process.pid + "." + Date.now()
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, p)
}

function teamIdForName(name) {
  return NBA_TEAM_ID_BY_NAME[normTeam(name)] || null
}

function teamNameForId(id) {
  for (const [name, tid] of Object.entries(NBA_TEAM_ID_BY_NAME)) {
    if (tid === String(id)) return name.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return null
}

// === Parser — pure function. Same shape against fixture or live ===

/**
 * Parse ESPN per-team injury payload. Real ESPN shape:
 *   { team: { id, displayName, ... },
 *     injuries: [
 *       { athlete: { displayName, ... },
 *         status: "Out" | "Day-To-Day" | "Out for Season" | ...,
 *         shortComment: "Knee soreness",
 *         longComment: "...",
 *         date: ISO,
 *       },
 *       ...
 *     ]
 *   }
 *
 * @param {object} payload  ESPN injuries endpoint response
 * @param {string} teamId   the team_id we requested (for fallback)
 * @returns {Array<{ player: string, team: string|null, team_id: string|null,
 *                   status: string, raw_status: string|null, description: string|null,
 *                   lastUpdated: string }>}
 */
// Pre-normalise common ESPN status strings that the dormant normaliser
// doesn't recognise. Honest mapping — only well-established ESPN-vocabulary
// terms. Everything else falls through to the dormant normaliser, which will
// return "unknown" if it can't classify (correct behavior — never invent).
function preNormaliseEspnStatus(rawStatus) {
  const s = String(rawStatus || "").trim().toLowerCase()
  if (!s) return rawStatus
  // "Day-To-Day" / "Day To Day" / "DTD" → questionable equivalent.
  // ESPN uses this for every minor injury that has not been ruled out.
  if (s === "day-to-day" || s === "day to day" || s === "dtd") return "questionable"
  return rawStatus
}

function parseTeamInjuries(payload, teamId) {
  if (!payload || typeof payload !== "object") return []
  const teamName = String(payload?.team?.displayName || teamNameForId(teamId) || "").trim() || null
  const injuries = Array.isArray(payload?.injuries) ? payload.injuries : []
  const out = []
  for (const inj of injuries) {
    const player = String(inj?.athlete?.displayName || "").trim()
    if (!player) continue
    const rawStatus = String(inj?.status || "").trim() || null
    if (!rawStatus) continue
    const preNormalised = preNormaliseEspnStatus(rawStatus)
    const normalised = normalizeNbaOfficialAvailabilityStatus(preNormalised)
    out.push({
      player,
      team:        teamName,
      team_id:     String(teamId || ""),
      status:      normalised,
      raw_status:  rawStatus,
      description: String(inj?.shortComment || inj?.longComment || inj?.details || "").trim() || null,
      lastUpdated: todayIso(),
    })
  }
  return out
}

// === ESPN fetchers ===

async function fetchTeamInjuries(teamId) {
  if (!axios) throw new Error("axios not available — install or use --fixture mode")
  const url = `${ESPN_BASE}/teams/${teamId}/injuries`
  const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
  return r.data
}

async function fetchTodayScoreboard() {
  if (!axios) return null
  const d = new Date()
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`
  try {
    const r = await axios.get(`${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=30`, { timeout: REQUEST_TIMEOUT })
    return r.data
  } catch { return null }
}

// === Cache merge — overwrite (injury reports are point-in-time) ===

function buildCacheFromEntries(allEntries) {
  const cache = { generatedAt: new Date().toISOString(), source: "espn_team_injuries", players: {} }
  for (const e of allEntries) {
    const pk = normPlayer(e.player)
    if (!pk) continue
    const existing = cache.players[pk]
    // Keep highest-strength status if same player listed by multiple sources.
    if (!existing || statusStrength(e.status) > statusStrength(existing.status)) {
      cache.players[pk] = {
        team:        e.team,
        team_id:     e.team_id,
        status:      e.status,
        raw_status:  e.raw_status,
        description: e.description,
        lastUpdated: e.lastUpdated,
      }
    }
  }
  return cache
}

function statusStrength(status) {
  if (status === "out") return 5
  if (status === "doubtful") return 4
  if (status === "questionable") return 3
  if (status === "probable") return 2
  if (status === "active") return 1
  return 0
}

// === Orchestration ===

async function processTeamLive(teamId) {
  console.log(`[populator] live fetch team_id=${teamId} ...`)
  let payload
  try { payload = await fetchTeamInjuries(teamId) }
  catch (err) { console.warn(`[populator] team ${teamId} fetch failed: ${err.message}`); return [] }
  return parseTeamInjuries(payload, teamId)
}

function processFixture(fixturePath, teamId) {
  if (!teamId) throw new Error("--fixture requires --team=<ESPN_TEAM_ID>")
  const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"))
  return parseTeamInjuries(payload, teamId)
}

// === CLI ===

function parseArgs(argv) {
  const args = { dryRun: false, slateOnly: false, fixture: null, team: null }
  for (const a of argv.slice(2)) {
    if (a === "--dry-run")    { args.dryRun = true; continue }
    if (a === "--slate-only") { args.slateOnly = true; continue }
    const eq = a.indexOf("=")
    if (eq <= 2) continue
    const k = a.slice(2, eq), v = a.slice(eq + 1)
    if (k === "fixture") args.fixture = String(v).trim()
    if (k === "team")    args.team    = String(v).trim()
  }
  return args
}

async function discoverSlateTeamIds() {
  const sb = await fetchTodayScoreboard()
  const events = Array.isArray(sb?.events) ? sb.events : []
  const ids = new Set()
  for (const ev of events) {
    const competitors = ev?.competitions?.[0]?.competitors || []
    for (const c of competitors) if (c?.team?.id) ids.add(String(c.team.id))
  }
  return Array.from(ids)
}

async function main() {
  const args = parseArgs(process.argv)

  let allEntries = []
  if (args.fixture) {
    console.log(`[populator] fixture mode — parsing ${args.fixture} for team_id=${args.team}`)
    allEntries = processFixture(args.fixture, args.team)
  } else {
    let teamIds
    if (args.slateOnly) {
      teamIds = await discoverSlateTeamIds()
      if (!teamIds.length) {
        console.warn("[populator] --slate-only: scoreboard returned no teams; falling back to all 30")
        teamIds = Object.values(NBA_TEAM_ID_BY_NAME)
      } else {
        console.log("[populator] --slate-only: teams playing today:", teamIds.join(", "))
      }
    } else {
      teamIds = Object.values(NBA_TEAM_ID_BY_NAME)
    }
    // Sequential to be polite to ESPN; ~50ms/team naturally throttled
    for (const tid of teamIds) {
      const entries = await processTeamLive(tid)
      console.log(`  team ${tid}: ${entries.length} injuries`)
      allEntries.push(...entries)
    }
  }

  const cache = buildCacheFromEntries(allEntries)
  const playerCount = Object.keys(cache.players).length
  console.log("")
  console.log(`[populator] entries parsed: ${allEntries.length}`)
  console.log(`[populator] unique players in cache: ${playerCount}`)

  // Status histogram
  const histo = {}
  for (const p of Object.values(cache.players)) histo[p.status] = (histo[p.status]||0) + 1
  console.log(`[populator] status distribution: ${JSON.stringify(histo)}`)

  if (args.dryRun) { console.log("[populator] --dry-run: NOT writing cache."); return }
  writeJsonSafe(CACHE_PATH, cache)
  console.log(`[populator] wrote ${CACHE_PATH}`)
}

if (require.main === module) {
  main().catch((e) => { console.error("[populator] fatal:", e.message); process.exit(1) })
}

module.exports = { parseTeamInjuries, buildCacheFromEntries, NBA_TEAM_ID_BY_NAME, statusStrength }
