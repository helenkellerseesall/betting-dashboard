"use strict"

/**
 * Calibration Metrics Engine (Session W)
 *
 * Pure functions. No IO. No side effects.
 *
 * Metrics computed:
 *   Brier Score (BS)      — mean squared error between modelProb and binary outcome
 *                           BS = (1/N) * Σ(modelProb_i - hit_i)²
 *                           Range [0,1]. 0=perfect, 0.25=no-skill baseline for balanced events
 *
 *   Brier Skill Score     — 1 - BS/BS_ref where BS_ref = hit_rate*(1-hit_rate)
 *   (BSS)                   Positive = better than predicting base rate always
 *
 *   Expected Calibration  — Σ (n_bin/N) * |avg_conf_bin - avg_accuracy_bin|
 *   Error (ECE)             Weighted avg calibration error across confidence buckets
 *
 *   Maximum Calibration   — max(|avg_conf_bin - avg_accuracy_bin|) across all bins
 *   Error (MCE)             Worst single bucket's miscalibration
 *
 *   Sharpness             — avg(confidence) - 0.5
 *                           Positive = model is decisively assertive
 *                           Near 0 = model hedges toward 50%
 *
 *   Resolution            — variance of confidence values
 *                           Higher = model uses the full probability range
 *
 *   Reliability diagram   — per-bin {avg_conf, hit_rate, count, error}
 *                           Used to identify systematic over/under-confidence
 */

const N_BINS = 10

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

/**
 * Compute full calibration metrics for an array of prediction samples.
 *
 * @param {Array<{modelProb, hit, statFamily?, tier?}>} samples
 *   hit: 1 = won, 0 = lost, null/undefined = excluded (pending/push/void)
 * @returns {object} calibration metrics
 */
function computeCalibration(samples) {
  if (!Array.isArray(samples) || !samples.length) {
    return { sampleCount: 0, error: "no_samples" }
  }

  // Filter to settled samples only (hit must be 0 or 1)
  const settled = samples.filter((s) => {
    const h = num(s.hit)
    const p = num(s.modelProb)
    return h !== null && (h === 0 || h === 1) && p !== null && p >= 0 && p <= 1
  })

  if (!settled.length) {
    return { sampleCount: 0, error: "no_settled_samples" }
  }

  const N = settled.length

  // ── Brier Score ──────────────────────────────────────────────────────────────
  let brierSum = 0
  let confSum = 0
  let hitSum = 0

  for (const s of settled) {
    const p = num(s.modelProb)
    const h = num(s.hit)
    brierSum += (p - h) ** 2
    confSum += p
    hitSum += h
  }

  const brierScore = brierSum / N
  const avgConf = confSum / N
  const avgHitRate = hitSum / N

  // Brier Skill Score: 1 - BS / BS_reference
  // BS_ref = climatological baseline = predicting base rate every time
  const bsRef = avgHitRate * (1 - avgHitRate)
  const brierSkill = bsRef > 0 ? round4(1 - brierScore / bsRef) : null

  // ── Sharpness & Resolution ────────────────────────────────────────────────────
  // Sharpness: how far from 0.5 are predictions on average?
  const sharpness = avgConf - 0.5

  // Resolution: variance of confidence values (higher = model uses full range)
  let varSum = 0
  for (const s of settled) varSum += (num(s.modelProb) - avgConf) ** 2
  const resolution = N > 1 ? varSum / N : 0

  // ── Reliability Diagram (ECE / MCE) ──────────────────────────────────────────
  // Bin samples into N_BINS equal-width buckets [0, 0.1), [0.1, 0.2), ...
  const bins = Array.from({ length: N_BINS }, (_, i) => ({
    binLow: i / N_BINS,
    binHigh: (i + 1) / N_BINS,
    confSum: 0,
    hitSum: 0,
    count: 0,
  }))

  for (const s of settled) {
    const p = num(s.modelProb)
    const binIdx = Math.min(N_BINS - 1, Math.floor(p * N_BINS))
    bins[binIdx].confSum += p
    bins[binIdx].hitSum += num(s.hit)
    bins[binIdx].count += 1
  }

  const reliability = []
  let eceSum = 0
  let mce = 0

  for (const bin of bins) {
    if (!bin.count) continue
    const avgBinConf = bin.confSum / bin.count
    const binHitRate = bin.hitSum / bin.count
    const error = Math.abs(avgBinConf - binHitRate)

    eceSum += (bin.count / N) * error
    if (error > mce) mce = error

    reliability.push({
      binLow: round4(bin.binLow),
      binHigh: round4(bin.binHigh),
      count: bin.count,
      avgConf: round4(avgBinConf),
      hitRate: round4(binHitRate),
      error: round4(error),
      overconfident: avgBinConf > binHitRate,
    })
  }

  // ── Calibration by Stat Family ────────────────────────────────────────────────
  const statGroups = {}
  for (const s of settled) {
    const fam = String(s.statFamily || s.stat_family || "unknown").toLowerCase()
    if (!statGroups[fam]) statGroups[fam] = { brierSum: 0, hitSum: 0, confSum: 0, count: 0 }
    const p = num(s.modelProb)
    const h = num(s.hit)
    statGroups[fam].brierSum += (p - h) ** 2
    statGroups[fam].hitSum += h
    statGroups[fam].confSum += p
    statGroups[fam].count += 1
  }

  const byStat = {}
  for (const [fam, g] of Object.entries(statGroups)) {
    byStat[fam] = {
      count: g.count,
      brierScore: round4(g.brierSum / g.count),
      hitRate: round4(g.hitSum / g.count),
      avgConf: round4(g.confSum / g.count),
    }
  }

  // ── Calibration by Tier ───────────────────────────────────────────────────────
  const tierGroups = {}
  for (const s of settled) {
    const tier = String(s.tier || "UNKNOWN").toUpperCase()
    if (!tierGroups[tier]) tierGroups[tier] = { brierSum: 0, hitSum: 0, confSum: 0, count: 0 }
    const p = num(s.modelProb)
    const h = num(s.hit)
    tierGroups[tier].brierSum += (p - h) ** 2
    tierGroups[tier].hitSum += h
    tierGroups[tier].confSum += p
    tierGroups[tier].count += 1
  }

  const byTier = {}
  for (const [tier, g] of Object.entries(tierGroups)) {
    byTier[tier] = {
      count: g.count,
      brierScore: round4(g.brierSum / g.count),
      hitRate: round4(g.hitSum / g.count),
      avgConf: round4(g.confSum / g.count),
    }
  }

  return {
    sampleCount: N,
    brierScore: round4(brierScore),
    brierSkill,
    ece: round4(eceSum),
    mce: round4(mce),
    avgConfidence: round4(avgConf),
    avgHitRate: round4(avgHitRate),
    sharpness: round4(sharpness),
    resolution: round4(resolution),
    reliability,
    byStat,
    byTier,
  }
}

