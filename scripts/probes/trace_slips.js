"use strict"
const path = require('path')
const fs   = require('fs')
const TRACKING_DIR = path.join(__dirname, 'backend/runtime/tracking')

function readJsonSafe(p, fb=null) {
  try { if(!fs.existsSync(p))return fb; return JSON.parse(fs.readFileSync(p,'utf8')) } catch(_){return fb}
}
function fileFor(s,k,d){ return path.join(TRACKING_DIR,s+'_'+k+'_'+d+'.json') }

const { diversifyCandidates } = require('./backend/pipeline/shared/buildCandidateDiversity')
const { nbaRowModelProbability, nbaRowEdge } = require('./backend/pipeline/nba/nbaModelSignals')
const { enrichNbaRowStatLayerInputs, applyTeamFallbackFromProjections } = require('./backend/pipeline/nba/nbaEventTeamResolve')
const { buildAiSlips } = require('./backend/pipeline/shared/buildSlipAi')

// readSnapshotRows('nba') exact replica
const sportFile = path.join(__dirname, 'backend/snapshot-nba.json')
let snap = readJsonSafe(sportFile, null)
if (!snap) snap = readJsonSafe(path.join(__dirname,'backend/snapshot.json'),null)
const snapshotRows = snap?.data?.rows || snap?.data?.props || snap?.rows || []
console.log('snapshotRows:', snapshotRows.length)

const NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD = 20
const NBA_SNAPSHOT_TOP_N = 150

function buildNbaSnapshotCandidates(rows) {
  if (!Array.isArray(rows)||!rows.length) return []
  const rawQ = []
  for (const r of rows) {
    const player = String(r?.player||'').trim(); if(!player)continue
    const side   = String(r?.side||'').toLowerCase(); if(!side||side==='unknown')continue
    const mk     = String(r?.marketKey||'').toLowerCase()
    const pv     = String(r?.propVariant||'').toLowerCase()
    const isAlt  = mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default')
    if (isAlt) {
      const pq = String(r?.propType||mk).toLowerCase()
      const ok = pq.includes('points_rebounds_assists')||pq.includes('_pra')||pq==='pra'||pq.startsWith('pra_')||pq.includes('points')||pq.includes('threes')||pq.includes('three')||pq.includes('3pt')
      if(!ok) continue
    }
    const odds = Number(r?.odds??r?.oddsAmerican)
    if(!Number.isFinite(odds)||odds<-200||odds>(isAlt?800:200)) continue
    const propT  = String(r?.propType||mk).toLowerCase()
    const family = propT.includes('points_rebounds_assists')||/\bpra\b/.test(propT)?'pra'
      :propT.includes('first_basket')?'first_basket'
      :propT.includes('points')?'points'
      :propT.includes('rebounds')?'rebounds'
      :propT.includes('assists')?'assists'
      :(propT.includes('threes')||propT.includes('three')||propT.includes('3pt'))?'threes'
      :null
    if(!family) continue
    const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    const mp   = nbaRowModelProbability(enriched); if(!Number.isFinite(mp)||mp<0.35) continue
    const edge = nbaRowEdge(enriched);             if(!Number.isFinite(edge)||edge<0.03) continue
    if(isAlt&&(mp<0.42||edge<0.06)) continue
    rawQ.push({...enriched,player,statFamily:family,side,odds,oddsAmerican:odds,modelProb:mp,edge,
      volatility:isAlt?(family==='points'?'aggressive':'lotto'):(family==='pra'?'lotto':(family==='threes'||family==='first_basket')?'aggressive':'balanced'),
      snapshotSourced:true,isAltLine:isAlt,
      id:'snap|'+(isAlt?'alt':'base')+'|'+player+'|'+family+'|'+side})
  }
  const best = new Map()
  for(const c of rawQ){
    const sig=(c.isAltLine?'alt':'base')+'|'+c.player+'|'+c.statFamily+'|'+c.side
    if(!best.has(sig)||(c.edge??0)>(best.get(sig).edge??0)) best.set(sig,c)
  }
  return Array.from(best.values()).sort((a,b)=>(b.edge??0)-(a.edge??0)).slice(0,NBA_SNAPSHOT_TOP_N)
}

const snapSupplement = buildNbaSnapshotCandidates(snapshotRows)
console.log('snapSupplement:', snapSupplement.length)

const date = '2026-05-09'
const trackedBets = readJsonSafe(fileFor('nba','tracked_bets',date),[]) || []
const entries = (readJsonSafe(fileFor('nba','tracked_best',date),null))?.entries || []
function enrichBE(e){ if(!e)return null; return{...e,edge:e.edgeProbability,modelProb:e.predictedProbability,statFamily:String(e.propType||'').toLowerCase().replace(/\s+/g,''),sportsbook:e.book,odds:e.odds,oddsAmerican:e.odds} }
const enrichedBest = entries.map(enrichBE).filter(Boolean)
const eligibleBets  = trackedBets.filter(b=>Number(b?.edge)>0.04&&Number(b?.modelProb)>0.20)
const aiCandidatesTracked = [...eligibleBets,...enrichedBest]
console.log('aiCandidatesTracked:', aiCandidatesTracked.length)

let aiCandidatesRaw
if(aiCandidatesTracked.length<NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD&&snapSupplement.length){
  const sig = new Set(aiCandidatesTracked.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
  const novel = snapSupplement.filter(sc=>!sig.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
  aiCandidatesRaw = [...aiCandidatesTracked,...novel]
  console.log('Supplement FIRED, novel:', novel.length)
} else {
  aiCandidatesRaw = aiCandidatesTracked
  console.log('Supplement DID NOT FIRE')
}
console.log('aiCandidatesRaw:', aiCandidatesRaw.length)

const aiCandidates = diversifyCandidates(aiCandidatesRaw,{maxPerPlayer:3,maxPerGame:12})
console.log('aiCandidates after diversify:', aiCandidates.length)

const vc={},sc={}
for(const c of aiCandidates){vc[c.volatility]=(vc[c.volatility]||0)+1;sc[c.side]=(sc[c.side]||0)+1}
console.log('volatility breakdown:', JSON.stringify(vc))
console.log('side breakdown:', JSON.stringify(sc))

console.log('\n=== buildAiSlips ===')
const res = buildAiSlips({
  candidates:aiCandidates, timingResult:null, bookState:null, ledgerState:null,
  portfolioBaseline:{bets:aiCandidates}, options:{sport:'nba',date,maxPerTier:4}
})
const tiers = res.slips || {}
console.log('slips:', JSON.stringify({safe:(tiers.safe||[]).length,balanced:(tiers.balanced||[]).length,aggressive:(tiers.aggressive||[]).length,lotto:(tiers.lotto||[]).length}))
console.log('warnings:', JSON.stringify(res.warnings||[]))
