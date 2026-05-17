# GPT RECONSTRUCTION BOOTSTRAP
**Single portable artifact. Upload or paste this ONE file into a fresh GPT chat to reconstruct full operating state.**
**Last regenerated: 2026-05-17 at Continuity-OS-1B seal.**

---

## ⚠️ READ THIS FIRST — INSTRUCTIONS FOR A FRESH GPT CHAT

You are picking up an in-progress betting-intelligence repo at **`/Users/andrewmoore/Desktop/betting-dashboard`**. This file consolidates the operating state. You must follow these rules immediately:

1. **DO NOT rediscover architecture.** Architecture is settled across 25 shipped phases. Use what you read here.
2. **DO NOT re-solve solved problems.** § 4 lists 28 SOLVED items linked to phases.
3. **DO NOT propose forbidden directions.** § 5 enumerates 12 cemented forbidden directions; proposing any will be rejected.
4. **DO NOT rewrite backend or FE architecture.** Additive-only doctrine. Existing logic preserved verbatim.
5. **DO NOT fabricate intelligence.** Anti-fabrication doctrine: every visible value must trace to a canonical backend field.
6. **DO follow audit-first.** Trace the real code path before patching. Never patch without operator lever approval.
7. **DO update anchor files post-ship.** See § 7 for the anchor-file reconciliation ritual.
8. **DO update THIS file at every phase seal.** This file is part of the mandatory checkpoint reconciliation (§ 7); brain:checkpoint will fail if it drifts.

If anything in this file contradicts what you think you know, **the file is canonical** (or surface the conflict to the operator — never silently override).

---

## § 1 — REPO IDENTITY

### One-line identity
> **A deterministic, anti-fabrication-disciplined, bettor-native intelligent betting operating system for MLB + NBA.**

### The four canonical words
| Word | Meaning |
|---|---|
| **Deterministic** | Every conclusion traces to canonical signals. Replay-safe. Auditable. Same input → same output. |
| **Anti-fabrication** | Never invents probabilities, narratives, star scores, or confidence. Every visible string traces to a canonical backend field. |
| **Bettor-native** | Speaks the bettor's language at the FE. The customer is the operator at the workstation. |
| **Operating system** | Not a model. Not a slip generator. A system that takes raw markets + canonical context + bettor inputs and produces deterministic operator-readable intelligence. |

### Three-layer architecture (cemented since BNDS-1B)
| Layer | Surface | Pool | Purpose |
|---|---|---|---|
| **Layer 1 — Battlefield** | `🗺 Discover` tab | `state.discoveryCandidates` (broad canonical pool) | "Show me what's available across every game." Abundance first. |
| **Layer 2 — Curated Edge** | `⚡ Tonight's Edge` + spotlight grids | `state.featured` + `state.candidates` (tight elite caps) | "Show me the strongest survivors." Curation second. |
| **Layer 3 — Compression** | `🎲 AI Parlays` + `📸 Check My Slip` | `state.aiSlips` + canonical VBI verdict | "Show me a parlay" / "tell me about this slip." Compression third. |

These are **distinct products inside the same workstation**. Never collapse into a single surface.

### What the repo IS
- Intelligence-driven MLB/NBA betting workstation
- Single operator (the bettor at the workstation)
- Advisory (not executor — does not place bets)
- Single-page React FE + Node/Express backend + JSON cache + SQLite memory
- Deterministic / canonical-authority-first / additive-only across 25 phases

### What the repo IS NOT
- Not a public-facing bettor end-user product
- Not multi-tenant SaaS
- Not an auto-bet executor
- Not a sportsbook integration
- Not an LLM / vision / ML product
- Not a mobile-first product (today)
- Not in-play / live-game adjustments (today)
- Not NFL/NHL/soccer (today)

### Sport surfaces
- **MLB** — production-deep (BC-1A realism + OE-1A/1B offensive ecology + MLB-COV-1A covariance + VBI-1A verdict resolver all canonical). Default sport.
- **NBA** — production-stable (`nbaCorrelationEngine` + `playerStatus` filter + `nbaAvailabilityCache`). NBA-specific ecology audit DEFERRED (must NOT clone MLB shape — needs separate pace/usage/depth audit).

### Operational cadence
- 25 phases shipped. Every phase: audit → operator lever approval → ship → helper unit → 14-suite regression + 5-probe matrix → 6-doc reconciliation → anchor-file reconciliation → brain:checkpoint sealed.
- 26 verify*.js scripts. 14 runtime verifiers. 5 canonical integrity probes (158 assertions).

---

## § 2 — CURRENT ACTIVE PHASE

| Field | Value |
|---|---|
| **Phase name** | Continuity-OS-1B (COS-1B) |
| **Phase number** | 26th approved phase |
| **Status** | SHIPPED + SEALED 2026-05-17 |
| **Type** | Infrastructure — portable single-file cross-chat reconstruction |
| **Bottleneck solved** | COS-1A shipped 6 anchor files (~775 lines) but fresh GPT chats still can't practically consume 6+ files per session. This phase consolidates them into ONE portable file optimized for upload-and-continue. |

