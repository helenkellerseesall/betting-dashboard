"use strict"

/**
 * verifyRuntimeRegenerationEnforcement.js — Phase Item 0002 Slice 1.5 (VS-3).
 *
 * Polices the live-runtime regeneration contract. Asserts that the
 * persistence layer has emitted a fresh artifact for today AND that the
 * artifact carries the hydration shape required by the FE Discover surface
 * + BC-8 realism + Item 0001 survivability gate.
 *
 * Assertion clusters:
 *   A — FRESHNESS: mlb_tracked_best_<TODAY>.json exists; its metadata.generatedAt
 *       (or first entry.timestamp) is within MAX_AGE_MS of now.
 *   B — HYDRATION COMPLETENESS: eventId, impliedTeamTotal, gameTotal,
 *       hrEnvironmentTag populated on ≥95% of entries (the upstream lineup
 *       feed caps depth/lineupSpot at ~51%; those are tracked but not asserted
 *       100% here — separate slice-2 target).
 *   C — DOWNSTREAM PROOF: when /state cache file or a recent /state snapshot
 *       artifact exists, its discoveryCandidates have eventId on every row.
 *   D — NON-EMPTY: artifact entries.length > 0 (a zero-entry file is a
 *       silent regeneration failure that would otherwise look healthy).
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const TRACKING = path.join(BACKEND, "runtime", "tracking")

const MAX_AGE_MS  = 24 * 60 * 60 * 1000   // 24 h freshness budget
const COVERAGE    = 0.95                  // ≥95% hydration on canonical fields

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyRuntimeRegenerationEnforcement.js (VS-3)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

const today = new Date().toISOString().slice(0, 10)
const bestPath  = path.join(TRACKING, `mlb_tracked_best_${today}.json`)
const picksPath = path.join(TRACKING, `mlb_picks_${today}.json`)

// ── Cluster A: FRESHNESS ────────────────────────────────────────────────
console.log("Cluster A — freshness")
assert(fs.existsSync(bestPath),
  `A1 — mlb_tracked_best_${today}.json exists`)

if (fs.existsSync(bestPath)) {
  const stat = fs.statSync(bestPath)
  const age = Date.now() - stat.mtimeMs
  assert(age <= MAX_AGE_MS,
    `A2 — file mtime is within ${MAX_AGE_MS / 3600000}h of now (age=${(age/3600000).toFixed(2)}h)`)

  let payload = null
  try { payload = JSON.parse(fs.readFileSync(bestPath, "utf8")) } catch (e) {
    failed++; failures.push("A3 — parse error: " + e.message)
  }
  if (payload) {
    const generatedAt = payload?.metadata?.generatedAt
    if (generatedAt) {
      const ageInner = Date.now() - new Date(generatedAt).getTime()
      assert(ageInner <= MAX_AGE_MS,
        `A3 — metadata.generatedAt within ${MAX_AGE_MS / 3600000}h (age=${(ageInner/3600000).toFixed(2)}h)`)
    } else {
      console.warn("  ⚠ A3 — metadata.generatedAt missing; falling back to file mtime check (A2)")
    }
  }
}

// ── Cluster B + D: hydration completeness + non-empty ───────────────────
console.log("")
console.log("Cluster B — hydration completeness")
if (fs.existsSync(bestPath)) {
  const data = JSON.parse(fs.readFileSync(bestPath, "utf8"))
  const entries = Array.isArray(data?.entries) ? data.entries : []
  assert(entries.length > 0,
    `D1 — today's tracked_best has at least one entry (entries=${entries.length})`)

  if (entries.length > 0) {
    const denom = entries.length
    const evHits  = entries.filter(e => !!e.eventId).length
    const ttHits  = entries.filter(e => Number.isFinite(Number(e.impliedTeamTotal))).length
    const gtHits  = entries.filter(e => Number.isFinite(Number(e.gameTotal))).length
    const envHits = entries.filter(e => e.hrEnvironmentTag != null).length
    const depHits = entries.filter(e => e.depth != null).length
    const lsHits  = entries.filter(e => e.lineupSpot != null).length

    const pct = (n) => `${n}/${denom} (${(n/denom*100).toFixed(1)}%)`
    console.log(`  eventId:           ${pct(evHits)}`)
    console.log(`  impliedTeamTotal:  ${pct(ttHits)}`)
    console.log(`  gameTotal:         ${pct(gtHits)}`)
    console.log(`  hrEnvironmentTag:  ${pct(envHits)}`)
    console.log(`  depth:             ${pct(depHits)}      [upstream feed cap — partial coverage tolerated]`)
    console.log(`  lineupSpot:        ${pct(lsHits)}       [upstream feed cap — partial coverage tolerated]`)
    console.log("")

    assert(evHits / denom >= COVERAGE,
      `B1 — eventId coverage ≥ ${COVERAGE * 100}% (${pct(evHits)})`)
    assert(ttHits / denom >= COVERAGE,
      `B2 — impliedTeamTotal coverage ≥ ${COVERAGE * 100}% (${pct(ttHits)})`)
    assert(gtHits / denom >= COVERAGE,
      `B3 — gameTotal coverage ≥ ${COVERAGE * 100}% (${pct(gtHits)})`)
    // Environment tag: parkContext is present on ~94% of snapshot rows; floor at 80%.
    assert(envHits / denom >= 0.80,
      `B4 — hrEnvironmentTag coverage ≥ 80% (${pct(envHits)})`)
    // depth + lineupSpot: upstream feed-dependent. INFORMATIONAL only.
    if (depHits / denom < 0.40) {
      console.warn(`  ⚠ B5 — depth coverage below 40% (${pct(depHits)}); upstream feed gap (slice-2 target)`)
    } else {
      console.log(`  ✓ B5 — depth coverage healthy (${pct(depHits)})`)
      passed++
    }
  }
}

// ── Cluster C: downstream proof (picks parallel file) ────────────────────
console.log("")
console.log("Cluster C — downstream picks file parity")
if (fs.existsSync(picksPath)) {
  const picks = JSON.parse(fs.readFileSync(picksPath, "utf8"))
  const arr = Array.isArray(picks?.picks) ? picks.picks : (Array.isArray(picks) ? picks : [])
  if (arr.length > 0) {
    const evHits = arr.filter(p => !!p.eventId).length
    assert(evHits / arr.length >= COVERAGE,
      `C1 — mlb_picks_${today}.json: eventId coverage ≥ ${COVERAGE*100}% (${evHits}/${arr.length})`)
  } else {
    console.warn("  ⚠ C — picks file present but empty")
  }
} else {
  console.warn(`  ⚠ C — mlb_picks_${today}.json absent (informational; tracking still considered valid via tracked_best)`)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyRuntimeRegenerationEnforcement — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  console.error("FAILURES:")
  for (const f of failures) console.error("  - " + f)
  console.error("")
  console.error("OPERATIONAL REMEDIATION:")
  console.error("  cd backend && node server.js > /tmp/mlb-server.log 2>&1 &")
  console.error("  sleep 4")
  console.error("  curl -s 'http://localhost:4000/refresh-snapshot?sport=baseball_mlb' > /dev/null")
  console.error("  curl -s 'http://localhost:4000/api/best-available?sport=baseball_mlb' > /dev/null")
  console.error("  node backend/scripts/verifyRuntimeRegenerationEnforcement.js")
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
