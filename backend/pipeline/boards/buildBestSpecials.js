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

  const isTripleDoubleRow = (row) => {
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    return marketKey === "player_triple_double" || propType === "Triple Double"
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

  const classifySpecialType = (row) => {
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    if (marketKey === "player_first_basket" || propType === "First Basket") return "firstBasket"
    if (marketKey === "player_first_team_basket" || propType === "First Team Basket") return "firstTeamBasket"
    if (isDoubleDoubleRow(row)) return "doubleDouble"
    if (isTripleDoubleRow(row)) return "tripleDouble"
    return "otherSpecials"
  }

  const specialSubtypeKey = (row) => {
    const marketKey = normalizeLower(row?.marketKey)
    if (marketKey) return marketKey
    return normalizeLower(row?.propType)
  }

  const confidenceEstimate01 = (row) => {
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    if (!Number.isFinite(confidence) || confidence <= 0) return 0
    if (confidence <= 1) return Math.max(0, Math.min(1, confidence))
    if (confidence <= 100) return Math.max(0, Math.min(1, confidence / 100))
    return 0
  }

  const hitRateEstimatePct = (row) => {
    const hitRate = Number(row?.hitRatePct)
    if (Number.isFinite(hitRate) && hitRate > 0) return hitRate
    return Math.round(confidenceEstimate01(row) * 100)
  }

  const decisionStrengthScore = (row) => {
    const decision = String(row?.playDecision || "").toLowerCase()
    if (decision.includes("must-play")) return 1
    if (decision.includes("strong")) return 0.8
    if (decision.includes("playable")) return 0.55
    if (decision.includes("viable")) return 0.45
    if (decision.includes("avoid") || decision.includes("fade")) return 0
    return 0.35
  }

  const tierSupportScore = (row) => {
    const tier = String(row?.confidenceTier || "").toLowerCase()
    if (tier.includes("elite")) return 1
    if (tier.includes("strong")) return 0.82
    if (tier.includes("playable")) return 0.58
    if (tier.includes("thin")) return 0.18
    return 0.45
  }

  const movementSupportScore = (row) => {
    const movement = String(row?.marketMovementTag || "").toLowerCase()
    if (movement.includes("confirm") || movement.includes("back") || movement.includes("steam")) return 1
    if (movement.includes("stable")) return 0.55
    if (movement.includes("drift")) return 0.18
    return 0.45
  }

  const summarySupportScore = (row) => {
    const summary = String(row?.decisionSummary || "").trim()
    if (!summary) return 0
    return summary.length >= 24 ? 1 : 0.6
  }

  const ddTdQualityScore = (row) => {
    const confidence = confidenceEstimate01(row)
    const hitRate = Math.max(0, Math.min(100, hitRateEstimatePct(row))) / 100
    const score =
      (decisionStrengthScore(row) * 0.28) +
      (tierSupportScore(row) * 0.22) +
      (confidence * 0.22) +
      (hitRate * 0.20) +
      (movementSupportScore(row) * 0.05) +
      (summarySupportScore(row) * 0.03)
    return Number(score.toFixed(3))
  }

  const isStrongTripleDoubleCandidate = (row) => {
    if (!isTripleDoubleRow(row)) return true
    const quality = ddTdQualityScore(row)
    const hitRate = hitRateEstimatePct(row)
    const confidence = confidenceEstimate01(row)
    return quality >= 0.67 || (quality >= 0.62 && hitRate >= 52 && confidence >= 0.52)
  }

  const isWeakQualitySpecial = (row) => {
    const decision = String(row?.playDecision || "").toLowerCase()
    const decisionSummary = String(row?.decisionSummary || "").trim()
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const hitRate = hitRateEstimatePct(row)

    if (decision.includes("avoid") || decision.includes("fade")) return true
    if (!decision && !decisionSummary) return true
    if (tier.includes("special-thin")) return true
    if (isTripleDoubleRow(row) && !isStrongTripleDoubleCandidate(row)) return true
    if (isTripleDoubleRow(row) && Number.isFinite(hitRate) && hitRate < 48) return true
    if (isDoubleDoubleRow(row) && Number.isFinite(hitRate) && hitRate < 42) return true
    return false
  }

  const baseSpecialSupportScore = (row) => {
    const confidence = confidenceEstimate01(row)
    const hitRate = Math.max(0, Math.min(100, hitRateEstimatePct(row))) / 100
    const score =
      (decisionStrengthScore(row) * 0.30) +
      (tierSupportScore(row) * 0.22) +
      (confidence * 0.20) +
      (hitRate * 0.18) +
      (movementSupportScore(row) * 0.06) +
      (summarySupportScore(row) * 0.04)
    return Number(score.toFixed(3))
  }

  const preferredSpecialRowsRaw = (Array.isArray(featuredSpecials) ? featuredSpecials : []).filter(Boolean)
  const liveSpecialPoolRows = (Array.isArray(liveSpecialRows) ? liveSpecialRows : []).filter(Boolean)
  const preferredSpecialRowsStrict = preferredSpecialRowsRaw.filter((row) => !isWeakQualitySpecial(row))
  const preferredSpecialRows = preferredSpecialRowsStrict.length > 0 ? preferredSpecialRowsStrict : preferredSpecialRowsRaw
  const mergedSpecialRows = []
  const seenMergedLegKeys = new Set()

  const filteredLiveSpecialPoolRowsStrict = liveSpecialPoolRows.filter((row) => !isWeakQualitySpecial(row))
  const filteredLiveSpecialPoolRows = filteredLiveSpecialPoolRowsStrict.length > 0 ? filteredLiveSpecialPoolRowsStrict : liveSpecialPoolRows
  
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

  const firstBasketPicks = [...validFirstBasketRows]
    .sort((a, b) => baseSpecialSupportScore(b) - baseSpecialSupportScore(a))
    .slice(0, 2)
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
    const marketKey = String(row?.marketKey || "")
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const ddTdQuality = ddTdQualityScore(row)

    let boost = 0
    if (tier === "special-elite") boost += 12
    else if (tier === "special-strong") boost += 8
    else if (tier === "special-playable") boost += 4

    if (Number.isFinite(odds) && odds >= 180 && odds <= 1100) boost += 6
    else if (Number.isFinite(odds) && odds > 1100) boost += 1
    else if (Number.isFinite(odds) && odds > 0 && odds < 150) boost -= 6

    if (marketKey === "player_first_basket") boost += 4
    if (isDoubleDoubleRow(row)) boost += ddTdQuality >= 0.62 ? 4 : 1
    if (isTripleDoubleRow(row)) boost += ddTdQuality >= 0.70 ? 2 : -8
    if (confidence >= 0.45) boost += 3
    if (isThinLottoSpecial(row)) boost -= 12

    return boost
  }

  const specialActionabilityScore = (row) => {
    const odds = Number(row?.odds ?? 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const marketKey = String(row?.marketKey || "")
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const ddTdQuality = ddTdQualityScore(row)

    let score = 0
    if (marketKey === "player_first_basket") score += 8
    if (marketKey === "player_first_team_basket") score += 6
    if (isTripleDoubleRow(row)) score += ddTdQuality >= 0.70 ? 1 : -18
    if (isDoubleDoubleRow(row)) score += ddTdQuality >= 0.60 ? 6 : -6

    if (Number.isFinite(odds) && odds >= 220 && odds <= 1200) score += 11
    else if (Number.isFinite(odds) && odds >= 170 && odds < 220) score += 7
    else if (Number.isFinite(odds) && odds >= 130 && odds < 180) score += 4
    else if (Number.isFinite(odds) && odds > 1200) score -= 5

    if (confidence >= 0.55) score += 6
    else if (confidence >= 0.45) score += 3
    if (tier === "special-elite") score += 5
    else if (tier === "special-strong") score += 3
    if (String(row?.confidenceTier || "").toLowerCase() === "special-thin") score -= 6
    if (isThinLottoSpecial(row)) score -= 8
    if (isDoubleDoubleRow(row) || isTripleDoubleRow(row)) score += Math.round(ddTdQuality * 10)

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
    if (isTripleDoubleRow(row)) return isStrongTripleDoubleCandidate(row) ? 2 : 0
    if (isDoubleDoubleRow(row)) return 2
    if (isTrueSpecialMarketRow(row)) return 3
    if (isBoardWorthyVolatileSpecial(row)) return 1
    return 0
  }

  const specialTypeRankScore = (row) => {
    const type = classifySpecialType(row)
    let score = baseSpecialSupportScore(row)

    if (type === "doubleDouble") score += (ddTdQualityScore(row) * 0.22) + 0.04
    if (type === "tripleDouble") score += (ddTdQualityScore(row) * 0.22) - (isStrongTripleDoubleCandidate(row) ? 0 : 0.22)
    if (type === "firstBasket") score += 0.08
    if (type === "firstTeamBasket") score += 0.04

    return Number(score.toFixed(3))
  }

  const sortRowsWithinType = (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return [...safeRows].sort((a, b) => {
      const rankDiff = specialTypeRankScore(b) - specialTypeRankScore(a)
      if (rankDiff !== 0) return rankDiff
      const actionableDiff = specialActionabilityScore(b) - specialActionabilityScore(a)
      if (actionableDiff !== 0) return actionableDiff
      return (featuredPlayScore(b) + specialExcitementBoost(b)) - (featuredPlayScore(a) + specialExcitementBoost(a))
    })
  }

  const mergeTypeAwareSpecialRows = (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const typeOrder = ["firstBasket", "doubleDouble", "tripleDouble", "firstTeamBasket", "otherSpecials"]
    const groupedRows = Object.fromEntries(
      typeOrder.map((type) => [
        type,
        sortRowsWithinType(safeRows.filter((row) => classifySpecialType(row) === type))
      ])
    )

    const merged = []
    const seenLegKeys = new Set()
    let roundIndex = 0
    let addedInRound = true

    while (addedInRound) {
      addedInRound = false
      const roundRows = []

      for (const type of typeOrder) {
        const row = groupedRows[type][roundIndex]
        if (!row) continue
        roundRows.push(row)
        addedInRound = true
      }

      roundRows.sort((a, b) => {
        const rankDiff = specialTypeRankScore(b) - specialTypeRankScore(a)
        if (rankDiff !== 0) return rankDiff
        const actionableDiff = specialActionabilityScore(b) - specialActionabilityScore(a)
        if (actionableDiff !== 0) return actionableDiff
        return (featuredPlayScore(b) + specialExcitementBoost(b)) - (featuredPlayScore(a) + specialExcitementBoost(a))
      })

      for (const row of roundRows) {
        const legKey = buildRowLegKey(row)
        if (seenLegKeys.has(legKey)) continue
        seenLegKeys.add(legKey)
        merged.push(row)
      }

      roundIndex += 1
    }

    return merged
  }

  const orderedNightlySpecials = mergeTypeAwareSpecialRows(
    [...nightlySpecials].sort((a, b) => {
      const nativeDiff = Number(isLaneNativeSpecialRow(b)) - Number(isLaneNativeSpecialRow(a))
      if (nativeDiff !== 0) return nativeDiff
      const nativePriorityDiff = nativePriority(b) - nativePriority(a)
      if (nativePriorityDiff !== 0) return nativePriorityDiff
      const actionableDiff = specialActionabilityScore(b) - specialActionabilityScore(a)
      if (actionableDiff !== 0) return actionableDiff
      return (featuredPlayScore(b) + specialExcitementBoost(b)) - (featuredPlayScore(a) + specialExcitementBoost(a))
    })
  )

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
  const NATIVE_MAX_DOUBLE_DOUBLE = nonDoubleDoubleNativeCount >= 1 ? 1 : 2
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
      if (isDoubleDoubleRow(row) && doubleDoubleCount >= NATIVE_MAX_DOUBLE_DOUBLE) continue
      const matchupKey = normalizeLower(row?.matchup || row?.eventId)
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= NATIVE_MAX_PER_MATCHUP) continue
      seenSpecialLegs.add(legKey)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      if (isDoubleDoubleRow(row)) doubleDoubleCount += 1
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