/**
 * Grade calibration quality.
 * Reference ranges for a model predicting ~50% binary events:
 *   BS < 0.15 = excellent, < 0.20 = good, < 0.23 = acceptable, >= 0.25 = no skill
 *   ECE < 0.05 = well-calibrated, < 0.10 = acceptable, >= 0.15 = poorly calibrated
 *
 * @param {object} metrics — output of computeCalibration()
 * @returns {{ grade: string, score: number, rationale: string }}
 */
function gradeCalibration(metrics) {
  if (!metrics || metrics.sampleCount < 8) {
    return { grade: "N/A", score: 0, rationale: "insufficient_sample (<8)" }
  }

  const { brierScore, ece, brierSkill } = metrics
  let score = 0

  // Brier Score component (0-40 pts)
  if (brierScore < 0.15) score += 40
  else if (brierScore < 0.18) score += 32
  else if (brierScore < 0.20) score += 24
  else if (brierScore < 0.23) score += 14
  else if (brierScore < 0.25) score += 6

  // ECE component (0-30 pts)
  if (ece < 0.04) score += 30
  else if (ece < 0.07) score += 22
  else if (ece < 0.10) score += 14
  else if (ece < 0.15) score += 6

  // Brier Skill Score component (0-20 pts)
  if (brierSkill != null) {
    if (brierSkill > 0.15) score += 20
    else if (brierSkill > 0.08) score += 12
    else if (brierSkill > 0) score += 6
    else if (brierSkill < -0.05) score -= 8
  }

  // Sharpness bonus (0-10 pts): decisive model is better if calibrated
  const { sharpness, avgHitRate } = metrics
  if (Math.abs(sharpness) > 0.05 && brierScore < 0.22) score += 10

  score = Math.max(0, Math.min(100, score))
  const grade = score >= 78 ? "A" : score >= 62 ? "B" : score >= 46 ? "C" : score >= 30 ? "D" : "F"

  return {
    grade,
    score,
    rationale: [
      `BS=${brierScore?.toFixed(4)}`,
      `ECE=${ece?.toFixed(4)}`,
      `BSS=${brierSkill != null ? brierSkill?.toFixed(4) : "N/A"}`,
      `N=${metrics.sampleCount}`,
    ].join(" "),
  }
}

module.exports = { computeCalibration, gradeCalibration }
