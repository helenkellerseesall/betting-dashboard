#!/bin/bash
# vps-deploy-pull.sh — the VPS's 5-minute deploy loop (fired by
# betting-deploy.timer). Doctrine:
#   1. PUSH FIRST: the VPS's own auto-commits (receipts, exam artifacts) go to
#      origin so the hub is always current and the Mac workspace can pull —
#      this retires the operator's push-fence chore.
#   2. PULL --ff-only: the VPS never merges; if origin diverged, it alarms
#      and waits for a human (divergence means someone force-pushed or the
#      exactly-one-writer rule broke — never auto-resolve that).
#   3. RESTART ON CODE CHANGE ONLY: the changed-path rules MIRROR watchdog #29
#      (backend/ + frontend/ minus runtime/, .scratch/, g2_validation.json,
#      market_prior_w.json) so receipts commits never bounce services.
#      scheduler-script changes restart the scheduler; anything else in the
#      code class restarts the backend (which serves the FE from disk).
# Logs: journalctl -u betting-deploy
set -u
REPO=/Users/andrewmoore/Projects/betting-dashboard
BRANCH=stable-nba-engine
cd "$REPO" || exit 1

# stale-lock hygiene (same 10-min rule as the scheduler's auto-commits)
for LCK in .git/index.lock .git/HEAD.lock; do
  if [ -f "$LCK" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$LCK" 2>/dev/null || echo 0) ))
    [ "$AGE" -gt 600 ] && rm -f "$LCK" && echo "deploy: cleared stale $(basename "$LCK") (${AGE}s)"
  fi
done

# 1. push our own receipts/artifacts (no-op when nothing local)
git push origin "$BRANCH" 2>&1 | tail -1

# 2. fetch + ff-only
git fetch origin "$BRANCH" 2>&1 | tail -1
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  echo "deploy: DIVERGENCE — local $LOCAL not ancestor of origin $REMOTE; HUMAN NEEDED (exactly-one-writer may have broken)"
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] DEPLOY DIVERGENCE local=$LOCAL origin=$REMOTE — human needed" >> "$REPO/backend/runtime/audits/drift_alerts.log"
  exit 1
fi
git pull --ff-only origin "$BRANCH" 2>&1 | tail -2

# 3. restart only what the change class demands (#29 path rules)
CHANGED=$(git diff --name-only "$LOCAL"..HEAD -- backend/ frontend/ ":(exclude)backend/runtime/" ":(exclude)backend/.scratch/" ":(exclude)backend/config/g2_validation.json" ":(exclude)backend/config/market_prior_w.json")
if [ -z "$CHANGED" ]; then
  echo "deploy: $LOCAL -> $(git rev-parse --short HEAD) — receipts/docs only, no restart"
  exit 0
fi
echo "deploy: code change ($(echo "$CHANGED" | wc -l) files) — restarting services"
if echo "$CHANGED" | grep -qE "^backend/scripts/(scheduler\.sh|restartBackend\.sh)"; then
  systemctl restart betting-scheduler
  echo "deploy: betting-scheduler restarted (scheduler script changed)"
fi
systemctl restart betting-backend
echo "deploy: betting-backend restarted -> $(git rev-parse --short HEAD)"
