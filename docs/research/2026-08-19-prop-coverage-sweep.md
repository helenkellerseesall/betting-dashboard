# PROP-COVERAGE SWEEP — Every Market the Books Post vs Everything We Price

**Date:** 2026-08-19 · **Author:** Claude-C (research, Fable 5) · **Lane:** L9 of `docs/OPERATOR_ROADMAP_2026-08-19.md` — "the machine does the combing." **Output feeds:** the L4 GAME PAGES build list.
**Method:** the vendor's own market catalog [AUTH: [The Odds API markets list](https://the-odds-api.com/sports-odds-data/betting-markets.html)] diffed against what our fetchers actually request tonight [REPO: `buildMlbBootstrapSnapshot.js`, `captureMlbLadders.js`, `captureMlbTrueOpen.js`, `fetchNbaOddsSnapshot.js`, `captureNflProps`]. **Tags/grades** as always. **One caveat up front:** the catalog says what the vendor *can* return; **which markets our six books actually post per slate is an empirical question** — the sweep ends with a one-call probe that turns this list into measured coverage (the same pattern that settled the deep-link question).

---

## 1. MLB — catalog vs us

**Vendor offers 21 base player-prop keys + 17 alternates, plus game-period markets (F5/first-inning/first-3/first-7 moneyline, spreads, totals, team totals) [AUTH].**

**WE CURRENTLY PRICE (8 board families):** hits · total bases · home runs · RBIs · runs scored · strikeouts · outs · walks *(+ earned runs, hits allowed captured for trueOpen)*; ladders captured for 6 of them [REPO: LADDER_MARKETS]; h2h/spreads/totals captured at game level; `batter_first_home_run` fetched as a targeted extra call [REPO: :999-1004]. **Two families are currently BROKEN-contained (rbis, outs)** — shown-gated, still accruing evidence [REPO: be31c40].

| Gap | Operator interest | Modelability | Verdict |
|---|---|---|---|
| **`batter_first_home_run`** (first HR of the game) | **HIGH — named** | **REAL-adjacent:** we already model per-batter HR probability; first-HR needs an ordering layer (who homers *first*), structurally the same problem the NBA first-basket engine solves [REPO] — and that engine exists as a template | **TOP GAP.** Already fetched; not modeled. |
| **`batter_stolen_bases`** | **HIGH — named** | **SPECULATIVE:** attempt rate is highly situational (catcher arm, pitcher hold, game state, manager). Free data exists (StatsAPI); low n per player | Capture + shadow; don't promise a curve |
| **K ladders (`pitcher_strikeouts_alternate`)** | **HIGH — named** | **REAL — already captured**, and the ladder scan exists | Not a data gap — a **surfacing** gap (this is the "6+ Ks but not 7" rung picker from L4) |
| **F5 / innings markets** (`h2h_1st_5_innings`, `totals_1st_5_innings`, `alternate_totals_1st_5_innings`, 1st-inning variants) | **HIGH — named** | **REAL:** mechanically derived from main lines [PRIOR: 07-05 §2, Voulgaris precedent 07-29] and driven by the pitcher families we model best | **STRONG #2** — the documented-pro derivative play |
| **Game winner / moneyline** | **HIGH — named ("predicted winner")** | **REAL to display, SPECULATIVE to beat:** we capture h2h already; game markets are the sharpest on the board. Honest play: show our read + the market's, never claim edge without a record | GAME PAGES header; label honestly |
| `batter_singles/doubles/triples`, `batter_walks`, `batter_strikeouts` (batter Ks) | MED | REAL — same count machinery, thin books | Cheap adds after the top gaps |
| `batter_hits_runs_rbis` (H+R+RBI combo) | MED | REAL-ish — combo of three modeled families, but correlation matters (G3 territory) | After G3 |
| `pitcher_record_a_win` | LOW | SPECULATIVE — depends on bullpen + run support, not pitcher skill alone | Skip v1 |
| `batter_fantasy_score` (DFS only) | LOW | — | Skip |

