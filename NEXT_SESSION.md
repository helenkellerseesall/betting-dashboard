**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-14 (Phase Market-Ecology-1A SHIPPED — canonical market observability. **OBS-1** `npm run market:status` (NEW 5-section CLI). **OBS-2** `consensusConfidence` field on buildLineShopping. **OBS-3** `apiCallLogger.js` wired into NBA + MLB Odds-API axios calls (append-only JSONL log; zero new network calls). Pre-1A baseline at `backend/runtime/market/baseline_snapshots/`. First canonical sandbox output: 6 books / 826 multi-book disagreements / 10 stale-row candidates. Full matrix 150/150 PASS. brain:checkpoint sealed 21:08:05Z. Heuristic levers (STALE-1, CONS-1/2, DISAG-1/2, ALT-DISAG-1, INFLATE-1, ANCHOR-1) held for operator-approval gates. INC-013/014/015 all RESOLVED. Realism-Ecology-1A AGG-2+TEXT-1 still shipped.)_

---

## OPERATOR ACTION REQUIRED — Fresh slate pull + first canonical market:status review

```bash
cd backend

# 1. Fresh slate pull (populates api_call_log.jsonl on host via OBS-3 wrappers)
npm run slate:refresh

# 2. First canonical market intelligence view
npm run market:status                  # all sports, top-10
npm run market:status -- --sport=nba   # NBA only
npm run market:status -- --sport=mlb   # MLB only
npm run market:status -- --top=20      # widen top-N to 20

# 3. (still applicable from prior phases) full replay/grading verification
npm run grading:backfill-all -- --clear-locks
npm run grading:status
npm run calibration:status
npm run lineage:status
```

**What to look for in market:status output**:
- Section 1: snapshot freshness across both sports; per-book row counts.
- Section 2: consensusConfidence distribution — p10 below 0.3 indicates high disagreement; bookCount distribution shows how often consensus is meaningfully multi-book.
- Section 3: top stale rows tagged `soft_line` (bettor value — book underprices) or `stale_line` (book overprices).
- Section 4: per-book historical CLV — 60-day rolling.
- Section 5: API-call burn rolling 24h/7d/30d.

---

## OPERATOR APPROVAL GATES — Phase Market-Ecology-1B / 1C / 1D (heuristic levers held)

Each phase requires its own operator-approval gate AND a measurable observation window from the prior phase.

| Phase | Levers | Effect |
|---|---|---|
| **1B** | STALE-1 (time-series stale detector — read N consecutive snapshots + per-book line-movement deltas) + CONS-1 (trimmed-mean consensus) + CONS-2 (low-book-count warning when bookCount < 3) | Surfaces lagging books, removes outlier distortion, flags weak-consensus props |
| **1C** | DISAG-1 (disagreementScore = max - min / consensus surfaced per prop) + DISAG-2 (outlier-book cluster detection — 2-of-3 consensus with 1 dissenter) + ALT-DISAG-1 (per-rung alt-line price divergence) | Per-prop disagreement quantification; alt-line ladder rung-level intelligence |
| **1D** | INFLATE-1 (per-book per-stat-family inflation index over 14d historical CLV) + ANCHOR-1 (reference-book truth anchor weighting) | Identifies "Caesars inflating superstar ladders" automatically; introduces Pinnacle-style sharp-book anchoring |

---

## OPERATOR APPROVAL GATES — Phase Realism-Ecology-1B / 1C / 1D (still held from prior phase)

| Phase | Levers | Effect |
|---|---|---|
| **1B** | ALT-1 (BALANCED alt-line sort bonus) + PORT-1 (samePlayer thresholds re-tightened to {3,5}) | Tilts BALANCED toward calibration-friendly alt-line ecology; restores honest portfolio warnings |
| **1C** | CORR-1 (cap pairwise boost contribution in AGGRESSIVE) + VOL-1 (split aggressive volatility bucket) | Reduces correlated-pair surface; volatility honesty |
| **1D** | AGG-1 (AGGRESSIVE minModelProb 0.20→0.28) + AGG-3 (drop "lotto" from AGGRESSIVE allowedVolatility) + MLB-AGGRESSIVE-under-only | Largest semantic shift; significantly tighter AGGRESSIVE gate |

---

## DEFERRED ITEMS

| Phase | Scope |
|---|---|
| **1F-cosmetic** | Normalize 3 remaining `bet.actualStat` reads (lines 154/335/374 in buildPostGameReview.js) for display parity. |
| **1H** | Personal-ledger settlement activation (INC-011 — 2000/2000 bets dormant at `result='pending'`). |
| **canAddLeg same-game gateway hardening** | Pre-existing gap when gameKey() returns null. Phase 1B+ candidate. |
| **Snapshot retention for time-series** | Required before STALE-1 (Market-1B candidate) — append snapshot delta logs to `runtime/market/snapshot_delta_log.jsonl`. |

---

## KNOWN OPEN INCIDENTS

