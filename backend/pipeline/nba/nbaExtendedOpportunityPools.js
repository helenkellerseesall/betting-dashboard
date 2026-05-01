"use strict"

const {
  ladderCandidateFromRow,
  computeFinalWeight,
  computeRealismScore,
  readContextScore,
  readMinutes,
  readUsageRate,
  dedupeCandidates,
  sortByProbDesc,
} = require("./nbaOpportunityCandidates")

function mkLower(row) {
  return String(row?.marketKey || "").toLowerCase()
}

function ptLower(row) {
  return String(row?.propType || "").toLowerCase()
}

function pvLower(row) {
  return String(row?.propVariant || "base").toLowerCase()
}

function isAltVariantRow(row) {
  const pv = pvLower(row)
  if (pv && pv !== "base" && pv !== "default") return true
  const mk = mkLower(row)
  return mk.includes("alternate") || mk.includes("_alt")
}

function isDoubleDoubleRow(row) {
  const mk = mkLower(row)
  const pt = ptLower(row)
  return mk.includes("double_double") || mk.includes("double double") || pt.includes("double double")
}

function isTripleDoubleRow(row) {
  const mk = mkLower(row)
  const pt = ptLower(row)
  return mk.includes("triple_double") || mk.includes("triple double") || pt.includes("triple double")
}

/** PRA combined alternate / ladder rows at 25+ / 30+ / 35+ / 40+ style lines. */
function praTierLabel(line) {
  const n = Number(line)
  if (!Number.isFinite(n)) return null
  if (n >= 38.5) return 40
  if (n >= 33.5) return 35
  if (n >= 28.5) return 30
  if (n >= 23.5) return 25
  return null
}

function isPraLadderTierRow(row) {
  const tier = praTierLabel(row?.line)
  if (tier == null) return false
  const mk = mkLower(row)
  const pt = ptLower(row)
  const isPra =
    mk.includes("points_rebounds_assists") ||
    mk.includes("player_pra") ||
    (/\bpra\b/.test(pt) && !pt.includes("points + rebounds")) ||
    pt.includes("points rebounds assists")
  if (!isPra) return false
  if (mk.includes("player_points_rebounds") && !mk.includes("assists")) return false
  return true
}

/** Alt points ladder: 20+ … 40+ (alternate / ladder-style points only). */
function altPointsTierLabel(line) {
  const n = Number(line)
  if (!Number.isFinite(n)) return null
  if (n >= 38.5) return 40
  if (n >= 33.5) return 35
  if (n >= 28.5) return 30
  if (n >= 23.5) return 25
  if (n >= 18.5) return 20
  return null
}

function isAltPointsLadderRow(row) {
  const mk = mkLower(row)
  if (!mk.includes("player_points")) return false
  if (mk.includes("rebounds") || mk.includes("assists")) return false
  if (!isAltVariantRow(row)) return false
  return altPointsTierLabel(row?.line) != null
}

/** Alt threes 2+ … 5+ */
function isAltThreesLadderRow(row) {
  const mk = mkLower(row)
  if (!mk.includes("threes") && !mk.includes("three") && !mk.includes("3pt")) return false
  if (!isAltVariantRow(row)) return false
  const n = Number(row?.line)
  if (!Number.isFinite(n)) return false
  return n >= 1.5 && n <= 5.75
}

/** Points+Assists, Points+Rebounds, Rebounds+Assists (exclude full PRA). */
function isComboStatRow(row) {
  const mk = mkLower(row)
  if (mk.includes("points_rebounds_assists")) return false
  if (mk.includes("player_points_assists")) return true
  if (mk.includes("player_points_rebounds") && !mk.includes("assists")) return true
  if (mk.includes("player_rebounds_assists")) return true
  const pt = ptLower(row)
  if ((/points.*assists|pts.*ast/i.test(pt) || pt.includes("points + assists")) && !/rebound/i.test(pt) && !/pra/i.test(pt))
    return true
  if ((/points.*rebounds/i.test(pt) || pt.includes("points + rebounds")) && !/assist/i.test(pt) && !/pra/i.test(pt))
    return true
  if ((/rebounds.*assists|reb.*ast/i.test(pt) || pt.includes("rebounds + assists")) && !/point/i.test(pt)) return true
  return false
}

