# FULL REPOSITORY ENGINEERING SYSTEMS AUDIT
**Institutional-grade evaluation — May 14, 2026**

_Prior audits this work updates rather than duplicates:_
- `docs/ARCHITECTURE_AUDIT_2026-05-09.md` (Session X — Architectural Truth Discovery)
- `docs/NBA_ECOLOGY_AUDIT_2026-05-09.md` (Session Z — NBA Ecology Constitution)
- `docs/MLB_CONSTRUCTION_TRACE_2026-05-09.md`
- `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`

_Files read for this audit:_
`backend/runtime/brain/MASTER_BRAIN.md`, `CURRENT_STATE.md`, `NEXT_SESSION.md`, `ARCHITECTURE.md`, `WORKFLOW_RULES.md`, `BOOTSTRAP_PROMPT.md`, the two prior 2026-05-09 audits, `backend/scripts/brain/{enforceBrainCheckpoint,assessContinuity,loadBrainContext,brainSyncSummary,verifyBrainFreshness}.js`, `backend/storage/intelligenceSchema.js`, `backend/package.json`.

_Notable absence in the brain directory:_ `MASTER_BRAIN.md` references `CURRENT_RUNTIME_STATE.md`, `OPERATOR_PROTOCOL.md`, `ARCHITECTURE_LAWS.md`, `ACTIVE_INCIDENTS.md`, `MODEL_EVOLUTION_LOG.md`, `PIPELINE_AUTHORITY_MAP.md`, `SPORTSBOOK_CONTRACTS.md`. None of these files currently exist on disk. The brain doctrine declares them; the filesystem has not yet been split out from `MASTER_BRAIN.md`. **This is a finding, surfaced under §AI Workflow Review.**

---

## EXECUTIVE SUMMARY

This repository is no longer a single-sport tracking dashboard. It has evolved — in the five days between the 2026-05-09 architectural audit and today — into an **AI-assisted multi-sport prediction-and-grading platform with an institutional engineering memory layer**. The brain doctrine, continuity receipts, eager DB init, and longitudinal freeze pipeline together represent a step-change in operational maturity. The system now thinks in **epochs**, not just nightly batches: every prediction is captured (`prediction_snapshots`), every contextual layer that informed it is captured (`frozen_contextual_states`), every settled outcome attributes back to it (`outcome_snapshots`), and every brain mutation is hash-verified against a continuity receipt.

That said, the structural debt called out in the May 9 audit is largely unresolved, and the new infrastructure has been **layered on top of**, not into, the existing monolith. The 21k-line `server.js` still hosts the live snapshot globals, the dual-mutex bug, and the surface where most race risk lives. The NBA pipeline still has five overlapping slip modules; the workstation still imports NBA-specific signals at the top of a supposedly sport-agnostic route file; `personal_ledger.json` is still 2.3MB and read-on-every-state. The recent work has been **vertical** (deepening longitudinal observation) rather than **horizontal** (extracting / unifying / pruning the legacy substrate).

The system is now sophisticated enough that its weaknesses are concentrated, not diffuse. There are roughly **five high-leverage hotspots** where 80% of the future operational risk lives, and a much larger surface of low-grade clutter that is annoying but not load-bearing.

**Overall engineering maturity: 6.4 / 10** (up from 6.1 on 2026-05-09 — the brain layer alone is worth +0.6, but persistence and monolith debt are unmoved).

**Overall betting-engine maturity: 5.9 / 10**. MLB is genuinely thoughtful (Phase 1/1B/2 contextual derivers, immutability hardening, future-only filter, calibration honesty). NBA's intelligence is sophisticated *as a pipeline* but architecturally orphaned from the workstation that bettors actually see — the NBA ecology audit of 2026-05-09 still describes the current production reality.

**Biggest strengths:**

1. **The longitudinal memory layer is real.** Composite-PK frozen contextual states, `INSERT OR IGNORE` immutability, dual freeze paths (snapshot + workstation) with deterministic epoch ids, and a probe corpus that proves the writes — this is rare engineering discipline for a system this size.
2. **The brain doctrine is operational, not aspirational.** `npm run brain:{bootstrap,status,verify,continuity,checkpoint}` exists, runs, hashes runtime against doc state, and exits non-zero on drift. This is the single most underrated asset in the repo.
3. **F-series contract discoveries are encoded as laws.** Eight separate upstream API-NBA contract subtleties were discovered live, fixed, and added to a "DO NOT REINTRODUCE" list. The repo has institutional memory of its own scar tissue.

**Biggest weaknesses:**

1. **`server.js` is still a 21k-line single-file Express monolith** holding 12+ mutable module globals, two separate `__refreshInProgress` mutexes (a known race), and the only place where the live odds snapshot is mutated.
2. **NBA has two execution paths that never reconcile.** The pre-existing NBA ecology audit (2026-05-09) describes a path the workstation does not use — and that audit's verdict ("emotionally dead, ladders weak, role spikes invisible") still applies because none of NBA-1 → NBA-4 has shipped.
3. **The brain doctrine is internally inconsistent.** `MASTER_BRAIN.md` is the only file that exists in the brain directory, yet it directs every reader to seven sibling files (`OPERATOR_PROTOCOL.md`, `ACTIVE_INCIDENTS.md`, etc.) that do not. A reader following the bootstrap protocol literally cannot read the files they are told to read.

**Biggest future risks:**

1. **Multi-sport scaling collision.** NFL/NHL cannot land cleanly while `workstationRoutes.js` imports `nbaRowModelProbability` at the top of the file. Adding a third sport will multiply the existing NBA/MLB asymmetry, not absorb it.
2. **Longitudinal table unbounded growth.** No retention policy is defined for `prediction_snapshots`, `frozen_contextual_states`, or `outcome_snapshots`. At MLB nightly scale, these are on track to be the largest tables in the system within 90 days.
3. **The dual-freeze redundancy will eventually produce divergence.** Two freeze writers, two epoch generators, one composite PK to keep them apart — this is correct today, but the first time someone touches the `epochId` derivation without touching both writers, the rows will silently fork.

---

## NUMERICAL SCORING