| Inc | Status | Summary |
|---|---|---|
| INC-001 | OPEN — runtime-verification pending | F6.3 player-id resolution awaiting operator TERM 1 restart + diagnostics check. |
| INC-002 | OPEN — known edge case | Same-lastname collision on same team (low NBA frequency). |
| INC-003 | OPEN — known limitation | NBA roster Map has no TTL; mid-season trades require process restart. |
| INC-011 | OPEN — dormant ledger | personal_ledger.json 2000/2000 bets at `result='pending'`. Phase 1H candidate. |
| INC-012 | OPEN — by design | ~84% of historical outcomes are pre-corpus orphans. Permanent. |
| **INC-013** | **✅ RESOLVED 2026-05-14 (Phase Grading-Calibration-Operations-1E)** | Field-mapping fix shipped; calibration unblocked. |
| **INC-014** | **✅ RESOLVED 2026-05-14 (Phase 1F)** | Stale-lockfile blocked deterministic backfill; PID-liveness + `--clear-locks` shipped. |
| **INC-015** | **✅ RESOLVED 2026-05-14 (Phase 1G)** | PID-reuse edge case in Phase 1F's liveness probe; age-aware reclaim shipped. |

---

## MARKET OBSERVABILITY DOCTRINE (Phase Market-Ecology-1A established)

- **Observability first** — surface existing data before introducing heuristic weighting.
- **Zero new network calls** — Phase 1A wraps existing axios calls for logging; introduces no polling, retry, or rate-limit logic.
- **Anti-fabrication discipline** — `market:status` empty sections print `(no data)` rather than synthesizing values.
- **Pre/post snapshots mandatory** — every Market phase captures source-shape snapshots in `backend/runtime/market/baseline_snapshots/` for byte-comparable operator audit.
- **No sharp/soft book classification yet** — Pinnacle-style anchoring (ANCHOR-1) deferred until operator approves after observation window.
- **No truth-anchor yet** — system treats all books equally in consensus computation. Phase 1D candidate.
- **API-burn is observed, not enforced** — Phase 1A's logger is a passive ledger; per-day rate caps deferred.

---

## REALISM ECOLOGY DOCTRINE (Phase Realism-Ecology-1A established — still in force)

- **Incremental, attributable, calibration-informed** — never stack multiple realism interventions in one gate.
- **Pre/post snapshots mandatory** — every Realism phase captures `pre_realism_*` and `post_realism_*` snapshots in `backend/runtime/calibration_snapshots/`.
- **Smallest safe step first** — operator approves the minimal lever combination per gate.
- **LOTTO and SAFE preserved unless explicitly approved** — Phase 1A touched only AGGRESSIVE tier + AGGRESSIVE/LOTTO seeding texture.
- **No hardcoded under-forcing, no player punishment, no slip rejection** — only structural knobs and sort biases.
- **Dangerous upside preserved** — cross-game pairs, lotto tier, +5000 EV constructions all remain available.

---

## TIERED LOCK STATE MACHINE (Phase 1F + 1G — preserved through Phase Realism-1A and Market-1A)

| Lock age | PID probe | Outcome |
|---|---|---|
| 0–10 min | alive | Honor (legitimate concurrent run) |
| 0–10 min | dead (ESRCH) | Reclaim |
| 10–30 min | alive | Reclaim with `[INC-015]` warning |
| 10–30 min | dead | Reclaim |
| >30 min | any | Reclaim (hard TTL) |

---

## CANONICAL COMMAND SURFACE

```
# Brain enforcement
npm run brain:bootstrap     # mandatory pre-flight
npm run brain:continuity
npm run brain:verify
npm run brain:checkpoint    # end-of-session seal

# Slate refresh
npm run slate:refresh       # both sports — now populates api_call_log.jsonl (Phase Market-1A OBS-3)
npm run slate:nba           # NBA only (canonical refresh route)
npm run slate:mlb           # MLB only

# Engine lifecycle
npm run engine:start
npm run engine:restart
npm run engine:status

# Grading + calibration
npm run grading:run
npm run grading:backfill-all
npm run grading:backfill-all -- --clear-locks
npm run grading:backfill-all -- --clear-locks --dry
npm run grading:status
npm run calibration:status
npm run lineage:status

# Market intelligence (NEW Phase Market-Ecology-1A)
npm run market:status                   # canonical 5-section market observability inspector
npm run market:status -- --sport=nba
npm run market:status -- --sport=mlb
npm run market:status -- --top=20

# Persistence
npm run persistence:status
npm run persistence:probe
npm run persistence:backfill-aliases
npm run persistence:import

# Epoch authority
npm run epoch:status

# 14-suite regression matrix
npm run runtime:verify
```

---

## STATE INTEGRITY CHECKLIST (operator pre-flight)

```bash
cd backend
npm run brain:bootstrap        # MANDATORY
npm run brain:continuity       # MANDATORY
npm run brain:verify           # MANDATORY
npm run runtime:verify         # 14/14 PASS expected (~1.9s on host)
node ../probe_grading_backfill_v1.js   # 42/42 PASS
node ../probe_lineage_v1.js            # 24/24 PASS
node ../probe_epoch_authority_v1.js    # 48/48 PASS
npm run persistence:probe              # 22/22 PASS
```

All probes must pass before declaring work done. brain:checkpoint must be run at end of every operator session.
