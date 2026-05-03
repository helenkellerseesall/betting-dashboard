"use strict"

const { statFamilyKey } = require("./nbaAiOutcomeRange")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function playerKey(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

function eventKey(c) {
  return String(c?.eventId || "").trim()
}

/** Align with buildNbaSlipEngine heuristics (position / height / rebound proxy). */
function isBigLike(row) {
  const pos = String(row?.position || row?.primaryPosition || row?.playerPosition || row?.depthPosition || "").toUpperCase()
  if (/\bC\b|CENTER|\bPF\b|POWER/.test(pos)) return true
  const height = toNum(row?.heightInches) ?? toNum(row?.height)
  if (Number.isFinite(height) && height >= 81) return true
  const rebRate = toNum(row?.reboundRate) ?? toNum(row?.rebRate) ?? toNum(row?.reboundPct)
  if (Number.isFinite(rebRate) && rebRate >= 0.16) return true
  return false
}

function isGuardLike(row) {
  const pos = String(row?.position || row?.primaryPosition || row?.playerPosition || row?.depthPosition || "").toUpperCase()
  if (/\bPG\b|\bSG\b|^G\b|GUARD/.test(pos)) return true
  const height = toNum(row?.heightInches) ?? toNum(row?.height)
  if (Number.isFinite(height) && height <= 77) return true
  const rebRate = toNum(row?.reboundRate) ?? toNum(row?.rebRate) ?? toNum(row?.reboundPct)
  if (Number.isFinite(rebRate) && rebRate <= 0.1) return true
  return false
}

function readUsage(row) {
  return (
    toNum(row?.usageRate) ??
    toNum(row?.playerUsage) ??
    toNum(row?.usage) ??
    toNum(row?.roleUsagePct) ??
    null
  )
}

function readMinutes(row) {
  return (
    toNum(row?.projectedMinutes) ??
    toNum(row?.minutes) ??
    toNum(row?.projectedMins) ??
    null
  )
}

function readMaxUsage(contextRows) {
  let m = null
  for (const r of contextRows) {
    const u = readUsage(r)
    if (u != null && Number.isFinite(u)) m = m == null ? u : Math.max(m, u)
  }
  return m
}

function readMaxMinutes(contextRows) {
  let m = null
  for (const r of contextRows) {
    const mn = readMinutes(r)
    if (mn != null && Number.isFinite(mn)) m = m == null ? mn : Math.max(m, mn)
  }
  return m
}

/** Best recentForm.baseline per family from the player+event pool (volume proxy). */
function harvestBaselines(contextRows) {
  let maxPts = null
  let maxAst = null
  let maxThrees = null
  for (const r of contextRows) {
    const b = toNum(r?.recentForm?.baseline)
    if (!Number.isFinite(b)) continue
    const fam = statFamilyKey(r)
    if (fam === "points" || fam === "pra") maxPts = maxPts == null ? b : Math.max(maxPts, b)
    if (fam === "assists") maxAst = maxAst == null ? b : Math.max(maxAst, b)
    if (fam === "threes") maxThrees = maxThrees == null ? b : Math.max(maxThrees, b)
  }
  return { maxPts, maxAst, maxThrees }
}

/**
 * @typedef {'HIGH_USAGE_SCORER'|'BALANCED'|'ROLE_LOW_USAGE'|'NEUTRAL'} VolumeArchetype
 */

/**
 * Star scorers vs facilitators vs bench — uses usage, minutes, and baseline lines when present.
 */
function inferVolumeArchetype(contextRows) {
  if (!Array.isArray(contextRows) || !contextRows.length) return "NEUTRAL"
  const rep = contextRows[0]
  const u = readMaxUsage(contextRows) ?? readUsage(rep) ?? 20
  const min = readMaxMinutes(contextRows) ?? readMinutes(rep) ?? 26
  const { maxPts, maxAst } = harvestBaselines(contextRows)

  if (min < 21.5 || u < 18.5) return "ROLE_LOW_USAGE"

  const strongCreator =
    (Number.isFinite(maxAst) && maxAst >= 7.0 && u >= 23) ||
    (Number.isFinite(maxAst) && maxAst >= 7.8 && u >= 21.5)

  if (strongCreator) return "BALANCED"

  if (
    u >= 27 &&
    min >= 30.5 &&
    Number.isFinite(maxPts) &&
    maxPts >= 21 &&
    Number.isFinite(maxAst) &&
    maxAst < 6.8
  )
    return "HIGH_USAGE_SCORER"

  if (isBigLike(rep) && u >= 24.5 && min >= 29.5 && !(Number.isFinite(maxAst) && maxAst >= 7.2))
    return "HIGH_USAGE_SCORER"

  if (u >= 30 && min >= 31) return "HIGH_USAGE_SCORER"

  if (
    !strongCreator &&
    u >= 27.5 &&
    min >= 31.5 &&
    !isGuardLike(rep) &&
    (Number.isFinite(maxPts) ? maxPts >= 20 : true)
  )
    return "HIGH_USAGE_SCORER"

  return "NEUTRAL"
}

/**
 * Primary scoring paths get a lift; low-volume stat types get suppressed for star scorers only.
 */
function volumePriorityMultiplier(archetype, family) {
  if (archetype !== "HIGH_USAGE_SCORER") return 1.0
  if (family === "points" || family === "pra") return 1.14
  if (family === "rebounds") return 1.07
  if (family === "combo") return 1.05
  if (family === "assists" || family === "threes") return 0.76
  return 0.94
}

/** True if assists/threes have credible projection volume for elite exception path. */
function hasVolumeSupportForLowVolumeStat(contextRows, family) {
  for (const r of contextRows) {
    if (statFamilyKey(r) !== family) continue
    const b = toNum(r?.recentForm?.baseline)
    const fw = toNum(r.finalWeight) ?? 0
    if (family === "assists") {
      if (Number.isFinite(b) && b >= 6.4) return true
      if (fw >= 1.88) return true
    }
    if (family === "threes") {
      if (Number.isFinite(b) && b >= 2.15) return true
      if (fw >= 1.92) return true
    }
  }
  return false
}

/**
 * @returns {'BIG'|'GUARD'|'WING'}
 */
function inferPlayerRole(row) {
  if (!row || typeof row !== "object") return "WING"
  const roleStr = String(row?.role || row?.rotationRole || row?.playerRole || "")
    .trim()
    .toLowerCase()
  if (/^big|center|pf|^\s*c\s*$|power/.test(roleStr)) return "BIG"
  if (/^guard|^pg|^sg|primary.*guard|ball/.test(roleStr)) return "GUARD"
  if (/wing|forward|sf|w\s*\/\s*f/.test(roleStr)) return "WING"

  const big = isBigLike(row)
  const guard = isGuardLike(row)
  const u = readUsage(row) ?? 20

  if (big && !guard) return "BIG"
  if (guard && !big) return "GUARD"
  if (big && guard) {
    const h = toNum(row?.heightInches) ?? toNum(row?.height)
    if (Number.isFinite(h) && h >= 80) return "BIG"
    if (u >= 26) return "GUARD"
    return "WING"
  }

  const rebR = toNum(row?.reboundRate) ?? toNum(row?.rebRate)
  if (Number.isFinite(rebR) && rebR >= 0.14 && u >= 22) return "BIG"
  if (Number.isFinite(rebR) && rebR <= 0.09 && u >= 23) return "GUARD"

  return "WING"
}

/**
 * Baseline stability / quality by stat family (high-variance families capped lower).
 * Applied as a multiplier on the composite signal; role bump stays additive after.
 */
function statStabilityWeight(family) {
  const m = {
    points: 1.06,
    pra: 1.09,
    rebounds: 1.04,
    combo: 1.03,
    assists: 0.94,
    threes: 0.81,
    other: 0.92,
  }
  const w = m[family]
  return Number.isFinite(w) ? w : 0.92
}

/** Additive bump so weak off-profile stats do not outrank core ones (multi-stat preserved). */
function roleStatScoreBump(role, family) {
  const R = {
    BIG: {
      points: 0.44,
      pra: 0.48,
      rebounds: 0.42,
      assists: -0.72,
      threes: -0.74,
      combo: -0.02,
      other: -0.08,
    },
    GUARD: {
      points: 0.5,
      pra: 0.2,
      rebounds: -0.64,
      assists: 0.44,
      threes: 0.4,
      combo: 0.2,
      other: -0.05,
    },
    WING: {
      points: 0.26,
      pra: 0.28,
      rebounds: -0.2,
      assists: 0.1,
      threes: 0.28,
      combo: 0.16,
      other: -0.06,
    },
  }
  const m = R[role] || R.WING
  return toNum(m[family]) ?? 0
}

/**
 * Base composite (no role, no stability) — same weighting as compositeRankScore in buildNbaAiPicks.
 * Components: finalWeight, edge, form, matchup, pace, blowout, statAdj.
 */
function statScoreRowBase(c) {
  const fw = toNum(c.finalWeight) ?? 0
  const e = toNum(c.edge) ?? 0
  const m = toNum(c.matchupAdj) ?? 0
  const p = toNum(c.paceAdj) ?? 0
  const b = toNum(c.blowoutAdj) ?? 0
  const s = toNum(c.statAdj) ?? 0
  const rf = c.recentForm && typeof c.recentForm === "object" ? c.recentForm : null
  const trend = toNum(rf?.trend_delta) ?? 0
  const formN = trend > 0.08 ? 0.12 : trend < -0.08 ? -0.1 : trend > 0 ? 0.05 : trend < 0 ? -0.04 : 0
  return fw + 3.2 * e + 1.15 * m + 0.85 * p + 0.45 * b + 0.35 * s + formN
}

/**
 * statScore = composite × statStability × volumePriority + role bump (ranking + peer dominance).
 * @param {VolumeArchetype} [archetype]
 */
function statScoreRow(c, archetype = "NEUTRAL") {
  const fam = statFamilyKey(c)
  const role = inferPlayerRole(c)
  const base = statScoreRowBase(c)
  const stab = statStabilityWeight(fam)
  const vol = volumePriorityMultiplier(archetype, fam)
  return base * stab * vol + roleStatScoreBump(role, fam)
}

/**
 * Peer-relative dominance: boost families with best finalWeight / edge / composite vs same player,
 * penalize families clearly behind the pack (no rows removed — ranking only).
 */
function peerDominanceAdjustment(c, peers, archetype = "NEUTRAL") {
  if (!peers || peers.length < 2) return 0

  const byFam = new Map()
  for (const r of peers) {
    const f = statFamilyKey(r)
    if (f === "other") continue
    if (!byFam.has(f)) byFam.set(f, [])
    byFam.get(f).push(r)
  }

  const famStats = []
  for (const [f, rs] of byFam.entries()) {
    const sc = Math.max(...rs.map((r) => statScoreRow(r, archetype)))
    const mfw = Math.max(...rs.map((r) => toNum(r.finalWeight) ?? 0))
    const med = Math.max(...rs.map((r) => toNum(r.edge) ?? -9))
    let mtrend = -99
    for (const r of rs) {
      const t = toNum(r.recentForm?.trend_delta)
      if (Number.isFinite(t)) mtrend = Math.max(mtrend, t)
    }
    famStats.push({ f, sc, mfw, med, mtrend })
  }

  const bestFw = Math.max(...famStats.map((x) => x.mfw), 0)
  const bestEd = Math.max(...famStats.map((x) => x.med), -99)
  const bestSc = Math.max(...famStats.map((x) => x.sc), 0)
  const bestTr = Math.max(...famStats.map((x) => (x.mtrend > -99 ? x.mtrend : -99)), -99)

  const fam = statFamilyKey(c)
  const mine = famStats.find((x) => x.f === fam)
  if (!mine) return 0

  const rFw = bestFw > 0 ? mine.mfw / bestFw : 1
  const rEd = bestEd > -8 ? mine.med / Math.max(bestEd, 1e-6) : 1
  const rSc = bestSc > 0 ? mine.sc / bestSc : 1

  let adj = 0
  if (rFw >= 0.96 && rEd >= 0.9 && rSc >= 0.94) adj += 0.82
  else if (rFw >= 0.91 && rEd >= 0.84 && rSc >= 0.88) adj += 0.52
  else if (rFw >= 0.86 && rEd >= 0.78 && rSc >= 0.82) adj += 0.28

  if (rFw < 0.74 || rEd < 0.64) adj -= 1.18
  if (rFw < 0.58) adj -= 0.82
  if (rSc < 0.7 && (rFw < 0.88 || rEd < 0.78)) adj -= 0.62

  if (mine.mtrend > -99 && bestTr > -99 && mine.mtrend >= bestTr - 1e-6) adj += 0.14
  else if (mine.mtrend > -99 && bestTr > -99 && mine.mtrend < bestTr - 0.06) adj -= 0.22

  return adj
}

/**
 * Full ranking score for a row within a player-event bucket.
 * @param {'elite'|'strong'} tier — elite applies extra edge gate for weak paths
 */
function tierAwareStatScore(c, peers, tier = "strong", archetype = "NEUTRAL") {
  let s = statScoreRow(c, archetype) + peerDominanceAdjustment(c, peers, archetype)
  if (tier === "elite") {
    const fam = statFamilyKey(c)
    const same = peers.filter((r) => statFamilyKey(r) === fam)
    const maxE = Math.max(...same.map((r) => toNum(r.edge) ?? 0))
    const maxAllE = Math.max(...peers.map((r) => toNum(r.edge) ?? 0))
    if (maxAllE > 0 && maxE / maxAllE < 0.58) s -= 1.15
    else if (maxAllE > 0 && maxE / maxAllE < 0.68) s -= 0.72

    const maxFwF = Math.max(...same.map((r) => toNum(r.finalWeight) ?? 0))
    const maxFwAll = Math.max(...peers.map((r) => toNum(r.finalWeight) ?? 0))
    if (maxFwAll > 0 && maxFwF / maxFwAll < 0.62) s -= 0.55
  }
  return s
}

function bestRowInFamily(rows, peers, tier, archetype = "NEUTRAL") {
  if (!rows.length) return null
  return [...rows].sort(
    (a, b) => tierAwareStatScore(b, peers, tier, archetype) - tierAwareStatScore(a, peers, tier, archetype)
  )[0]
}

/**
 * Remove off-profile families from the ranked list when core families exist (multi-stat preserved in pool).
 */
function roleFilterRankedFamilies(role, scored) {
  if (role === "BIG") {
    const hasCore = scored.some((s) => ["points", "pra", "rebounds", "combo"].includes(s.family))
    if (hasCore) return scored.filter((s) => !["assists", "threes"].includes(s.family))
  }
  if (role === "GUARD") {
    const hasCore = scored.some((s) =>
      ["points", "pra", "assists", "threes", "combo"].includes(s.family)
    )
    if (hasCore) return scored.filter((s) => s.family !== "rebounds")
  }
  return scored
}

/**
 * For star forwards/centers: drop assists/threes from the family race when core scoring exists
 * (guards stay multi-stat — Maxey-class creators are usually BALANCED, not HIGH_USAGE_SCORER).
 */
function highUsagePrimaryScoringFilter(archetype, role, scored) {
  if (archetype !== "HIGH_USAGE_SCORER") return scored
  if (role === "GUARD") return scored
  const hasCore = scored.some((s) => ["points", "pra", "rebounds", "combo"].includes(s.family))
  if (!hasCore) return scored
  return scored.filter((s) => !["assists", "threes"].includes(s.family))
}

/**
 * Elite: drop families whose stability+role statScore is far below the player's best path
 * (prevents high-variance / off-role families from sneaking in via peer adjustments).
 */
function eliteCoreQualityGate(contextRows, scored, archetype = "NEUTRAL") {
  if (!scored.length) return scored
  const topCore = Math.max(...contextRows.map((r) => statScoreRow(r, archetype)))
  if (!Number.isFinite(topCore)) return scored
  const minRatio = 0.84
  const minAbsGap = 0.58
  return scored.filter((s) => {
    const sr = statScoreRow(s.row, archetype)
    return sr >= topCore * minRatio - 1e-9 && sr >= topCore - minAbsGap
  })
}

/**
 * High-usage scorers: assists/threes cannot be ELITE unless within 95% of top statScore and volume-backed.
 */
function eliteHighUsageLowVolumeGate(contextRows, archetype, scored) {
  if (archetype !== "HIGH_USAGE_SCORER" || !scored.length) return scored
  const topCore = Math.max(...contextRows.map((r) => statScoreRow(r, archetype)))
  if (!Number.isFinite(topCore)) return scored
  const minRatio = 0.95
  return scored.filter((s) => {
    const fam = s.family
    if (fam !== "assists" && fam !== "threes") return true
    const sr = statScoreRow(s.row, archetype)
    if (sr < topCore * minRatio - 1e-9) return false
    return hasVolumeSupportForLowVolumeStat(contextRows, fam)
  })
}

/**
 * Elite: drop secondary families that are not competitive vs #1 (weak paths cannot surface in elite list).
 */
function eliteCompetitivenessFilter(scored) {
  if (scored.length <= 1) return scored
  const top = scored[0].score
  return scored.filter((s, i) => i === 0 || (s.score >= top * 0.78 && s.score >= top - 0.52))
}

/**
 * Strong: only keep families close to the player's best statScore on the full board (optional STRONG).
 * `contextRows` = all props for that player+event (e.g. full pool), not only the strong-tier subset.
 */
function strongClosenessFilter(contextRows, scored, archetype = "NEUTRAL") {
  if (!scored.length) return scored
  const topCore = Math.max(...contextRows.map((r) => statScoreRow(r, archetype)))
  if (!Number.isFinite(topCore) || topCore <= 0) return scored
  const minRatio = 0.848
  const minAbsGap = 0.72
  const filtered = scored.filter((s) => {
    const sr = statScoreRow(s.row, archetype)
    return sr >= topCore * minRatio - 1e-9 && sr >= topCore - minAbsGap
  })
  return filtered.length ? filtered : []
}

/**
 * Group rows by stat family; rank by tier-aware score (dominance + role + elite gates).
 * @param {'elite'|'strong'} tier
 * @param {object[]|null} scoreContextRows — full player+event rows for quality/closeness vs best path (defaults to `rows`)
 */
function rankStatFamiliesForPlayer(rows, maxFamilies = 1, tier = "strong", scoreContextRows = null) {
  const ctx = Array.isArray(scoreContextRows) && scoreContextRows.length ? scoreContextRows : rows
  const vol = inferVolumeArchetype(ctx)
  const byFam = new Map()
  for (const c of rows) {
    const fam = statFamilyKey(c)
    if (fam === "other") continue
    if (!byFam.has(fam)) byFam.set(fam, [])
    byFam.get(fam).push(c)
  }
  const scored = []
  for (const [family, items] of byFam.entries()) {
    const best = bestRowInFamily(items, rows, tier, vol)
    if (!best) continue
    const score = Math.max(...items.map((c) => tierAwareStatScore(c, rows, tier, vol)))
    scored.push({ family, score, row: best })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      tierAwareStatScore(b.row, rows, tier, vol) - tierAwareStatScore(a.row, rows, tier, vol)
  )

  const rep = rows[0]
  const role = inferPlayerRole(rep)
  let ranked = roleFilterRankedFamilies(role, scored)
  if (!ranked.length) ranked = scored
  ranked = highUsagePrimaryScoringFilter(vol, role, ranked)
  if (!ranked.length && vol === "HIGH_USAGE_SCORER") {
    ranked = scored.filter((s) => !["assists", "threes"].includes(s.family))
  }
  if (!ranked.length) ranked = scored

  if (tier === "elite") {
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        tierAwareStatScore(b.row, rows, tier, vol) - tierAwareStatScore(a.row, rows, tier, vol)
    )
    ranked = eliteCoreQualityGate(ctx, ranked, vol)
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        tierAwareStatScore(b.row, rows, tier, vol) - tierAwareStatScore(a.row, rows, tier, vol)
    )
    ranked = eliteHighUsageLowVolumeGate(ctx, vol, ranked)
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        tierAwareStatScore(b.row, rows, tier, vol) - tierAwareStatScore(a.row, rows, tier, vol)
    )
    ranked = eliteCompetitivenessFilter(ranked)
  } else if (tier === "strong") {
    ranked = strongClosenessFilter(ctx, ranked, vol)
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        tierAwareStatScore(b.row, rows, tier, vol) - tierAwareStatScore(a.row, rows, tier, vol)
    )
  }

  return ranked.slice(0, Math.max(0, maxFamilies))
}

