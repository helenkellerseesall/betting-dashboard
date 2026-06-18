#!/usr/bin/env node
"use strict"
/**
 * forwardClvSliceTracker.js — FORWARD-CLV-per-slice tracker (analytics ONLY).
 *
 * Operationalizes "confirm the edge before stakes": it watches whether the OOS-confirmed CLV+
 * slices HOLD and FIRM UP as forward graded days accrue. Re-runnable; writes a sidecar that the
 * /status card reads. Touches NO scoring/selection — reads the graded ledger + the live snapshot,
 * computes per-slice CLV/n/hit-rate, writes JSON. Nightly-safe to schedule after grading.
 *
 *   node backend/scripts/forwardClvSliceTracker.js
 *   FORWARD_CLV_CUTOFF=2026-06-17 node backend/scripts/forwardClvSliceTracker.js   # override boundary
 *
 * Writes backend/runtime/tracking/forward_clv_slices.json (analytics sidecar).
 *
 * SLICES (the pre-registered CONFIRMED slices ONLY — no fishing):
 *   rbis_low   — rbis, over, line ≤ 0.5  (obtainable "≥1 RBI")
 *   hits_low   — hits, over, line ≤ 0.5  (obtainable "≥1 hit")
 *   mod_dog    — placed odds +100..+199  (moderate underdog)
 *   low_conf   — model confidence < 0.20
 *   line_shop  — best-book vs FanDuel-weighted Power-de-vig consensus (CURRENT slate, live snapshot)
 *
 * SPLIT: in-sample (slate date < cutoff = the days already used for H1–H6) vs FORWARD/OOS (slate
 * date ≥ cutoff = graded under the #2 closing-line matcher fix). ONLY forward confirms the edge.
 *
 * HONEST: CLV is the LEADING indicator, NOT promised profit. H1's ROI was variance-dominated — do
 * NOT bank ROI magnitude. Forward coverage depends on the #2 fix being DEPLOYED (kickstart) and on
 * grading (lags ~1 day) — until both, forward stays thin and the card says so.
 */
const fs = require("fs"), path = require("path")
const d = require("../pipeline/shared/devigAnalytics")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const SNAP_PATH = path.join(__dirname, "..", "snapshot-mlb.json")
const OUT_PATH = path.join(TRACKING_DIR, "forward_clv_slices.json")
// Forward boundary = the #2 closing-line matcher fix (commit b840a22, 2026-06-17). Closing lines
// captured on/after this slate date used the FIXED family-key matcher. Override via env.
const CUTOFF = process.env.FORWARD_CLV_CUTOFF || "2026-06-17"
const MIN_N = 30   // below this a forward slice is "too-thin" (no verdict yet)

const out = []; const log = (s) => out.push(s)
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000)
const pp = (x) => (x == null ? null : Math.round(x * 1000) / 10)   // → percentage points, 1 dp
const impl = (o) => d._impliedFromAmerican(o)

// ── load ledger rows, tagging each with its slate date (from the filename) ──
function loadLedger() {
  const files = fs.readdirSync(TRACKING_DIR).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const rows = []
  for (const f of files) {
    const slate = f.replace("mlb_tracked_bets_", "").replace(".json", "")
    let j; try { j = JSON.parse(fs.readFileSync(path.join(TRACKING_DIR, f), "utf8")) } catch (_) { continue }
    const arr = Array.isArray(j) ? j : (j.bets || j.rows || j.tracked || [])
    for (const r of arr) rows.push({ ...r, _slate: slate })
  }
  return rows
}

// ── slice predicates (CONFIRMED slices only) ──
const SLICES = {
  rbis_low: (r) => r.statFamily === "rbis" && String(r.side).toLowerCase() === "over" && Number(r.line) <= 0.5,
  hits_low: (r) => r.statFamily === "hits" && String(r.side).toLowerCase() === "over" && Number(r.line) <= 0.5,
  mod_dog: (r) => { const o = Number(r.oddsAmerican); return o >= 100 && o <= 199 },
  low_conf: (r) => Number(r.confidence) < 0.20,
}

