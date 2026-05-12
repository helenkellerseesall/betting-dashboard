"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Phase 1 — Teammate Absence + Usage Redistribution V1 verification probe.
// Two passes:
//   PASS A — current snapshot as-is. Expected: minimal/no absences (today's
//            playoff slate is genuinely complete).
//   PASS B — counterfactual: simulate Donovan Mitchell being absent from
//            tonight's CLE slate. Verify the system correctly DETECTS the
//            absence and computes redistribution deltas for his teammates.

function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}
function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}

const sig = require('./backend/pipeline/nba/nbaModelSignals')
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require('./backend/pipeline/nba/nbaEventTeamResolve')
const { enrichRowWithRecentForm } = require('./backend/pipeline/nba/nbaRecentFormCache')
const { enrichRowWithRoleContext } = require('./backend/pipeline/nba/nbaRoleContextDeriver')
const { buildSlateContextFromSnapshot, enrichRowWithTeammateContext } = require('./backend/pipeline/nba/nbaTeammateContextDeriver')

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []

function runPass(label, snapshotRows) {
  console.log("\n========== "+label+" ==========")
  const ctx = buildSlateContextFromSnapshot(snapshotRows)
  let absenceCount = 0
  for (const a of ctx.absenceByTeam.values()) absenceCount += a.length

  console.log("teams on slate:", ctx.slateRosterByTeam.size)
  console.log("likely-absent teammates total:", absenceCount)
  for (const [team, absent] of ctx.absenceByTeam) {
    console.log("  "+team+":", absent.map(a=>a.playerKey+"["+a.confidence+","+a.recentMinutes.toFixed(1)+"min]").join(", "))
  }

  // Walk each base-line eligible row, enrich, count activations + collect shifts.
  let total=0, ctxActive=0, withRedist=0, withShift=0, shifts=[], examples=[]
  for (const r of snapshotRows) {
    const mk=String(r.marketKey||"").toLowerCase();const pv=String(r.propVariant||"").toLowerCase()
    const ia=mk.includes("alternate")||mk.includes("_alt")||(pv&&pv!=="base"&&pv!=="default")
    if (ia) continue
    const o=Number(r.odds);if(!Number.isFinite(o)||o<-200||o>200)continue
    const propT=String(r.propType||r.marketKey||"").toLowerCase()
    if(!/points|rebounds|assists|threes|three|3pt|pra/.test(propT))continue
    if(!r.player||(r.side||"").toLowerCase()==="unknown")continue

    total++
    const eBefore = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    enrichRowWithRecentForm(eBefore)
    enrichRowWithRoleContext(eBefore)

    const eAfter = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    enrichRowWithRecentForm(eAfter)
    enrichRowWithRoleContext(eAfter)
    enrichRowWithTeammateContext(eAfter, ctx)

    const mpBefore = sig.nbaRowIndependentModelProbability(eBefore)
    const mpAfter  = sig.nbaRowIndependentModelProbability(eAfter)
    if (!Number.isFinite(mpBefore) || !Number.isFinite(mpAfter)) continue
    const shift = mpAfter - mpBefore

    if (eAfter.teammateContext) {
      ctxActive++
      if (eAfter.teammateContext.redistribution) withRedist++
      if (Math.abs(eAfter.teammateRedistShift||0) > 1e-6) {
        withShift++
        shifts.push(shift)
        if (examples.length < 8) examples.push({
          player: eAfter.player,
          stat: String(eAfter.propType||eAfter.marketKey||"").toLowerCase().slice(0,12),
          side: eAfter.side, line: eAfter.line, odds: eAfter.odds,
          absent_teammates: eAfter.teammateContext.absent_teammates,
          applied_stat: eAfter.teammateContext.applied_stat,
          applied_delta: eAfter.teammateContext.applied_delta,
          sample_quality: eAfter.teammateContext.applied_sample_quality,
          shift_pp: Number((shift*100).toFixed(2)),
          mpBefore: Number(mpBefore.toFixed(4)),
          mpAfter: Number(mpAfter.toFixed(4)),
        })
      }
    }
  }

  console.log("\nrows scanned:", total)
  console.log("teammateContext activated:    ", ctxActive, pct(ctxActive,total))
  console.log("with valid redistribution data:", withRedist, pct(withRedist,total))
  console.log("with non-zero modelProb shift: ", withShift, pct(withShift,total))
  if (shifts.length) {
    const abs = shifts.map(Math.abs)
    console.log("shift mean(|shift|):", (abs.reduce((s,x)=>s+x,0)/abs.length).toFixed(4),
                "  max:", Math.max(...abs).toFixed(4),
                "  cap MAX_REDIST_SHIFT_PP=0.030 enforced:", Math.max(...abs)<=0.0301)
  }
  if (examples.length) {
    console.log("\nexamples:")
    for (const ex of examples) {
      console.log("  "+ex.player.padEnd(20)+" "+ex.stat.padEnd(10)+" "+ex.side.padEnd(5)+" L"+(ex.line||"?")+" @"+(ex.odds>=0?"+":"")+ex.odds)
      console.log("    absent="+JSON.stringify(ex.absent_teammates))
      console.log("    applied stat="+ex.applied_stat+" delta="+ex.applied_delta+" sample_quality="+ex.sample_quality)
      console.log("    modelProb "+ex.mpBefore+" → "+ex.mpAfter+"   Δ "+(ex.shift_pp>=0?"+":"")+ex.shift_pp+" pp")
    }
  }
  return { total, ctxActive, withRedist, withShift, shifts }
}

