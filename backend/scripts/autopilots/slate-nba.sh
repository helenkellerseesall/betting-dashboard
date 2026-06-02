#!/usr/bin/env bash
# slate-nba.sh — NBA slate refresh (every 30 min, 4 PM - 11:30 PM ET)
set +u
cd /Users/andrewmoore/Projects/betting-dashboard/backend || exit 1
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot.log
mkdir -p "$(dirname "$LOG")"
ts() { TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET'; }
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

echo "[$(ts)] AUTOPILOT slate-nba starting" >> "$LOG"
if npm run slate:nba >> "$LOG" 2>&1; then
  echo "[$(ts)] AUTOPILOT slate-nba OK" >> "$LOG"
else
  echo "[$(ts)] AUTOPILOT slate-nba FAILED (exit $?)" >> "$LOG"
fi
