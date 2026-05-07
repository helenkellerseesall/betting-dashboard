"use strict"

/**
 * buildCandidateDiversity — candidate pool diversification.
 *
 * Extracted from workstationRoutes.js so every workstation route (state,
 * ai-slips, portfolio, featured, mlbIsolated, etc.) shares exactly one
 * copy of the curation logic rather than inline duplicates.
 *
 * Responsibilities:
 *   - Accept a raw candidate array (tracked_bets entries or enriched_best entries)
 *   - Sort by composite score (edge × prob) descending
 *   - Apply per-player / per-game / per-stat / per-(stat+side) caps
 *   - Return the diversified subset, preserving all original fields
 *
 * This is a PURE FUNCTION — no globals, no I/O, no side-effects.
 * The output is deterministic given the same inputs.
 *
 * Caps enforced (sorted by edge×prob, best first):
 *   maxPerPlayer    — default 3 — e.g. max 3 Mike Trout props
 *   maxPerGame      — default 7 — prevents one game dominating
 *   maxPerStat      — default 10 — prevents 27 totalbases props
 *   maxPerStatSide  — default 6 — prevents 27 totalbases-under props
 *
 * None of these hard-suppress genuine edge — they ensure the pool
 * naturally represents a diverse range of games, stats, and bet
 * directions so downstream views (featured, AI slips, portfolio)
 * don't start homogeneous.
 */

/**
 * @param {Array}  candidates  Raw bet/best entries
 * @param {Object} [opts]
 * @param {number} [opts.maxPerPlayer=3]
 * @param {number} [opts.maxPerGame=7]
 * @param {number} [opts.maxPerStat=10]
 * @param {number} [opts.maxPerStatSide=6]
 * @returns {Array}  Diversified subset
 */
function diversifyCandidates(candidates, opts = {}) {
  const maxPerPlayer   = opts.maxPerPlayer   ?? 3
  const maxPerGame     = opts.maxPerGame     ?? 7
  const maxPerStat     = opts.maxPerStat     ?? 10
  const maxPerStatSide = opts.maxPerStatSide ?? 6

  if (!Array.isArray(candidates) || candidates.length === 0) return []

  const scored = candidates.map((c) => {
    const edge = Number(c.edge ?? c.edgeProbability ?? 0)
    const prob = Number(c.modelProb ?? c.predictedProbability ?? 0.5)
    const probCapped = Math.max(0.50, Math.min(0.55, prob || 0.5))
    return { c, score: (edge * 4) * probCapped }
  })
  scored.sort((a, b) => b.score - a.score)

  const playerCount   = new Map()
  const gameCount     = new Map()
  const statCount     = new Map()
  const statSideCount = new Map()
  const out = []

  for (const item of scored) {
    const c    = item.c
    const p    = String(c.player || "").toLowerCase()
    const g    = c.eventId || (c.matchup ? String(c.matchup).toLowerCase() : "")
    const sf   = String(c.statFamily || c.propType || "").toLowerCase().replace(/[\s_]+/g, "")
    const side = String(c.side || "").toLowerCase()
    const ss   = sf ? `${sf}|${side}` : ""

    if (p  && (playerCount.get(p)    || 0) >= maxPerPlayer)   continue
    if (g  && (gameCount.get(g)      || 0) >= maxPerGame)     continue
    if (sf && (statCount.get(sf)     || 0) >= maxPerStat)     continue
    if (ss && (statSideCount.get(ss) || 0) >= maxPerStatSide) continue

    out.push(c)
    if (p)  playerCount.set(p,    (playerCount.get(p)    || 0) + 1)
    if (g)  gameCount.set(g,      (gameCount.get(g)      || 0) + 1)
    if (sf) statCount.set(sf,     (statCount.get(sf)     || 0) + 1)
    if (ss) statSideCount.set(ss, (statSideCount.get(ss) || 0) + 1)
  }

  return out
}

module.exports = { diversifyCandidates }
