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

function toSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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
  const marketKeyText = toSearchText(row?.marketKey)
  const propTypeText = toSearchText(row?.propType)

  return (
    marketKey === "player_first_team_basket" ||
    propType === "First Team Basket" ||
    marketKeyText.includes("first team basket") ||
    marketKeyText.includes("team first basket") ||
    propTypeText.includes("first team basket") ||
    propTypeText.includes("team first basket")
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
  const line = Number(row?.line)
  const propType = toKey(row?.propType)
  const sideText = toSearchText(row?.side)
  const contextText = toSearchText([
    row?.marketKey,
    row?.marketName,
    row?.label,
    row?.name,
    row?.selection,
    row?.outcomeName,
    row?.description
  ].filter(Boolean).join(" "))

  if (!STANDARD_PROP_TYPES.has(propType)) return false
  if (!Number.isFinite(line)) return false

  const isAlternateMarket =
    marketKey.endsWith("_alternate") ||
    marketKey.includes("_alternate") ||
    marketKey.includes("alternate")

  if (!isAlternateMarket) return false

  const isThresholdStyle =
    contextText.includes("or more") ||
    contextText.includes("at least") ||
    contextText.includes("+") ||
    sideText === "over" ||
    sideText === "under"

  return isThresholdStyle
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
