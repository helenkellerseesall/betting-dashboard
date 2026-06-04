"use strict"

/**
 * Item 0002 Slice 1 — empirical restoration probe.
 *
 * Replays the workstation /state pipeline against snapshot-mlb.json,
 * exercising the NEW toTrackedMlbBestEntry whitelist. Measures the
 * Discover hydration delta, BC-1 realism delta, and Item 0001 survivability
 * fallback-rate delta against the persisted 2026-05-17 tracked_best baseline.
 *
 * Not a verifier — informational probe. Exits 0 unconditionally so
 * scaffolding doesn't accidentally couple checkpoint to live data.
 *
 *   node backend/scripts/probeItem0002SliceOneRestoration.js
 */

const fs = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

// Load the (newly mutated) phase4Tracking module — we need its
// toTrackedMlbBestEntry function. It is not exported, so we re-require
// the source and access via Function constructor wrapper. Cheaper: extract
// the function body by source-eval. Cheaper still: reproduce the body here
// using the same canonical formula. We choose the canonical-formula-mirror
// to avoid any drift confusion between probe and runtime.
//
// IMPORTANT: this mirror MUST match phase4Tracking.toTrackedMlbBestEntry
// (post Item 0002 Slice 1 mutation) exactly. The Item 0002 verifier
// independently asserts the whitelist contents at source-code level.

function toTrackedMlbBestEntry(row, { slateDate, timestamp }) {
  const lc = row?.lineupContextV2 || null
  const pc = row?.parkContext     || null
  const wc = row?.weatherContext  || null
  return {
    slateDate, sport: "mlb",
    player: row?.player ?? null, team: row?.team ?? null,
    propType: row?.propType ?? null, side: row?.side ?? null,
    line: row?.line ?? null, odds: row?.odds ?? null,
    predictedProbability: row?.predictedProbability ?? null,
    edgeProbability: row?.edgeProbability ?? null,
    mlbPhase3Score: row?.mlbPhase3Score ?? null,
    timestamp,
    result: null, closingOdds: null, clv: null,
    book: row?.book ?? null, marketKey: row?.marketKey ?? null,
    bucket: "mlb.bestAvailable.best",
    eventId:          row?.eventId  ?? null,
    matchup:          row?.matchup  ?? null,
    gameTime:         row?.gameTime ?? null,
    awayTeam:         row?.awayTeam ?? null,
    homeTeam:         row?.homeTeam ?? null,
    impliedTeamTotal: Number.isFinite(Number(row?.impliedTeamTotal)) ? Number(row.impliedTeamTotal) : null,
    gameTotal:        Number.isFinite(Number(row?.gameTotal))        ? Number(row.gameTotal)        : null,
    hrEnvironmentTag: pc?.hrEnvironmentTag ?? row?.hrEnvironmentTag ?? null,
    lineupSpot:            lc?.lineupSpot            ?? row?.lineupPosition ?? row?.battingOrderIndex ?? null,
    depth:                 lc?.depth                 ?? null,
    plateAppearancesProxy: lc?.plateAppearancesProxy ?? null,
    runEnvironment:        lc?.runEnvironment        ?? null,
    rbiEnvironment:        lc?.rbiEnvironment        ?? null,
    hrFactor:         pc?.hrFactor         ?? row?.hrFactor         ?? null,
    windDirectionTag: wc?.windDirectionTag ?? row?.windDirectionTag ?? null,
    carryShift:       wc?.carryShift       ?? row?.carryShift       ?? null,
    temperatureF:     wc?.temperatureF     ?? row?.temperatureF     ?? null,
    contextualTags:   Array.isArray(row?.mlbContextualTags) ? row.mlbContextualTags : null,
  }
}

// Mirror enrichBestEntry from workstationRoutes.js
function enrichBestEntry(e) {
  if (!e) return null
  return {
    ...e,
    edge:           e.edgeProbability,
    modelProb:      e.predictedProbability,
    statFamily:     String(e.propType || "").toLowerCase().replace(/\s+/g, ""),
    sportsbook:     e.book,
    odds:           e.odds,
    oddsAmerican:   e.odds,
  }
}

