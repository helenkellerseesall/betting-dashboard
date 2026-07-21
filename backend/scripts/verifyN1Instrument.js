"use strict"
// verifyN1Instrument — the N1 gate instrument (2026-07-16, owed since N1 land).
// Claims: dual-scores TODAY's tracked N1 rows through the REAL engines in OFF/ON
// subprocesses (never re-derived by hand); append-only + re-run idempotent;
// missing tuples skipped never guessed; settle joins graded rows only (pending
// never guessed); the tally carries the EXACT named gate from the N1 land
// block (14 nights / 1500 decided / over ≥1.0pp abs + ≥25% rel / under ≤0.5pp
// no-harm / Brier ON ≤ OFF / split-half / operator flip); scheduler 17:30 fire.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "captureN1DualScores.js"), "utf8")

check("real engines both sides: OFF/ON subprocess workers (module-load const, as the runtime reads it)", /N1_WORKER: "1"/.test(src) && /MLB_N1_MEDIAN: on \? "1" : "0"/.test(src) && /buildMlbHitsToday/.test(src) && /modelProbForSide/.test(src)) // 2026-07-21: split anchors — env object gained N1_WORKER_OUT (repair pack)
check("append-only + idempotent re-runs (already-captured tuples skipped)", /already\.has\(t\)\) continue/.test(src) && /appendFileSync/.test(src))
check("never fabricate: worker failure ⇒ nothing written; irreproducible tuples skipped honestly", /nothing written \(never fabricate\)/.test(src) && /skipped, never guessed|skipped honestly/.test(src))
check("settle: graded win/loss rows only — pending never guessed", /\["win", "loss"\]\.includes/.test(src) && /pending — never guessed/.test(src))
check("the NAMED N1 gate rides the tally verbatim", /needNights: 14, needDecided: 1500/.test(src) && /≥1\.0pp abs AND ≥25% rel/.test(src) && /≤0\.5pp/.test(src) && /ON ≤ OFF/.test(src) && /OPERATOR \(plist \+ boot line\)/.test(src))
check("shadow doctrine: no scoring/serving/tracked-file writes", !/persistTracked|workstationRoutes|writeFileSync\([^)]*mlb_tracked/.test(src))
check("honest no-op when the slate has no N1 rows", /honest no-op/.test(src))
const sched = fs.readFileSync(path.join(ROOT, "scripts", "scheduler.sh"), "utf8")
check("scheduler: 17:30 ET fire w/ dedupe var", /MIN" -eq 30 \] && \[ "\$HOUR" -eq 17/.test(sched) && /last_n1dual_min/.test(sched))
check("N1-family scope matches the flip gate (hits/totalBases/rbis/runs)", /N1_FAMILIES = \["hits", "totalBases", "rbis", "runs"\]/.test(src))

console.log(`verifyN1Instrument: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
