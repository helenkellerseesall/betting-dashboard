"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA First Basket Engine.
 *
 * This is NOT a normal stat prop. It is computed bottom-up:
 *
 *   1. TEAM LEVEL
 *      - Each team starts at ~50% to win the tip.
 *      - Slight nudge from market spread / moneyline (better team marginally favored).
 *      - First-possession quality is then split across that team's starters.
 *
 *   2. PLAYER LEVEL  (starters only)
 *
 *      firstBasketScore =
 *          usageWeight
 *        × scoringProbability
 *        × firstShotTendency
 *        × minutesStartCertainty
 *
 *      - usageWeight:        u >= 18 → ramps from 0 (at 18) to 1 (at 32+)
 *      - scoringProbability: per-minute scoring rate from `points.mostLikely` & minutes
 *      - firstShotTendency:  position weight (PG/SG > SF > PF > C; tweaked by archetype)
 *      - minutesStartCertainty: 1 for starters, 0 otherwise
 *
 *   3. NORMALIZE
 *      Per team, scale the 5 starters' raw scores to sum to that team's
 *      tip-weighted "team scores first" probability. Across both teams the
 *      total ≈ 1.0 (one team WILL score first; jump-ball variance handled).
 *
 *   4. EDGE
 *      Compare modelProb to the sportsbook implied probability when a market
 *      first-basket row exists for that player. Output ranked plays.
 *
 * Inputs:
 *   {
 *     predictions: { players: [...] }    // from buildNbaPlayerOutcomePredictions
 *     completeUniverse: [...]            // raw rows (for context: ML, spread, total)
 *     firstBasketCandidates: [...]       // optional sportsbook rows for edge
 *   }
 *
 * Output:
 *   {
 *     teamProbabilities: [{ eventId, team, tipWinProb, firstPossessionLikelihood }],
 *     players: [{ player, eventId, team, position, archetype, firstBasketScore,
 *                 modelProb, marketImpliedProb?, edge?, oddsAmerican? }],
 *     plays: [...]   // ranked, edge-positive market plays only
 *   }
 */

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
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

function readPosition(p) {
  return String(p?.position || p?.primaryPosition || p?.playerPosition || "")
    .trim()
    .toUpperCase()
}

function positionFirstShotWeight(pos, archetype) {
  const s = String(pos || "").toUpperCase()
  if (/POINT GUARD|\bPG\b/.test(s)) return 1.0
  if (/SHOOTING GUARD|\bSG\b/.test(s)) return 0.85
  if (/SMALL FORWARD|\bSF\b/.test(s)) return 0.78
  if (/POWER FORWARD|\bPF\b/.test(s)) return 0.6
  if (/CENTER|\bC\b/.test(s)) return 0.45
  // archetype fallback
  if (archetype === "shooter") return 0.85
  if (archetype === "big") return 0.5
  return 0.7
}

function archetypeScoringMultiplier(archetype) {
  if (archetype === "shooter") return 1.1
  if (archetype === "big") return 0.9
  return 1.0
}

function usageWeight(usage) {
  const u = num(usage)
  if (u == null) return 0
  if (u < 18) return 0
  if (u >= 32) return 1
  return clamp01((u - 18) / 14)
}

/** Estimate a per-possession scoring probability for the player. */
function scoringProbability(pred) {
  const pts = num(pred?.stats?.points?.mostLikely)
  const mins = num(pred?.adjustedMinutes) || num(pred?.stats?.minutes) || num(pred?._minutes) || null
  // We don't always have minutes on the public output — fall back to a sensible default.
  const minutes = mins && mins > 6 ? mins : 28
  if (pts == null) return 0.0
  // Per-minute scoring rate (rough). Then convert to per-possession (~0.45 possessions/minute).
  const ptsPerMin = pts / minutes
  const perPossScoring = ptsPerMin * 0.45
  // Clamp to a reasonable range.
  return Math.max(0.02, Math.min(0.5, perPossScoring))
}

function getStarterFlag(pred) {
  // Predictions don't always carry starterFlag on public output. Use minutes & usage proxy.
  const mins = num(pred?.adjustedMinutes) || 28
  return mins >= 26
}

