# Cold-Start Fast-First-Paint (build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** PHASE 0 (decouple report) + PHASE 1 (fix). FE-only.
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-09 19:50 ET — Claude-A.

---

## PHASE 0 — the decouple point (reported)

On load, the init calls `refresh(false)` (frontend/mobile/index.html). Inside `refresh`, the first `render()` is **awaited behind** `await Promise.all([fetchSport("mlb"), fetchSport("nba")])` — the two **heavy `/api/ws/state`** fetches (~835KB each + the snapshot auto-refresh that re-pulls the live odds API when stale). So the landing's `render()` (and therefore the Top Picks paint) doesn't run until `/state` resolves → the ~45s "Loading tonight's edges…".

But the landing (Top Picks) does **not** need `/state`: `renderTopPicks` self-fetches the **fast** `/api/ws/top-picks` (reads `tracked_best`). The cleanest decouple is to call `render()` **before** the backgrounded `refresh()` at the init site, so Top Picks paints from the fast endpoint immediately and `/state` loads in the background.

## PHASE 1 — the fix (1 FE edit)

`frontend/mobile/index.html`, init site: `render();` now runs **before** `refresh(false);`.

- `render()` → landing is `activeSport: "top"` → `renderTopPicks` self-fetches `/api/ws/top-picks` → paints in ~1s.
- `refresh(false)` → the heavy `/api/ws/state` (both sports) loads in the **background**; it no longer gates the first paint.
- Tabs that need `/state`: **SLIPS** already guards null state (`renderSlips`: `if (!d || !d.aiSlips) continue`) and fills in when the background fetch lands. **GAMES** (`renderGamesAllSports` → `/api/ws/games`) and **GRADES** (`/api/ws/grades-health` + ledger) self-fetch independently of `/state`. **MY BETS / ANALYZE** don't depend on `/state`.
- The version-poll + "X ago" auto-refresh banner are untouched.

## Verification (this side)

- FE script body `new Function()` check — clean (3,794 lines).
- Init order confirmed: `render()` (4485) before `refresh(false)` (4486).
- No backend change; no PRESERVED file touched.
- **LIVE proof = Claude-A:** open `/m` cold → Top Picks paints fast (was ~45s); every tab (SLIPS/GAMES/MY BETS/ANALYZE/GRADES) still loads.

## Honest notes

- The heavy `/state` still takes ~45s in the background, so **SLIPS** opened in the first ~45s shows empty until state lands (it self-corrects on the background re-render). Top Picks — the landing and the operator's daily friction — is now instant.
- After the background `/state` resolves, `refresh()` re-renders once; if still on Top Picks, `renderTopPicks` re-fetches `/api/ws/top-picks` (a brief reload at the ~45s mark). Minor; a follow-up could suppress that re-render on the landing.
- **Optional backend follow-up (the handoff's optional item):** if the `/state` re-pull is the long pole even in the background, `/api/ws/state` could serve the cached snapshot immediately and fire the live-odds refresh async (serve-stale-fast). Not needed for the felt cold-start (the landing is already instant); queued if SLIPS/state latency matters.

## Note on the version check

FE-only change (served by `express.static` from disk) — the new index.html is live on a browser hard-reload without a backend reload. The fence still reloads the backend so `/api/ws/version` stays `== HEAD` (avoids a false STALE-CODE alert), per the discipline.
