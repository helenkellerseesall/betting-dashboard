"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA Slip Composer — converts bestBetsBoard plays into structured parlays:
 *   SAFE       — 2 legs, high model probability
 *   BALANCED   — 3–4 legs, moderate edge
 *   AGGRESSIVE — 4–6 legs, edge + ceiling/upside
 *   LOTTO      — 6–10 legs, high upside only
 *
 * Hard rules (correlation):
 *   - Within a slip: at most ONE leg per (player, eventId).
 *   - Within a slip: no opposing sides on the same (player, stat).
 *   - Within a slip: no more than `maxSameEventShare` of legs from a single eventId.
 *
 * Diversity (across slip set):
 *   - Track player usage across slips and downweight repeats so the same star
 *     doesn't dominate every slip.
 *   - Each slip type pulls from the global pool with its own filters & ordering,
 *     so legs differ across SAFE / BALANCED / AGGRESSIVE / LOTTO.
 *
 * Inputs:
 *   {
 *     bestBetsBoard: { allPlays, corePlays, ... },
 *     options?: {
 *       safeCount, balancedCount, aggressiveCount, lottoCount,
 *       maxSameEventShare,            // default 0.6
 *       diversityPenaltyPerUse,       // default 0.18 score-weight reduction
 *     }
 *   }
 *
 * Output:
 *   {
 *     slips: { safe, balanced, aggressive, lotto },
 *     meta: { generatedAt, slipCount, legPoolSize, dropped, reasons }
 *   }
 */

function americanFromDecimal(dec) {
  if (!Number.isFinite(dec) || dec <= 1) return null
  if (dec >= 2) return Math.round((dec - 1) * 100)
  return Math.round(-100 / (dec - 1))
}

function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return 1 + 100 / Math.abs(n)
  return 1 + n / 100
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}
function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function legKey(p) {
  return `${(p.player || "").toLowerCase()}|${(p.eventId || "").toLowerCase()}|${p.statFamily}|${p.side}|${p.line}`
}

/**
 * Dedupe by (player, event, stat, side, line). When duplicates exist (same line at
 * different books), keep the one with the BEST PRICE for the bettor:
 *   - "over": keep highest oddsAmerican
 *   - "under": keep highest oddsAmerican (a less negative number is better when negative)
 * In both cases higher American odds = better payout, so we keep max(odds).
 */
function dedupeByLegKey(plays) {
  const best = new Map()
  for (const p of plays) {
    const k = legKey(p)
    const prev = best.get(k)
    if (!prev) {
      best.set(k, p)
      continue
    }
    const a = Number(p.oddsAmerican)
    const b = Number(prev.oddsAmerican)
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      best.set(k, p)
    }
  }
  return Array.from(best.values())
}

/**
 * Same-event correlation cap. Uses a hard count cap derived from `targetLegs`:
 *   maxPerEvent = max(1, ceil(targetLegs * maxShare))
 *
 * This avoids degenerate failures on small slates (e.g. 2-game nights) while
 * still preventing one game from dominating a 6+ leg ticket.
 */
function eventShareOk(legs, candidate, maxShare, targetLegs) {
  if (!legs.length) return true
  const counts = new Map()
  for (const l of legs) counts.set(l.eventId || "_", (counts.get(l.eventId || "_") || 0) + 1)
  const cBefore = counts.get(candidate.eventId || "_") || 0
  const target = Math.max(2, Number(targetLegs) || 2)
  const maxPerEvent = Math.max(1, Math.ceil(target * maxShare))
  return cBefore + 1 <= maxPerEvent
}

function playerEventTaken(legs, candidate) {
  for (const l of legs) {
    if (
      String(l.player || "").toLowerCase() === String(candidate.player || "").toLowerCase() &&
      String(l.eventId || "") === String(candidate.eventId || "")
    ) {
      return true
    }
  }
  return false
}

function conflictingSide(legs, candidate) {
  // Same player + same stat with opposing side in the same slip is forbidden.
  for (const l of legs) {
    if (
      String(l.player || "").toLowerCase() === String(candidate.player || "").toLowerCase() &&
      l.statFamily === candidate.statFamily &&
      l.side !== candidate.side
    ) {
      return true
    }
  }
  return false
}

