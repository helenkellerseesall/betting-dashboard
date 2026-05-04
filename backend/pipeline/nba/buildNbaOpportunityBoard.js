"use strict"

console.log("ACTIVE:", __filename)

const { isNbaStatLadderRow } = require("./nbaStatLadder")
const { ladderCandidateFromRow, dedupeCandidates, sortByProbDesc } = require("./nbaOpportunityCandidates")
const { mineNbaExtendedOpportunityPools } = require("./nbaExtendedOpportunityPools")
const { applyEdgeToNbaRows } = require("./applyNbaRowEdge")
const { buildNbaAiPicks } = require("./buildNbaAiPicks")
const { applyDominanceGapToOpportunityBoard } = require("./nbaAiDominanceGap")
const { buildNbaAiSlips } = require("./buildNbaAiSlips")
const { buildNbaPipelineAudit, maybeLogNbaPipelineAudit } = require("./nbaPipelineAudit")

/**
 * NBA analogue of `buildMlbOpportunityBoard`: ladder-first opportunity pools derived from
 * already-scored board rows (no re-ingest, no Odds API).
 */
function buildNbaOpportunityBoard(input = {}) {
  const ladderBoard = Array.isArray(input?.ladderBoard) ? input.ladderBoard : []
  const corePropsBoard = Array.isArray(input?.corePropsBoard) ? input.corePropsBoard : []
  const completeUniverse = Array.isArray(input?.completeUniverse) ? input.completeUniverse : []

  applyEdgeToNbaRows(ladderBoard)
  applyEdgeToNbaRows(corePropsBoard)
  applyEdgeToNbaRows(completeUniverse)

  const TH = {
    // Ladder probabilities are often 0.15–0.40 for meaningful rungs.
    // Keeping this too high collapses ladder pools and destabilizes tiers.
    ladder: 0.20,
    core: 0.58,
    edge: 0.02,
    doubleDouble: 0.48,
    tripleDouble: 0.28,
    firstBasket: 0.08,
  }

  // Build base threes line index (event+player) so threes ladders can be role-aware.
  const threesBaseLineByPlayerEvent = new Map()
  for (const row of completeUniverse) {
    if (!row || typeof row !== "object") continue
    const mk = String(row?.marketKey || "").toLowerCase()
    if (!mk.includes("player_three") && !mk.includes("threes")) continue
    const player = String(row?.player || "").trim().toLowerCase()
    const eid = String(row?.eventId || "").trim()
    const ln = Number(row?.line)
    if (!player || !eid || !Number.isFinite(ln)) continue
    const k = `${eid}__${player}`
    const prev = threesBaseLineByPlayerEvent.get(k)
    if (prev == null || ln > prev) threesBaseLineByPlayerEvent.set(k, ln)
  }
  const candidateCtx = { threesBaseLineByPlayerEvent }

  function isStatFamily(row, family) {
    const mk = String(row?.marketKey || "").toLowerCase()
    const pt = String(row?.propType || "").toLowerCase()
    const s = `${pt} ${mk}`
    if (family === "pra") return s.includes("points_rebounds_assists") || /\bpra\b/.test(s)
    if (family === "rebounds") return s.includes("rebound")
    if (family === "assists") return s.includes("assist")
    if (family === "points") return s.includes("point")
    if (family === "threes") return s.includes("three") || s.includes("3pt") || s.includes("threes")
    if (family === "combo") {
      if (s.includes("points_rebounds_assists")) return false
      return (
        s.includes("player_points_assists") ||
        s.includes("player_points_rebounds") ||
        s.includes("player_rebounds_assists") ||
        /points.*assists|points.*rebounds|rebounds.*assists|pts.*ast|reb.*ast/i.test(s) ||
        s.includes("combo")
      )
    }
    return false
  }

  // Mine ladder-like rows directly from the scored universe to avoid pool starvation
  // when ladderBoard is thin or probability-trimmed upstream.
  /** Base / alt 3PM main lines (books often omit ladder shape on player_threes). */
  function mineUniverseBaseThreesRows({ minProb = 0.06 } = {}) {
    const out = []
    for (const row of completeUniverse) {
      if (!row || typeof row !== "object") continue
      const mk = String(row?.marketKey || "").toLowerCase()
      if (!mk.includes("player_three") && !mk.includes("threes")) continue
      if (mk.includes("points") && mk.includes("rebounds")) continue
      const c = ladderCandidateFromRow(row, candidateCtx)
      if (!c) continue
      if (c.probability < minProb) continue
      out.push(c)
    }
    return out
  }

  function mineUniverseLadders({ family = null, minProb = TH.ladder, requireEdge = false } = {}) {
    const out = []
    for (const row of completeUniverse) {
      if (!row || typeof row !== "object") continue
      const mk = String(row?.marketKey || "").toLowerCase()
      const pv = String(row?.propVariant || "base").toLowerCase()
      const isLadderLike =
        isNbaStatLadderRow(row) ||
        mk.includes("alternate") ||
        mk.includes("_alt") ||
        mk.endsWith("_alternate") ||
        (pv && pv !== "base" && pv !== "default")
      if (!isLadderLike) continue
      if (family && !isStatFamily(row, family)) continue
      const c = ladderCandidateFromRow(row, candidateCtx)
      if (!c) continue
      if (c.probability < minProb) continue
      if (requireEdge && c.edge != null && Number.isFinite(c.edge) && c.edge < TH.edge) continue
      out.push(c)
    }
    return out
  }

  const ladderCandidates = []
  for (const row of ladderBoard) {
    const c = ladderCandidateFromRow(row, candidateCtx)
    if (!c) continue
    // Avoid starving ladder pools: let finalWeight do the ranking.
    if (c.probability < 0.14) continue
    if (c.edge != null && c.edge < TH.edge) continue
    ladderCandidates.push(c)
  }

  // Always include universe ladder rows for key families so pools don't starve.
  ladderCandidates.push(
    ...mineUniverseLadders({ family: "points", minProb: 0.14 }),
    ...mineUniverseLadders({ family: "rebounds", minProb: 0.16 }),
    ...mineUniverseLadders({ family: "assists", minProb: 0.16 }),
    ...mineUniverseLadders({ family: "threes", minProb: 0.12 }),
    ...mineUniverseLadders({ family: "pra", minProb: 0.16 }),
    ...mineUniverseLadders({ family: "combo", minProb: 0.14 }),
    ...mineUniverseBaseThreesRows({ minProb: 0.06 })
  )

  const coreCandidates = []
  for (const row of corePropsBoard) {
    const c = ladderCandidateFromRow(row, candidateCtx)
    if (!c) continue
    if (c.probability < TH.core) continue
    coreCandidates.push(c)
  }

  // Fallback: if standard core board is thin, mine non-ladder universe core stat rows.
  if (coreCandidates.length < 20 && completeUniverse.length) {
    for (const row of completeUniverse) {
      if (!row || typeof row !== "object") continue
      if (isNbaStatLadderRow(row)) continue
      const pt = String(row?.propType || "").toLowerCase()
      const isCore =
        /point/.test(pt) || /rebound/.test(pt) || /assist/.test(pt) || /pra|points.*rebounds.*assists/.test(pt)
      if (!isCore) continue
      const c = ladderCandidateFromRow(row, candidateCtx)
      if (!c) continue
      if (c.probability < TH.core) continue
      coreCandidates.push(c)
    }
  }

  // Fallback: if boards are thin, mine the scored universe for ladder variants only.
  const ladderUniverse = []
  if (!ladderCandidates.length && completeUniverse.length) {
    for (const row of completeUniverse) {
      if (!isNbaStatLadderRow(row)) continue
      const c = ladderCandidateFromRow(row, candidateCtx)
      if (!c) continue
      if (c.probability < 0.14) continue
      ladderUniverse.push(c)
    }
  }

  const primaryLadders = dedupeCandidates([...ladderCandidates, ...ladderUniverse]).sort(sortByProbDesc)

  // Grouped mirrors of MLB board keys (consumer: scripts/runNbaNight.js)
  const pointsLadderCandidates = primaryLadders.filter((c) => /points/i.test(String(c.propType)))
  const reboundsLadderCandidates = primaryLadders.filter((c) => /rebounds/i.test(String(c.propType)))
  const assistsLadderCandidates = primaryLadders.filter((c) => /assists/i.test(String(c.propType)))
  const threesLadderCandidates = primaryLadders.filter((c) => {
    const pt = String(c.propType || "")
    const mk = String(c.marketKey || "").toLowerCase()
    return /three|3-pt|3pt/i.test(pt) || mk.includes("threes") || mk.includes("player_three")
  })
  const praLadderCandidates = primaryLadders.filter((c) => /pra/i.test(String(c.propType)))

  const extended = mineNbaExtendedOpportunityPools(completeUniverse, TH)

  const resolvedCore = dedupeCandidates(coreCandidates).sort(sortByProbDesc)

  const boardPayload = {
    ladderCandidates: primaryLadders,
    pointsLadderCandidates,
    reboundsLadderCandidates,
    assistsLadderCandidates,
    threesLadderCandidates,
    praLadderCandidates,
    coreCandidates: resolvedCore.length
      ? resolvedCore
      : dedupeCandidates(
          [...pointsLadderCandidates, ...reboundsLadderCandidates, ...assistsLadderCandidates, ...praLadderCandidates].slice(0, 80)
        ).sort(sortByProbDesc),
    doubleDoubleCandidates: extended.doubleDoubleCandidates,
    tripleDoubleCandidates: extended.tripleDoubleCandidates,
    firstBasketCandidates: extended.firstBasketCandidates,
    praCandidates: extended.praCandidates,
    altPointsCandidates: extended.altPointsCandidates,
    altThreesCandidates: extended.altThreesCandidates,
    comboCandidates: extended.comboCandidates,
    thresholds: TH,
    meta: {
      ladderBoardRows: ladderBoard.length,
      corePropsBoardRows: corePropsBoard.length,
      completeUniverseRows: completeUniverse.length,
    },
  }

  applyDominanceGapToOpportunityBoard(boardPayload)
  boardPayload.aiPicks = buildNbaAiPicks(boardPayload)
  boardPayload.aiPicksRankedPool = Array.isArray(boardPayload.aiPicks?.rankedOpportunityPool)
    ? boardPayload.aiPicks.rankedOpportunityPool
    : null
  boardPayload.aiSlips = buildNbaAiSlips({
    elite: boardPayload.aiPicks?.elite ?? [],
    strong: boardPayload.aiPicks?.strong ?? [],
    opportunityBoard: boardPayload,
  })

  const pipelineAudit = buildNbaPipelineAudit({
    label: "buildNbaOpportunityBoard",
    ingestRows: Array.isArray(input?.ingestRows) ? input.ingestRows : [],
    ingestCoverage: input?.ingestDiagnostics?.ingestCoverage ?? null,
    requestedBaseMarkets: input?.ingestDiagnostics?.baseMarkets ?? [],
    requestedExtraMarkets: input?.ingestDiagnostics?.extraMarkets ?? [],
    completeUniverse,
    ladderBoard,
    corePropsBoard,
    opportunityBoard: boardPayload,
    aiPicks: boardPayload.aiPicks,
    aiSlips: boardPayload.aiSlips,
  })
  boardPayload.meta = { ...(boardPayload.meta || {}), pipelineAudit }
  maybeLogNbaPipelineAudit(pipelineAudit)

  return boardPayload
}

module.exports = {
  buildNbaOpportunityBoard,
}
