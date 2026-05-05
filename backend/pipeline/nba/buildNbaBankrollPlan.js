"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA Bankroll Plan — controls HOW MUCH, HOW OFTEN, HOW TO SCALE.
 *
 *   unitSize        = bankroll × unitPctOfBankroll        (default 1.5%)
 *   dailyRiskBudget = bankroll × maxDailyRiskPct          (default 15%)
 *   playerCap       = bankroll × maxPlayerExposurePct     (default 15%)
 *
 * Per single bet:
 *   1. Tier-driven base units:
 *        ELITE:    2.0–3.0u
 *        STRONG:   1.0–1.5u
 *        PLAYABLE: 0.5–1.0u
 *        LOTTO:    0.1–0.25u
 *        FADE:     0u
 *   2. Kelly-style adjustment:
 *        fraction = edge × confidence                     (fraction of bankroll)
 *        kellyUnits = fraction × bankroll / unitSize
 *      The bet uses MAX(tierBase, kellyUnits) clamped to the tier's [min, max].
 *   3. Global clamps: 0.25u min, 3.0u max per single bet.
 *
 * Per slip bet:
 *   SAFE:       1.0–1.5u
 *   BALANCED:   0.5–1.0u
 *   AGGRESSIVE: 0.25–0.5u
 *   LOTTO:      0.1–0.25u
 *
 * Streak adjustment to unitSize (Phase 7):
 *   - cold streak (losses much > wins): reduce 20–40%
 *   - hot streak (wins much > losses):  modest +10–15%
 *
 * Risk controls (applied AFTER raw sizing):
 *   - per-player exposure ≤ playerCap (scale down that player's stakes)
 *   - total daily risk    ≤ dailyRiskBudget (scale all stakes down)
 *
 * Inputs:
 *   {
 *     bestBetsBoard: { corePlays, allPlays, slips: { safe, balanced, aggressive, lotto } },
 *     bankroll: 100,                // user-defined dollars
 *     options: {
 *       unitPctOfBankroll: 0.015,   // 1.5% default
 *       maxDailyRiskPct: 0.15,      // 15% default
 *       maxPlayerExposurePct: 0.15, // 15% default
 *       streak: { wins, losses }    // recent N (e.g. last 10) — optional
 *     }
 *   }
 *
 * Output: full betSizingPlan (see bottom of file).
 */

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function clamp(lo, hi, x) {
  return Math.max(lo, Math.min(hi, x))
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}

function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 1 + n / 100
  return 1 + 100 / Math.abs(n)
}

/** Tier → [minUnits, maxUnits] for single bets. Mirrors user spec exactly. */
function tierUnitsRange(tier) {
  const t = String(tier || "").toUpperCase()
  if (t === "ELITE") return [2.0, 3.0]
  if (t === "STRONG") return [1.0, 1.5]
  if (t === "PLAYABLE") return [0.5, 1.0]
  if (t === "LONGSHOT" || t === "LOTTO") return [0.1, 0.25]
  return [0, 0]
}

/** Slip type → [minUnits, maxUnits]. */
function slipUnitsRange(type) {
  const t = String(type || "").toUpperCase()
  if (t === "SAFE") return [1.0, 1.5]
  if (t === "BALANCED") return [0.5, 1.0]
  if (t === "AGGRESSIVE") return [0.25, 0.5]
  if (t === "LOTTO") return [0.1, 0.25]
  return [0, 0]
}

/**
 * Streak-driven multiplier on unitSize.
 *
 * Cold streak: more losses than wins in recent window → 0.60–0.80x.
 * Hot streak:  many more wins than losses             → 1.10–1.15x (modest).
 * Otherwise:   1.0x.
 */
function streakMultiplier(streak) {
  const wins = num(streak?.wins) ?? 0
  const losses = num(streak?.losses) ?? 0
  const diff = wins - losses
  if (diff <= -5) return { multiplier: 0.6, reason: "cold streak: −5+ net losses → unit size cut 40%" }
  if (diff <= -3) return { multiplier: 0.8, reason: "cool streak: −3 net losses → unit size cut 20%" }
  if (diff >= 7) return { multiplier: 1.15, reason: "hot streak: +7 net wins → unit size +15%" }
  if (diff >= 5) return { multiplier: 1.1, reason: "warm streak: +5 net wins → unit size +10%" }
  return { multiplier: 1.0, reason: "neutral streak — base unit size" }
}

/** Compute Kelly-style units for a single play. */
function kellyUnitsForPlay(play, bankroll, unitSize) {
  const edge = num(play?.edge) ?? 0
  const conf = num(play?.confidence) ?? 0
  if (edge <= 0 || unitSize <= 0) return 0
  const fraction = Math.max(0, edge) * Math.max(0, conf)
  const dollars = fraction * bankroll
  return dollars / unitSize
}

