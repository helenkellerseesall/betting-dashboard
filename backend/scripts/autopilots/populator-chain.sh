#!/usr/bin/env bash
# populator-chain.sh — RETIRED 2026-06-23 (M1, Law 1: single owner).
#
# This LaunchAgent (com.motel666.populator-chain, 3:05 AM) ran 5 `npm run …` targets that DO NOT
# exist in backend/package.json (derive:nba-dvp, populate:nba-team-stats, populate:mlb-batter-stats,
# populate:mlb-batter-game-logs, populate:mlb-pitcher-game-logs) → every step failed nightly. The
# SAME populators run correctly + season-gated from scheduler.sh (com.motel666.scheduler always-on
# daemon, 3:05–3:25 ET) via the real node scripts:
#   3:05 populateMlbBatterStats.js · 3:10 populateMlbBatterGameLogs.js · 3:15 populateMlbPitcherGameLogs.js
#   3:20 deriveNbaDvP.js · 3:25 populateNbaTeamStats.js   (sport_on gated)
# scheduler.sh is the SOLE populator owner. Repointing this script at the real scripts would create a
# 3:05 DOUBLE-RUN (the parallel-owner class). So this agent is retired: this wrapper is now a no-op and
# the LaunchAgent should be unloaded (see install-autopilots.sh + the operator unload command).

set +u
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/autopilot.log
mkdir -p "$(dirname "$LOG")"
ts() { TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET'; }
echo "[$(ts)] AUTOPILOT populator-chain: RETIRED no-op — scheduler.sh (com.motel666.scheduler) is the sole populator owner (Law 1). Unload this agent." >> "$LOG"
exit 0
