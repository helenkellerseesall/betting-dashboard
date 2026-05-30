"use strict"

console.log("ACTIVE:", __filename)

// 2026-05-30 — read per-player L5 STL/BLK from recentFormCache so we stop
// projecting every guard at the same 1.05 STL baseline and every big at the
// same 1.05 BLK baseline. The cache already stores per-stat L5 for steals +
// blocks; engine was simply ignoring it.
let _getRecentForm = null
try { _getRecentForm = require("./nbaRecentFormCache").getRecentForm } catch (_) { _getRecentForm = null }

/**
 * NBA Defensive Props (steals + blocks).
 *
 * Steals/blocks are HIGH variance — single-game ranges are wide and easily
 * dominated by matchup volatility. We project ranges per starter using:
 *
 *   - position / archetype (bigs block more, guards steal more)
 *   - minutes (linear scale, 32 min baseline)
 *   - usage tail (very high usage → slightly fewer defensive events)
 *   - opponent pace (more possessions → more chances)
 *   - per-player deterministic salt (avoid identical projections)
 *
 * Variance is intentionally wide: σ_steals ≈ 0.9–1.2, σ_blocks ≈ 0.85–1.15.
 *
 * NOTE: We deliberately do NOT compute edge against a market here, because the
 * snapshot does not include `player_steals` / `player_blocks` markets in the
 * current ingest. Edge is computed downstream when those markets exist.
 *
 * Inputs:
 *   {
 *     predictions: { players: [...] }      // public outcome predictions
 *     completeUniverse: [...]              // raw rows for context (pace, opponent)
 *     marketProps?: [...]                  // optional steals/blocks market rows
 *   }
 *
 * Output:
 *   {
 *     players: [{
 *       player, eventId, matchup, position, archetype,
 *       steals: { floor, mostLikely, ceiling, sigma },
 *       blocks: { floor, mostLikely, ceiling, sigma },
 *     }],
 *     plays: [...]   // edge plays only (when market rows exist)
 *   }
 */

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function clamp(lo, hi, x) {
  return Math.max(lo, Math.min(hi, x))
}

function round1(x) {
  return Math.round(Number(x) * 10) / 10
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function americanToImplied(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 100 / (n + 100)
  return Math.abs(n) / (Math.abs(n) + 100)
}
function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 1 + n / 100
  return 1 + 100 / Math.abs(n)
}

function readPosition(row) {
  return String(row?.position || row?.primaryPosition || row?.playerPosition || "")
    .trim()
    .toUpperCase()
}

function archetypeOf(position) {
  const s = String(position || "").toUpperCase()
  if (/CENTER|\bC\b/.test(s)) return "big"
  if (/POWER FORWARD|\bPF\b/.test(s)) return "big"
  if (/POINT GUARD|\bPG\b/.test(s)) return "guard"
  if (/SHOOTING GUARD|\bSG\b/.test(s)) return "guard"
  if (/SMALL FORWARD|\bSF\b/.test(s)) return "wing"
  return "wing"
}

