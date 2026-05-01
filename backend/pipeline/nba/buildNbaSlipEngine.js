"use strict"

const { nbaRowModelProbabilityCore, nbaRowEdge } = require("./nbaModelSignals")

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

function clamp01(v) {
  return clamp(0.001, 0.999, v)
}

function normalizePlayerKey(row) {
  return String(row?.player || row?.playerName || "").trim().toLowerCase()
}

function normalizeMatchupKey(row) {
  return String(row?.matchup || row?.eventId || "").trim()
}

function normalizePropTypeKey(row) {
  const rawPropType = String(row?.propType || row?.statType || "").trim().toLowerCase()
  const rawMarketKey = String(row?.marketKey || "").trim().toLowerCase()
  const s = `${rawPropType} ${rawMarketKey}`.trim()

  // Canonical stat buckets (used for weighting + soft reuse penalties).
  if (s.includes("points_rebounds_assists") || s.includes("pra") || (s.includes("points") && s.includes("rebounds") && s.includes("assists"))) {
    return "pra"
  }
  if (s.includes("player_points_rebounds") || (s.includes("points") && s.includes("rebounds") && !s.includes("assists"))) return "combo"
  if (s.includes("player_points_assists") || (s.includes("points") && s.includes("assists") && !s.includes("rebounds"))) return "combo"
  if (s.includes("player_rebounds_assists") || (s.includes("rebounds") && s.includes("assists") && !s.includes("points"))) return "combo"
  if (s.includes("combo")) return "combo"

  if (s.includes("rebounds")) return "rebounds"
  if (s.includes("assists")) return "assists"
  if (s.includes("threes") || s.includes("three")) return "threes"
  if (s.includes("points")) return "points"

  if (s.includes("double double") || s.includes("triple double")) return "special"
  if (s.includes("first basket")) return s.includes("team") ? "first_team_basket" : "first_basket"

  return rawPropType || rawMarketKey || "other"
}

function isFirstBasketPlayerRow(row) {
  const pt = String(row?.propType || "").toLowerCase()
  return pt.includes("first basket") && !pt.includes("team")
}

function isFirstTeamBasketPlayerRow(row) {
  const pt = String(row?.propType || "").toLowerCase()
  return pt.includes("first team basket") || (pt.includes("team") && pt.includes("first") && pt.includes("basket"))
}

function isLadderLike(row) {
  const pv = String(row?.propVariant || "").toLowerCase()
  const mk = String(row?.marketKey || "").toLowerCase()
  const pt = String(row?.propType || "").toLowerCase()
  return pv.includes("alt") || mk.includes("alternate") || mk.includes("_alt") || pt.includes("ladder")
}

function isBigLike(row) {
  const pos = String(row?.position || row?.playerPosition || row?.depthPosition || "").toUpperCase()
  if (/\bC\b/.test(pos) || /\bPF\b/.test(pos)) return true
  const height = toNum(row?.heightInches) ?? toNum(row?.height)
  if (Number.isFinite(height) && height >= 81) return true
  const rebRate = toNum(row?.reboundRate) ?? toNum(row?.rebRate) ?? toNum(row?.reboundPct)
  if (Number.isFinite(rebRate) && rebRate >= 0.16) return true
  return false
}

function isGuardLike(row) {
  const pos = String(row?.position || row?.playerPosition || row?.depthPosition || "").toUpperCase()
  if (/\bPG\b/.test(pos) || /\bSG\b/.test(pos) || /\bG\b/.test(pos)) return true
  const height = toNum(row?.heightInches) ?? toNum(row?.height)
  if (Number.isFinite(height) && height <= 77) return true
  const rebRate = toNum(row?.reboundRate) ?? toNum(row?.rebRate) ?? toNum(row?.reboundPct)
  if (Number.isFinite(rebRate) && rebRate <= 0.10) return true
  return false
}

function readReboundRate(row) {
  const r = toNum(row?.reboundRate) ?? toNum(row?.rebRate) ?? toNum(row?.reboundPct)
  return Number.isFinite(r) ? r : null
}

function readThreePA(row) {
  const a =
    toNum(row?.threePA) ??
    toNum(row?.threePointAttempts) ??
    toNum(row?.threesAttempted) ??
    toNum(row?.tpa) ??
    toNum(row?.threeAttemptRate)
  return Number.isFinite(a) ? a : null
}

