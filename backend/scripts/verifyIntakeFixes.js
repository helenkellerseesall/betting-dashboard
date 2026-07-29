"use strict"
// verifyIntakeFixes — INTAKE-FIXES (2026-07-29, ASK 147e814; the operator's
// 1:56 AM FanDuel Ks parlay, rejected twice): calendar-ET future check +
// stat alias map at the ONE validation owner + FE ingest normalization.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const apb = require("./addPlacedBet")

// ── FIX 1: the 1:58 AM window, pinned exactly ──
// Scenario: calendar ET is 2026-07-29 at 01:58 AM; the slate day is still
// 2026-07-28. A slip dated 7/29 is a REAL bet; 7/30 is a time traveler.
check("window pin: slip dated calendar-today is NOT future even while the slate lags a day",
  apb.isFutureBetDate("2026-07-29", "2026-07-29") === false &&
  apb.isFutureBetDate("2026-07-28", "2026-07-29") === false &&
  apb.isFutureBetDate("2026-07-30", "2026-07-29") === true)
// calendarDateEt: real clock, ET calendar (no 4 AM boundary): a fixed
// timestamp at 06:00 UTC = 02:00 ET renders as that calendar day, where the
// slate helper would still say the PRIOR day. 2026-07-29T06:00:00Z = 2:00 AM ET.
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")
check("calendarDateEt: 2:00 AM ET reads as the true calendar day (2026-07-29), no slate boundary",
  apb.calendarDateEt(Date.parse("2026-07-29T06:00:00Z")) === "2026-07-29")
check("cores: both future checks route through isFutureBetDate (no bare slate compare left)",
  (rd("scripts/addPlacedBet.js").match(/isFutureBetDate\(d\)/g) || []).length === 2 &&
  !/d > todayEt\) return \{ ok: false, error: `--date/.test(rd("scripts/addPlacedBet.js")))
check("defaults untouched: no explicit date still means the SLATE day (slate stays authoritative)",
  /let today = todayEt/.test(rd("scripts/addPlacedBet.js")) && typeof currentSlateDateEt() === "string")

// ── FIX 2: alias map at the one owner ──
const CASES = { "Strikeouts": "ks", "strikeouts": "ks", "Total Bases": "totalBases", "total_bases": "totalBases", "Home Runs": "hr", "RBIs": "rbis", "RBI": "rbis", "Runs Scored": "runs", "Earned Runs": "earnedRuns", "Hits Allowed": "hitsAllowed", "Walks": "walks", "BB": "walks", "Hits": "hits", "pitcher_strikeouts": "ks" }
check("alias table exact: every display/snake/abbrev form lands on its canonical token",
  Object.entries(CASES).every(([inp, want]) => apb.canonMlbStat(inp) === want))
check("canonical tokens still pass byte-exact + unknown names STILL FAIL HONESTLY",
  apb.MLB_STAT_TOKENS.every((t) => apb.canonMlbStat(t) === t) &&
  apb.canonMlbStat("Points") === null && apb.canonMlbStat("Stolen Bases") === null && apb.canonMlbStat("") === null)

// ── e2e: the operator's exact rejection class through the REAL CLI (dry) ──
// A pitcher-Ks leg with the display name "Strikeouts" must now validate; an
// unknown stat must still reject. --dry-run: zero ledger writes.
const env = { ...process.env }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "addPlacedBet.js"), "single", "--dry-run", "--sport=mlb", "--book=fanduel", "--player=Test Pitcher", "--stat=Strikeouts", "--side=over", "--line=5.5", "--odds=-120", "--stake=1"], { env, encoding: "utf8", timeout: 30000 })
const out1 = (r1.stdout || "") + (r1.stderr || "")
check(`e2e dry: --stat="Strikeouts" validates as ks (exit ${r1.status})`, r1.status === 0 && /statFamily['":\s]+['"]?ks|ks over 5\.5/.test(out1) && !/not a canonical MLB token/.test(out1))
const r2 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "addPlacedBet.js"), "single", "--dry-run", "--sport=mlb", "--book=fanduel", "--player=Test Batter", "--stat=Stolen Bases", "--side=over", "--line=0.5", "--odds=200", "--stake=1"], { env, encoding: "utf8", timeout: 30000 })
check("e2e dry: unknown stat (Stolen Bases — not in the record vocabulary) still rejects loudly", r2.status !== 0 && /not a canonical MLB token/.test((r2.stdout || "") + (r2.stderr || "")))

// ── lookup-date pin (CA's third ask): the calendar-dated bet joins ITS OWN slate file ──
check("lookup keys on the bet's date file (game-date-keyed since night-owl 07-16) — no change was needed",
  /mlb_tracked_bets_\$\{date\}\.json/.test(rd("scripts/addPlacedBet.js")))

// ── FE ingest normalization ──
const fe = rd("../frontend/mobile/index.html")
check("FE record flow: legs normalized to canonical tokens AT INGEST (confirm modal shows what validates); unknown passes through for human correction; backend stays the ONE validator",
  /_srCanonStat/.test(fe) && /propType: _srCanonStat\(l\.propType\)/.test(fe) && /display courtesy, not a second validator/.test(fe) && /MAP\[norm\] \|\| v/.test(fe))
check("FE analyze-tab display map untouched (different surface — display-only)", /\[\/\\bstrikeouts\?\\b\|\\bks\?\\b\/i, "Strikeouts"\]/.test(fe))

const rv = rd("scripts/runtimeVerify.js")
check("matrix: verifyIntakeFixes registered", /"verifyIntakeFixes"/.test(rv))

console.log(`verifyIntakeFixes: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
