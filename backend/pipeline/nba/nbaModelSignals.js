"use strict"

const { impliedProbability: impliedProbabilityFromOdds, computeEdge } = require("../utils/edge")
// Phase 1 — Context Ingestion V1.
// Wires the EXISTING (curated, non-synthetic) NBA matchup intelligence into the
// workstation modelProb path. Previously this layer was reachable only by the
// nightly nbaOpportunityCandidates path; the live /api/ws/state path consumed
// modelProb without it. Step-AN-1 populated `opponent` on snapshot rows, so
// the dormant DEFENSE_BY_ABBR table is now reachable here too.
const { computeMatchupAdjustmentFromRow } = require("./nbaMatchupIntelligence")

// ─────────────────────────────────────────────────────────────────────────────
// 2026-05-23 — Lane 5 cognition trace (diagnostic, disabled by default).
//
// Set NBA_TRACE=1 in env to enable. When on, every call to
// nbaRowIndependentModelProbability appends one JSON line to
// backend/runtime/cognition_trace.jsonl containing the full intermediate
// state of the prediction pipeline (which signals fired, Z-scores, baseProb,
// market shrinkage, shifts, final). The file is truncated on module load so
// it only contains the most recent process's traces.
//
// Wrapped in try/catch — trace failure NEVER affects model output. Off by
// default so production runs aren't burdened with sync I/O.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require("fs")
const path = require("path")
const TRACE_ENABLED = process.env.NBA_TRACE === "1"
const TRACE_PATH = path.join(__dirname, "..", "..", "runtime", "cognition_trace.jsonl")
const TRACE_MAX_BYTES = 5 * 1024 * 1024  // 5MB cap. After many refreshes the
// file grew to 440MB once; GitHub rejected the push. Now self-truncates when
// it crosses the cap so the file stays bounded forever, regardless of how
// long the backend runs with NBA_TRACE=1.
if (TRACE_ENABLED) {
  try {
    fs.mkdirSync(path.dirname(TRACE_PATH), { recursive: true })
    fs.writeFileSync(TRACE_PATH, "")   // truncate at process start
    console.log(`[nba-trace] cognition trace enabled → ${TRACE_PATH} (max ${TRACE_MAX_BYTES/1024/1024}MB)`)
  } catch (_) { /* silent */ }
}
let _traceCheckCounter = 0
function _traceRow(entry) {
  if (!TRACE_ENABLED) return
  try {
    fs.appendFileSync(TRACE_PATH, JSON.stringify(entry, (k, v) => v === undefined ? null : v) + "\n")
    // Check file size every 200 writes (cheap stat call). When over cap,
    // truncate and start fresh. Keeps the latest data only.
    if (++_traceCheckCounter >= 200) {
      _traceCheckCounter = 0
      try {
        const stat = fs.statSync(TRACE_PATH)
        if (stat.size > TRACE_MAX_BYTES) {
          fs.writeFileSync(TRACE_PATH, "")
          console.log(`[nba-trace] file exceeded ${TRACE_MAX_BYTES/1024/1024}MB cap — truncated`)
        }
      } catch (_) { /* silent */ }
    }
  } catch (_) { /* silent */ }
}
// Trace-only numeric coercion that preserves null (unlike module-internal
// toNum which uses Number(null)===0 → 0). Use this in trace payloads.
function _traceNum(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

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
  // 2026-05-26 — Lane A1: DD/TD become first-class modeled families with
  // hit-rate logic instead of the generic flat-band `special` treatment.
  // ORDER MATTERS: triple_double check first because "triple_double" string
  // also contains "double" — regex order avoids false-classifying TD as DD.
  if (/triple[_\s-]*double/.test(t)) return "triple_double"
  if (/double[_\s-]*double/.test(t)) return "double_double"
  // 2026-05-26 — Lane A2: steals/blocks/turnovers as first-class families.
  // Continuous low-volume stats — clone threes-style modeling.
  if (/steals/.test(t)) return "steals"
  if (/blocks/.test(t)) return "blocks"
  if (/turnover/.test(t)) return "turnovers"
  if (/threes|three|3pt/.test(t)) return "threes"
  // 2026-05-25 — CRITICAL ORDERING. The old `if (/point/) return "points"`
  // caught combo props ("Points + Rebounds", "Points + Assists") because
  // they contain "point". Result: cognition treated KAT P+R 28.5 as pure
  // Points, compared his 10-pt L5 against the 28.5 line (false fade),
  // sigma calc wrong, model prob garbage. Triple-combo PRA first, then
  // two-stat combos (route to "pra" family for sigma/projection math
  // since they behave more like PRA than pure-points), then singles.
  if (/pra|points.*rebounds.*assists/.test(t)) return "pra"
  if (/points.*rebounds|points\s*\+\s*rebounds/.test(t)) return "pra"
  if (/points.*assists|points\s*\+\s*assists/.test(t)) return "pra"
  if (/rebounds.*assists|rebounds\s*\+\s*assists/.test(t)) return "pra"
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
    if (family === "threes") return { min: 0.05, max: 0.75 }
    if (family === "pra") return { min: 0.05, max: 0.72 }
    return { min: 0.05, max: 0.75 }
  }
  // 2026-05-24 — Lane 5 arithmetic fix. Widened bands from [0.34, 0.65]
  // (points/rebounds/assists) to [0.15, 0.85]. The narrow band guaranteed
  // every long-odds pick (+250+) auto-generated +5-10pp "edge" purely from
  // the band floor regardless of signal. With wider bands the model can
  // produce honest low probabilities (e.g. 18% over an inflated line for a
  // star averaging well below it) and the edge claim disappears when the
  // data agrees with the market.
  switch (family) {
    case "points":
    case "rebounds":
    case "assists":
      return { min: 0.15, max: 0.85 }
    case "pra":
      return { min: 0.12, max: 0.82 }
    case "threes":
      return { min: 0.10, max: 0.85 }
    case "double_double":
      // Binary event. Floor is honest — a player can genuinely have ~5% DD
      // probability if minutes / role suggest it's near-impossible. Ceiling
      // 0.80 because elite bigs (Jokic, Sabonis) reliably DD ~85% of games.
      return { min: 0.05, max: 0.80 }
    case "triple_double":
      // Rare event. Even elite triple-double threats (Jokic, LBJ in his
      // prime) sit around 30-35% per game. Ceiling enforced so the model
      // can't claim ELITE on a +1500 longshot via band floor alone.
      return { min: 0.02, max: 0.35 }
    case "steals":
    case "blocks":
    case "turnovers":
      // 2026-05-26 — Lane A2: Low-volume continuous stats. Bands match threes
      // shape ([0.10, 0.85]) since they share the same low-volume profile
      // (typical lines 0.5-3.5, like threes 1.5-3.5).
      return { min: 0.10, max: 0.85 }
    case "special":
      return { min: 0.03, max: 0.42 }
    default:
      return { min: 0.15, max: 0.85 }
  }
}