function playerSalt(player, eventId) {
  const s = `${String(player || "").toLowerCase()}|${String(eventId || "")}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000 // 0..1
}

/** Per-archetype steals baseline (per 32 min). */
function stealsBaselinePerArchetype(archetype) {
  if (archetype === "guard") return 1.05
  if (archetype === "wing") return 0.85
  if (archetype === "big") return 0.6
  return 0.8
}

/** Per-archetype blocks baseline (per 32 min). */
function blocksBaselinePerArchetype(archetype) {
  if (archetype === "guard") return 0.25
  if (archetype === "wing") return 0.45
  if (archetype === "big") return 1.05
  return 0.5
}

function paceMultiplier(pace) {
  const p = num(pace)
  if (p == null) return 1
  // Baseline pace ~ 99. ±10% range.
  const factor = 1 + (p - 99) * 0.0035
  return clamp(0.92, 1.1, factor)
}

function usageDefensivePenalty(usage) {
  const u = num(usage)
  if (u == null) return 1
  // Very high-usage stars defend slightly less aggressively (fewer steals).
  if (u >= 32) return 0.92
  if (u >= 28) return 0.96
  return 1
}

function indexUniverseByPlayerEvent(universe) {
  const m = new Map()
  for (const row of universe || []) {
    if (!row || !row.player || !row.eventId) continue
    const k = `${row.eventId}__${String(row.player).toLowerCase()}`
    if (!m.has(k)) m.set(k, row)
  }
  return m
}

/**
 * Project floor / median / ceiling for a single defensive stat, given baseline.
 * Wide sigma — these stats are HIGH variance.
 */
function projectDefensiveBand(baseline, salt, sigma) {
  // Salt slightly perturbs the median (±10%) to differentiate similar role players.
  const median = baseline * (1 + (salt - 0.5) * 0.2)
  const floor = Math.max(0, median - sigma * 0.9)
  const ceiling = median + sigma * 1.4
  return {
    floor: round1(floor),
    mostLikely: round1(Math.max(0, median)),
    ceiling: round1(ceiling),
    sigma: round1(sigma),
  }
}

/** Bucket-resolve family. */
function familyOfMarketRow(row) {
  const mk = String(row?.marketKey || "").toLowerCase()
  const pt = String(row?.propType || "").toLowerCase()
  const s = `${mk} ${pt}`
  if (s.includes("steals_blocks") || s.includes("stl_blk")) return "stl_blk"
  if (s.includes("steal")) return "steals"
  if (s.includes("block")) return "blocks"
  return null
}

function indexDefensiveMarketByPlayerEvent(marketProps) {
  const m = new Map()
  for (const row of marketProps || []) {
    const fam = familyOfMarketRow(row)
    if (!fam) continue
    if (!row.player || !row.eventId) continue
    const k = `${row.eventId}__${String(row.player).toLowerCase()}__${fam}`
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(row)
  }
  return m
}

/** Logistic CDF over a normal-ish band. Same shape as bestBetsBoard's modelProbOver. */
function probOverFromBand(band, line) {
  const m = num(band?.mostLikely)
  const f = num(band?.floor)
  const c = num(band?.ceiling)
  const sigma = num(band?.sigma) || 0.9
  if (m == null || !Number.isFinite(line)) return null
  const lo = f != null ? f : Math.max(0, m * 0.4)
  const hi = c != null ? c : m * 1.8
  const span = Math.max(0.0001, hi - lo)
  const sig = Math.max(sigma, span / 1.2)
  // Steals/blocks: even flatter (variance huge), z-scale = 2.6.
  const z = (line - m) / (sig * 2.6)
  const pUnder = 1 / (1 + Math.exp(-z))
  const pOver = 1 - pUnder
  // Cap at 0.62 default to avoid overconfidence.
  return Math.max(0.0001, Math.min(0.62, pOver))
}

function buildNbaDefensiveProps(input = {}) {
  const generatedAt = new Date().toISOString()
  const predictions = input?.predictions || null
  const universe = Array.isArray(input?.completeUniverse) ? input.completeUniverse : []
  const marketProps = Array.isArray(input?.marketProps) ? input.marketProps : []

  if (!predictions || !Array.isArray(predictions.players) || !predictions.players.length) {
    return {
      players: [],
      plays: [],
      meta: { generatedAt, reason: "no_predictions" },
    }
  }

  const universeIdx = indexUniverseByPlayerEvent(universe)
  const marketIdx = indexDefensiveMarketByPlayerEvent(marketProps)

  const players = []
  for (const p of predictions.players) {
    if (!p || !p.player || !p.eventId) continue
    const peKey = `${p.eventId}__${String(p.player).toLowerCase()}`
    const repRow = universeIdx.get(peKey) || null
    const position = readPosition(repRow) || null
    const archetype = archetypeOf(position)
    const minutes = num(repRow?.projectedMinutes) ?? num(repRow?.minutes) ?? 28
    if (minutes < 14) continue // skip deep bench
    const usage = num(repRow?.usageRate) ?? null
    const pace = num(repRow?.eventPace) ?? num(repRow?.pace) ?? null

    const minutesScale = clamp(0.45, 1.4, minutes / 32)
    const paceMul = paceMultiplier(pace)
    const usageMul = usageDefensivePenalty(usage)
    const salt = playerSalt(p.player, p.eventId)

    // 2026-05-30 — Per-player L5 lookup. When the cache has ≥3 samples,
    // trust the player's actual recent STL/BLK rate (already minutes-weighted)
    // and only adjust by matchup pace. When missing or low-sample, fall back
    // to the archetype baseline + minutes/usage scaling.
    let stealsBase, blocksBase
    let stealsBasis = "archetype"
    let blocksBasis = "archetype"

    if (_getRecentForm) {
      const stlForm = _getRecentForm(p.player, "steals")
      const stlL5 = num(stlForm?.last5_avg)
      const stlSample = num(stlForm?.sample_count)
      if (stlL5 != null && stlSample != null && stlSample >= 3) {
        // Blend: more samples → trust L5 more. 3 samples = 60%, 5 = 100%.
        const lambda = clamp(0.6, 1.0, stlSample / 5)
        const archetypeStl = stealsBaselinePerArchetype(archetype) * minutesScale * paceMul * usageMul
        stealsBase = (lambda * stlL5 * paceMul) + ((1 - lambda) * archetypeStl)
        stealsBasis = `L5(${stlSample})`
      }

      const blkForm = _getRecentForm(p.player, "blocks")
      const blkL5 = num(blkForm?.last5_avg)
      const blkSample = num(blkForm?.sample_count)
      if (blkL5 != null && blkSample != null && blkSample >= 3) {
        const lambda = clamp(0.6, 1.0, blkSample / 5)
        const archetypeBlk = blocksBaselinePerArchetype(archetype) * minutesScale * paceMul
        blocksBase = (lambda * blkL5 * paceMul) + ((1 - lambda) * archetypeBlk)
        blocksBasis = `L5(${blkSample})`
      }
    }

    if (stealsBase == null) stealsBase = stealsBaselinePerArchetype(archetype) * minutesScale * paceMul * usageMul
    if (blocksBase == null) blocksBase = blocksBaselinePerArchetype(archetype) * minutesScale * paceMul

    // 2026-05-30 — Tier 2 #6: opp steals-allowed multiplier. Set upstream
    // in nbaTeamStatsCache.attachOpponentDvP. Range 0.85..1.15.
    // High-TOV opponents → more steals for defenders.
    const oppStlMul = num(repRow?.opponentStealsMultiplier)
    if (Number.isFinite(oppStlMul) && oppStlMul > 0) stealsBase *= oppStlMul

    // 2026-05-30 — Tier 2 #7: opp blocks-allowed multiplier. Same pattern.
    // Teams that surrender more interior shots → more block opportunities.
    const oppBlkMul = num(repRow?.opponentBlocksMultiplier)
    if (Number.isFinite(oppBlkMul) && oppBlkMul > 0) blocksBase *= oppBlkMul

    // Wide sigma — high variance stats.
    const stealsSigma = clamp(0.85, 1.25, 0.95 + Math.abs(salt - 0.5) * 0.4)
    const blocksSigma = clamp(0.8, 1.2, 0.9 + Math.abs(salt - 0.5) * 0.4)

    const stealsBand = projectDefensiveBand(stealsBase, salt, stealsSigma)
    const blocksBand = projectDefensiveBand(blocksBase, salt, blocksSigma)

    // 2026-05-30 — LADDER MVP. Per operator's product direction
    // (product_ladder_direction.md), O/U binary picks aren't the endgame —
    // engineered milestone parlays from per-rung probabilities are.
    //
    // Note: don't reuse probOverFromBand here — that function has a 0.62 cap
    // and a 2.6x sigma multiplier specifically to flatten single-OVER probs
    // on defensive props (high variance → defensive against overconfidence).
    // For a ladder we want the NATURAL probability shape across thresholds.
    // Use the band's median + sigma directly with a logistic CDF, no cap.
    function probAtLeastForLadder(band, rung) {
      const m = num(band?.mostLikely)
      const sigma = num(band?.sigma) || 0.9
      if (m == null || !Number.isFinite(rung)) return null
      // Logistic CDF: P(stat >= rung) = 1 - P(stat < rung) ≈ 1 - sigmoid((rung - m) / sigma_eff)
      // sigma_eff ≈ 0.6 * sigma gives shape close to normal for these distributions.
      const sigEff = Math.max(0.4, sigma * 0.6)
      const z = (rung - m) / sigEff
      const pUnder = 1 / (1 + Math.exp(-z))
      const pOver = 1 - pUnder
      return Math.max(0.001, Math.min(0.999, pOver))
    }
    function buildLadder(band, rungs) {
      const out = {}
      for (const r of rungs) {
        const p = probAtLeastForLadder(band, r)
        out[`${r}+`] = p != null ? Number(p.toFixed(3)) : null
      }
      return out
    }
    const stealsLadder = buildLadder(stealsBand, [0.5, 1.5, 2.5, 3.5, 4.5])
    const blocksLadder = buildLadder(blocksBand, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5])

    players.push({
      player: p.player,
      eventId: p.eventId,
      matchup: p.matchup || null,
      position,
      archetype,
      minutes: round1(minutes),
      usage: usage != null ? round1(usage) : null,
      steals: stealsBand,
      blocks: blocksBand,
      // 2026-05-30 — ladder MVP (proof-of-concept; ship full ladder coverage to
      // all stat families post-Game-7).
      stealsLadder,
      blocksLadder,
      // diagnostic: did we use this player's L5 form or the archetype baseline?
      stealsBasis,
      blocksBasis,
    })
  }

  // Edges (only when market rows actually exist).
  const plays = []
  for (const pl of players) {
    for (const fam of ["steals", "blocks"]) {
      const k = `${pl.eventId}__${String(pl.player).toLowerCase()}__${fam}`
      const rows = marketIdx.get(k) || []
      for (const row of rows) {
        const line = num(row.line)
        const odds = num(row.oddsAmerican || row.odds)
        if (line == null || odds == null) continue
        const side = String(row.side || "Over").toLowerCase().startsWith("u") ? "Under" : "Over"
        const pOver = probOverFromBand(pl[fam], line)
        if (pOver == null) continue
        const modelProb = side === "Under" ? 1 - pOver : pOver
        const impliedProb = americanToImplied(odds)
        const decOdds = americanToDecimal(odds)
        if (impliedProb == null || decOdds == null) continue
        const edge = modelProb - impliedProb
        const ev = modelProb * (decOdds - 1) - (1 - modelProb)
        if (edge < 0.03 || ev <= 0) continue
        plays.push({
          player: pl.player,
          eventId: pl.eventId,
          // 2026-05-29 — gameTime propagation through defensive engine.
          // blocks/steals coverage was 14%/36% before — this closes the gap.
          gameTime: row.gameTime || row.commence_time || row.commenceTime || pl.gameTime || null,
          matchup: pl.matchup,
          statFamily: fam,
          side,
          line,
          oddsAmerican: odds,
          sportsbook: row.book || row.sportsbook || null,
          modelProb: round4(modelProb),
          impliedProb: round4(impliedProb),
          edge: round4(edge),
          ev: round4(ev),
          // 2026-05-29 — also propagate marketKey so Lane A5 bridge can pass
          // it through to leanBet (was 38% coverage on blocks before).
          marketKey: row.marketKey || null,
          range: pl[fam],
        })
      }
    }
  }
  plays.sort((a, b) => b.edge - a.edge)

  return {
    players,
    plays,
    meta: {
      generatedAt,
      playerCount: players.length,
      marketRowsConsidered: marketProps.length,
      playsWithEdge: plays.length,
      note: "high variance — wide sigma intentionally; edge only when markets exist",
    },
  }
}

module.exports = {
  buildNbaDefensiveProps,
}