### Approved levers (COS-1B scope, all shipped)
- Create `GPT_RECONSTRUCTION_BOOTSTRAP.md` (this file) — single portable reconstruction artifact (~800 lines).
- Wire it into the anchor-file reconciliation ritual (mandatory regeneration on every phase seal).
- Add it to `BOOTSTRAP_PROMPT.md` as the "ONE FILE" entry path for fresh GPT chats.
- New `verifyContinuityOs1B.js` (sync with active phase + bottlenecks + operational flow + forbidden directions; line-budget enforced).

### Deferred levers
None — operator approved full single-file consolidation scope.

### DO NOT TOUCH (operator-cemented, all 25 prior phases)
- ❌ Backend scoring redesign / ecology expansion / calibration changes
- ❌ Grading / settlement / replay / lineage / persistence pipelines
- ❌ FE component logic
- ❌ Anti-fabrication invariants
- ❌ OCR / tesseract / multer / formidable / vision APIs / LLM parsing / adaptive AI styling

### Current FE direction
| Surface | State | Pool |
|---|---|---|
| `🗺 Discover` | Layer 1 Battlefield | `state.discoveryCandidates` (broad canonical pool, ~85 MLB / ~40 NBA real-data) |
| `⚡ Tonight's Edge` (Dashboard) | Layer 2 Curated Edge | `state.featured` (elite curation) |
| `📸 Check My Slip` (AnalyzeSlipView) | Layer 3 Compression | `/api/ws/screenshots/ingest` canonical VBI verdict |
| `🎲 AI Parlays` (AiSlipsView) | Layer 3 Compression | `state.aiSlips` |
| All other tabs | Unchanged | Elite `state.candidates` |

### Current backend doctrine
- All FE surfaces consume `/api/ws/state` (single canonical entry-point).
- Discovery pool: same canonical source + same scoring helper + looser caps (`maxPerPlayer:8 / maxPerGame:60 / maxPerStat:60 / maxPerStatSide:35`).
- Elite pool: tight caps (`maxPerPlayer:3 / maxPerGame:7-12 / maxPerStat:10 / maxPerStatSide:6`). Portfolio / featured / aiSlips unchanged.
- ALL props canonical-validated (`eligibleBets` filter: `edge>0.04 + modelProb>0.20`).
- ALL anti-fabrication doctrine cemented across 25 phases preserved.

---

## § 3 — CURRENT PRODUCT STATE

### ✅ WORKING (production-stable, do not modify)
| System | Status |
|---|---|
| Grading + settlement | Production-stable (Settlement-1A + Settlement-Ingestion-Window-1A rolling window) |
| Calibration honesty | Production-stable (Grading-Calibration-Operations-1D) |
| Operational governance | Production-stable (Operational-Governance-1A — 6-doc enforcement + 158-assertion probe matrix at every checkpoint) |
| MLB covariance suppression | MLB-COV-1A: shared-game UNDER + pitcher-K vs hitter conflict hard-blocked at `canAddLeg` |
| Market-supported disagreement gate | EXPL-1 consensus-support gate (≥3 books + ≥0.6 consensusConfidence) |
| Availability hard-filter | EXPL-4 (`playerStatus === "out"` hard-rejected) |
| Screenshot intelligence engine | VBI-1A: `resolveSlipLegToPrediction` + `buildSlipAnalysis.analyzeSlip` + canonical 12-field verdict shape + bettorLanguage 14-id phrase library |
| Bettor-curation realism | BC-1A: playerLegitimacyFactor (7% composite) + believable-upside bucket + bettorRealismScore |
| Offensive ecology awareness | OE-1A: offensivePressureIndex + hrCarryEnvironment + correlatedRunProduction + explosiveEnvironmentTag + explosive-upside bucket + ladderSurvivabilityFactor |
| Offensive ecology reinforcement | OE-1B: stackReinforcementScore + combineLegs joint-prob adjustment + lineupTurnoverPotential + bullpenFragilityContext |
| Recommendation ladder | 9 fixed-cardinality slots (Recommendation-Hierarchy-1A + BC-6 slot 8 + OE-7 slot 9) |
| FE bridge to backend canonical fields | BNSB-1A: every canonical field now has a FE consumer (realism pill + reinforcement ladder + bettorLanguage chips + recommendation ladder slots 8+9) |
| FE bettor-native interaction architecture | BNSB-1B: PathPicker landing + Borrow/Paste/Sample paths + VerdictCard hero re-shape + Analyze-this cross-section affordance + bettor-native tone |
| FE game-first discovery surface | BNDS-1A: GameCard + PropRails + LadderExplorer + 8 discovery lenses + composeExplosiveSentence + ScreenshotIntake foundation |
| FE discovery pool breadth | BNDS-1B: `discoveryCandidates` field on `/state` payload — MLB +166% / NBA +233% wider than elite path |
| Cross-chat reconstruction system | COS-1A: 6 anchor files at repo root (~775 lines) + verifyContinuityOs1A asserts canonical sections + cross-references + size discipline |
| Portable cross-chat reconstruction | COS-1B (this phase): single GPT-optimized portable artifact (this file) |

