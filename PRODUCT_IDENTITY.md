# PRODUCT IDENTITY
**Canonical repo identity. Anti-drift anchor. Rarely updated — change only by explicit operator approval.**

---

## ONE-LINE IDENTITY

> **A deterministic, anti-fabrication-disciplined, bettor-native intelligent betting operating system for MLB + NBA.**

---

## THE FOUR WORDS THAT DEFINE IT

| Word | Meaning |
|---|---|
| **Deterministic** | Every conclusion traces to canonical signals. Replay-safe. Auditable. Same input → same output, every time. |
| **Anti-fabrication** | Never invents probabilities, narratives, star scores, or confidence. Every visible string traces to a canonical backend field. |
| **Bettor-native** | Speaks the bettor's language at the FE surface. The customer is the operator at the workstation (and eventually their bettor end-user). |
| **Operating system** | Not a model. Not a slip generator. A system that takes raw markets + canonical context + bettor inputs and produces deterministic operator-readable intelligence. |

---

## THE THREE-LAYER ARCHITECTURE (operator-cemented since BNDS-1B)

| Layer | Surface | Pool | Purpose |
|---|---|---|---|
| **Layer 1 — Battlefield** | `🗺 Discover` tab | `state.discoveryCandidates` (broad canonical pool, looser caps) | "Show me what's available across every game." Abundance first. |
| **Layer 2 — Curated Edge** | `⚡ Tonight's Edge` + spotlight grids | `state.featured` + `state.candidates` (tight elite caps) | "Show me the strongest survivors." Curation second. |
| **Layer 3 — Compression** | `🎲 AI Parlays` + `📸 Check My Slip` | `state.aiSlips` + canonical VBI verdict | "Show me a parlay" / "tell me about this slip." Compression third. |

These are **distinct products inside the same workstation**. They must NEVER be collapsed into a single surface.

---

## WHAT THE REPO SHOULD FEEL LIKE

1. **Abundant but curated.** The bettor opens Discover and sees 40-100 canonical-validated props across every game — never "5 props on a dark screen."
2. **A smart friend talking, not a build server.** Every loading / empty / error string is bettor-spoken first person ("Reading your slip…" / "I couldn't read that one — try the Borrow path"), never `ss_abc123 · archetype:personal_aggressive_stack`.
3. **Auditable.** Every reinforcement boost, every counter, every verdict surfaces the canonical source (raw → calibrated → reinforced ladder; per-counter chips on hover).
4. **Game-first.** Every game has an ecosystem under it (matchup + env + lineups + ladders) — not a flat list of isolated props.
5. **Honest about absence.** When no canonical signal fires, the FE says so explicitly ("Standard environment — no canonical signals fired") rather than fabricating a phrase.

---

## WHAT THE REPO MUST NEVER BECOME

| Forbidden direction | Why |
|---|---|
| ❌ LLM / GPT narration for slip cards or env sentences | Violates anti-fabrication invariant. Every phrase must trace to a canonical signal id (`bettorLanguage` library). |
| ❌ Celebrity / star-power weighting | Fabricated value. Operator explicitly forbidden across BC + OE phase prompts. |
| ❌ Dynamic sportsbook-behavior simulation | Fabricated counter-models. Out of scope. |
| ❌ Adaptive payout shaping / fake SGP inflation | Explicitly forbidden across MLB-COV / OE-11. |
| ❌ Recursive explosion logic | Uncontrolled inflation. Cap-and-stop is doctrine; recursion is anti-pattern. |
| ❌ Hardcoded "tonight's lock" surface | Hidden-value preservation forbids any "always-promoted" path. |
| ❌ Auto-bet placement / sportsbook integration | Out of scope (advisory, not executor). |
| ❌ Synthetic shadow predictions / fabricated calibration corpus | Phase Grading-Calibration-Operations-1D explicitly forbade. |
| ❌ Vision APIs / OCR / image upload parsing (TODAY) | Backend dependencies don't exist; operator-deferred indefinitely. FE must not pretend they do. |
| ❌ Raw sportsbook flooding on any FE surface | Every prop visible must originate from canonical-validated state. |
| ❌ Gambling-hype copy ("LOCK" / "BOOM" / "guaranteed" / 🔒) | Marketing tone; non-bettor-native. |

---

## CORE DOCTRINES (canonical-authority-first)

### Anti-fabrication
Every visible value (probability / phrase / counter / verdict / env tag / threshold) traces to a canonical backend field rendered verbatim OR to a deterministic helper that consumes only canonical fields. Missing values render dimmed; nothing is invented.

