"use strict"
// verifyDaily3Rails — DAILY-3 SALEABILITY RAILS (2026-07-29, ASK fc1c189):
// hash-chained lock receipts (R1) + losses-forward public payload/page (R2) +
// lock-time whys / critic-notes feed (R3). Hermetic: env-dir overrides, zero
// network, zero writes outside temp dirs.
const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const sha = (fp) => crypto.createHash("sha256").update(fs.readFileSync(fp)).digest("hex")

// hermetic dirs BEFORE requiring the module (dirs are bound at require time)
const tTrack = fs.mkdtempSync(path.join(os.tmpdir(), "d3t-"))
const tRec = fs.mkdtempSync(path.join(os.tmpdir(), "d3r-"))
process.env.DAILY3_TRACKING_DIR = tTrack
process.env.DAILY3_RECEIPTS_DIR = tRec
const d3 = require("../pipeline/shared/daily3")

// ── R3: lock-time why line ──
check("whyLine: composes real reasoning parts, caps length, honest null on empty",
  /L5 avg 1.4/.test(d3.whyLineFromReasoning({ l5: { label: "L5 avg", value: 1.4 }, drivers: ["hot week"] })) &&
  /hot week/.test(d3.whyLineFromReasoning({ l5: { label: "L5 avg", value: 1.4 }, drivers: ["hot week"] })) &&
  d3.whyLineFromReasoning({}) === null && d3.whyLineFromReasoning(null) === null)

// ── R1: receipt writer + chain ──
const mkCard = (slate, over = {}) => {
  const card = { slate, lockedAt: `${slate}T22:10:00.000Z`, firstPitchAt: `${slate}T23:10:00.000Z`, lockLate: false, picks: [
    { player: "A B", statFamily: "hits", side: "under", line: 1.5, sportsbook: "BetMGM", odds: -165, why: "L5 avg 0.8 · cold" },
    { player: "C D", statFamily: "rbis", side: "over", line: 0.5, sportsbook: "FanDuel", odds: 120, why: null },
    { player: "E F", statFamily: "hits", side: "over", line: 0.5, sportsbook: "DraftKings", odds: -200, why: "L5 avg 1.6" },
  ], results: null, ...over }
  fs.writeFileSync(path.join(tTrack, `daily3_${slate}.json`), JSON.stringify(card, null, 2))
  return card
}
const c1 = mkCard("2026-07-29")
const r1 = d3.writeLockReceipt(c1)
check("receipt 1: written, GENESIS parent, cardSha = sha256 of the card file's exact bytes",
  r1.written === true && r1.prevSha === "GENESIS" && r1.cardSha === sha(path.join(tTrack, "daily3_2026-07-29.json")) && fs.existsSync(r1.path))
