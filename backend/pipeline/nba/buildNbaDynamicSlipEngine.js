"use strict"

/**
 * NBA dynamic slip engine (v2): correlation stacks, confidence-sized variations,
 * RR (2- & 3-leg), max 1 prop/player/slip, rotation across clusters, quality filters,
 * self-validate + rebuild pass.
 *
 * Env: NBA_DYNAMIC_SLIP_ENGINE=0 → legacy buildNbaAiSlips (see buildNbaOpportunityBoard).
 * NBA_SLIP_MIN_EDGE (default -0.028), NBA_RR_MAX_COMBOS (default 200)
 */

const { statFamilyKey, resolveLegFromAiRange, overRungFromLine } = require("./nbaAiOutcomeRange")
const { collectFullPool, filterSlipLegs, formatLeg } = require("./buildNbaAiSlips")
const {
  legPassesSlipHardQuality,
  canAddLegToSlipFull,
  dedupeAndValidateSlipLegs,
  slipConstructionErrors,
  dominantEventIdFromPicks,
} = require("./nbaSlipLegConstraints")

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

function normTeam(t) {
  return String(t || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0.5
  return Math.max(0, Math.min(1, x))
}

const MIN_EDGE = Number.isFinite(Number(process.env.NBA_SLIP_MIN_EDGE))
  ? Number(process.env.NBA_SLIP_MIN_EDGE)
  : -0.028

function isRangeResolvedLeg(L) {
  return Boolean(L && L.aiRangeSlot)
}

function isFastCashoutLeg(L) {
  if (!L || typeof L !== "object") return false
  const mk = String(L.marketKey || "").toLowerCase()
  const pb = propBlob(L)
  if (mk.includes("first_basket") || /\bfirst basket\b/i.test(pb)) return true
  if (mk.includes("first_team_basket")) return true
  if (/three|3pt|player_three/.test(pb)) return true
  if (/point/.test(pb) && !/pra|rebound|assist|points.*rebounds/.test(pb)) {
    const ln = toNum(L.line)
    const r = overRungFromLine(ln)
    if (Number.isFinite(r) && r <= 22) return true
    if (Number.isFinite(ln) && ln <= 21.5) return true
  }
  return false
}

function linkedStatFamilies(a, b) {
  const pair = new Set([a, b])
  if (pair.has("points") && pair.has("threes")) return true
  if (pair.has("points") && pair.has("pra")) return true
  if (pair.has("threes") && pair.has("pra")) return true
  if (pair.has("points") && pair.has("rebounds")) return true
  return false
}

/** Phase 4 — correlated stacks (boost when legs cohere). */
function pairwiseStackBoost(a, b, eventMeta) {
  if (!a || !b || pk(a) === pk(b)) return 0
  const ea = eid(a)
  const eb = eid(b)
  if (!ea || ea !== eb) return 0
  const meta = eventMeta && eventMeta.get ? eventMeta.get(ea) : null
  const fa = statFamilyKey(a)
  const fb = statFamilyKey(b)
  const ta = normTeam(a.team)
  const tb = normTeam(b.team)
  const sameTeam = ta && tb && ta === tb
  let boost = 0
  if (sameTeam && fa === "points" && fb === "assists") boost += 0.14
  if (sameTeam && fa === "assists" && fb === "points") boost += 0.14
  if (fa === "points" && fb === "threes") boost += 0.1
  if (fa === "threes" && fb === "points") boost += 0.1
  const paceHi = meta && Number.isFinite(meta.pace) && meta.pace >= 102
  if (paceHi && (fa === "points" || fa === "threes") && (fb === "points" || fb === "threes")) boost += 0.07
  const usageHi = meta && Number.isFinite(meta.maxUsage) && meta.maxUsage >= 27
  const totHi = meta && Number.isFinite(meta.total) && meta.total >= 228
  if (usageHi && totHi && (fa === "pra" || fb === "pra")) boost += 0.09
  if (linkedStatFamilies(fa, fb)) boost += 0.05
  return Math.min(0.38, boost)
}

function buildEventMetaMap(pool) {
  const m = new Map()
  for (const r of Array.isArray(pool) ? pool : []) {
    if (!r || typeof r !== "object") continue
    const id = eid(r)
    if (!id) continue
    const cur = m.get(id) || { pace: null, total: null, maxUsage: 0 }
    const p = toNum(r.eventPace ?? r.pace)
    const t = toNum(r.gameTotal ?? r.eventTotal ?? r.total)
    if (Number.isFinite(p)) cur.pace = cur.pace == null ? p : Math.max(cur.pace, p)
    if (Number.isFinite(t)) cur.total = cur.total == null ? t : Math.max(cur.total, t)
    const u = toNum(r.usageRate ?? r.playerUsage ?? r.usage)
    if (Number.isFinite(u)) cur.maxUsage = Math.max(cur.maxUsage, u)
    m.set(id, cur)
  }
  return m
}

function jointProbabilityWithCorrelation(legs, eventMeta) {
  let p = 1
  for (const L of legs) p *= clamp01(toNum(L.probability) ?? 0.52)
  if (legs.length < 2) return { joint: clamp01(p), pairBoostAvg: 0, rawProduct: clamp01(p) }
  let s = 0
  let c = 0
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      s += pairwiseStackBoost(legs[i], legs[j], eventMeta)
      c += 1
    }
  }
  const avg = c ? s / c : 0
  return { joint: clamp01(p * (1 + 0.22 * avg)), pairBoostAvg: avg, rawProduct: clamp01(p) }
}

