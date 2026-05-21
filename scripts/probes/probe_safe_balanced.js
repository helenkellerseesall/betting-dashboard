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
const { TIER_TEMPLATES, normalizeCandidate } = require('./backend/pipeline/shared/buildSlipAi')

let snap=rj(path.join(__dirname,'backend/snapshot-nba.json'),null)
if(!snap)snap=rj(path.join(__dirname,'backend/snapshot.json'),null)
const snapshotRows=snap?.data?.rows||snap?.data?.props||snap?.rows||[]

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
      snapshotSourced:true,isAltLine:ia,
      id:'snap|'+(ia?'alt':'base')+'|'+player+'|'+family+'|'+side})
  }
  const best=new Map()
  for(const c of rq){const sig=(c.isAltLine?'alt':'base')+'|'+c.player+'|'+c.statFamily+'|'+c.side;if(!best.has(sig)||(c.edge??0)>(best.get(sig).edge??0))best.set(sig,c)}
  return Array.from(best.values()).sort((a,b)=>(b.edge??0)-(a.edge??0)).slice(0,NBA_SNAPSHOT_TOP_N)
}

const supp = bsc(snapshotRows)
const date = '2026-05-09'
const trackedBets = rj(ff('nba','tracked_bets',date),[])||[]
const eligibleBets = trackedBets.filter(b=>Number(b?.edge)>0.04&&Number(b?.modelProb)>0.20)
const aiCandidatesTracked = [...eligibleBets]
const sigSet = new Set(aiCandidatesTracked.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const aiCandidatesRaw = [...aiCandidatesTracked, ...novel]
const aiCandidates = diversifyCandidates(aiCandidatesRaw, { maxPerPlayer:3, maxPerGame:12 })

const normalized = aiCandidates.map(normalizeCandidate).filter(Boolean)
console.log('normalized:', normalized.length)

const balanced = normalized.filter(n => n.volatility === 'balanced')
const aggressive = normalized.filter(n => n.volatility === 'aggressive')
const lotto = normalized.filter(n => n.volatility === 'lotto')

console.log('\n=== BALANCED VOL LEGS (' + balanced.length + ') ===')
for (const l of balanced) console.log(`  ${l.player.slice(0,20).padEnd(20)} ${l.statFamily.padEnd(10)} ${l.side.padEnd(5)} mp=${(l.modelProb||0).toFixed(3)} edge=${(l.edge||0).toFixed(3)} odds=${l.odds.toString().padEnd(5)} line=${l.line||'-'}`)

console.log('\n=== AGGRESSIVE VOL LEGS (' + aggressive.length + ') ===')
for (const l of aggressive) console.log(`  ${l.player.slice(0,20).padEnd(20)} ${l.statFamily.padEnd(10)} ${l.side.padEnd(5)} mp=${(l.modelProb||0).toFixed(3)} edge=${(l.edge||0).toFixed(3)} odds=${l.odds.toString().padEnd(5)} line=${l.line||'-'}`)

console.log('\n=== LOTTO VOL LEGS (' + lotto.length + ') ===')
for (const l of lotto) console.log(`  ${l.player.slice(0,20).padEnd(20)} ${l.statFamily.padEnd(10)} ${l.side.padEnd(5)} mp=${(l.modelProb||0).toFixed(3)} edge=${(l.edge||0).toFixed(3)} odds=${l.odds.toString().padEnd(5)} line=${l.line||'-'}`)

// SAFE eligibility check (current template)
console.log('\n=== SAFE ELIGIBILITY (current: vol∈{safe,balanced} mp≥0.55 odds≤150 dec[1.8,4.0]) ===')
const safeTpl = TIER_TEMPLATES.safe
const safeEligible = normalized.filter(leg => {
  const isPremium = (leg.modelProb??0)>=0.50 && (leg.edge??0)>=0.12
  if (!safeTpl.allowedVolatility.includes(leg.volatility) && !isPremium) return false
  if ((leg.modelProb??0) < safeTpl.minModelProb && !isPremium) return false
  if (leg.odds > safeTpl.maxOdds) return false
  return true
})
console.log('safe-eligible legs:', safeEligible.length)
safeEligible.forEach(l => console.log(`  ${l.player.slice(0,20).padEnd(20)} mp=${(l.modelProb||0).toFixed(3)} edge=${(l.edge||0).toFixed(3)} odds=${l.odds} vol=${l.volatility}`))

// Diagnose drops with each constraint relaxed
console.log('\n=== SAFE drop-stage analysis ===')
let bal_vol_pass = normalized.filter(l => safeTpl.allowedVolatility.includes(l.volatility))
console.log('  vol∈{safe,balanced}:', bal_vol_pass.length)
let mp_55 = bal_vol_pass.filter(l => (l.modelProb??0) >= 0.55)
console.log('  ...AND mp≥0.55:', mp_55.length)
let mp_52 = bal_vol_pass.filter(l => (l.modelProb??0) >= 0.52)
console.log('  ...AND mp≥0.52:', mp_52.length)
let mp_50 = bal_vol_pass.filter(l => (l.modelProb??0) >= 0.50)
console.log('  ...AND mp≥0.50:', mp_50.length)
let mp_50_o150 = mp_50.filter(l => l.odds <= 150)
console.log('  ...AND odds≤150:', mp_50_o150.length)
let mp_50_o180 = mp_50.filter(l => l.odds <= 180)
console.log('  ...AND odds≤180:', mp_50_o180.length)

// BALANCED eligibility (current: under-only)
console.log('\n=== BALANCED ELIGIBILITY (current: vol∈{safe,balanced,aggressive} side=under mp≥0.45 odds≤250 dec[3.0,8.0]) ===')
const balTpl = TIER_TEMPLATES.balanced
const balEligible = normalized.filter(leg => {
  if (!balTpl.allowedVolatility.includes(leg.volatility)) return false
  if (balTpl.allowedSides && !balTpl.allowedSides.includes(leg.side)) return false
  if ((leg.modelProb??0) < balTpl.minModelProb) return false
  return true
})
console.log('balanced-eligible legs:', balEligible.length)
balEligible.forEach(l => console.log(`  ${l.player.slice(0,20).padEnd(20)} ${l.statFamily.padEnd(10)} ${l.side.padEnd(5)} mp=${(l.modelProb||0).toFixed(3)} edge=${(l.edge||0).toFixed(3)} odds=${l.odds} vol=${l.volatility}`))

// 2-leg combos in balanced
function americanToDecimal(o){const n=Number(o);return n>0?1+n/100:1+100/Math.abs(n)}
function tryCombos(legs, minLen, maxLen, decRange) {
  let valid=0, sample=[]
  for (let i=0;i<legs.length;i++) for (let j=i+1;j<legs.length;j++) {
    if (legs[i].player===legs[j].player) continue
    if (legs[i].eventId && legs[j].eventId === legs[i].eventId) continue  // maxPerGame=1
    const dec = americanToDecimal(legs[i].odds)*americanToDecimal(legs[j].odds)
    if (dec>=decRange[0]&&dec<=decRange[1]) { valid++; if(sample.length<3) sample.push({legs:[legs[i].player,legs[j].player],dec:dec.toFixed(2)}) }
  }
  return {valid, sample}
}
console.log('\n  2-leg dec[3,8] combos (no dup player, no same game):', tryCombos(balEligible, 2, 2, balTpl.decimalOddsRange))

// What if we also allowed overs?
console.log('\n=== BALANCED with overs allowed ===')
const balPlusOvers = normalized.filter(leg => {
  if (!balTpl.allowedVolatility.includes(leg.volatility)) return false
  if ((leg.modelProb??0) < balTpl.minModelProb) return false
  return true
})
console.log('  pool:', balPlusOvers.length)
console.log('  2-leg combos:', tryCombos(balPlusOvers, 2, 2, balTpl.decimalOddsRange))
