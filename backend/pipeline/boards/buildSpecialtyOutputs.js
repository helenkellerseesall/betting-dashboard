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

function buildTypeAwareSpecialSlices(rows, limit = 4) {
  const safeRows = Array.isArray(rows) ? rows : []
  return {
    bestDoubleDoubles: safeRows.filter((row) => isDoubleDouble(row)).slice(0, limit),
    bestTripleDoubles: safeRows.filter((row) => isTripleDouble(row)).slice(0, limit),
    bestFirstBasket: safeRows.filter((row) => isFirstBasket(row)).slice(0, limit),
    bestFirstTeamBasket: safeRows.filter((row) => isFirstTeamBasket(row)).slice(0, limit)
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
  typeSliceLimit = 4,
  laneSliceLimit = 6
}) {
  const filteredTopSpecials = filterTopSpecialsForWeakness(tonightsBestSpecials)
  const typeAwareSpecials = buildTypeAwareSpecialSlices(specialBoard, typeSliceLimit)
  const specialsAudit = buildSpecialsAudit({
    specialBoard,
    firstBasketBoard,
    tonightsBestSpecials,
    countByMarketKey
  })

  const featuredRows = (Array.isArray(featuredPlays) ? featuredPlays : []).filter((row) => isSpecialLikeRow(row))

  return {
    filteredTopSpecials,
    typeAwareSpecials,
    specialsAudit,
    specialtyLaneOutputs: {
      firstBasket: featuredRows.filter((row) => isFirstBasket(row)).slice(0, laneSliceLimit),
      firstTeamBasket: featuredRows.filter((row) => isFirstTeamBasket(row)).slice(0, laneSliceLimit),
      specials: (Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : []).slice(0, laneSliceLimit),
      featured: featuredRows.slice(0, laneSliceLimit)
    }
  }
}

module.exports = {
  buildSpecialtyOutputs
}
