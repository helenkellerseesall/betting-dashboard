"use strict"
process.chdir(__dirname)
const path = require('path')
const fs   = require('fs')

// Phase 1 — Context Ingestion V1 verification probe.
// Reproduces the live workstation modelProb path BEFORE and AFTER the matchup
// wiring. Uses the exact same enriched row twice — once with matchup context
// disabled, once with it enabled — to isolate the contextual contribution.
//
// "Before" is simulated by stripping the row's `opponent` (matchup function
// returns adj that depends purely on totalPart in that case). "After" uses
// the actual row through the patched module.

const TRACKING_DIR = path.join(__dirname, 'backend/runtime/tracking')
function rj(p,fb=null){try{if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fb}}

const { diversifyCandidates } = require('./backend/pipeline/shared/buildCandidateDiversity')
const sig = require('./backend/pipeline/nba/nbaModelSignals')
const { applyTeamFallbackFromProjections, enrichNbaRowStatLayerInputs } = require('./backend/pipeline/nba/nbaEventTeamResolve')

const snap = rj(path.join(__dirname, 'backend/snapshot.json'))
const rowsRaw = snap?.data?.rows || snap?.data?.props || snap?.rows || []

function americanImplied(o){const n=Number(o);return n>0?100/(n+100):Math.abs(n)/(Math.abs(n)+100)}

// Pure NBA base-line subset (matches the buildNbaSnapshotCandidates intake)
function isBase(r){
  const mk = String(r?.marketKey||'').toLowerCase()
  const pv = String(r?.propVariant||'').toLowerCase()
  return !(mk.includes('alternate')||mk.includes('_alt')||(pv&&pv!=='base'&&pv!=='default'))
}
function inFamily(r){
  const propT=String(r?.propType||r?.marketKey||'').toLowerCase()
  return /points|rebounds|assists|threes|three|3pt|pra/.test(propT)
}
function inOddsRange(r){
  const o=Number(r?.odds??r?.oddsAmerican)
  return Number.isFinite(o)&&o>=-200&&o<=200
}

const baseRows = rowsRaw.filter(r => isBase(r) && inFamily(r) && inOddsRange(r) && r.player && (r.side||'').toLowerCase()!=='unknown')
console.log('NBA base-line eligible rows:', baseRows.length)

// === Per-row BEFORE / AFTER comparison ===
let stats = {
  rows: 0,
  same_modelProb: 0,
  modelProb_changed: 0,
  defense_active: 0,             // |defensePart| > 0 — proves DEFENSE_BY_ABBR fired
  totalpart_active: 0,
  pacepart_active: 0,
  shift_sum: 0,
  shift_abs_sum: 0,
  shift_max_pp: 0,
  edge_changed: 0,
}
const shifts = []
const examples = []

for (const r of baseRows) {
  // Enrich same way the runtime does
  const e = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))

  // BEFORE: clone with opponent stripped → defensePart forced to 0
  const eBefore = { ...e, opponent: null, opponentTeam: null }
  // AFTER: full enriched row (opponent preserved if resolvable)
  const eAfter = e

  const mpBefore = sig.nbaRowIndependentModelProbability(eBefore)
  const mpAfter  = sig.nbaRowIndependentModelProbability(eAfter)
  const ctx      = sig.nbaRowMatchupContext(eAfter)
  if (!Number.isFinite(mpBefore) || !Number.isFinite(mpAfter)) continue

  stats.rows++
  const shift = mpAfter - mpBefore
  shifts.push(shift)
  if (Math.abs(shift) < 1e-6) stats.same_modelProb++
  else {
    stats.modelProb_changed++
    stats.shift_sum += shift
    stats.shift_abs_sum += Math.abs(shift)
    if (Math.abs(shift) > stats.shift_max_pp) stats.shift_max_pp = Math.abs(shift)
  }

  if (ctx) {
    if (Math.abs(ctx.defensePart) > 1e-6) stats.defense_active++
    if (Math.abs(ctx.totalPart)   > 1e-6) stats.totalpart_active++
    if (Math.abs(ctx.pacePart)    > 1e-6) stats.pacepart_active++
  }

  // Edge change check
  const implied = americanImplied(e.odds)
  const edgeBefore = mpBefore - implied
  const edgeAfter  = mpAfter  - implied
  if (Math.abs(edgeAfter - edgeBefore) > 1e-6) stats.edge_changed++

  if (examples.length < 6 && ctx && Math.abs(ctx.defensePart) > 1e-6) {
    examples.push({
      player: e.player,
      stat: String(e.propType||e.marketKey||'').toLowerCase().slice(0,12),
      side: e.side,
      opp: ctx.opponent,
      odds: e.odds,
      mpBefore: Number(mpBefore.toFixed(4)),
      mpAfter:  Number(mpAfter.toFixed(4)),
      shift_pp: Number((shift*100).toFixed(2)),
      defense_pp: Number((ctx.defensePart*100).toFixed(2)),
      total_pp:   Number((ctx.totalPart*100).toFixed(2)),
      pace_pp:    Number((ctx.pacePart*100).toFixed(2)),
    })
  }
}

function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'-'}
function pctile(arr, p) { const a=arr.slice().sort((x,y)=>x-y); return a.length?a[Math.min(a.length-1,Math.floor(a.length*p))]:null }

console.log('\n=== Phase 1 V1 — REAL contextual matchup wiring ===')
console.log('  rows compared:                       ', stats.rows)
console.log('  modelProb CHANGED by matchup:        ', stats.modelProb_changed, '(', pct(stats.modelProb_changed, stats.rows), ')')
console.log('  modelProb identical (no opponent or signal):', stats.same_modelProb, '(', pct(stats.same_modelProb, stats.rows), ')')
console.log('  └ DEFENSE intelligence active:       ', stats.defense_active, '(', pct(stats.defense_active, stats.rows), ')   ← real opponent-aware adjustment')
console.log('  └ TOTAL component active:            ', stats.totalpart_active, '(', pct(stats.totalpart_active, stats.rows), ')')
console.log('  └ PACE component active:             ', stats.pacepart_active, '(', pct(stats.pacepart_active, stats.rows), ')   ← honestly 0 (pace data missing)')
console.log('  edges affected by matchup wiring:    ', stats.edge_changed, '(', pct(stats.edge_changed, stats.rows), ')')
console.log('  shift mean (signed):                 ', stats.modelProb_changed ? (stats.shift_sum / stats.modelProb_changed).toFixed(4) : '-')
console.log('  shift mean (|shift|):                ', stats.modelProb_changed ? (stats.shift_abs_sum / stats.modelProb_changed).toFixed(4) : '-')
console.log('  shift max (pp):                      ', (stats.shift_max_pp*100).toFixed(2))
console.log('  shift p10/p50/p90 (pp):              ',
  ((pctile(shifts,0.10)||0)*100).toFixed(2), '/',
  ((pctile(shifts,0.50)||0)*100).toFixed(2), '/',
  ((pctile(shifts,0.90)||0)*100).toFixed(2))

console.log('\n=== EXAMPLE ROWS (defense intelligence active) ===')
for (const ex of examples) {
  console.log(' ', JSON.stringify(ex))
}
