"use strict"
// verifyBookTruth — SEV-1 8a94621b (2026-08-15, explicit GO in the incident
// directive): finals-fallback side ENUM (yes-1-actual-0 pinned) · live-state
// side gate · canonical book-truth correction (delta reversal + provenance +
// event) · guards · alarm/route/FE/CLI anchors. Hermetic.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── (a) THE INCIDENT SHAPE: yes-1-actual-0 must never grade again ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-"))
const lp = path.join(tmp, "personal_ledger.json")
fs.writeFileSync(path.join(tmp, "mlb_tracked_bets_2026-08-13.json"), JSON.stringify([
  { player: "P C", statFamily: "hits", side: "under", line: 1.5, result: "win" },
]))
fs.writeFileSync(path.join(tmp, "mlb_finals_2026-08-13.json"), JSON.stringify({
  "alex b": { _batting: { runs: 0 } }, "p c": { _batting: { hits: 1 } },
}))
fs.writeFileSync(lp, JSON.stringify({ bets: [{ id: "pIncident", betType: "parlay", realMoney: true, result: "pending", date: "2026-08-13", stake: 5, odds: 200, toWin: 10, legs: [
  { player: "Alex B", statFamily: "runs", side: "yes", line: 1 },        // the 8a94621b leg shape
  { player: "P C", statFamily: "hits", side: "under", line: 1.5 },       // graded twin win
] }] }))
const env = { ...process.env, PS_TRACKING_DIR: tmp, PS_LEDGER: lp, PS_SKIP_PREFETCH: "1" }
spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
const after = JSON.parse(fs.readFileSync(lp, "utf8")).bets[0]
check("INCIDENT PINNED: side yes line 1 actual 0 ⇒ fallback REFUSES, ticket stays PENDING for manual (was: fabricated WIN $15)",
  after.result === "pending")

// over/under fallback still grades (the gate must not break real semantics)
fs.writeFileSync(lp, JSON.stringify({ bets: [{ id: "pOver", betType: "parlay", realMoney: true, result: "pending", date: "2026-08-13", stake: 1, odds: 100, toWin: 1, legs: [
  { player: "Alex B", statFamily: "runs", side: "over", line: 0.5 },     // twin-less, actual 0 ⇒ LOSS
  { player: "P C", statFamily: "hits", side: "under", line: 1.5 },
] }] }))
spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
const after2 = JSON.parse(fs.readFileSync(lp, "utf8")).bets[0]
check("regression: over 0.5 actual 0 still grades LOSS via fallback (gate touches ONLY unknown sides)",
  after2.result === "loss" && after2.payout === 0 && after2.legs[0].result === "loss")

// ── (c) canonical correction: delta reversal + provenance + event ──
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "btc-"))
const lp2 = path.join(tmp2, "ledger.json")
const evp = path.join(tmp2, "events.jsonl")
fs.writeFileSync(lp2, JSON.stringify({ meta: {}, bankroll: { initial: 100, current: 110 }, analytics: {}, bets: [
  { id: "bWrong", realMoney: true, decisionType: "placed", betType: "parlay", date: "2026-08-13", stake: 5, toWin: 10, odds: 200, result: "win", payout: 15, settledAt: "2026-08-14T09:35:00Z", legs: [
    { player: "Alex Bregman", statFamily: "runs", side: "yes", line: 1, result: "win" },
    { player: "Pete Crow-Armstrong", statFamily: "hits", side: "under", line: 1.5, result: "win" },
  ] },
  { id: "bPending", realMoney: true, result: "pending", stake: 1, legs: [] },
  { id: "bModel", result: "win", stake: 1, payout: 2 },
] }))
const cenv = { ...process.env, PERSONAL_LEDGER_PATH: lp2, BOOK_TRUTH_EVENTS_PATH: evp }
const probe = spawnSync(process.execPath, ["-e", `
const { correctSettledBetToBookTruth } = require(${JSON.stringify(path.join(ROOT, "pipeline", "shared", "buildPersonalLedger"))})
const r = correctSettledBetToBookTruth("bWrong", { result: "loss", payout: 0, slipId: "20PA06DZUD", note: "book settled LOST", legs: [
  { player: "Alex Bregman", result: "loss", legNote: "book truth: actual 0 vs yes 1 — LOST (slip 20PA06DZUD)" },
  { player: "Pete Crow-Armstrong", result: "win" },
] }, { save: false })
const g1 = correctSettledBetToBookTruth("bPending", { result: "loss", slipId: "x" }, { save: false })
const g2 = correctSettledBetToBookTruth("bWrong", { result: "loss" }, { save: false })
const g3 = correctSettledBetToBookTruth("bModel", { result: "loss", slipId: "x" }, { save: false })
console.log(JSON.stringify({ ok: r.ok, result: r.bet.result, payout: r.bet.payout, prevDelta: r.prevDelta, newBalance: r.newBalance,
  corr: r.bet.corrections[0], leg0: r.bet.legs[0].result, leg0note: r.bet.legs[0].legNote, leg1: r.bet.legs[1].result,
  g1: g1.reason, g2: g2.reason, g3: g3.reason }))
`], { env: cenv, encoding: "utf8", timeout: 30000 })
let P = null
try { P = JSON.parse(probe.stdout.trim().split("\n").pop()) } catch (_) {}
check("correction: win$15 → loss$0 with EXACT delta reversal (prevDelta +10 reversed, −5 applied: 110 → 95)",
  P && P.ok && P.result === "loss" && P.payout === 0 && P.prevDelta === 10 && P.newBalance === 95)
