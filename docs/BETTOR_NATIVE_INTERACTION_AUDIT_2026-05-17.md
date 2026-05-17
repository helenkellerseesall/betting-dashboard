# BETTOR-NATIVE INTERACTION ARCHITECTURE AUDIT — 2026-05-17

**Phase under audit:** Bettor-Native Surface Bridge — BNSB-1B (NEXT phase — not yet shipped)
**Audit type:** READ-ONLY. ZERO patches. ZERO schema mutation. ZERO scoring redesign. ZERO backend betting-intelligence change. ZERO ecology expansion. ZERO calibration expansion.
**Substrate state:** 21 phases shipped · 21 verify scripts PASS · 5/5 probe matrix PASS · brain checkpoint sealed at 2026-05-17T07:21:28Z.
**Predecessor docs (REQUIRED reading):**
- `docs/STRATEGIC_PRODUCT_AUDIT_2026-05-17.md`
- `docs/VBI_FE_UPLOAD_SURFACE_AUDIT_2026-05-17.md`
- `docs/BNSB_1A_POSTSHIP_REVIEW.md` (self-authored 2026-05-17 immediately preceding this audit)

> Operator framing for BNSB-1B (verbatim from session prompt): *"the FE currently exposes backend intelligence BUT still feels: operator-facing / spreadsheet-like / emotionally flat / low-density / non-native to bettor workflows. Current Analyze Slip feels like an internal QA tool. Target: screenshot-native betting intelligence workflow."*

---

## EXECUTIVE FINDING (stated FIRST)

BNSB-1A satisfied the strategic-audit DATA-BRIDGE recommendation: every backend canonical field now has at least one FE consumer; helper unit 131/131 PASS; tsc clean; all 21 prior verifiers PASS; governance sealed. **But the bettor-native INTERACTION ARCHITECTURE is not built.** The FE renders canonical payloads as tables, chips, and counters — accurate, anti-fabricated, and emotionally flat. The 📸 Analyze Slip surface is a JSON-paste QA tool wearing a screenshot icon.

The single highest-leverage next direction:

> **Phase BNSB-1B — Bettor-Native Interaction Architecture.** A pure FE phase that re-shapes the Analyze Slip surface from a textarea-with-Submit dev tool into a low-friction, narrative-first, multi-input bettor workflow; tightens the Dashboard IntelligenceStrip from a 13-chip counter dump into a one-line bettor narrative; replaces internal-ID leakage with bettor language; and removes the broken free-text fabrication promise that BNSB-1A shipped. NO backend betting-intelligence change. NO ecology expansion. NO calibration expansion. NO OCR. NO new persistence. NO new ML. NO new fetches. The same canonical-bridge pattern (FE catches up to backend) but at the **interaction** layer instead of the data layer.

The rest of this document supports that finding with file-path + line-number citations and produces an operator-approvable lever menu in Section 11.

---

## SECTION 1 — CURRENT INTERACTION-SURFACE INVENTORY

| FE surface | Current interaction shape | Bettor-native? |
|---|---|---|
| `Workstation.tsx` NAV (9 tabs after BNSB-7) | Analyst vocabulary throughout: Tonight's Edge / Full Slate / AI Parlays / Book Radar / Risk Map / Bet Builder / First Basket / Edge Log / Analyze Slip | NO — every label is operator/analyst-shaped |
| `Dashboard.tsx` IntelligenceStrip | 1 realism pill + 13 counter chips (OE-1A 5 + OE-1B 4 + BC-1A 2 + OE-11 2 + MLB-COV 2) rendered with truthy `> 0` guard + per-chip tooltip | NO — counter dump; reads as per-run accounting, not bettor narrative |
| `AiSlipsView.SlipCard` | Header strip (American odds + EV% + prob% + slip.reasoning) + leg rows + 💬 chip row (BNSB-3) + reinforcement ladder (BNSB-5) + "Why this slip?" toggle + Build button | PARTIAL — chips + ladder are bettor-readable; bulk of card is still mono-tabular |
| `AnalyzeSlipView` (NEW from BNSB-6) | One `<textarea rows={8}>` + Analyze button + Clear button + result block per slip | NO — JSON-textarea dev-tool; placeholder shows raw JSON |
| `VerdictCard.tsx` (NEW from BNSB-6) | 12 sections rendered flat top-to-bottom with equal visual weight; each section has its own SectionBlock header | NO — tabular encyclopedia, no narrative hierarchy |
| `ResultBlock` in AnalyzeSlipView | `Slip #1 · ss_a1b2c3d4e5f6 · MLB · 3 legs · 🟢 sharp signal · 🔴 bait signal` | NO — `ss_*` submission-ID hashes leak; "archetype" tag leaks |
| Loading / empty / error states | "Analyzing…" / "Backend accepted the submission but returned no results — verify the slip payload shape (legs[])." / `http://localhost:4000/api/ws/screenshots/ingest → 503` | NO — engineer-speak throughout |

