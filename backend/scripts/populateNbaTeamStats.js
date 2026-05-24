#!/usr/bin/env node
"use strict"

/**
 * populateNbaTeamStats — fetches NBA team-level stats from ESPN public API
 * and persists into backend/data/nbaTeamStats.json. Powers the opponent
 * defense / pace / opp-allowed enrichments consumed by nbaModelSignals.
 *
 * Endpoints used (ESPN site API — same family as game logs):
 *   - /sports/basketball/nba/standings              → all 30 teams + W-L
 *   - /sports/basketball/nba/teams/{id}/statistics  → per-team stats
 *
 * Stat fields persisted per team:
 *   teamAbbr, teamName, defensiveRating, pace,
 *   oppPointsAllowed, oppReboundsAllowed, oppAssistsAllowed,
 *   opp3PA_Allowed, opp3PMade_Allowed,
 *   ourPace, ourPointsScored, lastUpdated
 *
 * Safe to re-run — overwrites by team abbreviation.
 *
 * Usage:
 *   node backend/scripts/populateNbaTeamStats.js
 *   node backend/scripts/populateNbaTeamStats.js --dry-run
 *   node backend/scripts/populateNbaTeamStats.js --debug-dump=BOS  # dump raw ESPN response for one team
 */

const fs   = require("fs")
const path = require("path")
let axios
try { axios = require("axios") } catch (_) { axios = null }

const ESPN_BASE   = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const CORE_BASE   = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
const TIMEOUT_MS  = 15000
const CACHE_PATH  = path.join(__dirname, "..", "data", "nbaTeamStats.json")

function parseArgs() {
  const out = { dry: false, debugDump: null }
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") out.dry = true
    else if (a.startsWith("--debug-dump=")) out.debugDump = a.slice(13).toUpperCase()
  }
  return out
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clampStr(s) { const t = String(s == null ? "" : s).trim(); return t || null }

async function fetchAllTeams() {
  // ESPN teams endpoint returns league list with team info
  const url = `${ESPN_BASE}/teams`
  const r = await axios.get(url, { timeout: TIMEOUT_MS })
  const list = r.data?.sports?.[0]?.leagues?.[0]?.teams || []
  return list
    .map((x) => x.team)
    .filter(Boolean)
    .map((t) => ({
      id:          clampStr(t.id),
      abbr:        clampStr(t.abbreviation),
      displayName: clampStr(t.displayName),
      shortName:   clampStr(t.shortDisplayName),
      slug:        clampStr(t.slug),
    }))
    .filter((t) => t.id && t.abbr)
}

// Pulls advanced team stats. ESPN exposes per-team statistics with a stats
// array; structure: { stats: [{ stats: [{name, value}, ...] }, ...] } or
// similar. We try multiple shapes defensively because ESPN's response shape
// has drifted across endpoints in the past.
async function fetchTeamStats(teamId) {
  const url = `${ESPN_BASE}/teams/${teamId}/statistics`
  try {
    const r = await axios.get(url, { timeout: TIMEOUT_MS })
    return r.data || null
  } catch (err) {
    return { _error: err?.response?.status || err?.message || "fetch_failed" }
  }
}

