#!/usr/bin/env node
"use strict"

/**
 * scanRungEv.js — G2-L3 SHADOW RUNG-EV SCANNER (2026-07-16, approved scope).
 *
 * SHADOW-FIRST DOCTRINE: output is a nightly artifact + this CLI printout.
 * NOT on /m, no route, no tracked_bets/best/picks writes, nothing bettor-facing
 * until THE NAMED GATE passes and the OPERATOR flips it (G1/N1 mechanics).
 *
 * WHAT IT DOES per run:
 *   1. ELIGIBILITY from the committed verdicts (backend/config/g2_validation.json,
 *      written only by the L2 validator): family must be verdict=PASS AND not in
 *      the operator's HARD_EXCLUDED list (totalBases, rbis — L2 STOPs; changing
 *      this list requires a commit + a re-passed validation report).
 *   2. For each captured ladder store with games today-or-later: fit each
 *      player's curve on games STRICTLY BEFORE the game date (frozen constants
 *      from the verdicts JSON — never re-chosen here), price every rung we have
 *      tail support for, compare to the BEST captured book price.
 *   3. FLB-AWARE FLAG MARGIN (longshot doc §1): flag +EV only when
 *      pFair − implied > max(2pp, 1.5 × that stated-prob bucket's MEASURED
 *      calibration gap from the L2 famTables; thin buckets inherit the family's
 *      worst eligible-bucket gap — conservative by construction, and the
 *      required margin grows toward the long tail where calibration is weakest).
 *   4. SETTLE PASS: yesterday's flags settle from the season gamelogs (realized
 *      counts); no log row for that game date ⇒ stays PENDING, never guessed.
 *      The append-only JSONL ledger (flags + settles) IS the gate instrument.
 *
 * THE NAMED GATE (from the approved scope; operator pulls the trigger):
 *   (a) family Axis-A PASS (already enforced via eligibility) ·
 *   (b) ≥14 forward graded nights AND ≥300 decided flags: pooled
 *       |stated−realized| ≤ 1.5pp AND flat-$1 units ≥ 0 ·
 *   (c) split-half stability (both window halves same sign) ·
 *   (d) operator flip (plist switch + boot line). The gate tally prints every
 *       run and rides the artifact summary — evidence accumulates, silently
 *       flipping nothing.
 */

const fs = require("fs")
const path = require("path")
const { fitPlayerFamilyCurve } = require("../pipeline/mlb/negBinomLadder")
const { slateDateForTimestamp, currentSlateDateEt } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..")
const DATA_DIR = process.env.G2_DATA_DIR || path.join(ROOT, "data")
const TRACKING_DIR = process.env.G2_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const VERDICTS_PATH = process.env.G2_VERDICTS || path.join(ROOT, "config", "g2_validation.json")
const LEDGER_PATH = process.env.RUNG_LEDGER || path.join(TRACKING_DIR, "rung_flag_ledger.jsonl")

const HARD_EXCLUDED = ["totalBases", "rbis"] // operator-ordered L2 STOPs; commit-gated
const VENDOR_FAM = { batter_hits_alternate: "hits", batter_runs_scored_alternate: "runs", pitcher_strikeouts_alternate: "ks" }
const STAT_KEY = { hits: "hits", runs: "runs", ks: "strikeOuts" }

const rd = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim()
const impliedOf = (odds) => (odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100))

// ── eligibility + margin machinery from the COMMITTED verdicts ──
const verdicts = rd(VERDICTS_PATH)
if (!verdicts || !verdicts.famTables) { console.error("scanRungEv: committed verdicts missing/old (backend/config/g2_validation.json) — run validateG2Curves first. No scan."); process.exit(1) }
const frozenHalfLife = verdicts.frozenHalfLife ?? null
const eligible = Object.entries(verdicts.verdicts)
  .filter(([fam, v]) => v.verdict === "PASS" && !HARD_EXCLUDED.includes(fam))
  .map(([fam]) => fam)
const ksMinN = verdicts.verdicts.ks?.effectiveMinN || 8

function bucketGap(family, p) {
  const rows = verdicts.famTables[family] || []
  const bounds = verdicts.bucketBounds || []
  let idx = bounds.findIndex(([lo, hi]) => p >= lo && p < hi)
  if (idx < 0) idx = rows.length - 1
  const eligibleRows = rows.filter((r) => r.n >= 50 && r.gap != null)
  const worst = eligibleRows.length ? Math.max(...eligibleRows.map((r) => r.gap)) : 0.05
  const b = rows[idx]
  return b && b.n >= 50 && b.gap != null ? b.gap : worst // thin bucket ⇒ conservative worst
}
const marginFor = (family, p) => Math.max(0.02, 1.5 * bucketGap(family, p))

