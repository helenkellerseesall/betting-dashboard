"use strict"

const normalizeName = require("../../utils/normalizeName")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function clamp01(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function impliedProbabilityFromAmericanOdds(american) {
  const a = toNum(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 100 / (a + 100)
  return Math.abs(a) / (Math.abs(a) + 100)
}

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function lambdaFromHit1Plus(p) {
  const pp = clamp01(p)
  // In Poisson(λ), P(H>=1)=1-e^-λ => λ = -ln(1-p)
  const x = Math.max(1e-6, 1 - pp)
  return -Math.log(x)
}

function clampHitsLambda(lam) {
  const x = Number(lam)
  if (!Number.isFinite(x)) return 1.2
  return Math.max(0.2, Math.min(2.6, x))
}

function opportunityMultiplierFromBattingOrder(bo) {
  const n = toNum(bo)
  if (!Number.isFinite(n)) return 1.0
  if (n <= 2) return 1.18
  if (n <= 4) return 1.12
  if (n <= 6) return 1.05
  if (n >= 8) return 0.88
  return 1.0
}

function contextMultiplierFromTeamTotal(itt) {
  const x = toNum(itt)
  if (!Number.isFinite(x)) return 1.0
  // 3.0 → 0.95, 4.0 → 1.00, 5.0 → 1.06, 6.0 → 1.12
  return clamp(1 + (x - 4.0) * 0.08, 0.88, 1.22)
}

function skillLambdaFromProb(p) {
  // Use predictedProbability (already model-based) as baseline skill for 1+ hits.
  const pp = clamp(toNum(p) ?? 0.62, 0.15, 0.90)
  const base = lambdaFromHit1Plus(pp)
  const spread = clamp(1 + (pp - 0.62) * 3.2, 0.75, 1.35)
  return base * spread
}

function poissonProbAtLeast(k, lambda) {
  const kk = Math.max(0, Math.floor(Number(k) || 0))
  const lam = Math.max(0, Number(lambda) || 0)
  if (kk <= 0) return 1
  if (lam === 0) return 0

  let p = Math.exp(-lam) // P(0)
  let cdf = p
  for (let i = 1; i <= kk - 1; i++) {
    p = (p * lam) / i
    cdf += p
  }
  return clamp01(1 - cdf)
}

function fitPoissonLambdaForAtLeastK(targetProb, k) {
  const p = Math.max(0.001, Math.min(0.999, Number(targetProb) || 0))
  const kk = Math.max(0, Math.floor(Number(k) || 0))

  let lo = 0.01
  let hi = 10
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2
    const pmid = poissonProbAtLeast(kk, mid)
    if (pmid < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function thresholdFromLine(line) {
  const ln = toNum(line)
  if (!Number.isFinite(ln)) return null
  return Math.floor(ln) + 1
}

function pickPrimaryHitsLine(rows) {
  const arr = Array.isArray(rows) ? rows : []
  const overs = arr.filter((r) => norm(r?.side).toLowerCase() === "over")
  if (!overs.length) return []

  const main = overs.filter((r) => norm(r?.marketKey) === "batter_hits")
  const pool = main.length ? main : overs

  // Prefer the 0.5 line (1+ hits) for interpretability.
  return [...pool].sort((a, b) => {
    const al = toNum(a?.line)
    const bl = toNum(b?.line)
    const aPref = Number.isFinite(al) && al === 0.5 ? -1 : 0
    const bPref = Number.isFinite(bl) && bl === 0.5 ? -1 : 0
    if (aPref !== bPref) return aPref - bPref
    if (Number.isFinite(al) && Number.isFinite(bl) && al !== bl) return al - bl
    const ap = toNum(a?.predictedProbability) || 0
    const bp = toNum(b?.predictedProbability) || 0
    return bp - ap
  })
}

function buildInsights(x) {
  const tags = []
  const exp = toNum(x?.expectedHits)
  const itt = toNum(x?.impliedTeamTotal)
  const bo = toNum(x?.battingOrderIndex)
  const edge = toNum(x?.edge) ?? 0
  const mp = toNum(x?.modelProbability) ?? 0

  if (Number.isFinite(itt) && itt >= 5) tags.push("high hit environment")
  if (Number.isFinite(bo) && bo <= 4) tags.push("top lineup position")
  if (Number.isFinite(exp) && exp >= 1.6) tags.push("multi-hit upside")
  if (Number.isFinite(exp) && exp <= 0.7) tags.push("low hit expectation")

  if (edge >= 0.06) tags.push("underpriced (+EV)")
  else if (edge > 0) tags.push("positive edge")
  else if (edge < -0.04) tags.push("overpriced (negative edge)")

  if (mp >= 0.75) tags.push("strong 1+ hit chance")

  return tags
}

function buildHitsRowFromPropRow(r) {
  const implied = toNum(r?.impliedProbability)
  const oddsImpl = impliedProbabilityFromAmericanOdds(r?.odds)
  const impliedProbability = Number.isFinite(implied) ? implied : Number.isFinite(oddsImpl) ? oddsImpl : null

  const line = toNum(r?.line)
  const k = thresholdFromLine(line) ?? 1

  const predictedProb = toNum(r?.predictedProbability)
  const predSafe = Number.isFinite(predictedProb) ? predictedProb : impliedProbability != null ? impliedProbability : 0.62
  const impSafe = impliedProbability != null ? impliedProbability : null

  // Light context nudge (plate appearances proxy)
  const itt = toNum(r?.impliedTeamTotal)
  const bo = toNum(r?.battingOrderIndex) ?? toNum(r?.lineupPosition)
  const opp = norm(r?.opponentTeam).toLowerCase()
  const gameTotal = toNum(r?.gameTotal)

  // Build expectedHits using real separation signals:
  // - baseline skill: predictedProbability for 1+ hits → lambda
  // - opportunity: batting order
  // - team context: implied team total
  // - light contact/power proxy: powerScore (if present)
  // - light recent form: recentFormScore (if present)
  let expectedHitsRaw = skillLambdaFromProb(predSafe)
  expectedHitsRaw *= opportunityMultiplierFromBattingOrder(bo)
  expectedHitsRaw *= contextMultiplierFromTeamTotal(itt)

  const powerScore = toNum(r?.powerScore)
  if (Number.isFinite(powerScore)) {
    expectedHitsRaw *= clamp(1 + (powerScore - 12) * 0.015, 0.88, 1.14)
  }

  const recent = toNum(r?.recentFormScore)
  if (Number.isFinite(recent)) {
    expectedHitsRaw *= clamp(1 + recent * 0.06, 0.90, 1.10)
  }

  if (Number.isFinite(gameTotal)) {
    expectedHitsRaw *= clamp(1 + (gameTotal - 8.5) * 0.02, 0.92, 1.10)
  }

  expectedHitsRaw = clampHitsLambda(expectedHitsRaw)

  // Distribution-based ladders from expectedHits (lambda)
  const expectedHits = expectedHitsRaw
  const hit1plus = poissonProbAtLeast(1, expectedHits)
  const hit2plus = Math.min(hit1plus, poissonProbAtLeast(2, expectedHits))
  const hit3plus = Math.min(hit2plus, poissonProbAtLeast(3, expectedHits))

  const modelProbability = hit1plus
  const edge = impSafe == null ? null : modelProbability - impSafe
  const isValueBet = Number.isFinite(edge) ? edge > 0.05 : false

  const out = {
    player: r?.player ?? null,
    team: r?.teamResolved ?? r?.team ?? null,
    opponent: r?.opponentTeam ?? null,
    eventId: r?.eventId ?? null,
    book: r?.book ?? null,
    marketKey: r?.marketKey ?? null,
    line: line ?? null,
    odds: r?.odds ?? null,
    impliedTeamTotal: itt,
    battingOrderIndex: bo,
    expectedHitsRaw: Number(expectedHitsRaw.toFixed(3)),
    expectedHits: Number(expectedHits.toFixed(3)),
    modelProbability: Number(modelProbability.toFixed(4)),
    hitProb: Number(modelProbability.toFixed(4)),
    impliedProbability: impSafe == null ? null : Number(Number(impSafe).toFixed(4)),
    edge: edge == null ? null : Number(Number(edge).toFixed(4)),
    isValueBet,
    hit1plus: Number(hit1plus.toFixed(4)),
    hit2plus: Number(hit2plus.toFixed(4)),
    hit3plus: Number(hit3plus.toFixed(4)),
  }

  out.insights = buildInsights(out)
  return out
}

function buildMlbHitsToday(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const playerMap = input?.playerMap instanceof Map ? input.playerMap : null
  const hitRows = rows.filter((r) => String(r?.propType || "") === "Hits")

  const byPlayerRows = new Map()
  for (const r of hitRows) {
    const name = norm(r?.player)
    if (!name) continue
    const list = byPlayerRows.get(name) || []
    list.push(r)
    byPlayerRows.set(name, list)
  }

  const topPlayers = []
  const byPlayer = {}
  for (const [player, list] of byPlayerRows.entries()) {
    const pool = pickPrimaryHitsLine(list)
    if (!pool.length) continue
    const primary = pool[0]
    const entry = buildHitsRowFromPropRow(primary)

    // HARD UNIFY: update the shared player object IN PLACE.
    const key = normalizeName(entry?.player)
    if (!key) continue

    const obj = playerMap && playerMap.get(key) && typeof playerMap.get(key) === "object" ? playerMap.get(key) : {}
    obj.key = obj.key ?? key
    obj.player = obj.player ?? (entry?.player ?? null)
    obj.team = obj.team ?? (entry?.team ?? null)

    // Attach Hits fields onto the shared player object.
    obj.hitProb = entry?.hitProb ?? entry?.modelProbability ?? null
    obj.expectedHits = entry?.expectedHits ?? null
    obj.expectedHitsRaw = entry?.expectedHitsRaw ?? null
    obj.hit1plus = entry?.hit1plus ?? null
    obj.hit2plus = entry?.hit2plus ?? null
    obj.hit3plus = entry?.hit3plus ?? null
    obj.hitLine = entry?.line ?? null
    obj.hitOdds = entry?.odds ?? null
    obj.hitImpliedProbability = entry?.impliedProbability ?? null
    obj.hitEdge = entry?.edge ?? null
    obj.hitIsValueBet = entry?.isValueBet ?? false
    obj.hitInsights = entry?.insights ?? null

    // Keep common context fields if useful later.
    obj.eventId = obj.eventId ?? (entry?.eventId ?? null)
    obj.opponent = obj.opponent ?? (entry?.opponent ?? null)

    if (playerMap) playerMap.set(key, obj)
    topPlayers.push(obj)
    byPlayer[key] = obj
  }

  const hitsNums = topPlayers.map((p) => toNum(p?.expectedHits)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const minHits = hitsNums.length ? hitsNums[0] : null
  const maxHits = hitsNums.length ? hitsNums[hitsNums.length - 1] : null
  const avgHits = hitsNums.length ? hitsNums.reduce((s, n) => s + n, 0) / hitsNums.length : null
  const minCount = Number.isFinite(minHits) ? topPlayers.filter((p) => toNum(p?.expectedHits) === minHits).length : 0
  console.log("[EXPECTED HITS DISTRIBUTION]", {
    min: Number.isFinite(minHits) ? Number(minHits.toFixed(3)) : null,
    max: Number.isFinite(maxHits) ? Number(maxHits.toFixed(3)) : null,
    avg: Number.isFinite(avgHits) ? Number(avgHits.toFixed(3)) : null,
    count: hitsNums.length,
    minCount,
  })
  console.log(
    "[EXPECTED HITS TOP 10]",
    [...topPlayers]
      .filter((p) => Number.isFinite(toNum(p?.expectedHits)))
      .sort((a, b) => (toNum(b?.expectedHits) || 0) - (toNum(a?.expectedHits) || 0))
      .slice(0, 10)
      .map((p) => ({
        player: p.player,
        team: p.team,
        expectedHits: p.expectedHits,
        modelProbability: p.modelProbability,
        impliedProbability: p.impliedProbability,
        edge: p.edge,
        impliedTeamTotal: p.impliedTeamTotal,
        battingOrderIndex: p.battingOrderIndex,
      }))
  )

  // Rank: edge first, then modelProbability, then expectedHits
  topPlayers.sort((a, b) => {
    const ae = toNum(a?.edge) ?? -999
    const be = toNum(b?.edge) ?? -999
    if (be !== ae) return be - ae
    const ap = toNum(a?.modelProbability) ?? 0
    const bp = toNum(b?.modelProbability) ?? 0
    if (bp !== ap) return bp - ap
    const ax = toNum(a?.expectedHits) ?? 0
    const bx = toNum(b?.expectedHits) ?? 0
    return bx - ax
  })

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    counts: { hitRows: hitRows.length, uniquePlayers: byPlayerRows.size },
    topPlayers: topPlayers.slice(0, 75),
    byPlayer,
  }
}

module.exports = { buildMlbHitsToday }