| Domain | Score (1–10) | Direction vs 2026-05-09 |
|---|---|---|
| Architecture quality | **5.8** | ↑ (+0.3 — brain layer + longitudinal schema + composite-key normalization) |
| Scalability | **5.5** | flat (monolith unchanged; sport-specific imports unchanged) |
| Operational maturity | **7.0** | ↑↑ (+1.5 — brain commands, continuity receipt, eager DB init, immutability hardening) |
| Data integrity | **6.5** | ↑ (+0.5 — composite-PK normalization, INSERT OR IGNORE, immutability hardening, freshness oracle) |
| Authority topology | **6.5** | ↑ (+0.5 — single canonical owner per subsystem now declared in MASTER_BRAIN) |
| Performance bottlenecks | **5.0** | flat (timing_intelligence_state.json still 729KB; personal_ledger.json still 2.3MB; per-request `/api/ws/state` still rebuilds slips) |
| Future scaling risk | **5.0** | ↓ (-0.5 — added two new tables and a brain system to scale across sports without defining the cross-sport contracts) |
| Model realism (MLB) | **7.0** | flat (Phase 1B/2 derivers + calibration honesty are correct; recent-form audit still pending) |
| Model realism (NBA) | **3.5** | flat (NBA ecology audit findings unaddressed; realismScore at 70% unchanged) |
| Betting-engine realism | **5.0** | flat (PRA still always aggressive; lotto still structurally empty; alt lines still gated) |
| Anti-fragility | **6.0** | ↑ (+0.7 — lazy-require freeze, try/catch wrap, fallback caches, eager init means boot-time loud failure) |
| Orchestration quality | **5.5** | flat (`buildNightlyOrchestrator.js` still not the canonical entry point; nightly scripts still hit HTTP) |
| Observability completeness | **7.5** | ↑↑ (+1.5 — `nbaCacheDiagnostics`, rate-limited probes, ring-buffer samples, `[DB-BOOT]`, `[NBA-SNAPSHOT-FREEZE]`, etc.) |
| AI workflow maturity | **8.0** | ↑↑↑ (+2.0 — brain commands, hash-receipt continuity, checkpoint enforcement, phase tags inline) |
| Technical debt concentration | **5.5** | ↑ (+0.5 — debt is now better-mapped; still mostly unresolved) |
| Hidden failure surface | **5.5** | ↑ (+0.5 — fewer silent failures thanks to observability; new surface added with longitudinal layer) |
| Long-term maintainability | **5.8** | ↑ (+0.3 — brain layer materially aids future AI sessions) |

**Weighted overall: 6.0 / 10.** The brain and longitudinal layers are doing real work. The legacy monolith and NBA ecology are dragging.

---

## TOP STRENGTHS (ranked)

1. **Brain enforcement layer (`backend/scripts/brain/*`)** — `loadBrainContext`, `brainSyncSummary`, `verifyBrainFreshness`, `assessContinuity`, `enforceBrainCheckpoint`. SHA-256 receipt of doc + runtime hashes. Drift detection with env-tunable thresholds. Checkpoint that **exits non-zero** when runtime code moved without a corresponding brain doc update. This is institutional engineering discipline most teams never build.
2. **Longitudinal memory schema (`intelligenceSchema.js`)** — `prediction_snapshots` immutable with composite id, `frozen_contextual_states` with `(prediction_id, epoch_id)` PK, `outcome_snapshots` joining via id, `raw_json` columns on every table for forward-compat. The schema design is excellent.
3. **Composite-key normalization (Phase E1)** — `normPlayer` with NFD+combining-strip+lowercase, `normFam` collapsing casing/whitespace/hyphenation, `canonicalBook` resolving alias variants. **Single authoritative function** for each, with `[CANONICALIZATION-COLLISION-DETECTED]` logged once per kind. This kills an entire class of silent bug.
4. **Snapshot freshness as a single oracle (`snapshotFreshness.js`)** — and `mlbFutureOnly.isFutureOnly` using strict `>` not `>=`. Both are anti-pattern-of-the-anti-pattern: where most systems have time-comparison drift everywhere, this repo declared one source of truth.
5. **Immutability hardening (MLB Phase E2)** — `INSERT OR IGNORE` only on frozen tables; `INSERT OR REPLACE` forbidden; explicit admin bypass flag for legitimate re-derivation. Historical replay is preserved by design.
6. **Calibration honesty (`probabilityHonesty.js`)** — `if (v == null) return null` rather than silently synthesizing 0.5. This is a discipline that does not exist in most prediction systems.
7. **F-series contract discovery loop** — every upstream API failure mode (season required, team required, team-must-be-numeric, search-incompatible-with-team) became a `KNOWN FAILURE PATTERNS` row, an inline phase tag, and a `DO NOT REINTRODUCE` entry. The repo learned from each incident.
8. **Daily review engine (`pipeline/review/*` — Session W)** — `buildEcologyGrader.js` detecting `hrEruptionMiss` as a MAJOR FINDING is exactly the right feedback-loop design: the system can detect when its own suppression overcorrected.
9. **Workstation API contract (`/api/ws/*`)** — frontend never calls legacy server.js routes. Clean boundary. Easy to evolve either side.
10. **`pipeline/shared/` as the intelligence nucleus** — the canonical pattern (featured plays, slips, portfolio, line shopping, timing, ledger, CLV) is real and respected by the workstation path.

---

## TOP RISKS (ranked by combined likelihood × blast radius)

1. **`server.js` dual-mutex race (`__refreshInProgress`)** — module-level `let __refreshInProgress` at line 10091 and `global.__refreshInProgress` at line 19052 are two different mutexes. MLB and NBA refreshes do not block each other. Concurrent refreshes corrupt shared global state. **Today this is latent because triggering is manual. Any move toward scheduled refreshes makes it live.**
2. **NBA two-path architecture** — five slip builders running in the nightly pipeline produce `nba_tracked_slips_*.json` that the workstation ignores; the workstation re-derives slips via MLB-calibrated `buildSlipAi.js`. The sophisticated NBA intelligence (aiRange, correlation stacks, lane separation) never reaches the bettor surface. The 2026-05-09 NBA ecology audit's diagnosis is still operationally true.
3. **Longitudinal tables have no retention policy** — `prediction_snapshots`, `frozen_contextual_states`, `outcome_snapshots` will grow monotonically. MLB nightly scale (200-300 candidates/night × 162-game season × multi-year) puts these tables at multi-million rows quickly. No `idx_*_run_date` partitioning, no retention/aggregation job defined.
4. **Brain doctrine references seven sibling files that don't exist** — `OPERATOR_PROTOCOL.md`, `ARCHITECTURE_LAWS.md`, `ACTIVE_INCIDENTS.md`, `MODEL_EVOLUTION_LOG.md`, `PIPELINE_AUTHORITY_MAP.md`, `SPORTSBOOK_CONTRACTS.md`, `CURRENT_RUNTIME_STATE.md`. Any AI session that follows the bootstrap protocol literally will fail to read what it's told to read. The doctrine has outpaced the filesystem.
5. **Dual freeze paths share PK structure but not codegen** — `_lazyFreezePredictionEpoch` (snapshot path, Session BD) and `freezePredictionEpoch` (workstation path, Session AZ) both write to `frozen_contextual_states` with composite `(prediction_id, epoch_id)` PKs. The two writers compute `epoch_id` independently. The first time someone changes one without the other, rows will fork silently — and the immutability rule (`INSERT OR IGNORE`) means the second writer's row will be the no-op, silently dropping data.
6. **`personal_ledger.json` is still 2.3MB on disk + read on every relevant request** — the SQLite write mirror exists but the read path is still JSON. Any divergence between the two is silent. The ledger is the highest-value historical artifact in the system and the most fragile.
7. **`workstationRoutes.js` imports NBA-specific signals at module top** — `nbaRowModelProbability`, `nbaRowEdge`, `enrichNbaRowStatLayerInputs` are loaded for every request regardless of sport. This is the single largest barrier to clean NFL/NHL onboarding.
8. **11,185 lines of confirmed-dead inlined NBA code on disk** — `http/nbaBestAvailable.inlined.js` + `http/nbaRefreshSnapshot.inlined.js`. Still unimported. Still confusing every reader. The 2026-05-09 audit said "delete immediately." They are still here.
9. **`timing_intelligence_state.json` at 729KB and growing, with no pruning** — single-threaded Express. Multi-megabyte JSON parse on every `/api/ws/timing` request. Latency cliff inevitable.
10. **NBA candidate gate `propVariant !== "base"`** — silently kills the entire ladder system, silently degrades aiRange resolution to base lines, silently produces the "emotionally flat" symptom. This is one line of code with multi-page architectural consequences.

