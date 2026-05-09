"use strict"

/**
 * Offensive Eruption Analysis (Session W)
 *
 * Pure functions. No IO. No side effects.
 *
 * Detects and classifies offensive eruption events.
 *
 * An "eruption" is a game where:
 *   - 2+ over bets hit (general_over_surge)
 *   - 2+ HR overs hit in the same game (hr_cascade)
 *   - 3+ RBI overs hit in the same game (rbi_chain)
 *   - High implied team total environment AND 3+ overs hit (offensive_blowout)
 *
 * Critical detection: "HR cascade miss"
 *   - Game had HR candidates in pool
 *   - We built 0 HR slips for that game
 *   - 1+ HR overs hit
 *   → MAJOR FINDING: HR_CASCADE_MISS
 *
 * Also classifies:
 *   - pitcher_collapse: multiple UNDER bets miss due to blowout start
 *   - first_basket_run: NBA early-scoring surge (first_basket/firstbasket family)
 *   - suppression_stack: high-implied environment, we played unders, overs hit
 *
 * Game grouping:
 *   Uses eventId > matchup > teams field for correlation.
 *   Falls back to matchup string when no eventId present.
 */

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function isHit(bet) {
  const r = String(bet.result || "").toLowerCase()
  if (r === "win") return true
  if (r === "loss") return false
  const stat = num(bet.actualStat ?? bet.actual_stat)
  const line = num(bet.line)
  const side = String(bet.side || "").toLowerCase()
  if (Number.isFinite(stat) && Number.isFinite(line)) {
    if (side.startsWith("o") || side === "yes") return stat > line
    if (side.startsWith("u") || side === "no") return stat < line
  }
  return null
}

function statFam(b) {
  return String(b?.statFamily || b?.stat_family || "").toLowerCase().replace(/[\s_-]/g, "")
}

function isHrStat(b) {
  const f = statFam(b)
  return f === "hr" || f === "homeruns" || f === "homerun" || f.startsWith("hr")
}

function isRbiStat(b) {
  const f = statFam(b)
  return f === "rbis" || f === "rbi" || f === "runsbattedin"
}

function isFirstBasketStat(b) {
  const f = statFam(b)
  return f.includes("firstbasket") || f.includes("first_basket")
}

function isUnder(b) {
  return String(b.side || "").toLowerCase().startsWith("u")
}

function isOver(b) {
  const s = String(b.side || "").toLowerCase()
  return s.startsWith("o") || s === "yes"
}

/**
 * Get the event key for grouping bets by game.
 */
function getEventKey(bet) {
  return (
    bet.eventId ||
    bet.event_id ||
    bet.matchup ||
    bet.teams ||
    bet.gameId ||
    null
  )
}

/**
 * Group bets by event/game.
 * Returns { eventKey: [bets...] }
 */
function groupByEvent(bets) {
  const groups = {}
  for (const bet of bets) {
    const key = getEventKey(bet) || "unknown_game"
    if (!groups[key]) groups[key] = []
    groups[key].push(bet)
  }
  return groups
}

/**
 * Analyze a single game's bets for eruption patterns.
 *
 * @param {string} eventKey
 * @param {Array}  gameBets — all bets for this game
 * @param {Array}  allSlips — all slips (to check if we had coverage)
 * @returns {object|null} eruption event or null if no eruption detected
 */
