**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-14 (Phase Realism-Ecology-1A SHIPPED. AGG-2 (`TIER_TEMPLATES.aggressive.maxPerGame` 2→1) + TEXT-1 (`offensiveAttackTextureBonus` over-side boost halved 0.032→0.016). Smallest-safe step toward truthful betting ecology. LOTTO untouched, MLB BALANCED under-only preserved, FAMILY_CALIBRATION_COEFFICIENTS unchanged, volatility rules unchanged, portfolio thresholds unchanged. Phase-tagged Law 10 comments. Pre/post snapshots at `backend/runtime/calibration_snapshots/`. Live MLB 2026-05-05 confirms AGGRESSIVE still produces +5864 ev:430% slips. Full matrix 150/150 PASS. brain:checkpoint sealed 20:18:14Z. Operator-mandated discipline: forward observation window before next gate. INC-013/014/015 all RESOLVED. Phase 1B/1C/1D held for operator-approval gates.)_

---

## OPERATOR ACTION — Fresh slate pull + calibration snapshot comparison

Per operator's post-1A mandate:

```bash
cd backend

# 1. Full replay/grading verification on operator host
npm run grading:backfill-all -- --clear-locks
npm run grading:status        # confirm JOIN populated + hit-rates intact
npm run calibration:status    # baseline AGGRESSIVE hit-rate (week 0 of observation window)
npm run lineage:status        # confirm no regression

# 2. Fresh slate pull
npm run slate:refresh         # builds today's slate with Phase 1A construction

# 3. Calibration snapshot comparison against pre-1A baseline
diff backend/runtime/calibration_snapshots/pre_realism_1a_*.txt \
     backend/runtime/calibration_snapshots/post_realism_1a_*.txt
```

**Forward observation discipline**:
- Track AGGRESSIVE hit-rate weekly via `npm run calibration:status`.
- Compare per-tier hit-rates against pre-1A baseline as corpus grows.
- Effect sizes will be **directional, not statistically conclusive** until multiple weeks of forward grading accumulate beyond ~219 JOIN-matched outcomes (INC-012 ceiling).
- Phase 1B/1C/1D should each be operator-gated after their respective observation window.

---

## REMAINING REALISM-ECOLOGY LEVERS (operator-approval gates)

| Phase | Levers | Effect | When |
|---|---|---|---|
| **1B** | ALT-1 (BALANCED alt-line sort bonus) + PORT-1 (samePlayer thresholds re-tightened to {3,5}) | Tilts BALANCED toward calibration-friendly alt-line ecology; restores honest portfolio warnings | After 1A observation window |
| **1C** | CORR-1 (cap NBA pairwise boost contribution in AGGRESSIVE seeding at +0.02) + VOL-1 (split aggressive volatility bucket — separate "moderate-odds normal" from "structurally rare event") | Further reduces correlated-pair surface; volatility honesty | After 1B observation window |
| **1D** | AGG-1 (AGGRESSIVE minModelProb 0.20→0.28) + AGG-3 (drop "lotto" from AGGRESSIVE allowedVolatility) + extending MLB BALANCED under-only to MLB AGGRESSIVE | Largest semantic shift — significantly tighter AGGRESSIVE gate | After 1C observation window |

---

## DEFERRED ITEMS (Phase 1F-cosmetic + 1H + future)

| Phase | Scope |
|---|---|
| **1F-cosmetic** | Normalize 3 remaining `bet.actualStat` reads (lines 154/335/374 in buildPostGameReview.js) for display parity — Phase 1E left these intentionally untouched per smallest-safe-step. |
| **1H** | Personal-ledger settlement activation (INC-011 — 2000/2000 bets dormant at `result='pending'`). Orchestrator's `stepLedgerSettle` is wired but never invoked. |
| **future** | Harden `canAddLeg` same-game gateway when `gameKey()` returns null (legs missing both `eventId` and `matchup`). Surfaced as a pre-existing gap by Phase 1A inspection; not blocking. |

---

## KNOWN OPEN INCIDENTS

| Inc | Status | Summary |
|---|---|---|
| INC-001 | OPEN — runtime-verification pending | F6.3 player-id resolution awaiting operator TERM 1 restart + diagnostics check. |
| INC-002 | OPEN — known edge case | Same-lastname collision on same team (low NBA frequency). |
| INC-003 | OPEN — known limitation | NBA roster Map has no TTL; mid-season trades require process restart. |
| INC-011 | OPEN — dormant ledger | personal_ledger.json 2000/2000 bets at `result='pending'`. Phase 1H candidate. |
| INC-012 | OPEN — by design | ~84% of historical outcomes are pre-corpus orphans. Permanent. |
| **INC-013** | **✅ RESOLVED 2026-05-14 (Phase 1E)** | Field-mapping fix shipped; calibration unblocked. |
| **INC-014** | **✅ RESOLVED 2026-05-14 (Phase 1F)** | Stale-lockfile blocked deterministic backfill; PID-liveness + `--clear-locks` shipped. |
| **INC-015** | **✅ RESOLVED 2026-05-14 (Phase 1G)** | PID-reuse edge case in Phase 1F's liveness probe; age-aware reclaim shipped. |

---

## TIERED LOCK STATE MACHINE (Phase 1F + 1G — preserved through Phase 1A)

| Lock age | PID probe | Outcome |
|---|---|---|
| 0–10 min | alive | Honor (legitimate concurrent run) |
| 0–10 min | dead (ESRCH) | Reclaim |
| 10–30 min | alive | Reclaim with `[INC-015]` warning |
| 10–30 min | dead | Reclaim |
| >30 min | any | Reclaim (hard TTL) |

---

## REALISM ECOLOGY DOCTRINE (Phase 1A established)

- **Incremental, attributable, calibration-informed** — never stack multiple realism interventions in the same gate.
- **Pre/post snapshots mandatory** — every Realism phase captures `pre_realism_*` and `post_realism_*` snapshots in `backend/runtime/calibration_snapshots/` so the operator can byte-diff source shape changes.
- **Smallest safe step first** — operator approves the minimal lever combination per gate.
- **LOTTO and SAFE preserved unless explicitly approved** — Phase 1A touched only AGGRESSIVE tier + AGGRESSIVE/LOTTO seeding texture.
- **No hardcoded under-forcing, no player punishment, no slip rejection** — only structural knobs and sort biases.
- **Dangerous upside preserved** — cross-game pairs, lotto tier, +5000 EV constructions all remain available.

---

## CANONICAL COMMAND SURFACE

```
# Brain enforcement
npm run brain:bootstrap     # mandatory pre-flight
npm run brain:continuity
npm run brain:verify
npm run brain:checkpoint    # end-of-session seal

# Slate refresh
npm run slate:refresh       # both sports
npm run slate:nba           # NBA only (canonical refresh route)
npm run slate:mlb           # MLB only

# Engine lifecycle
npm run engine:start
npm run engine:restart
npm run engine:status

# Grading + calibration
npm run grading:run
npm run grading:backfill-all                          # Phase 1B+
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
