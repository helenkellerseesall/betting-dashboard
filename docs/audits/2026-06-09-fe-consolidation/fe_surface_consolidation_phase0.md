# FE Surface Consolidation · PHASE 0 (read-only audit)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** read-only — NO code changed. Operator reads this + nods the plan before any structural FE edit (audit-before-patches binding).
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-09 04:35 ET — Claude-A. Operator wants /m to land on TOP PICKS, GAMES = single games surface that shows UPCOMING games, drop the redundant Tonight's-Games / Sharp-Plays sub-tabs.

---

## 1. The four surfaces — what feeds what

| Surface | FE renderer | Endpoint | Data source | Date scope | How the bettor reaches it today |
|---|---|---|---|---|---|
| **TOP PICKS** | `renderTopPicks` (index.html:3067) | `/api/ws/top-picks?limit=50` | `tracked_bets` → curated, calibration-dampened, tiered (ELITE/STRONG/PLAYABLE) | today's slate (rolls **back** to last graded day if none) | TOP PICKS nav tab |
| **GAMES tab** | `renderGamesBrowser` (index.html:3379) | `/api/ws/games-browser` | `tracked_bets` (drops FADE/LONGSHOT); games → players → props drill-down | today's slate only (rolls **back**, never forward) | GAMES nav tab |
| **Tonight's Games** | `renderGamesView` (index.html:1832) | `/api/ws/games?sport=` | **snapshot** rows (raw book lines + a model-prob join from tracked_bets) | snapshot = **includes UPCOMING** games | legacy MLB/NBA tab in "games" mode |
| **Sharp Plays** | sharp-mode block (index.html:1556–1763) | `/api/ws/state` candidates | raw edge-filtered candidates | today | legacy MLB/NBA tab, toggle to "sharp" mode |

The visible nav (index.html:685–691) is already **TOP PICKS · SLIPS · MY BETS · GAMES · ANALYZE · GRADES**. The legacy **MLB / NBA / PARLAY** tabs are already hidden from the nav (line 691). "Tonight's Games" and "Sharp Plays" are the two **modes** of those hidden legacy tabs (`renderModeToggle`, index.html:1786) — not top-level tabs.

## 2. Why /m lands on Tonight's Games instead of Top Picks (the landing bug)

- `state.activeSport` initializes to **`"mlb"`** (index.html:778), and MLB defaults to `tabMode: "games"` (line 789). On load, `refresh(false)` → `render()` with `activeSport === "mlb"` → routes to the legacy MLB tab in games mode → **`renderGamesView` = "Tonight's Games"** with the Games/Sharp toggle.
- Meanwhile the **TOP PICKS** nav button carries the `.active` highlight in the HTML (line 685). So on load the nav *highlights* TOP PICKS while the *content* is Tonight's Games — a desync. **This is why this whole session was spent verifying Tonight's-Games / Sharp-Plays and never the real curated Top Picks view.**
- **The fix is one line:** `activeSport: "mlb"` → `"top"` (line 778). On load it then routes to `renderTopPicks`, and the HTML `.active` (already on TOP PICKS) finally matches. No new desync.

### The A.5 dead-end (index.html:1496–1505) and why landing on Top Picks is safe
The "A.5 fix" comment exists because the operator once got **stuck in Sharp mode with no way back to Games** — the cure was rendering the Games/Sharp mode toggle *always*. Landing on `"top"` does **not** recreate that: the bettor nav has no MLB/NBA buttons (hidden), so the Games/Sharp mode toggle is **never shown to the bettor at all**. The dead-end class is structurally removed, not re-patched. (The legacy tabs stay reachable via dev console `data-sport=mlb|nba`, harmless.)

## 3. The upcoming-games question — the one real decision (don't skip this)

**Operator's premise needs a correction.** The operator wants to KEEP the GAMES tab and have it show upcoming games, and DROP Tonight's Games. But the data says the opposite of what that assumes:

- **GAMES tab (`/games-browser`) is `tracked_bets`-keyed to a single slate date** (`todayK`, line 2696) and rolls **backward** to the latest past day (`dk <= todayK`, line 2717). It has model picks/edges but **cannot show a future game** — and right now there are **no future-dated `tracked_bets` files** (latest on disk = 2026-06-08; today = 06-09). Picks aren't generated for future slates yet.
- **Tonight's Games (`/api/ws/games`) reads the snapshot** (`readSnapshotRows`, no date filter, line 262), and the snapshot **already contains upcoming games**. Probed live just now:
  - NBA snapshot: **4,306 prop rows, all dated 2026-06-11** (the upcoming playoff game — there is no NBA game tonight).
  - MLB snapshot: **11,741 prop rows — 7,640 tonight (06-09) + 4,101 tomorrow (06-10)**.

