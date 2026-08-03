"use strict"

/**
 * betRollup.js — BETS-PAGE PACK 2 item 1 (2026-07-29, operator screenshot audit).
 *
 * THE header-math authority for the MY BETS surface. Extracted from the old
 * inline rollupPlaced in workstationRoutes so the math is unit-testable and
 * single-sourced (Law 1).
 *
 * WHAT WAS WRONG: the old rollup summed toWin across EVERY bet — settled
 * losses, voids, penny tests — and the FE rendered that as "POTENTIAL
 * +$151.89" over a record whose real open exposure was one $1 parlay. A
 * potential that includes dead tickets is not a potential.
 *
 * HONEST NUMBERS, riskedReal-aware (bonus-bet doctrine, RECORD-DECOUPLING):
 *   settledProfit — settled bets only. win: payout − risked when the book's
 *                   payout is recorded (book truth beats toWin arithmetic —
 *                   the 4.33-vs-4.32 cent), else toWin. loss: −risked
 *                   (a lost BONUS bet costs $0 real). push/void: 0.
 *   pendingToWin  — toWin summed over OPEN bets only. This is the only
 *                   number allowed to be called "potential".
 *   riskedStaked  — real dollars ever at risk (bonus stakes excluded).
 *   settledRisked — real dollars risked on settled bets (honest ROI base).
 *   roi           — settledProfit / settledRisked (riskedReal-aware; the old
 *                   profit/staked mixed bonus stakes into the base).
 *
 * Legacy field note: `toWin` is REPOINTED to pendingToWin. Older FE bundles
 * rendered pb.toWin as "POTENTIAL" — with this repoint the old label shows
 * the honest pending-only number instead of the all-rows sum. `staked` keeps
 * its historical meaning (sum of nominal stakes) for continuity; the FE now
 * labels real risk from riskedStaked.
 */

function riskedOf(b) {
  if (b && b.riskedReal != null && Number.isFinite(Number(b.riskedReal))) return Number(b.riskedReal)
  if (String((b && b.stakeType) || "").toLowerCase() === "bonus") return 0
  return Number(b && b.stake) || 0
}

/**
 * 2026-07-30 EFFECTIVE-LOSS LENS (incident ASK 7aae50f, operator directive):
 * opts.deadIds = ids of PENDING bets with an irreversibly-dead leg (graded-
 * twin loss or live over-breach — irreversible-only, computed by the route,
 * fail-open). A dead pending ticket stops counting as winnable: excluded
 * from pendingToWin, counted effectiveDead, and effectiveProfit shows the
 * header truth (settledProfit minus dead real risk). THE OFFICIAL RECORD IS
 * UNTOUCHED — the nightly still writes the only real grade; this is the lens
 * refusing to sell hope on a corpse. Default (no deadIds) = byte-identical
 * output to before.
 */
function rollupPlaced(bets, opts = {}) {
  const deadIds = opts.deadIds instanceof Set ? opts.deadIds : new Set(opts.deadIds || [])
  // 2026-08-02 VOID-WAIT (b) — effective-WIN mirror: pending tickets whose
  // every leg is a graded WIN or a void-candidate. Counted + labeled; their
  // toWin STAYS in pendingToWin (they remain winnable — the mirror informs,
  // it never books unearned profit). Official settle remains the only writer.
  const winIds = opts.winIds instanceof Set ? opts.winIds : new Set(opts.winIds || [])
  let pwins = 0, plosses = 0, ppushes = 0, ppending = 0
  let pstaked = 0, priskedStaked = 0, psettledRisked = 0
  let pprofit = 0, ppendingToWin = 0, ppendingRisked = 0
  let effectiveDead = 0, effectiveDeadRisked = 0, effectiveWin = 0
  for (const b of (Array.isArray(bets) ? bets : [])) {
    const s = Number(b.stake) || 0
    const risked = riskedOf(b)
    const w = Number(b.toWin) || 0
    pstaked += s
    priskedStaked += risked
    const hasRealPayout = b.payout != null && Number.isFinite(Number(b.payout))
    if (b.result === "win") { pwins++; psettledRisked += risked; pprofit += hasRealPayout ? Number(b.payout) - risked : w }
    else if (b.result === "loss") { plosses++; psettledRisked += risked; pprofit -= risked }
    else if (b.result === "push" || b.result === "void") { ppushes++; psettledRisked += risked }
    else if (deadIds.has(b.id)) { ppending++; effectiveDead++; effectiveDeadRisked += risked }
    else { ppending++; ppendingToWin += w; ppendingRisked += risked; if (winIds.has(b.id)) effectiveWin++ }
  }
  const settledP = pwins + plosses + ppushes
  const r2 = (n) => Math.round(n * 100) / 100
  const roiP = psettledRisked > 0 && settledP > 0 ? Math.round((pprofit / psettledRisked) * 10000) / 10000 : null
  const hitRateP = (pwins + plosses) > 0 ? Math.round((pwins / (pwins + plosses)) * 10000) / 10000 : null
  return {
    count: (Array.isArray(bets) ? bets.length : 0),
    wins: pwins, losses: plosses, pushes: ppushes, pending: ppending,
    settled: settledP,
    staked: r2(pstaked),                 // nominal stakes (legacy continuity)
    riskedStaked: r2(priskedStaked),     // real dollars ever at risk (bonus = 0)
    settledRisked: r2(psettledRisked),   // honest ROI base
    settledProfit: r2(pprofit),          // THE record number (riskedReal-aware, book-payout-preferred)
    pendingToWin: r2(ppendingToWin),     // THE only "potential" (open bets only)
    pendingRisked: r2(ppendingRisked),   // open real exposure
    toWin: r2(ppendingToWin),            // legacy alias — REPOINTED to pending-only (see doc header)
    profit: r2(pprofit),                 // legacy alias for settledProfit
    roi: roiP,
    hitRate: hitRateP,
    // EFFECTIVE-LOSS LENS (0 / == settledProfit when no deadIds passed)
    effectiveDeadCount: effectiveDead,
    effectiveDeadRisked: r2(effectiveDeadRisked),
    effectiveProfit: r2(pprofit - effectiveDeadRisked),
    effectiveWinCount: effectiveWin,   // VOID-WAIT mirror — informational only
  }
}

module.exports = { rollupPlaced, riskedOf }
