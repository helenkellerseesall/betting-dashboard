"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Phase 1 — Recent Form V1 verification probe.
// Compares modelProb BEFORE (no recentForm) vs AFTER (recentForm injected
// from real settled-bets aggregator), per row. Confirms:
//   1. Recent-form activation rate matches the cache coverage.
//   2. modelProb visibly shifts on covered players.
//   3. Sample-quality dampening correctly limits influence on thin samples.
//   4. Honest null when no form available.

const TRACKING_DIR = path.join(__dirname, 'backend/runtime/tracking')
function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}

const sig    = require('./backend/pipeline/nba/nbaModelSignals')
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require('./backend/pipeline/nba/nbaEventTeamResolve')
const { enrichRowWithRecentForm, getRecentForm, aggregateFromSettledBets, resetCache } = require('./backend/pipeline/nba/nbaRecentFormCache')

// Force fresh aggregation from settled bets (no stale persisted cache)
resetCache()
aggregateFromSettledBets({ daysBack: 14 })

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []

function isBase(r){const mk=String(r?.marketKey||'').toLowerCase();const pv=String(r?.propVariant||'').toLowerCase();return !(mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default'))}
function familyOK(r){const propT=String(r?.propType||r?.marketKey||'').toLowerCase();return /points|rebounds|assists|threes|three|3pt|pra/.test(propT)}
function inOddsRange(r){const o=Number(r?.odds??r?.oddsAmerican);return Number.isFinite(o)&&o>=-200&&o<=200}

const baseRows = rowsRaw.filter(r => isBase(r) && familyOK(r) && inOddsRange(r) && r.player && (r.side||'').toLowerCase()!=='unknown')
console.log('NBA base-line eligible rows:', baseRows.length)

let stats = {
  rows: 0,
  recentForm_active: 0,
  recentForm_dampened_thin: 0,
  recentForm_full_weight: 0,
  modelProb_changed: 0,
  unique_players_with_form: new Set(),
  shifts: [],
}
const examples = []

for (const r of baseRows) {
  const eBefore = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  const eAfter  = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  enrichRowWithRecentForm(eAfter)

  const mpBefore = sig.nbaRowIndependentModelProbability(eBefore)
  const mpAfter  = sig.nbaRowIndependentModelProbability(eAfter)
  if (!Number.isFinite(mpBefore) || !Number.isFinite(mpAfter)) continue

  stats.rows++
  const rf = eAfter.recentForm
  if (rf) {
    stats.recentForm_active++
    stats.unique_players_with_form.add(String(eAfter.player).toLowerCase())
    if ((rf.sample_count || 0) < 5) stats.recentForm_dampened_thin++
    else stats.recentForm_full_weight++
  }
  const shift = mpAfter - mpBefore
  if (Math.abs(shift) > 1e-6) {
    stats.modelProb_changed++
    stats.shifts.push(shift)
  }
  if (rf && examples.length < 8) {
    examples.push({
      player: eAfter.player,
      stat:   String(eAfter.propType||eAfter.marketKey||'').toLowerCase().slice(0,12),
      side:   eAfter.side,
      line:   eAfter.line,
      odds:   eAfter.odds,
      n:      rf.sample_count,
      last5_avg:  rf.last5_avg,
      last10_avg: rf.last10_avg,
      mpBefore: Number(mpBefore.toFixed(4)),
      mpAfter:  Number(mpAfter.toFixed(4)),
      shift_pp: Number(((mpAfter - mpBefore)*100).toFixed(2)),
    })
  }
}

function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}
function pctile(arr, p){const a=arr.slice().sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(a.length*p))]:0}

