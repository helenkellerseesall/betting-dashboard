#!/bin/bash
# install-launchagents.sh — one-shot installer for full Path A autonomy.
#
# Installs all four LaunchAgents (caffeinate, backend, scheduler, cloudflared)
# and adds the scripts directory to PATH so `status.sh` works as a bare command.
#
# RE-RUNNABLE — unloads any existing version before re-installing.
#
# Usage:
#   bash /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/install-launchagents.sh
#
# After this runs:
#   - All four daemons are managed by launchd
#   - Auto-start at login, auto-restart on death
#   - Mac restart → 30-second auto-recovery, no terminals needed
#   - status.sh callable from anywhere as just `status.sh`
#
# To verify after install:
#   launchctl list | grep motel666
#   pgrep caffeinate
#   pgrep -f "node.*server"
#   pgrep -f scheduler.sh
#   pgrep -f "cloudflared tunnel"
#
# To uninstall everything:
#   bash /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/install-launchagents.sh uninstall

set -u

REPO=/Users/andrewmoore/Projects/betting-dashboard
SCRIPTS=$REPO/backend/scripts
AGENTS=$HOME/Library/LaunchAgents

ACTION=${1:-install}

unload_one() {
  local label=$1
  local plist=$AGENTS/$label.plist
  if [ -f "$plist" ]; then
    echo "  unloading $label..."
    launchctl unload -w "$plist" 2>/dev/null || true
  fi
}

uninstall_all() {
  echo "=== Uninstalling all motel666 LaunchAgents ==="
  unload_one com.motel666.caffeinate
  unload_one com.motel666.backend
  unload_one com.motel666.scheduler
  unload_one com.motel666.cloudflared
  echo "  killing any leftover processes..."
  pkill caffeinate 2>/dev/null || true
  pkill -f "scheduler.sh" 2>/dev/null || true
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  # Backend kept alive longer — operator may still want graceful shutdown
  echo "  (backend NOT auto-killed — manually: lsof -ti tcp:4000 | xargs kill -9)"
  echo "=== Done. Plists remain in $AGENTS — delete manually if desired ==="
  return 0
}

if [ "$ACTION" = "uninstall" ]; then
  uninstall_all
  exit 0
fi

mkdir -p "$AGENTS"

echo "==========================================================="
echo "  MOTEL666 LAUNCHAGENT INSTALLER"
echo "==========================================================="
echo ""

# Step 1: kill any existing manually-launched instances so launchd has a clean slate
echo "[1/5] Killing any existing manual instances..."
pkill caffeinate 2>/dev/null && echo "  killed manual caffeinate"
pkill -f "scheduler.sh" 2>/dev/null && echo "  killed manual scheduler.sh"
# Backend: refuse to auto-kill — operator's manual TERM 1 may still be running
EXIST_BACKEND=$(lsof -ti tcp:4000 2>/dev/null || true)
if [ -n "$EXIST_BACKEND" ]; then
  echo "  ⚠ port 4000 is in use by pid(s): $EXIST_BACKEND"
  echo "    if this is TERM 1 backend, kill it first: lsof -ti tcp:4000 | xargs kill -9"
  echo "    proceeding anyway — LaunchAgent will fail to start until port is free"
fi
EXIST_TUNNEL=$(pgrep -f "cloudflared tunnel" || true)
if [ -n "$EXIST_TUNNEL" ]; then
  echo "  killing existing tunnel pid(s): $EXIST_TUNNEL"
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  sleep 1
fi
echo ""

# Step 2: unload any previously-installed plists
echo "[2/5] Unloading any previously-installed plists..."
unload_one com.motel666.caffeinate
unload_one com.motel666.backend
unload_one com.motel666.scheduler
unload_one com.motel666.cloudflared
echo ""