const rtxt = fs.readFileSync(r1.path, "utf8")
check("receipt 1: human-postable — picks verbatim, T-60 math, post block, no-backfill doctrine",
  /A B UNDER 1\.5 hits @ BetMGM -165/.test(rtxt) && /60 min before first pitch/.test(rtxt) && /## Post this \(one tap\)/.test(rtxt) && /never backfilled/.test(rtxt))
const c2 = mkCard("2026-07-30")
const r2 = d3.writeLockReceipt(c2)
check("receipt 2: chains to receipt 1's file bytes", r2.prevSha === sha(r1.path))
check("receipt write-once: second call skips, file byte-identical", d3.writeLockReceipt(c1).skipped === "exists" && sha(r1.path) === sha(r1.path))
check("chain validates intact (2 links)", (() => { const v = d3.validateReceiptChain(tRec); return v.ok && v.checked === 2 })())
fs.appendFileSync(r1.path, "\ntampered")
const vBroken = d3.validateReceiptChain(tRec)
check("tamper detection: one appended byte on receipt 1 breaks receipt 2's link", vBroken.ok === false && vBroken.breaks.length === 1 && vBroken.breaks[0].slate === "2026-07-30")
fs.writeFileSync(r1.path, rtxt) // restore for payload tests
check("chain heals when bytes restored (content-addressed, not mtime)", d3.validateReceiptChain(tRec).ok === true)

// ── R2: losses-forward public payload ──
// graded LOSS night (newer) + graded WIN night + pre-receipt-era graded card
mkCard("2026-07-30", { results: [
  { player: "A B", statFamily: "hits", side: "under", line: 1.5, sportsbook: "BetMGM", odds: -165, result: "loss", units: -1 },
  { player: "C D", statFamily: "rbis", side: "over", line: 0.5, sportsbook: "FanDuel", odds: 120, result: "win", units: 1.2 },
  { player: "E F", statFamily: "hits", side: "over", line: 0.5, sportsbook: "DraftKings", odds: -200, result: "void", units: 0, settleNote: "no appearance — voided per book behavior" },
], netUnits: 0.2, gradedAt: "2026-07-31T09:00:00Z" })
mkCard("2026-07-20", { results: [
  { player: "A B", statFamily: "hits", side: "under", line: 1.5, sportsbook: "BetMGM", odds: -165, result: "win", units: 0.61 },
  { player: "C D", statFamily: "rbis", side: "over", line: 0.5, sportsbook: "FanDuel", odds: 120, result: "loss", units: -1 },
  { player: "E F", statFamily: "hits", side: "over", line: 0.5, sportsbook: "DraftKings", odds: -200, result: "loss", units: -1 },
], netUnits: -1.39, gradedAt: "2026-07-21T09:00:00Z" })
fs.writeFileSync(path.join(tTrack, "critic_2026-07-30.json"), JSON.stringify({ missedWinners: { byReason: { fade_tier: 3, non_preferred_book: 2 }, unitsAtFlat$1: 4.2 }, ceilingAudit: { ratePct: 3.1 } }))
const pay = d3.buildDaily3PublicPayload()
check("payload: FULL ledger newest-first (30 → 29 → 20), nothing omitted", pay.cards.length === 3 && pay.cards[0].slate === "2026-07-30" && pay.cards[2].slate === "2026-07-20")
check("payload: losing night carried whole — loss units, settleNote, night net", pay.cards[0].results[0].result === "loss" && pay.cards[0].results[0].units === -1 && /voided per book/.test(pay.cards[0].results[2].settleNote) && pay.cards[0].netUnits === 0.2)
check("payload: record math across graded cards (2W 3L 1P, net −1.19)", pay.record.wins === 2 && pay.record.losses === 3 && pay.record.pushes === 1 && Math.abs(pay.record.netUnitsFlat$1 - (-1.19)) < 0.001 && pay.record.smallSample === true && /not yet meaningful/.test(pay.record.honesty))
check("payload: eras honest — 07-20 pre-receipt (labeled, no fake hash) · 07-29/30 receipted w/ shas", pay.cards[2].receipt.era === "pre-receipt" && pay.cards[2].receipt.cardSha === null && pay.cards[0].receipt.era === "receipted" && pay.cards[1].receipt.era === "receipted" && typeof pay.cards[1].receipt.cardSha === "string")
check("payload: sell-gate proving line present + no ledger dollars anywhere", pay.sellGate.proving === true && /nothing is for sale/.test(pay.sellGate.line) && !JSON.stringify(pay).includes("riskedReal") && !JSON.stringify(pay).includes("stake"))
check("payload: critic notes joined per slate (units, top reasons, ceiling) + lock whys ride the picks", pay.cards[0].critic.missedWinnerUnits === 4.2 && pay.cards[0].critic.topDropReasons[0] === "fade_tier: 3" && pay.cards[0].critic.ceilingPct === 3.1 && pay.cards[0].picks[0].why === "L5 avg 0.8 · cold")
check("payload: chain verdict shipped to the page", pay.receiptChain.ok === true && pay.receiptChain.checked === 2)

// ── source anchors ──
const d3src = rd("pipeline/shared/daily3.js")
check("lock writer: receipt rides the lock (failure labeled non-blocking), why captured at lock, epoch + no-backfill doctrine in source", /writeLockReceipt\(card\)/.test(d3src) && /RECEIPT FAILED \(card locked fine/.test(d3src) && /why: whyLineFromReasoning\(p\.reasoning\)/.test(d3src) && /RAILS_EPOCH = "2026-07-29"/.test(d3src) && /never backfilled/i.test(d3src))
check("receipts live in TRACKED docs/receipts (runtime is gitignored — chain needs git as its second clock)", /docs", "receipts"/.test(d3src) && /backend\/runtime\/\* is gitignored/.test(d3src))
const wr = rd("routes/workstationRoutes.js")
check("route: GET /daily3/public read-only over the payload builder", /router\.get\("\/daily3\/public"/.test(wr) && /buildDaily3PublicPayload\(\)/.test(wr))
const sv = rd("server.js")
check("server: /daily3 static mount beside /m and /status, Access-bypass reality documented", /app\.use\("\/daily3", express\.static/.test(sv) && /Access[\s\S]{0,80}bypass/.test(sv))
const fe = rd("../frontend/daily3/index.html")
check("page: losses-forward doctrine — one .chip class (identical size/weight for every result), full-ledger-or-nothing, no-highlight rule", /LOSSES CARRY THE SAME VISUAL WEIGHT AS WINS/.test(fe) && /one \.chip class/.test(fe) && /whole ledger or nothing/.test(fe) && /NO[\s\S]{0,30}highlight surface/.test(fe))
check("page: sell-gate rendered every load (server line + local fallback) + pre-receipt label + receipt-chain verdict", /PROVING PHASE — nothing is for sale here/.test(fe) && /sellGate/.test(fe) && /pre-receipt era — no lock hash exists; never backfilled/.test(fe) && /receipt chain/.test(fe))
const sch = rd("scripts/scheduler.sh")
check("scheduler: guarded no-op-safe receipt commit (diff --cached --quiet gate; trails the lock tick)", /git add docs\/receipts/.test(sch) && /git diff --cached --quiet -- docs\/receipts \|\| git commit/.test(sch) && /last_receipt_commit_min/.test(sch))
const chc = rd("scripts/componentHealthCheck.js")
check("alarm: daily3Receipt registered (missing-receipt RED post-epoch, chain-break RED, pre-epoch never alarms) + write still LAST", /checkDaily3Receipt/.test(chc) && /"daily3Receipt"/.test(chc) && /Pre-epoch cards NEVER alarm/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkDaily3Receipt()"))
const rv = rd("scripts/runtimeVerify.js")
check("matrix: verifyDaily3Rails registered", /"verifyDaily3Rails"/.test(rv))

console.log(`verifyDaily3Rails: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
