"use strict"

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.max(lo, Math.min(hi, x))
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function confidenceFromProb(p) {
  const x = toNum(p)
  if (!Number.isFinite(x)) return "low"
  if (x >= 0.65) return "high"
  if (x >= 0.5) return "medium"
  return "low"
}

function joinReason(parts) {
  return parts.filter(Boolean).join(" + ")
}

function fmtPct(x) {
  const n = toNum(x)
  if (!Number.isFinite(n)) return null
  return `${Math.round(n * 100)}%`
}

function selectBestLadder(options, cfg = {}) {
  const safe = toNum(cfg?.safeThreshold) ?? 0.55
  const target = toNum(cfg?.target) ?? 0.5
  const allowLowProb = !!cfg?.allowLowProb
  const minNonUpside = toNum(cfg?.minNonUpside) ?? 0.4

  const xs = Array.isArray(options)
    ? options
        .map((o) => ({
          line: o?.line,
          prob: toNum(o?.prob),
          level: toNum(o?.level) ?? 0,
        }))
        .filter((o) => o.line && Number.isFinite(o.prob))
    : []

  if (!xs.length) return { line: null, prob: null }

  const safePool = xs.filter((o) => o.prob >= safe).sort((a, b) => b.level - a.level)
  if (safePool.length) return { line: safePool[0].line, prob: safePool[0].prob }

  xs.sort((a, b) => Math.abs(a.prob - target) - Math.abs(b.prob - target))
  let pick = xs[0]

  if (!allowLowProb && pick.prob < minNonUpside) {
    const nonUpside = xs.filter((o) => o.prob >= minNonUpside).sort((a, b) => b.prob - a.prob)
    pick = nonUpside.length ? nonUpside[0] : xs.sort((a, b) => b.prob - a.prob)[0]
  }

  return { line: pick.line, prob: pick.prob }
}

function hitsReason(ref) {
  const parts = []
  const bo = toNum(ref?.battingOrderIndex) ?? toNum(ref?.lineupPosition)
  const hp = toNum(ref?.hitProb)

  if (Number.isFinite(hp)) parts.push(`contact rate ${fmtPct(hp)}`)
  if (Number.isFinite(bo) && bo <= 5) parts.push(`lineup spot #${bo}`)

  return joinReason(parts) || "ladder probability profile"
}

function rbiReason(ref) {
  const parts = []
  const bo = toNum(ref?.battingOrderIndex) ?? toNum(ref?.lineupPosition)
  const itt = toNum(ref?.impliedTeamTotal)
  const hp = toNum(ref?.hitProb)

  if (Number.isFinite(itt)) parts.push(`team total ${itt.toFixed(1)}`)
  if (Number.isFinite(bo) && bo <= 5) parts.push(`lineup spot #${bo}`)
  if (Number.isFinite(hp)) parts.push(`hit prob ${fmtPct(hp)}`)

  return joinReason(parts) || "run production profile"
}

function ksReason(ref) {
  const parts = []
  const kRate = toNum(ref?.pitcherKRate) ?? toNum(ref?.kRate) ?? toNum(ref?.pitcherKPercent)
  const oppK = toNum(ref?.opponentKRate) ?? toNum(ref?.oppKRate) ?? toNum(ref?.opponentKPercent)
  const exp = toNum(ref?.expectedKs)

  if (Number.isFinite(kRate)) parts.push(`pitcher K% ${kRate.toFixed(1)}`)
  else if (Number.isFinite(exp)) parts.push(`expected Ks ${exp.toFixed(1)}`)

  if (Number.isFinite(oppK)) parts.push(`opp K% ${oppK.toFixed(1)}`)
  else if (norm(ref?.opponent)) parts.push("matchup")

  return joinReason(parts) || "Ks profile"
}

function hrReason(ref) {
  const parts = []
  const power = toNum(ref?.powerScore)
  const hr9 = toNum(ref?.pitcherHrPer9) ?? toNum(ref?.pitcherHRPer9)
  const park = toNum(ref?._parkScore) ?? toNum(ref?.parkScore) ?? toNum(ref?.hrParkScore)

  if (Number.isFinite(power)) parts.push(`power ${power.toFixed(0)}`)
  if (Number.isFinite(hr9)) parts.push(`pitcher HR/9 ${hr9.toFixed(2)}`)
  if (Number.isFinite(park)) parts.push("park boost")

  const reasons = Array.isArray(ref?.reasons) ? ref.reasons : Array.isArray(ref?.insights) ? ref.insights : null
  if (reasons && reasons.length && parts.length < 2) parts.push(...reasons.slice(0, 2 - parts.length))

  return joinReason(parts) || "power + pitcher + park"
}

function predictionString(propType, line) {
  const ln = norm(line)
  if (propType === "Hits") return `${ln} Hits`
  if (propType === "RBIs") return `${ln} RBI`
  if (propType === "Ks") return `${ln} Ks`
  if (propType === "HR") return "HR"
  return ln
}

