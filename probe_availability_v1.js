"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Phase 1 — Live Availability V1 verification probe.
// Three passes:
//   PASS 1: Verify populator parser + cache schema with real-shape ESPN fixture
//   PASS 2: Verify availability cache reader behavior (honest unknown when absent)
//   PASS 3: Verify modelProb shift composition with all 6 context layers
//           PASS A: BEFORE (no availability cache populated — current state)
//           PASS B: WITH SIMULATED CACHE (Donovan Mitchell OUT, Cade Cunningham QUESTIONABLE)
//
// Sandbox has no network — fixture-mode only. Operator runs the live
// populator from TERM 1.

function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}
function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}

// ===== PASS 1: populator parser + cache builder =====
console.log("============== PASS 1 — populator parser ==============")
const { parseTeamInjuries, buildCacheFromEntries } = require("./backend/scripts/populateNbaInjuryReport")

// Real-shape ESPN team-injuries fixture
const espnFixtureCLE = {
  team: { id: "5", displayName: "Cleveland Cavaliers" },
  injuries: [
    { athlete: { displayName: "Donovan Mitchell" }, status: "Out",          shortComment: "Right hand soreness", date: "2026-05-12T18:00Z" },
    { athlete: { displayName: "Dean Wade" },        status: "Day-To-Day",   shortComment: "Knee maintenance",     date: "2026-05-12T18:00Z" },
    { athlete: { displayName: "Sam Merrill" },      status: "Probable",     shortComment: "Ankle, expected to play" },
  ],
}
const espnFixtureDET = {
  team: { id: "8", displayName: "Detroit Pistons" },
  injuries: [
    { athlete: { displayName: "Cade Cunningham" }, status: "Questionable", shortComment: "Hip, game-time decision" },
    { athlete: { displayName: "Isaiah Stewart II" }, status: "Out for Season", shortComment: "Knee surgery" },
  ],
}
const fixtureEntries = [
  ...parseTeamInjuries(espnFixtureCLE, "5"),
  ...parseTeamInjuries(espnFixtureDET, "8"),
]
console.log("entries parsed:", fixtureEntries.length)
for (const e of fixtureEntries) {
  console.log(" ", e.player.padEnd(22), "team="+(e.team||"?").padEnd(20), "status="+e.status.padEnd(13), "raw="+(e.raw_status||"?").padEnd(15), "desc="+(e.description||"?").slice(0,40))
}
console.log("\nstatus normalisation verified:")
console.log("  'Out'             →", fixtureEntries.find(e=>e.player==="Donovan Mitchell")?.status)
console.log("  'Day-To-Day'      →", fixtureEntries.find(e=>e.player==="Dean Wade")?.status)
console.log("  'Probable'        →", fixtureEntries.find(e=>e.player==="Sam Merrill")?.status)
console.log("  'Questionable'    →", fixtureEntries.find(e=>e.player==="Cade Cunningham")?.status)
console.log("  'Out for Season'  →", fixtureEntries.find(e=>e.player==="Isaiah Stewart II")?.status)

const fixtureCache = buildCacheFromEntries(fixtureEntries)
console.log("\nfixture cache players:", Object.keys(fixtureCache.players).length)

// ===== PASS 2: cache reader honest unknown =====
console.log("\n============== PASS 2 — cache reader honesty ==============")
const cacheModule = require("./backend/pipeline/nba/nbaAvailabilityCache")
cacheModule.resetCache()
// Inject the fixture into the cache module via writing a temp file at the cache path.
// To keep test isolated, we write to a TEMP path and re-load via the module's mechanism.
// The cleanest approach: write fixture to a tmp file, copy to actual cache path,
// load, then restore original.
const CACHE_PATH = path.join(__dirname, "backend/data/nbaInjuryReport.json")
const backupExisting = fs.existsSync(CACHE_PATH) ? fs.readFileSync(CACHE_PATH, "utf8") : null
fs.writeFileSync(CACHE_PATH, JSON.stringify(fixtureCache, null, 2))
cacheModule.resetCache()  // force re-load

