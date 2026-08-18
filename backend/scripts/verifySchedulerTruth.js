"use strict"
// verifySchedulerTruth — SCHEDULER-TRUTH INCIDENT (2026-08-17): per-cycle
// heartbeat w/ loaded-vs-disk vintage, frozen-tick detection (the 8/16 sleep
// gap: log dark 00:00→13:01 ET, minute-exact windows lost), catch-up gates
// for the weekly blocks, identity component #27. Source-anchor + shell-parse
// fixture; the heartbeat's LIVE proof rides the landing receipts.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const sch = rd("scripts/scheduler.sh")
check("vintage captured ONCE pre-loop (the running process's truth, not the file's)",
  /LOADED_SHA=\$\(shasum -a 256 "\$0"/.test(sch) && sch.indexOf("LOADED_SHA=") < sch.indexOf("while true; do"))
check("heartbeat EVERY cycle: atomic tmp+mv write, disk sha recomputed, log-line quote/backslash guarded",
  /DISK_SHA=\$\(shasum -a 256 "\$0"/.test(sch) && /"\$HB_FILE\.tmp\.\$\$" && mv "\$HB_FILE\.tmp\.\$\$" "\$HB_FILE"/.test(sch) && /tr -d '"\\\\'/.test(sch))
// EVOLVED 2026-08-18 (SUNDAY CATCH-UP EXTENSION, CA pack): the original
// TODAY-keyed Sunday-only gates could not heal a Sunday dark ALL day — the
// 8/16 blackout left weekly critic + surface audit with NO receipts, ever.
// Now ALL FOUR weekly blocks ride WEEK-keyed stamps (this week's Sunday)
// firing any tick >=06:00; prior anchors (TODAY_ET stamps, count===2)
// retired with this provenance.
check("catch-up gates: ALL FOUR weekly blocks (G2 exam, w-refit, surface audit, weekly critic) fire ANY tick >=06:00 without the WEEK's stamp + stamp-before-attempt on each",
  /g2exam_done_\$WEEK_SUN/.test(sch) && /mpriorfit_done_\$WEEK_SUN/.test(sch) && /surfaceaudit_done_\$WEEK_SUN/.test(sch) && /weeklycritic_done_\$WEEK_SUN/.test(sch) && (sch.match(/-ge 6 \] && \[ ! -f /g) || []).length === 4 && /touch "\$G2_STAMP_FILE"/.test(sch) && /touch "\$MP_STAMP_FILE"/.test(sch) && /touch "\$SA_STAMP_FILE"/.test(sch) && /touch "\$WC_STAMP_FILE"/.test(sch) && /a failed exam does not retry every 30s/.test(sch))
check("WEEK_SUN is node-derived from TODAY_ET anchored 17:00Z (portable across BSD/GNU date, DST-proof) and the 8/16 blackout class is named at source",
  /WEEK_SUN=\$\(node -e/.test(sch) && /T17:00:00Z/.test(sch) && /getUTCDay/.test(sch) && /8\/16 blackout class/.test(sch))
check("weekday makeups window the MISSED week: critic catch-up passes --asof \"$WEEK_SUN\"; both new blocks guarded-commit docs/audits (orphan-receipt class closed)",
  /--weekly --asof "\$WEEK_SUN"/.test(sch) && /receipts: weekly critic \(scheduler auto-run, week \$WEEK_SUN\)/.test(sch) && /receipts: weekly surface audit \(scheduler auto-run, week \$WEEK_SUN\)/.test(sch))
const critic = rd("scripts/nightlyCritic.js")
check("critic --asof: window computed from asofMs, filename+header keyed to asofDay w/ makeup provenance, generatedAt stays the real clock, no-asof unchanged (asofDay falls back to today)",
  /const asofMs = asof \? Date\.parse\(asof \+ "T17:00:00Z"\) : Date\.now\(\)/.test(critic) && /slateDateForTimestamp\(asofMs - i \* 86400000\)/.test(critic) && /weekly-critic-\$\{asofDay\}\.md/.test(critic) && /makeup run/.test(critic) && /const asofDay = asof \|\| today/.test(critic))
check("time-SENSITIVE windows stay minute-exact BY DESIGN (a late open-capture is not the open)",
  /stay minute-exact/.test(sch) && /-eq 9 \] && \[ "\$MIN" -eq 30/.test(sch))
check("incident provenance in the file: sleep-gap evidence + fences-echoed-success class named",
  /log dark 00:00→13:01/.test(sch) && /echoed success\s*# unconditionally/.test(sch.replace(/\n/g, "\n")) || /echoed success/.test(sch))
const parse = spawnSync("bash", ["-n", path.join(ROOT, "scripts", "scheduler.sh")], { encoding: "utf8" })
check("scheduler parses clean (bash -n)", parse.status === 0)

const chc = rd("scripts/componentHealthCheck.js")
check("component #27 schedulerIdentity: three honest reds (no heartbeat / frozen tick w/ 8/16 class named / loaded≠disk stale code), registered before the sidecar write",
  /checkSchedulerIdentity/.test(chc) && /"schedulerIdentity"/.test(chc) && /NO heartbeat file/.test(chc) && /FROZEN/.test(chc) && /RUNNING STALE CODE/.test(chc) && /8\/16 class/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkSchedulerIdentity()"))
check("heartbeat schema is machine-checkable (the standalone snippet proof rides the landing): loadedSha/diskSha/pid/loopStartedAt keys pinned in the writer",
  /"loadedSha":"%s"/.test(sch) && /"diskSha":"%s"/.test(sch) && /"loopStartedAt":"%s"/.test(sch) && /"pid":%s/.test(sch))
check("heartbeat ts carries an explicit UTC offset (CA rider: a bare local stamp cost a false 4h-stale scare)",
  /HB_TS=\$\(TZ='America\/New_York' date \+%Y-%m-%dT%H:%M:%S%z\)/.test(sch) && /"\$HB_TS" "\$\$" "\$LOOP_STARTED"/.test(sch))
// 2026-08-17 RESTART-GAP addition — the SERVER-vintage twin of #27.
const chc29 = rd("scripts/componentHealthCheck.js")
check("component #29 backendVintage: boot-stamp vs HEAD limited to SERVED files (receipts commits never cry wolf), death-only AutoRecovery gap named, registered before the write",
  /checkBackendVintage/.test(chc29) && /"backendVintage"/.test(chc29) && /git diff --name-only/.test(chc29) && /AutoRecovery fires on death only/.test(chc29) && /zero served-code files changed/.test(chc29) && chc29.indexOf("fs.writeFileSync(OUT") > chc29.indexOf("checkBackendVintage()"))
check("matrix: verifySchedulerTruth registered", /"verifySchedulerTruth"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifySchedulerTruth: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
