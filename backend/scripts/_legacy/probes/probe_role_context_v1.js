"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Phase 1 — Lineup + Rotation Intelligence V1 verification probe.
// Compares modelProb BEFORE (no role context) vs AFTER (role context injected
// from real ESPN game-log cache via nbaRoleContextDeriver).

function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}

const sig = require('./backend/pipeline/nba/nbaModelSignals')
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require('./backend/pipeline/nba/nbaEventTeamResolve')
const { enrichRowWithRecentForm } = require('./backend/pipeline/nba/nbaRecentFormCache')
const { enrichRowWithRoleContext, getRoleContext } = require('./backend/pipeline/nba/nbaRoleContextDeriver')

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []

function isBase(r){const mk=String(r?.marketKey||'').toLowerCase();const pv=String(r?.propVariant||'').toLowerCase();return !(mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default'))}
function familyOK(r){const propT=String(r?.propType||r?.marketKey||'').toLowerCase();return /points|rebounds|assists|threes|three|3pt|pra/.test(propT)}
function inOddsRange(r){const o=Number(r?.odds??r?.oddsAmerican);return Number.isFinite(o)&&o>=-200&&o<=200}

const baseRows = rowsRaw.filter(r => isBase(r) && familyOK(r) && inOddsRange(r) && r.player && (r.side||'').toLowerCase()!=='unknown')
console.log('NBA base-line eligible rows:', baseRows.length)

let stats = {
  rows: 0,
  role_active: 0,
  starter_flagged: 0,
  bench_flagged: 0,
  projectedMinutes_set: 0,
  role_promoted: 0,
  role_demoted: 0,
  role_stable: 0,
  role_unknown: 0,
  modelProb_changed: 0,
  unique_players_with_role: new Set(),
  shifts: [],
}
const examples = []
const minutesTrendDist = []

for (const r of baseRows) {
  // Build TWO copies of the same enriched row.
  // BEFORE = base enrichment + recent-form (Session AP) but NO role context.
  // AFTER  = same + role context injected.
  const eBase = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  enrichRowWithRecentForm(eBase)
  // Strip any pre-existing starterFlag / projectedMinutes that came from
  // projections.json defaults so we can isolate our deriver's effect.
  // (Projections defaults are constants — not real role context.)
  const eBefore = { ...eBase, starterFlag: undefined, projectedMinutes: undefined }
  const eAfter  = enrichRowWithRoleContext({ ...eBase, starterFlag: undefined, projectedMinutes: undefined })

  const mpBefore = sig.nbaRowIndependentModelProbability(eBefore)
  const mpAfter  = sig.nbaRowIndependentModelProbability(eAfter)
  if (!Number.isFinite(mpBefore) || !Number.isFinite(mpAfter)) continue

  stats.rows++
  const rc = eAfter.roleContext
  if (rc) {
    stats.role_active++
    stats.unique_players_with_role.add(String(eAfter.player).toLowerCase())
    if (eAfter.starterFlag === 1) stats.starter_flagged++
    else if (eAfter.starterFlag === 0) stats.bench_flagged++
    if (Number.isFinite(eAfter.projectedMinutes)) stats.projectedMinutes_set++
    if (rc.role_change === "promoted") stats.role_promoted++
    else if (rc.role_change === "demoted") stats.role_demoted++
    else if (rc.role_change === "stable") stats.role_stable++
    else stats.role_unknown++
    if (Number.isFinite(rc.minutes_trend)) minutesTrendDist.push(rc.minutes_trend)
  }
  const shift = mpAfter - mpBefore
  if (Math.abs(shift) > 1e-6) {
    stats.modelProb_changed++
    stats.shifts.push(shift)
  }
  if (rc && examples.length < 10) {
    examples.push({
      player: eAfter.player,
      stat:   String(eAfter.propType||eAfter.marketKey||'').toLowerCase().slice(0,12),
      side:   eAfter.side,
      line:   eAfter.line,
      odds:   eAfter.odds,
      n:      rc.sample_count,
      starter_rate_recent: rc.starter_rate_recent,
      role_change: rc.role_change,
      minutes_avg_recent: rc.minutes_avg_recent,
      minutes_trend: rc.minutes_trend,
      minutes_volatility: rc.minutes_volatility,
      injected_starterFlag: eAfter.starterFlag,
      injected_projectedMinutes: eAfter.projectedMinutes,
      mpBefore: Number(mpBefore.toFixed(4)),
      mpAfter:  Number(mpAfter.toFixed(4)),
      shift_pp: Number(((mpAfter - mpBefore)*100).toFixed(2)),
    })
  }
}

function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}
function pctile(arr,p){const a=arr.slice().sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(a.length*p))]:0}

