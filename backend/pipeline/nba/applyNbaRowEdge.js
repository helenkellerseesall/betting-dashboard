"use strict"

const { computeEdge } = require("../utils/edge")
const { nbaRowModelProbabilityCore } = require("./nbaModelSignals")

/**
 * Probability used for edge: explicit `row.probability` when finite, else model core (unchanged fields).
 */
function probabilityForNbaEdge(row) {
  if (!row || typeof row !== "object") return null
  const rp = Number(row.probability)
  if (Number.isFinite(rp)) return rp
  return nbaRowModelProbabilityCore(row)
}

/**
 * Mutates each row: `row.edge = computeEdge(probability, row.odds)` (shared util; odds-only implied).
 */
function applyEdgeToNbaRows(rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue
    const p = probabilityForNbaEdge(row)
    if (!Number.isFinite(p)) continue
    row.edge = computeEdge(p, row.odds)
  }
}

module.exports = {
  applyEdgeToNbaRows,
  probabilityForNbaEdge,
}
