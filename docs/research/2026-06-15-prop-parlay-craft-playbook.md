# Prop-Parlay Craft Playbook — How Knowledgeable Bettors Actually Build Smart Multi-Leg Prop Parlays

*Compiled 2026-06-15 (Claude-A deep-research pass, web-sourced). Companion to `docs/research/2026-06-11-parlay-ladder-playbook.md`.*

## What this is

The operator's product is NOT a rigid math-only O/U engine. It's a tool that plays the way a knowledgeable fan plays — informed multi-leg parlays of **obtainable** props (matchup/role/form-justified, correlation-aware), with cash-out/variance discipline, blending the quant model with the human/qualitative side. This doc is the buildable menu: concrete craft, the actual data sources (mostly free + programmatic), and a prioritized build shortlist on top of the existing shadow stack (calibration, NegBinom ladders, correlation engine, parlay constructor).

## The honest frame (read this first, don't skip it)

Informed leg-selection + matchup intel + correlation awareness + cash-out discipline make the parlay play **smarter and better-managed**. They do **not** manufacture a guaranteed mathematical edge. The market is efficient on the obvious stuff, and our own edge-map found no demonstrable +EV on the current model (−17% singles / −42% parlays in-sample). The genuinely real, durable edges that came back across every research angle are narrow and consistent:

1. **Information *interpretation*, not speed.** Books re-price within ~60 seconds of confirmed news via algorithms. You don't beat them to the tweet. You beat them on (a) resolving ambiguous "questionable" tags before they resolve, (b) context the model misses, and (c) the **usage-redistribution lag** — when a star is scratched, the *secondary* players' props stay stale for 30–90 minutes while the headline number moves instantly. That lag is the single most codifiable news edge found.
2. **Soft-book line-shopping / stale-price detection.** Different books price the same prop and the same SGP correlation differently; take the least-taxed number.
3. **Fading market *overreactions*** to hot streaks and news (the "he's been hot, bet the over" trap is usually the under).
4. **Promos / boosts** (separate path, not covered here).
5. **Variance management** (cash-out, hedging, tiny stakes) — buys certainty, costs EV, but keeps you in the game.

Everything below is in service of those five plus making the play the operator enjoys the best, smartest version of itself. Where a number comes from betting media rather than a rigorous study, it's flagged.

> One more honest note carried from the research: player **props are the documented manipulation surface** (2025-26 wave — NBA unders schemes, MLB pitch-fixing). Insider edge is illegal and off the table. This argues for *more* obtainable/role-floored legs and *less* exotic-longshot exposure, not the reverse.

---

## 1. Leg-selection craft — what separates a sharp parlay from a lottery ticket

The craft is two stages: (1) source each leg as a standalone +EV-or-floor-justified pick, then (2) combine them without handing the book a 15–25% correlation tax.

### Matchup levers that actually move a prop, by sport

**NFL**
- **WR vs a true shadow corner → fade receiving yards.** The signal is *shadow* coverage (the CB travels with the WR all over the field), not a generic "tough matchup" — offenses scheme receivers away from tough coverage, so most WR/CB matchups are noise. Genuine shadows are rare (Surtain-tier) and historically cost the receiver ~4 PPR pts vs his average. Confirm the corner actually travels (FTN shadow matrix) before fading.
- **RB vs a run-funnel defense.** A run-funnel (stout vs pass, leaky vs run, or by schedule-adjusted FPG to RBs) is the rush-yards-over spot; a pass-funnel favors pass-catching backs' receptions, not pure rush yards.
- **QB vs weak secondary** only matters layered with *expected pass volume* (PROE, projected script) — a weak secondary is irrelevant if the QB throws 22 times.

**MLB**
- **Batter vs pitcher handedness (platoon split) is step one.** Platoon gaps are commonly 30–50 OPS points. LH power bat vs RH pitcher is the textbook HR setup. Use the batter's split AND the pitcher's reverse-split — not the tiny-sample head-to-head BvP line.
- **Park × handedness interact.** Short porches boost specific-handed power; hitter parks add roughly +15% to +30% expected HR rate; Coors is the extreme. Use current-season park factors, not multi-year.
- **Weather is a live, under-priced lever.** Wind ≥15 mph blowing out lifts HR/total-base environment; wind in kills carry. Gate on dome/retractable roof state.
- **K props: arsenal vs lineup K-rate.** Pitcher with CSW ≥30% or swinging-strike >12% facing a lineup that whiffs ≥25% by handedness, *and* projected to go deep enough (expected IP). The under-priced factors: pitch-level whiff, opposing lineup K-rate by hand, Stuff+ vs results divergence, expected innings.

