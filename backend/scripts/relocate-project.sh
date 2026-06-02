#!/usr/bin/env bash
# relocate-project.sh — Phase Project-Relocation-1A (2026-06-02)
#
# Moves /Users/andrewmoore/Desktop/betting-dashboard → /Users/andrewmoore/Projects/betting-dashboard
# to escape macOS Desktop folder TCC/FDA protection that:
#   - Blocks cron's child shells from reading/writing in ~/Desktop/
#   - Blocks LaunchAgents from re-reading scheduler.sh after edits
#   - Causes scheduler.sh to crash-loop every ~5 min
#   - Caused 0 autopilot fires overnight 2026-06-01 → 06-02 despite scheduler "running"
#
# After this script runs:
#   - Project lives in ~/Projects/ (non-protected folder)
#   - All 4 LaunchAgents point at new location
#   - All cron entries point at new location
#   - All hard-coded path references in scripts updated
#   - Cron can fire entries that write to project files
#   - Scheduler.sh runs stably without 5-min death cycle
#
# Run from anywhere:
#   bash /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/relocate-project.sh
#
# After it completes:
#   cd /Users/andrewmoore/Projects/betting-dashboard
#
# THIS SCRIPT IS DESTRUCTIVE in the sense that it moves the project. Git state
# is preserved (the .git directory moves with the rest). Untracked files preserved.
# .scratch logs move with project (old paths inside log CONTENTS are stale but
# new log entries will use new paths).

set -e  # exit on any error

OLD_PATH="/Users/andrewmoore/Desktop/betting-dashboard"
NEW_PATH="/Users/andrewmoore/Projects/betting-dashboard"
NEW_PARENT="/Users/andrewmoore/Projects"
LOG="/tmp/relocate-$(date +%s).log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }
fail() { log "FATAL: $*"; exit 1; }

log "═══════════════════════════════════════════════════════════════"
log "PROJECT RELOCATION — Phase Project-Relocation-1A"
log "From: $OLD_PATH"
log "To:   $NEW_PATH"
log "Log:  $LOG"
log "═══════════════════════════════════════════════════════════════"

# ─── Step 1: Sanity checks ────────────────────────────────────────────────────
log ""
log "── Step 1: Sanity checks ──"
[[ -d "$OLD_PATH" ]] || fail "old path does not exist: $OLD_PATH"
[[ -d "$OLD_PATH/.git" ]] || fail "old path is not a git checkout"
if [[ -e "$NEW_PATH" ]]; then
  fail "new path already exists: $NEW_PATH — refusing to overwrite. Remove it manually if you want to retry."
fi
mkdir -p "$NEW_PARENT"
log "  ✓ old path exists + is a git checkout"
log "  ✓ new parent dir ready: $NEW_PARENT"

# ─── Step 2: Stop all 4 LaunchAgents cleanly ──────────────────────────────────
log ""
log "── Step 2: Stop LaunchAgents ──"
for label in com.motel666.backend com.motel666.scheduler com.motel666.caffeinate com.motel666.cloudflared; do
  if [[ -f "$HOME/Library/LaunchAgents/$label.plist" ]]; then
    launchctl unload "$HOME/Library/LaunchAgents/$label.plist" 2>&1 | sed 's/^/    /' || true
    log "  ✓ unloaded $label"
  else
    log "  - $label plist not installed (skipping)"
  fi
done

# ─── Step 3: Kill any straggler processes ─────────────────────────────────────
log ""
log "── Step 3: Kill stragglers ──"
pkill -9 -f "scheduler.sh" 2>/dev/null || true
pkill -9 -f "$OLD_PATH/backend/server.js" 2>/dev/null || true
sleep 2
log "  ✓ killed scheduler.sh + node server.js processes (if running)"

# ─── Step 4: Remove cron entries (will re-install from new location) ──────────
log ""
log "── Step 4: Remove cron entries pointing at old path ──"
crontab -l 2>/dev/null | grep -v "$OLD_PATH" | grep -v "CRON_BACKUP_v1" | grep -v "CRON_FDA_TEST" > /tmp/_cron_preserve 2>/dev/null || true
crontab /tmp/_cron_preserve 2>&1 | sed 's/^/    /' || log "  (crontab empty after filter — that's fine)"
log "  ✓ removed CRON_BACKUP_v1 + CRON_FDA_TEST + any other old-path entries"

# ─── Step 5: Move the project ─────────────────────────────────────────────────
log ""
log "── Step 5: Move project ──"
mv "$OLD_PATH" "$NEW_PATH" || fail "mv failed"
log "  ✓ moved to $NEW_PATH"

