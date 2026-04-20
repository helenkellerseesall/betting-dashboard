"use strict"

/**
 * Phase 3 MLB prop scoring (row-level, no side effects on snapshot).
 * @param {object} row
 * @returns {{ score: number, confidence: "HIGH"|"MEDIUM"|"LOW", category: string|null }}
 */
function scoreMlbProp(row) {
  const predictedProbability = Number(row?.predictedProbability || 0)
  const edgeProbability = Number(row?.edgeProbability || 0)
  const signalScoreRaw = row?.signalScore
  const signalScore = Number(signalScoreRaw || 0)
  const odds = Number(row?.odds)

  const impliedProbability = (() => {
    const explicit = Number(row?.impliedProbability)
    if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit
    if (!Number.isFinite(odds) || odds === 0) return 0
    if (odds > 0) return 100 / (odds + 100)
    return Math.abs(odds) / (Math.abs(odds) + 100)
  })()

  // Phase 3 score: prioritize edge + signal + true delta vs market (no raw prob overweight).
  let score =
    (edgeProbability * 3.0) +
    (signalScore * 1.5) +
    ((predictedProbability - impliedProbability) * 2.0)

  // Trash penalties (post-score adjustments).
  if (Number.isFinite(odds) && odds < -200) score -= 0.5
  if (signalScoreRaw == null) score -= 0.5

  let confidence = "LOW"
  if (score > 2) confidence = "HIGH"
  else if (score > 1) confidence = "MEDIUM"

  const pt = String(row?.propType || "").trim()
  let category = null
  if (pt === "Hits") category = "hits"
  else if (pt === "Home Runs") category = "hr"
  else if (pt === "Total Bases") category = "tb"
  else if (pt === "RBIs") category = "rbi"

  return { score, confidence, category }
}

module.exports = { scoreMlbProp }
