"use strict"

/**
 * verifySameBookConstructability.js — Phase Item 0003 Slice 1.
 *
 *   A — STRUCTURAL: topology + allowlist modules load; bestBookForSlip
 *       returns deterministic shape.
 *   B — CONSUMER WIRING (forward-looking, Slice 2 target):
 *       buildSlipAi + buildFeaturedPlays import sportsbookTopology.
 *   C — EMPIRICAL persisted slips: today's mlb_tracked_slips_<TODAY>.json:
 *       every slip is either same-book-constructable (per topology) OR
 *       missing-book on every leg (Slice 1.5 R-EXEC-S2-1; non-blocking
 *       hydration gap, separately tracked).
 *   D — EMPIRICAL synthetic: a hand-built sample of common MLB slip
 *       shapes (HR+TB same-game; cross-game HR; pitcher-walks-only)
 *       resolves to allowed canonical books.
 */

const fs   = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const REPO     = path.join(__dirname, "..", "..")
const BACKEND  = path.join(REPO, "backend")
const TRACKING = path.join(BACKEND, "runtime", "tracking")

const topology  = require(path.join(BACKEND, "pipeline", "shared", "sportsbookTopology"))
const allowlist = require(path.join(BACKEND, "pipeline", "shared", "sportsbookAllowlist"))

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifySameBookConstructability.js (VS-6)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── A ───────────────────────────────────────────────────────────────────
console.log("Cluster A — STRUCTURAL")
assert(typeof topology.bestBookForSlip === "function", "A1 — topology.bestBookForSlip exists")
assert(typeof allowlist.resolveSingleBookForSlip === "function", "A2 — allowlist.resolveSingleBookForSlip exists")
assert(allowlist.ALLOWED_SPORTSBOOKS.length === 7, "A3 — allowlist is 7-book set")

// ── B — consumer wiring (Slice 2 — now REQUIRED) ────────────────────────
console.log("")
console.log("Cluster B — consumer wiring (REQUIRED post-Slice-2)")
const slipAiSrc   = fs.readFileSync(path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js"), "utf8")
const featuredSrc = fs.readFileSync(path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js"), "utf8")
assert(/require\([^)]*sportsbookTopology[^)]*\)/.test(slipAiSrc),
  "B1 — buildSlipAi imports sportsbookTopology")
assert(/require\([^)]*sportsbookTopology[^)]*\)/.test(featuredSrc),
  "B2 — buildFeaturedPlays imports sportsbookTopology")
// Emit-boundary insertion: buildSlipAi must call bestBookForSlip after
// buildSlipsForTier produces tiered slips (same-book curated discipline).
assert(/__bestBookForSlip\s*\(\s*legs\s*\)|bestBookForSlip\s*\(\s*legs\s*\)/.test(slipAiSrc),
  "B3 — buildSlipAi calls bestBookForSlip at the curated emit boundary")
// Per-leg ranking: buildFeaturedPlays compactPlay must rank books for each leg.
assert(/_rankBooksForLeg\s*\(\s*c\s*\)|rankBooksForLeg\s*\(\s*c\s*\)/.test(featuredSrc),
  "B4 — buildFeaturedPlays.compactPlay calls rankBooksForLeg per-leg")
// leanSlip must persist book + alternativeBooks on slip + book/sportsbook on legs.
const phase4Src = fs.readFileSync(path.join(BACKEND, "pipeline", "mlb", "phase4Tracking.js"), "utf8")
assert(/leanSlip[\s\S]{0,2000}book\s*:\s*slip\.book\s*\?\?/.test(phase4Src) ||
       /leanSlip[\s\S]{0,2000}book\s*:\s*slip\.book\b/.test(phase4Src),
  "B5 — leanSlip persists slip.book on the slip record")
assert(/leanSlip[\s\S]{0,2000}alternativeBooks/.test(phase4Src),
  "B6 — leanSlip persists slip.alternativeBooks on the slip record")
assert(/leanSlip[\s\S]{0,2000}book\s*:\s*l\.book\s*\?\?/.test(phase4Src),
  "B7 — leanSlip persists leg.book on every persisted leg")

