"use strict"
// verifyCorpusRawAxis — H1 corpus fix (2026-07-06) fixture.
//
// The canonical corpus (outcome_snapshots.model_prob) must be RAW-AXIS and
// sourced from the real ledger (JSON tracked_bets), never a calibration map's
// own output. Guards:
//   1. recordOutcome (intelligence.js, PRESERVED — operator-approved H1 edit)
//      reads model_prob OUTCOME-FIRST with prediction fallback.
//   2. buildPostGameReview settlements pass modelProb through the era rule's
//      ONE owner (mlbCalibTraining.statedRawProb) for MLB; plain modelProb for
//      never-calibrated sports; guarded require defaults to EXCLUDE.
//   3. backfillSnapshotColumns phase 3: NULL-only fill (never overwrites),
//      exact-id pass + tuple pass with ambiguous-conflict skip, era rule.
//   4. probeCorpusReady reports model_prob coverage (section 4).
//   5. Era-rule behavior units via the shared owner (redundant with
//      verifyMarginalCalibration §7 by design — this suite must fail alone if
//      the corpus path detaches from the owner).
// All checks are source-scans + pure units — NO database reads/writes (the live
// betting.db is never touched by the verify matrix).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// 1. recordOutcome outcome-first
const intelSrc = rd("storage/intelligence.js")
check("recordOutcome sources model_prob OUTCOME-FIRST with pred fallback", /safeNum\(outcome\.modelProb\) \?\? safeNum\(pred\?\.model_prob\)/.test(intelSrc))
check("recordOutcome H1 edit is documented as the operator-approved PRESERVED change", /H1 corpus fix \(operator-approved PRESERVED edit\)/.test(intelSrc))

// 2. settlement wiring through the era-rule owner
const reviewSrc = rd("pipeline/shared/buildPostGameReview.js")
check("settlements pass modelProb via _rawAxisModelProb", /modelProb:\s+_rawAxisModelProb\(key, b, b\.date \|\| date\)/.test(reviewSrc))
check("_rawAxisModelProb: MLB routes through mlbCalibTraining.statedRawProb (ONE era-rule owner)", /require\("\.\.\/mlb\/mlbCalibTraining"\)\.statedRawProb/.test(reviewSrc))
check("_rawAxisModelProb: guarded require defaults to EXCLUDE (null), never contaminate", /_statedRawProbMlb \? _statedRawProbMlb\(bet, day\) : null/.test(reviewSrc))

// 3. backfill phase 3 discipline
const bfSrc = rd("scripts/backfillSnapshotColumns.js")
check("backfill fills NULL rows only (WHERE model_prob IS NULL in select AND update guard)", /FROM outcome_snapshots WHERE model_prob IS NULL/.test(bfSrc) && /SET model_prob = \? WHERE id = \? AND model_prob IS NULL/.test(bfSrc))
check("backfill applies the era rule via the shared owner for MLB", /statedRawProb\(b, b\.date \|\| day\)/.test(bfSrc))
check("backfill skips + counts AMBIGUOUS tuple conflicts (never guesses across books)", /ambiguous\+\+/.test(bfSrc) && /mx - mn > 0\.01/.test(bfSrc))
check("backfill counts era-excluded contaminated rows (visible, never silent)", /era-excluded=\$\{excludedContaminated\}/.test(bfSrc))
check("backfill uses BEGIN/COMMIT with ROLLBACK (node:sqlite discipline)", /db\.exec\("BEGIN"\)/.test(bfSrc) && /db\.exec\("ROLLBACK"\)/.test(bfSrc))

// 4. probe coverage section
const probeSrc = rd("scripts/probeCorpusReady.js")
check("probeCorpusReady reports model_prob coverage per sport (section 4)", /model_prob coverage on settled rows \(H1/.test(probeSrc) && /with-model_prob=/.test(probeSrc))

// 5. era-rule units via the shared owner (corpus path must fail alone if detached)
const T = require("../pipeline/mlb/mlbCalibTraining")
check("era rule: stamped row → modelProbRaw (raw preserved)", T.statedRawProb({ modelProbRaw: 0.41, modelProb: 0.98 }, "2026-07-08") === 0.41)
check("era rule: pre-flip row → modelProb (it IS raw)", T.statedRawProb({ modelProb: 0.27 }, "2026-06-25") === 0.27)
check("era rule: post-flip row without raw → null (EXCLUDED, not mixed)", T.statedRawProb({ modelProb: 0.98 }, "2026-07-04") === null)
// live-calibration read paths untouched by H1 (no new switch needed):
const dampSrc = rd("pipeline/shared/calibrationDampener.js")
check("calibrationDampener untouched by H1 (no H1 markers in the PRESERVED read paths)", dampSrc.length > 0 && !/H1 corpus/.test(dampSrc))

console.log(`verifyCorpusRawAxis: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
