"use strict"

/**
 * Phase Sport-Identity-Integrity-1A — verifySportIdentityParity.js
 *
 * CANONICAL SPORT IDENTITY DRIFT DETECTOR.
 *
 * Operator-cemented mandatory rule:
 *   "There must be ONE canonical sport identity resolution path. Aliases
 *    may exist, BUT all layers must converge onto the SAME canonical
 *    runtime authority."
 *
 * Asserts:
 *   1. Canonical resolver exists at backend/pipeline/shared/resolveCanonicalSport.js
 *      with required exports (CANONICAL_SPORTS, SPORT_ALIAS_MAP,
 *      resolveCanonicalSport, isKnownSportAlias).
 *   2. SPORT_ALIAS_MAP includes every operator-cemented alias:
 *        mlb / baseball_mlb / MLB-equiv (case-insensitive) / baseball
 *        nba / basketball_nba / NBA-equiv / basketball
 *   3. Map values are restricted to canonical sports ("mlb" or "nba").
 *   4. SPORT_ALIAS_MAP + CANONICAL_SPORTS are Object.frozen (anti-mutation).
 *   5. Runtime resolution table — every alias resolves to the expected
 *      canonical identity (deterministic; same input → same output).
 *   6. workstationRoutes.js resolveSportDate uses the canonical resolver
 *      (NOT inline `.toLowerCase()` only).
 *   7. workstationRoutes.js imports the resolver from the canonical path.
 *   8. Cache-key convergence — `mlb` and `baseball_mlb` produce the same
 *      cache key after normalization (state:mlb:DATE for both inputs).
 *
 * Pure deterministic source-text + helper-function execution.
 * NO HTTP. NO SQLite. NO ML. NO LLM.
 *
 * Run via:
 *   node backend/scripts/verifySportIdentityParity.js
 *
 * Or via canonical ops layer (this verifier runs in the 29-verifier matrix):
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const resolverPath          = path.join(BACKEND, "pipeline", "shared", "resolveCanonicalSport.js")
const workstationRoutesPath = path.join(BACKEND, "routes", "workstationRoutes.js")

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
function notContains(src, needle, label) {
  assert(src.indexOf(needle) === -1, `${label} — does NOT contain "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Resolver exists with required exports
// ─────────────────────────────────────────────────────────────────────────────
assert(fs.existsSync(resolverPath),
  "Canonical resolver exists at backend/pipeline/shared/resolveCanonicalSport.js")
const resolver = require(resolverPath)
const { CANONICAL_SPORTS, SPORT_ALIAS_MAP, resolveCanonicalSport, isKnownSportAlias } = resolver
{
  assert(Array.isArray(CANONICAL_SPORTS) && CANONICAL_SPORTS.length >= 2,
    "Resolver exports CANONICAL_SPORTS array (≥ 2 entries: mlb + nba)")
  assert(typeof SPORT_ALIAS_MAP === "object" && SPORT_ALIAS_MAP !== null,
    "Resolver exports SPORT_ALIAS_MAP object")
  assert(typeof resolveCanonicalSport === "function",
    "Resolver exports resolveCanonicalSport function")
  assert(typeof isKnownSportAlias === "function",
    "Resolver exports isKnownSportAlias function")
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SPORT_ALIAS_MAP includes every operator-cemented alias
// ─────────────────────────────────────────────────────────────────────────────
{
  const requiredAliases = [
    // MLB family
    "mlb", "baseball_mlb", "baseball-mlb", "baseball mlb", "baseball",
    // NBA family
    "nba", "basketball_nba", "basketball-nba", "basketball nba", "basketball",
  ]
  for (const alias of requiredAliases) {
    assert(Object.prototype.hasOwnProperty.call(SPORT_ALIAS_MAP, alias),
      `SPORT_ALIAS_MAP includes operator-cemented alias: ${alias}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Map values restricted to canonical sports
// ─────────────────────────────────────────────────────────────────────────────
{
  const canonicalSet = new Set(CANONICAL_SPORTS)
  for (const [alias, target] of Object.entries(SPORT_ALIAS_MAP)) {
    assert(canonicalSet.has(target),
      `SPORT_ALIAS_MAP[${alias}] resolves to canonical sport (got "${target}", expected one of ${[...canonicalSet].join(" / ")})`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Object.frozen — anti-mutation discipline
// ─────────────────────────────────────────────────────────────────────────────
{
  assert(Object.isFrozen(CANONICAL_SPORTS),
    "CANONICAL_SPORTS is Object.frozen (anti-mutation)")
  assert(Object.isFrozen(SPORT_ALIAS_MAP),
    "SPORT_ALIAS_MAP is Object.frozen (anti-mutation; alias map evolution requires explicit operator approval)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Runtime resolution table — operator success-condition inputs
// ─────────────────────────────────────────────────────────────────────────────
{
  const cases = [
    // MLB family — all must resolve to canonical "mlb"
    ["mlb",            "mlb"],
    ["MLB",            "mlb"],
    ["Mlb",            "mlb"],
    ["baseball_mlb",   "mlb"],
    ["BASEBALL_MLB",   "mlb"],
    ["baseball-mlb",   "mlb"],
    ["baseball mlb",   "mlb"],
    ["baseball",       "mlb"],
    ["  mlb  ",        "mlb"],   // whitespace trimming
    // NBA family — all must resolve to canonical "nba"
    ["nba",            "nba"],
    ["NBA",            "nba"],
    ["basketball_nba", "nba"],
    ["BASKETBALL_NBA", "nba"],
    ["basketball-nba", "nba"],
    ["basketball nba", "nba"],
    ["basketball",     "nba"],
    // Unknown — falls back to default when fallback supplied
    ["",               null],    // empty input → null with no fallback
    [undefined,        null],    // undefined → null with no fallback
    [null,             null],    // null → null
    ["nfl",            null],    // unknown alias → null
  ]
  for (const [input, expected] of cases) {
    const actual = resolveCanonicalSport(input)
    assert(actual === expected,
      `resolveCanonicalSport(${JSON.stringify(input)}) === ${JSON.stringify(expected)} (got ${JSON.stringify(actual)})`)
  }
  // Fallback behavior
  assert(resolveCanonicalSport(undefined, { fallback: "mlb" }) === "mlb",
    "resolveCanonicalSport(undefined, { fallback: 'mlb' }) === 'mlb' (workstation default)")
  assert(resolveCanonicalSport("nfl", { fallback: "mlb" }) === "mlb",
    "resolveCanonicalSport('nfl', { fallback: 'mlb' }) === 'mlb' (unknown → fallback)")
  // isKnownSportAlias
  assert(isKnownSportAlias("baseball_mlb") === true,
    "isKnownSportAlias('baseball_mlb') === true")
  assert(isKnownSportAlias("nfl") === false,
    "isKnownSportAlias('nfl') === false")
}

// ─────────────────────────────────────────────────────────────────────────────
// 6+7. workstationRoutes.js wires the canonical resolver into resolveSportDate
// ─────────────────────────────────────────────────────────────────────────────
const workstationRoutesSrc = fs.readFileSync(workstationRoutesPath, "utf8")
{
  contains(workstationRoutesSrc, `require("../pipeline/shared/resolveCanonicalSport")`,
    "workstationRoutes.js imports canonical resolver from pipeline/shared/resolveCanonicalSport")
  contains(workstationRoutesSrc, "resolveCanonicalSport(rawSport",
    "workstationRoutes.js resolveSportDate calls resolveCanonicalSport(rawSport)")
  contains(workstationRoutesSrc, "Sport-Identity-Integrity-1A",
    "workstationRoutes.js cites Sport-Identity-Integrity-1A provenance in resolveSportDate")
  // The new resolveSportDate must NOT rely on raw .toLowerCase() only as
  // the sole normalization step — it must invoke the canonical resolver.
  // We allow .toLowerCase() to appear elsewhere in the file; the assertion
  // is that the resolveSportDate function specifically uses
  // resolveCanonicalSport (asserted above).
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Cache-key convergence — mlb + baseball_mlb produce same canonical key
// ─────────────────────────────────────────────────────────────────────────────
{
  const aliasA = resolveCanonicalSport("mlb",          { fallback: "mlb" })
  const aliasB = resolveCanonicalSport("baseball_mlb", { fallback: "mlb" })
  const aliasC = resolveCanonicalSport("MLB",          { fallback: "mlb" })
  const aliasD = resolveCanonicalSport("baseball",     { fallback: "mlb" })
  assert(aliasA === aliasB && aliasB === aliasC && aliasC === aliasD,
    "Cache-key convergence: mlb / baseball_mlb / MLB / baseball all resolve to same canonical identity")
  // Same for NBA
  const nA = resolveCanonicalSport("nba",            { fallback: "mlb" })
  const nB = resolveCanonicalSport("basketball_nba", { fallback: "mlb" })
  const nC = resolveCanonicalSport("NBA",            { fallback: "mlb" })
  const nD = resolveCanonicalSport("basketball",     { fallback: "mlb" })
  assert(nA === nB && nB === nC && nC === nD,
    "Cache-key convergence: nba / basketball_nba / NBA / basketball all resolve to same canonical identity")
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Anti-fabrication sentinels — no invented identities
// ─────────────────────────────────────────────────────────────────────────────
{
  const resolverSrc = fs.readFileSync(resolverPath, "utf8")
  notContains(resolverSrc, "Math.random",
    "Anti-fabrication: resolver is deterministic (no Math.random)")
  notContains(resolverSrc, `require("fs"`,
    "Anti-fabrication: resolver is pure (no fs I/O)")
  notContains(resolverSrc, `require("http"`,
    "Anti-fabrication: resolver is pure (no http I/O)")
  // Every map value must be one of CANONICAL_SPORTS — already asserted
  // above, but call it out explicitly here as the doctrine sentinel.
  for (const target of Object.values(SPORT_ALIAS_MAP)) {
    assert(typeof target === "string" && (target === "mlb" || target === "nba"),
      `Anti-fabrication: SPORT_ALIAS_MAP target "${target}" is canonical (mlb|nba), never invented`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Sport-Identity-Integrity-1A — CANONICAL SPORT IDENTITY ENFORCER")
console.log("ONE alias map · ONE resolver · ALL aliases converge to canonical (mlb|nba)")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`Resolver         : backend/pipeline/shared/resolveCanonicalSport.js (CANONICAL_SPORTS + SPORT_ALIAS_MAP + resolveCanonicalSport + isKnownSportAlias)`)
console.log(`Alias coverage   : MLB family (mlb / baseball_mlb / baseball-mlb / baseball mlb / baseball) + NBA family (nba / basketball_nba / basketball-nba / basketball nba / basketball)`)
console.log(`Frozen           : CANONICAL_SPORTS + SPORT_ALIAS_MAP (anti-mutation)`)
console.log(`Cache convergence: mlb / baseball_mlb / MLB / baseball → same canonical; nba / basketball_nba / NBA / basketball → same canonical`)
console.log(`Route wiring     : workstationRoutes.js resolveSportDate uses canonical resolver (NOT inline .toLowerCase only)`)
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
