"use strict"

/**
 * clvMath — Closing Line Value math.
 *
 * Created 2026-05-26 (Lane B). CLV is the gold-standard proxy for whether a
 * bet has genuine long-run edge: did the market move toward our pick after
 * we made it? Positive CLV (closing implied > opening implied) means sharp
 * money agreed with our position and we got better odds than the closing
 * price — a real signal of value. Negative CLV is the opposite.
 *
 * Pure functions, no I/O, no globals. Honest null on bad input.
 */

/**
 * Convert American odds to implied probability (0..1).
 * +120 → 0.4545
 * -110 → 0.5238
 * Returns null on non-finite / zero input.
 */
function impliedFromAmerican(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return null
  if (o > 0)  return 100 / (o + 100)
  return Math.abs(o) / (Math.abs(o) + 100)
}

/**
 * Compute CLV (closing line value) in probability points.
 * Convention: positive CLV = market moved toward our side after we bet
 * (closing implied > our opening implied), meaning we got a better
 * number than the closing price = real value.
 *
 * Both inputs are AMERICAN odds. Honest null when either is missing.
 */
function computeClv({ openOdds, closeOdds } = {}) {
  const openImp  = impliedFromAmerican(openOdds)
  const closeImp = impliedFromAmerican(closeOdds)
  if (openImp == null || closeImp == null) return null
  return closeImp - openImp  // positive = good
}

/**
 * Bucket CLV into a quality label for badges / display.
 * Thresholds at ±0.01 (1pp) — finer than that is line-shopping noise.
 *
 *   clv ≥ +0.01   → "positive"
 *   |clv| < 0.01  → "neutral"
 *   clv ≤ -0.01   → "negative"
 *
 * Null clv → null quality (don't display badge).
 */
function clvQualityLabel(clv) {
  if (!Number.isFinite(clv)) return null
  if (clv >=  0.01) return "positive"
  if (clv <= -0.01) return "negative"
  return "neutral"
}

module.exports = {
  impliedFromAmerican,
  computeClv,
  clvQualityLabel,
}
