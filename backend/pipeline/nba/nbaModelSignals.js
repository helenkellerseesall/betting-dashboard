"use strict"

const { impliedProbability: impliedProbabilityFromOdds, computeEdge } = require("../utils/edge")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

function clamp01(n) {
  return clamp(0.001, 0.999, n)
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x))
}

function hash01(str) {
  const s = String(str || "")
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

function playerPrior(row) {
  const p = hash01(row?.player)
  return (p - 0.5) * 2 // [-1, 1]
}

function eventPrior(row) {
  const e = hash01(row?.eventId || row?.matchup)
  return (e - 0.5) * 2
}

function impliedProbabilityFromAmerican(odds) {
  if (!odds && odds !== 0) return null
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return null
  const imp = impliedProbabilityFromOdds(o)
  if (!Number.isFinite(imp) || imp <= 0 || imp >= 1) return null
  return imp
}

function nbaRowImpliedProbability(row) {
  if (!row || typeof row !== "object") return null
  const explicit = toNum(row.impliedProbability)
  if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit
  const fromOdds = impliedProbabilityFromAmerican(row.odds)
  if (Number.isFinite(fromOdds) && fromOdds > 0 && fromOdds < 1) return fromOdds
  return null
}

function propTypeLower(row) {
  return String(row?.propType || row?.marketKey || "").toLowerCase()
}

function classifyPropFamily(row) {
  const t = propTypeLower(row)
  if (/first\s*basket/.test(t)) return "special"
  if (/double\s*double|triple\s*double/.test(t)) return "special"
  if (/threes|three|3pt/.test(t)) return "threes"
  if (/pra|points.*rebounds.*assists/.test(t)) return "pra"
  if (/point/.test(t)) return "points"
  if (/rebound/.test(t)) return "rebounds"
  if (/assist/.test(t)) return "assists"
  return "other"
}

function isLadderRow(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const pv = String(row?.propVariant || "").toLowerCase()
  return mk.includes("alternate") || mk.includes("_alt") || (pv && pv !== "base" && pv !== "default")
}

function probabilityBandForFamily(family, row) {
  if (isLadderRow(row)) {
    if (family === "threes") return { min: 0.07, max: 0.63 }
    if (family === "pra") return { min: 0.07, max: 0.60 }
    return { min: 0.07, max: 0.61 }
  }
  switch (family) {
    case "points":
    case "rebounds":
    case "assists":
      return { min: 0.34, max: 0.65 }
    case "pra":
      return { min: 0.32, max: 0.67 }
    case "threes":
      return { min: 0.28, max: 0.71 }
    case "special":
      return { min: 0.03, max: 0.42 }
    default:
      return { min: 0.32, max: 0.67 }
  }
}

function lineAnchorByFamily(family) {
  if (family === "threes") return 1.8
  if (family === "assists") return 4.2
  if (family === "rebounds") return 6.0
  if (family === "pra") return 27.5
  if (family === "points") return 18.0
  if (family === "special") return 1.0
  return 10
}

function readSignal(row, keys, fallback = null) {
  for (const k of keys) {
    const n = toNum(row?.[k])
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function roleSignals(row, family, line, anchor) {
  const pp = playerPrior(row)
  const ev = eventPrior(row)

  const usage = readSignal(row, ["usageRate", "playerUsage", "usage", "roleUsagePct"], 22 + pp * 5)
  const shots = readSignal(row, ["shotAttempts", "fga", "fieldGoalAttempts", "shotVolume"], (line || anchor) * (0.55 + pp * 0.08))
  const astRate = readSignal(row, ["assistRate", "astRate", "assistPct"], 0.18 + pp * 0.05)
  const rebRate = readSignal(row, ["reboundRate", "rebRate", "reboundPct"], 0.14 + pp * 0.04)
  const minutes = readSignal(row, ["projectedMinutes", "minutesProjection", "minutes", "expectedMinutes"], 30 + pp * 4 + ev * 1.5)
  const role = readSignal(row, ["rotationRole", "starterFlag", "depthRole"], 1)

  return {
    usage,
    shots,
    astRate,
    rebRate,
    minutes,
    role,
  }
}

function contextSignals(row) {
  const pp = playerPrior(row)
  const pace = readSignal(row, ["pace", "projectedPace", "gamePace", "opponentPace"], 99 + pp * 1.5)
  const total = readSignal(row, ["gameTotal", "total", "projectedTotal"], 224 + pp * 2)
  const spread = Math.abs(readSignal(row, ["spread", "gameSpread", "lineSpread"], 5.5 + pp * 0.8))
  const blowoutRisk = clamp(0, 1, spread / 16)
  const oppDef = readSignal(
    row,
    ["opponentDefenseVsPosition", "oppDefenseVsPosition", "defenseVsPosition", "opponentDvP"],
    eventPrior(row) * 2
  )
  return { pace, total, spread, blowoutRisk, oppDef }
}

function recentFormSignal(row, line, anchor) {
  const pp = playerPrior(row)
  const recent = readSignal(row, ["recentForm", "recentFormScore", "last5Avg", "last10Avg", "rollingAverage"], null)
  if (Number.isFinite(recent)) return recent
  const base = Number.isFinite(line) ? line : anchor
  return base * (0.90 + pp * 0.12)
}

function ladderSeverity(row, family, anchor) {
  const line = toNum(row?.line)
  if (!Number.isFinite(line) || !isLadderRow(row) || family === "special") return 0
  let step = 1
  if (family === "points") step = 5
  else if (family === "pra") step = 5
  else if (family === "threes") step = 1
  else if (family === "rebounds" || family === "assists") step = 2
  return (line - anchor) / step
}

function familyScoreWeights(family) {
  if (family === "points") return { usage: 0.27, shots: 0.25, rate: 0.05, form: 0.25, ctx: 0.18 }
  if (family === "rebounds") return { usage: 0.08, shots: 0.05, rate: 0.28, form: 0.24, ctx: 0.18 }
  if (family === "assists") return { usage: 0.12, shots: 0.04, rate: 0.30, form: 0.24, ctx: 0.18 }
  if (family === "pra") return { usage: 0.20, shots: 0.14, rate: 0.17, form: 0.24, ctx: 0.19 }
  if (family === "threes") return { usage: 0.24, shots: 0.30, rate: 0.04, form: 0.23, ctx: 0.17 }
  return { usage: 0.16, shots: 0.16, rate: 0.16, form: 0.16, ctx: 0.16 }
}

function compressAroundMid(probability, family) {
  const p = clamp01(probability)
  const mid = 0.5
  const d = p - mid
  // points/rebounds/assists most compressed, threes least compressed.
  const factor =
    family === "points" || family === "rebounds" || family === "assists"
      ? 0.82
      : family === "pra"
      ? 0.86
      : family === "threes"
      ? 0.94
      : 0.84
  return clamp01(mid + d * factor)
}

function nbaIndependentBaseModelProbability(row) {
  if (!row || typeof row !== "object") return null

  const family = classifyPropFamily(row)
  const anchor = lineAnchorByFamily(family)
  const line = toNum(row?.line)
  const { usage, shots, astRate, rebRate, minutes, role } = roleSignals(row, family, line, anchor)
  const { pace, total, spread, blowoutRisk, oppDef } = contextSignals(row)
  const recent = recentFormSignal(row, line, anchor)

  const usageZ = (usage - 22) / 9
  const minutesZ = (minutes - 30) / 6
  const shotsZ = (shots - (line || anchor) * 0.5) / Math.max(4, anchor * 0.35)
  const astZ = (astRate - 0.18) / 0.08
  const rebZ = (rebRate - 0.14) / 0.08
  const formBase = Number.isFinite(line) ? line : anchor
  const formZ = (recent - formBase) / Math.max(2.5, anchor * 0.28)
  const paceZ = (pace - 100) / 8
  const totalZ = (total - 224) / 20
  const spreadZ = (5.5 - spread) / 8
  const oppZ = -oppDef / 10
  const roleZ = (role - 1) / 2

  const w = familyScoreWeights(family)
  const rateZ = family === "rebounds" ? rebZ : family === "assists" ? astZ : family === "pra" ? (astZ + rebZ) / 2 : 0
  const ctxZ = paceZ * 0.45 + totalZ * 0.35 + spreadZ * 0.20 + oppZ * 0.35 - blowoutRisk * 0.35 + roleZ * 0.15

  let score =
    usageZ * w.usage +
    shotsZ * w.shots +
    rateZ * w.rate +
    formZ * w.form +
    minutesZ * 0.26 +
    ctxZ * w.ctx +
    playerPrior(row) * 0.22 +
    eventPrior(row) * 0.06

  const ladderZ = ladderSeverity(row, family, anchor)
  if (ladderZ > 0) {
    const ladderPenalty = family === "threes" ? 0.36 : family === "pra" ? 0.44 : 0.48
    score -= ladderZ * ladderPenalty
  }

  if (family === "special") {
    score = score * 0.55 - 0.95
  }

  const side = String(row?.side || "").toLowerCase()
  if (side === "under") score *= -1

  const p = logistic(score)
  const compressed = compressAroundMid(p, family)
  const band = probabilityBandForFamily(family, row)
  return clamp(band.min, band.max, compressed)
}

function nbaRowIndependentModelProbability(row) {
  const modelProb = nbaIndependentBaseModelProbability(row)
  if (!Number.isFinite(modelProb)) return null

  const implied = nbaRowImpliedProbability(row)
  if (!Number.isFinite(implied)) return clamp01(modelProb)

  const family = classifyPropFamily(row)
  // Market-anchored shrink: keep sign/differentiation but compress alpha.
  const alpha =
    family === "threes"
      ? 0.92 // threes keeps comparatively wider variance
      : family === "pra"
      ? 0.88
      : family === "points"
      ? 0.84
      : family === "rebounds" || family === "assists"
      ? 0.82
      : 0.80
  const compressedToMarket = implied + (modelProb - implied) * alpha
  const recentered = compressedToMarket + 0.015
  const band = probabilityBandForFamily(family, row)
  return clamp01(clamp(band.min, band.max, recentered))
}

function nbaRowModelProbabilityCore(row) {
  if (!row || typeof row !== "object") return null

  const independent = nbaRowIndependentModelProbability(row)
  if (Number.isFinite(independent)) return independent

  const candidates = [
    row.modelProbability,
    row.predictedProbability,
    row.predictedProb,
    row.calibratedProbability,
    row.playerConfidenceScore,
    row.adjustedConfidenceScore,
  ]
  for (const c of candidates) {
    const n = toNum(c)
    if (Number.isFinite(n)) return clamp01(n)
  }
  return null
}

function nbaRowModelProbability(row) {
  return nbaRowModelProbabilityCore(row)
}

function nbaRowEdge(row) {
  if (!row || typeof row !== "object") return null
  const prob = Number.isFinite(Number(row.probability)) ? Number(row.probability) : nbaRowModelProbabilityCore(row)
  if (!Number.isFinite(prob)) return null
  const e = computeEdge(prob, row.odds)
  return Number.isFinite(e) ? e : null
}

function nbaRowLadderLabel(row) {
  const pv = String(row?.propVariant || row?.ladderVariant || "").trim()
  const pt = String(row?.propType || "").trim()
  const line = row?.line
  if (pv && pv !== "base" && pv !== "default") return pv
  if (pt && line != null && String(line).trim() !== "") return `${pt} ${line}`
  return pt || "ladder"
}

module.exports = {
  nbaRowImpliedProbability,
  nbaRowIndependentModelProbability,
  nbaRowModelProbabilityCore,
  nbaRowModelProbability,
  nbaRowEdge,
  nbaRowLadderLabel,
}
