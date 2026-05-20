"use strict"

/**
 * vigStripping.js — Phase Item 0003 Increment 2a (2026-05-20).
 *
 * Canonical 2-way + multi-way vig stripping. Multiplicative normalization
 * (canonical for U.S. retail sportsbook markets).
 *
 * METHODOLOGY (multiplicative; canonical):
 *   p_with_vig[i]   = impliedFromAmerican(odds[i])
 *   total           = Σ p_with_vig[i]
 *   p_fair[i]       = p_with_vig[i] / total           // normalized
 *   vig             = total - 1.0
 *
 * For a 2-way market (over/under) with -110/-110 books, raw implied is
 * 0.5238/0.5238 (sum 1.0476); fair is 0.50/0.50; vig = 0.0476.
 *
 * INVARIANTS:
 *   - Pure deterministic; no clock/random/IO.
 *   - Object.frozen module export.
 *   - Anti-fabrication: when an input is null/non-finite/zero-vig-impossible,
 *     returns null. NEVER substitutes a default.
 *   - Σ fair probs = 1.0 (within 1e-9 floating tolerance).
 *   - Sport-agnostic. No MLB/NBA references.
 *
 * CONSUMERS (Increment 2b/2c/2d):
 *   - backend/pipeline/shared/buildFeaturedPlays.scoreCandidate (curator)
 *   - backend/pipeline/shared/buildSlipAi.scoreLeg               (slip AI)
 *
 * REPLAY/LIVE PARITY: zero state dependency; replay output equals live output
 * for the same (overOdds, underOdds) pair.
 */

function _impliedFromAmerican(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

/**
 * Strip vig from a two-way market.
 *
 * @param {number|null} overOdds  American odds for the OVER side.
 * @param {number|null} underOdds American odds for the UNDER side.
 * @returns {{ overFair: number, underFair: number, vig: number } | null}
 *          null when either side missing or implied prob computation fails.
 */
function stripVigTwoWay(overOdds, underOdds) {
  const pO = _impliedFromAmerican(overOdds)
  const pU = _impliedFromAmerican(underOdds)
  if (pO == null || pU == null) return null
  const total = pO + pU
  if (!Number.isFinite(total) || total <= 0) return null
  return {
    overFair:  pO / total,
    underFair: pU / total,
    vig:       total - 1.0,
  }
}

/**
 * Strip vig from a multi-way market (3+ outcomes).
 *
 * @param {Array<number|null>} oddsArr Array of American odds per outcome.
 * @returns {{ fair: number[], vig: number } | null}
 *          null when any outcome missing or implied-prob compute fails.
 */
function stripVigMultiWay(oddsArr) {
  if (!Array.isArray(oddsArr) || oddsArr.length < 2) return null
  const probs = oddsArr.map(_impliedFromAmerican)
  if (probs.some(p => p == null)) return null
  const total = probs.reduce((s, p) => s + p, 0)
  if (!Number.isFinite(total) || total <= 0) return null
  return {
    fair: probs.map(p => p / total),
    vig:  total - 1.0,
  }
}

/**
 * Return the fair implied probability for a specified side of a 2-way market.
 * Convenience wrapper for callers that only need one side.
 *
 * @param {number|null} overOdds
 * @param {number|null} underOdds
 * @param {"over"|"under"|"OVER"|"UNDER"|string} side
 * @returns {number|null} fair prob ∈ (0,1) or null when missing.
 */
function fairProbFromAmericanPair(overOdds, underOdds, side) {
  const r = stripVigTwoWay(overOdds, underOdds)
  if (!r) return null
  const s = String(side || "").toLowerCase()
  if (s === "over")  return r.overFair
  if (s === "under") return r.underFair
  return null
}

module.exports = Object.freeze({
  stripVigTwoWay,
  stripVigMultiWay,
  fairProbFromAmericanPair,
})
