# Per-Sport Season ON/OFF Switch — Audit + Phase-1 Plan

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-14 ~03:33 ET (clock-checked `TZ='America/New_York' date`)
**Mode:** AUDIT-FIRST — read-only. No code changed. No fence beyond this doc + the OPERATOR_SESSION_LOG turn block.
**Trigger:** operator brief via Claude-A (OPERATOR_SESSION_LOG 2026-06-14 02:48 ET). First use: NBA OFF (season ended 06-13, API-Sports NBA key expired); MLB ON.
**Scope guard:** config/scheduler infra ONLY. Touches NOTHING in the scoring path → R2 MLB scoring freeze (active since 2026-06-11 16:36:52 ET) and the T2-L1 NB shadow ladder remain intact. No PRESERVED.md module is touched (verified — all touch-targets are absent from PRESERVED.md).

---

## 1. Map of every per-sport invocation point

### 1a. `backend/scripts/scheduler.sh` (the live always-on loop, `com.motel666.scheduler`)

Every gate below is a `[ "$MIN" -eq N ] && [ "$HOUR" ... ]` block inside the `while true` loop (line 90), so each is re-evaluated per 30s tick.

| Sport | Job | Command | scheduler.sh lines |
|---|---|---|---|
| MLB | slate | `npm run slate:mlb` → `node scripts/slateMlb.js` | 126–134 |
| NBA | slate | `npm run slate:nba` → `node scripts/slateNba.js` | 137–145 |
| NBA | injury report (:15) | `node scripts/populateNbaInjuryReport.js` | 151–159 |
| NBA | game logs (:45) | `node scripts/populateNbaGameLogs.js` | 169–177 |
| MLB | batter stats (3:05) | `node scripts/populateMlbBatterStats.js` | 280–288 |
| MLB | batter game logs (3:10) | `node scripts/populateMlbBatterGameLogs.js` | 290–298 |
| MLB | pitcher game logs (3:15) | `node scripts/populateMlbPitcherGameLogs.js` | 300–308 |
| NBA | DvP (3:20) | `node scripts/deriveNbaDvP.js` | 310–318 |
| NBA | team stats (3:25) | `node scripts/populateNbaTeamStats.js` | 320–328 |
| NBA | series state (3:30) | `node scripts/populateNbaSeriesState.js` | 337–345 |
| NBA | team defensive (3:35) | `node scripts/deriveNbaTeamDefensive.js` | 358–366 |

**Sport-AGNOSTIC blocks (do NOT gate these):** sysAudit (:00, 184–269), settlement:run (3:45, 376–384), grading:backfill-all (4:00, 398–406), audit:nightly (5:00, 415–429), the status-snapshot autoticker (:00/5, 112–115), and the caffeinate watchdog (100). These process whatever rows already exist and are harmless when a sport has no new data (no-games-aware). Gating them would stop an OFF sport's *existing* bets from grading out — wrong.

### 1b. `backend/package.json` (scripts; backend root)

Only two sport entrypoints are npm scripts: `slate:nba` → `scripts/slateNba.js` (line 17), `slate:mlb` → `scripts/slateMlb.js` (line 18). The MLB/NBA populators are invoked as **direct `node scripts/*.js`** from scheduler.sh, not via npm.

**FINDING (adjacent, not this task):** `package.json` has **no** `populate:*` / `derive:*` scripts, but `backend/scripts/autopilots/populator-chain.sh` calls `npm run populate:mlb-batter-stats` etc. Those calls fail "Missing script." The real, working populator refresh is scheduler.sh's direct-`node` path (1a). The `populator-chain` LaunchAgent path is effectively dead. Worth a separate cleanup ticket; out of scope here.

### 1c. Redundant autopilot LaunchAgents — `backend/scripts/autopilots/`

A second, parallel fire system exists (Phase Cron-To-LaunchAgent-1A). Plists + wrappers in the repo:

