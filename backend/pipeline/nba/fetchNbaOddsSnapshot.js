"use strict"

const axios = require("axios")
const fs = require("fs")
const path = require("path")
const { buildSlateEvents } = require("../schedule/buildSlateEvents")
const { inferMarketTypeFromKey } = require("../markets/classification")

const NBA_BASE_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists",
  "totals",
]

const NBA_DK_EXTRA_MARKETS = [
  "player_first_basket",
  "player_first_team_basket",
  "player_double_double",
  "player_triple_double",
  "player_points_alternate",
  "player_rebounds_alternate",
  "player_assists_alternate",
  "player_threes_alternate",
  "player_points_rebounds_assists_alternate",
]

function buildMatchup(awayTeam, homeTeam) {
  const away = String(awayTeam || "").trim()
  const home = String(homeTeam || "").trim()
  if (away && home) return `${away} @ ${home}`
  return away || home || "UNKNOWN_MATCHUP"
}

function dedupeByLegSignature(rows = []) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const key = [
      row?.eventId,
      row?.book,
      row?.player,
      row?.propType,
      row?.side,
      Number(row?.line),
      row?.propVariant || "base",
    ].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function getIngestRejectReason(row) {
  if (!row) return "invalid_row"
  const player = String(row.player || "").trim()
  const side = String(row.side || "").trim()
  const propType = String(row.propType || "").trim()
  const book = String(row.book || "").trim()
  const matchup = String(row.matchup || "").trim()
  const gameTime = String(row.gameTime || "").trim()
  const line = Number(row.line)
  const odds = Number(row.odds)
  const marketFamily = String(row.marketFamily || "").trim()

  if (!player || !propType || !book || !matchup || !gameTime) return "missing_required_fields"
  if (!Number.isFinite(odds)) return "invalid_odds"

  const isLadder = marketFamily === "ladder"
  const isSpecial = marketFamily === "special"

  if (!isLadder && !isSpecial) {
    if (!side) return "missing_required_fields"
    if (side !== "Over" && side !== "Under") return "invalid_side"
    if (!Number.isFinite(line)) return "invalid_line"
  }

  if (isLadder) {
    const hasUsableSide = side === "Over" || side === "Under" || side === "Yes" || side === "No"
    const hasUsableLine = Number.isFinite(line)
    if (!hasUsableSide && !hasUsableLine) return "ladder_unusable_missing_side_and_line"
  }

  const standardPropTypes = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
  const ladderPropTypes = new Set([
    "Points Ladder",
    "Rebounds Ladder",
    "Assists Ladder",
    "Threes Ladder",
    "PRA Ladder",
  ])
  const specialPropTypes = new Set(["First Basket", "First Team Basket", "Double Double", "Triple Double"])
  const allAllowedPropTypes = new Set([...standardPropTypes, ...ladderPropTypes, ...specialPropTypes])
  if (!allAllowedPropTypes.has(propType)) return "invalid_prop_type"

  if (isSpecial) {
    if (odds < -250000 || odds > 250000) return "odds_out_of_range"
  } else if (isLadder) {
    if (odds < -250000 || odds > 250000) return "odds_out_of_range"
  } else {
    if (odds < -250000 || odds > 250000) return "odds_out_of_range"
  }
  if (Number.isFinite(line) && line < 0) return "line_below_zero"
  return null
}

function shouldRejectRow(row) {
  return Boolean(getIngestRejectReason(row))
}

function normalizeSideForRow(sideRaw, inferredFamily) {
  let side = String(sideRaw || "").trim()
  if (side.toLowerCase() === "over") side = "Over"
  else if (side.toLowerCase() === "under") side = "Under"
  else if (inferredFamily === "special" || inferredFamily === "ladder") {
    const sl = side.toLowerCase()
    if (sl === "yes") side = "Yes"
    else if (sl === "no") side = "No"
    else if (side !== "Over" && side !== "Under") side = "Yes"
  }
  return side
}

function propVariantFromMarket(marketKey, inferredFamily) {
  const mk = String(marketKey || "").toLowerCase()
  if (inferredFamily === "ladder" || mk.includes("alternate") || mk.includes("_alt")) return "alt-mid"
  return "base"
}

function mergeBookmakers(baseBooks, extraBooks) {
  const byKey = new Map()
  for (const b of [...(Array.isArray(baseBooks) ? baseBooks : []), ...(Array.isArray(extraBooks) ? extraBooks : [])]) {
    const key = String(b?.key || b?.title || "").toLowerCase()
    if (!key) continue
    if (!byKey.has(key)) {
      byKey.set(key, { ...b, markets: [...(Array.isArray(b?.markets) ? b.markets : [])] })
    } else {
      const cur = byKey.get(key)
      cur.markets = [...(Array.isArray(cur.markets) ? cur.markets : []), ...(Array.isArray(b?.markets) ? b.markets : [])]
    }
  }
  return [...byKey.values()]
}

