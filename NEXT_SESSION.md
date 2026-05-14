**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-14 (Phase Grading-Calibration-Operations-1G — INC-015 RESOLVED. Operator reported nba/2026-05-08 exit=1 at ~33ms and hypothesized "malformed replay payload"; forensic reproduction proved NO payload defect exists — the 33ms fingerprint is Phase 1F's lock guard fooled by pid-reuse. Phase 1G adds `ALIVE_PID_STALE_THRESHOLD_MS = 10 min`: locks with alive-pid AND startedAt >10min ago are reclaimed with explicit `[acquire-lock][INC-015]` warning. Phase 1F + 1G together form a 5-tier deterministic lock state machine. Full matrix 150/150 PASS. All 9 historical (sport, date) pairs run cleanly; nba/2026-05-08 in 451ms. INC-013, INC-014, INC-015 all RESOLVED.)_

---

## OPERATOR ACTION REQUIRED — Single command resolves all three open incidents

Phase 1F + 1G + 1E together fully unblock the historical calibration corpus on the operator host:

```bash
cd backend
npm run grading:backfill-all -- --clear-locks     # 1. Sweep stale lockfiles + run backfill
# Watch for [acquire-lock][INC-015] Reclaiming... warnings during the sweep.
# These are pid-reuse events Phase 1G now self-heals.

npm run grading:status                             # 2. Verify JOIN column populated + non-zero hit-rates
npm run calibration:status                         # 3. ⚠ CALIBRATION BLOCKED banner drops
npm run lineage:status                             # 4. hit-populated rises to ~100% within JOIN-matched subset
```

**Expected post-execution state**:
- `outcome_snapshots.hit` populates for the ~219 JOIN-matched rows (INC-013 + INC-012 ceiling).
- `outcome_snapshots.actual_value` populates from gradeTrackedBets writes (INC-013).
- `outcome_snapshots.delta_prob` = `model_prob - hit`.
- All 16 (sport, date) pairs run with exit=0; nba/2026-05-08 no longer fails (INC-014 + INC-015).
- `calibration:status` per-tier / per-volatility / per-side / per-family queries return non-empty rows.
- `lineage:status` no longer emits the INC-013 warning.
- The ~928 pre-corpus orphan outcomes (INC-012) remain hit-null and JOIN-unmatched by design.

---

## OPERATOR APPROVAL GATE — Phase Grading-Calibration-Operations-1G-cosmetic (display-parity finish)

> Phase 1E intentionally limited scope to grading-correctness sites. Three remaining `bet.actualStat` reads in `buildPostGameReview.js` are display/telemetry only.

| Line | Site | Current effect |
|---|---|---|
| 154 | `pushPlayerSample.recent.actualStat` | Player evolution recents show `actualStat: null` for tracked_bets. |
| 335 | Output shape per-bet `actualStat` | Per-bet review-row display field shows null for tracked_bets. |
| 374 | `withActuals` telemetry counter | Logs `withActuals: 0` even though hits compute correctly. |

Same backward-compatible `actualValue ?? actualStat` pattern as Phase 1E. Trivial follow-up.

---

## OPERATOR APPROVAL GATE — Phase Grading-Calibration-Operations-1H (Personal ledger settlement activation — INC-011)

> `personal_ledger.json` has 2000/2000 bets at `result='pending'` because `buildNightlyOrchestrator.stepLedgerSettle` is wired but never invoked (see INC-010 / INC-011). Process classification, CLV scoring, calibration trend curves on ledger bets are all blocked downstream.

This phase activates the orchestrator's existing settlement plumbing — no architectural change, just turning on a switch that has been built and tested but disabled. Operator-gated because activation produces real writes to `personal_ledger.json`.

---

## KNOWN OPEN INCIDENTS

| Inc | Status | Summary |
|---|---|---|
| INC-001 | OPEN — runtime-verification pending | F6.3 player-id resolution awaiting operator TERM 1 restart + diagnostics check. |
| INC-002 | OPEN — known edge case | Same-lastname collision on same team (low NBA frequency). |
| INC-003 | OPEN — known limitation | NBA roster Map has no TTL; mid-season trades require process restart. |
| INC-011 | OPEN — dormant ledger | personal_ledger.json 2000/2000 bets at `result='pending'`. Phase 1H candidate. |
| INC-012 | OPEN — by design | ~84% of historical outcomes are pre-corpus orphans. Permanent — no time-machine prediction synthesis. |
| **INC-013** | **✅ RESOLVED 2026-05-14 (Phase 1E)** | Field-mapping fix shipped; calibration unblocked. |
| **INC-014** | **✅ RESOLVED 2026-05-14 (Phase 1F)** | Stale-lockfile blocked deterministic backfill; PID-liveness + `--clear-locks` shipped. |
| **INC-015** | **✅ RESOLVED 2026-05-14 (Phase 1G)** | PID-reuse edge case in Phase 1F's liveness probe; age-aware reclaim (10-min threshold) shipped. |

---

## TIERED LOCK STATE MACHINE (Phase 1F + 1G combined)

| Lock age | PID probe | Outcome | Authoring phase |
|---|---|---|---|
| 0-10 min | alive | Honor (legitimate concurrent run) | preserved |
| 0-10 min | dead (ESRCH) | Reclaim | Phase 1F |
| 10-30 min | alive | **Reclaim with `[INC-015]` warning** | **Phase 1G** |
| 10-30 min | dead | Reclaim | Phase 1F |
| >30 min | any | Reclaim (hard TTL) | original |

---

## CANONICAL COMMAND SURFACE

```
# Brain enforcement
npm run brain:bootstrap     # mandatory pre-flight
npm run brain:continuity    # receipt-backed continuity check
npm run brain:verify        # freshness + regression matrix verification
npm run brain:checkpoint    # end-of-session seal (required before declaring done)

# Slate refresh
npm run slate:refresh       # both sports
npm run slate:nba           # NBA only (canonical refresh route)
npm run slate:mlb           # MLB only

# Engine lifecycle
npm run engine:start
npm run engine:restart
npm run engine:status

# Grading + calibration
npm run grading:run                                   # nightly orchestrator wrapper
npm run grading:backfill-all                          # repopulate historical outcomes
npm run grading:backfill-all -- --clear-locks         # Phase 1F+1G — pre-flight stale-lock sweep
npm run grading:backfill-all -- --clear-locks --dry   # scan-only preview
npm run grading:status                                # JOIN-success column (Phase 1D)
npm run calibration:status                            # JOIN-restricted + warnings (Phase 1D)
npm run lineage:status                                # per-date coverage + classification health (Phase 1D)

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
