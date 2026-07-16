# RUNTIME_FACTS

**Read this BEFORE writing any probe, terminal command, or runtime assertion.**

This file is the canonical source of truth for runtime values that conversational summaries lose. If a fact appears in chat but contradicts this file, the file wins. Update this file when anything changes — never re-derive from memory.

Last updated: 2026-06-06

## Directory layout — WATCH OUT

- **Repo root:** `~/Projects/betting-dashboard` (use for `git`, `.gitignore`, top-level docs). CORRECTED 2026-06-05: the repo lives at `~/Projects/`, NOT `~/Desktop/` — every LaunchAgent plist, `scheduler.sh`, and autopilot log under `backend/scripts/autopilots/` references the `~/Projects/betting-dashboard` path. Older docs/memory that say `~/Desktop/betting-dashboard` are STALE; this path wins.
- **Backend root:** `~/Projects/betting-dashboard/backend` (use for `npm`, `node`)
- **`package.json` IS at `backend/`, NOT at repo root.** Running `npm run slate:nba` from the repo root errors with `ENOENT: package.json` and silently does nothing in chained commands. Always `cd ~/Projects/betting-dashboard/backend` before any `npm run`. scheduler.sh and other automation cds there explicitly.
- Quick rule: **`git` commands → repo root. `npm`/`node` commands → backend root.**

## Front-end (CANONICAL — no React in this repo)

