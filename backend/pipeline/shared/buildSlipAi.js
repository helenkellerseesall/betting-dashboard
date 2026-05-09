"use strict"

/**
 * Shared Slip Construction AI.
 *
 * Sits ON TOP of existing slip engines, projection engines, portfolio optimizer,
 * line shopping, timing intelligence, and CLV layers. Never duplicates them.
 *
 * Contract:
 *   const result = buildAiSlips({
 *     candidates,        // array of normalized leg candidates (any sport)
 *     timingResult,      // optional, from buildMarketTiming()
 *     lineShopping,      // optional, from buildLineShopping()
 *     bookState,         // optional, from loadBookState()
 *     ledgerState,       // optional, personal ledger (for archetype/stat history)
 *     portfolioBaseline, // optional, exposure already committed (single bets)
 *     options: { sport, date, maxPerTier }
 *   })
 *
 *   result = {
 *     slips: { safe, balanced, aggressive, lotto },   // each is array of slip objects
 *     summary,                                         // short text overview
 *     warnings,                                        // construction warnings
 *   }
 *
 * Each slip:
 *   {
 *     id, tier, legs[], legCount,
 *     combinedDecimalOdds, combinedAmericanOdds,
 *     combinedModelProb, combinedImpliedProb, edge, ev,
 *     volatility, correlationScore,
 *     reasoning: "Strong CLV + balanced ladder",
 *     factors: { projection, clv, timing, book, diversification }
 *   }
 */

const { classifyVolatility } = require("./buildPortfolioOptimizer")
const { isOffensiveAttackStat } = require("./normalizers")

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function clamp(lo, hi, x) { return Math.max(lo, Math.min(hi, Number(x))) }
function r2(x) { return Math.round(Number(x) * 100) / 100 }
function r4(x) { return Math.round(Number(x) * 10000) / 10000 }

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

function normFam(v) {
  return String(v || "").toLowerCase().replace(/[\s_]+/g, "")
}
function legId(c) {
  return c.id || [c.player, c.statFamily || c.propType, c.side, c.line, c.book || c.sportsbook].join("|")
}
function gameKey(c) {
  if (c.eventId) return String(c.eventId)
  if (c.matchup) return String(c.matchup).toLowerCase().replace(/[^a-z0-9]/g, "")
  return null
}
function isFirstBasket(c) { return normFam(c.statFamily || c.propType).includes("firstbasket") }

// ── CANDIDATE NORMALIZATION ───────────────────────────────────────────────────

/**
 * Normalize a candidate from any source (tracked_best, board rows, etc.)
 * into a unified shape for scoring + construction.
 */
function normalizeCandidate(raw) {
  if (!raw) return null
  const player    = raw.player || raw.playerName
  const statFamily = raw.statFamily || raw.propFamilyKey || raw.propType
  const side      = String(raw.side || "").toLowerCase()
  const line      = num(raw.line ?? raw.point)
  const odds      = num(raw.odds ?? raw.oddsAmerican)
  if (!player || !statFamily || odds == null) return null

  const modelProb   = num(raw.modelProb ?? raw.predictedProbability ?? raw.calibratedConfidence ?? raw.confidence)
  const impliedProb = impliedFromAmerican(odds)
  const edge        = num(raw.edge ?? raw.edgeProbability ?? (modelProb != null && impliedProb != null ? modelProb - impliedProb : null))

  return {
    id:            legId(raw),
    player,
    team:          raw.team || raw.teamCode,
    statFamily:    String(statFamily),
    propType:      raw.propType || statFamily,
    side,
    line,
    odds,
    book:          raw.book || raw.sportsbook,
    eventId:       raw.eventId,
    matchup:       raw.matchup,
    modelProb,
    impliedProb,
    edge,
    confidence:    num(raw.calibratedConfidence ?? raw.confidence ?? raw.confidenceRaw),
    tier:          raw.tier || raw.confidenceTier || raw.bucket,
    archetype:     raw.archetype || raw.archetypeTag,
    closingOdds:   raw.closingOdds,
    clv:           raw.clv,
    // NBA-1: Preserve snapshotSourced volatility for lotto-stamped candidates.
    // buildNbaSnapshotCandidates() (workstationRoutes.js FIX Q4) stamps
    // volatility: "lotto" on PRA combo candidates and snapshotSourced: true.
    // Without this guard, classifyVolatility() overwrites with "aggressive"
    // (VOLATILITY_RULES: combo/pra → aggressive), blocking PRA from the lotto
    // slip tier (TIER_TEMPLATES.lotto.allowedVolatility = ["aggressive","lotto"]).
    // Guard is narrow: only preserves "lotto" stamps from confirmed snapshot
    // source. MLB candidates never set snapshotSourced — no MLB behavior change.
    // VOLATILITY_RULES itself is NOT modified.
    volatility:    (raw.snapshotSourced === true && raw.volatility === "lotto")
                     ? "lotto"
                     : classifyVolatility(raw),
    raw,
  }
}

