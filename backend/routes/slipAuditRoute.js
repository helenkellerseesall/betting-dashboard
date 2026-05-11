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

// ── MISMATCH SEVERITY ─────────────────────────────────────────────────────────

// Numeric tier rank — used to compute how far off a claimedTier is.
const TIER_ORDER = { safe: 0, balanced: 1, aggressive: 2, lotto: 3, ineligible: 4 }

/**
 * Compute semantic mismatch severity between what was claimed and what is real.
 *
 * Directional — only the CONCERNING direction (actual more volatile than claimed)
 * is flagged as a mismatch. Overcautious labeling (actual safer than claimed)
 * is not dishonest and does not constitute a semantic mismatch.
 *
 * Returns:
 *   "none"        — no claimedTier, or exact match
 *   "overcautious" — claimed is more volatile than actual (e.g., labeled aggressive,
 *                    actually qualifies as safe). Conservative; not a risk concern.
 *   "minor"       — actual is 1 tier MORE volatile than claimed (e.g., safe→balanced)
 *   "major"       — actual is 2+ tiers MORE volatile than claimed (e.g., safe→aggressive)
 */
function mismatchSeverity(claimedTier, semanticTier) {
  if (!claimedTier || claimedTier === semanticTier) return "none"
  const claimedRank = TIER_ORDER[claimedTier] ?? 0
  const actualRank  = TIER_ORDER[semanticTier] ?? 0
  if (actualRank <= claimedRank) return "overcautious"  // actual is safer than labeled — not a risk
  const steps = actualRank - claimedRank
  return steps >= 2 ? "major" : "minor"
}

/**
 * Build a semantic verdict object — separate from betting viability.
 * Callers can use this independently of tailRecommendation.
 *
 * honest: true when the claimed tier is accurate OR overcautious (actual is safer).
 *         false only when the actual tier is MORE volatile than claimed.
 */
function buildSemanticVerdict(claimedTier, semanticTier) {
  const severity = mismatchSeverity(claimedTier, semanticTier)
  // Honest = exact match, overcautious (safer than claimed), or no claim at all.
  // Dishonest = actual is more volatile than claimed (severity minor or major).
  const honest   = severity === "none" || severity === "overcautious"

  let description
  if (!claimedTier) {
    description = `No tier claimed. Structural tier: ${semanticTier}.`
  } else if (claimedTier === semanticTier) {
    description = `Correctly labeled as ${semanticTier}.`
  } else if (severity === "overcautious") {
    description = `Labeled ${claimedTier} — actual structural tier is ${semanticTier} (safer than claimed). Conservative labeling; not a concern.`
  } else if (severity === "minor") {
    description = `Minor mismatch: labeled ${claimedTier}, structural tier is ${semanticTier} — one tier more volatile than claimed. Play is coherent at the correct tier.`
  } else {
    const steps = (TIER_ORDER[semanticTier] ?? 1) - (TIER_ORDER[claimedTier] ?? 0)
    description = `Major mismatch: labeled ${claimedTier}, structural tier is ${semanticTier} — ${steps} tiers more volatile than claimed. Risk is significantly higher than presented.`
  }

  return { honest, mismatchSeverity: severity, description }
}

// ── TAIL RECOMMENDATION ───────────────────────────────────────────────────────

/**
 * Produce a tail recommendation and explanation.
 *
 * Two-axis model:
 *   Axis 1 — Semantic honesty   (separate, now in semanticVerdict field)
 *   Axis 2 — Betting viability  (this function — tailRecommendation)
 *
 * Semantic mismatch alone does NOT force Fade.
 * A mislabeled slip can still be a viable play at the correct tier.
 * The recommendation evaluates structure, correlation, and payout for
 * the ACTUAL tier — not the claimed one.
 *
 * Decision hierarchy:
 *   Absolute blockers → Fade/Pass regardless of anything else
 *   Structural ineligibility → Fade
 *   Mismatch + coherent → Lean (with mismatch narrative)
 *   Mismatch + severe corr + high-vol + major gap → Fade
 *   No mismatch + clean structure → Tail or Lean by vol/corr
 */
