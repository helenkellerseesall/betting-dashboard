"use strict"

/**
 * Phase 3 MLB prop scoring (row-level, no side effects on snapshot).
 * @param {object} row
 * @returns {{ score: number, confidence: "HIGH"|"MEDIUM"|"LOW", category: string|null }}
 */
function scoreMlbProp(row) {
  const predictedProbability = Number(row?.predictedProbability || 0)
  const edgeProbability = Number(row?.edgeProbability || 0)
  const decisionScore = Number(row?.decisionScore || 0)

  const score = predictedProbability * 2 + edgeProbability + decisionScore

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
