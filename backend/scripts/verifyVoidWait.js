"use strict"
// verifyVoidWait — VOID-WAIT RECONCILIATION (2026-08-02, ASK 70cf06c;
// b62d25d6): void-aware staleness clock · effective-WIN mirror · bidirectional
// disagreement · per-leg price persistence. Hermetic.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── the ONE void-candidacy authority ──
const { classifyLegs } = require("./settleParlaysFromRecord")
const rows = [
  { player: "Drake Baldwin", statFamily: "hits", side: "under", line: 1.5, result: "win" },
  { player: "Jacob Wilson", statFamily: "hits", side: "under", line: 1.5, result: "win" },
]
const finals = { "drake baldwin": { _batting: { hits: 1 } }, "jacob wilson": { _batting: { hits: 0 } } } // Arraez ABSENT
const bet = { legs: [
  { player: "Drake Baldwin", statFamily: "hits", side: "under", line: 1.5 },
  { player: "Luis Arraez", statFamily: "hits", side: "under", line: 1.5 },
  { player: "Jacob Wilson", statFamily: "hits", side: "under", line: 1.5 },
] }
const cls = classifyLegs(bet, rows, finals)
check("classifyLegs (the b62d25d6 shape): graded WIN · void_candidate (absent from PRESENT finals) · graded WIN",
  cls[0].state === "graded" && cls[0].result === "win" && cls[1].state === "void_candidate" && cls[2].state === "graded")
check("finals ABSENT never guesses candidacy (unresolved, disqualifying)",
  classifyLegs(bet, rows, null)[1].state === "unresolved" && classifyLegs(bet, rows, {})[1].state === "unresolved")
check("accent-safe candidacy: 'Luis Arráez' still keys against ASCII finals rows",
  classifyLegs({ legs: [{ player: "Luis Arráez", statFamily: "hits", side: "under", line: 1.5 }] }, rows, finals)[0].state === "void_candidate")

// ── effective-win rollup mirror ──
const { rollupPlaced } = require("../pipeline/shared/betRollup")
const R = rollupPlaced([
  { id: "w", result: "win", stake: 1, toWin: 1, payout: 2 },
  { id: "pW", result: "pending", stake: 1, toWin: 2.9 },
  { id: "pD", result: "pending", stake: 1, toWin: 5 },
], { winIds: ["pW"], deadIds: ["pD"] })
check("rollup mirror: effectiveWinCount informational, toWin STAYS in pending (2.9 — never books unearned profit), dead still excluded",
  R.effectiveWinCount === 1 && R.pendingToWin === 2.9 && R.effectiveDeadCount === 1 && R.effectiveProfit === R.settledProfit - 1)
check("byte-compat: no opts ⇒ effectiveWinCount 0, legacy fields unchanged",
  rollupPlaced([{ id: "p", result: "pending", stake: 1, toWin: 2 }]).effectiveWinCount === 0)

// ── (c2) the f3d58e16 class: a LOST leg kills the ticket regardless of void legs — NO deferral ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vw-"))
const lp = path.join(tmp, "personal_ledger.json")
fs.writeFileSync(lp, JSON.stringify({ bets: [{ id: "pLossVoid", betType: "parlay", realMoney: true, result: "pending", date: "2026-07-28", stake: 2, odds: 250, legs: [
  { player: "A Duran", statFamily: "hits", side: "under", line: 1.5 },   // twin LOSS
  { player: "B Wong", statFamily: "hits", side: "under", line: 1.5, player2: null },  // no twin, absent from finals ⇒ void — irrelevant next to the loss
] }] }))
fs.writeFileSync(path.join(tmp, "mlb_tracked_bets_2026-07-28.json"), JSON.stringify([{ player: "A Duran", statFamily: "hits", side: "under", line: 1.5, result: "loss" }]))
fs.writeFileSync(path.join(tmp, "mlb_finals_2026-07-28.json"), JSON.stringify({ "a duran": { _batting: { hits: 2 } } }))
const env = { ...process.env, PS_TRACKING_DIR: tmp, PS_LEDGER: lp, PS_SKIP_PREFETCH: "1" }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
const after = JSON.parse(fs.readFileSync(lp, "utf8")).bets[0]
check(`f3d58e16 class pinned: void + LOSS ⇒ ticket LOSS $0, auto, NO deferral (prices irrelevant to a loss) (exit ${r1.status})`,
  r1.status === 0 && after.result === "loss" && after.payout === 0)

// ── source anchors ──
const chc = rd("scripts/componentHealthCheck.js")
check("alarm v3: void-aware waiting state (arms-date named) + RED only when the rule could act; ONE candidacy authority", /VOID-WAIT v3/.test(chc) && /void-confirming — window arms/.test(chc) && /classifyLegs/.test(chc) && /trains the operator to ignore red/.test(chc))
check("disagreement BIDIRECTIONAL: won_confirming vs official LOSS = contradiction", /won_confirming" && b\.result === "loss"/.test(chc))
const wr = rd("routes/workstationRoutes.js")
check("route: effective-win mirror via the shared authority, finals-absent disqualifies, event logged, ids exposed", /_winIds/.test(wr) && /won_confirming/.test(wr) && /DISQUALIFY, never guessed/.test(wr) && /effectiveWinIds/.test(wr))
check("route (d): parlay legsIn PERSISTS leg odds (the b62d25d6 gap — §10 recompute needs them)", /PER-LEG PRICE PERSISTENCE/.test(wr) && /oddsAmerican: Number\.isFinite\(Number\(l\?\.odds \?\? l\?\.oddsAmerican\)\)/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("FE: effectively-won styling + confirming-win header chip + srConfirm sends leg odds", /effectively won \(confirming void\)/.test(fe) && /confirming win/.test(fe) && /line: l\.line, odds: l\.odds \}\)\)/.test(fe))
check("matrix: verifyVoidWait registered", /"verifyVoidWait"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyVoidWait: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
