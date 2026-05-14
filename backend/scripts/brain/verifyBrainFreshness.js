#!/usr/bin/env node
"use strict"

/**
 * BRAIN FRESHNESS VERIFICATION — advisory check.
 *
 *   node backend/scripts/brain/verifyBrainFreshness.js
 *   npm run brain:verify
 *
 * Checks (each emits OK / WARN / FAIL on stdout):
 *   1. All 8 brain documents present
 *   2. Each brain doc has a "_Last updated:" header line
 *   3. MASTER_BRAIN.md has all required sections
 *   4. ARCHITECTURE_LAWS.md has 17 numbered laws (current count, kept as-is unless intentionally extended)
 *   5. ACTIVE_INCIDENTS.md has an OPEN section
 *   6. PIPELINE_AUTHORITY_MAP.md references at least the canonical owner files
 *   7. SPORTSBOOK_CONTRACTS.md references the API-NBA contract
 *   8. MODEL_EVOLUTION_LOG.md has at least one dated entry
 *   9. Runtime-code mtime vs brain mtime — WARN if code is newer than brain
 *  10. Regression-matrix scripts exist (count >= 14 expected)
 *
 * Exit code: 0 if no FAILs, 1 otherwise. WARNs do not fail.
 */

const fs   = require("fs")
const path = require("path")
const lib  = require("./_brainLib")

let fails = 0
let warns = 0
const lines = []

function ok(msg)   { lines.push("  OK    — " + msg) }
function warn(msg) { lines.push("  WARN  — " + msg); warns += 1 }
function fail(msg) { lines.push("  FAIL  — " + msg); fails += 1 }
function header(s) { lines.push("\n" + s + "\n" + "─".repeat(70)) }

function check1_filesPresent() {
  header("1. Brain documents present")
  for (const f of lib.BRAIN_FILES) {
    const p = path.join(lib.BRAIN_DIR, f)
    if (fs.existsSync(p)) ok(`${f} present`)
    else                  fail(`${f} MISSING`)
  }
}

function check2_lastUpdatedHeaders() {
  header("2. Each brain doc carries a `_Last updated:` header")
  for (const f of lib.BRAIN_FILES) {
    if (f === "README.md") continue // README is a workflow doc, no date
    const content = lib.readBrainFile(f)
    if (!content) { fail(`${f} unreadable`); continue }
    const updated = lib.extractLastUpdated(content)
    if (updated) ok(`${f}: ${updated}`)
    else         warn(f + " missing '_Last updated:' line")
  }
}

function check3_masterBrainSections() {
  header("3. MASTER_BRAIN.md required sections")
  const required = [
    "## CORE REPO PURPOSE",
    "## CURRENT PROJECT PHASE",
    "## CANONICAL AUTHORITIES",
    "## RUNTIME TOPOLOGY",
    "## INGESTION TOPOLOGY",
    "## FREEZE / EPOCH RULES",
    "## GRADING RULES",
    "## SNAPSHOT RULES",
    "## CACHE AUTHORITY RULES",
    "## RESPONSE AUTHORITY RULES",
    "## ENTITY / COMPOSITE-KEY RULES",
    "## OBSERVABILITY STANDARDS",
    "## KNOWN FAILURE PATTERNS",
    "## ACTIVE TECH DEBT",
    "## CURRENT PRIORITIES",
    "## DO NOT REINTRODUCE",
    "## PATCH DISCIPLINE",
    "## API CONTRACT HISTORY",
    "## NBA STATUS",
    "## MLB STATUS",
    "## NEXT MAJOR PHASES",
  ]
  const content = lib.readBrainFile("MASTER_BRAIN.md") || ""
  for (const s of required) {
    if (content.includes(s)) ok(`section present: ${s}`)
    else                     fail(`section missing: ${s}`)
  }
}

function check4_architectureLaws() {
  header("4. ARCHITECTURE_LAWS.md — 17 numbered laws expected")
  const laws = lib.extractArchitectureLaws(lib.readBrainFile("ARCHITECTURE_LAWS.md"))
  if (laws.length === 17) ok(`exactly 17 laws found`)
  else                    warn(`found ${laws.length} laws (17 is the current baseline; intentional changes OK)`)
  for (let i = 1; i <= laws.length; i++) {
    const l = laws.find((x) => x.n === i)
    if (l) ok(`Law ${i} — ${l.title}`)
    else   fail(`Law ${i} missing from numbering`)
  }
}

function checkOperatorProtocolSections() {
  header("5a. OPERATOR_PROTOCOL.md required sections (operator-doctrine layer)")
  const required = [
    "## RESPONSE STYLE",
    "## PATCH WORKFLOW",
    "## TERMINAL WORKFLOW",
    "## CHECKPOINT DISCIPLINE",
    "## VERIFICATION ORDER",
    "## PROMPT DISCIPLINE",
    "## OPERATOR EXPECTATIONS",
    "## ANTI-DRIFT RULES",
    "## ARCHITECTURE PRESERVATION RULES",
    "## SESSION CONTINUITY RULES",
    "## FAILURE PATTERNS TO AVOID",
    "## COMMAND FORMATTING RULES",
    "## CHAT PORTING WORKFLOW",
    "## AI ORCHESTRATION MODEL",
  ]
  const content = lib.readBrainFile("OPERATOR_PROTOCOL.md") || ""
  if (!content) { fail("OPERATOR_PROTOCOL.md missing"); return }
  for (const s of required) {
    if (content.includes(s)) ok(`section present: ${s}`)
    else                     fail(`section missing: ${s}`)
  }
}