// ── MULTI-FACTOR LEG SCORING ──────────────────────────────────────────────────

/**
 * Return weighted score (0..1) plus per-factor breakdown.
 * NOTE: No single factor is allowed to dominate.
 */
function scoreLeg(leg, ctx = {}) {
  const { timingMap, bookState, ledgerStats, exposureMap } = ctx

  const factors = {}
  let total = 0
  let weight = 0

  // 1. Projection strength (30%): edge × confidence.
  //
  // ECOLOGY FIX: cap modelProb factor to [0.50, 0.55] so suppression-side
  // probability compression (under bets get 0.65+ modelProb just from line
  // shape) does not unfairly inflate composite over true edge quality.
  // Same fix as buildFeaturedPlays.scoreCandidate.
  const edge = leg.edge ?? 0
  const conf = leg.modelProb ?? leg.confidence ?? 0
  const probFactor = Math.max(0.50, Math.min(0.55, conf || 0.5))
  const projectionScore = clamp(0, 1, (edge * 5) * probFactor)
  factors.projection = r4(projectionScore)
  total += projectionScore * 0.30; weight += 0.30

  // 2. CLV quality (15%): use closing odds if present, else stat-family historical CLV
  let clvScore = 0.5
  if (Number.isFinite(leg.clv)) {
    clvScore = leg.clv > 0.02 ? 1 : leg.clv > 0 ? 0.7 : leg.clv > -0.02 ? 0.4 : 0.2
  } else if (ledgerStats?.statFamilyClv?.[normFam(leg.statFamily)] != null) {
    const hist = ledgerStats.statFamilyClv[normFam(leg.statFamily)]
    clvScore = hist > 0.01 ? 0.85 : hist > 0 ? 0.65 : hist > -0.01 ? 0.45 : 0.25
  }
  factors.clv = r4(clvScore)
  total += clvScore * 0.15; weight += 0.15

  // 3. Timing urgency (10%)
  let timingScore = 0.5
  const tc = lookupTiming(leg, timingMap)
  if (tc) {
    if (tc.urgency === "immediate") timingScore = 0.95
    else if (tc.urgency === "soon")  timingScore = 0.75
    else if (tc.urgency === "patient") timingScore = 0.55
    else if (tc.urgency === "wait")   timingScore = 0.40
    else if (tc.urgency === "avoid")  timingScore = 0.15
    if (tc.state === "stale_window") timingScore = Math.min(1, timingScore + 0.10)
    if (tc.state === "steam")        timingScore = Math.min(1, timingScore + 0.05)
  }
  factors.timing = r4(timingScore)
  total += timingScore * 0.10; weight += 0.10

  // 4. Sportsbook edge (10%)
  let bookScore = 0.5
  const bookKey = String(leg.book || "").toLowerCase()
  const bookProf = bookState?.books?.[bookKey]
  if (bookProf) {
    if (bookProf.avgClv > 0.015) bookScore = 0.85
    else if (bookProf.avgClv > 0) bookScore = 0.65
    else if (bookProf.avgClv > -0.01) bookScore = 0.45
    else bookScore = 0.30
  }
  factors.book = r4(bookScore)
  total += bookScore * 0.10; weight += 0.10

  // 5. Volatility appropriateness (10%) — boost for safe in safe pools, etc.
  factors.volatility = r4(0.5)  // adjusted per-tier in tier filter
  total += 0.5 * 0.10; weight += 0.10

  // 6. Archetype stability (5%): from leg.archetype + ledger archetype stats
  let archScore = 0.5
  if (leg.archetype && ledgerStats?.archetypeRoi?.[String(leg.archetype).toLowerCase()] != null) {
    const roi = ledgerStats.archetypeRoi[String(leg.archetype).toLowerCase()]
    archScore = roi > 0.10 ? 0.9 : roi > 0 ? 0.65 : roi > -0.10 ? 0.45 : 0.25
  }
  factors.archetype = r4(archScore)
  total += archScore * 0.05; weight += 0.05

  // 7. Ladder risk penalty (5%): high alt lines reduce score
  let ladderScore = 0.7
  if (Number.isFinite(leg.line)) {
    if (isFirstBasket(leg)) ladderScore = 0.50  // FB inherently volatile
    else if (leg.line >= 4.5) ladderScore = 0.50
    else if (leg.line >= 3.5) ladderScore = 0.65
  }
  factors.ladder = r4(ladderScore)
  total += ladderScore * 0.05; weight += 0.05

  // 8. Portfolio diversification bonus/penalty (5%)
  let divScore = 0.7
  if (exposureMap) {
    const playerCount = exposureMap.byPlayer?.[leg.player]?.count || 0
    const gameCount   = (gameKey(leg) && exposureMap.byGame?.[gameKey(leg)]?.count) || 0
    const statCount   = exposureMap.byStat?.[normFam(leg.statFamily)]?.count || 0
    if (playerCount >= 2) divScore -= 0.30
    else if (playerCount === 1) divScore -= 0.10
    if (gameCount >= 4) divScore -= 0.20
    if (statCount >= 5) divScore -= 0.15
  }
  divScore = clamp(0, 1, divScore)
  factors.diversification = r4(divScore)
  total += divScore * 0.05; weight += 0.05

  // 9. Tier hint bonus (small).
  //
  // TRUST-QUALIFICATION FIX: halved (was 0.10 / 0.05). Tier assignment is
  // modelProb-driven, so on MLB slates ELITE/STRONG tiers are 100%
  // under-assigned (33 ELITE unders / 0 ELITE overs today). The full
  // 0.10 boost gave a phantom +10 composite advantage to ELITE unders
  // in slip ranking — preventing offensive overs from seed-winning even
  // when their actual edge was higher. Mirrors the same fix applied to
  // buildFeaturedPlays.scoreCandidate last session.
  let tierBoost = 0
  const tierStr = String(leg.tier || "").toUpperCase()
  if (tierStr.includes("ELITE"))    tierBoost = 0.05
  else if (tierStr.includes("STRONG"))   tierBoost = 0.025
  else if (tierStr.includes("LOTTO"))    tierBoost = -0.05
  else if (tierStr.includes("FADE"))     tierBoost = -0.30
  factors.tierBoost = tierBoost

  const composite = clamp(0, 1, (total / weight) + tierBoost)
  return { composite: r4(composite), factors }
}

