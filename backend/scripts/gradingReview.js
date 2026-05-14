#!/usr/bin/env node
"use strict"

/**
 * gradingReview.js — Phase Operator-Operations-1 (2026-05-14)
 *
 *   Usage:
 *     npm run grading:review                                # review today, all sports
 *     npm run grading:review -- --sport=mlb                 # MLB only
 *     npm run grading:review -- --sport=mlb --date=2026-05-13 --verbose
 *     npm run grading:review -- --sport=all --summary
 *
 * Canonical operator entrypoint to run the daily intelligence review.
 * Thin wrapper around the existing `runDailyReview.js`. Defaults to
 * --sport=all if not specified; otherwise passes through args untouched.
 * Always echoes the resolved command before exec.
 */

const path = require("path")
const { spawnSync } = require("child_process")

function main() {
  const userArgs = process.argv.slice(2)
  const hasSport = userArgs.some((a) => /^--sport=/.test(a))
  const finalArgs = hasSport ? userArgs : ["--sport=all", ...userArgs]

  const target = path.join(__dirname, "runDailyReview.js")

  console.log("=== grading:review — Phase Operator-Operations-1 ===")
  console.log(`exec: node ${target} ${finalArgs.join(" ")}`)
  console.log("")

  const r = spawnSync("node", [target, ...finalArgs], { stdio: "inherit" })
  process.exit(r.status ?? 1)
}

main()
