#!/usr/bin/env node
"use strict"

/**
 * runtimeVerify.js — Phase Operator-Operations-1 (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/runtimeVerify.js
 *     npm run runtime:verify
 *
 * Canonical operator entrypoint to run the 14-suite regression matrix
 * with operator-friendly summary. Replaces the embedded shell `for f in ...`
 * loop from NEXT_SESSION.md.
 *
 * For each verify*.js script:
 *   - prints a status line
 *   - captures exit code
 *   - reports PASS/FAIL
 *
 * Final summary: N/14 PASS + overall verdict.
 *
 * Pure observability — runs the same scripts the existing
 * `npm run brain:checkpoint` matrix invokes. Exits 0 on all-PASS,
 * non-zero on any failure.
 */

const path = require("path")
const { spawnSync } = require("child_process")

// 2026-05-31 Phase ESPN-Enrichment-1A — retired 3 obsolete F-series fixtures
// that asserted on Owner-B API-Sports instrumentation (dead since 2026-05-26
// when operator killed api-basketball subscription). Owner-B helpers are now
// @orphan-marked per Law 11 in nbaIsolatedRoutes.js. Replacement fixture
// `verifyNbaEspnEnrichment` asserts on the live ESPN canonical path.
// Retired (preserved verbatim under additive-only doctrine — fixture files
// stay on disk for archaeology, just not in the matrix):
//   verifyNbaApiSportsContractFix  (Phase F5/F5-A/F5-B/F5-C/F6/F6.3)
//   verifyNbaCacheObservability    (Phase F2)
//   verifyNbaCacheabilityGate      (Phase F3)
const SUITES = [
  "verifyCalibrationHonesty",
  "verifyCompositeKeyIntegrity",
  "verifyLegacyApiSportsCacheGate",
  "verifyMlbContextualPhase1",
  "verifyMlbContextualPhase1B",
  "verifyMlbFutureOnlyHardening",
  "verifyMlbImmutabilityHardening",
  "verifyMlbLiveStatePhase2",
  "verifyNbaEspnEnrichment",
  "verifyOrphanAuthorityHardening",
  "verifyResponseAuthority",
  "verifySnapshotFreshness",
  "verifySlateGamesControl",   // Phase Status-CLV-Display-Honesty-1A — /status never lies "no games" while games happened
  "verifyMlbTierPolicyR2",     // R2 mlb-r2-v1 (2026-06-11) — badge caps + kill-switch byte-identity + tierPolicy stamp
  "verifyNbLadderStep1",       // T2-L1 mlb-nb-ladder-v1 (2026-06-12) — NB shadow ladder math + freeze guard (scoring never reads ladderNB)
  "verifySeasonGate",          // Season-Switch-1A (2026-06-14) — per-sport ON/OFF gate: fresh-read, fail-open, slate-gate-before-call, scheduler 6NBA/3MLB gated + grading/settlement/audit ungated
  "verifyCorrelation",         // T2-Correlation-1A (2026-06-14) — Gaussian copula joint prob: sign BOTH ways, Φ₂ closed-form anchors, kill-switch, freeze guard (scoring never references correlation)
  "verifyMarginalCalibration", // T2-MarginalCalib-1A (2026-06-14) — isotonic modelProb calibration (shadow): monotone, gap<raw, fallback ladder, kill-switch, freeze guard (scoring/PRESERVED untouched)
  "verifyParlayConstructor",   // T2-Parlay-1A (2026-06-14) — parlay EV gate (shadow): cross-game EV hand-derived, same-game EV=null, never-auto-bundle, ANTI-FAKE-EV (calibrated not raw), kill-switch, freeze guard
  "verifyShadowStackIntact",
  "verifyCashoutHedge",   // Shadow-Stack-Guard-1A (2026-06-15) — deletion guard: the 6 sanctioned-shadow files + 2 derived configs exist + export + are listed in PRESERVED.md (build-ahead engines feed nothing live, so deletion must fail LOUD)
  "verifyGameDateDiscipline", // Game-Date-Timing-1A (2026-06-22) — #3 recurrence guard: result-date must derive from officialDate/ET (calendarDateForTimestamp), never UTC truncation (toISOString().slice / getUTC*). CC fixture gamePk 775323 + static scan of the grading result-date files. Kills the "always a day ahead" class.
  "verifyServedCalibrationInjection", // G1-Serve-1A (2026-07-05) — served/tracked best surface carries the BOARD-calibrated prob (predictedProbability = calibrated modelProb + calibVersion/modelProbRaw stamps) via slate-scoped board-index join; OFF byte-identical (same array ref, empty index, no stamp keys); whitelists carry stamps IFF present.
  "verifySpineFixPack", // SPINE-FIX pack (2026-07-05, bet-ready week) — addPlacedBet required --sport + token/book validation + tuple auto-stamp + --dry-run; orchestrator actualValue→actualStat (INC-013 class); settlePlacedBet manual-override CLI (GRADING_RULES §5, canonical settleBet only); captureClosingLines moved-line fallback (nearest rung, clv=null, clvQuality=line_moved, exact always wins/upgrades).
  "verifyCorpusRawAxis", // H1 corpus fix (2026-07-06) — outcome_snapshots.model_prob is RAW-AXIS from the JSON ledger: recordOutcome outcome-first (PRESERVED, operator-approved), settlements via the era-rule owner (statedRawProb), backfill NULL-only + ambiguous-skip + era-excluded counts, probe coverage section; dampener read paths untouched.
  "verifyPlaceBetRoute", // EXEC-CARD (2026-07-07) — one-tap real-money recording: addPlacedBet require-safe + shared core (Law 1, CLI parity preserved), POST /api/ws/place-bet (validated, stamped, already_recorded duplicate guard, §9 warning), FE modal panel w/ round-number stakes + inline-script parse.
  "verifyDeeplinkExecution", // DEEPLINK-2A/2B (2026-07-07) — zero-cost link/SID capture gated MLB_DEEPLINKS (OFF byte-identical); verified-matrix config ships all-disabled (THE link kill-switch); parlay core deterministic id + route parlay mode + duplicate guard; FE matrix-gated anchors, cross-game-only compose, SGP-out, never-prefill-stake, book-odds-required record.
  "verifySettleSpine", // SETTLE-SPINE (2026-07-10, bet-#1 root cause) — persistTrackedToday filters INCOMING batch only, both sports (persisted rows = the day's record, never dropped pre-grading); captureClosingLines placed-ledger pass (real-money closes never depend on a model twin surviving).
  "verifyScreenshotRecord", // E SCREENSHOT-RECORD (2026-07-10) — primary record path: existing OCR pipeline reused (convertImageToJpeg + /screenshots/ocr), EDITABLE confirm screen (never silently recorded), canonical /place-bet cores (single + parlay), MY BETS button both states.
  "verifyFirstHrCure", // F FIRST-HR CURE (2026-07-11) — play-order settlement (win/loss/void/pending, never box totals), ctx wiring, rules-correction backfill discipline, sysAudit survivorship exclusion + direction copy, statusRoute sign-aware copy, corpus v3 exclusion + retro gate PASS artifact.
  "verifyHonestComms", // BREAK-WINDOW Part 1 (2026-07-14) — empty boards SAY WHY (boardState 4-state classifier via slateGamesEvidence, FE renders reasons), boardServeParity watchdog (record-vs-served divergence = FAIL), games-aware slate-fire recovery, recentDateKeys TZ fix both sports.
  "verifyDaily3", // BREAK-WINDOW Part 3 THE DAILY 3 (2026-07-14) — public-record seed: write-once lock at firstPitch−60min from the SERVED lens (no card if pitch passes unlocked), existing-nightly write-once grading (all-3-decided gate), flat-$1 units + small-sample honesty, /api/ws/daily3 + FE card that never blocks the board.
  "verifyNightOwl", // BREAK-WINDOW Part 2 NIGHT-OWL BOARD (2026-07-15) — game-date-driven file keying in the three MLB writers (offset fix A: evening forward-rolled next-day picks become first-class citizens of TOMORROW's record, same stamps), trueOpen 22:00 --evening future-slate-only pass, /top-picks tomorrowSlate + FE separated TOMORROW section (never mixed), dry-default migration w/ delta manifest.
  "verifyLadderCapture", // G2 ENABLER (2026-07-16, CC audit §6) — 3-pass/day alternate-market ladder capture (10:00/17:00/22:05 ET): additive isolation (no snapshot/scoring/serving), quota guard (DAILY_CAP mid-pass stop + RESERVE_FLOOR abort, real x-requests-last costs, honest skips), game-date-keyed rung store w/ pass history, componentHealthCheck line.
  "verifyN1MedianCenter", // N1 MEAN→MEDIAN (2026-07-16, graduation plan §N1) — MLB_N1_MEDIAN kill-switch default-OFF (OFF = legacy mean centers byte-identical, proven via OFF/ON subprocess through the real projectHitterStats), ladder-survival median math unit-tested, center-only scope (floor/ceiling/ladder mean-derived both ways), four batter families exactly, real-data OFF/ON probe present.
  "verifyG2Fitter", // G2-L1 FITTER (2026-07-16, approved scope) — Law-1 extension of the sanctioned negBinomLadder (legacy parity proven numerically, self-tests green, guard tracks new export), weighted MoM (halfLife = L2-chosen parameter; nEff), floors ⇒ honest null, tail cap at maxObserved+1, family map, order robustness, ADDITIVE season gamelog siblings from the same fetch (rolling caches untouched).
  "verifyG2Validator", // G2-L2 VALIDATOR (2026-07-16) — no-lookahead walk-forward (strictly-prior fits), bake-off {10,20,40,none} w/ winner frozen into verdicts JSON, PASS bars (n≥150, max(1.5pp,20%rel)), pitcher n≥12 retest, last-30d slice, Axis-B pending-never-guessed + tail-support skip, read-only doctrine, synthetic e2e through a tmp cache.
  "verifyG2Scanner", // G2-L3 SHADOW SCANNER (2026-07-16) — PASS-families-only from committed verdicts + hard-excluded tb/rbis, frozen constants consumed never re-chosen, FLB margins (max(2pp,1.5×bucket gap), thin⇒worst), tail/floor/pending honesty, named gate tally (14/300/1.5pp/≥0u/split-half), scheduler 17:15+22:20, health line, synthetic e2e (flag/no-flag/settle/pending).
  "verifyN1Instrument", // N1 GATE INSTRUMENT (2026-07-16, owed since N1 land) — nightly 17:30 dual-scoring of tracked N1 rows through the REAL engines in OFF/ON subprocesses, append-only + idempotent, never-fabricate + pending-never-guessed, the named N1 flip gate verbatim in the tally, scheduler wired.
  "verifyObtainability", // OBTAINABILITY-GATE-1 + CARD-IDENTITY (2026-07-17, the Witt field catch) — committed source-tagged book-format map (DK batter families over_only), unknown-never-restricted helper, under@over_only dropped pre-dedup at the SERVED lens only (record untouched), marketFormat tags, Daily-3 identity fields, FE milestone language + matchup/first-pitch identity on all four surfaces.
  "verifyStartedGameGate", // DISPLAY PACK (2026-07-17, operator items) — served lens drops started-game picks strict per-request (record untouched, Daily 3 unaffected, fallback consequence documented), games_started honest boardState pointing at TOMORROW, tier labels as chips not link-styled text.
  "verifyInstrumentRepairs", // INSTRUMENT-REPAIR-PACK (2026-07-21, CA audit) — N1 worker via sync temp file (64KB truncation impossible), canonical playerNameJoin (suffix/diacritic/nickname classes, ambiguity never guesses, frozen flag-ids), void-on-scratch in Daily 3 + ledger (voids excluded from gate math), three instrument alarms + the ships-with-alarm doctrine.
  "verifyG3PairCorpus", // G3-L1 PAIR CORPUS (2026-07-21, approved scope) — five structural classes + certified-not-assumed cross_game, decided-only median-line reference legs, LCG-deterministic capped sampling, pre/post-flip era slice (report not filter), read-only, 05:30 regen + day-one pairCorpus alarm, synthetic e2e with exact class counts.
  "verifyG3Correlation", // G3-L2 (2026-07-21) — Law-1 --g3 extension of the sanctioned derive script (legacy path + shadow priors untouched), walk-forward 2/3 slate split w/ canonical fitRhoZ, named bars (n≥500/gap≤2pp/Brier/cross-game |ρ|<0.05 certification), era slice, synthetic e2e (recovers ρ, certifies independence, STOPs drift).
  "verifyG3CureColumns", // G3-L3 (2026-07-21) — pre-registered cure columns on the live ledger: pooled walk-forward blend w (300/family trigger), k=1 median-disagreement dampening, PASS-only copula opposition conditioning w/ sign unit-pinned both directions + abstention, per-column gates + counterfactual kill bar, paper-only.
  "verifyL4ParlayPricer", // G3-L4 (2026-07-21) — cross-game parlay pricer: certification-license refusal, structural distinct-eventId guard (same-game impossible), blend-primary legs w/ policy labels, void/pending settle semantics, named paper gate verbatim (14/100/3pp/≥0u/operator; G4 unchanged), shadow-only, scheduler+alarm, synthetic e2e incl. exact product pricing.
  "verifyRecordDecoupling", // RECORD-BOOKS + BONUS-BET (2026-07-26, the unrecordable bet365 win) — record path accepts any real book (bet365/Caesars added; recommendation lens untouched), stakeType cash|bonus w/ riskedReal honesty in P/L + ROI, FE dropdowns + bonus checkbox, OCR bet365 fingerprint, unit: the operator's actual bet accepted with toWin 44 / riskedReal 0.
  "verifyCritic", // NIGHTLY CRITIC + RE-POINT PASS 2 (2026-07-26) — read-only adversary w/ static-gate honesty + ceiling bar + weekly synthesis + 05:40/Sunday wiring + alarm; re-point: verified-two_sided-only targets w/ haircut shown, repointed_served attribution split, day-one honest-reach note; synthetic e2e attribution exact.
  "verifyRecordVisibility", // OPERATOR TRIPLE (2026-07-28) — lifetime MY BETS lens (never ages out; FE history collapse) + betsSurfaceParity/parlaySettle alarms + parlay auto-settle (book-agnostic tuple join, void drop-and-recompute w/ manual-defer, combined-odds win math, rider) + Sunday weekly surface audit (five surfaces vs record truth); e2e settle math exact.
  "verifyLineFreshness", // LINE-FRESHNESS AT SERVE (2026-07-28, the Clement u1.5 field case) — serve-time revalidation via the REUSED close-capture join authority (fresh/price_drift≥1.5pp/line_moved-to-nearest-rung/suspended-only-from-fresh-snapshot/unknown_stale/skipped), current-line swap = revalidated-tuple identity for recording, as-of stamps, fail-open labeling, mtime-cached parse, jsonl events + critic moved-serve re-measure on graded twins, lineFreshness alarm; unit e2e exact.
  "verifyBetsPage2", // BETS-PAGE PACK 2 (2026-07-29, operator screenshot audit) — honest header (settled Profit riskedReal-aware/book-payout-preferred + pending-ONLY potential; legacy toWin repointed), count-based fold (15), leg-results backfill for settled parlays (ticket immutable, twins-only, idempotent; manual-settle hook + nightly sweep), live leg-death indicator (irreversible-only, display-only, never writes), componentHealthCheck sidecar-write-LAST audit fix (12 alarms silently unpersisted); unit e2e exact.
  "verifyDaily3Rails", // DAILY-3 SALEABILITY RAILS (2026-07-29, ASK fc1c189) — hash-chained write-once lock receipts in TRACKED docs/receipts (GENESIS→chain, tamper-evident, pre-epoch never backfilled), losses-forward /daily3 public payload+page (full ledger newest-first, same-visual-weight chips, sell-gate proving line, no ledger dollars), lock-time whys + critic-notes feed, guarded scheduler auto-commit, daily3Receipt alarm; hermetic env-dir e2e incl. tamper detection.
]

