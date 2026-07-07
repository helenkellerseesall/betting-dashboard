"use strict"

/**
 * mlbCalibTraining.js — G1 calibration-map TRAINING method, v2 hygiene (2026-07-06).
 *
 * ONE owner for the training method (Law 1): deriveMlbMarginalCalibration.js
 * (writes the config) and probeCalibrationForward.js (the G1 quality gate) BOTH
 * consume this module. They previously each had a private copy of fitMap — the
 * exact setup that lets the gate silently drift from the trainer.
 *
 * WHY v2 (bet-blocking, operator-facing): the v1 runs|over map's last knot was
 * x=0.3651 → y=1.0 — a sparse pooled tail cell (n≈25 rows, all wins) that the
 * engine then served as ~100% MODEL CONF / +60% edge on the /m board. Three
 * layered fixes, each grounded in the measured corpus:
 *
 * 1. RAW-AXIS ERA RULE — the flip (MLB_CALIB_LIVE=1, 2026-07-01) made tracked
 *    modelProb the CALIBRATED value, so naive re-training fits calibration ON
 *    calibration (measured: every runs|over row with modelProb>0.9 is from
 *    07-02..07-04 — the map's own ~0.9999 outputs, realized ~50%). Training
 *    stated prob = modelProbRaw when present (G1-Serve-1A stamps, 07-06+);
 *    modelProb only for pre-flip days; calibrated-era rows without a preserved
 *    raw are EXCLUDED and counted, never silently mixed.
 *
 * 2. MIN_KNOT_N=50 POOLING — reliability bins are pooled left→right until every
 *    training point carries n ≥ 50 (binomial 95% CI half-width ≤ ~14pp at p=0.5;
 *    the v1 failure knots carried n ≤ 25). A trailing underweight pool merges
 *    into the last point — no sparse tail cell can ever become its own knot.
 *    A (family×side) slice too thin to yield 2 pooled points gets NO map and
 *    falls down the engine ladder (side → family.all → global) — the sparse-cell
 *    fallback the spec asks for, expressed structurally.
 *
 * 3. AGRESTI-COULL SMOOTHING + OUTPUT CAP — each pooled point's rate is
 *    (wins + z²/2)/(n + z²), z=1.96, pulling small-sample rates off the 0/1
 *    extremes; knot y is clamped to [0.01, OUTPUT_CAP]. OUTPUT_CAP=0.85:
 *    the maximum realized rate in ANY well-sampled corpus bin (n≥100) is 0.746
 *    (runs|under) — 0.85 sits above every honestly-observed rate with margin,
 *    and nothing bettable ever displays ~100%. The engine enforces the same cap
 *    at predict time (config.outputCap) as a backstop against future bad maps.
 *
 * Version: maps carry version="mlb-calib-live-v2"; the scoring stamp reads it
 * from the engine so eras separate cleanly in the tracked record.
 */

const fs = require("fs")
const path = require("path")
const { fitIsotonic } = require("../shared/isotonicCalibration")

const VERSION = "mlb-calib-live-v2"
// MLB_CALIB_LIVE flipped ON 2026-07-01 ~17:57 ET (OPERATOR_SESSION_LOG). The 07-01
// file mixes pre/post-flip rows → treated as contaminated (strict <).
const FLIP_DAY = "2026-07-01"
const NBINS = 25
const MIN_KNOT_N = 50
const OUTPUT_CAP = 0.85
const KNOT_Y_MIN = 0.01
const Z2 = 3.8416 // 1.96² — Agresti-Coull pseudo-counts

/**
 * The stated probability on the RAW model axis, or null when unrecoverable.
 * (null ⇒ the row is excluded from training/evaluation — anti-contamination.)
 */
function statedRawProb(r, day) {
  const praw = Number(r?.modelProbRaw)
  if (Number.isFinite(praw)) return praw            // stamped era: raw preserved by G1-Serve-1A
  const mp = Number(r?.modelProb)
  if (!Number.isFinite(mp)) return null
  if (String(day) < FLIP_DAY) return mp             // pre-flip: modelProb IS the raw model output
  return null                                       // calibrated-era row without a raw: EXCLUDE
}

