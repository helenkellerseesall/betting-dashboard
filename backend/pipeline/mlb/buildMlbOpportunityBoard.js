"use strict"

const normalizeName = require("../../utils/normalizeName")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function clampStr(v) {
  const s = norm(v)
  return s ? s : null
}

function buildMlbOpportunityBoard(input = {}) {
  const hrPredictionToday = input?.hrPredictionToday && typeof input.hrPredictionToday === "object" ? input.hrPredictionToday : {}
  const pitcherKsToday = input?.pitcherKsToday && typeof input.pitcherKsToday === "object" ? input.pitcherKsToday : {}
  const playerMap = input?.playerMap instanceof Map ? input.playerMap : null
  const rows = Array.isArray(input?.rows) ? input.rows : []

  // Thresholds (explicit from user request)
  const TH = {
    hr: 0.15,
    hit1: 0.65,
    hit2: 0.40,
    rbi1: 0.22,
    rbi2: 0.14,
    ks: 0.50,
  }

  // Fallback team/opponent mapping from snapshot rows.
  const playerMeta = new Map()
  for (const r of rows) {
    const key = normalizeName(r?.player)
    if (!key) continue
    if (!playerMeta.has(key)) {
      playerMeta.set(key, {
        team: clampStr(r?.teamResolved ?? r?.team),
        opponent: clampStr(r?.opponentTeam),
        eventId: clampStr(r?.eventId),
      })
    }
  }

  function fallbackMeta(playerName) {
    const key = normalizeName(playerName)
    if (!key) return {}
    return playerMeta.get(key) || {}
  }

  // ------------------------
  // HR candidates
  // ------------------------
  const hrSrc = []
  if (Array.isArray(hrPredictionToday?.topHrCandidatesToday)) hrSrc.push(...hrPredictionToday.topHrCandidatesToday)
  if (Array.isArray(hrPredictionToday?.mostLikelyHr)) hrSrc.push(...hrPredictionToday.mostLikelyHr)

  const hrCandidates = []
  const seenHr = new Set()
  for (const p of hrSrc) {
    const player = clampStr(p?.player)
    if (!player) continue
    const key = `${player}__${clampStr(p?.eventId) || ""}__${clampStr(p?.odds) || ""}`
    if (seenHr.has(key)) continue
    seenHr.add(key)

    const prob = toNum(p?.modelProbability)
    if (!Number.isFinite(prob) || prob < TH.hr) continue
    const fb = fallbackMeta(player)

    hrCandidates.push({
      player,
      team: clampStr(p?.team) ?? fb.team ?? null,
      opponent: clampStr(p?.opponent ?? p?.opponentTeam) ?? fb.opponent ?? null,
      eventId: clampStr(p?.eventId) ?? fb.eventId ?? null,
      propType: "HR",
      ladder: "HR",
      probability: prob,
      edge: toNum(p?.edge),
    })
  }

  // ------------------------
  // Hits / RBI (from shared player objects)
  // ------------------------
  const hit1plusCandidates = []
  const hit2plusCandidates = []
  const rbi1plusCandidates = []
  const rbi2plusCandidates = []
  const rbi1All = []
  const rbi2All = []

  if (playerMap) {
    for (const obj of playerMap.values()) {
      const player = clampStr(obj?.player)
      if (!player) continue
      const fb = fallbackMeta(player)

      const team = clampStr(obj?.team) ?? fb.team ?? null
      const opponent = clampStr(obj?.opponent ?? obj?.opponentTeam) ?? fb.opponent ?? null
      const eventId = clampStr(obj?.eventId) ?? fb.eventId ?? null

      const h1 = toNum(obj?.hit1plus)
      const h2 = toNum(obj?.hit2plus)
      const he = toNum(obj?.hitEdge ?? obj?.edge)

      if (Number.isFinite(h1) && h1 >= TH.hit1) {
        hit1plusCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "Hits",
          ladder: "1+ Hits",
          probability: h1,
          edge: he,
        })
      }
      if (Number.isFinite(h2) && h2 >= TH.hit2) {
        hit2plusCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "Hits",
          ladder: "2+ Hits",
          probability: h2,
          edge: he,
        })
      }

      const r1 = toNum(obj?.rbi1plus)
      const r2 = toNum(obj?.rbi2plus)
      const re = toNum(obj?.rbiEdge ?? obj?.edge)
      const rbiBase = {
        player,
        team,
        opponent,
        eventId,
        propType: "RBIs",
        edge: re,
      }

      if (Number.isFinite(r1) && r1 >= TH.rbi1) {
        rbi1plusCandidates.push({
          ...rbiBase,
          ladder: "1+ RBI",
          probability: r1,
        })
      }
      if (Number.isFinite(r1)) {
        rbi1All.push({
          ...rbiBase,
          ladder: "1+ RBI",
          probability: r1,
        })
      }
      if (Number.isFinite(r2) && r2 >= TH.rbi2) {
        rbi2plusCandidates.push({
          ...rbiBase,
          ladder: "2+ RBI",
          probability: r2,
        })
      }
      if (Number.isFinite(r2)) {
        rbi2All.push({
          ...rbiBase,
          ladder: "2+ RBI",
          probability: r2,
        })
      }
    }
  }

  // RBI pool guardrails for full-slate coverage (display-layer only):
  // target roughly 10-20 for 1+ and 5-10 for 2+.
  function sortByProbEdge(a, b) {
    const bp = toNum(b?.probability) ?? -1
    const ap = toNum(a?.probability) ?? -1
    if (bp !== ap) return bp - ap
    return (toNum(b?.edge) ?? -999) - (toNum(a?.edge) ?? -999)
  }

  if (rbi1plusCandidates.length < 10) {
    const used = new Set(rbi1plusCandidates.map((x) => `${x.player}__${x.eventId || ""}`))
    const fill = [...rbi1All]
      .filter((x) => !used.has(`${x.player}__${x.eventId || ""}`))
      .sort(sortByProbEdge)
      .slice(0, Math.max(0, 10 - rbi1plusCandidates.length))
    rbi1plusCandidates.push(...fill)
  }

  if (rbi2plusCandidates.length < 5) {
    const used = new Set(rbi2plusCandidates.map((x) => `${x.player}__${x.eventId || ""}`))
    const fill = [...rbi2All]
      .filter((x) => !used.has(`${x.player}__${x.eventId || ""}`))
      .sort(sortByProbEdge)
      .slice(0, Math.max(0, 5 - rbi2plusCandidates.length))
    rbi2plusCandidates.push(...fill)
  }

  // ------------------------
  // Ks candidates (ladder options, not just market line)
  // ------------------------
  const ksSrc = Array.isArray(pitcherKsToday?.topPitchers) ? pitcherKsToday.topPitchers : []
  const ksCandidates = []
  const seenKs = new Set()
  for (const p of ksSrc) {
    const player = clampStr(p?.player)
    if (!player) continue
    const fb = fallbackMeta(player)
    const team = clampStr(p?.team) ?? fb.team ?? null
    const opponent = clampStr(p?.opponent) ?? fb.opponent ?? null
    const edge = toNum(p?.edge)

    const ladders = [
      { ladder: "4+ Ks", prob: toNum(p?.k4plus) ?? toNum(p?.k4) ?? toNum(p?.ladder?.["4+"]) },
      { ladder: "5+ Ks", prob: toNum(p?.k5plus) ?? toNum(p?.k5) ?? toNum(p?.ladder?.["5+"]) },
      { ladder: "6+ Ks", prob: toNum(p?.k6plus) ?? toNum(p?.k6) ?? toNum(p?.ladder?.["6+"]) },
      { ladder: "7+ Ks", prob: toNum(p?.k7plus) ?? toNum(p?.k7) ?? toNum(p?.ladder?.["7+"]) },
    ]

    for (const l of ladders) {
      if (!Number.isFinite(l.prob) || l.prob < TH.ks) continue
      const key = `${player}__${l.ladder}`
      if (seenKs.has(key)) continue
      seenKs.add(key)
      ksCandidates.push({
        player,
        team,
        opponent,
        eventId: clampStr(p?.eventId) ?? fb.eventId ?? null,
        propType: "Ks",
        ladder: l.ladder,
        probability: l.prob,
        edge,
      })
    }
  }

  return {
    hrCandidates,
    hit1plusCandidates,
    hit2plusCandidates,
    rbi1plusCandidates,
    rbi2plusCandidates,
    ksCandidates,
  }
}

module.exports = { buildMlbOpportunityBoard }

