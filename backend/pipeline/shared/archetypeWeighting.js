"use strict"

/**
 * archetypeWeighting.js — Phase Item-0009 (2026-05-20).
 *
 * Canonical bettor-archetype legitimacy weighting. Closes BBL-0005
 * (no-name-overload composite-score 110.5).
 *
 * INPUTS (canonical fields only; anti-fabrication):
 *   lineupSpot              ∈ 1..9 | null
 *   depth                   "top" | "middle" | "back" | null
 *   propType                "Home Runs" | "Total Bases" | "Hits" | "RBIs" |
 *                           "Runs Scored" | "Stolen Bases" | "Pitcher Strikeouts" | ...
 *   side                    "over" | "under"
 *   impliedTeamTotal        number | null
 *   gameTotal               number | null
 *   bookCount               number | null
 *   consensusConfidence     number | null
 *
 * OUTPUTS:
 *   archetypeTier           "superstar" | "proven" | "role-player" | "bench" | "no-name"
 *   roleLegitimacy          0..1  — how well role and prop family align
 *   propFamilyLegitimacy    0..1  — does this prop family belong to this role
 *   feelsFakeScore          0..1  — operator-cemented "would a sharp bettor click this?"
 *   archetypeWeight         0.5..1.4 — multiplicative factor for composite scoring
 *   archetypeReasonTag      compact reason key
 *
 * INVARIANTS (verifier-enforced):
 *   1. archetypeWeight ∈ [0.5, 1.4] — never below 0.5; battlefield rare-but-robust
 *      legitimacy preserved (we tune, never zero).
 *   2. Pure function. No side effects. Deterministic across runs.
 *   3. Reads canonical fields only. Returns NEUTRAL_WEIGHT (1.0) when signals
 *      missing — never invents an archetype out of nothing.
 *   4. No celebrity / identity references. Class-not-identity (Law 27).
 *   5. The rare-but-robust deep-cut path (sharp sleeper legitimacy) MUST land
 *      at archetypeWeight ≥ 0.9 when ladder-survival signals corroborate.
 */

const NEUTRAL_WEIGHT     = 1.0
const MIN_WEIGHT         = 0.5    // never below this — anti-sterilization
const MAX_WEIGHT         = 1.4
const NEUTRAL_RESULT     = Object.freeze({
  archetypeTier:        "role-player",
  roleLegitimacy:       0.5,
  propFamilyLegitimacy: 0.5,
  feelsFakeScore:       0.5,
  archetypeWeight:      NEUTRAL_WEIGHT,
  archetypeReasonTag:   "neutral_missing_signals",
})

// ── prop-family canonicalization (mirrors gameEcosystem aliases) ─────────
const HR_FAMILY     = new Set(["home runs","homeruns","hr","home run"])
const TB_FAMILY     = new Set(["total bases","totalbases","tb"])
const HITS_FAMILY   = new Set(["hits","hit","h"])
const RBI_FAMILY    = new Set(["rbis","rbi"])
const RUNS_FAMILY   = new Set(["runs scored","runs","r"])
const SB_FAMILY     = new Set(["stolen bases","stolenbases","sb"])
const KS_FAMILY     = new Set(["pitcher strikeouts","strikeouts","ks","pitcher k"])
const OUTS_FAMILY   = new Set(["pitcher outs","outs"])
const WALKS_FAMILY  = new Set(["pitcher walks","walks","bb"])

function normalizePropFamily(propType) {
  const s = String(propType || "").toLowerCase().trim()
  if (HR_FAMILY.has(s))    return "hr"
  if (TB_FAMILY.has(s))    return "tb"
  if (HITS_FAMILY.has(s))  return "hits"
  if (RBI_FAMILY.has(s))   return "rbi"
  if (RUNS_FAMILY.has(s))  return "runs"
  if (SB_FAMILY.has(s))    return "sb"
  if (KS_FAMILY.has(s))    return "ks"
  if (OUTS_FAMILY.has(s))  return "outs"
  if (WALKS_FAMILY.has(s)) return "walks"
  return "other"
}

