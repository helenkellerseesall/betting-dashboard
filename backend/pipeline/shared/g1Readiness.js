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

// Phase G1-Forward-Gate-Card-1A (2026-06-27) — the BINDING G1 graduation gate is calibration
// FORWARD-VALIDATION (probeCalibrationForward.js): clean nights with game-date AFTER the committed
// calibration trainThrough cutoff, needs >= NEED. computeG1Readiness reads the SAME cfg the probe reads
// (never hardcode the cutoff) so the /status card agrees with the probe instead of over-promising off the
// looser clean-since-FREEZE count.
const CALIB_CFG = path.join(__dirname, "..", "..", "config", "mlbMarginalCalibration.json")
function readCalibCutoff() {
  try { const j = JSON.parse(fs.readFileSync(CALIB_CFG, "utf8")); return (typeof j.trainThrough === "string" && j.trainThrough) ? j.trainThrough : null } catch (_) { return null }
}

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

// Prune-loss recovery helpers (Phase G1-Summary-Fallback-1A) ────────────────────────────────────────
// The retention pruner deletes mlb_tracked_bets_<slate>.json (BETS_PREFIX) but NOT
// grading_summary_mlb_<slate>.json — different filename prefix, so the summary SURVIVES the prune.
// settled = the night's actually-graded bet count (real, from the post-game grade). No fabrication:
// we only ever read this real number; we never synthesize per-pick rows or a date.
function readSummarySettled(fp) {
  try {
    const j = JSON.parse(fs.readFileSync(fp, "utf8"))
    const b = j && j.bets
    const settled = b && Number(b.settled)
    const total = b && Number(b.total)
    return { settled: Number.isFinite(settled) ? settled : null, total: Number.isFinite(total) ? total : null }
  } catch (_) { return { settled: null, total: null } }
}