function legKey(leg) {
  return [pk(leg), eid(leg), statFamilyKey(leg), String(leg.aiRangeSlot || ""), String(toNum(leg.line) ?? "")].join("|")
}

/** Full slip identity: player + stat + line (stricter than slipVariationSignature). */
function slipCombinationKey(legs) {
  return (Array.isArray(legs) ? legs : [])
    .map((L) => `${pk(L)}|${statFamilyKey(L)}|${String(toNum(L.line) ?? "")}`)
    .sort()
    .join("||")
}

function rotateForVariation(items, salt, clusterId) {
  const a = Array.isArray(items) ? items : []
  if (a.length <= 1) return [...a]
  const rot = hashStr(String(clusterId) + String(salt)) % a.length
  return [...a.slice(rot), ...a.slice(0, rot)]
}

/**
 * Widen slip candidates: resolved range legs + top ranked board rows (book-only, no resolver).
 */
function mergeRankedBoardLegs(scoredItems, opportunityBoard, peerPicks, eventMeta) {
  const out = [...(Array.isArray(scoredItems) ? scoredItems : [])]
  const seen = new Set(out.map((x) => legKey(x.leg)))
  const ranked = Array.isArray(opportunityBoard?.aiPicks?.rankedOpportunityPool)
    ? opportunityBoard.aiPicks.rankedOpportunityPool
    : []
  const maxExtra = 48
  let n = 0
  for (const row of ranked) {
    if (!row || typeof row !== "object" || n >= maxExtra) break
    const leg = { ...row, aiRangeSlot: "board" }
    if (!legPassesSlipHardQuality(leg)) continue
    const k = legKey(leg)
    if (seen.has(k)) continue
    seen.add(k)
    const sc = scorePickLeg(leg, row, peerPicks, eventMeta)
    sc.cashoutRank = sc.cashoutSpeed * 0.55 + sc.probability * 0.45
    out.push({
      leg,
      pick: row,
      slot: "board",
      scores: sc,
    })
    n += 1
  }
  return out
}

function correlationScoreForLeg(leg, peerPicks) {
  const myE = eid(leg)
  const f0 = statFamilyKey(leg)
  if (!myE) return 0.42
  let sameGame = 0
  let linkBonus = 0
  for (const p of peerPicks || []) {
    if (String(p?.eventId || "").trim() !== myE) continue
    sameGame += 1
    const f1 = statFamilyKey(p)
    if (linkedStatFamilies(f0, f1)) linkBonus += 0.12
  }
  return clamp01(0.32 + Math.min(0.28, sameGame * 0.07) + Math.min(0.35, linkBonus))
}