function buildRecommendation(legs, semanticTier, claimedTier, correlationWarnings, payoutProfile, volProfile) {
  // ── Pre-classification helpers ─────────────────────────────────────────────
  const hasDupe       = correlationWarnings.some((w) => w.code === "duplicate_player")
  const hasExcluded   = correlationWarnings.some((w) => w.code === "excluded_family")
  const hasSevere     = correlationWarnings.some((w) => w.code === "heavy_same_game")
  const hasModerate   = correlationWarnings.some((w) => ["same_game_pair", "same_stat_stack", "same_stat_side_stack"].includes(w.code))
  const isHighVol     = ["aggressive", "lotto"].includes(semanticTier)
  const isExtremeOdds = payoutProfile.combinedDecimal >= 20
  const severity      = mismatchSeverity(claimedTier, semanticTier)
  // Concerning mismatch: actual tier is MORE volatile than claimed.
  // Overcautious (actual safer than claimed) is NOT a concerning mismatch.
  const tierMismatch  = severity === "minor" || severity === "major"

  // ── ABSOLUTE BLOCKERS ──────────────────────────────────────────────────────
  // These block viability regardless of label or tier.

  if (hasExcluded)
    return { recommendation: "Pass", reason: "Contains a stat family excluded from parlay context — grading evidence shows poor joint win rate. Consider as singles only." }

  if (hasDupe)
    return { recommendation: "Fade", reason: "Invalid parlay: the same player appears more than once." }

  // ── NO TIER ACCEPTS THIS STRUCTURE ────────────────────────────────────────
  if (semanticTier === "ineligible")
    return { recommendation: "Fade", reason: "No tier accepts this construction. Check per-leg odds, leg count, and stat family restrictions." }

  // ── MISMATCH BRANCH — evaluate viability at the ACTUAL tier ───────────────
  if (tierMismatch) {
    // Build the core mismatch note (no value judgment on viability yet)
    const mismatchNote = severity === "major"
      ? `Labeled ${claimedTier} but structural volatility is ${semanticTier} — significantly more aggressive than presented.`
      : `One tier above claimed: behaves as ${semanticTier}, not ${claimedTier}.`

    const corrNote = hasSevere
      ? " Heavy same-game correlation amplifies variance further."
      : hasModerate
        ? " Same-stat correlation noted — legs are related."
        : ""

    const payoutNote = isExtremeOdds
      ? " Extreme combined odds — lottery-range payout."
      : ""

    // Major mismatch + high-vol tier + severe correlation → Fade
    // The combination of being badly mislabeled AND high-vol AND heavily correlated
    // means the structural risk is obscured by the label. That IS a bad bet.
    if (severity === "major" && isHighVol && hasSevere)
      return { recommendation: "Fade", reason: `${mismatchNote}${corrNote} Structure is too volatile and too correlated to recommend at any label.` }

    // Everything else: coherent at actual tier → Lean
    // The play has merit — it's just not what was claimed.
    return {
      recommendation: "Lean",
      reason: `${mismatchNote}${corrNote}${payoutNote} Structure is coherent as a ${semanticTier} play — viable at the correct tier identity.`,
    }
  }

  // ── NO MISMATCH — evaluate structural quality of the actual tier ───────────

  // High-vol + severe correlation (e.g. 3+ legs same game on an aggressive parlay)
  if (isHighVol && hasSevere)
    return { recommendation: "Lean", reason: `${cap(semanticTier)}-tier structure with heavy same-game correlation. Variance is amplified beyond the tier's typical profile — understand the concentration risk.` }

  // High-vol tier (aggressive/lotto) — inherently higher variance, always Lean not Tail
  if (isHighVol)
    return { recommendation: "Lean", reason: `${cap(semanticTier)}-tier construction. Combined odds reflect genuine high-variance upside — viable within this tier's payout range.` }

  // Moderate correlation in safe/balanced — acceptable but flagged
  if (hasModerate && ["safe", "balanced"].includes(semanticTier))
    return { recommendation: "Lean", reason: `${cap(semanticTier)}-tier structure with same-stat or same-game correlation. Legs are compatible but not fully independent. Acceptable if the correlation is intentional.` }

  // Moderate correlation in aggressive (same-stat stack IS expected aggressive behavior)
  if (hasModerate)
    return { recommendation: "Lean", reason: `${cap(semanticTier)}-tier structure. Correlation is expected at this tier — verify individual leg quality before committing.` }

  // Clean structure, correct label, safe/balanced
  return { recommendation: "Tail", reason: `Structurally qualifies as ${semanticTier}. Legs are volatility-consistent and the payout profile fits the tier. No model probability available in V1 — verify edge independently before placing.` }
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

// ── ARCHETYPE SUMMARY ─────────────────────────────────────────────────────────

/**
 * Produce a short human-readable archetype label.
 *
 * Distinguishes:
 *   - Major mismatch (2+ tiers): strong "fake-X" language
 *   - Minor mismatch (1 tier): gentler "labeled conservative, behaves as Y" language
 *   - No mismatch: tier-appropriate texture label
 *
 * The summary should feel sportsbook-intelligent, not alarm-prone.
 * Minor labeling gaps are common and not inherently bad — they just need
 * to be named correctly.
 */
function buildArchetypeSummary(legs, semanticTier, claimedTier, volProfile, correlationWarnings) {
  const aggCount   = volProfile.legs.filter((v) => v === "aggressive").length
  const lottoCount = volProfile.legs.filter((v) => v === "lotto").length
  const balCount   = volProfile.legs.filter((v) => v === "balanced").length
  const hasSameStat  = correlationWarnings.some((w) => w.code === "same_stat_stack")
  const hasSameGame  = correlationWarnings.some((w) => ["same_game_pair", "heavy_same_game"].includes(w.code))
  const hasSevere    = correlationWarnings.some((w) => w.code === "heavy_same_game")
  const severity     = mismatchSeverity(claimedTier, semanticTier)

  // ── INELIGIBLE ─────────────────────────────────────────────────────────────
  if (semanticTier === "ineligible")
    return "Ineligible construction — no tier accepts these legs. Review odds ceiling, leg count, and family restrictions."

  // ── OVERCAUTIOUS (actual safer than claimed) ──────────────────────────────
  // Not deceptive — user labeled it more volatile than it actually is.
  // Describe the actual structure without alarm language.
  if (severity === "overcautious")
    return `Labeled ${claimedTier} but plays as ${semanticTier} — more conservative than presented. ${semanticTier === "safe" ? "Safe-tier construction at a cautious label." : `${cap(semanticTier)}-tier structure within a ${claimedTier} label.`}`

  // ── MAJOR MISMATCH (2+ tiers) ──────────────────────────────────────────────
  // Reserve strong language for genuinely significant labeling gaps.
  if (severity === "major") {
    if (claimedTier === "safe" && lottoCount >= 2)
      return "Extreme mislabeling — lotto-volatility legs presented as safe. High-variance ceiling parlay in a conservative wrapper."
    if (claimedTier === "safe" && aggCount >= 2 && hasSameStat)
      return "Fake-safe correlated stack — aggressive-volatility same-stat legs masquerading as a controlled play. Aggressive upside, not safe construction."
    if (claimedTier === "safe" && aggCount >= 1)
      return `Fake-safe construction — aggressive legs exceed safe-tier semantics. Actual identity: ${semanticTier}.`
    if (claimedTier === "balanced" && lottoCount >= 1)
      return "Mislabeled balanced — contains lotto-volatility legs. Actual identity: lotto-range upside."
    return `Major tier mismatch — labeled ${claimedTier}, structural identity is ${semanticTier}. Volatility is significantly higher than presented.`
  }

  // ── MINOR MISMATCH (1 tier) ────────────────────────────────────────────────
  // Softer language — one tier off is a labeling choice, not necessarily dishonest.
  if (severity === "minor") {
    if (claimedTier === "safe" && semanticTier === "balanced") {
      if (hasSameStat)
        return "Conservative label, balanced behavior — same-stat legs push this into balanced territory. Coherent as balanced upside, not safe."
      return "Labeled conservative but behaves as balanced upside — one tier above safe. Viable at the correct identity."
    }
    if (claimedTier === "balanced" && semanticTier === "aggressive") {
      return hasSameStat
        ? "Balanced label, aggressive behavior — same-stat stack and volatility read as aggressive. Aggressive but playable at correct tier."
        : "One tier above balanced — aggressive construction. Coherent; just needs the right label."
    }
    if (claimedTier === "aggressive" && semanticTier === "lotto") {
      return "Aggressive label, lotto behavior — extreme combined odds push this into lotto territory. High-variance ceiling play."
    }
    return `Minor labeling gap — ${claimedTier} claimed, ${semanticTier} actual. One tier above stated identity. Coherent structure at the correct tier.`
  }

  // ── NO MISMATCH — correctly labeled or no claim ───────────────────────────
  if (semanticTier === "lotto")
    return lottoCount >= 2
      ? "Lotto-tier ceiling parlay — high-variance by design. Full parlay hit rate is low; individual legs may have standalone merit."
      : "Lotto-range construction — extreme combined odds with genuine upside ceiling. Structure coherent for the tier."

  if (semanticTier === "aggressive") {
    if (aggCount >= 2 && hasSameStat)
      return "Aggressive same-stat stack — concentrated variance by design. Correlated exposure amplifies both upside and risk."
    if (hasSameGame)
      return "Aggressive same-game parlay — correlated exposure within a single event. Higher variance than cross-game construction."
    if (aggCount >= 1)
      return "Aggressive-style controlled upside — volatile legs within the correct tier range. Payout profile is realistic for the volatility."
    return "Aggressive-tier construction — higher combined odds with proportionate variance."
  }

  if (semanticTier === "balanced") {
    if (hasSameStat)
      return "Balanced construction with same-stat correlation — moderate variance with related legs. Coherent; correlation is noted, not fatal."
    if (volProfile.unanimousVolatility)
      return "Balanced-style controlled upside — consistent volatility across legs at appropriate combined odds."
    return "Balanced construction — moderate-variance legs with a realistic payout profile."
  }

  if (semanticTier === "safe") {
    if (hasSameStat)
      return "Safe-tier construction with same-stat pairing — low variance but statistically related legs. Review for game-level correlation."
    return "Conservative safe-tier construction — stable volatility, modest combined odds. Verify model edge before committing."
  }

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

    // Semantic verdict — honesty axis (separate from viability)
    const semanticVerdict = buildSemanticVerdict(claimedTier, semanticTier)

    // Recommendation + archetype — viability axis
    const { recommendation, reason } = buildRecommendation(legs, semanticTier, claimedTier, correlationWarnings, payoutProfile, volProfile)
    const archetypeSummary = buildArchetypeSummary(legs, semanticTier, claimedTier, volProfile, correlationWarnings)

    // Confidence honesty: structural only in V1 (no modelProb)
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
      semanticVerdict,
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
 *   semanticVerdict: {              // ← NEW: honesty axis, separate from tailRecommendation
 *     honest: bool,
 *     mismatchSeverity: "none"|"minor"|"major",
 *     description: string,         // human-readable explanation of the labeling gap
 *   },
 *   volatilityProfile: {
 *     legs: string[],              // per-leg volatility
 *     combined: string,            // worst-case volatility across legs
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
