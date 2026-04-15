"use strict"

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function uniqShortTags(tags, max = 6) {
  const out = []
  const seen = new Set()
  for (const t of Array.isArray(tags) ? tags : []) {
    const s = String(t || "").trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** Map surfaced propType labels (incl. "Points Ladder") to core stat buckets. */
function nbaCeilingPropKind(propTypeRaw) {
  const p = String(propTypeRaw || "")
    .toLowerCase()
    .replace(/\s+ladder\b/g, "")
    .trim()
  if (p.includes("pra")) return "PRA"
  if (p.includes("three") || p.includes("3pt")) return "Threes"
  if (p.includes("assist")) return "Assists"
  if (p.includes("rebound")) return "Rebounds"
  if (p.includes("point")) return "Points"
  return ""
}

/**
 * NBA-only: derive lightweight ceiling "trigger" flags from existing row fields.
 * Over-side stat triggers encode high-end outcome setups; usage spike is side-agnostic.
 */
function deriveNbaCeilingTriggers(row, form) {
  const out = {
    scoringCeilingTrigger: false,
    threePointCeilingTrigger: false,
    assistCeilingTrigger: false,
    reboundCeilingTrigger: false,
    usageSpikeTrigger: false,
    ceilingTriggerCount: 0,
    ceilingTriggerScore: 0
  }
  if (!row || typeof row !== "object") return out

  const propKind = nbaCeilingPropKind(row?.propType)
  const side = String(row?.side || "").toLowerCase()
  const isUnder = side === "under"
  const variant = String(row?.propVariant || "base").toLowerCase()

  const line = num(row?.line)
  const r5 = num(row?.recent5Avg)
  const r3 = num(row?.recent3Avg)
  const l10 = num(row?.l10Avg)
  const ref = Number.isFinite(r5) ? r5 : l10
  const recentFormVsLine = form?.recentFormVsLine

  const ceilingScore = num(row?.ceilingScore)
  const lpi = num(row?.longshotPredictiveIndex)
  const roleSpike = num(row?.roleSpikeScore)
  const oppSpike = num(row?.opportunitySpikeScore)
  const lineupCtx = num(row?.lineupContextScore)
  const edgePts = num(row?.edge)
  const marketLag = num(row?.marketLagScore)
  const bookDis = num(row?.bookDisagreementScore)
  const edgeGap = num(row?.edgeGap)

  const overFormRaw =
    !isUnder &&
    Number.isFinite(line) &&
    line > 0 &&
    Number.isFinite(ref) &&
    ref >= line * 1.06
  const overFormVsLine = !isUnder && Number.isFinite(recentFormVsLine) && recentFormVsLine >= 1.05
  const overFormShort = !isUnder && Number.isFinite(r3) && Number.isFinite(line) && line > 0 && r3 >= line * 1.08

  const marketTailwind =
    (Number.isFinite(marketLag) && marketLag >= 0.52) ||
    (Number.isFinite(bookDis) && bookDis >= 0.28)
  const edgeTail =
    (Number.isFinite(edgePts) && edgePts >= 2) ||
    (Number.isFinite(edgeGap) && edgeGap >= 0.025)

  const ceilingBand = Number.isFinite(ceilingScore) && ceilingScore >= 0.55
  const ceilingHot = Number.isFinite(ceilingScore) && ceilingScore >= 0.64
  const lpiHot = Number.isFinite(lpi) && lpi >= 0.52
  const lpiWarm = Number.isFinite(lpi) && lpi >= 0.46

  out.usageSpikeTrigger =
    (Number.isFinite(roleSpike) && roleSpike >= 0.38) ||
    (Number.isFinite(oppSpike) && oppSpike >= 0.4) ||
    (Number.isFinite(roleSpike) &&
      Number.isFinite(oppSpike) &&
      roleSpike >= 0.28 &&
      oppSpike >= 0.34) ||
    (Number.isFinite(roleSpike) &&
      Number.isFinite(lineupCtx) &&
      Number.isFinite(oppSpike) &&
      roleSpike >= 0.26 &&
      lineupCtx >= 0.28 &&
      oppSpike >= 0.3)

  const ladderish = variant === "alt-mid" || variant === "alt-high" || variant === "alt-max"
  const overForm = overFormRaw || overFormVsLine || overFormShort
  const spikeOrMarket = out.usageSpikeTrigger || marketTailwind || edgeTail

  const statCeilingCore =
    !isUnder &&
    overForm &&
    (ceilingHot ||
      (ceilingBand && lpiHot) ||
      (ceilingBand && lpiWarm && spikeOrMarket) ||
      (ladderish && ceilingBand && (lpiWarm || spikeOrMarket)))

  if (propKind === "Points" || propKind === "PRA") {
    const highLinePoints = propKind === "Points" && Number.isFinite(line) && line >= 22
    out.scoringCeilingTrigger =
      Boolean(statCeilingCore) ||
      (!isUnder &&
        highLinePoints &&
        ceilingHot &&
        (spikeOrMarket || lpiHot))
  }

  if (propKind === "Threes") {
    const volumeLine = Number.isFinite(line) && line >= 3
    out.threePointCeilingTrigger =
      Boolean(statCeilingCore) ||
      (!isUnder && volumeLine && ceilingBand && (overForm || lpiHot) && (spikeOrMarket || lpiWarm))
  }

  if (propKind === "Assists") {
    out.assistCeilingTrigger = Boolean(statCeilingCore)
  }

  if (propKind === "Rebounds") {
    out.reboundCeilingTrigger = Boolean(statCeilingCore)
  }

  let count = 0
  if (out.scoringCeilingTrigger) count += 1
  if (out.threePointCeilingTrigger) count += 1
  if (out.assistCeilingTrigger) count += 1
  if (out.reboundCeilingTrigger) count += 1
  if (out.usageSpikeTrigger) count += 1
  out.ceilingTriggerCount = count
  out.ceilingTriggerScore = Number((count / 5).toFixed(3))

  return out
}

function emptyShell(sport) {
  return {
    sport: sport || "unknown",
    availabilityContext: {},
    roleContext: {},
    recentFormContext: {},
    matchupContext: {},
    marketContext: {},
    ceilingContext: {},
    powerContext: {},
    explanationTags: []
  }
}

function buildNbaPregameContext(row) {
  const ctx = emptyShell("nba")
  if (!row || typeof row !== "object") return ctx

  const outcomeTier = String(row?.outcomeTier || "").trim().toLowerCase()

  const minutesRisk = String(row?.minutesRisk || "").trim().toLowerCase() || null
  const injuryRisk = String(row?.injuryRisk || "").trim().toLowerCase() || null
  const trendRisk = String(row?.trendRisk || "").trim().toLowerCase() || null
  const availabilityStatus = String(row?.availabilityStatus || row?.playerStatus || "").trim().toLowerCase() || null
  const starterStatus = String(row?.starterStatus || "").trim().toLowerCase() || null

  ctx.availabilityContext = {
    minutesRisk,
    injuryRisk,
    trendRisk,
    availabilityStatus,
    starterStatus
  }

  ctx.roleContext = {
    roleSpikeScore: num(row?.roleSpikeScore),
    opportunitySpikeScore: num(row?.opportunitySpikeScore),
    lineupContextScore: num(row?.lineupContextScore),
    avgMin: num(row?.avgMin),
    recent5MinAvg: num(row?.recent5MinAvg),
    recent3MinAvg: num(row?.recent3MinAvg)
  }

  const line = num(row?.line)
  const r5 = num(row?.recent5Avg)
  const r3 = num(row?.recent3Avg)
  const l10 = num(row?.l10Avg)
  const ref = Number.isFinite(r5) ? r5 : l10
  const side = String(row?.side || "").toLowerCase()
  let recentFormVsLine = null
  if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
    const pace = ref / line
    if (side === "under") recentFormVsLine = Number((line / Math.max(ref, 1e-6)).toFixed(3))
    else recentFormVsLine = Number(pace.toFixed(3))
  }
  ctx.recentFormContext = {
    recent5Avg: r5,
    recent3Avg: r3,
    l10Avg: l10,
    recentFormVsLine,
    hitRateLabel: row?.hitRate != null ? String(row.hitRate) : null
  }

  ctx.matchupContext = {
    matchupEdgeScore: num(row?.matchupEdgeScore),
    dvpScore: num(row?.dvpScore),
    gameEnvironmentScore: num(row?.gameEnvironmentScore),
    bookValueScore: num(row?.bookValueScore),
    volatilityScore: num(row?.volatilityScore)
  }

  const edgeGap = num(row?.edgeGap)
  const modelHitProb = num(row?.modelHitProb)
  const impliedProb = num(row?.impliedProb)
  ctx.marketContext = {
    marketLagScore: num(row?.marketLagScore),
    bookDisagreementScore: num(row?.bookDisagreementScore),
    edgeGap,
    edgePts: num(row?.edge),
    modelHitProb,
    impliedProb
  }

  const ceilingScore = num(row?.ceilingScore)
  const lpi = num(row?.longshotPredictiveIndex)
  const triggers = deriveNbaCeilingTriggers(row, { recentFormVsLine })
  ctx.ceilingContext = {
    ceilingScore,
    longshotPredictiveIndex: lpi,
    outcomeTier: row?.outcomeTier != null ? String(row.outcomeTier) : null,
    propVariant: row?.propVariant != null ? String(row.propVariant) : null,
    scoringCeilingTrigger: triggers.scoringCeilingTrigger,
    threePointCeilingTrigger: triggers.threePointCeilingTrigger,
    assistCeilingTrigger: triggers.assistCeilingTrigger,
    reboundCeilingTrigger: triggers.reboundCeilingTrigger,
    usageSpikeTrigger: triggers.usageSpikeTrigger,
    ceilingTriggerCount: triggers.ceilingTriggerCount,
    ceilingTriggerScore: triggers.ceilingTriggerScore
  }

  const tags = []
  if (outcomeTier === "support") {
    const confidence = num(row?.confidenceScore) != null ? Number(row.confidenceScore) : null
    const hitRate = typeof row?.hitRate === "string" && row.hitRate.includes("/")
      ? Number(row.hitRate.split("/")[0]) / Number(row.hitRate.split("/")[1])
      : null
    if (Number.isFinite(confidence) && confidence >= 0.58) tags.push("high confidence")
    if (Number.isFinite(hitRate) && hitRate >= 0.55) tags.push("high hit-rate")
    if (Number.isFinite(ctx.marketContext.edgeGap) && ctx.marketContext.edgeGap >= 0.03) tags.push("positive model edge gap")
    if (Number.isFinite(ctx.marketContext.marketLagScore) && ctx.marketContext.marketLagScore >= 0.55) tags.push("market lag signal")
    if (minutesRisk === "low") tags.push("stable minutes")
    if (injuryRisk === "low") tags.push("low injury risk")
  } else {
    const anyStatCeiling =
      triggers.scoringCeilingTrigger ||
      triggers.threePointCeilingTrigger ||
      triggers.assistCeilingTrigger ||
      triggers.reboundCeilingTrigger
    if (triggers.scoringCeilingTrigger) tags.push("scoring ceiling setup")
    if (triggers.threePointCeilingTrigger) tags.push("3PT volume spike")
    if (triggers.assistCeilingTrigger) tags.push("assist opportunity spike")
    if (triggers.reboundCeilingTrigger) tags.push("rebound ceiling setup")
    if (triggers.usageSpikeTrigger) tags.push("usage spike setup")
    if (!anyStatCeiling && Number.isFinite(ceilingScore) && ceilingScore >= 0.72) tags.push("high ceilingScore")
    if (Number.isFinite(lpi) && lpi >= 0.55) tags.push("strong predictive ceiling index")
    if (Number.isFinite(ctx.roleContext.roleSpikeScore) && ctx.roleContext.roleSpikeScore >= 0.28) tags.push("role / minutes spike")
    if (Number.isFinite(ctx.roleContext.opportunitySpikeScore) && ctx.roleContext.opportunitySpikeScore >= 0.35) tags.push("opportunity spike")
    if (Number.isFinite(ctx.roleContext.lineupContextScore) && ctx.roleContext.lineupContextScore >= 0.28) tags.push("lineup context boost")
    if (Number.isFinite(recentFormVsLine)) {
      if (side !== "under" && recentFormVsLine >= 1.08) tags.push("recent form over line")
      if (side === "under" && recentFormVsLine >= 1.08) tags.push("recent form supports under")
    }
    if (Number.isFinite(ctx.matchupContext.matchupEdgeScore) && ctx.matchupContext.matchupEdgeScore >= 0.32) tags.push("matchup edge signal")
    if (Number.isFinite(ctx.matchupContext.gameEnvironmentScore) && ctx.matchupContext.gameEnvironmentScore >= 0.55) tags.push("favorable game environment")
    if (Number.isFinite(ctx.marketContext.marketLagScore) && ctx.marketContext.marketLagScore >= 0.62) tags.push("market lag signal")
    if (Number.isFinite(ctx.marketContext.bookDisagreementScore) && ctx.marketContext.bookDisagreementScore >= 0.35) tags.push("book disagreement")
    if (Number.isFinite(ctx.marketContext.edgeGap) && ctx.marketContext.edgeGap >= 0.03) tags.push("positive model edge gap")
    if (minutesRisk === "low") tags.push("stable minutes")
    if (injuryRisk === "low") tags.push("low injury risk")
  }
  if (availabilityStatus && availabilityStatus !== "available" && availabilityStatus !== "") {
    tags.push(`availability: ${availabilityStatus}`)
  }

  ctx.explanationTags = uniqShortTags(tags, 8)
  return ctx
}

function buildMlbPregameContext(row) {
  const ctx = emptyShell("mlb")
  if (!row || typeof row !== "object") return ctx

  const marketKey = String(row?.marketKey || "").toLowerCase()
  const odds = num(row?.odds)
  const line = num(row?.line)

  ctx.powerContext = {
    homeRunPathScore: num(row?.homeRunPathScore),
    surfaceScore: num(row?.surfaceScore),
    isPitcherMarket: row?.isPitcherMarket === true
  }

  ctx.matchupContext = {
    matchup: row?.matchup || null,
    teamResolved: row?.teamResolved || null,
    teamCode: row?.teamCode || null,
    opponentTeam: row?.opponentTeam || null,
    isHome: row?.isHome === true ? true : row?.isHome === false ? false : null,
    teamMatchesMatchup: row?.teamMatchesMatchup !== false
  }

  ctx.marketContext = {
    book: row?.book || null,
    odds,
    marketFamily: row?.marketFamily || null
  }

  ctx.availabilityContext = {
    identityConfidence: num(row?.identityConfidence),
    identitySource: row?.identitySource || null,
    unresolvedReason: row?.unresolvedReason || null
  }

  const tags = []
  if (Number.isFinite(ctx.powerContext.homeRunPathScore) && ctx.powerContext.homeRunPathScore >= 0.72) tags.push("strong HR path score")
  else if (Number.isFinite(ctx.powerContext.homeRunPathScore) && ctx.powerContext.homeRunPathScore >= 0.55) tags.push("solid HR path score")

  if (marketKey.includes("home_run") || marketKey.includes("homer") || marketKey.includes("to_hit_a_home_run")) {
    tags.push("HR market")
  } else if (marketKey.includes("total_bases") || marketKey.includes("batter_total_bases")) {
    tags.push("power / total bases lane")
  } else if (marketKey.includes("batter") && (marketKey.includes("hits") || marketKey.includes("rbis") || marketKey.includes("runs"))) {
    tags.push("hitter counting stat")
  }

  if (Number.isFinite(odds) && odds >= 300) tags.push("plus-money ceiling price")
  if (Number.isFinite(line) && line <= 0.5 && marketKey.includes("home_run")) tags.push("HR yes / low threshold")

  if (ctx.matchupContext.opponentTeam) tags.push(`vs ${ctx.matchupContext.opponentTeam}`)
  if (ctx.matchupContext.isHome === true) tags.push("home spot")
  if (ctx.matchupContext.isHome === false) tags.push("road spot")

  const idc = ctx.availabilityContext.identityConfidence
  if (Number.isFinite(idc) && idc >= 0.85) tags.push("high identity match")
  else if (Number.isFinite(idc) && idc > 0 && idc < 0.75) tags.push("identity confidence thin")

  ctx.explanationTags = uniqShortTags(tags, 6)
  return ctx
}

function buildPregameContext({ sport, row } = {}) {
  const s = String(sport || "").trim().toLowerCase()
  if (s === "nba") return buildNbaPregameContext(row)
  if (s === "mlb") return buildMlbPregameContext(row)
  return emptyShell(s || "unknown")
}

module.exports = {
  buildPregameContext
}
