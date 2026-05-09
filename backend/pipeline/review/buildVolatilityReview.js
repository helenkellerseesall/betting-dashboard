"use strict"

/**
 * Volatility Review Engine (Session W)
 *
 * Pure functions. No IO. No side effects.
 *
 * Analyzes whether volatility assumptions held against actual outcomes.
 *
 * Answers:
 *   - Did LOTTO bets produce higher variance outcomes than SAFE bets?
 *   - Were AGGRESSIVE bets correctly assigned to volatile ecology?
 *   - What is the implied-vs-actual probability divergence?
 *   - Which volatility tier had the best hit rate?
 *   - Were suppressed LOTTO candidates correctly avoided or incorrectly suppressed?
 *   - Is the model systematically overconfident or underconfident?
 *
 * Key metric: Volatility Realization Score (VRS)
 *   Measures whether tier labels correctly predicted outcome variance.
 *   Expected ordering by avg |actualStat - line|:
 *     lotto > aggressive > balanced > safe
 *   VRS = 1.0 if ordering holds perfectly across all pairs
 *   VRS = 0.0 if completely inverted
 *   Each violation of expected ordering reduces VRS by 1/(N_pairs)
 */

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function isHit(bet) {
  const r = String(bet.result || "").toLowerCase()
  if (r === "win") return true
  if (r === "loss") return false
  const stat = num(bet.actualStat ?? bet.actual_stat)
  const line = num(bet.line)
  const side = String(bet.side || "").toLowerCase()
  if (Number.isFinite(stat) && Number.isFinite(line)) {
    if (side.startsWith("o") || side === "yes") return stat > line
    if (side.startsWith("u") || side === "no") return stat < line
  }
  return null
}

const VOL_TIER_ORDER = ["safe", "balanced", "aggressive", "lotto"]

// ── Per-tier analysis ─────────────────────────────────────────────────────────

/**
 * Analyze a single volatility tier's bets.
 */
function analyzeTier(tierBets) {
  const settled = tierBets.filter((b) => isHit(b) !== null)
  const hits = settled.filter((b) => isHit(b) === true)

  const deltas = settled
    .map((b) => {
      const stat = num(b.actualStat ?? b.actual_stat)
      const line = num(b.line)
      return Number.isFinite(stat) && Number.isFinite(line) ? Math.abs(stat - line) : null
    })
    .filter((d) => d !== null)

  // Signed delta: normalized to bettor perspective (positive = in our favor)
  const signedDeltas = settled
    .map((b) => {
      const stat = num(b.actualStat ?? b.actual_stat)
      const line = num(b.line)
      const side = String(b.side || "").toLowerCase()
      if (!Number.isFinite(stat) || !Number.isFinite(line)) return null
      const delta = stat - line
      // Positive = moving in the direction of the bet
      return side.startsWith("o") ? delta : -delta
    })
    .filter((d) => d !== null)

  const avgAbsDelta =
    deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null

  const avgSignedDelta =
    signedDeltas.length > 0
      ? signedDeltas.reduce((a, b) => a + b, 0) / signedDeltas.length
      : null

  // Delta variance (higher for lotto is expected and correct)
  let deltaVariance = null
  if (deltas.length > 1 && avgAbsDelta != null) {
    deltaVariance =
      deltas.reduce((a, d) => a + (d - avgAbsDelta) ** 2, 0) / deltas.length
  }

  return {
    count: tierBets.length,
    settled: settled.length,
    hits: hits.length,
    hitRate: settled.length > 0 ? round4(hits.length / settled.length) : null,
    avgAbsDelta: avgAbsDelta != null ? round4(avgAbsDelta) : null,
    avgSignedDelta: avgSignedDelta != null ? round4(avgSignedDelta) : null,
    deltaVariance: deltaVariance != null ? round4(deltaVariance) : null,
  }
}

// ── Volatility Realization Score ──────────────────────────────────────────────

/**
 * Compute VRS: did tier labels correctly predict outcome variance?
 *
 * Expected: avg|delta|(lotto) >= avg|delta|(aggressive) >= avg|delta|(balanced) >= avg|delta|(safe)
 * Each adjacent pair that violates this ordering reduces VRS.
 *
 * @param {object} tierStats — { safe, balanced, aggressive, lotto } each with avgAbsDelta
 * @returns {number|null} VRS in [0, 1] or null if insufficient data
 */
