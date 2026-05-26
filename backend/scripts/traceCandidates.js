#!/usr/bin/env node
"use strict"

/**
 * traceCandidates — single-shot inspector for the live /api/ws/state output.
 *
 * Purpose: replace the broken Claude workflow of "guess fix → operator restarts
 * → operator screenshots → guess again". Instead: ONE run produces the full
 * picture, Claude reads it once, makes ONE confident edit.
 *
 * Does:
 *   1. Hits live /api/ws/state?sport=nba on localhost:4000 (no restart needed)
 *   2. For every candidate the FE sees, prints:
 *        player, propType, side, line, odds, modelProb, edge,
 *        l5Avg (from recentForm or row), projMostLikely,
 *        sample_count (how many games L5 is based on),
 *        CURRENT tier (what FE shows),
 *        RECOMPUTED tier (what classifyNbaTier returns now),
 *        WHY (which gate fired, or which magnitude tier matched)
 *
 * Output: one row per candidate, fixed-width columns. Plus a tier-mix summary
 * and a "tier drift" report (any cases where CURRENT != RECOMPUTED).
 *
 * Usage:
 *   node backend/scripts/traceCandidates.js
 *   node backend/scripts/traceCandidates.js | grep -i williams      # filter
 *   node backend/scripts/traceCandidates.js --tier=ELITE            # filter
 */

const { classifyNbaTier } = require("../pipeline/nba/nbaTierClassifier")

const argv = process.argv.slice(2)
const filterTier   = (argv.find(a => a.startsWith("--tier=")) || "").split("=")[1]
const filterPlayer = (argv.find(a => a.startsWith("--player=")) || "").split("=")[1]

