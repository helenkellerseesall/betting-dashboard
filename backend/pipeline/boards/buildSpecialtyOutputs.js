function classifySpecialType(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "").trim()

  if (marketKey === "player_first_basket" || /first\s*basket/i.test(propType)) return "firstBasket"
  if (marketKey === "player_first_team_basket" || /first\s*team\s*basket/i.test(propType)) return "firstTeamBasket"
  if (/triple\s*double/i.test(propType)) return "tripleDouble"
  if (/double\s*double/i.test(propType)) return "doubleDouble"
  return "otherSpecials"
}

function isFirstTeamBasket(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "")
  return marketKey === "player_first_team_basket" || /first\s*team\s*basket/i.test(propType)
}

function isFirstBasket(row) {
  if (isFirstTeamBasket(row)) return false
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "")
  return marketKey === "player_first_basket" || /first\s*basket/i.test(propType)
}

function isDoubleDouble(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "")
  return marketKey === "player_double_double" || /double\s*double/i.test(propType)
}

function isTripleDouble(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "")
  return marketKey === "player_triple_double" || /triple\s*double/i.test(propType)
}

function isSpecialLikeRow(row) {
  const text = [
    row?.marketKey,
    row?.propType,
    row?.sourceLane,
    row?.mustPlayBetType,
    row?.mustPlaySourceLane,
    row?.marketFamily
  ].filter(Boolean).join(" ").toLowerCase()

  return [
    "first_basket",
    "first basket",
    "first_team_basket",
    "first team basket",
    "double_double",
    "double double",
    "triple_double",
    "triple double",
    "special",
    "bestspecials"
  ].some((needle) => text.includes(needle))
}

function parseMatchupTeams(matchupValue) {
  const matchup = String(matchupValue || "").trim()
  if (!matchup) return { away: "", home: "" }
  const normalized = matchup.replace(/\s+vs\.?\s+/i, " @ ")
  const parts = normalized.split("@").map((part) => String(part || "").trim()).filter(Boolean)
  if (parts.length >= 2) {
    return {
      away: parts[0],
      home: parts[1]
    }
  }
  return { away: "", home: "" }
}

function toUnitScore(value, fallback = null) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric <= 1) return Number(Math.max(0, Math.min(1, numeric)).toFixed(3))
  if (numeric <= 100) return Number((Math.max(0, Math.min(100, numeric)) / 100).toFixed(3))
  return fallback
}

function hasSpecialHardStop(row) {
  const tier = String(row?.confidenceTier || "").toLowerCase()
  const playDecision = String(row?.playDecision || "").toLowerCase()
  const odds = Number(row?.odds || 0)
  const confidence = Number(row?.playerConfidenceScore ?? row?.adjustedConfidenceScore ?? row?.score ?? 0)
  const availability = String(row?.availabilityStatus || "").toLowerCase()

  if (!playDecision.includes("avoid") && !playDecision.includes("fade") && !playDecision.includes("sit")) return false
  if (availability === "out" || availability === "doubtful") return true
  if (tier.includes("special-thin") || tier.includes("thin")) return true
  if (odds > 1600 && confidence < 0.22) return true
  if (!row?.player || !row?.book || !row?.matchup) return true
  return false
}

