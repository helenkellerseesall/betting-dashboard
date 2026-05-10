"use strict"

/**
 * gradeTrackedSlips — settle slip-level records using already-graded bet results.
 *
 * Reads {sport}_tracked_slips_{date}.json and resolves each slip by checking
 * all legs against the graded bets file. A slip is settled when every leg
 * has a concrete result (win/loss/push — NOT pending/unresolved).
 *
 * Slip settlement rules (standard parlay logic):
 *   All legs win          → slip: "win"
 *   Any leg loses         → slip: "loss"  (even if other legs won/pushed)
 *   All legs win or push,
 *     at least one push   → slip: "push"  (push legs act as removed legs)
 *   Any leg unresolved    → slip: "unresolved"
 *   Any leg still pending → slip: "pending"  (game data not yet available)
 *
 * Leg matching: each leg in the slip has (player, statFamily, side, line).
 * We look up the corresponding bet from the graded bets file by matching
 * on these four fields (case-insensitive player name, normalized fields).
 * If no matching bet is found, the leg is treated as "pending".
 *
 * Writes atomically: tmp → rename.
 *
 * @param {object} opts
 * @param {string} opts.sport   "mlb" | "nba"
 * @param {string} opts.date    YYYY-MM-DD
 * @returns {Promise<{ graded: number, wins: number, losses: number,
 *                     pushes: number, unresolved: number,
 *                     pending: number, total: number }>}
 */

const fs   = require("fs/promises")
const path = require("path")

const RUNTIME_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function normField(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

/**
 * Build a lookup key for matching a leg to a bet.
 * Key: "player|statFamily|side|line"
 */
function legKey(player, statFamily, side, line) {
  return `${normName(player)}|${normField(statFamily)}|${normField(side)}|${line}`
}

/**
 * Determine slip-level result from an array of leg results.
 * @param {string[]} legResults  e.g. ["win","win","loss"]
 * @returns {string}  "win"|"loss"|"push"|"unresolved"|"pending"
 */
function resolveSlipResult(legResults) {
  if (legResults.some((r) => r === "pending"))    return "pending"
  if (legResults.some((r) => r === "unresolved")) return "unresolved"
  if (legResults.some((r) => r === "loss"))       return "loss"
  if (legResults.every((r) => r === "win"))       return "win"
  // All are win or push, at least one push
  if (legResults.every((r) => r === "win" || r === "push")) return "push"
  return "pending"
}

async function gradeTrackedSlips({ sport, date }) {
  const slipsPath = path.join(RUNTIME_DIR, `${sport}_tracked_slips_${date}.json`)
  const betsPath  = path.join(RUNTIME_DIR, `${sport}_tracked_bets_${date}.json`)

  // Load slips
  let slips
  try {
    const raw = await fs.readFile(slipsPath, "utf8")
    slips = JSON.parse(raw)
  } catch {
    console.warn(`[gradeTrackedSlips] No slips file found: ${slipsPath}`)
    return { graded: 0, wins: 0, losses: 0, pushes: 0, unresolved: 0, pending: 0, total: 0 }
  }

  if (!Array.isArray(slips)) {
    console.warn(`[gradeTrackedSlips] Unexpected format in ${slipsPath}`)
    return { graded: 0, wins: 0, losses: 0, pushes: 0, unresolved: 0, pending: 0, total: 0 }
  }

  // Load graded bets → build lookup map by leg key
  let bets = []
  try {
    const raw = await fs.readFile(betsPath, "utf8")
    bets = JSON.parse(raw)
  } catch {
    // No bets file — all slips stay pending
  }

  // Build bet lookup: legKey → result
  const betLookup = new Map()
  if (Array.isArray(bets)) {
    for (const bet of bets) {
      const k = legKey(bet.player, bet.statFamily, bet.side, bet.line)
      // If same key appears twice (different sportsbooks), use the most resolved result
      const existing = betLookup.get(k)
      if (!existing || existing === "pending") {
        betLookup.set(k, String(bet.result || "pending").toLowerCase())
      }
    }
  }

  const now = new Date().toISOString()
  let graded = 0, wins = 0, losses = 0, pushes = 0, unresolved = 0, pending = 0

  const updatedSlips = slips.map((slip) => {
    // Skip already-settled slips
    const currentResult = String(slip.result || "").toLowerCase()
    if (currentResult === "win" || currentResult === "loss" || currentResult === "push") {
      graded++
      if (currentResult === "win")   wins++
      if (currentResult === "loss")  losses++
      if (currentResult === "push")  pushes++
      return slip
    }

    const legs = slip.legs || []
    if (!legs.length) return slip

    // Resolve each leg
    const legResults = legs.map((leg) => {
      const k = legKey(leg.player, leg.statFamily, leg.side, leg.line)
      return betLookup.get(k) || "pending"
    })

    // Settle legs in the slip record
    const updatedLegs = legs.map((leg, i) => ({
      ...leg,
      result: legResults[i],
    }))

    const slipResult = resolveSlipResult(legResults)

    if (slipResult === "pending") {
      pending++
      return { ...slip, legs: updatedLegs, result: "pending" }
    }

    graded++
    if (slipResult === "win")        wins++
    if (slipResult === "loss")       losses++
    if (slipResult === "push")       pushes++
    if (slipResult === "unresolved") unresolved++

    return {
      ...slip,
      legs: updatedLegs,
      result: slipResult,
      settledAt: now,
    }
  })

  // Atomic write
  const tmpPath = slipsPath + `.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmpPath, JSON.stringify(updatedSlips, null, 2), "utf8")
  await fs.rename(tmpPath, slipsPath)

  const summary = {
    graded,
    wins,
    losses,
    pushes,
    unresolved,
    pending,
    total: slips.length,
  }

  console.log(
    `[gradeTrackedSlips] ${sport} ${date}: ${graded} graded (${wins}W/${losses}L/${pushes}P), ` +
    `${unresolved} unresolved, ${pending} pending, ${slips.length} total`
  )

  return summary
}

module.exports = { gradeTrackedSlips }
