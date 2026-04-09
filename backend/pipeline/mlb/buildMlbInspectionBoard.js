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
    sampleRows: rows.slice(0, sampleLimit).map(compactMlbRow)
  }
}

module.exports = {
  buildMlbInspectionBoard,
  compactMlbRow
}
