"use strict"
// verifyLineFreshness — LINE-FRESHNESS AT SERVE (2026-07-28 ASK: serve-time
// revalidation, line-moved/price-drift badges, as-of stamps, suspended
// deathbed, revalidated-line tuple identity, critic re-measure, alarm).
// Unit e2e on synthetic snapshots + source anchors + a hermetic critic run.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const lf = require("../pipeline/shared/lineFreshness")

// ── math anchors ──
check("implied: −165 → 62.26% · +120 → 45.45% · garbage → null",
  Math.abs(lf.impliedFromAmerican(-165) - 0.62264) < 0.0005 &&
  Math.abs(lf.impliedFromAmerican(120) - 0.45455) < 0.0005 &&
  lf.impliedFromAmerican("x") === null && lf.impliedFromAmerican(0) === null)

// ── synthetic snapshots (one file per scenario — the ctx cache is path-keyed) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lf-"))
const snapFile = (name, rows, { slateKey = "2026-07-28", ageMs = 0 } = {}) => {
  const fp = path.join(tmp, name)
  fs.writeFileSync(fp, JSON.stringify({ data: { updatedAt: new Date(Date.now() - ageMs).toISOString(), snapshotSlateDateKey: slateKey, rows }, savedAt: Date.now() }))
  if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(fp, t, t) }
  return fp
}
const row = (over) => ({ player: "Ernie Clement", propType: "Hits", side: "Under", line: 1.5, odds: -165, book: "BetMGM", marketKey: "batter_hits", ...over })
const bet = (over) => ({ player: "Ernie Clement", statFamily: "hits", side: "under", line: 1.5, oddsAmerican: -165, sportsbook: "BetMGM", marketKey: "batter_hits", ...over })

// fresh: exact tuple, sub-threshold drift (−165 → −170 ≈ 0.7pp)
let ctx = lf.buildRevalidationContext("mlb", { snapshotPath: snapFile("fresh.json", [row({ odds: -170 })]) })
let v = lf.revalidatePick(bet(), ctx)
check("exact tuple, drift <1.5pp → fresh + as-of stamp", v.status === "fresh" && v.asOf != null && v.ageMinutes != null && v.ageMinutes < 1)

// price_drift: −165 → −185 ≈ 2.65pp; current odds served, original preserved
ctx = lf.buildRevalidationContext("mlb", { snapshotPath: snapFile("drift.json", [row({ odds: -185 })]) })
v = lf.revalidatePick(bet(), ctx)
check("odds drift ≥1.5pp → price_drift w/ current odds + original kept", v.status === "price_drift" && v.current.odds === -185 && v.original.odds === -165 && v.driftPp >= 1.5)

// line_moved (the Clement field case): u1.5 gone, u0.5 −185 lives → serve the CURRENT tuple
ctx = lf.buildRevalidationContext("mlb", { snapshotPath: snapFile("moved.json", [row({ line: 0.5, odds: -185 }), row({ line: 2.5, odds: 140 })]) })
v = lf.revalidatePick(bet(), ctx)
check("Clement case: u1.5 dead, u0.5 lives → line_moved to the NEAREST rung w/ current odds", v.status === "line_moved" && v.current.line === 0.5 && v.current.odds === -185 && v.original.line === 1.5)

// vanished from a FRESH snapshot → suspended deathbed (never silently served)
ctx = lf.buildRevalidationContext("mlb", { snapshotPath: snapFile("gone.json", [row({ player: "Somebody Else" })]) })
v = lf.revalidatePick(bet(), ctx)
check("tuple vanished + fresh snapshot → suspended w/ deathbed warning", v.status === "suspended" && /verify in app/.test(v.warning))

// vanished from a STALE snapshot → honest can't-confirm, NEVER a suspended claim
ctx = lf.buildRevalidationContext("mlb", { snapshotPath: snapFile("stale.json", [row({ player: "Somebody Else" })], { ageMs: 40 * 60e3 }) })
v = lf.revalidatePick(bet(), ctx)
check("tuple vanished + stale (40m) snapshot → unknown_stale, not suspended", v.status === "unknown_stale" && v.ageMinutes > lf.SUSPENDED_MAX_AGE_MIN)

// absent snapshot → skipped; revalidatePick never throws on a dead ctx
ctx = lf.buildRevalidationContext("mlb", { snapshotPath: path.join(tmp, "nope.json") })
v = lf.revalidatePick(bet(), ctx)
check("absent snapshot → ok:false → skipped (served-but-labeled beats blocked)", ctx.ok === false && ctx.reason === "snapshot_absent" && v.status === "skipped")
check("null ctx never throws", lf.revalidatePick(bet(), null).status === "skipped")

