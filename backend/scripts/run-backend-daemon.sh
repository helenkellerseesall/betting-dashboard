#!/bin/bash
# run-backend-daemon.sh — wrapper invoked by com.motel666.backend.plist
#
# Why this wrapper exists:
#   launchd does NOT inherit user shell PATH. node may be installed at any
#   of: /usr/local/bin (Homebrew Intel), /opt/homebrew/bin (Homebrew ARM),
#   ~/.nvm/versions/node/*/bin (nvm), or elsewhere. This script normalizes
#   the PATH so node is discoverable, then exec's into server.js.
#
# Logs to backend.log (same path operator tails normally). launchd's
# StandardOutPath duplicates so launchd logs are also captured.

set -u

# Common node install paths — first one that exists wins.
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node/v24.14.0/bin" "$HOME/.nvm/versions/node/v22.18.0/bin" /usr/bin; do
  if [ -x "$p/node" ]; then
    export PATH="$p:${PATH:-}"
    break
  fi
done

BACKEND_DIR=/Users/andrewmoore/Projects/betting-dashboard/backend
LOG=/Users/andrewmoore/Projects/betting-dashboard/.scratch/backend.log
mkdir -p "$(dirname "$LOG")"

cd "$BACKEND_DIR" || {
  echo "[run-backend-daemon] FATAL: cannot cd to $BACKEND_DIR" >&2
  exit 2
}

NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  echo "[run-backend-daemon] FATAL: node not found in PATH (tried Homebrew, nvm, /usr/bin)" >&2
  exit 3
fi

echo "[run-backend-daemon] $(date '+%Y-%m-%d %H:%M:%S') launching node $NODE_BIN server.js" | tee -a "$LOG"

# exec so launchd's KeepAlive sees node's PID directly and signals propagate
exec "$NODE_BIN" server.js 2>&1 | tee -a "$LOG"