# Step 3: copy plists to ~/Library/LaunchAgents
echo "[3/5] Copying plists to $AGENTS..."
for f in com.motel666.caffeinate.plist com.motel666.backend.plist com.motel666.scheduler.plist com.motel666.cloudflared.plist; do
  if [ -f "$SCRIPTS/$f" ]; then
    cp "$SCRIPTS/$f" "$AGENTS/$f"
    echo "  ✓ $f"
  else
    echo "  ✗ MISSING: $SCRIPTS/$f"
  fi
done
echo ""

# Step 4: detect cloudflared binary path — patch plist if needed
echo "[4/5] Detecting cloudflared binary..."
if [ -x /opt/homebrew/bin/cloudflared ]; then
  CF_BIN=/opt/homebrew/bin/cloudflared
elif [ -x /usr/local/bin/cloudflared ]; then
  CF_BIN=/usr/local/bin/cloudflared
  echo "  found cloudflared at /usr/local/bin (Intel Homebrew) — patching plist"
  /usr/bin/sed -i '' 's|/opt/homebrew/bin/cloudflared|/usr/local/bin/cloudflared|' "$AGENTS/com.motel666.cloudflared.plist"
else
  CF_BIN=""
  echo "  ⚠ cloudflared not found in /opt/homebrew/bin or /usr/local/bin"
  echo "    locate with: which cloudflared"
  echo "    then edit $AGENTS/com.motel666.cloudflared.plist manually"
fi
[ -n "$CF_BIN" ] && echo "  ✓ cloudflared: $CF_BIN"
echo ""

# Step 5: load each LaunchAgent
echo "[5/5] Loading LaunchAgents..."
for label in com.motel666.caffeinate com.motel666.backend com.motel666.scheduler com.motel666.cloudflared; do
  plist=$AGENTS/$label.plist
  if [ -f "$plist" ]; then
    if launchctl load -w "$plist" 2>&1; then
      echo "  ✓ loaded $label"
    else
      echo "  ✗ failed to load $label"
    fi
  fi
done
echo ""

# Step 6: PATH addition for status.sh / other scripts
echo "[bonus] PATH update for status.sh..."
if grep -q "betting-dashboard/backend/scripts" "$HOME/.zshrc" 2>/dev/null; then
  echo "  ✓ PATH already includes scripts dir in ~/.zshrc"
else
  echo '' >> "$HOME/.zshrc"
  echo '# motel666 betting-dashboard scripts on PATH (2026-05-28)' >> "$HOME/.zshrc"
  echo 'export PATH="$PATH:/Users/andrewmoore/Projects/betting-dashboard/backend/scripts"' >> "$HOME/.zshrc"
  echo "  ✓ appended PATH export to ~/.zshrc"
  echo "    reload current shell with: source ~/.zshrc"
  echo "    or open a new terminal — then 'status.sh' works as bare command"
fi
echo ""

# Step 7: verification
sleep 3
echo "==========================================================="
echo "  VERIFICATION (5 sec after load)"
echo "==========================================================="
echo ""
echo "launchctl-loaded agents:"
launchctl list | grep motel666 | sed 's/^/  /'
echo ""
echo "process aliveness:"
for name in caffeinate "node.*server" scheduler.sh "cloudflared tunnel"; do
  pid=$(pgrep -f "$name" | head -1)
  if [ -n "$pid" ]; then
    echo "  ✓ $name → pid $pid"
  else
    echo "  ✗ $name → not running (check launchd log)"
  fi
done
echo ""
echo "If anything's ✗, check:"
echo "  tail -20 /Users/andrewmoore/Projects/betting-dashboard/.scratch/caffeinate-launchd.log"
echo "  tail -20 /Users/andrewmoore/Projects/betting-dashboard/.scratch/backend-launchd.log"
echo "  tail -20 /Users/andrewmoore/Projects/betting-dashboard/.scratch/scheduler-launchd.log"
echo "  tail -20 /Users/andrewmoore/Projects/betting-dashboard/.scratch/cloudflared-launchd.log"
echo ""
echo "All set. Mac restart → all four auto-start within 30s of login. No terminals needed."
