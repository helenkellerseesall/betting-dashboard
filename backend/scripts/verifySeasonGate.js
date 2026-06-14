"use strict"
// verifySeasonGate — Phase Season-Switch-1A regression fixture.
//
// Verifies the per-sport season switch (operator-approved 2026-06-14):
//   1. seasonGate.isSportEnabled reads seasonsActive.json FRESH each call
//      (value flips within one process → no require-cache).
//   2. FAIL-OPEN: garbled JSON, missing sport key, missing file, and unknown
//      sport all return TRUE (a config error degrades loud-and-ON, never
//      quiet-and-OFF — Law 16).
//   3. slateMlb.js / slateNba.js gate at main() BEFORE any network call
//      (gate guard index < first `await step(` index — source assertion, so the
//      fixture never spawns a real slate against a live backend).
//   4. scheduler.sh gates exactly the 6 NBA + 3 MLB populator/injury blocks via
//      sport_on, and does NOT gate grading / settlement / audit / sysAudit
//      (operator-confirmed sport-agnostic).
//
// Config mutations (tests 1–2) are done fast, then the ORIGINAL bytes are
// restored and integrity-checked, so running this never changes the operator's
// real season state.

const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const GATE = path.join(ROOT, "pipeline", "shared", "seasonGate.js")
const CONFIG = path.join(ROOT, "config", "seasonsActive.json")
const SLATE_MLB = path.join(ROOT, "scripts", "slateMlb.js")
const SLATE_NBA = path.join(ROOT, "scripts", "slateNba.js")
const SCHEDULER = path.join(ROOT, "scripts", "scheduler.sh")

let pass = 0, fail = 0
const failures = []
const check = (label, cond) => { if (cond) pass++; else { fail++; failures.push(label) } }

const gate = require(GATE)

// ── backup the real config; everything that mutates it runs inside try/finally ──
const ORIG = fs.readFileSync(CONFIG, "utf8")
const writeCfg = (obj) => fs.writeFileSync(CONFIG, JSON.stringify(obj, null, 2) + "\n", "utf8")

try {
  // 1. Fresh read + value flip within ONE process (proves no require-cache).
  writeCfg({ sports: { mlb: true, nba: false, nfl: false, nhl: false } })
  check("mlb ON read", gate.isSportEnabled("mlb") === true)
  check("nba OFF read", gate.isSportEnabled("nba") === false)
  check("nfl OFF read", gate.isSportEnabled("nfl") === false)
  check("nhl OFF read", gate.isSportEnabled("nhl") === false)

  writeCfg({ sports: { mlb: false, nba: true, nfl: false, nhl: false } })
  check("mlb flips OFF (fresh read)", gate.isSportEnabled("mlb") === false)
  check("nba flips ON (fresh read)", gate.isSportEnabled("nba") === true)

  // case-insensitive + whitespace tolerant
  check("MLB upper/space tolerant", gate.isSportEnabled(" NBA ") === true)

  // 2. Fail-OPEN cases.
  check("unknown sport → fail-open true", gate.isSportEnabled("hockey") === true)

  // garbled/unreadable JSON exercises the same readConfig catch branch as a
  // missing file (ENOENT) — both → null → fail-open. (We do NOT delete the real
  // config: unlink is risky and the catch path is identical.)
  fs.writeFileSync(CONFIG, "{ this is not valid json", "utf8")
  check("garbled JSON → fail-open true", gate.isSportEnabled("mlb") === true)
  const snapBad = gate.snapshot()
  check("snapshot configReadable=false when unreadable", snapBad.configReadable === false)
  check("snapshot fails open ON when unreadable", snapBad.sports.nba === true)

  writeCfg({ sports: { mlb: true } }) // nba key absent
  check("missing sport key → fail-open true", gate.isSportEnabled("nba") === true)
  check("present key still honored alongside missing", gate.isSportEnabled("mlb") === true)

  // Season-Switch-2A — setSportEnabled canonical write round-trip + reject-invalid.
  writeCfg({ sports: { mlb: true, nba: false, nfl: false, nhl: false } })
  const w1 = gate.setSportEnabled("nba", true)
  check("setSportEnabled flips nba ON (round-trip)", w1.sports.nba === true && gate.isSportEnabled("nba") === true)
  const w2 = gate.setSportEnabled("nba", false)
  check("setSportEnabled flips nba OFF (round-trip)", w2.sports.nba === false && gate.isSportEnabled("nba") === false)
  check("setSportEnabled rejects unknown sport", (() => { try { gate.setSportEnabled("cricket", true); return false } catch (_) { return true } })())
  check("setSportEnabled rejects non-boolean enabled", (() => { try { gate.setSportEnabled("nba", "yes"); return false } catch (_) { return true } })())
} finally {
  // ALWAYS restore the operator's real config, exactly.
  fs.writeFileSync(CONFIG, ORIG, "utf8")
}
check("config restored byte-identical", fs.readFileSync(CONFIG, "utf8") === ORIG)

