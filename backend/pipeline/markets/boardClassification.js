const STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
const LADDER_PROP_VARIANTS = new Set(["alt-low", "alt-mid", "alt-high", "alt-max"])

const SPECIAL_MARKET_KEYS = new Set([
  "player_first_basket",
  "player_first_team_basket",
  "player_double_double",
  "player_triple_double"
])

const SPECIAL_PROP_TYPES = new Set([
  "First Basket",
  "First Team Basket",
  "Double Double",
  "Triple Double"
])

function toKey(value) {
  return String(value || "").trim()
}

function isSpecialRow(row) {
  const marketKey = toKey(row?.marketKey)
  const propType = toKey(row?.propType)
  const marketFamily = toKey(row?.marketFamily)

  return (
    marketFamily === "special" ||
    SPECIAL_MARKET_KEYS.has(marketKey) ||
    SPECIAL_PROP_TYPES.has(propType)
  )
}

function isTeamFirstBasketRow(row) {
  const marketKey = toKey(row?.marketKey)
  const propType = toKey(row?.propType)

  return (
    marketKey === "player_first_team_basket" ||
    propType === "First Team Basket"
  )
}

function isPlayerFirstBasketRow(row) {
  const marketKey = toKey(row?.marketKey)
  const propType = toKey(row?.propType)

  return (
    marketKey === "player_first_basket" ||
    propType === "First Basket"
  )
}

function isMilestoneLadderRow(row) {
  const marketKey = toKey(row?.marketKey)
  const propVariant = toKey(row?.propVariant || "base")
  const line = Number(row?.line)
  const propType = toKey(row?.propType)

  if (!STANDARD_PROP_TYPES.has(propType)) return false
  if (!Number.isFinite(line)) return false

  const isAlternateMarket =
    marketKey.endsWith("_alternate") ||
    marketKey.includes("_alternate")

  if (!isAlternateMarket) return false

  if (!LADDER_PROP_VARIANTS.has(propVariant)) return true

  return false
}

function isAltLineLadderRow(row) {
  const propVariant = toKey(row?.propVariant || "base")
  return LADDER_PROP_VARIANTS.has(propVariant)
}

function classifyBoardRow(row) {
  const propType = toKey(row?.propType)

  if (isSpecialRow(row)) {
    let specialSubtype = "otherSpecial"
    if (isPlayerFirstBasketRow(row)) specialSubtype = "playerFirstBasket"
    else if (isTeamFirstBasketRow(row)) specialSubtype = "teamFirstBasket"
    else if (propType === "Double Double") specialSubtype = "doubleDouble"
    else if (propType === "Triple Double") specialSubtype = "tripleDouble"

    return {
      boardFamily: "special",
      ladderSubtype: null,
      specialSubtype
    }
  }

  if (isMilestoneLadderRow(row)) {
    return {
      boardFamily: "ladder",
      ladderSubtype: "milestone",
      specialSubtype: null
    }
  }

  if (isAltLineLadderRow(row)) {
    return {
      boardFamily: "ladder",
      ladderSubtype: "altLine",
      specialSubtype: null
    }
  }

  if (STANDARD_PROP_TYPES.has(propType)) {
    return {
      boardFamily: "standard",
      ladderSubtype: null,
      specialSubtype: null
    }
  }

  return {
    boardFamily: "other",
    ladderSubtype: null,
    specialSubtype: null
  }
}

module.exports = {
  STANDARD_PROP_TYPES,
  LADDER_PROP_VARIANTS,
  isSpecialRow,
  isTeamFirstBasketRow,
  isPlayerFirstBasketRow,
  isMilestoneLadderRow,
  isAltLineLadderRow,
  classifyBoardRow
}