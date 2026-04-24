"use strict"

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function normLc(v) {
  return norm(v).toLowerCase()
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toDecimalOddsFromAmerican(american) {
  const a = toNum(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 1 + (a / 100)
  return 1 + (100 / Math.abs(a))
}

function toAmericanOddsFromDecimal(decimal) {
  const d = toNum(decimal)
  if (!Number.isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return -Math.round(100 / (d - 1))
}

function estimateSlipAmericanOdds(legs) {
  const safe = Array.isArray(legs) ? legs : []
  let dec = 1
  let used = 0
  for (const leg of safe) {
    const d = toDecimalOddsFromAmerican(leg?.odds)
    if (!Number.isFinite(d)) continue
    dec *= d
    used += 1
  }
  if (used === 0) return null
  return toAmericanOddsFromDecimal(dec)
}

function stableLegKey(row) {
  const eventId = norm(row?.eventId || row?.matchup)
  const player = norm(row?.player)
  const propType = norm(row?.propType)
  const side = norm(row?.side)
  const line = row?.line == null ? "" : String(row?.line)
  const book = norm(row?.book)
  const marketKey = norm(row?.marketKey)
  const variant = norm(row?.propVariant || "base")
  return [eventId, player, propType, side, line, book, marketKey, variant].join("|")
}

function ticketSignature(legs) {
  const keys = (Array.isArray(legs) ? legs : []).map(stableLegKey).filter(Boolean).sort()
  return keys.join("||")
}

function isAltLike(row) {
  const mk = normLc(row?.marketKey)
  const v = normLc(row?.propVariant)
  const fam = normLc(row?.marketFamily)
  if (fam === "ladder") return true
  if (v.startsWith("alt-")) return true
  if (mk.includes("alternate") || mk.includes("_alternate") || mk.includes("alt")) return true
  return false
}

function classifyBuckets(allProps) {
  const safe = Array.isArray(allProps) ? allProps : []
  const hitsProps = []
  const tbProps = []
  const rbiProps = []
  const hrProps = []
  const altProps = []

  for (const row of safe) {
    const pt = norm(row?.propType)
    if (pt === "Hits") hitsProps.push(row)
    if (pt === "Total Bases") tbProps.push(row)
    if (pt === "RBIs") rbiProps.push(row)
    if (pt === "Home Runs") hrProps.push(row)
    if (isAltLike(row)) altProps.push(row)
  }

  return { hitsProps, tbProps, rbiProps, hrProps, altProps }
}

function upsideScore(row) {
  const odds = toNum(row?.odds) || 0
  const pt = norm(row?.propType)
  const line = toNum(row?.line)

  let s = 0
  if (odds >= 250) s += 2
  if (pt === "Home Runs") s += 2
  if ((pt === "Total Bases" || pt === "Hits") && Number.isFinite(line) && line >= 1.5) s += 1
  if (isAltLike(row)) s += 1
  return s
}

function baseConfidenceScore(row) {
  // Prefer Phase 3 score if present; fall back to edgeProbability / predictedProbability.
  const phase3 = toNum(row?.mlbPhase3Score)
  if (Number.isFinite(phase3)) return phase3
  const edgeP = toNum(row?.edgeProbability)
  const predP = toNum(row?.predictedProbability)
  return (Number.isFinite(edgeP) ? edgeP * 10 : 0) + (Number.isFinite(predP) ? predP : 0)
}

function impliedProbabilityFromAmericanOdds(american) {
  const a = toNum(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 100 / (a + 100)
  return Math.abs(a) / (Math.abs(a) + 100)
}

function getImpliedProbability(row) {
  const explicit = toNum(row?.impliedProbability)
  if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit
  return impliedProbabilityFromAmericanOdds(row?.odds)
}

function getBattingOrderIndex(row) {
  const keys = ["battingOrderIndex", "lineupSpot", "lineupPosition", "battingOrder", "battingOrderSpot"]
  for (const k of keys) {
    const n = toNum(row?.[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

function getRecentForm(row) {
  const l10 = toNum(row?.l10Avg ?? row?.last10Avg ?? row?.recent10Avg)
  const season = toNum(row?.seasonAvg ?? row?.avg ?? row?.seasonAverage)
  const recent3 = toNum(row?.recent3Avg ?? row?.last3Avg)
  return { l10, season, recent3 }
}

function getPitcherMatchup(row) {
  // Best-effort: only apply when fields exist (do not assume provider).
  const era = toNum(row?.opponentPitcherEra ?? row?.pitcherEra ?? row?.oppPitcherEra)
  const whip = toNum(row?.opponentPitcherWhip ?? row?.pitcherWhip ?? row?.oppPitcherWhip)
  const kRate = toNum(row?.opponentPitcherKRate ?? row?.pitcherKRate ?? row?.oppPitcherKRate)
  const kPer9 = toNum(row?.opponentPitcherKPer9 ?? row?.pitcherKPer9 ?? row?.oppPitcherKPer9)
  return { era, whip, kRate, kPer9 }
}

function getParkHrFactor(row) {
  return toNum(row?.parkHrFactor ?? row?.parkFactorHr ?? row?.hrParkFactor)
}

function getPitcherFlyBallRate(row) {
  return toNum(row?.pitcherFlyBallRate ?? row?.oppPitcherFlyBallRate ?? row?.opponentPitcherFlyBallRate)
}

function oddsPreferencePenalty(odds, ticketType) {
  const o = Number.isFinite(Number(odds)) ? Number(odds) : null
  if (!Number.isFinite(o)) return 2.5

  // Not a hard filter: just bias the builder.
  if (ticketType === "SAFE") {
    // Prefer -200 .. +150
    if (o >= -200 && o <= 150) return 0
    if (o > 150) return Math.min(4, (o - 150) / 120)
    // Very juiced legs also reduce slip diversity / payout balance.
    if (o < -200) return Math.min(3, (Math.abs(o) - 200) / 140)
    return 0
  }

  if (ticketType === "BALANCED") {
    // Prefer +100 .. +300 with room for some juice.
    if (o >= 100 && o <= 300) return 0
    if (o > 300) return Math.min(3.5, (o - 300) / 140)
    if (o < 100) return Math.min(2.5, (100 - o) / 200)
    return 0
  }

  if (ticketType === "AGGRESSIVE") {
    // Allow high odds, but still penalize extreme tails.
    if (o >= 100 && o <= 600) return 0
    if (o > 600) return Math.min(3.0, (o - 600) / 250)
    if (o < 100) return Math.min(2.0, (100 - o) / 250)
    return 0
  }

  // LOTTO / HR_STACK: no restriction.
  return 0
}

function linePreferenceAdjustment(row, ticketType) {
  const pt = norm(row?.propType)
  const ln = toNum(row?.line)
  if (!Number.isFinite(ln)) return 0

  // Soft preferences (bonus for preferred, penalty for riskier).
  if (pt === "Hits") {
    if (ln <= 0.5) return 0.9
    if (ln <= 1.5) return ticketType === "SAFE" ? -0.6 : 0.15 // allow 1.5 if strong
    return -1.4
  }

  if (pt === "Total Bases") {
    if (ln <= 1.5) return 0.6
    if (ln <= 2.5) return 0.35
    // allow higher if top percentile (handled by confidence score); still add risk penalty
    return ticketType === "LOTTO" || ticketType === "AGGRESSIVE" ? -0.35 : -0.95
  }

  if (pt === "RBIs") {
    if (ln <= 0.5) return 0.55
    if (ln <= 1.5) return (ticketType === "AGGRESSIVE" || ticketType === "LOTTO" || ticketType === "HR_STACK") ? 0.05 : -1.0
    return -1.3
  }

  if (pt === "Home Runs") {
    // Most viable HR markets are 0.5; treat higher as high-risk.
    if (ln <= 0.5) return 0.25
    if (ln <= 1.0) return -0.35
    return -2.5
  }

  return 0
}

function upsideBonus(row) {
  const pt = norm(row?.propType)
  const odds = toNum(row?.odds) || 0
  const isAlt = isAltLike(row)

  let b = 0
  if (pt === "Home Runs") b += 1.2
  if (isAlt) b += 0.55
  if (odds >= 250) b += 0.8
  return b
}

function riskPenalty(row) {
  const pt = norm(row?.propType)
  const ln = toNum(row?.line)
  const implied = getImpliedProbability(row)
  const pred = toNum(row?.predictedProbability)

  let p = 0

  // High lines tend to be less consistent.
  if (Number.isFinite(ln)) {
    if (pt === "Hits" && ln >= 1.5) p += 0.6
    if (pt === "Total Bases" && ln >= 3.5) p += 0.65
    if (pt === "RBIs" && ln >= 1.5) p += 0.6
    if (pt === "Home Runs" && ln > 0.5) p += 0.8
  }

  // Low implied probability = higher variance.
  if (Number.isFinite(implied)) {
    if (implied < 0.1) p += 0.9
    else if (implied < 0.16) p += 0.55
  }

  // If predictedProbability exists and is low, add extra variance penalty.
  if (Number.isFinite(pred) && pred < 0.2) p += 0.35

  return p
}

function teamTotalBoost(row) {
  const itt = toNum(row?.impliedTeamTotal)
  if (!Number.isFinite(itt)) return 0
  if (itt >= 5.5) return 3
  if (itt >= 5.0) return 2
  return 0
}

function lineupBoost(row) {
  const bo = getBattingOrderIndex(row)
  if (!Number.isFinite(bo)) return 0
  if (bo <= 5) return 2
  if (bo <= 7) return 1
  return 0
}

function recentFormBoost(row) {
  const { l10, season, recent3 } = getRecentForm(row)
  let s = 0
  if (Number.isFinite(l10) && Number.isFinite(season) && l10 > season) s += 1
  // Hot streak proxy: recent3 outpacing l10 materially.
  if (Number.isFinite(recent3) && Number.isFinite(l10) && recent3 >= l10 + 0.4) s += 2
  return s
}

function pitcherMatchupBoost(row) {
  const { era, whip, kRate, kPer9 } = getPitcherMatchup(row)
  let s = 0
  // Boost hitters vs weaker pitchers.
  if (Number.isFinite(era) && era >= 4.6) s += 1
  if (Number.isFinite(era) && era >= 5.2) s += 1
  if (Number.isFinite(whip) && whip >= 1.35) s += 1
  // Penalize vs high-K pitchers (mostly affects contact props).
  const pt = norm(row?.propType)
  if (pt === "Hits" || pt === "Total Bases" || pt === "RBIs") {
    const k = Number.isFinite(kRate) ? kRate : (Number.isFinite(kPer9) ? (kPer9 / 9) : null)
    if (Number.isFinite(k) && k >= 0.26) s -= 1
    if (Number.isFinite(k) && k >= 0.3) s -= 1
  }
  return s
}

function hrEnvironmentBoost(row) {
  if (norm(row?.propType) !== "Home Runs") return 0
  let s = 0
  const gt = toNum(row?.gameTotal)
  if (Number.isFinite(gt) && gt >= 8.5) s += 1
  const park = getParkHrFactor(row)
  if (Number.isFinite(park) && park >= 1.05) s += 1
  const fb = getPitcherFlyBallRate(row)
  if (Number.isFinite(fb) && fb >= 0.38) s += 1
  return s
}

function contextScore(row) {
  return (
    teamTotalBoost(row) +
    lineupBoost(row) +
    recentFormBoost(row) +
    pitcherMatchupBoost(row) +
    hrEnvironmentBoost(row)
  )
}

function oddsAdjustedEdge(row) {
  // Very small weight; if edgeProbability is missing, fallback to predicted - implied when available.
  const edge = toNum(row?.edgeProbability)
  if (Number.isFinite(edge)) return edge
  const pred = toNum(row?.predictedProbability)
  const impl = getImpliedProbability(row)
  if (Number.isFinite(pred) && Number.isFinite(impl)) return pred - impl
  return 0
}

function finalQualityScore(row, ticketType) {
  const conf = baseConfidenceScore(row)
  const oddsPen = oddsPreferencePenalty(row?.odds, ticketType)
  const lineAdj = linePreferenceAdjustment(row, ticketType)
  const risk = riskPenalty(row)
  const upside = upsideBonus(row)
  const ctx = contextScore(row)

  // confidenceScore - riskPenalty + upsideBonus - oddsPenalty + line preference adjustments
  return (conf * 1.0) - (risk * 1.4) + (upside * 1.0) - (oddsPen * 1.0) + (lineAdj * 1.0) + (ctx * 0.9)
}

function valueScore(row) {
  const conf = baseConfidenceScore(row)
  const ctx = contextScore(row)
  const edge = oddsAdjustedEdge(row)
  return (conf * 0.6) + (ctx * 0.3) + (edge * 0.1)
}

function hrRankScore(row) {
  const implied = getImpliedProbability(row)
  const teamTotal = toNum(row?.impliedTeamTotal)
  const signal = toNum(row?.signalScore)
  const base = (Number.isFinite(implied) ? implied : 0) * 4.0
  const tt = Number.isFinite(teamTotal) ? (teamTotal - 3.8) * 0.55 : 0
  const ss = Number.isFinite(signal) ? signal * 0.35 : 0
  // Small odds penalty so we don't chase tails.
  const oddsPen = oddsPreferencePenalty(row?.odds, "AGGRESSIVE")
  return base + tt + ss - (oddsPen * 0.25)
}

function buildWhy(legs, { ticketType } = {}) {
  const safe = Array.isArray(legs) ? legs : []
  const reasons = []

  const totals = safe.map((r) => toNum(r?.gameTotal)).filter((n) => Number.isFinite(n))
  const teamTotals = safe.map((r) => toNum(r?.impliedTeamTotal)).filter((n) => Number.isFinite(n))

  const avgGameTotal = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null
  const avgTeamTotal = teamTotals.length ? teamTotals.reduce((a, b) => a + b, 0) / teamTotals.length : null

  if (Number.isFinite(avgTeamTotal) && avgTeamTotal >= 4.6) reasons.push("targets higher implied team totals")
  if (Number.isFinite(avgGameTotal) && avgGameTotal >= 9.5) reasons.push("leans into higher-total games")

  const propTypes = new Set(safe.map((r) => norm(r?.propType)).filter(Boolean))
  if (ticketType === "HR_STACK") reasons.push("HR-heavy build for max ceiling")
  if (ticketType === "LOTTO") reasons.push("high-variance legs with big payout upside")
  if (propTypes.has("Home Runs") && propTypes.size >= 2) reasons.push("mixes HR with counting stats for balanced upside")

  const teams = safe.map((r) => norm(r?.team)).filter(Boolean)
  const teamCounts = teams.reduce((acc, t) => (acc[t] = (acc[t] || 0) + 1, acc), {})
  const stackedTeams = Object.entries(teamCounts).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
  if (stackedTeams.length) {
    const [t, c] = stackedTeams[0]
    reasons.push(`team stack: ${t} (${c} legs)`)
  }

  return reasons.length ? reasons.join("; ") : "mix of core confidence + upside variance"
}

function formatLeg(row) {
  const player = norm(row?.player) || "Unknown Player"
  const team = norm(row?.team) || "UNK"
  const propType = norm(row?.propType) || "Prop"
  const side = norm(row?.side) || ""
  const line = row?.line == null ? "" : String(row?.line)
  const odds = row?.odds == null ? "" : String(row?.odds)
  const lineLabel = line ? ` ${line}` : ""
  const sideLabel = side ? ` ${side}` : ""
  return `${player} (${team}) — ${propType}${sideLabel}${lineLabel} @ ${odds}`
}

function buildTicket({ type, legs }) {
  const safeLegs = Array.isArray(legs) ? legs.filter(Boolean) : []
  return {
    type,
    legs: safeLegs,
    formattedLegs: safeLegs.map(formatLeg),
    estimatedAmericanOdds: estimateSlipAmericanOdds(safeLegs),
    why: buildWhy(safeLegs, { ticketType: type })
  }
}

function pickLegsFromPool(pool, count, constraints) {
  const safePool = Array.isArray(pool) ? pool.filter(Boolean) : []
  const {
    usedPlayersGlobal,
    usedTicketSignatures,
    maxPerGame = 2,
    allowGameStack = false,
    allowDuplicatePlayersAcrossTickets = false,
    localAvoidPlayers = new Set()
  } = constraints || {}

  const out = []
  const usedPlayersTicket = new Set()
  const gameCounts = new Map()

  for (const row of safePool) {
    if (!row) continue
    const player = norm(row?.player)
    if (!player) continue

    if (usedPlayersTicket.has(player)) continue
    if (localAvoidPlayers.has(player)) continue
    if (!allowDuplicatePlayersAcrossTickets && usedPlayersGlobal && usedPlayersGlobal.has(player)) continue

    const gameKey = norm(row?.eventId || row?.matchup || "")
    const nextGameCount = (gameCounts.get(gameKey) || 0) + 1
    if (!allowGameStack && gameKey && nextGameCount > maxPerGame) continue

    out.push(row)
    usedPlayersTicket.add(player)
    if (gameKey) gameCounts.set(gameKey, nextGameCount)
    if (out.length >= count) break
  }

  const sig = ticketSignature(out)
  if (usedTicketSignatures && sig && usedTicketSignatures.has(sig)) return []
  if (usedTicketSignatures && sig) usedTicketSignatures.add(sig)
  if (usedPlayersGlobal && !allowDuplicatePlayersAcrossTickets) {
    for (const r of out) {
      const p = norm(r?.player)
      if (p) usedPlayersGlobal.add(p)
    }
  }
  return out
}

function computeSlateGameCount(allProps) {
  const safe = Array.isArray(allProps) ? allProps : []
  const ids = new Set()
  for (const r of safe) {
    const id = norm(r?.eventId || r?.matchup)
    if (id) ids.add(id)
  }
  return ids.size
}

function filterFutureProps(rows, now = new Date()) {
  const safe = Array.isArray(rows) ? rows : []
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(nowMs)) return []

  const out = []
  for (const r of safe) {
    if (!r || typeof r !== "object") continue
    const gt = r?.gameTime
    if (!gt) continue
    const t = new Date(gt).getTime()
    if (!Number.isFinite(t)) continue
    if (t > nowMs) out.push(r)
  }
  return out
}

function stackBoostForCandidate(row, currentLegs, ticketType) {
  const allowed = ticketType === "BALANCED" || ticketType === "HR_STACK" || ticketType === "LOTTO"
  if (!allowed) return 0
  const team = norm(row?.team)
  if (!team) return 0
  const existingSameTeam = (Array.isArray(currentLegs) ? currentLegs : []).filter((r) => norm(r?.team) === team).length
  if (existingSameTeam >= 2) return 2 // entering 3-stack
  if (existingSameTeam >= 1) return 1 // entering 2-stack
  return 0
}

function pickLegsGreedyScored(pool, count, constraints, scoreFn) {
  const safePool = Array.isArray(pool) ? pool.filter(Boolean) : []
  const {
    usedPlayersGlobal,
    usedTicketSignatures,
    maxPerGame = 2,
    allowGameStack = false,
    allowDuplicatePlayersAcrossTickets = false,
    localAvoidPlayers = new Set()
  } = constraints || {}

  const out = []
  const usedPlayersTicket = new Set()
  const gameCounts = new Map()

  for (let step = 0; step < count; step += 1) {
    let best = null
    let bestScore = -Infinity

    for (const row of safePool) {
      if (!row) continue
      const player = norm(row?.player)
      if (!player) continue
      if (usedPlayersTicket.has(player)) continue
      if (localAvoidPlayers.has(player)) continue
      if (!allowDuplicatePlayersAcrossTickets && usedPlayersGlobal && usedPlayersGlobal.has(player)) continue

      const gameKey = norm(row?.eventId || row?.matchup || "")
      const nextGameCount = (gameCounts.get(gameKey) || 0) + 1
      if (!allowGameStack && gameKey && nextGameCount > maxPerGame) continue

      const s = typeof scoreFn === "function" ? Number(scoreFn(row, out)) : 0
      if (!Number.isFinite(s)) continue
      if (s > bestScore) {
        bestScore = s
        best = row
      }
    }

    if (!best) break
    const p = norm(best?.player)
    const g = norm(best?.eventId || best?.matchup || "")
    out.push(best)
    if (p) usedPlayersTicket.add(p)
    if (g) gameCounts.set(g, (gameCounts.get(g) || 0) + 1)
  }

  const sig = ticketSignature(out)
  if (usedTicketSignatures && sig && usedTicketSignatures.has(sig)) return []
  if (usedTicketSignatures && sig) usedTicketSignatures.add(sig)
  if (usedPlayersGlobal && !allowDuplicatePlayersAcrossTickets) {
    for (const r of out) {
      const p = norm(r?.player)
      if (p) usedPlayersGlobal.add(p)
    }
  }
  return out
}

/**
 * Build MLB auto tickets from `bestProps` + `allProps`.
 *
 * Contract: additive output only. No mutation of inputs.
 *
 * @param {{ bestProps: object[], allProps: object[] }} input
 * @param {{ maxTickets?: number }} options
 * @returns {{
 *   ok: boolean,
 *   counts: { bestProps: number, allProps: number },
 *   buckets: { hits: number, tb: number, rbi: number, hr: number, alt: number },
 *   tickets: Array<{ type: string, formattedLegs: string[], estimatedAmericanOdds: number|null, why: string }>
 * }}
 */
function buildMlbAutoTickets(input, options = {}) {
  const now = options?.now instanceof Date ? options.now : new Date()
  const bestPropsIn = Array.isArray(input?.bestProps) ? input.bestProps : []
  const allPropsIn = Array.isArray(input?.allProps) ? input.allProps : []

  // Only allow props from games that have not started yet.
  const bestProps = filterFutureProps(bestPropsIn, now)
  const allProps = filterFutureProps(allPropsIn, now)
  const maxTickets = Number.isFinite(Number(options?.maxTickets)) ? Math.max(5, Math.min(15, Number(options.maxTickets))) : 10

  const totalGames = computeSlateGameCount(allProps)
  const slateTighten = totalGames >= 8 ? 1.15 : 1.0
  const slateLoosen = totalGames > 0 && totalGames < 6 ? 0.85 : 1.0
  const slatePenaltyScale = slateTighten * slateLoosen

  const buckets = classifyBuckets(allProps)

  const bestRanked = [...bestProps].filter(Boolean)
  const bestFallback = [...allProps]
    .filter((r) =>
      r &&
      (norm(r?.propType) === "Hits" || norm(r?.propType) === "Total Bases" || norm(r?.propType) === "RBIs") &&
      Number.isFinite(Number(r?.odds))
    )
    .sort((a, b) => baseConfidenceScore(b) - baseConfidenceScore(a))

  const bestPoolRanked = (bestRanked.length ? bestRanked : bestFallback)
    .filter(Boolean)
    .sort((a, b) => baseConfidenceScore(b) - baseConfidenceScore(a))

  const hrRanked = [...buckets.hrProps]
    .filter(Boolean)
    .sort((a, b) => hrRankScore(b) - hrRankScore(a))

  const allRankedUpside = [...allProps]
    .filter((r) => r && Number.isFinite(Number(r?.odds)))
    .map((r) => ({ r, s: finalQualityScore(r, "LOTTO") }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r)

  const altRanked = [...buckets.altProps]
    .filter((r) => r && Number.isFinite(Number(r?.odds)))
    .map((r) => ({ r, s: finalQualityScore(r, "LOTTO") + (isAltLike(r) ? 0.25 : 0) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r)

  const usedPlayersGlobal = new Set()
  const usedTicketSignatures = new Set()

  const tickets = []

  // SAFE (3 legs): 3 from bestProps, prioritize Hits + TB when possible.
  {
    const safePool = [...bestPoolRanked].filter((r) => r && Number.isFinite(Number(r?.odds)))
    const legs = pickLegsGreedyScored(
      safePool,
      3,
      { usedPlayersGlobal, usedTicketSignatures, maxPerGame: 2 },
      (row) => {
        const pt = norm(row?.propType)
        const edge = oddsAdjustedEdge(row)
        // SAFE rule: no HR unless extreme edge.
        const hrPenalty = pt === "Home Runs" && !(Number.isFinite(edge) && edge >= 0.12) ? 6 : 0
        const score = finalQualityScore(row, "SAFE") - (oddsPreferencePenalty(row?.odds, "SAFE") * slatePenaltyScale) - hrPenalty
        return score
      }
    )
    if (legs.length === 3) tickets.push(buildTicket({ type: "SAFE", legs }))
  }

  // BALANCED (4 legs): 2 bestProps + 2 allProps (RBI/TB).
  {
    const balancedBestPool = [...bestPoolRanked].filter((r) => r && Number.isFinite(Number(r?.odds)))
    const legsBest = pickLegsGreedyScored(
      balancedBestPool,
      2,
      { usedPlayersGlobal, usedTicketSignatures, maxPerGame: 2 },
      (row, cur) => finalQualityScore(row, "BALANCED") + stackBoostForCandidate(row, cur, "BALANCED")
    )
    const avoid = new Set(legsBest.map((r) => norm(r?.player)).filter(Boolean))
    const poolAll = [...allProps].filter((r) =>
      r &&
      Number.isFinite(Number(r?.odds)) &&
      (norm(r?.propType) === "RBIs" || norm(r?.propType) === "Total Bases" || norm(r?.propType) === "Hits")
    )

    const legsAll = pickLegsGreedyScored(poolAll, 2, {
      usedPlayersGlobal,
      usedTicketSignatures,
      maxPerGame: 2,
      localAvoidPlayers: avoid
    }, (row, cur) => {
      const corr = stackBoostForCandidate(row, [...legsBest, ...cur], "BALANCED") * 2
      return (valueScore(row) * 0.6 + finalQualityScore(row, "BALANCED") * 0.4) + corr - (oddsPreferencePenalty(row?.odds, "BALANCED") * 0.25 * slatePenaltyScale)
    })
    const legs = [...legsBest, ...legsAll]
    if (legs.length === 4) tickets.push(buildTicket({ type: "BALANCED", legs }))
  }

  // AGGRESSIVE (5 legs): 2 bestProps + 3 allProps (include 1 HR).
  {
    const aggressiveBestPool = [...bestPoolRanked].filter((r) => r && Number.isFinite(Number(r?.odds)))
    const legsBest = pickLegsGreedyScored(
      aggressiveBestPool,
      2,
      { usedPlayersGlobal, usedTicketSignatures, maxPerGame: 2 },
      (row) => finalQualityScore(row, "AGGRESSIVE") - (oddsPreferencePenalty(row?.odds, "AGGRESSIVE") * 0.25 * slatePenaltyScale)
    )
    const avoid = new Set(legsBest.map((r) => norm(r?.player)).filter(Boolean))
    const hrLeg = pickLegsGreedyScored(hrRanked, 1, {
      usedPlayersGlobal,
      usedTicketSignatures,
      maxPerGame: 3,
      localAvoidPlayers: avoid
    }, (row) => hrRankScore(row) + finalQualityScore(row, "AGGRESSIVE") * 0.15)
    for (const r of hrLeg) {
      const p = norm(r?.player)
      if (p) avoid.add(p)
    }
    const legsAllPool = [...allProps].filter((r) => r && Number.isFinite(Number(r?.odds)))
    const legsAll = pickLegsGreedyScored(legsAllPool, 2, {
      usedPlayersGlobal,
      usedTicketSignatures,
      maxPerGame: 2,
      localAvoidPlayers: avoid
    }, (row) => finalQualityScore(row, "AGGRESSIVE") - (oddsPreferencePenalty(row?.odds, "AGGRESSIVE") * 0.15 * slatePenaltyScale))
    const legs = [...legsBest, ...hrLeg, ...legsAll]
    if (legs.length === 5) tickets.push(buildTicket({ type: "AGGRESSIVE", legs }))
  }

  // HR STACK (4–5 legs): top hrProps; allow same game stacking.
  {
    const hrStackPool = [...hrRanked].filter((r) => r && Number.isFinite(Number(r?.odds)))
    const legs = pickLegsGreedyScored(hrStackPool, 5, {
      usedPlayersGlobal,
      usedTicketSignatures,
      maxPerGame: 5,
      allowGameStack: true
    }, (row, cur) => {
      const corr = stackBoostForCandidate(row, cur, "HR_STACK") * 2
      return hrRankScore(row) + finalQualityScore(row, "HR_STACK") * 0.2 + corr
    })
    if (legs.length >= 4) tickets.push(buildTicket({ type: "HR_STACK", legs: legs.slice(0, 5) }))
  }

  // LOTTO (5–6 legs): hrProps + altProps + RBI mix; high-upside only.
  {
    const seed = [
      ...hrRanked,
      ...altRanked,
      ...allRankedUpside.slice(0, 800)
    ].filter((r) => r && Number.isFinite(Number(r?.odds)))

    const legs = pickLegsGreedyScored(seed, 6, {
      usedPlayersGlobal,
      usedTicketSignatures,
      maxPerGame: 3,
      allowGameStack: true
    }, (row, cur) => {
      const corr = stackBoostForCandidate(row, cur, "LOTTO") * 2
      return finalQualityScore(row, "LOTTO") + corr
    })
    if (legs.length >= 5) tickets.push(buildTicket({ type: "LOTTO", legs: legs.slice(0, 6) }))
  }

  // Ensure we always return at least 5 types when possible by adding an extra BALANCED-like variant.
  if (tickets.length < 5) {
    const legs = pickLegsFromPool(allRankedUpside, 5, {
      usedPlayersGlobal,
      usedTicketSignatures,
      maxPerGame: 2,
      allowGameStack: false
    })
    if (legs.length >= 4) tickets.push(buildTicket({ type: "VARIETY", legs: legs.slice(0, 5) }))
  }

  return {
    ok: true,
    counts: {
      bestProps: bestProps.length,
      allProps: allProps.length,
      bestPropsIn: bestPropsIn.length,
      allPropsIn: allPropsIn.length
    },
    buckets: {
      hits: buckets.hitsProps.length,
      tb: buckets.tbProps.length,
      rbi: buckets.rbiProps.length,
      hr: buckets.hrProps.length,
      alt: buckets.altProps.length
    },
    tickets: tickets.slice(0, maxTickets).map((t) => ({
      type: t.type,
      formattedLegs: t.formattedLegs,
      estimatedAmericanOdds: t.estimatedAmericanOdds,
      why: t.why
    }))
  }
}

module.exports = { buildMlbAutoTickets }