function lookupTiming(leg, timingMap) {
  if (!timingMap) return null
  const fullKey = [
    String(leg.eventId || ""),
    String(leg.player || "").toLowerCase().trim(),
    normFam(leg.statFamily),
    String(leg.side || "").toLowerCase(),
    String(leg.line ?? "any"),
  ].join("|")
  const direct = timingMap.get(fullKey)
  if (direct) return direct
  const shortKey = fullKey.split("|").slice(1).join("|")
  for (const [k, v] of timingMap) {
    if (k.split("|").slice(1).join("|") === shortKey) return v
  }
  return null
}

/**
 * Tie-break / soft rank bias for AGGRESSIVE + LOTTO slip assembly only.
 * Prefer offensive-market legs with real edge + timing — NOT a fake overs boost:
 * only nudges ordering when composite scores are similar.
 */
function offensiveAttackTextureBonus(leg, timingMap) {
  // isOffensiveAttackStat from normalizers.js — canonical shared definition.
  // Handles exclusion of outs/strikeout/pitcherk/walks and includes doubles/triples
  // (previously omitted from the inline check here — aligned with buildFeaturedPlays).
  const offensive = isOffensiveAttackStat(leg.statFamily || leg.propType)
  let b = 0
  if (offensive && leg.side === "over" && (leg.edge ?? 0) > 0.035) b += 0.032
  if ((leg.volatility === "aggressive" || leg.volatility === "lotto") && (leg.edge ?? 0) > 0.04) b += 0.022
  const tc = lookupTiming(leg, timingMap)
  if (tc?.state === "steam" || tc?.urgency === "immediate") b += 0.014
  return Math.min(0.07, b)
}

// ── LEG REASONING ─────────────────────────────────────────────────────────────

function legReasoning(leg, score, timingMap) {
  const tags = []
  const f = score.factors
  if (f.projection >= 0.65) tags.push("strong edge")
  if (f.clv       >= 0.75)  tags.push("+CLV")
  else if (f.clv  <= 0.30)  tags.push("-CLV risk")
  const tc = lookupTiming(leg, timingMap)
  if (tc?.urgency === "immediate") tags.push("bet now")
  if (tc?.state   === "stale_window") tags.push("stale book")
  if (tc?.state   === "steam") tags.push("steam")
  if (f.book      >= 0.75) tags.push("soft book")
  if (f.archetype >= 0.75) tags.push("archetype trust")
  if (leg.volatility === "safe")       tags.push("safe lane")
  else if (leg.volatility === "balanced") tags.push("balanced texture")
  else if (leg.volatility === "aggressive") tags.push("attack lane")
  if (leg.volatility === "lotto") tags.push("lotto upside")
  return tags.slice(0, 3).join(" + ")
}

