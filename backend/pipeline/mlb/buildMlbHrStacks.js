"use strict"

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function avg(nums) {
  const xs = Array.isArray(nums) ? nums.map((n) => toNum(n)).filter((n) => Number.isFinite(n)) : []
  if (xs.length === 0) return null
  return xs.reduce((s, n) => s + n, 0) / xs.length
}

function quantileAsc(sortedAsc, q) {
  const arr = Array.isArray(sortedAsc) ? sortedAsc : []
  if (arr.length === 0) return null
  const qq = Math.min(1, Math.max(0, Number(q)))
  const idx = Math.floor((arr.length - 1) * qq)
  const v = toNum(arr[idx])
  return Number.isFinite(v) ? v : null
}

function pickPlayerFields(x) {
  return {
    player: x.player,
    team: x.team ?? null,
    eventId: x.eventId ?? null,
    odds: x.odds ?? null,
    hrScore: x.hrScore ?? null,
  }
}

function buildCombos(items, size) {
  const arr = Array.isArray(items) ? items : []
  if (size <= 1 || arr.length < size) return []
  const out = []
  const idx = Array.from({ length: size }, (_, i) => i)
  while (true) {
    out.push(idx.map((i) => arr[i]))
    let k = size - 1
    while (k >= 0 && idx[k] === arr.length - size + k) k--
    if (k < 0) break
    idx[k]++
    for (let j = k + 1; j < size; j++) idx[j] = idx[j - 1] + 1
  }
  return out
}

/**
 * HR stack builder (parlay-style) from ranked HR candidates.
 *
 * Input expects `topHrCandidatesToday` items shaped like:
 * { player, team, eventId, odds, predictedProbability, hrScore, tag }
 *
 * @param {{ topHrCandidatesToday: object[] }} input
 */
