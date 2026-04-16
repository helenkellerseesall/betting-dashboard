"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

// Odds normalization for lane scoring (0..1).
// Works with American odds (positive or negative). Treats missing as 0.5.
function normalizeOdds01(odds) {
  const o = toNum(odds)
  if (!Number.isFinite(o) || o === 0) return 0.5
  // Convert to a rough payout magnitude proxy (higher = more payout).
  // For negative odds, treat magnitude as lower payout.
  const payout = o > 0 ? o : 10000 / Math.abs(o) // e.g. -200 -> 50, -110 -> 90.9
  const x = Math.log1p(Math.max(0, payout))
  const lo = Math.log1p(50)
  const hi = Math.log1p(1500)
  return clamp((x - lo) / (hi - lo), 0, 1)
}

function midRangeOddsBoost01(odds) {
  const o = toNum(odds)
  if (!Number.isFinite(o) || o === 0) return 0.5
  const payout = o > 0 ? o : 10000 / Math.abs(o)
  // Peak around +300, decay out to ~+900 or ~+60.
  const peak = 300
  const width = 600
  return clamp(1 - Math.abs(payout - peak) / width, 0, 1)
}

function computeMlbPowerScore(row) {
  const edge = toNum(row?.edgeProbability) ?? 0
  const sig = toNum(row?.signalScore) ?? 0
  const odds01 = normalizeOdds01(row?.odds)
  return Number((edge * 0.5 + sig * 0.2 + odds01 * 0.3).toFixed(6))
}

function computeMlbSafeScore(row) {
  const pred = toNum(row?.predictedProbability) ?? 0
  const sig = toNum(row?.signalScore) ?? 0
  const edge = toNum(row?.edgeProbability) ?? 0
  return Number((pred * 0.5 + sig * 0.3 + edge * 0.2).toFixed(6))
}

function computeMlbValueScore(row) {
  const edge = toNum(row?.edgeProbability) ?? 0
  const sig = toNum(row?.signalScore) ?? 0
  const odds01 = midRangeOddsBoost01(row?.odds)
  return Number((edge * 0.6 + sig * 0.3 + odds01 * 0.1).toFixed(6))
}

module.exports = {
  computeMlbPowerScore,
  computeMlbSafeScore,
  computeMlbValueScore,
  normalizeOdds01,
  midRangeOddsBoost01
}

