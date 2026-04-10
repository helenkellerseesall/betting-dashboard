const { normalizeLower, normalizeFeaturedPlayerKey } = require("./boardHelpers")

function buildFeaturedPlays({
  corePropPicks,
  ladderBoard,
  enrichedSpecialProps,
  specialBoard,
  firstBasketBoard,
  mustPlayBoard,
  useSpecialLikeFirstBasketFallback,
  isSpecialLikeFallbackCandidate,
  isFirstBasketLikeRow,
  specialLikeFallbackPromotionScore,
  parseHitRate,
  dedupeBoardRows
}) {
  const featuredPlayScore = (row) => {
    const adjusted = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
    const hitRate = Number(parseHitRate(row?.hitRate) || 0)
    const side = String(row?.side || "")
    const propType = String(row?.propType || "")
    const marketFamily = String(row?.marketFamily || "")
    const propVariant = String(row?.propVariant || "base")

    let score = adjusted * 100 + edge * 3 + hitRate * 20

    if (marketFamily === "special") score += 8

    if (propVariant === "alt-low") score += 10
    if (propVariant === "alt-mid") score += 14
    if (propVariant === "alt-high") score += 12
    if (propVariant === "alt-max") score += 8

    if (propType === "Points") score += 2
    if (propType === "PRA") score += 2
    if (propType === "Assists") score += 2
    if (propType === "Threes") score += 5
    if (propType === "First Basket") score += 4
    if (propType === "First Team Basket") score += 4
    if (propType === "Double Double") score += 3
    if (propType === "Triple Double") score += 2

    if (side === "Under") score -= 6
    if (side === "Under" && propType === "Rebounds") score -= 8

    if (propVariant !== "base" && propVariant !== "default" && side === "Over" && hitRate >= 0.7) score += 6
    if (propVariant !== "base" && propVariant !== "default" && edge >= 3.0) score += 4
    if (propType === "Threes" && side === "Over") score += 4

    return score
  }

  const dedupeFeaturedRows = (rows, maxPerPlayer = 2, maxPerMatchup = 3) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const playerCounts = new Map()
    const matchupCounts = new Map()
    const seenLegs = new Set()
    const out = []

    for (const row of safeRows) {
      const playerKey = normalizeFeaturedPlayerKey(row?.player)
      const matchupKey = normalizeLower(row?.matchup || row?.eventId)
      const legKey = [
        playerKey,
        String(row?.propType || ""),
        String(row?.side || ""),
        String(row?.line ?? ""),
        String(row?.marketKey || ""),
        String(row?.propVariant || "base")
      ].join("|")

      if (seenLegs.has(legKey)) continue
      if (playerKey && (playerCounts.get(playerKey) || 0) >= maxPerPlayer) continue
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= maxPerMatchup) continue

      seenLegs.add(legKey)
      if (playerKey) playerCounts.set(playerKey, (playerCounts.get(playerKey) || 0) + 1)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      out.push(row)
    }

    return out
  }

  const featuredCore = ((Array.isArray(corePropPicks) ? corePropPicks : [])
    .filter(Boolean)
    .sort((a, b) => featuredPlayScore(b) - featuredPlayScore(a))
    .slice(0, 5))

  const featuredLadders = (() => {
    const FEATURED_LADDER_MAX_PER_PLAYER = 1
    const sorted = (Array.isArray(ladderBoard) ? ladderBoard : [])
      .filter(Boolean)
      .filter((row) => {
        const propType = String(row?.propType || "")
        const side = String(row?.side || "")
        const propVariant = String(row?.propVariant || "base")
        return (
          side === "Over" &&
          propVariant !== "base" &&
          ["Points", "PRA", "Assists", "Threes", "Rebounds"].includes(propType)
        )
      })
      .sort((a, b) => featuredPlayScore(b) - featuredPlayScore(a))

    const preferredUpside = sorted.filter((row) => {
      const propVariant = String(row?.propVariant || "base")
      const odds = Number(row?.odds || 0)
      if (["alt-mid", "alt-high", "alt-max"].includes(propVariant)) return true
      return Number.isFinite(odds) && odds >= 120
    })

    const baseFallback = (Array.isArray(ladderBoard) ? ladderBoard : [])
      .filter(Boolean)
      .filter((row) => {
        const propType = String(row?.propType || "")
        const side = String(row?.side || "")
        const propVariant = String(row?.propVariant || "base")
        return (
          side === "Over" &&
          (propVariant === "base" || propVariant === "default") &&
          ["Points", "PRA", "Assists", "Threes", "Rebounds"].includes(propType)
        )
      })
      .sort((a, b) => featuredPlayScore(b) - featuredPlayScore(a))

    const seenPlayerPropType = new Set()
    const playerCounts = new Map()
    const seenFeaturedPropTypes = new Set()
    const out = []

    for (const row of preferredUpside) {
      const playerKey = normalizeLower(row?.player)
      const propTypeKey = normalizeLower(row?.propType)
      const dedupKey = `${playerKey}|${propTypeKey}`
      if (seenPlayerPropType.has(dedupKey)) continue
      if ((playerCounts.get(playerKey) || 0) >= FEATURED_LADDER_MAX_PER_PLAYER) continue
      if (seenFeaturedPropTypes.has(propTypeKey)) continue
      seenPlayerPropType.add(dedupKey)
      seenFeaturedPropTypes.add(propTypeKey)
      playerCounts.set(playerKey, (playerCounts.get(playerKey) || 0) + 1)
      out.push(row)
      if (out.length >= 10) break
    }

    if (out.length < 10) {
      for (const row of sorted) {
        const playerKey = normalizeLower(row?.player)
        const propTypeKey = normalizeLower(row?.propType)
        const dedupKey = `${playerKey}|${propTypeKey}`
        if (seenPlayerPropType.has(dedupKey)) continue
        seenPlayerPropType.add(dedupKey)
        out.push(row)
        if (out.length >= 10) break
      }
    }

    if (out.length < 10) {
      for (const row of baseFallback) {
        const playerKey = normalizeLower(row?.player)
        const propTypeKey = normalizeLower(row?.propType)
        const dedupKey = `${playerKey}|${propTypeKey}`
        if (seenPlayerPropType.has(dedupKey)) continue
        seenPlayerPropType.add(dedupKey)
        out.push(row)
        if (out.length >= 10) break
      }
    }

    return out
  })()

  const FEATURED_FIRST_BASKET_MARKET_KEYS = new Set([
    "player_first_basket",
    "player_first_team_basket"
  ])

  const featuredFirstBasketSource = (
    Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps : []
  ).filter((row) => {
    const marketKey = String(row?.marketKey || "")
    const matchup = String(row?.matchup || row?.eventId || "").trim()
    const player = String(row?.player || "").trim()
    const odds = Number(row?.odds ?? 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()

    if (!FEATURED_FIRST_BASKET_MARKET_KEYS.has(marketKey)) return false
    if (!matchup) return false
    if (!player) return false
    if (!Number.isFinite(odds) || odds <= 0 || odds > 2000) return false
    if (confidence < 0.10) return false
    if (tier === "special-thin" && confidence < 0.16) return false

    return true
  })

  const featuredFirstBasketByGame = new Map()
  const featuredFirstBasketTierRank = (tier) => {
    const t = String(tier || "").toLowerCase()
    if (t === "special-elite") return 4
    if (t === "special-strong") return 3
    if (t === "special-playable") return 2
    if (t === "special-thin") return 1
    return 0
  }

  for (const row of featuredFirstBasketSource) {
    const matchup = String(row?.matchup || row?.eventId || "").trim()
    const current = featuredFirstBasketByGame.get(matchup)
    if (!current) {
      featuredFirstBasketByGame.set(matchup, row)
      continue
    }
    const rowIsPlayerFB = String(row?.marketKey || "") === "player_first_basket"
    const currentIsPlayerFB = String(current?.marketKey || "") === "player_first_basket"
    if (rowIsPlayerFB && !currentIsPlayerFB) {
      featuredFirstBasketByGame.set(matchup, row)
    } else if (!rowIsPlayerFB && currentIsPlayerFB) {
      // keep current - player_first_basket preferred
    } else if (rowIsPlayerFB && currentIsPlayerFB) {
      const rowTier = featuredFirstBasketTierRank(row?.confidenceTier)
      const currentTier = featuredFirstBasketTierRank(current?.confidenceTier)
      if (rowTier > currentTier) {
        featuredFirstBasketByGame.set(matchup, row)
      } else if (rowTier === currentTier && featuredPlayScore(row) > featuredPlayScore(current)) {
        featuredFirstBasketByGame.set(matchup, row)
      }
    } else if (featuredPlayScore(row) > featuredPlayScore(current)) {
      featuredFirstBasketByGame.set(matchup, row)
    }
  }

  const featuredFirstBasket = Array.from(featuredFirstBasketByGame.values())
    .sort((a, b) => featuredPlayScore(b) - featuredPlayScore(a))
    .slice(0, 9)

  const featuredSpecials = (() => {
    const specialRows = (Array.isArray(specialBoard) ? specialBoard : []).filter(Boolean)
    const specialActionabilityScore = (row) => {
      const odds = Number(row?.odds ?? 0)
      const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
      const marketKey = String(row?.marketKey || "")
      const propType = String(row?.propType || "")

      let score = 0
      if (marketKey === "player_first_basket") score += 9
      else if (marketKey === "player_first_team_basket") score += 6
      else if (propType === "Triple Double") score += 5
      else if (propType === "Double Double") score += 3

      if (Number.isFinite(odds) && odds >= 170 && odds <= 1200) score += 8
      else if (Number.isFinite(odds) && odds >= 125 && odds < 170) score += 4
      else if (Number.isFinite(odds) && odds > 1200) score -= 2

      if (confidence >= 0.55) score += 6
      else if (confidence >= 0.45) score += 3

      return score
    }

    const primary = specialRows
      .filter((row) => {
        const marketKey = String(row?.marketKey || "")
        const propType = String(row?.propType || "")
        const odds = Number(row?.odds ?? 0)

        const isCoreSpecial = [
          "player_first_basket",
          "player_first_team_basket",
          "player_double_double",
          "player_triple_double"
        ].includes(marketKey) || ["First Basket", "First Team Basket", "Double Double", "Triple Double"].includes(propType)

        if (!isCoreSpecial) return false
        if (Number.isFinite(odds) && odds > 1800) return false
        return true
      })
      .sort((a, b) => {
        const actionableDiff = specialActionabilityScore(b) - specialActionabilityScore(a)
        if (actionableDiff !== 0) return actionableDiff
        return featuredPlayScore(b) - featuredPlayScore(a)
      })

    const isDdInPrimary = (row) => {
      const mk = String(row?.marketKey || "")
      const pt = String(row?.propType || "")
      return mk === "player_double_double" || pt === "Double Double"
    }
    const primaryDdCount = primary.filter(isDdInPrimary).length
    const finalPrimary = primaryDdCount >= 3 && (primary.length - primaryDdCount) < 2
      ? [...primary.filter((row) => !isDdInPrimary(row)), ...primary.filter(isDdInPrimary).slice(0, 2)]
      : primary

    if (finalPrimary.length >= 4 || !useSpecialLikeFirstBasketFallback) {
      return finalPrimary.slice(0, 4)
    }

    const fallbackSourceRows = dedupeBoardRows([
      ...specialRows,
      ...firstBasketBoard
    ])

    const seenPlayerKeys = new Set(finalPrimary.map((row) => normalizeLower(row?.player)))
    const fallback = fallbackSourceRows
      .filter((row) => {
        const playerKey = normalizeLower(row?.player)
        if (seenPlayerKeys.has(playerKey)) return false
        if (isFirstBasketLikeRow(row)) return false
        return isSpecialLikeFallbackCandidate(row)
      })
      .sort((a, b) => (featuredPlayScore(b) + specialLikeFallbackPromotionScore(b)) - (featuredPlayScore(a) + specialLikeFallbackPromotionScore(a)))

    return [...finalPrimary, ...fallback].slice(0, 4)
  })()

  const featuredMustPlays = ((Array.isArray(mustPlayBoard) ? mustPlayBoard : [])
    .filter(Boolean)
    .sort((a, b) => featuredPlayScore(b) - featuredPlayScore(a))
    .slice(0, 4))

  const preservedFeaturedFirstBasket = Array.isArray(featuredFirstBasket) ? featuredFirstBasket : []

  const featuredFallbackSpecialLikes = useSpecialLikeFirstBasketFallback
    ? firstBasketBoard
      .filter((row) => isSpecialLikeFallbackCandidate(row) && !isFirstBasketLikeRow(row))
      .sort((a, b) => specialLikeFallbackPromotionScore(b) - specialLikeFallbackPromotionScore(a))
      .slice(0, 3)
    : []

  const lanePrimaryPools = {
    core: featuredCore.slice(0, 4),
    ladders: featuredLadders.slice(0, 4),
    specials: featuredSpecials.slice(0, 4),
    mustPlays: featuredMustPlays.slice(0, 4),
    firstBasket: preservedFeaturedFirstBasket.slice(0, 3),
    fallbackSpecialLikes: featuredFallbackSpecialLikes.slice(0, 2)
  }

  const laneOrder = ["core", "mustPlays", "ladders", "specials", "firstBasket", "fallbackSpecialLikes"]
  const laneIndexes = new Map(laneOrder.map((lane) => [lane, 0]))
  const seenPrimaryLegs = new Set()
  const primaryFeaturedSource = []

  let progressed = true
  while (progressed) {
    progressed = false
    for (const lane of laneOrder) {
      const laneRows = lanePrimaryPools[lane] || []
      let idx = laneIndexes.get(lane) || 0
      while (idx < laneRows.length) {
        const row = laneRows[idx]
        idx += 1
        const legKey = [
          normalizeFeaturedPlayerKey(row?.player),
          String(row?.propType || ""),
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")
        if (seenPrimaryLegs.has(legKey)) continue
        seenPrimaryLegs.add(legKey)
        primaryFeaturedSource.push(row)
        progressed = true
        break
      }
      laneIndexes.set(lane, idx)
    }
  }

  const reserveFeaturedSource = [
    ...featuredCore.slice(4),
    ...featuredLadders.slice(4),
    ...featuredSpecials.slice(4),
    ...featuredMustPlays.slice(4),
    ...preservedFeaturedFirstBasket.slice(3),
    ...featuredFallbackSpecialLikes.slice(2)
  ]

  const featuredSource = [
    ...primaryFeaturedSource,
    ...reserveFeaturedSource
  ].filter(Boolean)

  const featuredPlays = dedupeFeaturedRows(
    featuredSource
      .filter(Boolean),
    2,
    3
  ).slice(0, 18)

  return {
    featuredPlayScore,
    featuredCore,
    featuredLadders,
    featuredFirstBasket,
    featuredSpecials,
    featuredMustPlays,
    featuredPlays
  }
}

module.exports = {
  buildFeaturedPlays
}
