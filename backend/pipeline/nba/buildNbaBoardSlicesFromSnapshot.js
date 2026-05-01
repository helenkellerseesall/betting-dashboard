"use strict"

console.log("ACTIVE:", __filename)

const {
  classifyBoardRow,
  isSpecialRow,
  isPlayerFirstBasketRow,
  isTeamFirstBasketRow,
} = require("../markets/boardClassification")
const { nbaRowModelProbability } = require("./nbaModelSignals")
const {
  buildNbaEventTeamIndex,
  buildNbaEventGameContextMap,
  inferNbaEventGameContextFromPropRows,
  mergeNbaEventGameContextMaps,
  enrichNbaRowWithEventTeams,
  attachNbaEventGameContextToRow,
  enrichNbaRowTeamFromVoteAfterContext,
  enrichNbaRowStatLayerInputs,
} = require("./nbaEventTeamResolve")
const { inferNbaStatPropTypeFromMarket, isNbaStatLadderRow } = require("./nbaStatLadder")
const { buildSpecialtyPlayerTeamIndex } = require("../resolution/playerTeamResolution")
const fs = require("fs")
const path = require("path")

let _nbaProjectionsCache = null

function normalizePlayerKey(name) {
  return String(name || "").trim().toLowerCase()
}

function loadNbaPlayerProjections() {
  if (_nbaProjectionsCache) return _nbaProjectionsCache
  try {
    const p = path.join(__dirname, "..", "..", "data", "nbaPlayerProjections.json")
    if (!fs.existsSync(p)) {
      _nbaProjectionsCache = { defaults: { projectedMinutes: 26, usageRate: 19, role: "wing" }, players: {} }
      return _nbaProjectionsCache
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8"))
    const defaults = raw?.defaults && typeof raw.defaults === "object" ? raw.defaults : {}
    const players = raw?.players && typeof raw.players === "object" ? raw.players : {}
    _nbaProjectionsCache = {
      defaults: {
        projectedMinutes: Number(defaults.projectedMinutes) || 26,
        usageRate: Number(defaults.usageRate) || 19,
        role: String(defaults.role || "wing").trim().toLowerCase() || "wing",
      },
      players,
    }
    return _nbaProjectionsCache
  } catch {
    _nbaProjectionsCache = { defaults: { projectedMinutes: 26, usageRate: 19, role: "wing" }, players: {} }
    return _nbaProjectionsCache
  }
}

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

function normalizeNbaSnapshotRow(row, eventIndex, playerTeamIndex, gameContextMap) {
  const proj = loadNbaPlayerProjections()
  const key = normalizePlayerKey(row?.player)
  const p = proj.players[key]

  let out = { ...row }
  const teamFromProj = String(p?.team || "").trim()
  if (!String(out.team || "").trim() && teamFromProj) {
    out.team = teamFromProj
  }

  out = enrichNbaRowWithEventTeams(out, eventIndex, playerTeamIndex)
  out = attachNbaEventGameContextToRow(out, gameContextMap)
  out = enrichNbaRowTeamFromVoteAfterContext(out, playerTeamIndex)

  if (!String(out.propType || "").trim()) {
    const inferred = inferNbaStatPropTypeFromMarket(out)
    if (inferred) out = { ...out, propType: inferred }
  }

  // Temporary projections layer: merge projectedMinutes + usageRate for realism ranking.
  // This is intentionally explicit data (static JSON), not guessed per-row.
  const hasMinutes =
    out.projectedMinutes != null || out.minutesProjection != null || out.minutes != null || out.expectedMinutes != null
  const hasUsage = out.usageRate != null || out.playerUsage != null || out.usage != null || out.roleUsagePct != null

  if (!hasMinutes) {
    const m = Number(p?.projectedMinutes ?? proj.defaults.projectedMinutes)
    if (Number.isFinite(m) && m > 0) out = { ...out, projectedMinutes: m }
  }
  if (!hasUsage) {
    const u = Number(p?.usageRate ?? proj.defaults.usageRate)
    if (Number.isFinite(u) && u > 0) out = { ...out, usageRate: u }
  }

  out = enrichNbaRowStatLayerInputs(out)

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
  const gameContextFromEvents = buildNbaEventGameContextMap(snapshot?.events)
  const gameContextFromProps = inferNbaEventGameContextFromPropRows(merged)
  const gameContextMap = mergeNbaEventGameContextMaps(gameContextFromEvents, gameContextFromProps)
  const playerTeamIndex = buildSpecialtyPlayerTeamIndex(merged)
  const completeUniverse = merged.map((r) => normalizeNbaSnapshotRow(r, eventIndex, playerTeamIndex, gameContextMap))
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
    // IMPORTANT: do not over-trim boards by probability — it collapses ladder tiers and
    // over-selects low-line props. Keep broader boards and let downstream ranking decide.
    corePropsBoard: sortRowsByModelDesc(corePropsBoard, 260),
    ladderBoard: sortRowsByModelDesc(ladderBoard, 800),
    specialBoard: sortRowsByModelDesc(specialBoard, 120),
    firstBasketBoard: sortRowsByModelDesc(firstBasketBoard, 120),
  }
}

module.exports = {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
}