async function main() {
  const url = "http://127.0.0.1:4000/api/ws/state?sport=nba"
  let payload
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    payload = await r.json()
  } catch (e) {
    console.error("FAILED to reach backend on :4000 —", e.message)
    console.error("Make sure TERM 1 is running.")
    process.exit(2)
  }

  // /api/ws/state may shape the candidates as .candidates or under .featured.
  // Match the FE read order (frontend/mobile/index.html:1377).
  const featured   = Array.isArray(payload.featured) ? payload.featured : []
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  const source = featured.length > 0 ? "featured" : "candidates"
  const list   = featured.length > 0 ? featured : candidates

  console.log(`Source: ${source}, count: ${list.length}`)
  console.log(`Snapshot freshness: ${payload?.snapshotFreshness?.snapshotAgeMinutes}m (${payload?.snapshotFreshness?.status})`)
  console.log("")

  const rows = []
  let tierDriftCount = 0
  const tierMix = {}

  for (const c of list) {
    if (filterTier && String(c.tier || "").toUpperCase() !== filterTier.toUpperCase()) continue
    if (filterPlayer && !String(c.player || "").toLowerCase().includes(filterPlayer.toLowerCase())) continue

    const edge      = Number(c.edge ?? c.edgeProbability)
    const modelProb = Number(c.modelProb ?? c.predictedProbability)
    const side      = c.side
    const line      = Number(c.line)
    const l5_rf     = Number(c.recentForm?.last5_avg)
    const l5_row    = Number(c.last5Avg)
    const l5_used   = Number.isFinite(l5_rf) ? l5_rf : l5_row
    const sample    = c.recentForm?.sample_count ?? null
    const projML    = Number(
      c?.range?.mostLikely ??
      c?.projection?.mostLikely ??
      c?.projectionMostLikely
    )

    // Recompute with same args the live path uses (workstationRoutes:626 pattern)
    const recomputed = classifyNbaTier({
      edge:           Number.isFinite(edge) ? edge : null,
      modelProb:      Number.isFinite(modelProb) ? modelProb : null,
      side, line,
      l5Avg:          Number.isFinite(l5_used) ? l5_used : null,
      projMostLikely: Number.isFinite(projML) ? projML : null,
    })

    // Reason: re-trace the gates manually so we know WHICH one fired
    let why = ""
    if (!Number.isFinite(edge)) why = "edge=NaN → FADE"
    else if (edge < 0.03) why = `edge ${edge.toFixed(3)} < 0.03 → FADE`
    else if (Number.isFinite(l5_used) && Number.isFinite(line) && line > 0 && side) {
      const sideStr = String(side).toLowerCase()
      const overshoot = (l5_used - line) / line
      if ((sideStr === "under" || sideStr === "no") && overshoot > 0.07)
        why = `form-gate: under but L5 ${l5_used} > line ${line} (overshoot ${overshoot.toFixed(2)}) → FADE`
      else if ((sideStr === "over" || sideStr === "yes") && overshoot < -0.07)
        why = `form-gate: over but L5 ${l5_used} < line ${line} (overshoot ${overshoot.toFixed(2)}) → FADE`
    }
    if (!why && Number.isFinite(projML) && Number.isFinite(line) && line > 0 && side) {
      const sideStr = String(side).toLowerCase()
      const projGap = (projML - line) / line
      if ((sideStr === "under" || sideStr === "no") && projGap > 0.15)
        why = `proj-gate: under but proj ${projML} > line ${line} (gap ${projGap.toFixed(2)}) → FADE`
      else if ((sideStr === "over" || sideStr === "yes") && projGap < -0.15)
        why = `proj-gate: over but proj ${projML} < line ${line} (gap ${projGap.toFixed(2)}) → FADE`
    }
    if (!why && Number.isFinite(modelProb)) {
      const conv = Math.abs(modelProb - 0.5)
      if (conv < 0.06) why = `conviction ${conv.toFixed(3)} < 0.06 → FADE`
      else if (conv < 0.10) why = `conviction ${conv.toFixed(3)} → PLAYABLE cap`
    }
    if (!why) {
      if (edge >= 0.12) why = `edge ${edge.toFixed(3)} ≥ 0.12 → ELITE`
      else if (edge >= 0.07) why = `edge ${edge.toFixed(3)} ≥ 0.07 → STRONG`
      else if (edge >= 0.04) why = `edge ${edge.toFixed(3)} ≥ 0.04 → PLAYABLE`
      else why = `edge ${edge.toFixed(3)} → LONGSHOT`
    }

    const drift = (String(c.tier || "").toUpperCase() !== String(recomputed || "").toUpperCase())
    if (drift) tierDriftCount++
    tierMix[recomputed] = (tierMix[recomputed] || 0) + 1

    rows.push({
      player:     String(c.player || "").slice(0, 22),
      prop:       String(c.propType || c.statFamily || "").slice(0, 24),
      side:       String(side || "").slice(0, 5),
      line,
      odds:       c.odds,
      mp:         Number.isFinite(modelProb) ? modelProb.toFixed(3) : "—",
      edge:       Number.isFinite(edge) ? edge.toFixed(3) : "—",
      l5:         Number.isFinite(l5_used) ? l5_used.toFixed(1) : "—",
      l5src:      Number.isFinite(l5_rf) ? `rf(n=${sample ?? "?"})` : (Number.isFinite(l5_row) ? "row" : "—"),
      projML:     Number.isFinite(projML) ? projML.toFixed(1) : "—",
      tierLive:   c.tier || "—",
      tierRecomp: recomputed || "—",
      drift:      drift ? "⚠" : "",
      why,
    })
  }

  // Print table
  const cols = [
    ["player",     22],
    ["prop",       24],
    ["side",        5],
    ["line",        5],
    ["odds",        5],
    ["mp",          6],
    ["edge",        6],
    ["l5",          5],
    ["l5src",      10],
    ["projML",      6],
    ["tierLive",    9],
    ["tierRecomp",  9],
    ["drift",       2],
  ]
  const header = cols.map(([k, w]) => String(k).padEnd(w)).join("  ")
  console.log(header)
  console.log("-".repeat(header.length))
  for (const r of rows) {
    console.log(cols.map(([k, w]) => String(r[k] ?? "—").padEnd(w)).join("  "))
    if (r.drift) console.log("    drift reason:", r.why)
  }

  console.log("\n=== TIER MIX (recomputed) ===")
  console.log(JSON.stringify(tierMix, null, 2))

  console.log(`\n=== DRIFT ===\n${tierDriftCount} of ${rows.length} candidates have tierLive ≠ tierRecomp`)
  if (tierDriftCount > 0) {
    console.log("→ The live engine and the canonical classifier disagree on those rows.")
    console.log("→ That means a shadow tier path is stamping a different value than the canonical classifier would.")
  }
}

main().catch((e) => {
  console.error("fatal:", e)
  process.exit(1)
})
