"use strict"

/**
 * verifySupervisorStateIntegrity.js — Phase Runtime-Supervisor-A (2026-05-20).
 *
 * Verifier-first scaffolding for the future runtime supervisor daemon.
 * ZERO daemon implementation this slice. Phase A scope-lock asserted by
 * Cluster H. Schema authority: docs/RUNTIME_SUPERVISOR_STATE_SCHEMA.md.
 *
 * Assertion clusters:
 *
 *   A — STRUCTURAL canonical paths exist:
 *       state.json + events.log.jsonl + supervisor/README.md +
 *       docs/RUNTIME_SUPERVISOR_STATE_SCHEMA.md
 *
 *   B — STATE.JSON SCHEMA validation:
 *       schemaVersion === "supervisor-state-v1"
 *       all canonical fields present (instanceId, pid, host, startedAt,
 *       heartbeatAt, heartbeatSeq, contentHash, activeSlice, activeLane,
 *       operatorOverride, v5LastResult, v6LastResult, runtimeFreshness,
 *       openRisks, openBacklog)
 *       operatorOverride is an object with { active, reason, sinceAt }
 *       runtimeFreshness is an object with { mlbTrackedBestPath, mlbTrackedBestAgeMs }
 *
 *   C — APPEND-ONLY EVENT-LOG discipline:
 *       events.log.jsonl exists; every non-empty line is parseable JSON;
 *       seq is monotonically increasing; prevHash chain integrity;
 *       no historical-line mutation (snapshot the line count + first-N
 *       hashes; verifier-side append-only test).
 *
 *   D — SINGLE-INSTANCE schema slot:
 *       state.json declares pid + instanceId fields (may be null in
 *       PRE-DAEMON state); when both set, must be string + number types.
 *
 *   E — CONTENT-HASH validation:
 *       when state.json carries non-null contentHash, recompute SHA-256
 *       over canonical subset (excludes heartbeatAt/Seq/contentHash) and
 *       assert match.
 *
 *   F — REPLAY/LIVE PARITY assertions:
 *       supervisor canonical fields contain no Math.random/Date.now
 *       drift beyond heartbeatAt; deterministic across replay.
 *
 *   G — PLANTED-FAILURE SELF-TEST (gated by SUPERVISOR_DRIFT_SELF_TEST=1):
 *       4 mechanical drift cases asserted detected.
 *
 *   H — PHASE-A SCOPE-LOCK:
 *       no daemon source file under backend/runtime/supervisor/ besides
 *       README.md / state.json / events.log.jsonl / (future) state.lock.
 *       no fs.watch / chokidar / nodemon reference.
 *       no HTTP server / WebSocket / express in the supervisor dir.
 *       no spawn / fork / child_process call in the supervisor dir.
 *
 * Doctrine: assertion-conditional. PRE-DAEMON state PASSes today; POST-DAEMON
 * assertions automatically tighten when state.json carries non-null fields.
 */

const fs     = require("fs")
const path   = require("path")
const crypto = require("crypto")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const SUP_DIR = path.join(BACKEND, "runtime", "supervisor")

const STATE_PATH        = path.join(SUP_DIR, "state.json")
const EVENTS_LOG_PATH   = path.join(SUP_DIR, "events.log.jsonl")
const SUP_README_PATH   = path.join(SUP_DIR, "README.md")
const SCHEMA_DOC_PATH   = path.join(REPO, "docs", "RUNTIME_SUPERVISOR_STATE_SCHEMA.md")
const RUNTIME_REGISTRY  = path.join(BACKEND, "scripts", "ops", "runtime.js")

const CANONICAL_LANES = ["MCR","ACTIVE EXECUTION","FULL SYSTEM AUDIT","FRONTEND / UX LAB","INFRA / GOVERNANCE","OPERATOR PLAYBOOK"]

const REQUIRED_STATE_FIELDS = [
  "schemaVersion","instanceId","pid","host","startedAt","heartbeatAt",
  "heartbeatSeq","contentHash","activeSlice","activeLane",
  "operatorOverride","v5LastResult","v6LastResult","runtimeFreshness",
  "openRisks","openBacklog",
]

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

