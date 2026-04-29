"use strict"

const normalizeName = require("../../utils/normalizeName")
const { computeRobustStats, computeProbabilityFromScore } = require("../utils/probabilityScaling")

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

function buildInsights(x) {
  const tags = []
  const itt = toNum(x?.impliedTeamTotal)
  const bo = toNum(x?.battingOrderIndex)
  const exp = toNum(x?.expectedRBI)
  const mp = toNum(x?.modelProbability) ?? 0
  const edge = toNum(x?.edge) ?? 0

  if (Number.isFinite(itt) && itt >= 5) tags.push("high RBI environment")
  if (Number.isFinite(bo) && bo <= 4) tags.push("top lineup position")
  if (Number.isFinite(itt) && itt >= 4.8) tags.push("stackable team")
  if (Number.isFinite(exp) && exp <= 0.35) tags.push("low opportunity")

  if (edge >= 0.06) tags.push("underpriced (+EV)")
  else if (edge > 0) tags.push("positive edge")
  else if (edge < -0.04) tags.push("overpriced (negative edge)")

  if (mp >= 0.22) tags.push("strong 1+ RBI chance")

  return tags
}

function pickPrimaryRbiLine(rows) {
  const arr = Array.isArray(rows) ? rows : []
  const overs = arr.filter((r) => norm(r?.side).toLowerCase() === "over")
  if (!overs.length) return []

  // Prefer main market if present; otherwise use lowest alternate line (closest to 0.5/1.0).
  const main = overs.filter((r) => norm(r?.marketKey) === "batter_rbis")
  const pool = main.length ? main : overs

  return [...pool].sort((a, b) => {
    const al = toNum(a?.line)
    const bl = toNum(b?.line)
    if (Number.isFinite(al) && Number.isFinite(bl) && al !== bl) return al - bl
    const ap = toNum(a?.predictedProbability) || 0
    const bp = toNum(b?.predictedProbability) || 0
    return bp - ap
  })
}

function expectedRbiFromContext(r, hits = null) {
  const itt = toNum(r?.impliedTeamTotal)
  const bo = toNum(r?.battingOrderIndex) ?? toNum(r?.lineupPosition)

  // Base expected RBI: anchored to team run environment and lineup opportunity.
  let opportunity = 0.22

  if (Number.isFinite(itt)) {
    // around +0.10 per implied run above ~3.5
    opportunity += (itt - 3.5) * 0.10
  }

  if (Number.isFinite(bo)) {
    if (bo <= 2) opportunity += 0.18
    else if (bo <= 4) opportunity += 0.12
    else if (bo <= 6) opportunity += 0.06
    else if (bo >= 8) opportunity -= 0.04
  }

  // Conversion: REQUIRED dependency on hits model.
  const h1 = toNum(hits?.hit1plus)
  const h2 = toNum(hits?.hit2plus)
  if (!Number.isFinite(h1) || !Number.isFinite(h2)) return null
  const hit1 = h1
  const hit2 = Math.min(hit1, h2)
  const conversion = Math.max(0.15, Math.min(0.95, 0.75 * hit1 + 0.25 * hit2))

  let exp = opportunity * conversion

  // Light contact/power proxy if present (existing shared field)
  const power = toNum(r?.powerScore)
  if (Number.isFinite(power)) exp += Math.max(-0.05, Math.min(0.12, (power - 12) * 0.004))

  // Light recent form layer if present
  const recent = toNum(r?.recentFormScore)
  if (Number.isFinite(recent)) exp += Math.max(-0.05, Math.min(0.08, recent * 0.02))

  // keep in sane band
  if (!Number.isFinite(exp)) return null
  exp = Math.max(0.05, Math.min(1.35, exp))
  return exp
}

function buildRbiRowFromPropRow(r, hits = null) {
  const implied = toNum(r?.impliedProbability)
  const oddsImpl = impliedProbabilityFromAmericanOdds(r?.odds)
  const impliedProbability = Number.isFinite(implied) ? implied : Number.isFinite(oddsImpl) ? oddsImpl : null

  const expectedRBI = expectedRbiFromContext(r, hits)
  if (!Number.isFinite(expectedRBI)) return null

  // Use Poisson ladder with lambda = expectedRBI
  const rbi1plus = poissonProbAtLeast(1, expectedRBI)
  const rbi2plus = Math.min(rbi1plus, poissonProbAtLeast(2, expectedRBI))
  const rbi3plus = Math.min(rbi2plus, poissonProbAtLeast(3, expectedRBI))

  // HARD UNIFY: attach RBI fields onto the SAME hits player object
  // (no cross-list lookups; RBI updates the unified object).
  const out = hits && typeof hits === "object" ? hits : {}

  out.player = out.player ?? (r?.player ?? null)
  out.team = out.team ?? (r?.teamResolved ?? r?.team ?? null)
  out.opponent = out.opponent ?? (r?.opponentTeam ?? null)
  out.eventId = out.eventId ?? (r?.eventId ?? null)

  out.expectedRBI = Number(expectedRBI.toFixed(3))
  // rbiProb/modelProbability are assigned in buildMlbRbiToday() from expectedRBI
  // via computeProbabilityFromScore(expectedRBI, stats+config).
  out.rbi1plus = Number(rbi1plus.toFixed(4))
  out.rbi2plus = Number(rbi2plus.toFixed(4))
  out.rbi3plus = Number(rbi3plus.toFixed(4))

  out.rbiLine = toNum(r?.line) ?? null
  out.rbiOdds = r?.odds ?? null
  out.rbiImpliedProbability = impliedProbability == null ? null : Number(Number(impliedProbability).toFixed(4))
  // rbiEdge/value are recomputed after rbiProb is assigned.

  out.rbiInsights = buildInsights({
    impliedTeamTotal: toNum(r?.impliedTeamTotal),
    battingOrderIndex: toNum(r?.battingOrderIndex) ?? toNum(r?.lineupPosition),
    expectedRBI: out.expectedRBI,
    modelProbability: null,
    edge: null,
  })
  return out
}

