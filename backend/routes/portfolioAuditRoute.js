"use strict"

/**
 * /api/ws/portfolio-audit — Portfolio-level structural exposure analysis.
 *
 * Analyzes multiple slips together for cross-slip patterns:
 *   - player overlap (same player outcome across multiple slips)
 *   - game concentration (multiple slips tied to the same game environment)
 *   - stat-family distribution (threes/points/rebounds monoculture)
 *   - volatility tier clustering (all aggressive, all safe, etc.)
 *   - diversification quality (0-100 structural score)
 *
 * V1 scope — structural analysis only. No EV claims, no bankroll advice,
 * no ROI projections. Honest posture identical to slip-audit V1.
 *
 * Uses same canonical volatility resolver chain as slipAuditRoute:
 *   nbaVolatilityResolve → classifyVolatility → VOLATILITY_RULES
 * Does NOT import slipAuditRoute and does NOT call it internally.
 * Does NOT modify aiSlips, grading, telemetry, or runtime state.
 *
 * For deep per-slip analysis, route callers to POST /api/ws/slip-audit.
 * This endpoint is the portfolio layer above individual slip audits.
 *
 * Input:
 *   POST /api/ws/portfolio-audit
 *   {
 *     sport: "nba" | "mlb",
 *     slips: [
 *       {
 *         slipId?:     string          — optional label
 *         claimedTier?: string         — "safe" | "balanced" | "aggressive" | "lotto"
 *         legs: [
 *           { player, propType, line?, side?, odds?, eventId?, matchup? }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Mounted by: workstationRoutes.js at /api/ws/portfolio-audit
 * TERM 1 restart: YES (workstationRoutes.js modifed to add mount)
 */

const express = require("express")
const { nbaVolatilityResolve } = require("../pipeline/nba/nbaVolatilityResolver")
const { classifyVolatility }   = require("../pipeline/shared/buildPortfolioOptimizer")

const router = express.Router()

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

// Families grading-proven to fail in parlay context (Session AF audit)
const SLIP_EXCLUDED_FAMILIES = new Set(["rbis", "outs"])

// Volatility severity rank (mirrors slipAuditRoute)
const VOL_RANK = { safe: 0, balanced: 1, aggressive: 2, lotto: 3 }

// ── MATH HELPERS ──────────────────────────────────────────────────────────────

function num(v)      { const n = Number(v); return Number.isFinite(n) ? n : null }
function normFam(v)  { return String(v || "").toLowerCase().replace(/[\s_]+/g, "") }
function pct(n, d)   { return d === 0 ? 0 : Math.round((n / d) * 100) }

// ── LEG NORMALIZATION ─────────────────────────────────────────────────────────

/**
 * Normalize a raw leg for portfolio analysis.
 * Mirrors normalizeLeg() in slipAuditRoute — same canonical resolver chain.
 * odds is optional at the portfolio level (game identity does not require odds).
 */
function normalizeLeg(raw, isNba) {
  const player     = String(raw.player || "").trim()
  const statFamily = normFam(raw.propType || raw.statFamily || "")
  const side       = String(raw.side || "").toLowerCase()
  const line       = num(raw.line)
  const odds       = num(raw.odds)

  // Volatility resolver — same chain as slipAuditRoute.normalizeLeg
  const volResult = isNba
    ? nbaVolatilityResolve({ ...raw, statFamily, odds })
    : { volatility: classifyVolatility({ ...raw, statFamily, odds }), source: "rules" }

  return {
    player,
    statFamily,
    side,
    line,
    odds,
    eventId:    raw.eventId  || null,
    matchup:    raw.matchup  || null,
    volatility: volResult.volatility,
    excluded:   SLIP_EXCLUDED_FAMILIES.has(statFamily),
  }
}

// ── SLIP NORMALIZATION ────────────────────────────────────────────────────────

/**
 * Normalize a raw slip for portfolio-level analysis.
 *
 * Semantic tier is classified by dominant volatility (portfolio approximation).
 * Full per-slip tier eligibility (dec odds range, maxPerGame, etc.) requires
 * POST /api/ws/slip-audit — not replicated here to keep portfolio layer clean.
 */
