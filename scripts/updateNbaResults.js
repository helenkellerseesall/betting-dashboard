#!/usr/bin/env node
"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA tracked-result ingestion CLI.
 *
 * Usage:
 *   # 1) Provide a JSON file mapping bet ids to results:
 *   node scripts/updateNbaResults.js --date=2026-05-05 --bets=path/to/bets.json --legs=path/to/legs.json
 *
 *   # 2) Provide a single bet/leg result on the command line:
 *   node scripts/updateNbaResults.js --date=2026-05-05 --bet="<id>=win"
 *   node scripts/updateNbaResults.js --date=2026-05-05 --leg="<legId>=loss"
 *
 *   # 3) Pipe a JSON object on stdin:
 *   echo '{"bets":{"<id>":"win"},"legs":{"<legId>":"loss"}}' | node scripts/updateNbaResults.js --date=2026-05-05
 *
 * Result values: "win" | "loss" | "push" | "void" | "pending"
 *
 * The script ONLY updates the daily files in
 *   backend/runtime/tracking/nba_tracked_bets_<date>.json
 *   backend/runtime/tracking/nba_tracked_slips_<date>.json
 * and is intentionally separate from the live pipeline.
 */

const fs = require("fs")
const path = require("path")
const { applyResults } = require("../backend/pipeline/nba/buildNbaPerformanceTracking")
const { runPostGameReview } = require("../backend/pipeline/shared/buildPostGameReview")
const { runNightlyReview } = require("../backend/pipeline/shared/buildNightlyOrchestrator")

function parseArgs(argv) {
  const out = {
    date: new Date().toISOString().slice(0, 10),
    bets: {},
    legs: {},
    files: [],
    actuals: {},
    actualsFiles: [],
    runReview: false,
    runFull: false,
    readStdin: false,
  }
  for (const a of argv.slice(2)) {
    if (a.startsWith("--date=")) out.date = a.slice("--date=".length)
    else if (a.startsWith("--bets=")) out.files.push({ kind: "bets", path: a.slice("--bets=".length) })
    else if (a.startsWith("--legs=")) out.files.push({ kind: "legs", path: a.slice("--legs=".length) })
    else if (a.startsWith("--actuals=")) out.actualsFiles.push(a.slice("--actuals=".length))
    else if (a === "--review") out.runReview = true
    else if (a === "--full")   out.runFull = true
    else if (a === "--stdin") out.readStdin = true
    else if (a.startsWith("--bet=")) {
      // Split on the LAST '=' so ids that themselves contain '=' aren't broken.
      const arg = a.slice("--bet=".length)
      const idx = arg.lastIndexOf("=")
      if (idx > 0) {
        const id = arg.slice(0, idx)
        const res = arg.slice(idx + 1)
        if (id && res) out.bets[id] = res
      }
    } else if (a.startsWith("--leg=")) {
      const arg = a.slice("--leg=".length)
      const idx = arg.lastIndexOf("=")
      if (idx > 0) {
        const id = arg.slice(0, idx)
        const res = arg.slice(idx + 1)
        if (id && res) out.legs[id] = res
      }
    }
  }
  return out
}

function loadFile(p) {
  if (!fs.existsSync(p)) throw new Error(`file not found: ${p}`)
  return JSON.parse(fs.readFileSync(p, "utf8"))
}

/**
 * Read stdin only when explicitly requested via `--stdin`. Without that flag
 * we never block on stdin, which keeps the CLI usable in any shell context
 * (CI, watchers, scripts that don't want to pipe).
 */
async function readStdinIfRequested(readStdin) {
  if (!readStdin) return null
  return new Promise((resolve, reject) => {
    let buf = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (c) => (buf += c))
    process.stdin.on("end", () => {
      if (!buf.trim()) return resolve(null)
      try {
        resolve(JSON.parse(buf))
      } catch (e) {
        reject(e)
      }
    })
    process.stdin.on("error", reject)
  })
}

async function main() {
  const args = parseArgs(process.argv)

  for (const f of args.files) {
    const obj = loadFile(path.resolve(f.path))
    if (f.kind === "bets") Object.assign(args.bets, obj)
    else Object.assign(args.legs, obj)
  }

  for (const p of args.actualsFiles) {
    const obj = loadFile(path.resolve(p))
    if (obj && typeof obj === "object") Object.assign(args.actuals, obj)
  }

  const stdin = await readStdinIfRequested(args.readStdin).catch(() => null)
  if (stdin && typeof stdin === "object") {
    if (stdin.bets) Object.assign(args.bets, stdin.bets)
    if (stdin.legs) Object.assign(args.legs, stdin.legs)
    if (stdin.actuals) Object.assign(args.actuals, stdin.actuals)
  }

  const result = applyResults({ date: args.date, bets: args.bets, legs: args.legs })
  console.log("[updateNbaResults] applied:", JSON.stringify(result, null, 2))
  console.log("[updateNbaResults] inputs:", JSON.stringify({
    date: args.date,
    betCount: Object.keys(args.bets).length,
    legCount: Object.keys(args.legs).length,
    actualsCount: Object.keys(args.actuals).length,
  }))

  // --full: run complete nightly orchestration (review + ledger + CLV + book sync)
  if (args.runFull) {
    const nightly = runNightlyReview({
      sport: "nba",
      date: args.date,
      actuals: args.actuals,
      force: true,    // results already applied above — skip completion guard
      verbose: true,
    })
    const s = nightly.summary
    console.log("[updateNbaResults] full nightly:", JSON.stringify({
      ok: nightly.ok,
      elapsedMs: nightly.elapsedMs,
      stepHealth: s?.stepHealth,
      pnl: s?.bettingPnl,
      modelClassified: s?.modelReview?.classified,
    }, null, 2))
    return
  }

  // --review: backwards-compatible lightweight review only
  if (args.runReview) {
    const out = runPostGameReview({ sport: "nba", date: args.date, actuals: args.actuals })
    console.log("[updateNbaResults] review:", JSON.stringify({
      counts: out.counts,
      totals: out.review.totals,
      topUnder: out.review.topUnderperformers.slice(0, 5),
      topOver: out.review.topOverperformers.slice(0, 5),
    }, null, 2))
  }
}

main().catch((err) => {
  console.error("[updateNbaResults] error:", err?.message || err)
  process.exitCode = 1
})
