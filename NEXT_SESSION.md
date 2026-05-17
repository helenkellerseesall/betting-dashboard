**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-16 (Phase Visual-Betting-Intelligence-1A SHIPPED — VBI-2 canonical prediction resolver + VBI-3 unified slip-analysis engine + VBI-4 deterministic bettor-language phrase library + VBI-6 end-to-end verification fixture + VBI-8 canonical verdict payload shape. VBI-2 in NEW `backend/pipeline/shared/resolveSlipLegToPrediction.js`: pure resolver reusing `intelligence.predictionId` + `normPlayer` + `normFam` + `normBook`; NEW `STAT_FAMILY_TO_CANONICAL_PROPTYPE` translation bridges screenshot camelCase (`totalBases`/`hr`/`ks`) to substring-friendly propType strings the canonical MLB role predicates already match; explicit `UNRESOLVED_REASONS` taxonomy (MISSING_PLAYER / MISSING_STAT_FAMILY / MISSING_SIDE / MISSING_LINE / MISSING_SPORT / MISSING_SLATE_DATE — anti-fabrication). VBI-3 in NEW `backend/pipeline/shared/buildSlipAnalysis.js`: pure composition engine consuming canonical `pairCorrelationScore` (MLB-COV-1/3) + role predicates for MLB-COV-2 detection + `marketSupportFor` (EXPL-1) + `candidateIsHardDropAvailability` (EXPL-4); deterministic `ecologicalCoherence` formula `1.0 - 0.50×contradictions - 0.10×unresolved - 0.05×unsupportedSolo - 0.25×hardDropOut + 0.05×positiveStacks` clamped; canonical 12-field verdict payload (VBI-8 shape). ZERO new math / ML / LLM / opaque survivability percentages. VBI-4 in NEW `backend/pipeline/shared/bettorLanguage.js`: deterministic SIGNAL_PHRASES dictionary mapping 14 canonical signal IDs to operator-approved phrases; `renderVerdictPhrases` deterministic priority sort + dedupe; `composeVerdictSummary` deterministic single-line pick; unknown IDs silently dropped (anti-fabrication); **NO LLM. NO GPT. ZERO opaque prose.** VBI-6 in NEW `backend/scripts/verifyVisualBettingIntelligence1A.js`: 76 deterministic assertions across 4 canonical operator-named fixture slips (coherent stack → positive_offensive_stack / Coors fake-safe UNDER → shared_game_suppression_exposure + fake_safe_same_game_exposure / pitcher-K vs hitter contradiction → mlb_pitcher_hitter_conflict + structural_contradiction / unsupported bait → market_context_unavailable when shopMap absent). 76/76 PASS. VBI-8 frozen `VERDICT_PAYLOAD_SHAPE` constant — single source of truth for FE / persistence / CLI consumers. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). Three NEW pipeline modules + one NEW verification fixture; ZERO existing screenshot pipeline / scoring / persistence / FE / OCR / new ML / calibration / grading / settlement / replay / lineage / recommendation-hierarchy / MLB-COV / EXPL / NBA-correlation touch. Doctrine: visual betting intelligence + deterministic bettor-language + screenshot interpretation philosophy + canonical screenshot authority + anti-fabrication screenshot doctrine. Seventeen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — pure additive in-process modules. Try it: `node backend/scripts/verifyVisualBettingIntelligence1A.js` (76/76 PASS expected).)_

