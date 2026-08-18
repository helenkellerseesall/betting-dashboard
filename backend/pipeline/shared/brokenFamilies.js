"use strict"

/**
 * brokenFamilies — the ONE serve-layer authority for BROKEN prop families.
 *
 * 2026-08-18 OUTS-CONTAINMENT ADDENDUM (operator-directed, serve-truth class,
 * standing queue — NOT record semantics; see OPERATOR_SESSION_LOG.md).
 *
 * WHAT THIS IS: a small, evidence-cited list of (sport, statFamily) lanes the
 * model is PROVEN WRONG on. Every serve surface that recommends or badges picks
 * reads THIS list. A family on it gets:
 *   - dropped from recommendation surfaces (/top-picks; slips already exclude both)
 *   - a red BROKEN badge + NO tier chip + NO confidence claim on display
 *     surfaces (GAMES board keeps raw lines/odds — raw display is allowed)
 *
 * WHAT THIS IS NOT: a record or grading change. tracked_bets capture, grading,
 * CLV, the critic, and every write path are UNTOUCHED — the record must keep
 * accruing evidence on these families, or a recalibration can never be proven.
 * That is why tierForPlay (write-time tier stamping) deliberately does NOT read
 * this module (fixture-pinned in verifyBrokenFamilies.js).
 *
 * WHY IT EXISTS AS A MODULE (2026-08-18 diagnosis): before this file, the
 * "broken treatment" was four scattered pieces — the lane_calibration.json
 * BROKEN badge (file stale since 2026-05-23), the Sharp Plays Step-1 warn
 * (rbis only), slip exclusion (rbis+outs), and the dampener crushing rbis edge
 * so every rbis row tiers LONGSHOT (measured 10,769/10,769 rows, last 10
 * slates) and falls out of /top-picks EMERGENTLY. outs had NO such emergent
 * protection: 102 of 136 tracked outs rows in the same window were
 * top-picks-ELIGIBLE (19 ELITE / 22 STRONG / 61 PLAYABLE) while the model ran
 * 38.5pp hot. One authority replaces four accidents.
 *
 * LIFT CONDITION (binding): a family leaves this list ONLY when a
 * recalibration ASK passes (CA-verified GO). Never edit ad hoc.
 */

// Aliases normalize the same way workstationRoutes._normFam does: lowercase,
// strip spaces/underscores/hyphens. Keep entries lowercase-normalized here.
const BROKEN_FAMILIES = {
  mlb: {
    rbis: {
      canonical: "rbis",
      aliases: ["rbis", "rbi", "batterrbis", "playerrbis"],
      evidence:
        "step1_trust_proof.md: realized −11.9pp vig-aware (PLAYABLE rbis) · " +
        "lane_calibration 2026-05-23: broken, ROI −19.7% (n=56) · " +
        "G2-L2 walk-forward: STOP, 19.5pp high bucket · " +
        "serve reality measured 2026-08-18: 10,769/10,769 tracked rows tier LONGSHOT (emergent suppression, now named)",
      since: "2026-08-18",
      until: "recalibration ASK passes (CA-verified GO)",
    },
    outs: {
      canonical: "outs",
      aliases: ["outs", "pitcherouts", "outsrecorded", "pitcheroutts"],
      evidence:
        "drift_alerts.log 2026-08-17: model 50.6% / realized 12.1% — gap 38.5pp (n=66) · mul ×0.24 — SEVERELY MISCALIBRATED · " +
        "lane_calibration 2026-05-23: broken, ROI −19.3% (n=128) · " +
        "outs absent from G2 PASS map (Lab/Daily3 already structurally excluded) · " +
        "serve gap measured 2026-08-18: 102/136 tracked outs rows top-picks-eligible (19 ELITE / 22 STRONG / 61 PLAYABLE)",
      since: "2026-08-18",
      until: "recalibration ASK passes (CA-verified GO)",
    },
  },
}

function _norm(s) {
  return String(s || "").toLowerCase().replace(/[\s_\-]+/g, "")
}

/** True when (sport, statFamily) is on the broken list. Never guesses:
 *  unknown sport or family → false. */
function isBrokenFamily(sport, statFamily) {
  return brokenFamilyInfo(sport, statFamily) != null
}

/** The evidence entry for (sport, statFamily), or null. */
function brokenFamilyInfo(sport, statFamily) {
  const sp = _norm(sport)
  const fams = BROKEN_FAMILIES[sp]
  if (!fams) return null
  const f = _norm(statFamily)
  if (!f) return null
  for (const key of Object.keys(fams)) {
    const entry = fams[key]
    if (entry.aliases.includes(f)) return entry
  }
  return null
}

/** Compact serve-payload stamp (what rides a candidate row). */
function brokenFamilyStamp(sport, statFamily) {
  const e = brokenFamilyInfo(sport, statFamily)
  if (!e) return null
  return {
    family: e.canonical,
    label: "BROKEN",
    tip: "Model is proven wrong on this prop family. No tier, no confidence claim. Do not bet.",
    evidence: e.evidence,
    until: e.until,
  }
}

module.exports = { BROKEN_FAMILIES, isBrokenFamily, brokenFamilyInfo, brokenFamilyStamp }
