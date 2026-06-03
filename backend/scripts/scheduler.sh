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
  if [ "$MIN" -eq 45 ] && [ "$HOUR" -ge 9 ] && [ "$HOUR" -le 23 ]; then
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
  if [ "$MIN" -eq 5 ] && [ "$HOUR" -eq 3 ]; then
    log "populateMlbBatterStats starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateMlbBatterStats.js >> "$LOG" 2>&1; then
      log "populateMlbBatterStats OK"
    else
      log "populateMlbBatterStats FAILED (exit $?) — MLB Stats API may be down"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 10 ] && [ "$HOUR" -eq 3 ]; then
    log "populateMlbBatterGameLogs starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateMlbBatterGameLogs.js >> "$LOG" 2>&1; then
      log "populateMlbBatterGameLogs OK"
    else
      log "populateMlbBatterGameLogs FAILED (exit $?) — MLB Stats API may be down"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 15 ] && [ "$HOUR" -eq 3 ]; then
    log "populateMlbPitcherGameLogs starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/populateMlbPitcherGameLogs.js >> "$LOG" 2>&1; then
      log "populateMlbPitcherGameLogs OK"
    else
      log "populateMlbPitcherGameLogs FAILED (exit $?) — MLB Stats API may be down"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 20 ] && [ "$HOUR" -eq 3 ]; then
    log "deriveNbaDvP starting (nightly autopilot)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/deriveNbaDvP.js >> "$LOG" 2>&1; then
      log "deriveNbaDvP OK"
    else
      log "deriveNbaDvP FAILED (exit $?) — depends on nbaPlayerGameLogs.json being fresh"
    fi
    fired=true
  fi

  if [ "$MIN" -eq 25 ] && [ "$HOUR" -eq 3 ]; then
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
  if [ "$MIN" -eq 30 ] && [ "$HOUR" -eq 3 ]; then
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
  if [ "$MIN" -eq 35 ] && [ "$HOUR" -eq 3 ]; then
    log "deriveNbaTeamDefensive starting (nightly autopilot — Phase Truth-Fix-1B)"
    if node /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/deriveNbaTeamDefensive.js >> "$LOG" 2>&1; then
      log "deriveNbaTeamDefensive OK"
    else
      log "deriveNbaTeamDefensive FAILED (exit $?) — check that nbaPlayerGameLogs.json + nbaTeamStats.json exist"
    fi
    fired=true
  fi

  # 2026-05-31 Phase Autonomous-Orchestrator-1A — nightly grading autopilot.
  # Closes INC-010 (buildNightlyOrchestrator dormant — zero production callers
  # outside operator-triggered CLI). Fires `grading:backfill-all` at 4 AM ET
  # daily. Idempotent per-date SKIP logic (SQLite outcome count ≥ JSON settled
  # count → SKIP); safe to re-fire. Settles previous evening's bets into
  # outcome_snapshots and cascades the Session W intelligence tables
  # (calibration_records / process_classifications / ecology_grades /
  # volatility_realizations / eruption_events / daily_intelligence_reports).
  # 4 AM chosen because all West Coast NBA games and late MLB games have
  # settled by then, and it's outside every other scheduler gate.
  # Without this the calibration loop only learns on operator-initiated
  # manual `npm run grading:backfill-all` invocations.
  if [ "$MIN" -eq 0 ] && [ "$HOUR" -eq 4 ]; then
    log "grading:backfill-all starting (nightly autopilot — Phase Autonomous-Orchestrator-1A)"
    if npm run grading:backfill-all >> "$LOG" 2>&1; then
      log "grading:backfill-all OK — calibration corpus refreshed"
    else
      log "grading:backfill-all FAILED (exit $?) — see log for per-date detail"
    fi
    fired=true
  fi

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
