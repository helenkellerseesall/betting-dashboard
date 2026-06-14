"use strict"
// verifyCorrelation — T2 Step 2 (T2-Correlation-1A) regression fixture.
//
// Proves:
//   1. gaussianCopula math vs closed-form anchors (Φ⁻¹, Φ₂, incl.
//      Φ₂(0,0;ρ) = ¼ + asin(ρ)/2π exact).
//   2. SIGN ENFORCED BOTH WAYS (the whole point): ρ_Z>0 ⇒ joint>product;
//      ρ_Z<0 ⇒ joint<product; independence/out-of-scope ⇒ joint==product.
//   3. mlbCorrelationEngine.classifyPair maps the 3 v1 structural classes.
//   4. Kill-switch: MLB_CORRELATION=0 ⇒ jointForPair returns null (child proc).
//   5. Priors sign sanity (pitcherK×opp negative; same-hitter/same-team positive).
//   6. FREEZE GUARD (negative assertions): no scoring/slip file requires the new
//      modules; nbaCorrelationEngine.js is not rewired onto them. Scoring untouched.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const gc = require("../pipeline/shared/gaussianCopula")
const eng = require("../pipeline/mlb/mlbCorrelationEngine")
const TWO_PI = 2 * Math.PI

// ── child mode: emit jointForPair under whatever env the parent set ──
if (process.argv.includes("--off-child")) {
  const r = eng.jointForPair(
    { eventId: "G1", side: "over", player: "A", statFamily: "hr", team: "X" },
    { eventId: "G1", side: "over", player: "A", statFamily: "totalBases", team: "X" },
    { p1: 0.12, p2: 0.45 })
  process.stdout.write(JSON.stringify(r))
  process.exit(0)
}

