"use strict"
// verifyLongshotLab — LONGSHOT LAB (2026-08-17, standing queue; CC design §3):
// N=3 structure, certified-zone-only legs (map support), cross-game + trap
// constraints, write-once locks + chained receipts, twin/rung-ledger settles
// (never guessed), band gate w/ Poisson LB + printed bar + drought benchmark.
// Hermetic via LAB_* envs.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const { currentSlateDateEt, slateDateForTimestamp } = require("../pipeline/shared/slateDate")
const slate = currentSlateDateEt()
const ySlate = slateDateForTimestamp(Date.now() - 86400000)
const T = fs.mkdtempSync(path.join(os.tmpdir(), "labT-"))
const C = fs.mkdtempSync(path.join(os.tmpdir(), "labC-"))
const R = fs.mkdtempSync(path.join(os.tmpdir(), "labR-"))
fs.writeFileSync(path.join(C, "g2_validation.json"), JSON.stringify({ verdicts: { hits: { verdict: "PASS" }, runs: { verdict: "PASS" }, doubles: { verdict: "STOP" } } }))
const gt = new Date(Date.now() + 3 * 3600000).toISOString()
const row = (p, fam, ev, odds, tier) => ({ player: p, statFamily: fam, side: "over", line: 0.5, oddsAmerican: odds, sportsbook: "draftkings", eventId: ev, gameTime: gt, modelProb: 0.5, tier, marketKey: "batter_" + fam })
fs.writeFileSync(path.join(T, `mlb_tracked_bets_${slate}.json`), JSON.stringify([
  row("A One", "hits", "e1", 150, "STRONG"), row("B Two", "runs", "e2", 150, "PLAYABLE"),
  row("C Three", "hits", "e3", 150, "STRONG"), row("D Four", "runs", "e4", 150, "PLAYABLE"),
  row("E Doubles", "doubles", "e5", 150, "STRONG"),       // STOP family — must never appear
  row("F Long", "hits", "e6", 900, "LONGSHOT"),           // uncertified tier — must never appear
  row("F Lag", "hits", "e7", -120, "PLAYABLE"),           // gameTime donor for the flag
]))
fs.writeFileSync(path.join(T, "rung_flag_ledger.jsonl"), [
  JSON.stringify({ type: "flag", id: "fxNew", gameDate: slate, player: "F Lag", family: "hits", line: 7.5, k: 8, book: "draftkings", oddsAmerican: 2500, pFair: 0.02 }),
  JSON.stringify({ type: "flag", id: "fxOld", gameDate: ySlate, player: "F Lag", family: "hits", line: 6.5, k: 7, book: "draftkings", oddsAmerican: 3000, pFair: 0.03 }),
  JSON.stringify({ type: "settle", id: "fxOld", result: "loss" }),
].join("\n") + "\n")
// yesterday's locked artifact: a workhorse w/ winning twins + the fxOld experimental
fs.writeFileSync(path.join(T, `mlb_tracked_bets_${ySlate}.json`), JSON.stringify([
  { player: "W One", statFamily: "hits", side: "over", line: 0.5, result: "win" },
  { player: "W Two", statFamily: "runs", side: "over", line: 0.5, result: "win" },
]))
fs.writeFileSync(path.join(T, `lab_tickets_${ySlate}.json`), JSON.stringify({ slate: ySlate, lockedAt: "x", tickets: [
  { kind: "workhorse", stake: 1, decimal: 6.25, oddsAmerican: 525, pTicket: 0.25, result: "pending", legs: [
    { player: "W One", statFamily: "hits", side: "over", line: 0.5 }, { player: "W Two", statFamily: "runs", side: "over", line: 0.5 }] },
  { kind: "experimental", stake: 1, decimal: 31, oddsAmerican: 3000, pTicket: 0.03, result: "pending", legs: [{ player: "F Lag", statFamily: "hits", flagId: "fxOld" }] },
] }))
const env = { ...process.env, LAB_TRACKING_DIR: T, LAB_CONFIG_DIR: C, LAB_RECEIPTS_DIR: R, LAB_SKIP_MARKET: "1", MARKET_PRIOR_W_PATH: path.join(C, "nope.json") }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "longshotLab.js")], { env, encoding: "utf8", timeout: 30000 })
const art = JSON.parse(fs.readFileSync(path.join(T, `lab_tickets_${slate}.json`), "utf8"))
const wk = art.tickets.filter((t) => t.kind === "workhorse")
const ex = art.tickets.find((t) => t.kind === "experimental")
check(`build (exit ${r1.status}): 2 workhorse + 1 experimental locked, paper-only + bar stamped on the artifact`,
  r1.status === 0 && wk.length === 2 && !!ex && art.paperOnly === true && /OPERATOR, never automatic/.test(art.bar))
