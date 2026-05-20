#!/usr/bin/env node
"use strict"

/**
 * checkpointPersist.js — operational checkpoint persistence.
 *
 * Writes .checkpoint/operational_state_<tag>.json on every checkpoint.
 * This is the replayable artifact a fresh session reads first; it captures
 * the orchestration state that the structured-checkpoint footer encodes
 * (active slice, lane, open risks, BBL refs, term-1/term-2/term-3 status).
 *
 * Designed to be called inline from ops:checkpoint OR standalone after a
 * slice ships.
 *
 * Usage:
 *   node backend/scripts/ops/checkpointPersist.js [tag]
 *
 * If no tag passed, writes .checkpoint/operational_state_latest.json.
 *
 * Phase OO-2 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const cp   = require("child_process")

const REPO = path.join(__dirname, "..", "..", "..")
const DOCS = path.join(REPO, "docs")
const CHECKPOINT_DIR = path.join(REPO, ".checkpoint")

const EXEC_PATH  = path.join(DOCS, "EXECUTION_BACKLOG.md")
const BBL_PATH   = path.join(DOCS, "BETTOR_BACKLOG.md")
const RISKS_PATH = path.join(DOCS, "OPEN_RISKS.md")

function getField(block, k) {
  const r = block.match(new RegExp("\\|\\s*" + k + "\\s*\\|\\s*([^|]+?)\\s*\\|"))
  return r ? r[1].trim() : null
}

function parseActiveSlice() {
  const src = fs.readFileSync(EXEC_PATH, "utf8")
  const m = src.match(/## Active slice([\s\S]*?)## Slice queue/)
  if (!m) return null
  const block = m[1]
  return {
    slice:        getField(block, "slice"),
    lane:         getField(block, "lane"),
    owner:        getField(block, "owner"),
    started:      getField(block, "started"),
    status:       getField(block, "status"),
    tagBaseline:  getField(block, "tag-baseline"),
    backlogRef:   getField(block, "backlog-ref"),
    nextCommand:  getField(block, "next-command"),
  }
}

function parseOpenRisks() {
  if (!fs.existsSync(RISKS_PATH)) return []
  const src = fs.readFileSync(RISKS_PATH, "utf8")
  const blocks = src.split(/^---\s*$/m).slice(1)
  const out = []
  for (const blk of blocks) {
    if (!/^id:\s*R-/m.test(blk)) continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    const e = { id: get("id"), state: get("state"), lane: get("lane"), slice: get("slice"), title: get("title") }
    if (e.state === "OPEN" || e.state === "MITIGATED") out.push(e)
  }
  return out
}

function parseOpenBacklog() {
  const src = fs.readFileSync(BBL_PATH, "utf8")
  const blocks = src.split(/^---\s*$/m).slice(1)
  const out = []
  for (const blk of blocks) {
    if (!/^id:\s*BBL-/m.test(blk)) continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    const e = { id: get("id"), state: get("state"), lane: get("lane"), linkedSlice: get("linkedSlice"), title: get("title") }
    if (e.state === "OPEN" || e.state === "IN-SLICE") out.push(e)
  }
  return out
}

function safeGit(args) {
  try { return cp.execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim() }
  catch (_) { return null }
}

function main() {
  if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })

  const tag    = process.argv[2] || "latest"
  const today  = new Date().toISOString()
  const branch = safeGit(["rev-parse", "--abbrev-ref", "HEAD"])
  const commit = safeGit(["rev-parse", "HEAD"])
  const status = safeGit(["status", "--porcelain"])
  const dirty  = !!(status && status.length > 0)

  const snapshot = {
    schema:     "operational_state.v1",
    persistedAt: today,
    tag,
    repo: { branch, commit, dirty, dirtyFileCount: dirty ? status.split("\n").length : 0 },
    activeSlice: parseActiveSlice(),
    openRisks:   parseOpenRisks(),
    openBacklog: parseOpenBacklog(),
    terms: {
      term1: { command: "cd backend && npm run ops:term1", purpose: "read-only health introspection" },
      term2: { command: "cd backend && npm run ops:term2", purpose: "pre-phase ritual (full historical depth)" },
      term3: { command: "cd backend && npm run ops:checkpoint", purpose: "checkpoint seal" },
    },
    canonicalSurfaces: {
      laneIndex:              "docs/LANE_INDEX.md",
      executionBacklog:       "docs/EXECUTION_BACKLOG.md",
      bettorBacklog:          "docs/BETTOR_BACKLOG.md",
      openRisks:              "docs/OPEN_RISKS.md",
      footerTemplate:         "docs/OPERATIONAL_FOOTER_TEMPLATE.md",
      runtimeRegistry:        "backend/scripts/ops/runtime.js",
      orchestrationVerifier:  "backend/scripts/verifyOperationalOrchestration.js",
    },
  }

  const outPath = path.join(CHECKPOINT_DIR, `operational_state_${tag}.json`)
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2))
  // Also overwrite the "latest" pointer so fresh sessions can read a stable name.
  if (tag !== "latest") {
    fs.writeFileSync(path.join(CHECKPOINT_DIR, "operational_state_latest.json"), JSON.stringify(snapshot, null, 2))
  }

  console.log("checkpoint persisted: " + path.relative(REPO, outPath))
  console.log("  active slice: " + (snapshot.activeSlice?.slice || "none"))
  console.log("  active lane:  " + (snapshot.activeSlice?.lane  || "none"))
  console.log("  open risks:   " + (snapshot.openRisks.length ? snapshot.openRisks.map(r => r.id).join(", ") : "none"))
  console.log("  open backlog: " + (snapshot.openBacklog.length ? snapshot.openBacklog.map(b => b.id).join(", ") : "none"))
}

if (require.main === module) main()
module.exports = { parseActiveSlice, parseOpenRisks, parseOpenBacklog }
