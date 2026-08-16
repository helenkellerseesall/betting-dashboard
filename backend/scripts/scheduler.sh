#!/bin/bash
# scheduler.sh — autonomous slate runner (Lane Autonomy v1, 2026-05-28)
#
# Purpose: remove operator dependency for daily slate generation + price
# refreshes. Without this, slate:nba and slate:mlb only run when the
# operator manually invokes them, leading to silent capture gaps (e.g.
# the 14-day NBA close-capture gap, the 4-day MLB blackout).
#
# What it does:
#   - slate:mlb hourly at :00 from 9 AM to 11 PM ET
#   - slate:nba every 30 min (:00 and :30) from 4 PM to 11:30 PM ET
#   - Checks current ET clock minute, fires the right command, deduplicates
#     within the same minute, sleeps 30s between checks.
#   - Appends timestamped output to .scratch/scheduler.log.
#   - Never exits — runs until killed (Ctrl-C or kill PID).
#
# Prerequisites:
#   - Backend running in TERM 1 (slate scripts hit localhost:4000)
#   - caffeinate -i running so Mac doesn't sleep mid-job
#   - This script running in its own terminal (TERM 5)
#
# Operator usage:
#   In a new terminal, run:
#     bash /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/scheduler.sh
#
#   Leave the terminal open. The script logs each run to scheduler.log.
#   To stop: Ctrl-C in that terminal, or `pkill -f scheduler.sh`.
#
# To verify it's running:
#   pgrep -f scheduler.sh
#   tail -20 /Users/andrewmoore/Projects/betting-dashboard/.scratch/scheduler.log
#
# To change cadence, edit the HOUR/MIN gates below.

set -uo pipefail

# 2026-05-29 — PATH fix. launchd does NOT inherit user shell PATH. When
# scheduler.sh runs as a LaunchAgent, npm/node aren't reachable unless we
# explicitly add their install directories. Without this, every slate:mlb
# and slate:nba fires "npm: command not found" exit 127 — silently dropping
# every autonomous slate. Diagnosed 2026-05-29 4 PM ET when the overnight
# MLB slates that were supposed to fire at 9 AM, 10 AM, 11 AM, etc. ALL
# failed with this exact error. Same fix as run-backend-daemon.sh.
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node/v24.14.0/bin" "$HOME/.nvm/versions/node/v22.18.0/bin" /usr/bin; do
  if [ -x "$p/npm" ] || [ -x "$p/node" ]; then
    export PATH="$p:${PATH:-}"
  fi
done

cd /Users/andrewmoore/Projects/betting-dashboard/backend

LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/scheduler.log
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')] $*" >> "$LOG"
}

# Phase Season-Switch-1A (2026-06-14) — per-sport season gate. Defers to the ONE
# node authority (backend/pipeline/shared/seasonGate.js) via its exit code, so
# bash and node share a single logic implementation (Law 1). cwd is the backend
# dir (cd above), so the relative require resolves. Returns 0 = ON, 1 = OFF.
# Used in the populator/injury block conditions below; the slate scripts gate
# themselves at main() entry. NOT applied to sysAudit/settlement/grading/audit
# (sport-agnostic — operator-confirmed they stay ungated).
sport_on() {
  node -e "process.exit(require('./pipeline/shared/seasonGate').isSportEnabled(process.argv[1])?0:1)" "$1" 2>>"$LOG"
}

log "==================================================="
log "scheduler.sh STARTED (pid $$)"
log "MLB cadence: hourly at :00 from 9 AM to 11 PM ET"
log "NBA cadence: every 30 min at :00 and :30 from 4 PM to 11:30 PM ET"
log "caffeinate watchdog: relaunches if dead, every 30s loop"
log "==================================================="

# 2026-05-28 — caffeinate watchdog. Without this, if caffeinate dies (terminal
# closed, manual kill, Mac restart), Mac can sleep → backend suspends → CLV
# loop stops → scheduler can't reach localhost:4000 → silent autonomy failure.
# The watchdog checks every loop iteration and relaunches caffeinate with
# nohup+disown so it survives even if THIS scheduler terminal closes.
ensure_caffeinate() {
  if ! pgrep -x caffeinate >/dev/null 2>&1; then
    log "WATCHDOG: caffeinate is DEAD — relaunching"
    nohup caffeinate -i >/dev/null 2>&1 &
    disown 2>/dev/null || true
    sleep 1
    NEWPID=$(pgrep -x caffeinate | head -1)
    log "WATCHDOG: caffeinate relaunched as pid $NEWPID"
  fi
}

last_ran_min=""
# Phase Status-Snapshot-Autoticker-1A-fix1 (2026-06-02 17:00 ET) — explicit
# init. The autoticker block at line 103 references this var; macOS bash
# treats unset var as fatal under some conditions ("unbound variable" error)
# even without `set -u`. Was crashing scheduler.sh every ~10 sec for hours
# = 0 autopilots fired overnight 2026-06-01 → 06-02. ONE missing line of mine.
last_status_snapshot_min=""
# 2026-07-29 DAILY3-RAILS — receipt auto-commit dedupe var (same belt-and-
# suspenders init doctrine as above; an unset var here crashed the loop once).
last_receipt_commit_min=""
# 2026-07-30 GRADUATION BOARD — aggregator dedupe var (same doctrine).
last_gradboard_min=""
last_g2exam_min=""
last_nfl_capture_min=""

