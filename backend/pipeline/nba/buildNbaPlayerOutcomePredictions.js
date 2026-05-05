"use strict"

/**
 * Per-player outcome predictions: player-specific projections, aligned bets, per-game caps.
 * Uses pool rows only (usage, minutes, position, recentForm, lines) — no ingest/lane changes.
 */

const { statFamilyKey, predictedMedianOutcome } = require("./nbaAiOutcomeRange")
const { collectFullPool } = require("./buildNbaAiSlips")
const { nbaRowModelProbability } = require("./nbaModelSignals")

const STAT_ORDER = ["points", "threes", "rebounds", "assists"]

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

/** Stat-type volatility baseline (0–1): threes highest, points medium, rebounds lower. */
function volatilityBaseByFamily(family) {
  if (family === "threes") return 0.74
  if (family === "points") return 0.46
  if (family === "assists") return 0.44
  if (family === "rebounds") return 0.32
  return 0.42
}

function readRecentFormDelta(rep) {
  const rf = rep?.recentForm && typeof rep.recentForm === "object" ? rep.recentForm : null
  const l5 = toNum(rf?.last5_avg)
  const l10 = toNum(rf?.last10_avg)
  if (!Number.isFinite(l5) || !Number.isFinite(l10)) return 0
  const denom = Math.max(0.65, Math.abs(l10) * 0.32)
  return clamp01(Math.abs(l5 - l10) / denom)
}

/** Higher when minutes projection is far from a stable rotation anchor. */
function minutesStabilityVol(minutes) {
  const m = Number.isFinite(minutes) ? minutes : 26
  return clamp01(Math.abs(m - 30) / 13)
}

/**
 * Volatility 0–1: stat baseline + role + 5g vs 10g + minutes stability + small id spread.
 */
function volatilityScore(family, rep, rangeCtx) {
  let v = volatilityBaseByFamily(family)
  const arch = rangeCtx?.archetype || "wing"
  if (family === "threes") {
    if (arch === "shooter") v += 0.16
    if (arch === "wing") v += 0.06
    if (arch === "big") v -= 0.18
  }
  if (family === "points" && arch === "shooter") v += 0.1
  if (family === "rebounds" && arch === "big") v -= 0.08
  v += 0.34 * readRecentFormDelta(rep || {})
  v += 0.24 * minutesStabilityVol(rangeCtx?.minutes ?? readMinutes(rep) ?? 26)
  const d = Number(rangeCtx?.differentiator) || 0
  v += d * 0.11
  return clamp01(v)
}

/**
 * Context 0–1: pace, total, defense / matchup, usage spike (injuries / role).
 */
function contextScoreForStat(rep, family) {
  if (!rep || typeof rep !== "object") return 0.12
  const pace = toNum(rep.eventPace ?? rep.pace ?? rep.projectedPace ?? rep.gamePace ?? rep.opponentPace)
  const total = toNum(rep.gameTotal ?? rep.eventTotal ?? rep.total ?? rep.overUnder ?? rep.projectedTotal)
  const matchupAdj = toNum(rep.matchupAdj) ?? 0
  const oppDef = toNum(
    rep.opponentDefenseVsPosition ??
      rep.oppDefenseVsPosition ??
      rep.defenseVsPosition ??
      rep.opponentDvP
  )
  const usage = readUsage(rep) ?? 20

  let s = 0.06
  if (Number.isFinite(pace)) s += clamp01((pace - 96) / 11) * 0.3
  if (Number.isFinite(total)) s += clamp01((total - 214) / 24) * 0.28

  s += clamp01((matchupAdj + 0.06) * 5.5 + 0.2) * 0.2

  if (Number.isFinite(oppDef)) {
    const w = family === "threes" || family === "points" ? 0.2 : family === "assists" ? 0.16 : 0.14
    s += clamp01((oppDef + 2.5) / 7) * w
  }

  if (usage >= 31) s += 0.22
  else if (usage >= 28) s += 0.14
  else if (usage >= 25.5) s += 0.08

  let famAdj = 1
  if (family === "threes") famAdj = 1.06
  if (family === "rebounds") famAdj = 0.92
  return clamp01(s * famAdj)
}

/* -------------------------------------------------------------------------- *
 * DYNAMIC ADJUSTMENT LAYER — modifies ctx.usage & ctx.minutes BEFORE projectStat /
 * projectThreesFromAttempts; threes pack minutes flow into meta for hybrid median.
 * Ceiling spike boost (non-input) remains additive in buildRangesFromProjection only.
 * -------------------------------------------------------------------------- */

function clampN(min, max, x) {
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
}

/**
 * Form: short-term avg (last5) vs baseline (last10). Hot / cold streaks up to ~±25%.
 * Range: 0.75 → 1.25.
 */
function dynamicFormMultiplier(rep) {
  const rf = rep?.recentForm && typeof rep.recentForm === "object" ? rep.recentForm : null
  if (!rf) return 1
  const short = toNum(rf.last5_avg)
  const long = toNum(rf.last10_avg) ?? toNum(rf.baseline)
  if (!Number.isFinite(short) || !Number.isFinite(long) || long <= 0.5) return 1
  const delta = (short - long) / long
  return clampN(0.75, 1.25, 1 + clampN(-0.25, 0.25, delta * 1.35))
}

/**
 * Matchup: matchupAdj + opponent defense vs position.
 * Weak matchup / soft D → up to ~+20%; tough D → up to ~−20%.
 * Range: 0.80 → 1.20.
 */
function dynamicMatchupMultiplier(rep, family) {
  const matchupAdj = toNum(rep?.matchupAdj) ?? 0
  const oppDef = toNum(
    rep?.opponentDefenseVsPosition ??
      rep?.oppDefenseVsPosition ??
      rep?.defenseVsPosition ??
      rep?.opponentDvP
  )
  let m = 1 + clampN(-0.18, 0.18, matchupAdj * 3.5)
  if (Number.isFinite(oppDef)) {
    const w = family === "threes" || family === "points" ? 0.065 : 0.052
    m += clampN(-0.12, 0.12, (oppDef - 0) * w)
  }
  return clampN(0.8, 1.2, m)
}

/**
 * Pace + game total: more possessions / higher scoring environment lifts volume.
 * Range: 0.85 → 1.15 (feeds minutes input multiplier).
 */
function dynamicPaceMultiplier(rep) {
  const pace = toNum(
    rep?.eventPace ?? rep?.pace ?? rep?.projectedPace ?? rep?.gamePace ?? rep?.opponentPace
  )
  const total = toNum(
    rep?.gameTotal ?? rep?.eventTotal ?? rep?.total ?? rep?.overUnder ?? rep?.projectedTotal
  )
  let m = 1
  if (Number.isFinite(pace)) m += clampN(-0.1, 0.12, (pace - 100) * 0.016)
  if (Number.isFinite(total)) m += clampN(-0.07, 0.08, (total - 224) * 0.005)
  return clampN(0.85, 1.15, m)
}

/**
 * Usage shift today vs typical: high-usage tails get an extra bump, very low usage trims.
 * Range: 0.85 → 1.18.
 */
function dynamicUsageShiftMultiplier(rep) {
  const u = readUsage(rep) ?? 20
  let m = 1
  if (u >= 32) m += 0.14
  else if (u >= 29) m += 0.1
  else if (u >= 26) m += 0.06
  else if (u >= 23) m += 0.025
  else if (u <= 16) m -= 0.08
  else if (u <= 18) m -= 0.04
  return clampN(0.85, 1.18, m)
}

/**
 * Combined dynamic multiplier (legacy / diagnostics). Prefer adjusting usage & minutes via
 * dynamicUsageInputMultiplier + dynamicMinutesInputMultiplier before projectStat.
 */
function dynamicProjectionMultiplier(rep, family) {
  if (!rep || typeof rep !== "object") return 1
  const f = dynamicFormMultiplier(rep)
  const m = dynamicMatchupMultiplier(rep, family)
  const p = dynamicPaceMultiplier(rep)
  const u = dynamicUsageShiftMultiplier(rep)
  return clampN(0.7, 1.35, f * m * p * u)
}

/**
 * Context → today's usage input (before projectStat / pack math).
 * Form + matchup + role/usage tail. Range ~0.65–1.45.
 */
function dynamicUsageInputMultiplier(rep) {
  if (!rep || typeof rep !== "object") return 1
  const f = dynamicFormMultiplier(rep)
  const m = dynamicMatchupMultiplier(rep, "points")
  const r = dynamicUsageShiftMultiplier(rep)
  return clampN(0.65, 1.45, f * m * Math.pow(r, 0.65))
}

/**
 * Blowout / tight game → rotation minutes (spread-based).
 */
function dynamicBlowoutMinutesMultiplier(rep) {
  const sp = Math.abs(toNum(rep?.spread ?? rep?.gameSpread ?? rep?.lineSpread) ?? 0)
  if (!Number.isFinite(sp) || sp <= 0) return 1
  if (sp <= 4) return 1.035
  if (sp <= 6.5) return 1.01
  if (sp >= 14) return 0.945
  if (sp >= 10) return 0.97
  return 1
}

/**
 * Context → today's minutes input (pace + game environment + blowout risk).
 * Range ~0.75–1.25.
 */
function dynamicMinutesInputMultiplier(rep) {
  if (!rep || typeof rep !== "object") return 1
  const p = dynamicPaceMultiplier(rep)
  const b = dynamicBlowoutMinutesMultiplier(rep)
  return clampN(0.75, 1.25, p * b)
}

/**
 * Blowout / tight game ceiling-only adjustment (additive boost to spikeAllowance).
 * Tight game (spread ≤ 4) → +; large blowout (spread ≥ 12) → −.
 */
function dynamicCeilingSpikeBoost(rep, family) {
  const sp = Math.abs(toNum(rep?.spread ?? rep?.gameSpread ?? rep?.lineSpread) ?? 0)
  if (!Number.isFinite(sp) || sp === 0) return 0
  const scale = family === "threes" ? 1 : 0.6
  if (sp <= 3.5) return 0.6 * scale
  if (sp <= 5.5) return 0.3 * scale
  if (sp >= 13) return -1.2 * scale
  if (sp >= 10) return -0.7 * scale
  return 0
}

