# PRESERVED — what stays load-bearing in the betting-dashboard

**Last audit:** 2026-05-21
**Audit purpose:** before archiving governance overhead, confirm which modules in `backend/pipeline/shared/` are real sportsbook cognition (preserve) vs governance/orchestration scaffolding (archive or demote).

**Top-line finding:** the repo contains substantially more real cognition than the governance docs implied. The product vision (iPhone-first sportsbook intelligence engine, 7 books × 4 sports, archetype-aware curation, plain-English reasoning, screenshot ingestion, self-grading) is mostly already built in pieces. What's missing isn't the brain — it's the wire-up to live data, the mobile front-end, NBA cognition parity, and stripping the governance dust so the existing cognition is visible.

---

## Tier 1 — CORE COGNITION (preserve absolutely; do not modify without operator approval)

These are the load-bearing math/cognition modules. Every other layer depends on these being correct.

| File | What it does |
|---|---|
| `vigStripping.js` | Multiplicative vig stripping → true fair probability. Sport-agnostic. Foundational to every other scoring decision. |
| `sportsbookAllowlist.js` | Canonical authorized-book list. **Currently 4 books — needs extension to operator's 7: DraftKings, FanDuel, Fanatics, BetRivers, BetMGM, Hard Rock, bet365.** |
| `sportsbookTopology.js` | Per-book capabilities + best-CONSTRUCTABLE-ECOSYSTEM book selection for slips. Never splits legs across books. |
| `archetypeWeighting.js` | Bettor-archetype legitimacy weighting (superstar / proven / role-player / bench / no-name × prop-family fit). Real cognition. Closes "no-name overload" surface bug. |
| `survivabilityGate.js` | Sport-aware survivability dispatcher (Shape γ). Currently scaffold-only; ready for cognition wire-in. |
| `playerConvictionEngine.js` (PCE-1A) | Hitter conviction composite: lineupSpot × plate-appearance-proxy × stat-side coherence × model-trust. Additive ±0.04 / +0.05. Longshot-preserving. |
| `probabilityHonesty.js` | Anti-fabrication for probabilities — never returns synthetic 0.5 for unknown. Catches the silent-neutral bug that poisoned multiple scoring paths. |
| `normalizers.js` | Shared stat-family key normalization. Prevents silent divergence between curator + slip AI. |
| `buildClv.js` | Closing Line Value engine — pure computation. Foundational for grading. |

---

## Tier 2 — INTELLIGENCE LAYERS (preserve; will adapt for iPhone PWA front-end)

These are real intelligence systems. They exist, they work, they may need their output reshaped for the new mobile front-end.

| File | What it does | Adaptation needed |
|---|---|---|
| `buildFeaturedPlays.js` (133K) | The curator. 9 themed buckets (tonightsBest, bestHr, bestLadders, smartAggression, safest, bestClv, marketAgreement, timingWindows, bestBooks). Composite scoring across edge × archetype × CLV × timing × book × volatility. | Output adapter for mobile slate page. |
| `buildSlipAi.js` (72K) | Slip construction AI. Tiers: safe / balanced / aggressive / lotto. Uses portfolio baseline, line shopping, timing, book state, ledger. | Output adapter for mobile. |
| `buildSlipAnalysis.js` | Screenshot-slip analysis (VBI-3). Reuses canonical authorities only. Deterministic verdict. | Wire to mobile screenshot upload. |
| `bettorLanguage.js` | Deterministic phrase library for screenshot verdicts. Every phrase maps to a canonical signal id. No LLM, no GPT freeform. | Extend taxonomy as new cognition lands. |
| `buildLineShoppingIntelligence.js` | Per-prop best line/book/odds + rolling per-book CLV/ROI/stale-line frequency. | Surface in mobile UI. |
| `buildMarketTimingIntelligence.js` | When to bet, not just what. Classifies props as stable/drifting/steam/stale_window/overcorrected/limited. Urgency tiers immediate/soon/patient/wait/avoid. | Surface as "Bet Now" indicator. |
| `buildPortfolioOptimizer.js` | Exposure map, correlation, volatility class (safe/balanced/aggressive/lotto), sizing nudges (0.5–1.5 multiplier), conflict detection. | Surface as portfolio view. |
| `buildPersonalLedger.js` (48K) | Bet ledger + ROI engine. Ring-buffer capped at 2000 bets. Integrates with CLV. | Foundation for recommendation logging + grading. |
| `buildPostGameReview.js` | Projection vs actual, archetype evolution. Rolling state per sport. | Drives nightly auto-grading. |
| `buildNightlyOrchestrator.js` | Chains every post-slate intelligence system in correct order — slate guard → results → review → ledger → CLV → book intel → line shopping → report. Zero API calls. | Schedule as a cron. |
| `buildCandidateDiversity.js` | Caps per player/game/stat/stat-side. Prevents homogeneous pools. | Use as-is. |
| `mlbFutureOnly.js` | UTC-safe future-only filter. Replay-safe. | Use as-is. |
| `snapshotFreshness.js` | Staleness detection (fresh/warning/stale/absent). Env-driven thresholds. | Surface freshness in mobile UI. |
| `resolveCanonicalSport.js` | Canonical sport identity (mlb / nba). Frozen alias map. Unknown → null. | Use as-is. |
| `resolveSlipLegToPrediction.js` | Screenshot leg → canonical predictionId. | Use as-is for screenshot ingestion. |
| `buildWorkstationCompactors.js` | Drops heavy fields for transit to FE. | Adapt for mobile payload size. |
| `apiCallLogger.js` | Append-only JSONL logger for odds-API calls. Real observability. | Use as-is for right-sizing odds API tier. |

