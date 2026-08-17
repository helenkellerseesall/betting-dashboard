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
check("catch-up gates: BOTH weekly blocks fire on any Sunday tick ≥06:00 without today's stamp (wake self-heals) + stamp-before-attempt doctrine",
  /G2_STAMP_FILE=.*g2exam_done_\$TODAY_ET/.test(sch) && /MP_STAMP_FILE=.*mpriorfit_done_\$TODAY_ET/.test(sch) && (sch.match(/-ge 6 \] && \[ ! -f /g) || []).length === 2 && /touch "\$G2_STAMP_FILE"/.test(sch) && /a failed exam does not retry every 30s/.test(sch))
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
check("matrix: verifySchedulerTruth registered", /"verifySchedulerTruth"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifySchedulerTruth: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