function lineAnchorByFamily(family) {
  if (family === "threes") return 1.8
  if (family === "assists") return 4.2
  if (family === "rebounds") return 6.0
  if (family === "pra") return 27.5
  if (family === "points") return 18.0
  // 2026-06-01 Phase Composite-Variance-Fix-1A note (#130) — 2-stat composites
  // (points_assists, points_rebounds, rebounds_assists) are deliberately
  // collapsed to the "pra" family upstream by classifyPropFamily for this
  // base-scorer path. No composite-specific anchors are needed here — they
  // unreachable in this function. The composite-variance fix lives in
  // buildNbaBestBetsBoard.js (production sigma path), not here.
  // Binary props: line is always 0.5 ("over 0.5" = yes), but we use 0.5
  // as anchor so projections don't mis-scale. Hit-rate math is line-free.
  if (family === "double_double") return 0.5
  if (family === "triple_double") return 0.5
  // 2026-05-26 — Lane A2: low-volume continuous stats. Anchors based on
  // typical NBA per-game averages: steals ~1.0, blocks ~0.6, turnovers ~2.0.
  if (family === "steals")    return 1.0
  if (family === "blocks")    return 0.6
  if (family === "turnovers") return 2.0
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
    shots:   readSignal(row, ["shotAttempts", "fga", "fieldGoalAttempts", "shotVolume", "shots", "avgFga"], null),
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
  const oppDef    = readSignal(row, ["opponentDefenseVsPosition", "oppDefenseVsPosition", "defenseVsPosition", "opponentDvP", "oppDef", "oppDefRating", "defensiveRating"], null)
  return { pace, total, spread, blowoutRisk, oppDef }
}

