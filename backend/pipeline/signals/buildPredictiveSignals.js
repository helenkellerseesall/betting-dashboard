/**
 * Predictive Signal Builders
 * 
 * Centralized generation of context-aware signal scores for rows:
 * - ceilingScore: ceiling potential based on form, efficiency, and context
 * - roleSpikeScore: likelihood of role uptick based on minutes and pricing
 * - lineupContextScore: role + lineup context quality from current row data
 * - opportunitySpikeScore: near-term opportunity spike from minutes/form context
 * - marketLagScore: market movement lag and inefficiency detection
 * - bookDisagreementScore: combined book opinion mismatch signal
 */

const { buildLineupRoleContextSignals } = require("./buildLineupRoleContextSignals")

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function impliedProbabilityFromAmerican(americanOdds) {
  const odds = Number(americanOdds)
  if (!Number.isFinite(odds)) return null
  if (odds > 0) return 100 / (odds + 100)
  return Math.abs(odds) / (Math.abs(odds) + 100)
}

function parseHitRateValue(hitRate) {
  if (hitRate == null) return 0
  if (typeof hitRate === "string" && hitRate.includes("/")) {
    const parts = hitRate.split("/").map(Number)
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] > 0) {
      return parts[0] / parts[1]
    }
    return 0
  }
  const numeric = Number(hitRate)
  return Number.isFinite(numeric) ? numeric : 0
}

/**
 * Build ceiling and role-spike signals based on form, efficiency, and role factors
 * @param {Object} row - row with core metrics and contextual scores
 * @returns {{ceilingScore: number, roleSpikeScore: number}}
 */
