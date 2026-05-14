#!/usr/bin/env bash
# engineStart.sh — Phase Operator-Operations-1 (2026-05-14)
#
# Canonical operator entrypoint to start the backend on port 4000.
# Lightweight, transparent, additive. Does NOT auto-kill — refuses to
# start if port is occupied and points the operator to engine:restart.
#
# This is a thin wrapper, not orchestration. The operator still sees the
# full Node boot log inline. exec() so signals propagate to node correctly.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[engine:start] === Phase Operator-Operations-1 ==="
echo "[engine:start] backend dir : $BACKEND_DIR"

# Check port 4000 — refuse to overwrite an existing process.
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PID=$(lsof -ti tcp:4000 2>/dev/null || true)
  if [ -n "$EXISTING_PID" ]; then
    echo "[engine:start] ERROR: port 4000 already in use by PID(s): $EXISTING_PID"
    echo "[engine:start]   - Run \`npm run engine:status\` to inspect"
    echo "[engine:start]   - Run \`npm run engine:restart\` to kill + restart"
    exit 1
  fi
  echo "[engine:start] port 4000: clear"
else
  echo "[engine:start] (lsof not available — port check skipped; operator must confirm port 4000 is free)"
fi

echo "[engine:start] launching: node $BACKEND_DIR/server.js"
echo "[engine:start] (boot log follows; Ctrl-C to stop)"
echo

cd "$BACKEND_DIR"
exec node server.js
