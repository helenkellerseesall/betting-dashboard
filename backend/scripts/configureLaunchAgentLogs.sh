#!/usr/bin/env bash
# configureLaunchAgentLogs.sh
#
# Adds StandardErrorPath + StandardOutPath to each motel666 LaunchAgent plist
# so deepAudit can scrub backend / scheduler / cloudflared / caffeinate stderr
# for error patterns. Idempotent: safe to re-run.
#
# Uses PlistBuddy (macOS native, no install required) to mutate the plist XML
# cleanly without breaking the existing keys.
#
# Backs up each plist to <plist>.bak.YYYY-MM-DDTHH-MM-SS before editing.
# Reloads each agent after editing so the new redirect takes effect.
#
# Usage: bash backend/scripts/configureLaunchAgentLogs.sh
# After this, run:  node backend/scripts/deepAudit.js
# Section 6 LAUNCHAGENT LOG SCRUBBING will now read real log content.

set -u

LOG_DIR="$HOME/Library/Logs"
PLIST_DIR="$HOME/Library/LaunchAgents"
TS=$(date '+%Y-%m-%dT%H-%M-%S')

AGENTS=(
  "com.motel666.backend"
  "com.motel666.scheduler"
  "com.motel666.cloudflared"
  "com.motel666.caffeinate"
)

mkdir -p "$LOG_DIR"
echo "Log directory: $LOG_DIR"
echo "Plist directory: $PLIST_DIR"
echo

errors=0
configured=0
skipped=0

for label in "${AGENTS[@]}"; do
  plist="$PLIST_DIR/${label}.plist"
  err_path="$LOG_DIR/${label}.err"
  out_path="$LOG_DIR/${label}.out"

  echo "=== ${label} ==="

  if [[ ! -f "$plist" ]]; then
    echo "  ⚠ plist not found at $plist — skipping (LaunchAgent may not be installed)"
    skipped=$((skipped + 1))
    continue
  fi

  # Backup the plist before any modification
  cp "$plist" "${plist}.bak.${TS}"
  echo "  ✓ backed up to ${plist}.bak.${TS}"

  # Use PlistBuddy to read existing values (returns nothing if key absent)
  existing_err=$(/usr/libexec/PlistBuddy -c "Print :StandardErrorPath" "$plist" 2>/dev/null || true)
  existing_out=$(/usr/libexec/PlistBuddy -c "Print :StandardOutPath" "$plist" 2>/dev/null || true)

  if [[ "$existing_err" == "$err_path" && "$existing_out" == "$out_path" ]]; then
    echo "  ✓ already configured (err=$existing_err, out=$existing_out)"
    skipped=$((skipped + 1))
    continue
  fi

  # Set or update each key. PlistBuddy "Set" fails if key absent; "Add" fails
  # if present. So we try Set first, fall back to Add.
  for key in StandardErrorPath StandardOutPath; do
    if [[ "$key" == "StandardErrorPath" ]]; then val="$err_path"; else val="$out_path"; fi
    /usr/libexec/PlistBuddy -c "Set :${key} '${val}'" "$plist" 2>/dev/null \
      || /usr/libexec/PlistBuddy -c "Add :${key} string '${val}'" "$plist"
  done

  echo "  ✓ set StandardErrorPath = $err_path"
  echo "  ✓ set StandardOutPath   = $out_path"

  # Reload the agent so the new redirect takes effect
  if launchctl kickstart -k "gui/$UID/${label}" 2>/dev/null; then
    echo "  ✓ launchctl kickstart -k succeeded"
  else
    echo "  ⚠ launchctl kickstart failed (agent may not be loaded — try: launchctl load $plist)"
    errors=$((errors + 1))
  fi

  configured=$((configured + 1))
  echo
done

echo "=== SUMMARY ==="
echo "Configured: $configured"
echo "Skipped:    $skipped"
echo "Errors:     $errors"
echo
echo "Verify with:"
echo "  ls -la $LOG_DIR/com.motel666.*.{err,out}"
echo "  node /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/deepAudit.js | sed -n '/LAUNCHAGENT/,/===/p'"

exit $errors
