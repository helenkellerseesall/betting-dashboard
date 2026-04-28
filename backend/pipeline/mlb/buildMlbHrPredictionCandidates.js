"use strict"

const gameWeather = require("../../data/mlbGameWeather.json")
const parkFactors = require("../../data/mlbParkFactors.json")
const normalizeName = require("../../utils/normalizeName")
const config = require("../../config/modelConfig")
const { computeRobustStats, computeProbabilityFromScore } = require("../utils/probabilityScaling")
let statcastPower = {}
try {
  statcastPower = require("../../data/mlbStatcastPower.json")
} catch (e) {
  console.log("[STATCAST LOAD FAIL]", e?.message || e)
}

console.log("[STATCAST FILE SAMPLE]", Object.keys(statcastPower || {}).slice(0, 5))
console.log("[TEST DIRECT]", statcastPower?.["shohei ohtani"])

console.log("[WEATHER DEBUG] weather keys:", Object.keys(gameWeather || {}).slice(0, 5))
console.log("[WEATHER KEYS]", Object.keys(gameWeather || {}).slice(0, 5))

const normalizedMap = {}
Object.entries(statcastPower || {}).forEach(([k, v]) => {
  normalizedMap[normalizeName(k)] = v
})

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function stableHash01(s) {
  const str = String(s ?? "")
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // map uint32 -> [0,1)
  return (h >>> 0) / 4294967296
}

function scoreSortValue(x) {
  const hs = toNum(x?.hybridScore)
  if (Number.isFinite(hs)) return hs
  const hr = toNum(x?.hrScore)
  return Number.isFinite(hr) ? hr : 0
}

