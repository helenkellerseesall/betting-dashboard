#!/usr/bin/env node
"use strict"

/**
 * settleParlaysFromRecord.js — PARLAY AUTO-SETTLE (2026-07-28, operator triple #2).
 *
 * Pending realMoney parlays settle from the RECORD: each leg tuple-joins its
 * graded twin in mlb_tracked_bets_<gameDate> (book-agnostic — outcomes are
 * outcomes). Rules (GRADING_RULES v2 §10, documented in the same landing):
 *   all legs WIN            ⇒ parlay WIN, payout = stake × Π dec(surviving legs)
 *   any leg LOSS            ⇒ parlay LOSS
 *   leg VOID (record void)  ⇒ DROP-AND-RECOMPUTE — the leg leaves the ticket
 *                             and the combined odds recompute from the rest
 *                             (book convention); all legs void ⇒ parlay VOID
 *   any leg PENDING         ⇒ parlay stays pending (never guessed)
 * Settled write-once with settledAt + settleNote provenance. Runs nightly
 * (05:35, post-grade) + immediately via the applyResults rider. RED alarm:
 * settleable-but-unsettled parlay past its grading night (parlaySettle line).
 */

const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
const TRACKING = process.env.PS_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const LEDGER_PATH = process.env.PS_LEDGER || path.join(TRACKING, "personal_ledger.json")
const norm = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "")
const decOf = (o) => (Number(o) > 0 ? 1 + Number(o) / 100 : 1 + 100 / Math.abs(Number(o)))

