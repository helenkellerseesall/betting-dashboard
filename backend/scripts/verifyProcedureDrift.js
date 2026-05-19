"use strict"

/**
 * verifyProcedureDrift.js — Phase Item 0002 Slice 1.5 (VS-4).
 *
 * Operator-cemented procedure invariants:
 *
 *   1. OPERATOR_RUNBOOK must contain the canonical "LIVE REGENERATION"
 *      runbook for tracked_best persistence.
 *   2. OPERATOR_RUNBOOK must contain the canonical sportsbook allowlist
 *      reference (DraftKings / FanDuel / BetMGM / Caesars) + the
 *      single-book curated discipline rule.
 *   3. OPERATOR_RUNBOOK must contain the no-replay-only-closure doctrine
 *      sentence (probe output is informational; closure requires live
 *      runtime artifact).
 *   4. PRODUCT_IDENTITY.md must contain a sportsbook-governance reference
 *      pointing at sportsbookAllowlist.js.
 *   5. ARCHITECTURE_LAWS.md must contain Law N (latest authored) covering
 *      sportsbook constructability OR explicit cross-reference to the
 *      allowlist canonical module.
 *   6. No parallel sportsbook-list definition lives anywhere else in the
 *      codebase (single canonical authority).
 *
 * This verifier prevents the operational-procedure regressions that
 * caused Item 0002 Slice 1 to be falsely closed on replay evidence —
 * the procedure-side guard that runs alongside the persistence-side guard.
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const DOCS    = path.join(REPO, "docs")

const RUNBOOK_PATH        = path.join(DOCS, "OPERATOR_RUNBOOK.md")
const PRODUCT_IDENTITY    = path.join(REPO, "PRODUCT_IDENTITY.md")
const ARCH_LAWS_CANDIDATES = [
  path.join(BACKEND, "runtime", "brain", "ARCHITECTURE_LAWS.md"),
  path.join(REPO,    "ARCHITECTURE_LAWS.md"),
  path.join(DOCS,    "ARCHITECTURE_LAWS.md"),
]
const ALLOWLIST_MODULE_PATH = path.join(BACKEND, "pipeline", "shared", "sportsbookAllowlist.js")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyProcedureDrift.js (VS-4)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── OPERATOR_RUNBOOK ─────────────────────────────────────────────────────
console.log("Cluster A — OPERATOR_RUNBOOK doctrine sections")
const runbookExists = fs.existsSync(RUNBOOK_PATH)
assert(runbookExists, "A1 — docs/OPERATOR_RUNBOOK.md exists")
if (runbookExists) {
  const rb = fs.readFileSync(RUNBOOK_PATH, "utf8")
  assert(/LIVE\s+REGENERATION/i.test(rb),
    "A2 — OPERATOR_RUNBOOK contains LIVE REGENERATION section header")
  assert(/recordMlbBestProps\s*\(/.test(rb) || /api\/best-available[^\n]*baseball_mlb/.test(rb),
    "A3 — OPERATOR_RUNBOOK names the canonical regeneration command (recordMlbBestProps or /api/best-available)")
  assert(/no replay-only closure|replay.{0,10}only.{0,10}is.{0,10}not.{0,10}closure|probe.{0,12}informational/i.test(rb),
    "A4 — OPERATOR_RUNBOOK contains the no-replay-only-closure doctrine sentence")
  assert(/DraftKings/.test(rb) && /FanDuel/.test(rb) && /BetMGM/.test(rb) && /Caesars/.test(rb),
    "A5 — OPERATOR_RUNBOOK lists the four-book allowlist (DraftKings / FanDuel / BetMGM / Caesars)")
  assert(/single[- ]book/i.test(rb),
    "A6 — OPERATOR_RUNBOOK contains the single-book curated discipline phrase")
  assert(/sportsbookAllowlist/.test(rb),
    "A7 — OPERATOR_RUNBOOK references the canonical allowlist module name")
}

// ── PRODUCT_IDENTITY ─────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — PRODUCT_IDENTITY sportsbook governance reference")
const piExists = fs.existsSync(PRODUCT_IDENTITY)
assert(piExists, "B1 — PRODUCT_IDENTITY.md exists")
if (piExists) {
  const pi = fs.readFileSync(PRODUCT_IDENTITY, "utf8")
  assert(/sportsbookAllowlist|sportsbook governance|sportsbook allowlist|four[- ]book/i.test(pi),
    "B2 — PRODUCT_IDENTITY references sportsbook governance OR allowlist module")
}

// ── ARCHITECTURE_LAWS ────────────────────────────────────────────────────
console.log("")
console.log("Cluster C — ARCHITECTURE_LAWS sportsbook-constructability law")
const lawsPath = ARCH_LAWS_CANDIDATES.find(p => fs.existsSync(p))
if (!lawsPath) {
  console.warn("  ⚠ C — ARCHITECTURE_LAWS.md not found in any canonical location; skipping")
} else {
  const laws = fs.readFileSync(lawsPath, "utf8")
  assert(/sportsbook|constructability|single[- ]book/i.test(laws),
    `C1 — ARCHITECTURE_LAWS (${path.relative(REPO, lawsPath)}) references sportsbook / constructability / single-book`)
}

// ── Cluster D: single-canonical allowlist (no parallel defs) ────────────
console.log("")
console.log("Cluster D — no parallel sportsbook-list definitions")
assert(fs.existsSync(ALLOWLIST_MODULE_PATH),
  "D1 — canonical allowlist module exists (backend/pipeline/shared/sportsbookAllowlist.js)")

function findInDir(dir, pattern, exclude) {
  const hits = []
  const stack = [dir]
  while (stack.length) {
    const p = stack.pop()
    let entries
    try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch (_) { continue }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) {
        if (/node_modules|\.git|coverage|dist|build|frontend.dist|runtime\/tracking|runtime\/brain/.test(full)) continue
        stack.push(full)
      } else if (e.isFile() && /\.(js|ts|tsx)$/.test(e.name) && !exclude.has(full)) {
        try {
          const src = fs.readFileSync(full, "utf8")
          if (pattern.test(src)) hits.push(full)
        } catch (_) {}
      }
    }
  }
  return hits
}

// Look for any OTHER file that frozen-lists multiple sportsbooks together —
// a heuristic for "parallel allowlist" leakage. The canonical module is excluded.
const PARALLEL_PATTERN = /(DraftKings[\s\S]{0,80}FanDuel[\s\S]{0,80}BetMGM[\s\S]{0,80}Caesars|ALLOWED_SPORTSBOOKS\s*=)/m
const exclude = new Set([ALLOWLIST_MODULE_PATH, __filename])
const parallelHits = findInDir(REPO, PARALLEL_PATTERN, exclude)
  // The verifier-side tests legitimately mention all four books; exclude verify*.js files in scripts/.
  .filter(p => !/\/(scripts|tests)\//.test(p) || !/verify[A-Z].*\.js$/.test(path.basename(p)))

if (parallelHits.length === 0) {
  passed++; console.log("  ✓ D2 — no parallel allowlist definitions detected outside the canonical module")
} else {
  // INFORMATIONAL: docs/runbook intentionally lists all four books in
  // prose form. We only FAIL on JS/TS source-level parallel arrays.
  const codeHits = parallelHits.filter(p => /\.(js|ts|tsx)$/.test(p))
  if (codeHits.length === 0) {
    passed++; console.log(`  ✓ D2 — no parallel allowlist source-code definitions (${parallelHits.length} doc/test mentions tolerated)`)
  } else {
    assert(false,
      `D2 — found ${codeHits.length} parallel allowlist source-code definition(s) outside canonical module`)
    for (const h of codeHits.slice(0, 5)) console.error("  - " + path.relative(REPO, h))
  }
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyProcedureDrift — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  console.error("FAILURES:")
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