// ── TIER TEMPLATES ────────────────────────────────────────────────────────────

const TIER_TEMPLATES = {
  safe: {
    legCountRange:    [2, 3],
    minModelProb:     0.55,
    maxOdds:          150,
    decimalOddsRange: [1.8, 4.0],
    allowedVolatility: ["safe", "balanced"],
    forbidVolatility:  ["lotto"],
    maxPerGame:        1,
    maxPerStat:        2,
    maxFb:             0,
  },
  balanced: {
    legCountRange:    [2, 3],
    minModelProb:     0.45,
    maxOdds:          250,
    decimalOddsRange: [3.0, 8.0],
    allowedVolatility: ["safe", "balanced", "aggressive"],
    forbidVolatility:  [],
    maxPerGame:        1,
    maxPerStat:        2,
    maxFb:             1,
  },
  aggressive: {
    legCountRange:    [2, 4],
    minModelProb:     0.20,
    maxOdds:          600,
    decimalOddsRange: [6.0, 120.0],
    allowedVolatility: ["balanced", "aggressive", "lotto"],
    forbidVolatility:  [],
    maxPerGame:        2,
    maxPerStat:        2,
    maxFb:             1,
  },
  lotto: {
    legCountRange:    [3, 5],
    minModelProb:     0.10,
    maxOdds:          2000,
    decimalOddsRange: [20.0, 1500.0],
    allowedVolatility: ["aggressive", "lotto"],
    forbidVolatility:  [],
    maxPerGame:        2,
    maxPerStat:        3,
    maxFb:             2,
  },
}

// ── DIVERSIFICATION CHECK DURING ASSEMBLY ─────────────────────────────────────

function canAddLeg(slipLegs, candidate, tpl) {
  // No duplicate player
  if (slipLegs.some((l) => String(l.player || "").toLowerCase() === String(candidate.player || "").toLowerCase())) {
    return { ok: false, reason: "duplicate_player" }
  }
  // Same-game cap
  const gk = gameKey(candidate)
  if (gk) {
    const sameGame = slipLegs.filter((l) => gameKey(l) === gk).length
    if (sameGame >= tpl.maxPerGame) return { ok: false, reason: "max_per_game" }
  }
  // Same-stat cap
  const fam = normFam(candidate.statFamily)
  const sameStat = slipLegs.filter((l) => normFam(l.statFamily) === fam).length
  if (sameStat >= tpl.maxPerStat) return { ok: false, reason: "max_per_stat" }
  // FB cap
  if (isFirstBasket(candidate)) {
    const fbCount = slipLegs.filter(isFirstBasket).length
    if (fbCount >= tpl.maxFb) return { ok: false, reason: "max_fb" }
  }
  // Forbidden volatility
  if (tpl.forbidVolatility?.includes(candidate.volatility)) {
    return { ok: false, reason: "volatility_forbidden" }
  }
  // Same-side same-stat-same-game = pace/script correlation
  if (gk && candidate.side === "over") {
    const overSameGame = slipLegs.filter((l) => gameKey(l) === gk && l.side === "over").length
    if (overSameGame >= 1 && tpl.legCountRange[1] <= 3) {
      return { ok: false, reason: "script_correlation" }
    }
  }
  return { ok: true }
}

// ── SLIP ASSEMBLY ─────────────────────────────────────────────────────────────

function combineLegs(legs) {
  let dec = 1, modelProb = 1
  for (const l of legs) {
    const d = americanToDecimal(l.odds)
    if (!Number.isFinite(d)) return null
    dec *= d
    modelProb *= clamp(0.001, 0.999, l.modelProb ?? 0.5)
  }
  const americanCombined = decimalToAmerican(dec)
  const impliedCombined = 1 / dec
  const edge = modelProb - impliedCombined
  const ev   = (modelProb * (dec - 1)) - (1 - modelProb)  // per $1
  return {
    combinedDecimalOdds:  r4(dec),
    combinedAmericanOdds: americanCombined,
    combinedModelProb:    r4(modelProb),
    combinedImpliedProb:  r4(impliedCombined),
    edge:                 r4(edge),
    ev:                   r4(ev),
  }
}

