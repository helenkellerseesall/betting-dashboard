"use strict"

const { dedupeCandidates } = require("./nbaOpportunityCandidates")
const { statFamilyKey, isSpecialStatFamily } = require("./nbaAiOutcomeRange")
const { playerKey, statScoreRow, inferVolumeArchetype } = require("./nbaAiStatFamilyRank")

function eventKey(c) {
  return String(c?.eventId || "").trim()
}

const ELITE_RATIO = 0.95
/** Star scorers: drop assists/threes/other below this × primary. */
const HARD_DROP_PERIPHERAL_STAR = 0.9
/** Non–star-scorer pools: slightly looser for real secondaries (e.g. guard assists). */
const HARD_DROP_PERIPHERAL_DEFAULT = 0.84
/** Drop dead core lines only (never used to split points vs PRA). */
const HARD_DROP_CORE_FLOOR = 0.68

function bucketKeyForRow(c) {
  const pk = playerKey(c)
  const ek = eventKey(c)
  if (!pk || !ek) return null
  return `${pk}\u0001${ek}`
}

/**
 * Per (player, event): primaryStatScore = max family best statScoreRow.
 * Families with best < primary × 0.90 are dropped from the pool entirely.
 * Families with best in [0.90, 0.95)×primary are elite-blocked only (strong / range still allowed if row kept).
 */
function analyzeDominanceGapFromPool(mergedPool) {
  const metaByBucket = new Map()
  const eliteBlockedKeys = new Set()

  const byPe = new Map()
  for (const c of mergedPool) {
    const bk = bucketKeyForRow(c)
    if (!bk) continue
    if (!byPe.has(bk)) byPe.set(bk, [])
    byPe.get(bk).push(c)
  }

  for (const [bk, rows] of byPe.entries()) {
    const vol = inferVolumeArchetype(rows)
    const familyBest = new Map()
    for (const r of rows) {
      const f = statFamilyKey(r)
      if (f === "other" || isSpecialStatFamily(f)) continue
      const sc = statScoreRow(r, vol)
      const prev = familyBest.get(f)
      if (prev == null || sc > prev) familyBest.set(f, sc)
    }
    if (!familyBest.size) continue

    const primaryStatScore = Math.max(...familyBest.values())
    const dropFamilies = new Set()
    const eliteBlockedFamilies = new Set()

    const peripheralDrop = vol === "HIGH_USAGE_SCORER" ? HARD_DROP_PERIPHERAL_STAR : HARD_DROP_PERIPHERAL_DEFAULT

    for (const [f, best] of familyBest.entries()) {
      // Threes: never hard-drop from merged pools — book 3PM ladders must remain addressable.
      // Elite tier still gates weak 3PM vs primary via eliteBlockedFamilies (ELITE_RATIO).
      const isPeripheral = f === "assists" || f === "other"
      let hardDrop = false
      if (f === "threes") {
        // no hardDrop
      } else if (isPeripheral) {
        if (best < primaryStatScore * peripheralDrop - 1e-9) hardDrop = true
      } else if (best < primaryStatScore * HARD_DROP_CORE_FLOOR - 1e-9) {
        hardDrop = true
      }
      if (hardDrop) dropFamilies.add(f)
      else if (best < primaryStatScore * ELITE_RATIO - 1e-9) eliteBlockedFamilies.add(f)
    }

    const sep = bk.indexOf("\u0001")
    const pk = sep === -1 ? bk : bk.slice(0, sep)
    const ek = sep === -1 ? "" : bk.slice(sep + 1)
    for (const f of eliteBlockedFamilies) {
      eliteBlockedKeys.add(`${pk}|${ek}|${f}`)
    }

    metaByBucket.set(bk, { dropFamilies, eliteBlockedFamilies, primaryStatScore })
  }

  return { metaByBucket, eliteBlockedKeys }
}

function rowAllowedAfterDominanceGap(row, metaByBucket) {
  const bk = bucketKeyForRow(row)
  if (!bk) return true
  const m = metaByBucket.get(bk)
  if (!m) return true
  const f = statFamilyKey(row)
  if (f === "other" || isSpecialStatFamily(f)) return true
  return !m.dropFamilies.has(f)
}

/**
 * Filter one candidate list using dominance metadata (drops < 0.90×primary families).
 */
