"use strict"
/**
 * probeCorrelationValidation.js — Phase T2-Correlation-1A (2026-06-14)
 *
 * Validates the correlation engine against realized joint outcomes in the graded
 * MLB ledger. THREE honest reads:
 *   (1) SIGN table — realized P(both) vs product-of-empirical-marginals per
 *       structural type (rock-solid; this is what the priors are fit to).
 *   (2) IN-SAMPLE Brier — copula joint vs naive product, using each leg's real
 *       modelProb as the marginal, with the committed priors (fit on the SAME
 *       days → optimistic; demonstrates reproduction, not generalization).
 *   (3) HELD-OUT Brier — refit ρ_Z on the first 70% of days, predict the last
 *       30% (genuine out-of-sample, though sample is thin).
 *
 * READ-ONLY on the ledger. Writes a summary to .scratch/last.txt.
 */
const fs = require("fs"), path = require("path")
const gc = require("../pipeline/shared/gaussianCopula")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const SCRATCH = path.join(__dirname, "..", "..", ".scratch", "last.txt")
const PRIORS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "mlbCorrelationPriors.json"), "utf8")) } catch (_) { return { types: {} } } })()
const PITCHER = new Set(["ks", "outs", "walks", "earnedRuns"])
const isPitcher = (f) => PITCHER.has(f)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function pairType(a, b) {
  if (a.side !== "over" || b.side !== "over") return null
  const ap = isPitcher(a.fam), bp = isPitcher(b.fam)
  if (ap !== bp) {
    const pitcher = ap ? a : b, hitter = ap ? b : a
    if (pitcher.fam !== "ks") return null
    const sameTeam = a.team && b.team && a.team === b.team
    return sameTeam ? null : "pitcherK_over__x__OPP_hitter_over"
  }
  if (ap && bp) return null
  if (a.player === b.player) return `SAMEhitter_over__${[a.fam, b.fam].sort().join("+")}`
  const sameTeam = a.team && b.team && a.team === b.team
  return sameTeam ? "SAMEteam_2hitters_over_x_over" : null
}

function loadByDay() {
  const files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const byDay = []
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    const games = new Map()
    for (const r of a) {
      if (!r || !r.player || !r.eventId) continue
      if (r.result !== "win" && r.result !== "loss") continue
      const k = `${r.player}|${r.statFamily}|${r.side}|${r.line}`
      if (!games.has(r.eventId)) games.set(r.eventId, new Map())
      const g = games.get(r.eventId)
      if (!g.has(k)) g.set(k, { player: r.player, fam: r.statFamily, side: r.side, line: r.line, team: r.team, win: r.result === "win" ? 1 : 0, mp: num(r.modelProb) })
    }
    byDay.push({ day, games })
  }
  return byDay
}

// Aggregate structural (px,py,pBoth,n) over a set of day-game maps.
function aggregate(days) {
  const agg = new Map()
  for (const d of days) for (const g of d.games.values()) {
    const legs = [...g.values()]
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
      const t = pairType(legs[i], legs[j]); if (!t) continue
      if (!agg.has(t)) agg.set(t, { n: 0, sx: 0, sy: 0, sboth: 0 })
      const o = agg.get(t); o.n++; o.sx += legs[i].win; o.sy += legs[j].win; o.sboth += (legs[i].win & legs[j].win)
    }
  }
  return agg
}

// Brier over co-occurring pairs with a usable prior + both modelProbs.
function brier(days, rhoLookup) {
  let nC = 0, sumC = 0, sumN = 0
  for (const d of days) for (const g of d.games.values()) {
    const legs = [...g.values()]
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
      const t = pairType(legs[i], legs[j]); if (!t) continue
      const rho = rhoLookup(t); if (rho == null) continue
      const p1 = legs[i].mp, p2 = legs[j].mp; if (p1 == null || p2 == null) continue
      const realized = legs[i].win & legs[j].win
      const jc = gc.copulaJoint(p1, p2, rho)
      const jn = p1 * p2
      sumC += (jc - realized) ** 2
      sumN += (jn - realized) ** 2
      nC++
    }
  }
  return { n: nC, brierCopula: nC ? sumC / nC : null, brierNaive: nC ? sumN / nC : null }
}

const out = []
const log = (s) => out.push(s)
const byDay = loadByDay()
const allGames = byDay.reduce((s, d) => s + d.games.size, 0)
log(`=== T2 correlation validation — ${byDay.length} days, ${allGames} settled games ===`)
log(`generated ${new Date().toISOString()}`)

// (1) SIGN table
log("\n(1) SIGN — realized P(both) vs product of empirical marginals (per structural type)")
log("type".padEnd(40) + "n".padStart(7) + "Pboth".padStart(8) + "prod".padStart(8) + "lift".padStart(7) + "  sign-correct")
const aggAll = aggregate(byDay)
let signOk = 0, signTot = 0
for (const [t, o] of [...aggAll.entries()].sort((a, b) => b[1].n - a[1].n)) {
  if (o.n < 150) continue
  const px = o.sx / o.n, py = o.sy / o.n, pBoth = o.sboth / o.n, prod = px * py
  const lift = prod > 0 ? pBoth / prod : NaN
  const expectNeg = t.startsWith("pitcherK")
  const correct = expectNeg ? lift < 1 : lift > 1
  signTot++; if (correct) signOk++
  log(t.padEnd(40) + String(o.n).padStart(7) + pBoth.toFixed(4).padStart(8) + prod.toFixed(4).padStart(8) + (isFinite(lift) ? lift.toFixed(2) : "—").padStart(7) + "  " + (correct ? "YES" : "NO"))
}
log(`sign-correct: ${signOk}/${signTot} structural types`)

