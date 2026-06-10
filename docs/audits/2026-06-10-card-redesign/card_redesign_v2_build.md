# Card Redesign v2 · PHASE 1 (build record)

**Date:** 2026-06-10 ET · **Author:** Claude-B (4.8) · **Type:** build (operator approved the design). Display-only — picks/edges/scoring tier **byte-identical**.
**Design:** `card_redesign_v2_phase0.md`.

---

## What shipped (3 files)

- **NEW** `backend/pipeline/shared/playerPropHistory.js` — `getPlayerPropHistory({sport,player,statFamily,side,line})` counts the games where the player's own stat was under/over the line, from his game log (`nbaPlayerGameLogs` / `mlbBatterGameLogs` / `mlbPitcherGameLogs`). Returns `{n, hits, rate, perPlayer:true}` or **null** when the family isn't a countable box-score stat or the sample is < 10 games. Anti-fabrication: real logs only; thin/missing → null.
- `backend/routes/workstationRoutes.js` — `/api/ws/top-picks` attaches `pick.playerPropHistory` per pick (alongside the Wave-1 `displayTier`). Scoring `pick.tier`/edge untouched.
- `frontend/mobile/index.html`:
  - **Cap consistent everywhere** — `renderV2Card` border + conf-number color now read `displayTier` (3044); the **popup** (`_v2OpenModal`) reads `displayTier` and shows the honest line **"model rated ELITE — under review (not yet beating the market)"** when capped (was a bare "ELITE · conf 79%").
  - **Per-player won-X%** — new `_renderPerPlayerLine` ladder: (1) `playerPropHistory` "Langeliers: under 2.5 in 14 of his last 18 · 78%"; (2) labeled type bucket ("picks like this … not <player> alone"); (3) "not enough games yet". Replaces the old shared archetype chip on the card.
  - **Aesthetics** — decluttered compact face: readable sport label · name bigger + team behind name · prop bigger · the per-player line · displayTier badge (+ "tier under review") · **labeled** "MODEL CONF" + "EDGE vs MKT" (edge colored by sign) · the why one-liner moved **off** the face. Popup is **full card-width** (520 / 94vw, was 320) and carries the detail **signalsTable** + reasoning + line-shop. Header shows **"⟳ refreshing prices…"** while the background fetch runs.

## Verification (this side — all ran)

- `node --check` clean (playerPropHistory + workstationRoutes); route loads. FE `new Function()` clean (3,845 lines).
- **Per-player gate (the bug):** through the real module — **Wemby UNDER 2.5 threes = 11/16 (69%)** ≠ **Vassell = 8/16 (50%)**; Langeliers TB = 15/19 (79%); Wemby OVER = 5/16 (31%, correct inverse); unknown player + Skenes (2 starts) → null → labeled fallback.
- **Byte-identical:** `playerPropHistory` + `displayTier` are NEW display fields; `pick.tier`/edge/modelProb/selection untouched (proven on a sample pick — `JSON.stringify({tier,edge,modelProb})` identical pre/post).
- **Cap consistency:** border + conf color + popup all derive from `displayTier`; popup shows the under-review note when `tierCapNote` present.
- **LIVE proof = Claude-A:** Wemby ≠ Vassell on screen · a capped pick reads PLAYABLE/under-review on pill + border + conf + popup (no stray ELITE) · decluttered face + full-width popup + labeled %s · thin-sample player shows "not enough games yet". After fence: `/api/ws/version == HEAD`.

## Notes

- Pitchers (Ks) have ~2 starts in the 14-day window → per-player returns null → the card shows the labeled type bucket ("picks like this: 18% … not <pitcher> alone"). Honest; a longer pitcher window would enable per-pitcher (queued).
- Still display-only. The earned badges return via Wave 3 (R2) once the tier assignment is cured + graded.

## Queued

WAVE 3 R2 (tier-assignment cure) · /status sibling cards · opp-K%-into-scoring · neg-edge-in-list display check.