console.log('\n=== RECENT-FORM V1 ACTIVATION ===')
console.log('  rows compared:                       ', stats.rows)
console.log('  recentForm cache HIT (any sample):   ', stats.recentForm_active, '(', pct(stats.recentForm_active, stats.rows), ')')
console.log('  └ thin sample (n<5, dampened):       ', stats.recentForm_dampened_thin)
console.log('  └ full-weight sample (n>=5):         ', stats.recentForm_full_weight)
console.log('  unique players with real form:       ', stats.unique_players_with_form.size)
console.log('  modelProb visibly shifted:           ', stats.modelProb_changed, '(', pct(stats.modelProb_changed, stats.rows), ')')
console.log('  shift mean(|shift|):                  ', stats.shifts.length ? (stats.shifts.reduce((s,x)=>s+Math.abs(x),0)/stats.shifts.length).toFixed(4) : '-')
console.log('  shift max (pp):                      ', (stats.shifts.length ? Math.max(...stats.shifts.map(Math.abs)) : 0).toFixed(4) * 100)
console.log('  shift p10/p50/p90 (pp):              ',
  (pctile(stats.shifts,0.10)*100).toFixed(2), '/',
  (pctile(stats.shifts,0.50)*100).toFixed(2), '/',
  (pctile(stats.shifts,0.90)*100).toFixed(2))

console.log('\n=== EXAMPLE ROWS (recentForm injected) ===')
for (const ex of examples) {
  const verdict = Math.abs(ex.shift_pp) > 0.05
    ? `Δ ${ex.shift_pp > 0 ? '+' : ''}${ex.shift_pp.toFixed(2)} pp (n=${ex.n} ${ex.n<5 ? 'thin → blended toward line' : 'full weight'})`
    : `no visible shift (n=${ex.n}, signal too small or fully dampened)`
  console.log(`  ${ex.player.padEnd(20)} ${ex.stat.padEnd(10)} ${ex.side.padEnd(5)} L${ex.line||'?'} @${ex.odds>=0?'+':''}${ex.odds}  l5=${ex.last5_avg ?? '-'}  l10=${ex.last10_avg ?? '-'}  ${ex.mpBefore} → ${ex.mpAfter}   ${verdict}`)
}

// Also run the full live pipeline for tier-shape preservation check
console.log('\n=== END-TO-END SLIP-PIPELINE (tier shape preserved?) ===')
const { diversifyCandidates } = require('./backend/pipeline/shared/buildCandidateDiversity')
const { buildAiSlips } = require('./backend/pipeline/shared/buildSlipAi')

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
    enrichRowWithRecentForm(e2)
    const mp=sig.nbaRowModelProbability(e2);if(!Number.isFinite(mp)||mp<0.35)continue
    const edge=sig.nbaRowEdge(e2);if(!Number.isFinite(edge)||edge<0.03)continue
    if(ia&&(mp<0.42||edge<0.06))continue
    rq.push({...e2,player,statFamily:family,side,odds,oddsAmerican:odds,modelProb:mp,edge,
      volatility:ia?(family==='points'?'aggressive':'lotto'):(family==='pra'?'lotto':(family==='threes'||family==='first_basket')?'aggressive':'balanced'),
      snapshotSourced:true,isAltLine:ia,id:'snap|'+(ia?'alt':'base')+'|'+player+'|'+family+'|'+side})
  }
  const best=new Map()
  for(const c of rq){const sg=(c.isAltLine?'alt':'base')+'|'+c.player+'|'+c.statFamily+'|'+c.side;if(!best.has(sg)||(c.edge??0)>(best.get(sg).edge??0))best.set(sg,c)}
  return Array.from(best.values()).sort((a,b)=>(b.edge??0)-(a.edge??0)).slice(0,150)
}

const supp = bsc(rowsRaw)
const date = '2026-05-09'
const tb = rj(path.join(TRACKING_DIR, 'nba_tracked_bets_'+date+'.json'), [])||[]
const eb = tb.filter(b=>Number(b?.edge)>0.04 && Number(b?.modelProb)>0.20)
const sigSet = new Set(eb.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const cands = diversifyCandidates([...eb, ...novel], { maxPerPlayer:3, maxPerGame:12 })
const res = buildAiSlips({candidates:cands, options:{sport:'nba', date, maxPerTier:4}, portfolioBaseline:{bets:cands}})
const t = res.slips || {}
console.log('  diversified candidates: %d   slips: safe=%d balanced=%d aggressive=%d lotto=%d',
  cands.length, (t.safe||[]).length, (t.balanced||[]).length, (t.aggressive||[]).length, (t.lotto||[]).length)
