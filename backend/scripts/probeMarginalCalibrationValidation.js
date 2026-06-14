"use strict"
/**
 * probeMarginalCalibrationValidation.js — Phase T2-MarginalCalib-1A (2026-06-14)
 *
 * TWO held-out cross-checks (train = first 70% of graded days, test = last 30%;
 * calibration maps refit on TRAIN only → genuine out-of-sample):
 *   (a) Calibrated beats raw modelProb — Brier + reliability gap on test.
 *   (b) THE THROUGH-LINE — re-run the correlation joint-prob check with CALIBRATED
 *       marginals. Does the copula now beat naive product (it lost under raw
 *       modelProb purely because the marginal was overconfident)?
 *
 * READ-ONLY ledger. Writes a summary to .scratch/last.txt. No scipy.
 */
const fs = require("fs"), path = require("path")
const { fitIsotonic, predictIsotonic } = require("../pipeline/shared/isotonicCalibration")
const { copulaJoint } = require("../pipeline/shared/gaussianCopula")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const SCRATCH = path.join(__dirname, "..", "..", ".scratch", "last.txt")
const PRIORS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "mlbCorrelationPriors.json"), "utf8")) } catch (_) { return { types: {} } } })()
const PITCHER = new Set(["ks", "outs", "walks", "earnedRuns"])
const isPitcher = (f) => PITCHER.has(f)
const NBINS = 25, N_FULL = 300

function loadByDay() {
  const files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const byDay = []
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    const rows = [], games = new Map()
    for (const r of a) {
      if (!r || (r.result !== "win" && r.result !== "loss")) continue
      const mp = Number(r.modelProb); if (!Number.isFinite(mp)) continue
      const win = r.result === "win" ? 1 : 0
      rows.push({ mp, win, fam: r.statFamily })
      if (r.eventId) {
        const k = `${r.player}|${r.statFamily}|${r.side}|${r.line}`
        if (!games.has(r.eventId)) games.set(r.eventId, new Map())
        const g = games.get(r.eventId)
        if (!g.has(k)) g.set(k, { player: r.player, fam: r.statFamily, side: r.side, team: r.team, mp, win })
      }
    }
    byDay.push({ day, rows, games })
  }
  return byDay
}

function fitFamilyMaps(days) {
  const byFam = new Map(), all = []
  for (const d of days) for (const r of d.rows) { all.push(r); if (!byFam.has(r.fam)) byFam.set(r.fam, []); byFam.get(r.fam).push(r) }
  const fitOne = (rows) => {
    const bins = Array.from({ length: NBINS }, () => ({ sx: 0, sy: 0, n: 0 }))
    for (const r of rows) { const b = Math.min(NBINS - 1, Math.floor(r.mp * NBINS)); bins[b].sx += r.mp; bins[b].sy += r.win; bins[b].n++ }
    const pts = bins.filter(b => b.n > 0).map(b => ({ x: b.sx / b.n, y: b.sy / b.n, w: b.n }))
    return pts.length >= 2 ? { fit: fitIsotonic(pts), n: rows.length } : null
  }
  const maps = { global: fitOne(all), families: {} }
  for (const [fam, rows] of byFam) { if (rows.length >= 100) { const m = fitOne(rows); if (m) maps.families[fam] = m } }
  return maps
}

function calibrate(maps, mp, fam) {
  const m = maps.families[fam] || maps.global
  if (!m) return mp
  const w = Math.max(0, Math.min(1, m.n / N_FULL))
  return w * predictIsotonic(m.fit, mp) + (1 - w) * mp
}

function pairType(a, b) {
  if (a.side !== "over" || b.side !== "over") return null
  const ap = isPitcher(a.fam), bp = isPitcher(b.fam)
  if (ap !== bp) { const p = ap ? a : b, h = ap ? b : a; if (p.fam !== "ks") return null; const st = a.team && b.team && a.team === b.team; return st ? null : "pitcherK_over__x__OPP_hitter_over" }
  if (ap && bp) return null
  if (a.player === b.player) return `SAMEhitter_over__${[a.fam, b.fam].sort().join("+")}`
  const st = a.team && b.team && a.team === b.team
  return st ? "SAMEteam_2hitters_over_x_over" : null
}

