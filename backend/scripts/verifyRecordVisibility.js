"use strict"
// verifyRecordVisibility — OPERATOR TRIPLE (2026-07-28): lifetime MY BETS +
// parlay auto-settle + weekly surface audit + the consequence-set doctrine.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const wr = rd("routes/workstationRoutes.js")
check("lifetime lens: 14-day window REMOVED, doctrine in source, windowDays='lifetime'", /LIFETIME — the record never ages out of its own surface/.test(wr) && !/b\.date >= windowKey/.test(wr) && /windowDays: "lifetime"/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("FE: history collapse (never hidden, never aged out) + shared card renderer", /_betCardHtml/.test(fe) && /History — \$\{oldBets\.length\} older bet/.test(fe) && /full record, never aged out/.test(fe))
const chc = rd("scripts/componentHealthCheck.js")
check("alarms: betsSurfaceParity + parlaySettle registered (boardServeParity pattern)", /checkBetsParity/.test(chc) && /checkParlaySettle/.test(chc) && /"betsSurfaceParity"/.test(chc) && /"parlaySettle"/.test(chc) && /never age out of its surface/.test(chc))

const ps = rd("scripts/settleParlaysFromRecord.js")
check("parlay settle: tuple-join book-agnostic, pending-never-guessed, all-win/any-loss rules", /book-agnostic/.test(ps) && /never guessed/.test(ps) && /liveResults\.includes\("loss"\)/.test(ps)) // short anchor — doc phrase wraps lines
check("parlay settle: void = drop-and-recompute w/ per-leg prices, else DEFER to manual (never fabricate)", /drop-and-recompute NEEDS per-leg prices; absent ⇒ manual/.test(ps) && /deferred to manual settle \(never fabricated\)/.test(ps) && /GRADING_RULES v2 §10/.test(ps))
check("parlay settle: clean all-win pays from the ticket's COMBINED odds; write-once w/ settleNote provenance", /COMBINED odds are the book truth/.test(ps) && /auto-settled from record/.test(ps))
check("rider: manual leg settle triggers immediate parlay re-attempt", /PARLAY rider/.test(rd("pipeline/mlb/phase4Tracking.js")))
const sched = rd("scripts/scheduler.sh")
check("wiring: 05:35 parlay settle + Sunday 05:55 surface audit", /MIN" -eq 35 \] && \[ "\$HOUR" -eq 5/.test(sched) && /last_parlaysettle_min/.test(sched) && /weeklySurfaceAudit/.test(sched))
const wa = rd("scripts/weeklySurfaceAudit.js")
check("surface audit: all five surfaces walked vs record truth + QA-by-design doctrine", /MY BETS/.test(wa) && /TOP PICKS/.test(wa) && /DAILY 3/.test(wa) && /LADDER LAB/.test(wa) && /\/status/.test(wa) && /QA department by design, not luck/.test(wa))

// unit e2e: parlay settle math on tmp ledger
const os = require("os")
const { spawnSync } = require("child_process")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rv-"))
const track = path.join(tmp, "t"); fs.mkdirSync(track)
fs.writeFileSync(path.join(track, "personal_ledger.json"), JSON.stringify({ bets: [
  { id: "p1", betType: "parlay", realMoney: true, result: "pending", date: "2026-07-20", stake: 2, odds: 116, legs: [{ player: "A B", statFamily: "hits", side: "under", line: 1.5 }, { player: "C D", statFamily: "hits", side: "under", line: 1.5 }] },
  { id: "p2", betType: "parlay", realMoney: true, result: "pending", date: "2026-07-20", stake: 5, odds: 200, legs: [{ player: "A B", statFamily: "hits", side: "under", line: 1.5 }, { player: "E F", statFamily: "hits", side: "under", line: 1.5 }] },
] }))
fs.writeFileSync(path.join(track, "mlb_tracked_bets_2026-07-20.json"), JSON.stringify([
  { player: "A B", statFamily: "hits", side: "under", line: 1.5, result: "win" },
  { player: "C D", statFamily: "hits", side: "under", line: 1.5, result: "win" },
  { player: "E F", statFamily: "hits", side: "under", line: 1.5, result: "loss" },
]))
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env: { ...process.env, PS_TRACKING_DIR: track, PS_LEDGER: path.join(track, "personal_ledger.json") }, encoding: "utf8", timeout: 60000 })
const after = JSON.parse(fs.readFileSync(path.join(track, "personal_ledger.json"), "utf8")).bets
check(`e2e: all-win parlay WIN at combined odds ($2 @ +116 ⇒ 4.32) w/ leg stamps (${r.status})`, r.status === 0 && after[0].result === "win" && Math.abs(after[0].payout - 4.32) < 0.001 && after[0].legs.every((l) => l.result === "win"))
check("e2e: any-loss parlay LOSS payout 0 + settleNote provenance", after[1].result === "loss" && after[1].payout === 0 && /auto-settled from record/.test(after[1].settleNote))

console.log(`verifyRecordVisibility: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
