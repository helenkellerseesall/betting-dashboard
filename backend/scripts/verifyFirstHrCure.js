"use strict"
// verifyFirstHrCure — F FIRST-HR CURE (2026-07-11) fixture. The mis-settled
// market class (line=0 + box-score total ⇒ any-HR FALSE WIN, no-HR push):
//   1. gradeTrackedBets settles batter_first_home_run by PLAY ORDER via the
//      firstHrCtx (win/loss/void/pending; never the generic stat path; no ctx
//      ⇒ pending, never guessed); void joins the settled-skip set.
//   2. runHistoricalGrade builds the ctx from play-by-play for MLB game-dates.
//   3. Backfill: rules-correction script exists, never touches loss/void rows,
//      stamps a settleNote, dry mode default-documented.
//   4. sysAudit: survivorship-poisoned markets (decided≥20, 0 losses) EXCLUDED
//      from family slices + direction-aware copy; statusRoute copy sign-aware.
//   5. Corpus v3: first-HR excluded + counted; config version mlb-calib-live-v3
//      + excludedFirstHrRows; retro-gate artifact exists (PASS-or-STOP ran).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// 1. settlement branch
const gtb = rd("pipeline/grading/gradeTrackedBets.js")
check("first-HR settles by play order, before the generic stat path", /batter_first_home_run/.test(gtb) && /firstHrCtx\.findGame\(bet\)/.test(gtb) && /g\.noHr/.test(gtb))
check("no ctx / non-final game ⇒ pending (never guessed)", /if \(!firstHrCtx\) return \{ \.\.\.bet, result: "pending" \}/.test(gtb) && /if \(!g \|\| !g\.final\) return \{ \.\.\.bet, result: "pending" \}/.test(gtb))
check("void added to the settled-immutable skip set", /currentResult === "void"/.test(gtb))
// ctx unit (pure — no network)
const { buildFirstHrCtx } = require("../pipeline/grading/fetchMlbFirstHr")
const ctx = buildFirstHrCtx({ byTeamKey: new Map([["yankees@redsox", { gamePk: 1, final: true, firstHrBatter: "aaron judge", noHr: false }]]) })
check("ctx joins by team pair, either orientation", ctx.findGame({ awayTeam: "Yankees", homeTeam: "Red Sox" })?.gamePk === 1 && ctx.findGame({ awayTeam: "Red Sox", homeTeam: "Yankees" })?.gamePk === 1)
check("ctx player normalization (diacritics/case)", ctx.normPlayer("Aarón JUDGE") === "aaron judge")

// 2. caller wiring
const rhg = rd("scripts/runHistoricalGrade.js")
check("runHistoricalGrade builds first-HR ctx for MLB game-dates + passes it", /fetchMlbFirstHr/.test(rhg) && /firstHrCtx,/.test(rhg) && /first-HR context unavailable/.test(rhg))

// 3. backfill discipline
const bf = rd("scripts/backfillFirstHrSettlement.js")
check("backfill: rules-correction with note stamp; loss/void rows untouched; dry mode", /settleNote = "first-HR rules-correction/.test(bf) && /res === "loss" \|\| res === "void"\) continue/.test(bf) && /--dry/.test(bf))
check("backfill: game date via canonical ET calendar helper (never UTC truncation)", /calendarDateForTimestamp\(gtMs\)/.test(bf))

// 4. display honesty
const sa = rd("scripts/sysAudit.js")
check("sysAudit: survivorship-poisoned markets excluded from family slices", /EXCLUDED survivorship-poisoned market/.test(sa) && /dec >= 20 && m\.losses === 0/.test(sa))
check("sysAudit: direction-aware severity copy", /const dirWord = meanStated > realized \? "overstated" : "UNDERSTATED"/.test(sa))
const sr = rd("routes/statusRoute.js")
check("statusRoute: sign-aware copy (too confident/pessimistic; corrected up/down)", /"too confident" : "too pessimistic"/.test(sr) && /"down" : "up"/.test(sr))

// 5. corpus v3
const T = require("../pipeline/mlb/mlbCalibTraining")
check("trainer: VERSION bumped to v3 + first-HR excluded and counted", T.VERSION === "mlb-calib-live-v3" && /excludedFirstHr\+\+/.test(rd("pipeline/mlb/mlbCalibTraining.js")))
let cfg = null
try { cfg = JSON.parse(rd("config/mlbMarginalCalibration.json")) } catch (_) {}
check("config: version v3, excludedFirstHrRows counted, cap intact, hr map sane (≤ cap)", !!cfg && cfg.version === "mlb-calib-live-v3" && Number(cfg.source.excludedFirstHrRows) > 0 && Number(cfg.outputCap) === 0.85 && Math.max(...cfg.families.hr.over.knots.map((k) => k.y)) <= 0.85)
check("v3 retro-gate artifact exists (PASS-or-STOP was actually run)", fs.existsSync(path.join(ROOT, "..", ".scratch", "calibration_forward_v3_retro.txt")) && /G1 GATE: PASS/.test(rd("../.scratch/calibration_forward_v3_retro.txt")))

console.log(`verifyFirstHrCure: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
