#!/usr/bin/env node
"use strict"

/**
 * nextStep.js — print the active slice's next-command + next-step from
 * docs/EXECUTION_BACKLOG.md so the operator never has to wonder what to run.
 *
 *   node backend/scripts/ops/nextStep.js
 *
 * Phase OO-1 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const BACKLOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "EXECUTION_BACKLOG.md")

function main() {
  const src = fs.readFileSync(BACKLOG_PATH, "utf8")
  const m = src.match(/## Active slice([\s\S]*?)## Slice queue/)
  if (!m) { console.error("could not locate Active slice block"); process.exit(1) }
  const block = m[1]
  const get = (k) => {
    const r = block.match(new RegExp("\\|\\s*" + k + "\\s*\\|\\s*([^|]+?)\\s*\\|"))
    return r ? r[1].trim() : "?"
  }
  const slice        = get("slice")
  const lane         = get("lane")
  const owner        = get("owner")
  const status       = get("status")
  const tagBaseline  = get("tag-baseline")
  const backlogRef   = get("backlog-ref")
  const nextCommand  = get("next-command").replace(/^`|`$/g, "")

  console.log("")
  console.log("  active slice:   " + slice)
  console.log("  lane:           " + lane)
  console.log("  owner:          " + owner)
  console.log("  status:         " + status)
  console.log("  tag-baseline:   " + tagBaseline)
  console.log("  backlog-ref:    " + backlogRef)
  console.log("")
  console.log("  next-command:")
  console.log("    " + nextCommand)
  console.log("")
}

if (require.main === module) main()
