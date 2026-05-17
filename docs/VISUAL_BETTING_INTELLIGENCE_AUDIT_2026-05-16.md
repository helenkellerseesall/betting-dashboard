# VISUAL-BETTING-INTELLIGENCE-1A AUDIT — BETTOR-NATIVE SCREENSHOT INTELLIGENCE

**Date:** 2026-05-16
**Phase under audit:** Visual-Betting-Intelligence-1A (NEXT phase — not yet shipped)
**Audit type:** READ-ONLY — no patches, no schema mutation, no scoring redesign.
**Author / process:** post-bootstrap screenshot-analysis trace following the sixteen-phase governance substrate (MLB-Correlation-Engine-1A checkpoint sealed at 2026-05-16T20:12:49Z; bootstrap re-verified PASS at session open with 0 issues / 0 warns).

> Doctrine: this document inventories WHAT IS, with file-path + line-number citations. It proposes ZERO patches. The next session selects operator-approved lever(s) from Section 11 and ships them as Phase Visual-Betting-Intelligence-1A under the established additive / replay-safe / grading-safe / calibration-safe / anti-fabrication doctrine.

---

## EXECUTIVE FINDING

The screenshot intelligence infrastructure is **fully wired and operational** at the backend. `backend/pipeline/screenshots/screenshotRoutes.js` (477 lines, not a stub) is mounted at `/api/ws/screenshots/*` via `backend/routes/workstationRoutes.js:91`. The canonical 5-table schema (`screenshotSchema.js`) applies idempotently at module load. Two pure-function pipeline modules exist and are non-trivial: `normalizeIngestedSlip.js` and `classifyIngestedSlip.js`. Four endpoints are live: `POST /ingest`, `GET /list`, `GET /submission/:id`, `GET /:id`. The submission ID is a SHA-256 hash of the raw payload (idempotent re-submission safe). SQLite is graceful-degrades to 503 when unavailable.

The product gap is **EXACTLY** the same pattern as Phase MLB-Correlation-Engine-1A: canonical infrastructure exists but is not bridged to the bettor-visible surface. Specifically: (a) no FE upload affordance, (b) no unified `buildSlipAnalysis` engine that consumes a parsed_slip + applies the now-canonical MLB-COV + EXPL + market-supported-disagreement signals + grading history per leg, (c) no deterministic bettor-language phrase library, (d) no operator-friendly CLI (`npm run slip:analyze`). The current ingestion classifies submissions (10 scored dimensions + archetype) but does NOT yet enrich them with the repo-native covariance / exploitability / grading signals shipped in the last three phases.

**Critically**: this is NOT an OCR phase. The current `POST /ingest` accepts JSON only (line 16 explicit: "no multer/image upload — deferred to future phase"). The smallest-safe-step is a JSON-paste path that proves the end-to-end bettor-native loop BEFORE any OCR work.

---

## SECTION 1 — EXISTING SCREENSHOT INFRASTRUCTURE

**Canonical owner:** `backend/pipeline/screenshots/screenshotRoutes.js`.

| Surface | What it does today | Status |
|---|---|---|
| `POST /api/ws/screenshots/ingest` | Accepts JSON slip payload (single or array); runs `normalizeIngestedSlip()` → `classifyIngestedSlip()` synchronously; persists to `screenshot_submissions` + `parsed_slips` + `slip_classifications` atomically. | ACTIVE — not stub |
| `GET  /api/ws/screenshots/list` | Paginated list (50/page default, max 200) of parsed slips + classification scores. | ACTIVE |
| `GET  /api/ws/screenshots/submission/:id` | Full submission record + all parsed slips + classifications. | ACTIVE |
| `GET  /api/ws/screenshots/:id` | Single parsed slip with classification. | ACTIVE |
| Schema bootstrap | `applyScreenshotSchema(db)` called once at module load (line ~48); idempotent (CREATE TABLE IF NOT EXISTS). | ACTIVE |
| SQLite degradation | Returns 503 + diagnostic when DB unavailable; never crashes. | ACTIVE |

**Module is wired into the express app** via `backend/routes/workstationRoutes.js:67` (require) + `:91` (`router.use("/screenshots", screenshotRoutes)`).

