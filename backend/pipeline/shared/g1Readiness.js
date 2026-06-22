/**
 * g1Readiness.js — single source of truth for "is the G1 graduation gate's forward
 * corpus on track?" READ-ONLY. Reads the JSON mlb_tracked_bets_<date>.json files (the
 * corpus probeMarginalCalibrationValidation.js actually uses for G1) and returns a plain
 * data object. No writes, no scoring, no SQLite. Consumed by BOTH:
 *   - backend/scripts/g1ReadinessCheck.js (CLI morning print)
 *   - backend/routes/statusRoute.js sectionG1Readiness (the /status card)
 * Law 1: one computation, two consumers — never fork this logic.
 *
 * NIGHT-STATE (Phase G1-Readiness-Pending-1A 2026-06-21): a slate grades at the 4 AM ET
 * grading run on slate-day+1. So the current slate is PENDING (its grade hasn't run yet),
 * NOT a miss — using the calendar midnight boundary made the card cry "slipped" every night
 * between midnight and 4 AM, then un-cry after the grade. We use the CANONICAL slate boundary
 * (slateDate.js, 04:00 ET) so:
 *   - clean      : grading window passed, sufficient graded rows (counts toward the 14).
 *   - pending    : grading window has NOT passed yet (slate >= current slate date) — does NOT
 *                  count as a miss and does NOT slip the projected date.
 *   - fell_short : grading window HAS passed AND still 0/low graded — a REAL miss (counts + slips).
 *   - no_slate   : grading window passed but no real slate that day (benign).
 * "Truth only": every number traces to a real file; no fabricated greens; never hide a real miss.
 */
const fs = require("fs")
const path = require("path")
const { slateDateForTimestamp } = require("./slateDate")

const FREEZE = "2026-06-11"   // forward boundary (freeze start)
const TARGET = "2026-06-25"   // freeze lifts ~here
const NEED = 14               // clean forward days the gate needs
const CLEAN_FLOOR = 100       // real MLB slates grade hundreds of rows; a failed night ~0.
                              // 100 sits far below the smallest real slate seen (619) and far above a failure.

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
 * @param {string} [opts.trackingDir] — folder with mlb_tracked_bets_<date>.json (default: backend/runtime/tracking)
 * @param {Date}   [opts.now]         — clock (default: real now); the canonical slate date is derived from it
 * @returns {object} readiness data (ok:true) or { ok:false, error }
 */
function computeG1Readiness(opts = {}) {
  const trackingDir = opts.trackingDir || path.join(__dirname, "..", "..", "runtime", "tracking")
  const nowMs = (opts.now || new Date()).getTime()
  // canonical slate date (04:00 ET boundary). Slates strictly before this have had their 4 AM grade run.
  const currentSlate = slateDateForTimestamp(nowMs)

  let files
  try { files = fs.readdirSync(trackingDir).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() }
  catch (e) { return { ok: false, error: "tracking folder unreadable: " + (e && e.message), currentSlate } }

  const perDay = []
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    if (day < FREEZE || day >= "9999") continue
    const c = gradeableForFile(path.join(trackingDir, f))
    const total = c ? c.total : null
    const gradeable = c ? c.gradeable : null
    let state
    if (c == null) state = "unreadable"
    else if (day >= currentSlate) state = "pending"        // grade hasn't run yet (4 AM ET on day+1)
    else if (gradeable >= CLEAN_FLOOR) state = "clean"
    else if (total >= CLEAN_FLOOR) state = "fell_short"    // bets existed but didn't grade = real miss
    else state = "no_slate"                                // grading window passed but no real slate (benign)
    perDay.push({ day, total, gradeable, state })
  }

  const cleanDays = perDay.filter(d => d.state === "clean")
  const fellShortDays = perDay.filter(d => d.state === "fell_short")
  const pendingDays = perDay.filter(d => d.state === "pending")
  const noSlateDays = perDay.filter(d => d.state === "no_slate" || d.state === "unreadable")
  const gradedWindowPassed = perDay.filter(d => d.day < currentSlate && d.state !== "unreadable")

  const cleanCount = cleanDays.length
  const gaps = fellShortDays.length                         // ONLY real post-grading misses slip the date
  const lastGraded = gradedWindowPassed.length ? gradedWindowPassed[gradedWindowPassed.length - 1] : null
  const pendingDay = pendingDays.length ? pendingDays[pendingDays.length - 1] : null

  const projectedEval = addDays(TARGET, gaps)              // pending does NOT push this out
  const remainingToTarget = Math.max(0, daysBetween(currentSlate, TARGET) + (pendingDay ? 1 : 0))
  const more = Math.max(0, NEED - cleanCount)
  const pendNote = pendingDay ? ` (${pendingDays.length} pending tonight's grade)` : ""

  let verdict, verdictText
  if (cleanCount >= NEED) {
    verdict = "ready"
    verdictText = `Ready — ${cleanCount} clean nights. G1's corpus is evaluable now.`
  } else if (!lastGraded && !pendingDay) {
    verdict = "no_data"
    verdictText = "No graded nights yet."
  } else if (gaps > 0) {
    verdict = "slipped"
    verdictText = `Slipped — ${gaps} night${gaps === 1 ? "" : "s"} fell short after grading, so ${cleanCount}/${NEED} clean. Earliest evaluable ~${projectedEval} (was ${TARGET}).`
  } else {
    verdict = "on_track"
    verdictText = `On track for ${TARGET} — ${cleanCount}/${NEED} clean${pendNote}, no misses. ${more} more clean night${more === 1 ? "" : "s"} → evaluable ${projectedEval}.`
  }

  return {
    ok: true,
    currentSlate,
    freeze: FREEZE, target: TARGET, need: NEED, floor: CLEAN_FLOOR,
    cleanCount,
    gaps,
    pendingCount: pendingDays.length,
    pendingDay: pendingDay ? { day: pendingDay.day, total: pendingDay.total, gradeable: pendingDay.gradeable } : null,
    fellShortDays: fellShortDays.map(d => ({ day: d.day, total: d.total, gradeable: d.gradeable })),
    noSlateDays: noSlateDays.map(d => d.day),
    lastGraded: lastGraded ? { day: lastGraded.day, gradeable: lastGraded.gradeable, total: lastGraded.total, state: lastGraded.state } : null,
    remainingToTarget,
    projectedEval,
    verdict,
    verdictText,
    perDay,
  }
}

module.exports = { computeG1Readiness, FREEZE, TARGET, NEED, CLEAN_FLOOR }
