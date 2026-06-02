"use strict"

/**
 * stateHydrator.js — Phase Runtime-Supervisor-B5 (2026-05-20).
 *
 * Collects canonical supervisor state from the existing single-source-of-
 * truth surfaces. Pure read-only. Deterministic given the same input files.
 *
 * Canonical sources (no parallel state graphs allowed):
 *   docs/EXECUTION_BACKLOG.md          → activeSlice, activeLane
 *   docs/OPEN_RISKS.md                 → openRisks (OPEN + MITIGATED)
 *   docs/BETTOR_BACKLOG.md             → openBacklog (OPEN + IN-SLICE)
 *   backend/runtime/tracking/mlb_tracked_best_<TODAY>.json → runtimeFreshness
 *
 * Anti-shadow: ALL reads route through these canonical paths. No alternate
 * state sources. No HTTP fetches. No spawn calls.
 */

const fs   = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../../../pipeline/shared/slateDate")

const REPO = path.join(__dirname, "..", "..", "..", "..")
const DOCS = path.join(REPO, "docs")
const EXEC_BACKLOG    = path.join(DOCS, "EXECUTION_BACKLOG.md")
const OPEN_RISKS      = path.join(DOCS, "OPEN_RISKS.md")
const BETTOR_BACKLOG  = path.join(DOCS, "BETTOR_BACKLOG.md")
const TRACKING_DIR    = path.join(REPO, "backend", "runtime", "tracking")

function readActiveSliceLane() {
  try {
    const src = fs.readFileSync(EXEC_BACKLOG, "utf8")
    const m = src.match(/## Active slice([\s\S]*?)## Slice queue/)
    if (!m) return { activeSlice: null, activeLane: null }
    const block = m[1]
    const get = (k) => {
      const r = block.match(new RegExp("\\|\\s*" + k + "\\s*\\|\\s*([^|]+?)\\s*\\|"))
      return r ? r[1].trim() : null
    }
    return { activeSlice: get("slice"), activeLane: get("lane") }
  } catch (_) { return { activeSlice: null, activeLane: null } }
}

function readOpenRisks() {
  try {
    const src = fs.readFileSync(OPEN_RISKS, "utf8")
    const out = []
    const blocks = src.split(/^---\s*$/m).slice(1)
    for (const blk of blocks) {
      const idM = blk.match(/^id:\s*(R-\d+-\d+)/m)
      const stM = blk.match(/^state:\s*(OPEN|MITIGATED|CLOSED)/m)
      if (idM && stM && (stM[1] === "OPEN" || stM[1] === "MITIGATED")) out.push(idM[1])
    }
    return out
  } catch (_) { return [] }
}

function readOpenBacklog() {
  try {
    const src = fs.readFileSync(BETTOR_BACKLOG, "utf8")
    const out = []
    const blocks = src.split(/^---\s*$/m).slice(1)
    for (const blk of blocks) {
      const idM = blk.match(/^id:\s*(BBL-\d+)/m)
      const stM = blk.match(/^state:\s*(OPEN|IN-SLICE|DEFERRED|CLOSED)/m)
      if (idM && stM && (stM[1] === "OPEN" || stM[1] === "IN-SLICE")) out.push(idM[1])
    }
    return out
  } catch (_) { return [] }
}

function readRuntimeFreshness() {
  try {
    // Phase Date-Doctrine-1B — canonical ET slate date
    const today = currentSlateDateEt()
    const p = path.join(TRACKING_DIR, "mlb_tracked_best_" + today + ".json")
    if (!fs.existsSync(p)) return { mlbTrackedBestPath: null, mlbTrackedBestAgeMs: null }
    const stat = fs.statSync(p)
    return { mlbTrackedBestPath: p, mlbTrackedBestAgeMs: Date.now() - stat.mtimeMs }
  } catch (_) { return { mlbTrackedBestPath: null, mlbTrackedBestAgeMs: null } }
}

/**
 * Returns the canonical hydrated state slice (excludes heartbeatAt /
 * heartbeatSeq / contentHash — those are filled by heartbeatWriter).
 *
 * @param {{ instanceId: string, startedAt: string, operatorOverride?: object,
 *           v5LastResult?: object|null, v6LastResult?: object|null }} args
 */
function hydrate(args = {}) {
  const { activeSlice, activeLane } = readActiveSliceLane()
  return {
    schemaVersion: "supervisor-state-v1",
    instanceId:    args.instanceId || null,
    pid:           process.pid,
    host:          require("os").hostname(),
    startedAt:     args.startedAt || new Date().toISOString(),
    activeSlice,
    activeLane,
    operatorOverride: args.operatorOverride || { active: false, reason: null, sinceAt: null },
    v5LastResult:  args.v5LastResult || null,
    v6LastResult:  args.v6LastResult || null,
    runtimeFreshness: readRuntimeFreshness(),
    openRisks:     readOpenRisks(),
    openBacklog:   readOpenBacklog(),
  }
}

module.exports = Object.freeze({
  hydrate,
  readActiveSliceLane,
  readOpenRisks,
  readOpenBacklog,
  readRuntimeFreshness,
})