/**
 * Spike factor by effective 3PA volume. `salt` ∈ [0,1) spreads within each band per player.
 */
function threesSpikeFactor(threePA, salt) {
  const pa = Number.isFinite(threePA) ? threePA : 0
  const t = clamp01(Number(salt) || 0)
  if (pa >= 8) return 0.8 + t * 0.4
  if (pa >= 5) return 0.6 + t * 0.3
  if (pa >= 2) return 0.3 + t * 0.3
  return 0.1 + t * 0.2
}

/**
 * Additive context for threes spike ceiling (pace / weak perimeter / usage tail).
 */
function threesContextBonus(rep) {
  if (!rep || typeof rep !== "object") return 0
  let b = 0
  const pace = toNum(rep.eventPace ?? rep.pace ?? rep.projectedPace ?? rep.gamePace ?? rep.opponentPace)
  if (Number.isFinite(pace) && pace >= 100) b += 1.5

  const oppDef = toNum(
    rep.opponentDefenseVsPosition ??
      rep.oppDefenseVsPosition ??
      rep.defenseVsPosition ??
      rep.opponentDvP
  )
  const matchupAdj = toNum(rep.matchupAdj) ?? 0
  const weakPerimeter =
    matchupAdj >= 0.022 || (Number.isFinite(oppDef) && oppDef >= 0.65 && oppDef <= 5)
  if (weakPerimeter) b += 1.5

  const u = readUsage(rep) ?? 20
  if (u >= 31) b += 3
  else if (u >= 28) b += 2.5
  else if (u >= 25.5) b += 2

  return b
}

/** Additive ceiling spike for counting stats (no % of projection). */
function additiveCeilingSpikeNonThrees(family, projection, vol, ctxS, rep) {
  const u = readUsage(rep) ?? 20
  const usageTail = u >= 31 ? 4 : u >= 28 ? 2.5 : u >= 25 ? 1.2 : 0
  if (family === "points") {
    return 4.5 + vol * 9 + ctxS * 6 + usageTail + clamp01((projection - 12) / 28) * 3
  }
  if (family === "rebounds") {
    return 1.8 + vol * 4.5 + ctxS * 3.5 + (readPosition(rep).includes("C") ? 1.2 : 0)
  }
  if (family === "assists") {
    return 1.8 + vol * 4.5 + ctxS * 3.5 + usageTail * 0.35
  }
  return 3 + vol * 5
}

/** Only block absurd tails — normal players are not squeezed to tight ladders. */
function extremeClampOnly(family, floor, median, ceiling) {
  const caps = {
    points: { fmin: 0, cmax: 68 },
    threes: { fmin: 0, cmax: 9 },
    rebounds: { fmin: 0, cmax: 24 },
    assists: { fmin: 0, cmax: 20 },
  }
  const { fmin, cmax } = caps[family] || { fmin: 0, cmax: 99 }
  return {
    floor: Math.max(fmin, floor),
    mostLikely: median,
    ceiling: Math.min(cmax, ceiling),
  }
}

/**
 * Display-only: one decimal, floor ≥ 0. Does not rescale, clamp downward, or enforce min spread.
 */
function finalizeDisplaySpread(floor, median, ceiling) {
  const q = 10
  const fmt = (x) => Math.round(Number(x) * q) / q
  return {
    floor: Math.max(0, fmt(floor)),
    mostLikely: fmt(median),
    ceiling: fmt(ceiling),
  }
}

