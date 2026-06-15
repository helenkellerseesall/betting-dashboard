"use strict"

/**
 * mlbParlayConstructor.js — Phase T2-Parlay-1A (2026-06-14)
 *
 * SHADOW parlay constructor + EV gate (T2 step 3). Given candidate legs, builds
 * 2-leg parlays, computes the TRUE joint probability (sign-enforced copula for
 * same-game; product for cross-game), computes EV vs the book payout where a
 * price exists, and surfaces ONLY provably +EV cross-game combos — never
 * auto-bundling. Default recommendation is always separate singles.
 *
 * HARD CONSTRAINTS (baked in):
 *   - MARGINAL = CALIBRATED modelProb (mlbMarginalCalibration), NOT raw — raw is
 *     ~+16pp overconfident and would manufacture FAKE +EV parlays.
 *   - JOINT = mlbCorrelationEngine copula for same-game (sign-enforced); product
 *     of calibrated marginals for cross-game (independent).
 *   - EV is computable ONLY for CROSS-GAME (payout = product of single-leg
 *     decimals). SAME-GAME has no book SGP price → evParlay = null (correlation
 *     shown for insight only; NEVER a fabricated EV).
 *   - NEVER AUTO-BUNDLE: a parlay surfaces only if cross-game evParlay > 0 AND
 *     both legs are +EV singles; evIfBetAsSingles is always included so the
 *     7×-singles tradeoff is visible. Default = singles.
 *
 * SHADOW ONLY (v1): pure; feeds NOTHING live (no FE/betting surface/scoring wire).
 * Does NOT touch upside/builders.js (the heuristic v0 sibling — reconcile
 * post-freeze per Law 1) or any PRESERVED module. Kill-switch MLB_PARLAY.
 *
 * Output is CONTINGENT: trustworthy EV requires calibration LIVE (post-freeze)
 * AND real +EV legs. In an efficient market it correctly returns no parlays.
 */

const { calibrateModelProb } = require("./mlbMarginalCalibration")
const { jointForPair } = require("./mlbCorrelationEngine")
const vig = require("../shared/vigStripping")

const ENABLED = (process.env.MLB_PARLAY ?? "1") !== "0"
console.log(`[MLB-PARLAY-BOOT] ${ENABLED ? "ON" : "OFF — MLB_PARLAY=0"}`)

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function americanToDecimal(odds) {
  const n = num(odds)
  if (n == null || n === 0) return null
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
}

// Per-leg prep: calibrated prob, decimal odds, single-leg EV, de-vig fair (when
// the two-way market is provided), and the +EV-single flag.
function prepLeg(leg) {
  const mp = num(leg.modelProb)
  const dec = americanToDecimal(leg.oddsAmerican)
  if (mp == null || dec == null) return null
  const calRes = calibrateModelProb(mp, leg.statFamily, { oddsAmerican: leg.oddsAmerican })
  const calibrated = calRes != null ? calRes : mp        // null only when MLB_MARGINAL_CALIB=0
  const calibratedApplied = calRes != null
  const evSingle = calibrated * dec - 1
  let fair = null
  if (num(leg.overOdds) != null && num(leg.underOdds) != null) {
    fair = vig.fairProbFromAmericanPair(leg.overOdds, leg.underOdds, leg.side)
  }
  const beatsFair = fair != null ? calibrated > fair : null
  return {
    id: leg.id != null ? leg.id : `${leg.player}|${leg.statFamily}|${leg.side}|${leg.line}`,
    player: leg.player, statFamily: leg.statFamily, side: leg.side, line: leg.line,
    eventId: leg.eventId, team: leg.team, oddsAmerican: num(leg.oddsAmerican),
    rawModelProb: mp, calibrated, calibratedApplied, decimal: dec,
    evSingle, fairProb: fair, beatsFair, plusEVsingle: evSingle > 0,
  }
}

/**
 * buildParlays(legs, opts) → { calibrationLive, singles, parlays, sameGame, rejected } | null
 * null when MLB_PARLAY=0. Pure; marginal-agnostic over the leg's modelProb (it
 * calibrates that prob, never recomputes scoring).
 */
function buildParlays(legs, opts = {}) {
  if (!ENABLED) return null
  const prepped = (Array.isArray(legs) ? legs : []).map(prepLeg).filter(Boolean)
  const calibrationLive = prepped.length > 0 && prepped.every(l => l.calibratedApplied)

  const singles = [...prepped].sort((a, b) => b.evSingle - a.evSingle)
  const parlays = []      // recommended cross-game +EV combos
  const sameGame = []     // same-game combos — correlation insight only (no EV)
  const rejected = []     // cross-game combos considered but not surfaced

  for (let i = 0; i < prepped.length; i++) {
    for (let j = i + 1; j < prepped.length; j++) {
      const a = prepped[i], b = prepped[j]
      const isSameGame = a.eventId && b.eventId && a.eventId === b.eventId
      if (isSameGame) {
        const jp = jointForPair(
          { eventId: a.eventId, side: a.side, statFamily: a.statFamily, team: a.team, player: a.player },
          { eventId: b.eventId, side: b.side, statFamily: b.statFamily, team: b.team, player: b.player },
          { p1: a.calibrated, p2: b.calibrated })
        const joint = jp ? jp.joint : a.calibrated * b.calibrated
        sameGame.push({
          legs: [a.id, b.id], type: "same_game",
          joint, rawProduct: a.calibrated * b.calibrated,
          rho: jp ? jp.rho : 0, structuralType: jp ? jp.structuralType : null, sign: jp ? jp.sign : 0,
          evParlay: null,
          note: "same-game: no book SGP price — correlation shown, EV not computable (NOT a +EV signal)",
        })
        continue
      }
      // cross-game (independent): payout = product of decimals; joint = product of calibrated
      const joint = a.calibrated * b.calibrated
      const payout = a.decimal * b.decimal
      const evParlay = joint * payout - 1
      const evIfBetAsSingles = a.evSingle + b.evSingle
      const surface = evParlay > 0 && a.plusEVsingle && b.plusEVsingle
      const entry = {
        legs: [a.id, b.id], type: "cross_game",
        joint, payout, evParlay, evIfBetAsSingles,
        contingent: { calibrationLive },
      }
      if (surface) parlays.push(entry)
      else rejected.push(Object.assign(entry, {
        reason: evParlay <= 0 ? "evParlay<=0" : "a leg is not +EV single",
      }))
    }
  }
  parlays.sort((x, y) => y.evParlay - x.evParlay)
  return {
    calibrationLive,
    recommendation: parlays.length ? "parlays below are +EV; singles still capture more EV — see evIfBetAsSingles" : "no +EV parlay — bet qualified legs as singles",
    singles, parlays, sameGame, rejected,
  }
}

module.exports = { buildParlays, prepLeg, americanToDecimal, _enabled: ENABLED }
