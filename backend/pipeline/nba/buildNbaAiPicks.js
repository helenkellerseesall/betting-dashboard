"use strict"

const { dedupeCandidates, sortByProbDesc } = require("./nbaOpportunityCandidates")
const {
  computeOutcomeRange,
  resolveLegFromAiRange,
  resolveLottoLegAboveCeiling,
  overRungFromLine,
} = require("./nbaAiOutcomeRange")
const {
  expandCandidatesByTopStatFamilies,
  playerEventFamilyKey,
  statFamilyKey,
} = require("./nbaAiStatFamilyRank")
const { filterPoolByDominanceGap } = require("./nbaAiDominanceGap")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function playerKey(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

/** Canonical stat label for AI pick copy — never sportsbook "Points Ladder" / "PRA Ladder" leakage. */
function displayStatLabelForAiPick(c) {
  const fam = statFamilyKey(c)
  if (fam === "points") return "points"
  if (fam === "pra") return "pra"
  if (fam === "combo") return "combo"
  if (fam === "threes") return "threes"
  if (fam === "rebounds") return "rebounds"
  if (fam === "assists") return "assists"
  let s = String(c?.propType || c?.marketKey || "prop")
    .trim()
    .replace(/\s*ladder\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
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

function formatTierBlock(title, emoji, picks, reasonFn) {
  const rf = reasonFn || buildReasoning
  let s = `${emoji} ${title}\n`
  if (!picks.length) {
    s += "(none today)\n\n"
    return s
  }
  picks.forEach((c, i) => {
    s += `${i + 1}. ${formatPickHeadlineWithRange(c)}\n`
    s += `   ${rf(c)}\n\n`
  })
  return s
}

function buildFormattedBlock(elite, strong, fades, generatedAt) {
  return [
    "==== AI PICKS ====",
    `Generated: ${generatedAt}`,
    "",
    formatTierBlock("ELITE PLAYS", "🔥", elite, buildReasoning),
    formatTierBlock("STRONG PLAYS", "🎯", strong, buildReasoning),
    formatTierBlock("FADE / UNDER", "⚠️", fades, buildFadeReasoning),
    "===================",
    "",
  ].join("\n")
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
    return {
      elite: [],
      strong: [],
      fades: [],
      formattedText: buildFormattedBlock([], [], [], generatedAt),
      generatedAt,
      rankedOpportunityPool: [],
    }
  }

  const fws = pool.map((c) => toNum(c.finalWeight)).filter((x) => Number.isFinite(x))
  const fwMed = median(fws) ?? 1.0
  const fwTop = fws.length ? Math.max(...fws) * 0.92 : 1.0

  let rankedCandidatePool = pool
    .filter((c) => passesAiPickScoredFloor(c, fwMed))
    .sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  if (!rankedCandidatePool.length) {
    rankedCandidatePool = [...pool].sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  }

  const fullRowsByPlayerEvent = new Map()
  for (const c of rankedCandidatePool) {
    const pk = playerKey(c)
    const ek = String(c.eventId || "").trim()
    if (!pk || !ek) continue
    const k = `${pk}::${ek}`
    if (!fullRowsByPlayerEvent.has(k)) fullRowsByPlayerEvent.set(k, [])
    fullRowsByPlayerEvent.get(k).push(c)
  }

  const eliteCandidates = rankedCandidatePool.filter((c) => {
    const pef = `${playerKey(c)}|${String(c.eventId || "").trim()}|${statFamilyKey(c)}`
    if (dominanceEliteBlockedKeys instanceof Set && dominanceEliteBlockedKeys.has(pef)) return false
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
  })

  let elitePool = [...eliteCandidates].sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  if (!elitePool.length) {
    elitePool = rankedCandidatePool
      .filter((c) => (toNum(c.edge) ?? 0) >= 0.042 && (toNum(c.finalWeight) ?? 0) >= fwMed + 0.04)
      .sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  }
  const elite = expandCandidatesByTopStatFamilies(elitePool, 1, 14, "elite", fullRowsByPlayerEvent)

  const eliteFamilyKeys = new Set(elite.map((c) => playerEventFamilyKey(c)))
  const strongCandidates = rankedCandidatePool.filter((c) => {
    const pef = `${playerKey(c)}|${String(c.eventId || "").trim()}|${statFamilyKey(c)}`
    if (eliteFamilyKeys.has(pef)) return false
    return true
  })
  const strongSorted = [...strongCandidates].sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  const strong = expandCandidatesByTopStatFamilies(strongSorted, 1, 18, "strong", fullRowsByPlayerEvent)

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

  // ELITE and STRONG share one builder only: computeOutcomeRange → attachAiPickRangeResolution → headline (no legacy elite path).
  const eliteOut = elite.map((c) => buildEliteOrStrongPick(c, rankedCandidatePool, "elite"))
  const strongOut = strong.map((c) => buildEliteOrStrongPick(c, rankedCandidatePool, "strong"))
  const fadesOut = fades.map((c) => ({
    ...c,
    aiTier: "fade",
    aiReasoning: buildFadeReasoning(c),
    aiHeadline: formatPropHeadline(c),
  }))

  return {
    elite: eliteOut,
    strong: strongOut,
    fades: fadesOut,
    formattedText: buildFormattedBlock(eliteOut, strongOut, fadesOut, generatedAt),
    generatedAt,
    /** Scored floor + composite sort; used for range resolution + slips (no raw snapshot bleed). */
    rankedOpportunityPool: rankedCandidatePool,
  }
}

module.exports = {
  buildNbaAiPicks,
  formatPropHeadline,
  buildReasoning,
}
