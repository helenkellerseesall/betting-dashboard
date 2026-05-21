"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Pure offline diagnostic probe. Reproduces the live runtime composition pipeline
// (snapshot rows → buildNbaSnapshotCandidates → buildSlipAi tiers).
// Reports synthetic-vs-real signal participation and matchup activation rate.
//
// Usage:
//   node probe_signal_audit.js           ← uses snapshot as-is (BEFORE)
//   INJECT_OPPONENT=1 node probe_signal_audit.js   ← simulates Step-1 patch (AFTER)

const INJECT_OPPONENT = String(process.env.INJECT_OPPONENT || '0') === '1'

const TRACKING_DIR = path.join(__dirname, 'backend/runtime/tracking')
function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}
function ff(s,k,d){return path.join(TRACKING_DIR,s+'_'+k+'_'+d+'.json')}

// Resolve modules with require-cache busted (so re-runs after edits pick up changes)
function freshRequire(p) {
  const r = require.resolve(p)
  delete require.cache[r]
  return require(p)
}

const { diversifyCandidates }       = freshRequire('./backend/pipeline/shared/buildCandidateDiversity')
const { nbaRowModelProbability,
        nbaRowEdge,
        nbaRowIndependentModelProbability } = freshRequire('./backend/pipeline/nba/nbaModelSignals')
const { enrichNbaRowStatLayerInputs,
        applyTeamFallbackFromProjections }  = freshRequire('./backend/pipeline/nba/nbaEventTeamResolve')
const { computeMatchupAdjustmentFromRow }   = freshRequire('./backend/pipeline/nba/nbaMatchupIntelligence')
const { buildAiSlips }              = freshRequire('./backend/pipeline/shared/buildSlipAi')

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []

// === Optionally inject opponent (simulates Step-1 patch on the existing snapshot) ===
let injected = 0
const rows = rowsRaw.map(r => {
  if (!INJECT_OPPONENT) return r
  if (r.opponent || r.opponentTeam) return r
  const team = String(r.team || '').toLowerCase()
  const home = String(r.homeTeam || '').toLowerCase()
  const away = String(r.awayTeam || '').toLowerCase()
  if (!team || !home || !away) return r
  const opponent = team === home ? r.awayTeam : team === away ? r.homeTeam : null
  if (!opponent) return r
  injected++
  return { ...r, opponent }
})

console.log('=== PROBE MODE:', INJECT_OPPONENT ? 'AFTER (opponent injected)' : 'BEFORE (raw snapshot)', '===')
console.log('snapshot rows total:', rows.length)
console.log('opponent injected this run:', injected)

// === Direct probe of nbaModelSignals + matchup intelligence ===
let stats = {
  rows_processed: 0,
  defense_fired: 0,                 // ONLY counts defensePart != 0 (real opponent intelligence)
  pace_fired: 0,                    // pacePart != 0 (real pace data)
  total_fired: 0,                   // totalPart != 0 (real gameTotal data)
  matchup_any_fired: 0,             // any of the three
  matchup_zero: 0,
  modelProb_present: 0,
  modelProb_high_edge: 0,           // edge >= 0.04
  modelProb_extreme_edge: 0,        // edge >= 0.12
  edge_sum: 0,
  edge_abs_sum: 0,
}

const defenseAdjs = []
const matchupAdjs = []
const edges = []
const independentMps = []

const NBA_FAMILIES = new Set(['points','rebounds','assists','threes','pra'])