function computeVRS(tierStats) {
  const tiersWithData = VOL_TIER_ORDER
    .map((t) => ({ tier: t, delta: tierStats[t]?.avgAbsDelta }))
    .filter((d) => d.delta != null)

  if (tiersWithData.length < 2) return null

  let violations = 0
  const totalPairs = tiersWithData.length - 1

  for (let i = 0; i < tiersWithData.length - 1; i++) {
    // Lower tier should have lower avg |delta| than higher tier
    if (tiersWithData[i].delta > tiersWithData[i + 1].delta) violations += 1
  }

  return round4(1 - violations / totalPairs)
}

// ── Implied vs actual divergence ──────────────────────────────────────────────

/**
 * Measures whether implied probability and model probability were well-calibrated
 * against actual outcomes.
 *
 * Positive implied_vs_actual = market overpriced these events (bets had positive CLV tendency)
 * Positive model_vs_actual   = model was overconfident (predicted too high)
 */
function computeImpliedVsActual(bets) {
  const settled = bets.filter((b) => isHit(b) !== null)
  if (!settled.length) return null

  let impliedSum = 0
  let modelSum = 0
  let actualSum = 0
  let impliedN = 0
  let modelN = 0

  for (const b of settled) {
    const hit = isHit(b) ? 1 : 0
    actualSum += hit

    const implied = num(b.impliedProb ?? b.implied_prob)
    if (implied != null) {
      impliedSum += implied
      impliedN += 1
    }

    const model = num(b.modelProb ?? b.model_prob)
    if (model != null) {
      modelSum += model
      modelN += 1
    }
  }

  const avgActual = round4(actualSum / settled.length)
  const avgImplied = impliedN > 0 ? round4(impliedSum / impliedN) : null
  const avgModel = modelN > 0 ? round4(modelSum / modelN) : null

  return {
    sampleCount: settled.length,
    avgActualRate: avgActual,
    avgImpliedProb: avgImplied,
    avgModelProb: avgModel,
    impliedVsActual: avgImplied != null ? round4(avgImplied - avgActual) : null,
    modelVsActual: avgModel != null ? round4(avgModel - avgActual) : null,
    interpretation: {
      marketOverpriced: avgImplied != null ? avgImplied > avgActual : null,
      modelOverconfident: avgModel != null ? avgModel > avgActual : null,
    },
  }
}

// ── Grading ───────────────────────────────────────────────────────────────────

function gradeVolatility(tierStats, vrs, impliedVsActual) {
  let score = 50

  // VRS: did volatility tier labels predict variance correctly?
  if (vrs != null) {
    if (vrs >= 0.75) score += 20
    else if (vrs >= 0.5) score += 10
    else if (vrs < 0.25) score -= 15
  }

  // Safe tier: should be our most reliable
  const safeHr = tierStats.safe?.hitRate
  if (safeHr != null) {
    if (safeHr >= 0.62) score += 15
    else if (safeHr >= 0.52) score += 8
    else if (safeHr < 0.42) score -= 10
  }

  // Model overconfidence penalty
  if (impliedVsActual) {
    const mva = Math.abs(impliedVsActual.modelVsActual || 0)
    if (mva > 0.15) score -= 15
    else if (mva > 0.10) score -= 7
    else score += 5
  }

  score = Math.max(0, Math.min(100, score))
  const grade = score >= 78 ? "A" : score >= 62 ? "B" : score >= 46 ? "C" : score >= 30 ? "D" : "F"

  const parts = [
    `VRS=${vrs != null ? vrs.toFixed(3) : "N/A"}`,
    `safe_hr=${safeHr != null ? safeHr.toFixed(3) : "N/A"}`,
    `model_bias=${impliedVsActual?.modelVsActual != null ? impliedVsActual.modelVsActual.toFixed(3) : "N/A"}`,
  ]

  return {
    grade,
    score,
    rationale: parts.join(" "),
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Review volatility assumptions for one (sport, date).
 *
 * @param {object} opts
 * @param {Array}  opts.bets — all tracked bets with volatility field
 * @returns {object}
 */
function reviewVolatility({ bets = [] } = {}) {
  const tierStats = {}
  for (const tier of VOL_TIER_ORDER) {
    const tierBets = bets.filter(
      (b) => String(b.volatility || b.volatilityTier || "").toLowerCase() === tier
    )
    tierStats[tier] = analyzeTier(tierBets)
  }

  const vrs = computeVRS(tierStats)
  const impliedVsActual = computeImpliedVsActual(bets)
  const gradeResult = gradeVolatility(tierStats, vrs, impliedVsActual)

  return {
    tierStats,
    volatilityRealizationScore: vrs,
    impliedVsActual,
    grade: gradeResult,
  }
}

module.exports = {
  reviewVolatility,
  analyzeTier,
  computeVRS,
  computeImpliedVsActual,
  gradeVolatility,
}
