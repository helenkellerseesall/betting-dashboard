const { inferMarketTypeFromKey } = require("./classification")

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

function getSlipCandidateScore(row) {
  const hr = parseHitRateValue(row.hitRate)
  const edge = Number(row.edge || 0)
  const score = Number(row.score || 0)
  return (hr * 100) + (edge * 4) + (score * 0.35)
}

function dedupeMarketRows(rows) {
  const seen = new Set()
  return rows.filter((row) => {
    const key = [
      String(row?.player || ""),
      String(row?.propType || ""),
      String(row?.side || ""),
      String(row?.line ?? ""),
      String(row?.matchup || ""),
      String(row?.book || "")
    ].join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function summarizeInterestingNormalizedRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const byPropType = {}
  const byFamily = {}

  for (const row of safeRows) {
    const marketKey = String(row?.marketKey || "")
    const inferred = inferMarketTypeFromKey(marketKey)
    const propType = String(row?.propType || inferred.internalType || "Unknown")
    const family = String(inferred.family || "unknown")

    byPropType[propType] = (byPropType[propType] || 0) + 1
    byFamily[family] = (byFamily[family] || 0) + 1
  }

  return {
    totalRows: safeRows.length,
    byPropType,
    byFamily
  }
}

const STANDARD_CORE_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
const SPECIAL_PROP_TYPES = new Set(["First Basket", "First Team Basket", "Double Double", "Triple Double"])

function buildFinalPlayableRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const filtered = safeRows.filter(
    (row) =>
      row?.book === "DraftKings" &&
      row?.team &&
      row?.hitRate != null &&
      row?.edge != null &&
      row?.score != null &&
      row?.marketFamily === "standard" &&
      STANDARD_CORE_PROP_TYPES.has(row?.propType)
  )

  const deduped = dedupeMarketRows(filtered)
  deduped.sort((a, b) => getSlipCandidateScore(b) - getSlipCandidateScore(a))

  const perPlayer = new Map()
  const perMatchup = new Map()
  const finalRows = []

  for (const row of deduped) {
    const playerKey = String(row?.player || "")
    const matchupKey = String(row?.matchup || row?.eventId || "unknown")
    const playerCount = Number(perPlayer.get(playerKey) || 0)
    const matchupCount = Number(perMatchup.get(matchupKey) || 0)
    if (playerCount >= 2) continue
    if (matchupCount >= 4) continue

    finalRows.push(row)
    perPlayer.set(playerKey, playerCount + 1)
    perMatchup.set(matchupKey, matchupCount + 1)
    if (finalRows.length >= 40) break
  }

  return finalRows
}

function buildExpandedMarketPools(snapshot) {
  const playable = Array.isArray(snapshot?.playableProps) ? snapshot.playableProps : []
  const strong = Array.isArray(snapshot?.strongProps) ? snapshot.strongProps : []
  const elite = Array.isArray(snapshot?.eliteProps) ? snapshot.eliteProps : []
  const best = Array.isArray(snapshot?.bestProps) ? snapshot.bestProps : []

  const rawProps =
    Array.isArray(snapshot?.rawProps) && snapshot.rawProps.length > 0
      ? snapshot.rawProps
      : Array.isArray(snapshot?.props) && snapshot.props.length > 0
        ? snapshot.props
        : []

  console.log("[EXPANDED-RAW-SOURCE-DEBUG]", {
    rawPropsCount: Array.isArray(snapshot?.rawProps) ? snapshot.rawProps.length : 0,
    propsCount: Array.isArray(snapshot?.props) ? snapshot.props.length : 0,
    chosenRawCount: rawProps.length
  })

  const metricSeedRows = dedupeMarketRows([
    ...(Array.isArray(snapshot?.props) ? snapshot.props : []),
    ...playable,
    ...strong,
    ...elite,
    ...best
  ])

  const metricSeedByPlayer = new Map()
  for (const row of metricSeedRows) {
    const key = [
      String(row?.player || ""),
      String(row?.matchup || ""),
      String(row?.book || "")
    ].join("|")
    if (!metricSeedByPlayer.has(key)) metricSeedByPlayer.set(key, row)
  }

  const enrichedRawProps = rawProps.map((row) => {
    const inferred = inferMarketTypeFromKey(row?.marketKey)
    const seedKey = [
      String(row?.player || ""),
      String(row?.matchup || ""),
      String(row?.book || "")
    ].join("|")
    const seed = metricSeedByPlayer.get(seedKey) || null

    return {
      ...row,
      marketFamily: row?.marketFamily || inferred.family,
      propType: row?.propType || inferred.internalType || row?.propType,
      team: row?.team || row?.resolvedTeamCode || seed?.team || seed?.resolvedTeamCode,
      resolvedTeamCode: row?.resolvedTeamCode || seed?.resolvedTeamCode || row?.team || seed?.team,
      hitRate: row?.hitRate != null ? row.hitRate : seed?.hitRate,
      edge: row?.edge != null ? row.edge : seed?.edge,
      score: row?.score != null ? row.score : seed?.score,
      minutesRisk: row?.minutesRisk || seed?.minutesRisk,
      trendRisk: row?.trendRisk || seed?.trendRisk,
      injuryRisk: row?.injuryRisk || seed?.injuryRisk,
      avgMin: row?.avgMin != null ? row.avgMin : seed?.avgMin,
      matchup: row?.matchup || seed?.matchup,
      gameTime: row?.gameTime || seed?.gameTime,
      awayTeam: row?.awayTeam || seed?.awayTeam,
      homeTeam: row?.homeTeam || seed?.homeTeam
    }
  })

  const rows = dedupeMarketRows([
    ...playable,
    ...strong,
    ...elite,
    ...best
  ])

  console.log("[EXPANDED-MARKET-POOL-SOURCE-DEBUG]", {
    playable: playable.length,
    strong: strong.length,
    elite: elite.length,
    best: best.length,
    mergedRows: rows.length,
    sample: rows.slice(0, 10).map((row) => ({
      player: row?.player,
      propType: row?.propType,
      marketKey: row?.marketKey,
      marketFamily: row?.marketFamily,
      hitRate: row?.hitRate,
      edge: row?.edge,
      score: row?.score
    }))
  })

  const fullRows = dedupeMarketRows([
    ...(Array.isArray(snapshot?.props) ? snapshot.props : []),
    ...(Array.isArray(snapshot?.playableProps) ? snapshot.playableProps : []),
    ...(Array.isArray(snapshot?.strongProps) ? snapshot.strongProps : []),
    ...(Array.isArray(snapshot?.eliteProps) ? snapshot.eliteProps : []),
    ...(Array.isArray(snapshot?.bestProps) ? snapshot.bestProps : []),
    ...enrichedRawProps
  ])

  console.log("[EXPANDED-MARKET-FULL-SOURCE-DEBUG]", {
    fullRows: fullRows.length,
    rawProps: rawProps.length,
    enrichedRawProps: enrichedRawProps.length,
    byFamily: summarizeInterestingNormalizedRows(fullRows).byFamily,
    byPropType: summarizeInterestingNormalizedRows(fullRows).byPropType
  })

  console.log("[EXPANDED-MARKET-MARKETKEY-DEBUG]", {
    sampleMarketKeys: [...new Set(fullRows.map((row) => String(row?.marketKey || "")).filter(Boolean))].slice(0, 80),
    ladderLikeCount: fullRows.filter((row) => {
      const mk = String(row?.marketKey || "").toLowerCase()
      const propType = String(row?.propType || "")
      return (
        row?.book === "DraftKings" && (
          row?.marketFamily === "ladder" ||
          propType.includes("Ladder") ||
          mk.includes("alternate") ||
          mk.includes("alt") ||
          mk.includes("first_basket") ||
          mk.includes("first basket") ||
          mk.includes("first_team_basket") ||
          mk.includes("double_double") ||
          mk.includes("triple_double")
        )
      )
    }).length
    ,interestingRawMarketKeys: [...new Set(enrichedRawProps
      .map((row) => String(row?.marketKey || ""))
      .filter((key) => /alternate|first_basket|first_team_basket|double_double|triple_double|first scorer/i.test(key))
    )].slice(0, 80)
  })

  const standardRaw = rows.filter(
    (row) =>
      row?.book === "DraftKings" &&
      row?.team &&
      row?.hitRate != null &&
      row?.edge != null &&
      row?.score != null &&
      row?.marketFamily === "standard" &&
      STANDARD_CORE_PROP_TYPES.has(row?.propType)
  )
  const standardCandidates = dedupeMarketRows(standardRaw)
  standardCandidates.sort((a, b) => getSlipCandidateScore(b) - getSlipCandidateScore(a))
  const standardTop = standardCandidates.slice(0, 30)

  const ladderRaw = fullRows.filter((row) => {
    if (row?.book !== "DraftKings") return false

    const mk = String(row?.marketKey || "").toLowerCase()
    const propType = String(row?.propType || "")

    // MUCH more aggressive ladder detection
    const isAltMarket =
      mk.includes("alternate") ||
      mk.includes("alt") ||
      mk.includes("over_") ||
      mk.includes("_over") ||
      mk.includes("+") // catches 20+, 25+, etc

    const isLadderType =
      row?.marketFamily === "ladder" ||
      propType.includes("Ladder")

    return row?.team && row?.hitRate != null && row?.edge != null && row?.score != null && (isAltMarket || isLadderType)
  })
  const ladderDeduped = dedupeMarketRows(ladderRaw)
  ladderDeduped.sort((a, b) => {
    const scoreDiff = Number(b?.score || 0) - Number(a?.score || 0)
    if (scoreDiff !== 0) return scoreDiff
    return Number(b?.edge || 0) - Number(a?.edge || 0)
  })
  const ladderCandidates = ladderDeduped.slice(0, 60)

  const specialRaw = fullRows.filter((row) => {
    if (row?.book !== "DraftKings") return false

    const mk = String(row?.marketKey || "").toLowerCase()

    return (
      row?.team &&
      row?.hitRate != null &&
      row?.edge != null &&
      row?.score != null && (
        mk.includes("first_basket") ||
        mk.includes("first basket") ||
        mk.includes("first_team_basket") ||
        mk.includes("double_double") ||
        mk.includes("triple_double") ||
        mk.includes("double double") ||
        mk.includes("triple double") ||
        mk.includes("first scorer")
      )
    )
  })
  const specialDeduped = dedupeMarketRows(specialRaw)
  specialDeduped.sort((a, b) => {
    const scoreDiff = Number(b?.score || 0) - Number(a?.score || 0)
    if (scoreDiff !== 0) return scoreDiff
    return Number(b?.edge || 0) - Number(a?.edge || 0)
  })
  const specialProps = specialDeduped.slice(0, 40)

  console.log("[EXPANDED-POOL-RESULT-DEBUG]", {
    standardCount: standardCandidates.length,
    ladderCount: ladderCandidates.length,
    specialCount: specialProps.length,
    ladderSample: ladderCandidates.slice(0, 10).map((row) => ({
      player: row?.player,
      propType: row?.propType,
      marketKey: row?.marketKey,
      matchup: row?.matchup,
      line: row?.line
    })),
    specialSample: specialProps.slice(0, 10).map((row) => ({
      player: row?.player,
      propType: row?.propType,
      marketKey: row?.marketKey,
      matchup: row?.matchup,
      line: row?.line
    }))
  })

  return { standardCandidates: standardTop, ladderCandidates, specialProps }
}

module.exports = {
  buildExpandedMarketPools,
  buildFinalPlayableRows
}