function buildCeilingRoleSpikeSignals(row) {
  const hitRate = parseHitRateValue(row?.hitRate)
  const score = Number(row?.score || 0)
  const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
  const line = Number(row?.line)
  const recent3Avg = Number(row?.recent3Avg)
  const l10Avg = Number(row?.l10Avg)
  const avgMin = Number(row?.avgMin)
  const recent3MinAvg = Number(row?.recent3MinAvg)
  const minCeiling = Number(row?.minCeiling)
  const side = String(row?.side || "").toLowerCase()
  const minutesRisk = String(row?.minutesRisk || "").toLowerCase()
  const injuryRisk = String(row?.injuryRisk || "").toLowerCase()
  const trendRisk = String(row?.trendRisk || "").toLowerCase()
  const gamePriorityScore = Number(row?.gamePriorityScore || 0)
  const roleSignalScore = Number(row?.roleSignalScore || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
  const bookValueScore = Number(row?.bookValueScore || 0)
  
  const recentFormDelta = Number.isFinite(recent3Avg) && Number.isFinite(l10Avg) ? (recent3Avg - l10Avg) : 0
  const minutesTrendDelta = Number.isFinite(recent3MinAvg) && Number.isFinite(avgMin) ? (recent3MinAvg - avgMin) : 0
  const lineLeverage = Number.isFinite(line) && Number.isFinite(recent3Avg)
    ? (side === "under" ? (line - recent3Avg) : (recent3Avg - line))
    : 0
  const ceilingOverLine = Number.isFinite(minCeiling) && Number.isFinite(line) ? (minCeiling - line) : 0
  
  const scoreSignal = clamp((score - 64) / 34, 0, 1)
  const edgeSignal = clamp((edge + 0.15) / 2.35, 0, 1)
  const hitSignal = clamp((hitRate - 0.5) / 0.3, 0, 1)
  const formSignal = clamp((recentFormDelta + 1.5) / 5, 0, 1)
  const lineSignal = clamp((lineLeverage + 0.4) / 3.2, 0, 1)
  const ceilingRangeSignal = clamp((ceilingOverLine + 1) / 9, 0, 1)
  const contextSignal = clamp((gamePriorityScore * 0.55) + (matchupEdgeScore * 0.45), 0, 1)
  
  const roleSignal = clamp(roleSignalScore, 0, 1)
  const minutesTrendSignal = clamp((minutesTrendDelta + 1.2) / 4.2, 0, 1)
  const minutesBaseSignal = clamp((avgMin - 23) / 12, 0, 1)
  const pricingSignal = clamp(bookValueScore, 0, 1)
  
  const riskPenalty =
    (minutesRisk === "high" ? 0.08 : minutesRisk === "medium" ? 0.03 : 0) +
    (injuryRisk === "high" ? 0.08 : injuryRisk === "medium" ? 0.03 : 0) +
    (trendRisk === "high" ? 0.06 : trendRisk === "medium" ? 0.02 : 0)
  
  const ceilingRaw =
    (scoreSignal * 0.2) +
    (edgeSignal * 0.17) +
    (hitSignal * 0.12) +
    (formSignal * 0.16) +
    (lineSignal * 0.15) +
    (ceilingRangeSignal * 0.1) +
    (contextSignal * 0.1)
  
  const roleSpikeRaw =
    (roleSignal * 0.3) +
    (minutesTrendSignal * 0.24) +
    (formSignal * 0.2) +
    (minutesBaseSignal * 0.16) +
    (pricingSignal * 0.1)
  
  return {
    ceilingScore: Number(clamp(ceilingRaw - riskPenalty, 0, 1).toFixed(3)),
    roleSpikeScore: Number(clamp(roleSpikeRaw - (riskPenalty * 0.85), 0, 1).toFixed(3))
  }
}

/**
 * Build market context signals: market movement lag and book disagreement
 * @param {Object} row - row with odds, line, and market metadata
 * @returns {{marketLagScore: number, bookDisagreementScore: number}}
 */
function buildMarketContextSignals(row) {
  const side = String(row?.side || "").toLowerCase()
  const hitRate = parseHitRateValue(row?.hitRate)
  const odds = Number(row?.odds)
  const openingOdds = Number(row?.openingOdds)
  const line = Number(row?.line)
  const openingLine = Number(row?.openingLine)
  const oddsMove = Number.isFinite(Number(row?.oddsMove))
    ? Number(row.oddsMove)
    : (Number.isFinite(odds) && Number.isFinite(openingOdds) ? (odds - openingOdds) : 0)
  const lineMove = Number.isFinite(Number(row?.lineMove))
    ? Number(row.lineMove)
    : (Number.isFinite(line) && Number.isFinite(openingLine) ? (line - openingLine) : 0)
  const bookValueScore = clamp(Number(row?.bookValueScore || 0), 0, 1)
  const marketMovementTag = String(row?.marketMovementTag || "").toLowerCase()

  const impliedNow = impliedProbabilityFromAmerican(odds)
  const impliedOpen = impliedProbabilityFromAmerican(openingOdds)
  const impliedLag =
    impliedNow != null && impliedOpen != null
      ? clamp((impliedOpen - impliedNow) / 0.12, -1, 1)
      : 0
  const valueGap = impliedNow != null ? clamp((hitRate - impliedNow) / 0.2, -1, 1) : 0

  const directionalLine = Number.isFinite(lineMove)
    ? (side === "under"
      ? clamp(lineMove / 1.75, -1, 1)
      : clamp((-lineMove) / 1.75, -1, 1))
    : 0
  const directionalOdds = Number.isFinite(oddsMove) ? clamp(oddsMove / 60, -1, 1) : 0

  let tagAdj = 0
  if (marketMovementTag.includes("odds better")) tagAdj += 0.25
  if (marketMovementTag.includes("odds worse")) tagAdj -= 0.2
  if (side === "under") {
    if (marketMovementTag.includes("line up")) tagAdj += 0.2
    if (marketMovementTag.includes("line down")) tagAdj -= 0.2
  } else {
    if (marketMovementTag.includes("line down")) tagAdj += 0.2
    if (marketMovementTag.includes("line up")) tagAdj -= 0.2
  }

  const hasMovementEvidence =
    Math.abs(lineMove) >= 0.1 ||
    Math.abs(oddsMove) >= 3 ||
    Math.abs(impliedLag) >= 0.03 ||
    marketMovementTag.includes("line") ||
    marketMovementTag.includes("odds")

  const marketLagRaw = hasMovementEvidence
    ? (
      (directionalLine * 0.32) +
      (directionalOdds * 0.24) +
      (impliedLag * 0.24) +
      (tagAdj * 0.12) +
      (valueGap * 0.08)
    )
    : (
      (valueGap * 0.72) +
      (((bookValueScore * 2) - 1) * 0.28)
    )

  const marketLagScore = clamp((marketLagRaw + 1) / 2, 0, 1)
  const bookDisagreementScore = clamp((bookValueScore * 0.7) + (marketLagScore * 0.3), 0, 1)

  return {
    marketLagScore: Number(marketLagScore.toFixed(3)),
    bookDisagreementScore: Number(bookDisagreementScore.toFixed(3))
  }
}

/**
 * Build all predictive signals for a row in one call
 * @param {Object} row - enriched row with edge profile and metrics
 * @returns {{ceilingScore, roleSpikeScore, lineupContextScore, opportunitySpikeScore, marketLagScore, bookDisagreementScore}}
 */
function buildAllPredictiveSignals(row) {
  const ceilingRoleSignals = buildCeilingRoleSpikeSignals(row)
  const lineupRoleSignals = buildLineupRoleContextSignals(row)
  const marketContextSignals = buildMarketContextSignals(row)
  return {
    ...ceilingRoleSignals,
    ...lineupRoleSignals,
    ...marketContextSignals
  }
}

module.exports = {
  buildCeilingRoleSpikeSignals,
  buildLineupRoleContextSignals,
  buildMarketContextSignals,
  buildAllPredictiveSignals
}
