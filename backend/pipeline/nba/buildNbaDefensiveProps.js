"use strict"

console.log("ACTIVE:", __filename)

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

    const stealsBase = stealsBaselinePerArchetype(archetype) * minutesScale * paceMul * usageMul
    const blocksBase = blocksBaselinePerArchetype(archetype) * minutesScale * paceMul

    // Wide sigma — high variance stats.
    const stealsSigma = clamp(0.85, 1.25, 0.95 + Math.abs(salt - 0.5) * 0.4)
    const blocksSigma = clamp(0.8, 1.2, 0.9 + Math.abs(salt - 0.5) * 0.4)

    const stealsBand = projectDefensiveBand(stealsBase, salt, stealsSigma)
    const blocksBand = projectDefensiveBand(blocksBase, salt, blocksSigma)

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