So **the surface the operator wants to drop (Tonight's Games) is the only one that currently shows upcoming games; the surface they want to keep (GAMES tab) is the today-only one.** Making the GAMES tab show upcoming is therefore **not a trivial date-filter widen** — the future games live only in the snapshot (raw book lines, no model picks yet), not in `tracked_bets`.

### The decision fork for the GAMES tab (operator picks before PHASE 1)

- **Option A — keep GAMES tab `tracked_bets`-based (model picks), accept today-only.** Drop Tonight's Games + Sharp Plays. Cleanest, lowest risk. **But it does not satisfy "show the Wed playoff game"** — no picks exist for it yet.
- **Option B — re-source GAMES tab to the snapshot (like Tonight's Games) so it shows upcoming.** Gains upcoming games; **loses the curated model-pick/edge framing** for them (future games show book lines + whatever model-prob join exists). Essentially this is "promote Tonight's Games into the GAMES tab and retire renderGamesBrowser."
- **Option C — union (recommended for intent, more work):** GAMES tab shows **today's `tracked_bets` games with picks**, PLUS **upcoming snapshot games labeled "model picks generate closer to game time."** Faithful to "one games surface, includes upcoming," and honest that future games aren't yet modeled. Most build + needs careful labeling so a pick-less upcoming game isn't mistaken for "no edge."

My recommendation: **A for the structural cleanup now (land on Top Picks, retire the two sub-tabs), and treat the upcoming-games sourcing (B vs C) as its own small follow-up** so the easy, safe wins ship without being blocked on the harder data-sourcing decision. But this is the operator's call — it's a product decision about what the GAMES tab *is*.

## 4. What's safe to remove vs keep dormant

- **Landing default** (line 778): one-line change, safe.
- **Sharp Plays:** already off the bettor nav (it's a mode of the hidden legacy tabs). Once landing is "top" and the bettor is never routed to mlb/nba, Sharp Plays is unreachable from the bettor UI with **zero deletion required**. The Sharp Plays honesty marker I shipped earlier (tab disclaimer + per-row break-even badge, backend `calibrationStatus`) can stay **dormant with the surface** — no need to rip it out. Recommend: leave the legacy mlb/nba render code in place (dormant, dev-console-only) rather than delete, to avoid touching the delicate mode-toggle logic. Lowest-risk.
- **Tonight's Games (`renderGamesView` + `/api/ws/games`):** do **not** delete in Option A — it's the only upcoming-games path and would be the basis of Option B/C. Keep dormant.

## 5. Risks for PHASE 1

- Changing the landing default is low-risk but must be screenshot-verified: every nav tab (TOP PICKS, SLIPS, MY BETS, GAMES, ANALYZE, GRADES) still reachable and rendering, no mode-toggle dead-end, lands on Top Picks.
- If the operator picks B/C, the GAMES tab gains a snapshot read — that's a backend route change (new/extended endpoint), node --check + reload + regression, and careful "picks pending" labeling so a pick-less upcoming game reads honestly (never a fabricated edge).
- No PRESERVED files are implicated by the landing/sub-tab cleanup. A snapshot-sourced GAMES tab (B/C) would touch `workstationRoutes.js` only (not a PRESERVED file).

## 6. Queue re-scope (from Claude-A's re-baseline — confirmed)

- **Pitcher Ks ARE on TOP PICKS as TOP TIER** (confirmed via Claude-A's screenshots; Top Picks reads `/api/ws/top-picks`, a different path than `/api/best-available` / `buildMlbClusters` where the earlier "Ks not on board" was observed). The backlogged "pitcher-Ks/SB not surfaced" item was about the wrong surface — **re-scope it to /api/best-available specifically, and drop the "Ks missing" framing for the operator-facing board.**
- **"won X% of N similar" track-record already renders on Top Picks** (was thought deferred) — close that as done.

---

## Decision asked of the operator (STOP here)

1. **Landing + sub-tab cleanup (easy, recommended now):** land on TOP PICKS (one-line), retire Tonight's-Games/Sharp-Plays from the bettor path (already mostly off-nav; leave dormant, don't delete). OK to build?
2. **GAMES-tab upcoming-games sourcing (the real fork):** A (today-only, model picks) · B (snapshot-sourced, gains upcoming, loses curated picks for future games) · C (union, labeled "picks pending"). Which is the GAMES tab?
3. Acknowledge the premise correction: the surface that shows upcoming today is Tonight's Games (snapshot), not the GAMES tab (tracked_bets).

No code written. Awaiting nod on #1 + a pick on #2.
