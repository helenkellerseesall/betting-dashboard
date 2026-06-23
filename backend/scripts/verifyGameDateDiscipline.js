"use strict"
/**
 * verifyGameDateDiscipline.js — Phase Game-Date-Timing-1A (#3 recurrence guard, 2026-06-22).
 *
 * Kills the "always a day ahead" bug CLASS from coming back. A game's RESULT-DATE must be
 * derived from the canonical ET source (MLB officialDate / slateDate.js calendarDateForTimestamp),
 * NEVER from a raw UTC gameDate via toISOString().slice(0,10) / getUTC* truncation — for any
 * first pitch ~8pm ET or later the UTC stamp has already rolled to tomorrow.
 *
 * Basis: Claude-C research (online_findings.md 2026-06-22, commit 54f1989) — MLB Stats API
 * officialDate is the canonical result-date. Ready-made fixture: 2024-10-05 schedule, gamePk
 * 775323, officialDate 2024-10-05 vs UTC gameDate 2024-10-06T00:38:00Z.
 *
 * Exit 0 = pass (runtime:verify suite). Exit 1 = a result-date path truncates a UTC gameDate.
 */
const fs = require("fs"), path = require("path")
const { calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS " + msg) } else { fail++; console.log("  FAIL " + msg) } }

console.log("verifyGameDateDiscipline — result-date must derive from officialDate/ET, never UTC truncation")

// (1) BEHAVIORAL — CC fixture gamePk 775323: officialDate 2024-10-05, gameDate 2024-10-06T00:38:00Z (8:38pm ET 10-05).
const FIX_UTC = "2024-10-06T00:38:00Z", FIX_OFFICIAL = "2024-10-05"
ok(calendarDateForTimestamp(FIX_UTC) === FIX_OFFICIAL,
  `canonical calendarDateForTimestamp(${FIX_UTC}) === officialDate ${FIX_OFFICIAL} (got ${calendarDateForTimestamp(FIX_UTC)})`)
const naive = new Date(FIX_UTC).toISOString().slice(0, 10)
ok(naive === "2024-10-06" && naive !== FIX_OFFICIAL,
  `naive UTC slice gives the WRONG day-ahead ${naive} — the bug the canonical path avoids`)

// (2) the grading game-date derivation routes through the canonical helper (not raw truncation).
const rhg = fs.readFileSync(path.join(__dirname, "runHistoricalGrade.js"), "utf8")
const gdfn = (rhg.match(/function gameDatesForSlate[\s\S]*?\n}/) || [""])[0]
ok(/calendarDateForTimestamp\s*\(/.test(gdfn), "gameDatesForSlate derives the game-date via calendarDateForTimestamp (canonical)")
ok(gdfn.length > 0 && !/toISOString\(\)\.slice|getUTCDate\(|getUTCFullYear\(|getUTCMonth\(/.test(gdfn),
  "gameDatesForSlate does NOT truncate a UTC gameDate")

// (3) STATIC SCAN — the result-date / grading date-path files must not raw-derive a date (guards future drift).
// Allowlist: a line tagged `date-arith-ok` (pure YYYY-MM-DD calendar arithmetic on a noon anchor, not a gameDate).
const FILES = [
  "pipeline/grading/fetchMlbGameResults.js",
  "pipeline/grading/gradeTrackedBets.js",
  "scripts/runHistoricalGrade.js",
]
const FORBIDDEN = /toISOString\(\)\.slice\(0|getUTCDate\(|getUTCFullYear\(|getUTCMonth\(/
for (const rel of FILES) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8")
  const hits = src.split("\n").map((l, i) => ({ l, n: i + 1 })).filter(x => FORBIDDEN.test(x.l) && !/date-arith-ok/.test(x.l))
  ok(hits.length === 0, `${rel} — no raw UTC date-truncation in the result-date path${hits.length ? ` (offending lines: ${hits.map(h => h.n).join(", ")})` : ""}`)
}

console.log(`verifyGameDateDiscipline: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) process.exit(1)
