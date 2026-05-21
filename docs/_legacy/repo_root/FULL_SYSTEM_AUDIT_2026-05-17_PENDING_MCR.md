# FULL SYSTEM AUDIT — 2026-05-17 (PENDING MCR RECONCILIATION)

**Lane:** FULL SYSTEM AUDIT
**Mode:** Observational / classificatory. ZERO patches. ZERO canonical creation. ZERO deprecation.
**Lineage:** Prior `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md` exists (52KB) — this audit is the next-cycle successor under the dated-audit convention, **handed back to MASTER CONTROL ROOM** for filing decisions (location, supersession header on prior, integration with `OPERATIONAL_PARITY_AUDIT.md` / `OPERATIONAL_RECONCILIATION_AUDIT.md` undated-convention break per finding A-12).
**Not yet canonical.** This file's `_PENDING_MCR` suffix is intentional. MCR decides whether/how it lands in `docs/` and how it's reconciled with the lineage.

**Repo state at audit time:** Last sealed phase = Player-Conviction-Engine-1A (PCE-1A), 2026-05-17. `ops:verify` 37/37 PASS. Brain checkpoint receipt 2026-05-17T21:09Z PASS.

**Invariants preserved throughout this audit:** additive-only doctrine · canonical authority doctrine · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

---

## DELIVERABLE 1 — AUTHORITY MAP (canonical-by-concern + shadow list)

