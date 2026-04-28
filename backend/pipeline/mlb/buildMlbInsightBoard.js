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

function playProb(p, propType) {
  if (!p) return null
  if (propType === "Hits") return toNum(p?.hitProb) ?? toNum(p?.modelProbability)
  if (propType === "RBIs") return toNum(p?.rbiProb) ?? toNum(p?.modelProbability)
  return toNum(p?.modelProbability)
}

function playEdge(p, propType) {
  if (!p) return null
  if (propType === "Hits") return toNum(p?.hitEdge) ?? toNum(p?.edge)
  if (propType === "RBIs") return toNum(p?.rbiEdge) ?? toNum(p?.edge)
  return toNum(p?.edge)
}

function playImplied(p, propType) {
  if (!p) return null
  if (propType === "Hits") return toNum(p?.hitImpliedProbability) ?? toNum(p?.impliedProbability)
  if (propType === "RBIs") return toNum(p?.rbiImpliedProbability) ?? toNum(p?.impliedProbability)
  return toNum(p?.impliedProbability)
}

function scorePlay(p, propType) {
  const prob = playProb(p, propType) ?? 0
  const edge = playEdge(p, propType) ?? 0
  // Presentation score only (not a model). Keep simple.
  return prob * 0.65 + edge * 0.35
}

function buildFades(allPlays, n = 10) {
  const arr = [...allPlays]
    .map((x) => {
      const p = x?.ref
      const t = x?.propType
      const mp = playProb(p, t)
      const ip = playImplied(p, t)
      return {
        propType: t,
        player: p?.player ?? p?.pitcher ?? null,
        team: p?.team ?? p?.teamResolved ?? null,
        opponent: p?.opponent ?? p?.opponentTeam ?? null,
        eventId: p?.eventId ?? null,
        modelProbability: mp,
        impliedProbability: ip,
        edge: playEdge(p, t),
        overpricedGap: (ip ?? 0) - (mp ?? 0),
      }
    })
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
      const ref = p?.ref
      return (playProb(ref, t) ?? 0) >= minP && Number.isFinite(playEdge(ref, t))
    })
    .sort((a, b) => {
      const ae = playEdge(a?.ref, a?.propType) ?? -999
      const be = playEdge(b?.ref, b?.propType) ?? -999
      if (be !== ae) return be - ae
      return scorePlay(b?.ref, b?.propType) - scorePlay(a?.ref, a?.propType)
    })

  const out = []
  const used = new Set()
  for (const p of pool) {
    const ref = p?.ref
    const key = `${p.propType}__${norm(ref?.player ?? ref?.pitcher).toLowerCase()}__${ref?.eventId || ""}__${ref?.line || ""}`
    if (used.has(key)) continue
    used.add(key)
    out.push(p)
    if (out.length >= n) break
  }
  return out.map((p) => ({
    propType: p.propType,
    player: p?.ref?.player ?? p?.ref?.pitcher ?? null,
    team: p?.ref?.team ?? p?.ref?.teamResolved ?? null,
    opponent: p?.ref?.opponent ?? p?.ref?.opponentTeam ?? null,
    eventId: p?.ref?.eventId ?? null,
    line: p?.ref?.line ?? null,
    odds: p?.ref?.odds ?? null,
    modelProbability: playProb(p?.ref, p?.propType),
    impliedProbability: playImplied(p?.ref, p?.propType),
    edge: playEdge(p?.ref, p?.propType),
    why: "High edge + solid probability",
  }))
}

function buildRrCandidates(allPlays, n = 8) {
  // High probability + non-negative edge preference; keep mixed props.
  const minProbByType = { HR: 0.08, Hits: 0.65, RBIs: 0.24, Ks: 0.50 }
  const pool = allPlays
    .filter((p) => (playProb(p?.ref, p?.propType) ?? 0) >= (toNum(minProbByType[p?.propType]) ?? 0))
    .sort((a, b) => scorePlay(b?.ref, b?.propType) - scorePlay(a?.ref, a?.propType))

  const out = []
  const usedPlayers = new Set()
  for (const p of pool) {
    const playerKey = `${p.propType}__${norm(p?.ref?.player ?? p?.ref?.pitcher).toLowerCase()}`
    if (usedPlayers.has(playerKey)) continue
    usedPlayers.add(playerKey)
    out.push(p)
    if (out.length >= n) break
  }
  return out.map((p) => ({
    propType: p.propType,
    player: p?.ref?.player ?? p?.ref?.pitcher ?? null,
    team: p?.ref?.team ?? p?.ref?.teamResolved ?? null,
    opponent: p?.ref?.opponent ?? p?.ref?.opponentTeam ?? null,
    eventId: p?.ref?.eventId ?? null,
    modelProbability: playProb(p?.ref, p?.propType),
    edge: playEdge(p?.ref, p?.propType),
    note: "Good consistency profile (high prob, reasonable edge)",
  }))
}

