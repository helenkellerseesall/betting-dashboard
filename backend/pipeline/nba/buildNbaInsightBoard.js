"use strict"

console.log("ACTIVE:", __filename)

const { computeEdge } = require("../utils/edge")
const { nbaRowModelProbability, nbaRowEdge, nbaRowLadderLabel } = require("./nbaModelSignals")
const { applyEdgeToNbaRows } = require("./applyNbaRowEdge")

const DEFAULT_CORE_PROB_THRESHOLD = 0.58
const CORE_INSIGHT_CAP = 18

/** Same stat families as opportunity board (Points / Rebounds / Assists / Threes / PRA), not ladder-only. */
function isNbaCoreStatProp(propType) {
  const t = String(propType || "").toLowerCase()
  if (!t) return false
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return true
  if (/three|3-pt|3pt/.test(t)) return true
  if (/rebound/.test(t)) return true
  if (/assist/.test(t)) return true
  if (/point/.test(t)) return true
  return false
}

function clampStr(v) {
  const s = String(v == null ? "" : v).trim()
  return s ? s : null
}

function insightRowFromBoardRow(row, tag) {
  if (!row) return null
  const player = clampStr(row.player)
  if (!player) return null
  const p = nbaRowModelProbability(row)
  if (!Number.isFinite(p)) return null
  const edge = nbaRowEdge(row)
  const whyParts = []
  if (Number.isFinite(edge) && edge > 0) whyParts.push(`edge ${edge.toFixed(3)}`)
  const tier = clampStr(row.confidenceTier)
  if (tier) whyParts.push(`tier ${tier}`)
  const w = Array.isArray(row.whyItRates) && row.whyItRates.length ? row.whyItRates.slice(0, 2) : []
  for (const x of w) whyParts.push(String(x))

  const rf = row.recentForm && typeof row.recentForm === "object" ? { ...row.recentForm } : row.recentForm ?? null
  const fw = Number.isFinite(Number(row.finalWeight)) ? Number(row.finalWeight) : null

  return {
    tag,
    player,
    team: clampStr(row.team),
    opponent: clampStr(row.opponent ?? row.opponentTeam),
    eventId: clampStr(row.eventId),
    propType: clampStr(row.propType) || "Prop",
    prediction: nbaRowLadderLabel(row),
    line: row.line != null && row.line !== "" ? row.line : null,
    side: clampStr(row.side),
    book: clampStr(row.book),
    probability: p,
    edge: Number.isFinite(edge) ? edge : null,
    finalWeight: fw,
    recentForm: rf,
    why: whyParts.length ? whyParts.join(" · ") : "model + market context",
  }
}

/**
 * Map `buildNbaOpportunityBoard` coreCandidates (already scored) into insight rows.
 */
function insightRowFromCoreCandidate(c) {
  if (!c || typeof c !== "object") return null
  const player = clampStr(c.player)
  if (!player) return null
  const p = Number(c.probability)
  if (!Number.isFinite(p)) return null
  const edge = c.edge != null ? Number(c.edge) : null
  const propType = clampStr(c.propType) || "Prop"
  const ladder = clampStr(c.ladder)
  const line = c.line
  const prediction =
    ladder ||
    (line != null && String(line).trim() !== "" ? `${propType} ${line}` : propType)

  const whyParts = []
  if (Number.isFinite(edge) && edge > 0) whyParts.push(`edge ${edge.toFixed(3)}`)
  if (clampStr(c.book)) whyParts.push(String(c.book))
  const rf = c.recentForm && typeof c.recentForm === "object" ? { ...c.recentForm } : c.recentForm ?? null
  const fw = Number.isFinite(Number(c.finalWeight)) ? Number(c.finalWeight) : null
  return {
    tag: "opportunity-core",
    player,
    team: clampStr(c.team),
    opponent: clampStr(c.opponent),
    eventId: clampStr(c.eventId),
    propType,
    prediction,
    line: line != null && line !== "" ? line : null,
    side: clampStr(c.side),
    book: clampStr(c.book),
    probability: p,
    edge: Number.isFinite(edge) ? edge : null,
    finalWeight: fw,
    recentForm: rf,
    why: whyParts.length ? whyParts.join(" · ") : "opportunity core",
  }
}