function normalizeSlip(rawSlip, idx, isNba) {
  const slipId      = String(rawSlip.slipId || `slip_${idx + 1}`)
  const claimedTier = rawSlip.claimedTier ? String(rawSlip.claimedTier).toLowerCase() : null
  const rawLegs     = Array.isArray(rawSlip.legs) ? rawSlip.legs : []
  const legs        = rawLegs.map((l) => normalizeLeg(l, isNba))

  // Dominant volatility = worst-case across legs (portfolio-level classification)
  // For full tier gate checking (odds, dec range, maxPerGame), use slip-audit.
  const dominantVol = legs.reduce(
    (acc, l) => VOL_RANK[l.volatility] > VOL_RANK[acc] ? l.volatility : acc,
    "safe"
  )

  return { slipId, claimedTier, legs, semanticTier: dominantVol, legCount: legs.length }
}

// ── PLAYER EXPOSURE ───────────────────────────────────────────────────────────

/**
 * Cross-slip player exposure map.
 * Identifies which players appear across multiple slips — outcome correlation risk.
 */
function buildPlayerExposure(slips) {
  const map = {}
  for (const slip of slips) {
    for (const leg of slip.legs) {
      const pk = leg.player.toLowerCase()
      if (!pk) continue
      if (!map[pk]) map[pk] = { player: leg.player, slipIds: new Set(), legCount: 0, statFamilies: new Set() }
      map[pk].slipIds.add(slip.slipId)
      map[pk].legCount++
      map[pk].statFamilies.add(leg.statFamily)
    }
  }
  return Object.values(map)
    .map((e) => ({
      player:       e.player,
      slipCount:    e.slipIds.size,
      legCount:     e.legCount,
      statFamilies: [...e.statFamilies],
    }))
    .sort((a, b) => b.slipCount - a.slipCount || b.legCount - a.legCount)
}

// ── GAME EXPOSURE ─────────────────────────────────────────────────────────────

/**
 * Cross-slip game concentration map.
 * Multiple slips referencing the same game = correlated environment exposure.
 * Uses eventId when present, falls back to matchup string normalization.
 */
function buildGameExposure(slips) {
  const map = {}
  for (const slip of slips) {
    for (const leg of slip.legs) {
      const gk = leg.eventId ||
        (leg.matchup ? leg.matchup.toLowerCase().replace(/[^a-z0-9@]/g, "") : null)
      if (!gk) continue
      const label = leg.matchup || leg.eventId || gk
      if (!map[gk]) map[gk] = { game: label, slipIds: new Set(), legCount: 0, players: new Set() }
      map[gk].slipIds.add(slip.slipId)
      map[gk].legCount++
      if (leg.player) map[gk].players.add(leg.player)
    }
  }
  return Object.values(map)
    .map((e) => ({
      game:      e.game,
      slipCount: e.slipIds.size,
      legCount:  e.legCount,
      players:   [...e.players],
    }))
    .sort((a, b) => b.slipCount - a.slipCount || b.legCount - a.legCount)
}

// ── STAT FAMILY EXPOSURE ──────────────────────────────────────────────────────

/**
 * Portfolio-wide stat family distribution.
 * "50% threes" means half the portfolio depends on three-point shooting.
 */
function buildStatFamilyExposure(slips) {
  const totalLegs = slips.reduce((s, sl) => s + sl.legs.length, 0)
  const map = {}
  for (const slip of slips) {
    for (const leg of slip.legs) {
      const fam = leg.statFamily
      if (!fam) continue
      if (!map[fam]) map[fam] = { family: fam, legCount: 0, slipIds: new Set() }
      map[fam].legCount++
      map[fam].slipIds.add(slip.slipId)
    }
  }
  return Object.values(map)
    .map((e) => ({
      family:    e.family,
      legCount:  e.legCount,
      slipCount: e.slipIds.size,
      pct:       pct(e.legCount, totalLegs),
    }))
    .sort((a, b) => b.legCount - a.legCount)
}

// ── PORTFOLIO VOLATILITY ──────────────────────────────────────────────────────

/**
 * Distribution of slip semantic tiers and individual leg volatilities.
 * Tier is by dominant-leg classification (portfolio approximation).
 */
