const { normalizeLower, buildRowLegKey } = require("./boardHelpers")

function buildBestSpecials({
  featuredFirstBasket,
  featuredSpecials,
  featuredPlayScore,
  maxRows = 6
}) {
  const isTrueFirstBasketRow = (row) => {
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    return (
      marketKey === "player_first_basket" ||
      marketKey === "player_first_team_basket" ||
      propType === "First Basket" ||
      propType === "First Team Basket"
    )
  }

  const isDoubleDoubleRow = (row) => {
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    return marketKey === "player_double_double" || propType === "Double Double"
  }

  const isTrueSpecialMarketRow = (row) => {
    if (String(row?.marketFamily || "") === "special") return true
    const marketKey = String(row?.marketKey || "")
    return [
      "player_first_basket",
      "player_first_team_basket",
      "player_double_double",
      "player_triple_double"
    ].includes(marketKey)
  }

  const isLaneNativeSpecialRow = (row) => {
    const marketFamily = String(row?.marketFamily || "")
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    if (marketFamily === "special") return true
    if (["player_first_basket", "player_first_team_basket", "player_double_double", "player_triple_double"].includes(marketKey)) return true
    return ["First Basket", "First Team Basket", "Double Double", "Triple Double"].includes(propType)
  }

  const specialSubtypeKey = (row) => {
    const marketKey = normalizeLower(row?.marketKey)
    if (marketKey) return marketKey
    return normalizeLower(row?.propType)
  }

  const playerFirstBasketRows = Array.isArray(featuredFirstBasket)
    ? featuredFirstBasket.filter((row) => String(row?.marketKey || "") === "player_first_basket")
    : []

  const specialRows = Array.isArray(featuredSpecials) ? featuredSpecials : []

  const firstBasketPicks = playerFirstBasketRows.slice(0, 3)
  const selectedPlayers = new Set(firstBasketPicks.map((row) => normalizeLower(row?.player)))

  const allSpecials = []
  for (const row of specialRows) {
    const playerKey = normalizeLower(row?.player)
    if (selectedPlayers.has(playerKey)) continue
    allSpecials.push(row)
    selectedPlayers.add(playerKey)
  }

  const nightlySpecials = [
    ...firstBasketPicks,
    ...allSpecials
  ]

  const specialExcitementBoost = (row) => {
    const odds = Number(row?.odds ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const propType = String(row?.propType || "")
    const marketKey = String(row?.marketKey || "")
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)

    let boost = 0
    if (tier === "special-elite") boost += 12
    else if (tier === "special-strong") boost += 8
    else if (tier === "special-playable") boost += 4

    if (Number.isFinite(odds) && odds >= 180 && odds <= 1100) boost += 6
    else if (Number.isFinite(odds) && odds > 1100) boost += 2
    else if (Number.isFinite(odds) && odds > 0 && odds < 150) boost -= 6

    if (marketKey === "player_first_basket") boost += 4
    if (propType === "Triple Double") boost += 5
    else if (propType === "Double Double") boost += 3
    if (confidence >= 0.45) boost += 3

    return boost
  }

  const isBoardWorthyVolatileSpecial = (row) => {
    const odds = Number(row?.odds ?? 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const strongTier = tier === "special-elite" || tier === "special-strong"
    return (
      (Number.isFinite(odds) && odds >= 170 && odds <= 1400 && confidence >= 0.20) ||
      (strongTier && Number.isFinite(odds) && odds >= 130)
    )
  }

  const nativePriority = (row) => {
    if (isTrueFirstBasketRow(row)) return 4
    if (isTrueSpecialMarketRow(row) && !isDoubleDoubleRow(row)) return 3
    if (isBoardWorthyVolatileSpecial(row)) return 2
    if (isDoubleDoubleRow(row)) return 1
    return 0
  }

  const orderedNightlySpecials = [...nightlySpecials].sort((a, b) => {
    const nativeDiff = Number(isLaneNativeSpecialRow(b)) - Number(isLaneNativeSpecialRow(a))
    if (nativeDiff !== 0) return nativeDiff
    const nativePriorityDiff = nativePriority(b) - nativePriority(a)
    if (nativePriorityDiff !== 0) return nativePriorityDiff
    return (featuredPlayScore(b) + specialExcitementBoost(b)) - (featuredPlayScore(a) + specialExcitementBoost(a))
  })

  const nativeSpecialRows = orderedNightlySpecials.filter((row) => isLaneNativeSpecialRow(row))
  const fallbackSpecialRows = orderedNightlySpecials.filter((row) => !isLaneNativeSpecialRow(row))

  const shaped = []
  const seenSpecialLegs = new Set()
  const subtypeCounts = new Map()
  let doubleDoubleCount = 0
  const uniqueNativeSubtypeCount = new Set(nativeSpecialRows.map((row) => specialSubtypeKey(row))).size
  const NATIVE_MAX_PER_SUBTYPE = uniqueNativeSubtypeCount >= 3 ? 1 : 2
  const nonDoubleDoubleNativeCount = nativeSpecialRows.filter((row) => !isDoubleDoubleRow(row)).length
  const NATIVE_MAX_DOUBLE_DOUBLE = nonDoubleDoubleNativeCount >= 2 ? 1 : 2

  for (const row of nativeSpecialRows) {
    const legKey = buildRowLegKey(row)
    if (seenSpecialLegs.has(legKey)) continue
    const subtypeKey = specialSubtypeKey(row)
    if (isDoubleDoubleRow(row) && doubleDoubleCount >= NATIVE_MAX_DOUBLE_DOUBLE) continue
    if ((subtypeCounts.get(subtypeKey) || 0) >= NATIVE_MAX_PER_SUBTYPE) continue
    seenSpecialLegs.add(legKey)
    subtypeCounts.set(subtypeKey, (subtypeCounts.get(subtypeKey) || 0) + 1)
    if (isDoubleDoubleRow(row)) doubleDoubleCount += 1
    shaped.push(row)
    if (shaped.length >= maxRows) break
  }

  if (shaped.length < maxRows) {
    for (const row of nativeSpecialRows) {
      const legKey = buildRowLegKey(row)
      if (seenSpecialLegs.has(legKey)) continue
      seenSpecialLegs.add(legKey)
      shaped.push(row)
      if (shaped.length >= maxRows) break
    }
  }

  if (shaped.length < maxRows) {
    for (const row of fallbackSpecialRows) {
      const legKey = buildRowLegKey(row)
      if (seenSpecialLegs.has(legKey)) continue
      seenSpecialLegs.add(legKey)
      shaped.push(row)
      if (shaped.length >= maxRows) break
    }
  }

  return shaped
}

module.exports = {
  buildBestSpecials
}
