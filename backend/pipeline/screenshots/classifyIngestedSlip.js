"use strict"

/**
 * classifyIngestedSlip.js
 *
 * Pure function — no I/O, no side-effects.
 *
 * Scores a normalized parsed_slip across 10 classification dimensions,
 * assigns bettor archetype, ecology tags, and generates a compact rationale.
 *
 * All scores are 0.0–1.0 normalized EXCEPT emotional_bait where 1.0 = HIGH bait
 * (intentionally inverted so queries for "bad" slips use high values).
 *
 * This is a deterministic rule-based classifier v1. Future phases can:
 *   - Swap in an ML scorer without changing the output schema
 *   - Add Andy's preference feedback to update appeal_score
 *   - Add CLV integration to refine hidden_sharpness
 *   - Add outcome feedback to adjust archetype weights
 *
 * The classifier is deliberately conservative — it under-claims rather than
 * over-claims. "unknown" archetype is correct when signals are ambiguous.
 *
 * Usage:
 *   const { classifyIngestedSlip } = require('./classifyIngestedSlip')
 *   const classification = classifyIngestedSlip(normalizedSlip)
 */

const crypto = require("crypto")

// ── helpers ───────────────────────────────────────────────────────────────────

function clamp(lo, hi, x) { return Math.max(lo, Math.min(hi, Number(x) || 0)) }
function round4(x) { return Math.round(Number(x) * 10000) / 10000 }

function americanToDecimal(o) {
  const n = Number(o)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
}

function legImplied(odds) {
  const d = americanToDecimal(odds)
  if (!d) return null
  return 1 / d
}

// ── stat family classification helpers ───────────────────────────────────────

const NBA_FAMILIES = new Set(["points", "rebounds", "assists", "threes", "pra"])
const MLB_FAMILIES = new Set(["hits", "totalBases", "hr", "runs", "rbis", "ks", "outs", "walks"])
const OFFENSIVE_FAMILIES = new Set(["hits", "totalBases", "hr", "runs", "rbis", "points", "threes", "pra"])
const PITCHER_FAMILIES   = new Set(["ks", "outs", "walks"])

function isOffensive(leg) {
  return leg.statFamily && OFFENSIVE_FAMILIES.has(leg.statFamily)
}
function isPitcher(leg) {
  return leg.statFamily && PITCHER_FAMILIES.has(leg.statFamily)
}

// ── DIMENSION 1: realism_score ────────────────────────────────────────────────
// Does the payout/odds structure make real-world mathematical sense?
// 1.0 = fully honest; 0.0 = wildly inflated/misleading payout shown

function scoreRealism(slip) {
  const legs = slip._legs || []
  if (legs.length === 0) return 0.5

  // Check: if combined_dec is available and potential_payout + stake are known
  // verify payout ≈ stake × combinedDec
  if (slip.combined_dec && slip.potential_payout && slip.stake && slip.stake > 0) {
    const expectedPayout = slip.stake * slip.combined_dec
    const ratio = slip.potential_payout / expectedPayout
    // Ratio far > 1 = inflated payout shown; < 0.8 = understated (suspicious)
    if (ratio > 1.5) return clamp(0, 1, 1 - (ratio - 1.5) * 0.4)
    if (ratio < 0.8) return clamp(0, 1, ratio)
    return 0.90  // within 20% of expected — honest
  }

  // Without payout: check combined odds sanity for leg count
  if (slip.combined_dec && legs.length > 0) {
    const minExpected = Math.pow(1.3, legs.length)  // minimum if all -230 legs
    const maxExpected = Math.pow(12.0, legs.length) // maximum if all +1100 legs
    if (slip.combined_dec < minExpected * 0.5) return 0.30  // impossibly low for leg count
    if (slip.combined_dec > maxExpected * 2.0) return 0.25  // impossibly high
    return 0.75  // plausible
  }

  // No odds at all — neutral
  return 0.50
}

