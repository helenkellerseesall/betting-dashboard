"use strict"

const { impliedProbability: impliedProbabilityFromOdds, computeEdge } = require("../utils/edge")
// Phase 1 — Context Ingestion V1.
// Wires the EXISTING (curated, non-synthetic) NBA matchup intelligence into the
// workstation modelProb path. Previously this layer was reachable only by the
// nightly nbaOpportunityCandidates path; the live /api/ws/state path consumed
// modelProb without it. Step-AN-1 populated `opponent` on snapshot rows, so
// the dormant DEFENSE_BY_ABBR table is now reachable here too.
const { computeMatchupAdjustmentFromRow } = require("./nbaMatchupIntelligence")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

function clamp01(n) {
  return clamp(0.001, 0.999, n)
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x))
}

// Session AN — Step 2: Synthetic-prior generators retained as no-ops.
// Previously these returned hash(player)/hash(eventId) → injected deterministic
// "variance" that masqueraded as predictive signal. Verified runtime evidence:
// usageRate / projectedMinutes / recentForm / assistRate / reboundRate /
// opponentDefenseVsPosition were ALL fallback-derived from these hashes on
// 100% of NBA snapshot rows (none of those fields are populated upstream).
//
// Returning 0 here removes the priors from every score path. We DO NOT delete
// the functions because they may have external importers; the contract is
// preserved (function still returns a finite number), but the value is
// honest: zero. Honest uncertainty, not synthetic confidence.
function playerPrior(_row) { return 0 }
function eventPrior(_row)  { return 0 }

function impliedProbabilityFromAmerican(odds) {
  if (!odds && odds !== 0) return null
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return null
  const imp = impliedProbabilityFromOdds(o)
  if (!Number.isFinite(imp) || imp <= 0 || imp >= 1) return null
  return imp
}

function nbaRowImpliedProbability(row) {
  if (!row || typeof row !== "object") return null
  const explicit = toNum(row.impliedProbability)
  if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit
  const fromOdds = impliedProbabilityFromAmerican(row.odds)
  if (Number.isFinite(fromOdds) && fromOdds > 0 && fromOdds < 1) return fromOdds
  return null
}

function propTypeLower(row) {
  return String(row?.propType || row?.marketKey || "").toLowerCase()
}

function classifyPropFamily(row) {
  const t = propTypeLower(row)
  if (/first\s*basket/.test(t)) return "special"
  if (/double\s*double|triple\s*double/.test(t)) return "special"
  if (/threes|three|3pt/.test(t)) return "threes"
  if (/pra|points.*rebounds.*assists/.test(t)) return "pra"
  if (/point/.test(t)) return "points"
  if (/rebound/.test(t)) return "rebounds"
  if (/assist/.test(t)) return "assists"
  return "other"
}

function isLadderRow(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const pv = String(row?.propVariant || "").toLowerCase()
  return mk.includes("alternate") || mk.includes("_alt") || (pv && pv !== "base" && pv !== "default")
}

function probabilityBandForFamily(family, row) {
  if (isLadderRow(row)) {
    if (family === "threes") return { min: 0.07, max: 0.63 }
    if (family === "pra") return { min: 0.07, max: 0.60 }
    return { min: 0.07, max: 0.61 }
  }
  switch (family) {
    case "points":
    case "rebounds":
    case "assists":
      return { min: 0.34, max: 0.65 }
    case "pra":
      return { min: 0.32, max: 0.67 }
    case "threes":
      return { min: 0.28, max: 0.71 }
    case "special":
      return { min: 0.03, max: 0.42 }
    default:
      return { min: 0.32, max: 0.67 }
  }
}

function lineAnchorByFamily(family) {
  if (family === "threes") return 1.8
  if (family === "assists") return 4.2
  if (family === "rebounds") return 6.0
  if (family === "pra") return 27.5
  if (family === "points") return 18.0
  if (family === "special") return 1.0
  return 10
}