function buildSlipsForTier(tier, scoredLegs, ctx, maxSlips) {
  const tpl = TIER_TEMPLATES[tier]
  if (!tpl) return []

  // Filter to candidates eligible for this tier.
  //
  // TRUST-QUALIFICATION FIX: safe tier accepts a premium-edge override —
  // legs with modelProb >= 0.50 AND edge >= 0.12 qualify even if below the
  // tier's standard minModelProb threshold (0.55) AND even if their
  // volatility classification (aggressive) wouldn't normally pass the
  // safe template's allowedVolatility list. Without this, offensive
  // overs (whose modelProb is structurally compressed below 0.55 and
  // whose volatility is often classified aggressive by line shape) can
  // NEVER graduate into safe slips regardless of edge quality. The
  // override admits genuinely premium edges (12%+) at a still-positive
  // probability floor (50%+) — preserving safe identity while letting
  // elite offense qualify when the process is high-conviction.
  const eligible = scoredLegs.filter((sl) => {
    const leg = sl.leg
    const isPremiumEdgeForSafe = tier === "safe" &&
      (leg.modelProb ?? 0) >= 0.50 &&
      (leg.edge ?? 0) >= 0.12
    if (tpl.allowedVolatility?.length && !tpl.allowedVolatility.includes(leg.volatility)) {
      if (!isPremiumEdgeForSafe) return false
    }
    if (tpl.forbidVolatility?.length  &&  tpl.forbidVolatility.includes(leg.volatility))  return false
    if (tpl.minModelProb != null && (leg.modelProb ?? 0) < tpl.minModelProb) {
      if (!isPremiumEdgeForSafe) return false
    }
    if (tpl.maxOdds != null && Math.abs(leg.odds) > tpl.maxOdds && leg.odds > 0 && leg.odds > tpl.maxOdds) return false
    if (tier === "safe" && (leg.odds > tpl.maxOdds)) return false
    return true
  })

  // Sort by composite; aggressive/lotto tiers add a tiny texture bias so seeds
  // aren't always "balanced unders + one HR" when scores cluster.
  const textureRank = (sl) =>
    sl.composite + ((tier === "aggressive" || tier === "lotto") ? offensiveAttackTextureBonus(sl.leg, ctx.timingMap) : 0)
  eligible.sort((a, b) => textureRank(b) - textureRank(a) || b.composite - a.composite)

  // For aggressive tier: re-order so volatile (aggressive/lotto volatility) legs
  // seed first, balanced/safe legs fill supporting roles only.
  // Preserves composite ordering within each subgroup — no score changes.
  // Balanced legs remain available as fill; only seed position changes.
  if (tier === "aggressive") {
    const volSeeds = eligible.filter(sl => sl.leg.volatility === "aggressive" || sl.leg.volatility === "lotto")
    const otherSeeds = eligible.filter(sl => sl.leg.volatility !== "aggressive" && sl.leg.volatility !== "lotto")
    eligible.length = 0
    eligible.push(...volSeeds, ...otherSeeds)
  }

  const slips = []
  const seenSignatures = new Set()
  const legUsageCount = new Map()  // legId -> times appeared across this tier's slips

  // Cross-tier player cap: a single player can appear in at most 3 slips ACROSS
  // ALL TIERS combined (safe + balanced + aggressive + lotto). This is what
  // breaks "same-player slip spam" on the board.
  const MAX_PLAYER_GLOBAL = 3
  const playerKey = (leg) => String(leg.player || "").toLowerCase()
  const globalCount = ctx.globalPlayerCount instanceof Map ? ctx.globalPlayerCount : null

  for (let i = 0; i < eligible.length && slips.length < maxSlips; i++) {
    const seed = eligible[i]
    // Don't re-seed the same leg
    if ((legUsageCount.get(seed.leg.id) || 0) >= 1) continue
    // Skip if seed player already saturated globally
    if (globalCount && (globalCount.get(playerKey(seed.leg)) || 0) >= MAX_PLAYER_GLOBAL) continue
    const slipLegs    = [seed.leg]
    const slipScores  = [seed]
    const seedUsed    = new Set([seed.leg.id])

    const targetMax = tpl.legCountRange[1]
    const targetMin = tpl.legCountRange[0]

    for (let j = i + 1; j < eligible.length && slipLegs.length < targetMax; j++) {
      const cand = eligible[j]
      if (seedUsed.has(cand.leg.id)) continue
      // Cap each leg's appearances across the tier's slips at 2
      if ((legUsageCount.get(cand.leg.id) || 0) >= 2) continue
      // Skip if this candidate's player is globally saturated
      if (globalCount && (globalCount.get(playerKey(cand.leg)) || 0) >= MAX_PLAYER_GLOBAL) continue
      const check = canAddLeg(slipLegs, cand.leg, tpl)
      if (!check.ok) continue
      slipLegs.push(cand.leg)
      slipScores.push(cand)
      seedUsed.add(cand.leg.id)
    }

    if (slipLegs.length < targetMin) continue

    // Fix 6: try the longest leg subset that fits within decimalOddsRange, walking
    // down from the built length to targetMin. Prevents 5-leg lotto combos
    // (dec=8,000–25,000) from discarding viable 3-leg combos (dec=231–439),
    // and stops aggressive slips from exploding past the 120 ceiling and falling
    // back into balanced DNA. All tier constraints and odds validation still apply.
    let validSlipLegs = null
    let validCombined = null
    for (let len = slipLegs.length; len >= targetMin; len--) {
      const candidate = slipLegs.slice(0, len)
      const comb = combineLegs(candidate)
      if (!comb) continue
      const dec = comb.combinedDecimalOdds
      if (dec >= tpl.decimalOddsRange[0] && dec <= tpl.decimalOddsRange[1]) {
        validSlipLegs = candidate
        validCombined = comb
        break
      }
    }
    if (!validSlipLegs) continue

    // slipScores is parallel to slipLegs — trim to match the accepted leg count
    const validSlipScores = slipScores.slice(0, validSlipLegs.length)

    // Skip if this exact leg-set already exists
    const signature = validSlipLegs.map((l) => l.id).sort().join("##")
    if (seenSignatures.has(signature)) continue

    seenSignatures.add(signature)

    // Build reasoning from top factors
    const avgFactors = aggregateFactors(validSlipScores)
    const reasoning  = slipReasoning(tier, avgFactors, validSlipLegs, ctx.timingMap)
    const narrative  = slipNarrative(tier, avgFactors, validSlipLegs, ctx.timingMap)

    const id = `${ctx.date || ""}##${tier.toUpperCase()}##${validSlipLegs.map((l) => `${(l.player||"").toLowerCase()}|${normFam(l.statFamily)}|${l.side}|${l.line}`).join("__")}`

    slips.push({
      id,
      tier:               tier.toUpperCase(),
      legCount:           validSlipLegs.length,
      legs:               validSlipLegs.map(serializeLeg),
      combinedDecimalOdds: validCombined.combinedDecimalOdds,
      combinedAmericanOdds: validCombined.combinedAmericanOdds,
      combinedModelProb:   validCombined.combinedModelProb,
      combinedImpliedProb: validCombined.combinedImpliedProb,
      edge:                validCombined.edge,
      ev:                  validCombined.ev,
      volatility:          tier,
      compositeScore:      r4(validSlipScores.reduce((s, x) => s + x.composite, 0) / validSlipScores.length),
      factors:             avgFactors,
      reasoning,
      narrative,
      legReasonings:       validSlipScores.map((s) => ({
        legId:    s.leg.id,
        player:   s.leg.player,
        reason:   legReasoning(s.leg, s, ctx.timingMap),
      })),
    })

    // Track usage so each leg appears in at most 2 slips and is only seed once
    for (const l of validSlipLegs) {
      legUsageCount.set(l.id, (legUsageCount.get(l.id) || 0) + 1)
      if (globalCount) {
        const pk = playerKey(l)
        globalCount.set(pk, (globalCount.get(pk) || 0) + 1)
      }
    }
  }

  return slips
}