function legSummary(p) {
  return {
    player: p.player,
    eventId: p.eventId || null,
    matchup: p.matchup || null,
    statFamily: p.statFamily,
    side: p.side,
    line: p.line,
    oddsAmerican: p.oddsAmerican,
    sportsbook: p.sportsbook || null,
    modelProb: p.modelProb,
    impliedProb: p.impliedProb,
    edge: p.edge,
    confidence: p.confidence,
    volatility: p.volatility,
    tier: p.tier,
    propType: p.propType || null,
    reasoning: p.reasoning || null,
  }
}

function buildSlipFromLegs(legs, label, reasoning) {
  if (!legs.length) return null
  const decimals = legs.map((l) => americanToDecimal(l.oddsAmerican)).filter((d) => Number.isFinite(d))
  if (decimals.length !== legs.length) return null
  const combinedDecimal = decimals.reduce((a, b) => a * b, 1)
  const combinedAmerican = americanFromDecimal(combinedDecimal)
  // Independent leg approximation (sportsbook standard parlay math).
  const combinedModelProb = legs.reduce((p, l) => p * Number(l.modelProb || 0), 1)
  const combinedImpliedProb = legs.reduce((p, l) => p * Number(l.impliedProb || 0), 1)
  const ev = combinedModelProb * (combinedDecimal - 1) - (1 - combinedModelProb)
  const expectedPayoutPer1 = combinedDecimal - 1
  return {
    type: label,
    legCount: legs.length,
    legs: legs.map(legSummary),
    combinedDecimalOdds: round4(combinedDecimal),
    combinedAmericanOdds: combinedAmerican,
    combinedModelProb: round4(combinedModelProb),
    combinedImpliedProb: round4(combinedImpliedProb),
    edge: round4(combinedModelProb - combinedImpliedProb),
    ev: round4(ev),
    expectedPayoutPer1: round4(expectedPayoutPer1),
    reasoning,
  }
}

/**
 * Greedy leg selection with diversity (player-use counter) and hard correlation rules.
 *
 * @param {Array} pool   eligible plays sorted by your slip-type's preference
 * @param {object} cfg   { targetLegs, minLegs, maxSameEventShare, playerUseCounts, diversityPenaltyPerUse }
 */
function pickLegsGreedy(pool, cfg) {
  const {
    targetLegs,
    minLegs,
    maxSameEventShare,
    playerUseCounts,
    diversityPenaltyPerUse,
  } = cfg
  const ranked = pool
    .map((p) => {
      const uses = playerUseCounts.get(String(p.player || "").toLowerCase()) || 0
      // Diversity penalty is in the same units as `score` (typically 0–5 for plays).
      const diversityPenalty = uses * diversityPenaltyPerUse
      return { p, score: (Number(p.score) || 0) - diversityPenalty }
    })
    .sort((a, b) => b.score - a.score)

  const legs = []
  for (const { p } of ranked) {
    if (legs.length >= targetLegs) break
    if (playerEventTaken(legs, p)) continue
    if (conflictingSide(legs, p)) continue
    if (!eventShareOk(legs, p, maxSameEventShare, targetLegs)) continue
    legs.push(p)
  }
  if (legs.length < minLegs) return null
  return legs
}

function bumpPlayerUse(playerUseCounts, legs) {
  for (const l of legs) {
    const k = String(l.player || "").toLowerCase()
    playerUseCounts.set(k, (playerUseCounts.get(k) || 0) + 1)
  }
}

/** Filter a pool by predicate then dedupe. */
function poolByFilter(plays, predicate) {
  return dedupeByLegKey(plays.filter(predicate))
}

/**
 * SAFE — short, high-confidence tickets at near-coin-flip / favorite prices.
 *
 * Filter calibrated for the post-shrink probability model:
 *   - modelProb in [0.50, 0.70] (top of the calibrated band)
 *   - confidence >= 0.45
 *   - positive edge (sportsbook line shopping is built into dedupe)
 *   - odds in [-300, +200]
 */
