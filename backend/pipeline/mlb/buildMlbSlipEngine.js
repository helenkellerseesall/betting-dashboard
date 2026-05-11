"use strict"

// ── FIX 4: AGGRESSIVE/LOTTO FREEZE ────────────────────────────────────────────
// Temporary gate: disabled until template enforcement + calibration verified
// healthy via runVerification.js. Set to false to re-enable.
// DO NOT delete — freeze mechanism must remain auditable and reversible.
const FREEZE_AGGRESSIVE_LOTTO = true

// ── FIX 5: FAMILY-LEVEL CALIBRATION COEFFICIENTS ─────────────────────────────
// Derived from 5-date MLB grading summaries (2026-05-05 → 2026-05-09).
// Formula: coefficient ≈ actual_win_rate / estimated_model_claimed_prob.
// Applied in buildSlipFromLegs() before multiplying individual modelProbs.
// Purpose: reduce compounded overestimation in combinedModelProb (was 3-8×).
// rawCombinedModelProb (pre-calibration) is preserved in slip output for auditability.
const FAMILY_CALIBRATION = {
  totalbases:  0.97,  // 56.3% actual — model well calibrated for this family
  hits:        0.80,  // 48.2% actual — model overestimates ~1.25×
  runs:        0.74,  // 42.8% actual — model overestimates ~1.35×
  rbis:        0.68,  // 36.6% actual — excluded from slips; coeff kept for individual bet CLV
  outs:        0.72,  // 38.5% actual — excluded from slips; coeff kept for individual bet CLV
  ks:          0.85,  // 46.7% actual — moderate calibration gap
  hr:          0.72,  // 37.5% actual — small sample (8 settled)
  hitsallowed: 0.82,  // conservative default; insufficient settled data
}
const CALIBRATION_DEFAULT = 0.82  // conservative fallback for unknown families

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function americanToDecimal(odds) {
  const o = toNum(odds)
  if (!Number.isFinite(o) || o === 0) return null
  if (o > 0) return 1 + o / 100
  return 1 + 100 / Math.abs(o)
}

function decimalToAmerican(decimalOdds) {
  const d = toNum(decimalOdds)
  if (!Number.isFinite(d) || d <= 1) return null
  // If d >= 2 => positive odds
  if (d >= 2) return Math.round((d - 1) * 100)
  // Otherwise negative odds
  return -Math.round(100 / (d - 1))
}

function combineAmericanOdds(legs) {
  const safeLegs = Array.isArray(legs) ? legs : []
  let dec = 1
  for (const leg of safeLegs) {
    const d = americanToDecimal(leg?.odds)
    if (!Number.isFinite(d)) return null
    dec *= d
  }
  const amer = decimalToAmerican(dec)
  return Number.isFinite(amer) ? amer : null
}

function normalizeLeg(row) {
  if (!row || typeof row !== "object") return null
  const player = String(row?.player || "").trim()
  const team = String(row?.team || "").trim()
  const propType = String(row?.propType || "").trim()
  const playType = String(row?.playType || "").trim()
  const odds = row?.odds ?? null
  const eventId = String(row?.eventId || "").trim() || null
  const predictedProbability = row?.predictedProbability ?? null
  if (!player || !team || !propType || odds == null || !playType) return null
  return { player, team, propType, odds, playType, eventId, predictedProbability }
}

function dedupePlayers(legs) {
  const out = []
  const seen = new Set()
  for (const leg of Array.isArray(legs) ? legs : []) {
    const k = String(leg?.player || "").toLowerCase().trim()
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(leg)
  }
  return out
}

function isTrueSafe(row) {
  const pred = toNum(row?.predictedProbability)
  const odds = toNum(row?.odds)
  if (!Number.isFinite(pred) || pred < 0.55) return false
  if (!Number.isFinite(odds) || odds > 300) return false
  return true
}

function canAddLeg(existingLegs, nextLeg) {
  if (!nextLeg) return false
  const playerKey = String(nextLeg.player || "").toLowerCase().trim()
  if (!playerKey) return false
  if (existingLegs.some((l) => String(l?.player || "").toLowerCase().trim() === playerKey)) return false

  const eid = String(nextLeg.eventId || "").trim()
  if (!eid) return true

  const sameEvent = existingLegs.filter((l) => String(l?.eventId || "").trim() === eid)
  if (!sameEvent.length) return true

  // Correlation rule:
  // Allow >1 same-game only when BOTH plays are value AND from same team.
  const nextIsValue = String(nextLeg.playType || "").toLowerCase() === "value"
  const nextTeam = String(nextLeg.team || "").trim().toLowerCase()
  for (const l of sameEvent) {
    const lIsValue = String(l?.playType || "").toLowerCase() === "value"
    const lTeam = String(l?.team || "").trim().toLowerCase()
    const okStack = nextIsValue && lIsValue && nextTeam && lTeam && nextTeam === lTeam
    if (!okStack) return false
  }
  return true
}

