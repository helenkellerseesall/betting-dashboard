# Live-Game-State-Integration-1A — AUDIT SYNTHESIS

Date: 2026-06-06/07. READ-ONLY audit (no code). Per-item probes in `.scratch/probe_livestate_*.txt`.
Mission frame: the fire-bet threshold is "go to edge.motel666.com daily, feel SAFE, bet ANY style confidently —
single O/U OR lotto multi-leg parlays." Live-state freshness is the foundation: stale data kills picks across every
style, and **parlays are exponentially more sensitive — one stale leg kills the whole ticket.**

## 1. HEADLINE — the parlay-surface gap

The bettor's highest-stakes surface (multi-leg parlays / AI slips — HR parlays, 3+ threes, Wemby-cycle) is the
**LEAST protected from live-state staleness on BOTH sports.** A player who is scratched (MLB) or OUT (NBA) can ride
onto a parlay, and one dead leg voids/loses the entire ticket.

PARLAY-LEG VULNERABILITY MATRIX:

| Surface | MLB | NBA |
|---|---|---|
| single curated / edge pick | **observational only — NO gate** | **HARD-STOP OUT** (forceSit) ✓ |
| AI picks (elite/strong) | n/a | soft −2pp nudge only |
| **parlays / AI slips / auto-tickets** | **NO check — fully blind** | **soft −2pp nudge only** |

- **MLB**: `buildMlbAutoTickets` has ZERO availability/scratched/`mlbLiveState` references — fully blind on every
  surface. The board itself doesn't gate either (see §2).
- **NBA**: single curated picks hard-stop OUT (`buildDecisionLayer:57` forceSit, `buildSurfaceRow:483`
  `isTrueCuratedHardStop`), BUT the parlay path (`buildNbaAiPicks` → `buildNbaAiSlips`) has zero hard-stop — only
  the soft `nbaAvailabilityCache` shift (OUT max −0.020 on modelProb). A strong-prob OUT player survives the nudge
  → lands in elite/strong → rides a parlay.
- **The one place NBA gates correctly (single curated picks) is the LOWER-stakes surface.** The gap is precisely on
  the surface the operator most wants to trust.

## 2. The three dead-wire classes (context) — this is Class 3

- Class 1 (signal-fill 1B): detection defaults to a constant, never reads real data (FIX 3 batterKs, FIX 4 HR/9).
- Class 2: data exists, wire exists, already live (pace, assists — BUMPED).
- **Class 3 (THIS audit, MLB live-state): detection RUNS and is ENABLED, but nothing gates picks on it AND it never
  reaches the FE.** `applyMlbLiveStateLayers` (MLB_LIVE_STATE_ENABLED=1) attaches `row.mlbLiveState` every cycle
  with RICH detection — `lineup.scratched`, `starter.changeType` (emergency_callup/scratch), `lineMovement.steamFlag`
  — but its only consumers are `freezeMlbLiveStateEpoch` (DB history) and `responseAuthority.hasMlbLiveState` (an
  observability boolean). No gate, no serializer, no FE. The signal is computed and discarded.

## 3. Source + freshness catalog (item 1)

| Source | Populator / path | Cadence | Freshness at game-time |
|---|---|---|---|
| MLB odds | buildMlbBootstrapSnapshot fetchMlbEventOdds | hourly :00 (slate:mlb) | fresh per cycle |
| MLB lineups | fetchMlbExternalSnapshot → fetchMlbOfficialLineupsSnapshot | per refresh cycle | per-cycle (apiSports adapter is a scaffold — verify coverage) |
| MLB starter confirm / scratch | applyMlbLiveStateLayers (deriveMlbStarterConfirmationState) | per cycle (enabled) | DETECTED, **not consumed** |
| MLB weather | weather cache (3 AM + cycle) | overnight + cycle | adequate |
| MLB line movement / steam | applyMlbLiveStateLayers (deriveMlbLineMovementState) + buildMarketTimingIntelligence | per cycle | DETECTED, **not consumed** (observational) |
| NBA active/inactive | populateNbaInjuryReport (ESPN) + ingestNbaOfficialInjuryReport (official) | ~:15 / per cycle | TWO sources, different mechanisms (see §6) |
| NBA in-game injury | not found as a distinct in-slate poll | — | likely absent (gap) |
| Sharp money / public money | none (only MLB steam detection) | — | ABSENT |
| Beat-reporter news | none | — | ABSENT — operator's screenshot ingestion is the manual substitute |

## 4. Items 3-5

### Item 3 — parlay-leg vulnerability ranking (highest → lowest)
1. **MLB 4-leg HR parlay** — HIGHEST. No leg checks lineup/scratch status anywhere. A +5000 ticket is $0 if ONE of
   4 batters is scratched (vs a single $20 O/U that loses). Amplified by leg count × multiplier.
2. **Mixed / cash-out / ride-out parlays (either sport)** — HIGH. Any one stale leg compounds the whole ticket;
   correlation makes it worse.
3. **NBA "3+ threes" / Wemby-cycle multi-leg** — MEDIUM-HIGH. Soft −2pp nudge only on the parlay path; an OUT
   player can still anchor a leg.
4. **NBA single curated O/U** — LOW. Hard-stopped (Path A). The protected case.
5. **MLB single O/U** — MEDIUM. Unflagged, but a single stale pick is one bet, not a multiplied ticket.