function pushCandidate(pool, row, th, { minProb, requireEdge = true } = {}) {
  const c = ladderCandidateFromRow(row)
  if (!c) return
  if (c.probability < minProb) return
  if (requireEdge && c.edge != null && Number.isFinite(c.edge) && c.edge < th.edge) return
  pool.push(c)
}

function fillPool(universe, predicate, th, opts) {
  const pool = []
  for (const row of universe) {
    if (!row || typeof row !== "object") continue
    if (!predicate(row)) continue
    pushCandidate(pool, row, th, opts)
  }
  return pool
}

function fillPoolRelaxed(universe, predicate, th, minProb) {
  let pool = fillPool(universe, predicate, th, { minProb, requireEdge: true })
  if (pool.length) return pool
  pool = []
  for (const row of universe) {
    if (!row || typeof row !== "object") continue
    if (!predicate(row)) continue
    pushCandidate(pool, row, th, { minProb, requireEdge: false })
  }
  return pool
}

function buildSyntheticDoubleTripleFromCore(universe, th) {
  const byPlayerEvent = new Map()
  for (const row of universe) {
    if (!row || typeof row !== "object") continue
    const c = ladderCandidateFromRow(row)
    if (!c) continue
    const pt = String(c?.propType || "").toLowerCase()
    if (!/point|rebound|assist/.test(pt)) continue
    if (!c.eventId || !c.player) continue
    const key = `${c.eventId}__${String(c.player).toLowerCase()}`
    const cur = byPlayerEvent.get(key) || { points: null, rebounds: null, assists: null, base: c }
    if (/point/.test(pt)) cur.points = c
    else if (/rebound/.test(pt)) cur.rebounds = c
    else if (/assist/.test(pt)) cur.assists = c
    if (!cur.base) cur.base = c
    byPlayerEvent.set(key, cur)
  }

  const doubleDoubleCandidates = []
  const tripleDoubleCandidates = []

  for (const g of byPlayerEvent.values()) {
    const p = Number(g.points?.probability)
    const r = Number(g.rebounds?.probability)
    const a = Number(g.assists?.probability)

    const pr = Number.isFinite(p) && Number.isFinite(r) ? p * r : null
    const pa = Number.isFinite(p) && Number.isFinite(a) ? p * a : null
    const ra = Number.isFinite(r) && Number.isFinite(a) ? r * a : null
    const ddProbRaw = Math.max(pr || 0, pa || 0, ra || 0)
    const tdProbRaw = Number.isFinite(p) && Number.isFinite(r) && Number.isFinite(a) ? p * r * a : 0

    const base = g.base || g.points || g.rebounds || g.assists
    if (!base) continue

    // Use player-tail shape so DD/TD are differentiated and not static placeholders.
    const ddProb = Math.max(0.04, Math.min(0.48, Math.pow(ddProbRaw, 0.74)))
    if (ddProb >= Math.max(0.10, th.doubleDouble * 0.7)) {
      const minutes = base.minutes ?? readMinutes(base)
      const usageRate = base.usageRate ?? readUsageRate(base)
      const contextScore = base.contextScore ?? readContextScore(base)
      const realismScore = base.realismScore ?? computeRealismScore({
        usageRate: usageRate == null ? 20 : usageRate,
        minutes: minutes == null ? 24 : minutes,
        row: base,
        propType: "Double Double",
      })
      const fw = computeFinalWeight({
        realismScore,
        predictedProbability: ddProb,
        edge: 0,
        contextScore,
        line: null,
        minutes,
        usageRate,
        propType: "Double Double",
        matchupRow: base,
      })
      doubleDoubleCandidates.push({
        ...base,
        propType: "Double Double",
        ladder: "Double Double",
        line: null,
        side: "Yes",
        marketKey: "synthetic_double_double",
        probability: ddProb,
        edge: fw.edge,
        minutes,
        usageRate,
        contextScore,
        realismScore,
        finalWeight: fw.finalWeight,
        matchupAdj: Number.isFinite(fw.matchupAdj) ? fw.matchupAdj : 0,
      })
    }

    const tdProb = Math.max(0.006, Math.min(0.20, Math.pow(tdProbRaw, 0.90)))
    if (tdProb >= Math.max(0.015, th.tripleDouble * 0.45)) {
      const minutes = base.minutes ?? readMinutes(base)
      const usageRate = base.usageRate ?? readUsageRate(base)
      const contextScore = base.contextScore ?? readContextScore(base)
      const realismScore = base.realismScore ?? computeRealismScore({
        usageRate: usageRate == null ? 20 : usageRate,
        minutes: minutes == null ? 24 : minutes,
        row: base,
        propType: "Triple Double",
      })
      const fw = computeFinalWeight({
        realismScore,
        predictedProbability: tdProb,
        edge: 0,
        contextScore,
        line: null,
        minutes,
        usageRate,
        propType: "Triple Double",
        matchupRow: base,
      })
      tripleDoubleCandidates.push({
        ...base,
        propType: "Triple Double",
        ladder: "Triple Double",
        line: null,
        side: "Yes",
        marketKey: "synthetic_triple_double",
        probability: tdProb,
        edge: fw.edge,
        minutes,
        usageRate,
        contextScore,
        realismScore,
        finalWeight: fw.finalWeight,
        matchupAdj: Number.isFinite(fw.matchupAdj) ? fw.matchupAdj : 0,
      })
    }
  }

  return {
    doubleDoubleCandidates: dedupeCandidates(doubleDoubleCandidates).sort(sortByProbDesc),
    tripleDoubleCandidates: dedupeCandidates(tripleDoubleCandidates).sort(sortByProbDesc),
  }
}

