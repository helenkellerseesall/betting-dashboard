#!/usr/bin/env bash
# slate-mlb.sh — MLB slate refresh (hourly 9 AM - 11 PM ET)
set +u
cd /Users/andrewmoore/Projects/betting-dashboard/backend || exit 1
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot.log
mkdir -p "$(dirname "$LOG")"
ts() { TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET'; }
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

echo "[$(ts)] AUTOPILOT slate-mlb starting" >> "$LOG"
if npm run slate:mlb >> "$LOG" 2>&1; then
  echo "[$(ts)] AUTOPILOT slate-mlb OK" >> "$LOG"
else
  echo "[$(ts)] AUTOPILOT slate-mlb FAILED (exit $?)" >> "$LOG"
fi