function buildLottoCandidates(allPlays, n = 10) {
  // Lower probability but strong edge; odds helps when available.
  const pool = [...allPlays]
    .filter((p) => Number.isFinite(playEdge(p?.ref, p?.propType)))
    .filter((p) => {
      const prob = playProb(p?.ref, p?.propType) ?? 0
      const edge = playEdge(p?.ref, p?.propType) ?? 0
      const odds = toNum(p?.ref?.odds)
      const longOdds = Number.isFinite(odds) ? odds >= 400 : false
      return (prob <= 0.35 && edge >= 0.05) || longOdds
    })
    .sort((a, b) => {
      const be = playEdge(b?.ref, b?.propType) ?? -999
      const ae = playEdge(a?.ref, a?.propType) ?? -999
      if (be !== ae) return be - ae
      const bod = toNum(b?.ref?.odds) ?? 0
      const aod = toNum(a?.ref?.odds) ?? 0
      return bod - aod
    })

  return pickTop(pool, n).map((p) => ({
    propType: p.propType,
    player: p?.ref?.player ?? p?.ref?.pitcher ?? null,
    team: p?.ref?.team ?? p?.ref?.teamResolved ?? null,
    opponent: p?.ref?.opponent ?? p?.ref?.opponentTeam ?? null,
    eventId: p?.ref?.eventId ?? null,
    odds: p?.ref?.odds ?? null,
    modelProbability: playProb(p?.ref, p?.propType),
    edge: playEdge(p?.ref, p?.propType),
    note: "High-upside / lower-probability value",
  }))
}

function buildGameInsights(hrPlays, hitsPlays, rbiPlays, ksPlays) {
  const byGame = new Map()
  function add(ref, label) {
    const id = ref?.eventId
    if (!id) return
    const g =
      byGame.get(id) || {
        eventId: id,
        notes: [],
        counts: { HR: 0, Hits: 0, RBIs: 0, Ks: 0 },
        teams: new Map(),
      }
    g.counts[label] = (g.counts[label] || 0) + 1
    const team = norm(ref?.team ?? ref?.teamResolved).toLowerCase()
    if (team) g.teams.set(team, (g.teams.get(team) || 0) + 1)
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

    if (hrN >= 2) g.notes.push("Strong HR environment")
    if (hitN + rbiN >= 4) g.notes.push("Good stacking opportunity")
    if (ksN >= 1 && hrN === 0) g.notes.push("Pitching-friendly lean")

    // Stackable team signal: multiple plays concentrated on same team.
    const topTeamCount = [...g.teams.values()].sort((a, b) => b - a)[0] || 0
    if (topTeamCount >= 3) g.notes.push("Stackable team concentration")
    if (!g.notes.length) g.notes.push("Mixed signals")

    g.teams = undefined
  }

  return [...byGame.values()]
    .sort((a, b) => (b.counts.HR + b.counts.Hits + b.counts.RBIs) - (a.counts.HR + a.counts.Hits + a.counts.RBIs))
    .slice(0, 12)
}

function buildMlbInsightBoard(input = {}) {
  // Reuse existing objects; do not clone or recompute.
  const hrSrc = Array.isArray(input?.hrPredictionToday?.mostLikelyHr) ? input.hrPredictionToday.mostLikelyHr : []
  const hitsSrc = Array.isArray(input?.hitsToday?.topPlayers) ? input.hitsToday.topPlayers : []
  const rbiSrc = Array.isArray(input?.rbiToday?.topPlayers) ? input.rbiToday.topPlayers : []
  const ksSrc = Array.isArray(input?.pitcherKsToday?.topPitchers) ? input.pitcherKsToday.topPitchers : []

  const topHR = [...hrSrc].sort((a, b) => scorePlay(b, "HR") - scorePlay(a, "HR")).slice(0, 10)
  const topHits = [...hitsSrc].sort((a, b) => scorePlay(b, "Hits") - scorePlay(a, "Hits")).slice(0, 10)
  const topRBI = [...rbiSrc].sort((a, b) => scorePlay(b, "RBIs") - scorePlay(a, "RBIs")).slice(0, 10)
  const topKs = [...ksSrc].sort((a, b) => scorePlay(b, "Ks") - scorePlay(a, "Ks")).slice(0, 10)

  const allPlays = [
    ...topHR.map((ref) => ({ propType: "HR", ref })),
    ...topHits.map((ref) => ({ propType: "Hits", ref })),
    ...topRBI.map((ref) => ({ propType: "RBIs", ref })),
    ...topKs.map((ref) => ({ propType: "Ks", ref })),
  ]

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

