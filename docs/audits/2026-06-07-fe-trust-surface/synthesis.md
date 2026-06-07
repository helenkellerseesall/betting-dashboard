# FE-Trust-Surface-1A — Synthesis

**Date:** 2026-06-07
**Method:** read-only Chrome walk of the live bettor FE (edge.motel666.com/m/) + payload probes (`/api/ws/state`, `/api/ws/top-picks`) + `frontend/mobile/index.html` source confirmation.
**Scope:** turn backend honesty into verifiable, bettor-facing trust. What does the operator actually *see*, and where does the gap between "the engine knows it" and "the bettor sees it" live?
**Per-chunk evidence:** `.scratch/probe_fe_trust_01_walkthrough.txt` (structure/GRADES), `_02_mybets_analyze.txt`, `_03_games_toppicks.txt`, `_04_data_map.txt`.

---

## TL;DR — the trust problem is a RENDER problem, not a data problem

The backend already computes nearly every trust signal the operator wants: model probability, edge, calibrated history ("won X% of N similar"), CLV, grades, per-leg reasoning, a plain-English slip narrative, a scored factor breakdown, and — as of Phase 1b — live-state protection. The failure is in the FE: it renders a fraction of what exists, **buries the strongest surface (GAMES)** behind a broken landing tab, **leaves the engine's richest output (the AI-built slips) completely unrendered**, blocks the landing screen behind the two heaviest fetches in the app, and frames a few honest metrics in ways that read as "broken."

Fixing trust here is mostly **surfacing what already exists, well** — not building new cognition. That makes this a high-leverage, low-risk phase.

---

## The five tabs, as they actually are (corrections to chunk 1 included)

- **TOP PICKS** (landing). Works when warm: 37 tiered picks (ELITE/STRONG/PLAYABLE) with an excellent honesty banner ("Calibration dampener removed 45 picks → negative edge after dampening. See GAMES for unfiltered view."). The chunk-1 "perma-load" is a **cold-start render gate**, root cause confirmed below — not permanent.
- **MY BETS.** *Not* empty (chunk-1 "0" superseded — badge now "2"). Shows 2 real placed parlays with per-leg grading, $10 staked / −100% ROI. Three issues: no in-app way to log a bet (CLI `addPlacedBet.js` only), bare small-sample ROI, and dev-language provenance ("FIFO prune wiped original…") leaking to the bettor.
- **GAMES.** The **strongest surface in the app** and the clearest expression of the product vision: battlefield breadth → game → player → prop → detail popup, with model %, edge %, calibrated history, odds, book, curation star, line-shopping, and partial reasoning. It is buried as tab 3.
- **ANALYZE.** An *inbound* slip analyzer (score a slip you saw on X/Discord) + screenshot OCR + a taste profile (observability-only, honestly labeled). It is **not** the engine explaining its own picks. OCR copy contradicts itself ("coming next session" vs "Claude Vision OCR active").
- **GRADES.** Rich data, poor IA: a flat hundreds-row scroll; NBA CLV 0% stamped; bare HIT% (9% MLB / 23% NBA) that reads as "broken" without EV/vs-implied context.

---

## Data-availability map — on the wire vs rendered

| Trust signal | On the wire | Rendered to bettor |
|---|---|---|
| model prob, edge, odds, line, tier, volatility | yes | yes (GAMES, TOP PICKS) |
| calibrated history "won X% of N similar" | yes | yes (GAMES, TOP PICKS) |
| CLV / closingOdds | yes (null pre-close) | partial (GRADES stamped; MY BETS) |
| grade / result | yes | yes (GRADES, MY BETS) |
| NBA reasoning bundle (headline, role tags, signalsTable) | yes (NBA only) | yes (GAMES) |
| MLB reasoning | **only `contextualTags`** | tags only — **asymmetry vs NBA** |
| **slip `narrative`** (plain-English) | yes | **no** |
| **slip `legReasonings`** (per-leg) | yes | **no** |
| slip `factors` (projection/clv/timing/book/archetype/ladder/diversification) | yes | **no** |
| slip calibrated combined prob, EV, correlation | yes | **no** |
| **`liveStateSummary` / `leg.liveState`** (Phase 1b) | yes (confirmed live) | **no** |
| labeled archetype (Stable/Volatile/Public-Bait/…) | partial (volatility + a score) | **no** |

The right column is the whole job.

---

## The biggest single finding: the engine's slips are invisible

`grep` of `frontend/mobile/index.html` returns **zero** matches for `aiSlips` and **zero** for `liveStateSummary`. The visible nav has five tabs and **no parlay tab** (a legacy `renderParlay` exists but has no button, and it renders the *user's* hand-built parlay, not the engine's).

So the engine's most sophisticated output — AI-built slips carrying a plain-English `narrative`, per-leg `legReasonings`, a scored `factors` breakdown, calibrated combined probability, correlation, EV, line-shopping, and now the Phase 1b `liveStateSummary` protection — is generated every cycle, serialized into `/api/ws/state.aiSlips`, and **shown nowhere**. Two consequences:

1. **Phase 1b's protection is real on the wire but currently invisible** — the gate excludes dead legs and tags soft ones, but the bettor has no surface that renders it. The FE-render is the missing half of that work.
2. **The lotto-parlay vision is already built in the backend.** Per [[product-ladder-direction]], the endgame is per-player per-prop ladders feeding engineered milestone parlays. The slips already carry asymmetric-payoff narrative and a `factors.ladder` score — the structure exists; it just isn't surfaced.

---

## Recommendations — with visual + IA, grouped