// Extract canonical stats from ESPN team statistics response.
// Real shape (confirmed via debugEspnEndpoints.js):
//   results.stats.categories[].stats[] — each stat has name, value, perGameValue
//
// 2026-05-24 — real ESPN names captured from BOS dump. Per-game preferred
// over season totals. perGameValue is used when present, else value.
function extractStats(data) {
  const out = {}
  if (!data) return out

  // Map canonical → list of ESPN stat names (lowercase compare).
  // From the actual BOS response: general/offensive/defensive categories.
  const NAME_MAP = {
    pointsPerGame:           ["avgPoints", "pointsPerGame"],
    reboundsPerGame:         ["avgRebounds", "reboundsPerGame"],
    assistsPerGame:          ["avgAssists", "assistsPerGame"],
    minutesPerGame:          ["avgMinutes"],
    fgaPerGame:              ["avgFieldGoalsAttempted"],
    fgmPerGame:              ["avgFieldGoalsMade"],
    threePAPerGame:          ["avgThreePointFieldGoalsAttempted"],
    threePMPerGame:          ["avgThreePointFieldGoalsMade"],
    fgPct:                   ["fieldGoalPct"],
    threePointPct:           ["threePointPct"],
    freeThrowPct:            ["freeThrowPct"],
    turnoversPerGame:        ["avgTurnovers"],
    foulsPerGame:            ["avgFouls"],
    // Defensive stats — names vary. We try the likely ones; if ESPN uses
    // something else those will surface in the debug dump for a future fix.
    pointsAllowedPerGame:    ["avgPointsAgainst", "opponentPointsPerGame", "avgPointsAllowed"],
    reboundsAllowedPerGame:  ["avgReboundsAgainst", "opponentReboundsPerGame"],
    assistsAllowedPerGame:   ["avgAssistsAgainst", "opponentAssistsPerGame"],
    threePAAllowedPerGame:   ["avgThreePointFieldGoalsAttemptedAgainst", "opponentThreePointFieldGoalsAttempted"],
    threePMAllowedPerGame:   ["avgThreePointFieldGoalsMadeAgainst", "opponentThreePointFieldGoalsMade"],
    fgaAllowedPerGame:       ["avgFieldGoalsAttemptedAgainst"],
    defensiveRating:         ["defensiveRating", "defensiveEfficiency"],
    offensiveRating:         ["offensiveRating", "offensiveEfficiency"],
    pace:                    ["pace", "tempo", "possessionsPerGame"],
    plusMinusPerGame:        ["avgPlusMinus"],
    gamesPlayed:             ["gamesPlayed"],
  }
  // Build a fast lookup: lowercase ESPN name → canonical key
  const reverse = new Map()
  for (const [canonical, names] of Object.entries(NAME_MAP)) {
    for (const n of names) reverse.set(String(n).toLowerCase(), canonical)
  }

  // Walk results.stats.categories[].stats[]
  const cats = data?.results?.stats?.categories || []
  for (const cat of cats) {
    const statsArr = cat?.stats || []
    for (const s of statsArr) {
      if (!s?.name) continue
      const canonical = reverse.get(String(s.name).toLowerCase())
      if (!canonical) continue
      // Prefer perGameValue when it exists (real per-game number), else value
      const v = toNum(s.perGameValue) ?? toNum(s.value)
      if (v != null) out[canonical] = v
    }
  }
  return out
}

function loadExisting() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return { teams: {}, generatedAt: null }
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"))
  } catch (_) {
    return { teams: {}, generatedAt: null }
  }
}

function writeCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8")
    return true
  } catch (err) {
    console.error("write failed:", err.message)
    return false
  }
}

async function main() {
  const opts = parseArgs()
  if (!axios) {
    console.error("axios not installed")
    process.exit(2)
  }
  console.log("[teamStats] fetching team list from ESPN...")
  let teams
  try {
    teams = await fetchAllTeams()
  } catch (err) {
    console.error("[teamStats] team list fetch failed:", err?.response?.status || err?.message)
    process.exit(1)
  }
  console.log(`[teamStats] got ${teams.length} teams. fetching stats per team...`)

  const existing = loadExisting()
  const teamsOut = existing.teams || {}
  let ok = 0, fail = 0

  for (const t of teams) {
    const data = await fetchTeamStats(t.id)
    if (opts.debugDump && t.abbr.toUpperCase() === opts.debugDump) {
      console.log(`[teamStats] DEBUG DUMP for ${t.abbr}:`)
      console.log(JSON.stringify(data, null, 2).slice(0, 4000))
    }
    if (data?._error) { fail++; console.warn(`  ${t.abbr.padEnd(4)} ✗ ${data._error}`); continue }
    const stats = extractStats(data)
    const fieldCount = Object.keys(stats).length
    teamsOut[t.abbr.toUpperCase()] = {
      id:           t.id,
      abbr:         t.abbr.toUpperCase(),
      displayName:  t.displayName,
      ...stats,
      lastUpdated:  new Date().toISOString(),
    }
    if (fieldCount > 0) { ok++; console.log(`  ${t.abbr.padEnd(4)} ✓ ${fieldCount} fields`) }
    else                { fail++; console.warn(`  ${t.abbr.padEnd(4)} ⚠ 0 fields parsed`) }
  }

  console.log(`\n[teamStats] ${ok} OK, ${fail} fail/empty`)

  if (opts.dry) {
    console.log("[teamStats] --dry-run, NOT writing cache")
    return
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "espn_site_api",
    teams: teamsOut,
  }
  if (writeCache(payload)) {
    console.log(`[teamStats] wrote ${CACHE_PATH}`)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[teamStats] fatal:", err)
    process.exit(1)
  })
}

module.exports = { extractStats, fetchAllTeams }
