"use strict"

const { dedupeCandidates, sortByProbDesc } = require("./nbaOpportunityCandidates")
const {
  computeOutcomeRange,
  resolveLegFromAiRange,
  resolveLottoLegAboveCeiling,
  overRungFromLine,
  isSpecialStatFamily,
} = require("./nbaAiOutcomeRange")
const { playerEventFamilyKey, statFamilyKey, statScoreRow } = require("./nbaAiStatFamilyRank")
const { filterPoolByDominanceGap } = require("./nbaAiDominanceGap")
const { splitRankedPoolByLane, inferPropLaneKey, COMBO_LANES, CORE_LANES } = require("./nbaPropLanes")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function playerKey(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

/** Lane-aware statScore tilt for ordering only. Canonical wins when set; otherwise inferred lane. */
function laneStatScoreMultiplier(c) {
  const canon = String(c.canonicalPropType || "").trim().toLowerCase()
  if (CORE_LANES.has(canon)) return 1.12
  if (COMBO_LANES.has(canon)) return 0.92
  if (canon) return 1
  const lane = inferPropLaneKey(c)
  if (CORE_LANES.has(lane)) return 1.12
  if (COMBO_LANES.has(lane)) return 0.92
  return 1
}

/** Base statScore before lane mult: persisted `statScore` when numeric, else statScoreRow (same family as board ranking). */
function baseStatScoreForLaneRank(c) {
  const raw = toNum(c.statScore)
  if (Number.isFinite(raw)) return raw
  return statScoreRow(c, "NEUTRAL")
}

const CORE_PRIORITY_LANES = new Set(["points", "threes", "assists"])
const SCORING_PRIMARY_LANES = new Set(["points", "threes", "assists", "pra", "points_rebounds", "points_assists"])
const REBOUND_PRIMARY_LANES = new Set(["rebounds", "rebounds_assists"])

function normalizeDedupeLine(line) {
  const n = toNum(line)
  if (Number.isFinite(n)) return String(Math.round(n * 1000) / 1000)
  return String(line ?? "")
    .trim()
    .toLowerCase()
}

/** Dedupe player + propType + line; keep highest compositeRankScore. */
function dedupeByPlayerPropTypeLine(rows) {
  const best = new Map()
  for (const c of Array.isArray(rows) ? rows : []) {
    if (!c || typeof c !== "object") continue
    const prop = String(c.propType || c.marketKey || "").trim().toLowerCase()
    const k = `${playerKey(c)}|${prop}|${normalizeDedupeLine(c.line)}`
    const cr = compositeRankScore(c)
    const prev = best.get(k)
    if (!prev || cr > prev.score) best.set(k, { row: c, score: cr })
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row)
}

function projectionProxyForPrimary(c) {
  const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  const b = toNum(rf?.baseline) ?? toNum(rf?.last10_avg) ?? toNum(rf?.last5_avg)
  if (Number.isFinite(b)) return b
  const ln = toNum(c.line)
  const pr = toNum(c.probability)
  if (Number.isFinite(ln) && Number.isFinite(pr)) return ln * Math.max(0.08, Math.min(0.95, pr)) * 2.5
  return (toNum(c.finalWeight) ?? 0) * 1.15 + (toNum(c.usageRate) ?? 0) * 0.02
}

function playerEventKey(c) {
  return `${playerKey(c)}|${String(c.eventId || "").trim()}`
}

/**
 * Per (player, event), primary lane = core/combo lane with highest projection proxy.
 * Scoring-usage heuristic: if primary would be rebounds but usage ≥ ~22 and points proxy is close, force points.
 */
function buildPrimaryLaneByPlayerEvent(rows) {
  const laneMax = new Map()
  const byPe = new Map()
  for (const c of Array.isArray(rows) ? rows : []) {
    const pe = playerEventKey(c)
    if (!byPe.has(pe)) byPe.set(pe, [])
    byPe.get(pe).push(c)
    const lane = inferPropLaneKey(c)
    if (!lane || (!CORE_LANES.has(lane) && !COMBO_LANES.has(lane))) continue
    const px = projectionProxyForPrimary(c)
    if (!laneMax.has(pe)) laneMax.set(pe, new Map())
    const m = laneMax.get(pe)
    const prev = m.get(lane) ?? -Infinity
    if (px > prev) m.set(lane, px)
  }
  const primary = new Map()
  for (const [pe, m] of laneMax) {
    let bestLane = null
    let bestPx = -Infinity
    for (const [lane, v] of m) {
      if (v > bestPx) {
        bestPx = v
        bestLane = lane
      }
    }
    if (bestLane) primary.set(pe, bestLane)
  }

  for (const [pe, prim] of [...primary.entries()]) {
    if (prim !== "rebounds" && prim !== "rebounds_assists") continue
    const m = laneMax.get(pe)
    if (!m) continue
    const ptsPx = m.get("points") ?? -1
    const praPx = m.get("pra") ?? -1
    const prPx = m.get("points_rebounds") ?? -1
    const paPx = m.get("points_assists") ?? -1
    const bestScoringPx = Math.max(ptsPx, praPx * 0.96, prPx * 0.95, paPx * 0.95)
    const rebPx = Math.max(m.get("rebounds") ?? -1, m.get("rebounds_assists") ?? -1)
    const group = byPe.get(pe) || []
    const uMax = Math.max(0, ...group.map((r) => toNum(r.usageRate) ?? 0))
    if (bestScoringPx < 0) continue
    if (uMax >= 22 && bestScoringPx >= rebPx * 0.82) {
      if (ptsPx >= praPx && ptsPx >= prPx && ptsPx >= paPx) primary.set(pe, "points")
      else if (praPx >= prPx && praPx >= paPx) primary.set(pe, "pra")
      else if (prPx >= paPx) primary.set(pe, "points_rebounds")
      else primary.set(pe, "points_assists")
    } else if (bestScoringPx >= rebPx * 0.9) {
      primary.set(pe, ptsPx >= praPx ? "points" : "pra")
    }
  }

  return primary
}

/** Non-primary vs primary rebound/scoring mismatch: −12.5% on ranking statScore (spec: 10–15%). */
function primaryMismatchStatMultiplier(c, primaryLaneByPe) {
  if (!primaryLaneByPe || !(primaryLaneByPe instanceof Map)) return 1
  const primary = primaryLaneByPe.get(playerEventKey(c))
  if (!primary) return 1
  const mine = inferPropLaneKey(c)
  if (mine === primary) return 1
  const pSc = SCORING_PRIMARY_LANES.has(primary)
  const mSc = SCORING_PRIMARY_LANES.has(mine)
  const pRb = REBOUND_PRIMARY_LANES.has(primary)
  const mRb = REBOUND_PRIMARY_LANES.has(mine)
  if (pSc && mRb) return 0.875
  if (pRb && mSc) return 0.875
  return 1
}

function laneAdjustedStatScore(c, primaryLaneByPe) {
  return (
    baseStatScoreForLaneRank(c) * laneStatScoreMultiplier(c) * primaryMismatchStatMultiplier(c, primaryLaneByPe)
  )
}

/** Primary pool sort: composite + lane-tilted statScore (core up, combo down, primary enforcement). */
function rankScoreForAiPicks(c, primaryLaneByPe) {
  return compositeRankScore(c) + laneAdjustedStatScore(c, primaryLaneByPe) * 0.32
}

function sortByRankDesc(rows, primaryLaneByPe) {
  return [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) => rankScoreForAiPicks(b, primaryLaneByPe) - rankScoreForAiPicks(a, primaryLaneByPe)
  )
}

