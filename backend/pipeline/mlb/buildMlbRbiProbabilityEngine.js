"use strict"

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

function expectedRbiFromContext(r) {
  const itt = toNum(r?.impliedTeamTotal)
  const bo = toNum(r?.battingOrderIndex) ?? toNum(r?.lineupPosition)

  // Base expected RBI: anchored to team run environment and lineup opportunity.
  let exp = 0.22

  if (Number.isFinite(itt)) {
    // around +0.10 per implied run above ~3.5
    exp += (itt - 3.5) * 0.10
  }

  if (Number.isFinite(bo)) {
    if (bo <= 2) exp += 0.18
    else if (bo <= 4) exp += 0.12
    else if (bo <= 6) exp += 0.06
    else if (bo >= 8) exp -= 0.04
  }

  // Light contact/power proxy if present (existing shared field)
  const power = toNum(r?.powerScore)
  if (Number.isFinite(power)) exp += Math.max(-0.05, Math.min(0.12, (power - 12) * 0.004))

  // Light recent form layer if present
  const recent = toNum(r?.recentFormScore)
  if (Number.isFinite(recent)) exp += Math.max(-0.05, Math.min(0.08, recent * 0.02))

  // keep in sane band
  if (!Number.isFinite(exp)) exp = 0.22
  exp = Math.max(0.05, Math.min(1.35, exp))
  return exp
}

function buildRbiRowFromPropRow(r) {
  const implied = toNum(r?.impliedProbability)
  const oddsImpl = impliedProbabilityFromAmericanOdds(r?.odds)
  const impliedProbability = Number.isFinite(implied) ? implied : Number.isFinite(oddsImpl) ? oddsImpl : null

  const expectedRBI = expectedRbiFromContext(r)

  // Use Poisson ladder with lambda = expectedRBI
  const rbi1plus = poissonProbAtLeast(1, expectedRBI)
  const rbi2plus = Math.min(rbi1plus, poissonProbAtLeast(2, expectedRBI))
  const rbi3plus = Math.min(rbi2plus, poissonProbAtLeast(3, expectedRBI))

  // modelProbability is for 1+ by default (consistent field name)
  const modelProbability = rbi1plus
  const edge = impliedProbability == null ? null : modelProbability - impliedProbability
  const isValueBet = Number.isFinite(edge) ? edge > 0.05 : false

  const out = {
    player: r?.player ?? null,
    team: r?.teamResolved ?? r?.team ?? null,
    opponent: r?.opponentTeam ?? null,
    eventId: r?.eventId ?? null,
    book: r?.book ?? null,
    marketKey: r?.marketKey ?? null,
    line: toNum(r?.line) ?? null,
    odds: r?.odds ?? null,
    impliedTeamTotal: toNum(r?.impliedTeamTotal),
    battingOrderIndex: toNum(r?.battingOrderIndex) ?? toNum(r?.lineupPosition),
    expectedRBI: Number(expectedRBI.toFixed(3)),
    modelProbability: Number(modelProbability.toFixed(4)),
    impliedProbability: impliedProbability == null ? null : Number(Number(impliedProbability).toFixed(4)),
    edge: edge == null ? null : Number(Number(edge).toFixed(4)),
    isValueBet,
    rbi1plus: Number(rbi1plus.toFixed(4)),
    rbi2plus: Number(rbi2plus.toFixed(4)),
    rbi3plus: Number(rbi3plus.toFixed(4)),
  }

  out.insights = buildInsights(out)
  return out
}

function buildMlbRbiToday(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const rbiRows = rows.filter((r) => String(r?.propType || "") === "RBIs")

  const byPlayer = new Map()
  for (const r of rbiRows) {
    const name = norm(r?.player)
    if (!name) continue
    const list = byPlayer.get(name) || []
    list.push(r)
    byPlayer.set(name, list)
  }

  const topPlayers = []
  for (const [player, list] of byPlayer.entries()) {
    const pool = pickPrimaryRbiLine(list)
    if (!pool.length) continue
    const primary = pool[0]
    topPlayers.push(buildRbiRowFromPropRow(primary))
  }

  // Rank: edge first, then modelProbability, then expectedRBI
  topPlayers.sort((a, b) => {
    const ae = toNum(a?.edge) ?? -999
    const be = toNum(b?.edge) ?? -999
    if (be !== ae) return be - ae
    const ap = toNum(a?.modelProbability) ?? 0
    const bp = toNum(b?.modelProbability) ?? 0
    if (bp !== ap) return bp - ap
    const ax = toNum(a?.expectedRBI) ?? 0
    const bx = toNum(b?.expectedRBI) ?? 0
    return bx - ax
  })

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    counts: { rbiRows: rbiRows.length, uniquePlayers: byPlayer.size },
    topPlayers: topPlayers.slice(0, 50),
  }
}

module.exports = { buildMlbRbiToday }

