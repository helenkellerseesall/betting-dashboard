"use strict"
// ============================================================================
// negBinomLadder — T2 Step 1 (mlb-nb-ladder-v1, 2026-06-12).
//
// Fits a per-player count distribution from real game logs and returns the
// LADDER = survival function P(X ≥ k) at prop-line rungs. Per the parlay/ladder
// playbook (docs/research/2026-06-11-parlay-ladder-playbook.md §6): MLB/NBA
// counting stats are OVERDISPERSED (measured on our own batter logs 2026-06-12:
// avg var/mean = 2.14 across 317 batters with n≥10) → Negative Binomial, with
// a Poisson-limit fallback when a sample is NOT overdispersed (var ≤ mean).
//
// PURE MODULE: no fs, no network, no Date.now, no Math.random. Plain JS — the
// NB PMF uses a stable multiplicative recurrence, no gamma function, no scipy.
//
// Method-of-moments fit (operator-approved Phase-1 plan):
//   mean m, sample variance v (n−1 denominator)
//   v > m  → NegBinom: r = m²/(v−m), p = m/v      (mean = r(1−p)/p = m ✓)
//   v ≤ m  → Poisson-limit: λ = m
//   n < MIN_GAMES (10) → null (probabilityHonesty doctrine: absent, never invented)
//
// PMF recurrences:
//   NB:      P(0) = p^r;        P(k+1) = P(k) · (r+k)/(k+1) · (1−p)
//   Poisson: P(0) = e^(−λ);     P(k+1) = P(k) · λ/(k+1)
// Survival: P(X ≥ k) = 1 − Σ_{i<k} P(i), clamped to [0,1] for float dust.
//
// ANTI-FABRICATION: only finite numeric counts are used; thin/missing samples
// return null; rungs are honest probabilities of the fitted distribution —
// they carry fit meta {n, mean, variance, r|lambda, p, method} so every number
// is traceable to the sample that produced it.
// ============================================================================

const MIN_GAMES = 10 // mirrors pipeline/shared/playerPropHistory.js MIN_GAMES
const DEFAULT_RUNGS = [0.5, 1.5, 2.5, 3.5, 4.5]

function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/**
 * Method-of-moments fit over an array of non-negative integer-ish counts.
 * @returns {null | {method:"negbinom"|"poisson", n, mean, variance, r?, p?, lambda?}}
 */
function fitCountsMoM(countsRaw, { minN = MIN_GAMES } = {}) {
  const counts = (Array.isArray(countsRaw) ? countsRaw : [])
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 0)
  const n = counts.length
  if (n < minN) return null
  const mean = counts.reduce((a, b) => a + b, 0) / n
  const variance = counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)
  if (variance > mean && mean > 0) {
    const r = (mean * mean) / (variance - mean)
    const p = mean / variance
    return { method: "negbinom", n, mean, variance, r, p }
  }
  return { method: "poisson", n, mean, variance, lambda: mean }
}

/**
 * PMF values P(0)..P(kMax) for a fit, via stable recurrence.
 */
function pmfArray(fit, kMax) {
  const out = []
  if (!fit || !Number.isFinite(kMax) || kMax < 0) return out
  if (fit.method === "negbinom") {
    const { r, p } = fit
    let pk = Math.pow(p, r)
    for (let k = 0; k <= kMax; k++) {
      out.push(pk)
      pk = pk * ((r + k) / (k + 1)) * (1 - p)
    }
  } else {
    const lam = fit.lambda
    let pk = Math.exp(-lam)
    for (let k = 0; k <= kMax; k++) {
      out.push(pk)
      pk = (pk * lam) / (k + 1)
    }
  }
  return out
}

/**
 * Survival P(X ≥ k) for integer k ≥ 0.
 */
