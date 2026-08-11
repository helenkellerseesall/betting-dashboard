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
// 2026-07-26 FAMILY EXPANSION — vendor map covers the new families; actual
// scan eligibility STILL flows only from PASS verdicts in the committed JSON
// (a mapped family with a STOP/absent verdict never prices a rung).
const VENDOR_FAM = { batter_hits_alternate: "hits", batter_runs_scored_alternate: "runs", pitcher_strikeouts_alternate: "ks", batter_stolen_bases_alternate: "stolenBases", batter_doubles_alternate: "doubles", batter_triples_alternate: "triples" }
const STAT_KEY = { hits: "hits", runs: "runs", ks: "strikeOuts", stolenBases: "stolenBases", doubles: "doubles", triples: "triples" }

const rd = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
// 2026-07-21 INSTRUMENT-REPAIR — the ONE cross-source join (playerNameJoin)
// replaces the local norm that missed 33/334 ladder players (10%: suffix +
// diacritic + nickname classes; Witt/Acuña/Hernández were silently curve-less).
const { buildJoinIndex, resolvePlayer } = require("../pipeline/shared/playerNameJoin")
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

// ═══════════════════════════════════════════════════════════════════════════
// 2026-07-21 G3-L3 — THE PRE-REGISTERED CURE COLUMNS (approved scope; scored
// on THIS ledger against the SAME gate bars + the counterfactual kill bar).
// The raw policy is FAILING its own gate (−87u / 5.3pp at registration) —
// diagnosis: adverse selection. Three cures run as parallel paper columns:
//   A MARKET-BLEND      p = w·pFair + (1−w)·pMedianImplied. w POOLED, fit
//                       walk-forward from SETTLED flags only (grid, min
//                       Brier); per-family w auto-triggers at ≥300 decided
//                       flags in that family (CA answer ii).
//   B DISAGREE-DAMPEN   required margin = max(FLB margin, 1.0·|pFair −
//                       pMedianImplied|) — k=1 PRE-REGISTERED. Big
//                       disagreement = suspicion, not conviction.
//   C OPPOSITION-COND   batter rung prob conditioned on the opposing
//                       starter's K-strength percentile via the Gaussian
//                       copula conditional with the VALIDATED class ρ —
//                       consumed from the COMMITTED verdicts JSON and ONLY
//                       while that class verdict is PASS. Unresolvable
//                       opponent ⇒ column ABSTAINS (null, never guessed).
// Ledger rows now record every column's prob + flag; the tally scores each
// column on the same bars (14 nights / 300 decided / ≤1.5pp / ≥0u /
// split-half) + COUNTERFACTUAL: share of the raw policy's realized LOSING
// flags this column declined.
// ═══════════════════════════════════════════════════════════════════════════
const { normalCdf, invNormalCdf } = require("../pipeline/shared/gaussianCopula")
const g3v = rd(path.join(ROOT, "config", "g3_correlation_validation.json"))
const oppo = g3v?.results?.batter_pitcher_opposition
const OPPO_ON = !!(oppo && oppo.verdict === "PASS" && Number.isFinite(oppo.rhoZ))
const OPPO_RHO = OPPO_ON ? oppo.rhoZ : null

function fitBlendW() {
  // walk-forward by construction: only ALREADY-SETTLED flags inform today's w
  const entries = readLedger()
  const flags = new Map(entries.filter((e) => e.type === "flag").map((e) => [e.id, e]))
  const settles = entries.filter((e) => e.type === "settle" && e.outcome !== "void" && flags.has(e.id))
  const rows = settles.map((s) => ({ f: flags.get(s.id), hit: s.hit })).filter((x) => Number.isFinite(x.f.pFair) && Number.isFinite(x.f.implied))
  const fit = (subset) => {
    if (subset.length < 30) return null
    let best = { w: 1, brier: Infinity }
    for (let w = 0; w <= 1.0001; w += 0.05) {
      let sq = 0
      for (const x of subset) { const p = w * x.f.pFair + (1 - w) * x.f.implied; sq += (x.hit - p) * (x.hit - p) }
      const b = sq / subset.length
      if (b < best.brier) best = { w: Math.round(w * 100) / 100, brier: b }
    }
    return best
  }
  const pooled = fit(rows) || { w: 1, brier: null, note: "insufficient settles — blend inert (w=1 ⇒ pBlend=pFair)" }
  const perFamily = {}
  for (const fam of ["hits", "runs", "ks"]) {
    const sub = rows.filter((x) => x.f.family === fam)
    if (sub.length >= 300) perFamily[fam] = fit(sub) // CA answer ii: auto-trigger at 300 decided/family
  }
  return { pooled, perFamily, decidedUsed: rows.length }
}
const BLEND = fitBlendW()
const wFor = (fam) => (BLEND.perFamily[fam]?.w ?? BLEND.pooled.w)

