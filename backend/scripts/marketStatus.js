#!/usr/bin/env node
"use strict"
process.chdir(__dirname + "/..")

/**
 * marketStatus.js — Phase Market-Ecology-1A (OBS-1) (2026-05-14)
 *
 *   Usage:
 *     npm run market:status
 *     npm run market:status -- --sport=nba
 *     npm run market:status -- --top=20
 *
 * Canonical operator-facing inspector for sportsbook market observability.
 * Pure-read; never makes a network call, never writes to SQLite, never modifies
 * any pipeline state. Surfaces existing data that was already being computed
 * but not previously presented in a single operator-comparable view.
 *
 * Five output sections:
 *
 *   1. SNAPSHOT FRESHNESS — savedAt + total-rows + per-book row counts for
 *      each present snapshot file (snapshot.json, snapshot-mlb.json).
 *
 *   2. CONSENSUS CONFIDENCE DISTRIBUTION — runs buildLineShopping over the
 *      snapshot rows and surfaces the new Phase 1A consensusConfidence field
 *      (median, p10, p90) plus per-book book-count contribution.
 *
 *   3. TOP STALE ROWS — sorted by |delta from consensus|; tagged soft_line
 *      (book underprices = value for bettor) vs stale_line (book overprices).
 *
 *   4. PER-BOOK HISTORICAL CLV — from runtime/tracking/book_intelligence_state.json.
 *      Surfaces avgClv + roi + totalBets per book + per stat family.
 *
 *   5. API-CALL BURN (Phase 1A OBS-3) — rolling 24h, 7d, 30d counters from
 *      runtime/market/api_call_log.jsonl. Per-sport / per-endpoint / p50-p99
 *      duration. Operator-visible API budget.
 *
 * Anti-fabrication discipline: if a section's source data is missing or empty,
 * the section prints "(no data)" rather than synthesizing values.
 */

const fs   = require("fs")
const path = require("path")

const BACKEND_ROOT = path.join(__dirname, "..")
const TRACKING_DIR = path.join(BACKEND_ROOT, "runtime", "tracking")

function parseArgs() {
  const out = { sport: null, top: 10 }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length).toLowerCase()
    else if (a.startsWith("--top=")) {
      const n = Number(a.slice("--top=".length))
      if (Number.isFinite(n) && n > 0) out.top = Math.min(50, Math.floor(n))
    }
  }
  return out
}

