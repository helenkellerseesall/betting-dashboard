"use strict"

const { buildMlbClusters } = require("./buildMlbClusters")

function dedupeByPlayerPropType(rows) {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = `${String(row?.player || "").trim().toLowerCase()}|${String(row?.propType || "").trim()}`
    if (!key || key === "|") continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Phase 3 MLB “best props”: top picks per category, merged + deduped.
 * @param {object[]} rows
 * @param {{ hits: object[], hr: object[], tb: object[], rbi: object[] }|null} clustersIn — optional pre-built clusters to avoid duplicate work
 * @returns {object[]}
 */
function buildMlbBestProps(rows, clustersIn = null) {
  const clusters = clustersIn || buildMlbClusters(rows)
  const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : [])

  const merged = [
    ...take(clusters.hits, 10),
    ...take(clusters.hr, 10),
    ...take(clusters.tb, 10),
    ...take(clusters.rbi, 10)
  ]

  return dedupeByPlayerPropType(merged)
}

module.exports = { buildMlbBestProps }
