# P1 Design — Render Engine Slips + liveStateSummary

**Phase:** FE-Trust-Surface-1A → P1 (the top-ranked build from synthesis.md).
**Date:** 2026-06-07. **Status:** DESIGN — read-only research complete; **no code until operator approves the decisions below.**
**Why P1 first:** every backend phase this session (calibration line-aware, signal-fill, Phase 1b live-state) lands on the engine slip object, which the bettor cannot see today. P1 makes that work visible. It also completes Phase 1b: the gate runs on the wire but renders nowhere.

---

## BUILD-STEP-0 — pre-edit verification (the bug, captured at /m)

Confirmed live via Chrome at edge.motel666.com/m/:
- Nav tabs = `[top, mybets, games, analyze, grades]` — **no slips/parlays tab**.
- `/api/ws/state?sport=mlb` payload = **14 slips**; `slip[0].narrative` present ("2 legs across 2 different games, Built around stable archetypes and short ladders"); `slip[0].liveStateSummary` present.
- DOM does **not** contain the narrative text and **no** live-state marker anywhere (`dom_showsNarrative:false`, `dom_showsLiveStateWord:false`).
- Source grep: `frontend/mobile/index.html` has **zero** `aiSlips` and **zero** `liveStateSummary` references.

POST-edit, the same probe must flip: a SLIPS surface renders the slips, the narrative text appears in the DOM, and the liveStateSummary status is visibly displayed. **Gate-must-act-at-render**: the test is not "a component renders" but "the bettor can SEE Phase 1b's protection + decide from per-leg reasoning."

---

## Render-path findings (how the FE is built — informs a flexible, refactor-safe build)

- **Single `.html` file**, vanilla JS, no framework. State is a closure object (`let state` @776): `state.data = { mlb, nba }`, each holding a full `/api/ws/state` response **including `.aiSlips`**.
- **Render cycle:** `render()` (@1406) reads `state.activeSport`, then routes to a per-tab `render{Tab}(main)` that sets `main.innerHTML = loading`, (optionally fetches its endpoint), builds an HTML string, and assigns `main.innerHTML`. Cross-sport tabs (top, games) ignore `activeSport` and pull both sports.
- **Boot:** `refresh()` (@4072) does `await Promise.all([fetchSport("mlb"), fetchSport("nba")])` then `render()`. So **`aiSlips` for both sports is already in `state.data` after boot — no new endpoint needed** for a SLIPS tab.
- **Nav:** 5 static `<button class="tab" data-sport="…">` (@685-689). Adding a tab = one button + one `if (sport==="slips")` route + one `renderSlips(main)`. Matches the existing pattern exactly.
- **Proven card shells to extend (do not reinvent):**
  - `renderMyBets` (@3032-3057) — the **parlay card** template: `#141828` card, `border-left:3px solid {statusColor}`, header chip + status (right), `$stake @ odds → toWin`, per-leg rows (`player · famNice(side) line` + per-leg status float-right). **This is the exact shell to extend for engine slips.**
  - `renderGamesBrowser` (@3105-3128) — the **expand/collapse** pattern (`onclick toggle .open` + chevron) for the card's expandable detail.
  - `renderTopPicks` (@2977-2985) — **tier grouping** pattern (group by tier, colored section header).
  - helpers available: `escapeHtml`, `_famNice`, `_sideNice`, `_oddsNice`, `_tierColor`, `_tierNice`, `isPreferredBook`.

---

## aiSlips field inventory — render decision per field

Per slip (each lives under `aiSlips.{safe,balanced,aggressive,lotto}[]`):

| Field | P1 treatment |
|---|---|
| `narrative` (plain-English lines) | **HERO** — the card's "why" block, top of card |
| `liveStateSummary {worst,deadCount,softCount,reasons}` | **HERO STATUS BADGE** — green/amber/red (see visual treatment) |
| `tier` (safe/balanced/aggressive/lotto) | **section grouping** + readable label |
| `legs[].player / propType / side / line / odds` | **leg rows** (always shown) |
| `legs[].liveState {status,reason}` | **per-leg status icon + reason** on soft legs |
| `legs[].legReasonings` / slip `legReasonings[]` | **expandable** — per-leg one-line rationale |
| `calibratedCombinedModelProb` | **shown** (calibrated, not raw) next to combined odds |
| `combinedAmericanOdds` / `ev` | **shown** (odds in header; EV in detail) |
| `factors {projection,clv,timing,book,archetype,ladder,diversification}` | **expandable** — small factor bar |
| `correlationScore` | **expandable** (detail) |
| `alternativeBooks` | **expandable** line-shop; **narrow to 4 preferred for display** |
| `rawCombinedModelProb`, `oe11ReinforcementBoost`, `compositeScore` | **hide** in P1 (internal) |

Hierarchy: **hero (narrative + status) → legs (player/market/odds + live-state icon) → tap to expand (per-leg reasoning, factors, line-shop, calibrated prob, EV)**. Minimum card = hero + legs; everything else behind an expand.

---

## Decisions — APPROVED 2026-06-07

Operator approved: **D1 = new "SLIPS" tab** · **D2 = read from `state.data` (no new endpoint)** · **D6 = keep Safe/Balanced/Aggressive/Lotto labels** · **D5/CTA = open-book + copy-legs (honest, free)** — chosen after the deeplink-feasibility finding below.

