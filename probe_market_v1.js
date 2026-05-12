"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Phase 1 — Market + News Adaptation V1 verification probe.
// Compares modelProb BEFORE (no market context) vs AFTER (multi-book consensus
// shift applied). Verifies tier-shape preservation and bounded magnitude.

function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}
function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}

const sig = require('./backend/pipeline/nba/nbaModelSignals')
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require('./backend/pipeline/nba/nbaEventTeamResolve')
const { enrichRowWithRecentForm } = require('./backend/pipeline/nba/nbaRecentFormCache')
const { enrichRowWithRoleContext } = require('./backend/pipeline/nba/nbaRoleContextDeriver')
const { buildSlateContextFromSnapshot, enrichRowWithTeammateContext } = require('./backend/pipeline/nba/nbaTeammateContextDeriver')
const { buildSlateMarketContext, enrichRowWithMarketContext } = require('./backend/pipeline/nba/nbaMarketContextDeriver')

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []

function isBase(r){const mk=String(r?.marketKey||'').toLowerCase();const pv=String(r?.propVariant||'').toLowerCase();return !(mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default'))}
function familyOK(r){const propT=String(r?.propType||r?.marketKey||'').toLowerCase();return /points|rebounds|assists|threes|three|3pt|pra/.test(propT)}
function inOddsRange(r){const o=Number(r?.odds??r?.oddsAmerican);return Number.isFinite(o)&&o>=-200&&o<=200}

const baseRows = rowsRaw.filter(r => isBase(r) && familyOK(r) && inOddsRange(r) && r.player && (r.side||'').toLowerCase()!=='unknown')
console.log('NBA base-line eligible rows:', baseRows.length)

const teammateCtx = buildSlateContextFromSnapshot(rowsRaw)
const marketCtx   = buildSlateMarketContext(rowsRaw)
console.log('multi-book props:', marketCtx.propConsensus.size)

let stats = {
  rows: 0,
  market_active: 0,
  signal_consensus: 0, signal_better: 0, signal_worse: 0,
  high_dispersion: 0,
  shifts: [],
}
const examples = { confirming: [], hostile: [], dispersion: [] }

for (const r of baseRows) {
  // Build identical enriched rows; only difference is presence of marketShift.
  const e = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
  enrichRowWithRecentForm(e); enrichRowWithRoleContext(e)
  enrichRowWithTeammateContext(e, teammateCtx)

  // BEFORE: no market context
  const eBefore = { ...e, marketShift: undefined, marketContext: undefined }
  // AFTER: market context applied
  const eAfter  = enrichRowWithMarketContext({ ...e }, marketCtx)

  const mpBefore = sig.nbaRowIndependentModelProbability(eBefore)
  const mpAfter  = sig.nbaRowIndependentModelProbability(eAfter)
  if (!Number.isFinite(mpBefore) || !Number.isFinite(mpAfter)) continue
  stats.rows++
  const mc = eAfter.marketContext
  if (mc) {
    stats.market_active++
    if (mc.market_signal === "consensus") stats.signal_consensus++
    if (mc.market_signal === "better_than_consensus") stats.signal_better++
    if (mc.market_signal === "worse_than_consensus") stats.signal_worse++
    if (mc.high_dispersion) stats.high_dispersion++
  }
  const shift = mpAfter - mpBefore
  if (Math.abs(shift) > 1e-6) stats.shifts.push(shift)

  if (mc && mc.market_signal === "better_than_consensus" && examples.confirming.length < 4) {
    examples.confirming.push({ player:r.player, prop:r.propType, side:r.side, line:r.line, book:r.book, odds:r.odds,
      consensus:mc.consensus_implied, row_implied:mc.row_implied, delta:mc.delta_vs_consensus,
      shift_pp:Number((shift*100).toFixed(2)), mpBefore:Number(mpBefore.toFixed(4)), mpAfter:Number(mpAfter.toFixed(4)),
      high_disp: mc.high_dispersion })
  }
  if (mc && mc.market_signal === "worse_than_consensus" && examples.hostile.length < 4) {
    examples.hostile.push({ player:r.player, prop:r.propType, side:r.side, line:r.line, book:r.book, odds:r.odds,
      consensus:mc.consensus_implied, row_implied:mc.row_implied, delta:mc.delta_vs_consensus,
      shift_pp:Number((shift*100).toFixed(2)), mpBefore:Number(mpBefore.toFixed(4)), mpAfter:Number(mpAfter.toFixed(4)),
      high_disp: mc.high_dispersion })
  }
  if (mc && mc.high_dispersion && examples.dispersion.length < 3) {
    examples.dispersion.push({ player:r.player, prop:r.propType, side:r.side, dispersion:mc.dispersion, books:mc.book_count, signal:mc.market_signal })
  }
}

console.log('\n=== MARKET-CONTEXT V1 ACTIVATION ===')
console.log('  rows compared:                       ', stats.rows)
console.log('  market context active (multi-book):  ', stats.market_active, pct(stats.market_active, stats.rows))
console.log('  └ signal=consensus (in line):        ', stats.signal_consensus)
console.log('  └ signal=better_than_consensus:      ', stats.signal_better, '  (this row gives bettor better odds than market avg)')
console.log('  └ signal=worse_than_consensus:       ', stats.signal_worse, '  (this row overprices vs market avg)')
console.log('  high-dispersion rows:                ', stats.high_dispersion)
console.log('  rows with non-zero shift:            ', stats.shifts.length, pct(stats.shifts.length, stats.rows))
if (stats.shifts.length) {
  const abs = stats.shifts.map(Math.abs)
  console.log('  shift mean(|shift|):                 ', (abs.reduce((s,x)=>s+x,0)/abs.length).toFixed(4))
  console.log('  shift max:                           ', Math.max(...abs).toFixed(4),
              ' (cap MAX_MARKET_SHIFT_PP=0.020 enforced:', Math.max(...abs)<=0.0201, ')')
}

console.log('\n=== CONFIRMING examples (consensus says bettor side MORE likely than this book priced) ===')
for (const ex of examples.confirming) {
  console.log(`  ${ex.player} ${ex.prop} ${ex.side} L${ex.line} @${ex.book}/${ex.odds>=0?"+":""}${ex.odds}`)
  console.log(`     consensus_implied=${ex.consensus}  row_implied=${ex.row_implied}  delta=${ex.delta}  high_disp=${ex.high_disp}`)
  console.log(`     modelProb ${ex.mpBefore} → ${ex.mpAfter}   Δ ${ex.shift_pp>=0?"+":""}${ex.shift_pp} pp`)
}
console.log('\n=== HOSTILE examples (consensus says bettor side LESS likely than this book priced) ===')
for (const ex of examples.hostile) {
  console.log(`  ${ex.player} ${ex.prop} ${ex.side} L${ex.line} @${ex.book}/${ex.odds>=0?"+":""}${ex.odds}`)
  console.log(`     consensus_implied=${ex.consensus}  row_implied=${ex.row_implied}  delta=${ex.delta}  high_disp=${ex.high_disp}`)
  console.log(`     modelProb ${ex.mpBefore} → ${ex.mpAfter}   Δ ${ex.shift_pp>=0?"+":""}${ex.shift_pp} pp`)
}
console.log('\n=== HIGH-DISPERSION examples (books materially disagree) ===')
for (const ex of examples.dispersion) console.log(' ', JSON.stringify(ex))

// End-to-end tier check
console.log('\n=== END-TO-END SLIP-PIPELINE (tier shape preserved?) ===')
const { diversifyCandidates } = require('./backend/pipeline/shared/buildCandidateDiversity')
const { buildAiSlips } = require('./backend/pipeline/shared/buildSlipAi')
function bsc(rows, slateTeammateCtx, slateMarketCtx) {
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
    enrichRowWithRecentForm(e2);enrichRowWithRoleContext(e2)
    enrichRowWithTeammateContext(e2, slateTeammateCtx)
    enrichRowWithMarketContext(e2, slateMarketCtx)
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
const tb = rj(path.join(__dirname,'backend/runtime/tracking/nba_tracked_bets_'+date+'.json'),[])||[]
const eb = tb.filter(b=>Number(b?.edge)>0.04 && Number(b?.modelProb)>0.20)
const sigSet = new Set(eb.map(rc=>String(rc.player||"").toLowerCase()+"|"+String(rc.statFamily||rc.propType||"").toLowerCase()+"|"+String(rc.side||"").toLowerCase()))
const novel = supp.filter(sc=>!sigSet.has(String(sc.player||"").toLowerCase()+"|"+sc.statFamily+"|"+sc.side))
const cands = diversifyCandidates([...eb,...novel],{maxPerPlayer:3,maxPerGame:12})
const res = buildAiSlips({candidates:cands, options:{sport:"nba", date, maxPerTier:4}, portfolioBaseline:{bets:cands}})
const t = res.slips || {}
console.log("diversified candidates:", cands.length, "  slips: safe="+(t.safe||[]).length+" balanced="+(t.balanced||[]).length+" aggressive="+(t.aggressive||[]).length+" lotto="+(t.lotto||[]).length)
