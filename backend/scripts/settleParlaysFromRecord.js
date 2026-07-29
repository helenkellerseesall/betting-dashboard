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
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
const decOf = (o) => (Number(o) > 0 ? 1 + Number(o) / 100 : 1 + 100 / Math.abs(Number(o)))

function settleParlays({ dryRun = false } = {}) {
  const L = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"))
  const bets = Array.isArray(L.bets) ? L.bets : []
  const pending = bets.filter((b) => (b.betType === "parlay" || b.betType === "slip") && (b.decisionType === "placed" || b.realMoney) && b.result === "pending" && Array.isArray(b.legs) && b.legs.length)
  const receipts = []
  for (const p of pending) {
    const gameDate = p.gameDate || p.date
    let rows = null
    try { rows = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${gameDate}.json`), "utf8")) } catch (_) { continue }
    const legResults = p.legs.map((leg) => {
      const twin = rows.find((r) => norm(r.player) === norm(leg.player) && String(r.statFamily) === String(leg.statFamily || leg.stat) && String(r.side).toLowerCase() === String(leg.side).toLowerCase() && Number(r.line) === Number(leg.line) && ["win", "loss", "push", "void"].includes(String(r.result)))
      return twin ? String(twin.result) : "pending"
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
  const r = settleParlays({ dryRun: dry })
  console.log(`settleParlaysFromRecord${dry ? " [DRY]" : ""}: ${r.settled}/${r.checked} pending parlays settled`)
  for (const x of r.receipts) console.log(`  ${x.id} [${x.gameDate}] → ${x.result.toUpperCase()} payout $${x.payout} (legs ${x.legResults.join("/")})`)
  if (!r.checked) console.log("  no pending realMoney parlays — honest no-op")
  // PACK 2 (3) — nightly leg-results sweep: settled-with-pending-legs strays.
  const b = backfillLegResults({ dryRun: dry })
  console.log(`legResultsBackfill${dry ? " [DRY]" : ""}: ${b.backfilled}/${b.checked} settled parlays had legs stamped`)
  for (const x of b.receipts) console.log(`  ${x.id} [${x.gameDate}] → legs ${x.legResults.join("/")} (${x.stamped} stamped; ticket untouched)`)
}
module.exports = { settleParlays, backfillLegResults }
