# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (late evening — scoring ecology pass)_

---

## CURRENT PROJECT PHASE

**CURATION + TRUST + OPERATOR-QUALITY refinement — Phase 4 (scoring ecology)**

The workstation is structurally complete and functionally working.
Scoring ecology has been corrected at the curation/surfacing layer.
The projection engine is INTENTIONALLY untouched — projection-level balance
is out of scope (would require model retraining; see WHAT NOT TO DO).

---

## LAST SUCCESSFUL STATE

Session completed 2026-05-06 (late evening). All patches verified clean (`node --check`).

### Patches applied this session:

1. **`buildFeaturedPlays.js`** — `scoreCandidate.f.edge` formula:
   - OLD: `(edge × 4) × (modelProb || 0.5)` — compounded suppression advantage
   - NEW: `(edge × 4) × clamp(modelProb, 0.50, 0.55)` — caps modelProb factor
   - Removes 30% structural advantage that under bets received from probability compression

2. **`buildSlipAi.js`** — `scoreLeg.projectionScore` formula:
   - Same modelProb cap as featured (`[0.50, 0.55]`)
   - Mirrors featured behavior in slip construction

3. **`buildFeaturedPlays.js`** — added `isOffensiveAttackStat()` helper:
   - Recognizes hitter offense (hits/runs/totalbases/HR/RBI/XBH/SB/etc)
   - Excludes pitcher dominance flavors (outs/Ks/walks)
   - Mirrors `buildSlipAi.offensiveAttackTextureBonus` recognition

4. **`buildFeaturedPlays.js`** — `textureBoost` extended:
   - Aggressive/lotto + edge>0.045: `0.018` (existing)
   - Aggressive/lotto offensive overs: `0.030` (overcomes volRealism penalty)
   - Balanced offensive overs (edge>0.05): `0.020` (new)
   - Stacked into single value, not added — only one boost fires per candidate

5. **`buildFeaturedPlays.js`** — `buildAnchors` `maxPerGame: 1 → 2`:
   - On nights with both genuine attack + suppression edges in one game
     (e.g. Trout runs over + Montgomery TB under in CHW@LAA), this allows
     the second pick when it adds cross-side texture
   - Side-balance cap (0.55) still prevents same-side same-game spam

### Verification (today's slate, 48 diversified candidates):
- Anchors: 3U / 2O (Trout 22% edge over now surfaces)
- Tonight's Best: 3U / 2O
- Best Ladders: 3U / 2O
- Smart Aggression: 4 overs (real offensive attack)
- AI Aggressive Slip #1: 3U + 1 over (cross-side)
- AI Lotto Slip #1: 5 pure-offensive overs

---

## IMMEDIATE NEXT PRIORITIES

### Priority 1 — Verify scoring ecology patch in live slate
**TERM 2 action**: Hit `/api/ws/state?sport=mlb` after server cache expires (60s TTL).
Confirm:
- Anchors contain real offensive overs when slate has them with edge >0.05
- Aggressive/Lotto AI slips include offensive attack legs
- Portfolio side mix improved vs prior session

### Priority 2 — `ARCHITECTURE.md` + PIPELINES docs
After Priority 1 verification, create:
- `/docs/ARCHITECTURE.md` — repo structure, extraction direction, scoring/orchestration domains
- `/docs/PIPELINES/MLB.md` — MLB-specific systems, HR systems, ladders, weaknesses
- `/docs/PIPELINES/NBA.md` — NBA boards, slips, orchestration, weaknesses
- `/docs/PIPELINES/TRACKING.md` — tracking architecture, grading, CLV, future SQLite targets