// ── 2026-07-30 FINALS-FALLBACK (incident ASK 7aae50f, part B) ────────────────
// A leg with NO graded twin (the Clement u0.5 class: the board never tracked
// that line) can NEVER settle via the tuple join. Once the slate has graded
// (its tracked file carries win/loss rows — the grading night ran), such legs
// grade from the OFFICIAL FINALS the grader already trusts. The finals come
// from a per-date CACHE FILE (mlb_finals_<date>.json) written by the async
// prefetch below — settleParlays itself stays SYNC (the phase4Tracking rider
// calls it synchronously); the rider simply doesn't fire the fallback until
// the nightly CLI run has prefetched. Never-guess preserved: no cache, or
// player absent from a young slate ⇒ pending; player absent from finals at
// slate ≥2 days (scratch-rule mirror) ⇒ leg VOID via drop-and-recompute.
const finalsPathFor = (date, dir) => path.join(dir || TRACKING, `mlb_finals_${date}.json`)
function loadFinals(date, dir) {
  try { return JSON.parse(fs.readFileSync(finalsPathFor(date, dir), "utf8")) } catch (_) { return null }
}
async function prefetchFinals(dates, { dir } = {}) {
  const { fetchMlbGameResults } = require("../pipeline/grading/fetchMlbGameResults")
  const out = []
  for (const d of [...new Set(dates)].filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x)))) {
    const fp = finalsPathFor(d, dir)
    if (fs.existsSync(fp)) { out.push({ date: d, cached: true }); continue }
    try {
      const map = await fetchMlbGameResults(d)
      if (map && map.size) {
        const tmp = `${fp}.tmp.${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)))
        fs.renameSync(tmp, fp)
        out.push({ date: d, fetched: map.size })
      } else out.push({ date: d, empty: true })
    } catch (e) { out.push({ date: d, error: String(e?.message || e) }) }
  }
  return out
}
const _slateAgeDays = (slate) => {
  const { currentSlateDateEt } = require("../pipeline/shared/slateDate")
  const k = (x) => { const [y, m, dd] = String(x).split("-").map(Number); return Date.UTC(y, m - 1, dd, 12) }
  return Math.round((k(currentSlateDateEt()) - k(slate)) / 86400000)
}

function settleParlays(opts = {}) {
  const { dryRun = false } = opts
  const L = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"))
  const bets = Array.isArray(L.bets) ? L.bets : []
  const pending = bets.filter((b) => (b.betType === "parlay" || b.betType === "slip") && (b.decisionType === "placed" || b.realMoney) && b.result === "pending" && Array.isArray(b.legs) && b.legs.length)
  const receipts = []
  for (const p of pending) {
    const gameDate = p.gameDate || p.date
    let rows = null
    try { rows = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${gameDate}.json`), "utf8")) } catch (_) { continue }
    const slateGraded = rows.some((r) => ["win", "loss"].includes(String(r.result)))
    const finals = slateGraded ? loadFinals(gameDate, opts.finalsDir) : null
    const { getStatValue } = require("../pipeline/grading/fetchMlbGameResults")
    const legResults = p.legs.map((leg) => {
      const twin = rows.find((r) => norm(r.player) === norm(leg.player) && String(r.statFamily) === String(leg.statFamily || leg.stat) && String(r.side).toLowerCase() === String(leg.side).toLowerCase() && Number(r.line) === Number(leg.line) && ["win", "loss", "push", "void"].includes(String(r.result)))
      if (twin) return String(twin.result)
      // FINALS-FALLBACK — twin-less leg, slate graded, finals cached.
      if (!finals) return "pending"
      const fKey = Object.keys(finals).find((k) => norm(k) === norm(leg.player))
      const line = Number(leg.line)
      if (fKey && Number.isFinite(line)) {
        const val = Number(getStatValue(finals[fKey], leg.statFamily || leg.stat))
        if (Number.isFinite(val)) {
          // 2026-08-15 SEV-1 8a94621b: side semantics are an ENUM, not a
          // boolean. The old startsWith("o") collapsed every unknown side into
          // UNDER math — a "yes 1" SGP milestone leg with actual 0 graded WIN
          // while the book settled the ticket LOST (slip 20PA06DZUD). The
          // fallback knows over/under ONLY; any other side is REFUSED to
          // manual settle. Never-guess restored at the exact branch it broke.
          const sideTok = String(leg.side).toLowerCase().trim()
          const isOver = sideTok === "over" || sideTok === "o"
          const isUnder = sideTok === "under" || sideTok === "u"
          if (!isOver && !isUnder) {
            leg.legNote = `finals-fallback REFUSED: side "${leg.side}" has no over/under semantics — manual settle required (never guessed)`
            return "pending"
          }
          const res = val === line ? "push" : (isOver === (val > line) ? "win" : "loss")
          leg.legNote = `graded from official finals (no board twin at this line): actual ${val} vs ${leg.side} ${line}`
          return res
        }
      }
      // player absent from finals: young slate ⇒ pending (retry); ≥2 days ⇒
      // no appearance ⇒ VOID per book behavior (scratch-rule mirror).
      if (!fKey && _slateAgeDays(gameDate) >= 2 && Object.keys(finals).length) {
        leg.legNote = `no appearance in official finals — leg voided per book behavior (scratch-rule mirror)`
        return "void"
      }
      return "pending"
    })
    if (legResults.includes("pending")) continue // never guessed
    const live = p.legs.filter((_, i) => legResults[i] !== "void" && legResults[i] !== "push")
    const liveResults = legResults.filter((r) => r !== "void" && r !== "push")
    const hasVoid = legResults.some((r) => r === "void" || r === "push")
    let result, payout, note
    if (!live.length) { result = "void"; payout = Number(p.stake) || 0; note = "all legs void — stake returned" }
    else if (liveResults.includes("loss")) { result = "loss"; payout = 0; note = `leg results ${legResults.join("/")}` }
    else if (!hasVoid) {
      // clean all-win: the ticket's COMBINED odds are the book truth
      const dec = decOf(p.odds ?? p.oddsAmerican)
      if (!Number.isFinite(dec)) continue // no priced ticket ⇒ manual (never fabricate)
      result = "win"
      payout = Math.round((Number(p.stake) || 0) * dec * 100) / 100
      note = `all legs win (combined dec ${dec.toFixed(3)})`
    } else {
      // void-leg drop-and-recompute NEEDS per-leg prices; absent ⇒ manual
      const legDecs = live.map((l) => decOf(l.oddsAmerican ?? l.odds))
      if (legDecs.some((d) => !Number.isFinite(d))) { console.log(`  ${p.id}: WIN-with-void but legs carry no prices — cannot recompute, deferred to manual settle (never fabricated)`); continue }
      const dec = legDecs.reduce((a, d) => a * d, 1)
      result = "win"
      payout = Math.round((Number(p.stake) || 0) * dec * 100) / 100
      note = `WIN with void-leg drop-and-recompute (legs ${legResults.join("/")}; recomputed dec ${dec.toFixed(3)})`
    }
    receipts.push({ id: p.id, gameDate, result, payout, legResults })
    if (!dryRun) {
      p.result = result
      p.payout = payout
      p.settledAt = new Date().toISOString()
      p.settleNote = ((p.settleNote ? p.settleNote + " | " : "") + `auto-settled from record ${new Date().toISOString().slice(0, 10)} (GRADING_RULES v2 §10): ${note}`)
      for (let i = 0; i < p.legs.length; i++) p.legs[i].result = legResults[i]
    }
  }
  if (!dryRun && receipts.length) fs.writeFileSync(LEDGER_PATH, JSON.stringify(L, null, 2))
  return { checked: pending.length, settled: receipts.length, receipts }
}

