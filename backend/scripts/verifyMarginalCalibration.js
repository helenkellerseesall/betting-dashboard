"use strict"
// verifyMarginalCalibration — T2 Track-1 (T2-MarginalCalib-1B, side-aware) fixture.
//
// Proves:
//   1. isotonic (PAVA) is monotone + recovers a known overconfident curve;
//      calibrated reliability-gap < raw gap.
//   2. mlbMarginalCalibration pulls overconfident over-families down + is monotone
//      (preserves ranking), via the committed maps.
//   3. SIDE-AWARE fallback ladder: families[fam][side] → families[fam].all →
//      global → identity (unknown family → global; side w/o map → family.all).
//   4. kill-switch MLB_MARGINAL_CALIB=0 → calibrateModelProb null (child proc).
//   5. FREEZE GUARD: scoring/PRESERVED files reference NOTHING in the new module.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
const iso = require("../pipeline/shared/isotonicCalibration")
const cal = require("../pipeline/mlb/mlbMarginalCalibration")

if (process.argv.includes("--off-child")) {
  process.stdout.write(JSON.stringify(cal.calibrateModelProb(0.45, "totalBases", { side: "over" })))
  process.exit(0)
}

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }

// 1. isotonic primitive
const pts = [{ x: 0.2, y: 0.06, w: 100 }, { x: 0.35, y: 0.09, w: 80 }, { x: 0.5, y: 0.33, w: 50 }, { x: 0.65, y: 0.45, w: 70 }]
const fit = iso.fitIsotonic(pts)
check("isotonic monotone knots", fit.knots.every((k, i) => i === 0 || k.y >= fit.knots[i - 1].y - 1e-9))
const gapRaw = Math.abs(0.5 - 0.33), gapCal = Math.abs(iso.predictIsotonic(fit, 0.5) - 0.33)
check("calibrated gap < raw gap (overconf fixed)", gapCal < gapRaw)
check("predict monotone 0.2≤0.5≤0.65", iso.predictIsotonic(fit, 0.2) <= iso.predictIsotonic(fit, 0.5) + 1e-9 && iso.predictIsotonic(fit, 0.5) <= iso.predictIsotonic(fit, 0.65) + 1e-9)

// 2. engine on committed maps — overconfident OVER families pulled DOWN, monotone
const tb = cal.calibrateModelProb(0.45, "totalBases", { side: "over" })
const hits = cal.calibrateModelProb(0.28, "hits", { side: "over" })
check("totalBases over 0.45 calibrated down", tb != null && tb < 0.45)
check("hits over 0.28 calibrated down", hits != null && hits < 0.28)
const sweep = [0.12, 0.2, 0.3, 0.45, 0.6].map(p => cal.calibrateModelProb(p, "totalBases", { side: "over" }))
check("engine calibration monotone (preserves ranking)", sweep.every((v, i) => i === 0 || v >= sweep[i - 1] - 1e-9))

// 3. SIDE-AWARE fallback ladder: families[fam][side] → families[fam].all → global → identity
const unk = cal.calibrateDetail(0.3, "totally_unknown_family_zzz", { side: "over" })
check("unknown family → global fallback", unk && unk.source === "global")
const over = cal.calibrateDetail(0.45, "totalBases", { side: "over" })
const under = cal.calibrateDetail(0.45, "totalBases", { side: "under" })
check("totalBases side=over → family_over map", over && over.source === "family_over")
check("totalBases side=under → family_under map", under && under.source === "family_under")
check("over vs under calibrate differently (side matters)", over && under && Math.abs(over.calibrated - under.calibrated) > 1e-6)
const noSide = cal.calibrateDetail(0.45, "totalBases", {})            // side omitted → family.all
check("side omitted → family.all fallback", noSide && noSide.source === "family")
const noUnder = cal.calibrateDetail(0.45, "rbis", { side: "under" })  // rbis has no under map → family.all
check("side w/o map → family.all fallback", noUnder && noUnder.source === "family")

// 4. kill-switch OFF (child)
const child = spawnSync(process.execPath, [__filename, "--off-child"], { encoding: "utf8", env: Object.assign({}, process.env, { MLB_MARGINAL_CALIB: "0" }) })
check("MLB_MARGINAL_CALIB=0 → null", child.status === 0 && child.stdout.trim().split("\n").pop().trim() === "null")

// 5. FREEZE GUARD — scoring/PRESERVED must reference nothing in the new module
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const clusters = rd("pipeline/mlb/buildMlbPropClusters.js")
const tracking = rd("pipeline/mlb/phase4Tracking.js")
const dampener = rd("pipeline/shared/calibrationDampener.js")
check("buildMlbPropClusters references no calibration shadow", clusters.length > 0 && !/mlbMarginalCalibration|isotonicCalibration|calibrateModelProb/.test(clusters))
check("phase4Tracking references no calibration shadow", tracking.length > 0 && !/mlbMarginalCalibration|calibrateModelProb/.test(tracking))
check("PRESERVED calibrationDampener untouched by shadow", dampener.length > 0 && !/mlbMarginalCalibration|isotonicCalibration/.test(dampener))

console.log(`verifyMarginalCalibration: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