---

## HIDDEN FAILURE PATTERNS

These are risks the operational metrics will not surface until they trip.

1. **Composite-key forward-only migration creates "two histories"** — `MASTER_BRAIN.md` §Entity Rules: *"Historical predictions persist under their pre-fix id: composite-key changes are forward-only; backfill is not retroactive (replay safety)."* This means any cohort analysis that spans the E1 boundary will count the same player twice if their name had a diacritic, casing variant, or alias. Calibration drift across the E1 boundary will appear as real model improvement when it's actually deduplication. The fix would be a `prediction_id_aliases` lookup table; absent that, every longitudinal analysis needs explicit `WHERE created_at > <E1-date>` guards.
2. **Brain receipt locks runtime hash to brain-doc hash — but not to actual correctness** — `assessContinuity.js` reports FAIL when runtime code is modified without brain doc updates. It does *not* verify that the brain doc update is *true*. A session can update `CURRENT_STATE.md` with text that disagrees with the code change and pass the checkpoint. The discipline is hash-based, not semantic.
3. **`INSERT OR IGNORE` on `frozen_contextual_states` silently drops the second writer when both freeze paths fire for the same `(prediction_id, epoch_id)`** — the comment in `MASTER_BRAIN.md` claims the two writers typically use different `epoch_id`s. "Typically" is doing a lot of work. If `epochId = snapshotUpdatedAt + slate` and both paths see the same snapshot before `replaceOddsSnapshot` advances, the workstation freeze (richer data) will be the IGNORE'd no-op while the snapshot freeze (NULL contextual data) survives. **The contextual-rich row would lose to the bare row.** This is the inversion of what an operator would want.
4. **`PRA` always-aggressive volatility creates a calibration trap** — every PRA play gets classified as aggressive *for slip routing*, but its `model_prob` and `edge` are computed honestly. The `outcome_snapshots.delta_prob` for PRA will tell the calibration system that "aggressive" plays are well-calibrated. They're not — they're balanced plays misrouted. The system will appear to calibrate while routing incorrectly.
5. **Single-process roster cache vs disk-persisted player-id cache asymmetry** — Phase F6.3 added an in-process `__nbaTeamRosterCache` Map but did NOT add disk persistence. Process restart re-fetches 30 rosters before any cache hits. On a busy night this is 30 sequential API-Sports calls during the first refresh window. Under rate-limited upstream this is a startup performance cliff and a partial-cold-cache hazard if a restart happens mid-slate.
6. **`buildSlipAi.js` is called per-request, not cached** — every `/api/ws/state?sport=nba` request rebuilds the AI slips on the fly from disk-read candidates. The 5-NBA-builder nightly output sits unused. Workstation latency is bound by slip construction, not by I/O. As the candidate pool grows, latency will climb without a single new feature.
7. **`importHistoricalData.js` reads `mlb_tracked_bets_*` but legacy `tracked_props_*.json` (14 files, April 18–28) are not imported** — the comment in `schema.js` says they map to `tracked_props` but the importer paths target a different filename pattern. Two and a half weeks of pre-Phase4 history may already be permanently inaccessible to SQLite-backed analytics.
8. **The nightly scripts hit `localhost:4000` over HTTP** — if `server.js` is restarted mid-nightly, `ECONNREFUSED` is treated the same as a data error. No retry. No idempotency. A 60-second outage during the nightly window = missing data for that date with no automatic re-run.
9. **`alpha = 0.82–0.92` market-anchoring on NBA** — the model is mostly the market. The very plays the system is built to find (informational edge from injury, role spike, pace explosion) are the plays the model is structurally prevented from signaling. The NBA ecology audit names this as Conflict 2; the calibration-honesty layer cannot fix it because honesty preserves NULLs, not aggression.
10. **`buildNightlyOrchestrator.js` Step 9 (daily review) wraps in try/catch and absorbs failures** — correct for resilience, but the absorbed failure has no alerting path. The review engine can silently stop running for days and the only signal is "no recent review files in `runtime/tracking/`." There is no dead-man's switch.
11. **`FirstBasketView.tsx` is permanently dark in the UI** — the section exists, the navigation exists, the data path does not. The operator has been trained to ignore an entire UI surface. Whenever the data path is finally wired, the operator's attention pattern will not include it.
12. **The `volatility` field on snapshot-sourced NBA candidates is being ignored** — NEXT_SESSION Path A names this. The model has its own signal. The static `VOLATILITY_RULES` overrides it. Every day this isn't fixed, the system's predictions are being systematically degraded for slip routing.

---

## ARCHITECTURAL HOTSPOTS

These are the zones where coupling is dangerous, not just messy. Touching anything here without full audit is high-risk.

