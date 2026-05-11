# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-11 (Session AR: Portfolio Audit V1 — POST /api/ws/portfolio-audit; 2 files modified; TERM 1 restart REQUIRED; pending: restart + verification + checkpoint)_

---

## PENDING OPERATOR ACTIONS — Sessions AN-final + AO + AP + AQ + AR (DO THESE FIRST, IN ORDER)

> **Session AO adds**: `POST /api/ws/slip-audit`. Requires TERM 1 restart.
> **Session AP adds**: Two-axis recommendation model in `slipAuditRoute.js`. No extra restart.
> **Session AQ adds**: `POST /api/ws/slip-audit/screenshot`. No extra restart.
> **Session AR adds**: `POST /api/ws/portfolio-audit`. `workstationRoutes.js` modified → TERM 1 restart required (covers all pending restarts).



### Step AN-1 — TERM 1 restart (stale-port kill required)
**Paste as one line into TERM 1:**
```bash
cd ~/Desktop/betting-dashboard && (lsof -ti tcp:4000 | xargs -r kill -9; sleep 2; lsof -i tcp:4000 || echo "port 4000 clear"); node backend/server.js
```

After server boots, first request to `/api/ws/state?sport=nba` MUST show — verify these exact fields in the probe lines:
```
[SLIP-PROBE] NBA tier override applied tier=safe  … dec=[1.8,7.5] … forbid=["lotto","aggressive"] mpg=2 mps=1
[SLIP-PROBE] NBA tier override applied tier=balanced … vol=["safe","balanced"] …
[SLIP-PROBE] tiers: safe=≥1 balanced=≥1 aggressive=4 lotto=4
```
Critical signals:
- `dec=[1.8,7.5]` on safe line → correct ceiling
- `forbid=["lotto","aggressive"]` on safe line → aggressive block active
- `mps=1` on safe line → same-stat stacking blocked
- `vol=["safe","balanced"]` on balanced line (NOT "aggressive") → threes excluded from BALANCED
- If either `[SLIP-PROBE] NBA tier override applied` line is missing → code did NOT load; re-run kill step

### Step AN-2 — Snapshot hard-reset + verification (TERM 2; one paste)
```bash
cd ~/Desktop/betting-dashboard && curl -s "http://localhost:4000/refresh-snapshot/hard-reset" >/dev/null && sleep 10 && node backend/scripts/runVerification.js --sport=nba --session=AN-final --verbose
```
Expected:
- exit 0 (PASS)
- `runtime_snapshot.candidates ≈ 24`
- `runtime_snapshot.total_slips ≥ 10` (safe≥1, balanced≥1, aggressive=4, lotto=4)
- `safe_lane_present` PASS (warn-severity — passes even at 1 slip)
- `safe_lane_no_alt_contamination` PASS
- `correlation_score_fields` PASS (all slips carry correlationScore)

Qualitative check (inspect actual SAFE + BALANCED slip content):
```bash
curl -s "http://localhost:4000/api/ws/state?sport=nba" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
const safe = d.aiSlips?.safe || []
const bal  = d.aiSlips?.balanced || []
console.log('SAFE slips:', safe.length)
safe.forEach((s,i) => {
  const vols = s.legs.map(l=>l.volatility)
  const fams = s.legs.map(l=>l.statFamily)
  const odds = s.combinedAmericanOdds
  console.log('  slip',i+1,'odds:'+odds,'vols:'+vols,'fams:'+fams)
})
console.log('BALANCED slips:', bal.length)
bal.forEach((s,i) => {
  const vols = s.legs.map(l=>l.volatility)
  const odds = s.combinedAmericanOdds
  console.log('  slip',i+1,'odds:'+odds,'vols:'+vols)
})
"
```
**PASS criteria for qualitative check:**
- No SAFE slip leg has `volatility: "aggressive"`
- No SAFE slip has two legs of the same statFamily
- No BALANCED slip leg has `volatility: "aggressive"` — if any does, the patch did NOT load
- No BALANCED slip has `combinedAmericanOdds` above +500 (would indicate aggressive pairs leaking through)
- AGGRESSIVE slips may (and should) show threes legs — that is correct

### Step AP-note — Sessions AP + AQ
No TERM 1 restart required for AP or AQ — only `slipAuditRoute.js` modified (loaded at require-time, not startup). The AN+AO restart covers all four sessions. AP verification is folded into Step AO-1. AQ verification is Step AQ-1 below.

### Step AO-1 — Verify slip-audit endpoint (after TERM 1 restart from Step AN-1)
```bash
curl -s -X POST http://localhost:4000/api/ws/slip-audit \
  -H "Content-Type: application/json" \
  -d '{
    "sport": "nba",
    "claimedTier": "safe",
    "legs": [
      { "player": "Cade Cunningham", "propType": "threes", "line": 1.5, "side": "over", "odds": 148 },
      { "player": "Jalen Brunson",   "propType": "threes", "line": 2.5, "side": "over", "odds": 148 }
    ]
  }' | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
console.log('semanticTier:', d.semanticTier)
console.log('tierMismatch:', d.tierMismatch)
console.log('recommendation:', d.tailRecommendation)
console.log('archetypeSummary:', d.archetypeSummary)
console.log('volLegs:', d.volatilityProfile?.legs)
console.log('safe eligible:', d.tierEligibility?.safe)
"
```
**PASS criteria (Session AP two-axis model)**:
- `semanticTier` ≠ "safe" (threes are not safe-tier)
- `tierMismatch: true`
- `semanticVerdict.honest: false` (mislabeled — actual is more volatile)
- `semanticVerdict.mismatchSeverity: "minor"` (safe→balanced is 1 tier)
- `tailRecommendation: "Lean"` — NOT "Fade" (mislabeled ≠ bad bet; coherent as balanced)
- `archetypeSummary` mentions "balanced" not "fake-safe" (minor mismatch language)
- `tierEligibility.safe: false`, `tierEligibility.balanced: true`

### Step AR-0 — Verify portfolio-audit route loaded (run immediately after TERM 1 restart)
```bash
curl -s -X POST http://localhost:4000/api/ws/portfolio-audit \
  -H "Content-Type: application/json" \
  -d '{"sport":"nba","slips":[{"slipId":"test","legs":[{"player":"Cade Cunningham","propType":"threes","line":2.5,"side":"over","odds":148},{"player":"Jalen Brunson","propType":"threes","line":1.5,"side":"over","odds":120}]},{"slipId":"test2","legs":[{"player":"Cade Cunningham","propType":"points","line":22.5,"side":"over","odds":-110}]}]}' \
  | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
console.log('slipCount:', d.slipCount)
console.log('diversificationScore:', d.diversificationScore)
console.log('overlapWarnings:', d.overlapWarnings?.map(w=>w.code))
console.log('concentrationWarnings:', d.concentrationWarnings?.map(w=>w.code))
console.log('rating:', d.structuralRiskAssessment?.rating)
console.log('playerExposure[0]:', d.playerExposure?.[0])
"
```
**PASS criteria (Session AR)**:
- `slipCount: 2`, `diversificationScore < 100` (Cade appears in both slips)
- `overlapWarnings` contains `"player_multi_slip"` (Cade in 2 slips)
- `concentrationWarnings` contains `"single_player_portfolio_risk"` (Cade in 2/2 = 100% of slips)
- `rating: "Avoid"` (critical concentration)
- `playerExposure[0].player: "Cade Cunningham"`, `slipCount: 2`

