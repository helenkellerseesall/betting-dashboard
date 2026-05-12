"use strict"

const axios = require("axios")
const fs = require("fs")
const path = require("path")
const { buildSlateEvents } = require("../schedule/buildSlateEvents")
const { inferMarketTypeFromKey, canonicalPropTypeFromInferred } = require("../markets/classification")
const { nbaRowModelProbability, nbaRowEdge } = require("./nbaModelSignals")
const { enrichNbaRowStatLayerInputs, applyTeamFallbackFromProjections } = require("./nbaEventTeamResolve")

const NBA_BASE_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_threes_alternate",
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_points_assists",
  "player_rebounds_assists",
  "player_first_basket",
  "player_first_team_basket",
  "totals",
  "spreads",
  "h2h",
]

const NBA_DK_EXTRA_MARKETS = [
  "player_double_double",
  "player_triple_double",
  "player_points_alternate",
  "player_rebounds_alternate",
  "player_assists_alternate",
  "player_points_rebounds_assists_alternate",
  "player_points_rebounds_alternate",
  "player_points_assists_alternate",
  "player_rebounds_assists_alternate",
]

// ── NBA SP1 fix: score snapshot rows into bestProps ───────────────────────────
// Previously bestProps was hardcoded []. This function runs the canonical NBA
// model signals (nbaRowModelProbability + nbaRowEdge) over the deduped raw
// props and persists the genuinely strongest standalone props.
//
// Gates mirror buildNbaSnapshotCandidates (workstationRoutes.js) — base-lines
// only, core odds range, known stat family, mp ≥ 0.35, edge ≥ 0.03.
// Enrichment (pace/total/usage/team) applied via nbaEventTeamResolve before
// scoring so model has full game-context signal.
//
// Per-player cap (2 max) prevents star monoculture.
// Returns at most BEST_PROPS_TARGET rows sorted by edge descending.
const BEST_PROPS_TARGET = 60
const BEST_PROPS_MAX_PER_PLAYER = 2
const CONCENTRATION_BUCKET_THRESHOLD = 0.40  // max pct of pool from one (family|side) combo
const CONCENTRATION_SIDE_THRESHOLD   = 0.75  // max pct of pool sharing a single side

