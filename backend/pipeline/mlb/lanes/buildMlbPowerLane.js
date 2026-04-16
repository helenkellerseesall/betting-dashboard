"use strict"

const { computeMlbPowerScore } = require("./laneScoring")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function isPowerFamily(row) {
  const fam = String(row?.__family || "").trim()
  return fam === "hr" || fam === "first_hr" || fam === "tb"
}

function cmpPower(a, b) {
  const pA = computeMlbPowerScore(a)
  const pB = computeMlbPowerScore(b)
  if (pB !== pA) return pB - pA
  const eA = toNum(a?.edgeProbability) ?? -999
  const eB = toNum(b?.edgeProbability) ?? -999
  if (eB !== eA) return eB - eA
  // Prefer higher payout when otherwise equal.
  const oA = toNum(a?.odds) ?? -999
  const oB = toNum(b?.odds) ?? -999
  return oB - oA
}

function buildMlbPowerLane(rows, { limit = 20 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  return safeRows
    .filter(isPowerFamily)
    .map((r) => ({ ...r, powerScore: computeMlbPowerScore(r) }))
    .sort(cmpPower)
    .slice(0, Math.max(0, Number(limit) || 0))
}

module.exports = { buildMlbPowerLane, cmpPower }

