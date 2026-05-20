#!/usr/bin/env node
"use strict"

/**
 * backlogList.js — print OPEN + IN-SLICE backlog entries.
 *
 *   node backend/scripts/ops/backlogList.js              # OPEN + IN-SLICE
 *   node backend/scripts/ops/backlogList.js --all        # all states
 *   node backend/scripts/ops/backlogList.js --lane MCR   # filter by lane
 *
 * Phase OO-1 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const BACKLOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "BETTOR_BACKLOG.md")

function parse(src) {
  const entries = []
  const blocks = src.split(/^---\s*$/m).slice(1)
  for (const blk of blocks) {
    if (!/^id:\s*BBL-/m.test(blk)) continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    entries.push({
      id:           get("id"),
      submittedAt:  get("submittedAt"),
      submitter:    get("submitter"),
      lane:         get("lane"),
      title:        get("title"),
      state:        get("state"),
      linkedSlice:  get("linkedSlice"),
      evidence:     get("evidence"),
    })
  }
  return entries
}

function main() {
  const args = process.argv.slice(2)
  const all  = args.includes("--all")
  const laneArg = args.indexOf("--lane") >= 0 ? args[args.indexOf("--lane") + 1] : null

  const src = fs.readFileSync(BACKLOG_PATH, "utf8")
  let entries = parse(src)
  if (!all) entries = entries.filter(e => e.state === "OPEN" || e.state === "IN-SLICE")
  if (laneArg) entries = entries.filter(e => e.lane === laneArg)

  if (entries.length === 0) { console.log("(no entries match)"); return }
  console.log("")
  console.log("id        state      lane                title                                       linkedSlice")
  console.log("--------  ---------  ------------------- ------------------------------------------- -----------")
  for (const e of entries) {
    console.log(
      (e.id||"?").padEnd(10) +
      (e.state||"?").padEnd(11) +
      (e.lane||"?").padEnd(20) +
      (e.title||"").slice(0, 43).padEnd(44) +
      (e.linkedSlice||"")
    )
  }
  console.log("")
}

if (require.main === module) main()
module.exports = { parse }