/**
 * 2026-07-29 BETS-PAGE PACK 2 (3) — LEG-RESULTS BACKFILL for SETTLED parlays.
 *
 * Field case: the 07-27 ticket was settled WIN via the sanctioned manual path
 * (book truth 4.33), but manual settle only writes the TICKET — its legs
 * stayed "pending" on the MY BETS card ("WON with pending legs"). This pass
 * stamps leg results from their graded twins for parlays that are ALREADY
 * settled, touching ONLY legs[i].result (+ a legNote provenance line):
 * result / payout / settledAt / settleNote are NEVER modified — the settled
 * ticket is immutable (GRADING_RULES §6); this is annotation, not settlement.
 * Legs whose twin is ungraded stay pending — never guessed. Idempotent: a
 * second run finds no pending legs and no-ops. Runs in the nightly main below
 * AND immediately from settlePlacedBet after a manual parlay settle, so the
 * class cannot recur.
 *
 * opts.onlyId — restrict to one bet (the manual-settle hook).
 */
function backfillLegResults({ dryRun = false, onlyId = null } = {}) {
  const L = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"))
  const bets = Array.isArray(L.bets) ? L.bets : []
  const targets = bets.filter((b) =>
    (b.betType === "parlay" || b.betType === "slip") &&
    (b.decisionType === "placed" || b.realMoney) &&
    b.result && b.result !== "pending" &&
    Array.isArray(b.legs) && b.legs.some((l) => !l.result || l.result === "pending") &&
    (!onlyId || b.id === onlyId))
  const receipts = []
  for (const p of targets) {
    const gameDate = p.gameDate || p.date
    let rows = null
    try { rows = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${gameDate}.json`), "utf8")) } catch (_) { continue }
    let stamped = 0
    const legResults = []
    for (const leg of p.legs) {
      if (leg.result && leg.result !== "pending") { legResults.push(leg.result); continue }
      const twin = rows.find((r) => norm(r.player) === norm(leg.player) && String(r.statFamily) === String(leg.statFamily || leg.stat) && String(r.side).toLowerCase() === String(leg.side).toLowerCase() && Number(r.line) === Number(leg.line) && ["win", "loss", "push", "void"].includes(String(r.result)))
      if (!twin) { legResults.push("pending"); continue } // ungraded twin — never guessed
      legResults.push(String(twin.result))
      if (!dryRun) { leg.result = String(twin.result); leg.legNote = `leg result backfilled from graded record ${new Date().toISOString().slice(0, 10)} (ticket settle untouched)` }
      stamped++
    }
    if (stamped) receipts.push({ id: p.id, gameDate, stamped, legResults })
  }
  if (!dryRun && receipts.length) fs.writeFileSync(LEDGER_PATH, JSON.stringify(L, null, 2))
  return { checked: targets.length, backfilled: receipts.length, receipts }
}

if (require.main === module) {
  const dry = process.argv.includes("--dry")
  ;(async () => {
    // FINALS-FALLBACK prefetch: cache finals for every pending parlay's date
    // whose slate has graded (async here in the CLI; settleParlays stays sync
    // so the phase4Tracking rider's contract is untouched). PS_SKIP_PREFETCH=1
    // = hermetic fixture mode: pre-written caches only, zero network.
    if (process.env.PS_SKIP_PREFETCH === "1") { console.log("  finals prefetch SKIPPED (PS_SKIP_PREFETCH=1 — fixture mode)") } else try {
      const L0 = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"))
      const dates = (L0.bets || []).filter((b) => (b.betType === "parlay" || b.betType === "slip") && (b.decisionType === "placed" || b.realMoney) && b.result === "pending").map((b) => b.gameDate || b.date)
      // 2026-08-24 INCIDENT (a): the finals cache is a SHARED grading authority
      // but its date list was gated on pending placed parlays — a week with no
      // operator bets fetched NOTHING and starved the daily3 finals-absence
      // branch (Wilson 8/18 stuck the card 5 days). Every UNGRADED daily3 card
      // date joins the prefetch set. Read-only extension; the ONE fetch
      // authority (fetchMlbGameResults) unchanged.
      try {
        const trkDir = path.dirname(LEDGER_PATH)
        for (const f of fs.readdirSync(trkDir).filter((x) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
          const card = JSON.parse(fs.readFileSync(path.join(trkDir, f), "utf8"))
          if (card && !card.results && Array.isArray(card.picks)) dates.push((f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1])
        }
      } catch (_) { /* additive — parlay prefetch never blocks on daily3 scan */ }
      const pf = await prefetchFinals(dates)
      for (const x of pf) console.log(`  finals[${x.date}]: ${x.cached ? "cached" : x.fetched ? x.fetched + " players fetched" : x.empty ? "empty (games not final?)" : "ERROR " + x.error}`)
    } catch (e) { console.log(`  finals prefetch skipped: ${e?.message || e}`) }
    const r = settleParlays({ dryRun: dry })
    console.log(`settleParlaysFromRecord${dry ? " [DRY]" : ""}: ${r.settled}/${r.checked} pending parlays settled`)
    for (const x of r.receipts) console.log(`  ${x.id} [${x.gameDate}] → ${x.result.toUpperCase()} payout $${x.payout} (legs ${x.legResults.join("/")})`)
    if (!r.checked) console.log("  no pending realMoney parlays — honest no-op")
    // PACK 2 (3) — nightly leg-results sweep: settled-with-pending-legs strays.
    const b = backfillLegResults({ dryRun: dry })
    console.log(`legResultsBackfill${dry ? " [DRY]" : ""}: ${b.backfilled}/${b.checked} settled parlays had legs stamped`)
    for (const x of b.receipts) console.log(`  ${x.id} [${x.gameDate}] → legs ${x.legResults.join("/")} (${x.stamped} stamped; ticket untouched)`)
  })()
}
/**
 * 2026-08-02 VOID-WAIT (ASK 70cf06c) — the ONE void-candidacy authority,
 * shared by the parlaySettle alarm (waiting-vs-stale) and the ledger lens
 * (effective-win). Per unresolved leg:
 *   graded twin            ⇒ { state: "graded", result }
 *   no twin + finals PRESENT + player ABSENT ⇒ { state: "void_candidate" }
 *     (the book voids no-shows; the scratch-mirror confirms at slate ≥2d)
 *   anything else          ⇒ { state: "unresolved" } (finals absent ⇒ NEVER
 *     guessed into candidacy — an absent cache proves nothing)
 */
function classifyLegs(bet, rows, finals) {
  return (bet.legs || []).map((leg) => {
    const twin = (Array.isArray(rows) ? rows : []).find((r) => norm(r.player) === norm(leg.player) && String(r.statFamily) === String(leg.statFamily || leg.stat) && String(r.side).toLowerCase() === String(leg.side).toLowerCase() && Number(r.line) === Number(leg.line) && ["win", "loss", "push", "void"].includes(String(r.result)))
    if (twin) return { player: leg.player, state: "graded", result: String(twin.result) }
    if (finals && Object.keys(finals).length) {
      const present = Object.keys(finals).some((k) => norm(k) === norm(leg.player))
      if (!present) return { player: leg.player, state: "void_candidate" }
    }
    return { player: leg.player, state: "unresolved" }
  })
}

module.exports = { settleParlays, backfillLegResults, prefetchFinals, loadFinals, classifyLegs }
