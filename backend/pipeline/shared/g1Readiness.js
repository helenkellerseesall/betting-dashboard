/**
 * g1Readiness.js — single source of truth for "is the G1 graduation gate's forward
 * corpus on track?" READ-ONLY. Reads the JSON mlb_tracked_bets_<date>.json files (the
 * corpus probeMarginalCalibrationValidation.js actually uses for G1) and returns a plain
 * data object. No writes, no scoring, no SQLite. Consumed by BOTH:
 *   - backend/scripts/g1ReadinessCheck.js (CLI morning print)
 *   - backend/routes/statusRoute.js sectionG1Readiness (the /status card)
 * Law 1: one computation, two consumers — never fork this logic.
 *
 * G1 (POST_FREEZE_GRADUATION_PLAN.md) needs >=14 days of CLEAN forward graded data by
 * the freeze lift (~2026-06-25). "Truth only": every number traces to a real file; a day
 * with no real slate is reported as no_slate (benign), NOT faked as clean and NOT mislabelled
 * a grading gap. Missing/unreadable folder → ok:false, never invented numbers.
 */
const fs = require("fs")
const path = require("path")

const FREEZE = "2026-06-11"   // forward boundary (freeze start)
const TARGET = "2026-06-25"   // freeze lifts ~here
const NEED = 14               // clean forward days the gate needs
const CLEAN_FLOOR = 100       // real MLB slates grade hundreds of rows; a failed night ~0.
                              // 100 sits far below the smallest real slate seen (619) and far above a failure.

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}
function addDays(ymd, n) {
  const dt = new Date(ymd + "T12:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5)
}

function gradeableForFile(fp) {
  let a
  try { const j = JSON.parse(fs.readFileSync(fp, "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) }
  catch (_) { return null }
  let total = 0, gradeable = 0
  for (const r of a) {
    if (!r) continue
    total++
    if ((r.result === "win" || r.result === "loss") && Number.isFinite(Number(r.modelProb))) gradeable++
  }
  return { total, gradeable }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.trackingDir] — folder holding mlb_tracked_bets_<date>.json (default: backend/runtime/tracking)
 * @param {Date}   [opts.now]         — clock (default: real now); ET calendar date derived from it
 * @returns {object} readiness data (ok:true) or { ok:false, error }
 */
function computeG1Readiness(opts = {}) {
  const trackingDir = opts.trackingDir || path.join(__dirname, "..", "..", "runtime", "tracking")
  const today = etDateStr(opts.now || new Date())

  let files
  try { files = fs.readdirSync(trackingDir).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() }
  catch (e) { return { ok: false, error: "tracking folder unreadable: " + (e && e.message), asOfEt: today } }

  const perDay = []
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    if (day < FREEZE || day >= "9999") continue
    const c = gradeableForFile(path.join(trackingDir, f))
    const total = c ? c.total : null
    const gradeable = c ? c.gradeable : null
    let state
    if (c == null) state = "unreadable"
    else if (day >= today) state = "in_progress"
    else if (gradeable >= CLEAN_FLOOR) state = "clean"
    else if (total >= CLEAN_FLOOR) state = "gap"          // bets exist but didn't grade = real failure
    else state = "no_slate"                                // no real slate that day (benign)
    perDay.push({ day, total, gradeable, state })
  }

  const completed = perDay.filter(d => d.day < today)
  const cleanDays = completed.filter(d => d.state === "clean")
  const gapDays = completed.filter(d => d.state === "gap")
  const noSlateDays = completed.filter(d => d.state === "no_slate" || d.state === "unreadable")
  const cleanCount = cleanDays.length
  const gaps = gapDays.length
  const last = completed.length ? completed[completed.length - 1] : null

  // Each real grading gap pushes the earliest-evaluable date out by one day from the TARGET.
  const projectedEval = addDays(TARGET, gaps)
  const remainingToTarget = Math.max(0, daysBetween(today, TARGET))  // slates today..(TARGET-1) still to grade

  let verdict, verdictText
  if (cleanCount >= NEED) {
    verdict = "ready"
    verdictText = `Ready — ${cleanCount} clean forward days. G1's corpus is evaluable now.`
  } else if (!last) {
    verdict = "no_data"
    verdictText = "No completed forward slates yet."
  } else if (gaps === 0) {
    const more = NEED - cleanCount
    verdict = "on_track"
    verdictText = `On track for ${TARGET} — ${cleanCount}/${NEED} clean, no gaps. ${more} more clean night${more === 1 ? "" : "s"} → evaluable ${projectedEval}.`
  } else {
    verdict = "slipped"
    verdictText = `Slipped — ${gaps} grading gap${gaps === 1 ? "" : "s"}, so ${cleanCount}/${NEED} clean. Earliest evaluable ~${projectedEval} (was ${TARGET}).`
  }

  return {
    ok: true,
    asOfEt: today,
    freeze: FREEZE, target: TARGET, need: NEED, floor: CLEAN_FLOOR,
    cleanCount,
    gaps,
    gapDays: gapDays.map(d => ({ day: d.day, total: d.total, gradeable: d.gradeable })),
    noSlateDays: noSlateDays.map(d => d.day),
    lastCompleted: last ? { day: last.day, gradeable: last.gradeable, total: last.total, state: last.state } : null,
    remainingToTarget,
    projectedEval,
    verdict,
    verdictText,
    perDay,
  }
}

module.exports = { computeG1Readiness, FREEZE, TARGET, NEED, CLEAN_FLOOR }
