"use strict"

/**
 * cashoutHedge.js — Phase Cashout-Hedge-1A (2026-06-15)
 *
 * Pure, sport-agnostic parlay cash-out + hedge math. The operator's #1 explicit
 * want ("take a 3+ leg parlay and take an early cash out"). It is a CALCULATOR
 * the operator invokes — it feeds NOTHING automatically, touches no scoring, no
 * PRESERVED file. Freeze-safe. No IO, no state, no Math.random, no scipy.
 *
 * Definitions:
 *   - A parlay pays stake × fullDecimal IFF every leg wins. Already-won legs are
 *     banked; only the PENDING legs are still at risk.
 *   - Fair cash-out value of the open ticket = potentialReturn × P(all pending win).
 *     (Supply each pending leg's prob, or an explicit jointProb override; same-game
 *     legs should use the correlation engine's joint, not a naive product.)
 *   - Books pay a HAIRCUT on fair (~70–90%). We report a band, not a fake exact.
 *   - Equalizing hedge (classic "hedge the last leg"): bet the opposite side so the
 *     net profit is identical whether the parlay wins or loses. With decimal odds:
 *       hedgeStake H = potentialReturn / hedgeDecimal
 *       lockedProfit = potentialReturn − parlayStake − H   (identical in both cases)
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

function americanToDecimal(odds) {
  const n = num(odds)
  if (n == null || n === 0) return null
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
}

// Resolve a leg's decimal odds from {decimal} or {oddsAmerican}.
function legDecimal(leg) {
  if (leg == null) return null
  if (num(leg.decimal) != null) return num(leg.decimal)
  return americanToDecimal(leg.oddsAmerican)
}

/**
 * cashoutValue({ stake, legs, jointPendingProb? }) → analysis | { error }
 * leg = { decimal|oddsAmerican, status: "won"|"pending"|"lost", prob? }
 *   prob = the leg's TRUE win prob (calibrated / operator estimate); only used for pending legs.
 */
function cashoutValue({ stake, legs, jointPendingProb, haircutLow = 0.70, haircutHigh = 0.90 } = {}) {
  const s = num(stake)
  if (s == null || s <= 0) return { error: "stake must be > 0" }
  if (!Array.isArray(legs) || legs.length === 0) return { error: "legs[] required" }

  let fullDecimal = 1
  const pending = []
  let anyLost = false
  for (const leg of legs) {
    const d = legDecimal(leg)
    if (d == null) return { error: `leg missing valid odds: ${JSON.stringify(leg)}` }
    fullDecimal *= d
    const st = String(leg.status || "pending").toLowerCase()
    if (st === "lost") anyLost = true
    else if (st !== "won") pending.push(leg)
  }
  const potentialReturn = s * fullDecimal

  // A lost leg kills the ticket — fair value is 0.
  if (anyLost) {
    return { stake: s, fullDecimal, potentialReturn, pendingCount: pending.length, anyLost: true,
      jointPending: 0, fairCashout: 0, offerBand: { low: 0, mid: 0, high: 0 },
      note: "a leg has LOST — ticket is dead; fair cash-out = 0" }
  }

  // joint prob the remaining pending legs ALL win.
  let jointPending
  if (num(jointPendingProb) != null) jointPending = num(jointPendingProb)
  else {
    jointPending = 1
    for (const leg of pending) {
      const p = num(leg.prob)
      if (p == null) return { error: "each pending leg needs prob, or pass jointPendingProb" }
      jointPending *= Math.max(0, Math.min(1, p))
    }
  }
  if (pending.length === 0) jointPending = 1 // all legs already won → ticket is fully live

  const fairCashout = potentialReturn * jointPending
  return {
    stake: s, fullDecimal, potentialReturn,
    pendingCount: pending.length, anyLost: false,
    jointPending,
    fairCashout,
    offerBand: { low: fairCashout * haircutLow, mid: fairCashout * ((haircutLow + haircutHigh) / 2), high: fairCashout * haircutHigh },
    note: pending.length === 0 ? "all legs won — fair value = full potential return" : `${pending.length} leg(s) pending`,
  }
}

