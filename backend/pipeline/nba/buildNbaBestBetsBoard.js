"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA Best Bets Board — converts existing player outcome predictions + market props
 * into edge / EV / tiered ranked plays. No re-projection: consumes predictions only.
 *
 * Input:
 *   {
 *     predictions: <output of buildNbaPlayerOutcomePredictions>,
 *     marketProps: [{ player, eventId?, statFamily, line, oddsAmerican, side, sportsbook? }]
 *   }
 *
 * Output:
 *   {
 *     corePlays: [...],   // ELITE + STRONG only
 *     allPlays:  [...],   // PLAYABLE+ retained, FADE dropped
 *     meta: { generatedAt, evaluated, kept, dropped }
 *   }
 */

const STAT_FAMILIES = ["points", "threes", "rebounds", "assists", "pra"]

function americanOddsToImpliedProb(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100)
  return 100 / (n + 100)
}

function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return 1 + 100 / Math.abs(n)
  return 1 + n / 100
}

function minSigmaByFamily(family) {
  const f = String(family || "").toLowerCase()
  if (f === "points") return 6
  // Baseline variance floor: avoids tight-band overconfidence.
  if (f === "rebounds") return 5.0
  if (f === "assists") return 2.8
  if (f === "threes") return 3.0
  if (f === "pra") return 7
  return 3
}

function zScaleByFamily(family) {
  const f = String(family || "").toLowerCase()
  if (f === "rebounds") return 2.4
  if (f === "threes") return 2.2
  if (f === "assists") return 2.0
  if (f === "pra") return 1.9
  if (f === "points") return 1.7
  return 1.8
}

function probShrinkByFamily(family) {
  // Pull probabilities toward 0.50 to reflect market-level uncertainty.
  // Lower shrink = more conservative (wider effective uncertainty).
  const f = String(family || "").toLowerCase()
  if (f === "rebounds") return 0.14
  if (f === "threes") return 0.18
  if (f === "assists") return 0.22
  if (f === "pra") return 0.18
  if (f === "points") return 0.24
  return 0.2
}

/**
 * Estimate model probability of OVER `line` given a (floor, mostLikely, ceiling) band.
 * Calibrated to avoid overconfidence: sigma is intentionally wide.
 *
 * sigma = max(statMinSigma, (ceiling - floor) / 1.2)
 * z = (line - median) / (sigma * zScaleByFamily(family))  // family-specific flattening
 */
function modelProbOver(family, stat, line, confidence = null) {
  if (!stat || !Number.isFinite(line)) return null
  const m = Number(stat.mostLikely)
  const f = Number(stat.floor)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m)) return null
  const lo = Number.isFinite(f) ? f : m * 0.7
  const hi = Number.isFinite(c) ? c : m * 1.3
  const span = Math.max(0.0001, hi - lo)
  const sigma = Math.max(minSigmaByFamily(family), span / 1.2)
  const z = (line - m) / (sigma * zScaleByFamily(family))
  const pUnder = 1 / (1 + Math.exp(-z))
  const pOverRaw = 1 - pUnder
  return Math.max(0.0001, Math.min(0.9999, pOverRaw))
}

function modelProbForSide(family, stat, line, side, confidence = null) {
  const pOver = modelProbOver(family, stat, line, confidence)
  if (pOver == null) return null
  const s = String(side || "").toLowerCase()

  const m = Number(stat?.mostLikely)
  const f = Number(stat?.floor)
  const c = Number(stat?.ceiling)
  const lo = Number.isFinite(f) ? f : m * 0.7
  const hi = Number.isFinite(c) ? c : m * 1.3
  const span = Math.max(0.0001, hi - lo)
  const sigma = Math.max(minSigmaByFamily(family), span / 1.2)
  const dist = Math.abs(m - line)
  const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : null

  // Cap applies to the chosen side (not just pOver), to prevent under-props from
  // becoming 0.90+ just because pOver is tiny.
  const allowHigh = conf != null && conf >= 0.85 && dist >= sigma * 1.6
  const maxP = allowHigh ? 0.7 : 0.6

  const pSideRaw = s.startsWith("u") ? 1 - pOver : pOver
  const shrink = probShrinkByFamily(family)
  const pSideShrunk = 0.5 + (pSideRaw - 0.5) * shrink
  return Math.max(0.0001, Math.min(maxP, pSideShrunk))
}

/**
 * Confidence: how far the median sits from the line, scaled by band width.
 *   conf = clamp01(|median - line| / max(0.5, (ceiling - floor) / 2))
 */
function projectionConfidence(stat, line) {
  if (!stat || !Number.isFinite(line)) return 0
  const m = Number(stat.mostLikely)
  const f = Number(stat.floor)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m)) return 0
  const halfBand = Math.max(
    0.5,
    (Number.isFinite(c) && Number.isFinite(f) ? c - f : Math.abs(m) * 0.6) / 2
  )
  return Math.max(0, Math.min(1, Math.abs(m - line) / halfBand))
}

/**
 * Volatility: ceiling-minus-median gap normalized by median.
 * Higher = wider upside spread (rewarded slightly for overs near ceiling).
 */
