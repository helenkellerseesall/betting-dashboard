"use strict"

function toKey(value, fallback = "unknown") {
  const key = String(value == null ? "" : value).trim()
  return key || fallback
}

function countBy(rows, keyFn) {
  const bucket = {}
  const safeRows = Array.isArray(rows) ? rows : []
  for (const row of safeRows) {
    const key = toKey(keyFn(row))
    bucket[key] = Number(bucket[key] || 0) + 1
  }
  return bucket
}

function sortCountEntries(countMap, limit = 25) {
  return Object.entries(countMap || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Number(limit) || 25))
    .map(([key, count]) => ({ key, count }))
}

function compactMlbRow(row) {
  return {
    eventId: row?.eventId || null,
    matchup: row?.matchup || null,
    gameTime: row?.gameTime || null,
    book: row?.book || null,
    marketKey: row?.marketKey || null,
    marketFamily: row?.marketFamily || null,
    propType: row?.propType || null,
    player: row?.player || null,
    side: row?.side || null,
    line: row?.line,
    odds: row?.odds,
    isPitcherMarket: row?.isPitcherMarket === true,
    teamMatchesMatchup: row?.teamMatchesMatchup !== false
  }
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function impliedProbabilityFromAmerican(odds) {
  const n = toNumberOrNull(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 100 / (n + 100)
  return Math.abs(n) / (Math.abs(n) + 100)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeMarketShapeSignal(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)

  if (marketKey === "h2h") return 0.18
  if (marketKey === "spreads") {
    if (!Number.isFinite(line)) return 0.04
    if (Math.abs(line) <= 2.5) return 0.16
    if (Math.abs(line) <= 4.5) return 0.1
    return 0.02
  }
  if (marketKey === "totals") {
    if (!Number.isFinite(line)) return 0.04
    if (line >= 7 && line <= 10.5) return 0.15
    return 0.06
  }

  // For props, small half-line thresholds are generally more stable than long tails.
  if (!Number.isFinite(line)) return 0.03
  if (line <= 1.5) return 0.15
  if (line <= 2.5) return 0.11
  if (line <= 3.5) return 0.08
  return 0.04
}

function isAlternateMarketKey(marketKey) {
  const mk = String(marketKey || "").toLowerCase()
  return mk.includes("alternate") || mk.endsWith("_alt") || mk.endsWith("_alternate")
}

function toMarketBaseKey(marketKey) {
  const mk = String(marketKey || "").toLowerCase().trim()
  if (!mk) return ""
  return mk
    .replace(/_alternate$/g, "")
    .replace(/_alt$/g, "")
    .replace(/alternate/g, "")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function buildPrimaryMarketIndex(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const index = new Set()

  for (const row of safeRows) {
    const marketKey = String(row?.marketKey || "")
    const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"
    if (isAlt) continue

    const player = toKey(row?.player, "")
    const baseKey = toMarketBaseKey(marketKey)
    const side = toKey(row?.side, "")
    if (!player || !baseKey) continue

    index.add([player, baseKey, side].join("|"))
  }

  return index
}

function computeTrivialAlternatePenalty(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const side = String(row?.side || "").toLowerCase()
  const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"
  if (!isAlt || !Number.isFinite(line)) return 0

  if (marketKey.includes("batter_hits") && side === "over" && line <= 0.5) return 0.24
  if (marketKey.includes("total_bases") && side === "over" && line <= 1.5) return 0.16
  if (marketKey.includes("pitcher_strikeouts") && side === "over" && line <= 2.5) return 0.28
  if (marketKey.includes("pitcher_strikeouts") && side === "over" && line <= 3.5) return 0.18
  if (side === "over" && line <= 0.5) return 0.12

  return 0
}

function computeHeavyFavoritePenalty(odds) {
  const n = toNumberOrNull(odds)
  if (!Number.isFinite(n) || n >= 0) return 0

  const absOdds = Math.abs(n)
  if (absOdds <= 220) return 0
  if (absOdds <= 350) return 0.05
  if (absOdds <= 500) return 0.1
  if (absOdds <= 900) return 0.16
  return 0.22
}

function computeLowInformationPenalty(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const side = String(row?.side || "").toLowerCase()
  if (!Number.isFinite(line)) return 0

  if (side === "under" && line <= 0.5 && (marketKey.includes("rbis") || marketKey.includes("home_runs"))) {
    return 0.1
  }

  return 0
}

/**
 * Classify a row as "safe" (floor/stable) or "upside" (value/aggressive) or null.
 *
 * Safe:
 *   - Primary standard market (not alternate/ladder)
 *   - Implied probability 52-78% (roughly -110 to -255)
 *   - Odds no worse than -320, no wilder than +150
 *
 * Upside:
 *   - Implied probability 38-62% (roughly -163 to +163)
 *   - Odds between -165 and +380
 *   - Allows alternate/ladder at meaningful (non-trivial) lines
 *   - Also includes primary markets at even/slight-plus prices
 *
 * Hard excludes from both:
 *   - Odds worse than -600 or better than +500
 *   - Trivially easy alt-overs (batter_hits alt <=0.5, pitcher_strikeouts alt <=2.5, total_bases alt <=1.5)
 */
function classifyRowTier(row) {
  const odds = toNumberOrNull(row?.odds)
  if (!Number.isFinite(odds)) return null

  const implied = impliedProbabilityFromAmerican(odds)
  if (implied == null) return null

  const marketKey = String(row?.marketKey || "").toLowerCase()
  const family = String(row?.marketFamily || "")
  const isAlt = isAlternateMarketKey(marketKey) || family === "ladder"
  const line = toNumberOrNull(row?.line)
  const side = String(row?.side || "").toLowerCase()

  // Hard excludes: absurd chalk or absurd longshot
  if (odds < -600) return null
  if (odds > 500) return null

  // Hard exclude trivially easy alt-overs from both tiers
  if (isAlt && side === "over" && Number.isFinite(line)) {
    if (marketKey.includes("batter_hits") && line <= 0.5) return null
    if (marketKey.includes("pitcher_strikeouts") && line <= 2.5) return null
    if (marketKey.includes("total_bases") && line <= 1.5) return null
  }

  // Safe tier: primary standard market at moderate familiar price
  if (!isAlt && family === "standard") {
    const inSafePrice = odds >= -320 && odds <= 150
    const inSafeImplied = implied >= 0.52 && implied <= 0.78
    if (inSafePrice && inSafeImplied) return "safe"
  }

  // Upside tier: value-band pricing; allows alts at meaningful lines or primary at near-even/plus
  const inUpsidePrice = odds >= -165 && odds <= 380
  const inUpsideImplied = implied >= 0.38 && implied <= 0.62
  if (inUpsidePrice && inUpsideImplied) return "upside"

  return null
}

function buildBalancedOverallBoard({ bestHitters, bestPitchers, bestSpecials, bestGameMarkets, maxRows }) {
  const hitters = Array.isArray(bestHitters) ? bestHitters : []
  const pitchers = Array.isArray(bestPitchers) ? bestPitchers : []
  const specials = Array.isArray(bestSpecials) ? bestSpecials : []
  const games = Array.isArray(bestGameMarkets) ? bestGameMarkets : []
  const limit = Math.max(1, Number(maxRows) || 10)

  const minTargets = {
    hitters: Math.min(hitters.length, Math.max(1, Math.floor(limit * 0.25))),
    pitchers: Math.min(pitchers.length, Math.max(1, Math.floor(limit * 0.25))),
    games: Math.min(games.length, Math.max(1, Math.floor(limit * 0.16))),
    specials: Math.min(specials.length, Math.max(1, Math.floor(limit * 0.08)))
  }

  const out = []
  const seen = new Set()

  function pushUnique(rows, count) {
    if (!Array.isArray(rows) || count <= 0) return
    for (const row of rows) {
      if (count <= 0) break
      const key = buildCandidateKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
      count -= 1
      if (out.length >= limit) break
    }
  }

  pushUnique(hitters, minTargets.hitters)
  pushUnique(pitchers, minTargets.pitchers)
  pushUnique(games, minTargets.games)
  pushUnique(specials, minTargets.specials)

  const remainder = [...hitters, ...pitchers, ...games, ...specials]
    .sort((a, b) => Number(b?.surfaceScore || 0) - Number(a?.surfaceScore || 0))

  for (const row of remainder) {
    if (out.length >= limit) break
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out.slice(0, limit)
}

function getBookStrengthMap(rows) {
  const byBook = countBy(rows, (row) => row?.book)
  const maxCount = Math.max(1, ...Object.values(byBook))
  const out = {}
  for (const [book, count] of Object.entries(byBook)) {
    out[book] = clamp(Number(count || 0) / maxCount, 0.1, 1)
  }
  return out
}

function buildCandidateKey(row) {
  return [
    toKey(row?.player, ""),
    toKey(row?.marketKey, ""),
    toKey(row?.side, ""),
    String(row?.line ?? ""),
    toKey(row?.book, "")
  ].join("|")
}

function rankRows(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : 12
  const groupType = String(options.groupType || "")
  const perMarketKeyMax = Number.isFinite(options.perMarketKeyMax)
    ? Math.max(1, Number(options.perMarketKeyMax))
    : (
      groupType === "pitchers" ? 2 :
      groupType === "overall" ? 2 :
      groupType === "hitters" ? 3 :
      4
    )

  const matchupCounts = countBy(safeRows, (row) => row?.matchup)
  const maxMatchupCount = Math.max(1, ...Object.values(matchupCounts))
  const bookStrength = getBookStrengthMap(safeRows)
  const primaryMarketIndex = buildPrimaryMarketIndex(safeRows)

  const scored = safeRows
    .map((row) => {
      const implied = impliedProbabilityFromAmerican(row?.odds)
      const impliedSignal = implied == null ? 0.18 : clamp((implied - 0.44) / 0.32, 0, 1)
      const valueBandSignal = implied == null
        ? 0.3
        : clamp(1 - (Math.abs(implied - 0.58) / 0.28), 0, 1)

      const odds = toNumberOrNull(row?.odds)
      const priceModerationSignal = Number.isFinite(odds)
        ? (odds > 0
          ? clamp(1 - ((odds - 125) / 700), 0.2, 0.95)
          : clamp(1 - ((Math.abs(odds) - 150) / 500), 0, 0.95))
        : 0.3

      const shapeSignal = normalizeMarketShapeSignal(row)
      const bookSignal = bookStrength[toKey(row?.book, "unknown")] || 0.25
      const matchupSignal = clamp(1 - ((Number(matchupCounts[toKey(row?.matchup, "unknown")] || 1) - 1) / maxMatchupCount), 0.35, 1)

      const marketKey = String(row?.marketKey || "")
      const baseKey = toMarketBaseKey(marketKey)
      const player = toKey(row?.player, "")
      const side = toKey(row?.side, "")
      const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"
      const primaryMarketSignal = isAlt
        ? (primaryMarketIndex.has([player, baseKey, side].join("|")) ? 0.08 : 0.24)
        : 0.92

      const family = String(row?.marketFamily || "")
      const familyBonus =
        groupType === "specials" && family === "special" ? 0.14 :
        groupType === "game" && family === "game" ? 0.14 :
        groupType === "hitters" && row?.isPitcherMarket !== true ? 0.14 :
        groupType === "pitchers" && row?.isPitcherMarket === true ? 0.14 :
        0

      const trivialAltPenalty = computeTrivialAlternatePenalty(row)
      const heavyFavoritePenalty = computeHeavyFavoritePenalty(odds)
      const lowInformationPenalty = computeLowInformationPenalty(row)

      const score = Number((
        (impliedSignal * 0.2) +
        (valueBandSignal * 0.22) +
        (priceModerationSignal * 0.15) +
        (shapeSignal * 0.15) +
        (primaryMarketSignal * 0.16) +
        (bookSignal * 0.06) +
        (matchupSignal * 0.06) +
        familyBonus -
        trivialAltPenalty -
        heavyFavoritePenalty -
        lowInformationPenalty
      ).toFixed(4))

      return {
        row,
        surfaceScore: score
      }
    })
    .sort((a, b) => b.surfaceScore - a.surfaceScore)

  const deduped = []
  const seen = new Set()
  const perMatchup = {}
  const perPlayer = {}
  const perBook = {}
  const perMarketKey = {}

  for (const candidate of scored) {
    const row = candidate.row
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue

    const matchup = toKey(row?.matchup, "unknown")
    const player = toKey(row?.player, "")
    const book = toKey(row?.book, "unknown")
    const marketKey = toKey(row?.marketKey, "unknown")

    if (Number(perMatchup[matchup] || 0) >= 2) continue
    if (player && Number(perPlayer[player] || 0) >= 1) continue
    if (Number(perBook[book] || 0) >= (groupType === "overall" ? 3 : 4)) continue
    if (Number(perMarketKey[marketKey] || 0) >= perMarketKeyMax) continue

    seen.add(key)
    perMatchup[matchup] = Number(perMatchup[matchup] || 0) + 1
    if (player) perPlayer[player] = Number(perPlayer[player] || 0) + 1
    perBook[book] = Number(perBook[book] || 0) + 1
    perMarketKey[marketKey] = Number(perMarketKey[marketKey] || 0) + 1

    deduped.push({
      ...compactMlbRow(row),
      surfaceScore: candidate.surfaceScore
    })

    if (deduped.length >= maxRows) break
  }

  return deduped
}

function buildMlbSurfaceBoard(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRowsPerGroup = Number.isFinite(options.maxRowsPerGroup)
    ? Math.max(1, Number(options.maxRowsPerGroup))
    : 10

  const gameRows = safeRows.filter((row) => String(row?.marketFamily || "") === "game")
  const specialRows = safeRows.filter((row) => String(row?.marketFamily || "") === "special")
  const hitterRows = safeRows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return (family === "standard" || family === "ladder") && row?.isPitcherMarket !== true && String(row?.player || "").trim()
  })
  const pitcherRows = safeRows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return (family === "standard" || family === "ladder") && row?.isPitcherMarket === true && String(row?.player || "").trim()
  })

  const bestHitters = rankRows(hitterRows, { groupType: "hitters", maxRows: maxRowsPerGroup })
  const bestPitchers = rankRows(pitcherRows, { groupType: "pitchers", maxRows: maxRowsPerGroup, perMarketKeyMax: 2 })
  const bestSpecials = rankRows(specialRows, { groupType: "specials", maxRows: maxRowsPerGroup })
  const bestGameMarkets = rankRows(gameRows, { groupType: "game", maxRows: maxRowsPerGroup })

  const bestOverall = buildBalancedOverallBoard({
    bestHitters,
    bestPitchers,
    bestSpecials,
    bestGameMarkets,
    maxRows: maxRowsPerGroup
  })

  // --- Phase 5: safe / upside sub-tiers ---
  // Pre-filter each prop pool by tier before ranking so the resulting lists are
  // meaningfully distinct rather than just score-ordered sub-slices of the same pool.

  const safeHitterPool = hitterRows.filter((r) => classifyRowTier(r) === "safe")
  const upsideHitterPool = hitterRows.filter((r) => classifyRowTier(r) === "upside")
  const safePitcherPool = pitcherRows.filter((r) => classifyRowTier(r) === "safe")
  const upsidePitcherPool = pitcherRows.filter((r) => classifyRowTier(r) === "upside")

  const tierMax = Math.max(3, Math.round(maxRowsPerGroup * 0.65))

  const safeHitters = rankRows(safeHitterPool, { groupType: "hitters", maxRows: tierMax, perMarketKeyMax: 2 })
  const safePitchers = rankRows(safePitcherPool, { groupType: "pitchers", maxRows: tierMax, perMarketKeyMax: 2 })
  const upsideHitters = rankRows(upsideHitterPool, { groupType: "hitters", maxRows: tierMax, perMarketKeyMax: 2 })
  const upsidePitchers = rankRows(upsidePitcherPool, { groupType: "pitchers", maxRows: tierMax, perMarketKeyMax: 2 })

  // Separate safe/upside pools for specials and game lines used in the combined overall boards.
  const safeSpecialPool = specialRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= -250 && o <= 200
  })
  const upsideSpecialPool = specialRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= 100 && o <= 600
  })
  const safeGamePool = gameRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= -220 && o <= 120
  })
  const upsideGamePool = gameRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= -160 && o <= 280
  })

  const overallTierMax = Math.max(4, Math.round(maxRowsPerGroup * 0.7))

  const bestOverallSafe = buildBalancedOverallBoard({
    bestHitters: safeHitters,
    bestPitchers: safePitchers,
    bestSpecials: rankRows(safeSpecialPool, { groupType: "specials", maxRows: 3 }),
    bestGameMarkets: rankRows(safeGamePool, { groupType: "game", maxRows: 2 }),
    maxRows: overallTierMax
  })

  const bestOverallUpside = buildBalancedOverallBoard({
    bestHitters: upsideHitters,
    bestPitchers: upsidePitchers,
    bestSpecials: rankRows(upsideSpecialPool, { groupType: "specials", maxRows: 3 }),
    bestGameMarkets: rankRows(upsideGamePool, { groupType: "game", maxRows: 2 }),
    maxRows: overallTierMax
  })

  return {
    bestHitters,
    bestPitchers,
    bestSpecials,
    bestGameMarkets,
    bestOverall,
    safeHitters,
    safePitchers,
    upsideHitters,
    upsidePitchers,
    bestOverallSafe,
    bestOverallUpside,
    counts: {
      bestHitters: bestHitters.length,
      bestPitchers: bestPitchers.length,
      bestSpecials: bestSpecials.length,
      bestGameMarkets: bestGameMarkets.length,
      bestOverall: bestOverall.length,
      safeHitters: safeHitters.length,
      safePitchers: safePitchers.length,
      upsideHitters: upsideHitters.length,
      upsidePitchers: upsidePitchers.length,
      bestOverallSafe: bestOverallSafe.length,
      bestOverallUpside: bestOverallUpside.length
    }
  }
}