The pattern is consistent: data is correctly bridged; interaction language is consistently dev-shaped.

---

## SECTION 2 — THE FREE-TEXT FABRICATION (BNSB-1A bug surface)

`AnalyzeSlipView.tsx:60` fallback when JSON parsing fails:

```ts
body.slip = { rawText: raw }
```

`backend/pipeline/screenshots/normalizeIngestedSlip.js:260` single-leg branch:

```js
} else if (typeof raw === "object" && (raw.player || raw.statFamily || raw.propText)) {
  rawLegs = [raw]
} else {
  return null
}
```

A `{ rawText: "Aaron Judge OVER 1.5 total bases" }` payload has none of `.player` / `.statFamily` / `.propText` → returns `null` → slip rejected → backend returns `ok=false` with no canonical reason.

**This is a fabricated UX promise**: the FE told the user "paste a slip as JSON OR as free text" but the backend has no free-text parser. It violates the BNSB-1A doctrine "FE never makes promises the backend can't deliver" (the same doctrine that 21 phases of anti-fabrication discipline cemented).

**BNSB-1B must either:**
(a) remove the broken free-text affordance and tell the bettor honestly what shapes are supported, OR
(b) replace the JSON paste with a builder/borrower flow that produces a backend-valid shape every time.

Per Section 11 lever menu, (b) is the recommended path because it doubles as the screenshot-native interaction architecture upgrade.

---

## SECTION 3 — EXISTING BACKEND PARSE PATHS (what the FE can leverage WITHOUT backend change)

`normalizeLeg(raw)` accepts a single leg if any of these field aliases are populated:

| Field | Accepted alias(es) |
|---|---|
| player | `player` / `playerName` / `playerNameRaw` |
| team | `team` / `teamCode` / `teamAbbr` |
| statFamily | `statFamily` / `propType` / `stat` |
| (fallback) statFamily from text | `propText` / `propRaw` / `marketName` / `prop` |
| side | `side` / `direction` / `outcome` |
| line | `line` / `point` / `value` / `lineValue` |
| odds | `odds` / `oddsAmerican` / `americanOdds` / `price` |
| sportsbook | `sportsbook` / `book` / `bookName` |
| game | `game` / `matchup` / `gameText` |

`normalizeIngestedSlip(raw)` accepts:
- Array of legs: `[{...}, {...}]`
- Object with `.legs`: `{ legs: [{...}] }`
- Object with `.bets`: `{ bets: [{...}] }`
- Single leg object: `{ player: "...", statFamily: "..." }` (needs at least one of player / statFamily / propText)

`STAT_FAMILY_ALIASES` table (line 61+) maps ~50+ canonical aliases ("hits" / "1+ hits" / "h" / "total bases" / "tb" / "hr" / "home run" / "ks" / "strikeouts" / etc.) → canonical stat family. A "Hits OVER 1.5" string with the right field aliases parses correctly.

**Implication for BNSB-1B**: a guided 4-tap builder (player → stat → side → line → +leg) produces a backend-valid shape every time. A "borrow an existing AI parlay" affordance also produces backend-valid shapes (the AI parlay legs are already canonical). A sample-slip starter card (1-click load) produces backend-valid shapes. The textarea path can be deprecated entirely without losing functionality — and three new bettor-native paths replace it.

---

## SECTION 4 — WHAT EXISTING OCR / IMAGE / UPLOAD INFRASTRUCTURE EXISTS

Direct inspection:

