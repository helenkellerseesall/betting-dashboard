"use strict"
// verifyServedCalibrationInjection — G1-Serve-1A (2026-07-05) fixture.
//
// Proves the SERVED-SURFACE calibration injection (the follow-up to G1 STEP 1):
//   1. buildMlbBestBetsBoard registers its calibrated plays into the module-scope
//      serve index when MLB_CALIB_LIVE is ON; OFF ⇒ index stays EMPTY.
//   2. injectMlbCalibratedServeProbs joins the index onto best-available rows by
//      (player|family|side|line|book): hit ⇒ COPY with predictedProbability =
//      calibrated board modelProb + modelProbRaw + calibVersion; miss ⇒ SAME row
//      reference, no stamps (honest raw).
//   3. OFF ⇒ injector returns the SAME array reference (byte-identical).
//   4. Stale-slate index ⇒ skip (same reference).
//   5. Key normalization parity with marketPropsFromMlbRows: case/space-insensitive
//      book, yes→over, HR missing line → 0.5.
//   6. Persistence whitelists CARRY the stamps IFF present (toTrackedMlbBestEntry /
//      toTrackedMlbPick / leanBet) and add NO keys when absent (byte-identical OFF).
//   7. Static wire: server.js serves + records safeBestServed; the board registers
//      the index. (Guards the wire against silent reversion.)
//
// MLB_CALIB_LIVE is read at module load by buildMlbPropClusters, so ON vs OFF is
// exercised via child procs (verifyMarginalCalibration --board-child precedent).
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

if (process.argv.includes("--serve-child")) {
  const pc = require("../pipeline/mlb/buildMlbPropClusters")
  const out = {}
  const eventId = "g1sfx", player = "Fixture Batter"
  const predictions = { players: [{ player, eventId, stats: {
    totalBases: { floor: 0, mostLikely: 2, ceiling: 5, ladder: { "2.5": 0.34 } },
    hits:       { floor: 0, mostLikely: 1, ceiling: 3, ladder: { "1.5": 0.38 } },
    rbis:       { floor: 0, mostLikely: 1, ceiling: 3, ladder: { "1.5": 0.36 } },
  } }] }
  const mkt = (statFamily, marketKey, line) => ({ player, eventId, statFamily, marketKey, propType: statFamily, side: "over", line, oddsAmerican: 1200, sportsbook: "DraftKings" })
  const board = pc.buildMlbBestBetsBoard({ predictions, marketProps: [
    mkt("totalBases", "batter_total_bases", 2.5), mkt("hits", "batter_hits", 1.5), mkt("rbis", "batter_rbis", 1.5),
  ] })
  const plays = [].concat(board.allPlays || [], board.longshotPlays || [], board.altPlays || [], board.fades || [])
  out.boardPlays = plays.map((p) => ({ fam: p.statFamily, modelProb: p.modelProb, modelProbRaw: p.modelProbRaw ?? null, calibVersion: p.calibVersion ?? null }))
  out.index = pc.getMlbCalibratedServeIndex()

  // Serve-shaped rows (snapshot-row vocab: propType text, `book`, raw predictedProbability).
  const serveRows = [
    { player, propType: "Total Bases", marketKey: "batter_total_bases", side: "Over", line: 2.5, book: "DraftKings", odds: 1200, predictedProbability: 0.42 },
    { player, propType: "Hits",        marketKey: "batter_hits",        side: "over", line: 1.5, book: "draftkings", odds: 1200, predictedProbability: 0.40 },
    { player: "Nobody Matched", propType: "RBIs", marketKey: "batter_rbis", side: "over", line: 1.5, book: "FanDuel", odds: 1200, predictedProbability: 0.33 },
  ]
  const injected = pc.injectMlbCalibratedServeProbs(serveRows)
  out.sameRefLive = injected === serveRows
  out.missRowSameRef = injected[2] === serveRows[2]
  out.injectedRows = injected.map((r) => ({ player: r.player, predictedProbability: r.predictedProbability, modelProbRaw: r.modelProbRaw ?? null, calibVersion: r.calibVersion ?? null }))

  // Stale-slate guard.
  out.staleSameRef = pc.injectMlbCalibratedServeProbs(serveRows, { slateDate: "1999-01-01" }) === serveRows

  // HR normalization: registered play side "yes" + line null ⇒ over/0.5; serve row
  // empty side + null line + "Fan Duel" (space) must join it.
  pc.registerMlbCalibratedServeIndex([{ player: "HR Guy", statFamily: "hr", side: "yes", line: null, sportsbook: "FanDuel", modelProb: 0.08, modelProbRaw: 0.15, calibVersion: "mlb-calib-live-v1" }])
  out.hrIndex = pc.getMlbCalibratedServeIndex()
  const hrInjected = pc.injectMlbCalibratedServeProbs([{ player: "HR Guy", propType: "Home Runs", marketKey: "batter_home_runs", side: "", line: null, book: "Fan Duel", odds: 800, predictedProbability: 0.2 }])
  out.hrRow = { predictedProbability: hrInjected[0].predictedProbability, modelProbRaw: hrInjected[0].modelProbRaw ?? null, calibVersion: hrInjected[0].calibVersion ?? null }

  process.stdout.write(JSON.stringify(out))
  process.exit(0)
}

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }

function runChild(mode) {
  const env = Object.assign({}, process.env)
  if (mode === "on") env.MLB_CALIB_LIVE = "1"; else delete env.MLB_CALIB_LIVE
  const r = spawnSync(process.execPath, [__filename, "--serve-child"], { encoding: "utf8", env })
  if (r.status !== 0) { failures.push(`serve child mode=${mode} failed: ${r.stderr}`); fail++; return null }
  try { return JSON.parse(r.stdout.trim().split("\n").pop()) } catch (e) { failures.push(`serve child mode=${mode} unparseable: ${e.message}`); fail++; return null }
}

// ── 1+2. ON child: index registered, injection real ─────────────────────────
const on = runChild("on")
check("ON: board plays all carry calib stamps", !!on && on.boardPlays.length >= 3 && on.boardPlays.every((p) => p.calibVersion === "mlb-calib-live-v1"))
check("ON: serve index registered from the board (size ≥ 3, slate-dated)", !!on && on.index && on.index.size >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(String(on.index.slateDate)))
check("ON: injection returns a NEW array (copies, not mutation)", !!on && on.sameRefLive === false)
if (on) {
  const tbRow = on.injectedRows[0], hitsRow = on.injectedRows[1], missRow = on.injectedRows[2]
  const tbPlay = on.boardPlays.find((p) => p.fam === "totalBases")
  const hitsPlay = on.boardPlays.find((p) => p.fam === "hits")
  check("ON: matched row predictedProbability === calibrated board modelProb (not raw 0.42)", tbPlay && tbRow.predictedProbability === tbPlay.modelProb && tbRow.predictedProbability !== 0.42)
  check("ON: matched row carries calibVersion + board modelProbRaw", tbPlay && tbRow.calibVersion === "mlb-calib-live-v1" && tbRow.modelProbRaw === tbPlay.modelProbRaw)
  check("ON: join is case-insensitive on side + book", hitsPlay && hitsRow.calibVersion === "mlb-calib-live-v1" && hitsRow.predictedProbability === hitsPlay.modelProb)
  check("ON: unmatched row untouched (same ref, raw prob, NO stamp — honest raw)", on.missRowSameRef === true && missRow.predictedProbability === 0.33 && missRow.calibVersion == null)
  check("ON: stale-slate index ⇒ skip (same array reference)", on.staleSameRef === true)
  check("ON: HR normalization (yes→over, null line→0.5, spaced book) joins", on.hrIndex && on.hrIndex.size === 1 && on.hrRow.calibVersion === "mlb-calib-live-v1" && on.hrRow.predictedProbability === 0.08 && on.hrRow.modelProbRaw === 0.15)
}

// ── 3. OFF child: everything inert, byte-identical ──────────────────────────
const off = runChild("off")
check("OFF: board plays carry NO stamps", !!off && off.boardPlays.length >= 3 && off.boardPlays.every((p) => p.calibVersion == null && p.modelProbRaw == null))
check("OFF: serve index stays EMPTY (register no-ops)", !!off && off.index && off.index.size === 0)
check("OFF: injector returns the SAME array reference (byte-identical)", !!off && off.sameRefLive === true)
check("OFF: no row gains a stamp", !!off && off.injectedRows.every((r) => r.calibVersion == null))