1. **`server.js` lines 6,169 → `buildLiveDualBestAvailablePayload`** (~433 lines) and **line ~13,909 `scorePropRow`** (~249 lines). Both close over every MLB/NBA global. These are the load-bearing functions of the live pipeline. They are the reason `server.js` cannot be incrementally extracted: every other function in the monolith eventually flows through here.
2. **`workstationRoutes.js` lines 575 + the imports at top of file** — single call site for `freezePredictionEpoch` in the workstation path; sport-specific NBA imports at module top. This file is simultaneously the cleanest API surface in the repo and the place where sport agnosticism is being silently violated.
3. **`backend/http/nbaIsolatedRoutes.js`** — owns enrichment cache (owner-B canonical), player-id resolution, team registry, roster memo, and snapshot freeze hook. The F-series has piled five concerns into one file. Any future incident will start here and the diagnosis surface is intentionally rich, but the file is doing too many jobs.
4. **`backend/storage/intelligence.js`** + **`db.js`** + **`intelligenceSchema.js`** + **`schema.js`** — four files implementing one persistence layer, with `applySchema()` chaining to `applyScreenshotSchema()` + `applyReviewSchema()` while `intelligenceSchema` is applied separately. A future schema addition can be silently missed unless the chain is found and edited at the right point. **`applyAllSchemas(db)` as a single entry point would close this hole permanently.**
5. **Dual freeze writers (`_lazyFreezePredictionEpoch` in `nbaIsolatedRoutes.js` + `freezePredictionEpoch.js`)** — two implementations of the same conceptual operation, differing in contextual richness. Composite PK keeps them apart "typically." The epoch_id derivation logic is split across files.
6. **`buildPersonalLedger.js` (1,164 lines)** — file I/O, analytics, nightly import, dual-write to SQLite. The single largest non-server.js module. Touches the most operationally-precious state (the ledger). Read path + write path + import path + analytics in one file.
7. **`MASTER_BRAIN.md` itself** — 389 lines authoring institutional doctrine and pointing at seven sibling files that do not exist. This file is doing the work of an entire `docs/brain/` directory.
8. **`oddsSnapshot` global in `server.js`** — mutated by both MLB and NBA paths, atomically replaced by `replaceOddsSnapshot(snap)`, read by 41+ routes. The most-touched mutable global in the codebase.

---

## MODEL REALISM REVIEW

**MLB — credible.** The Phase 1B contextual derivers (`deriveMlbWeatherContext`, `deriveMlbPitcherEnvironmentContext`, `deriveMlbLineupContext`, `deriveMlbBullpenContext`, `deriveMlbHandednessContext`, `deriveMlbParkContext`) compose a real environment around each candidate. Phase 2 live state (lineup confirmation, weather delta, bullpen state, line movement) refines it as game time approaches. `calibrationHonesty` preserves NULLs. `mlbFutureOnly` is strict `>`. `INSERT OR IGNORE` keeps the historical signal honest. **The MLB ecology audit findings from Session T (HR tiering, suppression calibration, texture corrections) are load-bearing and intact.** This is a system that has earned its predictions.

**NBA — not credible enough.** `realismScore × 0.70 + probability × 0.15 + edge × 0.10 + contextScore × 0.05` is an opportunity-ranking model, not an edge-detection model. Stars dominate by usage, not by mispricing. Dynamic multipliers (form/usage/matchup) capped at 1.18–1.25× cannot overcome a star's 33%+ realismScore advantage even when a role player has 3× the edge. Market-anchored `alpha = 0.82–0.92` keeps the model glued to the closing line — the exact regime in which "edge" becomes ceremonial. **The NBA system can predict; it cannot beat.**

**Slip construction realism:**

- The MLB workstation path runs candidates through `buildMlbPropClusters` ecology tiers (Session T fixes intact). NBA has no equivalent — `tier` is stamped by `nbaIsolatedRoutes.js` during snapshot scoring, then `buildFeaturedPlays`'s `tierBoost` fires on that unqualified field. **NBA tiers are decorative, not load-bearing.**
- `VOLATILITY_RULES` is static. The model's own `volatility` field is ignored. PRA at -120 is classified `aggressive` regardless of context. **The system has its own volatility signal and is choosing not to use it.**
- Lotto tier is structurally empty because alt lines are gated out of the workstation pool, so `resolveLegFromAiRange()` falls through to base lines. **The architecture was designed to use ladders for upside. The gate removes all of them. The fallback is to copy the aggressive slip with a flag.** The lotto tier is performative.

**Honest summary:** MLB is a real model with real predictions. NBA is a real ranking with a market-anchored probability shrinkage. They are not the same kind of thing, but the workstation surfaces them as if they were.

---

## SPORTSBOOK REALISM REVIEW

**Diversity** is partially earned, partially performative.

- The `diversifyCandidates` caps (3/player, 12/game, 10/stat, 6/stat-side) are correct guardrails. **They work.**
- Side-balance caps (`maxSideFraction: 0.60`, anchors 0.55) and `sortAnchorsForDisplay (U·O·U·O·U)` produce visually-diverse anchors. **They work.**
- But within those caps, the candidate pool is still systematically star-skewed for NBA and pitcher-anchored for MLB. The caps prevent *visible* monoculture; they do not produce *real* diversity of conviction.

**Portfolio texture** — `buildPortfolioOptimizer.js` classifies volatility correctly for MLB (`outs` fix on 2026-05-07, HR/HR-tier rules in place). For NBA, the same module forces PRA → aggressive and most overs → balanced, producing a portfolio whose volatility distribution does not match the bettor's actual risk surface. **Texture is correct for MLB and inverted for NBA.**

**Under/over balance** — side caps work. Side-aware texture boosts (`isOffensiveAttackStat` on over for offensive stats) correctly amplify directional plays. **But the `isOffensiveAttackStat` function is duplicated between `buildFeaturedPlays.js` and `buildSlipAi.js` (offensiveAttackTextureBonus, inline).** When the definition diverges, the featured board and the AI slips will produce different verdicts for the same candidate, silently. The 2026-05-09 audit called this out; it is unfixed.

**Ladder realism** — MLB has `buildBestLadders` working from edge. NBA has alt-line gating that prevents ladder construction in the workstation. **For NBA, the ladder system is dead architecture.**

**Safe / aggressive lane realism** — the safe lane has `minModelProb 0.55, maxOdds 150`, premium-edge override `edge >= 0.12 + modelProb >= 0.50` (correct, calibrated). The aggressive lane has `allowedVolatility: any`, which makes it a re-projection of the safe pool at lower modelProb. **Aggressive ≠ safe-with-different-thresholds. The lane separation is nominal, not philosophical.**

**Sportsbook diversification** — line shopping intelligence (`buildLineShoppingIntelligence.js`, 527 lines) and book canonicalization (`canonicalBook` in `intelligence.js`) work. Multi-book spreads are detected, value alerts emit. **This is one of the strongest layers in the system. It is also among the most underexposed in the UI.**