// ── DIMENSION 2: structural_quality ──────────────────────────────────────────
// Are legs well-diversified? Appropriate leg count? Sensible combination?
// 1.0 = excellent construction; 0.0 = all same stat, same game, same side

function scoreStructuralQuality(slip) {
  const legs = slip._legs || []
  if (legs.length === 0) return 0.5

  let score = 0.70

  // Leg count sweet spot: 2–4 legs is optimal
  if (legs.length === 1) score *= 0.90       // single = fine but less interesting
  else if (legs.length === 2) score *= 1.00  // excellent
  else if (legs.length === 3) score *= 1.00
  else if (legs.length === 4) score *= 0.95
  else if (legs.length === 5) score *= 0.85  // starts getting degenerate
  else score *= 0.65                          // 6+ = structural overreach

  // Player diversity: penalize same player appearing multiple times
  const playerCounts = {}
  legs.forEach(l => { if (l.player) playerCounts[l.player] = (playerCounts[l.player] || 0) + 1 })
  const maxPlayer = Math.max(...Object.values(playerCounts), 0)
  if (maxPlayer >= 3) score *= 0.60
  else if (maxPlayer === 2) score *= 0.80

  // Game diversity: all from same game = script correlation risk
  const games = new Set(legs.map(l => l.eventId || l.game).filter(Boolean))
  if (games.size === 1 && legs.length >= 3) score *= 0.70
  else if (games.size >= legs.length - 1) score *= 1.05  // good spread (cap at 1.0 later)

  // Stat family diversity
  const fams = new Set(legs.map(l => l.statFamily).filter(Boolean))
  if (fams.size === 1 && legs.length >= 3) score *= 0.75  // all same stat
  else if (fams.size >= 2) score *= 1.02

  return round4(clamp(0, 1, score))
}

// ── DIMENSION 3: correlation_quality ─────────────────────────────────────────
// Are leg outcomes statistically independent? High correlation = risky/misleading
// 1.0 = fully independent; 0.0 = massively correlated (same game, same team overs)

function scoreCorrelationQuality(slip) {
  const legs = slip._legs || []
  if (legs.length <= 1) return 1.0

  let penalties = 0

  // Same-game over concentration
  const gameOverCounts = {}
  legs.forEach(l => {
    const gk = l.eventId || l.game || null
    if (!gk) return
    if (l.side === "over") {
      gameOverCounts[gk] = (gameOverCounts[gk] || 0) + 1
    }
  })
  const maxGameOvers = Math.max(...Object.values(gameOverCounts), 0)
  if (maxGameOvers >= 4) penalties += 0.55
  else if (maxGameOvers === 3) penalties += 0.30
  else if (maxGameOvers === 2) penalties += 0.10

  // Same-team concentration (runs+hits+TB from same team all correlate)
  const teamOffensive = {}
  legs.forEach(l => {
    if (l.team && isOffensive(l) && l.side === "over") {
      teamOffensive[l.team] = (teamOffensive[l.team] || 0) + 1
    }
  })
  const maxTeamOff = Math.max(...Object.values(teamOffensive), 0)
  if (maxTeamOff >= 3) penalties += 0.35
  else if (maxTeamOff === 2) penalties += 0.12

  // Same player multiple props (all hit, HR, TB for same player)
  const playerCounts = {}
  legs.forEach(l => { if (l.player) playerCounts[l.player] = (playerCounts[l.player] || 0) + 1 })
  const maxPlayer = Math.max(...Object.values(playerCounts), 0)
  if (maxPlayer >= 3) penalties += 0.40
  else if (maxPlayer === 2) penalties += 0.15

  return round4(clamp(0, 1, 1 - penalties))
}

// ── DIMENSION 4: hidden_sharpness ─────────────────────────────────────────────
// Does the structure embed genuine edge signals?
// 1.0 = genuinely sharp (alt lines, real edge odds, structural depth)
// 0.0 = all chalk, no process signal