check("workhorse band: 2-3 legs, cross-game (distinct eventIds), ticket odds in +500..+2000",
  wk.every((t) => t.legs.length >= 2 && t.legs.length <= 3 && new Set(t.legs.map((l) => l.eventId)).size === t.legs.length && t.oddsAmerican >= 500 && t.oddsAmerican <= 2000))
check("certified-zone STRUCTURAL: no STOP-family leg, no LONGSHOT-tier leg anywhere (the 1e-05 class cannot be emitted)",
  art.tickets.every((t) => t.legs.every((l) => l.statFamily !== "doubles" && l.player !== "F Long")))
check("experimental: single certified rung +2000..+10000 w/ flagId (settles via the ONE rung authority) + pFair pricing",
  ex.legs.length === 1 && ex.legs[0].flagId === "fxNew" && ex.oddsAmerican === 2500 && ex.pTicket === 0.02)
check("pricing provenance on every leg: pFinal + priced label (model_only under LAB_SKIP_MARKET) + w source stamped",
  art.tickets.every((t) => t.legs.every((l) => Number.isFinite(l.pFinal) && l.priced && l.wSource)))
check("pTicket = product of leg pFinal (workhorse)", Math.abs(wk[0].pTicket - wk[0].legs.reduce((a, l) => a * l.pFinal, 1)) < 1e-6)
const receipt = fs.readFileSync(path.join(R, `lab_receipt_${slate}.md`), "utf8")
check("lock receipt written + chained (genesis on first) + losses-forward doctrine text", /prev: genesis/.test(receipt) && /paper-only/.test(receipt))
// settle pass ran in the same invocation: yesterday's tickets settle from twins + rung ledger
const yArt = JSON.parse(fs.readFileSync(path.join(T, `lab_tickets_${ySlate}.json`), "utf8"))
check("settle: workhorse WIN from graded twins (payout = stake×decimal) · experimental LOSS from the rung settle entry — never guessed",
  yArt.tickets[0].result === "win" && yArt.tickets[0].payout === 6.25 && yArt.tickets[1].result === "loss" && yArt.tickets[1].payout === 0)
const ledger = fs.readFileSync(path.join(T, "lab_ledger.jsonl"), "utf8").trim().split("\n").map((x) => JSON.parse(x))
check("lab ledger: settle events w/ units (+5.25 workhorse, −1 experimental)", ledger.some((e) => e.units === 5.25) && ledger.some((e) => e.units === -1))
const gate = JSON.parse(fs.readFileSync(path.join(T, "lab_gate.json"), "utf8")).gate
check("gate readout: per-band decided/wins/expectedWins/PoissonLB/units + printed bar + drought benchmark beside the record",
  gate.workhorse.decided === 1 && gate.workhorse.wins === 1 && gate.workhorse.flatUnits === 5.25 && gate.experimental.flatUnits === -1 && /≥90 nights AND ≥250 decided/.test(gate.workhorse.bar) && /100-straight run at \+2000 is the EXPECTED worst stretch/.test(gate.workhorse.drought.note))
check("bar honesty: 1 night of data reads NOT MET", gate.workhorse.barMet === "NOT MET" && gate.experimental.barMet === "NOT MET")
// write-once
const r2 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "longshotLab.js")], { env, encoding: "utf8", timeout: 30000 })
check("write-once: second pass refuses to rebuild (already LOCKED)", /already LOCKED \(write-once\)/.test(r2.stdout))
// trap assert
const { oppositionTrapAssert } = require("./longshotLab")
let threw = false
try { oppositionTrapAssert([{ eventId: "e1", statFamily: "hits" }, { eventId: "e1", statFamily: "ks" }]) } catch (_) { threw = true }
check("opposition-trap/same-game HARD assert throws", threw)
// source anchors
check("route: GET /lab losses-forward + paper flag", /router\.get\("\/lab"/.test(rd("routes/workstationRoutes.js")) && /losses-forward/.test(rd("routes/workstationRoutes.js")))
check("FE: Lab section + drought line + operator-flip doctrine", /LONGSHOT LAB — 3 paper tickets nightly \(NOT BETTABLE\)/.test(rd("../frontend/mobile/index.html")) && /expected worst drought/.test(rd("../frontend/mobile/index.html")) && /flip is the OPERATOR/.test(rd("../frontend/mobile/index.html")))
check("scheduler: 17:40 nightly block w/ dedupe", /last_lab_min/.test(rd("scripts/scheduler.sh")) && /longshotLab\.js/.test(rd("scripts/scheduler.sh")))
const chc = rd("scripts/componentHealthCheck.js")
check("alarm #28 longshotLab: gate-freshness heartbeat + stuck-settle red, registered before the write", /checkLongshotLab/.test(chc) && /"longshotLab"/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkLongshotLab()"))
check("matrix: verifyLongshotLab registered", /"verifyLongshotLab"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyLongshotLab: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
