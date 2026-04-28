"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function sigmoid(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0.5
  const z = Math.max(-12, Math.min(12, n))
  return 1 / (1 + Math.exp(-z))
}

function computeRobustStats(values) {
  const xs = Array.isArray(values) ? values.map((v) => toNum(v)).filter((n) => Number.isFinite(n)) : []
  xs.sort((a, b) => a - b)
  if (!xs.length) return { median: 0, p25: 0, p75: 0, iqr: 0, scale: 1, count: 0 }

  const median = xs[Math.floor((xs.length - 1) * 0.5)]
  const p25 = xs[Math.floor((xs.length - 1) * 0.25)]
  const p75 = xs[Math.floor((xs.length - 1) * 0.75)]
  const iqr = p75 - p25
  const scale = iqr > 0 ? iqr / 1.349 : 1 // IQR -> ~std

  return { median, p25, p75, iqr, scale, count: xs.length }
}

/**
 * Compute a probability from a continuous score using robust normalization + logistic compression.
 *
 * @param {number} inputScore
 * @param {{
 *   stats?: { median: number, scale: number },
 *   median?: number,
 *   scale?: number,
 *   floor?: number,
 *   ceiling?: number,
 *   midpoint?: number,
 *   k?: number,
 * }} cfg
 */
function computeProbabilityFromScore(inputScore, cfg = {}) {
  const score = toNum(inputScore)
  const median = toNum(cfg?.stats?.median) ?? toNum(cfg?.median) ?? 0
  const scale = toNum(cfg?.stats?.scale) ?? toNum(cfg?.scale) ?? 1

  const floor = clamp(toNum(cfg?.floor) ?? 0.05, 0, 1)
  const ceiling = clamp(toNum(cfg?.ceiling) ?? 0.3, 0, 1)
  const midpoint = toNum(cfg?.midpoint) ?? 0.15
  const k = toNum(cfg?.k) ?? 1.05

  const z = ((score ?? median) - median) / (scale || 1)
  const p = floor + (ceiling - floor) * sigmoid(k * (z - midpoint))
  return clamp(p, floor, ceiling)
}

module.exports = {
  computeRobustStats,
  computeProbabilityFromScore,
}