function scoreHiddenSharpness(slip) {
  const legs = slip._legs || []
  if (legs.length === 0) return 0.5

  let score = 0.40  // start at neutral-low

  const odds = legs.map(l => l.odds).filter(Number.isFinite)
  const avgOdds = odds.length ? odds.reduce((a, b) => a + b, 0) / odds.length : null

  // Positive odds legs: some plus-money legs suggest non-chalk thinking
  const plusLegs = legs.filter(l => l.odds != null && l.odds > 0).length
  const pluFrac = plusLegs / legs.length
  if (pluFrac >= 0.5) score += 0.20      // majority plus-money
  else if (pluFrac >= 0.25) score += 0.08

  // Average odds insight: deep chalk (-300+) = no process signal
  if (avgOdds != null) {
    if (avgOdds < -200) score -= 0.20   // all heavy chalk
    else if (avgOdds < -130) score -= 0.05
    else if (avgOdds > 100) score += 0.15  // leaning positive
  }

  // HR legs: high-variance, signal of upside thinking
  const hrLegs = legs.filter(l => l.statFamily === "hr").length
  if (hrLegs >= 1) score += 0.08

  // Internal source: our system already vetted it
  if (slip.source_type === "internal") score += 0.25
  else if (slip.source_type === "personal") score += 0.10

  // Guru source: often reverse-indicator for sharpness
  if (slip.source_type === "guru") score -= 0.15

  // Viral source: engineered for appeal, not edge
  if (slip.source_type === "viral") score -= 0.20

  return round4(clamp(0, 1, score))
}

// ── DIMENSION 5: emotional_bait ───────────────────────────────────────────────
// Psychological manipulation score. 1.0 = HIGH bait (intentionally inverted).
// 0.0 = neutral / process-driven

function scoreEmotionalBait(slip) {
  const legs = slip._legs || []
  let score = 0.10  // start low — most slips are neutral

  // Extreme payout shown: "$10 → $50,000" style
  if (slip.potential_payout && slip.stake) {
    const ratio = slip.potential_payout / slip.stake
    if (ratio >= 1000) score += 0.45
    else if (ratio >= 100) score += 0.25
    else if (ratio >= 20) score += 0.10
  }

  // Viral/guru sources: structurally oriented toward emotional appeal
  if (slip.source_type === "guru")   score += 0.30
  if (slip.source_type === "viral")  score += 0.35
  if (slip.source_type === "twitter") score += 0.15
  if (slip.source_type === "discord") score += 0.10

  // Sportsbook promo: engineered to look attractive
  if (slip.source_type === "sportsbook") score += 0.20

  // Many legs with extremely long combined odds: lottery ticket framing
  if (slip.combined_dec && slip.combined_dec > 500) score += 0.20
  else if (slip.combined_dec && slip.combined_dec > 100) score += 0.10

  // All-positive-odds legs (looks better on paper): slightly bait-y framing
  const allPlus = legs.every(l => l.odds != null && l.odds > 0)
  if (allPlus && legs.length >= 3) score += 0.10

  return round4(clamp(0, 1, score))
}

// ── DIMENSION 6: volatility_structure ────────────────────────────────────────
// Is the volatility mix coherent? 1.0 = clean tier narrative; 0.0 = random mix

function scoreVolatilityStructure(slip) {
  const legs = slip._legs || []
  if (legs.length === 0) return 0.5
  if (legs.length === 1) return 0.80  // single leg = trivially coherent

  // Infer per-leg volatility from odds
  const volCategories = legs.map(l => {
    if (!l.odds) return "unknown"
    const abs = Math.abs(l.odds)
    if (l.odds < 0 && abs <= 150) return "safe"
    if (l.odds < 0 || (l.odds > 0 && l.odds <= 150)) return "balanced"
    if (l.odds > 0 && l.odds <= 300) return "aggressive"
    return "lotto"
  })

  const known = volCategories.filter(v => v !== "unknown")
  if (known.length === 0) return 0.50

  // How many distinct categories?
  const cats = new Set(known)
  if (cats.size === 1) return 0.90  // perfectly coherent single-tier
  if (cats.size === 2) return 0.75  // two adjacent tiers — acceptable
  if (cats.size === 3) return 0.55  // mixed — questionable
  return 0.35                        // random mix — incoherent

}

