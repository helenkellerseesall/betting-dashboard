"use strict"

const { computeMlbSafeScore } = require("./laneScoring")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function isSafeFamily(row) {
  return String(row?.__family || "").trim() === "hits"
}

function cmpSafe(a, b) {
  const scA = computeMlbSafeScore(a)
  const scB = computeMlbSafeScore(b)
  if (scB !== scA) return scB - scA
  const eA = toNum(a?.edgeProbability) ?? -999
  const eB = toNum(b?.edgeProbability) ?? -999
  return eB - eA
}

function buildMlbSafeLane(rows, { limit = 20 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  return safeRows
    .filter(isSafeFamily)
    .map((r) => ({ ...r, safeScore: computeMlbSafeScore(r) }))
    .sort(cmpSafe)
    .slice(0, Math.max(0, Number(limit) || 0))
}

module.exports = { buildMlbSafeLane, cmpSafe }

