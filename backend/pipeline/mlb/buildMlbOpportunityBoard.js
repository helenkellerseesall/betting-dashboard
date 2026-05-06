"use strict"

const normalizeName = require("../../utils/normalizeName")
const { buildMlbPlayerOutcomePredictions, mergeHrSourceIndex } = require("./buildMlbPlayerDataset")
const { buildMlbBestBetsBoard, marketPropsFromMlbRows } = require("./buildMlbPropClusters")
const { buildMlbSlipComposer } = require("./buildMlbSlipEngine")
const {
  persistTrackedToday,
  buildMlbTrackingSummary,
  pruneOldTrackingFilesAsync,
} = require("./phase4Tracking")
const {
  buildLineShopping,
  buildLadderShopping,
  loadBookState,
} = require("../shared/buildLineShoppingIntelligence")
const {
  buildMarketTiming,
  enrichRowsWithTiming,
  loadTimingState,
} = require("../shared/buildMarketTimingIntelligence")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function clampStr(v) {
  const s = norm(v)
  return s ? s : null
}

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function buildMlbOpportunityBoard(input = {}) {
  const hrPredictionToday = input?.hrPredictionToday && typeof input.hrPredictionToday === "object" ? input.hrPredictionToday : {}
  const pitcherKsToday = input?.pitcherKsToday && typeof input.pitcherKsToday === "object" ? input.pitcherKsToday : {}
  const playerMap = input?.playerMap instanceof Map ? input.playerMap : null
  const rows = Array.isArray(input?.rows) ? input.rows : []

  // Thresholds (explicit from user request)
  const TH = {
    hr: 0.15,
    hit1: 0.65,
    hit2: 0.40,
    rbi1: 0.22,
    rbi2: 0.14,
    ks: 0.50,
  }

  // Fallback team/opponent mapping from snapshot rows.
  const playerMeta = new Map()
  for (const r of rows) {
    const key = normalizeName(r?.player)
    if (!key) continue
    if (!playerMeta.has(key)) {
      playerMeta.set(key, {
        team: clampStr(r?.teamResolved ?? r?.team),
        opponent: clampStr(r?.opponentTeam),
        eventId: clampStr(r?.eventId),
      })
    }
  }

  function fallbackMeta(playerName) {
    const key = normalizeName(playerName)
    if (!key) return {}
    return playerMeta.get(key) || {}
  }

  // ------------------------
  // HR candidates
  // ------------------------
  const hrSrc = []
  if (Array.isArray(hrPredictionToday?.topHrCandidatesToday)) hrSrc.push(...hrPredictionToday.topHrCandidatesToday)
  if (Array.isArray(hrPredictionToday?.mostLikelyHr)) hrSrc.push(...hrPredictionToday.mostLikelyHr)

  const hrCandidates = []
  const seenHr = new Set()
  for (const p of hrSrc) {
    const player = clampStr(p?.player)
    if (!player) continue
    const key = `${player}__${clampStr(p?.eventId) || ""}__${clampStr(p?.odds) || ""}`
    if (seenHr.has(key)) continue
    seenHr.add(key)

    const prob = toNum(p?.modelProbability)
    if (!Number.isFinite(prob) || prob < TH.hr) continue
    const fb = fallbackMeta(player)

    hrCandidates.push({
      player,
      team: clampStr(p?.team) ?? fb.team ?? null,
      opponent: clampStr(p?.opponent ?? p?.opponentTeam) ?? fb.opponent ?? null,
      eventId: clampStr(p?.eventId) ?? fb.eventId ?? null,
      propType: "HR",
      ladder: "HR",
      probability: prob,
      edge: toNum(p?.edge),
    })
  }

  // Best HR row per normalized player (same merge as outcome projections — no drift vs hrIdx).
  const hrByPlayer = new Map()
  for (const [nk, info] of mergeHrSourceIndex(hrSrc)) {
    const prob = toNum(info?.prob)
    if (!Number.isFinite(prob) || prob < TH.hr) continue
    const display = clampStr(info?.player) || null
    const fb = display ? fallbackMeta(display) : {}
    hrByPlayer.set(nk, {
      player: display,
      probability: prob,
      edge: toNum(info?.edge),
      tag: info?.tag ?? null,
      hybridScore: toNum(info?.hybridScore),
    })
  }

  // ------------------------
  // Hits / RBI (from shared player objects)
  // ------------------------
  const hit1plusCandidates = []
  const hit2plusCandidates = []
  const rbi1plusCandidates = []
  const rbi2plusCandidates = []
  const rbi1All = []
  const rbi2All = []
  const tbCandidates = []
  const hrrbiCandidates = []
  const xbhCandidates = []

  if (playerMap) {
    for (const obj of playerMap.values()) {
      const player = clampStr(obj?.player)
      if (!player) continue
      const fb = fallbackMeta(player)

      const team = clampStr(obj?.team) ?? fb.team ?? null
      const opponent = clampStr(obj?.opponent ?? obj?.opponentTeam) ?? fb.opponent ?? null
      const eventId = clampStr(obj?.eventId) ?? fb.eventId ?? null

      const h1 = toNum(obj?.hit1plus)
      const h2 = toNum(obj?.hit2plus)
      const he = toNum(obj?.hitEdge ?? obj?.edge)

      if (Number.isFinite(h1) && h1 >= TH.hit1) {
        hit1plusCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "Hits",
          ladder: "1+ Hits",
          probability: h1,
          edge: he,
        })
      }
      if (Number.isFinite(h2) && h2 >= TH.hit2) {
        hit2plusCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "Hits",
          ladder: "2+ Hits",
          probability: h2,
          edge: he,
        })
      }

      const r1 = toNum(obj?.rbi1plus)
      const r2 = toNum(obj?.rbi2plus)
      const re = toNum(obj?.rbiEdge ?? obj?.edge)
      const rbiBase = {
        player,
        team,
        opponent,
        eventId,
        propType: "RBIs",
        edge: re,
      }

      if (Number.isFinite(r1) && r1 >= TH.rbi1) {
        rbi1plusCandidates.push({
          ...rbiBase,
          ladder: "1+ RBI",
          probability: r1,
        })
      }
      if (Number.isFinite(r1)) {
        rbi1All.push({
          ...rbiBase,
          ladder: "1+ RBI",
          probability: r1,
        })
      }
      if (Number.isFinite(r2) && r2 >= TH.rbi2) {
        rbi2plusCandidates.push({
          ...rbiBase,
          ladder: "2+ RBI",
          probability: r2,
        })
      }
      if (Number.isFinite(r2)) {
        rbi2All.push({
          ...rbiBase,
          ladder: "2+ RBI",
          probability: r2,
        })
      }

      // ------------------------
      // ADDITIVE ADVANCED PROPS
      // ------------------------
      const hrMeta = hrByPlayer.get(normalizeName(player)) || {}
      const hrProb = toNum(hrMeta?.probability) ?? 0
      const hrEdge = toNum(hrMeta?.edge) ?? 0
      const power = toNum(obj?.powerScore)
      const powerNorm = Number.isFinite(power) ? clamp01((power - 8) / 24) : 0.35
      const bo = toNum(obj?.battingOrderIndex) ?? toNum(obj?.lineupPosition)
      const lineupBoost = Number.isFinite(bo) ? (bo <= 4 ? 0.04 : bo <= 6 ? 0.015 : -0.02) : 0

      // TOTAL BASES from hits ladder + HR proxy + power profile.
      const tb2 = clamp01((toNum(h2) ?? 0) * 0.62 + hrProb * 0.25 + (toNum(h1) ?? 0) * 0.13 + powerNorm * 0.05)
      const tb3 = clamp01((toNum(h2) ?? 0) * 0.45 + hrProb * 0.35 + (toNum(obj?.hit3plus) ?? 0) * 0.20 + powerNorm * 0.06)
      const tb4 = clamp01(hrProb * 0.58 + (toNum(h2) ?? 0) * 0.22 + (toNum(obj?.hit3plus) ?? 0) * 0.10 + powerNorm * 0.10)
      const tbEdge = Number.isFinite(he) ? he * 0.7 + hrEdge * 0.3 : hrEdge
      if (tb2 >= 0.35) {
        tbCandidates.push({ player, team, opponent, eventId, propType: "Total Bases", ladder: "2+ TB", probability: tb2, edge: tbEdge })
      }
      if (tb3 >= 0.20) {
        tbCandidates.push({ player, team, opponent, eventId, propType: "Total Bases", ladder: "3+ TB", probability: tb3, edge: tbEdge })
      }
      if (tb4 >= 0.12) {
        tbCandidates.push({ player, team, opponent, eventId, propType: "Total Bases", ladder: "4+ TB", probability: tb4, edge: tbEdge })
      }

      // H+R+RBI from hits + RBI + lineup adjustment.
      const hrrbi2 = clamp01((toNum(h1) ?? 0) * 0.57 + (toNum(r1) ?? 0) * 0.43 + lineupBoost)
      const hrrbi3 = clamp01((toNum(h1) ?? 0) * 0.46 + (toNum(r1) ?? 0) * 0.54 + lineupBoost - 0.10)
      const hrriEdge = (Number.isFinite(he) ? he : 0) * 0.55 + (Number.isFinite(re) ? re : 0) * 0.45
      if (hrrbi2 >= 0.40) {
        hrrbiCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "H+R+RBI",
          ladder: "2+ H+R+RBI",
          probability: hrrbi2,
          edge: hrriEdge,
        })
      }
      if (hrrbi3 >= 0.22) {
        hrrbiCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "H+R+RBI",
          ladder: "3+ H+R+RBI",
          probability: hrrbi3,
          edge: hrriEdge,
        })
      }

      // XBH proxy from HR + multi-hit + power.
      const xbh1 = clamp01(hrProb * 0.50 + (toNum(h2) ?? 0) * 0.35 + powerNorm * 0.15)
      const xbhEdge = hrEdge * 0.6 + (Number.isFinite(he) ? he * 0.4 : 0)
      if (xbh1 >= 0.20) {
        xbhCandidates.push({
          player,
          team,
          opponent,
          eventId,
          propType: "XBH",
          ladder: "1+ XBH",
          probability: xbh1,
          edge: xbhEdge,
        })
      }
    }
  }

  // RBI pool guardrails for full-slate coverage (display-layer only):
  // target roughly 10-20 for 1+ and 5-10 for 2+.
  function sortByProbEdge(a, b) {
    const bp = toNum(b?.probability) ?? -1
    const ap = toNum(a?.probability) ?? -1
    if (bp !== ap) return bp - ap
    return (toNum(b?.edge) ?? -999) - (toNum(a?.edge) ?? -999)
  }

  if (rbi1plusCandidates.length < 10) {
    const used = new Set(rbi1plusCandidates.map((x) => `${x.player}__${x.eventId || ""}`))
    const fill = [...rbi1All]
      .filter((x) => !used.has(`${x.player}__${x.eventId || ""}`))
      .sort(sortByProbEdge)
      .slice(0, Math.max(0, 10 - rbi1plusCandidates.length))
    rbi1plusCandidates.push(...fill)
  }

  if (rbi2plusCandidates.length < 5) {
    const used = new Set(rbi2plusCandidates.map((x) => `${x.player}__${x.eventId || ""}`))
    const fill = [...rbi2All]
      .filter((x) => !used.has(`${x.player}__${x.eventId || ""}`))
      .sort(sortByProbEdge)
      .slice(0, Math.max(0, 5 - rbi2plusCandidates.length))
    rbi2plusCandidates.push(...fill)
  }

  // ------------------------
  // Ks candidates (ladder options, not just market line)
  // ------------------------
  const ksSrc = Array.isArray(pitcherKsToday?.topPitchers) ? pitcherKsToday.topPitchers : []
  const ksCandidates = []
  const seenKs = new Set()
  for (const p of ksSrc) {
    const player = clampStr(p?.player)
    if (!player) continue
    const fb = fallbackMeta(player)
    const team = clampStr(p?.team) ?? fb.team ?? null
    const opponent = clampStr(p?.opponent) ?? fb.opponent ?? null
    const edge = toNum(p?.edge)

    const ladders = [
      { ladder: "4+ Ks", prob: toNum(p?.k4plus) ?? toNum(p?.k4) ?? toNum(p?.ladder?.["4+"]) },
      { ladder: "5+ Ks", prob: toNum(p?.k5plus) ?? toNum(p?.k5) ?? toNum(p?.ladder?.["5+"]) },
      { ladder: "6+ Ks", prob: toNum(p?.k6plus) ?? toNum(p?.k6) ?? toNum(p?.ladder?.["6+"]) },
      { ladder: "7+ Ks", prob: toNum(p?.k7plus) ?? toNum(p?.k7) ?? toNum(p?.ladder?.["7+"]) },
    ]

    for (const l of ladders) {
      if (!Number.isFinite(l.prob) || l.prob < TH.ks) continue
      const key = `${player}__${l.ladder}`
      if (seenKs.has(key)) continue
      seenKs.add(key)
      ksCandidates.push({
        player,
        team,
        opponent,
        eventId: clampStr(p?.eventId) ?? fb.eventId ?? null,
        propType: "Ks",
        ladder: l.ladder,
        probability: l.prob,
        edge,
      })
    }
  }

  // ------------------------
  // FULL BETTING ENGINE (mirrors NBA architecture)
  //   1. predictions: floor / median / ceiling per stat per player
  //   2. bestBetsBoard: edge + EV + tier (ELITE/STRONG/PLAYABLE/FADE)
  //      + corePlays / valuePlays / upsidePlays / fades
  //   3. slips: SAFE / BALANCED / AGGRESSIVE / LOTTO
  //   4. bankroll: Kelly + tier sizing + per-player + daily caps
  //   5. tracking: rolling 14-day window, lightweight feedback multipliers
  // Tracking + bankroll never throw — guarded so they cannot break the board.
  // ------------------------
  const playerOutcomePredictions = buildMlbPlayerOutcomePredictions({
    playerMap,
    hrPredictionToday,
    pitcherKsToday,
    rows,
  })

  const marketProps = marketPropsFromMlbRows(rows)
  const bestBetsBoard = buildMlbBestBetsBoard({
    predictions: playerOutcomePredictions,
    marketProps,
  })

  const slipPack = buildMlbSlipComposer({ bestBetsBoard })
  bestBetsBoard.slips = slipPack.slips
  bestBetsBoard.slipsMeta = slipPack.meta

  const bankrollInput = input?.bankroll
  if (bankrollInput && Number(bankrollInput) > 0) {
    bestBetsBoard.bankroll = buildMlbBankrollPlan({
      bestBetsBoard,
      bankroll: Number(bankrollInput),
      options: input?.bankrollOptions || {},
    })
  } else {
    bestBetsBoard.bankroll = null
  }

  try {
    persistTrackedToday({ bestBetsBoard })
    bestBetsBoard.trackingSummary = buildMlbTrackingSummary({ windowDays: 14 })
    pruneOldTrackingFilesAsync({ keepDays: 14 })
  } catch (err) {
    bestBetsBoard.trackingSummary = {
      metadata: { error: String(err?.message || err), version: "mlb-tracking-v1" },
      bets: { total: 0 },
      slips: { total: 0 },
      confidenceAdjustments: { byStat: {}, byTier: {} },
    }
  }

  return {
    hrCandidates,
    hit1plusCandidates,
    hit2plusCandidates,
    rbi1plusCandidates,
    rbi2plusCandidates,
    ksCandidates,
    tbCandidates,
    hrrbiCandidates,
    xbhCandidates,
    playerOutcomePredictions,
    bestBetsBoard,
  }
}



