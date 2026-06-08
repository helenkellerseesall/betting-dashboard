"use strict"

/**
 * nbaTierClassifier — CANONICAL tier classification for NBA props.
 *
 * 2026-05-24 — Created to eliminate shadow authority. Prior to this file,
 * five separate code paths each had their own tier-assignment logic with
 * different rules:
 *   1. backend/pipeline/nba/buildNbaBestBetsBoard.js  (tierForPlay)
 *   2. backend/pipeline/nba/fetchNbaOddsSnapshot.js   (inline edge-only)
 *   3. backend/http/nbaIsolatedRoutes.js              (inline edge-only)
 *   4. backend/routes/workstationRoutes.js            (inline edge-only)
 *   5. backend/pipeline/nba/buildNbaPerformanceTracking.js (passthrough)
 *
 * Operator-caught problem: paths #3 and #4 stamped tier purely from edge
 * magnitude. Any long-odds prop (+250+) → high edge → ELITE, regardless of
 * whether the model actually had conviction. Stars on inflated alt-lines
 * got automatic +20pp "ELITE" ratings even when modelProb was ~0.488
 * (essentially a coin flip).
 *
 * This module is the SINGLE SOURCE OF TRUTH. All five callers must import
 * classifyNbaTier() and pass through it. Any future tier addition adds a
 * test case here, not a parallel inline formula.
 *
 * Rules:
 *   - ev <= 0                                           → FADE
 *   - edge < 0.03                                       → FADE
 *   - modelProb conviction < 0.03 (|prob-0.5| < 0.03)   → FADE (no opinion)
 *   - modelProb conviction < 0.08                       → PLAYABLE (low conviction)
 *   - edge >= 0.12                                      → ELITE
 *   - edge >= 0.07                                      → STRONG
 *   - edge >= 0.04                                      → PLAYABLE
 *   - else                                              → LONGSHOT
 *
 * Inputs that are missing (NaN/undefined) are treated as "no info" — the
 * function still produces a tier from whatever signals are available.
 */

/**
 * 2026-06-07 — F1.2a bucket-detection plumbing. bucketForOdds maps American
 * odds → the SAME six odds buckets the F1.1 anti-selection probe used
 * (.scratch/probe_f11_deduped_vig_aware.txt). F1.1 located two per-bucket
 * pathologies (ELITE toxic in pickem/mid-dog; FADE wins 69% at mid-fav).
 * 2026-06-07 — F1.2b makes the bucket consequential: P1-A (ELITE→STRONG
 * demotion in pickem/mid-dog) + P2-C (model-backed-under exemption from the
 * form-contradiction FADE at mid-fav). Both behind NBA_BUCKET_TIER_POLICY.
 *
 * Boundary tie-breaking (committed in .scratch/audit_f12a_phase0.txt — the
 * boundary value belongs to the more-favorite/lower bucket, ≤ semantics,
 * matching the F1.1 probe arithmetic exactly):
 *   o ≤ −200            → "heavy-fav"
 *   −200 < o ≤ −110     → "mid-fav"
 *   −110 < o ≤ +110     → "pickem"
 *   +110 < o ≤ +250     → "mid-dog"
 *   +250 < o ≤ +500     → "longshot"
 *   o > +500            → "heavy-longshot"
 * Trap-1 guard: null / undefined / NaN / non-numeric / 0 → "unknown" —
 * NEVER defaults to "pickem" or any real bucket (missing odds must fall back
 * to today's global classifier behavior, not a fabricated bucket).
 *
 * @param {number|string|null|undefined} oddsAmerican  American odds (e.g. -150, +370)
 * @returns {"heavy-fav"|"mid-fav"|"pickem"|"mid-dog"|"longshot"|"heavy-longshot"|"unknown"}
 */
