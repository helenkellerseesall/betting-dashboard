"use strict"

const { scoreMlbProp } = require("./scoreMlbProp")

const BUCKET_KEYS = ["hits", "hr", "tb", "rbi"]
const MAX_JUICE = -250

/**
 * Phase 3 MLB clustering: bucket scored rows by stat category, sort by score desc, cap 25.
 * @param {object[]} rows
 * @returns {{ hits: object[], hr: object[], tb: object[], rbi: object[] }}
 */
function buildMlbClusters(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const valid = safeRows.filter(
    (row) => row && row.propType != null && String(row.propType).trim() !== "" && row.odds != null
  )

  const impliedProbabilityFromRow = (row) => {
    const explicit = Number(row?.impliedProbability)
    if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit
    const odds = Number(row?.odds)
    if (!Number.isFinite(odds) || odds === 0) return null
    if (odds > 0) return 100 / (odds + 100)
    return Math.abs(odds) / (Math.abs(odds) + 100)
  }

  let afterEdgeFilter = 0
  let afterJuiceFilter = 0

  const buckets = { hits: [], hr: [], tb: [], rbi: [] }

  for (const row of valid) {
    const odds = Number(row?.odds)

    // Keep juice sanity (do not starve the MLB prop universe).
    if (Number.isFinite(odds) && odds < MAX_JUICE) continue
    afterJuiceFilter += 1

    const { score, confidence, category } = scoreMlbProp(row)
    if (!category || !buckets[category]) continue
    buckets[category].push({
      ...row,
      mlbPhase3Score: score,
      mlbPhase3Confidence: confidence,
      mlbPhase3Category: category
    })
  }

  for (const key of BUCKET_KEYS) {
    buckets[key].sort((a, b) => Number(b.mlbPhase3Score || 0) - Number(a.mlbPhase3Score || 0))
    buckets[key] = buckets[key].slice(0, 25)
  }

  const finalPlayableRows =
    (Array.isArray(buckets.hits) ? buckets.hits.length : 0) +
    (Array.isArray(buckets.hr) ? buckets.hr.length : 0) +
    (Array.isArray(buckets.tb) ? buckets.tb.length : 0) +
    (Array.isArray(buckets.rbi) ? buckets.rbi.length : 0)

  console.log("[MLB PHASE3 FIX]", {
    totalRowsBefore: safeRows.length,
    validRows: valid.length,
    afterEdgeFilter,
    afterJuiceFilter,
    finalPlayableRows
  })

  return buckets
}

module.exports = { buildMlbClusters }
