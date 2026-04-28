"use strict"

function buildMlbPitcherCandidates({ rows }) {
  const pitcherRows = (Array.isArray(rows) ? rows : []).filter((r) =>
    String(r?.propType || "").toLowerCase().includes("strikeouts")
  )

  const candidates = []

  for (const row of pitcherRows) {
    if (!row?.player || row?.odds == null) continue

    // baseline metrics
    const kRate = row.pitcherKPercent || 0
    const opponentKRate = row.opponentKPercent || 0
    const innings = row.expectedInnings || 5

    // scoring
    let kScore = 0

    kScore += kRate * 2
    kScore += opponentKRate * 1.5
    kScore += innings * 0.5

    // odds value boost
    if (row.odds > 100) kScore += 1

    candidates.push({
      player: row.player,
      team: row.team,
      eventId: row.eventId,
      odds: row.odds,
      kScore,
    })
  }

  return candidates.sort((a, b) => (b.kScore || 0) - (a.kScore || 0))
}

module.exports = { buildMlbPitcherCandidates }

