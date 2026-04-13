"use strict"

const axios = require("axios")

const { getSportConfig } = require("../sports/sportConfig")
const { buildMlbSlateEvents } = require("../schedule/buildMlbSlateEvents")
const {
  inferMlbMarketTypeFromKey,
  isMlbPitcherMarketKey
} = require("../markets/mlbClassification")
const { mlbRowTeamMatchesMatchup } = require("../resolution/mlbTeamResolution")
const {
  createEmptyMlbExternalSnapshot,
  normalizeMlbExternalSnapshotShape
} = require("./enrichment/buildMlbExternalSnapshotScaffold")
const { enrichMlbRowsWithExternalContext } = require("./enrichment/mergeMlbExternalContext")
const { fetchMlbExternalSnapshot } = require("./external/fetchMlbExternalSnapshot")

function createEmptyMlbSnapshot() {
  return {
    sport: "mlb",
    updatedAt: null,
    snapshotGeneratedAt: null,
    snapshotSlateDateKey: null,
    events: [],
    rawOddsEvents: [],
    rows: [],
    externalSnapshotMeta: createEmptyMlbExternalSnapshot().diagnostics,
    diagnostics: {
      requestedEventCount: 0,
      fetchedEventCount: 0,
      failedEventCount: 0,
      totalBookmakersSeen: 0,
      totalMarketsSeen: 0,
      totalOutcomesSeen: 0,
      byBook: {},
      byMarketKey: {},
      byMarketFamily: {},
      enrichmentCoverage: {
        totals: {
          totalRows: 0,
          playerRows: 0,
          matchedRows: 0,
          unresolvedRows: 0,
          lowConfidenceRows: 0,
          overallMatchRate: 0
        },
        byMarketFamily: {},
        unresolvedSamples: [],
        lowConfidenceSamples: []
      },
      failedEvents: []
    }
  }
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeSide(outcomeName) {
  const normalized = String(outcomeName || "").trim().toLowerCase()
  if (normalized === "over") return "Over"
  if (normalized === "under") return "Under"
  if (normalized === "yes") return "Yes"
  if (normalized === "no") return "No"
  return null
}

function resolvePlayerName(outcome, normalizedSide) {
  const description = String(outcome?.description || "").trim()
  if (description) return description

  const participant = String(outcome?.participant || "").trim()
  if (participant) return participant

  const name = String(outcome?.name || "").trim()
  if (!name) return ""
  if (normalizedSide && name.toLowerCase() === normalizedSide.toLowerCase()) return ""
  return name
}

function buildRowOutcomeName(outcome) {
  const name = String(outcome?.name || "").trim()
  const description = String(outcome?.description || "").trim()
  if (description && name) return `${description} ${name}`.trim()
  return description || name || ""
}

function normalizeMlbEventRows({ event, oddsPayload, observedAtIso }) {
  const bookmakers = Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers : []
  const matchup = String(event?.matchup || `${event?.away_team || event?.awayTeam || ""} @ ${event?.home_team || event?.homeTeam || ""}`).trim()

  const rows = []
  const counters = {
    bookmakers: bookmakers.length,
    markets: 0,
    outcomes: 0
  }

  for (const bookmaker of bookmakers) {
    const book = String(bookmaker?.title || bookmaker?.key || "Unknown")
    const markets = Array.isArray(bookmaker?.markets) ? bookmaker.markets : []

    for (const market of markets) {
      counters.markets += 1

      const marketKey = String(market?.key || market?.name || "").trim()
      const inferredBase = inferMlbMarketTypeFromKey(marketKey)
      let inferred = inferredBase
      // Defensive runtime fallback for common game lines seen in bootstrap fallbacks.
      if (String(inferredBase?.family || "") === "unknown") {
        const mk = marketKey.toLowerCase()
        if (mk === "h2h" || mk.includes("moneyline")) {
          inferred = { internalType: "Moneyline", family: "game" }
        } else if (mk === "spreads" || mk.includes("run line") || mk.includes("runline")) {
          inferred = { internalType: "Run Line", family: "game" }
        } else if (mk === "totals" || mk.includes("total runs") || mk.includes("game total")) {
          inferred = { internalType: "Game Total", family: "game" }
        }
      }
      const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : []

      for (const outcome of outcomes) {
        counters.outcomes += 1

        const side = normalizeSide(outcome?.name)
        const player = resolvePlayerName(outcome, side)
        const row = {
          sport: "mlb",
          source: "odds-api-v4",
          fetchedAt: observedAtIso,

          eventId: String(event?.eventId || event?.id || ""),
          gameTime: event?.gameTime || event?.commence_time || null,
          matchup,
          awayTeam: event?.awayTeam || event?.away_team || "",
          homeTeam: event?.homeTeam || event?.home_team || "",

          book,
          marketKey,
          marketFamily: inferred.family,
          propType: inferred.internalType || null,
          marketName: String(market?.name || marketKey || "").trim() || null,

          player,
          team: null,
          side,
          line: toNumberOrNull(outcome?.point),
          odds: toNumberOrNull(outcome?.price),
          outcomeName: buildRowOutcomeName(outcome),

          isPitcherMarket: isMlbPitcherMarketKey(marketKey)
        }

        row.teamMatchesMatchup = mlbRowTeamMatchesMatchup(row)
        rows.push(row)
      }
    }
  }

  return {
    rows,
    counters
  }
}

function buildMlbRowKey(row) {
  return [
    String(row?.eventId || ""),
    String(row?.book || ""),
    String(row?.marketKey || ""),
    String(row?.player || ""),
    String(row?.side || ""),
    String(row?.line ?? ""),
    String(row?.odds ?? ""),
    String(row?.outcomeName || "")
  ].join("|")
}

function dedupeMlbRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const out = []
  for (const row of safeRows) {
    const key = buildMlbRowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function payloadHasMarketKey(payload, marketKey) {
  const target = String(marketKey || "").trim().toLowerCase()
  if (!target) return false
  const bookmakers = Array.isArray(payload?.bookmakers) ? payload.bookmakers : []
  for (const bookmaker of bookmakers) {
    const markets = Array.isArray(bookmaker?.markets) ? bookmaker.markets : []
    for (const market of markets) {
      const key = String(market?.key || market?.name || "").trim().toLowerCase()
      if (key === target) return true
    }
  }
  return false
}

function payloadHasAnyMarketKey(payload, marketKeys) {
  const safeMarketKeys = Array.isArray(marketKeys) ? marketKeys : []
  for (const key of safeMarketKeys) {
    if (payloadHasMarketKey(payload, key)) return true
  }
  return false
}

const ANYTIME_HOME_RUN_MARKET_KEYS = [
  "batter_home_runs",
  "player_home_runs",
  "anytime_home_run",
  "to_hit_home_run",
  "home_runs"
]

function addCount(bucket, key) {
  const normalizedKey = String(key || "Unknown")
  bucket[normalizedKey] = Number(bucket[normalizedKey] || 0) + 1
}

function summarizeRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const summary = {
    byBook: {},
    byMarketKey: {},
    byMarketFamily: {}
  }

  for (const row of safeRows) {
    addCount(summary.byBook, row?.book)
    addCount(summary.byMarketKey, row?.marketKey)
    addCount(summary.byMarketFamily, row?.marketFamily)
  }

  return summary
}

function extractOddsPayload(rawResponseData, eventId) {
  const data = rawResponseData

  // Common shape for event odds endpoint.
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.bookmakers)) {
    return data
  }

  // Some clients/providers can wrap payload under `data`.
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data.data &&
    typeof data.data === "object" &&
    Array.isArray(data.data.bookmakers)
  ) {
    return data.data
  }

  // Fallback: array payload. Use matching event if present, else first row with bookmakers.
  if (Array.isArray(data)) {
    const id = String(eventId || "")
    const byId = data.find((row) => {
      const rowId = String(row?.id || row?.eventId || "")
      return id && rowId === id
    })
    if (byId && Array.isArray(byId?.bookmakers)) return byId

    const firstWithBooks = data.find((row) => Array.isArray(row?.bookmakers))
    if (firstWithBooks) return firstWithBooks
  }

  return {}
}

