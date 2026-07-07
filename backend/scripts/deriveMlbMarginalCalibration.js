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
// 2026-07-06 G1 map-hygiene v2 — training method consolidated into
// pipeline/mlb/mlbCalibTraining.js (ONE owner; the forward-gate probe consumes
// the SAME module, so gate and trainer can never silently drift). v2 adds the
// raw-axis era rule (anti-contamination), MIN_KNOT_N pooling, Agresti-Coull
// smoothing and the output cap — full rationale in that module's header.
const T = require("../pipeline/mlb/mlbCalibTraining")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const OUT = path.join(__dirname, "..", "config", "mlbMarginalCalibration.json")
const MIN_FAMILY = 100   // below → no family map (engine falls back to global)
const MIN_SIDE = 60      // below → no per-side map (engine falls back to family.all)

const { files, rows, trainThrough, excludedContaminated } = T.loadSettledRawRows(TRACKING)
const global = T.fitMapV2(rows)
const families = {}
for (const fam of [...new Set(rows.map(r => r.fam))]) {
  const fr = rows.filter(r => r.fam === fam)
  if (fr.length < MIN_FAMILY) continue
  const entry = {}
  const all = T.fitMapV2(fr); if (all) entry.all = all
  for (const side of ["over", "under"]) {
    const sr = fr.filter(r => r.side === side)
    if (sr.length >= MIN_SIDE) { const m = T.fitMapV2(sr); if (m) entry[side] = m }
  }
  if (entry.all || entry.over || entry.under) families[fam] = entry
}

const out = {
  _doc: "MLB modelProb calibration maps — v2 hygiene (2026-07-06). Monotone isotonic (PAVA) maps RAW modelProb → realized-rate PER (family × side), fit by deriveMlbMarginalCalibration.js via the shared mlbCalibTraining.js method: raw-axis era rule (rows after the 2026-07-01 flip only count when modelProbRaw was preserved — never calibration-on-calibration), MIN_KNOT_N pooling (every training point n ≥ 50; sparse tails merge, the v1 runs|over y=1.0 knot class is structurally impossible), Agresti-Coull smoothing, knot y clamped to [0.01, outputCap]. Engine enforces outputCap again at predict time. Lookup ladder: families[fam][side] → families[fam].all → global → identity; engine shrinks toward identity on low-n maps. Regen via this script; forward-validate via probeCalibrationForward.js (same shared method).",
  version: T.VERSION,
  outputCap: T.OUTPUT_CAP,
  generatedAt: new Date().toISOString(),
  trainThrough,
  source: {
    ledgerFiles: files.length, settledRows: rows.length,
    excludedContaminatedRows: excludedContaminated, flipDay: T.FLIP_DAY,
    nbins: T.NBINS, minKnotN: T.MIN_KNOT_N, minFamily: MIN_FAMILY, minSide: MIN_SIDE,
  },
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
