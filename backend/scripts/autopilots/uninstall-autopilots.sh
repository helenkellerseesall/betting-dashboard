#!/usr/bin/env bash
# uninstall-autopilots.sh — Phase Cron-To-LaunchAgent-1A
# Unloads and removes all 5 autopilot LaunchAgents from ~/Library/LaunchAgents/.
set +e

DST_DIR="$HOME/Library/LaunchAgents"

PLISTS=(
  "com.motel666.populator-chain.plist"
  "com.motel666.grading-nightly.plist"
  "com.motel666.audit-nightly.plist"
  "com.motel666.slate-mlb-hourly.plist"
  "com.motel666.slate-nba-30min.plist"
)

echo "=== Uninstalling 5 autopilot LaunchAgents ==="
echo ""

for plist in "${PLISTS[@]}"; do
  DST="$DST_DIR/$plist"
  LABEL="${plist%.plist}"

  if [ -f "$DST" ]; then
    launchctl unload "$DST" 2>/dev/null
    rm -f "$DST"
    echo "  removed: $plist"
  else
    echo "  skipped (not present): $plist"
  fi
done

echo ""
echo "=== Verification: launchctl list | grep com.motel666 ==="
launchctl list | grep com.motel666 || echo "  (none — clean uninstall)"

echo ""
echo "=== Done. Source files remain in backend/scripts/autopilots/. ==="
