"use strict"

function americanToDecimal(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return null
  if (o > 0) return 1 + (o / 100)
  return 1 + (100 / Math.abs(o))
}

function decimalToAmerican(decimalOdds) {
  const d = Number(decimalOdds)
  if (!Number.isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return -Math.round(100 / (d - 1))
}

function estimateParlayAmericanOdds(legs) {
  const safeLegs = Array.isArray(legs) ? legs : []
  if (!safeLegs.length) return null
  let dec = 1
  for (const leg of safeLegs) {
    const d = americanToDecimal(leg?.odds)
    if (!d) return null
    dec *= d
  }
  return decimalToAmerican(dec)
}

function normalizePlayerKey(row) {
  return String(row?.player || "").trim().toLowerCase()
}

function normalizeTeamKey(row) {
  return String(row?.team || "").trim().toLowerCase()
}

function normalizeEventKey(row) {
  return String(row?.eventId || row?.matchup || "").trim()
}

function isHr(row) {
  return String(row?.propType || "").trim() === "Home Runs"
}

function isTb(row) {
  return String(row?.propType || "").trim() === "Total Bases"
}

function isRbi(row) {
  return String(row?.propType || "").trim() === "RBIs"
}

function isHits(row) {
  return String(row?.propType || "").trim() === "Hits"
}

function isOver(row) {
  return String(row?.side || "").trim().toLowerCase() === "over"
}

function legRankScore(row) {
  // Keep it simple: Phase 3 score leads, then edgeProbability as a tie-break.
  const phase3 = Number(row?.mlbPhase3Score || 0)
  const edge = Number(row?.edgeProbability || 0)
  return phase3 * 100 + edge * 10
}

function pickTop(rows, predicate, limit) {
  const safe = Array.isArray(rows) ? rows : []
  return safe
    .filter((r) => r && predicate(r))
    .sort((a, b) => legRankScore(b) - legRankScore(a))
    .slice(0, Math.max(0, Number(limit) || 0))
}

function buildGroupedIndex(bestProps) {
  const safe = Array.isArray(bestProps) ? bestProps : []
  const groups = new Map() // key -> { rows, eventKey, teamKey }

  for (const row of safe) {
    if (!row) continue
    const eventKey = normalizeEventKey(row)
    const teamKey = normalizeTeamKey(row)
    if (!eventKey && !teamKey) continue
    const key = `${eventKey}||${teamKey}`
    if (!groups.has(key)) groups.set(key, { rows: [], eventKey, teamKey })
    groups.get(key).rows.push(row)
  }

  return [...groups.values()]
}

function buildParlayFromLegs(legs) {
  const safeLegs = Array.isArray(legs) ? legs.filter(Boolean) : []
  const players = [...new Set(safeLegs.map((l) => String(l?.player || "").trim()).filter(Boolean))]
  return {
    legs: safeLegs,
    estimatedOdds: estimateParlayAmericanOdds(safeLegs),
    players
  }
}

function dedupeParlays(parlays) {
  const safe = Array.isArray(parlays) ? parlays : []
  const seen = new Set()
  const out = []

  for (const p of safe) {
    const legs = Array.isArray(p?.legs) ? p.legs : []
    const sig = legs
      .map((l) => `${normalizePlayerKey(l)}|${String(l?.propType || "").trim()}|${String(l?.side || "").trim()}|${String(l?.line ?? "")}`)
      .sort()
      .join("||")
    if (!sig) continue
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(p)
  }

  return out
}

function enforceCorrelationRules(legs) {
  const safeLegs = Array.isArray(legs) ? legs.filter(Boolean) : []
  if (safeLegs.length < 2) return []

  // 1 prop per player
  const seenPlayers = new Set()
  const out = []
  for (const leg of safeLegs) {
    const pk = normalizePlayerKey(leg)
    if (!pk) continue
    if (seenPlayers.has(pk)) continue
    seenPlayers.add(pk)
    out.push(leg)
  }
  return out
}

/**
 * Build MLB parlays from a set of +EV best props.
 * @param {object[]} bestProps
 * @returns {{ safe: object[], mixed: object[], lotto: object[] }}
 */
function buildMlbParlays(bestProps) {
  const safeBest = Array.isArray(bestProps) ? bestProps : []
  const groups = buildGroupedIndex(safeBest)

  const safeParlays = []
  const mixedParlays = []
  const lottoParlays = []

  for (const g of groups) {
    const rows = Array.isArray(g?.rows) ? g.rows : []

    const hr = pickTop(rows, (r) => isHr(r) && isOver(r), 3)
    const tb = pickTop(rows, (r) => isTb(r) && isOver(r), 4)
    const hits = pickTop(rows, (r) => isHits(r), 4)
    const rbi = pickTop(rows, (r) => isRbi(r), 4)

    // A) SAFE (2–3 legs): TB + Hits; allow max 1 HR if available.
    {
      const legs = enforceCorrelationRules([
        ...(tb.slice(0, 1)),
        ...(hits.slice(0, 1)),
        ...(tb.slice(1, 2))
      ])
      if (legs.length >= 2) safeParlays.push(buildParlayFromLegs(legs))

      const withHr = enforceCorrelationRules([
        ...(tb.slice(0, 1)),
        ...(hits.slice(0, 1)),
        ...(hr.slice(0, 1))
      ])
      if (withHr.length >= 2 && withHr.filter(isHr).length <= 1) safeParlays.push(buildParlayFromLegs(withHr))
    }

    // B) MIXED (3–4 legs): 1 HR + 1 TB + 1 RBI/Hits (+ optional extra TB/Hits).
    {
      const base = enforceCorrelationRules([
        ...(hr.slice(0, 1)),
        ...(tb.slice(0, 1)),
        ...(rbi.slice(0, 1).length ? rbi.slice(0, 1) : hits.slice(0, 1))
      ])
      if (base.length >= 3) mixedParlays.push(buildParlayFromLegs(base))

      const four = enforceCorrelationRules([
        ...(hr.slice(0, 1)),
        ...(tb.slice(0, 1)),
        ...(rbi.slice(0, 1).length ? rbi.slice(0, 1) : hits.slice(0, 1)),
        ...(tb.slice(1, 2).length ? tb.slice(1, 2) : hits.slice(1, 2))
      ])
      if (four.length >= 3 && four.length <= 4) mixedParlays.push(buildParlayFromLegs(four))
    }

    // C) LOTTO (3–5 legs): multiple HRs + TB; bias plus-money legs.
    {
      const plusMoney = (r) => Number(r?.odds) >= 150
      const hrPlus = pickTop(rows, (r) => isHr(r) && isOver(r) && plusMoney(r), 5)
      const tbPlus = pickTop(rows, (r) => isTb(r) && isOver(r) && plusMoney(r), 5)
      const extraPlus = pickTop(rows, (r) => plusMoney(r), 10)

      const lotto3 = enforceCorrelationRules([
        ...(hrPlus.slice(0, 2)),
        ...(tbPlus.slice(0, 1))
      ])
      if (lotto3.length >= 3) lottoParlays.push(buildParlayFromLegs(lotto3))

      const lotto4 = enforceCorrelationRules([
        ...(hrPlus.slice(0, 2)),
        ...(tbPlus.slice(0, 1)),
        ...(extraPlus.slice(0, 1))
      ])
      if (lotto4.length >= 3 && lotto4.length <= 4) lottoParlays.push(buildParlayFromLegs(lotto4))

      const lotto5 = enforceCorrelationRules([
        ...(hrPlus.slice(0, 3)),
        ...(tbPlus.slice(0, 1)),
        ...(extraPlus.slice(0, 1))
      ])
      if (lotto5.length >= 3 && lotto5.length <= 5) lottoParlays.push(buildParlayFromLegs(lotto5))
    }
  }

  const safeOut = dedupeParlays(safeParlays).slice(0, 20)
  const mixedOut = dedupeParlays(mixedParlays).slice(0, 20)
  const lottoOut = dedupeParlays(lottoParlays).slice(0, 20)

  return { safe: safeOut, mixed: mixedOut, lotto: lottoOut }
}

module.exports = { buildMlbParlays }