function aggregateFactors(scoredList) {
  const keys = ["projection", "clv", "timing", "book", "archetype", "ladder", "diversification"]
  const out = {}
  for (const k of keys) {
    const vals = scoredList.map((x) => x.factors?.[k]).filter((v) => Number.isFinite(v))
    out[k] = vals.length ? r4(vals.reduce((s, v) => s + v, 0) / vals.length) : null
  }
  return out
}

function slipReasoning(tier, factors, legs, timingMap) {
  const tags = []

  // Edge / projection
  if (factors.projection >= 0.65) tags.push("strong edge")
  else if (factors.projection >= 0.45) tags.push("solid edge")

  // CLV
  if (factors.clv >= 0.70) tags.push("+CLV")
  else if (factors.clv <= 0.35) tags.push("CLV risk")

  // Timing
  const urgent = legs.some((l) => {
    const tc = lookupTiming(l, timingMap)
    return tc?.urgency === "immediate" || tc?.state === "stale_window"
  })
  if (urgent) tags.push("urgent timing")

  // Book
  if (factors.book >= 0.70) tags.push("soft book")

  // Diversification
  if (factors.diversification >= 0.65) tags.push("low correlation")
  else if (factors.diversification <= 0.40) tags.push("correlated")

  // Tier flavor
  const flavor = {
    safe:       "safe lane",
    balanced:   "balanced ladder",
    aggressive: "attack surface mix",
    lotto:      "explosive upside book",
  }[tier]
  if (flavor) tags.push(flavor)

  return tags.slice(0, 4).join(" + ")
}

