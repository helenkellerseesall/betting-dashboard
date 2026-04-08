function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Lightweight lineup/role context from existing row fields only.
 *
 * Outputs:
 * - lineupContextScore: stability/quality of role + game context
 * - opportunitySpikeScore: short-term opportunity uptick potential
 */
function buildLineupRoleContextSignals(row) {
  const avgMin = Number(row?.avgMin)
  const recent3MinAvg = Number(row?.recent3MinAvg)
  const line = Number(row?.line)
  const minCeiling = Number(row?.minCeiling)
  const roleSignalScore = Number(row?.roleSignalScore || 0)
  const gamePriorityScore = Number(row?.gamePriorityScore || 0)
  const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
  const recent3Avg = Number(row?.recent3Avg)
  const l10Avg = Number(row?.l10Avg)
  const minutesRisk = String(row?.minutesRisk || "").toLowerCase()
  const injuryRisk = String(row?.injuryRisk || "").toLowerCase()
  const trendRisk = String(row?.trendRisk || "").toLowerCase()

  const minutesDelta = Number.isFinite(recent3MinAvg) && Number.isFinite(avgMin)
    ? (recent3MinAvg - avgMin)
    : 0
  const formDelta = Number.isFinite(recent3Avg) && Number.isFinite(l10Avg)
    ? (recent3Avg - l10Avg)
    : 0
  const ceilingHeadroom = Number.isFinite(minCeiling) && Number.isFinite(line)
    ? (minCeiling - line)
    : 0

  const roleSignal = clamp(roleSignalScore, 0, 1)
  const gameSignal = clamp(gamePriorityScore, 0, 1)
  const matchupSignal = clamp(matchupEdgeScore, 0, 1)
  const minutesBaseSignal = clamp((avgMin - 22) / 14, 0, 1)
  const minutesTrendSignal = clamp((minutesDelta + 1.5) / 6, 0, 1)
  const formSignal = clamp((formDelta + 1.2) / 4.5, 0, 1)
  const ceilingSignal = clamp((ceilingHeadroom + 0.8) / 7, 0, 1)

  const riskPenalty =
    (minutesRisk === "high" ? 0.09 : minutesRisk === "medium" ? 0.04 : 0) +
    (injuryRisk === "high" ? 0.07 : injuryRisk === "medium" ? 0.03 : 0) +
    (trendRisk === "high" ? 0.05 : trendRisk === "medium" ? 0.02 : 0)

  const lineupContextRaw =
    (roleSignal * 0.31) +
    (minutesBaseSignal * 0.22) +
    (gameSignal * 0.19) +
    (matchupSignal * 0.16) +
    (ceilingSignal * 0.12)

  const opportunitySpikeRaw =
    (minutesTrendSignal * 0.36) +
    (roleSignal * 0.24) +
    (formSignal * 0.20) +
    (ceilingSignal * 0.12) +
    (gameSignal * 0.08)

  return {
    lineupContextScore: Number(clamp(lineupContextRaw - riskPenalty, 0, 1).toFixed(3)),
    opportunitySpikeScore: Number(clamp(opportunitySpikeRaw - (riskPenalty * 0.85), 0, 1).toFixed(3))
  }
}

module.exports = {
  buildLineupRoleContextSignals
}
