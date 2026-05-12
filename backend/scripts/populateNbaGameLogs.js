#!/usr/bin/env node
"use strict"

/**
 * populateNbaGameLogs.js — Phase 1 — Real Game-Log Populator V1 (Session AQ)
 *
 * Pulls real per-player per-game NBA boxscore data from the ESPN public API
 * and persists into backend/data/nbaPlayerGameLogs.json (the cache that
 * nbaRecentFormCache reads). Fully append/merge — never overwrites or
 * fabricates entries from the existing settled-bets aggregator.
 *
 * INGESTION SOURCE: site.api.espn.com — same endpoints fetchNbaGameResults.js
 * already uses for grading. No new external dependency, no scraping, no auth.
 *
 * Per-game fields captured (per player):
 *   date         YYYY-MM-DD
 *   opponent     opposing team displayName
 *   isHome       boolean
 *   minutes      from ESPN "minutes" stat (MM:SS → MM int)
 *   points
 *   rebounds
 *   assists
 *   threes       made (from "M-A" string)
 *   fga          field goal attempts
 *   threeAtt     three-point attempts
 *   blocks
 *   steals
 *   starter      boolean — ESPN flags `starter:true` on athlete
 *
 * Idempotent: re-running the same date does NOT duplicate game entries
 * (keyed by player+date). Merging preserves Session AP's settled-bets entries
 * by union-merging stat keys per game.
 *
 * Usage (from operator's TERM 1 with network access):
 *   node backend/scripts/populateNbaGameLogs.js                  # last 14 days
 *   node backend/scripts/populateNbaGameLogs.js --days=21        # last 21 days
 *   node backend/scripts/populateNbaGameLogs.js --date=2026-05-09  # single date
 *   node backend/scripts/populateNbaGameLogs.js --dry-run        # parse + log, no persist
 *   node backend/scripts/populateNbaGameLogs.js --fixture=/abs/path/to/summary.json --date=YYYY-MM-DD
 *                  # parse a single captured ESPN summary payload (offline test mode)
 *
 * No new endpoints. No HTML scraping. No synthetic backfill. If ESPN returns
 * empty, the cache is unchanged.
 */

const fs   = require("fs")
const path = require("path")
let axios
try { axios = require("axios") } catch (_) { axios = null }

const ESPN_BASE        = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const REQUEST_TIMEOUT  = 15000
const CACHE_PATH       = path.join(__dirname, "..", "data", "nbaPlayerGameLogs.json")
const DEFAULT_DAYS_BACK = 14

// === Helpers ===

function normName(s) { return String(s == null ? "" : s).trim().toLowerCase() }
function clampStr(s) { const t = String(s == null ? "" : s).trim(); return t || null }

function toEspnDate(iso) { return iso.replace(/-/g, "") }

function parseEspnStat(val) {
  if (val == null || val === "" || val === "--") return null
  const s = String(val).trim()
  if (s.includes(":")) {
    // MM:SS minutes — return integer minutes
    const [m] = s.split(":")
    const n = parseInt(m, 10)
    return Number.isFinite(n) ? n : null
  }
  if (s.includes("-")) {
    const made = parseInt(s.split("-")[0], 10)
    return Number.isFinite(made) ? made : null
  }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

function parseEspnRatio(val, which /* "made" | "att" */) {
  if (val == null || val === "" || val === "--") return null
  const s = String(val).trim()
  if (!s.includes("-")) return null
  const [made, att] = s.split("-").map((p) => parseInt(p, 10))
  if (which === "made") return Number.isFinite(made) ? made : null
  return Number.isFinite(att) ? att : null
}

function makeColLookup(statGroup) {
  const keys = statGroup.keys || []
  return function getCol(athleteStats, key) {
    const idx = keys.indexOf(key)
    if (idx === -1 || idx >= athleteStats.length) return null
    return athleteStats[idx]
  }
}

function isoDateFromIso(iso) {
  return String(iso).slice(0, 10)
}

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fb }
}
function writeJsonSafe(p, obj) {
  const tmp = p + ".tmp." + process.pid + "." + Date.now()
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, p)
}

// === ESPN fetchers ===

async function fetchScoreboard(isoDate) {
  if (!axios) throw new Error("axios not available — install or use --fixture mode")
  const url = `${ESPN_BASE}/scoreboard?dates=${toEspnDate(isoDate)}&limit=30`
  const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
  return r.data
}

async function fetchSummary(eventId) {
  if (!axios) throw new Error("axios not available — install or use --fixture mode")
  const url = `${ESPN_BASE}/summary?event=${eventId}`
  const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
  return r.data
}

// === Parser — pure function. Same shape works against fixture or live data. ===

/**
 * @param {object} summary  ESPN summary endpoint payload
 * @param {string} isoDate  YYYY-MM-DD (used as the game date)
 * @returns {Array<{ player: string, team: string|null, opponent: string|null,
 *                   isHome: boolean|null, starter: boolean|null,
 *                   stats: { minutes, points, rebounds, assists, threes, threeAtt, fga, blocks, steals } }>}
 */