**Deeplink feasibility finding (verified before approval):** there is no free/public way to pre-load a specific parlay into a sportsbook betslip. The books don't expose a constructable "open with these legs" URL; FanDuel "share a bet" links populate a slip but are minted inside FanDuel by a sharing user; true cross-book prefill requires a paid commercial integration (MetaBet ExpressLinks / Pikkit-style partnerships). So P1's CTA = an honestly-labeled **"Open [BestBook] ↗"** button (universal link → app if installed, else website; NOT pre-filled) **+ "Copy legs"** (clipboard) for fast manual entry. We will never label it in a way that implies it places the bet. (Sources: DraftKings/FanDuel help + MetaBet/Pikkit product pages — see session notes.)

### Original options (for the record)

**D1 — IA placement (RECOMMEND: new tab "SLIPS").**
- *New tab* (recommended): cleanest separation, matches the existing add-a-tab pattern, zero risk to TOP PICKS. Cost: 6th tab on a 380px-wide nav (may need slightly tighter tab labels). Engine parlays are a distinct concept from single picks — they deserve their own home.
- *Section on TOP PICKS*: middle ground; risks conflating single picks and parlays, and TOP PICKS is the cold-start-sensitive landing tab.
- *Extend TOP PICKS list*: rejected — conflates concepts.
- Label options: "SLIPS" (shortest, fits nav) / "PARLAYS" / "AI SLIPS". Recommend **"SLIPS"**.

**D2 — Data source (RECOMMEND: read from `state.data`, no new endpoint).** `aiSlips` is already in the boot payload. `renderSlips` reads `state.data.mlb?.aiSlips` + `state.data.nba?.aiSlips`. No backend change. (Alternative: a dedicated `/api/ws/slips` endpoint — defer; unnecessary for P1.)

**D3 — Card layout (RECOMMEND: extend the `renderMyBets` shell).** Same card chrome; hero = narrative + status badge; combined odds + calibrated combined prob; leg rows; expandable detail. Reuses proven, mobile-tested styling.

**D4 — liveStateSummary visual treatment (per Phase 1b decisions):**
- `worst:"ok"` → quiet **green** "✓ lineups clear" chip.
- `worst:"soft"` → **amber** "⚠ N leg(s) flagged" + each soft leg shows its `reason` ("questionable per injury report").
- dead legs are **excluded upstream** (Phase 1b pre-filter) → not shown as legs; surface `summary.reasons` as a **note**: "1 leg removed — scratched/OUT" so the bettor SEES the engine protected them. (No red "dead leg in slip" because there never is one — the protection is the exclusion.)

**D5 — CTA (RECOMMEND: display-only for P1).** No place-at-book deeplink, no copy-to-clipboard yet — minimum card. Flag deeplink/copy for a later phase.

**D6 — Tier labels (RECOMMEND: keep the existing 4 tiers with readable labels** — Safe / Balanced / Aggressive / Lotto). Do **not** remap to Core/Strong/Lotto in P1 (that canonicalization is its own decision; remapping risks misrepresenting the engine's actual tiering). Flag the Core/Strong/Lotto alignment for later.

**D7 — Lotto-vision room (leave structure, build nothing).** Per [[product-ladder-direction]]: reserve a per-leg "ladder rung" slot and a slip-level "archetype tag" slot in the card markup (rendered empty/hidden in P1) so the ladder + archetype + Law-30 four-question phases can populate them without restructuring. Per [[product-fe-overhaul-pending]]: keep `renderSlips` self-contained and data-driven so the eventual FE-overhaul can restyle it without rewiring.

---

## Build plan (after approval) + POST-edit verification

1. Add `SLIPS` tab button (@~688) + `if (sport==="slips") { renderSlips(main); return; }` route (@~1450) + `renderSlips(main)` (new fn, near renderMyBets).
2. `renderSlips` reads `aiSlips` from `state.data.{mlb,nba}`, groups by tier, renders the card per D3-D6.
3. **POST-edit verification (gate-must-act-at-render, binding):** via Chrome at /m — (a) SLIPS tab present; (b) slip cards render with narrative + leg rows + calibrated prob; (c) `liveStateSummary` status visibly displayed (green/amber); (d) re-run the BUILD-STEP-0 DOM probe — `dom_showsNarrative` flips to **true**; (e) inject a synthetic soft/scratch leg (as in Phase 1b) and confirm the bettor SEES the amber flag / "leg removed" note. Plus: `node --check` on the file (HTML-JS extract method per memory), `runtime:verify` 13/13 unaffected (FE-only change), sibling surfaces unchanged.
4. Same-turn separate commits (code; docs). No backend reload needed (FE static file) — operator hard-refreshes /m.

---

## Trade-offs flagged

- A 6th tab tightens the mobile nav — acceptable; the FE-overhaul will revisit nav IA anyway.
- P1 is the **minimum** trust card by design (operator constraint: don't pile on; FE-overhaul is the big redesign). Ladder rungs, archetype tags, and the full four-question reasoning are explicitly deferred — P1 leaves room for them.
- `renderSlips` reading `state.data` means a SLIPS tab inherits the same state-fetch dependency as other tabs (fine — it's not the landing tab, so the cold-start gate doesn't apply).

*No code written. Awaiting operator approval on D1-D7 before build.*