function analyzeGame(eventKey, gameBets, allSlips) {
  const overBets = gameBets.filter(isOver)
  const settledOvers = overBets.filter((b) => isHit(b) !== null)
  const hittingOvers = settledOvers.filter((b) => isHit(b) === true)

  // HR analysis for this game
  const hrOvers = overBets.filter(isHrStat)
  const hrHits = hrOvers.filter((b) => isHit(b) === true)

  // RBI analysis
  const rbiOvers = overBets.filter(isRbiStat)
  const rbiHits = rbiOvers.filter((b) => isHit(b) === true)

  // First basket (NBA)
  const fbOvers = overBets.filter(isFirstBasketStat)
  const fbHits = fbOvers.filter((b) => isHit(b) === true)

  // Under analysis: pitcher collapse detection
  const underBets = gameBets.filter(isUnder)
  const settledUnders = underBets.filter((b) => isHit(b) !== null)
  const missedUnders = settledUnders.filter((b) => isHit(b) === false)

  // Detection thresholds
  const isEruption =
    hittingOvers.length >= 2 ||
    hrHits.length >= 1 ||
    rbiHits.length >= 3 ||
    fbHits.length >= 2 ||
    (missedUnders.length >= 3)  // pitcher collapse

  if (!isEruption) return null

  // Get matchup from first bet
  const matchup = gameBets[0]?.matchup || gameBets[0]?.teams || eventKey

  // Environment from first bet with environment data
  const envBet = gameBets.find((b) => b.environment && typeof b.environment === "object") || {}
  const env = envBet.environment || {}
  const itt = num(env.impliedTeamTotal ?? env.implied_team_total)

  // Eruption type (priority order: hr_cascade > rbi_chain > offensive_blowout > pitcher_collapse > general)
  let eruptionType = "general_over_surge"
  if (hrHits.length >= 2) eruptionType = "hr_cascade"
  else if (hrHits.length >= 1 && (hrOvers.length >= 1)) eruptionType = "hr_cascade"
  else if (rbiHits.length >= 3) eruptionType = "rbi_chain"
  else if (fbHits.length >= 2) eruptionType = "first_basket_run"
  else if (Number.isFinite(itt) && itt >= 6 && hittingOvers.length >= 3) eruptionType = "offensive_blowout"
  else if (missedUnders.length >= 3 && hittingOvers.length >= 2) eruptionType = "pitcher_collapse"

  // Eruption magnitude: [0, 1] — 5+ overs = full magnitude
  const eruptionScore = round4(Math.min(1.0, hittingOvers.length / 5))

  // Check if this game had slip coverage
  const slipLegsForGame = []
  for (const slip of allSlips || []) {
    for (const leg of slip.legs || []) {
      const legEventKey = getEventKey(leg)
      // Match by eventId OR matchup string
      if (
        (legEventKey && legEventKey === eventKey) ||
        (leg.matchup && leg.matchup === matchup)
      ) {
        slipLegsForGame.push(leg)
      }
    }
  }

  const overSlipLegs = slipLegsForGame.filter(isOver)
  const hrSlipLegs = slipLegsForGame.filter(isHrStat)

  const wasPredict = overSlipLegs.length > 0
  const wasMissed = !wasPredict

  // HR eruption miss: HR erupted in this game, we had HR candidates but 0 HR slips
  const hrEruptionMiss =
    hrHits.length >= 1 && hrOvers.length > 0 && hrSlipLegs.length === 0

  return {
    eventId: eventKey,
    matchup,
    totalOverBets: overBets.length,
    settlingOvers: settledOvers.length,
    hittingOvers: hittingOvers.length,
    eruptionScore,
    eruptionType,
    hrEruption: hrHits.length >= 1 ? 1 : 0,
    hrInPool: hrOvers.length,
    hrInSlips: hrSlipLegs.length,
    hrEruptionMiss: hrEruptionMiss ? 1 : 0,
    impliedTeamTotal: itt,
    parkFactor: num(env.parkFactor ?? env.park_factor),
    windOut: env.windOut === true || env.wind_out === true ? 1 : 0,
    wasPredicted: wasPredict ? 1 : 0,
    wasMissed: wasMissed ? 1 : 0,
    slipCoverage: slipLegsForGame.length,
    eruptors: hittingOvers.slice(0, 6).map((b) => ({
      player: b.player,
      statFamily: b.statFamily,
      side: b.side,
      line: b.line,
      actualStat: b.actualStat,
      delta: (() => {
        const s = num(b.actualStat)
        const l = num(b.line)
        return Number.isFinite(s) && Number.isFinite(l) ? round4(s - l) : null
      })(),
    })),
  }
}

/**
 * Build a summary across all eruption events.
 */
function summarizeEruptions(events) {
  if (!events.length) {
    return {
      eruptionCount: 0,
      missedEruptions: 0,
      hrCascades: 0,
      hrEruptionMisses: 0,
      avgEruptionScore: null,
      coverageRate: null,
      majorFinding: null,
    }
  }

  const missed = events.filter((e) => e.wasMissed)
  const hrCascades = events.filter((e) => e.eruptionType === "hr_cascade")
  const hrMisses = events.filter((e) => e.hrEruptionMiss)
  const avgScore =
    round4(events.reduce((a, e) => a + e.eruptionScore, 0) / events.length)
  const coverageRate = round4(1 - missed.length / events.length)

  const majorFinding =
    hrMisses.length >= 1
      ? `HR_CASCADE_MISS: ${hrMisses.length} game(s) with HR eruptions we weren't slipped into (${hrMisses.map((e) => e.matchup).join(", ")})`
      : missed.length >= 2
        ? `COVERAGE_MISS: ${missed.length}/${events.length} eruption events with zero slip coverage`
        : null

  return {
    eruptionCount: events.length,
    missedEruptions: missed.length,
    hrCascades: hrCascades.length,
    hrEruptionMisses: hrMisses.length,
    avgEruptionScore: avgScore,
    coverageRate,
    majorFinding,
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Analyze offensive eruptions for one (sport, date).
 *
 * @param {object} opts
 * @param {Array}  opts.bets   — all tracked bets
 * @param {Array}  opts.slips  — all tracked slips
 * @returns {object}
 */
function analyzeOffensiveEruptions({ bets = [], slips = [] } = {}) {
  const gameGroups = groupByEvent(bets)
  const events = []

  for (const [eventKey, gameBets] of Object.entries(gameGroups)) {
    if (eventKey === "unknown_game") continue  // skip ungroupable bets
    const analysis = analyzeGame(eventKey, gameBets, slips)
    if (analysis) events.push(analysis)
  }

  // Sort by eruption score descending
  events.sort((a, b) => b.eruptionScore - a.eruptionScore)

  const summary = summarizeEruptions(events)

  return {
    events,
    summary,
    majorFindings: [summary.majorFinding].filter(Boolean),
  }
}

module.exports = {
  analyzeOffensiveEruptions,
  analyzeGame,
  groupByEvent,
  summarizeEruptions,
}
