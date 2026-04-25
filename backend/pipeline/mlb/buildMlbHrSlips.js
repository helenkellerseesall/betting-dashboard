"use strict"

function isEliteHrPlay(p) {
  if (!p) return false

  // CORE RULES
  const strongScore = p.hrScore >= 12.5

  const eliteCombo =
    (p._weatherScore && p._weatherScore > 0) ||
    (p._parkScore && p._parkScore > 1)

  return strongScore && (eliteCombo || p.hasStrongMatchup)
}

module.exports = function buildMlbHrSlips({ hrPredictionToday }) {
  if (!hrPredictionToday) return {}

  const { mostLikelyHr = [], stacks = {} } = hrPredictionToday

  const { sameGame = [], crossGame = [] } = stacks

  const toNum = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const uniqByPlayer = (arr) => {
    const out = []
    const seen = new Set()
    for (const p of Array.isArray(arr) ? arr : []) {
      const key = String(p?.player || "").trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
    return out
  }

  const scoreThresholdTop60 = (arr) => {
    const scores = (Array.isArray(arr) ? arr : [])
      .map((p) => toNum(p?.hrScore))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
    if (scores.length === 0) return null
    // top ~60% => cut at 40th percentile
    const idx = Math.floor((scores.length - 1) * 0.4)
    return scores[idx]
  }

  // Pools (limited)
  const filtered = (Array.isArray(mostLikelyHr) ? mostLikelyHr : []).filter(isEliteHrPlay)
  const fallback = (Array.isArray(mostLikelyHr) ? mostLikelyHr : []).slice(0, 5)
  const pool = filtered.length < 3 ? fallback : filtered

  const safePool = pool.slice(0, 3)
  const stackPool = (Array.isArray(sameGame) ? sameGame : [])
    .filter((stack) => (stack.players || []).every(isEliteHrPlay))
    .slice(0, 3)
  const lottoPoolBase = pool.slice(3, 10)

  // SAFE SLIPS (3 controlled variants)
  const safeSlips = []
  if (safePool.length >= 2) safeSlips.push(safePool.slice(0, 2))
  if (safePool.length >= 3) safeSlips.push([safePool[0], safePool[2]])
  if (safePool.length >= 3) safeSlips.push(safePool.slice(0, 3))
  while (safeSlips.length < 3 && safePool.length > 0) safeSlips.push(safePool.slice(0, Math.min(3, safePool.length)))

  // STACK SLIPS (top 3 same-game stack options)
  const stackSlips = stackPool.map((s) => (Array.isArray(s?.players) ? s.players : [])).slice(0, 3)
  while (stackSlips.length < 3) stackSlips.push([])

  // LOTTO SLIPS (3 controlled variants)
  const lottoPool = uniqByPlayer(lottoPoolBase).filter((p) => toNum(p?.odds) != null && toNum(p.odds) >= 250)
  const lottoScoreCut = scoreThresholdTop60(lottoPool)
  const lottoEligible =
    lottoScoreCut == null
      ? lottoPool
      : lottoPool.filter((p) => (toNum(p?.hrScore) || 0) >= lottoScoreCut)

  const lottoSlips = []
  if (lottoEligible.length > 0) {
    lottoSlips.push(lottoEligible.slice(0, 5))
    lottoSlips.push(lottoEligible.slice(5, 10))
    const alt = []
    for (let i = 0; i < lottoEligible.length; i += 2) alt.push(lottoEligible[i])
    for (let i = 1; i < lottoEligible.length; i += 2) alt.push(lottoEligible[i])
    lottoSlips.push(alt.slice(0, 5))
  }
  while (lottoSlips.length < 3) lottoSlips.push([])

  return {
    safeSlips: [
      mostLikelyHr.slice(0, 3)
    ],
    stackSlips: [
      (sameGame[0]?.players || [])
    ],
    lottoSlips: [
      mostLikelyHr.slice(3, 8)
    ]
  }
}