// ── DIMENSION 7: payout_realism ───────────────────────────────────────────────
// Is the stated payout mathematically honest?
// 1.0 = accurate; 0.0 = wildly overstated

function scorePayoutRealism(slip) {
  if (!slip.combined_dec || !slip.potential_payout || !slip.stake || slip.stake <= 0) {
    return 0.60  // can't assess — neutral-positive (benefit of the doubt)
  }

  const expectedWin  = slip.stake * (slip.combined_dec - 1)
  const statedWin    = slip.potential_payout - slip.stake  // net win

  if (expectedWin <= 0) return 0.40
  const ratio = statedWin / expectedWin

  if (ratio >= 0.90 && ratio <= 1.10) return 0.95  // within 10% = honest
  if (ratio >= 0.80 && ratio <= 1.20) return 0.80
  if (ratio >= 0.60 && ratio <= 1.40) return 0.60
  if (ratio > 1.40) return clamp(0, 1, 1 - (ratio - 1.4) * 0.5)  // overstated
  return clamp(0, 1, ratio * 0.8)  // understated
}

// ── DIMENSION 8: exploit_potential ───────────────────────────────────────────
// Does the structure exploit known book weaknesses or market inefficiencies?
// 1.0 = clear exploit target; 0.0 = no exploit signal

function scoreExploitPotential(slip) {
  const legs = slip._legs || []
  let score = 0.20  // baseline — most slips show no exploit signal

  // Internal slips from our system already target edges
  if (slip.source_type === "internal") score += 0.45
  else if (slip.source_type === "personal") score += 0.25

  // Single-book concentration: could indicate a soft-line target
  const books = new Set(legs.map(l => l.sportsbook).filter(Boolean))
  if (books.size === 1 && slip.source_type !== "sportsbook") score += 0.08

  // Positive-odds legs: markets that haven't been bet down = potential mispricing
  const plusLegs = legs.filter(l => l.odds != null && l.odds >= 100).length
  if (plusLegs >= 2) score += 0.12
  else if (plusLegs >= 1) score += 0.05

  // HR legs: book known to misprice home run props
  const hrCount = legs.filter(l => l.statFamily === "hr").length
  if (hrCount >= 1) score += 0.06

  return round4(clamp(0, 1, score))
}

// ── DIMENSION 9: appeal_score ─────────────────────────────────────────────────
// How emotionally appealing is this to Andy personally?
// Starts as null — populated only after preference feedback accumulates.
// Rule-based seed: offensive overs + moderate volatility = above neutral.

function scoreAppeal(slip, bettorProfile) {
  // If a trained bettor profile exists, use preference signals
  if (bettorProfile?.preference_signals) {
    try {
      const prefs = typeof bettorProfile.preference_signals === "string"
        ? JSON.parse(bettorProfile.preference_signals)
        : bettorProfile.preference_signals
      // Placeholder: in future, compute similarity between slip structure and prefs
      // For now return a weak seed from prefs.sideBias and current slip sides
      const legs = slip._legs || []
      const overFrac = legs.filter(l => l.side === "over").length / Math.max(1, legs.length)
      const prefOverFrac = prefs.sideBias?.over ?? 0.5
      const alignmentScore = 1 - Math.abs(overFrac - prefOverFrac)
      return round4(clamp(0.1, 0.9, alignmentScore))
    } catch (_) {
      // Fall through to default
    }
  }

  // Default seed: no feedback yet
  // Mild preference for offensive overs (system's known strength)
  const legs = slip._legs || []
  const offOvers = legs.filter(l => l.side === "over" && isOffensive(l)).length
  if (offOvers >= 2) return 0.65
  if (offOvers >= 1) return 0.58
  return 0.50
}

// ── DIMENSION 10: ecology_fit ─────────────────────────────────────────────────
// How well does this slip's structure match our system's candidate ecology?
// 1.0 = this is exactly what our model would build; 0.0 = totally alien