### Step AQ-1 — Verify screenshot slip-audit endpoint (no restart required; run after AO-1)
```bash
curl -s -X POST http://localhost:4000/api/ws/slip-audit/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "imageName": "twitter-slip-test.png",
    "source": "twitter",
    "sport": "nba",
    "claimedTier": "safe",
    "extractedLegs": [
      { "player": "Cade Cunningham", "propType": "threes", "line": 1.5, "side": "over", "odds": 148 },
      { "player": "Jalen Brunson",   "propType": "threes", "line": 2.5, "side": "over", "odds": 148 }
    ]
  }' | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
console.log('screenshot.imageName:', d.screenshot?.imageName)
console.log('screenshot.extractionMethod:', d.screenshot?.extractionMethod)
console.log('extractionConfidence:', d.extractionConfidence)
console.log('legCount:', d.legCount)
console.log('audit.semanticTier:', d.audit?.semanticTier)
console.log('audit.tailRecommendation:', d.audit?.tailRecommendation)
console.log('audit.semanticVerdict.honest:', d.audit?.semanticVerdict?.honest)
console.log('audit.semanticVerdict.mismatchSeverity:', d.audit?.semanticVerdict?.mismatchSeverity)
"
```
**PASS criteria (Session AQ screenshot route)**:
- `screenshot.imageName: "twitter-slip-test.png"` — metadata echoed correctly
- `screenshot.extractionMethod: "manual"` — no pretend automation
- `extractionConfidence: "manual"` — V1 honesty field
- `legCount: 2` — extracted legs counted
- `audit.semanticTier` ≠ "safe" (threes are not safe-tier)
- `audit.semanticVerdict.honest: false` (safe claimed, but actual is more volatile)
- `audit.semanticVerdict.mismatchSeverity: "minor"` (safe→balanced is 1 tier)
- `audit.tailRecommendation: "Lean"` — not "Fade" (mislabeled but viable at correct tier)

Also verify OCR guard:
```bash
curl -s -X POST http://localhost:4000/api/ws/slip-audit/screenshot \
  -H "Content-Type: application/json" \
  -d '{"imageName":"test.png","extractionMethod":"ocr","extractedLegs":[{"player":"A","propType":"points","odds":-110}]}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('status check - error should mention manual:', d.error)"
```
Expected: 400 error containing "not supported in V1".

### Step AN-3 — Checkpoint (ONLY after Step AN-2 exits 0 AND Steps AR-0 + AO-1 + AQ-1 pass)
```bash
cd ~/Desktop/betting-dashboard && node backend/scripts/checkpointRepo.js "Sessions AN+AO+AP+AQ+AR: Tier Semantic Integrity + Slip Audit V1 + Recommendation Semantics V2 + Screenshot Audit V1 + Portfolio Audit V1" && git log -1 --oneline
```

### Step AN-4 — Finalize checkpoint (sweeps Sessions H–AN)
```bash
cd ~/Desktop/betting-dashboard && bash backend/scripts/finalizeCheckpoint.sh
```

---

## CURRENT PROJECT PHASE

**SAFE/BALANCED PROFITABILITY RECOVERY — Session AN-final complete, Class D verification required**

| Phase | Status | Summary |
|---|---|---|
| Runtime archaeology (Sessions AH–AL) | ✅ DONE | live runtime path proven, stale-port issue documented, AL artifact PASS |
| Slip Ecosystem Repair V1 (Session AG) | ✅ DONE | MLB BALANCED enforcement + calibration + freeze (preserved) |
| SAFE/BALANCED Profitability Recovery V1 (Session AM) | ✅ DONE | NBA-only tier overrides; MLB untouched |
| **Tier Semantic Integrity (Session AN — 3 passes)** | ✅ CODE COMPLETE — pending Class D live verification | SAFE forbids aggressive; maxPerStat=1; BALANCED safe+balanced only; threes → AGGRESSIVE only |
| Post-recovery grading | ⬜ AFTER tonight's nightly + tomorrow's results | Confirm SAFE/BALANCED hit rates before any further loosening |
| NBA-2.C/2.D extractions | ⬜ DEFERRED | not blocking profitability work |
| AGGRESSIVE/LOTTO unfreeze (Session AG-post-2) | ⬜ BLOCKED | requires BALANCED hit rate ≥ 52% across ≥3 dates first |

---

## IMMEDIATE NEXT PRIORITIES (after Session AN-final verification)

### Priority 1 — Confirm Session AN-final live verification
Run Steps AN-1 through AN-4 above. Pass criteria: no BALANCED slip with `volatility:"aggressive"` legs, SAFE honest (≥1 slip), BALANCED present (≥1 slip), aggressive/lotto unchanged.

### Priority 2 — Tomorrow: NBA grading on Session AM slips
After tonight's NBA games settle:
```bash
node backend/scripts/runHistoricalGrade.js --sport=nba --backfill
```
Inspect `grading_summary_nba_<date>.json` — confirm SAFE + BALANCED hit rates aren't catastrophic. If SAFE ≥ 50% AND BALANCED ≥ 35% on ≥2 dates: system is finally trustworthy enough for small real-money positions on SAFE legs.

### Priority 3 — Per-leg ROI tracking (post-AM)
Use `personal_ledger.json` to track which `applyNbaTierOverrides` slip composition wins/loses. After 5+ NBA slates, decide whether to widen `decimalOddsRange`, raise `maxOdds`, or re-tighten.

### Priority 4 — MLB BALANCED parallel review (deferred)
MLB BALANCED has historically catastrophic hit rate (2.7% over 111 settled). Session AG's under-only fix has not been graded yet. Wait for ≥2 dates of post-AG MLB BALANCED grading before considering any MLB tier shape change.

---

## CRITICAL RISKS / GUARDRAILS

| Risk | Avoidance |
|---|---|
| Stale TERM 1 process serving old code | Step AM-1 KILLs all listeners on :4000 first; `[SLIP-PROBE] NBA tier override applied` log proves the new code loaded |
| MLB regression from NBA overrides | `applyNbaTierOverrides` is gated on `ctx.isNba` (set from `/^nba$/i.test(sport)`). MLB callers never enter the override branch. Verified offline. |
| Same-game over+over correlation in NBA SAFE | `nbaCorrelationEngine.pairwiseStackBoost` already prices same-game correlation into `correlationScore`. Skip applies only inside `canAddLeg` MLB-style script rule. Cap remains `maxPerGame=2`. |
| AGGRESSIVE/LOTTO unfreezing prematurely | Session AG freeze flag in `buildMlbSlipEngine.js`/`buildNbaSlipComposer.js` UNCHANGED. Workstation `buildSlipAi.js` AGGRESSIVE/LOTTO have always generated independently — their behavior unchanged this session. |
| Calibration coefficients reset | `FAMILY_CALIBRATION_COEFFICIENTS` and `SLIP_EXCLUDED_FAMILIES` UNCHANGED. |
| Cache staleness post-restart | TTL is 60s; first request after restart is cache MISS (probes confirm); hard-reset call invalidates upstream snapshot cache. |

