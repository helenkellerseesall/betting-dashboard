# FE Surface Consolidation · PHASE 1 (build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator nodded both decisions; mechanism = Option (a), lowest blast radius).
**Companion:** `fe_surface_consolidation_phase0.md` (4-surface map, landing-bug trace, upcoming-games premise correction).

---

## What shipped (FE-only — no backend touched)

All four edits are in `frontend/mobile/index.html`. No backend route changed → `/m` is served by `express.static` (server.js:145), which reads from disk per request, so **no backend reload** — the operator just hard-reloads `/m`. Tonight's slate / CLV capture undisturbed.

### Decision #1 — land on Top Picks + retire sub-tabs
- `state.activeSport: "mlb" → "top"` (index.html:778). This single line is the whole fix: on load, `render()` now routes to `renderTopPicks` (the curated view), matching the `.active` nav highlight that was already on the TOP PICKS button (line 685). The old desync — nav says TOP PICKS, content shows "Tonight's Games" — is gone.
- **Sub-tabs retired for free:** the legacy MLB/NBA sport tabs aren't in the bettor nav (only TOP PICKS · SLIPS · MY BETS · GAMES · ANALYZE · GRADES exist as buttons). Once we land on `top` and never route the bettor to mlb/nba, the Tonight's-Games/Sharp-Plays mode toggle is unreachable. **Nothing deleted.** The A.5 "stuck in Sharp" dead-end is structurally impossible from the bettor nav.

### Decision #2 = Fork B — GAMES tab = the snapshot feed (gains upcoming games)
- GAMES routing (`sport === "games"`) now calls the new **`renderGamesAllSports`** instead of the legacy `renderGamesBrowser`.
- `renderGamesAllSports` is an all-sports (NBA-first) view over the odds **snapshot**, reusing the existing snapshot drill-down (`renderGameCard` → `renderPlayerCard`). It reads the per-sport snapshot cached in `state.games[sport]` (populated by `fetchGames` → `/api/ws/games`), lazily fetching any sport not loaded. **No backend change** — same endpoint "Tonight's Games" used.
- **Mechanism choice = Option (a)** (reuse the snapshot render) over Option (b) (rewrite `/api/ws/games-browser`): lower blast radius, reuses the already-working upcoming-inclusive + calibrated render, and touches no backend.
- **Honest future-game labeling:** `renderGameCard` gained an optional `opts` param. When the GAMES tab passes `{ todaySlate }`, a game whose ET calendar date is after today gets an **"UPCOMING · LINES ONLY"** badge + a "picks generate closer to game time" subline. The per-prop model chip already renders only `if (Number.isFinite(pp.modelProb))` (index.html:2047) — future games have no tracked_bets join → no chip, **no fabricated edge**. The dormant `renderGamesView` calls `renderGameCard(g, sport)` with no opts → byte-identical there.

### Left dormant (not deleted — minimize blast radius)
`renderGamesBrowser` (no active callers; `_gamesBrowserCache` is write-only, read nowhere), `/api/ws/games-browser`, `renderGamesView`, `renderModeToggle`, the Sharp-Plays candidates block + its honesty marker. All reachable only via dev-console `data-sport=mlb|nba`.

## Verification (this side)

- **FE syntax:** `new Function()` over the full script body — clean (3,785 lines).
- **Data source proof (non-zero probe):** replicated `readSnapshotRows` + the `/api/ws/games` event-grouping over the on-disk snapshots. Result, today = 2026-06-09 ET:
  - **NBA: 1 game — Spurs @ Knicks, ET date 2026-06-10 → flagged UPCOMING (lines only)** (the Wednesday playoff game the operator wanted to see).
  - **MLB: 15 games, all tonight (06-09)**, 22–25 players each.
  - The FE's future-label logic uses the identical ET-date comparison (`toLocaleDateString("en-CA", {timeZone:"America/New_York"})`), so the badge fires on the NBA game only.
- **Routing clean:** `renderGamesBrowser` has zero active callers; `renderGamesAllSports` has exactly one; `sport === "games"` → `renderGamesAllSports`.
- **No fabrication:** future-game model chips suppressed by the existing `Number.isFinite(pp.modelProb)` gate; the only future-game annotation is the honest "lines only" label.
- **LIVE render proof = Claude-A's step** (backend on operator host): full nav screenshot-verify — lands on Top Picks · GAMES shows the Spurs@Knicks game labeled lines-only · no Tonight's-Games/Sharp-Plays sub-tabs · all six tabs reachable · GRADES by-tier card intact.

## Follow-ups (unchanged queue)

MLB-TIER-ASSIGNMENT-FIX (R2) · deeper alt-line calibration · pitcher-Ks/SB re-scope (Ks already on Top Picks). Also owed: Claude-A's on-screen verify of the T1 #2 GRADES by-tier card (shipped e94c1ac/ca57031), now reachable since the landing bug is fixed.
