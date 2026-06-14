"use strict"
/**
 * deriveMlbMarginalCalibration.js — Phase T2-MarginalCalib-1A (2026-06-14)
 *
 * Regenerates backend/config/mlbMarginalCalibration.json from the graded MLB
 * ledger. For global / per-family / per-(family×odds-bucket) it bins raw
 * modelProb into reliability bins (mean stated vs realized hit rate) and fits a
 * monotone isotonic map (PAVA) so calibrated ≈ realized. NEVER fabricates —
 * every knot traces to the ledger. Re-run as graded days accrue.
 *
 *   node backend/scripts/deriveMlbMarginalCalibration.js        # writes config
 *   node backend/scripts/deriveMlbMarginalCalibration.js --dry  # print summary
 *
 * READ-ONLY on the ledger; writes only the config JSON.
 */
const fs = require("fs"), path = require("path")
const { fitIsotonic } = require("../pipeline/shared/isotonicCalibration")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const OUT = path.join(__dirname, "..", "config", "mlbMarginalCalibration.json")
const NBINS = 25
const MIN_FAMILY = 100   // below → no family map (engine falls back to global)
const MIN_BUCKET = 150   // below → no family×bucket map (engine falls back to family)

function bucketOf(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o)) return null
  if (o <= -150) return "heavy_fav"
  if (o < 100) return "mod_fav"
  if (o < 200) return "mod_dog"
  return "longshot"
}

function load() {
  const files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const rows = []
  for (const f of files) {
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    for (const r of a) {
      if (!r || (r.result !== "win" && r.result !== "loss")) continue
      const mp = Number(r.modelProb); if (!Number.isFinite(mp)) continue
      rows.push({ mp, win: r.result === "win" ? 1 : 0, fam: r.statFamily, bucket: bucketOf(r.oddsAmerican) })
    }
  }
  return { files: files.length, rows }
}

// Bin rows → reliability points → isotonic map. Returns {method,n,knots} or null.
function fitMap(rows) {
  if (rows.length < 1) return null
  const bins = Array.from({ length: NBINS }, () => ({ sx: 0, sy: 0, n: 0 }))
  for (const r of rows) { const b = Math.min(NBINS - 1, Math.max(0, Math.floor(r.mp * NBINS))); bins[b].sx += r.mp; bins[b].sy += r.win; bins[b].n += 1 }
  const pts = bins.filter(b => b.n > 0).map(b => ({ x: b.sx / b.n, y: b.sy / b.n, w: b.n }))
  if (pts.length < 2) return null
  const fit = fitIsotonic(pts)
  return { method: "isotonic", n: rows.length, knots: fit.knots.map(k => ({ x: +k.x.toFixed(4), y: +k.y.toFixed(4) })) }
}

const { files, rows } = load()
const global = fitMap(rows)
const families = {}
const famSet = [...new Set(rows.map(r => r.fam))]
for (const fam of famSet) {
  const fr = rows.filter(r => r.fam === fam)
  if (fr.length < MIN_FAMILY) continue
  const entry = fitMap(fr)
  if (!entry) continue
  const buckets = {}
  for (const bk of ["heavy_fav", "mod_fav", "mod_dog", "longshot"]) {
    const br = fr.filter(r => r.bucket === bk)
    if (br.length < MIN_BUCKET) continue
    const bm = fitMap(br)
    if (bm) buckets[bk] = bm
  }
  families[fam] = Object.assign(entry, Object.keys(buckets).length ? { buckets } : {})
}

const out = {
  _doc: "MLB modelProb calibration maps (Phase T2-MarginalCalib-1A). Monotone isotonic (PAVA) maps raw modelProb → realized-rate, fit on the graded ledger by deriveMlbMarginalCalibration.js. Lookup ladder: families[fam].buckets[bucket] → families[fam] → global → identity. CAVEAT: maps are PRIORS from a thin window (~14 days); dense in the 0.1-0.3 region, thin above 0.4 — engine shrinks toward identity on low-n maps. Re-run to refine. SHADOW only — consumed by backend/pipeline/mlb/mlbMarginalCalibration.js; feeds NOTHING in scoring (R2 freeze).",
  generatedAt: new Date().toISOString(),
  source: { ledgerFiles: files, settledRows: rows.length, nbins: NBINS, minFamily: MIN_FAMILY, minBucket: MIN_BUCKET },
  global,
  families,
}

if (process.argv.includes("--dry")) {
  console.log(JSON.stringify({ ...out, families: Object.fromEntries(Object.entries(families).map(([k, v]) => [k, { n: v.n, knots: v.knots.length, buckets: Object.keys(v.buckets || {}) }])) }, null, 2))
} else {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8")
  console.log(`wrote ${OUT}`)
  console.log(`ledger ${files} files / ${rows.length} settled rows | global knots=${global ? global.knots.length : 0} | families=${Object.keys(families).length}`)
  for (const [fam, v] of Object.entries(families)) console.log(`  ${fam.padEnd(12)} n=${String(v.n).padStart(5)} knots=${v.knots.length} buckets=[${Object.keys(v.buckets || {}).join(",")}]`)
}