### ⚠️ WEAK (active bottlenecks — candidates for next phase)
| Area | Notes |
|---|---|
| **Slip emotional compression** | BNSB-1B reinforcement ladder + bettorLanguage chips are correct but per-factor chip dump doesn't yet feel "holy shit." Needs narrative compression (1-2 deterministic sentences). |
| **Per-event game-hub depth** | GameCard could expose pitcher matchup / lineup / weather hover-cards (canonical fields already on candidates). |
| **Portfolio bettor-language** | Risk Map concentration warnings read operator-shaped (`"high_correlation:script_risk_high:scriptCluster_NYY_BOS_3legs"`); needs bettor-native translation. |
| **Diagnostics CLI invisibility** | `grading:status` / `calibration:status` / `lineage:status` show rich state but never reach the FE. |
| **Survivability-weighted discovery sort** | Discover lenses sort by avgImpliedTeamTotal but never by `ladderSurvivabilityFactor` or `bettorRealismScore`. |

### ❌ EXPLICITLY ABSENT (operator-deferred indefinitely — see § 5 + § 8)
| Missing system | Why absent |
|---|---|
| OCR / image-upload parsing | Operator-deferred indefinitely. Foundation shipped (BNDS-1A-7); pipeline never to be built unless explicit lever approved. |
| LLM / GPT narration | Cemented forbidden (anti-fabrication violation). |
| Vision APIs / tesseract / multer / formidable | Cemented forbidden on FE upload path. |
| Auto-bet placement / sportsbook API integration | Out of scope (advisory, not executor). |
| Mobile redesign | Operator-deferred. |
| NBA-parity ecology | Requires NBA-specific audit (NOT MLB clone). |
| Longitudinal adaptive calibration | Requires per-bucket ROI surface first. |

---

## § 4 — CURRENT BOTTLENECKS (live tracker)

**Status legend:** 🟢 SOLVED · 🟡 ACTIVE · 🔵 DEFERRED · 🔴 DANGEROUS · ⚪ FUTURE

### 🟡 ACTIVE (candidates for next phase — operator picks one)
| # | Problem | Notes |
|---|---|---|
| A-1 | Slips still emotionally weak | Needs 1-2-sentence narrative composed deterministically from canonical signals (NOT LLM). |
| A-2 | Game hub depth thin on small slates | Add PitcherMatchup / Lineup / Weather hover cards inside expanded GameCard. Canonical fields only. |
| A-3 | Portfolio concentration warnings unclear | Translate operator-shaped labels to bettor-spoken sentences. |
| A-4 | Bookkeeping CLI invisible to FE | NEW Diagnostics tab consuming a `/api/ws/diagnostics` aggregator. |
| A-5 | Discovery sort options miss survivability | Add lens "By survivability" sorting GameEcosystem by aggregated `ladderSurvivabilityFactor`. |

### 🟢 SOLVED (do not re-solve — linked phase listed)
| # | Problem | Resolved by |
|---|---|---|
| S-1 | Recommendation ladder rendered 7 slots, BC-6 + OE-7 added 8 + 9 but FE dropped them | BNSB-1A (BNSB-1) |
| S-2 | bettorRealismScore (BC-8) computed but invisible | BNSB-1A (BNSB-2 + BNSB-4) |
| S-3 | `oe11ReinforcementBoost` / `calibratedCombinedModelProb` / `rawCombinedModelProb` dropped at route boundary | BNSB-1A (backend payload propagation) |
| S-4 | Screenshot ingest had no FE consumer | BNSB-1A (BNSB-6 AnalyzeSlipView + VerdictCard) |
| S-5 | AnalyzeSlipView was a JSON textarea dev tool | BNSB-1B (BNSB-1B-1 PathPicker) |
| S-6 | Fabricated `{rawText: raw}` payload | BNSB-1B (BNSB-1B-2 — removed) |
| S-7 | Internal `ss_*` hashes + archetype taxonomy leaking | BNSB-1B (BNSB-1B-9 stripped) |
| S-8 | VerdictCard was flat 12-section encyclopedia | BNSB-1B (BNSB-1B-6 hero re-shape) |
| S-9 | Dashboard IntelligenceStrip was 13-chip counter dump | BNSB-1B (BNSB-1B-7 sentence + collapsible) |
| S-10 | No cross-section "Analyze this" affordance | BNSB-1B (BNSB-1B-8 ws:analyze-slip CustomEvent) |
| S-11 | FE had no game-first discovery surface | BNDS-1A (Discover tab + GameCard + PropRails + LadderExplorer) |
| S-12 | No `composeExplosiveSentence` env compression | BNDS-1A (BNDS-1A-4) |
| S-13 | No `ScreenshotIntake` foundation | BNDS-1A (BNDS-1A-7 — honest foundation, no OCR) |
| S-14 | FE Discover narrow canonical pool | BNDS-1B (additive `discoveryCandidates`, +166% MLB / +233% NBA) |
| S-15 | New chats drift catastrophically (15000-line reconstruction surface) | COS-1A (6 anchor files at ~775 lines) |
| S-16 | Fresh GPT chats can't consume 6+ files per session | COS-1B (this file — single portable artifact) |
| S-17 | MLB pitcher-K + opposing hitter contradiction unblocked | MLB-COV-1A (MLB-COV-3) |
| S-18 | Same-game UNDER stack unblocked | MLB-COV-1A (MLB-COV-2) |
| S-19 | Screenshot intelligence engine disconnected from canonical resolvers | VBI-1A (VBI-2/3/4/6/8) |
| S-20 | Backup-tier hitters out-promoted top-of-order stars | BC-1A (BC-2 playerLegitimacyFactor + BC-1 field lift) |
| S-21 | Hostile parks didn't soft-demote believable upside | BC-1A (BC-4) |
| S-22 | Explosive offensive environments had no positive boost | OE-1A (OE-2/3/4/5/6/7/8) |
| S-23 | Same-team hitter-OVER pairs scored independent in combineLegs | OE-1B (OE-11 stackReinforcementScore) |
| S-24 | Single-book outliers surfaced symmetrically with multi-book consensus | EXPL-1A (EXPL-1 gate) |
| S-25 | OUT-player props surfaced silently | EXPL-1A (EXPL-4 hard-filter) |
| S-26 | brain:checkpoint didn't enforce operator-facing docs | Operational-Governance-1A (GOV-1 + GOV-3) |
| S-27 | NBA snapshot supplement starved on nights without nightly run | Snapshot-Authority-1A (FIX Q1) |
| S-28 | Settlement window stuck at todayKey() | Settlement-Ingestion-Window-1A (AUTO-3 rolling window) |

