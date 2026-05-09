"use strict"

/**
 * NBA Correlation Engine — NBA-2.C
 *
 * Restores intelligent correlation awareness to the canonical workstation
 * slip path (buildSlipAi.js). Logic extracted from the dead orphan
 * buildNbaDynamicSlipEngine.js — that file was the SOLE home of this
 * intelligence in the entire repo.
 *
 * Contract:
 *   All functions are PURE — no side effects, no state, no active-runtime
 *   imports. Safe to require() in any context.
 *
 *   This module is NBA-specific. buildSlipAi gates every call behind a
 *   sport === "nba" check. MLB candidates are NEVER passed here.
 *
 *   Correlation boost is a TIE-BREAKER only:
 *     nbaCorrelationSortBonus() caps at 0.04 on sort rank.
 *     Existing diversification hard limits (maxPerGame, maxPerStat,
 *     maxPerPlayer, canAddLeg) are NOT relaxed by this module.
 *     Same-game spam cannot result from correlation scoring alone.
 *
 * Previous orphan points (buildNbaDynamicSlipEngine.js):
 *   - pairwiseStackBoost          ← absorbed here
 *   - buildEventMetaMap           ← absorbed here
 *   - jointProbabilityWithCorrelation ← absorbed here
 *   - isFastCashoutLeg            ← absorbed here
 *   - ensureFastLegsLead / orderCashoutFirst ← absorbed as orderLegsWithCashoutFirst
 *   - correlationScoreForLeg      ← adapted as nbaCorrelationSortBonus (capped 0.04)
 *   - linkedStatFamilies          ← absorbed here
 *
 * NBA-3 inheritance notes:
 *   When alt lines flow through the workstation gate, eventMetaMap will gain
 *   richer pace/total data from those rows. No changes needed here — the map
 *   builder already reads any candidate field that supplies pace/total/usage.
 *
 * NBA-2.G / future:
 *   This is the lightweight workstation adapter. The full DynamicSlipEngine
 *   cluster logic (SAFE_CLUSTER, EV_CLUSTER, UPSIDE_CLUSTER, CASHOUT_CLUSTER,
 *   RR generation, greedyClusterCorrelated) is NOT ported here — it requires
 *   the nightly aiRange-resolved pick format, not the workstation candidate
 *   format. That absorption is still Phase 2.G scope.
 */

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0.5
  return Math.max(0, Math.min(1, x))
}

function r4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function eid(c) {
  return String(c?.eventId || "").trim()
}

function normTeam(t) {
  return String(t || "").trim().toLowerCase().replace(/\./g, "")
}

/**
 * Canonical stat family key for correlation matching.
 * Works on the normalized statFamily field from buildSlipAi.normalizeCandidate.
 * Handles multiple surface forms (propType, propFamilyKey, marketKey).
 */
function sfKey(leg) {
  const f = String(leg.statFamily || leg.propType || "").toLowerCase().replace(/[\s_]+/g, "")
  if (f === "pra" || (f.includes("points") && f.includes("rebounds") && f.includes("assists"))) return "pra"
  if (f.includes("firstbasket")) return "first_basket"
  if (f.includes("three") || f.includes("3pt") || f === "threes") return "threes"
  if ((f.includes("points") || f === "pts") && !f.includes("rebounds") && !f.includes("assists")) return "points"
  if ((f.includes("rebounds") || f === "reb") && !f.includes("points") && !f.includes("assists")) return "rebounds"
  if ((f.includes("assists") || f === "ast") && !f.includes("points") && !f.includes("rebounds")) return "assists"
  return f
}

/**
 * Whether two stat families commonly co-move within the same game environment.
 * Used by pairwiseStackBoost to gate the boost conditional on a real link.
 *
 * Preserved exactly from buildNbaDynamicSlipEngine.js:linkedStatFamilies.
 */
function linkedStatFamilies(fa, fb) {
  const pair = new Set([fa, fb])
  if (pair.has("points") && pair.has("assists")) return true
  if (pair.has("points") && pair.has("threes")) return true
  if (pair.has("points") && pair.has("pra")) return true
  if (pair.has("threes") && pair.has("pra")) return true
  if (pair.has("points") && pair.has("rebounds")) return true
  return false
}

/**
 * Build a lightweight per-game metadata map from the active candidate pool.
 * Fields: pace (highest seen), total (game projected total), maxUsage.
 * All fields are optional — gracefully degrade when absent from candidates.
 *
 * Preserved from buildNbaDynamicSlipEngine.js:buildEventMetaMap.
 */
