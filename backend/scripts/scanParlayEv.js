#!/usr/bin/env node
"use strict"

/**
 * scanParlayEv.js — G3-L4 CROSS-GAME PARLAY PRICER (2026-07-21, approved scope).
 *
 * SHADOW artifact + paper ledger ONLY. The live parlay owner remains the
 * sanctioned mlbParlayConstructor (runbook G4, its own gate) — this script is
 * that gate's EVIDENCE INSTRUMENT, exactly as scanRungEv is for rungs.
 *
 * LICENSE CHECK (hard): runs ONLY while the committed G3 verdicts say
 * cross_game === CERTIFIED_INDEPENDENT — certification revoked ⇒ the pricer
 * REFUSES (product pricing without certified independence is fabrication).
 *
 * COMPOSITION: candidate legs = today+ rung-scan rows flagged by ANY policy
 * (labels carried); 2-3 legs, DISTINCT eventIds ONLY (same-game composition is
 * STRUCTURALLY IMPOSSIBLE here — the validated negative-trap blocker enforced
 * by construction); top legs by EV capped for combinatorics. Leg probability =
 * the PAPER-ADOPTED blend prob (cures.pBlend, w=market-dominant), raw pFair
 * recorded alongside. Joint = Π p (certified independence). EV vs the book
 * product-of-decimals at each leg's captured best price. No stake math.
 *
 * PAPER GATE (named, the house family): append-only parlay_paper_ledger.jsonl;
 * settle from leg outcomes via the canonical join (all legs hit ⇒ win units =
 * decCombined−1 · any miss ⇒ −1 · any no-appearance leg ⇒ parlay VOID 0u ·
 * else pending, never guessed). Bars: ≥14 nights · ≥100 settled parlays ·
 * pooled |stated joint − realized| ≤ 3pp · flat-$1 ≥ 0 · split-half ·
 * OPERATOR flip. Beyond it, the runbook G4 live gate is UNCHANGED.
 */

const fs = require("fs")
const path = require("path")
const { fitPlayerFamilyCurve } = require("../pipeline/mlb/negBinomLadder")
const { buildJoinIndex, resolvePlayer } = require("../pipeline/shared/playerNameJoin")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..")
const TRACKING = process.env.L4_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const DATA_DIR = process.env.L4_DATA_DIR || path.join(ROOT, "data")
const VERDICTS = process.env.L4_VERDICTS || path.join(ROOT, "config", "g3_correlation_validation.json")
const LEDGER = process.env.L4_LEDGER || path.join(TRACKING, "parlay_paper_ledger.jsonl")
const MAX_LEGS_POOL = 12
const MAX_PARLAYS = 120
const STAT_KEY = { hits: "hits", runs: "runs", ks: "strikeOuts" }

const rd = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0 } return h.toString(16) }
const decOf = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o))

// ── LICENSE ──
const g3v = rd(VERDICTS)
if (g3v?.results?.cross_game?.verdict !== "CERTIFIED_INDEPENDENT") {
  console.error("scanParlayEv REFUSES: cross_game independence is NOT certified in the committed verdicts — product pricing would be fabrication. No artifact, no ledger writes.")
  process.exit(1)
}

// ── settle pass (canonical join; pending never guessed; void semantics) ──
const batCache = rd(path.join(DATA_DIR, "mlbBatterGameLogsSeason.json"))
const pitCache = rd(path.join(DATA_DIR, "mlbPitcherGameLogsSeason.json"))
const mkIdx = (cache, key) => buildJoinIndex(Object.entries(cache?.players || {}).map(([k, v]) => [v.fullName || k, (v[key] || []).map((g) => ({ date: String(g.date), stats: g.stats }))]))
const batIdx = mkIdx(batCache, "games")
const pitIdx = mkIdx(pitCache, "starts")
const today = currentSlateDateEt()

function readLedger() { try { return fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean) } catch (_) { return [] } }
function settleParlays() {
  const entries = readLedger()
  const settled = new Set(entries.filter((e) => e.type === "settle").map((e) => e.id))
  const open = entries.filter((e) => e.type === "parlay" && !settled.has(e.id) && e.gameDate < today)
  const lines = []
  let n = 0
  for (const p of open) {
    let anyMiss = false, anyVoid = false, anyPending = false
    for (const leg of p.legs) {
      const idx = leg.family === "ks" ? pitIdx : batIdx
      const rows = resolvePlayer(idx, leg.player)
      const row = rows?.find((g) => g.date === p.gameDate)
      if (!row) {
        const newest = rows ? rows.reduce((a, g) => (g.date > a ? g.date : a), "") : ""
        const age = (Date.parse(today) - Date.parse(p.gameDate)) / 86400000
        if (rows && age >= 2 && newest > p.gameDate) anyVoid = true // no appearance, coverage-proven
        else anyPending = true
        continue
      }
      if (!(Number(row.stats[STAT_KEY[leg.family]]) >= leg.k)) anyMiss = true
    }
    if (anyPending) continue // never guessed
    const rec = anyVoid ? { outcome: "void", units: 0 } : anyMiss ? { outcome: "loss", units: -1 } : { outcome: "win", units: +(p.decCombined - 1).toFixed(3) }
    lines.push(JSON.stringify({ type: "settle", id: p.id, settledAt: new Date().toISOString(), ...rec }))
    n++
  }
  if (lines.length) fs.appendFileSync(LEDGER, lines.join("\n") + "\n")
  return n
}
function gateTally() {
  const entries = readLedger()
  const parlays = new Map(entries.filter((e) => e.type === "parlay").map((e) => [e.id, e]))
  const settles = entries.filter((e) => e.type === "settle" && parlays.has(e.id) && e.outcome !== "void")
  const nights = [...new Set(settles.map((s) => parlays.get(s.id).gameDate))].sort()
  const decided = settles.length
  const stated = settles.reduce((a, s) => a + parlays.get(s.id).joint, 0)
  const wins = settles.filter((s) => s.outcome === "win").length
  const units = settles.reduce((a, s) => a + s.units, 0)
  const gap = decided ? Math.abs(stated / decided - wins / decided) : null
  let halves = null
  if (nights.length >= 4) {
    const mid = nights[Math.floor(nights.length / 2)]
    const h = (pred) => { const ss = settles.filter((s) => (pred(parlays.get(s.id).gameDate))); return { n: ss.length, units: +ss.reduce((a, s) => a + s.units, 0).toFixed(2) } }
    halves = { first: h((d) => d < mid), second: h((d) => d >= mid) }
  }
  return { nights: nights.length, decided, gapPp: gap != null ? +(gap * 100).toFixed(1) : null, flatUnits: +units.toFixed(2), halves, gate: { needNights: 14, needSettled: 100, gapBarPp: 3, unitsBar: 0, flip: "OPERATOR" } }
}