/**
 * Expand tier: top stat family per (player, event) by default; global sort by aiStatFamilyScore.
 * @param {'elite'|'strong'} tier
 * @param {Map<string, object[]>|null} fullRowsByPlayerEvent — `${playerKey}::${eventId}` → all pool rows for quality gates
 */
function expandCandidatesByTopStatFamilies(
  candidateRows,
  maxFamiliesPerPlayer,
  maxTotalRows,
  tier = "strong",
  fullRowsByPlayerEvent = null
) {
  const byPe = new Map()
  for (const c of candidateRows) {
    const pk = playerKey(c)
    const ek = eventKey(c)
    if (!pk || !ek) continue
    const k = `${pk}::${ek}`
    if (!byPe.has(k)) byPe.set(k, [])
    byPe.get(k).push(c)
  }

  const out = []
  for (const [k, rows] of byPe.entries()) {
    const ctx = fullRowsByPlayerEvent?.get(k) ?? rows
    const ranked = rankStatFamiliesForPlayer(rows, maxFamiliesPerPlayer, tier, ctx)
    const vol = inferVolumeArchetype(ctx)
    for (const { family, score, row } of ranked) {
      out.push({
        ...row,
        aiStatFamily: family,
        aiStatFamilyScore: score,
        aiPlayerRole: inferPlayerRole(row),
        aiVolumeArchetype: vol,
      })
    }
  }

  out.sort((a, b) => toNum(b.aiStatFamilyScore) - toNum(a.aiStatFamilyScore))
  return out.slice(0, maxTotalRows)
}

/** `player|eventId|family` for dedupe across tiers */
function playerEventFamilyKey(c) {
  const fam = c.aiStatFamily || statFamilyKey(c)
  return `${playerKey(c)}|${eventKey(c)}|${fam}`
}

module.exports = {
  statScoreRow,
  statScoreRowBase,
  statStabilityWeight,
  statFamilyKey,
  inferPlayerRole,
  inferVolumeArchetype,
  tierAwareStatScore,
  rankStatFamiliesForPlayer,
  expandCandidatesByTopStatFamilies,
  playerEventFamilyKey,
  playerKey,
}