// === PASS A: real current slate ===
const passA = runPass("PASS A — current snapshot (real today)", rowsRaw)

// === PASS B: counterfactual — strip Donovan Mitchell's CLE props from slate ===
console.log("\n--- counterfactual setup: removing 'donovan mitchell' from snapshot to simulate his absence ---")
const counterfactualRows = rowsRaw.filter(r => String(r?.player||"").toLowerCase() !== "donovan mitchell")
console.log("removed", rowsRaw.length - counterfactualRows.length, "rows")
const passB = runPass("PASS B — counterfactual (Mitchell absent)", counterfactualRows)

console.log("\n========== SUMMARY ==========")
console.log("PASS A real slate:    ctxActive="+passA.ctxActive+" withShift="+passA.withShift)
console.log("PASS B counterfactual: ctxActive="+passB.ctxActive+" withShift="+passB.withShift)
console.log("Δ activation:", passB.ctxActive - passA.ctxActive, "additional rows received teammate context")
console.log("Δ shifts:    ", passB.withShift - passA.withShift, "additional rows received non-zero shift")

// Tier-shape check (PASS A)
console.log("\n=== End-to-end slip pipeline (real today) ===")
const { diversifyCandidates } = require('./backend/pipeline/shared/buildCandidateDiversity')
const { buildAiSlips } = require('./backend/pipeline/shared/buildSlipAi')
function bsc(rows, slateCtx){
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
    const e2=applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    enrichRowWithRecentForm(e2);enrichRowWithRoleContext(e2);enrichRowWithTeammateContext(e2, slateCtx)
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
const slateCtx = buildSlateContextFromSnapshot(rowsRaw)
const supp = bsc(rowsRaw, slateCtx)
const date = '2026-05-09'
const tb = rj(path.join(__dirname,'backend/runtime/tracking/nba_tracked_bets_'+date+'.json'),[])||[]
const eb = tb.filter(b=>Number(b?.edge)>0.04 && Number(b?.modelProb)>0.20)
const sigSet = new Set(eb.map(rc=>String(rc.player||"").toLowerCase()+"|"+String(rc.statFamily||rc.propType||"").toLowerCase()+"|"+String(rc.side||"").toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||"").toLowerCase()+"|"+sc.statFamily+"|"+sc.side))
const cands = diversifyCandidates([...eb,...novel],{maxPerPlayer:3,maxPerGame:12})
const res = buildAiSlips({candidates:cands, options:{sport:"nba", date, maxPerTier:4}, portfolioBaseline:{bets:cands}})
const t = res.slips || {}
console.log("diversified candidates:", cands.length, "  slips: safe="+(t.safe||[]).length+" balanced="+(t.balanced||[]).length+" aggressive="+(t.aggressive||[]).length+" lotto="+(t.lotto||[]).length)
