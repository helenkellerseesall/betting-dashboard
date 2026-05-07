# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (overnight — trust-qualification audit pass)_

---

## CURRENT PROJECT PHASE

**CURATION + TRUST + OPERATOR-QUALITY refinement — Phase 6 (trust qualification)**

The workstation is structurally complete and functionally working.
The scoring ecology has been corrected at multiple layers.
The trust-curation hierarchy is balanced.
**Trust qualification gates now allow premium offensive ecosystems to graduate.**
Future work is refinement and infrastructure — NOT architecture.

---

## LAST SUCCESSFUL STATE

Session completed 2026-05-06 (overnight). All patches verified clean (`node --check`).

### Patches applied this session (trust-qualification audit):

1. **`buildSlipAi.js`** — `scoreLeg.tierBoost` halved:
   - ELITE: 0.10 → 0.05
   - STRONG: 0.05 → 0.025
   - Root cause: same modelProb-driven tier-assignment under-bias the featured layer had.
     ELITE/STRONG tiers are 100% under-assigned on MLB slates; full +0.10 phantom-promoted
     low-edge unders above higher-edge overs in slip composite ranking.

2. **`buildSlipAi.js`** — safe-tier eligibility premium-edge override:
   - Legs with `modelProb >= 0.50 AND edge >= 0.12` bypass the standard `allowedVolatility`
     list (`["safe","balanced"]`) AND the `minModelProb: 0.55` gate.
   - `maxOdds: 150` cap **still applies** — preserves safe identity, prevents +220 plays.
   - Without this override, modelProb compression structurally excludes ALL offensive overs
     from safe tier (today: 0 of 18 offensive overs cleared 0.55 modelProb).

3. **`buildPortfolioOptimizer.js`** — `outs` → `balanced` volatility:
   - Pitcher outs was falling through to safe (default fallback).
   - Outs is structurally suppression-flavored AND predictably volatile (pitcher hooks,
     leaves games, BPIP). Treating as safe inflated volRealism (0.80) and caused outs overs
     to monopolize Safest / Best Ladders on every MLB slate.
   - Reclassifying as balanced gives correct realism (0.74) and frees the trust surface
     for genuinely lower-variance plays.

4. **`buildFeaturedPlays.js`** — `buildSafest` premium-edge override:
   - Mirror of slip-side override. Balanced/aggressive plays with `modelProb >= 0.50 AND
     edge >= 0.12` qualify alongside the standard safe-volatility + 0.55 modelProb gate.
   - Premium offensive ecosystems (Trout 22%-edge runs over) now graduate into the SAFEST
     featured trust surface — without forcing offense or destroying realism.

### Verification (today's slate, 48 diversified candidates):
- **Safest now contains Mike Trout runs over** (was 100% pitcher outs / unders)
- Tonight's Best now contains Schanuel hits over (was Schultz outs at #4)
- Smart Aggression: 4 hitter overs (Trout, No HR, Schanuel, Machado)
- AI Aggressive #1: Trout cross-side seed
- AI Lotto: 5 pure offensive overs
- All buckets populated, no regressions, slip count 13 (was 12)
- 43 of 43 outs bets reclassified to balanced volatility ✓

---

## IMMEDIATE NEXT PRIORITIES

### Priority 1 — Verify trust-qualification fix in live slate
**TERM 2 action**: Hit `/api/ws/state?sport=mlb` after 60s server cache expires.
Confirm:
- "Safest" card now includes Trout runs over (or equivalent premium offensive ecosystem)
- Tonight's Best contains hitter offense at #4 (not pitcher outs)
- AI Lotto Slip #1 = 5 offensive overs
- AI Aggressive Slip #1 has at least 1 offensive over leg
- Pitcher outs no longer monopolizes Safest

### Priority 2 — `ARCHITECTURE.md` + PIPELINES docs (infrastructure)
Create the remaining docs:
- `/docs/ARCHITECTURE.md` — repo structure, module domains, extraction direction
- `/docs/PIPELINES/MLB.md` — MLB-specific systems, HR/TB/RBI pipeline, current weaknesses
- `/docs/PIPELINES/NBA.md` — NBA boards, slips, orchestration, weaknesses
- `/docs/PIPELINES/TRACKING.md` — tracking, grading, CLV, future SQLite targets

### Priority 3 — "Outs" label perception issue (optional cosmetic)
Even with volatility reclassified, "outs over 15.5" still appears in Best Ladders / Tonight's
Best. The label "outs" still sounds suppression to users.
Optional: in `compactStat()` or `buildReason()`, rename "outs" → "pitcher depth" or add a tag
like "pitcher workload" when in pitcher context.
NOT a scoring change — purely a presentation label.

### Priority 4 — NBA scoring ecology audit
Apply same lens as MLB audit:
- `edge × modelProb` compounding in NBA tracked_bets
- Tier distribution by side
- volRealism gaps
- Offensive over recognition
- Trust-qualification gates (slipAi tierBoost, safe-tier override applicability)
Source: `nba_tracked_bets_2026-05-06.json`

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| Premium-edge override admits clown plays into safe slips | Threshold is 12% edge AND 50% modelProb AND maxOdds 150 — three layers of gating; only genuine premium ecosystems qualify |
| Halved slipAi tierBoost makes ELITE tier signal too weak | ELITE is still +0.05 (5 composite points on a 0–1 scale); sufficient signal, just no longer overwhelming |
| Outs reclassification removes outs overs from Safest entirely | Outs still shows in Best Ladders (legitimate alt-line edge); only trust surfaces drop them, which is correct |
| Cache (60s TTL) serving stale results | Wait for cache to expire; TERM 2 restart if needed |

---

## WHAT NOT TO DO

- Do NOT raise slipAi tierBoost back to 0.10 — it creates a structural under-side monopoly in slips
- Do NOT raise featured tierBoost back to 0.08 — same reason for featured
- Do NOT lower the safe-tier maxOdds cap below 150 — preserves safe identity
- Do NOT remove the premium-edge thresholds (12% edge, 50% modelProb) — they prevent clown plays
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
| **Outs volatility** | **Fixed — outs → balanced (was safe by default)** |
| modelProb compounding | Capped [0.50, 0.55] in featured + slipAi |
| Offensive over recognition | Active — stacked textureBoost (0.020/0.030) |
| Anchor cross-side | maxPerGame:2 — allows same-game cross-side |
| Anchor display ordering | Interleaved U·O·U·O·U via sortAnchorsForDisplay |
| Featured tierBoost asymmetry | Halved — ELITE 0.04, STRONG 0.02 |
| **slipAi tierBoost asymmetry** | **Halved — ELITE 0.05, STRONG 0.025** |
| **Safe-tier premium-edge override** | **Active — 12% edge / 50% modelProb / maxOdds 150** |
| **Featured safest premium-edge override** | **Active — same thresholds** |
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