Prior session record (Phase MLB-Correlation-Engine-1A):
_Last updated: 2026-05-16 (Phase MLB-Correlation-Engine-1A SHIPPED — MLB-COV-1 canonical engine bridge + MLB-COV-2 shared-game suppression + MLB-COV-3 role-aware pitcher-hitter conflict. MLB-COV-1 in `backend/pipeline/shared/buildSlipAi.js`: NEW lazy loader `getMlbCorr()` mirroring NBA pattern; reuses canonical `pairCorrelationScore` + role predicates from `pipeline/mlb/buildMlbCorrelationEngine.js` (additive exports — zero logic change on the engine itself). MLB-COV-2 in same file: NEW gate in `canAddLeg()` blocking 2nd hitter-counting UNDER same-game with canonical reason `shared_game_suppression_exposure`. MLB-COV-3 in same file: NEW gate consuming `pairCorrelationScore ≤ -0.99` (opposing-team pitcher-K-OVER + hitter-counting-OVER) with canonical reason `mlb_pitcher_hitter_conflict`. Both new gates sport-gated via EXISTING `!tpl.skipScriptCorrelation` (NBA bypasses; NBA correlation path UNCHANGED). NEW operator-visible `[MLB-COV-1A] suppressed N+M ...` log; `mlbCovStats` returned on slip-build payload. NEW pure helpers `resetMlbCovStats()` + `getMlbCovStats()` for per-invocation counter discipline. 37/37 helper unit PASS via NEW `backend/scripts/verifyMlbCorrelationEngine1A.js`. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). End-to-end LOTTO smoke confirmed: Coors Vargas+Goodman UNDER stack BLOCKED + Ohtani-K-OVER + opposing-hitter-OVER BLOCKED + Judge+Soto same-team OVER stack PRESERVED. ZERO scoring redesign / persistence / ML / calibration / grading / settlement / replay / lineage / recommendation-hierarchy / NBA path touch. Doctrine: deterministic covariance + same-game ecological suppression + role-aware anti-correlation + parlay survivability + canonical-authority-first. Sixteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — additive pure-function changes only (canAddLeg gates evaluated on the next slip build).)_

Prior session record (Phase Market-Exploitation-1A):
_Last updated: 2026-05-16 (Phase Market-Exploitation-1A SHIPPED — EXPL-1 consensus-support gate + EXPL-4 availability hard-filter. EXPL-1 in `backend/pipeline/shared/buildFeaturedPlays.js`: NEW constants `EXPL1_MIN_BOOK_COUNT=3` + `EXPL1_MIN_CONSENSUS_CONFIDENCE=0.6`; NEW pure helpers `marketSupportFor` + `staleRowLookupKey`; gate wired into `buildBestDisagreementEdges` + `buildStaleLineOpportunities` + `buildInflatedSuperstarSpots`; surviving plays receive canonical `processNote = "market-supported disagreement"` (or `"market-supported overprice"` on AVOID) appended via ` · ` separator. EXPL-4 in same file: NEW `EXPL4_HARD_DROP_STATUSES={"out"}`; `normalizeCandidate` extended additively to preserve canonical `playerStatus` + `availabilityContext` (reuses `pipeline/nba/nbaAvailabilityCache.enrichRowWithAvailability`); NEW helpers `candidateIsHardDropAvailability` + `buildAvailabilityIndex` + `staleRowIsHardDropAvailability`; hard-filter at main-entry choke point; staleRows symmetrically gated; operator-visible warnings on every drop. MLB no-op (anti-fabrication on missing playerStatus). 40/40 helper unit PASS via NEW `backend/scripts/verifyMarketExploitation1A.js`. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). End-to-end smoke confirmed all gates fire correctly. ZERO scoring redesign / persistence / ML / calibration / grading / settlement / replay / lineage / recommendation-hierarchy touch. Doctrine: market-supported disagreement + availability-authority + exploitability-ranking philosophy. Fifteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — additive pure-function changes only.)_