// ── C — empirical persisted slips ────────────────────────────────────────
console.log("")
console.log("Cluster C — empirical persisted slips (single-book + topology-constructable)")
const today = currentSlateDateEt()  // Phase Date-Doctrine-1B
const slipFiles = fs.existsSync(TRACKING)
  ? fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_slips_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  : []
if (slipFiles.length === 0) {
  console.warn("  ⚠ C — no persisted mlb_tracked_slips_*.json found; skipping empirical cluster")
} else {
  const slipsPath = path.join(TRACKING, slipFiles[slipFiles.length - 1])
  console.log("  (read " + path.basename(slipsPath) + ")")
  const data = JSON.parse(fs.readFileSync(slipsPath, "utf8"))
  const slips = Array.isArray(data) ? data : (Array.isArray(data?.slips) ? data.slips : [])
  let ok = 0, bookMissing = 0, mixedBad = 0, unconstructable = 0
  const examples = { mixedBad: [], unconstructable: [] }
  for (const s of slips) {
    const legs = Array.isArray(s?.legs) ? s.legs : (Array.isArray(s?.picks) ? s.picks : [])
    if (legs.length === 0) continue
    const allBookMissing = legs.every(l => (l?.book ?? l?.sportsbook) == null)
    if (allBookMissing) { bookMissing++; continue }
    const single = allowlist.resolveSingleBookForSlip(legs)
    if (!single) { mixedBad++; if (examples.mixedBad.length < 3) examples.mixedBad.push({ id: s?.id || "?", books: legs.map(l => l?.book ?? l?.sportsbook ?? null) }); continue }
    // Now verify topology can also construct it on that book
    const r = topology.scoreBookForSlip(single, legs)
    if (r.constructable) ok++
    else { unconstructable++; if (examples.unconstructable.length < 3) examples.unconstructable.push({ id: s?.id || "?", book: single, reasons: r.reasons }) }
  }
  assert(mixedBad === 0,        `C1 — zero mixed-book / non-allowed-book curated slips (ok=${ok} bookMissing=${bookMissing} mixedBad=${mixedBad} unconstructable=${unconstructable})`)
  assert(unconstructable === 0, `C2 — zero topology-unconstructable curated slips`)
  if (mixedBad)        console.error("  mixedBad examples:", JSON.stringify(examples.mixedBad))
  if (unconstructable) console.error("  unconstructable examples:", JSON.stringify(examples.unconstructable))
  if (bookMissing > 0) console.warn(`  ⚠ ${bookMissing} slip(s) emitted with no book field on any leg (Slice 1.5 R-EXEC-S2-1 hydration gap; tracked separately)`)
}

// ── D — synthetic shape probes ───────────────────────────────────────────
console.log("")
console.log("Cluster D — synthetic shape probes")
const cases = [
  {
    label: "same-game HR + TB",
    legs:  [{ marketKey: "batter_home_runs", eventId: "E1" }, { marketKey: "batter_total_bases", eventId: "E1" }],
    expect: (r) => r.canonicalBook !== null && allowlist.ALLOWED_SPORTSBOOKS.includes(r.canonicalBook),
  },
  {
    label: "cross-game HR + Hits (Fanatics + Hard Rock blocked)",
    legs:  [{ marketKey: "batter_home_runs", eventId: "E1" }, { marketKey: "batter_hits", eventId: "E2" }],
    expect: (r) => r.canonicalBook !== null && !r.alternativeBooks.includes("Fanatics") && !r.alternativeBooks.includes("Hard Rock"),
  },
  {
    label: "pitcher walks only (Fanatics + Hard Rock lack this market)",
    legs:  [{ marketKey: "pitcher_walks", eventId: "E1" }],
    expect: (r) => r.canonicalBook !== null && !r.alternativeBooks.includes("Fanatics") && !r.alternativeBooks.includes("Hard Rock"),
  },
  {
    label: "unconstructable (made-up market)",
    legs:  [{ marketKey: "totally_made_up_market", eventId: "E1" }],
    expect: (r) => r.canonicalBook === null,
  },
]
for (const c of cases) {
  const r = topology.bestBookForSlip(c.legs)
  assert(c.expect(r), `D — "${c.label}" → canonicalBook=${r.canonicalBook} alts=[${(r.alternativeBooks||[]).join(",")}]`)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifySameBookConstructability — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
