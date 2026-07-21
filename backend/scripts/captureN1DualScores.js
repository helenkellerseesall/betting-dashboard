#!/usr/bin/env node
"use strict"

/**
 * captureN1DualScores.js — THE N1 GATE INSTRUMENT (2026-07-16, owed since the
 * N1 land block: "the window starts when the instrument starts writing").
 *
 * Nightly at 17:30 ET: for every tracked row on today's slate (the record the
 * board actually served), compute BOTH modelProbs from the REAL engines on the
 * REAL snapshot — mean-centered (OFF, what serves today) and median-centered
 * (ON, the shadow) — in two subprocesses exactly as the live runtime reads the
 * switch. Appends one JSONL line per tuple to
 * runtime/tracking/n1_dual_scores_<slate>.jsonl (append-only; re-runs skip
 * tuples already captured for the slate).
 *
 * SETTLE/TALLY: prior slates' dual rows join graded tracked rows by tuple;
 * the running N1 gate tally (from the LANDED flip gate, log 2026-07-16):
 *   ≥14 graded nights AND ≥1,500 decided N1-family rows · over-side
 *   reliability gap improves ≥1.0pp abs AND ≥25% rel under ON · under-side
 *   worsens ≤0.5pp · Brier ON ≤ OFF · split-half stability · OPERATOR flips.
 * Tally prints every run + writes runtime/calibration/n1_gate_tally.json.
 * Shadow-only: no scoring/serving/tracked writes; pending never guessed.
 */

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..")
const TRACKING = process.env.N1_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const TALLY_OUT = process.env.N1_TALLY_OUT || path.join(ROOT, "runtime", "calibration", "n1_gate_tally.json")
const N1_FAMILIES = ["hits", "totalBases", "rbis", "runs"]
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
const tupleKey = (r) => `${norm(r.player)}|${r.statFamily}|${String(r.side).toLowerCase()}|${r.line}`
const rd = (fp, fb) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return fb } }

// ── worker: compute per-tuple probs from the real engines under current env ──
if (process.env.N1_WORKER === "1") {
  const wrap = rd(path.join(ROOT, "snapshot-mlb.json"), null)
  const rows = wrap?.data?.rows || []
  const { buildMlbHitsToday } = require("../pipeline/mlb/buildMlbHitsProbabilityEngine")
  let buildMlbRbiToday = null
  try { ({ buildMlbRbiToday } = require("../pipeline/mlb/buildMlbRbiProbabilityEngine")) } catch (_) {}
  const { projectHitterStats } = require("../pipeline/mlb/buildMlbPlayerDataset")
  const { modelProbForSide } = require("../pipeline/mlb/buildMlbPropClusters")
  const pm = new Map()
  const hits = buildMlbHitsToday({ rows, playerMap: pm })
  if (buildMlbRbiToday) { try { buildMlbRbiToday({ rows, playerMap: pm }) } catch (_) {} }
  const out = {}
  for (const [name, obj] of Object.entries(hits?.byPlayer || {})) {
    let stats = null
    try { stats = projectHitterStats({ playerObj: obj, hrProb: Number(obj?.hrProbability) || 0, salt: 0.5 }) } catch (_) { continue }
    for (const fam of N1_FAMILIES) {
      if (!stats[fam]) continue
      for (const line of [0.5, 1.5, 2.5, 3.5]) {
        for (const side of ["over", "under"]) {
          const p = modelProbForSide(fam, stats[fam], line, side, null)
          if (p != null) out[`${norm(name)}|${fam}|${side}|${line}`] = Math.round(p * 10000) / 10000
        }
      }
    }
  }
  // 2026-07-21 REPAIR — the worker previously console.log'd a ~600KB JSON line
  // then process.exit(0): Node truncates unflushed pipe output at 64KB on exit,
  // so full-slate nights died with "Unterminated string in JSON at position
  // 65526" (07-18/20 crashes) and 07-19 parsed a TRUNCATED map (52 tuples,
  // 6,053 "not reproducible" — the missing tuples were cut off, not missing).
  // Fix: the worker writes its JSON to a temp file SYNCHRONOUSLY (writeFileSync
  // completes before exit, any size), parent reads the file.
  fs.writeFileSync(process.env.N1_WORKER_OUT, JSON.stringify(out))
  process.exit(0)
}

function runWorker(on) {
  const outFile = path.join(require("os").tmpdir(), `n1worker_${process.pid}_${on ? "on" : "off"}.json`)
  const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, N1_WORKER: "1", N1_WORKER_OUT: outFile, MLB_N1_MEDIAN: on ? "1" : "0" }, encoding: "utf8", timeout: 180000 })
  try {
    const parsed = JSON.parse(fs.readFileSync(outFile, "utf8"))
    fs.unlinkSync(outFile)
    return parsed
  } catch (_) {
    console.error(`runWorker(${on ? "ON" : "OFF"}) failed: exit=${r.status} stderr=${String(r.stderr || "").slice(0, 300)}`)
    return null
  }
}

