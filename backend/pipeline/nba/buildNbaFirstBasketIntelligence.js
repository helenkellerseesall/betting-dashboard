"use strict"

/**
 * NBA First Basket Intelligence Layer.
 *
 * Pure-function module. NO file I/O, NO API calls, NO hardcoded players.
 * Decomposes first-basket probability into independently-modeled components:
 *
 *   pFirstBasket = pTipWin × pFirstTouch × pFirstShot|Touch × pMakeShot   (touch-then-shoot)
 *               + pTipLoss × pFirstShotOffSteal × pMakeShot               (defensive-stop scripted)
 *
 * The existing buildNbaFirstBasketEngine.js stays untouched in spirit; this
 * module REFINES its outputs (does not rebuild ingestion or projections).
 *
 * Inputs come from data already produced upstream (predictions, universe
 * rows, optional review-engine state). Caller injects them — keeps this
 * module storage-light and testable.
 *
 * Archetypes are hints, not laws. Confidence evolves via the review engine.
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}
function clamp01(x) { return Math.max(0, Math.min(1, x)) }
function r4(x) { return Math.round(Number(x) * 10000) / 10000 }

function readPos(p) {
  return String(p?.position || p?.primaryPosition || p?.playerPosition || "").trim().toUpperCase()
}
function isCenter(pos) { return /CENTER|\bC\b/.test(String(pos || "")) }
function isPowerForward(pos) { return /POWER FORWARD|\bPF\b/.test(String(pos || "")) }
function isPointGuard(pos) { return /POINT GUARD|\bPG\b/.test(String(pos || "")) }
function isShootingGuard(pos) { return /SHOOTING GUARD|\bSG\b/.test(String(pos || "")) }
function isWing(pos) { return /SMALL FORWARD|\bSF\b/.test(String(pos || "")) }

// ─── archetypes ───────────────────────────────────────────────────────────────

const FB_ARCHETYPES = {
  scripted_opener_scorer: {  // ball-handler with high opening-play usage
    fbBoost: 1.18, touchBoost: 1.10, shotGivenTouch: 1.20, makeBoost: 1.05,
  },
  early_clock_attacker: {    // gets to rim/jumper in <8s
    fbBoost: 1.12, touchBoost: 1.05, shotGivenTouch: 1.15, makeBoost: 1.05,
  },
  opening_post_mismatch: {   // bigs targeted vs smaller defenders on first action
    fbBoost: 1.25, touchBoost: 0.95, shotGivenTouch: 1.30, makeBoost: 1.15,
  },
  jump_ball_finisher: {      // C/PF who finishes lob/cut off the tip win
    fbBoost: 1.20, touchBoost: 1.15, shotGivenTouch: 1.10, makeBoost: 1.10,
  },
  transition_opener: {       // benefits from tip-loss → defensive run-out
    fbBoost: 1.05, touchBoost: 1.05, shotGivenTouch: 1.00, makeBoost: 1.05,
    favorsTipLoss: true,
  },
  corner_spacer_opener: {    // off-ball, gets first shot via skip pass
    fbBoost: 1.08, touchBoost: 0.85, shotGivenTouch: 1.15, makeBoost: 1.10,
  },
  initiator_deferring: {     // brings ball up but rarely takes first shot (PG who passes)
    fbBoost: 0.85, touchBoost: 1.30, shotGivenTouch: 0.55, makeBoost: 1.0,
  },
}

/**
 * Detect archetype from structural signals — never hardcoded names.
 * Returns the dominant archetype label or null. Multiple are possible; only the
 * highest-weight match is returned to keep storage compact.
 */