// ── per-slice CLV stats over a row set (graded + clv-stamped only) ──
function sliceStats(rows) {
  const clvRows = rows.filter((r) => r.clvQuality != null && Number.isFinite(Number(r.clv)))
  const n = clvRows.length
  const meanClv = n ? clvRows.reduce((s, r) => s + Number(r.clv), 0) / n : null
  const posShare = n ? clvRows.filter((r) => r.clvQuality === "positive").length / n : null
  // hit-rate over graded rows (win/(win+loss)); pending/unresolved excluded
  let win = 0, loss = 0
  for (const r of clvRows) {
    const res = String(r.result || "").toLowerCase()
    if (res === "win") win++; else if (res === "loss") loss++
  }
  const decided = win + loss
  const hitRate = decided ? win / decided : null
  return { n, meanClv: r4(meanClv), posSharePct: pp(posShare), hitRatePct: pp(hitRate), decided }
}

function verdict(forward) {
  if (forward.n < MIN_N) return "too-thin"
  if (forward.meanClv > 0) return "hold"
  if (forward.meanClv < 0) return "flip"
  return "flat"
}

// ── line-shop slice on the LIVE snapshot ──
// (A) PRICE IMPROVEMENT = the confirmed line-shop edge: FD-weighted consensus implied − BEST
//     available implied, BOTH on the SAME raw (vigged) footing → ≥0 "savings" from shopping.
//     (Comparing best vigged price to a de-vigged fair would just measure the vig — apples/oranges.)
// (B) FAIR EDGE (informational, two-sided subset): FD-weighted POWER-de-vigged fair − best implied.
//     Exercises devigAnalytics.powerDevigTwoWay on real data; usually ~−vig for overs (not +EV) —
//     shopping reduces the vig you pay, it doesn't make overs beat the true line.
function lineShopEdge() {
  let snap; try { snap = JSON.parse(fs.readFileSync(SNAP_PATH, "utf8")) } catch (_) { return { available: false, reason: "no snapshot-mlb.json" } }
  const s = snap.data || snap
  const rows = Array.isArray(s.rows) ? s.rows : []
  const slateDate = s.snapshotSlateDateKey || s.slateDate || null
  const groups = new Map()
  for (const r of rows) {
    const fam = r.propFamilyKey || r.marketFamily || r.propType
    if (!fam || r.player == null || r.line == null) continue
    const side = String(r.side || "").toLowerCase(); if (side !== "over" && side !== "under") continue
    const key = [r.eventId, r.player, fam, r.line].join("|")
    if (!groups.has(key)) groups.set(key, { over: new Map(), under: new Map() })
    const bk = String(r.book || "").toLowerCase().replace(/\s+/g, "")
    if (Number.isFinite(Number(r.odds))) groups.get(key)[side].set(bk, Number(r.odds))
  }
  const improve = []; let nA = 0, fdA = 0       // (A) price improvement
  const fairEdge = []; let nB = 0, fdB = 0      // (B) de-vigged fair edge
  for (const [, g] of groups) {
    // (A) over prices across books (no de-vig — raw implied, the price you pay)
    const raws = []; let bestImplied = null
    for (const [bk, oOdds] of g.over) {
      const oi = impl(oOdds); if (oi == null) continue
      raws.push({ book: bk, fairProb: oi })
      if (bestImplied == null || oi < bestImplied) bestImplied = oi
    }
    if (raws.length >= 2 && bestImplied != null) {
      const cons = d.fanduelWeightedConsensus(raws)   // FD-weighted consensus of RAW implied
      if (cons) { nA++; if (cons.fanduelPresent) fdA++; improve.push(cons.consensus - bestImplied) }
    }
    // (B) two-sided subset → Power de-vig per book → FD-weighted fair vs best implied
    const perBook = []; let bestImpliedB = null
    for (const [bk, oOdds] of g.over) {
      const uOdds = g.under.get(bk); if (uOdds == null) continue
      const p = d.powerDevigTwoWay(oOdds, uOdds); if (!p) continue
      perBook.push({ book: bk, fairProb: p.aFair })
      const oi = impl(oOdds); if (bestImpliedB == null || oi < bestImpliedB) bestImpliedB = oi
    }
    if (perBook.length >= 2 && bestImpliedB != null) {
      const consF = d.fanduelWeightedConsensus(perBook)
      if (consF) { nB++; if (consF.fanduelPresent) fdB++; fairEdge.push(consF.consensus - bestImpliedB) }
    }
  }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  return {
    available: true, slateDate,
    priceImprovement: { nProps: nA, fanduelProps: fdA, meanEdgePp: pp(mean(improve)) },
    fairEdge: { nProps: nB, fanduelProps: fdB, meanEdgePp: pp(mean(fairEdge)) },
  }
}