function volatilityGap(stat) {
  if (!stat) return 0
  const m = Number(stat.mostLikely)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m) || !Number.isFinite(c) || m <= 0) return 0
  return Math.max(0, Math.min(1, (c - m) / m))
}

/**
 * Composite score for ranking. Combines edge, EV, confidence, volatility.
 */
function scorePlay({ edge, ev, conf, vol, side }) {
  const e = Number.isFinite(edge) ? edge : 0
  const v = Number.isFinite(ev) ? ev : 0
  const c = Number.isFinite(conf) ? conf : 0
  const g = Number.isFinite(vol) ? vol : 0
  const sideBoost = String(side || "").toLowerCase().startsWith("o") ? g * 0.15 : g * 0.05
  return e * 100 * 1.0 + v * 60 + c * 12 + sideBoost * 8
}

function tierForPlay(edge, ev, conf) {
  if (!Number.isFinite(edge) || !Number.isFinite(ev)) return "FADE"
  if (ev <= 0) return "FADE"
  if (edge < 0.03) return "FADE"
  // Calibrated for realistic markets: most edges 2–6%, few 6–10%, rare >10%.
  if (edge >= 0.06 && ev >= 0.03 && conf >= 0.45) return "ELITE"
  if (edge >= 0.04 && ev >= 0.015) return "STRONG"
  return "PLAYABLE"
}

/**
 * Map opaque marketKey/propType strings to a normalized stat family used by predictions.
 */
function resolveStatFamily(marketProp) {
  const direct = String(marketProp?.statFamily || "").toLowerCase()
  if (STAT_FAMILIES.includes(direct)) return direct
  const s = `${marketProp?.propType || ""} ${marketProp?.marketKey || ""}`.toLowerCase()
  if (s.includes("points_rebounds_assists") || /\bpra\b/.test(s)) return "pra"
  // Combo markets we don't model as a first-class family yet (PR / PA / RA).
  // Returning null prevents mismatching them to single-stat bands (which creates fake edge).
  if (s.includes("points_rebounds") || /\bpr\b/.test(s)) return null
  if (s.includes("points_assists") || /\bpa\b/.test(s)) return null
  if (s.includes("rebounds_assists") || /\bra\b/.test(s)) return null
  if (s.includes("three") || s.includes("3pt") || s.includes("threes")) return "threes"
  if (s.includes("rebound")) return "rebounds"
  if (s.includes("assist")) return "assists"
  if (s.includes("point")) return "points"
  return null
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
}

/**
 * Index predictions.players by player + eventId for fast lookup.
 */
function indexPredictions(predictions) {
  const idx = new Map()
  const players = Array.isArray(predictions?.players) ? predictions.players : []
  for (const p of players) {
    if (!p?.player) continue
    const k1 = `${normalizeKey(p.player)}|${normalizeKey(p.eventId || "")}`
    const k2 = `${normalizeKey(p.player)}|`
    idx.set(k1, p)
    if (!idx.has(k2)) idx.set(k2, p)
  }
  return idx
}

function buildReasoning({ family, side, line, stat, edge, ev, conf, vol }) {
  const parts = []
  parts.push(
    `proj ${stat?.floor ?? "?"} / ${stat?.mostLikely ?? "?"} / ${stat?.ceiling ?? "?"} vs line ${line}`
  )
  parts.push(`edge ${(edge * 100).toFixed(1)}% • EV ${ev.toFixed(3)}`)
  if (conf >= 0.6) parts.push("high conf")
  else if (conf >= 0.35) parts.push("medium conf")
  else parts.push("low conf")
  if (side === "over" && vol >= 0.35) parts.push("upside band")
  if (side === "under" && vol <= 0.2) parts.push("tight ceiling")
  return parts.join(" | ")
}

/**
 * Build the bets board from predictions + market props.
 */