// mtime cache: same file, second build is the cached context
const cachedFp = snapFile("cache.json", [row()])
const c1 = lf.buildRevalidationContext("mlb", { snapshotPath: cachedFp })
const c2 = lf.buildRevalidationContext("mlb", { snapshotPath: cachedFp })
check("snapshot parse cached by mtime (2nd build cached:true, same index)", c1.meta.cached === false && c2.meta.cached === true && c2.exactIx === c1.exactIx)
check("meta carries slateKey from snapshotSlateDateKey", c1.meta.slateKey === "2026-07-28")

// event log round-trip + slate filter
const evFile = path.join(tmp, "events.jsonl")
lf.logFreshnessEvent({ slate: "2026-07-28", type: "line_moved", player: "Ernie Clement" }, { file: evFile })
lf.logFreshnessEvent({ slate: "2026-07-27", type: "suspended", player: "Other Guy" }, { file: evFile })
const evs = lf.readFreshnessEvents({ file: evFile, slate: "2026-07-28" })
check("event jsonl round-trip w/ slate filter + ts stamp", evs.length === 1 && evs[0].type === "line_moved" && evs[0].ts != null)

// ── serve-pass + surface anchors ──
const wr = rd("routes/workstationRoutes.js")
check("serve pass: revalidation wired into /top-picks, fail-open, current-line swap, event log", /LINE-FRESHNESS AT SERVE/.test(wr) && /revalidatePick/.test(wr) && /revalidation_error/.test(wr) && /pick\.line = v\.current\.line/.test(wr) && /logFreshnessEvent/.test(wr) && /lineFreshness: lineFreshnessSummary/.test(wr))
check("serve pass: wrong-slate boards labeled, never checked against the wrong snapshot", /historical_board/.test(wr) && /future_board/.test(wr) && /snapshot_slate_mismatch/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("FE: badges + as-of stamp + deathbed warning + revalidated-tuple panel note", /_lfNice/.test(fe) && /LINE MOVED/.test(fe) && /PRICE MOVED/.test(fe) && /lines as of/.test(fe) && /records at the CURRENT line/.test(fe))
const chc = rd("scripts/componentHealthCheck.js")
check("alarm: lineFreshness registered w/ cadence-honest 75m game-window bar (premise correction documented) + missing-stamp RED", /checkLineFreshness/.test(chc) && /"lineFreshness"/.test(chc) && /LF_GAME_WINDOW_MAX_AGE_MIN = 75/.test(chc) && /PREMISE\s*\n?\/\/ CORRECTION|PREMISE/.test(chc) && /WITHOUT the revalidation stamp/.test(chc))
const rv = rd("scripts/runtimeVerify.js")
check("matrix: verifyLineFreshness in the runtime:verify suites", /"verifyLineFreshness"/.test(rv))

// ── hermetic critic re-measure e2e ──
// Graded record holds BOTH per-line twins: served u0.5 WON (+100 ⇒ +1u),
// original u1.5 LOST (−1u) ⇒ delta +2.0u (the move saved money).
const ctmp = fs.mkdtempSync(path.join(os.tmpdir(), "lfc-"))
fs.writeFileSync(path.join(ctmp, "mlb_tracked_bets_2026-07-20.json"), JSON.stringify([
  { player: "A B", statFamily: "hits", side: "under", line: 0.5, oddsAmerican: 100, sportsbook: "BetMGM", result: "win" },
  { player: "A B", statFamily: "hits", side: "under", line: 1.5, oddsAmerican: -165, sportsbook: "BetMGM", result: "loss" },
]))
fs.writeFileSync(path.join(ctmp, "line_freshness_events.jsonl"),
  JSON.stringify({ ts: new Date().toISOString(), slate: "2026-07-20", type: "line_moved", player: "A B", statFamily: "hits", side: "under", book: "BetMGM", original: { line: 1.5, odds: -165 }, current: { line: 0.5, odds: 100 } }) + "\n" +
  JSON.stringify({ ts: new Date().toISOString(), slate: "2026-07-20", type: "suspended", player: "C D", statFamily: "hits", side: "under", book: "BetMGM", original: { line: 1.5, odds: -120 } }) + "\n")
const cr = spawnSync(process.execPath, [path.join(ROOT, "scripts", "nightlyCritic.js"), "2026-07-20"], { env: { ...process.env, CRITIC_TRACKING_DIR: ctmp, CRITIC_DATA_DIR: ctmp }, encoding: "utf8", timeout: 60000 })
let art = null
try { art = JSON.parse(fs.readFileSync(path.join(ctmp, "critic_2026-07-20.json"), "utf8")) } catch (_) {}
check(`critic e2e: events counted per slate (exit ${cr.status})`, cr.status === 0 && art && art.lineFreshness && art.lineFreshness.events.line_moved === 1 && art.lineFreshness.events.suspended === 1)
check("critic e2e: moved-serve re-measured on graded twins → +2.0u saved", art && art.lineFreshness.movedServeDelta.measured === 1 && Math.abs(art.lineFreshness.movedServeDelta.unitsSavedAtFlat$1 - 2.0) < 0.001 && art.lineFreshness.movedServeDelta.unmeasurable === 0)

console.log(`verifyLineFreshness: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