**NBA** (off-season now; scaffold for return)
- **Scorer vs weak positional defender / scheme.** Start with defense-vs-position, then ask *why* the weakness exists — switch-heavy man suppresses assists; drop/zone inflates the primary playmaker's assists; bigs vs small/poor-rebounding lineups → rebound overs.
- **Pace-up matchups inflate every counting stat.** ~14-possession swing between two fast vs two slow teams. The Vegas game total is the cleanest pace proxy.

### The gate before any matchup matters: role / usage / minutes / snap-share
Projected minutes/snaps is the single most important variable — a 34-minute role player out-boards a 24-minute star. Usage rate sets opportunity. The biggest *injury* edge isn't the player's own health — it's a **teammate out** redistributing usage, which the book is slow to fully price. MLB analog: confirmed lineup + batting-order slot (PA count) and confirmed starting pitcher.

### Game script / blowout / garbage-time
Script can make or kill a prop independent of talent: NFL favorites blowing teams out → more RB rush volume but the RB may sit late; trailing teams → garbage-time passing (a WR1 over on the *underdog* is often a script play). NBA blowouts are the silent prop-killer (starters sit Q4). Prefer legs whose thesis **survives multiple game scripts**, or use script *as* the edge deliberately.

### "Obtainable" vs longshot
An obtainable leg is **role-justified and structurally floored**, not dependent on a hot night:
- **Opportunity-floored stats over ceiling stats.** Rebounds/assists (opportunity-driven) are far more predictable than points; 3PM and HR are the streakiest, least-stable. For a leg you *need*, take the opportunity stat.
- **Combo (PRA) props create floors** — a 20/8/5 line survives a cold shooting night because reb/ast prop it up; books sometimes under-price that internal correlation.
- **Volume over efficiency** — a 7+ 3PA shooter clears an over on average accuracy.
- **DFS-platform caveat (PrizePicks/Underdog):** lines carry demand-based multipliers (popular picks discounted ~0.85x, unpopular boosted ~1.12x) — verify true EV after the real multiplier; selective beats high-volume.

### The sharp-vs-lottery line
Consensus across sources: **3–4 legs** is the practical ceiling where payout is interesting AND win-rate is still research-sensitive. **Beyond ~4 same-game legs is "lottery-ticket territory" regardless of how strong each leg looks** (a 6-leg "obvious" parlay can be ~3.8% to hit). The tell of a lottery leg: it exists only to juice the payout, not as a bet you'd make straight. *(This is the honest answer to the operator's friend's 5–15-leg parlays: those win occasionally and are great entertainment, but the math says they're variance/lotto, not edge. The product's job is to make the obtainable-leg core as smart as possible and manage the variance — not to pretend 12 legs is an edge.)*

---

## 2. Matchup & qualitative intel AS DATA — the actual sources

The "duh we should track this" menu. Free + programmatic backbone first; paywalled enrichment second.

### Free + programmatic backbone (best ROI — build the spine on these)
- **NBA — `nba_api`** (github.com/swar/nba_api): official NBA.com stats incl. Second Spectrum tracking (`leaguedashptstats`, `leaguedashptdefend`, `boxscorematchupsv3` for true defender-vs-player matchups, `leaguedashlineups`, pace via `leaguedashteamstats` Advanced, minutes via `playergamelogs`). Free, no key (needs browser headers + self-rate-limiting). Derive rest/B2B/travel from `scoreboardv2` schedule + arena coordinates.
- **MLB — Baseball Savant (Statcast)** (baseballsavant.mlb.com) + **`pybaseball`** (Python wrapper): per-pitch data, **batter pitch-arsenal** leaderboard (BA/SLG/wOBA/whiff/K% by pitch type), platoon splits, expected stats (xwOBA/xBA), park factors by handedness, rolling-xwOBA. CSV/scrape, free.
- **MLB — official MLB Stats API** (statsapi.mlb.com, wrapper `mlb-statsapi`): probable pitchers, confirmed lineups/batting order, live box, rosters, injury/roster transactions. Free, unauthenticated. **This is the lineup/availability gate.**
- **NFL — `nflverse` / `nfl_data_py` / `nflreadpy`** (nflfastr.com): play-by-play, snap counts (`load_snap_counts`, daily in-season), target share / air yards / WOPR, pace (sec/play, plays/game, PROE, EPA), schedules for rest/travel. Free datasets.
- **Odds/props — The Odds API** (the-odds-api.com): odds + player props across NBA/MLB/NFL/NHL from many US books (NBA points/threes/PRA, MLB batter_total_bases/pitcher_strikeouts, NFL reception_yds/anytime_td), alternates, via `/events/{id}/odds`. *This is already our feed.*
- **Weather — Open-Meteo** (open-meteo.com): free, no key, forecast + historical wind/temp; geocode the stadium, match to first pitch. (Meteostat / OpenWeather as paid backups.)

