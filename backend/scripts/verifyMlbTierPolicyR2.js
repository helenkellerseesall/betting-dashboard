"use strict"
// verifyMlbTierPolicyR2 — R2 (MLB-Tier-Assignment-Fix v1) regression fixture.
//
// Verifies, per operator-approved scope (phase1_design.md + §8 answers):
//   1. OFF (MLB_BUCKET_TIER_POLICY=0) ⇒ tierForPlay byte-identical to the
//      pre-R2 ladder across a hand-coded golden matrix (incl. HR + stolenBases).
//   2. ON ⇒ badge caps fire ONLY on (mid-fav AND family!==hr) OR family ks/totalBases.
//   3. Unknown bucket (missing/0 odds) ⇒ mid-fav cap never fires (Trap-1).
//   4. Caps NEVER emit FADE — any OFF ELITE/STRONG maps to ON PLAYABLE-or-same.
//   5. tierPolicy stamp "mlb-r2-v1" on makePlay output IFF ON; key ABSENT when OFF.
//   6. Source assertions: kill-switch read-once, canonical bucketForOdds import
//      (Law 1), call-site threading, phase4Tracking conditional propagation ×2.
//
// MLB_BUCKET_TIER_POLICY is read ONCE at module load, so ON/OFF evaluation runs
// in CHILD processes (spawnSync with explicit env), JSON-emitted via --emit.
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const CLUSTERS = path.join(ROOT, "pipeline", "mlb", "buildMlbPropClusters.js")
const TRACKING = path.join(ROOT, "pipeline", "mlb", "phase4Tracking.js")

// Golden matrix axes. Param sets chosen to land each rung of the pre-R2 ladder.
const PARAM_SETS = {
  P_ELITE:    { edge: 0.13, ev: 0.09, conf: 0.60 },
  P_STRONG:   { edge: 0.08, ev: 0.04, conf: 0.45 },
  P_PLAYABLE: { edge: 0.05, ev: 0.02, conf: 0.30 },
  P_FADE:     { edge: 0.02, ev: 0.01, conf: 0.50 },
}
const FAMILIES = ["hits", "runs", "totalBases", "ks", "hr", "stolenBases"]
const ODDS = [-250, -150, -90, 150, 400, 800, 0, null] // heavy-fav, mid-fav, pickem, mid-dog, longshot, heavy-longshot, unknown, unknown

// Pre-R2 ladder, hand-coded (the golden reference for OFF mode).
function goldenPreR2(edge, ev, conf, family) {
  if (!Number.isFinite(edge) || !Number.isFinite(ev)) return "FADE"
  if (ev <= 0) return "FADE"
  if (edge < 0.04) return "FADE"
  if (family === "stolenBases") return "PLAYABLE"
  const isHr = family === "hr"
  if (!isHr && edge >= 0.1 && ev >= 0.05 && conf >= 0.56) return "ELITE"
  if (isHr && edge >= 0.125 && ev >= 0.085 && conf >= 0.30) return "ELITE"
  if (isHr && edge >= 0.075 && ev >= 0.032 && conf >= 0.22) return "STRONG"
  if (!isHr && edge >= 0.075 && ev >= 0.032 && conf >= 0.42) return "STRONG"
  return "PLAYABLE"
}

// R2 cap rule, hand-coded (the golden reference for ON mode).
function bucketRef(o) {
  const n = Number(o)
  if (Number.isFinite(n) === false || n === 0) return "unknown"
  if (n <= -200) return "heavy-fav"
  if (n <= -110) return "mid-fav"
  if (n <= 110) return "pickem"
  if (n <= 250) return "mid-dog"
  if (n <= 500) return "longshot"
  return "heavy-longshot"
}
function goldenR2On(edge, ev, conf, family, odds) {
  const base = goldenPreR2(edge, ev, conf, family)
  if (base !== "ELITE" && base !== "STRONG") return base
  const capped = (bucketRef(odds) === "mid-fav" && family !== "hr") || family === "ks" || family === "totalBases"
  return capped ? "PLAYABLE" : base
}

