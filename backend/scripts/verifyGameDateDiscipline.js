"use strict"
/**
 * verifyGameDateDiscipline.js — Phase Game-Date-Timing-1A (#3 recurrence guard).
 * Extended 2026-06-22 to CC's FULL date-from-timestamp anti-pattern net (online_findings.md
 * 2026-06-22 21:15, commit f39ec70). Kills the "always a day ahead" (and the BEHIND round-trip)
 * bug CLASS: a game RESULT-DATE / slate date-key must derive from the canonical ET source
 * (slateDate.js calendarDateForTimestamp / slateDateForTimestamp / currentSlateDateEt, or upstream
 * MLB officialDate) — NEVER from a raw timestamp via UTC truncation, runtime-local formatting,
 * date-only-string re-parse, epoch day-bucketing, or setDate(±1) shifts.
 *
 * GUARDRAILS (CC's caution — don't over-match): a line is EXEMPT if it (a) is tagged
 * `date-arith-ok` (pure YYYY-MM-DD calendar arithmetic on a noon/UTC anchor — not a game-date),
 * (b) is tagged `display-ok` (FE/format-only), or (c) already routes through the canonical helper
 * on the same line. The strongest signal is the POSITIVE check below (result-date fns must call
 * calendarDateForTimestamp), preferred over pure blocklisting.
 *
 * Exit 0 = pass (runtime:verify). Exit 1 = a date-path mis-derives a calendar date.
 */
