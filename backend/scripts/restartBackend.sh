#!/usr/bin/env bash
# restartBackend.sh
#
# Canonical "actually restart the backend and verify" command. The bare
# launchctl unload/load pattern returns 0 even when it doesn't kill the
# in-flight Node process — that's how a backend can serve old code while
# the chat declares the reload "succeeded." See 2026-05-31 incident.
#
# This script:
#   1. records OLD PID listening on port 4000
#   2. uses `launchctl kickstart -k` to FORCE-restart the agent
#   3. polls until /api/ws/version responds OR 20s timeout
#   4. records NEW PID + commit served, fails loudly if PID didn't change
#
# Usage:  bash backend/scripts/restartBackend.sh

set -u
PLIST="$HOME/Library/LaunchAgents/com.motel666.backend.plist"
LABEL="com.motel666.backend"
PORT=4000

if [[ ! -f "$PLIST" ]]; then
  echo "ERROR: plist not found at $PLIST"
  exit 2
fi

OLD_PID="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}')"
echo "OLD pid on port ${PORT}: ${OLD_PID:-<none>}"

# Force restart. launchctl kickstart -k = kill then start.
launchctl kickstart -k "gui/$UID/${LABEL}" 2>&1 | sed 's/^/launchctl: /'
KICK_RC=$?
echo "launchctl kickstart exit: ${KICK_RC}"

# Poll for the new process responding to /api/ws/version
echo -n "Waiting for new boot"
for i in $(seq 1 20); do
  sleep 1
  echo -n "."
  RESP="$(curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/ws/version" 2>/dev/null || true)"
  if [[ -n "$RESP" ]]; then
    echo
    echo "version endpoint responded:"
    echo "$RESP" | head -c 400
    echo
    break
  fi
done

NEW_PID="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}')"
echo "NEW pid on port ${PORT}: ${NEW_PID:-<none>}"

if [[ -z "$NEW_PID" ]]; then
  echo "FAIL: backend not responding on port ${PORT} after restart"
  echo "Check: launchctl print gui/$UID/${LABEL} | head -40"
  exit 3
fi

if [[ -n "$OLD_PID" && "$OLD_PID" == "$NEW_PID" ]]; then
  echo "WARN: PID unchanged (${NEW_PID}). kickstart may not have killed the process."
  echo "Try: kill -9 ${NEW_PID} && sleep 3 && bash $0"
  exit 4
fi

# If /api/ws/version still 404s, this build doesn't have the endpoint yet.
if [[ -n "$RESP" && "$RESP" == *"Cannot GET /api/ws/version"* ]]; then
  echo "WARN: backend up on NEW pid ${NEW_PID} but /api/ws/version returns 404."
  echo "This means the running code is OLDER than commit 05890bb (the one that added the endpoint)."
  echo "Likely cause: plist points at a different repo path. Inspect:"
  echo "  grep -A1 'WorkingDirectory\\|ProgramArguments' $PLIST"
  exit 5
fi

echo "OK: backend restarted, OLD ${OLD_PID:-<none>} → NEW ${NEW_PID}, version endpoint live"

# 2026-05-31 — post-boot self-check (task #69 self-awareness layer).
# Run sysAudit immediately so any drift introduced by the just-loaded code
# is caught before the operator places real money or runs further work.
# Writes to .scratch/last.txt as the canonical sscope-shared location.
echo
echo "==================================================="
echo "Running post-boot sysAudit (writes to .scratch/last.txt)..."
echo "==================================================="
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node "$REPO_ROOT/backend/scripts/sysAudit.js" > "$REPO_ROOT/.scratch/last.txt" 2>&1
AUDIT_EXIT=$?
# Surface the summary line and exit status
tail -3 "$REPO_ROOT/.scratch/last.txt"
echo "sysAudit exit=$AUDIT_EXIT (0=GREEN, 1=YELLOW, 2=RED)"
if [ "$AUDIT_EXIT" -ge 2 ]; then
  echo "⚠ RED status — review .scratch/last.txt before proceeding"
fi

# 2026-05-31 (g) — post-boot delta check. If this restart was triggered by
# a code change that broke something previously working, the radar fires.
echo
echo "--- auditDeltaCheck (radar) ---"
node "$REPO_ROOT/backend/scripts/auditDeltaCheck.js" 2>&1
DELTA_EXIT=$?
if [ "$DELTA_EXIT" -eq 2 ]; then
  echo "⚠ REGRESSION DETECTED — see backend/runtime/audits/regression_alerts.log"
fi
