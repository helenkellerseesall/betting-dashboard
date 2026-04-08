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

  const filteredTopSpecials = filterTopSpecialsForWeakness(normalizedTopSpecialRows)
  const typeAwareSpecials = buildTypeAwareSpecialSlices(normalizedSpecialBoard, typeSliceLimit)
  const specialsAudit = buildSpecialsAudit({
    specialBoard: normalizedSpecialBoard,
    firstBasketBoard,
    tonightsBestSpecials: normalizedTopSpecialRows,
    countByMarketKey
  })

  return {
    filteredTopSpecials,
    typeAwareSpecials,
    specialsAudit,
    normalizedBestSpecialRows: normalizedTopSpecialRows,
    specialtyLaneOutputs: {
      firstBasket: normalizedFeaturedRows.filter((row) => isFirstBasket(row)).slice(0, laneSliceLimit),
      firstTeamBasket: normalizedFeaturedRows.filter((row) => isFirstTeamBasket(row)).slice(0, laneSliceLimit),
      specials: normalizedTopSpecialRows.slice(0, laneSliceLimit),
      featured: normalizedFeaturedRows.slice(0, laneSliceLimit)
    }
  }
}

module.exports = {
  buildSpecialtyOutputs
}
