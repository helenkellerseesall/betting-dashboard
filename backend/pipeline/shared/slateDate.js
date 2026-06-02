"use strict"

/**
 * slateDate.js — Phase Date-Doctrine-1A (2026-06-01)
 *
 * CANONICAL authority for slate-date semantics across the repo.
 *
 * Operator-binding doctrine (locked 2026-06-01 22:00 ET):
 *
 *   1. Slate date = ET calendar day (America/New_York timezone).
 *      Never UTC. Never sandbox-local. Never inferred from
 *      `new Date().toISOString()` (which is UTC).
 *
 *   2. Slate day boundary = 04:00 AM ET.
 *      - Late NBA games end ~02:30 ET (West Coast 11:30 PT).
 *      - 04:00 ET is when grading:backfill-all autopilot fires.
 *      - Rule: timestamp between 04:00 ET on date X and 03:59:59 ET on
 *        date X+1 belongs to slate X.
 *      - Practical: at 11 PM ET on 2026-06-01, slate = "2026-06-01".
 *        At 2 AM ET on 2026-06-02, slate is STILL "2026-06-01" (late
 *        west-coast game hasn't settled yet).
 *
 *   3. Display labels = ET always. No UTC strings shown to operator
 *      anywhere.
 *
 * Why this exists:
 *   2026-06-01 22:00 ET — operator caught that nba_tracked_best filename
 *   rolled over to "2026-06-02.json" at 20:00 ET (= 00:00 UTC June 2)
 *   because the writer used `new Date().toISOString().slice(0,10)`.
 *   Result: same-ET-day evening slate split across two filenames, FE
 *   confused about which "today" is real. The doctrine fixes it
 *   structurally — every call site uses the same helper, no more drift.
 *
 * Usage:
 *   const { currentSlateDateEt, slateDateForTimestamp, formatEt, isInSlate }
 *     = require("./slateDate")
 *
 *   currentSlateDateEt()              // "2026-06-01" (right now)
 *   slateDateForTimestamp(Date.now()) // same
 *   slateDateForTimestamp(t)          // any past/future ms timestamp
 *   formatEt(Date.now())              // "2026-06-01 22:25:00 ET"
 *   isInSlate(t, "2026-06-01")        // bool
 *   slateWindowEt("2026-06-01")       // { startMs, endMs }
 *
 * Anti-fabrication: no defaults, no fallbacks. If input is malformed,
 * functions throw. Better a loud error than a wrong date silently.
 */

const SLATE_BOUNDARY_HOUR_ET = 4  // 04:00 ET = day rollover

/**
 * Extract ET-timezone parts from a timestamp using Intl.
 * Returns { year, month, day, hour, minute, second } as numbers.
 */
function etParts(ts) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) throw new Error(`slateDate: invalid timestamp ${ts}`)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
  const out = {}
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value)
  }
  // Edge: "hour24: 24" rolls to next-day 00 in some locales — normalize.
  if (out.hour === 24) out.hour = 0
  return out
}

/**
 * Subtract one day from a {year, month, day} struct.
 */
function _subOneDay(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() - 1)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function _pad(n) { return String(n).padStart(2, "0") }

/**
 * Returns the slate-date key ("YYYY-MM-DD") for the given timestamp,
 * using the 4 AM ET boundary rule.
 *
 * @param {number|Date|string} ts  — defaults to current time
 * @returns {string} "YYYY-MM-DD"
 */
function slateDateForTimestamp(ts = Date.now()) {
  const parts = etParts(ts)
  let { year, month, day } = parts
  // If ET hour is before the 04:00 boundary, this timestamp belongs to
  // YESTERDAY's slate. Shift the date key back one day.
  if (parts.hour < SLATE_BOUNDARY_HOUR_ET) {
    ({ year, month, day } = _subOneDay(year, month, day))
  }
  return `${year}-${_pad(month)}-${_pad(day)}`
}