### Canonical-authority-first
When backend already encodes X (e.g., `pairCorrelationScore`, `marketSupportFor`, `hrEnvironmentTag`, `consensusConfidence`), bridge that authority into the consumer surface. Never duplicate the logic. Same pattern that worked 5× in a row: MLB-COV-1A → VBI-1A → BC-1A → OE-1A → BNSB-1A.

### Additive-only
Every phase ships additive code paths. Existing behavior preserved verbatim. New fields are optional with graceful FE fallback on legacy backends.

### Replay-safe
Every prediction is frozen at compose time + persists immutably. Re-running a snapshot lifecycle is a perfect no-op (INSERT OR IGNORE on prediction_epochs + prediction_snapshots).

### Hidden-value preservation
Every demote / suppress gate is SOFT (sort-time effective penalty, never mutates composite score). No hard-rejects of legitimate value. Under-side legs UNTOUCHED by 4 phases of offensive-overs work.

### Soft-lens doctrine (BNDS-1A+)
FE lenses sort/filter game-card arrays only; underlying prop breadth always available when a card is expanded. Never hard-filter props.

### Anti-fake-OCR (BNDS-1A+)
The 📸 surface is honest within current backend capability. No `<input type="file">`-to-OCR pipeline pretends to work. The ScreenshotIntake component stages images in-memory only with explicit "parsing pipeline not connected yet" copy.

### Opportunity-qualification architecture (operator-cemented, 2026-05-18)

**The doctrinal shift codified in this section is foundational, not incremental.** The intelligence stack is transitioning from `score maximization` to `bettor-realizable opportunity qualification`. This is not a re-weighting of the existing composite — it is a structural reframing of what the system reasons about.

#### What the repo previously optimized for

Per `/docs/CURATION_AUDIT_2026-05-18.md` (CA-1, Stage B reconstruction): the as-found objective is a weighted-mean of 10 quality lenses + asymmetric additive boosts + soft demotes, with the dominant terms being a capped `edge × probFactor` and an asymmetric `~+0.13` additive stack favoring obscure-longshot-in-favorable-env profiles. Outputs are explained by "the composite score said so."

#### What the repo should increasingly reason about

**Opportunity structures, not just statistical asymmetry.**

A bettor does not first ask "which prop has the largest edge?" — a bettor first asks "**who is this player tonight, what role do they own in this game, and how does tonight's game flow activate that role?**" Only after that question is answered does mathematical asymmetry become useful as a tuner.

#### The eight-dimension framework

The architecture is structured around eight co-equal dimensions. They are co-equal in legitimacy; they differ in **sequencing priority**.

**Six canonical explainability dimensions** (operator-stated 2026-05-18):

1. **Role ownership** — does this player own this opportunity? Role / archetype is a structural dependency layer.
2. **Game-flow activation** — does tonight's game state actually activate this opportunity? Flow is a structural dependency layer.
3. **Ecosystem legitimacy** — is the supporting ecology (lineup / env / matchup / depth) coherent with the opportunity?
4. **Survivability** — does the opportunity survive realistic in-game friction (pace decay, blowouts, weather, lineup turnover)?
5. **Bettor-trust** — is every signal traceable to canonical authority? No fabrication, no synthesis, no opaque ML.
6. **Market psychology** — is the line shape and movement consistent with the opportunity? Consensus / dispersion / steam.

**Two additional dimensions** are operator-authoritative and pending explicit enumeration at the codification-confirmation pass. The architecture supports eight dimensions; this canonicalization codifies the six that are foreground for explainability.

#### Sequencing principles

- **Role / archetype + game-flow are structural dependency layers.** They are sequenced first. A candidate that does not pass role + game-flow qualification is not a viable opportunity, regardless of mathematical asymmetry.
- **Opportunity qualification before edge maximization.** Edge is a tuner among qualified opportunities, not the entry-gate.
- **Hard-gate-then-tune.** Some dimensions act as binary qualifying gates (a candidate either qualifies or does not); other dimensions act as tuners (modulating ordering among the qualified set). The current architecture treats every dimension as a tuner contributing to a single weighted-mean score — that pattern is what the doctrinal shift moves away from.

