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
  rc=$?
  echo "[$(ts)] AUTOPILOT audit-nightly FAILED (exit $rc)" >> "$LOG"
fi

# 2026-06-21 Phase G1-Readiness-Autopilot-1A — read-only daily print of G1 corpus readiness
# (clean-night count toward the ~06-25 freeze lift). Same logic as the /status card + CLI
# (backend/pipeline/shared/g1Readiness.js). Informational; never fails the audit.
echo "[$(ts)] G1 readiness:" >> "$LOG"
node scripts/g1ReadinessCheck.js >> "$LOG" 2>&1 || echo "[$(ts)] g1ReadinessCheck errored (non-fatal)" >> "$LOG"
