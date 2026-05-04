"use strict"

const { inferPropLaneKey } = require("./nbaPropLanes")
const {
  countIngestStatFamilies,
  ingestHardFailures,
  uniqueMarketKeysFromRows,
} = require("./nbaIngestStatFamilies")

function countBy(rows, keyFn) {
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue
    const k = String(keyFn(r) || "unknown").trim() || "unknown"
    m.set(k, (m.get(k) || 0) + 1)
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))
}

function countByPropType(rows) {
  return countBy(rows, (r) => String(r.propType || "").trim() || String(r.marketKey || "").trim())
}

function countByMarketKey(rows) {
  return countBy(rows, (r) => String(r.marketKey || "").trim() || "unknown")
}

function countByLane(rows) {
  return countBy(rows, (r) => inferPropLaneKey(r) || "unclassified")
}

function sampleRows(rows, n = 5) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, n)
    .map((r) => ({
      player: r.player,
      propType: r.propType,
      marketKey: r.marketKey,
      line: r.line,
      book: r.book,
    }))
}

/**
 * Structured audit object for ingest → board → AI → slips.
 * Set env NBA_PIPELINE_AUDIT=1 to print stages from buildNbaOpportunityBoard.
 */
function buildNbaPipelineAudit({
  label = "audit",
  ingestRows = [],
  ingestCoverage = null,
  requestedBaseMarkets = [],
  requestedExtraMarkets = [],
  completeUniverse = [],
  ladderBoard = [],
  corePropsBoard = [],
  opportunityBoard = null,
  aiPicks = null,
  aiSlips = null,
} = {}) {
  const ingestArr = Array.isArray(ingestRows) ? ingestRows : []
  const ingestStatFamilies = countIngestStatFamilies(ingestArr)
  const ingestHardZero = ingestHardFailures(ingestStatFamilies)
  const ingestMarketKeysUnique = uniqueMarketKeysFromRows(ingestArr)

  const uni = Array.isArray(completeUniverse) ? completeUniverse : []
  const mk = countByMarketKey(uni)
  const threesCt =
    (mk.player_threes || 0) +
    (mk.player_threes_alternate || 0) +
    Object.entries(mk).reduce((s, [k, v]) => (String(k).includes("three") ? s + v : s), 0)
  const fbCt =
    (mk.player_first_basket || 0) +
    (mk.player_first_team_basket || 0) +
    Object.entries(mk).reduce((s, [k, v]) => (String(k).includes("first_basket") ? s + v : s), 0)

  const issues = []
  for (const z of ingestHardZero) issues.push(`ingest_hard_zero:${z}`)
  if (threesCt === 0) issues.push("threes_count_zero")
  if (fbCt === 0) issues.push("first_basket_count_zero")

  if (opportunityBoard) {
    const pool = [
      ...(opportunityBoard.ladderCandidates || []),
      ...(opportunityBoard.coreCandidates || []),
      ...(opportunityBoard.praCandidates || []),
      ...(opportunityBoard.altThreesCandidates || []),
      ...(opportunityBoard.comboCandidates || []),
      ...(opportunityBoard.firstBasketCandidates || []),
    ]
    const byPlayer = countBy(pool, (r) => String(r.player || "").trim().toLowerCase())
    // Stars legitimately appear across many ladder rows; only flag extreme duplication.
    const dupPlayers = Object.entries(byPlayer).filter(([, c]) => c > 28)
    if (dupPlayers.length) issues.push("high_per_player_density")

    const thLad = (opportunityBoard.threesLadderCandidates || []).length
    if (thLad === 0 && threesCt > 0 && (opportunityBoard.ladderCandidates || []).length > 0) {
      issues.push("threes_ladder_pool_empty_despite_ingest")
    }
  }

  if (aiPicks) {
    const elite = [...(aiPicks.elite || []), ...(aiPicks.strong || [])]
    const pkSeen = new Map()
    for (const p of elite) {
      const k = String(p.player || "")
        .trim()
        .toLowerCase()
      if (!k) continue
      pkSeen.set(k, (pkSeen.get(k) || 0) + 1)
    }
    const dup = [...pkSeen.entries()].filter(([, n]) => n > 3)
    if (dup.length) issues.push("excessive_same_player_in_ai_tiers")
  }

  return {
    label,
    phase1Ingest: {
      marketsRequested: { base: requestedBaseMarkets, extra: requestedExtraMarkets },
      marketKeysReturnedUnique: ingestMarketKeysUnique,
      countsByStatFamily: ingestStatFamilies,
      ingestHardZeroFamilies: ingestHardZero,
    },
    totals: {
      ingestRows: ingestArr.length,
      completeUniverse: uni.length,
      ladderBoard: Array.isArray(ladderBoard) ? ladderBoard.length : 0,
      corePropsBoard: Array.isArray(corePropsBoard) ? corePropsBoard.length : 0,
    },
    requestedMarkets: {
      base: requestedBaseMarkets,
      extra: requestedExtraMarkets,
    },
    ingestCoverage: ingestCoverage || null,
    universeByMarketKeyTop: Object.fromEntries(Object.entries(mk).slice(0, 24)),
    universeByPropType: countByPropType(uni),
    universeByLane: countByLane(uni),
    samples: {
      universe: sampleRows(uni, 4),
      ladder: sampleRows(ladderBoard, 3),
    },
    opportunity: opportunityBoard
      ? {
          ladderCandidates: (opportunityBoard.ladderCandidates || []).length,
          coreCandidates: (opportunityBoard.coreCandidates || []).length,
          threesLadderCandidates: (opportunityBoard.threesLadderCandidates || []).length,
          firstBasketCandidates: (opportunityBoard.firstBasketCandidates || []).length,
          comboCandidates: (opportunityBoard.comboCandidates || []).length,
        }
      : null,
    threesSignal: { ingestThreesRows: threesCt, issues: issues.filter((i) => i.includes("threes")) },
    firstBasketSignal: { ingestFbRows: fbCt, issues: issues.filter((i) => i.includes("first_basket")) },
    issues,
  }
}

function maybeLogNbaPipelineAudit(audit) {
  if (String(process.env.NBA_PIPELINE_AUDIT || "").trim() !== "1") return
  console.log("\n[NBA_PIPELINE_AUDIT]", audit.label)
  console.log(JSON.stringify(audit, null, 2))
}

module.exports = {
  buildNbaPipelineAudit,
  maybeLogNbaPipelineAudit,
  countByMarketKey,
  countByPropType,
  sampleRows,
}
