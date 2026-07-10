"use strict"
// verifySettleSpine — SETTLE-SPINE (2026-07-10) fixture. Bet #1 (WON at the
// book, pending 3 days) root-cause guards:
//   1. persistTrackedToday (BOTH sports) filters the INCOMING batch only —
//      persisted rows are the day's RECORD and are never dropped pre-grading
//      (the old merged-set filter destroyed ungraded rows for finished games,
//      killing the settle join AND the close/CLV mirror with them).
//   2. captureClosingLines runs a PLACED-ledger pass — a real-money bet's close
//      never depends on a model twin surviving (market-agnostic tuple index,
//      non-alternate preferred, canonical batchSetClosingLinesByFields writer,
//      already-closed skip, parlays excluded).
// All source-scans (the live e2e proof runs on the Mac: .scratch/prove_settle_spine.js).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const mlb = rd("pipeline/mlb/phase4Tracking.js")
check("MLB: stale filter applies to the INCOMING batch only", /filtered \$\{newBetsUnfiltered\.length - newBets\.length\} stale INCOMING picks/.test(mlb) && /SETTLE-SPINE-1/.test(mlb))
check("MLB: merged set writes UNFILTERED (persisted rows never dropped)", /writeJsonSync\(betsPath, Array\.from\(mergedBetsById\.values\(\)\)\)/.test(mlb))
check("MLB: no merged-set filter remains (allMergedMlb.filter gone)", !/allMergedMlb\.filter/.test(mlb))

const nba = rd("pipeline/nba/buildNbaPerformanceTracking.js")
check("NBA parity: incoming-batch-only filter", /stale INCOMING picks/.test(nba) && /SETTLE-SPINE-1/.test(nba))
check("NBA parity: merged set writes unfiltered; old filter gone", /writeJsonSync\(betsPath, Array\.from\(mergedBetsById\.values\(\)\)\)/.test(nba) && !/const fresh = allMerged\.filter/.test(nba))

const ccl = rd("scripts/captureClosingLines.js")
check("placed-ledger pass exists + runs for both sports in runOnce", /function capturePlacedLedgerCloses\(sport\)/.test(ccl) && /placedLedger = capturePlacedLedgerCloses\(sport\)/.test(ccl))
check("placed pass: pending placed singles only, already-closed skipped, parlays excluded", /decisionType === "placed" \|\| b\.realMoney === true/.test(ccl) && /clvSnapshot\.close\.odds != null/.test(ccl) && /b\.betType !== "parlay"/.test(ccl))
check("placed pass: market-agnostic tuple index, non-alternate preferred", /prev\.isAlt && !isAlt/.test(ccl))
check("placed pass: writes via the canonical ledger mirror only", /batchSetClosingLinesByFields\(entries\)/.test(ccl))
check("placed pass: window check from the MATCHED row's gameTime (ledger rows have none)", /minutesUntilTip > CLOSE_WINDOW_MIN \|\| minutesUntilTip < -POST_TIP_WINDOW_MIN/.test(ccl))

console.log(`verifySettleSpine: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