// ---- Bankroll sizing (execution layer; lives with opportunity board) ----
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
function buildMlbBankrollPlan(input = {}) {
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
  // Bankroll considers at most the top 30 plays by score — beyond that the
  // daily-risk cap would scale every stake to ~0 and drop everything anyway.
  const maxSingles = num(input?.options?.maxSingleBets) ?? 30
  const singleSource = Array.from(singleSourceMap.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, maxSingles)

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

  // ── Line Shopping + Timing (non-blocking, best-effort) ───────────────────
  let lineShopping  = null
  let ladderShopping = null
  let timingResult  = null
  try {
    const bookState   = loadBookState()
    const timingState = loadTimingState()
    lineShopping  = buildLineShopping(rows, { sport: "mlb", bookState })
    ladderShopping = buildLadderShopping(rows)
    timingResult  = buildMarketTiming(rows, { lineShopping, timingState, bookState })

    // Annotate top bets with urgency tags
    const urgencyMap = new Map()
    for (const tc of timingResult.timingClassifications) {
      urgencyMap.set(tc.key, { urgency: tc.urgency, state: tc.state, signals: tc.signals })
    }
    for (const b of bets) {
      const k = [
        String(b.eventId || ""),
        String(b.player || "").toLowerCase().trim(),
        String(b.statFamily || "").toLowerCase(),
        String(b.side || "").toLowerCase(),
        String(b.line ?? "any"),
      ].join("|")
      const tc = urgencyMap.get(k)
      if (tc) b.timingUrgency = tc
    }
  } catch (_) { /* never break board on shopping/timing errors */ }

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
    lineShopping,
    ladderShopping,
    timingResult,
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

module.exports = { buildMlbOpportunityBoard }