function ceilingScoreFromPick(leg, pick) {
  const r = pick?.aiRange
  const fl = toNum(r?.floor?.line)
  const cl = toNum(r?.ceiling?.line)
  if (Number.isFinite(fl) && Number.isFinite(cl) && cl > fl + 0.25) {
    return clamp01((cl - fl) / (Math.abs(cl) + 8))
  }
  const ln = toNum(leg.line)
  const fam = statFamilyKey(leg)
  if (fam === "threes" && Number.isFinite(ln)) return clamp01(0.55 + (4 - Math.min(ln, 4)) * 0.08)
  if ((fam === "points" || fam === "pra") && Number.isFinite(ln)) return clamp01(0.45 + Math.min(ln, 35) / 90)
  return 0.5
}

function stabilityScoreFromPick(pick, prob) {
  const rf = pick?.recentForm && typeof pick.recentForm === "object" ? pick.recentForm : null
  const trend = toNum(rf?.trend_delta) ?? 0
  return clamp01(prob * (1 - Math.min(0.4, Math.abs(trend))))
}

function scorePickLeg(leg, pick, peerPicks, eventMeta) {
  const probability = clamp01(toNum(leg.probability) ?? toNum(pick?.probability) ?? 0.5)
  const edge = toNum(leg.edge) ?? toNum(pick?.edge) ?? 0
  let correlationScore = correlationScoreForLeg(leg, peerPicks)
  if (eventMeta && eid(leg)) {
    let bump = 0
    let n = 0
    for (const p of peerPicks || []) {
      if (String(p?.eventId || "").trim() !== eid(leg)) continue
      const Lp = p
      if (!Lp || typeof Lp !== "object") continue
      bump += pairwiseStackBoost(leg, Lp, eventMeta)
      n += 1
    }
    if (n) correlationScore = clamp01(correlationScore + Math.min(0.2, bump / (n + 2)))
  }
  const stabilityScore = stabilityScoreFromPick(pick, probability)
  const ceilingScore = ceilingScoreFromPick(leg, pick)
  const evScore = probability * (1 + Math.max(-0.12, Math.min(0.35, edge)))
  const cashoutSpeed = isFastCashoutLeg(leg) ? 1 : 0.35
  return {
    probability,
    edge,
    correlationScore,
    stabilityScore,
    ceilingScore,
    evScore,
    cashoutSpeed,
  }
}

function passesWeakEdge(item) {
  const e = toNum(item.leg?.edge) ?? toNum(item.pick?.edge)
  return e == null || e >= MIN_EDGE
}

function orderCashoutFirst(legs) {
  const fast = legs.filter(isFastCashoutLeg)
  const slow = legs.filter((L) => !isFastCashoutLeg(L))
  const ordered = [...fast.slice(0, 2), ...fast.slice(2), ...slow]
  return ordered.map((L, i) => (L.slipLegOrder != null ? { ...L, slipLegOrder: i } : { ...L, slipLegOrder: i }))
}

function ensureFastLegsLead(legs) {
  const o = orderCashoutFirst(legs)
  const hasFastFront = o.slice(0, 2).some(isFastCashoutLeg)
  if (hasFastFront || !o.length) return o
  const firstFast = o.findIndex(isFastCashoutLeg)
  if (firstFast <= 0) return o
  const copy = [...o]
  const [mv] = copy.splice(firstFast, 1)
  copy.unshift(mv)
  return orderCashoutFirst(copy)
}

function combinations(arr, k) {
  const a = Array.isArray(arr) ? arr : []
  const result = []
  const n = a.length
  if (k <= 0 || k > n) return result
  function combine(start, combo) {
    if (combo.length === k) {
      result.push([...combo])
      return
    }
    for (let i = start; i < n; i++) {
      combo.push(a[i])
      combine(i + 1, combo)
      combo.pop()
    }
  }
  combine(0, [])
  return result
}

/** Phase 6 — RR: 2-leg and 3-leg only (partial wins). */
function buildRoundRobin(legs, maxCombos) {
  const bySize = {}
  let total = 0
  let capped = false
  const n = legs.length
  if (n < 2) return { bySize, totalSubSlips: 0, capped: false }

  for (const k of [2, 3]) {
    if (k > n) continue
    const combs = combinations(legs, k)
    const slice = []
    for (const c of combs) {
      if (total >= maxCombos) {
        capped = true
        break
      }
      slice.push({
        legs: c,
        legKeys: c.map(legKey),
        impliedParlayProbApprox: c.reduce((p, L) => p * clamp01(toNum(L.probability) ?? 0.52), 1),
      })
      total += 1
    }
    bySize[String(k)] = slice
    if (capped) break
  }
  return { bySize, totalSubSlips: total, capped }
}