/**
 * Extended NBA opportunity pools from scored `completeUniverse` (same rows as board slices).
 * Does not change core/ladder construction — additive pools only.
 */
function mineNbaExtendedOpportunityPools(completeUniverse, thBase) {
  const universe = Array.isArray(completeUniverse) ? completeUniverse : []
  const TH = {
    ...thBase,
    doubleDouble: thBase.doubleDouble ?? 0.48,
    tripleDouble: thBase.tripleDouble ?? 0.28,
  }

  let doubleDoubleCandidates = dedupeCandidates(
    fillPoolRelaxed(universe, isDoubleDoubleRow, TH, TH.doubleDouble)
  ).sort(sortByProbDesc)

  let tripleDoubleCandidates = dedupeCandidates(
    fillPoolRelaxed(universe, isTripleDoubleRow, TH, TH.tripleDouble)
  ).sort(sortByProbDesc)

  if (!doubleDoubleCandidates.length || !tripleDoubleCandidates.length) {
    const synthetic = buildSyntheticDoubleTripleFromCore(universe, TH)
    if (!doubleDoubleCandidates.length) doubleDoubleCandidates = synthetic.doubleDoubleCandidates
    if (!tripleDoubleCandidates.length) tripleDoubleCandidates = synthetic.tripleDoubleCandidates
  }

  const praCandidates = dedupeCandidates(
    fillPoolRelaxed(universe, isPraLadderTierRow, TH, TH.ladder)
  ).sort(sortByProbDesc)

  const altPointsCandidates = dedupeCandidates(
    fillPoolRelaxed(universe, isAltPointsLadderRow, TH, TH.ladder)
  ).sort(sortByProbDesc)

  const altThreesCandidates = dedupeCandidates(
    fillPoolRelaxed(universe, isAltThreesLadderRow, TH, TH.ladder)
  ).sort(sortByProbDesc)

  const comboCandidates = dedupeCandidates(
    fillPoolRelaxed(universe, isComboStatRow, TH, TH.ladder)
  ).sort(sortByProbDesc)

  return {
    doubleDoubleCandidates,
    tripleDoubleCandidates,
    praCandidates,
    altPointsCandidates,
    altThreesCandidates,
    comboCandidates,
  }
}

module.exports = {
  mineNbaExtendedOpportunityPools,
  praTierLabel,
  altPointsTierLabel,
  isComboStatRow,
}
