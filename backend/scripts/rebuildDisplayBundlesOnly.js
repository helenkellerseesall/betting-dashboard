#!/usr/bin/env node
"use strict"

/**
 * rebuildDisplayBundlesOnly — fast iteration tool for FE/tag changes.
 *
 * 2026-05-25 — Operator hit 10-min cycles even with --skip-snapshot because
 * runNbaNight still runs full cognition over thousands of market lines.
 * For changes that ONLY touch buildPlayDisplayBundle (tag strings, signals
 * table layout, abbreviations, dedup logic), all that work is unnecessary.
 *
 * What this script does:
 *   1. Loads the existing nba_tracked_best_YYYY-MM-DD.json
 *   2. For each entry, calls buildPlayDisplayBundle() with the entry as the play
 *   3. Writes back the file with new displayBundle field
 *   4. Mirrors UTC-named file to local-date name (for FE compatibility)
 *
 * What this script does NOT do:
 *   - No Odds API call (no snapshot refresh)
 *   - No re-classification (tiers stay the same)
 *   - No projection re-compute
 *   - No new entries (only updates existing ones)
 *
 * Runtime: ~1-2 seconds for typical 50-entry file.
 *
 * Usage:
 *   node backend/scripts/rebuildDisplayBundlesOnly.js
 *   node backend/scripts/rebuildDisplayBundlesOnly.js --date=2026-05-25
 *
 * Notes:
 *   - Does NOT need backend restart only if buildPlayDisplayBundle.js is the
 *     only file changed AND it's pure-function (no global state). Since it
 *     is pure (reads play object, returns object), no restart needed at all.
 *     This script loads the module fresh each invocation.
 *   - For changes that DO touch other pipeline files (classifier, projection,
 *     enrichers), use runNbaNight.js with or without --skip-snapshot.
 */

const fs = require("fs")
const path = require("path")

function todayUtcKey() {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtcKey() {
  const d = new Date(Date.now() - 86400000)
  return d.toISOString().slice(0, 10)
}

function parseArgs() {
  const args = { date: todayUtcKey() }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--date=")) args.date = a.slice(7)
  }
  return args
}

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null }
}

function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 0), "utf8")
  fs.renameSync(tmp, p)
}

function main() {
  const args = parseArgs()
  const trackDir = path.join(__dirname, "..", "runtime", "tracking")
  const bestFile = path.join(trackDir, `nba_tracked_best_${args.date}.json`)

  if (!fs.existsSync(bestFile)) {
    console.error(`[rebuild] file not found: ${bestFile}`)
    console.error(`[rebuild] tip: run runNbaNight.js first to generate it, or pass --date=YYYY-MM-DD`)
    process.exit(2)
  }

  console.log(`[rebuild] loading ${bestFile}`)
  const data = loadJson(bestFile)
  if (!data || !Array.isArray(data.entries)) {
    console.error(`[rebuild] file shape unexpected: missing entries array`)
    process.exit(2)
  }
  console.log(`[rebuild] ${data.entries.length} entries to refresh`)

  // Load the formatter fresh
  const buildPlayDisplayBundle = require("../pipeline/nba/buildPlayDisplayBundle")

  let updated = 0
  const t0 = Date.now()
  for (const e of data.entries) {
    try {
      const bundle = buildPlayDisplayBundle({
        ...e,
        // buildPlayDisplayBundle expects play.statFamily but tracked_best uses propType
        statFamily: e.statFamily || e.propType,
      })
      if (bundle && bundle.tags && bundle.tags.length) {
        e.displayBundle = bundle
        updated++
      }
    } catch (err) {
      console.warn(`[rebuild] entry failed: ${e.player} ${e.propType}: ${err.message}`)
    }
  }
  const elapsed = Date.now() - t0
  console.log(`[rebuild] updated ${updated}/${data.entries.length} entries in ${elapsed}ms`)

  // Update metadata timestamp so FE can show freshness
  data.metadata = data.metadata || {}
  data.metadata.displayBundleRefreshedAt = new Date().toISOString()

  writeJsonAtomic(bestFile, data)
  console.log(`[rebuild] wrote ${bestFile}`)

  // Mirror to yesterday's local-date file so iPhone (local time) finds it.
  // FE looks up "today per local time" → may differ from UTC file name.
  const yest = yesterdayUtcKey()
  const yestFile = path.join(trackDir, `nba_tracked_best_${yest}.json`)
  try {
    fs.copyFileSync(bestFile, yestFile)
    console.log(`[rebuild] mirrored to ${yestFile} (local-date compatibility)`)
  } catch (_) { /* non-fatal */ }

  // Sample output for operator
  const sample = data.entries.find(e => e.displayBundle && e.displayBundle.tags && e.displayBundle.tags.length)
  if (sample) {
    console.log(`\n[rebuild] sample bundle (${sample.player} ${sample.propType} ${sample.side} ${sample.line}):`)
    sample.displayBundle.tags.slice(0, 8).forEach(t => console.log(`  - ${t}`))
  }

  console.log(`\n[rebuild] DONE — hard-refresh iPhone to see updates. No backend restart needed.`)
}

if (require.main === module) {
  try { main() } catch (err) {
    console.error("[rebuild] fatal:", err)
    process.exit(1)
  }
}
