"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function pickTop(list, n) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : []
  return arr.slice(0, n)
}

function scorePlay(p) {
  const prob = toNum(p?.modelProbability) ?? 0
  const edge = toNum(p?.edge) ?? 0
  // Presentation score only (not a model). Keep simple.
  return prob * 0.65 + edge * 0.35
}

function buildPlay(input, propType) {
  const x = input || {}
  const player = x?.player ?? x?.pitcher ?? null
  const team = x?.team ?? x?.teamResolved ?? null
  const opponent = x?.opponent ?? x?.opponentTeam ?? null
  const eventId = x?.eventId ?? null

  return {
    propType,
    player,
    team,
    opponent,
    eventId,
    line: x?.line ?? null,
    odds: x?.odds ?? null,
    modelProbability: toNum(x?.modelProbability),
    impliedProbability: toNum(x?.impliedProbability),
    edge: toNum(x?.edge),
    insights: Array.isArray(x?.insights) ? x.insights : x?.insights ?? null,
  }
}

function normalizeHitsPlays(hitsToday) {
  const src = Array.isArray(hitsToday?.topPlayers) ? hitsToday.topPlayers : []
  return src
    .map((p) => ({
      propType: "Hits",
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? p?.opponentTeam ?? null,
      eventId: p?.eventId ?? null,
      line: p?.hitLine ?? p?.line ?? null,
      odds: p?.hitOdds ?? p?.odds ?? null,
      modelProbability: toNum(p?.hitProb) ?? toNum(p?.modelProbability),
      impliedProbability: toNum(p?.hitImpliedProbability) ?? toNum(p?.impliedProbability),
      edge: toNum(p?.hitEdge) ?? toNum(p?.edge),
      insights: p?.hitInsights ?? p?.insights ?? null,
      _raw: p,
    }))
    .filter((p) => p.player)
}

function normalizeRbiPlays(rbiToday) {
  const src = Array.isArray(rbiToday?.topPlayers) ? rbiToday.topPlayers : []
  return src
    .map((p) => ({
      propType: "RBIs",
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? p?.opponentTeam ?? null,
      eventId: p?.eventId ?? null,
      line: p?.rbiLine ?? p?.line ?? null,
      odds: p?.rbiOdds ?? p?.odds ?? null,
      modelProbability: toNum(p?.rbiProb) ?? toNum(p?.modelProbability),
      impliedProbability: toNum(p?.rbiImpliedProbability) ?? toNum(p?.impliedProbability),
      edge: toNum(p?.rbiEdge) ?? toNum(p?.edge),
      insights: p?.rbiInsights ?? p?.insights ?? null,
      _raw: p,
    }))
    .filter((p) => p.player)
}

function normalizeKsPlays(pitcherKsToday) {
  const src = Array.isArray(pitcherKsToday?.topPitchers) ? pitcherKsToday.topPitchers : []
  return src
    .map((p) => ({
      propType: "Ks",
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? null,
      eventId: p?.eventId ?? null,
      line: p?.line ?? null,
      odds: p?.odds ?? null,
      modelProbability: toNum(p?.modelProbability),
      impliedProbability: toNum(p?.impliedProbability),
      edge: toNum(p?.edge),
      insights: p?.insights ?? null,
      _raw: p,
    }))
    .filter((p) => p.player)
}

function normalizeHrPlays(hrPredictionToday) {
  const src = Array.isArray(hrPredictionToday?.mostLikelyHr) ? hrPredictionToday.mostLikelyHr : []
  return src
    .map((p) => ({
      propType: "HR",
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? p?.opponentTeam ?? null,
      eventId: p?.eventId ?? null,
      line: p?.line ?? null,
      odds: p?.odds ?? null,
      modelProbability: toNum(p?.modelProbability),
      impliedProbability: toNum(p?.impliedProbability),
      edge: toNum(p?.edge),
      insights: p?.reasons ?? p?.insights ?? null,
      _raw: p,
    }))
    .filter((p) => p.player)
}

function buildFades(allPlays, n = 10) {
  const arr = [...allPlays]
    .map((p) => ({
      ...p,
      overpricedGap: (toNum(p?.impliedProbability) ?? 0) - (toNum(p?.modelProbability) ?? 0),
    }))
    .filter((p) => Number.isFinite(toNum(p?.impliedProbability)) && Number.isFinite(toNum(p?.modelProbability)))
    .sort((a, b) => (toNum(b?.overpricedGap) ?? 0) - (toNum(a?.overpricedGap) ?? 0))
  return pickTop(arr, n).map((p) => ({
    propType: p.propType,
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    eventId: p.eventId,
    modelProbability: p.modelProbability,
    impliedProbability: p.impliedProbability,
    edge: (toNum(p.edge) != null ? Number(toNum(p.edge).toFixed(4)) : null),
    note: "Overpriced vs model",
  }))
}

function buildBestOverall(allPlays, n = 12) {
  // Prefer value (edge) but require some probability sanity per prop.
  const minProbByType = { HR: 0.06, Hits: 0.55, RBIs: 0.20, Ks: 0.45 }

  const pool = allPlays
    .filter((p) => {
      const t = norm(p?.propType)
      const minP = toNum(minProbByType[t]) ?? 0
      return (toNum(p?.modelProbability) ?? 0) >= minP && Number.isFinite(toNum(p?.edge))
    })
    .sort((a, b) => {
      const ae = toNum(a?.edge) ?? -999
      const be = toNum(b?.edge) ?? -999
      if (be !== ae) return be - ae
      return scorePlay(b) - scorePlay(a)
    })

  const out = []
  const used = new Set()
  for (const p of pool) {
    const key = `${p.propType}__${norm(p.player).toLowerCase()}__${p.eventId || ""}__${p.line || ""}`
    if (used.has(key)) continue
    used.add(key)
    out.push(p)
    if (out.length >= n) break
  }
  return out.map((p) => ({
    propType: p.propType,
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    eventId: p.eventId,
    line: p.line,
    odds: p.odds,
    modelProbability: p.modelProbability,
    impliedProbability: p.impliedProbability,
    edge: p.edge,
    why: "High edge + solid probability",
  }))
}