function survival(fit, k) {
  if (!fit) return null
  const kk = Math.max(0, Math.ceil(k))
  if (kk === 0) return 1
  const pmf = pmfArray(fit, kk - 1)
  const cdf = pmf.reduce((a, b) => a + b, 0)
  return clamp01(1 - cdf)
}

/**
 * Ladder at prop-line rungs from raw counts.
 * @returns {null | { ladder: {"0.5":P(X≥1), "1.5":P(X≥2), …}, meta }}
 */
function ladderFromCounts(counts, { rungs = DEFAULT_RUNGS, minN = MIN_GAMES } = {}) {
  const fit = fitCountsMoM(counts, { minN })
  if (!fit) return null
  const ladder = {}
  for (const rung of rungs) {
    const k = Math.ceil(Number(rung))
    if (!Number.isFinite(k) || k < 0) continue
    ladder[String(rung)] = round6(survival(fit, k))
  }
  return {
    ladder,
    meta: {
      method: fit.method,
      n: fit.n,
      mean: round6(fit.mean),
      variance: round6(fit.variance),
      ...(fit.method === "negbinom" ? { r: round6(fit.r), p: round6(fit.p) } : { lambda: round6(fit.lambda) }),
    },
  }
}

/**
 * Ladder from game-log entries shaped like mlbBatterGameLogs:
 *   games: [{ date, opponent, isHome, stats: { totalBases: n, … } }, …]
 */
function ladderFromLogs(games, statKey, opts = {}) {
  const arr = Array.isArray(games) ? games : []
  const counts = arr
    .map((g) => Number(g && g.stats ? g.stats[statKey] : undefined))
    .filter((x) => Number.isFinite(x) && x >= 0)
  return ladderFromCounts(counts, opts)
}

function round6(x) {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x
}

// ============================================================================
// G2-L1 EXTENSION (2026-07-16, scope approved in OPERATOR_SESSION_LOG) — the
// per-player, per-family curve fitter. EXTENDS this sanctioned shadow module
// (Law 1); everything above is untouched and byte-identical for the existing
// mlb-nb-ladder-v1 shadow consumer.
//
//   - WEIGHTED MoM: exponential recency weights w_i = 0.5^(age/halfLife)
//     (age in games back from the most recent; halfLife null ⇒ all weights 1 ⇒
//     EXACTLY the legacy unweighted fit). Weighted mean m = Σwx/Σw; weighted
//     variance uses the reliability-weights form v = Σw(x−m)² / (Σw − Σw²/Σw),
//     which reduces to the legacy n−1 denominator when unweighted. Effective
//     sample nEff = (Σw)²/Σw² carried in meta. halfLife is a PARAMETER here —
//     the v1 constant is chosen EMPIRICALLY by the L2 validator across
//     {10, 20, 40, none} on out-of-sample tail calibration (CA-approved) and
//     frozen there, not assumed here.
//   - FLOORS on RAW game count (not nEff): caller passes minN (approved:
//     batters 15, pitchers 8). Below floor ⇒ null ⇒ NO CURVE ⇒ the player is
//     absent from every downstream surface (probabilityHonesty: absent, never
//     a league-average invention; no prior-blending in v1).
//   - TAIL SUPPORT CAP (tail-honesty, longshot doc §1): rungs are emitted only
//     to k ≤ maxObserved+1. A tail the sample never approached is not priced —
//     an uncalibrated tail prob is entertainment, not edge.
//   - Games are sorted by date ASCENDING internally (caches store descending);
//     recency weighting is order-correct regardless of input order.
// ============================================================================

/** Family → game-log stats key (batter logs use `rbi`; pitcher Ks = strikeOuts). */
const FAMILY_STAT_KEYS = { hits: "hits", totalBases: "totalBases", rbis: "rbi", runs: "runs", ks: "strikeOuts",
  // 2026-07-26 FAMILY EXPANSION — new families enter through the SAME gates:
  // curves fit from the season logs that already carry these stats, then the
  // walk-forward validator's PASS-or-STOP bars decide; no board exposure
  // without a PASS verdict (scanner eligibility reads the verdicts JSON).
  stolenBases: "stolenBases", doubles: "doubles", triples: "triples" }

