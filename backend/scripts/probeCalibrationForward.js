"use strict"
/**
 * probeCalibrationForward.js — Phase T2-MarginalCalib-1B forward-validation harness.
 *
 * The G1 graduation gate: does the calibration map (fit on PAST graded days) improve
 * reliability on FUTURE graded days it never saw? In-sample gap-closure is not proof;
 * this measures OUT-OF-SAMPLE (OOS) calibrated-prob vs realized hit, per family×side,
 * with Brier scores, raw vs calibrated. READ-ONLY on the ledger; no scoring wire.
 *
 *   node backend/scripts/probeCalibrationForward.js
 *       → trains on days ≤ config.trainThrough, tests on days AFTER it (the real
 *         freeze gate). 0 OOS days now → re-run as graded days accrue during freeze.
 *   node backend/scripts/probeCalibrationForward.js --retro=2026-06-13
 *       → retrospective leave-future-out: train ≤cutoff, test >cutoff, fitting the
 *         map inline from train-only rows (no leakage) — real OOS evidence available
 *         TODAY. Use to demonstrate the method generalizes before the freeze lifts.
 *   add --out=PATH to also write the report to a file (default .scratch/calibration_forward.txt)
 *
 * Calibration math mirrors the live engine exactly: per-(family×side) isotonic with
 * fallback ladder side→all→global, shrink-to-identity (N_FULL=300), PEPS clamp.
 */
const fs = require("fs"), path = require("path")
const { fitIsotonic, predictIsotonic } = require("../pipeline/shared/isotonicCalibration")

const TRK = path.join(__dirname, "..", "runtime", "tracking")
const CFG = path.join(__dirname, "..", "config", "mlbMarginalCalibration.json")
const NBINS = 25, MIN_FAMILY = 100, MIN_SIDE = 60, N_FULL = 300, PEPS = 1e-4
const FAMS = ["ks", "hits", "rbis", "totalBases", "runs", "hr", "outs"]
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function loadRows() {
  const files = fs.readdirSync(TRK).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const rows = []
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRK, f), "utf8")); a = Array.isArray(j) ? j : Object.values(j) } catch (_) { continue }
    for (const r of a) {
      if (!r || !r.player || String(r.player).toLowerCase().startsWith("no ")) continue
      if (r.result !== "win" && r.result !== "loss") continue
      const mp = num(r.modelProb); if (mp == null) continue
      rows.push({ day, fam: String(r.statFamily || ""), side: String(r.side || "").toLowerCase(), mp, line: num(r.line), hit: r.result === "win" ? 1 : 0 })
    }
  }
  return rows
}

function fitMap(rs) {
  if (rs.length < 2) return null
  const bins = Array.from({ length: NBINS }, () => ({ sx: 0, sy: 0, n: 0 }))
  for (const r of rs) { const b = Math.min(NBINS - 1, Math.max(0, Math.floor(r.mp * NBINS))); bins[b].sx += r.mp; bins[b].sy += r.hit; bins[b].n++ }
  const pts = bins.filter(b => b.n > 0).map(b => ({ x: b.sx / b.n, y: b.sy / b.n, w: b.n }))
  if (pts.length < 2) return null
  return { fit: fitIsotonic(pts), n: rs.length }
}

// Build train maps {global, families:{fam:{all,over,under}}} from train rows.
function buildMaps(train) {
  const global = fitMap(train)
  const families = {}
  for (const fam of [...new Set(train.map(r => r.fam))]) {
    const fr = train.filter(r => r.fam === fam); if (fr.length < MIN_FAMILY) continue
    const e = {}; const all = fitMap(fr); if (all) e.all = all
    for (const side of ["over", "under"]) { const sr = fr.filter(r => r.side === side); if (sr.length >= MIN_SIDE) { const m = fitMap(sr); if (m) e[side] = m } }
    if (e.all || e.over || e.under) families[fam] = e
  }
  return { global, families }
}

// Apply calibration exactly as the engine would (fallback + shrink + clamp).
function applyCal(maps, fam, side, raw) {
  const f = maps.families[fam]
  let entry = (f && side && f[side]) || (f && f.all) || maps.global || null
  if (!entry) return raw
  const iso = predictIsotonic(entry.fit, raw)
  const w = Math.max(0, Math.min(1, entry.n / N_FULL))
  let cal = w * iso + (1 - w) * raw
  if (cal < PEPS) cal = PEPS; if (cal > 1 - PEPS) cal = 1 - PEPS
  return cal
}

function brier(rows, prob) { return rows.reduce((a, r) => a + Math.pow(prob(r) - r.hit, 2), 0) / rows.length }
function meanGap(rows, prob) { const c = rows.reduce((a, r) => a + prob(r), 0) / rows.length, re = rows.reduce((a, r) => a + r.hit, 0) / rows.length; return { claimed: c, realized: re, gap: c - re } }
const pf = (x) => x == null || !Number.isFinite(x) ? "  —  " : (x * 100).toFixed(1).padStart(5)
const sg = (g) => (g >= 0 ? "+" : "") + (g * 100).toFixed(1)

const args = process.argv.slice(2)
const retro = (args.find(a => a.startsWith("--retro=")) || "").split("=")[1] || null
const outArg = (args.find(a => a.startsWith("--out=")) || "").split("=")[1] || path.join(__dirname, "..", "..", ".scratch", "calibration_forward.txt")

