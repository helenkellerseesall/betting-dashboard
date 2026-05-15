# OPERATOR RUNBOOK
**Single source-of-truth for daily repo operation. Phase Operator-Operations-1 (2026-05-14). Phase Realism-Ecology-1A appended 2026-05-14.**

> If you remember nothing else: every operational verb is now an `npm run X` command. Run them from `backend/`. They print what they're about to do before doing it. No magic, no hidden state.

---

## RECOMMENDATION HIERARCHY DOCTRINE (Phase Recommendation-Hierarchy-1A, 2026-05-15)

**The workstation now surfaces a deterministic 7-slot decision ladder ABOVE the HeroPickCard.**

The ladder is a pure observational layer over the canonical featured-bucket arrays. It is the operator's decision-grade scan-line; the hero card retains emotional emphasis on the single highest-composite anchor.

**Slot order (priority — first claim wins):**

| Slot | Icon | Source bucket | Empty doctrine |
|---|---|---|---|
| `bestOverall` | 🔥 | `anchors[0]` (with id-dedup walk) | `(no qualifying best play tonight)` |
| `safestPlay` | 🛡 | `safest[0]` | `(no qualifying safe play tonight)` |
| `bestDisagreement` | ⚡ | `bestDisagreementEdges[0]` | `(no qualifying disagreement edge tonight)` |
| `bestUpsidePlay` | 🚀 | cascade `bestAggressive` → `bestPra` → `bestHr` → `bestFirstBasket` | `(no qualifying upside play tonight)` |
| `bestBalancedPlay` | 🎯 | `bestBalanced[0]` | `(no qualifying balanced play tonight)` |
| `mostOverpricedAvoid` | ⚠ | `inflatedSuperstarSpots[0]` | `(no overpriced spots flagged tonight)` |
| `highestTrapRiskAvoid` | ⚠ | `trapLadders[0]` | `(no trap-shaped ladders flagged tonight)` |

**Doctrine:**
1. **Pure observational layer.** No new scoring. No new ranking math. No new heuristics.
2. **Canonical bucket authority.** Slot rules cite buckets BY NAME. When a bucket evolves, the ladder follows automatically.
3. **Dedup walk.** A play already claimed by an earlier-priority slot is skipped; the ladder walks down the bucket until a unique id is found OR the bucket is exhausted (slot becomes `null`).
4. **Empty doctrine.** Every empty slot renders an HONEST `(no qualifying X tonight)` italic line. The ladder **NEVER** manufactures a fallback play.
5. **Replay/grading safety.** Ladder consumes already-immutable `featured` payload; no upstream mutation; no API call; no persistence.
6. **Frontend authority.** `frontend/src/workstation/components/RecommendationLadder.tsx` is the single render owner. All annotations re-use `tooltips.ts` helpers — no parallel translation layer.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | HIER-1 (backend builder) + HIER-2 (FE interface) + HIER-3 (FE component) + HIER-4 (Dashboard wiring) | 2026-05-15 | ✅ SHIPPED |
| 1B | HIER-5 — operator-customizable slot priority weights | — | Held |
| 1C | HIER-6 — "what changed since last refresh" delta surface | — | Held |
| 1D | HIER-7 — per-slot explainability expansion | — | Held |
| 1E | HIER-8 — slot historical ROI tracking | — | Held |
| 1F | HIER-9 — slot persistence / longitudinal stability | — | Held |

---

## CANONICAL PAYLOAD DOCTRINE (Phase Canonical-Shape-Hardening-1A, 2026-05-15)

**Every observability/diagnostic surface that reads a payload MUST consume `backend/pipeline/shared/responseShapeResolvers.js`. No exceptions.**

The canonical helper module is the architectural seam that prevents future INC-016 / INC-017-style drift events. Two consecutive incidents shared one root cause — duplicated inline payload readers drifting from canonical API shapes — and Phase Canonical-Shape-Hardening-1A introduces the structural fix.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | HARDEN-1 (NEW `responseShapeResolvers.js` — 5 deterministic helpers) + HARDEN-2 (slateMlb.js migration) | 2026-05-15 | ✅ SHIPPED |
| 1B | HARDEN-3 — migrate `slateNba.js` onto canonical helpers | — | Held |
| 1C | HARDEN-4 — migrate `marketStatus.js` + `buildIntelligencePresentation.js` snapshot-row readers | — | Held |
| 1D | HARDEN-5 — `probe_response_shape_v1.js` regression-prevention probe | — | Held |
| 1E | HARDEN-6 — `buildMlbWeather.js:49` consolidation | — | Held |
| 1F | HARDEN-7 — `aiSlips` shape disambiguation | — | Held |
| 1G | HARDEN-8 — FE `types.ts` contract cross-validation | — | Held |

