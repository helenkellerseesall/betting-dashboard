"use strict"
// verifyServeStall — SERVE-STALL INCIDENT (2026-08-24): /refresh-snapshot and
// /hard-reset held their HTTP connections open for the ENTIRE in-process
// ingest (minutes when upstream is slow) — the FE awaited TWO of them, the
// browser's 6-per-origin pool exhausted, and every later request (including a
// second /version) queued CLIENT-SIDE. Pins: both routes answer 202
// immediately and ingest in the background (?wait=1 escape hatch; mutex
// semantics preserved), /version is precomputed at module load, console lines
// carry timestamps, the FE tells the truth and refetches later, and the one
// upstream axios call keeps its hard timeout. Live timing receipts rode the
// landing (14ms kick / 4ms version-during-refresh).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const sv = rd("server.js")
const fe = rd(path.join("..", "frontend", "mobile", "index.html"))

check("/refresh-snapshot: existing body wrapped as __runRefresh, 202 answered BEFORE ingest, sink logs background completion, ?wait=1 keeps sync path",
  /const __runRefresh = async \(res\) => \{/.test(sv) &&
  /res\.status\(202\)\.json\(\{ ok: true, refreshStarted: true, stampedStale: true/.test(sv) &&
  /__runRefresh\(__sink\)\.catch/.test(sv) && /if \(String\(req\?\.query\?\.wait \|\| ""\) === "1"\) return __runRefresh\(res\)/.test(sv))
check("mutex semantics intact: release stays in the body's finally (background task owns it), guards precede the wrapper",
  /\} finally \{\n    __refreshInProgress = false/.test(sv) &&
  sv.indexOf("if (__refreshInProgress)") < sv.indexOf("const __runRefresh") &&
  /end __runRefresh \(2026-08-24 serve-stall fix\)/.test(sv))
check("/refresh-snapshot/hard-reset: same doctrine (__hrRun + 202 + sink + wait=1)",
  /const __hrRun = async \(res\) => \{/.test(sv) && /__hrRun\(__hrSink\)\.catch/.test(sv) &&
  /end __hrRun \(2026-08-24 serve-stall fix\)/.test(sv) && /hard reset running in the background/.test(sv))
check("console timestamps: ISO prefix wrapper at boot with wrap-once guard (the 571MB timestamp-less log class)",
  /global\.__consoleStamped/.test(sv) && /new Date\(\)\.toISOString\(\)/.test(sv.slice(0, 3000)))
check("/version: precomputed at module load — pure memory read, unconditionally",
  /_computeVersion\(\)\nrouter\.get\("\/version", \(req, res\) => res\.json\(_computeVersion\(\)\)\)/.test(rd("routes/workstationRoutes.js")))
check("upstream hard timeout intact: the ONE axios site in the bootstrap ingest carries timeout: 15000",
  /axios\.get\(endpoint, \{ params, timeout: 15000 \}\)/.test(rd("pipeline/mlb/buildMlbBootstrapSnapshot.js")))
check("FE: banner flow no longer waits for fresh data — honest toast + ~25s delayed refetch; held-connection class named at source",
  /Refreshing prices in the background — board updates shortly/.test(fe) &&
  /window\.__bgRefreshT = setTimeout\(\(\) => \{ refresh\(false\); \}, 25000\);/.test(fe) &&
  /6-per-origin pool/.test(fe))
check("serve-path doctrine intact from the perf pack: /state still never awaits a refresh",
  rd("routes/workstationRoutes.js").indexOf("await maybeTriggerNbaSnapshotRefresh") === -1)

console.log(`\nverifyServeStall: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