---

## Tier 3 — TOOLING / SUPPORT INFRASTRUCTURE (preserve; never elevate to product spine or governance doctrine)

Per operator 2026-05-21: observability, diagnostics, grading, stale detection, provider health, and fallback detection are real and must be preserved — but they are tooling that *supports* the product, not product itself and not governance doctrine. Demote, don't delete.

**Six categories preserved:**

| Category | Modules / where it lives | Purpose |
|---|---|---|
| **Observability** | `executionAuthority.js`, `responseAuthority.js`, `responseShapeResolvers.js`, `apiCallLogger.js` (JSONL log of every odds-API call) | Surfaces duplicate-work, runtime-vs-endpoint disconnects, and external API behavior. |
| **Diagnostics** | `probabilityHonesty.js` probes (null discipline counters), inline `diagnostics` blocks across snapshot/route layers | Catches silent-default substitutions (the "0.5 synthetic neutral" class of bug) and other anti-fabrication leaks. |
| **Grading** | `buildClv.js`, `buildPostGameReview.js`, `buildPersonalLedger.js` (analytics rollup), `buildNightlyOrchestrator.js` (chains the grading pass) | Self-grading loop. CLV computation, projection-vs-actual, archetype evolution, hit-rate-by-segment. |
| **Stale detection** | `snapshotFreshness.js` (fresh / warning / stale / absent + age + reason), `mlbFutureOnly.js` (commence-time filter) | Refuses to serve as-current data that's actually stale or already-started. Env-driven thresholds. |
| **Provider health** | `apiCallLogger.js` rolling stats (status codes, durations, error rates per endpoint), to be surfaced via a small operator-facing diagnostics page when needed | "Is the odds API actually healthy right now?" |
| **Fallback detection** | `probabilityHonesty.js` probe (counts when a caller had to fall through alternatives), null-return discipline across the cognition layer | Makes the difference between "real signal" and "synthesized neutral" auditable. |

