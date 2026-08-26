# MIGRATION RUNBOOK — Mac laptop → edge-motel666 (DigitalOcean NYC1, Ubuntu 24.04)
**2026-08-26 · authored by CB · NOTHING in this document executes itself. §1-§5 can run any
evening (safe, additive — the VPS runs warm with services DISABLED). §6 (CUTOVER) runs ONLY
with CA + operator together, a MORNING before the lock window (zero product nights lost).
Exactly-one-writer is the law: the Mac's jobs die BEFORE the VPS's start.**

Facts this runbook assumes (verified in repo 2026-08-26): branch `stable-nba-engine` ·
remote `git@github.com:helenkellerseesall/betting-dashboard.git` · secrets at `backend/.env`
(operator-moved, never through chats) · gitignored data class = `backend/runtime/` +
`backend/data/` (~4 GB) + `backend/snapshot*.json` · backend port 4000 · scheduler scripts
hardcode `/Users/andrewmoore/Projects/betting-dashboard` (55 sites) — §2 makes that path
REAL on the VPS via symlink (deliberate wart; REPO_ROOT refactor queued post-cutover).

---
## §1 — Base install (VPS, as root)
```
apt-get update && apt-get install -y git curl rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version   # expect v22.x
timedatectl set-timezone America/New_York
```

## §2 — Clone + the path shim
```
mkdir -p /opt
git clone git@github.com:helenkellerseesall/betting-dashboard.git /opt/betting-dashboard
cd /opt/betting-dashboard && git checkout stable-nba-engine
mkdir -p /Users/andrewmoore/Projects
ln -s /opt/betting-dashboard /Users/andrewmoore/Projects/betting-dashboard
cd /opt/betting-dashboard/backend && npm install --omit=dev
```
If the clone asks for auth: first do §3 (deploy key), then retry.

## §3 — GitHub deploy key (write access — receipts push themselves; retires the push fence)
```
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -C "edge-motel666-deploy"
cat /root/.ssh/id_ed25519.pub
```
Operator: GitHub → repo → Settings → Deploy keys → Add — paste the line above, CHECK
"Allow write access". (Revocation = delete that key on GitHub; single-purpose.)
Then on the VPS: `ssh -T git@github.com` (expect the success banner).

## §4 — Secrets + data (OPERATOR runs these from the MAC — the only two transfer steps)
```
scp /Users/andrewmoore/Projects/betting-dashboard/backend/.env  root@<VPS_IP>:/opt/betting-dashboard/backend/.env
rsync -az --info=progress2 /Users/andrewmoore/Projects/betting-dashboard/backend/runtime/  root@<VPS_IP>:/opt/betting-dashboard/backend/runtime/
rsync -az --info=progress2 /Users/andrewmoore/Projects/betting-dashboard/backend/data/     root@<VPS_IP>:/opt/betting-dashboard/backend/data/
rsync -az /Users/andrewmoore/Projects/betting-dashboard/backend/snapshot-mlb.json /Users/andrewmoore/Projects/betting-dashboard/backend/snapshot.json  root@<VPS_IP>:/opt/betting-dashboard/backend/ 2>/dev/null
```
`<VPS_IP>` = the droplet's public IPv4. The ~4 GB data rsync runs once here (pre-cutover);
§6 re-runs it briefly for the final delta. `.env` NEVER rides git, chats, or logs.

## §5 — Install units WITHOUT enabling writes (warm, safe)
```
cd /opt/betting-dashboard
cp deploy/systemd/betting-backend.service deploy/systemd/betting-scheduler.service deploy/systemd/betting-deploy.service deploy/systemd/betting-deploy.timer deploy/systemd/betting-grading.service deploy/systemd/betting-grading.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start betting-backend        # start ONCE, no enable — smoke test only
curl -s http://127.0.0.1:4000/api/ws/version   # expect commit json
systemctl stop betting-backend         # STOP — the Mac is still the writer
```
cloudflared (install now, connect at cutover):
```
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && dpkg -i /tmp/cf.deb
```

## §6 — CUTOVER (CA + operator together, MORNING, ~20 minutes)
Order is the whole point. Do not reorder.
1. **Freeze the Mac (operator, on the Mac):**
```
for A in backend scheduler grading-nightly audit-nightly populator-chain slate-mlb-hourly slate-nba-30min; do
  launchctl bootout gui/$(id -u)/com.motel666.$A 2>/dev/null && echo "unloaded $A"
done
launchctl list | grep motel666   # MUST print NOTHING — a surviving grading-nightly
                                 # would split-brain the graded RECORD at 4 AM
```
2. **Final receipts push (Mac):** `cd ~/Projects/betting-dashboard && git add -A docs/ && git commit -m "cutover: final Mac receipts" ; git push origin stable-nba-engine`
3. **Final data delta (operator, Mac):** re-run BOTH rsync lines from §4 (fast now).
4. **Start the VPS writer (VPS):**
```
systemctl enable --now betting-backend betting-scheduler betting-deploy.timer betting-grading.timer
```
5. **Verify (VPS) — all three must pass before touching the tunnel:**
```
curl -s http://127.0.0.1:4000/api/ws/version          # commit == origin HEAD (vintage)
cat /opt/betting-dashboard/backend/runtime/tracking/scheduler_heartbeat.json   # heartbeat fresh, loadedSha==diskSha
curl -s "http://127.0.0.1:4000/api/ws/daily3" | head -c 200                   # serve lens
```
6. **Repoint the tunnel (operator — token is operator-only):** Cloudflare dashboard →
Zero Trust → Tunnels → the edge.motel666.com tunnel → install connector on the VPS:
`cloudflared service install <TUNNEL_TOKEN_PLACEHOLDER>` then delete/disable the Mac
connector. CF Access rules + the /daily3 public app are untouched (they sit on the
hostname, not the connector).
7. **End-to-end (CA, Chrome):** https://edge.motel666.com/m/ renders TONIGHT; /api/ws/version
shows the VPS commit; operator phone check.
8. **Leave the Mac jobs unloaded forever.** The Mac is now dev workspace + CA's verification
client. (Optional later hygiene: `rm ~/Library/LaunchAgents/com.motel666.{backend,scheduler}.plist`.)

## §7 — Day-2 truths
- Deploys: land on origin → VPS pulls within 5 min → restarts only on code-path change
  (#29 rules; receipts never bounce services). Watchdogs #27/#29 run unchanged (the
  scheduler + healthcheck scripts are host-portable as of this pack).
- Self-heal: the per-cycle serve-lens probe + restartBackend.sh work on the VPS via its
  systemctl branch. systemd itself is the first line (Restart=always, boot-time start —
  the class that killed the Mac twice cannot occur: no login session is needed).
- Rollback (first week): stop VPS services + disable the VPS tunnel connector, re-enable
  the Mac connector, `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/...` both plists,
  rsync runtime/ BACK Mac-ward. Same exactly-one-writer ordering, reversed.
- Logs: `journalctl -u betting-backend -S -1h` (ISO stamps come from the app itself).
