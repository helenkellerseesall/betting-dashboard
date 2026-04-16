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
  const eventId = String(row?.eventId || "").trim() || null
  const predictedProbability = row?.predictedProbability ?? null
  if (!player || !team || !propType || odds == null || !playType) return null
  return { player, team, propType, odds, playType, eventId, predictedProbability }
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

function isTrueSafe(row) {
  const pred = toNum(row?.predictedProbability)
  const odds = toNum(row?.odds)
  if (!Number.isFinite(pred) || pred < 0.55) return false
  if (!Number.isFinite(odds) || odds > 300) return false
  return true
}

function canAddLeg(existingLegs, nextLeg) {
  if (!nextLeg) return false
  const playerKey = String(nextLeg.player || "").toLowerCase().trim()
  if (!playerKey) return false
  if (existingLegs.some((l) => String(l?.player || "").toLowerCase().trim() === playerKey)) return false

  const eid = String(nextLeg.eventId || "").trim()
  if (!eid) return true

  const sameEvent = existingLegs.filter((l) => String(l?.eventId || "").trim() === eid)
  if (!sameEvent.length) return true

  // Correlation rule:
  // Allow >1 same-game only when BOTH plays are value AND from same team.
  const nextIsValue = String(nextLeg.playType || "").toLowerCase() === "value"
  const nextTeam = String(nextLeg.team || "").trim().toLowerCase()
  for (const l of sameEvent) {
    const lIsValue = String(l?.playType || "").toLowerCase() === "value"
    const lTeam = String(l?.team || "").trim().toLowerCase()
    const okStack = nextIsValue && lIsValue && nextTeam && lTeam && nextTeam === lTeam
    if (!okStack) return false
  }
  return true
}

function pickFromLane(sourceRows, { max = 1, filterFn = null }, existingLegs) {
  const out = []
  const safeRows = Array.isArray(sourceRows) ? sourceRows : []
  for (const r of safeRows) {
    if (out.length >= max) break
    if (typeof filterFn === "function" && !filterFn(r)) continue
    const leg = normalizeLeg(r)
    if (!leg) continue
    if (!canAddLeg(existingLegs.concat(out), leg)) continue
    out.push(leg)
  }
  return out
}

function buildMlbSlipEngine(picks) {
  const safeCore = Array.isArray(picks?.safeCore) ? picks.safeCore : []
  const valueCore = Array.isArray(picks?.valueCore) ? picks.valueCore : []
  const powerCore = Array.isArray(picks?.powerCore) ? picks.powerCore : []

  // SAFE slip: only include truly safe bets.
  const safeLegs = pickFromLane(safeCore, { max: 2, filterFn: isTrueSafe }, [])

  // BALANCED slip: value → safe → power (value must be first priority).
  const balancedLegs = []
  balancedLegs.push(...pickFromLane(valueCore, { max: 1 }, balancedLegs))
  // Safe here means playType === "safe" (selector lane); true-safe filtering applies only to the SAFE slip.
  balancedLegs.push(...pickFromLane(safeCore, { max: 1 }, balancedLegs))
  balancedLegs.push(...pickFromLane(powerCore, { max: 1 }, balancedLegs))

  // UPSIDE slip: max 4 legs, must include at least 1 safe and 1 value, at most 2 boom.
  const upsideLegs = []
  upsideLegs.push(...pickFromLane(safeCore, { max: 1 }, upsideLegs))
  upsideLegs.push(...pickFromLane(valueCore, { max: 2 }, upsideLegs))
  upsideLegs.push(...pickFromLane(powerCore, { max: 2 }, upsideLegs))
  // Cap to 4 legs.
  let cappedUpside = upsideLegs.slice(0, 4)
  // Ensure at most 2 boom in upside (drop excess boom legs first).
  while (cappedUpside.filter((l) => String(l?.playType || "").toLowerCase() === "boom").length > 2) {
    const idx = cappedUpside.findIndex((l) => String(l?.playType || "").toLowerCase() === "boom")
    if (idx < 0) break
    cappedUpside = cappedUpside.slice(0, idx).concat(cappedUpside.slice(idx + 1))
  }
  // Ensure at least one value in upside if possible.
  if (!cappedUpside.some((l) => String(l?.playType || "").toLowerCase() === "value")) {
    const add = pickFromLane(valueCore, { max: 1 }, cappedUpside)
    if (add.length) cappedUpside = cappedUpside.concat(add).slice(0, 4)
  }
  // Ensure at least one true safe in upside if possible.
  if (!cappedUpside.some((l) => String(l?.playType || "").toLowerCase() === "safe")) {
    const add = pickFromLane(safeCore, { max: 1 }, cappedUpside)
    if (add.length) cappedUpside = cappedUpside.concat(add).slice(0, 4)
  }

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
      legs: cappedUpside,
      combinedOdds: cappedUpside.length >= 2 ? combineAmericanOdds(cappedUpside) : null
    }
  ]

  return slips
}

module.exports = { buildMlbSlipEngine }