check("provenance appended, never deleted: corrections[0] carries prevResult/prevPayout/slipId/source",
  P && P.corr && P.corr.prevResult === "win" && P.corr.prevPayout === 15 && P.corr.slipId === "20PA06DZUD" && P.corr.source === "book_slip")
check("legs stamped accent-safe from the correction: Bregman loss w/ book-truth note, PCA win untouched",
  P && P.leg0 === "loss" && /actual 0 vs yes 1/.test(P.leg0note || "") && P.leg1 === "win")
check("guards: pending refused (normal settle path) · missing slipId refused · model row refused",
  P && /not_settled/.test(P.g1 || "") && /slip_id_required/.test(P.g2 || "") && /not_a_placed_bet/.test(P.g3 || ""))
const evLines = fs.existsSync(evp) ? fs.readFileSync(evp, "utf8").trim().split("\n").map((x) => JSON.parse(x)) : []
check("correction EVENT written (feeds the disagreement alarm): win→loss w/ slip id",
  evLines.length >= 1 && evLines[0].id === "bWrong" && evLines[0].prevResult === "win" && evLines[0].newResult === "loss" && evLines[0].slipId === "20PA06DZUD")

// ── source anchors ──
const sp = rd("scripts/settleParlaysFromRecord.js")
check("fallback source: side ENUM gate + refusal note + incident provenance in comment",
  /side semantics are an ENUM/.test(sp) && /finals-fallback REFUSED: side/.test(sp) && /20PA06DZUD/.test(sp) && sp.indexOf('String(leg.side).toLowerCase().startsWith("o")') === -1)
check("live-state source: same enum gate — display/lens never guesses an unknown side",
  /if \(!\(side === "over" \|\| side === "o" \|\| side === "under" \|\| side === "u"\)\) return \{ state: "open" \}/.test(rd("pipeline/shared/parlayLegLiveState.js")))
const bpl = rd("pipeline/shared/buildPersonalLedger.js")
check("correction lives in the canonical module w/ delta-reversal doctrine + event append",
  /correctSettledBetToBookTruth/.test(bpl) && /reverses the prior settle's bankroll delta EXACTLY/.test(bpl) && /BOOK_TRUTH_EVENTS/.test(bpl))
check("CLI: --book-correct mode documented as the replacement for --force on book corrections",
  /--book-correct/.test(rd("scripts/settlePlacedBet.js")) && /STACK bankroll deltas/.test(rd("scripts/settlePlacedBet.js")))
check("route: POST /ledger/book-correction is a thin door over the canonical path",
  /router\.post\("\/ledger\/book-correction"/.test(rd("routes/workstationRoutes.js")) && /fabricates nothing/.test(rd("routes/workstationRoutes.js")))
const fe = rd("../frontend/mobile/index.html")
check("FE: one-tap on settled cards + slip-required flow", /book says otherwise\? correct to slip truth/.test(fe) && /bookSaysOtherwise/.test(fe) && /book truth needs the slip/i.test(fe))
const chc = rd("scripts/componentHealthCheck.js")
check("alarm: corrections feed legDeathDisagreement w/ 3d loud window + history in the green line",
  /book_truth_corrections\.jsonl/.test(chc) && /CORR_LOUD_DAYS = 3/.test(chc) && /name the grader class that lied/.test(chc) && /book-truth correction\(s\) on file/.test(chc))
check("matrix: verifyBookTruth registered", /"verifyBookTruth"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyBookTruth: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
