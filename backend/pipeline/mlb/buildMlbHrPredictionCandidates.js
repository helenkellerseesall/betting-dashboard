"use strict"

const mlbPlayerPower = require("../../data/mlbPlayerPower.json")
const gameWeather = require("../../data/mlbGameWeather.json")
const parkFactors = require("../../data/mlbParkFactors.json")

console.log("[WEATHER DEBUG] weather keys:", Object.keys(gameWeather || {}).slice(0, 5))

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

function hrValueScore(row, weight = 2.5) {
  const edge = toNum(row?.edgeProbability)
  if (!Number.isFinite(edge)) return 0
  return edge * weight
}

function hrContactScore(row) {
  const player = norm(row?.player)
  if (!player) return 0
  const m = mlbPlayerPower?.[player]
  if (!m || typeof m !== "object") return 0

  const barrelRate = toNum(m.barrelRate)
  const hardHitRate = toNum(m.hardHitRate)
  const avgExitVelocity = toNum(m.avgExitVelocity)

  if (!Number.isFinite(barrelRate) && !Number.isFinite(hardHitRate) && !Number.isFinite(avgExitVelocity)) return 0

  const barrelComponent = (Number.isFinite(barrelRate) ? barrelRate : 0) * 30 // primary driver
  const hardHitComponent = (Number.isFinite(hardHitRate) ? hardHitRate : 0) * 10
  const evComponent = (Number.isFinite(avgExitVelocity) ? (avgExitVelocity - 85) : 0) * 0.4

  let contactScore = barrelComponent + hardHitComponent + evComponent
  contactScore = contactScore * 0.7
  return Number.isFinite(contactScore) ? contactScore : 0
}

function getPlayerPower(player) {
  const name = norm(player)
  if (!name) return null
  const m = mlbPlayerPower?.[name]
  if (!m || typeof m !== "object") return null
  return {
    barrelRate: toNum(m.barrelRate),
    hardHitRate: toNum(m.hardHitRate),
    avgExitVelocity: toNum(m.avgExitVelocity),
  }
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
  const id = row?.eventId ?? row?.event_id ?? row?.gameId ?? row?.game_id
  return norm(id || row?.matchup || "") || null
}

/**
 * Build HR likelihood candidates from `snapshot.rows` HR props.
 *
 * @param {{ rows: object[], topN?: number, valueWeight?: number }} input
 */
