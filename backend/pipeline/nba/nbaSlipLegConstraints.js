"use strict"

/**
 * Slip-only ladder normalization + hard add rules (no ingest/scoring changes).
 * Used by buildNbaDynamicSlipEngine and buildNbaAiSlips.
 */

const { statFamilyKey, overRungFromLine } = require("./nbaAiOutcomeRange")

function propBlob(c) {
  return `${String(c?.propType || "")} ${String(c?.marketKey || "")} ${String(c?.ladder || "")}`.toLowerCase()
}

/** Same caps as buildNbaAiSlips — kept here to avoid circular deps. */
function slipLegPassesReality(L) {
  if (!L || typeof L !== "object") return false
  const t = propBlob(L)
  const ln = toNum(L.line)
  const rLine = overRungFromLine(ln)
  const lad = String(L.ladder || "").trim()
  const m = /^(\d+)/.exec(lad)
  const rung = m ? Number(m[1]) : rLine
  if (/rebound/i.test(t)) {
    if (Number.isFinite(rung) && rung > 17) return false
    if (Number.isFinite(ln) && ln > 16.5) return false
  }
  if (/assist/i.test(t) && !/point|rebound|pra/i.test(t)) {
    if (Number.isFinite(rung) && rung > 15) return false
  }
  if (/three|3pt/i.test(t)) {
    if (Number.isFinite(rung) && rung > 6) return false
  }
  if (/point/i.test(t) && !/rebound|assist|pra/i.test(t)) {
    if (Number.isFinite(rung) && rung > 45) return false
  }
  return true
}

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

/** Odds API / normalized rows: prefer numeric line (or point on raw outcome). */
function effectiveLine(leg) {
  if (!leg || typeof leg !== "object") return null
  return toNum(leg.line) ?? toNum(leg.point)
}

function isBookSourcedLeg(leg) {
  if (!leg || typeof leg !== "object") return false
  if (leg.aiRangeSyntheticLeg === true) return false
  const mk = String(leg.marketKey || "").toLowerCase()
  if (mk.includes("synthetic")) return false
  return true
}

function isAlternateMarket(leg) {
  const mk = String(leg?.marketKey || "").toLowerCase()
  const pv = String(leg?.propVariant || "").toLowerCase()
  return mk.includes("alternate") || mk.includes("_alt") || pv.includes("alt")
}

function isThreesSpam(leg) {
  if (statFamilyKey(leg) !== "threes") return false
  const ln = effectiveLine(leg)
  if (!Number.isFinite(ln) || ln < 1) return true
  if (!isAlternateMarket(leg) && ln < 1.5) return true
  return false
}

/** Reject tiny integer-only milestone displays when no half-line from book. */
function hasFakeStyleLadder(leg) {
  const ln = effectiveLine(leg)
  if (Number.isFinite(ln)) return false
  const lad = String(leg?.ladder || "").trim()
  if (!lad) return true
  if (/^([1-9])\s*\+$/.test(lad) && !Number.isFinite(ln)) return true
  return false
}

/**
 * Real sportsbook lines only: finite line/point, stat mins, no synthetic, no spam threes.
 */
function ladderMeetsMinimums(leg) {
  const fam = statFamilyKey(leg)
  const ln = effectiveLine(leg)

  if (fam === "first_basket" || fam === "double_double" || fam === "triple_double") {
    return !hasFakeStyleLadder(leg)
  }

  if (!Number.isFinite(ln)) return false
  if (hasFakeStyleLadder(leg)) return false

  if (fam === "points" || fam === "pra" || fam === "combo" || fam === "alt_combo") {
    return ln >= 10
  }
  if (fam === "rebounds") return ln >= 4
  if (fam === "assists") return ln >= 3
  if (fam === "threes") {
    if (isThreesSpam(leg)) return false
    return ln >= 1
  }
  return ln >= 0.5
}

function legPassesSlipHardQuality(leg) {
  return isBookSourcedLeg(leg) && ladderMeetsMinimums(leg) && slipLegPassesReality(leg)
}

function statSideKey(L) {
  return `${pk(L)}|${eid(L)}|${statFamilyKey(L)}`
}

/** Duplicate = same player + stat family + same numeric line. */
function duplicatePlayerStatLineKey(L) {
  const ln = effectiveLine(L)
  return `${pk(L)}|${eid(L)}|${statFamilyKey(L)}|${Number.isFinite(ln) ? String(ln) : ""}`
}

function sideBucket(L) {
  const s = String(L?.side || "").trim().toLowerCase()
  if (s.includes("under")) return "under"
  if (s.includes("over")) return "over"
  if (s === "yes" || s === "no") return s
  return "over"
}

/**
 * max 1 prop per player; no duplicate (player+stat+line); no Over/Under conflict same stat.
 */
