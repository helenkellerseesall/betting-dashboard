# RUNTIME_FACTS

**Read this BEFORE writing any probe, terminal command, or runtime assertion.**

This file is the canonical source of truth for runtime values that conversational summaries lose. If a fact appears in chat but contradicts this file, the file wins. Update this file when anything changes — never re-derive from memory.

Last updated: 2026-06-06

## Directory layout — WATCH OUT

- **Repo root:** `~/Projects/betting-dashboard` (use for `git`, `.gitignore`, top-level docs). CORRECTED 2026-06-05: the repo lives at `~/Projects/`, NOT `~/Desktop/` — every LaunchAgent plist, `scheduler.sh`, and autopilot log under `backend/scripts/autopilots/` references the `~/Projects/betting-dashboard` path. Older docs/memory that say `~/Desktop/betting-dashboard` are STALE; this path wins.
- **Backend root:** `~/Projects/betting-dashboard/backend` (use for `npm`, `node`)
- **`package.json` IS at `backend/`, NOT at repo root.** Running `npm run slate:nba` from the repo root errors with `ENOENT: package.json` and silently does nothing in chained commands. Always `cd ~/Projects/betting-dashboard/backend` before any `npm run`. scheduler.sh and other automation cds there explicitly.
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

## Season switch (Phase Season-Switch-1A, 2026-06-14)

- **Source of truth:** `backend/config/seasonsActive.json` (tracked). `{ sports: { mlb, nba, nfl, nhl } }` booleans. Defaults: **mlb ON, nba/nfl/nhl OFF.**
- **Authority (Law 1):** `backend/pipeline/shared/seasonGate.js` — `isSportEnabled(sport)`. Reads the JSON FRESH every call (no require-cache); **fail-OPEN** (missing/garbled config or unknown sport → treated ON + `[SEASON-GATE]` warn).
- **Toggle (no redeploy):** `cd backend && npm run sport:off <sport>` or `npm run sport:on <sport>` (writes the file + prints a commit fence). Or edit the JSON directly. Effect is live within ≤30s — scheduler reads per-tick, slate scripts per-invocation, `/status` per-request.
- **Where it gates:** slate scripts at `main()` entry (covers scheduler + autopilots + manual); scheduler.sh wraps the 6 NBA + 3 MLB populator/injury blocks via the `sport_on()` helper. **NOT gated** (sport-agnostic): grading / settlement / audit:nightly / sysAudit / status-autoticker / caffeinate — an OFF sport's existing bets keep grading.
- **Kill-safety:** OFF stops NEW calls/writes only; deletes nothing; reversible.
- **Deploy requirement:** editing `scheduler.sh` needs a LaunchAgent reload (running copy is otherwise stale): `launchctl kickstart -k gui/$(id -u)/com.motel666.scheduler`. The `/status` "sports active" card needs one backend reload to ship: `launchctl kickstart -k gui/$(id -u)/com.motel666.backend` — do it OUTSIDE PM-ET tipoff windows (daytime restarts hurt MLB CLV capture). Toggling thereafter needs NO restart.
- **/status:** the "sports active" card (sectionSportsActive) shows GREEN on+firing / RED on+not-firing / GREY off-paused / DIM no-pipeline (NFL/NHL).

## Caffeinate

- **LaunchAgent:** `com.motel666.caffeinate`
- **Purpose:** keep Mac awake during slate windows so backend doesn't suspend

## Calibration kill-switch — CALIB_LINEAWARE (Phase Calibration-LineAware-1A, 2026-06-06)

- **Flag:** `CALIB_LINEAWARE` — backend env var, read ONCE at module load in `backend/pipeline/shared/calibrationDampener.js`.
- **Default:** unset → ON. `"1"` is also ON. ONLY the exact string `"0"` turns it OFF.
- **ON (default):** dampener uses the line-aware path — per-line buckets, book-agnostic corpus, floor 0.40 (5.2 live behavior).
- **OFF (`"0"`):** dampener ignores the prop line, uses the pre-5.2 id-join family-side path, floor 0.20. Emergency revert — NO code change, NO redeploy.
- **Flip OFF (emergency revert):**
  1. Edit `~/Library/LaunchAgents/com.motel666.backend.plist`, add under the `EnvironmentVariables` `<dict>`:
     `<key>CALIB_LINEAWARE</key><string>0</string>`
  2. `launchctl unload ~/Library/LaunchAgents/com.motel666.backend.plist; launchctl load ~/Library/LaunchAgents/com.motel666.backend.plist`
  3. Backend restarts on the id-join path.
- **Flip back ON:** remove that env entry from the plist, unload + load again.
- **Why a reload is required:** the flag is read at module load, so a running backend won't pick up a plist change until restarted. Intentional — the revert is a deliberate operator action, not a mid-flight toggle.
- **VERIFY which path is live (DO NOT use /status):** `/status` familyCalibration reads `backend/runtime/calibration/family_calibration.json` (a sysAudit JSON), NOT this module — it does NOT reflect the flag. Reliable checks:
  1. **Backend log** — after reload, grep the backend stdout log for `[CALIB-BOOT]`: prints `ON (default)` or `OFF — CALIB_LINEAWARE=0, id-join path`.
  2. **Probe** (code-level, with its own env): `node .scratch/probe_calib_killswitch.js` — shows id-join↔line-aware multipliers per flag state.
  3. **Numeric tell** — `mlb·hits·under·1.5` dampens model 0.6698 → 0.55 OFF (id-join mult ~0.82) vs 0.41 ON (line-aware mult 0.618); `nba·threes·over` → 0.118 OFF (floor 0.20) vs 0.237 ON (floor 0.40).

## Other runtime ports / paths I keep getting wrong

- Tracking dir: `backend/runtime/tracking/`
- **Personal ledger CANONICAL LOCATION: `backend/storage/betting.db` table `personal_ledger`** (273k+ bets, snake_case columns, 8 indexes including `idx_pl_decision` on decision_type). Dual-written automatically from JSON via `_mirrorAllBetsToSqlite()` inside `saveLedger()` in `buildPersonalLedger.js`. **The JSON file at `backend/runtime/tracking/personal_ledger.json` is the secondary copy** (FIFO-capped at MAX_BETS=50k). When picking which to read, SQLite has more history and is FIFO-immune. The existing infrastructure: `backend/storage/db.js` for db lifecycle, `backend/storage/queries.js` for upsertLedgerBet + upsertManyLedgerBets.
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
