"use strict"

function num(value) {
  if (value == null) return null
  if (typeof value === "string" && !value.trim()) return null
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

function normalizeNbaStatusText(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Bucket player availability from runtime string fields only (no API).
 * Mirrors server-side runtime normalization intent.
 */
function deriveNbaAvailabilityBucket(row) {
  const raw = row?.availabilityStatus || row?.playerStatus || row?.status || row?.injuryStatus || ""
  const n = normalizeNbaStatusText(raw)
  if (!n) return { bucket: null, rawPrimary: null }
  const rawPrimary = String(raw).trim()
  if (n.includes("questionable") || n.includes("game time decision") || n.includes("gtd")) {
    return { bucket: "questionable", rawPrimary }
  }
  if (n.includes("doubtful")) return { bucket: "doubtful", rawPrimary }
  if (
    n.includes("probable") ||
    n.includes("returning") ||
    n.includes("minutes restriction") ||
    n.includes("limited")
  ) {
    return { bucket: "probable", rawPrimary }
  }
  if (
    n.includes("available") ||
    n.includes("active") ||
    n.includes("cleared") ||
    n.includes("healthy") ||
    n.includes("will play")
  ) {
    return { bucket: "active", rawPrimary }
  }
  const isOut =
    /\bout\b/.test(n) ||
    n.includes("inactive") ||
    n.includes("suspended") ||
    n.includes("not with team") ||
    /^dnp/.test(n) ||
    n.includes("dnp ")
  if (isOut) return { bucket: "out", rawPrimary }
  return { bucket: null, rawPrimary }
}

function deriveNbaStarterBucket(row) {
  const raw =
    row?.starterStatus ||
    row?.lineupStatus ||
    row?.startingStatus ||
    row?.startingRole ||
    row?.roleTag ||
    ""
  const n = normalizeNbaStatusText(raw)
  const ctx = normalizeNbaStatusText(row?.contextTag || row?.mustPlayContextTag || "")
  if (!n && !ctx) return null
  if (n.includes("starter") || n.includes("starting") || n.includes("first unit")) return "starter"
  if (n.includes("bench") || n.includes("reserve") || n.includes("non starter") || n.includes("second unit")) return "bench"
  if (ctx.includes("starter") || ctx.includes("starting")) return "starter"
  return null
}

function injuryRiskLabelToScore(label) {
  const s = String(label || "").trim().toLowerCase()
  if (s === "high") return 0.85
  if (s === "medium") return 0.5
  if (s === "low") return 0.18
  return null
}

function deriveInjuryRiskScore(row, availabilityBucket) {
  let score = injuryRiskLabelToScore(row?.injuryRisk)
  if (availabilityBucket === "questionable") score = score == null ? 0.45 : Math.max(score, 0.52)
  if (availabilityBucket === "doubtful") score = score == null ? 0.62 : Math.max(score, 0.68)
  if (availabilityBucket === "probable") score = score == null ? 0.32 : Math.max(score, 0.3)
  if (!Number.isFinite(score)) return null
  return Number(Math.min(1, Math.max(0, score)).toFixed(3))
}

function joinNbaReasonBlob(row) {
  return [
    row?.decisionSummary,
    row?.playDecision,
    row?.modelSummary,
    row?.contextTag,
    row?.mustPlayContextTag,
    row?.statusTag
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase())
    .join(" ")
}

function teammateAbsenceFromBlob(blob) {
  if (!blob) return false
  if (blob.includes("teammate") && (blob.includes("out") || blob.includes("injured") || blob.includes("absence")))
    return true
  if (blob.includes("injury") && (blob.includes("opens") || blob.includes("opportunity") || blob.includes("vacuum")))
    return true
  if (blob.includes("ruled out") && (blob.includes("starter") || blob.includes("star"))) return true
  if (blob.includes("absence") && blob.includes("rotation")) return true
  return false
}

function deriveMinutesTrendScore(avgMin, recent5MinAvg, recent3MinAvg) {
  if (!Number.isFinite(recent3MinAvg) || !Number.isFinite(recent5MinAvg)) return null
  const shortDelta = recent3MinAvg - recent5MinAvg
  let w = shortDelta / 6
  if (Number.isFinite(avgMin) && avgMin > 1) {
    w += (recent5MinAvg - avgMin) / Math.max(avgMin, 12)
  }
  return Number(Math.max(-1, Math.min(1, w)).toFixed(3))
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

  const { bucket: availabilityBucket, rawPrimary: availabilityRawPrimary } = deriveNbaAvailabilityBucket(row)
  const starterBucket = deriveNbaStarterBucket(row)
  const starterStatus =
    starterBucket ||
    (row?.starterStatus != null && String(row.starterStatus).trim()
      ? String(row.starterStatus).trim().toLowerCase()
      : null)

  const avgMinN = num(row?.avgMin)
  const recent5MinAvgN = num(row?.recent5MinAvg)
  const recent3MinAvgN = num(row?.recent3MinAvg)
  const hasRealMinutes =
    (Number.isFinite(avgMinN) && avgMinN > 0) ||
    (Number.isFinite(recent5MinAvgN) && recent5MinAvgN > 0) ||
    (Number.isFinite(recent3MinAvgN) && recent3MinAvgN > 0)
  const minutesTrendScore = deriveMinutesTrendScore(avgMinN, recent5MinAvgN, recent3MinAvgN)
  const highMinutesFlag = Boolean(
    (Number.isFinite(avgMinN) && avgMinN >= 30) ||
      (Number.isFinite(recent5MinAvgN) &&
        recent5MinAvgN >= 32 &&
        Number.isFinite(avgMinN) &&
        avgMinN >= 26)
  )

  const injuryRiskScore = deriveInjuryRiskScore(row, availabilityBucket)
  const reasonBlob = joinNbaReasonBlob(row)
  const teammateAbsenceHint = teammateAbsenceFromBlob(reasonBlob)
  const ctxTagLower = String(row?.contextTag || "").toLowerCase()

  ctx.availabilityContext = {
    minutesRisk,
    injuryRisk,
    trendRisk,
    availabilityStatus: availabilityBucket,
    availabilityStatusRaw: availabilityRawPrimary || null,
    playerStatus: row?.playerStatus != null && String(row.playerStatus).trim() ? String(row.playerStatus).trim() : null,
    injuryStatus: row?.injuryStatus != null && String(row.injuryStatus).trim() ? String(row.injuryStatus).trim() : null,
    starterStatus,
    injuryRiskScore
  }

  ctx.roleContext = {
    roleSpikeScore: num(row?.roleSpikeScore),
    opportunitySpikeScore: num(row?.opportunitySpikeScore),
    lineupContextScore: num(row?.lineupContextScore),
    avgMin: avgMinN,
    recent5MinAvg: recent5MinAvgN,
    recent3MinAvg: recent3MinAvgN,
    minutesTrendScore,
    highMinutesFlag
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

  const dvpN = num(row?.dvpScore)
  ctx.matchupContext = {
    matchup: row?.matchup != null ? String(row.matchup) : null,
    opponentTeam: row?.opponentTeam != null ? String(row.opponentTeam) : null,
    matchupEdgeScore: num(row?.matchupEdgeScore),
    dvpScore: dvpN,
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
  const matchupE = ctx.matchupContext.matchupEdgeScore
  const gameEnv = ctx.matchupContext.gameEnvironmentScore
  const opp = num(row?.opportunitySpikeScore)
  const lineupC = num(row?.lineupContextScore)
  const propKindForDvp = nbaCeilingPropKind(row?.propType)

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
    if (hasRealMinutes && Number.isFinite(ctx.roleContext.roleSpikeScore) && ctx.roleContext.roleSpikeScore >= 0.28) {
      tags.push("role / minutes spike")
    }
    if (Number.isFinite(ctx.roleContext.opportunitySpikeScore) && ctx.roleContext.opportunitySpikeScore >= 0.35) tags.push("opportunity spike")
    if (Number.isFinite(ctx.roleContext.lineupContextScore) && ctx.roleContext.lineupContextScore >= 0.28) tags.push("lineup context boost")
    if (Number.isFinite(recentFormVsLine)) {
      if (side !== "under" && recentFormVsLine >= 1.08) tags.push("recent form over line")
      if (side === "under" && recentFormVsLine >= 1.08) tags.push("recent form supports under")
    }
    if (Number.isFinite(ctx.marketContext.marketLagScore) && ctx.marketContext.marketLagScore >= 0.62) tags.push("market lag signal")
    if (Number.isFinite(ctx.marketContext.bookDisagreementScore) && ctx.marketContext.bookDisagreementScore >= 0.35) tags.push("book disagreement")
    if (Number.isFinite(ctx.marketContext.edgeGap) && ctx.marketContext.edgeGap >= 0.03) tags.push("positive model edge gap")
    if (minutesRisk === "low") tags.push("stable minutes")
    if (injuryRisk === "low") tags.push("low injury risk")
  }

  if (hasRealMinutes && highMinutesFlag && minutesRisk !== "high") tags.push("high minutes role")
  if (hasRealMinutes && Number.isFinite(minutesTrendScore) && minutesTrendScore >= 0.12) tags.push("minutes trending up")
  if (
    (hasRealMinutes && minutesRisk === "high") ||
    (trendRisk === "high" &&
      Number.isFinite(minutesTrendScore) &&
      Math.abs(minutesTrendScore) >= 0.15) ||
    (Number.isFinite(minutesTrendScore) && Math.abs(minutesTrendScore) >= 0.42)
  ) {
    tags.push("minutes volatility risk")
  }

  if (Number.isFinite(matchupE) && matchupE >= 0.42) tags.push("favorable matchup")
  else if (Number.isFinite(matchupE) && matchupE >= 0.32) tags.push("matchup edge signal")

  if (Number.isFinite(gameEnv) && gameEnv >= 0.55) tags.push("fast-paced game environment")

  if (propKindForDvp && Number.isFinite(dvpN) && (dvpN >= 0.55 || dvpN === 1)) {
    tags.push("defensive weakness vs prop type")
  }

  if (teammateAbsenceHint || ctxTagLower.includes("absence")) {
    tags.push("teammate absence opportunity")
  }

  if (
    (availabilityBucket === "probable" && Number.isFinite(opp) && opp >= 0.32) ||
    (Number.isFinite(opp) &&
      opp >= 0.38 &&
      Number.isFinite(lineupC) &&
      lineupC >= 0.28 &&
      injuryRisk !== "high" &&
      minutesRisk !== "high")
  ) {
    tags.push("injury/rotation boost")
  }

  if (availabilityBucket && availabilityBucket !== "active") {
    tags.push(`availability: ${availabilityBucket}`)
  } else if (availabilityBucket == null && availabilityRawPrimary && availabilityRawPrimary.length <= 36) {
    tags.push(`availability: ${availabilityRawPrimary}`)
  }

  ctx.explanationTags = uniqShortTags(tags, 14)
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
