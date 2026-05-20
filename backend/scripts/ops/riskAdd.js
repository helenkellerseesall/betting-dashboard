#!/usr/bin/env node
"use strict"

/**
 * riskAdd.js — append a new entry to docs/OPEN_RISKS.md.
 *
 * Usage:
 *   node backend/scripts/ops/riskAdd.js <lane> "<title>" [slice]
 *   echo "<body>" | node backend/scripts/ops/riskAdd.js <lane> "<title>" [slice]
 *
 * Auto-increments R-NNN-N. Sets state=OPEN. Reads body from stdin when piped.
 *
 * Phase OO-2 (Operational Orchestration Slice 2, 2026-05-19).
 */

const fs   = require("fs")
const path = require("path")

const LANES = ["MCR","INFRA","INFRA / GOVERNANCE","ACTIVE EXECUTION","FRONTEND/UX LAB","FRONTEND / UX LAB","FULL SYSTEM AUDIT","OPERATOR PLAYBOOK"]
const RISKS_PATH = path.join(__dirname, "..", "..", "..", "docs", "OPEN_RISKS.md")

function nextId(src) {
  const ids = [...src.matchAll(/^id:\s*R-(\d+)-(\d+)/gm)].map(m => [parseInt(m[1],10), parseInt(m[2],10)])
  if (!ids.length) return "R-001-1"
  const maxBucket = Math.max(...ids.map(([a]) => a))
  return "R-" + String(maxBucket + 1).padStart(3, "0") + "-1"
}

function readStdin() {
  try { return fs.readFileSync(0, "utf8") } catch (_) { return "" }
}

function main() {
  const [, , lane, title, sliceArg] = process.argv
  if (!lane || !title) {
    console.error("usage: riskAdd.js <lane> \"<title>\" [slice]")
    console.error("lanes:", LANES.join(" | "))
    process.exit(1)
  }
  if (!LANES.includes(lane)) {
    console.error("invalid lane:", lane)
    console.error("valid lanes:", LANES.join(" | "))
    process.exit(1)
  }
  const src   = fs.readFileSync(RISKS_PATH, "utf8")
  const id    = nextId(src)
  const today = new Date().toISOString().slice(0, 10)
  const body  = (readStdin() || "(assistant to fill in)").trim().split("\n").map(l => "  " + l).join("\n")
  const slice = sliceArg || "none"

  const entry = `---
id:          ${id}
openedAt:    ${today}
openedBy:    assistant
lane:        ${lane}
slice:       ${slice}
title:       ${title}
state:       OPEN
body: |
${body}
statusLog:
  - ${today} OPEN: appended by riskAdd.js
---
`
  // Insert just before "## Closure rules". If fence not found, append at end.
  const out = src.includes("\n## Closure rules")
    ? src.replace("\n## Closure rules", "\n" + entry + "\n## Closure rules")
    : src + "\n" + entry

  fs.writeFileSync(RISKS_PATH, out)
  console.log("appended " + id + " (" + lane + "): " + title)
}

if (require.main === module) main()
module.exports = { nextId, LANES }
