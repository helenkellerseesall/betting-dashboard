"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(s) {
  return String(s || "").trim().toLowerCase()
}

function isUnderSide(row) {
  const s = norm(row?.side ?? row?.__src?.side)
  return s === "under" || s === "no"
}

function getEventId(row) {
  const ev = String(row?.eventId ?? row?.__src?.eventId ?? row?.__src?.gameId ?? row?.gameId ?? "").trim()
  return ev || null
}

function isHighUpsideRow(row, bucket) {
  const odds = toNum(row?.odds)
  if (bucket === "hr") return true
  return odds != null && odds >= 300
}

function isMediumUpsideRow(row) {
  const odds = toNum(row?.odds)
  return odds != null && odds >= 180 && odds <= 299
}

function sortByProbThenOddsDesc(a, b) {
  const pA = toNum(a?.predictedProbability) ?? -999
  const pB = toNum(b?.predictedProbability) ?? -999
  if (pB !== pA) return pB - pA
  const oA = toNum(a?.odds) ?? -999
  const oB = toNum(b?.odds) ?? -999
  return oB - oA
}

function uniqByKey(rows, keyFn) {
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = keyFn(r)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

function projectRow(row, bucket) {
  return {
    player: row?.player ?? null,
    team: row?.team ?? null,
    propType: row?.propType ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    eventId: getEventId(row),
    isHighUpside: Boolean(isHighUpsideRow(row, bucket))
  }
}

function buildMlbPropClusters(rows, opts = {}) {
  if (!Array.isArray(rows)) {
    return {
      hrCluster: [],
      rbiCluster: [],
      tbCluster: [],
      hitsCluster: []
    }
  }

  console.log("[MLB PROP CLUSTERS]", {
    rows: rows.length
  })

  const hrTarget = Math.max(6, Math.min(10, Number(opts.hrTarget ?? 8)))
  const rbiTarget = Math.max(1, Math.min(25, Number(opts.rbiTarget ?? 8)))
  const tbTarget = Math.max(1, Math.min(25, Number(opts.tbTarget ?? 8)))
  const hitsTarget = Math.max(1, Math.min(25, Number(opts.hitsTarget ?? 8)))

  let total = 0
  let afterEvent = 0
  let afterType = 0

  const base = (Array.isArray(rows) ? rows : []).filter((row) => {
    total += 1
    if (!row) return false
    if (!String(row?.player || "").trim()) return false
    const rawPropType = String(row?.propType || "")
    const propType = rawPropType.toLowerCase().replace(/[^a-z]/g, "")
    if (!propType.trim()) return false
    const odds = Number(row?.odds)
    const line = toNum(row?.line)
    if (!Number.isFinite(odds) || line == null) return false
    const ev = getEventId(row)
    if (!ev) return false
    afterEvent += 1
    if (isUnderSide(row)) return false
    const isHR = propType.includes("homerun")
    const isRBI = propType.includes("rbi")
    const isTB = propType.includes("totalbase") || propType.includes("tb")
    const isHits = propType.includes("hit")
    if (isHR || isRBI || isTB || isHits) afterType += 1
    return true
  })

  console.log("[PROP CLUSTER DEBUG]", {
    total,
    afterEvent,
    afterType
  })

  const byBucket = {
    hr: [],
    rbi: [],
    tb: [],
    hits: []
  }

  for (const row of base) {
    const rawPropType = String(row?.propType || "")
    const propType = rawPropType.toLowerCase().replace(/[^a-z]/g, "")

    const isHR = propType.includes("homerun")
    const isRBI = propType.includes("rbi")
    const isTB = propType.includes("totalbase") || propType.includes("tb")
    const isHits = propType.includes("hit")

    if (isHR) byBucket.hr.push(row)
    else if (isRBI) byBucket.rbi.push(row)
    else if (isTB) byBucket.tb.push(row)
    else if (isHits) byBucket.hits.push(row)
  }

  const dedupeKey = (r) => [getEventId(r), norm(r?.player), norm(r?.propType), String(r?.line ?? "")].join("|")
  byBucket.hr = uniqByKey(byBucket.hr, dedupeKey)
  byBucket.rbi = uniqByKey(byBucket.rbi, dedupeKey)
  byBucket.tb = uniqByKey(byBucket.tb, dedupeKey)
  byBucket.hits = uniqByKey(byBucket.hits, dedupeKey)

  // === HR cluster ===
  const hrCluster = [...byBucket.hr].sort(sortByProbThenOddsDesc).slice(0, hrTarget).map((r) => projectRow(r, "hr"))

  // === RBI cluster (require impliedTeamTotal >= 4.5) ===
  const rbiCluster = [...byBucket.rbi]
    .filter((r) => {
      const itt = toNum(r?.impliedTeamTotal)
      return itt != null && itt >= 4.5
    })
    .sort(sortByProbThenOddsDesc)
    .slice(0, rbiTarget)
    .map((r) => projectRow(r, "rbi"))

  // === TB cluster (prefer line >= 3.5) ===
  const tbSorted = [...byBucket.tb].sort((a, b) => {
    const aPref = (toNum(a?.line) ?? -999) >= 3.5 ? 1 : 0
    const bPref = (toNum(b?.line) ?? -999) >= 3.5 ? 1 : 0
    if (bPref !== aPref) return bPref - aPref
    return sortByProbThenOddsDesc(a, b)
  })
  const tbCluster = tbSorted.slice(0, tbTarget).map((r) => projectRow(r, "tb"))

  // === Hits cluster (prefer line >= 2.5) ===
  const hitsSorted = [...byBucket.hits].sort((a, b) => {
    const aPref = (toNum(a?.line) ?? -999) >= 2.5 ? 1 : 0
    const bPref = (toNum(b?.line) ?? -999) >= 2.5 ? 1 : 0
    if (bPref !== aPref) return bPref - aPref
    return sortByProbThenOddsDesc(a, b)
  })
  const hitsCluster = hitsSorted.slice(0, hitsTarget).map((r) => projectRow(r, "hits"))

  console.log("[PROP TYPE SAMPLE]", rows.slice(0, 5).map((r) => r?.propType))

  return {
    hrCluster,
    rbiCluster,
    tbCluster,
    hitsCluster
  }
}

module.exports = { buildMlbPropClusters }

