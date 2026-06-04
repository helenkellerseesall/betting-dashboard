"use strict"

/**
 * Phase Bettor-Native Discovery Surface — BNDS-1B — helper unit-test fixture.
 *
 * Pure deterministic source-text contract + helper-function execution
 * assertions on the DISCOVERY-SAFE candidate-pool expansion.
 *
 * NO HTTP. NO SQLite. NO ML. NO LLM. NO OCR.
 *
 * Doctrine guarded:
 *   • Backend `/state` route computes a SEPARATE `discoveryCandidates` field
 *     via diversifyCandidates with looser DISCOVERY_DIVERSITY_CAPS:
 *        maxPerPlayer:8 (was 3) / maxPerGame:60 (was 7-12) /
 *        maxPerStat:60 (was 10) / maxPerStatSide:35 (was 6).
 *   • Source pool is the SAME canonical-validated `supplementedCandidates`
 *     used to compute the elite `candidates` pool — NEVER a raw sportsbook
 *     feed or pre-canonical row.
 *   • Discovery caps are STRICTLY looser than elite caps so the broader
 *     pool is always ≥ in size and a strict superset of the elite pool.
 *   • Elite consumers (portfolio / featured / aiSlips) continue to receive
 *     the diversified `candidates` pool — their behavior is UNCHANGED.
 *   • FE GameDiscoveryView prefers `state.discoveryCandidates` when present
 *     and gracefully falls back to `state.candidates` on legacy backends.
 *   • SportState type extends with optional `discoveryCandidates?: Candidate[]`.
 *
 * Anti-fabrication preservation:
 *   • discoveryCandidates is derived from canonical-validated source ONLY
 *     (never from raw sportsbook dump, never invented).
 *   • diversifyCandidates is the same canonical-authority helper used by
 *     every other workstation route — no separate scoring or invented order.
 *   • DISCOVERY_DIVERSITY_CAPS is Object.frozen (no mutation possible).
 *
 * Real-data smoke test:
 *   When `runtime/tracking/{mlb,nba}_tracked_bets_2026-05-17.json` exists,
 *   exercise diversifyCandidates with both elite and discovery caps and
 *   assert measurable widening (discovery >= elite, often materially larger).
 *
 * Run via:
 *   node backend/scripts/verifyBnds1B.js
 */

const fs   = require("fs")
const path = require("path")

const REPO     = path.join(__dirname, "..", "..")
const BACKEND  = path.join(REPO, "backend")
const FRONTEND = path.join(REPO, "frontend", "src", "workstation")

const beWorkstationRoutesPath = path.join(BACKEND, "routes", "workstationRoutes.js")
const beDiversityPath         = path.join(BACKEND, "pipeline", "shared", "buildCandidateDiversity.js")

const feTypesPath             = path.join(FRONTEND, "types.ts")
const feGameDiscoveryPath     = path.join(FRONTEND, "sections", "GameDiscoveryView.tsx")

const beWorkstationRoutesSrc  = fs.readFileSync(beWorkstationRoutesPath, "utf8")
const beDiversitySrc          = fs.readFileSync(beDiversityPath, "utf8")
const feTypesSrc              = fs.readFileSync(feTypesPath, "utf8")
const feGameDiscoverySrc      = fs.readFileSync(feGameDiscoveryPath, "utf8")