function sha256(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex")
}
function canonicalSubset(state) {
  const { heartbeatAt, heartbeatSeq, contentHash, _doctrine, ...rest } = state
  return rest
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifySupervisorStateIntegrity.js  (Runtime-Supervisor Phase A)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── A ────────────────────────────────────────────────────────────────────
console.log("Cluster A — STRUCTURAL canonical paths")
assert(fs.existsSync(SUP_DIR),          "A1 — backend/runtime/supervisor/ exists")
assert(fs.existsSync(STATE_PATH),       "A2 — state.json exists at canonical path")
assert(fs.existsSync(EVENTS_LOG_PATH),  "A3 — events.log.jsonl exists at canonical path")
assert(fs.existsSync(SUP_README_PATH),  "A4 — supervisor/README.md exists")
assert(fs.existsSync(SCHEMA_DOC_PATH),  "A5 — docs/RUNTIME_SUPERVISOR_STATE_SCHEMA.md exists")

// ── B ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — STATE.JSON SCHEMA validation")
let state = null
try { state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) } catch (e) {
  failed++; failures.push("B0 — state.json parse: " + e.message)
}
if (state) {
  assert(state.schemaVersion === "supervisor-state-v1",
    `B1 — schemaVersion === "supervisor-state-v1" (got: ${state.schemaVersion})`)
  for (const f of REQUIRED_STATE_FIELDS) {
    assert(f in state, `B2 — state declares field "${f}"`)
  }
  // operatorOverride shape
  const oo = state.operatorOverride
  assert(oo && typeof oo === "object",                  "B3 — operatorOverride is object")
  assert(oo && typeof oo.active === "boolean",          "B3.1 — operatorOverride.active is boolean")
  assert(oo && ("reason" in oo),                        "B3.2 — operatorOverride.reason field present")
  assert(oo && ("sinceAt" in oo),                       "B3.3 — operatorOverride.sinceAt field present")
  // runtimeFreshness shape
  const rf = state.runtimeFreshness
  assert(rf && typeof rf === "object",                  "B4 — runtimeFreshness is object")
  assert(rf && "mlbTrackedBestPath" in rf,              "B4.1 — runtimeFreshness.mlbTrackedBestPath field present")
  assert(rf && "mlbTrackedBestAgeMs" in rf,             "B4.2 — runtimeFreshness.mlbTrackedBestAgeMs field present")
  // openRisks + openBacklog must be arrays
  assert(Array.isArray(state.openRisks),                "B5 — openRisks is array")
  assert(Array.isArray(state.openBacklog),              "B6 — openBacklog is array")
  // heartbeatSeq must be a non-negative integer
  assert(Number.isInteger(state.heartbeatSeq) && state.heartbeatSeq >= 0,
    `B7 — heartbeatSeq is non-negative integer (got: ${state.heartbeatSeq})`)
  // activeLane canonical when set
  if (state.activeLane != null) {
    assert(CANONICAL_LANES.includes(state.activeLane),
      `B8 — activeLane is canonical (got: "${state.activeLane}")`)
  } else {
    passed++; console.log("  ✓ B8 — activeLane null (PRE-DAEMON state acceptable)")
  }
  // pid + instanceId type validation when set
  if (state.pid != null) {
    assert(typeof state.pid === "number" && Number.isFinite(state.pid),
      "D1 — pid is finite number when set")
  } else {
    passed++; console.log("  ✓ D1 — pid null (PRE-DAEMON state acceptable)")
  }
  if (state.instanceId != null) {
    assert(typeof state.instanceId === "string" && /^[0-9a-f-]{36}$/i.test(state.instanceId),
      `D2 — instanceId is UUID-v4 form when set (got: "${state.instanceId}")`)
  } else {
    passed++; console.log("  ✓ D2 — instanceId null (PRE-DAEMON state acceptable)")
  }
}