**Sibling pure-function modules** (also in `backend/pipeline/screenshots/`):
- `normalizeIngestedSlip.js` — raw JSON → canonical parsed_slip shape (pure function; not a stub).
- `classifyIngestedSlip.js` — parsed_slip → 10-dimension classification + archetype (pure function; not a stub).

**What's NOT wired today:**
- No image-upload middleware (`multer` / `formidable`). `screenshotRoutes.js:16` explicitly defers.
- No OCR utility (no `tesseract` / vision-api in `backend/package.json` — only `axios`, `cors`, `dotenv`, `express` per the agent trace).
- No FE upload surface (`frontend/src/workstation/sections/AiSlipsView.tsx` is pure display).
- No bridge from `parsed_slips` → canonical `predictionId()` → covariance/exploitability/grading enrichment (the `classifyIngestedSlip` outputs 10 scored dimensions, but does NOT invoke `pairCorrelationScore`, `marketSupportFor`, `candidateIsHardDropAvailability`, or look up grading history per leg).

---

## SECTION 2 — SCHEMA INVENTORY

**Canonical owner:** `backend/storage/screenshotSchema.js` (341 lines).

### `screenshot_submissions` (lines 58-77)

```
id            TEXT PRIMARY KEY          -- SHA-256 of raw payload
submitted_at  TEXT                       -- auto-timestamp
source_type   TEXT                       -- internal | personal | screenshot | twitter | discord | viral | guru | sportsbook
source_label  TEXT                       -- e.g. "@SomeGuru" / "DraftKings promo"
sport         TEXT                       -- mlb | nba | nfl | null
slate_date    TEXT                       -- YYYY-MM-DD
image_path    TEXT                       -- NULL today; reserved for OCR phase
raw_text      TEXT                       -- pasted text / OCR output
raw_json      TEXT                       -- full submitted JSON payload
status        TEXT                       -- pending | parsed | classified | graded | archived
```

### `parsed_slips` (lines 109-136)

Canonical leg shape inside `legs_json` (per schema comment lines 90-104):

```json
{
  "player":     "Shohei Ohtani",
  "team":       "LAD",
  "statFamily": "hits",        // normalized
  "propRaw":    "1+ Hits",     // original text
  "side":       "over",        // over | under | yes | no
  "line":       0.5,
  "odds":       -145,
  "sportsbook": "DraftKings",
  "game":       "LAD vs NYM",
  "eventId":    null
}
```

Top-level parsed_slip columns: `id`, `submission_id`, `legs_json`, `combined_odds`, `combined_dec`, `potential_payout`, `stake`, `sportsbook`, `attribution`, `linked_internal_id`, `total_legs`, `source_type`, `sport`, `slate_date`.

### `slip_classifications` (lines 180-222)

10 scored dimensions (0.0-1.0): `realism_score`, `structural_quality`, `correlation_quality`, `hidden_sharpness`, `emotional_bait`, `volatility_structure`, `payout_realism`, `exploit_potential`, `appeal_score`, `ecology_fit`. Plus `composite_score`, `archetype` (sharp_aggressive | recreational_chase | guru_bait | viral_lotto | safe_grind | sportsbook_trap | unknown), `archetype_tags`, `ecology_tags`.

### `bettor_profiles` (lines 251-282)

Longitudinal per-source-entity tracking: stat-family preferences, side bias, volatility mix, sportsbook preferences, rolling ROI.

### `outcome_links` (lines 303-327)

Per-leg grading after game completion. Links parsed_slip leg → actual results via (player, stat_family, side, line, date).

**Verdict:** Schema is complete enough for Phase 1A. The `legs_json` shape provides EVERY field `intelligence.predictionId()` needs (player, statFamily, side, line, sportsbook). The agent's trace also notes a graded-slip shape from `runtime/tracking/mlb_tracked_slips_2026-05-15.json` (44 slips, leg shape: `player`, `team`, `teamCode`, `eventId`, `matchup`, `statFamily`, `side`, `line`, `oddsAmerican`, `result`) — slightly different field names (`oddsAmerican` vs `odds`, presence of `teamCode`) but functionally equivalent — useful as a SHAPE TEMPLATE for the analysis engine.

