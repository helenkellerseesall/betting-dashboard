# Wave 1 — Honest Trust Signals · BUILD RECORD

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator nodded all 3 decisions). Display-only — picks/edges/scoring **byte-identical**.
**Audit:** `wave1_cap_and_wonpct_audit.md`.

---

## PART B — pick-specific "won X%" (robust-n side/odds ladder)

`archetypeHistoryLookup.js` — added pick-specific buckets so the number reflects THIS kind of bet, not the OVER-longshot-dominated family rate.
- New SQL aggregations: `family+side` and `family+side+oddsBucket` (oddsBucket from `implied_prob`: fav ≥.55 · pickem .45–.55 · dog .30–.45 · longshot <.30).
- New lookup ladder with the operator's **robust-n floor (n ≥ 30)** for specific buckets: `(volatility,tier)≥30` → `family+side+odds ≥30` → `family+side ≥30` → `family` (labeled **broad**) → omit. Never swaps a misleading-low family rate for a rosy small sample.
- `attachArchetypeHistory` (workstationRoutes) now passes `side` + `oddsAmerican`. FE chip labels the broad fallback honestly ("broad — <family>-wide").

**Before/after (live, `outcome_snapshots`):**
- **Langeliers UNDER 2.5 TB, favorite (−150): `won 70% of 83` [family+side+odds]** — was `16% of 2984`.
- totalbases UNDER, no odds: `58% of 617` [family+side] (falls back when odds absent).
- pitcher Ks OVER (−110): `18% of 381` [family+side] (odds sub-bucket thin → robust-n falls back).
- HR OVER (+350): `10% of 388` [family+side].
- side missing → `16% of 2984` [family BROAD] (honest, labeled).

## PART A — cap unearned ELITE/STRONG (display-only)

`buildHitRateByTier.js` — extracted `_buildGradedPicks` (shared load+dedup+vig) and added `getEarnedTierFamilySet` / `isTierFamilyEarned` (and `describeTierFamily`): a `(sport,tier,family)` is **earned** only with **n ≥ 30 AND canonical vig-aware edge ≥ 0** — the same method as the GRADES card (not the raw cut).
`workstationRoutes.js` `/api/ws/top-picks` — stamps a NEW `pick.displayTier` (+ `tierCapNote: "tier under review"`) when an ELITE/STRONG family isn't earned; **`pick.tier` / edge / selection untouched**. FE renders the badge + groups by `displayTier`.

**Tonight's relabel (canonical vig-aware, n≥30, edge≥0):** the only earned bucket is `PLAYABLE|hr` → **all 60 ELITE/STRONG picks relabel to PLAYABLE + "tier under review"** (24 ELITE + 36 STRONG). Including totalbases: STRONG totalbases n=32 but vig-aware **−11.3pp** (the raw +5.2pp had vig + no-dedup baked in). Langeliers ELITE totalbases → PLAYABLE + under-review. This is the honest "no badge until earned," tied to the real per-family record — the stopgap until R2 (Wave 3) cures the assignment.

## Verification (this side — all ran)

- `node --check` clean on all 3 backend files; FE `new Function()` clean (3,808 lines).
- **GRADES parity:** `computeHitRateByTier(mlb)` after the refactor still returns the live tier numbers (ELITE −15.4/n=46, STRONG −7.3/n=184…) — the `_buildGradedPicks` extraction didn't change the GRADES computation.
- **Byte-identical:** the cap stamps only `displayTier`/`tierCapNote`; `JSON.stringify({tier,edge,modelProb})` identical before/after on a sample pick. The top-picks allocation still slices by the scoring `pick.tier`, so the SAME 50 picks are served — only their displayed tier + won-X% bucket changed.
- PART B before/after verified through the real `getArchetypeHistoryForPick` (table above).
- **LIVE proof = Claude-A:** Langeliers UNDER shows ~70% (not 16%); thin-n ELITE relabeled to PLAYABLE + "tier under review". After fence: `/api/ws/version == HEAD`.

## Queued

WAVE 2 card redesign (8 UI pts + "refreshing price" tick) · WAVE 3 R2 (assignment cure) · /status sibling cards · opp-K%-into-scoring.
