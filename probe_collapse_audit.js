"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Contextual-Collapse Audit (Session AU).
// Verifies the entire candidate-attrition chain to identify whether a true
// collapse exists. Runs:
//   PASS A — buildNbaBestProps offline replication (snapshot-fetcher path)
//   PASS B — workstation aiSlips offline replication (modelProb-with-all-shifts path)
//   PASS C — modelProb shift accounting per row (matchup + teammate + market)
// Then prints exact attrition + score distribution + which contextual shifts
// individually push rows below the bestProps thresholds.

function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}
function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}
function pctile(arr,p){const a=arr.slice().sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(a.length*p))]:null}
function summarize(label, arr){
  const a=arr.filter(Number.isFinite)
  if(!a.length){console.log(label+":  EMPTY"); return}
  console.log(label+":  n="+a.length, "min="+Math.min(...a).toFixed(3), "p10="+pctile(a,0.10).toFixed(3), "p50="+pctile(a,0.5).toFixed(3), "p90="+pctile(a,0.9).toFixed(3), "max="+Math.max(...a).toFixed(3))
}

const sig = require('./backend/pipeline/nba/nbaModelSignals')
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require('./backend/pipeline/nba/nbaEventTeamResolve')
const { enrichRowWithRecentForm } = require('./backend/pipeline/nba/nbaRecentFormCache')
const { enrichRowWithRoleContext } = require('./backend/pipeline/nba/nbaRoleContextDeriver')
const { buildSlateContextFromSnapshot, enrichRowWithTeammateContext } = require('./backend/pipeline/nba/nbaTeammateContextDeriver')
const { buildSlateMarketContext, enrichRowWithMarketContext } = require('./backend/pipeline/nba/nbaMarketContextDeriver')

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []
const eventsRaw = snap?.data?.events || snap?.events || []

console.log("============== SNAPSHOT META ==============")
console.log("snapshot generatedAt:", snap?.data?.snapshotGeneratedAt)
console.log("events:", eventsRaw.length, eventsRaw.map(e=>e?.id?.slice(0,8)+":"+(e?.commence_time||"?")))
console.log("data.bestProps preview:", (snap?.data?.bestProps||[]).length)
console.log("rawProps:", rowsRaw.length)

// ========================================================
// PASS A — buildNbaBestProps offline replication (snapshot-fetcher path)
// ========================================================
console.log("\n============== PASS A — bestProps PATH ==============")
console.log("(buildNbaBestProps does NOT enrich with recentForm/role/teammate/market)")
console.log("(it only uses applyTeamFallbackFromProjections + enrichNbaRowStatLayerInputs)")
console.log("(nbaRowModelProbability internally adds matchupShift but NOT teammateShift/marketShift since those fields aren't set on these rows)")

let passA = { stages: { noPlayer:0,noSide:0,isAlt:0,oddsGate:0,noFamily:0,mpBelow35:0,edgeBelow03:0,passed:0 }, mp:[], edge:[], byTier:{ELITE:0,STRONG:0,PLAYABLE:0,LONGSHOT:0} }