Prior session record (Phase Operational-Governance-1A):
_Last updated: 2026-05-16 (Phase Operational-Governance-1A SHIPPED — receipt-as-memory-ledger + symmetric enforcement. GOV-1: `brain:checkpoint` now enforces `CURRENT_STATE.md` + `NEXT_SESSION.md` + `docs/OPERATOR_RUNBOOK.md` as required-on-patch alongside backend brain docs. GOV-2: `RUNTIME_CODE_DIRS` includes `frontend/src` — frontend changes participate in continuity. GOV-3: 5-probe canonical integrity matrix runs at every checkpoint (grading_backfill / lineage / epoch_authority / persistence_idempotency / ledger_mirror); failure FAILs checkpoint. GOV-4: receipt schema gains `probeMatrixHashAtCheckpoint`; continuity warns on probe-script drift. Live checkpoint PASS + FAIL semantic verified. Fourteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase NightlyReview-Hydration-1A):
_Last updated: 2026-05-16 (Phase NightlyReview-Hydration-1A SHIPPED — alias-before-render canonical names. HYDRATE-1 in `backend/pipeline/shared/buildPostGameReview.js` adds canonical `projected`/`actual` row aliases (sourced from `b.line` / `b.actualValue` with legacy fallback) + repairs stale `actualStat` to read `num(b.actualValue) ?? b.actualStat ?? null` first; all legacy keys preserved verbatim. HYDRATE-2 in `scripts/nightlyReview.js` replaces direct `${p.projected}`/`${p.actual}` reads with deterministic fallback chains ending in `"?"` sentinel. Live verification: MLB + NBA proj/actual now render correctly across 6 sample rows. 150/150 probe matrix PASS, tsc clean. ZERO grading/settlement/persistence/calibration touch. Thirteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase SQLite-Persistence-Hygiene-1A):
_Last updated: 2026-05-16 (Phase SQLite-Persistence-Hygiene-1A SHIPPED — deterministic primitive-safe SQLite bindings. HYGIENE-1 hoists totalBets/settledCount/hitCount/missCount/hitRate from `report.answers.*` onto outer `report.*` in `backend/pipeline/review/buildDailyIntelligenceReview.js`. HYGIENE-2 introduces `bindBool(v,{ifNull})` pure helper (coerces JS booleans to 1/0/NULL — better-sqlite3 rejects raw booleans) and applies it at every boolean-shaped binding across 6 INSERTs + adds defensive `?? null/?? 0/JSON.stringify(x ?? null)` everywhere. HYGIENE-4 replaces template-literal coercion of portfolio warnings in `scripts/nightlyReview.js` with frontend label-extraction pattern. Binding errors progression: param 5 → param 13 → ZERO. 10/10 bindBool unit + 150/150 probe matrix PASS, tsc clean. ZERO schema/grading/settlement rewrite. Twelve approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Settlement-Ingestion-Window-1A):
_Last updated: 2026-05-15 (Phase Settlement-Ingestion-Window-1A SHIPPED — rolling settlement window via AUTO-3. NEW `buildWindowDates(todayStr, N)` pure helper + `--window=N` (default 2) flag + `dateExplicit` tracking in `backend/scripts/settlementRun.js`. Bare `npm run settlement:run` now sweeps `[yesterday, today]`; `--date=YYYY-MM-DD` preserves single-date semantics; new operator log line `processing settlement window: [YYYY-MM-DD ... YYYY-MM-DD]`. CHECK + EXECUTE iterate via EXISTING `executePair`. 15/15 helper unit + 150/150 probe matrix PASS, tsc clean. ZERO grading/writer/orchestration/persistence/calibration mutation. AUTO-1 lifecycle preserved. Eleven approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Recommendation-Hierarchy-1A):
_Last updated: 2026-05-15 (Phase Recommendation-Hierarchy-1A SHIPPED — deterministic 7-slot decision ladder. NEW `buildRecommendationLadder()` in `backend/pipeline/shared/buildFeaturedPlays.js` + NEW `RecommendationLadder` interface in `frontend/src/workstation/types.ts` + NEW `frontend/src/workstation/components/RecommendationLadder.tsx` + Dashboard.tsx wiring between risk pulse and HeroPickCard. Slot priority: bestOverall → safestPlay → bestDisagreement → bestUpsidePlay → bestBalancedPlay → mostOverpricedAvoid → highestTrapRiskAvoid; dedup walks bucket past taken ids; empty slot doctrine = null + honest "(no qualifying X tonight)". 20/20 helper unit + 150/150 probe matrix PASS, tsc clean. ZERO pipeline mutation. ZERO scoring rewrite. ZERO new ranking math. Ten approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Canonical-Shape-Hardening-1A):
_Last updated: 2026-05-15 (Phase Canonical-Shape-Hardening-1A SHIPPED — canonical resolver helpers + slateMlb.js drift closure. NEW `backend/pipeline/shared/responseShapeResolvers.js` exports 5 deterministic helpers; `slateMlb.js` migrated. 31/31 helper unit assertions PASS + 150/150 probe matrix unchanged. tsc clean. ZERO API/writer/pipeline/payload mutation. Nine approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Intelligence-Shaping-1A):
_Last updated: 2026-05-15 (Phase Intelligence-Shaping-1A SHIPPED — INC-017 RESOLVED. 4 key-path corrections in `backend/scripts/slateNba.js` aligned diagnostic reader to canonical API response shapes. Same family pattern as INC-016 — diagnostic-reader key-path drift, NOT substrate failure. ZERO backend pipeline file changed. ZERO API route change. Full matrix 150/150 PASS. tsc clean. Eight approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Snapshot-Authority-1A):
_Last updated: 2026-05-15 (Phase Snapshot-Authority-1A SHIPPED — INC-016 RESOLVED. Two one-line reader fallback fixes (marketStatus.js + buildIntelligencePresentation.js) add `data.props` to the snapshot-row resolution chain, mirroring the canonical workstation reader pattern. NBA `market:status` now correctly reports rows=5655 / books=2 (was 0/0). MLB unchanged. ZERO writer-side change. ZERO new files. Full matrix 150/150 PASS. tsc clean. Seven approved gates shipped. INC-013/014/015/016 all RESOLVED.)_