**Canonical helpers exported from `responseShapeResolvers.js`:**

| Helper | Use case | Authority |
|---|---|---|
| `resolveSnapshotRows(snap)` | On-disk snapshot rows array (NBA `data.props` OR MLB `data.rows`) | `workstationRoutes.js:135 + :190` |
| `resolveFeaturedCount(state)` | `/api/ws/state` featured plays count | `workstationRoutes.js:~705` |
| `resolveAiSlipCount(state)` | Sum of 4 tier-array lengths from `state.aiSlips` | `workstationRoutes.js:~703` |
| `resolveCandidateCount(state)` | Candidate-pool size from `state.counts.candidates` or `state.candidates` | `workstationRoutes.js:~640 + :~698` |
| `resolveBestAvailableCount(payload, sport)` | Sport-aware best-pick count | `nbaIsolatedRoutes.js:~1477` (NBA) + `mlbIsolatedRoutes.js:~103-612` (MLB) |

**Doctrine:**
1. Route files own response shapes; helpers must conform, never redefine.
2. No observability surface may fork resolution logic.
3. Anti-fabrication: undefined canonical field → `"n/a"` or `[]`. Never synthesize a default.
4. Anti-duplication: helper updates once; consumers rebase automatically.
5. When a future phase evolves an API shape, the helper updates first; every consumer rebases via a single migration commit (Phase 1B style).

---

## INTELLIGENCE-SHAPING DOCTRINE (Phase Intelligence-Shaping-1A, 2026-05-15)

**Diagnostic/observability surfaces are reader-side; they must consult the canonical API authority files, not assume.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | SHAPE-1 (`scripts/slateNba.js` — 4 key-path corrections matching `nbaIsolatedRoutes.js` + `workstationRoutes.js` canonical response shapes) | 2026-05-15 | ✅ SHIPPED — INC-017 RESOLVED |
| 1B | SHAPE-2 — consolidate count-resolution into shared `resolveSlateNbaCounts()` helper | — | Held |
| 1C | SHAPE-3 — populate or remove vestigial `eliteProps`/`strongProps`/`playableProps`/`flexProps` arrays | — | Held |
| 1D | SHAPE-4 — persist `modelProb` + `edge` on every raw `data.props[]` row | — | Held |
| 1E | SHAPE-5 — operator-facing `intel:status` command surfacing structural shape | — | Held |

**Doctrine (mirrors Snapshot-Authority doctrine pattern):**
1. **Canonical response-shape authority is single-sourced** — the route files (`nbaIsolatedRoutes.js` for `/api/best-available`; `workstationRoutes.js` for `/api/ws/state`) own response shapes.
2. **Reader-side carry-forward verification mandatory** whenever upstream API surface evolves. Two consecutive phases (Snapshot-Authority-1A INC-016, Intelligence-Shaping-1A INC-017) caught the same diagnostic-reader-drift anti-pattern.
3. **Anti-fabrication**: when a reader key is undefined, surface `n/a` deterministically; never silently substitute a default.
4. **Anti-duplication for future readers**: Phase 1B (SHAPE-2) will consolidate the count-resolution.

**Canonical API response shapes (operator-facing reference):**

`GET /api/best-available?sport=basketball_nba`:
```js
{
  bestAvailable: { best, elite, strong, ladders, firstBasket,
                   aiSlips, featured, wsCandidates },
  nbaOpportunityBoard, nbaInsightBoard, nbaCacheDiagnostics
}
```

`GET /api/ws/state?sport=nba`:
```js
{
  sport, date,
  counts: { candidates, urgent, propsWithMultiBook, steam, stale },
  candidates: [...],
  featured: [...],
  aiSlips: { safe, balanced, aggressive, lotto },
  lineShopping, timing, portfolio, snapshotFreshness, ...
}
```

---

## SNAPSHOT AUTHORITY DOCTRINE (Phase Snapshot-Authority-1A, 2026-05-15)

**Writer-side authority is canonical and never disturbed by observability or presentation code.**

| Sport | Fetcher | Writer | On-disk file | Canonical row key |
|---|---|---|---|---|
| NBA | `pipeline/nba/fetchNbaOddsSnapshot.js` | `saveNbaSnapshotToDisk` (sync) | `backend/snapshot.json` | `data.props` |
| MLB | `pipeline/mlb/buildMlbBootstrapSnapshot.js` | `saveMlbReplaySnapshotToDisk` (async) | `backend/snapshot-mlb.json` | `data.rows` (also has `data.props`) |