function detectFbArchetype(player, ctx = {}) {
  const pos = readPos(ctx.repRow || player)
  const usage = num(ctx.usage) ?? num(player.usageRate)
  const isStarter = !!ctx.isStarter
  const archetypeFromPipeline = String(ctx.archetype || "").toLowerCase()

  // Heliocentric initiator who often defers first shot (Cade, LaMelo profile)
  if (isPointGuard(pos) && usage != null && usage >= 27 && (ctx.assistRate ?? 0) >= 28) {
    return "initiator_deferring"
  }

  // Center / PF in opener post mismatch (Embiid, Holmgren, Mobley profile)
  if ((isCenter(pos) || isPowerForward(pos)) && usage != null && usage >= 22) {
    if (ctx.openingPostUsage != null && ctx.openingPostUsage >= 0.18) return "opening_post_mismatch"
    if (isCenter(pos)) return "jump_ball_finisher"
  }

  // Early-clock attacker — high usage wing/SG with strong scoring projection
  if ((isShootingGuard(pos) || isWing(pos)) && usage != null && usage >= 24) {
    return "early_clock_attacker"
  }

  // Scripted opener — top usage on team (caller can pre-compute usage rank)
  if (ctx.usageRank === 1 && usage != null && usage >= 26) {
    return "scripted_opener_scorer"
  }

  // Corner spacer — low usage but high catch-and-shoot rate
  if ((isWing(pos) || isShootingGuard(pos)) && usage != null && usage <= 18 && (ctx.threePAR ?? 0) >= 0.5) {
    return "corner_spacer_opener"
  }

  // Transition opener — bench-adjacent guards who profit from defensive plays
  if (archetypeFromPipeline === "shooter" && usage != null && usage <= 20) {
    return "transition_opener"
  }

  return null
}

// ─── tip-win modeling ─────────────────────────────────────────────────────────

/**
 * Tip-win expectation considers:
 *   - center height advantage proxy (positionTipScore)
 *   - star big presence (high usage center)
 *   - market spread nudge
 *
 * Returns a tipWin probability in [0.30, 0.70] range. Variance preserved.
 */
function estimateTipWinProb(homeCtx, awayCtx) {
  let pHome = 0.5
  const homeBig = pickBestTipper(homeCtx?.starters || [])
  const awayBig = pickBestTipper(awayCtx?.starters || [])
  const homeScore = tipperScore(homeBig)
  const awayScore = tipperScore(awayBig)
  if (homeScore != null && awayScore != null && Math.abs(homeScore - awayScore) > 0.02) {
    pHome += clamp01((homeScore - awayScore) * 0.6) - 0.5 * 0  // shift up to ±0.18
    pHome = clamp01(0.5 + (homeScore - awayScore) * 0.18)
  }

  // Spread nudge (small)
  const spread = num(homeCtx?.spread) ?? num(awayCtx?.spread)
  if (Number.isFinite(spread)) {
    pHome = clamp01(pHome + Math.max(-0.04, Math.min(0.04, -spread * 0.005)))
  }

  // Clamp to keep variance honest
  pHome = clamp01(Math.max(0.30, Math.min(0.70, pHome)))
  return { home: r4(pHome), away: r4(1 - pHome) }
}

function pickBestTipper(starters) {
  if (!Array.isArray(starters) || !starters.length) return null
  const cands = starters.filter((s) => isCenter(readPos(s)) || isPowerForward(readPos(s)))
  if (!cands.length) return starters.find((s) => isCenter(readPos(s))) || null
  return cands.sort((a, b) => (num(b?.usageRate) ?? 0) - (num(a?.usageRate) ?? 0))[0]
}

function tipperScore(s) {
  if (!s) return null
  const pos = readPos(s)
  const u = num(s.usageRate) ?? 18
  let base = 0
  if (isCenter(pos)) base = 0.55
  else if (isPowerForward(pos)) base = 0.40
  else base = 0.25
  // Higher-usage bigs = star centers — small nudge
  return base + Math.min(0.10, (u - 18) / 100)
}

// ─── component modeling ───────────────────────────────────────────────────────

/**
 * P(first touch | team has ball).
 * - PG: high (brings ball up). Initiator-deferring also high.
 * - SG: medium-high.
 * - Wings: medium.
 * - PF: lower.
 * - C: low (unless lob/jump-ball finisher).
 */
function pFirstTouchGivenTeam(player, ctx) {
  const pos = readPos(ctx.repRow || player)
  let p = 0.20
  if (isPointGuard(pos)) p = 0.46
  else if (isShootingGuard(pos)) p = 0.22
  else if (isWing(pos)) p = 0.16
  else if (isPowerForward(pos)) p = 0.10
  else if (isCenter(pos)) p = 0.06
  // Star usage nudge
  const u = num(ctx.usage)
  if (u != null && u >= 28) p += 0.05
  if (u != null && u >= 32) p += 0.03
  return clamp01(p)
}

/**
 * P(takes first shot | got first touch).
 * Many PGs defer; bigs with rim role finish; corner spacers wait for kickout.
 */
