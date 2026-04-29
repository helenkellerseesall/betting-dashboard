"use strict"

const {
  classifyBoardRow,
  isSpecialRow,
  isPlayerFirstBasketRow,
  isTeamFirstBasketRow,
} = require("../markets/boardClassification")
const { nbaRowModelProbability } = require("./nbaModelSignals")
const { buildNbaEventTeamIndex, enrichNbaRowWithEventTeams } = require("./nbaEventTeamResolve")
const { inferNbaStatPropTypeFromMarket, isNbaStatLadderRow } = require("./nbaStatLadder")
const { buildSpecialtyPlayerTeamIndex } = require("../resolution/playerTeamResolution")
const fs = require("fs")

function loadNbaSnapshotFromDisk(snapshotPath) {
  try {
    if (!snapshotPath || !fs.existsSync(snapshotPath)) return null
    const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf8"))
    const data = raw?.data && typeof raw.data === "object" ? raw.data : null
    return data
  } catch {
    return null
  }
}

function dedupeNbaRows(rows) {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue
    const key = [
      row.eventId,
      row.player,
      row.propType,
      row.marketKey,
      row.line,
      row.side,
      row.book,
    ]
      .map((x) => String(x == null ? "" : x).trim())
      .join("|")
    if (!key.replace(/\|/g, "")) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function mergeSnapshotRowPools(snapshot) {
  const chunks = []
  const push = (arr) => {
    if (Array.isArray(arr) && arr.length) chunks.push(...arr)
  }
  push(snapshot?.finalPlayableRows)
  push(snapshot?.bestProps)
  push(snapshot?.playableProps)
  push(snapshot?.strongProps)
  push(snapshot?.eliteProps)
  push(snapshot?.props)
  push(snapshot?.rawProps)
  return dedupeNbaRows(chunks)
}

function normalizeNbaSnapshotRow(row, eventIndex, playerTeamIndex) {
  let out = enrichNbaRowWithEventTeams(row, eventIndex, playerTeamIndex)
  if (!String(out.propType || "").trim()) {
    const inferred = inferNbaStatPropTypeFromMarket(out)
    if (inferred) out = { ...out, propType: inferred }
  }
  return out
}

function rowHasBoardBasics(row) {
  if (!row || typeof row !== "object") return false
  if (!String(row.player || "").trim()) return false
  if (!String(row.propType || row.marketKey || "").trim()) return false
  return true
}

function sortRowsByModelDesc(rows, limit) {
  const xs = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const pa = nbaRowModelProbability(a) ?? 0
    const pb = nbaRowModelProbability(b) ?? 0
    return pb - pa
  })
  return typeof limit === "number" && limit > 0 ? xs.slice(0, limit) : xs
}

/**
 * Derive board-shaped row arrays from a persisted / in-memory NBA snapshot object.
 */
function buildNbaBoardSlicesFromSnapshot(snapshot = {}) {
  const eventIndex = buildNbaEventTeamIndex(snapshot?.events)
  const merged = mergeSnapshotRowPools(snapshot)
  const playerTeamIndex = buildSpecialtyPlayerTeamIndex(merged)
  const completeUniverse = merged.map((r) => normalizeNbaSnapshotRow(r, eventIndex, playerTeamIndex))
  const pool = completeUniverse.filter(rowHasBoardBasics)

  const corePropsBoard = []
  const ladderBoard = []
  const specialBoard = []
  const firstBasketBoard = []

  for (const row of pool) {
    const c = classifyBoardRow(row)
    if (isPlayerFirstBasketRow(row) || isTeamFirstBasketRow(row)) {
      firstBasketBoard.push(row)
      continue
    }
    if (c.boardFamily === "ladder" || isNbaStatLadderRow(row)) {
      ladderBoard.push(row)
      continue
    }
    if (c.boardFamily === "special" || isSpecialRow(row)) {
      specialBoard.push(row)
      continue
    }
    if (c.boardFamily === "standard") {
      const pv = String(row?.propVariant || "base").toLowerCase()
      if (pv === "base" || pv === "default") corePropsBoard.push(row)
      continue
    }
  }

  return {
    completeUniverse,
    corePropsBoard: sortRowsByModelDesc(corePropsBoard, 60),
    ladderBoard: sortRowsByModelDesc(ladderBoard, 120),
    specialBoard: sortRowsByModelDesc(specialBoard, 40),
    firstBasketBoard: sortRowsByModelDesc(firstBasketBoard, 30),
  }
}

module.exports = {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
}
