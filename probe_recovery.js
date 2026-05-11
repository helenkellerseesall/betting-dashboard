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
const { normalizeCandidate } = require('./backend/pipeline/shared/buildSlipAi')

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
    rq.push({...e2,player,statFamily:family,side,odds,oddsAmerican:odds,modelProb:mp,edge,eventId:e2.eventId||r?.eventId,
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
const aiCandidatesTracked = [...eligibleBets]
const sigSet = new Set(aiCandidatesTracked.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const aiCandidatesRaw = [...aiCandidatesTracked, ...novel]
const aiCandidates = diversifyCandidates(aiCandidatesRaw, { maxPerPlayer:3, maxPerGame:12 })
const normalized = aiCandidates.map(normalizeCandidate).filter(Boolean)
console.log('normalized:', normalized.length)

function americanToDecimal(o){const n=Number(o);return n>0?1+n/100:1+100/Math.abs(n)}

// === PROPOSED NBA-specific overrides ===
const nbaSafeTpl = {
  legCountRange:    [2, 3],
  minModelProb:     0.50,            // was 0.55
  maxOdds:          200,             // was 150
  decimalOddsRange: [1.8, 7.5],      // was [1.8, 4.0]
  allowedVolatility:["safe","balanced"],
  forbidVolatility: ["lotto"],
  maxPerGame:        2,              // was 1 — small NBA slates need 2-same-game
  maxPerStat:        2,
}
const nbaBalancedTpl = {
  legCountRange:    [2, 3],
  minModelProb:     0.45,
  maxOdds:          250,
  decimalOddsRange: [3.0, 8.0],      // unchanged
  allowedVolatility:["safe","balanced"],  // was {safe,balanced,aggressive}
  allowedSides:     null,                  // was ["under"]
  forbidVolatility: [],
  maxPerGame:        2,              // was 1
  maxPerStat:        2,
}

function reportTier(label, tpl) {
  console.log('\n=== ' + label + ' ===')
  console.log('  template:', JSON.stringify({mp:tpl.minModelProb,mo:tpl.maxOdds,dec:tpl.decimalOddsRange,vol:tpl.allowedVolatility,sides:tpl.allowedSides}))
  const eligible = normalized.filter(leg => {
    const isPremium = label.startsWith('SAFE') && (leg.modelProb??0)>=0.50 && (leg.edge??0)>=0.12
    if (tpl.allowedVolatility?.length && !tpl.allowedVolatility.includes(leg.volatility) && !isPremium) return false
    if (tpl.allowedSides && !tpl.allowedSides.includes(leg.side)) return false
    if (tpl.minModelProb!=null && (leg.modelProb??0)<tpl.minModelProb && !isPremium) return false
    if (leg.odds > tpl.maxOdds) return false
    return true
  })
  console.log('  eligible legs:', eligible.length)
  eligible.forEach(l => console.log('    ' + l.player.slice(0,18).padEnd(18) + ' ' + l.statFamily.padEnd(10) + ' ' + l.side.padEnd(5) + ' mp=' + (l.modelProb||0).toFixed(3) + ' edge=' + (l.edge||0).toFixed(3) + ' odds=' + l.odds + ' vol=' + l.volatility + ' event=' + String(l.eventId||'').slice(0,8)))

  // Simulate slip assembly: greedy, no dup player, NBA maxPerGame=2, seek pairs in dec range
  const seenSig = new Set()
  const slipsBuilt = []
  const maxPerGame = tpl.maxPerGame || 2
  for (let i=0;i<eligible.length;i++) {
    if (slipsBuilt.length >= 4) break
    const seed = eligible[i]
    if (seed.eligibleConsumed) continue
    for (let j=i+1;j<eligible.length;j++) {
      const pair = eligible[j]
      if (pair.player === seed.player) continue
      // 2-leg slip: same-game allowed if maxPerGame >= 2
      if (maxPerGame < 2 && seed.eventId && pair.eventId === seed.eventId) continue
      const dec = americanToDecimal(seed.odds)*americanToDecimal(pair.odds)
      if (dec >= tpl.decimalOddsRange[0] && dec <= tpl.decimalOddsRange[1]) {
        const sig = [seed.id, pair.id].sort().join('##')
        if (seenSig.has(sig)) continue
        seenSig.add(sig)
        slipsBuilt.push({ legs:[seed.player+'/'+seed.statFamily+seed.side, pair.player+'/'+pair.statFamily+pair.side], dec:dec.toFixed(2), odds:[seed.odds,pair.odds] })
        seed.eligibleConsumed = true
        break
      }
    }
  }
  console.log('  >>> ' + label + ' slips that would be built:', slipsBuilt.length)
  for (const s of slipsBuilt) console.log('       legs=', s.legs, ' dec=', s.dec, ' odds=', s.odds)
}

reportTier('SAFE (proposed NBA override)', nbaSafeTpl)
reportTier('BALANCED (proposed NBA override)', nbaBalancedTpl)
