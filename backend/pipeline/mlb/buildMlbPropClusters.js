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

function normalizePropTypeKey(row) {
  return String(row?.propType || "").toLowerCase().replace(/[^a-z]/g, "")
}

function classifyRowBuckets(propType) {
  const isHR = propType.includes("homerun") || propType.includes("hr")
  const isRBI = propType.includes("rbi")
  const isTB = propType.includes("totalbase") || propType.includes("tb")
  const isHits = propType.includes("hit")
  return { isHR, isRBI, isTB, isHits, propType }
}

function passesHardQualityFilter(row, { isHR, isRBI, isTB, isHits }) {
  const pred = toNum(row?.predictedProbability)
  const edge = toNum(row?.edgeProbability)
  const decision = toNum(row?.decisionScore)
  const itt = toNum(row?.impliedTeamTotal)
  const lp = toNum(row?.lineupPosition)

  if (isHits || isTB) {
    return (pred != null && pred >= 0.45) || (decision != null && decision >= 0.5)
  }
  if (isRBI) {
    return (
      itt != null &&
      itt >= 4.5 &&
      (lp == null || lp <= 5)
    )
  }
  if (isHR) {
    return (pred != null && pred >= 0.12) || (edge != null && edge >= 0.08)
  }
  return false
}

function computeHrClusterScore(row) {
  const pred = toNum(row?.predictedProbability) ?? 0
  const edge = toNum(row?.edgeProbability) ?? 0
  const odds = toNum(row?.odds) ?? 0
  let hrScore = pred * 0.5 + edge * 0.3 + Math.min(odds / 1000, 1) * 0.2
  if (pred < 0.08) hrScore *= 0.5
  return Number(hrScore) || 0
}

function computeRbiClusterScore(row) {
  let score = 0

  const predicted = Number(row?.predictedProbability || 0)
  const edge = Number(row?.edgeProbability || 0)
  const decision = Number(row?.decisionScore || 0)
  const teamTotal = Number(row?.impliedTeamTotal || 0)
  const lineup = Number(row?.lineupPosition || 9)
  const platoon = row?.isPlatoonAdvantage ? 1 : 0
  const odds = Number(row?.odds || 0)

  score += predicted * 5
  score += edge * 4
  score += decision * 2

  score += teamTotal * 1.5

  if (lineup <= 5) score += 2
  if (lineup <= 3) score += 1

  if (platoon) score += 1

  score += Math.min(odds / 200, 2)

  return Number(score) || 0
}

/** Pick score for “best prop per player” across buckets (each row only matches one bucket). */
function clusterPickScoreForRow(row, { isHR, isRBI, isTB, isHits }) {
  if (isHR) return computeHrClusterScore(row)
  if (isRBI) return computeRbiClusterScore(row)
  if (isTB || isHits) {
    const p = toNum(row?.predictedProbability) ?? 0
    const e = toNum(row?.edgeProbability) ?? 0
    const d = toNum(row?.decisionScore) ?? 0
    const o = toNum(row?.odds) ?? 0
    return p * 2 + e * 2 + d * 2 + Math.min(o / 1000, 1) * 0.15
  }
  return 0
}

