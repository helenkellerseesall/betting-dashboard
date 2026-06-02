#!/usr/bin/env bash
# audit-nightly.sh — writes daily proof report (5:00 AM daily)
set +u
cd /Users/andrewmoore/Projects/betting-dashboard/backend || exit 1
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot.log
mkdir -p "$(dirname "$LOG")"
ts() { TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET'; }
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

echo "[$(ts)] AUTOPILOT audit-nightly starting" >> "$LOG"
if npm run audit:nightly -- --no-populators --no-grade >> "$LOG" 2>&1; then
  echo "[$(ts)] AUTOPILOT audit-nightly OK — daily proof report written" >> "$LOG"
else
  echo "[$(ts)] AUTOPILOT audit-nightly FAILED (exit $?)" >> "$LOG"
fi
