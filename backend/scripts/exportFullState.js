#!/usr/bin/env node
"use strict"

/**
 * exportFullState — single command, complete operator-visible state.
 *
 * 2026-05-25 — Operator pain point: I (Claude) can't see terminals/FE/repo.
 * Every cycle I rebuild context from descriptions, which costs time + creates
 * errors. This script dumps everything I need to know in ONE block of text.
 *
 * Operator runs:    node backend/scripts/exportFullState.js
 * Pastes output.    I read it once, see complete state, no follow-up questions.
 */

const fs = require("fs")
const path = require("path")
const { currentSlateDateEt, slateDateForTimestamp } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..", "..")
const TRACK_DIR = path.join(ROOT, "backend", "runtime", "tracking")

function exists(p) { try { fs.accessSync(p); return true } catch { return false } }
function size(p) { try { return fs.statSync(p).size } catch { return null } }
function mtime(p) { try { return fs.statSync(p).mtime.toISOString() } catch { return null } }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null } }
function fileContains(p, s) { try { return fs.readFileSync(p, "utf8").includes(s) } catch { return false } }

// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
const today = currentSlateDateEt()
const yesterday = slateDateForTimestamp(Date.now() - 86400000)

console.log("================================================================")
console.log("  BETTING-DASHBOARD STATE EXPORT  " + new Date().toISOString())
console.log("================================================================\n")

// ── 1. DATES + ENV
console.log("== DATES ==")
console.log("  UTC today: " + today)
console.log("  Local now: " + new Date().toString())
console.log()

// ── 2. TRACKED FILES
console.log("== TRACKED FILES (last 5, by mtime) ==")
try {
  const files = fs.readdirSync(TRACK_DIR).filter(f => f.startsWith("nba_tracked"))
    .map(f => ({ name: f, mtime: mtime(path.join(TRACK_DIR, f)), bytes: size(path.join(TRACK_DIR, f)) }))
    .sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""))
    .slice(0, 5)
  files.forEach(f => console.log(`  ${f.name}  ${f.bytes}B  ${f.mtime}`))
} catch (_) { console.log("  (tracking dir not found)") }
console.log()

// ── 3. KEY MODULES PRESENT
console.log("== KEY MODULES ==")
const modules = [
  "backend/pipeline/nba/nbaTierClassifier.js",
  "backend/pipeline/nba/buildPlayDisplayBundle.js",
  "backend/pipeline/nba/buildNbaBoardSlicesFromSnapshot.js",
  "backend/scripts/runNbaNightFast.js",
  "backend/scripts/rebuildDisplayBundlesOnly.js",
  "backend/scripts/computeOppDefFromGameLogs.js",
]
modules.forEach(rel => {
  const fp = path.join(ROOT, rel)
  if (exists(fp)) console.log(`  ✓ ${rel}  (${size(fp)}B, mtime=${mtime(fp)})`)
  else            console.log(`  ✗ ${rel}  MISSING`)
})
console.log()

// ── 4. KEY CODE MARKERS (proves recent edits landed)
console.log("== CODE MARKERS ==")
const classifier = path.join(ROOT, "backend/pipeline/nba/nbaTierClassifier.js")
console.log("  form-contradiction threshold:")
;["0.07", "0.12", "0.20", "overshoot"].forEach(s => {
  console.log(`    contains "${s}": ${fileContains(classifier, s)}`)
})
const bestBets = path.join(ROOT, "backend/pipeline/nba/buildNbaBestBetsBoard.js")
console.log("  sigma caps:")
;["maxSigmaByFamily", "return 9", "return 12", "return 3.5"].forEach(s => {
  console.log(`    contains "${s}": ${fileContains(bestBets, s)}`)
})
const slices = path.join(ROOT, "backend/pipeline/nba/buildNbaBoardSlicesFromSnapshot.js")
console.log("  slice cache:")
console.log(`    contains "_slicesCache": ${fileContains(slices, "_slicesCache")}`)
console.log()

// ── 5. TODAY'S TRACKED_BEST (UTC AND LOCAL)
for (const date of [today, yesterday]) {
  const fp = path.join(TRACK_DIR, `nba_tracked_best_${date}.json`)
  console.log(`== TRACKED_BEST ${date} ==`)
  if (!exists(fp)) { console.log(`  (file does not exist)\n`); continue }
  const f = readJson(fp)
  const entries = Array.isArray(f?.entries) ? f.entries : []
  const tiers = entries.reduce((a, e) => { a[e.tier || "?"] = (a[e.tier || "?"] || 0) + 1; return a }, {})
  console.log(`  entries: ${entries.length}`)
  console.log(`  tiers: ${JSON.stringify(tiers)}`)
  console.log(`  file mtime: ${mtime(fp)}`)
  const sample = entries[0]
  if (sample) {
    console.log(`  first entry has displayBundle: ${!!sample.displayBundle}`)
    console.log(`  first entry tags count: ${sample.displayBundle?.tags?.length || 0}`)
    console.log(`  first entry: ${sample.player} ${sample.propType} ${sample.side} ${sample.line} tier=${sample.tier} mp=${sample.predictedProbability}`)
  }
  // Top picks across tiers
  for (const t of ["ELITE", "STRONG"]) {
    const ofTier = entries.filter(e => e.tier === t).slice(0, 3)
    if (ofTier.length) {
      console.log(`  top ${t}:`)
      ofTier.forEach(e => {
        const l5 = e.recentForm?.last5_avg
        console.log(`    ${e.player} ${e.propType} ${e.side} ${e.line}  L5=${l5}  mp=${e.predictedProbability}  edge=${e.edgeProbability}`)
      })
    }
  }
  console.log()
}

// ── 6. BACKEND HEALTH (is it running?)
console.log("== BACKEND HEALTH ==")
;(async () => {
  try {
    const r = await fetch("http://localhost:4000/api/odds")
    if (r.ok) {
      const j = await r.json()
      console.log(`  backend: UP on :4000`)
      console.log(`  snapshot: events=${j?.counts?.events ?? "?"} rawProps=${j?.counts?.rawProps ?? "?"}`)
    } else {
      console.log(`  backend: returned ${r.status}`)
    }
  } catch (_) {
    console.log(`  backend: NOT REACHABLE on :4000`)
  }
  console.log()
  console.log("================================================================")
  console.log("  END EXPORT — paste this entire block to Claude")
  console.log("================================================================")
})()