/**
 * Compute team-level tip win + first possession likelihood.
 *  - Tip is ~50/50; we apply a tiny nudge based on game spread / ML if present in repRow.
 */
function computeTeamProbabilities(playersByTeamGame) {
  const out = []
  for (const game of playersByTeamGame) {
    const { eventId, teams } = game
    if (!teams || teams.length !== 2) continue
    const [a, b] = teams
    // Tip win baseline: 50/50, with a small nudge of up to ±0.04 based on spread.
    let tipA = 0.5
    let tipB = 0.5
    const spread = num(a.repSpread)
    if (spread != null) {
      const nudge = Math.max(-0.04, Math.min(0.04, -spread * 0.005))
      tipA = clamp01(0.5 + nudge)
      tipB = clamp01(1 - tipA)
    }
    out.push({
      eventId,
      team: a.team,
      tipWinProb: round4(tipA),
      firstPossessionLikelihood: round4(tipA),
    })
    out.push({
      eventId,
      team: b.team,
      tipWinProb: round4(tipB),
      firstPossessionLikelihood: round4(tipB),
    })
  }
  return out
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
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

function indexFirstBasketMarket(candidates) {
  const m = new Map()
  for (const c of candidates || []) {
    if (!c || !c.player || !c.eventId) continue
    const k = `${c.eventId}__${String(c.player).toLowerCase()}`
    // Pick the best (worst-priced) odds for the player → most pessimistic implied prob.
    const prev = m.get(k)
    if (!prev) m.set(k, c)
    else if (Number(c.oddsAmerican || 0) > Number(prev.oddsAmerican || 0)) m.set(k, c)
  }
  return m
}

function getTeamFromUniverseRow(row) {
  return String(row?.team || "").trim() || null
}

function getOpponentFromUniverseRow(row) {
  return String(row?.opponent || row?.opponentTeam || "").trim() || null
}

/**
 * Build first-basket model.
 */
function buildNbaFirstBasketEngine(input = {}) {
  const generatedAt = new Date().toISOString()
  const predictions = input?.predictions || null
  const universe = Array.isArray(input?.completeUniverse) ? input.completeUniverse : []
  const firstBasketCandidates = Array.isArray(input?.firstBasketCandidates)
    ? input.firstBasketCandidates
    : []

  if (!predictions || !Array.isArray(predictions.players) || !predictions.players.length) {
    return {
      teamProbabilities: [],
      players: [],
      plays: [],
      meta: { generatedAt, reason: "no_predictions" },
    }
  }

  const universeIdx = indexUniverseByPlayerEvent(universe)
  const marketIdx = indexFirstBasketMarket(firstBasketCandidates)

  // Group players by event/team.
  const byEvent = new Map()
  for (const p of predictions.players) {
    if (!p || !p.eventId) continue
    const peKey = `${p.eventId}__${String(p.player).toLowerCase()}`
    const repRow = universeIdx.get(peKey) || null
    const team = getTeamFromUniverseRow(repRow) || "UNKNOWN"
    const opponent = getOpponentFromUniverseRow(repRow) || null
    const position = readPosition(repRow) || null
    const usage = num(repRow?.usageRate) ?? num(repRow?.playerUsage) ?? null
    const minutes = num(repRow?.projectedMinutes) ?? num(repRow?.minutes) ?? null
    const archetype = guessArchetype(position)

    if (!byEvent.has(p.eventId)) byEvent.set(p.eventId, new Map())
    const teamMap = byEvent.get(p.eventId)
    if (!teamMap.has(team)) teamMap.set(team, [])
    teamMap.get(team).push({
      pred: p,
      repRow,
      team,
      opponent,
      position,
      usage,
      minutes,
      archetype,
    })
  }

  // Compute team probabilities (tip win is ~50/50 with small spread nudge).
  const teamLevelInput = []
  for (const [eventId, teamMap] of byEvent) {
    const teams = []
    for (const [team, players] of teamMap) {
      const repRow = players[0]?.repRow || null
      teams.push({
        team,
        repSpread: num(repRow?.gameSpread) ?? num(repRow?.spread) ?? null,
      })
    }
    teamLevelInput.push({ eventId, teams })
  }
  const teamProbabilities = computeTeamProbabilities(teamLevelInput)
  const teamProbIdx = new Map()
  for (const tp of teamProbabilities) teamProbIdx.set(`${tp.eventId}__${tp.team}`, tp)

  // Player-level scoring.
  const playersOut = []
  for (const [eventId, teamMap] of byEvent) {
    for (const [team, players] of teamMap) {
      // Compute raw scores for starters in this team.
      const rawScores = []
      for (const entry of players) {
        const isStarter = entry.minutes != null ? entry.minutes >= 26 : getStarterFlag(entry.pred)
        if (!isStarter) continue
        const uW = usageWeight(entry.usage)
        if (uW <= 0) continue
        const sP = scoringProbability(entry.pred) * archetypeScoringMultiplier(entry.archetype)
        const fS = positionFirstShotWeight(entry.position, entry.archetype)
        const mC = entry.minutes != null ? clamp01((entry.minutes - 26) / 8 + 0.5) : 0.6
        const raw = uW * sP * fS * mC
        if (raw <= 0) continue
        rawScores.push({ entry, raw })
      }
      if (!rawScores.length) continue

      const sumRaw = rawScores.reduce((a, b) => a + b.raw, 0)
      const teamProb = teamProbIdx.get(`${eventId}__${team}`)
      const teamFirstScoreProb = teamProb ? teamProb.firstPossessionLikelihood : 0.5
      // Cap any single starter at 35% of the team's first-basket chance (sanity).
      const playerCap = teamFirstScoreProb * 0.35

      for (const { entry, raw } of rawScores) {
        const share = raw / sumRaw
        let modelProb = teamFirstScoreProb * share
        modelProb = Math.min(modelProb, playerCap)
        modelProb = Math.max(0.005, modelProb)
        const marketKey = `${entry.pred.eventId}__${String(entry.pred.player).toLowerCase()}`
        const marketRow = marketIdx.get(marketKey) || null
        const marketImpliedProb = marketRow ? americanToImplied(marketRow.oddsAmerican) : null
        const decOdds = marketRow ? americanToDecimal(marketRow.oddsAmerican) : null
        const edge =
          marketImpliedProb != null && Number.isFinite(marketImpliedProb)
            ? round4(modelProb - marketImpliedProb)
            : null
        const ev =
          decOdds != null && Number.isFinite(decOdds)
            ? round4(modelProb * (decOdds - 1) - (1 - modelProb))
            : null
        playersOut.push({
          player: entry.pred.player,
          eventId,
          matchup: entry.pred.matchup || null,
          team,
          opponent: entry.opponent,
          position: entry.position,
          archetype: entry.archetype,
          usage: entry.usage,
          minutes: entry.minutes,
          firstBasketScore: round4(raw),
          modelProb: round4(modelProb),
          marketImpliedProb: marketImpliedProb != null ? round4(marketImpliedProb) : null,
          oddsAmerican: marketRow ? marketRow.oddsAmerican : null,
          sportsbook: marketRow ? marketRow.book || marketRow.sportsbook || null : null,
          edge,
          ev,
        })
      }
    }
  }

  playersOut.sort((a, b) => b.modelProb - a.modelProb)

  const plays = playersOut
    .filter((p) => p.edge != null && p.edge > 0 && Number(p.ev || 0) > 0)
    .sort((a, b) => b.edge - a.edge)

  return {
    teamProbabilities,
    players: playersOut,
    plays,
    meta: {
      generatedAt,
      playerCount: playersOut.length,
      starterCount: playersOut.length,
      marketRowsConsidered: firstBasketCandidates.length,
      playsWithEdge: plays.length,
    },
  }
}

function guessArchetype(position) {
  const s = String(position || "").toUpperCase()
  if (/CENTER|\bC\b|POWER FORWARD|\bPF\b/.test(s)) return "big"
  if (/POINT GUARD|\bPG\b|SHOOTING GUARD|\bSG\b/.test(s)) return "shooter"
  return "wing"
}

module.exports = {
  buildNbaFirstBasketEngine,
}
