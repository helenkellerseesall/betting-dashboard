# Operator Cheat Sheet

Updated 2026-05-29 after Path A full LaunchAgent autonomy. The old TERM 1/2/3/5 layout is obsolete — all four runtime processes are now macOS LaunchAgents managed by launchd.

## Daily autonomy schedule (all ET)

| Time | What | Triggered by |
|---|---|---|
| 8:09 AM | Nightly audit | Cowork scheduled task |
| 9:00 AM | slate:mlb daily | scheduler LaunchAgent |
| 10 AM - 11 PM hourly :00 | slate:mlb refresh | scheduler LaunchAgent |
| 4:00 PM | slate:nba daily | scheduler LaunchAgent |
| 4:30 PM - 11:30 PM every 30 min | slate:nba refresh | scheduler LaunchAgent |
| Every 5 min, 24/7 | CLV capture loop | Backend setInterval |
| Continuous | Cloudflare tunnel | cloudflared LaunchAgent |

Operator sleeps 6 AM - 3 PM ET. MLB slate + audit fire during sleep. Caffeinate -dimsu keeps Mac awake through clamshell-close on AC power.

## What's actually running (autonomous, never needs manual restart)

| Daemon | LaunchAgent label | What it does |
|---|---|---|
| Backend | `com.motel666.backend` | node server.js on port 4000 + CLV capture loop |
| Caffeinate | `com.motel666.caffeinate` | `/usr/bin/caffeinate -dimsu` — blocks all sleep paths |
| Scheduler | `com.motel666.scheduler` | scheduler.sh — fires slate:mlb hourly + slate:nba every 30 min in NBA window |
| Tunnel | `com.motel666.cloudflared` | `cloudflared tunnel run edge` with config from ~/.cloudflared/config.yml |

## Manage daemons (rare — only when a code change requires restart)

```
launchctl list | grep motel666                           # show all loaded
launchctl unload -w ~/Library/LaunchAgents/com.motel666.<name>.plist   # stop
launchctl load   -w ~/Library/LaunchAgents/com.motel666.<name>.plist   # start
```

After any backend code change, restart only the backend daemon:

```
launchctl unload -w ~/Library/LaunchAgents/com.motel666.backend.plist
launchctl load   -w ~/Library/LaunchAgents/com.motel666.backend.plist
```

## Daily check (one command)

```
status.sh
```

Prints process aliveness, LaunchAgent state, sleep prevention, CLV ticks, slate counts, ledger state. If all sections ✓ = autonomy is healthy. If anything ✗, that section tells you what to restart.

## Commit code changes

Run anywhere:

```
cd /Users/andrewmoore/Desktop/betting-dashboard
git add <files>
git commit -m "..."
git push origin stable-nba-engine
```

Then restart backend daemon if the change is backend code.

## Useful diagnostic paths

- Backend log: `/Users/andrewmoore/Desktop/betting-dashboard/.scratch/backend.log`
- Scheduler log: `/Users/andrewmoore/Desktop/betting-dashboard/.scratch/scheduler.log`
- Slate logs: `.scratch/slate-nba.log`, `.scratch/slate-mlb.log`
- LaunchAgent stdout/stderr: `.scratch/{backend,scheduler,cloudflared,caffeinate}-launchd.log`
- Status snapshot: `.scratch/status.log` (overwritten each `status.sh` run)
- Diagnostic dump: `.scratch/last.txt` (Claude reads directly)
- Personal ledger: `/Users/andrewmoore/Desktop/betting-dashboard/backend/runtime/tracking/personal_ledger.json`

## Mac restart recovery

Nothing. All four LaunchAgents auto-load at login. Within 30 seconds the system is back up. Run `status.sh` to confirm.

## Things that break autonomy

- `pkill caffeinate` — caffeinate dies but launchd restarts within 10s (KeepAlive)
- Backend crashes — launchd restarts within 10s
- Network blip — cloudflared auto-reconnects
- Code edit + no restart — old code keeps running until you cycle backend daemon
- Mac runs out of disk — all daemons fail silently (`status.sh` would show it)
- Operator force-quits launchd (don't do this)
