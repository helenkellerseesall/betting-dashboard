# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (late night — trust-curation hierarchy pass)_

---

## CURRENT PROJECT PHASE

**CURATION + TRUST + OPERATOR-QUALITY refinement — Phase 5 (trust hierarchy)**

The workstation is structurally complete and functionally working.
The scoring ecology has been corrected at multiple layers.
The trust-curation hierarchy is now significantly more balanced.
Future work is refinement and infrastructure — NOT architecture.

---

## LAST SUCCESSFUL STATE

Session completed 2026-05-06 (late night). All patches verified clean (`node --check`).

### Patches applied this session (trust-curation hierarchy):

1. **`buildFeaturedPlays.js`** — `scoreCandidate.tierBoost` halved:
   - ELITE: 0.08 → 0.04
   - STRONG: 0.04 → 0.02
   - Root cause: ELITE/STRONG tiers are 100% under-biased on MLB slates (33 ELITE unders,
     0 ELITE overs). At 0.08, inflated low-edge ELITE unders above higher-edge PLAYABLE overs.
     At 0.04, a 9.5% edge over now naturally outranks a 5.5% edge ELITE under.

2. **`buildFeaturedPlays.js`** — added `sortAnchorsForDisplay()`:
   - Pure editorial sort — composite scores unchanged
   - Alternates anchor display sides: U·O·U·O·U pattern
   - Ensures offensive attack plays appear at positions #2 and #4 rather than buried at #4/#5
   - Highest-composite play always at #1 (quality anchor preserved)

### Verification (today's slate, 48 diversified candidates):
- Anchor display order: U·O·U·O·U (was U·U·U·O·O)
- Trout runs over (22% edge): now anchor #2 (was anchor #4)
- Low-edge ELITE unders (Merrill 14.5%): dropped out of anchor tier entirely
- Smart Aggression: 4 real overs (Trout, No HR, Schanuel, Machado)
- AI Lotto: 5 pure offensive overs
- All buckets populated, no regressions

---

## IMMEDIATE NEXT PRIORITIES

### Priority 1 — Verify trust-curation fix in live slate
**TERM 2 action**: Hit `/api/ws/state?sport=mlb` after 60s server cache expires.
Confirm:
- Anchors now show U·O·U·O·U pattern in the command-center AnchorCard
- Trout's runs over (or equivalent best offensive edge) appears at anchor #2
- Smart Aggression cards show real offensive over content
- "Tonight's Anchors" feels alive, not sterile

### Priority 2 — `ARCHITECTURE.md` + PIPELINES docs (infrastructure)
Create the remaining docs:
- `/docs/ARCHITECTURE.md` — repo structure, module domains, extraction direction
- `/docs/PIPELINES/MLB.md` — MLB-specific systems, HR/TB/RBI pipeline, current weaknesses
- `/docs/PIPELINES/NBA.md` — NBA boards, slips, orchestration, weaknesses
- `/docs/PIPELINES/TRACKING.md` — tracking, grading, CLV, future SQLite targets

### Priority 3 — "Outs" label perception issue (optional cosmetic)
Pitcher depth overs ("outs over 15.5") appear in Tonight's Best and Safest.
These are legitimate low-variance edges but "outs" sounds suppression to users.
Optional: in `compactStat()` or `buildReason()`, rename "outs" → "pitcher depth" or
add a tag like "pitcher workload" when it's a pitcher-only context.
NOT a scoring change — purely a presentation label.

### Priority 4 — NBA scoring ecology audit
Apply same lens as MLB audit:
- `edge × modelProb` compounding in NBA tracked_bets
- Tier distribution by side
- volRealism gaps
- Offensive over recognition
Source: `nba_tracked_bets_2026-05-06.json`

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| `sortAnchorsForDisplay` breaks anchor quality by moving a low-composite over to #2 | Greedy: only moves an opposite-side play if it has high composite (picks best opposite-side next); the sort preserves #1 as highest-composite always |
| Halved tierBoost makes ELITE tier signal too weak | ELITE is still +0.04 (+4 composite points); sufficient signal, just no longer overwhelming |
| Tonight's Best now shows more pitcher-depth overs (displacing ELITE unders) | This is the correct behavior — pitcher workload overs with genuine edge > inflated low-edge unders |
| Cache (60s TTL) serving stale results | Wait for cache to expire; TERM 2 restart if needed |

---

## WHAT NOT TO DO

- Do NOT raise tierBoost back to 0.08 — it creates a structural under-side monopoly
- Do NOT modify the interleave sort to force a specific number of overs — it's greedy, not hardcoded
- Do NOT touch the projection engine to force over/under parity
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT remove modelProb cap [0.50, 0.55] — would restore compounding bias
- Do NOT widen scope into SQL migration during curation pass
- Do NOT touch `runMlbNight.js` / `runNbaNight.js` without tracing candidate paths first

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| Root-cause audit on unknown bug | **Opus** |
| Implementing a verified fix | **Sonnet** |
| Doc updates / CURRENT_STATE / NEXT_SESSION | **Auto or Sonnet** |
| NBA ecology audit (Priority 4) | **Opus** — root cause first |

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

## CALIBRATION DIRECTION (cumulative)

| Lever | Status |
|---|---|
| Side balance in featured buckets | Capped at 60% (anchors 55%) |
| Stat concentration | maxPerStat:10 / maxPerStatSide:6 |
| Volatility taxonomy | Fixed — hits/runs/etc. → balanced |
| modelProb compounding | Capped [0.50, 0.55] in featured + slipAi |
| Offensive over recognition | Active — stacked textureBoost (0.020/0.030) |
| Anchor cross-side | maxPerGame:2 — allows same-game cross-side |
| Anchor display ordering | Interleaved U·O·U·O·U via sortAnchorsForDisplay |
| Tier boost asymmetry | Halved — ELITE 0.04, STRONG 0.02 |
| AI slip offense bias | Active in aggressive/lotto seed sort |

---

## EXTRACTION PRIORITIES (when scope opens)

1. Extract `isOffensiveAttackStat` into `pipeline/shared/normalizers.js` — duplicated in `buildSlipAi.js` and `buildFeaturedPlays.js`
2. Extract `sortAnchorsForDisplay` into a shared display utility if anchors are used elsewhere
3. Extract `diversifyCandidates` from `workstationRoutes.js` → `pipeline/shared/buildCandidateDiversity.js`
4. Extract `compactLineShopping` from `workstationRoutes.js` → `pipeline/shared/buildLineShoppingCompact.js`
5. Extract inline scoring helpers from `buildIntelligencePresentation.js` → dedicated shared modules

---

## SQLITE MIGRATION SEQUENCE (future — do not start yet)

1. `personal_ledger.json` → ledger table
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `book_intelligence_state.json` → book profiles table
4. `graded_props_*.json` → review/grading table

Trigger condition: ledger exceeds ~500 entries or explicit user request.

---

## INFRASTRUCTURE STATUS

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | Updated this session |
| `docs/NEXT_SESSION.md` | Updated this session |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed |
| `docs/ARCHITECTURE.md` | Pending (Priority 2) |
| `docs/PIPELINES/MLB.md` | Pending |
| `docs/PIPELINES/NBA.md` | Pending |
| `docs/PIPELINES/TRACKING.md` | Pending |