function buildPortfolioVolatility(slips) {
  const tierCounts = { safe: 0, balanced: 0, aggressive: 0, lotto: 0 }
  const volCounts  = { safe: 0, balanced: 0, aggressive: 0, lotto: 0 }

  for (const slip of slips) {
    const t = slip.semanticTier
    if (t in tierCounts) tierCounts[t]++
    for (const leg of slip.legs) {
      if (leg.volatility in volCounts) volCounts[leg.volatility]++
    }
  }

  const dominantTier = Object.entries(tierCounts)
    .reduce((a, b) => b[1] > a[1] ? b : a)[0]
  const activeTiers  = Object.values(tierCounts).filter((n) => n > 0).length
  const homogeneous  = activeTiers === 1 && slips.length >= 3
  const highVolSlips = (tierCounts.aggressive || 0) + (tierCounts.lotto || 0)
  const highVolPct   = pct(highVolSlips, slips.length)

  return { tierCounts, dominantTier, volatilityDistribution: volCounts, homogeneous, highVolPct }
}

// ── DIVERSIFICATION SCORE ─────────────────────────────────────────────────────

/**
 * 0-100 structural diversification score. Higher = better diversified.
 *
 * Penalties for concentration — not predictions of outcome.
 * A low score means risk is more correlated than the slip count implies.
 * An intentional same-game parlay stack SHOULD score low — that's correct behavior.
 *
 * Not an EV signal. Does not rank slips by quality. Structural only.
 */
function computeDiversificationScore(slips, playerExposure, gameExposure, statExposure, volProfile) {
  let score = 100
  const deductions = []

  // ── Player overlap penalties ─────────────────────────────────────────────
  for (const pe of playerExposure) {
    if (pe.slipCount >= 3) {
      score -= 10
      deductions.push({ reason: `player_heavy_overlap: "${pe.player}" in ${pe.slipCount} slips`, penalty: 10 })
    } else if (pe.slipCount === 2) {
      score -= 5
      deductions.push({ reason: `player_moderate_overlap: "${pe.player}" in 2 slips`, penalty: 5 })
    }
  }

  // ── Game concentration penalties ─────────────────────────────────────────
  for (const ge of gameExposure) {
    if (ge.slipCount >= 3) {
      score -= 15
      deductions.push({ reason: `game_heavy_concentration: "${ge.game}" in ${ge.slipCount} slips`, penalty: 15 })
    } else if (ge.slipCount === 2) {
      score -= 8
      deductions.push({ reason: `game_moderate_concentration: "${ge.game}" in 2 slips`, penalty: 8 })
    }
  }

  // ── Stat family dominance penalties ──────────────────────────────────────
  const topStat = statExposure[0]
  if (topStat) {
    if (topStat.pct >= 60) {
      score -= 15
      deductions.push({ reason: `stat_monoculture: "${topStat.family}" is ${topStat.pct}% of all legs`, penalty: 15 })
    } else if (topStat.pct >= 40) {
      score -= 8
      deductions.push({ reason: `stat_dominance: "${topStat.family}" is ${topStat.pct}% of all legs`, penalty: 8 })
    }
  }

  // ── Tier homogeneity penalty (3+ slips, all same tier) ───────────────────
  if (volProfile.homogeneous) {
    score -= 10
    deductions.push({ reason: `tier_homogeneity: all slips are ${volProfile.dominantTier}`, penalty: 10 })
  }

  // ── Heavy high-vol concentration ─────────────────────────────────────────
  if (volProfile.highVolPct >= 80 && slips.length >= 2) {
    score -= 5
    deductions.push({ reason: `portfolio_high_vol_skew: ${volProfile.highVolPct}% of slips are aggressive/lotto`, penalty: 5 })
  }

  return { score: Math.max(0, score), deductions }
}

// ── OVERLAP WARNINGS ──────────────────────────────────────────────────────────

/**
 * Per-pattern overlap warnings with severity levels.
 * These are informational — severity indicates how much correlated risk
 * is present, not whether to bet. Structural flags only.
 */