function normalizeSpecialtyRow(row) {
  const safeRow = row && typeof row === "object" ? row : {}
  const playerTeamIndex = safeRow?.__specialtyPlayerTeamIndex && typeof safeRow.__specialtyPlayerTeamIndex === "object"
    ? safeRow.__specialtyPlayerTeamIndex
    : {}
  const playerKey = String(safeRow?.player || "").trim().toLowerCase()
  const indexedTeam = playerKey ? playerTeamIndex[playerKey] : null
  const inferredTeam =
    safeRow?.team ||
    safeRow?.playerTeam ||
    safeRow?.teamName ||
    safeRow?.teamAbbr ||
    indexedTeam ||
    safeRow?.awayTeam ||
    safeRow?.homeTeam ||
    null

  const confidence01 = toUnitScore(safeRow?.adjustedConfidenceScore ?? safeRow?.playerConfidenceScore ?? safeRow?.score, null)
  const gamePriority01 = toUnitScore(safeRow?.gamePriorityScore, null)
  const bookValue01 = toUnitScore(safeRow?.bookValueScore, null)
  const ceilingScore = toUnitScore(safeRow?.ceilingScore, confidence01)
  const roleSpikeScore = toUnitScore(safeRow?.roleSpikeScore, gamePriority01 != null ? gamePriority01 : confidence01)
  const marketLagScore = toUnitScore(safeRow?.marketLagScore, bookValue01)
  const derivedBookDisagreement = marketLagScore != null && bookValue01 != null
    ? Number((((marketLagScore * 0.6) + (bookValue01 * 0.4))).toFixed(3))
    : (marketLagScore != null ? marketLagScore : bookValue01)
  const bookDisagreementScore = toUnitScore(safeRow?.bookDisagreementScore, derivedBookDisagreement)

  const nextPlayDecision = hasSpecialHardStop(safeRow)
    ? safeRow?.playDecision
    : (String(safeRow?.playDecision || "").toLowerCase().includes("avoid") ||
       String(safeRow?.playDecision || "").toLowerCase().includes("fade") ||
       String(safeRow?.playDecision || "").toLowerCase().includes("sit"))
      ? "special-playable"
      : (safeRow?.playDecision || null)

  const nextDecisionSummary =
    nextPlayDecision === "special-playable"
      ? "SPECIAL: specialty-only review passed; playable with moderated confidence."
      : (safeRow?.decisionSummary || null)

  const nextDecisionBucketHint = nextPlayDecision === "special-playable"
    ? "special-only"
    : (safeRow?.decisionBucketHint || null)

  const nextFinalDecisionLabelHint = nextPlayDecision === "special-playable"
    ? "special-only"
    : (safeRow?.finalDecisionLabelHint || null)

  return {
    ...safeRow,
    team: inferredTeam,
    ceilingScore,
    roleSpikeScore,
    marketLagScore,
    bookDisagreementScore,
    playDecision: nextPlayDecision,
    decisionSummary: nextDecisionSummary,
    decisionBucketHint: nextDecisionBucketHint,
    finalDecisionLabelHint: nextFinalDecisionLabelHint
  }
}

function filterTopSpecialsForWeakness(rows) {
  let nullDecisionFilteredCount = 0
  const safeRows = Array.isArray(rows) ? rows : []

  const isWeak = (row) => {
    const decision = String(row?.playDecision || "").toLowerCase()
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const hitRate = Number(row?.hitRatePct)

    if (decision.includes("avoid") || decision.includes("fade")) return true
    if (tier.includes("special-thin")) return true
    if (Number.isFinite(hitRate) && hitRate < 40) return true
    return false
  }

  const qualityPass = safeRows.filter((row) => !isWeak(row))
  const decisionBackedPass = qualityPass.filter((row) => {
    const hasDecisionBacking = Boolean(String(row?.playDecision || "").trim()) || Boolean(String(row?.decisionSummary || "").trim())
    if (!hasDecisionBacking) nullDecisionFilteredCount += 1
    return hasDecisionBacking
  })

  if (decisionBackedPass.length > 0) {
    return {
      rows: decisionBackedPass,
      nullDecisionFilteredCount
    }
  }

  if (qualityPass.length > 0) {
    return {
      rows: qualityPass,
      nullDecisionFilteredCount
    }
  }

  return {
    rows: safeRows,
    nullDecisionFilteredCount: 0
  }
}

function getSpecialtySubtype(row) {
  if (isFirstTeamBasket(row)) return "firstTeamBasket"
  if (isFirstBasket(row)) return "firstBasket"
  if (isTripleDouble(row)) return "tripleDouble"
  if (isDoubleDouble(row)) return "doubleDouble"
  return "otherSpecials"
}