### 🔵 DEFERRED (see § 8 for full why-deferred map)
- D-1: OCR / image-upload parsing (operator-deferred indefinitely)
- D-2: NBA-parity ecology (NBA-specific audit required)
- D-3: Longitudinal adaptive calibration (per-bucket ROI surface required)
- D-4: Bullpen ingest activation (upstream populator required)
- D-5: OE-14 structural under-flip (observation window required)
- D-6: OE-15 buildBestOvers symmetry (validate OE-6 saturation first)
- D-7: BNSB-1B-5 build-leg-by-leg flow (current Build path routes to Bet Builder)
- D-8: BNSB-1B-11 NAV label re-tone (cosmetic only)
- D-9: Mobile-optimized layout
- D-10: Persisted slip history / re-analyze
- D-11: Cross-sport correlation engine extraction

### 🔴 DANGEROUS (see § 5)

### ⚪ FUTURE (acknowledged, not actively analyzed)
- F-1: First-pitch in-play overlays
- F-2: Live-game prop adjustments
- F-3: NFL / NHL / soccer expansion
- F-4: Multi-operator / shared workstation
- F-5: Mobile-first redesign
- F-6: Public-facing bettor end-user surface
- F-7: Persisted slip history / longitudinal verdict tracking

---

## § 5 — FORBIDDEN DIRECTIONS (cemented; do NOT propose)

These are operator-cemented forbidden directions. Proposing any of these will be rejected.

| # | Direction | Why forbidden |
|---|---|---|
| X-1 | **LLM / GPT narration** for any FE-visible string | Violates anti-fabrication invariant. `bettorLanguage` library is the canonical replacement. Every phrase must trace to a canonical signal id. |
| X-2 | **Celebrity / star-power weighting** | Fabricated value (BC + OE phase prompts explicitly forbid). |
| X-3 | **Dynamic sportsbook-behavior simulation** | Fabricated counter-models. |
| X-4 | **Adaptive payout shaping / fake SGP inflation** | MLB-COV / OE-11 explicitly forbid. Cap-and-stop is doctrine. |
| X-5 | **Recursive explosion logic** | Uncontrolled inflation; OE-11 per-pair cap 0.02 + aggregate cap 0.03 exist precisely to prevent this. |
| X-6 | **Hardcoded "tonight's lock" surface** | Hidden-value preservation forbids "always-promoted" paths. |
| X-7 | **Auto-bet placement / sportsbook API integration** | Out of scope (advisory, not executor). |
| X-8 | **Synthetic shadow predictions / fabricated calibration corpus** | Grading-Calibration-Operations-1D explicitly forbade. |
| X-9 | **Raw sportsbook flooding on any FE surface** | Anti-bypass discipline (BNDS-1B cemented). Every visible prop must originate from canonical-validated state. |
| X-10 | **Vision API / tesseract / multer / formidable / OCR pipeline** | Anti-fake-OCR doctrine (BNDS-1A cemented). The 📸 surface stages images in-memory only with honest "parsing pipeline not connected yet" copy. |
| X-11 | **Hard-filtering props upstream** (so the lens applies before rails render) | Soft-lens doctrine (BNDS-1A cemented). Lenses sort/filter game cards only; underlying prop breadth always available. |
| X-12 | **Adaptive AI styling** on VerdictCard / SlipCard | BNSB-1B explicitly forbade. |

