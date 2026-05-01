"use strict"

/**
 * Lightweight game-context nudges for finalWeight: pace + blowout / competitiveness.
 * Does not replace matchup or model signals.
 */

const { impliedProbability } = require("../utils/edge")
const { readPaceTotal } = require("./nbaMatchupIntelligence")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

function readSpreadAbs(row) {
  if (!row || typeof row !== "object") return null
  const s = toNum(row.spread ?? row.gameSpread ?? row.lineSpread ?? row.pointSpread)
  if (!Number.isFinite(s)) return null
  return Math.abs(s)
}

function inferSpreadProxyFromMoneylines(row) {
  const h = toNum(row?.moneylineHomeOdds)
  const a = toNum(row?.moneylineAwayOdds)
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null
  const ph = impliedProbability(h)
  const pa = impliedProbability(a)
  if (!Number.isFinite(ph) || !Number.isFinite(pa)) return null
  const diff = Math.abs(ph - pa)
  return clamp(0, 14, diff * 38)
}

function resolveEffectiveSpread(row) {
  const direct = readSpreadAbs(row)
  if (Number.isFinite(direct)) return { spread: direct, label: direct.toFixed(1) }
  const px = inferSpreadProxyFromMoneylines(row)
  if (Number.isFinite(px)) return { spread: px, label: `ml~${px.toFixed(1)}` }
  return { spread: null, label: "n/a" }
}

function propFamilyForGameContext(propType) {
  const pt = String(propType || "").toLowerCase()
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(pt)) return "pra"
  if (/point/.test(pt) && !/rebound|assist|three|pra|pts.*reb|pts.*ast|points\s*\+/.test(pt)) return "points"
  if (/assist/.test(pt) && !/pra/.test(pt)) return "assists"
  if (/rebound/.test(pt) && !/pra/.test(pt)) return "rebounds"
  if (/three|threes|3pt/.test(pt)) return "threes"
  return "other"
}

function paceFamilyMultiplier(family) {
  if (family === "points") return 1.0
  if (family === "pra") return 0.68
  if (family === "assists" || family === "rebounds") return 0.84
  if (family === "threes") return 0.58
  return 0.38
}

function blowoutFamilyMultiplier(family) {
  if (family === "points") return 1.0
  if (family === "pra") return 0.82
  if (family === "assists") return 0.62
  if (family === "rebounds") return 0.55
  if (family === "threes") return 0.48
  return 0.32
}

/**
 * @returns {{ adj: number, pace: number|null }}
 */
function computePaceContextAdj(matchupRow, propType) {
  if (!matchupRow || typeof matchupRow !== "object") return { adj: 0, pace: null }
  let { pace } = readPaceTotal(matchupRow)
  if (!Number.isFinite(pace)) pace = 100
  const paceSignal = clamp(-1, 1, (pace - 100) / 4)
  const fam = propFamilyForGameContext(propType)
  const mult = paceFamilyMultiplier(fam)
  let adj = paceSignal * 0.04 * mult
  adj = clamp(-0.04, 0.04, adj)
  return { adj, pace }
}

function starMinutesRiskScore(usageRate, minutes) {
  const u = Number.isFinite(Number(usageRate)) ? Number(usageRate) : 21
  const m = Number.isFinite(Number(minutes)) ? Number(minutes) : 27
  return clamp(0, 1, ((m - 25) / 14) * 0.52 + ((u - 19) / 14) * 0.48)
}

/**
 * @returns {{ adj: number, spread: number|null, spreadLabel: string }}
 */
function computeBlowoutContextAdj(matchupRow, propType, usageRate, minutes) {
  if (!matchupRow || typeof matchupRow !== "object") return { adj: 0, spread: null, spreadLabel: "n/a" }
  const { spread, label } = resolveEffectiveSpread(matchupRow)
  const fam = propFamilyForGameContext(propType)
  const bMult = blowoutFamilyMultiplier(fam)
  const star = starMinutesRiskScore(usageRate, minutes)
  const sideStr = String(matchupRow.side || "").toLowerCase()
  const isUnder = sideStr.includes("under")

  if (!Number.isFinite(spread)) return { adj: 0, spread: null, spreadLabel: label }

  let adj = 0
  if (spread < 5) {
    adj = 0.014 * bMult * clamp(0.45, 1, 1.1 - star * 0.28)
  } else if (spread <= 10) {
    if (!isUnder) adj = -0.007 * bMult * clamp(0.25, 1, star)
  } else {
    if (!isUnder) adj = -0.028 * bMult * clamp(0.28, 1, star)
    else adj = 0.006 * bMult
  }

  adj = clamp(-0.035, 0.02, adj)
  return { adj, spread, spreadLabel: label }
}

module.exports = {
  computePaceContextAdj,
  computeBlowoutContextAdj,
  readSpreadAbs,
  resolveEffectiveSpread,
  propFamilyForGameContext,
}
