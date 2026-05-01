"use strict"

const { dedupeCandidates, sortByProbDesc } = require("./nbaOpportunityCandidates")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function playerKey(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
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

function formatPropHeadline(c) {
  const player = String(c.player || "").trim() || "Player"
  const pt = String(c.propType || c.marketKey || "Prop").trim()
  const side = String(c.side || "").trim()
  const line = c.line != null && Number.isFinite(Number(c.line)) ? Number(c.line) : null
  const ladder = String(c.ladder || "").trim()
  if (ladder) return `${player} — ${ladder}`
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

function formatTierBlock(title, emoji, picks, reasonFn) {
  const rf = reasonFn || buildReasoning
  let s = `${emoji} ${title}\n`
  if (!picks.length) {
    s += "(none today)\n\n"
    return s
  }
  picks.forEach((c, i) => {
    s += `${i + 1}. ${formatPropHeadline(c)}\n`
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
  const pool = collectPool(nbaOpportunityBoard).sort(sortByProbDesc)
  if (!pool.length) {
    return {
      elite: [],
      strong: [],
      fades: [],
      formattedText: buildFormattedBlock([], [], [], generatedAt),
      generatedAt,
    }
  }

  const fws = pool.map((c) => toNum(c.finalWeight)).filter((x) => Number.isFinite(x))
  const fwMed = median(fws) ?? 1.0
  const fwTop = fws.length ? Math.max(...fws) * 0.92 : 1.0

  const eliteCandidates = pool.filter((c) => {
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

  let eliteSorted = [...eliteCandidates].sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  if (!eliteSorted.length) {
    eliteSorted = pool
      .filter((c) => (toNum(c.edge) ?? 0) >= 0.042 && (toNum(c.finalWeight) ?? 0) >= fwMed + 0.04)
      .sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  }
  const elite = pickBestPerPlayer(eliteSorted, 5, new Set())

  const eliteKeys = new Set(elite.map(playerKey))
  const strongCandidates = pool.filter((c) => {
    if (eliteKeys.has(playerKey(c))) return false
    const e = toNum(c.edge) ?? -9
    const fw = toNum(c.finalWeight) ?? 0
    const m = toNum(c.matchupAdj) ?? 0
    const p = toNum(c.paceAdj) ?? 0
    if (e < 0.018) return false
    if (fw < fwMed - 0.02) return false
    if (m < -0.028 && p < -0.012) return false
    return true
  })
  const strongSorted = [...strongCandidates].sort((a, b) => compositeRankScore(b) - compositeRankScore(a))
  const strong = pickBestPerPlayer(strongSorted, 6, new Set())

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

  const eliteOut = elite.map((c) => ({
    ...c,
    aiTier: "elite",
    aiReasoning: buildReasoning(c),
    aiHeadline: formatPropHeadline(c),
  }))
  const strongOut = strong.map((c) => ({
    ...c,
    aiTier: "strong",
    aiReasoning: buildReasoning(c),
    aiHeadline: formatPropHeadline(c),
  }))
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
  }
}

module.exports = {
  buildNbaAiPicks,
  formatPropHeadline,
  buildReasoning,
}