function tierToScore(row) {
  const tier = String(row?.confidenceTier || "").toLowerCase()
  if (tier.includes("special-elite") || tier === "elite") return 1
  if (tier.includes("special-strong") || tier === "strong") return 0.78
  if (tier.includes("special-playable") || tier === "playable") return 0.56
  if (tier.includes("thin")) return 0.18
  return 0.4
}

function toAmericanOddsBandScore(oddsValue) {
  const odds = Number(oddsValue)
  if (!Number.isFinite(odds)) return 0.35
  if (odds >= 180 && odds <= 900) return 1
  if (odds > 900 && odds <= 1400) return 0.72
  if (odds >= 120 && odds < 180) return 0.58
  if (odds > 0 && odds < 120) return 0.28
  if (odds > 1400) return 0.18
  return 0.32
}

function getSubtypeOddsFitScore(subtype, oddsValue) {
  const odds = Number(oddsValue)
  if (!Number.isFinite(odds)) return 0.3

  if (subtype === "firstBasket") {
    if (odds >= 240 && odds <= 700) return 1
    if (odds >= 180 && odds < 240) return 0.72
    if (odds > 700 && odds <= 1100) return 0.68
    if (odds > 1100 && odds <= 1500) return 0.45
    return 0.2
  }

  if (subtype === "firstTeamBasket") {
    if (odds >= 180 && odds <= 600) return 1
    if (odds > 600 && odds <= 1000) return 0.62
    if (odds >= 130 && odds < 180) return 0.64
    return 0.24
  }

  if (subtype === "tripleDouble") {
    if (odds >= 250 && odds <= 1400) return 1
    if (odds >= 170 && odds < 250) return 0.62
    return 0.3
  }

  if (subtype === "doubleDouble") {
    if (odds >= 130 && odds <= 700) return 1
    if (odds > 700 && odds <= 1100) return 0.58
    return 0.34
  }

  if (odds >= 150 && odds <= 900) return 0.85
  if (odds > 900 && odds <= 1400) return 0.52
  return 0.3
}

function getSignalCompletenessScore(row) {
  const hasCeiling = Number.isFinite(Number(row?.ceilingScore))
  const hasRoleSpike = Number.isFinite(Number(row?.roleSpikeScore))
  const hasMarketLag = Number.isFinite(Number(row?.marketLagScore))
  const hasConfidence = Number.isFinite(Number(row?.playerConfidenceScore ?? row?.adjustedConfidenceScore ?? row?.confidenceScore ?? row?.score))
  const hasTier = Boolean(String(row?.confidenceTier || "").trim())
  const whyCount = Array.isArray(row?.whyItRates) ? row.whyItRates.length : 0

  let completeness = 0
  if (hasConfidence) completeness += 0.28
  if (hasCeiling) completeness += 0.2
  if (hasRoleSpike) completeness += 0.18
  if (hasMarketLag) completeness += 0.18
  if (hasTier) completeness += 0.1
  if (whyCount > 0) completeness += 0.06

  return Number(Math.max(0, Math.min(1, completeness)).toFixed(3))
}

