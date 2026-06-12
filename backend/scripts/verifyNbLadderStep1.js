"use strict"
// verifyNbLadderStep1 — T2 Step 1 (mlb-nb-ladder-v1) regression fixture.
//
// Verifies, per operator-approved plan (docs/audits/2026-06-12-t2-ladders/step1_audit_plan.md):
//   1. negBinomLadder math vs hand-computed references (NB + Poisson + fit + floor).
//   2. projectHitterStats emits totalBases.ladderNB + meta IFF MLB_NB_LADDER ON
//      and sample n≥10 (via __nbGamesOverride — deterministic, no fs).
//   3. OFF ⇒ ladderNB key ABSENT ⇒ predictions byte-identical (shadow doctrine).
//   4. FREEZE GUARD (negative assertion): the scoring functions in
//      buildMlbPropClusters.js (modelProbOver / modelProbForSide /
//      projectionConfidence / calibrateMlbConfidence / tierForPlay) NEVER read
//      ladderNB or nbProbOver. Only makePlay (ride-along) may reference them.
//   5. Ride-along conditional spreads present in makePlay + phase4Tracking.leanBet
//      (omit-when-absent — byte-identical when OFF).
//
// MLB_NB_LADDER is read ONCE at module load → ON/OFF evaluated in CHILD
// processes via --emit (same pattern as verifyMlbTierPolicyR2).
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const NBL = path.join(ROOT, "pipeline", "mlb", "negBinomLadder.js")
const DATASET = path.join(ROOT, "pipeline", "mlb", "buildMlbPlayerDataset.js")
const CLUSTERS = path.join(ROOT, "pipeline", "mlb", "buildMlbPropClusters.js")
const TRACKING = path.join(ROOT, "pipeline", "mlb", "phase4Tracking.js")

// ── child mode ──
if (process.argv.includes("--emit")) {
  const { projectHitterStats } = require(DATASET)
  const games = [0, 0, 1, 0, 4, 2, 0, 5, 1, 0, 3, 0].map((tb) => ({ stats: { totalBases: tb } }))
  const thinGames = games.slice(0, 9)
  const playerObj = { player: "Fixture Batter", hit1plus: 0.6, hit2plus: 0.3, hit3plus: 0.1, rbi1plus: 0.3, rbi2plus: 0.1, powerScore: 12, __nbGamesOverride: games }
  const thinObj = { ...playerObj, __nbGamesOverride: thinGames }
  const full = projectHitterStats({ playerObj, hrProb: 0.08, salt: 0.5 })
  const thin = projectHitterStats({ playerObj: thinObj, hrProb: 0.08, salt: 0.5 })
  console.log(JSON.stringify({
    hasLadderNB: Object.prototype.hasOwnProperty.call(full.totalBases, "ladderNB"),
    hasMeta: Object.prototype.hasOwnProperty.call(full.totalBases, "ladderNBMeta"),
    ladderNB: full.totalBases.ladderNB ?? null,
    meta: full.totalBases.ladderNBMeta ?? null,
    thinHasLadderNB: Object.prototype.hasOwnProperty.call(thin.totalBases, "ladderNB"),
    heuristicLadderKeys: Object.keys(full.totalBases.ladder || {}),
    tbKeys: Object.keys(full.totalBases),
  }))
  process.exit(0)
}

// ── parent mode ──
let pass = 0, fail = 0
const failures = []
const check = (label, cond) => { if (cond) pass++; else { fail++; failures.push(label) } }
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps

// 1. Pure-module math (in-process; module is env-independent).
const nbl = require(NBL)
const nbFit = { method: "negbinom", r: 2, p: 0.5 }
check("NB survival(1)=0.75", near(nbl.survival(nbFit, 1), 0.75))
check("NB survival(2)=0.5", near(nbl.survival(nbFit, 2), 0.5))
check("NB survival(3)=0.3125", near(nbl.survival(nbFit, 3), 0.3125))
const poFit = { method: "poisson", lambda: 1 }
check("Poisson survival(1)=1-e^-1", near(nbl.survival(poFit, 1), 1 - Math.exp(-1)))
check("Poisson survival(2)=1-2e^-1", near(nbl.survival(poFit, 2), 1 - 2 * Math.exp(-1)))
const od = [0, 0, 1, 0, 4, 2, 0, 5, 1, 0, 3, 0]
const fit1 = nbl.fitCountsMoM(od)
check("overdispersed → negbinom", fit1 && fit1.method === "negbinom")
check("MoM r = m²/(v−m)", fit1 && near(fit1.r, (fit1.mean * fit1.mean) / (fit1.variance - fit1.mean)))
check("MoM p = m/v", fit1 && near(fit1.p, fit1.mean / fit1.variance))
check("var≤mean → poisson", (() => { const f = nbl.fitCountsMoM([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]); return f && f.method === "poisson" })())
check("n=9 → null (floor)", nbl.fitCountsMoM([1, 2, 0, 1, 3, 0, 1, 2, 1]) === null)
check("MIN_GAMES is 10 (playerPropHistory parity)", nbl.MIN_GAMES === 10)
// self-test harness must also pass
const st = spawnSync(process.execPath, [NBL], { encoding: "utf8" })
check("inline self-tests exit 0", st.status === 0 && /PASS/.test(st.stdout))

