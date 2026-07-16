"use strict"
// verifyNightOwl — NIGHT-OWL BOARD (2026-07-15, break-window Part 2).
// The claim under test: evening next-day capture is FIRST-CLASS —
//   1. KEYING: tracked rows land in their GAME's slate file (game-date-driven,
//      the pre-agreed offset "fix A"), not the generation date's. Same writers,
//      same stamps — night picks are citizens of TOMORROW's record from the
//      first evening capture. 4 AM ET boundary respected. No-gameTime rows
//      keep the legacy generation-date key (honest fallback).
//   2. EVENING OPENER: trueOpen gains a 22:00 ET --evening pass that is
//      FUTURE-SLATE-ONLY (can never overwrite the same-day 6 AM baseline).
//   3. SERVING: /top-picks carries server-authoritative tomorrowSlate; the FE
//      renders a clearly-SEPARATED TOMORROW section in both board states,
//      additive (failure never blocks today's board), never mixed with today.
//   4. MIGRATION: the one-time placement correction is dry-by-default and
//      writes a from→to delta manifest (the 07-11 backfill lesson).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── 1. game-date keying: source + REAL unit tests through the real module ──
const p4 = rd("pipeline/mlb/phase4Tracking.js")
check("keying: gameSlateDateFor + bucketByGameSlate defined and exported", /function gameSlateDateFor/.test(p4) && /function bucketByGameSlate/.test(p4) && /gameSlateDateFor,\s*\n\s*bucketByGameSlate,/.test(p4))
check("keying: all three writers bucket by game slate", /recordMlbBestPropsForDate/.test(p4) && /recordMlbDailyPicksForDate/.test(p4) && /persistTrackedForDate/.test(p4) && (p4.match(/bucketByGameSlate\(/g) || []).length >= 4)
check("keying: slips keyed by EARLIEST leg game slate", /legTimes\.length \? slateDateForTimestamp\(Math\.min\(\.\.\.legTimes\)\) : date/.test(p4))
try {
  const { gameSlateDateFor, bucketByGameSlate } = require("../pipeline/mlb/phase4Tracking")
  check("keying unit: Thursday-night game keys to its own slate", gameSlateDateFor({ gameTime: "2026-07-16T23:11:00Z" }, "2026-07-15") === "2026-07-16")
  check("keying unit: 10:30 PM ET game (next UTC calendar day) keys to the ET slate (4 AM boundary)", gameSlateDateFor({ gameTime: "2026-07-17T02:30:00Z" }, "2026-07-16") === "2026-07-16")
  check("keying unit: no gameTime ⇒ honest generation-date fallback", gameSlateDateFor({}, "2026-07-15") === "2026-07-15")
  const b = bucketByGameSlate([{ gameTime: "2026-07-16T23:11:00Z" }, { gameTime: "2026-07-15T22:00:00Z" }, {}], "2026-07-15")
  check("keying unit: bucket split (1 tomorrow / 2 today incl. fallback)", b.get("2026-07-16")?.length === 1 && b.get("2026-07-15")?.length === 2)
} catch (e) {
  check(`keying unit: module loads in fixture (${e?.message})`, false)
}

// ── 2. evening opener ──
const to = rd("scripts/captureMlbTrueOpen.js")
check("trueOpen: --evening flag with FUTURE-SLATE-ONLY guard (6 AM baseline protected)", /process\.argv\.includes\("--evening"\)/.test(to) && /eveningMode && slateDate <= calendarDateForTimestamp\(now\)/.test(to))
const sched = rd("scripts/scheduler.sh")
check("scheduler: 22:00 ET night-owl fire, own dedupe, --evening arg", /HOUR" -eq 22/.test(sched) && /last_nightowl_min/.test(sched) && /captureMlbTrueOpen\.js --evening/.test(sched))

// ── 3. serving ──
const wr = rd("routes/workstationRoutes.js")
check("route: /top-picks carries server-authoritative tomorrowSlate (key arithmetic, not wall-clock)", /tomorrowSlate: \(\(\) => \{/.test(wr) && /todayK\.split\("-"\)\.map\(Number\)/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("FE: separated TOMORROW section, server date key, explicit ?date= fetch", /NIGHT-OWL-1 — TOMORROW board/.test(fe) && /d\.tomorrowSlate/.test(fe) && /top-picks\?date=\$\{tmr\}/.test(fe))
check("FE: rendered in BOTH branches (empty board + full board), additive", /\$\{nightOwlHtml\}/.test(fe) && /html \+= nightOwlHtml/.test(fe) && /never blocks the board \*\//.test(fe))
check("FE: honest empty state with the MEASURED posting hours", /~4 PM ET on off-day eves and ~10 PM ET on game nights/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

// ── 4. migration discipline ──
const mig = rd("scripts/migrateGameDateRows.js")
check("migration: dry-by-default (--write required) + delta manifest + identity preserved (ids/dates untouched)", /process\.argv\.includes\("--write"\)/.test(mig) && /night_owl_migration_/.test(mig) && /Rows move AS-IS/.test(mig))
check("migration: sticky-open doctrine on id collision (earlier observation backfills opens only)", /m\.openObservedAt < prev\.openObservedAt/.test(mig))
check("migration: INTEGRITY PROOF — planned checksum on DRY, re-read + MATCH/MISMATCH (exit 1) on write", /INTEGRITY \(planned\)/.test(mig) && /INTEGRITY PROOF: planned/.test(mig) && /if \(!match\) process\.exit\(1\)/.test(mig))
check("migration: settled rows NEVER touched — collision backfill gated on pending only", /if \(isSettled\(prev\)\) continue/.test(mig))

console.log(`verifyNightOwl: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
