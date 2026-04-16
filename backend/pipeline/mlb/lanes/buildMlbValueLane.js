"use strict"

const { computeMlbValueScore } = require("./laneScoring")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function isValueFamily(row) {
  const fam = String(row?.__family || "").trim()
  return fam === "rbi" || fam === "runs"
}

function cmpValue(a, b) {
  const vA = computeMlbValueScore(a)
  const vB = computeMlbValueScore(b)
  if (vB !== vA) return vB - vA
  const sA = toNum(a?.signalScore) ?? -999
  const sB = toNum(b?.signalScore) ?? -999
  return sB - sA
}

function buildMlbValueLane(rows, { limit = 20 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  return safeRows
    .filter(isValueFamily)
    .map((r) => ({ ...r, valueScore: computeMlbValueScore(r) }))
    .sort(cmpValue)
    .slice(0, Math.max(0, Number(limit) || 0))
}

module.exports = { buildMlbValueLane, cmpValue }

