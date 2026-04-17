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

function computeHrClusterScore(row) {
  const pred = toNum(row?.predictedProbability) ?? 0
  const edge = toNum(row?.edgeProbability) ?? 0
  const decision = toNum(row?.decisionScore) ?? 0
  const itt = toNum(row?.impliedTeamTotal) ?? 0
  const lineupPos = toNum(row?.lineupPosition)
  const platoon = row?.isPlatoonAdvantage === true ? 1 : 0
  const odds = toNum(row?.odds) ?? 0

  // Normalize pieces into roughly comparable ranges.
  const predScore = Math.max(0, Math.min(1, pred)) * 6.0
  const edgeScore = Math.max(-0.08, Math.min(0.12, edge)) * 18.0 // -1.44..2.16
  const decisionScore = Math.max(0, Math.min(1, decision)) * 3.0

  // Environment: 4.0+ team total matters, but shouldn’t dominate.
  const envScore = Math.max(0, Math.min(2.0, itt - 3.6)) * 1.25 // 0..2.5

  // Lineup: prefer 1–5, then 6–7 mild, otherwise neutral.
  let lineupScore = 0
  if (Number.isFinite(lineupPos)) {
    if (lineupPos >= 1 && lineupPos <= 5) lineupScore = 1.2
    else if (lineupPos >= 6 && lineupPos <= 7) lineupScore = 0.5
    else lineupScore = 0
  }

  const platoonScore = platoon ? 0.6 : 0

  // Odds: upside matters, but must not dominate. Cap influence heavily.
  const oddsBoost = Math.max(0, Math.min(1.0, (odds - 250) / 600)) * 0.9 // 0..0.9

  // Light sanity: penalize extreme longshots unless supported by probability.
  const longshotPenalty = (odds >= 800 && pred < 0.12) ? -0.8 : (odds >= 650 && pred < 0.1) ? -0.45 : 0

  const score = predScore + edgeScore + decisionScore + envScore + lineupScore + platoonScore + oddsBoost + longshotPenalty
  return Number(score) || 0
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
  let hrCluster = []

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
    const isHR = propType.includes("homerun") || propType.includes("hr")
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

    const isHR = propType.includes("homerun") || propType.includes("hr")
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

  // === TRUE HR cluster (slate-wide; no team/game/side requirement) ===
  for (const row of rows) {
    const rawPropType = String(row?.propType || "")
    const propType = rawPropType.toLowerCase().replace(/[^a-z]/g, "")
    const isHR = propType.includes("homerun") || propType.includes("hr")
    if (!isHR) continue

    if (!String(row?.player || "").trim()) continue
    const odds = Number(row?.odds)
    if (!Number.isFinite(odds)) continue

    const hrClusterScore = computeHrClusterScore(row)

    hrCluster.push({
      player: row.player,
      team: row.team,
      propType: row.propType,
      line: row.line,
      odds: row.odds,
      eventId:
        row.eventId ||
        row.__src?.eventId ||
        row.gameId ||
        null,
      isHighUpside: row.isHighUpside ?? (Number(row.odds) >= 300),
      hrClusterScore,
      predictedProbability: row.predictedProbability ?? null,
      edgeProbability: row.edgeProbability ?? null,
      impliedTeamTotal: row.impliedTeamTotal ?? null,
      lineupPosition: row.lineupPosition ?? null,
      isPlatoonAdvantage: row.isPlatoonAdvantage ?? null
    })
  }

  hrCluster.sort((a, b) => {
    return (b.hrClusterScore || 0) - (a.hrClusterScore || 0)
  })

  hrCluster = hrCluster.slice(0, 10)
  console.log("[HR CLUSTER SIZE]", hrCluster.length)
  console.log("[HR SCORE CHECK]", hrCluster.slice(0, 5).map((r) => ({
    player: r.player,
    score: r.hrClusterScore
  })))
  console.log("[HR CLUSTER DEBUG]", hrCluster.slice(0, 10).map((r) => ({
    player: r.player,
    odds: r.odds,
    hrClusterScore: r.hrClusterScore,
    predictedProbability: r.predictedProbability,
    edgeProbability: r.edgeProbability,
    impliedTeamTotal: r.impliedTeamTotal,
    lineupPosition: r.lineupPosition,
    isPlatoonAdvantage: r.isPlatoonAdvantage
  })))

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
    hrCluster: hrCluster || [],
    rbiCluster: rbiCluster || [],
    tbCluster: tbCluster || [],
    hitsCluster: hitsCluster || []
  }
}

module.exports = { buildMlbPropClusters }