console.log('\n=== ROLE-CONTEXT V1 ACTIVATION ===')
console.log('  rows compared:                       ', stats.rows)
console.log('  role context cache HIT:              ', stats.role_active, '(', pct(stats.role_active, stats.rows), ')')
console.log('  unique players with role context:    ', stats.unique_players_with_role.size)
console.log('  starterFlag injected (=1):           ', stats.starter_flagged)
console.log('  starterFlag injected (=0 bench):     ', stats.bench_flagged)
console.log('  projectedMinutes injected:           ', stats.projectedMinutes_set)
console.log('  role_change PROMOTED detections:     ', stats.role_promoted)
console.log('  role_change DEMOTED detections:      ', stats.role_demoted)
console.log('  role_change STABLE:                  ', stats.role_stable)
console.log('  role_change UNKNOWN (thin prior win):', stats.role_unknown)
console.log('  modelProb visibly shifted:           ', stats.modelProb_changed, '(', pct(stats.modelProb_changed, stats.rows), ')')
console.log('  shift mean(|shift|):                 ', stats.shifts.length ? (stats.shifts.reduce((s,x)=>s+Math.abs(x),0)/stats.shifts.length).toFixed(4) : '-')
console.log('  shift max (pp):                      ', stats.shifts.length ? (Math.max(...stats.shifts.map(Math.abs))*100).toFixed(2) : '-')
console.log('  shift p10/p50/p90 (pp):              ',
  (pctile(stats.shifts,0.10)*100).toFixed(2), '/',
  (pctile(stats.shifts,0.50)*100).toFixed(2), '/',
  (pctile(stats.shifts,0.90)*100).toFixed(2))
console.log('  minutes_trend distribution (mins):   ',
  'min='+(minutesTrendDist.length?Math.min(...minutesTrendDist).toFixed(1):'-'),
  'p50='+(pctile(minutesTrendDist,0.5)).toFixed(1),
  'max='+(minutesTrendDist.length?Math.max(...minutesTrendDist).toFixed(1):'-'))

console.log('\n=== EXAMPLE ROWS (role context injected) ===')
for (const ex of examples) {
  console.log(`  ${ex.player.padEnd(20)} ${ex.stat.padEnd(10)} ${ex.side.padEnd(5)} L${ex.line||'?'} @${ex.odds>=0?'+':''}${ex.odds}`)
  console.log(`     n=${ex.n} starter_rate_recent=${ex.starter_rate_recent} role_change=${ex.role_change}`)
  console.log(`     minutes_avg_recent=${ex.minutes_avg_recent} minutes_trend=${ex.minutes_trend} volatility=${ex.minutes_volatility}`)
  console.log(`     injected: starterFlag=${ex.injected_starterFlag}  projectedMinutes=${ex.injected_projectedMinutes}`)
  console.log(`     modelProb ${ex.mpBefore} → ${ex.mpAfter}   Δ ${ex.shift_pp >= 0 ? '+' : ''}${ex.shift_pp} pp`)
}

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
    enrichRowWithRoleContext(e2)
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
const tb = rj(path.join(__dirname, 'backend/runtime/tracking/nba_tracked_bets_'+date+'.json'), [])||[]
const eb = tb.filter(b=>Number(b?.edge)>0.04 && Number(b?.modelProb)>0.20)
const sigSet = new Set(eb.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const cands = diversifyCandidates([...eb, ...novel], { maxPerPlayer:3, maxPerGame:12 })
const res = buildAiSlips({candidates:cands, options:{sport:'nba', date, maxPerTier:4}, portfolioBaseline:{bets:cands}})
const t = res.slips || {}
console.log('  diversified candidates: %d   slips: safe=%d balanced=%d aggressive=%d lotto=%d',
  cands.length, (t.safe||[]).length, (t.balanced||[]).length, (t.aggressive||[]).length, (t.lotto||[]).length)
