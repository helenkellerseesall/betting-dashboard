"use strict"
// verifyDaily3 — THE DAILY 3 (2026-07-14, break-window Part 3). The public-
// record seed — integrity guards:
//   1. LOCK: write-once (existing file ⇒ no-op, race-guarded), first-pitch−60min
//      window, NO card once the pitch passes unlocked, lockLate stamped, picks
//      from the SERVED lens (self-HTTP to /top-picks — the exact operator view).
//   2. GRADE: write-once results, EXISTING nightly only (tuple join on graded
//      tracked rows), grades only when all picks decided, flat-$1 units math.
//   3. READ: honest aggregates — net units shown WITH win rate (win rate alone
//      lies), small-sample label under 30 decided.
//   4. Wiring: server minute-tick + runHistoricalGrade hook + /api/ws/daily3 +
//      FE card above the board (failure never blocks the board).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const d3 = rd("pipeline/shared/daily3.js")
check("lock: write-once + race guard (existing file ⇒ never rewritten)", /if \(fs\.existsSync\(fp\)\) return \/\/ IMMUTABLE/.test(d3) && /if \(fs\.existsSync\(fp\)\) return \/\/ race guard/.test(d3))
check("lock: first-pitch−60min window; pitch passed unlocked ⇒ NO card (integrity)", /now < pitch - 60 \* 60000/.test(d3) && /if \(now >= pitch\) return \/\/ first pitch passed unlocked/.test(d3))
check("lock: picks from the SERVED lens (self-HTTP /top-picks) + lockLate stamped", /api\/ws\/top-picks\?limit=10/.test(d3) && /lockLate: now > pitch - 55 \* 60000/.test(d3))
check("lock: first-pitch source = tracked_best PRIMARY (started games persist; snapshot events drop them) + snapshot fallback", /mlb_tracked_best_\$\{slate\}\.json/.test(d3) && d3.indexOf("mlb_tracked_best_") < d3.indexOf("snapshot-mlb.json"))
check("grade: write-once + existing-nightly-only + complete-or-wait", /if \(card\.results\) return \{ skipped: "already_graded" \}/.test(d3) && /picks_still_pending/.test(d3))
check("grade: flat-$1 units math (win=+american profit, loss=−1, push/void=0)", /res === "win" \? unitProfit\(p\.odds\) : res === "loss" \? -1 : 0/.test(d3))
// units math unit-tests (pure)
const { unitProfit } = require("../pipeline/shared/daily3")
check("unitProfit: +150 ⇒ +1.5 · −110 ⇒ +0.909 · junk ⇒ 0", unitProfit(150) === 1.5 && Math.abs(unitProfit(-110) - 0.9091) < 0.001 && unitProfit(null) === 0)
check("read: net units WITH win rate + small-sample honesty under 30 decided", /smallSample: decided < 30/.test(d3) && /not yet meaningful/.test(d3))

check("wiring: server 1-min lock tick", /maybeLockDaily3, 60 \* 1000/.test(rd("server.js")))
check("wiring: nightly grade hook (mlb, non-dry)", /gradeDaily3\(date\)/.test(rd("scripts/runHistoricalGrade.js")))
check("wiring: GET /api/ws/daily3 read-only route", /router\.get\("\/daily3"/.test(rd("routes/workstationRoutes.js")))
const fe = rd("../frontend/mobile/index.html")
check("FE: DAILY 3 card above the board; failure never blocks the board; units + record line", /THE DAILY 3/.test(fe) && /daily3 card is additive — its failure never blocks the board/.test(fe) && /at flat \$1/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyDaily3: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