/**
 * Weighted method-of-moments fit. counts must be OLDEST-FIRST when halfLife
 * is set. halfLife null/0 ⇒ unweighted (legacy-identical estimates).
 * @returns {null | {method, n, nEff, mean, variance, r?, p?, lambda?, halfLife}}
 */
function fitCountsMoMWeighted(countsRaw, { minN = MIN_GAMES, halfLife = null } = {}) {
  const counts = (Array.isArray(countsRaw) ? countsRaw : [])
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 0)
  const n = counts.length
  if (n < minN) return null
  const hl = Number(halfLife)
  const weighted = Number.isFinite(hl) && hl > 0
  let sw = 0, swx = 0, sw2 = 0
  const w = new Array(n)
  for (let i = 0; i < n; i++) {
    const age = n - 1 - i // most recent (last) has age 0
    w[i] = weighted ? Math.pow(0.5, age / hl) : 1
    sw += w[i]
    sw2 += w[i] * w[i]
    swx += w[i] * counts[i]
  }
  const mean = swx / sw
  let vNum = 0
  for (let i = 0; i < n; i++) vNum += w[i] * (counts[i] - mean) * (counts[i] - mean)
  const vDen = sw - sw2 / sw // reduces to n−1 when all w=1
  if (!(vDen > 0)) return null
  const variance = vNum / vDen
  const nEff = (sw * sw) / sw2
  const base = { n, nEff: round6(nEff), mean, variance, halfLife: weighted ? hl : null }
  if (variance > mean && mean > 0) {
    const r = (mean * mean) / (variance - mean)
    const p = mean / variance
    return { method: "negbinom", ...base, r, p }
  }
  return { method: "poisson", ...base, lambda: mean }
}

/**
 * Fit a per-player curve for one stat family from game-log entries
 * ({date, stats:{...}} — batter `games` or pitcher `starts` rows).
 * @returns {null | { family, ladder, supportCap, meta }}
 */
function fitPlayerFamilyCurve(games, family, { minN = 15, halfLife = null, maxGames = 60 } = {}) {
  const statKey = FAMILY_STAT_KEYS[family]
  if (!statKey) return null
  const rows = (Array.isArray(games) ? games : [])
    .map((g) => ({ date: String(g?.date || ""), count: Number(g?.stats ? g.stats[statKey] : undefined) }))
    .filter((r) => Number.isFinite(r.count) && r.count >= 0 && r.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) // ASC — weights are order-correct
    .slice(-Math.max(1, maxGames))
  const counts = rows.map((r) => r.count)
  const fit = fitCountsMoMWeighted(counts, { minN, halfLife })
  if (!fit) return null
  const maxObserved = counts.reduce((a, b) => Math.max(a, b), 0)
  const supportCap = maxObserved + 1
  const ladder = {}
  for (let k = 1; k <= supportCap; k++) ladder[String(k - 0.5)] = round6(survival(fit, k))
  return {
    family,
    ladder, // rungs "0.5".."supportCap−0.5" ONLY — beyond the cap is never priced
    supportCap,
    meta: {
      method: fit.method,
      n: fit.n,
      nEff: fit.nEff,
      mean: round6(fit.mean),
      variance: round6(fit.variance),
      halfLife: fit.halfLife,
      maxObserved,
      window: { oldest: rows[0]?.date || null, newest: rows[rows.length - 1]?.date || null, maxGames },
      ...(fit.method === "negbinom" ? { r: round6(fit.r), p: round6(fit.p) } : { lambda: round6(fit.lambda) }),
    },
  }
}

module.exports = { fitCountsMoM, pmfArray, survival, ladderFromCounts, ladderFromLogs, MIN_GAMES, DEFAULT_RUNGS,
  // G2-L1 exports
  fitCountsMoMWeighted, fitPlayerFamilyCurve, FAMILY_STAT_KEYS }