function buildMlbHrPredictionCandidates(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const topN = Number.isFinite(Number(input?.topN)) ? Math.max(5, Math.min(75, Number(input.topN))) : 30
  const valueWeight = Number.isFinite(Number(input?.valueWeight)) ? Number(input.valueWeight) : 2.5

  const hrRows = rows.filter((r) => r && norm(r?.propType) === "Home Runs" && Number.isFinite(Number(r?.odds)))

  /** @type {Map<string, { player: string, team: string | null, eventId: string | null, odds: any, predictedProbability: any, impliedProbability: number | null, hrScore: number, matchupScore: number, impliedTeamTotal: number | null, battingOrder: number | null, edgeProbability: number | null, gameTotal: number | null, hr9Allowed: number | null, flyBallRateAllowed: number | null, power: { barrelRate: number | null, hardHitRate: number | null, avgExitVelocity: number | null } | null, _weatherScore: number | null, _parkScore: number | null }>} */
  const bestByPlayerEvent = new Map()
  for (const row of hrRows) {
    console.log("[WEATHER DEBUG] row.eventId:", row.eventId)

    const player = norm(row?.player)
    if (!player) continue
    const team = norm(row?.team) || null
    const eventId = getEventId(row)
    const eventKey = norm(eventId || "")
    const dedupeKey = [player, team || "", eventKey].join("|")

    let hrScore = hrFinalScore(row, valueWeight)
    const implied = getImpliedProbability(row)
    const matchupScore = hrMatchupScore(row)
    const impliedTeamTotal = toNum(row?.impliedTeamTotal)
    const battingOrder = getBattingOrderIndex(row)
    const edgeProbability = toNum(row?.edgeProbability)
    const gameTotal = toNum(row?.gameTotal)
    const hr9Allowed = getPitcherHrRate(row)
    const flyBallRateAllowed = getPitcherFlyBallRate(row)
    const power = getPlayerPower(player)

    let weatherScore = 0
    const weather = gameWeather?.[row?.eventId]
    console.log("[WEATHER DEBUG] lookup:", row.eventId, weather)
    if (weather) {
      if (weather.windOut && Number.isFinite(toNum(weather.windSpeed)) && toNum(weather.windSpeed) >= 8) {
        weatherScore += 2
      }
      if (weather.windIn && Number.isFinite(toNum(weather.windSpeed)) && toNum(weather.windSpeed) >= 8) {
        weatherScore -= 2
      }
      if (Number.isFinite(toNum(weather.temperature)) && toNum(weather.temperature) >= 75) {
        weatherScore += 1.5
      }
      if (Number.isFinite(toNum(weather.temperature)) && toNum(weather.temperature) <= 55) {
        weatherScore -= 1
      }
    }

    hrScore = hrScore + weatherScore

    if (weatherScore !== 0) {
      row._weatherScore = weatherScore
    }

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

    const entry = {
      player,
      team,
      eventId,
      _weatherScore: weatherScore !== 0 ? weatherScore : null,
      _parkScore: parkScore,
      odds: row?.odds ?? null,
      predictedProbability: row?.predictedProbability ?? null,
      impliedProbability: implied,
      hrScore: Number(hrScore.toFixed(4)),
      matchupScore,
      impliedTeamTotal,
      battingOrder,
      edgeProbability,
      gameTotal,
      hr9Allowed,
      flyBallRateAllowed,
      power,
    }
    const prev = bestByPlayerEvent.get(dedupeKey)
    if (!prev || (entry.hrScore || 0) > (prev.hrScore || 0)) bestByPlayerEvent.set(dedupeKey, entry)
  }

  const scored = [...bestByPlayerEvent.values()]
  scored.sort((a, b) => (b.hrScore || 0) - (a.hrScore || 0))

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
    if (Number.isFinite(power?.barrelRate) && power.barrelRate >= 0.15) reasonsArray.push("elite barrel rate")
    if (Number.isFinite(power?.hardHitRate) && power.hardHitRate >= 0.45) reasonsArray.push("high hard-hit rate")
    if (Number.isFinite(power?.avgExitVelocity) && power.avgExitVelocity >= 91) reasonsArray.push("strong exit velocity")

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
      hrScore: r.hrScore,
      tag,
      reasons,
      _weatherScore: r._weatherScore ?? null,
      _parkScore: r._parkScore ?? null,
      _reasoning: {
        matchupScore: r.matchupScore,
        impliedTeamTotal: r.impliedTeamTotal,
        battingOrder: r.battingOrder,
        edgeProbability: r.edgeProbability,
      },
    }
  })

  const candidates = candidatesWithMeta.map((r) => {
    // Final output (source of truth): explicitly include reasons on each object.
    return {
      player: r.player,
      team: r.team,
      eventId: r.eventId,
      odds: r.odds,
      predictedProbability: r.predictedProbability,
      hrScore: r.hrScore,
      tag: r.tag,
      reasons: Array.isArray(r?.reasons) ? r.reasons : [],
      _weatherScore: r._weatherScore ?? null,
      _parkScore: toNum(r._parkScore) ?? 0,
    }
  })

  const mostLikelyHr = [...candidatesWithMeta]
    .sort((a, b) => (toNum(b?.predictedProbability) || 0) - (toNum(a?.predictedProbability) || 0))
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
        hrScore: r.hrScore,
        tag: r.tag,
        reasons: Array.isArray(r?.reasons) ? r.reasons : [],
        _weatherScore: r._weatherScore ?? null,
        _parkScore: toNum(r._parkScore) ?? 0,
        hasStrongMatchup: matchupScore > 0,
        strongContext,
        valueEdge: Number.isFinite(edgeProbability) && edgeProbability > 0,
      }
    })

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "snapshot.rows:HomeRuns",
    counts: { hrRows: hrRows.length, uniquePlayers: scored.length },
    thresholds: { eliteCut, strongCut },
    topHrCandidatesToday: candidates,
    mostLikelyHr,
  }
}

module.exports = { buildMlbHrPredictionCandidates }