/**
 * Generate a longer-form explanation of why this slip exists.
 * Used by the workstation UI's expanded slip card.
 */
function slipNarrative(tier, factors, legs, timingMap) {
  const games = new Set(legs.map((l) => gameKey(l)).filter(Boolean))
  const stats = new Set(legs.map((l) => normFam(l.statFamily)))
  const books = new Set(legs.map((l) => String(l.book || "").toLowerCase()).filter(Boolean))

  const bullets = []
  // Game/stat diversity
  if (games.size === legs.length) bullets.push(`${legs.length} legs across ${games.size} different games`)
  else                            bullets.push(`${legs.length} legs (${games.size} games / ${stats.size} stat families)`)

  if (factors.projection >= 0.65)         bullets.push("Strong combined edge with high model probability")
  else if (factors.projection >= 0.45)    bullets.push("Solid edge above market implied probability")

  if (factors.clv >= 0.75)                bullets.push("Historically strong CLV on these stat families")
  else if (factors.clv <= 0.30)           bullets.push("Watch CLV — beats this market less consistently")

  // Timing
  const urgent = legs.filter((l) => {
    const tc = lookupTiming(l, timingMap)
    return tc?.urgency === "immediate" || tc?.state === "stale_window"
  })
  if (urgent.length) bullets.push(`${urgent.length} leg${urgent.length === 1 ? "" : "s"} with urgent timing — recommend placing now`)

  if (factors.book >= 0.75)               bullets.push("Composed mostly of soft books with positive book CLV history")
  if (books.size >= legs.length)          bullets.push("Each leg shopped to its best book")

  // Tier flavor
  const flavor = {
    safe:       "Built around stable archetypes and short ladders",
    balanced:   "Balanced ladder mix — moderate variance with EV",
    aggressive: "Higher payout target — favors timing + offensive texture where edges cluster",
    lotto:      "Longshot upside — small stake, asymmetric payoff",
  }[tier]
  if (flavor) bullets.push(flavor)

  return bullets.slice(0, 5)
}

function serializeLeg(leg) {
  return {
    id:           leg.id,
    player:       leg.player,
    team:         leg.team,
    eventId:      leg.eventId,
    matchup:      leg.matchup,
    statFamily:   normFam(leg.statFamily),
    propType:     leg.propType,
    side:         leg.side,
    line:         leg.line,
    odds:         leg.odds,
    book:         leg.book,
    modelProb:    leg.modelProb,
    edge:         leg.edge,
    volatility:   leg.volatility,
  }
}

// ── EXPOSURE FROM PORTFOLIO BASELINE ──────────────────────────────────────────

function buildBaselineExposure(portfolioBaseline) {
  if (!portfolioBaseline) return null
  // Already-computed exposureMap from buildPortfolioOptimizer
  if (portfolioBaseline.byPlayer || portfolioBaseline.byStat) return portfolioBaseline
  // Else derive from raw bets array
  if (Array.isArray(portfolioBaseline.bets)) {
    const { buildExposureMap } = require("./buildPortfolioOptimizer")
    return buildExposureMap(portfolioBaseline.bets, portfolioBaseline.slipBets || [])
  }
  return null
}

// ── LEDGER STAT ROLLUP ────────────────────────────────────────────────────────

