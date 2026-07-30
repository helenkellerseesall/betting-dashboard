"use strict"
// verifyBetsPage2 — BETS-PAGE PACK 2 (2026-07-29, operator screenshot audit):
// honest header math (settled Profit + pending-only Potential, riskedReal-
// aware) · count-based history fold · leg-results backfill for settled
// parlays (manual path + nightly sweep) · live leg-death indicator
// (display-only) · componentHealthCheck sidecar-write-last audit fix.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── (1) header math — betRollup unit e2e on a tonight-shaped record ──
const { rollupPlaced, riskedOf } = require("../pipeline/shared/betRollup")
const R = rollupPlaced([
  { result: "loss", stake: 5, toWin: 32.8 },                                          // cash loss → −5
  { result: "win", stake: 1, toWin: 0.91, payout: 1.91 },                             // cash win → +0.91
  { result: "win", stake: 20, toWin: 44, payout: 44, stakeType: "bonus", riskedReal: 0 }, // bonus win → +44
  { result: "loss", stake: 10, stakeType: "bonus" },                                  // bonus loss → −0 real
  { result: "win", stake: 2, toWin: 2.32, payout: 4.33 },                             // book payout beats toWin → +2.33
  { result: "void", stake: 1, toWin: 0.53 },                                          // void → 0
  { result: "pending", stake: 1, toWin: 2.92 },                                       // the ONLY potential
])
check("profit: settled-only, riskedReal-aware, book-payout-preferred (+42.24 exact)", Math.abs(R.settledProfit - 42.24) < 0.001 && R.profit === R.settledProfit)
check("potential: pending-only (2.92) + legacy toWin REPOINTED to it (dead tickets excluded)", R.pendingToWin === 2.92 && R.toWin === 2.92 && R.pendingRisked === 1)
check("risk bases: riskedStaked excludes bonus (10 real vs 40 nominal) · settledRisked 9 (void counts — its dollar was at risk) · roi on real risk", R.riskedStaked === 10 && R.staked === 40 && R.settledRisked === 9 && Math.abs(R.roi - Math.round((42.24 / 9) * 10000) / 10000) < 1e-9)
check("riskedOf: explicit riskedReal wins · bonus defaults 0 · cash defaults stake", riskedOf({ stake: 7, riskedReal: 3 }) === 3 && riskedOf({ stake: 7, stakeType: "bonus" }) === 0 && riskedOf({ stake: 7 }) === 7)

// ── (4) live leg-death — pure verdict matrix + injected end-to-end ──
const { assessLeg, ticketVerdict, assessOpenParlayLegs } = require("../pipeline/shared/parlayLegLiveState")
check("irreversible mid-game: over reached WON · under breached LOST · under-safe stays OPEN",
  assessLeg({ side: "over", line: 1.5 }, 2, false).state === "won_unofficial" &&
  assessLeg({ side: "under", line: 1.5 }, 2, false).state === "lost_unofficial" &&
  assessLeg({ side: "under", line: 1.5 }, 1, false).state === "open")
check("all-final decides: under 1<1.5 WON · over 1<1.5 LOST · integer 2===2 PUSH",
  assessLeg({ side: "under", line: 1.5 }, 1, true).state === "won_unofficial" &&
  assessLeg({ side: "over", line: 1.5 }, 1, true).state === "lost_unofficial" &&
  assessLeg({ side: "over", line: 2 }, 2, true).state === "push_unofficial")
check("never guesses: absent stat OPEN · garbage line OPEN", assessLeg({ side: "under", line: 1.5 }, null, true).state === "open" && assessLeg({ side: "under", line: "x" }, 2, true).state === "open")
check("ticket: any lost ⇒ LOST · open blocks ⇒ null · all won ⇒ WON · won+push final ⇒ decided_mixed",
  ticketVerdict([{ state: "won_unofficial" }, { state: "lost_unofficial" }]) === "lost_unofficial" &&
  ticketVerdict([{ state: "won_unofficial" }, { state: "open" }]) === null &&
  ticketVerdict([{ state: "won_unofficial" }, { state: "won_unofficial" }]) === "won_unofficial" &&
  ticketVerdict([{ state: "won_unofficial" }, { state: "push_unofficial" }]) === "decided_mixed_unofficial")
