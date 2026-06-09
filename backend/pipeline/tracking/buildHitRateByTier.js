"use strict"
// ============================================================================
// T1 #2 — per-tier vig-aware realized HIT% over the FULL graded ledger.
// ----------------------------------------------------------------------------
// This is the compute behind the GRADES tab "TRACK RECORD BY TIER" card. It is a
// REPORTING surface only — it is NOT a calibration input and never feeds the
// pipeline. It quantifies the inverted-tier finding (R2 / Step-1 / F1.2 anti-
// selection) at the tier level: realized hit% vs the vig-stripped FAIR price the
// book charged, BY confidence tier.
//
// Method = canonical F1.1 / Step-1 read (same as step1_trust_proof.md and
// .scratch/probe_t1_hitrate_by_tier.js):
//   1. dedup graded rows by player|family|side|line|slateDate (book EXCLUDED —
//      one logical pick can be tracked across several books on one slate),
//   2. fair-implied probability via PRESERVED vigStripping.js when the opposite
//      side is recoverable on the same key/date, else raw-implied fallback,
//   3. realized hit% minus fair% = the honest "vs market" edge, aggregated by tier.
//
// ANTI-FABRICATION (binding): every number traces to {sport}_tracked_bets_*.json
// + vigStripping. A tier with zero settled rows is OMITTED (never shown as 0).
// A tier with n < MIN_MEANINGFUL_N is flagged `insufficient` so the FE renders
// "not yet meaningful" instead of a rate. No data is invented anywhere.
//
// PRESERVED: this module REUSES backend/pipeline/shared/vigStripping.js and does
// not modify it.
// ============================================================================
const fs = require("fs")
const path = require("path")
const vig = require(path.join(__dirname, "..", "shared", "vigStripping.js"))

// Tier display order + collapse-rank (highest tier wins when one logical pick was
// tracked under more than one tier across books). Mirrors the canonical probe.
const TIER_ORDER = ["ELITE", "STRONG", "PLAYABLE", "LONGSHOT", "FADE", "(UNTIERED)"]
const TIER_RANK = { ELITE: 5, STRONG: 4, PLAYABLE: 3, LONGSHOT: 2, FADE: 1, "(UNTIERED)": 0 }
const MIN_MEANINGFUL_N = 30

const DEFAULT_TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

function median(a) {
  const s = a.slice().sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Raw implied probability from American odds. Returns null (never 0) when the
// odds are missing/non-finite/zero — the caller filters non-finite odds upstream,
// so this fallback only ever runs on real prices.
function rawImplied(am) {
  const n = Number(am)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

/**
 * Compute per-tier vig-aware realized hit% for one sport over the full graded
 * corpus. Read-only. Returns null when no graded files exist for the sport.
 *
 * @param {"mlb"|"nba"} sport
 * @param {{ trackingDir?: string }} [opts]
 * @returns {null | {
 *   sport: string, files: number, rawSettled: number, dedupedPicks: number,
 *   collisions: number, vigKnown: number, vigPct: number, windowLabel: string,
 *   tiers: Array<{ tier: string, n: number, hitPct: number, fairPct: number,
 *                  edgePp: number, insufficient: boolean }>
 * }}
 */
function computeHitRateByTier(sport, opts = {}) {
  const trackingDir = opts.trackingDir || DEFAULT_TRACKING_DIR
  let files = []
  try {
    files = fs.readdirSync(trackingDir)
      .filter(f => new RegExp(`^${sport}_tracked_bets_\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f))
      .sort()
  } catch {
    return null
  }
  if (!files.length) return null

  // 1) dedup graded (win/loss) rows by canonical key, book excluded.
  const map = new Map()
  let rawSettled = 0
  for (const f of files) {
    const d = (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1]
    let a
    try { a = JSON.parse(fs.readFileSync(path.join(trackingDir, f), "utf8")) } catch { continue }
    const arr = Array.isArray(a) ? a : (a.entries || a.bets || [])
    for (const b of arr) {
      if (b.result !== "win" && b.result !== "loss") continue
      const am = Number(b.oddsAmerican)
      if (!Number.isFinite(am)) continue
      rawSettled++
      const fam = String(b.statFamily || b.propType || "").toLowerCase()
      const side = String(b.side || "").toLowerCase()
      const key = [String(b.player || "").toLowerCase().trim(), fam, side, String(b.line ?? ""), d].join("|")
      let e = map.get(key)
      if (!e) {
        e = { ams: [], tiers: new Set(), results: new Set(), fam, side, line: String(b.line ?? ""), date: d, player: String(b.player || "").toLowerCase() }
        map.set(key, e)
      }
      e.ams.push(am)
      e.tiers.add(String(b.tier || "(untiered)").toUpperCase())
      e.results.add(b.result)
    }
  }

  // 2) collapse to one pick per key. Drop keys with conflicting results
  //    (same logical pick graded both win and loss across books = ambiguous).
  const picks = []
  let collisions = 0
  for (const [, e] of map) {
    if (e.results.size > 1) { collisions++; continue }
    let best = "(UNTIERED)", rank = -1
    for (const t of e.tiers) { const r = TIER_RANK[t] ?? 0; if (r > rank) { rank = r; best = t } }
    picks.push({ player: e.player, fam: e.fam, side: e.side, line: e.line, date: e.date, win: e.results.has("win") ? 1 : 0, medAm: median(e.ams), tier: best })
  }

  // 3) fair-implied via opposite-side recovery (PRESERVED vig), else raw-implied.
  const byKey = new Map(picks.map(p => [[p.player, p.fam, p.side, p.line, p.date].join("|"), p]))
  let vigKnown = 0
  for (const p of picks) {
    const opp = p.side === "over" ? "under" : (p.side === "under" ? "over" : null)
    let fair = null
    if (opp) {
      const o = byKey.get([p.player, p.fam, opp, p.line, p.date].join("|"))
      if (o) {
        const over = p.side === "over" ? p.medAm : o.medAm
        const under = p.side === "over" ? o.medAm : p.medAm
        fair = vig.fairProbFromAmericanPair(over, under, p.side)
        if (fair != null) vigKnown++
      }
    }
    p.fair = (fair != null) ? fair : rawImplied(p.medAm)
  }

  // 4) aggregate by tier (display order, empty tiers omitted).
  const tiers = []
  for (const tier of TIER_ORDER) {
    const cell = picks.filter(p => p.tier === tier)
    if (!cell.length) continue
    const n = cell.length
    const hit = cell.reduce((a, p) => a + p.win, 0) / n * 100
    const fairAvg = cell.reduce((a, p) => a + p.fair, 0) / n * 100
    const edge = hit - fairAvg
    tiers.push({
      tier,
      n,
      hitPct: Math.round(hit * 10) / 10,
      fairPct: Math.round(fairAvg * 10) / 10,
      edgePp: Math.round(edge * 10) / 10,
      insufficient: n < MIN_MEANINGFUL_N,
    })
  }

  return {
    sport,
    files: files.length,
    rawSettled,
    dedupedPicks: picks.length,
    collisions,
    vigKnown,
    vigPct: picks.length ? Math.round((vigKnown / picks.length) * 1000) / 10 : 0,
    windowLabel: `${files.length} graded days`,
    tiers,
  }
}

module.exports = { computeHitRateByTier, MIN_MEANINGFUL_N }
