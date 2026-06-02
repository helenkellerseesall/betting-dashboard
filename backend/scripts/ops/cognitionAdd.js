#!/usr/bin/env node
"use strict"

/**
 * cognitionAdd.js — append a Phase BC-1 cognition-ingestion entry to
 * docs/BETTOR_BACKLOG.md with full cognition schema.
 *
 * Usage:
 *   node backend/scripts/ops/cognitionAdd.js \
 *        --lane "FRONTEND/UX LAB" \
 *        --title "Discover surfaces too many no-name longshots" \
 *        --cognition no-name-overload \
 *        --sportsbook DraftKings \
 *        --ux discover \
 *        --severity high \
 *        --priority P1 \
 *        [--risks R-001-1,R-002-1] \
 *        [--screenshots docs/screenshots/BBL-0010-no-name-1.png] \
 *        [--feelsfake] \
 *        [--realism 35] \
 *        [--submitter assistant] \
 *        [--body "free-form body or use stdin"]
 *
 * Reads body from stdin if --body absent.
 *
 * Phase BC-1 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../../pipeline/shared/slateDate")

const LANES = ["MCR","INFRA","ACTIVE EXECUTION","FRONTEND/UX LAB","FULL SYSTEM AUDIT","OPERATOR PLAYBOOK"]

const COGNITION_CATEGORIES = [
  "role-archetype","sportsbook","market-psychology","timing","gameflow",
  "cashout","no-name-overload","superstar-gravity","ladder-realism",
  "deep-cut-prop-ecology","fe-workflow","operational-friction",
  "mobile-sportsbook-os","feels-fake","realism","none",
]

const SPORTSBOOK_CATEGORIES = [
  "DraftKings","FanDuel","Fanatics","Caesars","BetMGM","Hard Rock",
  "BetRivers","cross-book","none",
]

const UX_TAGS = [
  "discover","featured","curated-slip-tray","bet-builder",
  "recommendation-ladder","dashboard","none",
]

const SEVERITIES = ["critical","high","medium","low"]
const PRIORITIES = ["P0","P1","P2","P3"]

const BACKLOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "BETTOR_BACKLOG.md")

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) { out[key] = next; i++ }
      else                                { out[key] = true }
    }
  }
  return out
}

function nextId(src) {
  const ids = [...src.matchAll(/^id:\s*BBL-(\d+)/gm)].map(m => parseInt(m[1], 10))
  return "BBL-" + String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, "0")
}

function readStdin() { try { return fs.readFileSync(0, "utf8") } catch (_) { return "" } }

function validate(args) {
  const errs = []
  if (!args.lane || !LANES.includes(args.lane))
    errs.push(`--lane required; one of: ${LANES.join(" | ")}`)
  if (!args.title)
    errs.push(`--title required (≤ 80 chars)`)
  if (!args.cognition || !COGNITION_CATEGORIES.includes(args.cognition))
    errs.push(`--cognition required; one of: ${COGNITION_CATEGORIES.join(" | ")}`)
  if (!args.sportsbook) args.sportsbook = "none"
  if (!SPORTSBOOK_CATEGORIES.includes(args.sportsbook))
    errs.push(`--sportsbook must be one of: ${SPORTSBOOK_CATEGORIES.join(" | ")}`)
  if (!args.ux) args.ux = "none"
  if (!UX_TAGS.includes(args.ux))
    errs.push(`--ux must be one of: ${UX_TAGS.join(" | ")}`)
  if (!args.severity || !SEVERITIES.includes(args.severity))
    errs.push(`--severity required; one of: ${SEVERITIES.join(" | ")}`)
  if (!args.priority) args.priority = autoPriorityFromSeverity(args.severity)
  if (!PRIORITIES.includes(args.priority))
    errs.push(`--priority must be one of: ${PRIORITIES.join(" | ")}`)
  return errs
}

function autoPriorityFromSeverity(severity) {
  return ({ critical: "P0", high: "P1", medium: "P2", low: "P3" })[severity] || "P2"
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help) { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 30).join("\n")); process.exit(0) }
  const errs = validate(args)
  if (errs.length) { console.error("usage errors:"); for (const e of errs) console.error("  - " + e); process.exit(1) }

  const src = fs.readFileSync(BACKLOG_PATH, "utf8")
  const id = nextId(src)
  const today = currentSlateDateEt()  // Phase Date-Doctrine-1B
  const submitter = args.submitter === "assistant" ? "assistant" : "operator"
  const rawBody = (args.body && typeof args.body === "string") ? args.body : readStdin()
  const body = (rawBody || "(operator to fill in)").trim().split("\n").map(l => "  " + l).join("\n")

  const risks = (args.risks || "").split(",").map(s => s.trim()).filter(Boolean)
  const screenshots = (args.screenshots || "").split(",").map(s => s.trim()).filter(Boolean)
  const feelsFake = args.feelsfake === true || args.feelsfake === "true" || args.cognition === "feels-fake"
  const realism = args.realism != null && args.realism !== false ? Number(args.realism) : null

  const entry = `---
id:                ${id}
submittedAt:       ${today}
submitter:         ${submitter}
lane:              ${args.lane}
title:             ${args.title}
state:             OPEN
linkedSlice:       none
evidence:          none
body: |
${body}
statusLog:
  - ${today} OPEN: appended by cognitionAdd.js
cognitionCategory: ${args.cognition}
sportsbookCategory: ${args.sportsbook}
uxTag:             ${args.ux}
severity:          ${args.severity}
priority:          ${args.priority}
linkedRisks:       [${risks.join(", ")}]
screenshots:       [${screenshots.join(", ")}]
feelsFakeFlag:     ${feelsFake}
realismScore:      ${realism === null ? "null" : realism}
---
`
  const out = src.includes("```\n## Closure rules")
    ? src.replace("```\n## Closure rules", entry + "```\n## Closure rules")
    : src + "\n" + entry

  fs.writeFileSync(BACKLOG_PATH, out)
  console.log(`appended ${id} [${args.cognition} · ${args.severity} · ${args.priority}] ${args.title}`)
}

if (require.main === module) main()
module.exports = { COGNITION_CATEGORIES, SPORTSBOOK_CATEGORIES, UX_TAGS, SEVERITIES, PRIORITIES, autoPriorityFromSeverity, nextId }
