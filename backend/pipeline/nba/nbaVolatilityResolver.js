"use strict"

/**
 * NBA Volatility Resolver — canonical volatility authority for all NBA paths.
 *
 * This is the SINGLE authoritative source for NBA volatility interpretation.
 * All NBA paths that need volatility classification must route through here
 * rather than calling classifyVolatility() directly for NBA candidates.
 *
 * Ownership chain:
 *   nbaVolatilityResolver.js          ← THIS FILE (canonical authority)
 *     ↓ delegates fallback to
 *   buildPortfolioOptimizer.classifyVolatility  (VOLATILITY_RULES — never modified)
 *
 * This resolver does NOT:
 *   - modify VOLATILITY_RULES
 *   - change scoring weights
 *   - affect aiRange math
 *   - affect slip construction
 *   - affect MLB candidates (snapshotSourced is never set on MLB rows)
 *
 * Resolution priority (first-match wins):
 *
 *   1. Snapshot-sourced volatility preservation
 *      buildNbaSnapshotCandidates() (workstationRoutes.js FIX Q4) stamps:
 *        - volatility:"lotto"      on PRA combo candidates  (NBA-1 pattern)
 *        - volatility:"aggressive" on threes / first_basket (volatile high-var)
 *        - volatility:"balanced"   on points/rebounds/assists (volume stats)
 *      These are deliberate NBA-specific calibrations more precise than VOLATILITY_RULES.
 *      Without preservation, VOLATILITY_RULES would map:
 *        - PRA/combo → "aggressive" (too low for a 4-5 leg lotto slate)
 *        - threes (normal line) → "balanced" (undersells volatility)
 *      Guard: only fires when snapshotSourced === true AND a valid stamp exists.
 *      MLB candidates never set snapshotSourced — this path never fires for MLB.
 *
 *   2. Role-spike / eruption-environment stamp preservation [NBA-6 hook — no-op now]
 *      When NBA-6 stamps roleSpike:true or eruptionEnvironment:true on candidates
 *      with a specific volatility, this resolver will honor that stamp to route
 *      them into the correct tier. Currently documented only; not yet implemented.
 *
 *   3. VOLATILITY_RULES fallback — classifyVolatility(raw)
 *      Standard rules-based classification for all other candidates.
 *      MLB candidates always reach this path. Safe / balanced / aggressive / lotto
 *      semantics are unchanged from the existing VOLATILITY_RULES table.
 *
 * Current consumers:
 *   - pipeline/shared/buildFeaturedPlays.js  (normalizeCandidate)
 *   - pipeline/shared/buildSlipAi.js         (normalizeCandidate)
 *
 * Future consumers (NBA-2.F scope):
 *   - pipeline/nba/buildNbaBestBetsBoard.js  (allPlays volatility stamping)
 */

const { classifyVolatility } = require("../shared/buildPortfolioOptimizer")

const VALID_VOLATILITY = new Set(["safe", "balanced", "aggressive", "lotto"])

/**
 * Resolve the volatility category for a candidate.
 *
 * @param {object} raw — raw candidate from any source (snapshot, tracked_best, board row, etc.)
 * @returns {{ volatility: string, source: string }}
 *   volatility — "safe" | "balanced" | "aggressive" | "lotto"
 *   source     — auditability tag for the resolution path taken:
 *                "snapshot_stamped" | "rules"
 *                (future: "role_spike" | "eruption")
 */
function nbaVolatilityResolve(raw) {
  if (!raw) return { volatility: "safe", source: "rules" }

  // ── 1. Snapshot-sourced volatility preservation ─────────────────────────────
  // buildNbaSnapshotCandidates() stamps volatility + snapshotSourced:true on every
  // row it qualifies. These stamps are more NBA-calibrated than VOLATILITY_RULES:
  //   PRA  → "lotto"      — combo stat, 4-5 leg slate, genuine lotto semantics
  //   threes / first_basket → "aggressive" — volatile, high-var outcome
  //   points / rebounds / assists → "balanced" — standard NBA volume stat
  // Preserve any valid stamp when the source is confirmed snapshot.
  // MLB candidates never set snapshotSourced — this guard never fires for MLB.
  // VOLATILITY_RULES itself is NOT modified.
  if (raw.snapshotSourced === true && VALID_VOLATILITY.has(raw.volatility)) {
    return { volatility: raw.volatility, source: "snapshot_stamped" }
  }

  // ── 2. Role-spike / eruption-environment hook [NBA-6 scope — no-op] ─────────
  // Documented anchor for when NBA-6 stamps roleSpike:true or eruptionEnvironment:true.
  // At that point, uncomment and implement the preservation logic here.
  // Do NOT implement until NBA-6; implementing early would require fake stamp injection.
  //
  // if (raw.roleSpike === true && raw.volatility && VALID_VOLATILITY.has(raw.volatility)) {
  //   return { volatility: raw.volatility, source: "role_spike" }
  // }
  // if (raw.eruptionEnvironment === true && raw.volatility && VALID_VOLATILITY.has(raw.volatility)) {
  //   return { volatility: raw.volatility, source: "eruption" }
  // }

  // ── 3. VOLATILITY_RULES fallback ─────────────────────────────────────────────
  // Static classification table in buildPortfolioOptimizer — first-match wins.
  // MLB candidates always reach this path.
  // VOLATILITY_RULES is NOT modified by this resolver.
  return { volatility: classifyVolatility(raw), source: "rules" }
}

/**
 * Convenience wrapper — returns volatility string only.
 * Use this in normalizeCandidate() calls where only the string is needed.
 *
 * @param {object} raw — raw candidate
 * @returns {string} "safe" | "balanced" | "aggressive" | "lotto"
 */
function resolveNbaVolatility(raw) {
  return nbaVolatilityResolve(raw).volatility
}

module.exports = { nbaVolatilityResolve, resolveNbaVolatility }
