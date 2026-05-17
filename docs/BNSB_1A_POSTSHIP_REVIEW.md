# BNSB-1A POST-SHIP REVIEW — 2026-05-17

**Phase:** Bettor-Native Surface Bridge — BNSB-1A
**Sealed:** 2026-05-17T07:21:28Z (brain:checkpoint PASS, 0 failures)
**Audit type:** READ-ONLY post-ship reflection. NO patches. NO new levers.
**Purpose:** Honest inventory of what BNSB-1A actually shipped vs. what the strategic audit (`STRATEGIC_PRODUCT_AUDIT_2026-05-17.md`) framed it for; surfaces the bettor-native gaps that justify the BNSB-1B phase.

> This document was self-authored after the operator referenced it for BNSB-1B. The honesty here is deliberate: a phase that ships clean (131/131 helper unit + 21/21 prior verifiers + 14/14 runtime:verify + 5/5 probe matrix + `tsc --noEmit` clean) can still leave product-level gaps. Both are true.

---

## SECTION 1 — WHAT BNSB-1A SHIPPED (factual)

7 approved levers across 12 files touched additively + 2 NEW FE files + 1 NEW helper unit:

| Lever | Surface | What it does today |
|---|---|---|
| BNSB-1 | `RecommendationLadder.tsx` | Slot 8 (💡 BELIEVABLE UPSIDE) + slot 9 (💥 EXPLOSIVE UPSIDE) — 9-slot fixed-cardinality ladder. |
| BNSB-2 | NEW `IntelligenceStrip` in `Dashboard.tsx` | 🧠 advisory pill rendering BC-8 `bettorRealismScore` with sub-component tooltip. |
| BNSB-3 | `AiSlipsView.SlipCard` | 💬 chip row rendering optional `bettorLanguageSummary` phrases. |
| BNSB-4 | Same `IntelligenceStrip` | 13 counter chips across OE-1A (5) + OE-1B (4) + BC-1A (2) + OE-11 (2) + MLB-COV-1A (2). |
| BNSB-5 | `AiSlipsView.SlipCard` | Reinforcement ladder (raw → calibrated → ✚ reinforced → final). |
| BNSB-6 | NEW `AnalyzeSlipView.tsx` + NEW `VerdictCard.tsx` | JSON paste → POST `/ingest` → render 12-field VBI verdict. |
| BNSB-7 | `Workstation.tsx` | 📸 Analyze Slip nav tab + section router. |

Supporting backend bridges (purely payload propagation):
- `screenshotRoutes.js`: returns `verdict` + `legsParsed` per ingest result.
- `bettorLanguage.js`: `SHORT_SIGNAL_PHRASES` frozen sibling map.
- `buildSlipAi.js`: slip payload propagates `calibratedCombinedModelProb` + `oe11ReinforcementBoost` + `rawCombinedModelProb`.
- `workstationRoutes.js`: `aiSlipsSummary` extended with `bettorRealismScore` + `oe11SlipStats` + `mlbCovStats`.

---

## SECTION 2 — WHAT THE STRATEGIC AUDIT FRAMED THIS FOR

`STRATEGIC_PRODUCT_AUDIT_2026-05-17.md` Section 13 (verbatim quoted): *"surface existing canonical signals into the existing 8-tab workstation without redesigning anything."*

The audit's framing of "the repo should become VISIBLE to the bettor" (Section 17) is satisfied at the **data-bridge** level — every backend canonical field now has at least one FE consumer. The shipped LEVER COUNT matches the audit recommendation 1-to-1.

**But the audit's deeper framing** (Section 4 verbatim: *"The 8 tabs are: Tonight's Edge / Full Slate / AI Parlays / Book Radar / Risk Map / Bet Builder / First Basket / Edge Log. Every tab name is analyst-vocabulary. None say 'Upload My Ticket' or 'Analyze My Slip' or 'Why This Parlay.'"*) was bettor-native LANGUAGE and INTERACTION. BNSB-1A added one analyst-vocabulary tab ("📸 Analyze Slip" — still analyst-speak) and rendered backend payloads in mostly tabular form. The data is visible; the **interaction architecture** is not bettor-native yet.

---

## SECTION 3 — WHAT WORKS WELL

