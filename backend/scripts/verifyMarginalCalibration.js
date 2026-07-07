"use strict"
// verifyMarginalCalibration — T2 Track-1 (T2-MarginalCalib-1B, side-aware) fixture.
//
// Proves:
//   1. isotonic (PAVA) is monotone + recovers a known overconfident curve;
//      calibrated reliability-gap < raw gap.
//   2. mlbMarginalCalibration pulls overconfident over-families down + is monotone
//      (preserves ranking), via the committed maps.
//   3. SIDE-AWARE fallback ladder: families[fam][side] → families[fam].all →
//      global → identity (unknown family → global; side w/o map → family.all).
//   4. kill-switch MLB_MARGINAL_CALIB=0 → calibrateModelProb null (child proc).
//   5. FREEZE GUARD: scoring/PRESERVED files reference NOTHING in the new module.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
const iso = require("../pipeline/shared/isotonicCalibration")
const cal = require("../pipeline/mlb/mlbMarginalCalibration")

if (process.argv.includes("--off-child")) {
  process.stdout.write(JSON.stringify(cal.calibrateModelProb(0.45, "totalBases", { side: "over" })))
  process.exit(0)
}

// G1 STEP 1 board child — build a deterministic LONGSHOT fixture through the REAL
// buildMlbBestBetsBoard scoring path and emit the picks. MLB_CALIB_LIVE is read at
// load by buildMlbPropClusters, so OFF vs ON is exercised via separate child procs.
// Longshot odds (implied < 0.10) bypass the edge gate → every candidate surfaces a
// play in BOTH modes, so the pick SET is identical and only modelProb + the calib
// stamps differ — isolating exactly what the switch changes.
if (process.argv.includes("--board-child")) {
  const { buildMlbBestBetsBoard } = require("../pipeline/mlb/buildMlbPropClusters")
  const eventId = "g1fx", player = "Fixture Batter"
  const predictions = { players: [{ player, eventId, stats: {
    totalBases: { floor: 0, mostLikely: 2, ceiling: 5, ladder: { "2.5": 0.34 } },
    hits:       { floor: 0, mostLikely: 1, ceiling: 3, ladder: { "1.5": 0.38 } },
    rbis:       { floor: 0, mostLikely: 1, ceiling: 3, ladder: { "1.5": 0.36 } },
  } }] }
  const mkt = (statFamily, marketKey, line) => ({ player, eventId, statFamily, marketKey, propType: statFamily, side: "over", line, oddsAmerican: 1200 })
  const board = buildMlbBestBetsBoard({ predictions, marketProps: [
    mkt("totalBases", "batter_total_bases", 2.5), mkt("hits", "batter_hits", 1.5), mkt("rbis", "batter_rbis", 1.5),
  ] })
  const all = [].concat(board.allPlays || [], board.longshotPlays || [], board.altPlays || [], board.fades || [])
  process.stdout.write(JSON.stringify(all.map(p => ({ fam: p.statFamily, side: p.side, line: p.line, modelProb: p.modelProb, modelProbRaw: p.modelProbRaw ?? null, calibVersion: p.calibVersion ?? null, tier: p.tier }))))
  process.exit(0)
}

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }

// 1. isotonic primitive
const pts = [{ x: 0.2, y: 0.06, w: 100 }, { x: 0.35, y: 0.09, w: 80 }, { x: 0.5, y: 0.33, w: 50 }, { x: 0.65, y: 0.45, w: 70 }]
const fit = iso.fitIsotonic(pts)
check("isotonic monotone knots", fit.knots.every((k, i) => i === 0 || k.y >= fit.knots[i - 1].y - 1e-9))
const gapRaw = Math.abs(0.5 - 0.33), gapCal = Math.abs(iso.predictIsotonic(fit, 0.5) - 0.33)
check("calibrated gap < raw gap (overconf fixed)", gapCal < gapRaw)
check("predict monotone 0.2≤0.5≤0.65", iso.predictIsotonic(fit, 0.2) <= iso.predictIsotonic(fit, 0.5) + 1e-9 && iso.predictIsotonic(fit, 0.5) <= iso.predictIsotonic(fit, 0.65) + 1e-9)

// 2. engine on committed maps — overconfident OVER families pulled DOWN, monotone
const tb = cal.calibrateModelProb(0.45, "totalBases", { side: "over" })
const hits = cal.calibrateModelProb(0.28, "hits", { side: "over" })
check("totalBases over 0.45 calibrated down", tb != null && tb < 0.45)
check("hits over 0.28 calibrated down", hits != null && hits < 0.28)
const sweep = [0.12, 0.2, 0.3, 0.45, 0.6].map(p => cal.calibrateModelProb(p, "totalBases", { side: "over" }))
check("engine calibration monotone (preserves ranking)", sweep.every((v, i) => i === 0 || v >= sweep[i - 1] - 1e-9))