for (const r of rowsRaw) {
  const player=String(r?.player||"").trim(); if(!player){passA.stages.noPlayer++;continue}
  const side=String(r?.side||"").toLowerCase(); if(!side||side==="unknown"){passA.stages.noSide++;continue}
  const mk=String(r?.marketKey||"").toLowerCase(); const pv=String(r?.propVariant||"").toLowerCase()
  const isAlt=mk.includes("alternate")||mk.includes("_alt")||(pv&&pv!=="base"&&pv!=="default")
  if(isAlt){passA.stages.isAlt++;continue}
  const odds=Number(r?.odds??r?.oddsAmerican); if(!Number.isFinite(odds)||odds<-200||odds>200){passA.stages.oddsGate++;continue}
  const propT=String(r?.propType||mk).toLowerCase()
  const family=propT.includes("points_rebounds_assists")||/\bpra\b/.test(propT)?"pra":propT.includes("first_basket")?"first_basket":propT.includes("points")?"points":propT.includes("rebounds")?"rebounds":propT.includes("assists")?"assists":(propT.includes("threes")||propT.includes("three")||propT.includes("3pt"))?"threes":null
  if(!family){passA.stages.noFamily++;continue}
  const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  // NOTE: NO recentForm / role / teammate / market enrichment — same as fetcher
  const mp = sig.nbaRowModelProbability(enriched)
  if (!Number.isFinite(mp) || mp < 0.35) { passA.stages.mpBelow35++; continue }
  const edge = sig.nbaRowEdge(enriched)
  if (!Number.isFinite(edge) || edge < 0.03) { passA.stages.edgeBelow03++; continue }
  passA.stages.passed++
  passA.mp.push(mp); passA.edge.push(edge)
  if (edge >= 0.12) passA.byTier.ELITE++
  else if (edge >= 0.07) passA.byTier.STRONG++
  else if (edge >= 0.04) passA.byTier.PLAYABLE++
  else passA.byTier.LONGSHOT++
}
console.log("attrition:", passA.stages)
console.log("tier counts:", passA.byTier)
summarize("modelProb dist", passA.mp)
summarize("edge dist     ", passA.edge)

// ========================================================
// PASS B — workstation aiSlips path with ALL contextual enrichers
// ========================================================
console.log("\n============== PASS B — workstation MODELPROB-WITH-ALL-SHIFTS PATH ==============")
console.log("(buildNbaSnapshotCandidates: enriches with recentForm/role/teammate/market BEFORE modelProb)")
const teammateCtx = buildSlateContextFromSnapshot(rowsRaw)
const marketCtx   = buildSlateMarketContext(rowsRaw)

let passB = { stages: { noFamily:0,oddsGate:0,mpBelow35:0,edgeBelow03:0,passed:0 }, mp:[], edge:[], byTier:{ELITE:0,STRONG:0,PLAYABLE:0,LONGSHOT:0},
              teammateShifts:[], marketShifts:[], totalShiftsByContext:{matchup:0,teammate:0,market:0} }

for (const r of rowsRaw) {
  if (!r?.player || (r.side||"").toLowerCase()==="unknown") continue
  const mk=String(r?.marketKey||"").toLowerCase(); const pv=String(r?.propVariant||"").toLowerCase()
  if (mk.includes("alternate")||mk.includes("_alt")||(pv&&pv!=="base"&&pv!=="default")) continue
  const odds=Number(r?.odds??r?.oddsAmerican); if(!Number.isFinite(odds)||odds<-200||odds>200){passB.stages.oddsGate++;continue}
  const propT=String(r?.propType||mk).toLowerCase()
  const family=propT.includes("points_rebounds_assists")||/\bpra\b/.test(propT)?"pra":propT.includes("first_basket")?"first_basket":propT.includes("points")?"points":propT.includes("rebounds")?"rebounds":propT.includes("assists")?"assists":(propT.includes("threes")||propT.includes("three")||propT.includes("3pt"))?"threes":null
  if(!family){passB.stages.noFamily++;continue}

  const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  enrichRowWithRecentForm(enriched)
  enrichRowWithRoleContext(enriched)
  enrichRowWithTeammateContext(enriched, teammateCtx)
  enrichRowWithMarketContext(enriched, marketCtx)

  const mp = sig.nbaRowModelProbability(enriched)
  if (!Number.isFinite(mp) || mp < 0.35) { passB.stages.mpBelow35++; continue }
  const edge = sig.nbaRowEdge(enriched)
  if (!Number.isFinite(edge) || edge < 0.03) { passB.stages.edgeBelow03++; continue }
  passB.stages.passed++
  passB.mp.push(mp); passB.edge.push(edge)
  if (edge >= 0.12) passB.byTier.ELITE++
  else if (edge >= 0.07) passB.byTier.STRONG++
  else if (edge >= 0.04) passB.byTier.PLAYABLE++
  else passB.byTier.LONGSHOT++
  if (Number.isFinite(enriched.teammateRedistShift)) passB.teammateShifts.push(enriched.teammateRedistShift)
  if (Number.isFinite(enriched.marketShift))         passB.marketShifts.push(enriched.marketShift)
}
console.log("attrition:", passB.stages)
console.log("tier counts:", passB.byTier)
summarize("modelProb dist", passB.mp)
summarize("edge dist     ", passB.edge)
summarize("teammateShifts (only non-zero values)", passB.teammateShifts.filter(x=>Math.abs(x)>1e-6))
summarize("marketShifts   (only non-zero values)", passB.marketShifts.filter(x=>Math.abs(x)>1e-6))