### DvP convenience scrapes (coarse but quick)
RotoWire (`/daily/nba/defense-vspos.php`), FantasyPros (`/nba/defense-vs-position.php`, `/nfl/points-allowed.php`), RotoGrinders grids. Position-bucket level — fine for a first pass; for real signal, derive defender-level allowed stats from `nba_api boxscorematchupsv3` (NBA) or nflfastR PBP (NFL).

### Paywalled / high-signal, no clean API (enrichment layer, not the spine)
- **PFF** — NFL WR/CB matchup + shadow matrix, pass-rush/pass-block grades, fantasy matchup chart. Subscription, scrape.
- **Cleaning the Glass** — NBA on/off, garbage-time-filtered lineup splits. ~$5–10/mo, scrape.
- **FTN** — NFL charting (pressure/coverage/concept), DVOA/EPA. Subscription.
- **pbpstats** (free package / paid API), **dunksandthrees** (EPM), **Basketball Index** (roles/matchup difficulty).

### News / injury / lineup feeds
- **BallDontLie** — injuries + player-status across NBA/NFL/MLB, webhook push, free tier.
- **ESPN hidden JSON** — `site.api.espn.com/.../injuries` per league (unofficial, free).
- **Official feeds** — NBA injury report (day-before + game-day re-files every 15 min, "rest" now its own category), NFL inactives (90 min pre-kick), MLB Stats API transactions.
- **Beat writers** — fastest, highest-signal humans; build a per-team roster (they report warmups/rotations before official confirmation). Treat as *information*; treat aggregate Reddit/Twitter vibe as *sentiment* (fade indicator, not signal).

### Rest/travel
No API exists — always **engineered** from schedule dates + venue coordinates (haversine distance, time-zone deltas, B2B flags).

---

## 3. Form — hot / cold / breakout

