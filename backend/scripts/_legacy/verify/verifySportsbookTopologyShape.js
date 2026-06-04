"use strict"

/**
 * verifySportsbookTopologyShape.js — Phase Item 0003 Slice 1.
 *
 * Asserts the canonical topology JSON shape + module contract:
 *   A — STRUCTURAL: data + module exist; module loads.
 *   B — TOPOLOGY COMPLETENESS: every allowed book has an entry; required
 *       capability fields present; marketKeys is a non-empty array.
 *   C — MODULE CONTRACT: required exports present; types correct.
 *   D — NO PARALLEL DEFS: no other source file frozen-lists per-book
 *       capability flags (single canonical topology).
 *   E — DETERMINISTIC SELECTION: scoreBookForSlip / bestBookForSlip /
 *       rankBooksForLeg produce identical output across two consecutive
 *       calls (no hidden non-determinism).
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const DATA    = path.join(BACKEND, "data", "sportsbookTopology.json")
const MODULE  = path.join(BACKEND, "pipeline", "shared", "sportsbookTopology.js")

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifySportsbookTopologyShape.js (VS-5)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── Cluster A ────────────────────────────────────────────────────────────
console.log("Cluster A — STRUCTURAL")
assert(fs.existsSync(DATA),   "A1 — data/sportsbookTopology.json exists")
assert(fs.existsSync(MODULE), "A2 — pipeline/shared/sportsbookTopology.js exists")

let topology = null, mod = null, allowlist = null
try { topology  = JSON.parse(fs.readFileSync(DATA, "utf8")) } catch (e) { failed++; failures.push("A3 — JSON parse: " + e.message) }
try { mod       = require(MODULE) } catch (e) { failed++; failures.push("A4 — module load: " + e.message) }
try { allowlist = require(path.join(BACKEND, "pipeline", "shared", "sportsbookAllowlist")) } catch (e) { failed++; failures.push("A5 — allowlist load: " + e.message) }

// ── Cluster B ────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — TOPOLOGY COMPLETENESS")
if (topology && allowlist) {
  const books = topology.books || {}
  const allowed = allowlist.ALLOWED_SPORTSBOOKS
  assert(typeof topology.version === "string",       "B1 — topology has version string")
  assert(typeof topology.doctrine === "string",      "B2 — topology has doctrine string")
  assert(allowed.length === 7,                       `B3 — allowlist length is 7 (got ${allowed.length})`)
  for (const book of allowed) {
    const entry = books[book]
    assert(entry && typeof entry === "object",       `B4 — topology entry exists for "${book}"`)
    if (entry) {
      assert(typeof entry.supportsSGP === "boolean",          `  B4.1 ${book}.supportsSGP is boolean`)
      assert(typeof entry.supportsCrossGameSGP === "boolean", `  B4.2 ${book}.supportsCrossGameSGP is boolean`)
      assert(typeof entry.supportsAltLines === "boolean",     `  B4.3 ${book}.supportsAltLines is boolean`)
      assert(typeof entry.supportsPlayerProps === "boolean",  `  B4.4 ${book}.supportsPlayerProps is boolean`)
      assert(Number.isFinite(entry.maxLegsPerSlip) && entry.maxLegsPerSlip >= 2, `  B4.5 ${book}.maxLegsPerSlip is number ≥2`)
      assert(Array.isArray(entry.marketKeys) && entry.marketKeys.length > 0,     `  B4.6 ${book}.marketKeys is non-empty array (n=${(entry.marketKeys||[]).length})`)
    }
  }
  // No orphan books (topology entry without allowlist membership)
  const orphans = Object.keys(books).filter(b => !allowed.includes(b))
  assert(orphans.length === 0, `B5 — no orphan topology entries (orphans=${orphans.join(",") || "none"})`)
}

// ── Cluster C ────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster C — MODULE CONTRACT")
if (mod) {
  const expected = ["TOPOLOGY","BOOK_TOPOLOGY","MARKET_KEY_ALIASES","canonicalMarketKey","bookCapabilitiesFor","canConstructLegOn","scoreBookForSlip","bestBookForSlip","rankBooksForLeg","listAllowedBooks"]
  for (const k of expected) assert(k in mod, `C1 — exports "${k}"`)
  assert(typeof mod.bestBookForSlip === "function", "C2 — bestBookForSlip is function")
  assert(typeof mod.rankBooksForLeg === "function", "C3 — rankBooksForLeg is function")
  assert(Object.isFrozen(mod), "C4 — module export object is Object.frozen")
  // Smoke
  const r = mod.bestBookForSlip([{marketKey:"batter_home_runs", eventId:"E1"},{marketKey:"batter_hits", eventId:"E1"}])
  assert(r && typeof r === "object" && "canonicalBook" in r && "alternativeBooks" in r,
    "C5 — bestBookForSlip returns expected shape {canonicalBook, score, alternativeBooks}")
}

// ── Cluster D ────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster D — NO PARALLEL TOPOLOGY DEFS")
function findInDir(dir, pattern, exclude) {
  const hits = []
  const stack = [dir]
  while (stack.length) {
    const p = stack.pop()
    let entries; try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch (_) { continue }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) {
        if (/node_modules|\.git|coverage|dist|build|runtime\/tracking|runtime\/brain/.test(full)) continue
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
const PARALLEL = /supportsCrossGameSGP\s*:\s*(true|false)/
const exclude = new Set([MODULE, __filename])
const parallel = findInDir(REPO, PARALLEL, exclude).filter(p => !/verify[A-Z].*\.js$/.test(path.basename(p)))
assert(parallel.length === 0,
  `D1 — no parallel topology definitions (found ${parallel.length})`)
if (parallel.length > 0) for (const p of parallel.slice(0,5)) console.error("  - " + path.relative(REPO, p))

// ── Cluster E ────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster E — DETERMINISTIC SELECTION")
if (mod) {
  const legs = [
    { marketKey: "batter_home_runs", eventId: "E1" },
    { marketKey: "batter_total_bases", eventId: "E1" },
  ]
  const r1 = mod.bestBookForSlip(legs)
  const r2 = mod.bestBookForSlip(legs)
  assert(JSON.stringify(r1) === JSON.stringify(r2),
    "E1 — bestBookForSlip is deterministic across consecutive calls")
  const rk1 = mod.rankBooksForLeg(legs[0])
  const rk2 = mod.rankBooksForLeg(legs[0])
  assert(JSON.stringify(rk1) === JSON.stringify(rk2),
    "E2 — rankBooksForLeg is deterministic across consecutive calls")
  // Unconstructable returns null canonicalBook
  const bad = mod.bestBookForSlip([{ marketKey: "totally_made_up_market", eventId: "X" }])
  assert(bad.canonicalBook === null,
    "E3 — bestBookForSlip returns null canonicalBook for unconstructable slip (anti-fabrication)")
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifySportsbookTopologyShape — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