---

## OPERATIONAL MATURITY REVIEW

**Observability — strong.** `nbaCacheDiagnostics` block surfaced via `/api/best-available`, defensive shallow-copies on internal state, rate-limited probes (`[NBA-CACHEABILITY-GATE]`, `[NBA-API-SPORTS-PLAYER-RESOLUTION]`, `[NBA-ENRICHMENT-CACHE-OBSERVED]`, `[CANONICALIZATION-COLLISION-DETECTED]`), 25-entry ring buffers for rejection samples, phase tags inline on every additive site. `[DB-BOOT]` + `[SERVER-BOOT-DB-INIT]` + `[NBA-SNAPSHOT-FREEZE]` + `[NBA-SNAPSHOT-FREEZE-REPLAY]` + `[FROZEN-EPOCH]` give the operator a boot-and-runtime trail.

**Continuity — strong.** `.brain_bootstrap_state.json` receipt with SHA-256 hashes of brain docs and runtime code, drift detection on bootstrap age + runtime lag, env-tunable thresholds. `npm run brain:checkpoint` reconciles hashes back into the receipt on PASS.

**Enforcement — partially strong.** `enforceBrainCheckpoint` exits non-zero on missing brain updates, runs the 14-suite regression matrix as a sub-step, requires all PASS to advance. **But it can be bypassed with `--skip-matrix` and there is no pre-commit/CI hook documented as requiring it.** It is opt-in discipline.

**Replay integrity — strong.** `INSERT OR IGNORE` everywhere on frozen tables, `replaceOddsSnapshot` is atomic, replay path explicitly honored (`/refresh-snapshot?replay=disk`, `[NBA-SNAPSHOT-FREEZE-REPLAY]`). MLB Phase E2 explicitly forbids `INSERT OR REPLACE`. Composite-key forward-only migration (with the limitation noted under Hidden Failures).

**Grading integrity — strong-on-design, untested-at-scale.** Outcome attribution keys on `prediction_id`/composite keys, never on API-Sports team ids or roster contents (so the F-series cannot corrupt grading). But the 2026-05-09 architecture audit notes that all 2,000 personal_ledger entries are "pending" — the calibration system has zero training data flowing through it.

**Operational risks remaining:**

- `__refreshInProgress` dual-mutex (known race, latent until concurrent triggering).
- Nightly scripts hit HTTP localhost (single point of failure, no retry).
- `personal_ledger.json` read path uncutover (silent divergence risk).
- `timing_intelligence_state.json` unbounded (latency cliff).

---

## AI WORKFLOW REVIEW

This is the domain where the repo is strongest. Most teams do not have any of this. This team has nearly all of it.

**What exists and works:**

- `BOOTSTRAP_PROMPT.md` declares the rehydration sequence.
- `WORKFLOW_RULES.md` declares operational law (verify before patching, no speculative rewrites, one strong prompt at a time, preserve architecture, no terminal hijacking).
- `MASTER_BRAIN.md` declares architectural doctrine, current phase, canonical authorities, runtime topology, freeze/grading/snapshot/cache/response/composite-key/observability rules, known failure patterns, do-not-reintroduce list, patch discipline checklist, brain commands.
- `npm run brain:{bootstrap,status,verify,continuity,checkpoint}` exists and runs.
- Phase tags inline (`F1`, `F2`, `F5-A`, `F6.2`, `F6.3`, etc.) make code traceable to its own history.
- `@orphan` JSDoc markers gate dead-but-preserved code behind env flags.
- Session-by-session CURRENT_STATE entries (Sessions A through F6.3) constitute a chronological audit log of every operational discovery.

**What is broken or incomplete:**

1. **Seven brain files declared, only one exists.** `MASTER_BRAIN.md` line 372–380 references `OPERATOR_PROTOCOL.md`, `CURRENT_RUNTIME_STATE.md`, `ARCHITECTURE_LAWS.md`, `ACTIVE_INCIDENTS.md`, `PIPELINE_AUTHORITY_MAP.md`, `MODEL_EVOLUTION_LOG.md`, `SPORTSBOOK_CONTRACTS.md`. None exist in `backend/runtime/brain/`. Any AI session that follows the patch-discipline checklist will fail step 2 ("Read this file and OPERATOR_PROTOCOL.md").
2. **Docs version split persists** — root-level `/CURRENT_STATE.md` and `/NEXT_SESSION.md` plus `docs/CURRENT_STATE.md` and `docs/NEXT_SESSION.md`. ARCHITECTURE.md says "always update docs/ first then sync root." The 2026-05-09 audit flagged this as reversed (root current, docs behind by 4 sessions). The doctrine is unresolved.
3. **Brain commands are not wired into pre-commit or CI** — they are operator-invoked. Discipline is voluntary. The 14-suite regression matrix runs only when `brain:checkpoint` is invoked.
4. **Hash-based continuity does not verify semantic correctness** — a session can update `CURRENT_STATE.md` with text that disagrees with the code change and pass continuity.

**Honest verdict:** The AI workflow infrastructure is best-in-class **for what exists**. The doctrine is ahead of the filesystem. Closing that gap is one of the highest-leverage things this repo can do.

---

## TECHNICAL DEBT RANKING (revised from 2026-05-09)

Priority-ordered by combined urgency × impact × strategic alignment with stated goals (bettor-rich UX, ecology diversity, longitudinal intelligence, additive architecture):

| Rank | Item | Urgency | Impact | Status since 2026-05-09 |
|---|---|---|---|---|
| 1 | Brain doctrine vs filesystem gap — split `MASTER_BRAIN.md` into the seven declared sibling files (or update doctrine to match reality) | Critical | High | New — not in May 9 audit |
| 2 | Personal ledger SQLite read cutover (Phase S+1) | High | High | Unchanged |
| 3 | Longitudinal-table retention policy + partitioning | High | High | New |
| 4 | NBA workstation path: designate canonical slip output, stop re-deriving via shared builder | High | High | Unchanged — NBA-1/2/3 unshipped |
| 5 | `__refreshInProgress` dual-mutex unification | Medium | Critical | Unchanged |
| 6 | Dead inlined NBA files (11,185 lines) deletion | Low | High | Unchanged |
| 7 | `timing_intelligence_state.json` pruning or SQLite migration | High | Medium | Unchanged |
| 8 | `isOffensiveAttackStat` unification to `pipeline/shared/normalizers.js` | Low | Medium | Unchanged |
| 9 | `compactors` extraction from `workstationRoutes.js` | Low | Medium | Unchanged |
| 10 | `applyAllSchemas(db)` single entry point | Low | Medium | New |
| 11 | NBA `propVariant !== "base"` gate replacement (allow quality alt lines) | High | Medium | Unchanged |
| 12 | NBA volatility: trust snapshot-sourced `volatility` field (Path A) | High | Medium | Unchanged |
| 13 | NBA ecology tier layer (`buildNbaEcologyLayer.js`) — ELITE/STRONG stamps | Medium | High | Unchanged |
| 14 | NBA `realismScore` reweighting (0.70 → 0.45) | Medium | High | Unchanged |
| 15 | Server.js Phase A extraction (mathUtils.js, normalizePlayerName) | Low | Low | Unchanged |
| 16 | Daily review surfacing in frontend (`IntelligenceReviewView`) | Low | High | Unchanged |
| 17 | Nightly orchestrator absorbs nightly script logic | Low | Medium | Unchanged |
| 18 | First basket data path → wire to `FirstBasketView` or remove section | Low | Low | Unchanged |
| 19 | Roster Map disk persistence + TTL (Phase F7 candidate) | Low | Low | New |
| 20 | Brain commands wired to pre-commit / CI | Medium | Medium | New |

