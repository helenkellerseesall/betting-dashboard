"use strict"
// verifyIncidentPack — INCIDENT + ACCOUNTING (2026-07-30, ASK 7aae50f):
// diacritic root fix · parlay finals-fallback (twin-less legs) · honest
// staleness bar · effective-loss lens + disagreement alarm · PREVIEW rider.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── (A) ROOT: the diacritic join, healed at the source ──
const { normName, getStatValue } = require("../pipeline/grading/fetchMlbGameResults")
check("ROOT: normName NFD-strips — 'Yandy Díaz' now joins 'Yandy Diaz' (the 289-row class cure)",
  normName("Yandy Díaz") === "yandy diaz" && normName("Yandy Díaz") === normName("Yandy Diaz") &&
  normName("José Ramírez") === normName("Jose Ramirez") && normName("Mauricio Dubón") === normName("Mauricio Dubon"))

// ── (B) finals-fallback e2e (hermetic: tmp dirs + stubbed finals cache) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ip-"))
const lp = path.join(tmp, "personal_ledger.json")
const wrLedger = (bets) => fs.writeFileSync(lp, JSON.stringify({ bets }))
// slate graded (twin rows carry win/loss) but the u0.5 line has NO twin — the
// Clement class. Finals cache says the player had 1 hit ⇒ u0.5 = LOSS ⇒ ticket LOSS.
fs.writeFileSync(path.join(tmp, "mlb_tracked_bets_2026-07-28.json"), JSON.stringify([
  { player: "E C", statFamily: "hits", side: "under", line: 1.5, result: "win" },
  { player: "L A", statFamily: "hits", side: "under", line: 1.5, result: "win" },
]))
fs.writeFileSync(path.join(tmp, "mlb_finals_2026-07-28.json"), JSON.stringify({
  "e c": { _batting: { hits: 1 } }, "l a": { _batting: { hits: 1 } },
}))
wrLedger([{ id: "pClem", betType: "parlay", realMoney: true, result: "pending", date: "2026-07-28", stake: 1, odds: 292, legs: [
  { player: "E C", statFamily: "hits", side: "under", line: 0.5 },   // twin-less — finals decide
  { player: "L A", statFamily: "hits", side: "under", line: 1.5 },   // graded twin win
] }])
const env = { ...process.env, PS_TRACKING_DIR: tmp, PS_LEDGER: lp, PS_SKIP_PREFETCH: "1" }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
const after1 = JSON.parse(fs.readFileSync(lp, "utf8")).bets[0]
check(`finals-fallback: twin-less u0.5 leg grades LOSS from finals (actual 1) ⇒ ticket LOSS payout 0 (exit ${r1.status})`,
  r1.status === 0 && after1.result === "loss" && after1.payout === 0 && after1.legs[0].result === "loss" && /graded from official finals/.test(after1.legs[0].legNote || "") && after1.legs[1].result === "win")
// no finals cache ⇒ pending (never guessed); finals-present-but-player-absent + young slate ⇒ pending
wrLedger([{ id: "pNoCache", betType: "parlay", realMoney: true, result: "pending", date: "2026-07-27", stake: 1, odds: 100, legs: [{ player: "Ghost Guy", statFamily: "hits", side: "under", line: 0.5 }] }])
fs.writeFileSync(path.join(tmp, "mlb_tracked_bets_2026-07-27.json"), JSON.stringify([{ player: "X Y", statFamily: "hits", side: "over", line: 0.5, result: "win" }]))
spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
check("never-guess: no finals cache for the slate ⇒ stays pending", JSON.parse(fs.readFileSync(lp, "utf8")).bets[0].result === "pending")
// absent from finals at slate ≥2 days ⇒ leg VOID ⇒ all-void ticket ⇒ stake returned
fs.writeFileSync(path.join(tmp, "mlb_finals_2026-07-27.json"), JSON.stringify({ "x y": { _batting: { hits: 1 } } }))
const r3 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
const after3 = JSON.parse(fs.readFileSync(lp, "utf8")).bets[0]
check(`scratch mirror: absent-from-finals at slate ≥2 days ⇒ leg void ⇒ ticket VOID, stake returned (exit ${r3.status})`,
  r3.status === 0 && after3.result === "void" && after3.payout === 1 && /no appearance in official finals/.test(after3.legs[0].legNote || ""))

