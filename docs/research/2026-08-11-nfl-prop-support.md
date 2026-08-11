# NFL Prop Support — Research Pass for the Sept 2026 Season Start

**Date:** 2026-08-11 · **Author:** Claude-C (research, Fable 5) · **For:** CA triage → CB wiring (operator GO 8/11; season ~Sep 3; paper-first from Week 1, same gates as MLB — no code in this pass).
**Extends:** 07-16 ingestion audit §2 (nflverse spine, injury-source gap) · 07-29 outside-in (market-implied priors) · 06-15 menus. **Tags:** [REPO]/[AUTH]/[PRAC]/[PRIOR]; grades REAL/SPECULATIVE/FANTASY. Current-season (2026) framing throughout.

---

## 1. Prop family viability — ranked for OUR pipeline and books

Vendor keys confirmed for all families below, base + alternates [PRIOR: 07-16 §6, the-odds-api markets list]. Book depth: DK/FD/MGM run the deepest NFL prop boards (MGM is an official NFL betting partner); Fanatics/Hard Rock/BetRivers thinner — expect the MLB pattern (DK+FD ≈ most of the slate) to repeat [PRAC: [SBR prop-sites review](https://www.sportsbookreview.com/best-sportsbooks/nfl-prop-betting-sites/), [FOX](https://www.foxsports.com/stories/betting/best-prop-betting-sites); REPO: coverage-audit precedent].

| Rank | Family (vendor key) | Grade | Why |
|---|---|---|---|
| 1 | **Receptions** (`player_receptions`) | **REAL** | Count stat → NegBinom/G2 machinery fits AS-IS; driven by target share (free weekly data); deep boards; the cleanest MLB-analog family |
| 2 | **Receiving yards** (`player_reception_yds`) | **REAL** (model note) | Deep boards, alt ladders rich; CONTINUOUS stat → needs a new curve shape (§4), not a new pipeline |
| 3 | **Rushing yards** (`player_rush_yds`) | **REAL** (model note) | Same continuous note; RB role concentration is measurable weekly; high game-script sensitivity — archetype-tag it |
| 4 | **Passing yards/TDs** (`player_pass_yds`, `player_pass_tds`) | REAL-capture / **SPECULATIVE-edge** | Deepest liquidity BUT the most-attended prop family — QB props are where the market is sharpest; capture + grade before trusting |
| 5 | **Anytime TD** (`player_anytime_td`) | **SPECULATIVE** | Low-rate Yes/No = our HR-prop analog including the trap: name-premium public market, favorite-longshot bias [PRIOR: 06-29 decision rule applies verbatim] |
| 6 | Pass attempts/completions, rush attempts | SPECULATIVE | Role signal is clean but boards thin at several of our books; capture cheap, expectations low |
| 7 | Kicker/defense/solo-tackle props | **FANTASY** | Thin, low-limit, micro-market exclusion class [PRIOR: exclusion doctrine] |

**Week-1 capture set recommendation:** ranks 1–5 base + alternates for 1–3 (8 base keys + 3 alt keys); ranks 6–7 not captured v1.

---

## 2. Free data backbone per family (sources, cadence, reliability)

- **Role/usage spine — nflverse (free, canonical):** play-by-play (targets/carries/air yards per game), **snap counts updating 0/6/12/18 UTC in-season**, depth charts daily 7AM UTC, multi-season history for priors [AUTH: [nflverse schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)]. Powers receptions/yards families directly. Reliability: community-canonical, used by the entire analytics ecosystem.
- **Matchup/charting — FTN via nflverse (free, UPGRADE vs my July audit):** manually-charted play data 2022+, charted within ~48h of each game, updates 4×/day in season [AUTH: [load_ftn_charting](https://nflreadr.nflverse.com/reference/load_ftn_charting.html)]. This is a free, structured matchup layer (personnel, coverage-adjacent charting) I under-graded on 07-16 — REAL as an enrichment input, SPECULATIVE as edge (public).
- **Participation:** back via FTN but **end-of-season only — useless in-season** [AUTH: nflreadr changelog]. Snap counts remain the in-season role truth.
- **Injuries — the known hole, CONFIRMED STILL DEAD (re-checked this pass):** nflreadr 1.5.1 (May 2026) still lists no 2025+ injury data, no ETA [AUTH: [CRAN manual](https://cran.r-project.org/web/packages/nflreadr/nflreadr.pdf)]. Decision stands as scoped [PRIOR: 07-16]: ESPN-unofficial feed (fragile, gray-tolerated) + Bluesky beat-list + the SCHEDULED Wed/Thu practice + Fri designation ritual as the operator-glance layer. NFL's structured injury cascade makes the manual layer far cheaper than MLB's scratch chaos.
- **Weather:** Open-Meteo (have) — wind is the passing/kicking lever; forecast reliable by Fri for Sunday slates.
- **Officials/crews, schedule spots (bye, TNF short week, travel):** free, computable [PRIOR: 07-16 grades unchanged — SPECULATIVE, test-before-trust].

---

## 3. NFL market structure vs MLB — what actually changes

1. **Weekly, not daily.** One main slate + TNF/MNF. Props for TNF post ~Wed; Sun/Mon props fill in late Thu/early Fri — later than sides, because props are news-reactive [PRAC: [idsca](https://idsca.com/when-do-player-props-come-out-in-nfl/), [ETR props FAQ](https://establishtherun.com/etr-in-season-nfl-props-faq/)]. Scheduler pattern: Wed–Sun windows, not hourly-all-day. Quota burn DROPS vs MLB (§5).
2. **Mainlines sharpest on earth; props soft + low-limit + early-window exploitable.** Practitioner consensus: books post props early knowing they're soft, at low limits; sharps hit the early window then wait for the market to catch up [PRAC: ETR, [Stealing Lines](https://stealinglines.substack.com/p/best-week-1-player-props)]. **The NFL analog of our MLB morning window is Thu/Fri morning** — the trueOpen pattern transfers with a different clock [REPO: captureMlbTrueOpen precedent].
3. **The injury cascade is SCHEDULED** (Wed/Thu practice participation → Fri designations) — a structured re-price rhythm, unlike MLB scratch chaos. Capture passes should bracket it: Thu-morning open, post-designation Fri/Sat, T-60 pre-kick close.
4. **Tiny n.** 17 games/team (~272 total vs MLB's 2,430). Per-player in-season samples are minuscule; usage is week-to-week volatile. Consequences: (a) market-implied priors are not optional — they're the shrinkage anchor [PRIOR: 07-29 §1.1]; (b) archetype pooling must be more aggressive than MLB; (c) the record accrues slowly — paper Week 1 gates will decide on fewer bets than MLB's did; say so on every surface (small-sample honesty is already house style [REPO: Daily 3]).

---

## 4. Transfers as-is vs NFL-specific cognition

**Transfers untouched:** vig-strip, topology, allowlist, line-shop, CLV spine + close-capture, trueOpen pattern (new clock), calibration framework + era rule, archetype tagging, Daily 3 lock machinery, deep-link/ladder capture patterns (same vendor, NFL keys), honest empty-board comms. This is most of the machine [REPO].

**NFL-specific cognition (the real build list for CB, post-triage):**
1. **Continuous-stat family curves** — yards are not counts; NegBinom doesn't fit. Need a right-skewed continuous family (log-normal/gamma-class) for yardage curves with the market-prior shrinkage baked in. THE one genuinely new modeling piece. [REAL, medium]
2. **Role-volatility layer** — week-over-week snap/target-share deltas from nflverse as a first-class input + archetype (Role-Consistent vs Volatile transfers naturally). [REAL, small-medium]
3. **QB-dependency web** — one QB status change re-prices every pass-catcher prop on the team; SCR surface must propagate team-wide, not player-wide. [REAL, small]
4. **Game-script/garbage-time sensitivity** — rushing volume vs trailing script; tag not model v1. [SPECULATIVE as signal, cheap as tag]
5. **Rest/schedule flags** — bye, TNF short week; flags only until our own graded data says more. [SPECULATIVE]

---

## 5. Odds-API cost estimate (operator pays ~$60/mo = 100k credits; ladder_quota.json ledger verifies)

Formula [AUTH, PRIOR: 07-16]: cost = markets × region-units per event call; our 6-book CSV = 1 region-unit.

Assumptions: ~16 games/week · 8 base keys · 3 alt keys on 3 passes · capture windows Wed(TNF) + Thu–Sun 3×/day ≈ 13 passes/week.

- Base: 8 × 16 × 13 ≈ **1,660/wk**
- Alternates (3-pass): 3 × 16 × 3 ≈ **145/wk**
- Events/scores/overhead ≈ +200/wk
- **Total ≈ ~2,000/wk ≈ 8–9k credits/mo** — comfortably inside the plan next to MLB's ~35k pace, and MLB's burn falls away after October. No plan upgrade for NFL alone; the ledger measures, Nov re-price stands [PRIOR: 07-16 Phase D].

---

## 6. Verdict for CA

NFL props are viable on our pipes with ONE new modeling piece (continuous yardage curves) and one settled-by-reality operational answer (injuries: ESPN-unofficial + Bluesky + the scheduled Wed–Fri ritual). Receptions is the beachhead family (count stat, existing machinery). The exploit thesis transfers: early-window props (Thu/Fri) at low limits, CLV-stamped, market-prior-shrunk, paper-first from Week 1 with the same gates. The season calendar does the sequencing: capture + paper September, gate readouts October, real stakes only when the gates say so — no launch-week hero picks [PRIOR: 07-16 Phase B, verbatim].

---

## Sources

[nflverse data schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html) · [load_ftn_charting](https://nflreadr.nflverse.com/reference/load_ftn_charting.html) · [nflreadr 1.5.1 CRAN manual (injury feed still dead, May 2026)](https://cran.r-project.org/web/packages/nflreadr/nflreadr.pdf) · [nflreadr changelog (participation end-of-season only)](https://nflreadr.nflverse.com/news/index.html) [AUTH] · [ETR in-season props FAQ (early-window softness)](https://establishtherun.com/etr-in-season-nfl-props-faq/) · [idsca — when props post](https://idsca.com/when-do-player-props-come-out-in-nfl/) · [Stealing Lines — Week 1 props](https://stealinglines.substack.com/p/best-week-1-player-props) · [SBR prop sites](https://www.sportsbookreview.com/best-sportsbooks/nfl-prop-betting-sites/) · [FOX prop sites](https://www.foxsports.com/stories/betting/best-prop-betting-sites) [PRAC] · Repo/prior: 07-16 ingestion audit · 07-29 outside-in · 06-29 decision rule · the-odds-api markets list [AUTH] · ladder_quota.json [REPO].