function confidenceToLegCount(meanProb, minL, maxL) {
  const conf = clamp01(meanProb)
  return Math.max(minL, Math.min(maxL, Math.round(minL + conf * (maxL - minL))))
}

function meanProbabilityOf(items) {
  if (!items.length) return 0.5
  let s = 0
  for (const it of items) s += clamp01(toNum(it.leg?.probability) ?? toNum(it.pick?.probability) ?? 0.52)
  return s / items.length
}

function hashStr(s) {
  let h = 0
  const str = String(s || "")
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

function greedyClusterCorrelated(scoredItems, primarySortFn, targetSize, opts) {
  const {
    globalPlayerPenalty = new Map(),
    deprioritizePlayers = null,
    variationIndex = 0,
    clusterId = "",
    maxVolSum = 99,
    maxSameGame = 6,
    preferredEventId = "",
    relaxSameGameForHighEnv = true,
    cashoutCluster = false,
  } = opts

  const dep = deprioritizePlayers instanceof Set ? deprioritizePlayers : null
  const jitter = ((hashStr(clusterId) ^ variationIndex * 17) % 1000) * 1e-9
  const pref = String(preferredEventId || "").trim()
  const sorted = [...scoredItems].sort((a, b) => {
    if (cashoutCluster) {
      const fa = isFastCashoutLeg(a.leg) ? 1 : 0
      const fb = isFastCashoutLeg(b.leg) ? 1 : 0
      if (fa !== fb) return fb - fa
    }
    const pa = (globalPlayerPenalty.get(pk(a.leg)) || 0) + (dep && dep.has(pk(a.leg)) ? 5 : 0)
    const pb = (globalPlayerPenalty.get(pk(b.leg)) || 0) + (dep && dep.has(pk(b.leg)) ? 5 : 0)
    const d = primarySortFn(a, b)
    if (Math.abs(d) > 1e-12) return d
    if (Math.abs(pa - pb) > 1e-12) return pa - pb
    const prefA = pref && eid(a.leg) === pref ? 1 : 0
    const prefB = pref && eid(b.leg) === pref ? 1 : 0
    if (prefA !== prefB) return prefB - prefA
    return (hashStr(legKey(a.leg) + variationIndex) % 999) - (hashStr(legKey(b.leg) + variationIndex) % 999) + jitter
  })

  const legs = []
  for (const item of sorted) {
    if (legs.length >= targetSize) break
    if (!legPassesSlipHardQuality(item.leg)) continue
    if (!passesWeakEdge(item)) continue
    if (
      !canAddLegToSlipFull(legs, item.leg, {
        maxPerPlayer: 1,
        maxVolSum,
        maxSameGame,
        relaxSameGameForHighEnv,
      })
    )
      continue
    legs.push(item.leg)
  }
  return ensureFastLegsLead(dedupeAndValidateSlipLegs(filterSlipLegs(legs)))
}

function validateCluster(legs, profile, eventMeta) {
  const issues = []
  if (legs.length < profile.minLegs) issues.push("below_min_legs")
  const j = jointProbabilityWithCorrelation(legs, eventMeta)
  const minJoint = profile.minJoint ?? 0.04
  if (legs.length >= profile.minLegs && j.joint < minJoint) issues.push("weak_joint")
  const minPair = profile.minPairBoost ?? 0.018
  if (!profile.relaxPair && legs.length >= 2 && j.pairBoostAvg < minPair) issues.push("low_correlation")
  if (profile.requireCashoutFront && legs.length >= 2 && !legs.slice(0, 2).some(isFastCashoutLeg)) issues.push("no_fast_lead")
  return { ok: issues.length === 0, issues, joint: j }
}

function buildResolvedCandidates(picks, pool) {
  const out = []
  const seen = new Set()
  for (const pick of picks || []) {
    if (!pick || !pick.aiRange) continue
    for (const slot of ["floor", "median", "ceiling"]) {
      const leg = resolveLegFromAiRange(pick, pool, slot)
      if (!leg || !isRangeResolvedLeg(leg)) continue
      if (!legPassesSlipHardQuality(leg)) continue
      const k = legKey(leg)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ leg, pick, slot })
    }
  }
  return out
}