const fs = require("fs"), path = require("path")
const { calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS " + msg) } else { fail++; console.log("  FAIL " + msg) } }

console.log("verifyGameDateDiscipline — result/slate dates must derive from ET-canonical, never raw timestamp truncation")

// ── (1) BEHAVIORAL fixtures — both directions, host-independent (calendarDateForTimestamp is ET-explicit) ──
// AHEAD (historical regression fixture): gamePk 775323, officialDate 2024-10-05 vs gameDate 2024-10-06T00:38:00Z.
ok(calendarDateForTimestamp("2024-10-06T00:38:00Z") === "2024-10-05",
  `[AHEAD/2024] canonical(2024-10-06T00:38:00Z) === officialDate 2024-10-05 (got ${calendarDateForTimestamp("2024-10-06T00:38:00Z")})`)
ok(new Date("2024-10-06T00:38:00Z").toISOString().slice(0, 10) === "2024-10-06",
  "[AHEAD/2024] naive UTC slice gives the WRONG day-ahead 2024-10-06 (the bug)")
// AHEAD (current-season, CC 2026 fixture): gamePk 824342 Pirates@Rockies, gameDate 2026-06-21T01:10:00Z, officialDate 2026-06-20.
ok(calendarDateForTimestamp("2026-06-21T01:10:00Z") === "2026-06-20",
  `[AHEAD/2026] canonical(2026-06-21T01:10:00Z) === officialDate 2026-06-20 (got ${calendarDateForTimestamp("2026-06-21T01:10:00Z")})`)
// BEHIND (round-trip trap): a date-only string is parsed as UTC midnight → read in ET it is the PRIOR day.
// On an ET host `new Date('2026-06-20').getDate() === 19`; we assert the host-independent ET form here.
ok(calendarDateForTimestamp(new Date("2026-06-20").getTime()) === "2026-06-19",
  `[BEHIND] new Date('2026-06-20') (UTC midnight) read in ET === 2026-06-19, not 06-20 (got ${calendarDateForTimestamp(new Date("2026-06-20").getTime())}) — why new Date('YYYY-MM-DD')/Date.parse on a date-key is banned`)

// ── (2) POSITIVE checks — the date-deriving fns route through the canonical helper ──
const readFn = (file, fnRe) => { const s = fs.readFileSync(path.join(__dirname, "..", file), "utf8"); const m = s.match(fnRe); return m ? m[0] : "" }
const gdfn = readFn("scripts/runHistoricalGrade.js", /function gameDatesForSlate[\s\S]*?\n}/)
ok(/calendarDateForTimestamp\s*\(/.test(gdfn) && !/(toISOString|toJSON)\(\)\.(slice|split|substr)|getUTCDate\(/.test(gdfn),
  "gameDatesForSlate derives via calendarDateForTimestamp (canonical), no UTC truncation")
const sgds = readFn("scripts/settlementRun.js", /function slateGameDateStatus[\s\S]*?\n}/)
ok(/calendarDateForTimestamp\s*\(/.test(sgds), "settlementRun.slateGameDateStatus derives via calendarDateForTimestamp (canonical)")
const rds = readFn("pipeline/shared/g1Readiness.js", /function readSlate[\s\S]*?\n}/)
ok(/calendarDateForTimestamp\s*\(/.test(rds), "g1Readiness.readSlate derives game-date via calendarDateForTimestamp (canonical)")

// ── (3) STATIC SCAN of the result-date / grading date-path files for CC's FULL anti-pattern net ──
const FILES = [
  "pipeline/grading/fetchMlbGameResults.js",
  "pipeline/grading/gradeTrackedBets.js",
  "scripts/runHistoricalGrade.js",
  "scripts/settlementRun.js",
]
const EXEMPT = /date-arith-ok|display-ok|calendarDateForTimestamp|slateDateForTimestamp|currentSlateDateEt/
function offenders(line) {
  const hits = []
  if (/(toISOString|toJSON)\(\)\s*\.\s*(slice|substr|substring)\(\s*0/.test(line)) hits.push("UTC toISOString/toJSON truncation")
  if (/(toISOString|toJSON)\(\)\s*\.\s*split\(\s*['"`]T/.test(line)) hits.push("UTC toISOString/toJSON split('T')")
  if (/getUTC(Date|FullYear|Month)\(/.test(line)) hits.push("getUTC* date parts")
  if (/86400000/.test(line)) hits.push("epoch /86400000 day-bucket")
  if (/(toLocaleDateString|toLocaleString)\(/.test(line) && !/timeZone/.test(line)) hits.push("toLocale* without timeZone")
  if (/Intl\.DateTimeFormat\(/.test(line) && !/timeZone/.test(line)) hits.push("Intl.DateTimeFormat without timeZone")
  if (/\.set(UTC)?Date\(/.test(line)) hits.push("setDate/setUTCDate day-shift")
  if (/Date\.parse\(/.test(line) || /new Date\(\s*['"`]/.test(line)) hits.push("Date.parse / new Date(<string>) re-parse")
  if (/\.get(FullYear|Month|Date)\(/.test(line)) hits.push("bare local getFullYear/Month/Date key")
  return hits
}
for (const rel of FILES) {
  const lines = fs.readFileSync(path.join(__dirname, "..", rel), "utf8").split("\n")
  const found = []
  lines.forEach((l, i) => { if (!EXEMPT.test(l)) { const h = offenders(l); if (h.length) found.push(`L${i + 1}: ${h.join(", ")}`) } })
  ok(found.length === 0, `${rel} — no raw date-from-timestamp derivation${found.length ? " (" + found.join(" · ") + ")" : ""}`)
}

// ── (4) SELF-TEST — prove the net FIRES on each of CC's anti-patterns (guard is not vacuous) ──
const SHOULD_CATCH = {
  "toISOString().slice":        "  return d.toISOString().slice(0,10)",
  "toISOString().split('T')":   "  const k = d.toISOString().split('T')[0]",
  "toISOString().substring":    "  const k = d.toISOString().substring(0,10)",
  "toJSON().slice":             "  const k = d.toJSON().slice(0,10)",
  "getUTC* parts":              "  const k = `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`",
  "epoch /86400000 bucket":     "  const day = Math.floor(d.getTime()/86400000)",
  "toLocaleDateString no tz":   "  const k = d.toLocaleDateString('en-CA')",
  "toLocaleString no tz":       "  const k = d.toLocaleString('en-CA')",
  "Intl.DateTimeFormat no tz":  "  const k = new Intl.DateTimeFormat('en-CA').format(d)",
  "setDate(+1) shift":          "  d.setDate(d.getDate() + 1)",
  "setUTCDate(+1) shift":       "  d.setUTCDate(d.getUTCDate() + 1)",
  "new Date('YYYY-MM-DD')":     "  const d = new Date('2026-06-20')",
  "Date.parse('YYYY-MM-DD')":   "  const t = Date.parse('2026-06-20')",
  "bare local getDate key":     "  const k = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`",
}
let netMisses = 0
for (const [name, sample] of Object.entries(SHOULD_CATCH)) { if (offenders(sample).length === 0) { netMisses++; console.log("  FAIL net MISSED: " + name) } }
ok(netMisses === 0, `net fires on all ${Object.keys(SHOULD_CATCH).length} CC anti-patterns`)
// canonical usage must NOT trip; the EXEMPT tags must neutralize a flagged line
ok(offenders("  const gd = calendarDateForTimestamp(ms)").length === 0, "canonical calendarDateForTimestamp line does not trip the net")
ok(/date-arith-ok|display-ok/.test("x // date-arith-ok") && EXEMPT.test("x.setUTCDate(1) // date-arith-ok"), "EXEMPT allowlist (date-arith-ok/display-ok) neutralizes a flagged line")

console.log(`verifyGameDateDiscipline: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) process.exit(1)
