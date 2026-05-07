# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (evening)_

---

## CURRENT PROJECT PHASE

**CURATION + TRUST + OPERATOR-QUALITY refinement pass — Phase 3**

The workstation is structurally complete and functionally working.
All active work is targeted refinement of scoring ecology, surfacing quality,
emotional texture, and portfolio intelligence.

---

## LAST SUCCESSFUL STATE

Session completed 2026-05-06. All patches verified clean (`node --check`).

### Patches applied this session (scoring/texture):
1. `buildPortfolioOptimizer.js` — volatility taxonomy: `hits`/`runs`/`points`/`rebounds`/`steals`/`blocks`/`doubles`/`triples`/`stolenbases` → `balanced` (was falling to `safe`)
2. `buildFeaturedPlays.js` — softer `volRealism` gap; `textureBoost` +0.018 for agg/lotto legs with edge > 0.045; `buildSmartAggression` texture fallback for balanced + plus-money/steam
3. `buildSlipAi.js` — `offensiveAttackTextureBonus()` seed-ordering on aggressive/lotto tiers; sharpened leg/slip/narrative language
4. `buildFeaturedPlays.js` — `scoreCandidate` uses `textureBoost` in composite calculation
5. `docs/WORKFLOW_RULES.md` — created and committed
6. `docs/CURRENT_STATE.md` + `docs/NEXT_SESSION.md` — created and committed
7. `docs/BOOTSTRAP_PROMPT.md` — created (canonical session rehydration entrypoint)
8. `.cursor/rules/workflow.mdc` — updated to reference operational docs, strengthened enforcement

---

## IMMEDIATE NEXT PRIORITIES

### Priority 1 — Verify texture patch in live slate
**TERM 2 action**: Hit `/api/ws/state?sport=mlb` after server cache expires.
Confirm:
- Aggressive slips now contain `hits`/`runs` legs (not just unders)
- Featured anchors not exclusively under-props
- Portfolio `byVolatility.balanced` count rises vs prior session

### Priority 2 — Scoring ecology audit (offensive over archetype)
The raw MLB candidate pool is ~83% unders today (293 bets: 243 under / 50 over).
Side-balance mitigation works at the surfacing layer.
But the projection engine still produces a 5:1 under-heavy pool.

**Next audit target**: `backend/pipeline/shared/adapters/mlbAdapter.js`
Specifically: how `edge` and `modelProb` are calculated for over props vs under props.
Hypothesis: under props receive higher `modelProb` due to probability compression on
lower lines — making them structurally outrank overs even when both have genuine edge.

### Priority 3 — ARCHITECTURE.md + PIPELINES docs
After Priority 1+2 are verified, create:
- `/docs/ARCHITECTURE.md`
- `/docs/PIPELINES/MLB.md`
- `/docs/PIPELINES/NBA.md`
- `/docs/PIPELINES/TRACKING.md`

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| Volatility taxonomy change breaks portfolio `byVolatility` counts | Verify counts with `node -e` smoke test after changes |
| Side-balance fill pass masking real over shortfall | Check that fill pass doesn't dominate primary on normal nights |
| `offensiveAttackTextureBonus` inflating lotto tier with low-quality overs | Bonus is capped at 0.07 and requires `edge > 0.035` — watch for abuse |
| `buildSmartAggression` texture fallback surfacing weak balanced legs | Requires `edge > 0.042` + plus-money or timing signal — should hold |
| Server cache (60s TTL) serving old results after patch | Always wait for cache to expire or restart via TERM 2 |

---

## WHAT NOT TO DO

- Do NOT rebuild the projection engine to force balance — fix ecology, not math
- Do NOT hard-force over percentages — only preserve upside candidates that already have genuine edge
- Do NOT widen scope into SQL migration during curation pass
- Do NOT touch `runMlbNight.js` or `runNbaNight.js` without verifying exact candidate paths first
- Do NOT add new endpoints — all workstation data flows through `/api/ws/state`

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| Scoring ecology audit (mlbAdapter.js) | **Opus** — root cause diagnosis |
| Implementing verified fix after audit | **Sonnet** |
| Doc updates / CURRENT_STATE / NEXT_SESSION | **Auto or Sonnet** |
| Any unknown bug in pipeline | **Opus first** |

---

## TERM1 / TERM2 WORKFLOW

```
TERM 1: backend always running on port 4000 — NEVER touch
TERM 2: operator-controlled manual verification

After any patch:
  → State: "TERM 1 restart: YES/NO"
  → State: "TERM 2 verification: [exact curl or browser command]"
  → Wait for operator confirm before evaluating
```

---

## EXTRACTION PRIORITIES (when scope opens)

1. Extract inline scoring helpers from `buildIntelligencePresentation.js` → dedicated shared modules
2. Extract `diversifyCandidates` from `workstationRoutes.js` → `pipeline/shared/buildCandidateDiversity.js`
3. Extract `compactLineShopping` from `workstationRoutes.js` → `pipeline/shared/buildLineShoppingCompact.js`
4. Move `enrichBestEntry` + `buildCandidatePool` into a shared candidate factory

---

## SQLITE MIGRATION SEQUENCE (future — do not start yet)

1. `personal_ledger.json` → ledger table (first, smallest, highest ROI)
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `book_intelligence_state.json` → book profiles table
4. `graded_props_*.json` → review/grading table

Trigger condition: when ledger exceeds ~500 entries or explicit user request.

---

## VALIDATION SYSTEM DIRECTION (future)

- Add `node -e` smoke tests for `classifyVolatility` after any taxonomy change
- Add candidate pool distribution check (`sides`, `topStats`) to nightly report output
- Add assertion: featured anchors must never be 100% same-side
- These are future tasks — do not build validation infra during curation pass

---

## CALIBRATION DIRECTION

Current calibration status: **active**
- Side balance: ✅ capped at 60% (anchors 55%)
- Stat concentration: ✅ capped at maxPerStat:10 / maxPerStatSide:6
- Volatility taxonomy: ✅ fixed this session
- Over archetype surfacing: 🔄 in progress (Priority 2)
- Offensive texture in slips: ✅ texture bonus active for agg/lotto

---

## INFRASTRUCTURE STATUS

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | ✅ Committed |
| `docs/CURRENT_STATE.md` | ✅ Committed + updated |
| `docs/NEXT_SESSION.md` | ✅ Committed + updated |
| `docs/BOOTSTRAP_PROMPT.md` | ✅ Created this session |
| `.cursor/rules/workflow.mdc` | ✅ Updated — references operational docs |
| `docs/ARCHITECTURE.md` | ❌ Next infrastructure task |
| `docs/PIPELINES/MLB.md` | ❌ Pending |
| `docs/PIPELINES/NBA.md` | ❌ Pending |
| `docs/PIPELINES/TRACKING.md` | ❌ Pending |
