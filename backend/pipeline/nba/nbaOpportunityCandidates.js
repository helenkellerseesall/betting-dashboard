"use strict"

const { nbaRowModelProbability, nbaRowEdge, nbaRowLadderLabel } = require("./nbaModelSignals")

function clampStr(v) {
  const s = String(v == null ? "" : v).trim()
  return s ? s : null
}

function ladderCandidateFromRow(row) {
  const player = clampStr(row?.player)
  if (!player) return null
  const probability = nbaRowModelProbability(row)
  if (!Number.isFinite(probability)) return null

  return {
    player,
    team: clampStr(row?.team),
    opponent: clampStr(row?.opponent ?? row?.opponentTeam),
    eventId: clampStr(row?.eventId),
    propType: clampStr(row?.propType) || "Prop",
    ladder: nbaRowLadderLabel(row),
    line: row?.line ?? null,
    side: clampStr(row?.side),
    book: clampStr(row?.book),
    marketKey: clampStr(row?.marketKey),
    probability,
    edge: nbaRowEdge(row),
    odds: Number.isFinite(Number(row?.odds)) ? Number(row.odds) : null,
  }
}

function dedupeCandidates(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (!r) continue
    const key = [
      r.player,
      r.eventId || "",
      r.propType || "",
      r.ladder || "",
      String(r.line ?? ""),
      String(r.odds ?? ""),
      r.book || "",
    ].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

function sortByProbDesc(a, b) {
  return (Number(b?.probability) || 0) - (Number(a?.probability) || 0)
}

module.exports = {
  ladderCandidateFromRow,
  dedupeCandidates,
  sortByProbDesc,
}
