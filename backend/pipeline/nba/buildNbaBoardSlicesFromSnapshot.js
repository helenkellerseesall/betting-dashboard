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

  // 2026-05-25 — SHADOW #6+ fix. Stamp canonical statFamily ONCE at the
  // normalization layer (single source of truth). Every downstream consumer
  // (buildNbaBestBetsBoard.resolveStatFamily, marketPropsFromPoolRows,
  // workstationRoutes.buildNbaSnapshotCandidates, buildPlayDisplayBundle.
  // statFamilyKey, leanBestEntry) honors a pre-stamped statFamily before
  // running its own fallback regex. This kills the entire shadow-classifier
  // family at the root: a combo row WITHOUT statFamily ("Points + Rebounds")
  // could previously hit any classifier with a /point/ branch first and be
  // mis-routed to "points". With statFamily="pra" stamped here, no shadow
  // can re-classify it. Order MUST be: triple → two-stat combos → singles.
  if (!String(out.statFamily || "").trim()) {
    const t = String(out.propType || out.marketKey || "").toLowerCase()
    out.statFamily =
        t.includes("points_rebounds_assists") || /\bpra\b/.test(t) ? "pra"
      : t.includes("first_basket") || t.includes("firstbasket") ? "first_basket"
      : t.includes("points_rebounds") || /points.*rebounds|points\s*\+\s*rebounds/.test(t) ? "points_rebounds"
      : t.includes("points_assists")  || /points.*assists|points\s*\+\s*assists/.test(t)   ? "points_assists"
      : t.includes("rebounds_assists")|| /rebounds.*assists|rebounds\s*\+\s*assists/.test(t) ? "rebounds_assists"
      : (t.includes("threes") || t.includes("three") || t.includes("3pt")) ? "threes"
      : t.includes("rebound") ? "rebounds"
      : t.includes("assist")  ? "assists"
      : t.includes("point")   ? "points"
      : null
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

// 2026-05-25 — Slice cache (operator-requested perf fix). Profiling showed
// buildNbaBoardSlicesFromSnapshot is 91% of /api/best-available time (95s
// for 4551 rows). Slices only depend on snapshot — when snapshot fingerprint
// unchanged, identical input → identical output. Cache module-level
// (restart invalidates), keyed by a cheap fingerprint that detects:
//   - snapshot.updatedAt change → odds refreshed
//   - events / rawProps / props count change → slate changed
// On cache hit we skip the 95s rebuild and return in <1ms.
//
// Safety: any change to slicing/normalization code requires `npm run engine:restart`
// (the operator already does this for every cognition mutation — no new step).
let _slicesCache = null
let _slicesCacheKey = null
let _slicesCacheHits = 0
let _slicesCacheMisses = 0

function _fingerprintSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "null"
  const updatedAt = snapshot.updatedAt || ""
  const events = Array.isArray(snapshot.events) ? snapshot.events.length : 0
  const rawProps = Array.isArray(snapshot.rawProps) ? snapshot.rawProps.length : 0
  const props = Array.isArray(snapshot.props) ? snapshot.props.length : 0
  return `${updatedAt}|e=${events}|rp=${rawProps}|p=${props}`
}

function _invalidateSlicesCache() {
  _slicesCache = null
  _slicesCacheKey = null
}

/**
 * Derive board-shaped row arrays from a persisted / in-memory NBA snapshot object.
 */
function buildNbaBoardSlicesFromSnapshot(snapshot = {}) {
  // Cache check — return cached result if snapshot fingerprint unchanged.
  const key = _fingerprintSnapshot(snapshot)
  if (_slicesCache && _slicesCacheKey === key) {
    _slicesCacheHits++
    console.log(`[SLICES-CACHE] HIT  key=${key}  hits=${_slicesCacheHits} misses=${_slicesCacheMisses} (cycle saved: ~95s)`)
    return _slicesCache
  }
  _slicesCacheMisses++
  console.log(`[SLICES-CACHE] MISS key=${key}  hits=${_slicesCacheHits} misses=${_slicesCacheMisses} — rebuilding`)

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

  const result = {
    completeUniverse,
    // IMPORTANT: do not over-trim boards by probability — it collapses ladder tiers and
    // over-selects low-line props. Keep broader boards and let downstream ranking decide.
    corePropsBoard: sortRowsByModelDesc(corePropsBoard, 260),
    ladderBoard: sortRowsByModelDesc(ladderBoard, 800),
    specialBoard: sortRowsByModelDesc(specialBoard, 120),
    firstBasketBoard: sortRowsByModelDesc(firstBasketBoard, 120),
  }

  _slicesCache = result
  _slicesCacheKey = key
  return result
}

module.exports = {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
  _invalidateSlicesCache,
}
