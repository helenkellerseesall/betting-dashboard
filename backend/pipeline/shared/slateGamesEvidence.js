"use strict"

/**
 * slateGamesEvidence.js — Phase Status-CLV-Display-Honesty-1A (2026-06-05)
 *
 * SINGLE SOURCE OF TRUTH for "were there games on this slate-date, and were picks
 * curated?" — used by BOTH the /status CLV card (statusRoute.sectionClvCaptureToday)
 * AND the runtime:verify control (verifySlateGamesControl.js). The control tests the
 * REAL classifier here, not a copy, so the card can never drift from its own gate.
 *
 * WHY THIS EXISTS: the card previously inferred "no games today" from a missing/empty
 * tracked_bets file. That is a BROKEN signal — tracked_bets is written late and is
 * Layer-1-filtered to empty as games age (e.g. 2026-06-05 NBA tracked_bets = "[]"
 * even though Finals Game 2 happened). The fix classifies the slate from a UNION of
 * evidence: a curation-INDEPENDENT signal (the odds snapshot) plus durable curated
 * signals (ledger + tracked_best).
 *
 * Snapshot paths are CONFIRMED on disk (2026-06-05): NBA = backend/snapshot.json
 * (NOT snapshot-nba.json, which does not exist), MLB = backend/snapshot-mlb.json.
 * Events live at wrap.data.events[] with ISO `commence_time`. The snapshot rolls
 * FORWARD (it holds the upcoming slate), so countSnapshotEventsForSlate returns 0 for
 * a past/rolled slate-date — which is exactly why the ledger/tracked_best union matters.
 */

const fs = require("fs")
const path = require("path")
const { calendarDateForTimestamp } = require("./slateDate")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")
const SNAPSHOT_PATHS = {
  nba: path.join(__dirname, "..", "..", "snapshot.json"),       // NBA = snapshot.json (legacy name, confirmed)
  mlb: path.join(__dirname, "..", "..", "snapshot-mlb.json"),
}

function _readSnapshotEvents(sport) {
  try {
    const p = SNAPSHOT_PATHS[sport]
    if (!p || !fs.existsSync(p)) return []
    const w = JSON.parse(fs.readFileSync(p, "utf8"))
    const s = w && w.data ? w.data : w
    return Array.isArray(s && s.events) ? s.events : []
  } catch (_) { return [] }
}

/**
 * Count snapshot events whose commence ET-calendar-date === slateDate
 * (curation-independent). Returns { total, tipped } where tipped = games whose
 * commence_time <= now. The tipped count lets the alert layer distinguish a real
 * curation FAILURE (games started, no picks) from a benign early-morning PENDING
 * state (slate rolled at 4 AM, curation hasn't run yet, nothing tipped).
 */
function countSnapshotEventsForSlate(sport, slateDate, nowMs = Date.now()) {
  let total = 0, tipped = 0
  for (const e of _readSnapshotEvents(sport)) {
    const t = e && (e.commence_time || e.gameTime || e.commenceTime || e.startTime)
    if (!t) continue
    const ms = Date.parse(t)
    if (!Number.isFinite(ms)) continue
    if (calendarDateForTimestamp(ms) === slateDate) {
      total++
      if (ms <= nowMs) tipped++
    }
  }
  return { total, tipped }
}

/** Count curated-best entries persisted for the slate-date (durable curation signal). */
function countTrackedBestEntries(sport, slateDate) {
  try {
    const p = path.join(TRACKING_DIR, `${sport}_tracked_best_${slateDate}.json`)
    if (!fs.existsSync(p)) return 0
    const j = JSON.parse(fs.readFileSync(p, "utf8"))
    const e = Array.isArray(j) ? j : (j && (j.entries || j.bets)) || []
    return Array.isArray(e) ? e.length : 0
  } catch (_) { return 0 }
}

/**
 * Pure classifier — the single source of truth for the three-state CLV card.
 *   off_day      : NO evidence of games anywhere on the slate-date.
 *   curation_gap : games scheduled (curation-independent snapshot) but NO curated picks
 *                  and NO ledger picks — curation produced nothing on a day with games.
 *   normal       : curated picks exist (tracked_best entries OR ledger events).
 */
function classifySlateState({ snapshotEvents = 0, ledgerEvents = 0, trackedBestEntries = 0 } = {}) {
  const gamesScheduled = snapshotEvents > 0
  const curatedPicks   = trackedBestEntries > 0 || ledgerEvents > 0
  const gamesAnywhere  = gamesScheduled || ledgerEvents > 0 || trackedBestEntries > 0
  if (!gamesAnywhere) return "off_day"
  if (gamesScheduled && !curatedPicks) return "curation_gap"
  return "normal"
}

/**
 * The CONTROL assertion (req 6). A card that renders "off_day" while ANY source shows
 * games is a lie (the exact fake-green that started this phase). Returns { ok, reason }.
 * verifySlateGamesControl.js calls this every commit on the real slate + a synthetic
 * bad case, so the guard can never silently become a no-op.
 */
function assertCardHonest(state, { snapshotEvents = 0, ledgerEvents = 0, trackedBestEntries = 0 } = {}) {
  const sourcesShowGames = snapshotEvents > 0 || ledgerEvents > 0 || trackedBestEntries > 0
  if (state === "off_day" && sourcesShowGames) {
    return { ok: false, reason: `card=off_day but sources show games (snapshot=${snapshotEvents} ledger=${ledgerEvents} trackedBest=${trackedBestEntries})` }
  }
  return { ok: true, reason: "ok" }
}

module.exports = {
  SNAPSHOT_PATHS,
  countSnapshotEventsForSlate,
  countTrackedBestEntries,
  classifySlateState,
  assertCardHonest,
}
