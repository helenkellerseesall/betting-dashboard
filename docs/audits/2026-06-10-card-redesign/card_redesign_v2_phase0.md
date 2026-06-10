# Card Redesign v2 · PHASE 0 (audit + design, SHOW-BEFORE-EDIT)

**Date:** 2026-06-10 ET · **Author:** Claude-B (4.8) · **Type:** audit + design — STOP for operator approval before any build. Display-only when built.
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-10 02:46 ET. Three fixes in one pass: cap consistency · per-player won-X% · 8 aesthetics.

---

## (1) Cap consistency — the cap is half-applied

Wave 1 stamped `displayTier`, but only the **pill** (renderCard:1241) + the **grouping** (3161) use it. The **actual Top Picks card** and the **popup** still use the original tier:
- `renderV2Card` (index.html:3044): `const tier = String(pick.tier || pick.modelTier)` → drives the **border color** (3095/3116) + the **conf-number color** (3106). A capped pick still wears the gold ELITE border.
- popup `_v2OpenModal` (index.html:3002): `const tier = String(p.tier || p.modelTier)` → shows **"ELITE · conf 79%"** with no under-review note (the operator's Wemby example).

**Fix (design):** every tier-derived value reads `displayTier` first — `renderV2Card` border/conf color, the popup tier text + color. The popup also shows the honest line: **"model rated ELITE — under review (not yet beating the market)"** instead of a bare "ELITE". So a capped pick reads PLAYABLE / under-review **everywhere** (pill, border, conf color, popup).

## (2) Per-player won-X% — replace the shared bucket with THIS player

Wave 1's `family+side(+odds)` bucket has **no playerId**, so Wemby & Vassell (both NBA threes-under) showed the **same** "100% of 45". Per-player game logs exist and the gate passes — real numbers just computed:

| player | prop | per-player rate (from game logs) |
|---|---|---|
| **Wembanyama** | threes UNDER 2.5 | **under in 11 of 16 games (69%)** |
| **Vassell** | threes UNDER 2.5 | **under in 8 of 16 games (50%)** |
| **Langeliers** | total bases UNDER 2.5 | **under in 14 of 18 games (78%)** |
| **Rooker** | total bases UNDER 2.5 | under in 13 of 17 games (76%) |

Wemby 69% ≠ Vassell 50% — the gate. Source: `nbaPlayerGameLogs.json` (125 players, ~16 g) · `mlbBatterGameLogs.json` (386 players, 21-day) · `mlbPitcherGameLogs.json` (Ks). Compute: count games where the stat is under/over the line ÷ games.

**Wording (clearly per-player):** "**Langeliers: under 2.5 TB in 14 of his last 18 games**" / "**Wemby: under 2.5 threes in 11 of 16**".

**Honest fallback (omit-not-fabricate):** thin player sample (**n < 10 games**) → "**not enough games yet**", OR a **clearly-labeled type bucket** ("picks like this: X%") — **never** a type rate dressed as the player's. (The Wave 1 family+side number stays available as the explicitly-labeled type fallback.)

## (3) Aesthetic redesign — the 8 points + the new layout

**Card FACE (decluttered — identity + the decision):**
- Sport label readable (not a tiny grey chip) · **player name BIGGER** · **team behind the name** (e.g. "Wembanyama · SAS") · **prop BIGGER** ("UNDER 2.5 Threes").
- The **per-player number** ("under in 11 of 16 · 69%").
- The tier badge = **displayTier** ("WORTH A LOOK", or the earned tier when it returns).
- The two numbers **LABELED**: "**79% model confidence**" + "**+13.8% edge vs market**" (not bare 79% / 13.8%).
- **Detail stats move to the popup** — STARTER / 33 min / opp-lineup K% / L5 line / park / weather come OFF the face.

**Card POPUP (the detail, full-width):**
- **Full card-width** (not the current ~320px narrow box).
- Identity + prop + the per-player number + **the honest tier line** (under-review note when capped) + the labeled %s + odds/book + **all the detail stats** (the signalsTable + reasoning) + line-shop book options.

**Cold-start:** a "**⟳ refreshing price**" tick on the card when the background `/state` lands (so a just-painted card with a stale odds shows it's updating). Ties into the Wave-1 fast-first-paint.

---

## Decision asked of the operator (STOP — no build yet)

Approve the design: (a) cap consistency everywhere (pill+border+conf+popup on displayTier, popup under-review note), (b) per-player won-X% with the "X of Y games" wording + the n<10 "not enough games yet" fallback, (c) the decluttered face + full-width popup + labeled %s + refreshing-price tick. The visual mock (rendered in chat) shows Wemby vs Vassell (different numbers) + a capped Langeliers reading worth-a-look/under-review + the full-width popup. On nod → PHASE 1 build, display-only (picks/edges/scoring byte-identical).
