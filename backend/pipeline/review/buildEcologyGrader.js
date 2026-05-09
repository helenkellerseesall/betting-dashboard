"use strict"

/**
 * Ecology Grader (Session W)
 *
 * Pure functions. No IO. No side effects.
 *
 * Grades ecosystem performance by ecology bucket and stat family.
 *
 * Answers:
 *   - Which ecology buckets overperformed / underperformed?
 *     (anchors, tonightsBest, smartAggression, safest, aiSlip, pool)
 *   - What is the HR ecology conversion rate?
 *     (candidates in pool → slips built → actual hits)
 *   - Critical detection: "30 HR candidates, 0 HR slips, multiple HR ladders hit"
 *     → MAJOR INTELLIGENCE FINDING: HR_ERUPTION_MISS
 *   - Which suppressed candidates (in pool, not slipped) should have survived?
 *   - Ladder ecology conversion rate
 *   - RBI chain hit rate
 *
 * Inputs:
 *   bets          — array of tracked bets (with ecologyBucket, statFamily, result, side)
 *   slips         — array of tracked slips (with legs array)
 *   candidatePool — full candidate pool from tracked_best / all tracked bets
 *                   Used for suppression analysis
 */

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function isHit(bet) {
  const r = String(bet.result || "").toLowerCase()
  if (r === "win") return true
  if (r === "loss") return false
  const stat = num(bet.actualStat ?? bet.actual_stat)
  const line = num(bet.line)
  const side = String(bet.side || "").toLowerCase()
  if (Number.isFinite(stat) && Number.isFinite(line)) {
    if (side.startsWith("o") || side === "yes") return stat > line
    if (side.startsWith("u") || side === "no") return stat < line
  }
  return null
}

function isSettled(bet) {
  return isHit(bet) !== null
}

function statFam(b) {
  return String(b?.statFamily || b?.stat_family || "").toLowerCase().replace(/[\s_-]/g, "")
}

function ecoBucket(b) {
  return String(
    b?.ecologyBucket || b?.ecology_bucket || b?.bucket || "pool"
  )
    .toLowerCase()
    .replace(/[\s-]/g, "")
}

function isHrStat(b) {
  const f = statFam(b)
  return f === "hr" || f === "homeruns" || f === "homerun" || f.includes("hr")
}

function isLadderBet(b) {
  const tier = String(b.tier || "").toLowerCase()
  const odds = num(b.odds)
  return tier === "lotto" || (odds != null && odds >= 300) || String(b.statFamily || "").toLowerCase().includes("ladder")
}

function isRbiStat(b) {
  const f = statFam(b)
  return f === "rbis" || f === "rbi" || f === "runsbattedin"
}

// ── Bucket hit rate grading ───────────────────────────────────────────────────

/**
 * Compute per-ecology-bucket hit rates.
 */
function gradeBuckets(bets) {
  const buckets = {}

  for (const bet of bets) {
    const key = ecoBucket(bet)
    if (!buckets[key]) buckets[key] = { total: 0, settled: 0, hits: 0 }
    buckets[key].total += 1
    const hit = isHit(bet)
    if (hit !== null) {
      buckets[key].settled += 1
      if (hit) buckets[key].hits += 1
    }
  }

  const result = {}
  for (const [key, data] of Object.entries(buckets)) {
    result[key] = {
      count: data.total,
      settled: data.settled,
      hits: data.hits,
      hitRate: data.settled > 0 ? round4(data.hits / data.settled) : null,
    }
  }
  return result
}

// ── HR ecology ────────────────────────────────────────────────────────────────

/**
 * HR ecology analysis.
 *
 * The signature failure mode this catches:
 *   30 HR candidates in pool → 0 HR slips built → multiple HR ladders hit
 *   → MAJOR FINDING: HR_ERUPTION_MISS
 */