function parseSummary(summary, isoDate) {
  const out = []
  if (!summary || typeof summary !== "object") return out

  // boxscore.teams gives us the home/away identification.
  const teams = Array.isArray(summary?.boxscore?.teams) ? summary.boxscore.teams : []
  const teamByIdx = teams.map((t) => ({
    name:   clampStr(t?.team?.displayName),
    abbr:   clampStr(t?.team?.abbreviation),
    id:     clampStr(t?.team?.id),
    isHome: t?.homeAway === "home" ? true : t?.homeAway === "away" ? false : null,
  }))

  const playerGroups = Array.isArray(summary?.boxscore?.players) ? summary.boxscore.players : []
  for (let teamIdx = 0; teamIdx < playerGroups.length; teamIdx++) {
    const teamData = playerGroups[teamIdx]
    const teamMeta = teamByIdx.find((t) => t.id === clampStr(teamData?.team?.id)) || teamByIdx[teamIdx] || null
    const teamName = teamMeta?.name || clampStr(teamData?.team?.displayName)
    const isHome   = teamMeta?.isHome ?? null
    // Opposing team is the other entry in teamByIdx
    const opp = teamByIdx.find((t) => t && t.name && t.name !== teamName)
    const opponent = opp?.name || null

    const statGroups = Array.isArray(teamData?.statistics) ? teamData.statistics : []
    for (const statGroup of statGroups) {
      const getCol = makeColLookup(statGroup)
      const athletes = Array.isArray(statGroup.athletes) ? statGroup.athletes : []
      for (const a of athletes) {
        if (a?.didNotPlay === true) continue
        const player = clampStr(a?.athlete?.displayName)
        if (!player) continue
        const rawStats = Array.isArray(a?.stats) ? a.stats : []
        if (!rawStats.length) continue
        const minutes  = parseEspnStat(getCol(rawStats, "minutes"))
        const points   = parseEspnStat(getCol(rawStats, "points"))
        const rebounds = parseEspnStat(getCol(rawStats, "rebounds"))
        const assists  = parseEspnStat(getCol(rawStats, "assists"))
        const threesM  = parseEspnRatio(getCol(rawStats, "threePointFieldGoals"), "made")
        const threesA  = parseEspnRatio(getCol(rawStats, "threePointFieldGoals"), "att")
        const fga      = parseEspnRatio(getCol(rawStats, "fieldGoalsAttempted"), "att")
                          ?? parseEspnRatio(getCol(rawStats, "fieldGoals"), "att")
        const blocks   = parseEspnStat(getCol(rawStats, "blocks"))
        const steals   = parseEspnStat(getCol(rawStats, "steals"))

        // Only persist values we actually parsed (no synthesis). 0 values for
        // played players are valid; null/undefined values are dropped.
        const stats = {}
        if (Number.isFinite(minutes))  stats.minutes  = minutes
        if (Number.isFinite(points))   stats.points   = points
        if (Number.isFinite(rebounds)) stats.rebounds = rebounds
        if (Number.isFinite(assists))  stats.assists  = assists
        if (Number.isFinite(threesM))  stats.threes   = threesM
        if (Number.isFinite(threesA))  stats.threeAtt = threesA
        if (Number.isFinite(fga))      stats.fga      = fga
        if (Number.isFinite(blocks))   stats.blocks   = blocks
        if (Number.isFinite(steals))   stats.steals   = steals

        if (!Object.keys(stats).length) continue

        out.push({
          player,
          team:     teamName,
          opponent,
          isHome:   isHome,
          starter:  a?.starter === true ? true : a?.starter === false ? false : null,
          date:     isoDate,
          stats,
        })
      }
    }
  }
  return out
}

// === Cache merge logic — append-only, idempotent ===

function loadCache() {
  const persisted = readJsonSafe(CACHE_PATH, null)
  if (persisted && persisted.players) return persisted
  return { players: {}, generatedAt: new Date().toISOString(), source: "mixed" }
}

/**
 * Merge an array of parsed player-game entries into the cache.
 * Idempotent: same player+date is union-merged at the stats level.
 * Preserves any pre-existing entries (e.g. from settled-bets aggregator).
 *
 * @param {object} cache   cache object (mutated)
 * @param {Array}  entries from parseSummary()
 * @returns {{ playersTouched: number, gamesAdded: number, gamesUpdated: number }}
 */