function main() {
  const all = loadLedger()
  const inSampleAll = all.filter((r) => r._slate < CUTOFF)
  const forwardAll = all.filter((r) => r._slate >= CUTOFF)
  log("=== FORWARD-CLV-per-slice tracker ===")
  log("generated " + new Date().toISOString())
  log(`forward cutoff (slate date ≥): ${CUTOFF}  (the #2 closing-line matcher fix, commit b840a22)`)
  log(`ledger rows: ${all.length}  |  in-sample (< cutoff): ${inSampleAll.length}  |  forward (≥ cutoff): ${forwardAll.length}`)
  log("CLV is the LEADING indicator — NOT promised profit. Forward = the only real confirmation.\n")

  const slices = {}
  log("SLICE                in-sample [n · meanCLV · hit%]      FORWARD [n · meanCLV · hit%]      verdict")
  for (const [name, pred] of Object.entries(SLICES)) {
    const is = sliceStats(inSampleAll.filter(pred))
    const fw = sliceStats(forwardAll.filter(pred))
    const v = verdict(fw)
    slices[name] = { inSample: is, forward: fw, verdict: v, minN: MIN_N }
    const fmt = (x) => `n=${String(x.n).padStart(4)} clv=${x.meanClv == null ? "  —  " : (x.meanClv >= 0 ? "+" : "") + x.meanClv} hit=${x.hitRatePct == null ? "—" : x.hitRatePct + "%"}`
    log(`${name.padEnd(12)}  ${fmt(is).padEnd(38)} ${fmt(fw).padEnd(34)} ${v}`)
  }

  const ls = lineShopEdge()
  log("")
  if (ls.available) {
    const pi = ls.priceImprovement, fe = ls.fairEdge
    log(`line_shop (LIVE slate ${ls.slateDate}):`)
    log(`  price improvement (best vs FD-weighted consensus, raw): ${pi.meanEdgePp == null ? "—" : "+" + pi.meanEdgePp + "pp"}  (n=${pi.nProps} props, ${pi.fanduelProps} w/ FanDuel) ← the shopping edge`)
    log(`  de-vigged fair edge (Power, two-sided subset): ${fe.meanEdgePp == null ? "—" : (fe.meanEdgePp >= 0 ? "+" : "") + fe.meanEdgePp + "pp"}  (n=${fe.nProps}) — usually ~−vig for overs (shopping cuts the vig, doesn't make overs +EV)`)
  } else log(`line_shop: unavailable (${ls.reason})`)
  log("  (line_shop is a CURRENT-slate price edge from the live snapshot — the only place two-way cross-book data exists; not a forward-graded CLV slice.)")

  // forward-readiness note — distinguish CLV-stamped (leading) from GRADED (hit-rate)
  const forwardStamped = forwardAll.filter((r) => r.clvQuality != null).length
  const forwardDecided = forwardAll.filter((r) => { const x = String(r.result || "").toLowerCase(); return x === "win" || x === "loss" }).length
  log("")
  log(`FORWARD READINESS: ${forwardStamped} clv-stamped forward rows (CLV available now) · ${forwardDecided} graded (hit-rate available).`)
  if (forwardDecided < 50) log(`  → hit% shows "—" until the morning grade settles forward picks (grading lags ~1 day). CLV verdicts are live now; hit% fills in next.`)
  if (forwardStamped < 50) log(`  → forward CLV coverage is also THIN — depends on the #2 fix being DEPLOYED (kickstart). Watch it climb daily.`)
  log("\nVERDICT KEY: hold = forward meanCLV>0 (edge persists) · flip = forward meanCLV<0 (edge gone) · too-thin = n<" + MIN_N + " (wait).")

  const sidecar = {
    generatedAt: new Date().toISOString(),
    cutoff: CUTOFF,
    minN: MIN_N,
    ledgerRows: all.length,
    inSampleRows: inSampleAll.length,
    forwardRows: forwardAll.length,
    forwardStampedRows: forwardStamped,
    forwardGradedRows: forwardDecided,
    slices,
    lineShop: ls,
    honest: "CLV is the leading indicator, not promised profit; H1 ROI was variance-dominated. Forward = the only confirmation; thin until the #2 fix is deployed + days are graded.",
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(sidecar, null, 2))
  log(`\nWROTE sidecar: ${OUT_PATH}`)
  process.stdout.write(out.join("\n") + "\n")
}

// Reusable CLV-slice helpers (Law 1 — the canonical slice→CLV/n/hit-rate owner). Imported by the
// signal-vs-CLV backtest harness so it does NOT spawn a parallel CLV analyzer.
module.exports = { sliceStats, loadLedger, MIN_N }
if (require.main === module) main()
