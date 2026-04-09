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

  const matchupCounts = countBy(safeRows, (row) => row?.matchup)
  const maxMatchupCount = Math.max(1, ...Object.values(matchupCounts))
  const bookStrength = getBookStrengthMap(safeRows)

  const scored = safeRows
    .map((row) => {
      const implied = impliedProbabilityFromAmerican(row?.odds)
      const impliedSignal = implied == null ? 0.1 : clamp((implied - 0.34) / 0.5, 0, 1)

      const odds = toNumberOrNull(row?.odds)
      const plusMoneySignal = Number.isFinite(odds)
        ? (odds > 0 ? clamp(1 - (odds / 900), 0.15, 0.9) : clamp(1 - (Math.abs(odds) / 380), 0.2, 0.85))
        : 0.35

      const shapeSignal = normalizeMarketShapeSignal(row)
      const bookSignal = bookStrength[toKey(row?.book, "unknown")] || 0.25
      const matchupSignal = clamp(1 - ((Number(matchupCounts[toKey(row?.matchup, "unknown")] || 1) - 1) / maxMatchupCount), 0.35, 1)

      const family = String(row?.marketFamily || "")
      const familyBonus =
        groupType === "specials" && family === "special" ? 0.14 :
        groupType === "game" && family === "game" ? 0.14 :
        groupType === "hitters" && row?.isPitcherMarket !== true ? 0.14 :
        groupType === "pitchers" && row?.isPitcherMarket === true ? 0.14 :
        0

      const score = Number((
        (impliedSignal * 0.34) +
        (plusMoneySignal * 0.18) +
        (shapeSignal * 0.19) +
        (bookSignal * 0.15) +
        (matchupSignal * 0.14) +
        familyBonus
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

  for (const candidate of scored) {
    const row = candidate.row
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue

    const matchup = toKey(row?.matchup, "unknown")
    const player = toKey(row?.player, "")
    const book = toKey(row?.book, "unknown")

    if (Number(perMatchup[matchup] || 0) >= 2) continue
    if (player && Number(perPlayer[player] || 0) >= 1) continue
    if (Number(perBook[book] || 0) >= 4) continue

    seen.add(key)
    perMatchup[matchup] = Number(perMatchup[matchup] || 0) + 1
    if (player) perPlayer[player] = Number(perPlayer[player] || 0) + 1
    perBook[book] = Number(perBook[book] || 0) + 1

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
  const bestPitchers = rankRows(pitcherRows, { groupType: "pitchers", maxRows: maxRowsPerGroup })
  const bestSpecials = rankRows(specialRows, { groupType: "specials", maxRows: maxRowsPerGroup })
  const bestGameMarkets = rankRows(gameRows, { groupType: "game", maxRows: maxRowsPerGroup })

  const bestOverall = rankRows(
    [
      ...hitterRows,
      ...pitcherRows,
      ...specialRows,
      ...gameRows
    ],
    { groupType: "overall", maxRows: maxRowsPerGroup }
  )

  return {
    bestHitters,
    bestPitchers,
    bestSpecials,
    bestGameMarkets,
    bestOverall,
    counts: {
      bestHitters: bestHitters.length,
      bestPitchers: bestPitchers.length,
      bestSpecials: bestSpecials.length,
      bestGameMarkets: bestGameMarkets.length,
      bestOverall: bestOverall.length
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