function ladderPropType(propBase, line) {
  const ln = norm(line)
  if (!ln) return propBase
  if (propBase === "Hits") return `${ln} Hits`
  if (propBase === "RBIs") return `${ln} RBI`
  if (propBase === "Ks") return `${ln} Ks`
  return `${ln} ${propBase}`
}

function sortByProbThenEdgeDesc(a, b) {
  const ap = toNum(a?.probability) ?? 0
  const bp = toNum(b?.probability) ?? 0
  if (bp !== ap) return bp - ap
  const ae = toNum(a?.edge) ?? -999
  const be = toNum(b?.edge) ?? -999
  return be - ae
}

function buildRankingFromRefs(refs, mapFn, limit) {
  const arr = Array.isArray(refs) ? refs.map(mapFn).filter((x) => x && x.player) : []
  arr.sort(sortByProbThenEdgeDesc)
  return typeof limit === "number" ? arr.slice(0, limit) : arr
}

function pickTop(list, n) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : []
  return arr.slice(0, n)
}

function playProb(p, propType) {
  if (!p) return null
  if (propType === "Hits") return toNum(p?.hitProb) ?? toNum(p?.modelProbability)
  if (propType === "RBIs") return toNum(p?.rbiProb) ?? toNum(p?.modelProbability)
  return toNum(p?.modelProbability)
}

function playEdge(p, propType) {
  if (!p) return null
  if (propType === "Hits") return toNum(p?.hitEdge) ?? toNum(p?.edge)
  if (propType === "RBIs") return toNum(p?.rbiEdge) ?? toNum(p?.edge)
  return toNum(p?.edge)
}

function playImplied(p, propType) {
  if (!p) return null
  if (propType === "Hits") return toNum(p?.hitImpliedProbability) ?? toNum(p?.impliedProbability)
  if (propType === "RBIs") return toNum(p?.rbiImpliedProbability) ?? toNum(p?.impliedProbability)
  return toNum(p?.impliedProbability)
}

function scorePlay(p, propType) {
  const prob = playProb(p, propType) ?? 0
  const edge = playEdge(p, propType) ?? 0
  // Presentation score only (not a model). Keep simple.
  return prob * 0.65 + edge * 0.35
}

function buildFades(allPlays, n = 10) {
  const arr = [...allPlays]
    .map((x) => {
      const p = x?.ref
      const t = x?.propType
      const mp = playProb(p, t)
      const ip = playImplied(p, t)
      return {
        propType: t,
        player: p?.player ?? p?.pitcher ?? null,
        team: p?.team ?? p?.teamResolved ?? null,
        opponent: p?.opponent ?? p?.opponentTeam ?? null,
        eventId: p?.eventId ?? null,
        modelProbability: mp,
        impliedProbability: ip,
        edge: playEdge(p, t),
        overpricedGap: (ip ?? 0) - (mp ?? 0),
      }
    })
    .filter((p) => Number.isFinite(toNum(p?.impliedProbability)) && Number.isFinite(toNum(p?.modelProbability)))
    .sort((a, b) => (toNum(b?.overpricedGap) ?? 0) - (toNum(a?.overpricedGap) ?? 0))
  return pickTop(arr, n).map((p) => ({
    propType: p.propType,
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    eventId: p.eventId,
    modelProbability: p.modelProbability,
    impliedProbability: p.impliedProbability,
    edge: (toNum(p.edge) != null ? Number(toNum(p.edge).toFixed(4)) : null),
    note: "Overpriced vs model",
  }))
}

function buildBestOverall(allPlays, n = 12) {
  // Prefer value (edge) but require some probability sanity per prop.
  const minProbByType = { HR: 0.06, Hits: 0.55, RBIs: 0.20, Ks: 0.45 }

  const pool = allPlays
    .filter((p) => {
      const t = norm(p?.propType)
      const minP = toNum(minProbByType[t]) ?? 0
      const ref = p?.ref
      return (playProb(ref, t) ?? 0) >= minP && Number.isFinite(playEdge(ref, t))
    })
    .sort((a, b) => {
      const ae = playEdge(a?.ref, a?.propType) ?? -999
      const be = playEdge(b?.ref, b?.propType) ?? -999
      if (be !== ae) return be - ae
      return scorePlay(b?.ref, b?.propType) - scorePlay(a?.ref, a?.propType)
    })

  const out = []
  const used = new Set()
  for (const p of pool) {
    const ref = p?.ref
    const key = `${p.propType}__${norm(ref?.player ?? ref?.pitcher).toLowerCase()}__${ref?.eventId || ""}__${ref?.line || ""}`
    if (used.has(key)) continue
    used.add(key)
    out.push(p)
    if (out.length >= n) break
  }
  return out.map((p) => ({
    propType: p.propType,
    player: p?.ref?.player ?? p?.ref?.pitcher ?? null,
    team: p?.ref?.team ?? p?.ref?.teamResolved ?? null,
    opponent: p?.ref?.opponent ?? p?.ref?.opponentTeam ?? null,
    eventId: p?.ref?.eventId ?? null,
    line: p?.ref?.line ?? null,
    odds: p?.ref?.odds ?? null,
    modelProbability: playProb(p?.ref, p?.propType),
    impliedProbability: playImplied(p?.ref, p?.propType),
    edge: playEdge(p?.ref, p?.propType),
    why: "High edge + solid probability",
  }))
}

