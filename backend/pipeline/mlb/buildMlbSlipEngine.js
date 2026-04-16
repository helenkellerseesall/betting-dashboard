"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function americanToDecimal(odds) {
  const o = toNum(odds)
  if (!Number.isFinite(o) || o === 0) return null
  if (o > 0) return 1 + o / 100
  return 1 + 100 / Math.abs(o)
}

function decimalToAmerican(decimalOdds) {
  const d = toNum(decimalOdds)
  if (!Number.isFinite(d) || d <= 1) return null
  // If d >= 2 => positive odds
  if (d >= 2) return Math.round((d - 1) * 100)
  // Otherwise negative odds
  return -Math.round(100 / (d - 1))
}

function combineAmericanOdds(legs) {
  const safeLegs = Array.isArray(legs) ? legs : []
  let dec = 1
  for (const leg of safeLegs) {
    const d = americanToDecimal(leg?.odds)
    if (!Number.isFinite(d)) return null
    dec *= d
  }
  const amer = decimalToAmerican(dec)
  return Number.isFinite(amer) ? amer : null
}

function normalizeLeg(row) {
  if (!row || typeof row !== "object") return null
  const player = String(row?.player || "").trim()
  const team = String(row?.team || "").trim()
  const propType = String(row?.propType || "").trim()
  const playType = String(row?.playType || "").trim()
  const odds = row?.odds ?? null
  if (!player || !team || !propType || odds == null || !playType) return null
  return { player, team, propType, odds, playType }
}

function dedupePlayers(legs) {
  const out = []
  const seen = new Set()
  for (const leg of Array.isArray(legs) ? legs : []) {
    const k = String(leg?.player || "").toLowerCase().trim()
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(leg)
  }
  return out
}

function buildMlbSlipEngine(picks) {
  const safeCore = Array.isArray(picks?.safeCore) ? picks.safeCore : []
  const valueCore = Array.isArray(picks?.valueCore) ? picks.valueCore : []
  const powerCore = Array.isArray(picks?.powerCore) ? picks.powerCore : []

  const safeLegs = dedupePlayers(safeCore.map(normalizeLeg).filter(Boolean)).slice(0, 2)

  const balancedLegs = dedupePlayers(
    [safeCore[0], valueCore[0], powerCore[0]].map(normalizeLeg).filter(Boolean)
  ).slice(0, 3)

  const upsideLegs = dedupePlayers(
    [
      safeCore[0],
      valueCore[0],
      valueCore[1],
      powerCore[0],
      powerCore[1]
    ].map(normalizeLeg).filter(Boolean)
  ).slice(0, 5)

  const slips = [
    {
      type: "safe",
      legs: safeLegs,
      combinedOdds: safeLegs.length >= 2 ? combineAmericanOdds(safeLegs) : null
    },
    {
      type: "balanced",
      legs: balancedLegs,
      combinedOdds: balancedLegs.length >= 2 ? combineAmericanOdds(balancedLegs) : null
    },
    {
      type: "upside",
      legs: upsideLegs,
      combinedOdds: upsideLegs.length >= 2 ? combineAmericanOdds(upsideLegs) : null
    }
  ]

  return slips
}

module.exports = { buildMlbSlipEngine }

