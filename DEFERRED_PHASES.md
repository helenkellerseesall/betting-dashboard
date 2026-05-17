# DEFERRED PHASES
**Canonical deferred architecture map. Read before proposing any future direction. Prevents rediscovery drift.**

Each row: phase name + why deferred + prerequisite + danger of premature ship.

---

## INDEFINITELY DEFERRED (operator-cemented forbidden until explicit reversal)

| Phase | Why deferred | Prerequisite (if reversible) | Danger of premature ship |
|---|---|---|---|
| **OCR / image-upload parsing** | Backend dependencies (multer/formidable/tesseract/sharp/vision APIs) don't exist; operator has not approved adding them. The 📸 surface is currently a foundation only (cmd+v + drag/drop → in-memory staging tray with honest "parsing pipeline not connected yet" copy). | Explicit operator lever approval. Would require multer + tesseract.js OR vision-API integration + a new `/api/ws/screenshots/parse-image` route. | Violates anti-fake-OCR doctrine cemented BNDS-1A. Pretending OCR works when it doesn't is the exact "fabricated UX promise" that BNSB-1B removed (`rawText` fallback). |
| **LLM / GPT narration for any FE-visible string** | Violates anti-fabrication doctrine cemented across 24 phases. `bettorLanguage` library is the canonical replacement. Every visible phrase must trace to a canonical signal id. | Never — operator-cemented forbidden. | Catastrophic drift. The repo identity ("deterministic / anti-fabrication / canonical-authority-first") is irreversibly violated by any LLM phrase in the FE surface. |
| **Celebrity / star-power weighting** | Fabricated value. Explicitly forbidden in BC + OE phase prompts. | Never — operator-cemented forbidden. | "Famous players get a boost" logic is fabricated signal — same anti-pattern as LLM narration. |
| **Dynamic sportsbook-behavior simulation** | Fabricated counter-models. Operator explicitly out-of-scope. | Never. | Repo's edge comes from canonical signal composition, not from modeling opaque counterparty behavior. |
| **Adaptive payout shaping / fake SGP inflation** | Explicitly forbidden across MLB-COV / OE-11. | Never. | Cap-and-stop is doctrine; inflating joint probability to chase parlay payout is the anti-pattern. |
| **Recursive explosion logic** | Multi-level reinforcement loops produce uncontrolled inflation. | Never. | OE-11 per-pair cap 0.02 + aggregate cap 0.03 exist precisely to prevent this. |
| **Hardcoded "tonight's lock" surface** | Hidden-value preservation forbids any "always-promoted" path. | Never. | Every ranking must be signal-derived; never fabricated. |
| **Auto-bet placement / sportsbook API integration** | Out of scope (advisory, not executor). | Never. | Liability surface + breaks the "advisory operating system" identity. |
| **Synthetic shadow predictions / fabricated calibration corpus** | Phase Grading-Calibration-Operations-1D explicitly forbade. | Never. | Calibration must trace to real outcomes; synthetic corpora pollute the integrity layer. |
| **Mobile-first redesign** | Operator-deferred. | Operator-approved scoped mobile phase. | Premature mobile-specific styling pollutes the existing operator workstation surface. |

---

## PREREQUISITE-BLOCKED (waiting on a clear prerequisite)

