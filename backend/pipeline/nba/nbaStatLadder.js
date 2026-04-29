"use strict"

const { isMilestoneLadderRow, isAltLineLadderRow, STANDARD_PROP_TYPES } = require("../markets/boardClassification")

function inferNbaStatPropTypeFromMarket(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  if (mk.includes("points_rebounds_assists") || mk.includes("player_pra")) return "PRA"
  if (mk.includes("player_rebounds")) return "Rebounds"
  if (mk.includes("player_assists")) return "Assists"
  if (mk.includes("player_threes") || mk.includes("player_three")) return "Threes"
  if (mk.includes("player_points")) return "Points"
  return ""
}

function isNbaCoreStatMarketKey(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  return (
    mk.includes("player_points") ||
    mk.includes("player_rebounds") ||
    mk.includes("player_assists") ||
    mk.includes("player_threes") ||
    mk.includes("player_three") ||
    mk.includes("points_rebounds_assists") ||
    mk.includes("player_pra")
  )
}

/**
 * Points / rebounds / assists / threes / PRA ladder-style rows (alt lines, alternates, milestones).
 */
function isNbaStatLadderRow(row) {
  const pt = String(row?.propType || "").trim()
  const isCoreStat = STANDARD_PROP_TYPES.has(pt) || isNbaCoreStatMarketKey(row)
  if (!isCoreStat) return false
  if (isAltLineLadderRow(row)) return true
  if (isMilestoneLadderRow(row)) return true
  const mk = String(row?.marketKey || "").toLowerCase()
  if (mk.includes("alternate") || mk.includes("_alt") || mk.endsWith("_alternate")) return true
  const pv = String(row?.propVariant || "base").toLowerCase()
  if (pv && pv !== "base" && pv !== "default") return true
  return false
}

module.exports = {
  inferNbaStatPropTypeFromMarket,
  isNbaStatLadderRow,
}
