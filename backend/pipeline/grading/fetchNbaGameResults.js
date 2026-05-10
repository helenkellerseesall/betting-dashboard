"use strict"

/**
 * fetchNbaGameResults — fetches player stat lines from the NBA Stats API
 * for all players who appeared in games on a given date.
 *
 * Returns a Map keyed by normalized player name (lowercase, trimmed):
 *   playerName → { rebounds, threes, assists, points, blocks, steals }
 *
 * Stat family → result key mapping:
 *   rebounds → reboundsTotal (sum of offReb + defReb)
 *   threes   → threePointersMade
 *   assists  → assists
 *   points   → points
 *
 * Uses the official NBA Stats API:
 *   scoreboardv2 → game IDs for the date
 *   boxscoretraditionalv2 → per-player stats per game
 *
 * Requires specific headers (Referer, User-Agent, Origin) to bypass NBA CDN
 * restrictions. If the API is unreachable (network error, 403, rate-limit),
 * returns an empty Map — callers treat affected bets as "unresolved" and
 * preserve them for retry.
 *
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<Map<string, object>>}
 */

const axios = require("axios")

const NBA_STATS_BASE = "https://stats.nba.com/stats"
const REQUEST_TIMEOUT = 15000

// Required headers for stats.nba.com — 403 without these
const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
}

function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function toInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Format date from YYYY-MM-DD to MM/DD/YYYY (NBA scoreboard format).
 */
function toNbaDateFormat(isoDate) {
  const [y, m, d] = isoDate.split("-")
  return `${m}/${d}/${y}`
}

/**
 * Parse a stats.nba.com "rowSet" response into an array of objects.
 * NBA API returns { headers: [...], rowSet: [[...], ...] }
 */
function parseNbaRows(resultSet) {
  const headers = resultSet?.headers || []
  const rows = resultSet?.rowSet || []
  return rows.map((row) => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = row[i] })
    return obj
  })
}

/**
 * Fetch game IDs from the NBA scoreboard for a given date.
 * @param {string} isoDate  YYYY-MM-DD
 * @returns {Promise<string[]>}  array of gameId strings
 */
async function fetchNbaGameIds(isoDate) {
  const gameDate = toNbaDateFormat(isoDate)
  const url = `${NBA_STATS_BASE}/scoreboardv2?gameDate=${encodeURIComponent(gameDate)}&leagueId=00&dayOffset=0`
  try {
    const r = await axios.get(url, { headers: NBA_HEADERS, timeout: REQUEST_TIMEOUT })
    const sets = r.data?.resultSets || []
    // GameHeader is result set index 0
    const gameHeader = sets.find((s) => s.name === "GameHeader") || sets[0]
    if (!gameHeader) return []
    const rows = parseNbaRows(gameHeader)
    return rows.map((row) => String(row.GAME_ID)).filter(Boolean)
  } catch (err) {
    console.error(`[fetchNbaGameResults] Scoreboard fetch failed for ${isoDate}: ${err.message}`)
    return []
  }
}

/**
 * Fetch per-player stats for a single NBA game and merge into resultMap.
 * @param {string} gameId
 * @param {Map}    resultMap  mutated in place
 */
async function processNbaGame(gameId, resultMap) {
  const url =
    `${NBA_STATS_BASE}/boxscoretraditionalv2` +
    `?gameId=${gameId}&startPeriod=0&endPeriod=10&startRange=0&endRange=2147483647&rangeType=0`
  let data
  try {
    const r = await axios.get(url, { headers: NBA_HEADERS, timeout: REQUEST_TIMEOUT })
    data = r.data
  } catch {
    return // single-game failure is non-fatal
  }

  const sets = data?.resultSets || []
  // PlayerStats is result set 0
  const playerStatsSet = sets.find((s) => s.name === "PlayerStats") || sets[0]
  if (!playerStatsSet) return

  const rows = parseNbaRows(playerStatsSet)
  for (const row of rows) {
    const name = normName(row.PLAYER_NAME)
    if (!name) continue

    const entry = {
      rebounds: toInt(row.REB),       // total rebounds
      threes:   toInt(row.FG3M),      // 3-pointers made
      assists:  toInt(row.AST),
      points:   toInt(row.PTS),
      blocks:   toInt(row.BLK),
      steals:   toInt(row.STL),
      turnovers: toInt(row.TO),
    }

    // Merge — same player can appear in two games (rare, but handle it)
    const existing = resultMap.get(name)
    if (existing) {
      Object.keys(entry).forEach((k) => {
        existing[k] = (existing[k] || 0) + entry[k]
      })
    } else {
      resultMap.set(name, entry)
    }
  }
}

/**
 * Main export.
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<Map<string, object>>}
 */
async function fetchNbaGameResults(date) {
  const resultMap = new Map()

  const gameIds = await fetchNbaGameIds(date)
  if (!gameIds.length) {
    console.log(`[fetchNbaGameResults] No NBA games found for ${date}`)
    return resultMap
  }

  // Fetch boxscores sequentially to avoid NBA rate-limiting
  for (const gameId of gameIds) {
    await processNbaGame(gameId, resultMap)
    // Small delay to be respectful of the stats.nba.com rate limiter
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`[fetchNbaGameResults] ${date}: ${gameIds.length} games, ${resultMap.size} players resolved`)
  return resultMap
}

/**
 * Extract the actual stat value for a given statFamily from a player result entry.
 * Returns null if the stat cannot be resolved.
 *
 * @param {object|undefined} playerEntry  Entry from resultMap.get(normName(player))
 * @param {string}           statFamily
 * @returns {number|null}
 */
function getNbaStatValue(playerEntry, statFamily) {
  if (!playerEntry) return null
  const fam = String(statFamily || "").toLowerCase()

  if (fam === "rebounds") return playerEntry.rebounds ?? null
  if (fam === "threes")   return playerEntry.threes   ?? null
  if (fam === "assists")  return playerEntry.assists  ?? null
  if (fam === "points")   return playerEntry.points   ?? null
  if (fam === "blocks")   return playerEntry.blocks   ?? null
  if (fam === "steals")   return playerEntry.steals   ?? null

  return null
}

module.exports = { fetchNbaGameResults, getNbaStatValue, normName }