| Capability | Status | Evidence |
|---|---|---|
| `multer` / `formidable` / multipart middleware | NOT INSTALLED | `backend/package.json` shows only `axios` / `cors` / `dotenv` / `express` |
| Tesseract / OCR engine | NOT INSTALLED | No `tesseract.js` / `tesseract-ocr` in package.json |
| `sharp` / image processing | NOT INSTALLED | Same |
| `<input type="file">` in any FE component | NOT PRESENT | `grep -r "input.*type.*file" frontend/src/workstation` → 0 matches |
| FE drag/drop handler (`ondrop` / `dragover`) | NOT PRESENT | Same |
| FE paste-image handler (`paste` listener for clipboard images) | NOT PRESENT | Same |
| Image-to-text / vision API integration | NOT PRESENT | Anti-fabrication doctrine forbids LLM/vision; explicitly NOT proposed |
| `screenshotRoutes.js` multipart route | NOT PRESENT | Header comment line 16: *"JSON-only ingestion for now (no multer/image upload — deferred to future phase)"* |

**Implication for BNSB-1B**: a true screenshot/image upload path requires backend dependencies that don't exist. Per operator directive *"DO NOT PATCH BACKEND BETTING INTELLIGENCE"* and per anti-fabrication doctrine, BNSB-1B must NOT pretend image upload works. The phase ships honest bettor-native paths that operate within current backend capability: guided builder, AI-parlay borrow, sample-slip starter cards, and a properly-scoped text-paste path. The 📸 icon stays (the surface IS the analysis surface), but the interaction architecture matches what the backend can actually deliver.

OCR / image upload remains deferred to a future phase (operator-deferred under VBI-11 / VBI-1F in the original VBI-FE upload audit Section 10).

---

## SECTION 5 — ROOT-CAUSE: WHY THE FE FEELS QA-TOOL-LIKE

Five reinforcing causes:

1. **Mono-font textarea.** `style={{ fontFamily: "var(--ws-mono)", fontSize: 12 }}` on the JSON paste box is a debugger font. A bettor sees code-editor styling and immediately reads it as "not for me."
2. **Placeholder is raw JSON.** The placeholder shows `{"legs":[{"player":"Aaron Judge","statFamily":"home_runs","side":"OVER","line":0.5,"odds":320}]}`. The bettor must learn a schema before they can interact.
3. **Internal-ID leakage.** `Slip #1 · ss_a1b2c3d4e5f6 · MLB · 3 legs · 🟢 sharp signal` exposes the submission hash and internal archetype taxonomy. Hash IDs are a build-server tell.
4. **Counter-density on Dashboard.** The BNSB-2/4 IntelligenceStrip renders 1 pill + up to 13 chips in a single row. The bettor reads it as a CI build status, not a slate narrative.
5. **Tabular VerdictCard.** Every canonical section (covariance / exploitability / availability / contradictions / fake-safe / unresolved / signals) renders with equal weight. There is no "headline + drill-down" emotional hierarchy. The bettor sees an encyclopedia, not a verdict.

The shared root cause across all five: **the FE adopted the backend's vocabulary and visual density instead of translating into the bettor's.** This is the same vocabulary-mismatch pattern the strategic audit (Section 4) flagged at the nav-tab level; BNSB-1A surfaced backend data but didn't translate backend vocabulary.

---

## SECTION 6 — BETTOR-NATIVE INTERACTION PRINCIPLES (target state)

Six principles for BNSB-1B-shaped FE:

| # | Principle | Concrete consequence |
|---|---|---|
| 1 | **No JSON typing.** The bettor never types or pastes JSON to use Analyze Slip. | Replace textarea with a builder/borrow/starter triad. |
| 2 | **One question, one answer.** Verdict card leads with ONE big bettor-language verdict + ONE coherence ring + ONE most-important reason. Everything else drills down. | Re-shape VerdictCard from flat-12-section to hero + collapsible detail. |
| 3 | **Bettor language only at the visible surface.** Internal IDs / archetype tags / hashes / URLs / status codes never reach a bettor-visible string. | Strip `ss_*` IDs, archetype taxonomy strings, raw URLs from rendered copy. |
| 4 | **Empty + error states feel honest, not technical.** "Submit a slip" / "I couldn't read this one — try the Build path" / "The analysis service is offline right now." | Replace `String(e?.message)` rendering with curated copy. |
| 5 | **Frictionless context.** A bettor looking at an AI parlay in the Slips tab should be one click away from "tell me more about this." | Add "Analyze this" link on SlipCard → opens AnalyzeSlipView pre-loaded. |
| 6 | **Narrative density over counter density.** Dashboard intelligence reads as one line: *"Tonight: 2 explosive environments tagged; 1 same-team reinforcement applied; 1 fake-safe pair blocked."* — not 13 chips. | Re-shape IntelligenceStrip from chip dump to one-line bettor sentence (chips become drill-down on hover/click). |

