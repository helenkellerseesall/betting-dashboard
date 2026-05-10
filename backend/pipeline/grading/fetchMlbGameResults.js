"use strict"

/**
 * fetchMlbGameResults — fetches full batting + pitching stat lines from
 * the MLB Stats API for every player who appeared in games on a given date.
 *
 * Returns a Map keyed by normalized player name (lowercase, trimmed):
 *   playerName → {
 *     hits, hr, runs, rbis, totalBases, walks,  // batting
 *     ks, outs,                                  // pitching (strikeouts, outs recorded)
 *     _batting: {...},                            // raw batting stats
 *     _pitching: {...}                            // raw pitching stats
 *   }
 *
 * If a player appears as both batter and pitcher (two-way players like Ohtani),
 * both stat blocks are merged — batting stats take priority for overlapping keys.
 *
 * Stat family → result key mapping:
 *   hits        → hits        (batting.hits)
 *   hr          → hr          (batting.homeRuns)
 *   runs        → runs        (batting.runs)
 *   rbis        → rbis        (batting.rbi)
 *   totalBases  → totalBases  (batting.totalBases)
 *   walks       → walks       (batting.baseOnBalls)
 *   ks          → ks          (pitching.strikeOuts)
 *   outs        → outs        (pitching.outs)
 *
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<Map<string, object>>}  Map of player stats, or empty Map on failure
 */

const axios = require("axios")

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
const REQUEST_TIMEOUT = 12000

function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function toInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Extract batting stats from a player node in the MLB boxscore payload.
 * Returns null if the player had no at-bat or plate-appearance activity.
 */
function extractBatting(p) {
  const b = p?.stats?.batting
  if (!b || (toInt(b.atBats) === 0 && toInt(b.plateAppearances) === 0)) return null
  return {
    hits: toInt(b.hits),
    hr: toInt(b.homeRuns),
    runs: toInt(b.runs),
    rbis: toInt(b.rbi),
    totalBases: toInt(b.totalBases),
    walks: toInt(b.baseOnBalls),
  }
}

/**
 * Extract pitching stats from a player node in the MLB boxscore payload.
 * Returns null if the player had zero outs recorded (did not pitch).
 */
function extractPitching(p) {
  const pit = p?.stats?.pitching
  if (!pit || toInt(pit.outs) === 0) return null
  return {
    ks: toInt(pit.strikeOuts),
    outs: toInt(pit.outs),
  }
}

/**
 * Fetch the boxscore for a single game and merge all player stats into resultMap.
 * @param {number} gamePk
 * @param {Map}    resultMap  mutated in place
 */
async function processGame(gamePk, resultMap) {
  let box
  try {
    const r = await axios.get(
      `${MLB_API_BASE}/game/${gamePk}/boxscore`,
      { timeout: REQUEST_TIMEOUT }
    )
    box = r.data
  } catch {
    return // single-game failure is non-fatal
  }

  ;["home", "away"].forEach((side) => {
    const roster = box?.teams?.[side]?.players || {}
    Object.values(roster).forEach((p) => {
      const name = normName(p?.person?.fullName)
      if (!name) return

      const bat = extractBatting(p)
      const pit = extractPitching(p)

      if (!bat && !pit) return // player never entered the game

      const existing = resultMap.get(name) || {}
      resultMap.set(name, {
        ...existing,
        ...(pit || {}),   // pitching first so batting wins overlaps below
        ...(bat || {}),   // batting stats overwrite for two-way players
        _batting:  { ...(existing._batting  || {}), ...(bat  || {}) },
        _pitching: { ...(existing._pitching || {}), ...(pit  || {}) },
      })
    })
  })
}

/**
 * Main export.
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<Map<string, object>>}
 */
async function fetchMlbGameResults(date) {
  const resultMap = new Map()

  let games = []
  try {
    const r = await axios.get(
      `${MLB_API_BASE}/schedule?sportId=1&date=${date}`,
      { timeout: REQUEST_TIMEOUT }
    )
    games = r.data?.dates?.[0]?.games || []
  } catch (err) {
    console.error(`[fetchMlbGameResults] Schedule fetch failed for ${date}: ${err.message}`)
    return resultMap
  }

  if (!games.length) {
    console.log(`[fetchMlbGameResults] No games found for ${date}`)
    return resultMap
  }

  // Fetch boxscores in parallel (capped at 16 concurrent)
  const CONCURRENCY = 16
  for (let i = 0; i < games.length; i += CONCURRENCY) {
    const chunk = games.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map((g) => processGame(g.gamePk, resultMap)))
  }

  console.log(`[fetchMlbGameResults] ${date}: ${games.length} games, ${resultMap.size} players resolved`)
  return resultMap
}

/**
 * Extract the actual stat value for a given statFamily from a player result entry.
 * Returns null if the stat cannot be resolved (player not found or family unknown).
 *
 * @param {object|undefined} playerEntry  Entry from resultMap.get(normName(player))
 * @param {string}           statFamily
 * @returns {number|null}
 */
function getStatValue(playerEntry, statFamily) {
  if (!playerEntry) return null
  const fam = String(statFamily || "").toLowerCase()

  // Pitching families
  if (fam === "ks")   return playerEntry._pitching?.ks   ?? playerEntry.ks   ?? null
  if (fam === "outs") return playerEntry._pitching?.outs ?? playerEntry.outs  ?? null

  // Batting families
  if (fam === "hits")       return playerEntry._batting?.hits       ?? playerEntry.hits       ?? null
  if (fam === "hr")         return playerEntry._batting?.hr         ?? playerEntry.hr         ?? null
  if (fam === "runs")       return playerEntry._batting?.runs       ?? playerEntry.runs       ?? null
  if (fam === "rbis")       return playerEntry._batting?.rbis       ?? playerEntry.rbis       ?? null
  if (fam === "totalbases") return playerEntry._batting?.totalBases ?? playerEntry.totalBases ?? null
  if (fam === "walks")      return playerEntry._batting?.walks      ?? playerEntry.walks      ?? null

  return null
}

module.exports = { fetchMlbGameResults, getStatValue, normName }