---

## WHAT NOT TO DO

- Do NOT remove `under-only` from MLB BALANCED — historical 53.9% under hit rate vs 30% over justifies it.
- Do NOT lower `minModelProb` below 0.50 for SAFE — the calibration math degrades fast under 0.50.
- Do NOT raise NBA `decimalOddsRange` ceilings further until post-AM grading proves the current 7.5 ceiling is profitable.
- Do NOT touch `nbaCorrelationEngine` — it is the source of `correlationScore` field that downstream verification checks.
- Do NOT delete the `[SLIP-PROBE]` / `[WS-PROBE]` log lines until ≥2 sessions of stable post-AM live runtime have been verified — they are the ONLY guardrail against another stale-process drift.
- Do NOT unfreeze `FREEZE_AGGRESSIVE_LOTTO` in the nightly engines until BALANCED post-AG hit rate ≥ 52% on ≥3 dates of MLB grading.
- Do NOT add NBA-specific logic INLINE inside `buildSlipAi.js` — use the `applyNbaTierOverrides` extension point.

---

## TARGET OUTPUT (Class D PASS criteria for Session AM)

| Metric | Target | Source |
|---|---|---|
| `runtime_snapshot.candidates` | ≥ 20 | preserved from Session AL |
| `runtime_snapshot.slips_by_tier.safe` | 2-4 | recovery target |
| `runtime_snapshot.slips_by_tier.balanced` | 2-4 | recovery target |
| `runtime_snapshot.slips_by_tier.aggressive` | 2-6 | preserved |
| `runtime_snapshot.slips_by_tier.lotto` | 2-6 | preserved |
| `runtime_snapshot.correlation_fields` | = total_slips | NBA-2.C invariant |
| `safe_lane_no_alt_contamination` | PASS | preserved (NBA-3) |
| `alt_line_volatility_valid` | PASS | preserved (NBA-3) |
| `no_ineligible_family_alt_legs` | PASS | preserved (NBA-3) |

---

_Pre-Session-AM roadmap below is preserved as written by Session AG. Resume those phases AFTER Session AM verification PASSes._

---

## CURRENT PROJECT PHASE

**NBA ROUTING CONSTITUTIONALIZATION — Phase 2.A→2.D Next**

Session AB completed the NBA-2 Canonical Path Constitution Audit (read-only Opus). NBA routing health: 4.6/10. **Canonical designations made.** 9-phase migration plan (2.A→2.I) defined. See `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`.

**Critical correction to Session Z:** The "5 overlapping NBA slip builders" framing was structurally misleading. True picture: 2 active engines + 1 utility-only + 2 dead orphans. `buildNbaSlipComposer.js` is the canonical-nightly slip producer (not `buildNbaAiSlips.js`). `buildSlipAi.js` (shared) is the canonical-workstation slip regenerator.

| Phase | Status | Summary |
|---|---|---|
| Architecture Cleanup Phase 0 | ✅ DONE | 11,185 lines + 9 files + 4 empty dirs deleted |
| Architecture Cleanup Phase 1 | ✅ DONE | root docs synced to docs/ |
| Architecture Cleanup Phase 2 | ✅ DONE | normalizers.js, buildWorkstationCompactors.js, mutex unified |
| NBA Ecology Audit (Session Z) | ✅ DONE | 20-section audit; health 2.9/10; roadmap defined |
| **NBA-1 — PRA volatility fix** | ✅ DONE | snapshotSourced guard in buildFeaturedPlays + buildSlipAi; lotto volRealism 0.65 |
| **NBA-2 — Canonical path constitution audit** | ✅ DONE | health 4.6/10; canonical-nightly = buildNbaSlipComposer; canonical-workstation = buildSlipAi; 9-phase migration plan |
| **Slip Ecosystem Repair V1 (Session AG)** | ✅ DONE (pending Class D verification) | BALANCED enforcement [2-3 legs, dec 3-8, under-only, no rbis/outs]; calibration + rawCombinedModelProb; AGGRESSIVE/LOTTO freeze; droppedSlips audit; 3 files modified |
| **NBA-2.A — ARCHITECTURE.md + types.ts** | ⬜ NEXT | doc-only; mark canonical designations + dead orphans + line-count corrections |
| **NBA-2.B — nbaVolatilityResolver extraction** | ✅ DONE | `pipeline/nba/nbaVolatilityResolver.js` created; resolver is sole canonical authority; inline guards removed from buildFeaturedPlays + buildSlipAi |
| **NBA-2.C — buildNbaSnapshotCandidates extraction** | ⬜ NEXT | move from `workstationRoutes.js` → `pipeline/nba/buildNbaSnapshotCandidates.js` |
| **NBA-2.D — nbaSlipUtils extraction + buildNbaAiSlips quarantine** | ⬜ AFTER 2.C | move helper trio; deprecate function shim |
| **NBA-2.E — Dead-orphan deletion sweep** | ⬜ AFTER 2.D smoke | delete `buildNbaSlipEngine.js`; delete orphan function bodies in `buildNbaAiSlips.js` |
| **NBA-2.F — Volatility resolver propagation to nightly** | ⬜ AFTER 2.E | audit + wire `bestBetsBoard.allPlays.volatility` flow |
| **NBA-2.G — Correlation absorption (Opus)** | ⬜ AFTER 2.F | extract `nbaCorrelation.js` from DynamicSlipEngine; wire into buildSlipAi NBA branch |
| **NBA-2.H — buildNbaDynamicSlipEngine deletion** | ⬜ AFTER 2.G stable | delete after correlation absorption verified |
| **NBA-2.I — aiRange wiring (Opus)** | ⬜ AFTER 2.H + NBA-3 | wire aiRangeResolved into buildSlipAi NBA branch |
| NBA-3 — Alt line gate (NBA-only) | ⬜ AFTER 2.E (parallelizable with 2.F) | allow quality alt lines through workstation; uses extracted buildNbaSnapshotCandidates |
| NBA-4 — Ecology tier layer | ⬜ BLOCKED on NBA-3 | NBA ELITE/STRONG stamps; unifies 3-source tier-stamping |
| NBA-5 — realismScore rebalance | ⬜ BLOCKED on NBA-4 | 0.70→0.45; requires Opus audit |
| NBA-6 — Eruption environment | ⬜ BLOCKED on NBA-5 | role-spike, blowout-risk, pace detection |
| NBA-7 — First basket ecosystem | ⬜ BLOCKED on NBA-6 | alt market accumulation; wires FirstBasketView |

