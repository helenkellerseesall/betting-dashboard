"use strict"

/**
 * gaussianCopula.js — Phase T2-Correlation-1A (2026-06-14)
 *
 * Pure, sport-agnostic MATH primitive for 2-leg correlated joint probability.
 * The ONE method authority for the Gaussian copula (Law 1) — the MLB engine
 * (pipeline/mlb/mlbCorrelationEngine.js) consumes it; the NBA engine may later
 * graduate its heuristic boost onto it. No IO, no state, no Math.random, no
 * Date.now, no scipy.
 *
 * Copula setup (2 binary legs): a leg "hits" with marginal prob p. Map to a
 * latent standard normal: hit ⟺ Φ(Z) ≤ p ⟺ Z ≤ Φ⁻¹(p). With (Z1,Z2) ~ bivariate
 * normal of correlation ρ_Z:
 *
 *     P(both hit) = Φ₂( Φ⁻¹(p1), Φ⁻¹(p2) ; ρ_Z )
 *
 * Φ₂ is increasing in ρ_Z, so:  ρ_Z > 0 ⇒ joint > p1·p2 (positive dependence),
 * ρ_Z < 0 ⇒ joint < p1·p2 (the negative-correlation trap), ρ_Z = 0 ⇒ joint = p1·p2.
 * That is the sign enforcement the parlay math requires.
 *
 * Φ₂ via Plackett's identity ∂Φ₂/∂ρ = φ₂(a,b;ρ) (the basis of Drezner–Wesolowsky):
 *     Φ₂(a,b;ρ) = Φ(a)Φ(b) + ∫₀^ρ φ₂(a,b;r) dr
 * integrated by composite Simpson (pure JS). Exact anchor: Φ₂(0,0;ρ) = ¼ + asin(ρ)/2π.
 */

const SQRT2 = Math.SQRT2
const TWO_PI = 2 * Math.PI

// erf — Abramowitz & Stegun 7.1.26 (max abs err ~1.5e-7). Sufficient for our
// tolerances; Φ(0)=0.5 is exact regardless (erf(0)=0).
function erf(x) {
  const s = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return s * y
}

// Standard normal CDF Φ(x).
function normalCdf(x) {
  return 0.5 * (1 + erf(x / SQRT2))
}

// Standard normal pdf φ(x).
function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(TWO_PI)
}

// Inverse standard normal CDF Φ⁻¹(p) — Acklam's rational approximation + one
// Halley refinement step (accuracy ~1e-9 over (0,1)).
function invNormalCdf(p) {
  if (!(p > 0)) return -Infinity
  if (!(p < 1)) return Infinity
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const plow = 0.02425, phigh = 1 - plow
  let x
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= phigh) {
    const q = p - 0.5, r = q * q
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  // Halley step
  const e = normalCdf(x) - p
  const u = e / normalPdf(x)
  x = x - u / (1 + x * u / 2)
  return x
}

// Bivariate normal pdf φ₂(a,b;r).
function biNormalPdf(a, b, r) {
  const om = 1 - r * r
  return Math.exp(-(a * a - 2 * r * a * b + b * b) / (2 * om)) / (TWO_PI * Math.sqrt(om))
}

const RHO_CAP = 0.999

// Bivariate normal CDF Φ₂(a,b;ρ) = P(Z1≤a, Z2≤b). Plackett integral via composite
// Simpson (n even). Reduces to Φ(a)Φ(b) at ρ=0.
function biNormalCdf(a, b, rho, n = 2000) {
  let r = rho
  if (r > RHO_CAP) r = RHO_CAP
  if (r < -RHO_CAP) r = -RHO_CAP
  const base = normalCdf(a) * normalCdf(b)
  if (r === 0) return base
  if (n % 2 === 1) n += 1
  const h = r / n
  let sum = biNormalPdf(a, b, 0) + biNormalPdf(a, b, r)
  for (let i = 1; i < n; i++) {
    const x = i * h
    sum += (i % 2 === 0 ? 2 : 4) * biNormalPdf(a, b, x)
  }
  const integral = (h / 3) * sum
  let out = base + integral
  if (out < 0) out = 0
  if (out > 1) out = 1
  return out
}

const PEPS = 1e-9
function clampP(p) {
  if (!(p > PEPS)) return PEPS
  if (!(p < 1 - PEPS)) return 1 - PEPS
  return p
}

// copulaJoint(p1, p2, rhoZ) → P(both) under the Gaussian copula.
function copulaJoint(p1, p2, rhoZ) {
  const a = invNormalCdf(clampP(p1))
  const b = invNormalCdf(clampP(p2))
  return biNormalCdf(a, b, rhoZ)
}

// Fréchet–Hoeffding bounds for P(both) given marginals.
function frechet(px, py) {
  return { lo: Math.max(0, px + py - 1), hi: Math.min(px, py) }
}

// fitRhoZ(px, py, pBoth) → ρ_Z s.t. copulaJoint(px,py,ρ_Z) = pBoth, via bisection
// (copulaJoint is monotone increasing in ρ_Z). Clamps pBoth to the Fréchet range.
function fitRhoZ(px, py, pBoth) {
  const { lo, hi } = frechet(px, py)
  let target = pBoth
  if (target <= lo) return -RHO_CAP
  if (target >= hi) return RHO_CAP
  let loR = -RHO_CAP, hiR = RHO_CAP
  for (let it = 0; it < 80; it++) {
    const mid = (loR + hiR) / 2
    const j = copulaJoint(px, py, mid)
    if (j < target) loR = mid
    else hiR = mid
  }
  return (loR + hiR) / 2
}

module.exports = { erf, normalCdf, normalPdf, invNormalCdf, biNormalPdf, biNormalCdf, copulaJoint, fitRhoZ, frechet }

// Inline self-test: `node backend/pipeline/shared/gaussianCopula.js`
if (require.main === module) {
  const approx = (a, b, t = 1e-6) => Math.abs(a - b) <= t
  const tests = []
  const T = (label, cond) => tests.push([label, cond])
  T("Phi(0)=0.5", approx(normalCdf(0), 0.5))
  T("invPhi(0.5)=0", approx(invNormalCdf(0.5), 0, 1e-6))
  T("invPhi(0.975)=1.959964", approx(invNormalCdf(0.975), 1.959964, 1e-4))
  T("Phi2(0,0,0)=0.25", approx(biNormalCdf(0, 0, 0), 0.25))
  T("Phi2(0,0,0.5)=1/4+asin(.5)/2pi", approx(biNormalCdf(0, 0, 0.5), 0.25 + Math.asin(0.5) / TWO_PI, 1e-7))
  T("Phi2(0,0,-0.5)=1/4+asin(-.5)/2pi", approx(biNormalCdf(0, 0, -0.5), 0.25 + Math.asin(-0.5) / TWO_PI, 1e-7))
  T("copulaJoint indep = product", approx(copulaJoint(0.3, 0.4, 0), 0.12, 1e-6))
  T("copulaJoint rho>0 > product", copulaJoint(0.3, 0.4, 0.5) > 0.12)
  T("copulaJoint rho<0 < product", copulaJoint(0.3, 0.4, -0.5) < 0.12)
  T("fitRhoZ round-trip", approx(fitRhoZ(0.5, 0.5, 0.25 + Math.asin(0.5) / TWO_PI), 0.5, 1e-3))
  let ok = 0
  for (const [label, cond] of tests) { console.log((cond ? "PASS" : "FAIL") + " — " + label); if (cond) ok++ }
  console.log(`gaussianCopula self-test: ${ok}/${tests.length}`)
  process.exit(ok === tests.length ? 0 : 1)
}
