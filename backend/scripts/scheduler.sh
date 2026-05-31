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
#     bash /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/scheduler.sh
#
#   Leave the terminal open. The script logs each run to scheduler.log.
#   To stop: Ctrl-C in that terminal, or `pkill -f scheduler.sh`.
#
# To verify it's running:
#   pgrep -f scheduler.sh
#   tail -20 /Users/andrewmoore/Desktop/betting-dashboard/.scratch/scheduler.log
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

cd /Users/andrewmoore/Desktop/betting-dashboard/backend

LOG=/Users/andrewmoore/Desktop/betting-dashboard/.scratch/scheduler.log
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')] $*" >> "$LOG"
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
  if [ "$MIN" -eq 15 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ]; then
    log "populateNbaInjuryReport starting..."
    if node /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/populateNbaInjuryReport.js >> "$LOG" 2>&1; then
      log "populateNbaInjuryReport OK"
    else
      log "populateNbaInjuryReport FAILED (exit $?) — ESPN may be down or injury endpoint moved"
    fi
    fired=true
  fi

  # 2026-05-31 — Hourly sysAudit (self-awareness layer task #69).
  # Fires at every :00 between 9 AM and 11 PM ET. Writes per-hour audit
  # snapshot to .scratch/audit_HH.txt. If exit ≥ 2 (RED — critical drift),
  # appends a one-line alert to backend/runtime/audits/drift_alerts.log
  # with timestamp + first failure line so operator can grep history.
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ]; then
    AUDIT_FILE="/Users/andrewmoore/Desktop/betting-dashboard/.scratch/audit_${HOUR_RAW}.txt"
    ALERT_LOG="/Users/andrewmoore/Desktop/betting-dashboard/backend/runtime/audits/drift_alerts.log"
    mkdir -p "$(dirname "$ALERT_LOG")"
    log "sysAudit starting (will write to audit_${HOUR_RAW}.txt)"
    node /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/sysAudit.js > "$AUDIT_FILE" 2>&1
    AUDIT_EXIT=$?
    if [ "$AUDIT_EXIT" -ge 2 ]; then
      FIRST_FAIL=$(grep -m1 '^\[✗\]' "$AUDIT_FILE" || echo "(no fail line found)")
      echo "[$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')] RED · exit=$AUDIT_EXIT · ${FIRST_FAIL}" >> "$ALERT_LOG"
      log "sysAudit RED — exit $AUDIT_EXIT — alert appended to drift_alerts.log"
    elif [ "$AUDIT_EXIT" -eq 1 ]; then
      log "sysAudit YELLOW — warnings only (exit 1)"
    else
      log "sysAudit GREEN — exit 0"
    fi
    # 2026-05-31 (g) — delta check: fires regression alert when this run
    # is WORSE than the previous run. Catches "the fix we just shipped
    # broke a category we already had right." Writes to regression_alerts.log.
    if node /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/auditDeltaCheck.js >> "$LOG" 2>&1; then
      log "auditDeltaCheck: clean (no regressions vs prior hour)"
    else
      log "auditDeltaCheck: REGRESSION DETECTED (see regression_alerts.log)"
    fi
    fired=true
  fi

  if [ "$fired" = "true" ]; then
    last_ran_min="$STAMP"
  fi

  sleep 30
done