// ── settle pass (yesterday's flags; pending never guessed) ──
function readLedger() {
  try { return fs.readFileSync(LEDGER_PATH, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean) } catch (_) { return [] }
}
function settleFlags(batIdx, pitIdx, today) {
  const entries = readLedger()
  const settledIds = new Set(entries.filter((e) => e.type === "settle").map((e) => e.id))
  const open = entries.filter((e) => e.type === "flag" && !settledIds.has(e.id) && e.gameDate < today)
  const lines = []
  let settledNow = 0
  for (const f of open) {
    const idx = f.family === "ks" ? pitIdx : batIdx
    const pl = idx.get(norm(f.player))
    const row = pl?.rows.find((g) => String(g.date) === String(f.gameDate))
    if (!row) continue // no final log yet ⇒ PENDING, never guessed
    const hit = Number(row.stats[STAT_KEY[f.family]]) >= f.k ? 1 : 0
    const units = hit ? (f.oddsAmerican > 0 ? f.oddsAmerican / 100 : 100 / Math.abs(f.oddsAmerican)) : -1
    lines.push(JSON.stringify({ type: "settle", id: f.id, settledAt: new Date().toISOString(), hit, units: Math.round(units * 100) / 100 }))
    settledNow++
  }
  if (lines.length) fs.appendFileSync(LEDGER_PATH, lines.join("\n") + "\n")
  return settledNow
}
function gateTally() {
  const entries = readLedger()
  const flags = new Map(entries.filter((e) => e.type === "flag").map((e) => [e.id, e]))
  const settles = entries.filter((e) => e.type === "settle" && flags.has(e.id))
  const nights = [...new Set(settles.map((s) => flags.get(s.id).gameDate))].sort()
  const decided = settles.length
  const statedSum = settles.reduce((a, s) => a + flags.get(s.id).pFair, 0)
  const hitSum = settles.reduce((a, s) => a + s.hit, 0)
  const units = settles.reduce((a, s) => a + s.units, 0)
  const gap = decided ? Math.abs(statedSum / decided - hitSum / decided) : null
  // split-half stability on the night sequence
  let halves = null
  if (nights.length >= 4) {
    const mid = nights[Math.floor(nights.length / 2)]
    const h = (pred) => { const ss = settles.filter((s) => pred(flags.get(s.id).gameDate)); const u = ss.reduce((a, s) => a + s.units, 0); return { n: ss.length, units: Math.round(u * 100) / 100 } }
    halves = { first: h((d) => d < mid), second: h((d) => d >= mid) }
  }
  return { nights: nights.length, decided, pooledGapPp: gap != null ? Math.round(gap * 1000) / 10 : null, flatUnits: Math.round(units * 100) / 100, halves, gate: { needNights: 14, needDecided: 300, gapBarPp: 1.5, unitsBar: 0 } }
}

// ── main scan ──
const today = currentSlateDateEt()
const batCache = rd(path.join(DATA_DIR, "mlbBatterGameLogsSeason.json"))
const pitCache = rd(path.join(DATA_DIR, "mlbPitcherGameLogsSeason.json"))
if (!batCache || !pitCache) { console.error("scanRungEv: season caches missing"); process.exit(1) }
const mkIdx = (cache, key) => new Map(Object.entries(cache.players).map(([k, v]) => [norm(k), { rows: (v[key] || []).map((g) => ({ date: String(g.date), stats: g.stats })).sort((a, b) => (a.date < b.date ? -1 : 1)) }]))
const batIdx = mkIdx(batCache, "games")
const pitIdx = mkIdx(pitCache, "starts")

const settledNow = settleFlags(batIdx, pitIdx, today)
const ladderFiles = (fs.existsSync(TRACKING_DIR) ? fs.readdirSync(TRACKING_DIR) : [])
  .filter((f) => /^mlb_ladders_(\d{4}-\d{2}-\d{2})\.json$/.test(f))
  .filter((f) => f.slice(12, 22) >= today)

