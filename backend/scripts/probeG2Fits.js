#!/usr/bin/env node
"use strict"

/**
 * probeG2Fits.js — G2-L1 real-output verification (2026-07-16).
 * Fits REAL players from the on-disk gamelog caches and prints, per family:
 * fit params + fitted rung probabilities NEXT TO the empirical survival
 * frequencies from the SAME logs (the honesty eyeball: a sane fit tracks its
 * own sample). Prefers the season caches (G2-L1 populator sibling); falls
 * back to the rolling caches with an honest banner when season files have
 * not been populated yet (first population = the landing fence / next 3:05 AM
 * chain). Pitchers below the n≥8 floor print the REFUSAL — that is the floor
 * doctrine working, not a failure.
 */

const fs = require("fs")
const path = require("path")
const { fitPlayerFamilyCurve } = require("../pipeline/mlb/negBinomLadder")

const DATA = path.join(__dirname, "..", "data")
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")) } catch (_) { return null } }

const batSeason = rd("mlbBatterGameLogsSeason.json")
const bat = batSeason || rd("mlbBatterGameLogs.json")
const pitSeason = rd("mlbPitcherGameLogsSeason.json")
const pit = pitSeason || rd("mlbPitcherGameLogs.json")
console.log(`probeG2Fits — batter cache: ${batSeason ? "SEASON" : "rolling 21d (season sibling not yet populated — honest fallback)"} · pitcher cache: ${pitSeason ? "SEASON" : "rolling 14d (season sibling not yet populated)"}`)

const HALF_LIFE = null // v1 constant is CHOSEN BY THE L2 VALIDATOR across {10,20,40,none}; unweighted until then

function empiricalSurvival(games, statKey, k) {
  const counts = games.map((g) => Number(g?.stats?.[statKey])).filter((x) => Number.isFinite(x) && x >= 0)
  if (!counts.length) return null
  return Math.round((counts.filter((c) => c >= k).length / counts.length) * 1000) / 1000
}

const batters = Object.values(bat?.players || {})
  .map((p) => ({ p, n: (p.games || []).length }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 3)

const STAT_KEY = { hits: "hits", totalBases: "totalBases", rbis: "rbi", runs: "runs" }
for (const { p, n } of batters) {
  console.log(`\n=== ${p.fullName} (${p.teamName}) — ${n} games in cache ===`)
  for (const fam of ["hits", "totalBases", "rbis", "runs"]) {
    const curve = fitPlayerFamilyCurve(p.games, fam, { minN: 15, halfLife: HALF_LIFE })
    if (!curve) { console.log(`  ${fam.padEnd(11)} NO CURVE (floor n≥15 not met or no usable rows) — honest absence`); continue }
    const m = curve.meta
    const rungs = Object.entries(curve.ladder).map(([rung, prob]) => {
      const k = Math.ceil(Number(rung))
      const emp = empiricalSurvival(p.games, STAT_KEY[fam], k)
      return `≥${k}: fit ${(prob * 100).toFixed(1)}% / emp ${(emp * 100).toFixed(1)}%`
    }).join(" · ")
    console.log(`  ${fam.padEnd(11)} ${m.method} n=${m.n} mean=${m.mean.toFixed(2)} var=${m.variance.toFixed(2)} cap=≤${curve.supportCap} | ${rungs}`)
  }
}

const pitchers = Object.values(pit?.players || {})
  .map((p) => ({ p, n: (p.starts || []).length }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 1)
for (const { p, n } of pitchers) {
  console.log(`\n=== ${p.fullName} (pitcher) — ${n} starts in cache ===`)
  const curve = fitPlayerFamilyCurve(p.starts, "ks", { minN: 8, halfLife: HALF_LIFE })
  if (!curve) { console.log(`  ks          NO CURVE — n=${n} < floor 8 (${pitSeason ? "thin season sample" : "the 14d cache maxes at ~6 starts; the season sibling populates on the landing fence / nightly chain"}) — the floor refusing to fabricate IS the doctrine`) }
  else {
    const m = curve.meta
    const rungs = Object.entries(curve.ladder).map(([rung, prob]) => {
      const k = Math.ceil(Number(rung))
      const emp = empiricalSurvival(p.starts, "strikeOuts", k)
      return `≥${k}: fit ${(prob * 100).toFixed(1)}% / emp ${(emp * 100).toFixed(1)}%`
    }).join(" · ")
    console.log(`  ks          ${m.method} n=${m.n} mean=${m.mean.toFixed(2)} var=${m.variance.toFixed(2)} cap=≤${curve.supportCap} | ${rungs}`)
  }
}