function describePayloadShape(rawResponseData, normalizedPayload) {
  const raw = rawResponseData
  const normalized = normalizedPayload
  return {
    rawType: Array.isArray(raw) ? "array" : typeof raw,
    rawKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw).slice(0, 20) : [],
    rawArrayLength: Array.isArray(raw) ? raw.length : null,
    normalizedBookmakersCount: Array.isArray(normalized?.bookmakers) ? normalized.bookmakers.length : 0,
    normalizedKeys: normalized && typeof normalized === "object" ? Object.keys(normalized).slice(0, 20) : []
  }
}

async function fetchMlbEventOdds({ oddsApiKey, eventId, bookmakersCsv, marketsCsv }) {
  const endpoint = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`

  const params = {
    apiKey: oddsApiKey,
    regions: "us",
    oddsFormat: "american"
  }

  if (bookmakersCsv) params.bookmakers = bookmakersCsv
  if (marketsCsv) params.markets = marketsCsv

  return axios.get(endpoint, {
    params,
    timeout: 15000
  })
}

function parseInvalidMarketsFromError(error) {
  const data = error?.response?.data
  const message = String(data?.message || "")
  if (!message.toLowerCase().includes("invalid markets:")) return []

  const invalidPortion = message.split(":").slice(1).join(":")
  if (!invalidPortion) return []

  return invalidPortion
    .split(",")
    .map((v) => String(v || "").trim())
    .filter(Boolean)
}

function normalizeMarketList(values) {
  const safeValues = Array.isArray(values) ? values : []
  return [...new Set(safeValues.map((v) => String(v || "").trim()).filter(Boolean))]
}

function buildMarketRequestList(mlbConfig) {
  const base = Array.isArray(mlbConfig?.baseMarkets) ? mlbConfig.baseMarkets : []
  const extra = Array.isArray(mlbConfig?.extraMarkets) ? mlbConfig.extraMarkets : []
  const merged = normalizeMarketList([...base, ...extra])

  if (merged.length > 0) return merged

  // Safety fallback in case config is missing.
  return [
    "player_hits",
    "player_total_bases",
    "player_home_runs",
    "player_strikeouts",
    "player_pitcher_strikeouts"
  ]
}

async function buildMlbBootstrapSnapshot({ oddsApiKey, now = Date.now(), externalSnapshot = null, externalSourceName = null }) {
  const mlbConfig = getSportConfig("mlb")
  if (!mlbConfig) {
    throw new Error("MLB sport config missing")
  }

  const bookmakersCsv = (Array.isArray(mlbConfig.activeBooks) ? mlbConfig.activeBooks : ["DraftKings", "FanDuel"])
    .map((book) => String(book || "").toLowerCase())
    .join(",")

  const marketRequestList = buildMarketRequestList(mlbConfig)
  const marketsCsv = marketRequestList.join(",")

  const observedAtIso = new Date(now).toISOString()
  const { slateDateKey, allEvents, scheduledEvents } = await buildMlbSlateEvents({
    oddsApiKey,
    now
  })
  const allEventsSafe = Array.isArray(allEvents) ? allEvents : []
  const scheduledEventsSafe = Array.isArray(scheduledEvents) ? scheduledEvents : []
  const scheduledEventIds = new Set(
    scheduledEventsSafe
      .map((event) => String(event?.eventId || event?.id || "").trim())
      .filter(Boolean)
  )
  const outOfSlateEventsSample = allEventsSafe
    .filter((event) => {
      const eventId = String(event?.eventId || event?.id || "").trim()
      return eventId && !scheduledEventIds.has(eventId)
    })
    .slice(0, 8)
    .map((event) => ({
      eventId: String(event?.eventId || event?.id || "").trim() || null,
      matchup: event?.matchup || null,
      commenceTime: event?.commence_time || event?.gameTime || null,
      detroitDateKey: event?.detroitDateKey || null
    }))

  const rows = []
  const rawOddsEvents = []
  const failedEvents = []
  const invalidMarketsDetected = new Set()
  const fallbackRetryEvents = []
  const emptyBookmakerFallbackEvents = []
  const supplementalAnytimeHomeRunFetchEvents = []
  const supplementalSpecialFetchEvents = []
  const payloadShapes = []

  let totalBookmakersSeen = 0
  let totalMarketsSeen = 0
  let totalOutcomesSeen = 0

  // Sequential fetch is safer for initial bootstrap and easier on API limits.
  for (const event of scheduledEventsSafe) {
    const eventId = String(event?.eventId || event?.id || "")
    if (!eventId) continue

    try {
      let response
      let marketsUsed = marketRequestList

      try {
        response = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          bookmakersCsv,
          marketsCsv
        })
      } catch (error) {
        const invalidMarkets = parseInvalidMarketsFromError(error)
        if (!invalidMarkets.length) throw error

        for (const invalidMarket of invalidMarkets) {
          invalidMarketsDetected.add(invalidMarket)
        }

        const invalidSet = new Set(invalidMarkets)
        const fallbackMarkets = normalizeMarketList(
          marketRequestList.filter((market) => !invalidSet.has(market))
        )

        if (!fallbackMarkets.length) throw error

        marketsUsed = fallbackMarkets
        response = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          bookmakersCsv,
          marketsCsv: fallbackMarkets.join(",")
        })

        fallbackRetryEvents.push({
          eventId,
          matchup: event?.matchup || null,
          removedInvalidMarkets: invalidMarkets,
          fallbackMarketsUsed: fallbackMarkets
        })
      }

      let oddsPayload = extractOddsPayload(response?.data, eventId)

      // If request succeeded but yielded no bookmaker payload, broaden the query
      // so bootstrap can still materialize inspectable MLB rows.
      const initialBookmakerCount = Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers.length : 0
      if (initialBookmakerCount === 0) {
        const fallbackAttempts = []

        const noBookFilterResponse = await fetchMlbEventOdds({
          oddsApiKey,
          eventId,
          marketsCsv: Array.isArray(marketsUsed) && marketsUsed.length ? marketsUsed.join(",") : null
        })
        let noBookFilterPayload = extractOddsPayload(noBookFilterResponse?.data, eventId)
        let noBookFilterCount = Array.isArray(noBookFilterPayload?.bookmakers) ? noBookFilterPayload.bookmakers.length : 0
        fallbackAttempts.push({ type: "all-books-same-markets", bookmakers: noBookFilterCount })

        if (noBookFilterCount === 0) {
          const broadMarketResponse = await fetchMlbEventOdds({
            oddsApiKey,
            eventId,
            marketsCsv: "h2h,spreads,totals"
          })
          noBookFilterPayload = extractOddsPayload(broadMarketResponse?.data, eventId)
          noBookFilterCount = Array.isArray(noBookFilterPayload?.bookmakers) ? noBookFilterPayload.bookmakers.length : 0
          fallbackAttempts.push({ type: "all-books-broad-markets", bookmakers: noBookFilterCount })
        }

        if (noBookFilterCount > 0) {
          oddsPayload = noBookFilterPayload
        }

        emptyBookmakerFallbackEvents.push({
          eventId,
          matchup: event?.matchup || null,
          initialBookmakers: initialBookmakerCount,
          finalBookmakers: noBookFilterCount,
          attempts: fallbackAttempts
        })
      }

      const payloadShape = describePayloadShape(response?.data, oddsPayload)
      payloadShapes.push({ eventId, source: "primary", ...payloadShape })

      const payloadsForNormalization = [oddsPayload]

      // Preserve true anytime-HR availability even when configured books are sparse.
      // We supplement with all-books anytime-HR if primary payload does not contain it.
      if (!payloadHasAnyMarketKey(oddsPayload, ANYTIME_HOME_RUN_MARKET_KEYS)) {
        try {
          const supplementalAnytimeResponse = await fetchMlbEventOdds({
            oddsApiKey,
            eventId,
            marketsCsv: "batter_home_runs"
          })
          const supplementalAnytimePayload = extractOddsPayload(supplementalAnytimeResponse?.data, eventId)
          const supplementalAnytimeBookCount = Array.isArray(supplementalAnytimePayload?.bookmakers)
            ? supplementalAnytimePayload.bookmakers.length
            : 0

          if (supplementalAnytimeBookCount > 0 && payloadHasAnyMarketKey(supplementalAnytimePayload, ANYTIME_HOME_RUN_MARKET_KEYS)) {
            payloadsForNormalization.push(supplementalAnytimePayload)
            payloadShapes.push({
              eventId,
              source: "supplemental-anytime-hr",
              ...describePayloadShape(supplementalAnytimeResponse?.data, supplementalAnytimePayload)
            })
            supplementalAnytimeHomeRunFetchEvents.push({
              eventId,
              matchup: event?.matchup || null,
              bookmakers: supplementalAnytimeBookCount,
              market: "batter_home_runs",
              added: true
            })
          }
        } catch (_) {
          // Non-fatal: true HR supplemental is additive for inspection/surfacing only.
        }
      }

      // Preserve a special lane even when configured books focus on standard props.
      // We supplement with all-books first-home-run if primary payload does not contain it.
      if (!payloadHasMarketKey(oddsPayload, "batter_first_home_run")) {
        try {
          const supplementalResponse = await fetchMlbEventOdds({
            oddsApiKey,
            eventId,
            marketsCsv: "batter_first_home_run"
          })
          const supplementalPayload = extractOddsPayload(supplementalResponse?.data, eventId)
          const supplementalBookCount = Array.isArray(supplementalPayload?.bookmakers)
            ? supplementalPayload.bookmakers.length
            : 0
          if (supplementalBookCount > 0) {
            payloadsForNormalization.push(supplementalPayload)
            payloadShapes.push({
              eventId,
              source: "supplemental-special",
              ...describePayloadShape(supplementalResponse?.data, supplementalPayload)
            })
            supplementalSpecialFetchEvents.push({
              eventId,
              matchup: event?.matchup || null,
              bookmakers: supplementalBookCount,
              market: "batter_first_home_run",
              added: true
            })
          }
        } catch (_) {
          // Non-fatal: special market is additive for inspection only.
        }
      }

      rawOddsEvents.push({
        eventId,
        awayTeam: event?.awayTeam || event?.away_team || "",
        homeTeam: event?.homeTeam || event?.home_team || "",
        commenceTime: event?.commence_time || event?.gameTime || null,
        bookmakers: Array.isArray(oddsPayload?.bookmakers) ? oddsPayload.bookmakers.length : 0,
        marketsRequested: marketsUsed,
        payloadShape
      })

      const eventRowsMerged = []
      let eventBookmakersSeen = 0
      let eventMarketsSeen = 0
      let eventOutcomesSeen = 0

      for (const payloadForNormalization of payloadsForNormalization) {
        const normalized = normalizeMlbEventRows({
          event,
          oddsPayload: payloadForNormalization,
          observedAtIso
        })
        eventRowsMerged.push(...(Array.isArray(normalized?.rows) ? normalized.rows : []))
        eventBookmakersSeen += Number(normalized?.counters?.bookmakers || 0)
        eventMarketsSeen += Number(normalized?.counters?.markets || 0)
        eventOutcomesSeen += Number(normalized?.counters?.outcomes || 0)
      }

      const eventRows = dedupeMlbRows(eventRowsMerged)
      rows.push(...eventRows)

      totalBookmakersSeen += eventBookmakersSeen
      totalMarketsSeen += eventMarketsSeen
      totalOutcomesSeen += eventOutcomesSeen
    } catch (error) {
      failedEvents.push({
        eventId,
        matchup: event?.matchup || null,
        error: error?.response?.data || error?.message || "Unknown error"
      })
    }
  }

  let resolvedExternalSnapshot
  if (externalSnapshot && typeof externalSnapshot === "object") {
    resolvedExternalSnapshot = normalizeMlbExternalSnapshotShape(externalSnapshot, { now })
  } else {
    resolvedExternalSnapshot = await fetchMlbExternalSnapshot({
      events: scheduledEvents,
      now,
      sourceName: externalSourceName,
      sourceOptions: {
        ...(mlbConfig?.externalData && typeof mlbConfig.externalData === "object"
          ? mlbConfig.externalData
          : {})
      }
    })
  }

  const normalizedExternalSnapshot = normalizeMlbExternalSnapshotShape(
    resolvedExternalSnapshot || createEmptyMlbExternalSnapshot({ now }),
    { now }
  )

  const enrichmentResult = enrichMlbRowsWithExternalContext({
    rows,
    externalSnapshot: normalizedExternalSnapshot
  })

  const enrichedRows = Array.isArray(enrichmentResult?.rows) ? enrichmentResult.rows : []
  const summary = summarizeRows(enrichedRows)

  return {
    sport: "mlb",
    updatedAt: observedAtIso,
    snapshotGeneratedAt: observedAtIso,
    snapshotSlateDateKey: slateDateKey,
    events: scheduledEventsSafe,
    rawOddsEvents,
    rows: enrichedRows,
    externalSnapshotMeta: enrichmentResult?.externalSnapshotMeta || {
      generatedAt: normalizedExternalSnapshot.generatedAt,
      source: normalizedExternalSnapshot.source,
      version: normalizedExternalSnapshot.version,
      hasExternalData: normalizedExternalSnapshot?.diagnostics?.hasExternalData === true,
      playerKeyCount: Number(normalizedExternalSnapshot?.diagnostics?.playerKeyCount || 0),
      eventContextCount: Number(normalizedExternalSnapshot?.diagnostics?.eventContextCount || 0),
      playersByEventCount: Number(normalizedExternalSnapshot?.diagnostics?.playersByEventCount || 0)
    },
    diagnostics: {
      totalDiscoveredEventCount: allEventsSafe.length,
      requestedEventCount: scheduledEventsSafe.length,
      fetchedEventCount: rawOddsEvents.length,
      failedEventCount: failedEvents.length,
      outOfSlateEventCount: Math.max(allEventsSafe.length - scheduledEventsSafe.length, 0),
      outOfSlateEventsSample,
      totalBookmakersSeen,
      totalMarketsSeen,
      totalOutcomesSeen,
      byBook: summary.byBook,
      byMarketKey: summary.byMarketKey,
      byMarketFamily: summary.byMarketFamily,
      marketRequestList,
      invalidMarketsDetected: [...invalidMarketsDetected],
      fallbackRetryEventCount: fallbackRetryEvents.length,
      fallbackRetryEvents,
      emptyBookmakerFallbackEventCount: emptyBookmakerFallbackEvents.length,
      emptyBookmakerFallbackEvents,
      supplementalAnytimeHomeRunFetchEventCount: supplementalAnytimeHomeRunFetchEvents.length,
      supplementalAnytimeHomeRunFetchEvents,
      supplementalSpecialFetchEventCount: supplementalSpecialFetchEvents.length,
      supplementalSpecialFetchEvents,
      enrichmentCoverage: enrichmentResult?.diagnostics || {
        totals: {
          totalRows: enrichedRows.length,
          playerRows: 0,
          matchedRows: 0,
          unresolvedRows: 0,
          lowConfidenceRows: 0,
          overallMatchRate: 0
        },
        byMarketFamily: {},
        unresolvedSamples: [],
        lowConfidenceSamples: []
      },
      externalFetchReadiness: (normalizedExternalSnapshot?.diagnostics && normalizedExternalSnapshot.diagnostics.fetchReadiness) || null,
      payloadShapes,
      failedEvents
    }
  }
}

module.exports = {
  createEmptyMlbSnapshot,
  buildMlbBootstrapSnapshot
}