function uniquePlayerPoolLegs(pool, maxLegs) {
  const out = []
  const seen = new Set()
  const sorted = [...(pool || [])].sort(
    (a, b) => (toNum(b.finalWeight) ?? 0) - (toNum(a.finalWeight) ?? 0) || (toNum(b.probability) ?? 0) - (toNum(a.probability) ?? 0)
  )
  for (const L of sorted) {
    if (!legPassesSlipHardQuality(L)) continue
    const k = pk(L)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(L)
    if (out.length >= maxLegs) break
  }
  return ensureFastLegsLead(filterSlipLegs(out))
}

function registerClusterPlayers(legs, globalMap) {
  for (const L of legs || []) {
    const k = pk(L)
    if (!k) continue
    globalMap.set(k, (globalMap.get(k) || 0) + 1)
  }
}

function formatFullReport({ clusters, slipVariations, generatedAt }) {
  const lines = [
    "==== NBA DYNAMIC SLIP ENGINE ====",
    `Generated: ${generatedAt}`,
    "",
    "SAFE CLUSTER:",
    "",
  ]
  const byId = new Map((clusters || []).map((c) => [c.clusterId, c]))
  const order = ["SAFE_CLUSTER", "EV_CLUSTER", "UPSIDE_CLUSTER", "CASHOUT_CLUSTER"]
  const titles = {
    SAFE_CLUSTER: "SAFE CLUSTER",
    EV_CLUSTER: "EV CLUSTER",
    UPSIDE_CLUSTER: "UPSIDE CLUSTER",
    CASHOUT_CLUSTER: "CASHOUT CLUSTER",
  }
  for (const id of order) {
    const c = byId.get(id)
    lines.push(`${titles[id] || id}:`)
    lines.push("")
    if (!c || !(c.legs || []).length) {
      lines.push("(none)")
      lines.push("")
      continue
    }
    for (const L of c.legs) {
      const tag = isFastCashoutLeg(L) ? " [early-hit]" : ""
      lines.push(`- ${formatLeg(L)}${tag}`)
    }
    lines.push("")
    if (c.note) lines.push(`(${c.note})`, "")
    if (c.roundRobin?.bySize?.["2"]?.length) {
      lines.push(`RR 2-leg combos: ${c.roundRobin.bySize["2"].length}`)
    }
    if (c.roundRobin?.bySize?.["3"]?.length) {
      lines.push(`RR 3-leg combos: ${c.roundRobin.bySize["3"].length}`)
    }
    lines.push("")
  }

  lines.push("SLIPS GENERATED:", "")
  for (const s of slipVariations || []) {
    lines.push(`${s.label}`)
    for (const L of s.legs || []) lines.push(`  - ${formatLeg(L)}`)
    lines.push("")
  }

  lines.push("ROUND ROBIN (per primary cluster):", "")
  for (const id of order) {
    const c = byId.get(id)
    if (!c?.roundRobin?.bySize) continue
    lines.push(`${titles[id] || id}`)
    lines.push(`  2-leg: ${(c.roundRobin.bySize["2"] || []).length}  |  3-leg: ${(c.roundRobin.bySize["3"] || []).length}`)
    lines.push("")
  }
  lines.push("================================")
  return lines.join("\n")
}

