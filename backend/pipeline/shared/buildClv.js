"use strict"

/**
 * Shared CLV (Closing Line Value) engine.
 *
 * Pure computation — no file I/O, no sport-specific branches, no API calls.
 * Imported by buildPersonalLedger.js.
 *
 * Core concept:
 *   CLV = impliedProbClose − impliedProbPlaced
 *
 *   Positive CLV = you got better odds than the closing market → good process.
 *   Negative CLV = market moved against you before close   → poor process.
 *
 *   CLV is INDEPENDENT of result: a +CLV bet that loses is still good process
 *   (variance loss). A −CLV bet that wins is a lucky outcome.
 *
 * Line movement:
 *   When the closing LINE differs from the placed line (e.g. 7.5 → 6.5),
 *   odds alone can't tell the full story. We track both:
 *     lineDelta = closingLine − placedLine
 *     For overs: negative lineDelta = line dropped = easier bar → market doubts your side
 *     For unders: positive lineDelta = line rose   = easier bar → market doubts your side
 *   This is stored separately; it does not override the odds-based clvScore.
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

function r4(x) { return Math.round(Number(x) * 10000) / 10000 }
function r2(x) { return Math.round(Number(x) * 100) / 100 }

function impliedFromAmerican(american) {
  const a = Number(american)
  if (!Number.isFinite(a) || a === 0) return null
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100)
}

function americanFromImplied(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null
  return p > 0.5 ? -Math.round(p / (1 - p) * 100) : Math.round((1 - p) / p * 100)
}

// ─── CLV computation ──────────────────────────────────────────────────────────

/**
 * Compute CLV for a single bet.
 *
 * @param {object} opts
 * @param {number|null} opts.placedOdds       American odds at bet time
 * @param {number|null} opts.closingOdds      American odds at close (same line)
 * @param {number|null} opts.placedLine       Line at bet time
 * @param {number|null} opts.closingLine      Line at close (may differ from placed)
 * @param {string}      opts.side             "over" | "under" | "yes" | "no"
 * @param {string|null} opts.sportsbook       For attribution
 * @param {string|null} opts.closingSportsbook Book of closing snapshot (may differ)
 * @returns CLV result object
 */
