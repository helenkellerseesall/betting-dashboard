"use strict"

/**
 * verifyReplayLiveParity.js — Phase Item 0002 Slice 1.5 (VS-2).
 *
 * Replay/probe output is informational ONLY. Closure of any mutation slice
 * requires LIVE-RUNTIME evidence — a persisted `*_tracked_best_<TODAY>.json`
 * file with the hydration shape the probe predicted. This verifier polices
 * the boundary by asserting:
 *
 *   A — STRUCTURAL: probe scripts that emit "RESULT" lines (or PASS / metric
 *       deltas) are not registered in the V5 verifier matrix (they cannot
 *       count toward ops:verify). They must be runtime-named "probe*.js"
 *       (already enforced by runAllVerifiers naming convention), and they
 *       must declare informational-only intent in their first 40 lines.
 *
 *   B — EMPIRICAL parity: when the operator-visible bettor surface includes
 *       a "live regeneration required" sentinel state, a corresponding live
 *       artifact must exist on disk. For Item 0002 Slice 1 specifically: a
 *       persisted `mlb_tracked_best_<TODAY>.json` must exist AND have
 *       eventId on every entry. When today's file is absent, the
 *       constructability story is REPLAY-ONLY and this verifier fails.
 *
 *   C — DOCTRINE PRESENCE: docs/OPERATOR_RUNBOOK.md contains the
 *       "LIVE REGENERATION" section (operator-cemented runbook); without
 *       that section, future operators may close on replay-only evidence.
 *
 * Anti-pattern this verifier exists to prevent:
 *   "probe shows fields populated → mark Item N as shipped"
 *   when in reality the live FE is still serving stripped persisted bytes.
 */

const fs   = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const SCRIPTS = path.join(BACKEND, "scripts")
const TRACKING = path.join(BACKEND, "runtime", "tracking")
const RUNBOOK_PATH = path.join(REPO, "docs", "OPERATOR_RUNBOOK.md")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyReplayLiveParity.js (VS-2)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── Cluster A: STRUCTURAL probe declaration ──────────────────────────────
console.log("Cluster A — probe declaration")
const probeFiles = fs.readdirSync(SCRIPTS).filter(f => /^probe[A-Z].*\.js$/.test(f))
console.log(`  (found ${probeFiles.length} probe* scripts)`)
let probesDeclaringInformational = 0
for (const f of probeFiles) {
  const head = fs.readFileSync(path.join(SCRIPTS, f), "utf8").split("\n").slice(0, 40).join("\n")
  if (/informational|non-blocking|not a verifier|do not block|advisory only/i.test(head)) {
    probesDeclaringInformational++
  } else {
    console.warn(`  ⚠ ${f} — first 40 lines do not declare informational-only intent`)
  }
}
assert(probeFiles.length === 0 || probesDeclaringInformational === probeFiles.length,
  `A1 — every probe* script declares informational-only intent (${probesDeclaringInformational}/${probeFiles.length})`)

// runAllVerifiers must NOT match probe* by filename glob (verifier convention is verify*.js).
const runner = fs.readFileSync(path.join(SCRIPTS, "ops", "runAllVerifiers.js"), "utf8")
assert(/verify\*\.js|^verify|verify\.\*/.test(runner) || /verify[A-Z]/.test(runner),
  "A2 — runAllVerifiers matrix targets verify*.js naming (probes excluded by convention)")
assert(!/require\([^)]*probe[A-Z][^)]*\)/.test(runner),
  "A3 — runAllVerifiers does not require any probe* file as a verifier")

// ── Cluster B: EMPIRICAL parity ──────────────────────────────────────────
console.log("")
console.log("Cluster B — empirical live-artifact parity")
const today = currentSlateDateEt()  // Phase Date-Doctrine-1B
const expectedBestFile = path.join(TRACKING, `mlb_tracked_best_${today}.json`)
const exists = fs.existsSync(expectedBestFile)
assert(exists,
  `B1 — mlb_tracked_best_${today}.json exists on disk (live regeneration evidence)`)

if (exists) {
  let entries = []
  try {
    const data = JSON.parse(fs.readFileSync(expectedBestFile, "utf8"))
    entries = Array.isArray(data?.entries) ? data.entries : []
  } catch (e) {
    failed++; failures.push(`B2 — could not parse ${path.basename(expectedBestFile)}: ${e.message}`)
  }
  if (entries.length > 0) {
    const evHits = entries.filter(e => !!e.eventId).length
    const ttHits = entries.filter(e => Number.isFinite(Number(e.impliedTeamTotal))).length
    const gtHits = entries.filter(e => Number.isFinite(Number(e.gameTotal))).length
    assert(evHits === entries.length,
      `B2 — every entry in today's tracked_best has eventId (${evHits}/${entries.length})`)
    assert(ttHits === entries.length,
      `B3 — every entry has impliedTeamTotal (${ttHits}/${entries.length})`)
    assert(gtHits === entries.length,
      `B4 — every entry has gameTotal (${gtHits}/${entries.length})`)
  } else {
    failed++; failures.push("B2 — today's tracked_best exists but has zero entries (live build failed)")
  }
} else {
  console.warn("  ⚠ live regeneration has not happened today — Item 0002 closure is replay-only")
  console.warn(`  ⚠ run: cd backend && node server.js  (then: curl http://localhost:4000/api/best-available?sport=baseball_mlb)`)
}

// ── Cluster C: DOCTRINE PRESENCE ─────────────────────────────────────────
console.log("")
console.log("Cluster C — doctrine presence (OPERATOR_RUNBOOK live-regeneration section)")
if (fs.existsSync(RUNBOOK_PATH)) {
  const rb = fs.readFileSync(RUNBOOK_PATH, "utf8")
  assert(/LIVE\s+REGENERATION|LIVE-REGENERATION|live-runtime|tracked_best regeneration/i.test(rb),
    "C1 — OPERATOR_RUNBOOK contains a LIVE REGENERATION section")
  assert(/no replay-only closure|replay-only is not closure|probe output is informational/i.test(rb),
    "C2 — OPERATOR_RUNBOOK contains the no-replay-only-closure doctrine sentence")
  assert(/sportsbookAllowlist|DraftKings.*FanDuel.*BetMGM.*Caesars/.test(rb),
    "C3 — OPERATOR_RUNBOOK references the canonical sportsbook allowlist")
} else {
  failed++; failures.push("C — docs/OPERATOR_RUNBOOK.md missing")
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyReplayLiveParity — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  console.error("FAILURES:")
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
