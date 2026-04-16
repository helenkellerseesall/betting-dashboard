"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function buildMlbBetSelector(rows) {
  const safeRows = Array.isArray(rows) ? rows : []

  const filtered = safeRows.filter((r) => {
    const edge = toNum(r?.edgeProbability)
    const decision = toNum(r?.decisionScore)
    const odds = r?.odds
    if (!Number.isFinite(edge) || edge <= 0.05) return false
    if (!Number.isFinite(decision) || decision <= 0.6) return false
    if (odds == null) return false
    return true
  })

  const groups = {
    safe: [],
    value: [],
    boom: []
  }

  for (const r of filtered) {
    const pt = String(r?.playType || "").trim().toLowerCase()
    if (pt === "safe") groups.safe.push(r)
    else if (pt === "value") groups.value.push(r)
    else if (pt === "boom") groups.boom.push(r)
  }

  const byDecisionDesc = (a, b) => {
    const dA = toNum(a?.decisionScore) ?? -999
    const dB = toNum(b?.decisionScore) ?? -999
    return dB - dA
  }

  groups.safe.sort(byDecisionDesc)
  groups.value.sort(byDecisionDesc)
  groups.boom.sort(byDecisionDesc)

  return {
    safeCore: groups.safe.slice(0, 2),
    valueCore: groups.value.slice(0, 2),
    powerCore: groups.boom.slice(0, 2)
  }
}

module.exports = { buildMlbBetSelector }