1. **Anti-fabrication discipline held.** Every FE addition reads canonical payload values verbatim. Zero client-side scoring. Zero client-side phrase synthesis. Empty values render dimmed or honest "(none surfaced)" / "no pairwise reinforcement applied" copy.
2. **Reinforcement transparency ladder.** The raw → calibrated → ✚ reinforced → final chain on SlipCard is the most operator-trusted addition; reviewers immediately understood "why the model prob shifted."
3. **9-slot recommendation ladder.** The believable + explosive slots now visible (BC-6 + OE-7 finally have a consumer); fixes the audit-flagged "slots 8+9 silently dropped" regression risk.
4. **VerdictCard 12-field render.** Canonical shape mirrored 1:1; `describeLeg(legIndex)` resolves leg integers to player+stat+side+line via `legsParsed`; honest "(none surfaced)" per absent section.
5. **Governance discipline preserved.** 131/131 helper unit assertions + 21/21 prior verifiers PASS + `tsc --noEmit` clean + brain:checkpoint PASS at 2026-05-17T07:21:28Z.

---

## SECTION 4 — WHAT FEELS WRONG (the honest list)

### 4.1 — AnalyzeSlipView is a JSON textarea, not a bettor-native experience

The current AnalyzeSlipView (`frontend/src/workstation/sections/AnalyzeSlipView.tsx`) is a `<textarea rows={8}>` with a `<button>Analyze slip</button>`. Placeholder shows `{"legs":[{"player":"Aaron Judge",...}]}`. This is dev-tool UX. A bettor opening this tab will not type JSON.

The operator framing was "screenshot-native betting intelligence workflow." The current implementation is a **JSON-paste QA tool with a 📸 icon**. The icon promises screenshots; the textarea demands JSON. The mismatch is the gap.

### 4.2 — Broken free-text fallback (fabricated UX promise)

`AnalyzeSlipView.tsx:60` sends `body.slip = { rawText: raw }` when JSON parsing fails. But `backend/pipeline/screenshots/normalizeIngestedSlip.js:260` only accepts shapes with `.player || .statFamily || .propText`. A `{ rawText }` payload returns `null` → slip is rejected → backend returns `ok=false` with no canonical error.

This violates the BNSB-1A doctrine that the FE never makes promises the backend can't deliver. The free-text affordance is a **fabricated UX promise** that I shipped because it felt natural — but it is the exact kind of "FE invents behavior backend doesn't have" pattern that anti-fabrication doctrine forbids.

### 4.3 — Dashboard IntelligenceStrip is operator-counter dump, not bettor-narrative

The strip rendering 13 counter chips (e.g., *"💥 4 explosive events tagged · 🔋 6 HR carry boosts · 🏃 3 run-production boosts · 🎯 2 pressure boosts · ⬇ 1 survivability demote · 🔗 1 pair reinforcement · 🔄 0 lineup-turnover boosts · ..."*) is dense and accurate but reads as a per-run accounting report. A bettor wants to know **"is tonight's slate spicy?"** not **"how many of each canonical counter fired."** The audit (Section 6) called this out: *"the new ecology / reinforcement / explosive narrative is computed but never read into the card render"* — BNSB-1A surfaced the **counts** but not the **narrative**.

### 4.4 — Nav tab is still analyst-vocabulary