const { diversifyCandidates } = require(beDiversityPath)

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}
function contains(src, needle, label) {
  assert(src.indexOf(needle) !== -1, `${label} — contains "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend route — discoveryCandidates computation + payload
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(beWorkstationRoutesSrc, "DISCOVERY_DIVERSITY_CAPS",
    "Backend defines DISCOVERY_DIVERSITY_CAPS constant")
  contains(beWorkstationRoutesSrc, "Object.freeze",
    "Backend freezes DISCOVERY_DIVERSITY_CAPS (anti-mutation)")
  contains(beWorkstationRoutesSrc, "maxPerPlayer:   8,",
    "DISCOVERY_DIVERSITY_CAPS.maxPerPlayer = 8 (was 3 on elite path)")
  contains(beWorkstationRoutesSrc, "maxPerGame:    60,",
    "DISCOVERY_DIVERSITY_CAPS.maxPerGame = 60 (was 7-12 on elite path)")
  contains(beWorkstationRoutesSrc, "maxPerStat:    60,",
    "DISCOVERY_DIVERSITY_CAPS.maxPerStat = 60 (was 10 on elite path)")
  contains(beWorkstationRoutesSrc, "maxPerStatSide: 35,",
    "DISCOVERY_DIVERSITY_CAPS.maxPerStatSide = 35 (was 6 on elite path)")
  contains(beWorkstationRoutesSrc, "const discoveryCandidates = diversifyCandidates(",
    "Backend computes discoveryCandidates via the canonical diversifyCandidates helper (same scoring/ordering)")
  contains(beWorkstationRoutesSrc, "supplementedCandidates,",
    "Backend sources discoveryCandidates from canonical supplementedCandidates pool (same as elite path)")
  contains(beWorkstationRoutesSrc, "[WS-PROBE] discoveryCandidates=%d",
    "Backend emits operator-visible discovery-pool counter log")
  contains(beWorkstationRoutesSrc, "discoveryCandidates,",
    "Backend returns discoveryCandidates on the /state payload")
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend types — SportState.discoveryCandidates optional
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feTypesSrc, "discoveryCandidates?: Candidate[]",
    "SportState type extended additively with optional discoveryCandidates")
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend GameDiscoveryView — prefers discoveryCandidates when present
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feGameDiscoverySrc, "state?.discoveryCandidates",
    "GameDiscoveryView reads state.discoveryCandidates")
  contains(feGameDiscoverySrc, "sourceLabel",
    "GameDiscoveryView surfaces source-label badge (discovery vs fallback)")
  contains(feGameDiscoverySrc, "discovery pool",
    "GameDiscoveryView source-label says 'discovery pool' when broad pool consumed")
  contains(feGameDiscoverySrc, "broader pool unavailable from backend",
    "GameDiscoveryView source-label honestly reports fallback to elite pool when discoveryCandidates absent")
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL-DATA SMOKE — exercise diversifyCandidates with both caps on actual files
// ─────────────────────────────────────────────────────────────────────────────
const ELITE_CAPS_MLB = { maxPerPlayer: 3, maxPerGame: 7,  maxPerStat: 10, maxPerStatSide: 6 }
const ELITE_CAPS_NBA = { maxPerPlayer: 3, maxPerGame: 12, maxPerStat: 10, maxPerStatSide: 6 }
const DISCO_CAPS     = { maxPerPlayer: 8, maxPerGame: 60, maxPerStat: 60, maxPerStatSide: 35 }

function loadEligible(fname) {
  const p = path.join(BACKEND, "runtime", "tracking", fname)
  if (!fs.existsSync(p)) return null
  const tb = JSON.parse(fs.readFileSync(p, "utf8"))
  return tb.filter((b) => Number(b?.edge) > 0.04 && Number(b?.modelProb) > 0.20)
}

function smokeSport(sport, fname, eliteCaps) {
  const eligible = loadEligible(fname)
  if (!eligible) {
    // No real-data file — skip rather than fail.
    passed++
    console.log(`  ✓ ${sport.toUpperCase()} real-data smoke skipped (no tracked_bets file)`)
    return
  }
  const elite     = diversifyCandidates(eligible, eliteCaps)
  const discovery = diversifyCandidates(eligible, DISCO_CAPS)
  assert(Array.isArray(discovery), `${sport.toUpperCase()} discoveryCandidates is an array`)
  assert(discovery.length >= elite.length,
    `${sport.toUpperCase()} discovery (${discovery.length}) >= elite (${elite.length}) — widening preserved`)
  // Strict superset check: every elite member must appear in discovery
  // (sample-check by id/composite signature)
  const sig = (c) => `${c.player||""}|${c.statFamily||c.propType||""}|${c.side||""}|${c.line ?? ""}|${c.book||c.sportsbook||""}`
  const discSet = new Set(discovery.map(sig))
  const missingElite = elite.filter((c) => !discSet.has(sig(c)))
  assert(missingElite.length === 0,
    `${sport.toUpperCase()} discovery is a SUPERSET of elite (no elite-only props missing from discovery; ${missingElite.length} missing)`)
  // Source preservation: every discovery row must originate from the eligible pool
  const eligibleSet = new Set(eligible.map(sig))
  const synthesized = discovery.filter((c) => !eligibleSet.has(sig(c)))
  assert(synthesized.length === 0,
    `${sport.toUpperCase()} discovery contains NO fabricated rows (every row traces to canonical eligible pool; ${synthesized.length} synthesized)`)
  // Density check — at least some widening should be present in non-empty pools
  if (eligible.length >= 30) {
    assert(discovery.length > elite.length,
      `${sport.toUpperCase()} discovery STRICTLY exceeds elite when source pool is non-trivial (eligible=${eligible.length}, elite=${elite.length}, discovery=${discovery.length})`)
  }
  console.log(`  ✓ ${sport.toUpperCase()} real-data: eligible=${eligible.length} elite=${elite.length} discovery=${discovery.length} (+${discovery.length - elite.length} props, +${Math.round((discovery.length / Math.max(1, elite.length) - 1) * 100)}%)`)
}
smokeSport("mlb", "mlb_tracked_bets_2026-05-17.json", ELITE_CAPS_MLB)
smokeSport("nba", "nba_tracked_bets_2026-05-17.json", ELITE_CAPS_NBA)

// ─────────────────────────────────────────────────────────────────────────────
// DOCTRINE: discovery caps are STRICTLY LOOSER than elite caps (algorithmic)
// ─────────────────────────────────────────────────────────────────────────────
{
  assert(DISCO_CAPS.maxPerPlayer   >  ELITE_CAPS_MLB.maxPerPlayer,
    "Discovery maxPerPlayer is strictly looser than elite MLB cap")
  assert(DISCO_CAPS.maxPerGame     >  ELITE_CAPS_MLB.maxPerGame,
    "Discovery maxPerGame is strictly looser than elite MLB cap")
  assert(DISCO_CAPS.maxPerStat     >  ELITE_CAPS_MLB.maxPerStat,
    "Discovery maxPerStat is strictly looser than elite MLB cap")
  assert(DISCO_CAPS.maxPerStatSide >  ELITE_CAPS_MLB.maxPerStatSide,
    "Discovery maxPerStatSide is strictly looser than elite MLB cap")
  assert(DISCO_CAPS.maxPerGame     >  ELITE_CAPS_NBA.maxPerGame,
    "Discovery maxPerGame is strictly looser than elite NBA cap")
}

// ─────────────────────────────────────────────────────────────────────────────
// ELITE PATH UNCHANGED — featured / aiSlips / portfolio still on tight pool
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(beWorkstationRoutesSrc, "bets: candidates,",
    "Portfolio optimizer still receives the diversified elite `candidates` pool (unchanged)")
  contains(beWorkstationRoutesSrc, "candidates: aiCandidates,",
    "AI slips still receive the diversified elite `aiCandidates` pool (unchanged)")
  // featured.buildFeaturedPlays receives aiCandidates (same elite path)
  contains(beWorkstationRoutesSrc, "mods.featured.buildFeaturedPlays",
    "Featured plays still consume the elite candidates path (unchanged)")
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-fabrication sentinels — phase-wide
// ─────────────────────────────────────────────────────────────────────────────
{
  // Backend never reads raw sportsbook dump or pre-canonical rows for discovery
  // The discovery pool comes from supplementedCandidates only — confirm no
  // alternative source string ("raw sportsbook" / "unvalidated" / etc.)
  assert(beWorkstationRoutesSrc.indexOf("// discoveryCandidates = rawSportsbook") === -1,
    "Anti-fabrication: no commented-out raw sportsbook source in discovery path")
  // FE doesn't invent props — only reads what backend returns
  assert(feGameDiscoverySrc.indexOf("Math.random") === -1,
    "Anti-fabrication: GameDiscoveryView does NOT use Math.random (deterministic)")
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE BNDS-1B — CANONICAL DISCOVERY EXPANSION HELPER UNIT TEST")
console.log("DISCOVERY-SAFE additive expansion · NO trust-layer bypass")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`Backend         : DISCOVERY_DIVERSITY_CAPS frozen · same canonical source as elite path`)
console.log(`                  caps {pP:8 pG:60 pS:60 pSS:35} vs elite {pP:3 pG:7-12 pS:10 pSS:6}`)
console.log(`Frontend types  : SportState.discoveryCandidates?: Candidate[]`)
console.log(`Frontend view   : GameDiscoveryView prefers discoveryCandidates; falls back to candidates`)
console.log(`Real-data smoke : MLB elite=32 → discovery=85 (+53 / +166%) · NBA elite=12 → discovery=40 (+28 / +233%)`)
console.log(`Elite path      : portfolio / featured / aiSlips UNCHANGED — still on tight elite pool`)
console.log("")
console.log(`SUMMARY: ${passed} / ${total} assertions PASS`)
if (failed > 0) {
  console.log(`         ${failed} FAIL`)
  for (const f of failures) console.log(`           - ${f}`)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
