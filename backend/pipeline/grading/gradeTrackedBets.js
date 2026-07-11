"use strict"

/**
 * gradeTrackedBets — settle individual tracked bets against actual game results.
 *
 * Reads {sport}_tracked_bets_{date}.json, resolves each bet via:
 *   1. Look up player in resultsMap (by normalized name)
 *   2. Extract the stat value for the bet's statFamily
 *   3. Call settleFromActual({ side, line, actualValue }) to determine win/loss/push
 *   4. Write result + settledAt + actualValue back to the bet record
 *
 * Writes atomically: tmp file → rename.
 *
 * Result field values after grading:
 *   "win"         — bet won
 *   "loss"        — bet lost
 *   "push"        — bet pushed (line hit exactly)
 *   "unresolved"  — player found but stat family unsupported, or actualValue was null
 *   "pending"     — player NOT found in resultsMap (game not yet played / API miss)
 *
 * "unresolved" records are distinguished from "pending" so they can be targeted
 * for retry separately. "pending" means we simply didn't get game data yet.
 * "unresolved" means we got game data but couldn't match this specific stat.
 *
 * @param {object} opts
 * @param {string} opts.sport          "mlb" | "nba"
 * @param {string} opts.date           YYYY-MM-DD
 * @param {Map}    opts.resultsMap     Map from fetchMlbGameResults / fetchNbaGameResults
 * @param {Function} opts.getStatValue (playerEntry, statFamily) → number|null
 * @returns {Promise<{ graded: number, wins: number, losses: number, pushes: number,
 *                     unresolved: number, alreadySettled: number, total: number }>}
 */

const fs   = require("fs/promises")
const path = require("path")

const RUNTIME_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function settleFromActual({ side, line, actualValue }) {
  const s = normName(side)
  const ln = line != null ? Number(line) : null
  const act = actualValue != null ? Number(actualValue) : null

  if (act == null || !Number.isFinite(act)) return { status: "open", result: "pending" }

  if (s === "over" && ln != null && Number.isFinite(ln)) {
    if (act > ln)  return { status: "settled", result: "win" }
    if (act === ln) return { status: "settled", result: "push" }
    return { status: "settled", result: "loss" }
  }
  if (s === "under" && ln != null && Number.isFinite(ln)) {
    if (act < ln)  return { status: "settled", result: "win" }
    if (act === ln) return { status: "settled", result: "push" }
    return { status: "settled", result: "loss" }
  }

  // Binary yes/no (HR over 0.5 is treated as yes/no)
  if ((s === "yes" || s === "to hit" || s === "hit") && ln == null) {
    return act >= 1 ? { status: "settled", result: "win" } : { status: "settled", result: "loss" }
  }
  if (s === "no" && ln == null) {
    return act >= 1 ? { status: "settled", result: "loss" } : { status: "settled", result: "win" }
  }

  return { status: "open", result: "pending" }
}

async function gradeTrackedBets({ sport, date, resultsMap, getStatValue, firstHrCtx = null }) {
  const betsPath = path.join(RUNTIME_DIR, `${sport}_tracked_bets_${date}.json`)

  let bets
  try {
    const raw = await fs.readFile(betsPath, "utf8")
    bets = JSON.parse(raw)
  } catch {
    console.warn(`[gradeTrackedBets] No bets file found: ${betsPath}`)
    return { graded: 0, wins: 0, losses: 0, pushes: 0, unresolved: 0, alreadySettled: 0, total: 0 }
  }

  if (!Array.isArray(bets)) {
    console.warn(`[gradeTrackedBets] Unexpected format in ${betsPath}`)
    return { graded: 0, wins: 0, losses: 0, pushes: 0, unresolved: 0, alreadySettled: 0, total: 0 }
  }

  const now = new Date().toISOString()
  let graded = 0, wins = 0, losses = 0, pushes = 0, unresolved = 0, alreadySettled = 0

  const updatedBets = bets.map((bet) => {
    // Skip already-settled bets (win/loss/push/void — settled rows are immutable)
    const currentResult = String(bet.result || "").toLowerCase()
    if (currentResult === "win" || currentResult === "loss" || currentResult === "push" || currentResult === "void") {
      alreadySettled++
      return bet
    }

    // 2026-07-11 F FIRST-HR CURE — batter_first_home_run settles by PLAY ORDER,
    // never by the box-score HR total (line=0 + total-HR made any-HR a FALSE WIN
    // and no-HR a push instead of a loss). Book convention:
    //   this player hit the game's FIRST HR ⇒ win · someone else did ⇒ loss ·
    //   game finished with NO HR ⇒ void · game not final / unjoinable ⇒ pending.
    if (String(bet.marketKey || "") === "batter_first_home_run") {
      if (!firstHrCtx) return { ...bet, result: "pending" } // no ctx ⇒ never guess
      const g = firstHrCtx.findGame(bet)
      if (!g || !g.final) return { ...bet, result: "pending" }
      graded++
      if (g.noHr) { pushes++; return { ...bet, result: "void", actualValue: 0, settledAt: now } }
      const won = g.firstHrBatter && g.firstHrBatter === firstHrCtx.normPlayer(bet.player)
      if (won) { wins++; return { ...bet, result: "win", actualValue: 1, settledAt: now } }
      losses++
      return { ...bet, result: "loss", actualValue: 0, settledAt: now }
    }

    const playerKey = normName(bet.player)
    const playerEntry = resultsMap.get(playerKey)

    // Player not found → game hasn't been played yet or API miss → keep pending
    if (!playerEntry) {
      return { ...bet, result: "pending" }
    }

    const actualValue = getStatValue(playerEntry, bet.statFamily)

    // Player found but stat not available → unresolved (retryable, non-pending)
    if (actualValue == null) {
      unresolved++
      return { ...bet, result: "unresolved", actualValue: null, settledAt: now }
    }

    const { result } = settleFromActual({
      side: bet.side,
      line: bet.line,
      actualValue,
    })

    graded++
    if (result === "win")   wins++
    if (result === "loss")  losses++
    if (result === "push")  pushes++

    return {
      ...bet,
      result,
      actualValue,
      settledAt: now,
    }
  })

  // Atomic write: tmp → rename
  const tmpPath = betsPath + `.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmpPath, JSON.stringify(updatedBets, null, 2), "utf8")
  await fs.rename(tmpPath, betsPath)

  const summary = {
    graded,
    wins,
    losses,
    pushes,
    unresolved,
    alreadySettled,
    total: bets.length,
  }

  console.log(
    `[gradeTrackedBets] ${sport} ${date}: ${graded} graded (${wins}W/${losses}L/${pushes}P), ` +
    `${unresolved} unresolved, ${alreadySettled} already settled, ${bets.length - graded - unresolved - alreadySettled} pending`
  )

  return summary
}

module.exports = { gradeTrackedBets, settleFromActual }