function pad(s, n) { return String(s).padEnd(n) }

function main() {
  const t0 = Date.now()
  console.log("=== runtime:verify — Phase Operator-Operations-1 ===")
  console.log(`Running ${SUITES.length} regression suites.\n`)

  const results = []
  for (const name of SUITES) {
    const fp = path.join(__dirname, `${name}.js`)
    const tStart = Date.now()
    const r = spawnSync("node", [fp], { encoding: "utf8" })
    const ms = Date.now() - tStart
    const ok = r.status === 0
    results.push({ name, ok, status: r.status, ms })
    const verdict = ok ? "PASS" : "FAIL"
    console.log(`  ${pad(name, 38)} ${pad(verdict, 6)} (exit=${r.status ?? "?"}, ${ms}ms)`)
    if (!ok && r.stderr) {
      const last = r.stderr.split("\n").filter(Boolean).slice(-3).join("\n      ")
      console.log("      stderr tail: " + last)
    }
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  const totalMs = Date.now() - t0

  console.log("")
  console.log("─".repeat(70))
  console.log(`SUMMARY: ${passed}/${results.length} PASS  (${totalMs}ms total)`)
  console.log(`RESULT:  ${failed === 0 ? "PASS" : "FAIL"}`)
  if (failed > 0) {
    console.log("\nFailed suites:")
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name} (exit=${r.status})`)
    }
  }
  process.exit(failed === 0 ? 0 : 1)
}

main()