// ── 6. Persistence whitelists carry the stamps IFF present ──────────────────
const { toTrackedMlbBestEntry, toTrackedMlbPick, leanBet } = require("../pipeline/mlb/phase4Tracking")
const meta = { slateDate: "2026-07-05", timestamp: "2026-07-05T00:00:00.000Z" }
const stampedRow = { player: "X", propType: "Hits", side: "over", line: 1.5, odds: -110, book: "DraftKings", predictedProbability: 0.137, modelProbRaw: 0.422, calibVersion: "mlb-calib-live-v1" }
const rawRow = { player: "X", propType: "Hits", side: "over", line: 1.5, odds: -110, book: "DraftKings", predictedProbability: 0.42 }
const be1 = toTrackedMlbBestEntry(stampedRow, meta), be0 = toTrackedMlbBestEntry(rawRow, meta)
check("toTrackedMlbBestEntry carries calibVersion + modelProbRaw when stamped", be1.calibVersion === "mlb-calib-live-v1" && be1.modelProbRaw === 0.422 && be1.predictedProbability === 0.137)
check("toTrackedMlbBestEntry adds NO calib keys when unstamped (byte-identical)", !("calibVersion" in be0) && !("modelProbRaw" in be0))
const pk1 = toTrackedMlbPick(stampedRow, meta), pk0 = toTrackedMlbPick(rawRow, meta)
check("toTrackedMlbPick carries calibVersion + modelProbRaw when stamped", pk1.calibVersion === "mlb-calib-live-v1" && pk1.modelProbRaw === 0.422)
check("toTrackedMlbPick adds NO calib keys when unstamped", !("calibVersion" in pk0) && !("modelProbRaw" in pk0))
const stampedPlay = { player: "X", statFamily: "hits", side: "over", line: 1.5, oddsAmerican: -110, sportsbook: "DraftKings", modelProb: 0.137, modelProbRaw: 0.422, calibVersion: "mlb-calib-live-v1", impliedProb: 0.52, edge: -0.38, confidence: 0.5, tier: "PLAYABLE" }
const rawPlay = { player: "X", statFamily: "hits", side: "over", line: 1.5, oddsAmerican: -110, sportsbook: "DraftKings", modelProb: 0.422, impliedProb: 0.52, edge: -0.1, confidence: 0.5, tier: "PLAYABLE" }
const lb1 = leanBet(stampedPlay, "2026-07-05"), lb0 = leanBet(rawPlay, "2026-07-05")
check("leanBet carries calibVersion + modelProbRaw onto tracked_bets when stamped (un-blinds the 14d verify)", lb1.calibVersion === "mlb-calib-live-v1" && lb1.modelProbRaw === 0.422 && lb1.modelProb === 0.137)
check("leanBet adds NO calib keys when unstamped (byte-identical)", !("calibVersion" in lb0) && !("modelProbRaw" in lb0))

// ── 7. Static wire guards ────────────────────────────────────────────────────
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const srv = rd("server.js")
const pcSrc = rd("pipeline/mlb/buildMlbPropClusters.js")
check("server.js wires injectMlbCalibratedServeProbs(safeBest) → safeBestServed", /safeBestServed = injectMlbCalibratedServeProbs\(safeBest\)/.test(srv))
check("server.js records the SERVED rows (recordMlbBestProps + recordMlbDailyPicks)", /recordMlbBestProps\(safeBestServed\)/.test(srv) && /recordMlbDailyPicks\(safeBestServed\)/.test(srv))
check("server.js serves the SERVED rows (best: safeBestServed)", /best: safeBestServed,/.test(srv))
check("buildMlbBestBetsBoard registers the serve index (incl. fades)", /registerMlbCalibratedServeIndex\(\[\.\.\.allPlays, \.\.\.longshotPlays, \.\.\.altPlays, \.\.\.fades\]\)/.test(pcSrc))
check("injector is gated on MLB_CALIB_LIVE (OFF returns same ref)", /function injectMlbCalibratedServeProbs[\s\S]{0,200}if \(!MLB_CALIB_LIVE\) return rows/.test(pcSrc))

console.log(`verifyServedCalibrationInjection: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
