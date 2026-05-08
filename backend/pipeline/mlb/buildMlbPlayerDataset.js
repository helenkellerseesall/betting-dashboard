"use strict"

const normalizeName = require("../../utils/normalizeName")

function norm(v) {
  return String(v == null ? "" : v).trim()
}

/** Normalize sportsbook / feed lineup signals to 1–9, or null. */
function extractLineupSpotFromRow(r) {
  if (!r || typeof r !== "object") return null
  const keys = ["lineupPosition", "battingOrderIndex", "lineupSpot", "battingOrder", "battingOrderSpot"]
  const tryObj = (o) => {
    if (!o || typeof o !== "object") return null
    for (const k of keys) {
      const raw = Number(o[k])
      if (!Number.isFinite(raw) || raw <= 0) continue
      const n = raw > 20 ? Math.floor(raw / 100) : raw
      if (n >= 1 && n <= 9) return n
    }
    return null
  }
  const direct = tryObj(r)
  if (direct != null) return direct
  return tryObj(r.__src)
}

function lineupCandidatePriority(e) {
  const mk = String(e.marketKey || "").toLowerCase()
  const pt = String(e.propType || "").toLowerCase()
  if (mk === "batter_hits") return 100
  if (pt === "hits" && !mk.includes("first")) return 95
  if (mk.includes("total_bases") || pt.includes("total bases")) return 90
  if (mk.includes("batter_rbis") || pt.includes("rbi")) return 85
  if (mk.includes("batter_runs_scored") || (mk.includes("runs") && mk.includes("batter"))) return 82
  if (mk.includes("batter_") || pt.includes("home run")) return 55
  return 10
}

function pickPreferredLineupSpot(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  const sorted = [...candidates].sort((a, b) => lineupCandidatePriority(b) - lineupCandidatePriority(a))
  const top = sorted[0]
  return Number.isFinite(top?.spot) ? top.spot : null
}

/**
 * Build ONE shared player dataset for the slate.
 * Keyed by normalized player name (single source of truth).
 *
 * Each value is a mutable player object that downstream models
 * (Hits, RBI, etc.) should update IN PLACE.
 */
function buildMlbPlayerDataset(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const playerMap = new Map()

  for (const r of rows) {
    const raw = norm(r?.player)
    if (!raw) continue
    const key = normalizeName(raw)
    if (!key) continue
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        key,
        player: raw,
        team: r?.teamResolved ?? r?.team ?? null,
      })
    }
  }

  // Second pass: attach batting order from any row (prefer main batter markets over novelty).
  for (const r of rows) {
    const raw = norm(r?.player)
    if (!raw) continue
    const key = normalizeName(raw)
    if (!key || !playerMap.has(key)) continue
    const spot = extractLineupSpotFromRow(r)
    if (spot == null) continue
    const o = playerMap.get(key)
    if (!o._lineupCandidates) o._lineupCandidates = []
    o._lineupCandidates.push({
      spot,
      eventId: r?.eventId ?? null,
      marketKey: r?.marketKey ?? null,
      propType: r?.propType ?? null,
    })
  }

  for (const o of playerMap.values()) {
    const chosen = pickPreferredLineupSpot(o._lineupCandidates || [])
    delete o._lineupCandidates
    if (chosen != null) {
      o.battingOrderIndex = chosen
      o.lineupPosition = chosen
    }
  }

  return { playerMap }
}

// ---- Player outcome bands (floor / median / ceiling) — unified with dataset module ----
// ---- Stat families (consumed by buildMlbBestBetsBoard) ----
const HITTER_STATS = ["hits", "totalBases", "hr", "rbis", "runs", "batterKs"]
const PITCHER_STATS = ["ks", "outs", "hitsAllowed", "earnedRuns", "walks"]

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function clamp(lo, hi, x) {
  return Math.max(lo, Math.min(hi, x))
}

function clamp01(x) {
  if (!Number.isFinite(Number(x))) return 0
  return clamp(0, 1, Number(x))
}

function round1(x) {
  return Math.round(Number(x) * 10) / 10
}

