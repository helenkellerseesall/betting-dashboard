"use strict"

/**
 * Phase Player-Conviction-Engine-1A (PCE-1A) — pure deterministic module.
 *
 * GOAL
 * ────
 * Reward "sustainable hitter legitimacy" with a small additive composite weight
 * (~5%) INSIDE scoreCandidate, and apply a small "anti-randomness" penalty on
 * clearly noise-driven survival (back-of-order longshot HR spam with no
 * ecology support). The engine is engineered to make believable longshots feel
 * EARNED — NOT to remove longshots, ladders, or breakout discovery.
 *
 * OPERATOR-CEMENTED CONSTRAINTS
 * ─────────────────────────────
 *   - DO NOT make the engine "safe."
 *   - DO NOT remove longshots (+400 to +1000 ladders MUST still survive).
 *   - DO NOT remove ladders.
 *   - ONLY: increase conviction quality and reduce fake-randomness.
 *   - additive / modular / governance-safe / replay-safe / canonical
 *   - NO ML, NO GPT, NO celebrity scoring, NO popularity weighting,
 *     NO Twitter sentiment, NO public-bet bias, NO fake "trending" tags.
 *   - Sharp + believable, NOT consensus chalk, NOT random variance spam.
 *
 * CANONICAL FIELDS CONSUMED (anti-fabrication — undefined → neutral)
 * ──────────────────────────────────────────────────────────────────
 *   lineupSpot           (deriveMlbLineupContext)
 *   plateAppearancesProxy(deriveMlbLineupContext)
 *   depth                (deriveMlbLineupContext)
 *   impliedTeamTotal     (buildMlbBootstrapSnapshot)
 *   hrEnvironmentTag     (deriveMlbParkContext)
 *   hrFactor             (deriveMlbParkContext)
 *   modelProb            (raw row)
 *   edge                 (raw row)
 *   statFamily, side     (raw row)
 *
 * NO new fetches. NO new fields invented. Every input is already lifted
 * through BC-1 + OE-1 normalizeCandidate in buildFeaturedPlays + buildSlipAi.
 *
 * DOCTRINE: DISTINCTNESS FROM BC-2 / OE-2
 * ────────────────────────────────────────
 *   BC-2 playerLegitimacyFactor(c) → depth × impliedTeamTotal ramp (7% weight)
 *   OE-2 offensivePressureIndex(c)  → runEnvironment × teamTotal × carryShift (5%)
 *
 *   PCE uses NONE of (runEnvironment, depth-only-mapping). It adds a NEW angle:
 *     - lineupSpot precision (1-9 numeric, not depth bucket)
 *     - plateAppearancesProxy FLOOR (opportunity sustainability)
 *     - stat-side coherence (HR over from spot 9 + dead env = randomness penalty)
 *     - model-trust alignment (high modelProb + moderate edge = earned;
 *       tiny modelProb + huge edge = "random variance spam" — penalty)
 *
 *   The composite is additive on top of BC-2 + OE-2 — never replaces them.
 *   Max conviction boost is small (PCE_MAX_BOOST = 0.05).
 *   Max anti-randomness penalty is also small (PCE_MAX_PENALTY = 0.04).
 *   Net effect always ∈ [-0.04, +0.05].
 *
 * LONGSHOT PRESERVATION
 * ─────────────────────
 * The penalty NEVER zeros out a candidate. A +700 HR on a back-of-order bat
 * with modelProb 0.10 will still surface — it just won't outrank an EQUIVALENT
 * +700 HR from a top-of-order bat with modelProb 0.18 in an HR-friendly park.
 * Breakouts (top-of-order, high PA proxy, modelProb 0.20+, friendly env) get
 * the positive boost — these are exactly the Langeliers / Raleigh / James Wood
 * profile the operator named as the engine's target.
 */

const { isOffensiveAttackStat, normFam } = require("./normalizers")

// ── tunable canonical constants (operator-approved bands) ────────────────────

const PCE_VERSION              = "1.0.0-PCE-1A"
const PCE_WEIGHT               = 0.05   // 5% additive composite weight (vs BC-2 0.07 / OE-2 0.05)
const PCE_NEUTRAL              = 0.50   // neutral fallback when canonical signals absent
const PCE_MAX_BOOST            = 0.05   // hard cap on positive additive
const PCE_MAX_PENALTY          = 0.04   // hard cap on negative additive (anti-randomness)

// lineupSpot conviction map — precise 1-9 numeric, NOT depth bucket
const PCE_LINEUP_SPOT_CONVICTION = Object.freeze({
  1: 1.00, 2: 1.00, 3: 1.00, 4: 0.95,
  5: 0.80, 6: 0.70,
  7: 0.55, 8: 0.45, 9: 0.40,
})

// plateAppearancesProxy floor — sustainability of opportunity
//   pa >= 4.2 (top of order)     → 1.00 conviction
//   pa >= 3.5 (mid-lineup)        → 0.80
//   pa >= 2.8 (bottom)            → 0.55
//   pa <  2.8 (deep bench / spot) → 0.40
function pcePaConviction(pa) {
  if (!Number.isFinite(pa)) return null  // honest neutral
  if (pa >= 4.2) return 1.00
  if (pa >= 3.5) return 0.80
  if (pa >= 2.8) return 0.55
  return 0.40
}