Prior session record (Phase Settlement-Orchestration-1A):
_Last updated: 2026-05-15 (Phase Settlement-Orchestration-1A SHIPPED — deterministic settlement automation. AUTO-1: runHistoricalGrade.js chain hook; AUTO-2: NEW `npm run settlement:run` canonical entry. Daily ceremony 3 commands → 1 command. ZERO backend pipeline change. Sandbox smoke confirmed full chain. 150/150 matrix unchanged. tsc clean.)_

Prior session record (Phase Operator-Experience-1B-1):
_Last updated: 2026-05-15 (Phase Operator-Experience-1B-1 SHIPPED — readable intelligence via deterministic plain-English tooltips. NEW `frontend/src/workstation/tooltips.ts` (25 helpers, ~220 lines) + 82 title= attributes across 7 surfaces + `(2b)` → `(2 books)` cleanup. ZERO backend file changed. ZERO layout / card / navigation redesign. ZERO AI-generated prose. Anti-fabrication enforced. tsc clean (exit 0). 150/150 matrix unchanged. All prior phases preserved.)_

Prior session record (Phase Operator-Experience-1A):
_Last updated: 2026-05-14 (Phase Operator-Experience-1A SHIPPED — actionable intelligence surfacing. 5 additive changes: 8 new operator-priority buckets in buildFeaturedPlays + 3 Phase Market-1A fields lifted onto every compactPlay + ActionableBucketsGrid Dashboard component + inline `conf=0.86 (3 books) volatility: balanced Δ-3.2¢` annotations on HeroPickCard/SpotlightCard/FeaturedCard + processNote/avoidReason lifted from tooltips to visible rows. tsc clean (exit 0). 150/150 probe matrix unchanged. Pre/post snapshots in backend/runtime/operator/baseline_snapshots/. No grading / replay / lineage / persistence / market-pipeline path changed. INC-013/014/015 all RESOLVED. Realism-1A + Market-1A + Operator-1A all shipped.)_

---

## OPERATOR ACTION — Fresh workstation review