function buildNbaBestBetsBoard(input = {}) {
  const generatedAt = new Date().toISOString()
  const predictions = input?.predictions || null
  const marketProps = Array.isArray(input?.marketProps) ? input.marketProps : []

  if (!predictions || !Array.isArray(predictions.players) || !marketProps.length) {
    return {
      corePlays: [],
      allPlays: [],
      meta: {
        generatedAt,
        evaluated: 0,
        kept: 0,
        dropped: 0,
        reason: !predictions
          ? "no_predictions"
          : !marketProps.length
            ? "no_market_props"
            : "no_players",
      },
    }
  }

  const idx = indexPredictions(predictions)
  const allPlays = []
  const longshotPlays = []
  const altPlays = []
  let evaluated = 0
  let dropped = 0

  for (const mp of marketProps) {
    if (!mp || typeof mp !== "object") continue
    const family = resolveStatFamily(mp)
    if (!family) continue
    const player = mp.player
    const eventId = mp.eventId || ""
    const line = Number(mp.line)
    const side = String(mp.side || "").toLowerCase()
    const odds = Number(mp.oddsAmerican)
    if (!player || !Number.isFinite(line) || !Number.isFinite(odds)) continue
    if (side !== "over" && side !== "under") continue

    const k1 = `${normalizeKey(player)}|${normalizeKey(eventId)}`
    const k2 = `${normalizeKey(player)}|`
    const pred = idx.get(k1) || idx.get(k2)
    if (!pred) continue
    const stat = pred.stats?.[family]
    if (!stat) continue

    evaluated += 1

    const impliedProb = americanOddsToImpliedProb(odds)
    const decOdds = americanToDecimal(odds)
    const conf = projectionConfidence(stat, line)
    const modelProb = modelProbForSide(family, stat, line, side, conf)
    if (impliedProb == null || decOdds == null || modelProb == null) {
      dropped += 1
      continue
    }
    const edge = modelProb - impliedProb
    const ev = modelProb * (decOdds - 1) - (1 - modelProb)
    const vol = volatilityGap(stat)

    if (modelProb > 0.49 && modelProb < 0.51) {
      dropped += 1
      continue
    }
    const isLongshot = impliedProb < 0.1
    const inCoreOddsBand = odds >= -300 && odds <= 300
    const isAlternate =
      /alternate/i.test(String(mp?.marketKey || "")) ||
      /\bladder\b/i.test(String(mp?.propType || "")) ||
      /alternate/i.test(String(mp?.propType || "")) ||
      Boolean(mp?.ladder)

    // Keep longshots for optional display, but never allow them into corePlays.
    // Also filter them from normal edge/EV gating so they don't dominate rankings.
    if (!isLongshot && !isAlternate) {
      if (edge < 0.03 || ev <= 0) {
        dropped += 1
        continue
      }
      if (vol > 0.65 && edge < 0.05) {
        dropped += 1
        continue
      }
    }

    const tier = tierForPlay(edge, ev, conf)
    if (!isLongshot && !isAlternate && tier === "FADE") {
      dropped += 1
      continue
    }

    const score = scorePlay({ edge, ev, conf, vol, side })
    const play = {
      player: pred.player,
      eventId: pred.eventId || eventId || null,
      matchup: pred.matchup || null,
      statFamily: family,
      side,
      line,
      oddsAmerican: odds,
      sportsbook: mp.sportsbook || mp.book || null,
      propType: mp.propType || null,
      marketKey: mp.marketKey || null,
      ladder: mp.ladder || null,
      impliedProb: round4(impliedProb),
      modelProb: round4(modelProb),
      edge: round4(edge),
      ev: round4(ev),
      confidence: round3(conf),
      volatility: round3(vol),
      tier: isLongshot ? "LONGSHOT" : tier,
      isLongshot,
      isAlternate,
      inCoreOddsBand,
      score: round2(score),
      range: {
        floor: stat.floor ?? null,
        mostLikely: stat.mostLikely ?? null,
        ceiling: stat.ceiling ?? null,
      },
      reasoning: buildReasoning({ family, side, line, stat, edge, ev, conf, vol }),
    }

    if (isLongshot) longshotPlays.push(play)
    else if (isAlternate || !inCoreOddsBand) altPlays.push(play)
    else allPlays.push(play)
  }

  allPlays.sort((a, b) => b.score - a.score)
  const corePlays = allPlays.filter(
    (p) => p.inCoreOddsBand && !p.isAlternate && (p.tier === "ELITE" || p.tier === "STRONG")
  )

  return {
    corePlays,
    allPlays,
    longshotPlays,
    altPlays,
    meta: {
      generatedAt,
      evaluated,
      kept: allPlays.length,
      longshots: longshotPlays.length,
      alts: altPlays.length,
      dropped,
      tierCounts: tierCountsOf(allPlays),
    },
  }
}

function tierCountsOf(plays) {
  const out = { ELITE: 0, STRONG: 0, PLAYABLE: 0, FADE: 0 }
  for (const p of plays) out[p.tier] = (out[p.tier] || 0) + 1
  return out
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}
function round3(x) {
  return Math.round(Number(x) * 1000) / 1000
}
function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

/**
 * Helper: build marketProps from existing pool rows (e.g. completeUniverse) so callers
 * don't have to massage shapes. Skips rows without odds/line/side/player.
 */
function marketPropsFromPoolRows(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const player = row.player
    if (!player) continue
    const family = resolveStatFamily(row)
    if (!family) continue
    const line = Number(row.line)
    const odds = Number(row.odds)
    const side = String(row.side || "").toLowerCase()
    if (!Number.isFinite(line) || !Number.isFinite(odds)) continue
    if (side !== "over" && side !== "under") continue
    out.push({
      player,
      eventId: row.eventId || null,
      statFamily: family,
      line,
      oddsAmerican: odds,
      side,
      sportsbook: row.book || row.sportsbook || null,
      propType: row.propType || null,
      marketKey: row.marketKey || null,
      ladder: row.ladder || null,
    })
  }
  return out
}

module.exports = {
  buildNbaBestBetsBoard,
  marketPropsFromPoolRows,
  americanOddsToImpliedProb,
  americanToDecimal,
  modelProbOver,
}