function buildGroupView(rows, sampleLimit) {
  const safeRows = Array.isArray(rows) ? rows : []
  return {
    count: safeRows.length,
    byBook: countBy(safeRows, (row) => row?.book),
    byMarketKey: countBy(safeRows, (row) => row?.marketKey),
    byMatchup: countBy(safeRows, (row) => row?.matchup),
    sampleRows: safeRows.slice(0, sampleLimit).map(compactMlbRow)
  }
}

function buildMlbInspectionBoard({ snapshot, sampleLimit = 10, topLimit = 20 }) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : []
  const surfaced = buildMlbSurfaceBoard(rows, { maxRowsPerGroup: sampleLimit })

  const gameRows = rows.filter((row) => String(row?.marketFamily || "") === "game")
  const specialRows = rows.filter((row) => String(row?.marketFamily || "") === "special")

  const standardOrLadderRows = rows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return family === "standard" || family === "ladder"
  })

  const hitterRows = standardOrLadderRows.filter((row) => row?.isPitcherMarket !== true)
  const pitcherRows = standardOrLadderRows.filter((row) => row?.isPitcherMarket === true)

  const otherRows = rows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return family !== "game" && family !== "special" && family !== "standard" && family !== "ladder"
  })

  const byMarketFamily = countBy(rows, (row) => row?.marketFamily)
  const byMarketKey = countBy(rows, (row) => row?.marketKey)
  const byBook = countBy(rows, (row) => row?.book)
  const byMatchup = countBy(rows, (row) => row?.matchup)

  return {
    counts: {
      events: Array.isArray(snapshot?.events) ? snapshot.events.length : 0,
      fetchedEventOdds: Array.isArray(snapshot?.rawOddsEvents) ? snapshot.rawOddsEvents.length : 0,
      rows: rows.length
    },
    diagnostics: {
      byMarketFamily,
      byMarketKey,
      byBook,
      byMatchup,
      topMarketKeys: sortCountEntries(byMarketKey, topLimit),
      topBooks: sortCountEntries(byBook, topLimit),
      topMatchups: sortCountEntries(byMatchup, topLimit)
    },
    groups: {
      gameMarkets: buildGroupView(gameRows, sampleLimit),
      specialMarkets: buildGroupView(specialRows, sampleLimit),
      hitterProps: buildGroupView(hitterRows, sampleLimit),
      pitcherProps: buildGroupView(pitcherRows, sampleLimit),
      otherMarkets: buildGroupView(otherRows, sampleLimit)
    },
    surfaced,
    sampleRows: rows.slice(0, sampleLimit).map(compactMlbRow)
  }
}

module.exports = {
  buildMlbInspectionBoard,
  compactMlbRow,
  buildMlbSurfaceBoard
}