const out = []; const log = (s) => out.push(s)
const byDay = loadByDay()
const cut = Math.max(1, Math.floor(byDay.length * 0.7))
const train = byDay.slice(0, cut), test = byDay.slice(cut)
const maps = fitFamilyMaps(train)
log(`=== T2 marginal-calibration validation — train ${train.length}d / test ${test.length}d ===`)
log(`generated ${new Date().toISOString()}`)

// (a) calibrated vs raw on held-out
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
let bRaw = 0, bCal = 0, nR = 0, sMp = 0, sCal = 0, sWin = 0
for (const d of test) for (const r of d.rows) {
  const cal = calibrate(maps, r.mp, r.fam)
  bRaw += (r.mp - r.win) ** 2; bCal += (cal - r.win) ** 2
  sMp += r.mp; sCal += cal; sWin += r.win; nR++
}
log(`\n(a) HELD-OUT calibrated vs raw modelProb (n=${nR} test legs)`)
log(`  Brier_raw=${(bRaw / nR).toFixed(5)}  Brier_calibrated=${(bCal / nR).toFixed(5)}  ${bCal < bRaw ? "CALIBRATED BETTER" : "raw better"}`)
log(`  reliability gap |stated-realized|: raw=${Math.abs(sMp / nR - sWin / nR * 1).toFixed(4)}→ stated ${(sMp / nR).toFixed(3)} vs realized ${(sWin / nR).toFixed(3)}`)
log(`                                     calibrated stated ${(sCal / nR).toFixed(3)} vs realized ${(sWin / nR).toFixed(3)}  (gap ${Math.abs(sCal / nR - sWin / nR).toFixed(4)})`)

// (b) correlation joint with RAW vs CALIBRATED marginals
let n2 = 0, bNaiveRaw = 0, bCopRaw = 0, bNaiveCal = 0, bCopCal = 0
for (const d of test) for (const g of d.games.values()) {
  const legs = [...g.values()]
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const t = pairType(legs[i], legs[j]); if (!t) continue
    const prior = PRIORS.types && PRIORS.types[t]; if (!prior || !Number.isFinite(Number(prior.rhoZ))) continue
    const rho = Number(prior.rhoZ)
    const realized = legs[i].win & legs[j].win
    const p1 = legs[i].mp, p2 = legs[j].mp
    const c1 = calibrate(maps, p1, legs[i].fam), c2 = calibrate(maps, p2, legs[j].fam)
    bNaiveRaw += (p1 * p2 - realized) ** 2
    bCopRaw += (copulaJoint(p1, p2, rho) - realized) ** 2
    bNaiveCal += (c1 * c2 - realized) ** 2
    bCopCal += (copulaJoint(c1, c2, rho) - realized) ** 2
    n2++
  }
}
log(`\n(b) THROUGH-LINE — correlation joint Brier on held-out pairs (n=${n2})`)
log(`  RAW marginals:        naive=${(bNaiveRaw / n2).toFixed(6)}  copula=${(bCopRaw / n2).toFixed(6)}  ${bCopRaw < bNaiveRaw ? "copula better" : "naive better/equal"}`)
log(`  CALIBRATED marginals: naive=${(bNaiveCal / n2).toFixed(6)}  copula=${(bCopCal / n2).toFixed(6)}  ${bCopCal < bNaiveCal ? "COPULA BEATS NAIVE" : "naive better/equal"}`)
log(`  calibration effect on absolute Brier: naive ${(bNaiveRaw / n2).toFixed(6)} → ${(bNaiveCal / n2).toFixed(6)} ; copula ${(bCopRaw / n2).toFixed(6)} → ${(bCopCal / n2).toFixed(6)}`)
log(`\nHONEST NOTE: thin window (~14d), within-game-clustered pairs; calibration maps refit on TRAIN only. Forward-validation accrues post-ship.`)

const text = out.join("\n") + "\n"
try { fs.writeFileSync(SCRATCH, text, "utf8") } catch (_) {}
process.stdout.write(text)