function isPointsOrThreesCoreLane(c) {
  const canon = String(c.canonicalPropType || "").trim().toLowerCase()
  if (canon === "points" || canon === "threes") return true
  const lane = inferPropLaneKey(c)
  return lane === "points" || lane === "threes"
}

/** Canonical stat label for AI pick copy — never sportsbook "Points Ladder" / "PRA Ladder" leakage. */
function displayStatLabelForAiPick(c) {
  const canon = String(c.canonicalPropType || "").trim().toLowerCase()
  if (canon === "pra") return "PRA"
  if (canon === "points_rebounds") return "PR"
  if (canon === "points_assists") return "PA"
  if (canon === "rebounds_assists") return "RA"
  if (canon === "points") return "points"
  if (canon === "threes") return "threes"
  if (canon === "rebounds") return "rebounds"
  if (canon === "assists") return "assists"
  if (canon === "first_basket") return "first basket"
  if (canon === "first_team_basket") return "first team basket"
  if (canon === "double_double") return "double-double"
  if (canon === "triple_double") return "triple-double"

  const fam = statFamilyKey(c)
  const lane = inferPropLaneKey(c)
  if (lane === "pra" || fam === "pra") return "PRA"
  if (lane === "points_rebounds") return "PR"
  if (lane === "points_assists") return "PA"
  if (lane === "rebounds_assists") return "RA"
  if (fam === "points") return "points"
  if (fam === "combo") return "PRA"
  if (fam === "alt_combo") return "PRA"
  if (fam === "first_basket") return "first basket"
  if (fam === "double_double") return "double-double"
  if (fam === "triple_double") return "triple-double"
  if (fam === "threes") return "threes"
  if (fam === "rebounds") return "rebounds"
  if (fam === "assists") return "assists"
  let s = String(c?.propType || c?.marketKey || "prop")
    .trim()
    .replace(/\s*ladder\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
  const low = s.toLowerCase()
  if (low.includes("alt combo") || low === "combo" || /^combo\b/.test(low)) {
    if (lane === "points_rebounds") return "PR"
    if (lane === "points_assists") return "PA"
    if (lane === "rebounds_assists") return "RA"
    return "PRA"
  }
  return s ? s.toLowerCase() : "prop"
}

function collectPool(opp) {
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
  push(opp.firstBasketCandidates)
  return dedupeCandidates(chunks.filter((x) => x && typeof x === "object" && String(x.player || "").trim()))
}

function median(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

function compositeRankScore(c) {
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

/** Same floor as STRONG tier candidates — ELITE/STRONG/range ctx must not use rows below this bar. */
function passesAiPickScoredFloor(c, fwMed) {
  const fam = statFamilyKey(c)
  if (isSpecialStatFamily(fam)) {
    const e = toNum(c.edge) ?? -9
    const fw = toNum(c.finalWeight) ?? 0
    if (e < 0.005) return false
    if (fw < fwMed - 0.32) return false
    return true
  }
  const e = toNum(c.edge) ?? -9
  const fw = toNum(c.finalWeight) ?? 0
  const m = toNum(c.matchupAdj) ?? 0
  const p = toNum(c.paceAdj) ?? 0
  if (e < 0.018) return false
  if (fw < fwMed - 0.065) return false
  if (m < -0.028 && p < -0.012) return false
  return true
}

function pickBestPerPlayer(sortedList, max, excludeKeys = new Set()) {
  const seen = new Set()
  const out = []
  for (const c of sortedList) {
    if (out.length >= max) break
    const pk = playerKey(c)
    if (!pk || excludeKeys.has(pk) || seen.has(pk)) continue
    seen.add(pk)
    out.push(c)
  }
  return out
}

function rungFromResolvedLeg(L) {
  if (!L) return null
  const lad = String(L.ladder || "").trim()
  const m = /^(\d+)\+/.exec(lad)
  if (m) return Number(m[1])
  const r = overRungFromLine(L.line)
  return Number.isFinite(r) ? r : null
}

function corePickCeilingRungFromPick(c) {
  const R = c?.aiRangeResolved?.ceiling
  if (R) return rungFromResolvedLeg(R)
  const ar = c?.aiRange?.ceiling
  if (ar && Number.isFinite(toNum(ar.rung))) return toNum(ar.rung)
  return null
}

/** Drop impossible / mismatched core ladders (e.g. 18+ rebound ceilings). */
function passesCorePickLadderReality(c) {
  const lane = inferPropLaneKey(c)
  if (!CORE_LANES.has(lane)) return true
  const rc = corePickCeilingRungFromPick(c)
  if (!Number.isFinite(rc)) return lane !== "rebounds"
  if (lane === "rebounds" && rc > 17) return false
  if (lane === "assists" && rc > 15) return false
  if (lane === "threes" && rc > 6) return false
  if (lane === "points" && rc > 47) return false
  return true
}

function isLegacyBoardLadderLabel(lad) {
  const ll = String(lad || "")
    .trim()
    .toLowerCase()
  return ll === "alt-mid" || ll === "alt mid" || ll === "alt_mid" || /^alt$/i.test(ll)
}

/** Strip book-only ladder labels when we are not binding to resolveLeg output. */
function stripLegacyBoardLadder(row) {
  if (isLegacyBoardLadderLabel(row.ladder)) {
    delete row.ladder
  }
}

/**
 * Mutates row: aiRangeResolved, aiRangeLottoLeg, canonical line/ladder from resolveLegFromAiRange (median),
 * or from computed aiRange.median when the pool cannot bind the median leg (never raw PRA / alt-mid ladder).
 */
function attachAiPickRangeResolution(row, pool) {
  const ar = row.aiRange
  if (!ar || !ar.floor || !ar.median || !ar.ceiling) {
    row.aiRangeResolved = null
    row.aiRangeLottoLeg = null
    stripLegacyBoardLadder(row)
    row.propVariant = row.propVariant || "base"
    return row
  }

  const pick = { ...row, aiRange: ar }
  row.aiRangeResolved = {
    floor: resolveLegFromAiRange(pick, pool, "floor"),
    median: resolveLegFromAiRange(pick, pool, "median"),
    ceiling: resolveLegFromAiRange(pick, pool, "ceiling"),
  }
  row.aiRangeLottoLeg = resolveLottoLegAboveCeiling(pick, pool)

  const Lm = row.aiRangeResolved.median
  if (Lm) {
    row.line = Lm.line
    row.ladder = Lm.ladder
    row.propVariant = Lm.propVariant
  } else {
    row.line = ar.median.line
    row.ladder = `${ar.median.rung}+`
    row.propVariant = "base"
  }
  delete row.originalLadder
  delete row.bookLadder
  return row
}

/**
 * Single pipeline for ELITE and STRONG: computeOutcomeRange → attachAiPickRangeResolution → headlines.
 * `rankedPool` = scored opportunity rows only (same source for both tiers + range siblings).
 * @param {'elite'|'strong'} aiTier
 */
function buildEliteOrStrongPick(c, rankedPool, aiTier) {
  const ar = computeOutcomeRange(c, rankedPool)
  const row = { ...c, aiRange: ar, aiTier }
  attachAiPickRangeResolution(row, rankedPool)
  return {
    ...row,
    aiReasoning: buildReasoning(row),
    aiHeadline: formatPropHeadline(row),
    aiRange: ar,
  }
}

/** Combo / special: keep book line + O/U headline — no ladder resolution (does not call computeOutcomeRange / attach). */
function buildComboOrSpecialLanePick(c, aiTier) {
  const row = {
    ...c,
    aiTier,
    aiRange: null,
    aiRangeResolved: null,
    aiRangeLottoLeg: null,
  }
  return {
    ...row,
    aiReasoning: buildReasoning(row),
    aiHeadline: formatPropHeadline(row),
    aiRange: null,
  }
}

function passesEliteTierGate(c, dominanceEliteBlockedKeys, fwMed, fwTop) {
  const pef = `${playerKey(c)}|${String(c.eventId || "").trim()}|${statFamilyKey(c)}`
  if (dominanceEliteBlockedKeys instanceof Set && dominanceEliteBlockedKeys.has(pef)) return false
  const lane = inferPropLaneKey(c)
  if (lane === "first_team_basket") {
    const e = toNum(c.edge) ?? -9
    const fw = toNum(c.finalWeight) ?? 0
    return e >= 0.006 && fw >= fwMed - 0.3
  }
  if (COMBO_LANES.has(lane)) {
    const e = toNum(c.edge) ?? -9
    const fw = toNum(c.finalWeight) ?? 0
    return e >= 0.024 && fw >= fwMed - 0.14
  }
  const fam = statFamilyKey(c)
  if (isSpecialStatFamily(fam)) {
    const e = toNum(c.edge) ?? -9
    const fw = toNum(c.finalWeight) ?? 0
    const pr = toNum(c.probability) ?? 0
    if (fam === "triple_double") return e >= 0.008 && fw >= fwMed - 0.26 && pr >= 0.012
    if (fam === "double_double") return e >= 0.01 && fw >= fwMed - 0.24 && pr >= 0.08
    if (fam === "first_basket") return e >= 0.008 && fw >= fwMed - 0.26 && pr >= 0.048
    if (fam === "alt_combo") return e >= 0.024 && fw >= fwMed - 0.16
    return false
  }
  const e = toNum(c.edge) ?? -9
  const fw = toNum(c.finalWeight) ?? 0
  const m = toNum(c.matchupAdj) ?? 0
  const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  const trend = toNum(rf?.trend_delta)
  const hr10 = toNum(rf?.last10_hit_rate)
  const strongForm =
    (Number.isFinite(trend) && trend > 0.04) ||
    (Number.isFinite(hr10) && hr10 >= 0.52) ||
    (Number.isFinite(toNum(rf?.last5_avg)) &&
      Number.isFinite(toNum(rf?.last10_avg)) &&
      toNum(rf.last5_avg) > toNum(rf.last10_avg) + 0.03)
  const strongMatchup = m >= 0.012
  const nearTopFw = fw >= Math.min(fwTop * 0.94, fwMed + 0.18)
  return e >= 0.048 && nearTopFw && (strongForm || strongMatchup || fw >= fwTop * 0.985)
}

function takeFirstNPassing(rows, n, pred) {
  const out = []
  for (const c of rows) {
    if (out.length >= n) break
    if (pred(c)) out.push(c)
  }
  return out
}

/** Strong tiers: skip elite legs, and do not repeat the same leg across strong lanes. */
function passesCoreStatQuality(c, statThreshold) {
  const sc = statScoreRow(c, "NEUTRAL")
  if (!Number.isFinite(sc) || sc < statThreshold) return false
  const lane = inferPropLaneKey(c)
  return CORE_PRIORITY_LANES.has(lane) || lane === "rebounds"
}

function passesStrongCoreLaneStat(c, statTh) {
  return passesCoreStatQuality(c, statTh)
}

/** Elite core: max one rebound-only leg; combo players excluded upstream. */
function takeEliteCoreRespectingCaps(coreSorted, n, eliteGate, statTh, comboPlayerKeys) {
  const skip = comboPlayerKeys instanceof Set ? comboPlayerKeys : new Set()
  let reboundElite = 0
  const out = []
  for (const c of coreSorted) {
    if (out.length >= n) break
    if (skip.has(playerKey(c))) continue
    if (!eliteGate(c)) continue
    if (!passesCoreStatQuality(c, statTh)) continue
    const lane = inferPropLaneKey(c)
    if (CORE_PRIORITY_LANES.has(lane)) {
      out.push(c)
      continue
    }
    if (lane === "rebounds") {
      if (reboundElite >= 1) continue
      reboundElite++
      out.push(c)
    }
  }
  return out
}

/** Elite core: ≥2 picks when pool allows; ≥1 points or threes when pool allows. */
function enforceEliteCoreStructure(corePicks, coreCandidates, fwMed, primaryLaneByPe, comboPlayerKeys, coreStatTh) {
  const skipCombo = comboPlayerKeys instanceof Set ? comboPlayerKeys : new Set()
  const relaxed = (c) =>
    passesAiPickScoredFloor(c, fwMed) &&
    (toNum(c.edge) ?? 0) >= 0.032 &&
    !skipCombo.has(playerKey(c)) &&
    passesStrongCoreLaneStat(c, coreStatTh * 0.9)
  const sortedCore = sortByRankDesc(
    (coreCandidates || []).filter((c) => !skipCombo.has(playerKey(c))),
    primaryLaneByPe
  )
  let out = [...(corePicks || [])]
  const usedKeys = () => new Set(out.map((c) => playerEventFamilyKey(c)))

  while (out.length < 2) {
    let added = false
    for (const c of sortedCore) {
      if (out.length >= 2) break
      const k = playerEventFamilyKey(c)
      if (usedKeys().has(k)) continue
      if (!relaxed(c)) continue
      if (inferPropLaneKey(c) === "rebounds") {
        const rb = out.filter((x) => inferPropLaneKey(x) === "rebounds").length
        if (rb >= 1) continue
      }
      out.push(c)
      added = true
    }
    if (!added) break
  }

  if (!out.some(isPointsOrThreesCoreLane)) {
    const bestPT = sortedCore.find(
      (c) => isPointsOrThreesCoreLane(c) && relaxed(c) && !usedKeys().has(playerEventFamilyKey(c))
    )
    if (bestPT) {
      let ripIdx = -1
      let ripScore = 0
      out.forEach((c, i) => {
        if (isPointsOrThreesCoreLane(c)) return
        const sc = compositeRankScore(c)
        if (ripIdx < 0 || sc < ripScore) {
          ripIdx = i
          ripScore = sc
        }
      })
      if (ripIdx >= 0) {
        out = out.map((c, i) => (i === ripIdx ? bestPT : c))
      } else if (out.length < 3) {
        out = [...out, bestPT]
      }
    }
  }

  return out.slice(0, 3)
}

function takeStrongLaneSlices(coreSorted, comboSorted, specialSorted, eliteLegKeys, nCore, nCombo, nSpec, opts = {}) {
  const eliteComboPk = opts.eliteComboPlayerKeys instanceof Set ? opts.eliteComboPlayerKeys : new Set()
  const statTh = opts.coreStatTh
  const used = new Set(eliteLegKeys)

  const pull = (sorted, n) => {
    const out = []
    for (const c of sorted) {
      if (out.length >= n) break
      const k = playerEventFamilyKey(c)
      if (used.has(k)) continue
      out.push(c)
      used.add(k)
    }
    return out
  }

  const strongCombo = pull(comboSorted, nCombo)
  const strongComboPk = new Set(strongCombo.map((c) => playerKey(c)).filter(Boolean))
  const skipPk = new Set([...eliteComboPk, ...strongComboPk])

  const strongCorePool =
    statTh != null
      ? coreSorted.filter((c) => !skipPk.has(playerKey(c)) && passesStrongCoreLaneStat(c, statTh))
      : coreSorted.filter((c) => !skipPk.has(playerKey(c)))

  const pullCore = (sorted, n) => {
    const out = []
    for (const c of sorted) {
      if (out.length >= n) break
      const k = playerEventFamilyKey(c)
      if (used.has(k)) continue
      out.push(c)
      used.add(k)
    }
    return out
  }

  return {
    strongCore: pullCore(strongCorePool, nCore),
    strongCombo,
    strongSpecial: pull(specialSorted, nSpec),
  }
}

/** Final AI pick rows: dedupe player + propType + line, keep best composite. */
function dedupePicksByPlayerPropLine(picks) {
  return dedupeByPlayerPropTypeLine(Array.isArray(picks) ? picks : [])
}

/**
 * Headline text for a pick. When `aiRangeResolved` is set, only resolved `line` / `ladder` /
 * `propVariant` (via attach) and the median leg may influence display — never book ladder,
 * `originalLadder`, `marketLabel`, or alt-mid / PRA book labels.
 */
function formatPropHeadline(c) {
  const player = String(c.player || "").trim() || "Player"
  const pt = displayStatLabelForAiPick(c)
  const side = String(c.side || "").trim()
  const tier = String(c.aiTier || "").toLowerCase()
  const isTieredPick = tier === "elite" || tier === "strong"

  if (c.aiRangeResolved != null && typeof c.aiRangeResolved === "object") {
    const line = c.line != null && Number.isFinite(Number(c.line)) ? Number(c.line) : null
    const ladder = String(c.ladder || "").trim()
    const medLeg = c.aiRangeResolved.median
    const medRung = medLeg ? rungFromResolvedLeg(medLeg) : null
    const base = `${player} — ${pt}${side ? ` ${side}` : ""}`.trim()
    if (Number.isFinite(medRung)) {
      return `${player} — ${pt}${side ? ` ${side}` : ""} (${medRung}+)`.trim()
    }
    if (ladder && /^\d+\+$/.test(ladder)) {
      return `${base} ${ladder}`.trim()
    }
    if (line != null && side) return `${player} — ${pt} ${side} ${line}`.trim()
    if (line != null) return `${player} — ${pt} ${line}`.trim()
    return base
  }

  const line = c.line != null && Number.isFinite(Number(c.line)) ? Number(c.line) : null
  const ar = c.aiRange
  if (ar && ar.floor && ar.median && ar.ceiling) {
    return `${player} — ${pt}${side ? ` ${side}` : ""}`.trim()
  }
  if (isTieredPick) {
    return `${player} — ${pt}${side ? ` ${side}` : ""}`.trim()
  }
  if (line != null && side) return `${player} — ${pt} ${side} ${line}`
  if (line != null) return `${player} — ${pt} ${line}`
  return `${player} — ${pt}`
}

function edgePhrase(edge) {
  const e = toNum(edge)
  if (!Number.isFinite(e)) return "Edge vs market is thin."
  const pct = (e * 100).toFixed(1)
  if (e >= 0.06) return `Model edge is strong (~${pct} pts vs implied).`
  if (e >= 0.035) return `Model edge is solid (~${pct} pts vs implied).`
  if (e >= 0.018) return `Model shows a modest lean (~${pct} pts vs implied).`
  if (e <= -0.01) return `Model sits slightly below market (~${pct} pts vs implied).`
  return `Edge vs market is roughly neutral (~${pct} pts vs implied).`
}

function formPhrase(c) {
  const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  if (!rf) return null
  const trend = toNum(rf.trend_delta)
  const b = toNum(rf.baseline)
  const l5 = toNum(rf.last5_avg)
  const l10 = toNum(rf.last10_avg)
  if (Number.isFinite(trend)) {
    if (trend > 0.2) return `Recent form is hot: last stretch trending well above the 10-game baseline.`
    if (trend > 0.05) return `Short-sample trend is up vs the 10-game baseline — positive momentum.`
    if (trend < -0.2) return `Recent form has cooled: rolling numbers dipped vs baseline.`
    if (trend < -0.05) return `Slight downtick vs recent baseline — worth watching.`
  }
  if (Number.isFinite(l5) && Number.isFinite(l10) && Number.isFinite(b)) {
    return `Rolled averages sit near baseline (5g vs 10g vs model anchor).`
  }
  if (Number.isFinite(l5) && Number.isFinite(l10)) {
    return `Rolled 5-game vs 10-game production is in line with typical variance.`
  }
  return `Form snapshot is light — lean more on matchup and game context.`
}

function matchupPhrase(c) {
  const m = toNum(c.matchupAdj) ?? 0
  if (m > 0.018) return `Matchup context is a tailwind for this prop.`
  if (m > 0.006) return `Matchup is slightly favorable.`
  if (m < -0.022) return `Matchup is a headwind — tougher defensive / pace setup.`
  if (m < -0.008) return `Matchup leans slightly tough.`
  return `Matchup is roughly neutral after defense + environment blend.`
}

function paceBlowoutPhrase(c) {
  const p = toNum(c.paceAdj) ?? 0
  const b = toNum(c.blowoutAdj) ?? 0
  const pace = toNum(c.eventPace)
  const parts = []
  if (p > 0.012) parts.push("pace supports extra volume")
  else if (p < -0.012) parts.push("slower pace trims volume upside")
  else if (Number.isFinite(pace) && pace >= 102) parts.push("game pace looks up-tempo")
  else if (Number.isFinite(pace) && pace <= 98) parts.push("game pace looks grindy")

  if (b < -0.012) parts.push("blowout risk could cap minutes for stars on overs")
  else if (b > 0.008) parts.push("competitive script / close-game lean helps minutes")

  if (!parts.length) return `Game script (pace / competitiveness) is close to neutral for this spot.`
  return parts.slice(0, 2).join("; ") + "."
}

function buildReasoning(c) {
  const bits = []
  const fp = formPhrase(c)
  if (fp) bits.push(fp)
  bits.push(matchupPhrase(c))
  bits.push(paceBlowoutPhrase(c))
  bits.push(edgePhrase(c.edge))
  return bits.join(" ")
}

function buildFadeReasoning(c) {
  return `Fade angle — ${buildReasoning(c)}`
}

function formatPickHeadlineWithRange(c) {
  let head = formatPropHeadline(c)
  const res = c.aiRangeResolved
  const ar = c.aiRange
  let rf = null
  let rm = null
  let rc = null
  if (res?.floor && res?.median && res?.ceiling) {
    rf = rungFromResolvedLeg(res.floor)
    rm = rungFromResolvedLeg(res.median)
    rc = rungFromResolvedLeg(res.ceiling)
  }
  if (!(Number.isFinite(rf) && Number.isFinite(rm) && Number.isFinite(rc)) && ar?.floor && ar?.median && ar?.ceiling) {
    rf = toNum(ar.floor.rung)
    rm = toNum(ar.median.rung)
    rc = toNum(ar.ceiling.rung)
  }
  if (Number.isFinite(rf) && Number.isFinite(rm) && Number.isFinite(rc)) {
    head += `\n   Range:\n   ${rf} / ${rm} / ${rc}`
    const rl =
      rungFromResolvedLeg(c.aiRangeLottoLeg) ??
      (ar?.lotto && Number.isFinite(toNum(ar.lotto.rung)) ? toNum(ar.lotto.rung) : null)
    if (Number.isFinite(rl) && rl !== rc) {
      head += `\n   Lotto cap: ${rl}+`
    }
  }
  return head
}

function formatTierBlock(title, emoji, picks, reasonFn, useRange = true) {
  const rf = reasonFn || buildReasoning
  let s = `${emoji} ${title}\n`
  if (!picks.length) {
    s += "(none today)\n\n"
    return s
  }
  picks.forEach((c, i) => {
    const head = useRange ? formatPickHeadlineWithRange(c) : formatPropHeadline(c)
    s += `${i + 1}. ${head}\n`
    s += `   ${rf(c)}\n\n`
  })
  return s
}

function formatLanePickLines(picks, useRange) {
  if (!Array.isArray(picks) || !picks.length) return ""
  let s = ""
  picks.forEach((c, i) => {
    const head = useRange ? formatPickHeadlineWithRange(c) : formatPropHeadline(c)
    s += `${i + 1}. ${head}\n`
    s += `   ${buildReasoning(c)}\n\n`
  })
  return s
}

function buildLaneStructuredFormattedText(payload) {
  const {
    generatedAt,
    eliteCore,
    strongCore,
    eliteCombo,
    strongCombo,
    eliteSpecial,
    strongSpecial,
    fadesOut,
    specialSectionSubtitle,
    specialEliteUseLadderRange,
  } = payload
  const comboAny =
    (Array.isArray(eliteCombo) && eliteCombo.length) || (Array.isArray(strongCombo) && strongCombo.length)
  const specialAny =
    (Array.isArray(eliteSpecial) && eliteSpecial.length) || (Array.isArray(strongSpecial) && strongSpecial.length)

  const coreLines = [
    "==== AI PICKS ====",
    `Generated: ${generatedAt}`,
    "",
    "🔥 CORE PLAYS",
    "(ladder + ranges)",
    "",
    "Elite",
    formatLanePickLines(eliteCore, true) || "(none today)\n\n",
    "Strong",
    formatLanePickLines(strongCore, true) || "(none today)\n\n",
  ]

  if (comboAny) {
    coreLines.push(
      "🟣 COMBO PLAYS",
      "(over / under — no ladder binding on these rows)",
      "",
      "Elite",
      formatLanePickLines(eliteCombo, false) || "(none today)\n\n",
      "Strong",
      formatLanePickLines(strongCombo, false) || "(none today)\n\n"
    )
  }

  if (specialAny) {
    coreLines.push(
      "🟡 SPECIAL PLAYS",
      specialSectionSubtitle ||
        "(first basket / first team basket / double-double / triple-double)",
      "",
      "Elite",
      formatLanePickLines(eliteSpecial, !!specialEliteUseLadderRange) || "(none today)\n\n",
      "Strong",
      formatLanePickLines(strongSpecial, false) || "(none today)\n\n"
    )
  }

  coreLines.push(formatTierBlock("FADE / UNDER", "⚠️", fadesOut, buildFadeReasoning, false), "===================", "")
  return coreLines.join("\n")
}

/**
 * Tiered “AI picks” from scored opportunity pools (finalWeight, edge, form, matchup, pace, blowout).
 * @param {object} nbaOpportunityBoard — output of buildNbaOpportunityBoard
 * @returns {{ elite: object[], strong: object[], fades: object[], formattedText: string, generatedAt: string }}
 */
function buildNbaAiPicks(nbaOpportunityBoard) {
  const generatedAt = new Date().toISOString()
  let pool = collectPool(nbaOpportunityBoard).sort(sortByProbDesc)
  let dominanceEliteBlockedKeys = nbaOpportunityBoard?.dominanceGapEliteBlockedKeys
  if (!nbaOpportunityBoard?.dominanceGapPoolFiltered) {
    const gap = filterPoolByDominanceGap(pool)
    pool = gap.pool.sort(sortByProbDesc)
    dominanceEliteBlockedKeys = gap.eliteBlockedKeys
  } else if (!(dominanceEliteBlockedKeys instanceof Set)) {
    dominanceEliteBlockedKeys = new Set()
  }
  if (!pool.length) {
    const emptyLanes = {
      eliteCore: [],
      strongCore: [],
      eliteCombo: [],
      strongCombo: [],
      eliteSpecial: [],
      strongSpecial: [],
    }
    return {
      ...emptyLanes,
      elite: [],
      strong: [],
      fades: [],
      formattedText: buildLaneStructuredFormattedText({
        generatedAt,
        ...emptyLanes,
        fadesOut: [],
        specialSectionSubtitle: undefined,
        specialEliteUseLadderRange: false,
      }),
      generatedAt,
      rankedOpportunityPool: [],
    }
  }

  const fws = pool.map((c) => toNum(c.finalWeight)).filter((x) => Number.isFinite(x))
  const fwMed = median(fws) ?? 1.0
  const fwTop = fws.length ? Math.max(...fws) * 0.92 : 1.0

  let floorPool = pool.filter((c) => passesAiPickScoredFloor(c, fwMed))
  let rankedCandidatePool = dedupeByPlayerPropTypeLine(floorPool)
  let primaryLaneByPe = buildPrimaryLaneByPlayerEvent(rankedCandidatePool)
  rankedCandidatePool = sortByRankDesc(rankedCandidatePool, primaryLaneByPe)
  if (!rankedCandidatePool.length) {
    rankedCandidatePool = dedupeByPlayerPropTypeLine([...pool])
    primaryLaneByPe = buildPrimaryLaneByPlayerEvent(rankedCandidatePool)
    rankedCandidatePool = sortByRankDesc(rankedCandidatePool, primaryLaneByPe)
  }

  const { coreCandidates, comboCandidates, specialCandidates } = splitRankedPoolByLane(
    rankedCandidatePool,
    (c) => rankScoreForAiPicks(c, primaryLaneByPe)
  )

  const eliteGate = (c) => passesEliteTierGate(c, dominanceEliteBlockedKeys, fwMed, fwTop)

  const coreStatScores = coreCandidates.map((c) => statScoreRow(c, "NEUTRAL")).filter(Number.isFinite)
  const coreStatTh = (median(coreStatScores) ?? 1) * 0.66

  let eliteComboRaw = takeFirstNPassing(comboCandidates, 1, eliteGate)
  const comboPlayerKeysElite = new Set(eliteComboRaw.map((c) => playerKey(c)).filter(Boolean))

  const coreSortedNoComboPlayers = sortByRankDesc(
    coreCandidates.filter((c) => !comboPlayerKeysElite.has(playerKey(c))),
    primaryLaneByPe
  )

  let eliteCoreRaw = takeEliteCoreRespectingCaps(
    coreSortedNoComboPlayers,
    3,
    eliteGate,
    coreStatTh,
    comboPlayerKeysElite
  )
  if (!eliteCoreRaw.length) {
    const looseCore = sortByRankDesc(
      coreSortedNoComboPlayers.filter(
        (c) =>
          passesStrongCoreLaneStat(c, coreStatTh * 0.9) &&
          (toNum(c.edge) ?? 0) >= 0.04 &&
          (toNum(c.finalWeight) ?? 0) >= fwMed
      ),
      primaryLaneByPe
    )
    eliteCoreRaw = takeEliteCoreRespectingCaps(looseCore, 3, () => true, coreStatTh * 0.9, comboPlayerKeysElite)
  }
  eliteCoreRaw = enforceEliteCoreStructure(
    eliteCoreRaw,
    coreCandidates,
    fwMed,
    primaryLaneByPe,
    comboPlayerKeysElite,
    coreStatTh
  )

  let eliteSpecialRaw = specialCandidates.length
    ? takeFirstNPassing(specialCandidates, 1, eliteGate)
    : []
  const usedBeforePseudo = new Set([
    ...eliteCoreRaw.map((c) => playerEventFamilyKey(c)),
    ...eliteComboRaw.map((c) => playerEventFamilyKey(c)),
    ...eliteSpecialRaw.map((c) => playerEventFamilyKey(c)),
  ])
  let specialPseudoThrees = false
  if (!specialCandidates.length && !eliteSpecialRaw.length) {
    const pseudo = coreCandidates.find(
      (c) =>
        inferPropLaneKey(c) === "threes" &&
        !usedBeforePseudo.has(playerEventFamilyKey(c)) &&
        passesAiPickScoredFloor(c, fwMed)
    )
    if (pseudo) {
      eliteSpecialRaw = [pseudo]
      specialPseudoThrees = true
    }
  }

  const eliteLegKeys = new Set([
    ...eliteCoreRaw.map((c) => playerEventFamilyKey(c)),
    ...eliteComboRaw.map((c) => playerEventFamilyKey(c)),
    ...eliteSpecialRaw.map((c) => playerEventFamilyKey(c)),
  ])

  const { strongCore: strongCoreRaw, strongCombo: strongComboRaw, strongSpecial: strongSpecialRaw } =
    takeStrongLaneSlices(coreCandidates, comboCandidates, specialCandidates, eliteLegKeys, 5, 1, 2, {
      eliteComboPlayerKeys: comboPlayerKeysElite,
      coreStatTh,
    })

  let eliteCoreOut = eliteCoreRaw
    .map((c) => buildEliteOrStrongPick(c, rankedCandidatePool, "elite"))
    .filter(passesCorePickLadderReality)
  let strongCoreOut = strongCoreRaw
    .map((c) => buildEliteOrStrongPick(c, rankedCandidatePool, "strong"))
    .filter(passesCorePickLadderReality)
  let eliteComboOut = eliteComboRaw.map((c) => buildComboOrSpecialLanePick(c, "elite"))
  let strongComboOut = strongComboRaw.map((c) => buildComboOrSpecialLanePick(c, "strong"))
  let eliteSpecialOut = eliteSpecialRaw.map((c) =>
    specialPseudoThrees ? buildEliteOrStrongPick(c, rankedCandidatePool, "elite") : buildComboOrSpecialLanePick(c, "elite")
  )
  let strongSpecialOut = strongSpecialRaw.map((c) => buildComboOrSpecialLanePick(c, "strong"))

  eliteCoreOut = dedupePicksByPlayerPropLine(eliteCoreOut)
  strongCoreOut = dedupePicksByPlayerPropLine(strongCoreOut)
  eliteComboOut = dedupePicksByPlayerPropLine(eliteComboOut)
  strongComboOut = dedupePicksByPlayerPropLine(strongComboOut)
  eliteSpecialOut = dedupePicksByPlayerPropLine(eliteSpecialOut)
  strongSpecialOut = dedupePicksByPlayerPropLine(strongSpecialOut)

  const elite = [...eliteCoreOut, ...eliteComboOut, ...eliteSpecialOut]
  const strong = [...strongCoreOut, ...strongComboOut, ...strongSpecialOut]

  const used = new Set([...elite.map(playerKey), ...strong.map(playerKey)])
  const fadeScored = pool
    .filter((c) => !used.has(playerKey(c)))
    .map((c) => {
      const m = toNum(c.matchupAdj) ?? 0
      const p = toNum(c.paceAdj) ?? 0
      const b = toNum(c.blowoutAdj) ?? 0
      const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
      const trend = toNum(rf?.trend_delta)
      const slowPace = p <= -0.01 || (Number.isFinite(toNum(c.eventPace)) && toNum(c.eventPace) <= 98.5)
      const toughMatch = m <= -0.014
      const weakForm = Number.isFinite(trend) && trend < -0.04
      const lowEdge = (toNum(c.edge) ?? 0) < 0.028
      const caution = (toughMatch && slowPace) || (toughMatch && weakForm) || (slowPace && weakForm && m < 0)
      const score = m + p + b + (weakForm ? -0.03 : 0)
      return { c, score, caution }
    })
    .filter((x) => x.caution && x.score < 0.012)

  fadeScored.sort((a, b) => a.score - b.score)
  const fadeSorted = fadeScored.map((x) => x.c)
  let fades = pickBestPerPlayer(fadeSorted, 4, new Set())
  if (!fades.length) {
    const loose = pool
      .filter((c) => !used.has(playerKey(c)))
      .map((c) => {
        const m = toNum(c.matchupAdj) ?? 0
        const p = toNum(c.paceAdj) ?? 0
        return { c, score: m + p }
      })
      .filter((x) => x.score < -0.008)
      .sort((a, b) => a.score - b.score)
    fades = pickBestPerPlayer(
      loose.map((x) => x.c),
      4,
      new Set()
    )
  }

  const fadesOut = fades.map((c) => ({
    ...c,
    aiTier: "fade",
    aiReasoning: buildFadeReasoning(c),
    aiHeadline: formatPropHeadline(c),
  }))

  return {
    eliteCore: eliteCoreOut,
    strongCore: strongCoreOut,
    eliteCombo: eliteComboOut,
    strongCombo: strongComboOut,
    eliteSpecial: eliteSpecialOut,
    strongSpecial: strongSpecialOut,
    elite,
    strong,
    fades: fadesOut,
    formattedText: buildLaneStructuredFormattedText({
      generatedAt,
      eliteCore: eliteCoreOut,
      strongCore: strongCoreOut,
      eliteCombo: eliteComboOut,
      strongCombo: strongComboOut,
      eliteSpecial: eliteSpecialOut,
      strongSpecial: strongSpecialOut,
      fadesOut,
      specialSectionSubtitle: specialPseudoThrees
        ? "(threes spotlight — no first-basket / DD special pool on this slate)"
        : undefined,
      specialEliteUseLadderRange: specialPseudoThrees,
    }),
    generatedAt,
    /** Scored floor + composite sort; used for range resolution + slips (no raw snapshot bleed). */
    rankedOpportunityPool: rankedCandidatePool,
  }
}

module.exports = {
  buildNbaAiPicks,
  formatPropHeadline,
  buildReasoning,
  inferPropLaneKey,
}