function buildSpecialtyRankScore(row) {
  const subtype = getSpecialtySubtype(row)
  const confidence = toUnitScore(row?.playerConfidenceScore ?? row?.adjustedConfidenceScore ?? row?.confidenceScore ?? row?.score, 0)
  const ceilingScore = toUnitScore(row?.ceilingScore, confidence)
  const roleSpikeScore = toUnitScore(row?.roleSpikeScore, confidence)
  const marketLagScore = toUnitScore(row?.marketLagScore, 0.3)
  const bookDisagreementScore = toUnitScore(row?.bookDisagreementScore, marketLagScore)
  const tierScore = tierToScore(row)
  const oddsBandScore = toAmericanOddsBandScore(row?.odds)
  const subtypeOddsFitScore = getSubtypeOddsFitScore(subtype, row?.odds)
  const signalCompletenessScore = getSignalCompletenessScore(row)
  const playDecision = String(row?.playDecision || "").toLowerCase()

  const subtypeWeights = subtype === "firstTeamBasket"
    ? { confidence: 0.31, ceiling: 0.2, role: 0.22, market: 0.12, book: 0.08, tier: 0.05 }
    : subtype === "firstBasket"
      ? { confidence: 0.34, ceiling: 0.22, role: 0.18, market: 0.12, book: 0.08, tier: 0.06 }
      : { confidence: 0.32, ceiling: 0.24, role: 0.16, market: 0.12, book: 0.08, tier: 0.08 }

  let score =
    (confidence * subtypeWeights.confidence) +
    (ceilingScore * subtypeWeights.ceiling) +
    (roleSpikeScore * subtypeWeights.role) +
    (marketLagScore * subtypeWeights.market) +
    (bookDisagreementScore * subtypeWeights.book) +
    (tierScore * subtypeWeights.tier)

  // Boom lane: reward plus-money shape with subtype-specific odds windows and complete signals.
  score += oddsBandScore * 0.1
  score += subtypeOddsFitScore * 0.1
  score += signalCompletenessScore * 0.08

  const boomReadinessScore = Number((
    (confidence * 0.35) +
    (ceilingScore * 0.3) +
    (roleSpikeScore * 0.2) +
    (marketLagScore * 0.15)
  ).toFixed(4))
  score += boomReadinessScore * 0.12

  if (playDecision.includes("avoid") || playDecision.includes("fade") || playDecision.includes("sit")) score -= 0.22
  if (tierScore <= 0.2 && confidence < 0.28) score -= 0.16
  if (Number(row?.odds || 0) > 1500 && confidence < 0.34) score -= 0.18
  if (signalCompletenessScore < 0.46 && confidence < 0.34) score -= 0.14
  if (boomReadinessScore < 0.33 && subtypeOddsFitScore < 0.45) score -= 0.12

  return Number(score.toFixed(4))
}

function rankSpecialtyRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  return [...safeRows]
    .map((row, index) => ({
      row,
      index,
      rankScore: buildSpecialtyRankScore(row),
      confidenceTieBreaker: Number(toUnitScore(row?.playerConfidenceScore ?? row?.adjustedConfidenceScore ?? row?.confidenceScore ?? row?.score, 0) || 0),
      oddsTieBreaker: Number(row?.odds || 0)
    }))
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore
      if (b.confidenceTieBreaker !== a.confidenceTieBreaker) return b.confidenceTieBreaker - a.confidenceTieBreaker
      if (b.oddsTieBreaker !== a.oddsTieBreaker) return b.oddsTieBreaker - a.oddsTieBreaker
      return a.index - b.index
    })
    .map(({ row, rankScore }) => ({ ...row, specialtyRankScore: rankScore }))
}

function buildTypeAwareSpecialSlices(rows, limit = 4) {
  const safeRows = Array.isArray(rows) ? rows : []
  const rankedRows = rankSpecialtyRows(safeRows)
  return {
    bestDoubleDoubles: rankedRows.filter((row) => isDoubleDouble(row)).slice(0, limit),
    bestTripleDoubles: rankedRows.filter((row) => isTripleDouble(row)).slice(0, limit),
    bestFirstBasket: rankedRows.filter((row) => isFirstBasket(row)).slice(0, limit),
    bestFirstTeamBasket: rankedRows.filter((row) => isFirstTeamBasket(row)).slice(0, limit)
  }
}