function analyzeHrEcology(bets, slips, candidatePool) {
  const allBets = Array.isArray(bets) ? bets : []
  const allSlips = Array.isArray(slips) ? slips : []
  const allCandidates = Array.isArray(candidatePool) ? candidatePool : []

  // HR over bets tracked
  const hrOvers = allBets.filter((b) => isHrStat(b) && String(b.side || "").toLowerCase().startsWith("o"))

  // HR candidates in pool (from candidatePool OR from tracked bets if no separate pool)
  const hrCandidates = allCandidates.length > 0
    ? allCandidates.filter(isHrStat)
    : hrOvers  // fallback: tracked HR overs ARE the pool

  // HR legs that made it into slips
  const hrInSlips = []
  for (const slip of allSlips) {
    for (const leg of slip.legs || []) {
      if (isHrStat(leg)) hrInSlips.push(leg)
    }
  }

  // Build set of (player|stat) combos that were slipped
  const slippedKeys = new Set()
  for (const leg of hrInSlips) {
    slippedKeys.add(`${String(leg.player || "").toLowerCase()}|${statFam(leg)}`)
  }

  // HR overs that actually hit
  const hrHits = hrOvers.filter((b) => isHit(b) === true)

  // Suppressed HR winners: HR overs that hit but were NOT in any slip
  const suppressedHrWinners = hrHits.filter((b) => {
    const key = `${String(b.player || "").toLowerCase()}|${statFam(b)}`
    return !slippedKeys.has(key)
  })

  // MAJOR ALERT: HR eruption miss
  // Had candidates + ZERO slips + 2+ HR hits
  const hrEruptionMiss = hrCandidates.length > 0 && hrInSlips.length === 0 && hrHits.length >= 2

  const conversionRate = hrCandidates.length > 0
    ? round4(hrInSlips.length / hrCandidates.length)
    : null

  const hitRate = hrOvers.filter(isSettled).length > 0
    ? round4(hrHits.filter(isSettled).length / hrOvers.filter(isSettled).length)
    : null

  return {
    hrCandidates: hrCandidates.length,
    hrInSlips: hrInSlips.length,
    hrBetsTracked: hrOvers.length,
    hrHits: hrHits.length,
    hrConversionRate: conversionRate,
    hrHitRate: hitRate,
    suppressedHrWinners: suppressedHrWinners.length,
    hrEruptionMiss,
    majorFinding: hrEruptionMiss
      ? `HR_ERUPTION_MISS: ${hrCandidates.length} HR candidates in pool, ${hrInSlips.length} HR slips built, ${hrHits.length} HR over hits recorded`
      : suppressedHrWinners.length >= 2
        ? `HR_SUPPRESSION: ${suppressedHrWinners.length} HR winners in pool but not slipped`
        : null,
  }
}

// ── Ladder ecology ────────────────────────────────────────────────────────────

function analyzeLadderEcology(bets) {
  const ladderBets = bets.filter(isLadderBet)
  const settled = ladderBets.filter(isSettled)
  const hits = settled.filter((b) => isHit(b) === true)

  return {
    ladderCandidates: ladderBets.length,
    ladderSettled: settled.length,
    ladderHits: hits.length,
    ladderHitRate: settled.length > 0 ? round4(hits.length / settled.length) : null,
  }
}

// ── RBI chain ecology ─────────────────────────────────────────────────────────

function analyzeRbiChain(bets) {
  const rbiBets = bets.filter(isRbiStat)
  const settled = rbiBets.filter(isSettled)
  const hits = settled.filter((b) => isHit(b) === true)

  return {
    rbiChainCandidates: rbiBets.length,
    rbiChainSettled: settled.length,
    rbiChainHits: hits.length,
    rbiChainRate: settled.length > 0 ? round4(hits.length / settled.length) : null,
  }
}

// ── Suppression analysis ──────────────────────────────────────────────────────

/**
 * Identifies pool candidates NOT in any slip that resulted in a win.
 * These are the props that "should have survived ranking."
 * Threshold: edge >= 0.06 (meaningful edge, not noise).
 */
function analyzeSuppression(bets, slips) {
  const slippedKeys = new Set()
  for (const slip of slips || []) {
    for (const leg of slip.legs || []) {
      slippedKeys.add(`${String(leg.player || "").toLowerCase()}|${statFam(leg)}`)
    }
  }

  const suppressedWinners = []
  let suppressedTotal = 0

  for (const bet of bets) {
    const key = `${String(bet.player || "").toLowerCase()}|${statFam(bet)}`
    if (!slippedKeys.has(key)) {
      suppressedTotal += 1
      if (isHit(bet) === true && (num(bet.edge) || 0) >= 0.06) {
        suppressedWinners.push({
          player: bet.player,
          statFamily: bet.statFamily,
          side: bet.side,
          line: bet.line,
          odds: bet.odds,
          edge: bet.edge,
          tier: bet.tier,
          ecologyBucket: bet.ecologyBucket,
          result: bet.result,
          actualStat: bet.actualStat,
        })
      }
    }
  }

  return {
    suppressedWinners: suppressedWinners.length,
    suppressedTotal,
    suppressionMissRate: suppressedTotal > 0
      ? round4(suppressedWinners.length / suppressedTotal)
      : null,
    topSuppressedWinners: suppressedWinners
      .sort((a, b) => (num(b.edge) || 0) - (num(a.edge) || 0))
      .slice(0, 10),
  }
}

