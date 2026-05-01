"use strict"

console.log("ACTIVE:", __filename)

const { nbaRowModelProbability, nbaRowEdge, nbaRowLadderLabel } = require("./nbaModelSignals")
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require("./nbaEventTeamResolve")
const { computeMatchupAdjustmentFromRow } = require("./nbaMatchupIntelligence")
const { computeStatSpecificAdjustmentFromContext } = require("./nbaStatIntelligence")
// recentForm is injected upstream during snapshot enrichment (real API-Sports logs)

let __formActiveN = 0
let __formDataLiveN = 0
let __matchupAppliedLogN = 0
let __statAdjustmentLogN = 0

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

function clamp01(v) {
  return clamp(0, 1, v)
}

function clampStr(v) {
  const s = String(v == null ? "" : v).trim()
  return s ? s : null
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp01Tight(v) {
  return clamp(0.001, 0.999, v)
}

function readUsageRate(row) {
  const u =
    toNum(row?.usageRate) ??
    toNum(row?.playerUsage) ??
    toNum(row?.usage) ??
    toNum(row?.roleUsagePct)
  return Number.isFinite(u) ? u : null
}

function readMinutes(row) {
  const m =
    toNum(row?.projectedMinutes) ??
    toNum(row?.minutesProjection) ??
    toNum(row?.minutes) ??
    toNum(row?.expectedMinutes)
  return Number.isFinite(m) ? m : null
}

function readContextScore(row) {
  const c = toNum(row?.gamePriorityScore) ?? toNum(row?.matchupEdgeScore) ?? toNum(row?.matchupScore) ?? 0
  return Number.isFinite(c) ? c : 0
}

function sigmoid(z) {
  const x = Number(z)
  if (!Number.isFinite(x)) return 0.5
  if (x > 20) return 1
  if (x < -20) return 0
  return 1 / (1 + Math.exp(-x))
}

function readStarterish(row) {
  const starterFlag = toNum(row?.starterFlag) ?? toNum(row?.isStarter) ?? toNum(row?.starter)
  if (starterFlag != null) return starterFlag >= 1 ? 1 : 0
  const role = toNum(row?.rotationRole) ?? toNum(row?.depthRole)
  if (role != null) return role >= 1 ? 1 : 0
  const txt = String(row?.lineupStatus || row?.status || row?.rotation || "").toLowerCase()
  if (txt.includes("starter") || txt.includes("starting")) return 1
  if (txt.includes("bench") || txt.includes("reserve")) return 0
  return null
}

function computeRealismScore({ usageRate, minutes, row, propType }) {
  // Rebuild realismScore as an "opportunity index" (minutes + usage + role + ceiling),
  // not a light multiplier. This is the primary driver of NBA ladder realism.
  const u = Number.isFinite(usageRate) ? usageRate : 20
  const m = Number.isFinite(minutes) ? minutes : 24
  const starterish = readStarterish(row)

  // Minutes is the primary driver. Use a steep curve so 34+ minute players separate strongly.
  // minutesN ~ 0 at 18m, ~0.5 at 26m, ~0.85 at 32m, ~0.95 at 36m.
  const minutesN = sigmoid((m - 26) / 3.2)

  // Usage is secondary but still meaningful. 25%+ usage should separate from 18–20% role players.
  // usageN ~ 0.2 at 18%, ~0.5 at 22%, ~0.8 at 26%, ~0.9 at 28%.
  const usageN = sigmoid((u - 22) / 2.6)

  // Starter/bench signal (when present) adds separation without hardcoding.
  const starterN = starterish == null ? 0.55 : starterish ? 1.0 : 0.25

  // Ceiling potential: interaction term so high-minutes + high-usage stars rise naturally.
  const ceilingN = clamp(0, 1, Math.pow(minutesN * usageN, 0.62))

  // Map to a stable score band used across all candidate types.
  // Baseline + weighted opportunity components.
  const realismScore =
    0.30 +
    (1.20 * minutesN) +
    (0.85 * usageN) +
    (0.55 * starterN) +
    (0.70 * ceilingN)

  return clamp(0.30, 2.40, realismScore)
}

function computeFinalWeight({
  realismScore,
  predictedProbability,
  edge,
  contextScore,
  line,
  minutes,
  usageRate,
  propType,
  threesBaseLine,
  recentForm,
  player,
  playerName,
  matchupRow = null,
}) {
  const ln = toNum(line)

  let e = Number.isFinite(edge) ? edge : 0
  // Clamp edge BEFORE it is used (ranking-only).
  e = clamp(-0.05, 0.12, e)
  if (Number.isFinite(ln) && ln <= 3.5) e *= 0.5

  let w =
    ((Number.isFinite(realismScore) ? realismScore : 0) * 0.70) +
    (clamp01Tight(predictedProbability) * 0.15) +
    (e * 0.10) +
    ((Number.isFinite(contextScore) ? contextScore : 0) * 0.05)

  // Apply suppression AFTER weighting.
  if (Number.isFinite(ln) && ln <= 2.5) w *= 0.35
  if (Number.isFinite(ln) && ln <= 1.5) w *= 0.15
  if (minutes != null && Number.isFinite(Number(minutes)) && Number(minutes) < 26) w *= 0.6
  if (usageRate != null && Number.isFinite(Number(usageRate)) && Number(usageRate) < 20) w *= 0.6

  // Optional boost for true stars (more opportunity than most props reflect).
  if (minutes != null && usageRate != null && Number(minutes) > 34 && Number(usageRate) > 25) {
    w *= 1.15
  }

  // Prop-type aware adjustment: Threes should respect shooting role.
  // Use base threes line (when available) as a proxy for 3PA volume; do not hardcode players.
  const pt = String(propType || "").toLowerCase()
  if (/three|threes|3pt/.test(pt)) {
    const base = toNum(threesBaseLine)
    if (Number.isFinite(base)) {
      // Non-shooters typically have base lines <= 1.5; volume shooters >= 3.0.
      const roleFactor =
        base <= 1.5 ? 0.78 :
        base <= 2.0 ? 0.88 :
        base <= 2.5 ? 0.96 :
        base <= 3.0 ? 1.02 :
        base <= 3.5 ? 1.06 :
        1.10
      w *= roleFactor
    } else {
      // If we can't infer base line, keep it very light: require both minutes+usage for top placement.
      const m = minutes != null ? Number(minutes) : 0
      const u = usageRate != null ? Number(usageRate) : 0
      if (m < 30 || u < 22) w *= 0.92
    }
  }

  // --- RECENT FORM ADJUSTMENT ---
  let formAdj = 0

  if (recentForm) {
    const trend = Number.isFinite(Number(recentForm.trend_delta)) ? Number(recentForm.trend_delta) : 0
    const hr5 = Number.isFinite(Number(recentForm.last5_hit_rate)) ? Number(recentForm.last5_hit_rate) : null

    if (trend > 0) formAdj += 0.02
    if (trend < 0) formAdj -= 0.02

    if (hr5 != null) {
      if (hr5 > 0.6) formAdj += 0.02
      if (hr5 < 0.4) formAdj -= 0.02
    }
  }

  formAdj = Math.max(-0.05, Math.min(0.05, formAdj))

  w = w * (1 + formAdj)

  if (formAdj !== 0 && (player || playerName) && __formActiveN < 25) {
    console.log("FORM ACTIVE:", player || playerName, formAdj)
    __formActiveN++
  }

  if (formAdj !== 0 && (player || playerName)) {
    console.log(
      "FORM APPLIED:",
      player || playerName,
      "adj:",
      formAdj,
      "final:",
      w
    )
  }

  // --- MATCHUP (defense vs role + pace + total) — small multiplier, applied after form ---
  let matchupAdj = 0
  if (matchupRow && typeof matchupRow === "object") {
    const m = computeMatchupAdjustmentFromRow(matchupRow)
    matchupAdj = clamp(-0.06, 0.06, m.adj)
    w = w * (1 + matchupAdj)

    const pname = player || playerName
    // Same visibility contract as FORM APPLIED: log whenever this path runs (capped), adj may be 0 if neutral context.
    if (pname && __matchupAppliedLogN < 80) {
      console.log(
        "MATCHUP APPLIED:",
        pname,
        m.opponent || "?",
        "adj:",
        Number(matchupAdj.toFixed(5)),
        "final:",
        w
      )
      __matchupAppliedLogN++
    }
  }

  // --- STAT-SPECIFIC (rebounds / assists / threes / PRA) — after form + matchup ---
  let statAdj = 0
  if (matchupRow && typeof matchupRow === "object") {
    statAdj = clamp(
      -0.07,
      0.07,
      computeStatSpecificAdjustmentFromContext({
        matchupRow,
        propType,
        usageRate,
        minutes,
        threesBaseLine,
        line: ln,
      })
    )
    w = w * (1 + statAdj)

    const pname = player || playerName
    if (pname && __statAdjustmentLogN < 120) {
      console.log("STAT ADJUSTMENT:", pname, String(propType || "?").trim() || "?", Number(statAdj.toFixed(5)))
      __statAdjustmentLogN++
    }
  }

  return { finalWeight: w, edge: e, matchupAdj, statAdj }
}

function ladderCandidateFromRow(row, ctx = null) {
  row = enrichNbaRowStatLayerInputs(applyTeamFallbackFromProjections(row))
  const player = clampStr(row?.player)
  if (!player) return null
  const probability = nbaRowModelProbability(row)
  if (!Number.isFinite(probability)) return null

  const line = toNum(row?.line)
  const rawEdge = nbaRowEdge(row)

  const usageRate = readUsageRate(row)
  const minutes = readMinutes(row)
  const contextScore = readContextScore(row)
  const realismScore = computeRealismScore({
    usageRate: usageRate == null ? 20 : usageRate,
    minutes: minutes == null ? 24 : minutes,
    row,
    propType: row?.propType,
  })

  // Threes role proxy: base threes line (from same event/player) when available.
  const ptLower = String(row?.propType || row?.marketKey || "").toLowerCase()
  let threesBaseLine = null
  if (/three|threes|3pt/.test(ptLower) && ctx && ctx.threesBaseLineByPlayerEvent) {
    const eid = clampStr(row?.eventId)
    const k = `${String(eid || "").trim()}__${String(player).toLowerCase()}`
    const v = ctx.threesBaseLineByPlayerEvent.get(k)
    threesBaseLine = Number.isFinite(Number(v)) ? Number(v) : null
  }
  if (/three|threes|3pt/.test(ptLower) && threesBaseLine == null && Number.isFinite(line)) {
    threesBaseLine = line
  }

  const parseHitRate = (v) => {
    const s = String(v || "").trim()
    const m = s.match(/^(\d+)\s*\/\s*(\d+)$/)
    if (!m) return null
    const a = Number(m[1])
    const b = Number(m[2])
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
    return a / b
  }

  const recentForm =
    row?.recentForm && typeof row.recentForm === "object"
      ? row.recentForm
      : (() => {
          const last5_avg = toNum(row?.recent5Avg)
          const last10_avg = toNum(row?.l10Avg)
          if (!Number.isFinite(last5_avg) || !Number.isFinite(last10_avg)) return null
          const last10_hit_rate = parseHitRate(row?.hitRate)
          return {
            last5_avg,
            last10_avg,
            last5_hit_rate: null,
            last10_hit_rate,
            trend_delta: last5_avg - last10_avg,
            source: "api-sports-rolled",
          }
        })()

  if (recentForm && __formDataLiveN < 400) {
    console.log("FORM DATA LIVE:", player, {
      source: recentForm.source,
      last5_avg: recentForm.last5_avg,
      last10_avg: recentForm.last10_avg,
      baseline: recentForm.baseline,
      trend_delta: recentForm.trend_delta,
      last5_hit_rate: recentForm.last5_hit_rate,
      last10_hit_rate: recentForm.last10_hit_rate,
      n5: recentForm.sampleSize5,
      n10: recentForm.sampleSize10,
    })
    __formDataLiveN++
  }

  const { finalWeight, edge, matchupAdj, statAdj } = computeFinalWeight({
    realismScore,
    predictedProbability: probability,
    edge: rawEdge,
    contextScore,
    line,
    minutes,
    usageRate,
    propType: row?.propType || row?.marketKey,
    threesBaseLine,
    recentForm,
    player,
    matchupRow: row,
  })

  const eventPace = toNum(row?.eventPace ?? row?.pace ?? row?.projectedPace)
  const gameTotal = toNum(row?.gameTotal ?? row?.eventTotal ?? row?.total)

  return {
    player,
    team: clampStr(row?.team),
    opponent: clampStr(row?.opponent ?? row?.opponentTeam),
    opponentTeam: clampStr(row?.opponent ?? row?.opponentTeam),
    homeTeam: clampStr(row?.homeTeam),
    awayTeam: clampStr(row?.awayTeam),
    eventId: clampStr(row?.eventId),
    propType: clampStr(row?.propType) || "Prop",
    ladder: nbaRowLadderLabel(row),
    line: line ?? null,
    side: clampStr(row?.side),
    book: clampStr(row?.book),
    marketKey: clampStr(row?.marketKey),
    probability,
    edge,
    usageRate,
    minutes,
    contextScore,
    realismScore,
    finalWeight,
    threesBaseLine,
    recentForm,
    matchupAdj: Number.isFinite(matchupAdj) ? matchupAdj : 0,
    statAdj: Number.isFinite(statAdj) ? statAdj : 0,
    eventPace: Number.isFinite(eventPace) ? eventPace : null,
    gameTotal: Number.isFinite(gameTotal) ? gameTotal : null,
    odds: Number.isFinite(Number(row?.odds)) ? Number(row.odds) : null,
  }
}

function dedupeCandidates(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (!r) continue
    const key = [
      r.player,
      r.eventId || "",
      r.propType || "",
      r.ladder || "",
      String(r.line ?? ""),
      String(r.odds ?? ""),
      r.book || "",
    ].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

function sortByProbDesc(a, b) {
  return (Number(b?.finalWeight) || 0) - (Number(a?.finalWeight) || 0)
}

module.exports = {
  ladderCandidateFromRow,
  computeFinalWeight,
  computeRealismScore,
  readContextScore,
  readMinutes,
  readUsageRate,
  dedupeCandidates,
  sortByProbDesc,
}