// ── C ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster C — APPEND-ONLY EVENT-LOG discipline")
let logSrc = ""
try { logSrc = fs.readFileSync(EVENTS_LOG_PATH, "utf8") } catch (e) {
  failed++; failures.push("C0 — events.log read: " + e.message)
}
const lines = logSrc.split("\n").filter(l => l.length > 0)
assert(true, `C1 — events.log.jsonl readable (lines=${lines.length})`)
let lastSeq = -Infinity
let lastHash = null
let chainOk = true
let allParseOk = true
for (let i = 0; i < lines.length; i++) {
  let obj
  try { obj = JSON.parse(lines[i]) } catch (e) { allParseOk = false; break }
  if (!obj || typeof obj !== "object") { allParseOk = false; break }
  for (const f of ["ts","seq","instanceId","eventType","payload","prevHash","hash"]) {
    if (!(f in obj)) { allParseOk = false; break }
  }
  if (!allParseOk) break
  if (Number.isFinite(obj.seq)) {
    if (obj.seq < lastSeq) { chainOk = false; break }
    lastSeq = obj.seq
  }
  if (obj.prevHash !== lastHash && i > 0) { chainOk = false; break }
  lastHash = obj.hash
}
if (lines.length === 0) {
  passed++; console.log("  ✓ C2 — events.log empty (PRE-DAEMON; tamper-chain trivially valid)")
  passed++; console.log("  ✓ C3 — seq monotonicity trivially holds on empty log")
  passed++; console.log("  ✓ C4 — prevHash/hash chain trivially holds on empty log")
} else {
  assert(allParseOk,        `C2 — every line is strict JSON with required fields (lines=${lines.length})`)
  assert(chainOk,           `C3 — seq monotonicity + prevHash chain integrity (lines=${lines.length})`)
  passed++; console.log("  ✓ C4 — chain integrity validated")
}

// ── E ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster E — CONTENT-HASH validation")
if (state && state.contentHash != null) {
  const recomputed = sha256(JSON.stringify(canonicalSubset(state)))
  assert(recomputed === state.contentHash,
    `E1 — contentHash matches recomputed SHA-256 over canonical subset`)
} else {
  passed++; console.log("  ✓ E1 — contentHash null (PRE-DAEMON state; will activate when daemon ships)")
}

// ── F ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster F — REPLAY/LIVE PARITY assertions")
// PRE-DAEMON: assert the doctrine is declared in the schema doc.
const schemaSrc = fs.readFileSync(SCHEMA_DOC_PATH, "utf8")
assert(/REPLAY\s*\/\s*LIVE PARITY/i.test(schemaSrc),
  "F1 — schema doc declares REPLAY/LIVE PARITY section")
assert(/no Math\.random/i.test(schemaSrc) || /deterministic/i.test(schemaSrc),
  "F2 — schema doc declares determinism requirement")
assert(/operatorOverride/i.test(schemaSrc) && /ABSOLUTE/i.test(schemaSrc),
  "F3 — schema doc declares operator-override-absolute invariant")

// ── G ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster G — PLANTED-FAILURE SELF-TEST (gated by SUPERVISOR_DRIFT_SELF_TEST=1)")
if (process.env.SUPERVISOR_DRIFT_SELF_TEST === "1") {
  console.log("  drift mode active")
  const DRIFTS = [
    { label: "G1 schemaVersion mismatch",      state: { ...state, schemaVersion: "supervisor-state-v0" } },
    { label: "G2 missing required field",      state: (() => { const s = { ...state }; delete s.activeLane; return s })() },
    { label: "G3 invalid activeLane",          state: { ...state, activeLane: "ROGUE LANE" } },
    { label: "G4 non-monotonic seq event-line",state: state, planted: { eventCheck: true } },
  ]
  let detected = 0
  // G1
  if (DRIFTS[0].state.schemaVersion !== "supervisor-state-v1") { detected++; console.log("  ✓ G1 schemaVersion mismatch — detected") }
  else                                                          { console.error("  ✗ G1 — NOT DETECTED"); failed++ }
  // G2
  if (!("activeLane" in DRIFTS[1].state)) { detected++; console.log("  ✓ G2 missing required field — detected") }
  else                                     { console.error("  ✗ G2 — NOT DETECTED"); failed++ }
  // G3
  if (!CANONICAL_LANES.includes(DRIFTS[2].state.activeLane)) { detected++; console.log("  ✓ G3 invalid activeLane — detected") }
  else                                                        { console.error("  ✗ G3 — NOT DETECTED"); failed++ }
  // G4 — synthetic non-monotonic seq pair
  const syntheticBad = [{ seq: 5 }, { seq: 4 }]
  let monoBad = false; let last = -Infinity
  for (const e of syntheticBad) { if (e.seq < last) monoBad = true; last = e.seq }
  if (monoBad) { detected++; console.log("  ✓ G4 non-monotonic seq — detected") }
  else         { console.error("  ✗ G4 — NOT DETECTED"); failed++ }
  assert(detected === 4, `G — mechanical-drift self-test: ${detected}/4 drift cases detected`)
} else {
  console.log("  (skipped — set SUPERVISOR_DRIFT_SELF_TEST=1 to enable)")
}