These principles do NOT change any backend behavior. They re-shape how the FE consumes existing canonical payloads.

---

## SECTION 7 — TARGET ANALYZE-SLIP INTERACTION ARCHITECTURE

Proposed shape (no patches yet — operator-approval gate at Section 11):

```
┌──────────────────────────────────────────────────────────────┐
│  📸  Check My Slip                                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   How do you want to enter your slip?                        │
│                                                              │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│   │ 🏗 Build it  │ │ 🔁 Borrow    │ │ 📋 Paste     │         │
│   │ leg by leg   │ │ from tonight │ │ a slip       │         │
│   └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                              │
│   Or start with a sample:                                    │
│   • Coors UNDER stack (fake-safe demo)                       │
│   • Same-team OVER stack (positive-cov demo)                 │
│   • Pitcher-K + opposing-hitter (contradiction demo)         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

After path selection, each path produces a backend-valid slip payload:

- **Build it leg-by-leg**: 4-tap flow per leg (player picker → stat picker → side toggle → line input → +leg). All four pickers source from existing `state.candidates` (already in workstation context) so every produced leg is canonical. NO new fetches.
- **Borrow from tonight**: list of `state.aiSlips.safe + .balanced + .aggressive + .lotto` (already in workstation context); 1-click loads a slip into the analyzer. NO new fetches.
- **Paste a slip**: kept for power users; clear "expects JSON" honesty; broken `rawText` fallback removed.
- **Sample starters**: 1-click load operator-approved demo slips (canonical shapes baked into the FE; serves as VBI engine showcase + onboarding).

Verdict card re-shapes into hero + drill-down:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ●●●○○  ECOLOGICAL COHERENCE 0.55                           │  ← coherence ring (large)
│                                                              │
│   "This ticket dies together if the game stays quiet —       │  ← verdictSummary (big headline)
│    both legs ride the same pitcher/game environment."        │
│                                                              │
│   The biggest concern: shared-game suppression between       │  ← top-priority bettor-language phrase
│   Vargas + Goodman (both UNDER hits at Coors).               │
│                                                              │
│   [ Show me the full breakdown ▾ ]                           │  ← collapsible drill-down
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The collapsible drill-down contains the existing 12-section render (preserved verbatim for forensic mode). The hero is what a bettor sees first.

---

## SECTION 8 — TARGET DASHBOARD INTELLIGENCE-STRIP RE-SHAPE

Current (BNSB-2/4 shipped):
```
🧠 realism 67/100  💥 4 explosive events tagged  🔋 6 HR carry boosts  🏃 3 run-production boosts  🎯 2 pressure boosts  ⬇ 1 survivability demote  🔗 1 pair reinforcement  ...
```

Target:
```
🧠 realism 67/100  ·  Tonight's intelligence: 2 explosive games tagged · 1 same-team stack reinforced · 1 fake-safe pair blocked.  [details]
```

The one-line bettor sentence is composed deterministically from the same canonical counters (no fabrication: only counters > 0 are mentioned; the sentence template uses `composeIntelligenceSentence(stats)` pure helper). The 13-chip strip becomes a hover/click drill-down — preserved for operator forensic use but no longer the default visible density.

---

## SECTION 9 — TARGET SLIPCARD INTEGRATION (cross-surface affordance)

Today the SlipCard ends with `[ ➜ Build this parlay ]`. Target: add `[ 🔍 Analyze this ]` as a secondary action that pre-loads this slip into AnalyzeSlipView. Single click; no JSON copying. Closes the gap §4.9 of `BNSB_1A_POSTSHIP_REVIEW.md` flagged.

Wiring: AnalyzeSlipView accepts an optional `initialSlip` prop (or reads from a small `analyzePending` slot in BuilderContext); SlipCard's new button populates that slot and routes to `section: "analyze"`. Pure FE wiring; no backend touch.

---

## SECTION 10 — TARGET NAV-LABEL RE-TONE

Strategic audit Section 4 flagged: *"Every tab name is analyst-vocabulary."* BNSB-1A added one more analyst-vocabulary tab. BNSB-1B can re-tone the NAV labels (NOT the SectionId routing keys, which stay stable for type safety and any external bookmarks).

| Today | Target re-tone (proposed; operator-approve in Section 11) |
|---|---|
| ⚡ Tonight's Edge | (keep — already bettor-feel) |
| 🎯 Full Slate | 🎯 All Tonight's Plays |
| 🎲 AI Parlays | 🎲 Smart Parlays |
| 👁 Book Radar | 👁 Best Prices |
| 📐 Risk Map | 📐 My Exposure |
| 🛠 Bet Builder | 🛠 Build a Bet |
| 🏀 First Basket | (keep — bettor vocabulary) |
| 📈 Edge Log | 📈 Track Record |
| 📸 Analyze Slip | 📸 Check My Slip |

This is purely a `NAV` array string change — zero behavior change. SectionId union stays the same; component routing stays the same. Operator may approve all, some, or none. The 📸 → "Check My Slip" rename is the highest priority (it owns the bettor-native message of the whole phase).

---

## SECTION 11 — CANDIDATE LEVER MENU (operator-approvable Phase BNSB-1B scope)

Every lever is pure FE, additive, anti-fabrication-respecting, zero backend logic change, zero schema change, zero new fetches. Levers labeled **BNSB-1B-N**.

| Lever | Surface | Effort | Smallest-safe risk | Bettor-native impact |
|---|---|---|---|---|
| **BNSB-1B-1** — Path picker in AnalyzeSlipView: 3 entry cards (Build / Borrow / Paste) + 3-4 sample starter cards. Replaces direct-to-textarea landing. | `AnalyzeSlipView.tsx` | SMALL | LOW | HIGH — first impression goes from JSON textarea to bettor menu. |
| **BNSB-1B-2** — Remove broken `rawText` free-text fallback. Paste path now requires JSON honestly; placeholder says "Paste a slip from your sportsbook or AI parlays here" + format reminder + 1 example. | `AnalyzeSlipView.tsx:60` | TRIVIAL | TRIVIAL | MEDIUM — removes fabricated UX promise; honest baseline. |
| **BNSB-1B-3** — "Borrow from tonight" path: lists `state.aiSlips.{safe/balanced/aggressive/lotto}` rows; 1-click loads into analyzer. NO new fetches; consumes existing workstation state. | NEW component inside `AnalyzeSlipView.tsx` | SMALL | LOW | HIGH — frictionless on-ramp; bettor analyzes any slip in 1 click. |
| **BNSB-1B-4** — Sample starter cards: 3-4 operator-approved canonical slips baked into a FE constants module. 1-click loads. Includes the canonical VBI fixture slips (coherent stack / Coors fake-safe / pitcher-K conflict) — perfect onboarding demo. | `frontend/src/workstation/sampleSlips.ts` (NEW) + `AnalyzeSlipView.tsx` | SMALL | TRIVIAL | HIGH — explains the engine without typing. |
| **BNSB-1B-5** — "Build it leg-by-leg" path: 4-tap flow (player picker → stat picker → side toggle → line) per leg. All pickers source from `state.candidates` (already in workstation context). NO new fetches; produces canonical-shape legs every time. | NEW component inside `AnalyzeSlipView.tsx` | MEDIUM | LOW | HIGH — the most bettor-native input path. |
| **BNSB-1B-6** — VerdictCard hero re-shape: large coherence ring + verdictSummary big headline + 1 top-priority bettor-language phrase + collapsible drill-down containing the existing 12-section render. NO new canonical fields consumed. | `VerdictCard.tsx` | MEDIUM | LOW | HIGH — solves §5 root-cause #5 (tabular → narrative). |
| **BNSB-1B-7** — Dashboard IntelligenceStrip re-shape: NEW pure helper `composeIntelligenceSentence(stats)` builds one bettor-readable sentence from the same canonical counters; chips become hover/click drill-down. NO new canonical fields consumed. | `Dashboard.tsx` (IntelligenceStrip) + NEW `intelligenceSentence.ts` helper | SMALL | LOW | HIGH — solves §5 root-cause #4 (chip dump → narrative). |
| **BNSB-1B-8** — "Analyze this" affordance on SlipCard. Wires to AnalyzeSlipView via `analyzePending` slot in BuilderContext (or equivalent). Pre-loads slip + routes to `section:"analyze"`. | `AiSlipsView.SlipCard` + `BuilderContext` + `AnalyzeSlipView` | SMALL | LOW | HIGH — closes §4.9 gap; cross-surface flow. |
| **BNSB-1B-9** — Strip internal IDs / archetype taxonomy from bettor-visible strings. ResultBlock header re-shapes from `Slip #1 · ss_a1b2c3d4e5f6 · MLB · 3 legs · 🟢 sharp signal · 🔴 bait signal` to `Your slip · MLB · 3 legs · sharp construction` (or similar bettor-spoken). | `AnalyzeSlipView.ResultBlock` + VerdictCard | TRIVIAL | TRIVIAL | MEDIUM — removes build-server tells. |
| **BNSB-1B-10** — Loading / empty / error states re-tone. Loading: "Reading your slip…". Empty: "I couldn't read that one — try the Build path or paste a different shape." Error: "The analysis service is offline. Try again in a moment." | `AnalyzeSlipView.tsx` | TRIVIAL | TRIVIAL | MEDIUM — bettor-honest state copy. |
| **BNSB-1B-11** — NAV label re-tone per Section 10 table (optional; operator may approve all/some/none). Routing keys preserved. | `Workstation.tsx` NAV array | TRIVIAL | TRIVIAL | MEDIUM-HIGH (depending on scope). |
| **BNSB-1B-12** — Forensic toggle: VerdictCard has a tiny `[ debug ]` link that reveals raw signal IDs + payload JSON for operator forensic mode. Default OFF; bettor never sees it. Preserves the engineer-mode capability while removing it from default view. | `VerdictCard.tsx` | SMALL | TRIVIAL | LOW (operator-only) but important for not losing forensic capability. |
| **BNSB-1B-13** — Helper unit `verifyBnsb1B.js`: asserts every new helper is pure (no fetch); asserts `composeIntelligenceSentence` is deterministic + anti-fabrication (only mentions counters > 0; never invents); asserts sample-slip constants resolve to canonical backend-valid shapes; asserts FE source contracts for re-shaped components. | NEW `backend/scripts/verifyBnsb1B.js` | SMALL | TRIVIAL | required for governance probe matrix. |