# ─── Step 6: Replace ALL absolute path references in project files ────────────
log ""
log "── Step 6: sed-replace path refs in project files ──"
# Find every text file that mentions the old path, replace with new path.
# Use BSD sed (-i '' '') for macOS. Skip node_modules, .git, .scratch (logs
# have historical content that should stay as-is for forensic value).
FILES=$(grep -rlF "$OLD_PATH" "$NEW_PATH" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=.scratch \
  2>/dev/null || true)

UPDATED_COUNT=0
for f in $FILES; do
  # Skip binary files
  if file "$f" 2>/dev/null | grep -q "binary"; then continue; fi
  sed -i '' "s|$OLD_PATH|$NEW_PATH|g" "$f" 2>/dev/null && UPDATED_COUNT=$((UPDATED_COUNT + 1))
done
log "  ✓ updated $UPDATED_COUNT files (paths sed-replaced in place)"

# ─── Step 7: Re-install plists from new location ──────────────────────────────
log ""
log "── Step 7: Re-install LaunchAgent plists ──"
for label in com.motel666.backend com.motel666.scheduler com.motel666.caffeinate com.motel666.cloudflared; do
  SRC="$NEW_PATH/backend/scripts/$label.plist"
  DST="$HOME/Library/LaunchAgents/$label.plist"
  if [[ -f "$SRC" ]]; then
    cp "$SRC" "$DST"
    log "  ✓ copied $label plist to $DST"
    launchctl load "$DST" 2>&1 | sed 's/^/    /' || log "    (load may warn — KeepAlive will handle)"
  else
    log "  - $SRC not found (skipping)"
  fi
done

# ─── Step 8: Reinstall cron entries from new location ─────────────────────────
log ""
log "── Step 8: Reinstall cron entries ──"
if [[ -f "$NEW_PATH/backend/scripts/cron-backup.crontab" ]]; then
  crontab -l 2>/dev/null > /tmp/_curr_cron
  cat /tmp/_curr_cron "$NEW_PATH/backend/scripts/cron-backup.crontab" | crontab -
  COUNT=$(crontab -l | grep -c "CRON_BACKUP_v1" || echo 0)
  log "  ✓ installed cron entries — total CRON_BACKUP_v1 lines: $COUNT"
else
  log "  - cron-backup.crontab not found in new path (skipping)"
fi

# ─── Step 9: Verify cron CAN fire from new location ───────────────────────────
log ""
log "── Step 9: Cron FDA inheritance test from new location ──"
TEST_LOG="$NEW_PATH/.scratch/cron-fda-test.log"
(crontab -l 2>/dev/null; echo "* * * * * date '+[%Y-%m-%d %H:%M:%S] CRON_FDA_TEST_NEW_LOCATION FIRED' >> $TEST_LOG") | crontab -
log "  ✓ added test entry — wait 65 sec for cron to fire it"
log "  ✓ then check: tail $TEST_LOG"
log "  ✓ if log gets a line → cron works from new location → autopilots are real"
log "  ✓ if log stays empty → deeper macOS issue → escalate"

# ─── Step 10: Wait + verify ───────────────────────────────────────────────────
log ""
log "── Step 10: Waiting 65 sec for cron test to fire ──"
sleep 65
if [[ -f "$TEST_LOG" ]]; then
  log "  ✅ CRON FIRED FROM NEW LOCATION:"
  tail -2 "$TEST_LOG" | sed 's/^/    /'
  log ""
  log "  Removing test entry (was diagnostic only)..."
  crontab -l 2>/dev/null | grep -v "CRON_FDA_TEST_NEW_LOCATION" | crontab -
  log "  ✓ test entry removed — only CRON_BACKUP_v1 entries remain"
else
  log "  ❌ CRON DID NOT FIRE — Projects folder may also be restricted"
  log "      Try: System Settings → Privacy & Security → Full Disk Access → grant /usr/sbin/cron"
  log "      OR escalate to a different non-protected location (e.g. ~/Code/)"
fi

# ─── Step 11: Final state ─────────────────────────────────────────────────────
log ""
log "═══════════════════════════════════════════════════════════════"
log "RELOCATION COMPLETE"
log "═══════════════════════════════════════════════════════════════"
log ""
log "  Old: $OLD_PATH (now empty — directory removed)"
log "  New: $NEW_PATH"
log ""
log "  LaunchAgents (should all show pid != - and exit 0):"
launchctl list | grep com.motel666 | sed 's/^/    /'
log ""
log "  Cron entries (should show 6 CRON_BACKUP_v1 lines):"
crontab -l 2>/dev/null | grep -c "CRON_BACKUP_v1" | sed 's/^/    count: /'
log ""
log "  NEXT STEPS for operator:"
log "    1. cd $NEW_PATH"
log "    2. Open /status — verify all 4 background processes show GREEN"
log "    3. Tap export-to-scratch"
log "    4. Ask Claude 'check' to verify state"
log ""
log "  Full log saved to: $LOG"