### A. Surface the engine's slips (highest trust impact)
Add a visible **SLIPS** (or "BUILT FOR YOU") tab, or a slips section atop TOP PICKS, that renders `aiSlips`. Each slip card:
- **Header:** tier chip (Core/Strong/Lotto) + combined odds + calibrated combined probability (not raw) + EV.
- **Legs:** each leg with its `legReasonings.reason` as a one-line plain-English rationale, plus a per-leg live-state chip (see B).
- **Narrative:** render the `narrative` lines as the slip's "why" block — this is already the operator's "based on X, Y, Z."
- **Factors:** a small horizontal factor bar (projection/timing/book/correlation) for the bettor who wants the breakdown; collapsible.
- **Line-shop:** "best book" + alternatives (narrow to the 4 preferred for display; backend keeps all).

### B. Make the Phase 1b protection visible (`liveStateSummary` render)
- **Slip-level badge:** when `liveStateStatus==="ok"` show a quiet green "lineups clear" check; when `"soft"` show an amber "1 leg flagged" chip; dead legs are already excluded upstream, so surface "1 leg removed (scratched/OUT)" from `summary.reasons` so the bettor sees the engine *protected* them.
- **Per-leg chip:** render `leg.liveState.reason` inline on soft legs ("questionable per injury report"). This is the visible proof that the protection works — directly serves the FE-trust goal.

### C. Metric-framing fixes (first-class — these actively erode trust today)
- **HIT% needs a frame.** A bare "HIT 9%" on a longshot-heavy denominator reads as broken. Show **hit-rate vs implied** (are we beating the price?), **by odds tier** (favorites vs longshots separately), and **graded-only** labeling. The honest headline isn't "9%," it's "+X% vs market on graded picks."
- **ROI small-sample.** MY BETS "−100% · 0W 2L" and any n<~20 should be suppressed or explicitly tagged "small sample (n=2) — not yet meaningful."
- **NBA CLV 0% stamped.** Either fix NBA CLV capture or label the card "NBA CLV capture pending" so 0% doesn't read as "we lose every line." (Ties to the existing three-state CLV card work.)
- **The ⭐ on negative-edge picks.** A starred "Assists OVER 6.5 · edge −20.8%" is contradictory. Define what ⭐ means, and for negative-edge props show the **side the engine actually backs** (the fade), not a starred losing side.
- **Small-N calibration.** "won 18% of 50" and "won 19% of 2215" should not look equally trustworthy — show an N-confidence cue (de-emphasize low-N).

### D. Cold-start landing fix (TOP PICKS perma-load)
Root cause (confirmed in source): boot does `await Promise.all([fetchSport("mlb"), fetchSport("nba")])` (~835KB) **then** `render()` routes to `renderTopPicks`, which uses a *separate, lightweight* `/api/ws/top-picks` endpoint it doesn't need the state for. The landing tab is needlessly gated on the two heaviest fetches.
- **Fix:** call `renderTopPicks()` at boot independent of the state `Promise.all`; add a real skeleton + a timeout fallback ("big slate — still loading / retry"); consider lazy-fetching the non-active sport. Low risk, high first-impression impact.

### E. MLB reasoning asymmetry
NBA picks carry a rich `displayBundle` (headline, role tags, signalsTable) and render it; MLB picks carry only `contextualTags` and fall to legacy fields. MLB bettors see materially less "why." Build an MLB `displayBundle` (role/lineup-spot/park/weather/matchup are already in the candidate) so both sports reason equally.

### F. IA restructure
- **Elevate GAMES** — it's the best surface; it shouldn't be tab 3 behind a broken landing.
- **GRADES grouping** — replace the flat 500-row scroll with grouping by sport / odds-tier / status, and lead with the beat-the-market headline, not the raw list.
- **MY BETS** — split open vs settled; add an in-app (or screenshot-confirmed) log-a-bet path so real-money ROI tracking is actually usable; hide dev-language provenance behind a detail toggle.

---

## Connection to the lotto-parlay / ladder vision

Per [[product-ladder-direction]] and [[betting-dashboard-product-doctrine]] ("battlefield breadth → curated edge → AI compression → sportsbook-native execution"), the slips surface (rec A) is where the vision lands: the engine already builds multi-leg slips with asymmetric-payoff narrative and a ladder factor. The natural follow-on once slips are visible is per-rung ladders (probability at each milestone) + labeled archetype tags (Stable/Volatile/Public-Bait/…) + the Law-30 four-question rendered per leg. This audit's rec A is the prerequisite UI for that roadmap.

---

## Ranked build phasing (max operator-trust impact first)

1. **P1 — Render the engine slips + `liveStateSummary` (recs A + B).** Unlocks the engine's best reasoning *and* makes Phase 1b's protection visible. One surface, two wins. Highest trust impact.
2. **P2 — Metric-framing fixes (rec C).** Stop the active distrust: HIT% context, ROI small-sample, NBA CLV honesty, ⭐ semantics. Cheap, high-trust.
3. **P3 — Cold-start landing fix (rec D).** First impression; small, low-risk.
4. **P4 — MLB reasoning bundle (rec E).** Closes the MLB/NBA asymmetry.
5. **P5 — IA restructure (rec F).** Elevate GAMES, group GRADES, MY BETS open/settled + log-a-bet.
6. **P6 (vision) — ladders + archetype tags + four-question per leg.** Builds on P1.

Each build phase keeps the project discipline: empirical pre-check + consumer-sweep before code, verify at the bettor fetch (the binding rule from Phase 1b), no fabricated trust signals, common traps per [[project-pick-origin-architecture]].

---

*Audit complete. No code changed. Recommendations are for operator prioritization; each becomes its own show-before-edit build phase.*
