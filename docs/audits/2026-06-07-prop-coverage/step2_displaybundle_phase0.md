# Step-2 MLB displayBundle — PHASE 0 report (attach topology + PRESERVED + schema)

**Date:** 2026-06-08 ET · **Author:** Claude-B (4.8) · **Type:** read-only PHASE 0 — NO code written. Operator eyeballs the schema before PHASE 1 build.
**Spec:** step2_statbacking_map_mlb.md (the (a)/(b)/(c) map). **Precedent:** NBA `buildPlayDisplayBundle.js` attached as `play.displayBundle` at board assembly (`buildNbaBestBetsBoard.js:623`).

---

## 1. Attach topology (single compute site, rides all surfaces)

The operator-visible MLB picks (TOP PICKS / `/api/best-available` / `mlb_tracked_best` / `mlb_picks`) all derive from the **`best` rows of `buildMlbLiveDualBestAvailablePayload`** (server.js). Those rows are `{...row}` spreads of the enriched snapshot rows (`buildMlbClusters.js:43`), so they **already carry** `batterStats`, `pitcherEnvironmentContext`, `parkContext`, `weatherContext`, `lineupContextV2` (live-confirmed: 7353/8030/8030/6350/7106 of ~8.6k rows). So one attach reaches everything:

| Surface | How it gets the bundle | Edit needed? |
|---|---|---|
| `/api/best-available` (mlbIsolatedRoutes) | returns `bestAvailablePayload.best` as-is (`:219`) — bundle rides along on the row | **NO edit** (sensitive MLB-route untouched) |
| `mlb_tracked_best` (the board card) | `toTrackedMlbBestEntry` whitelist | +1 line: `displayBundle: row?.displayBundle ?? null` |
| `mlb_picks` | `toTrackedMlbPick` whitelist | +1 line |
| `/api/ws/state?sport=mlb` (workstation) | carries candidate-pool fields | **FLAG** — confirm in PHASE 1 whether it needs the +1 carry; likely rides along |

**The graded ledger `mlb_tracked_bets` (leanBet path) is NOT the bundle home** — it's fed by `buildMlbBestBetsBoard.allPlays`, whose rows come from `marketPropsFromMlbRows` which **field-strips** the enrichment (only player/family/line/odds/side survive). So the ledger rows lack `batterStats`/`pitcherEnvironmentContext` — attaching there would yield a near-empty bundle. The board surface is the correct, data-rich home. (If grading-corpus reasoning is wanted later, that's a separate richer-engine wire.)

**Compute site:** `buildMlbLiveDualBestAvailablePayload` (server.js), attach `row.displayBundle = buildMlbDisplayBundle(row)` on each `best` row before return — mirrors NBA's board-assembly attach exactly.

---

## 2. Files touched + PRESERVED status

| File | Edit | PRESERVED? |
|---|---|---|
| **NEW** `backend/pipeline/mlb/buildMlbDisplayBundle.js` | the assembler (pure fn, reads row fields + `getBatterForm`) | new, non-PRESERVED (mirrors `buildPlayDisplayBundle.js`) |
| `backend/server.js` (`buildMlbLiveDualBestAvailablePayload`) | additive: require + kill-switch const + `row.displayBundle = …` per best row | **OG monolith** — additive-only, no delete (per `project_server_js_og_monolith`). Not Tier-1. |
| `backend/pipeline/mlb/phase4Tracking.js` (`toTrackedMlbBestEntry`, `toTrackedMlbPick`) | additive: `displayBundle: row?.displayBundle ?? null` | non-PRESERVED |
| `backend/http/mlbIsolatedRoutes.js` | **NOT EDITED** — bundle rides along on `payload.best` | MLB sibling of PRESERVED `nbaIsolatedRoutes`; deliberately untouched ✓ |
| `backend/pipeline/shared/probabilityHonesty.js` | **NOT EDITED** — referenced for null-discipline only | PRESERVED Tier-1 ✓ |

No PRESERVED Tier-1 file is edited. `server.js` is the sensitive monolith but the edit is purely additive (attach a field). FLAG acknowledged: `mlbIsolatedRoutes` stays untouched by design.

---

## 3. Proposed bundle schema (operator: eyeball this)

`displayBundle` (additive new key on each MLB pick). **Every field null-guarded — missing source ⇒ field omitted or null, NEVER fabricated** (probabilityHonesty / betting-dashboard-invariants).

```
displayBundle: {
  _version: "mlb-v1",
  statBacking: {
    opposingPitcher: { name, kRate, gbRate, fbRate, velocityMph, restDays, fatigueFlag } | null,  // from row.pitcherEnvironmentContext
    seasonLine:      { avg, obp, slg, ops, iso, kRate } | null,                                    // from row.batterStats
    recentForm:      { l5:  { hits, ab, pa, hr, rbi, ... }, l15: {…} } | null,                     // getBatterForm(player, 5|15)
    park:            { hitsFactor, hrFactor, doublesFactor } | null,                               // from row.parkContext
    platoon:         { isPlatoonAdvantage, batterHand, pitcherHand } | null,
    weather:         { windDirectionTag, carryShift, temperatureF } | null,                        // from row.weatherContext
    lineup:          { spot, depth, status } | null,   // status: "confirmed"|"pending" — NEVER blank-as-0
  },
  whyThisPick: {
    edge,                       // edgeProbability
    tier, bucket, volatility,
    modelProb,                  // predictedProbability — ALREADY calibration-dampened (calibrationFeedback wire); honest
    impliedProb,                // from the priced odds
    mlbPhase3Score,             // the score that surfaced it
    contextualTags,             // existing plain-English tags
  },
  notWired: {
    liveNews: "not_wired",                                   // no feed — operator-approved honest label
    lineupConfirmation: "confirmed" | "pending" | "scratched" // from deriveMlbStarterConfirmationState/mlbLineupCache (structured substitute for news)
  }
}
```

**Two design notes for the operator's nod:**
1. **Calibrated probability.** `modelProb` (predictedProbability) is ALREADY run through the calibration-feedback wire, so it's the honest calibration-adjusted number — the bundle shows `modelProb` vs `impliedProb` vs `edge`, all real. A *separate* "won X% of N similar settled picks" display would need a live corpus query (`outcome_snapshots × prediction_snapshots`) at serialize time — heavier, and a **v2 option**, not v1. v1 shows the real model/implied/edge triplet; never a fake confidence %.
2. **Recent form cost.** `getBatterForm` reads a file cache (no network) — cheap at serialize, but it's a lookup per pick (not a field copy). Fine for the ~100-pick board; flagged as the one non-trivial bundle field.

---

## 4. Regression plan (for PHASE 1, after operator nod)

- EVERY existing pick field BYTE-IDENTICAL pre/post (bundle is additive) — the gate.
- `MLB_DISPLAY_BUNDLE=0` ⇒ no `displayBundle` key ⇒ byte-identical to today.
- Spot-check 5 real picks: each bundle field traces to a real source; null/absent ⇒ omitted; lineup unconfirmed ⇒ "pending"; no fabricated number.
- MLB PRESERVED-file sha256 unchanged; `node --check`; backend reload; runtime:verify 13/13.

**STOP — awaiting operator nod on the schema (§3) before PHASE 1 build.** Bettor-visible delta: ZERO until a FE renders the bundle.