### Priority 3 — NBA scoring ecology audit (parallel to MLB fix)
NBA candidate pools may have a similar (or inverse) imbalance.
Apply the same audit lens: `edge × modelProb` compounding, volRealism gaps,
side-balance, archetype recognition. Use today's NBA tracked_bets as source data.

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| `maxPerGame: 2` in anchors causes same-game double-stacking when both picks are same side | Side cap (0.55) blocks this — confirmed by simulation |
| `textureBoost` 0.030 inflates aggressive offensive overs unfairly | Boost only fires for edge>0.045 + true offensive stat — capped magnitude |
| modelProb cap [0.50,0.55] reduces composite spread among unders | By design — neutralizes compression artifact, not real edge differences |
| Cache (60s TTL) serving old results after patch | Wait for cache to expire or restart via TERM 2 |
| Strict anchor gate (composite≥0.55 + corroboration) inert without ledger data | Known — fallback to composite≥0.50 always fires; not a regression |

---

## WHAT NOT TO DO

- **Do NOT touch the projection engine** to force over/under parity. Projection-level
  imbalance is structural (probability compression on shorter lines is real). Fix at
  curation, not source math.
- Do NOT widen `maxPerGame` further — `2` is the cross-side compromise.
- Do NOT raise `textureBoost` above 0.030 — already overcomes volRealism penalty.
- Do NOT reduce the modelProb cap below 0.50 — would penalize legitimate low-prob bets.
- Do NOT remove the modelProb cap upper bound — restoring uncapped multiplier reintroduces
  the structural under-side compounding bias.
- Do NOT widen scope into SQL migration during scoring ecology pass.
- Do NOT touch `runMlbNight.js` or `runNbaNight.js` without verifying exact candidate paths.

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| Root-cause audit on unknown bug | **Opus** |
| Implementing a verified fix | **Sonnet** |
| Doc updates / CURRENT_STATE / NEXT_SESSION | **Auto or Sonnet** |
| NBA ecology audit (Priority 3) | **Opus** — root cause first |

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

1. Extract `isOffensiveAttackStat` into `pipeline/shared/normalizers.js` (or similar) — currently duplicated in `buildSlipAi.js` and `buildFeaturedPlays.js`
2. Extract `diversifyCandidates` from `workstationRoutes.js` → `pipeline/shared/buildCandidateDiversity.js`
3. Extract `compactLineShopping` from `workstationRoutes.js` → `pipeline/shared/buildLineShoppingCompact.js`
4. Extract inline scoring helpers from `buildIntelligencePresentation.js` → dedicated shared modules
5. Move `enrichBestEntry` + `buildCandidatePool` into a shared candidate factory

---

## SQLITE MIGRATION SEQUENCE (future — do not start yet)

1. `personal_ledger.json` → ledger table
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `book_intelligence_state.json` → book profiles table
4. `graded_props_*.json` → review/grading table

Trigger condition: ledger exceeds ~500 entries or explicit user request.

---

## VALIDATION SYSTEM DIRECTION (future)

- Add `node -e` smoke test for `scoreCandidate` + `scoreLeg` after any formula change
  (verify Trout-over-Ohtani composite delta — regression-detect)
- Add candidate pool distribution check (`sides`, `topStats`, `byVolatility`) to nightly report
- Add assertion: featured anchors must never be 100% same-side when overs exist with edge>0.10
- These are future tasks — do not build validation infra during curation pass

---

## CALIBRATION DIRECTION

| Lever | Status |
|---|---|
| Side balance | Capped at 60% (anchors 55%) |
| Stat concentration | Capped at maxPerStat:10 / maxPerStatSide:6 |
| Volatility taxonomy | Fixed prior session |
| modelProb compounding | Capped this session [0.50, 0.55] |
| Offensive over recognition | Active — stacked textureBoost |
| Anchor cross-side | Allowed (maxPerGame: 2) |
| AI slip offense bias | Active in aggressive/lotto seed sort |

---

## INFRASTRUCTURE STATUS

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | Updated this session |
| `docs/NEXT_SESSION.md` | Updated this session |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed — references operational docs |
| `docs/ARCHITECTURE.md` | Pending (Priority 2) |
| `docs/PIPELINES/MLB.md` | Pending |
| `docs/PIPELINES/NBA.md` | Pending |
| `docs/PIPELINES/TRACKING.md` | Pending |
