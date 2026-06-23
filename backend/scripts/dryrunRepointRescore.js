#!/usr/bin/env node
// READ-ONLY dry-run: the selection RE-POINT's effect on the row-ranking signal, on REAL rows.
// It recomputes signalScore's proxy bands (buildMlbBootstrapSnapshot.computeMlbOverCountingProxyScore
// lineSignal :210-227 + payoutSignal :203-208) under CURRENT vs the RE-POINTED bands from
// docs/POST_FREEZE_SELECTION_REPOINT_SPEC.md §1B, over the (family,line,odds) of real tracked over-bets.
// It NEVER imports/calls/edits the live scorer — pure local recompute. Proves the re-point makes the
// OBTAINABLE floors (rbis/hits over0.5) out-rank the longshot CEILINGS, without touching the live path.
//   node backend/scripts/dryrunRepointRescore.js
const fs = require("fs"), path = require("path")
const TRK = path.join(__dirname, "..", "runtime", "tracking")
const FAMS = ["hits", "rbis", "runs"]

// CURRENT lineSignal — ceiling-first (cite buildMlbBootstrapSnapshot.js:210-227)
function lineCurrent(fam, L) {
  if (!Number.isFinite(L)) return 0.55
  if (fam === "hits") return L >= 2.5 ? 0.92 : L >= 1.5 ? 0.78 : L >= 0.5 ? 0.62 : 0.45
  if (fam === "rbis" || fam === "runs") return L >= 1.5 ? 0.90 : L >= 0.5 ? 0.72 : 0.48
  return 0.55
}
// RE-POINTED lineSignal — floor-first (cite SPEC §1B)
function lineRepoint(fam, L) {
  if (!Number.isFinite(L)) return 0.55
  if (fam === "hits") return L <= 0.5 ? 0.90 : L >= 2.5 ? 0.45 : 0.65            // over0.5(>=1) top, ceilings demoted
  if (fam === "rbis" || fam === "runs") return L <= 0.5 ? 0.90 : 0.50            // over0.5(>=1) top, >=1.5 demoted
  return 0.55
}
// CURRENT payoutSignal — peak +140..260 (cite :203-208)
function payCurrent(o) { return o >= 140 && o <= 260 ? 0.95 : o >= 105 && o < 140 ? 0.78 : o > 260 && o <= 420 ? 0.72 : o > 420 && o <= 700 ? 0.55 : 0.35 }
// RE-POINTED payoutSignal — peak mod-dog +100..199, taper above +260 (cite SPEC §1B)
function payRepoint(o) { return o >= 100 && o <= 199 ? 1.0 : o >= 200 && o <= 260 ? 0.80 : o > 260 && o <= 420 ? 0.55 : o > 420 ? 0.40 : o >= -200 && o < 100 ? 0.70 : 0.50 }

const bucket = (L) => (L <= 0.5 ? "floor(>=1, o0.5)" : L >= 2.5 ? "ceiling(o>=2.5)" : "mid(o>=1.5)")

// real over-bet (family,line,odds) tuples from recent slates
const files = fs.readdirSync(TRK).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-8)
const rows = []
for (const f of files) {
  let a; try { a = JSON.parse(fs.readFileSync(path.join(TRK, f), "utf8")) } catch (_) { continue }
  if (!Array.isArray(a)) continue
  for (const r of a) {
    if (!r || r.side !== "over") continue
    const fam = String(r.statFamily || "")
    if (!FAMS.includes(fam)) continue
    const L = Number(r.line), odds = Number(r.oddsAmerican ?? r.odds)
    if (!Number.isFinite(L)) continue
    rows.push({ fam, L, odds: Number.isFinite(odds) ? odds : null, b: bucket(L), cur: lineCurrent(fam, L), rep: lineRepoint(fam, L) })
  }
}

console.log("=== DRY-RUN: selection re-point signalScore shift (REAL over-bets, " + files.length + " recent slates) ===")
console.log("READ-ONLY — recomputes the proxy bands locally; live scorer/path NOT touched; kill-switch stays OFF.\n")
console.log("lineSignal mean by family × line-bucket  (CURRENT -> RE-POINTED):")
const agg = {}
for (const r of rows) { const k = r.fam + " | " + r.b; (agg[k] = agg[k] || { n: 0, cur: 0, rep: 0 }); agg[k].n++; agg[k].cur += r.cur; agg[k].rep += r.rep }
for (const k of Object.keys(agg).sort()) { const a = agg[k]; console.log(`  ${k.padEnd(28)} n=${String(a.n).padStart(5)}   ${(a.cur / a.n).toFixed(3)} -> ${(a.rep / a.n).toFixed(3)}`) }

// the headline: do obtainable FLOORS now out-rank the longshot CEILINGS?
const mean = (pred) => { const s = rows.filter(pred); return s.length ? s.reduce((x, r) => x + r.cur, 0) / s.length : null }
const meanR = (pred) => { const s = rows.filter(pred); return s.length ? s.reduce((x, r) => x + r.rep, 0) / s.length : null }
const isFloor = (r) => r.b.startsWith("floor"), isCeil = (r) => r.b.startsWith("ceiling")
const fC = mean(isFloor), cC = mean(isCeil), fR = meanR(isFloor), cR = meanR(isCeil)
console.log("\nFLOOR vs CEILING mean lineSignal:")
console.log(`  CURRENT : floor ${fC?.toFixed(3)}  ceiling ${cC?.toFixed(3)}  -> ${fC < cC ? "CEILING out-ranks floor (the bug: engine bets longshot ceilings)" : "floor>=ceiling"}`)
console.log(`  REPOINT : floor ${fR?.toFixed(3)}  ceiling ${cR?.toFixed(3)}  -> ${fR > cR ? "FLOOR out-ranks ceiling (re-point goal achieved)" : "ceiling still >= floor"}`)
const flipped = (fC < cC) && (fR > cR)
console.log(`\nVERDICT: ${flipped ? "FLIP CONFIRMED" : "no flip"} — re-point inverts the floor-vs-ceiling ranking on real rows.`)

// payout band shift demo (mod-dog +100..199 vs current +140..260 peak)
console.log("\npayoutSignal at sample odds (CURRENT -> RE-POINTED):")
for (const o of [-150, 110, 150, 220, 300, 500]) console.log(`  ${String(o > 0 ? "+" + o : o).padEnd(6)}  ${payCurrent(o).toFixed(2)} -> ${payRepoint(o).toFixed(2)}${o >= 100 && o <= 199 ? "   <- mod-dog peak (OOS CLV+ band)" : ""}`)
console.log("\nGUARDRAILS (SPEC §6): HR NOT inverted (legit ceiling); integrity excludes single-actor micro-markets; ranks on G1-CALIBRATED modelProb when live. This harness shows the SIGNAL shift only — apply behind MLB_REPOINT_* switches AFTER G1, per the runbook.")