| Phase | Why deferred | Prerequisite | Danger of premature ship |
|---|---|---|---|
| **NBA-parity ecology** (NBA equivalents of MLB-COV / BC-1A / OE-1A / OE-1B) | NBA does NOT have MLB-shape signals (windDirectionTag / hrEnvironmentTag / runEnvironment / impliedTeamTotal). Cloning MLB phases produces neutral-fallback values for every NBA candidate. | NBA-specific ecology audit (separate from MLB). What is NBA equivalent of "explosive" — high-pace + high-total + high-usage stars? | Premature MLB-cloning means OE-2/3/4 fire neutral for NBA and the operator can't tell whether NBA parity is working. |
| **Longitudinal adaptive calibration** (`FAMILY_CALIBRATION_COEFFICIENTS` refresh from grading outcomes) | Per-bucket / per-signal ROI retrospective surface doesn't exist yet — operator can't visually validate whether adaptive coefficient refresh improved or degraded behavior. | Per-bucket / per-signal ROI surface (BNSB-1C-class) + persisted verdict outcomes (BNSB-1D-class). | Shipping calibration refresh before the operator can SEE its impact is shipping blind. Strategic audit Section 11 explicitly named this as moot until the FE bridges. |
| **Bullpen ingest activation** (OE-13 fires NEUTRAL because `bullpenDataAvailable !== true`) | Upstream `backend/pipeline/mlb/context/deriveMlbBullpenContext.js` is shape-stable but never populates real fragility data. | Phase 1B-class effort that requires upstream API ingest work + persisted bullpen state. | OE-13's neutral fallback exists precisely so the boost reads 0 when data isn't real — premature activation would inject fabricated bullpen scores. |
| **OE-14 structural under-flip** (drop `TIER_TEMPLATES.balanced.allowedSides: ["under"]` override) | Empirical 21.1% all-UNDER win rate calibration mismatch is unresolved, but OE-1A/1B addressed by REWARDING upside (not dropping the override). Need observation window of OE-1A/1B reward behavior. | 30+ days of post-OE-1B graded slip telemetry showing whether the under-bias has actually shifted. | Premature flip removes a known-stable diversification gate before the rewards path has demonstrated traction. |
| **OE-15 `buildBestOvers` symmetry bucket** | Wait to see if OE-6 explosive-upside bucket organically fills the over-symmetry. | OE-6 utilization telemetry from FE Discovery surface (now possible post-BNDS-1A/B). | Building a parallel bucket before the existing one is observed-saturated creates duplication. |
| **BNSB-1B-5 build-leg-by-leg 4-tap flow** in AnalyzeSlipView | Build path currently routes to existing Bet Builder tab (which IS a build flow that exists today). Operator approved the deferral. | Explicit operator approval. | Premature build of a separate FE build flow duplicates the existing Bet Builder. |
| **BNSB-1B-12 explicit forensic-toggle on VerdictCard** | Existing tooltip + collapsible drill-down already provide forensic access. | If operator wants the toggle for debug muscle memory. | Premature addition adds operator-grade UI to the bettor-native surface. |
| **Persisted slip history / re-analyze** (BNSB-1C-class) | Requires `verdict_json` persistence + UI for "my analyzed slips" list. | Schema migration for `parsed_slips.verdict_json` column + new `/api/ws/screenshots/history` route + FE list view. | Premature persistence without a clear FE consumption pattern produces orphaned data. |
| **Diagnostics tab** (Operational-1B-class — fold grading:status / calibration:status / lineage:status into FE) | Read-only aggregator route doesn't exist. | NEW `/api/ws/diagnostics` aggregator that returns canonical CLI output union. | Premature FE for an unbuilt aggregator is the same anti-pattern as BNSB-1A's broken `rawText` fallback. |
| **Cross-sport correlation engine extraction** (MLB-COV-9) | Architectural cleanup; not bettor-visible value. | Operator approval that "the duplication between MLB + NBA correlation engines is now operationally painful." | Premature refactor for invisible value is the "while I'm in here" anti-pattern. |
| **NAV label re-tone** (BNSB-1B-11 — Tonight's Edge / Risk Map / etc.) | Cosmetic only; never blocks. Operator-deferred. | Operator approval that the analyst-vocabulary tabs feel wrong NOW. | None — pure cosmetic deferral. |

---

## NOT-YET-AUDITED (acknowledged but no analysis done)

These are real future directions the repo will eventually face. They are NOT currently bottlenecks. Surface them for explicit audit before proposing any lever.

| Phase | Notes |
|---|---|
| **First-pitch in-play overlays** | Live-game data ingestion + UI overlays. Out of scope today. |
| **NFL / NHL / soccer expansion** | Out of scope today. Each requires sport-specific ecology audit. |
| **Public-facing bettor end-user surface** | Today the workstation serves a single operator. Multi-tenant + public-facing is a different product. |
| **Live-game prop adjustments** | Reactive in-play recomputation. Requires real-time data layer. |

---

## RULE FOR PROPOSING A DEFERRED PHASE

1. Read this file FIRST.
2. If the phase is **INDEFINITELY DEFERRED**: do not propose. Surface to operator if you believe it should be reconsidered, but assume rejection.
3. If the phase is **PREREQUISITE-BLOCKED**: check whether the prerequisite has been satisfied. If yes, surface that to operator before proposing the deferred phase itself.
4. If the phase is **NOT-YET-AUDITED**: propose an audit-first phase (no patches) before proposing any lever ship.

When a phase ships and clears a prerequisite for a deferred phase → update this file's prerequisite column AND `CURRENT_PROBLEMS.md` to move the deferred item from 🔵 DEFERRED to 🟡 ACTIVE.

---

## ANTI-PATTERNS THIS FILE PREVENTS

1. **Resurrecting LLM narration.** Cemented forbidden. This file is the last line of defense against a new chat thinking "wouldn't it be nice if the verdict card had GPT-generated reasoning?"
2. **MLB-cloning for NBA.** Cemented blocked. New chats see NBA as "next obvious target" — this file explains why MLB-cloning is wrong shape.
3. **Premature calibration refresh.** Cemented prerequisite-blocked. New chats see calibration drift as a clear "should fix this" — this file explains why fixing it without the ROI surface is shipping blind.
4. **Building OCR because the 📸 icon implies it.** Cemented forbidden. The icon promises the staging behavior; the parsing pipeline is honestly absent. This file prevents new chats from "completing" the OCR pipeline as a side-quest.
5. **Auto-bet integration.** Cemented out-of-scope. New chats see the verdict + slip composition surface and think "we should just place the bet for them" — this file explains why advisory ≠ executor.