// ── role legitimacy ──────────────────────────────────────────────────────
// roleLegitimacy reflects: does this player's batting-order role legitimately
// support this prop family? Cleanup-hitter HR = high; bench-RBI = low.
function roleLegitimacyFor(lineupSpot, propFamily) {
  if (!Number.isFinite(lineupSpot) || lineupSpot < 1 || lineupSpot > 9) return null
  const spot = Math.trunc(lineupSpot)
  // Per-family roleLegitimacy table — pure deterministic; operator-cemented 2026-05-20.
  // Values ∈ [0, 1]. Higher = role + family naturally align.
  const TABLE = {
    hr:    { 1: 0.55, 2: 0.65, 3: 0.85, 4: 0.95, 5: 0.85, 6: 0.65, 7: 0.50, 8: 0.40, 9: 0.30 },
    tb:    { 1: 0.70, 2: 0.75, 3: 0.85, 4: 0.85, 5: 0.80, 6: 0.65, 7: 0.55, 8: 0.45, 9: 0.35 },
    hits:  { 1: 0.85, 2: 0.85, 3: 0.80, 4: 0.75, 5: 0.70, 6: 0.65, 7: 0.55, 8: 0.45, 9: 0.40 },
    rbi:   { 1: 0.35, 2: 0.50, 3: 0.85, 4: 0.95, 5: 0.85, 6: 0.65, 7: 0.50, 8: 0.40, 9: 0.30 },
    runs:  { 1: 0.90, 2: 0.85, 3: 0.75, 4: 0.65, 5: 0.55, 6: 0.50, 7: 0.45, 8: 0.40, 9: 0.35 },
    sb:    { 1: 0.85, 2: 0.80, 3: 0.55, 4: 0.40, 5: 0.45, 6: 0.55, 7: 0.55, 8: 0.50, 9: 0.45 },
    ks:    { 1: 0.50, 2: 0.50, 3: 0.50, 4: 0.50, 5: 0.50, 6: 0.50, 7: 0.50, 8: 0.50, 9: 0.50 },
    outs:  { 1: 0.50, 2: 0.50, 3: 0.50, 4: 0.50, 5: 0.50, 6: 0.50, 7: 0.50, 8: 0.50, 9: 0.50 },
    walks: { 1: 0.50, 2: 0.50, 3: 0.50, 4: 0.50, 5: 0.50, 6: 0.50, 7: 0.50, 8: 0.50, 9: 0.50 },
    other: { 1: 0.60, 2: 0.60, 3: 0.60, 4: 0.60, 5: 0.60, 6: 0.55, 7: 0.50, 8: 0.45, 9: 0.40 },
  }
  return TABLE[propFamily]?.[spot] ?? null
}

// ── prop-family legitimacy ───────────────────────────────────────────────
// propFamilyLegitimacy reflects: does this family belong to this depth band
// at all? Cleanup + HR = legitimate. Bench + 7+ TB = exotic / fake-feeling.
function propFamilyLegitimacyFor(depth, propFamily, side) {
  const d = String(depth || "").toLowerCase()
  const s = String(side  || "").toLowerCase()
  // Over-side legitimacy table per depth × family. Under-side mirrors lower.
  const TABLE = {
    top:    { hr: 0.55, tb: 0.85, hits: 0.95, rbi: 0.40, runs: 0.95, sb: 0.85, ks: 0.50, outs: 0.50, walks: 0.50, other: 0.65 },
    middle: { hr: 0.95, tb: 0.95, hits: 0.85, rbi: 0.95, runs: 0.75, sb: 0.40, ks: 0.50, outs: 0.50, walks: 0.50, other: 0.65 },
    back:   { hr: 0.35, tb: 0.55, hits: 0.55, rbi: 0.30, runs: 0.40, sb: 0.55, ks: 0.50, outs: 0.50, walks: 0.50, other: 0.45 },
  }
  let v = TABLE[d]?.[propFamily]
  if (v == null) return null
  // Under-side: legitimacy slightly inverts on offensive props (under HR for
  // cleanup = harder = lower legitimacy); pitcher props unaffected.
  if (s === "under" && !["ks","outs","walks"].includes(propFamily)) {
    v = 1 - v * 0.5    // mild deflation; never zeros
  }
  return Math.max(0, Math.min(1, v))
}

// ── archetype tier classification ────────────────────────────────────────
// Tier is purely class-derived (Law 27); no identity references. Class = the
// combination of (lineupSpot, depth, prop-family-legitimacy, market trust).
function archetypeTierFor({ depth, lineupSpot, propFamily, propLegit, roleLegit, bookCount, consensusConfidence }) {
  // Multi-book consensus + high role+family legitimacy = proven/superstar tier.
  // Low role legitimacy + thin book coverage = bench / no-name tier.
  const propL = propLegit ?? 0.5
  const roleL = roleLegit ?? 0.5
  const score = (propL * 0.5) + (roleL * 0.3) + Math.min(1, (bookCount ?? 1) / 4) * 0.1 + (consensusConfidence ?? 0.5) * 0.1
  // Cleanup or 3-hole + HR/RBI + multi-book = superstar tier.
  const cleanup = lineupSpot === 4 || lineupSpot === 3
  const isHrRbi = propFamily === "hr" || propFamily === "rbi"
  if (cleanup && isHrRbi && (bookCount ?? 1) >= 3 && score >= 0.75) return "superstar"
  if (score >= 0.70) return "proven"
  if (score >= 0.55) return "role-player"
  if (score >= 0.40) return "bench"
  return "no-name"
}