/**
 * hedgeFinalLeg({ stake, potentialReturn?, fullDecimal?, hedgeOdds }) → hedge | { error }
 * Equalizing hedge on the OPPOSITE side of the single remaining leg. Supply the
 * parlay's potentialReturn (or stake+fullDecimal) and the hedge side's odds.
 */
function hedgeFinalLeg({ stake, potentialReturn, fullDecimal, hedgeOdds } = {}) {
  const s = num(stake)
  let R = num(potentialReturn)
  if (R == null && s != null && num(fullDecimal) != null) R = s * num(fullDecimal)
  if (s == null || s <= 0) return { error: "stake must be > 0" }
  if (R == null || R <= 0) return { error: "potentialReturn (or fullDecimal) required" }
  // Resolve hedge odds: american if negative or |n|>=100; else decimal (1 < n < 100).
  const n = num(hedgeOdds)
  if (n == null) return { error: "hedgeOdds required (american e.g. +120/-150, or decimal e.g. 2.2)" }
  const hedgeDecimal = (n < 0 || Math.abs(n) >= 100) ? americanToDecimal(n) : (n > 1 ? n : null)
  if (hedgeDecimal == null || hedgeDecimal <= 1) return { error: "hedgeOdds must be american (+120/-150) or decimal (>1)" }

  const hedgeStake = R / hedgeDecimal
  const lockedProfit = R - s - hedgeStake
  // both outcomes net the same (that's the point) — report both as proof
  const ifParlayWins = R - s - hedgeStake
  const ifParlayLoses = hedgeStake * hedgeDecimal - s - hedgeStake
  return {
    hedgeDecimal, hedgeStake,
    lockedProfit,
    ifParlayWins, ifParlayLoses,
    locked: Math.abs(ifParlayWins - ifParlayLoses) < 1e-9,
    note: lockedProfit > 0
      ? "hedging the final leg LOCKS this profit either way"
      : "hedging locks a guaranteed LOSS here — only hedge to cap downside, not for profit",
  }
}

module.exports = { americanToDecimal, legDecimal, cashoutValue, hedgeFinalLeg }

// Inline self-test: `node backend/pipeline/shared/cashoutHedge.js`
if (require.main === module) {
  const approx = (a, b, t = 1e-9) => Math.abs(a - b) <= t
  const T = []; const c = (l, x) => T.push([l, x])
  // $10 parlay, full decimal 5.0 (R=$50), one leg pending at p=0.5
  const cv = cashoutValue({ stake: 10, legs: [{ decimal: 2.5, status: "won" }, { decimal: 2.0, status: "pending", prob: 0.5 }] })
  c("potentialReturn=50", approx(cv.potentialReturn, 50))
  c("jointPending=0.5", approx(cv.jointPending, 0.5))
  c("fairCashout=25", approx(cv.fairCashout, 25))
  c("offer band 70-90% (17.5..22.5)", approx(cv.offerBand.low, 17.5) && approx(cv.offerBand.high, 22.5))
  // hedge final leg: R=50, opposite side decimal 2.0 → H=25, locked +15 both ways
  const h = hedgeFinalLeg({ stake: 10, potentialReturn: 50, hedgeOdds: 2.0 })
  c("hedgeStake=R/o=25", approx(h.hedgeStake, 25))
  c("lockedProfit=15", approx(h.lockedProfit, 15))
  c("locked: win==lose net", h.locked && approx(h.ifParlayWins, h.ifParlayLoses) && approx(h.ifParlayWins, 15))
  // dead ticket
  const dead = cashoutValue({ stake: 10, legs: [{ decimal: 2, status: "lost" }, { decimal: 2, status: "pending", prob: 0.5 }] })
  c("lost leg → fair 0", dead.fairCashout === 0 && dead.anyLost === true)
  // all won → full value
  const allWon = cashoutValue({ stake: 10, legs: [{ decimal: 2, status: "won" }, { decimal: 3, status: "won" }] })
  c("all won → fair = potentialReturn 60", approx(allWon.fairCashout, 60))
  // american odds path
  c("americanToDecimal +150=2.5", approx(americanToDecimal(150), 2.5))
  let ok = 0; for (const [l, x] of T) { console.log((x ? "PASS" : "FAIL") + " — " + l); if (x) ok++ }
  console.log(`cashoutHedge self-test: ${ok}/${T.length}`)
  process.exit(ok === T.length ? 0 : 1)
}
