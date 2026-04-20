"use strict"

const {
  isHomeRunProp,
  isSpecial,
  isCore,
  classifyPropCategory
} = require("../tracking/buildTrackedCombos")

function normLc(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function americanToDecimal(odds) {
  const o = toNum(odds)
  if (o == null || o === 0) return null
  if (o > 0) return 1 + o / 100
  return 1 + 100 / Math.abs(o)
}

function rowHasSignals(row) {
  return toNum(row?.predictedProbability) != null || toNum(row?.decisionScore) != null
}

function isExtremeLongshot(row) {
  const odds = toNum(row?.odds)
  if (odds == null) return false
  return odds >= 1200
}

function isUpsideEligible(row) {
  const odds = toNum(row?.odds)
  const pred = toNum(row?.predictedProbability)
  const decision = toNum(row?.decisionScore)
  if (odds == null) return false
  if (odds >= 300 && ((pred != null && pred >= 0.08) || (decision != null && decision >= 0.55))) return true
  return false
}

function stableLegKey(row) {
  const ev = String(row?.eventId || row?.__src?.eventId || row?.gameId || "").trim()
  const player = String(row?.player || "").trim()
  const book = String(row?.book || "").trim()
  const propType = String(row?.propType || "").trim()
  const side = String(row?.side || row?.__src?.side || "").trim()
  const line = toNum(row?.line)
  return [ev, player, book, propType, side, line == null ? "" : String(line)].join("|")
}

function dedupeRows(rows) {
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue
    const k = stableLegKey(r)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

function buildPair({ a, b, category }) {
  const p1 = toNum(a?.predictedProbability) ?? 0
  const p2 = toNum(b?.predictedProbability) ?? 0
  const e1 = toNum(a?.edgeProbability) ?? 0
  const e2 = toNum(b?.edgeProbability) ?? 0
  const d1 = toNum(a?.decisionScore) ?? 0
  const d2 = toNum(b?.decisionScore) ?? 0

  const decA = americanToDecimal(a?.odds)
  const decB = americanToDecimal(b?.odds)
  const combinedOdds = decA != null && decB != null ? Number((decA * decB).toFixed(4)) : null

  const pairScore = Number((p1 * p2 + (e1 + e2) + (d1 + d2)).toFixed(6))

  return {
    category,
    pairScore,
    combinedOdds,
    legs: [
      {
        player: a?.player ?? null,
        team: a?.team ?? null,
        propType: a?.propType ?? null,
        odds: a?.odds ?? null,
        predictedProbability: a?.predictedProbability ?? null,
        edgeProbability: a?.edgeProbability ?? null,
        decisionScore: a?.decisionScore ?? null,
        propCategory: classifyPropCategory(a)
      },
      {
        player: b?.player ?? null,
        team: b?.team ?? null,
        propType: b?.propType ?? null,
        odds: b?.odds ?? null,
        predictedProbability: b?.predictedProbability ?? null,
        edgeProbability: b?.edgeProbability ?? null,
        decisionScore: b?.decisionScore ?? null,
        propCategory: classifyPropCategory(b)
      }
    ]
  }
}

function isSamePlayer(a, b) {
  const pa = normLc(a?.player)
  const pb = normLc(b?.player)
  return pa && pb && pa === pb
}

function softDifferentGamePenalty(a, b) {
  const ea = String(a?.eventId || a?.__src?.eventId || a?.gameId || "").trim()
  const eb = String(b?.eventId || b?.__src?.eventId || b?.gameId || "").trim()
  if (!ea || !eb) return 0
  return ea === eb ? -0.05 : 0
}

function build2LegPairs(rows, { category, maxPairs = 5, maxInput = 60, avoidSamePropType = false } = {}) {
  const list = dedupeRows(rows).filter(rowHasSignals).slice(0, maxInput)
  const pairs = []

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (isSamePlayer(a, b)) continue

      if (avoidSamePropType) {
        const pa = normLc(a?.propType)
        const pb = normLc(b?.propType)
        if (pa && pb && pa === pb) continue
      }

      const pair = buildPair({ a, b, category })
      const penalty = softDifferentGamePenalty(a, b)
      pair.pairScore = Number((pair.pairScore + penalty).toFixed(6))
      pairs.push(pair)
    }
  }

  pairs.sort((x, y) => (y.pairScore || 0) - (x.pairScore || 0))
  return pairs.slice(0, maxPairs)
}

