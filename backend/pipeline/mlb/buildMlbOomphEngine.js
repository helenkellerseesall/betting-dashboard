"use strict"

const { buildMlbSpikeEngine } = require("./buildMlbSpikeEngine")

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
  if (d >= 2) return Math.round((d - 1) * 100)
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
  const eventId = String(row?.eventId || "").trim() || null
  const odds = row?.odds ?? null
  const edgeProbability = row?.edgeProbability ?? null
  const decisionScore = row?.decisionScore ?? null
  if (!player || !team || !propType || odds == null || !eventId) return null
  return { player, team, propType, playType, eventId, odds, edgeProbability, decisionScore }
}

function uniqueAdd(legs, leg) {
  if (!leg) return false
  const p = String(leg.player || "").toLowerCase().trim()
  const eid = String(leg.eventId || "").trim()
  if (!p || !eid) return false
  if (legs.some((l) => String(l?.player || "").toLowerCase().trim() === p)) return false
  if (legs.some((l) => String(l?.eventId || "").trim() === eid)) return false
  legs.push(leg)
  return true
}

function buildMlbOomphEngine(board) {
  const rows = Array.isArray(board) ? board : []

  const isBoomOnly = (r) => {
    const playType = String(r?.playType || "").toLowerCase()
    const odds = toNum(r?.odds)
    return playType === "boom" && Number.isFinite(odds) && odds >= 400
  }

  // Use spike engine as the source of truth for oomph candidates (not random boom picks).
  const spikes = buildMlbSpikeEngine(rows, { topN: 10 })
  const spikePlayers = Array.isArray(spikes?.spikePlayers) ? spikes.spikePlayers : []

  // Primary oomph pool: high payout legs (>= +400).
  const pool = spikePlayers
    .filter((r) => toNum(r?.odds) != null && toNum(r.odds) >= 400)
    .map(normalizeLeg)
    .filter(Boolean)

  // Lotto pool can be slightly looser for TB (still high-upside, but sometimes priced 300-399).
  const lottoPool = spikePlayers
    .filter((r) => toNum(r?.odds) != null && toNum(r.odds) >= 300)
    .map(normalizeLeg)
    .filter(Boolean)

  // Extreme odds leg should also come from spike candidates (keep oomph fully spike-driven).
  const extremeOddsPool = spikePlayers
    .map(normalizeLeg)
    .filter(Boolean)
    .sort((a, b) => (toNum(b?.odds) ?? -999) - (toNum(a?.odds) ?? -999))

  const bestRbi = lottoPool.find((l) => String(l?.propType || "").includes("RBIs")) || null

  const bestHrBoost = lottoPool.find((l) => {
    if (String(l?.propType || "") !== "Home Runs") return false
    const e = toNum(l?.edgeProbability)
    return Number.isFinite(e) && e > 0.15
  }) || null

  // A) POWER PARLAY (3-leg): top 3 spike-driven boom plays, different games/players.
  const powerLegs = []
  const spikeBoomFirst = pool.filter((l) => String(l?.playType || "").toLowerCase() === "boom")
  for (const leg of spikeBoomFirst) {
    if (powerLegs.length >= 3) break
    uniqueAdd(powerLegs, leg)
  }

  // B) LOTTO PARLAY (4-leg): 2 boom (TB/HR), 1 value (RBI), 1 extreme odds, all unique players/events.
  const lottoLegs = []

  // HR boost if eligible
  if (bestHrBoost) uniqueAdd(lottoLegs, bestHrBoost)

  const boomTypes = lottoPool.filter((l) => String(l?.propType || "") === "Home Runs" || String(l?.propType || "") === "Total Bases")
  const rbIs = lottoPool.filter((l) => String(l?.propType || "").includes("RBIs"))

  // Ensure at least one TB/HR boom leg (prefer TB if HR already added).
  if (lottoLegs.length < 2) {
    const hasHr = lottoLegs.some((l) => String(l?.propType || "") === "Home Runs")
    const prefer = hasHr
      ? boomTypes.filter((l) => String(l?.propType || "") === "Total Bases")
      : boomTypes
    for (const leg of prefer) {
      if (lottoLegs.length >= 2) break
      uniqueAdd(lottoLegs, leg)
    }
  }

  // Ensure we have 2 boom legs (fill with best remaining boom type).
  if (lottoLegs.length < 2) {
    for (const leg of boomTypes) {
      if (lottoLegs.length >= 2) break
      uniqueAdd(lottoLegs, leg)
    }
  }

  // Add 1 RBI value leg (different event/player).
  if (bestRbi) uniqueAdd(lottoLegs, bestRbi)
  for (const leg of rbIs) {
    if (lottoLegs.some((l) => String(l?.propType || "").includes("RBIs"))) break
    if (uniqueAdd(lottoLegs, leg)) break
  }

  // Add 1 extreme odds leg (highest odds) without conflicts.
  for (const candidate of extremeOddsPool) {
    if (uniqueAdd(lottoLegs, candidate)) break
  }

  // If still short, fill with next best spike legs (any type) while keeping uniqueness.
  if (lottoLegs.length < 4) {
    for (const candidate of lottoPool) {
      if (lottoLegs.length >= 4) break
      uniqueAdd(lottoLegs, candidate)
    }
  }

  // Cap exactly 4 legs if we over-added via HR boost
  const finalLottoLegs = lottoLegs.slice(0, 4)

  const powerParlay = {
    type: "powerParlay",
    legs: powerLegs.map(({ edgeProbability, decisionScore, ...rest }) => rest),
    combinedOdds: powerLegs.length >= 2 ? combineAmericanOdds(powerLegs) : null
  }

  const lottoParlay = {
    type: "lottoParlay",
    legs: finalLottoLegs.map(({ edgeProbability, decisionScore, ...rest }) => rest),
    combinedOdds: finalLottoLegs.length >= 2 ? combineAmericanOdds(finalLottoLegs) : null
  }

  return { powerParlay, lottoParlay }
}

module.exports = { buildMlbOomphEngine }