function buildMlbHrStacks(input = {}) {
  const candidates = Array.isArray(input?.topHrCandidatesToday) ? input.topHrCandidatesToday : []

  const safe = candidates.filter((c) => c && norm(c.player) && norm(c.eventId) && Number.isFinite(toNum(c.hrScore)))
  const scoresAsc = safe.map((c) => toNum(c.hrScore)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const median = quantileAsc(scoresAsc, 0.5) ?? 0
  const p40 = quantileAsc(scoresAsc, 0.4) ?? 0
  const p85 = quantileAsc(scoresAsc, 0.85) ?? 999

  const sorted = [...safe].sort((a, b) => (toNum(b?.hrScore) || 0) - (toNum(a?.hrScore) || 0))

  // Group all candidates by eventId
  const byEvent = new Map()
  for (const c of sorted) {
    const eventId = norm(c.eventId)
    if (!eventId) continue
    const list = byEvent.get(eventId) || []
    list.push(c)
    byEvent.set(eventId, list)
  }

  // ----------------------------------
  // PART 1 — SAME GAME STACKS
  // ----------------------------------
  const sameGameStacks = []
  for (const [eventId, list] of byEvent.entries()) {
    const eligible = list
      .filter((c) => {
        const odds = toNum(c?.odds)
        const score = toNum(c?.hrScore)
        return Number.isFinite(odds) && odds >= 300 && odds <= 900 && Number.isFinite(score) && score > median
      })
      .sort((a, b) => (toNum(b?.hrScore) || 0) - (toNum(a?.hrScore) || 0))
      .slice(0, 5) // top 3–5 players per game; we use max=5

    if (eligible.length < 2) continue

    const combos2 = buildCombos(eligible, 2)
    const combos3 = eligible.length >= 3 ? buildCombos(eligible, 3) : []
    const combos = combos2.concat(combos3)

    for (const combo of combos) {
      const comboScores = combo.map((x) => toNum(x.hrScore) || 0)
      const comboOdds = combo.map((x) => toNum(x.odds)).filter((n) => Number.isFinite(n))
      const stack = {
        eventId,
        players: combo.map(pickPlayerFields),
        combinedScore: Number((comboScores.reduce((s, n) => s + n, 0)).toFixed(4)),
        avgOdds: comboOdds.length ? Number((avg(comboOdds) || 0).toFixed(2)) : null,
        type: "same_game",
      }
      sameGameStacks.push(stack)
    }
  }
  sameGameStacks.sort((a, b) => (toNum(b.combinedScore) || 0) - (toNum(a.combinedScore) || 0))
  const sameGameTop = sameGameStacks.slice(0, 15)

  // ----------------------------------
  // PART 2 — CROSS GAME LOTTO
  // ----------------------------------
  const crossPool = sorted
    .filter((c) => {
      const odds = toNum(c?.odds)
      const score = toNum(c?.hrScore)
      return Number.isFinite(odds) && odds >= 350 && Number.isFinite(score) && score > p40
    })
    .slice(0, 20)

  const crossGameAll = []
  const combos3 = buildCombos(crossPool, 3)
  const combos4 = crossPool.length >= 4 ? buildCombos(crossPool, 4) : []
  const combos5 = crossPool.length >= 5 ? buildCombos(crossPool, 5) : []

  const allCombos = combos3.concat(combos4, combos5)
  for (const combo of allCombos) {
    const counts = new Map()
    for (const x of combo) {
      const eid = norm(x?.eventId)
      if (!eid) continue
      counts.set(eid, (counts.get(eid) || 0) + 1)
    }

    let ok = true
    for (const [eid, cnt] of counts.entries()) {
      if (cnt <= 2) continue
      // allow >2 from same game only if all of those legs are very high hrScore
      const legsFromGame = combo.filter((x) => norm(x?.eventId) === eid)
      if (!legsFromGame.every((x) => (toNum(x?.hrScore) || 0) >= p85)) {
        ok = false
        break
      }
    }
    if (!ok) continue

    const comboScores = combo.map((x) => toNum(x.hrScore) || 0)
    crossGameAll.push({
      players: combo.map(pickPlayerFields),
      combinedScore: Number((comboScores.reduce((s, n) => s + n, 0)).toFixed(4)),
      type: "cross_game",
    })
  }
  crossGameAll.sort((a, b) => (toNum(b.combinedScore) || 0) - (toNum(a.combinedScore) || 0))
  const crossGameLotto = crossGameAll.slice(0, 15)

  // ----------------------------------
  // PART 3 — HYBRID STACKS
  // ----------------------------------
  const globalTop = sorted.slice(0, 20)
  const hybridAll = []
  for (const [eventId, list] of byEvent.entries()) {
    const topInGame = [...list].sort((a, b) => (toNum(b?.hrScore) || 0) - (toNum(a?.hrScore) || 0)).slice(0, 3)
    if (topInGame.length < 2) continue
    const pairs = buildCombos(topInGame, 2)

    for (const pair of pairs) {
      for (const ext of globalTop) {
        if (norm(ext?.eventId) === norm(eventId)) continue
        const used = new Set(pair.map((x) => norm(x.player)))
        if (used.has(norm(ext.player))) continue
        const combo = [pair[0], pair[1], ext]
        const comboScores = combo.map((x) => toNum(x.hrScore) || 0)
        hybridAll.push({
          players: combo.map(pickPlayerFields),
          combinedScore: Number((comboScores.reduce((s, n) => s + n, 0)).toFixed(4)),
          type: "hybrid",
        })
        break // keep it simple: best external for this pair only
      }
    }
  }
  hybridAll.sort((a, b) => (toNum(b.combinedScore) || 0) - (toNum(a.combinedScore) || 0))
  const hybridStacks = hybridAll.slice(0, 10)

  // Temporary debug output (counts only)
  console.log("[HR STACK DEBUG] sameGame:", sameGameTop.length)
  console.log("[HR STACK DEBUG] crossGame:", crossGameLotto.length)
  console.log("[HR STACK DEBUG] hybrid:", hybridStacks.length)

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    counts: {
      candidatesIn: candidates.length,
      eligible: safe.length,
      games: byEvent.size,
    },
    sameGameStacks: sameGameTop,
    crossGameLotto,
    hybridStacks,
  }
}

module.exports = { buildMlbHrStacks }