function rollupLedgerStats(ledgerState) {
  const out = { statFamilyClv: {}, archetypeRoi: {} }
  if (!ledgerState?.bets?.length) return out

  const byStat = {}
  const byArch = {}
  for (const b of ledgerState.bets) {
    const fam = normFam(b.statFamily || b.modelSnapshot?.propFamilyKey)
    if (fam && Number.isFinite(b.clvSnapshot?.clv?.implied)) {
      if (!byStat[fam]) byStat[fam] = []
      byStat[fam].push(b.clvSnapshot.clv.implied)
    }
    const arch = String(b.modelSnapshot?.archetype || "").toLowerCase()
    if (arch && Number.isFinite(b.profit)) {
      if (!byArch[arch]) byArch[arch] = { profit: 0, stake: 0 }
      byArch[arch].profit += b.profit
      byArch[arch].stake  += b.stake || 0
    }
  }
  for (const [k, arr] of Object.entries(byStat)) {
    out.statFamilyClv[k] = arr.reduce((s, v) => s + v, 0) / arr.length
  }
  for (const [k, v] of Object.entries(byArch)) {
    if (v.stake > 0) out.archetypeRoi[k] = v.profit / v.stake
  }
  return out
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

function buildAiSlips(opts = {}) {
  const {
    candidates = [],
    timingResult = null,
    bookState = null,
    ledgerState = null,
    portfolioBaseline = null,
    options = {},
  } = opts

  const sport      = options.sport || "any"
  const date       = options.date  || new Date().toISOString().slice(0, 10)
  const maxPerTier = options.maxPerTier || 4

  // Normalize candidates
  const normalized = candidates
    .map(normalizeCandidate)
    .filter(Boolean)

  if (!normalized.length) {
    return {
      slips: { safe: [], balanced: [], aggressive: [], lotto: [] },
      summary: "No eligible candidates",
      warnings: ["No candidates supplied"],
      candidateCount: 0,
    }
  }

  // Build timing map
  const timingMap = new Map()
  for (const tc of timingResult?.timingClassifications || []) {
    timingMap.set(tc.key, tc)
  }

  // Build exposure baseline
  const exposureMap = buildBaselineExposure(portfolioBaseline)

  // Roll up ledger stat history for CLV/archetype factors
  const ledgerStats = rollupLedgerStats(ledgerState)

  const ctx = { timingMap, bookState, ledgerStats, exposureMap, date, sport }

  // Score every leg once
  const scored = normalized.map((leg) => {
    const score = scoreLeg(leg, ctx)
    return { leg, ...score }
  })

  // Build slips per tier, in increasing aggressiveness so safer tiers get the best legs first.
  // We share a global cross-tier player counter so the same player can't dominate
  // every slip on the board.
  const globalPlayerCount = new Map()
  ctx.globalPlayerCount = globalPlayerCount
  const slips = {
    safe:       buildSlipsForTier("safe",       scored, ctx, maxPerTier),
    balanced:   buildSlipsForTier("balanced",   scored, ctx, maxPerTier),
    aggressive: buildSlipsForTier("aggressive", scored, ctx, maxPerTier),
    lotto:      buildSlipsForTier("lotto",      scored, ctx, maxPerTier),
  }

  // Warnings
  const warnings = []
  if (!slips.safe.length)       warnings.push("No SAFE slip viable from current candidate pool")
  if (!slips.balanced.length)   warnings.push("No BALANCED slip viable from current candidate pool")
  if (!normalized.some((c) => c.volatility === "safe")) warnings.push("Candidate pool lacks SAFE legs — slate may be high-variance")

  const totalSlips = Object.values(slips).reduce((s, arr) => s + arr.length, 0)
  const summary = `Built ${totalSlips} slips from ${normalized.length} candidates  ·  safe:${slips.safe.length} balanced:${slips.balanced.length} aggr:${slips.aggressive.length} lotto:${slips.lotto.length}`

  return { slips, summary, warnings, candidateCount: normalized.length }
}

// ── PRESENTATION HELPER ───────────────────────────────────────────────────────

function formatSlipsSection(result, opts = {}) {
  const { divider } = require("./buildIntelligencePresentation")
  const lines = [divider("🧠  AI SLIP CONSTRUCTION")]
  lines.push(`  ${result.summary}`)

  for (const tier of ["safe", "balanced", "aggressive", "lotto"]) {
    const slips = result.slips[tier] || []
    if (!slips.length) continue
    lines.push("")
    lines.push(`  ${tier.toUpperCase()}`)
    slips.slice(0, opts.maxPerTier || 3).forEach((s, i) => {
      const americ = s.combinedAmericanOdds >= 0 ? `+${s.combinedAmericanOdds}` : `${s.combinedAmericanOdds}`
      lines.push(`    ${i + 1}) ${americ.padEnd(7)} ev:${(s.ev * 100).toFixed(0)}%  prob:${(s.combinedModelProb * 100).toFixed(1)}%  ${s.reasoning}`)
      s.legs.forEach((l) => {
        lines.push(`         ${String(l.player || "").slice(0, 24).padEnd(25)} ${normFam(l.statFamily).padEnd(12)} ${l.side.padEnd(5)} ${String(l.line ?? "").padEnd(5)} ${(l.odds >= 0 ? "+" + l.odds : l.odds + "").padEnd(6)} ${l.book || ""}`)
      })
    })
  }

  if (result.warnings?.length) {
    lines.push("")
    lines.push("  WARNINGS:")
    result.warnings.forEach((w) => lines.push(`    ⚠️  ${w}`))
  }

  return lines.join("\n")
}

module.exports = {
  buildAiSlips,
  scoreLeg,
  normalizeCandidate,
  formatSlipsSection,
  TIER_TEMPLATES,
}