---

## SECTION 3 — OCR / UPLOAD CAPABILITY

**`backend/package.json` dependencies:** `axios`, `cors`, `dotenv`, `express` only.

| Capability | Status |
|---|---|
| OCR (tesseract / vision-api) | **NOT FOUND** — deliberate (deferred to future phase). |
| Image upload middleware (multer / formidable) | **NOT FOUND** — deliberate (`screenshotRoutes.js:16` explicit). |
| Parser stub | **EXISTS AND FULLY IMPLEMENTED** — `normalizeIngestedSlip.js` + `classifyIngestedSlip.js`. Not stubs; accept JSON only. |
| Per-payload SHA-256 hash for idempotent submission ID | **WIRED** — line ~134 of screenshotRoutes.js. |

**Verdict:** the JSON-paste path is the correct smallest-safe predecessor to any future OCR phase. Anti-fabrication: never invent an OCR pipeline before the analysis pipeline is proven.

---

## SECTION 4 — CANONICAL PROP NORMALIZATION BRIDGE

**Canonical owner:** `backend/storage/intelligence.js`.

| Helper | Line | Behavior |
|---|---|---|
| `normPlayer(s)` | 177 | NFD decomposition + combining-mark strip → lowercase → trim. `"Luka Dončić"` → `"luka doncic"`. |
| `normFam(s)` | 144 | Lowercase + collapse all whitespace AND underscores. `"Total Bases"` → `"totalbases"`. |
| `normBook(s)` | 212 | Delegates to `canonicalBook()` (imported line 42 from `pipeline/shared/buildLineShoppingIntelligence`) → lowercase → trim. `"DK"` → `"DraftKings"` → `"draftkings"`. |
| `predictionId(runDate, sport, player, statFamily, side, line, book)` | 243 | Joins normalized components with `\|` → canonical join key. |

**Exact signature (line 243):**

```js
function predictionId(runDate, sport, player, statFamily, side, line, book) {
  const player_n     = normPlayer(player)
  const statFamily_n = normFam(statFamily)
  const side_n       = String(side || "").toLowerCase()
  const line_n       = String(safeNum(line) ?? "")
  const book_n       = normBook(book)
  return [String(runDate).slice(0, 10), String(sport).toLowerCase(),
          player_n, statFamily_n, side_n, line_n, book_n].join("|")
}
```

**Example:** `2026-05-08|mlb|juan soto|totalbases|under|1.5|draftkings`

**MINIMUM fields a parsed_slip leg MUST provide** to deterministically resolve to a canonical `prediction_id`: `player`, `statFamily`, `side`, `line`, `sportsbook`. Plus `runDate` + `sport` from the submission envelope. All are present in the existing `parsed_slips.legs_json` schema (Section 2).

**Anti-fabrication preserved:** when `sportsbook` is absent, the join key includes an empty string component (`""`). Same logical prop across two sources (one specifying DK, one unspecified) produces DIFFERENT canonical IDs — intentional: the system never fabricates a sportsbook identity.

---

## SECTION 5 — SPORTSBOOK MAPPING LAYER

**Canonical owner:** `backend/pipeline/shared/buildLineShoppingIntelligence.js:61-80` (BOOK_ALIASES table) + `:76-80` (`canonicalBook(raw)`) + `:537` (export).

```js
const BOOK_ALIASES = {
  draftkings: "DraftKings", dk: "DraftKings",
  fanduel:    "FanDuel",     fd: "FanDuel",
  bet365:     "Bet365",
  caesars:    "Caesars",     williamhill: "Caesars",
  fanatics:   "Fanatics",
  betrivers:  "BetRivers",
  hardrock:   "Hard Rock",   hardrock_bet: "Hard Rock",
  "betonline.ag": "BetOnline", betonline: "BetOnline",
  betmgm:     "BetMGM",
  pointsbet:  "PointsBet",
  fliff:      "Fliff",
  espnbet:    "ESPN Bet",
  bally:      "Bally Bet",
}
function canonicalBook(raw) {
  if (!raw) return null
  const k = String(raw).toLowerCase().replace(/[\s_-]/g, "")
  return BOOK_ALIASES[k] || String(raw).trim()
}
```

