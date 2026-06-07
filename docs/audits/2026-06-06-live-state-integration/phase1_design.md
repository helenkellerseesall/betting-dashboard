# Phase 1 — Parlay-Surface Live-State Gate (UNIFIED primitive) — DESIGN (read-only, no code)

Date 2026-06-07. From Live-Game-State-Integration-1A audit (synthesis.md). WIRE-ONLY: detection already exists for
both sports (no new feeds). Scope: the parlay/slip assembly surface — the highest-impact gap per the matrix.
Operator approves this design before any code; build is a separate phase with the regression-gate-first fence.

## Goal
A single sport-agnostic gate so a scratched/OUT player can never silently ride an auto-built parlay, and a
questionable/steam-blown leg surfaces a plain-English reason. Foundation for the lotto-parlay vision + per-pick
reasoning ([[product-ladder-direction]], [[product-vision-iphone-pwa]]).

## 1. The primitive API
New module `backend/pipeline/shared/liveStateGate.js`:

```
liveStateGate(leg) → { status, reason, source, capturedAt }
  status:  "ok" | "soft" | "dead"
  reason:  operator-friendly string ("Aaron Judge scratched from the lineup", "Wemby questionable per official
           injury report", "line steamed -110 → -150 since open") — NOT engineering jargon
  source:  which detection layer fired ("mlb.lineup.scratched", "mlb.starter.scratch", "mlb.lineMovement.steam",
           "nba.availability.out", "nba.official.forceSit", "nba.availability.questionable")
  capturedAt: detection timestamp (mlbLiveState.capturedAt or availabilityContext.lastUpdated) for traceability
```
Sport-agnostic: reads MLB `leg.mlbLiveState` or NBA `leg.playerStatus`/`leg.availabilityContext` off the leg/row.
Plus an assembly helper:
```
gateParlayLegs(legs) → { legs: gated[],            // each leg gains leg.liveState = {status,reason,source}; dead removed or marked per policy
                         summary: { worst, deadCount, softCount, reasons[] } }   // ticket-level rollup for FE + why
```

## 2. status mapping (both sports)
- **DEAD** (the leg cannot win — remove/mark): MLB `mlbLiveState.lineup.scratched===true` (prop's own batter not in
  the confirmed lineup); MLB `starter.changeType==="scratch"` when the prop's player IS the starter (pitcher prop);
  NBA `playerStatus==="out"` or official `forceSit`.
- **SOFT** (still live but degraded — flag + confidence haircut + reason): MLB `starter.changeType` in
  {emergency_callup, opener_pivot} on the OPPOSING starter (batter matchup stale, batter still plays); MLB
  `lineup.lineupSpotChanged`; MLB `lineMovement.steamFlag` / `weatherDelta.materialShift`; NBA `playerStatus` in
  {questionable, doubtful}.
- **OK**: no adverse flags. **AND** — Trap-1 — when the detection envelope is missing/null (live-state didn't run,
  player not in cache), return **OK**, never DEAD. A missing envelope is "no signal", not "dead".

## 3. Insertion points (WIRE-ONLY)
- **MLB — `buildMlbAutoTickets.js`:**
  - `buildTicket({type, legs})` L419 (CHOKE POINT — every ticket type returns through here): run `gateParlayLegs`;
    attach `liveState` per leg + `liveStateSummary` on the ticket; apply the dead-leg policy (§4).
  - `pickLegsFromPool` L430: pre-filter DEAD legs from the selectable pool so fresh tickets aren't built on a
    scratched player to begin with (belt-and-suspenders; buildTicket is the authority).
  - Reason strings fold into `buildWhy` L378.
- **NBA — `buildNbaAiSlips.js`:**
  - `buildNbaAiSlips(input)` L495 (CHOKE POINT): gate each assembled slip's legs + attach `liveStateSummary`.
    Reuse the existing **EXPL-4 anti-stale-player doctrine** (buildFeaturedPlays already drops `playerStatus="out"`)
    — generalize it to the slip path it currently skips. Optionally pre-gate elite/strong/pool before the builders.