- **Mobile PWA:** `frontend/mobile/index.html` — single-file vanilla-JS, served at **`/m`** (`server.js:145`). Edit the inline HTML/JS directly; there is NO build step and NO `frontend/src/*.tsx`.
- **Status dashboard:** `frontend/status/index.html` — served at **`/status`**.
- Historical brain-doc references to `frontend/src/workstation/*.tsx` / `FeaturedCard.tsx` are STALE — do not chase a phantom React repo. To surface a feature: edit `frontend/mobile/index.html` + add a `/api/ws/*` route in `workstationRoutes.js`.
- **Cash-out/hedge surface (2026-06-15):** PARLAY tab (un-hidden) → cash-out card in `renderParlay` → `POST /api/ws/cashout` (reuses `cashoutHedge.js` + `vigStripping` + `mlbCorrelationEngine`; read-only, no scoring).

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
- **trueOpen opener capture:** `captureMlbTrueOpen.js` at **6:00 AM ET** (same-day pitcher-prop baseline) + **22:00 ET `--evening`** (NIGHT-OWL-1, 2026-07-15: next-slate opener the night before; future-slate-only — never overwrites the 6 AM baseline file)
- **Ladder capture (G2 enabler):** `captureMlbLadders.js` at **10:00 / 17:00 / 22:05 ET** (2026-07-16: 8 `_alternate` market keys → `runtime/tracking/mlb_ladders_<gameDate>.json`; quota-guarded DAILY_CAP 600 + RESERVE_FLOOR 5000, real x-requests-last costs; 22:05 rides the forward-roll = tomorrow's opening rungs)

## Season switch (Phase Season-Switch-1A, 2026-06-14)

- **Source of truth:** `backend/config/seasonsActive.json` (tracked). `{ sports: { mlb, nba, nfl, nhl } }` booleans. Defaults: **mlb ON, nba/nfl/nhl OFF.**
- **Authority (Law 1):** `backend/pipeline/shared/seasonGate.js` — `isSportEnabled(sport)`. Reads the JSON FRESH every call (no require-cache); **fail-OPEN** (missing/garbled config or unknown sport → treated ON + `[SEASON-GATE]` warn).
- **Toggle (no redeploy):** `cd backend && npm run sport:off <sport>` or `npm run sport:on <sport>` (writes the file + prints a commit fence). Or edit the JSON directly. Effect is live within ≤30s — scheduler reads per-tick, slate scripts per-invocation, `/status` per-request.
- **Where it gates:** slate scripts at `main()` entry (covers scheduler + autopilots + manual); scheduler.sh wraps the 6 NBA + 3 MLB populator/injury blocks via the `sport_on()` helper. **NOT gated** (sport-agnostic): grading / settlement / audit:nightly / sysAudit / status-autoticker / caffeinate — an OFF sport's existing bets keep grading.
- **Kill-safety:** OFF stops NEW calls/writes only; deletes nothing; reversible.
- **Deploy requirement:** editing `scheduler.sh` needs a LaunchAgent reload (running copy is otherwise stale): `launchctl kickstart -k gui/$(id -u)/com.motel666.scheduler`. The `/status` "sports active" card needs one backend reload to ship: `launchctl kickstart -k gui/$(id -u)/com.motel666.backend` — do it OUTSIDE PM-ET tipoff windows (daytime restarts hurt MLB CLV capture). Toggling thereafter needs NO restart.
- **/status:** the "sports active" card (sectionSportsActive) shows GREEN on+firing / RED on+not-firing / GREY off-paused / DIM no-pipeline (NFL/NHL).
- **Interactive toggle (Season-Switch-2A):** tap the iOS switch on the /status card to flip a sport (MLB/NBA; NFL/NHL disabled). Route `POST /api/ws/status/season` → `seasonGate.setSportEnabled` (same canonical write as the CLI). TOKEN-GUARDED, fail-closed: requires header `x-status-token === STATUS_WRITE_TOKEN`; **unset env ⇒ 403** (endpoint cannot ship open). Set it: generate `openssl rand -hex 16`; write it into the plist via PlistBuddy (no hand-edited XML): `/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" "$HOME/Library/LaunchAgents/com.motel666.backend.plist" 2>/dev/null; /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:STATUS_WRITE_TOKEN string <TOKEN>" …` then **bootout/bootstrap** (NOT kickstart — see below). FE asks for the token once per device (localStorage, persists across sessions; a 403 clears it so a rotated token re-prompts). No-restart to toggle thereafter (config read fresh; flip live within the 30s tick).

## LaunchAgent reload — CODE vs ENV (learned 2026-06-14, Season-Switch-2A deploy)

- **Code change** (edited a `.js`/`.sh` the plist's `ProgramArguments` runs): `launchctl kickstart -k gui/$(id -u)/com.motel666.<svc>` — the process re-execs and re-reads the file from disk. (Law 14.)
- **Plist change** (added/changed `EnvironmentVariables` like `STATUS_WRITE_TOKEN` or `CALIB_LINEAWARE`): kickstart does **NOT** re-parse the plist → the new env never enters the process (symptom: backend on the right commit but the env var is undefined). Do a FULL job reload: `launchctl bootout gui/$(id -u)/com.motel666.<svc>; launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.motel666.<svc>.plist"`. (unload/load is the older equivalent but has no-op'd on this host before — prefer bootout/bootstrap.)

## Correlation engine (Phase T2-Correlation-1A, 2026-06-14)

- **Kill-switch:** `MLB_CORRELATION` — backend env, read ONCE at module load in `backend/pipeline/mlb/mlbCorrelationEngine.js`. Default ON; exact string `"0"` = OFF (`jointForPair` returns null). Boot probe `[MLB-CORRELATION-BOOT]`.
- **Method authority:** `backend/pipeline/shared/gaussianCopula.js` (Gaussian copula math). MLB engine: `backend/pipeline/mlb/mlbCorrelationEngine.js`. Priors: `backend/config/mlbCorrelationPriors.json` — regenerate via `node backend/scripts/deriveMlbCorrelationPriors.js` as graded days accrue (ρ_Z are priors; effective n ≈ games).
- **SHADOW-only:** feeds nothing in scoring; no tracked_bets ride-along. Validate via `node backend/scripts/probeCorrelationValidation.js` → `.scratch/last.txt`.
- **Status:** correctly-SIGNED (12/12 structural types) + held-out dependence beats independence; NOT a Brier win on `modelProb` marginals yet (modelProb overconfident). Do not wire into EV/scoring until marginals are calibrated + forward data confirms.

## Marginal calibration (Phase T2-MarginalCalib-1A, 2026-06-14)

- **Kill-switch:** `MLB_MARGINAL_CALIB` — backend env, read ONCE at module load in `backend/pipeline/mlb/mlbMarginalCalibration.js`. Default ON; exact `"0"` = OFF (`calibrateModelProb` returns null). Boot probe `[MLB-MARGINAL-CALIB-BOOT]`.
- **Method authority:** `backend/pipeline/shared/isotonicCalibration.js` (PAVA + Platt). MLB engine: `backend/pipeline/mlb/mlbMarginalCalibration.js`. Maps: `backend/config/mlbMarginalCalibration.json` — regen via `node backend/scripts/deriveMlbMarginalCalibration.js`.
- **ROOT CAUSE found:** the PRESERVED `calibrationDampener.js` is DORMANT on the value path (dampenModelProb only sets a display label in workstationRoutes.js:67-68; scoring modelProb is RAW, ~+16pp overconfident).
- **SHADOW-only:** computes modelProbCalibrated alongside; feeds nothing in scoring. Validate via `node backend/scripts/probeMarginalCalibrationValidation.js` → `.scratch/last.txt`.
- **Status:** calibration decisively beats raw out-of-sample (Brier 0.111→0.088; gap 15.8pp→0.26pp). LIVE fix = extend the dampener (isotonic remap) + wire onto the cluster modelProb = a SCORING change, gated by the R2 freeze + separate operator approval. Do NOT wire live until then.

## Parlay constructor (Phase T2-Parlay-1A, 2026-06-15)

- **Kill-switch:** `MLB_PARLAY` — backend env, read once at module load in `backend/pipeline/mlb/mlbParlayConstructor.js`. Default ON; `"0"` = OFF (`buildParlays` returns null). Boot probe `[MLB-PARLAY-BOOT]`.
- **What:** `buildParlays(legs)` — calibrated marginals (not raw) + copula joint (same-game) / product (cross-game); EV cross-game only (NO book SGP price → same-game evParlay=null); never-auto-bundle (default singles). SHADOW — feeds nothing live; `upside/builders.js` (heuristic v0) untouched. Validate: `node backend/scripts/probeParlayConstructorValidation.js`.
- **Status (honest, in-sample):** machine verified; but +EV-gated legs realize NEGATIVE (singles −17%, parlays −42%) — the gate selects the model's overconfident tail; calibration isn't honest at the +EV selection margin yet. Do NOT treat any EV output as real until post-freeze LIVE calibration is forward-validated at the margin.

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
