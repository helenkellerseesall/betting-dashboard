# The Parlay Edge Menu, Scenario Library & Integrity Reality

*Compiled 2026-06-15 (Claude-A deep-research, second wave). Companion to `2026-06-15-prop-parlay-craft-playbook.md`. This is the wide, generative "menu of options + scenarios + duh-we-should-track-this" pass — plus the evidence-based answer on whether sports are actually rigged.*

## How to read this

The first playbook covered the *craft mechanics* (correlation math, cash-out formulas, obtainability). This doc is the **idea menu**: the human/fan edge made trackable, a library of concrete parlay scenarios, the most complete signal list I could assemble (including the overlooked edges), and the integrity reality. It's deliberately broad — pick what's worth building.

The honest frame still holds and isn't repeated everywhere below: this makes the play *smarter and better-managed*, not a guaranteed math edge. But "smarter" is a real, large gap from where the engine is now, and most of what's below is genuinely under-priced by recreational books.

---

# PART 1 — Are sports actually rigged? (evidence, 2023–2026)

You asked, so here's the real record instead of my opinion.

**Verdict: full game *outcomes* are not being fixed.** There is no proven case of a rigged final result in the major US leagues in this era. What *has* been proven and prosecuted is **isolated, individual manipulation of low-limit player props and single-pitch micro-bets** — a player tanking his own stat line, or a pitcher deliberately throwing a ball, so a small ring could cash unders/micro-props. The integrity data is striking on this point: of ~360,000 basketball matches offered for betting 2017–2023, only 59 drew suspicious betting alerts, and **none of the suspicious activity was tied to player-prop markets** (IBIA).

What's actually on the record:

- **NBA — Jontay Porter (PROVEN, lifetime ban 2024, pleaded guilty).** Tipped his health and pulled himself out early so associates could cash an $80K parlay (would've paid $1.1M) on his **unders**. Also bet on games via an associate.
- **NBA — Oct 2025 federal takedown (ALLEGED, charges only).** 34 defendants. **Terry Rozier** allegedly tipped an early exit (March 2023) so ~$200K hit his prop unders — pleaded **not guilty**, trial set Feb 2027. **Damon Jones** (ex-player/coach) **pleaded guilty** (2026) to leaking non-public star injury info. **Malik Beasley** was investigated, **no longer a target, no charges**.
- **MLB — Clase & Ortiz (ALLEGED, indicted Nov 2025, pleaded not guilty).** Guardians pitchers allegedly agreed in advance on specific pitch type/speed so associates could win **pitch-level micro-prop bets** (Clase's rigged pitches reportedly won associates ≥$400K; one parlay leg won $38K on a deliberately spiked slider). This is the "2026 pitch-fixing scandal" the news framed.
- **MLB — Tucupita Marcano (PROVEN, lifetime ban 2024).** 387 baseball bets >$150K — a *betting-rule* violation; no proven game manipulation.
- **NFL — Ridley / Rodgers / Williams:** betting-policy suspensions, **no proven game-fixing**.

**The structural takeaway — what's manipulable vs. not:**
- *Easy to corrupt (where every proven case lives):* single-actor micro-props (a specific pitch, a kicker miss, a QB's first incompletion) and low-limit obscure props (unders on two-way / 10-day / deep-bench players). One person controls the outcome and the small action moves nothing.
- *Hard to corrupt:* full-game outcomes and high-liquidity star props (Curry threes, a closer's saves) — too much money, too much scrutiny, instantly visible to monitors (Sportradar watches 550+ operators; IC360 / U.S. Integrity flag anomalous moves; the Guardians case was caught exactly this way by an Ohio book reporting weird first-pitch action).
- *What leagues/books did:* the "Jontay Porter rule" (no props on two-way/10-day players), MLB's **$200 cap on pitch-level props + exclusion from same-game parlays**, and Illinois banning 10 single-actor NFL prop types.

**What this means for our tool (design rules — these are real, defensible constraints):**

1. **Hard-exclude single-actor micro-markets** — no pitch-level, kicker-miss, or first-pass props. That's the entire proven attack surface, and books are already capping/delisting them.
2. **Down-weight or block low-limit / low-liquidity legs** — skip unders on two-way / 10-day / deep-bench players (the Porter/Rozier profile). If the *book* limits a market hard, treat that as the book telling you it's manipulable.
3. **Favor obtainable, role-floored STAR props** — high-minutes, high-usage starters with guaranteed-role floors. These are the robust markets leagues deliberately kept on the board.
4. **Treat anomalous line moves as a RED FLAG, not an edge.** A sharp, inexplicable move on an obscure under is the exact signature integrity firms flag. The anomaly detector should *suppress* a leg, never recommend it.
5. **Cross-check against the official injury timeline** — if a market moves before the official report posts, flag it as tainted, not as a tell to chase.
6. **Stay on regulated books** — detection (and the caps/exclusions) only exist inside the monitored ecosystem.

Bottom line: the rigging record doesn't argue against the product — it argues *for* one that routes you toward high-liquidity, role-floored star markets and away from the exact micro-markets where every scandal happened, using weird line moves as a defensive flag.

---

# PART 2 — The fan edge, made trackable

The "he just knows basketball" edge is real but narrow: books are sharp on stars and headline numbers, **soft on role changes, obscure markets, and situational spots they haven't repriced yet.** The edge isn't watching games — it's converting the fan instinct into a *repeatable trigger the engine fires before the book catches up.* For each instinct below: the fan read → the feature to build.

**Coverage / scheme (NFL).** "He's getting CB1 in man, fade the over" → tag defense man% vs zone%, map the WR's alignment (outside/slot) to the corner who'll actually shadow him, pull that defense's yards-allowed-to-position rank. Slot WRs mostly *escape* shadow corners — track alignment, not just the name.

**Pace / total environment (NBA).** "Slow team gets dragged into a track meet" → projected game pace (avg of both teams' possessions) vs the player's baseline; pace-up = overs on usage-heavy guys. Pair with opponent defensive rating + DvP, but treat DvP as *secondary* (switching schemes blur position matchups).

**Pitcher vs lineup (MLB).** "This guy owns this lineup" → opposing lineup aggregate K% vs the pitcher's swinging-strike%/K rate, layered with park K factor + handedness splits. A 30%-K arm vs a 22%-K lineup is a real over spot.

**Game script.** "Coach pulls starters when up big" → spread + team blowout frequency + coach's Q4-benching tendency → star minutes/points UNDER, bench scorer OVER (the garbage-time sneaky over). NFL: spread → script → underdog passing volume up, favorite RB rushing volume up.

**Fatigue / schedule.** "Old legs on a back-to-back" → B2B flag × age × minutes load (efficiency and effort drop on night 2, worse coast-to-coast); 3-in-4 compounds and gets *less* market attention than a plain B2B.

**Usage redistribution (the strongest codifiable fan edge).** "Star's out, someone eats" → when a high-usage player is ruled out, compute vacated usage/targets/touches and redistribute to the next man up by prior with/without splits; flag the beneficiary *before* the line fully moves. Books "adjust the number but not the role" — that lag is the edge. (Don't stack two players fighting for the *same* vacated touches — that's negative correlation.)

**Motivation (handle honestly).** Revenge / national-TV / contract-year / "he shows up in big games" → boolean tags used as *minor tie-breakers only*. Evidence is mixed: the NBA contract-year bump is modestly real; in MLB it's mostly noise. Value is in spots the book *ignored*, not in the narrative itself.

**Splits.** Home/road, slow-starter vs second-half player, day/night (MLB) → stored per-player splits, surfaced only when the matchup amplifies them.

**The hot/cold test (when the fan read beats the recency trap):** trust a streak only when there's a *named structural cause* — injury to a teammate, trade, scheme change, role/usage shift. With just 5–10 "hot" games and no cause, career data should still carry ~80–90% of the weight (Wizard of Odds). Tag every streak `cause_known: true/false`; trust the trues, regress the rest. A 20-PPG scorer on a cold week is usually still a 20-PPG scorer — fade the panic under.

---

# PART 3 — Scenario library (the "duh, build this" plays)

Concrete parlay-build templates the engine can pattern-match. The discipline in all of them: **stack obtainable, floored, same-story legs.** Obtainable = floor stats (minutes, targets, attempts, outs, total bases) over ceiling events (a specific HR, a 40-burger).

**NBA — Star-out usage cascade.** Primary creator OUT at lineup lock → (a) secondary ball-handler **assists OVER**, (b) wing scorer **points OVER**, (c) team total OVER *only if pace-up*. One story: redistributed usage + more possessions. Don't stack two guys competing for the same touches.

**NBA — Pace-up shootout.** Two fast teams, high total, neither defends → lead guard **points + assists OVER**, opposing star **points OVER**, **game total OVER**. All ride the same possessions-no-defense engine.

**NBA — Big-favorite blowout fade.** Large spread + a coach who sits starters Q4 → star **minutes/points UNDER** + bench scorer **points OVER** (garbage time). One coherent story.

**MLB — Strikeout-pitcher spot.** High swinging-strike% starter vs a high-K lineup, wide-zone ump, pitcher-friendly park, cold/windy → **pitcher Ks OVER** + **pitcher outs/innings OVER** (length correlates with the K count) + his side's **first-5 team total UNDER**.

**MLB — Coors / wind-out hitting spot.** Wrigley wind out or a Coors game → two bats **total bases OVER** + **game total OVER**. Weather is the shared driver; keep TB legs short (ceiling-ish).

**NFL — Underdog passing script.** Home dog likely trailing → QB **passing yards OVER** + WR1 **receptions OVER** (floor stat, dodges shadow-CB risk) + lead RB **rushing attempts UNDER**. Coherent pass-heavy comeback.

**NFL — Favorite ground game.** Heavy favorite expected to lead → RB **rush attempts + yards OVER** + **team total OVER** + opposing-WR yards UNDER if he draws the shadow corner.

Each scenario is a template: detect the trigger conditions from data, propose the obtainable legs, show the one-sentence game story, and (per Part 4) flag the correlation so the user stacks coherently instead of randomly.

---

# PART 4 — The complete "track this" signal menu, ranked

**High** = repeatable, under-priced, codifiable. **Medium** = real but partly priced/noisy. **Low** = mostly narrative; track for completeness.

## NBA
1. **Minutes / role projection + blowout risk** — *High.* Volume is the dominant prop input; big spreads sit stars Q4. (nba_api, Cleaning the Glass garbage-time-filtered, beat-writer rotation news.)
2. **Back-to-backs & 3-in-4 fatigue** — *High.* Night-2 shooting/TO penalty; coast-to-coast ~5–7% drop; 3-in-4 under-attended. (Derive from schedule + travel.)
3. **Referee crew assignment + foul/pace tendencies** — *Medium-High.* Tight crews → more FTs/fouls/slower pace → moves points, FT-attempt, and foul props. Posts game-morning. (RefMetrics, NBAstuffer, DonaghyEffect, Odds Shark.)
4. **On/off & lineup redistribution** — *Medium-High.* Teammate out reshapes usage; market lags the next-man-up. (PBP Stats, EvanMiya, Cleaning the Glass, Dunks & Threes EPM.)
5. **Travel + altitude (Denver/Utah)** — *Medium.* Short rest at altitude; stacks with B2B.
6. **Garbage-time-filtered historical rates** — *Medium.* The true competitive-game number to price against. (Cleaning the Glass, PBP Stats.)
7. **Tanking spots (late season)** — *Medium.* Stars rested for lottery odds → fringe players up.
8. **National-TV / revenge motivation** — *Low.* Mostly narrative.

## MLB
1. **Home-plate umpire strike-zone size** — *High.* Big zone → more Ks/fewer walks/unders; drives K-props, walk-props, totals. (UmpScorecards, Odds Shark, cross-ref Statcast.) *Note: ABS challenge era is shrinking this — re-weight down over time.*
2. **Wind direction + speed** — *High.* The biggest weather lever; out 15+ mph ≈ +1–2 runs; in kills homers. (Open-Meteo free, hourly by park lat/long; Ballpark Pal.)
3. **Bullpen usage / fatigue (pitches last 3 days)** — *High.* Arms >40 pitches in prior 72h underperform; tired pen → late-inning runs. (MLB StatsAPI game logs, pybaseball; rolling 3-day workload feature.)
4. **Park factors (temp/elevation/roof)** — *High.* Sets the run/HR baseline; roof state overrides weather. (Baseball Savant park factors, Ballpark Pal.)
5. **Platoon / handedness splits** — *Medium-High.* LHB ~30 pts AVG worse vs LHP; drives hitter & matchup-K props. (pybaseball, Savant, FanGraphs.)
6. **Batting-order slot** — *Medium-High.* Top of order ≈ +0.5–1 PA/game — pure volume. Lineup drops ~3–4h pre-game; lines lag. (MLB StatsAPI, Rotowire.)
7. **"Opener" / bullpen-game usage** — *Medium.* The "starter" K-prop is mispriced when it's an opener.
8. **Catcher framing** — *Medium.* Good framers steal strikes → boost their pitcher's K-prop. Eroding under ABS. (Savant framing leaderboard.)
9. **Day-after-night / getaway days** — *Low-Medium.* Shuffled lineups, sluggish early offense.

## NFL
1. **Pace (sec/play, plays/game) + PROE** — *High.* Plays × pass/run split = the volume floor for every yardage/reception prop; PROE is the most predictive tendency stat. (rbsdm.com free, nflfastR xpass, Sharp Football.)
2. **Snap / route / target share** — *High.* Receiving props live on routes + target share; rising route participation leads the market. (nflverse participation data; PFF paid.)
3. **Weather — wind on passing & kicking** — *High.* 20+ mph ≈ −7 yds FG distance + big passing drops; favor rushing + unders, fade kicker props. (Open-Meteo; dome/outdoor table.)
4. **Game-script / spread-implied volume** — *Medium-High.* Favorites run late, trailing teams pass. (Odds API spread → script model.)
5. **Red-zone usage / role** — *Medium-High.* RZ touches drive TD props more than total yardage. (nflverse RZ stats, Sharp Football.)
6. **Pass-rush vs O-line matchup** — *Medium.* Pressure caps QB yards, forces dump-offs. (PFF paid, ESPN pass-block win rate.)
7. **Referee crew penalty tendencies** — *Medium.* Penalty-heavy crews add ~5–10 pts/game; <5% of bettors factor it. (NXTbets, Sharp Football.)
8. **Short week / Thursday / international** — *Low-Medium.* Compressed prep suppresses efficiency.

## Cross-sport market signals (is the market with you yet?)
1. **Closing Line Value (CLV)** — *High.* The only reliable proof you're +EV; the scoreboard, not a per-bet trigger. (Odds API historical-odds open→close snapshots.)
2. **Line-origination timing** — *High.* Props post late and soft; early numbers are the most beatable (but lower limits / profiling risk).
3. **Soft / low-hold books vs sharp (Pinnacle/Circa)** — *High.* The gap between the soft book and the sharp consensus *is* the edge. (Odds API multi-book; we already keep 7 books backend for exactly this.)
4. **Steam moves** — *Medium-High.* Simultaneous cross-book shift = coordinated sharp action.
5. **Reverse line movement** — *Medium.* Trustworthy only late + high-limit; early RLM is often liability management.
6. **Prop limits as a tell** — *Medium.* Low max bet = the book's own uncertainty meter (or a profiling trap).
7. **Sharp vs public bet%/handle% split** — *Low-Medium.* Heavily marketed, mostly arbitraged on mainstream games.

**Two cautions to code in:** (1) MLB's automated ball/strike challenge system is actively shrinking the umpire and framing edges — decay their weight over time. (2) The same early-soft-line timing edge that wins is what gets you limited fast.

---

# PART 5 — Named follows & free tools

**Free data backbone (build features on these):** `pybaseball` + Baseball Savant + official MLB Stats API (MLB), `nba_api` + PBP Stats + Cleaning the Glass (NBA), `nflverse`/`nflfastR` + rbsdm.com PROE (NFL), The Odds API (lines/props + historical for CLV — already our feed), Open-Meteo (free weather), BALLDONTLIE (free multi-league API). Ref/ump: RefMetrics, NBAstuffer, UmpScorecards, Odds Shark logs. Park/weather: Ballpark Pal.

**Human intel (verify any single account before trusting it):** RotoWire (the de-facto lineup-lock source, all sports), Establish The Run / Evan Silva (NFL matchups column + props), per-team **beat reporters** (break inactives and role changes before national feeds — build a per-team list), Playbook / Action Network aggregators for fast injury news. Curated follow lists to mine: Unabated, RotoGrinders, Sports Handle. Treat aggregate Reddit/Twitter *sentiment* as a fade indicator, not a signal — *specific, attributed, timely* info is the real thing.

---

# PART 6 — The $5–20 / 5–15-leg model, honest reality

The math, unsparing: parlay hold is ~30% vs ~5% on singles; a 10-leg parlay carries ~37% house edge; a 12-leg at 50%/leg hits ~1 in 4,000. The long heavy-leg ticket is a **structured lottery**, not an income stream — your friend's big hits are real and fun, but they're variance, not a repeatable edge.

What separates the relative winners: **fewer, better legs** (2–4 is the risk/reward sweet spot; on DFS apps, Underdog 3-leg power plays and 5–6-leg PrizePicks *flex* plays where a near-miss still pays partial), **line-shopping the build** (SGP prices vary more across books than any bet type), **correlation literacy** (stack same-story legs, avoid the "two bets on one outcome" illusion, hunt the rare mispriced negative correlation), and **bankroll discipline** (any parlay ≤1–2% of bankroll; the tiny stake is the point).

The defensible product framing: surface the **named structural angle** behind each leg and the **correlation story**, so you stack coherent obtainable legs from real spots (usage cascades, pace, script, weather, ump/wind) instead of "5 random props." Add cash-out/hedge math so a few bucks can lock real profit when most legs hit. The edge is in leg-selection and ticket construction — never in the leg count. That's exactly the "knowledgeable fan, with the AI's reach behind it" you described.

---

# What to build from all this (mapping to the engine)

These extend the existing shadow stack and stay freeze-safe (scoring-adjacent = additive shadow feature + kill-switch; R2 frozen ~through 2026-06-25). In rough priority:

1. **Matchup-intel enrichment (MLB live now):** umpire zone + wind/park + bullpen-fatigue + platoon/handedness + batting-order slot → an "obtainability + matchup" tag. All from free feeds (Savant, Open-Meteo, MLB StatsAPI, UmpScorecards). This is the heart of the human/quant blend.
2. **Usage-redistribution / lineup watcher:** the #1 codifiable edge — confirmed-lineup/scratch deltas → flag stale beneficiary props (MLB now; NBA-ready scaffold).
3. **Integrity guardrails:** exclude single-actor micro-markets, block low-limit two-way/10-day legs, and an anomalous-line-move detector that *suppresses* (never recommends) a leg.
4. **Scenario-template engine:** pattern-match the Part 3 archetypes → propose obtainable, same-story legs with the one-sentence "why."
5. **Cash-out / hedge helper:** fair value, book haircut, exact hedge stake. Zero scoring touch — safe to build anytime.
6. **CLV scoreboard on /status:** the operator-visible proof the process is (or isn't) working.
7. **Soft-book line-shop surface:** exploit the 7-book backend to take the least-taxed number on each leg/SGP.

---

## Sources

Integrity:
- [NBA bans Jontay Porter (NBA.com)](https://www.nba.com/news/jontay-porter-banned-from-nba) · ["Jontay Porter rule" (Yahoo)](https://sports.yahoo.com/the-jontay-porter-rule-nba-and-betting-partners-will-not-take-prop-bets-on-low-salary-players-235744308.html)
- [Rozier/Billups case explainer (ESPN)](https://www.espn.com/nba/story/_/id/46696437/nba-sports-betting-gambling-scandal-rozier-billups-fbi-arrests) · [Rozier pleads not guilty, Feb trial (ESPN)](https://www.espn.com/nba/story/_/id/49022915/terry-rozier-pleads-not-guilty-new-charges-feb-trial-set) · [Damon Jones guilty plea (ESPN)](https://www.espn.com/nba/story/_/id/48618707/ex-nba-player-damon-jones-1st-plead-guilty-gambling-case) · [Beasley not a target (NBC)](https://www.nbcnews.com/sports/nba/federal-prosecutors-investigating-detroit-pistons-guard-malik-beasley-rcna215835)
- [DOJ EDNY — Clase & Ortiz indictment](https://www.justice.gov/usao-edny/pr/two-current-major-league-baseball-players-charged-sports-betting-and-money-laundering) · [Clase/Ortiz pitch-rigging (ESPN)](https://www.espn.com/mlb/story/_/id/46906636/guardians-emmanuel-clase-luis-ortiz-indicted-pitch-rigging) · [MLB $200 pitch-prop cap (Fox)](https://www.foxnews.com/sports/mlb-cracks-down-new-betting-limit-after-cleveland-pitchers-charged-gambling-scheme)
- [Marcano lifetime ban (ESPN)](https://www.espn.com/mlb/story/_/id/40275531/tucupita-marcano-gets-life-mlb-ban-betting-baseball) · [NFL betting suspensions list (PFN)](https://www.profootballnetwork.com/nfl-betting-suspensions-list-calvin-ridley-jameson-williams-and-others/)
- [Sportradar Integrity bet monitoring](https://sportradar.com/integrity-regulatory/integrity/bet-monitoring-detection/?lang=en-us) · [IC360 monitoring](https://ic360.io/monitoring) · [IBIA 2024 report — 219 alerts (Yogonet)](https://www.yogonet.com/international/news/2025/02/18/95423-ibia-39s-2024-integrity-report-reveals-219-suspicious-betting-alerts-in-the-year-up-17-from-2023) · [IBIA 2025 — 300 alerts (Covers)](https://www.covers.com/industry/300-suspicious-betting-alerts-reported-to-ibia-in-2025) · [Books tighten prop rules (American U/Kogod)](https://kogod.american.edu/news/sportsbooks-tighten-rules-on-prop-bets-to-tackle-gambling-scandals)

Fan edge / scenarios:
- [Common Fallacies in Player Prop Analysis (recency/regression) — Wizard of Odds](https://wizardofodds.com/article/common-fallacies-in-player-prop-analysis/) · [SGP Mathematics of Correlation — Wizard of Odds](https://wizardofodds.com/article/same-game-parlays-the-mathematics-of-correlation/)
- [Optimal Entry Types for PrizePicks/Underdog — OddsJam](https://oddsjam.com/betting-education/optimal-entry-types-for-prizepicks-and-underdog-parlays) · [Finding Player Prop Inefficiencies — OddsShopper](https://www.oddsshopper.com/articles/betting-101/sports-betting-prop-strategy-finding-player-prop-inefficiencies-y10)
- [NFL Player Prop Strategy — SportsBettingDime](https://www.sportsbettingdime.com/guides/how-to/nfl-player-prop-bets/) · [Handicap NBA Props Like a Sharp — OddsTrader](https://www.oddstrader.com/betting/analysis/5-keys-to-handicap-nba-player-props-like-a-sharp-bettor/) · [Situational Handicapping — Predictem](https://www.predictem.com/betting/strategy/situational-handicapping/)
- [Strikeout Props: Elite K Spots — ThisDayInBaseball](https://thisdayinbaseball.com/strikeout-props-betting-how-to-identify-elite-k-over-under-spots/) · [MLB Props Strategy (ump/park/weather) — PropsOptimizer](https://www.propsoptimizer.com/guides/mlb-player-props-strategy)
- [Why Most Parlays Lose (hold %) — leans.ai](https://leans.ai/betting-how-to-why-parlays-lose/) · [Favorite-Longshot Bias — Boyd's Bets](https://www.boydsbets.com/favorite-longshot-bias/) · [Parlay bankroll sizing — Stake](https://stake.com/blog/parlay-betting-guide)
- Follows/tools: [Unabated best NFL follows](https://unabated.com/articles/best-nfl-twitter-follows) · [RotoGrinders 2026 follows](https://rotogrinders.com/sports-betting/guides/best-sports-betting-twitter-x-follows) · [Establish The Run team](https://establishtherun.com/about/our-team/) · [RotoWire MLB lineups](https://www.rotowire.com/baseball/daily-lineups.php)

Signal menu:
- NBA: [DonaghyEffect referees](https://www.donaghyeffect.com/nba/referees) · [NBAstuffer referee effect](https://www.nbastuffer.com/the-referee-effect-in-the-nba/) · [RefMetrics NBA fouls](https://www.refmetrics.com/nba/foul-leaders) · [NBAstuffer rest-day factor](https://www.nbastuffer.com/rest-days-factor-nba-scheduling/) · [TheDataJocks B2B stats](https://thedatajocks.com/the-stats-behind-back-to-back-nba-games/) · [NBA.com altitude](https://www.nba.com/news/is-impact-of-denvers-altitude-fact-or-fiction)
- MLB: [Odds Shark umpire logs](https://www.oddsshark.com/mlb/umpire-handicapping-statistics) · [HeatCheckHQ MLB weather](https://heatcheckhq.io/blog/mlb-weather-betting-guide) · [Baseball Savant park factors](https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=distance) · [Savant catcher framing](https://baseballsavant.mlb.com/leaderboard/catcher-framing) · [Tired-bullpen betting — Core Sports](https://www.coresportsbetting.com/betting-against-tired-mlb-bullpens/) · [Ballpark Pal](https://www.ballparkpal.com/Park-Factors.php)
- NFL: [rbsdm.com PROE](https://rbsdm.com/stats/pass_freq/) · [Sharp Football pace](https://www.sharpfootballanalysis.com/stats-nfl/nfl-team-pace-stats/) · [ETR pass rate over expectation](https://establishtherun.com/pass-rate-over-expectation/) · [Sharp Football weather](https://www.sharpfootballanalysis.com/sportsbook/weather-impact-on-nfl-betting/) · [NXTbets referee crews](https://nxtbets.com/nfl-betting-trends-by-referee-crew/)
- Data/market: [swar/nba_api](https://github.com/swar/nba_api) · [The Odds API quickstart](https://theoddsapi.com/quickstart.html) · [CLV explained — SportsbettingDime](https://www.sportsbettingdime.com/guides/betting-101/closing-line-value/) · [RLM & sharp money — OddsShopper](https://www.oddsshopper.com/articles/betting-101/reverse-line-movement-secrets-of-sharp-money-betting-y10) · [Why books limit prop bettors](https://betpredictionsite.com/blog/why-sportsbooks-limit-prop-bettors/) · [CrazyNinjaOdds low-hold](https://crazyninjaodds.com/site/tools/low-hold.aspx)

*Caveats: Integrity facts are attributed proven-vs-alleged. Hold %, edge magnitudes, and fatigue/weather effect sizes come from betting/analytics media — directionally reliable, not precise constants. The umpire/framing edges are decaying under MLB's automated ball/strike system.*