function bucketForOdds(oddsAmerican) {
  const o = Number(oddsAmerican)
  if (Number.isFinite(o) === false || o === 0) return "unknown"
  if (o <= -200) return "heavy-fav"
  if (o <= -110) return "mid-fav"
  if (o <= 110)  return "pickem"
  if (o <= 250)  return "mid-dog"
  if (o <= 500)  return "longshot"
  return "heavy-longshot"
}

// 2026-06-07 — F1.2b kill-switch (precedent: CALIB_LINEAWARE in
// calibrationDampener.js). Read ONCE at module load. unset/"1" → ON; ONLY the
// exact string "0" → OFF. OFF disables BOTH per-bucket overrides (P1-A ELITE
// demotion, P2-C form-gate exemption) ⇒ tier outputs byte-identical to F1.2a
// (commit 4e6b6a2) behavior. Flip requires a backend reload (launchctl unload
// + load) — deliberate operator action, not a mid-flight toggle.
const BUCKET_TIER_POLICY_ON = String(process.env.NBA_BUCKET_TIER_POLICY ?? "1") !== "0"
try {
  console.log(`[TIER-POLICY-BOOT] NBA bucket tier policy ${BUCKET_TIER_POLICY_ON ? "ON (default)" : "OFF — NBA_BUCKET_TIER_POLICY=0, F1.2a-identical"}`)
} catch (_) { /* no-op */ }

/**
 * @param {object} opts
 * @param {number} opts.edge         model edge vs market (modelProb - impliedProb)
 * @param {number} [opts.ev]         expected value (modelProb*(decOdds-1) - (1-modelProb))
 * @param {number} [opts.conf]       confidence score 0..1
 * @param {number} [opts.modelProb]  model probability 0..1
 * @param {boolean}[opts.isLongshot] override: longshot always returns LONGSHOT
 * @param {string} [opts.side]       "over"/"under" — required for form-contradiction check
 * @param {number} [opts.line]       prop line — required for form-contradiction check
 * @param {number} [opts.l5Avg]      player's last-5 average (or last-10) — required for form check
 * @param {number} [opts.projMostLikely]  projection.mostLikely value (NEW 2026-05-25 — catches picks where L5 is close to line but projection is far)
 * @param {number} [opts.oddsAmerican]  American odds (2026-06-07 F1.2a wiring; consumed
 *                  by F1.2b per-bucket overrides same date. Default undefined → bucket
 *                  "unknown" → NO overrides apply → pre-F1.2a behavior at any
 *                  non-updated call site.)
 * @returns {"ELITE"|"STRONG"|"PLAYABLE"|"LONGSHOT"|"FADE"}
 */