/**
 * 2026-05-26 — Family-specific opponent defense.
 *
 * The legacy `oppDef` signal is generic team defensive rating (PPG-allowed).
 * For a THREES prop, what matters is opp 3PM-allowed per game. For REBOUNDS,
 * opp REB-allowed. For ASSISTS, opp AST-allowed. Using generic PPG for all
 * three is the "half-blind" problem the operator called out — the model
 * SHOWS the right stat on the card but doesn't USE it in the probability.
 *
 * Returns a Z-score on the same scale as `oppZ` (positive = defense allows
 * MORE → OVER-favorable). Null when the per-stat opp-allowed isn't
 * populated on the row (e.g. opponentStats absent), in which case the
 * caller falls back to the generic oppZ.
 *
 * Centering values are NBA-league rough averages; std dev is tuned so a
 * z-score of ~1 means "noticeably above league". These are calibrated
 * against the existing oppZ scale (`-oppDef / 10`) so the model weights
 * remain valid.
 */
function familySpecificOppZ(row, family) {
  const os = row?.opponentStats
  if (!os || typeof os !== "object") return null
  const num = (k) => {
    const v = Number(os[k])
    return Number.isFinite(v) ? v : null
  }
  if (family === "threes") {
    const v = num("threePMAllowed")
    if (v == null) return null
    // League avg ~12 3PM/g allowed, std ~1.8. Higher = friendlier to OVER.
    return (v - 12) / 1.8
  }
  if (family === "rebounds") {
    const v = num("reboundsAllowed")
    if (v == null) return null
    // League avg ~43 reb/g allowed, std ~2.5.
    return (v - 43) / 2.5
  }
  if (family === "assists") {
    const v = num("assistsAllowed")
    if (v == null) return null
    // League avg ~25 ast/g allowed, std ~2.5.
    return (v - 25) / 2.5
  }
  if (family === "pra") {
    // Blend: threes don't matter for PRA but reb + ast + (points implicit via
    // pointsAllowed) all do. Use rebs+asts average when both present.
    const r = num("reboundsAllowed")
    const a = num("assistsAllowed")
    const rZ = Number.isFinite(r) ? (r - 43) / 2.5 : null
    const aZ = Number.isFinite(a) ? (a - 25) / 2.5 : null
    if (rZ != null && aZ != null) return (rZ + aZ) / 2
    return rZ ?? aZ
  }
  // Points + special → null; caller keeps generic oppZ (which IS PPG-allowed).
  return null
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
  // 2026-05-24 — Lane 5 arithmetic fix. Form (recent L5/L10) was 0.24-0.25
  // — same weight as usage and shots. For stars with constant high usage
  // and minutes, those signals always pushed the score positive regardless
  // of whether the line was achievable, swamping the form signal saying
  // "no, the player averages well below this line."
  //
  // Fix: form is now the DOMINANT signal at 0.50. Usage drops to 0.12,
  // minutes drops to 0.14, ctx/shots scaled to fit. Net intuition: when
  // a player's recent average is far from the line, that fact alone should
  // determine the direction; usage/role contextualize the magnitude.
  if (family === "points") return { usage: 0.12, shots: 0.15, rate: 0.05, form: 0.50, ctx: 0.18 }
  if (family === "rebounds") return { usage: 0.06, shots: 0.04, rate: 0.16, form: 0.55, ctx: 0.19 }
  if (family === "assists") return { usage: 0.08, shots: 0.03, rate: 0.18, form: 0.55, ctx: 0.16 }
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

  // 2026-05-24 — Phase 2 enrichment was bypassed when callers hit base directly
  // (fetchNbaOddsSnapshot, nbaOpportunityCandidates, nbaRowIndependentModelProbability).
  // Trace verifier proved oppDef/pace/shots/astRate/rebRate = 0% reaching base.
  // _ensureEnriched is idempotent and short-circuits when fields are already set,
  // so calling it here is safe even when upstream already enriched.
  _ensureEnriched(row)

  const family = classifyPropFamily(row)
  const anchor = lineAnchorByFamily(family)
  const line = toNum(row?.line)

  // 2026-05-26 — Lane A1: Binary-event families (double_double, triple_double)
  // skip the z-score/logistic pipeline entirely. Their probability comes from
  // recent hit-rate, not from "is L5 above the 0.5 line." The hit rate is
  // computed up-front by enrichNbaRowWithBinaryHitRates (stamped on the row).
  // Early return short-circuits the rest of the scorer for these families.
  if (family === "double_double" || family === "triple_double") {
    const hr5  = toNum(row?.[`${family === "double_double" ? "dd" : "td"}HitRateL5`])
    const hr10 = toNum(row?.[`${family === "double_double" ? "dd" : "td"}HitRateL10`])
    const seasonHr = toNum(row?.[`${family === "double_double" ? "dd" : "td"}HitRateSeason`])
    // Honest null when no hit-rate info — model can't have an opinion.
    if (!Number.isFinite(hr5) && !Number.isFinite(hr10) && !Number.isFinite(seasonHr)) {
      // Fall back to band midpoint (0.4 for DD, 0.15 for TD) so picks don't
      // get random fake edge from the floor.
      const fallback = family === "double_double" ? 0.40 : 0.12
      return fallback
    }
    // Blended hit rate: L5 weighted heaviest (recent form), then L10, then
    // season. If only one is present, use it directly.
    const parts = []
    if (Number.isFinite(hr5))     parts.push([hr5,     0.55])
    if (Number.isFinite(hr10))    parts.push([hr10,    0.30])
    if (Number.isFinite(seasonHr)) parts.push([seasonHr, 0.15])
    const num   = parts.reduce((a, [v, w]) => a + v * w, 0)
    const denom = parts.reduce((a, [, w]) => a + w, 0)
    let prob = denom > 0 ? num / denom : (family === "double_double" ? 0.40 : 0.12)

    // Minor matchup adjustment for binary events:
    //   - high game pace + high total → more counting stats → more DD/TD
    //   - large blowout spread → garbage time / early benching → fewer
    // Capped ±0.05 prob units so the matchup signal is influence-not-dominate.
    const paceVal  = toNum(row?.pace)
    const totalVal = toNum(row?.gameTotal ?? row?.total)
    const spreadVal = toNum(row?.gameSpread ?? row?.spread)
    let matchupAdj = 0
    if (Number.isFinite(paceVal))  matchupAdj += (paceVal - 100) / 100 * 0.04    // +/-0.04 typical range
    if (Number.isFinite(totalVal)) matchupAdj += (totalVal - 224) / 224 * 0.03   // +/-0.03 typical
    if (Number.isFinite(spreadVal)) matchupAdj -= Math.min(0.04, Math.abs(spreadVal) / 20 * 0.04)
    matchupAdj = Math.max(-0.05, Math.min(0.05, matchupAdj))
    prob = prob + matchupAdj

    // Side handling: "yes" / "over" → as-is. "no" / "under" → 1 - prob.
    // The market convention for DD/TD is OVER 0.5 = yes.
    const side = String(row?.side || "").toLowerCase()
    if (side === "under" || side === "no") prob = 1 - prob

    // Clamp to family band.
    const band = probabilityBandForFamily(family, row)
    return Math.max(band.min, Math.min(band.max, prob))
  }

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
  // 2026-05-26 — Family-specific defensive Z replaces generic PPG-allowed for
  // threes / rebounds / assists / pra. Falls back to generic oppDef for
  // points / special where PPG-allowed remains the right dimension. The
  // family-specific scale is calibrated to match the generic scale so the
  // downstream weight (0.35 in ctxBundle below) doesn't need re-tuning.
  const oppZFamily = familySpecificOppZ(row, family)
  const oppZGeneric = Number.isFinite(oppDef) ? -oppDef / 10 : null
  const oppZ     = oppZFamily != null ? oppZFamily : oppZGeneric
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
  const scoreBeforeInv = score
  if (side === "under") score *= -1

  const p = logistic(score)
  const compressed = compressAroundMid(p, family)
  const band = probabilityBandForFamily(family, row)
  const baseOut = clamp(band.min, band.max, compressed)

  // 2026-05-23 — Lane 5 base-cognition trace. Captures the raw signals + Z-scores
  // BEFORE the wrapper applies market shrinkage. Only fires when NBA_TRACE=1.
  // This is the definitive answer to "does the model actually see signals at runtime?"
  if (TRACE_ENABLED) {
    _traceRow({
      __layer: "base",
      ts: new Date().toISOString(),
      id: {
        player: row.player,
        family,
        side,
        line:   _traceNum(row.line),
      },
      rawSignals: {
        usage: _traceNum(usage), shots: _traceNum(shots), astRate: _traceNum(astRate),
        rebRate: _traceNum(rebRate), minutes: _traceNum(minutes), role: _traceNum(role),
        pace: _traceNum(pace), total: _traceNum(total), spread: _traceNum(spread),
        oppDef: _traceNum(oppDef), blowoutRisk: _traceNum(blowoutRisk),
        recent: _traceNum(recent), anchor: _traceNum(anchor),
      },
      zScores: {
        usageZ: _traceNum(usageZ), shotsZ: _traceNum(shotsZ), formZ: _traceNum(formZ),
        minutesZ: _traceNum(minutesZ), astZ: _traceNum(astZ), rebZ: _traceNum(rebZ),
        paceZ: _traceNum(paceZ), totalZ: _traceNum(totalZ), spreadZ: _traceNum(spreadZ),
        oppZ: _traceNum(oppZ), roleZ: _traceNum(roleZ), ctxZ: _traceNum(ctxZ),
      },
      weights: w,
      bundle: {
        primaryScore: toNum(primaryBundle.score),
        primarySignalsPresent: primaryBundle.signals_present,
        primarySignalsTotal: primaryBundle.signals_total,
        ctxSignalsPresent: ctxBundle.signals_present,
      },
      ladder: { severity: toNum(ladderZ) },
      scoreSteps: {
        beforeSideInversion: toNum(scoreBeforeInv),
        afterSideInversion: toNum(score),
      },
      baseProbSteps: {
        logisticOfScore: toNum(p),
        afterCompression: toNum(compressed),
        baseFinal: toNum(baseOut),
      },
    })
  }

  return baseOut
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
  const final = clamp01(clamp(band.min, band.max, withMatchup))

  // 2026-05-23 — Lane 5 trace. Captures the full state of this call so post-hoc
  // inspection can answer: are signals actually present at runtime?
  // No-op when NBA_TRACE !== "1".
  if (TRACE_ENABLED) {
    _traceRow({
      ts: new Date().toISOString(),
      id: {
        player:     row.player,
        family,
        side:       String(row?.side || "").toLowerCase(),
        line:       toNum(row.line),
        odds:       toNum(row.oddsAmerican ?? row.odds),
        book:       row.sportsbook || row.book || null,
        eventId:    row.eventId || null,
      },
      enriched: {
        recentForm:           row.recentForm || null,
        starterFlag:          row.starterFlag ?? null,
        projectedMinutes:     row.projectedMinutes ?? null,
        ceilingScore:         row.ceilingScore ?? null,
        playerStatus:         row.playerStatus || null,
        opponent:             row.opponent || null,
        teammateRedistShift:  _traceNum(row.teammateRedistShift),
        marketShift:          _traceNum(row.marketShift),
        availabilityShift:    _traceNum(row.availabilityShift),
      },
      probs: {
        implied:                 _traceNum(implied),
        baseModel:               _traceNum(modelProb),
        afterMarketShrink:       _traceNum(compressedToMarket),
        afterShifts:             _traceNum(withMatchup),
        final:                   _traceNum(final),
      },
      shifts: {
        matchup:        _traceNum(matchupShift),
        teammate:       _traceNum(teammateShift),
        market:         _traceNum(marketShift),
        availability:   _traceNum(availabilityShift),
      },
      alpha,
      band,
    })
  }

  return final
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

// ─────────────────────────────────────────────────────────────────────────────
// 2026-05-23 — Lane 5 ENRICHMENT WRAPPER.
//
// Trace diagnostic (3,951 rows on 2026-05-23) revealed cognition was running
// with critical signals missing because not every caller of nbaRowModelProbability
// applied the enrichers first. workstationRoutes.js DID enrich; nbaIsolatedRoutes
// and buildNbaBoardSlicesFromSnapshot did NOT. Result: recentForm present in
// only 22% of rows, shots/astRate/rebRate/oppDef in 0%.
//
// Fix: apply enrichers inside nbaRowModelProbability so EVERY caller gets a
// fully-enriched row by default. Enrichers are documented as no-ops when source
// data is missing OR when the row already has the enriched fields, so calling
// from the already-enriched workstationRoutes path is safe (idempotent).
//
// Lazy require (in-function, try/catch) so a missing enricher module doesn't
// break the cognition fallback chain. Cached after first load.
// ─────────────────────────────────────────────────────────────────────────────
let _enrichers = null
function _loadEnrichers() {
  if (_enrichers) return _enrichers
  _enrichers = {}
  try { _enrichers.recentForm = require("./nbaRecentFormCache").enrichRowWithRecentForm } catch (_) {}
  // 2026-05-26 — Lane A1: binary-event (DD/TD) hit-rate enricher.
  try { _enrichers.binaryHitRates = require("./nbaRecentFormCache").enrichRowWithBinaryHitRates } catch (_) {}
  try { _enrichers.roleContext = require("./nbaRoleContextDeriver").enrichRowWithRoleContext } catch (_) {}
  try { _enrichers.availability = require("./nbaAvailabilityCache").enrichRowWithAvailability } catch (_) {}
  // 2026-05-24 — Phase 2 data layers. Opponent team stats + player season-rate stats.
  // Each enricher is per-row, no slate prerequisite, no-op when source missing.
  try { _enrichers.teamStats = require("./nbaTeamStatsCache").enrichRowWithTeamStats } catch (_) {}
  try { _enrichers.playerSeasonStats = require("./nbaPlayerSeasonStatsCache").enrichRowWithPlayerSeasonStats } catch (_) {}
  return _enrichers
}

function _ensureEnriched(row) {
  if (!row || typeof row !== "object") return row
  const e = _loadEnrichers()
  // Each is a per-row, no-prerequisite enricher that mutates row in place
  // and is a no-op when source data is unavailable.
  try { if (e.recentForm && !row.recentForm) e.recentForm(row) } catch (_) {}
  // 2026-05-26 — Lane A1: DD/TD hit rates. Idempotent — short-circuits if
  // either ddHitRateL5 or tdHitRateL5 is already finite on the row.
  try { if (e.binaryHitRates) e.binaryHitRates(row) } catch (_) {}
  try { if (e.roleContext && row.starterFlag == null) e.roleContext(row) } catch (_) {}
  try { if (e.availability && !row.playerStatus) e.availability(row) } catch (_) {}
  // 2026-05-24 — Phase 2: team stats (oppDef, pace, opp-allowed) + player season
  // stats (shots, astRate, rebRate, usage). Apply when source data is missing
  // on the row. Idempotent — won't clobber upstream enrichment.
  try { if (e.teamStats         && (row.oppDef == null || row.opponentStats == null)) e.teamStats(row) } catch (_) {}
  try { if (e.playerSeasonStats && (row.shots == null || row.astRate == null || row.rebRate == null)) e.playerSeasonStats(row) } catch (_) {}
  return row
}

function nbaRowModelProbability(row) {
  // 2026-05-23: ensure enrichment before cognition. Without this, callers
  // outside workstationRoutes (nbaIsolatedRoutes, buildNbaBoardSlices, etc.)
  // hit the cognition with missing recentForm / role / availability signals.
  _ensureEnriched(row)
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
  nbaIndependentBaseModelProbability,
  // 2026-05-23 — Lane 5 decomposition diagnostic. Exported so inspectNbaPick
  // can dump intermediate values without re-implementing the score path.
  _diag: {
    classifyPropFamily,
    lineAnchorByFamily,
    roleSignals,
    contextSignals,
    recentFormSignal,
    honestWeightedScore,
    familyScoreWeights,
    logistic,
    compressAroundMid,
    probabilityBandForFamily,
    ladderSeverity,
  },
}