function pFirstShotGivenTouch(player, ctx) {
  const pos = readPos(ctx.repRow || player)
  let p = 0.55
  if (isPointGuard(pos)) {
    // PGs as a class defer first action
    p = 0.42
    if (ctx.assistRate != null && ctx.assistRate >= 30) p -= 0.10  // strong passer profile
  } else if (isShootingGuard(pos)) p = 0.62
  else if (isWing(pos)) p = 0.50
  else if (isPowerForward(pos)) p = 0.55
  else if (isCenter(pos)) p = 0.65   // bigs with the ball usually shoot/dunk
  return clamp01(p)
}

/**
 * P(first shot is a basket | first shot taken).
 * Approximation: blend FG% and rim-frequency proxy.
 */
function pMakeFirstShot(player, ctx) {
  const fgPct = num(ctx.fgPct ?? ctx.fieldGoalPct)
  const at = num(ctx.atRimRate)
  let p = fgPct != null ? clamp01(fgPct) : 0.46
  // Rim attempts hit at a higher rate
  if (at != null && at >= 0.40) p = clamp01(p + 0.04)
  return clamp01(p)
}

/**
 * P(first shot off opening defensive stop) — only meaningful for transition openers.
 * Compact heuristic; caller can override with empirical data.
 */
function pFirstShotOffSteal(player, ctx) {
  const pos = readPos(ctx.repRow || player)
  if (isCenter(pos) || isPowerForward(pos)) return 0.04
  if (isPointGuard(pos)) return 0.16
  return 0.10
}

// ─── core composite ───────────────────────────────────────────────────────────

/**
 * Compute the decomposed first-basket probability for a player.
 *
 * Returns:
 *   {
 *     archetype, components: { pTipWin, pFirstTouch, pFirstShotGivenTouch,
 *                              pMakeShot, pFirstShotOffSteal },
 *     pFirstBasket, archetypeBoosts, confidence
 *   }
 *
 * `confidence` is independent of probability — it reflects how trustworthy the
 * components are (data completeness + review-engine archetype trust).
 */
function computeFirstBasketComponents(player, ctx, options = {}) {
  const archetype = detectFbArchetype(player, ctx) || "balanced"
  const boosts = FB_ARCHETYPES[archetype] || { fbBoost: 1, touchBoost: 1, shotGivenTouch: 1, makeBoost: 1 }

  // Apply archetype trust from review-engine state if injected
  const archetypeTrust = num(options?.archetypeTrust?.[archetype])
  const trust = archetypeTrust != null ? clamp01(0.5 + archetypeTrust) : 1.0

  const pTip = num(ctx.pTipWin) ?? 0.5
  const pTouch = clamp01(pFirstTouchGivenTeam(player, ctx) * boosts.touchBoost)
  const pShotGivenTouch = clamp01(pFirstShotGivenTouch(player, ctx) * boosts.shotGivenTouch)
  const pMake = clamp01(pMakeFirstShot(player, ctx) * boosts.makeBoost)
  const pShotOffSteal = clamp01(pFirstShotOffSteal(player, ctx))

  // Touch-then-shoot path: requires team possession
  const pPath_touchShoot = pTip * pTouch * pShotGivenTouch * pMake
  // Defensive-stop path: requires opponent possession (1 - pTip)
  const pPath_defStop = (boosts.favorsTipLoss ? (1 - pTip) : 0) * pShotOffSteal * pMake

  const pFb = clamp01((pPath_touchShoot + pPath_defStop) * boosts.fbBoost * trust)

  // Confidence: completeness + archetype trust
  const completeness = [
    ctx.usage != null,
    ctx.fgPct != null,
    ctx.repRow != null,
    Number.isFinite(num(ctx.pTipWin)),
  ].filter(Boolean).length / 4
  const baseConf = 0.45 + 0.30 * completeness
  const archConf = archetypeTrust != null ? clamp01(0.5 + archetypeTrust) : 0.5
  const confidence = clamp01(0.6 * baseConf + 0.4 * archConf)

  return {
    archetype,
    components: {
      pTipWin: r4(pTip),
      pFirstTouch: r4(pTouch),
      pFirstShotGivenTouch: r4(pShotGivenTouch),
      pMakeShot: r4(pMake),
      pFirstShotOffSteal: r4(pShotOffSteal),
    },
    pFirstBasket: r4(pFb),
    archetypeBoosts: boosts,
    confidence: r4(confidence),
  }
}

// ─── refinement of existing engine output ─────────────────────────────────────

