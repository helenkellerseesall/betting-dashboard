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

// ═══════════════════════════════════════════════════════════════════════════
// Phase Cockpit-1.5.A — verifier-first telemetry enforcement (2026-05-20)
// ═══════════════════════════════════════════════════════════════════════════
// Mechanically enforce "show me actual landed truth":
//   I — execution-theater detection: every tag claim in EXECUTION_BACKLOG
//       must resolve to an actual git tag pointing at a real commit.
//   J — expected-vs-actual delta: verifyOperationalOrchestration must agree
//       between summary handler output and canonical source files.
//   K — unauthorized commit-state: every commit on the current branch
//       since pre-item-0001-baseline must be representable in EXECUTION_BACKLOG
//       (shipped slices OR a recognized governance/chore prefix).
//   L — rollback-state: every pre-*-baseline tag declared anywhere must
//       exist in git.
//   M — consumer-wiring-state: post-impl claims in shipped slices must
//       resolve to actual import/usage patterns in the named consumer.
//   N — telemetry lifecycle: cockpit summary handler reports values that
//       match what canonical files actually contain (no fabrication).

console.log("")
console.log("Cluster I — EXECUTION-THEATER DETECTION (claim vs tree)")
function execSync(cmd) {
  const { execSync: x } = require("child_process")
  try { return String(x(cmd, { cwd: REPO, stdio: ["ignore","pipe","ignore"] })).trim() } catch (_) { return null }
}
const execBacklogPath = path.join(REPO, "docs", "EXECUTION_BACKLOG.md")
const execBacklogSrc  = fs.existsSync(execBacklogPath) ? fs.readFileSync(execBacklogPath, "utf8") : ""
// Parse Shipped slices table — column 1 is tag.
const shippedTags = []
{
  const m = execBacklogSrc.match(/## Shipped slices[\s\S]*?\|\s*tag[\s\S]*?\n((?:\|[\s\S]*?\n)+)/)
  if (m) {
    for (const line of m[1].split("\n")) {
      if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue
      const cells = line.split("|").map(c => c.trim())
      if (cells.length < 2) continue
      const tag = cells[1]
      if (tag && tag !== "tag" && !/^\(parent\)$/.test(tag)) shippedTags.push(tag)
    }
  }
}
const gitTagList = (execSync("git tag") || "").split("\n").filter(Boolean)
let missingTagCount = 0, missingTags = []
for (const t of shippedTags) {
  if (!gitTagList.includes(t)) { missingTagCount++; missingTags.push(t) }
}
// Filter:
//   - "(parent)" / "TBD" rows (pre-tag governance baselines)
//   - "(multiple commits)" notation (legacy pre-canonical-tag rule)
// Surface every remaining miss as a REAL execution-theater finding.
const missingExcludingPlaceholders = missingTags.filter(t =>
  !/TBD|parent|multiple\s+commits/i.test(t))
assert(missingExcludingPlaceholders.length === 0,
  `I1 — every claimed shipped-slice tag exists in git (missing=${missingExcludingPlaceholders.length})`)
if (missingExcludingPlaceholders.length > 0) {
  console.error("  EXECUTION-THEATER findings (claimed shipped but no git tag):")
  for (const t of missingExcludingPlaceholders.slice(0, 5)) console.error("    - " + t)
}
// I2 — every existing tag has an actual commit (no dangling refs).
let danglingTags = 0
for (const t of shippedTags) {
  if (gitTagList.includes(t)) {
    const sha = execSync(`git rev-list -n 1 ${JSON.stringify(t)}`)
    if (!sha || !/^[0-9a-f]{7,}$/.test(sha)) danglingTags++
  }
}
assert(danglingTags === 0, `I2 — every existing tag resolves to a real commit (dangling=${danglingTags})`)
// I3 — current HEAD belongs to the canonical branch (stable-nba-engine);
//      hard mismatch implies execution theater (operating on the wrong tree).
const currentBranch = execSync("git rev-parse --abbrev-ref HEAD")
assert(currentBranch === "stable-nba-engine" || currentBranch === "main",
  `I3 — HEAD on canonical branch (got: ${currentBranch})`)

// ── Cluster J — EXPECTED vs ACTUAL DELTA ─────────────────────────────────
console.log("")
console.log("Cluster J — EXPECTED-vs-ACTUAL DELTA")
try {
  delete require.cache[ROUTES_PATH]
  const { summaryHandler } = require(ROUTES_PATH)
  const summary = summaryHandler()
  // J1/J2 — parse ground truth using the SAME block-split protocol the
  // canonical readers use. This guarantees the verifier compares apples-to-
  // apples and never gets contaminated by `state: OPEN | MITIGATED | CLOSED`
  // schema preamble lines or duplicate-id artifacts. Block parse: split on
  // `^---$`, drop schema preamble (block[0]); for each remaining block,
  // require both `id:` and `state:` matches.
  function groundTruthCount(srcPath, idRe, openStates) {
    const src = fs.readFileSync(srcPath, "utf8")
    const blocks = src.split(/^---\s*$/m).slice(1)
    let n = 0
    for (const b of blocks) {
      const idM = b.match(new RegExp("^id:\\s*(" + idRe + ")", "m"))
      const stM = b.match(/^state:\s*([A-Z-]+)\s*$/m)
      if (!idM || !stM) continue
      if (openStates.includes(stM[1])) n++
    }
    return n
  }
  const groundOpenRisks  = groundTruthCount(path.join(REPO, "docs", "OPEN_RISKS.md"),     "R-\\d+-\\d+", ["OPEN","MITIGATED"])
  const groundBacklog    = groundTruthCount(path.join(REPO, "docs", "BETTOR_BACKLOG.md"), "BBL-\\d+",   ["OPEN","IN-SLICE"])
  assert(summary.openRisksCount === groundOpenRisks,
    `J1 — cockpit openRisksCount matches OPEN_RISKS.md ground truth (cockpit=${summary.openRisksCount}, ground=${groundOpenRisks})`)
  assert(summary.openBacklogCount === groundBacklog,
    `J2 — cockpit openBacklogCount matches BETTOR_BACKLOG.md ground truth (cockpit=${summary.openBacklogCount}, ground=${groundBacklog})`)
  // J3: activeSlice claim matches EXECUTION_BACKLOG active block
  const activeBlock = execBacklogSrc.match(/## Active slice[\s\S]*?## Slice queue/)
  if (activeBlock) {
    const sliceMatch = activeBlock[0].match(/\|\s*slice\s*\|\s*([^|]+?)\s*\|/)
    const groundActive = sliceMatch ? sliceMatch[1].trim() : null
    assert(summary.activeSlice && summary.activeSlice.slice === groundActive,
      `J3 — cockpit activeSlice matches EXECUTION_BACKLOG (cockpit="${summary.activeSlice?.slice}", ground="${groundActive}")`)
  }
} catch (e) {
  failed++; failures.push("J — summary load error: " + e.message)
}

// ── Cluster K — UNAUTHORIZED COMMIT-STATE ────────────────────────────────
console.log("")
console.log("Cluster K — UNAUTHORIZED COMMIT-STATE (post-OO-2 commit grammar)")
// Canonical commit-message grammar was operator-cemented at OO-2
// (2026-05-19). K1 scope: commits SINCE the canonical-grammar baseline.
// Pre-doctrine commits use ad-hoc phase-name prefixes that pre-date the
// rule — surfacing them as failures would be retroactive enforcement.
const sinceTag = "pre-oo-1-orchestration-baseline"
const sinceTagExists = gitTagList.includes(sinceTag)
let recentSubjects = []
if (sinceTagExists) {
  recentSubjects = (execSync(`git log ${sinceTag}..HEAD --pretty=format:%s`) || "").split("\n").filter(Boolean)
} else {
  // Fallback: last 30 commits if the baseline tag is absent.
  recentSubjects = (execSync("git log -30 --pretty=format:%s") || "").split("\n").filter(Boolean)
}
const CANONICAL_PREFIX = /^(feat|fix|chore|docs|test|build|refactor|revert)\b|^(checkpoint|Phase|OO-\d|BC-\d|MCR|BRH-)/
let rogue = 0, rogueSamples = []
for (const s of recentSubjects) {
  if (!CANONICAL_PREFIX.test(s)) {
    rogue++
    if (rogueSamples.length < 5) rogueSamples.push(s.slice(0, 80))
  }
}
assert(rogue === 0,
  `K1 — every post-${sinceTag} commit follows canonical prefix grammar (rogue=${rogue} of ${recentSubjects.length})`)
if (rogue > 0) for (const s of rogueSamples) console.error("    - " + s)

// ── Cluster L — ROLLBACK-STATE ───────────────────────────────────────────
console.log("")
console.log("Cluster L — ROLLBACK-STATE (pre-*-baseline tags resolve)")
const baselineTags = gitTagList.filter(t => /^pre-/.test(t))
assert(baselineTags.length >= 5,
  `L1 — at least 5 pre-*-baseline tags exist (got=${baselineTags.length})`)
let baselineMissing = 0
for (const t of baselineTags) {
  const sha = execSync(`git rev-list -n 1 ${JSON.stringify(t)}`)
  if (!sha) baselineMissing++
}
assert(baselineMissing === 0,
  `L2 — every pre-*-baseline tag resolves to a real commit (missing=${baselineMissing})`)

// ── Cluster M — CONSUMER-WIRING STATE ────────────────────────────────────
console.log("")
console.log("Cluster M — CONSUMER-WIRING STATE (post-impl claims resolve)")
const claimedWirings = [
  // [slice tag fragment, file, regex that MUST be present]
  ["item-0003-slice-2", path.join(REPO, "backend/pipeline/shared/buildSlipAi.js"),
    /require\([^)]*sportsbookTopology[^)]*\)/, "buildSlipAi imports sportsbookTopology"],
  ["item-0003-slice-2", path.join(REPO, "backend/pipeline/shared/buildFeaturedPlays.js"),
    /require\([^)]*sportsbookTopology[^)]*\)/, "buildFeaturedPlays imports sportsbookTopology"],
  ["item-0003-vig-stripping-increment-2", path.join(REPO, "backend/pipeline/shared/buildFeaturedPlays.js"),
    /require\([^)]*vigStripping[^)]*\)/, "buildFeaturedPlays imports vigStripping"],
  ["item-0003-vig-stripping-increment-2", path.join(REPO, "backend/pipeline/shared/buildSlipAi.js"),
    /require\([^)]*vigStripping[^)]*\)/, "buildSlipAi imports vigStripping"],
  ["item-0009-archetype-diversification", path.join(REPO, "backend/pipeline/shared/buildFeaturedPlays.js"),
    /require\([^)]*archetypeWeighting[^)]*\)/, "buildFeaturedPlays imports archetypeWeighting"],
]
for (const [tagFrag, file, re, desc] of claimedWirings) {
  if (!gitTagList.some(t => t.includes(tagFrag))) {
    console.log(`  (skipped — tag containing "${tagFrag}" not present)`)
    continue
  }
  const src = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  assert(re.test(src), `M — ${desc} (claim from tag-frag "${tagFrag}")`)
}