These categories support the product (the operator can trust the slate when they ship something on it) but never become the spine of the product (the bettor doesn't open the app to see provider health graphs). If a future suggestion is to build a dedicated "observability layer" or "diagnostics platform" as its own product surface, that's the lessons-from-GPT-era failure mode and should be refused. Tooling stays as tooling.

---

## Tier 4 — DISPLAY LAYER (probably replaced by mobile PWA)

| File | What it does | Verdict |
|---|---|---|
| `buildIntelligencePresentation.js` | Terminal board formatter (URGENT / BEST EDGE / LINE SHOPPING / STEAM / SAFEST / LOTTO / FIRST BASKET / PORTFOLIO / PROCESS REVIEW / ALERTS). | Useful as a reference for what categories the mobile page surfaces. Code itself may not survive the mobile rewrite — its sections become the mobile screen architecture. |

---

## Tier 5 — DEMOTE OR ARCHIVE

These belong in `docs/_legacy/` after task #2.

- All governance docs: GSBL, DRL, supervisor cockpit docs, LANE_INDEX, EXECUTION_BACKLOG, OPERATOR_RUNBOOK, OPERATOR_BACKLOG, verifier-first doctrine, structured-checkpoint footers
- All `*_AUDIT_2026-*.md` files (30+ phase audits — keep as historical reference but not as load-bearing)
- All `probe_*.js` files at repo root (debug scripts — move to `scripts/probes/`)

---

## Wired-vs-orphan caveat

This audit identifies what's BUILT. A separate question is what's actually WIRED into the live request path. The buildFeaturedPlays curator may be running; buildSlipAi may be running; survivabilityGate is explicitly scaffold-only and not yet wired. When we stand up the mobile slate page (task #6), we verify each Tier 1/2 module is on the actual live path — not just sitting in the repo.

---

## What this means for the build plan

Tasks #1-3 (audit, archive, right-size odds) remain low-risk reorganization.

Task #4 (unified slate ingestion) connects to existing modules — most of the cognition is already in place.

Task #5 (NBA cognition scaffolding) is the largest real build — MLB has PCE-1A + ecology lifts + future-only filter; NBA has topology stubs and persistence hooks but no equivalent conviction engine. This is where most net-new cognition code gets written.

Task #6 (mobile slate page) is largely a presentation/adapter layer on top of buildFeaturedPlays — not a from-scratch build.

Tasks #7-#8 (logging + grading) extend buildPersonalLedger + buildPostGameReview + buildClv — no new architecture needed.

Task #9 (iPhone validation) is the ship gate.

**Net result:** the v0.1 build is meaningfully smaller than implied at conversation start, because the cognition spine is already there.

---

## SANCTIONED SHADOW STACK — DO NOT DELETE (added 2026-06-15)

**Two different things are both called "shadow." Keep them straight:**

- **PROHIBITED shadow** = a parallel COPY of a canonical file competing for the same authority (a sibling that duplicates logic an existing owner already provides). This is a **Law 1 violation** — the GPT-era "shadow canonical" failure mode. These should be deleted/reconciled into the canonical owner.
- **SANCTIONED shadow** = an **additive, kill-switched, build-ahead engine** that feeds **NOTHING live** until explicitly graduated past the freeze. It is NOT a duplicate authority — it is the next version of a capability, built and validated in the dark behind its own switch. **Deleting one of these is a regression, not cleanup.**

**Removing any file below is a REGRESSION — recover it from git history; do NOT delete as "unused."** They feed nothing live *by design* (that is the point of a kill-switched build-ahead), so "nothing calls it in the live path" is EXPECTED and is NOT evidence it is dead. Each is guarded by a runtime:verify fixture — deleting one fails the suite before commit (`verifyShadowStackIntact` asserts presence explicitly; the per-feature fixtures require each file directly).

| File | Kill-switch (default ON; `"0"`=off) | What it is | Graduation target (post-freeze) |
|---|---|---|---|
| `backend/pipeline/shared/gaussianCopula.js` | (pure math primitive — no switch) | Φ⁻¹ / Φ₂ / copulaJoint / fitRhoZ — the ONE Gaussian-copula method authority | Stays the method primitive; consumed by correlation + (later) NBA correlation graduation |
| `backend/pipeline/mlb/mlbCorrelationEngine.js` | `MLB_CORRELATION` | Sign-enforced 2-leg joint prob (copula over `mlbCorrelationPriors.json`) | Feed the parlay constructor's same-game joint once calibration is live |
| `backend/pipeline/shared/isotonicCalibration.js` | (pure math primitive — no switch) | PAVA isotonic + Platt — calibration method authority | Stays the method primitive; consumed by marginal calibration graduation |
| `backend/pipeline/mlb/mlbMarginalCalibration.js` | `MLB_MARGINAL_CALIB` | Isotonic remap of overconfident `modelProb` → calibrated prob | EXTEND `calibrationDampener.js` (PRESERVED) + wire calibrated prob onto cluster scoring — the route off "trash picks / zero edge" |
| `backend/pipeline/mlb/negBinomLadder.js` | `MLB_NB_LADDER` | Fitted NegBinom survival ladder `P(X≥k)` (totalBases) | Replace the heuristic ladder in projection after forward-validation beats it |
| `backend/pipeline/mlb/mlbParlayConstructor.js` | `MLB_PARLAY` | EV-gated 2-leg constructor (calibrated marginals + copula joint; never auto-bundle) | Live parlay surface once calibration graduates + a real +EV set exists |

Supporting (also sanctioned, not deletable): `backend/config/mlbCorrelationPriors.json`, `backend/config/mlbMarginalCalibration.json` (derived priors — regen via the `derive*` scripts, never hand-trim). **Graduation is governed by `docs/POST_FREEZE_GRADUATION_PLAN.md` (read-order anchored in MASTER_BRAIN).**