function buildRrCandidates(allPlays, n = 8) {
  // High probability + non-negative edge preference; keep mixed props.
  const minProbByType = { HR: 0.08, Hits: 0.65, RBIs: 0.24, Ks: 0.50 }
  const pool = allPlays
    .filter((p) => (toNum(p?.modelProbability) ?? 0) >= (toNum(minProbByType[p?.propType]) ?? 0))
    .sort((a, b) => scorePlay(b) - scorePlay(a))

  const out = []
  const usedPlayers = new Set()
  for (const p of pool) {
    const playerKey = `${p.propType}__${norm(p.player).toLowerCase()}`
    if (usedPlayers.has(playerKey)) continue
    usedPlayers.add(playerKey)
    out.push(p)
    if (out.length >= n) break
  }
  return out.map((p) => ({
    propType: p.propType,
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    eventId: p.eventId,
    modelProbability: p.modelProbability,
    edge: p.edge,
    note: "Good consistency profile (high prob, reasonable edge)",
  }))
}

function buildLottoCandidates(allPlays, n = 10) {
  // Lower probability but strong edge; odds helps when available.
  const pool = [...allPlays]
    .filter((p) => Number.isFinite(toNum(p?.edge)))
    .filter((p) => {
      const prob = toNum(p?.modelProbability) ?? 0
      const edge = toNum(p?.edge) ?? 0
      const odds = toNum(p?.odds)
      const longOdds = Number.isFinite(odds) ? odds >= 400 : false
      return (prob <= 0.35 && edge >= 0.05) || longOdds
    })
    .sort((a, b) => {
      const be = toNum(b?.edge) ?? -999
      const ae = toNum(a?.edge) ?? -999
      if (be !== ae) return be - ae
      const bod = toNum(b?.odds) ?? 0
      const aod = toNum(a?.odds) ?? 0
      return bod - aod
    })

  return pickTop(pool, n).map((p) => ({
    propType: p.propType,
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    eventId: p.eventId,
    odds: p.odds ?? null,
    modelProbability: p.modelProbability,
    edge: p.edge,
    note: "High-upside / lower-probability value",
  }))
}

function buildGameInsights(hrPlays, hitsPlays, rbiPlays, ksPlays) {
  const byGame = new Map()
  function add(p, label) {
    const id = p?.eventId
    if (!id) return
    const g = byGame.get(id) || { eventId: id, notes: [], counts: { HR: 0, Hits: 0, RBIs: 0, Ks: 0 } }
    g.counts[label] = (g.counts[label] || 0) + 1
    byGame.set(id, g)
  }

  for (const p of pickTop(hrPlays, 15)) add(p, "HR")
  for (const p of pickTop(hitsPlays, 15)) add(p, "Hits")
  for (const p of pickTop(rbiPlays, 15)) add(p, "RBIs")
  for (const p of pickTop(ksPlays, 10)) add(p, "Ks")

  for (const g of byGame.values()) {
    const hrN = g.counts.HR || 0
    const hitN = g.counts.Hits || 0
    const rbiN = g.counts.RBIs || 0
    const ksN = g.counts.Ks || 0

    if (hrN >= 2) g.notes.push("Strong HR potential (multiple top HR plays)")
    if (hitN + rbiN >= 4) g.notes.push("High-scoring environment (many Hits/RBI targets)")
    if (ksN >= 1 && hrN === 0) g.notes.push("Pitching-friendly lean (Ks showing without HR plays)")
    if (!g.notes.length) g.notes.push("Mixed signals")
  }

  return [...byGame.values()]
    .sort((a, b) => (b.counts.HR + b.counts.Hits + b.counts.RBIs) - (a.counts.HR + a.counts.Hits + a.counts.RBIs))
    .slice(0, 12)
}

function buildMlbInsightBoard(input = {}) {
  const hrPlays = normalizeHrPlays(input?.hrPredictionToday)
  const hitsPlays = normalizeHitsPlays(input?.hitsToday)
  const rbiPlays = normalizeRbiPlays(input?.rbiToday)
  const ksPlays = normalizeKsPlays(input?.pitcherKsToday)

  const topHR = [...hrPlays].sort((a, b) => scorePlay(b) - scorePlay(a)).slice(0, 10)
  const topHits = [...hitsPlays].sort((a, b) => scorePlay(b) - scorePlay(a)).slice(0, 10)
  const topRBI = [...rbiPlays].sort((a, b) => scorePlay(b) - scorePlay(a)).slice(0, 10)
  const topKs = [...ksPlays].sort((a, b) => scorePlay(b) - scorePlay(a)).slice(0, 10)

  const allPlays = [...topHR, ...topHits, ...topRBI, ...topKs]

  const bestOverallPlays = buildBestOverall(allPlays, 12)
  const rrCandidates = buildRrCandidates(allPlays, 8)
  const lottoCandidates = buildLottoCandidates(allPlays, 10)
  const fades = buildFades(allPlays, 10)
  const gameInsights = buildGameInsights(topHR, topHits, topRBI, topKs)

  return {
    topHR,
    topHits,
    topRBI,
    topKs,
    bestOverallPlays,
    rrCandidates,
    lottoCandidates,
    fades,
    gameInsights,
  }
}

module.exports = { buildMlbInsightBoard }