// Max GAME-date for a slate from a surviving pre-grade per-pick file (mlb_tracked_best_/mlb_picks_),
// which survive the prune too. Uses the SAME gameTime→calendarDateForTimestamp logic as readSlate.
// Returns null if no surviving file carries a usable gameTime — caller then SKIPS (never guesses a date).
function gameDateFromSurviving(trackingDir, slateLabel) {
  for (const name of ["mlb_tracked_best_" + slateLabel + ".json", "mlb_picks_" + slateLabel + ".json"]) {
    let j
    try { j = JSON.parse(fs.readFileSync(path.join(trackingDir, name), "utf8")) } catch (_) { continue }
    const a = Array.isArray(j) ? j : (j.entries || j.picks || j.bets || [])
    const dates = new Set()
    for (const r of a) {
      const gt = r && r.gameTime
      if (gt) { const ms = new Date(gt).getTime(); if (Number.isFinite(ms)) dates.add(calendarDateForTimestamp(ms)) }
    }
    if (dates.size) return [...dates].sort().pop()   // maxGameDate
  }
  return null
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

  // ── Prune-loss recovery (Phase G1-Summary-Fallback-1A 2026-06-24, operator-approved) ──────────────
  // When a slate's mlb_tracked_bets_<slate>.json was pruned but its grading_summary_mlb_<slate>.json
  // survives and shows the night really graded (settled >= CLEAN_FLOOR), count that game-night CLEAN
  // from the REAL summary — a data-retention gap must never masquerade as a missed gate-night. The
  // game-date comes from a surviving pre-grade per-pick file's gameTime (no date guessing). Guards:
  // only when tracked_bets is ABSENT (no double-count) and the game-date isn't already counted; only
  // when settled >= floor (a real fell-short night has settled ~0 → stays uncounted, never faked clean).
  const haveBets = new Set(files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]))
  let summaries = []
  try { summaries = fs.readdirSync(trackingDir).filter(f => /^grading_summary_mlb_\d{4}-\d{2}-\d{2}\.json$/.test(f)) }
  catch (_) { summaries = [] }
  for (const sf of summaries) {
    const slateLabel = sf.match(/(\d{4}-\d{2}-\d{2})/)[1]
    if (haveBets.has(slateLabel)) continue                              // tracked_bets present → live path counts it
    const { settled, total } = readSummarySettled(path.join(trackingDir, sf))
    if (!(Number.isFinite(settled) && settled >= CLEAN_FLOOR)) continue // only a genuinely-graded night
    const gd = gameDateFromSurviving(trackingDir, slateLabel)
    if (!gd || gd < FREEZE) continue                                    // no surviving gameTime → skip (don't guess); forward only
    if (byGameDate.has(gd)) continue                                    // defensive: that game-date already counted
    byGameDate.set(gd, { gradeable: settled, total: total || settled, slates: [slateLabel], recovered: true, recoveredFrom: sf })
  }

  const perDay = []
  for (const gd of [...byGameDate.keys()].sort()) {
    const c = byGameDate.get(gd)
    let state
    if (gd >= currentSlate) state = "pending"           // games not yet played + post-game grade not run
    else if (c.gradeable >= CLEAN_FLOOR) state = "clean"
    else if (c.total >= CLEAN_FLOOR) state = "fell_short" // games played, bets exist, didn't grade = real miss
    else state = "no_slate"
    perDay.push({ day: gd, gradeable: c.gradeable, total: c.total, state, slates: c.slates, recovered: !!c.recovered, recoveredFrom: c.recoveredFrom || null })
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

  // ── BINDING G1 gate: calibration FORWARD-VALIDATION days (clean nights with game-date > trainThrough) ──
  // Mirrors probeCalibrationForward.js exactly (same cfg cutoff, same "day > cutoff" count). The card's
  // "ready/evaluable" verdict keys off THIS, not the looser clean-since-FREEZE count, so it can't over-promise.
  const trainThrough = readCalibCutoff()                            // e.g. "2026-06-15"; null if cfg unreadable
  const forwardCleanDays = trainThrough ? cleanDays.filter(d => d.day > trainThrough) : []
  const forwardCount = forwardCleanDays.length
  const forwardGaps = trainThrough ? fellShortDays.filter(d => d.day > trainThrough).length : 0
  const firstForwardCalib = forwardCleanDays.length ? forwardCleanDays[0].day : (trainThrough ? addDays(trainThrough, 1) : firstForward)  // date-arith-ok
  const forwardProjectedEval = addDays(firstForwardCalib, NEED + forwardGaps)   // date-arith-ok: 14th forward night + the grade
  const forwardReady = trainThrough != null && forwardCount >= NEED
  const moreForward = Math.max(0, NEED - forwardCount)

  let verdict, verdictText
  if (!trainThrough) {
    // No committed calibration cutoff to gate against → report the data signal only (clean-since-FREEZE).
    verdict = cleanCount >= NEED ? "ready" : "on_track"
    verdictText = `${cleanCount}/${NEED} clean nights since ${FREEZE} (no calibration trainThrough committed — gate cutoff unknown).`
  } else if (forwardReady) {
    verdict = "ready"
    verdictText = `G1 calibration gate READY — ${forwardCount}/${NEED} forward-validation nights past ${trainThrough}. (Data: ${cleanCount} clean nights since ${FREEZE}.)`
  } else if (!lastGraded && !pendingDay) {
    verdict = "no_data"
    verdictText = "No graded game-days yet."
  } else {
    verdict = "on_track"
    const gapNote = forwardGaps > 0 ? ` (${forwardGaps} forward night${forwardGaps === 1 ? "" : "s"} fell short)` : ""
    verdictText = `Enough graded data ✓ (${cleanCount} clean nights) — G1 calibration gate needs ${moreForward} more forward night${moreForward === 1 ? "" : "s"} past ${trainThrough}${gapNote} (passes ~${forwardProjectedEval}).`
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
    // BINDING G1 forward-validation gate (agrees with probeCalibrationForward) — the card's verdict keys off these.
    trainThrough, forwardCount, forwardNeed: NEED, forwardGaps, forwardProjectedEval, forwardReady,
    verdict, verdictText,
    perDay,
  }
}

module.exports = { computeG1Readiness, FREEZE, TARGET, NEED, CLEAN_FLOOR }