**Bet the cause, not the streak.** A run is predictive only when *opportunity* changed:
- **Real signal:** teammate-injury usage absorption (the most exploitable — a first option out adds meaningful output to #2/#3, and the book lags on the secondary players' lines), role/minutes change, a genuine matchup edge this game.
- **Noise to fade:** unsustainable efficiency (hot 3PT%, elevated HR/FB or BABIP), small-sample variance. Statistical research finds the hot hand is *real but modest* — smaller and far less reliable than fans believe, and rarely enough to justify a line the streak already inflated.

**Recency weighting:** lean ~80–90% on the long-term baseline, ~10–20% on a hot 5–10 game window. Shrinkage: `projected ≈ (n·X_recent + k·X_base)/(n + k)`, k ≈ 30–50.

**MLB stabilization (Fangraphs — how many events before "recent" is trustworthy):** K rate <100 PA (stabilizes fast — most trustworthy short-sample signal); power/ISO/HR ~150–200 PA (a 10–20-game HR binge is NOT stabilized — fade it); AVG/BABIP ~500+ PA (regress short-sample swings to the *player's* career, hitter BABIP regression constant k ≈ 570). NBA: minutes/usage/assists-when-role-stable are sticky; 3PM/3PT% are the most regression-prone.

**The "hot → bet the over" trap:** public hammers the over after a streak → book shades the line up → over now sits above true talent. The under is frequently the value side. Sharp confirmation: **reverse line movement** (>70% of tickets on one side but the line moves the *other* way) = sharp money on the unpopular side. Only stay on the over with a structural reason the book hasn't priced.

---

## 4. Cash-out & variance tactics

**Bottom line:** cash-out and hedging both cost EV (you pay vig twice) but convert a lottery ticket into near-certainty. Variance tools, not profit tools.

### Early cash-out
Fair value ≈ `P(bet still wins now) × (stake + potential profit)`. The book offers *less* — measured haircuts run ~70–90% of fair value, sometimes ~50% as a game progresses (one measured example: an 11% tax on top of the original vig). **Riding is the EV-max play on any normal-sized bet.** Cash out only when:
- the payout is **life-changing relative to bankroll** (log-utility — the first big chunk is worth more than the incremental upside), or
- you over-staked and want out, or
- you find a **penalty-free pre-game cash-out** (100% refund) and news broke against you — the one genuinely +EV cash-out.

Cautionary tale from the research: a $5 HR parlay, 6 of 7 legs hit, ~$196k at stake on the last leg; the book offered ~$12k (equity ~$24.5k — the classic 50% offer). Bettor declined, offer fell, cashed for ~$4.6k, and the last leg hit. No "right" answer exists independent of bankroll — which is exactly why the tool should *show the math*, not decide for the operator.

### Hedging the final leg
Bet the opposite side of the last pending leg (ideally on a different book — line-shop the hedge). Equalizing-hedge stake:
```
Hedge stake = (original total payout) × implied-prob(hedge side)
```
American→implied: positive `100/(odds+100)`, negative `(-odds)/(-odds+100)`.

Worked example (a $10 ticket now worth $410 total if the last leg hits; opposite side available at +120 / decimal 2.20): implied prob = 100/220 = 45.45%; hedge stake = $410 × 0.4545 = **$186.36**. Either outcome locks ≈ **+$213.64**. Partial hedging (recoup stake, keep upside) is the middle path. Never hedge a spread/total that moved against you (reverse-middle: you can lose both sides).

### Staking lotto parlays
Kelly `f* = (b·p − q)/b` returns a tiny fraction for longshots, and parlays compound estimation error across legs (over-estimating win prob by 3 pts can have you betting 5–10× too much; >2× Kelly is *negative* long-run growth even with real edge). Practical: **flat tiny units (0.25–1% of bankroll), hard cap 2–3%, deep-fractional Kelly if used at all.** For *simultaneous* tickets, divide by √n (4 at once → half-Kelly each; 9 → a third). Correlated legs → cut further. Treat lotto parlays as a small fixed "lottery allocation," never chase, never up-size after a hot streak, recompute off *current* bankroll.

---

## 5. Correlation-aware construction

You can't multiply marginal probabilities for correlated legs. Positive correlation makes the true joint hit-rate *higher* than the naive product (fair odds shorter); negative makes it *lower* (fair odds longer). Typical pairwise ρ ≈ −0.4 to +0.6.

**Legs that legitimately move together (positive — value if the book under-prices it):** QB pass yds + his WR rec yds (reported r ≈ 0.47 — betting-media, treat as directional); QB yds + team total over; RB rush yds + RB anytime TD; star pts+ast + team total; pace + multiple overs; "blowout stack" (winning-team stars over + losing-team role players under); hitter HR + that hitter's total bases (near-deterministic); HR + team total; two hitters in a projected slugfest; pitcher Ks over + opposing team total under.

**Negative-correlation traps (these LOWER joint odds — never stack by accident):** pitcher Ks over + an opposing hitter's hits/TB over (mutually exclusive-ish); two teammates who share usage both over (cannibalization); QB pass-volume + his own RB rush-volume; favorite covers big + total over in a clock-killing blowout. Rule: **never put two legs in one ticket that require contradictory game scripts.**

**How books price it — the correlation tax:** SGP house edge runs **15–25%+** vs ~4–5% on a single and <1% on an uncorrelated multi-game parlay. The "smartest-feeling" stacks are exactly where the book has the most data and the biggest edge (selection bias as a trap). Example: a stack worth +594 independent gets offered at +350–400 — a ~33% payout cut.

**The defensible plays:**
1. **If you genuinely like 3 legs as +EV, bet 3 singles, not one SGP** — three ~4–5% edges beat one 15–25%-edge ticket for the same risk.
2. **Cross-game parlays of independent obtainable legs** are EV-gateable (no shared script); same-game are not (no book SGP prices in our feed — Odds API parlays:null).
3. **Line-shop the SGP across our 7 backend books** — the same stack varies 50–100+ points because books use different correlation models.
4. **Exploit stale correlation models on news** — a late RB-out *raises* QB↔team-total correlation before the book's model catches up; wind weakens passing↔total and strengthens rushing↔under.
5. The rare **negative-correlation value** angle (books under-give on legs that "feel wrong" to combine) — small stakes, closing fast.

---

## 6. News / information ingestion

The doctrine, one line: **books beat you on speed; you beat them on interpretation, context, and the redistribution they price slowly — and CLV tells you if it's working.**

- **Speed is a loser's game for an individual** — algorithms move totals ~3 pts the second a starter is OUT. The edge is interpreting ambiguous "questionable" tags, knowing context the model misses, and the **usage-redistribution lag** (30–90 min of stale role-player props after a star scratch — the most concrete codifiable edge in this whole pass).
- **Sentiment vs information.** Crowd sentiment (Reddit, most of Twitter) is *ticket count* = the side the book profits from; a viral take is a fade indicator. Information is specific, timely, source-attributable (named beat reporter, official feed, confirmed lineup). Weight a source by attribution × timeliness × specificity × actionability; discard vibe.
- **Tools serious bettors use:** official injury feeds first, then per-team beat writers, confirmed-lineup feeds, weather feeds, and odds-screen/CLV tools (Unabated, Betstamp PRO/Proptimizer, OddsJam, Pikkit auto-CLV).

### CLV is the scoreboard
Closing Line Value — did you consistently get a better number than the close (the market's most-informed price)? Beating the close on **65–70%+** over a 200+ sample is a strong +EV signal even when individual bets lose; ~50% = even with the market; <45% = the market prices better than you. (Books cut limits on CLV-positive accounts — which is itself proof the metric works.) **Surfacing CLV is how the operator can SEE whether the human+model process is actually working, instead of trusting narrative.**

---

## 7. The "track this" checklist — ranked by likely edge value, per sport

Tier 1 = near-binary outcome drivers (ignore = lose). Tier 2 = projection inputs (where modeling edge lives). Tier 3 = environment/market context (refinement + edge-confirmation).

### NBA
1. Confirmed inactives / starting five *(T1)*
2. Minutes projection — the master variable (foul trouble, blowout, load-mgmt, B2B) *(T1)*
3. Injury-designation tracking + interpretation (incl. 15-min game-day updates) *(T1)*
4. **Usage redistribution when a teammate is OUT — the stalest, most exploitable lines** *(T1)*
5. Usage rate + per-minute rates *(T2)*
6. Defense-vs-position *(T2)*
7. Pace (team pace + Vegas total proxy) *(T2)*
8. Matchup specifics — primary defender, scheme *(T2)*
9. Recent form / role-change detection *(T2)*
10. Rest / B2B / travel *(T3)*
11. Blowout risk *(T3)*
12. Line movement, sharp/public splits, reverse line movement *(T3)*
13. CLV tracking (audit, not pre-bet input) *(T3)*

### MLB
1. Confirmed starting pitcher + confirmed batting order *(T1 — the gate)*
2. Pitcher arsenal + K profile vs opponent K-rate by handedness *(T1)*
3. Batter wOBA/ISO splits vs pitcher handedness + lineup slot *(T1)*
4. Park factors (current-season) *(T2)*
5. Weather — wind direction/speed, temp, rain *(T2)*
6. Pitcher workload / pitch-count / times-through-order *(T2)*
7. Recent form (batter hot/cold, pitcher velo/results) *(T2)*
8. Bullpen quality / projected reliever exposure *(T2)*
9. BvP history (cautiously — small sample) *(T3)*
10. Umpire strike-zone tendencies *(T3)*
11. Line movement / sharp splits / CLV *(T3)*

### NFL
1. Confirmed inactives (90 min pre-kick) + injury designations *(T1)*
2. Target share / snap share / route participation *(T1)*
3. Usage redistribution on injury *(T1)*
4. Defensive matchup grades by position + coverage scheme (man/zone, slot vs WR) *(T2)*
5. Pace / projected total plays *(T2)*
6. Game script / Vegas spread & total *(T2)*
7. QB tendencies / air yards / aDOT *(T2)*
8. Weather — wind >15 mph (~12% pass-yards haircut), rain/cold *(T3)*
9. O-line/D-line health & matchup (the lineman the market ignores) *(T3)*
10. Rest/travel, short weeks, bye timing *(T3)*
11. Line movement / sharp-public splits / CLV *(T3)*

### Cross-sport meta-signals
Line movement + sharp/public splits + reverse line movement; cross-book line-shopping / de-vigged consensus vs the price you can get; CLV as the after-the-fact audit.

---

## Prioritized build shortlist (on top of the existing shadow stack)

Constraints honored: R2 MLB scoring is frozen (~through 2026-06-25); anything scoring-adjacent ships as an additive **shadow feature** with its own kill-switch (computed alongside, feeds nothing live until proven). MLB is the active sport; NBA is off-season (scaffold only).

1. **Cash-out / hedge helper (build now — zero scoring touch, fully freeze-safe, operator explicitly wants it).** A util + FE card: given a parlay's legs (hit / pending) and current odds, show fair cash-out value, the book's likely haircut band (~70–90%), and the equalizing-hedge stake on the opposite side. Pure math the operator can see and act on. This is the safest, most visible first win and directly matches the "I see this on Twitter constantly" ask.

2. **MLB matchup-intel enrichment layer (shadow).** Pull the free signals — batter platoon split + park factor + first-pitch weather (Baseball Savant/pybaseball + Open-Meteo), pitcher K-arsenal vs lineup K-rate by hand (Savant) — into per-player enrichment that feeds an **obtainability tag**, NOT the frozen score. Systematizes "fan knowledge" on the live sport with real free data. Kill-switch `MLB_MATCHUP_INTEL`.

3. **Usage-redistribution / lineup-change watcher.** The #1 codifiable news edge. MLB now: confirmed-lineup + batting-order-slot deltas from MLB Stats API → flag affected hitter props. NBA-ready scaffold for the star-scratch → beneficiary map. This is where real, repeatable prop edge concentrates.

4. **Obtainability classifier.** Extend the existing archetype tags to score each prop Obtainable vs Longshot on opportunity-floor logic (volume/role/floor-stat vs ceiling-stat). Directly powers "smart legs, not lottos" leg-selection.

5. **Correlation-aware constructor upgrade + cross-book SGP line-shop.** We have the engine; add the honest framing — prefer cross-game independent obtainable legs (EV-gateable), flag negative-correlation traps, and shop the same stack across the 7 backend books for the least-taxed price.

6. **CLV scoreboard on /status.** Make CLV visible so the operator can verify the process is genuinely +EV rather than trusting narrative. (Ties to "the operator is the verifier" and "trust = seeing the math.")

**Recommended first:** #1 (cash-out/hedge helper) if the priority is a safe, visible operator win this week; **#2** (MLB matchup-intel shadow) if the priority is starting the human/quant blend on the live sport. They're independent and both freeze-safe.

---

## Sources

Leg-selection & correlation:
- [Same-Game Parlays: The Mathematics of Correlation — Wizard of Odds](https://wizardofodds.com/article/same-game-parlays-the-mathematics-of-correlation/)
- [Common Fallacies in Player Prop Analysis — Wizard of Odds](https://wizardofodds.com/article/common-fallacies-in-player-prop-analysis/)
- [How to Use Correlation in Sports Betting — OddsJam](https://oddsjam.com/betting-education/how-to-use-correlation-in-sports-betting)
- [Same Game Parlay Correlation: the Hidden Tax — OddsIndex](https://oddsindex.com/guides/same-game-parlay-correlation)
- [NBA Player Prop Strategy — Leans.ai](https://leans.ai/nba-player-prop-strategy/)
- [Shadow Coverage for WRs — RotoBaller](https://www.rotoballer.com/how-damaging-is-shadow-coverage-for-wide-receivers/799471) · [Shadow Coverage Matrix — FTN](https://ftnfantasy.com/nfl/shadow-coverage-matrix)
- [Pass/Run Funnel Report — PFF](https://www.pff.com/news/fantasy-football-pass-run-funnel-report-defenses-to-exploit-in-week-14)
- [Strikeout Props: Elite K Spots — ThisDayInBaseball](https://thisdayinbaseball.com/strikeout-props-betting-how-to-identify-elite-k-over-under-spots/)
- [PRA Props — Outlier](https://help.outlier.bet/en/articles/8692153-how-to-bet-on-point-rebounds-assists-pra-props-nba-player-props)

Data sources:
- [nba_api](https://github.com/swar/nba_api) · [pbpstats](https://github.com/dblackrun/pbpstats) · [pybaseball](https://github.com/jldbc/pybaseball) · [Baseball Savant](https://baseballsavant.mlb.com/statcast_search) · [MLB Stats API wrapper](https://github.com/toddrob99/MLB-StatsAPI) · [nfl_data_py](https://github.com/nflverse/nfl_data_py) / [nflfastR](https://nflfastr.com/)
- [The Odds API markets](https://the-odds-api.com/sports-odds-data/betting-markets.html) · [Open-Meteo](https://open-meteo.com/)
- [FanGraphs park factors (baseballr)](https://billpetti.github.io/baseballr/reference/fg_park.html) · [PFF WR/CB matchup chart](https://www.pff.com/tools/wr_cb_matchup_chart) · [Cleaning the Glass](https://cleaningtheglass.com/stats/)
- [BallDontLie](https://www.balldontlie.io/) · [RotoWire NBA DvP](https://www.rotowire.com/daily/nba/defense-vspos.php) · [FantasyPros DvP](https://www.fantasypros.com/nba/defense-vs-position.php)

Form:
- [Sample Size stabilization — FanGraphs](https://library.fangraphs.com/principles/sample-size/) · [BABIP — FanGraphs](https://library.fangraphs.com/pitching/babip/)
- [Hot-Hand: Truth in the Law of Small Numbers — Miller & Sanjurjo](https://marketing.wharton.upenn.edu/wp-content/uploads/2018/11/Paper-Joshua-Miller.pdf) · [The Hot-Hand Artifact — Data Colada #88](https://datacolada.org/88)
- [Regression to the Mean — Sportsbook Audit](https://sportsbookaudit.com/sports-betting-strategy/understanding-regression-to-the-mean-in-sports-betting/) · [Fading the Public — OddsIndex](https://oddsindex.com/guides/fade-public-betting-strategy)
- [NBA injuries & player props — Rithmm](https://www.rithmm.com/post/are-injuries-in-nba-good-for-player-props)

Cash-out / hedging / bankroll:
- [Cash Out Explained — BettingUSA](https://www.bettingusa.com/sports/cash-out/) · [Hedging Explained — BettingUSA](https://www.bettingusa.com/sports/hedging/)
- [When Should You Cash Out? — Unabated](https://unabated.com/articles/when-should-you-cash-out-of-a-bet)
- [Variance & Bankroll for Player Props — Wizard of Odds](https://wizardofodds.com/article/variance-and-bankroll-management-for-player-props/) · [Kelly criterion — Wikipedia](https://en.wikipedia.org/wiki/Kelly_criterion)

News / CLV:
- [Closing Line Value — Pikkit](https://pikkit.com/blog/what-is-closing-line-value) · [Opening vs Closing Line — Boyd's Bets](https://www.boydsbets.com/opening-vs-closing-line/)
- [How Injuries Shift Odds — BettorEdge](https://www.bettoredge.com/post/how-injuries-shift-betting-odds) · [Market Overreactions — Sports Betting Prime](https://sportsbettingprime.com/betting-market-overreactions.html)
- [Sharp vs Public Money — XCLSV](https://xclsvmedia.com/sharp-money-vs-public-money-how-to-read-betting-action-2026/) · [NBA injury reporting rules — Yahoo](https://sports.yahoo.com/nba/article/nba-reportedly-changing-injury-reporting-rules-while-enacting-several-sports-betting-policies-league-also-looking-to-address-tanking-233739689.html)
- [Beat writers for every NFL team — Fiddle's Picks](https://fiddlespicks.substack.com/p/list-of-beat-writers-for-every-nfl)

*Caveat on numbers: FanGraphs stabilization PA and the Wizard-of-Odds copula/house-edge figures are the most rigorous quantities here. The QB-WR r ≈ 0.47, the 4–8 pt usage cascade, and the 30–90 min repricing lag come from betting/DFS media — directionally reliable, not precise constants. The hot-hand effect is real but contested in magnitude.*