// ── Grading ───────────────────────────────────────────────────────────────────

function gradeEcology(buckets, hrAnalysis, suppressionAnalysis) {
  let score = 50  // neutral baseline

  // Anchor performance: should be our strongest bucket
  const anchorsHr = (
    buckets.anchors?.hitRate ??
    buckets["anchors"]?.hitRate ??
    null
  )
  if (anchorsHr != null) {
    if (anchorsHr >= 0.65) score += 20
    else if (anchorsHr >= 0.55) score += 10
    else if (anchorsHr < 0.40) score -= 15
  }

  // HR eruption miss is a major deduction
  if (hrAnalysis?.hrEruptionMiss) score -= 30
  else if (hrAnalysis?.suppressedHrWinners >= 3) score -= 15
  else if (hrAnalysis?.suppressedHrWinners >= 1) score -= 8

  // Suppression miss rate
  const smr = suppressionAnalysis?.suppressionMissRate
  if (smr != null) {
    if (smr > 0.20) score -= 12
    else if (smr > 0.12) score -= 6
  }

  // Tonight's best bucket
  const tnbHr = buckets["tonightsbest"]?.hitRate ?? buckets["tonight'sbest"]?.hitRate
  if (tnbHr != null && tnbHr >= 0.60) score += 10

  // AI slip performance bonus
  const aiHr = buckets["aislip"]?.hitRate ?? buckets["ai_slip"]?.hitRate
  if (aiHr != null && aiHr >= 0.60) score += 8

  score = Math.max(0, Math.min(100, score))
  const grade = score >= 78 ? "A" : score >= 62 ? "B" : score >= 46 ? "C" : score >= 30 ? "D" : "F"

  const findings = []
  if (hrAnalysis?.hrEruptionMiss) findings.push(hrAnalysis.majorFinding)
  if (hrAnalysis?.suppressedHrWinners >= 2 && !hrAnalysis.hrEruptionMiss)
    findings.push(hrAnalysis.majorFinding)
  if (anchorsHr != null && anchorsHr < 0.40) findings.push(`Anchor hit rate critically low: ${(anchorsHr * 100).toFixed(1)}%`)
  if (smr != null && smr > 0.20) findings.push(`High suppression miss rate: ${(smr * 100).toFixed(1)}% of filtered candidates won`)

  return {
    grade,
    score,
    findings,
    rationale: findings.join(" | ") || "Normal ecology performance",
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Grade the ecology for one (sport, date).
 *
 * @param {object} opts
 * @param {Array}  opts.bets          — tracked bets for the day
 * @param {Array}  opts.slips         — tracked slips for the day
 * @param {Array}  [opts.candidatePool] — full candidate pool (optional; defaults to bets)
 * @returns {object}
 */
function gradeEcologyForDay({ bets = [], slips = [], candidatePool = [] } = {}) {
  const buckets = gradeBuckets(bets)
  const hr = analyzeHrEcology(bets, slips, candidatePool)
  const ladder = analyzeLadderEcology(bets)
  const rbi = analyzeRbiChain(bets)
  const suppression = analyzeSuppression(bets, slips)
  const gradeResult = gradeEcology(buckets, hr, suppression)

  // Deduplicate: gradeResult.findings may overlap with hr.majorFinding
  const findingsSet = new Set([hr.majorFinding, ...gradeResult.findings].filter(Boolean))
  const majorFindings = Array.from(findingsSet)

  return {
    buckets,
    hr,
    ladder,
    rbi,
    suppression,
    grade: gradeResult,
    majorFindings,
  }
}

module.exports = {
  gradeEcologyForDay,
  gradeBuckets,
  analyzeHrEcology,
  analyzeLadderEcology,
  analyzeRbiChain,
  analyzeSuppression,
  gradeEcology,
}