function selectClusterPoolItems(profile, scoredWide) {
  const cap = profile.poolCap ?? 28
  const sw = Array.isArray(scoredWide) ? scoredWide : []
  if (profile.clusterId === "SAFE_CLUSTER") {
    const xs = sw
      .filter((x) => x?.slot === "floor" || x?.slot === "board")
      .sort(
        (a, b) =>
          b.scores.probability - a.scores.probability || b.scores.stabilityScore - a.scores.stabilityScore
      )
    return xs.slice(0, cap)
  }
  if (profile.clusterId === "EV_CLUSTER") {
    const xs = [...sw].sort(
      (a, b) => b.scores.evScore - a.scores.evScore || b.scores.edge - a.scores.edge || b.scores.probability - a.scores.probability
    )
    return xs.slice(0, cap)
  }
  if (profile.clusterId === "UPSIDE_CLUSTER") {
    const xs = [...sw].sort((a, b) => {
      const ac = a.slot === "ceiling" ? 0.08 : 0
      const bc = b.slot === "ceiling" ? 0.08 : 0
      const d = b.scores.ceilingScore + bc - (a.scores.ceilingScore + ac)
      if (Math.abs(d) > 1e-12) return d
      return b.scores.probability - a.scores.probability
    })
    return xs.slice(0, cap)
  }
  if (profile.clusterId === "CASHOUT_CLUSTER") {
    const xs = sw
      .filter((x) => isFastCashoutLeg(x.leg) || x.slot === "floor" || x.slot === "board")
      .map((x) => ({
        ...x,
        scores: {
          ...x.scores,
          cashoutRank: x.scores.cashoutSpeed * 0.55 + x.scores.probability * 0.45,
        },
      }))
      .sort((a, b) => {
        const fa = isFastCashoutLeg(a.leg) ? 1 : 0
        const fb = isFastCashoutLeg(b.leg) ? 1 : 0
        if (fa !== fb) return fb - fa
        return b.scores.cashoutRank - a.scores.cashoutRank || b.scores.probability - a.scores.probability
      })
    return xs.slice(0, Math.max(cap, 32))
  }
  return sw.slice(0, cap)
}

const CLUSTER_PROFILES = [
  {
    clusterId: "SAFE_CLUSTER",
    minLegs: 2,
    maxLegs: 5,
    minJoint: 0.07,
    minPairBoost: 0.015,
    requireCashoutFront: false,
    variationCount: 3,
    poolCap: 30,
    sortFn: (a, b) =>
      b.scores.probability - a.scores.probability || b.scores.stabilityScore - a.scores.stabilityScore,
  },
  {
    clusterId: "EV_CLUSTER",
    minLegs: 2,
    maxLegs: 6,
    minJoint: 0.055,
    minPairBoost: 0.015,
    requireCashoutFront: false,
    variationCount: 3,
    poolCap: 32,
    sortFn: (a, b) => b.scores.evScore - a.scores.evScore || b.scores.edge - a.scores.edge,
  },
  {
    clusterId: "UPSIDE_CLUSTER",
    minLegs: 2,
    maxLegs: 6,
    minJoint: 0.045,
    minPairBoost: 0.012,
    requireCashoutFront: false,
    variationCount: 3,
    poolCap: 32,
    sortFn: (a, b) => b.scores.ceilingScore - a.scores.ceilingScore || b.scores.probability - a.scores.probability,
  },
  {
    clusterId: "CASHOUT_CLUSTER",
    minLegs: 2,
    maxLegs: 8,
    minJoint: 0.035,
    minPairBoost: 0.01,
    requireCashoutFront: true,
    variationCount: 4,
    poolCap: 36,
    sortFn: (a, b) => b.scores.cashoutRank - a.scores.cashoutRank || b.scores.probability - a.scores.probability,
  },
]

/**
 * @param {{ elite?: object[], strong?: object[], opportunityBoard?: object }} input
 */
