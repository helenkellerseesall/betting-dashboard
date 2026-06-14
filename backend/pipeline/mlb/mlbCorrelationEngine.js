"use strict"

/**
 * mlbCorrelationEngine.js — Phase T2-Correlation-1A (2026-06-14)
 *
 * MLB-specific 2-leg correlation engine (the MLB sibling of pipeline/nba/
 * nbaCorrelationEngine.js — same per-sport placement pattern, Law 28). Given two
 * legs in the SAME MLB game and their marginal probabilities, returns the
 * correctly-CORRELATED, sign-enforced joint probability P(both) — NOT the naive
 * product p1·p2.
 *
 * Method: Gaussian copula via the shared math primitive backend/pipeline/shared/
 * gaussianCopula.js (the ONE method authority — Law 1). Dependence per STRUCTURAL
 * leg-type pair comes from backend/config/mlbCorrelationPriors.json (ρ_Z fit from
 * the graded ledger by deriveMlbCorrelationPriors.js).
 *
 * SHADOW ONLY (v1): pure, marginal-AGNOSTIC (takes p1/p2 — NEVER recomputes
 * modelProb), feeds NOTHING in scoring, no tracked_bets ride-along. R2 freeze +
 * T2-L1 shadow untouched. Does NOT modify nbaCorrelationEngine.js.
 *
 * v1 scope: MLB same-game, 2-leg, over×over, 3 structural classes —
 *   same-hitter family pair (positive) · same-team two hitters (mild positive) ·
 *   pitcher-Ks-over × opposing-hitter-over (NEGATIVE, the trap).
 *
 * Kill-switch: MLB_CORRELATION env, read once at load (MLB_NB_LADDER pattern).
 * Default ON; exact string "0" = OFF (engine returns null → callers see nothing).
 */

const fs = require("fs")
const path = require("path")
const { copulaJoint } = require("../shared/gaussianCopula")

// Kill-switch (read once at module load).
const ENABLED = (process.env.MLB_CORRELATION ?? "1") !== "0"
console.log(`[MLB-CORRELATION-BOOT] ${ENABLED ? "ON" : "OFF — MLB_CORRELATION=0"}`)

// Priors (load once at module load; deriveMlbCorrelationPriors.js regenerates).
const PRIORS_PATH = path.join(__dirname, "..", "..", "config", "mlbCorrelationPriors.json")
let PRIORS = { types: {} }
try { PRIORS = JSON.parse(fs.readFileSync(PRIORS_PATH, "utf8")) } catch (e) {
  console.log(`[MLB-CORRELATION-BOOT] priors unreadable (${e && e.code ? e.code : e}) — engine returns independence fallback`)
}

const PITCHER = new Set(["ks", "outs", "walks", "earnedRuns"])
const isPitcher = (f) => PITCHER.has(f)
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const fam = (leg) => String(leg && leg.statFamily != null ? leg.statFamily : "").trim()
const side = (leg) => String(leg && leg.side != null ? leg.side : "").trim().toLowerCase()
const team = (leg) => String(leg && leg.team != null ? leg.team : "").trim()
const evId = (leg) => String(leg && leg.eventId != null ? leg.eventId : "").trim()

/**
 * classifyPair(legA, legB) → canonical structural-type key (string) or null.
 * MUST match deriveMlbCorrelationPriors.js so keys line up with the priors.
 * Returns null for any pair outside v1 scope (not same-game, not over×over,
 * pitcher×pitcher, pitcher-K vs same-team hitter, opposing two-hitters, etc.).
 */
function classifyPair(legA, legB) {
  if (!legA || !legB) return null
  const ea = evId(legA), eb = evId(legB)
  if (!ea || ea !== eb) return null                 // must be same game
  if (side(legA) !== "over" || side(legB) !== "over") return null  // v1: over×over only
  const fa = fam(legA), fb = fam(legB)
  const ap = isPitcher(fa), bp = isPitcher(fb)
  if (ap !== bp) {
    const pitcherFam = ap ? fa : fb
    if (pitcherFam !== "ks") return null
    const sameTeam = team(legA) && team(legB) && team(legA) === team(legB)
    return sameTeam ? null : "pitcherK_over__x__OPP_hitter_over"   // the negative trap
  }
  if (ap && bp) return null                          // pitcher×pitcher out of scope
  // both hitters
  const samePlayer = String(legA.player || "").toLowerCase().trim() === String(legB.player || "").toLowerCase().trim() && legA.player
  if (samePlayer) return `SAMEhitter_over__${[fa, fb].sort().join("+")}`
  const sameTeam = team(legA) && team(legB) && team(legA) === team(legB)
  return sameTeam ? "SAMEteam_2hitters_over_x_over" : null
}

/**
 * jointForPair(legA, legB, { p1, p2 }) → result | null
 *
 * null when the engine is OFF. Otherwise:
 *   { joint, rawProduct, rho, structuralType, lift, sign, fallback, n }
 * Marginal-agnostic: uses provided p1/p2; if omitted, reads legX.modelProb (a
 * READ of the existing field — never a recompute). When the pair has no prior
 * (out of scope / thin), returns independence (joint = rawProduct, rho 0).
 */
function jointForPair(legA, legB, opts = {}) {
  if (!ENABLED) return null
  const p1 = toNum(opts.p1) != null ? toNum(opts.p1) : toNum(legA && legA.modelProb)
  const p2 = toNum(opts.p2) != null ? toNum(opts.p2) : toNum(legB && legB.modelProb)
  if (p1 == null || p2 == null) return null          // no marginals → honest null
  const rawProduct = p1 * p2
  const type = classifyPair(legA, legB)
  const prior = type && PRIORS.types ? PRIORS.types[type] : null
  if (!prior || !Number.isFinite(Number(prior.rhoZ))) {
    return { joint: rawProduct, rawProduct, rho: 0, structuralType: type || null, lift: 1, sign: 0, fallback: true, n: prior ? prior.n : 0 }
  }
  const rho = Number(prior.rhoZ)
  const joint = copulaJoint(p1, p2, rho)
  return { joint, rawProduct, rho, structuralType: type, lift: rawProduct > 0 ? joint / rawProduct : null, sign: Math.sign(rho), fallback: false, n: prior.n }
}

module.exports = { classifyPair, jointForPair, _enabled: ENABLED, _priorsPath: PRIORS_PATH, PITCHER }
