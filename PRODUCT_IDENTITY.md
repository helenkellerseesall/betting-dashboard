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
