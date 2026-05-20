"use strict"

/**
 * backlogReader.js — Operator Cockpit Phase 1 (2026-05-20).
 *
 * READ-ONLY canonical readers for:
 *   docs/EXECUTION_BACKLOG.md  → active slice + lane + queue + risk refs
 *   docs/BETTOR_BACKLOG.md     → OPEN + IN-SLICE BBL-NNNN entries
 *   docs/OPEN_RISKS.md         → OPEN + MITIGATED R-NNN-N entries
 *   ACTIVE_PHASE.md (repo root) → operator-cemented active phase doc
 *
 * Anti-shadow: NEVER writes; only reads from canonical authority paths.
 */

const fs   = require("fs")
const path = require("path")

const REPO = path.join(__dirname, "..", "..", "..")
const DOCS = path.join(REPO, "docs")

const EXEC_BACKLOG    = path.join(DOCS, "EXECUTION_BACKLOG.md")
const BETTOR_BACKLOG  = path.join(DOCS, "BETTOR_BACKLOG.md")
const OPEN_RISKS      = path.join(DOCS, "OPEN_RISKS.md")
const ACTIVE_PHASE    = path.join(REPO, "ACTIVE_PHASE.md")

function readSafe(p) { try { return fs.readFileSync(p, "utf8") } catch (_) { return null } }

function readActiveSlice() {
  const src = readSafe(EXEC_BACKLOG) || ""
  const m = src.match(/## Active slice([\s\S]*?)## Slice queue/)
  if (!m) return null
  const block = m[1]
  const get = (k) => {
    const r = block.match(new RegExp("\\|\\s*" + k + "\\s*\\|\\s*([^|]+?)\\s*\\|"))
    return r ? r[1].trim() : null
  }
  return {
    slice:        get("slice"),
    lane:         get("lane"),
    owner:        get("owner"),
    started:      get("started"),
    status:       get("status"),
    tagBaseline:  get("tag-baseline"),
    backlogRef:   get("backlog-ref"),
    nextCommand:  (get("next-command") || "").replace(/^`|`$/g, ""),
    riskRefs:     (get("risk-refs") || "").split(",").map(s => s.trim()).filter(Boolean),
  }
}

function readSliceQueue() {
  const src = readSafe(EXEC_BACKLOG) || ""
  const m = src.match(/## Slice queue[\s\S]*?\n\n([\s\S]*?)\n## Lane log/)
  if (!m) return []
  return m[1].split("\n").filter(l => l.startsWith("|") && !/^\|\s*-/.test(l) && !/^\|\s*seq\s*\|/.test(l))
    .map(l => l.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1))
    .map(cells => ({ seq: cells[0], slice: cells[1], lane: cells[2], blockedBy: cells[3], expectedOutcome: cells[4] }))
}

function readBacklog() {
  const src = readSafe(BETTOR_BACKLOG) || ""
  const blocks = src.split(/^---\s*$/m).slice(1)
  const out = []
  for (const blk of blocks) {
    const idM = blk.match(/^id:\s*(BBL-\d+)/m)
    if (!idM) continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    out.push({
      id:               idM[1],
      submittedAt:      get("submittedAt"),
      submitter:        get("submitter"),
      lane:             get("lane"),
      title:            get("title"),
      state:            get("state"),
      linkedSlice:      get("linkedSlice"),
      cognitionCategory:get("cognitionCategory"),
      severity:         get("severity"),
      priority:         get("priority"),
    })
  }
  return out
}

function readOpenBacklogIds() {
  return readBacklog().filter(e => e.state === "OPEN" || e.state === "IN-SLICE").map(e => e.id)
}

function readOpenRisks() {
  const src = readSafe(OPEN_RISKS) || ""
  const blocks = src.split(/^---\s*$/m).slice(1)
  const out = []
  for (const blk of blocks) {
    const idM = blk.match(/^id:\s*(R-\d+-\d+)/m)
    const stM = blk.match(/^state:\s*(OPEN|MITIGATED|CLOSED)/m)
    if (!idM || !stM) continue
    if (stM[1] === "CLOSED") continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    out.push({
      id:       idM[1],
      state:    stM[1],
      lane:     get("lane"),
      slice:    get("slice"),
      title:    get("title"),
      openedAt: get("openedAt"),
    })
  }
  return out
}

function readActivePhase() {
  const src = readSafe(ACTIVE_PHASE)
  if (!src) return { exists: false, headline: null, lines: 0 }
  const lines = src.split("\n")
  const headline = lines.find(l => /^#\s+/.test(l)) || lines[0] || null
  return { exists: true, headline, lines: lines.length, excerpt: lines.slice(0, 20).join("\n") }
}

module.exports = Object.freeze({
  readActiveSlice,
  readSliceQueue,
  readBacklog,
  readOpenBacklogIds,
  readOpenRisks,
  readActivePhase,
})