while true; do
  STAMP=$(TZ='America/New_York' date +%Y-%m-%dT%H:%M)
  HOUR_RAW=$(TZ='America/New_York' date +%H)
  MIN_RAW=$(TZ='America/New_York' date +%M)
  # Strip leading zero for arithmetic comparisons (bash treats 09 as octal)
  HOUR=$((10#$HOUR_RAW))
  MIN=$((10#$MIN_RAW))

  # Caffeinate watchdog runs EVERY loop, before the dedupe gate, so it fires
  # on every 30s tick regardless of whether a slate is due.
  ensure_caffeinate

  # 2026-06-02 Phase Status-Snapshot-Autoticker-1A — write /status snapshot
  # to .scratch/last.txt every 5 minutes so Claude always has fresh
  # operational truth without operator needing to tap the export button.
  # Same endpoint the FE button uses (POST /api/ws/status/snapshot) — no
  # parallel write path. Fires on minutes divisible by 5 (00/05/10/.../55).
  # Runs in background (&) so it never blocks the scheduler main loop;
  # silent stdout (`>/dev/null`) so scheduler.log stays clean.
  # Phase Status-Snapshot-Autoticker-1A-fix1 — ${var:-} fallback so this
  # line can't crash even if init missed. Belt + suspenders after the
  # overnight crash-loop incident.
  if [ $((MIN % 5)) -eq 0 ] && [ "$STAMP" != "${last_status_snapshot_min:-}" ]; then
    curl -s -X POST -m 10 "http://localhost:4000/api/ws/status/snapshot" >/dev/null 2>&1 &
    last_status_snapshot_min="$STAMP"
  fi

  # Phase Status-ComponentHealth-1A (2026-06-18) — tested-green runner every 15 min (active
  # hours 9 AM–11 PM ET). Runs each freeze-window component's OWN self-test/probe + freshness
  # checks → component_health.json which /status reads (it never runs the tests in-request).
  # Background (&) so it never blocks the loop; own dedupe var (mirrors the 5-min export gate).
  if [ $((MIN % 15)) -eq 0 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ] && [ "$STAMP" != "${last_health_min:-}" ]; then
    node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/componentHealthCheck.js >> "$LOG" 2>&1 &
    last_health_min="$STAMP"
  fi

  # 2026-07-30 GRADUATION BOARD (ASK f5ee1b6) — aggregate the caged-surface
  # board after the evening scans (17:25, 22:25) + post-grade (05:45), so
  # /status and /m read fresh rows. Read-only over existing artifacts;
  # background so it never blocks the loop.
  if { { [ "$HOUR" -eq 17 ] || [ "$HOUR" -eq 22 ]; } && [ "$MIN" -eq 25 ]; } || { [ "$HOUR" -eq 5 ] && [ "$MIN" -eq 45 ]; }; then
    if [ "$STAMP" != "${last_gradboard_min:-}" ]; then
      node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/graduationBoard.js >> "$LOG" 2>&1 &
      last_gradboard_min="$STAMP"
    fi
  fi

  # 2026-07-29 DAILY3-RAILS R1 — commit new lock receipts so the tamper-evident
  # chain rides git history (docs/receipts is TRACKED; backend/runtime is not).
  # Guarded + no-op-safe per fence doctrine: nothing staged means no commit and
  # the loop continues either way. Fires at :02/:17/:32/:47 so it trails the
  # lock tick rather than racing it.
  if [ $((MIN % 15)) -eq 2 ] && [ "$STAMP" != "${last_receipt_commit_min:-}" ]; then
    (
      cd /Users/andrewmoore/Projects/betting-dashboard || exit 0
      git add docs/receipts >> "$LOG" 2>&1
      git diff --cached --quiet -- docs/receipts || git commit -m "receipts: daily3 lock receipt (scheduler auto-commit — chain rides git history)" >> "$LOG" 2>&1
    ) &
    last_receipt_commit_min="$STAMP"
  fi

  # 2026-08-11 G2-EXAM-WEEKLY (GO on ASK 63f24e4) — the family exam was manual
  # and the stall alarm caught the identical stall TWICE (07-16→08-02 nine
  # days dark; 08-03→08-11 seven slates). Institutionalize the cure: run the
  # walk-forward validator every Sunday 06:15 ET (after the 05:35 grade sweep,
  # before the Sunday weekly audit reads the board), then GUARDED-commit the
  # verdicts artifact (config/g2_validation.json is TRACKED) on the receipts
  # precedent — nothing staged means no commit. The same commit sweeps any
  # untracked docs/audits synthesis files (the Sunday audit writes them;
  # nothing committed them — the 8/9 pair sat orphaned two days). Exam runs
  # foreground INSIDE a background subshell so the commit follows the exam
  # without ever blocking the loop; wall-clock logged (first scheduled run
  # measures it — unmeasured as of 8/11). A validator crash leaves the
  # artifact unwritten and gradBoardStall STAYS red — the schedule removes
  # the human from the loop, never the alarm.
  DOW=$(TZ='America/New_York' date +%u)
  if [ "$DOW" -eq 7 ] && [ "$HOUR" -eq 6 ] && [ "$MIN" -eq 15 ] && [ "$STAMP" != "${last_g2exam_min:-}" ]; then
    (
      cd /Users/andrewmoore/Projects/betting-dashboard || exit 0
      log "G2 weekly exam starting (validateG2Curves — Sun 06:15 ET)"
      EXAM_T0=$(date +%s)
      if node backend/scripts/validateG2Curves.js >> "$LOG" 2>&1; then
        log "G2 weekly exam OK ($(( $(date +%s) - EXAM_T0 ))s)"
      else
        log "G2 weekly exam FAILED (exit $?) — artifact unwritten; gradBoardStall stays red until a good run"
      fi
      git add backend/config/g2_validation.json docs/audits >> "$LOG" 2>&1
      git diff --cached --quiet -- backend/config/g2_validation.json docs/audits || git commit -m "exam: G2 validator weekly (scheduler auto-run)" >> "$LOG" 2>&1
    ) &
    last_g2exam_min="$STAMP"
  fi

  # 2026-08-15 NFL CAPTURE-FIRST (standing queue; CC eee5b6f, CA triage
  # 342262e) — capture-only windows on the NFL clock: Wed 10:00 TNF open ·
  # Thu 09:30 morning open (the MLB-morning analog — early props soft +
  # low-limit) · Fri 15:30 post-designation · Sun 11:50 pre-kick, all ET.
  # The script SELF-GATES on seasonsActive.json nfl (ships false) — these
  # windows fire year-round and no-op honestly until the operator flips the
  # gate at season start (~Sep); no restart needed. Quota rides the odds
  # ledger (caller captureNflProps). DOW comes from the G2 block above.
  NFLWIN=""
  if [ "$DOW" -eq 3 ] && [ "$HOUR" -eq 10 ] && [ "$MIN" -eq 0 ]; then NFLWIN="wed_tnf_open"; fi
  if [ "$DOW" -eq 4 ] && [ "$HOUR" -eq 9 ] && [ "$MIN" -eq 30 ]; then NFLWIN="thu_morning_open"; fi
  if [ "$DOW" -eq 5 ] && [ "$HOUR" -eq 15 ] && [ "$MIN" -eq 30 ]; then NFLWIN="fri_post_designation"; fi
  if [ "$DOW" -eq 7 ] && [ "$HOUR" -eq 11 ] && [ "$MIN" -eq 50 ]; then NFLWIN="sun_prekick"; fi
  if [ -n "$NFLWIN" ] && [ "$STAMP" != "${last_nfl_capture_min:-}" ]; then
    node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/captureNflProps.js "$NFLWIN" >> "$LOG" 2>&1 &
    last_nfl_capture_min="$STAMP"
  fi

  # Phase Status-ComponentHealth-2A (2026-06-18) — Pinnacle GAME-LINE benchmark capture, once
  # in the first MLB hour (9:05 AM ET, just after the 9:00 slate:mlb builds the snapshot it reads).
  # OPT-IN ONLY: PINNACLE_BENCHMARK=1 (a second eu Odds API request = extra credits). The capture
  # script ALSO self-gates on the same env, so this is belt+suspenders. Own dedupe var.
  if [ "$MIN" -eq 5 ] && [ "$HOUR" -eq 9 ] && [ "${PINNACLE_BENCHMARK:-0}" = "1" ] && [ "$STAMP" != "${last_pinnacle_min:-}" ]; then
    log "pinnacle benchmark capture starting (PINNACLE_BENCHMARK=1, pre-slate)..."
    if PINNACLE_BENCHMARK=1 node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/capturePinnacleBenchmark.js >> "$LOG" 2>&1; then
      log "pinnacle benchmark capture OK"
    else
      log "pinnacle benchmark capture FAILED (exit $?)"
    fi
    last_pinnacle_min="$STAMP"
  fi

  # Phase Status-ComponentHealth-1A — forward-CLV tracker ~4:15 AM, right after the 4:00 AM
  # grading-nightly, then refresh component health so the morning card reflects the fresh
  # sidecar. Gated on HOUR==4 explicitly (outside the 9–23 slate window) with its own dedupe.
  if [ "$MIN" -eq 15 ] && [ "$HOUR" -eq 4 ] && [ "$STAMP" != "${last_fwdclv_min:-}" ]; then
    log "forwardClvSliceTracker starting (post-grade)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/forwardClvSliceTracker.js >> "$LOG" 2>&1; then
      log "forwardClvSliceTracker OK"
    else
      log "forwardClvSliceTracker FAILED (exit $?)"
    fi
    node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/componentHealthCheck.js >> "$LOG" 2>&1 &
    last_fwdclv_min="$STAMP"
  fi

  # Phase Early-CLV-Measurement-R1 (2026-06-25) — ADDITIVE early pitcher-prop opener snapshot at 6:00 AM ET
  # (outside the 9–23 slate window + the 4 AM grade + 5 AM audit; its own dedupe). Captures the 5 lineup-
  # independent pitcher families into a SEPARATE trueOpen store to MEASURE opener-vs-9AM CLV — does NOT
  # touch snapshot-mlb.json / openOdds / grading / slate / settlement. The script season-gates + no-key-skips
  # itself, so this is a safe no-op in the offseason or without a key.
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -eq 6 ] && [ "$STAMP" != "${last_trueopen_min:-}" ]; then
    log "captureMlbTrueOpen starting (early pitcher-opener snapshot)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/captureMlbTrueOpen.js >> "$LOG" 2>&1; then
      log "captureMlbTrueOpen OK"
    else
      log "captureMlbTrueOpen FAILED (exit $?)"
    fi
    last_trueopen_min="$STAMP"
  fi

  # 2026-07-16 LADDER-CAPTURE (G2 enabler, CC audit §6) — 3 passes/day, ~120 credits each (8 alternate
  # keys × slate events, 6-book CSV = 1 region-unit): 10:00 today's rungs incl. matinee near-close ·
  # 17:00 pre-lock firmed rungs · 22:05 tomorrow's OPENING rungs (rides the forward-roll — which is why
  # there is no early-morning pass: last night's 22:05 already captured today's openers). The script
  # self-guards quota (DAILY_CAP + RESERVE_FLOOR, real x-requests-last costs) and no-games skips honestly.
  if [ "$MIN" -eq 0 ] && { [ "$HOUR" -eq 10 ] || [ "$HOUR" -eq 17 ]; } && [ "$STAMP" != "${last_ladder_min:-}" ]; then
    log "captureMlbLadders starting (pass $HOUR:00 ET)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/captureMlbLadders.js >> "$LOG" 2>&1; then
      log "captureMlbLadders OK"
    else
      log "captureMlbLadders FAILED (exit $?)"
    fi
    last_ladder_min="$STAMP"
  fi
  if [ "$MIN" -eq 5 ] && [ "$HOUR" -eq 22 ] && [ "$STAMP" != "${last_ladder_no_min:-}" ]; then
    log "captureMlbLadders starting (22:05 night-owl pass — tomorrow's opening rungs)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/captureMlbLadders.js --pass=nightowl >> "$LOG" 2>&1; then
      log "captureMlbLadders nightowl OK"
    else
      log "captureMlbLadders nightowl FAILED (exit $?)"
    fi
    last_ladder_no_min="$STAMP"
  fi

  # 2026-07-21 G3-L1 — pair-corpus regen at 05:30 ET (after the 4 AM grade + 5 AM audit): re-extracts the
  # class-tagged settled-pair corpus from the freshly-graded record. Read-only over tracked files;
  # deterministic; its health line alarms on staleness (ships-with-alarm doctrine).
  if [ "$MIN" -eq 30 ] && [ "$HOUR" -eq 5 ] && [ "$STAMP" != "${last_paircorpus_min:-}" ]; then
    log "buildMlbPairCorpus starting (05:30 nightly regen)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/buildMlbPairCorpus.js >> "$LOG" 2>&1; then
      log "buildMlbPairCorpus OK"
    else
      log "buildMlbPairCorpus FAILED (exit $?)"
    fi
    last_paircorpus_min="$STAMP"
  fi

  # 2026-07-28 PARLAY AUTO-SETTLE — 05:35 ET (post-grade): pending realMoney parlays settle from graded
  # leg twins (GRADING_RULES v2 §10: void leg = drop-and-recompute). parlaySettle alarm covers misses.
  if [ "$MIN" -eq 35 ] && [ "$HOUR" -eq 5 ] && [ "$STAMP" != "${last_parlaysettle_min:-}" ]; then
    log "settleParlaysFromRecord starting (05:35)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/settleParlaysFromRecord.js >> "$LOG" 2>&1; then
      log "settleParlaysFromRecord OK"
    else
      log "settleParlaysFromRecord FAILED (exit $?)"
    fi
    last_parlaysettle_min="$STAMP"
  fi

  # 2026-07-28 WEEKLY SURFACE AUDIT — Sundays 05:55 ET: every operator-visible surface vs record truth.
  if [ "$MIN" -eq 55 ] && [ "$HOUR" -eq 5 ] && [ "$(TZ='America/New_York' date +%u)" = "7" ] && [ "$STAMP" != "${last_surfaceaudit_min:-}" ]; then
    node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/weeklySurfaceAudit.js >> "$LOG" 2>&1 && log "weeklySurfaceAudit OK" || log "weeklySurfaceAudit FAILED"
    last_surfaceaudit_min="$STAMP"
  fi

  # 2026-07-26 NIGHTLY CRITIC — 05:40 ET (post-grade, post-corpus): the board's adversary; read-only
  # missed-winners/ceiling/shown-vs-pool artifact; Sundays also write the weekly plain-English synthesis.
  if [ "$MIN" -eq 40 ] && [ "$HOUR" -eq 5 ] && [ "$STAMP" != "${last_critic_min:-}" ]; then
    log "nightlyCritic starting (05:40)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/nightlyCritic.js >> "$LOG" 2>&1; then
      log "nightlyCritic OK"
    else
      log "nightlyCritic FAILED (exit $?)"
    fi
    if [ "$(TZ='America/New_York' date +%u)" = "7" ]; then
      node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/nightlyCritic.js --weekly >> "$LOG" 2>&1 && log "weekly critic OK" || log "weekly critic FAILED"
    fi
    last_critic_min="$STAMP"
  fi

  # 2026-07-16 N1 GATE INSTRUMENT — 17:30 ET: dual-scores today's tracked N1-family rows (mean-centered
  # OFF = served, median-centered ON = shadow) from the real engines; settles prior nights; prints the
  # named N1 gate tally. Append-only shadow artifacts; the N1 flip window runs on this instrument.
  if [ "$MIN" -eq 30 ] && [ "$HOUR" -eq 17 ] && [ "$STAMP" != "${last_n1dual_min:-}" ]; then
    log "captureN1DualScores starting (17:30 N1 gate instrument)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/captureN1DualScores.js >> "$LOG" 2>&1; then
      log "captureN1DualScores OK"
    else
      log "captureN1DualScores FAILED (exit $?)"
    fi
    last_n1dual_min="$STAMP"
  fi

  # 2026-07-16 G2-L3 — SHADOW rung-EV scanner: prices captured ladder rungs against per-player curves
  # (PASS families only, frozen constants, FLB margins) + settles yesterday's paper flags. 17:15 (post
  # pre-lock ladder pass) + 22:20 (post night-owl pass, tomorrow's opening rungs). Writes shadow artifacts
  # + the gate-tally ledger ONLY — nothing bettor-facing until the named operator-gated flip.
  if [ "$MIN" -eq 15 ] && [ "$HOUR" -eq 17 ] && [ "$STAMP" != "${last_rungscan_min:-}" ]; then
    log "scanRungEv starting (17:15 shadow scan)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/scanRungEv.js >> "$LOG" 2>&1; then
      log "scanRungEv OK"
    else
      log "scanRungEv FAILED (exit $?)"
    fi
    last_rungscan_min="$STAMP"
  fi
  if [ "$MIN" -eq 20 ] && [ "$HOUR" -eq 22 ] && [ "$STAMP" != "${last_rungscan_no_min:-}" ]; then
    log "scanRungEv starting (22:20 shadow scan — tomorrow's opening rungs)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/scanRungEv.js >> "$LOG" 2>&1; then
      log "scanRungEv nightowl OK"
    else
      log "scanRungEv nightowl FAILED (exit $?)"
    fi
    last_rungscan_no_min="$STAMP"
  fi

  # 2026-07-21 G3-L4 — shadow parlay pricer: composes cross-game 2-3 leg paper parlays from the rung
  # scans (certified-independence license enforced in-script) + settles the paper ledger. 17:20 + 22:25
  # (right after each rung scan). Shadow artifact + ledger only.
  if [ "$MIN" -eq 20 ] && [ "$HOUR" -eq 17 ] && [ "$STAMP" != "${last_parlayscan_min:-}" ]; then
    log "scanParlayEv starting (17:20 shadow parlay pricing)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/scanParlayEv.js >> "$LOG" 2>&1; then
      log "scanParlayEv OK"
    else
      log "scanParlayEv FAILED (exit $?)"
    fi
    last_parlayscan_min="$STAMP"
  fi
  if [ "$MIN" -eq 25 ] && [ "$HOUR" -eq 22 ] && [ "$STAMP" != "${last_parlayscan_no_min:-}" ]; then
    log "scanParlayEv starting (22:25 night-owl parlay pricing)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/scanParlayEv.js >> "$LOG" 2>&1; then
      log "scanParlayEv nightowl OK"
    else
      log "scanParlayEv nightowl FAILED (exit $?)"
    fi
    last_parlayscan_no_min="$STAMP"
  fi

  # 2026-07-15 NIGHT-OWL-1 — evening pass at 22:00 ET: captures TOMORROW's opener the night before
  # (script forward-rolls to the next slate once today's games have started; --evening = future-slate-only,
  # so it can NEVER overwrite the same-day 6 AM baseline). Same isolation guarantees as the 6 AM pass.
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -eq 22 ] && [ "$STAMP" != "${last_nightowl_min:-}" ]; then
    log "captureMlbTrueOpen --evening starting (night-owl next-slate opener)..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/captureMlbTrueOpen.js --evening >> "$LOG" 2>&1; then
      log "captureMlbTrueOpen --evening OK"
    else
      log "captureMlbTrueOpen --evening FAILED (exit $?)"
    fi
    last_nightowl_min="$STAMP"
  fi

  # Dedupe — don't fire twice within the same minute
  if [ "$STAMP" = "$last_ran_min" ]; then
    sleep 30
    continue
  fi

  fired=false

  # MLB: hourly at :00 from 9 AM (9) to 11 PM ET (23)
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ]; then
    log "slate:mlb starting..."
    if npm run slate:mlb >> "$LOG" 2>&1; then
      log "slate:mlb OK"
    else
      log "slate:mlb FAILED (exit $?) — backend may be down"
    fi
    fired=true
  fi

  # NBA: every 30 min at :00 and :30 from 4 PM (16) to 11 PM ET (23)
  if { [ "$MIN" -eq 0 ] || [ "$MIN" -eq 30 ]; } && [ "$HOUR" -ge 16 ] && [ "$HOUR" -le 23 ]; then
    log "slate:nba starting..."
    if npm run slate:nba >> "$LOG" 2>&1; then
      log "slate:nba OK"
    else
      log "slate:nba FAILED (exit $?) — backend may be down"
    fi
    fired=true
  fi

  # 2026-05-31 — NBA injury report refresh at :15. Wired in response to
  # deepAudit flagging NBA injuries 16h stale (max 6h). Slate-wide ESPN
  # endpoint, ~2s runtime, refreshes nbaInjuryReport.json. Fires at :15 so
  # it doesn't collide with slate runs at :00/:30 or sysAudit at :00.
  if [ "$MIN" -eq 15 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ] && sport_on nba; then
    log "populateNbaInjuryReport starting..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateNbaInjuryReport.js >> "$LOG" 2>&1; then
      log "populateNbaInjuryReport OK"
    else
      log "populateNbaInjuryReport FAILED (exit $?) — ESPN may be down or injury endpoint moved"
    fi
    fired=true
  fi

  # 2026-05-31 — NBA game-logs refresh at :45 (Phase NBA-GameLogs-Autopilot-1A).
  # Pulls per-player per-game ESPN boxscore data into nbaPlayerGameLogs.json
  # which nbaRecentFormCache.js reads as the ESPN canonical source (post
  # 2026-05-26 api-basketball retirement). Without autopilot the cache was
  # only refreshed by manual `populateNbaGameLogs.js` runs — same silent
  # staleness mode #84 fixed for injuries. Idempotent (re-run on same date
  # does NOT duplicate). Fires at :45 — clean slot (no collisions with slate
  # :00/:30, injury :15, sysAudit :00, grading 4:00 AM).
  if [ "$MIN" -eq 45 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ] && sport_on nba; then
    log "populateNbaGameLogs starting..."
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateNbaGameLogs.js >> "$LOG" 2>&1; then
      log "populateNbaGameLogs OK"
    else
      log "populateNbaGameLogs FAILED (exit $?) — ESPN may be down or boxscore endpoint moved"
    fi
    fired=true
  fi

  # 2026-05-31 — Hourly sysAudit (self-awareness layer task #69).
  # Fires at every :00 between 9 AM and 11 PM ET. Writes per-hour audit
  # snapshot to .scratch/audit_HH.txt. If exit ≥ 2 (RED — critical drift),
  # appends a one-line alert to backend/runtime/audits/drift_alerts.log
  # with timestamp + first failure line so operator can grep history.
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ]; then
    AUDIT_FILE="/Users/andrewmoore/Projects/betting-dashboard/.scratch/audit_${HOUR_RAW}.txt"
    ALERT_LOG="/Users/andrewmoore/Projects/betting-dashboard/backend/runtime/audits/drift_alerts.log"
    mkdir -p "$(dirname "$ALERT_LOG")"
    log "sysAudit starting (will write to audit_${HOUR_RAW}.txt)"
    node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/sysAudit.js > "$AUDIT_FILE" 2>&1
    AUDIT_EXIT=$?
    if [ "$AUDIT_EXIT" -ge 2 ]; then
      # Phase SysAudit-Multi-RED-1A (2026-06-03 ~04:00 ET) — write EVERY
      # distinct [✗] fail line to drift_alerts.log, not just the first.
      # Pre-fix: `grep -m1` only kept the top RED, which meant calibration
      # (always the loudest first finding) silently shadowed every other
      # failure. CLV breaking on 2026-05-31 went undetected for 2 days
      # because every hourly sysAudit caught it but only logged calibration.
      # Now multiple RED rows per run = honest visibility on every distinct
      # failure class. drift_alerts.log grows slightly faster but Phase #52
      # LiveReconcile already deduplicates stale entries server-side.
      TS="$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')"
      FAIL_LINES=$(grep '^\[✗\]' "$AUDIT_FILE" || true)
      FAIL_COUNT=0
      if [ -n "$FAIL_LINES" ]; then
        while IFS= read -r FAIL_LINE; do
          [ -z "$FAIL_LINE" ] && continue
          echo "[$TS] RED · exit=$AUDIT_EXIT · ${FAIL_LINE}" >> "$ALERT_LOG"
          FAIL_COUNT=$((FAIL_COUNT + 1))
        done <<< "$FAIL_LINES"
      else
        echo "[$TS] RED · exit=$AUDIT_EXIT · (no fail line found)" >> "$ALERT_LOG"
      fi
      log "sysAudit RED — exit $AUDIT_EXIT — ${FAIL_COUNT} distinct fail line(s) appended to drift_alerts.log"

      # 2026-06-01 Phase Backend-AutoRecovery-1A (#124) — auto-fire
      # restartBackend.sh when sysAudit's RED is specifically a
      # backend-not-responding alert (ECONNREFUSED on /api/ws/version).
      # Closes the 2026-05-31 20:01 ET silent-outage window: sysAudit DETECTED
      # the backend was down and logged the restart command, but nothing
      # actually executed the recovery. By the time operator looked the next
      # morning, the system had self-recovered via LaunchAgent KeepAlive but
      # the CLV-capture window had been missed for hours.
      #
      # Scope: ONLY fires on backend-down RED — cognition-overconfidence RED
      # (e.g. "points_assists 37pp gap") doesn't need a restart, it needs a
      # cognition fix. The grep distinguishes the two.
      #
      # Phase SysAudit-Multi-RED-1A — now scans FAIL_LINES (multi-line var)
      # via grep -qE which still returns true if ANY of the multiple fail
      # lines contains the backend-down pattern. AutoRecovery behavior
      # preserved exactly; just the source variable changed shape.
      #
      # Rate-limit: 15-min lockfile prevents restart-loop if backend is
      # genuinely broken (would just churn forever otherwise).
      RECOVERY_LOCK="/Users/andrewmoore/Projects/betting-dashboard/.scratch/.auto_recovery_lock"
      if echo "$FAIL_LINES" | grep -qE 'ECONNREFUSED|Backend not responding'; then
        LAST_RECOVERY=0
        if [ -f "$RECOVERY_LOCK" ]; then
          LAST_RECOVERY=$(cat "$RECOVERY_LOCK" 2>/dev/null || echo 0)
        fi
        NOW=$(date +%s)
        GAP=$(( NOW - LAST_RECOVERY ))
        if [ "$GAP" -ge 900 ]; then
          log "sysAudit RED is BACKEND-DOWN — firing restartBackend.sh (Phase Backend-AutoRecovery-1A)"
          bash /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/restartBackend.sh >> "$LOG" 2>&1
          RECOVERY_RC=$?
          echo "$NOW" > "$RECOVERY_LOCK"
          echo "[$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')] AUTO-RECOVERY · restartBackend.sh exit=${RECOVERY_RC} (Phase Backend-AutoRecovery-1A)" >> "$ALERT_LOG"
          log "Auto-recovery restartBackend.sh exit=${RECOVERY_RC} — see drift_alerts.log"
        else
          log "Auto-recovery skipped — last restart was ${GAP}s ago (rate limit 900s)"
          echo "[$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')] AUTO-RECOVERY SKIPPED · last restart ${GAP}s ago < 900s rate limit" >> "$ALERT_LOG"
        fi
      fi
    elif [ "$AUDIT_EXIT" -eq 1 ]; then
      log "sysAudit YELLOW — warnings only (exit 1)"
    else
      log "sysAudit GREEN — exit 0"
    fi
    # 2026-05-31 (g) — delta check: fires regression alert when this run
    # is WORSE than the previous run. Catches "the fix we just shipped
    # broke a category we already had right." Writes to regression_alerts.log.
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/auditDeltaCheck.js >> "$LOG" 2>&1; then
      log "auditDeltaCheck: clean (no regressions vs prior hour)"
    else
      log "auditDeltaCheck: REGRESSION DETECTED (see regression_alerts.log)"
    fi
    fired=true
  fi

  # 2026-06-01 Phase Stale-Populators-Autopilot-1A — overnight refresh of the
  # 5 populator caches that were drifting 26+ hours stale: mlbBatterStats,
  # mlbBatterGameLogs, mlbPitcherGameLogs, nbaDvP, nbaTeamStats. These feed
  # the slate scoring engines (batter/pitcher signal, NBA defense-vs-position,
  # NBA team-level baselines). Without nightly refresh, TOP PICKS uses stale
  # signals for ~24h after each missed refresh window.
  # Sequenced 3:05-3:25 AM ET — overnight, finishes BEFORE grading:backfill-all
  # at 4 AM so grading review has fresh signals. Sequential firing (5 min apart)
  # avoids rate limits on MLB Stats API + ESPN.
  if [ "$MIN" -eq 5 ] && [ "$HOUR" -eq 3 ] && sport_on mlb; then
    log "populateMlbBatterStats starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateMlbBatterStats.js >> "$LOG" 2>&1; then
      log "populateMlbBatterStats OK"
    else
      log "populateMlbBatterStats FAILED (exit $?) — MLB Stats API may be down"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 10 ] && [ "$HOUR" -eq 3 ] && sport_on mlb; then
    log "populateMlbBatterGameLogs starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateMlbBatterGameLogs.js >> "$LOG" 2>&1; then
      log "populateMlbBatterGameLogs OK"
    else
      log "populateMlbBatterGameLogs FAILED (exit $?) — MLB Stats API may be down"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 15 ] && [ "$HOUR" -eq 3 ] && sport_on mlb; then
    log "populateMlbPitcherGameLogs starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateMlbPitcherGameLogs.js >> "$LOG" 2>&1; then
      log "populateMlbPitcherGameLogs OK"
    else
      log "populateMlbPitcherGameLogs FAILED (exit $?) — MLB Stats API may be down"
    fi
    fired=true
  fi

  # Phase Forward-Capture-Chain-1A (2026-06-18) — once-daily FORWARD signal-capture chain at 10:30 AM
  # ET, AFTER the morning slate:mlb (9:00/10:00) has built mlb_tracked_bets_<slate>.json. Refresh the
  # 4 additive zero-consumer staging derivations, THEN stamp their fresh values onto the day's tracked
  # bets (signal_capture_<slate>.json) — the forward, no-lookahead clock for ingestion #31. MLB-season-
  # gated; each step log+continue so one failure never crashes the loop. These pull FanGraphs/Savant/
  # Open-Meteo — if the LaunchAgent context can't reach a vendor, the step logs FAILED here (visible on
  # the log / future /status check), NEVER silently skipped. captureSignalSnapshot no-ops gracefully
  # (exit 0) on an empty/pre-slate day. Additive/infra only — no scoring/PRESERVED touch.
  if [ "$MIN" -eq 30 ] && [ "$HOUR" -eq 10 ] && sport_on mlb; then
    log "forward-capture chain starting (4 staging refreshes + signal capture)..."
    for fc_step in deriveMlbStatcastQuality deriveMlbAirDensity deriveMlbPitcherFip deriveMlbBullpenQuality captureSignalSnapshot; do
      if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/${fc_step}.js >> "$LOG" 2>&1; then
        log "  forward-capture: ${fc_step} OK"
      else
        log "  forward-capture: ${fc_step} FAILED (exit $?) — vendor/network or no-data; chain continues"
      fi
    done
    log "forward-capture chain done"
    fired=true
  fi

  if [ "$MIN" -eq 20 ] && [ "$HOUR" -eq 3 ] && sport_on nba; then
    log "deriveNbaDvP starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/deriveNbaDvP.js >> "$LOG" 2>&1; then
      log "deriveNbaDvP OK"
    else
      log "deriveNbaDvP FAILED (exit $?) — depends on nbaPlayerGameLogs.json being fresh"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 25 ] && [ "$HOUR" -eq 3 ] && sport_on nba; then
    log "populateNbaTeamStats starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateNbaTeamStats.js >> "$LOG" 2>&1; then
      log "populateNbaTeamStats OK"
    else
      log "populateNbaTeamStats FAILED (exit $?) — ESPN team stats endpoint may be down"
    fi
    fired=true
  fi

  # 2026-06-01 Phase NBA-Series-State-Auto-1A — auto-derive NBA playoff series
  # state from ESPN scoreboard daily. Eliminates the maintenance burden of
  # hand-curating backend/data/nbaSeriesState.json after each playoff game.
  # Hand-curated file still wins where it has entries (operator override
  # preserved); auto-derived file fills the gap for everything else.
  # Fires at 3:30 ET — after the other populators in this chain so we don't
  # compete with them for the same ESPN rate-limit window.
  if [ "$MIN" -eq 30 ] && [ "$HOUR" -eq 3 ] && sport_on nba; then
    log "populateNbaSeriesState starting (nightly autopilot — Phase NBA-Series-State-Auto-1A)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateNbaSeriesState.js >> "$LOG" 2>&1; then
      log "populateNbaSeriesState OK"
    else
      log "populateNbaSeriesState FAILED (exit $?) — ESPN scoreboard may be down"
    fi
    fired=true
  fi

  # 2026-06-01 Phase Truth-Fix-1B — derive NBA team defensive stats from the
  # per-game logs already cached by populateNbaGameLogs. Closes truth-audit
  # RED #14: ESPN's NBA team-stats endpoint exposes ZERO defensive metrics
  # (no pointsAllowedPerGame, no defensiveRating, no pace), so oppDef was 0%
  # populated on every tracked_best entry historically. This deriver
  # reconstructs team-game scores from player game logs and computes real
  # per-team points-allowed averages, merging into nbaTeamStats.json so the
  # downstream nbaTeamStatsCache sets row.oppDef correctly. Fires at 3:35 ET —
  # after populateNbaTeamStats at 3:25 (which seeds the offensive fields)
  # and populateNbaSeriesState at 3:30. Pure file-derivation, no network
  # calls.
  if [ "$MIN" -eq 35 ] && [ "$HOUR" -eq 3 ] && sport_on nba; then
    log "deriveNbaTeamDefensive starting (nightly autopilot — Phase Truth-Fix-1B)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/deriveNbaTeamDefensive.js >> "$LOG" 2>&1; then
      log "deriveNbaTeamDefensive OK"
    else
      log "deriveNbaTeamDefensive FAILED (exit $?) — check that nbaPlayerGameLogs.json + nbaTeamStats.json exist"
    fi
    fired=true
  fi

  # 2026-06-04 Phase Settlement-Autopilot-1A — settle pending bets BEFORE the
  # 4 AM grading backfill. ROOT-CAUSE FIX (May-31 -> Jun-3 corpus stall):
  # grading:backfill-all only COPIES already-settled bets into outcome_snapshots
  # and SKIPS any date with 0 settled bets. Nothing settled autonomously, so
  # bets sat "pending" forever and the calibration corpus froze. Fires 3:45 AM
  # ET, 15 min before grading. settlement:run --window=3 sweeps the last 3 slate
  # dates (idempotent INSERT OR REPLACE) and chains grading -> nightlyReview ->
  # outcome_snapshots, so bets are settled AND in the corpus by the 4 AM grading.
  if [ "$MIN" -eq 45 ] && [ "$HOUR" -eq 3 ]; then
    log "settlement:run starting (nightly autopilot — Phase Settlement-Autopilot-1A)"
    if npm run settlement:run -- --window=3 >> "$LOG" 2>&1; then
      log "settlement:run OK — pending bets settled into corpus before grading"
    else
      log "settlement:run FAILED (exit $?) — bets may stay pending; grading will skip them"
    fi
    fired=true
  fi

  # 2026-06-21 Phase Grading-Single-Owner-1A (Law 1) — the 4 AM grading:backfill-all
  # trigger that USED to live here (Phase Autonomous-Orchestrator-1A) was REMOVED.
  # It duplicated the canonical `com.motel666.grading-nightly` LaunchAgent, which also
  # fires `npm run grading:backfill-all` at 4 AM. The two ran ~15s apart and RACED on
  # per-date `.nightly_lock` files — the loser fast-failed `already_running` (exit 1,
  # ~47ms) on one rotating date every night. Single owner now = the LaunchAgent
  # (backend/scripts/autopilots/grading-nightly.sh). Do NOT re-add a grading trigger
  # here. See docs/audits/2026-06-21-settlement-grading-failure/.

  # 2026-06-01 Phase Audit-Nightly-Autopilot-1A — fire `npm run audit:nightly`
  # at 5 AM ET (after 3:05-3:25 populator refresh + 4:00 grading:backfill-all).
  # Closes the original #11 gap: auditNightly.js wrapper exists + is callable
  # via npm script but no autopilot was invoking it nightly. Generates the
  # daily markdown proof report at backend/runtime/audits/YYYY-MM-DD-audit.md
  # so operator wakes up to fresh proof of pipeline health (CLV capture rate,
  # grading completion, per-family hit rates, anomaly flags).
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -eq 5 ]; then
    log "audit:nightly starting (Phase Audit-Nightly-Autopilot-1A, report-only mode)"
    # 2026-06-01 — `--no-populators --no-grade` skips Step 0 + Step 1 which are
    # now autonomous via #123 / #84 / #92 / #102. Without these flags the
    # 5 AM call would block scheduler's main loop for 5-15 min (9 populators
    # serially + grading backfill). With flags it generates the markdown report
    # in <10 seconds. Manual `npm run audit:nightly` from operator's terminal
    # still defaults to full-fat (populators + grading + report).
    if npm run audit:nightly -- --no-populators --no-grade >> "$LOG" 2>&1; then
      log "audit:nightly OK — daily proof report written to backend/runtime/audits/"
    else
      log "audit:nightly FAILED (exit $?) — pipeline health report skipped"
    fi
    fired=true
  fi

  if [ "$fired" = "true" ]; then
    last_ran_min="$STAMP"
  fi

  sleep 30
done