function buildOverlapWarnings(slips, playerExposure, gameExposure, statExposure, volProfile) {
  const warnings = []

  // Player overlaps
  for (const pe of playerExposure) {
    if (pe.slipCount >= 3)
      warnings.push({
        code: "player_heavy_overlap", severity: "high",
        message: `"${pe.player}" appears in ${pe.slipCount} slips — portfolio strongly depends on this player's outcome`,
      })
    else if (pe.slipCount === 2)
      warnings.push({
        code: "player_multi_slip", severity: "moderate",
        message: `"${pe.player}" appears in 2 slips — correlated outcome risk across both`,
      })
  }

  // Game concentration
  for (const ge of gameExposure) {
    if (ge.slipCount >= 3)
      warnings.push({
        code: "game_heavy_concentration", severity: "high",
        message: `${ge.slipCount} slips tied to game "${ge.game}" — heavy same-game portfolio concentration`,
      })
    else if (ge.slipCount === 2)
      warnings.push({
        code: "game_pair_concentration", severity: "moderate",
        message: `2 slips share game "${ge.game}" — correlated game environment`,
      })
  }

  // Stat family dominance
  const topStat = statExposure[0]
  if (topStat && topStat.pct >= 60)
    warnings.push({
      code: "stat_monoculture", severity: "high",
      message: `"${topStat.family}" accounts for ${topStat.pct}% of all legs — portfolio is heavily concentrated in one stat type`,
    })
  else if (topStat && topStat.pct >= 40)
    warnings.push({
      code: "stat_dominance", severity: "moderate",
      message: `"${topStat.family}" is ${topStat.pct}% of all legs — limited stat-family diversification`,
    })

  // Tier homogeneity
  if (volProfile.homogeneous)
    warnings.push({
      code: "tier_homogeneity", severity: "moderate",
      message: `All ${slips.length} slips are ${volProfile.dominantTier}-tier — no volatility diversification across the portfolio`,
    })

  // Heavy high-vol skew
  if (volProfile.highVolPct >= 80 && slips.length >= 2)
    warnings.push({
      code: "portfolio_high_vol_skew", severity: "moderate",
      message: `${volProfile.highVolPct}% of slips are aggressive or lotto tier — high-variance portfolio overall`,
    })

  // Excluded families (per-slip, one warning per slip)
  for (const slip of slips) {
    const excLeg = slip.legs.find((l) => l.excluded)
    if (excLeg)
      warnings.push({
        code: "excluded_family_in_portfolio", severity: "moderate",
        message: `Slip "${slip.slipId}" contains "${excLeg.statFamily}" — excluded from parlay context. Consider as a single-leg bet.`,
      })
  }

  return warnings
}

// ── CONCENTRATION WARNINGS ────────────────────────────────────────────────────

/**
 * Portfolio-level concentration flags — more severe than overlap warnings.
 * These identify when the portfolio as a whole has a structural identity problem:
 * e.g., "this is not 5 diverse slips, it is one same-game parlay cluster."
 */
function buildConcentrationWarnings(slips, playerExposure, gameExposure, volProfile) {
  const warnings = []
  const n = slips.length

  // A single player in the majority of slips
  const majorPlayer = playerExposure.find((pe) => pe.slipCount / n >= 0.5 && n >= 2)
  if (majorPlayer)
    warnings.push({
      code: "single_player_portfolio_risk",
      message: `"${majorPlayer.player}" appears in ${majorPlayer.slipCount}/${n} slips — portfolio outcome is heavily dependent on a single player`,
    })

  // A single game in the majority of slips
  const majorGame = gameExposure.find((ge) => ge.slipCount / n >= 0.5 && n >= 2)
  if (majorGame)
    warnings.push({
      code: "dominant_game_exposure",
      message: `${majorGame.slipCount}/${n} slips tied to game "${majorGame.game}" — portfolio is effectively a same-game cluster, not a diversified book`,
    })

  // All slips aggressive/lotto
  if (
    volProfile.tierCounts.aggressive + volProfile.tierCounts.lotto === n &&
    n >= 2
  )
    warnings.push({
      code: "volatility_cluster_all_high",
      message: "Every slip in the portfolio is aggressive or lotto tier — maximum combined variance. Consider at least one balanced anchor.",
    })

  // All slips safe (minimal upside)
  if (volProfile.tierCounts.safe === n && n >= 3)
    warnings.push({
      code: "portfolio_all_safe",
      message: "All slips are safe-tier — minimal upside ceiling. Add one balanced or aggressive slip for portfolio asymmetry.",
    })

  return warnings
}

// ── PORTFOLIO SUMMARY ─────────────────────────────────────────────────────────