function buildSpecialsAudit({
  specialBoard,
  firstBasketBoard,
  tonightsBestSpecials,
  countByMarketKey
}) {
  const safeRows = Array.isArray(specialBoard) ? specialBoard : []

  const groups = {
    firstBasket: [],
    firstTeamBasket: [],
    doubleDouble: [],
    tripleDouble: [],
    otherSpecials: []
  }

  const countsByType = {
    firstBasket: 0,
    firstTeamBasket: 0,
    doubleDouble: 0,
    tripleDouble: 0,
    otherSpecials: 0
  }

  for (const row of safeRows) {
    const specialType = classifySpecialType(row)
    groups[specialType].push({
      player: row?.player || null,
      matchup: row?.matchup || null,
      marketKey: row?.marketKey || null,
      propType: row?.propType || null,
      odds: Number(row?.odds ?? 0) || null,
      hitRatePct: Number(row?.hitRatePct),
      confidenceTier: row?.confidenceTier || null,
      playDecision: row?.playDecision || null,
      decisionSummary: row?.decisionSummary || null,
      sourceLane: row?.sourceLane || null,
      whySynopsis: row?.whySynopsis || null
    })
    countsByType[specialType] += 1
  }

  return {
    totalCandidates: safeRows.length,
    countsByType,
    surfacedAuditFirstBasketCount: countsByType.firstBasket,
    surfacedAuditFirstTeamBasketCount: countsByType.firstTeamBasket,
    auditSource: "specialBoard",
    auditSourceExcludesFirstBasketByDesign: true,
    routedFirstBasketRowsInFirstBasketBoard: countByMarketKey(firstBasketBoard, "player_first_basket"),
    routedFirstTeamBasketRowsInFirstBasketBoard: countByMarketKey(firstBasketBoard, "player_first_team_basket"),
    groupedByType: {
      firstBasket: groups.firstBasket,
      firstTeamBasket: groups.firstTeamBasket,
      doubleDouble: groups.doubleDouble,
      tripleDouble: groups.tripleDouble,
      otherSpecials: groups.otherSpecials
    },
    surfacedBestSpecialsCount: Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials.length : 0
  }
}

function buildSpecialtyOutputs({
  specialBoard,
  firstBasketBoard,
  tonightsBestSpecials,
  featuredPlays,
  countByMarketKey,
  specialtyPlayerTeamIndex = {},
  typeSliceLimit = 4,
  laneSliceLimit = 6
}) {
  const withTeamIndex = (row) => ({
    ...(row && typeof row === "object" ? row : {}),
    __specialtyPlayerTeamIndex: specialtyPlayerTeamIndex
  })

  const normalizedSpecialBoard = (Array.isArray(specialBoard) ? specialBoard : []).map((row) => normalizeSpecialtyRow(withTeamIndex(row)))
  const normalizedTopSpecialRows = (Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : []).map((row) => normalizeSpecialtyRow(withTeamIndex(row)))
  const normalizedFeaturedRows = (Array.isArray(featuredPlays) ? featuredPlays : [])
    .filter((row) => isSpecialLikeRow(row))
    .map((row) => normalizeSpecialtyRow(withTeamIndex(row)))

  const rankedSpecialBoard = rankSpecialtyRows(normalizedSpecialBoard)
  const rankedTopSpecialRows = rankSpecialtyRows(normalizedTopSpecialRows)
  const rankedFeaturedRows = rankSpecialtyRows(normalizedFeaturedRows)

  const filteredTopSpecials = filterTopSpecialsForWeakness(rankedTopSpecialRows)
  const typeAwareSpecials = buildTypeAwareSpecialSlices(rankedSpecialBoard, typeSliceLimit)
  const specialsAudit = buildSpecialsAudit({
    specialBoard: rankedSpecialBoard,
    firstBasketBoard,
    tonightsBestSpecials: rankedTopSpecialRows,
    countByMarketKey
  })

  return {
    filteredTopSpecials,
    typeAwareSpecials,
    specialsAudit,
    normalizedBestSpecialRows: rankedTopSpecialRows,
    specialtyLaneOutputs: {
      firstBasket: rankedFeaturedRows.filter((row) => isFirstBasket(row)).slice(0, laneSliceLimit),
      firstTeamBasket: rankedFeaturedRows.filter((row) => isFirstTeamBasket(row)).slice(0, laneSliceLimit),
      specials: rankedTopSpecialRows.slice(0, laneSliceLimit),
      featured: rankedFeaturedRows.slice(0, laneSliceLimit)
    }
  }
}

module.exports = {
  buildSpecialtyOutputs
}
