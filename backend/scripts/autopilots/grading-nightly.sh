#!/usr/bin/env bash
# grading-nightly.sh — refreshes calibration corpus (4:00 AM daily)
set +u
cd /Users/andrewmoore/Projects/betting-dashboard/backend || exit 1
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot.log
mkdir -p "$(dirname "$LOG")"
ts() { TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET'; }
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

echo "[$(ts)] AUTOPILOT grading-nightly starting" >> "$LOG"
if npm run grading:backfill-all >> "$LOG" 2>&1; then
  echo "[$(ts)] AUTOPILOT grading-nightly OK — calibration corpus refreshed" >> "$LOG"
else
  echo "[$(ts)] AUTOPILOT grading-nightly FAILED (exit $?)" >> "$LOG"
fi