/**
 * Refine outputs from buildNbaFirstBasketEngine using the intelligence layer.
 *
 * Strategy:
 *   - Existing engine gives a raw modelProb (usage × scoring × position).
 *   - This layer computes a decomposed pFirstBasket from possession components.
 *   - Final modelProb is a confidence-weighted blend so we never silently
 *     overwrite the existing engine; we evolve it.
 *
 * Inputs:
 *   players[]              from existing engine (.modelProb, .player, .team, ...)
 *   teamProbabilities[]    from existing engine (.tipWinProb)
 *   reviewState            optional rolling review-engine state
 *   universeIdx            Map<eventId__player, repRow> for context
 *
 * Output: same `players` shape with added intelligence fields.
 */
function refineFirstBasketPlays({ players = [], teamProbabilities = [], universeIdx = null, reviewState = null } = {}) {
  if (!Array.isArray(players) || !players.length) return { players, teamTipProbs: [] }

  // Index team tip probs
  const teamTipIdx = new Map()
  for (const tp of teamProbabilities) {
    teamTipIdx.set(`${tp.eventId}__${tp.team}`, num(tp.tipWinProb) ?? 0.5)
  }

  // Pull archetype trust from review state if present (compact lookup)
  const archetypeTrust = extractArchetypeTrust(reviewState)

  // Compute team-level usage rank for "scripted_opener_scorer" detection
  const usageRankByTeam = new Map()
  for (const p of players) {
    const k = `${p.eventId}__${p.team}`
    if (!usageRankByTeam.has(k)) usageRankByTeam.set(k, [])
    usageRankByTeam.get(k).push({ player: p.player, usage: num(p.usage) ?? 0 })
  }
  for (const [k, list] of usageRankByTeam) {
    list.sort((a, b) => b.usage - a.usage)
    const ranks = new Map()
    list.forEach((x, i) => ranks.set(x.player, i + 1))
    usageRankByTeam.set(k, ranks)
  }

  const refined = []
  for (const p of players) {
    const repRow = universeIdx?.get?.(`${p.eventId}__${String(p.player).toLowerCase()}`) || null
    const teamKey = `${p.eventId}__${p.team}`
    const usageRank = usageRankByTeam.get(teamKey)?.get(p.player) || null
    const ctx = {
      repRow,
      usage: num(p.usage),
      fgPct: num(repRow?.fgPct ?? repRow?.fieldGoalPct),
      atRimRate: num(repRow?.atRimRate),
      threePAR: num(repRow?.threePAR ?? repRow?.threePARate),
      assistRate: num(repRow?.assistRate),
      openingPostUsage: num(repRow?.openingPostUsage),
      pTipWin: teamTipIdx.get(teamKey) ?? 0.5,
      isStarter: true,
      archetype: p.archetype,
      usageRank,
    }
    const intel = computeFirstBasketComponents(p, ctx, { archetypeTrust })

    // Confidence-weighted blend: never overwrite existing engine, evolve it
    const existingProb = num(p.modelProb) ?? intel.pFirstBasket
    const w = intel.confidence
    const blended = clamp01(existingProb * (1 - w) + intel.pFirstBasket * w)

    // Recompute edge / EV against same market row
    const marketImplied = num(p.marketImpliedProb)
    const blendedEdge = marketImplied != null ? r4(blended - marketImplied) : null

    refined.push({
      ...p,
      modelProb: r4(blended),
      modelProbBaseline: existingProb,        // preserve original for diagnostics
      modelProbIntel: intel.pFirstBasket,     // intel-only score
      edge: blendedEdge,
      fbIntel: {
        archetype: intel.archetype,
        components: intel.components,
        pFirstBasket: intel.pFirstBasket,
        confidence: intel.confidence,
        usageRank,
      },
    })
  }

  refined.sort((a, b) => b.modelProb - a.modelProb)
  return {
    players: refined,
    teamTipProbs: teamProbabilities.map((tp) => ({ ...tp, tipMethod: "intel" })),
  }
}

function extractArchetypeTrust(reviewState) {
  if (!reviewState || typeof reviewState !== "object") return {}
  const out = {}
  // Use existing review-engine "archetypes" rolling counts (hits/total)
  const arc = reviewState.archetypes || {}
  for (const [k, v] of Object.entries(arc)) {
    const total = num(v?.total) ?? 0
    const hits = num(v?.hits) ?? 0
    if (total < 5) continue   // need a minimum sample
    const rate = hits / total
    // Map [0..1] → [-0.25, +0.25] trust adjustment
    out[k] = (rate - 0.5) * 0.5
  }
  return out
}

