#!/usr/bin/env node
"use strict"

/**
 * verifySlateGamesControl.js — Phase Status-CLV-Display-Honesty-1A (2026-06-05)
 *
 * Wired into runtime:verify SUITES → runs on EVERY commit via the pre-commit hook.
 * This is the permanent control that the /status CLV card can never again say
 * "no games today" while real games happened (the 2026-06-05 fake-green).
 *
 * It exercises the SHARED classifier (pipeline/shared/slateGamesEvidence) — the exact
 * one the card uses — against a curation-INDEPENDENT source (the odds snapshot) plus
 * the durable ledger + tracked_best, for the current slate. It also self-tests that the
 * honesty guard actually FIRES on a synthetic bad case, so the control cannot silently
 * rot into a fake-green like the logic it replaced (req 6).
 *
 *   node scripts/verifySlateGamesControl.js              # real check + self-test (exit 0 expected)
 *   node scripts/verifySlateGamesControl.js --demo-fail  # inject a real lie → exit 1 (proves the gate blocks)
 *
 * Exit 0 = PASS, non-zero = FAIL (runtimeVerify contract).
 */

const fs = require("fs")
const path = require("path")
const ev = require(path.join(__dirname, "..", "pipeline", "shared", "slateGamesEvidence"))
const { currentSlateDateEt } = require(path.join(__dirname, "..", "pipeline", "shared", "slateDate"))

const LEDGER = path.join(__dirname, "..", "runtime", "tracking", "personal_ledger.json")
const fails = []
const log = (s) => console.log(s)

// ── PART 1: self-test — the guard MUST fire on a synthetic lie (anti-fake-green, req 6)
const guard = ev.assertCardHonest("off_day", { snapshotEvents: 5, ledgerEvents: 0, trackedBestEntries: 0 })
if (guard.ok) {
  console.error("SELF-TEST FAIL: honesty guard did NOT fire on off_day-with-5-games — control is a fake-green")
  fails.push("self-test-guard")
} else {
  log("SELF-TEST OK: honesty guard correctly FIRES on synthetic lie → " + guard.reason)
}
for (const [inp, want] of [
  [{ snapshotEvents: 0, ledgerEvents: 0, trackedBestEntries: 0 }, "off_day"],
  [{ snapshotEvents: 5, ledgerEvents: 0, trackedBestEntries: 0 }, "curation_gap"],
  [{ snapshotEvents: 0, ledgerEvents: 26, trackedBestEntries: 295 }, "normal"],
]) {
  const got = ev.classifySlateState(inp)
  if (got !== want) { console.error(`SELF-TEST FAIL: classify(${JSON.stringify(inp)}) = ${got}, want ${want}`); fails.push("classify") }
  else log(`SELF-TEST OK: classify(${JSON.stringify(inp)}) = ${got}`)
}

// ── PART 2: real current slate — classify from INDEPENDENT evidence, assert honest
const slate = currentSlateDateEt()
let ledgerEntries = []
try { const l = JSON.parse(fs.readFileSync(LEDGER, "utf8")); ledgerEntries = Array.isArray(l) ? l : (l.entries || l.bets || []) } catch (_) {}
const demoFail = process.argv.includes("--demo-fail")
for (const sport of ["nba", "mlb"]) {
  const snap = ev.countSnapshotEventsForSlate(sport, slate).total
  const tb   = ev.countTrackedBestEntries(sport, slate)
  const ledgerEvents = new Set(
    ledgerEntries.filter(e => String(e.sport || "").toLowerCase() === sport && e.date === slate && e.eventId != null).map(e => e.eventId)
  ).size
  let state = ev.classifySlateState({ snapshotEvents: snap, ledgerEvents, trackedBestEntries: tb })
  if (demoFail) state = "off_day"  // inject a real lie to prove the gate blocks a card that lies
  const honest = ev.assertCardHonest(state, { snapshotEvents: snap, ledgerEvents, trackedBestEntries: tb })
  log(`REAL ${sport} slate=${slate}: snapshot=${snap} ledger=${ledgerEvents} trackedBest=${tb} → state=${state} honest=${honest.ok}${honest.ok ? "" : "  (" + honest.reason + ")"}`)
  if (!honest.ok) fails.push(`real-${sport}`)
}

if (fails.length) { console.error("RESULT: FAIL (" + fails.join(", ") + ")"); process.exit(1) }
log("RESULT: PASS"); process.exit(0)