// 3. SIDE-AWARE fallback ladder: families[fam][side] → families[fam].all → global → identity
const unk = cal.calibrateDetail(0.3, "totally_unknown_family_zzz", { side: "over" })
check("unknown family → global fallback", unk && unk.source === "global")
const over = cal.calibrateDetail(0.45, "totalBases", { side: "over" })
const under = cal.calibrateDetail(0.45, "totalBases", { side: "under" })
check("totalBases side=over → family_over map", over && over.source === "family_over")
check("totalBases side=under → family_under map", under && under.source === "family_under")
check("over vs under calibrate differently (side matters)", over && under && Math.abs(over.calibrated - under.calibrated) > 1e-6)
const noSide = cal.calibrateDetail(0.45, "totalBases", {})            // side omitted → family.all
check("side omitted → family.all fallback", noSide && noSide.source === "family")
const noUnder = cal.calibrateDetail(0.45, "rbis", { side: "under" })  // rbis has no under map → family.all
check("side w/o map → family.all fallback", noUnder && noUnder.source === "family")

// 4. kill-switch OFF (child)
const child = spawnSync(process.execPath, [__filename, "--off-child"], { encoding: "utf8", env: Object.assign({}, process.env, { MLB_MARGINAL_CALIB: "0" }) })
check("MLB_MARGINAL_CALIB=0 → null", child.status === 0 && child.stdout.trim().split("\n").pop().trim() === "null")

// 5. G1 STEP 1 GATE GUARD (evolved 2026-07-01 from the pre-graduation freeze guard).
// Marginal calibration is now WIRED into scoring + the dampener, but STRICTLY behind
// the default-OFF MLB_CALIB_LIVE switch (docs/POST_FREEZE_25TH_RUNBOOK.md §STEP 1 +
// docs/G1_STEP1_EXECUTION_BRIEF.md). The invariant changed from "zero references" to
// "every reference is gated" — so OFF stays byte-identical while ON graduates. The
// FUNCTIONAL OFF/ON board proof (section 6) is the load-bearing check.
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const clusters = rd("pipeline/mlb/buildMlbPropClusters.js")
const tracking = rd("pipeline/mlb/phase4Tracking.js")
const dampener = rd("pipeline/shared/calibrationDampener.js")
check("buildMlbPropClusters gates calibration behind MLB_CALIB_LIVE", clusters.length > 0 && /calibrateModelProb/.test(clusters) && /MLB_CALIB_LIVE/.test(clusters))
check("calibrationDampener gates calibration behind MLB_CALIB_LIVE", dampener.length > 0 && /mlbMarginalCalibration/.test(dampener) && /MLB_CALIB_LIVE/.test(dampener))
check("phase4Tracking still references no calibration shadow (untouched)", tracking.length > 0 && !/mlbMarginalCalibration|calibrateModelProb/.test(tracking))

// 6. FUNCTIONAL OFF/ON PROOF through the REAL scoring path (child procs).
//    This is the load-bearing G1 check: it proves OFF is byte-identical AND that the
//    ON wiring actually calibrates (the caveat the default-OFF proof alone can't cover).
function runBoardChild(mode) {
  const env = Object.assign({}, process.env)
  if (mode === "on") env.MLB_CALIB_LIVE = "1"; else delete env.MLB_CALIB_LIVE
  const r = spawnSync(process.execPath, [__filename, "--board-child"], { encoding: "utf8", env })
  if (r.status !== 0) { failures.push(`board child mode=${mode} failed: ${r.stderr}`); fail++; return [] }
  try { return JSON.parse(r.stdout.trim().split("\n").pop()) } catch (e) { failures.push(`board child mode=${mode} unparseable: ${e.message}`); fail++; return [] }
}
const offPicks = runBoardChild("off")
const onPicks = runBoardChild("on")
const keyOf = (p) => `${p.fam}|${p.side}|${p.line}`
const offMap = new Map(offPicks.map(p => [keyOf(p), p]))
const onMap = new Map(onPicks.map(p => [keyOf(p), p]))
check("board OFF surfaces the fixture picks", offPicks.length >= 3)
check("board ON pick-set identical to OFF (longshots always surface)", offPicks.length === onPicks.length && [...offMap.keys()].every(k => onMap.has(k)))
check("OFF picks carry NO calib stamp (byte-identical to pre-G1)", offPicks.length > 0 && offPicks.every(p => p.calibVersion == null && p.modelProbRaw == null))
// 2026-07-06 v2 — stamp is config-driven (map era): assert equality with the
// committed config's version, not a hardcoded literal.
const CFG_VER = (() => { try { return JSON.parse(rd("config/mlbMarginalCalibration.json")).version || "mlb-calib-live-v1" } catch (_) { return "mlb-calib-live-v1" } })()
check("ON picks stamped with the CONFIG's map version (era separation)", onPicks.length > 0 && /^mlb-calib-live-v\d+$/.test(CFG_VER) && onPicks.every(p => p.calibVersion === CFG_VER))
check("ON modelProbRaw === OFF modelProb (raw preserved; calibrate applied once)", onPicks.length > 0 && onPicks.every(p => { const o = offMap.get(keyOf(p)); return o && Math.abs(Number(p.modelProbRaw) - Number(o.modelProb)) < 1e-9 }))
check("ON overconfident overs pulled DOWN vs raw (calibration does real work)", onPicks.length > 0 && onPicks.every(p => Number(p.modelProb) <= Number(p.modelProbRaw) + 1e-9) && onPicks.some(p => Number(p.modelProb) < Number(p.modelProbRaw) - 1e-3))

