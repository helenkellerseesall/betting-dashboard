"use strict"

const { dedupeCandidates } = require("./nbaOpportunityCandidates")
const { isNbaStatLadderRow } = require("./nbaStatLadder")
const { resolveLegFromAiRange, resolveLottoLegAboveCeiling } = require("./nbaAiOutcomeRange")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pk(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

function eid(c) {
  return String(c?.eventId || "").trim()
}

function propBlob(c) {
  return `${String(c?.propType || "")} ${String(c?.marketKey || "")} ${String(c?.ladder || "")}`.toLowerCase()
}

function compositeScore(c) {
  const fw = toNum(c.finalWeight) ?? 0
  const e = toNum(c.edge) ?? 0
  const m = toNum(c.matchupAdj) ?? 0
  const p = toNum(c.paceAdj) ?? 0
  const b = toNum(c.blowoutAdj) ?? 0
  const s = toNum(c.statAdj) ?? 0
  const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  const trend = toNum(rf?.trend_delta) ?? 0
  const formN = trend > 0.08 ? 0.12 : trend < -0.08 ? -0.1 : trend > 0 ? 0.05 : trend < 0 ? -0.04 : 0
  return fw + 3.2 * e + 1.15 * m + 0.85 * p + 0.45 * b + 0.35 * s + formN
}

/** Pace + total high enough to allow correlated same-game legs. */
function isHighEnvRow(c) {
  const pace = toNum(c?.eventPace ?? c?.pace)
  const tot = toNum(c?.gameTotal ?? c?.eventTotal ?? c?.total)
  return Number.isFinite(pace) && pace >= 102 && Number.isFinite(tot) && tot >= 228
}

/** Over-line → displayed milestone (e.g. 29.5 → 30+). */
function overRungFromLine(ln) {
  const n = toNum(ln)
  if (!Number.isFinite(n)) return null
  return Math.ceil(n - 0.49 + 1e-9)
}

function ladderTierHigh(c) {
  if (!isNbaStatLadderRow(c)) return false
  const pb = propBlob(c)
  const lad = String(c?.ladder || "").toLowerCase()
  const pv = String(c?.propVariant || "").toLowerCase()
  if (pv.includes("high") || pv.includes("ceiling")) return true
  if (/\b(40|38)\+/.test(lad)) return true
  if (/\b35\+/.test(lad)) return true
  if (/\b30\+/.test(lad) && /point|pra|pts|rebound|assist|three|3pt/.test(lad)) return true
  if (/\b4\+|\b4\.5|\b5\+/.test(lad) && /three|3pt|threes/.test(pb)) return true
  const ln = toNum(c?.line)
  if (!Number.isFinite(ln)) return false
  if (/point/.test(pb) && !/pra|points.*rebounds|pts.*reb.*ast/.test(pb)) {
    const r = overRungFromLine(ln)
    if (r != null && r >= 30) return true
    if (ln >= 29.5) return true
  }
  if ((/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(pb) || /\bpra\b/.test(pb)) && (ln >= 28.5 || overRungFromLine(ln) >= 30))
    return true
  if ((/three|3pt|threes/.test(pb) || /player_three/.test(pb)) && ln >= 2.5) return true
  if (/rebound/.test(pb) && ln >= 11.5) return true
  if (/assist/.test(pb) && ln >= 8.5) return true
  return false
}

function lottoSeedScore(c) {
  const e = toNum(c.edge) ?? 0
  const fw = toNum(c.finalWeight) ?? 0
  const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  const trend = toNum(rf?.trend_delta) ?? 0
  const ln = toNum(c.line) ?? 0
  const lineCeil = Math.min(1.2, ln / 42)
  return trend * 1.45 + e * 2.35 + fw * 0.32 + lineCeil
}

function isLottoCeilingLeg(c) {
  return isNbaStatLadderRow(c) && ladderTierHigh(c)
}

function collectFullPool(opp) {
  const ranked = opp?.aiPicksRankedPool
  if (Array.isArray(ranked) && ranked.length) return dedupeCandidates(ranked)

  const chunks = []
  const push = (arr) => {
    if (Array.isArray(arr) && arr.length) chunks.push(...arr)
  }
  if (!opp || typeof opp !== "object") return []
  push(opp.coreCandidates)
  push(opp.ladderCandidates)
  push(opp.praCandidates)
  push(opp.altThreesCandidates)
  push(opp.altPointsCandidates)
  push(opp.comboCandidates)
  push(opp.doubleDoubleCandidates)
  push(opp.tripleDoubleCandidates)
  return dedupeCandidates(chunks.filter((x) => x && typeof x === "object" && pk(x)))
}

function legVolatility(c) {
  const t = `${String(c.propType || "")} ${String(c.marketKey || "")}`.toLowerCase()
  if (/three|3pt/.test(t)) return 1.18
  if (/pra|points.*rebounds.*assists/.test(t)) return 1.08
  if (/assist|rebound/.test(t)) return 0.92
  return 1.0
}

function deriveMilestoneDisplay(c) {
  const ladRaw = String(c.ladder || "").trim()
  if (/^\d+\+?$/.test(ladRaw) || /^\d+\+$/.test(ladRaw)) return ladRaw.endsWith("+") ? ladRaw : `${ladRaw}+`
  const ln = toNum(c.line)
  const pb = propBlob(c)
  if (Number.isFinite(ln)) {
    const r = overRungFromLine(ln)
    if (r != null) {
      if (/point/.test(pb) && !/pra|points.*rebounds|pts.*reb.*ast/.test(pb)) return `Points ${r}+`
      if ((/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(pb) || /\bpra\b/.test(pb))) return `PRA ${r}+`
      if (/three|3pt|threes/.test(pb) || /player_three/.test(pb)) return `Threes ${r}+`
      if (/rebound/.test(pb)) return `Rebounds ${r}+`
      if (/assist/.test(pb)) return `Assists ${r}+`
      return `${String(c.propType || "Prop").trim()} ${r}+`
    }
  }
  const lad = ladRaw.toLowerCase()
  if (
    lad.length > 0 &&
    lad !== "alt-mid" &&
    lad !== "alt mid" &&
    lad !== "alt_mid" &&
    lad !== "alt" &&
    (/\+/.test(ladRaw) || /\d/.test(ladRaw))
  )
    return ladRaw
  return null
}

function formatLeg(c) {
  const player = String(c.player || "").trim() || "Player"
  const side = String(c.side || "Over").trim()
  const ln = toNum(c.line)
  const lad = String(c.ladder || "").trim()
  if (lad && /^(\d+)\+?$/.test(lad)) {
    const m = lad.match(/^(\d+)/)
    const r = m ? m[1] : ""
    return `${player} ${side} — ${r}+`
  }
  const disp = deriveMilestoneDisplay(c)
  if (disp) return `${player} ${side} — ${disp}`
  const pt = String(c.propType || "").trim()
  if (Number.isFinite(ln)) return `${player} ${side} ${ln} (${pt})`
  return `${player} ${side} (${pt})`
}

function isRangeResolvedLeg(L) {
  return Boolean(L && L.aiRangeSlot)
}

function gameCountByEvent(legs) {
  const m = new Map()
  for (const L of legs) {
    const id = eid(L)
    if (!id) continue
    m.set(id, (m.get(id) || 0) + 1)
  }
  return m
}

function maxPerGame(legs) {
  let mx = 0
  for (const n of gameCountByEvent(legs).values()) mx = Math.max(mx, n)
  return mx
}

function effectiveMaxSameGame(legs, cand, baseMax) {
  const id = eid(cand)
  if (!id) return baseMax
  const same = legs.filter((L) => eid(L) === id)
  if (!same.length) return baseMax
  const envOk = isHighEnvRow(cand) && same.every((L) => isHighEnvRow(L))
  if (envOk) return Math.max(baseMax, 2)
  return baseMax
}

function canAddLeg(legs, cand, opts = {}) {
  const { maxSameGame = 2, maxVolSum = 9, relaxSameGameForHighEnv = true } = opts
  if (legs.some((L) => pk(L) === pk(cand))) return false
  const maxSg = relaxSameGameForHighEnv ? effectiveMaxSameGame(legs, cand, maxSameGame) : maxSameGame
  const next = [...legs, cand]
  if (maxPerGame(next) > maxSg) return false
  const vol = next.reduce((s, L) => s + legVolatility(L), 0)
  if (vol > maxVolSum) return false
  return true
}

function sortByCompositeDesc(xs) {
  return [...xs].sort((a, b) => compositeScore(b) - compositeScore(a))
}

function exposureAllows(exposure, pkVal) {
  return (exposure.get(pkVal) || 0) < 2
}

function registerSlipPlayers(legs, exposure) {
  const seen = new Set()
  for (const L of legs || []) {
    const k = pk(L)
    if (!k || seen.has(k)) continue
    seen.add(k)
    exposure.set(k, (exposure.get(k) || 0) + 1)
  }
}

function unregisterSlipPlayers(legs, exposure) {
  const seen = new Set()
  for (const L of legs || []) {
    const k = pk(L)
    if (!k || seen.has(k)) continue
    seen.add(k)
    exposure.set(k, Math.max(0, (exposure.get(k) || 0) - 1))
  }
}

function diversityRank(c, usedAcrossSlips) {
  const k = pk(c)
  const u = usedAcrossSlips.has(k) ? 1 : 0
  const exp = usedAcrossSlips.size ? u : 0
  return exp
}

function sortLaddersLineDesc(ladders) {
  return [...ladders].sort((a, b) => (toNum(b.line) ?? -1) - (toNum(a.line) ?? -1))
}

function findLadderLegsForPlayer(playerNorm, eventId, pool) {
  return pool
    .filter((c) => pk(c) === playerNorm && (!eventId || eid(c) === eventId) && isNbaStatLadderRow(c))
    .sort((a, b) => {
      const de = (toNum(b.edge) ?? 0) - (toNum(a.edge) ?? 0)
      if (Math.abs(de) > 1e-9) return de
      return (toNum(b.finalWeight) ?? 0) - (toNum(a.finalWeight) ?? 0)
    })
}

/** LOTTO: strict high-tier only, highest line for that player/event. */
function findHighestHighLadderForPlayer(playerNorm, eventId, pool) {
  const xs = sortLaddersLineDesc(findLadderLegsForPlayer(playerNorm, eventId, pool).filter(ladderTierHigh))
  return xs[0] || null
}

function buildSafeSlip(elite, pool, exposure, usedAcrossSlips) {
  const sorted = sortByCompositeDesc(elite || []).sort(
    (a, b) => diversityRank(a, usedAcrossSlips) - diversityRank(b, usedAcrossSlips) || compositeScore(b) - compositeScore(a)
  )
  const legs = []
  for (const c of sorted) {
    if (legs.length >= 2) break
    if (!exposureAllows(exposure, pk(c))) continue
    const L = c.aiRange ? resolveLegFromAiRange(c, pool, "floor") : null
    if (!L || !isRangeResolvedLeg(L)) continue
    if (!canAddLeg(legs, L, { maxSameGame: 1, maxVolSum: 9, relaxSameGameForHighEnv: true })) continue
    legs.push(L)
  }
  if (legs.length < 2) {
    for (const c of sorted) {
      if (legs.length >= 2) break
      if (legs.some((L) => pk(L) === pk(c))) continue
      if (!exposureAllows(exposure, pk(c))) continue
      const L = c.aiRange ? resolveLegFromAiRange(c, pool, "floor") : null
      if (!L || !isRangeResolvedLeg(L)) continue
      if (!canAddLeg(legs, L, { maxSameGame: 2, maxVolSum: 9, relaxSameGameForHighEnv: true })) continue
      legs.push(L)
    }
  }
  return { type: "SAFE", legs, note: legs.length < 2 ? "insufficient_elite" : null }
}

function buildBalancedSlip(elite, strong, pool, exposure, usedAcrossSlips) {
  const eliteSorted = sortByCompositeDesc(elite || []).sort(
    (a, b) => diversityRank(a, usedAcrossSlips) - diversityRank(b, usedAcrossSlips) || compositeScore(b) - compositeScore(a)
  )
  const e0 = eliteSorted.find((c) => exposureAllows(exposure, pk(c)))
  const str = sortByCompositeDesc(strong || []).sort(
    (a, b) => diversityRank(a, usedAcrossSlips) - diversityRank(b, usedAcrossSlips) || compositeScore(b) - compositeScore(a)
  )
  if (!e0) return { type: "BALANCED", legs: [], note: "no_elite" }
  if (!exposureAllows(exposure, pk(e0))) return { type: "BALANCED", legs: [], note: "elite_exposure" }
  const e0Leg = e0.aiRange ? resolveLegFromAiRange(e0, pool, "median") : null
  if (!e0Leg || !isRangeResolvedLeg(e0Leg)) return { type: "BALANCED", legs: [], note: "no_median" }
  const legs = [e0Leg]
  for (const c of str) {
    if (legs.length >= 3) break
    if (!exposureAllows(exposure, pk(c))) continue
    const leg = c.aiRange ? resolveLegFromAiRange(c, pool, "median") : null
    if (!leg || !isRangeResolvedLeg(leg)) continue
    if (!canAddLeg(legs, leg, { maxSameGame: 2, maxVolSum: 3.85, relaxSameGameForHighEnv: true })) continue
    legs.push(leg)
  }
  if (legs.length < 2) {
    for (const c of str) {
      if (legs.length >= 2) break
      if (legs.some((L) => pk(L) === pk(c))) continue
      if (!exposureAllows(exposure, pk(c))) continue
      const leg = c.aiRange ? resolveLegFromAiRange(c, pool, "median") : null
      if (!leg || !isRangeResolvedLeg(leg)) continue
      if (!canAddLeg(legs, leg, { maxSameGame: 2, maxVolSum: 3.85, relaxSameGameForHighEnv: true })) continue
      legs.push(leg)
    }
  }
  return { type: "BALANCED", legs, note: legs.length < 2 ? "thin_pool" : null }
}

function buildAggressiveSlip(elite, strong, pool, exposure, usedAcrossSlips) {
  const seed = sortByCompositeDesc([...(elite || []), ...(strong || [])]).sort(
    (a, b) => diversityRank(a, usedAcrossSlips) - diversityRank(b, usedAcrossSlips) || compositeScore(b) - compositeScore(a)
  )
  const seen = new Set()
  const uniq = []
  for (const c of seed) {
    const k = pk(c)
    if (!k || seen.has(k)) continue
    if (!exposureAllows(exposure, k)) continue
    seen.add(k)
    uniq.push(c)
    if (uniq.length >= 10) break
  }
  const legs = []
  for (const base of uniq) {
    if (legs.length >= 3) break
    if (!base.aiRange) continue
    if (!exposureAllows(exposure, pk(base))) continue
    const leg = resolveLegFromAiRange(base, pool, "ceiling")
    if (!leg || !isRangeResolvedLeg(leg)) continue
    if (!exposureAllows(exposure, pk(leg))) continue
    if (!canAddLeg(legs, leg, { maxSameGame: 2, maxVolSum: 3.45, relaxSameGameForHighEnv: true })) continue
    legs.push(leg)
  }
  const usedPk = new Set(legs.map((L) => pk(L)))
  const seedAll = sortByCompositeDesc([...(elite || []), ...(strong || [])]).sort(
    (a, b) => diversityRank(a, usedAcrossSlips) - diversityRank(b, usedAcrossSlips) || compositeScore(b) - compositeScore(a)
  )
  while (legs.length < 3) {
    let progressed = false
    for (const base of seedAll) {
      if (usedPk.has(pk(base))) continue
      if (!base.aiRange) continue
      if (!exposureAllows(exposure, pk(base))) continue
      const leg = resolveLegFromAiRange(base, pool, "ceiling")
      if (!leg || !isRangeResolvedLeg(leg)) continue
      if (!exposureAllows(exposure, pk(leg))) continue
      if (!canAddLeg(legs, leg, { maxSameGame: 2, maxVolSum: 3.45, relaxSameGameForHighEnv: true })) continue
      legs.push(leg)
      usedPk.add(pk(leg))
      progressed = true
      break
    }
    if (!progressed) break
  }
  return { type: "AGGRESSIVE", legs, note: legs.length < 3 ? "need_more_ladders" : null }
}

function buildLottoSlip(elite, strong, pool, exposure, usedAcrossSlips) {
  const seed = [...(elite || []), ...(strong || [])].sort(
    (a, b) =>
      diversityRank(a, usedAcrossSlips) - diversityRank(b, usedAcrossSlips) ||
      lottoSeedScore(b) - lottoSeedScore(a)
  )
  const seen = new Set()
  const uniq = []
  for (const c of seed) {
    const k = pk(c)
    if (!k || seen.has(k)) continue
    if (!exposureAllows(exposure, k)) continue
    seen.add(k)
    uniq.push(c)
    if (uniq.length >= 14) break
  }
  const legs = []
  let threes = 0
  for (const base of uniq) {
    if (legs.length >= 3) break
    if (!exposureAllows(exposure, pk(base))) continue
    let leg = null
    if (base.aiRange) leg = resolveLottoLegAboveCeiling(base, pool)
    else leg = findHighestHighLadderForPlayer(pk(base), eid(base), pool)
    if (!leg) continue
    if (base.aiRange) {
      if (!isRangeResolvedLeg(leg)) continue
    } else if (!isLottoCeilingLeg(leg)) continue
    if (!exposureAllows(exposure, pk(leg))) continue
    const t = `${leg.propType || ""} ${leg.marketKey || ""}`.toLowerCase()
    if (/three|3pt/.test(t) && threes >= 1 && legs.length >= 1) continue
    if (!canAddLeg(legs, leg, { maxSameGame: 2, maxVolSum: 3.55, relaxSameGameForHighEnv: true })) continue
    if (/three|3pt/.test(t)) threes += 1
    legs.push(leg)
  }
  const usedPkL = new Set(legs.map((L) => pk(L)))
  const rangeFiller = []
  for (const base of [...(elite || []), ...(strong || [])].sort(
    (a, b) => lottoSeedScore(b) - lottoSeedScore(a) || compositeScore(b) - compositeScore(a)
  )) {
    if (usedPkL.has(pk(base))) continue
    if (!exposureAllows(exposure, pk(base))) continue
    if (!base.aiRange) continue
    const leg = resolveLottoLegAboveCeiling(base, pool)
    if (!leg || !isRangeResolvedLeg(leg)) continue
    rangeFiller.push(leg)
  }
  rangeFiller.sort(
    (a, b) => lottoSeedScore(b) - lottoSeedScore(a) || (toNum(b.line) ?? 0) - (toNum(a.line) ?? 0)
  )
  while (legs.length < 3 && rangeFiller.length) {
    const c = rangeFiller.shift()
    if (!c || usedPkL.has(pk(c))) continue
    if (!exposureAllows(exposure, pk(c))) continue
    const t = `${c.propType || ""} ${c.marketKey || ""}`.toLowerCase()
    if (/three|3pt/.test(t) && threes >= 1 && legs.length >= 1) continue
    if (!canAddLeg(legs, c, { maxSameGame: 2, maxVolSum: 3.55, relaxSameGameForHighEnv: true })) continue
    if (/three|3pt/.test(t)) threes += 1
    legs.push(c)
    usedPkL.add(pk(c))
  }
  return { type: "LOTTO", legs, note: legs.length < 3 ? "need_more_ceiling" : null }
}

function slipsDiffer(a, b) {
  const ka = (a.legs || []).map((L) => `${pk(L)}|${eid(L)}|${toNum(L.line)}`).sort().join(";")
  const kb = (b.legs || []).map((L) => `${pk(L)}|${eid(L)}|${toNum(L.line)}`).sort().join(";")
  return ka !== kb
}

function formatSlipsBlock(slips, generatedAt) {
  const lines = ["==== SLIPS ====", `Generated: ${generatedAt}`, ""]
  for (const s of slips) {
    lines.push(`${String(s.type || "SLIP").toUpperCase()}:`)
    if (!s.legs || !s.legs.length) {
      lines.push("(no slip — pool too thin for rules)")
      lines.push("")
      continue
    }
    s.legs.forEach((L) => lines.push(`- ${formatLeg(L)}`))
    if (s.note) lines.push(`  (${s.note})`)
    lines.push("")
  }
  lines.push("================")
  lines.push("")
  return lines.join("\n")
}

/**
 * Build four slip archetypes from AI picks + scored opportunity pool (for ladder resolution).
 * @param {{ elite: object[], strong: object[], opportunityBoard: object }} input
 */
function buildNbaAiSlips(input) {
  const generatedAt = new Date().toISOString()
  const elite = Array.isArray(input?.elite) ? input.elite : []
  const strong = Array.isArray(input?.strong) ? input.strong : []
  const opp = input?.opportunityBoard && typeof input.opportunityBoard === "object" ? input.opportunityBoard : {}
  const pool = collectFullPool(opp)

  const exposure = new Map()
  const usedAcrossSlips = new Set()

  const safe = buildSafeSlip(elite, pool, exposure, usedAcrossSlips)
  registerSlipPlayers(safe.legs, exposure)
  for (const L of safe.legs || []) usedAcrossSlips.add(pk(L))

  const balanced = buildBalancedSlip(elite, strong, pool, exposure, usedAcrossSlips)
  registerSlipPlayers(balanced.legs, exposure)
  for (const L of balanced.legs || []) usedAcrossSlips.add(pk(L))

  const aggressive = buildAggressiveSlip(elite, strong, pool, exposure, usedAcrossSlips)
  registerSlipPlayers(aggressive.legs, exposure)
  for (const L of aggressive.legs || []) usedAcrossSlips.add(pk(L))

  const lotto = buildLottoSlip(elite, strong, pool, exposure, usedAcrossSlips)
  registerSlipPlayers(lotto.legs, exposure)
  for (const L of lotto.legs || []) usedAcrossSlips.add(pk(L))

  const slips = [safe, balanced, aggressive, lotto]
  if (aggressive.legs.length && lotto.legs.length && !slipsDiffer(aggressive, lotto)) {
    lotto.note = (lotto.note ? lotto.note + "; " : "") + "diversified_vs_aggressive"
    const oldLottoLegs = [...(lotto.legs || [])]
    unregisterSlipPlayers(lotto.legs, exposure)
    const banned = new Set(aggressive.legs.map((L) => pk(L)))
    const altSeeds = [...elite, ...strong].sort(
      (a, b) => lottoSeedScore(b) - lottoSeedScore(a) || compositeScore(b) - compositeScore(a)
    )
    const altLegs = []
    for (const base of altSeeds) {
      if (altLegs.length >= 3) break
      if (banned.has(pk(base))) continue
      if (!exposureAllows(exposure, pk(base))) continue
      const leg = base.aiRange ? resolveLottoLegAboveCeiling(base, pool) : null
      if (!leg || !isRangeResolvedLeg(leg)) continue
      if (!canAddLeg(altLegs, leg, { maxSameGame: 2, maxVolSum: 3.55, relaxSameGameForHighEnv: true })) continue
      altLegs.push(leg)
    }
    if (altLegs.length >= 2) {
      lotto.legs = altLegs.slice(0, 3)
      registerSlipPlayers(lotto.legs, exposure)
    } else {
      lotto.legs = oldLottoLegs
      registerSlipPlayers(lotto.legs, exposure)
    }
  }

  return {
    safe,
    balanced,
    aggressive,
    lotto,
    slips,
    formattedText: formatSlipsBlock(slips, generatedAt),
    generatedAt,
  }
}

module.exports = {
  buildNbaAiSlips,
  formatLeg,
}