function computeClv({ placedOdds, closingOdds, placedLine, closingLine, side, sportsbook = null, closingSportsbook = null } = {}) {
  const pOdds = Number.isFinite(Number(placedOdds)) ? Number(placedOdds) : null
  const cOdds = Number.isFinite(Number(closingOdds)) ? Number(closingOdds) : null
  const pLine = Number.isFinite(Number(placedLine)) ? Number(placedLine) : null
  const cLine = Number.isFinite(Number(closingLine)) ? Number(closingLine) : null

  const pImp = impliedFromAmerican(pOdds)
  const cImp = impliedFromAmerican(cOdds)

  const sideL = String(side || "").toLowerCase()
  const isOver = sideL.startsWith("o") || sideL === "yes"
  const isUnder = sideL.startsWith("u") || sideL === "no"

  // Core CLV: implied probability delta (positive = good process)
  const impliedProbDelta = pImp != null && cImp != null ? r4(cImp - pImp) : null
  const clvScore = impliedProbDelta         // primary signal
  const clvPct = clvScore != null ? r2(clvScore * 100) : null

  // Line delta: positive = line moved up
  const lineDelta = pLine != null && cLine != null ? r2(cLine - pLine) : null

  // Was the line meaningful enough to have moved in your favour or against?
  // For overs: lineDelta < 0 = market lowered the bar → your original bet is harder than close
  // For unders: lineDelta > 0 = market raised the bar → same idea
  let lineMovedFor = null      // null = no line movement or unknown side
  if (lineDelta != null && Math.abs(lineDelta) >= 0.25) {
    if (isOver) lineMovedFor = lineDelta > 0   // line went UP = harder bar = bad for over bettor
      ? false : true
    else if (isUnder) lineMovedFor = lineDelta < 0 ? false : true
  }

  // Quality tier
  let quality = "neutral"
  if (clvScore != null) {
    if (clvScore >= 0.06) quality = "strong_positive"
    else if (clvScore >= 0.02) quality = "positive"
    else if (clvScore > -0.02) quality = "neutral"
    else if (clvScore > -0.05) quality = "negative"
    else quality = "strong_negative"
  }

  const beatMarket = clvScore != null ? clvScore > 0.005 : null  // 0.5 cent threshold

  // Narrative (human-readable)
  let narrative = null
  if (clvPct != null && Math.abs(clvPct) >= 0.5) {
    if (beatMarket) narrative = `beat market by ${Math.abs(clvPct).toFixed(1)}¢`
    else narrative = `market moved ${Math.abs(clvPct).toFixed(1)}¢ against`
  }
  if (lineDelta != null && Math.abs(lineDelta) >= 0.5) {
    const lineNote = isOver
      ? (lineDelta > 0 ? `line up ${lineDelta} (harder bar)` : `line down ${Math.abs(lineDelta)} (easier bar)`)
      : (lineDelta < 0 ? `line down ${Math.abs(lineDelta)} (harder bar)` : `line up ${lineDelta} (easier bar)`)
    narrative = narrative ? `${narrative}; ${lineNote}` : lineNote
  }

  return {
    placedOdds: pOdds,
    closingOdds: cOdds,
    sportsbook: sportsbook || null,
    closingSportsbook: closingSportsbook || null,
    placedLine: pLine,
    closingLine: cLine,
    placedImpliedProb: pImp != null ? r4(pImp) : null,
    closingImpliedProb: cImp != null ? r4(cImp) : null,
    impliedProbDelta,
    clvScore,
    clvPct,
    lineDelta,
    lineMovedFor,
    quality,
    beatMarket,
    narrative,
  }
}

// ─── result vs CLV classification ─────────────────────────────────────────────

/**
 * Returns one of four process-quality labels.
 * This is the ONLY place the "good bet vs good result" distinction lives.
 */
function classifyResultVsClv(result, clv) {
  if (!clv || clv.beatMarket == null) return null
  const won = String(result || "").toLowerCase() === "win"
  const beat = clv.beatMarket
  if (beat && won) return "good_process_good_result"
  if (beat && !won) return "good_process_variance_loss"
  if (!beat && won) return "lucky_win"
  return "bad_process_bad_result"
}

// ─── batch analytics ──────────────────────────────────────────────────────────

/**
 * Aggregate CLV statistics across an array of ledger bet objects.
 * Bets without a populated clvSnapshot.clv are silently excluded.
 */