**Additional cemented anti-patterns:**
- ❌ TikTok gambling hype copy ("LOCK" / "BOOM" / "guaranteed" / "🔒")
- ❌ Backend scoring redesign (any) — additive only
- ❌ Mutating existing canonical field semantics — additive new field only
- ❌ "While I'm in here" refactors — only fix verified root causes
- ❌ Removing current curated systems — Layer 2 + Layer 3 preserved verbatim
- ❌ Destabilizing grading / settlement — sealed pipelines, do not touch

---

## § 6 — CURRENT FE DIRECTION (critical)

### The current problem IS discovery architecture, NOT backend intelligence deficiency.

The backend ships 25 phases of canonical intelligence: realism + offensive ecology + reinforcement + covariance suppression + market-supported disagreement + availability filter + verdict resolver + bettorLanguage. None of that is the current bottleneck.

The current bottleneck is **how the FE exposes that intelligence to the bettor**:
- Layer 1 (Battlefield) — Discover tab now exists (BNDS-1A) and consumes broad canonical pool (BNDS-1B). Working — but per-event GameCard depth can be richer (A-2 active).
- Layer 2 (Curated Edge) — Tonight's Edge unchanged across recent phases. Stable.
- Layer 3 (Compression) — Check My Slip + AI Parlays are bridged (BNSB-1A/1B) but slip narrative compression is still weak (A-1 active).

### Game-first discovery doctrine (BNDS-1A cemented)
- Every game has an ecosystem under it (matchup + env + lineups + ladders) — not a flat list of isolated props.
- GameCard renders per-event ecology (matchup / start time / book count / prop counts / per-team implied totals / game total / HR-park/wind/carry env chips / explosive marker / book-disagreement marker / most-propped player strip).
- 19 expandable prop family rails (Hits / TB / HR / RBIs / Runs / Ks / Walks / Outs / Points / Rebounds / Assists / Threes / PRA / Blocks / Steals / FirstBasket / Alts / Specials / Other) inside expanded game card; collapsed-by-default + local search + sortable; NEVER hard-filtered upstream.
- LadderExplorer surfaces per-player ecosystem (legs across families + sides + survivability + ecology support + contradiction warnings). NOT prediction — pure relationship surfacing.

### Sportsbook-native abundance doctrine (BNDS-1B cemented)
- Discovery pool: same canonical source as elite (`supplementedCandidates`), same scoring helper (`diversifyCandidates`), looser caps (`maxPerPlayer:8 / maxPerGame:60 / maxPerStat:60 / maxPerStatSide:35`).
- Strict superset: every elite prop appears in discovery pool. Every discovery row traces to canonical eligible pool. Zero synthesized.
- Real measurements (2026-05-17): MLB 32 elite → 85 discovery (+166%); NBA 12 elite → 40 discovery (+233%).

