const { normalizeLower, buildRowLegKey } = require("./boardHelpers")

function buildBestSpecials({
  featuredFirstBasket,
  featuredSpecials,
  liveSpecialRows,
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

  const isWeakQualitySpecial = (row) => {
    const decision = String(row?.playDecision || "").toLowerCase()
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const hitRate = Number(row?.hitRatePct)
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    const isTripleDouble = marketKey === "player_triple_double" || propType === "Triple Double"
    
    if (decision.includes("avoid") || decision.includes("fade")) return true
    if (tier.includes("special-thin")) return true
    if (Number.isFinite(hitRate) && isTripleDouble && hitRate < 35) return true
    if (Number.isFinite(hitRate) && !isTripleDouble && hitRate < 40) return true
    return false
  }

  const preferredSpecialRows = (Array.isArray(featuredSpecials) ? featuredSpecials : []).filter((row) => !isWeakQualitySpecial(row))
  const liveSpecialPoolRows = (Array.isArray(liveSpecialRows) ? liveSpecialRows : []).filter(Boolean)
  const mergedSpecialRows = []
  const seenMergedLegKeys = new Set()

  const filteredLiveSpecialPoolRows = liveSpecialPoolRows.filter((row) => !isWeakQualitySpecial(row))
  
  for (const row of [...preferredSpecialRows, ...filteredLiveSpecialPoolRows]) {
    const legKey = buildRowLegKey(row)
    if (seenMergedLegKeys.has(legKey)) continue
    seenMergedLegKeys.add(legKey)
    mergedSpecialRows.push(row)
  }

  const specialRows = mergedSpecialRows.filter((row) => isLaneNativeSpecialRow(row))

  const liveSpecialLegKeys = new Set(
    specialRows
      .filter((row) => isLaneNativeSpecialRow(row))
      .map((row) => buildRowLegKey(row))
  )

  const liveFirstBasketRows = specialRows.filter((row) => isTrueFirstBasketRow(row))

  const playerFirstBasketRows = Array.isArray(featuredFirstBasket)
    ? featuredFirstBasket.filter((row) => {
      const marketKey = String(row?.marketKey || "")
      if (!["player_first_basket", "player_first_team_basket"].includes(marketKey)) return false
      return liveSpecialLegKeys.has(buildRowLegKey(row))
    })
    : []

  const validFirstBasketRows = playerFirstBasketRows.length > 0
    ? playerFirstBasketRows
    : liveFirstBasketRows

  const firstBasketPicks = validFirstBasketRows.slice(0, 2)
  const selectedLegKeys = new Set(firstBasketPicks.map((row) => buildRowLegKey(row)))

  const allSpecials = []
  for (const row of specialRows) {
    const legKey = buildRowLegKey(row)
    if (selectedLegKeys.has(legKey)) continue
    allSpecials.push(row)
    selectedLegKeys.add(legKey)
  }

  const nightlySpecials = [
    ...firstBasketPicks,
    ...allSpecials
  ]

  const isThinLottoSpecial = (row) => {
    const odds = Number(row?.odds ?? 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const propType = String(row?.propType || "")
    const marketKey = String(row?.marketKey || "")
    const isTripleOrDouble = propType === "Triple Double" || propType === "Double Double" || marketKey === "player_triple_double" || marketKey === "player_double_double"

    if (tier === "special-thin" && Number.isFinite(odds) && odds >= 700) return true
    if (isTripleOrDouble && Number.isFinite(odds) && odds >= 1200 && confidence < 0.45) return true
    if (Number.isFinite(odds) && odds >= 1600 && confidence < 0.40) return true
    return false
  }

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
    if (isThinLottoSpecial(row)) boost -= 12

    return boost
  }

  const specialActionabilityScore = (row) => {
    const odds = Number(row?.odds ?? 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")

    let score = 0
    if (marketKey === "player_first_basket") score += 8
    if (marketKey === "player_first_team_basket") score += 6
    if (propType === "Triple Double") score += 5
    if (propType === "Double Double") score += 2

    if (Number.isFinite(odds) && odds >= 180 && odds <= 1200) score += 9
    else if (Number.isFinite(odds) && odds >= 130 && odds < 180) score += 4
    else if (Number.isFinite(odds) && odds > 1200) score -= 5

    if (confidence >= 0.55) score += 6
    else if (confidence >= 0.45) score += 3
    if (String(row?.confidenceTier || "").toLowerCase() === "special-thin") score -= 6
    if (isThinLottoSpecial(row)) score -= 8

    return score
  }

  const isBoardWorthyVolatileSpecial = (row) => {
    const odds = Number(row?.odds ?? 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const strongTier = tier === "special-elite" || tier === "special-strong"
    if (isThinLottoSpecial(row)) return false
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
    const actionableDiff = specialActionabilityScore(b) - specialActionabilityScore(a)
    if (actionableDiff !== 0) return actionableDiff
    return (featuredPlayScore(b) + specialExcitementBoost(b)) - (featuredPlayScore(a) + specialExcitementBoost(a))
  })

  const nativeSpecialRows = orderedNightlySpecials.filter((row) => isLaneNativeSpecialRow(row))
  const fallbackSpecialRows = orderedNightlySpecials.filter((row) => !isLaneNativeSpecialRow(row))

  const shaped = []
  const seenSpecialLegs = new Set()
  const subtypeCounts = new Map()
  const matchupCounts = new Map()
  let doubleDoubleCount = 0
  const uniqueNativeSubtypeCount = new Set(nativeSpecialRows.map((row) => specialSubtypeKey(row))).size
  const NATIVE_MAX_PER_SUBTYPE = uniqueNativeSubtypeCount >= 3 ? 1 : 2
  const nonDoubleDoubleNativeCount = nativeSpecialRows.filter((row) => !isDoubleDoubleRow(row)).length
  const NATIVE_MAX_DOUBLE_DOUBLE = nonDoubleDoubleNativeCount >= 2 ? 1 : 2
  const NATIVE_MAX_PER_MATCHUP = 2
  const nonThinLottoNativeCount = nativeSpecialRows.filter((row) => !isThinLottoSpecial(row)).length
  const NATIVE_MAX_THIN_LOTTO = nonThinLottoNativeCount >= 3 ? 1 : 2
  let thinLottoCount = 0

  for (const row of nativeSpecialRows) {
    const legKey = buildRowLegKey(row)
    if (seenSpecialLegs.has(legKey)) continue
    const subtypeKey = specialSubtypeKey(row)
    const matchupKey = normalizeLower(row?.matchup || row?.eventId)
    const isThinLotto = isThinLottoSpecial(row)
    if (isDoubleDoubleRow(row) && doubleDoubleCount >= NATIVE_MAX_DOUBLE_DOUBLE) continue
    if (isThinLotto && thinLottoCount >= NATIVE_MAX_THIN_LOTTO) continue
    if ((subtypeCounts.get(subtypeKey) || 0) >= NATIVE_MAX_PER_SUBTYPE) continue
    if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= NATIVE_MAX_PER_MATCHUP) continue
    seenSpecialLegs.add(legKey)
    subtypeCounts.set(subtypeKey, (subtypeCounts.get(subtypeKey) || 0) + 1)
    if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
    if (isDoubleDoubleRow(row)) doubleDoubleCount += 1
    if (isThinLotto) thinLottoCount += 1
    shaped.push(row)
    if (shaped.length >= maxRows) break
  }

  if (shaped.length < maxRows) {
    for (const row of nativeSpecialRows) {
      const legKey = buildRowLegKey(row)
      if (seenSpecialLegs.has(legKey)) continue
      const matchupKey = normalizeLower(row?.matchup || row?.eventId)
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= NATIVE_MAX_PER_MATCHUP) continue
      seenSpecialLegs.add(legKey)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
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
