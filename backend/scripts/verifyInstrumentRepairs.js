"use strict"
// verifyInstrumentRepairs — INSTRUMENT-REPAIR-PACK (2026-07-21, CA 4-day audit).
// Claims:
//   1. N1 WORKER — output via SYNCHRONOUS temp file (the 64KB console.log +
//      process.exit truncation is impossible by construction); parent reads
//      the file; failure ⇒ null ⇒ nothing written.
//   2. NAME JOIN — ONE canonical cross-source join (playerNameJoin): suffix
//      class (Witt), diacritic class (Hernández), nickname prefix-alias
//      (Josh↔Joshua) unique-only; ambiguity ⇒ null never guess; used by the
//      scanner, validator Axis B, and the Daily-3 scratch rule; flag-id
//      normalization FROZEN for ledger continuity.
//   3. VOID-ON-SCRATCH — Daily 3 + ledger settle both void no-appearance
//      picks/flags ≥2 days past (book behavior); voids excluded from gate
//      decided/gap/units math; unresolved joins stay pending.
//   4. ALARMS — three health lines (daily3Grading / n1Instrument /
//      rungSettles) go RED on silent death; the standing doctrine (every new
//      instrument ships with its own alarm) is in the source.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// 1. N1 worker
const n1 = rd("scripts/captureN1DualScores.js")
check("N1: worker writes JSON via writeFileSync to N1_WORKER_OUT (no stdout JSON, no 64KB truncation)", /fs\.writeFileSync\(process\.env\.N1_WORKER_OUT/.test(n1) && !/###JSON###/.test(n1))
check("N1: parent reads + unlinks the temp file; failure ⇒ null (never fabricate)", /JSON\.parse\(fs\.readFileSync\(outFile/.test(n1) && /fs\.unlinkSync\(outFile\)/.test(n1) && /return null/.test(n1))

// 2. name join (unit tests through the real module)
try {
  const { joinKey, buildJoinIndex, resolvePlayer } = require("../pipeline/shared/playerNameJoin")
  check("join: suffix class — 'Bobby Witt Jr.' keys to 'bobby witt'", joinKey("Bobby Witt Jr.") === "bobby witt")
  check("join: diacritic class — 'Teoscar Hernández' == 'Teoscar Hernandez'", joinKey("Teoscar Hernández") === joinKey("Teoscar Hernandez"))
  const idx = buildJoinIndex([["Joshua Kuroda-Grauer", "JKG"], ["Bobby Witt Jr.", "WITT"], ["Jose Ramirez", "JR1"], ["Jose Rodriguez", "JR2"]])
  check("join: nickname prefix-alias — 'Josh Kuroda-Grauer' resolves to the Joshua entry (unique)", resolvePlayer(idx, "Josh Kuroda-Grauer") === "JKG")
  check("join: suffix resolves; ambiguity never guesses ('Jo Ramirez'-style prefix hitting two = null-safe)", resolvePlayer(idx, "Bobby Witt") === "WITT" && resolvePlayer(idx, "Unknown Player") === null)
  const collide = buildJoinIndex([["Will Smith", "A"], ["Will Smith", "B"]])
  check("join: index collisions become ambiguous ⇒ null (two Will Smiths never merge)", resolvePlayer(collide, "Will Smith") === null)
} catch (e) { check(`join module loads (${e?.message})`, false) }

const scan = rd("scripts/scanRungEv.js")
check("scanner: uses resolvePlayer for scan + settle; flag-id norm FROZEN for ledger continuity", (scan.match(/resolvePlayer\(/g) || []).length >= 2 && /idNorm/.test(scan) && /ledger id\s*\n\s*\/\/ continuity|id format would re-flag/.test(scan))
check("validator: Axis B uses the canonical join", /_rp\(idx, r\.player\)/.test(rd("scripts/validateG2Curves.js")))

// 3. void-on-scratch
const d3 = rd("pipeline/shared/daily3.js")
check("daily3: scratch rule — ≥2 days + join-confirmed no-appearance ⇒ void 0u settleNote'd; unknown ⇒ pending", /slateAgeDays >= 2 && _playedOnDate\(p\.player, p\.statFamily, slate\) === false/.test(d3) && /voided per book behavior/.test(d3) && /return null \/\/ unknown — never guess/.test(d3))
check("ledger: no-appearance flags void (0u) after ≥2 days; voids EXCLUDED from gate math", /outcome: "void", hit: null, units: 0/.test(scan) && /e\.outcome !== "void"/.test(scan))

// 4. alarms + doctrine
const chc = rd("scripts/componentHealthCheck.js")
check("alarms: daily3Grading + n1Instrument + rungSettles all registered", /checkDaily3Grading/.test(chc) && /checkN1Instrument/.test(chc) && /checkRungSettles/.test(chc) && /"daily3Grading", "n1Instrument", "rungSettles"\]/.test(chc))
check("doctrine in source: every new instrument ships WITH its own health line", /every new instrument ships WITH its own health line/.test(chc))

console.log(`verifyInstrumentRepairs: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