function canAppendLegToSlip(legs, cand, opts = {}) {
  const maxPerPlayer = opts.maxPerPlayer != null ? opts.maxPerPlayer : 1
  const pc = pk(cand)
  if (!pc) return false
  if (!legPassesSlipHardQuality(cand)) return false
  if (legs.filter((L) => pk(L) === pc).length >= maxPerPlayer) return false

  const dk = duplicatePlayerStatLineKey(cand)
  if (legs.some((L) => duplicatePlayerStatLineKey(L) === dk)) return false

  const sk = statSideKey(cand)
  const cb = sideBucket(cand)
  for (const L of legs) {
    if (statSideKey(L) !== sk) continue
    const lb = sideBucket(L)
    if (lb === "over" && cb === "under") return false
    if (lb === "under" && cb === "over") return false
  }
  return true
}

function legVolatility(c) {
  const t = `${String(c.propType || "")} ${String(c.marketKey || "")}`.toLowerCase()
  if (/three|3pt/.test(t)) return 1.15
  if (/pra|points.*rebounds.*assists/.test(t)) return 1.05
  if (/assist|rebound/.test(t)) return 0.9
  return 1.0
}

function maxPerGame(legs) {
  const m = new Map()
  for (const L of legs || []) {
    const id = eid(L)
    if (!id) continue
    m.set(id, (m.get(id) || 0) + 1)
  }
  let mx = 0
  for (const n of m.values()) mx = Math.max(mx, n)
  return mx
}

function isHighEnvRow(c) {
  const pace = toNum(c?.eventPace ?? c?.pace)
  const tot = toNum(c?.gameTotal ?? c?.eventTotal ?? c?.total)
  return Number.isFinite(pace) && pace >= 102 && Number.isFinite(tot) && tot >= 228
}

function effectiveMaxSameGameS(legs, cand, baseMax) {
  const id = eid(cand)
  if (!id) return baseMax
  const same = legs.filter((L) => eid(L) === id)
  if (!same.length) return baseMax
  const envOk = isHighEnvRow(cand) && same.every((L) => isHighEnvRow(L))
  if (envOk) return Math.max(baseMax, 2)
  return baseMax
}

/** Spatial caps (same-game / vol) applied only after hard leg rules pass. */
function canAddLegSpatial(legs, cand, opts = {}) {
  const baseMax = opts.maxSameGame ?? 6
  const maxSameGame =
    opts.relaxSameGameForHighEnv === true ? effectiveMaxSameGameS(legs, cand, baseMax) : baseMax
  const maxVolSum = opts.maxVolSum ?? 99
  const next = [...legs, cand]
  if (maxPerGame(next) > maxSameGame) return false
  const vsum = next.reduce((s, L) => s + legVolatility(L), 0)
  if (vsum > maxVolSum) return false
  return true
}

function canAddLegToSlipFull(legs, cand, opts = {}) {
  if (!canAppendLegToSlip(legs, cand, opts)) return false
  return canAddLegSpatial(legs, cand, {
    maxSameGame: opts.maxSameGame,
    maxVolSum: opts.maxVolSum,
    relaxSameGameForHighEnv: opts.relaxSameGameForHighEnv,
  })
}

function slipConstructionErrors(legs) {
  const errs = []
  const seenP = new Set()
  const seenDup = new Set()
  const sideMap = new Map()
  for (const L of legs || []) {
    if (!legPassesSlipHardQuality(L)) errs.push("bad_ladder_or_synthetic")
    const p = pk(L)
    if (seenP.has(p)) errs.push("dup_player")
    seenP.add(p)
    const dk = duplicatePlayerStatLineKey(L)
    if (seenDup.has(dk)) errs.push("dup_stat_line")
    seenDup.add(dk)
    const sk = statSideKey(L)
    const b = sideBucket(L)
    const prev = sideMap.get(sk)
    if (prev && prev !== b && ((prev === "over" && b === "under") || (prev === "under" && b === "over"))) {
      errs.push("side_conflict")
    }
    if (!sideMap.has(sk)) sideMap.set(sk, b)
  }
  return errs
}

/** Greedy repair: drop invalid / conflicting legs, keep order. */
function dedupeAndValidateSlipLegs(legs) {
  const out = []
  for (const L of legs || []) {
    if (!canAddLegToSlipFull(out, L, { maxPerPlayer: 1, maxSameGame: 8, maxVolSum: 99 })) continue
    out.push(L)
  }
  return out
}

function slipVariationSignature(legs) {
  return (legs || [])
    .map((L) => `${pk(L)}:${statFamilyKey(L)}`)
    .sort()
    .join("|")
}

function dominantEventIdFromPicks(picks) {
  const m = new Map()
  for (const p of picks || []) {
    const id = String(p?.eventId || "").trim()
    if (!id) continue
    m.set(id, (m.get(id) || 0) + 1)
  }
  let best = ""
  let n = 0
  for (const [k, v] of m.entries()) {
    if (v > n) {
      n = v
      best = k
    }
  }
  return best
}

module.exports = {
  effectiveLine,
  isBookSourcedLeg,
  legPassesSlipHardQuality,
  slipLegPassesReality,
  canAppendLegToSlip,
  canAddLegSpatial,
  canAddLegToSlipFull,
  slipConstructionErrors,
  dedupeAndValidateSlipLegs,
  slipVariationSignature,
  dominantEventIdFromPicks,
  duplicatePlayerStatLineKey,
  statSideKey,
  pk,
  eid,
}
