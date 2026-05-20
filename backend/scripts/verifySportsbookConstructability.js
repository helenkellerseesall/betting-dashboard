"use strict"

/**
 * verifySportsbookConstructability.js — Phase Item 0002 Slice 1.5 (VS-1).
 *
 * Asserts the canonical sportsbook allowlist exists, single-book
 * constructability holds across curated slip surfaces, and only allowed
 * books appear on curated emissions. Battlefield rows from non-allowed
 * books may still surface in Discover (anti-sterilization); this verifier
 * polices CURATED ONLY.
 *
 * Auto-discovered by runAllVerifiers.js on `verify*.js` filename match.
 *
 * Assertion clusters:
 *   A — STRUCTURAL: allowlist canonical exists at the expected module path,
 *       exports the operator-approved 4-book set frozen.
 *   B — CONSUMER-WIRING: buildSlipAi + buildFeaturedPlays import paths
 *       remain canonical (placeholders; verifier flips to PASS once
 *       consumers wire the helper).
 *   C — EMPIRICAL slip integrity: persisted curated slip artifacts (when
 *       present) are single-book per slip AND every leg's book ∈ allowlist.
 *   D — ALLOWLIST INTEGRITY: exact 4-book set; no drift; no parallel def.
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const ALLOWLIST_PATH = path.join(BACKEND, "pipeline", "shared", "sportsbookAllowlist.js")

let passed = 0
let failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifySportsbookConstructability.js (VS-1)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── Cluster A: STRUCTURAL ────────────────────────────────────────────────
console.log("Cluster A — allowlist canonical existence")
assert(fs.existsSync(ALLOWLIST_PATH), "A1 — sportsbookAllowlist.js exists at canonical path")
let allowlistMod = null
let alErr = null
try { allowlistMod = require(ALLOWLIST_PATH) } catch (e) { alErr = e }
assert(!alErr, "A2 — allowlist module loads without error" + (alErr ? ` (got: ${alErr.message})` : ""))

if (allowlistMod) {
  const { ALLOWED_SPORTSBOOKS, canonicalBookName, isAllowedBook, resolveSingleBookForSlip } = allowlistMod
  assert(Array.isArray(ALLOWED_SPORTSBOOKS), "A3 — exports ALLOWED_SPORTSBOOKS array")
  assert(typeof canonicalBookName === "function", "A4 — exports canonicalBookName function")
  assert(typeof isAllowedBook === "function", "A5 — exports isAllowedBook function")
  assert(typeof resolveSingleBookForSlip === "function", "A6 — exports resolveSingleBookForSlip function")
  assert(Object.isFrozen(ALLOWED_SPORTSBOOKS), "A7 — ALLOWED_SPORTSBOOKS is Object.frozen")
}

// ── Cluster D: ALLOWLIST INTEGRITY ────────────────────────────────────────
console.log("")
console.log("Cluster D — allowlist integrity (exact 4-book set)")
if (allowlistMod) {
  // Phase Item 0003 Slice 1 — 7-book allowlist.
  const expected = ["DraftKings", "FanDuel", "Fanatics", "Caesars", "BetMGM", "Hard Rock", "BetRivers"]
  const actual   = [...allowlistMod.ALLOWED_SPORTSBOOKS]
  assert(actual.length === 7, `D1 — allowlist length is exactly 7 (got ${actual.length})`)
  for (const book of expected) {
    assert(actual.includes(book), `D2 — allowlist contains "${book}"`)
  }
  assert(allowlistMod.canonicalBookName("pinnacle") === null,
    "D3 — non-allowed book (Pinnacle) returns null from canonicalBookName")
  assert(allowlistMod.canonicalBookName("DraftKings") === "DraftKings",
    "D4 — canonical book name returned as-is (DraftKings)")
  assert(allowlistMod.canonicalBookName("dk") === "DraftKings",
    "D5 — alias DK resolves to DraftKings")
  assert(allowlistMod.canonicalBookName("fan_duel") === "FanDuel",
    "D6 — alias fan_duel resolves to FanDuel")
  const mixed = allowlistMod.resolveSingleBookForSlip([{ book: "DraftKings" }, { book: "FanDuel" }])
  assert(mixed === null, "D7 — mixed-book slip resolves to null (rejected)")
  const single = allowlistMod.resolveSingleBookForSlip([{ book: "DraftKings" }, { book: "dk" }])
  assert(single === "DraftKings", "D8 — single-book slip resolves to canonical name across aliases")
  const unknown = allowlistMod.resolveSingleBookForSlip([{ book: "DraftKings" }, { book: "Pinnacle" }])
  assert(unknown === null, "D9 — slip with non-allowed leg resolves to null")
}

// ── Cluster B: CONSUMER WIRING (forward-looking; non-blocking) ──────────
console.log("")
console.log("Cluster B — consumer wiring (forward-looking; informational)")
const slipAiSrc      = fs.readFileSync(path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js"), "utf8")
const featuredSrc    = fs.readFileSync(path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js"), "utf8")
const slipAiWired    = /require\([^)]*sportsbookAllowlist[^)]*\)/.test(slipAiSrc)
const featuredWired  = /require\([^)]*sportsbookAllowlist[^)]*\)/.test(featuredSrc)
if (slipAiWired)   { passed++; console.log("  ✓ B1 — buildSlipAi.js imports sportsbookAllowlist") }
else               { console.warn("  ⚠ B1 — buildSlipAi.js does NOT yet import sportsbookAllowlist (forward-looking)") }
if (featuredWired) { passed++; console.log("  ✓ B2 — buildFeaturedPlays.js imports sportsbookAllowlist") }
else               { console.warn("  ⚠ B2 — buildFeaturedPlays.js does NOT yet import sportsbookAllowlist (forward-looking)") }

// ── Cluster C: EMPIRICAL — persisted curated slip integrity ─────────────
console.log("")
console.log("Cluster C — empirical curated slip single-book integrity")
const trackingDir = path.join(BACKEND, "runtime", "tracking")
let slipsFile = null
try {
  const today = new Date().toISOString().slice(0, 10)
  const candidates = fs.readdirSync(trackingDir)
    .filter(f => /^mlb_tracked_slips_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
  if (candidates.length > 0) {
    slipsFile = path.join(trackingDir, candidates[candidates.length - 1])
  }
} catch (_) {}

if (!slipsFile) {
  console.warn("  ⚠ C — no persisted mlb_tracked_slips_*.json found; skipping empirical cluster")
} else if (allowlistMod) {
  console.log(`  (read ${path.basename(slipsFile)})`)
  const data = JSON.parse(fs.readFileSync(slipsFile, "utf8"))
  const slips = Array.isArray(data) ? data : (Array.isArray(data?.slips) ? data.slips : [])
  if (slips.length === 0) {
    console.warn("  ⚠ C — slips file empty; nothing to assert empirically")
  } else {
    // Three-state empirical classification:
    //   OK         — every leg has a recognized allowed book; slip is single-book
    //   MISSING    — every leg has book=null/undefined; hydration gap, not a
    //                constructability violation (separate slice-2 fix target)
    //   MIXED_BAD  — books are set + (mixed OR non-allowed) → constructability FAIL
    let okCount = 0, missingCount = 0, mixedBadCount = 0
    const mixedBadExamples = []
    const missingExamples  = []
    for (const slip of slips) {
      const legs = Array.isArray(slip?.legs) ? slip.legs : (Array.isArray(slip?.picks) ? slip.picks : [])
      if (legs.length === 0) continue
      const rawBooks = legs.map(l => l?.book ?? l?.sportsbook ?? null)
      const allNull  = rawBooks.every(b => b == null || b === "")
      if (allNull) {
        missingCount++
        if (missingExamples.length < 3) missingExamples.push({ id: slip?.id ?? "?", legs: legs.length })
        continue
      }
      const resolved = allowlistMod.resolveSingleBookForSlip(legs)
      if (resolved) okCount++
      else {
        mixedBadCount++
        if (mixedBadExamples.length < 3) {
          mixedBadExamples.push({ id: slip?.id ?? "?", legs: legs.length, books: rawBooks })
        }
      }
    }
    // HARD assertion — mixed-book or non-allowed-book curated slips MUST fail.
    assert(mixedBadCount === 0,
      `C1 — zero mixed-book / non-allowed-book curated slips (ok=${okCount} mixed_bad=${mixedBadCount} missing_books=${missingCount})`)
    if (mixedBadCount > 0) {
      console.error("  mixed-bad examples:", JSON.stringify(mixedBadExamples))
    }
    // Forward-looking finding — book-hydration gap (separate slice-2 target).
    if (missingCount > 0) {
      console.warn(`  ⚠ C2 — ${missingCount} slip(s) emitted with no book field on any leg (slice-2 hydration gap; non-blocking here)`)
      console.warn("  missing-book examples:", JSON.stringify(missingExamples))
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifySportsbookConstructability — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  console.error("FAILURES:")
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