**Repo health: 7.2/10** structural. NBA intelligence health: **2.9/10** (Session Z). NBA routing health: **4.6/10** (Session AB). NBA-1 ✅, NBA-2 audit ✅. Primary evolution lever: **NBA-2.A→2.D execution** (Sonnet, surgical).

---

## PENDING OPERATOR ACTIONS (macOS terminal — DO THESE FIRST)

```bash
cd ~/Desktop/betting-dashboard
```

### Session AG — Class D Verification Sequence (REQUIRED before checkpoint)

**Step AG-1 — TERM 1 restart** (Session AG modified buildSlipAi.js which loads at startup):
```bash
# Kill existing server, then:
node backend/server.js
```

**Step AG-2 — Snapshot hard-reset** (Class D mandatory, wait 10s after server is up):
```bash
curl -s "http://localhost:4000/refresh-snapshot/hard-reset"
```

**Step AG-3 — TERM 2 verification** (after hard-reset completes):
```bash
node backend/scripts/runVerification.js --sport=nba --session=AG-repair
```
Expected: **exit 0**. Do NOT checkpoint if exit non-zero.

**Step AG-4 — Checkpoint** (ONLY after exit 0):
```bash
node backend/scripts/checkpointRepo.js "Session AG: Slip Ecosystem Repair V1 — BALANCED enforcement + calibration + freeze"
```

**Step AG-5 — Finalize checkpoint** (includes all Sessions H–AG):
```bash
bash backend/scripts/finalizeCheckpoint.sh
```

---

### Historical Backfill (Session AE verification — if not yet done)

**Step AE-1 — Run NBA historical backfill:**
```bash
node backend/scripts/runHistoricalGrade.js --sport=nba --backfill
```
Expected output: "ESPN scoreboard: N games" for each date, followed by settled counts.

**Step AE-2 — Verify NBA bets graded (paste as one line):**
```bash
node -e "const b=JSON.parse(require('fs').readFileSync('backend/runtime/tracking/nba_tracked_bets_2026-05-08.json','utf8'));const s=b.filter(x=>['win','loss','push'].includes(x.result));const p=b.filter(x=>x.result==='pending');const u=b.filter(x=>x.result==='unresolved');console.log('settled:',s.length,'pending:',p.length,'unresolved:',u.length,'wins:',s.filter(x=>x.result==='win').length,'losses:',s.filter(x=>x.result==='loss').length)"
```
Expected: settled > 0.

**Step AE-3 — MLB backfill (if not already done from Session AD):**
```bash
node backend/scripts/runHistoricalGrade.js --sport=mlb --backfill
```

**Step AE-4 — Retry unresolved (if any):**
```bash
node backend/scripts/runHistoricalGrade.js --sport=all --backfill --retry-unresolved
```

**Step AE-5 — Daily intelligence review:**
```bash
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08 --verbose
```

---

### Post-Repair Grading (Session AG — after next nightly run regenerates slips)

**Step AG-post-1 — Re-run grading on new slips (after nightly pipeline regenerates with fixed engine):**
```bash
node backend/scripts/runHistoricalGrade.js --sport=mlb --backfill
node backend/scripts/runHistoricalGrade.js --sport=nba --backfill
```

**Step AG-post-2 — If BALANCED tier hit rate ≥ 52% across ≥3 dates, unfreeze AGGRESSIVE/LOTTO:**
Set `FREEZE_AGGRESSIVE_LOTTO = false` in all 3 files:
- `backend/pipeline/mlb/buildMlbSlipEngine.js`
- `backend/pipeline/nba/buildNbaSlipComposer.js`
- `backend/pipeline/shared/buildSlipAi.js`
Then restart TERM 1 and verify.

---

## IMMEDIATE NEXT PRIORITIES

---

### ✅ NBA-1 — PRA Volatility Guard (COMPLETE — Session AA)

**What was done**: Added snapshotSourced "lotto" guard to `normalizeCandidate()` in both `buildFeaturedPlays.js` and `buildSlipAi.js`. Added explicit `lotto: 0.65` volRealism slot in `scoreCandidate()`. Guard: `(raw.snapshotSourced === true && raw.volatility === "lotto") ? "lotto" : classifyVolatility(raw)`.

**Remaining lotto gap** (NBA-3 scope): base odds dec ~5–9 per leg; 5-leg combo ~22–26 is borderline [20, 1500] gate. Alt lines required for robust lotto seeding.

---

### ✅ NBA-2 — Canonical Path Constitution Audit (COMPLETE — Session AB)

**What was done**: Read-only Opus audit. Full importer trace of every NBA slip-related module. Constitutional designations made. 20-section deliverable: `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`. Zero code changes.

**Canonical designations established**:
- `buildNbaSlipComposer.js` = canonical-nightly slip engine (writes nba_tracked_slips_*.json)
- `buildSlipAi.js` (shared) = canonical-workstation slip regenerator
- `buildNbaAiPicks.js` + `buildNbaPlayerOutcomePredictions.js` + `buildNbaBestBetsBoard.js` = canonical nightly board chain
- `nbaAiOutcomeRange.js` = canonical aiRange math (NEVER replace)
- `buildNbaAiSlips.js` = utility-only; main function deprecated
- `buildNbaDynamicSlipEngine.js` = dead orphan with valuable correlation logic (absorb-then-delete)
- `buildNbaSlipEngine.js` = dead orphan (delete in 2.E)

**Critical findings beyond Session Z**:
1. `aiRange` is computed by `buildNbaAiPicks` but consumed by NEITHER active slip engine. Phase 2.I scope.
2. All correlation logic lives only in the orphan `buildNbaDynamicSlipEngine.js`. Phase 2.G absorption required.
3. NBA-1 guard does NOT propagate to nightly path — `snapshotSourced` is workstation-only. Phase 2.F audit.
4. Two slip surfaces (`slipBets` + `aiSlips`) coexist with no constitutional documentation.
5. `buildNbaSnapshotCandidates` is NBA-specific but lives inline in workstationRoutes.js. Phase 2.C extraction.

---

### 🔴 Priority 1 — NBA-2.A: ARCHITECTURE.md + types.ts updates

**Scope**: Doc-only updates to reflect Session AB designations.

**Files to update**:
- `docs/ARCHITECTURE.md`:
  - "5 overlapping NBA slip builders" claim → corrected to "1 active nightly + 1 utility + 2 dead"
  - Update line counts (workstationRoutes.js: 620, buildFeaturedPlays.js: 848, buildSlipAi.js: 844)
  - Add canonical-nightly / canonical-workstation labels in module ownership table
  - Add `pipeline/shared/normalizers.js` and `pipeline/shared/buildWorkstationCompactors.js` to map
  - Add `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` to docs index
- `frontend/src/workstation/types.ts`:
  - JSDoc comment on `slipBets` → "Engine-grade slips from nightly buildNbaSlipComposer"
  - JSDoc comment on `aiSlips` → "Workstation-regenerated slips from shared buildSlipAi"
  - No type shape changes