/** Resolve units for a single play (tier base + Kelly), then clamp globally. */
function resolveSingleBetUnits(play, bankroll, unitSize) {
  const [tierMin, tierMax] = tierUnitsRange(play.tier)
  if (tierMax === 0) return { units: 0, kellyUnits: 0, tierMin, tierMax }
  const kelly = kellyUnitsForPlay(play, bankroll, unitSize)
  // Tier is the dominant signal, Kelly nudges within the tier band.
  const tierMid = (tierMin + tierMax) / 2
  const blended = Math.max(tierMid, Math.min(tierMax, kelly))
  const inTier = clamp(tierMin, tierMax, blended)
  const globallyClamped = clamp(0.25, 3.0, inTier)
  return { units: globallyClamped, kellyUnits: kelly, tierMin, tierMax }
}

/** Resolve units for a slip bet — slip-type drives sizing, edge/conf nudge upward. */
function resolveSlipBetUnits(slip, bankroll, unitSize) {
  const [slipMin, slipMax] = slipUnitsRange(slip.type)
  if (slipMax === 0) return { units: 0, kellyUnits: 0, slipMin, slipMax }
  // Treat the slip's combined edge × combinedModelProb as the "confidence".
  const fakePlay = {
    edge: num(slip.edge) ?? 0,
    confidence: num(slip.combinedModelProb) ?? 0,
  }
  const kelly = kellyUnitsForPlay(fakePlay, bankroll, unitSize)
  const slipMid = (slipMin + slipMax) / 2
  const blended = Math.max(slipMid, Math.min(slipMax, kelly))
  const clamped = clamp(slipMin, slipMax, blended)
  return { units: clamped, kellyUnits: kelly, slipMin, slipMax }
}

/**
 * For a single bet at given units, the actual STAKE (dollars at risk) is
 * units × unitSize. For a slip the stake is unit-based the same way; payout
 * comes from combined decimal odds × stake.
 */
function singleBetReasoning(play, units, kellyUnits) {
  const parts = []
  parts.push(`${play.tier} tier`)
  if (Number.isFinite(play.edge)) parts.push(`edge ${(play.edge * 100).toFixed(1)}%`)
  if (Number.isFinite(play.confidence)) parts.push(`conf ${(play.confidence * 100).toFixed(0)}%`)
  if (kellyUnits > 0) parts.push(`Kelly ${kellyUnits.toFixed(2)}u`)
  parts.push(`sizing ${units.toFixed(2)}u`)
  return parts.join(" · ")
}

function slipBetReasoning(slip, units) {
  const parts = []
  parts.push(`${slip.type} slip × ${slip.legCount} legs`)
  if (Number.isFinite(slip.edge)) parts.push(`edge ${(slip.edge * 100).toFixed(1)}%`)
  if (Number.isFinite(slip.combinedModelProb))
    parts.push(`win prob ${(slip.combinedModelProb * 100).toFixed(1)}%`)
  if (Number.isFinite(slip.combinedAmericanOdds)) {
    const a = slip.combinedAmericanOdds
    parts.push(`combined ${a > 0 ? "+" : ""}${a}`)
  }
  parts.push(`sizing ${units.toFixed(2)}u`)
  return parts.join(" · ")
}

/**
 * Take a list of {category, bet, player} sizing entries and apply two scaling passes:
 *   1) Per-player exposure cap — scale that player's stakes down.
 *   2) Total daily risk cap   — scale ALL stakes down proportionally.
 * Operates on `units` (not stake) and recomputes stake at the end.
 */
function applyExposureControls(entries, { unitSize, playerCap, dailyRiskBudget }) {
  if (!entries.length) return { entries, scalingPasses: { perPlayer: 1, daily: 1 } }

  // 1) Per-player cap.
  const perPlayerStake = new Map()
  for (const e of entries) {
    const k = String(e.playerKey || "_slip").toLowerCase()
    perPlayerStake.set(k, (perPlayerStake.get(k) || 0) + e.units * unitSize)
  }
  const perPlayerScale = new Map()
  for (const [k, s] of perPlayerStake) {
    if (s > playerCap) perPlayerScale.set(k, playerCap / s)
  }
  let scaledByPlayer = 0
  for (const e of entries) {
    const k = String(e.playerKey || "_slip").toLowerCase()
    if (perPlayerScale.has(k)) {
      e.units *= perPlayerScale.get(k)
      scaledByPlayer += 1
    }
  }

  // 2) Daily risk cap.
  let totalStake = entries.reduce((a, e) => a + e.units * unitSize, 0)
  let dailyScale = 1
  if (totalStake > dailyRiskBudget && totalStake > 0) {
    dailyScale = dailyRiskBudget / totalStake
    for (const e of entries) e.units *= dailyScale
  }

  // Re-floor: if scaling pushed a single bet below 0.25u, drop the bet.
  // (Slips have a lower floor of 0.1u and are kept.)
  const filtered = []
  for (const e of entries) {
    if (e.kind === "single" && e.units < 0.2) continue
    if (e.kind === "slip" && e.units < 0.05) continue
    filtered.push(e)
  }

  // Recompute stake on each entry.
  for (const e of filtered) {
    e.stake = round2(e.units * unitSize)
    e.units = round2(e.units)
  }

  return {
    entries: filtered,
    scalingPasses: {
      perPlayerScaled: scaledByPlayer,
      perPlayerCapHit: perPlayerScale.size,
      dailyScale: round2(dailyScale),
      dailyCapHit: dailyScale < 1,
    },
  }
}

