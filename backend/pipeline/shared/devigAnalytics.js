"use strict"
/**
 * devigAnalytics.js — ANALYTICS-ONLY de-vig refinements (2026-06-17, CB).
 *
 * WHY SEPARATE: the canonical vigStripping.js is PRESERVED ("foundational to every scoring
 * decision") and uses the MULTIPLICATIVE method — it is consumed by scoring (buildFeaturedPlays
 * /buildSlipAi). This module does NOT touch it. It provides the POWER de-vig + a FanDuel-weighted
 * prop consensus for the ANALYTICS / CLV / benchmark path ONLY. Never read by scoring/selection.
 *
 * POWER method: find k>0 such that pA^k + pB^k = 1, fair = p^k. Keeps probs in [0,1] and corrects
 * the favorite-longshot bias the multiplicative method leaves (it over-shaves favorites) — matters
 * more for props' fatter vig. Reduces to multiplicative for symmetric (-110/-110) lines.
 *
 * Pure/deterministic; anti-fabrication (missing/invalid → null, never a default).
 */

function _impliedFromAmerican(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

/**
 * Power de-vig of a two-way market → fair probs that sum to 1.0.
 * @returns {{ aFair, bFair, k, vig } | null}
 */
function powerDevigTwoWay(oddsA, oddsB) {
  const a = _impliedFromAmerican(oddsA)
  const b = _impliedFromAmerican(oddsB)
  if (a == null || b == null) return null
  const total = a + b
  if (!(total > 0)) return null
  const vig = total - 1.0
  // Solve a^k + b^k = 1 for k via bisection. f(k) is strictly decreasing; f(1)=total-1>=0.
  // If total<=1 (no vig / arbitrage) just normalize multiplicatively (k=1 fallback).
  if (total <= 1) return { aFair: a / total, bFair: b / total, k: 1, vig }
  const f = (k) => Math.pow(a, k) + Math.pow(b, k) - 1
  let lo = 1, hi = 1
  // expand hi until f(hi) < 0
  for (let i = 0; i < 60 && f(hi) > 0; i++) hi *= 1.5
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid; else hi = mid
  }
  const k = (lo + hi) / 2
  const aFair = Math.pow(a, k), bFair = Math.pow(b, k)
  // numerical guard: renormalize the tiny residual so they sum to exactly 1
  const s = aFair + bFair
  return { aFair: aFair / s, bFair: bFair / s, k, vig }
}

/** Multiplicative (canonical) two-way de-vig — mirrored here ONLY for analytics before/after. */
function multiplicativeDevigTwoWay(oddsA, oddsB) {
  const a = _impliedFromAmerican(oddsA), b = _impliedFromAmerican(oddsB)
  if (a == null || b == null) return null
  const total = a + b
  if (!(total > 0)) return null
  return { aFair: a / total, bFair: b / total, vig: total - 1.0 }
}

/**
 * FanDuel-weighted consensus over per-book fair probs (MLB prop price leader = FanDuel).
 * @param {Array<{book, fairProb}>} perBook
 * @param {object} opts { fanduelWeight=2.0, otherWeight=1.0 }
 * @returns { consensus, nBooks, fanduelPresent } | null
 */
function fanduelWeightedConsensus(perBook, { fanduelWeight = 2.0, otherWeight = 1.0 } = {}) {
  const rows = (Array.isArray(perBook) ? perBook : []).filter(r => r && Number.isFinite(Number(r.fairProb)))
  if (!rows.length) return null
  // dedupe to one entry per book (avoid stale/duplicate-row skew — an audited bug in the
  // equal-weight mean), keeping the last seen per canonical book.
  const byBook = new Map()
  for (const r of rows) byBook.set(String(r.book || "").toLowerCase().replace(/\s+/g, ""), r)
  const uniq = [...byBook.values()]
  let wsum = 0, w = 0, fd = false
  for (const r of uniq) {
    const isFd = String(r.book || "").toLowerCase().replace(/\s+/g, "") === "fanduel"
    if (isFd) fd = true
    const wt = isFd ? fanduelWeight : otherWeight
    wsum += Number(r.fairProb) * wt; w += wt
  }
  if (w <= 0) return null
  return { consensus: wsum / w, nBooks: uniq.length, fanduelPresent: fd }
}

/** Equal-weight mean (the CURRENT analytics consensus) — for before/after parity. */
function equalWeightConsensus(perBook) {
  const rows = (Array.isArray(perBook) ? perBook : []).filter(r => r && Number.isFinite(Number(r.fairProb)))
  if (!rows.length) return null
  return { consensus: rows.reduce((s, r) => s + Number(r.fairProb), 0) / rows.length, nBooks: rows.length }
}

module.exports = { powerDevigTwoWay, multiplicativeDevigTwoWay, fanduelWeightedConsensus, equalWeightConsensus, _impliedFromAmerican }
