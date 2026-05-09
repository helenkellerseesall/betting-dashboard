"use strict"

/**
 * Shared stat-family normalizers — canonical definitions.
 *
 * Pure functions. No IO, no side effects.
 *
 * Prevents silent divergence between buildFeaturedPlays and buildSlipAi,
 * which previously each maintained their own inline version of the offensive-
 * stat check with slightly different coverage.
 *
 * Imported by:
 *   pipeline/shared/buildFeaturedPlays.js  — scoreCandidate texture boost
 *   pipeline/shared/buildSlipAi.js         — offensiveAttackTextureBonus
 */

/**
 * Normalize a stat family key to a lowercase, whitespace-collapsed string.
 * Identical to the local normFam helpers in buildFeaturedPlays and buildSlipAi.
 * Idempotent — safe to call on an already-normalized string.
 */
function normFam(v) {
  return String(v || "").toLowerCase().replace(/[\s_]+/g, "")
}

/**
 * True offensive attack stats — hitter offense, not pitcher dominance.
 *
 * Returns true for stat families that represent genuine offensive output
 * (hits, home runs, RBI, total bases, etc.) and false for pitching/suppression
 * stats (Ks, outs, walks).
 *
 * Canonical definition — previously duplicated with slight divergence between
 * buildFeaturedPlays (which included doubles/triples) and buildSlipAi (which
 * did not). This version matches buildFeaturedPlays as the more complete spec.
 *
 * The doubles/triples inclusion in buildSlipAi is a legitimate alignment:
 * both are genuine offensive attack outcomes and belong in the same category.
 *
 * @param {string} fam — raw or already-normalized stat family string
 * @returns {boolean}
 */
function isOffensiveAttackStat(fam) {
  const f = normFam(fam)
  if (!f) return false
  if (f.includes("outs") || f.includes("strikeout") || f.includes("pitcherk") || f.includes("walks")) return false
  return f.includes("hits") || f.includes("runs") || f.includes("totalbase") ||
         f.includes("rbi") || f.includes("homerun") || f === "hr" || f.includes("xbh") ||
         f.includes("stolen") || f.includes("steals") || f.includes("points") ||
         f.includes("rebounds") || f.includes("threes") || f.includes("assists") ||
         f.includes("combo") || f === "pra" || f.includes("doubles") || f.includes("triples")
}

module.exports = { isOffensiveAttackStat, normFam }