function readAssistRate(row) {
  const a = toNum(row?.assistRate) ?? toNum(row?.astRate) ?? toNum(row?.assistPct)
  return Number.isFinite(a) ? a : null
}

function readUsage(row) {
  const u =
    toNum(row?.usageRate) ??
    toNum(row?.playerUsage) ??
    toNum(row?.usage) ??
    toNum(row?.roleUsagePct)
  return Number.isFinite(u) ? u : 20
}

function readGameEnv(row) {
  const g = toNum(row?.gamePriorityScore) ?? toNum(row?.matchupEdgeScore) ?? 0
  return Number.isFinite(g) ? g : 0
}

function readMinutes(row) {
  const m =
    toNum(row?.projectedMinutes) ??
    toNum(row?.minutesProjection) ??
    toNum(row?.minutes) ??
    toNum(row?.expectedMinutes)
  return Number.isFinite(m) ? m : null
}

function rowProb(row) {
  const p = nbaRowModelProbabilityCore(row)
  return Number.isFinite(p) ? clamp01(p) : null
}

function rowEdge(row) {
  const e = nbaRowEdge(row)
  return Number.isFinite(e) ? e : null
}

function buildCandidate(row) {
  if (!row || typeof row !== "object") return null
  const player = String(row?.player || "").trim()
  const matchup = String(row?.matchup || "").trim()
  const propType = String(row?.propType || row?.marketKey || "").trim()
  if (!player || !matchup || !propType) return null

  const probability = rowProb(row)
  const edge = rowEdge(row)
  const usage = readUsage(row)
  const env = readGameEnv(row)
  const minutes = readMinutes(row)

  return {
    row,
    playerKey: normalizePlayerKey(row),
    matchupKey: matchup,
    propTypeKey: normalizePropTypeKey(row),
    isLadder: isLadderLike(row),
    isFirstBasket: isFirstBasketPlayerRow(row),
    isFirstTeamBasket: isFirstTeamBasketPlayerRow(row),
    probability,
    edge,
    usage,
    env,
    minutes,
  }
}

function weightedPickIndex(items, weightFn) {
  if (!Array.isArray(items) || !items.length) return -1
  let total = 0
  const weights = new Array(items.length)
  for (let i = 0; i < items.length; i += 1) {
    const w = Math.max(0, Number(weightFn(items[i], i)) || 0)
    weights[i] = w
    total += w
  }
  if (!Number.isFinite(total) || total <= 0) return -1
  let r = Math.random() * total
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return items.length - 1
}

function buildFirstBasketPerGame(firstBasketBoard) {
  const rows = Array.isArray(firstBasketBoard) ? firstBasketBoard : []
  const byGame = new Map()
  for (const r of rows) {
    if (!r) continue
    if (!isFirstBasketPlayerRow(r) && !isFirstTeamBasketPlayerRow(r)) continue
    const matchup = normalizeMatchupKey(r)
    if (!matchup) continue
    if (!byGame.has(matchup)) byGame.set(matchup, [])
    byGame.get(matchup).push(r)
  }

  const topPerGame = []
  for (const [matchup, gameRows] of byGame.entries()) {
    const scored = [...gameRows]
      .map((r) => {
        const p = rowProb(r) ?? 0
        const e = Math.max(0, rowEdge(r) ?? 0)
        const u = readUsage(r)
        const score = p * 1.2 + e * 2.2 + (u / 40) * 0.6
        return { row: r, score }
      })
      .sort((a, b) => b.score - a.score)

    if (scored.length) {
      topPerGame.push({
        matchup,
        row: scored[0].row,
        score: scored[0].score,
      })
    }
  }

  topPerGame.sort((a, b) => b.score - a.score)
  return topPerGame
}