---

## SCALING REVIEW

**MLB → NBA scaling is already imperfect.** The pattern of `runMlbNight.js` (~539 lines) + `runNbaNight.js` (~1,310 lines) as separate-but-similar orchestrators with substantial inline logic outside `buildNightlyOrchestrator.js` is a smell that worsens monotonically. A third sport multiplies it.

**NFL/NHL onboarding readiness — concrete blockers:**

1. **`workstationRoutes.js` imports NBA modules at top** — `nbaRowModelProbability`, `nbaRowEdge`, `enrichNbaRowStatLayerInputs`. NFL will need `nflRowModelProbability` and a new top-level import. The pattern doesn't scale; it concatenates.
2. **`pipeline/shared/adapters/` exists but is underused** — only `buildPostGameReview` flows through the adapter pattern. The rest of the shared pipeline reads raw bet objects with sport-specific field names. Adding NFL means either adding `nflAdapter.js` and threading it through every shared module, or adding sport-specific branches to the shared modules.
3. **Two `buildSlateEvents` variants** (`pipeline/schedule/buildSlateEvents.js` and `buildMlbSlateEvents.js`) — the cross-sport version exists but MLB has its own. NFL/NHL will need their own variants or a parameterized rewrite.
4. **Daily rolling files are sport-prefixed by filename, not partitioned in SQLite** — `mlb_tracked_bets_*`, `nba_tracked_bets_*`. SQLite tables carry a `sport` column but no enforced filtering at the query layer. Mixed-sport analytics queries will need explicit filtering everywhere.
5. **No sport configuration registry** — `pipeline/sports/sportConfig.js` and `bestAvailableSportDispatch.js` exist (correct foundation) but are not consumed by the workstation route layer.

**Scaling capacity beyond two sports requires:**

- Sport-agnostic workstation route layer (eliminate top-level sport-specific imports).
- Sport adapter pattern extended to every shared module.
- `buildNightlyOrchestrator.js` as the canonical entry for all sport nightly runs, with `runMlbNight.js`/`runNbaNight.js` reduced to thin wrappers.
- SQLite table partitioning or strict `WHERE sport = ?` discipline.

**Bettor scaling (multi-tenant) — architectural blockers:**

- `personal_ledger.json` has no concept of user identity.
- SQLite `personal_ledger` table has no `user_id` column.
- All runtime tracking files are single-process writes without locking.
- No authentication, no session management.

**Verdict:** the system can absorb one more sport painfully. It cannot absorb multi-tenancy without fundamental restructuring.

---

## ANTI-FRAGILITY REVIEW

**What protects the system against drift:**

- `INSERT OR IGNORE` semantics make replay safe.
- `INSERT OR REPLACE` is explicitly forbidden on frozen tables.
- Brain receipt + checkpoint detect runtime-vs-doc drift.
- `verify*.js` 14-suite regression matrix runs as part of checkpoint.
- `[DB-BOOT]` + AZ auto-repair handle missing tables at boot.
- Eager DB init (Session BC) makes boot-time DB failure loud.
- Calibration honesty preserves NULL, never synthesizes 0.5.
- Snapshot freshness has a single oracle.
- Future-only filter uses strict `>` not `>=`.
- Composite-key normalization handles diacritics, casing, hyphenation.
- `@orphan` markers keep dead-but-preserved code gated and observable.

**What does not yet protect against drift:**

- No retention policy on longitudinal tables (growth-based fragility).
- No alerting when the daily review engine silently stops running.
- No idempotency guarantee on nightly script re-runs.
- No automated detection of `VOLATILITY_RULES` recalibration need (manual quarterly review only).
- No tracking-file pruning for `mlb_picks_*` (1.5MB/day, unbounded).
- No CI gate on `brain:checkpoint`.
- No alert on `__refreshInProgress` stuck flag.
- No dead-man switch on persistence write failures (partial-write `.tmp` orphans get logged but not flagged).

**Anti-fragility is improving rapidly but is still patchy.** The system fails loudly in the places that were recently audited (cache lifecycle, freeze pipeline, schema initialization) and fails silently in the places that haven't been audited yet (timing state, ledger reads, review engine output).

---

## PHASE-2 ROADMAP (highest-leverage next evolution phases)

Sequenced by combined risk-reduction × strategic alignment with stated repo goals.

### PHASE Brain-1 — Doctrine reconciliation (~0.5 session, near-zero risk)
**Goal:** close the brain doctrine vs filesystem gap.

Either: split `MASTER_BRAIN.md` into the seven sibling files it references (`OPERATOR_PROTOCOL.md`, `ARCHITECTURE_LAWS.md`, `ACTIVE_INCIDENTS.md`, `MODEL_EVOLUTION_LOG.md`, `PIPELINE_AUTHORITY_MAP.md`, `SPORTSBOOK_CONTRACTS.md`, `CURRENT_RUNTIME_STATE.md`); or update `MASTER_BRAIN.md` to declare itself the single canonical brain file and remove the sibling references. **Whichever choice, the doctrine must match the filesystem before any future session.** Also: choose root or `docs/` for `CURRENT_STATE.md`/`NEXT_SESSION.md` and delete the other copy.

### PHASE Hygiene-1 — Dead code deletion + docs sync (~0.5 session, zero risk)
**Goal:** drop 11,185 lines of confusion.