/**
 * Returns the current slate-date key. Shorthand for
 * slateDateForTimestamp(Date.now()).
 */
function currentSlateDateEt() {
  return slateDateForTimestamp(Date.now())
}

/**
 * Phase Date-Doctrine-1B-fix2 — calendar date in ET, NO 4 AM boundary.
 *
 * USE THIS FOR: human-readable wall-clock displays. The /status header,
 * "current time" labels, anywhere operator expects to see "what date is it
 * right now per a normal clock."
 *
 * DO NOT USE FOR: file lookups, slate semantics, "which slate does this prop
 * belong to" — that's slateDateForTimestamp/currentSlateDateEt's job.
 *
 * At 12:58 AM ET June 2: calendarDateEt() = "2026-06-02" (calendar), but
 * currentSlateDateEt() = "2026-06-01" (slate, pre-4 AM boundary). Both are
 * correct for their respective concepts. Conflating them was the fix1 bug.
 */
function calendarDateForTimestamp(ts = Date.now()) {
  const parts = etParts(ts)
  return `${parts.year}-${_pad(parts.month)}-${_pad(parts.day)}`
}
function calendarDateEt() {
  return calendarDateForTimestamp(Date.now())
}

/**
 * Returns the ms window {startMs, endMs} for a given slate-date key.
 * startMs = 04:00:00 ET on the given date.
 * endMs   = 03:59:59.999 ET on the next date.
 *
 * The operator can `if (ts >= w.startMs && ts <= w.endMs) ...` to test
 * whether any timestamp falls in this slate.
 */
function slateWindowEt(dateKey) {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) throw new Error(`slateDate: invalid dateKey ${dateKey} (expected YYYY-MM-DD)`)
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  // ET is UTC-4 in EDT (Mar-Nov), UTC-5 in EST (Nov-Mar). Use Date with
  // toLocaleString round-trip to get the exact UTC ms for "04:00 ET" on
  // the given local date.
  const startEtStr = `${year}-${_pad(month)}-${_pad(day)}T04:00:00`
  const startMs = _etLocalStrToUtcMs(startEtStr)
  // End = start + 24h - 1ms
  const endMs = startMs + (24 * 60 * 60 * 1000) - 1
  return { startMs, endMs }
}

/**
 * Convert an ET-local time string ("YYYY-MM-DDTHH:MM:SS") to UTC ms.
 * Handles DST automatically by round-tripping through Intl.
 */
function _etLocalStrToUtcMs(localStr) {
  // Initial guess: pretend it's UTC, then offset by ET's current offset
  const naiveUtcMs = Date.parse(localStr + "Z")
  if (isNaN(naiveUtcMs)) throw new Error(`slateDate: cannot parse local string ${localStr}`)
  // ET offset from UTC for this timestamp (in minutes)
  const etOffset = _etOffsetMinutes(naiveUtcMs)
  // ET wall-clock = UTC + offset. So UTC = wall-clock - offset.
  return naiveUtcMs - etOffset * 60 * 1000
}

/**
 * Returns the ET UTC offset in minutes for the given ms timestamp.
 * EDT = -240, EST = -300.
 */
function _etOffsetMinutes(ms) {
  const d = new Date(ms)
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }))
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }))
  return Math.round((local.getTime() - utc.getTime()) / 60000)
}

/**
 * Returns true if the given timestamp falls within the slate-date window
 * (4 AM ET start to 3:59:59.999 ET next day).
 */
function isInSlate(ts, dateKey) {
  const w = slateWindowEt(dateKey)
  return ts >= w.startMs && ts <= w.endMs
}

/**
 * Format a timestamp as "YYYY-MM-DD HH:MM:SS ET" for operator-visible
 * display. Use this everywhere a timestamp appears in logs / dashboards /
 * brain docs that an operator might read.
 */
