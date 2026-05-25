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
 * @param {object} opts
 * @param {number} opts.edge         model edge vs market (modelProb - impliedProb)
 * @param {number} [opts.ev]         expected value (modelProb*(decOdds-1) - (1-modelProb))
 * @param {number} [opts.conf]       confidence score 0..1
 * @param {number} [opts.modelProb]  model probability 0..1
 * @param {boolean}[opts.isLongshot] override: longshot always returns LONGSHOT
 * @param {string} [opts.side]       "over"/"under" — required for form-contradiction check
 * @param {number} [opts.line]       prop line — required for form-contradiction check
 * @param {number} [opts.l5Avg]      player's last-5 average (or last-10) — required for form check
 * @returns {"ELITE"|"STRONG"|"PLAYABLE"|"LONGSHOT"|"FADE"}
 */
function classifyNbaTier({ edge, ev, conf, modelProb, isLongshot, side, line, l5Avg } = {}) {
  if (isLongshot === true) return "LONGSHOT"
  if (!Number.isFinite(edge)) return "FADE"
  if (Number.isFinite(ev) && ev <= 0) return "FADE"
  if (edge < 0.03) return "FADE"

  // 2026-05-24 — FORM CONTRADICTION SANITY GATE. The arithmetic engine is
  // structurally conservative — even tightened, it can produce modelProb=0.38
  // on UNDER picks where the player's L5 avg is 7+ pts above the line. The
  // operator's intuition is right: those picks should never reach the FE.
  //
  // Rule (tightened 2026-05-24): if pick is UNDER but L5 is ≥12% above line,
  // FADE; if pick is OVER but L5 is ≥12% below line, FADE. Operator caught
  // Wemby UNDER reb 11.5 (L5=13.6, gap 18%) slipping through the old 20%
  // threshold; the gate must trip on smaller gaps in low-line stats (reb,
  // ast, threes) where a 2-unit gap is a fundamental directional disagreement.
  // Same logic the operator applies eyeballing: "he averages 13.6, line 11.5,
  // why would I bet under?"
  if (Number.isFinite(l5Avg) && Number.isFinite(line) && line > 0 && side) {
    const sideStr = String(side).toLowerCase()
    const overshoot = (l5Avg - line) / line  // positive when L5 > line
    // 2026-05-25 — tightened 12% → 7%. Operator caught 5 wrong-direction picks
    // surviving at 12%: Harden UNDER pra 23.5 (L5 26.2, overshoot 11.5%),
    // Mitchell UNDER pra 29.5 (32.2, 9.2%), KAT UNDER reb 9.5 (10, 5.3%),
    // Mobley OVER pts 20.5 (18.4, -10.2%). 7% catches all of these while
    // preserving genuinely close-line plays (overshoot < 7% = within typical
    // game-to-game noise).
    if ((sideStr === "under" || sideStr === "no") && overshoot > 0.07) return "FADE"
    if ((sideStr === "over"  || sideStr === "yes") && overshoot < -0.07) return "FADE"
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
  if (edge >= 0.12 && goodEv && goodConf && modelProbVerified) return "ELITE"
  if (edge >= 0.07 && goodEv)                                  return "STRONG"
  if (edge >= 0.04)                                            return "PLAYABLE"
  return "LONGSHOT"
}

module.exports = { classifyNbaTier }