// (2) IN-SAMPLE Brier (committed priors)
const inS = brier(byDay, (t) => (PRIORS.types && PRIORS.types[t] ? Number(PRIORS.types[t].rhoZ) : null))
log("\n(2) IN-SAMPLE Brier (committed priors; modelProb marginals) — priors fit on same days, optimistic")
log(`  pairs=${inS.n}  Brier_copula=${inS.brierCopula?.toFixed(6)}  Brier_naive=${inS.brierNaive?.toFixed(6)}  ${inS.brierCopula < inS.brierNaive ? "copula BETTER" : "naive better/equal"}`)

// (3) HELD-OUT Brier — FORWARD: refit ρ_Z on days <= cutoff, validate on FORWARD days > cutoff (replaces 70/30).
// --trainThrough=YYYY-MM-DD (or FORWARD_CUTOFF env) overrides; default = freeze start so a no-arg run is forward-only.
const FREEZE = "2026-06-11"
const cutoff = (process.argv.slice(2).find((a) => a.startsWith("--trainThrough=")) || "").split("=")[1] || process.env.FORWARD_CUTOFF || FREEZE
const train = byDay.filter((d) => d.day <= cutoff)
const test = byDay.filter((d) => d.day > cutoff)
const trainAgg = aggregate(train)
const trainRho = new Map()
for (const [t, o] of trainAgg.entries()) {
  if (o.n < 150) continue
  const px = o.sx / o.n, py = o.sy / o.n, pBoth = o.sboth / o.n
  trainRho.set(t, gc.fitRhoZ(px, py, pBoth))
}
const heldOut = brier(test, (t) => (trainRho.has(t) ? trainRho.get(t) : null))
log(`\n(3) HELD-OUT Brier — refit ρ_Z on first ${train.length} days, test on last ${test.length} days (modelProb marginals; genuine out-of-sample; thin)`)
log(`  test pairs=${heldOut.n}  Brier_copula=${heldOut.brierCopula?.toFixed(6)}  Brier_naive=${heldOut.brierNaive?.toFixed(6)}  ${heldOut.brierCopula != null ? (heldOut.brierCopula < heldOut.brierNaive ? "copula BETTER" : "naive better/equal") : "n/a"}`)

// (4) HELD-OUT, TYPE-LEVEL — isolates the DEPENDENCE from modelProb miscalibration.
// Predict each test pair's both-hit with the TRAIN type-level joint rate (what the
// copula encodes) vs the TRAIN product-of-marginals (independence). Same marginals
// both sides → the only difference is whether dependence is modeled.
const trainStats = new Map()
for (const [t, o] of trainAgg.entries()) {
  if (o.n < 150) continue
  const px = o.sx / o.n, py = o.sy / o.n, pBoth = o.sboth / o.n
  trainStats.set(t, { pBoth, product: px * py })
}
let n4 = 0, c4 = 0, nv4 = 0
for (const d of test) for (const g of d.games.values()) {
  const legs = [...g.values()]
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const t = pairType(legs[i], legs[j]); if (!t || !trainStats.has(t)) continue
    const realized = legs[i].win & legs[j].win
    const s = trainStats.get(t)
    c4 += (s.pBoth - realized) ** 2
    nv4 += (s.product - realized) ** 2
    n4++
  }
}
log(`\n(4) HELD-OUT, TYPE-LEVEL — train joint rate (dependence) vs train product (independence), same marginals both sides`)
log(`  test pairs=${n4}  Brier_dependence=${n4 ? (c4 / n4).toFixed(6) : "n/a"}  Brier_independence=${n4 ? (nv4 / n4).toFixed(6) : "n/a"}  ${n4 ? ((c4 / n4) < (nv4 / n4) ? "DEPENDENCE BETTER" : "independence better/equal") : "n/a"}`)

log("\nHONEST NOTES:")
log("  - pair counts are within-game clustered (effective independent sample ≈ games); forward-validation accrues post-ship.")
log("  - (2)/(3) use modelProb as the per-leg marginal; modelProb is overconfident (the known calibration gap), so the copula amplifies that marginal error → Brier does not beat naive there. That is a MARGINAL problem, not a dependence problem.")
log("  - (1) sign and (4) type-level isolate the DEPENDENCE itself: those are the engine's actual job. Shadow-only until marginals are calibrated + forward data confirms.")

// ── G3 GATE — copula joint beats naive product on FORWARD held-out pairs. ──
// NOTE: this probe uses RAW modelProb marginals; the FULL G3 gate requires G1-CALIBRATED marginals
// (re-run post-G1, or read the calibrated through-line in probeMarginalCalibrationValidation section b).
const g3_fwdDays = test.length
const g3_haveBrier = heldOut && Number.isFinite(heldOut.brierCopula) && Number.isFinite(heldOut.brierNaive)
const g3_copulaBeats = g3_haveBrier && heldOut.brierCopula < heldOut.brierNaive
const g3_enoughDays = g3_fwdDays >= 14
const g3_pass = g3_enoughDays && g3_copulaBeats
log("")
log(`G3 GATE: ${g3_pass ? "PASS" : "FAIL"}  (need ALL: forward-days>=14 [${g3_fwdDays} ${g3_enoughDays ? "ok" : "no"}] · copula Brier < naive on forward pairs [${g3_haveBrier ? (g3_copulaBeats ? "ok" : "no") : "n/a — no pairs"}]; raw marginals — re-run with G1 calibrated for the real gate)`)
if (!g3_enoughDays) log(`  -> not yet evaluable: only ${g3_fwdDays} forward day(s) past ${cutoff}.`)

const text = out.join("\n") + "\n"
try { fs.writeFileSync(SCRATCH, text, "utf8") } catch (_) {}
process.stdout.write(text)