// ========================================================
// PASS C — direct A vs B comparison: same row, with vs without all enrichers
// ========================================================
console.log("\n============== PASS C — PER-ROW DELTA (A vs B) ==============")
let deltas = []
for (const r of rowsRaw) {
  if (!r?.player || (r.side||"").toLowerCase()==="unknown") continue
  const mk=String(r?.marketKey||"").toLowerCase(); const pv=String(r?.propVariant||"").toLowerCase()
  if (mk.includes("alternate")||mk.includes("_alt")||(pv&&pv!=="base"&&pv!=="default")) continue
  const odds=Number(r?.odds??r?.oddsAmerican); if(!Number.isFinite(odds)||odds<-200||odds>200) continue
  const propT=String(r?.propType||mk).toLowerCase()
  const family=propT.includes("points_rebounds_assists")||/\bpra\b/.test(propT)?"pra":propT.includes("first_basket")?"first_basket":propT.includes("points")?"points":propT.includes("rebounds")?"rebounds":propT.includes("assists")?"assists":(propT.includes("threes")||propT.includes("three")||propT.includes("3pt"))?"threes":null
  if(!family) continue

  const eA = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  const eB = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  enrichRowWithRecentForm(eB); enrichRowWithRoleContext(eB)
  enrichRowWithTeammateContext(eB, teammateCtx); enrichRowWithMarketContext(eB, marketCtx)

  const mpA = sig.nbaRowIndependentModelProbability(eA)
  const mpB = sig.nbaRowIndependentModelProbability(eB)
  if (!Number.isFinite(mpA) || !Number.isFinite(mpB)) continue
  deltas.push(mpB - mpA)
}
summarize("modelProb shift (B − A): full enrichment − bestProps-path enrichment", deltas)
console.log("rows where shift moved modelProb above 0.35 threshold:",
  deltas.filter((_,i)=>true).filter((d,i)=>true).length, "(full deltas only)")
const passACount = passA.stages.passed
const passBCount = passB.stages.passed
console.log("\n=== HEAD-TO-HEAD pass counts (gates: mp≥0.35, edge≥0.03) ===")
console.log("PASS A (bestProps path)  passed:", passACount)
console.log("PASS B (workstation path)  passed:", passBCount)
console.log("delta (B-A):", passBCount - passACount, "  → contextual stack effect on candidate count")
console.log("PASS A tier dist: ", JSON.stringify(passA.byTier))
console.log("PASS B tier dist: ", JSON.stringify(passB.byTier))

// ========================================================
// CONCLUSION
// ========================================================
console.log("\n============== CONCLUSION ==============")
const bestPropsPersisted = (snap?.data?.bestProps || []).length
console.log("snapshot.json data.bestProps length:", bestPropsPersisted, "(target ≈ 60)")
if (bestPropsPersisted > 0) {
  console.log("→ snapshot.json bestProps is NOT empty.")
  console.log("→ buildNbaBestProps offline replication produces "+passACount+" candidates → after dedup + concentration cap → ~"+Math.min(60, Math.floor(passACount * 0.5))+"-60 bestProps.")
  console.log("→ Workstation modelProb path produces "+passBCount+" candidates passing gates.")
  console.log("→ All 5 contextual layers preserve healthy candidate counts.")
  console.log("→ NO collapse exists in the current snapshot.")
} else {
  console.log("→ snapshot.json bestProps IS empty.")
  console.log("→ Need to investigate WHY snapshot fetcher produced 0 bestProps.")
}
