#!/usr/bin/env node
"use strict"

/**
 * Intelligence Board CLI — surfaces all betting intelligence in one clean view.
 *
 * Usage:
 *   node scripts/board.js --sport=mlb
 *   node scripts/board.js --sport=nba
 *   node scripts/board.js --sport=mlb --date=2026-05-06
 *   node scripts/board.js --sport=mlb --compact
 *   node scripts/board.js --sport=mlb --section=urgent
 *   node scripts/board.js --sport=mlb --section=shopping
 *   node scripts/board.js --sport=mlb --section=process
 *   node scripts/board.js --sport=mlb --section=alerts
 */

const {
  loadAndBuildBoard,
  buildBoard,
  buildLookupMaps,
  BADGES,
  divider,
} = require("../backend/pipeline/shared/buildIntelligencePresentation")

function parseArgs(argv) {
  const args = { sport: "mlb", date: null, compact: false, section: null }
  for (const a of argv.slice(2)) {
    if (a.startsWith("--sport="))    args.sport   = a.slice(8)
    else if (a.startsWith("--date="))   args.date    = a.slice(7)
    else if (a === "--compact")         args.compact = true
    else if (a.startsWith("--section=")) args.section = a.slice(10).toLowerCase()
  }
  return args
}

function main() {
  const args = parseArgs(process.argv)

  try {
    const { sections, printable } = loadAndBuildBoard({
      sport:   args.sport,
      date:    args.date,
      compact: args.compact,
    })

    if (args.section) {
      // Print a specific section by keyword (skip header at index 0)
      const keyword = args.section.toLowerCase()
      const SECTION_LABELS = {
        urgent:    "BET NOW",
        edge:      "BEST EDGE",
        shopping:  "LINE SHOPPING",
        steam:     "STEAM",
        soft:      "SOFT LINE",
        safe:      "SAFEST",
        lotto:     "LOTTO",
        fb:        "FIRST BASKET",
        portfolio: "PORTFOLIO",
        slips:     "AI SLIP CONSTRUCTION",
        ai:        "AI SLIP CONSTRUCTION",
        process:   "PROCESS",
        alerts:    "ALERTS",
        stat:      "STAT BREAKDOWN",
      }
      const searchStr = SECTION_LABELS[keyword] || keyword.toUpperCase()
      const match = sections.slice(1).find((s) => s.includes(searchStr))
      if (match) console.log(match)
      else {
        console.log(`[board] No section matching "${keyword}". Available: ${Object.keys(SECTION_LABELS).join(", ")}`)
      }
    } else {
      console.log(printable)
    }
  } catch (err) {
    console.error("[board] Error:", err?.message || err)
    if (process.env.DEBUG) console.error(err)
    process.exitCode = 1
  }
}

main()
