"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function normalizeOdds01(odds) {
  const o = toNum(odds)
  if (!Number.isFinite(o) || o === 0) return 0
  // Higher positive odds => higher value. Clamp into 0..1 over a reasonable range.
  const payout = o > 0 ? o : 10000 / Math.abs(o)
  return clamp((payout - 300) / (1200 - 300), 0, 1)
}

function isSpikeType(row) {
  const playType = String(row?.playType || "").toLowerCase()
  const propType = String(row?.propType || "")
  const odds = toNum(row?.odds)
  if (!Number.isFinite(odds) || odds < 300) return false
  if (playType === "boom") return true
  if (propType === "Home Runs" || propType === "Total Bases" || propType === "RBIs") return true
  return false
}

function computeSpikeScore(row) {
  const edge = toNum(row?.edgeProbability) ?? 0
  const sig = toNum(row?.signalScore) ?? 0
  const mi = toNum(row?.marketImpactScore) ?? 0
  const odds01 = normalizeOdds01(row?.odds)
  return Number((edge * 0.4 + sig * 0.3 + mi * 0.2 + odds01 * 0.1).toFixed(6))
}

function buildMlbSpikeEngine(rows, { topN = 10 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const candidates = safeRows
    .filter(isSpikeType)
    .map((r) => ({
      player: r?.player || null,
      team: r?.team || null,
      propType: r?.propType || null,
      odds: r?.odds ?? null,
      edgeProbability: r?.edgeProbability ?? null,
      signalScore: r?.signalScore ?? null,
      marketImpactScore: r?.marketImpactScore ?? null,
      playType: r?.playType || null,
      eventId: r?.eventId ?? null,
      spikeScore: computeSpikeScore(r)
    }))
    .filter((r) => r.player && r.team && r.propType && r.odds != null)
    .sort((a, b) => {
      const sA = toNum(a?.spikeScore) ?? -999
      const sB = toNum(b?.spikeScore) ?? -999
      if (sB !== sA) return sB - sA
      const eA = toNum(a?.edgeProbability) ?? -999
      const eB = toNum(b?.edgeProbability) ?? -999
      return eB - eA
    })

  const limit = Math.max(5, Math.min(10, Number(topN) || 10))

  // Maintain a spike mix when available (HR/TB/RBI), without forcing weak plays:
  // seed the list with the best available of each key spike propType.
  const byType = {
    hr: candidates.filter((r) => r.propType === "Home Runs"),
    tb: candidates.filter((r) => r.propType === "Total Bases"),
    rbi: candidates.filter((r) => r.propType === "RBIs")
  }

  const out = []
  const seenPlayers = new Set()
  const push = (row) => {
    if (!row) return
    const pk = String(row.player || "").toLowerCase().trim()
    if (!pk || seenPlayers.has(pk)) return
    seenPlayers.add(pk)
    out.push(row)
  }

  push(byType.hr[0])
  push(byType.tb[0])
  push(byType.rbi[0])

  for (const row of candidates) {
    if (out.length >= limit) break
    push(row)
  }

  return { spikePlayers: out.slice(0, limit) }
}

module.exports = { buildMlbSpikeEngine, computeSpikeScore }