function buildNbaDynamicSlipEngine(input) {
  const generatedAt = new Date().toISOString()
  const elite = Array.isArray(input?.elite) ? input.elite : []
  const strong = Array.isArray(input?.strong) ? input.strong : []
  const opp = input?.opportunityBoard && typeof input.opportunityBoard === "object" ? input.opportunityBoard : {}
  const pool = collectFullPool(opp)
  const eventMeta = buildEventMetaMap(pool)
  const maxCombos = Math.max(30, Math.min(400, Number(process.env.NBA_RR_MAX_COMBOS) || 200))

  const peerPicks = [...elite, ...strong]
  const preferredEventId = dominantEventIdFromPicks(peerPicks)
  const resolved = buildResolvedCandidates(peerPicks, pool)
  const scored = resolved.map((item) => {
    const scores = scorePickLeg(item.leg, item.pick, peerPicks, eventMeta)
    scores.cashoutRank = scores.cashoutSpeed * 0.55 + scores.probability * 0.45
    return { ...item, scores }
  })
  const scoredWide = mergeRankedBoardLegs(scored, opp, peerPicks, eventMeta)

  const globalPlayerPenalty = new Map()
  const clusters = []
  const slipVariations = []
  let slipCounter = 0

  const scoredByLegKey = new Map(scoredWide.map((x) => [legKey(x.leg), x]))
  const maxPoolFallback = 10
  const globalSlipComboKeys = new Set()
  const globalPrimaryComboKeys = new Set()

  for (const profile of CLUSTER_PROFILES) {
    const basePoolRaw = selectClusterPoolItems(profile, scoredWide)
    const basePool = basePoolRaw.length ? basePoolRaw : scoredWide.slice(0, profile.poolCap ?? 28)
    const meanP = meanProbabilityOf(basePool.length ? basePool : scoredWide)
    const baseTarget = confidenceToLegCount(meanP, profile.minLegs, profile.maxLegs)

    const tryBuild = (poolSlice, size, vIdx, vol, sameG, depPlayers) =>
      greedyClusterCorrelated(poolSlice, profile.sortFn, size, {
        globalPlayerPenalty,
        variationIndex: vIdx,
        clusterId: profile.clusterId,
        maxVolSum: vol,
        maxSameGame: sameG,
        preferredEventId,
        relaxSameGameForHighEnv: true,
        deprioritizePlayers: depPlayers,
        cashoutCluster: profile.clusterId.includes("CASHOUT"),
      })

    const variations = []
    const clusterVariationKeys = new Set()
    const priorPlayersThisCluster = new Set()

    for (let v = 0; v < profile.variationCount; v++) {
      let targetSize = Math.min(profile.maxLegs, Math.max(profile.minLegs, baseTarget + (v % 2)))
      const relaxPairProfile = { ...profile, relaxPair: true, minJoint: profile.minJoint * 0.75 }

      let legs = []
      let val = { ok: false, joint: { joint: 0 } }
      let attempt = 0
      for (; attempt < 22; attempt++) {
        const vIdx = v + attempt * 19
        const bump = Math.min(profile.maxLegs, targetSize + (attempt > 4 ? 2 : 0))
        const vol = profile.clusterId.includes("CASHOUT") ? 99 : attempt > 2 ? 99 : 96
        const sameG = profile.clusterId.includes("CASHOUT") ? 8 : attempt > 3 ? 8 : 6
        const rotated = rotateForVariation(basePool, v * 53 + attempt * 11, profile.clusterId)
        legs = tryBuild(rotated, bump, vIdx, vol, sameG, new Set(priorPlayersThisCluster))
        legs = dedupeAndValidateSlipLegs(legs.filter(legPassesSlipHardQuality))
        if (slipConstructionErrors(legs).length) {
          legs = dedupeAndValidateSlipLegs(legs.filter(legPassesSlipHardQuality))
        }

        val = validateCluster(legs, profile, eventMeta)
        if (!val.ok && legs.length < profile.maxLegs) {
          const rot2 = rotateForVariation(basePool, vIdx + 11 + attempt, profile.clusterId)
          legs = tryBuild(rot2, Math.min(profile.maxLegs, bump + 2), vIdx + 11, 99, 8, new Set(priorPlayersThisCluster))
          legs = dedupeAndValidateSlipLegs(legs.filter(legPassesSlipHardQuality))
          val = validateCluster(
            legs,
            { ...profile, minPairBoost: 0.008, minJoint: profile.minJoint * 0.85, relaxPair: false },
            eventMeta
          )
        }
        if (!val.ok) {
          val = validateCluster(legs, relaxPairProfile, eventMeta)
        }

        if (!legs.length && pool.length) {
          legs = uniquePlayerPoolLegs(pool, Math.min(maxPoolFallback, profile.maxLegs))
          val = validateCluster(legs, { ...profile, minLegs: 1, minPairBoost: 0, requireCashoutFront: false }, eventMeta)
        }

        const comb = slipCombinationKey(legs)
        const dupLocal = (legs || []).length >= profile.minLegs && clusterVariationKeys.has(comb)
        const dupGlobal = (legs || []).length >= profile.minLegs && globalSlipComboKeys.has(comb)
        const structOk = !dupLocal && !dupGlobal
        const hardOk = !slipConstructionErrors(legs).length
        if (hardOk && structOk) {
          if ((legs || []).length >= profile.minLegs) {
            clusterVariationKeys.add(comb)
            globalSlipComboKeys.add(comb)
          }
          break
        }
      }

      for (const L of legs || []) {
        const k = pk(L)
        if (k) priorPlayersThisCluster.add(k)
      }

      variations.push({
        variationIndex: v,
        legs,
        validation: val,
        targetLegs: targetSize,
      })

      slipCounter += 1
      slipVariations.push({
        label: `Slip ${slipCounter} (${profile.clusterId} #${v + 1})`,
        clusterId: profile.clusterId,
        variationIndex: v,
        legs,
        jointMetrics: val.joint,
        ok: val.ok,
        slipHardIssues: slipConstructionErrors(legs),
      })
    }

    const viableSorted = variations
      .filter((x) => (x.legs || []).length >= profile.minLegs)
      .sort((a, b) => {
        const ja = a.validation?.joint?.joint ?? 0
        const jb = b.validation?.joint?.joint ?? 0
        if (Math.abs(jb - ja) > 1e-9) return jb - ja
        return (b.legs || []).length - (a.legs || []).length
      })
    const best =
      viableSorted.find((x) => !globalPrimaryComboKeys.has(slipCombinationKey(x.legs))) ||
      viableSorted[0] ||
      variations[0]

    if (best?.legs?.length) globalPrimaryComboKeys.add(slipCombinationKey(best.legs))

    let primaryLegs = best?.legs?.length ? [...best.legs] : [...(variations[0]?.legs || [])]
    if (!primaryLegs.length && pool.length) {
      primaryLegs = uniquePlayerPoolLegs(pool, Math.min(maxPoolFallback, profile.maxLegs))
    }
    primaryLegs = dedupeAndValidateSlipLegs(primaryLegs.filter(legPassesSlipHardQuality))
    for (let pr = 0; pr < 8 && slipConstructionErrors(primaryLegs).length; pr++) {
      const rotP = rotateForVariation(basePool, 400 + pr * 7, profile.clusterId)
      primaryLegs = dedupeAndValidateSlipLegs(
        tryBuild(rotP, profile.maxLegs, 400 + pr * 7, 99, 8, new Set()).filter(legPassesSlipHardQuality)
      )
    }
    registerClusterPlayers(primaryLegs, globalPlayerPenalty)

    const roundRobin = buildRoundRobin(primaryLegs, maxCombos)
    const legsScored = primaryLegs.map((L) => {
      const hit = scoredByLegKey.get(legKey(L))
      return { leg: L, scores: hit?.scores ?? scorePickLeg(L, hit?.pick || {}, peerPicks, eventMeta) }
    })

    const joint = jointProbabilityWithCorrelation(primaryLegs, eventMeta)
    clusters.push({
      clusterId: profile.clusterId,
      label: profile.clusterId.replace(/_/g, " "),
      legs: primaryLegs,
      legsScored,
      variations,
      note: best?.validation?.ok ? "validated_primary" : `rebuild:${(best?.validation?.issues || []).join(",")}`,
      aggregateScores: {
        jointProbabilityApprox: joint.joint,
        jointRawProduct: joint.rawProduct,
        pairBoostAvg: joint.pairBoostAvg,
        edgeSum: primaryLegs.reduce((s, L) => s + (toNum(L.edge) ?? 0), 0),
        legs: primaryLegs.length,
      },
      roundRobin,
    })
  }

  const slips = clusters.map((c) => ({
    type: c.clusterId,
    legs: c.legs,
    legsScored: c.legsScored,
    note: c.note,
    roundRobin: c.roundRobin,
    aggregateScores: c.aggregateScores,
    variations: c.variations,
  }))

  const formattedText = formatFullReport({ clusters, slipVariations, generatedAt })

  return {
    engine: "nba-dynamic-v2",
    generatedAt,
    clusters,
    slipVariations,
    slips,
    safe: slips[0],
    balanced: slips[1],
    aggressive: slips[2],
    lotto: slips[3],
    formattedText,
    meta: {
      minEdge: MIN_EDGE,
      maxLegsPerPlayerPerSlip: 1,
      rrLegSizes: [2, 3],
    },
  }
}

module.exports = {
  buildNbaDynamicSlipEngine,
  scorePickLeg,
  isFastCashoutLeg,
  orderCashoutFirst,
  buildRoundRobin,
  pairwiseStackBoost,
  jointProbabilityWithCorrelation,
  buildEventMetaMap,
}
