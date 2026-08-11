"use strict"
// verifyOddsUsage — ODDS-QUOTA LEDGER (2026-08-11, GO on ASK 63f24e4):
// quota-header capture (axios + fetch shapes) · fail-open doctrine · wrapper
// capture · tail-window ET rollup math · all 8 call-site files wired ·
// /status line. Hermetic via ODDS_API_LOG_DIR.
const fs = require("fs")
const os = require("os")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oq-"))
process.env.ODDS_API_LOG_DIR = tmp // must precede the require — module binds LOG_DIR at load
const L = require("../pipeline/shared/apiCallLogger")

L.logOddsUsage({ "x-requests-used": "18804", "x-requests-remaining": "1196" }, { sport: "mlb", endpoint: "odds-api/t1", caller: "fx" })
L.logOddsUsage({ get: (k) => (k === "x-requests-used" ? "18805" : k === "x-requests-remaining" ? "1195" : null) }, { endpoint: "odds-api/t2" })
let threw = false
try { L.logOddsUsage(null, { endpoint: "odds-api/t3" }); L.logOddsUsage({ "x-requests-used": "not-a-number" }, { endpoint: "odds-api/t4" }) } catch (_) { threw = true }
const lines = fs.readFileSync(path.join(tmp, "api_call_log.jsonl"), "utf8").trim().split("\n").map((x) => JSON.parse(x))
check("capture: axios-shape AND fetch-shape headers land used/remaining as numbers",
  lines[0].used === 18804 && lines[0].remaining === 1196 && lines[1].used === 18805 && lines[1].remaining === 1195)
check("fail-open: null + garbage headers never throw; entries still land, quota fields honestly absent",
  threw === false && lines.length === 4 && lines[2].used === undefined && lines[3].used === undefined)
check("caller provenance rides the entry", lines[0].caller === "fx")

;(async () => {
  await L.logApiCallAsync({ sport: "nba", endpoint: "odds-api/t5" }, async () => ({ status: 200, headers: { "x-requests-used": "18806", "x-requests-remaining": "1194" } }))
  const l5 = fs.readFileSync(path.join(tmp, "api_call_log.jsonl"), "utf8").trim().split("\n").map((x) => JSON.parse(x))
  check("wrapper: logApiCallAsync captures quota from the response it already sees (the 2 wrapped files wire for free)",
    l5[4].used === 18806 && l5[4].remaining === 1194 && l5[4].httpStatus === 200)

  const mk = (ts, remaining) => JSON.stringify({ ts, sport: "mlb", endpoint: "odds-api/x", status: "ok", durationMs: 5, used: 20000 - remaining, remaining })
  const rows = []
  for (let i = 0; i < 2; i++) rows.push(mk("2026-08-08T12:0" + i + ":00Z", 5000 - i))
  for (let i = 0; i < 4; i++) rows.push(mk("2026-08-09T12:0" + i + ":00Z", 4000 - i))
  for (let i = 0; i < 6; i++) rows.push(mk("2026-08-10T12:0" + i + ":00Z", 3000 - i))
  fs.writeFileSync(path.join(tmp, "api_call_log.jsonl"), rows.join("\n") + "\n")
  const roll = L.readOddsUsageRollup()
  check("rollup: per-ET-day counts exact (2/4/6) + newest remaining 2995 + honest no-backfill window note",
    roll.ok && roll.days.find((d) => d.date === "2026-08-08").calls === 2 && roll.days.find((d) => d.date === "2026-08-09").calls === 4 && roll.days.find((d) => d.date === "2026-08-10").calls === 6 && roll.latest.remaining === 2995 && /after 2026-08-11/.test(roll.windowNote))
  check("rollup: trailing-7-ET-day avg excludes today, projection = avg x30 ((2+4+6)/3 = 4 ⇒ 120/mo)",
    roll.avg7DailyCalls === 4 && roll.projectedMonthlyCalls === 120)
  fs.writeFileSync(path.join(tmp, "api_call_log.jsonl"), "")
  check("rollup: empty log ⇒ ok:false with named reason, never fabricated zeros", L.readOddsUsageRollup().ok === false)

  for (const [f, marker] of [
    ["server.js", "server.nbaOddsBase"],
    ["scripts/captureMlbLadders.js", "odds-api/events/odds/ladders"],
    ["scripts/captureMlbTrueOpen.js", "odds-api/events/odds/true-open"],
    ["pipeline/schedule/buildSlateEvents.js", "buildSlateEvents"],
    ["pipeline/schedule/buildMlbSlateEvents.js", "buildMlbSlateEvents"],
    ["pipeline/shared/pinnacleBenchmark.js", "pinnacle-eu"],
  ]) check("wired: " + f, rd(f).includes("logOddsUsage") && rd(f).includes(marker))
  check("wrapper files covered: fetchNbaOddsSnapshot + buildMlbBootstrapSnapshot route via logApiCallAsync which now captures quota",
    /logApiCallAsync/.test(rd("pipeline/nba/fetchNbaOddsSnapshot.js")) && /logApiCallAsync/.test(rd("pipeline/mlb/buildMlbBootstrapSnapshot.js")) && /quotaFromHeaders\(res\?\.headers\)/.test(rd("pipeline/shared/apiCallLogger.js")))
  check("retry paths logged too (ladders-retry + true-open-retry — quota burns on retries as well)",
    rd("scripts/captureMlbLadders.js").includes("ladders-retry") && rd("scripts/captureMlbTrueOpen.js").includes("true-open-retry"))
  const sr = rd("routes/statusRoute.js")
  check("/status: sectionOddsApiUsage wired into BOTH payload call sites + tail-window doctrine stated",
    (sr.match(/out\.oddsApiUsage {6}= sectionOddsApiUsage\(\)/g) || []).length === 2 && /never the whole log/.test(sr))
  check("matrix: verifyOddsUsage registered", /"verifyOddsUsage"/.test(rd("scripts/runtimeVerify.js")))

  console.log(`verifyOddsUsage: ${pass}/${pass + fail} checks PASS`)
  if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
  process.exit(0)
})()
