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
const { buildAiSlips, TIER_TEMPLATES } = require('./backend/pipeline/shared/buildSlipAi')

let snap=rj(path.join(__dirname,'backend/snapshot-nba.json'),null)
if(!snap)snap=rj(path.join(__dirname,'backend/snapshot.json'),null)
const snapshotRows=snap?.data?.rows||snap?.data?.props||snap?.rows||[]

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
      snapshotSourced:true,isAltLine:ia,
      id:'snap|'+(ia?'alt':'base')+'|'+player+'|'+family+'|'+side})
  }
  const best=new Map()
  for(const c of rq){const sig=(c.isAltLine?'alt':'base')+'|'+c.player+'|'+c.statFamily+'|'+c.side;if(!best.has(sig)||(c.edge??0)>(best.get(sig).edge??0))best.set(sig,c)}
  return Array.from(best.values()).sort((a,b)=>(b.edge??0)-(a.edge??0)).slice(0,150)
}

const supp = bsc(snapshotRows)
const date = '2026-05-09'
const trackedBets = rj(ff('nba','tracked_bets',date),[])||[]
const eligibleBets = trackedBets.filter(b=>Number(b?.edge)>0.04&&Number(b?.modelProb)>0.20)
const sigSet = new Set(eligibleBets.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const aiCandidates = diversifyCandidates([...eligibleBets, ...novel], { maxPerPlayer:3, maxPerGame:12 })
const res = buildAiSlips({candidates:aiCandidates, options:{sport:'nba', date, maxPerTier:4}})

console.log('\n=== POST-RECOVERY NBA SLIPS ===')
for (const tier of ['safe','balanced','aggressive','lotto']) {
  console.log(`\n${tier.toUpperCase()} (${res.slips[tier].length} slips):`)
  for (const s of res.slips[tier]) {
    console.log(`  [${s.combinedAmericanOdds>=0?'+':''}${s.combinedAmericanOdds}] dec=${s.combinedDecimalOdds} cal_prob=${(s.combinedModelProb*100).toFixed(1)}% raw_prob=${(s.rawCombinedModelProb*100).toFixed(1)}% edge=${(s.edge*100).toFixed(1)}% ev=${(s.ev*100).toFixed(1)}%  corr=${s.correlationScore?.toFixed(3)||'-'}`)
    s.legs.forEach(l => console.log(`    ${l.player.padEnd(20)} ${l.statFamily.padEnd(10)} ${l.side.padEnd(5)} L${l.line||'?'} @${l.odds>=0?'+':''}${l.odds} mp=${(l.modelProb||0).toFixed(3)} edge=${(l.edge||0).toFixed(3)}`))
  }
}
console.log('\nWarnings:', res.warnings)

// MLB regression check — run with sport=mlb on the SAME pool to confirm overrides do NOT apply
console.log('\n=== MLB REGRESSION (overrides MUST NOT apply) ===')
const mlbRes = buildAiSlips({candidates:aiCandidates, options:{sport:'mlb', date, maxPerTier:4}})
console.log('mlb slips:', JSON.stringify({safe:mlbRes.slips.safe.length, balanced:mlbRes.slips.balanced.length, aggressive:mlbRes.slips.aggressive.length, lotto:mlbRes.slips.lotto.length}))
console.log('(if safe>0 BALANCED contains overs, MLB regression occurred — but pool is NBA so 0/0 is expected since under-only kicks in for MLB)')
console.log('mlb warnings:', mlbRes.warnings)
