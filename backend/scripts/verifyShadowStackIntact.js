"use strict"
// verifyShadowStackIntact — Phase Shadow-Stack-Guard-1A (2026-06-15)
//
// Deletion guard for the SANCTIONED SHADOW STACK (see PRESERVED.md §"SANCTIONED
// SHADOW STACK — DO NOT DELETE"). These build-ahead, kill-switched engines feed
// NOTHING live by design, so a "cleanup" pass could delete them without any live
// path breaking. This fixture makes that fail LOUD and NAMED before commit:
// each file must exist + export its key function + be listed in PRESERVED.md.
// (Each is also required directly by its per-feature fixture — this is the
// explicit, named backstop so the failure says WHY, not "MODULE_NOT_FOUND".)
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")            // backend/
const REPO = path.join(ROOT, "..")                 // repo root

// file (relative to backend/) → exports that MUST be present
const STACK = [
  ["pipeline/shared/gaussianCopula.js", ["copulaJoint", "fitRhoZ", "biNormalCdf", "invNormalCdf"]],
  ["pipeline/mlb/mlbCorrelationEngine.js", ["jointForPair", "classifyPair"]],
  ["pipeline/shared/isotonicCalibration.js", ["fitIsotonic", "predictIsotonic"]],
  ["pipeline/mlb/mlbMarginalCalibration.js", ["calibrateModelProb", "calibrateDetail"]],
  ["pipeline/mlb/negBinomLadder.js", ["survival", "fitCountsMoM", "fitPlayerFamilyCurve"]], // G2-L1: fitter extension tracked (2026-07-16)
  ["pipeline/mlb/mlbParlayConstructor.js", ["buildParlays", "americanToDecimal"]],
]
// derived-prior configs the stack depends on (regen via derive* scripts, never hand-trim)
const CONFIGS = [
  "config/mlbCorrelationPriors.json",
  "config/mlbMarginalCalibration.json",
]

let pass = 0, fail = 0
const failures = []
const check = (label, cond) => { if (cond) pass++; else { fail++; failures.push(label) } }

// PRESERVED.md must carry the sanctioned-shadow section AND name each file.
let preserved = ""
try { preserved = fs.readFileSync(path.join(REPO, "PRESERVED.md"), "utf8") } catch (_) {}
check("PRESERVED.md has SANCTIONED SHADOW STACK section", /SANCTIONED SHADOW STACK/.test(preserved))

for (const [rel, exportsNeeded] of STACK) {
  const abs = path.join(ROOT, rel)
  const exists = fs.existsSync(abs)
  check(`EXISTS: ${rel} (recover from git, do NOT delete)`, exists)
  if (exists) {
    let mod = null
    try { mod = require(abs) } catch (e) { failures.push(`REQUIRE FAILED: ${rel} — ${e && e.message ? e.message : e}`); fail++ }
    if (mod) for (const fn of exportsNeeded) {
      check(`EXPORT: ${rel} exports ${fn}`, typeof mod[fn] === "function")
    }
  }
  check(`PRESERVED.md lists ${rel.split("/").pop()}`, preserved.includes(rel.split("/").pop()))
}

for (const rel of CONFIGS) {
  const abs = path.join(ROOT, rel)
  const exists = fs.existsSync(abs)
  check(`EXISTS: ${rel} (derived prior — regen, never hand-delete)`, exists)
  if (exists) {
    let ok = false
    try { JSON.parse(fs.readFileSync(abs, "utf8")); ok = true } catch (_) {}
    check(`PARSES: ${rel}`, ok)
  }
}

console.log(`verifyShadowStackIntact: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) {
  console.log("FAILURES (a sanctioned-shadow file is missing/changed — this is a REGRESSION, recover from git):")
  for (const f of failures) console.log("  - " + f)
  process.exit(1)
}
process.exit(0)
