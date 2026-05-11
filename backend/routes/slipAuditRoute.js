"use strict"

/**
 * /api/ws/slip-audit — Lightweight slip semantic audit endpoint.
 *
 * Evaluates a manually submitted slip against current runtime semantics:
 *   - volatility classification (reuses nbaVolatilityResolve + VOLATILITY_RULES)
 *   - tier eligibility (mirrors TIER_TEMPLATES + applyNbaTierOverrides in buildSlipAi)
 *   - correlation exposure (same-game, same-stat, same-player patterns)
 *   - payout realism (combined dec odds math)
 *   - semantic verdict (fake-safe detection, tier identity, archetype summary)
 *
 * V1 scope — POST only, no OCR, no image parsing, no frontend work.
 * Does NOT touch: aiSlips generation, grading, semantic tier logic in buildSlipAi.
 *
 * Input:
 *   POST /api/ws/slip-audit
 *   { sport, legs: [{ player, propType, line, side, odds, sportsbook?, eventId?, matchup? }],
 *     claimedTier? }
 *
 * Output: structured audit response (see schema at end of file)
 *
 * Imported by: workstationRoutes.js (mounted at /api/ws)
 */

const express    = require("express")
const { nbaVolatilityResolve }  = require("../pipeline/nba/nbaVolatilityResolver")
const { classifyVolatility }    = require("../pipeline/shared/buildPortfolioOptimizer")

const router = express.Router()

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

// Families grading-proven to fail in parlay context (Session AF audit)
const SLIP_EXCLUDED_FAMILIES = new Set(["rbis", "outs"])

// Volatility severity: higher rank = more volatile / riskier tier
const VOL_RANK = { safe: 0, balanced: 1, aggressive: 2, lotto: 3 }

// ── MATH HELPERS ──────────────────────────────────────────────────────────────

function num(v)   { const n = Number(v); return Number.isFinite(n) ? n : null }
function r2(x)    { return Math.round(Number(x) * 100) / 100 }
function r4(x)    { return Math.round(Number(x) * 10000) / 10000 }
function normFam(v) { return String(v || "").toLowerCase().replace(/[\s_]+/g, "") }

