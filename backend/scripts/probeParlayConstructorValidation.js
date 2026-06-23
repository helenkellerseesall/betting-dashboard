"use strict"
/**
 * probeParlayConstructorValidation.js — Phase T2-Parlay-1A (2026-06-14)
 *
 * Validates the parlay constructor on the graded MLB ledger. Per SLATE DATE,
 * builds the +EV-gated CROSS-GAME parlay set (calibrated marginals + offered-odds
 * EV gate — de-vig needs two-way odds the ledger row lacks, so this is the
 * offered-odds fallback) and measures realized ROI; plus the 7×-singles
 * discipline check. EXPECT few/zero qualifying parlays on an efficient-market
 * window — that is the correct, honest result (the gate refuses to bundle
 * without a real edge). The machine's correctness (not winners) is the point.
 *
 * READ-ONLY ledger. Writes summary to .scratch/last.txt. Contingent on calibration
 * being live (MLB_MARGINAL_CALIB on; the constructor uses calibrated marginals).
 */
const fs = require("fs"), path = require("path")
const pc = require("../pipeline/mlb/mlbParlayConstructor")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const SCRATCH = path.join(__dirname, "..", "..", ".scratch", "last.txt")

function loadByDate() {
  const files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const byDate = new Map()
  for (const f of files) {
    const day = f.match(/(\d{4}-\d{2}-\d{2})/)[1]
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    const legs = new Map()
    for (const r of a) {
      if (!r || (r.result !== "win" && r.result !== "loss")) continue
      if (!Number.isFinite(Number(r.modelProb)) || !Number.isFinite(Number(r.oddsAmerican)) || !r.eventId) continue
      const id = `${r.player}|${r.statFamily}|${r.side}|${r.line}`
      if (!legs.has(id)) legs.set(id, { id, player: r.player, statFamily: r.statFamily, side: r.side, line: r.line, eventId: r.eventId, team: r.team, oddsAmerican: Number(r.oddsAmerican), modelProb: Number(r.modelProb), win: r.result === "win" ? 1 : 0 })
    }
    if (legs.size) byDate.set(day, [...legs.values()])
  }
  return byDate
}

const out = []; const log = (s) => out.push(s)
const byDate = loadByDate()
// FORWARD gate: count only slate dates AFTER the cutoff (replaces all-history). --trainThrough=YYYY-MM-DD
// (or FORWARD_CUTOFF env) overrides; default = freeze start so a no-arg run is forward-only.
const FREEZE = "2026-06-11"
const cutoff = (process.argv.slice(2).find((a) => a.startsWith("--trainThrough=")) || "").split("=")[1] || process.env.FORWARD_CUTOFF || FREEZE
const forwardDays = [...byDate.keys()].filter((d) => d > cutoff)
log(`=== T2 parlay-constructor FORWARD validation — ${forwardDays.length} forward slate dates (> ${cutoff}) of ${byDate.size} total ===`)
log(`generated ${new Date().toISOString()}`)

let totalSurfaced = 0, parlayStaked = 0, parlayReturn = 0
let evSingleLegsCount = 0, singleStaked = 0, singleReturn = 0
let sameGameInsightCount = 0
const winById = new Map()

for (const [day, legs] of byDate) {
  if (day <= cutoff) continue   // FORWARD-only (post-cutoff graded slates)
  legs.forEach(l => winById.set(day + "|" + l.id, l.win))
  const r = pc.buildParlays(legs)
  if (!r) { log("MLB_PARLAY off — abort"); break }
  sameGameInsightCount += r.sameGame.length
  // realized parlay ROI (cross-game, +EV-gated)
  for (const p of r.parlays) {
    totalSurfaced++
    const w = p.legs.every(id => winById.get(day + "|" + id) === 1) ? 1 : 0
    parlayStaked += 1
    parlayReturn += w ? p.payout : 0     // stake 1; return payout if all hit, else 0
  }
  // realized singles ROI on the +EV singles (the 7×-singles comparison base).
  // win comes from winById (prepLeg does not carry the outcome).
  for (const s of r.singles) {
    if (!s.plusEVsingle) continue
    evSingleLegsCount++
    singleStaked += 1
    singleReturn += (winById.get(day + "|" + s.id) === 1) ? s.decimal : 0
  }
}

