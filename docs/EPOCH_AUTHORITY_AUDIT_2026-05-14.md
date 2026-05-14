# PHASE Longitudinal-Integrity-1A — EPOCH AUTHORITY TOPOLOGY AUDIT
**Phase A deliverable: full epoch-derivation map, canonical-owner proposal, safe migration plan.**
**NO code patches in this phase. Operator review required before Phase B (canonical helper introduction).**

_Generated: 2026-05-14 | Builds on: `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md` (Hidden Failure §3) + `docs/PERSISTENCE_AUDIT_2026-05-14.md` (§11)_

---

## EXECUTIVE SUMMARY (5 sentences)

The audit identified **five independent epoch_id derivation sites** across four pipelines, producing **four structurally different formulas**: `<ts>|<sport>|<slate>` (sport-parameterized), `<ts>|mlb|<slate>` (hardcoded), `LIVE|<ts>|mlb|<slate>` (LIVE prefix), and `<capturedAt>|mlb|<slate>` (no fallback). The schema enforces `prediction_epochs.epoch_id TEXT PRIMARY KEY` (single-column PK), meaning **any two writers that compute identical bytes will collide silently** under `INSERT OR IGNORE` — the second writer's richer metadata is dropped. Today's active producers in production (`prediction_epochs: 29 rows`, `frozen_contextual_states: 843 rows`) are NBA snapshot freeze + NBA workstation freeze (both via #1), and the MLB live-state freeze (via #3, disambiguated by `LIVE` prefix). The latent risk is the MLB contextual freeze writer (#2) — it produces formula-identical bytes to #1 when #1 is called with `sport='mlb'`, so if a future MLB nightly path calls both, the contextually-rich row will silently lose to the bare row at the freeze write site. **The fix is additive: a single `derivePredictionEpochId(opts)` helper in `backend/storage/intelligence.js` (next to the existing canonical normalizers), with phase-tagged observability that emits `[EPOCH-ID-DERIVED]` once per formula variant and `[EPOCH-ID-COLLISION-DETECTED]` if two writers ever compute identical bytes from a single process.**

---

## 1. EPOCH TOPOLOGY MAP

### 1.1 Five derivation sites — formulas extracted from source

| # | Location | Function signature | Formula | Default-to-now fallback |
|---|---|---|---|---|
| **1** | `backend/pipeline/memory/freezePredictionEpoch.js:83` | `computeEpochId(snapshotUpdatedAt, sport, slateDate)` | `<ts>\|<sport_lower>\|<slateDate>` | `safeStr(snapshotUpdatedAt) || new Date().toISOString()` |
| **2** | `backend/pipeline/mlb/context/freezeMlbContextualEpoch.js:51` | `computeMlbEpochId(snapshotUpdatedAt, slateDate)` | `<ts>\|mlb\|<slateDate>` ← hardcoded `'mlb'` | `safeStr(snapshotUpdatedAt) || new Date().toISOString()` |
| **3** | `backend/pipeline/mlb/live/freezeMlbLiveStateEpoch.js:54` | `computeLiveEpochId(snapshotUpdatedAt, capturedAtIso, slateDate)` | `LIVE\|<ts>\|mlb\|<slateDate>` | `safeStr(capturedAtIso) ‖ safeStr(snapshotUpdatedAt) ‖ new Date().toISOString()` (3-level) |
| **4** | `backend/pipeline/mlb/live/mlbLiveStateHistory.js:57` | `computeEpochId(capturedAtIso, slateDate)` | `<capturedAtIso>\|mlb\|<slateDate>` | **NONE** — uses `""` if `capturedAtIso` is null |
| **5** (slate-date helper, not an epoch_id generator but feeds them) | `backend/http/nbaIsolatedRoutes.js:46` | `_detroitSlateDateKey(value)` | (Detroit-keyed `YYYY-MM-DD`) | falls back to `new Date().toISOString().slice(0, 10)` |

### 1.2 Active writers (SQLite `prediction_epochs`)

| Writer | Source location | Generator used | Currently producing rows? |
|---|---|---|---|
| NBA snapshot freeze (live-fetch branch) | `http/nbaIsolatedRoutes.js:1568` `_lazyFreezePredictionEpoch` | #1 via `freezePredictionEpoch` | YES — primary source of the 29 rows in production |
| NBA snapshot freeze (replay branch) | `http/nbaIsolatedRoutes.js:1515` `_lazyFreezePredictionEpoch` | #1 via `freezePredictionEpoch` (sport='nba') | YES — fires on `?replay=disk` |
| NBA workstation freeze | `routes/workstationRoutes.js:668` `freezePredictionEpoch` | #1 directly | YES — fires on `/api/ws/state` cache-miss |
| MLB contextual freeze | `pipeline/mlb/context/freezeMlbContextualEpoch.js:171` `freezeMlbContextualEpoch` | #2 | **NOT WIRED INTO LIVE PIPELINE** (per file comment: "wiring it into the snapshot lifecycle is deferred to the grading session"). Only `scripts/verifyMlbImmutabilityHardening.js` calls it today. |
| MLB live state freeze | `scripts/refreshMlbLiveState.js:79` `freezeMlbLiveStateEpoch` | #3 | YES when operator runs MLB live state refresh |

### 1.3 Active writers (JSONL append-only)

| Writer | Source location | Generator used | Currently producing rows? |
|---|---|---|---|
| MLB live state history | `pipeline/mlb/live/mlbLiveStateHistory.js:143` `appendHistoryRecord` | #4 — local `computeEpochId(ts, sd)` | YES — files in `backend/data/mlbLiveStateHistory/YYYY-MM-DD.jsonl` (3 files observed: 2026-05-12/13/14) |

### 1.4 Readers

Single canonical reader: `backend/pipeline/memory/readFrozenEpoch.js`. Exposes `listEpochs`, `getEpoch`, `getEpochPredictions`, `getFrozenPredictionWithContext`. Reads via `epoch_id` directly. NEVER writes.

Probes:
- `scripts/verifyMlbImmutabilityHardening.js` (constructs test epoch_ids directly, doesn't use the live derivation functions — fixture sentinels)
- `probe_snapshot_freeze_v1.js` (Session BD), `probe_frozen_epoch_v1.js` (Session AZ), `probe_eager_init_v1.js` (Session BC), `probe_longitudinal_completion_v1.js`, `probe_outcome_completion_v1.js`

### 1.5 Schema enforcement

```sql
CREATE TABLE IF NOT EXISTS prediction_epochs (
  epoch_id TEXT PRIMARY KEY,        -- SINGLE-COLUMN PK
  ...
);

CREATE TABLE IF NOT EXISTS frozen_contextual_states (
  prediction_id TEXT NOT NULL,
  epoch_id      TEXT NOT NULL,
  ...
  PRIMARY KEY (prediction_id, epoch_id)
);
```

`epoch_id` uniqueness is enforced ONLY by the single-column PK on `prediction_epochs`. The `INSERT OR IGNORE` semantics mean **collisions are silent no-ops** — the second writer's payload (metadata, source, notes, prediction_count) is dropped.

---

## 2. CANONICAL EPOCH OWNER (proposed)

**Today**: no canonical owner. Five independent functions across four files.

**Proposed**: `backend/storage/intelligence.js:derivePredictionEpochId(opts)`.

Rationale:
- `intelligence.js` already hosts `normPlayer`, `normFam`, `normBook`, `predictionId` — the existing canonical-normalizer authority.
- Adding `derivePredictionEpochId` there places epoch derivation in the same authority surface, with the same `[CANONICALIZATION-COLLISION-DETECTED]` observability pattern (already proven via Phase E1).
- Single import surface: every freeze writer requires it from one place; future writers cannot accidentally fork the formula.

Proposed canonical signature:

```js
derivePredictionEpochId({
  sport,                  // required (lowercased internally)
  slateDate,              // required (YYYY-MM-DD)
  snapshotUpdatedAt,      // ISO; required for normal freeze
  capturedAtIso,          // optional; LIVE freezes use this
  kind = "snapshot",      // "snapshot" | "live" | "manual"
}) → string
```

Returns: `<kind_prefix><ts>|<sport>|<slate>` where `<kind_prefix>` is `""` for snapshot/manual and `"LIVE|"` for live.

Canonical formula (proposed bytes):

```
snapshot:   "<ts>|<sport>|<slateDate>"
live:       "LIVE|<ts>|<sport>|<slateDate>"
manual:     "MANUAL|<ts>|<sport>|<slateDate>"
```

Each of the five existing call sites can adopt this incrementally (Phase B). The MLB hardcoded-`mlb` sites (#2 and #4) become `sport='mlb'` parameter passes. The LIVE prefix (#3) becomes `kind='live'`. The JSONL writer (#4) calls the same helper to stay in lockstep with SQLite.

---

## 3. DUPLICATE DERIVATION RISKS

| Risk | Severity | Affected writers | Current consequence |
|---|---|---|---|
| **#1 and #2 produce identical bytes for MLB** | **HIGH (latent)** | `freezePredictionEpoch(sport='mlb', ...)` vs `freezeMlbContextualEpoch(...)` for same snapshot | If both fire in the same MLB pipeline run, the second writer's INSERT OR IGNORE is a silent no-op on `prediction_epochs`. The contextually-rich row of `frozen_contextual_states` also loses to the bare row on the composite PK. **Today this is dormant because #2 is not yet wired into the live MLB pipeline** — `freezeMlbContextualEpoch.js` is only invoked from `verifyMlbImmutabilityHardening.js`. When Phase 1C (outcome wiring) or any MLB freeze wiring lands, this becomes live unless the canonical helper unifies first. |
| **#4 and #2 produce identical bytes for MLB JSONL vs SQLite** | LOW (intentional cross-store binding) | `mlbLiveStateHistory.appendHistoryRecord` (JSONL) shares epoch_id with `freezeMlbContextualEpoch` (SQLite) | Same logical observation visible in both stores. Useful for cross-reference. **BUT** if either formula changes without the other, the two stores desynchronize silently. No probe today asserts they stay aligned. |
| **#3 LIVE prefix safely disambiguates** | NO RISK | `freezeMlbLiveStateEpoch` | "LIVE\|..." prefix means LIVE epochs cannot collide with non-LIVE epochs by construction. This is the correct pattern; the canonical helper should preserve it. |
| **#1 used by NBA snapshot AND workstation freeze for same snapshot** | LOW (intentional cross-path coverage) | Session BD snapshot freeze + Session AZ workstation freeze | Both writers correctly produce identical epoch_id for the same `oddsSnapshot.updatedAt`. Composite PK on `frozen_contextual_states.(prediction_id, epoch_id)` lets both rows coexist for the same prediction_id IF the contextual richness differs — wait, no: INSERT OR IGNORE means the FIRST writer wins. If workstation freeze (rich) arrives second, its row is silently dropped in favor of the snapshot freeze's bare row. **This is the dual-freeze risk the May 14 audit flagged as Top Risk #5.** Documented in `MASTER_BRAIN.md` but no probe enforces ordering or unification. |
| **Default-to-now fallback inconsistency** | MEDIUM | #1, #2 fall back to `new Date().toISOString()` if `snapshotUpdatedAt` missing. #4 uses empty string. | If `snapshotUpdatedAt` is ever null/missing, #1 and #2 default to now() — two captures of the "same" snapshot would produce DIFFERENT epoch_ids that don't collide. Idempotency contract breaks. #4 instead produces `""` which is structurally invalid but bytewise stable (same input → same output). **The canonical helper must define ONE fallback policy explicitly.** Recommended: REJECT (throw / return null) when `snapshotUpdatedAt` is missing for snapshot/live kinds; require explicit `kind='manual'` to use now(). |

---

## 4. REPLAY LINEAGE RISKS

The replay path (`/refresh-snapshot?replay=disk`) reads `backend/snapshot.json` and re-runs the snapshot pipeline, including the freeze hook (Session BD `[NBA-SNAPSHOT-FREEZE-REPLAY]`).

**Current replay safety**:
- ✅ `INSERT OR IGNORE` on `prediction_epochs` means re-replaying the same snapshot is a no-op against the freeze tables.
- ✅ Identical `snapshot.updatedAt` produces identical `epoch_id` via formula #1 — verified by `probe_snapshot_freeze_v1.js` (29/29 PASS including "re-invocation with same snapshot updatedAt is no-op").

**Latent risk (canonical helper migration)**:
- If the canonical helper changes the bytes of an existing formula (e.g. lowercases sport when prior code didn't), re-replaying a historical snapshot would produce a NEW epoch_id that doesn't match the originally-stored one. The new epoch row would be inserted and the historical one would remain — a **fork**.
- **Mitigation**: Phase B introduces the helper alongside existing functions WITHOUT changing the bytes of formula #1. All five existing functions remain operational and unchanged. Phase C migrates each call site to the helper ONLY AFTER a byte-parity probe confirms identical output for every observed input. Phase D removes the deprecated functions.
- **Replay-safe invariant during migration**: `derivePredictionEpochId({sport:'nba', snapshotUpdatedAt:T, slateDate:D}) === computeEpochId(T, 'nba', D)` for every value of T and D observed in production. The Phase B probe enforces this on a fixture.

**No replay path reads from JSON files for epoch derivation** — replay derives from `snapshot.json` and then computes epoch_ids the same way live refresh does. Migrating call sites doesn't change replay semantics.

---

## 5. GRADING LINEAGE RISKS

Grading reads `prediction_snapshots` and writes `outcome_snapshots` (the latter currently 0 rows — load-bearing gap per `PERSISTENCE_AUDIT_2026-05-14.md` §10, Phase 1C scope). The grading-layer linkage is via `prediction_id`, **not** `epoch_id` directly. `epoch_id` is the binding from `prediction_id` to its contextual state via `frozen_contextual_states.(prediction_id, epoch_id)`.

**Risks**:

| Risk | Severity | Why |
|---|---|---|
| Pre-canonical-helper epoch_ids vs post-canonical-helper epoch_ids | MEDIUM | If formula bytes shift during migration, historical `frozen_contextual_states` rows become orphaned from any new lookup that recomputes the epoch_id. |
| `frozen_contextual_states` collision dropping richer row | MEDIUM | Dual-freeze (Session AZ workstation rich + Session BD snapshot bare) for same `(prediction_id, epoch_id)`: INSERT OR IGNORE means first-write-wins. If snapshot freeze arrives first, the workstation's contextual richness is lost. **The May 14 audit flagged this; no mitigation has shipped yet.** |
| Grading queries that join via slate_date | LOW | `getEpochPredictions(epochId)` in `readFrozenEpoch.js` resolves `epoch.slate_date` then filters predictions — if `slate_date` derivation changes (e.g. `_detroitSlateDateKey` vs raw arg), the join could miss predictions. |

**Mitigations encoded in proposal**:
- Canonical helper preserves byte parity for every observed input (Phase B parity probe).
- Phase Longitudinal-Integrity-1B introduces an `[EPOCH-ID-COLLISION-DETECTED]` probe that emits when two writers produce identical bytes in a single process — surfaces the dual-freeze collision the moment it happens rather than years later when calibration analysis reveals the gap.
- Resolution of the dual-freeze richness loss is **out of scope for this phase** — it's a freeze-architecture decision (Phase Longitudinal-Integrity-2 candidate: either pick a single canonical freeze writer for NBA, or merge them, or change PK to allow richer-row to overwrite bare-row).

---

## 6. TEMPORAL COUPLING HOTSPOTS

Places where epoch_id derivation depends on inputs that are themselves derived elsewhere:

1. **`_detroitSlateDateKey` in `nbaIsolatedRoutes.js`** — Detroit-timezone slate-date derivation hardcoded inside the route handler. MLB callers compute their `slateDate` differently (passed directly from caller). If Detroit timezone ever changes or DST behavior shifts, NBA and MLB will key the same wall-clock moment to different slate dates.
2. **`snapshot.updatedAt`** — written by `replaceOddsSnapshot(snap)` in `server.js`. Every freeze writer reads this. If any code path mutates `oddsSnapshot.updatedAt` mid-freeze, the freeze writer captures a stale ts. Today this is protected by atomic `replaceOddsSnapshot` semantics, but it's an implicit contract — nothing prevents future code from `oddsSnapshot.updatedAt = new Date().toISOString()` directly.
3. **`capturedAtIso` for LIVE freezes** — derived in `scripts/refreshMlbLiveState.js` and passed in. No canonical helper. If a future caller passes a different ISO format (e.g. without seconds), `epoch_id` bytes drift.
4. **JSONL append vs SQLite freeze sequence** — `mlbLiveStateHistory.appendHistoryRecord` (JSONL) and `freezeMlbContextualEpoch` (SQLite) are called from different places. If a live refresh appends to JSONL but the corresponding SQLite freeze fails silently (or vice versa), the two stores diverge for that observation. No reconciliation today.

---

## 7. CROSS-SPORT INCONSISTENCIES

| Concern | NBA | MLB |
|---|---|---|
| Epoch generator | #1 `computeEpochId(t, sport, slate)` — sport-parameterized | #2 `computeMlbEpochId(t, slate)` — hardcoded `'mlb'`; #3 `computeLiveEpochId(t, captured, slate)` — hardcoded `'mlb'`; #4 `computeEpochId(captured, slate)` — hardcoded `'mlb'` |
| Slate-date derivation | `_detroitSlateDateKey` — Detroit timezone | caller-supplied raw string — no canonical helper |
| Active freeze paths | snapshot freeze (Session BD), workstation freeze (Session AZ) | live state freeze (operator script only); contextual freeze writer EXISTS but is not wired to runtime |
| Append-only JSONL history | none | yes — `mlbLiveStateHistory` |
| Process-scoped extras | `__nbaTeamRosterCache` (F6.3) | (no equivalent) |

**Implication for future NHL/NFL onboarding**: the current pattern would require adding a 6th and 7th `computeNhlEpochId` / `computeNflEpochId` plus matching slate-date helpers. The canonical helper eliminates this fork point — one helper covers all sports.

---

## 8. CANONICALIZATION STRATEGY (proposed)

**Stage one (Phase Longitudinal-Integrity-1B)** — additive, zero-cut:

1. Add `derivePredictionEpochId(opts)` and `deriveCanonicalSlateDate(value, opts)` to `backend/storage/intelligence.js`. Phase-tagged inline `Phase Longitudinal-Integrity-1B (2026-05-14)`.
2. Add observability: `[EPOCH-ID-DERIVED]` probe once-per-formula-variant-per-process; `[EPOCH-ID-COLLISION-DETECTED]` if a process observes two different writer-source-tags producing the same epoch_id bytes within one process lifetime.
3. Add `getEpochAuthorityDiagnostics()` / `resetEpochAuthorityDiagnostics()` mirroring the existing Phase E1 canonicalization-diagnostics pattern. Counters: `epochsDerived`, `formulaVariantsObserved`, `collisionsDetected`, `firstCollisionSample`.
4. Surface diagnostics via `/api/best-available.nbaCacheDiagnostics.epochAuthority` (additive — extends existing diag block).
5. Add new `npm run epoch:status` to `backend/package.json` showing: row counts of `prediction_epochs` by formula prefix, distinct epoch_id formula patterns observed, collision-detector state.
6. Add probe `probe_epoch_authority_v1.js` (repo root) asserting byte-parity between the new canonical helper and every existing `compute*EpochId` function for a fixture spanning observed historical inputs.

**Stage two (Phase Longitudinal-Integrity-1C)** — migrate readers/writers:

1. `freezePredictionEpoch.js:computeEpochId` becomes a thin wrapper around `derivePredictionEpochId({kind:'snapshot'})`.
2. `freezeMlbContextualEpoch.js:computeMlbEpochId` becomes a thin wrapper around `derivePredictionEpochId({kind:'snapshot', sport:'mlb'})`.
3. `freezeMlbLiveStateEpoch.js:computeLiveEpochId` becomes a thin wrapper around `derivePredictionEpochId({kind:'live', sport:'mlb'})`.
4. `mlbLiveStateHistory.js:computeEpochId` becomes a thin wrapper around `derivePredictionEpochId({kind:'snapshot', sport:'mlb'})` — preserves intentional cross-store binding.
5. `_detroitSlateDateKey` in `nbaIsolatedRoutes.js` is extracted (or re-exported) from `intelligence.js:deriveCanonicalSlateDate` so MLB and NBA share the same slate-date authority.
6. Every wrapper passes through the canonical helper but preserves the prior signature for backward compatibility.

**Stage three (Phase Longitudinal-Integrity-1D)** — deprecate wrappers:

1. Add `@deprecated` JSDoc to each shim function with a phase tag and removal target.
2. Audit consumers; replace direct calls to `compute*EpochId` with direct calls to the canonical helper.
3. Remove the shim wrappers in a follow-up session after the regression matrix confirms zero callers remain.

---

## 9. OBSERVABILITY PLAN

Following the Phase F2/F3/F5-C precedent (rate-limited, additive, structured probes):

| Probe | Emission | When fired |
|---|---|---|
| `[EPOCH-ID-DERIVED]` | Once per distinct formula variant per process | First time the canonical helper observes a new `{kind, sport}` combination |
| `[EPOCH-ID-COLLISION-DETECTED]` | Once per process per (raw_writer_tag_A, raw_writer_tag_B, epoch_id) tuple | When two distinct writer-tags (e.g. `snapshot_bestprops` + `workstation_state`) compute identical bytes in one process lifetime |
| `[EPOCH-ID-FALLBACK-USED]` | Once per process per fallback path | When the helper falls back to `new Date().toISOString()` because `snapshotUpdatedAt`/`capturedAtIso` were both missing |
| `[EPOCH-ID-AUTHORITY-OBSERVED]` | Once at boot | After `initializeAtBoot` completes, summarizes the loaded canonical helper version + formula variants |

Diagnostics surface:

```js
// In storage/intelligence.js
getEpochAuthorityDiagnostics() → {
  epochsDerived:           N,
  formulaVariantsObserved: { "snapshot|nba": 12, "snapshot|mlb": 7, "live|mlb": 5 },
  collisionsDetected:      0,
  fallbacksUsed:           0,
  firstCollisionSample:    null,
  firstFallbackSample:     null,
}
```

Surfaced via `/api/best-available.nbaCacheDiagnostics.epochAuthority` (additive — never removes existing fields). Inspectable via `npm run epoch:status`.

---

## 10. SAFE MIGRATION PLAN

Six discrete sub-phases. Each is independently revertable. Each is operator-gated.

| Phase | Title | Risk | Sessions | Reversibility |
|---|---|---|---|---|
| **1A** | Topology audit + brain docs (THIS PHASE — shipped today) | None | 1 | Trivial — docs only |
| **1B** | Canonical helper + observability + parity probe | Low | 1 | Revert: remove new functions, no existing call site changed |
| **1C** | Migrate the 5 derivation sites to thin wrappers around the canonical helper | Medium | 1 | Revert per file: each wrapper retains backward-compatible signature |
| **1D** | Deprecate wrappers, migrate consumers to direct canonical calls | Low | 1 | Revert: shim wrappers can be restored |
| **1E** | Dual-freeze richness collision mitigation (separate scope — Phase Longitudinal-Integrity-2A) | Medium-High | 1 | Architectural decision — separate operator gate |
| **1F** | JSONL ↔ SQLite epoch_id reconciliation probe + observability | Low | 1 | Pure observability — no behavior change |

**Sequencing rules**:
- 1A → 1B → 1C → 1D linear, mandatory order.
- 1E is independent of 1A-1D; can run before or after, but 1E gains clarity if the canonical helper exists first.
- 1F is additive observability — can land any time after 1B.

**Estimated total work**: 4-6 sessions to complete 1B through 1F. Phase 1B alone delivers ~60% of the value (canonical helper + observability without migrating any call sites — drift is now detectable).

---

## 11. PARITY VALIDATION PLAN

For each cutover step in §10, the corresponding parity check:

| Cutover | Pre-cut assertion | Post-cut assertion |
|---|---|---|
| **1B helper introduction** | No `derivePredictionEpochId` in `intelligence.js` exports | Helper present; byte-parity probe asserts `derivePredictionEpochId({kind:'snapshot', sport, snapshotUpdatedAt, slateDate}) === computeEpochId(snapshotUpdatedAt, sport, slateDate)` for a 32-fixture matrix |
| **1B observability** | `epochAuthority` field absent in `nbaCacheDiagnostics` | Field present; `epochsDerived=0` on fresh boot; increments with each freeze |
| **1B collision probe** | `[EPOCH-ID-COLLISION-DETECTED]` never observed in production logs | Probe synthetically triggers a same-bytes collision in a `/tmp` fixture; asserts the probe emits exactly once |
| **1C per-site migration** | Existing `compute*EpochId` returns formula bytes F1 for input I | Wrapped `compute*EpochId` calls canonical helper, returns identical bytes F1 for input I (byte-parity probe MUST PASS for every observed input class) |
| **1C end-to-end freeze flow** | NBA snapshot freeze produces epoch_id X | NBA snapshot freeze still produces epoch_id X (no replay drift) |
| **1D wrapper removal** | Shim wrapper exists at `compute*EpochId` | Wrapper removed; all callers use canonical helper directly; `npm run brain:checkpoint --skip-matrix=false` PASS |

**Probe scripts to add (Phase 1B)**:
- `probe_epoch_authority_v1.js` — 32-fixture byte-parity matrix + collision-detection assertion + fallback-detection assertion.

---

## 12. LONGITUDINAL INTEGRITY IMPROVEMENTS

Concrete improvements this phase enables (cumulative, with Phase numbers indicating when each lands):

1. **(1B) Detectable epoch collisions.** Today, two writers producing identical bytes silently drop one row. After 1B, `[EPOCH-ID-COLLISION-DETECTED]` fires the moment it happens. Surface visible in `nbaCacheDiagnostics`. **Result: silent integrity drift becomes loud.**
2. **(1B) Detectable fallback events.** Today, a missing `snapshotUpdatedAt` defaults to now() in #1/#2 and produces an effectively random epoch_id. After 1B, `[EPOCH-ID-FALLBACK-USED]` flags every such event. **Result: implicit temporal ownership becomes explicit.**
3. **(1C) Single authority surface.** Today: five derivation sites, four formulas. After 1C: one helper, four `kind` variants, one `sport` parameter. **Result: future NHL/NFL onboarding adds zero new epoch generators.**
4. **(1D) Deprecation closure.** Today: shim wrappers remain available. After 1D: every caller goes through the canonical helper. **Result: no fork point for future drift.**
5. **(1E) Dual-freeze richness loss eliminated.** This is the most consequential downstream improvement. Today, when NBA snapshot freeze + workstation freeze both fire for the same prediction, INSERT OR IGNORE silently drops the contextually-rich row in favor of the bare row. **The right architectural fix is operator-gated — it requires choosing between: (a) single canonical NBA freeze writer; (b) PK upgrade to `(prediction_id, epoch_id, source)`; (c) merge into one writer that produces both bare + rich rows; (d) accept the loss and document it. This audit recommends (a) — single canonical NBA freeze writer — as the lowest-risk path, but defers the decision to operator.**
6. **(1F) JSONL ↔ SQLite reconciliation.** Today, the `mlbLiveStateHistory` JSONL files and `prediction_epochs` SQLite rows share epoch_id by coincidence-of-formula. After 1F, both go through the canonical helper, AND a reconciliation probe asserts that for every JSONL epoch_id, a matching SQLite epoch row exists (or vice versa, depending on which write is the canonical source-of-truth — TBD per operator).

**Improvements explicitly NOT in scope of Phase 1**:
- Cross-sport calibration corpus (depends on Phase Persistence-1C outcome wiring).
- ML/training pipeline cleanliness (depends on outcome_snapshots being populated).
- Retention/archive of frozen contextual states (Phase Persistence-1E).

---

## 13. WHAT THIS PHASE DOES NOT TOUCH

To preserve clarity about scope, the following are explicitly out-of-scope for Phase 1A:

- ❌ **No code patches.** Phase 1A is the audit deliverable + brain doc updates.
- ❌ **No new SQL schemas.** Schema additions (if any) belong in Phase 1B alongside the helper.
- ❌ **No freeze architecture redesign.** The five existing writers stay as they are.
- ❌ **No replay architecture redesign.** Replay path unchanged.
- ❌ **No grading architecture redesign.** Phase Persistence-1C remains the gate for outcome writers.
- ❌ **No dual-freeze richness fix.** That decision is operator-gated and lives in Phase Longitudinal-Integrity-2 territory.
- ❌ **No historical row rewrites.** All historical `prediction_epochs` and `frozen_contextual_states` rows persist under their original `epoch_id` bytes.

---

## 14. RECOMMENDED NEXT-SESSION SCOPE

**Phase Longitudinal-Integrity-1B — Canonical helper introduction** is the highest-leverage next move.

Operator decision required:

1. **Approve adding `derivePredictionEpochId(opts)` + `deriveCanonicalSlateDate(value)` to `backend/storage/intelligence.js`?** (Additive only — no existing code modified.)
2. **Approve adding `getEpochAuthorityDiagnostics()` / `resetEpochAuthorityDiagnostics()` + surfacing via `nbaCacheDiagnostics.epochAuthority`?** (Mirrors existing Phase E1 canonicalization-diagnostics pattern.)
3. **Approve probe `probe_epoch_authority_v1.js`** asserting byte-parity vs every existing `compute*EpochId` for a 32-fixture matrix?
4. **Approve `npm run epoch:status` script** showing prediction_epochs row counts by formula variant + collision-detector state?

If all four are approved, Phase 1B is one session, ~250 net-additive lines, zero deletions, fully revertable. Existing freeze writers are NOT modified in 1B.

**Phase 1C (migration) is deferred to a subsequent session** after 1B's byte-parity probe confirms zero drift for every observed input class. Phase 1E (dual-freeze richness fix) is intentionally a separate operator-gated decision — this audit recommends single-canonical-NBA-freeze-writer but does not implement it.

---

_Audit completed: 2026-05-14_
_Author: Claude (Cowork mode, opus-class audit, fed by direct source inspection of `freezePredictionEpoch.js`, `freezeMlbContextualEpoch.js`, `freezeMlbLiveStateEpoch.js`, `mlbLiveStateHistory.js`, `readFrozenEpoch.js`, `intelligenceSchema.js`, `nbaIsolatedRoutes.js`, `workstationRoutes.js`, plus live grep across the repo)_
_Sequenced under: ARCHITECTURE_LAWS.md Law 1 (one authority per subsystem), Law 4 (preserve replay/freeze/grading), Law 9 (observability is rate-limited and additive), Law 10 (phase-tag every additive change), Law 12 (memory docs are part of the patch), Law 16 (no silent fallbacks)_
_Stale-source rule applied: every formula extracted today from live source as of 2026-05-14_