function buildEventMetaMap(candidates) {
  const m = new Map()
  for (const r of Array.isArray(candidates) ? candidates : []) {
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

/**
 * Compute a small correlation boost for a leg pair.
 *
 * Conditions for boost:
 *   - Different players (same-player stacks are trivially correlated, not interesting)
 *   - Same game (eventId match required — boost is zero for cross-game pairs)
 *   - Stat family link or game-environment condition
 *
 * Boost sources (additive, capped at 0.38 total):
 *   +0.14  same-team points+assists (drive-and-kick archetype)
 *   +0.10  points+threes (volume scorer — same player hits both surfaces)
 *   +0.09  PRA in a high-usage, high-total game (workload environment)
 *   +0.07  pace-elevated game for scoring/threes pair
 *   +0.05  any other linked stat family pair
 *
 * Cap is preserved from buildNbaDynamicSlipEngine.js. buildSlipAi applies
 * an additional cap of 0.04 on the per-leg sort bonus (see nbaCorrelationSortBonus).
 */
function pairwiseStackBoost(legA, legB, eventMeta) {
  if (!legA || !legB) return 0
  const pa = String(legA.player || "").toLowerCase()
  const pb = String(legB.player || "").toLowerCase()
  if (pa && pa === pb) return 0  // same player — skip
  const ea = eid(legA)
  const eb = eid(legB)
  if (!ea || ea !== eb) return 0  // must be same game
  const meta = eventMeta instanceof Map ? eventMeta.get(ea) : null
  const fa = sfKey(legA)
  const fb = sfKey(legB)
  const ta = normTeam(legA.team)
  const tb = normTeam(legB.team)
  const sameTeam = ta && tb && ta === tb
  let boost = 0
  if (sameTeam && fa === "points" && fb === "assists") boost += 0.14
  if (sameTeam && fa === "assists" && fb === "points") boost += 0.14
  if (fa === "points" && fb === "threes") boost += 0.10
  if (fa === "threes" && fb === "points") boost += 0.10
  const paceHi = meta && Number.isFinite(meta.pace) && meta.pace >= 102
  if (paceHi && (fa === "points" || fa === "threes") && (fb === "points" || fb === "threes")) boost += 0.07
  const usageHi = meta && Number.isFinite(meta.maxUsage) && meta.maxUsage >= 27
  const totHi = meta && Number.isFinite(meta.total) && meta.total >= 228
  if (usageHi && totHi && (fa === "pra" || fb === "pra")) boost += 0.09
  if (linkedStatFamilies(fa, fb)) boost += 0.05
  return Math.min(0.38, boost)
}

/**
 * Compute joint probability for a set of slip legs, adjusted upward when
 * legs are positively correlated (correlated legs co-move — naive probability
 * product understates the real joint probability of the outcome cluster).
 *
 * Returns: { joint, pairBoostAvg, rawProduct }
 *   joint:        adjusted joint probability (what to use for EV reporting)
 *   pairBoostAvg: average pairwise boost across all leg pairs (0 = no correlation)
 *   rawProduct:   naive independent product (for comparison / logging)
 *
 * The adjustment factor 0.22 is preserved from the original calibration.
 * Uses modelProb (normalized field) instead of probability (DynamicSlipEngine field).
 */
function jointProbabilityWithCorrelation(legs, eventMeta) {
  let p = 1
  for (const L of legs) p *= clamp01(toNum(L.modelProb) ?? toNum(L.probability) ?? 0.52)
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
  return { joint: clamp01(p * (1 + 0.22 * avg)), pairBoostAvg: r4(avg), rawProduct: clamp01(p) }
}

/**
 * Whether a leg is likely to resolve early in the game.
 * First basket, threes, and low-line points resolve before halftime
 * with high probability — placing them first in a slip's leg list
 * gives the bettor the earliest possible read on the ticket.
 *
 * Adapted from buildNbaDynamicSlipEngine.js:isFastCashoutLeg.
 * Uses statFamily (workstation normalized field) instead of marketKey/propBlob.
 */
function isFastCashoutLeg(leg) {
  if (!leg || typeof leg !== "object") return false
  const fam = String(leg.statFamily || leg.propType || "").toLowerCase().replace(/[\s_]+/g, "")
  if (fam.includes("firstbasket")) return true
  if (fam.includes("three") || fam.includes("3pt") || fam === "threes") return true
  if ((fam === "points" || fam === "pts") && Number.isFinite(toNum(leg.line)) && toNum(leg.line) <= 21.5) return true
  return false
}

/**
 * Reorder a slip's leg array so fast-cashout legs lead.
 * PURE cosmetic + semantic — does not change which legs are in the slip.
 * Gives the bettor the earliest-resolving prop at position 0, improving
 * the emotional read sequence of the ticket.
 *
 * Merged from buildNbaDynamicSlipEngine.js:orderCashoutFirst + ensureFastLegsLead.
 */
function orderLegsWithCashoutFirst(legs) {
  if (!Array.isArray(legs) || legs.length <= 1) return legs
  const fast = legs.filter(isFastCashoutLeg)
  const slow = legs.filter((L) => !isFastCashoutLeg(L))
  return [...fast, ...slow]
}

/**
 * Compute a small sort-rank bonus for a candidate leg based on how many
 * same-game peers in the eligible pool have meaningful pairwise links.
 *
 * This is the tie-breaking mechanism for intelligent offensive coexistence:
 * a points leg and an assists leg from the same game (and ideally same team)
 * will both receive a small upward nudge, increasing the chance they appear
 * as companions in the assembled slip — WITHOUT breaking the hard
 * diversification limits that still control which pairs actually make it in.
 *
 * Cap: 0.04 on sort rank. Chosen so the bonus cannot override a genuine
 * composite-score advantage of more than ~0.04 — it is a tiebreaker only.
 *
 * The 0.12 scaling factor converts raw pairwiseStackBoost values (max 0.38
 * per peer) into a sub-composite nudge. At most 1–2 strong peers contribute
 * meaningfully before the cap clips them.
 */
function nbaCorrelationSortBonus(leg, peerLegs, eventMeta) {
  const myId = eid(leg)
  if (!myId) return 0
  let boost = 0
  for (const peer of peerLegs || []) {
    if (!peer || (peer.id != null && peer.id === leg.id)) continue
    if (eid(peer) !== myId) continue  // only same-game peers contribute
    boost += pairwiseStackBoost(leg, peer, eventMeta)
  }
  // Scale down and cap: raw boost of 0.38 * 0.12 = 0.046, clipped to 0.04
  return Math.min(0.04, boost * 0.12)
}

module.exports = {
  linkedStatFamilies,
  buildEventMetaMap,
  pairwiseStackBoost,
  jointProbabilityWithCorrelation,
  isFastCashoutLeg,
  orderLegsWithCashoutFirst,
  nbaCorrelationSortBonus,
}