async function fetchEventOddsRows(event, oddsApiKey) {
  const eventId = String(event?.id || event?.eventId || "").trim()
  if (!eventId) return []

  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventId)}/odds`
  const baseParams = {
    apiKey: oddsApiKey,
    regions: "us",
    bookmakers: "fanduel,draftkings",
    markets: NBA_BASE_MARKETS.join(","),
    oddsFormat: "american",
  }
  const extraParams = {
    apiKey: oddsApiKey,
    regions: "us",
    bookmakers: "draftkings",
    markets: NBA_DK_EXTRA_MARKETS.join(","),
    oddsFormat: "american",
  }

  const [baseRes, extraRes] = await Promise.all([
    axios.get(url, { params: baseParams, timeout: 20000 }),
    axios.get(url, { params: extraParams, timeout: 20000 }),
  ])

  const baseBooks = baseRes?.data?.bookmakers
  const extraBooks = extraRes?.data?.bookmakers
  const books = mergeBookmakers(baseBooks, extraBooks)

  const observedAtIso = new Date().toISOString()
  const awayTeam = event?.away_team || event?.awayTeam || ""
  const homeTeam = event?.home_team || event?.homeTeam || ""
  const matchup = buildMatchup(awayTeam, homeTeam)
  const gameTime =
    String(event?.commence_time || event?.commenceTime || event?.gameTime || "").trim() || observedAtIso

  let eventGameTotal = null
  for (const book of books) {
    for (const market of Array.isArray(book?.markets) ? book.markets : []) {
      const mk = String(market?.key || market?.name || "").toLowerCase()
      if (mk !== "totals") continue
      const pts = (Array.isArray(market?.outcomes) ? market.outcomes : [])
        .map((o) => Number(o?.point))
        .filter((n) => Number.isFinite(n))
      if (pts.length && eventGameTotal == null) {
        eventGameTotal = pts[0]
      }
    }
  }

  const rows = []
  for (const book of books) {
    const bookName = String(book?.title || book?.key || "Unknown").trim()
    for (const market of Array.isArray(book?.markets) ? book.markets : []) {
      const marketKey = String(market?.key || market?.name || "").trim()
      const inferred = inferMarketTypeFromKey(marketKey)
      const inferredFamily = inferred.family
      const propType = inferred.internalType
      if (!propType) continue

      for (const outcome of Array.isArray(market?.outcomes) ? market.outcomes : []) {
        const side = normalizeSideForRow(outcome?.name, inferredFamily)
        const player = String(outcome?.description || "").trim()
        const odds = Number(outcome?.price)
        const line = outcome?.point != null ? Number(outcome.point) : NaN

        const part = outcome?.participant
        let teamHint = null
        if (typeof outcome?.team === "string" && outcome.team.trim()) teamHint = outcome.team.trim()
        else if (typeof part === "string" && part.trim()) teamHint = part.trim()
        else if (part && typeof part === "object") {
          const t = String(part.team || part.name || "").trim()
          teamHint = t || null
        }

        const draftRow = {
          sport: "nba",
          source: "odds-api-v4-pipeline",
          fetchedAt: observedAtIso,
          eventId,
          matchup,
          awayTeam,
          homeTeam,
          gameTime,
          book: bookName,
          marketKey,
          marketFamily: inferredFamily,
          propType,
          player,
          side,
          playerStatus: null,
          line: Number.isFinite(line) ? line : null,
          odds,
          propVariant: propVariantFromMarket(marketKey, inferredFamily),
          team: teamHint || null,
          gameTotal: Number.isFinite(eventGameTotal) ? eventGameTotal : null,
        }

        if (shouldRejectRow(draftRow)) continue
        rows.push(draftRow)
      }
    }
  }
  return rows
}

/**
 * Direct Odds API NBA snapshot (events + per-event props). No server.js / eval / fragile deps.
 * @param {{ oddsApiKey: string, now?: number, maxEvents?: number }} opts
 */
async function fetchNbaOddsSnapshot({ oddsApiKey, now = Date.now(), maxEvents = 22 } = {}) {
  if (!oddsApiKey || typeof oddsApiKey !== "string") {
    throw new Error("Missing oddsApiKey for NBA snapshot fetch")
  }

  const { allEvents, scheduledEvents } = await buildSlateEvents({
    oddsApiKey,
    now,
  })

  const slateEvents = Array.isArray(scheduledEvents) && scheduledEvents.length
    ? scheduledEvents
    : Array.isArray(allEvents)
      ? allEvents
      : []

  const normalizedEvents = slateEvents.slice(0, maxEvents)

  const rawProps = []
  for (const ev of normalizedEvents) {
    try {
      const part = await fetchEventOddsRows(ev, oddsApiKey)
      rawProps.push(...part)
    } catch (err) {
      console.log("[NBA-SNAPSHOT-FETCH] event failed", {
        eventId: ev?.id || ev?.eventId,
        message: err?.message || String(err),
      })
    }
  }

  const deduped = dedupeByLegSignature(rawProps)
  const updatedAt = new Date().toISOString()

  return {
    updatedAt,
    snapshotGeneratedAt: updatedAt,
    events: normalizedEvents,
    rawProps: deduped,
    props: [...deduped],
    eliteProps: [],
    strongProps: [],
    playableProps: [],
    bestProps: [],
    flexProps: [],
    diagnostics: {
      nbaBootstrap: "fetchNbaOddsSnapshot-v1",
      slateEventCount: normalizedEvents.length,
      rawPropCount: deduped.length,
    },
    parlays: null,
    dualParlays: null,
  }
}

function saveNbaSnapshotToDisk(backendDir, snapshot) {
  const snapshotPath = path.join(backendDir, "snapshot.json")
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        data: snapshot,
        savedAt: Date.now(),
      },
      null,
      2
    )
  )
  return snapshotPath
}

module.exports = {
  fetchNbaOddsSnapshot,
  saveNbaSnapshotToDisk,
}