"📸 Analyze Slip" reads as a verb-noun analyst phrase. Bettor-native phrasing: *"Check My Bet"* / *"Is This Smart?"* / *"Tell Me About This Slip"*. The audit Section 4 (*"None say 'Upload My Ticket' or 'Analyze My Slip' or 'Why This Parlay'"*) implied tab labels should sound bettor-spoken; BNSB-1A added "Analyze Slip" (one of the audit's own examples) but did not re-tone the prior 8 tabs.

### 4.5 — VerdictCard layout is tabular, not narrative

The card renders 12 sections in a flat top-to-bottom layout: Header (coherence + summary + fake-safe pill) → bettorLanguage chips → Strongest/Weakest two-column → Covariance section → Exploitability section → Availability section → Contradictions section → Fake-safe reasons section → Unresolved legs section → Raw signals section. Every section is rendered with the same visual weight.

A bettor wants narrative emphasis: **one big "you should/shouldn't" headline + the single most important reason + a quiet drill-down**. The current layout is encyclopedic, not narrative.

### 4.6 — Internal IDs leak

`ResultBlock` line 152 shows: `Slip #1 · ss_a1b2c3d4e5f6 · MLB · 3 legs · 🟢 sharp signal`. The `ss_a1b2c3d4e5f6` submission ID is a hash of internal payload bytes — has zero meaning to a bettor. Same for `archetype` strings like `personal_aggressive_stack`. Internal taxonomy leaking into operator-visible copy.

### 4.7 — Loading / empty / error states are engineer-speak

- Loading: `Analyzing…` (text only)
- Empty (no results): `"Backend accepted the submission but returned no results — verify the slip payload shape (legs[])."`
- Error: `String(e?.message || e)` — usually `"http://localhost:4000/api/ws/screenshots/ingest → 503"`

A bettor sees raw URLs, status codes, and "verify the slip payload shape" — all internal-dev language.

### 4.8 — No drag/drop, no paste, no file input

The 📸 icon implies image upload. There is no `<input type="file">`, no `ondrop` handler, no `paste` listener. The textarea is the only input affordance. The icon is a false promise — but the audit (Section 1 of VBI-FE-Upload-Surface-1A) explicitly deferred OCR/multipart to a future phase. So the gap isn't "we should ship OCR" — it's "the icon should not promise what we can't deliver, OR the experience should match what the icon promises."

### 4.9 — No way to analyze an AI parlay I'm already looking at

The bettor's most natural workflow: *"I'm looking at this AI parlay in the Slips tab; tell me more about why it's smart."* Today they'd have to copy the slip JSON, switch to Analyze Slip tab, paste, submit. There's no "Analyze this slip" affordance on the SlipCard itself.

### 4.10 — Bettor-language phrases are present-only and most slips don't carry them

The BNSB-3 surfacing of `bettorLanguageSummary` on SlipCard is correctly gated on `Array.isArray + length > 0`, but in practice the AI parlay slip payload from `buildSlipAi` does **not** populate `bettorLanguageSummary` — it's only on the screenshot ingest path (the VBI verdict). Result: BNSB-3 renders in 0% of daily AI parlays. The shipping inventory says "BNSB-3 done"; the operational reality is "the consumer is wired; the producer never produces."

---

## SECTION 5 — DIAGNOSIS

BNSB-1A made backend intelligence **technically visible**. It did not make the workstation **bettor-native**. The gap is consistent across all 10 issues in Section 4: BNSB-1A treated the FE as a render layer for canonical payloads; it did not treat the FE as a **bettor interaction surface**.

The next phase (BNSB-1B) should NOT add new backend intelligence, NOT expand ecology, NOT expand calibration. It should re-imagine the FE workstation as a place where a bettor pastes/uploads/builds/borrows a slip and gets a **narrative verdict** that reads like a smart friend's take, not a debugger's dashboard.

---

## SECTION 6 — WHAT MUST NOT BE TOUCHED IN BNSB-1B

To preserve the doctrine cemented across 21 phases:
- ZERO backend betting intelligence patches (operator directive).
- ZERO ecology expansion.
- ZERO calibration expansion.
- ZERO scoring redesign.
- ZERO new fetches / new persistence / new ML / LLM / OCR (defer; out-of-scope this phase).
- ZERO `combineLegs` math touch.
- ZERO recommendation-hierarchy architecture touch.
- ZERO MLB-COV-block / EXPL / NBA-correlation logic touch.
- All anti-fabrication invariants preserved: every visible bettor-language string traces to a canonical source.

---

## SECTION 7 — SCORE

| Dimension | BNSB-1A score |
|---|---|
| Anti-fabrication discipline | 9/10 — only the broken `rawText` fallback (§4.2) violates |
| Backend payload coverage | 9/10 — all major canonical fields now have at least one FE consumer |
| Bettor-native interaction | 3/10 — JSON-textarea + counter-chip dump + internal IDs leaking |
| Narrative density | 3/10 — tabular VerdictCard, no emotional hierarchy |
| Discoverability | 6/10 — 📸 nav tab added but label is analyst-speak; no Dashboard CTA |
| Anti-fragility (graceful empty/error states) | 4/10 — engineer-speak in all three states |
| Governance / probe matrix | 10/10 — full clean, sealed |

**Net:** BNSB-1A shipped the data bridge; BNSB-1B must ship the interaction architecture.

---

## STATUS

BNSB-1A post-ship review complete. Findings inform Phase BNSB-1B audit at `docs/BETTOR_NATIVE_INTERACTION_AUDIT_2026-05-17.md`.

The honest one-line summary:

> **The bettor can now see what the repo computes, but the repo still talks to them like a build server.**
