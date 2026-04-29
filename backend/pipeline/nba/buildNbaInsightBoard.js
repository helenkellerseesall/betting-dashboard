"use strict"

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

  return {
    tag,
    player,
    team: clampStr(row.team),
    opponent: clampStr(row.opponent ?? row.opponentTeam),
    eventId: clampStr(row.eventId),
    propType: clampStr(row.propType) || "Prop",
    prediction: nbaRowLadderLabel(row),
    probability: p,
    edge: Number.isFinite(edge) ? edge : null,
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
  return {
    tag: "opportunity-core",
    player,
    team: clampStr(c.team),
    opponent: clampStr(c.opponent),
    eventId: clampStr(c.eventId),
    propType,
    prediction,
    probability: p,
    edge: Number.isFinite(edge) ? edge : null,
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

  filtered.sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0))

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

  return {
    bestOverallPlays,
    ladderBoard: ladderBoardInsights,
    corePropsBoard: coreBoardInsights,
    specialBoard: specialBoardInsights,
    firstBasketBoard: firstBasketInsights,
  }
}

module.exports = {
  buildNbaInsightBoard,
}