function pickFromLane(sourceRows, { max = 1, filterFn = null }, existingLegs) {
  const out = []
  const safeRows = Array.isArray(sourceRows) ? sourceRows : []
  for (const r of safeRows) {
    if (out.length >= max) break
    if (typeof filterFn === "function" && !filterFn(r)) continue
    const leg = normalizeLeg(r)
    if (!leg) continue
    if (!canAddLeg(existingLegs.concat(out), leg)) continue
    out.push(leg)
  }
  return out
}

function buildMlbSlipEngine(picks) {
  const safeCore = Array.isArray(picks?.safeCore) ? picks.safeCore : []
  const valueCore = Array.isArray(picks?.valueCore) ? picks.valueCore : []
  const powerCore = Array.isArray(picks?.powerCore) ? picks.powerCore : []

  // SAFE slip: only include truly safe bets.
  const safeLegs = pickFromLane(safeCore, { max: 2, filterFn: isTrueSafe }, [])

  // BALANCED slip: value → safe → power (value must be first priority).
  const balancedLegs = []
  balancedLegs.push(...pickFromLane(valueCore, { max: 1 }, balancedLegs))
  // Safe here means playType === "safe" (selector lane); true-safe filtering applies only to the SAFE slip.
  balancedLegs.push(...pickFromLane(safeCore, { max: 1 }, balancedLegs))
  balancedLegs.push(...pickFromLane(powerCore, { max: 1 }, balancedLegs))

  // UPSIDE slip: max 4 legs, must include at least 1 safe and 1 value, at most 2 boom.
  const upsideLegs = []
  upsideLegs.push(...pickFromLane(safeCore, { max: 1 }, upsideLegs))
  upsideLegs.push(...pickFromLane(valueCore, { max: 2 }, upsideLegs))
  upsideLegs.push(...pickFromLane(powerCore, { max: 2 }, upsideLegs))
  // Cap to 4 legs.
  let cappedUpside = upsideLegs.slice(0, 4)
  // Ensure at most 2 boom in upside (drop excess boom legs first).
  while (cappedUpside.filter((l) => String(l?.playType || "").toLowerCase() === "boom").length > 2) {
    const idx = cappedUpside.findIndex((l) => String(l?.playType || "").toLowerCase() === "boom")
    if (idx < 0) break
    cappedUpside = cappedUpside.slice(0, idx).concat(cappedUpside.slice(idx + 1))
  }
  // Ensure at least one value in upside if possible.
  if (!cappedUpside.some((l) => String(l?.playType || "").toLowerCase() === "value")) {
    const add = pickFromLane(valueCore, { max: 1 }, cappedUpside)
    if (add.length) cappedUpside = cappedUpside.concat(add).slice(0, 4)
  }
  // Ensure at least one true safe in upside if possible.
  if (!cappedUpside.some((l) => String(l?.playType || "").toLowerCase() === "safe")) {
    const add = pickFromLane(safeCore, { max: 1 }, cappedUpside)
    if (add.length) cappedUpside = cappedUpside.concat(add).slice(0, 4)
  }

  const slips = [
    {
      type: "safe",
      legs: safeLegs,
      combinedOdds: safeLegs.length >= 2 ? combineAmericanOdds(safeLegs) : null
    },
    {
      type: "balanced",
      legs: balancedLegs,
      combinedOdds: balancedLegs.length >= 2 ? combineAmericanOdds(balancedLegs) : null
    },
    {
      type: "upside",
      legs: cappedUpside,
      combinedOdds: cappedUpside.length >= 2 ? combineAmericanOdds(cappedUpside) : null
    }
  ]

  return slips
}



// ---- Execution slip composer (from best-bets plays; same correlation rules) ----
const STABLE_FAMILIES = new Set(["hits", "totalBases", "ks"])
const MIX_FAMILIES = new Set([
  "hits",
  "totalBases",
  "ks",
  "rbis",
  "runs",
  "outs",
  "hitsAllowed",
])