Delete: `http/nbaBestAvailable.inlined.js` (6,867), `http/nbaRefreshSnapshot.inlined.js` (4,318), empty stubs (`pipeline/enrich/index.js`, `pipeline/normalize/index.js`, `pipeline/validation/rows.js`, `pipeline/snapshot/buildSnapshot.js`), test artifacts (`storage/betting2.db`, `betting2.db-journal`, `storage/test.txt`), `.tmp` orphans. `node --check` everything that's left. No behavior change.

### PHASE Persistence-1 — Personal ledger SQLite read cutover (~1 session, controlled risk)
**Goal:** the most operationally precious state ceases to be a flat JSON.

Add a startup integrity check: assert `JSON ledger entry count == SQLite ledger row count`. Log divergence as `[LEDGER-DIVERGENCE-DETECTED]`. After one nightly run verifies clean equality, cut the read path to SQLite. Keep JSON as cold backup for 30 days. Document the rollback path in `OPERATOR_PROTOCOL.md` (once that file exists).

### PHASE Persistence-2 — Longitudinal retention policy (~1 session, additive)
**Goal:** prevent the longitudinal tables from becoming the largest tables in the system.

Add `prune_longitudinal_state.js` job: keep `prediction_snapshots` and `frozen_contextual_states` rows for 365 days, then archive (compress to a `historical/YYYY-Q.jsonl.gz` artifact and `DELETE FROM ... WHERE created_at < ?`). `outcome_snapshots` retained indefinitely as they're the calibration corpus. Run via `npm run brain:retention` weekly. Document the retention contract in a new `RETENTION_POLICY.md`.

### PHASE Race-1 — `__refreshInProgress` unification (~0.25 session, controlled risk)
**Goal:** eliminate the dual-mutex race.

Pick one scope (module-level). Remove `global.*` references. Single-line change after grep verification. Smoke test: trigger MLB and NBA refresh concurrently; verify the second one blocks. Add a `[REFRESH-MUTEX-STUCK]` watchdog log emitted if `__refreshInProgress` has been `true` for > 5 minutes.

### PHASE Sport-Agnostic-1 — Workstation route detangling (~1 session, medium risk)
**Goal:** remove NBA-specific imports from the top of `workstationRoutes.js`.

Route NBA-specific scoring through `pipeline/sports/sportConfig.js`. Resolve `rowModelProbability`/`rowEdge`/`enrichRowStatLayerInputs` by sport at call time, not import time. Verify identical behavior for MLB and NBA. This is the prerequisite for NFL/NHL onboarding.

### PHASE NBA-1+2 — NBA volatility honesty + canonical slip path (~2 sessions, medium risk)
**Goal:** make NBA real.

Phase NBA-1 (Path A): use snapshot-sourced `volatility` field when `bet.snapshotSourced === true`. PRA at -120 stops being aggressive. Lotto stops being structurally empty.

Phase NBA-2: trace `nba_tracked_slips_*.json` content. Verify it carries `buildNbaAiSlips.js` output. In `workstationRoutes.js`, serve these slips directly for NBA. Stop calling shared `buildSlipAi.js` on NBA candidates.

### PHASE Longitudinal-Integrity-1 — Dual-freeze reconciliation (~0.5 session, low risk)
**Goal:** prevent the two freeze writers from forking silently.

Either: declare one canonical writer and remove the other (and lose the "honest sparsity" snapshot freeze, OR lose the workstation richness — the latter is worse); or: unify `epochId` derivation in a shared helper (`pipeline/memory/deriveEpochId.js`) so both writers compute the same id for the same snapshot. The latter is preferred. Add a probe that asserts both writers, given the same snapshot, produce identical `epoch_id`.

### PHASE Schema-1 — `applyAllSchemas(db)` (~0.25 session, zero risk)
**Goal:** one schema entry point.

Create `applyAllSchemas(db)` in `storage/schema.js` that calls `applySchema → applyScreenshotSchema → applyReviewSchema → applyIntelligenceSchema` in order. Replace existing chains. `initializeAtBoot` calls only this single function.

### PHASE NBA-Ecology-1 — `buildNbaEcologyLayer.js` (~1 dedicated session, Opus)
**Goal:** give NBA the ELITE/STRONG ecology tier MLB has via `buildMlbPropClusters`.

Model on MLB ecology layer. Apply same `edge × modelProb` compounding lens. Apply the 2026-05-09 NBA audit's recommended weight rebalance (`realismScore × 0.45 + edge × 0.25 + ...`). Run on a full slate, compare tier distribution vs current. Block all other NBA evolution until this lands and is verified.

### PHASE Brain-2 — CI gate (~0.5 session, near-zero risk)
**Goal:** make the brain checkpoint non-optional.

Add a pre-commit hook (or pre-push) that runs `brain:checkpoint --since-minutes=120 --skip-matrix`. Document in `OPERATOR_PROTOCOL.md`. CI badge equivalent: emit a daily summary of continuity health via a scheduled task.

### PHASE Observability-1 — Daily review frontend (~1 session)
**Goal:** the system's most sophisticated learning loop is invisible to the operator.

Build `sections/IntelligenceReviewView.tsx` consuming `GET /api/ws/review/daily`. Surface grades A–F, major findings, HR eruption misses, suppressed winners, process archetypes. This is the highest-leverage UI work in the repo because it gives the operator visibility into the system learning about itself.

### PHASE Multi-tenant — INTENTIONALLY DEFERRED
Architectural fork. Not a Phase-2 candidate. The system should reach NFL + retention + NBA ecology parity before any multi-tenant work begins, because multi-tenant introduces user-identity threading through every persistence layer simultaneously.

---

## CLOSING POSITION

This repo is at an inflection point that the 2026-05-09 audit predicted. The brain layer and the longitudinal memory are the right two foundations for evolving toward a multi-sport AI prediction platform. They were built correctly. **What this audit adds, five days later, is the warning that vertical depth without horizontal cleanup will compound debt faster than intelligence.**

The five highest-leverage moves over the next eight sessions are:

1. **Brain-1** (doctrine reconciliation) — 0.5 session, fixes the AI workflow gap that affects every future session
2. **Hygiene-1** (delete 11k lines of dead code) — 0.5 session, zero-risk clarity gain
3. **Persistence-1+2** (ledger cutover + longitudinal retention) — 2 sessions, eliminates the two biggest persistence-fragility surfaces
4. **NBA-1+2** (volatility honesty + canonical slip path) — 2 sessions, makes NBA real for the bettor surface
5. **Sport-Agnostic-1** (workstation detangling) — 1 session, unblocks NFL/NHL

Total: ~6 sessions for a fundamental step-change in maturity and scaling readiness.

**The audit does not recommend immediate patching.** The audit recommends operator review of this roadmap, selection of the first session's scope, and explicit invocation via `npm run brain:bootstrap` to begin work under the existing continuity discipline.

