"use strict"

/**
 * Workstation transit compactors — drop heavy fields before sending to frontend.
 *
 * Pure functions. No IO, no side effects.
 * Extracted from workstationRoutes.js (was inline at lines 618–719).
 *
 * These functions reduce full pipeline output objects to the minimal shape
 * the workstation frontend actually needs, keeping payload sizes tractable.
 *
 * Imported by:
 *   routes/workstationRoutes.js  — /api/ws/state, /api/ws/line-shopping
 */

/**
 * Compact a line-shopping result for transit.
 *
 * Sorts by implied-probability spread DESC (most actionable delta first),
 * filters out novelty longshots (consensus implied probability < ~9% / +1000),
 * slices to `max` entries, and strips fields not needed by the frontend.
 *
 * @param {object} ls  — raw buildLineShopping() result
 * @param {number} max — max entries to return (default 60)
 * @returns {{ groups: object[], meta: object } | null}
 */
function compactLineShopping(ls, max = 60) {
  if (!ls) return null
  // Rank by IMPLIED-PROBABILITY spread, not raw American odds spread.
  //
  // American odds are a non-linear scale: a +16000 vs +4900 prop has a raw
  // spread of 11100 but represents only ~1.4% implied probability — vs
  // +110 vs -120 with a raw spread of just 230 representing ~7% implied
  // probability (5x more actionable). Sorting by raw spread caused the
  // line-shopping board to be dominated by novelty +10000+ longshots
  // (HR over 1.5, hits over 3.5) where book-to-book deltas are mathematical
  // noise, not bettable edge.
  //
  // We also drop novelty markets where consensus implied probability is
  // below ~9% (consensus odds worse than +1000) — those are not actionable
  // shopping opportunities, just lottery-ticket prices.
  function impliedFromAmerican(o) {
    const n = Number(o)
    if (!Number.isFinite(n) || n === 0) return null
    return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
  }
  const NOVELTY_IMPL_FLOOR = 0.09 // ~ +1000

  const source = (ls.byProp || []).slice()
  // Pre-compute spreads for each entry
  const enriched = source.map((g) => {
    const bestImp  = impliedFromAmerican(g.bestOdds)
    const worstImp = impliedFromAmerican(g.worstOdds)
    const consImp  = impliedFromAmerican(g.consensus)
    const impSpread = (bestImp != null && worstImp != null) ? Math.abs(bestImp - worstImp) : null
    const oddsSpread = Number.isFinite(Number(g.bestOdds)) && Number.isFinite(Number(g.worstOdds))
      ? Math.abs(Number(g.bestOdds) - Number(g.worstOdds)) : null
    return { g, impSpread, oddsSpread, consImp }
  })
  // Filter out novelty longshots
  const filtered = enriched.filter((x) => {
    if (x.consImp != null && x.consImp < NOVELTY_IMPL_FLOOR) return false
    return true
  })
  // Sort by implied-prob spread DESC (largest actionable delta first), then
  // by bookCount as a tie-breaker (more books = more confidence).
  filtered.sort((a, b) => {
    const sa = a.impSpread ?? 0
    const sb = b.impSpread ?? 0
    if (sb !== sa) return sb - sa
    return (b.g.bookCount || 0) - (a.g.bookCount || 0)
  })
  const groups = filtered.slice(0, max).map(({ g, impSpread, oddsSpread }) => {
    const flags = []
    if (g.bookProfile?.avgClv > 0.015) flags.push("soft_book")
    if (Math.abs(g.bestImpDelta || 0) > 0.05) flags.push("market_disagreement")
    if (oddsSpread != null && oddsSpread > 80) flags.push("stale_line")
    return {
      propGroupKey: g.key,
      player:    g.player,
      team:      g.team,
      statFamily: String(g.propFamilyKey || g.propType || "").toLowerCase().replace(/[\s_]+/g, ""),
      side:      String(g.side || "").toLowerCase(),
      line:      g.line,
      bookCount: g.bookCount,
      bestBook:  g.bestBook,
      bestOdds:  g.bestOdds,
      worstBook: g.worstBook,
      worstOdds: g.worstOdds,
      consensusOdds: g.consensus,
      oddsSpread,                                         // raw American spread (display)
      impliedSpread: impSpread != null ? Math.round(impSpread * 10000) / 10000 : null,
      flags,
    }
  })
  return { groups, meta: ls.meta || {} }
}

/**
 * Compact a market timing result for transit.
 * Slices to `max` entries and strips fields not needed by the frontend.
 *
 * @param {object} t  — raw buildMarketTiming() result
 * @param {number} max — max classification entries to return (default 60)
 * @returns {{ classifications: object[], meta: object } | null}
 */
function compactTiming(t, max = 60) {
  if (!t) return null
  const classifications = (t.timingClassifications || []).slice(0, max).map((c) => ({
    key:        c.key,
    player:     c.player,
    statFamily: c.statFamily,
    side:       c.side,
    line:       c.line,
    state:      c.state,
    urgency:    c.urgency,
    eventId:    c.eventId,
    bookCount:  c.bookCount,
    hoursToGame: c.hoursToGame,
  }))
  return { classifications, meta: t.meta || {} }
}

/**
 * Compact a portfolio result for transit.
 * Strips heavy internal fields, keeps the summary shape the frontend expects.
 *
 * @param {object} p — raw optimizePortfolio() result
 * @returns {object | null}
 */
function compactPortfolio(p) {
  if (!p) return null
  return {
    score:          p.score,
    grade:          p.grade,
    mood:           p.mood,
    warnings:       p.warnings || [],
    correlations:   p.correlations,
    conflicts:      p.conflicts || [],
    exposureMap:    p.exposureMap,
    nudges:         p.nudges,
  }
}

module.exports = { compactLineShopping, compactTiming, compactPortfolio }