function formatEt(ts) {
  const p = etParts(ts)
  return `${p.year}-${_pad(p.month)}-${_pad(p.day)} ${_pad(p.hour)}:${_pad(p.minute)}:${_pad(p.second)} ET`
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline self-tests — run when this file is executed directly.
// Verifies the 4 AM boundary rule + DST handling + roundtrip cases.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  let passed = 0, failed = 0
  function assert(label, actual, expected) {
    const ok = actual === expected
    if (ok) { passed++; console.log("  ✓ " + label) }
    else    { failed++; console.log("  ✗ " + label + " — expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)) }
  }

  console.log("slateDate.js self-tests:")
  console.log("")
  console.log("--- slateDateForTimestamp boundary ---")
  // 04:00 ET June 1 = start of June 1 slate
  assert("04:00 ET June 1 → 2026-06-01",
    slateDateForTimestamp(_etLocalStrToUtcMs("2026-06-01T04:00:00")),
    "2026-06-01")
  // 23:59:59 ET June 1 → still 2026-06-01
  assert("23:59:59 ET June 1 → 2026-06-01",
    slateDateForTimestamp(_etLocalStrToUtcMs("2026-06-01T23:59:59")),
    "2026-06-01")
  // 03:59:59 ET June 2 → still 2026-06-01 (before boundary)
  assert("03:59:59 ET June 2 → 2026-06-01 (pre-boundary)",
    slateDateForTimestamp(_etLocalStrToUtcMs("2026-06-02T03:59:59")),
    "2026-06-01")
  // 04:00:00 ET June 2 → 2026-06-02 (at boundary)
  assert("04:00:00 ET June 2 → 2026-06-02 (at boundary)",
    slateDateForTimestamp(_etLocalStrToUtcMs("2026-06-02T04:00:00")),
    "2026-06-02")

  console.log("")
  console.log("--- the regression operator hit ---")
  // 20:00 ET June 1 = 00:00 UTC June 2. Old code emitted "2026-06-02".
  // New helper emits "2026-06-01" (correct: still operator's June 1 evening).
  assert("20:00 ET June 1 → 2026-06-01 (was leaking to 06-02)",
    slateDateForTimestamp(_etLocalStrToUtcMs("2026-06-01T20:00:00")),
    "2026-06-01")
  // 22:30 ET June 1 = 02:30 UTC June 2. Same regression.
  assert("22:30 ET June 1 → 2026-06-01",
    slateDateForTimestamp(_etLocalStrToUtcMs("2026-06-01T22:30:00")),
    "2026-06-01")

  console.log("")
  console.log("--- isInSlate ---")
  const t = _etLocalStrToUtcMs("2026-06-01T22:30:00")
  assert("22:30 ET June 1 is in 2026-06-01 slate",
    isInSlate(t, "2026-06-01"), true)
  assert("22:30 ET June 1 NOT in 2026-06-02 slate",
    isInSlate(t, "2026-06-02"), false)
  // Pre-boundary edge
  const earlyAm = _etLocalStrToUtcMs("2026-06-02T02:30:00")
  assert("02:30 ET June 2 is in 2026-06-01 slate (pre-boundary)",
    isInSlate(earlyAm, "2026-06-01"), true)

  console.log("")
  console.log("--- formatEt ---")
  // formatEt for a known UTC time
  assert("formatEt for 04:00:00 ET June 1",
    formatEt(_etLocalStrToUtcMs("2026-06-01T04:00:00")),
    "2026-06-01 04:00:00 ET")

  console.log("")
  console.log("=== " + passed + " passed, " + failed + " failed ===")
  process.exit(failed > 0 ? 1 : 0)
}

module.exports = {
  currentSlateDateEt,
  slateDateForTimestamp,
  calendarDateEt,            // Phase Date-Doctrine-1B-fix2 — wall-clock date, no 4 AM boundary
  calendarDateForTimestamp,  // Phase Date-Doctrine-1B-fix2 — wall-clock date for any ts
  slateWindowEt,
  isInSlate,
  formatEt,
  etParts,           // exported for advanced consumers
  SLATE_BOUNDARY_HOUR_ET,
}
