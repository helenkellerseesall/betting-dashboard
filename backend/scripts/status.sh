#!/bin/bash
# status.sh — autonomy health check (Lane Autonomy v1, 2026-05-28)
#
# Purpose: one-command snapshot of the entire betting-dashboard runtime so
# operator can verify nothing's silently broken. Run anytime.
#
# Sections:
#   1. Process aliveness    (caffeinate, backend, scheduler, tunnel)
#   2. Capture loop liveness (last CLV tick within 7 min = green)
#   3. Today's slate state  (file mtime, pick counts, marketKey coverage)
#   4. Today's CLV state    (captured / total, ledger mirror count)
#   5. Last scheduler firings
#   6. Last few backend errors (if any)
#
# Output: stdout + .scratch/status.log (overwritten each run, so Claude can
# read latest state via Read tool).
#
# Usage:
#   bash /Users/andrewmoore/Desktop/betting-dashboard/backend/scripts/status.sh
#
# Exit code: always 0 (informational). Use the visual ✓/✗ markers to spot
# problems.

set -u

REPO=/Users/andrewmoore/Desktop/betting-dashboard
SCRATCH=$REPO/.scratch
LOG=$SCRATCH/status.log
TRACKING=$REPO/backend/runtime/tracking

# Resolve today + yesterday in operator's local time (ET).
TODAY_ET=$(TZ='America/New_York' date +%Y-%m-%d)
YDAY_ET=$(TZ='America/New_York' date -v-1d +%Y-%m-%d 2>/dev/null || TZ='America/New_York' date -d 'yesterday' +%Y-%m-%d)

mkdir -p "$SCRATCH"

# Tee output to both stdout and the log file (overwrite, not append)
exec > >(tee "$LOG") 2>&1