function buildSafeSlips({ pool, count, playerUseCounts, opts }) {
  const safePool = poolByFilter(
    pool,
    (p) =>
      Number(p.modelProb || 0) >= 0.5 &&
      Number(p.modelProb || 0) <= 0.7 &&
      Number(p.confidence || 0) >= 0.45 &&
      Number(p.edge || 0) > 0 &&
      p.tier !== "FADE" &&
      !p.isLongshot &&
      !p.isAlternate &&
      Number.isFinite(p.oddsAmerican) &&
      p.oddsAmerican >= -300 &&
      p.oddsAmerican <= 200
  )
  return composeMany({
    pool: safePool,
    count,
    legSize: { target: 2, min: 2 },
    label: "SAFE",
    reasoning: "2-leg ticket; high model probability + high confidence",
    playerUseCounts,
    opts,
  })
}

/** BALANCED — 3–4 legs, moderate edge from core (non-alt, non-longshot). */
function buildBalancedSlips({ pool, count, playerUseCounts, opts }) {
  const balPool = poolByFilter(
    pool,
    (p) =>
      Number(p.edge || 0) >= 0.03 &&
      Number(p.modelProb || 0) >= 0.48 &&
      !p.isLongshot &&
      !p.isAlternate &&
      Number.isFinite(p.oddsAmerican) &&
      p.oddsAmerican >= -300 &&
      p.oddsAmerican <= 250
  )
  return composeMany({
    pool: balPool,
    count,
    legSize: { target: 3, min: 3, alt: 4 },
    label: "BALANCED",
    reasoning: "3–4 legs; moderate edge across multiple games",
    playerUseCounts,
    opts,
  })
}

/**
 * AGGRESSIVE — 4–6 legs. Includes core plays AND alternates with edge so we
 * can stack ceiling tilt without going full lotto.
 *
 * Per-leg odds capped at +250 to keep combined payouts realistic
 * (typical AGGRESSIVE parlays settle around +500 to +6000 American).
 */
function buildAggressiveSlips({ corePool, altPool, count, playerUseCounts, opts }) {
  const merged = [
    ...corePool.filter(
      (p) =>
        (Number(p.edge || 0) >= 0.04 ||
          (Number(p.volatility || 0) >= 0.3 && Number(p.edge || 0) >= 0.02)) &&
        !p.isLongshot &&
        !p.isAlternate &&
        Number.isFinite(p.oddsAmerican) &&
        p.oddsAmerican >= -300 &&
        p.oddsAmerican <= 250
    ),
    ...altPool.filter(
      (p) =>
        Number(p.edge || 0) >= 0.05 &&
        Number(p.modelProb || 0) >= 0.42 &&
        Number.isFinite(p.oddsAmerican) &&
        p.oddsAmerican <= 250 &&
        p.oddsAmerican >= -200
    ),
  ]
  const aggPool = dedupeByLegKey(merged)
  return composeMany({
    pool: aggPool,
    count,
    legSize: { target: 4, min: 4, alt: 5 },
    label: "AGGRESSIVE",
    reasoning: "4–6 legs; edge + ceiling tilt (volatility & alt rungs allowed)",
    playerUseCounts,
    opts,
    maxCombinedDecimalOdds: 200, // ~+19,900 American
  })
}

/**
 * LOTTO — 6–10 legs. Pulls from alts + longshots for upside. Still requires
 * positive edge per leg so it isn't pure dart-throwing.
 *
 * Per-leg odds capped at +900 to keep combined payouts in a realistic
 * sportsbook range (no 7-billion-to-1 fantasy tickets).
 */
function buildLottoSlips({ corePool, altPool, longPool, count, playerUseCounts, opts }) {
  // Per-leg cap of +400 keeps a 6-leg combined ticket inside ~5^6 = 15,625 decimal
  // (≈ +1.5M American — still capped further by maxCombinedDecimalOdds below).
  const merged = [...corePool, ...altPool, ...longPool].filter(
    (p) =>
      Number(p.edge || 0) > 0 &&
      Number(p.modelProb || 0) >= 0.25 &&
      Number.isFinite(p.oddsAmerican) &&
      p.oddsAmerican >= -150 &&
      p.oddsAmerican <= 400
  )
  const lottoPool = dedupeByLegKey(merged)
  return composeMany({
    pool: lottoPool,
    count,
    legSize: { target: 5, min: 5, alt: 6 },
    label: "LOTTO",
    reasoning: "5–6 legs; high payout if multiple ceilings hit",
    playerUseCounts,
    opts,
    maxCombinedDecimalOdds: 4000, // ~+399,900 American max (true lottery tier)
  })
}

