"use strict"

const { buildMlbPowerLane } = require("./buildMlbPowerLane")
const { buildMlbSafeLane } = require("./buildMlbSafeLane")
const { buildMlbValueLane } = require("./buildMlbValueLane")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function cmpDecision(a, b) {
  const dA = toNum(a?.decisionScore) ?? -999
  const dB = toNum(b?.decisionScore) ?? -999
  if (dB !== dA) return dB - dA
  const eA = toNum(a?.edgeProbability) ?? -999
  const eB = toNum(b?.edgeProbability) ?? -999
  if (eB !== eA) return eB - eA
  const sA = toNum(a?.signalScore) ?? -999
  const sB = toNum(b?.signalScore) ?? -999
  if (sB !== sA) return sB - sA
  const oA = toNum(a?.odds) ?? -999
  const oB = toNum(b?.odds) ?? -999
  return oB - oA
}

function pushUniquePlayer(out, row, seenPlayers) {
  const playerKey = String(row?.player || "").toLowerCase().trim()
  if (!playerKey) return false
  if (seenPlayers.has(playerKey)) return false
  out.push(row)
  seenPlayers.add(playerKey)
  return true
}

function buildMlbDecisionBoard(rows, opts = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const topN = Number(opts.topN || 10)
  const laneTake = {
    power: Number(opts.power || 3),
    safe: Number(opts.safe || 3),
    value: Number(opts.value || 3)
  }

  const powerLane = buildMlbPowerLane(safeRows, { limit: 50 })
  const safeLane = buildMlbSafeLane(safeRows, { limit: 50 })
  const valueLane = buildMlbValueLane(safeRows, { limit: 50 })

  const out = []
  const seenPlayers = new Set()

  for (const r of powerLane.slice(0, Math.max(0, laneTake.power))) pushUniquePlayer(out, r, seenPlayers)
  for (const r of safeLane.slice(0, Math.max(0, laneTake.safe))) pushUniquePlayer(out, r, seenPlayers)
  for (const r of valueLane.slice(0, Math.max(0, laneTake.value))) pushUniquePlayer(out, r, seenPlayers)

  // Fill remaining slots by best decisionScore overall (still dedup players).
  const rankedAll = [...safeRows].sort(cmpDecision)
  for (const r of rankedAll) {
    if (out.length >= topN) break
    pushUniquePlayer(out, r, seenPlayers)
  }

  // Present final board ordered by decisionScore (not by lane insertion order).
  const top = out.slice(0, topN).sort(cmpDecision)

  const diagnostics = {
    laneTake,
    laneSizes: { power: powerLane.length, safe: safeLane.length, value: valueLane.length },
    topLaneSamples: {
      power: powerLane.slice(0, 3).map((r) => ({ player: r?.player, fam: r?.__family, powerScore: r?.powerScore, odds: r?.odds })),
      safe: safeLane.slice(0, 3).map((r) => ({ player: r?.player, fam: r?.__family, safeScore: r?.safeScore, pred: r?.predictedProbability })),
      value: valueLane.slice(0, 3).map((r) => ({ player: r?.player, fam: r?.__family, valueScore: r?.valueScore, odds: r?.odds }))
    },
    selectedCounts: {
      power: top.filter((r) => ["hr", "first_hr", "tb"].includes(String(r?.__family || ""))).length,
      safe: top.filter((r) => String(r?.__family || "") === "hits").length,
      value: top.filter((r) => ["rbi", "runs"].includes(String(r?.__family || ""))).length
    }
  }

  return { board: top, diagnostics }
}

module.exports = { buildMlbDecisionBoard, cmpDecision }