const all = loadRows()
const days = [...new Set(all.map(r => r.day))].sort()
let cutoff, mode
if (retro) { cutoff = retro; mode = "RETRO leave-future-out" }
else { try { cutoff = JSON.parse(fs.readFileSync(CFG, "utf8")).trainThrough } catch (_) { cutoff = days[days.length - 1] } ; mode = "LIVE (vs committed trainThrough)" }

const train = all.filter(r => r.day <= cutoff)
const test = all.filter(r => r.day > cutoff)

const out = []; const log = (s) => out.push(s)
log("=================================================================")
log("CALIBRATION FORWARD-VALIDATION (MLB modelProb, SHADOW — no scoring wire)")
log("generated " + new Date().toISOString())
log(`mode: ${mode} | cutoff=${cutoff} | train days ${days.filter(d => d <= cutoff).join(",")}`)
log(`test (OOS) days: ${days.filter(d => d > cutoff).join(",") || "(none)"} | train rows=${train.length} test rows=${test.length}`)
log("=================================================================")

if (!test.length) {
  log("\n0 OUT-OF-SAMPLE days. Re-run after new graded days land during the freeze:")
  log("  node backend/scripts/probeCalibrationForward.js")
  log("For OOS evidence TODAY, run a retrospective split, e.g.:")
  log("  node backend/scripts/probeCalibrationForward.js --retro=" + days[days.length - 3])
} else {
  const maps = retro ? buildMaps(train) : (() => { const j = JSON.parse(fs.readFileSync(CFG, "utf8")); const conv = (m) => m && m.knots ? { fit: { knots: m.knots }, n: m.n } : null; const families = {}; for (const [k, v] of Object.entries(j.families || {})) { families[k] = {}; for (const s of ["all", "over", "under"]) if (v[s]) families[k][s] = conv(v[s]) } return { global: conv(j.global), families } })()
  const rawP = (r) => r.mp, calP = (r) => applyCal(maps, r.fam, r.side, r.mp)
  log("\nPER family×side on OOS test rows. gap=claimed−realized (+ = overconfident). Brier lower=better.")
  log("family       side   n_test  realized | RAW claimed  gap   Brier | CAL claimed  gap   Brier | Δgap   ΔBrier")
  const cells = []
  for (const fam of FAMS) for (const side of ["over", "under"]) {
    const rs = test.filter(r => r.fam === fam && r.side === side); if (rs.length < 10) continue
    const rg = meanGap(rs, rawP), cgp = meanGap(rs, calP), rb = brier(rs, rawP), cb = brier(rs, calP)
    cells.push({ fam, side, n: rs.length, re: rg.realized, rcl: rg.claimed, rgap: rg.gap, rb, ccl: cgp.claimed, cgap: cgp.gap, cb })
    log(`${fam.padEnd(12)} ${side.padEnd(5)} ${String(rs.length).padStart(6)}   ${pf(rg.realized)}  |   ${pf(rg.claimed)}  ${sg(rg.gap).padStart(6)} ${rb.toFixed(3)} |   ${pf(cgp.claimed)}  ${sg(cgp.gap).padStart(6)} ${cb.toFixed(3)} | ${sg(Math.abs(cgp.gap) - Math.abs(rg.gap)).padStart(6)} ${(cb - rb >= 0 ? "+" : "") + (cb - rb).toFixed(3)}`)
  }
  // overall
  const o_rg = meanGap(test, rawP), o_cg = meanGap(test, calP), o_rb = brier(test, rawP), o_cb = brier(test, calP)
  log("-".repeat(110))
  log(`${"OVERALL".padEnd(12)} ${"all".padEnd(5)} ${String(test.length).padStart(6)}   ${pf(o_rg.realized)}  |   ${pf(o_rg.claimed)}  ${sg(o_rg.gap).padStart(6)} ${o_rb.toFixed(3)} |   ${pf(o_cg.claimed)}  ${sg(o_cg.gap).padStart(6)} ${o_cb.toFixed(3)} | ${sg(Math.abs(o_cg.gap) - Math.abs(o_rg.gap)).padStart(6)} ${(o_cb - o_rb >= 0 ? "+" : "") + (o_cb - o_rb).toFixed(3)}`)
  const improved = cells.filter(c => Math.abs(c.cgap) < Math.abs(c.rgap)).length
  const brierImproved = cells.filter(c => c.cb < c.rb).length
  log(`\nVERDICT (OOS): overall |gap| ${(Math.abs(o_rg.gap) * 100).toFixed(1)}pp → ${(Math.abs(o_cg.gap) * 100).toFixed(1)}pp; overall Brier ${o_rb.toFixed(3)} → ${o_cb.toFixed(3)}.`)
  log(`  cells with smaller |gap| after calibration: ${improved}/${cells.length}; cells with lower Brier: ${brierImproved}/${cells.length}.`)
  // anchor cell trace
  const anc = test.filter(r => r.fam === "rbis" && r.side === "over" && r.line != null && r.line <= 0.5 && r.mp >= 0.4 && r.mp < 0.5)
  if (anc.length) { const a = meanGap(anc, rawP), c = meanGap(anc, calP); log(`  ANCHOR rbis over≤0.5 @mp0.4-0.5 (OOS n=${anc.length}): realized ${pf(a.realized)} | raw ${pf(a.claimed)} | cal ${pf(c.claimed)}`) }
}

const text = out.join("\n") + "\n"
try { fs.mkdirSync(path.dirname(outArg), { recursive: true }) } catch (_) {}
fs.writeFileSync(outArg, text); process.stdout.write(text)
