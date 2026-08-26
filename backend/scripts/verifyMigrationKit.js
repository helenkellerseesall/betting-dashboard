"use strict"
// verifyMigrationKit — MIGRATION RUNBOOK pack (2026-08-26): the VPS kit ships
// as repo files; nothing executes until CA + operator run §6 together. Pins:
// the four systemd units carry the launchd-equivalent directives, the deploy
// loop follows push-first/ff-only/#29-path-rules doctrine, the runbook's
// cutover section enforces exactly-one-writer ORDER, and the host-portability
// edits (stat/shasum dual-form, host-aware restart) hold on both platforms.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, "..", rel), "utf8") } catch (_) { return "" } }

const be = rd("deploy/systemd/betting-backend.service")
const sc = rd("deploy/systemd/betting-scheduler.service")
const ds = rd("deploy/systemd/betting-deploy.service")
const dt = rd("deploy/systemd/betting-deploy.timer")
check("backend unit: boot-start (multi-user, no login session — the class that killed the Mac twice), KeepAlive equivalent (Restart=always + RestartSec=10), ET timezone",
  /WantedBy=multi-user\.target/.test(be) && /Restart=always/.test(be) && /RestartSec=10/.test(be) &&
  /Environment=TZ=America\/New_York/.test(be) && /ExecStart=\/usr\/bin\/node server\.js/.test(be))
check("scheduler unit: same script text via the path shim (symlink documented), restart-always, ordered after backend",
  /ExecStart=\/bin\/bash \/Users\/andrewmoore\/Projects\/betting-dashboard\/backend\/scripts\/scheduler\.sh/.test(sc) &&
  /Restart=always/.test(sc) && /After=network-online\.target betting-backend\.service/.test(sc) && /symlink/.test(sc))
check("deploy timer: 5-min cadence + Persistent (missed runs fire at boot)",
  /OnUnitActiveSec=5min/.test(dt) && /Persistent=true/.test(dt) && /ExecStart=.*vps-deploy-pull\.sh/.test(ds))

const dp = rd("deploy/vps-deploy-pull.sh")
check("deploy loop: PUSH FIRST (receipts self-publish — push fence retired), then fetch + ff-only, DIVERGENCE = alarm + human (never auto-resolve)",
  dp.indexOf("git push origin") < dp.indexOf("git fetch origin") && /--ff-only/.test(dp) &&
  /merge-base --is-ancestor/.test(dp) && /DEPLOY DIVERGENCE/.test(dp) && /drift_alerts\.log/.test(dp))
check("deploy loop: restart rules MIRROR watchdog #29 (runtime/.scratch/exam artifacts excluded — receipts commits never bounce services); scheduler restarts only on its own scripts",
  /:\(exclude\)backend\/runtime\//.test(dp) && /:\(exclude\)backend\/config\/g2_validation\.json/.test(dp) &&
  /:\(exclude\)backend\/config\/market_prior_w\.json/.test(dp) && /receipts\/docs only, no restart/.test(dp) &&
  /scheduler\\.sh\|restartBackend\\.sh/.test(dp))
check("deploy loop: stale-lock hygiene (Linux stat form) + 10-min age gate",
  /stat -c %Y/.test(dp) && /-gt 600 \]/.test(dp))

const rb = rd("docs/MIGRATION_RUNBOOK_2026-08-26.md")
check("runbook: exactly-one-writer ORDER — Mac bootout is §6 step 1, VPS enable is step 4, tunnel repoint AFTER the three-part verify; nothing self-executes",
  rb.indexOf("launchctl bootout") < rb.indexOf("systemctl enable --now betting-backend") &&
  rb.indexOf("systemctl enable --now betting-backend") < rb.indexOf("cloudflared service install") &&
  /NOTHING in this document executes itself/.test(rb) && /CA \+ operator together/.test(rb))
check("runbook: secrets by operator scp with placeholder only (never chats/logs); deploy key documented with write-access + revocation; ~4 GB data class rsync'd twice (bulk + delta)",
  /scp .*backend\/\.env/.test(rb) && /<VPS_IP>/.test(rb) && /TUNNEL_TOKEN_PLACEHOLDER/.test(rb) &&
  /Allow write access/.test(rb) && /Revocation/.test(rb) && (rb.match(/rsync -az/g) || []).length >= 3)