// ── 7. v2 MAP HYGIENE (2026-07-06 — the runs|over y=1.0 sparse-tail fix) ──────
// Bet-blocking bug: v1's runs|over last knot (x .3651, y 1.0, n≈25 pooled cell)
// served ~100% MODEL CONF on the operator board. v2 = raw-axis era rule +
// MIN_KNOT_N pooling + Agresti-Coull smoothing + hard output cap. See
// pipeline/mlb/mlbCalibTraining.js (the ONE training-method owner — the derive
// script AND probeCalibrationForward both consume it, so the G1 gate can never
// silently drift from the trainer).
const T = require("../pipeline/mlb/mlbCalibTraining")
const cfg = (() => { try { return JSON.parse(rd("config/mlbMarginalCalibration.json")) } catch (_) { return null } })()
check("config carries version + outputCap (era + ceiling are config-driven)", !!cfg && /^mlb-calib-live-v\d+$/.test(String(cfg.version)) && Number(cfg.outputCap) > 0.5 && Number(cfg.outputCap) <= 0.9)
{
  let maxY = 0, minPtN = Infinity, mapsScanned = 0
  const scan = (m) => { if (!m || !Array.isArray(m.knots)) return; mapsScanned++
    for (const k of m.knots) if (Number(k.y) > maxY) maxY = Number(k.y)
    for (const p of (m.points || [])) if (Number(p.n) < minPtN) minPtN = Number(p.n) }
  if (cfg) { scan(cfg.global); for (const v of Object.values(cfg.families || {})) for (const s of ["all", "over", "under"]) scan(v[s]) }
  check("NO knot anywhere exceeds the output cap (the ~100% class is gone from the maps)", cfg && mapsScanned > 0 && maxY <= Number(cfg.outputCap) + 1e-9)
  check("EVERY training point carries n ≥ MIN_KNOT_N (sparse tails structurally pooled)", cfg && Number.isFinite(minPtN) && minPtN >= T.MIN_KNOT_N)
}
check("engine enforces the cap at predict time (backstop, full-grid extreme input)",
  ["ks", "hits", "rbis", "totalBases", "runs", "hr", "outs"].every((f) => ["over", "under"].every((s) => { const c = cal.calibrateModelProb(0.99, f, { side: s }); return c == null || c <= (Number(cfg && cfg.outputCap) || 0.85) + 1e-9 })))
check("engine exposes the config's map version for the scoring stamp", (() => { try { return require("../pipeline/mlb/mlbMarginalCalibration").mapsVersion === cfg.version } catch (_) { return false } })())
// Sparse-tail functional regression: a tiny all-wins tail must NEVER become its
// own knot (the exact v1 failure). 200 low-prob rows @5% + 6 rows @0.95 all wins.
{
  const synth = []
  for (let i = 0; i < 200; i++) synth.push({ mp: 0.18 + (i % 10) * 0.004, hit: i % 20 === 0 ? 1 : 0 })
  for (let i = 0; i < 6; i++) synth.push({ mp: 0.95, hit: 1 })
  const m = T.fitMapV2(synth)
  check("sparse all-wins tail pools (no knot y > cap; every point n ≥ floor)", !!m && m.knots.every((k) => k.y <= T.OUTPUT_CAP + 1e-9) && m.points.every((p) => p.n >= T.MIN_KNOT_N))
  check("pooled tail stays near the honest base rate (no ~100% resurrection)", !!m && Math.max(...m.knots.map((k) => k.y)) < 0.3)
}
// Era rule units (anti-contamination):
check("era rule: stamped row uses modelProbRaw", T.statedRawProb({ modelProbRaw: 0.4, modelProb: 0.99 }, "2026-07-03") === 0.4)
check("era rule: pre-flip row uses modelProb (it IS raw)", T.statedRawProb({ modelProb: 0.3 }, "2026-06-20") === 0.3)
check("era rule: calibrated-era row without a raw is EXCLUDED (null)", T.statedRawProb({ modelProb: 0.99 }, "2026-07-03") === null)

console.log(`verifyMarginalCalibration: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