**Reader-side rule (mandatory for every snapshot consumer):**

```js
const rows = snap?.data?.rows || snap?.data?.props || snap?.rows || []
```

The canonical reference implementation lives in `backend/routes/workstationRoutes.js:135 + :190` (`readSnapshotRows`, `readSnapshotRowsWithFreshness`). Every future observability or presentation surface that reads a snapshot file MUST use this exact fallback chain (or its forthcoming `AUTH-3` consolidated helper). The rule is anti-duplication: do not fork the resolution logic.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AUTH-1 (`marketStatus.js:72` fallback) + AUTH-2 (`buildIntelligencePresentation.js:732` fallback) — both mirror the canonical workstation reader pattern | 2026-05-15 | ✅ SHIPPED — INC-016 RESOLVED |
| 1B | AUTH-3 — consolidate into single shared helper + probe asserts both shapes resolve | — | Held |
| 1C | AUTH-4 — close `ENABLE_DISK_SNAPSHOT_LOAD=false` boot-load gap | — | Held |
| 1D | AUTH-5 — rename `snapshot.json` → `snapshot-nba.json` (symmetric naming) | — | Held |
| 1E | AUTH-6 — NBA writer aliases `data.props` as `data.rows` (belt-and-suspenders) | — | Held |

**Doctrine for every Snapshot-Authority phase:**
1. Writer-side authority is canonical; never touched by observability/presentation code.
2. Reader-side fallback consistency: every consumer uses `data.rows || data.props || rows`.
3. Anti-duplication: future readers consult the canonical resolver; do not fork.
4. Anti-fabrication: no reader inserts synthetic rows to mask a count mismatch.
5. Pre/post snapshots mandatory in `backend/runtime/operator/baseline_snapshots/`.

---

## SETTLEMENT ORCHESTRATION DOCTRINE (Phase Settlement-Orchestration-1A, 2026-05-15)

**Completed games must deterministically settle into outcome_snapshots WITHOUT requiring multiple manual operator commands.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AUTO-1 (post-grading chain hook in `runHistoricalGrade.js`) + AUTO-2 (`npm run settlement:run` canonical entry) | 2026-05-15 | ✅ SHIPPED |
| 1B | AUTO-3 — foreground `npm run settlement:watch` watchdog | — | Held |
| 1C | AUTO-4 — in-process background scheduler (opt-in via env var) | — | Held |
| 1D | AUTO-5 — committed cron/systemd unit files | — | Held |
| 1E | AUTO-6 — workstation Dashboard "Settle Tonight's Slate" button | — | Held |

**Daily ceremony post-Phase-1A:**

```bash
# 1. Pre-slate (unchanged)
npm run engine:restart
npm run slate:refresh

# 2. Post-slate (NEW canonical command — replaces 3-command ceremony)
npm run settlement:run

# 3. Verification (unchanged)
npm run grading:status
npm run calibration:status
npm run lineage:status
npm run market:status
npm run brain:checkpoint
```

**`settlement:run` flags:**
- `--sport=mlb|nba|all` — default: all
- `--date=YYYY-MM-DD` — default: today's date
- `--check` — detect-only mode (no writes; calls `nightlyReview.js --check`)
- `--clear-locks` — pre-flight stale-lock sweep (Phase 1F+1G)
- `--no-orchestrate` — grade only; suppress AUTO-1 chain
- `--verbose` — pass through to grading

**Doctrine for every Settlement-Orchestration phase:**
1. Deterministic CLI chains, not heuristic schedulers.
2. Replay-safe — `INSERT OR REPLACE` on outcome_snapshots.
3. Lockfile-protected via existing Phase 1F+1G acquireLock.
4. API-conscious — same total stat-API fetch count.
5. Operator-visible logging at every state transition.
6. Loud failure — non-zero exit when settled rows exist but outcome_snapshots empty.
7. Pre/post snapshots mandatory in `backend/runtime/operator/baseline_snapshots/`.
8. No autonomous schedulers without explicit operator approval gate.

---

## READABLE INTELLIGENCE DOCTRINE (Phase Operator-Experience-1B-1, 2026-05-15)