function selectPoolsFromBestAvailable(bestAvailablePayload) {
  const ba = bestAvailablePayload && typeof bestAvailablePayload === "object"
    ? bestAvailablePayload.bestAvailable
    : null

  const slateDate = typeof ba?.slateDate === "string" ? ba.slateDate.slice(0, 10) : null
  const safe = Array.isArray(ba?.safe) ? ba.safe : []
  const balanced = Array.isArray(ba?.balanced) ? ba.balanced : []
  const aggressive = Array.isArray(ba?.aggressive) ? ba.aggressive : []
  const lotto = Array.isArray(ba?.lotto) ? ba.lotto : []
  const best = Array.isArray(ba?.best) ? ba.best : []

  const pool = dedupeRows([...safe, ...balanced, ...aggressive, ...lotto, ...best])
  return { pool, safe, balanced, aggressive, lotto, best, slateDate }
}

function emptyPairsResult({ slateDate, source }) {
  return {
    slateDate: slateDate || null,
    source: source || "none",
    propCount: 0,
    safe: [],
    value: [],
    upside: [],
    mixed: [],
    special: []
  }
}

function buildBestPairs({ bestAvailablePayload, trackedData, reqQueryDate } = {}) {
  const { pool: bestAvailablePool, slateDate: liveSlateDate } = selectPoolsFromBestAvailable(bestAvailablePayload)

  const requestedDate = String(reqQueryDate || "").slice(0, 10)
  const slateDate = requestedDate || liveSlateDate || null

  let source = "live"
  let usingFallback = false

  let basePool = bestAvailablePool
  if (basePool.length === 0) {
    const trackedSlate = typeof trackedData?.metadata?.slateDate === "string"
      ? trackedData.metadata.slateDate.slice(0, 10)
      : null

    if (trackedSlate !== slateDate) {
      console.warn("[SLATE-MISMATCH]", {
        tracked: trackedSlate,
        expected: slateDate
      })
      console.log("[PAIRS-SOURCE]", { source: "none", slateDate, propCount: 0 })
      return emptyPairsResult({ slateDate, source: "none" })
    }

    const allTrackedProps = Array.isArray(trackedData?.allTrackedProps) ? trackedData.allTrackedProps : []
    basePool = allTrackedProps.filter((r) => String(r?.status || "").toLowerCase() !== "settled")
    usingFallback = true
    source = "tracked"
  }

  const filtered = dedupeRows(basePool).filter((r) => {
    if (!r || typeof r !== "object") return false
    if (!rowHasSignals(r)) return false
    if (String(r?.status || "").toLowerCase() === "settled") return false
    if (isExtremeLongshot(r) && !isUpsideEligible(r)) return false
    return true
  })

  console.log("[PAIRS-SOURCE]", {
    source,
    slateDate,
    propCount: filtered.length
  })

  if (filtered.length === 0 && !usingFallback) {
    return emptyPairsResult({ slateDate, source: "none" })
  }

  const coreProps = filtered.filter((r) => isCore(r) && !isSpecial(r) && !isHomeRunProp(r))
  const specialProps = filtered.filter((r) => isSpecial(r))
  const hrProps = filtered.filter((r) => isHomeRunProp(r))

  const valueProps = [...filtered].sort((a, b) => (toNum(b?.edgeProbability) ?? -999) - (toNum(a?.edgeProbability) ?? -999)).slice(0, 50)
  const safeProps = [...filtered].sort((a, b) => (toNum(b?.predictedProbability) ?? -999) - (toNum(a?.predictedProbability) ?? -999)).slice(0, 50)

  const upsideProps = [...filtered]
    .filter((r) => isUpsideEligible(r))
    .sort((a, b) => (toNum(b?.odds) ?? -999) - (toNum(a?.odds) ?? -999))
    .slice(0, 50)

  // Buckets (max 5 each)
  const safePairs = build2LegPairs(safeProps, { category: "safe", maxPairs: 5, maxInput: 60, avoidSamePropType: true })
  const valuePairs = build2LegPairs(valueProps, { category: "value", maxPairs: 5, maxInput: 60, avoidSamePropType: true })
  const upsidePairs = build2LegPairs(upsideProps, { category: "upside", maxPairs: 5, maxInput: 60, avoidSamePropType: false })

  const mixedSeed = dedupeRows([
    ...coreProps.slice(0, 35),
    ...specialProps.slice(0, 20),
    ...hrProps.slice(0, 20)
  ])
  const mixedPairs = build2LegPairs(mixedSeed, { category: "mixed", maxPairs: 5, maxInput: 60, avoidSamePropType: false })

  const specialPairs = build2LegPairs(specialProps, { category: "special", maxPairs: 5, maxInput: 60, avoidSamePropType: false })

  return {
    slateDate: slateDate || null,
    source,
    propCount: filtered.length,
    safe: safePairs,
    value: valuePairs,
    upside: upsidePairs,
    mixed: mixedPairs,
    special: specialPairs
  }
}

module.exports = { buildBestPairs }