See `backend/runtime/brain/ARCHITECTURE_LAWS.md` Laws 22–30 for the codified rules:
- **Law 22** — opportunity qualification before edge maximization
- **Law 23** — hard-gate-then-tune architecture
- **Law 24** — output explainability in dimension terms
- **Law 25** — Shape γ is the canonical opportunity-qualification function-shape (operator-selected 2026-05-18)
- **Law 26** — volatility is not fragility (texture/risk class ≠ structural survivability)
- **Law 27** — class-not-identity ecosystem recognition (player classes promoted; player identities never)
- **Law 28** — sport-agnostic dimension taxonomy with sport-specific gate implementations
- **Law 29** — prop-family-aware gate thresholds
- **Law 30** — four-dimensional explanation schema (Who · When · How does it survive · Where is the market wrong)

**Canonical function-shape (Law 25):** hard gates (role / game-flow / bettor-trust / market-integrity) → gate-and-tuners (ecosystem-legitimacy / survivability / market-psychology) → pure tuners (statistical edge / payout realizability) → diversification → curated output. The composite continues to function as the tuner-side mechanism; gates apply BEFORE composite ordering on the qualified set.

**Battlefield and curated as bettor operating modes:** the 3-layer surface separation (Battlefield → Curated Edge → Compression) is not just a UI layout — it is **two distinct cognitive operating modes the bettor enters**. Battlefield = "show me the breadth I can scan." Curated = "show me the structured edge I can act on." Compression = "tell me the verdict." Each operating mode is served by a different selectivity of the same Shape γ gates: Battlefield runs looser gate thresholds (broad qualification); Curated runs tight gate thresholds (focused qualification); Compression collapses to single-verdict shape. **No operating mode is sterile** — Battlefield retains canonical-validated breadth; Curated retains the survivors; Compression retains the verdict. Anti-sterilization is operator-cemented across all three.

#### The explainability requirement

**Curated outputs must eventually be explainable in dimension terms, not in score terms.**

A bettor scanning a surfaced opportunity should be able to read:

> "**Top-of-order role · run-environment activates · lineup-coherent · survives bullpen risk · canonical multi-book consensus · market hasn't yet adjusted.**"

…not:

> "**Composite score: 0.87 (edge-lens 0.22 + OE-additives 0.08 + PCE +0.05 …)**"

The dimensions are the legible explanation; the score is the consequence. When the dimensions speak, the score is redundant. When only the score speaks, the architecture has failed the explainability requirement.

#### Cross-references

- Codified rules: `backend/runtime/brain/ARCHITECTURE_LAWS.md` Laws 22 / 23 / 24.
- Reconstructed as-found objective (the architecture this shift moves away from): `docs/CURATION_AUDIT_2026-05-18.md` Stages A + B.
- Planning lanes for the transition: CA-3a (reconciliation) / CA-3b (function-shape evaluation) / CA-3c (implementation inventory) — all observational, NO implementation commitments — recorded in the CA-1 audit's Stage C addendum.
- R3 ecology-authority alignment: OE-8 `ladderSurvivabilityFactor` aligns to the survivability dimension; BC-2 / OE-2 / OE-3 / OE-4 / PCE align to ecosystem legitimacy and role ownership. Existing ecology infrastructure is the substrate for the new architecture — not a replacement target.

#### What the doctrinal shift does NOT mean

- **Not a battlefield sterilization.** Battlefield breadth (Layer 1 Discover) remains operator-cemented.
- **Not a "boost star players" shortcut.** Celebrity / popularity weighting remains forbidden per `/DEFERRED_PHASES.md`. Role ownership is structural (depth, lineupSpot, usage), not celebrity.
- **Not a calibration patch.** Premature calibration fixes are out of scope for the transition.
- **Not a curated-surface hack.** No hard-coded "tonight's pick" path is introduced.
- **Not a replacement of the existing composite.** The composite continues to function; what changes is where opportunity qualification gates apply BEFORE the composite scores order the qualified set.
- **Not a single-phase implementation.** CA-3a/b/c are observational planning passes. Implementation requires explicit operator + MCR approval at each step.

### Layer-type separation (T1 architectural ruling, 2026-05-17)
The 3-layer surface architecture (Battlefield → Curated Edge → Compression) has a corresponding **type-level separation** that mirrors the surface boundary.

| Layer | Canonical type(s) | Authority for layer-specific signals |
|---|---|---|
| **Layer 1 — Battlefield** | `Candidate` | Pre-curation raw-pool fields ONLY. No curated-layer signals. |
| **Layer 2 — Curated Edge** | `FeaturedPlay` / `compactPlay` | Curated-layer signals (`convictionNote`, `convictionReasonTag`, `ladderSurvivabilityFactor`, future curated-layer fields) live HERE and ONLY HERE. |
| **Layer 3 — Compression** | `AiSlip` / canonical VBI verdict shapes | Compression-layer signals live on compression-layer shapes. |