function buildRrCandidates(allPlays, n = 8) {
  // High probability + non-negative edge preference; keep mixed props.
  const minProbByType = { HR: 0.08, Hits: 0.65, RBIs: 0.24, Ks: 0.50 }
  const pool = allPlays
    .filter((p) => (playProb(p?.ref, p?.propType) ?? 0) >= (toNum(minProbByType[p?.propType]) ?? 0))
    .sort((a, b) => scorePlay(b?.ref, b?.propType) - scorePlay(a?.ref, a?.propType))

  const out = []
  const usedPlayers = new Set()
  for (const p of pool) {
    const playerKey = `${p.propType}__${norm(p?.ref?.player ?? p?.ref?.pitcher).toLowerCase()}`
    if (usedPlayers.has(playerKey)) continue
    usedPlayers.add(playerKey)
    out.push(p)
    if (out.length >= n) break
  }
  return out.map((p) => ({
    propType: p.propType,
    player: p?.ref?.player ?? p?.ref?.pitcher ?? null,
    team: p?.ref?.team ?? p?.ref?.teamResolved ?? null,
    opponent: p?.ref?.opponent ?? p?.ref?.opponentTeam ?? null,
    eventId: p?.ref?.eventId ?? null,
    modelProbability: playProb(p?.ref, p?.propType),
    edge: playEdge(p?.ref, p?.propType),
    note: "Good consistency profile (high prob, reasonable edge)",
  }))
}

function buildLottoCandidates(allPlays, n = 10) {
  // Lower probability but strong edge; odds helps when available.
  const pool = [...allPlays]
    .filter((p) => Number.isFinite(playEdge(p?.ref, p?.propType)))
    .filter((p) => {
      const prob = playProb(p?.ref, p?.propType) ?? 0
      const edge = playEdge(p?.ref, p?.propType) ?? 0
      const odds = toNum(p?.ref?.odds)
      const longOdds = Number.isFinite(odds) ? odds >= 400 : false
      return (prob <= 0.35 && edge >= 0.05) || longOdds
    })
    .sort((a, b) => {
      const be = playEdge(b?.ref, b?.propType) ?? -999
      const ae = playEdge(a?.ref, a?.propType) ?? -999
      if (be !== ae) return be - ae
      const bod = toNum(b?.ref?.odds) ?? 0
      const aod = toNum(a?.ref?.odds) ?? 0
      return bod - aod
    })

  return pickTop(pool, n).map((p) => ({
    propType: p.propType,
    player: p?.ref?.player ?? p?.ref?.pitcher ?? null,
    team: p?.ref?.team ?? p?.ref?.teamResolved ?? null,
    opponent: p?.ref?.opponent ?? p?.ref?.opponentTeam ?? null,
    eventId: p?.ref?.eventId ?? null,
    odds: p?.ref?.odds ?? null,
    modelProbability: playProb(p?.ref, p?.propType),
    edge: playEdge(p?.ref, p?.propType),
    note: "High-upside / lower-probability value",
  }))
}

function buildGameInsights(hrPlays, hitsPlays, rbiPlays, ksPlays) {
  const byGame = new Map()
  function add(ref, label) {
    const id = ref?.eventId
    if (!id) return
    const g =
      byGame.get(id) || {
        eventId: id,
        notes: [],
        counts: { HR: 0, Hits: 0, RBIs: 0, Ks: 0 },
        teams: new Map(),
      }
    g.counts[label] = (g.counts[label] || 0) + 1
    const team = norm(ref?.team ?? ref?.teamResolved).toLowerCase()
    if (team) g.teams.set(team, (g.teams.get(team) || 0) + 1)
    byGame.set(id, g)
  }

  for (const p of pickTop(hrPlays, 15)) add(p, "HR")
  for (const p of pickTop(hitsPlays, 15)) add(p, "Hits")
  for (const p of pickTop(rbiPlays, 15)) add(p, "RBIs")
  for (const p of pickTop(ksPlays, 10)) add(p, "Ks")

  for (const g of byGame.values()) {
    const hrN = g.counts.HR || 0
    const hitN = g.counts.Hits || 0
    const rbiN = g.counts.RBIs || 0
    const ksN = g.counts.Ks || 0

    if (hrN >= 2) g.notes.push("Strong HR environment")
    if (hitN + rbiN >= 4) g.notes.push("Good stacking opportunity")
    if (ksN >= 1 && hrN === 0) g.notes.push("Pitching-friendly lean")

    // Stackable team signal: multiple plays concentrated on same team.
    const topTeamCount = [...g.teams.values()].sort((a, b) => b - a)[0] || 0
    if (topTeamCount >= 3) g.notes.push("Stackable team concentration")
    if (!g.notes.length) g.notes.push("Mixed signals")

    g.teams = undefined
  }

  return [...byGame.values()]
    .sort((a, b) => (b.counts.HR + b.counts.Hits + b.counts.RBIs) - (a.counts.HR + a.counts.Hits + a.counts.RBIs))
    .slice(0, 12)
}