// ── FIX 3: BALANCED slip family exclusion list ─────────────────────────────────
// rbis  (36.6% win rate) and outs (38.5%) are structural losers inside slips.
// Both remain valid for individual bets and ladders — only excluded from slip assembly.
// Audit evidence: Session AF Slip Ecosystem Audit V1 (2026-05-10).
const BALANCED_FAMILIES = new Set(["hits", "totalBases", "ks", "runs", "hitsAllowed"])
const HR_FAMILY = "hr"
const ALT_LINE_FAMILIES = new Set(["hr", "totalBases", "ks", "rbis", "hits"])

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}
function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function legKey(p) {
  return `${(p.player || "").toLowerCase()}|${(p.eventId || "").toLowerCase()}|${p.statFamily}|${p.side}|${p.line}`
}

function dedupeByLegKey(plays) {
  const best = new Map()
  for (const p of plays) {
    const k = legKey(p)
    const prev = best.get(k)
    if (!prev) {
      best.set(k, p)
      continue
    }
    const a = Number(p.oddsAmerican)
    const b = Number(prev.oddsAmerican)
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      best.set(k, p)
    }
  }
  return Array.from(best.values())
}

function eventShareOk(legs, candidate, maxShare, targetLegs) {
  if (!legs.length) return true
  const counts = new Map()
  for (const l of legs) counts.set(l.eventId || "_", (counts.get(l.eventId || "_") || 0) + 1)
  const cBefore = counts.get(candidate.eventId || "_") || 0
  const target = Math.max(2, Number(targetLegs) || 2)
  const maxPerEvent = Math.max(1, Math.ceil(target * maxShare))
  return cBefore + 1 <= maxPerEvent
}

function playerEventTaken(legs, candidate) {
  for (const l of legs) {
    if (
      String(l.player || "").toLowerCase() === String(candidate.player || "").toLowerCase() &&
      String(l.eventId || "") === String(candidate.eventId || "")
    ) {
      return true
    }
  }
  return false
}

function conflictingSide(legs, candidate) {
  for (const l of legs) {
    if (
      String(l.player || "").toLowerCase() === String(candidate.player || "").toLowerCase() &&
      l.statFamily === candidate.statFamily &&
      l.side !== candidate.side
    ) {
      return true
    }
  }
  return false
}

function legSummary(p) {
  return {
    player: p.player,
    eventId: p.eventId || null,
    matchup: p.matchup || null,
    statFamily: p.statFamily,
    side: p.side,
    line: p.line,
    oddsAmerican: p.oddsAmerican,
    sportsbook: p.sportsbook || null,
    modelProb: p.modelProb,
    impliedProb: p.impliedProb,
    edge: p.edge,
    confidence: p.confidence,
    volatility: p.volatility,
    tier: p.tier,
    propType: p.propType || null,
    role: p.role || null,
    reasoning: p.reasoning || null,
  }
}

function buildSlipFromLegs(legs, label, reasoning) {
  if (!legs.length) return null
  const decimals = legs.map((l) => americanToDecimal(l.oddsAmerican)).filter((d) => Number.isFinite(d))
  if (decimals.length !== legs.length) return null
  const combinedDecimal = decimals.reduce((a, b) => a * b, 1)
  const combinedAmerican = decimalToAmerican(combinedDecimal)

  // FIX 5: Apply family-level calibration before multiplying leg probabilities.
  // Raw product overestimates joint win probability by 3-8× due to per-family model
  // miscalibration that compounds multiplicatively across legs.
  // rawCombinedModelProb preserved for auditing / diff against calibrated value.
  const rawCombinedModelProb = legs.reduce((p, l) => p * Number(l.modelProb || 0), 1)
  const combinedModelProb = legs.reduce((p, l) => {
    const fam = String(l.statFamily || "").toLowerCase()
    const coeff = FAMILY_CALIBRATION[fam] ?? CALIBRATION_DEFAULT
    const calibrated = Math.max(0.001, Math.min(0.999, Number(l.modelProb || 0) * coeff))
    return p * calibrated
  }, 1)

  const combinedImpliedProb = legs.reduce((p, l) => p * Number(l.impliedProb || 0), 1)
  const ev = combinedModelProb * (combinedDecimal - 1) - (1 - combinedModelProb)
  const expectedPayoutPer1 = combinedDecimal - 1
  return {
    type: label,
    legCount: legs.length,
    legs: legs.map(legSummary),
    combinedDecimalOdds: round4(combinedDecimal),
    combinedAmericanOdds: combinedAmerican,
    combinedModelProb: round4(combinedModelProb),
    rawCombinedModelProb: round4(rawCombinedModelProb),  // pre-calibration; auditable
    combinedImpliedProb: round4(combinedImpliedProb),
    edge: round4(combinedModelProb - combinedImpliedProb),
    ev: round4(ev),
    expectedPayoutPer1: round4(expectedPayoutPer1),
    reasoning,
  }
}