**Levers explicitly OUT OF SCOPE this phase** (consistent with operator directive + anti-fabrication doctrine):
- ❌ OCR / image upload / `<input type="file">` — backend dependencies don't exist; operator-deferred to future phase.
- ❌ Free-text-to-slip parser — backend would need to ship a parser; out of scope per "DO NOT PATCH BACKEND BETTING INTELLIGENCE."
- ❌ Vision / LLM-based slip reading — explicit anti-fabrication violation.
- ❌ Adaptive verdict styling / "if coherence < X make the card red" beyond what BNSB-1A already does — premature decoration.
- ❌ Mobile-optimized layout — operator-deferred (VBI-12 in prior audit).
- ❌ Persisted slip history / "Re-analyze" — BNSB-1C class per VBI-FE-Upload-Surface audit Section 9.

**Recommended smallest-safe combination for BNSB-1B**: BNSB-1B-1 + BNSB-1B-2 + BNSB-1B-3 + BNSB-1B-4 + BNSB-1B-6 + BNSB-1B-7 + BNSB-1B-8 + BNSB-1B-9 + BNSB-1B-10 + BNSB-1B-13 ship together as the cohesive bettor-native interaction architecture. BNSB-1B-5 (Build it leg-by-leg) is MEDIUM effort and could be the only deferral if operator wants the smallest possible scope; alternatively it's the most bettor-native single lever and may be the most important. BNSB-1B-11 (NAV label re-tone) is low-effort cosmetic — operator picks scope. BNSB-1B-12 (forensic toggle) is low-effort insurance.