// ── compose today's candidates from the rung-scan artifacts ──
const settledNow = settleParlays()
const scanFiles = fs.readdirSync(TRACKING).filter((f) => /^mlb_rung_scan_(\d{4}-\d{2}-\d{2})\.json$/.test(f)).filter((f) => f.slice(14, 24) >= today)
const existing = new Set(readLedger().filter((e) => e.type === "parlay").map((e) => e.id))
let wrote = 0
for (const f of scanFiles) {
  const scan = rd(path.join(TRACKING, f))
  const gameDate = scan?.gameDate
  const legs = (scan?.rows || [])
    .filter((r) => r.eventId && (r.flagged || r.cures?.flagA || r.cures?.flagB || r.cures?.flagC) && Number.isFinite(r.cures?.pBlend))
    .sort((a, b) => b.evPer$1 - a.evPer$1)
    .slice(0, MAX_LEGS_POOL)
  const combos = []
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    if (legs[i].eventId === legs[j].eventId) continue // STRUCTURAL cross-game guard
    combos.push([legs[i], legs[j]])
    for (let k2 = j + 1; k2 < legs.length; k2++) {
      if (legs[k2].eventId === legs[i].eventId || legs[k2].eventId === legs[j].eventId) continue
      combos.push([legs[i], legs[j], legs[k2]])
    }
  }
  const priced = combos.map((legSet) => {
    const joint = legSet.reduce((a, l) => a * l.cures.pBlend, 1)
    const decCombined = legSet.reduce((a, l) => a * decOf(l.oddsAmerican), 1)
    const ev = joint * (decCombined - 1) - (1 - joint)
    return { legSet, joint: +joint.toFixed(5), decCombined: +decCombined.toFixed(3), ev: +ev.toFixed(4) }
  }).sort((a, b) => b.ev - a.ev).slice(0, MAX_PARLAYS)
  const newLines = []
  for (const p of priced) {
    const legDesc = p.legSet.map((l) => `${l.player}|${l.family}|${l.k}|${l.book}`).sort().join("||")
    const id = `${gameDate}|${fnv(legDesc)}`
    if (existing.has(id)) continue
    existing.add(id)
    newLines.push(JSON.stringify({ type: "parlay", id, gameDate, joint: p.joint, decCombined: p.decCombined, ev: p.ev, legs: p.legSet.map((l) => ({ player: l.player, family: l.family, k: l.k, eventId: l.eventId, book: l.book, oddsAmerican: l.oddsAmerican, pBlend: l.cures.pBlend, pFair: l.pFair, policies: { raw: !!l.flagged, A: !!l.cures.flagA, B: !!l.cures.flagB, C: !!l.cures.flagC } })), pricedAt: new Date().toISOString() }))
    wrote++
  }
  if (newLines.length) { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.appendFileSync(LEDGER, newLines.join("\n") + "\n") }
  const artifact = { gameDate, generatedAt: new Date().toISOString(), shadow: true, certifiedIndependence: true, candidates: priced.length, newLedgered: newLines.length, top: priced.slice(0, 8).map((p) => ({ ev: p.ev, joint: p.joint, dec: p.decCombined, legs: p.legSet.map((l) => `${l.player} ${l.k}+ ${l.family} @ ${l.book} ${l.oddsAmerican > 0 ? "+" : ""}${l.oddsAmerican}`) })), gate: gateTally() }
  const fp = path.join(TRACKING, `mlb_parlay_scan_${gameDate}.json`)
  const tmp = `${fp}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(artifact, null, 2))
  fs.renameSync(tmp, fp)
  console.log(`scanParlayEv [${gameDate}]: ${legs.length} candidate legs → ${priced.length} priced parlays (${newLines.length} new to ledger)`)
  for (const t of artifact.top.slice(0, 3)) console.log(`  EV ${t.ev >= 0 ? "+" : ""}${t.ev}/$1 · joint ${(t.joint * 100).toFixed(1)}% · pays ${t.dec}x · ${t.legs.join("  +  ")}`)
}
const tally = gateTally()
console.log(`parlay paper gate: ${tally.nights}/14 nights · ${tally.decided}/100 settled · gap ${tally.gapPp ?? "—"}pp (bar 3) · ${tally.flatUnits >= 0 ? "+" : ""}${tally.flatUnits}u (bar ≥0) · settled this run ${settledNow} · SHADOW (operator-gated flip; G4 live gate unchanged beyond it)`)
if (!scanFiles.length) console.log(`scanParlayEv: no rung-scan artifacts for ${today}+ — honest no-op (parlays compose only from scanned slates)`)
