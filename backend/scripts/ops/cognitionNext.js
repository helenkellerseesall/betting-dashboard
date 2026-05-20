#!/usr/bin/env node
"use strict"

/**
 * cognitionNext.js — surface the next cognition execution slice candidate.
 *
 * Picks the top-ranked OPEN entry from cognitionRank.js whose
 * cognitionCategory maps to an execution-slice family. Prints the
 * recommended next slice + the BBL-NNNN it would close.
 *
 * Phase BC-1 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const { parseEntries, scoreEntry } = require("./cognitionRank")
const BACKLOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "BETTOR_BACKLOG.md")

// Cognition-category → execution-slice family map. Operator-cemented mapping
// keeps cognition entries from drifting into ungoverned slices.
const SLICE_FAMILY = {
  "role-archetype":         "item-0007-role-relative-strength",
  "sportsbook":             "item-0003-slice-N-sportsbook-extension",
  "market-psychology":      "item-0010-market-psychology",
  "timing":                 "item-0011-timing-cognition",
  "gameflow":               "item-0008-game-flow-activation",
  "cashout":                "item-0012-cashout-cognition",
  "no-name-overload":       "item-0009-archetype-diversification",
  "superstar-gravity":      "item-0009-archetype-diversification",
  "ladder-realism":         "item-0013-ladder-realism",
  "deep-cut-prop-ecology":  "item-0014-deep-cut-ecology",
  "fe-workflow":            "item-0015-fe-workflow",
  "operational-friction":   "oo-N-operational-friction",
  "mobile-sportsbook-os":   "item-0016-mobile-sportsbook-os",
  "feels-fake":             "item-0017-feels-fake-audit",
  "realism":                "item-0018-realism-cognition",
}

// Lane ownership map per cognition category.
const LANE_OWNERSHIP = {
  "role-archetype":         "INFRA / GOVERNANCE",
  "sportsbook":             "INFRA / GOVERNANCE",
  "market-psychology":      "INFRA / GOVERNANCE",
  "timing":                 "INFRA / GOVERNANCE",
  "gameflow":               "INFRA / GOVERNANCE",
  "cashout":                "ACTIVE EXECUTION",
  "no-name-overload":       "INFRA / GOVERNANCE",
  "superstar-gravity":      "INFRA / GOVERNANCE",
  "ladder-realism":         "INFRA / GOVERNANCE",
  "deep-cut-prop-ecology":  "INFRA / GOVERNANCE",
  "fe-workflow":            "FRONTEND / UX LAB",
  "operational-friction":   "OPERATOR PLAYBOOK",
  "mobile-sportsbook-os":   "FRONTEND / UX LAB",
  "feels-fake":             "FULL SYSTEM AUDIT",
  "realism":                "FULL SYSTEM AUDIT",
}

function main() {
  const src = fs.readFileSync(BACKLOG_PATH, "utf8")
  const entries = parseEntries(src).filter(e => e.state === "OPEN")
  if (entries.length === 0) { console.log("(no OPEN cognition entries; backlog is clean)"); return }

  const ranked = entries
    .map(e => ({ ...e, score: scoreEntry(e) }))
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  const recommendedSlice = SLICE_FAMILY[top.cognitionCategory] || "item-NNNN-unmapped"
  const recommendedLane  = LANE_OWNERSHIP[top.cognitionCategory] || "MCR"

  console.log("")
  console.log("  NEXT COGNITION EXECUTION RECOMMENDATION")
  console.log("  ────────────────────────────────────────────────────────────")
  console.log("  top backlog id:       " + top.id)
  console.log("  title:                " + top.title)
  console.log("  cognition category:   " + top.cognitionCategory)
  console.log("  severity / priority:  " + top.severity + " / " + top.priority)
  console.log("  composite score:      " + top.score)
  console.log("  feelsFakeFlag:        " + top.feelsFakeFlag)
  console.log("  linked risks:         " + (top.linkedRisks.length ? top.linkedRisks.join(", ") : "none"))
  console.log("  screenshots:          " + (top.screenshots.length ? top.screenshots.join(", ") : "none"))
  console.log("")
  console.log("  → recommended slice:  " + recommendedSlice)
  console.log("  → recommended lane:   " + recommendedLane)
  console.log("")
  console.log("  Runner-up entries (next 4):")
  for (const e of ranked.slice(1, 5)) {
    console.log("    " + e.id + "  score=" + String(e.score).padStart(5) +
                "  " + (e.cognitionCategory||"?").padEnd(24) +
                "  " + (e.title||"").slice(0, 50))
  }
  console.log("")
}

if (require.main === module) main()
module.exports = { SLICE_FAMILY, LANE_OWNERSHIP }