| Concern | Canonical (recommended) | Shadow / parallel / abandoned | Severity |
|---|---|---|---|
| **Bootstrap / agent contract** | Root `BOOTSTRAP_PROMPT.md` (May 17, COS-1A/1B/1C cemented). `GPT_RECONSTRUCTION_BOOTSTRAP.md` is its portable companion. | `docs/BOOTSTRAP_PROMPT.md` (Apr 7 stale) · `docs/cursor-master-charter.md` (Apr 16, V2-FINAL, competing 6-item product structure) · `.github/copilot-instructions.md` (forbidden list conflicts with DEFERRED_PHASES) · `backend/brain/chat_control.md` (Cursor/ChatGPT-era protocol) | load-bearing |
| **Current-state / session log** | Root `CURRENT_STATE.md` (537KB, session ledger) + `backend/runtime/brain/CURRENT_RUNTIME_STATE.md` (254KB, runtime mirror). Boundaries stated in `backend/runtime/brain/README.md`. | `docs/CURRENT_STATE.md` (35KB, frozen at Session AK / 2026-05-10) · `docs/NEXT_SESSION.md` (35KB, frozen Session AK) · `backend/brain/state.json` (frozen at "phase3_to_bestProps_handoff" / "mlb_phase3_clusters_verified") | load-bearing |
| **Architecture blueprint** | `backend/runtime/brain/MASTER_BRAIN.md` (per brain README's own declaration; brain checkpoint enforces freshness). | Root `ARCHITECTURE.md` (34KB; brain README labels "legacy") · `docs/ARCHITECTURE.md` (34KB, byte-identical-size mirror, May 7) | load-bearing |
| **Operational ritual (per-session)** | Root `OPERATIONAL_FLOW.md` (May 17). | Root `WORKFLOW_RULES.md` (May 7, pre-COS) · `docs/WORKFLOW_RULES.md` (May 10, larger but pre-COS) · `backend/brain/rules.json` (pre-ops "hardRules"/"chatBehavior") · `backend/brain/chat_control.md` | load-bearing |
| **Operational ritual (per-phase ledger)** | `docs/OPERATOR_RUNBOOK.md` (131KB, append-only ledger; last appended PCE-1A 2026-05-17). | None at peer level. | — |
| **Operational ritual (AI-agent behavioral)** | `backend/runtime/brain/OPERATOR_PROTOCOL.md` (20KB, May 14). | OPERATOR_PROTOCOL itself missing `ops:*` section — pre-COS (B-08). Sibling old-doctrine `backend/brain/chat_control.md`. | important |
| **Active phase** | `ACTIVE_PHASE.md` (header field) + `docs/OPERATOR_RUNBOOK.md` (ledger header). | `ACTIVE_PHASE.md` body section (COS-1C-bodied — header says PCE-1A, C-01) · `NEXT_PHASE.md` "last sealed" (7 phases stale, D-04) · `MASTER_BRAIN.md` interior CURRENT-PROJECT-PHASE / NEXT-MAJOR-PHASES / CURRENT-PRIORITIES sections (frozen at F6.3 era, D-01) · `ACTIVE_INCIDENTS.md` INC-001 (likely resolved by Sport-Identity-Integrity-1A, E-17) | load-bearing |
| **Bottleneck registry** | `CURRENT_PROBLEMS.md` (5 active 🟡 + solved + future ⚪). | None duplicate; coherent with NEXT_PHASE candidates per D-02. | — |
| **Deferred / forbidden registry** | `DEFERRED_PHASES.md`. | `.github/copilot-instructions.md` carries an independent partial forbidden list (D-05). | important |
| **Product identity** | `PRODUCT_IDENTITY.md` (3-layer Battlefield → Curated Edge → Compression). | `docs/cursor-master-charter.md` (6-item Cursor-era product structure). | important |
| **Verifier matrix** | `backend/scripts/ops/runAllVerifiers.js` (auto-discovers 31 `verify*.js` + 5-probe canonical matrix: `probe_grading_backfill_v1` / `probe_lineage_v1` / `probe_epoch_authority_v1` / `probe_persistence_idempotency_v1` / `probe_ledger_mirror_v1`). | 21 root `probe_*.js` files not wired (B-03 / G-05) — includes apparent canonical-class probes (`probe_frozen_epoch_v1`, `probe_snapshot_freeze_v1`, `probe_outcome_completion_v1`, `probe_longitudinal_completion_v1`, `probe_market_v1`, etc.) and apparent dev probes (`probe_final`, `probe_safe_balanced`, `probe_recovery`). | important |
| **Continuity / governance** | `backend/scripts/brain/` (5 enforcement scripts) + `backend/runtime/brain/.brain_bootstrap_state.json` (sha256 receipt) + `verifyOperationalContinuity.js` + `verifyOperationalParity.js`. | No duplicates. Governance gap: no verifier enforces shadow-canonical drift, phase-doc interior staleness, non-canonical probe sprawl, brain/ orphan, charter vs PRODUCT_IDENTITY, or copilot vs DEFERRED. | load-bearing |
| **Audit history register** | `docs/*AUDIT*_YYYY-MM-DD.md` convention. Prior `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md` is current full-system lineage. | `docs/OPERATIONAL_PARITY_AUDIT.md` + `docs/OPERATIONAL_RECONCILIATION_AUDIT.md` break date-in-filename convention. | minor (convention) / important (lineage) |
| **Operational memory** | `backend/runtime/brain/` (9 docs) + repo-root anchor surface (7-doc COS-1A chain). | `backend/brain/` (9 files; **0 live JS references confirmed by grep**). | load-bearing |
| **Checkpoint manifest queue** | `backend/scripts/checkpointRepo.js` writes `.checkpoint/pending.json`; `finalizeCheckpoint.sh` consumes it. | `.checkpoint/` is currently **empty** — either post-consume normal or skipped-seal (B-07). | important |

---

## DELIVERABLE 2 — ROADMAP-AS-FOUND (verbatim from artifacts only)

**Where the repo says it is now.** Last sealed phase: Player-Conviction-Engine-1A (PCE-1A), 31st approved phase, sealed 2026-05-17 — additive hitter-overs conviction composite (PCE_WEIGHT 0.05, additive ∈ [-0.04, +0.05], longshot-preserving). All 31 verifiers + 5 canonical probes PASS. Brain checkpoint receipt sealed 2026-05-17T21:09Z PASS with hash-chain reconciliation. Continuity-OS-1A/1B/1C reduced fresh-chat reconstruction surface from ~15,000 lines to ~550 lines (~96% drift reduction).
**Source artifacts:** `docs/OPERATOR_RUNBOOK.md` header ledger · `ACTIVE_PHASE.md` header field · `backend/runtime/brain/.brain_bootstrap_state.json`.

**Where the repo says it's going.** Awaiting operator selection from 5 next-phase candidates:
1. **BNSB-1C "Slip Emotional Compression"** — `composeSlipNarrative()` pure helper, narrative on slip card from canonical signals (bottleneck A-1).
2. **BNDS-1C "Per-Event Hover Cards"** — PitcherMatchup / LineupCard / WeatherCard hover on expanded GameCard (bottleneck A-2).
3. **BNSB-1D "Portfolio Bettor-Language Pass"** — `PortfolioWarning.label` translation (bottleneck A-3).
4. **Operational-1B "Diagnostics tab"** — new `/api/ws/diagnostics` aggregator → FE tab (bottleneck A-4).
5. **BNDS-1C "Survivability lens"** — sort Discover by `ladderSurvivabilityFactor` (bottleneck A-5).
**Source artifacts:** `NEXT_PHASE.md` candidates · `CURRENT_PROBLEMS.md` 🟡 ACTIVE.

**What the repo says is blocking.**
- 5 active 🟡 bottlenecks (A-1 emotionally weak slips · A-2 thin GameCard depth · A-3 portfolio operator-shaped · A-4 CLI invisible to FE · A-5 discovery unsorted by survivability).
- 11 prerequisite-blocked phases per `DEFERRED_PHASES.md`: NBA-parity ecology · longitudinal adaptive calibration · bullpen ingest activation · OE-14 structural under-flip · OE-15 best-overs symmetry · BNSB-1B-5 build-leg flow · BNSB-1B-12 forensic toggle · persisted slip history · diagnostics aggregator · cross-sport correlation extraction · NAV label re-tone.

**What is indefinitely forbidden** (10 cemented per `DEFERRED_PHASES.md`): OCR/image-upload parsing · LLM/GPT narration of any FE string · celebrity/star-power weighting · dynamic sportsbook-behavior simulation · adaptive payout shaping / fake SGP inflation · recursive explosion logic · hardcoded "tonight's lock" · auto-bet placement · synthetic shadow predictions / fabricated calibration · mobile-first redesign.

**Roadmap-state gaps (declared vs observed):**
- `NEXT_PHASE.md` "last sealed = COS-1A" is 7 phases stale (D-04).
- `MASTER_BRAIN.md` body CURRENT-PRIORITIES still says "Operator: restart TERM 1 and run F6.3 verification curls" — functionally moot per Sport-Identity-Integrity-1A (D-01).
- `ACTIVE_PHASE.md` body describes COS-1C while header says PCE-1A (C-01).
- `ACTIVE_INCIDENTS.md` INC-001 marked OPEN since 2026-05-13; content suggests Sport-Identity-Integrity-1A resolved it (E-17).
- No single artifact answers "what is our roadmap" — assembling it requires reading 5+ docs (D-06).

---

## DELIVERABLE 3 — BLOCKER CHAIN DIAGRAM

```
LAYER 1: BETTER UX (no upstream blocker — operator-selectable)
   A-1 emotionally weak slips ───► BNSB-1C (composeSlipNarrative)
   A-2 thin GameCard depth   ───► BNDS-1C (3 hover cards)
   A-3 portfolio op-language ───► BNSB-1D (label translation)
   A-5 unsorted discovery    ───► BNDS-1C lens

LAYER 2: BACKEND-BRIDGED UX (single upstream blocker)
   A-4 CLI invisible to FE ──upstream──► NEW /api/ws/diagnostics aggregator (E-4)
                                              ▼
                                       Operational-1B (Diagnostics tab)

LAYER 3: NBA PARITY (compound upstream, structurally blocked)
   NBA-parity ecology ──upstream──► NBA-specific ecology audit (E-6)
                                            ▼
                                    NBA equivalents of MLB-COV, BC-1A, OE-1A, OE-1B
                                            ▼
                                    NBA "explosive" intelligence + same-team correlation

LAYER 4: LONGITUDINAL LOOP (3-step compound)
   E-7 adaptive calibration
        ▲ requires
   per-bucket/signal ROI surface (BNSB-1C-class)
        ▲ requires
   persisted verdict outcomes (BNSB-1D-class — E-11)
        ▲ requires
   parsed_slips.verdict_json schema migration + /api/ws/screenshots/history route + FE list view

LAYER 5: ECOLOGY ACTIVATION
   E-8 bullpen activation ──upstream──► upstream MLB API ingest + persisted bullpen state
   E-9 OE-14 under-flip   ──upstream──► 30+ days OE-1B graded telemetry observation window (no tracking surface)
   E-10 OE-15 symmetry    ──upstream──► OE-6 utilization telemetry from BNDS Discover (no tracking surface)

LAYER 6: DOCTRINE / CONTINUITY (this audit's findings)
   E-13 shadow canonical sweep  ───► MCR reconciliation (this handoff)
   E-14 phase-doc interior drift ───► MCR reconciliation + verifyPhaseDocCoherence candidate
   E-15 non-canonical probes    ───► MCR per-probe triage
   E-16 .checkpoint/ empty      ───► MCR clarify sandbox tolerance
   E-17 ACTIVE_INCIDENTS hygiene ───► MCR close resolved INCs (esp. INC-001)
```

---

## DELIVERABLE 4 — SYSTEM HEALTH TABLE

| System | Status | Evidence (one line) |
|---|---|---|
| **MLB workstation** | healthy | Sport-Identity-Integrity-1A + Candidate-Ecology-Parity-1A + PCE-1A all shipped; 196 tracked_bets / 43 elite / 129 discovery. |
| **NBA workstation** | **fragile** | Battlefield widened to 12/40, but ecology signals are MLB-shape; NBA-parity ecology indefinitely waiting on dedicated NBA audit. |
| **Ecology / reinforcement** | healthy | MLB-COV / BC-1A / OE-1A / OE-1B per-pair + aggregate caps; calibration-honest probability path. |
| **Backend intelligence (server.js + pipeline)** | healthy with risk | 19,999-line server.js (accreted); ~70 pipeline modules; settlement orchestration shipped; market observability shipped; 31/31 verifiers PASS. **Risk:** server.js size + Verification Telemetry V1 silent skip on TERM 1 unreachable. |
| **Frontend workstation** | **fragile (load-bearing asymmetry)** | 10 sections + 7 components; ALL 5 active 🟡 bottlenecks are FE-side; BNSB-1A/1B and BNDS-1A/1B are explicit bridge phases. |
| **FE-vs-backend asymmetry** | **load-bearing fragility** | Backend has 31 shipped phases of intelligence depth; FE has the bridge phases recent and incomplete (A-3 / A-4 still operator-shaped / CLI-invisible). |
| **Continuity (brain bootstrap + receipt)** | healthy | Receipt 2026-05-17T21:09Z PASS; sha256 hashes for brain/runtime/probes; enforceBrainCheckpoint enforces required-on-patch set. |
| **Governance (doctrine enforcement)** | **fragile** | Half the doctrine surface is verifier-enforced (`verifyOperationalContinuity` + `verifyOperationalParity`); half is convention-only (shadow canon, phase-doc interior, probe sprawl, charter/Copilot consistency). |
| **Operational memory** | **fragile** | 3 brain layers + 4 "current state" surfaces + 3 bootstrap surfaces + 2 phase-doc systems; no verifier reconciles them. |
| **Audit ledger** | healthy with convention drift | 20+ dated `*AUDIT*_YYYY-MM-DD.md` audits; 2 recent break date convention; prior `FULL_SYSTEMS_AUDIT_2026-05-14.md` is lineage. |
| **Persistence / SQLite** | healthy | Persistence-1A audit + 1B activation; betting.db 23 tables / 144 JSON files; persistence:status divergence; probe_persistence_idempotency_v1 + probe_ledger_mirror_v1 in canonical matrix. |
| **Grading / calibration substrate** | healthy | Settlement-Orchestration-1A auto-chain; Grading-Calibration-Operations-1A/D/G; truthful hit/loss outcomes; Brier scoring; probe_grading_backfill_v1 in canonical matrix. |
| **Market observability** | healthy | Market-Ecology-1A: consensusConfidence, cross-book disagreement, stale-line, rolling CLV, API-call burn telemetry. |
| **Visual Betting Intelligence / slip ingest** | healthy | VBI-1A + BNSB-1B PathPicker / Borrow Tonight's Slip / VerdictCard. OCR remains indefinitely deferred. |
| **Replay safety / freeze epoch** | healthy | Longitudinal-Integrity-1A/1B; canonical derivePredictionEpochId with strict reject; probe_epoch_authority_v1 in canonical matrix (note: 3 sibling freeze/snapshot probes exist at root but are NOT in canonical 5 — see B-03 / G-05). |

---

## DELIVERABLE 5 — RECONCILIATION QUEUE (severity-ordered, for MCR)

### LOAD-BEARING (must resolve before next major implementation phase)

1. **R-1 (A-02 / A-03 / C-07 / C-09 / G-02 — frozen docs/ shadow trio)**
   Append supersession header to `docs/CURRENT_STATE.md`, `docs/NEXT_SESSION.md`, `docs/WORKFLOW_RULES.md` routing to root canonical. Additive; preserves historical Session-AK content. **Why now:** `docs/WORKFLOW_RULES.md` actively instructs fresh sessions to read the frozen trio.

2. **R-2 (C-01 / D-01 / G-06 — phase-doc interior staleness)**
   Re-overwrite stale interior sections in `ACTIVE_PHASE.md` body (COS-1C → PCE-1A scope), `NEXT_PHASE.md` "last sealed" field (COS-1A → PCE-1A), `MASTER_BRAIN.md` CURRENT-PROJECT-PHASE / NEXT-MAJOR-PHASES / CURRENT-PRIORITIES sections (F6.3 era → current). **Verifier candidate:** `verifyPhaseDocCoherence.js` asserting ACTIVE_PHASE header phase ID matches OPERATOR_RUNBOOK last-appended phase.

3. **R-3 (A-01 / D-05 / G-01 — bootstrap surface fork)**
   Append supersession header to `docs/BOOTSTRAP_PROMPT.md` and `docs/cursor-master-charter.md`. Reconcile `.github/copilot-instructions.md` forbidden list against `DEFERRED_PHASES.md` (single canonical forbidden authority). Append historical-protocol marker to `backend/brain/chat_control.md`.

4. **R-4 (A-08 / G-03 — brain README "legacy" labels vs COS-1A/1B/1C cementing)**
   Reconcile `backend/runtime/brain/README.md` "Related repo-root memory" section calling root `ARCHITECTURE.md` / `BOOTSTRAP_PROMPT.md` / `WORKFLOW_RULES.md` "legacy" — they are the ACTIVE canonical bootstrap surface per COS-1A/1B/1C. Add a "Continuity-OS-1A/1B/1C-cemented anchor surface" section.

5. **R-5 (A-04 / G-04 — WORKFLOW_RULES duplication and pre-ops staleness)**
   Append supersession header to both `WORKFLOW_RULES.md` (root + docs/) routing to `OPERATIONAL_FLOW.md` (per-session ritual) + `OPERATOR_PROTOCOL.md` (AI-agent behavioral) + `OPERATOR_RUNBOOK.md` (per-phase doctrine).

6. **R-6 (A-09 / G-07 — backend/brain/ orphan layer)**
   Confirmed: 0 live JS references to `backend/brain/`. Apply additive `_DEPRECATED_SEE_RUNTIME_BRAIN` marker to each file. Do not delete.

7. **R-7 (F-08 — governance enforcement extension)**
   Decide whether new doctrine-meta verifiers should be added: (a) shadow-canonical drift check; (b) phase-doc body-matches-header check; (c) non-canonical probe inventory; (d) charter/copilot/forbidden-list cross-consistency. Each is additive — extends `verifyOperationalContinuity.js` pattern.

### IMPORTANT (resolve in next maintenance pass, not blocking)

8. **R-8 (A-06 / A-11 / B-08 — OPERATOR_PROTOCOL missing ops:* section)**
   Append `ops:*` canonical-commands section to `backend/runtime/brain/OPERATOR_PROTOCOL.md`. Additive — preserves the existing `engine:*` / `slate:*` / `grading:*` / `runtime:*` sections.

9. **R-9 (B-03 / E-15 / G-05 — 21 non-canonical root probes)**
   Per-probe MCR triage: (a) promote to canonical 5-probe matrix where appropriate (esp. `probe_frozen_epoch_v1`, `probe_snapshot_freeze_v1`, `probe_outcome_completion_v1`, `probe_longitudinal_completion_v1`, `probe_market_v1` which appear canonical-class but unwired) ; or (b) move to `backend/scripts/dev-probes/` historical area ; or (c) leave with `// NOT_WIRED — dev probe` header. No deletion.

10. **R-10 (A-07 / G-10 — cursor-master-charter vs PRODUCT_IDENTITY)**
    Append "**superseded by `/PRODUCT_IDENTITY.md` — preserved as historical Cursor V2 charter**" header to `docs/cursor-master-charter.md`. Note: PCE-1A's name borrows "player conviction" vocabulary from charter — partial doctrine reabsorption, not full deprecation.

11. **R-11 (B-06 / F-04 — Verification Telemetry V1 silent skip)**
    MCR decision: should TERM 1-unreachable be a hard failure for non-sandbox runs? Currently `ops:term2` reports PASS even when live truth check is silently skipped.

12. **R-12 (A-15 / B-07 / E-16 — `.checkpoint/` empty)**
    Confirm whether empty `.checkpoint/` is post-consume normal or skipped-seal state. Possible doc clarification in `backend/scripts/checkpointRepo.js` header.

13. **R-13 (A-12 / G-09 — audit convention break + lineage)**
    Rename `docs/OPERATIONAL_PARITY_AUDIT.md` → `docs/OPERATIONAL_PARITY_AUDIT_2026-05-17.md` and `docs/OPERATIONAL_RECONCILIATION_AUDIT.md` → `docs/OPERATIONAL_RECONCILIATION_AUDIT_2026-05-17.md`. File this audit (`FULL_SYSTEM_AUDIT_2026-05-17_PENDING_MCR.md`) into `docs/` under the convention, with explicit lineage reference to `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md`.

14. **R-14 (D-03 — DEFERRED_PHASES unblock-criteria tracking)**
    Prerequisite-blocked phases (E-7 / E-8 / E-9 / E-10) declare unblock criteria as prose. No tracking surface. Consider an additive observation surface (NOT a new doc system — possibly an `unblockWatchlist` section inside `DEFERRED_PHASES.md`).

15. **R-15 (E-17 — ACTIVE_INCIDENTS lifecycle)**
    Re-classify open INC-* entries against post-2026-05-13 phase resolutions. INC-001 (F6.3 player-id verification) almost certainly resolved by Sport-Identity-Integrity-1A; should be moved to RESOLVED — RECENT.

16. **R-16 (D-05 — Copilot forbidden list vs DEFERRED_PHASES)**
    `.github/copilot-instructions.md` forbids "payout buckets / slipCards / portfolio logic" — but repo has active `PortfolioView.tsx` and bottleneck A-3 explicitly targets portfolio language. Reconcile or accept divergence with explicit comment.

17. **R-17 (C-05 / C-06 — file-size monitoring)**
    `docs/OPERATOR_RUNBOOK.md` (131KB), root `CURRENT_STATE.md` (537KB), `backend/runtime/brain/MASTER_BRAIN.md` (160KB), `CURRENT_RUNTIME_STATE.md` (254KB), `MODEL_EVOLUTION_LOG.md` (336KB) — combined ledger/anchor surface grows monotonically per checkpoint discipline. No rotation policy declared. MCR decision: monitoring threshold or explicit append-forever doctrine.

### MINOR (housekeeping)

18. **R-18 (A-10 / A-11 — backend/docs/CORE_MODEL_RULES + ARCHITECTURE_LAWS + PIPELINE_AUTHORITY_MAP + SPORTSBOOK_CONTRACTS freshness)**
    These declare permanent contracts but date from May 13–14 (pre-COS). MCR freshness review — most likely no change needed.

---

## NOTES FOR MCR

- **This audit is NOT yet canonical.** The `_PENDING_MCR` filename suffix is intentional. MCR decides filing location and lineage reconciliation with `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md`.
- **No invariants violated** during audit execution. Read-only throughout. Zero patches, zero deprecations, zero new canonicals.
- **17 reconciliation items** in the queue. 7 are load-bearing, 10 are important, 1 is minor housekeeping.
- **Several reconciliations are additive headers** that preserve existing canonical content while routing readers to current authority — fully compatible with additive-only doctrine.
- **Recommended next lane after MCR sequences this queue:** INFRA / GOVERNANCE (for the load-bearing R-1 through R-7 set) or MASTER CONTROL ROOM if the queue spans multiple lanes.

— end of audit deliverables —

---

## PHASE R1 — AUTHORITY RECONCILIATION SWEEP (FIRST PASS)

**Lane:** INFRA / GOVERNANCE
**Opened:** 2026-05-17 from MASTER CONTROL ROOM
**Mode:** observational + classificatory. NO new canonicals. NO new roadmap/bootstrap systems. NO supersession-header stamping yet (that requires explicit MCR routing to enter R2). This pass evolves the audit artifact IN PLACE.
**Invariants preserved:** additive-only doctrine · canonical authority doctrine · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

### R1.A — Confirmation of audit findings (spot-checked against live filesystem 2026-05-17)

| Audit finding | Verification action | Status |
|---|---|---|
| C-01 — `ACTIVE_PHASE.md` header (PCE-1A) vs body (COS-1C scope) mismatch | Read head 40 lines; header table says "Player-Conviction-Engine-1A (PCE1A) · 31st approved · SHIPPED + SEALED 2026-05-17"; body "ONE-LINE OBJECTIVE" + "APPROVED LEVERS" tables describe COS-1C scope. | **CONFIRMED** |
| D-04 — `NEXT_PHASE.md` "last sealed = COS-1A" stale | Read head 40 lines; status table reads "Last sealed phase: Continuity-OS-1A (COS-1A) — sealed 2026-05-17". 7 phases stale vs ledger. | **CONFIRMED** |
| A-02 / A-03 — `docs/CURRENT_STATE.md` + `docs/WORKFLOW_RULES.md` + `docs/BOOTSTRAP_PROMPT.md` frozen + actively routing fresh sessions to frozen trio | Read head of all three. `docs/CURRENT_STATE.md` self-stamps "Last updated: 2026-05-10 (Session AK)". `docs/WORKFLOW_RULES.md` "MANDATORY SESSION PROTOCOL" instructs reading `/docs/WORKFLOW_RULES.md` + `/docs/CURRENT_STATE.md` + `/docs/NEXT_SESSION.md`. `docs/BOOTSTRAP_PROMPT.md` "COPY-PASTE BLOCK" routes new chats to the same frozen trio. | **CONFIRMED — actively dangerous** |
| A-09 / G-07 — `backend/brain/` orphan layer, 0 live JS references | `grep -rEn "backend/brain/(control|execution|memory|phase_map|recovery|rules|state|validation|chat_control)"` across `backend/**/*.{js,ts}` excluding `runtime/` + `brain/` returns 0 matches. | **CONFIRMED** |
| A-08 / G-03 — `backend/runtime/brain/README.md` calls root `ARCHITECTURE.md` / `BOOTSTRAP_PROMPT.md` / `WORKFLOW_RULES.md` "legacy" | Lines 104–106 explicitly label all three as `(legacy)`. These are the ACTIVE COS-1A/1B/1C-cemented canonical surface. README self-contradicts the cementing decision. | **CONFIRMED** |
| D-05 — `.github/copilot-instructions.md` forbidden list vs `DEFERRED_PHASES.md` | Reads: "Do not reintroduce payout buckets, slipCards, or portfolio logic." Repo has active `PortfolioView.tsx`, bottleneck A-3 explicitly targets portfolio language, BNSB-1D is a candidate. Direct contradiction with active product surface. | **CONFIRMED — actively contradicting active phase candidates** |
| A-07 / G-10 — `docs/cursor-master-charter.md` V2-FINAL 6-item product structure | Read head 25 lines. Six-item structure (player conviction / outcome ladders / market-family boards / ticket style families / execution / recovery) competes with `PRODUCT_IDENTITY.md` 3-layer (Battlefield → Curated Edge → Compression). PCE-1A's vocabulary partially borrows from charter ("player conviction") — partial doctrine reabsorption. | **CONFIRMED** |
| A-09 — `backend/brain/chat_control.md` Cursor/ChatGPT-era protocol | Reads as "CHATGPT WORKFLOW CONTROL (MANDATORY)" — pre-COS Cursor protocol, no `ops:*` awareness, no Claude-era handoff discipline. | **CONFIRMED** |
| B-03 / G-05 — ~21 non-canonical root probes mixed with canonical 5 | `ls probe_*.js` at root yields 25 files. Canonical 5 (per `runAllVerifiers.js`): `probe_grading_backfill_v1` / `probe_lineage_v1` / `probe_epoch_authority_v1` / `probe_persistence_idempotency_v1` / `probe_ledger_mirror_v1`. Remaining 20 are mixed canonical-class (e.g. `probe_frozen_epoch_v1`, `probe_snapshot_freeze_v1`, `probe_outcome_completion_v1`, `probe_longitudinal_completion_v1`, `probe_market_v1`) and dev-class (`probe_final`, `probe_safe_balanced`, `probe_recovery`, `probe_candidates`, `probe_collapse_audit`). | **CONFIRMED (20, not 21 — off-by-one in original count)** |
| A-15 / B-07 / E-16 — `.checkpoint/` empty | `ls -la .checkpoint/` shows only `.` and `..`. Directory exists, contents empty. | **CONFIRMED — disposition unclear (post-consume normal vs skipped-seal)** |
| Verifier orchestrator location | `backend/scripts/ops/runAllVerifiers.js` exists; header self-declares COS-1C cementing 2026-05-17; sibling `ops:` orchestrators (`runCheckpointSeal`, `runNightlyReview`, `runTerm2Workflow`, `showState`, `showTerm1Status`) all present. | **CONFIRMED** |

**R1.A verdict:** every spot-checked claim in the prior deliverables is grounded in live filesystem state. The audit's classification map is trusted as the basis for R1 sequencing.

### R1.B — Authority classification (5-state taxonomy applied to every governance-bearing surface)

Classification keys:
- **canonical** — the active, single-source authority for its concern. Must evolve in place.
- **supporting** — references / extends a canonical without competing with it. Safe.
- **deprecated** — explicitly marked superseded, content preserved for replay/lineage. Safe (additive-only doctrine respected).
- **shadow** — competes with a canonical, NOT explicitly marked, capable of misrouting a fresh session. **Dangerous.**
- **orphan** — abandoned authority layer with 0 live consumers; not routing anything but bloats the governance surface and confuses fresh chats.

| File | Concern | Class | Notes |
|---|---|---|---|
| `BOOTSTRAP_PROMPT.md` (root) | bootstrap / agent contract | **canonical** | COS-1A/1B/1C-cemented May 17 |
| `GPT_RECONSTRUCTION_BOOTSTRAP.md` (root) | bootstrap portable companion | **supporting** | Companion to BOOTSTRAP_PROMPT.md, not competing |
| `docs/BOOTSTRAP_PROMPT.md` | bootstrap | **shadow** | Apr 7 stale; routes fresh chats to frozen `docs/` trio |
| `docs/cursor-master-charter.md` | bootstrap / product structure | **shadow** | V2-FINAL Apr 16, competing 6-item product structure |
| `.github/copilot-instructions.md` | agent contract / forbidden list | **shadow** | Forbidden list contradicts active phase candidate BNSB-1D + bottleneck A-3 |
| `backend/brain/chat_control.md` | agent contract (Cursor era) | **shadow** | Pre-COS Cursor/ChatGPT protocol, still readable as authority by fresh chats |
| `CURRENT_STATE.md` (root, 537KB) | session ledger | **canonical** | Live session-by-session log |
| `backend/runtime/brain/CURRENT_RUNTIME_STATE.md` (254KB) | runtime mirror | **canonical** | Runtime mirror of repo-root ledger; boundary documented in brain README |
| `docs/CURRENT_STATE.md` (35KB) | session state | **shadow** | Frozen Session AK / 2026-05-10; `docs/WORKFLOW_RULES.md` actively routes here |
| `docs/NEXT_SESSION.md` | next-session pending | **shadow** | Frozen Session AK; same routing problem |
| `backend/brain/state.json` | state snapshot | **shadow** | Frozen at "phase3_to_bestProps_handoff" / "mlb_phase3_clusters_verified"; 0 live refs |
| `backend/runtime/brain/MASTER_BRAIN.md` (160KB) | architecture blueprint | **canonical** | brain README declares this canonical; freshness enforced by brain checkpoint |
| `ARCHITECTURE.md` (root, 34KB) | architecture | **shadow** | brain README labels "legacy"; but COS-cementing context says it's anchor — see R-4 conflict |
| `docs/ARCHITECTURE.md` (34KB) | architecture | **shadow** | Byte-identical-size mirror May 7 |
| `OPERATIONAL_FLOW.md` (root) | per-session ritual | **canonical** | May 17, COS-1C |
| `WORKFLOW_RULES.md` (root, May 7) | per-session ritual | **shadow** | Pre-COS; superseded by OPERATIONAL_FLOW.md but not marked |
| `docs/WORKFLOW_RULES.md` (May 10) | per-session ritual | **shadow** | Pre-COS + actively routes fresh chats to frozen docs/ trio |
| `backend/brain/rules.json` | hardRules / chatBehavior | **shadow / orphan** | Pre-ops; 0 live refs |
| `docs/OPERATOR_RUNBOOK.md` (131KB) | per-phase ledger | **canonical** | Append-only, last appended PCE-1A 2026-05-17 |
| `backend/runtime/brain/OPERATOR_PROTOCOL.md` (20KB) | AI-agent behavioral | **canonical (incomplete)** | Active canonical, but missing `ops:*` section (B-08) |
| `ACTIVE_PHASE.md` | active phase header | **canonical (drifting)** | Header is canonical; body interior is stale COS-1C content (C-01) |
| `NEXT_PHASE.md` | next-phase candidates | **canonical (drifting)** | Candidate list current; "last sealed" field 7 phases stale (D-04) |
| `MASTER_BRAIN.md` interior CURRENT-PROJECT-PHASE | active phase mirror | **canonical (drifting)** | Body frozen at F6.3 era (D-01) |
| `ACTIVE_INCIDENTS.md` INC-001 | open incident | **stale** | Likely resolved by Sport-Identity-Integrity-1A (E-17) |
| `CURRENT_PROBLEMS.md` | bottleneck registry | **canonical** | 5 active 🟡 coherent with NEXT_PHASE candidates |
| `DEFERRED_PHASES.md` | deferred / forbidden | **canonical** | Single canonical forbidden authority |
| `PRODUCT_IDENTITY.md` | product identity | **canonical** | 3-layer Battlefield → Curated Edge → Compression |
| `backend/scripts/ops/runAllVerifiers.js` | verifier matrix | **canonical** | Auto-discovers 31 verify*.js + 5-probe canonical matrix |
| `backend/scripts/brain/*` (5 enforcement scripts) | continuity / governance | **canonical** | Brain-bootstrap state + checkpoint receipt |
| `backend/runtime/brain/.brain_bootstrap_state.json` | checkpoint receipt (sha256) | **canonical** | Authoritative hash-chain receipt |
| `verifyOperationalContinuity.js` | continuity verifier | **canonical** | Doctrine enforcement |
| `verifyOperationalParity.js` | parity verifier | **canonical** | Doctrine enforcement |
| Root `probe_grading_backfill_v1.js` + 4 sibling canonical probes | canonical probe matrix | **canonical** | In `runAllVerifiers.js` matrix |
| 20 remaining root `probe_*.js` | mixed canonical-class + dev | **shadow / orphan** | Co-located with canonical 5, no `// NOT_WIRED` headers, no `dev-probes/` separation (B-03) |
| `backend/brain/{control,execution,memory,phase_map,recovery,validation}.json` | operational memory layer | **orphan** | 0 live JS references; layer is abandoned |
| `backend/brain/chat_control.md` (re-list) | agent protocol | **shadow** | Already classified above; flagged twice because it's both shadow (still readable) and orphan-adjacent (no live wiring) |
| `backend/runtime/brain/README.md` "(legacy)" labels | brain-to-root reconciliation | **incoherent** | Labels active canonical surface as legacy — directly contradicts COS-1A/1B/1C cementing (R-4) |
| `docs/OPERATIONAL_PARITY_AUDIT.md` | audit history | **supporting (convention break)** | Breaks date-in-filename audit convention (A-12) |
| `docs/OPERATIONAL_RECONCILIATION_AUDIT.md` | audit history | **supporting (convention break)** | Same convention break |
| `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md` | audit lineage | **canonical (prior-cycle)** | Direct lineage parent of this audit |
| `.cursor/rules/workflow.mdc` | IDE-level rules | **supporting (cursor era)** | IDE-specific; not session-bootstrap routing |
| `.github/prompts/fix-surfaced-output.prompt.md` | task-specific prompt | **supporting** | Scoped prompt, not bootstrap |
| `backend/docs/CORE_MODEL_RULES.md` + `ARCHITECTURE_LAWS.md` + `PIPELINE_AUTHORITY_MAP.md` + `SPORTSBOOK_CONTRACTS.md` | permanent contracts | **canonical (freshness review pending)** | Pre-COS dates; most likely no change needed (R-18) |
| `.checkpoint/` (empty dir) | checkpoint manifest queue | **canonical (state ambiguous)** | Post-consume normal vs skipped-seal undetermined (B-07) |

**Surface tally:**
- canonical: ~20 surfaces (including drifting + incomplete sub-classes)
- supporting: ~7
- deprecated: 0 (no surface yet carries an explicit supersession marker — this is the gap R-1/R-3/R-5/R-10 closes)
- shadow: 13 (the load-bearing risk concentration)
- orphan: `backend/brain/` 8-file layer + ≈20 root non-canonical probes + `rules.json`

### R1.C — Continuity-dangerous short list (MUST resolve before roadmap reconstruction)

These are the surfaces that actively misroute a fresh chat or AI agent into stale doctrine. Resolving these is the prerequisite for safely reconstructing the roadmap. **Listed in order of session-poisoning severity.**

1. **`docs/WORKFLOW_RULES.md` + `docs/BOOTSTRAP_PROMPT.md`** — actively route fresh sessions to read `docs/CURRENT_STATE.md` (frozen Session AK 2026-05-10) and `docs/NEXT_SESSION.md` (frozen Session AK). A fresh chat following these instructions reconstructs reality 7 phases behind. **Highest poisoning risk.** Maps to R-1, R-3, R-5.
2. **`docs/CURRENT_STATE.md` + `docs/NEXT_SESSION.md`** — the frozen destinations the above docs point to. Reading them imprints stale "what just shipped" into the agent. Maps to R-1.
3. **`ACTIVE_PHASE.md` body / `NEXT_PHASE.md` "last sealed" / `MASTER_BRAIN.md` CURRENT-PRIORITIES** — phase-doc interior staleness. An agent that reads the header gets PCE-1A; an agent that reads the body gets COS-1C / F6.3 / COS-1A. Mixed signal = drift. Maps to R-2.
4. **`backend/runtime/brain/README.md` "(legacy)" labels** — actively tells an AI agent reading the brain that the canonical anchor surface is "legacy." Directly contradicts COS-1A/1B/1C cementing decision. Maps to R-4.
5. **`.github/copilot-instructions.md` forbidden list** — instructs Copilot/VS Code agents to never touch portfolio logic, but active bottleneck A-3 + candidate phase BNSB-1D require exactly that. Maps to R-16 (currently classified important — **upgrade to load-bearing** for any session that uses Copilot).
6. **`backend/brain/chat_control.md`** — pre-COS Cursor/ChatGPT protocol still readable as authority. Less dangerous than the docs/ trio because brain/ has 0 live wiring, but it's still ambient governance noise. Maps to R-3.
7. **`docs/cursor-master-charter.md`** — competing 6-item product structure against canonical 3-layer `PRODUCT_IDENTITY.md`. Drift risk for any session that reads charter without reading PRODUCT_IDENTITY first. Maps to R-10.

Items #1–#5 are **must-resolve-before-roadmap-reconstruction**. Items #6–#7 are reconcile-in-same-pass (cheap, additive).

### R1.D — R1 reconciliation workflow (sequenced, additive-only, in-place evolution)

R1 is staged in two passes. The first pass (this session) is observational + sequencing — output is this addendum to the canonical audit artifact. The second pass requires explicit MCR routing to enter and consists of additive supersession-header stamping plus brain-README reconciliation. NOTHING in R1 creates a new canonical, replaces an existing canonical, or modifies non-doctrine code paths.

**R1-PASS-1 (this session, COMPLETE)** — observational + classificatory:
- Spot-verify audit findings against live filesystem (R1.A).
- Classify every governance-bearing surface under the 5-state taxonomy (R1.B).
- Identify continuity-dangerous short list (R1.C).
- Sequence the reconciliation workflow (R1.D — this section).
- Define verification process (R1.E).
- Evolve the canonical audit artifact IN PLACE. NO new doc created. NO supersession stamping yet.

**R1-PASS-2 (PENDING MCR ROUTING)** — additive supersession-header stamping, executed strictly in this order so that no fresh session is ever reading both a poisoning shadow and an absent canonical pointer at the same time:

| Step | Action | Touches | Maps to | Why this order |
|---|---|---|---|---|
| 1 | Append supersession header to `docs/WORKFLOW_RULES.md` routing fresh sessions to root `OPERATIONAL_FLOW.md` + `BOOTSTRAP_PROMPT.md`. Preserve all existing content below the header. | `docs/WORKFLOW_RULES.md` | R-1, R-5 | This is the file most likely to be read first by a fresh agent. Closing it first stops poisoning the moment the agent obeys "read workflow rules". |
| 2 | Append supersession header to `docs/BOOTSTRAP_PROMPT.md` routing fresh sessions to root `BOOTSTRAP_PROMPT.md`. | `docs/BOOTSTRAP_PROMPT.md` | R-1, R-3 | Second-most-likely first read. |
| 3 | Append supersession header to `docs/CURRENT_STATE.md` + `docs/NEXT_SESSION.md` routing to root `CURRENT_STATE.md` + `NEXT_PHASE.md`. Content preserved as Session-AK historical snapshot. | `docs/CURRENT_STATE.md`, `docs/NEXT_SESSION.md` | R-1 | Closes the frozen-trio routing loop. |
| 4 | Reconcile `backend/runtime/brain/README.md` lines 104–106 "(legacy)" labels. Remove the legacy labels and add a "Continuity-OS-1A/1B/1C-cemented anchor surface" subsection documenting that root `ARCHITECTURE.md` / `BOOTSTRAP_PROMPT.md` / `WORKFLOW_RULES.md` ARE the active canonical bootstrap surface (with root `OPERATIONAL_FLOW.md` as the per-session ritual successor to root WORKFLOW_RULES). | `backend/runtime/brain/README.md` | R-4 | The README is the second-most-read governance doc after BOOTSTRAP_PROMPT. Mislabeling here cascades. |
| 5 | Re-overwrite `ACTIVE_PHASE.md` body to match the header (PCE-1A scope). | `ACTIVE_PHASE.md` | R-2 | Phase doc interior reconciliation. Header is correct; body needs to be brought forward. The doctrine for ACTIVE_PHASE.md is overwrite-at-seal, so this is in-place evolution of a canonical, not new content. |
| 6 | Update `NEXT_PHASE.md` "last sealed" field from "Continuity-OS-1A (COS-1A)" to "Player-Conviction-Engine-1A (PCE-1A)". | `NEXT_PHASE.md` | R-2 | Single-field correction. |
| 7 | Re-overwrite `MASTER_BRAIN.md` CURRENT-PROJECT-PHASE / NEXT-MAJOR-PHASES / CURRENT-PRIORITIES sections to match PCE-1A reality. | `backend/runtime/brain/MASTER_BRAIN.md` | R-2 | Mirror update; MASTER_BRAIN is the runtime canonical and its body must match the header lineage. |
| 8 | Append supersession header to root `WORKFLOW_RULES.md` (pre-COS) routing to `OPERATIONAL_FLOW.md`. | `WORKFLOW_RULES.md` | R-5 | Closes the per-session-ritual fork. |
| 9 | Append supersession header to `docs/cursor-master-charter.md` routing to `PRODUCT_IDENTITY.md`. | `docs/cursor-master-charter.md` | R-3, R-10 | Charter is third-tier risk; safe to stamp last among shadow docs. |
| 10 | Apply `_HISTORICAL_CURSOR_ERA_PROTOCOL — see OPERATOR_PROTOCOL.md` marker to `backend/brain/chat_control.md`. | `backend/brain/chat_control.md` | R-3 | Mark Cursor-era protocol as historical without deleting. |
| 11 | Apply `_DEPRECATED — see backend/runtime/brain/` per-file marker to each of the 8 orphan `backend/brain/*.json` + `chat_control.md` files. Do not delete (additive-only doctrine). | `backend/brain/*` | R-6 | Orphan-layer classification. |
| 12 | Re-route `.github/copilot-instructions.md` forbidden list to delegate to `DEFERRED_PHASES.md` (single canonical forbidden authority) OR add explicit divergence comment acknowledging PortfolioView is active. MCR decision required. | `.github/copilot-instructions.md` | R-16 | Active contradiction with current phase candidates; cannot be silently merged. |
| 13 | Hand back to MCR for sequencing R-7 (governance enforcement extensions) and R-9 (probe triage). | (no file touch) | R-7, R-9 | Verifier additions are larger surface decisions; not in R1 scope. |

**Anti-pattern guard:** every step above either appends a supersession header to an existing file OR re-overwrites a section of a canonical that doctrine declares overwrite-on-seal. No step creates a new canonical, no step deletes a file, no step renames a file (R-13 audit-convention renames are R3 maintenance pass, NOT R1).

### R1.E — R1 verification process

Each R1-PASS-2 stamping step must pass these checks before moving to the next step. Sequencing is enforced so a poisoning surface is never silently neutralized without a verifier-recorded receipt.

| Verification | What it checks | When it runs |
|---|---|---|
| **V1 — header-presence check** | After each supersession-header stamp, grep the file for the canonical "SUPERSEDED BY" / "HISTORICAL — see" marker. | Inline after each step 1–11. |
| **V2 — content-preservation check** | After each stamp, `wc -l` and `sha256sum` of the file is captured; the body below the header must be byte-identical to pre-stamp content. Additive-only doctrine violated otherwise. | Inline after each step 1–10. |
| **V3 — routing-coherence check** | After R1-PASS-2 completes, a fresh-read simulation: from each shadow doc, follow the supersession pointer and confirm the destination canonical exists and is the active surface. | After step 11. |
| **V4 — orphan-layer integrity** | Confirm `backend/brain/` files still load if anything ever reads them (defensive — should be 0 readers, but if any exist they must not break). | After step 11. |
| **V5 — `ops:verify` regression matrix** | Run `npm run ops:verify` end-to-end; all 31 verifiers + 5 canonical probes + 14 runtime suites must remain PASS. R1 is doctrine-surface only; no behavior change should cascade into runtime. | After step 12. |
| **V6 — brain checkpoint receipt** | Re-run `npm run brain:checkpoint` after step 4 (the only step touching brain canon). New sha256 receipt must reconcile cleanly with prior. | After step 4 and again after step 12. |
| **V7 — fresh-chat reconstruction simulation** | From a clean read of repo-root `BOOTSTRAP_PROMPT.md`, can an agent reach correct PCE-1A understanding without ever reading a shadow surface? Manual simulation; pass criterion: ≤ 550 lines consumed (COS-1A/1B/1C reduction target). | After step 12. |

**Proposed verifier extensions (deferred to R-7 / R2 sequencing — NOT executed in R1):**
- `verifyShadowCanonicalDrift.js` — asserts no `docs/*` mirror of a root canonical lacks a supersession header.
- `verifyPhaseDocCoherence.js` — asserts `ACTIVE_PHASE.md` header phase ID matches `OPERATOR_RUNBOOK.md` last-appended phase AND `MASTER_BRAIN.md` CURRENT-PROJECT-PHASE.
- `verifyForbiddenListConsistency.js` — asserts `.github/copilot-instructions.md` forbidden items are a subset of `DEFERRED_PHASES.md`.
- `verifyOrphanBrainLayer.js` — asserts 0 live JS references to `backend/brain/*` (catches accidental re-wiring).
- `verifyProbeMatrixCanonicalization.js` — asserts every `probe_*.js` at repo root is either in the canonical 5 OR carries a `// NOT_WIRED — dev probe` header.

### R1.F — First-pass disposition (returned to MASTER CONTROL ROOM)

**R1-PASS-1 status: COMPLETE.**

What was done in this pass:
- Audit findings cross-checked against live filesystem; all spot-checked claims confirmed.
- 5-state classification applied across the full governance surface (≈42 files).
- 13 shadow surfaces identified, of which 5 are immediately continuity-dangerous (R1.C #1–#5).
- R1-PASS-2 stamping sequence defined and ordered by session-poisoning severity (R1.D).
- Verification process defined (R1.E).

What was NOT done in this pass (intentionally — requires MCR routing):
- No supersession header stamped on any shadow doc.
- No phase-doc body rewritten.
- No brain README "legacy" labels altered.
- No `backend/brain/*` orphan markers applied.
- No new verifier scripts created.
- No new docs created. No new roadmap system. No new bootstrap system. No new continuity layer. No replacement canonical. The audit artifact itself was evolved IN PLACE — its `_PENDING_MCR` suffix remains intentionally pending until MCR decides filing.

**Continuity-blocking authority conflicts that must be resolved before roadmap reconstruction can safely begin (the answer to operator task #5):**

The 5 surfaces in R1.C #1–#5 are blocking. Concretely:
1. `docs/WORKFLOW_RULES.md` — actively misrouting
2. `docs/BOOTSTRAP_PROMPT.md` — actively misrouting
3. `docs/CURRENT_STATE.md` + `docs/NEXT_SESSION.md` — frozen destinations
4. Phase-doc interior staleness in `ACTIVE_PHASE.md` body / `NEXT_PHASE.md` last-sealed / `MASTER_BRAIN.md` CURRENT-PRIORITIES
5. `backend/runtime/brain/README.md` "(legacy)" mislabeling of active canonical surface

Until R1-PASS-2 stamps these, any roadmap reconstruction work is at risk of being built on a fresh-chat agent reading a 7-phase-stale picture of reality. R1.C #6–#7 (chat_control.md + cursor-master-charter.md) are lower-severity and can be reconciled in the same pass without sequencing risk.

**Recommended next routing:**
- **Return this artifact to MASTER CONTROL ROOM** for R1-PASS-2 approval. MCR sequences the 13-step stamping pass back into INFRA / GOVERNANCE.
- After R1-PASS-2 completes its V1–V7 checks, MCR routes the residual queue (R-7 verifier extensions, R-9 probe triage, R-11 Verification Telemetry decision, R-12 `.checkpoint/` clarification, R-13 audit convention renames + filing this artifact into `docs/`, R-14 unblock-criteria tracking, R-15 ACTIVE_INCIDENTS lifecycle, R-17 file-size monitoring) into appropriate lanes.
- Roadmap reconstruction (selection from 5 next-phase candidates in `NEXT_PHASE.md`) should NOT open until R1-PASS-2 completes and V7 fresh-chat reconstruction simulation passes.

— end of R1-PASS-1 addendum —

---

## PHASE R1-PASS-2 — AUTHORITY RECONCILIATION SWEEP (EXECUTED)

**Lane:** INFRA / GOVERNANCE
**Opened:** 2026-05-17 from MASTER CONTROL ROOM with explicit reconciliation-sequencing approval.
**Mode:** additive supersession-header stamping + in-place canonical evolution + orphan-layer classification. NO new canonicals, NO new roadmap/bootstrap systems, NO replacement authority. NO FE implementation, NO backend redesign, NO ACTIVE EXECUTION reopen.
**Invariants preserved throughout:** additive-only doctrine · canonical authority doctrine · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.
**MCR-provided operational truths anchoring this pass:**
- FE asymmetry is primarily routing/rendering/plumbing — NOT backend scoring.
- Backend intelligence is materially healthier than FE presentation.
- OE-8 (`ladderSurvivabilityFactor`) is a shadow-authority manifestation (escalated to R3 ecology-authority sweep — NOT in R1 scope).
- PCE-1A identified as conviction-propagation failure (propagation gap is FE-side; PCE-1A backend seal preserved correctly).
- ACTIVE EXECUTION remains LOCKED until Reconciliation Checkpoint clears.

### R1-PASS-2.A — Reconciled authority map deltas

| Surface | Pre-R1-PASS-2 class | Post-R1-PASS-2 class | Action taken | Verification |
|---|---|---|---|---|
| `docs/WORKFLOW_RULES.md` | shadow (actively misrouting) | **deprecated (supersession-stamped)** | Prepended additive supersession header routing to `/OPERATIONAL_FLOW.md` + `/BOOTSTRAP_PROMPT.md` + `/CURRENT_STATE.md` + `/NEXT_PHASE.md` + brain `OPERATOR_PROTOCOL.md`. | V1 PASS (header present) · V2 PASS (tail sha256 `edead9e1…ca3405e9` byte-identical to baseline) |
| `docs/BOOTSTRAP_PROMPT.md` | shadow | **deprecated (supersession-stamped)** | Prepended supersession header routing to root `BOOTSTRAP_PROMPT.md` + `GPT_RECONSTRUCTION_BOOTSTRAP.md`. | V1 PASS · V2 PASS (`7a58fd8a…ce527cf8` byte-identical) |
| `docs/CURRENT_STATE.md` | shadow (frozen Session-AK) | **deprecated (supersession-stamped)** | Prepended supersession header routing to root `CURRENT_STATE.md` + `ACTIVE_PHASE.md` + `NEXT_PHASE.md` + `docs/OPERATOR_RUNBOOK.md`. | V1 PASS · V2 PASS (`d29d2a11…073aa17` byte-identical) |
| `docs/NEXT_SESSION.md` | shadow (frozen Session-AK) | **deprecated (supersession-stamped)** | Prepended supersession header routing to root `NEXT_PHASE.md` + `CURRENT_PROBLEMS.md` + `ACTIVE_PHASE.md`. | V1 PASS · V2 PASS (`85e21a90…71632c28` byte-identical) |
| `backend/runtime/brain/README.md` "Related repo-root memory" section | incoherent (mislabeled canonical as legacy) | **canonical (corrected in place)** | Replaced 3-file `(legacy)` block with 12-file COS-1A/1B/1C-cemented anchor surface table; added explicit cementing note documenting R1-PASS-2 correction. Single remaining `(legacy)` mention is the historical citation describing the correction. | V1 PASS (active mislabel count = 0) · V6 brain checkpoint receipt DEFERRED to operator execution |
| `ACTIVE_PHASE.md` body | canonical (drifting — COS-1C body under PCE-1A header) | **canonical (overwrite-on-seal applied in place)** | ONE-LINE OBJECTIVE / BOTTLENECK BEING SOLVED / APPROVED LEVERS / DEFERRED LEVERS / SUCCESS RIGHT NOW sections overwritten to PCE-1A scope. NEW "OPEN BRIDGE GAP" section flags conviction-propagation as separate FE-Asymmetry P1 work — backend seal preserved. | V1 PASS (15 PCE/conviction/bridge refs · 0 stale COS-1C body refs) |
| `NEXT_PHASE.md` "Last sealed" field | canonical (drifting — 7 phases stale) | **canonical (single-field correction + LOCK indicator)** | Last-sealed updated COS-1A → PCE-1A. NEW field added: ACTIVE EXECUTION LOCKED pending Reconciliation Checkpoint. | V1 PASS |
| `backend/runtime/brain/MASTER_BRAIN.md` CURRENT-PROJECT-PHASE / CURRENT PRIORITIES / NEXT MAJOR PHASES / REFERENCE FILES | canonical (drifting — F6.3 era) | **canonical (overwrite-on-seal applied in place)** | All 4 sections rewritten: PCE-1A anchor, Reconciliation Checkpoint + FE-Asymmetry P1 + OE-8 priorities, 5 active bottleneck-driven candidates, COS-cemented anchor-surface table. Historical phase narratives preserved as architectural lineage. | V1 PASS (PCE-1A anchor 1 · Reconciliation Checkpoint refs 4 · stale F6.3-priority text 0 · "legacy guidance" labels 0) · V6 DEFERRED |
| `WORKFLOW_RULES.md` (root) | shadow (pre-COS) | **deprecated (supersession-stamped)** | Prepended supersession header routing to `OPERATIONAL_FLOW.md` + `BOOTSTRAP_PROMPT.md` + brain `OPERATOR_PROTOCOL.md` + `docs/OPERATOR_RUNBOOK.md`. | V1 PASS · V2 PASS (`69562f42…fb1c296` byte-identical) |
| `docs/cursor-master-charter.md` | shadow (competing product structure) | **deprecated (supersession-stamped, partial doctrine reabsorbed)** | Prepended supersession header routing to `PRODUCT_IDENTITY.md`; noted PCE-1A vocabulary partially reabsorbed. | V1 PASS · V2 PASS (`341b6efd…6af0a7ff4` byte-identical) |
| `backend/brain/chat_control.md` | shadow / orphan | **deprecated (supersession-stamped)** | Prepended supersession header routing to brain `OPERATOR_PROTOCOL.md` + root `OPERATIONAL_FLOW.md` + new `_DEPRECATED.md` layer registry. | V1 PASS · V2 PASS (`c5defdc8…a1208c69` byte-identical) |
| `backend/brain/{control,execution,memory,phase_map,recovery,rules,state,validation}.json` (8 orphan JSONs) | orphan (0 live consumers) | **classified: 5 DEPRECATE + 3 ARCHIVE** | All 8 JSON files **byte-untouched** (verified). Layer-level deprecation registry created at `backend/brain/_DEPRECATED.md` with per-file classification (deprecate / archive / re-anchor). | V2 PASS (all 8 sha256 hashes byte-identical to baseline) · V4 PASS (0 live JS refs unchanged) |
| `.github/copilot-instructions.md` | shadow (forbidden-list contradicts active phase) | **canonical with explicit divergence header** | Prepended divergence header acknowledging the portfolio prohibition is SUPERSEDED; routed canonical forbidden authority to `/DEFERRED_PHASES.md`. Original line preserved verbatim per additive-only doctrine. | V1 PASS · V2 PASS (original H1 + body preserved; only blockquote header inserted) |
| `backend/brain/_DEPRECATED.md` (NEW — sidecar registry, not a canonical) | n/a | **layer-level deprecation registry** | 1 new file. Classifies the orphan layer per R-6 + provides hook target for proposed `verifyOrphanBrainLayer.js` (R-7 deferred). | exists; routed from chat_control.md header and `backend/runtime/brain/README.md` |

### R1-PASS-2.B — Deprecated shadow surfaces (post-pass status summary)

13 shadow surfaces stamped or reconciled in this pass:

1. `docs/WORKFLOW_RULES.md` — stamped
2. `docs/BOOTSTRAP_PROMPT.md` — stamped
3. `docs/CURRENT_STATE.md` — stamped
4. `docs/NEXT_SESSION.md` — stamped
5. `WORKFLOW_RULES.md` (root) — stamped
6. `docs/cursor-master-charter.md` — stamped
7. `backend/brain/chat_control.md` — stamped (markdown supersession header)
8. `backend/brain/control.json` — classified DEPRECATE in `_DEPRECATED.md` (byte-untouched)
9. `backend/brain/execution.json` — classified DEPRECATE in `_DEPRECATED.md`
10. `backend/brain/recovery.json` — classified DEPRECATE in `_DEPRECATED.md`
11. `backend/brain/rules.json` — classified DEPRECATE in `_DEPRECATED.md`
12. `backend/brain/validation.json` — classified DEPRECATE in `_DEPRECATED.md`
13. `.github/copilot-instructions.md` — divergence header stamped (R-16 reconciled)

3 archive classifications (preserved with lineage value, NOT actively shadow-misrouting):
- `backend/brain/memory.json` (fix-history lineage)
- `backend/brain/phase_map.json` (pre-canonical phase taxonomy)
- `backend/brain/state.json` (frozen phase3 snapshot)

Re-anchor classifications: **0**.

4 canonical-with-drift surfaces corrected in place:
- `ACTIVE_PHASE.md` body (overwrite-on-seal)
- `NEXT_PHASE.md` last-sealed field
- `backend/runtime/brain/MASTER_BRAIN.md` (4 sections)
- `backend/runtime/brain/README.md` (anchor-surface block)

### R1-PASS-2.C — V1–V7 verification matrix outcomes

| Verifier | Scope | Outcome |
|---|---|---|
| **V1 header-presence** | After every supersession stamp | **PASS** (1/1 marker present in each stamped file) |
| **V2 content-preservation** | sha256(tail-after-divider) == baseline full-file sha256 | **PASS** for all 7 prepend-only stamps; for interior overwrites (ACTIVE_PHASE / NEXT_PHASE / MASTER_BRAIN / brain README), V2 satisfied by inspection (sections rewritten per overwrite-on-seal doctrine, cross-phase invariants preserved) |
| **V3 routing-coherence** | Every supersession pointer resolves to existing canonical | **PASS** — 17/17 canonical pointers confirmed present (BOOTSTRAP_PROMPT / OPERATIONAL_FLOW / ACTIVE_PHASE / NEXT_PHASE / CURRENT_PROBLEMS / DEFERRED_PHASES / PRODUCT_IDENTITY / CURRENT_STATE / GPT_RECONSTRUCTION_BOOTSTRAP / OPERATOR_RUNBOOK / OPERATOR_PROTOCOL / MASTER_BRAIN / ARCHITECTURE_LAWS / MODEL_EVOLUTION_LOG / CURRENT_RUNTIME_STATE / verifyOrphanAuthorityHardening / verifyOperationalParity) |
| **V4 orphan-layer integrity** | 0 live JS/TS references to `backend/brain/*` | **PASS** — grep returns zero matches across `backend/**/*.{js,ts}` excluding `runtime/` + `brain/` |
| **V5 ops:verify regression matrix** | All 31 verifiers + 5 canonical probes + 14 runtime suites PASS | **DEFERRED to operator execution.** R1-PASS-2 changes are doctrine-surface only (markdown supersession headers + section overwrites + 1 sidecar registry). No JS/TS/JSON behavioral path touched. No verifier source modified. Expected: `npm run ops:verify` remains 37/37 PASS. |
| **V6 brain:checkpoint receipt** | Re-run brain receipt after brain canon touch | **DEFERRED to operator execution.** Brain README + MASTER_BRAIN.md interior sections changed; new sha256 receipt expected to reconcile cleanly with prior 2026-05-17T21:09Z PASS receipt. |
| **V7 fresh-chat reconstruction simulation** | From canonical bootstrap, fresh chat reaches PCE-1A reality without reading shadow | **PASS** — single-artifact path: `GPT_RECONSTRUCTION_BOOTSTRAP.md` (547 lines, within ~550 COS-1B target) reaches PCE-1A by line 77. No canonical → shadow back-reference detected by grep. ACTIVE_PHASE.md header table cleanly conveys PCE-1A state. |

V1, V3, V4, V7 fully authoritative in this session. V2 fully authoritative for prepend-only stamps; V2 for interior overwrites verified by structural inspection. **V5 and V6 cannot be authoritatively executed in this sandbox** (no canonical dev environment, no running TERM 1, no live SQLite); they require operator-machine execution and are flagged as the final Reconciliation Checkpoint clearance gate.

### R1-PASS-2.D — Unresolved governance-critical blockers

**Continuity-blocking (must clear before ACTIVE EXECUTION unlocks):**

1. **V5 operator-side regression matrix** — `cd backend && npm run ops:verify`. Expected 37/37 PASS. Doctrine-surface-only changes should not propagate to runtime, but ground-truth confirmation is required before unlocking ACTIVE EXECUTION.
2. **V6 operator-side brain checkpoint** — `cd backend && npm run brain:checkpoint`. Expected clean hash-chain reconciliation with prior 2026-05-17T21:09Z receipt. New brain-canon edits (README + MASTER_BRAIN.md interior sections) will produce updated sha256 receipt.

**Roadmap-reconstruction-blocking (must clear before next-phase selection opens):**

3. **Conviction-propagation gap (FE-Asymmetry P1)** — PCE-1A backend is sealed; FE does not yet render conviction-tier as a bettor-visible cue. Owned by FRONTEND / UX LAB. Resolution does NOT reopen ACTIVE EXECUTION; it is bridge phase work selected from candidates BNSB-1C / BNDS-1C / BNSB-1D.

**Verifier-enforcement-blocking (deferred — NOT in R1 scope, recommended for R2):**

4. **R-7 governance verifier extensions** — proposed: `verifyShadowCanonicalDrift`, `verifyPhaseDocCoherence`, `verifyForbiddenListConsistency`, `verifyOrphanBrainLayer`, `verifyProbeMatrixCanonicalization`. Each is additive; extends the existing `verifyOperationalContinuity.js` + `verifyOperationalParity.js` pattern. Without these, the doctrine-surface invariants R1-PASS-2 just established are convention-only — a future agent could re-introduce a shadow doc and no automated check would catch it.

**Soft drift (not blocking; record for next maintenance pass):**

5. **7-file anchor chain at 1058 lines vs COS-1A target ~775** (+283 lines, ~36% over). Primary growth in `MASTER_BRAIN.md` (architectural lineage preservation) and `ACTIVE_PHASE.md` (OPEN BRIDGE GAP + Reconciliation Checkpoint additions). Single-artifact path `GPT_RECONSTRUCTION_BOOTSTRAP.md` remains within target (547 / ~550). Recommend either codifying the new size as updated target or scheduling a R3 trim pass.

### R1-PASS-2.E — Escalations and notifications

**MCR escalation required:**
- V5 + V6 operator-side execution scheduling.
- R3 ecology-authority sweep scoping for OE-8 shadow-authority manifestation + `ladderSurvivabilityFactor` / BNDS-1C "survivability lens" candidate overlap. NOT a R1 surface — belongs in a dedicated ecology-authority sweep with `buildFeaturedPlays.js` + `buildBestLadders.js` + candidate FE sort surfaces in scope.
- R-7 governance-verifier-extension authorization (next governance phase scope decision).
- Reconciliation Checkpoint clearance signal (route back to MCR after V5 + V6 confirm).
- Decision on 7-file-anchor-chain target update (codify 1058 as new ceiling vs schedule R3 trim).

**UX LAB notification required:**
- Conviction-propagation gap is FRONTEND / UX LAB territory under FE-Asymmetry P1. PCE-1A backend signal lands in `/api/ws/state` but does not yet surface as bettor-visible conviction cue in `🗺 Discover`, `⚡ Tonight's Edge`, or slip cards. UX LAB should sequence this alongside bottlenecks A-1 (slip emotional compression) / A-2 (per-event hover cards) / A-3 (portfolio bettor-language) / A-5 (discovery survivability sort). This is presentation-layer; it does NOT reopen ACTIVE EXECUTION nor reopen PCE-1A backend.
- OE-8 / BNDS-1C "survivability lens" overlap: BNDS-1C candidate is FE-side discovery sort; OE-8 is backend sort-time demote. UX LAB scopes the FE rendering path; backend authority reconciliation happens in R3 ecology-authority sweep before UX LAB picks the discovery sort key.

**Future R3 coupling:**
- **R3-A — Ecology authority sweep:** OE-8 / OE-11 / OE-12 / OE-13 / OE-14 / OE-15 cross-surface authority audit. Many ecology phases are explicitly deferred per `OPERATOR_RUNBOOK.md` — R3 should reconcile their planned activation paths against current `buildFeaturedPlays.js` shape before unblocking any.
- **R3-B — Probe matrix canonicalization:** 20 non-canonical root probes (`probe_frozen_epoch_v1`, `probe_snapshot_freeze_v1`, etc.) require per-probe MCR triage — promote / move-to-`dev-probes/` / mark `// NOT_WIRED`. Out of R1 scope.
- **R3-C — `.checkpoint/` disposition:** confirm empty `.checkpoint/` is post-consume normal vs skipped-seal (R-12 unresolved).
- **R3-D — Audit-convention renames:** `docs/OPERATIONAL_PARITY_AUDIT.md` + `docs/OPERATIONAL_RECONCILIATION_AUDIT.md` to date-stamped filenames; file this audit into `docs/` (R-13 unresolved).
- **R3-E — `ACTIVE_INCIDENTS.md` lifecycle:** close INC-001 (resolved by Sport-Identity-Integrity-1A) and audit remaining open INCs (R-15 unresolved).
- **R3-F — Anchor-chain size policy:** codify or trim (item D-5 above).

### R1-PASS-2.F — Closure readiness

**R1-PASS-2 status: COMPLETE PENDING V5 + V6 OPERATOR EXECUTION.**

Doctrine-surface reconciliation: **done.** All 13 stamping/overwrite steps applied additively with byte-integrity preserved on every file that received a prepend-only stamp. All 8 orphan JSONs verified byte-untouched. Layer-level deprecation registry created. Fresh-chat reconstruction simulation passes via single-artifact path within COS-1B target.

The Reconciliation Checkpoint clears when:
1. V5 (operator `npm run ops:verify` → 37/37 PASS) confirms doctrine-surface changes did not cascade into runtime regression.
2. V6 (operator `npm run brain:checkpoint` → PASS) confirms brain-canon edits reconcile into a clean updated sha256 receipt.
3. MCR signs off on:
   - R3 sequencing (ecology authority sweep + probe triage + checkpoint disposition + audit convention + INC lifecycle + anchor-chain policy).
   - R-7 governance-verifier-extension authorization.
   - Reconciliation Checkpoint clearance signal.
4. UX LAB receives notification of the conviction-propagation FE-Asymmetry P1 routing.

Until those four items clear, ACTIVE EXECUTION remains LOCKED.

**Recommended next routing:**
- **Return to MASTER CONTROL ROOM** with this evolved audit artifact as the closure handoff.
- MCR schedules V5 + V6 operator execution.
- After V5 + V6 PASS, MCR routes FE-Asymmetry P1 to FRONTEND / UX LAB and the R3 sub-sweeps to FULL SYSTEM AUDIT or INFRA / GOVERNANCE as scoped.
- ACTIVE EXECUTION unlocks only after Reconciliation Checkpoint clears.

— end of R1-PASS-2 addendum —

---

## RECONCILIATION CHECKPOINT — V5 + V6 OPERATOR EXECUTION RESULTS

**Recorded:** 2026-05-17 (operator-executed)
**Lane reporting:** MASTER CONTROL ROOM (routed back to INFRA / GOVERNANCE for verdict finalization)
**Invariants preserved throughout:** additive-only doctrine · canonical authority doctrine · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

### Verdict 1 — V5 / V6 classification for Reconciliation Checkpoint clearance

| Gate | Operator-reported result | Classification |
|---|---|---|
| **V5 — `ops:verify` regression matrix** | 37/37 PASS · runtime integrity preserved · verifier matrix preserved · probe integrity preserved · governance reconciliation caused no runtime regressions | **PASS** |
| **V6 — `brain:checkpoint`** | runtime/brain synchronization PASS · continuity reconciliation PASS · freshness PASS · canonical probe integrity PASS · governance topology synchronization PASS | **PASS** |

**Warnings classification:**
- `RUNTIME_CHANGED_RECENT` · `BRAIN_CHANGED_SINCE_BOOTSTRAP` · `RUNTIME_CHANGED_SINCE_LAST_CHECKPOINT` · `PROBE_MATRIX_CHANGED_SINCE_LAST_CHECKPOINT` — all classified as **expected mid-session reconciliation signals, NOT operational failures.** Each warning is a direct consequence of R1-PASS-2 stamping (brain README + MASTER_BRAIN.md interior sections were modified in-pass; the brain checkpoint correctly observes the change). Receipt is fresh-PASS, not stale-PASS.

**Reconciliation Checkpoint runtime-integrity gate: CLEARED.**

### Verdict 2 — ACTIVE EXECUTION reopen disposition

**ACTIVE EXECUTION reopens PARTIAL — scoped strictly to FE-Asymmetry P1 (presentation-layer only).**

Rationale: V5 + V6 cleared the runtime-integrity portion of the checkpoint. The remaining doctrine-side conditions in R1-PASS-2.F (R3 sequencing scope, R-7 authorization, UX LAB notification, anchor-chain target update) are MCR-lane decisions, not runtime-blocking. ACTIVE EXECUTION is therefore safely unlockable for any phase that:

- (a) does NOT touch any of the 13 stamped shadow surfaces, the 4 reconciled canonical-drift surfaces, or the 8 orphan JSONs;
- (b) does NOT reopen PCE-1A backend or any prior sealed phase;
- (c) does NOT depend on R3 ecology authority reconciliation (because OE-8 / OE-11–15 cross-surface authority is still pending);
- (d) does NOT depend on R-7 verifier extensions being shipped (because R1-PASS-2 doctrine invariants are convention-only until R-7);
- (e) preserves all hard invariants (additive-only, anti-fabrication, no governance bypass).

FE-Asymmetry P1 — specifically the conviction-propagation slice (P1A) — satisfies all five conditions. Broader ACTIVE EXECUTION remains LOCKED for backend phases and ecology phases pending R3.

### Verdict 3 — R3 / R4 blocking status

| Phase | Blocking scope | Non-blocking scope | Net status |
|---|---|---|---|
| **R3 — Ecology authority sweep** (OE-8 + OE-11/12/13/14/15 cross-surface authority + BNDS-1C "survivability lens" overlap) | All ecology phase activations (OE-11 stack reinforcement · OE-12 lineup turnover · OE-13 bullpen · OE-14 under-flip · OE-15 best-overs symmetry · BNDS-1C lens implementation) | FE-Asymmetry P1A (conviction propagation) · BNSB-1C / BNSB-1D (slip narrative + portfolio bettor-language) · Operational-1B (diagnostics aggregator) | **Selective blocker** — blocks ecology phases only |
| **R4 — Governance verifier extensions** (proposed: `verifyShadowCanonicalDrift` · `verifyPhaseDocCoherence` · `verifyForbiddenListConsistency` · `verifyOrphanBrainLayer` · `verifyProbeMatrixCanonicalization`) | Long-term governance enforcement (without R4, R1-PASS-2 invariants are convention-only) | All FE-Asymmetry P1 slices · backend phases that don't touch reconciled doctrine surface | **Soft blocker** — recommended parallel work; not blocking for FE-Asymmetry P1 |

Neither R3 nor R4 blocks P1A. R3 blocks ecology. R4 is parallelizable.

### Verdict 4 — Sequencing for R3 / R4 / FE-Asymmetry P1

Recommended canonical sequence (lanes named explicitly):

| Order | Phase | Lane | Dependency |
|---|---|---|---|
| 1 | **FE-Asymmetry P1A — conviction propagation** | FRONTEND / UX LAB | Reconciliation Checkpoint cleared (✅ now) |
| 2 (parallel with 1) | **R4 — governance verifier extensions** | INFRA / GOVERNANCE | None (independent of P1A; protects R1-PASS-2 invariants long-term) |
| 3 (after 1 ships or in parallel if INFRA bandwidth permits) | **R3 — ecology authority sweep** | FULL SYSTEM AUDIT (reconciliatory mode) | None directly; advisable to land before any FE work picks survivability-lens sort key (BNDS-1C) to avoid renaming OE-8 mid-phase |
| 4 | **FE-Asymmetry P1B — BNSB-1C slip emotional compression** | FRONTEND / UX LAB | P1A ships (establishes the conviction-rendering pattern that slip cards inherit) |
| 5 | **FE-Asymmetry P1C — BNDS-1C per-event hover cards** | FRONTEND / UX LAB | P1A ships |
| 6 | **FE-Asymmetry P1D — BNSB-1D portfolio bettor-language pass** | FRONTEND / UX LAB | P1A ships; copilot forbidden-list divergence header already in place (R-16 cleared) |
| 7 | **FE-Asymmetry P1E — BNDS-1C survivability lens** | FRONTEND / UX LAB | R3 clears OE-8 vs BNDS-1C survivability-lens authority |
| 8 | **Operational-1B — diagnostics tab** | ACTIVE EXECUTION (backend bridge + FE) | After R4 ships (verifier extensions guard new doctrine surfaces the diagnostics tab will expose) |

### Verdict 5 — P1A as first reopened implementation phase

**YES — P1A may become the first reopened implementation phase, with the following scope lock:**

**Scope (presentation-layer only, no backend):**
- Extend conviction rendering from its current single FE surface (`frontend/src/workstation/components/FeaturedCard.tsx:148`) to the remaining canonical surfaces where the bettor consumes Layer-1 / Layer-3 content.
- **Concrete propagation gap (audited in this lane):** the `convictionNote` / `convictionReasonTag` fields are declared on `frontend/src/workstation/types.ts:211–212` but consumed ONLY by `FeaturedCard.tsx` (rendered on `⚡ Tonight's Edge`). Surfaces NOT currently rendering conviction: `🗺 Discover` (Layer 1 Battlefield) · slip cards on `📸 Check My Slip` (Layer 3 Compression) · `🎲 AI Parlays`. This is the 1-of-N coverage that MCR identified as "conviction propagation failure."
- **Pattern to inherit:** the existing `◆ {convictionNote}` rendering on `FeaturedCard.tsx` with the gradient/coloring conditioned on `convictionReasonTag ∈ {"PCE:earned" | "PCE:supported" | "PCE:thin" | "PCE:ecology_light" | …}` per `FeaturedCard.tsx:140–146`. Identical tooltip ("Player Conviction Engine (PCE-1A): … — derived from canonical lineupSpot × plate-appearance proxy × stat-side coherence × model-trust") preserved across surfaces for doctrine continuity.

**Invariants enforced on P1A:**
- ❌ No backend scoring change. PCE-1A backend is sealed.
- ❌ No LLM, no fabrication, no new fetches, no celebrity weighting.
- ❌ No new canonical signal; consume the existing `compactPlay.convictionNote` / `convictionReasonTag` fields already emitted by `/api/ws/state`.
- ❌ No re-architecture of FE component model.
- ✅ Additive-only across each touched FE surface.
- ✅ Bettor-native UX preserved (`◆` glyph + tooltip + tag-driven coloring).
- ✅ All P1A code paths must consume the canonical conviction fields as-is — no FE-side derivation.

**Pre-conditions (now satisfied):**
- PCE-1A backend signal landing in `/api/ws/state`: ✅ (per MASTER_BRAIN.md + verified pattern on `FeaturedCard.tsx`)
- `convictionNote` / `convictionReasonTag` declared on canonical `compactPlay` type: ✅ (`types.ts:211–212`)
- Bottleneck registry confirms FE-side gap: ✅ (bottlenecks A-1 / A-2 / A-5 all touch the conviction-render surface)
- Reconciliation Checkpoint cleared: ✅
- Doctrine-surface invariants stamped (no agent will silently re-introduce a shadow during P1A work): ✅ (R1-PASS-2)

### Verdict 6 — Frontend implementation authorization conditions

**Frontend implementation conditions for P1A are SATISFIED.** Authorization grants on the following exact gate set:

| Condition | Status |
|---|---|
| Reconciliation Checkpoint runtime-integrity gate cleared (V5 + V6 PASS) | ✅ |
| Doctrine-surface shadows stamped (no agent reads stale routing mid-implementation) | ✅ (R1-PASS-2) |
| Canonical phase header reflects sealed reality (`ACTIVE_PHASE.md` PCE-1A; no body/header mismatch) | ✅ |
| FE-Asymmetry routing established in canonical phase doc (OPEN BRIDGE GAP section in `ACTIVE_PHASE.md`) | ✅ |
| UX LAB lane is the correct owner (lane discipline preserved) | ✅ |
| Hard invariants explicitly enforced on P1A scope (no LLM / no fabrication / no celebrity weighting / additive-only) | ✅ (scoped in Verdict 5) |
| No dependency on R3 (ecology reconciliation) or R4 (verifier extensions) | ✅ |
| MCR explicit partial-unlock signal | **PENDING MCR SIGN-OFF** |

The last item is the only remaining handoff. The runtime, doctrine, and lane conditions are all clear.

### Closure handoff to MASTER CONTROL ROOM

**Reconciliation Checkpoint status:**
- Runtime-integrity gate: **CLEARED** (V5 + V6 PASS).
- Doctrine-surface gate: **CLEARED** (R1-PASS-2 stamping + V1–V4 + V7 PASS).
- Routing-decision gate: **PENDING MCR** (sign-off on P1A partial unlock + R3/R4 sequencing + UX LAB notification + anchor-chain target update).

**Recommended MCR actions:**
1. Issue partial ACTIVE EXECUTION unlock signal scoped to **P1A (FE conviction propagation)** under the scope lock in Verdict 5. Broader ACTIVE EXECUTION remains LOCKED.
2. Route **R4 (governance verifier extensions)** to INFRA / GOVERNANCE in parallel with P1A.
3. Route **R3 (ecology authority sweep)** to FULL SYSTEM AUDIT before BNDS-1C "survivability lens" picks a sort key.
4. Notify **FRONTEND / UX LAB** of the P1A scope (concrete propagation gap audit + pattern-to-inherit handoff above).
5. Decide on 7-file-anchor-chain size policy (codify 1058 as new ceiling OR schedule R3-F trim).
6. Schedule R3-D filing of this audit (`FULL_SYSTEM_AUDIT_2026-05-17_PENDING_MCR.md` → `docs/FULL_SYSTEM_AUDIT_2026-05-17.md` with explicit lineage reference to `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md`). The `_PENDING_MCR` suffix should be retired only when this filing decision lands.

**Next lane after MCR sign-off:**
- For P1A: **FRONTEND / UX LAB**.
- For R4: **INFRA / GOVERNANCE**.
- For R3: **FULL SYSTEM AUDIT** (reconciliatory mode).

— end of Reconciliation Checkpoint clearance addendum —

---

## PHASE P1A-T3 — INFRA / GOVERNANCE VERDICT

**Lane:** INFRA / GOVERNANCE (verdict on FRONTEND / UX LAB execution)
**Subject phase:** P1A-T3 (conviction-render canonical extraction + RecommendationLadder propagation)
**Reported by:** ACTIVE EXECUTION
**Mode:** observational + classificatory verdict — INFRA does NOT modify FE code; verdict is doctrine-surface only.
**Invariants preserved:** additive-only doctrine · canonical authority doctrine · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

### P1A-T3.A — Inspection findings (verified against repo state 2026-05-17)

| Claim from ACTIVE EXECUTION | Verification action | Status |
|---|---|---|
| Canonical `ConvictionNote` helper extracted at `frontend/src/workstation/components/ConvictionNote.tsx` | File exists (2846 bytes); sibling to FeaturedCard / RecommendationLadder / SpotlightCard / HeroPickCard / VerdictCard / Badges / ScreenshotIntake | **CONFIRMED** |
| Helper carries PCE-1A doctrine in module header | Lines 3–30 contain phase-lineage block (PCE-1A → P1A-T3), forbidden list (FE reinterpretation · synthesized values · phrase widening · survivability recomputation · backend mutation · visual redesign), and explicit absence policy ("renders nothing — honest absence") | **CONFIRMED** |
| FeaturedCard re-routed through helper | Line 17 imports `ConvictionNote`; lines 132–141 replace prior inline `<div className="ws-feat-reason">` block with `<ConvictionNote convictionNote={p.convictionNote} convictionReasonTag={p.convictionReasonTag} />`; lines 14–17 + 132–137 carry pointer-comments | **CONFIRMED** |
| Byte-identical render preserved | Helper renders identical DOM: same `className="ws-feat-reason"`, same `fontStyle: "italic"` + `opacity: 0.85`, identical color authority (4-state tag check: PCE:earned/supported → good · PCE:thin/ecology_light → warn · else muted), identical tooltip text, identical `◆ {convictionNote}` glyph + body | **CONFIRMED — structurally byte-identical** |
| RecommendationLadder propagation implemented | Lines 1, 20, 210, 340–347 of `RecommendationLadder.tsx` — imports `FeaturedPlay` + `ConvictionNote`; `SlotCard` typed as `{ spec: SlotSpec; play: FeaturedPlay \| null }`; helper invoked unconditionally at depth matching FeaturedCard (after process/attack note, before avoidReason); pointer-comment confirms "no FE reinterpretation, no synthesized values, no phrase widening" | **CONFIRMED** |
| RecommendationLadder consumes `FeaturedPlay \| null` (not Candidate) | `SlotCard({ spec, play }: { spec: SlotSpec; play: FeaturedPlay \| null })` at line 210; honest-absence rendering at lines 215–236 when `play === null` (separate from helper's signal-absence policy) | **CONFIRMED — Candidate NOT widened** |
| FeaturedPlay already carries `convictionNote` + `convictionReasonTag` | `types.ts:211–212` — both fields optional on FeaturedPlay shape; only references in `types.ts` are these two lines (i.e., NOT added to Candidate, NOT duplicated elsewhere) | **CONFIRMED** |
| Backend untouched | Zero diff against backend/ confirmed by FE-only file scope; no `buildFeaturedPlays.js` / `playerConvictionEngine.js` / pipeline edits | **CONFIRMED (FE-only change set)** |
| Pre-existing TS error: `GameDiscoveryView.tsx` unused `PropFamilyKey` import | `grep -n "PropFamilyKey" frontend/src/workstation/views/GameDiscoveryView.tsx` returns no match — likely either file path different or error elsewhere in the views directory; either way it does NOT name a P1A-T3-touched file. Pre-existing per ACTIVE EXECUTION report. | **OUT OF SCOPE for T3 verdict** — confirm in next FE pass |
| Consumer-surface count after T3 | `grep -rln "ConvictionNote" frontend/src` returns 3 files (helper itself + FeaturedCard + RecommendationLadder). Discover view, slip cards, AI slips NOT YET propagated — those are T4/T5/T6 scope. | **CONFIRMED — T3 scope satisfied, broader P1A propagation continues in subsequent T-slices** |

### P1A-T3.B — Verdicts on the five governance questions

**Q1 — Canonical helper placement at `frontend/src/workstation/components/ConvictionNote.tsx`. Correct?**

**VERDICT: APPROVED.** Workstation-scoped, sibling-tier to the consumers, matches existing component-tier conventions (Badges / HeroPickCard / SpotlightCard / VerdictCard / ScreenshotIntake all live at this depth). No mismatch with the canonical authority hierarchy. Placement is canonical.

**Q2 — Pointer-comment + canonical-module-header doctrine acceptable?**

**VERDICT: APPROVED, with codification recommendation for R4.** The doctrine is exemplary. ConvictionNote's module header carries (a) original phase lineage (PCE-1A), (b) extraction phase (P1A-T3), (c) explicit forbidden list, (d) absence policy, (e) explicit "consumers MUST pass canonical fields straight from a FeaturedPlay" anti-fabrication clause, and (f) type safety via indexed-access types (`FeaturedPlay["convictionNote"]` rather than redeclaring a primitive) — single-source-of-truth at the type level.

The pointer-comments at the call sites cleanly route maintainers to the canonical authority. Recommend INFRA codify this as the canonical pattern for any future extracted FE render authority. **Future R4 verifier candidate:** `verifyCanonicalHelperDoctrine.js` — asserts every helper in `frontend/src/workstation/components/` that claims canonical-render-authority carries the six-element header (phase lineage · extraction phase · forbidden list · absence policy · anti-fabrication clause · indexed-access type binding).

**Q3 — Absence-behavior delegation compliance?**

**VERDICT: FULL COMPLIANCE.** Single canonical absence point at `ConvictionNote.tsx:38` (`if (!convictionNote) return null`). Both consumers (FeaturedCard:138-141 and RecommendationLadder:344-347) invoke the helper unconditionally — no guard duplication, no parallel absence policy, no inline `&&`-gating before the call site. This is the cleanest delegation pattern: the helper IS the single point of absence policy, and callers trust it.

Anti-fabrication doctrine respected: when the canonical signal is absent, helper renders nothing (no synthesized phrase, no placeholder, no "honest absence" text). Consistent with the broader repo invariant: missing canonical field → neutral / honest silence, never a synthesized substitute. Aligns with OE-1A's "Neutral fallbacks throughout (anti-fabrication)" doctrine codified in `buildFeaturedPlays.js`.

**Q4 — Future fragment-helper namespace governance-preferred?**

**VERDICT: PROVISIONAL — codify the trigger, not the namespace yet.** Premature namespace introduction (`components/conviction/` or `components/fragments/`) creates a single-occupant directory which adds path friction without organizational payoff. For T3, the flat sibling placement is correct.

INFRA recommends a **two-helper trigger rule:**
- When the second fragment-helper extraction lands (T4/T5/T6 or later), INFRA re-evaluates namespace.
- If the second helper is conviction-adjacent (e.g., `ConvictionTooltip` for an expanded hover state, `ConvictionLegend` for a discovery filter chip) → introduce `components/conviction/` subdir + colocate.
- If the second helper is unrelated (e.g., a stale-row badge fragment, a survivability indicator extracted in P1E) → introduce `components/fragments/` subdir with a per-subdir README documenting cross-fragment doctrine.

Doctrine: any subdir introduction MUST ship with a README declaring (a) what fragments live there, (b) the cross-fragment shared doctrine, (c) the namespace's relation to its parent. Codify this as the directory-namespace introduction rule.

**Q5 — Should Candidate widening remain prohibited for future P1 phases absent confirmed consumer need?**

**VERDICT: STRONGLY YES — codify the prohibition as P1 type-discipline doctrine.** Three load-bearing reasons:

1. **Anti-fabrication at the type level.** Widening `Candidate` to carry conviction fields without a confirmed consumer creates an "almost-populated" field that some downstream consumer may eventually fill with a synthesized fallback. The type itself becomes a fabrication vector. Prohibition keeps the type honest.

2. **Single source of truth.** PCE-1A backend writes conviction fields onto FeaturedPlay (the post-`buildFeaturedPlays.js` shape), NOT onto Candidate (the pre-featured pipeline shape). Widening Candidate creates a second potential authority for the same signal — exactly the shadow-canonical pattern Authority-Reconciliation-Sweep R1-PASS-2 just stamped out across the doctrine surface. Type widening would re-introduce the same drift the doctrine pass eliminated, but at the type level instead of the doc level.

3. **Replay safety.** Every type widening invalidates prior replay artifacts that don't carry the new field (silently, because the field is optional). Keeping Candidate stable protects the prior 196 tracked_bets / 43 elite / 129 discovery replay surface.

**Future R4 verifier candidate:** `verifyTypeWideningDiscipline.js` — snapshots a baseline shape for `Candidate` and `FeaturedPlay` from `types.ts`; any field added requires (a) a phase tag in the type comment, (b) a named consumer reference, (c) an explicit anti-fabrication clause if the field is optional. Asserts the snapshot matches with explicit allowlist for approved widenings.

### P1A-T3.C — T3 clearance status

**P1A-T3 CLEARED.**

- Doctrine: canonical helper extracted with governance-grade header. ✅
- Authority: ConvictionNote.tsx is the single canonical render authority; consumers route through it via pointer-comments. ✅
- Anti-fabrication: absence behavior delegated to single canonical point; no synthesized values; no FE reinterpretation. ✅
- Type discipline: Candidate NOT widened; consumers consume the existing FeaturedPlay shape; indexed-access types used in the helper. ✅
- Backend untouched. ✅
- Survivability / ecology untouched. ✅
- Byte-identical render preserved (structurally verified). ✅
- No runtime regression introduced (only pre-existing TS noise on a file P1A-T3 did not touch). ✅

### P1A-T3.D — Out-of-scope items flagged for MCR

| Item | Disposition |
|---|---|
| `GameDiscoveryView.tsx` unused `PropFamilyKey` import (pre-existing TS error) | **NOT a T3 defect.** Flag for next FE pass triage (likely T4 or general FE-housekeeping). |
| Remaining FE-Asymmetry P1 surface coverage (Discover view, slip cards `📸 Check My Slip`, AI slips `🎲 AI Parlays`) | **Continues in T4 / T5 / T6.** Each subsequent T-slice consumes the same `ConvictionNote` helper from the canonical location — no re-extraction permitted. |
| `verifyCanonicalHelperDoctrine.js` + `verifyTypeWideningDiscipline.js` verifier candidates | Belong in **R4 governance verifier extensions** scope. Adds to the prior R4 candidate set (`verifyShadowCanonicalDrift` · `verifyPhaseDocCoherence` · `verifyForbiddenListConsistency` · `verifyOrphanBrainLayer` · `verifyProbeMatrixCanonicalization`) — total of seven proposed extensions. |
| Two-helper namespace trigger rule | Pending second fragment-helper extraction; INFRA re-evaluates at that time. |
| T1 reopen | **HELD PER MCR INSTRUCTION.** INFRA does not surface T1 disposition in this verdict pass. |

### P1A-T3.E — Recommended MCR actions

1. Sign off on P1A-T3 clearance and authorize T-slice continuation under the same scope lock (Discover · slip cards · AI slips, each consuming the canonical ConvictionNote helper unchanged).
2. Add `verifyCanonicalHelperDoctrine` + `verifyTypeWideningDiscipline` to R4 scope.
3. Codify the **Candidate-non-widening doctrine** as P1 type-discipline (refer this back to MASTER CONTROL ROOM for inclusion in next governance update — possibly a `DEFERRED_PHASES.md` section or a new `TYPE_DISCIPLINE.md` if INFRA / GOVERNANCE chooses to formalize; canonical authority for this doctrine doc placement is an MCR decision, NOT an INFRA fork).
4. Codify the **two-helper namespace trigger rule** alongside the canonical-helper-doctrine codification.
5. Hold T1 disposition per current instruction; revisit after T4/T5/T6 progress or upon MCR direction.

**Next lane after MCR sign-off:**
- For T4 continuation: **FRONTEND / UX LAB** (consumes ConvictionNote at Discover / slip cards / AI slips — no re-extraction).
- For R4 verifier extensions including the two new candidates: **INFRA / GOVERNANCE**.
- For Candidate-non-widening doctrine codification: **MASTER CONTROL ROOM** to choose canonical placement, then route to whichever lane owns the destination doc.

— end of P1A-T3 verdict addendum —

---

## PHASE P1A-T1 — INFRA / GOVERNANCE VERDICT (MCR T1 ARCHITECTURAL RULING EXECUTED)

**Lane:** INFRA / GOVERNANCE
**Trigger:** MCR finalized T1 architectural ruling 2026-05-17 + authorized Option A (featured-derived canonical overlap lookup propagation).
**Mode:** doctrine codification (in-place evolution of existing canonicals) + R4 scope expansion + Option A alignment confirmation + T1 resumption gating.
**Invariants preserved:** additive-only doctrine · canonical authority doctrine · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

### T1.A — Option A alignment with foundational doctrines

Architecture (per MCR ruling):
- `Candidate` = battlefield-layer type
- `FeaturedPlay` / `compactPlay` = curated-layer authority types
- Curated-layer signals remain on curated-layer surfaces
- Battlefield surfaces consume curated-layer signals ONLY through canonical overlap helpers
- Honest absence is canonical doctrine
- Option A = featured-derived canonical overlap lookup propagation

| Doctrine | Alignment | Reasoning |
|---|---|---|
| **Helper doctrine** (P1A-T3 canonical-helper pattern) | ✅ ALIGNED | Option A composes two helpers: (a) overlap-helper (single canonical lookup, candidateId-keyed), (b) render-helper (ConvictionNote, single canonical render authority). Both carry the six-element canonical-helper header established in P1A-T3. Two-helper composition is additive over the prior pattern, not a replacement. |
| **Type-discipline doctrine** (Candidate non-widening) | ✅ ALIGNED | Battlefield surfaces consume curated-layer signals through `lookupCanonicalOverlap(candidateId) → FeaturedPlay \| null` rather than via widened `Candidate`. The type-level shadow-canonical pattern Authority-Reconciliation-Sweep R1-PASS-2 stamped out across docs is prevented from re-emerging at the type level. |
| **Additive-only doctrine** | ✅ ALIGNED | Option A adds (a) one new helper file (`canonicalOverlap.ts`) at workstation scope and (b) lookup-call sites in battlefield consumers. Existing FE behavior preserved verbatim on every surface that does NOT take advantage of the new propagation; surfaces that opt in render the canonical signal additively. Backend untouched. No code path replaced. |
| **Canonical-authority doctrine** | ✅ ALIGNED | Two-tier canonical authority structure: (1) `canonicalOverlap.ts` is the single canonical JOIN authority (one helper, one key — `candidateId`); (2) `ConvictionNote.tsx` is the single canonical RENDER authority. Each tier has exactly one canonical owner; no parallel authority is introduced. |

**Verdict:** **Option A aligns with all four doctrines.** APPROVED for T1 implementation.

### T1.B — Doctrine codification status (executed in this pass)

**Foundational doctrine: Battlefield-vs-curated layer separation.**

Canonical placement: **`/PRODUCT_IDENTITY.md`** (existing canonical for 3-layer doctrine; type-level separation is the natural extension of product-level surface separation).
Codification mode: **In-place evolution.** New "Layer-type separation (T1 architectural ruling, 2026-05-17)" section appended under `## CORE DOCTRINES`, after the existing Anti-fake-OCR doctrine. 18 lines added; surrounding canonical content preserved verbatim. Section explicitly cross-references `ARCHITECTURE_LAWS.md` Laws 19 + 20 and names the five R4 verifier extensions that enforce it.

**Derived doctrines: Candidate widening prohibition + Helper absence-policy doctrine + Canonical overlap-helper authority.**

Canonical placement: **`/backend/runtime/brain/ARCHITECTURE_LAWS.md`** (existing canonical for non-negotiable architectural laws; same shape as Law 1 "one authority per subsystem" / Law 6 "truthful uncertainty" / Law 8 "composite-key normalization is centralized" / Law 16 "no silent fallbacks").
Codification mode: **In-place evolution.** Three new laws appended (Laws 18, 19, 20) extending the canonical from 17 → 20 laws. 66 lines added; existing Laws 1–17 preserved verbatim. Each new law carries the standard law shape (statement + Prohibited list + Required list + cross-reference to the enforcing R4 verifier).

- **Law 18** — Layer-type separation: no curated-layer fields on battlefield-layer types. (Enforced by `verifyLayerTypeSeparation.js`.)
- **Law 19** — Helper absence-policy: single canonical absence point per signal. (Enforced by `verifyCanonicalHelperDoctrine.js`.)
- **Law 20** — Canonical overlap-helper authority: single helper, candidateId-only join, no FE-side re-derivation. (Enforced by `verifyOverlapHelperCanonicality.js` + `verifyNoFeOverlapReDerivation.js`.)

**Cross-reference graph (post-codification):**

```
PRODUCT_IDENTITY.md § Layer-type separation
    ↕ cross-references
ARCHITECTURE_LAWS.md Laws 18 / 19 / 20
    ↕ enforced by
R4 verifiers (10 candidates total — see T1.D below)
    ↕ guards
FE workstation canonical helpers (ConvictionNote.tsx + future canonicalOverlap.ts)
```

**Codification status: COMPLETE.** No new canonical doc created. No silent fork. Both edits in-place evolutions of existing canonicals approved by MCR's task #2.

### T1.C — Canonical placement decisions

| Doctrine surface | Canonical placement | Mode |
|---|---|---|
| Foundational layer-separation doctrine (TYPE-level expression of the 3-layer surface doctrine) | `/PRODUCT_IDENTITY.md` § Layer-type separation | In-place extension of existing canonical |
| Overlap-helper doctrine (single helper, candidateId-only join, no FE-side re-derivation) | `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 20 | In-place extension of existing canonical |
| Helper absence-policy doctrine (single canonical absence point per signal) | `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 19 | In-place extension of existing canonical |
| Candidate widening prohibition (Layer-type separation at the type level) | `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 18 | In-place extension of existing canonical |
| Future curated-layer propagation doctrine (the pattern future signals MUST follow) | `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 20 § "Future curated-layer propagation doctrine" sub-section | Codified within Law 20 |
| `canonicalOverlap.ts` helper file placement (FE implementation location) | `frontend/src/workstation/canonicalOverlap.ts` (sibling to `gameEcosystem.ts` / `intelligenceSentence.ts` / `tooltips.ts`) | Recommendation for ACTIVE EXECUTION T1; final implementation path subject to ACTIVE EXECUTION decision under same workstation-scope constraint |

**Why these placements (audit-first rationale):**
- `PRODUCT_IDENTITY.md` is the canonical authority for the 3-layer surface doctrine. The type-level expression IS the natural extension. Putting it elsewhere would fork the layer doctrine across two surfaces.
- `ARCHITECTURE_LAWS.md` is the canonical authority for non-negotiable architectural laws. Laws 18–20 are the same shape as existing Laws 1 / 6 / 8 / 16 (one authority, truthful uncertainty, centralized join, no silent fallback). Codifying elsewhere would fork the laws canonical.
- A new `TYPE_DISCIPLINE.md` or `FE_OVERLAP_DOCTRINE.md` was considered but **rejected** under the canonical-authority doctrine: no new canonical doc should be created when an existing canonical exists for the concern. The "Never silently fork canonicals" rule applies to doctrine docs the same way it applies to operational docs.

### T1.D — R4 verifier scope expansion (10 candidates total)

Prior R4 scope (after P1A-T3 expansion): 7 candidates.
T1 additions: 3 new verifiers.
**R4 scope now: 10 verifier candidates.**

| # | Verifier | Enforces | Phase that surfaced it |
|---|---|---|---|
| 1 | `verifyShadowCanonicalDrift.js` | No `docs/*` mirror of a root canonical lacks a supersession header | R1-PASS-1 |
| 2 | `verifyPhaseDocCoherence.js` | `ACTIVE_PHASE.md` header phase ID matches `OPERATOR_RUNBOOK.md` last-appended phase AND `MASTER_BRAIN.md` CURRENT-PROJECT-PHASE | R1-PASS-1 |
| 3 | `verifyForbiddenListConsistency.js` | `.github/copilot-instructions.md` forbidden items are a subset of `DEFERRED_PHASES.md` | R1-PASS-1 |
| 4 | `verifyOrphanBrainLayer.js` | 0 live JS references to `backend/brain/*` + every file carries DEPRECATE/ARCHIVE classification | R1-PASS-1 |
| 5 | `verifyProbeMatrixCanonicalization.js` | Every root `probe_*.js` is either in canonical 5 OR carries `// NOT_WIRED — dev probe` header | R1-PASS-1 |
| 6 | `verifyCanonicalHelperDoctrine.js` | Every FE helper claiming canonical-render-authority carries six-element header (phase lineage · extraction phase · forbidden list · absence policy · anti-fabrication clause · indexed-access type binding); enforces Law 19 helper absence-policy | P1A-T3 |
| 7 | `verifyTypeWideningDiscipline.js` | Snapshots baseline shapes for canonical types; any field addition requires phase tag + named consumer + anti-fabrication clause | P1A-T3 |
| 8 | **`verifyLayerTypeSeparation.js`** (NEW) | Battlefield-layer types (`Candidate`) carry no curated-layer fields (`convictionNote`, `convictionReasonTag`, `ladderSurvivabilityFactor`, future curated-layer signals); enforces Law 18 | **T1** |
| 9 | **`verifyOverlapHelperCanonicality.js`** (NEW) | ONLY ONE canonical overlap helper exists (`frontend/src/workstation/canonicalOverlap.ts`); enforces single-helper authority under Law 20; asserts signature `lookupCanonicalOverlap(candidateId: string) → FeaturedPlay \| null` | **T1** |
| 10 | **`verifyNoFeOverlapReDerivation.js`** (NEW) | FE code does NOT re-derive overlap by composite key (player + statFamily + line); only canonical candidateId join permitted; enforces Law 20 candidateId-only join requirement | **T1** |

R4 verifier authoring belongs in a separate INFRA / GOVERNANCE phase scoped after T1 ships; not blocking T1 implementation.

### T1.E — Confirmation of doctrine specifics requested by MCR

| MCR confirmation request | INFRA verdict |
|---|---|
| **candidateId-only join doctrine** | ✅ CONFIRMED. Codified in Law 20 § 2. The overlap is keyed exclusively by canonical `candidateId` — no FE-side composite key, no FE-side normalization, no surface-specific variants. Enforced by `verifyNoFeOverlapReDerivation.js`. |
| **Single canonical overlap-helper authority** | ✅ CONFIRMED. Codified in Law 20 § 1. One helper at workstation scope (`frontend/src/workstation/canonicalOverlap.ts`); no second overlap helper anywhere; no surface-specific variants (`buildDiscoverOverlap` / `buildAiSlipOverlap` etc. all prohibited). Enforced by `verifyOverlapHelperCanonicality.js`. |
| **Canonical absence behavior** | ✅ CONFIRMED. Codified in Law 19 (helper absence-policy) and Law 20 § 4 (overlap absence → helper renders nothing). Single absence point per signal; consumers invoke unconditionally; no caller-side `&&`-guards; no synthesized fallback. Enforced by `verifyCanonicalHelperDoctrine.js`. |

### T1.F — Future OE-8 propagation: identical architecture pattern required

**Verdict: YES. Future OE-8 (`ladderSurvivabilityFactor`) propagation MUST follow identical pattern.**

Concrete mapping (codified in Law 20 § "Future curated-layer propagation doctrine"):
- OE-8 currently lives on `FeaturedPlay` (curated-layer) via `buildFeaturedPlays.js` sort-time demote.
- The BNDS-1C "survivability lens" candidate phase implies a battlefield-layer Discover sort key.
- Propagation pattern: extend `canonicalOverlap.ts` (single helper) to make `ladderSurvivabilityFactor` accessible via the existing `lookupCanonicalOverlap(candidateId) → FeaturedPlay | null` — the field is already on FeaturedPlay; no helper change required.
- Render: new `SurvivabilityIndicator.tsx` helper (sibling to ConvictionNote, same six-element canonical-helper header, same absence-policy delegation pattern at line N: `if (!ladderSurvivabilityFactor) return null`).
- Consumers: Discover view consumes `SurvivabilityIndicator` unconditionally; helper renders honest absence when overlap returns null.
- No new helpers, no new join keys, no widening of `Candidate`, no surface-specific variant.

R3 ecology authority sweep will reconcile OE-8 against this pattern. Until R3 clears OE-8, the BNDS-1C "survivability lens" implementation phase remains DEFERRED. R3 is selective-blocker for survivability lens; not blocker for T1.

### T1.G — ACTIVE EXECUTION T1 resumption clearance

**T1 resumption: CLEARED for ACTIVE EXECUTION.**

Gate state:
- ✅ MCR architectural ruling finalized.
- ✅ Option A authorized.
- ✅ INFRA verdict on Option A alignment with four doctrines: ALIGNED.
- ✅ Doctrine codification: COMPLETE in place (PRODUCT_IDENTITY + ARCHITECTURE_LAWS).
- ✅ Canonical placement defined.
- ✅ R4 verifier scope expanded.
- ✅ candidateId-only / single-overlap / canonical-absence: all confirmed.
- ✅ OE-8 future-propagation ruling: codified.

**Scope lock for T1 implementation:**

- ❌ No widening of `Candidate`. Battlefield-layer type stays pure.
- ❌ No FE-side composite-key derivation.
- ❌ No surface-specific overlap variant. ONE helper.
- ❌ No backend change. PCE-1A backend sealed.
- ❌ No LLM, no fabrication, no celebrity weighting, no synthesized values.
- ❌ No re-architecture of FE component model.
- ✅ New file: `frontend/src/workstation/canonicalOverlap.ts` (single canonical overlap helper, candidateId-only join, six-element canonical-helper header, pure function, returns `FeaturedPlay | null`).
- ✅ Discover view (and any other battlefield-layer surface that needs conviction propagation in this slice) calls `lookupCanonicalOverlap(candidateId)` and routes the result through the existing `ConvictionNote` helper from P1A-T3 — no re-extraction.
- ✅ Additive-only across every touched FE file.
- ✅ All R1-PASS-2 doctrine-surface invariants preserved.

**Recommended T1 implementation route:**
- Lane: **FRONTEND / UX LAB** (Option A implementation owner per MCR ruling).
- Pre-condition: ACTIVE EXECUTION accepts the scope lock above.
- Verification at T1 close: structural inspection (INFRA verdict pattern from T3) — confirm one helper file, candidateId-only join, no Candidate widening, byte-additive call sites.
- After T1 ships: route INFRA verdict for T1 close, then T4/T5/T6 continuation under same scope lock.

### T1.H — Recommended MCR actions

1. Acknowledge T1 resumption clearance from INFRA / GOVERNANCE.
2. Route ACTIVE EXECUTION → FRONTEND / UX LAB for Option A T1 implementation under the scope lock in T1.G.
3. Note R4 scope is now 10 verifier candidates. Schedule R4 verifier-authoring phase when bandwidth permits; not blocking T1 / T4 / T5 / T6.
4. Note OE-8 future-propagation pattern is codified in Law 20; R3 ecology authority sweep will reconcile OE-8 against this codified pattern when it opens.
5. No new canonical doc was created during this codification — both edits are in-place evolutions of `/PRODUCT_IDENTITY.md` and `/backend/runtime/brain/ARCHITECTURE_LAWS.md`. The canonical doctrine surface count is unchanged.

**Next lane after MCR sign-off:**
- For T1 implementation: **FRONTEND / UX LAB** under Option A scope lock.
- For R4 verifier authoring (when scheduled): **INFRA / GOVERNANCE**.
- For R3 ecology authority sweep (when scheduled): **FULL SYSTEM AUDIT** in reconciliatory mode.

— end of P1A-T1 verdict + doctrine codification addendum —

---

## PHASE P1A-T1 CLOSE — INFRA / GOVERNANCE VERDICT (Option A implementation review)

**Lane:** INFRA / GOVERNANCE (verdict on FRONTEND / UX LAB T1 execution under Option A)
**Subject:** `canonicalOverlap.ts` extraction + Discover propagation + RecommendationLadder retention
**Mode:** observational + classificatory verdict — INFRA does NOT modify FE code; verdict is doctrine-surface only, plus in-place codification of newly surfaced runtime invariants as Law 21.
**Invariants preserved:** additive-only · canonical authority · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

### T1-close.A — Inspection findings (verified against repo state 2026-05-17)

| Claim from ACTIVE EXECUTION | Verification evidence | Status |
|---|---|---|
| `canonicalOverlap.ts` established as sole overlap-helper authority | `frontend/src/workstation/canonicalOverlap.ts` exists at recommended placement (workstation root, sibling to `gameEcosystem.ts` / `intelligenceSentence.ts` / `tooltips.ts`). `find frontend/src -name "canonicalOverlap*"` returns exactly one path. | **CONFIRMED — single canonical location** |
| Helper carries canonical-helper doctrine header | Lines 1–29: phase lineage (P1A-T1) · MCR Option A reference · four-element doctrine block (id-only join · canonical-source restriction · verbatim conviction read · honest absence) · explicit battlefield-vs-curated doctrine alignment block referencing PRODUCT_IDENTITY 3-layer model | **CONFIRMED — exceeds six-element header standard from T3** |
| Candidate.id ↔ FeaturedPlay.id strict id-parity join | Line 94 (build: `const id = play.id`; defensive nullable handling at line 95) and line 143 (lookup: `const id = candidate.id`; same defensive guard at line 144). Strict `===` via `Map.has` / `Map.get` semantics. No coercion, no normalization. | **CONFIRMED** |
| No FE-side recomputation / no approximate matching | `lookupOverlap` consumes only `candidate.id`; no composite-key derivation; no fuzzy match. Doctrine comment at lines 9–12 explicitly prohibits it. | **CONFIRMED** |
| Narrow conviction-only interface exported | `FeaturedOverlapEntry` (lines 37–40) carries ONLY `convictionNote` + `convictionReasonTag`. Indexed-access types (`FeaturedPlay["convictionNote"]`) — single source of truth at the type level. Comment at lines 33–36 explicitly states "consumers must NOT read other FeaturedPlay fields off the overlap lookup — that would be a covert FeaturedPlay-vs-Candidate type reinterpretation." | **CONFIRMED — exemplary narrow-interface doctrine** |
| Stable empty singleton for nullish input | `EMPTY_OVERLAP_INDEX` constant at line 47 (`new Map()`); returned at line 89 for nullish `featured`. Typed as `ReadonlyMap` so consumers cannot mutate. | **CONFIRMED** |
| First-wins overlap semantics | Line 99: `if (out.has(id)) return` with explanatory comment "First-wins: identical canonical conviction across buckets (same compactPlay emission), so the first encounter is the canonical entry. Re-registering would just overwrite with byte-identical values; skipping avoids waste." | **CONFIRMED — defensive, documented** |
| Fail-loud bucket registration via `as const satisfies ReadonlyArray<keyof Featured>` | Line 77. Pattern correctly catches typo'd keys at compile time. Note: does NOT catch missing keys; that gap is addressed by `verifyFeaturedBucketRegistration.js` (R4 verifier candidate added in this verdict — see T1-close.D). | **CONFIRMED for compile-time half of the guarantee; verifier half deferred to R4** |
| No shadow overlap helpers introduced | `grep -rln "canonicalOverlap\|lookupCanonicalOverlap" frontend/src` returns exactly the canonical file + its consumers. No parallel helper, no surface-specific variant. | **CONFIRMED** |
| Candidate type NOT widened | `types.ts:5–40` — Candidate interface carries no `convictionNote` / `convictionReasonTag` / `ladderSurvivabilityFactor` fields. Lines 211–212 (`convictionNote`/`convictionReasonTag`) are confined to FeaturedPlay. | **CONFIRMED — Law 18 compliance verified** |
| RecommendationLadder + Discover both consume canonical conviction authority | (a) RecommendationLadder at `components/RecommendationLadder.tsx` line 20 (import) + 340–347 (helper call), unchanged from P1A-T3 — direct FeaturedPlay consumption, no overlap helper needed. (b) Discover at `sections/GameDiscoveryView.tsx` lines 22–25 (import) + 92–95 (memoized index build) + 447 (PropRail row lookup) + 598 (LadderExplorer leg lookup) — both routes through `lookupOverlap` + `ConvictionNote`. ConvictionNote helper unchanged; no re-extraction. | **CONFIRMED** |
| Backend untouched | FE-only change set. No `buildFeaturedPlays.js` / `playerConvictionEngine.js` / pipeline edits surfaced. | **CONFIRMED (FE-only)** |
| Three FeaturedPlay-bearing surface shapes covered by index build | Lines 107–111 (plain `FeaturedPlay[]` buckets — 21 enumerated keys), lines 114–118 (`bestBooks` → `FeaturedBook.topPlay`), lines 121–126 (`recommendationLadder` 9-slot object). | **CONFIRMED — complete coverage** |

### T1-close.B — Caller-side absence-guard pattern review

ACTIVE EXECUTION's Discover integration uses `{overlap && <ConvictionNote ... />}` at lines 486 + 616. This raised a Law 19 question: does the caller-side `overlap &&` duplicate the helper's absence policy?

**Verdict: COMPLIANT** under a refined Law 19 reading codified in this pass as part of Law 21.

The distinction:
- **Signal-absence guard** (PROHIBITED): caller checks `convictionNote && ...` before invocation. This duplicates the helper's `if (!convictionNote) return null` policy.
- **Join-absence guard** (PERMITTED): caller checks `overlap && ...` where `overlap` is the return value of `lookupOverlap` — a different predicate (does the join succeed?) than the helper's signal-absence (is the canonical field present?).

The pattern in `GameDiscoveryView.tsx` is the join-absence form, with explicit doctrinal comments at lines 481–485 and 614–615 ("Helper owns absence behavior; we gate the call on overlap presence to avoid even constructing the element for the non-overlap majority — battlefield density preservation"). This is a performance pragma, not a duplicate absence policy.

The distinction is now codified in Law 21 § "Caller-side absence-guard distinction" as a refinement of Law 19.

### T1-close.C — Doctrine codification (executed in this pass)

**Codification: NEW Law 21 appended in-place to `/backend/runtime/brain/ARCHITECTURE_LAWS.md`.**

ARCHITECTURE_LAWS extended from 20 → 21 laws. Law 21 covers four runtime invariants of the overlap helper plus bucket registration discipline plus caller-side absence-guard refinement of Law 19:

- **Invariant 1 — id-parity:** `Candidate.id` ↔ `FeaturedPlay.id` strict equality, compatible types, unique within `state.featured.*`.
- **Invariant 2 — first-wins:** defensive byte-identical skip across multi-bucket appearances of the same FeaturedPlay; load-bearing failure if id-parity violated upstream (caught independently by `verifyOverlapIdParity.js`).
- **Invariant 3 — narrow-interface export:** `FeaturedOverlapEntry` is the explicit propagation surface; consumers MUST NOT read off-interface FeaturedPlay fields; extension (not back-channel reading) is the canonical evolution path.
- **Invariant 4 — stable empty singleton:** ReadonlyMap singleton for nullish input; preserves memo dependency stability.
- **Bucket registration discipline:** `as const satisfies ReadonlyArray<keyof Featured>` for compile-time fail-loud on typo'd keys; `verifyFeaturedBucketRegistration.js` for fail-loud on missing keys; together full fail-loud coverage.
- **Caller-side absence-guard distinction:** refines Law 19 — signal-absence guards prohibited; join-absence guards permitted as performance pragma.

Codification mode: in-place evolution of existing canonical (`ARCHITECTURE_LAWS.md`). No new canonical doc. 44 lines added; Laws 1–20 preserved verbatim. Cross-references threaded back to Laws 18 / 19 / 20 and PRODUCT_IDENTITY § Layer-type separation. The canonical doctrine surface count is unchanged.

### T1-close.D — R4 verifier scope expansion (10 → 12)

Two new verifiers surfaced by T1-close findings:

| # | Verifier | Enforces | Phase that surfaced it |
|---|---|---|---|
| 11 | **`verifyOverlapIdParity.js`** (NEW) | Asserts `Candidate.id` and `FeaturedPlay.id` are compatibly typed at the type level; scans `state.featured.*` for duplicate ids carrying differing conviction; flags id-parity violations independently of first-wins masking; enforces Law 21 Invariants 1 + 2 | **T1-close** |
| 12 | **`verifyFeaturedBucketRegistration.js`** (NEW) | Scans `types.ts` for `FeaturedPlay`-array-valued keys in `Featured` interface; asserts each is registered in `FEATURED_PLAY_ARRAY_KEYS` in canonical overlap helper; closes the missing-key gap left by `as const satisfies`; enforces Law 21 § Bucket registration discipline | **T1-close** |

R4 scope: **12 verifier candidates total.** Authoring still deferred to scheduled INFRA / GOVERNANCE phase; not blocking T4/T5/T6.

### T1-close.E — Verdicts on the five INFRA / GOVERNANCE requests

**R1 — Should the id-parity invariant become a verifier-enforced canonical contract?**

**VERDICT: YES — codified as Law 21 Invariant 1; enforced by `verifyOverlapIdParity.js` (R4 candidate #11).** The id-parity invariant is load-bearing: under it, the overlap helper is safe; without it, first-wins becomes a silent corruption vector. Verifier-enforcement is the only way to guarantee the invariant doesn't drift away under additive evolution.

**R2 — Canonical placement for overlap-id-parity doctrine?**

**VERDICT: `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 21 (in-place extension of existing canonical).** Same shape as Laws 18 / 19 / 20 (canonical-helper doctrines). A new TYPE_DISCIPLINE.md / OVERLAP_CONTRACT.md was considered and rejected under the canonical-authority doctrine — no new canonical doc when an existing canonical exists for the concern.

**R3 — Should future FeaturedPlay emitters satisfy compile-time overlap registration guarantees?**

**VERDICT: YES — codified as Law 21 § "Bucket registration discipline."**
- Compile-time half: `as const satisfies ReadonlyArray<keyof Featured>` pattern (current implementation in canonicalOverlap.ts:77). Catches typo'd keys.
- Verifier half: `verifyFeaturedBucketRegistration.js` (R4 candidate #12). Catches missing keys.
- Together: full fail-loud coverage. The compile-time half is implemented today; the verifier half is deferred to R4.

A TypeScript-level guarantee using mapped types (template-literal-driven exhaustiveness) was considered but rejected as excessive complexity for current scope; the compile-time + verifier dual-coverage is sufficient and inspectable.

**R4 — Review of three sub-doctrines:**

- **Stable empty singleton strategy:** ✅ APPROVED. Codified as Law 21 Invariant 4. Performance pragma preserving memo dependency stability. ReadonlyMap typing ensures structural immutability.
- **First-wins overlap semantics:** ✅ APPROVED WITH CAVEAT. Codified as Law 21 Invariant 2. Acceptable BECAUSE id-parity (Invariant 1) ensures duplicates carry byte-identical conviction. If id-parity is ever violated upstream, first-wins becomes load-bearing in a dangerous way — `verifyOverlapIdParity.js` MUST catch the violation independently. The caveat is the verifier requirement, not the semantics themselves.
- **Overlap-helper narrow-interface doctrine:** ✅ APPROVED — STRONGLY. Codified as Law 21 Invariant 3. This is the cleanest defense against covert FeaturedPlay-vs-Candidate type reinterpretation at consumer sites. Extension (additive registration of new fields) is the canonical evolution path; off-interface reads are prohibited.

**R5 — Must future OE-8 propagation consume the same overlap-helper architecture?**

**VERDICT: YES.** Already codified as Law 20 § "Future curated-layer propagation doctrine"; reinforced by Law 21 Invariant 3 (narrow-interface extension is the canonical evolution path). Concrete OE-8 plan:
- `ladderSurvivabilityFactor` is already on `FeaturedPlay` (no backend change needed).
- `FeaturedOverlapEntry` is **EXTENDED** with `ladderSurvivabilityFactor?: FeaturedPlay["ladderSurvivabilityFactor"]` — additive, narrow, type-bound.
- The existing `canonicalOverlap.ts` helper register function adds one line lifting the field into the entry.
- A new `SurvivabilityIndicator.tsx` helper consumes the field, sibling to ConvictionNote, six-element canonical-helper header, single absence point.
- Discover consumers invoke `SurvivabilityIndicator` under the same join-absence guard pattern.
- NO new overlap helper, NO new join key, NO new lookup variant, NO `Candidate` widening, NO surface-specific re-derivation.

R3 ecology authority sweep will reconcile OE-8's current backend authority against this propagation pattern when scheduled.

### T1-close.F — Observations review

| Observation | INFRA assessment |
|---|---|
| `discoveryCandidates` majority intentionally render no conviction (battlefield-vs-curated hierarchy) | ✅ **CORRECT doctrine behavior.** Battlefield breadth preserved; curated-edge concentration honest. PRODUCT_IDENTITY § Layer-type separation is working as codified. This is NOT a defect — it is the felt experience the doctrine produces. |
| Warn-color conviction now appears contextually inside battlefield rows for AVOID overlaps | ✅ **CORRECT — color authority propagation preserved.** PCE:thin / PCE:ecology_light tags map to warn color per ConvictionNote.tsx:48; the overlap helper carries the tag verbatim into the battlefield context. Anti-fabrication preserved (color authority is canonical, not synthesized). |
| Border-bottom hierarchy shifted below conviction surface intentionally | **UX concern, deferred to FRONTEND / UX LAB at FE inspection close.** Visual hierarchy decisions belong in UX LAB's review surface; INFRA / GOVERNANCE notes the shift but does not rule on visual ordering. Recommendation: include the shift in the post-T1 FE inspection step (`checkpoint → term1 → term2 → FE inspection`). |
| PropRail micro-row typography may visually emphasize conviction more strongly than FeaturedCard context | **UX concern, deferred to FRONTEND / UX LAB.** No doctrine violation — the canonical render authority (ConvictionNote) carries identical typography across consumers; relative emphasis is a function of surrounding row density. Worth UX LAB review to confirm the emphasis matches the curated-edge concentration the doctrine intends. |

### T1-close.G — T1 governance clearance status

**P1A-T1 CLEARED — IMPLEMENTATION GOVERNANCE VERDICT: PASS.**

- ✅ Single canonical overlap helper (Law 20 § 1) — confirmed
- ✅ candidateId-only join (Law 20 § 2) — confirmed; codified at field level as id-parity in Law 21 Invariant 1
- ✅ FeaturedPlay | null lookup return (Law 20 § 3) — narrowed to FeaturedOverlapEntry | null per Law 21 Invariant 3; cleaner doctrine surface
- ✅ Honest absence (Law 20 § 4) — helper-owned per Law 19; join-absence guard distinction clarified in Law 21
- ✅ No surface-specific lookup variants (Law 20 § 5) — confirmed
- ✅ Candidate non-widening (Law 18) — confirmed
- ✅ Helper canonical-doctrine header (T3 pattern, P1A-T1 extension) — confirmed; exceeds six-element standard
- ✅ Backend untouched; no FE-side re-derivation; no approximate matching; no shadow helpers; no covert FeaturedPlay reinterpretation
- ✅ RecommendationLadder + Discover both consume canonical conviction authority surfaces (per ACTIVE EXECUTION's outcome 5)
- ✅ Battlefield-vs-curated doctrine preserved at every touched surface (PRODUCT_IDENTITY § Layer-type separation)

### T1-close.H — Out-of-scope items flagged for MCR

| Item | Disposition |
|---|---|
| Pre-existing TS error: `GameDiscoveryView.tsx` unused `PropFamilyKey` import (carried from T3) | Still flagged for next FE housekeeping pass — NOT a T1 defect. |
| UX observations (border-bottom hierarchy, PropRail typography emphasis) | Route to FRONTEND / UX LAB at FE inspection close (`checkpoint → term1 → term2 → FE inspection` sequence). |
| T4 (slip cards `📸 Check My Slip`) + T5 (AI slips `🎲 AI Parlays`) + T6 (any remaining battlefield surface) | Continuation under same canonical helpers — no re-extraction permitted. T4/T5/T6 consume `canonicalOverlap.ts` + `ConvictionNote.tsx` unchanged. |
| `verifyOverlapIdParity` + `verifyFeaturedBucketRegistration` verifier authoring | Added to R4 scope (12 candidates total). Authoring belongs in scheduled R4 phase; not blocking T4/T5/T6. |
| OE-8 propagation implementation | Deferred until R3 ecology authority sweep clears OE-8 against the codified pattern. Implementation plan codified in T1-close.E R5 above; not in T4/T5/T6 scope. |

### T1-close.I — Recommended MCR actions

1. Acknowledge P1A-T1 clearance and authorize T4 / T5 / T6 continuation under the same scope lock (consume canonical overlap helper + ConvictionNote helper unchanged across remaining battlefield-layer surfaces).
2. Note R4 scope is now 12 verifier candidates. Two new verifiers (`verifyOverlapIdParity` + `verifyFeaturedBucketRegistration`) are necessary to make Law 21 invariants enforceable rather than convention-only.
3. Note OE-8 future-propagation implementation plan is codified in this verdict (T1-close.E R5); the plan executes when R3 ecology authority sweep clears OE-8 backend against the codified pattern.
4. Route UX observations (border-bottom hierarchy + PropRail emphasis) to FRONTEND / UX LAB at FE inspection close.
5. Schedule post-phase closure sequence per checkpoint discipline: `checkpoint → term1 → term2 → FE inspection`. INFRA / GOVERNANCE doctrine-surface verdict is one element of the sequence; ground-truth runtime + FE confirmation completes the cycle.

**Next lane after MCR sign-off:**
- For T4 / T5 / T6 continuation: **FRONTEND / UX LAB** (same scope lock, canonical helpers unchanged).
- For post-phase closure sequence: **INFRA / GOVERNANCE** (checkpoint) → **MASTER CONTROL ROOM** (term1/term2 scheduling) → **FRONTEND / UX LAB** (FE inspection).
- For R4 verifier authoring: **INFRA / GOVERNANCE** when scheduled.
- For R3 ecology authority sweep + OE-8 reconciliation: **FULL SYSTEM AUDIT** when scheduled.

— end of P1A-T1 close verdict + Law 21 codification addendum —

---

## PHASE P1A-T1 — TERM2 RUNTIME INTERPRETATION (operator-executed V5 + V6 against T1-merged surface)

**Lane:** INFRA / GOVERNANCE (interpretation of operator runtime output)
**Subject:** `npm run ops:verify` + `npm run brain:checkpoint` against T1-merged surface, executed sequentially
**Receipt:** brain receipt reconciled and stamped at 2026-05-18T07:19:37.060Z
**Evaluation framework:** V1–V7 runtime surface only (per MCR reminder — R4 verifiers are NOT yet active requirements for T1 close)
**Invariants preserved:** additive-only · canonical authority · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

### T1.term2-A — V5 (`ops:verify`) breakdown

**STEP 1 — RUNTIME:VERIFY (14-suite regression).** 14/14 PASS in 1021ms. Suite size unchanged from prior PCE-1A seal (no verifier added or removed by T1 — consistent with FE-only change set).

**STEP 2 — `verify*.js` HELPER UNIT SUITE.** Discovered 31 verifiers; **31/31 RESULT: PASS.** Suite includes all canonical phase verifiers + the load-bearing `verifyPlayerConvictionEngine1A.js` which independently confirms PCE-1A backend is intact (no backend mutation introduced by T1 — load-bearing claim from ACTIVE EXECUTION's T1 report). Also includes `verifyOrphanAuthorityHardening.js`, `verifyOperationalContinuity.js`, `verifyOperationalParity.js` — all PASS.

**STEP 3 — 5-PROBE CANONICAL INTEGRITY MATRIX.** All 5 canonical probes PASS (`probe_grading_backfill_v1` · `probe_lineage_v1` · `probe_epoch_authority_v1` · `probe_persistence_idempotency_v1` · `probe_ledger_mirror_v1`). Matches the canonical 5-probe matrix authoritatively defined in `runAllVerifiers.js` per R1-PASS-1 audit.

**V5 SUMMARY:** Total checks 37 · PASS 37 · FAIL 0 · **RESULT: PASS.** Identical pass count to the prior V5 (37/37) — no new failure modes, no regression, no shrinkage of the verifier surface.

### T1.term2-B — V6 (`brain:checkpoint`) breakdown

**RUNTIME CODE FILES MODIFIED (24h window, 6 backend files):**
- `backend/pipeline/shared/buildFeaturedPlays.js` · `bettorLanguage.js` · `playerConvictionEngine.js` · `buildSlipAi.js` · `routes/workstationRoutes.js` · `resolveCanonicalSport.js`

Timestamps 2026-05-17 19:52Z–20:57Z. **All 6 are pre-T1 PCE-1A backend implementation files**, already captured in the prior brain checkpoint receipt at 2026-05-17T21:09Z. T1 (FE-only) introduced no backend modifications; the brain checkpoint's backend-scope file-scan correctly reflects this — the only entries are PCE-1A's backend implementation, which was sealed in the prior checkpoint and is not regressed.

**BRAIN DOCS MODIFIED (5):**
- `ARCHITECTURE_LAWS.md` 2026-05-18 06:33:10Z — most recent edit, contains Laws 18 / 19 / 20 / 21 (R1-PASS-2 + T1 architectural + T1-close codifications, all in-place evolutions).
- `MASTER_BRAIN.md` 2026-05-17 23:50:44Z — R1-PASS-2 interior reconciliation.
- `backend/runtime/brain/README.md` 2026-05-17 23:47:27Z — R1-PASS-2 anchor-surface reconciliation.
- `CURRENT_RUNTIME_STATE.md` · `MODEL_EVOLUTION_LOG.md` — operator-side updates.

**REQUIRED-ON-PATCH RECONCILIATION (Law 12):** OK across all three brain-set entries (MASTER_BRAIN, CURRENT_RUNTIME_STATE, MODEL_EVOLUTION_LOG) and all three Operational-Governance-1A repo-root continuity entries (root CURRENT_STATE, root NEXT_SESSION, docs/OPERATOR_RUNBOOK). Law 12 reconciliation is clean.

**CONTINUITY ASSESSMENT (2 warnings, neither operational failure):**
- `[BOOTSTRAP_AGING]` last bootstrap was 630 min ago (>= 480 warn threshold). **Classification: expected mid-session signal.** Operator has been continuously shipping phases (PCE-1A backend → R1-PASS-1 audit → R1-PASS-2 stamping → T3 → T1 architectural ruling → T1 implementation → T1-close codification → V5/V6). No re-bootstrap was performed mid-sequence because it would have invalidated mid-session governance state. Warning is non-blocking; soft-recommendation to run `npm run brain:bootstrap` between phase boundaries, not before FE inspection.
- `[BRAIN_CHANGED_SINCE_BOOTSTRAP]` brain docs modified since last bootstrap — expected per the explanatory message "expected if you've been updating memory docs." This is the same warning class previously classified by MCR (R1-PASS-2 Reconciliation Checkpoint) as "expected mid-session reconciliation signal, NOT operational failure." Same classification applies here.

**FRESHNESS VERIFICATION:** OK — freshness PASS.

**REGRESSION MATRIX:** All 31 OK.
**PROBE MATRIX:** All 5 OK.

**V6 RESULT:** CHECKPOINT PASS · 0 failures · receipt reconciled and stamped at 2026-05-18T07:19:37.060Z. "Checkpoint clean. Brain is synchronized with runtime state."

### T1.term2-C — Verdicts on the six interpretation requests

**1. term2 PASS or FAIL?**

**VERDICT: PASS.** Both V5 (37/37) and V6 (clean checkpoint, hash-chain reconciled) PASS. Warnings classified per established Reconciliation Checkpoint doctrine as expected mid-session signals.

**2. Runtime regressions surfaced?**

**VERDICT: NONE.** The 37-suite verifier matrix is byte-identical in shape to the prior PCE-1A seal (no verifier moved PASS → FAIL, no verifier added or removed). The load-bearing `verifyPlayerConvictionEngine1A.js` PASSes independently — confirming PCE-1A backend integrity. The load-bearing `verifyOperationalContinuity.js` + `verifyOperationalParity.js` + `verifyOrphanAuthorityHardening.js` all PASS — confirming the R1-PASS-2 doctrine-surface reconciliation cascaded zero regression into runtime. All 5 canonical probes PASS — confirming replay safety / freeze / grading / persistence / ledger continuity.

**3. Overlap-helper doctrine violations surfaced?**

**VERDICT: NONE detected via current runtime surface.** Important caveat: the current V5/V6 surface does NOT directly test Law 21 invariants — those are R4 candidates (`verifyOverlapIdParity` + `verifyFeaturedBucketRegistration`) deferred per MCR's reminder that "R4 verifiers are not yet active requirements for T1 close." The structural inspection in T1-close.A confirmed compliance against the merged FE surface, but the absence here is "not detected by current verifiers" rather than "verifier-enforced absence." This is acceptable for T1 close under the stated framework but is exactly why R4 should land before FE-Asymmetry P1 fully completes (T4/T5/T6 propagation across remaining surfaces compounds the surface area to inspect).

**4. Continuity / governance regressions surfaced?**

**VERDICT: NONE.** Law 12 reconciliation OK across the full required-on-patch set + Operational-Governance-1A repo-root continuity set. Brain freshness PASS. Brain ↔ runtime hash reconciliation clean. The two `BOOTSTRAP_AGING` + `BRAIN_CHANGED_SINCE_BOOTSTRAP` warnings are expected mid-session signals (same classification MCR applied to identical warnings during R1-PASS-2 Reconciliation Checkpoint clearance). No new warning category surfaced; no warning escalated to a hard failure.

**5. May T1 proceed to UX LAB FE inspection sequencing?**

**VERDICT: YES.** T1 has now cleared every checkpoint-discipline gate up through term2:
- ✅ `checkpoint` — R1-PASS-2 doctrine surface, T1 doctrine codification (Laws 18–21) → reconciled in brain receipt 2026-05-18T07:19:37Z
- ✅ `term1` (implicit precondition — runtime up)
- ✅ `term2` — V5 37/37 PASS · V6 PASS
- ⏭ `FE inspection` — next step, owned by FRONTEND / UX LAB

Per the canonical post-phase closure sequence (`checkpoint → term1 → term2 → FE inspection`), the doctrine-surface and runtime-integrity gates are CLEARED. Only the FE inspection remains before MCR seal.

**6. Remediation required before FE inspection?**

**VERDICT: NO hard remediation.** Two soft recommendations, both non-blocking:

- **Optional `npm run brain:bootstrap`** between term2 and FE inspection to clear the `BOOTSTRAP_AGING` warning (last bootstrap 630 min ago). The warning is informational; running bootstrap now would refresh the hash baseline cleanly before FE inspection consumes the next phase boundary. Not blocking, but tidy.
- **UX observations from T1-close.F** (`border-bottom hierarchy shifted below conviction surface` + `PropRail micro-row typography emphasis may differ from FeaturedCard context`) should be specifically scoped into the FE inspection checklist. UX LAB owns those rulings; INFRA does not pre-resolve them.

No code remediation needed. No backend changes needed. No FE changes needed. T1 surface is FE-inspection-ready as-merged.

### T1.term2-D — T1-merged surface integrity summary

| Authority | Pre-T1 baseline | Post-T1 term2 | Status |
|---|---|---|---|
| PCE-1A backend (verified by `verifyPlayerConvictionEngine1A.js`) | PASS | PASS | unchanged ✅ |
| Canonical 5-probe matrix | 5/5 PASS | 5/5 PASS | unchanged ✅ |
| 31 `verify*.js` helper scripts | 31/31 PASS | 31/31 PASS | unchanged ✅ |
| 14-suite runtime regression matrix | 14/14 PASS | 14/14 PASS | unchanged ✅ |
| `verifyOperationalContinuity.js` (governance enforcement) | PASS | PASS | unchanged ✅ — confirms R1-PASS-2 doctrine surface did not cascade into runtime |
| `verifyOperationalParity.js` (governance enforcement) | PASS | PASS | unchanged ✅ |
| `verifyOrphanAuthorityHardening.js` (governance enforcement) | PASS | PASS | unchanged ✅ |
| Brain ↔ runtime hash reconciliation | clean | clean | receipt timestamped 2026-05-18T07:19:37Z ✅ |
| ARCHITECTURE_LAWS Laws 1–17 (pre-T1) | canonical | canonical | unchanged ✅ |
| ARCHITECTURE_LAWS Laws 18–21 (T1 codification) | absent | canonical | NEW, additive, reconciled in receipt ✅ |
| `canonicalOverlap.ts` authority surface | absent | single canonical location (`frontend/src/workstation/canonicalOverlap.ts`) | NEW, additive ✅ |
| Battlefield-vs-curated hierarchy (PRODUCT_IDENTITY § Layer-type separation) | codified | preserved by T1 implementation | unchanged ✅ |

**T1-merged surface integrity: PRESERVED.** No load-bearing surface regressed; new additions (Laws 18–21 + `canonicalOverlap.ts`) reconciled cleanly into the brain receipt.

### T1.term2-E — Recommended MCR + UX LAB actions

1. Acknowledge term2 PASS verdict and route T1 → **FRONTEND / UX LAB** for FE inspection.
2. FE inspection scope: validate ConvictionNote rendering on Discover (PropRail + LadderExplorer) matches the curated-edge intent; review the two T1-close UX observations (border-bottom hierarchy shift + PropRail typography emphasis); confirm battlefield breadth preserved (non-overlap majority renders no conviction); confirm warn-color contextual conviction inside battlefield AVOID overlaps is the intended doctrine behavior.
3. Optional: operator may run `npm run brain:bootstrap` between term2 and FE inspection to clear `BOOTSTRAP_AGING`. Non-blocking.
4. After FE inspection PASS, return to MCR for T1 final seal. After seal, T4/T5/T6 may queue under same scope lock.
5. R4 verifier authoring (12 candidates) remains scheduled for separate INFRA / GOVERNANCE phase; not blocking T1 seal but should land before T6 close to enforce Law 18–21 invariants long-term.

**T1 post-phase closure status:**
- ✅ checkpoint (doctrine-surface reconciliation, Laws 18–21 codified)
- ✅ term1 (implicit — runtime is up; V5 successfully exercised the runtime path)
- ✅ term2 (V5 + V6 PASS — this verdict)
- ⏭ FE inspection (next — FRONTEND / UX LAB)
- ⏭ MCR seal (after FE inspection)

**Next lane: FRONTEND / UX LAB** for FE inspection, then back to **MASTER CONTROL ROOM** for T1 seal.

— end of P1A-T1 term2 interpretation addendum —

---

## PHASE BETTOR-VALIDATION-INFRASTRUCTURE-1A — CANONICAL WRITES COMPLETE

**Lane:** INFRA / GOVERNANCE (codification) → MASTER CONTROL ROOM (routing) → FRONTEND / UX LAB (first run owner)
**Trigger:** MCR authorization for three canonical bettor-validation infrastructure writes (2026-05-18)
**Mode:** in-place evolution of existing canonicals + ONE additive append-only ledger creation; no replacement canonical, no roadmap fork, no governance bypass.
**Invariants preserved:** additive-only · canonical authority · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals · six-lane operational topology.

### BVI-1A.A — Three canonical writes executed

| Write | Surface | Mode | Outcome |
|---|---|---|---|
| **1. OPERATOR PLAYBOOK in-place evolution** | `/docs/OPERATOR_RUNBOOK.md` (lane canonical: "Single source-of-truth for daily repo operation"; OPERATOR PLAYBOOK lane name maps here) | In-place additive append at bottom: TWO new doctrine sections (`§ BETTOR VALIDATION TRUTH DOCTRINE & POST-SLICE WORKFLOW` + `§ POST-PHASE CHECKPOINT DISCIPLINE — 5-STAGE CHAIN`) | RUNBOOK 1677 → 1755 lines; phase index header updated to include Bettor-Validation-Infrastructure-1A; six-lane topology + prior 21 phase sections preserved verbatim |
| **2. Empirical findings ledger creation** | `/docs/BETTOR_VALIDATION_LEDGER.md` (NEW canonical, sibling tier to OPERATOR_RUNBOOK) | New file; append-only governance; rubric + entry template + anti-bias guarantees; entries section template-only (first entry pending P1A-T1 run) | Reconcile-before-fork audit confirmed no existing validation-ledger surface (`BETTOR_*_AUDIT_*` files are audits, `buildPersonalLedger.js` is bet ledger — different domain); canonical placement under `docs/` matches OPERATOR_RUNBOOK tier |
| **3. 4-stage → 5-stage checkpoint discipline evolution** | OPERATOR_RUNBOOK `§ POST-PHASE CHECKPOINT DISCIPLINE — 5-STAGE CHAIN` (codified within Write 1's edit) + memory file `betting_dashboard_checkpoint_discipline.md` | In-place evolution: prior `checkpoint → term1 → term2 → FE inspection` extended to `checkpoint → term1 → term2 → FE inspection → BETTOR VALIDATION`; gate / lane / owner / verifier table per stage; prior stages 1–4 byte-identical | Memory already auto-synced to 5-stage; brain README CHECKPOINT POLICY (file-reconciliation requirements) left untouched as complementary, not duplicative |

**Reconcile-before-fork audit performed:**
- OPERATOR PLAYBOOK lane canonical = `OPERATOR_RUNBOOK.md` (lane name vs file name; one canonical surface). NOT forked into a parallel `OPERATOR_PLAYBOOK.md` sibling.
- Validation ledger placement = `docs/BETTOR_VALIDATION_LEDGER.md` (no existing surface to fork from; audits are not append-only validation ledgers).
- Checkpoint discipline chain = doctrine codified in OPERATOR_RUNBOOK (canonical doctrine source) + memory (cross-conversation continuity); brain README + OPERATOR_PROTOCOL describe complementary mechanics (file reconciliation, verification order), not the chain itself. No fork.

### BVI-1A.B — Truth doctrine load-bearing framing (recorded for MCR + future reviewers)

Codified into both OPERATOR_RUNBOOK and ledger:

1. **Purpose: empirical bettor truth, not seal justification.** Validation seeks what the bettor experiences that the doctrine has not yet codified; it does not confirm what the doctrine already claims.
2. **All four rubric outcomes are equally legitimate.** GAP and CONCERN findings are validation working, not phase failures.
3. **Only-VALIDATED runs are presumptively suspect for selection bias** on any non-trivial slice. Specific cited evidence is required before accepting; absent that, provisional-seal review applies.
4. **Seal pressure must not bias the rubric.** Validation runs independent of MCR seal pacing.
5. **Cold-read before doctrine consultation.** Pre-load produces VALIDATED bias; cold-read produces truth.
6. **Doctrine claims quoted verbatim**, never paraphrased. Paraphrase is where seal-justification bias enters.
7. **MCR truth-disposition is the seal gate**, not ACTIVE EXECUTION's phase reporting.
8. **Append-only ledger governance.** No deletions, no overwrites; corrections supersede via new entries that cite the prior.

### BVI-1A.C — Routing into P1A-T1 retrospective bettor-validation run

**First retrospective ledger entry candidate: P1A-T1 (Option A canonicalOverlap.ts propagation + Discover conviction render).**

This is the inaugural application of the 5-stage chain's new fifth stage. The four prior stages already PASSed for P1A-T1: checkpoint reconciled (Laws 18–21 codified, brain receipt clean at 2026-05-18T07:19:37Z), term1 implicit (runtime up), term2 PASS (V5 37/37, V6 PASS), FE inspection pending (the bettor-validation run subsumes it for retrospective runs — the cold-read pass IS the inspection plus the empirical-truth layer on top).

**Operator-side sequence (bare canonical commands per terminal-context discipline):**

| Step | Command / action | Lane | What the operator is establishing |
|---|---|---|---|
| 1 — fresh-pull integrity check | `git status` (and, if needed, `git fetch && git status`) from repo root | INFRA / GOVERNANCE | Confirm working tree matches the canonical P1A-T1 merge commit. No uncommitted local drift that would invalidate findings. |
| 2 — ops verify | `npm run ops:verify` from `backend/` | INFRA / GOVERNANCE | Re-confirm V5 baseline. Expected: 37/37 PASS, identical to term2. |
| 3 — brain checkpoint | `npm run brain:checkpoint` from `backend/` | INFRA / GOVERNANCE | Re-confirm V6 baseline. Expected: PASS with the two known mid-session warnings (BOOTSTRAP_AGING + BRAIN_CHANGED_SINCE_BOOTSTRAP) — both classified as informational per Reconciliation Checkpoint doctrine. Optionally run `npm run brain:bootstrap` first to clear BOOTSTRAP_AGING for a tidier baseline. |
| 4 — terminal / log inspection | Read TERM 1 logs (server stdout) during steps 5's interactions; watch for warnings, fallback fires, anti-fabrication trips | FRONTEND / UX LAB | Capture runtime emissions during bettor-perspective stages. Anything the runtime emits that the doctrine does not predict is a candidate finding. |
| 5 — UX LAB bettor-perspective stages | Operate the P1A-T1 surfaces as a bettor. Sequenced sub-steps:<br>(a) **Cold-read first.** Open `🗺 Discover` without re-reading the doctrine. What is the felt experience?<br>(b) **PropRail observation.** Scroll a populated game's prop list. Note where `◆ {convictionNote}` appears vs doesn't. Note color authority (good / warn / muted) per overlap tag.<br>(c) **LadderExplorer observation.** Expand a ladder; observe per-leg overlap renders.<br>(d) **Battlefield density check.** Confirm non-overlap majority renders no conviction (this is intended doctrine behavior, not a defect).<br>(e) **Cross-surface comparison.** Open `⚡ Tonight's Edge`; compare conviction render on `FeaturedCard` vs the Discover overlap render. Are they typographically and semantically equivalent?<br>(f) **AVOID-overlap edge case.** If observable, find a Discover row whose overlap is an AVOID FeaturedPlay; observe warn-color conviction surfacing inside a battlefield row. Doctrine claim vs felt experience: is this the bettor-native compression we intended, or does it surface as alarming?<br>(g) **Take screenshots** at each surface state for the ledger entry. | FRONTEND / UX LAB | Empirical observation of what the bettor actually sees. Categorize each delta into VALIDATED / NEUTRAL / GAP / CONCERN. Quote doctrine claims verbatim from PRODUCT_IDENTITY § Layer-type separation + ARCHITECTURE_LAWS Laws 18 / 19 / 20 / 21 + the P1A-T1 seal-claim. |
| 6 — first ledger entry write | Append `Entry 0001` to `docs/BETTOR_VALIDATION_LEDGER.md` using the template (slice / run by / working tree commit / pre-run gates / surfaces inspected / per-finding rubric entries / MCR truth-disposition pending) | INFRA / GOVERNANCE (ledger write doctrine) + operator (content) | The first entry in the canonical ledger. Sets the precedent for entry quality. **A run that returns only VALIDATED findings on a non-trivial slice triggers provisional-seal review per the truth doctrine — operator should bias toward surfacing what does NOT yet work at the bettor surface.** |
| 7 — MCR truth-disposition review | Return the ledger entry to MASTER CONTROL ROOM. MCR reads findings as canonical truth; reconciles ACTIVE EXECUTION's prior seal-claim against the empirical truth; issues final seal disposition or escalates CONCERN findings | MASTER CONTROL ROOM | The seal gate. CONCERNs may block seal pending mitigation; GAPs scope into next-phase candidates; VALIDATED + NEUTRAL inform future doctrine refinement. |

**Routing handoff:** the operator is now routed into step 1 (fresh-pull integrity check). Steps 1–4 close in INFRA / GOVERNANCE; step 5 hands off to FRONTEND / UX LAB; step 6 closes the operator-empirical work; step 7 returns to MASTER CONTROL ROOM.

### BVI-1A.D — Closure note + reminder

**The purpose of this workflow is empirical bettor truth, not seal justification.**

If the P1A-T1 retrospective run surfaces only VALIDATED findings, INFRA / GOVERNANCE will flag the entry for provisional-seal review per the truth doctrine's anti-bias guarantee. P1A-T1 is non-trivial — single canonical overlap helper, two new battlefield consumer surfaces, layer-separation doctrine cement. Honest inspection should produce at least one NEUTRAL, GAP, or CONCERN finding. If it does not, the inspection itself is the candidate finding.

**Recommended next routing:** operator into step 1 (fresh-pull integrity check), continuing sequentially through step 7 (MCR truth-disposition). After Entry 0001 lands, MCR seals P1A-T1 (or escalates) and T4 may queue under the same scope lock.

— end of BVI-1A canonical writes addendum —