console.log("getAvailability('Donovan Mitchell'):", JSON.stringify(cacheModule.getAvailability("Donovan Mitchell")))
console.log("getAvailability('Cade Cunningham'):  ", JSON.stringify(cacheModule.getAvailability("Cade Cunningham")))
console.log("getAvailability('Sam Merrill'):       ", JSON.stringify(cacheModule.getAvailability("Sam Merrill")))
console.log("getAvailability('Unknown Player'):    ", JSON.stringify(cacheModule.getAvailability("Unknown Player")), "(should be null — honest unknown)")

// ===== PASS 3: modelProb shift composition =====
console.log("\n============== PASS 3 — modelProb shift composition ==============")
const sig = require("./backend/pipeline/nba/nbaModelSignals")
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require("./backend/pipeline/nba/nbaEventTeamResolve")
const { enrichRowWithRecentForm } = require("./backend/pipeline/nba/nbaRecentFormCache")
const { enrichRowWithRoleContext } = require("./backend/pipeline/nba/nbaRoleContextDeriver")
const { buildSlateContextFromSnapshot, enrichRowWithTeammateContext } = require("./backend/pipeline/nba/nbaTeammateContextDeriver")
const { buildSlateMarketContext, enrichRowWithMarketContext } = require("./backend/pipeline/nba/nbaMarketContextDeriver")

const snap = rj("backend/snapshot.json")
const rowsRaw = snap?.data?.rows || snap?.data?.props || []
const teammateCtx = buildSlateContextFromSnapshot(rowsRaw)
const marketCtx   = buildSlateMarketContext(rowsRaw)

function enrichAll(r, useAvailability) {
  const e = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  enrichRowWithRecentForm(e); enrichRowWithRoleContext(e)
  enrichRowWithTeammateContext(e, teammateCtx); enrichRowWithMarketContext(e, marketCtx)
  if (useAvailability) cacheModule.enrichRowWithAvailability(e)
  return e
}

// Find Donovan Mitchell + Cade Cunningham rows for shift comparison
const targetPlayers = new Set(["donovan mitchell","cade cunningham","sam merrill","jalen duren"])
const matchingRows = rowsRaw.filter(r => {
  if (!r?.player) return false
  if (!targetPlayers.has(String(r.player).toLowerCase())) return false
  const mk=String(r.marketKey||"").toLowerCase()
  if (mk.includes("alternate")||mk.includes("_alt")) return false
  const o=Number(r.odds);if(!Number.isFinite(o)||o<-200||o>200) return false
  const propT=String(r.propType||"").toLowerCase()
  return /points|rebounds|assists|threes|three|3pt|pra/.test(propT)
}).slice(0, 8)

console.log("rows examined:", matchingRows.length, "(targeting Mitchell, Cunningham, Merrill, Duren)")
for (const r of matchingRows) {
  const eA = enrichAll(r, /*useAvailability=*/false)
  const eB = enrichAll(r, /*useAvailability=*/true)
  const mpA = sig.nbaRowIndependentModelProbability(eA)
  const mpB = sig.nbaRowIndependentModelProbability(eB)
  const shift = (mpB - mpA) * 100
  console.log(`  ${r.player.padEnd(22)} ${r.propType.padEnd(8)} ${r.side.padEnd(5)} L${r.line||'?'} @${r.odds>=0?'+':''}${r.odds}`)
  console.log(`     status=${eB.playerStatus||"unknown"}  availabilityShift=${eB.availabilityShift||0}`)
  console.log(`     modelProb (no avail)=${mpA?.toFixed(4)}  (with avail)=${mpB?.toFixed(4)}  Δ ${shift>=0?'+':''}${shift.toFixed(2)} pp`)
}