// ─── multi-leg portfolio construction ─────────────────────────────────────────

/**
 * Build diversified FB portfolios. Avoid:
 *   - duplicate archetypes (over-stacked playbook)
 *   - duplicate teams (correlated games)
 *   - same opening-action types (e.g., 3 jump-ball-finishers)
 *
 * Returns three buckets: safe / balanced / lotto with confidence + volatility tags.
 */
function buildFirstBasketPortfolio(refinedPlays, options = {}) {
  const {
    maxLegs = 3,
    minSafeProb = 0.18,
    minBalancedProb = 0.10,
    minLottoProb = 0.05,
  } = options

  const eligible = (refinedPlays || []).filter((p) => Number.isFinite(p.modelProb) && p.modelProb > 0)
  const sortedByProb = [...eligible].sort((a, b) => b.modelProb - a.modelProb)
  const sortedByEdge = [...eligible].filter((p) => Number.isFinite(p.edge) && p.edge > 0)
    .sort((a, b) => b.edge - a.edge)

  function pickDiversified(pool, threshold) {
    const out = []
    const usedTeams = new Set()
    const usedArchetypes = new Set()
    for (const p of pool) {
      if (out.length >= maxLegs) break
      if (p.modelProb < threshold) continue
      if (usedTeams.has(p.team)) continue
      const arc = p.fbIntel?.archetype || "unknown"
      if (usedArchetypes.has(arc) && out.length >= 1) continue
      out.push(p)
      usedTeams.add(p.team)
      usedArchetypes.add(arc)
    }
    return out
  }

  const safe = pickDiversified(sortedByProb, minSafeProb)
  const balanced = pickDiversified(sortedByEdge.length ? sortedByEdge : sortedByProb, minBalancedProb)
  const lotto = pickDiversified(sortedByEdge, minLottoProb)
    .filter((p) => p.modelProb < 0.18)

  function summarize(legs, type) {
    if (!legs.length) return null
    const combinedProb = legs.reduce((acc, p) => acc * p.modelProb, 1)
    const avgConf = legs.reduce((a, p) => a + (p.fbIntel?.confidence ?? 0.5), 0) / legs.length
    return {
      type,
      legCount: legs.length,
      legs: legs.map(({ player, team, modelProb, edge, oddsAmerican, fbIntel }) => ({
        player, team, modelProb, edge, oddsAmerican,
        archetype: fbIntel?.archetype, confidence: fbIntel?.confidence,
      })),
      combinedModelProb: r4(combinedProb),
      avgConfidence: r4(avgConf),
      diversity: {
        teams: [...new Set(legs.map((p) => p.team))].length,
        archetypes: [...new Set(legs.map((p) => p.fbIntel?.archetype || "unknown"))].length,
      },
    }
  }

  return {
    safe: summarize(safe, "safe"),
    balanced: summarize(balanced, "balanced"),
    lotto: summarize(lotto, "lotto"),
  }
}

// ─── snapshot for personal ledger / review engine ─────────────────────────────

/**
 * Compact snapshot for ledger.firstBasketSnapshot — only fields the review
 * engine needs for nightly learning. No giant payloads.
 */
function snapshotFromIntel(refinedPlay) {
  if (!refinedPlay || !refinedPlay.fbIntel) return null
  const c = refinedPlay.fbIntel.components || {}
  return {
    projectedFirstShotProb: r4(c.pFirstTouch * c.pFirstShotGivenTouch),
    projectedFirstTouchProb: c.pFirstTouch,
    tipWinExpectation: c.pTipWin,
    openingPossessionConf: refinedPlay.fbIntel.confidence,
    archetype: refinedPlay.fbIntel.archetype,
    pFirstBasket: refinedPlay.fbIntel.pFirstBasket,
    components: {
      pTipWin: c.pTipWin,
      pFirstTouch: c.pFirstTouch,
      pFirstShotGivenTouch: c.pFirstShotGivenTouch,
      pMakeShot: c.pMakeShot,
    },
  }
}

module.exports = {
  computeFirstBasketComponents,
  estimateTipWinProb,
  detectFbArchetype,
  refineFirstBasketPlays,
  buildFirstBasketPortfolio,
  snapshotFromIntel,
  FB_ARCHETYPES,
}