**Model: Sonnet or Auto** — pure doc edits, no logic.
**Risk**: Zero. **TERM 1 restart**: NO.

---

### ✅ NBA-2.B — nbaVolatilityResolver Extraction (COMPLETE — Session AC)

**What was done**:
- Created `backend/pipeline/nba/nbaVolatilityResolver.js` (95 lines) — canonical authority
- `buildFeaturedPlays.js`: removed `classifyVolatility` import; added `resolveNbaVolatility` import; inline guard replaced with resolver call
- `buildSlipAi.js`: same two changes
- Resolver resolution chain: snapshot-stamped preservation → NBA-6 hook (no-op) → VOLATILITY_RULES fallback
- Expanded beyond NBA-1: now preserves ALL valid snapshotSourced stamps (threes→aggressive was silently reclassified before)

**Remaining volatility drift (next sessions)**:
- Nightly path (buildNbaBestBetsBoard → buildNbaSlipComposer) does not call resolver — Phase 2.F
- buildNbaAiSlips.js `legVolatility()` numeric scale (0.92–1.18) in dead orphan bodies — Phase 2.D/2.E

**NBA-2.C inheritance**: producer (buildNbaSnapshotCandidates stamps) stays separate from consumer (resolver). No resolver changes needed for 2.C.

---

### 🔴 Priority 2 — NBA-2.C: buildNbaSnapshotCandidates extraction

**Scope**: Move the 70-line `buildNbaSnapshotCandidates()` function out of `workstationRoutes.js` (lines 155-226) into a new sport-specific module.

**Create** `backend/pipeline/nba/buildNbaSnapshotCandidates.js` with:
- Identical export shape (the function returns the same array)
- Imports from `nbaModelSignals` and `nbaEventTeamResolve` move with it
- The `NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD` and `NBA_SNAPSHOT_TOP_N` constants move with it (export both)

**Update** `backend/routes/workstationRoutes.js`:
- Remove the inline function + the two top-of-file imports `nbaRowModelProbability`/`nbaRowEdge` and `enrichNbaRowStatLayerInputs` (now encapsulated in the extracted module)
- Add: `const { buildNbaSnapshotCandidates, NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD } = require("../pipeline/nba/buildNbaSnapshotCandidates")`

**Risk**: Near-zero. Pure refactor.
**Model: Sonnet** — 2-file change.
**TERM 1 restart**: YES.
**Why**: Prerequisite for NBA-3 (alt line gate is inside this function).

---

### 🔴 Priority 3 — NBA-2.D: nbaSlipUtils + buildNbaAiSlips quarantine

**Scope**: Move helper trio out of buildNbaAiSlips and add a deprecation shim.

**Create** `backend/pipeline/nba/nbaSlipUtils.js` containing:
- `collectFullPool(opp)` (current location: buildNbaAiSlips.js:99)
- `filterSlipLegs(legs)` (current: buildNbaAiSlips.js:56)
- `formatLeg(c)` (current: buildNbaAiSlips.js:157)
- All micro-helpers they require (`pk`, `eid`, `propBlob`, `toNum`, `slipLegPassesReality`)

**Update importers**:
- `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js:9` → import from `./nbaSlipUtils`
- `backend/pipeline/nba/buildNbaDynamicSlipEngine.js:13` → import from `./nbaSlipUtils`

**Convert `buildNbaAiSlips.js` to deprecation shim**:
- Keep file in place
- Re-export the helpers from `./nbaSlipUtils` (so any sneaky importer still works)
- Add `console.warn("[deprecated] buildNbaAiSlips: function deprecated, helpers moved to nbaSlipUtils")` at module load
- DO NOT YET delete the orphan function bodies (Phase 2.E does that)

**Verify**:
- `node --check` clean on all 4 files
- Smoke test: `curl /api/ws/state?sport=basketball_nba` returns intact aiSlips + slipBets

**Risk**: Low.
**Model: Sonnet** — 4-file change (1 new + 3 modified).
**TERM 1 restart**: YES.

---

### 🔴 Priority 5 — NBA-2.E: Dead orphan deletion sweep

**Scope**: After Phase 2.D smoke-tests clean across one nightly + one workstation cycle.

**Delete**:
- `backend/pipeline/nba/buildNbaSlipEngine.js` (601 lines)
- The orphan function bodies in `backend/pipeline/nba/buildNbaAiSlips.js`:
  - `buildSafeSlip`, `buildBalancedSlip`, `buildAggressiveSlip`, `buildLottoSlip`, `buildNbaAiSlips` (the function)
  - `lottoSeedScore`, `isLottoCeilingLeg`, `findHighestHighLadderForPlayer`, etc.
- Delete the comment in `backend/pipeline/nba/nbaAiStatFamilyRank.js:20` ("Align with buildNbaSlipEngine heuristics")

**Keep in `buildNbaAiSlips.js`**:
- The deprecation shim re-export from Phase 2.D

**Risk**: Low. Importer trace already proves zero dependencies on the deleted symbols.
**Model: Sonnet** — pure deletion.
**TERM 1 restart**: YES.

---

### 🟡 Priority 6 — NBA-2.F: Volatility resolver propagation to nightly

**Scope**: Audit `buildNbaBestBetsBoard.js` — read it (out of Session AB scope) — and confirm where `play.volatility` is set on `bestBetsBoard.allPlays`. Wire `nbaVolatilityResolve` there. Then audit `buildNbaSlipComposer.js` to verify it consumes `play.volatility` correctly.

**Pre-flight read required**: full `buildNbaBestBetsBoard.js` (440 lines).

**Risk**: Medium (depends on read findings).
**Model: Sonnet** — surgical wiring once read complete.
**TERM 1 restart**: YES.

---

### 🟡 Priority 7 — NBA-2.G: Correlation absorption (Opus)

**Scope**: Lift correlation logic from orphan `buildNbaDynamicSlipEngine.js` into a new shared module, then wire into both engines.

**Create** `backend/pipeline/nba/nbaCorrelation.js` with:
- `pairwiseStackBoost(a, b, eventMeta)` (DynamicSlipEngine line 87)
- `jointProbabilityWithCorrelation(legs, eventMeta)` (DynamicSlipEngine line 130)
- `buildEventMetaMap(pool)` (DynamicSlipEngine line 112)
- `isFastCashoutLeg(L)` (DynamicSlipEngine line 61)
- `ensureFastLegsLead(legs)` + `orderCashoutFirst(legs)` (DynamicSlipEngine line 267-284)

**Wire into `buildSlipAi.js`** (NBA-only branch via sport check):
- Compute `eventMeta` once per build call
- Add small correlation lift to slip composite scoring (cap at +0.05)
- Apply `ensureFastLegsLead` to NBA slip legs only

**Wire into `buildNbaSlipComposer.js`** (final-pass score adjust):
- Add correlation tag during slip composition
- Surface `correlationScore` in slipSummary output

