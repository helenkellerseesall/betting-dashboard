"use strict"

const { scoreMlbProp } = require("./scoreMlbProp")

const BUCKET_KEYS = ["hits", "hr", "tb", "rbi"]

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

  const buckets = { hits: [], hr: [], tb: [], rbi: [] }

  for (const row of valid) {
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

  return buckets
}

module.exports = { buildMlbClusters }