**Reduce translation cost between sportsbook-native intelligence and operator-native understanding — deterministically.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1B-1** | NEW `frontend/src/workstation/tooltips.ts` (25 deterministic helpers); 82 title= attributes across 7 surfaces; `(2b)` → `(2 books)` abbreviation cleanup | 2026-05-15 | ✅ SHIPPED |
| 1B-2 | 1-line plain-English summary at every card top; SOFT/STALE pill captions | — | Held |
| 1B-3 | PortfolioView band-guide chip; remove phase-tag pollution; nav-label tooltips | — | Held |
| 1B-4 | Operator-toggleable 25-term glossary page | — | Held |
| 1B-5 | Per-pick "why this pick / why this may fail" two-paragraph summary card | — | Held |

**Doctrine for every Operator-Experience-1B phase**:
1. Deterministic translation only — every visible/hoverable string is f(backend fields).
2. Anti-fabrication — undefined input → empty string → caller omits the rendering.
3. Single source of truth — all tooltip / plain-English strings live in `frontend/src/workstation/tooltips.ts`.
4. Cross-reference header — module cites every backend rule (file + line) for audit traceability.
5. Hover-discoverable, never displacement — tooltips expand visible content; never replace it.
6. Zero backend touch per phase unless approved.

---

## ACTIONABLE INTELLIGENCE DOCTRINE (Phase Operator-Experience-1A, 2026-05-14)

**Transform intelligence exhaust into actionable betting intelligence WITHOUT disturbing the underlying intelligence substrate.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | 8 actionable buckets in buildFeaturedPlays (`bestBalanced`, `bestAggressive`, `bestUnders`, `bestAltLadders`, `bestDisagreementEdges`, `staleLineOpportunities`, `trapLadders`, `inflatedSuperstarSpots`) + 3 Phase Market-1A fields lifted onto every compactPlay (`consensusConfidence`/`marketDispersion`/`bestImpDelta`) + ActionableBucketsGrid Dashboard component + inline `conf=X (Nb) volatility:X Δ±X¢` annotations on HeroPickCard / SpotlightCard / FeaturedCard + processNote/avoidReason lifted from tooltips | 2026-05-14 | ✅ SHIPPED |
| 1B | whyQualifies + whyAvoid + tier text labels + mobile @media + keyboard shortcuts + copy-to-clipboard | — | Held |
| 1C | Operator-customizable priority weights + delta surface + drill-down | — | Held |
| 1D | Calibration-coefficient impact surfacing + Phase 1A filter-applied indicators | — | Held |
| 1E | Refined TRAP / INFLATED detection — depends on Market 1B+ | — | Held |

**Discipline for every Operator-Experience phase**:
1. Pre/post snapshots mandatory — `backend/runtime/operator/baseline_snapshots/`.
2. Every visible field must trace to a deterministic backend value (anti-fabrication).
3. New surfaces must declare a top-N cap and auto-hide when empty (anti-clutter).
4. Calibration/market-informed buckets render BEFORE raw exhaust.
5. Zero replay/grading/persistence/market-pipeline path modifications per phase.
6. tsc clean on frontend AND full 150/150 probe matrix unchanged.

---

## MARKET OBSERVABILITY DOCTRINE (Phase Market-Ecology-1A, 2026-05-14)

**Understand sportsbook behavior truthfully BEFORE attempting to exploit sportsbook behavior algorithmically.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | OBS-1 (`npm run market:status`) + OBS-2 (`consensusConfidence` field on buildLineShopping) + OBS-3 (`apiCallLogger.js` wrapping NBA + MLB Odds-API axios calls) | 2026-05-14 | ✅ SHIPPED — observation window open |
| 1B | STALE-1 + CONS-1 + CONS-2 — pending operator gate | — | Held |
| 1C | DISAG-1 + DISAG-2 + ALT-DISAG-1 — pending operator gate | — | Held |
| 1D | INFLATE-1 + ANCHOR-1 — pending operator gate | — | Held |

**Discipline for every Market-Ecology phase**:
1. Read the prior phase's audit document before approving the next gate.
2. Capture `pre_market_*.txt` snapshot in `backend/runtime/market/baseline_snapshots/` BEFORE patching.
3. Run full verification matrix (probes + 14-suite + brain:checkpoint).
4. Open observation window: read `npm run market:status` output across multiple days.
5. Zero new network calls per phase unless explicitly approved by operator.
6. Never auto-trust a "sharp" book or auto-distrust a "soft" book until explicit ANCHOR-1 gate.