// 2 + 3. ON/OFF children through the real projectHitterStats.
function runChild(mode) {
  const r = spawnSync(process.execPath, [__filename, "--emit"], { env: { ...process.env, MLB_NB_LADDER: mode }, encoding: "utf8" })
  if (r.status !== 0) { console.error(`child mode=${mode} failed:\n${r.stderr}`); process.exit(1) }
  const lines = r.stdout.trim().split("\n")
  return JSON.parse(lines[lines.length - 1])
}
const on = runChild("1")
const off = runChild("0")
check("ON: ladderNB present (n=12 ≥ floor)", on.hasLadderNB === true && on.hasMeta === true)
check("ON: meta n=12", on.meta && on.meta.n === 12)
check("ON: meta method negbinom (sample is overdispersed)", on.meta && on.meta.method === "negbinom")
check("ON: rungs monotone non-increasing", (() => { const v = Object.values(on.ladderNB || {}); return v.length >= 4 && v.every((x, i) => i === 0 || x <= v[i - 1] + 1e-12) })())
check("ON: ladderNB['0.5'] matches direct module fit", (() => { const direct = nbl.ladderFromCounts(od); return direct && near(on.ladderNB["0.5"], direct.ladder["0.5"], 1e-9) })())
check("ON: thin sample (n=9) → NO ladderNB (honesty floor)", on.thinHasLadderNB === false)
check("ON: heuristic ladder untouched (keys 0.5/1.5/2.5/3.5)", JSON.stringify(on.heuristicLadderKeys) === JSON.stringify(["0.5", "1.5", "2.5", "3.5"]))
check("OFF: ladderNB key ABSENT", off.hasLadderNB === false && off.hasMeta === false)
check("OFF: totalBases keys byte-identical shape (floor/mostLikely/ceiling/ladder only)", JSON.stringify(off.tbKeys) === JSON.stringify(["floor", "mostLikely", "ceiling", "ladder"]))

// 4. FREEZE GUARD — negative source assertions on scoring functions.
const srcC = fs.readFileSync(CLUSTERS, "utf8")
function fnSlice(src, name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) return null
  const next = src.indexOf("\nfunction ", start + 1)
  return src.slice(start, next > 0 ? next : src.length)
}
for (const fn of ["modelProbOver", "modelProbForSide", "projectionConfidence", "calibrateMlbConfidence", "tierForPlay"]) {
  const slice = fnSlice(srcC, fn)
  check(`freeze guard: ${fn} exists`, slice != null)
  check(`freeze guard: ${fn} never reads ladderNB/nbProbOver`, slice != null && !slice.includes("ladderNB") && !slice.includes("nbProbOver"))
}
check("makePlay carries the ride-along (allowed site)", (fnSlice(srcC, "makePlay") || "").includes("nbProbOver"))

// 5. Source assertions: switch + ride-along spreads.
const srcD = fs.readFileSync(DATASET, "utf8")
const srcT = fs.readFileSync(TRACKING, "utf8")
check("dataset: kill-switch read-once", srcD.includes(`process.env.MLB_NB_LADDER ?? "1"`))
check("dataset: boot log tag", srcD.includes("[NB-LADDER-BOOT]"))
check("dataset: conditional ladderNB spread", srcD.includes("...(_tbNB ? { ladderNB: _tbNB.ladder, ladderNBMeta: _tbNB.meta } : {})"))
check("clusters: makePlay conditional nb spread (totalBases-gated)", srcC.includes(`family === "totalBases" && stat?.ladderNB`))
check("tracking: leanBet conditional nb spread", srcT.includes("play?.nbProbOver != null ? { nbProbOver: play.nbProbOver, nbFit: play.nbFit ?? null } : {}"))

console.log(`\nverifyNbLadderStep1: ${pass}/${pass + fail} PASS`)
if (fail > 0) { for (const f of failures) console.log(`  FAIL: ${f}`); console.log("RESULT: FAIL"); process.exit(1) }
console.log("RESULT: PASS")