// ── child mode: evaluate the REAL module under the env the parent set ──
if (process.argv.includes("--emit")) {
  const mod = require(CLUSTERS)
  const matrix = []
  for (const [pname, p] of Object.entries(PARAM_SETS)) {
    for (const family of FAMILIES) {
      for (const odds of ODDS) {
        matrix.push({ pname, family, odds, tier: mod.tierForPlay(p.edge, p.ev, p.conf, family, odds, 0.62) })
      }
    }
  }
  // 4-arg legacy-caller back-compat probes (no odds/modelProb passed at all)
  const legacy = {
    hitsElite4arg: mod.tierForPlay(0.13, 0.09, 0.60, "hits"),
    ksElite4arg: mod.tierForPlay(0.13, 0.09, 0.60, "ks"),
  }
  // stamp probe via the real makePlay (pure fn)
  const stub = {
    pred: { player: "Fixture Player", eventId: "ev1" },
    mp: { sportsbook: "draftkings", propType: "Hits", marketKey: "batter_hits", gameTime: "2026-06-11T22:00:00Z" },
    family: "hits", side: "over", line: 1.5, odds: -150,
    impliedProb: 0.6, modelProb: 0.66, edge: 0.06, ev: 0.04, conf: 0.5, confRaw: 0.5, vol: 0.3,
    stat: { floor: 0, mostLikely: 1, ceiling: 3 },
    tier: "PLAYABLE", isLongshot: false, isAlternate: false, inCoreOddsBand: true, isHrProp: false, score: 10,
  }
  const play = mod.makePlay(stub)
  console.log(JSON.stringify({ matrix, legacy, stampKeyPresent: Object.prototype.hasOwnProperty.call(play, "tierPolicy"), stampValue: play.tierPolicy ?? null }))
  process.exit(0)
}

// ── parent mode: spawn ON + OFF children, assert against goldens ──
let pass = 0, fail = 0
const failures = []
function check(label, cond) {
  if (cond) { pass++ } else { fail++; failures.push(label) }
}

function runChild(mode) {
  const r = spawnSync(process.execPath, [__filename, "--emit"], {
    env: { ...process.env, MLB_BUCKET_TIER_POLICY: mode },
    encoding: "utf8",
  })
  if (r.status !== 0) {
    console.error(`child (mode=${mode}) failed:\n${r.stderr}`)
    process.exit(1)
  }
  const lines = r.stdout.trim().split("\n")
  return JSON.parse(lines[lines.length - 1]) // last line = JSON (boot log precedes it)
}

const off = runChild("0")
const on = runChild("1")