function buildClvAnalytics(bets) {
  const withClv = bets.filter((b) => b.clvSnapshot?.clv?.clvScore != null)
  const settled = withClv.filter((b) => b.result !== "pending")

  if (!withClv.length) return { count: 0, avgClv: null, avgClvPct: null }

  const scores = withClv.map((b) => b.clvSnapshot.clv.clvScore)
  const avgClv = r4(scores.reduce((a, s) => a + s, 0) / scores.length)
  const avgClvPct = r2(avgClv * 100)

  const beatCount = withClv.filter((b) => b.clvSnapshot.clv.beatMarket).length
  const beatMarketRate = r4(beatCount / withClv.length)

  // CLV win-rate split: does positive CLV → better results?
  const posClvSettled = settled.filter((b) => b.clvSnapshot.clv.beatMarket)
  const negClvSettled = settled.filter((b) => !b.clvSnapshot.clv.beatMarket)
  const posClvWinRate = posClvSettled.length
    ? r4(posClvSettled.filter((b) => b.result === "win").length / posClvSettled.length) : null
  const negClvWinRate = negClvSettled.length
    ? r4(negClvSettled.filter((b) => b.result === "win").length / negClvSettled.length) : null

  // Best / worst individual bets by CLV score
  const sorted = [...withClv].sort((a, b) => b.clvSnapshot.clv.clvScore - a.clvSnapshot.clv.clvScore)
  const bestClv = sorted.slice(0, 5).map(({ player, statFamily, side, line, result, clvSnapshot }) => ({
    player, statFamily, side, line, result,
    clvScore: clvSnapshot.clv.clvScore,
    clvPct: clvSnapshot.clv.clvPct,
    narrative: clvSnapshot.clv.narrative,
    quality: clvSnapshot.clv.quality,
    processLabel: classifyResultVsClv(result, clvSnapshot.clv),
  }))
  const worstClv = sorted.slice(-5).reverse().map(({ player, statFamily, side, line, result, clvSnapshot }) => ({
    player, statFamily, side, line, result,
    clvScore: clvSnapshot.clv.clvScore,
    clvPct: clvSnapshot.clv.clvPct,
    narrative: clvSnapshot.clv.narrative,
    quality: clvSnapshot.clv.quality,
    processLabel: classifyResultVsClv(result, clvSnapshot.clv),
  }))

  // By stat family
  const byStat = {}
  for (const b of withClv) {
    const k = b.statFamily
    if (!k) continue
    if (!byStat[k]) byStat[k] = { count: 0, sumScore: 0, beatCount: 0 }
    byStat[k].count++
    byStat[k].sumScore += b.clvSnapshot.clv.clvScore
    if (b.clvSnapshot.clv.beatMarket) byStat[k].beatCount++
  }
  for (const k of Object.keys(byStat)) {
    const s = byStat[k]
    s.avgClv = r4(s.sumScore / s.count)
    s.avgClvPct = r2(s.avgClv * 100)
    s.beatRate = r4(s.beatCount / s.count)
    delete s.sumScore
  }

  // By sportsbook
  const bySportsbook = {}
  for (const b of withClv) {
    const k = b.sportsbook
    if (!k) continue
    if (!bySportsbook[k]) bySportsbook[k] = { count: 0, sumScore: 0 }
    bySportsbook[k].count++
    bySportsbook[k].sumScore += b.clvSnapshot.clv.clvScore
  }
  for (const k of Object.keys(bySportsbook)) {
    bySportsbook[k].avgClv = r4(bySportsbook[k].sumScore / bySportsbook[k].count)
    bySportsbook[k].avgClvPct = r2(bySportsbook[k].avgClv * 100)
    delete bySportsbook[k].sumScore
  }

  // By confidence tier
  const byTier = {}
  for (const b of withClv) {
    const k = b.confidenceTier
    if (!k || k === "unknown") continue
    if (!byTier[k]) byTier[k] = { count: 0, sumScore: 0 }
    byTier[k].count++
    byTier[k].sumScore += b.clvSnapshot.clv.clvScore
  }
  for (const k of Object.keys(byTier)) {
    byTier[k].avgClv = r4(byTier[k].sumScore / byTier[k].count)
    byTier[k].avgClvPct = r2(byTier[k].avgClv * 100)
    delete byTier[k].sumScore
  }

  // Process quality breakdown (settled bets only)
  const processBreakdown = {}
  for (const b of settled) {
    const label = classifyResultVsClv(b.result, b.clvSnapshot?.clv)
    if (!label) continue
    processBreakdown[label] = (processBreakdown[label] || 0) + 1
  }

  return {
    count: withClv.length,
    avgClv,
    avgClvPct,
    beatMarketCount: beatCount,
    beatMarketRate,
    posClvWinRate,
    negClvWinRate,
    bestClv,
    worstClv,
    byStat,
    bySportsbook,
    byTier,
    processBreakdown,
  }
}

module.exports = { computeClv, classifyResultVsClv, buildClvAnalytics, impliedFromAmerican }