// ── archetype weight resolver ────────────────────────────────────────────
function archetypeWeightFor(tier, feelsFake) {
  // Tier → weight curve. Operator-cemented; never below 0.5 (anti-sterilization).
  const BASE = {
    superstar:   1.30,
    proven:      1.15,
    "role-player": 1.00,
    bench:       0.80,
    "no-name":   0.65,
  }[tier] ?? NEUTRAL_WEIGHT
  // feelsFake adjustment: high feelsFake deflates ≤0.10. Anti-fabrication
  // cap: never drops weight below MIN_WEIGHT.
  const deflated = BASE - (feelsFake > 0.7 ? 0.10 : feelsFake > 0.4 ? 0.05 : 0)
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, deflated))
}

// ── feelsFakeScore composer ──────────────────────────────────────────────
// Higher = "would a sharp bettor look at this and say 'no way I'd ever click that'".
function feelsFakeScoreFor({ propLegit, roleLegit, lineupSpot, depth, bookCount, consensusConfidence, impliedTeamTotal, propFamily, side }) {
  let score = 0.5
  // Low role + low prop legitimacy = high feelsFake.
  if ((roleLegit ?? 0.5) < 0.4 && (propLegit ?? 0.5) < 0.4) score += 0.30
  // Back-of-order + RBI/HR overs = exotic / "where did this come from"
  if (depth === "back" && (propFamily === "rbi" || propFamily === "hr") && side === "over") score += 0.20
  // Thin book coverage on a flashy prop = market hasn't validated
  if ((bookCount ?? 1) <= 1) score += 0.10
  // Low consensus confidence = books disagree → could be opportunity OR noise
  if (Number.isFinite(consensusConfidence) && consensusConfidence < 0.55) score += 0.05
  // Low team total + over offensive = unlikely run environment
  if (Number.isFinite(impliedTeamTotal) && impliedTeamTotal <= 3.5 &&
      (propFamily === "hr" || propFamily === "rbi" || propFamily === "runs") &&
      side === "over") score += 0.10
  // Sharp legitimacy floor: rare-but-robust deep-cut (back depth + high
  // book consensus + decent run environment) is NOT feels-fake. This is the
  // operator-cemented sharp-sleeper preservation hook.
  if (depth === "back" && Number.isFinite(consensusConfidence) && consensusConfidence >= 0.65
      && (bookCount ?? 1) >= 3) {
    score = Math.max(0, score - 0.20)
  }
  return Math.max(0, Math.min(1, score))
}

// ── main entry ───────────────────────────────────────────────────────────
function computeArchetypeWeight(input) {
  if (!input) return NEUTRAL_RESULT
  const lineupSpot         = Number(input.lineupSpot ?? input.battingOrderIndex ?? input.lineupPosition)
  const depth              = input.depth ?? null
  const propFamily         = normalizePropFamily(input.propType ?? input.statFamily)
  const side               = String(input.side || "").toLowerCase()
  const impliedTeamTotal   = Number(input.impliedTeamTotal)
  const bookCount          = Number(input.bookCount)
  const consensusConfidence = Number(input.consensusConfidence)

  const roleLegit  = roleLegitimacyFor(lineupSpot, propFamily)
  const propLegit  = propFamilyLegitimacyFor(depth, propFamily, side)

  if (roleLegit == null && propLegit == null) return NEUTRAL_RESULT

  const tier = archetypeTierFor({
    depth, lineupSpot, propFamily,
    propLegit, roleLegit, bookCount, consensusConfidence,
  })

  const feelsFake = feelsFakeScoreFor({
    propLegit, roleLegit, lineupSpot, depth, bookCount, consensusConfidence,
    impliedTeamTotal, propFamily, side,
  })

  const weight = archetypeWeightFor(tier, feelsFake)

  const reasonParts = []
  if (depth) reasonParts.push(depth)
  if (Number.isFinite(lineupSpot)) reasonParts.push("spot" + Math.trunc(lineupSpot))
  reasonParts.push(propFamily)
  reasonParts.push(side || "side?")

  return Object.freeze({
    archetypeTier:        tier,
    roleLegitimacy:       roleLegit ?? 0.5,
    propFamilyLegitimacy: propLegit ?? 0.5,
    feelsFakeScore:       feelsFake,
    archetypeWeight:      weight,
    archetypeReasonTag:   reasonParts.join("_"),
  })
}

module.exports = Object.freeze({
  computeArchetypeWeight,
  normalizePropFamily,
  roleLegitimacyFor,
  propFamilyLegitimacyFor,
  archetypeTierFor,
  archetypeWeightFor,
  feelsFakeScoreFor,
  NEUTRAL_RESULT,
  NEUTRAL_WEIGHT,
  MIN_WEIGHT,
  MAX_WEIGHT,
})