// 1. OFF === hand-coded pre-R2 golden, every cell.
for (const cell of off.matrix) {
  const p = PARAM_SETS[cell.pname]
  const want = goldenPreR2(p.edge, p.ev, p.conf, cell.family)
  check(`OFF golden ${cell.pname}/${cell.family}/${cell.odds}: ${cell.tier}===${want}`, cell.tier === want)
}
// 2. ON === golden cap rule, every cell (caps fire ONLY mid-fav-non-HR or ks/totalBases).
for (const cell of on.matrix) {
  const p = PARAM_SETS[cell.pname]
  const want = goldenR2On(p.edge, p.ev, p.conf, cell.family, cell.odds)
  check(`ON golden ${cell.pname}/${cell.family}/${cell.odds}: ${cell.tier}===${want}`, cell.tier === want)
}
// 3 + 4. Pairwise: unknown-bucket no-op for the mid-fav rule; caps never FADE; non-cap cells identical.
for (let i = 0; i < off.matrix.length; i++) {
  const o = off.matrix[i], n = on.matrix[i]
  if (o.tier === "ELITE" || o.tier === "STRONG") {
    check(`never-FADE ${o.pname}/${o.family}/${o.odds}`, n.tier !== "FADE" && n.tier !== "LONGSHOT")
  } else {
    check(`non-badge untouched ${o.pname}/${o.family}/${o.odds}`, n.tier === o.tier)
  }
}
// Spot invariants (explicit, beyond the golden sweep):
const onAt = (pname, family, odds) => on.matrix.find((c) => c.pname === pname && c.family === family && Object.is(c.odds, odds)).tier
check("ON: hits ELITE @ -150 capped → PLAYABLE", onAt("P_ELITE", "hits", -150) === "PLAYABLE")
check("ON: hr ELITE @ -150 EXEMPT → ELITE (operator §8 Q1)", onAt("P_ELITE", "hr", -150) === "ELITE")
check("ON: hits ELITE @ -250 heavy-fav NOT capped → ELITE", onAt("P_ELITE", "hits", -250) === "ELITE")
check("ON: hits ELITE @ null odds (unknown bucket, Trap-1) → ELITE", onAt("P_ELITE", "hits", null) === "ELITE")
check("ON: hits ELITE @ 0 odds (unknown bucket, Trap-1) → ELITE", onAt("P_ELITE", "hits", 0) === "ELITE")
check("ON: ks ELITE @ +400 capped (family rule, all buckets) → PLAYABLE", onAt("P_ELITE", "ks", 400) === "PLAYABLE")
check("ON: totalBases STRONG @ -250 capped → PLAYABLE", onAt("P_STRONG", "totalBases", -250) === "PLAYABLE")
check("ON: stolenBases stays PLAYABLE (SHIP 2 preserved)", onAt("P_ELITE", "stolenBases", -150) === "PLAYABLE")
check("OFF: stolenBases stays PLAYABLE (SHIP 2 preserved)", off.matrix.find((c) => c.pname === "P_ELITE" && c.family === "stolenBases" && c.odds === -150).tier === "PLAYABLE")
// 4-arg legacy callers: bucket unknown ⇒ no mid-fav cap; family cap is bucket-independent BY DESIGN.
check("ON: legacy 4-arg hits ELITE unchanged (Trap-1)", on.legacy.hitsElite4arg === "ELITE")
check("ON: legacy 4-arg ks capped → PLAYABLE (family rule needs no odds)", on.legacy.ksElite4arg === "PLAYABLE")
check("OFF: legacy 4-arg hits ELITE", off.legacy.hitsElite4arg === "ELITE")
check("OFF: legacy 4-arg ks ELITE (no cap when OFF)", off.legacy.ksElite4arg === "ELITE")
// 5. Stamp semantics.
check("ON: makePlay stamps tierPolicy=mlb-r2-v1", on.stampKeyPresent === true && on.stampValue === "mlb-r2-v1")
check("OFF: makePlay tierPolicy key ABSENT (not null, not 'off')", off.stampKeyPresent === false)
// 6. Source assertions.
const srcC = fs.readFileSync(CLUSTERS, "utf8")
const srcT = fs.readFileSync(TRACKING, "utf8")
check("src: kill-switch read-once", srcC.includes(`process.env.MLB_BUCKET_TIER_POLICY ?? "1"`))
check("src: boot log tag", srcC.includes("[TIER-POLICY-BOOT] MLB bucket tier policy"))
check("src: canonical bucketForOdds import (Law 1, no dup)", srcC.includes(`require("../nba/nbaTierClassifier")`) && !/function bucketForOdds/.test(srcC))
check("src: call site threads odds + modelProb", srcC.includes("tierForPlay(edge, ev, conf, family, odds, modelProb)"))
check("src: conditional stamp spread in makePlay", srcC.includes(`MLB_TIER_POLICY_ON ? { tierPolicy: "mlb-r2-v1" } : {}`))
check("src: phase4Tracking best-entry conditional propagation", srcT.includes("row?.tierPolicy != null ? { tierPolicy: row.tierPolicy } : {}"))
check("src: phase4Tracking bets-path conditional propagation", srcT.includes("play?.tierPolicy != null ? { tierPolicy: play.tierPolicy } : {}"))

console.log(`\nverifyMlbTierPolicyR2: ${pass}/${pass + fail} PASS`)
if (fail > 0) {
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
