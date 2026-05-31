"use strict"

/**
 * nbaGameContextCache — exposes game-criticality context per slate game.
 *
 * Why it exists: 2026-05-31 Game 7 trace showed the model fired "MINS ↓"
 * tag on SGA, Caruso, Dylan Harper because their 12-game minutes trend was
 * mildly down. In a Game 7 closeout, starters actually play MORE not less
 * and bench rotation tightens. Every losing leg on the operator's two
 * placed parlays inherited that mistake.
 *
 * MVP shape: reads hand-curated backend/data/nbaSeriesState.json and exposes
 * per-game context flags. Operator extends the JSON as new playoff games
 * are scheduled. Future enhancement: derive from ESPN scoreboard's series
 * summary or hardcode round-by-round.
 *
 * API:
 *   getGameContext(matchup|{home,away}, slateDate) → {
 *     isPlayoff, isElimination, isGame7, seriesStatus,
 *     facingElimination: string[], teamPosture: {[teamName]: "facing-elim"|"about-to-clinch"|"none"}
 *   } | null
 *
 *   gameContextMinutesMultiplier(playerTeam, gameCtx, role) → number
 *     STARTER facing elimination → 1.07 (play MORE)
 *     BENCH   facing elimination → 0.92 (rotation tightens)
 *     STARTER about-to-clinch    → 1.04 (still play heavy but tiny conservation)
 *     BENCH   about-to-clinch    → 1.00 (neutral)
 *     no context                 → 1.00
 *
 *   shouldSuppressMinsDownTag(playerTeam, gameCtx, role) → bool
 *     Returns true when the "MINS ↓" tag from displayBundle.tags is
 *     contextually wrong (starter on a team facing elimination). The tag is
 *     dropped from driver bullets when this fires.
 *
 *   enrichRowWithGameContext(row, slateDate) → row (mutated)
 *     Attaches row.gameContext if a match is found.
 */

const fs = require("fs")
const path = require("path")

const SERIES_FILE = path.join(__dirname, "..", "..", "data", "nbaSeriesState.json")

let _cache = null

function _load() {
  if (_cache !== null) return _cache
  try {
    const raw = JSON.parse(fs.readFileSync(SERIES_FILE, "utf8"))
    _cache = raw && typeof raw === "object" ? raw : { games: {} }
  } catch (e) {
    _cache = { games: {} }
  }
  return _cache
}

function _reset() { _cache = null }

/** Today in ISO YYYY-MM-DD (operator local-day style — matches tracked_bets). */
function _todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Normalize matchup string for fuzzy comparison. */
function _normMatchup(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ")
}

function getGameContext(matchupOrTeams, slateDate) {
  const data = _load()
  const date = slateDate || _todayKey()
  const games = (data.games || {})[date] || []
  if (!games.length) return null

  let target = null
  if (typeof matchupOrTeams === "string") {
    const want = _normMatchup(matchupOrTeams)
    target = games.find((g) => _normMatchup(g.matchup) === want) || null
  } else if (matchupOrTeams && typeof matchupOrTeams === "object") {
    const home = String(matchupOrTeams.home || matchupOrTeams.homeTeam || "").toLowerCase()
    const away = String(matchupOrTeams.away || matchupOrTeams.awayTeam || "").toLowerCase()
    target = games.find((g) =>
      String(g.homeTeam || "").toLowerCase() === home &&
      String(g.awayTeam || "").toLowerCase() === away
    ) || null
  }
  if (!target) return null

  // Build teamPosture map from facingElimination + winner-trailing logic
  const teamPosture = {}
  const facing = Array.isArray(target.facingElimination) ? target.facingElimination : []
  if (target.homeTeam) teamPosture[target.homeTeam] = facing.includes(target.homeTeam) ? "facing-elim" : (target.isElimination ? "about-to-clinch" : "none")
  if (target.awayTeam) teamPosture[target.awayTeam] = facing.includes(target.awayTeam) ? "facing-elim" : (target.isElimination ? "about-to-clinch" : "none")

  return {
    isPlayoff: target.isPlayoff === true,
    isElimination: target.isElimination === true,
    isGame7: target.isGame7 === true,
    seriesStatus: target.seriesStatus || null,
    round: target.round || null,
    facingElimination: facing,
    teamPosture,
    matchup: target.matchup,
  }
}

/** Minutes multiplier given player's team + game ctx + role. */
function gameContextMinutesMultiplier(playerTeam, gameCtx, role) {
  if (!gameCtx) return 1.0
  const posture = (gameCtx.teamPosture || {})[playerTeam]
  if (!posture || posture === "none") return 1.0
  const isStarter = String(role || "").toLowerCase() === "starter"
  if (posture === "facing-elim") return isStarter ? 1.07 : 0.92
  if (posture === "about-to-clinch") return isStarter ? 1.04 : 1.00
  return 1.0
}

/** Should the "MINS ↓" tag be dropped (because game context invalidates the trend)? */
function shouldSuppressMinsDownTag(playerTeam, gameCtx, role) {
  if (!gameCtx) return false
  const posture = (gameCtx.teamPosture || {})[playerTeam]
  if (!posture || posture === "none") return false
  // Starter on a team facing elimination → MINS ↓ is invalid signal
  const isStarter = String(role || "").toLowerCase() === "starter"
  return isStarter && (posture === "facing-elim" || posture === "about-to-clinch")
}

/** Attach context blob to row. Matches by row.matchup against series JSON. */
function enrichRowWithGameContext(row, slateDate) {
  if (!row) return row
  const ctx = getGameContext(row.matchup || { home: row.homeTeam, away: row.awayTeam }, slateDate)
  if (ctx) row.gameContext = ctx
  return row
}

module.exports = {
  getGameContext,
  gameContextMinutesMultiplier,
  shouldSuppressMinsDownTag,
  enrichRowWithGameContext,
  _reset,
}