---

## SECTION 12 — ARCHITECTURE PRESERVATION INVARIANTS (THIS AUDIT)

- ✓ ZERO code patched in this audit.
- ✓ ZERO backend betting-intelligence proposals.
- ✓ ZERO scoring redesign.
- ✓ ZERO ecology expansion.
- ✓ ZERO calibration expansion.
- ✓ ZERO new fetches / persistence / ML / LLM / OCR / vision / image-processing dependency.
- ✓ ZERO schema mutation.
- ✓ ZERO new probe categories.
- ✓ ALL anti-fabrication invariants from 21 prior phases preserved: every bettor-visible string traces to a canonical backend field or an operator-approved deterministic helper.
- ✓ Receipt + checkpoint state unaffected (audit is read-only; brain:checkpoint required at end of next code-touching session).
- ✓ 14-suite regression + 5-probe matrix unaffected (audit doesn't modify any verify*.js or probe*.js).
- ✓ FE type-safety preserved (SectionId routing keys stay stable; only display strings change).

---

## SECTION 13 — AUDIT CITATIONS (REPRODUCIBILITY)

| Citation | Verified by |
|---|---|
| `Workstation.tsx` NAV 9-tab array (post-BNSB-7) | Direct Read 2026-05-17 this session. |
| `Dashboard.tsx` IntelligenceStrip 13-chip counter render | Direct Read this session. |
| `AnalyzeSlipView.tsx` JSON-textarea shape + broken `rawText` fallback line 60 | Direct Read this session. |
| `VerdictCard.tsx` flat 12-section render | Direct Read this session. |
| `normalizeIngestedSlip.js:260` single-leg branch requiring player/statFamily/propText | Direct Read this session. |
| `normalizeLeg.js:171-200` accepted alias fields | Direct Read this session. |
| `backend/package.json` — no multer/formidable/tesseract/sharp | Direct grep this session (only axios/cors/dotenv/express). |
| `screenshotRoutes.js:16` "JSON-only ingestion for now" comment | Direct Read this session. |
| `BNSB_1A_POSTSHIP_REVIEW.md` Sections 4.1–4.10 | Self-authored 2026-05-17 immediately preceding this audit. |
| `STRATEGIC_PRODUCT_AUDIT_2026-05-17.md` Sections 4, 6, 7, 13, 17 | Re-read 2026-05-17 this session per operator directive. |
| `VBI_FE_UPLOAD_SURFACE_AUDIT_2026-05-17.md` Sections 5–10 | Re-read 2026-05-17 this session per operator directive. |
| `verifyBnsb1A.js` 131/131 PASS at checkpoint 2026-05-17T07:21:28Z | Direct run + brain:checkpoint this session. |
| `brain:continuity` + `brain:verify` PASS 2026-05-17T07:55:54Z (0 issue / 0 warn) | Direct run this session. |

---

## STATUS

Phase BNSB-1B AUDIT complete. Recommendation:

> **Ship BNSB-1B as a pure FE-interaction-architecture phase consuming the smallest-safe lever combination from Section 11.** The phase re-shapes the AnalyzeSlipView from a JSON-textarea QA tool into a Build/Borrow/Paste/Sample multi-input bettor workflow, re-shapes the VerdictCard from flat-12-section encyclopedia into headline + collapsible drill-down, re-shapes the Dashboard IntelligenceStrip from chip dump into one-line bettor sentence, removes internal-ID leakage, fixes the broken `rawText` fabrication promise, and adds the cross-surface "Analyze this" affordance from SlipCard. Zero backend touch. Zero new intelligence. Zero ecology / calibration expansion.

Doctrine to cement when shipping:
- **Bettor-native interaction architecture** — every FE entry point produces a backend-valid shape; the FE never makes promises the backend can't deliver (closes the BNSB-1A `rawText` fabrication).
- **Narrative density over counter density** — one bettor-readable sentence per intelligence surface; chips become hover/click drill-down, not default render.
- **Headline + drill-down hierarchy** — VerdictCard leads with ONE big verdict + ONE most-important reason; the encyclopedia becomes the collapsible detail.
- **Internal vocabulary stays inside the engine** — hashes / archetype tags / canonical signal IDs / status codes / URLs never reach bettor-visible strings; forensic mode is opt-in.
- **Frictionless cross-surface flow** — every place a bettor sees a slip has a one-click path to Analyze that slip.
- **Honest empty + error + loading states** — bettor-spoken copy that does not expose backend infrastructure.

The honest one-line answer to *"what should BNSB-1B become?"*:

> **The repo should stop talking to the bettor like a build server and start talking like a smart friend who's already read the canonical signals.**