function ageHumanFrom(ms) {
  if (!Number.isFinite(ms)) return "unknown"
  const secs = Math.floor((Date.now() - ms) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function readSnapshotFile(p) {
  try {
    if (!fs.existsSync(p)) return null
    const j = JSON.parse(fs.readFileSync(p, "utf8"))
    // Phase Snapshot-Authority-1A (AUTH-1): NBA fetcher persists rows at
    // `data.props`; MLB fetcher persists them at `data.rows`. Both shapes
    // must be supported here to mirror the canonical workstation reader
    // (workstationRoutes.js:135 / :190). Without `data.props` in the chain,
    // every NBA snapshot reported `rows: 0` even though the disk file held
    // thousands of populated props. This was the bug that produced the
    // operator-reported "snapshot.json rows = 0 / books = 0 / bestProps n/a"
    // cascade in Phase Market-Ecology-1A observability.
    const rows = j?.data?.rows || j?.data?.props || j?.rows || []
    return { ok: true, rows, savedAt: j?.savedAt || null, path: p }
  } catch (e) {
    return { ok: false, error: String(e?.message || e), path: p }
  }
}

function readBookIntelligenceState() {
  const p = path.join(TRACKING_DIR, "book_intelligence_state.json")
  try {
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (_) { return null }
}

// ── SECTION 1: snapshot freshness + per-book counts ──────────────────────────

function reportSnapshotFreshness(snapshots) {
  console.log("── SECTION 1: SNAPSHOT FRESHNESS ──")
  let any = false
  for (const sn of snapshots) {
    if (!sn || !sn.ok) {
      console.log(`  ${sn?.path || "?"}: missing or unreadable`)
      continue
    }
    any = true
    const bookCounts = {}
    for (const r of sn.rows) {
      const b = r.book || "unknown"
      bookCounts[b] = (bookCounts[b] || 0) + 1
    }
    const totalBooks = Object.keys(bookCounts).length
    const savedStr = sn.savedAt
      ? `${new Date(sn.savedAt).toISOString()} (${ageHumanFrom(sn.savedAt)})`
      : "no savedAt"
    console.log(`  ${path.basename(sn.path)}`)
    console.log(`    savedAt:    ${savedStr}`)
    console.log(`    rows:       ${sn.rows.length}`)
    console.log(`    books:      ${totalBooks}`)
    const sorted = Object.entries(bookCounts).sort((a, b) => b[1] - a[1])
    for (const [bk, n] of sorted) {
      console.log(`      ${String(bk).padEnd(20)}  ${String(n).padStart(6)} rows`)
    }
  }
  if (!any) console.log("  (no snapshots found)")
  console.log("")
}

// ── SECTION 2: consensus-confidence distribution + line-shopping output ──────

function reportConsensusConfidence(snapshots, topN) {
  console.log("── SECTION 2: CONSENSUS CONFIDENCE DISTRIBUTION (Phase 1A OBS-2) ──")
  let any = false
  const { buildLineShopping } = (() => {
    try { return require("../pipeline/shared/buildLineShoppingIntelligence") } catch (_) { return {} }
  })()
  if (typeof buildLineShopping !== "function") {
    console.log("  (buildLineShopping unavailable — skipping)")
    console.log("")
    return
  }
  for (const sn of snapshots) {
    if (!sn || !sn.ok || sn.rows.length === 0) continue
    any = true
    const sportGuess = sn.path.includes("mlb") ? "mlb" : "nba"
    let ls
    try { ls = buildLineShopping(sn.rows, { sport: sportGuess }) } catch (e) {
      console.log(`  ${path.basename(sn.path)}: buildLineShopping error — ${e?.message}`)
      continue
    }
    const byProp = Array.isArray(ls?.byProp) ? ls.byProp : []
    const confidences = byProp.map((p) => p.consensusConfidence).filter(Number.isFinite)
    if (!confidences.length) {
      console.log(`  ${path.basename(sn.path)}: (no multi-book props for consensus computation)`)
      continue
    }
    confidences.sort((a, b) => a - b)
    const pct = (p) => confidences[Math.min(confidences.length - 1, Math.floor(confidences.length * p))]
    const bookCountDist = {}
    for (const p of byProp) bookCountDist[p.bookCount] = (bookCountDist[p.bookCount] || 0) + 1
    console.log(`  ${path.basename(sn.path)} (${sportGuess})`)
    console.log(`    grouped props:       ${byProp.length}`)
    console.log(`    multi-book props:    ${byProp.filter((p) => p.bookCount >= 2).length}`)
    console.log(`    consensusConfidence: p10=${pct(0.1).toFixed(3)}  p50=${pct(0.5).toFixed(3)}  p90=${pct(0.9).toFixed(3)}`)
    const bcEntries = Object.entries(bookCountDist).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0])
    console.log(`    bookCount distribution: ${bcEntries.map(([k, v]) => `${k}b=${v}`).join("  ")}`)
    // Top-N by oddsSpread for operator review
    const best = (ls.bestByProp || []).slice(0, topN)
    if (best.length) {
      console.log(`    top ${best.length} multi-book disagreements (by odds spread):`)
      for (const e of best) {
        const cc = Number.isFinite(e.consensusConfidence) ? e.consensusConfidence.toFixed(3) : "n/a"
        console.log(`      ${String(e.player).padEnd(22)} ${String(e.prop).padEnd(38)} best=${e.bestBook}@${e.bestOdds}  worst=${e.worstBook}@${e.worstOdds}  conf=${cc}  ${e.bookCount}b`)
      }
    }
  }
  if (!any) console.log("  (no snapshots available)")
  console.log("")
}

// ── SECTION 3: top stale rows ─────────────────────────────────────────────────

function reportStaleRows(snapshots, topN) {
  console.log("── SECTION 3: TOP STALE ROWS ──")
  const { buildLineShopping } = (() => {
    try { return require("../pipeline/shared/buildLineShoppingIntelligence") } catch (_) { return {} }
  })()
  if (typeof buildLineShopping !== "function") {
    console.log("  (buildLineShopping unavailable — skipping)")
    console.log("")
    return
  }
  let any = false
  for (const sn of snapshots) {
    if (!sn || !sn.ok || sn.rows.length === 0) continue
    const sportGuess = sn.path.includes("mlb") ? "mlb" : "nba"
    let ls
    try { ls = buildLineShopping(sn.rows, { sport: sportGuess }) } catch (_) { continue }
    const stales = (ls?.staleRows || []).slice(0, topN)
    if (!stales.length) continue
    any = true
    console.log(`  ${path.basename(sn.path)} — ${stales.length} surfaced (tag: soft_line = bettor value; stale_line = book overprices)`)
    for (const s of stales) {
      const tag = String(s.tag || "?").padEnd(11)
      const player = String(s.player || "?").padEnd(22)
      const prop = String(s.prop || "?").padEnd(32)
      const book = String(s.book || "?").padEnd(14)
      const odds = String(s.odds ?? "?").padStart(5)
      const delta = Number.isFinite(s.delta) ? (s.delta >= 0 ? "+" : "") + s.delta.toFixed(3) : "?"
      console.log(`    [${tag}] ${player} ${prop} ${book} ${odds}  Δ${delta}`)
    }
  }
  if (!any) console.log("  (no stale rows surfaced)")
  console.log("")
}

// ── SECTION 4: per-book historical CLV ───────────────────────────────────────

function reportBookCLV(topN) {
  console.log("── SECTION 4: PER-BOOK HISTORICAL CLV (rolling 60-day) ──")
  const state = readBookIntelligenceState()
  if (!state || !state.books || !Object.keys(state.books).length) {
    console.log("  (book_intelligence_state.json missing or empty)")
    console.log("")
    return
  }
  const rows = []
  for (const [bookName, prof] of Object.entries(state.books)) {
    rows.push({
      book: bookName,
      bets: prof.totalBets || 0,
      settled: prof.settled || 0,
      roi: prof.roi,
      avgClv: prof.avgClv,
      clvCount: prof.clvCount || 0,
    })
  }
  rows.sort((a, b) => (b.bets || 0) - (a.bets || 0))
  for (const r of rows.slice(0, topN)) {
    const roiStr = Number.isFinite(r.roi) ? (r.roi * 100).toFixed(1) + "%" : "n/a"
    const clvStr = Number.isFinite(r.avgClv) ? (r.avgClv >= 0 ? "+" : "") + r.avgClv.toFixed(2) + "¢" : "n/a"
    console.log(`  ${String(r.book).padEnd(20)}  bets=${String(r.bets).padStart(5)}  settled=${String(r.settled).padStart(5)}  roi=${roiStr.padStart(7)}  avgCLV=${clvStr.padStart(8)} (n=${r.clvCount})`)
  }
  console.log("")
}

// ── SECTION 5: API-call burn (Phase 1A OBS-3) ────────────────────────────────

function reportApiBurn() {
  console.log("── SECTION 5: API-CALL BURN (Phase 1A OBS-3) ──")
  const { readRecentApiCalls, summarizeApiCalls } = (() => {
    try { return require("../pipeline/shared/apiCallLogger") } catch (_) { return {} }
  })()
  if (typeof readRecentApiCalls !== "function") {
    console.log("  (apiCallLogger unavailable — skipping)")
    console.log("")
    return
  }
  const entries = readRecentApiCalls(5000)
  if (!entries.length) {
    console.log("  (no api_call_log.jsonl entries yet — log file will populate after next slate refresh)")
    console.log("")
    return
  }
  const now = Date.now()
  const within = (hrs) => entries.filter((e) => {
    const ts = e?.ts ? new Date(e.ts).getTime() : 0
    return ts >= now - (hrs * 3600 * 1000)
  })
  const w24 = within(24)
  const w7d = within(24 * 7)
  const w30d = within(24 * 30)
  const s24 = summarizeApiCalls(w24)
  const s7d = summarizeApiCalls(w7d)
  const s30d = summarizeApiCalls(w30d)
  console.log(`  rolling 24h:   total=${s24.total}  ok=${s24.ok}  error=${s24.error}  p50=${s24.durationMs.p50}ms  p90=${s24.durationMs.p90}ms  p99=${s24.durationMs.p99}ms`)
  console.log(`  rolling 7d:    total=${s7d.total}  ok=${s7d.ok}  error=${s7d.error}`)
  console.log(`  rolling 30d:   total=${s30d.total}  ok=${s30d.ok}  error=${s30d.error}`)
  if (Object.keys(s24.bySport).length) {
    console.log(`  by sport (24h): ${Object.entries(s24.bySport).map(([k, v]) => `${k}=${v}`).join("  ")}`)
  }
  if (Object.keys(s24.byEndpoint).length) {
    console.log(`  by endpoint (24h):`)
    for (const [ep, n] of Object.entries(s24.byEndpoint).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(ep).padEnd(40)}  ${n}`)
    }
  }
  console.log("")
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs()
  const startedAt = new Date().toISOString()

  console.log("=== market:status — Phase Market-Ecology-1A (2026-05-14) ===")
  console.log(`generated     : ${startedAt}`)
  console.log(`sport filter  : ${args.sport || "all"}`)
  console.log(`top-N         : ${args.top}`)
  console.log("")

  const candidates = [
    path.join(BACKEND_ROOT, "snapshot.json"),
    path.join(BACKEND_ROOT, "snapshot-mlb.json"),
  ]
  let snapshots = candidates
    .map(readSnapshotFile)
    .filter(Boolean)
  if (args.sport === "nba") snapshots = snapshots.filter((s) => !s.path.includes("mlb"))
  if (args.sport === "mlb") snapshots = snapshots.filter((s) =>  s.path.includes("mlb"))

  reportSnapshotFreshness(snapshots)
  reportConsensusConfidence(snapshots, args.top)
  reportStaleRows(snapshots, args.top)
  reportBookCLV(args.top)
  reportApiBurn()

  console.log("───────────────────────────────────────────────────────────────────")
  console.log("Phase Market-Ecology-1A doctrine: observability first. Heuristic")
  console.log("interventions (STALE-1, CONS-1/2, DISAG-1/2, ALT-DISAG-1, INFLATE-1,")
  console.log("ANCHOR-1) gated until operator approves after observation window.")
  console.log("===================================================================")
}

main()