function takeTop(rows, n, scoreFn) {
  const xs = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ r, s: scoreFn(r) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => b.s - a.s)
  const out = []
  const seen = new Set()
  for (const { r } of xs) {
    const ir = insightRowFromBoardRow(r, "board")
    if (!ir) continue
    const k = `${ir.player.toLowerCase()}__${ir.propType}__${ir.prediction}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(ir)
    if (out.length >= n) break
  }
  return out
}

function scoreRow(row) {
  const p = nbaRowModelProbability(row) ?? 0
  const e = nbaRowEdge(row) ?? 0
  return p * 1000 + e * 60
}

function canonicalStatForMatch(propType) {
  const t = String(propType || "").toLowerCase()
  if (/three|3-pt|3pt/.test(t)) return "threes"
  if (/rebound/.test(t)) return "rebounds"
  if (/assist/.test(t) && !/pra|points.*rebounds|pts.*reb.*ast/.test(t)) return "assists"
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(t)) return "pra"
  if (/point/.test(t)) return "points"
  return t.trim() || "unknown"
}

function insightMatchKey(x) {
  return [
    String(x?.player || "").toLowerCase().trim(),
    String(x?.eventId || "").trim(),
    canonicalStatForMatch(x?.propType),
    String(x?.line ?? "").trim(),
    String(x?.side || "").toLowerCase().trim(),
  ].join("|")
}

function insightLooseMatchKey(x) {
  return [
    String(x?.player || "").toLowerCase().trim(),
    canonicalStatForMatch(x?.propType),
    String(x?.line ?? "").trim(),
    String(x?.side || "").toLowerCase().trim(),
  ].join("|")
}

function buildOpportunityCandidateIndex(nbaOpportunityBoard) {
  const idx = new Map()
  const loose = new Map()
  if (!nbaOpportunityBoard || typeof nbaOpportunityBoard !== "object") return { full: idx, loose }
  const pools = [
    nbaOpportunityBoard.ladderCandidates,
    nbaOpportunityBoard.pointsLadderCandidates,
    nbaOpportunityBoard.reboundsLadderCandidates,
    nbaOpportunityBoard.assistsLadderCandidates,
    nbaOpportunityBoard.threesLadderCandidates,
    nbaOpportunityBoard.praLadderCandidates,
    nbaOpportunityBoard.coreCandidates,
  ]
  for (const pool of pools) {
    for (const c of Array.isArray(pool) ? pool : []) {
      if (!c || typeof c !== "object") continue
      idx.set(insightMatchKey(c), c)
      const lk = insightLooseMatchKey(c)
      if (!loose.has(lk)) loose.set(lk, c)
    }
  }
  return { full: idx, loose }
}

function mergeInsightRowWithCandidate(ir, candByKey) {
  if (!ir || typeof ir !== "object") return ir
  const c =
    candByKey.full.get(insightMatchKey(ir)) ||
    candByKey.loose.get(insightLooseMatchKey(ir)) ||
    null
  if (!c) return ir
  const rf =
    ir.recentForm && typeof ir.recentForm === "object"
      ? ir.recentForm
      : c.recentForm && typeof c.recentForm === "object"
        ? { ...c.recentForm }
        : ir.recentForm ?? null
  const irFw = ir.finalWeight
  const cFw = c.finalWeight
  const useCandFw =
    ir.tag === "board" ||
    irFw == null ||
    !Number.isFinite(Number(irFw)) ||
    Number(irFw) === 0
  const fw = useCandFw && Number.isFinite(Number(cFw))
    ? Number(cFw)
    : Number.isFinite(Number(irFw))
      ? Number(irFw)
      : Number.isFinite(Number(cFw))
        ? Number(cFw)
        : null
  return {
    ...ir,
    line: ir.line != null ? ir.line : c.line != null ? c.line : null,
    side: ir.side || c.side || null,
    book: ir.book || c.book || null,
    finalWeight: fw,
    recentForm: rf,
  }
}

function enrichInsightRows(rows, candByKey) {
  return (Array.isArray(rows) ? rows : []).map((r) => mergeInsightRowWithCandidate(r, candByKey))
}

/**
 * Core insight section: prefer `nbaOpportunityBoard.coreCandidates` (Points / Rebounds / Assists / Threes / PRA),
 * threshold + sort + cap — so insight core stays aligned when slice `corePropsBoard` is thin.
 */
function buildCorePropsInsightsFromOpportunity(nbaOpportunityBoard, fallbackCoreRows, score) {
  const th = Number(nbaOpportunityBoard?.thresholds?.core)
  const probThreshold = Number.isFinite(th) && th > 0 && th < 1 ? th : DEFAULT_CORE_PROB_THRESHOLD

  const raw = Array.isArray(nbaOpportunityBoard?.coreCandidates) ? [...nbaOpportunityBoard.coreCandidates] : []
  if (!raw.length) {
    return takeTop(fallbackCoreRows, 14, score)
  }

  const byCoreStat = raw.filter((c) => isNbaCoreStatProp(c?.propType))
  let pool = byCoreStat.length ? byCoreStat : raw

  let filtered = pool.filter((c) => Number(c.probability) > probThreshold)
  if (!filtered.length) {
    filtered = pool.filter((c) => Number.isFinite(Number(c.probability)))
  }

  filtered.sort((a, b) => (b.finalWeight ?? 0) - (a.finalWeight ?? 0))

  const sliced = filtered.slice(0, CORE_INSIGHT_CAP)
  const out = sliced.map((c) => insightRowFromCoreCandidate(c)).filter(Boolean)
  if (out.length) return out

  return takeTop(fallbackCoreRows, 14, score)
}

/**
 * Lightweight curated insight surface (NBA). Mirrors the *role* of `buildMlbInsightBoard`:
 * human-readable sections built from board rows and (when provided) opportunity `coreCandidates`.
 */
function buildNbaInsightBoard(input = {}) {
  const ladderBoard = Array.isArray(input?.ladderBoard) ? input.ladderBoard : []
  const corePropsBoard = Array.isArray(input?.corePropsBoard) ? input.corePropsBoard : []
  const specialBoard = Array.isArray(input?.specialBoard) ? input.specialBoard : []
  const firstBasketBoard = Array.isArray(input?.firstBasketBoard) ? input.firstBasketBoard : []
  const nbaOpportunityBoard = input?.nbaOpportunityBoard && typeof input.nbaOpportunityBoard === "object" ? input.nbaOpportunityBoard : null

  applyEdgeToNbaRows(ladderBoard)
  applyEdgeToNbaRows(corePropsBoard)
  applyEdgeToNbaRows(specialBoard)
  applyEdgeToNbaRows(firstBasketBoard)

  const score = scoreRow

  const ladderBoardInsights = takeTop(ladderBoard, 18, score)
  const coreBoardInsights = buildCorePropsInsightsFromOpportunity(nbaOpportunityBoard, corePropsBoard, score)
  const specialBoardInsights = takeTop(specialBoard, 10, score)
  const firstBasketInsights = takeTop(firstBasketBoard, 8, score)

  const pseudoCoreForBest = (Array.isArray(nbaOpportunityBoard?.coreCandidates) ? nbaOpportunityBoard.coreCandidates : []).map((c) => {
    const probability = Number(c.probability)
    const odds = c.odds
    const row = {
      ...c,
      probability: Number.isFinite(probability) ? probability : null,
      adjustedConfidenceScore: Number.isFinite(probability) ? probability : null,
      player: c.player,
      propType: c.propType,
      eventId: c.eventId,
      team: c.team,
      opponent: c.opponent,
      odds,
      line: c.line,
      marketKey: c.marketKey,
      book: c.book,
      side: c.side,
      propVariant: "base",
    }
    if (Number.isFinite(probability)) {
      row.edge = computeEdge(probability, odds)
    }
    return row
  })

  const bestOverallPlays = takeTop(
    [...ladderBoard, ...corePropsBoard, ...pseudoCoreForBest, ...specialBoard, ...firstBasketBoard],
    12,
    score
  )

  const candByKey = buildOpportunityCandidateIndex(nbaOpportunityBoard)

  return {
    bestOverallPlays: enrichInsightRows(bestOverallPlays, candByKey),
    ladderBoard: enrichInsightRows(ladderBoardInsights, candByKey),
    corePropsBoard: enrichInsightRows(coreBoardInsights, candByKey),
    specialBoard: enrichInsightRows(specialBoardInsights, candByKey),
    firstBasketBoard: enrichInsightRows(firstBasketInsights, candByKey),
  }
}

module.exports = {
  buildNbaInsightBoard,
}