function buildNbaBestProps(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return { props: [], diagnostics: {} }

  const rejectCounts = {
    noPlayer: 0, noSide: 0, isAlt: 0, oddsGate: 0,
    noFamily: 0, mpBelow35: 0, edgeBelow03: 0,
    concentrationDeferred: 0,
  }

  const rawScored = []
  for (const r of rawRows) {
    const player = String(r?.player || "").trim()
    if (!player) { rejectCounts.noPlayer++; continue }
    const side = String(r?.side || "").toLowerCase()
    if (!side || side === "unknown") { rejectCounts.noSide++; continue }

    // Base-lines only — alt/ladder lines excluded (no calibrated model signal above +200)
    const mk = String(r?.marketKey || "").toLowerCase()
    const pv = String(r?.propVariant || "").toLowerCase()
    const isAlt = mk.includes("alternate") || mk.includes("_alt") ||
                  (pv && pv !== "base" && pv !== "default")
    if (isAlt) { rejectCounts.isAlt++; continue }

    // Core odds range — same gate as buildNbaSnapshotCandidates
    const odds = Number(r?.odds ?? r?.oddsAmerican)
    if (!Number.isFinite(odds) || odds < -200 || odds > 200) { rejectCounts.oddsGate++; continue }

    // Known stat family — unknown propTypes produce unreliable model scores
    const propT = String(r?.propType || mk).toLowerCase()
    const family = propT.includes("points_rebounds_assists") || /\bpra\b/.test(propT) ? "pra"
      : propT.includes("first_basket") || propT.includes("firstbasket") ? "first_basket"
      : propT.includes("points")   ? "points"
      : propT.includes("rebounds") ? "rebounds"
      : propT.includes("assists")  ? "assists"
      : (propT.includes("threes") || propT.includes("three") || propT.includes("3pt")) ? "threes"
      : null
    if (!family) { rejectCounts.noFamily++; continue }

    // Enrichment: adds pace/total/minutes/usage/team — improves model accuracy
    const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    const mp = nbaRowModelProbability(enriched)
    if (!Number.isFinite(mp) || mp < 0.35) { rejectCounts.mpBelow35++; continue }
    const edge = nbaRowEdge(enriched)
    if (!Number.isFinite(edge) || edge < 0.03) { rejectCounts.edgeBelow03++; continue }

    // Volatility stamp — same as FIX Q4 in buildNbaSnapshotCandidates
    const volatility = family === "pra" ? "lotto"
      : (family === "threes" || family === "first_basket") ? "aggressive"
      : "balanced"

    rawScored.push({
      ...r,
      statFamily:  family,
      modelProb:   mp,
      edge,
      impliedProb: odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100),
      volatility,
      tier:        edge >= 0.12 ? "ELITE" : edge >= 0.07 ? "STRONG" : edge >= 0.04 ? "PLAYABLE" : "LONGSHOT",
      snapshotSourced: true,
    })
  }

  // Dedup: keep best-edge entry per (player|family|side) triple
  const bestBySig = new Map()
  for (const c of rawScored) {
    const sig = `${c.player}|${c.statFamily}|${c.side}`
    if (!bestBySig.has(sig) || c.edge > bestBySig.get(sig).edge) bestBySig.set(sig, c)
  }
  const deduped = Array.from(bestBySig.values()).sort((a, b) => b.edge - a.edge)

  // ── Concentration-aware two-pass selection ──────────────────────────────────
  // Pass 1: All ELITE + STRONG accepted unconditionally — real edges, never suppressed.
  // Pass 2: PLAYABLE filled with soft concentration check — prevents monoculture
  //         from marginal props without suppressing genuine edge signal.
  const playerCount = new Map()
  const bucketSizes = {}   // "(family|side)" → count
  const sideCounts  = {}   // "over"|"under" → count
  const props       = []

  function acceptProp(c) {
    const n = playerCount.get(c.player) || 0
    if (n >= BEST_PROPS_MAX_PER_PLAYER) return false
    playerCount.set(c.player, n + 1)
    const bk = `${c.statFamily}|${c.side}`
    bucketSizes[bk] = (bucketSizes[bk] || 0) + 1
    const sk = String(c.side || "").toLowerCase()
    sideCounts[sk] = (sideCounts[sk] || 0) + 1
    props.push(c)
    return true
  }

  // Pass 1: ELITE + STRONG — no concentration check
  for (const c of deduped) {
    if (props.length >= BEST_PROPS_TARGET) break
    if (c.tier === "ELITE" || c.tier === "STRONG") acceptProp(c)
  }

  // Pass 2: PLAYABLE — soft concentration guard
  for (const c of deduped) {
    if (props.length >= BEST_PROPS_TARGET) break
    if (c.tier === "ELITE" || c.tier === "STRONG") continue

    const total = props.length
    if (total >= 4) {
      const bk    = `${c.statFamily}|${c.side}`
      const bkPct = (bucketSizes[bk] || 0) / total
      if (bkPct > CONCENTRATION_BUCKET_THRESHOLD) {
        rejectCounts.concentrationDeferred++
        continue
      }
      const sk      = String(c.side || "").toLowerCase()
      const sidePct = (sideCounts[sk] || 0) / total
      if (sidePct > CONCENTRATION_SIDE_THRESHOLD) {
        rejectCounts.concentrationDeferred++
        continue
      }
    }
    acceptProp(c)
  }

  const volCounts = {}
  for (const p of props) volCounts[p.volatility] = (volCounts[p.volatility] || 0) + 1

  console.log(
    "[NBA-BESTPROPS] rawRows=%d isAlt=%d oddsGate=%d noFamily=%d mpBelow35=%d edgeBelow03=%d concentrationDeferred=%d rawScored=%d deduped=%d bestProps=%d vol=%s",
    rawRows.length,
    rejectCounts.isAlt, rejectCounts.oddsGate, rejectCounts.noFamily,
    rejectCounts.mpBelow35, rejectCounts.edgeBelow03, rejectCounts.concentrationDeferred,
    rawScored.length, deduped.length, props.length,
    JSON.stringify(volCounts)
  )

  return {
    props,
    diagnostics: {
      rawRowsIn:    rawRows.length,
      rejectCounts,
      rawScored:    rawScored.length,
      deduped:      deduped.length,
      bestPropsOut: props.length,
      volCounts,
    },
  }
}

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

