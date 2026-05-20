"use strict"

/**
 * verifyCockpitReadOnly.js — Operator Cockpit Phase 1 (2026-05-20).
 *
 * Asserts the cockpit is structurally read-only + isolated + canonical:
 *   A — STRUCTURAL files exist (server.js + routes.js + readers/ + views/)
 *   B — READ-ONLY routes (only GET methods; no POST/PUT/DELETE/PATCH)
 *   C — ANTI-SHADOW (no fs.writeFileSync / appendFileSync / mkdirSync /
 *       unlinkSync / renameSync / rmSync / spawn / fork / child_process
 *       anywhere under backend/cockpit/)
 *   D — FE ISOLATION (cockpit doesn't import from frontend/ or React)
 *   E — NO MUTATION FORMS in HTML (no <form action= method=post/put/...>)
 *   F — CANONICAL SOURCES: readers reference the expected paths
 *   G — RUNTIME REGISTRY: cockpit-start command registered
 *   H — HYDRATION PROOF: summary handler returns parsed objects with the
 *       expected fields (offline test against current canonical state)
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const COCKPIT = path.join(BACKEND, "cockpit")

const SERVER_PATH       = path.join(COCKPIT, "server.js")
const ROUTES_PATH       = path.join(COCKPIT, "routes.js")
const SUP_READER_PATH   = path.join(COCKPIT, "readers", "supervisorReader.js")
const BACK_READER_PATH  = path.join(COCKPIT, "readers", "backlogReader.js")
const VIEW_PATH         = path.join(COCKPIT, "views", "cockpit.html")
const RUNTIME_REGISTRY  = path.join(BACKEND, "scripts", "ops", "runtime.js")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

function readSrc(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "" }

function findInDir(dir, pattern) {
  const hits = []
  const stack = [dir]
  while (stack.length) {
    const p = stack.pop()
    let entries; try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch (_) { continue }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() && /\.(js|html|ts|tsx|mjs|cjs)$/.test(e.name)) {
        try { if (pattern.test(fs.readFileSync(full, "utf8"))) hits.push(full) } catch (_) {}
      }
    }
  }
  return hits
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyCockpitReadOnly.js  (Operator Cockpit Phase 1)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── A ────────────────────────────────────────────────────────────────────
console.log("Cluster A — STRUCTURAL")
assert(fs.existsSync(COCKPIT),           "A1 — backend/cockpit/ exists")
assert(fs.existsSync(SERVER_PATH),       "A2 — backend/cockpit/server.js exists")
assert(fs.existsSync(ROUTES_PATH),       "A3 — backend/cockpit/routes.js exists")
assert(fs.existsSync(SUP_READER_PATH),   "A4 — backend/cockpit/readers/supervisorReader.js exists")
assert(fs.existsSync(BACK_READER_PATH),  "A5 — backend/cockpit/readers/backlogReader.js exists")
assert(fs.existsSync(VIEW_PATH),         "A6 — backend/cockpit/views/cockpit.html exists")

// ── B ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — READ-ONLY routes (GET only)")
const routesSrc = readSrc(ROUTES_PATH)
const serverSrc = readSrc(SERVER_PATH)
assert(!/app\.(post|put|delete|patch)\s*\(/i.test(routesSrc),
  "B1 — routes.js declares no POST/PUT/DELETE/PATCH handlers")
assert(/req\.method\s*!==\s*"GET"/.test(routesSrc) || /req\.method\s*!==\s*"GET"/.test(serverSrc),
  "B2 — non-GET requests rejected at routes/server boundary")
assert(/statusCode\s*=\s*405/.test(serverSrc),
  "B3 — server returns 405 method-not-allowed on non-GET")

// ── C ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster C — ANTI-SHADOW (no write/mutation calls)")
const FORBIDDEN_WRITES = /\b(fs\.writeFile|fs\.writeFileSync|fs\.appendFile|fs\.appendFileSync|fs\.mkdir|fs\.mkdirSync|fs\.unlink|fs\.unlinkSync|fs\.rename|fs\.renameSync|fs\.rm|fs\.rmSync|fs\.rmdir|fs\.rmdirSync|fs\.copyFile|fs\.copyFileSync|fs\.truncate|fs\.truncateSync|fs\.symlinkSync|fs\.writeFileSync|child_process|spawn|fork|execSync)\b/
const writeHits = findInDir(COCKPIT, FORBIDDEN_WRITES)
assert(writeHits.length === 0,
  `C1 — no write/mutation calls under backend/cockpit/ (hits=${writeHits.length})`)
if (writeHits.length > 0) for (const h of writeHits.slice(0, 5)) console.error("    - " + path.relative(REPO, h))

// ── D ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster D — FE ISOLATION (no bettor FE imports)")
const FE_IMPORTS = /\b(from\s+["']react|require\(["']react|frontend\/src|@\/components|\.tsx?["'])/
const feHits = findInDir(COCKPIT, FE_IMPORTS)
assert(feHits.length === 0,
  `D1 — cockpit contains no React / frontend/src / .tsx imports (hits=${feHits.length})`)
if (feHits.length > 0) for (const h of feHits.slice(0, 5)) console.error("    - " + path.relative(REPO, h))

// ── E ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster E — NO MUTATION FORMS in HTML")
const html = readSrc(VIEW_PATH)
assert(!/<form\b[^>]*\bmethod\s*=\s*["'](post|put|delete|patch)/i.test(html),
  "E1 — HTML contains no <form method=POST/PUT/DELETE/PATCH>")
assert(!/<input\b[^>]*\btype\s*=\s*["']submit/i.test(html) || !/<form\b/i.test(html),
  "E2 — HTML contains no submit-button mutation surface")
assert(/<meta\s+name="phase"\s+content="operator-cockpit-phase-1"/.test(html),
  "E3 — HTML declares phase meta (operator-cockpit-phase-1)")

// ── F ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster F — CANONICAL SOURCES")
const supReader = readSrc(SUP_READER_PATH)
const backReader = readSrc(BACK_READER_PATH)
assert(/runtime[\\\/]supervisor[\\\/]state\.json/.test(supReader),
  "F1 — supervisorReader points at canonical state.json")
assert(/runtime[\\\/]supervisor[\\\/]events\.log\.jsonl/.test(supReader),
  "F2 — supervisorReader points at canonical events.log.jsonl")
assert(/EXECUTION_BACKLOG\.md/.test(backReader),
  "F3 — backlogReader points at canonical EXECUTION_BACKLOG.md")
assert(/BETTOR_BACKLOG\.md/.test(backReader),
  "F4 — backlogReader points at canonical BETTOR_BACKLOG.md")
assert(/OPEN_RISKS\.md/.test(backReader),
  "F5 — backlogReader points at canonical OPEN_RISKS.md")
assert(/ACTIVE_PHASE\.md/.test(backReader),
  "F6 — backlogReader points at canonical ACTIVE_PHASE.md")

// ── G ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster G — RUNTIME REGISTRY")
try {
  delete require.cache[RUNTIME_REGISTRY]
  const { COMMANDS } = require(RUNTIME_REGISTRY)
  assert("cockpit-start" in COMMANDS, "G1 — runtime.js registers cockpit-start")
} catch (e) {
  failed++; failures.push("G1 — runtime registry load: " + e.message)
}

// ── H ────────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster H — HYDRATION PROOF (offline)")
try {
  delete require.cache[ROUTES_PATH]
  delete require.cache[SUP_READER_PATH]
  delete require.cache[BACK_READER_PATH]
  const { summaryHandler } = require(ROUTES_PATH)
  const summary = summaryHandler()
  assert(summary && typeof summary === "object", "H1 — summary handler returns object")
  assert(summary.supervisor && typeof summary.supervisor === "object",
    "H2 — summary.supervisor populated")
  assert("supervisorAlive" in summary.supervisor,
    "H3 — summary.supervisor.supervisorAlive field present")
  assert("heartbeatSeq" in summary.supervisor,
    "H4 — summary.supervisor.heartbeatSeq field present")
  assert(Number.isInteger(summary.openRisksCount) && summary.openRisksCount >= 0,
    `H5 — summary.openRisksCount integer (got: ${summary.openRisksCount})`)
  assert(Number.isInteger(summary.openBacklogCount) && summary.openBacklogCount >= 0,
    `H6 — summary.openBacklogCount integer (got: ${summary.openBacklogCount})`)
} catch (e) {
  failed++; failures.push("H — handler load: " + e.message)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyCockpitReadOnly — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
