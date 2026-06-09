# Prop-Specific Stat-Backing Rebuild · PHASE 1 (build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator GO, layout approved, ship-now omit-when-absent).
**Companion:** `prop_card_layout_show_before_edit.md` (approved layout + samples) · `prop_predictors_data_map.md` (the map).

---

## What shipped

The Top Picks cards now render **prop-specific, real stat backing on every MLB pick** — sourced from a serve-time per-pick assembly, not the generic team-implied-total/environment blob and not the ~3.6% board join.

### Files (2 code)

- **NEW** `backend/pipeline/mlb/assembleMlbPickStatBacking.js` — serve-time per-pick assembly. Batters: reuse PRESERVED `buildMlbDisplayBundle` on the player's snapshot row (already carries opposing-pitcher / park / weather / platoon) enriched with the season line from `mlbBatterStats`; `getBatterForm` supplies L5/L15. Pitcher Ks: a **new pitcher-shaped bundle** — recent Ks from `mlbPitcherGameLogs`, season K%/K9/WHIP/IP-per-start from `mlbPitcherStats`, opponent-lineup K% **derived** from the opposing team's cached batter kRates (no new feed). Reaches 100% of picks by resolving the player against the full slate snapshot + caches (canonical `normPlayer`). Omit-not-fabricate throughout (`pruneNull`, `num` Trap-1 guards).
- `backend/routes/workstationRoutes.js` — (1) require the assembler; (2) in `/api/ws/top-picks`, assemble `pick.displayBundle` for every pick before `buildReasoning`; (3) **prop-aware `buildReasoning` MLB branch rewrite** sourcing the three blurbs from `statBacking` (pitcher: Recent Ks / Opp lineup K% / Season; batter: Last-5 / Facing / Season-or-Power), omit-when-absent, **#101 dup fixed** (`out.opp.value` is a real rate, never the team name twice); (4) a small test seam exporting `buildReasoning`.

**No FE change** — the FE already renders `pick.reasoning` (`_renderReasoning`/`_reasoningOneLine`, shape preserved, renders nothing when empty) and `displayBundle.signalsTable` (`renderCard`, Step-2). **No PRESERVED file edited** (reused only).

## Verification (this side — all ran)

- `node --check` clean on both files; route module loads (require paths resolve).
- **Byte-identical pick gate:** the assembly returns a NEW object and does not mutate the pick; `buildReasoning` writes nothing to the pick. Proven: `JSON.stringify(pick)` identical before/after assembly. Selection/edge/tier/odds untouched (only `pick.reasoning` + `pick.displayBundle` are set — display-only).
- **3-prop spot-check through the real `buildReasoning`:**
  - Pitcher Ks (Skenes, opp uncached): `Recent Ks (L2) 8.5/start` · *opp omitted* · `Season 29% K · 10.5 K/9 · 0.90 WHIP`.
  - Pitcher Ks (Gilbert, opp cached): `Opp lineup K% 26% · whiff-prone, helps`.
  - Batter hits (Robles): `Facing Trevor Rogers · 17% K` (#101 fixed) · `Season .276 AVG · .345 SLG` · `Last 5 0.2 H/G · 0.2 TB/G`.
  - HR (Altuve): `Power 2.9% HR · .143 ISO` · `Last 5 0.5 H/G · 1.3 TB/G · 1 HR`.
  - No-cache batter: **every blurb omitted**, only the model line — the fabrication guard holds.
- NBA `buildReasoning` branch unchanged (only the MLB block edited) → NBA byte-identical.
- **LIVE render proof = Claude-A** (backend on operator host): screenshot all 3 prop types on `/m` Top Picks — prop-specific real stats, no "vs team team", absent stats omitted.

## Scope boundary (important — byte-identical preserved)

Opponent-lineup K% is **derived for the DISPLAY only**. It is **not** wired into the K *scoring* engine (`buildMlbPitcherCandidates.js:15` `row.opponentKPercent`), because that would change `expectedKs → modelProb → edge → selection` and break the byte-identical gate. Feeding opp-K% into the K model is a separate **scoring** change that needs its own backtest + operator sign-off — deferred.

## Follow-ups (queued)

- Expand `mlbBatterStats` populator 16 → 30 teams (widens Season + opp-lineup-K% coverage; omit-when-absent holds until then).
- Optional: feed opp-lineup-K% into the K scoring model (separate, backtested).
- Apply the same serve-time assembly to GAMES/state surfaces for consistency (Top Picks done first per the operator's complaint).