// ── inline self-tests (run: node negBinomLadder.js) ─────────────────────────
if (require.main === module) {
  let pass = 0, fail = 0
  const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", label) } }
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

  // NB hand-computed reference: r=2, p=0.5 → P(0)=0.25, P(1)=0.25, P(2)=0.1875
  const nb = { method: "negbinom", r: 2, p: 0.5 }
  const pmf = pmfArray(nb, 2)
  ok("NB P(0)=0.25", near(pmf[0], 0.25))
  ok("NB P(1)=0.25", near(pmf[1], 0.25))
  ok("NB P(2)=0.1875", near(pmf[2], 0.1875))
  ok("NB survival(1)=0.75", near(survival(nb, 1), 0.75))
  ok("NB survival(2)=0.5", near(survival(nb, 2), 0.5))
  ok("NB survival(3)=0.3125", near(survival(nb, 3), 0.3125))
  // NB mean recovery: mean = r(1−p)/p = 2 → truncated Σ k·P(k) ≈ 2
  const pmfLong = pmfArray(nb, 200)
  const meanRec = pmfLong.reduce((a, p, k) => a + k * p, 0)
  ok("NB truncated mean ≈ 2", near(meanRec, 2, 1e-6))

  // Poisson reference: λ=1 → P(0)=P(1)=e^−1; survival(1)=1−e^−1; survival(2)=1−2e^−1
  const po = { method: "poisson", lambda: 1 }
  ok("Poisson P(0)=e^-1", near(pmfArray(po, 0)[0], Math.exp(-1)))
  ok("Poisson survival(1)", near(survival(po, 1), 1 - Math.exp(-1)))
  ok("Poisson survival(2)", near(survival(po, 2), 1 - 2 * Math.exp(-1)))

  // Fit: overdispersed sample → negbinom with MoM params
  const od = [0, 0, 1, 0, 4, 2, 0, 5, 1, 0, 3, 0] // n=12
  const fit1 = fitCountsMoM(od)
  ok("fit method negbinom", fit1 && fit1.method === "negbinom")
  if (fit1 && fit1.method === "negbinom") {
    ok("fit r formula", near(fit1.r, (fit1.mean * fit1.mean) / (fit1.variance - fit1.mean)))
    ok("fit p formula", near(fit1.p, fit1.mean / fit1.variance))
  }
  // Fit: constant sample (var=0 ≤ mean) → poisson
  const fit2 = fitCountsMoM([2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  ok("constant → poisson", fit2 && fit2.method === "poisson" && near(fit2.lambda, 2))
  // n floor
  ok("n=9 → null", fitCountsMoM([1, 2, 0, 1, 3, 0, 1, 2, 1]) === null)
  // junk filtered
  const fit3 = fitCountsMoM([1, "x", null, 2, 0, 1, 3, 0, 1, 2, 1, NaN, -5])
  ok("junk filtered, n=10 kept", fit3 !== null && fit3.n === 10)
  // ladder monotone + all-zero honesty
  const lad = ladderFromCounts(od)
  const vals = Object.values(lad.ladder)
  ok("ladder monotone non-increasing", vals.every((v, i) => i === 0 || v <= vals[i - 1] + 1e-12))
  const zeros = ladderFromCounts([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  ok("all-zero → P(X≥1)=0", zeros && zeros.ladder["0.5"] === 0)
  // ladderFromLogs extraction
  const games = od.map((tb) => ({ stats: { totalBases: tb } }))
  const lad2 = ladderFromLogs(games, "totalBases")
  ok("ladderFromLogs matches ladderFromCounts", JSON.stringify(lad2) === JSON.stringify(lad))

  console.log(`negBinomLadder self-tests: ${pass}/${pass + fail} PASS`)
  process.exit(fail ? 1 : 0)
}
