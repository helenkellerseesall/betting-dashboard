"use strict"

/**
 * Phase Item 0002 — verifyItem0002DiscoveryHydration.js
 *
 * DISCOVER + BC-1 HYDRATION VERIFIER (Item 0002 Increment 1, verifier-first).
 *
 * Authored BEFORE any Item 0002 mutation ships. Empirically VERIFIED root
 * causes of two operator-surfaced cognition gaps:
 *
 *   GAP 1 — Discover hydration failure ("N props" visible but "No games
 *           match this lens/search"). Root cause: tracked_best persistence
 *           whitelist (toTrackedMlbBestEntry in phase4Tracking.js) drops
 *           eventId. Workstation /state route preferentially reads enriched_best
 *           (eventId: 0%) over eligibleBets (eventId: 100%). FE
 *           buildGameEcosystems then drops every candidate at
 *           `if (!c.eventId) continue` → 0 games rendered.
 *
 *   GAP 3 — BC-1 bettorRealismScore = 0/100. Root cause: same whitelist
 *           drops depth, impliedTeamTotal, gameTotal, hrEnvironmentTag,
 *           lineupSpot. Compounding factor: even snapshot rows store these
 *           signals NESTED (lineupContextV2.depth, parkContext.hrEnvironmentTag)
 *           while buildFeaturedPlays.normalizeCandidate + BC-8
 *           computeBettorRealismScore read them at top-level
 *           (raw.depth, raw.hrEnvironmentTag).
 *
 * ASSERTIONS (assertion-conditional; current state PRE-Item-0002):
 *
 *   STRUCTURAL — canonical authority surfaces:
 *     A1. phase4Tracking.toTrackedMlbBestEntry is the canonical persistence
 *         transform for mlb_tracked_best entries (single authority).
 *     A2. workstationRoutes preferentially reads enrichedBest over
 *         eligibleBets when enrichedBest.length > 0 (canonical pool selection).
 *     A3. FE buildGameEcosystems drops candidates with empty eventId
 *         (canonical anti-fabrication; correct behavior — verifier must NOT
 *         propose loosening this guard).
 *     A4. BC-8 computeBettorRealismScore reads top-level c.depth /
 *         c.impliedTeamTotal / c.gameTotal / c.hrEnvironmentTag (canonical
 *         read shape; verifier must NOT propose nested-field reads).
 *
 *   EMPIRICAL — runtime data shape (gated on latest tracked_best file):
 *     A5. tracked_best entries are emitted WITHOUT eventId (current state =
 *         broken; verifier captures this empirically as NOT-VERIFIED until
 *         Item 0002 mutation ships).
 *     A6. tracked_best entries are emitted WITHOUT depth / impliedTeamTotal /
 *         gameTotal / hrEnvironmentTag / lineupSpot (current state = broken).
 *     A7. snapshot-mlb.json rows ARE emitted WITH eventId (canonical source
 *         is healthy — the drift is at the persistence whitelist, NOT at
 *         the source pipeline).
 *     A8. snapshot-mlb.json rows store BC-1 signals NESTED — lineupContextV2,
 *         parkContext — not at top level (canonical drift between snapshot
 *         storage shape and curator read shape).
 *
 *   ROOT-CAUSE LOCATION CHECKS:
 *     A9. phase4Tracking.toTrackedMlbBestEntry whitelist does NOT include
 *         eventId, depth, impliedTeamTotal, gameTotal, hrEnvironmentTag,
 *         or lineupSpot fields (source-code-level verification).
 *
 * Doctrine:
 *   - Verifier-only. No semantic side effects. No mutation.
 *   - Auto-discovered by runAllVerifiers.js matrix on filename verify*.js.
 *   - PRE-Item-0002 state: A5/A6 captured as findings, NOT-VERIFIED (this
 *     is the empirical truth doctrine — the verifier surfaces the broken
 *     state honestly rather than masking it).
 *   - POST-Item-0002 state: when persistence is repaired, A5/A6 must flip
 *     to PASS without verifier modification (assertion-conditional).
 *
 * Run via:
 *   node backend/scripts/verifyItem0002DiscoveryHydration.js
 *
 * Or via canonical ops layer:
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const phase4TrackingPath      = path.join(BACKEND, "pipeline", "mlb", "phase4Tracking.js")
const workstationRoutesPath   = path.join(BACKEND, "routes", "workstationRoutes.js")
const gameEcosystemPath       = path.join(REPO, "frontend", "src", "workstation", "gameEcosystem.ts")
const buildSlipAiPath         = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const buildFeaturedPlaysPath  = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const snapshotMlbPath         = path.join(BACKEND, "snapshot-mlb.json")
const trackingDir             = path.join(BACKEND, "runtime", "tracking")

let passed = 0
let failed = 0
let notVerified = 0
const failures = []
const findings = []

function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}

function finding(cond, label, expected) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); return }
  notVerified++
  findings.push({ label, expected })
  console.warn(`  ⚠ NOT VERIFIED — ${label} (expected: ${expected})`)
}

function readSrc(p, label) {
  if (!fs.existsSync(p)) {
    failed++
    failures.push(`source not found: ${label} (${p})`)
    return null
  }
  return fs.readFileSync(p, "utf8")
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyItem0002DiscoveryHydration.js — Discover + BC-1 hydration")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── Cluster 1: STRUCTURAL authority surfaces ────────────────────────────────
console.log("Cluster 1 — STRUCTURAL authority surfaces")
const phase4Src = readSrc(phase4TrackingPath, "phase4Tracking.js")
if (phase4Src) {
  assert(/function\s+toTrackedMlbBestEntry/.test(phase4Src),
    "A1 — phase4Tracking.toTrackedMlbBestEntry exists (canonical persistence transform)")
}

const wsSrc = readSrc(workstationRoutesPath, "workstationRoutes.js")
if (wsSrc) {
  assert(/pool\.enrichedBest\.length\s*\?\s*pool\.enrichedBest\s*:\s*pool\.eligibleBets/.test(wsSrc),
    "A2 — workstationRoutes preferentially reads enrichedBest over eligibleBets when non-empty")
}

const geSrc = readSrc(gameEcosystemPath, "gameEcosystem.ts")
if (geSrc) {
  assert(/if\s*\(!id\)\s*continue/.test(geSrc),
    "A3 — FE buildGameEcosystems drops candidates without eventId (canonical anti-fabrication)")
}

const slipAiSrc = readSrc(buildSlipAiPath, "buildSlipAi.js")
if (slipAiSrc) {
  // BC-8 computeBettorRealismScore reads c.depth, c.impliedTeamTotal, c.gameTotal, c.hrEnvironmentTag
  assert(/computeBettorRealismScore[\s\S]*?c\?\.depth[\s\S]*?c\?\.impliedTeamTotal/.test(slipAiSrc),
    "A4a — BC-8 reads top-level c.depth + c.impliedTeamTotal (canonical flat shape)")
  assert(/computeBettorRealismScore[\s\S]*?c\?\.gameTotal[\s\S]*?c\?\.hrEnvironmentTag/.test(slipAiSrc),
    "A4b — BC-8 reads top-level c.gameTotal + c.hrEnvironmentTag (canonical flat shape)")
}

// ── Cluster 2: EMPIRICAL data-shape findings ───────────────────────────────
console.log("")
console.log("Cluster 2 — EMPIRICAL data-shape (tracked_best + snapshot)")

function latestMlbTrackedBest() {
  if (!fs.existsSync(trackingDir)) return null
  const files = fs.readdirSync(trackingDir)
    .filter(f => /^mlb_tracked_best_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
  if (files.length === 0) return null
  const p = path.join(trackingDir, files[files.length - 1])
  try { return { path: p, data: JSON.parse(fs.readFileSync(p, "utf8")) } }
  catch (_) { return null }
}

const tb = latestMlbTrackedBest()
if (tb) {
  const entries = Array.isArray(tb.data?.entries) ? tb.data.entries : []
  console.log(`  (read ${entries.length} entries from ${path.basename(tb.path)})`)
  if (entries.length === 0) {
    notVerified++
    findings.push({ label: "A5/A6 — tracked_best entries empty; cannot evaluate empirical shape", expected: "≥1 entry" })
  } else {
    let evHits = 0, depthHits = 0, ttHits = 0, gtHits = 0, envHits = 0, lpHits = 0
    for (const e of entries) {
      if (e.eventId) evHits++
      if (e.depth != null) depthHits++
      if (Number.isFinite(Number(e.impliedTeamTotal))) ttHits++
      if (Number.isFinite(Number(e.gameTotal))) gtHits++
      if (e.hrEnvironmentTag != null) envHits++
      if (e.lineupSpot != null) lpHits++
    }
    finding(evHits === entries.length,
      `A5 — tracked_best entries carry eventId (current: ${evHits}/${entries.length})`,
      `${entries.length}/${entries.length}`)
    finding(depthHits === entries.length,
      `A6a — tracked_best entries carry depth (current: ${depthHits}/${entries.length})`,
      `${entries.length}/${entries.length}`)
    finding(ttHits === entries.length,
      `A6b — tracked_best entries carry impliedTeamTotal (current: ${ttHits}/${entries.length})`,
      `${entries.length}/${entries.length}`)
    finding(gtHits === entries.length,
      `A6c — tracked_best entries carry gameTotal (current: ${gtHits}/${entries.length})`,
      `${entries.length}/${entries.length}`)
    finding(envHits === entries.length,
      `A6d — tracked_best entries carry hrEnvironmentTag (current: ${envHits}/${entries.length})`,
      `${entries.length}/${entries.length}`)
    finding(lpHits === entries.length,
      `A6e — tracked_best entries carry lineupSpot (current: ${lpHits}/${entries.length})`,
      `${entries.length}/${entries.length}`)
  }
} else {
  notVerified++
  findings.push({ label: "A5/A6 — no tracked_best file present", expected: "≥1 daily file in backend/runtime/tracking/" })
  console.warn("  ⚠ NOT VERIFIED — no tracked_best file present (A5/A6 skipped)")
}

if (fs.existsSync(snapshotMlbPath)) {
  try {
    const snap = JSON.parse(fs.readFileSync(snapshotMlbPath, "utf8"))
    const rows = snap?.data?.rows || []
    console.log(`  (read ${rows.length} rows from snapshot-mlb.json)`)
    let evHits = 0, lpHits = 0, parkCtxHits = 0, lcv2Hits = 0
    let topDepth = 0, topHrEnv = 0
    for (const r of rows) {
      if (r.eventId) evHits++
      if (r.lineupPosition != null) lpHits++
      if (r.parkContext != null) parkCtxHits++
      if (r.lineupContextV2 != null) lcv2Hits++
      if (r.depth != null) topDepth++
      if (r.hrEnvironmentTag != null) topHrEnv++
    }
    assert(rows.length === 0 || evHits === rows.length,
      `A7 — snapshot rows carry eventId (${evHits}/${rows.length})`)
    finding(topDepth === rows.length,
      `A8a — snapshot rows carry TOP-LEVEL depth (current: ${topDepth}/${rows.length}; nested in lineupContextV2: ${lcv2Hits})`,
      `${rows.length}/${rows.length}`)
    finding(topHrEnv === rows.length,
      `A8b — snapshot rows carry TOP-LEVEL hrEnvironmentTag (current: ${topHrEnv}/${rows.length}; nested in parkContext: ${parkCtxHits})`,
      `${rows.length}/${rows.length}`)
  } catch (e) {
    notVerified++
    findings.push({ label: `A7/A8 — snapshot read error: ${e.message}`, expected: "parseable snapshot-mlb.json" })
  }
} else {
  notVerified++
  findings.push({ label: "A7/A8 — snapshot-mlb.json missing", expected: "present" })
}

// ── Cluster 3: ROOT-CAUSE LOCATION (whitelist source-code analysis) ────────
console.log("")
console.log("Cluster 3 — ROOT-CAUSE LOCATION")
if (phase4Src) {
  // Extract the toTrackedMlbBestEntry function body.
  const fnMatch = phase4Src.match(/function\s+toTrackedMlbBestEntry[\s\S]*?\n\}/m)
  const body = fnMatch ? fnMatch[0] : ""
  const hasEventId = /eventId\s*:/.test(body)
  const hasDepth = /depth\s*:/.test(body)
  const hasImpliedTeamTotal = /impliedTeamTotal\s*:/.test(body)
  const hasGameTotal = /gameTotal\s*:/.test(body)
  const hasHrEnv = /hrEnvironmentTag\s*:/.test(body)
  const hasLineupSpot = /lineupSpot\s*:/.test(body)
  finding(hasEventId,
    "A9a — toTrackedMlbBestEntry whitelist includes eventId (missing today)",
    "eventId field present")
  finding(hasDepth,
    "A9b — toTrackedMlbBestEntry whitelist includes depth (missing today)",
    "depth field present")
  finding(hasImpliedTeamTotal,
    "A9c — toTrackedMlbBestEntry whitelist includes impliedTeamTotal (missing today)",
    "impliedTeamTotal field present")
  finding(hasGameTotal,
    "A9d — toTrackedMlbBestEntry whitelist includes gameTotal (missing today)",
    "gameTotal field present")
  finding(hasHrEnv,
    "A9e — toTrackedMlbBestEntry whitelist includes hrEnvironmentTag (missing today)",
    "hrEnvironmentTag field present")
  finding(hasLineupSpot,
    "A9f — toTrackedMlbBestEntry whitelist includes lineupSpot (missing today)",
    "lineupSpot field present")
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  Item 0002 hydration verifier — passed=${passed} failed=${failed} not-verified=${notVerified}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  console.error("STRUCTURAL FAILURES (canonical authority drift — must repair):")
  for (const f of failures) console.error(`  - ${f}`)
}
if (notVerified > 0) {
  console.warn("EMPIRICAL FINDINGS (gap-state captured; Item 0002 mutation target):")
  for (const f of findings) console.warn(`  - ${f.label} [expected: ${f.expected}]`)
}
console.log("")
// EXIT CODE doctrine:
//   - Hard exit non-zero ONLY on STRUCTURAL failures (Cluster 1 + A7).
//   - Cluster 2 + Cluster 3 EMPIRICAL findings are NOT-VERIFIED on the
//     current broken state and do NOT block runAllVerifiers.js. They flip to
//     PASS when Item 0002 ships, automatically.
if (failed > 0) {
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