function mergeIntoCache(cache, entries) {
  let playersTouched = 0
  let gamesAdded = 0
  let gamesUpdated = 0
  const seenPlayer = new Set()
  for (const e of entries) {
    const pk = normName(e.player)
    if (!cache.players[pk]) {
      cache.players[pk] = { team: e.team || null, games: [], lastUpdated: new Date().toISOString().slice(0, 10), source: "espn" }
    }
    const entry = cache.players[pk]
    if (!seenPlayer.has(pk)) { playersTouched++; seenPlayer.add(pk) }
    if (e.team && !entry.team) entry.team = e.team

    // Find existing game for this date
    let g = entry.games.find((x) => x.date === e.date)
    if (g) {
      // Union-merge stats. Settled-bets entries had a small subset; ESPN fills in.
      g.stats = Object.assign({}, g.stats || {}, e.stats)
      if (e.opponent && !g.opponent) g.opponent = e.opponent
      if (e.isHome != null && g.isHome == null) g.isHome = e.isHome
      if (e.starter != null && g.starter == null) g.starter = e.starter
      gamesUpdated++
    } else {
      entry.games.push({
        date: e.date,
        opponent: e.opponent || null,
        isHome:   e.isHome,
        starter:  e.starter,
        stats: e.stats,
      })
      gamesAdded++
    }
    entry.lastUpdated = new Date().toISOString().slice(0, 10)
    // Mark source as mixed if we already had non-espn entries
    entry.source = entry.source && entry.source !== "espn" ? "mixed" : "espn"
  }
  // Sort each player's games newest-first (consistent with reader expectations)
  for (const p of Object.values(cache.players)) {
    p.games.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }
  return { playersTouched, gamesAdded, gamesUpdated }
}

// === Top-level operations ===

async function processDateLive(isoDate) {
  console.log(`[populator] live fetch ${isoDate} ...`)
  let scoreboard
  try { scoreboard = await fetchScoreboard(isoDate) }
  catch (err) { console.warn(`[populator] scoreboard fetch failed for ${isoDate}: ${err.message}`); return [] }
  const events = Array.isArray(scoreboard?.events) ? scoreboard.events : []
  if (!events.length) { console.log(`[populator] ${isoDate}: no NBA games`); return [] }

  const allEntries = []
  // Sequential fetch so we don't hammer ESPN; per-game ~200ms.
  for (const ev of events) {
    const id = String(ev.id || "")
    if (!id) continue
    try {
      const summary = await fetchSummary(id)
      const parsed = parseSummary(summary, isoDate)
      allEntries.push(...parsed)
    } catch (err) {
      console.warn(`[populator] game ${id} fetch failed: ${err.message}`)
    }
  }
  console.log(`[populator] ${isoDate}: ${events.length} games → ${allEntries.length} player-game rows`)
  return allEntries
}

function processFixture(fixturePath, isoDate) {
  if (!isoDate) throw new Error("--fixture requires --date=YYYY-MM-DD")
  const summary = JSON.parse(fs.readFileSync(fixturePath, "utf8"))
  return parseSummary(summary, isoDate)
}

function backfillDates(daysBack) {
  const out = []
  const today = new Date()
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today.getTime() - i * 86400000)
    const iso = d.toISOString().slice(0, 10)
    out.push(iso)
  }
  return out
}

// === Main ===

function parseArgs(argv) {
  const args = { dryRun: false, days: DEFAULT_DAYS_BACK, date: null, fixture: null }
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") { args.dryRun = true; continue }
    const eq = a.indexOf("=")
    if (eq <= 2) continue
    const k = a.slice(2, eq); const v = a.slice(eq + 1)
    if (k === "days")    args.days = Math.max(1, Math.min(60, parseInt(v, 10) || DEFAULT_DAYS_BACK))
    if (k === "date")    args.date = String(v).trim()
    if (k === "fixture") args.fixture = String(v).trim()
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  const cache = loadCache()
  const beforePlayers = Object.keys(cache.players).length
  const beforeGames   = Object.values(cache.players).reduce((s, p) => s + (p.games?.length || 0), 0)

  let allEntries = []
  if (args.fixture) {
    console.log(`[populator] fixture mode — parsing ${args.fixture} for date ${args.date}`)
    allEntries = processFixture(args.fixture, args.date)
  } else if (args.date) {
    allEntries = await processDateLive(args.date)
  } else {
    const dates = backfillDates(args.days)
    console.log(`[populator] backfill ${dates.length} dates: ${dates[dates.length - 1]} → ${dates[0]}`)
    for (const d of dates) {
      const entries = await processDateLive(d)
      allEntries.push(...entries)
    }
  }

  const merge = mergeIntoCache(cache, allEntries)
  const afterPlayers = Object.keys(cache.players).length
  const afterGames   = Object.values(cache.players).reduce((s, p) => s + (p.games?.length || 0), 0)

  console.log("")
  console.log(`[populator] merge summary:`)
  console.log(`  players touched:     ${merge.playersTouched}`)
  console.log(`  player-game rows:    parsed=${allEntries.length} added=${merge.gamesAdded} updated=${merge.gamesUpdated}`)
  console.log(`  cache players: ${beforePlayers} → ${afterPlayers}`)
  console.log(`  cache games:   ${beforeGames} → ${afterGames}`)

  if (args.dryRun) {
    console.log(`[populator] --dry-run: NOT writing cache.`)
    return
  }
  cache.generatedAt = new Date().toISOString()
  writeJsonSafe(CACHE_PATH, cache)
  console.log(`[populator] wrote ${CACHE_PATH}`)
}

if (require.main === module) {
  main().catch((e) => { console.error("[populator] fatal:", e.message); process.exit(1) })
}

module.exports = { parseSummary, mergeIntoCache, loadCache, parseEspnStat, parseEspnRatio }
