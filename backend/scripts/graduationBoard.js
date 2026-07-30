#!/usr/bin/env node
"use strict"

/**
 * graduationBoard.js — GRADUATION BOARD aggregator (2026-07-30, ASK f5ee1b6;
 * operator standing directive: caged surfaces must visibly, consistently
 * progress toward bettable — stalls must be impossible to miss).
 *
 * READ-ONLY over what the nightly already writes — no new experiments:
 *   config/g2_validation.json            family exam verdicts + bars
 *   runtime/tracking/mlb_rung_scan_*     rung gate (nights/14 · decided/300 · units · gap)
 *   runtime/tracking/mlb_parlay_scan_*   parlay paper gate (nights/14 · decided/100 · units)
 *   (cure columns ride the rung scan's summary.cureGates)
 * Writes ONE sidecar: runtime/tracking/graduation_board.json. /status and /m
 * render it; the stall alarm (componentHealthCheck) recomputes from the raw
 * artifacts and NEVER trusts this sidecar (it guards it).
 *
 * HONESTY RULES (binding, from the ASK): paper units are IN-SAMPLE shadow
 * numbers and every row says so · trend needs 7 slates of artifacts or reads
 * "too new" (never a fabricated arrow) · a family absent from the exam
 * artifact reads "not yet examined — artifact predates the family's wiring"
 * (the day-one truth: SB/doubles/triples were wired 07-26; the committed exam
 * artifact is 07-16) · QUEUED rows say QUEUED instead of pretending progress.
 *
 * Scheduler fires this after the 17:15/22:20 scans + post-grade (~05:45).
 */

const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

const UNLOCKS = {
  family: "exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket",
  repoint: "PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval",
  rung: "14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement",
  cures: "per-column gate + counterfactual kill bar (G3-L3)",
  parlay: "14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval",
  marketPrior: "QUEUED — CA spec after gates read green (docket d94d5c9); the board refuses to fake progress on an unstarted experiment",
}

function rdJson(fp) { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }

/** Sorted slate keys that had games (non-empty tracked file). */
function slatesWithGames(trackingDir) {
  let files = []
  try { files = fs.readdirSync(trackingDir).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() } catch (_) {}
  const out = []
  for (const f of files) {
    const rows = rdJson(path.join(trackingDir, f))
    if (Array.isArray(rows) && rows.length) out.push(f.slice(17, 27))
  }
  return out
}