const { diversifyCandidates } = require(path.join(BACKEND, "pipeline", "shared", "buildCandidateDiversity"))
const { computeBettorRealismScore } = require(path.join(BACKEND, "pipeline", "shared", "buildSlipAi"))
const { survivabilityGate } = require(path.join(BACKEND, "pipeline", "shared", "survivabilityGate"))

const snap = JSON.parse(fs.readFileSync(path.join(BACKEND, "snapshot-mlb.json"), "utf8")).data
const snapRows = snap.rows || []

// Pre-fix BEFORE state: read the persisted tracked_best (which has 0 eventId etc.)
const trackingDir = path.join(BACKEND, "runtime", "tracking")
const tbFiles = fs.readdirSync(trackingDir)
  .filter(f => /^mlb_tracked_best_\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
const tbPath = path.join(trackingDir, tbFiles[tbFiles.length - 1])
const tbBefore = JSON.parse(fs.readFileSync(tbPath, "utf8")).entries || []

// Post-fix AFTER state: regenerate by feeding the snapshot rows through
// buildMlbBestProps' family-merge gate, then through the NEW whitelist.
// We approximate buildMlbBestProps by taking the same offensive families
// (HR, TB, Hits, RBIs) — exactly as buildMlbBestProps.js does. We do NOT
// take Moneyline rows or Pitcher rows (those are filtered out upstream).
const FAMILY_KEEP = new Set([
  "home runs", "homerun", "home run", "hr",
  "total bases", "totalbases", "tb",
  "hits", "hit",
  "rbis", "rbi",
])
function isPlayerOfferingRow(r) {
  if (!r?.player) return false
  if (!r?.propType) return false
  if (/moneyline|spread|total runs|run line/i.test(r.propType)) return false
  const norm = String(r.propType).toLowerCase().replace(/\s+/g, " ").trim()
  return FAMILY_KEEP.has(norm)
}

const playerRows = snapRows.filter(isPlayerOfferingRow)
const slateDate = "2026-05-19"
const ts = new Date().toISOString()
const regeneratedEntries = playerRows.map(r => toTrackedMlbBestEntry(r, { slateDate, timestamp: ts }))

// Replicate buildCandidatePool selection logic.
const enrichedAfter = regeneratedEntries.map(enrichBestEntry).filter(Boolean)
const enrichedBefore = tbBefore.map(enrichBestEntry).filter(Boolean)

const DISCOVERY_CAPS = { maxPerPlayer: 8, maxPerGame: 60, maxPerStat: 60, maxPerStatSide: 35 }
const discBefore = diversifyCandidates(enrichedBefore, DISCOVERY_CAPS)
const discAfter  = diversifyCandidates(enrichedAfter,  DISCOVERY_CAPS)

function countWith(arr, predicate) {
  let n = 0; for (const x of arr) if (predicate(x)) n++; return n
}
function distinctGames(arr) {
  const s = new Set()
  for (const c of arr) { const id = String(c.eventId || "").trim(); if (id) s.add(id) }
  return s.size
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  Item 0002 Slice 1 — empirical restoration probe")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")
console.log("Tracked-best inputs:")
console.log("  BEFORE persisted file:    " + path.basename(tbPath) + " (" + tbBefore.length + " entries)")
console.log("  AFTER  regenerated rows:  snapshot-mlb.json player-offering subset (" + playerRows.length + " rows)")
console.log("")

console.log("─── DISCOVER HYDRATION DELTA ──────────────────────────────────────")
console.log("                            BEFORE        AFTER         Δ")
function metric(label, before, after) {
  const d = after - before
  const sign = d > 0 ? "+" : (d < 0 ? "" : " ")
  console.log("  " + label.padEnd(24) + String(before).padStart(8) + String(after).padStart(13) + ("  " + sign + d).padStart(8))
}
metric("enrichedBest size",         enrichedBefore.length, enrichedAfter.length)
metric("discoveryCandidates",       discBefore.length,     discAfter.length)
metric("...with eventId",           countWith(discBefore, c => !!c.eventId), countWith(discAfter, c => !!c.eventId))
metric("...distinct gameCards",     distinctGames(discBefore), distinctGames(discAfter))
metric("...with impliedTeamTotal",  countWith(discBefore, c => Number.isFinite(Number(c.impliedTeamTotal))),
                                    countWith(discAfter,  c => Number.isFinite(Number(c.impliedTeamTotal))))
metric("...with gameTotal",         countWith(discBefore, c => Number.isFinite(Number(c.gameTotal))),
                                    countWith(discAfter,  c => Number.isFinite(Number(c.gameTotal))))
metric("...with depth",             countWith(discBefore, c => c.depth != null),
                                    countWith(discAfter,  c => c.depth != null))
metric("...with lineupSpot",        countWith(discBefore, c => c.lineupSpot != null),
                                    countWith(discAfter,  c => c.lineupSpot != null))
metric("...with hrEnvironmentTag",  countWith(discBefore, c => c.hrEnvironmentTag != null),
                                    countWith(discAfter,  c => c.hrEnvironmentTag != null))
console.log("")

console.log("─── BC-1 REALISM DELTA (computeBettorRealismScore over discoveryPool) ──")
function rs(arr) { try { return computeBettorRealismScore(arr) } catch (e) { return { error: e.message } } }
const rBefore = rs(discBefore)
const rAfter  = rs(discAfter)
function showRealism(label, r) {
  if (!r) { console.log("  " + label.padEnd(20) + "  (null — empty pool)"); return }
  if (r.error) { console.log("  " + label.padEnd(20) + "  ERROR: " + r.error); return }
  console.log("  " + label.padEnd(20) + JSON.stringify({
    score:                  r.score,
    depthCoverage:          r.depthCoverage,
    avgTeamTotalNorm:       r.avgTeamTotalNorm,
    gameTotalFavorability:  r.gameTotalFavorability,
    hrEnvFavorability:      r.hrEnvFavorability,
    depthSeen:              r.depthSeen,
    ttCount:                r.ttCount,
    gtCount:                r.gtCount,
    envSeen:                r.envSeen,
    sampleSize:             r.sampleSize,
  }))
}
showRealism("BEFORE:", rBefore)
showRealism("AFTER:",  rAfter)
console.log("")

console.log("─── ITEM 0001 SURVIVABILITY DELTA (mlb dispatcher over discoveryPool) ──")
function gateCounts(arr) {
  const c = { robust: 0, fragile: 0, fallback: 0, error: 0 }
  for (const cand of arr) {
    try {
      const g = survivabilityGate(cand, "mlb")
      if (!g || !g.predicate) { c.fallback++; continue }
      if (g.predicate.startsWith("neutral-fallback")) c.fallback++
      else if (g.admit) c.robust++
      else c.fragile++
    } catch (_) { c.error++ }
  }
  return c
}
const gBefore = gateCounts(discBefore)
const gAfter  = gateCounts(discAfter)
console.log("                            BEFORE        AFTER         Δ")
metric("robust admits",   gBefore.robust,   gAfter.robust)
metric("fragile rejects", gBefore.fragile,  gAfter.fragile)
metric("neutral-fallback",gBefore.fallback, gAfter.fallback)
metric("gate errors",     gBefore.error,    gAfter.error)
console.log("")
const denBefore = Math.max(1, gBefore.robust + gBefore.fragile + gBefore.fallback)
const denAfter  = Math.max(1, gAfter.robust  + gAfter.fragile  + gAfter.fallback)
console.log("  fallback rate BEFORE: " + ((gBefore.fallback/denBefore)*100).toFixed(1) + "%")
console.log("  fallback rate AFTER:  " + ((gAfter.fallback/denAfter)*100).toFixed(1) + "%")
console.log("  robust rate   BEFORE: " + ((gBefore.robust/denBefore)*100).toFixed(1) + "%")
console.log("  robust rate   AFTER:  " + ((gAfter.robust/denAfter)*100).toFixed(1) + "%")
console.log("  fragile rate  BEFORE: " + ((gBefore.fragile/denBefore)*100).toFixed(1) + "%")
console.log("  fragile rate  AFTER:  " + ((gAfter.fragile/denAfter)*100).toFixed(1) + "%")
console.log("")

console.log("════════════════════════════════════════════════════════════════════")
console.log("RESULT: PROBE COMPLETE (informational; non-blocking)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")
process.exit(0)