// ===== End-to-end tier check =====
console.log("\n============== END-TO-END (tier shape preserved) ==============")
const { diversifyCandidates } = require("./backend/pipeline/shared/buildCandidateDiversity")
const { buildAiSlips } = require("./backend/pipeline/shared/buildSlipAi")
function bsc(rows, slateTeammate, slateMarket) {
  if(!Array.isArray(rows)||!rows.length)return[]
  const rq=[]
  for(const r of rows){
    const player=String(r?.player||"").trim();if(!player)continue
    const side=String(r?.side||"").toLowerCase();if(!side||side==="unknown")continue
    const mk=String(r?.marketKey||"").toLowerCase(),pv=String(r?.propVariant||"").toLowerCase()
    const ia=mk.includes("alternate")||mk.includes("_alt")||(pv&&pv!=="base"&&pv!=="default")
    if(ia){const pq=String(r?.propType||mk).toLowerCase();const ok=pq.includes("points_rebounds_assists")||pq.includes("_pra")||pq==="pra"||pq.startsWith("pra_")||pq.includes("points")||pq.includes("threes")||pq.includes("three")||pq.includes("3pt");if(!ok)continue}
    const odds=Number(r?.odds??r?.oddsAmerican);if(!Number.isFinite(odds)||odds<-200||odds>(ia?800:200))continue
    const propT=String(r?.propType||mk).toLowerCase()
    const family=propT.includes("points_rebounds_assists")||/\bpra\b/.test(propT)?"pra":propT.includes("first_basket")?"first_basket":propT.includes("points")?"points":propT.includes("rebounds")?"rebounds":propT.includes("assists")?"assists":(propT.includes("threes")||propT.includes("three")||propT.includes("3pt"))?"threes":null
    if(!family)continue
    const e2=enrichAll(r, true)
    const mp=sig.nbaRowModelProbability(e2);if(!Number.isFinite(mp)||mp<0.35)continue
    const edge=sig.nbaRowEdge(e2);if(!Number.isFinite(edge)||edge<0.03)continue
    if(ia&&(mp<0.42||edge<0.06))continue
    rq.push({...e2,player,statFamily:family,side,odds,oddsAmerican:odds,modelProb:mp,edge,
      volatility:ia?(family==="points"?"aggressive":"lotto"):(family==="pra"?"lotto":(family==="threes"||family==="first_basket")?"aggressive":"balanced"),
      snapshotSourced:true,isAltLine:ia,id:"snap|"+(ia?"alt":"base")+"|"+player+"|"+family+"|"+side})
  }
  const best=new Map()
  for(const c of rq){const sg=(c.isAltLine?"alt":"base")+"|"+c.player+"|"+c.statFamily+"|"+c.side;if(!best.has(sg)||(c.edge??0)>(best.get(sg).edge??0))best.set(sg,c)}
  return Array.from(best.values()).sort((a,b)=>(b.edge??0)-(a.edge??0)).slice(0,150)
}
const supp = bsc(rowsRaw, teammateCtx, marketCtx)
const date = '2026-05-09'
const tb = rj("backend/runtime/tracking/nba_tracked_bets_"+date+".json", []) || []
const eb = tb.filter(b=>Number(b?.edge)>0.04 && Number(b?.modelProb)>0.20)
const sigSet = new Set(eb.map(rc=>String(rc.player||"").toLowerCase()+"|"+String(rc.statFamily||rc.propType||"").toLowerCase()+"|"+String(rc.side||"").toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||"").toLowerCase()+"|"+sc.statFamily+"|"+sc.side))
const cands = diversifyCandidates([...eb,...novel],{maxPerPlayer:3,maxPerGame:12})
const res = buildAiSlips({candidates:cands, options:{sport:"nba", date, maxPerTier:4}, portfolioBaseline:{bets:cands}})
const t = res.slips || {}
console.log("diversified candidates:", cands.length, "  slips: safe="+(t.safe||[]).length+" balanced="+(t.balanced||[]).length+" aggressive="+(t.aggressive||[]).length+" lotto="+(t.lotto||[]).length)

// === Restore original cache state ===
if (backupExisting === null) try { fs.unlinkSync(CACHE_PATH) } catch (_) {}
else fs.writeFileSync(CACHE_PATH, backupExisting)
cacheModule.resetCache()
console.log("\n[probe-cleanup] restored original cache state")