function check5_incidentsHasOpenSection() {
  header("5. ACTIVE_INCIDENTS.md has an OPEN section")
  const content = lib.readBrainFile("ACTIVE_INCIDENTS.md") || ""
  if (/##\s+OPEN/.test(content)) ok("OPEN section present")
  else                           fail("OPEN section missing")
  if (/##\s+RESOLVED/.test(content)) ok("RESOLVED section present")
  else                               warn("RESOLVED section missing")
}

function check6_authorityMapReferences() {
  header("6. PIPELINE_AUTHORITY_MAP.md references canonical owner files")
  const content = lib.readBrainFile("PIPELINE_AUTHORITY_MAP.md") || ""
  const expectedRefs = [
    "backend/storage/intelligence.js",
    "backend/storage/intelligenceSchema.js",
    "backend/http/nbaIsolatedRoutes.js",
    "backend/pipeline/shared/snapshotFreshness.js",
    "backend/pipeline/shared/mlbFutureOnly.js",
    "backend/pipeline/shared/probabilityHonesty.js",
    "backend/routes/workstationRoutes.js",
  ]
  for (const ref of expectedRefs) {
    if (content.includes(ref)) ok(`references ${ref}`)
    else                        warn(`does NOT reference ${ref}`)
  }
}

function check7_sportsbookContracts() {
  header("7. SPORTSBOOK_CONTRACTS.md references API-NBA")
  const content = lib.readBrainFile("SPORTSBOOK_CONTRACTS.md") || ""
  if (/v2\.nba\.api-sports\.io/.test(content)) ok("references v2.nba.api-sports.io endpoint")
  else                                          fail("does NOT reference v2.nba.api-sports.io")
  if (/\/players/.test(content))                 ok("references /players endpoint")
  else                                            warn("does NOT reference /players")
  if (/F6\.3/.test(content))                     ok("references F6.3 phase")
  else                                            warn("does NOT reference F6.3 phase")
}

function check8_evolutionLogHasDatedEntries() {
  header("8. MODEL_EVOLUTION_LOG.md has dated entries")
  const entries = lib.extractRecentEvolutionEntries(lib.readBrainFile("MODEL_EVOLUTION_LOG.md"), 100)
  if (entries.length >= 1) ok(`found ${entries.length} dated entries`)
  else                     fail("no dated entries found")
  if (entries.length >= 1) ok(`most recent: ${entries[0].date} — ${entries[0].title}`)
}

function check9_brainVsRuntimeMtime() {
  header("9. Brain mtime vs runtime-code mtime")
  const brainM = lib.brainDirMostRecentMtime()
  const codeM  = lib.runtimeCodeMostRecentMtime()
  if (!brainM) fail("brain dir has no files with mtime")
  if (!codeM)  fail("runtime code dirs have no files with mtime")
  if (brainM && codeM) {
    const lag = lib.diffMinutes(codeM, brainM)
    if (lag > 60)        warn(`runtime code is ${lag} min newer than brain — brain may be stale`)
    else if (lag > 0)    ok(`runtime code only ${lag} min newer than brain — within acceptable window`)
    else                 ok(`brain is at-or-newer than runtime code (${-lag} min)`)
  }
}

function check10_regressionMatrix() {
  header("10. Regression matrix scripts (verify*.js)")
  const fixtures = lib.listRegressionMatrix()
  if (fixtures.length >= 14) ok(`${fixtures.length} verify scripts present (>= 14 expected)`)
  else                       warn(`only ${fixtures.length} verify scripts present (expected >= 14)`)
}

function run() {
  console.log("╔" + "═".repeat(68) + "╗")
  console.log("║  BRAIN FRESHNESS VERIFICATION                                       ║")
  console.log("╚" + "═".repeat(68) + "╝")
  try {
    check1_filesPresent()
    check2_lastUpdatedHeaders()
    check3_masterBrainSections()
    check4_architectureLaws()
    checkOperatorProtocolSections()
    check5_incidentsHasOpenSection()
    check6_authorityMapReferences()
    check7_sportsbookContracts()
    check8_evolutionLogHasDatedEntries()
    check9_brainVsRuntimeMtime()
    check10_regressionMatrix()
  } catch (err) {
    fail("unexpected exception: " + (err && err.stack ? err.stack : err))
  }
  console.log(lines.join("\n"))
  console.log("\n──────────────────────────────────────────────────────────────────────")
  console.log(`SUMMARY: ${fails} FAIL  •  ${warns} WARN`)
  console.log("RESULT: " + (fails === 0 ? "PASS" : "FAIL"))
  if (fails > 0) process.exitCode = 1
}

run()