// ── (D) effective-loss lens: rollup math exact + byte-compat default ──
const { rollupPlaced } = require("../pipeline/shared/betRollup")
const BETS = [
  { id: "w1", result: "win", stake: 1, toWin: 0.91, payout: 1.91 },
  { id: "pDead", result: "pending", stake: 1, toWin: 2.92 },
  { id: "pLive", result: "pending", stake: 5, toWin: 20.75 },
]
const plain = rollupPlaced(BETS)
const lens = rollupPlaced(BETS, { deadIds: ["pDead"] })
check("lens: dead pending excluded from pendingToWin (20.75 not 23.67), counted effectiveDead, effectiveProfit = settled − dead risk (0.91−1 = −0.09)",
  lens.pendingToWin === 20.75 && lens.effectiveDeadCount === 1 && Math.abs(lens.effectiveProfit - (-0.09)) < 0.001 && lens.pending === 2)
check("lens: byte-compat default — no deadIds ⇒ identical legacy fields + effective fields collapse to settled",
  plain.pendingToWin === 23.67 && plain.effectiveDeadCount === 0 && plain.effectiveProfit === plain.settledProfit)

// ── source anchors ──
const fgr = rd("pipeline/grading/fetchMlbGameResults.js")
check("root fix documented at the source (289-row class, FirstHr parity)", /NFD diacritic strip/.test(fgr) && /289 pending rows/.test(fgr) && /normalize\("NFD"\)/.test(fgr))
const sp = rd("scripts/settleParlaysFromRecord.js")
check("fallback: sync settleParlays + async CLI prefetch (rider contract untouched) + provenance notes", /prefetchFinals/.test(sp) && /rider calls it synchronously|rider's contract/.test(sp) && /graded from official finals/.test(sp) && /scratch-rule mirror/.test(sp) && /norm = \(s\) => String\(s \|\| ""\)\.normalize\("NFD"\)/.test(sp))
const chc = rd("scripts/componentHealthCheck.js")
// 2026-08-02 anchor updated w/ VOID-WAIT v3: the bar is now void-aware — a
// waiting void-candidate ticket is NOT stale until its 2-day window arms
// (verifyVoidWait owns the v3 behavior tests; this anchor pins presence).
check("staleness bar: v3 void-aware (waiting state until the window arms; RED only when the rule could act) + bar-rewrite provenance kept", /BAR REWRITE/.test(chc) && /VOID-WAIT v3/.test(chc) && /No grace for the unsettleable/.test(chc))
check("disagreement alarm registered: dead-call vs WIN-settle contradiction = RED, human look required", /checkLegDeathDisagreement/.test(chc) && /"legDeathDisagreement"/.test(chc) && /HUMAN LOOK REQUIRED/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkLegDeathDisagreement()"))
const wr = rd("routes/workstationRoutes.js")
check("route: lens computed pre-rollup, irreversible-only bases, deduped jsonl events, fail-open, single legLive pass", /EFFECTIVE-LOSS LENS/.test(wr) && /live_irreversible_breach/.test(wr) && /graded_twin_loss/.test(wr) && /parlay_leg_death_events\.jsonl/.test(wr) && /fail-open — no adjustment/.test(wr) && /deadIds: _deadIds/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("FE: effective line renders only with dead pending + official-grade disclaimer", /EFFECTIVE \(counting/.test(fe) && /refuses to sell hope on a dead ticket/.test(fe))
check("FE: TOMORROW board wears the loud PREVIEW banner (not bet-ready, locked-card pointer)", /PREVIEW — early candidates, NOT the locked record and NOT bet-ready/.test(fe) && /bet the locked card, not this list/.test(fe))
const rv = rd("scripts/runtimeVerify.js")
check("matrix: verifyIncidentPack registered", /"verifyIncidentPack"/.test(rv))
void getStatValue

console.log(`verifyIncidentPack: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