## 4. Parlay-level semantics — DEAD-leg policy (OPERATOR DECISION)
A fresh auto-ticket should never be built on a dead leg; but the operator's worked example wants the dead state
SURFACED (not silently hidden). Three options:
  (i)  flag-and-surface: keep the ticket, mark it `dead`, mark the dead leg, recompute odds without it, surface the
       reason — operator decides ride-out.
  (ii) exclude-and-rebuild: drop the dead leg, rebuild a clean ticket from the pool — but the scratch is hidden.
  (iii) **BOTH (RECOMMENDED):** pre-filter the pool so NEW auto-tickets are clean (no dead legs selected); AND if a
       leg goes dead intra-cycle on an already-assembled ticket, flag the ticket `dead` + mark the leg + reason. If
       removing dead legs leaves < 2 legs, the ticket is marked `dead`/dropped with a reason (no degenerate parlay).
  SOFT legs: always kept + flagged with reason + a small ticket-confidence haircut; surfaced ("1 leg questionable").
  NOTE: flagging a PLACED ticket the operator is already riding (a leg goes dead after they bet) is a SEPARATE
  surface (tracked-bets) → a later phase, not Phase 1 (Phase 1 is the auto-builder/assembly).

## 5. Worked examples
- MLB 4-leg HR parlay, batter #3 scratched: gate → leg3 DEAD ("Marcell Ozuna scratched from the lineup"). Policy
  (iii): leg3 excluded from new builds; if this exact ticket was already assembled, ticket.liveStateSummary =
  {worst:"dead", deadCount:1, reasons:["Marcell Ozuna scratched from the lineup"]} → surfaced as a dead ticket.
  Before: {ok,ok,ok,ok} silently (scratch invisible) → ticket rides → $0. After: dead leg caught + surfaced.
- NBA 3-leg threes parlay, one player questionable: gate → that leg SOFT ("Klay Thompson questionable, game-time
  decision") → kept, ticket flagged soft, confidence haircut, reason shown. Operator bets informed.
- NBA parlay, one player OUT: gate → DEAD → excluded from new builds (today it only gets a −2pp nudge and can ride).
- Missing envelope (live-state feed down): gate → OK for all legs (Trap-1) → parlays build normally, no false kills.

## 6. Traps
- **Trap 1 (null→ok):** missing/undefined envelope → OK, never DEAD (guard at gate entry). Else a feed outage nukes
  every parlay. THE most important guard.
- **Gate-must-act (the audit's own warning):** verify the assembler ACTUALLY removes/marks dead legs — a synthetic
  scratched leg must be gone-from / flagged-on the assembled ticket in the build probe. A gate the assembler ignores
  is the same dead wire we're fixing.
- **Trap 5:** N/A — live-state is a correctness gate, not an edge signal (no double-count; apply post-edge).
- **Two NBA injury sources:** ESPN (`nbaAvailabilityCache`, soft) vs official (`ingestNbaOfficialInjuryReport`,
  forceSit). The gate must pick ONE authority for DEAD (recommend: official forceSit OR playerStatus==="out", with
  documented precedence) so single-pick and parlay treat the same player identically. Resolve in build-step-1.

## 7. Build plan (separate phase, after design approval)
- Step 0 (provenance, cheap): confirm real NBA slip legs carry `playerStatus`/`availabilityContext` and real MLB
  auto-ticket legs carry `mlbLiveState` at assembly (drive the real builders on a sample) — like the HR/9 provenance
  check.
- Step 1: write `liveStateGate.js` (primitive + `gateParlayLegs`) + unit-drive on synthetic dead/soft/ok/null legs.
- Step 2: wire into `buildMlbAutoTickets` (buildTicket + pickLegsFromPool).
- Step 3: wire into `buildNbaAiSlips` (choke point).
- Probe (`.scratch/probe_p1_gate.txt`, regression-gate-first): synthetic scratched/OUT leg → confirm REMOVED/MARKED
  on the assembled ticket (gate-must-act); soft leg → flagged + reason; null envelope → ok (Trap-1); all-ok ticket
  unchanged (regression); runtime:verify 13/13.
- Separate code + docs commits; backend reload.

## 8. OPEN DECISIONS for operator
1. DEAD-leg policy: (iii) both (recommended) vs (i) flag-only vs (ii) exclude-only.
2. NBA DEAD authority: official forceSit vs ESPN playerStatus==="out" (precedence when they disagree).
3. SOFT confidence haircut size (e.g. −X pp on ticket confidence per soft leg) — or flag-only with no numeric haircut.
4. Does `lineMovement.steamFlag` belong as SOFT here, or is it a market-edge concern out of scope for a live-state
   *availability* gate? (It's detected in mlbLiveState; including it widens the gate beyond pure availability.)

No code. predictionId / PRESERVED tier-1 untouched. Operator reviews + answers §8 before the build phase.