function americanToDecimal(o) {
  const n = num(o); if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
}
function decimalToAmerican(d) {
  const n = num(d); if (!Number.isFinite(n) || n <= 1) return null
  return n >= 2 ? Math.round((n - 1) * 100) : -Math.round(100 / (n - 1))
}
function impliedFromAmerican(o) {
  const n = num(o); if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

// ── LEG NORMALIZATION ─────────────────────────────────────────────────────────

/**
 * Normalize a raw input leg into a resolved volatility shape.
 * Mirrors normalizeCandidate() in buildSlipAi — but V1 has no modelProb/edge
 * from the caller, so those remain null.
 */
function normalizeLeg(raw, isNba) {
  const player     = String(raw.player || "").trim()
  const statFamily = normFam(raw.propType || raw.statFamily || "")
  const side       = String(raw.side || "").toLowerCase()
  const line       = num(raw.line)
  const odds       = num(raw.odds)
  const dec        = americanToDecimal(odds)

  // Resolve volatility using the same resolver chain as buildSlipAi:
  //   - nbaVolatilityResolve honors snapshotSourced stamps; for manually
  //     submitted legs there is no snapshotSourced, so it falls through to
  //     VOLATILITY_RULES (classifyVolatility). Same result as classifyVolatility
  //     for non-snapshot candidates, but consistent with the canonical path.
  const volResult = isNba
    ? nbaVolatilityResolve({ ...raw, statFamily, odds })
    : { volatility: classifyVolatility({ ...raw, statFamily, odds }), source: "rules" }

  return {
    player,
    statFamily,
    propType:    raw.propType || raw.statFamily || "",
    side,
    line,
    odds,
    dec,
    sportsbook:  raw.sportsbook || raw.book || null,
    eventId:     raw.eventId || null,
    matchup:     raw.matchup || null,
    volatility:  volResult.volatility,
    volSource:   volResult.source,
    excluded:    SLIP_EXCLUDED_FAMILIES.has(statFamily),
  }
}

// ── COMBINED ODDS MATH ────────────────────────────────────────────────────────

function computePayout(legs) {
  let dec = 1
  let hasInvalid = false
  for (const l of legs) {
    if (!Number.isFinite(l.dec)) { hasInvalid = true; continue }
    dec *= l.dec
  }
  return {
    combinedDecimal:  r4(dec),
    combinedAmerican: decimalToAmerican(dec),
    impliedProbability: r4(1 / dec),
    hasInvalidOdds: hasInvalid,
  }
}

// ── TIER ELIGIBILITY ──────────────────────────────────────────────────────────

/**
 * Check which tiers would accept this set of legs.
 * Mirrors TIER_TEMPLATES + applyNbaTierOverrides in buildSlipAi.
 * Self-contained: does NOT import buildSlipAi (keeps audit independent).
 *
 * Note: minModelProb cannot be evaluated (no model data in V1 input).
 * All per-leg maxOdds checks are run. Combined decimalOddsRange is checked.
 */
function checkTierEligibility(legs, isNba, combinedDec) {
  // Shared per-leg checks
  function allLegsPass(allowedVol, forbidVol, maxOdds, allowedSides) {
    for (const l of legs) {
      if (allowedVol.length && !allowedVol.includes(l.volatility)) return false
      if (forbidVol.length  && forbidVol.includes(l.volatility))   return false
      if (maxOdds != null && l.odds > 0 && l.odds > maxOdds)       return false
      if (allowedSides && !allowedSides.includes(l.side))           return false
    }
    return true
  }

  // Same-game / same-stat diversification checks
  const gameGroups  = {}
  const statGroups  = {}
  const players     = new Set()
  for (const l of legs) {
    const gk = l.eventId || (l.matchup ? l.matchup.toLowerCase().replace(/[^a-z0-9]/g, "") : null)
    if (gk) gameGroups[gk] = (gameGroups[gk] || 0) + 1
    statGroups[l.statFamily] = (statGroups[l.statFamily] || 0) + 1
    players.add(l.player.toLowerCase())
  }
  const maxSameGame = Math.max(0, ...Object.values(gameGroups))
  const maxSameStat = Math.max(0, ...Object.values(statGroups))
  const hasDupePlayer = players.size < legs.length

  // ── SAFE ─────────────────────────────────────────────────────────────────────
  const safeAllowedVol  = ["safe", "balanced"]
  const safeForbidVol   = isNba ? ["lotto", "aggressive"] : ["lotto"]
  const safeMaxOdds     = isNba ? 200 : 150
  const safeDecRange    = isNba ? [1.8, 7.5] : [1.8, 4.0]
  const safeMaxPerGame  = isNba ? 2 : 1
  const safeMaxPerStat  = isNba ? 1 : 2
  const safeElig = (
    allLegsPass(safeAllowedVol, safeForbidVol, safeMaxOdds, null) &&
    combinedDec >= safeDecRange[0] && combinedDec <= safeDecRange[1] &&
    maxSameGame <= safeMaxPerGame &&
    maxSameStat <= safeMaxPerStat &&
    !hasDupePlayer
  )

  // ── BALANCED ──────────────────────────────────────────────────────────────────
  const balAllowedVol  = isNba ? ["safe", "balanced"] : ["safe", "balanced", "aggressive"]
  const balAllowedSides = isNba ? null : ["under"]
  const balDecRange    = [3.0, 8.0]
  const balMaxPerGame  = isNba ? 2 : 1
  const balElig = (
    allLegsPass(balAllowedVol, [], 250, balAllowedSides) &&
    combinedDec >= balDecRange[0] && combinedDec <= balDecRange[1] &&
    maxSameGame <= balMaxPerGame &&
    !hasDupePlayer
  )

  // ── AGGRESSIVE ───────────────────────────────────────────────────────────────
  const aggElig = (
    allLegsPass(["balanced", "aggressive", "lotto"], [], 600, null) &&
    combinedDec >= 6.0 && combinedDec <= 120.0 &&
    !hasDupePlayer
  )

  // ── LOTTO ────────────────────────────────────────────────────────────────────
  const lottoElig = (
    allLegsPass(["aggressive", "lotto"], [], 2000, null) &&
    combinedDec >= 20.0 && combinedDec <= 1500.0 &&
    !hasDupePlayer
  )

  return { safe: safeElig, balanced: balElig, aggressive: aggElig, lotto: lottoElig }
}

// ── CORRELATION DETECTION ─────────────────────────────────────────────────────

function detectCorrelation(legs) {
  const warnings = []
  const gameGroups  = {}
  const statGroups  = {}
  const sideGroups  = {}
  const playerNames = {}

  for (const l of legs) {
    const gk = l.eventId || (l.matchup ? l.matchup.toLowerCase().replace(/[^a-z0-9]/g, "") : null)
    if (gk) gameGroups[gk] = (gameGroups[gk] || 0) + 1
    statGroups[l.statFamily] = (statGroups[l.statFamily] || 0) + 1
    const sdKey = `${l.statFamily}:${l.side}`
    sideGroups[sdKey] = (sideGroups[sdKey] || 0) + 1
    const pk = l.player.toLowerCase()
    playerNames[pk] = (playerNames[pk] || 0) + 1
  }

  // Duplicate player
  for (const [p, n] of Object.entries(playerNames)) {
    if (n > 1) warnings.push({ code: "duplicate_player", message: `Duplicate player: "${p}" appears ${n}× — invalid parlay` })
  }
  // Same-game stacking
  for (const [gk, n] of Object.entries(gameGroups)) {
    if (n >= 3) warnings.push({ code: "heavy_same_game", message: `${n} legs from the same game (${gk}) — concentrated correlation risk` })
    else if (n === 2) warnings.push({ code: "same_game_pair", message: `2 legs from the same game (${gk}) — same-game correlation` })
  }
  // Same-stat family stacking
  for (const [fam, n] of Object.entries(statGroups)) {
    if (n >= 2) warnings.push({ code: "same_stat_stack", message: `${n} "${fam}" legs — correlated stat family stack` })
  }
  // Same-stat same-side stacking (pace script)
  for (const [sdk, n] of Object.entries(sideGroups)) {
    const [fam, side] = sdk.split(":")
    if (n >= 2) warnings.push({ code: "same_stat_side_stack", message: `${n} "${fam} ${side}" legs — same-side same-stat correlation (pace/script risk)` })
  }
  // Excluded families
  for (const l of legs) {
    if (l.excluded) warnings.push({ code: "excluded_family", message: `"${l.statFamily}" is excluded from slip parlay context (grading: poor joint win rate)` })
  }

  return warnings
}

// ── VOLATILITY PROFILE ────────────────────────────────────────────────────────

function buildVolatilityProfile(legs) {
  const volList = legs.map((l) => l.volatility)
  const maxVol  = volList.reduce((acc, v) => VOL_RANK[v] > VOL_RANK[acc] ? v : acc, "safe")
  const allSame = volList.every((v) => v === volList[0])
  return {
    legs:               volList,
    combined:           maxVol,
    unanimousVolatility: allSame,
    mixedVolatility:    !allSame,
    volSources:         legs.map((l) => l.volSource),
  }
}

// ── PAYOUT REALISM ────────────────────────────────────────────────────────────

function payoutRealism(combinedDec) {
  if (combinedDec >= 20)   return "extreme"
  if (combinedDec >= 8)    return "high_variance"
  if (combinedDec >= 3)    return "moderate"
  return "low_variance"
}

// ── SEMANTIC TIER ─────────────────────────────────────────────────────────────

/**
 * Determine the honest semantic tier for this slip.
 * First eligible tier in the ladder is the semantic identity.
 * If nothing qualifies, return "ineligible".
 */
function resolveSemanticTier(eligibility) {
  if (eligibility.safe)       return "safe"
  if (eligibility.balanced)   return "balanced"
  if (eligibility.aggressive) return "aggressive"
  if (eligibility.lotto)      return "lotto"
  return "ineligible"
}

// ── TAIL RECOMMENDATION ───────────────────────────────────────────────────────

/**
 * Produce a tail recommendation and explanation.
 * V1: structural verdict only — no modelProb data available.
 */
function buildRecommendation(legs, semanticTier, claimedTier, correlationWarnings, payoutProfile, volProfile) {
  const severeCorr = correlationWarnings.filter((w) =>
    ["duplicate_player", "heavy_same_game", "same_stat_stack", "same_stat_side_stack"].includes(w.code)
  )
  const tierMismatch = claimedTier && claimedTier !== semanticTier

  // Excluded family in slip → Pass immediately
  const hasExcluded = correlationWarnings.some((w) => w.code === "excluded_family")
  if (hasExcluded) return { recommendation: "Pass", reason: "Contains stat family excluded from slip context based on grading evidence." }

  // Semantic ineligible → Fade
  if (semanticTier === "ineligible") return { recommendation: "Fade", reason: "No tier accepts this slip under current semantic rules. Verify odds, leg count, and stat families." }

  // Tier mismatch (user labeled it differently)
  if (tierMismatch) return {
    recommendation: "Fade",
    reason: `Claimed tier "${claimedTier}" does not match semantic reality "${semanticTier}". This slip behaves as a ${semanticTier} play, not ${claimedTier}.`,
  }

  // Duplicate player → Fade (invalid parlay)
  if (correlationWarnings.some((w) => w.code === "duplicate_player")) return { recommendation: "Fade", reason: "Invalid parlay: duplicate player." }

  // Aggressive/lotto with heavy same-stat or same-game stack AND tier mismatch → Fade.
  // If claimedTier matches semanticTier (e.g., user correctly labeled it aggressive),
  // correlation warnings are informational — same-stat stacking IS expected in aggressive slips.
  const isHighVol = ["aggressive", "lotto"].includes(semanticTier)
  const noTierMismatch = !claimedTier || claimedTier === semanticTier
  if (isHighVol && severeCorr.length >= 2 && !noTierMismatch) return { recommendation: "Fade", reason: "High-volatility slip with multiple correlation concerns. Consider splitting into singles." }

  // Balanced or safe with same-game pair — softer warning
  if (severeCorr.some((w) => w.code === "same_game_pair") && ["safe", "balanced"].includes(semanticTier)) {
    return { recommendation: "Lean", reason: "Structurally within tier bounds but same-game pair introduces correlation. Acceptable if intentional." }
  }

  // High-vol tier but otherwise clean
  if (isHighVol) return { recommendation: "Lean", reason: `${semanticTier.charAt(0).toUpperCase() + semanticTier.slice(1)}-tier structure. Combined odds reflect genuine high-variance upside.` }

  // Clean safe/balanced
  return { recommendation: "Tail", reason: `Structurally qualifies as ${semanticTier}. Legs align with tier volatility requirements. No model probability available in V1 to confirm edge.` }
}

// ── ARCHETYPE SUMMARY ─────────────────────────────────────────────────────────

/**
 * Produce a short human-readable archetype label.
 * Mirrors the qualitative descriptions requested.
 */
function buildArchetypeSummary(legs, semanticTier, claimedTier, volProfile, correlationWarnings) {
  const isNonSnap = volProfile.volSources.every((s) => s === "rules")
  const aggCount  = volProfile.legs.filter((v) => v === "aggressive").length
  const lottoCount = volProfile.legs.filter((v) => v === "lotto").length
  const hasSameStat = correlationWarnings.some((w) => w.code === "same_stat_stack")
  const hasSameGame = correlationWarnings.some((w) => ["same_game_pair", "heavy_same_game"].includes(w.code))
  const tierMismatch = claimedTier && claimedTier !== semanticTier

  // Fake-safe detection (most important label)
  if (tierMismatch && claimedTier === "safe" && semanticTier !== "safe") {
    if (aggCount >= 2 && hasSameStat)
      return "Fake-safe correlated stack — aggressive volatility masquerading as a controlled play. Better as singles than parlay."
    if (aggCount >= 2)
      return "Fake-safe high-volatility construction — aggressive legs exceed safe-tier semantics."
    return `Fake-safe mislabeled slip — qualifies as ${semanticTier}, not safe.`
  }

  if (semanticTier === "ineligible")
    return "Ineligible parlay — no current tier accepts this construction. Review odds, families, and leg count."

  if (lottoCount >= 2)
    return "High-volatility ceiling parlay — lotto-tier construction with extreme combined odds. Full parlay hit rate is low by design."

  if (aggCount >= 2 && hasSameStat)
    return "Correlated aggressive stack — same stat family creates concentrated variance. Individually reasonable; combined risk is amplified."

  if (aggCount >= 2 && hasSameGame)
    return "High-volatility same-game aggressive parlay — genuine aggressive-tier structure with correlated exposure."

  if (aggCount >= 1 && semanticTier === "aggressive")
    return "Aggressive-style controlled upside — volatile legs within the correct tier range."

  if (volProfile.unanimousVolatility && semanticTier === "balanced")
    return "Balanced-style controlled upside — moderate variance legs at appropriate combined odds."

  if (semanticTier === "safe")
    return "Conservative safe-tier construction — stable-volatility legs within modest combined odds. Verify model edge before committing."

  return "Mixed-volatility construction — review individual leg quality before placing."
}

// ── ROUTE ─────────────────────────────────────────────────────────────────────

router.post("/", express.json(), (req, res) => {
  try {
    const sportRaw   = String(req.body?.sport || "nba").toLowerCase()
    const isNba      = /^nba$/.test(sportRaw)
    const rawLegs    = Array.isArray(req.body?.legs) ? req.body.legs : []
    const claimedTier = req.body?.claimedTier ? String(req.body.claimedTier).toLowerCase() : null

    if (!rawLegs.length) {
      return res.status(400).json({ error: "legs[] required — provide at least one leg" })
    }
    if (rawLegs.length > 10) {
      return res.status(400).json({ error: "Maximum 10 legs per audit request" })
    }

    // Validate required fields per leg
    for (let i = 0; i < rawLegs.length; i++) {
      const l = rawLegs[i]
      if (!l.player)   return res.status(400).json({ error: `legs[${i}].player required` })
      if (!l.propType && !l.statFamily) return res.status(400).json({ error: `legs[${i}].propType required` })
      if (num(l.odds) == null) return res.status(400).json({ error: `legs[${i}].odds required (American format)` })
    }

    // Normalize
    const legs = rawLegs.map((l) => normalizeLeg(l, isNba))

    // Payout math
    const payoutProfile = computePayout(legs)

    // Tier eligibility
    const tierEligibility = checkTierEligibility(legs, isNba, payoutProfile.combinedDecimal)

    // Volatility profile
    const volProfile = buildVolatilityProfile(legs)

    // Correlation warnings
    const correlationWarnings = detectCorrelation(legs)

    // Semantic tier
    const semanticTier = resolveSemanticTier(tierEligibility)

    // Payout realism label
    const payoutRealism_ = payoutRealism(payoutProfile.combinedDecimal)

    // Semantic violations (specific rule violations that triggered tier rejection)
    const semanticViolations = []
    for (const l of legs) {
      if (["lotto", "aggressive"].includes(l.volatility) && !tierEligibility.safe) {
        semanticViolations.push(`${l.volatility}_leg_in_safe_context: "${l.player}" (${l.statFamily}) is ${l.volatility}-volatility — barred from safe tier`)
      }
    }
    if (payoutProfile.combinedDecimal > 8.0 && !tierEligibility.balanced) {
      semanticViolations.push(`combined_odds_exceed_balanced_ceiling: dec ${r2(payoutProfile.combinedDecimal)} > 8.0`)
    }
    if (payoutProfile.combinedDecimal < 3.0 && !tierEligibility.safe) {
      semanticViolations.push(`combined_odds_below_balanced_floor: dec ${r2(payoutProfile.combinedDecimal)} < 3.0`)
    }

    // Recommendation + archetype
    const { recommendation, reason } = buildRecommendation(legs, semanticTier, claimedTier, correlationWarnings, payoutProfile, volProfile)
    const archetypeSummary = buildArchetypeSummary(legs, semanticTier, claimedTier, volProfile, correlationWarnings)

    // Confidence honesty: low in V1 (no modelProb)
    const confidenceHonesty = {
      level: "structural_only",
      note: "V1 audit: volatility + tier + correlation structure only. No model probability or edge data available from manual input. Do not infer EV from this audit alone.",
    }

    return res.json({
      sport:              sportRaw,
      legCount:           legs.length,
      semanticTier,
      claimedTier:        claimedTier || null,
      tierMismatch:       claimedTier ? claimedTier !== semanticTier : null,
      volatilityProfile:  volProfile,
      correlationWarnings,
      payoutProfile: {
        ...payoutProfile,
        payoutRealism: payoutRealism_,
      },
      tierEligibility,
      semanticViolations,
      tailRecommendation: recommendation,
      recommendationReason: reason,
      archetypeSummary,
      confidenceHonesty,
      auditedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[slip-audit] Error:", err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
})

module.exports = router

/**
 * RESPONSE SCHEMA
 * ───────────────
 * {
 *   sport, legCount, semanticTier, claimedTier, tierMismatch,
 *   volatilityProfile: {
 *     legs: string[],        // per-leg volatility
 *     combined: string,      // worst-case volatility
 *     unanimousVolatility, mixedVolatility, volSources
 *   },
 *   correlationWarnings: [{ code, message }],
 *   payoutProfile: {
 *     combinedDecimal, combinedAmerican, impliedProbability,
 *     payoutRealism: "low_variance"|"moderate"|"high_variance"|"extreme",
 *     hasInvalidOdds
 *   },
 *   tierEligibility: { safe, balanced, aggressive, lotto },
 *   semanticViolations: string[],
 *   tailRecommendation: "Tail"|"Lean"|"Pass"|"Fade",
 *   recommendationReason: string,
 *   archetypeSummary: string,
 *   confidenceHonesty: { level, note },
 *   auditedAt: ISO string
 * }
 */
