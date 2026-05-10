"use strict"

/**
 * fetchNbaGameResults — fetches player stat lines from the ESPN public API
 * for all players who appeared in NBA games on a given date.
 *
 * INGESTION SOURCE: ESPN public API (site.api.espn.com)
 *   Replaces: stats.nba.com — blocked from Node.js servers (403 / network block)
 *   ESPN requires no auth, no special headers, handles regular season + playoffs.
 *
 * Two-step fetch:
 *   1. scoreboard?dates=YYYYMMDD  → array of ESPN game IDs
 *   2. summary?event={gameId}     → per-player stat lines per game
 *
 * Returns a Map keyed by normalized player name (lowercase, trimmed):
 *   playerName → { rebounds, threes, assists, points, blocks, steals }
 *
 * Stat family → result key mapping (aligned to tracked_bets statFamily field):
 *   rebounds → "rebounds"           (ESPN key: "rebounds", total REB)
 *   threes   → "threes"             (ESPN key: "threePointFieldGoals", parsed from "M-A")
 *   assists  → "assists"            (ESPN key: "assists")
 *   points   → "points"             (ESPN key: "points")
 *   blocks   → "blocks"             (ESPN key: "blocks")
 *   steals   → "steals"             (ESPN key: "steals")
 *
 * ESPN stat value formats:
 *   Integer stats (rebounds, assists, etc.): "7"  → 7
 *   Ratio stats (threePointFieldGoals):      "2-7" → 2  (made count only)
 *   DNP players: didNotPlay=true → skipped
 *
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<Map<string, object>>}  empty Map on failure (bets stay "pending")
 */

const axios = require("axios")

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const REQUEST_TIMEOUT = 15000

function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function toInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Format date from YYYY-MM-DD to YYYYMMDD (ESPN scoreboard format).
 */
function toEspnDateFormat(isoDate) {
  return isoDate.replace(/-/g, "")
}

/**
 * Parse a stat value from ESPN's format into an integer.
 * - Integer strings ("7") → 7
 * - Ratio strings ("2-7") → 2 (made count, first value before "-")
 * - Empty / non-numeric → null
 */
function parseEspnStat(val) {
  if (val == null || val === "" || val === "--") return null
  const s = String(val).trim()
  // M-A format (fieldGoals, threePointFieldGoals, freeThrows)
  if (s.includes("-")) {
    const made = parseInt(s.split("-")[0], 10)
    return Number.isFinite(made) ? made : null
  }
  // MM:SS format (minutes) — not a stat we use, but handle gracefully
  if (s.includes(":")) {
    return null
  }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * Build a stat-key lookup from an ESPN statistics entry.
 * Returns a function: (key) → parsed integer | null
 */
function makeStatLookup(statGroup) {
  const keys   = statGroup.keys   || []
  return function getStatByKey(athleteStats, key) {
    const idx = keys.indexOf(key)
    if (idx === -1 || idx >= athleteStats.length) return null
    return parseEspnStat(athleteStats[idx])
  }
}

/**
 * Fetch game IDs from the ESPN NBA scoreboard for a given date.
 * Only returns completed games (finished = has real box score data).
 *
 * @param {string} isoDate  YYYY-MM-DD
 * @returns {Promise<string[]>}  ESPN game ID strings
 */
async function fetchNbaGameIds(isoDate) {
  const dateStr = toEspnDateFormat(isoDate)
  const url = `${ESPN_BASE}/scoreboard?dates=${dateStr}&limit=30`
  try {
    const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
    const events = r.data?.events || []

    if (!events.length) {
      console.log(`[fetchNbaGameResults] ESPN scoreboard: 0 events for ${isoDate}`)
      return []
    }

    // Include all games — completed AND in-progress. For historical backfill,
    // all target dates are in the past so all games are completed.
    // For live grading, in-progress game stats are still valid partial data.
    const ids = events.map((e) => String(e.id)).filter(Boolean)
    const completed = events.filter((e) => e.status?.type?.completed === true).length
    console.log(`[fetchNbaGameResults] ESPN scoreboard: ${events.length} games (${completed} completed) for ${isoDate}`)
    return ids
  } catch (err) {
    console.error(
      `[fetchNbaGameResults] Scoreboard fetch failed for ${isoDate}: ` +
      `${err.response ? `HTTP ${err.response.status}` : err.message}`
    )
    return []
  }
}

/**
 * Fetch per-player stats for a single ESPN NBA game and merge into resultMap.
 *
 * ESPN summary endpoint:
 *   boxscore.players[teamIdx].statistics[groupIdx].athletes[playerIdx]
 *     .athlete.displayName  → player name
 *     .stats[colIdx]        → stat value at position matching .keys[colIdx]
 *     .didNotPlay           → true if player did not enter the game
 *
 * @param {string} espnGameId
 * @param {Map}    resultMap  mutated in place
 */
async function processEspnGame(espnGameId, resultMap) {
  const url = `${ESPN_BASE}/summary?event=${espnGameId}`
  let data
  try {
    const r = await axios.get(url, { timeout: REQUEST_TIMEOUT })
    data = r.data
  } catch (err) {
    console.warn(
      `[fetchNbaGameResults] Game ${espnGameId} fetch failed: ` +
      `${err.response ? `HTTP ${err.response.status}` : err.message}`
    )
    return
  }

  const teamGroups = data?.boxscore?.players || []
  if (!teamGroups.length) {
    console.warn(`[fetchNbaGameResults] Game ${espnGameId}: no player data in boxscore`)
    return
  }

  for (const teamData of teamGroups) {
    const statGroups = teamData.statistics || []

    for (const statGroup of statGroups) {
      const getStatByKey = makeStatLookup(statGroup)
      const athletes = statGroup.athletes || []

      for (const athleteData of athletes) {
        // Skip players who did not enter the game
        if (athleteData.didNotPlay === true) continue

        const name = normName(athleteData.athlete?.displayName)
        if (!name) continue

        const rawStats = athleteData.stats || []
        if (!rawStats.length) continue // no stats recorded — player may not have played

        const entry = {
          rebounds: getStatByKey(rawStats, "rebounds"),
          threes:   getStatByKey(rawStats, "threePointFieldGoals"),
          assists:  getStatByKey(rawStats, "assists"),
          points:   getStatByKey(rawStats, "points"),
          blocks:   getStatByKey(rawStats, "blocks"),
          steals:   getStatByKey(rawStats, "steals"),
        }

        // Coerce nulls to 0 for played players — a 0-rebound game is valid
        Object.keys(entry).forEach((k) => {
          if (entry[k] === null) entry[k] = 0
        })

        // Merge — same player appearing in two games (double-headers are impossible
        // in NBA, but handle defensively)
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

  // Fetch game boxscores in parallel (ESPN rate limits are lenient)
  await Promise.all(gameIds.map((id) => processEspnGame(id, resultMap)))

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