**`npm run market:status`** — five sections of canonical market observability:
1. **SNAPSHOT FRESHNESS** — savedAt + total rows + per-book counts per sport snapshot.
2. **CONSENSUS CONFIDENCE DISTRIBUTION** — p10/p50/p90 of `consensusConfidence`; bookCount distribution; top-N multi-book disagreements.
3. **TOP STALE ROWS** — books diverging from consensus by ±2.5¢, tagged `soft_line` (bettor value) or `stale_line` (book overprices).
4. **PER-BOOK HISTORICAL CLV** — 60-day rolling bets / settled / ROI / avgCLV per book.
5. **API-CALL BURN** — rolling 24h / 7d / 30d call counters per sport, per endpoint, with p50/p90/p99 duration.

---

## REALISM ECOLOGY DOCTRINE (Phase Realism-Ecology-1A, 2026-05-14)

**Evolve betting ecology INCREMENTALLY** with measurable longitudinal observation windows. Never stack multiple realism interventions in a single gate — calibration attribution requires single-variable changes.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AGG-2 (`AGGRESSIVE.maxPerGame: 2→1`) + TEXT-1 (`offensiveAttackTextureBonus` over-side `0.032→0.016`) | 2026-05-14 | ✅ SHIPPED — forward observation window open |
| 1B | ALT-1 + PORT-1 — pending operator gate | — | Held |
| 1C | CORR-1 + VOL-1 — pending operator gate | — | Held |
| 1D | AGG-1 + AGG-3 + MLB-AGGRESSIVE-under-only — pending operator gate | — | Held |

**Discipline for every Realism-Ecology phase**:
1. Read the prior phase's audit document before approving the next gate.
2. Capture `pre_realism_*.txt` snapshot in `backend/runtime/calibration_snapshots/` BEFORE patching.
3. Capture `post_realism_*.txt` snapshot AFTER patching.
4. Run full verification matrix (probes + 14-suite + brain:checkpoint).
5. Open observation window: track per-tier hit-rates via `npm run calibration:status` weekly.
6. Effect sizes are DIRECTIONAL until corpus exceeds the INC-012 ceiling.
7. Never hard-disable AGGRESSIVE, LOTTO, or ladders. Never hardcode under-forcing. Never punish specific players.

---

## QUICK REFERENCE — DAILY CEREMONY

```bash
cd ~/Desktop/betting-dashboard/backend

# TERM 1 — start the backend (or restart if already running)
npm run engine:restart                    # safe; kills+starts; echoes every step

# TERM 2 — pre-slate
npm run engine:status                     # is backend up? brain green?
npm run slate:nba                         # NBA hard-reset refresh + diagnostics summary
npm run slate:mlb                         # MLB refresh + diagnostics summary

# TERM 2 — post-slate (after games settle)
npm run grading:run                       # grade today, all sports
npm run grading:review                    # daily intelligence review

# TERM 2 — health verification (anytime)
npm run runtime:verify                    # 14-suite regression matrix
npm run persistence:status                # SQLite vs JSON parity
npm run epoch:status                      # epoch authority diagnostics
npm run persistence:probe                 # idempotency + mirror probes
npm run brain:checkpoint                  # end-of-session brain seal
```

---

## TWO-TERMINAL MODEL (unchanged from prior workflow)

**TERM 1** is the running backend. It blocks on a Node server boot log.
**TERM 2** is everything else — refreshes, grading, verification, brain ceremony.

```
TERM 1 (blocking — backend boot log)        TERM 2 (operator workspace)
─────────────────────────────────────       ─────────────────────────────────────
$ cd ~/Desktop/betting-dashboard/backend    $ cd ~/Desktop/betting-dashboard/backend
$ npm run engine:restart                    $ npm run engine:status
                                            $ npm run slate:nba
[engine:restart] === Phase 1: identify ==── $ npm run slate:mlb
[engine:restart] killing: 12345             $ npm run grading:run
[engine:restart] port 4000: confirmed clear $ npm run runtime:verify
[engine:restart] launching node server.js   $ npm run brain:checkpoint
[SERVER-BOOT-DB-INIT] { ok: true, ... }
[DB-BOOT] { ... }
ACTIVE: nbaIsolatedRoutes.js
ACTIVE: buildNbaOpportunityBoard.js
...
Backend listening on http://localhost:4000
```

---

## CANONICAL COMMAND MAP

### Brain commands (continuity discipline — pre-existing)

| Command | Purpose |
|---|---|
| `npm run brain:bootstrap`  | Surfaces phase / priorities / incidents / 17 laws / do-not-reintroduce. Writes `.brain_bootstrap_state.json`. **First thing every session.** |
| `npm run brain:status`     | Quick freshness snapshot. |
| `npm run brain:verify`     | 11-section freshness audit. |
| `npm run brain:continuity` | Drift detector. Exits non-zero on stale bootstrap / runtime-changed-without-reconcile. |
| `npm run brain:checkpoint` | End-of-session enforcement. Required brain-doc reconciliation + continuity + 14-suite matrix. **Last thing every session.** |

