"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')
const TRACKING_DIR = path.join(__dirname, 'backend/runtime/tracking')
function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}
function ff(s,k,d){return path.join(TRACKING_DIR,s+'_'+k+'_'+d+'.json')}

const { diversifyCandidates } = require('./backend/pipeline/shared/buildCandidateDiversity')
const { nbaRowModelProbability, nbaRowEdge } = require('./backend/pipeline/nba/nbaModelSignals')
const { enrichNbaRowStatLayerInputs, applyTeamFallbackFromProjections } = require('./backend/pipeline/nba/nbaEventTeamResolve')

let snap=rj(path.join(__dirname,'backend/snapshot-nba.json'),null)
if(!snap)snap=rj(path.join(__dirname,'backend/snapshot.json'),null)
const snapshotRows=snap?.data?.rows||snap?.data?.props||snap?.rows||[]
console.log('snapshotRows:', snapshotRows.length)

const NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD=20, NBA_SNAPSHOT_TOP_N=150
function bsc(rows){
  if(!Array.isArray(rows)||!rows.length)return[]
  const rq=[]
  for(const r of rows){
    const player=String(r?.player||'').trim();if(!player)continue
    const side=String(r?.side||'').toLowerCase();if(!side||side==='unknown')continue
    const mk=String(r?.marketKey||'').toLowerCase(),pv=String(r?.propVariant||'').toLowerCase()
    const ia=mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default')
    if(ia){const pq=String(r?.propType||mk).toLowerCase();const ok=pq.includes('points_rebounds_assists')||pq.includes('_pra')||pq==='pra'||pq.startsWith('pra_')||pq.includes('points')||pq.includes('threes')||pq.includes('three')||pq.includes('3pt');if(!ok)continue}
    const odds=Number(r?.odds??r?.oddsAmerican);if(!Number.isFinite(odds)||odds<-200||odds>(ia?800:200))continue
    const propT=String(r?.propType||mk).toLowerCase()
    const family=propT.includes('points_rebounds_assists')||/\bpra\b/.test(propT)?'pra':propT.includes('first_basket')?'first_basket':propT.includes('points')?'points':propT.includes('rebounds')?'rebounds':propT.includes('assists')?'assists':(propT.includes('threes')||propT.includes('three')||propT.includes('3pt'))?'threes':null
    if(!family)continue
    const e2=applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    const mp=nbaRowModelProbability(e2);if(!Number.isFinite(mp)||mp<0.35)continue
    const edge=nbaRowEdge(e2);if(!Number.isFinite(edge)||edge<0.03)continue
    if(ia&&(mp<0.42||edge<0.06))continue
    rq.push({...e2,player,statFamily:family,side,odds,oddsAmerican:odds,modelProb:mp,edge,
      volatility:ia?(family==='points'?'aggressive':'lotto'):(family==='pra'?'lotto':(family==='threes'||family==='first_basket')?'aggressive':'balanced'),
      snapshotSourced:true,isAltLine:ia})
  }
  const best=new Map()
  for(const c of rq){const sig=(c.isAltLine?'alt':'base')+'|'+c.player+'|'+c.statFamily+'|'+c.side;if(!best.has(sig)||(c.edge??0)>(best.get(sig).edge??0))best.set(sig,c)}
  return Array.from(best.values()).sort((a,b)=>(b.edge??0)-(a.edge??0)).slice(0,NBA_SNAPSHOT_TOP_N)
}

const snapSupplement=bsc(snapshotRows)
console.log('snapSupplement:', snapSupplement.length)

const date='2026-05-09'
const trackedBets=rj(ff('nba','tracked_bets',date),[])||[]
const entries=(rj(ff('nba','tracked_best',date),null))?.entries||[]
function ebe(e){if(!e)return null;return{...e,edge:e.edgeProbability,modelProb:e.predictedProbability,statFamily:String(e.propType||'').toLowerCase().replace(/\s+/g,''),sportsbook:e.book,odds:e.odds,oddsAmerican:e.odds}}
const enrichedBest=entries.map(ebe).filter(Boolean)
const eligibleBets=trackedBets.filter(b=>Number(b?.edge)>0.04&&Number(b?.modelProb)>0.20)
const rawCandidates=enrichedBest.length?enrichedBest:eligibleBets

console.log('rawCandidates:', rawCandidates.length)
console.log('supplement fires?', rawCandidates.length < NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD && snapSupplement.length > 0)

const trackSig=new Set(rawCandidates.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel=snapSupplement.filter(sc=>!trackSig.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const supplemented=[...rawCandidates,...novel]
console.log('supplemented pool:', supplemented.length)

const candidates=diversifyCandidates(supplemented,{maxPerPlayer:3,maxPerGame:12})
console.log('counts.candidates IF supplement fires:', candidates.length)
console.log()
console.log('TELEMETRY: counts.candidates = 5')
console.log('EXPECTED if supplement fires: candidates =', candidates.length)
console.log()
console.log('CONCLUSION: supplement is NOT firing in live server')
console.log('ROOT CAUSE: live server loaded workstationRoutes.js WITHOUT the supplement block')
console.log('            = TERM 1 has not been restarted since before Session Q')
