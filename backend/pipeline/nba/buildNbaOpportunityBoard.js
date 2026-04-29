"use strict"

const { isNbaStatLadderRow } = require("./nbaStatLadder")
const { ladderCandidateFromRow, dedupeCandidates, sortByProbDesc } = require("./nbaOpportunityCandidates")
const { mineNbaExtendedOpportunityPools } = require("./nbaExtendedOpportunityPools")
const { applyEdgeToNbaRows } = require("./applyNbaRowEdge")

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
    ladder: 0.52,
    core: 0.58,
    edge: 0.02,
    doubleDouble: 0.48,
    tripleDouble: 0.28,
  }

  const ladderCandidates = []
  for (const row of ladderBoard) {
    const c = ladderCandidateFromRow(row)
    if (!c) continue
    if (c.probability < TH.ladder) continue
    if (c.edge != null && c.edge < TH.edge) continue
    ladderCandidates.push(c)
  }

  const coreCandidates = []
  for (const row of corePropsBoard) {
    const c = ladderCandidateFromRow(row)
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
      const c = ladderCandidateFromRow(row)
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
      const c = ladderCandidateFromRow(row)
      if (!c) continue
      if (c.probability < TH.ladder) continue
      ladderUniverse.push(c)
    }
  }

  const primaryLadders = dedupeCandidates([...ladderCandidates, ...ladderUniverse]).sort(sortByProbDesc)

  // Grouped mirrors of MLB board keys (consumer: scripts/runNbaNight.js)
  const pointsLadderCandidates = primaryLadders.filter((c) => /points/i.test(String(c.propType)))
  const reboundsLadderCandidates = primaryLadders.filter((c) => /rebounds/i.test(String(c.propType)))
  const assistsLadderCandidates = primaryLadders.filter((c) => /assists/i.test(String(c.propType)))
  const threesLadderCandidates = primaryLadders.filter((c) => /three|3-pt|3pt/i.test(String(c.propType)))
  const praLadderCandidates = primaryLadders.filter((c) => /pra/i.test(String(c.propType)))

  const extended = mineNbaExtendedOpportunityPools(completeUniverse, TH)

  const resolvedCore = dedupeCandidates(coreCandidates).sort(sortByProbDesc)

  return {
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
}

module.exports = {
  buildNbaOpportunityBoard,
}