function readSignal(row, keys, fallback = null) {
  for (const k of keys) {
    const n = toNum(row?.[k])
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function roleSignals(row, _family, _line, _anchor) {
  // Session AN — Step 2: All hash-derived synthetic fallbacks removed.
  // Each signal returns null when the row carries no real value. Downstream
  // scoring re-normalizes weights over PRESENT signals only — see
  // nbaIndependentBaseModelProbability. No synthetic confidence injected.
  return {
    usage:   readSignal(row, ["usageRate", "playerUsage", "usage", "roleUsagePct"], null),
    shots:   readSignal(row, ["shotAttempts", "fga", "fieldGoalAttempts", "shotVolume"], null),
    astRate: readSignal(row, ["assistRate", "astRate", "assistPct"], null),
    rebRate: readSignal(row, ["reboundRate", "rebRate", "reboundPct"], null),
    minutes: readSignal(row, ["projectedMinutes", "minutesProjection", "minutes", "expectedMinutes"], null),
    role:    readSignal(row, ["rotationRole", "starterFlag", "depthRole"], null),
  }
}

function contextSignals(row) {
  // Session AN — Step 2: hash-derived fallbacks removed. Each context signal
  // returns null when the row source is missing. spread/total ARE populated
  // on snapshot rows (3638/3638) so they remain real signals. pace and
  // opponentDefenseVsPosition are null until upstream pipelines provide them
  // (DEFENSE intelligence enters via nbaMatchupIntelligence, not this layer).
  const pace      = readSignal(row, ["pace", "projectedPace", "gamePace", "opponentPace"], null)
  const total     = readSignal(row, ["gameTotal", "total", "projectedTotal"], null)
  const spreadRaw = readSignal(row, ["spread", "gameSpread", "lineSpread"], null)
  const spread    = Number.isFinite(spreadRaw) ? Math.abs(spreadRaw) : null
  const blowoutRisk = Number.isFinite(spread) ? clamp(0, 1, spread / 16) : null
  const oppDef    = readSignal(row, ["opponentDefenseVsPosition", "oppDefenseVsPosition", "defenseVsPosition", "opponentDvP"], null)
  return { pace, total, spread, blowoutRisk, oppDef }
}

function recentFormSignal(row, line, anchor) {
  // Session AN — Step 2: hash-derived synthetic fallback removed.
  // Session AP — Recent Form V1: when row carries real recentForm with thin
  // sample_count, blend the rolling average toward the line proxy so a 2-game
  // sample contributes proportionally less than a 5-game sample. This is the
  // "influence not dominate" rule expressed mathematically — never a hot-streak
  // engine.
  //
  // recentForm shape (from nbaRecentFormCache.enrichRowWithRecentForm):
  //   { last5_avg, last10_avg, baseline, sample_count, days_since_last_game, source }
  //
  // Behaviour:
  //   - sample_count >= 5  → use last5_avg (or last10_avg) at full weight
  //   - sample_count 2-4   → blend toward formBase by (1 - sample_count/5)
  //   - sample_count < 2 OR no real recentForm → return null (honest "no signal")
  //
  // Field-shape compatibility: also reads bare `last5Avg` / `recentForm` numerics
  // for consumers that wired the field name directly.
  const rf = row && typeof row === "object" && row.recentForm && typeof row.recentForm === "object" ? row.recentForm : null
  const direct = readSignal(row, ["recentForm", "recentFormScore", "rollingAverage"], null)
  const recent = Number.isFinite(rf?.last5_avg) ? rf.last5_avg
               : Number.isFinite(rf?.last10_avg) ? rf.last10_avg
               : Number.isFinite(toNum(row?.last5Avg))  ? toNum(row.last5Avg)
               : Number.isFinite(toNum(row?.last10Avg)) ? toNum(row.last10Avg)
               : Number.isFinite(direct) ? direct
               : null
  if (!Number.isFinite(recent)) return null

  const sampleCount = Number(rf?.sample_count)
  const formBase = Number.isFinite(line) ? line : anchor
  if (Number.isFinite(sampleCount) && sampleCount < 5 && Number.isFinite(formBase)) {
    const quality = Math.max(0, Math.min(1, sampleCount / 5))
    // Blend recent toward formBase based on sample quality.
    return recent * quality + formBase * (1 - quality)
  }
  return recent
}

function ladderSeverity(row, family, anchor) {
  const line = toNum(row?.line)
  if (!Number.isFinite(line) || !isLadderRow(row) || family === "special") return 0
  let step = 1
  if (family === "points") step = 5
  else if (family === "pra") step = 5
  else if (family === "threes") step = 1
  else if (family === "rebounds" || family === "assists") step = 2
  return (line - anchor) / step
}

function familyScoreWeights(family) {
  if (family === "points") return { usage: 0.27, shots: 0.25, rate: 0.05, form: 0.25, ctx: 0.18 }
  if (family === "rebounds") return { usage: 0.08, shots: 0.05, rate: 0.28, form: 0.24, ctx: 0.18 }
  if (family === "assists") return { usage: 0.12, shots: 0.04, rate: 0.30, form: 0.24, ctx: 0.18 }
  if (family === "pra") return { usage: 0.20, shots: 0.14, rate: 0.17, form: 0.24, ctx: 0.19 }
  if (family === "threes") return { usage: 0.24, shots: 0.30, rate: 0.04, form: 0.23, ctx: 0.17 }
  return { usage: 0.16, shots: 0.16, rate: 0.16, form: 0.16, ctx: 0.16 }
}

function compressAroundMid(probability, family) {
  const p = clamp01(probability)
  const mid = 0.5
  const d = p - mid
  // points/rebounds/assists most compressed, threes least compressed.
  const factor =
    family === "points" || family === "rebounds" || family === "assists"
      ? 0.82
      : family === "pra"
      ? 0.86
      : family === "threes"
      ? 0.94
      : 0.84
  return clamp01(mid + d * factor)
}

// Session AN — Step 2 helper.
// Compute a weighted score over PRESENT signals only. Returns:
//   { score, weight_present, signals_present, signals_total }
// Each entry is (z|null, weight). null entries contribute 0 to score AND 0 to
// the present-weight denominator. Score is normalized: score / weight_present.
// If no signals present → score=0 → logistic(0)=0.5 → market-neutral baseline.
function honestWeightedScore(entries) {
  let num = 0
  let denom = 0
  let present = 0
  for (const [z, w] of entries) {
    if (Number.isFinite(z) && Number.isFinite(w) && w > 0) {
      num   += z * w
      denom += w
      present++
    }
  }
  return {
    score: denom > 0 ? num / denom : 0,
    weight_present: denom,
    signals_present: present,
    signals_total: entries.length,
  }
}

function nbaIndependentBaseModelProbability(row) {
  if (!row || typeof row !== "object") return null

  const family = classifyPropFamily(row)
  const anchor = lineAnchorByFamily(family)
  const line = toNum(row?.line)
  const { usage, shots, astRate, rebRate, minutes, role } = roleSignals(row, family, line, anchor)
  const { pace, total, spread, blowoutRisk, oppDef } = contextSignals(row)
  const recent = recentFormSignal(row, line, anchor)

  // Session AN — Step 2: each Z-score is null when its source signal is null.
  // No synthetic priors. No hash-derived fallbacks.
  const usageZ   = Number.isFinite(usage)   ? (usage - 22) / 9 : null
  const minutesZ = Number.isFinite(minutes) ? (minutes - 30) / 6 : null
  const shotsZ   = Number.isFinite(shots) && Number.isFinite(line || anchor)
                     ? (shots - (line || anchor) * 0.5) / Math.max(4, anchor * 0.35) : null
  const astZ     = Number.isFinite(astRate) ? (astRate - 0.18) / 0.08 : null
  const rebZ     = Number.isFinite(rebRate) ? (rebRate - 0.14) / 0.08 : null
  const formBase = Number.isFinite(line) ? line : anchor
  const formZ    = Number.isFinite(recent) && Number.isFinite(formBase)
                     ? (recent - formBase) / Math.max(2.5, anchor * 0.28) : null
  const paceZ    = Number.isFinite(pace)    ? (pace - 100) / 8 : null
  const totalZ   = Number.isFinite(total)   ? (total - 224) / 20 : null
  const spreadZ  = Number.isFinite(spread)  ? (5.5 - spread) / 8 : null
  const oppZ     = Number.isFinite(oppDef)  ? -oppDef / 10 : null
  const roleZ    = Number.isFinite(role)    ? (role - 1) / 2 : null

  const w = familyScoreWeights(family)
  // rateZ chooses the family-relevant rate; null when its source is null.
  const rateZ =
    family === "rebounds" ? rebZ :
    family === "assists"  ? astZ :
    family === "pra"      ? (Number.isFinite(astZ) && Number.isFinite(rebZ) ? (astZ + rebZ) / 2
                              : Number.isFinite(astZ) ? astZ
                              : Number.isFinite(rebZ) ? rebZ
                              : null)
    : null

  // Session AN — Step 2: Context bundle re-normalized over present sub-signals.
  const ctxBundle = honestWeightedScore([
    [paceZ,                        0.45],
    [totalZ,                       0.35],
    [spreadZ,                      0.20],
    [oppZ,                         0.35],
    [Number.isFinite(blowoutRisk) ? -blowoutRisk : null, 0.35],
    [roleZ,                        0.15],
  ])
  const ctxZ = ctxBundle.signals_present > 0 ? ctxBundle.score : null

  // Session AN — Step 2: Top-level score re-normalized over present primary signals.
  // playerPrior + eventPrior contributions REMOVED entirely (they were synthetic).
  const primaryBundle = honestWeightedScore([
    [usageZ,   w.usage],
    [shotsZ,   w.shots],
    [rateZ,    w.rate],
    [formZ,    w.form],
    [minutesZ, 0.26],
    [ctxZ,     w.ctx],
  ])
  let score = primaryBundle.score

  // Ladder penalty is real (alt-line away from anchor → lower hit rate).
  // Applied only when line is real and ladder severity is positive.
  const ladderZ = ladderSeverity(row, family, anchor)
  if (ladderZ > 0) {
    const ladderPenalty = family === "threes" ? 0.36 : family === "pra" ? 0.44 : 0.48
    score -= ladderZ * ladderPenalty
  }

  if (family === "special") {
    score = score * 0.55 - 0.95
  }

  const side = String(row?.side || "").toLowerCase()
  if (side === "under") score *= -1

  const p = logistic(score)
  const compressed = compressAroundMid(p, family)
  const band = probabilityBandForFamily(family, row)
  return clamp(band.min, band.max, compressed)
}

function nbaRowIndependentModelProbability(row) {
  const modelProb = nbaIndependentBaseModelProbability(row)
  if (!Number.isFinite(modelProb)) return null

  const implied = nbaRowImpliedProbability(row)
  if (!Number.isFinite(implied)) return clamp01(modelProb)

  const family = classifyPropFamily(row)
  // Market-anchored shrink: keep sign/differentiation but compress alpha.
  const alpha =
    family === "threes"
      ? 0.92 // threes keeps comparatively wider variance
      : family === "pra"
      ? 0.88
      : family === "points"
      ? 0.84
      : family === "rebounds" || family === "assists"
      ? 0.82
      : 0.80
  // Session AN — Step 2: Removed systematic +0.015 upward recenter.
  // That bias claimed every NBA prop was 1.5pp more likely than market —
  // the single largest source of fake "edge" in the prediction core.
  // Now: market-anchored compression with no synthetic shift. Edge will
  // appear ONLY when present real signals push modelProb above implied.
  const compressedToMarket = implied + (modelProb - implied) * alpha

  // Phase 1 — Teammate Context V1 (Session AS): bounded redistribution shift.
  // nbaTeammateContextDeriver.enrichRowWithTeammateContext sets
  // row.teammateRedistShift in probability units (signed, capped ±0.030 pp).
  // The shift composes alongside the matchup adjustment below — both are
  // bounded, sample-quality dampened, and side-aware in their setters.
  // No-op when row carries no teammate context (honest scarcity).
  let teammateShift = 0
  if (Number.isFinite(row?.teammateRedistShift)) teammateShift = row.teammateRedistShift

  // Phase 1 — Market + News Adaptation V1 (Session AT): bounded multi-book
  // consensus shift. nbaMarketContextDeriver.enrichRowWithMarketContext sets
  // row.marketShift in probability units (signed, capped ±0.020 pp). When
  // consensus across books implies a HIGHER probability for the bettor's
  // side than this book's price (delta < 0), the shift is positive
  // (consensus confirmation). When this book is OVERPRICING relative to
  // consensus, the shift is negative (market caution).
  // Smaller cap than teammate's 3pp because multi-book signal is noisier.
  // No-op when row's prop has only one book quoting it.
  let marketShift = 0
  if (Number.isFinite(row?.marketShift)) marketShift = row.marketShift

  // Phase 1 — Live Injury + Availability V1 (Session AV): bounded
  // availability shift. nbaAvailabilityCache.enrichRowWithAvailability sets
  // row.availabilityShift in probability units (signed, capped ±0.020 pp).
  // "out" / "doubtful" / "questionable" suppress over-side modelProb (and
  // boost under by sign-inversion); "probable" small boost; "active" /
  // "unknown" → 0. Honest 0 when player not in cache (no fabricated status).
  let availabilityShift = 0
  if (Number.isFinite(row?.availabilityShift)) availabilityShift = row.availabilityShift

  // Phase 1 — Context Ingestion V1: REAL contextual matchup adjustment.
  // computeMatchupAdjustmentFromRow returns:
  //   { adj, opponent, defensePart, pacePart, totalPart }
  // - adj is bullish for the OFFENSIVE outcome (over). Range capped ±0.06.
  // - defensePart is non-zero ONLY when row.opponent resolves to a known team
  //   in DEFENSE_BY_ABBR (i.e., REAL opponent intelligence — no synthetic
  //   fallback; null opponent → defensePart = 0).
  // - totalPart fires from real gameTotal (100% of snapshot rows).
  // - pacePart fires from row.pace (currently 0% — honest 0 contribution).
  // For "under" props, the offensive adjustment inverts: tough defense
  // suppresses overs ⇒ boosts unders; favorable matchup boosts overs ⇒
  // suppresses unders.
  let matchupShift = 0
  try {
    const m = computeMatchupAdjustmentFromRow(row)
    if (m && Number.isFinite(m.adj)) {
      const side = String(row?.side || "").toLowerCase()
      matchupShift = side === "under" ? -m.adj : m.adj
    }
  } catch (_) {
    matchupShift = 0
  }

  const withMatchup = compressedToMarket + matchupShift + teammateShift + marketShift + availabilityShift
  const band = probabilityBandForFamily(family, row)
  return clamp01(clamp(band.min, band.max, withMatchup))
}

/**
 * Phase 1 — Context Ingestion V1.
 * Public traceability wrapper: returns the itemized contextual adjustments
 * that were applied inside nbaRowIndependentModelProbability for this row.
 * Returns null when no row. defensePart=0 when opponent is unresolved (honest
 * "no defense intelligence available" — never invented).
 *
 * @returns {{ adj, opponent, defensePart, pacePart, totalPart, sideAware } | null}
 */
function nbaRowMatchupContext(row) {
  if (!row || typeof row !== "object") return null
  let m
  try {
    m = computeMatchupAdjustmentFromRow(row)
  } catch (_) { return null }
  if (!m || !Number.isFinite(m.adj)) return null
  const side = String(row?.side || "").toLowerCase()
  return {
    adj: m.adj,
    opponent: m.opponent || null,
    defensePart: m.defensePart || 0,
    pacePart: m.pacePart || 0,
    totalPart: m.totalPart || 0,
    sideAware: side === "under" ? -m.adj : m.adj,
  }
}

function nbaRowModelProbabilityCore(row) {
  if (!row || typeof row !== "object") return null

  const independent = nbaRowIndependentModelProbability(row)
  if (Number.isFinite(independent)) return independent

  const candidates = [
    row.modelProbability,
    row.predictedProbability,
    row.predictedProb,
    row.calibratedProbability,
    row.playerConfidenceScore,
    row.adjustedConfidenceScore,
  ]
  for (const c of candidates) {
    const n = toNum(c)
    if (Number.isFinite(n)) return clamp01(n)
  }
  return null
}

function nbaRowModelProbability(row) {
  return nbaRowModelProbabilityCore(row)
}

function nbaRowEdge(row) {
  if (!row || typeof row !== "object") return null
  const prob = Number.isFinite(Number(row.probability)) ? Number(row.probability) : nbaRowModelProbabilityCore(row)
  if (!Number.isFinite(prob)) return null
  const e = computeEdge(prob, row.odds)
  return Number.isFinite(e) ? e : null
}

function nbaRowLadderLabel(row) {
  const pv = String(row?.propVariant || row?.ladderVariant || "").trim()
  const pt = String(row?.propType || "").trim()
  const line = row?.line
  if (pv && pv !== "base" && pv !== "default") return pv
  if (pt && line != null && String(line).trim() !== "") return `${pt} ${line}`
  return pt || "ladder"
}

module.exports = {
  nbaRowImpliedProbability,
  nbaRowIndependentModelProbability,
  nbaRowModelProbabilityCore,
  nbaRowModelProbability,
  nbaRowMatchupContext,        // Phase 1 — Context Ingestion V1
  nbaRowEdge,
  nbaRowLadderLabel,
}