function artifactSeries(trackingDir, prefix) {
  let files = []
  try { files = fs.readdirSync(trackingDir).filter((f) => f.startsWith(prefix) && /\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() } catch (_) {}
  return files.map((f) => ({ slate: f.slice(prefix.length, prefix.length + 10), data: rdJson(path.join(trackingDir, f)) })).filter((x) => x.data)
}

/** Last slate where the counter tuple CHANGED vs the prior artifact. */
function lastAdvance(series, tupleOf) {
  let last = series.length ? series[0].slate : null
  for (let i = 1; i < series.length; i++) {
    if (JSON.stringify(tupleOf(series[i].data)) !== JSON.stringify(tupleOf(series[i - 1].data))) last = series[i].slate
  }
  return last
}

/** Stalled = tuple unchanged across the last 2 games-slates that HAVE artifacts
 * (missing artifact on a games-slate counts as non-advance — it IS one). */
function isStalled(series, tupleOf, gamesSlates) {
  if (series.length < 1 || gamesSlates.length < 3) return false
  const bySlate = new Map(series.map((x) => [x.slate, tupleOf(x.data)]))
  const recent = gamesSlates.slice(-3) // need slate-2 as the comparison base
  const tuples = recent.map((s) => (bySlate.has(s) ? JSON.stringify(bySlate.get(s)) : "ABSENT"))
  // non-advance on BOTH of the last two games-slates relative to their predecessors
  return (tuples[2] === tuples[1] || tuples[2] === "ABSENT") && (tuples[1] === tuples[0] || tuples[1] === "ABSENT")
}

function trendWk(series, unitsOf) {
  if (series.length < 8) return { label: "too new", deltaUnits: null }
  const now = unitsOf(series[series.length - 1].data)
  const then = unitsOf(series[series.length - 8].data)
  if (!Number.isFinite(now) || !Number.isFinite(then)) return { label: "too new", deltaUnits: null }
  const d = Math.round((now - then) * 100) / 100
  return { label: `${d >= 0 ? "+" : ""}${d}u vs 7 slates ago`, deltaUnits: d }
}

function buildBoard({ trackingDir, configDir } = {}) {
  const tDir = trackingDir || path.join(ROOT, "runtime", "tracking")
  const cDir = configDir || path.join(ROOT, "config")
  const games = slatesWithGames(tDir)
  const rows = []

  // ── family exams + re-point readiness (config/g2_validation.json) ──
  const g2 = rdJson(path.join(cDir, "g2_validation.json"))
  const examAge = g2 && g2.generatedAt ? games.filter((s) => s > String(g2.generatedAt).slice(0, 10)).length : null
  const famRow = (key, fam, unlockKey) => {
    const v = g2 && g2.verdicts ? g2.verdicts[fam] : null
    const stalled = examAge != null && examAge >= 2 && (!v || v.verdict === "STOP")
    rows.push({
      key, label: `${fam} exam`,
      examNights: { have: v ? 1 : 0, bar: 1, note: `exam artifact ${g2 ? String(g2.generatedAt).slice(0, 10) : "ABSENT"} — ${examAge != null ? examAge + " games-slates old" : "age unknown"}${v ? "" : "; PREDATES this family's wiring (07-26) — never examined"}` },
      decided: { have: v ? v.nPairs : 0, bar: (g2 && g2.bars && g2.bars.passMinN) || 150, unit: "pairs" },
      paperUnits: null, paperNote: "exam verdict, not a paper track",
      verdict: v ? v.verdict : "NOT_EXAMINED",
      trend: { label: "refit artifact — advances when the exam re-runs" },
      unlock: UNLOCKS[unlockKey],
      status: stalled ? "stalled" : "caged",
    })
  }
  famRow("fam_sb", "stolenBases", "family")
  famRow("fam_doubles", "doubles", "family")
  famRow("fam_triples", "triples", "family")
  famRow("repoint_tb", "totalBases", "repoint")
  famRow("repoint_rbis", "rbis", "repoint")

  // ── rung gate + cure columns (mlb_rung_scan_*) ──
  const rungs = artifactSeries(tDir, "mlb_rung_scan_")
  const rTuple = (d) => [(d.summary?.gate || {}).nights ?? null, (d.summary?.gate || {}).decided ?? null]
  const rLast = rungs[rungs.length - 1]
  const rg = rLast ? (rLast.data.summary?.gate || {}) : {}
  rows.push({
    key: "rung_gate", label: "NB ladder / rung-scan gate",
    examNights: { have: rg.nights ?? 0, bar: 14 },
    decided: { have: rg.decided ?? 0, bar: 300 },
    paperUnits: rg.flatUnits ?? null, paperNote: "IN-SAMPLE shadow units — the gate refusing is the gate working",
    gapPp: rg.pooledGapPp ?? null,
    trend: trendWk(rungs, (d) => Number((d.summary?.gate || {}).flatUnits)),
    lastAdvance: lastAdvance(rungs, rTuple),
    unlock: UNLOCKS.rung,
    status: isStalled(rungs, rTuple, games) ? "stalled" : "caged",
  })
  const cg = rLast ? rLast.data.summary?.cureGates : null
  const cTuple = (d) => ["A", "B", "C"].map((k) => (d.summary?.cureGates?.[k] || {}).decided ?? null)
  rows.push({
    key: "cure_columns", label: "scanner cure columns A/B/C",
    examNights: { have: rg.nights ?? 0, bar: 14, note: "ride the rung scan's nights" },
    decided: { have: cg ? ["A", "B", "C"].map((k) => `${k}:${(cg[k] || {}).decided ?? 0}`).join(" ") : "—", bar: "per-column" },
    paperUnits: cg ? ["A", "B", "C"].map((k) => `${k}:${(cg[k] || {}).flatUnits ?? 0}u`).join(" ") : null,
    paperNote: "IN-SAMPLE shadow units per cure column",
    trend: trendWk(rungs, (d) => Number((d.summary?.cureGates?.A || {}).flatUnits)),
    lastAdvance: lastAdvance(rungs, cTuple),
    unlock: UNLOCKS.cures,
    status: isStalled(rungs, cTuple, games) ? "stalled" : "caged",
  })

  // ── parlay paper gate (mlb_parlay_scan_*) ──
  const parls = artifactSeries(tDir, "mlb_parlay_scan_")
  const pTuple = (d) => [(d.gate || {}).nights ?? null, (d.gate || {}).decided ?? null]
  const pLast = parls[parls.length - 1]
  const pg = pLast ? (pLast.data.gate || {}) : {}
  rows.push({
    key: "parlay_gate", label: "parlay pricer paper gate",
    examNights: { have: pg.nights ?? 0, bar: 14 },
    decided: { have: pg.decided ?? 0, bar: 100 },
    paperUnits: pg.flatUnits ?? null, paperNote: "IN-SAMPLE shadow units — deeply negative = the gate refusing correctly",
    trend: trendWk(parls, (d) => Number((d.gate || {}).flatUnits)),
    lastAdvance: lastAdvance(parls, pTuple),
    unlock: UNLOCKS.parlay,
    status: isStalled(parls, pTuple, games) ? "stalled" : "caged",
  })

  // ── market-prob prior (queued — no experiment exists yet) ──
  rows.push({
    key: "market_prob_prior", label: "market-prob-as-prior",
    examNights: { have: 0, bar: null }, decided: { have: 0, bar: null },
    paperUnits: null, trend: { label: "n/a" }, unlock: UNLOCKS.marketPrior,
    status: "queued",
  })

  return {
    doc: "GRADUATION BOARD — every caged surface's road to bettable, from the artifacts the nightly already writes. Stalls are named, never absorbed.",
    generatedAt: new Date().toISOString(),
    gamesSlatesSeen: games.length,
    stalledRows: rows.filter((r) => r.status === "stalled").map((r) => r.key),
    rows,
  }
}

if (require.main === module) {
  const board = buildBoard({})
  const out = path.join(ROOT, "runtime", "tracking", "graduation_board.json")
  const tmp = `${out}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2))
  fs.renameSync(tmp, out)
  console.log(`graduationBoard: ${board.rows.length} rows · stalled: ${board.stalledRows.length ? board.stalledRows.join(", ") : "none"} · wrote ${out}`)
  for (const r of board.rows) console.log(`  ${r.status.toUpperCase().padEnd(8)} ${r.key.padEnd(18)} nights ${JSON.stringify(r.examNights.have)}/${r.examNights.bar ?? "—"} · decided ${JSON.stringify(r.decided.have)}/${r.decided.bar ?? "—"} · units ${r.paperUnits ?? "—"} · ${r.trend.label}`)
}

module.exports = { buildBoard, slatesWithGames, isStalled, lastAdvance, trendWk, UNLOCKS }