let pass = 0, fail = 0
const failures = []
const check = (label, cond) => { if (cond) pass++; else { fail++; failures.push(label) } }
const approx = (a, b, t = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t

// 1. math anchors
check("Phi(0)=0.5", approx(gc.normalCdf(0), 0.5))
check("invPhi(0.975)=1.959964", approx(gc.invNormalCdf(0.975), 1.959964, 1e-4))
check("Phi2(0,0,0)=0.25", approx(gc.biNormalCdf(0, 0, 0), 0.25))
check("Phi2(0,0,0.6)=closed form", approx(gc.biNormalCdf(0, 0, 0.6), 0.25 + Math.asin(0.6) / TWO_PI, 1e-7))
check("Phi2(0,0,-0.6)=closed form", approx(gc.biNormalCdf(0, 0, -0.6), 0.25 + Math.asin(-0.6) / TWO_PI, 1e-7))
check("copulaJoint indep=product", approx(gc.copulaJoint(0.3, 0.4, 0), 0.12, 1e-6))
check("copulaJoint rho>0 > product", gc.copulaJoint(0.3, 0.4, 0.5) > 0.12)
check("copulaJoint rho<0 < product", gc.copulaJoint(0.3, 0.4, -0.5) < 0.12)
check("fitRhoZ recovers +0.5", approx(gc.fitRhoZ(0.5, 0.5, 0.25 + Math.asin(0.5) / TWO_PI), 0.5, 1e-3))
check("fitRhoZ recovers -0.5", approx(gc.fitRhoZ(0.5, 0.5, 0.25 + Math.asin(-0.5) / TWO_PI), -0.5, 1e-3))

// 2/3. engine sign both ways + classifyPair (uses the committed priors)
const mk = (o) => Object.assign({ eventId: "G1", side: "over" }, o)
const hrTB = eng.jointForPair(mk({ player: "A", statFamily: "hr", team: "X" }), mk({ player: "A", statFamily: "totalBases", team: "X" }), { p1: 0.12, p2: 0.45 })
const team2 = eng.jointForPair(mk({ player: "A", statFamily: "totalBases", team: "X" }), mk({ player: "B", statFamily: "totalBases", team: "X" }), { p1: 0.45, p2: 0.45 })
const kVsOpp = eng.jointForPair(mk({ player: "P", statFamily: "ks", team: "X" }), mk({ player: "H", statFamily: "hits", team: "Y" }), { p1: 0.50, p2: 0.45 })
const crossGame = eng.jointForPair({ eventId: "G1", side: "over", player: "A", statFamily: "hr", team: "X" }, { eventId: "G2", side: "over", player: "B", statFamily: "hits", team: "Z" }, { p1: 0.2, p2: 0.3 })

check("POSITIVE: same-hitter HR+TB joint > product", hrTB && hrTB.joint > hrTB.rawProduct && hrTB.sign === 1)
check("POSITIVE: same-team 2 hitters joint > product", team2 && team2.joint > team2.rawProduct && team2.sign === 1)
check("NEGATIVE: pitcherK x OPP hitter joint < product", kVsOpp && kVsOpp.joint < kVsOpp.rawProduct && kVsOpp.sign === -1)
check("INDEP: cross-game joint == product (fallback)", crossGame && approx(crossGame.joint, crossGame.rawProduct, 1e-12) && crossGame.fallback === true)

check("classifyPair same-hitter HR+TB key", eng.classifyPair(mk({ player: "A", statFamily: "hr", team: "X" }), mk({ player: "A", statFamily: "totalBases", team: "X" })) === "SAMEhitter_over__hr+totalBases")
check("classifyPair same-team 2 hitters key", eng.classifyPair(mk({ player: "A", statFamily: "totalBases", team: "X" }), mk({ player: "B", statFamily: "totalBases", team: "X" })) === "SAMEteam_2hitters_over_x_over")
check("classifyPair pitcherK x OPP key", eng.classifyPair(mk({ player: "P", statFamily: "ks", team: "X" }), mk({ player: "H", statFamily: "hits", team: "Y" })) === "pitcherK_over__x__OPP_hitter_over")
check("classifyPair under side → null", eng.classifyPair(mk({ player: "A", statFamily: "hr", team: "X", side: "under" }), mk({ player: "A", statFamily: "totalBases", team: "X" })) === null)
check("classifyPair cross-game → null", eng.classifyPair({ eventId: "G1", side: "over", player: "A", statFamily: "hr", team: "X" }, { eventId: "G2", side: "over", player: "B", statFamily: "hits", team: "Y" }) === null)

// 4. kill-switch OFF (child process with MLB_CORRELATION=0)
const child = spawnSync(process.execPath, [__filename, "--off-child"], { encoding: "utf8", env: Object.assign({}, process.env, { MLB_CORRELATION: "0" }) })
check("MLB_CORRELATION=0 ⇒ jointForPair null", child.status === 0 && child.stdout.trim().split("\n").pop().trim() === "null")

// 5. priors sign sanity (committed JSON traces to the ledger)
let priors = { types: {} }
try { priors = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "mlbCorrelationPriors.json"), "utf8")) } catch (_) {}
const tp = priors.types || {}
check("prior pitcherK×opp rhoZ < 0", tp.pitcherK_over__x__OPP_hitter_over && tp.pitcherK_over__x__OPP_hitter_over.rhoZ < 0)
check("prior same-hitter HR+TB rhoZ > 0", tp["SAMEhitter_over__hr+totalBases"] && tp["SAMEhitter_over__hr+totalBases"].rhoZ > 0)
check("prior same-team rhoZ > 0", tp.SAMEteam_2hitters_over_x_over && tp.SAMEteam_2hitters_over_x_over.rhoZ > 0)

// 6. FREEZE GUARD — scoring/slip files must NOT require the new modules; NBA
// engine must NOT be rewired onto them. (Shadow-only; scoring byte-identical.)
const readSrc = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const clusters = readSrc("pipeline/mlb/buildMlbPropClusters.js")
const slipAi = readSrc("pipeline/shared/buildSlipAi.js")
const nbaCorr = readSrc("pipeline/nba/nbaCorrelationEngine.js")
check("scoring (buildMlbPropClusters) does NOT reference correlation engine", clusters.length > 0 && !/mlbCorrelationEngine|gaussianCopula|jointForPair/.test(clusters))
check("buildSlipAi does NOT reference MLB correlation engine", slipAi.length > 0 && !/mlbCorrelationEngine|gaussianCopula/.test(slipAi))
check("nbaCorrelationEngine NOT rewired onto new primitive", nbaCorr.length > 0 && !/gaussianCopula|mlbCorrelationEngine/.test(nbaCorr))

// ── report ──
console.log(`verifyCorrelation: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