**Type-discipline rule:** curated-layer signals MUST NOT be added to battlefield-layer types. Widening a layer-N type with a layer-(N+1) signal silently re-creates the shadow-canonical pattern Authority-Reconciliation-Sweep R1-PASS-2 stamped out across docs, but at the type level.

**Propagation rule:** when a battlefield surface (e.g., `🗺 Discover`) needs to consume a curated-layer signal, propagation MUST route through a single canonical overlap helper (see `backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 20). The overlap helper is keyed by canonical `candidateId` only — no FE-side composite key, no surface-specific lookup variant.

**Absence rule:** when the overlap returns no match, the consuming render helper renders honest absence (see Law 19). No synthesized fallback, no placeholder text, no "honest absence" message.

The first canonical realization of this pattern is `ConvictionNote.tsx` (P1A-T3 extraction) + the forthcoming canonical overlap helper (P1A-T1, Option A authorized 2026-05-17). Future curated-layer propagations (OE-8 `ladderSurvivabilityFactor` → BNDS-1C survivability lens, OE-11 stack reinforcement → any battlefield surface, etc.) MUST follow this pattern identically.

This doctrine is enforced by R4 verifier extensions (`verifyLayerTypeSeparation` · `verifyOverlapHelperCanonicality` · `verifyNoFeOverlapReDerivation` · `verifyCanonicalHelperDoctrine` · `verifyTypeWideningDiscipline`).

---

## SPORT SURFACES

| Sport | Maturity | Notes |
|---|---|---|
| **MLB** | Production-deep — BC-1A realism + OE-1A/1B offensive ecology + MLB-COV-1A covariance + VBI-1A verdict resolver all canonical. Tightest cross-phase intelligence. | Default sport. Deepest ecology coverage. |
| **NBA** | Production-stable — `nbaCorrelationEngine` + `playerStatus` filter (EXPL-4 active) + `nbaAvailabilityCache`. NBA-specific ecology audit DEFERRED (must NOT clone MLB shape — needs separate audit for pace / usage / depth-chart minutes). | Snapshot supplement keeps thin slates functional. |

---

## OPERATIONAL CADENCE

- 22+ phases shipped (Realism-1A through BNDS-1B + Continuity-OS-1A).
- Every phase: audit → operator lever approval → ship → helper unit → 14-suite regression + 5-probe matrix → 6-doc reconciliation → `brain:checkpoint`.
- 25 verify\*.js scripts. 14 runtime verifiers. 5 canonical integrity probes (158 assertions). All sealed on every checkpoint.
- Zero regression across 24 prior phases (BNDS-1B verifier explicitly asserts).

---

## REPO BOUNDARIES (perpetual)

| In scope | Out of scope |
|---|---|
| MLB + NBA prop intelligence | NFL / NHL / soccer / esports / live-game in-play |
| Advisory analysis | Auto-bet placement / sportsbook API integration |
| Deterministic canonical composition | LLM / vision / opaque ML |
| Bettor-native FE surfaces | Mobile / native apps |
| Single-operator workstation | Multi-tenant SaaS |
| JSON cache + SQLite memory | Distributed DB / streaming infrastructure |

---

## IF SOMETHING IN THIS DOC FEELS WRONG

Don't silently change it. Surface the conflict to the operator. This doc is an anti-drift anchor — drifting it is the failure mode it exists to prevent.

---

## SPORTSBOOK GOVERNANCE (Phase Item 0002 Slice 1.5, 2026-05-19)

The canonical sportsbook allowlist lives at `backend/pipeline/shared/sportsbookAllowlist.js`. Operator-authorized retail books: DraftKings, FanDuel, BetMGM, Caesars. Every other book is excluded by default; allowlist evolution requires explicit operator approval through that module.

Curated emissions (`buildSlipAi` / `buildFeaturedPlays` slip outputs) must be single-book per slip — every leg references the same allowed book. Battlefield Discover rows may surface non-allowed books for completeness (anti-sterilization preserved), but curated slips never reference a book outside the allowlist and never mix books across legs.

Closure of any persistence-touching mutation requires LIVE RUNTIME ARTIFACT evidence — `mlb_tracked_best_<TODAY>.json` emitted by the production server, with ≥95% hydration coverage on canonical fields. Replay-only closure is forbidden by `docs/OPERATOR_RUNBOOK.md` § LIVE REGENERATION + SPORTSBOOK GOVERNANCE.
