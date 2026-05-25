#!/usr/bin/env node
"use strict"

/**
 * runNbaNightFast — minimum-viable cycle for cognition iteration.
 *
 * 2026-05-25 — Operator hit 10-15 min cycles. Profile showed backend handler
 * is 2.6s on slice-cache hit, but runNbaNight.js does ~10 min of post-HTTP
 * console-decoration work (intelligence board, outcome predictions, slip
 * formatter, etc). For iterating on cognition changes the iPhone only needs
 * the tracked_best file written — everything else is decoration.
 *
 * What this script does:
 *   1. Hits /api/best-available?sport=basketball_nba (backend writes
 *      tracked_best inside persistTrackedToday during the response)
 *   2. Mirrors UTC-named file to local-date name for iPhone compat
 *   3. Prints a 4-line summary (file size, entry count, tier mix)
 *   4. Exits
 *
 * What this script does NOT do:
 *   - No outcome prediction print
 *   - No intelligence board build
 *   - No line shopping report
 *   - No portfolio optimization print
 *   - No process review
 *
 * Runtime: ~5 sec on warm cache, ~2 min on cold cache (first run after restart).
 *
 * Usage:
 *   node backend/scripts/runNbaNightFast.js
 */

const fs = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

function todayUtc() { return new Date().toISOString().slice(0, 10) }
function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function main() {
  const t0 = Date.now()
  console.log("[fast] hitting /api/best-available?sport=basketball_nba ...")

  let resp
  try {
    resp = await fetch("http://localhost:4000/api/best-available?sport=basketball_nba")
  } catch (err) {
    console.error("[fast] backend not reachable on :4000 — restart with: cd backend && npm run engine:restart")
    process.exit(2)
  }

  if (!resp.ok) {
    console.error(`[fast] backend returned ${resp.status} ${resp.statusText}`)
    process.exit(2)
  }

  // Drain response (forces backend to fully run persistTrackedToday)
  const data = await resp.json()
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[fast] backend response in ${elapsed}s`)

  // Mirror UTC-dated file to local-dated file for iPhone compatibility
  const utc = todayUtc()
  const local = todayLocal()
  if (utc !== local) {
    for (const prefix of ["nba_tracked_best", "nba_tracked_bets"]) {
      const src = path.join(TRACKING_DIR, `${prefix}_${utc}.json`)
      const dst = path.join(TRACKING_DIR, `${prefix}_${local}.json`)
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dst)
          console.log(`[fast] mirrored ${prefix}_${utc} → ${prefix}_${local}`)
        } catch (_) { /* non-fatal */ }
      }
    }
  }

  // 4-line summary
  const bestFile = path.join(TRACKING_DIR, `nba_tracked_best_${utc}.json`)
  if (fs.existsSync(bestFile)) {
    const f = JSON.parse(fs.readFileSync(bestFile, "utf8"))
    const entries = Array.isArray(f.entries) ? f.entries : []
    const tiers = entries.reduce((a, e) => { a[e.tier || "?"] = (a[e.tier || "?"] || 0) + 1; return a }, {})
    console.log(`[fast] tracked_best: ${entries.length} entries, tiers: ${JSON.stringify(tiers)}`)
    console.log(`[fast] file: ${bestFile} (${(fs.statSync(bestFile).size / 1024).toFixed(1)}KB)`)
  } else {
    console.error(`[fast] tracked_best file missing: ${bestFile}`)
  }

  const total = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[fast] DONE in ${total}s — hard-refresh iPhone`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[fast] fatal:", err)
    process.exit(1)
  })
}