function buildMlbRbiToday(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const playerMap = input?.playerMap instanceof Map ? input.playerMap : null
  if (!playerMap || !playerMap.size) {
    throw new Error("RBI model requires shared playerMap (missing/empty)")
  }
  const rbiRows = rows.filter((r) => {
    const pt = String(r?.propType || "").toLowerCase()
    return pt.includes("rbi")
  })

  const byPlayer = new Map()
  for (const r of rbiRows) {
    const name = norm(r?.player)
    if (!name) continue
    const list = byPlayer.get(name) || []
    list.push(r)
    byPlayer.set(name, list)
  }

  const topPlayers = []
  let linked = 0
  let missingPlayer = 0
  let missingHitProb = 0
  for (const [player, list] of byPlayer.entries()) {
    const pool = pickPrimaryRbiLine(list)
    if (!pool.length) continue
    const primary = pool[0]
    const key = normalizeName(primary?.player)
    const obj = playerMap.get(key)
    if (!obj) {
      missingPlayer += 1
      continue
    }
    if (!Number.isFinite(toNum(obj?.hitProb)) && !Number.isFinite(toNum(obj?.hit1plus))) {
      // Hard dependency: RBI reads hits directly from the same player object.
      missingHitProb += 1
      continue
    }
    linked += 1
    const row = buildRbiRowFromPropRow(primary, obj)
    if (row) topPlayers.push(row)
  }

  // Assign RBI probability from expectedRBI using robust scaling (same pattern as HR).
  const expVals = topPlayers.map((p) => toNum(p?.expectedRBI)).filter((n) => Number.isFinite(n))
  const stats = computeRobustStats(expVals)
  for (const p of topPlayers) {
    const exp = toNum(p?.expectedRBI)
    const rbiProb = computeProbabilityFromScore(exp, {
      stats,
      floor: 0.18,
      ceiling: 0.45,
      midpoint: 0.28,
      k: 1.15,
    })

    p.rbiProb = Number(rbiProb.toFixed(4))
    p.rbiModelProbability = p.rbiProb

    // Ensure the generic field is present for consumers expecting modelProbability.
    p.modelProbability = p.rbiProb

    const imp = toNum(p?.rbiImpliedProbability)
    const edge = Number.isFinite(imp) ? p.rbiProb - imp : null
    p.rbiEdge = edge == null ? null : Number(Number(edge).toFixed(4))
    p.rbiIsValueBet = Number.isFinite(edge) ? edge > 0.05 : false
  }

  // Rank: RBI edge first, then RBI probability, then expectedRBI
  topPlayers.sort((a, b) => {
    const ae = toNum(a?.rbiEdge) ?? -999
    const be = toNum(b?.rbiEdge) ?? -999
    if (be !== ae) return be - ae
    const ap = toNum(a?.rbiProb) ?? 0
    const bp = toNum(b?.rbiProb) ?? 0
    if (bp !== ap) return bp - ap
    const ax = toNum(a?.expectedRBI) ?? 0
    const bx = toNum(b?.expectedRBI) ?? 0
    return bx - ax
  })

  const linkCheck = topPlayers.slice(0, 15).map((p) => ({
    player: p.player,
    hitProb: p.hitProb ?? p.modelProbability ?? null,
    expectedHits: p.expectedHits ?? null,
    hit1plus: p.hit1plus ?? null,
    hit2plus: p.hit2plus ?? null,
    expectedRBI: p.expectedRBI,
    rbiProb: p.rbiProb ?? p.rbi1plus,
    rbi1plus: p.rbi1plus,
    edge: p.rbiEdge ?? p.edge,
  }))
  console.log("[RBI LINK DEBUG]", linkCheck.slice(0, 10))

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    counts: {
      rbiRows: rbiRows.length,
      uniquePlayers: byPlayer.size,
      linkedHits: linked,
      missingPlayer,
      missingHitProb,
    },
    topPlayers: topPlayers.slice(0, 50),
    linkCheck,
    rbiLinkCheck: linkCheck,
  }
}

module.exports = { buildMlbRbiToday }