// model-trust alignment — flag "random variance spam"
//   modelProb > 0.22 + edge > 0.05  → high trust (earned upside)
//   modelProb > 0.15 + edge > 0.05  → mid trust  (reasonable upside)
//   modelProb > 0.10 + edge > 0.08  → low trust  (modest model + bigger edge — viable)
//   modelProb <= 0.10 + edge > 0.10 → low trust  (tiny model, huge edge — likely random)
//   default                          → neutral
//
// NOTE: we DO NOT punish high-odds (+400/+700/+1000) plays on price alone.
// The operator was explicit: "still surface +400 to +1000 ladders" but make
// them feel "earned." We only penalize when modelProb itself is implausibly
// low — that's the actual "random variance spam" signature.
function pceModelTrust(modelProb, edge) {
  const mp = Number.isFinite(modelProb) ? modelProb : null
  const ed = Number.isFinite(edge)      ? edge      : null
  if (mp == null) return null  // honest neutral
  if (mp >= 0.22 && (ed == null || ed >= 0.04)) return 1.00
  if (mp >= 0.15) return 0.85
  if (mp >= 0.10) return 0.65
  // tiny modelProb territory — likely random variance survival
  return 0.40
}

// stat-side coherence — does the stat line make sense given the spot?
//   HR over from lineupSpot 1-4 = coherent (HR threat in heart of order)
//   HR over from lineupSpot 8-9 + impliedTeamTotal < 4.0 = INCOHERENT (random)
//   hits/totalBases over from spot 1-3 = coherent
//   anything else = neutral
function pceStatSideCoherence(candidate) {
  const fam  = normFam(candidate.statFamily)
  const side = String(candidate.side || "").toLowerCase()
  const spot = Number(candidate.lineupSpot)
  const itt  = Number(candidate.impliedTeamTotal)
  if (side !== "over") return null

  // HR-side coherence
  if (fam.includes("homerun") || fam === "hr") {
    if (Number.isFinite(spot)) {
      if (spot >= 1 && spot <= 4) return 1.00          // heart-of-order HR = coherent
      if (spot >= 5 && spot <= 6) return 0.70          // mid-lineup HR = mid coherence
      if (spot >= 7) {
        if (Number.isFinite(itt) && itt < 4.0) return 0.20  // 8-9 spot + dead env = INCOHERENT (random)
        return 0.45                                     // 8-9 spot but live env = somewhat coherent
      }
    }
    return null
  }

  // Hits / total bases / xbh — top-of-order conviction signal
  if (fam.includes("hits") || fam.includes("totalbase") || fam.includes("xbh") || fam.includes("doubles") || fam.includes("triples")) {
    if (Number.isFinite(spot)) {
      if (spot <= 3) return 1.00
      if (spot <= 5) return 0.85
      if (spot <= 7) return 0.65
      return 0.50
    }
    return null
  }

  // RBI / runs — already covered by OE-4 correlatedRunProduction. PCE neutral here.
  return null
}

/**
 * computePlayerConviction — pure function. Returns:
 *   {
 *     factor:     number in [0, 1] (the raw conviction composite, before weight),
 *     additive:   number in [-PCE_MAX_PENALTY, +PCE_MAX_BOOST] (the signed boost
 *                  to ADD to scoreCandidate composite),
 *     phrase:     deterministic bettor-readable phrase (PCE-1A FE surfacing),
 *     reasonTag:  short signal tag (operator + bettor),
 *     gated:      boolean — true when at least one canonical input was honest,
 *                  false when ALL inputs absent (pure neutral, no surfacing),
 *     debug:      { lineupSpotConv, paConv, modelTrust, sideCoherence, fired }
 *   }
 *
 * Anti-fabrication: when ALL canonical inputs are absent → factor = PCE_NEUTRAL,
 * additive = 0, phrase = null, gated = false. The candidate is neither
 * promoted nor demoted — net-zero impact.
 *
 * Hitter overs only. Pitcher props (outs / Ks / walks) bypass entirely and
 * return a neutral-gated record (PCE has no opinion on pitcher dominance).
 */