**Risk**: Medium-high. Slip composition logic change. Requires full slate testing with before/after diff.
**Model: Opus** — full audit + slate test required.
**TERM 1 restart**: YES.

---

### 🟡 Priority 8 — NBA-2.H: buildNbaDynamicSlipEngine deletion

**Scope**: After Phase 2.G smoke-tests clean.

**Delete**:
- `backend/pipeline/nba/buildNbaDynamicSlipEngine.js` (843 lines)
- Comment at `backend/pipeline/nba/nbaSlipLegConstraints.js:5`

**Risk**: Low (correlation already absorbed).
**Model: Sonnet** — pure deletion.
**TERM 1 restart**: YES.

---

### 🟢 Priority 9 — NBA-3: Alt line gate (NBA-only) — parallelizable with 2.F

**Pre-requisite**: Phase 2.E complete (so `buildNbaSnapshotCandidates` exists at the new path).

**Scope**: Inside extracted `pipeline/nba/buildNbaSnapshotCandidates.js`, replace `propVariant !== "base"` blanket exclusion with NBA-aware predicate:
```javascript
function passesNbaAltLineGate(row, basePropVariant = "base") {
  const pv = String(row?.propVariant || "").toLowerCase()
  if (pv === "" || pv === "base" || pv === "default") return true
  // Allow alt lines within ±1.5 of base, max 1 per (player|stat|side)
  // Implementation TBD — see NBA-3 priority 9 in this file.
  return false
}
```

**MLB unchanged**: shared modules never call this NBA-specific gate.

**Cap alt-line spam**: per (player|stat|side), max 2 admitted (base + 1 alt).

**Risk**: Medium. May introduce noise if cap is too generous.
**Model: Sonnet** — surgical.
**TERM 1 restart**: YES.

---

### 🟡 Priority 10 — NBA-2.I: aiRange wiring into buildSlipAi (Opus)

**Pre-requisite**: NBA-3 (alt lines flow into pool).

**Scope**: NBA-only branch in `buildSlipAi.js`:
- `normalizeCandidate` preserves `aiRange` and `aiRangeResolved` if present
- New per-tier path: when sport === "nba" AND candidate has `aiRangeResolved`, prefer median rung for safe/balanced, ceiling rung for aggressive/lotto
- MLB behavior unchanged (no aiRange field on MLB candidates)

**Risk**: High. Touches shared slip builder. Feature-flagged + slate-tested before deploy.
**Model: Opus**.
**TERM 1 restart**: YES.

---

### ✅ Session AD — Historical Grading + Reconciliation Pipeline (COMPLETE — Session AD)

**What was done**: Built 6 new files in `pipeline/grading/` + `scripts/`. Zero existing files modified. 24/24 logic tests pass. 6/6 syntax clean.

- `fetchMlbGameResults.js` — MLB Stats API (statsapi.mlb.com), schedule + boxscore, all 8 stat families, parallel processing
- `fetchNbaGameResults.js` — NBA Stats API (stats.nba.com), scoreboardv2 + boxscoretraditionalv2, required headers, sequential with 500ms delay
- `gradeTrackedBets.js` — per-bet settlement, settleFromActual(), result/actualValue/settledAt, atomic write
- `gradeTrackedSlips.js` — slip parlay settlement, leg lookup by player+stat+side+line, parlay resolution logic
- `buildGradingSummary.js` — ROI/hit-rate by tier/statFamily/side, grading_summary_{sport}_{date}.json
- `runHistoricalGrade.js` — CLI runner with --sport, --date, --backfill, --retry-unresolved, --dry-run flags

**Run NOW** to unlock intelligence systems:
```bash
node backend/scripts/runHistoricalGrade.js --sport=all --backfill
```

---

### 🔴 Priority 1 — Run historical backfill (unlocks ALL intelligence systems)

**Prerequisite**: Network access from TERM 1 environment (statsapi.mlb.com is free, no auth).

**What unlocks after first backfill**:
- `buildDailyIntelligenceReview` → calibration score > 0 (was stuck at 0)
- `buildPostGameReview` → settled bets unblock review (was blocked on pending)
- `personal_ledger.json` → settled entries → real ROI tracking
- `grading_summary_{sport}_{date}.json` → per-tier hit rates visible

**Expected behavior**:
- MLB: ~1664 bets graded across 2026-05-05 to 2026-05-09
- NBA: ~27 bets graded (NBA Stats API may require header tweak — pending stays if blocked)
- Any "unresolved" records: retry with `--retry-unresolved` flag

---

### 🔴 Priority 2 — Wire actuals into daily review (first real intelligence cycle)

**Prerequisite**: Historical backfill complete (Priority 1 above).

```bash
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08 --verbose
```

---

### 🟡 Priority 12 — Wire steam/book data into daily review

Currently `steam_summary_json` and Q11-Q14 (book sharpness, steam signals) are placeholders. 30-minute additive pass.

---

### 🟡 Priority 13 — SQLite ledger read cutover (Phase S+1)

After ≥1 verified nightly run with rows accumulating in `personal_ledger` table, proceed to Phase S+1 (cut read path to SQLite).

---

### Priority 14 — Review frontend integration

The daily intelligence review produces rich JSON. Build `sections/IntelligenceReviewView.tsx` once Priority 11 is complete and real data is flowing.

---

### Priority 15 — eventId/matchup on tracked_best

All `tracked_best` entries have `eventId=null`, `matchup=null`. Tier boosts always fail. Full trace of `runMlbNight.js` → `buildMlbPropClusters.js` → `phase4Tracking.js` required.

---

### Priority 16 — Prune timing_intelligence_state.json

At 729KB with no pruning mechanism. Add max-age eviction or size cap.

---

### 🟡 Priority 3 — Wire actuals into daily review (first real intelligence cycle)

**Prerequisite**: Results entered for any past date. Calibration = 0 until this happens.

```bash
# Enter results:
node backend/scripts/updateMlbResults.js --date=2026-05-08

# Run daily review:
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08 --verbose

# Verify SQLite tables populated:
node -e "
const { tryGetDb } = require('./backend/storage/db');
const db = tryGetDb();
const dir = db.prepare('SELECT id, overall_grade, ecology_grade, calibration_grade, hit_rate, brier_score FROM daily_intelligence_reports').all();
console.log('daily_intelligence_reports:', JSON.stringify(dir, null, 2));
const cr = db.prepare('SELECT id, brier_score, ece, sample_count FROM calibration_records').all();
console.log('calibration_records:', JSON.stringify(cr, null, 2));
const ee = db.prepare('SELECT id, eruption_type, was_missed, hr_eruption_miss FROM eruption_events').all();
console.log('eruption_events:', JSON.stringify(ee, null, 2));
"
```

---

### 🟡 Priority 4 — Wire steam/book data into daily review

Currently `steam_summary_json` and Q11-Q14 (book sharpness, steam signals) are placeholders.

**Path:** Add `opts.lineShoppingResult` parameter to `runDailyIntelligenceReview()`. Pass through to `buildDailyAnswers()`. Extract steam signals from `lineShopping.steamSignals`.

