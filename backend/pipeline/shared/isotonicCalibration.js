"use strict"

/**
 * isotonicCalibration.js — Phase T2-MarginalCalib-1A (2026-06-14)
 *
 * Pure, sport-agnostic probability-calibration primitives. No IO, no state, no
 * Math.random, no Date.now, no scipy.
 *
 *   - fitIsotonic(points)  — monotone non-decreasing fit via Pool-Adjacent-
 *     Violators (PAVA). points = [{x, y, w?}] (x = raw prob, y = realized rate
 *     in [0,1], w = sample weight). Returns { knots: [{x, y}] }.
 *   - predictIsotonic(fit, x) — clamped linear interpolation over the knots.
 *   - fitPlatt(points) — 1-D logistic on logit(x) (gradient descent); the
 *     thin-data fallback (smoother than a steppy isotonic). Returns { a, b }.
 *   - predictPlatt(model, x).
 *
 * Monotone by construction ⇒ calibration preserves the RANKING of legs (never
 * scrambles relative edges). Used by the MLB marginal-calibration shadow layer.
 */

const PEPS = 1e-6
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
function clampP(x) { return x < PEPS ? PEPS : x > 1 - PEPS ? 1 - PEPS : x }
function logit(p) { const q = clampP(p); return Math.log(q / (1 - q)) }
function sigmoid(z) { return 1 / (1 + Math.exp(-z)) }

// Weighted PAVA. Returns knots (weighted block means), x-ordered, y non-decreasing.
function fitIsotonic(points) {
  const pts = (Array.isArray(points) ? points : [])
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({ x: p.x, y: p.y, w: Number.isFinite(p.w) && p.w > 0 ? p.w : 1 }))
    .sort((a, b) => a.x - b.x)
  if (!pts.length) return { knots: [] }
  const blocks = [] // { sx, sy, w }  (weighted sums)
  for (const p of pts) {
    blocks.push({ sx: p.x * p.w, sy: p.y * p.w, w: p.w })
    while (blocks.length >= 2) {
      const b2 = blocks[blocks.length - 1], b1 = blocks[blocks.length - 2]
      if (b1.sy / b1.w <= b2.sy / b2.w + 1e-15) break
      blocks.pop(); blocks.pop()
      blocks.push({ sx: b1.sx + b2.sx, sy: b1.sy + b2.sy, w: b1.w + b2.w })
    }
  }
  return { knots: blocks.map(b => ({ x: b.sx / b.w, y: clamp01(b.sy / b.w) })) }
}

function predictIsotonic(fit, x) {
  const k = fit && fit.knots ? fit.knots : []
  if (!k.length) return clamp01(x)
  if (x <= k[0].x) return clamp01(k[0].y)
  if (x >= k[k.length - 1].x) return clamp01(k[k.length - 1].y)
  for (let i = 0; i < k.length - 1; i++) {
    if (x <= k[i + 1].x) {
      const span = (k[i + 1].x - k[i].x) || 1
      const t = (x - k[i].x) / span
      return clamp01(k[i].y + t * (k[i + 1].y - k[i].y))
    }
  }
  return clamp01(k[k.length - 1].y)
}

// 1-D Platt: y ≈ sigmoid(a + b·logit(x)). Weighted log-loss via gradient descent.
function fitPlatt(points, { iters = 6000, lr = 0.2 } = {}) {
  const pts = (Array.isArray(points) ? points : [])
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({ z: logit(p.x), y: clamp01(p.y), w: Number.isFinite(p.w) && p.w > 0 ? p.w : 1 }))
  if (!pts.length) return { a: 0, b: 1 }
  const W = pts.reduce((s, p) => s + p.w, 0) || 1
  let a = 0, b = 1
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0
    for (const p of pts) { const t = sigmoid(a + b * p.z); const e = (t - p.y) * p.w; ga += e; gb += e * p.z }
    a -= lr * ga / W; b -= lr * gb / W
  }
  return { a, b }
}

function predictPlatt(model, x) {
  if (!model) return clamp01(x)
  return clamp01(sigmoid(model.a + model.b * logit(x)))
}

module.exports = { fitIsotonic, predictIsotonic, fitPlatt, predictPlatt, logit, sigmoid, clamp01 }

// Inline self-test: `node backend/pipeline/shared/isotonicCalibration.js`
if (require.main === module) {
  const approx = (a, b, t = 1e-6) => Math.abs(a - b) <= t
  const tests = []
  const T = (l, c) => tests.push([l, c])

  // Overconfident synthetic: raw x high, realized y much lower, monotone.
  const pts = [
    { x: 0.10, y: 0.05, w: 100 }, { x: 0.20, y: 0.06, w: 100 }, { x: 0.30, y: 0.10, w: 80 },
    { x: 0.45, y: 0.33, w: 40 }, { x: 0.55, y: 0.36, w: 60 }, { x: 0.66, y: 0.45, w: 90 },
  ]
  const iso = fitIsotonic(pts)
  T("isotonic knots non-decreasing", iso.knots.every((k, i) => i === 0 || k.y >= iso.knots[i - 1].y - 1e-9))
  T("calibrated(0.66) < raw 0.66 (overconf fixed)", predictIsotonic(iso, 0.66) < 0.66)
  T("calibrated(0.66) ≈ realized ~0.45", Math.abs(predictIsotonic(iso, 0.66) - 0.45) < 0.05)
  T("monotone predict: 0.2 ≤ 0.5 ≤ 0.66", predictIsotonic(iso, 0.2) <= predictIsotonic(iso, 0.5) + 1e-9 && predictIsotonic(iso, 0.5) <= predictIsotonic(iso, 0.66) + 1e-9)
  T("predict clamps below first knot", approx(predictIsotonic(iso, 0.0), iso.knots[0].y, 1e-9))
  // Violator pooling: a dip gets pooled flat/monotone.
  const dip = fitIsotonic([{ x: 1, y: 0.8, w: 1 }, { x: 2, y: 0.2, w: 1 }, { x: 3, y: 0.9, w: 1 }])
  T("PAVA pools the violator (monotone)", dip.knots.every((k, i) => i === 0 || k.y >= dip.knots[i - 1].y - 1e-9))
  // Platt recovers a downward shift on overconfident data.
  const platt = fitPlatt(pts)
  T("platt(0.66) < raw 0.66", predictPlatt(platt, 0.66) < 0.66)
  T("platt monotone", predictPlatt(platt, 0.2) <= predictPlatt(platt, 0.66) + 1e-9)

  let ok = 0
  for (const [l, c] of tests) { console.log((c ? "PASS" : "FAIL") + " — " + l); if (c) ok++ }
  console.log(`isotonicCalibration self-test: ${ok}/${tests.length}`)
  process.exit(ok === tests.length ? 0 : 1)
}
