"use strict"
/**
 * deriveMlbMarginalCalibration.js — Phase T2-MarginalCalib-1B (2026-06-16, side-aware)
 *
 * Regenerates backend/config/mlbMarginalCalibration.json from the FULL graded MLB
 * ledger (mlb_tracked_bets). PER (stat_family × side) it bins raw modelProb into
 * reliability bins (mean stated vs realized hit) and fits a monotone isotonic map
 * (PAVA) so calibrated ≈ realized. Side-aware because over/under calibrate
 * differently (measured). Line tiers are handled implicitly by the modelProb axis
 * (a low-line over carries a higher modelProb than a high-line over).
 *
 * Stamps trainThrough = max ledger date used → the forward-validation harness
 * treats days AFTER it as OUT-OF-SAMPLE.
 *
 * NEVER fabricates — every knot traces to the ledger. SHADOW config (kill-switch
 * MLB_MARGINAL_CALIB); feeds nothing live until G1. READ-ONLY on the ledger.
 *   node backend/scripts/deriveMlbMarginalCalibration.js        # writes config
 *   node backend/scripts/deriveMlbMarginalCalibration.js --dry  # print summary
 */
const fs = require("fs"), path = require("path")
const { fitIsotonic } = require("../pipeline/shared/isotonicCalibration")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const OUT = path.join(__dirname, "..", "config", "mlbMarginalCalibration.json")
const NBINS = 25
const MIN_FAMILY = 100   // below → no family map (engine falls back to global)
const MIN_SIDE = 60      // below → no per-side map (engine falls back to family.all)

function load() {
  const files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const rows = []
  let trainThrough = null
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    let used = false
    for (const r of a) {
      if (!r || !r.player || String(r.player).toLowerCase().startsWith("no ")) continue   // exclude synthetic
      if (r.result !== "win" && r.result !== "loss") continue                              // exclude pending/unresolved/push
      const mp = Number(r.modelProb); if (!Number.isFinite(mp)) continue
      rows.push({ fam: String(r.statFamily || ""), side: String(r.side || "").toLowerCase(), mp, win: r.result === "win" ? 1 : 0 })
      used = true
    }
    if (used) trainThrough = day
  }
  return { files, rows, trainThrough }
}

// Bin rows → reliability points → isotonic map. Returns {method,n,knots} or null.
function fitMap(rows) {
  if (rows.length < 2) return null
  const bins = Array.from({ length: NBINS }, () => ({ sx: 0, sy: 0, n: 0 }))
  for (const r of rows) { const b = Math.min(NBINS - 1, Math.max(0, Math.floor(r.mp * NBINS))); bins[b].sx += r.mp; bins[b].sy += r.win; bins[b].n += 1 }
  const pts = bins.filter(b => b.n > 0).map(b => ({ x: b.sx / b.n, y: b.sy / b.n, w: b.n }))
  if (pts.length < 2) return null
  const fit = fitIsotonic(pts)
  return { method: "isotonic", n: rows.length, knots: fit.knots.map(k => ({ x: +k.x.toFixed(4), y: +k.y.toFixed(4) })) }
}

const { files, rows, trainThrough } = load()
const global = fitMap(rows)
const families = {}
for (const fam of [...new Set(rows.map(r => r.fam))]) {
  const fr = rows.filter(r => r.fam === fam)
  if (fr.length < MIN_FAMILY) continue
  const entry = {}
  const all = fitMap(fr); if (all) entry.all = all
  for (const side of ["over", "under"]) {
    const sr = fr.filter(r => r.side === side)
    if (sr.length >= MIN_SIDE) { const m = fitMap(sr); if (m) entry[side] = m }
  }
  if (entry.all || entry.over || entry.under) families[fam] = entry
}

const out = {
  _doc: "MLB modelProb calibration maps (Phase T2-MarginalCalib-1B, side-aware). Monotone isotonic (PAVA) maps raw modelProb → realized-rate, PER (family × side), fit on the graded ledger by deriveMlbMarginalCalibration.js. Lookup ladder: families[fam][side] → families[fam].all → global → identity. Line tiers handled implicitly via the modelProb axis. CAVEAT: in-sample (the trainThrough window below); engine shrinks toward identity on low-n maps. SHADOW only (MLB_MARGINAL_CALIB) — feeds NOTHING in scoring until G1 (post-freeze). Regen via this script as graded days accrue; forward-validate OOS via probeCalibrationForward.js.",
  generatedAt: new Date().toISOString(),
  trainThrough,
  source: { ledgerFiles: files.length, settledRows: rows.length, nbins: NBINS, minFamily: MIN_FAMILY, minSide: MIN_SIDE },
  global,
  families,
}

if (process.argv.includes("--dry")) {
  console.log(JSON.stringify({ ...out, families: Object.fromEntries(Object.entries(families).map(([k, v]) => [k, { all: v.all ? v.all.n : null, over: v.over ? v.over.n : null, under: v.under ? v.under.n : null }])) }, null, 2))
} else {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8")
  console.log(`wrote ${OUT}`)
  console.log(`ledger ${files.length} files / ${rows.length} settled rows / trainThrough ${trainThrough} | global n=${global ? global.n : 0} | families=${Object.keys(families).length}`)
  for (const [fam, v] of Object.entries(families)) console.log(`  ${fam.padEnd(12)} all=${v.all ? v.all.n : "-"} over=${v.over ? v.over.n : "-"} under=${v.under ? v.under.n : "-"}`)
}
