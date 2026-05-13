"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function impliedProbabilityFromAmericanOdds(american) {
  const a = toNum(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 100 / (a + 100)
  return Math.abs(a) / (Math.abs(a) + 100)
}

function clamp01(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function poissonProbAtLeast(k, lambda) {
  // Numerically stable tail probability using recurrence:
  // P(0)=e^-λ ; P(i)=P(i-1)*λ/i
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

  let lo = 0.1
  let hi = 20
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2
    const pmid = poissonProbAtLeast(kk, mid)
    if (pmid < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function buildInsights(x) {
  const insights = []
  const mp = toNum(x?.modelProbability) ?? 0
  const edge = toNum(x?.edge) ?? 0
  const line = toNum(x?.line)
  const exp = toNum(x?.expectedKs)
  const gt = toNum(x?.gameTotal)

  if (edge >= 0.06) insights.push("underpriced line (strong +EV)")
  else if (edge > 0) insights.push("positive edge vs odds")
  else if (edge < -0.04) insights.push("overpriced line (negative edge)")

  if (Number.isFinite(exp) && exp >= 7.5) insights.push("strong ladder candidate (7+ viable)")
  if (Number.isFinite(exp) && exp <= 4.5) insights.push("low Ks environment")

  if (Number.isFinite(line) && Number.isFinite(mp)) {
    if (mp >= 0.22) insights.push("high probability over spot")
    else if (mp <= 0.12) insights.push("thin over probability")
  }

  if (Number.isFinite(gt) && gt >= 9.5) insights.push("high run environment (Ks volatility)")

  return insights
}

function pickPrimaryLine(rows) {
  const arr = Array.isArray(rows) ? rows : []
  const overs = arr.filter((r) => norm(r?.side).toLowerCase() === "over")
  const main = overs.filter((r) => norm(r?.marketKey) === "pitcher_strikeouts")
  if (main.length) return main
  return overs
}

function thresholdFromLine(line) {
  // Over 6.5 Ks means >= 7 Ks
  const ln = toNum(line)
  if (!Number.isFinite(ln)) return null
  return Math.floor(ln) + 1
}

function buildPitcherRowFromPropRow(r, context = {}) {
  const implied = toNum(r?.impliedProbability)
  const oddsImpl = impliedProbabilityFromAmericanOdds(r?.odds)
  const impliedProbability = Number.isFinite(implied) ? implied : Number.isFinite(oddsImpl) ? oddsImpl : null

  const line = toNum(r?.line)
  const k = thresholdFromLine(line) ?? 0
  const impliedProbSafe = Number.isFinite(impliedProbability) ? impliedProbability : null
  const predictedProb = toNum(r?.predictedProbability)

  // Start from market-implied Ks distribution (lambda) for the given line, then adjust using model signal.
  const marketLambda = impliedProbSafe != null ? fitPoissonLambdaForAtLeastK(impliedProbSafe, k) : (toNum(line) ?? 4) + 0.5

  // Calibration-honesty hardening: when neither a model probability NOR a
  // market-implied probability is resolvable, `predSafe` becomes NULL — NOT
  // a synthetic 0.5 midpoint. Downstream math gates on `predSafeForAdj`
  // (numeric for arithmetic that must produce a finite result) but the
  // OBSERVATIONAL fields (modelProbability, edge) propagate the unresolved
  // state truthfully via `predictionResolved`.
  //
  // Honest-fallback policy (cascade):
  //   1. row.predictedProbability  (model)
  //   2. impliedProbSafe           (market-derived, EXPLICIT fallback source)
  //   3. null                      (genuinely unresolved — no synthesis)
  //
  // `predictionResolved` flags which source was used. Replay, grading, and
  // calibration consumers MUST honor this rather than treat NULL == 0.5.
  const predSafe = Number.isFinite(predictedProb)
    ? predictedProb
    : impliedProbSafe != null ? impliedProbSafe : null
  const predictionResolved = predSafe != null
  const predictionSource =
    Number.isFinite(predictedProb) ? "model"
      : impliedProbSafe != null     ? "market_implied_fallback"
      : "unresolved"

  // For arithmetic that MUST yield a finite lambda adjustment (so the row
  // can still emit a Poisson-derived expectedKs from the line alone) we
  // use a SHIFT-ZERO baseline when nothing is resolvable. This is NOT a
  // probability claim — it is a "no usable signal, apply zero adjustment"
  // mathematical convention. It is bounded ±0 here.
  const predSafeForAdj = predSafe != null ? predSafe : (impliedProbSafe != null ? impliedProbSafe : null)
  const edgeProb = toNum(r?.edgeProbability)
    ?? (predictionResolved && Number.isFinite(impliedProbSafe) ? predSafe - impliedProbSafe : 0)

  // Small bounded adjustment: improves separation without inflating.
  // When predSafeForAdj is null, adjFromProb is 0 — equivalent to "no
  // adjustment", preserving the Poisson-from-line baseline.
  const adjFromProb = (predSafeForAdj != null && Number.isFinite(impliedProbSafe))
    ? Math.max(-1, Math.min(1, (predSafeForAdj - impliedProbSafe) * 8))
    : 0
  const adjFromEdgeProb = Math.max(-0.5, Math.min(0.5, edgeProb * 10))
  const expectedKs = Math.max(0.25, marketLambda + adjFromProb + adjFromEdgeProb)

  // Probability of OVER line is derived from expectedKs distribution (Poisson).
  // When the underlying prediction is unresolved, modelProbability is the
  // Poisson-from-market value but `predictionResolved=false` carries that
  // truth to consumers — they decide how to handle it.
  const modelProbability = poissonProbAtLeast(k, expectedKs)
  const edge = Number.isFinite(impliedProbSafe) ? modelProbability - impliedProbSafe : null
  const isValueBet = Number.isFinite(edge) ? edge > 0.05 : false

  // Ladder probs (guaranteed monotone decreasing)
  const k5 = poissonProbAtLeast(5, expectedKs)
  const k6 = Math.min(k5, poissonProbAtLeast(6, expectedKs))
  const k7 = Math.min(k6, poissonProbAtLeast(7, expectedKs))
  const k8 = Math.min(k7, poissonProbAtLeast(8, expectedKs))

  const out = {
    name: r?.player ?? null,
    player: r?.player ?? null,
    team: r?.teamResolved ?? r?.team ?? null,
    opponent: r?.opponentTeam ?? null,
    isHome: r?.isHome ?? null,
    eventId: r?.eventId ?? null,
    book: r?.book ?? null,
    marketKey: r?.marketKey ?? null,
    line,
    odds: r?.odds ?? null,
    expectedKs: Number.isFinite(expectedKs) ? Number(expectedKs.toFixed(3)) : null,
    modelProbability: Number(modelProbability.toFixed(4)),
    impliedProbability: impliedProbSafe == null ? null : Number(Number(impliedProbSafe).toFixed(4)),
    edge: edge == null ? null : Number(Number(edge).toFixed(4)),
    isValueBet,
    // Calibration-honesty diagnostics — every consumer of this row can decide
    // whether the modelProbability above is a TRUE model output, a documented
    // market-implied fallback, or genuinely unresolved (zero adjustment applied).
    predictionResolved,            // boolean: true when model OR market_implied source resolved
    predictionSource,              // "model" | "market_implied_fallback" | "unresolved"
    k5: Number(k5.toFixed(4)),
    k6: Number(k6.toFixed(4)),
    k7: Number(k7.toFixed(4)),
    k8: Number(k8.toFixed(4)),
    k5plus: Number(k5.toFixed(4)),
    k6plus: Number(k6.toFixed(4)),
    k7plus: Number(k7.toFixed(4)),
    k8plus: Number(k8.toFixed(4)),
    ladder: {
      "5+": Number(k5.toFixed(4)),
      "6+": Number(k6.toFixed(4)),
      "7+": Number(k7.toFixed(4)),
      "8+": Number(k8.toFixed(4)),
    },
    gameTotal: toNum(r?.gameTotal),
  }

  if (context?.debugLadder) {
    console.log("[KS LADDER CALC]", {
      player: out.player,
      line: out.line,
      expectedKs: out.expectedKs,
      k5plus: out.k5plus,
      k6plus: out.k6plus,
      k7plus: out.k7plus,
      k8plus: out.k8plus,
    })
  }

  out.insights = buildInsights(out)
  return out
}

function buildMlbPitcherKsToday(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []

  const ksRows = rows.filter((r) => String(r?.propType || "").toLowerCase().includes("strikeouts"))
  const byPitcher = new Map()
  for (const r of ksRows) {
    const name = norm(r?.player)
    if (!name) continue
    const list = byPitcher.get(name) || []
    list.push(r)
    byPitcher.set(name, list)
  }

  const topPitchers = []
  for (const [player, list] of byPitcher.entries()) {
    const pool = pickPrimaryLine(list)
    if (!pool.length) continue

    // Prefer lines with usable odds and meaningful probability signal.
    const sorted = [...pool].sort((a, b) => {
      const ae = toNum(a?.edgeProbability)
      const be = toNum(b?.edgeProbability)
      if (Number.isFinite(be) && Number.isFinite(ae) && be !== ae) return be - ae
      const ap = toNum(a?.predictedProbability) || 0
      const bp = toNum(b?.predictedProbability) || 0
      if (bp !== ap) return bp - ap
      const al = toNum(a?.line) || 0
      const bl = toNum(b?.line) || 0
      return bl - al
    })

    const primary = sorted[0]
    const entry = buildPitcherRowFromPropRow(primary, { debugLadder: topPitchers.length < 3 })
    topPitchers.push(entry)
  }

  // Rank: edge-first then probability then expectedKs
  topPitchers.sort((a, b) => {
    const ae = toNum(a?.edge) ?? -999
    const be = toNum(b?.edge) ?? -999
    if (be !== ae) return be - ae
    const ap = toNum(a?.modelProbability) ?? 0
    const bp = toNum(b?.modelProbability) ?? 0
    if (bp !== ap) return bp - ap
    const ax = toNum(a?.expectedKs) ?? 0
    const bx = toNum(b?.expectedKs) ?? 0
    return bx - ax
  })

  const ladderTable = topPitchers.slice(0, 15).map((p) => ({
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    line: p.line,
    expectedKs: p.expectedKs,
    probOverLine: p.modelProbability,
    impliedProbability: p.impliedProbability,
    edge: p.edge,
    k5: p.k5 ?? (p.ladder?.["5+"] ?? null),
    k6: p.k6 ?? (p.ladder?.["6+"] ?? null),
    k7: p.k7 ?? (p.ladder?.["7+"] ?? null),
    k8: p.k8 ?? (p.ladder?.["8+"] ?? null),
    k5plus: p.k5plus ?? (p.k5 ?? (p.ladder?.["5+"] ?? null)),
    k6plus: p.k6plus ?? (p.k6 ?? (p.ladder?.["6+"] ?? null)),
    k7plus: p.k7plus ?? (p.k7 ?? (p.ladder?.["7+"] ?? null)),
    k8plus: p.k8plus ?? (p.k8 ?? (p.ladder?.["8+"] ?? null)),
    "5+": p.ladder?.["5+"] ?? null,
    "6+": p.ladder?.["6+"] ?? null,
    "7+": p.ladder?.["7+"] ?? null,
    "8+": p.ladder?.["8+"] ?? null,
  }))

  const insights = topPitchers
    .filter((p) => Array.isArray(p.insights) && p.insights.length)
    .slice(0, 20)
    .map((p) => ({
      player: p.player,
      team: p.team,
      opponent: p.opponent,
      line: p.line,
      expectedKs: p.expectedKs,
      modelProbability: p.modelProbability,
      impliedProbability: p.impliedProbability,
      edge: p.edge,
      insights: p.insights,
    }))

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    counts: { strikeoutRows: ksRows.length, uniquePitchers: byPitcher.size },
    topPitchers: topPitchers.slice(0, 25),
    ladderTable,
    insights,
  }
}

module.exports = { buildMlbPitcherKsToday }