function buildNbaSlipBundles({ completeUniverse, firstBasketBoard } = {}) {
  const universe = Array.isArray(completeUniverse) ? completeUniverse : []

  // Candidate ecosystem (full slate): build enriched candidates for *every* row.
  const baseCandidates = universe.map(buildCandidate).filter(Boolean)

  const byGame = new Map()
  for (const c of baseCandidates) {
    const matchup = c.matchupKey
    if (!byGame.has(matchup)) byGame.set(matchup, [])
    byGame.get(matchup).push(c)
  }

  const firstBasketPerGame = buildFirstBasketPerGame(firstBasketBoard)

  const buildVariants = [
    { key: "balanced", label: "Balanced explorer", knobs: { prob: 1.0, edge: 1.0, env: 1.0, usage: 1.0, ladder: 1.0 } },
    { key: "prob", label: "Probability-heavy", knobs: { prob: 1.25, edge: 0.85, env: 0.95, usage: 0.95, ladder: 1.0 } },
    { key: "edge", label: "Edge-heavy", knobs: { prob: 0.95, edge: 1.35, env: 0.95, usage: 1.0, ladder: 1.0 } },
    { key: "env", label: "Game-env lean", knobs: { prob: 0.95, edge: 1.0, env: 1.35, usage: 1.0, ladder: 1.0 } },
    { key: "usage", label: "Usage lean", knobs: { prob: 0.95, edge: 1.0, env: 1.0, usage: 1.35, ladder: 1.0 } },
    { key: "ladder", label: "Ladder-lean", knobs: { prob: 0.95, edge: 1.0, env: 1.0, usage: 1.0, ladder: 1.25 } },
  ]

  // Portfolio-level soft reuse penalties (prevents the same players dominating every slip
  // without imposing hard caps).
  const portfolioPlayerUse = new Map()
  const portfolioPropUse = new Map()
  const portfolioGameUse = new Map()

  const buildSlip = (variant, legCount) => {
    const chosen = []
    const usedKeys = new Set()
    const slipPlayerUse = new Map()
    const slipPropUse = new Map()
    const slipGameUse = new Map()

    const canAdd = (c) => {
      if (!c || !c.row) return false
      const key = [
        c.playerKey,
        String(c.row?.propType || ""),
        String(c.row?.side || ""),
        String(c.row?.line ?? ""),
        String(c.row?.propVariant || "base"),
        c.matchupKey,
      ].join("|")
      if (usedKeys.has(key)) return false
      return true
    }

    const softPenalty = (count, strength = 0.35) => {
      const c = Number(count || 0)
      if (!Number.isFinite(c) || c <= 0) return 1
      // 1/(1 + strength*count) -> smooth decay
      return 1 / (1 + strength * c)
    }

    const weight = (c) => {
      const p = Number.isFinite(c.probability) ? c.probability : 0.5
      const rawEdge = Number.isFinite(c.edge) ? c.edge : 0
      const usage = Number.isFinite(c.usage) ? c.usage : 20
      const env = Number.isFinite(c.env) ? c.env : 0

      // Edge influence cap (selection weighting only; does not change edge engine / math).
      // Clamp positive edge contribution, especially for ladder + low-line spam.
      const lineN = Number(c.row?.line)
      const isLowLine = Number.isFinite(lineN) ? lineN <= 3.5 : false
      const edgeCap = c.isLadder && isLowLine ? 0.10 : 0.15
      const edgeTerm = clamp(-0.06, edgeCap, rawEdge)
      const ladderMult = c.isLadder ? 1.10 : 1

      // Make realism the primary driver:
      // finalWeight = realismScore^1.5 * (0.45*p + 0.55*edgeTerm)  (plus soft portfolio penalties below).
      const blend = Math.max(0.001, (0.45 * p) + (0.55 * edgeTerm))
      const base =
        (blend * 100 * variant.knobs.prob) +
        (env * 0.12 * variant.knobs.env)

      const slipPlayerPenalty = softPenalty(slipPlayerUse.get(c.playerKey) || 0, 0.75)
      const slipPropPenalty = softPenalty(slipPropUse.get(c.propTypeKey) || 0, 0.35)
      const slipGamePenalty = softPenalty(slipGameUse.get(c.matchupKey) || 0, 0.30)

      const portfolioPlayerPenalty = softPenalty(portfolioPlayerUse.get(c.playerKey) || 0, 0.55)
      const portfolioPropPenalty = softPenalty(portfolioPropUse.get(c.propTypeKey) || 0, 0.20)
      const portfolioGamePenalty = softPenalty(portfolioGameUse.get(c.matchupKey) || 0, 0.20)

      const w =
        Math.max(0.001, base) *
        ladderMult *
        (c.isLadder ? variant.knobs.ladder : 1) *
        slipPlayerPenalty *
        slipPropPenalty *
        slipGamePenalty *
        portfolioPlayerPenalty *
        portfolioPropPenalty *
        portfolioGamePenalty

      // Bench/minutes soft suppression (not a hard filter).
      const minutes = Number.isFinite(c.minutes) ? c.minutes : null
      const minutesPenalty = minutes != null ? clamp(0.65, 1.05, (minutes / 28)) : 0.92

      // === Realism layer (bias, not rules) ===
      // Goal: preserve exploration but favor real NBA contributors (usage/minutes/role)
      // and suppress "low-line spam" unless supported by edge + role.
      const usageFactor = clamp(0.84, 1.35, 0.92 + ((usage - 20) / 18) * 0.24)
      const minutesFactor = (() => {
        if (minutes == null) return 0.95
        if (minutes < 16) return 0.70
        if (minutes < 20) return 0.80
        if (minutes < 24) return 0.90
        if (minutes <= 35) return 1.08
        return 0.98
      })()

      const propKey = String(c.propTypeKey || "")
      const isBallHandlerish = propKey === "assists" || propKey === "pra"
      const isScoringish = propKey === "points" || propKey === "threes"
      const roleFactor = (() => {
        // Usage proxy is the main role driver; assists/PRA get a slight extra bump for handlers.
        const baseRole = clamp(0.82, 1.28, 0.90 + ((usage - 18) / 20) * 0.26)
        const handlerBump = isBallHandlerish ? 1.06 : 1
        const scorerBump = isScoringish && usage >= 26 ? 1.03 : 1
        return clamp(0.80, 1.25, baseRole * handlerBump * scorerBump)
      })()

      // Slight realism boosts for specific stat families (no hard forcing).
      const familyBoost = (() => {
        if (propKey === "pra") {
          // PRA needs sustained usage; boost only for real usage players.
          return usage >= 28 ? 1.07 : usage >= 24 ? 1.04 : 0.97
        }
        if (propKey === "rebounds") {
          // Rebounds favor bigs + minutes.
          const big = isBigLike(c.row) ? 1.05 : 1.0
          const mins = minutes != null && minutes >= 28 ? 1.03 : 1.0
          return clamp(0.92, 1.10, big * mins)
        }
        if (propKey === "assists") {
          // Assists favor handlers (usage proxy).
          const base = usage >= 28 ? 1.08 : usage >= 24 ? 1.04 : 0.98
          const ladderBump = c.isLadder ? 1.07 : 1.0
          return clamp(0.92, 1.18, base * ladderBump)
        }
        if (propKey === "combo") {
          // Combo stats behave more like continuous NBA volume; small nudge for usage.
          return usage >= 26 ? 1.03 : 0.99
        }
        return 1.0
      })()

      // Stat-aware realism adjustment (bias, not rules).
      // Goal: stop unrealistic archetypes from leading specific stat ladders while keeping exploration.
      const statSpecific = (() => {
        const row = c.row || {}
        const isBig = isBigLike(row)
        const isGuard = isGuardLike(row)
        const rebRate = readReboundRate(row)
        const threePA = readThreePA(row)
        const astRate = readAssistRate(row)
        const mins = minutes == null ? 24 : minutes

        if (propKey === "rebounds") {
          // HARD stat priority (not a filter): bigs should dominate; guards are strongly suppressed.
          const rateBoost = Number.isFinite(rebRate) ? clamp(0.75, 1.40, 0.90 + (rebRate - 0.10) * 3.6) : 1.0
          const archetype = isBig ? 1.30 : isGuard ? 0.38 : 0.90
          const minutesBoost = mins >= 32 ? 1.12 : mins >= 28 ? 1.06 : mins < 22 ? 0.80 : 1.0
          // Extra suppression if a "guard-like + low reb rate" conflict appears.
          const conflict = isGuard && (rebRate == null || rebRate <= 0.11) ? 0.45 : 1.0
          return clamp(0.20, 1.90, rateBoost * archetype * minutesBoost * conflict)
        }

        if (propKey === "assists") {
          // HARD stat priority: only primary ball handlers should lead.
          // Heavy suppression for non-guards and low-usage profiles.
          const usageBoost = clamp(0.70, 1.45, 0.85 + ((usage - 20) / 14) * 0.42)
          const rateBoost = Number.isFinite(astRate) ? clamp(0.70, 1.55, 0.88 + (astRate - 0.16) * 3.0) : 0.95
          const archetype = isGuard ? 1.25 : isBig ? 0.42 : 0.70
          const minutesBoost = mins >= 32 ? 1.10 : mins >= 28 ? 1.05 : mins < 22 ? 0.78 : 1.0
          // Conflict: non-guard + low assist rate and/or low usage should be crushed.
          const handlerish = isGuard && usage >= 22
          const conflict = handlerish ? 1.0 : 0.45
          return clamp(0.18, 2.10, usageBoost * rateBoost * archetype * minutesBoost * conflict)
        }

        if (propKey === "threes") {
          // HARD stat priority: require minimum 3PA proxy; low-volume shooters heavily suppressed.
          // (Not a filter: still possible, but weight becomes tiny.)
          const volBoost = Number.isFinite(threePA)
            ? clamp(0.55, 1.80, 0.72 + (threePA / 7.5) * 0.78)
            : clamp(0.75, 1.10, 0.90 + ((usage - 20) / 22) * 0.08)
          const min3PA = Number.isFinite(threePA) ? threePA : 0
          const belowThreshold = Number.isFinite(threePA) ? threePA < 3.0 : true
          const lowVolCrush = belowThreshold ? (min3PA <= 1.8 ? 0.18 : 0.32) : 1.0
          const archetype = isBig ? 0.72 : isGuard ? 1.10 : 0.98
          const minutesBoost = mins >= 32 ? 1.06 : mins >= 28 ? 1.03 : mins < 22 ? 0.84 : 1.0
          return clamp(0.12, 2.20, volBoost * lowVolCrush * archetype * minutesBoost)
        }

        if (propKey === "points") {
          // Favor true scorers: usage + minutes (stars naturally rise).
          const usageBoost = clamp(0.85, 1.25, 0.92 + ((usage - 20) / 18) * 0.26)
          const minutesBoost = mins >= 34 ? 1.06 : mins >= 28 ? 1.03 : mins < 22 ? 0.90 : 1.0
          return clamp(0.70, 1.40, usageBoost * minutesBoost)
        }

        return 1.0
      })()

      const lowLinePenalty = (() => {
        const line = Number(c.row?.line)
        if (!Number.isFinite(line)) return 1
        // Strongly penalize low-line spam (<= 3.5) unless role is clearly real (usage + minutes).
        // Still not a filter: candidates remain selectable if edge/role justify.
        if (line > 3.5) return 1

        const mins = minutes == null ? 24 : minutes
        const usageSupport = clamp(0, 1, (usage - 20) / 14) // [0..1]
        const minutesSupport = clamp(0, 1, (mins - 24) / 12) // [0..1]
        const edgeSupport = Math.max(0, clamp(0, 0.12, rawEdge)) / 0.12 // [0..1]
        const support = 0.40 * edgeSupport + 0.35 * usageSupport + 0.25 * minutesSupport

        // Much harsher baseline; can recover toward ~1 only with strong usage+minutes and some edge.
        const basePenalty = line <= 1.5 ? 0.18 : line <= 2.5 ? 0.26 : 0.34
        return clamp(basePenalty, 1.00, basePenalty + support * (1 - basePenalty))
      })()

      // Increase statSpecific impact significantly (2x–3x effect) by powering it up inside realism.
      const statDominance = Math.pow(statSpecific, 1.35)
      const realismScore = clamp(0.30, 2.40, usageFactor * minutesFactor * roleFactor * familyBoost * statDominance * lowLinePenalty)

      // Final selection weight:
      // realismScore^1.5 * (0.45*probability + 0.55*edgeTerm)
      const realismPowered = Math.pow(realismScore, 1.5)

      // Role suppression (NOT a filter): low-usage OR low-minutes are heavily downweighted.
      const minsForGuard = minutes == null ? 0 : minutes
      const lowUsage = usage < 18
      const lowMinutes = minsForGuard > 0 && minsForGuard < 22
      const roleSuppression = lowUsage || lowMinutes ? (lowUsage && lowMinutes ? 0.14 : 0.28) : 1.0

      return w * minutesPenalty * realismPowered * roleSuppression
    }

    const gameKeys = [...byGame.keys()]

    const pickGame = () => {
      const idx = weightedPickIndex(gameKeys, (g) => {
        const pool = byGame.get(g) || []
        if (!pool.length) return 0
        let eligible = 0
        let env = 0
        for (const c of pool) {
          if (!canAdd(c)) continue
          eligible += 1
          env = Math.max(env, Number.isFinite(c.env) ? c.env : 0)
          if (eligible >= 18) break
        }
        if (!eligible) return 0
        const portfolioPenalty = softPenalty(portfolioGameUse.get(g) || 0, 0.25)
        return eligible * (1 + env * 0.10) * portfolioPenalty
      })
      return idx >= 0 ? gameKeys[idx] : null
    }

    const pickLegFromGame = (gameKey) => {
      const pool = byGame.get(gameKey) || []
      if (!pool.length) return null
      const idx = weightedPickIndex(pool, (c) => (canAdd(c) ? weight(c) : 0))
      return idx >= 0 ? pool[idx] : null
    }

    const maybeAddFirstBasket = () => {
      if (legCount < 3) return
      if (!firstBasketPerGame.length) return
      if (Math.random() > 0.35) return

      const candidates = firstBasketPerGame.map((n) => buildCandidate(n?.row)).filter((c) => c && canAdd(c))

      if (!candidates.length) return
      const idx = weightedPickIndex(candidates, (c) => {
        const p = Number.isFinite(c.probability) ? c.probability : 0.5
        const e = Math.max(0, Number.isFinite(c.edge) ? c.edge : 0)
        const u = Number.isFinite(c.usage) ? c.usage : 20
        const base = p * 1.6 + e * 3.0 + (u / 40) * 0.6
        const portfolioPenalty = softPenalty(portfolioPlayerUse.get(c.playerKey) || 0, 0.55)
        return base * portfolioPenalty
      })
      if (idx < 0) return
      const pick = candidates[idx]
      if (!pick || !pick.row) return

      chosen.push(pick.row)
      usedKeys.add([
        pick.playerKey,
        String(pick.row?.propType || ""),
        String(pick.row?.side || ""),
        String(pick.row?.line ?? ""),
        String(pick.row?.propVariant || "base"),
        pick.matchupKey,
      ].join("|"))
      slipPlayerUse.set(pick.playerKey, (slipPlayerUse.get(pick.playerKey) || 0) + 1)
      slipPropUse.set(pick.propTypeKey, (slipPropUse.get(pick.propTypeKey) || 0) + 1)
      slipGameUse.set(pick.matchupKey, (slipGameUse.get(pick.matchupKey) || 0) + 1)
    }

    let guard = 0
    while (chosen.length < legCount && guard < 500) {
      guard += 1
      const g = pickGame()
      if (!g) break
      const cand = pickLegFromGame(g)
      if (!cand) continue
      if (!canAdd(cand)) continue

      chosen.push(cand.row)
      usedKeys.add([
        cand.playerKey,
        String(cand.row?.propType || ""),
        String(cand.row?.side || ""),
        String(cand.row?.line ?? ""),
        String(cand.row?.propVariant || "base"),
        cand.matchupKey,
      ].join("|"))
      slipPlayerUse.set(cand.playerKey, (slipPlayerUse.get(cand.playerKey) || 0) + 1)
      slipPropUse.set(cand.propTypeKey, (slipPropUse.get(cand.propTypeKey) || 0) + 1)
      slipGameUse.set(cand.matchupKey, (slipGameUse.get(cand.matchupKey) || 0) + 1)

      if (chosen.length === 2) maybeAddFirstBasket()
    }

    if (chosen.length !== legCount) return null
    return chosen
  }

  const slips = []
  const legCounts = [4, 5, 6]
  for (const variant of buildVariants) {
    for (const legCount of legCounts) {
      // Generate multiple slips per variant to create wide exploration.
      const attempts = 3
      for (let i = 0; i < attempts; i += 1) {
        const legs = buildSlip(variant, legCount)
        if (!legs) continue
        slips.push({
          style: variant.key,
          label: `${variant.label} (${legCount}-leg)`,
          legCount,
          legs,
        })
        // Update portfolio soft-use counters after each accepted slip.
        for (const leg of legs) {
          const c = buildCandidate(leg)
          if (!c) continue
          portfolioPlayerUse.set(c.playerKey, (portfolioPlayerUse.get(c.playerKey) || 0) + 1)
          portfolioPropUse.set(c.propTypeKey, (portfolioPropUse.get(c.propTypeKey) || 0) + 1)
          portfolioGameUse.set(c.matchupKey, (portfolioGameUse.get(c.matchupKey) || 0) + 1)
        }
      }
    }
  }

  return {
    candidateEcosystem: {
      totalCandidates: baseCandidates.length,
      games: byGame.size,
      byGameCounts: [...byGame.entries()].map(([matchup, xs]) => ({ matchup, count: xs.length })),
    },
    firstBasketLayer: {
      perGameTop: firstBasketPerGame.map((n) => n.row),
    },
    slips,
  }
}

module.exports = { buildNbaSlipBundles }