function scoreEcologyFit(slip) {
  const legs = slip._legs || []
  if (legs.length === 0) return 0.5

  let score = 0.50

  // Internal slips = perfect fit by definition
  if (slip.source_type === "internal") return 0.95
  if (slip.source_type === "personal") score += 0.20

  // Leg count alignment (our model builds 2–4 leg slips)
  if (legs.length >= 2 && legs.length <= 4) score += 0.10
  else if (legs.length === 1 || legs.length === 5) score += 0.02

  // MLB stat families we model well
  const knownFams = new Set(["hits", "totalBases", "hr", "runs", "rbis", "ks", "outs", "points", "rebounds", "assists", "threes", "pra"])
  const recognizedLegs = legs.filter(l => l.statFamily && knownFams.has(l.statFamily)).length
  const recognitionRate = recognizedLegs / legs.length
  score += recognitionRate * 0.20

  // Appropriate odds range (our slips target -200 to +400)
  const inRange = legs.filter(l => l.odds != null && l.odds >= -200 && l.odds <= 400).length
  const rangeFrac = inRange / legs.length
  score += rangeFrac * 0.10

  // Viral/guru slips = likely misaligned
  if (slip.source_type === "viral") score -= 0.20
  if (slip.source_type === "guru")  score -= 0.15

  return round4(clamp(0, 1, score))
}

// ── COMPOSITE SCORE ───────────────────────────────────────────────────────────

const COMPOSITE_WEIGHTS = {
  realism_score:       0.10,
  structural_quality:  0.15,
  correlation_quality: 0.12,
  hidden_sharpness:    0.20,
  emotional_bait:      -0.15,  // negative: high bait lowers composite
  volatility_structure:0.10,
  payout_realism:      0.08,
  exploit_potential:   0.10,
  ecology_fit:         0.10,
  // appeal_score excluded from composite — subjective / learned
}

function computeComposite(dims) {
  let total = 0
  for (const [key, weight] of Object.entries(COMPOSITE_WEIGHTS)) {
    const val = dims[key]
    if (val != null) total += val * weight
  }
  // Normalize: weights sum to 1.0 (0.10+0.15+0.12+0.20-0.15+0.10+0.08+0.10+0.10 = 0.80 net)
  // Apply scale to bring 0–1 range: a "perfect" slip gets ~0.80; scale to 0–1
  return round4(clamp(0, 1, (total + 0.15) / 0.95))  // offset for bait floor
}

// ── ARCHETYPE CLASSIFICATION ──────────────────────────────────────────────────

function classifyArchetype(dims, slip) {
  const {
    hidden_sharpness,
    emotional_bait,
    structural_quality,
    ecology_fit,
    payout_realism,
    volatility_structure,
  } = dims

  const legs = slip._legs || []
  const avgOdds = legs.map(l => l.odds).filter(Number.isFinite)
  const avgOddsVal = avgOdds.length ? avgOdds.reduce((a, b) => a + b, 0) / avgOdds.length : 0

  // sharp_aggressive: genuine edge, low bait, process-driven
  if (hidden_sharpness >= 0.60 && emotional_bait <= 0.30 && structural_quality >= 0.60) {
    return "sharp_aggressive"
  }

  // safe_grind: internal/personal, low volatility, good structure
  if ((slip.source_type === "internal" || slip.source_type === "personal") &&
      ecology_fit >= 0.70 && emotional_bait <= 0.25) {
    return "safe_grind"
  }

  // guru_bait: attributed to tipster, high emotional bait, low sharpness
  if ((slip.source_type === "guru" || slip.attribution) &&
      emotional_bait >= 0.45 && hidden_sharpness <= 0.40) {
    return "guru_bait"
  }

  // viral_lotto: extreme payout ratio, high bait, payout inflation
  if (emotional_bait >= 0.55 && payout_realism <= 0.50 && (slip.combined_dec || 0) >= 100) {
    return "viral_lotto"
  }

  // sportsbook_trap: from sportsbook source, promoted product
  if (slip.source_type === "sportsbook" && emotional_bait >= 0.30) {
    return "sportsbook_trap"
  }

  // recreational_chase: low structure, moderate bait, average odds lean positive
  if (structural_quality <= 0.50 && emotional_bait >= 0.30 && avgOddsVal > 0) {
    return "recreational_chase"
  }

  return "unknown"
}

