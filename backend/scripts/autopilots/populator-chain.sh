#!/usr/bin/env bash
# populator-chain.sh — fires 5 populators in sequence (3:05 AM daily)
# Wrapped by com.motel666.populator-chain.plist
# All output appends to .scratch/autopilot.log with timestamps.

set +u  # don't crash on unset vars

cd /Users/andrewmoore/Projects/betting-dashboard/backend || exit 1
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot.log
mkdir -p "$(dirname "$LOG")"

ts() { TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET'; }
echo "[$(ts)] AUTOPILOT populator-chain starting" >> "$LOG"

# Ensure node + npm on PATH (LaunchAgent's PATH is minimal)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

run_step() {
  local name="$1"
  local cmd="$2"
  echo "[$(ts)]   populator-chain step: $name" >> "$LOG"
  if eval "$cmd" >> "$LOG" 2>&1; then
    echo "[$(ts)]   populator-chain step OK: $name" >> "$LOG"
  else
    local rc=$?
    echo "[$(ts)]   populator-chain step FAILED (exit $rc): $name" >> "$LOG"
  fi
}

run_step "populate:mlb-batter-stats"     "npm run populate:mlb-batter-stats"
run_step "populate:mlb-batter-game-logs" "npm run populate:mlb-batter-game-logs"
run_step "populate:mlb-pitcher-game-logs" "npm run populate:mlb-pitcher-game-logs"
run_step "derive:nba-dvp"                "npm run derive:nba-dvp"
run_step "populate:nba-team-stats"       "npm run populate:nba-team-stats"

echo "[$(ts)] AUTOPILOT populator-chain finished" >> "$LOG"
