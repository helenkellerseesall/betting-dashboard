#!/usr/bin/env node
"use strict"

/**
 * laneSync.js — atomic lane-handoff propagation.
 *
 * Records a lane transition for the currently active slice and propagates
 * it to all three continuity surfaces in one pass:
 *
 *   1. Mutates Active-slice `lane` field in docs/EXECUTION_BACKLOG.md
 *   2. Appends a new line to the `## Lane log` section of EXECUTION_BACKLOG
 *   3. Appends a statusLog entry to the linked BBL-NNNN entry (if any)
 *
 * Operator no longer rediscovers the current lane after a handoff. The
 * mandatory structured-checkpoint footer reads from EXECUTION_BACKLOG, so
 * propagation here is what makes lane sync stick.
 *
 * Usage:
 *   node backend/scripts/ops/laneSync.js <new-lane> "<reason>"
 *
 * Phase OO-2 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")

const DOCS = path.join(__dirname, "..", "..", "..", "docs")
const EXEC_PATH = path.join(DOCS, "EXECUTION_BACKLOG.md")
const BBL_PATH  = path.join(DOCS, "BETTOR_BACKLOG.md")

const CANONICAL_LANES = [
  "MCR",
  "ACTIVE EXECUTION",
  "FULL SYSTEM AUDIT",
  "FRONTEND / UX LAB",
  "INFRA / GOVERNANCE",
  "INFRA",
  "OPERATOR PLAYBOOK",
]

function activeSliceBlock(src) {
  const m = src.match(/(## Active slice[\s\S]*?)(## Slice queue)/)
  if (!m) throw new Error("could not locate Active slice block in EXECUTION_BACKLOG.md")
  return { block: m[1], rest: m[2], head: src.slice(0, m.index), src }
}

function getField(block, k) {
  const r = block.match(new RegExp("\\|\\s*" + k + "\\s*\\|\\s*([^|]+?)\\s*\\|"))
  return r ? r[1].trim() : null
}

function setField(block, k, value) {
  const re = new RegExp("(\\|\\s*" + k + "\\s*\\|\\s*)([^|]+?)(\\s*\\|)")
  if (!re.test(block)) throw new Error("field not found: " + k)
  return block.replace(re, (_m, a, _b, c) => a + value + c)
}

function appendLaneLog(src, line) {
  // Insert a "## Lane log" section before "## Shipped slices" if absent.
  if (!src.includes("## Lane log")) {
    src = src.replace(
      "## Shipped slices",
      "## Lane log\n\nChronological lane handoffs for the active slice. Append-only.\n\n" + line + "\n\n## Shipped slices"
    )
  } else {
    src = src.replace(
      /(## Lane log[\s\S]*?)(\n## )/,
      (_m, a, b) => a.trimEnd() + "\n" + line + "\n" + b
    )
  }
  return src
}

function appendBblStatusLog(bblSrc, bblId, line) {
  // Find the block containing this id and append a new statusLog line at the end.
  const blockRe = new RegExp(
    "(---\\s*\\n[\\s\\S]*?^id:\\s*" + bblId + "\\b[\\s\\S]*?statusLog:\\s*\\n(?:  - [^\\n]*\\n)+)",
    "m"
  )
  if (!blockRe.test(bblSrc)) return bblSrc  // no linked BBL — silent no-op
  return bblSrc.replace(blockRe, (block) => block.trimEnd() + "\n  - " + line + "\n")
}

function main() {
  const [, , newLane, ...rest] = process.argv
  const reason = (rest.join(" ") || "").trim()
  if (!newLane || !reason) {
    console.error("usage: laneSync.js <new-lane> \"<reason>\"")
    console.error("valid lanes:", CANONICAL_LANES.join(" | "))
    process.exit(1)
  }
  if (!CANONICAL_LANES.includes(newLane)) {
    console.error("invalid lane:", newLane)
    console.error("valid lanes:", CANONICAL_LANES.join(" | "))
    process.exit(1)
  }

  const today = new Date().toISOString().slice(0, 10)
  let execSrc = fs.readFileSync(EXEC_PATH, "utf8")
  const parsed = activeSliceBlock(execSrc)
  const oldLane = getField(parsed.block, "lane")
  const slice   = getField(parsed.block, "slice")
  const bblId   = getField(parsed.block, "backlog-ref")
  if (!oldLane || !slice) {
    console.error("Active slice block missing lane or slice"); process.exit(1)
  }

  const newBlock = setField(parsed.block, "lane", newLane)
  execSrc = parsed.head + newBlock + parsed.rest + execSrc.slice(parsed.head.length + parsed.block.length + parsed.rest.length)

  const logLine = `- ${today} \`${slice}\` ${oldLane} → ${newLane} — ${reason}`
  execSrc = appendLaneLog(execSrc, logLine)
  fs.writeFileSync(EXEC_PATH, execSrc)

  if (bblId && /^BBL-\d{4}$/.test(bblId)) {
    let bblSrc = fs.readFileSync(BBL_PATH, "utf8")
    bblSrc = appendBblStatusLog(bblSrc, bblId, `${today} IN-SLICE: lane handoff ${oldLane} → ${newLane} — ${reason}`)
    fs.writeFileSync(BBL_PATH, bblSrc)
  }

  console.log(`lane synced: ${slice} ${oldLane} → ${newLane}`)
  console.log(`  EXECUTION_BACKLOG.md: Active slice lane + Lane log updated`)
  if (bblId !== "none") console.log(`  BETTOR_BACKLOG.md: ${bblId} statusLog appended`)
}

if (require.main === module) main()
module.exports = { CANONICAL_LANES, getField }