### Item 4 — wire vs new-feed vs new-source (per gap)
- **Parlay-surface gate primitive** — **WIRE-ONLY.** Detection already exists: MLB `row.mlbLiveState` (scratched/
  starter), NBA availability (both sources). The job is consuming it at parlay/slip assembly + the MLB board. No
  new feed.
- **MLB single-pick board gate** — WIRE-ONLY (consume `row.mlbLiveState`).
- **NBA AI-picks/parlay gate** — WIRE-ONLY (apply the existing edge hard-stop to Path B).
- **NBA in-game injury (intra-slate)** — likely NEEDS-FEED (no distinct in-slate poll found) — DEFER, own phase.
- **Sharp-money / public-money tracking** — NEEDS NEW FEED — DEFER, own phase.
- **Beat-reporter news** — NEEDS NEW SOURCE — DEFER (screenshot ingestion is today's substitute).

### Item 5 — anchor mismatch (does the book already price live-state?)
Partial, and timing-divergent. Books DO move closing lines on a scratched starter / confirmed OUT — so SOME
live-state is priced into the market by game-time. BUT our slate cycle (hourly MLB / 30-min NBA) and the book's
line update happen on DIFFERENT clocks: a player ruled OUT at 5:50 PM for a 7 PM tip is reflected in the book
quickly, but our last pre-tip refresh may predate it, AND even when our data catches it we don't gate. So unlike
park/weather (a clean Trap-5 double-count), live-state gating is NOT a double-count — it's a CORRECTNESS gate
(don't surface a dead leg), independent of the edge math. **Recommendation: gate is a hard validity check, not an
edge signal — apply it AFTER edge scoring, at assembly, regardless of whether the book has moved.** No Trap-5
conflict.

## 5. ARCHITECTURE RECOMMENDATION

### Option (a) — sport-separate
MLB gate phase + NBA consolidation phase as separate ships. Pro: smaller blast radius per ship; matches existing
sport-siloed code. Con: duplicates the gate logic twice; the highest-value surface (parlays) gets fixed twice on
different timelines; no shared primitive for NFL/NHL later.

### Option (b) — UNIFIED-GATE-PRIMITIVE — **RECOMMENDED**
A single sport-agnostic `liveStateGate(leg)` primitive: input a pick/leg + its resolved live-state envelope
(MLB `row.mlbLiveState`, NBA availability), output `{ status: ok | soft | dead, reason, graduatedConfidence }`.
Applied at TWO attachment points: (1) the board serializer (single picks) and (2) **parlay/slip assembly** (the
headline gap). MLB feeds its currently-unused `row.mlbLiveState`; NBA feeds its (consolidated) availability sources.
- **Graduated, not binary**: `dead` (scratched / confirmed OUT) = remove the leg / kill the parlay; `soft`
  (questionable / game-time decision / late steam) = flag + confidence haircut, surface with a warning. This serves
  lotto-parlay logic better than a binary YES/NO — a `soft` leg can stay with a visible caveat; a `dead` leg never
  rides a ticket.
- **Parlay-aware**: at assembly, ANY `dead` leg → the whole parlay is dropped or rebuilt without it; the gate
  operates on the ticket, not just per-leg in isolation.
- Pro: closes the highest-stakes hole once, both sports; extensible to NFL/NHL; one place to reason about live-state
  correctness; plain-English reason strings feed the operator's per-pick reasoning requirement.
- Con: a new shared primitive (more design up-front than a point-fix); must thread both sports' differently-shaped
  detection into one envelope.

## 6. RESIDUAL / OPEN (resolve in build-phase deep-dives)
- **Two NBA injury sources** feed DIFFERENT mechanisms: ESPN `nbaAvailabilityCache` → soft modelProb shift; official
  `ingestNbaOfficialInjuryReport` → edge/surface forceSit. If they disagree on a player's OUT status, single picks
  (official) and parlays (ESPN-soft) can treat the same player differently. The unified gate should pick ONE
  authoritative source (or a documented precedence) — coherence fix.
- `forceSit` LABELS `finalDecisionLabel:"sit"` (does not delete the row); curated surfaces filter via
  `isTrueCuratedHardStop`, but any surface that doesn't check the label still shows the row.
- MLB lineup adapter coverage (apiSports scaffold vs official-lineups) — confirm which is live + its slate coverage.
- NBA in-game (intra-slate) injury polling — confirm absent before scoping a feed.

## 7. SUGGESTED BUILD PHASING (parlay-surface priority, each its own gated ship)
- **Phase 1 — parlay-surface gate primitive (HIGHEST impact):** the unified `liveStateGate` applied at parlay/slip
  assembly (MLB auto-tickets + NBA AI slips). Closes the operator's core-use-case hole first. WIRE-ONLY.
- **Phase 2 — MLB single-pick board gate (MEDIUM):** consume `row.mlbLiveState` into a board-level gate + surface
  the reason to the FE. WIRE-ONLY.
- **Phase 3 — NBA AI-picks gate + source consolidation (SMALLER):** align Path B with Path A's hard-stop; resolve
  the two-injury-source precedence. WIRE-ONLY.
- **Deferred (own phases, NEED-FEED):** NBA in-game injury polling, sharp-money tracking, beat-reporter news.

Each build phase still gets the binding empirical-pre-check + consumer-sweep (the rhythm that flipped 3 of 5
Signal-Fill-1B candidates) before any code. Operator reviews this synthesis before any per-phase build plan.