// ── capture today's tuples ──
const slate = currentSlateDateEt()
const tracked = rd(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`), [])
const n1Rows = (Array.isArray(tracked) ? tracked : []).filter((r) => N1_FAMILIES.includes(r.statFamily))
const outPath = path.join(TRACKING, `n1_dual_scores_${slate}.jsonl`)
const already = new Set(fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).tuple } catch (_) { return null } }).filter(Boolean) : [])

if (!n1Rows.length) {
  console.log(`captureN1DualScores: no N1-family tracked rows on slate ${slate} — honest no-op (no games / board not built).`)
} else {
  const pOff = runWorker(false)
  const pOn = runWorker(true)
  if (!pOff || !pOn) { console.error("captureN1DualScores: engine workers failed — nothing written (never fabricate)"); process.exit(1) }
  const lines = []
  let missed = 0
  for (const r of n1Rows) {
    const t = tupleKey(r)
    if (already.has(t)) continue
    const off = pOff[t]
    const on = pOn[t]
    if (off == null || on == null) { missed++; continue } // tuple not reproducible from current engine state — skipped, never guessed
    lines.push(JSON.stringify({ tuple: t, slate, player: r.player, family: r.statFamily, side: String(r.side).toLowerCase(), line: r.line, pOff: off, pOn: on, capturedAt: new Date().toISOString() }))
    already.add(t)
  }
  if (lines.length) fs.appendFileSync(outPath, lines.join("\n") + "\n")
  console.log(`captureN1DualScores [${slate}]: ${lines.length} tuples dual-scored (${already.size} total on file · ${missed} not reproducible this pass — skipped honestly)`)
}

// ── settle + gate tally over all prior dual-score files ──
const files = fs.readdirSync(TRACKING).filter((f) => /^n1_dual_scores_\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()
const perNight = []
for (const f of files) {
  const d = f.slice(15, 25)
  const duals = fs.readFileSync(path.join(TRACKING, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
  const graded = new Map((rd(path.join(TRACKING, `mlb_tracked_bets_${d}.json`), []) || []).filter((r) => ["win", "loss"].includes(String(r.result))).map((r) => [tupleKey(r), r.result]))
  const night = { date: d, decided: 0, over: { n: 0, off: 0, on: 0, won: 0 }, under: { n: 0, off: 0, on: 0, won: 0 }, brierOff: 0, brierOn: 0 }
  for (const du of duals) {
    const res = graded.get(du.tuple)
    if (!res) continue // pending — never guessed
    const won = res === "win" ? 1 : 0
    night.decided++
    const b = du.side.startsWith("u") ? night.under : night.over
    b.n++; b.off += du.pOff; b.on += du.pOn; b.won += won
    night.brierOff += (du.pOff - won) ** 2
    night.brierOn += (du.pOn - won) ** 2
  }
  if (night.decided) perNight.push(night)
}
const agg = (sel) => {
  const t = { n: 0, off: 0, on: 0, won: 0 }
  for (const nn of perNight) { const b = sel(nn); t.n += b.n; t.off += b.off; t.on += b.on; t.won += b.won }
  return t.n ? { n: t.n, gapOff: Math.abs(t.off / t.n - t.won / t.n), gapOn: Math.abs(t.on / t.n - t.won / t.n) } : null
}
const over = agg((n) => n.over)
const under = agg((n) => n.under)
const decided = perNight.reduce((a, n) => a + n.decided, 0)
const brierOff = decided ? perNight.reduce((a, n) => a + n.brierOff, 0) / decided : null
const brierOn = decided ? perNight.reduce((a, n) => a + n.brierOn, 0) / decided : null
const tally = {
  generatedAt: new Date().toISOString(),
  nights: perNight.length, decided,
  overGapOffPp: over ? Math.round(over.gapOff * 1000) / 10 : null,
  overGapOnPp: over ? Math.round(over.gapOn * 1000) / 10 : null,
  underGapOffPp: under ? Math.round(under.gapOff * 1000) / 10 : null,
  underGapOnPp: under ? Math.round(under.gapOn * 1000) / 10 : null,
  brierOff: brierOff != null ? Math.round(brierOff * 1e5) / 1e5 : null,
  brierOn: brierOn != null ? Math.round(brierOn * 1e5) / 1e5 : null,
  gate: { needNights: 14, needDecided: 1500, overImprove: "≥1.0pp abs AND ≥25% rel", underNoHarm: "≤0.5pp", brier: "ON ≤ OFF", stability: "split-half", flip: "OPERATOR (plist + boot line)" },
}
fs.mkdirSync(path.dirname(TALLY_OUT), { recursive: true })
fs.writeFileSync(TALLY_OUT, JSON.stringify({ ...tally, perNight }, null, 2))
console.log(`N1 gate tally: ${tally.nights}/14 nights · ${decided}/1500 decided · over gap OFF ${tally.overGapOffPp ?? "—"}pp vs ON ${tally.overGapOnPp ?? "—"}pp · under OFF ${tally.underGapOffPp ?? "—"}pp vs ON ${tally.underGapOnPp ?? "—"}pp · Brier OFF ${tally.brierOff ?? "—"} vs ON ${tally.brierOn ?? "—"} · SHADOW (operator-gated flip)`)