function playerSalt(player, eventId) {
  const s = `${String(player || "").toLowerCase()}|${String(eventId || "")}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

/**
 * Build hitter projection bands using ladder probabilities + power profile.
 *
 *   E[hits]     = p(1+) + p(2+) + p(3+)
 *   E[TB]       = p(TB1+) + p(TB2+) + p(TB3+) + p(TB4+) + p(TB5+)?
 *   E[HR]       = hrProbability (clamped to ~[0, 0.6])
 *   E[RBIs]     = p(1+RBI) + p(2+RBI) + p(3+RBI)
 *   E[runs]     ~ heuristic from lineup position + team implied runs
 *   E[batterKs] ~ heuristic from opposing pitcher K-rate (defaults if unknown)
 *
 *  Floor = max(0, E - σ); Ceiling = E + 1.6σ. Sigma is family-specific.
 */
function projectHitterStats({ playerObj, hrProb, salt }) {
  const h1 = num(playerObj?.hit1plus) ?? 0
  const h2 = num(playerObj?.hit2plus) ?? 0
  const h3 = num(playerObj?.hit3plus) ?? 0
  const r1 = num(playerObj?.rbi1plus) ?? 0
  const r2 = num(playerObj?.rbi2plus) ?? 0
  const power = num(playerObj?.powerScore) ?? 8
  const powerNorm = clamp(0, 1, (power - 8) / 24)
  const bo = num(playerObj?.battingOrderIndex) ?? num(playerObj?.lineupPosition)
  const lineupTop = Number.isFinite(bo) ? bo : 6

  // Hits — band tightened so ceiling ~ median + 1 unless multi-hit prob is real.
  const eHits = h1 + h2 + h3
  const hitsMedian = round1(clamp(0, 4, eHits))
  const hitsFloor = Math.max(0, Math.round((hitsMedian - 0.7) * 10) / 10)
  const hitsCeiling = round1(clamp(1, 4, hitsMedian + 0.8 + (h3 > 0.18 ? 0.7 : 0) + (h2 > 0.45 ? 0.3 : 0)))
  const hitsLadder = { 0.5: h1, 1.5: h2, 2.5: h3 }

  // Total bases.
  const tb2 = clamp01(h2 * 0.62 + hrProb * 0.25 + h1 * 0.13 + powerNorm * 0.05)
  const tb3 = clamp01(h2 * 0.45 + hrProb * 0.35 + h3 * 0.2 + powerNorm * 0.06)
  const tb4 = clamp01(hrProb * 0.58 + h2 * 0.22 + h3 * 0.1 + powerNorm * 0.1)
  const eTB = h1 + tb2 + tb3 + tb4
  const tbMedian = round1(clamp(0, 8, eTB))
  const tbFloor = Math.max(0, round1(tbMedian - 0.9))
  const tbCeiling = round1(clamp(2, 9, tbMedian + 1.4 + powerNorm * 1.0))
  const tbLadder = { 0.5: h1, 1.5: tb2, 2.5: tb3, 3.5: tb4 }

  // HR — direct probability is the single source of truth.
  const hrMedian = 0
  const hrFloor = 0
  const hrCeiling = hrProb >= 0.2 ? 1 : 0
  const hrLadder = {
    0.5: hrProb,
    1.5: Math.max(0.001, hrProb * hrProb),
    2.5: Math.max(0.0005, Math.pow(hrProb, 3)),
  }

  // RBIs — tighter ceiling: only widen when 2+RBI prob has real signal.
  const eRbi = r1 + r2 * 1.4
  const rbiMedian = round1(clamp(0, 4, eRbi))
  const rbiFloor = 0
  const rbiCeiling = round1(clamp(1, 4, rbiMedian + 0.9 + (r2 > 0.20 ? 0.6 : 0)))
  const rbiLadder = { 0.5: r1, 1.5: r2 }

  // Runs — direct Bernoulli prior for P(≥1 run). MLB league average is ~0.30
  // for a regular hitter, scaled by team total + lineup spot.
  const teamRunsImplied = num(playerObj?.teamImpliedTotal) ?? 4.4
  const lineupBoost =
    lineupTop <= 2 ? 0.07 : lineupTop <= 4 ? 0.04 : lineupTop <= 6 ? 0.0 : -0.04
  const p1run = clamp(0.15, 0.55, 0.3 + (teamRunsImplied - 4.4) * 0.04 + lineupBoost)
  const eRuns = p1run + p1run * p1run * 0.4
  const runsMedian = round1(eRuns)
  const runsFloor = 0
  const runsCeiling = round1(clamp(1, 3, runsMedian + 0.7))
  const runsLadder = { 0.5: p1run, 1.5: Math.max(0.04, p1run * p1run * 0.6) }

  // Batter Ks — opposing pitcher K rate scaled by typical 4.2 PA.
  const oppKper9 = num(playerObj?.opposingPitcherKper9) ?? num(playerObj?.opposingKsPer9) ?? 8.5
  const eBatterKs = clamp(0.4, 2.0, (oppKper9 / 9) * 4.2)
  const saltedBatterKs = eBatterKs * (1 + (salt - 0.5) * 0.18)
  const batterKsMedian = round1(saltedBatterKs)
  const batterKsFloor = 0
  const batterKsCeiling = round1(clamp(1, 4, batterKsMedian + 1.0))

  return {
    hits: { floor: hitsFloor, mostLikely: hitsMedian, ceiling: hitsCeiling, ladder: hitsLadder },
    totalBases: { floor: tbFloor, mostLikely: tbMedian, ceiling: tbCeiling, ladder: tbLadder },
    hr: { floor: hrFloor, mostLikely: hrMedian, ceiling: hrCeiling, hrProb, ladder: hrLadder },
    rbis: { floor: rbiFloor, mostLikely: rbiMedian, ceiling: rbiCeiling, ladder: rbiLadder },
    runs: { floor: runsFloor, mostLikely: runsMedian, ceiling: runsCeiling, ladder: runsLadder },
    batterKs: { floor: batterKsFloor, mostLikely: batterKsMedian, ceiling: batterKsCeiling },
  }
}

function projectPitcherStats({ pitcherObj, salt }) {
  const expectedKs = num(pitcherObj?.expectedKs)
  const ksLine = num(pitcherObj?.line)
  const k5 = num(pitcherObj?.k5plus) ?? 0
  const k6 = num(pitcherObj?.k6plus) ?? 0
  const k7 = num(pitcherObj?.k7plus) ?? 0
  const k8 = num(pitcherObj?.k8plus) ?? 0

  // E[Ks] — prefer engine's expectedKs; otherwise derive from ladder.
  let eKs = Number.isFinite(expectedKs) ? expectedKs : null
  if (!Number.isFinite(eKs)) {
    // Approximate E[Ks] via ladder probabilities.
    const ladderSum = k5 + k6 + k7 + k8
    eKs = clamp(2.5, 11, 4 + ladderSum * 1.4)
  }
  // Salt nudge ±5%.
  eKs *= 1 + (salt - 0.5) * 0.1
  const ksMedian = round1(clamp(2.5, 12, eKs))
  const ksFloor = round1(clamp(0, 12, ksMedian - 2.4))
  const ksCeiling = round1(clamp(3, 14, ksMedian + 3.0))

  // Outs — assume starter projects ~5-6 IP = 15-18 outs.
  const ipExpected = num(pitcherObj?.ipExpected) ?? num(pitcherObj?.expectedInnings) ?? null
  const outsMedian = Number.isFinite(ipExpected) ? round1(ipExpected * 3) : 17
  const outsFloor = round1(clamp(0, 27, outsMedian - 5))
  const outsCeiling = round1(clamp(6, 27, outsMedian + 4))

  // Hits allowed — derive from K rate (high K → fewer hits).
  const hitsAllowedMedian = clamp(2, 8, 5.4 - (eKs - 6) * 0.18)
  const hitsAllowedFloor = round1(Math.max(0, hitsAllowedMedian - 2.0))
  const hitsAllowedCeiling = round1(clamp(3, 12, hitsAllowedMedian + 3.0))

  // Earned runs — slight inverse to K rate.
  const erMedian = round1(clamp(0.6, 4.5, 2.5 - (eKs - 6) * 0.12))
  const erFloor = 0
  const erCeiling = round1(clamp(1, 7, erMedian + 2.5))

  // Walks — relatively stable, small band.
  const walksMedian = round1(clamp(0.5, 4, 1.8 + (salt - 0.5) * 1.0))
  const walksFloor = 0
  const walksCeiling = round1(clamp(1, 6, walksMedian + 2.0))

  // Pre-calibrated ladder probs from the pitcher Ks engine.
  const ksLadder = { 4.5: k5, 5.5: k6, 6.5: k7, 7.5: k8 }

  return {
    ks: {
      floor: ksFloor,
      mostLikely: ksMedian,
      ceiling: ksCeiling,
      line: ksLine ?? null,
      ladder: ksLadder,
    },
    outs: { floor: outsFloor, mostLikely: round1(outsMedian), ceiling: outsCeiling },
    hitsAllowed: {
      floor: hitsAllowedFloor,
      mostLikely: round1(hitsAllowedMedian),
      ceiling: hitsAllowedCeiling,
    },
    earnedRuns: { floor: erFloor, mostLikely: erMedian, ceiling: erCeiling },
    walks: { floor: walksFloor, mostLikely: walksMedian, ceiling: walksCeiling },
  }
}

/**
 * Merge HR lists into one entry per normalized player: keep the candidate with
 * highest modelProbability (tie-break: higher hrScore). Avoids diverse-list
 * ordering overwriting a stronger mostLikelyHr row.
 */
function mergeHrSourceIndex(hrSrc) {
  const hrIdx = new Map()
  for (const p of hrSrc) {
    const k = normalizeName(p?.player)
    if (!k) continue
    const pr = num(p?.modelProbability)
    const prob = Number.isFinite(pr) ? pr : 0
    const ed = num(p?.edge)
    const edge = Number.isFinite(ed) ? ed : 0
    const hrSc = num(p?.hrScore)
    const hy = num(p?.hybridScore)
    const tag = typeof p?.tag === "string" ? p.tag : null
    const implied = num(p?.impliedProbability)
    const displayPlayer = String(p?.player || "").trim() || null
    const cand = {
      player: displayPlayer,
      prob,
      edge,
      tag,
      hybridScore: Number.isFinite(hy) ? hy : null,
      hrScore: Number.isFinite(hrSc) ? hrSc : null,
      impliedProbability: Number.isFinite(implied) ? implied : null,
    }
    const prev = hrIdx.get(k)
    if (!prev) {
      hrIdx.set(k, cand)
      continue
    }
    const betterProb = prob > prev.prob + 1e-12
    const tieProb = Math.abs(prob - prev.prob) <= 1e-12
    const hrNew = Number.isFinite(hrSc) ? hrSc : -Infinity
    const hrOld = Number.isFinite(prev.hrScore) ? prev.hrScore : -Infinity
    if (betterProb || (tieProb && hrNew > hrOld)) hrIdx.set(k, cand)
  }
  return hrIdx
}

function hrConfidenceNumeric(tag, fallbackProb) {
  const t = String(tag || "").toUpperCase()
  if (t === "ELITE") return 0.82
  if (t === "STRONG") return 0.66
  if (t === "LOTTO") return 0.36
  const fp = num(fallbackProb)
  if (!Number.isFinite(fp) || fp <= 0) return null
  return Math.max(0.12, Math.min(0.88, fp * 2.4))
}

function buildMlbPlayerOutcomePredictions(input = {}) {
  const generatedAt = new Date().toISOString()
  const playerMap = input?.playerMap instanceof Map ? input.playerMap : null
  const hrPredictionToday = input?.hrPredictionToday || {}
  const pitcherKsToday = input?.pitcherKsToday || {}
  const rows = Array.isArray(input?.rows) ? input.rows : []

  // Build a HR probability index for fast lookup.
  const hrSrc = []
  if (Array.isArray(hrPredictionToday?.topHrCandidatesToday)) hrSrc.push(...hrPredictionToday.topHrCandidatesToday)
  if (Array.isArray(hrPredictionToday?.mostLikelyHr)) hrSrc.push(...hrPredictionToday.mostLikelyHr)
  const hrIdx = mergeHrSourceIndex(hrSrc)

  // Build a meta lookup from snapshot rows for matchup/eventId fallback.
  const metaIdx = new Map()
  for (const r of rows) {
    const k = normalizeName(r?.player)
    if (!k || metaIdx.has(k)) continue
    metaIdx.set(k, {
      eventId: r?.eventId ?? null,
      matchup: r?.matchup ?? null,
      team: r?.teamResolved ?? r?.team ?? null,
      teamCode: r?.teamCode ?? null,
      awayTeam: r?.awayTeam ?? null,
      homeTeam: r?.homeTeam ?? null,
      opponent: r?.opponentTeam ?? null,
      isHome: r?.isHome ?? null,
    })
  }

  // -------- Hitters --------
  const hitters = []
  if (playerMap) {
    for (const obj of playerMap.values()) {
      const player = String(obj?.player || "").trim()
      if (!player) continue
      const k = normalizeName(player)
      const meta = metaIdx.get(k) || {}
      const eventId = obj?.eventId ?? meta.eventId ?? null
      const matchup = obj?.matchup ?? meta.matchup ?? null
      const team = obj?.team ?? meta.team ?? null
      const teamCode = obj?.teamCode ?? meta.teamCode ?? null
      const awayTeam = obj?.awayTeam ?? meta.awayTeam ?? null
      const homeTeam = obj?.homeTeam ?? meta.homeTeam ?? null
      const opponent = obj?.opponent ?? obj?.opponentTeam ?? meta.opponent ?? null
      const hrInfo = hrIdx.get(k) || {
        prob: 0,
        edge: 0,
        tag: null,
        hybridScore: null,
        hrScore: null,
        impliedProbability: null,
      }
      const salt = playerSalt(player, eventId)

      // Shared playerMap: keep HR engine outputs aligned with outcome projections (single path).
      obj.hrModelProbability = hrInfo.prob
      obj.hrEdge = hrInfo.edge
      obj.hrConfidenceTag = hrInfo.tag
      obj.hrHybridScore = hrInfo.hybridScore
      obj.hrScoreFromEngine = hrInfo.hrScore

      const stats = projectHitterStats({ playerObj: obj, hrProb: hrInfo.prob, salt })
      const hrConf = hrConfidenceNumeric(hrInfo.tag, hrInfo.prob)
      const hyNum = num(hrInfo.hybridScore)
      const hrEv = Number.isFinite(hyNum)
        ? hyNum
        : Number.isFinite(hrInfo.edge) && hrInfo.prob > 0
          ? hrInfo.edge
          : null

      hitters.push({
        player,
        eventId,
        matchup,
        team,
        teamCode,
        awayTeam,
        homeTeam,
        opponent,
        role: "hitter",
        battingOrder: num(obj?.battingOrderIndex) ?? num(obj?.lineupPosition) ?? null,
        stats,
        hrProb: hrInfo.prob,
        hrProbability: hrInfo.prob,
        hrEdge: hrInfo.edge,
        hrConfidence: hrConf,
        hrExpectedValue: hrEv,
        powerScore: num(obj?.powerScore) ?? null,
      })
    }
  }

  // -------- Pitchers --------
  const pitchers = []
  const pitcherSrc = Array.isArray(pitcherKsToday?.topPitchers) ? pitcherKsToday.topPitchers : []
  for (const p of pitcherSrc) {
    const player = String(p?.player || "").trim()
    if (!player) continue
    const k = normalizeName(player)
    const meta = metaIdx.get(k) || {}
    const eventId = p?.eventId ?? meta.eventId ?? null
    const matchup = meta.matchup ?? null
    const salt = playerSalt(player, eventId)
    const stats = projectPitcherStats({ pitcherObj: p, salt })
    pitchers.push({
      player,
      eventId,
      matchup,
      team: p?.team ?? meta.team ?? null,
      teamCode: p?.teamCode ?? meta.teamCode ?? null,
      awayTeam: p?.awayTeam ?? meta.awayTeam ?? null,
      homeTeam: p?.homeTeam ?? meta.homeTeam ?? null,
      opponent: p?.opponent ?? meta.opponent ?? null,
      role: "pitcher",
      stats,
      expectedKs: num(p?.expectedKs) ?? null,
      ksLine: num(p?.line) ?? null,
    })
  }

  return {
    engine: "mlb-player-outcome-predictions",
    generatedAt,
    hitters,
    pitchers,
    players: [...hitters, ...pitchers],
    meta: {
      hitterCount: hitters.length,
      pitcherCount: pitchers.length,
      hrIndexed: hrIdx.size,
      hitterStats: HITTER_STATS,
      pitcherStats: PITCHER_STATS,
    },
  }
}

module.exports = {
  buildMlbPlayerDataset,
  buildMlbPlayerOutcomePredictions,
  mergeHrSourceIndex,
  HITTER_STATS,
  PITCHER_STATS,
}
