"use strict"

/**
 * settlePlacedBet.js — manual settlement override for PLACED (real-money) bets.
 *
 * 2026-07-05 SPINE-FIX 3 — GRADING_RULES.md §5: the BOOK's actual settlement is
 * authoritative for real-money P/L. The auto-grader has no void path yet (a
 * scratched player stays pending forever, or an over could grade loss on a
 * 0-stat appearance the book refunds), and bets outside the board's exact tuple
 * never auto-settle (§9). This CLI is the manual override for both cases.
 *
 * Usage:
 *   node backend/scripts/settlePlacedBet.js --list
 *       List pending PLACED bets (decisionType="placed" / realMoney) with ids.
 *   node backend/scripts/settlePlacedBet.js --list --all
 *       Include already-settled placed bets (audit view).
 *   node backend/scripts/settlePlacedBet.js --id=<id> --result=void
 *   node backend/scripts/settlePlacedBet.js --id=<id> --result=win --payout=12.50
 *   node backend/scripts/settlePlacedBet.js --id=<id> --result=loss [--actual=N] [--note="..."]
 *       Settle one bet via the canonical buildPersonalLedger.settleBet (result
 *       vocabulary: win | loss | push | void — GRADING_RULES §3). --payout is
 *       the TOTAL return the book credited (win/void); --actual records the
 *       player's actual stat when known.
 *
 * Safety rails:
 *   - Refuses to touch non-placed (model-tracked) rows unless --force is given —
 *     the model's own record settles via grading, never by hand.
 *   - Refuses to re-settle an already-settled bet unless --force is given
 *     (settled rows are immutable by default — GRADING_RULES §6).
 *   - All writes go through settleBet (bankroll + analytics + SQLite mirror
 *     update in one canonical path). No direct ledger writes here.
 */

const { loadLedger, settleBet } = require("../pipeline/shared/buildPersonalLedger")

function parseArgs(argv) {
  const o = {}
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue
    const eq = a.indexOf("=")
    if (eq === -1) o[a.slice(2)] = true
    else o[a.slice(2, eq)] = a.slice(eq + 1)
  }
  return o
}

const isPlaced = (b) => b && (b.decisionType === "placed" || b.realMoney === true)

function fmtOdds(o) { const n = Number(o); return Number.isFinite(n) ? (n > 0 ? `+${n}` : String(n)) : "?" }

function listPlaced({ all = false } = {}) {
  const ledger = loadLedger()
  const placed = (ledger.bets || []).filter(isPlaced)
  const rows = all ? placed : placed.filter((b) => b.result === "pending")
  console.log(`[settlePlacedBet] ${rows.length} ${all ? "placed" : "PENDING placed"} bet(s)${all ? "" : " (use --all to include settled)"}:`)
  for (const b of rows) {
    const desc = b.betType === "parlay" ? `PARLAY: ${b.prop}` : `${b.player} ${b.statFamily} ${b.side} ${b.line}`
    console.log(`  id=${b.id}`)
    console.log(`     ${b.date} · ${b.sport} · ${desc} · ${fmtOdds(b.odds)} @ ${b.sportsbook} · $${b.stake} → $${b.toWin}`)
    console.log(`     result=${b.result}${b.settledAt ? ` (settled ${b.settledAt})` : ""}${b.calibVersion ? ` · calibVersion=${b.calibVersion}` : ""}${b.matchedTrackedId ? " · tuple-matched" : b.betType === "parlay" ? "" : " · NO tuple match (manual settle expected)"}`)
  }
  if (!rows.length && !all) console.log("  (nothing pending — place bets with addPlacedBet.js)")
  return rows.length
}

function main() {
  const o = parseArgs(process.argv)

  if (o.list) {
    listPlaced({ all: !!o.all })
    process.exit(0)
  }

  const id = o.id
  const result = String(o.result || "").toLowerCase()
  if (!id || !result) {
    console.error("Usage: settlePlacedBet.js --list [--all]   OR   --id=<id> --result=win|loss|push|void [--payout=N] [--actual=N] [--note=...] [--force]")
    process.exit(1)
  }
  if (!["win", "loss", "push", "void"].includes(result)) {
    console.error(`[settlePlacedBet] REJECTED: --result="${o.result}" invalid. Valid: win, loss, push, void (GRADING_RULES §3)`)
    process.exit(1)
  }

  // Pre-flight: find the bet and apply the safety rails BEFORE any write.
  const ledger = loadLedger()
  const bet = (ledger.bets || []).find((b) => b && b.id === id)
  if (!bet) {
    console.error(`[settlePlacedBet] REJECTED: no bet with id=${id}. Run --list to see pending placed bets.`)
    process.exit(1)
  }
  if (!isPlaced(bet) && !o.force) {
    console.error(`[settlePlacedBet] REJECTED: ${id} is a MODEL-TRACKED row, not a placed bet. The model's record settles via grading, never by hand. (--force to override — not recommended.)`)
    process.exit(1)
  }
  if (bet.result && bet.result !== "pending" && !o.force) {
    console.error(`[settlePlacedBet] REJECTED: ${id} is already settled (${bet.result} at ${bet.settledAt}). Settled rows are immutable (GRADING_RULES §6). (--force to override — only for correcting a manual entry error.)`)
    process.exit(1)
  }

  const note = o.note || `manual settle — book authoritative (GRADING_RULES §5)`
  const r = settleBet(id, {
    result,
    payout: o.payout != null ? Number(o.payout) : undefined,
    actualStat: o.actual != null ? Number(o.actual) : undefined,
    note,
  })
  if (!r.ok) {
    console.error(`[settlePlacedBet] settle FAILED: ${r.reason}${r.valid ? ` (valid: ${r.valid.join(", ")})` : ""}`)
    process.exit(1)
  }
  console.log(`[settlePlacedBet] settled ${id} → ${result}`)
  console.log(`  bet:      ${r.bet.player} ${r.bet.statFamily ?? ""} ${r.bet.side ?? ""} ${r.bet.line ?? ""} @ ${r.bet.sportsbook}`)
  console.log(`  payout:   ${r.bet.payout != null ? `$${r.bet.payout}` : "(none recorded)"}`)
  console.log(`  bankroll: $${r.prevBalance} → $${r.newBalance}`)
  process.exit(0)
}

main()