function classifyNbaTier({ edge, ev, conf, modelProb, isLongshot, side, line, l5Avg, projMostLikely, statFamily, oddsAmerican } = {}) {
  // 2026-06-07 — F1.2a: odds bucket computed as available context.
  // 2026-06-07 — F1.2b: consumed at two sites below (P2-C form-gate exemption,
  // P1-A ELITE demotion). "unknown" bucket (missing/invalid odds) matches NO
  // override predicate → behavior identical to F1.2a — Trap-1: missing odds
  // never unlocks an override.
  const _bucket = bucketForOdds(oddsAmerican)

  // 2026-05-27 — Lane D.5 ALT-LINE MAGNITUDE GATE. Runs FIRST so it fires
  // BEFORE the LONGSHOT bypass. Previously placed below LONGSHOT — Wemby over
  // 39.5 points @+1100 was stamped LONGSHOT (implied 8.3% < 10% threshold)
  // and skipped this gate entirely. 19 longshot picks per slate bypassed it
  // until 2026-05-27 reorder. Skips binary props (line=null) automatically.
  if (Number.isFinite(line) && line > 0 && side) {
    const sideStr = String(side).toLowerCase()
    const baselines = [l5Avg, projMostLikely].filter((x) => Number.isFinite(x) && x > 0)
    if (baselines.length > 0) {
      // 2026-05-27 — Lane D.5 calibration update: TWO conditions for FADE:
      //   (a) "absolute + relative" — large gap (>3 units) AND meaningful ratio
      //       (>1.30 / <0.70). Catches large-baseline stats like points.
      //   (b) "extreme ratio alone" — line is 2×+ above baseline (over) or
      //       under 0.5× (under). Catches small-baseline stats like threes/
      //       blocks/steals where absolute gap stays small but the multiplier
      //       is absurd (Wemby threes line 5.5 vs baseline 1.8 = ratio 3.05).
      if (sideStr === "over" || sideStr === "yes") {
        const maxBaseline = Math.max(...baselines)
        const gap = line - maxBaseline
        const ratio = line / maxBaseline
        if ((gap > 3.0 && ratio > 1.30) || ratio > 2.0) return "FADE"
      }
      if (sideStr === "under" || sideStr === "no") {
        const minBaseline = Math.min(...baselines)
        const gap = minBaseline - line
        const ratio = line / minBaseline
        if ((gap > 3.0 && ratio < 0.70) || ratio < 0.50) return "FADE"
      }
    } else {
      // 2026-05-27 — Lane D.6 MAGNITUDE FALLBACK. When the model has NO baseline
      // for this player (no L5, no projection), D.5 can't compute the magnitude
      // ratio — falls through to LONGSHOT. But "no data + absurd over line" is
      // exactly the scenario the operator caught in Castle rebounds over 11.5
      // @+2200 — Castle's actual L5 reb ≈ 3-4 but data missing → LONGSHOT
      // accepted. Family-specific absolute thresholds catch the worst of these
      // without requiring per-player data. Only fires for OVER (under absurd-low
      // is much rarer in practice). Picks with line ABOVE the threshold get
      // FADE'd; everything else falls through to existing logic.
      const fam = String(statFamily || "").toLowerCase()
      const ABSURD_OVER_LINE = {
        points: 30, rebounds: 11, assists: 9, threes: 4,
        pra: 50, steals: 2, blocks: 3, turnovers: 4,
      }
      const cap = ABSURD_OVER_LINE[fam]
      if (Number.isFinite(cap) && (sideStr === "over" || sideStr === "yes") && line > cap) {
        return "FADE"
      }
    }
  }

  if (isLongshot === true) return "LONGSHOT"
  if (!Number.isFinite(edge)) return "FADE"
  if (Number.isFinite(ev) && ev <= 0) return "FADE"
  if (edge < 0.03) return "FADE"

  // 2026-05-24 — FORM CONTRADICTION SANITY GATE. The arithmetic engine is
  // structurally conservative — even tightened, it can produce modelProb=0.38
  // on UNDER picks where the player's L5 avg is 7+ pts above the line. The
  // operator's intuition is right: those picks should never reach the FE.
  if (Number.isFinite(l5Avg) && Number.isFinite(line) && line > 0 && side) {
    const sideStr = String(side).toLowerCase()
    const overshoot = (l5Avg - line) / line  // positive when L5 > line
    if ((sideStr === "under" || sideStr === "no") && overshoot > 0.07) {
      // 2026-06-07 — F1.2b P2-C (traced: .scratch/probe_f12b_trace.txt). At
      // MID-FAV only, model-backed unders are exempt from this FADE. The trace
      // found 15 of 17 reproducible midfav FADE-winners died on THIS return —
      // small-baseline role players (e.g. points under 2.5 vs L5 3.0) where a
      // sub-point gap inflates relative overshoot while the model, which sees
      // minutes/role/matchup, backs the under at 59-71%. Rescue simulation:
      // 13W/2L (87%). Predicate (narrowest, operator-approved): mid-fav bucket
      // AND model agrees with the under (modelProb > 0.5) AND real conviction
      // (|modelProb − 0.5| ≥ 0.10). Missing/non-finite modelProb ⇒ NOT exempt.
      // Exempted picks FALL THROUGH to the remaining gates + magnitude ladder —
      // they surface at whatever tier edge/conviction earn, never auto-promoted.
      const modelBackedUnderAtMidfav =
        BUCKET_TIER_POLICY_ON &&
        _bucket === "mid-fav" &&
        Number.isFinite(modelProb) &&
        modelProb > 0.5 &&
        Math.abs(modelProb - 0.5) >= 0.10
      if (modelBackedUnderAtMidfav === false) return "FADE"
    }
    if ((sideStr === "over"  || sideStr === "yes") && overshoot < -0.07) return "FADE"
  }

  // 2026-05-25 — PROJECTION CONTRADICTION GATE. L5-only gate misses picks
  // where L5 is similar to line but the projection most likely is materially
  // opposite. Operator caught 4 such picks tonight all surviving as PLAYABLE:
  //   Harden UNDER pra 24.5  (L5 26.2 OK, projection 32.6 → wrong direction)
  //   Harden UNDER assists 4.5 (L5 4 OK, projection 7.3 → wrong direction)
  //   KAT UNDER reb 9.5       (L5 10 OK, projection 12.3 → wrong direction)
  //   Mobley OVER points 19.5 (L5 18.4 OK, projection 15.5 → wrong direction)
  // 15% threshold catches all four (Mobley is exactly 15% off, others 20%+).
  if (Number.isFinite(projMostLikely) && Number.isFinite(line) && line > 0 && side) {
    const sideStr = String(side).toLowerCase()
    const projGap = (projMostLikely - line) / line  // positive when projection > line
    if ((sideStr === "under" || sideStr === "no") && projGap > 0.15) return "FADE"
    if ((sideStr === "over"  || sideStr === "yes") && projGap < -0.15) return "FADE"
  }

  // Conviction gate — model must have an opinion, not just disagree with
  // a long-odds market line by virtue of clustering near 0.50.
  // SAFETY: if modelProb is missing or non-finite, we CANNOT verify conviction.
  // Cap the tier at PLAYABLE in that case — never claim ELITE on unverified
  // conviction. This blocks shadow paths that forget to pass modelProb.
  const modelProbVerified = Number.isFinite(modelProb)
  if (modelProbVerified) {
    const conviction = Math.abs(modelProb - 0.5)
    // 2026-05-24 — raised FADE threshold 0.03 → 0.06 so wrong-direction picks
    // get filtered off Sharp Plays entirely instead of just demoted. If the
    // model says ~50% (no real opinion), the operator shouldn't see the pick
    // at all. Operator caught this — picks consistently going against L5
    // form should disappear, not just downgrade tier.
    if (conviction < 0.06) return "FADE"      // model has no real opinion
    if (conviction < 0.10) return "PLAYABLE"  // low conviction — never ELITE
  }

  // Magnitude tiers
  const goodEv  = !Number.isFinite(ev) || ev >= 0.015
  const goodConf = !Number.isFinite(conf) || conf >= 0.45
  if (edge >= 0.12 && goodEv && goodConf && modelProbVerified) {
    // 2026-06-07 — F1.2b P1-A. ELITE is inverse-predictive in pickem/mid-dog:
    // realized 5% (n=19) / 15% (n=13) on the engine's HIGHEST-claimed-edge
    // picks (.scratch/probe_f11_deduped_vig_aware.txt; design audit
    // .scratch/audit_f12_phase0.txt P1-A — raise-threshold P1-B was REJECTED
    // because claimed edge is inverse-predictive there). Demote to STRONG:
    // keeps snapshot/board acceptance (ELITE||STRONG gates), cuts single-bet
    // stake from 2.0-3.0u to 1.0-1.5u (buildNbaBankrollPlan tierUnitsRange).
    // All other buckets — and "unknown" — keep ELITE.
    if (BUCKET_TIER_POLICY_ON && (_bucket === "pickem" || _bucket === "mid-dog")) return "STRONG"
    return "ELITE"
  }
  if (edge >= 0.07 && goodEv)                                  return "STRONG"
  if (edge >= 0.04)                                            return "PLAYABLE"
  return "LONGSHOT"
}

module.exports = { classifyNbaTier, bucketForOdds }