function sortControlledFinal(a, b) {
  const predA = toNum(a?.predictedProbability)
  const predB = toNum(b?.predictedProbability)
  const pA = predA != null ? predA : -1
  const pB = predB != null ? predB : -1
  if (pB !== pA) return pB - pA

  const edgeA = toNum(a?.edgeProbability)
  const edgeB = toNum(b?.edgeProbability)
  const eA = edgeA != null ? edgeA : -1
  const eB = edgeB != null ? edgeB : -1
  if (eB !== eA) return eB - eA

  const decA = toNum(a?.decisionScore)
  const decB = toNum(b?.decisionScore)
  const dA = decA != null ? decA : -1
  const dB = decB != null ? decB : -1
  if (dB !== dA) return dB - dA

  const oA = toNum(a?.odds)
  const oB = toNum(b?.odds)
  const oddsA = oA != null ? oA : 1e9
  const oddsB = oB != null ? oB : 1e9
  return oddsA - oddsB
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

function computeMixSliceSizes({ hitsTarget, tbTarget, rbiTarget, hrTarget }) {
  const T = hitsTarget + tbTarget + rbiTarget + hrTarget
  const minNonHr = 4

  let slotHitsTb = Math.round(0.4 * T)
  let slotRbi = Math.round(0.35 * T)
  let slotHr = Math.round(0.25 * T)

  const drift = T - (slotHitsTb + slotRbi + slotHr)
  slotRbi += drift

  const maxNonHrSlots = hitsTarget + tbTarget + rbiTarget
  const nonHrPlanned = Math.min(maxNonHrSlots, slotHitsTb + slotRbi)
  if (nonHrPlanned < minNonHr) {
    const deficit = minNonHr - nonHrPlanned
    slotHr = Math.max(0, slotHr - deficit)
  }
  slotHr = Math.min(slotHr, hrTarget, Math.max(0, T - minNonHr))

  const denom = hitsTarget + tbTarget || 1
  let hitsSlice = Math.min(hitsTarget, Math.round(slotHitsTb * (hitsTarget / denom)))
  let tbSlice = Math.min(tbTarget, Math.max(0, slotHitsTb - hitsSlice))
  if (hitsSlice === 0 && hitsTarget > 0 && slotHitsTb > 0) hitsSlice = Math.min(hitsTarget, slotHitsTb)
  if (tbSlice === 0 && tbTarget > 0 && slotHitsTb > 0) tbSlice = Math.min(tbTarget, slotHitsTb - hitsSlice)
  hitsSlice = Math.min(hitsSlice, hitsTarget)
  tbSlice = Math.min(tbSlice, tbTarget)
  let rbiSlice = Math.min(rbiTarget, slotRbi)
  let hrSlice = Math.min(hrTarget, slotHr)

  const used = hitsSlice + tbSlice + rbiSlice + hrSlice
  if (used < T) {
    const extra = T - used
    rbiSlice = Math.min(rbiTarget, rbiSlice + extra)
  }

  return { hitsSlice, tbSlice, rbiSlice, hrSlice }
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
    const { isHR, isRBI, isTB, isHits } = classifyRowBuckets(propType)
    if (isHR || isRBI || isTB || isHits) afterType += 1
    return true
  })

  console.log("[PROP CLUSTER DEBUG]", {
    total,
    afterEvent,
    afterType
  })

  const filteredRows = []
  for (const row of base) {
    const { isHR, isRBI, isTB, isHits, propType } = classifyRowBuckets(normalizePropTypeKey(row))
    if (!(isHR || isRBI || isTB || isHits)) continue
    if (!passesHardQualityFilter(row, { isHR, isRBI, isTB, isHits })) continue
    filteredRows.push(row)
  }

  const scoredForPick = filteredRows
    .map((row) => {
      const { isHR, isRBI, isTB, isHits } = classifyRowBuckets(normalizePropTypeKey(row))
      const score = clusterPickScoreForRow(row, { isHR, isRBI, isTB, isHits })
      return { row, score, isHR, isRBI, isTB, isHits }
    })
    .sort((a, b) => b.score - a.score)

  const bestPropByPlayer = {}
  for (const { row, score, isHR, isRBI, isTB, isHits } of scoredForPick) {
    const playerKey = norm(row?.player)
    if (!playerKey) continue
    const prev = bestPropByPlayer[playerKey]
    if (!prev || score > prev.score) {
      bestPropByPlayer[playerKey] = { row, score, isHR, isRBI, isTB, isHits }
    }
  }

  const dedupedRows = Object.values(bestPropByPlayer).map((x) => x.row)

  console.log("[CONTROLLED AGGRESSION]", {
    totalRows: rows.length,
    afterFilter: filteredRows.length,
    playersSelected: Object.keys(bestPropByPlayer).length
  })

  const byBucket = {
    hr: [],
    rbi: [],
    tb: [],
    hits: []
  }

  for (const row of dedupedRows) {
    const { isHR, isRBI, isTB, isHits } = classifyRowBuckets(normalizePropTypeKey(row))
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

  const { hitsSlice, tbSlice, rbiSlice, hrSlice } = computeMixSliceSizes({
    hitsTarget,
    tbTarget,
    rbiTarget,
    hrTarget
  })

  const hrRowsSorted = [...byBucket.hr].filter((row) => {
    if (!String(row?.player || "").trim()) return false
    const odds = Number(row?.odds)
    return Number.isFinite(odds)
  }).sort(sortControlledFinal)

  let hrCluster = hrRowsSorted.slice(0, hrSlice).map((row) => {
    const hrClusterScore = computeHrClusterScore(row)
    return {
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
    }
  })

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

  const rbiRowsSorted = [...byBucket.rbi].filter((row) => {
    const itt = toNum(row?.impliedTeamTotal)
    return itt != null && itt >= 4.5
  }).sort(sortControlledFinal)

  const rbiOut = rbiRowsSorted.slice(0, rbiSlice).map((row) => {
    const rbiClusterScore = computeRbiClusterScore(row)
    return {
      player: row?.player ?? null,
      team: row?.team ?? null,
      propType: row?.propType ?? null,
      line: row?.line ?? null,
      odds: row?.odds ?? null,
      eventId: getEventId(row),
      isHighUpside: Boolean(isHighUpsideRow(row, "rbi")),
      rbiClusterScore,
      predictedProbability: row?.predictedProbability ?? null,
      edgeProbability: row?.edgeProbability ?? null,
      impliedTeamTotal: row?.impliedTeamTotal ?? null,
      lineupPosition: row?.lineupPosition ?? null,
      isPlatoonAdvantage: row?.isPlatoonAdvantage ?? null
    }
  })

  console.log("[RBI CLUSTER DEBUG]", rbiOut.slice(0, 10).map((r) => ({
    player: r.player,
    odds: r.odds,
    score: r.rbiClusterScore,
    teamTotal: r.impliedTeamTotal,
    lineup: r.lineupPosition
  })))

  const tbSorted = [...byBucket.tb].sort(sortControlledFinal)
  const tbCluster = tbSorted.slice(0, tbSlice).map((r) => projectRow(r, "tb"))

  const hitsSorted = [...byBucket.hits].sort(sortControlledFinal)
  const hitsCluster = hitsSorted.slice(0, hitsSlice).map((r) => projectRow(r, "hits"))

  console.log("[PROP TYPE SAMPLE]", rows.slice(0, 5).map((r) => r?.propType))

  return {
    hrCluster: hrCluster || [],
    rbiCluster: rbiOut || [],
    tbCluster: tbCluster || [],
    hitsCluster: hitsCluster || []
  }
}

module.exports = { buildMlbPropClusters }