// 2026-08-11 ABSTAIN-REASON TALLY (cure-C instrument, GO on ASK 63f24e4):
// every null return names its branch. A column abstaining 100% by
// construction hid for 12 days because nothing counted the reasons —
// the tally makes silent-abstain death visible in the artifact + fixture.
const oppoAbstains = { noBatterTeam: 0, noStarters: 0, noOpp: 0, noPitcherLogs: 0, noCurve: 0, thinLeague: 0, applied: 0 }
function opposingKPercentile(batterPlayer, eventId, ladderKsByEvent, teamIdx, leagueKMeans) {
  if (!OPPO_ON) return null
  const batterTeam = resolvePlayer(teamIdx, batterPlayer)
  if (!batterTeam) { oppoAbstains.noBatterTeam++; return null }
  const starters = ladderKsByEvent.get(eventId) || []
  if (!starters.length) { oppoAbstains.noStarters++; return null }
  const opp = starters.find((s) => { const t = resolvePlayer(teamIdx, s); return t && t !== batterTeam })
  if (!opp) { oppoAbstains.noOpp++; return null }
  const pl = resolvePlayer(pitIdx, opp)
  if (!pl) { oppoAbstains.noPitcherLogs++; return null }
  const curve = fitPlayerFamilyCurve(pl.rows, "ks", { minN: 8, halfLife: frozenHalfLife })
  if (!curve) { oppoAbstains.noCurve++; return null }
  if (leagueKMeans.length < 20) { oppoAbstains.thinLeague++; return null }
  const below = leagueKMeans.filter((m) => m < curve.meta.mean).length
  oppoAbstains.applied++
  return Math.max(0.02, Math.min(0.98, below / leagueKMeans.length))
}

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
  let voidedNow = 0
  for (const f of open) {
    const idx = f.family === "ks" ? pitIdx : batIdx
    const pl = resolvePlayer(idx, f.player)
    const row = pl?.rows.find((g) => String(g.date) === String(f.gameDate))
    if (!row) {
      // 2026-07-21 void-on-scratch: player found but NO row on a game date ≥2
      // days past ⇒ never appeared ⇒ book voids ⇒ settle VOID (0u, excluded
      // from the gate's decided/gap/units math). Player unresolved OR date
      // recent ⇒ stays PENDING, never guessed. (Measured: all 67 stuck
      // pre-07-20 flags were this class.)
      const ageDays = (Date.parse(today) - Date.parse(f.gameDate)) / 86400000
      // coverage guard (2026-07-21): only void when the cache has seen PAST
      // the game date — cache lag must never masquerade as a scratch.
      const newest = pl ? pl.rows.reduce((a, g) => (g.date > a ? g.date : a), "") : ""
      if (pl && ageDays >= 2 && newest > String(f.gameDate)) {
        lines.push(JSON.stringify({ type: "settle", id: f.id, settledAt: new Date().toISOString(), outcome: "void", hit: null, units: 0, note: "no appearance — voided per book behavior" }))
        voidedNow++
      }
      continue
    }
    const hit = Number(row.stats[STAT_KEY[f.family]]) >= f.k ? 1 : 0
    const units = hit ? (f.oddsAmerican > 0 ? f.oddsAmerican / 100 : 100 / Math.abs(f.oddsAmerican)) : -1
    lines.push(JSON.stringify({ type: "settle", id: f.id, settledAt: new Date().toISOString(), hit, units: Math.round(units * 100) / 100 }))
    settledNow++
  }
  if (lines.length) fs.appendFileSync(LEDGER_PATH, lines.join("\n") + "\n")
  if (voidedNow) console.log(`settleFlags: ${voidedNow} no-appearance flag(s) VOIDED (0u, excluded from gate math)`)
  return settledNow
}
function gateTally(column = "raw") {
  const entries = readLedger()
  // legacy pre-L3 ledger rows lack rawFlag ⇒ they WERE raw flags (default true);
  // cure columns exist only on L3-era rows and score only their own flags.
  const inColumn = (e) => (column === "raw" ? e.rawFlag !== false : e[`flag${column}`] === true)
  const flags = new Map(entries.filter((e) => e.type === "flag" && inColumn(e)).map((e) => [e.id, e]))
  // voids are settled-but-not-decided: excluded from nights/decided/gap/units
  const settles = entries.filter((e) => e.type === "settle" && flags.has(e.id) && e.outcome !== "void")
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
  // COUNTERFACTUAL KILL BAR (cure columns only): share of the RAW policy's
  // realized LOSING flags this column DECLINED — a cure must have said no to
  // the losses, not merely ridden along.
  let counterfactual = null
  if (column !== "raw") {
    const allEntries = readLedger()
    const rawFlags = new Map(allEntries.filter((e) => e.type === "flag" && e.rawFlag !== false).map((e) => [e.id, e]))
    const rawLosses = allEntries.filter((e) => e.type === "settle" && e.outcome !== "void" && e.hit === 0 && rawFlags.has(e.id))
    const declinable = rawLosses.filter((s) => rawFlags.get(s.id)[`flag${column}`] !== undefined)
    const declined = declinable.filter((s) => rawFlags.get(s.id)[`flag${column}`] === false)
    counterfactual = declinable.length ? { rawLossesScored: declinable.length, declinedPct: +(100 * declined.length / declinable.length).toFixed(1) } : { rawLossesScored: 0, declinedPct: null }
  }
  return { column, nights: nights.length, decided, pooledGapPp: gap != null ? Math.round(gap * 1000) / 10 : null, flatUnits: Math.round(units * 100) / 100, halves, counterfactual, gate: { needNights: 14, needDecided: 300, gapBarPp: 1.5, unitsBar: 0, counterfactualBar: "declines majority of raw losses" } }
}