// Season-Switch-2A — /status POST /season token guard is FAIL-CLOSED. Test the
// 403 paths only (they return BEFORE any write — never mutates the real config).
const statusRouter = require(path.join(ROOT, "routes", "statusRoute.js"))
function findHandler(method, p) {
  for (const l of (statusRouter.stack || [])) {
    if (l.route && l.route.path === p && l.route.methods && l.route.methods[method]) {
      const st = l.route.stack || []
      return st.length ? st[st.length - 1].handle : null
    }
  }
  return null
}
const seasonHandler = findHandler("post", "/season")
check("POST /season route registered", typeof seasonHandler === "function")
if (typeof seasonHandler === "function") {
  const mockRes = () => { const r = { statusCode: 200, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.send = (b) => { r.body = b; return r }; return r }
  const savedEnv = process.env.STATUS_WRITE_TOKEN
  delete process.env.STATUS_WRITE_TOKEN
  const rNo = mockRes(); seasonHandler({ headers: {}, body: { sport: "nba", enabled: true } }, rNo, () => {})
  check("403 when STATUS_WRITE_TOKEN unset (fail-closed)", rNo.statusCode === 403)
  process.env.STATUS_WRITE_TOKEN = "fixture-secret"
  const rBad = mockRes(); seasonHandler({ headers: { "x-status-token": "wrong" }, body: { sport: "nba", enabled: true } }, rBad, () => {})
  check("403 when token mismatched", rBad.statusCode === 403)
  if (savedEnv === undefined) delete process.env.STATUS_WRITE_TOKEN; else process.env.STATUS_WRITE_TOKEN = savedEnv
}
check("config still byte-identical after route 403 tests", fs.readFileSync(CONFIG, "utf8") === ORIG)

// snapshot shape (against the restored real config)
const snap = gate.snapshot()
check("snapshot has 4 sport booleans", ["mlb", "nba", "nfl", "nhl"].every(s => typeof snap.sports[s] === "boolean"))
check("snapshot configReadable true", snap.configReadable === true)

// 3. Slate scripts gate BEFORE any network call (source assertions).
function gateBeforeCall(file, sport) {
  const src = fs.readFileSync(file, "utf8")
  const requires = src.includes(`require("../pipeline/shared/seasonGate")`)
  const gateIdx = src.indexOf(`isSportEnabled("${sport}")`)
  const firstStepIdx = src.indexOf("await step(")
  return { requires, gateIdx, firstStepIdx }
}
const m = gateBeforeCall(SLATE_MLB, "mlb")
check("slateMlb requires seasonGate", m.requires)
check("slateMlb gate present", m.gateIdx > -1)
check("slateMlb gate BEFORE first network step", m.gateIdx > -1 && m.firstStepIdx > -1 && m.gateIdx < m.firstStepIdx)
const n = gateBeforeCall(SLATE_NBA, "nba")
check("slateNba requires seasonGate", n.requires)
check("slateNba gate present", n.gateIdx > -1)
check("slateNba gate BEFORE first network step", n.gateIdx > -1 && n.firstStepIdx > -1 && n.gateIdx < n.firstStepIdx)

// 4. scheduler.sh: exactly 6 NBA + 3 MLB gated blocks; grading/settlement/audit ungated.
const sched = fs.readFileSync(SCHEDULER, "utf8")
const countOf = (s) => (sched.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length
check("sport_on() helper defined", /sport_on\(\)\s*\{/.test(sched))
check("exactly 6 NBA blocks gated", countOf("&& sport_on nba") === 6)
check("exactly 3 MLB blocks gated", countOf("&& sport_on mlb") === 3)
// negative assertions — these sport-agnostic jobs must NOT be season-gated.
const lineWith = (needle) => sched.split("\n").find(l => l.includes(needle)) || ""
check("grading:backfill-all NOT gated", !/sport_on/.test(lineWith('if [ "$MIN" -eq 0 ] && [ "$HOUR" -eq 4 ]')))
check("settlement:run NOT gated", !/sport_on/.test(lineWith('if [ "$MIN" -eq 45 ] && [ "$HOUR" -eq 3 ]')))
check("audit:nightly NOT gated", !/sport_on/.test(lineWith('if [ "$MIN" -eq 0 ] && [ "$HOUR" -eq 5 ]')))
// sysAudit + MLB/NBA slate blocks (slates gate at node entry, not via sport_on)
check("MLB slate block NOT sport_on-gated (node-entry instead)", !/sport_on/.test(lineWith('[ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ]; then') ))

// ── report ──
console.log(`verifySeasonGate: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) {
  console.log("FAILURES:")
  for (const f of failures) console.log("  - " + f)
  process.exit(1)
}
process.exit(0)