function buildPortfolioSummary(slips, divScore, volProfile, overlapWarnings, concentrationWarnings) {
  const highSev     = overlapWarnings.filter((w) => w.severity === "high").length
  const totalWarns  = overlapWarnings.length + concentrationWarnings.length
  const n           = slips.length

  const hasDominantGame   = concentrationWarnings.some((w) => w.code === "dominant_game_exposure")
  const hasDominantPlayer = concentrationWarnings.some((w) => w.code === "single_player_portfolio_risk")

  if (hasDominantGame && hasDominantPlayer)
    return `Portfolio is heavily concentrated — the same game and the same player dominate across multiple slips. Diversification is largely illusory despite ${n} separate slips.`

  if (hasDominantGame)
    return `${n}-slip portfolio effectively behaves as a same-game cluster — majority of slips share a game environment. Real diversification is limited to player/stat selection within that game.`

  if (hasDominantPlayer)
    return `Portfolio-level dependency on a single player outcome — appears across the majority of slips. Strong player variance amplifies across the entire book.`

  if (divScore.score >= 75 && highSev === 0)
    return `Well-diversified ${n}-slip portfolio — varied players, games, and stat families. Volatility mix is ${volProfile.homogeneous ? `uniformly ${volProfile.dominantTier}` : "varied across tiers"}.`

  // High score but a high-severity structural warning (e.g., stat monoculture) — name the issue
  if (divScore.score >= 75 && highSev > 0) {
    const topWarn = overlapWarnings.find((w) => w.severity === "high")
    return `Largely diversified across players and games, but ${topWarn ? topWarn.message.toLowerCase() : "a high-severity concentration issue was detected"}. Review before committing to the full portfolio.`
  }

  if (divScore.score >= 50 && highSev === 0)
    return `Moderately diversified portfolio — some overlap detected but no severe concentration. ${totalWarns} structural warning${totalWarns !== 1 ? "s" : ""} noted; review before committing.`

  if (divScore.score >= 30)
    return `Concentrated portfolio — ${highSev > 0 ? "high-severity" : "moderate"} overlap across ${n} slips. Portfolio pretends diversification but shows meaningful correlated risk.`

  return `Highly concentrated portfolio — significant player, game, or stat overlap across slips. The ${n}-slip count overstates true diversification; treat as fewer independent outcomes.`
}

// ── STRUCTURAL RISK ASSESSMENT ────────────────────────────────────────────────

/**
 * Portfolio-level structural rating.
 * Rating reflects diversification and concentration quality, NOT win probability.
 * Tail/Lean/Caution/Avoid describes portfolio structure — not individual slip value.
 */
function buildStructuralRiskAssessment(divScore, overlapWarnings, concentrationWarnings, volProfile) {
  const highSev = overlapWarnings.filter((w) => w.severity === "high").length
  const hasCritical = (
    concentrationWarnings.length >= 2 ||
    concentrationWarnings.some((w) =>
      ["single_player_portfolio_risk", "dominant_game_exposure", "volatility_cluster_all_high"].includes(w.code)
    )
  )

  let rating, narrative
  if (hasCritical || divScore.score < 30) {
    rating    = "Avoid"
    narrative = "Portfolio has structural concentration that makes the apparent diversification illusory. Multiple slips are effectively betting the same outcome — correlated loss risk is high."
  } else if (highSev >= 2 || divScore.score < 50) {
    rating    = "Caution"
    narrative = "Meaningful correlation risk across slips. Combined exposure is higher than the slip count implies. Reduce player or game overlap before committing to the full portfolio."
  } else if (highSev >= 1 || divScore.score < 75) {
    rating    = "Lean"
    narrative = "Some concentration detected but portfolio has structural merit. Proceed with awareness of the overlap risks flagged — they amplify tail risk on the concentrated positions."
  } else {
    rating    = "Tail"
    narrative = "Portfolio is well-structured — diversified across players, games, and stat families. No severe concentration or correlated exposure detected."
  }

  return {
    rating,
    narrative,
    confidenceNote: "Structural assessment only. No model probability, historical win rate, or EV inference. Verify individual slip quality via POST /api/ws/slip-audit.",
  }
}

// ── ROUTE ─────────────────────────────────────────────────────────────────────