check("runbook: verify gate = vintage + heartbeat (real path) + serve lens; rollback section keeps the same one-writer ordering reversed",
  /scheduler_heartbeat\.json/.test(rb) && /api\/ws\/version/.test(rb) && /Rollback/.test(rb) && /reversed/.test(rb))

// host-portability edits
const sch = rd("backend/scripts/scheduler.sh")
const rbs = rd("backend/scripts/restartBackend.sh")
check("scheduler is Linux-portable: stat dual-form in the lock helper + sha256sum fallback at BOTH sha sites",
  /stat -f %m "\$LCK" 2>\/dev\/null \|\| stat -c %Y "\$LCK"/.test(sch) &&
  (sch.match(/\|\| sha256sum "\$0"/g) || []).length === 2)
check("restartBackend is host-aware: no-launchctl branch -> systemctl restart betting-backend w/ 20s /version poll; Mac path unchanged below it",
  /if ! command -v launchctl/.test(rbs) && /systemctl restart betting-backend/.test(rbs) &&
  rbs.indexOf("command -v launchctl") < rbs.indexOf('PLIST="$HOME/Library/LaunchAgents'))

// ── 2026-08-26 grading-gap extension: cutover caught the hole — the kit had
// NO grading owner on the server (grading lives in the separate
// com.motel666.grading-nightly LaunchAgent, and scheduler.sh refuses it by
// doctrine). Pins keep the port + the roster-wide freeze from regressing.
const gs = rd("deploy/systemd/betting-grading.service")
const gt = rd("deploy/systemd/betting-grading.timer")
check("grading unit: Type=oneshot running autopilots/grading-nightly.sh via the path shim, ET timezone, header keeps Grading-Single-Owner-1A (owner changes HOST, never moves into scheduler)",
  /Type=oneshot/.test(gs) && /ExecStart=\/bin\/bash \/Users\/andrewmoore\/Projects\/betting-dashboard\/backend\/scripts\/autopilots\/grading-nightly\.sh/.test(gs) &&
  /Environment=TZ=America\/New_York/.test(gs) && /GRADING-SINGLE-OWNER-1A/i.test(gs))
check("grading unit: g1ReadinessCheck rider (the one non-redundant piece of the unported audit-nightly agent), failure-tolerated ExecStart=- so a g1 hiccup never fails the grade",
  /ExecStart=-\/usr\/bin\/node .*g1ReadinessCheck\.js/.test(gs))
check("grading timer: 04:00 daily + Persistent=true (a 4 AM missed to downtime fires at boot — a late grade beats no grade, the 8/03 stuck-card class)",
  /OnCalendar=\*-\*-\* 04:00:00/.test(gt) && /Persistent=true/.test(gt) && /WantedBy=timers\.target/.test(gt))
check("runbook: grading unit both INSTALLED (§5 cp) and ENABLED (§6) — the exact two lines whose absence was the gap",
  /betting-grading\.service deploy\/systemd\/betting-grading\.timer \/etc\/systemd\/system\//.test(rb) &&
  /systemctl enable --now betting-backend betting-scheduler betting-deploy\.timer betting-grading\.timer/.test(rb))
check("runbook: §6 bootout covers the FULL launchd roster (grading-nightly + audit-nightly + populator-chain + slates) and gates on MUST-print-NOTHING — a surviving Mac grading-nightly at 4 AM would split-brain the graded RECORD",
  /for A in backend scheduler grading-nightly audit-nightly populator-chain slate-mlb-hourly slate-nba-30min/.test(rb) &&
  /MUST print NOTHING/.test(rb) && /split-brain/.test(rb))
check("doctrine intact: scheduler.sh still refuses grading ownership — the Do-NOT-re-add comment stands and no LIVE grading:backfill-all invocation exists (comment mentions don't count)",
  /Do NOT re-add a grading trigger/.test(sch) &&
  !sch.split("\n").some((l) => /npm run grading:backfill-all/.test(l) && !/^\s*#/.test(l)))

console.log(`\nverifyMigrationKit: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