// ── ECOLOGY TAGS ──────────────────────────────────────────────────────────────

function buildEcologyTags(slip) {
  const legs = slip._legs || []
  const tags = []

  if (legs.length === 0) return tags

  // Side composition
  const overCount  = legs.filter(l => l.side === "over").length
  const underCount = legs.filter(l => l.side === "under").length
  const total = legs.length
  if (overCount  / total >= 0.75) tags.push("over_heavy")
  if (underCount / total >= 0.75) tags.push("under_heavy")
  if (overCount > 0 && underCount > 0) tags.push("mixed_sides")

  // Stat family tags
  const offLegs    = legs.filter(isOffensive).length
  const pitchLegs  = legs.filter(isPitcher).length
  if (offLegs / total >= 0.75) tags.push("offensive_heavy")
  if (pitchLegs / total >= 0.75) tags.push("pitcher_heavy")

  // Volatility tags from odds
  const lottoLegs = legs.filter(l => l.odds && l.odds >= 350).length
  if (lottoLegs >= 1) tags.push("lotto_legs")
  const safeLegs  = legs.filter(l => l.odds && l.odds <= -130).length
  if (safeLegs / total >= 0.75) tags.push("chalk_heavy")

  // HR tag
  const hrLegs = legs.filter(l => l.statFamily === "hr").length
  if (hrLegs >= 1) tags.push("hr_present")

  // Leg count tag
  if (total === 1)             tags.push("single")
  else if (total === 2)        tags.push("double")
  else if (total === 3)        tags.push("treble")
  else if (total >= 4 && total <= 5) tags.push("parlay")
  else if (total >= 6)         tags.push("mega_parlay")

  // Source tags
  if (slip.source_type === "viral" || slip.source_type === "guru") tags.push("external_signal")
  if (slip.source_type === "internal") tags.push("system_generated")

  return tags
}

// ── ARCHETYPE SECONDARY TAGS ──────────────────────────────────────────────────

function buildArchetypeTags(dims, archetype, slip) {
  const tags = [archetype]
  const legs = slip._legs || []

  if (dims.hidden_sharpness >= 0.65) tags.push("sharp_signal")
  if (dims.emotional_bait   >= 0.65) tags.push("bait_signal")
  if (dims.structural_quality >= 0.80) tags.push("well_constructed")
  if (dims.correlation_quality <= 0.40) tags.push("high_correlation_risk")
  if (dims.payout_realism <= 0.30) tags.push("payout_inflated")
  if ((slip.combined_dec || 0) >= 100) tags.push("extreme_odds")
  if (legs.some(l => l.sportsbook)) tags.push("book_identified")

  return tags
}

// ── RATIONALE GENERATOR ───────────────────────────────────────────────────────

function buildRationale(dims, archetype, slip) {
  const parts = []
  const legs = slip._legs || []

  // Lead with archetype
  const archetypeLabels = {
    sharp_aggressive:   "Sharp/aggressive structure",
    safe_grind:         "Safe process-driven construction",
    guru_bait:          "Guru attribution + low sharpness",
    viral_lotto:        "Viral lotto — engineered for shareability",
    sportsbook_trap:    "Sportsbook promotional structure",
    recreational_chase: "Recreational over-payout chasing",
    unknown:            "Insufficient signals to classify",
  }
  parts.push(archetypeLabels[archetype] || archetype)

  // Top signal
  if (dims.hidden_sharpness >= 0.65) parts.push(`sharp signal (${(dims.hidden_sharpness * 100).toFixed(0)}%)`)
  if (dims.emotional_bait   >= 0.50) parts.push(`bait signal (${(dims.emotional_bait * 100).toFixed(0)}%)`)
  if (dims.correlation_quality <= 0.40) parts.push(`correlation risk (${(dims.correlation_quality * 100).toFixed(0)}%)`)
  if (dims.payout_realism   <= 0.35) parts.push("payout overstated")
  if (dims.structural_quality >= 0.80) parts.push("well diversified")
  if (dims.ecology_fit >= 0.80) parts.push("high ecology alignment")

  // Leg count note
  if (legs.length >= 6) parts.push(`${legs.length}-legger (high complexity)`)

  return parts.slice(0, 4).join(" | ")
}

