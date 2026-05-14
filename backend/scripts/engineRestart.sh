#!/usr/bin/env bash
# engineRestart.sh — Phase Operator-Operations-1 (2026-05-14)
#
# Canonical operator entrypoint to kill + restart the backend on port 4000.
#
# DESIGN PRINCIPLES (per operator instruction):
#   - DO NOT auto-kill silently
#   - PRINT every PID before killing it
#   - VERIFY port clear before exec()
#   - exec() into node so signals propagate
#   - operator sees the full boot log inline
#
# This is the canonical replacement for the embedded shell snippet:
#   (lsof -ti tcp:4000 | xargs -r kill -9; sleep 2; ...); node backend/server.js

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[engine:restart] === Phase Operator-Operations-1 ==="
echo "[engine:restart] backend dir : $BACKEND_DIR"
echo

# ── Phase 1: identify ────────────────────────────────────────────────────────
echo "[engine:restart] === Phase 1: identify process(es) on port 4000 ==="
if ! command -v lsof >/dev/null 2>&1; then
  echo "[engine:restart] ERROR: lsof not available — cannot identify processes on port 4000"
  echo "[engine:restart] Run manually: pkill -f 'node.*server\\.js' (use with caution)"
  exit 1
fi

PIDS=$(lsof -ti tcp:4000 2>/dev/null || true)
if [ -z "$PIDS" ]; then
  echo "[engine:restart] port 4000: clear (nothing to kill)"
else
  echo "[engine:restart] found PID(s) on port 4000:"
  for p in $PIDS; do
    # Show what each PID is so the operator can confirm before killing.
    if command -v ps >/dev/null 2>&1; then
      ps -p "$p" -o pid,user,etime,command 2>/dev/null | tail -n +1
    else
      echo "  $p"
    fi
  done
  echo
  echo "[engine:restart] === Phase 2: kill -9 PID(s) ==="
  echo "[engine:restart] killing: $PIDS"
  echo "$PIDS" | xargs -r kill -9
  sleep 2
fi

# ── Phase 3: verify ──────────────────────────────────────────────────────────
echo
echo "[engine:restart] === Phase 3: verify port clear ==="
REMAINING=$(lsof -ti tcp:4000 2>/dev/null || true)
if [ -n "$REMAINING" ]; then
  echo "[engine:restart] ERROR: port 4000 still in use after kill: $REMAINING"
  echo "[engine:restart] inspect with: lsof -i tcp:4000"
  exit 1
fi
echo "[engine:restart] port 4000: confirmed clear"
echo

# ── Phase 4: start ───────────────────────────────────────────────────────────
echo "[engine:restart] === Phase 4: launch backend ==="
echo "[engine:restart] launching: node $BACKEND_DIR/server.js"
echo "[engine:restart] (boot log follows; Ctrl-C to stop)"
echo

cd "$BACKEND_DIR"
exec node server.js
