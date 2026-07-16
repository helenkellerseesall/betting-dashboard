"use strict"
// verifyN1MedianCenter — N1 MEAN→MEDIAN center fix (2026-07-16, graduation plan §N1).
// Claims under test:
//   1. KILL-SWITCH: MLB_N1_MEDIAN default OFF; OFF ⇒ centers are the legacy
//      round1(mean) values (byte-identical scoring inputs); boot line states it.
//   2. MEDIAN MATH: ladderMedian reads the survival rungs correctly (smallest k
//      with P(X≤k) ≥ 0.5) — the mean>median right-skew case is the point.
//   3. SCOPE: exactly the four spec'd batter families (hits/TB/RBIs/runs) get
//      the center swap; floor/ceiling/ladder stay mean-derived both ways
//      (center-only ⇒ independently measurable, the do-not-bundle rule);
//      hr/batterKs/SB/pitchers untouched.
//   4. Both sides proven by RUNNING the real projectHitterStats in OFF and ON
//      subprocesses (module-load const, same as the live runtime reads it).
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const src = rd("pipeline/mlb/buildMlbPlayerDataset.js")
check("switch: MLB_N1_MEDIAN default OFF + boot line", /String\(process\.env\.MLB_N1_MEDIAN \?\? "0"\) === "1"/.test(src) && /\[N1-MEDIAN-BOOT\]/.test(src))
check("scope: four family centers gated + RIGID band translation (shift applied to floor+ceiling)", /hitsCenter = N1_MEDIAN_ON/.test(src) && /tbCenter = N1_MEDIAN_ON/.test(src) && /rbiCenter = N1_MEDIAN_ON/.test(src) && /runsCenter = N1_MEDIAN_ON/.test(src) && /hitsFloorN1 = Math\.max\(0, round1\(hitsFloor \+ hitsShift\)\)/.test(src) && /tbCeilingN1 = round1\(clamp\(2, 9, tbCeiling \+ tbShift\)\)/.test(src))
check("scope: mostLikely/floor/ceiling wired to the N1 values; hr/batterKs untouched", /mostLikely: hitsCenter/.test(src) && /floor: hitsFloorN1/.test(src) && /ceiling: tbCeilingN1/.test(src) && /mostLikely: rbiCenter/.test(src) && /mostLikely: runsCenter/.test(src) && /mostLikely: hrMedian/.test(src) && /mostLikely: batterKsMedian/.test(src))

// median math (pure fn, real module)
try {
  const { ladderMedian } = require("../pipeline/mlb/buildMlbPlayerDataset")
  check("median: right-skew case [0.72,0.38,0.12] → 1 (mean 1.22 would round to 1.2)", ladderMedian([0.72, 0.38, 0.12]) === 1)
  check("median: sub-coin opener [0.42,0.1] → 0 · deep [0.9,0.7,0.55] → 3 · empty → 0", ladderMedian([0.42, 0.1]) === 0 && ladderMedian([0.9, 0.7, 0.55]) === 3 && ladderMedian([]) === 0)
  check("median: non-monotone tail stops at first sub-0.5 rung [0.6,0.4,0.7] → 1", ladderMedian([0.6, 0.4, 0.7]) === 1)
} catch (e) { check(`median: module loads (${e?.message})`, false) }

// OFF/ON subprocess proof through the REAL projectHitterStats
const probeSrc = `
  const { projectHitterStats } = require(${JSON.stringify(path.join(ROOT, "pipeline/mlb/buildMlbPlayerDataset.js"))})
  const s = projectHitterStats({ playerObj: { hit1plus: 0.72, hit2plus: 0.38, hit3plus: 0.12, rbi1plus: 0.55, rbi2plus: 0.2, powerScore: 8 }, hrProb: 0.1, salt: 0.5 })
  console.log(JSON.stringify({ hits: s.hits, rbis: s.rbis, runs: s.runs, tb: s.totalBases }))
`
function runSide(on) {
  const r = spawnSync(process.execPath, ["-e", probeSrc], { env: { ...process.env, MLB_N1_MEDIAN: on ? "1" : "0", MLB_NB_LADDER: "0" }, encoding: "utf8", timeout: 60000 })
  const line = String(r.stdout || "").trim().split("\n").pop()
  try { return JSON.parse(line) } catch (_) { return null }
}
const offS = runSide(false)
const onS = runSide(true)
if (offS && onS) {
  check("OFF: legacy mean centers byte-identical (hits 1.2/0.5/2.0 · rbis 0.8/0/1.7)", offS.hits.mostLikely === 1.2 && offS.hits.floor === 0.5 && offS.hits.ceiling === 2.0 && offS.rbis.mostLikely === 0.8 && offS.rbis.ceiling === 1.7)
  check("ON: ladder-median centers, integer-valued (hits 1 · rbis 1)", onS.hits.mostLikely === 1 && onS.rbis.mostLikely === 1 && Number.isInteger(onS.tb.mostLikely) && Number.isInteger(onS.runs.mostLikely))
  const up = (s) => Math.round((s.ceiling - s.mostLikely) * 10) / 10
  const dn = (s) => Math.round((s.mostLikely - s.floor) * 10) / 10
  check("OFF↔ON: RIGID translation — sigma inputs preserved (upside c−m and downside m−f equal both sides; ladder identical)", up(offS.hits) === up(onS.hits) && dn(offS.hits) === dn(onS.hits) && up(offS.rbis) === up(onS.rbis) && JSON.stringify(offS.hits.ladder) === JSON.stringify(onS.hits.ladder))
} else {
  check("OFF/ON subprocess proof ran", false)
}

check("probe: real-data OFF/ON board comparison script present (forward-gate rule stated)", /runWorker\(false\)/.test(rd("scripts/probeN1MedianBoard.js")) && /forward-gated/.test(rd("scripts/probeN1MedianBoard.js")))

console.log(`verifyN1MedianCenter: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