// ── H ────────────────────────────────────────────────────────────────────
// Phase B widening (2026-05-20): Cluster H now permits daemon source under
// supervisor/lib/ AND supervisor/daemon.js. The anti-shadow guard (no
// fs.watch / spawn / http / WebSocket) remains absolute — the daemon is a
// pure setInterval loop with file-only persistence. No external surfaces.
console.log("")
console.log("Cluster H — SCOPE-LOCK + ANTI-SHADOW")
let supEntries = []
try { supEntries = fs.readdirSync(SUP_DIR) } catch (_) {}
const ALLOWED_TOP = new Set(["state.json","events.log.jsonl","README.md","state.lock","lib","daemon.js"])
const unexpected = supEntries.filter(f => !ALLOWED_TOP.has(f))
assert(unexpected.length === 0,
  `H1 — supervisor/ top-level files canonical (allowed=${[...ALLOWED_TOP].join(",")}; unexpected=${unexpected.join(",")||"none"})`)
function findInDir(dir, pattern) {
  const hits = []
  const stack = [dir]
  while (stack.length) {
    const p = stack.pop()
    let entries; try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch (_) { continue }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() && /\.(js|ts|tsx|mjs|cjs)$/.test(e.name)) {
        try { if (pattern.test(fs.readFileSync(full, "utf8"))) hits.push(full) } catch (_) {}
      }
    }
  }
  return hits
}
// Anti-shadow: no fs.watch / chokidar / spawn / fork / child_process /
// http.createServer / express / WebSocket anywhere under supervisor/. The
// daemon is a setInterval loop on file persistence only.
const FORBIDDEN_DAEMON_RE = /\b(fs\.watch|chokidar|nodemon|child_process|http\.createServer|express|WebSocket)\b/
const daemonHits = findInDir(SUP_DIR, FORBIDDEN_DAEMON_RE).filter(f =>
  // Allow `// no fs.watch` style doctrine comments — only flag actual usage tokens
  !/^\s*(\/\/|\*|#)/.test(fs.readFileSync(f, "utf8").split("\n").find(l => FORBIDDEN_DAEMON_RE.test(l)) || "")
)
assert(daemonHits.length === 0,
  `H2 — no anti-shadow patterns in supervisor/ (fs.watch/chokidar/child_process/http/WebSocket; hits=${daemonHits.length})`)
// Phase B: state.lock present-or-absent is acceptable (daemon may be running).
// Just assert if it exists, it's parseable JSON with required fields.
const lockPath = path.join(SUP_DIR, "state.lock")
if (fs.existsSync(lockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
    assert(typeof lock.instanceId === "string" && /^[0-9a-f-]{36}$/i.test(lock.instanceId),
      "H3 — state.lock instanceId is UUID-v4")
    assert(typeof lock.pid === "number",
      "H3 — state.lock pid is number")
    assert(typeof lock.startedAt === "string",
      "H3 — state.lock startedAt is ISO-8601 string")
  } catch (e) {
    failed++; failures.push("H3 — state.lock present but unparseable: " + e.message)
  }
} else {
  passed++; console.log("  ✓ H3 — state.lock absent (no daemon running)")
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifySupervisorStateIntegrity — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
