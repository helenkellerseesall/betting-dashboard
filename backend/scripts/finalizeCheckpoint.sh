#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# finalizeCheckpoint.sh — Session K
#
# Finalizes a pending checkpoint prepared by checkpointRepo.js.
# Run from macOS terminal only — requires native fs access to remove lock files.
#
# Usage:
#   cd ~/Desktop/betting-dashboard
#   bash scripts/finalizeCheckpoint.sh
#
# What this does:
#   1. Reads .checkpoint/pending.json for commit message + metadata
#   2. Detects and safely removes STALE lock files (age > STALE_THRESHOLD seconds)
#   3. Refuses to remove ACTIVE locks (another git process may be running)
#   4. Runs git add -A
#   5. Runs git commit with the prepared message
#   6. Reports the commit hash
#   7. Removes .checkpoint/pending.json on success
#
# What this does NOT do:
#   - Does NOT force-remove active locks
#   - Does NOT auto-push
#   - Does NOT rebase or alter history
#   - Does NOT run if no pending checkpoint exists
#
# Lock safety:
#   A lock is only removed if its mtime is older than STALE_THRESHOLD seconds
#   AND no git process is currently running (pgrep -x git).
#   Both conditions must be satisfied.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

STALE_THRESHOLD=60   # seconds — locks older than this are eligible for removal
CKPT_FILE=".checkpoint/pending.json"
LOCK_FILES=(".git/index.lock" ".git/HEAD.lock")

# ── Locate repo root ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_DIR"

echo ""
echo "── Checkpoint Finalize ─────────────────────────────────"
echo "  Repo: $REPO_DIR"
echo ""

# ── Require pending checkpoint ────────────────────────────────────────────────

if [ ! -f "$CKPT_FILE" ]; then
  echo "ERROR: No pending checkpoint at $CKPT_FILE"
  echo ""
  echo "  Prepare one first:"
  echo "    node scripts/checkpointRepo.js \"your commit message\""
  echo ""
  exit 1
fi

# Extract fields using node (already required for this repo)
# Guard: discarded tombstone
DISCARDED=$(node -e "const d=require('./${CKPT_FILE}'); process.stdout.write(d.discarded?'yes':'no')" 2>/dev/null || echo "no")
if [ "$DISCARDED" = "yes" ]; then
  echo "ERROR: Checkpoint was discarded. Nothing to finalize."
  echo "       Remove with: rm $CKPT_FILE"
  exit 1
fi

COMMIT_MSG=$(node -e "process.stdout.write(require('./${CKPT_FILE}').message)")
TIMESTAMP=$(node  -e "process.stdout.write(require('./${CKPT_FILE}').timestamp)")
BRANCH=$(node     -e "process.stdout.write(require('./${CKPT_FILE}').branch || '')")

echo "  Checkpoint: $TIMESTAMP"
echo "  Branch:     $BRANCH"
echo "  Message:    \"$COMMIT_MSG\""
echo ""

# ── Verify we're on the expected branch ──────────────────────────────────────

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ] && [ -n "$BRANCH" ]; then
  echo "WARNING: Current branch ($CURRENT_BRANCH) differs from checkpoint branch ($BRANCH)."
  echo "         Proceeding — verify this is intentional."
  echo ""
fi

# ── Stale lock detection and removal ─────────────────────────────────────────

# Check for active git processes first (macOS pgrep)
GIT_RUNNING=0
if pgrep -x "git" > /dev/null 2>&1; then
  GIT_RUNNING=1
fi

for LOCK_FILE in "${LOCK_FILES[@]}"; do
  if [ -f "$LOCK_FILE" ]; then

    # Get mtime (macOS stat syntax)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      MTIME=$(stat -f %m "$LOCK_FILE" 2>/dev/null || echo "0")
    else
      MTIME=$(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "0")
    fi

    NOW=$(date +%s)
    AGE=$(( NOW - MTIME ))

    if [ "$GIT_RUNNING" -eq 1 ]; then
      echo "ERROR: A git process is currently running."
      echo "       Lock $LOCK_FILE is ${AGE}s old but git is active."
      echo "       Wait for the git process to finish, then retry."
      echo ""
      exit 1
    fi

    if [ "$AGE" -gt "$STALE_THRESHOLD" ]; then
      echo "  Removing stale lock (${AGE}s old): $LOCK_FILE"
      rm "$LOCK_FILE"
    else
      echo "ERROR: Lock $LOCK_FILE is only ${AGE}s old (threshold: ${STALE_THRESHOLD}s)."
      echo "       Could be an active git operation. Wait and retry."
      echo "       (If certain this is stale, remove manually: rm $LOCK_FILE)"
      echo ""
      exit 1
    fi
  fi
done

# ── Stage + commit ────────────────────────────────────────────────────────────

echo "  Staging all changes..."
git add -A

# Check if there's actually anything to commit
if git diff --cached --quiet; then
  echo ""
  echo "  Nothing to commit (working tree clean)."
  rm -f "$CKPT_FILE"
  echo "  Checkpoint cleared."
  echo "────────────────────────────────────────────────────────"
  echo ""
  exit 0
fi

echo "  Committing..."
git commit -m "$COMMIT_MSG"

HASH=$(git rev-parse HEAD)

echo ""
echo "✓ Committed: $HASH"
echo ""

# Show what just happened
echo "  Recent log:"
git log --oneline -3 | sed 's/^/    /'
echo ""

# ── Cleanup ───────────────────────────────────────────────────────────────────

rm -f "$CKPT_FILE"
echo "✓ Checkpoint cleared: $CKPT_FILE"
echo "────────────────────────────────────────────────────────"
echo ""
echo "  TERM 1 restart: check CURRENT_STATE.md for guidance"
echo "  Next: git push origin $(git rev-parse --abbrev-ref HEAD)  (if ready)"
echo ""