let totalFlags = 0
const newLedgerLines = []
const existingFlagIds = new Set(readLedger().filter((e) => e.type === "flag").map((e) => e.id))
for (const f of ladderFiles) {
  const store = rd(path.join(TRACKING_DIR, f))
  const gameDate = store?.gameDate
  const best = new Map()
  for (const r of store?.rows || []) {
    const fam = VENDOR_FAM[r.family]
    if (!fam || !eligible.includes(fam)) continue
    if (String(r.side).toLowerCase() !== "over" || !Number.isFinite(Number(r.line))) continue
    const key = `${norm(r.player)}|${fam}|${r.line}`
    const prev = best.get(key)
    if (!prev || Number(r.oddsAmerican) > Number(prev.oddsAmerican)) best.set(key, { ...r, fam })
  }
  const rows = []
  for (const r of best.values()) {
    const idx = r.fam === "ks" ? pitIdx : batIdx
    const pl = idx.get(norm(r.player))
    if (!pl) continue
    const prior = pl.rows.filter((g) => g.date < String(gameDate))
    const curve = fitPlayerFamilyCurve(prior, r.fam, { minN: r.fam === "ks" ? ksMinN : 15, halfLife: frozenHalfLife })
    if (!curve) continue // floor ⇒ honest absence
    const k = Math.ceil(Number(r.line))
    const pFair = curve.ladder[String(k - 0.5)]
    if (pFair == null) continue // beyond tail support ⇒ honestly unpriced
    const implied = impliedOf(Number(r.oddsAmerican))
    const margin = marginFor(r.fam, pFair)
    const edge = pFair - implied
    const dec = Number(r.oddsAmerican) > 0 ? 1 + Number(r.oddsAmerican) / 100 : 1 + 100 / Math.abs(Number(r.oddsAmerican))
    const ev = pFair * (dec - 1) - (1 - pFair)
    const flagged = edge > margin
    const row = { player: r.player, family: r.fam, line: Number(r.line), k, book: r.book, oddsAmerican: Number(r.oddsAmerican), pFair: Math.round(pFair * 10000) / 10000, implied: Math.round(implied * 10000) / 10000, edgePp: Math.round(edge * 1000) / 10, marginPp: Math.round(margin * 1000) / 10, evPer$1: Math.round(ev * 1000) / 1000, flagged, curveN: curve.meta.n, method: curve.meta.method }
    rows.push(row)
    if (flagged) {
      const id = `${gameDate}|${norm(r.player)}|${r.fam}|${r.line}|${r.book}`
      if (!existingFlagIds.has(id)) {
        newLedgerLines.push(JSON.stringify({ type: "flag", id, gameDate, player: r.player, family: r.fam, line: Number(r.line), k, book: r.book, oddsAmerican: Number(r.oddsAmerican), pFair: row.pFair, implied: row.implied, flaggedAt: new Date().toISOString() }))
        existingFlagIds.add(id)
      }
      totalFlags++
    }
  }
  const artifact = {
    gameDate, generatedAt: new Date().toISOString(), shadow: true,
    frozenHalfLife, eligibleFamilies: eligible, hardExcluded: HARD_EXCLUDED,
    rows: rows.sort((a, b) => b.evPer$1 - a.evPer$1),
    summary: { rungsPriced: rows.length, flagged: rows.filter((x) => x.flagged).length, gate: gateTally() },
  }
  const fp = path.join(TRACKING_DIR, `mlb_rung_scan_${gameDate}.json`)
  const tmpFp = `${fp}.tmp.${process.pid}`
  fs.writeFileSync(tmpFp, JSON.stringify(artifact, null, 2))
  fs.renameSync(tmpFp, fp)
  console.log(`scanRungEv [${gameDate}]: ${rows.length} rungs priced (${eligible.join("/")}) · ${artifact.summary.flagged} flagged (+EV past FLB margin) → ${path.basename(fp)}`)
  for (const r of rows.filter((x) => x.flagged).slice(0, 8)) console.log(`  FLAG ${r.player} ${r.family} ${r.k}+ @ ${r.book} ${r.oddsAmerican > 0 ? "+" : ""}${r.oddsAmerican} · fair ${(r.pFair * 100).toFixed(1)}% vs implied ${(r.implied * 100).toFixed(1)}% · edge ${r.edgePp}pp (margin ${r.marginPp}pp) · EV ${r.evPer$1 >= 0 ? "+" : ""}${r.evPer$1}/$1 · n=${r.curveN}`)
}
if (newLedgerLines.length) { fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true }); fs.appendFileSync(LEDGER_PATH, newLedgerLines.join("\n") + "\n") }
const tally = gateTally()
console.log(`gate tally: ${tally.nights}/14 nights · ${tally.decided}/300 decided flags · pooled gap ${tally.pooledGapPp ?? "—"}pp (bar 1.5) · flat-$1 ${tally.flatUnits >= 0 ? "+" : ""}${tally.flatUnits}u (bar ≥0) · settled this run ${settledNow} · SHADOW (operator-gated flip)`)
if (!ladderFiles.length) console.log(`scanRungEv: no ladder stores for ${today}+ — honest no-scan (capture passes fire 10:00/17:00/22:05 ET on game days)`)
