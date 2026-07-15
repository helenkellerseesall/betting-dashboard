"use strict"
// verifyHonestComms — BREAK-WINDOW Part 1 (2026-07-14, All-Star-night incident).
//   (a) empty boards SAY WHY: /top-picks boardState classifier (off_season /
//       no_games+next-slate / zero_edge / build_missing-alert), evidence via the
//       ONE slateGamesEvidence authority; FE renders the reasons, alert-labeled.
//   (b) boardServeParity watchdog: record-has-rows + served-empty without a
//       stated reason = FAIL (live local endpoint, real e2e).
//   (c) slate-fire recovery is GAMES-AWARE: break-day failures are info (gated
//       runs log nothing ⇒ could never "recover"), game-day failures stay RED.
//   (d) TZ audit fix: recentDateKeys (both sports) uses the canonical slate-date
//       helper, never UTC truncation.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const ws = rd("routes/workstationRoutes.js")
check("(a) boardState classifier on /top-picks with the 4 distinct states", /boardState: \(\(\) => \{/.test(ws) && /state: "no_games"/.test(ws) && /state: "zero_edge"/.test(ws) && /state: "build_missing"/.test(ws) && /state: "off_season"/.test(ws))
check("(a) classification uses the ONE games-evidence authority (Law 1)", /slateGamesEvidence"\)/.test(ws) && /countSnapshotEventsForSlate\(sp, date\)/.test(ws))
check("(a) build_missing is alertable; classifier failure is alertable (never silent)", /alert: true, snapEvents/.test(ws) && /boardState classification failed/.test(ws))
check("(a) next-slate hint honest-null when unknown", /next slate date unknown until books post it/.test(ws))

const fe = rd("../frontend/mobile/index.html")
check("(a-FE) empty board renders the server's stated reasons; missing boardState is itself called a bug", /d\.boardState \|\| null/.test(fe) && /the server gave no reason \(that itself is a bug/.test(fe))

const chc = rd("scripts/componentHealthCheck.js")
check("(b) boardServeParity watchdog: live endpoint, divergence = FAIL, honest-empty = green", /checkBoardServeParity/.test(chc) && /divergence/.test(chc) && /Board honestly empty with stated reason/.test(chc) && /"boardServeParity"\]/.test(chc))

const sr = rd("routes/statusRoute.js")
check("(c) slate-fire recovery is games-aware (break failures = info, game-day = RED)", /gamesTodayForSport > 0/.test(sr) && /no games on this slate \(break\/off-day\)/.test(sr) && /auto-clears when games return/.test(sr))

const mlbT = rd("pipeline/mlb/phase4Tracking.js"), nbaT = rd("pipeline/nba/buildNbaPerformanceTracking.js")
check("(d) recentDateKeys TZ fix in BOTH sports (canonical slate-date, UTC truncation gone)", /slateDateForTimestamp\(nowMs - i \* 24 \* 3600 \* 1000\)/.test(mlbT) && /slateDateForTimestamp\(nowMs - i \* 24 \* 3600 \* 1000\)/.test(nbaT) && !/toISOString\(\)\.slice\(0, 10\)/.test(mlbT) && !/toISOString\(\)\.slice\(0, 10\)/.test(nbaT))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyHonestComms: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
