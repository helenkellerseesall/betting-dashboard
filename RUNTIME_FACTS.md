# RUNTIME_FACTS

**Read this BEFORE writing any probe, terminal command, or runtime assertion.**

This file is the canonical source of truth for runtime values that conversational summaries lose. If a fact appears in chat but contradicts this file, the file wins. Update this file when anything changes — never re-derive from memory.

Last updated: 2026-05-31

## Directory layout — WATCH OUT

- **Repo root:** `~/Desktop/betting-dashboard` (use for `git`, `.gitignore`, top-level docs)
- **Backend root:** `~/Desktop/betting-dashboard/backend` (use for `npm`, `node`)
- **`package.json` IS at `backend/`, NOT at repo root.** Running `npm run slate:nba` from the repo root errors with `ENOENT: package.json` and silently does nothing in chained commands. Always `cd ~/Desktop/betting-dashboard/backend` before any `npm run`. scheduler.sh and other automation cds there explicitly.
- Quick rule: **`git` commands → repo root. `npm`/`node` commands → backend root.**

## Backend

- **Port:** `4000`  (overridable via `PORT` env var; default in `backend/server.js`)
- **Bind:** binds on all interfaces (no explicit host in `app.listen(PORT)`)
- **Process:** managed by LaunchAgent `com.motel666.backend`
- **Plist:** `~/Library/LaunchAgents/com.motel666.backend.plist`
- **Reload:** `launchctl unload <plist>; launchctl load <plist>`
- **Stderr log:** check the plist for `StandardErrorPath`; common locations: `~/Library/Logs/com.motel666.backend.err`, `/tmp/motel666-backend.err`
- **Local probe URL:** `http://127.0.0.1:4000`

## Cockpit (separate process)

- **Port:** `4001`  (overridable via `COCKPIT_PORT`; in `backend/cockpit/server.js`)
- **Bind:** `127.0.0.1` only

## Cloudflared tunnel

- **Tunnel name:** `edge`
- **Public hostname:** `edge.motel666.com`
- **LaunchAgent:** `com.motel666.cloudflared`
- **Restart cmd:** `cloudflared tunnel run edge`

## Scheduler

- **LaunchAgent:** `com.motel666.scheduler`
- **Script:** `backend/scripts/scheduler.sh`
- **Cadence:** `slate:mlb` hourly 9 AM – 11 PM ET, `slate:nba` every 30 min 4 PM – 11:30 PM ET

## Caffeinate

- **LaunchAgent:** `com.motel666.caffeinate`
- **Purpose:** keep Mac awake during slate windows so backend doesn't suspend

## Other runtime ports / paths I keep getting wrong

- Tracking dir: `backend/runtime/tracking/`
- Personal ledger: `backend/runtime/operator/personal_ledger.json`
- Scratch dir for diagnostics: `.scratch/last.txt` (always overwrite, never append)

## How to verify a fact in this file is current

```
lsof -nP -iTCP -sTCP:LISTEN | grep -E "node|cloudflared"
launchctl list | grep motel666
cat ~/Library/LaunchAgents/com.motel666.backend.plist | head -40
```

## When to update this file

Update RUNTIME_FACTS.md whenever:
- a LaunchAgent plist is added/removed/renamed
- a port changes
- a tunnel hostname changes
- a binding path changes (e.g. ledger moves)

Commit message convention: `runtime-facts: <what changed>`
