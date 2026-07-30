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

// 2026-07-30 INCIDENT ROOT FIX (ASK 7aae50f): NFD diacritic strip added — the
// old trim+lowercase kept accents, so the finals map keyed "yandy díaz" while
// tracked rows carry ASCII "yandy diaz" and EVERY accented player's rows
// silently never graded (289 pending rows on 7/23 alone; the Daily 3 stall;
// starved CLV/corpus for the whole class). Parity with fetchMlbFirstHr's
// normName (which always stripped) — one join behavior across grading.
function normName(v) {
  return String(v == null ? "" : v)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
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
    stolenBases: toInt(b.stolenBases),    // 2026-05-23: sport-config has batter_stolen_bases
    strikeouts:  toInt(b.strikeOuts),     // batter Ks (distinct from pitcher Ks)
  }
}

/**
 * Extract pitching stats from a player node in the MLB boxscore payload.
 * Returns null if the player had zero outs recorded (did not pitch).
 *
 * 2026-05-23 — Grader trust audit extension: previously only pulled ks + outs,
 * which caused pitcher_walks (31 unresolved) and pitcher_earned_runs (1
 * unresolved) to never settle. Now extracts baseOnBalls + earnedRuns + hitsAllowed
 * so the corresponding markets can settle. See lanes/grader_trust_audit.md.
 */
function extractPitching(p) {
  const pit = p?.stats?.pitching
  if (!pit || toInt(pit.outs) === 0) return null
  return {
    ks:           toInt(pit.strikeOuts),
    outs:         toInt(pit.outs),
    pitcherWalks: toInt(pit.baseOnBalls),
    earnedRuns:   toInt(pit.earnedRuns),
    hitsAllowed:  toInt(pit.hits),
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
  const fam = String(statFamily || "").toLowerCase().replace(/[\s_\-]+/g, "")

  // Pitching families
  if (fam === "ks" || fam === "strikeouts" || fam === "pitcherstrikeouts")
    return playerEntry._pitching?.ks   ?? playerEntry.ks   ?? null
  if (fam === "outs" || fam === "pitcherouts")
    return playerEntry._pitching?.outs ?? playerEntry.outs ?? null
  // 2026-05-23 grader trust audit: pitcher_walks + pitcher_earned_runs were
  // unresolvable before. Now extracted from pitching boxscore.
  if (fam === "pitcherwalks")
    return playerEntry._pitching?.pitcherWalks ?? null
  if (fam === "earnedruns" || fam === "pitcherearnedruns")
    return playerEntry._pitching?.earnedRuns   ?? null
  if (fam === "hitsallowed" || fam === "pitcherhitsallowed")
    return playerEntry._pitching?.hitsAllowed  ?? null

  // Batting families
  if (fam === "hits" || fam === "batterhits")
    return playerEntry._batting?.hits       ?? playerEntry.hits       ?? null
  if (fam === "hr" || fam === "homeruns" || fam === "batterhomeruns")
    return playerEntry._batting?.hr         ?? playerEntry.hr         ?? null
  if (fam === "runs" || fam === "runsscored" || fam === "batterrunsscored")
    return playerEntry._batting?.runs       ?? playerEntry.runs       ?? null
  if (fam === "rbis" || fam === "rbi" || fam === "batterrbis")
    return playerEntry._batting?.rbis       ?? playerEntry.rbis       ?? null
  if (fam === "totalbases" || fam === "battertotalbases")
    return playerEntry._batting?.totalBases ?? playerEntry.totalBases ?? null
  if (fam === "walks" || fam === "batterwalks") {
    // 2026-05-23 grader trust audit follow-up: statFamily is "walks" for both
    // pitcher_walks and batter_walks rows (writer doesn't preserve the
    // pitcher_ prefix). Disambiguate by whether this player pitched today.
    // If they did, "walks" means walks allowed (_pitching.pitcherWalks).
    // Else "walks" means walks drawn (_batting.walks). Defends against
    // two-way players by preferring pitching context for walks (pitcher's
    // primary identity).
    const pitched = playerEntry._pitching && Number(playerEntry._pitching.outs) > 0
    if (pitched) return playerEntry._pitching.pitcherWalks ?? null
    return playerEntry._batting?.walks      ?? playerEntry.walks      ?? null
  }
  if (fam === "sb" || fam === "stolenbases" || fam === "batterstolenbases")
    return playerEntry._batting?.stolenBases ?? null
  if (fam === "batterstrikeouts" || fam === "batterks")
    return playerEntry._batting?.strikeouts  ?? null

  return null
}

module.exports = { fetchMlbGameResults, getStatValue, normName }