// ── main scan ──
const today = currentSlateDateEt()
const batCache = rd(path.join(DATA_DIR, "mlbBatterGameLogsSeason.json"))
const pitCache = rd(path.join(DATA_DIR, "mlbPitcherGameLogsSeason.json"))
if (!batCache || !pitCache) { console.error("scanRungEv: season caches missing"); process.exit(1) }
const mkIdx = (cache, key) => buildJoinIndex(Object.entries(cache.players).map(([k, v]) => [v.fullName || k, { rows: (v[key] || []).map((g) => ({ date: String(g.date), stats: g.stats })).sort((a, b) => (a.date < b.date ? -1 : 1)) }])) // fullName, never the lossy map key
const batIdx = mkIdx(batCache, "games")
const pitIdx = mkIdx(pitCache, "starts")

// G3-L3 supports: batter+pitcher team index — SEASON CACHES (2026-08-11
// cure-C root fix, GO on ASK 63f24e4). TWO-LAYER AUTOPSY, stated honestly:
// (1) PRIMARY: the old loop read `TRACKING` — a variable that never existed
//     (only TRACKING_DIR does) — inside a bare try/catch. ReferenceError,
//     swallowed, teamIdxEntries stayed [], teamIdx EMPTY ⇒ every batter row
//     abstained at noBatterTeam every night since arming. (The 8/11 ASK's
//     replay used the correct dir and so measured the INTENDED code — 423
//     noBatterTeam / 880 noOpp — not the shipped typo; corrected at landing.)
// (2) SECONDARY (real even without the typo): tracked_best is a PICK index —
//     starting pitchers rarely make the pick board, so the intended code
//     still abstained ~100% via noOpp.
// CURE: build from the season caches the scan already loads — teamName on
// 258/258 pitchers + 553/553 batters (measured 8/10) — the exact universe
// the scan can price (no gamelogs ⇒ no curve ⇒ row skipped anyway).
// tracked_best deliberately NOT merged: buildJoinIndex deletes cross-source
// value collisions (team-string format drift ⇒ ambiguous ⇒ key dropped), so
// a merge could only shrink coverage. NO try/catch swallow — a broken cache
// must crash loudly, never quietly zero a column again. +
// league starter K-strength distribution (curve means, computed once).
const teamIdxEntries = []
for (const cache of [batCache, pitCache]) {
  for (const [ck, cv] of Object.entries(cache.players || {})) {
    const nm = cv.fullName || ck
    const tm = cv.teamName || null
    if (nm && tm) teamIdxEntries.push([nm, tm])
  }
}
const teamIdx = buildJoinIndex(teamIdxEntries)
const leagueKMeans = (() => {
  const out = []
  for (const [, v] of Object.entries(pitCache.players)) {
    const rows = (v.starts || []).map((g) => ({ date: String(g.date), stats: g.stats }))
    const c = rows.length >= 8 ? fitPlayerFamilyCurve(rows, "ks", { minN: 8, halfLife: frozenHalfLife }) : null
    if (c) out.push(c.meta.mean)
  }
  return out.sort((a, b) => a - b)
})()

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
  const impliedLists = new Map() // key → all-book implied list (median = the consensus for cures A/B)
  const ladderKsByEvent = new Map() // eventId → starter names (from the store's own ks rungs)
  for (const r of store?.rows || []) {
    if (r.family === "pitcher_strikeouts_alternate" && r.eventId) {
      if (!ladderKsByEvent.has(r.eventId)) ladderKsByEvent.set(r.eventId, [])
      if (!ladderKsByEvent.get(r.eventId).includes(r.player)) ladderKsByEvent.get(r.eventId).push(r.player)
    }
    const fam = VENDOR_FAM[r.family]
    if (!fam || !eligible.includes(fam)) continue
    if (String(r.side).toLowerCase() !== "over" || !Number.isFinite(Number(r.line))) continue
    const key = `${String(r.player).toLowerCase()}|${fam}|${r.line}`
    if (!impliedLists.has(key)) impliedLists.set(key, [])
    impliedLists.get(key).push(impliedOf(Number(r.oddsAmerican)))
    const prev = best.get(key)
    if (!prev || Number(r.oddsAmerican) > Number(prev.oddsAmerican)) best.set(key, { ...r, fam, _key: key })
  }
  const rows = []
  for (const r of best.values()) {
    const idx = r.fam === "ks" ? pitIdx : batIdx
    const pl = resolvePlayer(idx, r.player)
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
    // ── G3-L3 cure columns (pre-registered; paper-only) ──
    const impList = (impliedLists.get(r._key) || [implied]).sort((a, b) => a - b)
    const pMedian = impList[Math.floor(impList.length / 2)]
    const wA = wFor(r.fam)
    const pBlend = wA * pFair + (1 - wA) * pMedian
    const flagA = pBlend - implied > marginFor(r.fam, pBlend)
    const marginB = Math.max(margin, Math.abs(pFair - pMedian)) // k=1 pre-registered
    const flagB = edge > marginB
    let pOppo = null, flagC = false
    if (OPPO_ON && r.fam !== "ks") {
      const u = opposingKPercentile(r.player, r.eventId, ladderKsByEvent, teamIdx, leagueKMeans)
      if (u != null) {
        // SIGN CONVENTION (gaussianCopula: hit ⟺ Z ≤ Φ⁻¹(p), i.e. LOW latent
        // = hit): a strong-K starter (high strength percentile u) sits at a
        // LOW expected latent, so zP = −Φ⁻¹(u). With the validated ρ<0 this
        // correctly LOWERS batter rung probs against strong-K opposition
        // (direction unit-pinned in the fixture).
        const zP = -invNormalCdf(u)
        pOppo = normalCdf((invNormalCdf(pFair) - OPPO_RHO * zP) / Math.sqrt(1 - OPPO_RHO * OPPO_RHO))
        flagC = pOppo - implied > marginFor(r.fam, pOppo)
      }
    }
    const cures = { pBlend: +pBlend.toFixed(4), w: wA, pMedian: +pMedian.toFixed(4), marginBPp: +(marginB * 100).toFixed(1), pOppo: pOppo != null ? +pOppo.toFixed(4) : null, flagA, flagB, flagC }
    const row = { player: r.player, family: r.fam, line: Number(r.line), k, eventId: r.eventId || null, book: r.book, oddsAmerican: Number(r.oddsAmerican), pFair: Math.round(pFair * 10000) / 10000, implied: Math.round(implied * 10000) / 10000, edgePp: Math.round(edge * 1000) / 10, marginPp: Math.round(margin * 1000) / 10, evPer$1: Math.round(ev * 1000) / 1000, flagged, cures, curveN: curve.meta.n, method: curve.meta.method }
    rows.push(row)
    if (flagged || flagA || flagB || flagC) {
      // flag-id normalization FROZEN to the original formula (ledger id
      // continuity — a changed id format would re-flag existing rungs as new)
      const idNorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim()
      const id = `${gameDate}|${idNorm(r.player)}|${r.fam}|${r.line}|${r.book}`
      if (!existingFlagIds.has(id)) {
        newLedgerLines.push(JSON.stringify({ type: "flag", id, gameDate, player: r.player, family: r.fam, line: Number(r.line), k, book: r.book, oddsAmerican: Number(r.oddsAmerican), pFair: row.pFair, implied: row.implied, rawFlag: flagged, flagA, flagB, flagC, pBlend: cures.pBlend, pOppo: cures.pOppo, flaggedAt: new Date().toISOString() }))
        existingFlagIds.add(id)
      }
      if (flagged) totalFlags++
    }
  }
  const artifact = {
    gameDate, generatedAt: new Date().toISOString(), shadow: true,
    frozenHalfLife, eligibleFamilies: eligible, hardExcluded: HARD_EXCLUDED,
    rows: rows.sort((a, b) => b.evPer$1 - a.evPer$1),
    summary: { rungsPriced: rows.length, flagged: rows.filter((x) => x.flagged).length, cureFlags: { A: rows.filter((x) => x.cures?.flagA).length, B: rows.filter((x) => x.cures?.flagB).length, C: rows.filter((x) => x.cures?.flagC).length, oppoEnabled: OPPO_ON, blendW: BLEND.pooled.w, blendDecidedUsed: BLEND.decidedUsed }, gate: gateTally("raw"), cureGates: { A: gateTally("A"), B: gateTally("B"), C: { ...gateTally("C"), abstainsTonight: { ...oppoAbstains } } } },
  }
  const fp = path.join(TRACKING_DIR, `mlb_rung_scan_${gameDate}.json`)
  const tmpFp = `${fp}.tmp.${process.pid}`
  fs.writeFileSync(tmpFp, JSON.stringify(artifact, null, 2))
  fs.renameSync(tmpFp, fp)
  console.log(`scanRungEv [${gameDate}]: ${rows.length} rungs priced (${eligible.join("/")}) · ${artifact.summary.flagged} flagged (+EV past FLB margin) → ${path.basename(fp)}`)
  for (const r of rows.filter((x) => x.flagged).slice(0, 8)) console.log(`  FLAG ${r.player} ${r.family} ${r.k}+ @ ${r.book} ${r.oddsAmerican > 0 ? "+" : ""}${r.oddsAmerican} · fair ${(r.pFair * 100).toFixed(1)}% vs implied ${(r.implied * 100).toFixed(1)}% · edge ${r.edgePp}pp (margin ${r.marginPp}pp) · EV ${r.evPer$1 >= 0 ? "+" : ""}${r.evPer$1}/$1 · n=${r.curveN}`)
}
if (newLedgerLines.length) { fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true }); fs.appendFileSync(LEDGER_PATH, newLedgerLines.join("\n") + "\n") }
const tally = gateTally("raw")
console.log(`gate tally [raw]: ${tally.nights}/14 nights · ${tally.decided}/300 decided flags · pooled gap ${tally.pooledGapPp ?? "—"}pp (bar 1.5) · flat-$1 ${tally.flatUnits >= 0 ? "+" : ""}${tally.flatUnits}u (bar ≥0) · settled this run ${settledNow} · SHADOW (operator-gated flip)`)
for (const c of ["A", "B", "C"]) {
  const t = gateTally(c)
  console.log(`  cure ${c}: ${t.nights} nights · ${t.decided} decided · gap ${t.pooledGapPp ?? "—"}pp · ${t.flatUnits >= 0 ? "+" : ""}${t.flatUnits}u · counterfactual declined ${t.counterfactual?.declinedPct ?? "—"}% of ${t.counterfactual?.rawLossesScored ?? 0} raw losses${c === "A" ? ` (w=${BLEND.pooled.w} from ${BLEND.decidedUsed} settles)` : c === "C" ? ` (${OPPO_ON ? "ρ=" + OPPO_RHO + " · tonight " + JSON.stringify(oppoAbstains) : "DISABLED — class not PASS"})` : ""}`)
}
if (!ladderFiles.length) console.log(`scanRungEv: no ladder stores for ${today}+ — honest no-scan (capture passes fire 10:00/17:00/22:05 ET on game days)`)
