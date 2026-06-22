#!/usr/bin/env node
/**
 * g1ReadinessCheck.js — READ-ONLY morning check: is the G1 graduation gate's
 * forward corpus on track to be evaluable by 2026-06-25?
 *
 * G1 (POST_FREEZE_GRADUATION_PLAN.md) needs >=14 days of CLEAN forward graded data
 * (calibrated modelProb beats raw on reliability gap + Brier). The corpus G1 actually
 * reads is the JSON mlb_tracked_bets_<date>.json files (probeMarginalCalibrationValidation.js),
 * NOT the SQLite snapshot tables (whose model_prob join is empty — see
 * .scratch/g1_evaluability_probe.txt + intelligence.js:78).
 *
 * This script ONLY reads those JSON files and prints a plain-English status. It writes
 * nothing, grades nothing, and changes no scoring. Run it each morning after the 4 AM grade.
 *
 *   node backend/scripts/g1ReadinessCheck.js
 */
const fs = require("fs")
const path = require("path")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const FREEZE = "2026-06-11"   // forward boundary (freeze start)
const TARGET = "2026-06-25"   // freeze lifts ~here; G1 wants >=14 forward days by now
const NEED = 14
const CLEAN_FLOOR = 100       // a real MLB slate grades hundreds of rows; a failed night is ~0.
                             // 100 sits far below the smallest real slate (~619) and far above a failure.

function etDate(d = new Date()) {
  // calendar ET date YYYY-MM-DD (grading runs 4 AM ET, so by morning the prior slate is graded)
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  return p
}
const addDays = (ymd, n) => {
  const dt = new Date(ymd + "T12:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5)

function gradeableForDay(file) {
  let a
  try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, file), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) }
  catch (_) { return null }
  let n = 0
  for (const r of a) {
    if (!r) continue
    if ((r.result === "win" || r.result === "loss") && Number.isFinite(Number(r.modelProb))) n++
  }
  return n
}

const today = etDate()
let files
try { files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() }
catch (e) { console.log("G1 CHECK: cannot read tracking folder — " + (e && e.message)); process.exit(0) }

const rows = []
for (const f of files) {
  const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
  if (day < FREEZE || day >= "9999") continue
  rows.push({ day, gradeable: gradeableForDay(f) })
}

const completed = rows.filter(r => r.day < today)      // prior slates — should be graded by now
const cleanDays = completed.filter(r => (r.gradeable || 0) >= CLEAN_FLOOR)
const gapDays = completed.filter(r => (r.gradeable || 0) < CLEAN_FLOOR)
const cleanCount = cleanDays.length
const last = completed.length ? completed[completed.length - 1] : null

// projection: each clean forward slate adds 1; the 14th forward slate (06-24) grades the morning of 06-25.
// every gap so far pushes the evaluable date out by 1 day.
const expectedCompleted = last ? daysBetween(FREEZE, last.day) + 1 : 0
const gaps = Math.max(0, expectedCompleted - cleanCount)
const projectedEval = addDays(TARGET, gaps)
const remainingToTarget = Math.max(0, daysBetween(today, TARGET))  // slates today..06-24 still to grade

console.log("================ G1 READINESS — MORNING CHECK ================")
console.log(`(read-only · ${today} ET · forward since ${FREEZE} · need ${NEED} clean days by ${TARGET})\n`)

if (last) {
  if ((last.gradeable || 0) >= CLEAN_FLOOR) console.log(`✓ Last night graded CLEAN — ${last.day}: ${last.gradeable.toLocaleString()} bets graded.`)
  else console.log(`⚠ GAP — ${last.day} graded only ${last.gradeable} bets (under ${CLEAN_FLOOR}). That night did NOT count toward G1.`)
} else {
  console.log("No completed forward slates yet.")
}

console.log(`\nClean forward days so far: ${cleanCount} of ${NEED}.`)
if (gapDays.length) console.log(`Gap days (did not count): ${gapDays.map(d => d.day + " (" + (d.gradeable || 0) + ")").join(", ")}`)

console.log("\nVERDICT:")
if (cleanCount >= NEED) {
  console.log(`  ✅ READY — ${cleanCount} clean forward days. G1's corpus is evaluable now. Run the forward calibration probe.`)
} else if (gaps === 0) {
  const needMore = NEED - cleanCount
  console.log(`  🟢 ON TRACK for ${TARGET} — ${cleanCount}/${NEED} clean, no gaps. If the next ${needMore} night${needMore === 1 ? "" : "s"} stay clean, the corpus is evaluable on ${projectedEval}.`)
} else {
  console.log(`  🟡 SLIPPED — ${gaps} gap${gaps === 1 ? "" : "s"} so far, so ${cleanCount}/${NEED} clean. Earliest evaluable now ~${projectedEval} (was ${TARGET}). Each further clean night still adds one.`)
}
console.log(`\n(slates still to grade by ${TARGET}: ${remainingToTarget} — ${today}..${addDays(TARGET, -1)})`)
console.log("\nPer-day (forward): " + rows.map(r => `${r.day.slice(5)}=${r.gradeable == null ? "?" : r.gradeable}`).join("  "))
console.log("=============================================================")