function buildDiverseRankedList(candidates, topN) {
  const arr = Array.isArray(candidates) ? candidates : []
  const N = Number.isFinite(Number(topN)) ? Math.max(1, Number(topN)) : 30

  // Round-robin by game, pulling 1st-best-per-game, then 2nd-best-per-game, etc.
  // This enforces diversity beyond simple caps while still honoring hrScore ordering within each game.
  const byEvent = new Map()
  for (const p of arr) {
    const eid = norm(p?.eventId)
    if (!eid) continue
    const list = byEvent.get(eid) || []
    list.push(p)
    byEvent.set(eid, list)
  }

  const eventLists = [...byEvent.values()].map((list) => [...list].sort((a, b) => scoreSortValue(b) - scoreSortValue(a)))

  // Sort events by their top candidate score so we still prioritize the best games.
  eventLists.sort((a, b) => scoreSortValue(b?.[0]) - scoreSortValue(a?.[0]))

  const out = []
  const perTeam = new Map()
  const MAX_PER_TEAM = 3
  const MAX_PER_GAME = Number.isFinite(Number(config?.filters?.maxPerGame)) ? Number(config.filters.maxPerGame) : 2

  for (let depth = 0; out.length < N; depth++) {
    let progressed = false
    for (const list of eventLists) {
      if (out.length >= N) break
      const pick = list[depth]
      if (!pick) continue

      const eid = norm(pick?.eventId)
      const tm = norm(pick?.team)
      const teamCount = perTeam.get(tm) || 0
      const gameCount = out.filter((x) => norm(x?.eventId) === eid).length
      if (tm && teamCount >= MAX_PER_TEAM) continue
      if (eid && gameCount >= MAX_PER_GAME) continue
      if (out.find((x) => x.player === pick.player && x.eventId === pick.eventId)) continue

      out.push(pick)
      if (tm) perTeam.set(tm, teamCount + 1)
      progressed = true
    }
    if (!progressed) break
  }

  // Fill remaining slots (if strict diversity constraints block) with best remaining by score.
  if (out.length < Math.min(N, arr.length)) {
    for (const p of arr) {
      if (out.length >= N) break
      if (out.find((x) => x.player === p.player && x.eventId === p.eventId)) continue
      out.push(p)
    }
  }

  return out
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function normLc(v) {
  return norm(v).toLowerCase()
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function impliedProbabilityFromAmericanOdds(american) {
  const a = toNum(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 100 / (a + 100)
  return Math.abs(a) / (Math.abs(a) + 100)
}

function impliedProbability(odds) {
  if (!odds) return 0
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return 0
  if (o > 0) {
    return 100 / (o + 100)
  } else {
    return Math.abs(o) / (Math.abs(o) + 100)
  }
}

function getImpliedProbability(row) {
  const explicit = toNum(row?.impliedProbability)
  if (Number.isFinite(explicit) && explicit > 0 && explicit < 1) return explicit
  return impliedProbabilityFromAmericanOdds(row?.odds)
}

function getBattingOrderIndex(row) {
  const keys = ["battingOrderIndex", "lineupSpot", "lineupPosition", "battingOrder", "battingOrderSpot"]
  for (const k of keys) {
    const n = toNum(row?.[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

function getPitcherFlyBallRate(row) {
  return toNum(row?.pitcherFlyBallRate ?? row?.oppPitcherFlyBallRate ?? row?.opponentPitcherFlyBallRate)
}

function getPitcherHrRate(row) {
  return toNum(
    row?.opponentPitcherHrPer9 ??
      row?.pitcherHrPer9 ??
      row?.oppPitcherHrPer9 ??
      row?.opponentPitcherHomeRunsPer9
  )
}

function handednessBoost(row) {
  const batter = normLc(row?.batterHand ?? row?.bats ?? row?.batterThrows)
  const pitcher = normLc(row?.pitcherHand ?? row?.throws ?? row?.pitcherThrows ?? row?.oppPitcherThrows)
  if (!batter || !pitcher) return 0
  if ((batter === "l" && pitcher === "r") || (batter === "r" && pitcher === "l")) return 1
  return 0
}

function hrContextScore(row) {
  let s = 0
  const itt = toNum(row?.impliedTeamTotal)
  if (Number.isFinite(itt) && itt >= 5) s += 2

  const bo = getBattingOrderIndex(row)
  if (Number.isFinite(bo) && bo <= 5) s += 1

  const gt = toNum(row?.gameTotal)
  if (Number.isFinite(gt) && gt >= 8.5) s += 1

  return s
}

function hrMatchupScore(row) {
  const hr9 = getPitcherHrRate(row)
  const fb = getPitcherFlyBallRate(row)
  let s = 0
  // +1 if pitcher profile suggests HR contact (HR/9 or fly-ball tendency)
  if ((Number.isFinite(hr9) && hr9 >= 1.35) || (Number.isFinite(fb) && fb >= 0.38)) s += 1
  s += handednessBoost(row)
  return Math.min(s, 2)
}

function computeMatchupScore(row) {
  let score = 0

  const hrPer9 = toNum(row?.pitcherHrPer9) ?? 0
  const flyBallRate = toNum(row?.pitcherFlyBallRate) ?? 0
  const pitcherHand = row?.pitcherHand
  const batterHand = row?.batterHand

  // HR/9 impact (biggest signal)
  if (hrPer9 >= 1.4) score += 3
  else if (hrPer9 >= 1.1) score += 2
  else if (hrPer9 <= 0.8) score -= 2

  // fly ball pitchers give up more HRs
  if (flyBallRate >= 0.4) score += 1

  // handedness (platoon advantage)
  if (pitcherHand && batterHand) {
    if (pitcherHand !== batterHand) score += 1
  }

  return score
}

function hrValueScore(row, weight = 2.5) {
  const edge = toNum(row?.edgeProbability)
  if (!Number.isFinite(edge)) return 0
  return edge * weight
}

function computeOddsValueScore(row) {
  // Value via predictedProbability vs impliedProbability (from odds), in points.
  const pred = toNum(row?.predictedProbability)
  const impl = getImpliedProbability(row)
  if (!Number.isFinite(pred) || !Number.isFinite(impl) || impl <= 0) return 0
  const edge = pred - impl
  // cap edge contribution so one longshot can't dominate
  return clamp(edge * 30, -3, 6)
}

function hrContactScore(row) {
  const powerScore = toNum(row?.powerScore)
  return Number.isFinite(powerScore) ? powerScore : 0
}

function hrFinalScore(row, valueWeight) {
  const baseScore = toNum(row?.predictedProbability) || 0
  const ctx = hrContextScore(row)
  const matchup = hrMatchupScore(row)
  const value = hrValueScore(row, valueWeight)
  const contact = hrContactScore(row)
  return baseScore + ctx + matchup + value + contact
}

function getEventId(row) {
  return row?.eventId || row?.event_id || row?.gameId || row?.game_id || null
}

function computeFallbackPowerScore(row) {
  // Tiered fallback in a stable 0–20 band using signals we already have.
  // Intent: keep statcast helpful but never required.
  let s = 12

  const impl = getImpliedProbability(row)
  if (Number.isFinite(impl)) {
    if (impl >= 0.2) s += 4
    else if (impl >= 0.15) s += 3
    else if (impl >= 0.12) s += 2
    else if (impl >= 0.1) s += 1
    else if (impl <= 0.07) s -= 1
  }

  const itt = toNum(row?.impliedTeamTotal)
  if (Number.isFinite(itt)) {
    if (itt >= 5.5) s += 2
    else if (itt >= 5) s += 1
    else if (itt <= 3.5) s -= 1
  }

  const bo = getBattingOrderIndex(row)
  if (Number.isFinite(bo)) {
    if (bo <= 2) s += 2
    else if (bo <= 5) s += 1
    else if (bo >= 8) s -= 1
  }

  return clamp(s, 6, 20)
}

/**
 * Build HR likelihood candidates from `snapshot.rows` HR props.
 *
 * @param {{ rows: object[], topN?: number, valueWeight?: number }} input
 */
function buildMlbHrPredictionCandidates(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  console.log("[SNAPSHOT IDS]", rows.slice(0, 5).map((r) => r?.eventId))
  console.log("[DEBUG] total rows", rows.length)
  const topN = Number.isFinite(Number(input?.topN)) ? Math.max(5, Math.min(75, Number(input.topN))) : 30
  const valueWeight = Number.isFinite(Number(input?.valueWeight)) ? Number(input.valueWeight) : 2.5

  const allStatcast = Object.values(normalizedMap || {})
    .map((v) => toNum(v?.powerScore))
    .filter((n) => Number.isFinite(n))
  const statcastMin = allStatcast.length ? Math.min(...allStatcast) : null
  const statcastMax = allStatcast.length ? Math.max(...allStatcast) : null

  const hrRows = rows.filter(
    (r) =>
      r &&
      (norm(r?.propType) === "Home Runs" || norm(r?.propType) === "First Home Run") &&
      Number.isFinite(Number(r?.odds))
  )
  console.log("[DEBUG] HR rows before scoring", hrRows.length)

  /** @type {Map<string, { player: string, team: string | null, eventId: string | null, odds: any, predictedProbability: any, impliedProbability: number | null, hrScore: number, matchupScore: number, impliedTeamTotal: number | null, battingOrder: number | null, edgeProbability: number | null, gameTotal: number | null, hr9Allowed: number | null, flyBallRateAllowed: number | null, power: { barrelRate: number | null, hardHitRate: number | null, avgExitVelocity: number | null } | null, _weatherScore: number | null, _parkScore: number | null }>} */
  const bestByPlayerEvent = new Map()
  let debug_scoredRows = 0
  let debug_skipped_missingPlayer = 0
  let debug_skipped_missingPower = 0
  let debug_powerMin = Infinity
  let debug_powerMax = -Infinity
  let debug_powerSum = 0
  let debug_powerCount = 0
  let debug_normPowerMin = Infinity
  let debug_normPowerMax = -Infinity
  let debug_normPowerSum = 0
  let debug_normPowerCount = 0
  for (const row of hrRows) {
    console.log("[WEATHER DEBUG] row.eventId:", row.eventId)

    const player = norm(row?.player)
    if (!player) {
      debug_skipped_missingPlayer += 1
      continue
    }

    // defaults (safety)
    row.pitcherHrPer9 ??= 1.2
    row.pitcherFlyBallRate ??= 0.35
    row.pitcherHand ??= "R"
    const team = norm(row?.team) || null
    const eventId = getEventId(row)
    const eventKey = norm(eventId || "")
    const dedupeKey = [player, team || "", eventKey].join("|")

    console.log("[ROW PLAYER]", row.player)
    const normalizedPlayer = normalizeName(row.player)
    console.log("[NORMALIZED PLAYER]", normalizedPlayer)
    const playerPower = normalizedMap[normalizedPlayer]
    console.log("[LOOKUP RESULT]", playerPower)
    console.log("[LOOKUP]", row.player, normalizedPlayer, !!playerPower)

    const hasStatcast = !!(playerPower && Number.isFinite(toNum(playerPower.powerScore)))
    const rawPower = hasStatcast ? toNum(playerPower.powerScore) : computeFallbackPowerScore(row)
    row.powerScore = rawPower
    if (!hasStatcast) debug_skipped_missingPower += 1
    console.log("[POWER COMPUTED]", row.player, rawPower, hasStatcast ? "statcast" : "fallback")

    let normalizedPower = 0
    if (hasStatcast && Number.isFinite(statcastMin) && Number.isFinite(statcastMax) && statcastMax > statcastMin) {
      normalizedPower = ((rawPower - statcastMin) / (statcastMax - statcastMin)) * 20
    } else {
      normalizedPower = rawPower
    }
    normalizedPower = clamp(normalizedPower, 0, 20)

    debug_powerMin = Math.min(debug_powerMin, rawPower)
    debug_powerMax = Math.max(debug_powerMax, rawPower)
    debug_powerSum += rawPower
    debug_powerCount += 1
    debug_normPowerMin = Math.min(debug_normPowerMin, normalizedPower)
    debug_normPowerMax = Math.max(debug_normPowerMax, normalizedPower)
    debug_normPowerSum += normalizedPower
    debug_normPowerCount += 1

    const predictedProbability = toNum(row?.predictedProbability) ?? 0
    const contextScore = hrContextScore(row)
    const matchupScore = computeMatchupScore(row)

    const predPart = clamp(predictedProbability * 40, 0, 12)
    const ctxPart = clamp(contextScore * 1.25, 0, 5)
    const matchupPart = clamp(matchupScore * 1.6, -4, 8)
    const oddsValuePart = computeOddsValueScore(row)
    const powerPart = clamp(normalizedPower * 0.45, 0, 9)

    let hrScore = predPart + ctxPart + matchupPart + oddsValuePart + powerPart

    row._matchupScore = matchupScore
    debug_scoredRows += 1

    const implied = getImpliedProbability(row)
    const impliedTeamTotal = toNum(row?.impliedTeamTotal)
    const battingOrder = getBattingOrderIndex(row)
    const edgeProbability = toNum(row?.edgeProbability)
    const gameTotal = toNum(row?.gameTotal)
    const hr9Allowed = getPitcherHrRate(row)
    const flyBallRateAllowed = getPitcherFlyBallRate(row)
    const power = playerPower ? { ...playerPower, powerScore: rawPower } : { powerScore: rawPower }

    const weather = gameWeather?.[eventId]
    console.log("[WEATHER LOOKUP]", row.player, eventId, !!weather)

    let weatherScore = 0
    if (weather) {
      if (weather.windOut) weatherScore += 1
      if (weather.windIn) weatherScore -= 1
      if (Number.isFinite(toNum(weather.temperature)) && toNum(weather.temperature) >= 75) weatherScore += 1
      if (Number.isFinite(toNum(weather.temperature)) && toNum(weather.temperature) <= 50) weatherScore -= 1
    }

    row._weatherScore = weatherScore
    if (row._weatherScore === null || row._weatherScore === undefined) {
      row._weatherScore = 0
    }

    hrScore = hrScore + weatherScore

    let parkScore = 0
    const parkKey = (row?.homeTeam || "").trim().toLowerCase()
    const parkData = parkKey ? parkFactors?.[parkKey] : null
    if (parkData) {
      const factor = toNum(parkData.hrFactor)
      if (Number.isFinite(factor)) {
        if (factor >= 1.2) {
          parkScore += 2.5
        } else if (factor >= 1.1) {
          parkScore += 1.5
        } else if (factor >= 1.05) {
          parkScore += 0.75
        } else if (factor <= 0.9) {
          parkScore -= 2
        } else if (factor <= 0.95) {
          parkScore -= 1
        }
      }
    }

    hrScore = hrScore + parkScore

    if (parkScore !== 0) {
      row._parkScore = parkScore
    }

    // Deterministic tiny jitter to break ties without changing per-request.
    const noise = stableHash01(`${row.player}|${eventId}`) * 0.3
    hrScore = hrScore + noise

    row.hrScore = hrScore

    // normalize hrScore into probability
    const modelProb = Math.min(hrScore / 150, 0.35)
    row.modelProbability = modelProb

    const impliedProb = impliedProbability(row?.odds)
    row.impliedProbability = impliedProb

    const edge = modelProb - impliedProb
    row.edge = edge
    row.isValueBet = edge > 0.05

    const hybridScore =
      modelProb * (toNum(config?.weights?.score) ?? 0.5) +
      edge * (toNum(config?.weights?.edge) ?? 0.3) +
      (toNum(row?.recentFormScore) ?? 0) * (toNum(config?.weights?.recentForm) ?? 0.2)
    row.hybridScore = hybridScore

    if (debug_scoredRows <= 20) {
      console.log({
        player: row.player,
        matchup: row._matchupScore,
        hrScore: row.hrScore,
      })
    }

    console.log("[POWER FINAL]", row.player, rawPower)

    const entry = {
      player,
      team,
      eventId,
      powerScore: rawPower,
      _weatherScore: weatherScore,
      _parkScore: parkScore,
      odds: row?.odds ?? null,
      predictedProbability: row?.predictedProbability ?? null,
      impliedProbability: impliedProb,
      modelProbability: modelProb,
      edge,
      isValueBet: edge > 0.05,
      hybridScore: row.hybridScore,
      hrScore: Number(hrScore.toFixed(4)),
      matchupScore,
      impliedTeamTotal,
      battingOrder,
      edgeProbability,
      gameTotal,
      hr9Allowed,
      flyBallRateAllowed,
      power,
      _scoreBreakdown: {
        predictedProbability: predPart,
        contextScore: ctxPart,
        matchupScore: matchupPart,
        oddsValueScore: oddsValuePart,
        powerScore: powerPart,
        weatherScore,
        parkScore,
        noise,
      },
    }

    if (entry._weatherScore === null || entry._weatherScore === undefined) {
      entry._weatherScore = 0
    }
    if (row._weatherScore === null || row._weatherScore === undefined) {
      row._weatherScore = 0
    }
    const prev = bestByPlayerEvent.get(dedupeKey)
    if (!prev || (entry.hrScore || 0) > (prev.hrScore || 0)) bestByPlayerEvent.set(dedupeKey, entry)
  }

  const scored = [...bestByPlayerEvent.values()]
  console.log("[DEBUG] HR rows after scoring", debug_scoredRows)
  console.log("[DEBUG] skipped missing player", debug_skipped_missingPlayer)
  console.log("[DEBUG] skipped missing powerScore", debug_skipped_missingPower)
  console.log("[DEBUG] candidates count before sort", scored.length)
  const powerAvg = debug_powerCount ? debug_powerSum / debug_powerCount : 0
  console.log("[POWER DISTRIBUTION]", {
    min: Number.isFinite(debug_powerMin) ? debug_powerMin : null,
    max: Number.isFinite(debug_powerMax) ? debug_powerMax : null,
    avg: Number.isFinite(powerAvg) ? Number(powerAvg.toFixed(3)) : null,
    count: debug_powerCount,
  })
  const normPowerAvg = debug_normPowerCount ? debug_normPowerSum / debug_normPowerCount : 0
  console.log("[POWER DISTRIBUTION NORMALIZED]", {
    min: Number.isFinite(debug_normPowerMin) ? Number(debug_normPowerMin.toFixed(3)) : null,
    max: Number.isFinite(debug_normPowerMax) ? Number(debug_normPowerMax.toFixed(3)) : null,
    avg: Number.isFinite(normPowerAvg) ? Number(normPowerAvg.toFixed(3)) : null,
    count: debug_normPowerCount,
    statcastMin,
    statcastMax,
  })
  // Convert hrScore (points) -> modelProbability (0..1) using shared robust+logistic scaling.
  const hrScoreNums = scored.map((r) => toNum(r?.hrScore)).filter((n) => Number.isFinite(n))
  const hrStats = computeRobustStats(hrScoreNums)

  let probMin = Infinity
  let probMax = -Infinity
  let probSum = 0
  let probCount = 0

  for (const r of scored) {
    const raw = toNum(r?.hrScore)
    const modelProbability = computeProbabilityFromScore(raw, {
      stats: hrStats,
      floor: 0.05,
      ceiling: 0.3,
      midpoint: 0.15,
      k: 1.05,
    })

    r.modelProbability = modelProbability

    const impliedProb = toNum(r?.impliedProbability) ?? 0
    r.edge = modelProbability - impliedProb
    r.isValueBet = r.edge > 0.05

    const hybridScore =
      modelProbability * (toNum(config?.weights?.score) ?? 0.5) +
      (toNum(r.edge) ?? 0) * (toNum(config?.weights?.edge) ?? 0.3) +
      (toNum(r?.recentFormScore) ?? 0) * (toNum(config?.weights?.recentForm) ?? 0.2)
    r.hybridScore = hybridScore

    probMin = Math.min(probMin, modelProbability)
    probMax = Math.max(probMax, modelProbability)
    probSum += modelProbability
    probCount += 1
  }

  const probAvg = probCount ? probSum / probCount : 0
  console.log("[PROB DISTRIBUTION]", {
    min: Number.isFinite(probMin) ? Number(probMin.toFixed(4)) : null,
    max: Number.isFinite(probMax) ? Number(probMax.toFixed(4)) : null,
    avg: Number.isFinite(probAvg) ? Number(probAvg.toFixed(4)) : null,
    count: probCount,
    hrMedian: Number.isFinite(hrStats?.median) ? Number(hrStats.median.toFixed(4)) : null,
    hrIqr: Number.isFinite(hrStats?.iqr) ? Number(hrStats.iqr.toFixed(4)) : null,
    hrScale: Number.isFinite(hrStats?.scale) ? Number(hrStats.scale.toFixed(4)) : null,
  })

  scored.sort((a, b) => scoreSortValue(b) - scoreSortValue(a))
  console.log("[DEBUG] candidates count after sort", scored.length)

  const scoreNums = scored.map((r) => toNum(r?.hrScore)).filter((n) => Number.isFinite(n))
  const scoreMin = scoreNums.length ? Math.min(...scoreNums) : null
  const scoreMax = scoreNums.length ? Math.max(...scoreNums) : null
  const scoreAvg = scoreNums.length ? scoreNums.reduce((s, n) => s + n, 0) / scoreNums.length : null
  console.log("[SCORE DISTRIBUTION]", {
    min: Number.isFinite(scoreMin) ? Number(scoreMin.toFixed(4)) : null,
    max: Number.isFinite(scoreMax) ? Number(scoreMax.toFixed(4)) : null,
    avg: Number.isFinite(scoreAvg) ? Number(scoreAvg.toFixed(4)) : null,
    count: scoreNums.length,
  })

  console.log(
    "[TOP 10 BREAKDOWN]",
    scored.slice(0, 10).map((r) => ({
      player: r.player,
      team: r.team,
      eventId: r.eventId,
      hrScore: r.hrScore,
      hybridScore: r.hybridScore,
      odds: r.odds,
      modelProbability: r.modelProbability,
      impliedProbability: r.impliedProbability,
      edge: r.edge,
      powerScore: r.powerScore,
      matchupScore: r.matchupScore,
      _weatherScore: r._weatherScore,
      _parkScore: r._parkScore,
      breakdown: r._scoreBreakdown,
    }))
  )

  const scores = scored.map((r) => Number(r.hrScore || 0)).filter((n) => Number.isFinite(n)).sort((a, b) => b - a)
  const eliteCut = scores.length ? scores[Math.min(Math.floor(scores.length * 0.15), scores.length - 1)] : 999
  const strongCut = scores.length ? scores[Math.min(Math.floor(scores.length * 0.45), scores.length - 1)] : 0

  const candidatesWithMeta = scored.slice(0, topN).map((r) => {
    let tag = "STRONG"
    if (Number.isFinite(r.hrScore) && r.hrScore >= eliteCut) tag = "ELITE"
    else if (Number.isFinite(r.hrScore) && r.hrScore >= strongCut) tag = "STRONG"
    else tag = "LOTTO"

    const odds = toNum(r.odds)
    const impl = toNum(r.impliedProbability)
    if (Number.isFinite(odds) && odds >= 450) tag = "LOTTO"
    if (Number.isFinite(impl) && impl <= 0.1) tag = "LOTTO"

    const reasonsArray = []
    const power = r.power
    if (Number.isFinite(toNum(power?.powerScore)) && toNum(power.powerScore) >= 6) reasonsArray.push("strong power profile")

    if (Number.isFinite(r.hr9Allowed) && r.hr9Allowed >= 1.35) reasonsArray.push("high HR/9 pitcher")
    if (Number.isFinite(r.flyBallRateAllowed) && r.flyBallRateAllowed >= 0.38) reasonsArray.push("fly-ball prone pitcher")

    if (Number.isFinite(r.impliedTeamTotal) && r.impliedTeamTotal >= 5) reasonsArray.push("high team total")
    if (Number.isFinite(r.battingOrder) && r.battingOrder <= 5) reasonsArray.push("top lineup spot")
    if (Number.isFinite(r.gameTotal) && r.gameTotal >= 8.5) reasonsArray.push("high game total")

    if (Number.isFinite(r.edgeProbability) && r.edgeProbability > 0.05) reasonsArray.push("positive betting edge")

    const reasons = Array.isArray(reasonsArray) ? reasonsArray : []

    return {
      player: r.player,
      team: r.team,
      eventId: r.eventId,
      odds: r.odds,
      predictedProbability: r.predictedProbability,
      modelProbability: r.modelProbability ?? null,
      impliedProbability: r.impliedProbability ?? null,
      edge: r.edge ?? null,
      isValueBet: !!r.isValueBet,
      hybridScore: Number.isFinite(toNum(r?.hybridScore)) ? toNum(r.hybridScore) : 0,
      hrScore: r.hrScore,
      powerScore: toNum(r?.powerScore) ?? toNum(r?.power?.powerScore) ?? 0,
      tag,
      reasons,
      _weatherScore: toNum(r._weatherScore) ?? 0,
      _parkScore: r._parkScore ?? null,
      _reasoning: {
        matchupScore: r.matchupScore,
        impliedTeamTotal: r.impliedTeamTotal,
        battingOrder: r.battingOrder,
        edgeProbability: r.edgeProbability,
        scoreBreakdown: r._scoreBreakdown || null,
      },
    }
  })

  const candidates = candidatesWithMeta
    .map((p) => ({
      ...p,
      _weatherScore: p._weatherScore ?? 0
    }))
    .map((r) => {
      // Final output (source of truth): explicitly include reasons on each object.
      return {
        player: r.player,
        team: r.team,
        eventId: r.eventId,
        odds: r.odds,
        predictedProbability: r.predictedProbability,
        modelProbability: r.modelProbability ?? null,
        impliedProbability: r.impliedProbability ?? null,
        edge: r.edge ?? null,
        isValueBet: !!r.isValueBet,
        hybridScore: Number.isFinite(toNum(r?.hybridScore)) ? toNum(r.hybridScore) : 0,
        hrScore: r.hrScore,
        powerScore: toNum(r?.powerScore) ?? 0,
        tag: r.tag,
        reasons: Array.isArray(r?.reasons) ? r.reasons : [],
        _weatherScore: toNum(r._weatherScore) ?? 0,
        _parkScore: toNum(r._parkScore) ?? 0,
        _reasoning: r._reasoning || null,
      }
    })
    .filter(Boolean)
  console.log("[DEBUG] candidates count after filters", candidates.length)

  const filtered = candidates.filter(
    (p) =>
      (toNum(p?.modelProbability) ?? 0) >= (toNum(config?.filters?.minModelProb) ?? 0.1) &&
      (toNum(p?.edge) ?? 0) >= (toNum(config?.filters?.minEdge) ?? -0.02)
  )
  filtered.sort((a, b) => scoreSortValue(b) - scoreSortValue(a))

  const diverseCandidates = buildDiverseRankedList(filtered, topN)

  const mostLikelyHr = [...candidatesWithMeta]
    .sort((a, b) => (toNum(b?.modelProbability) || 0) - (toNum(a?.modelProbability) || 0) || (toNum(b?.hrScore) || 0) - (toNum(a?.hrScore) || 0))
    .slice(0, 15)
    .map((r) => {
      const matchupScore = toNum(r?._reasoning?.matchupScore) || 0
      const impliedTeamTotal = toNum(r?._reasoning?.impliedTeamTotal)
      const battingOrder = toNum(r?._reasoning?.battingOrder)
      const edgeProbability = toNum(r?._reasoning?.edgeProbability)
      const strongContext =
        (Number.isFinite(impliedTeamTotal) && impliedTeamTotal >= 5) || (Number.isFinite(battingOrder) && battingOrder <= 5)

      return {
        player: r.player,
        team: r.team,
        eventId: r.eventId,
        odds: r.odds,
        predictedProbability: r.predictedProbability,
        modelProbability: r.modelProbability ?? null,
        impliedProbability: r.impliedProbability ?? null,
        edge: r.edge ?? null,
        isValueBet: !!r.isValueBet,
        hybridScore: r.hybridScore ?? null,
        hrScore: r.hrScore,
        tag: r.tag,
        reasons: Array.isArray(r?.reasons) ? r.reasons : [],
        _weatherScore: toNum(r._weatherScore) ?? 0,
        _parkScore: toNum(r._parkScore) ?? 0,
        powerScore: toNum(r?.powerScore) ?? toNum(r?.power?.powerScore) ?? 0,
        hasStrongMatchup: matchupScore > 0,
        strongContext,
        valueEdge: Number.isFinite(edgeProbability) && edgeProbability > 0,
      }
    })
    .map((p) => ({
      ...p,
      _weatherScore: p._weatherScore ?? 0
    }))

  const bestEdges = [...candidates]
    .filter((p) => Number.isFinite(toNum(p?.edge)) && p.edge > 0)
    .sort((a, b) => (toNum(b?.edge) || 0) - (toNum(a?.edge) || 0))

  if (!candidates.length) {
    console.log("[HR MODEL] No candidates — fallback triggered")

    const fallback = rows
      .filter(
        (r) => String(r?.propType || "") === "Home Runs" || String(r?.propType || "") === "First Home Run"
      )
      .slice(0, 10)
      .map((r) => ({
        player: r?.player,
        team: r?.team,
        eventId: r?.eventId,
        odds: r?.odds,
        hrScore: 0,
        _weatherScore: 0,
        _parkScore: 0,
        powerScore: 0,
        tag: "LOTTO",
        reasons: [],
      }))

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      source: "snapshot.rows:HomeRuns:fallback",
      counts: { hrRows: hrRows.length, uniquePlayers: scored.length },
      thresholds: { eliteCut, strongCut },
      topHrCandidatesToday: fallback,
      mostLikelyHr: fallback,
      bestEdges: [],
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "snapshot.rows:HomeRuns",
    counts: { hrRows: hrRows.length, uniquePlayers: scored.length },
    thresholds: { eliteCut, strongCut },
    topHrCandidatesToday: diverseCandidates,
    mostLikelyHr,
    bestEdges,
  }
}

module.exports = { buildMlbHrPredictionCandidates }