function filterCandidateList(arr, metaByBucket) {
  if (!Array.isArray(arr) || !arr.length) return arr || []
  return arr.filter((r) => rowAllowedAfterDominanceGap(r, metaByBucket))
}

/**
 * Merge all pools that feed AI picks + outcome range, analyze once, filter lists in place.
 * Sets `boardPayload.dominanceGapEliteBlockedKeys` for buildNbaAiPicks elite gating.
 */
function applyDominanceGapToOpportunityBoard(boardPayload) {
  if (!boardPayload || typeof boardPayload !== "object") return boardPayload

  const merged = dedupeCandidates(
    []
      .concat(boardPayload.ladderCandidates || [])
      .concat(boardPayload.coreCandidates || [])
      .concat(boardPayload.praCandidates || [])
      .concat(boardPayload.altThreesCandidates || [])
      .concat(boardPayload.altPointsCandidates || [])
      .concat(boardPayload.comboCandidates || [])
      .concat(boardPayload.doubleDoubleCandidates || [])
      .concat(boardPayload.tripleDoubleCandidates || [])
      .concat(boardPayload.firstBasketCandidates || [])
  )

  if (!merged.length) {
    boardPayload.dominanceGapEliteBlockedKeys = new Set()
    boardPayload.dominanceGapPoolFiltered = true
    return boardPayload
  }

  const { metaByBucket, eliteBlockedKeys } = analyzeDominanceGapFromPool(merged)

  boardPayload.ladderCandidates = filterCandidateList(boardPayload.ladderCandidates, metaByBucket)
  boardPayload.coreCandidates = filterCandidateList(boardPayload.coreCandidates, metaByBucket)
  boardPayload.praCandidates = filterCandidateList(boardPayload.praCandidates, metaByBucket)
  boardPayload.altThreesCandidates = filterCandidateList(boardPayload.altThreesCandidates, metaByBucket)
  boardPayload.altPointsCandidates = filterCandidateList(boardPayload.altPointsCandidates, metaByBucket)
  boardPayload.comboCandidates = filterCandidateList(boardPayload.comboCandidates, metaByBucket)
  boardPayload.doubleDoubleCandidates = filterCandidateList(boardPayload.doubleDoubleCandidates, metaByBucket)
  boardPayload.tripleDoubleCandidates = filterCandidateList(boardPayload.tripleDoubleCandidates, metaByBucket)
  boardPayload.firstBasketCandidates = filterCandidateList(boardPayload.firstBasketCandidates, metaByBucket)

  boardPayload.pointsLadderCandidates = (boardPayload.pointsLadderCandidates || []).filter((r) =>
    rowAllowedAfterDominanceGap(r, metaByBucket)
  )
  boardPayload.reboundsLadderCandidates = (boardPayload.reboundsLadderCandidates || []).filter((r) =>
    rowAllowedAfterDominanceGap(r, metaByBucket)
  )
  boardPayload.assistsLadderCandidates = (boardPayload.assistsLadderCandidates || []).filter((r) =>
    rowAllowedAfterDominanceGap(r, metaByBucket)
  )
  boardPayload.threesLadderCandidates = (boardPayload.threesLadderCandidates || []).filter((r) =>
    rowAllowedAfterDominanceGap(r, metaByBucket)
  )
  boardPayload.praLadderCandidates = (boardPayload.praLadderCandidates || []).filter((r) =>
    rowAllowedAfterDominanceGap(r, metaByBucket)
  )

  boardPayload.dominanceGapEliteBlockedKeys = eliteBlockedKeys
  boardPayload.dominanceGapPoolFiltered = true
  return boardPayload
}

/**
 * Standalone: filter a flat pool (e.g. tests) and return elite-block keys.
 */
function filterPoolByDominanceGap(pool) {
  const merged = dedupeCandidates(pool)
  const { metaByBucket, eliteBlockedKeys } = analyzeDominanceGapFromPool(merged)
  const out = merged.filter((r) => rowAllowedAfterDominanceGap(r, metaByBucket))
  return { pool: out, eliteBlockedKeys }
}

module.exports = {
  analyzeDominanceGapFromPool,
  applyDominanceGapToOpportunityBoard,
  filterPoolByDominanceGap,
  ELITE_RATIO,
  HARD_DROP_PERIPHERAL_STAR,
  HARD_DROP_PERIPHERAL_DEFAULT,
  HARD_DROP_CORE_FLOOR,
}
