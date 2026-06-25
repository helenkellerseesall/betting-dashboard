/**
 * g1Readiness.js — single source of truth for "is the G1 graduation gate's forward
 * corpus on track?" READ-ONLY. Reads the JSON mlb_tracked_bets_<date>.json files (the
 * corpus probeMarginalCalibrationValidation.js uses for G1) and returns a plain data object.
 * No writes, no scoring, no SQLite. Consumed by the CLI (g1ReadinessCheck.js) AND the
 * /status calibration-readiness card (statusRoute sectionG1Readiness). Law 1: one computation.
 *
 * GAME-DATE-DRIVEN (Phase Game-Date-Timing-1A 2026-06-22, operator-approved option A):
 * the slate FILE is named by pick-GENERATION date, but the games play ~slate+1 (real gameTime =
 * odds-API commence_time). So a "night" is keyed off each slate's ACTUAL game date(s) — derived
 * from per-bet gameTime via calendarDateForTimestamp (slateDate.js, CANONICAL) — NOT the slate
 * label. A slate is PENDING until its games are PLAYED + graded; it can only FALL SHORT once its
 * game-dates are PAST (its post-game 4 AM grade has run) and it is still ungraded. This kills the
 * false "slipped" the slate-label boundary produced (the current slate's games are unplayed).
 *
 * Boundary (canonical): a game-date D's grade runs at 4 AM ET on D+1 — i.e. exactly when the slate
 * date (slateDateForTimestamp, 4 AM boundary) rolls past D. So: window has passed for D iff
 * currentSlate > D; pending iff D >= currentSlate.
 *
 * "Truth only": every number traces to a real file; no fabricated greens; never hide a real miss.
 */
const fs = require("fs")
const path = require("path")
const { slateDateForTimestamp, calendarDateForTimestamp } = require("./slateDate")

const FREEZE = "2026-06-11"   // forward boundary (freeze start) — applied to GAME date
const TARGET = "2026-06-25"   // freeze lifts ~here
const NEED = 14               // clean forward GAME-days the gate needs
const CLEAN_FLOOR = 100       // real MLB slates grade hundreds of rows; a failed night ~0.

function addDays(ymd, n) {
  const dt = new Date(ymd + "T12:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n)   // date-arith-ok: noon-UTC anchor, projection arithmetic (not a game-date derivation)
  return dt.toISOString().slice(0, 10)   // date-arith-ok
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5)
}