| Plist | Wrapper | Fires |
|---|---|---|
| `com.motel666.slate-mlb-hourly.plist` | `slate-mlb.sh` → `npm run slate:mlb` | :00 hrs 9–23 |
| `com.motel666.slate-nba-30min.plist` | `slate-nba.sh` → `npm run slate:nba` | :00/:30 hrs 16–23 |
| `com.motel666.populator-chain.plist` | `populator-chain.sh` → `npm run populate:*` (broken, see 1b) | 3:05 |
| `com.motel666.grading-nightly.plist` | `grading-nightly.sh` | 4:00 |
| `com.motel666.audit-nightly.plist` | `audit-nightly.sh` | 5:00 |

**Which of these are actually LOADED is NOT verifiable from the sandbox** (`~/Library/LaunchAgents` isn't mounted). Two corroborating signals say the two SLATE autopilots are NOT loaded and scheduler.sh owns slates: (a) project doctrine lists only `scheduler + populator-chain + grading-nightly + audit-nightly` as loaded; (b) `statusRoute.js` `LAUNCHAGENT_LABELS` (lines 71–79) monitors exactly those 7 agents and does **not** include `slate-mlb-hourly` / `slate-nba-30min`.
→ **OPERATOR PROBE NEEDED** before build (one command, §7).

**Design consequence:** because a slate can in principle fire from scheduler.sh OR an autopilot wrapper OR a manual `npm run`, the *authoritative* gate must live at the **node entrypoint** (`slateMlb.js` / `slateNba.js`), which every path funnels through. A bash-only gate would leak whichever path it doesn't cover.

### 1d. Backend routes / `/status`

- `backend/server.js:121` — `app.use("/api/ws/status", require("./routes/statusRoute"))`.
- `backend/server.js:153` — `app.use("/status", express.static(frontend/status))` (the dashboard HTML).
- `backend/routes/statusRoute.js` — `router.get("/")` assembles all section builders (line 1379); `router.post("/snapshot")` (1409) is what the scheduler autoticker hits; `router.get("/stream")` SSE (1524). All section builders read files **fresh per request** (`safeReadJson`), so a status card reflecting the switch needs no backend restart to update.
- `backend/scripts/sysAudit.js` — iterates `for (const sport of ["nba","mlb"])` at lines 131, 218, 283. With NBA OFF this currently emits false WARN ("NBA … tracked files missing — scheduler may have skipped", line 141). Must be made season-aware.

### 1e. NFL / NHL

**Zero invocation points anywhere** — no `slate:nfl`/`slate:nhl`, no populators, only a forward-looking comment at `backend/pipeline/sports/bestAvailableSportDispatch.js:5`. NFL/NHL in the switch are **config placeholders** (forward-compat), nothing to gate yet.

---

## 2. Recommended single source-of-truth for enabled state

**`backend/config/seasonsActive.json`** — a tracked JSON config:

```json
{
  "_doc": "Per-sport season enablement. true = pipeline fires; false = paused (no NEW calls; existing data untouched). Toggle via `npm run sport:on|off <sport>` or by editing this file. Read fresh by scheduler.sh per tick, slate/populator scripts per invocation, and /status per request — no restart needed to toggle.",
  "updatedAt": "2026-06-14T03:33:00-04:00",
  "sports": { "mlb": true, "nba": false, "nfl": false, "nhl": false }
}
```

**Why JSON (not `config/modelConfig.js`, not a plist env var):**
- A `.js` config is read at module load → needs a backend restart per toggle. ✗
- A plist env var (the `CALIB_LINEAWARE` pattern) needs a plist edit + LaunchAgent reload per toggle — deliberately heavyweight, wrong for a seasonal switch flipped a few times a year across 4 sports. ✗
- JSON is readable by **both** runtimes and toggled by a plain file write — **no redeploy**. ✓

**Read cadence (per-tick vs per-boot):**
- scheduler.sh reads it **per tick** (inside the while loop) → a toggle takes effect within ≤30s, no scheduler reload required for the toggle itself.
- slate/populator node scripts read it **per invocation** (fresh process) → always current.
- statusRoute reads it **per request** → card always current.
- The node authority reads the file fresh on each call (`fs.readFileSync`, no `require` cache) so the long-lived backend never holds a stale copy.

**Tradeoff to flag:** a *tracked* config means each toggle is a git change (it'll show in `/status`'s "uncommitted changes" until committed, and wants a commit for the audit trail). The alternative — an *untracked* runtime file (e.g. `backend/runtime/seasonsActive.json`) — keeps git clean but loses version history and ships no defaults on a fresh clone. **Recommendation: tracked file with committed defaults**; season changes are rare and the commit trail is a feature. (Operator can overrule to untracked.)

---

## 3. One gate chokepoint per sport (not scattered guards)

**ONE authority, one implementation, two thin adapters over the same file:**

- **Node (THE canonical authority, Law 1):** new `backend/pipeline/shared/seasonGate.js` → `isSportEnabled(sport)`. Reads `seasonsActive.json` fresh; **fail-OPEN** (missing/unreadable/unknown-sport → returns `true` + a phase-tagged `[SEASON-GATE]` warn, per Law 16) so a config typo can never silently kill a live sport. NFL/NHL with no scripts simply have no caller yet.
- **Bash (defers to the authority):** one helper in scheduler.sh —
  `sport_on() { node -e "process.exit(require('./pipeline/shared/seasonGate').isSportEnabled(process.argv[1])?0:1)" "$1"; }`
  — so bash and node share literally one logic implementation (the module); bash only consumes its exit code.

**Where it fires:**
- **Authoritative backstop:** `if (!isSportEnabled('mlb')) { log; return }` at the top of `main()` in `slateMlb.js` / `slateNba.js`. Covers slate fires from *every* path (scheduler, autopilot wrapper, manual npm).
- **scheduler.sh populator/injury blocks:** wrap each sport block with `sport_on mlb && { … }` / `sport_on nba && { … }`. These are ~6 NBA + ~3 MLB block boundaries; it is one helper applied consistently at each block, not bespoke logic per site. (The blocks are time-interleaved — MLB :00, NBA :00/:30, injury :15, etc. — so they can't be hoisted into a single check; the per-block helper is the honest structural answer.)

This keeps the *decision logic* in exactly one place (the module); the helper/guard are uniform call sites, which Law 1 permits (extend the canonical; don't fork it).

---

## 4. Surface state on /status — "Sports Active" card

- **Backend:** new `sectionSportsActive()` in statusRoute.js — reads `seasonsActive.json` fresh + cross-references last slate fire (from scheduler.log, like `sectionSlateFiresToday`). Per sport classify:
  - `on_firing` → GREEN
  - `on_not_firing` (enabled but no recent fire in-window) → RED (real failure)
  - `off_paused` → GREY/neutral (intentional, NOT red)
  - `no_scripts` (NFL/NHL) → dim placeholder
  Register in the `router.get("/")` assembly (line 1379).
- **Quiet-the-noise (the whole point):** make `sysAudit.js` (loops 131/218/283), `sectionOpenIssues`, and `sectionClvCaptureToday` season-aware — for an OFF sport, emit INFO ("NBA season OFF — slate intentionally paused"), never WARN/RED. Without this, turning NBA off spawns false YELLOW every hour.
- **FE:** add `cardSportsActive` to `frontend/status/index.html` following the existing `<details class="card">` pattern (cards at lines 140+). Phase 1 = **display only**.

---

## 5. v1 toggle mechanism

- **Term command (v1):** new `backend/scripts/sportToggle.js` + package.json `"sport:on": "node scripts/sportToggle.js on"`, `"sport:off": "node scripts/sportToggle.js off"`. Usage `npm run sport:off nba`. Validates sport ∈ {mlb,nba,nfl,nhl}, rewrites `seasonsActive.json` with a new `updatedAt`, prints before→after. (Direct file edit also works — the term command is just the safe, validated path.)
- **/status toggle button:** **Phase 2.** A write endpoint (`POST /api/ws/status/season`) exposed on a public tunnel needs auth/CSRF thought; not worth bundling into v1. v1 = display on /status + toggle from the terminal.

---

## 6. Current per-sport season defaults (checked, not assumed)

| Sport | Default | Evidence |
|---|---|---|
| MLB | **ON** | slates firing through 06-13; `mlb_tracked_bets_2026-06-13.json` present; 707 closeOdds on 06-13 (session log 06-14 02:41 ET). In season. |
| NBA | **OFF** | Last game 06-13 (Knicks 4-1, series done); NBA picks=0 on 06-13; API-Sports NBA key expired (session log 06-14 02:41/02:48 ET). `nba_tracked_bets_2026-06-13.json` is the last slate. |
| NFL | **OFF** | June = offseason (NFL Sep–Feb). No invocation points exist (§1e). |
| NHL | **OFF** | Not wired; June is end-of-season at most, and the project frame defers NHL to "when seasons return." No invocation points (§1e). |

→ `{ "mlb": true, "nba": false, "nfl": false, "nhl": false }`.

---

## 7. Phase-1 plan + kill-safety + reload

**Pre-build operator probe (resolves §1c ambiguity):**
```
launchctl list | grep motel666
```
Confirms which agents are loaded. If `slate-mlb-hourly`/`slate-nba-30min` ARE loaded, we additionally guard their wrappers (`slate-mlb.sh`/`slate-nba.sh`); if not, the node-entry gate already covers them.

**Build steps (after operator approval — NOT done in this pass):**
1. `backend/config/seasonsActive.json` — defaults from §6.
2. `backend/pipeline/shared/seasonGate.js` — `isSportEnabled()`, fail-open + `[SEASON-GATE]` probe.
3. `slateMlb.js` / `slateNba.js` — entry guard in `main()`.
4. `scheduler.sh` — `sport_on()` helper + wrap the per-sport populator/injury blocks (§1a). (The file already carries the line-103 fix; see below.)
5. `statusRoute.js` — `sectionSportsActive()` + season-aware suppression in openIssues/CLV; `sysAudit.js` season-aware.
6. `frontend/status/index.html` — `cardSportsActive`.
7. `sportToggle.js` + package.json `sport:on`/`sport:off`.
8. `verifySeasonGate.js` fixture → add to `runtimeVerify.js` SUITES (currently 15 → 16): asserts isSportEnabled per config, fail-open on missing file, OFF sport → slate `main()` early-returns with no HTTP, ON unchanged, toggle round-trips JSON. Full `runtime:verify` must stay green (R2 + NB-ladder fixtures untouched = freeze proven intact).
9. Brain docs per Law 12 (MASTER_BRAIN current-phase, MODEL_EVOLUTION_LOG, ACTIVE_INCIDENTS resolve the line-103 stale-scheduler item, PIPELINE_AUTHORITY_MAP new "Season enablement" row, RUNTIME_FACTS the new config + toggle).

**Kill-safety:** OFF makes `isSportEnabled` return false → slate/populator scripts return **before any API call or file write**. It stops NEW calls only. It deletes nothing — tracked_bets/tracked_best/snapshots/SQLite all preserved; the OFF sport's existing bets still grade/settle out (those jobs are sport-agnostic and left ungated, §1a). Flip back ON → firing resumes within ≤30s (scheduler per-tick). Fully reversible, data-safe.

**Scheduler reload (mandatory — and it also fixes the live crash):** `launchd.log` (`scheduler-launchd.log`) shows repeated `scheduler.sh: line 103: last_status_snapshot_min: unbound variable` — the **running** LaunchAgent is executing a pre-fix copy and crash-looping under `set -u`. The current file already has the fix (init at line 88 + `${last_status_snapshot_min:-}` at line 112), so the running copy is stale. After editing scheduler.sh, reload to pick up BOTH the gate and the existing fix:
```
launchctl kickstart -k gui/$(id -u)/com.motel666.scheduler
```
Verify (real output, not a diff — Law 31 spirit): `pgrep -af scheduler.sh` shows a NEW pid; `tail .scratch/scheduler-launchd.log` no longer prints the line-103 error; at the next NBA window `tail .scratch/scheduler.log` shows NBA "SKIPPED (season OFF)" instead of FAILED, and MLB still logs OK.

**Backend reload (for the /status card only):** one `launchctl kickstart -k gui/$(id -u)/com.motel666.backend` to load the new statusRoute code — schedule it **outside PM-ET tipoff windows** (daytime restarts degrade MLB CLV capture per the 06-14 health check). Toggling thereafter needs no backend restart (fresh per-request read).

**Freeze statement:** seasonGate sits entirely outside the scoring path (gates at slate entry, before the engine runs). buildMlbPropClusters / tierForPlay / makePlay / ladderNB untouched. R2 freeze + T2-L1 shadow intact. PRESERVED.md untouched.