/** Min gap |projection − line| to emit a bet, by stat family. */
function edgeThreshold(family) {
  if (family === "points") return 2.5
  if (family === "pra") return 2.5
  if (family === "threes") return 0.45
  if (family === "rebounds") return 2
  if (family === "assists") return 1.5
  return 2
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pk(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

function eid(c) {
  return String(c?.eventId || "").trim()
}

function playerEventKey(row) {
  const p = pk(row)
  const e = eid(row)
  if (!p || !e) return ""
  return `${p}|${e}`
}

function readPosition(row) {
  return String(row?.position || row?.playerPosition || row?.depthPosition || "")
    .trim()
    .toUpperCase()
}

function readUsage(row) {
  return toNum(row?.usageRate ?? row?.playerUsage ?? row?.usage ?? row?.roleUsagePct)
}

function readMinutes(row) {
  return toNum(row?.projectedMinutes ?? row?.minutesProjection ?? row?.minutes ?? row?.expectedMinutes)
}

function readThreePA(row) {
  return toNum(row?.threePA ?? row?.threePointAttempts ?? row?.threesAttempted ?? row?.tpa)
}

/** 3P% as 0–1 (handles 36.5 vs 0.365). */
function readThreePct(row) {
  let p = toNum(
    row?.threePointPct ??
      row?.threePct ??
      row?.threePointPercentage ??
      row?.fg3Pct ??
      row?.threePtPct ??
      row?.threePointPercent
  )
  if (!Number.isFinite(p)) return null
  if (p > 1.5) p /= 100
  if (p < 0.14 || p > 0.52) return null
  return p
}

function playerDifferentiator(rep) {
  const s = `${pk(rep)}|${eid(rep)}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 1000) / 10000
}

function maxThreePAFromRows(rows) {
  let m = null
  for (const r of rows || []) {
    const t = readThreePA(r)
    if (!Number.isFinite(t)) continue
    m = m == null ? t : Math.max(m, t)
  }
  return m
}

function meanThreePctFromRows(rows) {
  const xs = []
  for (const r of rows || []) {
    const p = readThreePct(r)
    if (Number.isFinite(p)) xs.push(p)
  }
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** When 3PA missing: role + usage + stable per-player hash — not one global default. */
function inferredThreePA(archetype, usage, rep) {
  const d = playerDifferentiator(rep) * 1.9
  if (archetype === "shooter") {
    return Math.max(2.35, Math.min(9.2, 4.35 + (usage - 20) * 0.1 + d))
  }
  if (archetype === "big") {
    return Math.max(0.2, Math.min(3.15, 0.72 + (usage - 14) * 0.052 + d * 0.55))
  }
  return Math.max(1.05, Math.min(7.1, 2.92 + (usage - 18) * 0.078 + d * 1.05))
}

function inferredThreePct(archetype, usage, rep) {
  const d = playerDifferentiator(rep) * 0.55
  let base = archetype === "shooter" ? 0.362 : archetype === "big" ? 0.318 : 0.341
  base += (usage - 21) * 0.00085 + d * 0.01
  return Math.max(0.27, Math.min(0.44, base))
}

function isStarterish(row) {
  if (row?.starterFlag === true) return true
  const d = String(row?.depthRole || "").toLowerCase()
  return /starter|starting|start\b/i.test(d)
}

/** Shooter / wing / big — drives threes bands (not one global default). */
function roleArchetype(row) {
  const pos = readPosition(row)
  if (/\bC\b/.test(pos) || /^PF\b/.test(pos) || (/\bPF\b/.test(pos) && !/\bSF\b/.test(pos))) return "big"
  if (/\bPG\b|\bSG\b/.test(pos)) return "shooter"
  if (/\bSF\b/.test(pos) || /\bF\b/.test(pos) || /\bG\b/.test(pos)) return "wing"
  const tpa = readThreePA(row)
  if (Number.isFinite(tpa) && tpa >= 6.5) return "shooter"
  return "wing"
}

const THREE_POINT_ROLES = [
  "elite_shooter",
  "high_volume_shooter",
  "medium_shooter",
  "low_volume",
  "non_shooter",
]

/** Hard 3PA for ceiling spike from tier only (no blending with pack averages). */
function threePAHardFromRole(role, salt) {
  const t = clamp01(Number(salt) || 0)
  if (role === "elite_shooter") return 8 + t * 3
  if (role === "high_volume_shooter") return 6 + t * 2
  if (role === "medium_shooter") return 4 + t * 2
  if (role === "low_volume") return 2 + t * 2
  if (role === "big") return 1 + t * 2
  if (role === "non_shooter") return 0.4 + t * 1.0
  return 4 + t * 2
}

/** Max additive spike (makes) above projection — must stay under absolute ceiling cap. */
function maxThreesSpikeAdditiveByRole(role) {
  if (role === "elite_shooter" || role === "high_volume_shooter") return 6
  if (role === "medium_shooter") return 3.5
  if (role === "low_volume") return 2
  if (role === "non_shooter") return 1
  return 2
}

/**
 * Hard absolute threes ceiling by role + archetype. Anchored to NBA reality:
 * absolute max 9, elite/high ≤ 8, medium ≤ 6, low ≤ 4, non ≤ 3, big ≤ 2.5.
 * `tightenPass` lowers caps on auto-recheck when violations remain.
 */
function absoluteThreesCeilingCapByRole(role, archetype, tightenPass) {
  const t = Math.max(0, Math.min(7, Number(tightenPass) || 0))
  const adj = t * 0.18
  if (archetype === "big") return Math.max(1.4, 2.5 - adj)

  if (role === "elite_shooter" || role === "high_volume_shooter") return Math.max(6, 8 - adj * 0.6)
  if (role === "medium_shooter") return Math.max(3.5, 6 - adj * 0.55)
  if (role === "low_volume") return Math.max(2, 4 - adj * 0.45)
  if (role === "non_shooter") return Math.max(1, 3 - adj * 0.3)
  return Math.max(2.5, 4 - adj * 0.5)
}

function readThreeTendencyFromForm(rep) {
  const rf = rep?.recentForm && typeof rep.recentForm === "object" ? rep.recentForm : null
  if (!rf) return 0
  const l5 = toNum(rf.last5_avg)
  const l10 = toNum(rf.last10_avg)
  if (Number.isFinite(l5) && l5 > 1.15) return Math.min(5, l5 * 0.95)
  if (Number.isFinite(l10) && l10 > 0.75) return Math.min(3.5, l10 * 0.75)
  return 0
}

/**
 * Slate-relative volume score for ranking (3PA, usage, minutes, position, archetype, form).
 */
function threeVolumeScoreForRank(entry) {
  const { pack, usage, minutes, archetype, repTh } = entry
  const pos = readPosition(repTh || {})
  let s = (Number(pack?.threePA) || 0) * 4.1
  s += (Number(usage) - 17) * 0.58
  s += (Number(minutes) - 20) * 0.12
  s += (Number(pack?.threePct) || 0.33) * 19
  if (/\b(PG|SG)\b/.test(pos)) s += 6.2
  else if (/\b(SF|F)\b/.test(pos) || /\bG\b/.test(pos)) s += 2.4
  if (archetype === "big") s -= 11
  else if (archetype === "shooter") s += 3.1
  s += readThreeTendencyFromForm(repTh)
  const ln = weightedLineCore(entry.threesRows || [])
  if (Number.isFinite(ln) && ln > 0.9) s += Math.min(6, ln * 1.15)
  return s
}

/**
 * Collect one entry per player-event that has threes pool rows (same filters as main board build).
 */
function collectThreesSlateEntries(byPe) {
  const out = []
  for (const g of byPe.values()) {
    const threesRows = g.byFam?.threes
    if (!threesRows?.length) continue
    const allRows = Object.values(g.byFam).flat()
    const repGlobal = bestRepRow(allRows)
    const usage = readUsage(repGlobal) ?? 18
    const minutes = readMinutes(repGlobal) ?? 26
    const archetype = roleArchetype(repGlobal)
    const maxFw = allRows.reduce((m, r) => Math.max(m, toNum(r.finalWeight) ?? 0), 0)
    const ctx = { usage, minutes, archetype, rep: repGlobal, maxFinalWeight: maxFw }
    if (usage < 16 && !isStarterish(repGlobal) && maxFw < 0.42) continue

    const pack = projectThreesFromAttempts(threesRows, ctx)
    const repTh = bestRepRow(threesRows)
    const key = playerEventKey({ player: g.player, eventId: g.eventId })
    if (!key) continue
    const base = { key, g, pack, ctx, threesRows, usage, minutes, archetype, repTh, repGlobal }
    const score = threeVolumeScoreForRank(base)
    out.push({ ...base, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

/**
 * Rank-based role assignment so buckets spread (not everyone medium). `spreadPass` widens elite/high slices.
 */
function assignThreePointRolesRanked(entries, spreadPass) {
  const map = new Map()
  const sorted = [...entries].sort((a, b) => b.score - a.score)
  const n = sorted.length
  if (!n) return map
  if (n === 1) {
    map.set(sorted[0].key, sorted[0].archetype === "big" ? "non_shooter" : "elite_shooter")
    return map
  }
  if (n === 2) {
    map.set(sorted[0].key, sorted[0].archetype === "big" ? "low_volume" : "elite_shooter")
    map.set(sorted[1].key, "non_shooter")
    return map
  }

  const bump = Math.min(0.12, (Number(spreadPass) || 0) * 0.034)
  let wE = 0.13 + bump
  let wH = 0.23 + bump * 0.65
  let wM = Math.max(0.16, 0.31 - bump * 1.45)
  let wL = 0.19
  let wN = 1 - wE - wH - wM - wL
  if (wN < 0.08) {
    const d = 0.08 - wN
    wN = 0.08
    wM = Math.max(0.14, wM - d)
  }
  const c1 = wE
  const c2 = wE + wH
  const c3 = wE + wH + wM
  const c4 = wE + wH + wM + wL

  for (let i = 0; i < n; i++) {
    const frac = (i + 0.5) / n
    let role = "non_shooter"
    if (frac < c1) role = "elite_shooter"
    else if (frac < c2) role = "high_volume_shooter"
    else if (frac < c3) role = "medium_shooter"
    else if (frac < c4) role = "low_volume"
    map.set(sorted[i].key, role)
  }

  for (const e of sorted) {
    const r = map.get(e.key)
    if (e.archetype === "big") {
      if (r === "elite_shooter" || r === "high_volume_shooter") map.set(e.key, "non_shooter")
      else if (r === "medium_shooter") map.set(e.key, "low_volume")
    }
  }
  return map
}

/**
 * Public: resolved threes spike tier for a built player row (after slate map applied).
 */
function getThreePointRole(player) {
  return (
    player?._threePointRole ||
    player?._threesMeta?.threePointRole ||
    (player?._archetype === "big" ? "non_shooter" : "medium_shooter")
  )
}

function roleTierAudit(roleMap, rawPlayers) {
  const counts = new Map(THREE_POINT_ROLES.map((r) => [r, 0]))
  let n = 0
  for (const p of rawPlayers) {
    if (!p.stats?.threes) continue
    const r = roleMap.get(p._peKey) || p._threePointRole
    if (!r) continue
    n += 1
    counts.set(r, (counts.get(r) || 0) + 1)
  }
  if (!n) return { ok: true, maxShare: 0, counts: Object.fromEntries(counts) }
  let maxShare = 0
  for (const c of counts.values()) maxShare = Math.max(maxShare, c / n)
  const ok = maxShare <= 0.5 + 1e-6
  return { ok, maxShare, counts: Object.fromEntries(counts) }
}

/**
 * Multi-signal "is this player effectively a big?" detector.
 * Position alone is unreliable (often missing for unicorns), so combine
 * rebounds projection, threes pack volume, position, and projected makes shape.
 */
function isLikelyBigByStats(p) {
  if (!p) return false
  const arch = p._archetype || p._threesMeta?.archetype
  if (arch === "big") return true

  const pos = readPosition(p._threesMeta?.rep || p)
  if (/\bC\b/.test(pos)) return true
  if (/^PF\b/.test(pos) || (/\bPF\b/.test(pos) && !/\bSF\b/.test(pos))) return true

  const rebMl = Number(p.stats?.rebounds?.mostLikely)
  const thMl = Number(p.stats?.threes?.mostLikely)
  const packPa = Number(p._threesMeta?.threePA)

  if (Number.isFinite(rebMl) && rebMl >= 8.5) return true
  if (Number.isFinite(rebMl) && rebMl >= 7.5 && Number.isFinite(thMl) && thMl <= 2) return true
  if (Number.isFinite(rebMl) && rebMl >= 7 && Number.isFinite(packPa) && packPa <= 3.5) return true
  return false
}

const ABSOLUTE_THREES_CEILING_MAX = 9

/**
 * Deterministic 3PA inference: pts/ast + TODAY usageBaseline & usageAdjusted (from meta).
 * Bigs by rebounds; clamped [0.5, 14].
 */
function inferThreePAFromProfile(p) {
  const meta = p?._threesMeta
  const rep = meta?.rep || {}
  const usageBaseline = Number.isFinite(Number(meta?.usageBaseline))
    ? Number(meta.usageBaseline)
    : readUsage(rep) ?? 20
  const usageAdjusted = Number.isFinite(Number(meta?.adjustedUsage))
    ? Number(meta.adjustedUsage)
    : usageBaseline

  const pts = Number(p?.stats?.points?.mostLikely)
  const reb = Number(p?.stats?.rebounds?.mostLikely)
  const ast = Number(p?.stats?.assists?.mostLikely)
  const salt = clamp01(playerDifferentiator({ player: p?.player, eventId: p?.eventId }) * 7.7)

  if (Number.isFinite(reb) && reb >= 10) {
    const uBump = (usageAdjusted - 20) * 0.038
    return Math.max(0.5, Math.min(14, 0.5 + salt * 1.5 + uBump))
  }

  const ptsN = Number.isFinite(pts) ? pts : 0
  const astN = Number.isFinite(ast) ? ast : 0
  const usageMix = usageBaseline * 0.42 + usageAdjusted * 0.58
  const usageScore = ptsN + astN * 0.7 + usageMix * 0.88

  let raw
  if (usageScore >= 40) raw = 9 + salt * 1.2
  else if (usageScore >= 33) raw = 8 + salt * 2
  else if (usageScore >= 28) raw = 7 + salt * 2.5
  else if (usageScore >= 24) raw = 5.5 + salt * 2.2
  else if (usageScore >= 18) raw = 4 + salt * 2
  else if (usageScore >= 12) raw = 3 + salt * 2
  else raw = 2 + salt * 1.5

  return Math.max(0.5, Math.min(14, raw))
}

/**
 * Hybrid 3PA: blend row realThreePA with inference, then scale by usage ratio.
 * wReal is pushed down when usageAdjusted is high or real is low vs infer — row data
 * cannot dominate in high-usage games (wReal cap 0.35 @ usage≥28, 0.28 @ ≥30).
 */
function threePAEffectiveHybrid(p) {
  const meta = p?._threesMeta
  const rep = meta?.rep || {}
  const pts = Number(p?.stats?.points?.mostLikely)
  const realPa = Number(meta?.realThreePA)
  const usageBaseline = Number.isFinite(Number(meta?.usageBaseline))
    ? Number(meta.usageBaseline)
    : readUsage(rep) ?? 20
  const usageAdjusted = Number.isFinite(Number(meta?.adjustedUsage))
    ? Number(meta.adjustedUsage)
    : usageBaseline

  const realLooksBroken =
    Number.isFinite(realPa) && realPa < 1 && Number.isFinite(pts) && pts >= 20

  const inferred = inferThreePAFromProfile(p)

  let baseThreePA
  if (Number.isFinite(realPa) && realPa >= 0.5 && !realLooksBroken) {
    const usageTight = usageBaseline > 1e-6 ? usageAdjusted / usageBaseline : 1
    const inferGap = inferred - realPa

    let wReal =
      0.54 - Math.max(0, usageTight - 1) * 0.4 - Math.max(0, inferGap) * 0.08

    if (realPa < inferred && usageAdjusted >= 22) {
      wReal -= 0.1 + Math.min(0.14, inferGap * 0.05)
    }

    if (usageAdjusted >= 26 && realPa < Math.max(inferred, 4.5) * 0.85) {
      wReal -= 0.07 + Math.max(0, 4 - realPa) * 0.035
    }

    if (usageAdjusted >= 26) {
      const uOver = usageAdjusted - 26
      wReal = Math.min(wReal, 0.45 - uOver * 0.04)
    }
    if (usageAdjusted >= 28) {
      wReal = Math.min(wReal, 0.35)
    }
    if (usageAdjusted >= 30) {
      wReal = Math.min(wReal, 0.28)
    }

    if (realPa < 3 && usageAdjusted >= 26) {
      wReal = Math.min(wReal, 0.4)
    }

    const wMax =
      usageAdjusted >= 30 ? 0.28 : usageAdjusted >= 28 ? 0.35 : 0.72
    wReal = clampN(0.18, wMax, wReal)

    baseThreePA = realPa * wReal + inferred * (1 - wReal)
  } else {
    baseThreePA = inferred
  }

  const ratio = usageBaseline > 1e-6 ? usageAdjusted / usageBaseline : 1
  const scaled = baseThreePA * clampN(0.7, 1.5, ratio)
  return Math.max(0.5, Math.min(14, scaled))
}

/**
 * Role-driven 3P% — uses real meta.threePct when available and sane,
 * else returns a role default (deterministic via salt).
 */
function threePctFromRoleOrReal(role, salt, meta) {
  const realPct = Number(meta?.threePct)
  if (Number.isFinite(realPct) && realPct >= 0.27 && realPct <= 0.46) return realPct
  const t = clamp01(Number(salt) || 0)
  if (role === "elite_shooter" || role === "high_volume_shooter") return 0.37 + t * 0.05
  if (role === "medium_shooter") return 0.34 + t * 0.04
  if (role === "low_volume") return 0.30 + t * 0.05
  if (role === "big") return 0.28 + t * 0.05
  return 0.30 + t * 0.04
}

/**
 * Minutes factor — normalize around 30–36 minutes, clamp [0.8, 1.1].
 */
function threesMinutesFactor(meta) {
  let minutes = Number(meta?.minutes)
  if (!Number.isFinite(minutes) || minutes < 6) minutes = 30
  return Math.max(0.8, Math.min(1.1, minutes / 33))
}

/**
 * Round to nearest 0.5.
 */
function roundHalf(x) {
  return Math.round(x * 2) / 2
}

/**
 * Per-role MINIMUM floor for median — stabilization, not a clamp.
 * Bigs/non/low get small floors; shooters get realistic shooter floors.
 */
function threesMedianMinByRole(role) {
  if (role === "big") return 0.5
  if (role === "non_shooter") return 0.5
  if (role === "low_volume") return 1.0
  if (role === "medium_shooter") return 2.0
  if (role === "high_volume_shooter") return 2.5
  if (role === "elite_shooter") return 3.0
  return 0.5
}

/**
 * SINGLE SOURCE OF TRUTH for threes median:
 *   median = threePAEffectiveHybrid × threePct × minutesFactor
 * - threePAEffectiveHybrid = precomputed on meta (see applyDeterministicRolesAndRebuild)
 * - if absent: realThreePA from rows, else pack threePA — never threePAHardFromRole
 * - threePct       = real if available, else role default
 * - minutesFactor  = minutes/33 clamped [0.8, 1.1]
 * Round to nearest 0.5, then apply per-role MINIMUM floor.
 */
function directThreesMedian(role, salt, meta) {
  let tpa = Number(meta?.threePAEffectiveHybrid)
  if (!Number.isFinite(tpa)) {
    const r = Number(meta?.realThreePA)
    if (Number.isFinite(r)) tpa = r
  }
  if (!Number.isFinite(tpa)) {
    const p0 = Number(meta?.threePA)
    if (Number.isFinite(p0)) tpa = p0
  }
  if (!Number.isFinite(tpa)) return null
  const pct = threePctFromRoleOrReal(role, salt, meta)
  const mf = threesMinutesFactor(meta)
  const raw = tpa * pct * mf
  const rounded = roundHalf(raw)
  return Math.max(threesMedianMinByRole(role), rounded)
}

/**
 * Deterministic role classifier — uses hybrid 3PA so missing real data does not collapse
 * everyone to non_shooter. Big via rebounds ≥6, position, and tpa tiers (no reb≥8 shortcut).
 */
function deterministicThreePointRoleFromPlayer(p) {
  if (!p) return "non_shooter"
  const reb = Number(p.stats?.rebounds?.mostLikely)

  const tpa = threePAEffectiveHybrid(p)

  if (Number.isFinite(tpa)) {
    if (tpa >= 7) return "high_volume_shooter"
    if (tpa >= 4) return "medium_shooter"
    if (tpa >= 2) return "low_volume"
  }

  if (Number.isFinite(reb) && reb >= 6) return "big"
  const pos = readPosition(p._threesMeta?.rep || {})
  if (/\bC\b/.test(pos)) return "big"
  if (/\bPF\b/.test(pos) && !/\bSF\b/.test(pos)) return "big"

  return "non_shooter"
}

/** Final absolute ceiling cap by role + big sniff. Anchored to NBA reality, max 9. */
function strictFinalThreesCeilingCap(p) {
  const role = p._threePointRole || p._threesMeta?.threePointRole || "non_shooter"
  const big = isLikelyBigByStats(p)

  let cap
  if (big) cap = 2.5
  else if (role === "elite_shooter" || role === "high_volume_shooter") cap = 8
  else if (role === "medium_shooter") cap = 6
  else if (role === "low_volume") cap = 4
  else if (role === "non_shooter") cap = 3
  else cap = 4

  return Math.min(cap, ABSOLUTE_THREES_CEILING_MAX)
}

/**
 * Apply deterministic classification AFTER stats build. Replaces upstream rank-based role
 * with strict signal-derived role, then rebuilds threes ranges through buildRangesFromProjection
 * (which uses the same role caps). Final lock pass after this clamps any survivors.
 */
function applyDeterministicRolesAndRebuild(rawPlayers, byPe) {
  const updates = []
  const debug = []
  for (const p of rawPlayers) {
    const meta = p._threesMeta
    if (!meta) continue
    if (!p.stats) p.stats = {}
    const rawHybridPa = threePAEffectiveHybrid(p)
    meta.threePAEffectiveHybridRaw = Number.isFinite(rawHybridPa) ? rawHybridPa : null
    meta.threePAEffectiveHybrid = Number.isFinite(rawHybridPa) ? rawHybridPa : null
    if (Number.isFinite(rawHybridPa)) meta.threePA = rawHybridPa

    const newRole = deterministicThreePointRoleFromPlayer(p)
    const before = p._threePointRole || meta.threePointRole || null
    if (newRole !== before) updates.push({ player: p.player, before, after: newRole })
    p._threePointRole = newRole
    meta.threePointRole = newRole
    const salt = playerDifferentiator({ player: p.player, eventId: p.eventId })
    meta.threePAEffective = threePAHardFromRole(newRole, salt)

    const projectionToUse = directThreesMedian(newRole, salt, meta)
    meta.threesProjectionFromHybrid = projectionToUse
    meta.threesMedianSource = "direct_3pa_role_context_inputs"

    const effTpa = threePAHardFromRole(newRole, salt)
    const dynRep = meta.rep || p
    const spikeBoost = dynamicCeilingSpikeBoost(dynRep, "threes")
    meta.dynamicSpikeBoost = spikeBoost
    const key = p._peKey
    const thRows = (key && byPe.get(key)?.byFam?.threes) || []
    const r0 = bestRepRow(thRows) || meta.rep || { player: p.player, eventId: p.eventId }
    const rng = buildRangesFromProjection(projectionToUse, "threes", {
      rep: r0,
      archetype: meta.archetype,
      usage: Number.isFinite(meta.adjustedUsage) ? meta.adjustedUsage : readUsage(r0),
      minutes: Number.isFinite(meta.adjustedMinutes) ? meta.adjustedMinutes : meta.minutes,
      differentiator: salt,
      threePA: effTpa,
      threePAEffectiveHybrid: Number.isFinite(rawHybridPa) ? rawHybridPa : Number(meta.threePAEffectiveHybrid),
      threePointRole: newRole,
      ceilingCapTightenPass: 0,
      spikeAllowanceBoost: spikeBoost,
    })
    if (!rng) continue
    const bet = alignedBetForStat(thRows, "threes", rng.mostLikely)
    p.stats.threes = { ...rng, bet, betLabel: bet ? bet.label : null }

    debug.push({
      player: p.player,
      tpaRaw: Number.isFinite(rawHybridPa) ? Math.round(rawHybridPa * 10) / 10 : null,
      tpa: Number.isFinite(rawHybridPa) ? Math.round(rawHybridPa * 10) / 10 : null,
      usageMult: meta.usageMultiplier != null ? Math.round(meta.usageMultiplier * 1000) / 1000 : null,
      minutesMult: meta.minutesMultiplier != null ? Math.round(meta.minutesMultiplier * 1000) / 1000 : null,
      spikeBoost,
      role: newRole,
      projection: projectionToUse,
      ceiling: p.stats.threes.ceiling,
    })
  }
  for (const p of rawPlayers) stripMisalignedBets(p.stats)
  return { updates, debug }
}

/**
 * FINAL LOCK PASS — runs AFTER all rebuild/validate/corrective steps.
 * Mutates `stats.threes` floor/median/ceiling in place. Directly clamps without
 * calling buildRangesFromProjection (so spike math cannot re-inflate).
 */
function finalThreesCeilingLock(rawPlayers) {
  const violations = []
  for (const p of rawPlayers) {
    const th = p.stats?.threes
    if (!th) continue
    const cap = strictFinalThreesCeilingCap(p)
    const before = th.ceiling
    let cFloor = th.floor
    let cMl = th.mostLikely
    let cCeil = th.ceiling

    if (cCeil > cap + 1e-6) {
      violations.push({
        player: p.player,
        role: p._threePointRole || p._threesMeta?.threePointRole || null,
        archetype: p._archetype || p._threesMeta?.archetype || null,
        before,
        cap,
      })
      cCeil = Math.round(cap * 10) / 10
    }
    if (cMl > cCeil) cMl = Math.round(Math.max(0, cCeil - 0.3) * 10) / 10
    if (cFloor > cMl - 0.05) cFloor = Math.max(0, Math.round((cMl - 0.4) * 10) / 10)
    if (cFloor < 0) cFloor = 0
    if (cMl < cFloor) cMl = cFloor

    th.floor = cFloor
    th.mostLikely = cMl
    th.ceiling = cCeil
    if (th.bet && Number.isFinite(th.bet.line)) {
      const m = cMl
      const L = th.bet.line
      const thr = edgeThreshold("threes")
      if (th.bet.side === "over" && (m <= L || m - L < thr)) {
        th.bet = null
        th.betLabel = null
      } else if (th.bet.side === "under" && (m >= L || L - m < thr)) {
        th.bet = null
        th.betLabel = null
      }
    }
    p._threesLocked = true
  }
  return violations
}

/**
 * Hard assertion of the final caps after the lock. Must produce zero violations.
 * Returns reasons that survive (should be empty in healthy slates).
 */
function assertThreesCapsAfterLock(rawPlayers) {
  const reasons = []
  let exceedSix = 0
  for (const p of rawPlayers) {
    const th = p.stats?.threes
    if (!th) continue
    const role = p._threePointRole || p._threesMeta?.threePointRole || ""
    const big = isLikelyBigByStats(p)
    const c = th.ceiling
    if (c > ABSOLUTE_THREES_CEILING_MAX + 1e-6) reasons.push(`absolute_max_exceeded:${p.player}:${c}`)
    if (big && c > 3 + 1e-6) reasons.push(`big_ceiling_gt_3:${p.player}:${c}`)
    if (role === "non_shooter" && c > 3 + 1e-6) reasons.push(`non_ceiling_gt_3:${p.player}:${c}`)
    if (role === "low_volume" && c > 4 + 1e-6) reasons.push(`low_ceiling_gt_4:${p.player}:${c}`)
    if (role === "medium_shooter" && c > 6 + 1e-6) reasons.push(`medium_ceiling_gt_6:${p.player}:${c}`)
    if (role !== "elite_shooter" && role !== "high_volume_shooter" && c > 6 + 1e-6) {
      reasons.push(`non_elite_ceiling_gt_6:${role || "?"}:${p.player}:${c}`)
    }
    if (c > 6 + 1e-6) exceedSix += 1
  }
  if (exceedSix > 3) reasons.push(`too_many_ceilings_gt_6:${exceedSix}`)
  return reasons
}

/** Strict role vs ceiling rules — used for auto-tighten until clean. */
function threesRoleCeilingViolations(rawPlayers) {
  const reasons = []
  const bigCeils = []
  const eliteHighCeils = []
  for (const p of rawPlayers) {
    const th = p.stats?.threes
    const m = p._threesMeta
    if (!th || !m) continue
    const role = m.threePointRole || p._threePointRole || "medium_shooter"
    const c = th.ceiling
    const arch = m.archetype

    if (role === "non_shooter" && c > 3 + 1e-6) reasons.push(`non_shooter_ceiling_gt_3:${p.player}`)
    if (role === "low_volume" && c > 4 + 1e-6) reasons.push(`low_volume_ceiling_gt_4:${p.player}`)
    if (arch === "big" && c > 3 + 1e-6) reasons.push(`big_ceiling_gt_3:${p.player}`)
    if (role !== "elite_shooter" && role !== "high_volume_shooter" && c > 6 + 1e-6) {
      reasons.push(`non_elite_ceiling_gt_6:${role}:${p.player}`)
    }
    if (arch === "big") bigCeils.push(c)
    if ((role === "elite_shooter" || role === "high_volume_shooter") && arch !== "big") eliteHighCeils.push(c)
  }
  if (bigCeils.length && eliteHighCeils.length) {
    const maxBig = Math.max(...bigCeils)
    const minElite = Math.min(...eliteHighCeils)
    if (maxBig > 2.5 && minElite <= maxBig + 0.35) reasons.push("big_ceiling_tied_with_guards")
  }
  return reasons
}

function enforceThreesRoleCeilingCapsUntilClean(rawPlayers, byPe, threeRoleMap) {
  let capTighten = 0
  let viol = threesRoleCeilingViolations(rawPlayers)
  while (viol.length && capTighten < 7) {
    capTighten += 1
    for (const p of rawPlayers) {
      if (p._threesMeta) p._threesMeta.threesCeilingCapTightenPass = capTighten
    }
    reapplyThreesRangesFromRoleMap(rawPlayers, byPe, threeRoleMap, capTighten)
    validateAndDifferentiateThrees(rawPlayers, byPe)
    viol = threesRoleCeilingViolations(rawPlayers)
  }
  return { capTighten, viol, resolved: viol.length === 0 }
}

function reapplyThreesRangesFromRoleMap(rawPlayers, byPe, roleMap, ceilingCapTightenPass = 0) {
  for (const p of rawPlayers) {
    const th = p.stats?.threes
    const meta = p._threesMeta
    if (!th || !meta) continue
    const role = roleMap.get(p._peKey) || p._threePointRole || "medium_shooter"
    const salt = playerDifferentiator({ player: p.player, eventId: p.eventId })
    meta.threePointRole = role
    meta.threePAEffective = threePAHardFromRole(role, salt)
    meta.threesCeilingCapTightenPass = ceilingCapTightenPass
    p._threePointRole = role

    const key = p._peKey
    const thRows = (key && byPe.get(key)?.byFam?.threes) || []
    const r0 = bestRepRow(thRows) || { player: p.player, eventId: p.eventId }
    const rng = buildRangesFromProjection(th.mostLikely, "threes", {
      rep: r0,
      archetype: meta.archetype,
      usage: readUsage(r0),
      minutes: meta.minutes,
      differentiator: salt,
      threePA: meta.threePA,
      threePAEffectiveHybrid: (() => {
        const v = Number(meta.threePAEffectiveHybrid)
        if (Number.isFinite(v) && v > 0) return v
        return threePAEffectiveHybrid(p)
      })(),
      threePointRole: role,
      ceilingCapTightenPass,
    })
    if (!rng) continue
    const bet = alignedBetForStat(thRows, "threes", rng.mostLikely)
    p.stats.threes = { ...rng, bet, betLabel: bet ? bet.label : null }
  }
  for (const p of rawPlayers) stripMisalignedBets(p.stats)
}

function weightedLineCore(rows) {
  let sumW = 0
  let sumLW = 0
  for (const r of rows || []) {
    const ln = toNum(r.line)
    if (!Number.isFinite(ln)) continue
    const fw = toNum(r.finalWeight) ?? 0
    const pr = toNum(r.probability) ?? nbaRowModelProbability(r) ?? 0.5
    const w = Math.max(0.08, fw * 0.14 + pr)
    sumW += w
    sumLW += w * ln
  }
  if (sumW <= 0) return null
  return sumLW / sumW
}

function bestRepRow(rows) {
  return [...(rows || [])].sort((a, b) => (toNum(b.finalWeight) ?? 0) - (toNum(a.finalWeight) ?? 0))[0] || null
}

/**
 * Threes makes projection from attempts × efficiency × minutes (no role-only bands, no ladder blend).
 * threesProjection ≈ threePA_per_game × threeP_pct × (minutes / 32)
 */
function projectThreesFromAttempts(rows, ctx) {
  const rep = bestRepRow(rows)
  const minutes = Math.max(8, Math.min(44, ctx.minutes ?? readMinutes(rep) ?? 26))
  const usage = ctx.usage ?? readUsage(rep) ?? 20
  const archetype = ctx.archetype ?? roleArchetype(rep)

  let pa = maxThreePAFromRows(rows)
  if (!Number.isFinite(pa)) pa = inferredThreePA(archetype, usage, rep)

  let pct = meanThreePctFromRows(rows)
  if (!Number.isFinite(pct)) pct = inferredThreePct(archetype, usage, rep)

  const minutesFactor = minutes / 32
  let raw = pa * pct * minutesFactor

  if (pa < 1) raw = Math.min(raw, 1.0)
  else if (pa < 2) raw = Math.min(raw, 2.0)

  if (archetype === "big") raw = Math.min(raw, 2.5)
  if (minutes < 22) raw = Math.min(raw, 3.0)
  if (minutes < 18) raw = Math.min(raw, 1.8)

  if (pa >= 6 && archetype !== "big") {
    const alt = pa * pct * Math.max(minutesFactor, 0.92)
    raw = Math.max(raw, Math.min(alt, 5.4))
  }

  raw = Math.round(raw * 10) / 10
  return { projection: raw, threePA: pa, threePct: pct, minutes, archetype }
}

function rebuildThreesStatBlock(stats, threesRows, mostLikely, threesRangeCtx) {
  if (!stats.threes || !Number.isFinite(mostLikely)) return
  const rep = threesRangeCtx?.rep || bestRepRow(threesRows || [])
  const rangeCtx = {
    rep,
    archetype: threesRangeCtx?.archetype,
    usage: threesRangeCtx?.usage ?? readUsage(rep),
    minutes: threesRangeCtx?.minutes ?? readMinutes(rep),
    differentiator: threesRangeCtx?.differentiator ?? playerDifferentiator(rep || {}),
    threePA: threesRangeCtx?.threePA ?? readThreePA(rep),
    threePAEffectiveHybrid: threesRangeCtx?.threePAEffectiveHybrid,
    threePointRole: threesRangeCtx?.threePointRole,
    ceilingCapTightenPass: threesRangeCtx?.ceilingCapTightenPass ?? 0,
    spikeAllowanceBoost: threesRangeCtx?.spikeAllowanceBoost,
  }
  const rng = buildRangesFromProjection(mostLikely, "threes", rangeCtx)
  if (!rng) return
  const bet = alignedBetForStat(threesRows || [], "threes", rng.mostLikely)
  stats.threes = {
    ...rng,
    bet,
    betLabel: bet ? bet.label : null,
  }
}

function similarThreesVolume(a, b) {
  return Math.abs(a.threePA - b.threePA) < 0.45 && Math.abs(a.minutes - b.minutes) < 2.1
}

/**
 * Caps, collision nudges, rebuild threes ranges + aligned bets.
 */
function validateAndDifferentiateThrees(rawPlayers, byPe) {
  for (const p of rawPlayers) {
    const meta = p._threesMeta
    const tr = p.stats?.threes
    if (!meta || !tr) continue
    let ml = tr.mostLikely
    if (meta.archetype === "big" && ml > 3) ml = 2.4
    if (meta.minutes < 22 && ml > 3) ml = Math.min(ml, 2.8)
    if (meta.minutes < 18 && ml > 2.5) ml = Math.min(ml, 1.9)
    const key = p._peKey
    const thRows = (key && byPe.get(key)?.byFam?.threes) || []
    const r0 = bestRepRow(thRows) || { player: p.player, eventId: p.eventId }
    rebuildThreesStatBlock(p.stats, thRows, ml, {
      rep: r0,
      archetype: meta.archetype,
      usage: readUsage(r0),
      minutes: meta.minutes,
      differentiator: playerDifferentiator({ player: p.player, eventId: p.eventId }),
      threePA: meta.threePA,
      threePAEffectiveHybrid: (() => {
        const v = Number(meta.threePAEffectiveHybrid)
        if (Number.isFinite(v) && v > 0) return v
        return threePAEffectiveHybrid(p)
      })(),
      threePointRole: meta.threePointRole,
      ceilingCapTightenPass: meta.threesCeilingCapTightenPass ?? 0,
    })
  }

  const withTh = rawPlayers.filter((p) => p.stats?.threes && p._threesMeta)
  const byRounded = new Map()
  for (const p of withTh) {
    const ml = p.stats.threes.mostLikely
    const k = String(Math.round(ml * 10) / 10)
    if (!byRounded.has(k)) byRounded.set(k, [])
    byRounded.get(k).push(p)
  }
  for (const group of byRounded.values()) {
    if (group.length < 2) continue
    for (let i = 1; i < group.length; i++) {
      const p0 = group[0]
      const p = group[i]
      if (similarThreesVolume(p0._threesMeta, p._threesMeta)) continue
      const nudge =
        0.06 + (Math.floor(playerDifferentiator({ player: p.player, eventId: p.eventId }) * 10000) % 7) * 0.05
      const ml = Math.round((p.stats.threes.mostLikely + nudge) * 10) / 10
      const thRows = (p._peKey && byPe.get(p._peKey)?.byFam?.threes) || []
      const r1 = bestRepRow(thRows) || { player: p.player, eventId: p.eventId }
      const tm = p._threesMeta
      rebuildThreesStatBlock(p.stats, thRows, ml, {
        rep: r1,
        archetype: tm?.archetype ?? p._archetype,
        usage: readUsage(r1),
        minutes: tm?.minutes,
        differentiator: playerDifferentiator({ player: p.player, eventId: p.eventId }),
        threePA: tm?.threePA,
        threePAEffectiveHybrid: (() => {
          const v = Number(tm?.threePAEffectiveHybrid)
          if (Number.isFinite(v) && v > 0) return v
          return threePAEffectiveHybrid(p)
        })(),
        threePointRole: tm?.threePointRole,
        ceilingCapTightenPass: tm?.threesCeilingCapTightenPass ?? 0,
      })
    }
  }

  for (const p of rawPlayers) {
    stripMisalignedBets(p.stats)
  }
}

function refreshPlayerHeaders(p) {
  const arch = p._archetype || "wing"
  const stats = p.stats
  const ranked = [...STAT_ORDER]
    .filter((f) => stats[f])
    .sort(
      (a, b) =>
        impactScore(b, stats[b].mostLikely, arch) - impactScore(a, stats[a].mostLikely, arch)
    )
  p.statPriority = ranked.map((f) => labelStat(f))
  p.primaryStat = ranked[0] || "points"
  p.bestBet = stats[p.primaryStat]?.betLabel || null
  const secF = ranked[1]
  p.secondaryBet = secF && stats[secF]?.betLabel ? stats[secF].betLabel : null
}

function toPublicStats(stats) {
  return Object.fromEntries(
    Object.entries(stats).map(([f, b]) => [
      f,
      {
        floor: b.floor,
        mostLikely: b.mostLikely,
        ceiling: b.ceiling,
        bestBet: b.betLabel,
      },
    ])
  )
}

/**
 * Single stat projection — unique per player via usage, minutes, role, form, market lines.
 */
function projectStat(family, rows, ctx) {
  if (!rows || !rows.length) return null
  const rep = bestRepRow(rows)
  const usage = ctx.usage ?? readUsage(rep) ?? 20
  const minutes = ctx.minutes ?? readMinutes(rep) ?? 26
  const archetype = ctx.archetype ?? roleArchetype(rep)
  const form = predictedMedianOutcome(rep)
  const market = weightedLineCore(rows)

  let raw = null
  if (Number.isFinite(form)) raw = form
  else if (Number.isFinite(market)) raw = market

  if (family === "points") {
    if (!Number.isFinite(raw)) raw = 11 + usage * 0.55 + (minutes / 36) * 8
    raw += (usage - 22) * 0.35 + (minutes - 28) * 0.12
    raw = Math.max(5, Math.min(46, raw))
    return Math.round(raw * 10) / 10
  }

  if (family === "rebounds") {
    if (!Number.isFinite(raw)) raw = 3.5 + (archetype === "big" ? 4.2 : archetype === "wing" ? 2.2 : 1.1)
    raw += (usage - 18) * 0.06 + (minutes / 36) * (archetype === "big" ? 5.5 : 2.8)
    if (archetype === "big" && Number.isFinite(market)) raw = 0.5 * raw + 0.5 * market
    raw = Math.max(0.5, Math.min(17, raw))
    return Math.round(raw * 10) / 10
  }

  if (family === "assists") {
    if (!Number.isFinite(raw)) raw = 2.2 + (archetype === "shooter" ? 2.8 : 1.2)
    raw += (usage - 18) * 0.085 + (minutes / 36) * 4.2
    if (archetype === "shooter" && Number.isFinite(market)) raw = 0.45 * raw + 0.55 * market
    raw = Math.max(0.5, Math.min(14, raw))
    return Math.round(raw * 10) / 10
  }

  return null
}

function buildRangesFromProjection(projection, family, rangeCtx) {
  if (!Number.isFinite(projection)) return null
  const rep = rangeCtx?.rep || {}
  const vol = volatilityScore(family, rep, rangeCtx || {})
  const ctxS = contextScoreForStat(rep, family)
  const floorMult = Math.max(0.75, Math.min(0.85, 0.85 - vol * 0.1))
  let floor = projection * floorMult

  let ceiling
  if (family === "threes") {
    const role = rangeCtx?.threePointRole || "medium_shooter"
    const arch = rangeCtx?.archetype ?? roleArchetype(rep)
    const tighten = rangeCtx?.ceilingCapTightenPass ?? 0
    const salt = clamp01((rangeCtx?.differentiator ?? playerDifferentiator(rep || {})) * 8.7)
    let pa = Number(rangeCtx?.threePAEffectiveHybrid)
    if (!Number.isFinite(pa) || pa <= 0) pa = Number(rangeCtx?.threePA)
    if (!Number.isFinite(pa) || pa <= 0) pa = 0
    const sf = threesSpikeFactor(pa, salt)
    const cb = threesContextBonus(rep)
    let spikeAllowance = pa * sf + cb + (Number(rangeCtx?.spikeAllowanceBoost) || 0)
    const capAdd = maxThreesSpikeAdditiveByRole(role)
    spikeAllowance = Math.min(spikeAllowance, capAdd)
    const ceilingRaw = projection + spikeAllowance
    const absCap = absoluteThreesCeilingCapByRole(role, arch, tighten)
    ceiling = Math.min(ceilingRaw, absCap)
  } else {
    ceiling = projection + additiveCeilingSpikeNonThrees(family, projection, vol, ctxS, rep)
  }

  const soft = extremeClampOnly(family, floor, projection, ceiling)
  floor = soft.floor
  ceiling = soft.ceiling

  const disp = finalizeDisplaySpread(floor, projection, ceiling)
  return {
    floor: disp.floor,
    mostLikely: disp.mostLikely,
    ceiling: disp.ceiling,
  }
}

/**
 * Aligned bet: Over only if median > line + edge; Under only if median < line − edge; else null.
 * Picks tightest qualifying line (closest to median in favorable direction).
 */
function alignedBetForStat(rows, family, median) {
  if (!Number.isFinite(median) || !rows || !rows.length) return null
  const thr = edgeThreshold(family)
  const eps = family === "threes" ? 0.08 : 0.25

  const overs = []
  const unders = []
  for (const r of rows) {
    const ln = toNum(r.line)
    if (!Number.isFinite(ln)) continue
    const side = String(r.side || "").toLowerCase()
    const isOver = side.includes("over") || side === "yes" || side === ""
    const isUnder = side.includes("under") || side === "no"
    if (isOver && !side.includes("under")) {
      if (median > ln + eps && median - ln >= thr) overs.push(ln)
    }
    if (isUnder) {
      if (median < ln - eps && ln - median >= thr) unders.push(ln)
    }
  }

  if (overs.length) {
    const L = Math.max(...overs)
    return { label: `${labelStat(family)} Over ${L}`, side: "over", line: L }
  }
  if (unders.length) {
    const L = Math.min(...unders)
    return { label: `${labelStat(family)} Under ${L}`, side: "under", line: L }
  }
  return null
}

function labelStat(f) {
  if (f === "points") return "Points"
  if (f === "threes") return "Threes"
  if (f === "rebounds") return "Rebounds"
  if (f === "assists") return "Assists"
  return f
}

/** Impact for stat priority (role-aware). */
function impactScore(family, mostLikely, archetype) {
  let w = 1
  if (family === "points") w = 1.15
  if (family === "threes" && archetype === "shooter") w = 1.25
  if (family === "rebounds" && archetype === "big") w = 1.35
  if (family === "assists" && archetype === "shooter") w = 1.2
  if (family === "rebounds" && archetype === "shooter") w = 0.75
  if (family === "assists" && archetype === "big") w = 0.85
  return (Number(mostLikely) || 0) * w
}

function playerRosterScore(ctx) {
  const u = ctx.usage ?? 0
  const m = Math.min(40, ctx.minutes ?? 26)
  const st = isStarterish(ctx.rep) ? 1.25 : 1
  const fw = ctx.maxFinalWeight ?? 0
  return u * Math.sqrt(m) * st + fw * 0.08
}

function specialsFromProjections(pts, reb, ast) {
  const out = { doubleDouble: false, tripleDouble: false, notes: [] }
  let hi = 0
  if (Number.isFinite(pts) && pts >= 18) hi += 1
  if (Number.isFinite(reb) && reb >= 8) hi += 1
  if (Number.isFinite(ast) && ast >= 7) hi += 1
  if (hi >= 2) {
    out.doubleDouble = true
    out.notes.push("Double-double profile: two core counting stats projected elevated vs typical thresholds.")
  }
  if (Number.isFinite(pts) && pts >= 20 && Number.isFinite(reb) && reb >= 9 && Number.isFinite(ast) && ast >= 8) {
    out.tripleDouble = true
    out.notes.push("Triple-double tail: points + rebounds + assists all in elevated bands (rare).")
  }
  return out
}

function inferFirstBasketLikely(row) {
  const u = readUsage(row)
  if (!Number.isFinite(u) || u < 21) return false
  const pos = readPosition(row)
  const starter = isStarterish(row)
  const guardBig = /\b(PG|SG|G|SF|PF|F)\b/.test(pos) || pos.length <= 3
  return starter || (u >= 26 && guardBig)
}

function formatPlayerSection(pred) {
  const lines = []
  lines.push(`${pred.player} (${pred.matchup || pred.eventId || ""})`.trim())
  if (pred.primaryStat) lines.push(`Primary stat: ${labelStat(pred.primaryStat)}`)
  if (pred.statPriority?.length) lines.push(`Stat priority: ${pred.statPriority.join(" > ")}`)
  for (const f of STAT_ORDER) {
    const b = pred.stats[f]
    if (!b) continue
    lines.push(
      `${labelStat(f)}: ${b.floor} / ${b.mostLikely} / ${b.ceiling} → MOST LIKELY: ${b.mostLikely}`
    )
  }
  if (pred.bestBet) lines.push(`Best bet: ${pred.bestBet}`)
  if (pred.secondaryBet) lines.push(`Secondary: ${pred.secondaryBet}`)
  if (pred.specials?.doubleDouble) lines.push("Special: Double-double risk/reward elevated.")
  if (pred.specials?.tripleDouble) lines.push("Special: Triple-double tail scenario flagged.")
  if (pred.specials?.firstBasket) lines.push("Special: First-basket plausible (usage / role).")
  lines.push("")
  return lines.join("\n")
}

function outcomeBandQualityMeta(rawPlayers) {
  let thTotal = 0
  const ceilHist = new Map()
  let uniformLowLadder = 0
  let stuckMidCeil = 0

  const slateHasSpikeCandidates = rawPlayers.some((p) => {
    const m = p._threesMeta
    const th = p.stats?.threes
    if (!m || !th || m.archetype === "big") return false
    const role = m.threePointRole || ""
    if (role === "elite_shooter" || role === "high_volume_shooter") return true
    const paE = m.threePAEffective ?? m.threePA
    return (paE >= 5.25 || th.mostLikely >= 1.7) && m.archetype === "shooter"
  })

  for (const p of rawPlayers) {
    const th = p.stats?.threes
    if (!th) continue
    thTotal += 1
    const cKey = String(th.ceiling)
    ceilHist.set(cKey, (ceilHist.get(cKey) || 0) + 1)
    if (th.ceiling <= 2.8 && th.mostLikely <= 1.35 && th.ceiling - th.mostLikely < 1.2) uniformLowLadder += 1
    if (th.ceiling >= 3 && th.ceiling <= 4) stuckMidCeil += 1
  }

  const maxSameCeil = thTotal ? Math.max(...ceilHist.values()) : 0
  const dupRatio = thTotal ? maxSameCeil / thTotal : 0
  const anyCeilGte6 = rawPlayers.some((p) => (p.stats?.threes?.ceiling ?? 0) >= 6)
  const uniformRatio = thTotal ? uniformLowLadder / thTotal : 0
  const stuck34Ratio = thTotal ? stuckMidCeil / thTotal : 0

  let manyLowCeil = 0
  for (const p of rawPlayers) {
    const th = p.stats?.threes
    if (!th) continue
    if (th.ceiling <= 3.1 && th.mostLikely >= 0.9) manyLowCeil += 1
  }
  const lowCeilRatio = thTotal ? manyLowCeil / thTotal : 0

  const shooterHighVolLowCeil = rawPlayers.some((p) => {
    const m = p._threesMeta
    const th = p.stats?.threes
    if (!m || !th) return false
    const role = m.threePointRole || ""
    if (role === "elite_shooter" || role === "high_volume_shooter") return th.ceiling < 5.5
    if (m.archetype === "shooter" && (m.threePAEffective ?? 0) >= 6.5) return th.ceiling < 5
    return false
  })

  const failReasons = []
  if (thTotal >= 3 && !anyCeilGte6) failReasons.push("no_threes_ceiling_ge_6")
  if (thTotal >= 6 && stuck34Ratio > 0.48) failReasons.push("many_stuck_3_to_4_ceiling")
  if (thTotal >= 5 && dupRatio > 0.42) failReasons.push("duplicate_threes_ceilings")
  if (thTotal >= 5 && uniformRatio > 0.45) failReasons.push("uniform_low_threes_ladder")
  if (thTotal >= 7 && lowCeilRatio > 0.55) failReasons.push("most_ceilings_compressed_2_3")
  if (slateHasSpikeCandidates && shooterHighVolLowCeil) failReasons.push("high_volume_shooter_ceiling_lt_5")

  const ok = failReasons.length === 0 || thTotal === 0
  return {
    ok,
    failReasons,
    thTotal,
    dupRatio,
    anyCeilGte6,
    slateHasSpikeCandidates,
    stuck34Ratio,
    uniformRatio,
    lowCeilRatio,
  }
}

/** Second pass if quality checks fail — additive bump only for elite/high (still obeys absolute caps). */
function correctiveExpandThreesBands(rawPlayers, byPe) {
  for (const p of rawPlayers) {
    const th = p.stats?.threes
    const meta = p._threesMeta
    if (!th || !meta) continue
    if (meta.archetype === "big") continue
    const role = meta.threePointRole || ""
    if (role !== "elite_shooter" && role !== "high_volume_shooter") continue
    if (th.ceiling >= 6) continue
    if ((meta.threePAEffective ?? meta.threePA) < 4.75 && th.mostLikely < 1.6) continue
    const key = p._peKey
    const thRows = (key && byPe.get(key)?.byFam?.threes) || []
    const r0 = bestRepRow(thRows) || { player: p.player, eventId: p.eventId }
    const rng = buildRangesFromProjection(th.mostLikely, "threes", {
      rep: r0,
      archetype: meta.archetype,
      usage: readUsage(r0),
      minutes: meta.minutes,
      differentiator: playerDifferentiator({ player: p.player, eventId: p.eventId }),
      threePA: meta.threePA,
      threePAEffectiveHybrid: (() => {
        const v = Number(meta.threePAEffectiveHybrid)
        if (Number.isFinite(v) && v > 0) return v
        return threePAEffectiveHybrid(p)
      })(),
      threePointRole: meta.threePointRole,
      ceilingCapTightenPass: meta.threesCeilingCapTightenPass ?? 0,
      spikeAllowanceBoost: 1.6,
    })
    if (!rng) continue
    const bet = alignedBetForStat(thRows, "threes", rng.mostLikely)
    p.stats.threes = { ...rng, bet, betLabel: bet ? bet.label : null }
  }
  for (const p of rawPlayers) stripMisalignedBets(p.stats)
}

/**
 * Global audit: every emitted bet must align with the locked median (post-final-lock).
 * Over → median > line + edge; Under → median < line − edge. Anything else is a misalignment.
 */
function auditBetAlignmentAcrossStats(rawPlayers) {
  const misalignments = []
  let total = 0
  for (const p of rawPlayers) {
    if (!p?.stats) continue
    for (const f of STAT_ORDER) {
      const b = p.stats[f]
      if (!b || !b.bet) continue
      total += 1
      const m = Number(b.mostLikely)
      const L = Number(b.bet.line)
      if (!Number.isFinite(m) || !Number.isFinite(L)) {
        misalignments.push({ player: p.player, stat: f, reason: "non_finite_line_or_median" })
        continue
      }
      const thr = edgeThreshold(f)
      if (b.bet.side === "over" && (m <= L || m - L < thr)) {
        misalignments.push({ player: p.player, stat: f, side: "over", line: L, median: m })
      } else if (b.bet.side === "under" && (m >= L || L - m < thr)) {
        misalignments.push({ player: p.player, stat: f, side: "under", line: L, median: m })
      }
    }
  }
  return { total, misalignments }
}

/** Distribution audit on the deterministic role labels (post-rebuild). */
function computeRoleDistribution(rawPlayers) {
  const counts = new Map(THREE_POINT_ROLES.map((r) => [r, 0]))
  let n = 0
  for (const p of rawPlayers) {
    if (!p.stats?.threes) continue
    const r = p._threePointRole || p._threesMeta?.threePointRole || "non_shooter"
    n += 1
    counts.set(r, (counts.get(r) || 0) + 1)
  }
  if (!n) return { ok: true, maxShare: 0, counts: Object.fromEntries(counts) }
  let maxShare = 0
  for (const c of counts.values()) maxShare = Math.max(maxShare, c / n)
  return { ok: maxShare <= 0.7 + 1e-6, maxShare, counts: Object.fromEntries(counts) }
}

/** Drop bets that contradict stored median (sanity). */
function stripMisalignedBets(stats) {
  for (const f of STAT_ORDER) {
    const b = stats[f]
    if (!b || !b.bet || !Number.isFinite(b.mostLikely) || !Number.isFinite(b.bet.line)) continue
    const m = b.mostLikely
    const L = b.bet.line
    const thr = edgeThreshold(f)
    if (b.bet.side === "over" && (m <= L || m - L < thr)) b.bet = null
    if (b.bet.side === "under" && (m >= L || L - m < thr)) b.bet = null
    b.betLabel = b.bet ? b.bet.label : null
  }
}

/**
 * @param {object} opportunityBoard
 */
function buildNbaPlayerOutcomePredictions(opportunityBoard) {
  const generatedAt = new Date().toISOString()
  let outcomeBandQuality = { ok: true, failReasons: [], thTotal: 0, dupRatio: 0 }
  const pool = collectFullPool(opportunityBoard)
  const byPe = new Map()
  for (const row of pool) {
    if (!row || typeof row !== "object") continue
    const fam = statFamilyKey(row)
    if (!STAT_ORDER.includes(fam)) continue
    const k = playerEventKey(row)
    if (!k) continue
    if (!byPe.has(k)) byPe.set(k, { player: row.player, eventId: row.eventId, matchup: row.matchup, byFam: {} })
    const g = byPe.get(k)
    if (!g.byFam[fam]) g.byFam[fam] = []
    g.byFam[fam].push(row)
  }

  const threesSlateEntries = collectThreesSlateEntries(byPe)
  let threeRoleMap = assignThreePointRolesRanked(threesSlateEntries, 0)

  const rawPlayers = []
  for (const g of byPe.values()) {
    const allRows = Object.values(g.byFam).flat()
    const repGlobal = bestRepRow(allRows)
    const usageBaseline = readUsage(repGlobal) ?? 18
    const minutesBaseline = readMinutes(repGlobal) ?? 26
    const archetype = roleArchetype(repGlobal)
    const maxFw = allRows.reduce((m, r) => Math.max(m, toNum(r.finalWeight) ?? 0), 0)
    if (usageBaseline < 16 && !isStarterish(repGlobal) && maxFw < 0.42) continue

    const usageMult = dynamicUsageInputMultiplier(repGlobal)
    const minutesMult = dynamicMinutesInputMultiplier(repGlobal)
    const usage = clampN(8, 42, usageBaseline * usageMult)
    const minutes = clampN(6, 44, minutesBaseline * minutesMult)
    const ctx = { usage, minutes, archetype, rep: repGlobal, maxFinalWeight: maxFw }

    const stats = {}
    let threesMeta = null
    for (const f of STAT_ORDER) {
      const rows = g.byFam[f] || []
      if (!rows.length) continue
      let proj = null
      if (f === "threes") {
        const pack = projectThreesFromAttempts(rows, ctx)
        proj = pack.projection
        const repTh = bestRepRow(rows)
        const peKey = playerEventKey({ player: g.player, eventId: g.eventId })
        const saltR = playerDifferentiator({ player: g.player, eventId: g.eventId })
        const realPa = maxThreePAFromRows(rows)
        const threePointRole =
          (peKey && threeRoleMap.get(peKey)) || (archetype === "big" ? "non_shooter" : "non_shooter")
        threesMeta = {
          threePA: pack.threePA,
          realThreePA: Number.isFinite(realPa) ? realPa : null,
          rep: repTh,
          threePointRole,
          threePAEffective: threePAHardFromRole(threePointRole, saltR),
          threePct: pack.threePct,
          minutes: pack.minutes,
          archetype: pack.archetype,
          threesCeilingCapTightenPass: 0,
          usageBaseline,
          adjustedUsage: usage,
          adjustedMinutes: minutes,
          usageMultiplier: usageMult,
          minutesMultiplier: minutesMult,
        }
      } else {
        proj = projectStat(f, rows, ctx)
      }
      if (!Number.isFinite(proj)) continue
      const repF = bestRepRow(rows)
      const spikeBoostF = dynamicCeilingSpikeBoost(repF || repGlobal, f)
      const rangeCtx = {
        rep: repF,
        archetype,
        usage,
        minutes,
        differentiator: playerDifferentiator({ player: g.player, eventId: g.eventId }),
        spikeAllowanceBoost: spikeBoostF,
      }
      if (f === "threes" && threesMeta && Number.isFinite(threesMeta.threePA)) {
        rangeCtx.threePA = threesMeta.threePA
        rangeCtx.threePointRole = threesMeta.threePointRole
        rangeCtx.ceilingCapTightenPass = threesMeta.threesCeilingCapTightenPass ?? 0
        const hy = threePAEffectiveHybrid({
          player: g.player,
          eventId: g.eventId,
          stats,
          _threesMeta: threesMeta,
        })
        rangeCtx.threePAEffectiveHybrid = Number.isFinite(hy) ? hy : null
      }
      const rng = buildRangesFromProjection(proj, f, rangeCtx)
      if (!rng) continue
      const bet = alignedBetForStat(rows, f, rng.mostLikely)
      stats[f] = {
        ...rng,
        bet,
        betLabel: bet ? bet.label : null,
      }
    }
    if (!Object.keys(stats).length) continue

    stripMisalignedBets(stats)

    const ranked = [...STAT_ORDER]
      .filter((f) => stats[f])
      .sort(
        (a, b) =>
          impactScore(b, stats[b].mostLikely, archetype) - impactScore(a, stats[a].mostLikely, archetype)
      )
    const statPriority = ranked.map((f) => labelStat(f))
    const primaryStat = ranked[0] || "points"

    const bestBet = stats[primaryStat]?.betLabel || null
    const secF = ranked[1]
    const secondaryBet = secF && stats[secF]?.betLabel ? stats[secF].betLabel : null

    const pts = stats.points?.mostLikely
    const reb = stats.rebounds?.mostLikely
    const ast = stats.assists?.mostLikely
    const sp = specialsFromProjections(pts, reb, ast)
    const firstBasket = inferFirstBasketLikely(repGlobal)
    if (firstBasket) sp.notes.push("First basket: elevated usage and/or lead guard/wing profile.")

    rawPlayers.push({
      player: g.player,
      eventId: g.eventId,
      matchup: g.matchup,
      primaryStat,
      statPriority,
      stats,
      bestBet,
      secondaryBet,
      specials: {
        doubleDouble: sp.doubleDouble,
        tripleDouble: sp.tripleDouble,
        firstBasket,
        notes: sp.notes,
      },
      _roster: playerRosterScore(ctx),
      _peKey: playerEventKey({ player: g.player, eventId: g.eventId }),
      _threesMeta: threesMeta,
      _threePointRole: threesMeta?.threePointRole ?? null,
      _archetype: archetype,
    })
  }

  // SINGLE PIPELINE — every player goes through the EXACT same threes path:
  //   hybrid 3PA  →  deterministic role  →  effective 3PA  →  median rebuild
  //   →  spike  →  caps  →  final lock  →  RETURN
  // No post-rebuild validator may modify median/ceiling — the lock is the only
  // mutation allowed after deterministic rebuild.
  const detResult = applyDeterministicRolesAndRebuild(rawPlayers, byPe)
  let lockClamps = finalThreesCeilingLock(rawPlayers)
  let lockViolations = assertThreesCapsAfterLock(rawPlayers)
  if (lockViolations.length) {
    applyDeterministicRolesAndRebuild(rawPlayers, byPe)
    const extraClamps = finalThreesCeilingLock(rawPlayers)
    lockClamps = [...lockClamps, ...extraClamps]
    lockViolations = assertThreesCapsAfterLock(rawPlayers)
  }
  for (const p of rawPlayers) stripMisalignedBets(p.stats)

  outcomeBandQuality = outcomeBandQualityMeta(rawPlayers)
  outcomeBandQuality = {
    ...outcomeBandQuality,
    deterministicRoleUpdates: detResult.updates.length,
    threesDebug: detResult.debug,
    finalThreesLockClamps: lockClamps.length,
    finalThreesLockViolations: lockViolations,
  }
  if (lockViolations.length) {
    outcomeBandQuality = {
      ...outcomeBandQuality,
      ok: false,
      failReasons: [...(outcomeBandQuality.failReasons || []), "final_threes_cap_lock_residual"],
    }
  }

  const betAudit = auditBetAlignmentAcrossStats(rawPlayers)
  outcomeBandQuality = {
    ...outcomeBandQuality,
    betAudit: { total: betAudit.total, misalignmentCount: betAudit.misalignments.length },
    betMisalignments: betAudit.misalignments,
  }
  if (betAudit.misalignments.length) {
    outcomeBandQuality = {
      ...outcomeBandQuality,
      ok: false,
      failReasons: [...(outcomeBandQuality.failReasons || []), "bet_alignment_residual"],
    }
  }

  const roleDist = computeRoleDistribution(rawPlayers)
  outcomeBandQuality = {
    ...outcomeBandQuality,
    roleTierCounts: roleDist.counts,
    roleTierMaxShare: roleDist.maxShare,
    roleTierOk: roleDist.ok,
  }
  if (!roleDist.ok) {
    outcomeBandQuality = {
      ...outcomeBandQuality,
      ok: false,
      failReasons: [...(outcomeBandQuality.failReasons || []), "role_bucket_over_50pct"],
    }
  }

  for (const p of rawPlayers) {
    refreshPlayerHeaders(p)
  }

  const byEvent = new Map()
  for (const p of rawPlayers) {
    const ev = String(p.eventId || "").trim() || "_"
    if (!byEvent.has(ev)) byEvent.set(ev, [])
    byEvent.get(ev).push(p)
  }

  const TOP_N = 8
  const MIN_USAGE = 17.5
  const outPlayers = []
  for (const [, group] of byEvent) {
    group.sort((a, b) => b._roster - a._roster)
    let n = 0
    for (const p of group) {
      if (n >= TOP_N) break
      const key = playerEventKey({ player: p.player, eventId: p.eventId })
      const gEntry = byPe.get(key)
      const r0 = gEntry ? bestRepRow(Object.values(gEntry.byFam).flat()) : null
      const passUsage =
        (readUsage(r0) ?? 0) >= MIN_USAGE || isStarterish(r0) || p._roster >= 28
      if (!passUsage && n >= 6) continue
      n += 1
      const { _roster, _peKey, _threesMeta, _archetype, stats: st, ...rest } = p
      outPlayers.push({
        ...rest,
        stats: toPublicStats(st),
      })
    }
  }

  outPlayers.sort((a, b) => String(a.player || "").localeCompare(String(b.player || "")))

  const header = ["==== NBA OUTCOME PREDICTIONS ====", `Generated: ${generatedAt}`, ""].join("\n")
  const body = outPlayers.map(formatPlayerSection).join("\n")
  const formattedText = `${header}${body}================================\n`

  return {
    engine: "nba-player-outcome-predictions",
    generatedAt,
    players: outPlayers,
    formattedText,
    meta: {
      playerCount: outPlayers.length,
      poolRows: pool.length,
      topNPerGame: TOP_N,
      edgeThresholds: STAT_ORDER.reduce((o, f) => {
        o[f] = edgeThreshold(f)
        return o
      }, {}),
      outcomeBandQuality,
    },
  }
}

module.exports = {
  buildNbaPlayerOutcomePredictions,
  getThreePointRole,
}