### Bettor-native interaction doctrine (BNSB-1B cemented)
- AnalyzeSlipView opens with PathPicker (Build → Bet Builder / Borrow tonight's slip / Paste JSON / Try a sample).
- VerdictCard hero: CoherenceRing SVG + headline + biggest-takeaway phrase + HeroLegLine + SummaryChip row + collapsible 12-section forensic detail.
- Dashboard IntelligenceStrip: 1-line bettor sentence + collapsible 13-chip drill-down.
- Cross-section: 🔍 Analyze this button on SlipCard dispatches `ws:analyze-slip` CustomEvent.
- Loading/empty/error: bettor-spoken first person ("Reading your slip…" / "I couldn't read that one — try the Borrow path").
- Internal IDs / archetype taxonomy / URLs / status codes never reach bettor-visible strings (tooltip only).

### Explosive environment doctrine (BNDS-1A cemented)
- Explosive marker derives from canonical OE-5 threshold verbatim: `gameTotal >= 9.5 && avgImpliedTeamTotal >= 4.5 && windOut && hrEnvironmentTag !== "HR_SUPPRESSING"`.
- composeExplosiveSentence returns null when no canonical signal present — caller renders "Standard environment — no canonical signals fired."
- No hype. No emojis as marketing. No LLM. Fixed templates per signal fragment.

### Anti-fake-OCR continuation (BNDS-1A cemented)
- ScreenshotIntake supports cmd+v paste + drag/drop + click-to-pick file input + in-memory staging tray.
- EXPLICITLY no OCR / no tesseract / no vision / no backend submission.
- Reports honestly "Screenshot received — parsing pipeline not connected yet."
- Foundation for future OCR phase (operator-deferred indefinitely); when/if OCR is built, this component's API stays stable.

---

## § 7 — OPERATIONAL FLOW

### Terminal conventions
| Terminal | Role |
|---|---|
| **TERM 1** | Backend dev server (`node backend/server.js` on port 4000). NEVER auto-restarted by chat. Operator manages manually. |
| **TERM 2** | Verifier / regression / probe runner. Chat invokes commands via tool calls; operator runs them locally. |

**After any patch, chat must state:**
- `TERM 1 restart: YES / NO` (YES iff backend logic / route handler / module export changed).
- `TERM 2 verification: <exact commands>` operator should run.

### Pre-phase ritual (every new chat / every phase start)
```bash
cd backend
npm run brain:bootstrap         # bootstraps receipt + brain doc hash
npm run brain:continuity        # asserts no drift since last checkpoint
npm run brain:verify            # asserts brain doc freshness (0 FAIL expected)
```

### Audit-first ritual (before any patch)
1. Read the existing code path end-to-end (file:line trace).
2. Identify the exact choke point / collapse / missing wire.
3. Measure REAL counts when applicable (use real cache files; never estimate).
4. Write an audit doc at `docs/<PHASE_NAME>_AUDIT_2026-MM-DD.md` with executive finding + file:line citations + lever menu + operator-cemented DO-NOT-SHIP list.
5. Await operator lever approval. **Never patch without explicit approval.**

### Ship ritual (post-approval)
1. Implement approved lever(s) **additively** (NEW files preferred; existing files extended additively).
2. Run `cd frontend && npx tsc --noEmit` after every FE edit batch.
3. Run the new helper unit (`verifyXxx.js`) — must PASS before reconciliation.
4. Run prior verifiers (zero regression expected). If a prior verifier breaks → legitimate phase evolution requires assertion update with cited comment. Never silently delete an assertion.

### Regression matrix ritual
```bash
# Helper unit for THIS phase
node backend/scripts/verifyXxx.js                # expect: NN / NN assertions PASS

# 14-suite runtime verify
cd backend && npm run runtime:verify             # expect: 14/14 PASS

# Every verifier (zero regression)
for f in backend/scripts/verify*.js; do node "$f" | tail -1; done   # expect: every "RESULT: PASS"

# 5-probe canonical integrity matrix
for p in probe_grading_backfill_v1.js probe_lineage_v1.js probe_epoch_authority_v1.js probe_persistence_idempotency_v1.js probe_ledger_mirror_v1.js; do
  node "$p" | tail -2
done                                              # expect: every "fail: 0"

# FE type-safety
cd frontend && npx tsc --noEmit                  # expect: clean (no output)
```

### 6-doc reconciliation ritual (always before checkpoint)
| Doc | What to update |
|---|---|
| `CURRENT_STATE.md` (repo root) | New session-record line at top with full phase narrative |
| `NEXT_SESSION.md` (repo root) | New session-record line at top |
| `backend/runtime/brain/MASTER_BRAIN.md` | New `_Last updated: ...` line at top + prior record archived below |
| `backend/runtime/brain/CURRENT_RUNTIME_STATE.md` | Same pattern |
| `backend/runtime/brain/MODEL_EVOLUTION_LOG.md` | NEW dated entry at top (append-only) |
| `docs/OPERATOR_RUNBOOK.md` | NEW phase doctrine section at top + filename trailer updated |

### Anchor-file reconciliation ritual (NEW from COS-1A, EXTENDED in COS-1B)
| Anchor file | Update trigger |
|---|---|
| `ACTIVE_PHASE.md` | Overwrite at start AND seal of every phase |
| `NEXT_PHASE.md` | Overwrite when next phase approved (default: "awaiting operator selection") |
| `CURRENT_PROBLEMS.md` | Move shipped lever 🟡 → 🟢 with linked phase; add NEW 🟡 if surfaced |
| `PRODUCT_IDENTITY.md` | RARELY — change only by explicit operator approval |
| `OPERATIONAL_FLOW.md` | RARELY — change only when a ritual changes |
| `DEFERRED_PHASES.md` | Update when operator defers OR when prerequisite clears |
| **`GPT_RECONSTRUCTION_BOOTSTRAP.md`** (this file — COS-1B addition) | **REGENERATE on every phase seal — fail brain:checkpoint if drifted** |

### Finalize / checkpoint ritual (end of every session)
```bash
cd backend
npm run brain:bootstrap                          # re-stamp receipt if mid-session bootstrap was old
npm run brain:continuity                         # expect: PASS (0 issue, 0 warn after fresh bootstrap)
npm run brain:verify                             # expect: PASS (0 FAIL)
npm run brain:checkpoint                         # expect: CHECKPOINT RESULT: PASS (0 failure(s))
```

### Push flow
Manual. Operator handles git commit/push after `brain:checkpoint` PASS.

### FE inspection flow
```bash
ls frontend/src/workstation/sections/
ls frontend/src/workstation/components/
cat frontend/src/workstation/types.ts | grep "export interface"
cat frontend/src/workstation/api.ts
cd frontend && npx tsc --noEmit
```

### Runtime inspection flow
```bash
# Real candidate counts
node -e "
const tb = JSON.parse(require('fs').readFileSync('backend/runtime/tracking/mlb_tracked_bets_$(date +%Y-%m-%d).json', 'utf8'));
console.log('tracked_bets:', tb.length);
"

# Live state route (requires TERM 1 running)
curl -s "http://localhost:4000/api/ws/state?sport=mlb" | jq '{
  candidates: (.candidates | length),
  discoveryCandidates: (.discoveryCandidates | length),
  aiSlips: { safe: (.aiSlips.safe | length), balanced: (.aiSlips.balanced | length), aggressive: (.aiSlips.aggressive | length), lotto: (.aiSlips.lotto | length) }
}'
```

### Danger flags (stop and surface to operator)
- A verifier breaks because of legitimate phase evolution → propose assertion update, don't silently delete
- A canonical field changes shape on backend → propose additive new field, don't mutate existing
- An operator-approved lever requires touching a DO-NOT-TOUCH path → propose alternative, don't blow through
- `brain:checkpoint` FAILs after >2 reconciliation attempts → surface the specific failure
- A new pattern emerges that's not covered by any existing doctrine → propose explicit operator-approved doctrine extension first

---

## § 8 — DEFERRED SYSTEMS (why each is intentionally not built)

### INDEFINITELY DEFERRED (operator-cemented forbidden until explicit reversal)
| System | Why deferred | Danger of premature ship |
|---|---|---|
| **OCR / image-upload parsing** | Backend dependencies (multer/formidable/tesseract/sharp/vision APIs) don't exist; operator has not approved adding them. | Violates anti-fake-OCR doctrine. The 📸 surface is foundation-only (cmd+v + drag/drop staging tray with honest "parsing pipeline not connected yet"). Pretending OCR works when it doesn't is fabricated UX. |
| **LLM / GPT narration** for any FE string | Violates anti-fabrication doctrine cemented across 25 phases. | Catastrophic drift. The repo identity ("deterministic / anti-fabrication / canonical-authority-first") is irreversibly violated by any LLM phrase in the FE. |
| **Celebrity / star-power weighting** | Fabricated value. Explicitly forbidden in BC + OE phase prompts. | Same anti-pattern as LLM narration. |
| **Dynamic sportsbook-behavior simulation** | Fabricated counter-models. Operator out-of-scope. | Repo's edge comes from canonical signal composition. |
| **Adaptive payout shaping** | Cap-and-stop is doctrine. | Inflating joint probability to chase parlay payout is anti-pattern. |
| **Recursive explosion logic** | OE-11 per-pair cap 0.02 + aggregate cap 0.03 exist precisely to prevent. | Uncontrolled inflation. |
| **Hardcoded "tonight's lock"** | Hidden-value preservation forbids "always-promoted" paths. | Fabricated ranking. |
| **Auto-bet placement** | Out of scope (advisory, not executor). | Liability surface + breaks identity. |
| **Synthetic shadow predictions** | Grading-Calibration-Operations-1D explicitly forbade. | Pollutes integrity layer. |
| **Mobile-first redesign** | Operator-deferred. | Pollutes operator workstation surface. |

### PREREQUISITE-BLOCKED (waiting on a clear prerequisite)
| System | Prerequisite | Why premature ship is dangerous |
|---|---|---|
| **NBA-parity ecology** | NBA-specific ecology audit (NOT MLB clone — needs pace/usage/depth signals) | Cloning MLB phases for NBA produces neutral-fallback for every NBA candidate (no signals). |
| **Longitudinal adaptive calibration** | Per-bucket / per-signal ROI retrospective surface (BNSB-1C-class) + persisted verdict outcomes (BNSB-1D-class) | Shipping calibration refresh before operator can SEE its impact is shipping blind. |
| **Bullpen ingest activation** (OE-13 fires NEUTRAL) | Upstream `deriveMlbBullpenContext.js` populator | OE-13's NEUTRAL fallback prevents fabricated bullpen scores. |
| **OE-14 structural under-flip** | 30+ days of post-OE-1B graded telemetry | Premature flip removes diversification gate before rewards path demonstrates traction. |
| **OE-15 `buildBestOvers`** | OE-6 utilization telemetry showing organic saturation | Premature duplication. |
| **BNSB-1B-5 build-leg-by-leg** | Operator approval | Current Build path routes to existing Bet Builder; duplication. |
| **BNSB-1B-11 NAV label re-tone** | Operator approval | Cosmetic only. |
| **Persisted slip history** | Schema migration + new `/api/ws/screenshots/history` route + FE list | Premature persistence produces orphaned data. |
| **Diagnostics tab** | NEW `/api/ws/diagnostics` aggregator route | FE for an unbuilt aggregator = broken UX promise (same anti-pattern as removed `rawText` fallback). |
| **Cross-sport correlation engine extraction** | Operator approval that duplication is operationally painful | "While I'm in here" anti-pattern. |

### NOT-YET-AUDITED (acknowledged but no analysis done)
- First-pitch in-play overlays
- NFL / NHL / soccer expansion
- Public-facing bettor end-user surface
- Live-game prop adjustments

---

## § 9 — CURRENT NEXT-PHASE OPTIONS

The operator picks one. See `NEXT_PHASE.md` for full constraint detail. Brief summary:

### Candidate 1 — Slip Emotional Compression (BNSB-1C-class) — RECOMMENDED
- **Bottleneck**: A-1 (slips still emotionally weak)
- **Objective**: 1-2 sentence narrative on SlipCard composed deterministically from canonical signals.
- **Why**: Highest-leverage bettor-impact win without backend touch.
- **Forbidden**: LLM narration. Adaptive styling. Marketing tone.

### Candidate 2 — Per-Event Hover Cards (BNDS-1C-class)
- **Bottleneck**: A-2 (game hub depth thin on small slates)
- **Objective**: PitcherMatchup / Lineup / Weather hover cards inside expanded GameCard (canonical fields only).
- **Why**: Layer 1 depth without expanding pool size.

### Candidate 3 — Portfolio Bettor-Language Pass (BNSB-1D-class)
- **Bottleneck**: A-3 (Risk Map operator-shaped warnings)
- **Objective**: Translate `"high_correlation:script_risk_high:scriptCluster_NYY_BOS_3legs"` → "Three legs hinge on the same NYY @ BOS game script — they win and lose together."
- **Why**: Layer 2 bettor-native polish.

### Candidate 4 — Diagnostics Tab (Operational-1B-class)
- **Bottleneck**: A-4 (CLI invisibility)
- **Objective**: NEW Diagnostics tab consuming a `/api/ws/diagnostics` aggregator route.
- **Why**: Operator visibility into grading/calibration/lineage health.

### Candidate 5 — Survivability Lens (BNDS-1C-class)
- **Bottleneck**: A-5 (Discovery lenses miss survivability)
- **Objective**: ADD lens "By survivability" sorting GameEcosystem by aggregated `ladderSurvivabilityFactor`.
- **Why**: Trivial-effort Layer 1 win.

### What should NOT happen next
- ❌ NBA parity (prerequisite blocked — audit required)
- ❌ Longitudinal calibration refresh (prerequisite blocked — ROI surface required)
- ❌ OCR pipeline (cemented forbidden)
- ❌ Any direction from § 5

---

## § 10 — RECONSTRUCTION INSTRUCTIONS (repeated at bottom for emphasis)

You are a fresh GPT chat picking up this repo. Follow these rules:

### DO
- ✅ Use the canonical state in this file as authoritative
- ✅ Audit before patching (file:line trace, real data)
- ✅ Wait for operator lever approval before shipping
- ✅ Ship additively (NEW files preferred; existing extended additively)
- ✅ Run helper unit + 26 verifiers + 14 runtime + 5 probes before declaring done
- ✅ Reconcile all 6 brain/operator docs AND 7 anchor files (incl. THIS file) on every phase seal
- ✅ Run `brain:checkpoint` to seal

### DO NOT
- ❌ Rediscover architecture (it's settled across 25 phases)
- ❌ Re-solve solved problems (§ 4 SOLVED list with linked phases)
- ❌ Propose any forbidden direction (§ 5)
- ❌ Rewrite backend or FE architecture
- ❌ Fabricate intelligence (anti-fabrication invariant)
- ❌ Mutate existing canonical field semantics (additive only)
- ❌ Touch grading / settlement / replay / lineage pipelines
- ❌ Skip anchor-file reconciliation

### IF UNSURE
- Surface the conflict to the operator. Never silently override this file.
- If a new pattern emerges not covered here, propose explicit operator-approved doctrine extension first.

### MANDATORY CHECKPOINT BEHAVIOR
At the END of every phase you ship:
1. Regenerate THIS file (`GPT_RECONSTRUCTION_BOOTSTRAP.md`) with the new active phase + updated bottlenecks + updated next-phase candidates + any new forbidden directions / deferrals.
2. Run `verifyContinuityOs1B.js` — it asserts THIS file is in sync with the 6 anchor files.
3. Run `brain:checkpoint` — it will FAIL if THIS file drifts.

---

## METADATA

| Field | Value |
|---|---|
| File version | Continuity-OS-1B (2026-05-17) |
| Total approved phases | 26 (Realism-1A through Continuity-OS-1B) |
| Total verifiers | 26 (`verify*.js` in `backend/scripts/`) |
| Runtime verifiers | 14 |
| Probe matrix | 5 (158 assertions) |
| 6-doc reconciliation | CURRENT_STATE / NEXT_SESSION / MASTER_BRAIN / CURRENT_RUNTIME_STATE / MODEL_EVOLUTION_LOG / docs/OPERATOR_RUNBOOK |
| 7-anchor reconciliation | BOOTSTRAP_PROMPT + ACTIVE_PHASE + PRODUCT_IDENTITY + CURRENT_PROBLEMS + NEXT_PHASE + OPERATIONAL_FLOW + DEFERRED_PHASES + **this file** |
| Reconstruction surface (before COS-1A) | ~15,000 lines |
| Reconstruction surface (after COS-1A 6-anchor chain) | ~775 lines |
| Reconstruction surface (after COS-1B single artifact) | ~600 lines (this file) |
| Estimated drift reduction vs pre-COS-1A | ~96% |
