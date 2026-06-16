"use strict"
/**
 * probeCashoutHedge.js — Phase Cashout-Hedge-1A (2026-06-15)
 * Operator-visible demo of the cash-out / hedge calculator on the exact scenario
 * the operator described: a 3-leg HR parlay, 2 legs hit, 1 leg pending — what's my
 * fair cash-out, the book's likely offer band, and what hedge LOCKS a profit.
 * Pure math; reads nothing live. Writes to .scratch/last.txt.
 *   node backend/scripts/probeCashoutHedge.js
 */
const path = require("path")
const fs = require("fs")
const ch = require("../pipeline/shared/cashoutHedge")
const SCRATCH = path.join(__dirname, "..", "..", ".scratch", "last.txt")
const out = []; const log = (s) => out.push(s)
const $ = (x) => "$" + (Math.round(x * 100) / 100).toFixed(2)

log("=== cash-out / hedge demo — 3-leg HR parlay, 2 hit, 1 pending ===")
log("generated " + new Date().toISOString())
// $10 on three +250 HR legs (decimal 3.5 each) → full decimal 42.875, R = $428.75
const legs = [
  { oddsAmerican: 250, status: "won" },     // HR #1 already hit
  { oddsAmerican: 250, status: "won" },     // HR #2 already hit
  { oddsAmerican: 250, status: "pending", prob: 0.30 }, // HR #3 still to come; calibrated ~30%
]
const cv = ch.cashoutValue({ stake: 10, legs })
log("")
log("Stake: $10   |   full parlay decimal: " + cv.fullDecimal.toFixed(3) + "   |   potential return if all 3 hit: " + $(cv.potentialReturn))
log("Legs: 2 HR hit, 1 HR pending (true prob ~" + (legs[2].prob * 100) + "%)")
log("")
log("FAIR cash-out value (potentialReturn × P(last leg hits)): " + $(cv.fairCashout))
log("Book will likely OFFER (70–90% haircut band): " + $(cv.offerBand.low) + "  …  " + $(cv.offerBand.high) + "   (mid " + $(cv.offerBand.mid) + ")")
log("")
// hedge the final leg: bet the NO-HR / opposite market. say the hedge side is -120 (decimal 1.833)
const hedge = ch.hedgeFinalLeg({ stake: 10, potentialReturn: cv.potentialReturn, hedgeOdds: -120 })
log("HEDGE the last leg on the opposite side at -120 (decimal " + hedge.hedgeDecimal.toFixed(3) + "):")
log("  bet " + $(hedge.hedgeStake) + " on the hedge →")
log("  if the parlay HITS:  net " + $(hedge.ifParlayWins))
log("  if the parlay MISSES: net " + $(hedge.ifParlayLoses))
log("  => LOCKED profit either way: " + $(hedge.lockedProfit) + "   (" + hedge.note + ")")
log("")
log("Operator read: take the book's cash-out IF it's near the fair value (" + $(cv.fairCashout) + "); otherwise the hedge locks " + $(hedge.lockedProfit) + " regardless. SHADOW/calculator — feeds nothing live; will not appear on /m.")

const text = out.join("\n") + "\n"
try { fs.writeFileSync(SCRATCH, text, "utf8") } catch (_) {}
process.stdout.write(text)