### Engine commands (TERM 1 lifecycle — Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run engine:start`   | Start backend on port 4000. Refuses to start if port is occupied — points you to engine:restart. |
| `npm run engine:restart` | Kill PIDs on port 4000 (with explicit echo of every PID before killing) then start. Replaces the embedded `(lsof -ti tcp:4000 | xargs -r kill -9; sleep 2; ...); node backend/server.js` shell snippet. |
| `npm run engine:status`  | Pure observability — port 4000 occupancy + `/snapshot/status` probe + brain freshness summary + continuity result. Exits 0 even when backend is down (informational). |

### Slate commands (TERM 2 day-of operation — Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run slate:refresh`                  | `GET /refresh-snapshot` — generic refresh. Accepts `-- --sport=nba|mlb` to pass-through. |
| `npm run slate:nba`                      | NBA full ceremony: `GET /refresh-snapshot/hard-reset` → best-available diagnostics → workstation state. Surfaces bestProps count, cache lifecycle, F6.3 match strategy, epoch authority counters. *(Phase Operator-Operations-1A 2026-05-14: route corrected from phantom `POST /api/nba/refresh-snapshot/hard-reset` to canonical `GET /refresh-snapshot/hard-reset`.)* |
| `npm run slate:mlb`                      | MLB full ceremony: refresh → best-available → workstation state. Surfaces row count, snapshot freshness, slate diagnostics. |

### Grading commands (post-slate — Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run grading:run`        | Run historical grading (Tier 1+2 — JSON in-place). Default `--sport=all`. Override with `-- --sport=nba` / `-- --sport=mlb` / `-- --date=YYYY-MM-DD` / `-- --backfill` / `-- --retry-unresolved`. |
| `npm run grading:review`     | Run daily intelligence review. Default `--sport=all`. Override with `-- --sport=...` / `-- --date=...` / `-- --verbose` / `-- --dry-run` / `-- --json` / `-- --summary`. |

### Grading-Calibration commands (Phase Grading-Calibration-Operations-1B/1D/1F/1G, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run grading:backfill`     | Run the canonical `scripts/nightlyReview.js` for one `(sport, date)`. Invokes the full 6-step orchestrator (apply results → post-game review → ledger import → ledger settle → CLV → reports). Writes `outcome_snapshots` + `slip_outcomes` (Tier 3). Pass-through args: `-- --sport=mlb --date=2026-05-08 [--force] [--dry] [--check]`. |
| `npm run grading:backfill-all` | Backfill every `(sport, date)` where JSON tracked_bets is settled but SQLite outcome rows are missing. Iterates dates, calls the canonical CLI per date. Echoes per-date decisions (RUN / SKIP / FAIL). Operator args: `-- --sport=mlb` / `-- --dry` / `-- --force` / `-- --verbose` / **`-- --clear-locks`** (Phase 1F+1G). Idempotent on re-run. |
| `npm run grading:backfill-all -- --clear-locks` | **Phase 1F (INC-014) + Phase 1G (INC-015)** — pre-flight stale-lock sweep. Scans `runtime/tracking/.nightly_lock_*`, probes each recorded pid with `process.kill(pid, 0)`, reports + reclaims dead pids (`reclaimed-dead`), reports + reclaims alive-pid-but-stale (>10 min old) entries (`reclaimed-stale` — pid reuse), leaves alive+fresh alone (`alive`). Combine with `--dry` for scan-only preview. |

**Lock state machine (Phase 1F + 1G combined)** — `acquireLock` decision tree per existing lockfile:

| Lock age | PID probe | Outcome |
|---|---|---|
| 0–10 min | alive | Honor (legitimate concurrent run) |
| 0–10 min | dead (ESRCH) | Reclaim |
| 10–30 min | alive | Reclaim with `[acquire-lock][INC-015]` console warning (pid reuse) |
| 10–30 min | dead | Reclaim |
| >30 min | any | Reclaim (hard TTL) |

Watch for `[acquire-lock][INC-015] Reclaiming ...` warnings — those are pid-reuse events the orchestrator now self-heals.