// ── TOP-LEVEL CLASSIFIER ──────────────────────────────────────────────────────

/**
 * Classify a normalized parsed_slip.
 *
 * @param {object} normalizedSlip   — output of normalizeIngestedSlip()
 * @param {object} [bettorProfile]  — optional bettor_profiles row (for appeal scoring)
 *
 * @returns {object}  Classification row ready for slip_classifications table
 */
function classifyIngestedSlip(normalizedSlip, bettorProfile = null) {
  if (!normalizedSlip) return null

  const slip = normalizedSlip

  const dims = {
    realism_score:       scoreRealism(slip),
    structural_quality:  scoreStructuralQuality(slip),
    correlation_quality: scoreCorrelationQuality(slip),
    hidden_sharpness:    scoreHiddenSharpness(slip),
    emotional_bait:      scoreEmotionalBait(slip),
    volatility_structure:scoreVolatilityStructure(slip),
    payout_realism:      scorePayoutRealism(slip),
    exploit_potential:   scoreExploitPotential(slip),
    appeal_score:        scoreAppeal(slip, bettorProfile),
    ecology_fit:         scoreEcologyFit(slip),
  }

  const composite  = computeComposite(dims)
  const archetype  = classifyArchetype(dims, slip)
  const ecologyTags  = buildEcologyTags(slip)
  const archetypeTags = buildArchetypeTags(dims, archetype, slip)
  const rationale  = buildRationale(dims, archetype, slip)

  const sharpSignal = dims.hidden_sharpness >= 0.65 && dims.emotional_bait <= 0.35 ? 1 : 0
  const baitSignal  = dims.emotional_bait   >= 0.65 && dims.hidden_sharpness <= 0.40 ? 1 : 0
  const viralSignal = dims.payout_realism   <= 0.30 ? 1 : 0

  const id = "sc_" + crypto.createHash("sha256")
    .update(`${slip.id}|v1`)
    .digest("hex").slice(0, 16)

  return {
    id,
    slip_id:              slip.id,
    classifier_version:   "v1",

    // 10 dimensions
    realism_score:        dims.realism_score,
    structural_quality:   dims.structural_quality,
    correlation_quality:  dims.correlation_quality,
    hidden_sharpness:     dims.hidden_sharpness,
    emotional_bait:       dims.emotional_bait,
    volatility_structure: dims.volatility_structure,
    payout_realism:       dims.payout_realism,
    exploit_potential:    dims.exploit_potential,
    appeal_score:         dims.appeal_score,
    ecology_fit:          dims.ecology_fit,

    // composite
    composite_score:      composite,
    sharp_signal:         sharpSignal,
    bait_signal:          baitSignal,
    viral_signal:         viralSignal,

    // archetype
    archetype,
    archetype_tags:       JSON.stringify(archetypeTags),
    ecology_tags:         JSON.stringify(ecologyTags),
    rationale,

    raw_json:             JSON.stringify({ dims, slip_id: slip.id }),
    // Convenience (not stored)
    _dims:                dims,
    _archetype:           archetype,
    _ecologyTags:         ecologyTags,
  }
}

module.exports = { classifyIngestedSlip, scoreRealism, scoreStructuralQuality, scoreCorrelationQuality, scoreHiddenSharpness, scoreEmotionalBait, scoreVolatilityStructure, scorePayoutRealism, scoreExploitPotential, scoreAppeal, scoreEcologyFit, classifyArchetype, buildEcologyTags }