function pickLegsGreedy(pool, cfg) {
  const {
    targetLegs,
    minLegs,
    maxSameEventShare,
    playerUseCounts,
    diversityPenaltyPerUse,
  } = cfg
  const ranked = pool
    .map((p) => {
      const uses = playerUseCounts.get(String(p.player || "").toLowerCase()) || 0
      const diversityPenalty = uses * diversityPenaltyPerUse
      return { p, score: (Number(p.score) || 0) - diversityPenalty }
    })
    .sort((a, b) => b.score - a.score)

  const legs = []
  for (const { p } of ranked) {
    if (legs.length >= targetLegs) break
    if (playerEventTaken(legs, p)) continue
    if (conflictingSide(legs, p)) continue
    if (!eventShareOk(legs, p, maxSameEventShare, targetLegs)) continue
    legs.push(p)
  }
  if (legs.length < minLegs) return null
  return legs
}

function bumpPlayerUse(playerUseCounts, legs) {
  for (const l of legs) {
    const k = String(l.player || "").toLowerCase()
    playerUseCounts.set(k, (playerUseCounts.get(k) || 0) + 1)
  }
}

function poolByFilter(plays, predicate) {
  return dedupeByLegKey(plays.filter(predicate))
}

/**
 * SAFE — hits / total bases / pitcher Ks only. High prob, near-coin-flip prices.
 */
function buildSafeSlips({ pool, count, playerUseCounts, opts }) {
  const safePool = poolByFilter(
    pool,
    (p) =>
      STABLE_FAMILIES.has(p.statFamily) &&
      Number(p.modelProb || 0) >= 0.5 &&
      Number(p.modelProb || 0) <= 0.7 &&
      Number(p.confidence || 0) >= 0.4 &&
      Number(p.edge || 0) > 0 &&
      p.tier !== "FADE" &&
      !p.isLongshot &&
      !p.isAlternate &&
      Number.isFinite(p.oddsAmerican) &&
      p.oddsAmerican >= -300 &&
      p.oddsAmerican <= 200
  )
  return composeMany({
    pool: safePool,
    count,
    legSize: { target: 2, min: 2 },
    label: "SAFE",
    reasoning: "2-leg ticket; stable stats (hits / bases / Ks)",
    playerUseCounts,
    opts,
  })
}

// FIX 1+2+3: BALANCED rebuilt with hard template constraints.
// FIX 1 — legSize: hard max 3 legs (no alt: 4); decimalOddsRange [3.0, 8.0] enforced
//          on combined slip odds; maxPerGame=1 via maxSameEventShare: 0.30.
// FIX 2 — side: "under" only. Overs win at 34.3% in MLB; mixing in overs drags
//          joint probability below the independent math floor. SAFE and BALANCED
//          are under-only tiers. Overs remain valid in AGGRESSIVE/LOTTO (frozen).
// FIX 3 — BALANCED_FAMILIES excludes rbis (36.6% win rate) and outs (38.5%).
//          Remaining families: hits, totalBases, ks, runs, hitsAllowed.
function buildBalancedSlips({ pool, count, playerUseCounts, opts }) {
  const balPool = poolByFilter(
    pool,
    (p) =>
      BALANCED_FAMILIES.has(p.statFamily) &&     // FIX 3: rbis/outs excluded
      p.side === "under" &&                        // FIX 2: unders only
      Number(p.edge || 0) >= 0.03 &&
      Number(p.modelProb || 0) >= 0.45 &&
      !p.isLongshot &&
      !p.isAlternate &&
      Number.isFinite(p.oddsAmerican) &&
      p.oddsAmerican >= -300 &&
      p.oddsAmerican <= 200
  )
  return composeMany({
    pool: balPool,
    count,
    legSize: { target: 3, min: 2 },   // FIX 1: hard max 3; remove alt: 4; fallback to 2
    label: "BALANCED",
    reasoning: "2-3 leg under parlay; quality unders (hits/bases/ks/runs)",
    playerUseCounts,
    opts: { ...opts, maxSameEventShare: 0.30 },  // FIX 1: maxPerGame=1 for 3-leg slips
    maxCombinedDecimalOdds: 8.0,                 // FIX 1: decimalOddsRange ceiling
    minCombinedDecimalOdds: 3.0,                 // FIX 1: decimalOddsRange floor
  })
}