function buildNbaIngestCoverageDiagnostics(rows = []) {
  const r = Array.isArray(rows) ? rows : []
  const byMk = r.reduce((acc, row) => {
    const k = String(row?.marketKey || "unknown")
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  const n = (mk) => byMk[mk] || 0
  const threesLadderish = r.filter(
    (row) =>
      String(row?.marketKey || "") === "player_threes_alternate" ||
      String(row?.propType || "") === "Threes Ladder"
  ).length
  const assistsLadderish = r.filter(
    (row) =>
      String(row?.marketKey || "") === "player_assists_alternate" ||
      String(row?.propType || "") === "Assists Ladder"
  ).length
  const comboCanon = new Set(["pra", "points_rebounds", "points_assists", "rebounds_assists"])
  const comboLike = r.filter((row) => comboCanon.has(String(row?.canonicalPropType || ""))).length
  return {
    byMarketKey: byMk,
    counts: {
      player_threes: n("player_threes"),
      player_threes_alternate: n("player_threes_alternate"),
      player_assists: n("player_assists"),
      player_assists_alternate: n("player_assists_alternate"),
      player_points_alternate: n("player_points_alternate"),
      player_first_basket: n("player_first_basket"),
      player_double_double: n("player_double_double"),
      player_triple_double: n("player_triple_double"),
      player_points_rebounds: n("player_points_rebounds"),
      player_points_assists: n("player_points_assists"),
      player_rebounds_assists: n("player_rebounds_assists"),
      player_points_rebounds_assists: n("player_points_rebounds_assists"),
    },
    poolChecks: {
      threesLadderCandidates: threesLadderish,
      assistsLadderCandidates: assistsLadderish,
      firstBasketRows: n("player_first_basket"),
      comboStatRows: comboLike,
    },
  }
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

  const standardPropTypes = new Set([
    "Points",
    "Rebounds",
    "Assists",
    "Threes",
    "PRA",
    "Points + Rebounds",
    "Points + Assists",
    "Rebounds + Assists",
  ])
  const ladderPropTypes = new Set([
    "Points Ladder",
    "Rebounds Ladder",
    "Assists Ladder",
    "Threes Ladder",
    "PRA Ladder",
    "Points + Rebounds Ladder",
    "Points + Assists Ladder",
    "Rebounds + Assists Ladder",
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

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normTeamKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
}

function teamLikelyEquals(a, b) {
  const x = normTeamKey(a)
  const y = normTeamKey(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return true
  return false
}

/**
 * Game-level spread (absolute margin) + moneylines from Odds API book payloads.
 * Attached to every player-prop row for blowout / game-context layers.
 */
function extractSpreadAndMoneylinesFromBooks(books, homeTeam, awayTeam) {
  let spreadAbs = null
  let moneylineHomeOdds = null
  let moneylineAwayOdds = null

  for (const book of Array.isArray(books) ? books : []) {
    for (const market of Array.isArray(book?.markets) ? book.markets : []) {
      const mk = String(market?.key || market?.name || "").toLowerCase()
      if (mk === "spreads" && spreadAbs == null) {
        let best = null
        for (const o of Array.isArray(market?.outcomes) ? market.outcomes : []) {
          const pt = toNum(o?.point)
          if (Number.isFinite(pt)) {
            const a = Math.abs(pt)
            best = best == null ? a : Math.max(best, a)
          }
        }
        if (best != null) spreadAbs = best
      }
      if (mk === "h2h" && (moneylineHomeOdds == null || moneylineAwayOdds == null)) {
        let hOdd = null
        let aOdd = null
        for (const o of Array.isArray(market?.outcomes) ? market.outcomes : []) {
          const name = String(o?.name || "").trim()
          const price = toNum(o?.price)
          if (!name || !Number.isFinite(price)) continue
          if (teamLikelyEquals(name, homeTeam)) hOdd = price
          else if (teamLikelyEquals(name, awayTeam)) aOdd = price
        }
        if (Number.isFinite(hOdd) && Number.isFinite(aOdd)) {
          moneylineHomeOdds = hOdd
          moneylineAwayOdds = aOdd
        }
      }
    }
    if (spreadAbs != null && moneylineHomeOdds != null && moneylineAwayOdds != null) break
  }

  return { spreadAbs, moneylineHomeOdds, moneylineAwayOdds }
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
    bookmakers: "draftkings,fanduel",
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

  const { spreadAbs, moneylineHomeOdds, moneylineAwayOdds } = extractSpreadAndMoneylinesFromBooks(
    books,
    homeTeam,
    awayTeam
  )

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
          canonicalPropType: canonicalPropTypeFromInferred(propType, marketKey),
          player,
          side,
          playerStatus: null,
          line: Number.isFinite(line) ? line : null,
          odds,
          propVariant: propVariantFromMarket(marketKey, inferredFamily),
          team: teamHint || null,
          gameTotal: Number.isFinite(eventGameTotal) ? eventGameTotal : null,
          spread: Number.isFinite(spreadAbs) ? spreadAbs : null,
          gameSpread: Number.isFinite(spreadAbs) ? spreadAbs : null,
          moneylineHomeOdds: Number.isFinite(moneylineHomeOdds) ? moneylineHomeOdds : null,
          moneylineAwayOdds: Number.isFinite(moneylineAwayOdds) ? moneylineAwayOdds : null,
        }

        // Session AN — Step 1: Activate dormant matchup intelligence.
        // Populate `opponent` at snapshot creation time so the row leaves the
        // fetcher carrying the field that nbaMatchupIntelligence.computeMatchupAdjustmentFromRow
        // gates on (`row.opponent ?? row.opponentTeam`). Reuses the EXISTING
        // applyTeamFallbackFromProjections helper which:
        //   1. Fills `team` from data/nbaPlayerProjections.json by player name
        //   2. Infers `opponent` by matching team against homeTeam / awayTeam
        // No new matchup engine. No new player→team source. We are wiring the
        // missing field using intelligence that already exists.
        // Players not in projections.json (≈28% of slate) remain opponent=null.
        // That is honest — those rows correctly receive 0 defense adjustment,
        // not a synthetic one.
        const enrichedRow = applyTeamFallbackFromProjections(draftRow)

        if (shouldRejectRow(enrichedRow)) continue
        rows.push(enrichedRow)
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

  const { allEvents, scheduledEvents, upcomingEvents } = await buildSlateEvents({
    oddsApiKey,
    now,
  })

  // Session AX — use buildSlateEvents.upcomingEvents (any-date future-only)
  // as the fallback when scheduledEvents (today + future) is empty. This
  // ensures tomorrow's pregame NBA games still drive snapshot generation
  // when today's slate is complete.
  const slateEvents = Array.isArray(scheduledEvents) && scheduledEvents.length
    ? scheduledEvents
    : (Array.isArray(upcomingEvents) ? upcomingEvents : [])

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
  const ingestCoverage = buildNbaIngestCoverageDiagnostics(deduped)
  const marketKeysReturned = [...new Set(deduped.map((r) => String(r?.marketKey || "").trim()).filter(Boolean))].sort()

  // NBA SP1 fix: score all deduped rows and persist genuinely strongest props.
  // Runs nbaRowModelProbability + nbaRowEdge with full enrichment (pace/total/team).
  // Base-lines only, -200..+200 odds, mp≥0.35, edge≥0.03, max 2 per player, top 60.
  const bestPropsResult = buildNbaBestProps(deduped)

  return {
    updatedAt,
    snapshotGeneratedAt: updatedAt,
    events: normalizedEvents,
    rawProps: deduped,
    props: [...deduped],
    eliteProps: [],
    strongProps: [],
    playableProps: [],
    bestProps: bestPropsResult.props,
    flexProps: [],
    diagnostics: {
      nbaBootstrap: "fetchNbaOddsSnapshot-v2",
      slateEventCount: normalizedEvents.length,
      rawPropCount: deduped.length,
      bestPropsCount: bestPropsResult.props.length,
      bestPropsDiagnostics: bestPropsResult.diagnostics,
      ingestCoverage,
      fetchAudit: {
        /** Per-event odds only (not `/odds` summary); one HTTP GET per slate event. */
        eventOddsEndpointTemplate:
          "https://api.the-odds-api.com/v4/sports/basketball_nba/events/{eventId}/odds",
        usesPerEventOdds: true,
        baseRequestMarkets: NBA_BASE_MARKETS,
        extraRequestMarkets: NBA_DK_EXTRA_MARKETS,
        baseBookmakers: "fanduel,draftkings",
        extraBookmakers: "draftkings,fanduel",
        marketKeysReturned: marketKeysReturned.slice(0, 200),
        marketKeysReturnedFullCount: marketKeysReturned.length,
        marketKeysReturnedSample: marketKeysReturned.slice(0, 80),
        marketKeysReturnedCount: marketKeysReturned.length,
      },
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
  buildNbaIngestCoverageDiagnostics,
}
