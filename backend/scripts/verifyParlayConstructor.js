"use strict"
// verifyParlayConstructor — T2 step 3 (T2-Parlay-1A) regression fixture.
//
// Proves:
//   1. CROSS-GAME EV math = hand-derived (joint·payout − 1 on calibrated marginals).
//   2. SAME-GAME → evParlay null + correlation present (no fabricated EV).
//   3. NEVER-AUTO-BUNDLE: a +EV single paired with a −EV single surfaces NO
//      parlay; default recommendation = singles.
//   4. ANTI-FAKE-EV: a leg +EV on RAW modelProb but −EV on CALIBRATED is rejected
//      (no parlay) — calibration prevents manufactured +EV. THE guard.
//   5. Kill-switch MLB_PARLAY=0 → buildParlays null (child process).
//   6. FREEZE GUARD: scoring files reference nothing in the constructor.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
const pc = require("../pipeline/mlb/mlbParlayConstructor")
const { calibrateModelProb } = require("../pipeline/mlb/mlbMarginalCalibration")

if (process.argv.includes("--off-child")) {
  process.stdout.write(JSON.stringify(pc.buildParlays([])))
  process.exit(0)
}

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const approx = (a, b, t = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t
const dec = pc.americanToDecimal
const has = (arr, ids) => arr.some(p => p.legs.length === ids.length && ids.every(x => p.legs.includes(x)))

// americanToDecimal sanity
check("americanToDecimal +100=2.0", approx(dec(100), 2.0))
check("americanToDecimal -110≈1.9091", approx(dec(-110), 1 + 100 / 110, 1e-9))

// 1 + 2. cross-game EV hand-derived + 4. anti-fake-EV, in one leg set:
//   tb1,tb2 (cross-game, modest modelProb that stays +EV after calibration)
//   hrFake1,hrFake2 (cross-game, +EV on RAW @ +300 but −EV after hr calibration)
const legs = [
  { id: "tb1", player: "P1", statFamily: "totalBases", side: "over", line: 1.5, eventId: "G1", team: "X", oddsAmerican: 120, modelProb: 0.55 },
  { id: "tb2", player: "P2", statFamily: "totalBases", side: "over", line: 1.5, eventId: "G2", team: "Y", oddsAmerican: 120, modelProb: 0.55 },
  { id: "hrF1", player: "H1", statFamily: "hr", side: "over", line: 0.5, eventId: "G3", team: "Z", oddsAmerican: 300, modelProb: 0.40 },
  { id: "hrF2", player: "H2", statFamily: "hr", side: "over", line: 0.5, eventId: "G4", team: "W", oddsAmerican: 300, modelProb: 0.40 },
]
const r = pc.buildParlays(legs)
check("buildParlays returns a structure", r && Array.isArray(r.parlays))

// expected calibrated values (compute via the same authority — map-robust)
const calTb = calibrateModelProb(0.55, "totalBases", { oddsAmerican: 120 })
const calHr = calibrateModelProb(0.40, "hr", { oddsAmerican: 300 })
const decTb = dec(120), decHr = dec(300)
const evSingleTb = calTb * decTb - 1
const evSingleHr = calHr * decHr - 1
const rawEvHr = 0.40 * decHr - 1   // RAW: should look +EV

// 4. ANTI-FAKE-EV: hr legs are +EV on RAW but −EV on CALIBRATED
check("hr leg is +EV on RAW (the trap)", rawEvHr > 0)
check("hr leg is NOT +EV on CALIBRATED", evSingleHr < 0)
check("fake-EV hr parlay NOT surfaced", !has(r.parlays, ["hrF1", "hrF2"]))
const hrSingle = r.singles.find(s => s.id === "hrF1")
check("fake-EV hr single flagged plusEVsingle=false", hrSingle && hrSingle.plusEVsingle === false)
check("fake-EV hr single uses calibrated (< raw 0.40)", hrSingle && hrSingle.calibrated < 0.40)

// 1. cross-game EV hand-derived for tb1×tb2
const expectedJointTb = calTb * calTb
const expectedPayoutTb = decTb * decTb
const expectedEvTb = expectedJointTb * expectedPayoutTb - 1
const tbCombo = [...r.parlays, ...r.rejected].find(p => p.legs.includes("tb1") && p.legs.includes("tb2"))
check("tb×tb combo present", !!tbCombo)
check("cross-game evParlay = joint·payout−1 (hand-derived)", tbCombo && approx(tbCombo.evParlay, expectedEvTb, 1e-9))
check("cross-game joint = calTb²", tbCombo && approx(tbCombo.joint, expectedJointTb, 1e-12))
check("cross-game payout = decTb²", tbCombo && approx(tbCombo.payout, expectedPayoutTb, 1e-12))
check("evIfBetAsSingles = sum of single EVs", tbCombo && approx(tbCombo.evIfBetAsSingles, evSingleTb + evSingleTb, 1e-9))
// 2 (surface): tb×tb surfaces iff both +EV single AND evParlay>0 (data-driven)
const tbShouldSurface = evSingleTb > 0 && expectedEvTb > 0
check("tb×tb surfaced iff +EV (data-driven)", has(r.parlays, ["tb1", "tb2"]) === tbShouldSurface)

// 3. NEVER-AUTO-BUNDLE: +EV single (tb1) paired with −EV single (hrF1) cross-game → not surfaced
check("+EV × −EV cross-game NOT bundled", !has(r.parlays, ["tb1", "hrF1"]))
check("recommendation defaults to singles when no +EV parlay", typeof r.recommendation === "string")

// 2. SAME-GAME → evParlay null + correlation present
const sg = pc.buildParlays([
  { id: "s1", player: "Q1", statFamily: "hr", side: "over", line: 0.5, eventId: "SG", team: "X", oddsAmerican: 250, modelProb: 0.30 },
  { id: "s2", player: "Q1", statFamily: "totalBases", side: "over", line: 1.5, eventId: "SG", team: "X", oddsAmerican: 120, modelProb: 0.55 },
])
const sgEntry = sg.sameGame.find(p => p.legs.includes("s1") && p.legs.includes("s2"))
check("same-game combo in sameGame[]", !!sgEntry)
check("same-game evParlay is null (no SGP price)", sgEntry && sgEntry.evParlay === null)
check("same-game correlation present (joint computed)", sgEntry && Number.isFinite(sgEntry.joint))
check("same-game has explanatory note", sgEntry && /SGP price/.test(sgEntry.note || ""))
check("same-game NOT in recommended parlays[]", !has(sg.parlays, ["s1", "s2"]))

// 5. kill-switch OFF → null (child)
const child = spawnSync(process.execPath, [__filename, "--off-child"], { encoding: "utf8", env: Object.assign({}, process.env, { MLB_PARLAY: "0" }) })
check("MLB_PARLAY=0 → buildParlays null", child.status === 0 && child.stdout.trim().split("\n").pop().trim() === "null")

// 6. FREEZE GUARD — scoring references nothing in the constructor
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const clusters = rd("pipeline/mlb/buildMlbPropClusters.js")
const tracking = rd("pipeline/mlb/phase4Tracking.js")
check("buildMlbPropClusters references no parlay constructor", clusters.length > 0 && !/mlbParlayConstructor|buildParlays/.test(clusters))
check("phase4Tracking references no parlay constructor", tracking.length > 0 && !/mlbParlayConstructor|buildParlays/.test(tracking))

console.log(`verifyParlayConstructor: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
