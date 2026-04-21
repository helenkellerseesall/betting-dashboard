"use strict"

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function safeNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function tanh(x) {
  // Avoid depending on modern Math.tanh availability differences.
  const v = Number(x)
  if (!Number.isFinite(v)) return 0
  const e2x = Math.exp(2 * v)
  return (e2x - 1) / (e2x + 1)
}

function mean(values) {
  const v = (Array.isArray(values) ? values : []).filter((n) => Number.isFinite(n))
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

function std(values, m) {
  const v = (Array.isArray(values) ? values : []).filter((n) => Number.isFinite(n))
  if (v.length < 2) return null
  const mu = Number.isFinite(m) ? m : mean(v)
  if (!Number.isFinite(mu)) return null
  const varSum = v.reduce((acc, x) => acc + Math.pow(x - mu, 2), 0)
  return Math.sqrt(varSum / (v.length - 1))
}

function zScore(value, mu, sigma) {
  const x = safeNumber(value)
  if (!Number.isFinite(x) || !Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) return null
  return (x - mu) / sigma
}

function pickFirstNumeric(row, keys) {
  for (const k of Array.isArray(keys) ? keys : []) {
    const n = safeNumber(row?.[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Build per-slate normalization stats from current MLB rows.
 * We intentionally keep this tiny and robust: only stats we might actually use.
 */
function buildMlbPlayerModelContext(rows) {
  const safe = Array.isArray(rows) ? rows : []

  const perfKeyCandidates = ["l10Avg", "recent10Avg", "recent5Avg", "recent3Avg", "last10Avg", "last5Avg"]
  const teamTotalKeyCandidates = ["teamImpliedTotal", "impliedTeamTotal", "teamTotal", "impliedRuns", "teamImpliedRuns"]
  const lineupKeyCandidates = ["battingOrderIndex", "lineupSpot", "lineupPosition"]

  const perfVals = []
  const teamTotalVals = []
  const lineupVals = []

  for (const r of safe) {
    const perf = pickFirstNumeric(r, perfKeyCandidates)
    if (Number.isFinite(perf)) perfVals.push(perf)

    const teamTotal = pickFirstNumeric(r, teamTotalKeyCandidates)
    if (Number.isFinite(teamTotal)) teamTotalVals.push(teamTotal)

    const lineup = pickFirstNumeric(r, lineupKeyCandidates)
    if (Number.isFinite(lineup)) lineupVals.push(lineup)
  }

  const perfMean = mean(perfVals)
  const perfStd = std(perfVals, perfMean)
  const teamTotalMean = mean(teamTotalVals)
  const teamTotalStd = std(teamTotalVals, teamTotalMean)
  const lineupMean = mean(lineupVals)
  const lineupStd = std(lineupVals, lineupMean)

  return {
    perfKeyCandidates,
    teamTotalKeyCandidates,
    lineupKeyCandidates,
    perf: { mean: perfMean, std: perfStd },
    teamTotal: { mean: teamTotalMean, std: teamTotalStd },
    lineup: { mean: lineupMean, std: lineupStd }
  }
}

/**
 * Produce a refined predictedProbability using player + context proxies.
 *
 * This is intentionally conservative:
 * - starts from the existing predictedProbability (odds+signals)
 * - applies small bounded adjustments using whatever context exists
 * - blends back toward impliedProbability to avoid extremes
 *
 * @param {object} row
 * @param {{
 *   impliedProbability: number|null,
 *   basePredictedProbability: number|null,
 *   signalScore?: number|null,
 *   tuneLog?: boolean,
 *   ctx: ReturnType<typeof buildMlbPlayerModelContext>
 * }} input
 */
function modelMlbPredictedProbability(row, input) {
  const implied = safeNumber(input?.impliedProbability)
  const base = safeNumber(input?.basePredictedProbability)
  const signalScore = safeNumber(input?.signalScore)
  const tuneLog = Boolean(input?.tuneLog)
  const ctx = input?.ctx || {}

  const baseProb =
    Number.isFinite(base) ? base :
      Number.isFinite(implied) ? implied :
        null
  if (baseProb == null) return null

  // Extract available proxies.
  const perf = pickFirstNumeric(row, ctx.perfKeyCandidates)
  const teamTotal = pickFirstNumeric(row, ctx.teamTotalKeyCandidates)
  const lineup = pickFirstNumeric(row, ctx.lineupKeyCandidates)

  const zPerf = zScore(perf, ctx?.perf?.mean, ctx?.perf?.std)
  const zTeam = zScore(teamTotal, ctx?.teamTotal?.mean, ctx?.teamTotal?.std)
  // For lineup, smaller index is better, so invert sign (lower lineup -> positive).
  const zLineupRaw = zScore(lineup, ctx?.lineup?.mean, ctx?.lineup?.std)
  const zLineup = Number.isFinite(zLineupRaw) ? -zLineupRaw : null

  const zSignals = [zPerf, zTeam, zLineup].filter((z) => Number.isFinite(z))
  const dataConfidence =
    zSignals.length >= 3 ? 1 : zSignals.length === 2 ? 2 / 3 : zSignals.length === 1 ? 1 / 3 : 0

  // Softer coefficients + global scale (reduces multiplier / tail spikes).
  let delta = 0
  if (Number.isFinite(zPerf)) delta += 0.04 * tanh(zPerf / 2)
  if (Number.isFinite(zTeam)) delta += 0.025 * tanh(zTeam / 2)
  if (Number.isFinite(zLineup)) delta += 0.018 * tanh(zLineup / 2)
  delta *= 0.6
  delta *= 0.4 + 0.6 * dataConfidence

  const hasImplied = Number.isFinite(implied)

  // If nothing is available, keep base stable (still respect implied band when logging).
  if (delta === 0) {
    const flat = clamp(baseProb, 0.01, 0.85)
    const maxDeltaDown = 0.18
    const maxDeltaUpStrong = 0.18
    const maxDeltaUpWeak = 0.09
    const maxDeltaUp =
      Number.isFinite(signalScore) && signalScore >= 0.7 ? maxDeltaUpStrong : maxDeltaUpWeak
    let out = flat
    if (hasImplied) {
      const lo = implied - maxDeltaDown
      const hi = implied + maxDeltaUp
      out = clamp(flat, lo, hi)
    }
    out = clamp(Number(out.toFixed(6)), 0.01, 0.85)
    if (tuneLog) {
      const dBefore = hasImplied ? Number((flat - implied).toFixed(6)) : null
      const dAfter = hasImplied ? Number((out - implied).toFixed(6)) : null
      console.log("[MLB MODEL TUNE]", {
        implied: hasImplied ? Number(implied.toFixed(6)) : null,
        predictedBeforeClamp: flat,
        predictedAfterClamp: out,
        deltaBeforeClamp: dBefore,
        deltaAfterClamp: dAfter,
        signalScore: Number.isFinite(signalScore) ? Number(signalScore.toFixed(4)) : null,
        dataConfidence: Number(dataConfidence.toFixed(3))
      })
    }
    return out
  }

  const raw = clamp(baseProb + delta, 0.01, 0.85)

  // Blend back toward implied to avoid extreme deviations without strong evidence.
  const blended = hasImplied ? (raw * 0.55 + implied * 0.45) : raw
  const predictedBeforeImpliedClamp = clamp(Number(blended.toFixed(6)), 0.01, 0.85)

  // Hard cap vs implied: asymmetric positive cap unless signal confirms a large boost.
  const maxDeltaDown = 0.18
  const maxDeltaUpStrong = 0.18
  const maxDeltaUpWeak = 0.09
  const maxDeltaUp =
    Number.isFinite(signalScore) && signalScore >= 0.7 ? maxDeltaUpStrong : maxDeltaUpWeak

  let predictedAfterImpliedClamp = predictedBeforeImpliedClamp
  if (hasImplied) {
    const lo = implied - maxDeltaDown
    const hi = implied + maxDeltaUp
    predictedAfterImpliedClamp = clamp(predictedBeforeImpliedClamp, lo, hi)
  }

  const out = clamp(Number(predictedAfterImpliedClamp.toFixed(6)), 0.01, 0.85)

  if (tuneLog) {
    const deltaBeforeClamp = hasImplied
      ? Number((predictedBeforeImpliedClamp - implied).toFixed(6))
      : null
    const deltaAfterClamp = hasImplied ? Number((out - implied).toFixed(6)) : null
    console.log("[MLB MODEL TUNE]", {
      implied: hasImplied ? Number(implied.toFixed(6)) : null,
      predictedBeforeClamp: predictedBeforeImpliedClamp,
      predictedAfterClamp: out,
      deltaBeforeClamp,
      deltaAfterClamp,
      signalScore: Number.isFinite(signalScore) ? Number(signalScore.toFixed(4)) : null,
      dataConfidence: Number(dataConfidence.toFixed(3))
    })
  }

  return out
}

module.exports = {
  buildMlbPlayerModelContext,
  modelMlbPredictedProbability
}

