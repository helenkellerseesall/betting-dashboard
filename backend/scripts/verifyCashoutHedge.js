"use strict"
// verifyCashoutHedge — Phase Cashout-Hedge-1A (2026-06-15) regression fixture.
// Pure calculator (feeds nothing live). Proves: fair cash-out value, haircut band,
// equalizing-hedge stake = R/decimal with locked profit identical both outcomes,
// american+decimal odds, dead-ticket + all-won edge cases, FREEZE GUARD.
const fs = require("fs")
const path = require("path")
const ch = require("../pipeline/shared/cashoutHedge")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const approx = (a, b, t = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t

// cash-out value: $10 parlay, 1 won (dec 2.5) + 1 pending (dec 2.0, p 0.5) → R 50, fair 25
const cv = ch.cashoutValue({ stake: 10, legs: [{ decimal: 2.5, status: "won" }, { decimal: 2.0, status: "pending", prob: 0.5 }] })
check("potentialReturn = stake×fullDecimal = 50", approx(cv.potentialReturn, 50))
check("fairCashout = R×jointPending = 25", approx(cv.fairCashout, 25))
check("offer band = fair×[0.70,0.90]", approx(cv.offerBand.low, 17.5) && approx(cv.offerBand.high, 22.5))
check("jointPendingProb override respected", approx(ch.cashoutValue({ stake: 10, legs: [{ decimal: 5, status: "pending" }], jointPendingProb: 0.3 }).fairCashout, 15))

// hedge final leg: R 50, opposite decimal 2.0 → H = R/o = 25, locked +15 both ways
const h = ch.hedgeFinalLeg({ stake: 10, potentialReturn: 50, hedgeOdds: 2.0 })
check("hedgeStake = R/decimal = 25", approx(h.hedgeStake, 25))
check("lockedProfit = R − stake − H = 15", approx(h.lockedProfit, 15))
check("locked: parlay-win net == parlay-lose net", h.locked && approx(h.ifParlayWins, h.ifParlayLoses))
// american odds hedge path (+100 == decimal 2.0)
const ha = ch.hedgeFinalLeg({ stake: 10, potentialReturn: 50, hedgeOdds: 100 })
check("american +100 → decimal 2.0 → same H=25", approx(ha.hedgeStake, 25) && approx(ha.lockedProfit, 15))
// american -150 → decimal 1.6667
check("american -150 → decimal ~1.667", approx(ch.americanToDecimal(-150), 1 + 100 / 150))
// fullDecimal path (no potentialReturn supplied)
check("hedge accepts fullDecimal", approx(ch.hedgeFinalLeg({ stake: 10, fullDecimal: 5, hedgeOdds: 2.0 }).hedgeStake, 25))

// edge cases
check("lost leg → fair 0 + anyLost", (() => { const d = ch.cashoutValue({ stake: 10, legs: [{ decimal: 2, status: "lost" }, { decimal: 2, status: "pending", prob: 0.5 }] }); return d.fairCashout === 0 && d.anyLost === true })())
check("all won → fair = full potential return", approx(ch.cashoutValue({ stake: 10, legs: [{ decimal: 2, status: "won" }, { decimal: 3, status: "won" }] }).fairCashout, 60))
check("bad stake → error", !!ch.cashoutValue({ stake: 0, legs: [{ decimal: 2, status: "pending", prob: 0.5 }] }).error)
check("pending leg w/o prob and no override → error", !!ch.cashoutValue({ stake: 10, legs: [{ decimal: 2, status: "pending" }] }).error)
check("hedge bad odds → error", !!ch.hedgeFinalLeg({ stake: 10, potentialReturn: 50, hedgeOdds: 0.5 }).error)

// FREEZE GUARD — scoring references nothing in the calculator
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
check("buildMlbPropClusters references no cashoutHedge", rd("pipeline/mlb/buildMlbPropClusters.js").length > 0 && !/cashoutHedge/.test(rd("pipeline/mlb/buildMlbPropClusters.js")))
check("phase4Tracking references no cashoutHedge", rd("pipeline/mlb/phase4Tracking.js").length > 0 && !/cashoutHedge/.test(rd("pipeline/mlb/phase4Tracking.js")))

console.log(`verifyCashoutHedge: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