This is a 30-minute additive pass — do NOT rebuild line shopping.

---

### 🟡 Priority 5 — SQLite ledger read cutover (Phase S+1)

After ≥1 verified nightly run with rows accumulating in `personal_ledger` table:

```bash
node -e "
const { tryGetDb } = require('./backend/storage/db');
const db = tryGetDb();
const cnt = db.prepare('SELECT COUNT(*) AS n FROM personal_ledger').get();
const recent = db.prepare('SELECT date, COUNT(*) AS n FROM personal_ledger GROUP BY date ORDER BY date DESC LIMIT 5').all();
console.log('total rows:', cnt.n);
console.log('by date:', JSON.stringify(recent));
"
```

If rows accumulating: proceed to Phase S+1 (cut read path to SQLite).

---

### Priority 6 — Review frontend integration

The daily intelligence review produces rich JSON. A lightweight frontend panel to surface:
- Daily grade badges (A-F)
- Major findings alert bar
- HR eruption miss alerts
- Suppressed winners list
- Process archetype donut chart

**Path**: New `sections/IntelligenceReviewView.tsx` fed by `GET /api/ws/review/daily`.
Add route in `workstationRoutes.js` serving `daily_intelligence_review_<sport>_<date>.json`.

**Do NOT build until Priority 3 is complete and real data is flowing.**

---

### Priority 7 — eventId/matchup on tracked_best

All `tracked_best` entries have `eventId=null`, `matchup=null`. Tier boosts always fail.
Full trace of `runMlbNight.js` → `buildMlbPropClusters.js` → `phase4Tracking.js` required.

---

### Priority 8 — Prune timing_intelligence_state.json

At 729KB with no pruning mechanism. Add max-age eviction or size cap.
**File**: `pipeline/shared/buildMarketTimingIntelligence.js` — state persistence section.

---

### Priority 17 — NBA-4: Build NBA Ecology Tier Layer

**Context**: NBA has no equivalent of MLB's ELITE/STRONG stamps from `buildMlbPropClusters.js`. Current workstation path uses compositeScore ranking without tier gates. buildNbaAiPicks.js has `passesEliteTierGate()` and `passesAiPickScoredFloor()` — these need to stamp candidates, not just filter.

**Path**: Add `nbaEcologyStamp(candidate, picks)` in a new `pipeline/nba/buildNbaEcologyTiers.js`. Stamps: ELITE (top 15% by compositeScore + fw + edge), STRONG (next 25%), OPPORTUNITY (rest that pass floor). Feed stamps into `buildNbaAiSlips.collectFullPool()`.

**Model: Sonnet** — additive new file, no existing file modifications except import wiring.

---

### Priority 18 — ARCHITECTURE.md update (rolled into NBA-2.A above)

Line counts stale, http/ section no longer accurate:
- `server.js` listed as 21,025 — still accurate (mutex fix only removed ~4 lines)
- `workstationRoutes.js` listed as 577 — now 620 (was 721 before Session Y)
- `http/` section no longer lists only 2 files accurately
- `pipeline/shared/` section missing `normalizers.js` and `buildWorkstationCompactors.js`
- `docs/` section missing `NBA_ECOLOGY_AUDIT_2026-05-09.md` and `NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`
- "5 NBA slip modules" claim → corrected to "1 active nightly + 1 utility + 2 dead orphans"
- Add canonical-nightly / canonical-workstation labels in module ownership table

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| AGGRESSIVE/LOTTO unfreezing prematurely | Do NOT flip `FREEZE_AGGRESSIVE_LOTTO = false` until post-repair grading shows BALANCED hit rate ≥ 52% across ≥3 dates. Freeze is in all 3 slip engines. |
| combinedModelProb calibration wrong direction | Coefficients derived from 5-date grading aggregate. If grading shows calibrated worse than raw, re-audit coefficients before unfreezing. `rawCombinedModelProb` preserved on every slip for diff. |
| HR ecology suppression | ✅ RESOLVED (Session T) — 5 fixes in buildMlbPropClusters.js |
| MLB team field omission (leanBet) | ✅ RESOLVED (Session V) — team/teamCode/awayTeam/homeTeam now persisted through full chain |
| MLB identity cache stale-team accumulation | ✅ RESOLVED (Session V) — 30d eviction + slate-aware sort + lastSeenAt tracking |
| personal_ledger.json corruption | ✅ RESOLVED (Session S) — atomic write |
| isOffensiveAttackStat divergence | ✅ RESOLVED (Session Y) — unified in normalizers.js |
| __refreshInProgress dual-mutex race | ✅ RESOLVED (Session Y) — module-level only |
| Compactors not in shared module | ✅ RESOLVED (Session Y) — buildWorkstationCompactors.js |
| Screenshot routes startup crash | Schema bootstrap runs inside first request — graceful 503 if SQLite down |
| Daily review throws + kills orchestrator | stepDailyIntelligenceReview() wrapped in try/catch — always degrades gracefully |
| Daily review overwrites past data | Uses INSERT OR REPLACE — idempotent, safe to re-run |
| Review schema breaks existing tables | applyReviewSchema uses CREATE IF NOT EXISTS everywhere — additive only |
| SQLite mirror unavailable | Graceful degradation — JSON write always succeeds first |
| betting.db journal lock (virtiofs) | macOS TERM 1 unaffected; sandbox writes degrade silently |
| NBA lotto slip starvation — classification layer | ✅ RESOLVED (Session AA) — snapshotSourced guard in both normalizeCandidate() instances. PRA now seeds as "lotto". Remaining: odds gate (NBA-3 scope). |
| NBA lotto slip starvation — odds gate | LOTTO tier gate [20, 1500] dec odds. Base legs dec ~5–9; 5-leg combo ~22–26 barely qualifies. Alt lines required. NBA-3. |
| classifyVolatility affecting MLB | VOLATILITY_RULES NOT modified. Guard is snapshotSourced-gated — MLB candidates never set snapshotSourced. Verified 0 MLB regressions. |
| NBA two-path disconnect | Workstation uses buildSlipAi.js (MLB-calibrated, canonical-workstation per Session AB). Nightly uses buildNbaSlipComposer (canonical-nightly per Session AB). Do NOT attempt to merge surfaces in NBA-2 phases — they serve different bettor needs. |
| realismScore monoculture | Do NOT touch 0.70 weight until NBA-4 ecology tier layer exists. Weight rebalance (NBA-5) requires tier stamps to be in place first. |
| aiRange resolution failure | alt line gate kills floor/median/ceiling. NBA-3 gate bypass must be NBA-specific only. Never relax globally. NBA-2.I wires aiRange into buildSlipAi NBA branch only after alt lines flow. |
| buildNbaSlipEngine.js | Do NOT modify. DEAD orphan (zero importers). Schedule for deletion in Phase 2.E. |
| buildNbaDynamicSlipEngine.js | Do NOT modify or delete. DEAD orphan but holds ALL NBA correlation logic. Phase 2.G must absorb pairwiseStackBoost + jointProbabilityWithCorrelation + isFastCashoutLeg + ensureFastLegsLead BEFORE Phase 2.H deletion. |
| buildNbaAiSlips.js function body | Do NOT add new logic to the orphan `buildNbaAiSlips()` function or its tier builders (`buildSafeSlip`, `buildBalancedSlip`, `buildAggressiveSlip`, `buildLottoSlip`). The function is unreached at runtime. Schedule for deletion in Phase 2.E. |
| Inline NBA logic in shared modules | ✅ RESOLVED (Session AC) — inline NBA-1 guards removed from both shared modules. `resolveNbaVolatility` import is the only NBA reference in shared modules now. Use same thin-adapter pattern for future NBA-specific logic (nbaCorrelation in 2.G). |