/**
 * AGGRESSIVE — 4-5 legs. Includes HR plays + alt lines. Per-leg odds capped.
 */
function buildAggressiveSlips({ corePool, altPool, count, playerUseCounts, opts }) {
  const merged = [
    ...corePool.filter(
      (p) =>
        ALT_LINE_FAMILIES.has(p.statFamily) &&
        (Number(p.edge || 0) >= 0.04 ||
          (Number(p.volatility || 0) >= 0.3 && Number(p.edge || 0) >= 0.02)) &&
        !p.isLongshot &&
        !p.isAlternate &&
        Number.isFinite(p.oddsAmerican) &&
        p.oddsAmerican >= -300 &&
        p.oddsAmerican <= 300
    ),
    ...altPool.filter(
      (p) =>
        ALT_LINE_FAMILIES.has(p.statFamily) &&
        Number(p.edge || 0) >= 0.04 &&
        Number(p.modelProb || 0) >= 0.4 &&
        Number.isFinite(p.oddsAmerican) &&
        p.oddsAmerican <= 300 &&
        p.oddsAmerican >= -200
    ),
  ]
  const aggPool = dedupeByLegKey(merged)
  return composeMany({
    pool: aggPool,
    count,
    legSize: { target: 4, min: 3, alt: 5 },
    label: "AGGRESSIVE",
    reasoning: "4-5 legs; HR + alt lines layered with edge plays",
    playerUseCounts,
    opts,
    maxCombinedDecimalOdds: 200,
  })
}

/**
 * LOTTO — 5-6 legs. Multi-HR / long-odds tickets. Per-leg odds cap +500.
 */
function buildLottoSlips({ corePool, altPool, longPool, count, playerUseCounts, opts }) {
  const merged = [...corePool, ...altPool, ...longPool].filter(
    (p) =>
      Number(p.edge || 0) > 0 &&
      Number(p.modelProb || 0) >= 0.18 &&
      Number.isFinite(p.oddsAmerican) &&
      p.oddsAmerican >= -150 &&
      p.oddsAmerican <= 500
  )
  // Encourage HR-heavy tickets by sorting HR plays first when scores tie.
  const lottoPool = dedupeByLegKey(merged).map((p) => ({
    ...p,
    score: (Number(p.score) || 0) + (p.statFamily === HR_FAMILY ? 0.4 : 0),
  }))
  return composeMany({
    pool: lottoPool,
    count,
    legSize: { target: 5, min: 4, alt: 6 },
    label: "LOTTO",
    reasoning: "5-6 legs; multi-HR / long-odds upside ticket",
    playerUseCounts,
    opts,
    maxCombinedDecimalOdds: 4000,
  })
}

