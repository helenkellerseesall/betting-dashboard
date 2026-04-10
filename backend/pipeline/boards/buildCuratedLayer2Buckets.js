function parseHitRateValue(hitRate) {
  if (hitRate == null) return 0
  if (typeof hitRate === "string" && hitRate.includes("/")) {
    const parts = hitRate.split("/").map(Number)
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] > 0) {
      return parts[0] / parts[1]
    }
    return 0
  }
  const numeric = Number(hitRate)
  return Number.isFinite(numeric) ? numeric : 0
}

function buildCuratedLayer2Buckets({
  corePropsBoard,
  ladderBoard,
  ladderProps,
  lottoBoard,
  parseHitRate,
  dedupeBoardRows,
  shouldRemoveLegForPlayerStatus,
  highestHitRateSortValue,
  bestValueSortValue,
  logger = console.log
}) {
  const safeCoreRows = Array.isArray(corePropsBoard) ? corePropsBoard : []
  const safeLadderRows = dedupeBoardRows([
    ...(Array.isArray(ladderBoard) ? ladderBoard : []),
    ...(Array.isArray(ladderProps) ? ladderProps : [])
  ])
  const safeLottoRows = Array.isArray(lottoBoard) ? lottoBoard : []

  const toLegKey = (row) => [
    String(row?.eventId || ""),
    String(row?.player || "").trim().toLowerCase(),
    String(row?.propType || "").trim().toLowerCase(),
    String(row?.side || "").trim().toLowerCase(),
    String(row?.line ?? ""),
    String(row?.marketKey || "").trim().toLowerCase(),
    String(row?.propVariant || "base").trim().toLowerCase(),
    String(row?.book || "").trim().toLowerCase()
  ].join("|")
  const normalizePlayerKey = (row) => String(row?.player || "").trim().toLowerCase()
  const normalizePropTypeKey = (row) => String(row?.propType || "").trim().toLowerCase()
  const normalizeMatchupKey = (row) => String(row?.matchup || row?.eventId || "").trim().toLowerCase()
  const toPlayerPropKey = (row) => `${normalizePlayerKey(row)}|${normalizePropTypeKey(row)}`

  const isAggressiveVariant = (row) => {
    const variant = String(row?.propVariant || "base").toLowerCase()
    return variant === "alt-mid" || variant === "alt-high" || variant === "alt-max"
  }

  const isLadderStyleRow = (row) => {
    return Boolean(row?.ladderPresentation) ||
      String(row?.boardFamily || "") === "ladder" ||
      isAggressiveVariant(row)
  }

  const isPlayableCandidate = (row) => {
    if (!row) return false
    if (!row?.player || !row?.matchup || !row?.propType || !row?.book) return false
    if (!Number.isFinite(Number(row?.line))) return false
    if (!Number.isFinite(Number(row?.odds))) return false
    if (!Number.isFinite(Number(row?.score))) return false
    if (shouldRemoveLegForPlayerStatus(row)) return false
    const playDecision = String(row?.playDecision || "").toLowerCase()
    if (playDecision.includes("avoid") || playDecision.includes("fade")) return false
    return true
  }

  const selectCuratedRows = (rows, config) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const sorted = safeRows
      .filter((row) => isPlayableCandidate(row))
      .filter((row) => {
        if (!config.blockedPlayerPropKeys || !(config.blockedPlayerPropKeys instanceof Set)) return true
        const isBlocked = config.blockedPlayerPropKeys.has(toPlayerPropKey(row))
        if (!isBlocked) return true
        if (typeof config.allowBlockedRow === "function") return Boolean(config.allowBlockedRow(row))
        return false
      })
      .filter((row) => config.rowFilter(row))
      .slice()
      .sort((a, b) => config.rankFn(b) - config.rankFn(a))

    const selected = []
    const seenLegKeys = new Set()
    const playerCounts = new Map()
    const matchupCounts = new Map()
    const playerPropKeys = new Set()

    for (const row of sorted) {
      if (selected.length >= config.maxRows) break

      const legKey = toLegKey(row)
      if (seenLegKeys.has(legKey)) continue

      const playerKey = normalizePlayerKey(row)
      const propTypeKey = normalizePropTypeKey(row)
      const matchupKey = normalizeMatchupKey(row)
      const playerPropKey = `${playerKey}|${propTypeKey}`

      if (!playerKey || !propTypeKey || !matchupKey) continue
      if ((playerCounts.get(playerKey) || 0) >= config.maxPerPlayer) continue
      if ((matchupCounts.get(matchupKey) || 0) >= config.maxPerMatchup) continue
      if (playerPropKeys.has(playerPropKey)) continue

      selected.push(row)
      seenLegKeys.add(legKey)
      playerCounts.set(playerKey, (playerCounts.get(playerKey) || 0) + 1)
      matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      playerPropKeys.add(playerPropKey)
    }

    return selected
  }

  const mostLikelyToHit = selectCuratedRows(safeCoreRows, {
    maxRows: 8,
    maxPerPlayer: 1,
    maxPerMatchup: 2,
    rowFilter: (row) => {
      const hitRate = parseHitRate(row?.hitRate)
      const score = Number(row?.score || 0)
      const odds = Number(row?.odds || 0)
      const variant = String(row?.propVariant || "base").toLowerCase()
      return hitRate >= 0.57 && score >= 74 && odds >= -320 && odds <= 180 && (variant === "base" || variant === "default" || variant === "alt-low")
    },
    rankFn: (row) => {
      const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? 0)
      const score = Number(row?.score || 0)
      const odds = Number(row?.odds || 0)
      const ceilingScore = Number(row?.ceilingScore || 0)
      const roleSpikeScore = Number(row?.roleSpikeScore || 0)
      const marketLagScore = Number(row?.marketLagScore || 0)
      const lineupContextScore = Number(row?.lineupContextScore || 0)
      const opportunitySpikeScore = Number(row?.opportunitySpikeScore || 0)
      const stableContextLift = (lineupContextScore * 5) + (opportunitySpikeScore * 2)
      const pricingPenalty = odds > 120 ? Math.min(18, (odds - 120) * 0.06) : 0
      const boomPenalty = (ceilingScore * 8) + (roleSpikeScore * 6) + (marketLagScore * 4)
      return highestHitRateSortValue(row) + (confidence * 32) + (score * 0.45) + stableContextLift - pricingPenalty - boomPenalty
    }
  })

  const bestValue = selectCuratedRows(safeCoreRows, {
    maxRows: 8,
    maxPerPlayer: 1,
    maxPerMatchup: 2,
    rowFilter: (row) => {
      const hitRate = parseHitRate(row?.hitRate)
      const score = Number(row?.score || 0)
      const edge = Number(row?.edge || 0)
      const odds = Number(row?.odds || 0)
      const hasPlusMoneyPath = odds >= 100
      return hitRate >= 0.52 && score >= 70 && edge >= 0.7 && odds >= -190 && odds <= 300 && (hasPlusMoneyPath || edge >= 1.0)
    },
    rankFn: (row) => {
      const odds = Number(row?.odds || 0)
      const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? 0)
      const marketLagScore = Number(row?.marketLagScore || 0)
      const bookDisagreementScore = Number(row?.bookDisagreementScore || 0)
      const ceilingScore = Number(row?.ceilingScore || 0)
      const roleSpikeScore = Number(row?.roleSpikeScore || 0)
      const lineupContextScore = Number(row?.lineupContextScore || 0)
      const opportunitySpikeScore = Number(row?.opportunitySpikeScore || 0)
      const valueContextSupport = Math.max(0, ((lineupContextScore * 0.65) + (opportunitySpikeScore * 0.35)) - 0.42)
      const valueContextLift = valueContextSupport * 16
      const plusMoneyBonus = odds >= 105 && odds <= 280 ? 10 : 0
      const lowCeilingPenalty = odds < -155 ? 8 : 0
      const genericBoomPenalty = (ceilingScore * 3) + (roleSpikeScore * 2)
      return bestValueSortValue(row) + (confidence * 18) + plusMoneyBonus + (marketLagScore * 16) + (bookDisagreementScore * 24) + valueContextLift - genericBoomPenalty - lowCeilingPenalty
    }
  })

  const saferLanePlayerPropKeys = new Set([
    ...mostLikelyToHit.map((row) => toPlayerPropKey(row)),
    ...bestValue.map((row) => toPlayerPropKey(row))
  ])

  const bestUpsideAllowBlockedRow = (row) => isLadderStyleRow(row)
  const bestUpsideBaseRowFilter = (row) => {
    const hitRate = parseHitRateValue(row?.hitRate)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const odds = Number(row?.odds || 0)
    const side = String(row?.side || "").toLowerCase()
    const variant = String(row?.propVariant || "base").toLowerCase()
    const isLadderish = isLadderStyleRow(row)
    const isOver = side === "over"
    const isUnder = side === "under"

    if (isLadderish) {
      if (variant === "alt-low") return false
      if (hitRate < 0.48) return false
      if (score < 65) return false
      if (odds < 120 || odds > 1100) return false
      if (isUnder) {
        if (hitRate < 0.68 || score < 86 || edge < 1.5) return false
      }
      return true
    }

    const strongUnderException = isUnder && odds >= 220 && hitRate >= 0.57 && edge >= 1.25 && score >= 76
    if (odds < 115 || odds > 1100) return false
    if (hitRate < 0.43 || score < 64 || edge < 0.2) return false
    if (!isOver && !strongUnderException) return false
    if (odds < 150) return false
    return true
  }

  const bestUpsideFallbackRowFilter = (row) => {
    const hitRate = parseHitRateValue(row?.hitRate)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const odds = Number(row?.odds || 0)
    const side = String(row?.side || "").toLowerCase()
    const variant = String(row?.propVariant || "base").toLowerCase()
    const isLadderish = isLadderStyleRow(row)
    const isOver = side === "over"
    const isUnder = side === "under"

    if (isLadderish) {
      if (variant === "alt-low") return false
      if (hitRate < 0.44) return false
      if (score < 60) return false
      if (odds < -400 || odds > 1100) return false
      if (isUnder) {
        if (hitRate < 0.64 || score < 80 || edge < 1.0) return false
      }
      return true
    }

    const strongUnderException = isUnder && odds >= 240 && hitRate >= 0.6 && edge >= 1.5 && score >= 80
    if (odds < 105 || odds > 1100) return false
    if (hitRate < 0.4 || score < 60 || edge < 0) return false
    if (!isOver && !strongUnderException) return false
    if (odds < 140) return false
    return true
  }

  const upsideSourceRows = dedupeBoardRows([
    ...safeLadderRows,
    ...safeLottoRows.filter((row) => {
      const odds = Number(row?.odds || 0)
      const side = String(row?.side || "").toLowerCase()
      const marketFamily = String(row?.marketFamily || "")
      return marketFamily !== "special" && side === "over" && odds >= 115 && isLadderStyleRow(row)
    }),
    ...safeCoreRows.filter((row) => {
      const odds = Number(row?.odds || 0)
      const side = String(row?.side || "").toLowerCase()
      return side === "over" && odds >= 115
    })
  ])

  const upsideInitialCandidates = upsideSourceRows.filter((row) => isPlayableCandidate(row))
  const upsidePostBlockCandidates = upsideInitialCandidates.filter((row) => {
    const isBlocked = saferLanePlayerPropKeys.has(toPlayerPropKey(row))
    if (!isBlocked) return true
    return bestUpsideAllowBlockedRow(row)
  })
  const upsidePostBaseFilterCandidates = upsidePostBlockCandidates.filter((row) => bestUpsideBaseRowFilter(row))
  const upsideUseFallbackFilter = upsidePostBaseFilterCandidates.length === 0 && upsidePostBlockCandidates.length > 0
  const upsidePostFilterCandidates = upsideUseFallbackFilter
    ? upsidePostBlockCandidates.filter((row) => bestUpsideFallbackRowFilter(row))
    : upsidePostBaseFilterCandidates

  const bestUpsideRaw = selectCuratedRows(upsideSourceRows, {
    maxRows: 12,
    maxPerPlayer: 2,
    maxPerMatchup: 3,
    blockedPlayerPropKeys: saferLanePlayerPropKeys,
    allowBlockedRow: bestUpsideAllowBlockedRow,
    rowFilter: upsideUseFallbackFilter ? bestUpsideFallbackRowFilter : bestUpsideBaseRowFilter,
    rankFn: (row) => {
      const odds = Number(row?.odds || 0)
      const score = Number(row?.score || 0)
      const edge = Number(row?.edge || 0)
      const hitRate = parseHitRateValue(row?.hitRate)
      const ceilingScore = Number(row?.ceilingScore || 0)
      const roleSpikeScore = Number(row?.roleSpikeScore || 0)
      const marketLagScore = Number(row?.marketLagScore || 0)
      const bookDisagreementScore = Number(row?.bookDisagreementScore || 0)
      const lineupContextScore = Number(row?.lineupContextScore || 0)
      const opportunitySpikeScore = Number(row?.opportunitySpikeScore || 0)
      const upsideContextScore = (opportunitySpikeScore * 0.58) + (lineupContextScore * 0.42)
      const upsideSignalStack = (ceilingScore * 0.42) + (roleSpikeScore * 0.34) + (marketLagScore * 0.24)
      const upsideContextLift = upsideContextScore * 18
      const upsideSignalSynergy = upsideContextScore * upsideSignalStack * 26
      const side = String(row?.side || "").toLowerCase()
      const variant = String(row?.propVariant || "base").toLowerCase()
      const variantBonus = variant === "alt-max" ? 24 : variant === "alt-high" ? 20 : variant === "alt-mid" ? 12 : 0
      const overBonus = side === "over" ? 16 : -18
      const ladderBonus = Boolean(row?.ladderPresentation) || String(row?.boardFamily || "") === "ladder" ? 10 : 0
      const oddsBandBonus = odds >= 180 && odds <= 550 ? 12 : odds > 550 ? 5 : 0
      const lowOddsPenalty = odds < 140 ? 10 : 0
      return (odds * 0.12) + (score * 0.95) + (edge * 20) + (hitRate * 52) + (ceilingScore * 22) + (roleSpikeScore * 18) + (marketLagScore * 12) + (bookDisagreementScore * 6) + upsideContextLift + upsideSignalSynergy + variantBonus + overBonus + ladderBonus + oddsBandBonus - lowOddsPenalty
    }
  })

  let upsideUnderCount = 0
  const bestUpside = bestUpsideRaw.filter((row) => {
    if (String(row?.side || "").toLowerCase() !== "under") return true

    const hitRate = parseHitRateValue(row?.hitRate)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const ceilingScore = Number(row?.ceilingScore || 0)
    const roleSpikeScore = Number(row?.roleSpikeScore || 0)
    const eliteUnderUpsideException =
      hitRate >= 0.74 &&
      score >= 90 &&
      edge >= 2.2 &&
      ceilingScore >= 0.72 &&
      roleSpikeScore >= 0.65

    if (eliteUnderUpsideException && upsideUnderCount < 1) {
      upsideUnderCount++
      return true
    }
    return false
  }).slice(0, 8)

  logger("[LAYER2-BESTUPSIDE-DEBUG]", {
    sourceCandidateCount: upsideSourceRows.length,
    postPlayableCandidateCount: upsideInitialCandidates.length,
    postBlockDeoverlapCount: upsidePostBlockCandidates.length,
    postRowFilterCount: upsidePostFilterCandidates.length,
    usedFallbackFilter: upsideUseFallbackFilter,
    finalSelectedCount: bestUpside.length,
    underCount: upsideUnderCount,
    sourceMix: {
      ladderStyle: upsideInitialCandidates.filter((row) => isLadderStyleRow(row)).length,
      overSide: upsideInitialCandidates.filter((row) => String(row?.side || "").toLowerCase() === "over").length,
      plusMoney180Plus: upsideInitialCandidates.filter((row) => Number(row?.odds || 0) >= 180).length
    }
  })

  return {
    mostLikelyToHit,
    bestValue,
    bestUpside
  }
}

module.exports = {
  buildCuratedLayer2Buckets
}
