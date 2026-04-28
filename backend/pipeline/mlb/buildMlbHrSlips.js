"use strict"

module.exports = function buildMlbHrSlips({ hrPredictionToday }) {
  if (!hrPredictionToday) return {}

  const { mostLikelyHr = [] } = hrPredictionToday

  function toNum(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  function clamp(n, lo, hi) {
    const x = Number(n)
    if (!Number.isFinite(x)) return lo
    return Math.max(lo, Math.min(hi, x))
  }

  function hasDuplicates(slip) {
    const arr = Array.isArray(slip) ? slip : []
    const ids = arr.map((p) => p?.eventId)
    const players = arr.map((p) => p?.player)
    return new Set(ids).size !== ids.length || new Set(players).size !== players.length
  }

  const candidatePool = mostLikelyHr

  // STEP 1 — group by game (eventId)
  const byEvent = new Map()
  for (const p of Array.isArray(candidatePool) ? candidatePool : []) {
    if (!p?.eventId || !p?.player) continue
    const list = byEvent.get(p.eventId) || []
    list.push(p)
    byEvent.set(p.eventId, list)
  }
  for (const [eid, list] of byEvent.entries()) {
    byEvent.set(
      eid,
      [...list].sort((a, b) => (toNum(b?.hrScore) || 0) - (toNum(a?.hrScore) || 0))
    )
  }

  // STEP 1b — filter candidates using probability + edge, then hybrid-rank
  const filtered = (Array.isArray(candidatePool) ? candidatePool : []).filter((p) => {
    const mp = toNum(p?.modelProbability) ?? 0
    const edge = toNum(p?.edge) ?? 0
    return mp >= 0.12 && edge > 0
  })

  const finalRank = [...filtered].sort((a, b) => {
    const aEdge = toNum(a?.edge) ?? 0
    const bEdge = toNum(b?.edge) ?? 0
    const aMp = toNum(a?.modelProbability) ?? 0
    const bMp = toNum(b?.modelProbability) ?? 0
    return bEdge * 0.6 + bMp * 0.4 - (aEdge * 0.6 + aMp * 0.4)
  })

  // Global ranked list, deduped by player (preserve first occurrence = best rank).
  const ranked = []
  const seenPlayers = new Set()
  for (const p of finalRank) {
    if (!p?.player || !p?.eventId) continue
    if (seenPlayers.has(p.player)) continue
    seenPlayers.add(p.player)
    ranked.push(p)
  }

  const rankIndex = new Map()
  ranked.forEach((p, i) => rankIndex.set(p.player, i))

  // STEP 2 — build tiers
  const n = ranked.length
  const A_SIZE = clamp(Math.floor(n * 0.2), 3, 5)
  const B_SIZE = clamp(Math.floor(n * 0.35), 5, 10)

  const tierA = ranked.slice(0, A_SIZE)
  const tierB = ranked.slice(A_SIZE, A_SIZE + B_SIZE)

  const rest = ranked.slice(A_SIZE + B_SIZE)
  const tierCPrimary = rest.filter((p) => Number.isFinite(toNum(p?.odds)) && toNum(p.odds) >= 450)
  const tierCFallback = rest.filter((p) => !tierCPrimary.includes(p))
  const tierC = tierCPrimary.concat(tierCFallback)

  // STEP 3/4 — build slips with rotation + diversity across slip types
  const usedByType = {
    safe: new Set(),
    balanced: new Set(),
    aggressive: new Set(),
    lotto: new Set(),
  }
  const usedTypesByPlayer = new Map() // player -> Set(types)

  function typesUsedCount(player) {
    const s = usedTypesByPlayer.get(player)
    return s ? s.size : 0
  }

  function canUseInType(player, type) {
    const s = usedTypesByPlayer.get(player)
    if (!s) return true
    if (s.has(type)) return true
    // prevent appearing in ALL slip types; cap to 2 types normally
    return s.size < 2
  }

  function markUsed(player, type) {
    if (!player) return
    usedByType[type]?.add(player)
    const s = usedTypesByPlayer.get(player) || new Set()
    s.add(type)
    usedTypesByPlayer.set(player, s)
  }

  function sortForType(list, type, rot) {
    const arr = Array.isArray(list) ? [...list] : []
    // rotate start
    const r = ((rot % (arr.length || 1)) + (arr.length || 1)) % (arr.length || 1)
    const rotated = arr.length ? arr.slice(r).concat(arr.slice(0, r)) : arr
    // prefer higher-ranked players first, then low cross-type usage, then hrScore
    rotated.sort((a, b) => {
      const ar = rankIndex.has(a?.player) ? rankIndex.get(a.player) : 9999
      const br = rankIndex.has(b?.player) ? rankIndex.get(b.player) : 9999
      if (ar !== br) return ar - br
      const au = typesUsedCount(a?.player)
      const bu = typesUsedCount(b?.player)
      if (au !== bu) return au - bu
      return (toNum(b?.hrScore) || 0) - (toNum(a?.hrScore) || 0)
    })
    // avoid reusing same player within this slip type if possible
    rotated.sort((a, b) => {
      const aUsed = usedByType[type]?.has(a?.player) ? 1 : 0
      const bUsed = usedByType[type]?.has(b?.player) ? 1 : 0
      if (aUsed !== bUsed) return aUsed - bUsed
      return 0
    })
    return rotated
  }

  function pickLeg(list, type, rot, bannedPlayers, bannedEventIds) {
    const arr = sortForType(list, type, rot)
    for (const p of arr) {
      if (!p?.player || !p?.eventId) continue
      if (bannedPlayers.has(p.player)) continue
      if (bannedEventIds.has(p.eventId)) continue
      if (!canUseInType(p.player, type)) continue
      return p
    }
    // fallback: ignore canUseInType
    for (const p of arr) {
      if (!p?.player || !p?.eventId) continue
      if (bannedPlayers.has(p.player)) continue
      if (bannedEventIds.has(p.eventId)) continue
      return p
    }
    return null
  }

  function buildSlip(type, rule, rot) {
    const bannedPlayers = new Set()
    const bannedEventIds = new Set()
    const slip = []

    for (const tier of rule) {
      const leg = pickLeg(tier, type, rot, bannedPlayers, bannedEventIds)
      if (!leg) continue
      slip.push(leg)
      bannedPlayers.add(leg.player)
      bannedEventIds.add(leg.eventId)
    }

    if (slip.length === 2 && !hasDuplicates(slip)) {
      slip.forEach((p) => markUsed(p.player, type))
      return slip
    }

    // fallback: try to fill to 2 from overall ranked list with constraints
    const fallback = []
    const bp = new Set()
    const be = new Set()
    for (const p of slip) {
      fallback.push(p)
      bp.add(p.player)
      be.add(p.eventId)
    }
    for (const p of sortForType(ranked, type, rot)) {
      if (fallback.length >= 2) break
      if (!p?.player || !p?.eventId) continue
      if (bp.has(p.player)) continue
      if (be.has(p.eventId)) continue
      fallback.push(p)
      bp.add(p.player)
      be.add(p.eventId)
    }
    if (fallback.length === 2 && !hasDuplicates(fallback)) {
      fallback.forEach((p) => markUsed(p.player, type))
      console.log("[SLIP ENGINE] fallback used", { type })
      return fallback
    }

    return slip
  }

  // Variants per type (rotation). Keep small but non-duplicative.
  const variants = 3

  const safeSlips = []
  const balancedSlips = []
  const aggressiveSlips = []
  const lottoSlips = []

  for (let k = 0; k < variants; k++) {
    // SAFE: 2 Tier A, different games
    safeSlips.push(buildSlip("safe", [tierA, tierA], k))

    // BALANCED: 1 Tier A + 1 Tier B
    balancedSlips.push(buildSlip("balanced", [tierA, tierB], k))

    // AGGRESSIVE: 1 Tier A + 1 Tier C
    aggressiveSlips.push(buildSlip("aggressive", [tierA, tierC], k))

    // LOTTO: 2 Tier C OR high odds only
    const highOdds = tierC.filter((p) => Number.isFinite(toNum(p?.odds)) && toNum(p.odds) >= 550)
    lottoSlips.push(buildSlip("lotto", [highOdds.length ? highOdds : tierC, highOdds.length ? highOdds : tierC], k))
  }

  // Cleanup: remove empty/invalid slips
  function normalizeGroup(group) {
    return (Array.isArray(group) ? group : []).filter((slip) => Array.isArray(slip) && slip.length === 2 && !hasDuplicates(slip))
  }

  const out = {
    safeSlips: normalizeGroup(safeSlips),
    balancedSlips: normalizeGroup(balancedSlips),
    aggressiveSlips: normalizeGroup(aggressiveSlips),
    lottoSlips: normalizeGroup(lottoSlips),
  }

  const usedPlayersAll = new Set()
  for (const group of Object.values(out)) {
    for (const slip of group) {
      for (const leg of slip) usedPlayersAll.add(leg?.player)
    }
  }

  console.log("[SLIP ENGINE] top list", ranked.slice(0, 10).map((p) => `${p.player} (${p.eventId})`))
  console.log("[SLIP ENGINE] safe", out.safeSlips.map((s) => s.map((p) => `${p.player} (${p.eventId})`)))
  console.log("[SLIP ENGINE] balanced", out.balancedSlips.map((s) => s.map((p) => `${p.player} (${p.eventId})`)))
  console.log("[SLIP ENGINE] aggressive", out.aggressiveSlips.map((s) => s.map((p) => `${p.player} (${p.eventId})`)))
  console.log("[SLIP ENGINE] lotto", out.lottoSlips.map((s) => s.map((p) => `${p.player} (${p.eventId})`)))
  console.log("[SLIP ENGINE] unique players used", usedPlayersAll.size)
  console.log("[SLIP ENGINE] pool", {
    mostLikelyHr: Array.isArray(candidatePool) ? candidatePool.length : 0,
    filtered: filtered.length,
    ranked: ranked.length,
  })

  return out
}