/**
 * Load settled MLB tracked rows on the RAW axis (era rule applied).
 * Returns { files, rows:[{day,fam,side,mp,line,hit}], trainThrough, excludedContaminated }.
 */
function loadSettledRawRows(trackingDir) {
  const dir = trackingDir || path.join(__dirname, "..", "..", "runtime", "tracking")
  const files = fs.readdirSync(dir).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const rows = []
  let excludedContaminated = 0
  let trainThrough = null
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    let a
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    let used = false
    for (const r of a) {
      if (!r || !r.player || String(r.player).toLowerCase().startsWith("no ")) continue // synthetic
      if (r.result !== "win" && r.result !== "loss") continue
      const mp = statedRawProb(r, day)
      if (mp == null) { if (Number.isFinite(Number(r?.modelProb))) excludedContaminated++; continue }
      rows.push({
        day,
        fam: String(r.statFamily || ""),
        side: String(r.side || "").toLowerCase(),
        mp,
        line: Number.isFinite(Number(r.line)) ? Number(r.line) : null,
        hit: r.result === "win" ? 1 : 0,
      })
      used = true
    }
    if (used) trainThrough = day
  }
  return { files, rows, trainThrough, excludedContaminated }
}

/**
 * v2 map fit: bin → pool to MIN_KNOT_N → smooth → clamp → PAVA.
 * Accepts rows shaped {mp, hit} or {mp, win}. Returns
 * { method, n, minKnotN, knots:[{x,y}], points:[{x,y,n}] } or null (too thin).
 * `points` is the pre-PAVA audit trail — every training point's pooled n is
 * inspectable; verifier asserts n ≥ MIN_KNOT_N on every one.
 */
function fitMapV2(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  const bins = Array.from({ length: NBINS }, () => ({ sx: 0, wins: 0, n: 0 }))
  for (const r of rows) {
    const mp = Number(r?.mp)
    if (!Number.isFinite(mp)) continue
    const hit = Number(r?.hit ?? r?.win) === 1 ? 1 : 0
    const b = Math.min(NBINS - 1, Math.max(0, Math.floor(mp * NBINS)))
    bins[b].sx += mp; bins[b].wins += hit; bins[b].n += 1
  }
  const nonEmpty = bins.filter((b) => b.n > 0)
  if (!nonEmpty.length) return null

  // Pool left→right until every point carries n ≥ MIN_KNOT_N; trailing
  // underweight remainder merges into the LAST emitted point (the sparse tail
  // can never stand alone — the v1 y=1.0 failure mode).
  const pooled = []
  let acc = { sx: 0, wins: 0, n: 0 }
  for (const b of nonEmpty) {
    acc.sx += b.sx; acc.wins += b.wins; acc.n += b.n
    if (acc.n >= MIN_KNOT_N) { pooled.push(acc); acc = { sx: 0, wins: 0, n: 0 } }
  }
  if (acc.n > 0) {
    if (pooled.length) { const last = pooled[pooled.length - 1]; last.sx += acc.sx; last.wins += acc.wins; last.n += acc.n }
    else pooled.push(acc) // whole slice under the floor → single point → null below
  }
  if (pooled.length < 2) return null // too thin to map — caller falls down the engine ladder

  const pts = pooled.map((p) => {
    const smoothed = (p.wins + Z2 / 2) / (p.n + Z2) // Agresti-Coull: pulls small-n rates off 0/1
    const y = Math.min(OUTPUT_CAP, Math.max(KNOT_Y_MIN, smoothed))
    return { x: p.sx / p.n, y, w: p.n }
  })
  const fit = fitIsotonic(pts)
  return {
    method: "isotonic-v2",
    n: rows.length,
    minKnotN: MIN_KNOT_N,
    knots: fit.knots.map((k) => ({ x: +k.x.toFixed(4), y: +k.y.toFixed(4) })),
    points: pts.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), n: p.w })),
  }
}

module.exports = {
  VERSION, FLIP_DAY, NBINS, MIN_KNOT_N, OUTPUT_CAP, KNOT_Y_MIN,
  statedRawProb, loadSettledRawRows, fitMapV2,
}
