"use strict"

/**
 * buildGradingSummary — compute hit rate, ROI, and segmented stats from
 * graded bets and slips for a given sport + date.
 *
 * Reads:
 *   {sport}_tracked_bets_{date}.json  (graded individual bets)
 *   {sport}_tracked_slips_{date}.json (graded slip parlays)
 *
 * Outputs a summary object:
 * {
 *   sport, date, generatedAt,
 *   bets: {
 *     total, settled, pending, unresolved,
 *     wins, losses, pushes,
 *     hitRate,        // wins / (wins + losses)  ignoring pushes
 *     roi,            // estimated flat-unit ROI
 *     byTier:         { [tier]: { total, wins, losses, pushes, hitRate } }
 *     byStatFamily:   { [family]: { total, wins, losses, pushes, hitRate } }
 *     bySide:         { [side]: { total, wins, losses, pushes, hitRate } }
 *   },
 *   slips: {
 *     total, settled, pending, unresolved,
 *     wins, losses, pushes,
 *     hitRate,
 *     byType:         { [type]: { total, wins, losses, pushes, hitRate } }
 *   }
 * }
 *
 * ROI is approximated using American odds:
 *   win unit:  oddsAmerican > 0  → oddsAmerican / 100
 *              oddsAmerican < 0  → 100 / Math.abs(oddsAmerican)
 *   loss unit: -1
 *   push unit: 0
 *
 * @param {object} opts
 * @param {string} opts.sport   "mlb" | "nba"
 * @param {string} opts.date    YYYY-MM-DD
 * @param {boolean} [opts.write=true]  write summary JSON to tracking dir
 * @returns {Promise<object>}   summary object
 */

const fs   = require("fs/promises")
const path = require("path")

const RUNTIME_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function safeHitRate(wins, losses) {
  const denominator = wins + losses
  return denominator > 0 ? +(wins / denominator).toFixed(4) : null
}

function computeRoi(bets) {
  let unitReturn = 0
  let unitRisked = 0
  for (const bet of bets) {
    const result = String(bet.result || "").toLowerCase()
    if (result !== "win" && result !== "loss" && result !== "push") continue

    const odds = Number(bet.oddsAmerican || 0)
    let winUnit = 0
    if (odds > 0)  winUnit = odds / 100
    if (odds < 0)  winUnit = 100 / Math.abs(odds)

    unitRisked += 1
    if (result === "win")  unitReturn += winUnit
    if (result === "loss") unitReturn -= 1
    // push: unitReturn unchanged, unitRisked += 1 (risk recovered)
  }
  if (unitRisked === 0) return null
  return +((unitReturn / unitRisked) * 100).toFixed(2) // percentage
}

function groupStats(bets, keyFn) {
  const groups = {}
  for (const bet of bets) {
    const result = String(bet.result || "").toLowerCase()
    if (result !== "win" && result !== "loss" && result !== "push") continue

    const key = keyFn(bet) || "unknown"
    if (!groups[key]) groups[key] = { total: 0, wins: 0, losses: 0, pushes: 0 }
    groups[key].total++
    if (result === "win")   groups[key].wins++
    if (result === "loss")  groups[key].losses++
    if (result === "push")  groups[key].pushes++
  }

  for (const key of Object.keys(groups)) {
    const g = groups[key]
    g.hitRate = safeHitRate(g.wins, g.losses)
  }

  return groups
}

async function buildGradingSummary({ sport, date, write = true }) {
  const betsPath  = path.join(RUNTIME_DIR, `${sport}_tracked_bets_${date}.json`)
  const slipsPath = path.join(RUNTIME_DIR, `${sport}_tracked_slips_${date}.json`)

  const bets  = (await readJsonIfExists(betsPath))  || []
  const slips = (await readJsonIfExists(slipsPath)) || []

  // ── Bet-level summary ────────────────────────────────────────────────────────

  const settledBets     = bets.filter((b) => ["win","loss","push"].includes(String(b.result||"").toLowerCase()))
  const pendingBets     = bets.filter((b) => String(b.result||"").toLowerCase() === "pending")
  const unresolvedBets  = bets.filter((b) => String(b.result||"").toLowerCase() === "unresolved")

  const betWins   = settledBets.filter((b) => b.result === "win").length
  const betLosses = settledBets.filter((b) => b.result === "loss").length
  const betPushes = settledBets.filter((b) => b.result === "push").length

  const betSummary = {
    total:      bets.length,
    settled:    settledBets.length,
    pending:    pendingBets.length,
    unresolved: unresolvedBets.length,
    wins:       betWins,
    losses:     betLosses,
    pushes:     betPushes,
    hitRate:    safeHitRate(betWins, betLosses),
    roi:        computeRoi(settledBets),
    byTier:       groupStats(bets, (b) => String(b.tier || "").toUpperCase()),
    byStatFamily: groupStats(bets, (b) => String(b.statFamily || "").toLowerCase()),
    bySide:       groupStats(bets, (b) => String(b.side || "").toLowerCase()),
  }

  // ── Slip-level summary ───────────────────────────────────────────────────────

  const settledSlips    = slips.filter((s) => ["win","loss","push"].includes(String(s.result||"").toLowerCase()))
  const pendingSlips    = slips.filter((s) => String(s.result||"").toLowerCase() === "pending")
  const unresolvedSlips = slips.filter((s) => String(s.result||"").toLowerCase() === "unresolved")

  const slipWins   = settledSlips.filter((s) => s.result === "win").length
  const slipLosses = settledSlips.filter((s) => s.result === "loss").length
  const slipPushes = settledSlips.filter((s) => s.result === "push").length

  const slipSummary = {
    total:      slips.length,
    settled:    settledSlips.length,
    pending:    pendingSlips.length,
    unresolved: unresolvedSlips.length,
    wins:       slipWins,
    losses:     slipLosses,
    pushes:     slipPushes,
    hitRate:    safeHitRate(slipWins, slipLosses),
    byType:     groupStats(slips, (s) => String(s.type || s.tier || "").toUpperCase()),
  }

  // ── Final summary ────────────────────────────────────────────────────────────

  const summary = {
    sport,
    date,
    generatedAt: new Date().toISOString(),
    bets:  betSummary,
    slips: slipSummary,
  }

  if (write) {
    const outPath = path.join(RUNTIME_DIR, `grading_summary_${sport}_${date}.json`)
    const tmpPath = outPath + `.tmp.${process.pid}.${Date.now()}`
    await fs.writeFile(tmpPath, JSON.stringify(summary, null, 2), "utf8")
    await fs.rename(tmpPath, outPath)
    console.log(`[buildGradingSummary] Written: ${outPath}`)
  }

  return summary
}

module.exports = { buildGradingSummary }
