#!/usr/bin/env node
"use strict"

/**
 * gradingRun.js — Phase Operator-Operations-1 (2026-05-14)
 *
 *   Usage:
 *     npm run grading:run                                  # grade today, all sports
 *     npm run grading:run -- --sport=nba                   # NBA only, today
 *     npm run grading:run -- --sport=mlb --date=2026-05-13 # specific date
 *     npm run grading:run -- --sport=all --backfill        # backfill all pending
 *     npm run grading:run -- --sport=all --backfill --retry-unresolved
 *
 * Canonical operator entrypoint to run historical grading. Thin wrapper
 * around the existing `runHistoricalGrade.js`. Defaults to --sport=all
 * if the operator doesn't specify one; otherwise passes through args
 * untouched. Always echoes the resolved command before exec.
 */

const path = require("path")
const { spawnSync } = require("child_process")

function main() {
  const userArgs = process.argv.slice(2)
  const hasSport = userArgs.some((a) => /^--sport=/.test(a))
  const finalArgs = hasSport ? userArgs : ["--sport=all", ...userArgs]

  const target = path.join(__dirname, "runHistoricalGrade.js")

  console.log("=== grading:run — Phase Operator-Operations-1 ===")
  console.log(`exec: node ${target} ${finalArgs.join(" ")}`)
  console.log("")

  const r = spawnSync("node", [target, ...finalArgs], { stdio: "inherit" })
  process.exit(r.status ?? 1)
}

main()