;(async () => {
  const results = new Map([["a b", { _batting: { hits: 2 } }]])
  const inject = { "2026-07-28": { results, statuses: { allFinal: false } } }
  const out = await assessOpenParlayLegs([{ id: "p1", gameDate: "2026-07-28", legs: [{ player: "A B", statFamily: "hits", side: "under", line: 1.5 }, { player: "Missing Guy", statFamily: "hits", side: "over", line: 0.5 }] }], { inject })
  check("assessOpenParlayLegs (injected, no network): breached under LOST · absent player OPEN · ticket effectively decided + disclaimer",
    out.p1 && out.p1.legs[0].state === "lost_unofficial" && out.p1.legs[0].statNow === 2 && out.p1.legs[1].state === "open" && out.p1.ticket === "lost_unofficial" && /official grade at the nightly/.test(out.p1.disclaimer))
  const empty = await assessOpenParlayLegs(null)
  check("assessOpenParlayLegs never throws (null input ⇒ {})", empty && Object.keys(empty).length === 0)

  // ── (3) leg-results backfill e2e — settled ticket, pending legs, tmp dirs ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bp2-"))
  const lp = path.join(tmp, "personal_ledger.json")
  fs.writeFileSync(lp, JSON.stringify({ bets: [
    { id: "p27", betType: "parlay", realMoney: true, result: "win", payout: 4.33, settledAt: "2026-07-28T23:45:00Z", settleNote: "manual settle — book truth", date: "2026-07-27", stake: 2, odds: 116, legs: [{ player: "A B", statFamily: "hits", side: "under", line: 1.5 }, { player: "C D", statFamily: "hits", side: "under", line: 1.5 }] },
    { id: "pStray", betType: "parlay", realMoney: true, result: "loss", payout: 0, date: "2026-07-27", stake: 1, odds: 200, legs: [{ player: "A B", statFamily: "hits", side: "under", line: 1.5 }, { player: "Ungraded Guy", statFamily: "hits", side: "over", line: 0.5 }] },
  ] }))
  fs.writeFileSync(path.join(tmp, "mlb_tracked_bets_2026-07-27.json"), JSON.stringify([
    { player: "A B", statFamily: "hits", side: "under", line: 1.5, result: "win" },
    { player: "C D", statFamily: "hits", side: "under", line: 1.5, result: "win" },
  ]))
  const env = { ...process.env, PS_TRACKING_DIR: tmp, PS_LEDGER: lp }
  const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "settleParlaysFromRecord.js")], { env, encoding: "utf8", timeout: 60000 })
  const after = JSON.parse(fs.readFileSync(lp, "utf8")).bets
  check(`backfill e2e: WON-with-pending-legs ticket gets legs stamped win/win from graded twins (exit ${r1.status})`, r1.status === 0 && after[0].legs.every((l) => l.result === "win") && after[0].legs.every((l) => /backfilled from graded record/.test(l.legNote || "")))
  check("backfill e2e: ticket settle IMMUTABLE (result/payout/settledAt/settleNote byte-identical)", after[0].result === "win" && after[0].payout === 4.33 && after[0].settledAt === "2026-07-28T23:45:00Z" && after[0].settleNote === "manual settle — book truth")
  check("backfill e2e: ungraded twin stays pending — never guessed (graded sibling still stamps)", after[1].legs[0].result === "win" && (!after[1].legs[1].result || after[1].legs[1].result === "pending"))
  const { backfillLegResults } = require("./settleParlaysFromRecord")
  const oldEnv = { T: process.env.PS_TRACKING_DIR, L: process.env.PS_LEDGER }
  const r2 = spawnSync(process.execPath, ["-e", `const{backfillLegResults}=require(${JSON.stringify(path.join(ROOT, "scripts", "settleParlaysFromRecord.js"))});console.log(JSON.stringify(backfillLegResults({})))`], { env, encoding: "utf8", timeout: 30000 })
  let second = null; try { second = JSON.parse((r2.stdout || "").trim().split("\n").pop()) } catch (_) {}
  check("backfill e2e: idempotent — second run stamps nothing new on fully-stamped tickets", second && second.receipts.every((x) => x.id !== "p27"))
  void backfillLegResults; void oldEnv

  // ── source anchors ──
  const wr = rd("routes/workstationRoutes.js")
  check("route: rollup extracted to betRollup authority + old inline math gone", /require\("\.\.\/pipeline\/shared\/betRollup"\)/.test(wr) && !/ptoWin \+= w/.test(wr))
  // 2026-07-30 anchor updated w/ the incident pack: the legLive attach merged
  // into the effective-loss lens (single assess pass shared by lens + cards).
  check("route: legLive assessed once (lens+cards share the pass), async handler, fail-open display-only", /assessOpenParlayLegs/.test(wr) && /ledger\/yesterday", async/.test(wr) && /single pass — the lens and the card/.test(wr) && /fail-open — no adjustment/.test(wr))
  const sp = rd("scripts/settlePlacedBet.js")
  check("manual settle: parlay branch calls backfillLegResults immediately (can't-recur)", /backfillLegResults\(\{ onlyId: id \}\)/.test(sp) && /nightly sweep/.test(sp))
  const fe = rd("../frontend/mobile/index.html")
  check("FE: PROFIT(settled) + PENDING(open) header, bonus-credit note, no POTENTIAL-of-the-dead", /PROFIT <span/.test(fe) && /PENDING <span/.test(fe) && /bonus credits excluded/.test(fe) && /a potential that includes dead\s*\n?\s*\/\/ tickets is not a potential/i.test(fe.replace(/\r/g, "")))
  check("FE: fold by COUNT (FOLD_AT=15, newest-first), not age", /FOLD_AT = 15/.test(fe) && /_sorted\.slice\(0, FOLD_AT\)/.test(fe) && !/Date\.now\(\) - 7 \* 86400000/.test(fe))
  // 2026-07-29 VOID-HIDE (CA ASK) — display-layer only, one-truth count line.
  check("FE void-hide: voids filtered BEFORE the fold, annotation present, P re-derived so voids are described ONCE", /const visibleBets = bets\.filter\(\(b\) => !_isVoid\(b\)\)/.test(fe) && /\[\.\.\.visibleBets\]\.sort/.test(fe) && /void hidden \(stake returned, no P\/L\)/.test(fe) && /- voidCount; return tp > 0/.test(fe))
  check("FE void-hide is FE-ONLY: the placedAll lens chain is isPlaced + sport ONLY (no result filter — parity payload-keyed) + FE doc states it", /placedAll = \(ledger\.bets \|\| \[\]\)\s*\n\s*\.filter\(isPlaced\)\s*\n\s*\.filter\(\(b\) => !sport \|\| b\.sport === sport\)/.test(wr) && /parity watchers \(payload-keyed/.test(fe))
  check("FE: live leg chips + effectively-decided ticket + nightly disclaimer, server-asserted only", /LOST \(live\)/.test(fe) && /effectively decided \(losing live\)/.test(fe) && /official grade at the nightly/.test(fe) && /never synthesizes a\s*\n?\s*\/\/ live verdict/i.test(fe.replace(/\r/g, "")))
  const chc = rd("scripts/componentHealthCheck.js")
  const writeIdx = chc.indexOf("fs.writeFileSync(OUT")
  const lastCheckIdx = chc.indexOf("checkLineFreshness()")
  check("alarm surface: sidecar write LAST (after every check) + relocation doctrine documented", writeIdx > lastCheckIdx && lastCheckIdx > 0 && /sidecar write is LAST/.test(chc) && /silent instrument death/.test(chc))
  const rv = rd("scripts/runtimeVerify.js")
  check("matrix: verifyBetsPage2 registered", /"verifyBetsPage2"/.test(rv))

  console.log(`verifyBetsPage2: ${pass}/${pass + fail} checks PASS`)
  if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
  process.exit(0)
})()