// For a slate file: settled/gradeable counts + the slate's ACTUAL game date(s) from per-bet gameTime.
function readSlate(fp) {
  let a
  try { const j = JSON.parse(fs.readFileSync(fp, "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) }
  catch (_) { return null }
  let total = 0, gradeable = 0
  const gameDates = new Set()
  for (const r of a) {
    if (!r) continue
    total++
    if ((r.result === "win" || r.result === "loss") && Number.isFinite(Number(r.modelProb))) gradeable++
    const gt = r.gameTime
    if (gt) { const ms = new Date(gt).getTime(); if (Number.isFinite(ms)) gameDates.add(calendarDateForTimestamp(ms)) }
  }
  const dates = [...gameDates].sort()
  return { total, gradeable, gameDates: dates, maxGameDate: dates.length ? dates[dates.length - 1] : null }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.trackingDir] — folder with mlb_tracked_bets_<date>.json
 * @param {Date}   [opts.now]         — clock (default real now); slate boundary derived from it
 * @returns {object} readiness data (ok:true) or { ok:false, error }
 */
function computeG1Readiness(opts = {}) {
  const trackingDir = opts.trackingDir || path.join(__dirname, "..", "..", "runtime", "tracking")
  const nowMs = (opts.now || new Date()).getTime()
  const currentSlate = slateDateForTimestamp(nowMs)   // 4 AM ET boundary

  let files
  try { files = fs.readdirSync(trackingDir).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() }
  catch (e) { return { ok: false, error: "tracking folder unreadable: " + (e && e.message), currentSlate } }

  // Aggregate each slate onto the GAME date it fully settles on (its max game-date). Slate label is
  // ignored for classification — only the real game date decides played-yet / clean / fell-short.
  const byGameDate = new Map()  // gameDate -> { gradeable, total, slates:[slateLabel] }
  for (const f of files) {
    const slateLabel = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    if (slateLabel >= "9999") continue
    const s = readSlate(path.join(trackingDir, f))
    if (!s) continue
    const gd = s.maxGameDate || slateLabel   // fall back to label only if no gameTime at all
    if (gd < FREEZE) continue                // forward = GAME date >= freeze
    const cur = byGameDate.get(gd) || { gradeable: 0, total: 0, slates: [] }
    cur.gradeable += s.gradeable; cur.total += s.total; cur.slates.push(slateLabel)
    byGameDate.set(gd, cur)
  }

  const perDay = []
  for (const gd of [...byGameDate.keys()].sort()) {
    const c = byGameDate.get(gd)
    let state
    if (gd >= currentSlate) state = "pending"           // games not yet played + post-game grade not run
    else if (c.gradeable >= CLEAN_FLOOR) state = "clean"
    else if (c.total >= CLEAN_FLOOR) state = "fell_short" // games played, bets exist, didn't grade = real miss
    else state = "no_slate"
    perDay.push({ day: gd, gradeable: c.gradeable, total: c.total, state, slates: c.slates })
  }

  const cleanDays = perDay.filter(d => d.state === "clean")
  const fellShortDays = perDay.filter(d => d.state === "fell_short")
  const pendingDays = perDay.filter(d => d.state === "pending")
  const noSlateDays = perDay.filter(d => d.state === "no_slate")
  const passed = perDay.filter(d => d.day < currentSlate)

  const cleanCount = cleanDays.length
  const gaps = fellShortDays.length
  const lastGraded = passed.length ? passed[passed.length - 1] : null
  const pendingDay = pendingDays.length ? pendingDays[0] : null   // the nearest unplayed game-date

  // Phase Status-Overhaul-1B (off-by-one fix) — evaluable = the NEED-th clean forward game-day + 1
  // day (games play that day, then grade at 4 AM ET the next day). Was addDays(TARGET, gaps), which
  // hardcoded 06-25 regardless of when the 14th clean game-day actually lands. firstForward = earliest
  // forward game-day (slate FREEZE plays FREEZE+1); the NEED-th clean day is shifted by any misses (gaps).
  const allGameDays = perDay.map(d => d.day).sort()         // YYYY-MM-DD sorts chronologically
  const firstForward = allGameDays[0] || addDays(FREEZE, 1) // date-arith-ok
  const projectedEval = addDays(firstForward, NEED + gaps)  // date-arith-ok
  const more = Math.max(0, NEED - cleanCount)
  const pendNote = pendingDay ? ` (${pendingDays.length} pending — games not played)` : ""

  let verdict, verdictText
  if (cleanCount >= NEED) {
    verdict = "ready"
    verdictText = `Ready — ${cleanCount} clean game-days. G1's corpus is evaluable now.`
  } else if (!lastGraded && !pendingDay) {
    verdict = "no_data"
    verdictText = "No graded game-days yet."
  } else if (gaps > 0) {
    verdict = "slipped"
    verdictText = `Slipped — ${gaps} game-day${gaps === 1 ? "" : "s"} fell short after its games played, so ${cleanCount}/${NEED} clean. Earliest evaluable ~${projectedEval} (was ${TARGET}).`
  } else {
    verdict = "on_track"
    verdictText = `On track for ${TARGET} — ${cleanCount}/${NEED} clean${pendNote}, no misses. ${more} more clean night${more === 1 ? "" : "s"} → evaluable ${projectedEval}.`
  }

  return {
    ok: true,
    currentSlate,
    freeze: FREEZE, target: TARGET, need: NEED, floor: CLEAN_FLOOR,
    cleanCount, gaps, pendingCount: pendingDays.length,
    pendingDay: pendingDay ? { day: pendingDay.day, total: pendingDay.total, gradeable: pendingDay.gradeable } : null,
    fellShortDays: fellShortDays.map(d => ({ day: d.day, total: d.total, gradeable: d.gradeable })),
    noSlateDays: noSlateDays.map(d => d.day),
    lastGraded: lastGraded ? { day: lastGraded.day, gradeable: lastGraded.gradeable, total: lastGraded.total, state: lastGraded.state } : null,
    projectedEval,
    verdict, verdictText,
    perDay,
  }
}

module.exports = { computeG1Readiness, FREEZE, TARGET, NEED, CLEAN_FLOOR }
