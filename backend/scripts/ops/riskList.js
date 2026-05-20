#!/usr/bin/env node
"use strict"

/**
 * riskList.js — print OPEN + MITIGATED risks from docs/OPEN_RISKS.md.
 *
 *   node backend/scripts/ops/riskList.js              # OPEN + MITIGATED
 *   node backend/scripts/ops/riskList.js --all        # all states
 *   node backend/scripts/ops/riskList.js --lane INFRA # filter by lane
 *   node backend/scripts/ops/riskList.js --ids        # print ids only (for footer)
 *
 * Phase OO-2 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const RISKS_PATH = path.join(__dirname, "..", "..", "..", "docs", "OPEN_RISKS.md")

function parse(src) {
  const entries = []
  const blocks = src.split(/^---\s*$/m).slice(1)
  for (const blk of blocks) {
    if (!/^id:\s*R-/m.test(blk)) continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    entries.push({
      id:       get("id"),
      openedAt: get("openedAt"),
      openedBy: get("openedBy"),
      lane:     get("lane"),
      slice:    get("slice"),
      title:    get("title"),
      state:    get("state"),
    })
  }
  return entries
}

function main() {
  const args = process.argv.slice(2)
  const all     = args.includes("--all")
  const idsOnly = args.includes("--ids")
  const laneArg = args.indexOf("--lane") >= 0 ? args[args.indexOf("--lane") + 1] : null

  const src = fs.readFileSync(RISKS_PATH, "utf8")
  let entries = parse(src)
  if (!all) entries = entries.filter(e => e.state === "OPEN" || e.state === "MITIGATED")
  if (laneArg) entries = entries.filter(e => e.lane === laneArg)

  if (idsOnly) {
    console.log(entries.map(e => e.id).join(", ") || "none")
    return
  }

  if (entries.length === 0) { console.log("(no risks match)"); return }
  console.log("")
  console.log("id        state       lane                 slice                              title")
  console.log("--------  ----------  -------------------- ---------------------------------- -----")
  for (const e of entries) {
    console.log(
      (e.id||"?").padEnd(10) +
      (e.state||"?").padEnd(12) +
      (e.lane||"?").padEnd(21) +
      (e.slice||"none").padEnd(35) +
      (e.title||"")
    )
  }
  console.log("")
}

if (require.main === module) main()
module.exports = { parse }