function computePlayerConviction(candidate) {
  const neutral = {
    factor: PCE_NEUTRAL,
    additive: 0,
    phrase: null,
    reasonTag: null,
    gated: false,
    debug: { lineupSpotConv: null, paConv: null, modelTrust: null, sideCoherence: null, fired: "neutral_no_signal" },
  }
  if (!candidate || typeof candidate !== "object") return neutral
  if (String(candidate.side || "").toLowerCase() !== "over") return { ...neutral, debug: { ...neutral.debug, fired: "neutral_not_over" } }
  if (!isOffensiveAttackStat(candidate.statFamily)) return { ...neutral, debug: { ...neutral.debug, fired: "neutral_pitcher_or_under" } }

  // 1) lineupSpot conviction — numeric precision
  const spot = Number(candidate.lineupSpot)
  const lineupSpotConv = Number.isFinite(spot) && PCE_LINEUP_SPOT_CONVICTION[spot] != null
    ? PCE_LINEUP_SPOT_CONVICTION[spot]
    : null

  // 2) plateAppearancesProxy floor
  const paConv = pcePaConviction(candidate.plateAppearancesProxy)

  // 3) model-trust alignment
  const modelTrust = pceModelTrust(candidate.modelProb, candidate.edge)

  // 4) stat-side coherence
  const sideCoherence = pceStatSideCoherence(candidate)

  // Honest gating: if ALL four are null → neutral, no surfacing.
  const signals = [lineupSpotConv, paConv, modelTrust, sideCoherence].filter((x) => x != null)
  if (signals.length === 0) return { ...neutral, debug: { lineupSpotConv, paConv, modelTrust, sideCoherence, fired: "neutral_all_absent" } }

  // Composite — mean of present signals, neutral fill for absent ones (anti-
  // fabrication: a single absent dimension shouldn't crater the composite).
  const lookup = (v) => v == null ? PCE_NEUTRAL : v
  const factor = (lookup(lineupSpotConv) + lookup(paConv) + lookup(modelTrust) + lookup(sideCoherence)) / 4

  // Sign + scale the additive:
  //   factor >= 0.85 → max boost (+PCE_MAX_BOOST = +0.05)
  //   factor 0.50–0.85 linearly maps to 0..+PCE_MAX_BOOST
  //   factor 0.30–0.50 maps to 0..-PCE_MAX_PENALTY/2  (mild anti-random)
  //   factor < 0.30   → max penalty (-PCE_MAX_PENALTY = -0.04, but capped
  //                     so longshots can STILL surface — penalty never zeros
  //                     out an otherwise-good edge)
  let additive
  if (factor >= 0.85) additive = PCE_MAX_BOOST
  else if (factor >= 0.50) additive = ((factor - 0.50) / 0.35) * PCE_MAX_BOOST
  else if (factor >= 0.30) additive = -((0.50 - factor) / 0.20) * (PCE_MAX_PENALTY / 2)
  else additive = -PCE_MAX_PENALTY

  // Phrase + reasonTag (deterministic — NO LLM)
  let phrase = null
  let reasonTag = null
  if (additive >= PCE_MAX_BOOST * 0.8) {
    phrase = "earned upside profile"
    reasonTag = "PCE:earned"
  } else if (additive >= PCE_MAX_BOOST * 0.5) {
    phrase = "lineup-supported edge"
    reasonTag = "PCE:supported"
  } else if (additive > 0) {
    phrase = "modest lineup conviction"
    reasonTag = "PCE:modest"
  } else if (additive <= -PCE_MAX_PENALTY * 0.8) {
    phrase = "thin-process longshot"
    reasonTag = "PCE:thin"
  } else if (additive < 0) {
    phrase = "ecology-light spot"
    reasonTag = "PCE:ecology_light"
  }

  return {
    factor: round4(factor),
    additive: round4(additive),
    phrase,
    reasonTag,
    gated: true,
    debug: { lineupSpotConv, paConv, modelTrust, sideCoherence, fired: phrase ? `signal:${reasonTag}` : "neutral_mid" },
  }
}

// ── operator-visible counters (reset per buildFeaturedPlays run) ─────────────

let _pceStats = {
  candidatesScored:    0,
  earnedBoostsApplied: 0,
  modestBoostsApplied: 0,
  ecologyLightPenalties: 0,
  thinProcessPenalties:  0,
  neutralBypass:         0,
}
function resetPceStats() {
  _pceStats = {
    candidatesScored:    0,
    earnedBoostsApplied: 0,
    modestBoostsApplied: 0,
    ecologyLightPenalties: 0,
    thinProcessPenalties:  0,
    neutralBypass:         0,
  }
}
function getPceStats() { return { ..._pceStats } }
function recordPceStat(record) {
  _pceStats.candidatesScored++
  if (!record || !record.gated) { _pceStats.neutralBypass++; return }
  if (record.reasonTag === "PCE:earned" || record.reasonTag === "PCE:supported") _pceStats.earnedBoostsApplied++
  else if (record.reasonTag === "PCE:modest") _pceStats.modestBoostsApplied++
  else if (record.reasonTag === "PCE:ecology_light") _pceStats.ecologyLightPenalties++
  else if (record.reasonTag === "PCE:thin") _pceStats.thinProcessPenalties++
  else _pceStats.neutralBypass++
}

// ── helpers ──────────────────────────────────────────────────────────────────

function round4(v) {
  if (!Number.isFinite(v)) return v
  return Math.round(v * 10000) / 10000
}

module.exports = {
  PCE_VERSION,
  PCE_WEIGHT,
  PCE_NEUTRAL,
  PCE_MAX_BOOST,
  PCE_MAX_PENALTY,
  PCE_LINEUP_SPOT_CONVICTION,
  pcePaConviction,
  pceModelTrust,
  pceStatSideCoherence,
  computePlayerConviction,
  resetPceStats,
  getPceStats,
  recordPceStat,
}