---

_Audit completed: 2026-05-14_
_Author: Claude (Cowork mode, opus-class audit)_
_Next audit trigger: After completion of Phase Brain-1 + Persistence-1, OR before any NFL/NHL onboarding decision_
_This audit is intentionally additive to the 2026-05-09 audits. Read all three together for full historical context._

---

## POSTSCRIPT — 2026-05-14 stale-source corrections

When this audit was acted on (operator initiated Phase Brain-1 + Race-1), live investigation revealed **two of the audit's findings were based on stale source material and were not true of the current code**. This postscript records the corrections so future readers do not re-action work that is already done.

### Correction 1 — "Brain doctrine references seven sibling files that don't exist" was WRONG

The audit's `Top Risks #4` and `AI Workflow Review` claimed the seven brain sibling files (`OPERATOR_PROTOCOL.md`, `CURRENT_RUNTIME_STATE.md`, `ARCHITECTURE_LAWS.md`, `ACTIVE_INCIDENTS.md`, `MODEL_EVOLUTION_LOG.md`, `PIPELINE_AUTHORITY_MAP.md`, `SPORTSBOOK_CONTRACTS.md`) declared in `MASTER_BRAIN.md` did not exist on disk.

**They do exist.** All seven, plus a `README.md`, are present in `backend/runtime/brain/` and have been since before this audit was generated:

```
backend/runtime/brain/
├── .brain_bootstrap_state.json    (continuity receipt)
├── ACTIVE_INCIDENTS.md            ( 9,360 bytes — 148 lines)
├── ARCHITECTURE_LAWS.md           ( 9,012 bytes — 225 lines)
├── CURRENT_RUNTIME_STATE.md       (11,995 bytes — 248 lines)
├── MASTER_BRAIN.md                (24,648 bytes — 388 lines)
├── MODEL_EVOLUTION_LOG.md         (21,482 bytes — 371 lines)
├── OPERATOR_PROTOCOL.md           (16,286 bytes — 278 lines)
├── PIPELINE_AUTHORITY_MAP.md      ( 8,742 bytes — 153 lines)
├── README.md                      ( 6,975 bytes — 124 lines)
└── SPORTSBOOK_CONTRACTS.md        ( 7,843 bytes — 190 lines)
```

`npm run brain:bootstrap` consumes all of them, `npm run brain:verify` validates 11 freshness sections including required-section checks across these files, `npm run brain:continuity` validates the `.brain_bootstrap_state.json` receipt. The brain layer is **structurally complete**.

**Why the audit was wrong**: the auditing AI session's `Glob` tool returned `No files found` for `backend/runtime/brain/**/*.md`. This appears to have been a stale workspace mount in the file-tool view. The bash side of the same session, when consulted later, listed all files normally. The audit synthesized from the false-negative `Glob` result without cross-verifying via bash. **Lesson**: cross-verify filesystem claims via bash before encoding them as findings.

**Effect on roadmap**: `Phase Brain-1` (doctrine reconciliation) is **complete — no action required**. The roadmap should be re-ordered to make `Phase Hygiene-1` (delete 11k lines of dead inlined NBA code) the next zero-risk hygiene phase.

### Correction 2 — "`__refreshInProgress` dual-mutex race" was WRONG

The audit's `Top Risks #1` and `Architectural Hotspots #1` claimed `server.js` had two separate `__refreshInProgress` mutexes — a module-level `let __refreshInProgress` and a `global.__refreshInProgress` — and that MLB and NBA refreshes therefore did not block each other. This audit cited the 2026-05-09 architecture audit's then-valid flag of this bug without re-checking the current source.

**The mutex was unified in Session Y.** Live verification today:

```
$ grep -n "__refreshInProgress\|global\.__refreshInProgress" backend/server.js
10109:let __refreshInProgress = false
10145:        return __refreshInProgress
10148:        __refreshInProgress = v
19326:  // Uses the module-level __refreshInProgress / __lastRefreshTime (line ~10091)
19330:  if (__refreshInProgress) {
19340:  __refreshInProgress = true
19419:    __refreshInProgress = false
```

ONE declaration. ALL sites read/write the same module-level variable. No `global.__refreshInProgress` anywhere. The inline authority comment at line 19326 explicitly documents the Session-Y unification. `NEXT_SESSION.md` line 1102 confirms: `__refreshInProgress dual-mutex race | ✅ RESOLVED (Session Y) — module-level only`.

**Why the audit was wrong**: the audit synthesized from the May 9 architecture audit's source material (which was valid at the time) without re-checking the current `server.js`. **Lesson**: prior-audit findings age. Re-verify against current source before re-ranking a finding as a top risk.

**Effect on roadmap**: `Phase Race-1` (mutex unification) is **complete — no action required**. The orthogonal observability gap (stuck-mutex-after-crash) was a real Phase-Race-1.5 candidate and was shipped today (2026-05-14) as the `[REFRESH-MUTEX-STUCK]` watchdog — pure additive observability under Law 9. See `CURRENT_STATE.md` SESSION RACE-1 entry for details. Pre-existing canonical mutex contract preserved.

### What this means for the rest of the audit

The remaining findings have NOT been re-verified, but the prior-audit echo pattern observed in these two corrections suggests **some other findings may also be stale**. Specifically, before acting on any of the following, re-verify against current source:

1. `Top Risks #6` — `personal_ledger.json` SQLite read cutover. Verify via `grep -rn "loadLedger\|readLedger" backend/pipeline/shared/buildPersonalLedger.js` whether the read path is JSON or SQLite today.
2. `Top Risks #7` — `workstationRoutes.js` NBA-specific imports at top. Verify the current import block.
3. `Top Risks #8` — 11,185 lines of dead inlined NBA code on disk. Verify `ls -la backend/http/nba*.inlined.js` returns the files.
4. `Top Risks #9` — `timing_intelligence_state.json` size. Verify via `ls -la backend/runtime/tracking/timing_intelligence_state.json`.
5. `Top Risks #10` — NBA `propVariant !== "base"` gate. Verify via `grep -n 'propVariant' backend/routes/workstationRoutes.js`.

These checks take seconds and prevent a third generation of stale audit echoes.

### Rule encoded for future sessions

> **When acting on an audit, re-verify each finding against current source before patching.** The audit directs attention; it does not substitute for observation. Prior-session audit findings, including those declared in this file, may have been silently resolved by intervening work. Cross-verify filesystem claims via bash before treating them as ground truth.

_Postscript appended: 2026-05-14, after Phase Race-1 watchdog ship._