```bash
cd backend
# 1. Run the slate refresh + workstation backend
npm run engine:restart        # ensure clean backend
npm run slate:refresh         # populates api_call_log.jsonl + freshens snapshot

# 2. Visit the workstation in the browser
# Default route: Workstation.tsx renders Dashboard.
# Look for:
#   - "Actionable Operator Buckets" section ABOVE the sport-native spotlight grid.
#   - 8 SpotlightCards: Best Balanced / Aggressive / Unders / Alt Ladders /
#     Disagreement Edges / Stale-Line Opportunities / Trap Ladders / Inflated Spots.
#   - On HeroPickCard: new "conf=X.XX (Nb) volatility: X Δ±X¢ vs consensus" row.
#   - On every SpotlightCard top: same inline annotations + SOFT/STALE pill if applicable.
#   - On FeaturedCard rows: same annotations + processNote no longer tooltip-only.
# 3. Verify the substrate is untouched
npm run market:status         # still works; api_call_log.jsonl still populating
npm run grading:status        # unchanged
npm run calibration:status    # unchanged
npm run lineage:status        # unchanged
npm run runtime:verify        # 14/14 PASS expected
```

---

## OPERATOR-EXPERIENCE — Remaining lever options (held for operator-approval gates)

| Phase | Levers | Effect |
|---|---|---|
| **1B** | whyQualifies + whyAvoid per card; tier text labels; mobile @media rules; keyboard shortcuts (Cmd/Ctrl+1..8 to jump buckets); copy-to-clipboard | Faster operator decision flow; mobile use enabled |
| **1C** | Operator-customizable bucket priority weights; "what changed since last refresh" delta surface; per-prop drill-down route | Personalized priority; live diff awareness |
| **1D** | Per-slip calibration-coefficient impact surfacing; Phase 1A filter-applied indicators on AGGRESSIVE slips | Trust-anchor surface for AGG-2 / TEXT-1 observation window |
| **1E** | Refined TRAP / INFLATED detection — depends on Phase Market-Ecology-1B INFLATE-1 / ANCHOR-1 levers | Per-book inflation index + reference-book truth anchor |

---

## MARKET-ECOLOGY — Remaining lever options (held)

| Phase | Levers |
|---|---|
| **1B** | STALE-1 (time-series stale detector — requires snapshot delta log) + CONS-1 (trimmed-mean consensus) + CONS-2 (low-book-count warning) |
| **1C** | DISAG-1 (disagreementScore field) + DISAG-2 (outlier-book cluster detection) + ALT-DISAG-1 (per-rung alt-line price divergence) |
| **1D** | INFLATE-1 (per-book inflation index) + ANCHOR-1 (reference-book truth anchor) |

---

## REALISM-ECOLOGY — Remaining lever options (held)

| Phase | Levers |
|---|---|
| **1B** | ALT-1 (BALANCED alt-line sort bonus) + PORT-1 (samePlayer thresholds re-tightened) |
| **1C** | CORR-1 (cap pairwise boost in AGGRESSIVE) + VOL-1 (split aggressive volatility bucket) |
| **1D** | AGG-1 (AGGRESSIVE minModelProb 0.20→0.28) + AGG-3 (drop lotto from AGGRESSIVE) + MLB-AGGRESSIVE under-only |

---

## DEFERRED ITEMS

| Phase | Scope |
|---|---|
| **1F-cosmetic** | Normalize 3 remaining `bet.actualStat` reads (lines 154/335/374 in buildPostGameReview.js) for display parity |
| **1H** | Personal-ledger settlement activation (INC-011 — 2000/2000 bets dormant at `result='pending'`) |
| **canAddLeg same-game gateway hardening** | Pre-existing gap when gameKey() returns null |
| **Snapshot retention for time-series** | Required before Market 1B STALE-1 |

---

## KNOWN OPEN INCIDENTS

| Inc | Status | Summary |
|---|---|---|
| INC-001 | OPEN — runtime-verification pending | F6.3 player-id resolution awaiting operator TERM 1 restart + diagnostics check |
| INC-002 | OPEN — known edge case | Same-lastname collision on same team (low NBA frequency) |
| INC-003 | OPEN — known limitation | NBA roster Map has no TTL; mid-season trades require process restart |
| INC-011 | OPEN — dormant ledger | personal_ledger.json 2000/2000 bets at `result='pending'`. Phase 1H candidate |
| INC-012 | OPEN — by design | ~84% of historical outcomes are pre-corpus orphans. Permanent |
| **INC-013** | **✅ RESOLVED 2026-05-14 (Phase Grading-Calibration-Operations-1E)** | Field-mapping fix shipped; calibration unblocked |
| **INC-014** | **✅ RESOLVED 2026-05-14 (Phase 1F)** | Stale-lockfile blocked deterministic backfill; PID-liveness + `--clear-locks` shipped |
| **INC-015** | **✅ RESOLVED 2026-05-14 (Phase 1G)** | PID-reuse edge case in Phase 1F's liveness probe; age-aware reclaim shipped |