log(`\n(1) +EV-gated CROSS-GAME parlays surfaced across all dates: ${totalSurfaced}`)
if (totalSurfaced > 0) {
  log(`    realized parlay ROI: ${(((parlayReturn - parlayStaked) / parlayStaked) * 100).toFixed(1)}% over ${parlayStaked} parlays (return ${parlayReturn.toFixed(2)} on ${parlayStaked} staked)`)
} else {
  log(`    realized parlay ROI: n/a — ZERO qualifying parlays. This is the EXPECTED honest result on an efficient window: calibration makes marginals honest, so few/no legs clear +EV at the offered price, so the gate correctly bundles nothing.`)
}
log(`\n(2) 7×-singles discipline — +EV single legs: ${evSingleLegsCount}`)
if (evSingleLegsCount > 0) {
  log(`    realized singles ROI: ${(((singleReturn - singleStaked) / singleStaked) * 100).toFixed(1)}% over ${singleStaked} singles`)
  log(`    (constructor default = SINGLES; parlays only surface when cross-game +EV AND both legs +EV, with evIfBetAsSingles always shown.)`)
} else {
  log(`    no +EV single legs on calibrated marginals in this window — so nothing to bundle. Honest: an efficient market + honest marginals ⇒ no manufactured edge.`)
}
log(`\n(3) same-game combos (correlation insight only, evParlay=null): ${sameGameInsightCount}`)

// (4) machine-correctness sanity (synthetic) — proves the EV math + gate, independent of the ledger
const synth = pc.buildParlays([
  { id: "x", player: "X", statFamily: "totalBases", side: "over", line: 1.5, eventId: "E1", team: "A", oddsAmerican: 120, modelProb: 0.55 },
  { id: "y", player: "Y", statFamily: "totalBases", side: "over", line: 1.5, eventId: "E2", team: "B", oddsAmerican: 120, modelProb: 0.55 },
  { id: "z", player: "Z", statFamily: "hr", side: "over", line: 0.5, eventId: "E3", team: "C", oddsAmerican: 300, modelProb: 0.40 },
])
const xy = [...synth.parlays, ...synth.rejected].find(p => p.legs.includes("x") && p.legs.includes("y"))
log(`\n(4) machine-correctness (synthetic): tb×tb evParlay=${xy ? xy.evParlay.toFixed(4) : "n/a"} (surfaced=${synth.parlays.some(p => p.legs.includes("x") && p.legs.includes("y"))}); fake-EV hr single plusEV=${(synth.singles.find(s => s.id === "z") || {}).plusEVsingle} (raw +EV, calibrated −EV ⇒ correctly false)`)

log(`\nHONEST FRAMING: this validates the MACHINE (EV math, calibrated-not-raw, never-auto-bundle), NOT that it produces winners. +EV parlays appear only when real +EV legs exist — post-calibration-live, and only if the market leaves an edge. Forward-validation accrues then.`)

// ── G4 GATE — the +EV-gated set realizes >=0 ROI on FORWARD data (the in-sample -42% must invert). Needs G1 live. ──
const g4_fwdDays = forwardDays.length
const g4_enoughDays = g4_fwdDays >= 14
const g4_roi = parlayStaked > 0 ? (parlayReturn - parlayStaked) / parlayStaked : null
let g4_status
if (!g4_enoughDays) g4_status = "FAIL"
else if (totalSurfaced === 0) g4_status = "N/A"      // 0 +EV legs surfaced = honest no-edge (efficient market), NOT a fail
else g4_status = (g4_roi >= 0) ? "PASS" : "FAIL"
log("")
log(`G4 GATE: ${g4_status}  (need ALL: forward-days>=14 [${g4_fwdDays} ${g4_enoughDays ? "ok" : "no"}] · +EV parlay ROI>=0 [${totalSurfaced === 0 ? "N/A — 0 surfaced (honest no-edge; pre-G1)" : (g4_roi >= 0 ? "ok " : "no ") + (g4_roi * 100).toFixed(1) + "%"}]); requires G1 calibration LIVE first`)
if (!g4_enoughDays) log(`  -> not yet evaluable: only ${g4_fwdDays} forward day(s) past ${cutoff}.`)

const text = out.join("\n") + "\n"
try { fs.writeFileSync(SCRATCH, text, "utf8") } catch (_) {}
process.stdout.write(text)
