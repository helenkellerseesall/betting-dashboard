# NEXT PHASE
**Single canonical next-step authority. Replaces giant bootstrap prompts.**
**Overwrite when the operator approves the next phase. Default state: "awaiting operator selection."**

---

## STATUS

| Field | Value |
|---|---|
| **Approved next phase** | _(awaiting operator selection — operator picks from active bottlenecks)_ |
| **Last sealed phase** | Continuity-OS-1A (COS-1A) — sealed 2026-05-17 |
| **Most likely candidates** | See `CURRENT_PROBLEMS.md` 🟡 ACTIVE bottlenecks (A-1 through A-5) |

---

## HOW THE NEXT PHASE GETS APPROVED

1. New chat starts → reads `ACTIVE_PHASE.md` + `CURRENT_PROBLEMS.md` + this file.
2. Operator either:
   - (a) Approves a new phase from `CURRENT_PROBLEMS.md` 🟡 ACTIVE list, OR
   - (b) Surfaces a NEW bottleneck not yet on the 🟡 ACTIVE list.
3. Chat does **audit-first trace** (NEVER patch blindly):
   - Bootstrap brain (`npm run brain:bootstrap`)
   - Continuity check (`npm run brain:continuity`)
   - Read existing related code (trace the real flow)
   - Identify the choke point with file:line citations
4. Chat proposes a **lever menu** (audit doc in `docs/`).
5. Operator approves smallest-safe subset of levers.
6. Chat ships under additive-only doctrine.
7. Chat updates this file to reflect what was shipped.
8. Chat updates `CURRENT_PROBLEMS.md` (move shipped lever from 🟡 ACTIVE → 🟢 SOLVED).
9. Chat updates `ACTIVE_PHASE.md` to reflect the new sealed phase.

---

## CANDIDATE NEXT PHASES (operator picks one)

### Candidate 1 — "Slip Emotional Compression" (BNSB-1C-class)
- **Bottleneck**: A-1 — Slips still emotionally weak; per-factor chip dump doesn't yet feel "holy shit."
- **Objective**: Compress SlipCard reasoning into a 1-2 sentence narrative ("This 3-leg ride wins if Coors stays explosive and Aaron Judge clears 1.5 TB — both share the same offensive ecology.") composed deterministically from canonical signals.
- **Constraints**: NO LLM. Use `bettorLanguage` library + new `composeSlipNarrative()` pure helper. Anti-fabrication: every phrase traces to a signal id.
- **Forbidden**: GPT narration. Adaptive AI styling. Marketing tone.
- **Success**: SlipCard renders a coherent narrative on top of the existing reinforcement ladder + chip row; verifier asserts narrative is deterministic + reads only canonical fields.
- **Failure**: Narrative reads as LLM-generated or fabricates a "feel."

### Candidate 2 — "Per-Event Hover Cards" (BNDS-1C-class)
- **Bottleneck**: A-2 — GameCard could expose richer per-event meta (pitcher matchup / lineup / weather) on hover.
- **Objective**: Add 3 collapsible hover cards inside expanded GameCard: PitcherMatchup (canonical pitcher K/9, opposing hitter strengths), LineupCard (canonical depth + projected lineup order), WeatherCard (canonical windDirectionTag, carryShift, temperatureF).
- **Constraints**: Canonical fields only. No fetches. No fabrication of any matchup advantage.
- **Forbidden**: Inventing matchup tags. Synthesizing "advantage" colors beyond what canonical scores produce.
- **Success**: Each hover card renders only when canonical fields present; honest "(no canonical context available)" otherwise.

### Candidate 3 — "Portfolio Bettor-Language Pass" (BNSB-1D-class)
- **Bottleneck**: A-3 — Risk Map concentration warnings read operator-shaped, not bettor-shaped.
- **Objective**: Translate `PortfolioWarning.label` values from `"high_correlation:script_risk_high:scriptCluster_NYY_BOS_3legs"` to "Three legs hinge on the same NYY @ BOS game script — they win and lose together."
- **Constraints**: `bettorLanguage` style — fixed templates per warning class.
- **Success**: Risk Map reads bettor-spoken; operator-shape preserved in tooltip only.

### Candidate 4 — "Diagnostics tab" (Operational-1B-class)
- **Bottleneck**: A-4 — `grading:status` / `calibration:status` / `lineage:status` invisible to FE.
- **Objective**: NEW Diagnostics tab consuming a new `/api/ws/diagnostics` aggregator that returns the union of the 3 CLI outputs.
- **Constraints**: Read-only. NO mutation. Canonical CLI output rendered verbatim.

### Candidate 5 — "Survivability lens" (BNDS-1C-class)
- **Bottleneck**: A-5 — Discovery lenses don't include survivability-weighted sort.
- **Objective**: ADD lens "By survivability" sorting GameEcosystem by aggregated `ladderSurvivabilityFactor` averaged across the game's candidates.
- **Constraints**: Canonical helper only. No new backend.

---

## RULE FOR CHAT BEHAVIOR

- If operator says "begin Phase X" → audit-first trace, propose levers, await approval, then ship.
- If operator says "what's next?" → present the candidate list above + a one-line recommendation.
- If chat THINKS the bottleneck is something not in the candidate list → propose it as a NEW 🟡 ACTIVE entry in `CURRENT_PROBLEMS.md` first; don't ship until operator approves.

---

## SUCCESS CRITERIA (template for any next phase)

Every next phase ships under these invariants:
- ✅ Audit-first (trace before patch; file:line citations in the audit doc)
- ✅ Operator-approved lever subset (smallest-safe; explicit deferrals)
- ✅ Additive-only (zero existing logic touched outside the lever scope)
- ✅ Anti-fabrication preserved (every visible string traces to canonical)
- ✅ Helper unit (`verifyXxx.js`) passes
- ✅ 14/14 runtime:verify + 5/5 probes (158 assertions)
- ✅ `cd frontend && npx tsc --noEmit` clean (if FE touched)
- ✅ 6-doc reconciliation (CURRENT_STATE / NEXT_SESSION / MASTER_BRAIN / CURRENT_RUNTIME_STATE / MODEL_EVOLUTION_LOG / OPERATOR_RUNBOOK)
- ✅ Anchor-file reconciliation (THIS file + ACTIVE_PHASE.md + CURRENT_PROBLEMS.md)
- ✅ `brain:checkpoint` PASS (0 failures)

---

## FAILURE MODES (template for any next phase)

- ❌ Patching without trace (audit-first violated)
- ❌ Shipping a lever the operator didn't explicitly approve
- ❌ Mutating an existing canonical field's semantics (additive violated)
- ❌ Introducing a fabricated value path (anti-fabrication violated)
- ❌ Breaking a prior verifier (regression)
- ❌ Skipping the 6-doc reconciliation (continuity drift)
- ❌ Skipping the anchor-file reconciliation (THIS phase's purpose: prevent drift)