---

## WHAT NOT TO DO

- Do NOT increase textureBoost
- Do NOT blindly buff NBA overs — no uniform boosts, no fake star inflation
- Do NOT inject fake ladders — aiRange must be driven by real alt lines in pool
- Do NOT inflate random volatility — lotto requires genuine lotto-odds candidates
- Do NOT modify `VOLATILITY_RULES` for NBA lotto fix — guard only (Path A: snapshotSourced field)
- Do NOT consolidate NBA slip builders blindly — Phase 2.G must absorb correlation BEFORE 2.H deletion
- Do NOT touch `buildNbaSlipEngine.js` — DEAD orphan, deletion only (Phase 2.E)
- Do NOT touch `buildNbaDynamicSlipEngine.js` — DEAD orphan with valuable logic, absorb-then-delete (Phases 2.G + 2.H)
- Do NOT rebalance `realismScore` weight (NBA-5) until NBA-4 ecology tier layer is live
- Do NOT relax `propVariant !== "base"` gate globally — NBA-3 bypass must be NBA-specific
- Do NOT add NBA-specific code inline to `buildSlipAi.js` / `buildFeaturedPlays.js` — use the nbaVolatilityResolver pattern (Phase 2.B)
- Do NOT force over/under parity
- Do NOT touch the `[0.50, 0.55]` modelProb cap
- Do NOT raise slipAi or featured tierBoost
- Do NOT lower safe-tier maxOdds below 150
- Do NOT remove premium-edge thresholds
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT attempt server.js Phase B/C without ARCHITECTURE.md global map
- Do NOT touch `runMlbNight.js` without tracing candidate paths first
- Do NOT reopen ecology fixes
- Do NOT modify `VOLATILITY_RULES` for NBA lotto without full Opus audit (Path A preferred)
- Do NOT loosen `propVariant !== "base"` gate without controlled alt-line audit
- Do NOT cut ledger read path to SQLite until ≥1 verified nightly run confirms rows accumulating
- Do NOT build a review frontend until real data is flowing through the review engine
- Do NOT consolidate NBA slip builders without Opus ecology audit first

---

## SQLITE MIGRATION SEQUENCE (updated)

0. ~~**Phase 1: storage layer** — DONE 2026-05-07~~
1. ~~**`personal_ledger.json` → ledger table — DONE (Session S)**~~
   - **Phase S+1**: Cut read path after ≥1 verified nightly run
2. ~~**Intelligence review tables — DONE (Session W)**~~
   - `daily_intelligence_reports`, `calibration_records`, `process_classifications`
   - `ecology_grades`, `volatility_realizations`, `eruption_events`
3. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
4. `timing_intelligence_state.json` → timing state table (729KB, unbounded)
5. `book_intelligence_state.json` → book profiles table
6. `graded_props_*.json` → review/grading table

---

## DAILY REVIEW CLI REFERENCE

```bash
# Run daily review for MLB today:
node backend/scripts/runDailyReview.js --sport=mlb

# Run for specific date:
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08

# Run both sports:
node backend/scripts/runDailyReview.js --sport=all

# Dry run (no SQLite writes, no JSON file):
node backend/scripts/runDailyReview.js --sport=mlb --dry-run --verbose

# Output full JSON to stdout (for piping):
node backend/scripts/runDailyReview.js --sport=mlb --json > review.json

# Automatic (already wired): runs as Step 9 of nightly orchestrator
# Triggered by: node backend/scripts/runMlbNight.js (and nba)
```

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| NBA-2.A: ARCHITECTURE.md + types.ts updates | **Sonnet or Auto** |
| NBA-2.B: nbaVolatilityResolver extraction | **Sonnet** |
| NBA-2.C: buildNbaSnapshotCandidates extraction | **Sonnet** |
| NBA-2.D: nbaSlipUtils extraction + AiSlips quarantine | **Sonnet** |
| NBA-2.E: Dead orphan deletion sweep | **Sonnet** |
| NBA-2.F: bestBetsBoard volatility flow audit + wire | **Sonnet** |
| NBA-2.G: Correlation absorption (full slate test) | **Opus** |
| NBA-2.H: buildNbaDynamicSlipEngine deletion | **Sonnet** |
| NBA-2.I: aiRange wiring into buildSlipAi (full slate test) | **Opus** |
| NBA-3: Alt line gate bypass (NBA-specific, surgical) | **Sonnet** |
| NBA-4: Ecology tier layer (new file, additive) | **Sonnet** |
| NBA-5: realismScore weight rebalance (requires NBA-4 live) | **Opus** |
| NBA-6: Eruption environment detection | **Sonnet** |
| NBA-7: First basket ecosystem wiring | **Sonnet** |
| Root-cause audit on unknown bug | **Opus** |
| Wire steam/book data into daily review | **Sonnet** |
| SQLite migration / Phase S+1 read cutover | **Sonnet** |
| Review frontend panel | **Sonnet** |
| Doc creation / doc updates | **Sonnet or Auto** |
| Trivial edits | **Auto** |

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

**Session AC: TERM 1 restart: YES** ← required
- `buildFeaturedPlays.js` modified (resolver import, inline guard removed)
- `buildSlipAi.js` modified (resolver import, inline guard removed)
- All Session AA + Session Y restarts remain pending if not yet done

**Session AB: TERM 1 restart: NO** (read-only audit; only doc edits)
- Also pending from Session Y (if not yet restarted): `server.js` (mutex), `workstationRoutes.js` (compactor import)

**Session Z: TERM 1 restart: NO** (read-only, no change)

TERM 2 verification (Session Y — after TERM 1 restart, if not yet verified):
```bash
# 1. Verify workstation state loads (compactors must import correctly):
curl -s "http://localhost:4000/api/ws/state?sport=baseball_mlb" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); \
  console.log('lineShopping groups:', p.lineShopping?.groups?.length, 'timing:', p.timing?.classifications?.length)"

# 2. Verify mutex: trigger two concurrent refresh-snapshot calls — second should 429:
curl -s -X POST http://localhost:4000/api/refresh-snapshot &
curl -s -X POST http://localhost:4000/api/refresh-snapshot
# Expected: one 200 (or 429 "already in progress"), not two concurrent refreshes
```