// Filter to base lines roughly the way buildNbaSnapshotCandidates does, just for the probe
for (const r of rows) {
  const player = String(r?.player||'').trim(); if(!player) continue
  const side = String(r?.side||'').toLowerCase(); if(!side||side==='unknown') continue
  const mk = String(r?.marketKey||'').toLowerCase()
  const pv = String(r?.propVariant||'').toLowerCase()
  const ia = mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default')
  if (ia) continue                  // base lines only for clean probe
  const odds = Number(r?.odds??r?.oddsAmerican)
  if (!Number.isFinite(odds) || odds < -200 || odds > 200) continue
  const propT = String(r?.propType||mk).toLowerCase()
  const family = propT.includes('points_rebounds_assists')||/\bpra\b/.test(propT)?'pra':propT.includes('points')?'points':propT.includes('rebounds')?'rebounds':propT.includes('assists')?'assists':(propT.includes('threes')||propT.includes('three')||propT.includes('3pt'))?'threes':null
  if (!family || !NBA_FAMILIES.has(family)) continue

  const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  // PRESERVE injected opponent through enrichment (in case enrich strips it, re-stamp)
  if (r.opponent && !enriched.opponent) enriched.opponent = r.opponent

  stats.rows_processed++

  const mAdj = computeMatchupAdjustmentFromRow(enriched)
  matchupAdjs.push(mAdj.adj)
  defenseAdjs.push(mAdj.defensePart)
  if (Math.abs(mAdj.defensePart) > 0.0001) stats.defense_fired++
  if (Math.abs(mAdj.pacePart) > 0.0001) stats.pace_fired++
  if (Math.abs(mAdj.totalPart) > 0.0001) stats.total_fired++
  if (Math.abs(mAdj.adj) > 0.0001) stats.matchup_any_fired++
  else stats.matchup_zero++

  // Real-signal participation per row (audit honesty)
  stats.signal_spread     = (stats.signal_spread     || 0) + (Number.isFinite(enriched.spread)    ? 1 : 0)
  stats.signal_gameTotal  = (stats.signal_gameTotal  || 0) + (Number.isFinite(enriched.gameTotal) ? 1 : 0)
  stats.signal_opponent   = (stats.signal_opponent   || 0) + (enriched.opponent ? 1 : 0)
  stats.signal_pace       = (stats.signal_pace       || 0) + (Number.isFinite(enriched.pace)             ? 1 : 0)
  stats.signal_usage      = (stats.signal_usage      || 0) + (Number.isFinite(enriched.usageRate)        ? 1 : 0)
  stats.signal_minutes    = (stats.signal_minutes    || 0) + (Number.isFinite(enriched.projectedMinutes) ? 1 : 0)
  stats.signal_recentForm = (stats.signal_recentForm || 0) + (Number.isFinite(enriched.last5Avg) || Number.isFinite(enriched.recentForm) ? 1 : 0)

  const mp = nbaRowModelProbability(enriched)
  if (Number.isFinite(mp)) {
    stats.modelProb_present++
    independentMps.push(mp)
    const e = nbaRowEdge(enriched)
    if (Number.isFinite(e)) {
      edges.push(e)
      stats.edge_sum += e
      stats.edge_abs_sum += Math.abs(e)
      if (e >= 0.04) stats.modelProb_high_edge++
      if (e >= 0.12) stats.modelProb_extreme_edge++
    }
  }
}

console.log('\n=== REAL-SIGNAL PARTICIPATION (after enrichment) ===')
console.log('  spread       populated: ', stats.signal_spread,    '(', pct(stats.signal_spread,    stats.rows_processed), ') ← real')
console.log('  gameTotal    populated: ', stats.signal_gameTotal, '(', pct(stats.signal_gameTotal, stats.rows_processed), ') ← real')
console.log('  opponent     populated: ', stats.signal_opponent,  '(', pct(stats.signal_opponent,  stats.rows_processed), ') ← Step 1')
console.log('  pace         populated: ', stats.signal_pace,      '(', pct(stats.signal_pace,      stats.rows_processed), ')')
console.log('  usageRate    populated: ', stats.signal_usage,     '(', pct(stats.signal_usage,     stats.rows_processed), ') ← from projections')
console.log('  projMinutes  populated: ', stats.signal_minutes,   '(', pct(stats.signal_minutes,   stats.rows_processed), ') ← from projections')
console.log('  recentForm   populated: ', stats.signal_recentForm,'(', pct(stats.signal_recentForm,stats.rows_processed), ') ← STILL MISSING — honest 0 contribution')

function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}
function pctile(arr, p) {
  const a = arr.slice().sort((x,y)=>x-y); if (!a.length) return null
  return a[Math.min(a.length-1, Math.floor(a.length*p))]
}

console.log('\n=== ROW-LEVEL signal-honesty probe ===')
console.log('  base-line NBA prop rows processed: ', stats.rows_processed)
console.log('  matchup ANY component fired:       ', stats.matchup_any_fired, '(', pct(stats.matchup_any_fired, stats.rows_processed), ')')
console.log('  └ DEFENSE intelligence fired:      ', stats.defense_fired, '(', pct(stats.defense_fired, stats.rows_processed), ')   ← needs row.opponent populated')
console.log('  └ PACE component fired:            ', stats.pace_fired, '(', pct(stats.pace_fired, stats.rows_processed), ')   ← needs row.pace populated')
console.log('  └ TOTAL component fired:           ', stats.total_fired, '(', pct(stats.total_fired, stats.rows_processed), ')   ← needs row.gameTotal populated')
console.log('  matchup |adj|  median / 90th-pct:  ',
  (pctile(matchupAdjs.map(Math.abs), 0.5)||0).toFixed(4), '/',
  (pctile(matchupAdjs.map(Math.abs), 0.9)||0).toFixed(4))