/**
 * Main entry point.
 */
function buildNbaBankrollPlan(input = {}) {
  const generatedAt = new Date().toISOString()
  const board = input?.bestBetsBoard || null
  const bankroll = num(input?.bankroll)
  if (!board || !Number.isFinite(bankroll) || bankroll <= 0) {
    return {
      bankroll: bankroll ?? 0,
      unitSize: 0,
      dailyRiskBudget: 0,
      playerCap: 0,
      totalRisk: 0,
      bets: [],
      slipBets: [],
      meta: {
        generatedAt,
        reason: !board ? "no_board" : "invalid_bankroll",
      },
    }
  }

  const opts = {
    unitPctOfBankroll: num(input?.options?.unitPctOfBankroll) ?? 0.015,
    maxDailyRiskPct: num(input?.options?.maxDailyRiskPct) ?? 0.15,
    maxPlayerExposurePct: num(input?.options?.maxPlayerExposurePct) ?? 0.15,
    streak: input?.options?.streak || null,
  }

  const streak = streakMultiplier(opts.streak)
  const baseUnitSize = bankroll * opts.unitPctOfBankroll
  const unitSize = round2(baseUnitSize * streak.multiplier)
  const dailyRiskBudget = round2(bankroll * opts.maxDailyRiskPct)
  const playerCap = round2(bankroll * opts.maxPlayerExposurePct)

  // -------- Singles --------
  // Pull the canonical "playable" universe: corePlays + any allPlays in tiers we size.
  const singleSourceMap = new Map()
  function pushUnique(p) {
    if (!p) return
    const k = `${(p.player || "").toLowerCase()}|${p.eventId || ""}|${p.statFamily}|${p.side}|${p.line}`
    if (!singleSourceMap.has(k)) singleSourceMap.set(k, p)
  }
  for (const p of Array.isArray(board.corePlays) ? board.corePlays : []) pushUnique(p)
  for (const p of Array.isArray(board.allPlays) ? board.allPlays : []) {
    const tier = String(p.tier || "").toUpperCase()
    if (tier === "ELITE" || tier === "STRONG" || tier === "PLAYABLE") pushUnique(p)
  }
  const singleSource = Array.from(singleSourceMap.values())

  const singleEntries = []
  for (const p of singleSource) {
    const tier = String(p.tier || "").toUpperCase()
    if (tier === "FADE") continue
    const { units, kellyUnits, tierMin, tierMax } = resolveSingleBetUnits(p, bankroll, unitSize)
    if (units <= 0) continue
    singleEntries.push({
      kind: "single",
      playerKey: String(p.player || "").toLowerCase(),
      bet: {
        player: p.player,
        eventId: p.eventId || null,
        matchup: p.matchup || null,
        prop: `${p.statFamily} ${p.side} ${p.line}`,
        statFamily: p.statFamily,
        side: p.side,
        line: p.line,
        oddsAmerican: p.oddsAmerican,
        sportsbook: p.sportsbook || null,
        tier: p.tier,
        modelProb: p.modelProb,
        impliedProb: p.impliedProb,
        edge: p.edge,
        confidence: p.confidence,
        kellyFraction: round4(num(p?.edge) * num(p?.confidence) || 0),
      },
      units,
      kellyUnits,
      tierMin,
      tierMax,
      reasoning: null, // filled after final units known
    })
  }

  // -------- Slips --------
  const slipEntries = []
  const slipsByType = board?.slips || {}
  function pushSlipsFor(type, list) {
    for (const slip of Array.isArray(list) ? list : []) {
      const slipObj = { ...slip, type }
      const { units, kellyUnits, slipMin, slipMax } = resolveSlipBetUnits(slipObj, bankroll, unitSize)
      if (units <= 0) continue
      // Per-player cap on slips: take the player most heavily represented.
      const playerCount = {}
      for (const l of slip.legs || []) {
        const k = String(l.player || "").toLowerCase()
        playerCount[k] = (playerCount[k] || 0) + 1
      }
      const heaviestPlayerKey = Object.entries(playerCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null
      slipEntries.push({
        kind: "slip",
        playerKey: heaviestPlayerKey || `_slip_${type}`,
        bet: {
          type,
          legCount: slip.legCount,
          legs: slip.legs,
          combinedDecimalOdds: slip.combinedDecimalOdds,
          combinedAmericanOdds: slip.combinedAmericanOdds,
          combinedModelProb: slip.combinedModelProb,
          combinedImpliedProb: slip.combinedImpliedProb,
          edge: slip.edge,
          ev: slip.ev,
        },
        units,
        kellyUnits,
        slipMin,
        slipMax,
        reasoning: null,
      })
    }
  }
  pushSlipsFor("SAFE", slipsByType.safe)
  pushSlipsFor("BALANCED", slipsByType.balanced)
  pushSlipsFor("AGGRESSIVE", slipsByType.aggressive)
  pushSlipsFor("LOTTO", slipsByType.lotto)

  // -------- Apply exposure controls (per-player cap + daily risk cap) --------
  const allEntries = [...singleEntries, ...slipEntries]
  const { entries: scaled, scalingPasses } = applyExposureControls(allEntries, {
    unitSize,
    playerCap,
    dailyRiskBudget,
  })

  // -------- Materialize final bet objects --------
  const bets = []
  const slipBets = []
  for (const e of scaled) {
    if (e.kind === "single") {
      const reasoning = singleBetReasoning(e.bet, e.units, e.kellyUnits)
      const decOdds = americanToDecimal(e.bet.oddsAmerican)
      const expectedReturn =
        decOdds != null ? round2(e.bet.modelProb * (decOdds - 1) * e.stake - (1 - e.bet.modelProb) * e.stake) : null
      bets.push({
        ...e.bet,
        units: e.units,
        stake: e.stake,
        expectedReturn,
        reasoning,
      })
    } else if (e.kind === "slip") {
      const reasoning = slipBetReasoning(e.bet, e.units)
      const stakePayout =
        Number.isFinite(e.bet.combinedDecimalOdds) && e.stake > 0
          ? round2(e.stake * (e.bet.combinedDecimalOdds - 1))
          : null
      const ev =
        e.bet.combinedDecimalOdds && e.bet.combinedModelProb
          ? round2(
              e.bet.combinedModelProb * (e.bet.combinedDecimalOdds - 1) * e.stake -
                (1 - e.bet.combinedModelProb) * e.stake
            )
          : null
      slipBets.push({
        ...e.bet,
        units: e.units,
        stake: e.stake,
        potentialPayout: stakePayout,
        expectedReturn: ev,
        reasoning,
      })
    }
  }

  // Sort outputs.
  bets.sort((a, b) => Number(b.units) - Number(a.units))
  slipBets.sort((a, b) => Number(b.units) - Number(a.units))

  // Totals.
  const singlesTotalStake = bets.reduce((a, b) => a + Number(b.stake || 0), 0)
  const slipsTotalStake = slipBets.reduce((a, b) => a + Number(b.stake || 0), 0)
  const totalRisk = round2(singlesTotalStake + slipsTotalStake)
  const riskUtilization = dailyRiskBudget > 0 ? round4(totalRisk / dailyRiskBudget) : 0
  const totalExpectedReturn = round2(
    bets.reduce((a, b) => a + Number(b.expectedReturn || 0), 0) +
      slipBets.reduce((a, b) => a + Number(b.expectedReturn || 0), 0)
  )

  // Per-player exposure summary (post-scaling).
  const playerExposure = {}
  for (const b of [...bets, ...slipBets]) {
    const k =
      b.player ||
      (Array.isArray(b.legs) && b.legs[0] ? `slip:${b.legs.map((l) => l.player).join("+")}` : `slip:${b.type}`)
    playerExposure[k] = round2((playerExposure[k] || 0) + Number(b.stake || 0))
  }

  return {
    bankroll: round2(bankroll),
    unitSize,
    dailyRiskBudget,
    playerCap,
    totalRisk,
    riskUtilization,
    totalExpectedReturn,
    streakAdjustment: streak,
    bets,
    slipBets,
    playerExposure,
    meta: {
      generatedAt,
      betCount: bets.length,
      slipCount: slipBets.length,
      scalingPasses,
      options: opts,
      tierUnitsRanges: {
        ELITE: tierUnitsRange("ELITE"),
        STRONG: tierUnitsRange("STRONG"),
        PLAYABLE: tierUnitsRange("PLAYABLE"),
        LOTTO: tierUnitsRange("LOTTO"),
      },
      slipUnitsRanges: {
        SAFE: slipUnitsRange("SAFE"),
        BALANCED: slipUnitsRange("BALANCED"),
        AGGRESSIVE: slipUnitsRange("AGGRESSIVE"),
        LOTTO: slipUnitsRange("LOTTO"),
      },
    },
  }
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

module.exports = {
  buildNbaBankrollPlan,
}
