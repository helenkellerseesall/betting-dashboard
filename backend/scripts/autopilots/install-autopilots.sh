#!/usr/bin/env bash
# install-autopilots.sh — Phase Cron-To-LaunchAgent-1A
# Installs all 5 autopilot LaunchAgents into ~/Library/LaunchAgents/ and loads them.
# Replaces broken cron entries (cron child shells don't inherit FDA on macOS).
set -e

SRC_DIR="/Users/andrewmoore/Projects/betting-dashboard/backend/scripts/autopilots"
DST_DIR="$HOME/Library/LaunchAgents"

# M1 (2026-06-23): populator-chain RETIRED (Law 1) — its 5 npm targets never existed; the populators
# run season-gated from scheduler.sh (sole owner). Removed from install; unload any running instance:
#   launchctl bootout gui/$(id -u)/com.motel666.populator-chain
PLISTS=(
  "com.motel666.grading-nightly.plist"
  "com.motel666.audit-nightly.plist"
  "com.motel666.slate-mlb-hourly.plist"
  "com.motel666.slate-nba-30min.plist"
)

mkdir -p "$DST_DIR"

echo "=== Installing 5 autopilot LaunchAgents ==="
echo ""

for plist in "${PLISTS[@]}"; do
  SRC="$SRC_DIR/$plist"
  DST="$DST_DIR/$plist"
  LABEL="${plist%.plist}"

  if [ ! -f "$SRC" ]; then
    echo "MISSING source: $SRC"
    exit 1
  fi

  # Unload first if already loaded (idempotent re-install)
  launchctl unload "$DST" 2>/dev/null || true

  # Copy plist into LaunchAgents dir
  cp "$SRC" "$DST"
  echo "  installed: $plist"

  # Load it
  if launchctl load "$DST"; then
    echo "  loaded:    $LABEL"
  else
    echo "  FAILED to load $LABEL"
    exit 1
  fi
  echo ""
done

echo "=== Verification: launchctl list | grep com.motel666 ==="
launchctl list | grep com.motel666 || echo "  (none found — install failed)"

echo ""
echo "=== Done. Autopilots will fire at their scheduled times. ==="
echo "  populators:      run from scheduler.sh 3:05-3:25 AM (sole owner; populator-chain RETIRED)"
echo "  grading-nightly: 4:00 AM daily"
echo "  audit-nightly:   5:00 AM daily"
echo "  slate-mlb:       :00 of hours 9-23 ET (15/day)"
echo "  slate-nba:       :00 and :30 of hours 16-23 ET (16/day)"
echo ""
echo "Logs: /Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot-*.log"