console.log('  defense |part| median / 90th-pct:  ',
  (pctile(defenseAdjs.map(Math.abs), 0.5)||0).toFixed(4), '/',
  (pctile(defenseAdjs.map(Math.abs), 0.9)||0).toFixed(4))
console.log('  modelProb present:                 ', stats.modelProb_present, '(', pct(stats.modelProb_present, stats.rows_processed), ')')
console.log('  edge >= 0.04 (PLAYABLE):           ', stats.modelProb_high_edge, '(', pct(stats.modelProb_high_edge, stats.modelProb_present), ')')
console.log('  edge >= 0.12 (ELITE):              ', stats.modelProb_extreme_edge, '(', pct(stats.modelProb_extreme_edge, stats.modelProb_present), ')')
console.log('  mean signed edge:                  ', stats.modelProb_present ? (stats.edge_sum / stats.modelProb_present).toFixed(4) : '-')
console.log('  mean |edge|:                       ', stats.modelProb_present ? (stats.edge_abs_sum / stats.modelProb_present).toFixed(4) : '-')
console.log('  edge p25/p50/p75/p95:              ',
  (pctile(edges, 0.25)||0).toFixed(4), '/',
  (pctile(edges, 0.5)||0).toFixed(4), '/',
  (pctile(edges, 0.75)||0).toFixed(4), '/',
  (pctile(edges, 0.95)||0).toFixed(4))

// === End-to-end candidate + slip flow (mirror live route) ===
function bsc(rowsAll, opponentInjector) {
  if(!Array.isArray(rowsAll)||!rowsAll.length)return[]
  const rq=[]
  for(const rOrig of rowsAll){
    const r = opponentInjector ? opponentInjector(rOrig) : rOrig
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
    if (r.opponent && !e2.opponent) e2.opponent = r.opponent
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

const opponentInjector = INJECT_OPPONENT ? r => {
  if (r.opponent) return r
  const team = String(r.team || '').toLowerCase()
  const home = String(r.homeTeam || '').toLowerCase()
  const away = String(r.awayTeam || '').toLowerCase()
  if (!team || !home || !away) return r
  const opponent = team === home ? r.awayTeam : team === away ? r.homeTeam : null
  return opponent ? { ...r, opponent } : r
} : null

const supp = bsc(rowsRaw, opponentInjector)
const date = '2026-05-09'
const trackedBets = rj(ff('nba','tracked_bets',date),[])||[]
const eligibleBets = trackedBets.filter(b=>Number(b?.edge)>0.04&&Number(b?.modelProb)>0.20)
const sigSet = new Set(eligibleBets.map(rc=>String(rc.player||'').toLowerCase()+'|'+String(rc.statFamily||rc.propType||'').toLowerCase()+'|'+String(rc.side||'').toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||'').toLowerCase()+'|'+sc.statFamily+'|'+sc.side))
const aiCandidates = diversifyCandidates([...eligibleBets, ...novel], { maxPerPlayer:3, maxPerGame:12 })
console.log('\n=== END-TO-END FLOW (mirror /api/ws/state) ===')
console.log('  snapSupplement (qualified base+alt):', supp.length)
console.log('  novel after dedup:                   ', novel.length)
console.log('  diversified aiCandidates:            ', aiCandidates.length)

const res = buildAiSlips({candidates:aiCandidates, options:{sport:'nba', date, maxPerTier:4}, portfolioBaseline:{bets:aiCandidates}})
const tiers = res.slips || {}
console.log('  slips: safe=%d  balanced=%d  aggressive=%d  lotto=%d  total=%d',
  (tiers.safe||[]).length, (tiers.balanced||[]).length, (tiers.aggressive||[]).length, (tiers.lotto||[]).length,
  Object.values(tiers).reduce((s,a)=>s+a.length,0))

// Edge-quality of the candidates that actually made it through
if (aiCandidates.length) {
  const edgs = aiCandidates.map(c => c.edge).filter(Number.isFinite).sort((a,b)=>b-a)
  console.log('  candidate edge top-5:                ', edgs.slice(0,5).map(x=>x.toFixed(3)).join(', '))
  console.log('  candidate edge mean:                 ', (edgs.reduce((s,x)=>s+x,0)/edgs.length).toFixed(4))
  console.log('  candidates with edge >= 0.10:        ', edgs.filter(x=>x>=0.10).length)
}

console.log('\n=== END PROBE (', INJECT_OPPONENT ? 'AFTER' : 'BEFORE', ') ===\n')