function composeMany({
  pool,
  count,
  legSize,
  label,
  reasoning,
  playerUseCounts,
  opts,
  maxCombinedDecimalOdds = null,
}) {
  const slips = []
  if (!pool.length) return slips
  const used = new Set()

  for (let i = 0; i < count; i++) {
    let target = legSize.alt && i % 2 === 1 ? legSize.alt : legSize.target

    let slip = null
    // Two-stage retry:
    //   1. Ban highest-odds leg and retry (up to 6 attempts) — pulls combined odds down.
    //   2. If still over cap, decrement leg count by 1 down to legSize.min and retry.
    while (target >= legSize.min && !slip) {
      const banned = new Set()
      let attempts = 0
      while (attempts < 6 && !slip) {
        attempts++
        const remaining = pool.filter((p) => !used.has(legKey(p)) && !banned.has(legKey(p)))
        if (remaining.length < target) break

        const legs = pickLegsGreedy(remaining, {
          targetLegs: target,
          minLegs: target,
          maxSameEventShare: opts.maxSameEventShare,
          playerUseCounts,
          diversityPenaltyPerUse: opts.diversityPenaltyPerUse,
        })
        if (!legs) break

        const candidate = buildSlipFromLegs(legs, label, reasoning)
        if (!candidate) break
        if (
          maxCombinedDecimalOdds != null &&
          Number(candidate.combinedDecimalOdds) > maxCombinedDecimalOdds
        ) {
          const highest = legs.slice().sort((a, b) => Number(b.oddsAmerican) - Number(a.oddsAmerican))[0]
          banned.add(legKey(highest))
          continue
        }
        slip = candidate
      }
      if (!slip) target -= 1
    }

    if (!slip) continue
    slips.push(slip)
    bumpPlayerUse(playerUseCounts, slip.legs)
    for (const l of slip.legs) used.add(legKey(l))
  }
  return slips
}

function buildNbaSlipComposer(input = {}) {
  const generatedAt = new Date().toISOString()
  const board = input?.bestBetsBoard || null
  const opts = {
    safeCount: input?.options?.safeCount ?? 4,
    balancedCount: input?.options?.balancedCount ?? 4,
    aggressiveCount: input?.options?.aggressiveCount ?? 3,
    lottoCount: input?.options?.lottoCount ?? 2,
    maxSameEventShare: input?.options?.maxSameEventShare ?? 0.6,
    diversityPenaltyPerUse: input?.options?.diversityPenaltyPerUse ?? 0.18,
  }
  if (!board || !Array.isArray(board.allPlays)) {
    return {
      slips: { safe: [], balanced: [], aggressive: [], lotto: [] },
      meta: { generatedAt, slipCount: 0, legPoolSize: 0, dropped: 0, reason: "no_board" },
    }
  }

  const corePool = board.allPlays.slice()
  const altPool = Array.isArray(board.altPlays) ? board.altPlays.slice() : []
  const longPool = Array.isArray(board.longshotPlays) ? board.longshotPlays.slice() : []

  const playerUseCounts = new Map()
  const safe = buildSafeSlips({ pool: corePool, count: opts.safeCount, playerUseCounts, opts })
  const balanced = buildBalancedSlips({
    pool: corePool,
    count: opts.balancedCount,
    playerUseCounts,
    opts,
  })
  const aggressive = buildAggressiveSlips({
    corePool,
    altPool,
    count: opts.aggressiveCount,
    playerUseCounts,
    opts,
  })
  const lotto = buildLottoSlips({
    corePool,
    altPool,
    longPool,
    count: opts.lottoCount,
    playerUseCounts,
    opts,
  })

  const slipCount = safe.length + balanced.length + aggressive.length + lotto.length
  return {
    slips: { safe, balanced, aggressive, lotto },
    meta: {
      generatedAt,
      slipCount,
      corePoolSize: corePool.length,
      altPoolSize: altPool.length,
      longPoolSize: longPool.length,
      options: opts,
    },
  }
}

module.exports = {
  buildNbaSlipComposer,
}