| `npm run grading:status`       | Per-date parity inspector. Per-`(sport, date)`: JSON tracked_bets total + settled count vs SQLite `outcome_snapshots` row count + **JOIN-success count (Phase 1D)** + slip parity. Surfaces lag/gap (Δ). Includes personal-ledger settlement state. |
| `npm run calibration:status`   | Calibration corpus health: per-tier hit rate + delta_prob, per-volatility, per-side, per-stat-family (top 10), Session W table population, global Brier score. **Phase 1D adds**: JOIN-restricted coverage diagnostics + sample-size warnings + classification-health check (replaces the misleading "see prediction_id_aliases" hint). |
| `npm run lineage:status`       | **Phase 1D** — canonical lineage-health inspector. Global totals (predictions / outcomes / JOIN matches / orphans both sides). Per-date breakdown with coverage status (HEALTHY ≥80% / PARTIAL 50–80% / LOW <50% / PRE-CORPUS 100%-orphan). Classification health (hit IS NOT NULL fraction). Sample orphan ids per side. Canonical byte-parity regression-guard. |

### Runtime verification (Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run runtime:verify` | 14-suite regression matrix with operator-friendly summary. Single PASS/FAIL verdict at end + per-suite timing. Same suites brain:checkpoint runs. |

### Persistence commands (Phase Persistence-1B, 2026-05-14 — pre-existing)

| Command | Purpose |
|---|---|
| `npm run persistence:status`            | SQLite row counts vs JSON inventory + ledger parity + divergence log + alias summary. |
| `npm run persistence:probe`             | Idempotency + ledger-mirror probes (22+22 = 44 checks). |
| `npm run persistence:import`            | One-time idempotent backfill of dormant SQLite tables from JSON. |
| `npm run persistence:backfill-aliases`  | Populate `prediction_id_aliases` for composite-key forward compatibility. |

### Epoch command (Phase Longitudinal-Integrity-1B, 2026-05-14 — pre-existing)

| Command | Purpose |
|---|---|
| `npm run epoch:status` | `prediction_epochs` row counts grouped by formula prefix, sport, source. Most-recent 5 per sport. Canonical helper diagnostics. |

---

## PRE-SLATE CEREMONY (typical day)

```bash
cd ~/Desktop/betting-dashboard/backend

# 1. Session start — load operator memory + verify continuity
npm run brain:bootstrap
npm run brain:continuity        # must PASS

# 2. Verify backend is up + brain is green
npm run engine:status

# 3. If backend is down, start it (TERM 1)
#    npm run engine:restart      # or engine:start if port is clear

# 4. Refresh slates
npm run slate:nba
npm run slate:mlb

# 5. Quick health check
npm run runtime:verify          # 14/14 PASS expected
npm run persistence:status      # parity check
npm run epoch:status            # epoch authority state
```

---

## POST-SLATE CEREMONY (after games settle)

```bash
cd ~/Desktop/betting-dashboard/backend

# 1. Tier 1+2 — Grade today's bets + slips in JSON (in-place result fields)
npm run grading:run -- --date=$(date +%Y-%m-%d)

# 2. Tier 3 — Orchestrator: writes SQLite outcome_snapshots + slip_outcomes,
#             updates personal_ledger, runs Session W daily review (Phase
#             Grading-Calibration-Operations-1B, 2026-05-14)
npm run grading:backfill -- --sport=mlb --date=$(date +%Y-%m-%d)
npm run grading:backfill -- --sport=nba --date=$(date +%Y-%m-%d)
# OR (one shot) backfill every settled date that's still missing in SQLite:
#   npm run grading:backfill-all

# 3. Verify grading + calibration health
npm run grading:status                 # JSON-vs-SQLite parity (Δ should be 0); JOIN column shows lineage match per date
npm run lineage:status                 # orphan accounting + coverage status per date (Phase 1D)
npm run calibration:status             # per-tier hit rate, delta_prob, Brier — JOIN-restricted (Phase 1D)

# 4. (Optional) Tier 4 — separately runnable: daily intelligence review
#                       (already invoked as Step 9 inside `grading:backfill`)
npm run grading:review -- --date=$(date +%Y-%m-%d) --verbose

# 5. Verify persistence integrity
npm run persistence:status
npm run epoch:status

# 6. Seal brain receipt + run regression matrix
npm run brain:checkpoint
```

---

## FAILURE RECOVERY WORKFLOW

### Backend unresponsive / port 4000 stuck

```bash
npm run engine:status           # confirm symptoms
npm run engine:restart          # kills + restarts; echoes every PID it kills
```

The `engine:restart` script will print every PID before killing it. If the kill fails or the port stays occupied, it exits non-zero with a clear error.

### Refresh blocked by stuck mutex

If `[REFRESH-MUTEX-STUCK]` appears in TERM 1 log (Phase Race-1 watchdog from 2026-05-14), the mutex has been held > 5 minutes. Resolution:

```bash
npm run engine:restart          # the canonical recovery
```

The watchdog is observability-only — it does NOT auto-release the mutex. Operator restart is the recovery path.

### 14-suite regression fails

```bash
npm run runtime:verify          # see which suite(s) failed
# Inspect failed suite output:
node backend/scripts/verify<NameOfFailedSuite>.js
```

The runtime:verify summary prints `stderr tail` for each failure.

### Ledger divergence detected at boot

If `[LEDGER-DIVERGENCE-DETECTED]` fires (Phase Persistence-1B), JSON and SQLite ledger row counts diverge:

```bash
npm run persistence:status      # shows the delta
npm run persistence:import      # idempotent backfill — fills SQLite from JSON
npm run persistence:status      # verify parity
```

### Brain continuity FAIL

```bash
npm run brain:continuity        # see which threshold tripped
# Common case: runtime code changed without checkpoint
npm run brain:checkpoint        # reconciles receipt hashes
```

---

## ORDERING RULES (the only ceremony rules that matter)

1. **`brain:bootstrap` FIRST** every session. Loads operator memory + writes receipt.
2. **`brain:checkpoint` LAST** every session. Reconciles receipt + runs regression matrix.
3. **`engine:start` / `engine:restart` BLOCKS** TERM 1. Don't run from TERM 2.
4. **`engine:status` is read-only.** Safe to run anytime.
5. **`slate:*` requires the backend to be up.** Run `engine:status` first if unsure.
6. **`grading:*` does NOT require the backend.** Operates on JSON tracking files directly.
7. **`runtime:verify` is idempotent.** Safe to re-run as often as you like.
8. **`persistence:probe` uses `/tmp`.** Does NOT touch production `betting.db`.

---

## SAFETY GUARANTEES (Phase Operator-Operations-1 design contract)

This phase establishes operational standardization. It does NOT:

- ❌ Auto-kill processes silently — `engine:restart` echoes every PID before killing.
- ❌ Hide failures — every script prints HTTP status, exit code, error messages.
- ❌ Modify runtime authority — these scripts only invoke existing endpoints/CLIs.
- ❌ Change replay / freeze / grading / snapshot / mutex behavior.
- ❌ Reduce observability — every script is verbose-by-default.
- ❌ Wrap dangerous operations behind innocuous names — naming follows operator vocabulary.

Every new operational command is:

- ✅ Transparent — echoes what it's about to do before doing it.
- ✅ Additive — does not remove or rename any existing command.
- ✅ Continuity-aware — works alongside brain:* discipline.
- ✅ Replay-safe — never touches snapshot.json or freeze tables directly.
- ✅ Grading-safe — defers to existing grading CLIs.

---

## REFERENCE — what each new script actually does

| npm command | Script | What it actually runs |
|---|---|---|
| `engine:start`   | `backend/scripts/engineStart.sh`   | Check port 4000 clear → `exec node server.js` |
| `engine:restart` | `backend/scripts/engineRestart.sh` | `lsof -ti tcp:4000` → echo PIDs → `kill -9` → verify clear → `exec node server.js` |
| `engine:status`  | `backend/scripts/engineStatus.js`  | `lsof -i tcp:4000` + HTTP GET `/snapshot/status` + spawnSync `brain:status` + spawnSync `brain:continuity` |
| `slate:refresh`  | `backend/scripts/slateRefresh.js`  | HTTP GET `/refresh-snapshot[?sport=...]` |
| `slate:nba`      | `backend/scripts/slateNba.js`      | GET `/refresh-snapshot/hard-reset` → GET `/api/best-available?sport=basketball_nba` → GET `/api/ws/state?sport=nba`  *(canonical hard-reset endpoint; server.js:19471 — Phase Operator-Operations-1A 2026-05-14)* |
| `slate:mlb`      | `backend/scripts/slateMlb.js`      | GET `/refresh-snapshot?sport=baseball_mlb` → GET `/api/best-available?sport=baseball_mlb` → GET `/api/ws/state?sport=mlb` |
| `runtime:verify` | `backend/scripts/runtimeVerify.js` | spawnSync each `verify*.js` in turn; aggregate verdict |
| `grading:run`    | `backend/scripts/gradingRun.js`    | spawnSync `runHistoricalGrade.js` with operator args (defaults `--sport=all` if absent) |
| `grading:review` | `backend/scripts/gradingReview.js` | spawnSync `runDailyReview.js` with operator args (defaults `--sport=all` if absent) |

---

_Phase Operator-Operations-1 — 2026-05-14. Additive only; no existing command modified._