NOW=$(TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S ET')
echo "==========================================================="
echo "  BETTING SYSTEM HEALTH CHECK — $NOW"
echo "==========================================================="
echo ""

# ─── 1. Process aliveness ──────────────────────────────────────────
echo "[1] PROCESS ALIVENESS"
check_proc() {
  local name=$1
  local pattern=$2
  local pid
  pid=$(pgrep -f "$pattern" | head -1)
  if [ -n "$pid" ]; then
    echo "    ✓ $name           pid $pid"
  else
    echo "    ✗ $name           NOT RUNNING"
  fi
}
check_proc "caffeinate     " "/caffeinate( |$)"
check_proc "backend (node) " "node.*server"
check_proc "scheduler.sh   " "scheduler\\.sh"
check_proc "cloudflared    " "cloudflared tunnel"
echo ""

# ─── 1b. Daemon status (which are auto-restarting vs terminal-bound) ──
echo "[1b] AUTONOMY MODE (LaunchAgent vs terminal-bound)"
if launchctl list 2>/dev/null | grep -q "com.motel666.caffeinate"; then
  CAFF_PID=$(launchctl list 2>/dev/null | grep "com.motel666.caffeinate" | awk '{print $1}')
  echo "    ✓ caffeinate is LaunchAgent (auto-restart on death, survives reboot) [launchd pid $CAFF_PID]"
else
  echo "    ✗ caffeinate NOT a LaunchAgent — terminal-bound, dies on Mac restart"
fi
for label in com.motel666.backend com.motel666.scheduler com.motel666.cloudflared; do
  if launchctl list 2>/dev/null | grep -q "$label"; then
    echo "    ✓ $label is LaunchAgent"
  else
    echo "    ✗ $label NOT a LaunchAgent — terminal-bound, dies on Mac restart"
  fi
done
echo ""

# ─── 1c. Sleep prevention diagnostics ─────────────────────────────────
echo "[1c] SLEEP PREVENTION"
if command -v pmset >/dev/null 2>&1; then
  ASSERT=$(pmset -g assertions 2>/dev/null | grep -E "PreventUserIdleSystemSleep|PreventSystemSleep" | head -3)
  if [ -n "$ASSERT" ]; then
    echo "    ✓ active sleep-prevention assertions:"
    echo "$ASSERT" | sed 's/^/      /'
  else
    echo "    ✗ NO sleep-prevention assertions active — Mac will sleep"
  fi
  # Idle sleep timer
  IDLE=$(pmset -g | grep -E "^ *sleep" | awk '{print $2}')
  echo "    Mac idle-sleep timer: ${IDLE:-?} minutes (0 = never)"
else
  echo "    (pmset unavailable — sandbox or non-macOS)"
fi
echo ""

# ─── 2. CLV capture loop liveness ──────────────────────────────────
echo "[2] CLV CAPTURE LOOP"
if [ -f "$SCRATCH/backend.log" ]; then
  # Mtime in seconds since epoch
  LOG_MTIME=$(stat -f %m "$SCRATCH/backend.log" 2>/dev/null || stat -c %Y "$SCRATCH/backend.log")
  NOW_EPOCH=$(date +%s)
  AGE_SEC=$((NOW_EPOCH - LOG_MTIME))
  AGE_MIN=$((AGE_SEC / 60))
  if [ "$AGE_MIN" -lt 7 ]; then
    echo "    ✓ backend.log last write $AGE_MIN min ago (expect <7)"
  else
    echo "    ✗ backend.log last write $AGE_MIN min ago — loop may have stalled"
  fi
  # Last NBA + MLB scans
  LAST_NBA=$(grep -E "captureClosingLines:nba\\] scan" "$SCRATCH/backend.log" | tail -1)
  LAST_MLB=$(grep -E "captureClosingLines:mlb\\] scan" "$SCRATCH/backend.log" | tail -1)
  if [ -n "$LAST_NBA" ]; then echo "    last NBA scan: $LAST_NBA"; fi
  if [ -n "$LAST_MLB" ]; then echo "    last MLB scan: $LAST_MLB"; fi
else
  echo "    ✗ $SCRATCH/backend.log does not exist — backend never started or wrong log path"
fi
echo ""

# ─── 3. Today's slates ─────────────────────────────────────────────
echo "[3] TODAY'S SLATES ($TODAY_ET)"
for sport in nba mlb; do
  FILE="$TRACKING/${sport}_tracked_bets_${TODAY_ET}.json"
  if [ -f "$FILE" ]; then
    SIZE=$(wc -c <"$FILE")
    MTIME=$(stat -f '%Sm' -t '%H:%M' "$FILE" 2>/dev/null || date -d "@$(stat -c %Y "$FILE")" '+%H:%M')
    COUNT=$(python3 -c "import json; d=json.load(open('$FILE')); print(len(d if isinstance(d,list) else d.get('bets',[])))" 2>/dev/null || echo "?")
    MK_COUNT=$(python3 -c "import json; d=json.load(open('$FILE')); bets=d if isinstance(d,list) else d.get('bets',[]); print(sum(1 for b in bets if b.get('marketKey')))" 2>/dev/null || echo "?")
    if [ "$COUNT" != "?" ] && [ "$COUNT" -gt 0 ]; then
      PCT=$(python3 -c "print(f'{100*$MK_COUNT/$COUNT:.1f}')" 2>/dev/null)
      echo "    $(echo $sport | tr a-z A-Z): ✓ $COUNT picks (last write $MTIME ET, ${SIZE}B), marketKey $MK_COUNT/$COUNT = ${PCT}%"
    else
      echo "    $(echo $sport | tr a-z A-Z): ✗ file exists but has 0 picks"
    fi
  else
    echo "    $(echo $sport | tr a-z A-Z): ✗ no tracked_bets file for today — slate didn't run"
  fi
done
echo ""

# ─── 4. Today's CLV capture state ──────────────────────────────────
echo "[4] TODAY'S CLV STATE ($TODAY_ET)"
for sport in nba mlb; do
  FILE="$TRACKING/${sport}_tracked_bets_${TODAY_ET}.json"
  if [ -f "$FILE" ]; then
    python3 <<PYEOF
import json
bets = json.load(open("$FILE"))
bets = bets if isinstance(bets, list) else bets.get("bets", [])
n = len(bets)
with_open = sum(1 for b in bets if b.get("openOdds") not in (None, 0, ""))
with_close = sum(1 for b in bets if b.get("closeOdds") not in (None, 0, ""))
with_clv = sum(1 for b in bets if b.get("clv") is not None)
print(f"    $(echo $sport | tr a-z A-Z): openOdds {with_open}/{n}, closeOdds {with_close}/{n}, clv {with_clv}/{n}")
PYEOF
  fi
done
echo ""

# ─── 5. Last scheduler firings ─────────────────────────────────────
echo "[5] SCHEDULER (last 8 events)"
if [ -f "$SCRATCH/scheduler.log" ]; then
  tail -8 "$SCRATCH/scheduler.log" | sed 's/^/    /'
else
  echo "    (no scheduler.log yet — scheduler hasn't run)"
fi
echo ""

# ─── 6. Recent backend errors ──────────────────────────────────────
echo "[6] RECENT BACKEND ERRORS (last 5)"
if [ -f "$SCRATCH/backend.log" ]; then
  ERR=$(grep -iE 'error|exception|warn.*fail|stack trace|uncaught' "$SCRATCH/backend.log" | tail -5)
  if [ -n "$ERR" ]; then
    echo "$ERR" | sed 's/^/    /'
  else
    echo "    (no recent errors)"
  fi
fi
echo ""

# ─── 7. Personal ledger summary ────────────────────────────────────
echo "[7] PERSONAL LEDGER"
LEDGER="$TRACKING/personal_ledger.json"
if [ -f "$LEDGER" ]; then
  python3 <<PYEOF
import json
from collections import Counter
led = json.load(open("$LEDGER"))
bets = led.get("bets", [])
print(f"    total entries: {len(bets)} (MAX_BETS cap = 2000)")
sport_dist = Counter((b.get("sport") or "?").lower() for b in bets)
print(f"    sport split:   {dict(sport_dist.most_common())}")
today = [b for b in bets if b.get("date") == "$TODAY_ET"]
print(f"    today ($TODAY_ET): {len(today)} entries")
with_close = sum(1 for b in today if (b.get("clvSnapshot") or {}).get("close"))
print(f"    today with clvSnapshot.close: {with_close}")
PYEOF
fi
echo ""

echo "==========================================================="
echo "  END HEALTH CHECK"
echo "==========================================================="
