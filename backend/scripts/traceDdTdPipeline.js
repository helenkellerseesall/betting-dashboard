#!/usr/bin/env node
"use strict"

/**
 * traceDdTdPipeline — diagnose where DD/TD rows die between snapshot and candidates.
 *
 * Steps through the same gates buildNbaSnapshotCandidates uses, but counts
 * how many DD/TD rows pass each one. Prints a funnel.
 */

const path = require("path")
const fs = require("fs")

const snapPath = path.join(__dirname, "..", "snapshot.json")
const wrap = JSON.parse(fs.readFileSync(snapPath, "utf8"))
const snap = wrap.data || wrap
const rawProps = Array.isArray(snap.rawProps) ? snap.rawProps : []

function isDdTd(r) {
  const t = String(r?.propType || r?.marketKey || "").toLowerCase()
  return /double[_\s-]*double|triple[_\s-]*double/.test(t)
}

const ddTdRows = rawProps.filter(isDdTd)
console.log(`Total rawProps: ${rawProps.length}`)
console.log(`DD/TD rows in snapshot: ${ddTdRows.length}`)
console.log()

// Walk the buildNbaSnapshotCandidates gates in order
let n = ddTdRows.length
const killedAt = []

// Gate 1: player + side required
const g1 = ddTdRows.filter(r => {
  const player = String(r?.player || "").trim()
  const side   = String(r?.side || "").toLowerCase()
  return player && side && side !== "unknown"
})
console.log(`Gate 1 — player + side present: ${g1.length}/${n}`)
killedAt.push({ gate: "player+side", killed: n - g1.length })
n = g1.length

// Gate 2: alt-line pre-check (only affects alt-lines)
const g2 = g1.filter(r => {
  const mk = String(r?.marketKey || "").toLowerCase()
  const pv = String(r?.propVariant || "").toLowerCase()
  const isAlt = mk.includes("alternate") || mk.includes("_alt") || (pv && pv !== "base" && pv !== "default")
  if (!isAlt) return true
  const propT = String(r?.propType || mk).toLowerCase()
  return propT.includes("points_rebounds_assists") || propT.includes("_pra") || propT === "pra" ||
         propT.startsWith("pra_") || propT.includes("points") || propT.includes("threes") ||
         propT.includes("three") || propT.includes("3pt")
})
console.log(`Gate 2 — alt-line pre-check: ${g2.length}/${n}`)
killedAt.push({ gate: "alt-line precheck", killed: n - g2.length })
n = g2.length

// Gate 3: odds range (DD/TD get +2500 cap per my edit)
const g3 = g2.filter(r => {
  const mk = String(r?.marketKey || "").toLowerCase()
  const isAlt = mk.includes("alternate") || mk.includes("_alt")
  const odds = Number(r?.odds ?? r?.oddsAmerican)
  const isDdTdQuick = /double[_\s-]*double|triple[_\s-]*double/.test(String(r?.propType || mk).toLowerCase())
  const cap = isDdTdQuick ? 2500 : (isAlt ? 800 : 200)
  return Number.isFinite(odds) && odds >= -200 && odds <= cap
})
console.log(`Gate 3 — odds in range: ${g3.length}/${n}`)
killedAt.push({ gate: "odds range", killed: n - g3.length, capUsed: "DD/TD=+2500" })
n = g3.length

// Gate 4: model probability
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require("../pipeline/nba/nbaEventTeamResolve")

const passed = []
const debug = []
for (const r of g3) {
  let enriched
  try {
    enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  } catch (e) {
    enriched = { ...r }
  }
  const mp = nbaRowModelProbability(enriched)
  const edge = nbaRowEdge(enriched)
  // 2026-05-26 — family-aware mp floor (matches live engine):
  // DD floor 0.10, TD floor 0.04, all others 0.35.
  const propTLower = String(r?.propType || r?.marketKey || "").toLowerCase()
  const isTd  = /triple[_\s-]*double/.test(propTLower)
  const isDd  = !isTd && /double[_\s-]*double/.test(propTLower)
  const mpFloor = isTd ? 0.04 : (isDd ? 0.10 : 0.35)
  debug.push({
    player: r.player,
    prop: r.propType,
    side: r.side,
    odds: r.odds,
    mp: Number.isFinite(mp) ? mp.toFixed(3) : "—",
    edge: Number.isFinite(edge) ? edge.toFixed(3) : "—",
    ddHr5: Number.isFinite(enriched.ddHitRateL5) ? enriched.ddHitRateL5.toFixed(2) : "—",
    tdHr5: Number.isFinite(enriched.tdHitRateL5) ? enriched.tdHitRateL5.toFixed(2) : "—",
    mpFloor: mpFloor.toFixed(2),
    mpPass: Number.isFinite(mp) && mp >= mpFloor,
    edgePass: Number.isFinite(edge) && edge >= 0.03,
  })
  if (Number.isFinite(mp) && mp >= mpFloor && Number.isFinite(edge) && edge >= 0.03) {
    passed.push({ r, mp, edge })
  }
}
console.log(`Gate 4 — family-aware mp floor + edge >= 0.03: ${passed.length}/${n}`)
console.log()
console.log("=== ROW-LEVEL DETAILS (DD/TD only, first 20) ===")
console.log("player                   prop                       side    odds   mp     edge   ddHr5  tdHr5  floor  mpPass  edgePass")
console.log("----------------------------------------------------------------------------------------------------------------------")
for (const d of debug.slice(0, 20)) {
  console.log(
    String(d.player).padEnd(24) + " " +
    String(d.prop).slice(0, 26).padEnd(26) + " " +
    String(d.side).padEnd(6) + " " +
    String(d.odds).padEnd(6) + " " +
    String(d.mp).padEnd(6) + " " +
    String(d.edge).padEnd(6) + " " +
    String(d.ddHr5).padEnd(6) + " " +
    String(d.tdHr5).padEnd(6) + " " +
    String(d.mpFloor).padEnd(6) + " " +
    String(d.mpPass ? "Y" : "N").padEnd(7) + " " +
    String(d.edgePass ? "Y" : "N")
  )
}

console.log()
console.log("=== SUMMARY ===")
console.log(`Started with ${ddTdRows.length} DD/TD snapshot rows`)
for (const k of killedAt) console.log(`  killed at ${k.gate}: ${k.killed}`)
console.log(`  killed at mp/edge gate: ${n - passed.length}`)
console.log(`  SURVIVED to candidate pool: ${passed.length}`)