**`intelligence.js:42` imports this canonical function** — single source of truth across the entire repo. `normBook()` wraps it and adds final lowercase + trim. A screenshot leg with `sportsbook: "DraftKings"` and another with `sportsbook: "DK"` both resolve to `"draftkings"` in the join key.

**Unknown books** are preserved verbatim at the trimmed form (fallback `String(raw).trim()`). Never fabricated; future audit hook surfaces them.

---

## SECTION 6 — FE UPLOAD SURFACE

`frontend/src/workstation/sections/AiSlipsView.tsx` is **pure display**. SlipCard / SlipLegRow components render AI-generated slips; no file input, no text-paste area, no POST to `/ingest`.

**Closest existing FE surface that could host an upload card:** any of the section components under `frontend/src/workstation/sections/`. The cleanest pattern: NEW `UploadSlipCard.tsx` sibling of `AiSlipsView.tsx`, hosting a `<textarea>` for JSON paste (no file input yet — text-only mirrors the backend's JSON-only contract). POSTs to `/api/ws/screenshots/ingest`. Renders the response's classification archetype + composite score + (when VBI-2 ships) the analysis verdict.

**Honest assessment:** the FE surface is the most visible gap, but it's a thin wrapper around an already-active backend endpoint. The risk profile is small.

---

## SECTION 7 — INTEGRATION POINTS FOR REPO-NATIVE INTELLIGENCE

Every signal the bettor-native analysis needs is already a pure function in the canonical-authority layer. The Phase 1A bridge is composition, not new math.

| Intelligence | Canonical authority | Exact call |
|---|---|---|
| Exploitability — market-supported disagreement | `buildFeaturedPlays.js:165-178` | `marketSupportFor(legShaped, shopMap)` → `{ bookCount, consensusConfidence, supported }` |
| Availability — hard-drop OUT | `buildFeaturedPlays.js:187-190` | `candidateIsHardDropAvailability(leg)` → bool |
| MLB pair covariance — opposing-team pitcher-K vs hitter-OVER | `buildMlbCorrelationEngine.js:114-149` | `pairCorrelationScore(legA, legB)` → -1.0 / -0.5 / 0 / +0.5 |
| MLB same-game UNDER suppression | `buildSlipAi.js:canAddLeg` (~line 568-586) | `canAddLeg(slipLegs, candidate, tpl)` → `{ ok, reason }`; check `reason === "shared_game_suppression_exposure"` |
| Family calibration coefficients | `buildSlipAi.js:54-72` | `FAMILY_CALIBRATION_COEFFICIENTS[statFamily] ?? 0.85` |
| Canonical prediction_id | `intelligence.js:243` | `predictionId(runDate, sport, player, statFamily, side, line, book)` |
| Per-leg grading history | `outcome_snapshots` SQLite table (canonical id = `predictionId` output) | `SELECT hit FROM outcome_snapshots WHERE id = ?` (multi-row; compute hit rate); also `runtime/tracking/*_tracked_slips_*.json` for slip-level results |
| MLB role predicates | `buildMlbCorrelationEngine.js` exports `isOverSide` / `isUnderSide` / `isHitterCountingProp` / `isPitcherKProp` / `isHomeRunsProp` (Phase MLB-Correlation-Engine-1A additive exports) | direct call |

**Verdict:** every required signal is a deterministic, pure-function call. No new math. No ML. The Phase 1A engine is a pure composition layer.

---

## SECTION 8 — GRADED-SLIP CANONICAL SHAPE

**Confirmed first-hand this session:** `runtime/tracking/mlb_tracked_slips_2026-05-15.json` exists with **44 slips**. (The agent's trace incorrectly reported "NOT FOUND" — verified against direct read.) Ten such files total in `runtime/tracking/`.

**Top-level slip keys:** `id`, `date`, `type`, `legCount`, `legs`, `combinedDecimalOdds`, `combinedAmericanOdds`, `combinedModelProb`, `combinedImpliedProb`, `edge`, `ev`, `result`, `settledAt`.

**Per-leg keys:** `id`, `player`, `team`, `teamCode`, `eventId`, `matchup`, `statFamily`, `side`, `line`, `oddsAmerican`, `result`.

**This is the SHAPE TEMPLATE for the analysis-engine output** for already-built slips. The parsed_slip leg shape is slightly different (`odds` vs `oddsAmerican`; `sportsbook` not `teamCode`) — the VBI-3 normalizer should produce a uniform shape that both surfaces accept.

---

## SECTION 9 — WHERE BETTOR-NATIVE FLOW BREAKS

Concrete inventory of gaps (each cited):

| Gap | Status | Citation |
|---|---|---|
| **(a) FE upload affordance** | MISSING | No `UploadSlipCard.tsx` or equivalent. `AiSlipsView.tsx` is pure display. |
| **(b) OCR utility** | MISSING (deliberate) | No `tesseract`/`vision-api` in `backend/package.json`. `screenshotRoutes.js:16` defers. |
| **(c) Parser stubs** | PRESENT — NOT MISSING | `normalizeIngestedSlip.js` + `classifyIngestedSlip.js` are fully implemented pure functions. |
| **(d) Submission → parsed_slips wiring** | WIRED | `screenshotRoutes.js:~134-211` (atomic INSERT to all 3 tables). |
| **(e) parsed_slip → canonical predictionId resolver** | MISSING (the bridge) | `intelligence.predictionId()` exists but is NOT called inside `classifyIngestedSlip.js`. |
| **(f) Analysis engine (covariance + exploitability + grading per leg)** | MISSING | No `pipeline/shared/buildSlipAnalysis.js` consuming `pairCorrelationScore` + `marketSupportFor` + `candidateIsHardDropAvailability` + grading history. |
| **(g) Bettor-language phrase library** | MISSING | No `pipeline/shared/bettorLanguage.js` mapping canonical signals → operator-readable phrases. Anti-LLM critical safeguard. |
| **(h) Operator CLI (`npm run slip:analyze`)** | MISSING | No `backend/scripts/slipAnalyze.js`. |
| **(i) Per-leg historical hit-rate lookup** | MISSING | `outcome_snapshots` is queryable but no helper. |
| **(j) FE rendering of analysis verdict** | MISSING | Even when the engine produces a verdict, no FE surface displays it. |

**Pattern:** the gap is exactly the same as Phase MLB-Correlation-Engine-1A — canonical engines exist, bridge to operator-visible surface is missing. The fix is composition, not invention.

---

## SECTION 10 — VISUAL-BETTING-INTELLIGENCE / SLIP-ANALYSIS / BETTOR-LANGUAGE / COVARIANCE-INTEGRATION PLANS

### Visual-Betting-Intelligence plan

1. Bettor uploads a screenshot OR pastes a slip as JSON.
2. Backend ingests → normalizes legs → classifies → persists.
3. NEW: backend runs a deterministic analysis pass per leg + per pair: resolves each leg to canonical `prediction_id`, looks up grading history, applies `pairCorrelationScore` per pair, applies `marketSupportFor` per leg, applies `candidateIsHardDropAvailability` per leg, computes `combineLegs`-style calibrated joint probability for context only (not for replacing the sportsbook payout).
4. NEW: backend renders each signal via deterministic bettor-language phrases ("this dies together — same ecological event"; "books agree this is a real edge"; "pitcher-K vs opposing hitter overs — these contradict"; etc.).
5. NEW: FE displays the analysis verdict in a single card alongside (or below) the parsed legs.

### Slip-Analysis Engine plan

Pure module `backend/pipeline/shared/buildSlipAnalysis.js`:
- Input: `{ parsedSlip, sport, date, runtimeContext }`.
- For each leg: resolve canonical id, lookup grading history, apply exploitability + availability checks, compute calibrated single-leg modelProb if available.
- For each pair: `pairCorrelationScore` → classify (`positive_stack` / `pitcher_hitter_conflict` / `shared_game_suppression` / `neutral`).
- For the slip: compute `combineLegs` calibrated joint probability; identify strongest + weakest leg by edge; flag contradictions.
- Output: `{ verdict: { strongest, weakest, contradictions, signals, ecologicalCoherence, calibratedJointProb }, rawSignals }`.
- Pure function. No I/O except SQLite read (and ONLY when DB available — anti-fabrication: returns `null` for grading-history fields when SQLite unavailable).

### Bettor-Language Response plan

Pure module `backend/pipeline/shared/bettorLanguage.js`:
- A deterministic constant map `SIGNAL_PHRASES`:
  ```js
  shared_game_suppression_exposure:
    "These legs die together — they're really one bet on the same pitcher/game environment."
  mlb_pitcher_hitter_conflict:
    "Pitcher strikeout over and opposing hitter over contradict — they can't both be right."
  market_supported_disagreement:
    "Books agree this is a real edge — multiple sportsbooks back the disagreement."
  positive_stack:
    "Same-team hitter overs reinforce each other when the opposing pitcher struggles."
  hard_drop_availability:
    "Heads up — this player is listed OUT."
  ```
- A renderer function that takes a `verdict` object and returns plain-English summary lines, in priority order.
- **NO LLM. NO GPT. ZERO opaque commentary.** Every phrase is operator-approved, deterministic, traceable to a canonical signal ID.

### Covariance-Integration plan

The integration is the same as MLB-Correlation-Engine-1A's canAddLeg pattern, applied READ-ONLY (the engine doesn't block — the user already placed the bet; the engine TELLS them what would have blocked it):
- Per pair: call `pairCorrelationScore(legA, legB)`. Surface -1.0 cases as `pitcher_hitter_conflict`. Surface +0.5 cases as `positive_stack`.
- Per slip: detect ≥2 same-game hitter-counting UNDERs as `shared_game_suppression_exposure` (mirrors MLB-COV-2 predicate; reuse `isUnderSide` + `isHitterCountingProp`).
- All signals collected into the verdict alongside per-leg exploitability + availability flags.

### Longitudinal Screenshot-Intelligence Strategy

Phase 1A persists every analyzed slip to the existing `parsed_slips` + `slip_classifications` tables. Phase 1B (future) extends:
- `slip_classifications` augmented with a `verdict_json` column (additive) carrying the deterministic analysis output for each submission.
- Per-source `bettor_profiles` accumulate verdict patterns over time ("this Twitter handle consistently produces shared-game-suppression slips").
- 30-day retrospective: "of the slips we flagged as `pitcher_hitter_conflict`, what fraction lost?"
- Eventual: drives `npm run screenshot:status` operator command surfacing aggregate intelligence.

---

## SECTION 11 — CANDIDATE LEVERS (operator-approvable Phase Visual-Betting-Intelligence-1A scope)

The audit ends here. Each lever below is deterministic, additive, anti-fabrication-respecting, and reuses existing canonical authorities. NO new ML. NO new persistence (Phase 1A uses existing 5-table schema). NO OCR.

| Lever | Surface touched | Risk | Smallest-safe |
|---|---|---|---|
| **VBI-1** — Activate JSON-paste flow end-to-end (operator can already `curl` `POST /ingest`; this just blesses it as the canonical entry point). | None — existing route. | TRIVIAL | ★ smallest. Zero code. |
| **VBI-2** — NEW `pipeline/shared/buildSlipAnalysis.js` (~200 lines): pure-function unified analysis engine consuming canonical signals. | `pipeline/shared/` (new file). | LOW | ★ smallest. Pure composition; reuses every existing helper. |
| **VBI-3** — NEW `pipeline/shared/normalizeUploadedLeg.js` (~80 lines): pure resolver `{ raw } → canonical prediction_id` via existing `intelligence.predictionId`. Returns `null` when insufficient. | `pipeline/shared/` (new file). | LOW | ★ smallest. Wraps existing canonical. |
| **VBI-4** — NEW `pipeline/shared/bettorLanguage.js` (~60 lines): deterministic phrase dictionary + renderer. No LLM. | `pipeline/shared/` (new file). | TRIVIAL | ★ smallest. Pure lookup table. |
| **VBI-5** — Wire VBI-2 into `screenshotRoutes.js`: on `POST /ingest`, after classifyIngestedSlip, also run `buildSlipAnalysis` and persist a `verdict_json` summary onto the parsed_slip row (additive column via `ALTER TABLE`). | `screenshotRoutes.js` + schema migration. | MEDIUM | Additive column; safe IF schema migration is `ALTER TABLE … ADD COLUMN IF NOT EXISTS` style. |
| **VBI-6** — NEW operator CLI `backend/scripts/slipAnalyze.js` + `npm run slip:analyze` script. Reads JSON from stdin or `--file=`, runs full normalize + classify + analyze chain, prints bettor-language verdict. | `backend/scripts/` (new file) + `backend/package.json` (script entry). | LOW | ★ smallest after VBI-2/3/4. Pure offline tool; operator-verifiable before FE. |
| **VBI-7** — NEW `frontend/src/workstation/sections/UploadSlipCard.tsx`: `<textarea>` JSON paste + Submit button → POST `/api/ws/screenshots/ingest` → display verdict (bettor-language phrases) inline. | `frontend/src/workstation/sections/` (new file) + 1-line Dashboard wiring. | MEDIUM | Pure FE wrapper; no client-side scoring. |
| **VBI-8** — Helper unit test `backend/scripts/verifyVisualBettingIntelligence1A.js`: pure-function assertions on VBI-2/3/4. | `backend/scripts/` (new file). | LOW | Required for governance probe matrix. |
| **VBI-9** — Per-leg historical hit-rate lookup helper `pipeline/shared/buildSlipAnalysis.js#getLegHistory(prediction_id)`. Read-only SQLite. Returns `null` when SQLite unavailable or sample size < N. | Inside VBI-2 file. | LOW | Anti-fabrication: never invent a hit rate. |
| **VBI-10** — Multipart upload + OCR (Tesseract) for actual screenshot images. | `backend/package.json` + `screenshotRoutes.js`. | HIGH | **HELD** — out of Phase 1A scope per operator directive ("This phase is NOT OCR perfection / computer-vision research"). |
| **VBI-11** — `bettor_profiles` longitudinal accumulation (verdict patterns per source). | `screenshotSchema.js` + writer. | MEDIUM | HELD for future phase. |
| **VBI-12** — Operator `npm run screenshot:status` per-source verdict-pattern inspector. | `backend/scripts/` (new file). | LOW | HELD for after 1A observation window. |

**Recommended smallest-safe combination:** VBI-2 + VBI-3 + VBI-4 + VBI-6 + VBI-8 ship together. They form a complete end-to-end JSON-paste-to-bettor-verdict pipeline that can be exercised entirely from the CLI before any FE wiring. VBI-5 (persist verdict to SQLite) and VBI-7 (FE upload card) are second priority — they're additive but require schema migration (VBI-5) or React work (VBI-7). VBI-9 (per-leg history) is a clean addition that depends on outcome_snapshots being populated. VBI-10 (OCR) is explicitly held per operator framing.

---

## SECTION 12 — LONGITUDINAL OBSERVABILITY (for future operator-approval gates)

Phase 1A should ship with these observability hooks so the operator can quantify the bettor-native flow's quality over time:

| Hook | Effort | Operator value |
|---|---|---|
| `[VBI-1A] analyzed N slips: X strongest-leg / Y weakest-leg / Z contradictions / W shared_game_suppression / V pitcher_hitter_conflict` per `buildAiSlips` analog run | Trivial | Quantifies real-world bettor behavior. |
| `mlbCovStats` analog `verdictStats` returned on `POST /ingest` response | Trivial | Per-submission accounting. |
| Future: `npm run screenshot:status` per-date / per-source aggregate | Medium | Surfaces operator pattern intelligence. |

---

## SECTION 13 — AUDIT CITATIONS (REPRODUCIBILITY)

| Citation | Verified by |
|---|---|
| `backend/pipeline/screenshots/screenshotRoutes.js` (lines 9-13, 16, 23-24, 134-211; mounted at workstationRoutes.js:91) | Direct `head` + `grep` this session. |
| `backend/storage/screenshotSchema.js` (lines 22-26, 58-77, 90-104, 109-136, 180-222, 251-282, 303-327) | Explore subagent trace. |
| `backend/storage/intelligence.js` (lines 42, 144, 177, 212, 243-292) | Direct `grep` this session. |
| `backend/pipeline/shared/buildLineShoppingIntelligence.js:61-80, 76-80, 537` (BOOK_ALIASES + canonicalBook + export) | Direct `grep` this session. |
| `backend/pipeline/shared/buildFeaturedPlays.js:165-178, 187-190` (marketSupportFor + candidateIsHardDropAvailability) | Prior phase patches (Market-Exploitation-1A). |
| `backend/pipeline/mlb/buildMlbCorrelationEngine.js:114-149` (pairCorrelationScore) + role predicates exported in Phase MLB-Correlation-Engine-1A | Prior phase patches. |
| `backend/pipeline/shared/buildSlipAi.js:54-72` (FAMILY_CALIBRATION_COEFFICIENTS) + `canAddLeg` (~line 568-586 MLB-COV-2/3 gates) | Prior phase patches. |
| `runtime/tracking/mlb_tracked_slips_2026-05-15.json` — 44 slips; leg keys `[player, team, teamCode, eventId, matchup, statFamily, side, line, oddsAmerican, result]` | Direct `node -e` read this session (CORRECTED from agent's NOT FOUND claim). |
| `backend/package.json` dependencies: `axios`, `cors`, `dotenv`, `express` only | Explore subagent trace. |
| `frontend/src/workstation/sections/AiSlipsView.tsx` pure-display | Direct `find` this session. |

---

## ARCHITECTURE PRESERVATION INVARIANTS (THIS AUDIT)

- ✓ ZERO code patched.
- ✓ ZERO schema mutation.
- ✓ ZERO scoring redesign.
- ✓ ZERO grading / replay / lineage / persistence / orchestrator touch.
- ✓ ZERO `FAMILY_CALIBRATION_COEFFICIENTS` / volatility rules / portfolio thresholds / tier templates / market-pipeline / recommendation-hierarchy / MLB-COV / EXPL change.
- ✓ ZERO NBA correlation path touch.
- ✓ Receipt + checkpoint state unaffected (audit is read-only; brain:checkpoint still required at end of next code-touching session).

---

## STATUS

Phase Visual-Betting-Intelligence-1A AUDIT complete. Recommended next action: operator selects lever(s) from Section 11 (smallest-safe-step combination: VBI-2 + VBI-3 + VBI-4 + VBI-6 + VBI-8 — end-to-end CLI-verifiable bettor-native pipeline using existing canonical authorities). Phase ships under the established additive / probe-matrix-clean / 14-suite-regression-clean / governance-PASS discipline.

Doctrine to be cemented when shipping:
- **Visual betting intelligence** — bettor uploads a slip (today: JSON paste; future: screenshot OCR) and receives deterministic repo-native predictive analysis. The repo never responds like ChatGPT.
- **Screenshot-analysis philosophy** — every conclusion is a pure function of canonical signals; no LLM commentary, no fabricated probabilities, no invented player mappings.
- **Bettor-native intelligence** — the analysis surface speaks the bettor's language ("this dies together"; "books agree this edge is real"; "pitcher and hitter contradict"), grounded in operator-approved deterministic phrase mappings.
- **Predictive screenshot interpretation** — the engine reuses MLB-COV + EXPL + market-supported-disagreement signals + grading history; never duplicates them; never invents new math.
- **Anti-fabrication OCR doctrine** — Phase 1A explicitly DOES NOT introduce OCR. JSON paste path proves the loop first. OCR is a future-phase lever (VBI-10) held until the analysis engine is proven valuable on already-structured input.
- **Canonical-authority-first** — `screenshotRoutes.js` + `screenshotSchema.js` + `intelligence.predictionId` + `pairCorrelationScore` + `marketSupportFor` are all the canonical building blocks; Phase 1A's job is composition, not invention.
- **Smallest-safe-step** — VBI-5 (DB schema migration) and VBI-7 (FE) ship only if explicitly approved; the CLI-verifiable triple (VBI-2/3/4 + VBI-6/8) is the minimum operator-approvable bundle.
