#!/usr/bin/env node
"use strict"

/**
 * probeN1MedianBoard.js — N1 OFF/ON comparison on REAL data (2026-07-16).
 *
 * Drives the REAL engines offline (no network, no server): the real snapshot's
 * prop rows → buildMlbHitsToday / buildMlbRbiToday (real per-player survival
 * probabilities from the live caches) → projectHitterStats (the file N1
 * touches) → modelProbForSide (the R2 scorer, untouched, read-only here) at
 * the REAL posted lines/odds — once with the mean center (OFF) and once with
 * the ladder-median center (ON), in two subprocesses (the switch is a
 * module-load const, same as the live runtime reads it).
 *
 * HONEST SCOPE NOTES printed with the results:
 *   - Standard lines that sit ON a ladder rung take the ladder path in
 *     modelProbOver — their probability comes from the rung, so N1 moves them
 *     only via the |center−line| distance gates; the direct probability shift
 *     shows on logistic-path (off-rung) lines. Both are reported separately.
 *   - This probe replays the projection slice of the pipeline (no HR merge /
 *     context layers) — but BOTH sides use identical inputs, so the OFF→ON
 *     DELTA is real. The forward gate (reliability gap + Brier on forward
 *     data) remains the decider for flipping ON — this probe shows WHAT
 *     changes, the corpus says WHY (over-side over-confidence).
 */

const path = require("path")
const fs = require("fs")
const { spawnSync } = require("child_process")

if (process.env.N1_PROBE_WORKER === "1") {
  // ── worker: compute under the current MLB_N1_MEDIAN env ──
  const wrap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "snapshot-mlb.json"), "utf8"))
  const snap = wrap?.data || wrap
  const rows = Array.isArray(snap?.rows) ? snap.rows : []
  const { buildMlbHitsToday } = require("../pipeline/mlb/buildMlbHitsProbabilityEngine")
  let buildMlbRbiToday = null
  try { ({ buildMlbRbiToday } = require("../pipeline/mlb/buildMlbRbiProbabilityEngine")) } catch (_) {}
  const { projectHitterStats } = require("../pipeline/mlb/buildMlbPlayerDataset")
  const { modelProbForSide, americanOddsToImpliedProb } = require("../pipeline/mlb/buildMlbPropClusters")

  const playerMap = new Map()
  const hits = buildMlbHitsToday({ rows, playerMap })
  if (buildMlbRbiToday) { try { buildMlbRbiToday({ rows, playerMap }) } catch (_) {} }
  const byPlayer = hits?.byPlayer || {}

  const FAM = { "Hits": "hits", "Total Bases": "totalBases", "RBIs": "rbis", "Runs": "runs" }
  const norm = (s) => String(s || "").toLowerCase().trim()
  const statsByPlayer = new Map()
  for (const [name, obj] of Object.entries(byPlayer)) {
    try { statsByPlayer.set(norm(name), projectHitterStats({ playerObj: obj, hrProb: Number(obj?.hrProbability) || 0, salt: 0.5 })) } catch (_) {}
  }

  const out = { centers: {}, families: {}, rowsSeen: 0 }
  const centerAcc = {}
  for (const r of rows) {
    const famKey = FAM[String(r?.propType || "")]
    if (!famKey) continue
    const stats = statsByPlayer.get(norm(r?.player))
    if (!stats || !stats[famKey]) continue
    const line = Number(r?.line)
    const odds = Number(r?.oddsAmerican ?? r?.odds)
    const side = String(r?.side || "").toLowerCase()
    if (!Number.isFinite(line) || !Number.isFinite(odds) || !side) continue
    out.rowsSeen++
    const stat = stats[famKey]
    const p = modelProbForSide(famKey, stat, line, side, null)
    if (p == null) continue
    const implied = americanOddsToImpliedProb(odds)
    const onRung = stat.ladder && Object.prototype.hasOwnProperty.call(stat.ladder, String(line))
    const f = out.families[famKey] || (out.families[famKey] = { over: { rows: 0, posEdge: 0, sumP: 0 }, under: { rows: 0, posEdge: 0, sumP: 0 }, logisticRows: 0 })
    const sideKey = side.startsWith("u") ? "under" : "over"
    f[sideKey].rows++
    f[sideKey].sumP += p
    if (Number.isFinite(implied) && p - implied > 0) f[sideKey].posEdge++
    if (!onRung) f.logisticRows++
    centerAcc[famKey] = centerAcc[famKey] || { sum: 0, n: 0 }
    if (!centerAcc[famKey].seen?.has?.(norm(r?.player))) {
      centerAcc[famKey].seen = centerAcc[famKey].seen || new Set()
      centerAcc[famKey].seen.add(norm(r?.player))
      centerAcc[famKey].sum += Number(stat.mostLikely) || 0
      centerAcc[famKey].n++
    }
  }
  for (const [k, v] of Object.entries(centerAcc)) out.centers[k] = v.n ? Math.round((v.sum / v.n) * 100) / 100 : null
  for (const f of Object.values(out.families)) { for (const s of ["over", "under"]) f[s].avgP = f[s].rows ? Math.round((f[s].sumP / f[s].rows) * 1000) / 1000 : null }
  console.log("###JSON###" + JSON.stringify(out))
  process.exit(0)
}

// ── parent: run OFF and ON workers, print the comparison ──
function runWorker(n1) {
  const env = { ...process.env, N1_PROBE_WORKER: "1", MLB_N1_MEDIAN: n1 ? "1" : "0" }
  const r = spawnSync(process.execPath, [__filename], { env, encoding: "utf8", timeout: 120000 })
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("###JSON###"))
  if (!line) { console.error(`worker (N1=${n1 ? "ON" : "OFF"}) failed:\n${r.stdout}\n${r.stderr}`); process.exit(1) }
  return JSON.parse(line.slice(10))
}

const off = runWorker(false)
const on = runWorker(true)
console.log(`probeN1MedianBoard — REAL snapshot rows evaluated: ${off.rowsSeen} (slate ${(() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "snapshot-mlb.json"), "utf8"))?.data?.snapshotSlateDateKey } catch (_) { return "?" } })()})`)
console.log(`${"family".padEnd(11)} ${"center OFF→ON".padEnd(15)} ${"over rows".padEnd(10)} ${"over avgP OFF→ON".padEnd(19)} ${"over +edge OFF→ON".padEnd(19)} ${"under +edge OFF→ON".padEnd(19)} offRung`)
for (const fam of ["hits", "totalBases", "rbis", "runs"]) {
  const a = off.families[fam], b = on.families[fam]
  if (!a || !b) { console.log(`${fam.padEnd(11)} (no rows on this slate)`); continue }
  console.log(`${fam.padEnd(11)} ${String(off.centers[fam] + " → " + on.centers[fam]).padEnd(15)} ${String(a.over.rows).padEnd(10)} ${String(a.over.avgP + " → " + b.over.avgP).padEnd(19)} ${String(a.over.posEdge + " → " + b.over.posEdge).padEnd(19)} ${String(a.under.posEdge + " → " + b.under.posEdge).padEnd(19)} ${a.logisticRows}`)
}
console.log("\nReading: center = avg mostLikely per player (mean OFF vs ladder-median ON) · +edge = rows where modelProb beats the odds-implied prob (the board's raw qualification signal) · offRung = rows priced by the logistic path (direct N1 bite); rung rows move only via the distance gates.")
console.log("Decision rule stays forward-gated: ON must beat OFF on reliability gap + Brier on forward graded data before default flips.")