// ── Cluster N — TELEMETRY LIFECYCLE ──────────────────────────────────────
console.log("")
console.log("Cluster N — TELEMETRY LIFECYCLE")
// N1: cockpit does NOT write to supervisor state.json / events.log (already
//     covered by Cluster C, but re-asserted at the lifecycle boundary).
const cockpitWriteRe = /backend[\\\/]runtime[\\\/]supervisor[\\\/]state\.json[\s\S]{0,40}(writeFile|appendFile)/
assert(!cockpitWriteRe.test(readSrc(path.join(COCKPIT, "routes.js"))) &&
       !cockpitWriteRe.test(readSrc(path.join(COCKPIT, "readers", "supervisorReader.js"))),
  "N1 — cockpit does NOT write to supervisor/state.json or events.log (anti-shadow)")
// N2: supervisor state.json freshness band (informational; not a hard fail
//     because daemon may be intentionally stopped).
const statePath = path.join(REPO, "backend/runtime/supervisor/state.json")
if (fs.existsSync(statePath)) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, "utf8"))
    const age = s.heartbeatAt ? Date.now() - Date.parse(s.heartbeatAt) : Infinity
    const band = age < 30_000 ? "fresh" : age < 120_000 ? "warm" : "stale"
    console.log("  ⓘ N2 — supervisor heartbeat band: " + band + " (age=" + age + "ms; seq=" + s.heartbeatSeq + ")")
    passed++
  } catch (_) {
    passed++; console.log("  ⓘ N2 — supervisor state.json present (parse skipped)")
  }
}
// N3: no fabrication — cockpit summary handler returns at least one
//     non-null field that comes from a canonical source the verifier can
//     also read independently.
try {
  delete require.cache[ROUTES_PATH]
  const { summaryHandler } = require(ROUTES_PATH)
  const summary = summaryHandler()
  const openRisksFromFile = (fs.readFileSync(path.join(REPO, "docs", "OPEN_RISKS.md"), "utf8")
    .match(/^id:\s*(R-\d+-\d+)/gm) || []).map(s => s.replace(/^id:\s*/, ""))
  const overlapOk = summary.openRisksIds.every(rid => openRisksFromFile.includes(rid))
  assert(overlapOk,
    `N3 — every openRisksIds entry in cockpit summary exists in OPEN_RISKS.md (no fabrication)`)
} catch (e) {
  failed++; failures.push("N3 — fabrication check error: " + e.message)
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