router.post("/", express.json(), (req, res) => {
  try {
    const sportRaw = String(req.body?.sport || "nba").toLowerCase()
    const isNba    = /^nba$/.test(sportRaw)
    const rawSlips = Array.isArray(req.body?.slips) ? req.body.slips : []

    // ── Input validation ───────────────────────────────────────────────────
    if (!rawSlips.length)
      return res.status(400).json({ error: "slips[] required — provide at least one slip" })
    if (rawSlips.length > 20)
      return res.status(400).json({ error: "Maximum 20 slips per portfolio audit" })

    for (let i = 0; i < rawSlips.length; i++) {
      const s = rawSlips[i]
      if (!Array.isArray(s.legs) || !s.legs.length)
        return res.status(400).json({ error: `slips[${i}].legs[] required — each slip needs at least one leg` })
      for (let j = 0; j < s.legs.length; j++) {
        const l = s.legs[j]
        if (!l.player)
          return res.status(400).json({ error: `slips[${i}].legs[${j}].player required` })
        if (!l.propType && !l.statFamily)
          return res.status(400).json({ error: `slips[${i}].legs[${j}].propType required` })
      }
    }

    // ── Normalize ──────────────────────────────────────────────────────────
    const slips     = rawSlips.map((s, i) => normalizeSlip(s, i, isNba))
    const totalLegs = slips.reduce((sum, s) => sum + s.legs.length, 0)

    // ── Cross-slip analysis ────────────────────────────────────────────────
    const playerExposure        = buildPlayerExposure(slips)
    const gameExposure          = buildGameExposure(slips)
    const statExposure          = buildStatFamilyExposure(slips)
    const volProfile            = buildPortfolioVolatility(slips)
    const divScoreResult        = computeDiversificationScore(slips, playerExposure, gameExposure, statExposure, volProfile)
    const overlapWarnings       = buildOverlapWarnings(slips, playerExposure, gameExposure, statExposure, volProfile)
    const concentrationWarnings = buildConcentrationWarnings(slips, playerExposure, gameExposure, volProfile)
    const portfolioSummary      = buildPortfolioSummary(slips, divScoreResult, volProfile, overlapWarnings, concentrationWarnings)
    const structuralRiskAssessment = buildStructuralRiskAssessment(divScoreResult, overlapWarnings, concentrationWarnings, volProfile)

    // ── Per-slip summaries (lightweight — no full tier gate audit) ─────────
    const slipSummaries = slips.map((s) => ({
      slipId:       s.slipId,
      legCount:     s.legCount,
      semanticTier: s.semanticTier,
      claimedTier:  s.claimedTier || null,
      tierMismatch: s.claimedTier ? s.claimedTier !== s.semanticTier : null,
      players:      [...new Set(s.legs.map((l) => l.player))],
      statFamilies: [...new Set(s.legs.map((l) => l.statFamily))],
      volatilities: s.legs.map((l) => l.volatility),
    }))

    return res.json({
      sport:                       sportRaw,
      slipCount:                   slips.length,
      totalLegs,
      portfolioVolatility:         volProfile,
      playerExposure,
      gameExposure,
      statFamilyExposure:          statExposure,
      overlapWarnings,
      concentrationWarnings,
      diversificationScore:        divScoreResult.score,
      diversificationDeductions:   divScoreResult.deductions,
      slipSummaries,
      portfolioSummary,
      structuralRiskAssessment,
      confidenceHonesty: {
        level: "structural_only",
        note:  "Portfolio V1: structural exposure + concentration analysis only. No EV, no ROI projections, no bankroll advice. For per-slip depth, use POST /api/ws/slip-audit.",
      },
      analysedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[portfolio-audit] Error:", err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
})

module.exports = router

/**
 * RESPONSE SCHEMA
 * ───────────────
 * {
 *   sport, slipCount, totalLegs,
 *
 *   portfolioVolatility: {
 *     tierCounts: { safe, balanced, aggressive, lotto },
 *     dominantTier: string,
 *     volatilityDistribution: { safe, balanced, aggressive, lotto },  // per-leg counts
 *     homogeneous: bool,    // all slips same tier (3+ slips)
 *     highVolPct: number,   // pct of slips that are aggressive/lotto
 *   },
 *
 *   playerExposure: [{ player, slipCount, legCount, statFamilies }],
 *   gameExposure:   [{ game, slipCount, legCount, players }],
 *   statFamilyExposure: [{ family, legCount, slipCount, pct }],
 *
 *   overlapWarnings:       [{ code, severity: "high"|"moderate", message }],
 *   concentrationWarnings: [{ code, message }],
 *
 *   diversificationScore: number,           // 0-100 structural score
 *   diversificationDeductions: [{ reason, penalty }],
 *
 *   slipSummaries: [{
 *     slipId, legCount, semanticTier, claimedTier, tierMismatch,
 *     players, statFamilies, volatilities
 *   }],
 *
 *   portfolioSummary: string,               // human-readable portfolio narrative
 *   structuralRiskAssessment: {
 *     rating: "Tail"|"Lean"|"Caution"|"Avoid",
 *     narrative: string,
 *     confidenceNote: string,
 *   },
 *
 *   confidenceHonesty: { level: "structural_only", note: string },
 *   analysedAt: ISO string
 * }
 */