## 2. NBA — catalog vs us

**Vendor offers 24 base + 12 alternate NBA keys [AUTH].** **We already request:** points, rebounds, assists, threes (+alt), PRA/P+R/P+A/R+A (+alts), first basket, first team basket, double-double, triple-double, steals/blocks/turnovers (separate call), h2h/spreads/totals [REPO].
**Coverage verdict: NBA capture is nearly complete against the catalog.** Genuine remaining gaps: `player_points_q1` / `player_rebounds_q1` / `player_assists_q1` (quarter props), `player_field_goals`, `player_frees_made/attempts`, `player_method_of_first_basket`. **All LOW interest, LOW-to-MED modelability** — quarter props are thin/low-limit micro-markets (exclusion class [PRIOR]). **The NBA work is modeling and surfacing, not capture.** [→ see the NBA day-one doc]

## 3. NFL — catalog vs us

Vendor: 33 base + 26 alternate NFL keys [AUTH]. We capture **six base keys** (attempts excluded per CA) [REPO: 7654119]. Gaps by interest: **anytime TD** (captured? verify in the six) is the marquee public market — HIGH interest, SPECULATIVE edge (HR-analog trap [PRIOR: 08-11 §1]); longest-reception/longest-rush = FANTASY-class variance; kicking points = thin. **Verdict: NFL's list is correctly narrow for a launch season** — don't widen before the yardage curves clear their gate.

## 4. Ranked gap list → the GAME PAGES build order

1. **K ladders surfaced with a rung picker** — REAL, data already in hand, directly the operator's stated want. *Surfacing only.*
2. **F5 / first-5-innings derivatives** — REAL, documented-pro edge shape, rides the pitcher model. *Capture + model.*
3. **First HR (`batter_first_home_run`)** — REAL-adjacent, already fetched, and the NBA first-basket engine is the working template for the ordering layer. *Model.*
4. **Game winner / ML read on the page header** — REAL to display with honest labeling. *Display.*
5. **Stolen bases** — SPECULATIVE; capture and shadow, no promises.
6. Batter singles/doubles/triples/walks/Ks — cheap count-family adds.
7. H+R+RBI combos — after G3 correlation graduates.
8. NBA quarter props / method-of-first-basket — declined (micro-market exclusion class).

**The honesty rule L4 needs (from the roadmap, restated as a build constraint):** every market on a game page either shows **our number with its record**, or says **"no model yet — building."** Gaps 5-8 are exactly the rows that will say "no model yet" on day one, and that is the correct output.

## 5. The probe that turns this into measurement (hand to CB with the sweep)

One pre-game call per sport, `includeLinks`+`includeSids` already proven [PRIOR: 07-06]: request the **full catalog list** for 2 events × our six books → count rows returned **per market key per book**. Output: which keys our books actually post, which return empty, and rung depth for the alternates. That artifact — not this doc — becomes the canonical coverage matrix, and it costs ~1 quota unit per market per event (formula [AUTH]) so it's a one-time ~$0 spend. **Expected finding, stated in advance so it can be wrong:** DK+FD carry nearly everything; Fanatics/BetRivers/Hard Rock carry the majors only; several exotic keys return nothing at all for our books.

---

**Sources:** [The Odds API markets catalog](https://the-odds-api.com/sports-odds-data/betting-markets.html) · [cost formula/FAQ](https://the-odds-api.com/liveapi/guides/v4/) [AUTH] · [REPO] buildMlbBootstrapSnapshot.js (families, first-HR extra call), captureMlbLadders.js (LADDER_MARKETS), captureMlbTrueOpen.js (5 pitcher families), fetchNbaOddsSnapshot.js (3-call market lists), commit 7654119 (NFL six keys), be31c40 (broken-contained families) · [PRIOR] 07-05 §2 derivatives, 07-29 Voulgaris precedent, 08-11 NFL §1, 08-15 fade-tier (longshot discipline), 07-16 §6 ladders · roadmap L4/L9.
