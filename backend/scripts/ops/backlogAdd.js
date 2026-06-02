#!/usr/bin/env node
"use strict"

/**
 * backlogAdd.js — append a new entry to docs/BETTOR_BACKLOG.md.
 *
 * Usage:
 *   node backend/scripts/ops/backlogAdd.js <lane> "<title>" [submitter]
 *   echo "<body>" | node backend/scripts/ops/backlogAdd.js <lane> "<title>" [submitter]
 *
 * Reads body from stdin when piped; otherwise leaves body blank for the
 * operator to fill in afterwards. Auto-increments BBL-NNNN. Sets state=OPEN.
 *
 * Phase OO-1 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../../pipeline/shared/slateDate")

const LANES = ["MCR","INFRA","ACTIVE EXECUTION","FRONTEND/UX LAB","FULL SYSTEM AUDIT","OPERATOR PLAYBOOK"]
const BACKLOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "BETTOR_BACKLOG.md")

function nextId(src) {
  const ids = [...src.matchAll(/^id:\s*BBL-(\d+)/gm)].map(m => parseInt(m[1], 10))
  const max = ids.length ? Math.max(...ids) : 0
  return "BBL-" + String(max + 1).padStart(4, "0")
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8")
  } catch (_) { return "" }
}

function main() {
  const [, , lane, title, submitterRaw] = process.argv
  if (!lane || !title) {
    console.error("usage: backlogAdd.js <lane> \"<title>\" [submitter]")
    console.error("lanes:", LANES.join(" | "))
    process.exit(1)
  }
  if (!LANES.includes(lane)) {
    console.error("invalid lane:", lane)
    console.error("valid lanes:", LANES.join(" | "))
    process.exit(1)
  }
  const submitter = submitterRaw === "assistant" ? "assistant" : "operator"
  const src = fs.readFileSync(BACKLOG_PATH, "utf8")
  const id = nextId(src)
  const today = currentSlateDateEt()  // Phase Date-Doctrine-1B
  const body = (readStdin() || "(operator to fill in)").trim().split("\n").map(l => "  " + l).join("\n")

  const entry = `---
id:           ${id}
submittedAt:  ${today}
submitter:    ${submitter}
lane:         ${lane}
title:        ${title}
state:        OPEN
linkedSlice:  none
evidence:     none
body: |
${body}
statusLog:
  - ${today} OPEN: appended by backlogAdd.js
---
`
  // Insert before the closing ``` fence in the entries block. If file lacks
  // a fence (legacy), append at end.
  const out = src.includes("```\n## Closure rules")
    ? src.replace("```\n## Closure rules", entry + "```\n## Closure rules")
    : src + "\n" + entry

  fs.writeFileSync(BACKLOG_PATH, out)
  console.log("appended " + id + " (" + lane + "): " + title)
}

if (require.main === module) main()
module.exports = { nextId, LANES }
