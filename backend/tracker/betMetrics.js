"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function computeBetMetrics(bets) {
  const safeBets = Array.isArray(bets) ? bets : []
  const settled = safeBets.filter((b) => b && b.result != null)

  const totalBets = settled.length
  const wins = settled.filter((b) => String(b.result).toLowerCase() === "win").length
  const losses = settled.filter((b) => String(b.result).toLowerCase() === "loss").length

  const totalStaked = settled.reduce((acc, b) => acc + (toNum(b?.stake) || 0), 0)
  const totalPayout = settled.reduce((acc, b) => acc + (toNum(b?.payout) || 0), 0)
  const profit = totalPayout - totalStaked

  const ROI = totalStaked > 0 ? profit / totalStaked : 0
  const hitRate = totalBets > 0 ? wins / totalBets : 0

  return {
    totalBets,
    wins,
    losses,
    profit: Number(profit.toFixed(2)),
    ROI: Number(ROI.toFixed(4)),
    hitRate: Number(hitRate.toFixed(4))
  }
}

module.exports = { computeBetMetrics }