---

## ACTIONABLE INTELLIGENCE DOCTRINE (Phase Operator-Experience-1A established)

- **Observability first** — surface existing intelligence before introducing new heuristics.
- **Anti-fabrication** — every visible annotation must trace to a deterministic backend value; if missing, omit (no "(n/a)" guesses).
- **Anti-clutter** — every new visible surface declares a top-N cap and auto-hides when empty.
- **Operator decision-speed** — calibration/market-informed actionable buckets render FIRST.
- **Replay/grading/calibration substrate untouched** — UX surfacing never disturbs pipeline.
- **Pre/post snapshots mandatory** — every Operator-Experience phase captures source-shape snapshots in `backend/runtime/operator/baseline_snapshots/`.

---

## MARKET OBSERVABILITY DOCTRINE (Phase Market-Ecology-1A established — still in force)

- Observability first; zero new network calls per phase unless approved.
- Anti-fabrication; empty sections print `(no data)`.
- Pre/post snapshots in `backend/runtime/market/baseline_snapshots/`.
- No sharp/soft book classification yet; no truth-anchor yet (deferred).
- API-burn observed, not enforced.

---

## REALISM ECOLOGY DOCTRINE (Phase Realism-Ecology-1A established — still in force)

- Incremental, attributable, calibration-informed.
- Pre/post snapshots in `backend/runtime/calibration_snapshots/`.
- Smallest safe step first.
- LOTTO and SAFE preserved unless explicitly approved.
- No hardcoded under-forcing, no player punishment, no slip rejection.

---

## TIERED LOCK STATE MACHINE (Phase 1F + 1G — preserved)

| Lock age | PID probe | Outcome |
|---|---|---|
| 0–10 min | alive | Honor |
| 0–10 min | dead (ESRCH) | Reclaim |
| 10–30 min | alive | Reclaim with `[INC-015]` warning |
| 10–30 min | dead | Reclaim |
| >30 min | any | Reclaim (hard TTL) |

---

## CANONICAL COMMAND SURFACE

```
# Brain enforcement
npm run brain:bootstrap    npm run brain:continuity    npm run brain:verify    npm run brain:checkpoint

# Slate refresh (Phase Market-1A: populates api_call_log.jsonl)
npm run slate:refresh    npm run slate:nba    npm run slate:mlb

# Engine lifecycle
npm run engine:start    npm run engine:restart    npm run engine:status

# Grading + calibration
npm run grading:run    npm run grading:backfill-all    npm run grading:backfill-all -- --clear-locks
npm run grading:status    npm run calibration:status    npm run lineage:status

# Market intelligence
npm run market:status    npm run market:status -- --sport=nba    npm run market:status -- --top=20

# Persistence
npm run persistence:status    npm run persistence:probe    npm run persistence:backfill-aliases    npm run persistence:import

# Epoch authority
npm run epoch:status

# 14-suite regression
npm run runtime:verify
```

---

## STATE INTEGRITY CHECKLIST (operator pre-flight)

```bash
cd backend
npm run brain:bootstrap        # MANDATORY
npm run brain:continuity       # MANDATORY
npm run brain:verify           # MANDATORY
npm run runtime:verify         # 14/14 PASS expected
node ../probe_grading_backfill_v1.js   # 42/42 PASS
node ../probe_lineage_v1.js            # 24/24 PASS
node ../probe_epoch_authority_v1.js    # 48/48 PASS
npm run persistence:probe              # 22/22 PASS
cd ../frontend && ./node_modules/.bin/tsc --noEmit -p . ; cd ..   # exit 0 expected
```

All probes must pass before declaring work done. brain:checkpoint must be run at end of every operator session.