function buildMlbInsightBoard(input = {}) {
  // Reuse existing objects; do not clone or recompute.
  const hrSrc = Array.isArray(input?.hrPredictionToday?.mostLikelyHr)
    ? input.hrPredictionToday.mostLikelyHr
    : Array.isArray(input?.hrPredictionToday?.topHrCandidatesToday)
      ? input.hrPredictionToday.topHrCandidatesToday
      : []
  const hitsSrc = Array.isArray(input?.hitsToday?.topPlayers) ? input.hitsToday.topPlayers : []
  const rbiSrc = Array.isArray(input?.rbiToday?.topPlayers) ? input.rbiToday.topPlayers : []
  const ksSrc = Array.isArray(input?.pitcherKsToday?.topPitchers) ? input.pitcherKsToday.topPitchers : []

  // ------------------------------------------------------------
  // LADDER-SPECIFIC RANKINGS (structural fix)
  // ------------------------------------------------------------
  const hit1plusRankings = buildRankingFromRefs(
    hitsSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Hits",
      ladder: "1+",
      probability: toNum(p?.hit1plus),
      edge: playEdge(p, "Hits"),
      ref: p,
    }),
    60
  )
  const hit2plusRankings = buildRankingFromRefs(
    hitsSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Hits",
      ladder: "2+",
      probability: toNum(p?.hit2plus),
      edge: playEdge(p, "Hits"),
      ref: p,
    }),
    60
  )
  const hit3plusRankings = buildRankingFromRefs(
    hitsSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Hits",
      ladder: "3+",
      probability: toNum(p?.hit3plus),
      edge: playEdge(p, "Hits"),
      ref: p,
    }),
    60
  )

  const rbi1plusRankings = buildRankingFromRefs(
    rbiSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "RBIs",
      ladder: "1+",
      probability: toNum(p?.rbi1plus),
      edge: playEdge(p, "RBIs"),
      ref: p,
    }),
    50
  )
  const rbi2plusRankings = buildRankingFromRefs(
    rbiSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "RBIs",
      ladder: "2+",
      probability: toNum(p?.rbi2plus),
      edge: playEdge(p, "RBIs"),
      ref: p,
    }),
    50
  )
  const rbi3plusRankings = buildRankingFromRefs(
    rbiSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "RBIs",
      ladder: "3+",
      probability: toNum(p?.rbi3plus),
      edge: playEdge(p, "RBIs"),
      ref: p,
    }),
    50
  )

  const k4plusRankings = buildRankingFromRefs(
    ksSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Ks",
      ladder: "4+",
      probability: toNum(p?.k4plus) ?? toNum(p?.k4) ?? toNum(p?.ladder?.["4+"]),
      edge: playEdge(p, "Ks"),
      ref: p,
    }),
    40
  )
  const k5plusRankings = buildRankingFromRefs(
    ksSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Ks",
      ladder: "5+",
      probability: toNum(p?.k5plus) ?? toNum(p?.k5) ?? toNum(p?.ladder?.["5+"]),
      edge: playEdge(p, "Ks"),
      ref: p,
    }),
    40
  )
  const k6plusRankings = buildRankingFromRefs(
    ksSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Ks",
      ladder: "6+",
      probability: toNum(p?.k6plus) ?? toNum(p?.k6) ?? toNum(p?.ladder?.["6+"]),
      edge: playEdge(p, "Ks"),
      ref: p,
    }),
    40
  )
  const k7plusRankings = buildRankingFromRefs(
    ksSrc,
    (p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "Ks",
      ladder: "7+",
      probability: toNum(p?.k7plus) ?? toNum(p?.k7) ?? toNum(p?.ladder?.["7+"]),
      edge: playEdge(p, "Ks"),
      ref: p,
    }),
    40
  )

  const topHR = [...hrSrc].sort((a, b) => scorePlay(b, "HR") - scorePlay(a, "HR")).slice(0, 10)
  const topHits = [...hitsSrc].sort((a, b) => scorePlay(b, "Hits") - scorePlay(a, "Hits")).slice(0, 10)
  const topRBI = [...rbiSrc].sort((a, b) => scorePlay(b, "RBIs") - scorePlay(a, "RBIs")).slice(0, 10)
  const topKs = [...ksSrc].sort((a, b) => scorePlay(b, "Ks") - scorePlay(a, "Ks")).slice(0, 10)

  // Expanded boards (full prop + ladder view)
  const hrBoard = [...hrSrc]
    .sort((a, b) => scorePlay(b, "HR") - scorePlay(a, "HR"))
    .slice(0, 25)
    .map((p) => ({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: "HR",
      modelProbability: playProb(p, "HR"),
      edge: playEdge(p, "HR"),
      odds: p?.odds ?? null,
      predicted: {
        type: "hr",
        line: "HR",
        probability: playProb(p, "HR"),
      },
      confidence: confidenceFromProb(playProb(p, "HR")),
      reason: hrReason(p),
      ref: p, // reuse existing object
    }))

  // Hits board is built from ladder-specific pools (not global hitter ranking).
  const hitsPool = new Map()
  for (const r of [...hit1plusRankings.slice(0, 30), ...hit2plusRankings.slice(0, 30), ...hit3plusRankings.slice(0, 30)]) {
    const key = norm(r?.player).toLowerCase()
    if (!key) continue
    hitsPool.set(key, r.ref)
  }
  const hitsBoard = [...hitsPool.values()]
    .map((p) => {
      const p1 = toNum(p?.hit1plus)
      const p2 = toNum(p?.hit2plus)
      const p3 = toNum(p?.hit3plus)

      const pick = selectBestLadder(
        [
          { line: "1+", prob: p1, level: 1 },
          { line: "2+", prob: p2, level: 2 },
          { line: "3+", prob: p3, level: 3 },
        ],
        { safeThreshold: 0.55, target: 0.5, allowLowProb: false, minNonUpside: 0.4 }
      )
      const line = pick.line || "1+"
      const prob = pick.prob

      return {
        player: p?.player ?? null,
        team: p?.team ?? null,
        propType: ladderPropType("Hits", line),
        prediction: predictionString("Hits", line),
        probability: prob,
        edge: playEdge(p, "Hits"),
        odds: p?.hitOdds ?? p?.odds ?? null,
        confidence: confidenceFromProb(prob),
        reason: hitsReason(p),
      }
    })
    .filter((x) => x.player)
    .sort((a, b) => sortByProbThenEdgeDesc(a, b))
    .slice(0, 30)

  // RBI board: include variety (avoid one-team spam)
  const teamCap = 3
  // RBI board is built from ladder-specific pools (not global RBI ranking).
  const rbiPool = new Map()
  for (const r of [...rbi1plusRankings.slice(0, 25), ...rbi2plusRankings.slice(0, 25), ...rbi3plusRankings.slice(0, 25)]) {
    const key = norm(r?.player).toLowerCase()
    if (!key) continue
    rbiPool.set(key, r.ref)
  }
  const rbiSorted = [...rbiPool.values()].sort((a, b) => scorePlay(b, "RBIs") - scorePlay(a, "RBIs"))
  const rbiBoard = []
  const teamCounts = new Map()
  for (const p of rbiSorted) {
    const team = norm(p?.team).toUpperCase()
    const c = teamCounts.get(team) || 0
    if (team && c >= teamCap) continue
    teamCounts.set(team, c + 1)
    const p1 = toNum(p?.rbi1plus)
    const p2 = toNum(p?.rbi2plus)
    const pick = selectBestLadder(
      [
        { line: "1+", prob: p1, level: 1 },
        { line: "2+", prob: p2, level: 2 },
      ],
      { safeThreshold: 0.55, target: 0.5, allowLowProb: false, minNonUpside: 0.4 }
    )
    const line = pick.line || "1+"
    const prob = pick.prob

    rbiBoard.push({
      player: p?.player ?? null,
      team: p?.team ?? null,
      propType: ladderPropType("RBIs", line),
      prediction: predictionString("RBIs", line),
      probability: prob,
      edge: playEdge(p, "RBIs"),
      odds: p?.rbiOdds ?? p?.odds ?? null,
      confidence: confidenceFromProb(prob),
      reason: rbiReason(p),
    })
    if (rbiBoard.length >= 20) break
  }

  // Ks board is built from ladder-specific pools (not global pitcher ranking).
  const ksPool = new Map()
  for (const r of [...k4plusRankings.slice(0, 25), ...k5plusRankings.slice(0, 25), ...k6plusRankings.slice(0, 25), ...k7plusRankings.slice(0, 25)]) {
    const key = norm(r?.player).toLowerCase()
    if (!key) continue
    ksPool.set(key, r.ref)
  }
  const ksBoard = [...ksPool.values()]
    .map((p) => {
      const k4 = toNum(p?.k4plus) ?? toNum(p?.k4) ?? toNum(p?.ladder?.["4+"]) ?? null
      const k5 = toNum(p?.k5plus) ?? toNum(p?.k5) ?? toNum(p?.ladder?.["5+"]) ?? null
      const k6 = toNum(p?.k6plus) ?? toNum(p?.k6) ?? toNum(p?.ladder?.["6+"]) ?? null
      const k7 = toNum(p?.k7plus) ?? toNum(p?.k7) ?? toNum(p?.ladder?.["7+"]) ?? null

      const pick = selectBestLadder(
        [
          { line: "4+", prob: k4, level: 4 },
          { line: "5+", prob: k5, level: 5 },
          { line: "6+", prob: k6, level: 6 },
          { line: "7+", prob: k7, level: 7 },
        ],
        { safeThreshold: 0.55, target: 0.5, allowLowProb: true, minNonUpside: 0.4 }
      )
      // Always output a ladder label (never generic "Ks"/"over").
      const line = pick.line || (Number.isFinite(k5) ? "5+" : Number.isFinite(k4) ? "4+" : "5+")
      const prob = pick.prob ?? playProb(p, "Ks")

      return {
        player: p?.player ?? null,
        team: p?.team ?? null,
        propType: ladderPropType("Ks", line),
        prediction: predictionString("Ks", line),
        probability: prob,
        edge: playEdge(p, "Ks"),
        odds: p?.odds ?? null,
        confidence: confidenceFromProb(prob),
        reason: ksReason(p),
      }
    })
    .filter((x) => x.player)
    .sort((a, b) => sortByProbThenEdgeDesc(a, b))
    .slice(0, 30)

  // ------------------------------------------------------------
  // SECONDARY SECTIONS (rebuilt from ladder-based predictions)
  // ------------------------------------------------------------
  function predictedFromHitsRef(p) {
    const p1 = toNum(p?.hit1plus)
    const p2 = toNum(p?.hit2plus)
    const p3 = toNum(p?.hit3plus)
    const pick = selectBestLadder(
      [
        { line: "1+", prob: p1, level: 1 },
        { line: "2+", prob: p2, level: 2 },
        { line: "3+", prob: p3, level: 3 },
      ],
      { safeThreshold: 0.55, target: 0.5, allowLowProb: false, minNonUpside: 0.4 }
    )
    const line = pick.line || "1+"
    const prob = pick.prob
    if (!Number.isFinite(prob)) return null
    return {
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? p?.opponentTeam ?? null,
      eventId: p?.eventId ?? null,
      propType: ladderPropType("Hits", line),
      prediction: predictionString("Hits", line),
      probability: prob,
      edge: playEdge(p, "Hits"),
      odds: p?.hitOdds ?? p?.odds ?? null,
      confidence: confidenceFromProb(prob),
      reason: hitsReason(p),
      category: "hits",
    }
  }

  function predictedFromRbiRef(p) {
    const p1 = toNum(p?.rbi1plus)
    const p2 = toNum(p?.rbi2plus)
    const pick = selectBestLadder(
      [
        { line: "1+", prob: p1, level: 1 },
        { line: "2+", prob: p2, level: 2 },
      ],
      { safeThreshold: 0.55, target: 0.5, allowLowProb: false, minNonUpside: 0.4 }
    )
    const line = pick.line || "1+"
    const prob = pick.prob
    if (!Number.isFinite(prob)) return null
    return {
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? p?.opponentTeam ?? null,
      eventId: p?.eventId ?? null,
      propType: ladderPropType("RBIs", line),
      prediction: predictionString("RBIs", line),
      probability: prob,
      edge: playEdge(p, "RBIs"),
      odds: p?.rbiOdds ?? p?.odds ?? null,
      confidence: confidenceFromProb(prob),
      reason: rbiReason(p),
      category: "rbi",
    }
  }

  function predictedFromKsRef(p) {
    const k4 = toNum(p?.k4plus) ?? toNum(p?.k4) ?? toNum(p?.ladder?.["4+"]) ?? null
    const k5 = toNum(p?.k5plus) ?? toNum(p?.k5) ?? toNum(p?.ladder?.["5+"]) ?? null
    const k6 = toNum(p?.k6plus) ?? toNum(p?.k6) ?? toNum(p?.ladder?.["6+"]) ?? null
    const k7 = toNum(p?.k7plus) ?? toNum(p?.k7) ?? toNum(p?.ladder?.["7+"]) ?? null
    const pick = selectBestLadder(
      [
        { line: "4+", prob: k4, level: 4 },
        { line: "5+", prob: k5, level: 5 },
        { line: "6+", prob: k6, level: 6 },
        { line: "7+", prob: k7, level: 7 },
      ],
      { safeThreshold: 0.55, target: 0.5, allowLowProb: true, minNonUpside: 0.4 }
    )
    const line = pick.line || (Number.isFinite(k5) ? "5+" : Number.isFinite(k4) ? "4+" : "5+")
    const prob = pick.prob ?? playProb(p, "Ks")
    if (!Number.isFinite(prob)) return null
    return {
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? null,
      eventId: p?.eventId ?? null,
      propType: ladderPropType("Ks", line),
      prediction: predictionString("Ks", line),
      probability: prob,
      edge: playEdge(p, "Ks"),
      odds: p?.odds ?? null,
      confidence: confidenceFromProb(prob),
      reason: ksReason(p),
      category: "ks",
    }
  }

  const predictedPlays = []
  for (const p of hitsSrc) {
    const x = predictedFromHitsRef(p)
    if (x?.player && x?.prediction) predictedPlays.push(x)
  }
  for (const p of rbiSrc) {
    const x = predictedFromRbiRef(p)
    if (x?.player && x?.prediction) predictedPlays.push(x)
  }
  for (const p of ksSrc) {
    const x = predictedFromKsRef(p)
    if (x?.player && x?.prediction) predictedPlays.push(x)
  }
  for (const p of hrSrc) {
    const prob = toNum(p?.modelProbability)
    if (!Number.isFinite(prob)) continue
    predictedPlays.push({
      player: p?.player ?? null,
      team: p?.team ?? null,
      opponent: p?.opponent ?? p?.opponentTeam ?? null,
      eventId: p?.eventId ?? null,
      propType: "HR",
      prediction: "HR",
      probability: prob,
      edge: toNum(p?.edge),
      odds: p?.odds ?? null,
      confidence: confidenceFromProb(prob),
      reason: hrReason(p),
      category: "hr",
    })
  }

  function sortPredicted(a, b) {
    const ae = toNum(a?.edge) ?? -999
    const be = toNum(b?.edge) ?? -999
    if (be !== ae) return be - ae
    const ap = toNum(a?.probability) ?? 0
    const bp = toNum(b?.probability) ?? 0
    return bp - ap
  }

  function pickCategoryKey(p) {
    if (p.category === "hr") return "HR"
    const pr = String(p.prediction || "")
    if (pr.endsWith("Hits")) return "Hits"
    if (pr.endsWith("RBI")) return "RBIs"
    if (pr.endsWith("Ks")) return "Ks"
    return "Other"
  }

  function buildMixedMustPlays(pool, n = 10) {
    const primary = pool
      .filter((p) => (toNum(p?.probability) ?? 0) >= 0.55 && (toNum(p?.edge) ?? 0) > 0)
      .sort(sortPredicted)

    const fallback = [...pool].sort(sortPredicted)

    const cats = ["HR", "Ks", "RBIs", "Hits"]
    const out = []
    const used = new Set()
    const teamCounts = new Map()
    const gamesUsed = new Set()

    function teamKey(p) {
      return norm(p?.team).toUpperCase()
    }

    function gameKey(p) {
      const eid = norm(p?.eventId)
      if (eid) return `e:${eid}`
      const away = norm(p?.opponent)
      const home = norm(p?.team)
      if (away && home) return `m:${away}@${home}`
      return ""
    }

    function canAdd(p) {
      const tk = teamKey(p)
      if (tk && (teamCounts.get(tk) || 0) >= 3) return false // hard team cap
      return true
    }

    function addOut(p) {
      const tk = teamKey(p)
      if (tk) teamCounts.set(tk, (teamCounts.get(tk) || 0) + 1)
      const gk = gameKey(p)
      if (gk) gamesUsed.add(gk)
      out.push({
        ...p,
        propType: p.propType ?? pickCategoryKey(p),
        modelProbability: p.probability,
        impliedProbability: null,
        why: "Mixed-slate must play (ladder-based)",
      })
    }

    function tryAdd(list) {
      for (const p of list) {
        const cat = pickCategoryKey(p)
        const key = `${pickCategoryKey(p)}__${norm(p.player).toLowerCase()}__${norm(String(p.prediction))}`
        if (used.has(key)) continue
        if ((catCount[cat] || 0) >= (maxQuota[cat] || 99)) continue
        if (!canAdd(p)) continue
        used.add(key)
        addOut(p)
        catCount[cat] = (catCount[cat] || 0) + 1
        if (out.length >= n) return true
      }
      return false
    }

    // Pass 1: enforce minimum prop mix: 2-3 Hits, 2 HR, 1-2 Ks, 1 RBI
    const minQuota = { Hits: 2, HR: 2, Ks: 1, RBIs: 1 }
    const maxQuota = { Hits: 3, HR: 3, Ks: 2, RBIs: 2 }
    const catCount = { Hits: 0, HR: 0, Ks: 0, RBIs: 0 }
    for (const cat of cats) {
      const sub = primary.filter((p) => pickCategoryKey(p) === cat)
      let need = minQuota[cat] || 0
      for (const p of sub) {
        if (need <= 0) break
        const key = `${pickCategoryKey(p)}__${norm(p.player).toLowerCase()}__${norm(String(p.prediction))}`
        if (used.has(key)) continue
        if (!canAdd(p)) continue
        used.add(key)
        addOut(p)
        catCount[cat] = (catCount[cat] || 0) + 1
        need -= 1
        if (out.length >= n) break
      }
      // If strict pool misses quota, use fallback within same category.
      if (need > 0) {
        const fb = fallback.filter((p) => pickCategoryKey(p) === cat)
        for (const p of fb) {
          if (need <= 0) break
          const key = `${pickCategoryKey(p)}__${norm(p.player).toLowerCase()}__${norm(String(p.prediction))}`
          if (used.has(key)) continue
          if (!canAdd(p)) continue
          used.add(key)
          addOut(p)
          catCount[cat] = (catCount[cat] || 0) + 1
          need -= 1
          if (out.length >= n) break
        }
      }
      if (out.length >= n) break
    }

    // Pass 2: round-robin fill from primary across categories
    let idx = 0
    while (out.length < n && primary.length) {
      const cat = cats[idx % cats.length]
      idx += 1
      const sub = primary.filter((p) => pickCategoryKey(p) === cat && (catCount[cat] || 0) < (maxQuota[cat] || 99))
      if (!tryAdd(sub)) {
        // no progress possible for this cat in primary; continue scanning
        if (idx > cats.length * 50) break
      }
    }

    // Pass 3: fallback fill (still mixed-first)
    if (out.length < n) {
      idx = 0
      while (out.length < n && fallback.length) {
        const cat = cats[idx % cats.length]
        idx += 1
        const sub = fallback.filter((p) => pickCategoryKey(p) === cat && (catCount[cat] || 0) < (maxQuota[cat] || 99))
        if (!tryAdd(sub)) {
          if (idx > cats.length * 80) break
        }
      }
    }

    // Pass 4: last resort (still not empty)
    if (out.length < n) tryAdd(fallback)

    // Pass 5: ensure game diversity (at least 6 distinct games when possible).
    if (gamesUsed.size < 6) {
      const byScore = [...fallback]
        .filter((p) => {
          const gk = gameKey(p)
          if (!gk || gamesUsed.has(gk)) return false
          return canAdd(p)
        })
        .sort(sortPredicted)
      for (const p of byScore) {
        if (gamesUsed.size >= 6) break
        const key = `${pickCategoryKey(p)}__${norm(p.player).toLowerCase()}__${norm(String(p.prediction))}`
        if (used.has(key)) continue
        used.add(key)
        addOut(p)
      }
    }

    // Re-rank after constraints, then clip.
    out.sort(sortPredicted)
    return out.slice(0, n)
  }

  const bestOverallPlays = buildMixedMustPlays(predictedPlays, 10)

  // rrCandidates: safe/consistent pool (no HR). Prefer 1+ Hits and 5+ Ks.
  const rrPool = predictedPlays
    .filter((p) => p.category !== "hr")
    .filter((p) => (toNum(p?.probability) ?? 0) >= 0.6)
    .filter((p) => p.prediction === "1+ Hits" || p.prediction === "5+ Ks" || p.prediction === "4+ Ks")
    .sort((a, b) => (toNum(b?.probability) ?? 0) - (toNum(a?.probability) ?? 0))

  let rrCandidates = rrPool.slice(0, 8)
  if (!rrCandidates.length) {
    // Fallback: any non-HR high-prob plays.
    rrCandidates = predictedPlays
      .filter((p) => p.category !== "hr")
      .sort((a, b) => (toNum(b?.probability) ?? 0) - (toNum(a?.probability) ?? 0))
      .slice(0, 8)
  }

  // lottoCandidates: HR + higher ladders with positive edge (lower prob allowed)
  const lottoPool = predictedPlays
    .filter((p) => (toNum(p?.edge) ?? 0) > 0)
    .filter((p) => {
      if (p.category === "hr") return true
      const pr = String(p.prediction || "")
      const prob = toNum(p?.probability) ?? 0
      const isHighLadderHit = pr.startsWith("2+ Hits") || pr.startsWith("3+ Hits")
      const isHighLadderKs = pr.startsWith("6+ Ks") || pr.startsWith("7+ Ks")
      return (isHighLadderHit || isHighLadderKs) && prob < 0.55
    })
    .sort(sortPredicted)

  let lottoCandidates = lottoPool.slice(0, 12)
  if (!lottoCandidates.length) {
    // Fallback: HR plays first, then next best edges.
    const hr = predictedPlays.filter((p) => p.category === "hr").sort(sortPredicted).slice(0, 10)
    const rest = predictedPlays.filter((p) => p.category !== "hr").sort(sortPredicted).slice(0, 10)
    lottoCandidates = [...hr, ...rest].slice(0, 12)
  }

  const allPlays = [
    ...topHR.map((ref) => ({ propType: "HR", ref })),
    ...topHits.map((ref) => ({ propType: "Hits", ref })),
    ...topRBI.map((ref) => ({ propType: "RBIs", ref })),
    ...topKs.map((ref) => ({ propType: "Ks", ref })),
  ]

  const fades = buildFades(allPlays, 10)
  const gameInsights = buildGameInsights(topHR, topHits, topRBI, topKs)

  return {
    hrBoard,
    hitsBoard,
    rbiBoard,
    ksBoard,
    // Ladder-specific rankings (for exploration)
    hit1plusRankings,
    hit2plusRankings,
    hit3plusRankings,
    rbi1plusRankings,
    rbi2plusRankings,
    rbi3plusRankings,
    k4plusRankings,
    k5plusRankings,
    k6plusRankings,
    k7plusRankings,
    topHR,
    topHits,
    topRBI,
    topKs,
    bestOverallPlays,
    rrCandidates,
    lottoCandidates,
    fades,
    gameInsights,
  }
}

module.exports = { buildMlbInsightBoard }