function composeMany({
  pool,
  count,
  legSize,
  label,
  reasoning,
  playerUseCounts,
  opts,
  maxCombinedDecimalOdds = null,
  minCombinedDecimalOdds = null,  // FIX 1: decimalOddsRange floor enforcement
}) {
  const slips = []
  if (!pool.length) return slips
  const used = new Set()
  let dropped = 0  // FIX 1: track rejected slips for auditability

  for (let i = 0; i < count; i++) {
    // FIX 1: legSize.alt removed from BALANCED — only use legSize.target as the ceiling.
    // Other tiers (SAFE/AGGRESSIVE/LOTTO) retain their alt if present.
    let target = legSize.alt && i % 2 === 1 ? legSize.alt : legSize.target

    let slip = null
    while (target >= legSize.min && !slip) {
      const banned = new Set()
      let attempts = 0
      while (attempts < 6 && !slip) {
        attempts++
        const remaining = pool.filter((p) => !used.has(legKey(p)) && !banned.has(legKey(p)))
        if (remaining.length < target) break

        const legs = pickLegsGreedy(remaining, {
          targetLegs: target,
          minLegs: target,
          maxSameEventShare: opts.maxSameEventShare,
          playerUseCounts,
          diversityPenaltyPerUse: opts.diversityPenaltyPerUse,
        })
        if (!legs) break

        const candidate = buildSlipFromLegs(legs, label, reasoning)
        if (!candidate) break

        // FIX 1: Combined odds ceiling — reject slip and ban highest-odds leg, retry.
        if (
          maxCombinedDecimalOdds != null &&
          Number(candidate.combinedDecimalOdds) > maxCombinedDecimalOdds
        ) {
          const highest = legs.slice().sort((a, b) => Number(b.oddsAmerican) - Number(a.oddsAmerican))[0]
          banned.add(legKey(highest))
          dropped++
          continue
        }

        // FIX 1: Combined odds floor — if combined decimal < floor, the slip is
        // too chalky; decrement leg count and retry with a shorter parlay.
        if (
          minCombinedDecimalOdds != null &&
          Number(candidate.combinedDecimalOdds) < minCombinedDecimalOdds
        ) {
          dropped++
          break  // decrement target below
        }

        slip = candidate
      }
      if (!slip) target -= 1
    }

    if (!slip) continue
    slips.push(slip)
    bumpPlayerUse(playerUseCounts, slip.legs)
    for (const l of slip.legs) used.add(legKey(l))
  }

  // Attach dropped count for diagnostic visibility in meta
  if (dropped > 0) composeMany._lastDropped = (composeMany._lastDropped || 0) + dropped
  return slips
}

function buildMlbSlipComposer(input = {}) {
  const generatedAt = new Date().toISOString()
  const board = input?.bestBetsBoard || null
  const opts = {
    safeCount: input?.options?.safeCount ?? 4,
    balancedCount: input?.options?.balancedCount ?? 4,
    aggressiveCount: input?.options?.aggressiveCount ?? 3,
    lottoCount: input?.options?.lottoCount ?? 2,
    maxSameEventShare: input?.options?.maxSameEventShare ?? 0.6,
    diversityPenaltyPerUse: input?.options?.diversityPenaltyPerUse ?? 0.18,
  }
  if (!board || !Array.isArray(board.allPlays)) {
    return {
      slips: { safe: [], balanced: [], aggressive: [], lotto: [] },
      meta: { generatedAt, slipCount: 0, legPoolSize: 0, dropped: 0, reason: "no_board" },
    }
  }

  const corePool = board.allPlays.slice()
  const altPool = Array.isArray(board.altPlays) ? board.altPlays.slice() : []
  const longPool = Array.isArray(board.longshotPlays) ? board.longshotPlays.slice() : []

  composeMany._lastDropped = 0  // reset dropped counter for this run

  const playerUseCounts = new Map()
  const safe = buildSafeSlips({ pool: corePool, count: opts.safeCount, playerUseCounts, opts })
  const balanced = buildBalancedSlips({
    pool: corePool,
    count: opts.balancedCount,
    playerUseCounts,
    opts,
  })

  // FIX 4: AGGRESSIVE/LOTTO freeze — disabled until template enforcement verified.
  // Frozen tiers return empty arrays and are flagged in meta for observability.
  // To re-enable: set FREEZE_AGGRESSIVE_LOTTO = false at top of file.
  const aggressive = FREEZE_AGGRESSIVE_LOTTO ? [] : buildAggressiveSlips({
    corePool,
    altPool,
    count: opts.aggressiveCount,
    playerUseCounts,
    opts,
  })
  const lotto = FREEZE_AGGRESSIVE_LOTTO ? [] : buildLottoSlips({
    corePool,
    altPool,
    longPool,
    count: opts.lottoCount,
    playerUseCounts,
    opts,
  })

  const slipCount = safe.length + balanced.length + aggressive.length + lotto.length
  return {
    slips: { safe, balanced, aggressive, lotto },
    meta: {
      generatedAt,
      slipCount,
      corePoolSize: corePool.length,
      altPoolSize: altPool.length,
      longPoolSize: longPool.length,
      frozenTiers: FREEZE_AGGRESSIVE_LOTTO ? ["aggressive", "lotto"] : [],  // FIX 4: observable
      droppedSlips: composeMany._lastDropped || 0,                           // FIX 1: observable
      options: opts,
    },
  }
}

module.exports = {
  buildMlbSlipComposer,
}

module.exports = { buildMlbSlipEngine, buildMlbSlipComposer }


