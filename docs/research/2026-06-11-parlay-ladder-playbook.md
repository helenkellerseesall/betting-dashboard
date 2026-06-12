# Parlay & Ladder Engine — Research Playbook

**Date:** 2026-06-11 · **For:** operator (betting-dashboard) · **By:** Claude-A research pass (5 parallel cited searches, cross-verified)

This is the real, implementable answer to "how do people build the small-money-into-big-money multi-leg plays (multi-HR, first-basket, multi-3s, multi-hits) — and how do I build it on top of the prop-scoring engine I already have." No hype, no "guaranteed money," no "it's impossible." Just the methods, the math, the honest edge, and a build order.

---

## 0. The honest bottom line (read this first)

A parlay is **EV-neutral machinery** — it amplifies whatever edge *sign* you feed it. Feed it −EV legs (what the public does) and the house edge **compounds**: hold goes from ~4.5% on a single bet to **15–25%+ on a same-game parlay (SGP)**. Feed it genuinely **+EV legs** (or exploit correlation the book mispriced), and the **edge** compounds the same way, in your favor.

Three consequences that decide everything:

1. **The lotto-screenshot dream is mostly survivorship theater.** A zero-skill coin-flipper still hits 58%+ over 100 picks **6.6% of the time** — with hundreds of accounts spinning up daily, dozens are *always* on a screenshot-able heater. Across 120 real tipsters, an early **+17.4%** record regressed to **+1.1%** once the sample grew. The accounts you see are selected winners; the losers went quiet.
2. **The path that actually works is exactly the one you already documented as T2:** provably +EV single-prop legs (your BAND scorer) → per-player probability **ladders** → **correlation-aware** milestone parlays → **fractional-Kelly** sizing. R2 (making the single-prop tier honest) wasn't a detour — it's the *required foundation*. You can't build a winning parlay engine on a lying tier.
3. **Even a working model hits the limiting wall.** Retail books limit prop/parlay winners hardest — one documented bettor was cut to **$3.63 max on player props** the day after a win. Real money on a real edge means sharper books (Circa, Pinnacle, BetOnline, Bookmaker) and bankroll/account discipline, not DraftKings forever.

So: the "elite big bets on Twitter" are real *as a structure* and fake *as a free-money promise*. Built right, on +EV legs with correlation modeling, multi-leg plays are a legitimate high-variance edge. Built as random lotto stacks, they're the single most profitable product the book offers — for the book.

---

## 1. How correlated parlays actually work (the core method)

**The retail mistake:** `P(all win) = p₁ × p₂ × … × pₙ`. This is only correct if legs are **independent**. Within one game they never are, so multiplication mis-prices the parlay — too *generously* for positively-correlated legs (your opening), too *stingily* for negatively-correlated ones (a trap).

**Correlation between two binary legs:** `ρ = [P(X=1,Y=1) − P(X=1)P(Y=1)] / √[P(X=1)P(X=0)P(Y=1)P(Y=0)]`. Sports range ≈ **−0.4 to +0.6**.

**The three methods books use (and you can use):**

- **(a) Gaussian copula** — keep each leg's marginal probability, inject a dependence structure. Map each leg to a latent normal `Zᵢ = Φ⁻¹(pᵢ)`, treat `(Z₁…Zₙ) ~ MVN(0, R)` with correlation matrix `R`, then joint win prob = fraction of correlated draws where every `Zᵢ > Φ⁻¹(1−pᵢ)`. Implement with a Cholesky of `R` + Monte Carlo.
- **(b) Empirical frequency** — count how often the exact combo hit in comparable historical games. No distributional assumption; data-hungry for rare combos.
- **(c) Full Monte Carlo game simulation (the production approach, and the best fit for you)** — simulate thousands of correlated box scores, then **price ANY parlay by filtering**: `P(parlay) = (# sims where all legs hit) / (total sims)`. This automatically captures *every* mechanical link (a HR is ≥4 total bases; a dominant pitcher suppresses every opposing hitter; lineup-order RBI chains) with no correlation coefficient to estimate. Vendors (Huddle) run exactly this on a columnar DB (DuckDB) and filter the sim set per market.

**The worked number that recurs everywhere** (Wizard of Odds, 3-leg NFL SGP): independence says 0.583 × 0.524 × 0.524 = **16.0%**; the copula/empirical truth ≈ **21.2%** — correlation lifts the real joint probability **~33%**. If a book paid the "independent" +600 on a true 21.2% event, bettor EV = **+48.4%**. *That is why books no longer let you freely parlay correlated legs* — they bake the correlation in (offer ~+350 instead, restoring a ~15% house edge).

**Positive-correlation structures to model (your opening), by sport:**
- **MLB:** pitcher Ks over + game-total under + opposing-batter unders (one dominant start drives all three); stacking multiple opposing hitters' overs vs. a weak starter; a hitter's HR + that hitter's total-bases over (mechanically linked); consecutive batters in the order (on-base → RBI).
- **NBA:** a scorer's points + made threes; star points over + team-total over; a playmaker's assists + a teammate's points.

**The negative-correlation TRAP (must encode the sign):** pitcher Ks over + an opposing hitter's hits/TB over *fight each other* — they're negatively correlated; parlaying them is strictly worse than betting them separately. DFS sites hard-block this (PrizePicks won't allow a starting pitcher's prop with opposing-team batter props in one entry).

**Where the residual edge lives today:** books price positive correlation well now, so the exploitable gaps are (1) combos **more correlated than the book modeled**, (2) **negatively-correlated** combos the book *over*-adjusts, (3) **cross-game** combos that are genuinely independent (standard parlay math, no SGP tax), and (4) soft/early/niche markets before limits hit. The honest reality (Mahomes conditional-parlay case study): even a *correctly* identified correlated SGP is often still −EV after the book's 15–25% adjustment. The win is selectivity, not volume.

---

## 2. Where the edge actually is — and the EV math

**Why books push parlays — the hold compounds (hard regulated data):**
- Single bet at −110/−110: hold **~4.5%**.
- Nevada, 1984–present: house wins **~30.9%** of parlay money vs **~5.6%** of all other sports bets — a 5× multiple sustained 40 years.
- New Jersey, Sept 2024: parlay hold **24.2%** vs **4.6%** single-event — and parlays were **72.5% of total sportsbook revenue** on a minority of handle.
- Mechanism (Ed Miller reframe): a parlay isn't higher-vig *per dollar at risk in sequence* — it's a **bet-more product**. A 3-leg $10 parlay re-bets your winnings at vig three times; viewed as one stake that's a ~12.5% edge, viewed as rollovers it's the same ~4.5% three times. Both reconcile to the same dollar loss.

**The single unifying principle:** *compounding only helps you if each leg is already +EV.* Vig compounds against −EV legs; edge compounds for +EV legs.

**The legitimate +EV angles (ranked by how buildable they are for you):**
1. **Provably +EV individual legs, then compounded.** If each leg beats the no-vig fair line (say true 55% vs implied 52.4%), the parlay's percentage edge is *larger* than either single — at the cost of variance (a 6-leg at true 55% hits only ~2.8%). **This is your BAND scorer's whole job.**
2. **Correlation the book prices as independent** (§1). The cleanest structural edge; requires a correlation/simulation model.
3. **Stale/slow lines** — a leg goes +EV when the book hasn't moved on news a sharp book (Pinnacle) already reflects. Window: minutes.
4. **Cross-book line shopping per leg** — build each leg at its best price across your books; you already pull 7.
5. **Boosts / promos / bonus bets — the most reliable +EV path.** Odds boosts are +EV *only* when boosted price > no-vig fair price (≈half are fake — check each). Bonus/"risk-free" bets are worth ~**70% of face** (winnings only, not stake); sharps convert them by placing on a longshot and hedging on a second book to lock ~70%+ as cash. This is matched-betting arithmetic, not gambling.

**The counterpoint you must respect:** "just parlay my best picks" is usually still −EV because (a) most picks aren't actually +EV, and (b) the SGP correlation-adjusted hold (15–25%) is so high it eats most edges. Wizard's rigorous result: **three +EV picks as separate singles cost ~7× less EV than the same three folded into one SGP** (−$0.22 vs −$1.49 on identical $10 stakes). **Never auto-bundle without an explicit correlation or boost model.**

---

## 3. The lotto reality + the limiting wall (operational truth)

- **Survivorship bias** is the core illusion (the 6.6% coin-flip stat; the 120-tipster +17.4%→+1.1% regression). The tell: cards posted after tip-off, "100% on longshots," green-day fanfare with silence on red days.
- **What genuinely profitable bettors do differently:** track **Closing Line Value (CLV)** not W/L (beating the closing number is the real skill signal — you already run a CLV loop); rarely sell picks (a real main-market edge is worth six figures, so selling it for a Discord sub is a red flag); line-shop 5+ books; bet small fractions on illiquid markets; respect line moves.
- **The limiting/banning reality (this gates real money):** the business is a tiny tail — pre-acquisition PointsBet's VIPs were **0.5% of customers but >70% of revenue**. Books limit on **predicted CLV**, not just realized profit (Massachusetts data: ~0.5% of bettors limited, props hit hardest). Documented: Beau Wagner cut to **$100 max NBA / $3.63 player props** the day after a win. **Props and parlays get limited first** because they're low-liquidity. Winners last longer by betting big/liquid markets, rounding stakes to look recreational, and moving to **sharper books that welcome winners (Circa, Pinnacle, BetOnline, Bookmaker)**. Multiple-accounting is what some do but violates terms / sometimes law — flagged, not recommended.

---

## 4. Bankroll & staking (the math that keeps you alive)

**Kelly:** `f* = (b·p − q) / b`, where `b` = decimal odds − 1, `p` = your true win prob, `q = 1−p`. If `f* ≤ 0`, **don't bet**.

**Worked longshot (+800, decimal 9.0):** market-implied ≈ 11.1%; if you estimate true 13%: `f* = (8·0.13 − 0.87)/8 = 2.13%` full Kelly. **Quarter Kelly ≈ 0.53%** (~$5 on a $1,000 roll). Note the hypersensitivity: if your true edge is actually 11.5% (not 13%), `f*` collapses to ~0.4%. **Overestimating longshot probability is the fastest way to overbet** — the payout multiplier amplifies estimation error.

**Why fractional Kelly is non-negotiable:** full Kelly has a **1/3 chance of halving the bankroll before doubling**; half Kelly drops that to **1/9** while keeping ~75% of the growth at ~50% of the variance. Bet **2× optimal Kelly → long-run growth is exactly zero**; more → negative *despite a real edge*. Pros run **¼–½ Kelly + a hard 2–3% per-bet cap**, and skip anything under ~0.5–1% adjusted Kelly.

**For simultaneous bets:** `n` independent live bets → scale each to `1/√n` of full Kelly (4 at once → half; 16 → quarter). **Correlated** props (same game) must be cut further — "5% on 10 same-game props" is really ~15.8% Kelly of single-bet risk. The rigorous multi-bet reference is **Busseti–Ryu–Boyd, "Risk-Constrained Kelly Gambling" (arXiv:1603.06183)** — convex optimization over many correlated bets, pairs with `cvxpy`.

---

## 5. Market-specific edges (where to find the +EV legs)

- **MLB home runs (multi-HR parlays):** **barrel rate** is the single best predictor (~**50% of barrels become HRs; ~86% of HRs were barrels**; barrel = ≥98 mph EV in the right LA window). Bands: ≥15% elite, 10–15% good, ~6–7% league avg. Build per-PA HR prob from barrel/xHR adjusted for **park factor** (swings expected HR **+15–30%** a night), **opposing pitcher HR/9**, **platoon handedness**, and **weather** (wind-out + heat ≈ +20 ft carry). Source: **Statcast / Baseball Savant** has xHR, a "would-it-be-a-HR-in-all-30-parks" tool, and a park-factors leaderboard. Multi-HR: same-lineup hitters are positively correlated (model jointly), but books pre-price it → **cross-game HR combos** are the cleaner edge.
- **NBA first-basket scorer:** true-probability ceiling for the best stack-up is only **~16–18%**; hold is high (8–15%). True prob ≈ `P(win tip) × P(player is opening-play target | possession) × P(make)`. The **most underpriced input is opening-play design** — teams script the first possession for the same player and books lean on coarse historical FB rates. Lines move hard in the **30 min pre-tip** on lineup confirmation. High variance (+700 to +2000), so size tiny.
- **NBA made threes:** project `3PA × 3P%`, pace/total-adjusted, matchup-adjusted (defense-vs-position is *style-specific* — match the player's shot profile to the defensive leak). **Recent-form is a trap:** lines rise after hot streaks; weight true-talent 3P% heavily, recent form lightly (a 45%-from-3 stretch on a 36% career mark regresses).
- **MLB hits / total bases:** **platoon handedness is the most durable edge** (~47 OPS points same- vs opposite-handed; ~**+0.15 TB** over the posted line vs opposite-handed pitching). Use **rolling 4-week** rates, not season averages. Total bases has wide dispersion → line-shop hardest here.

---

## 6. The build stack (real repos / libraries / papers)

- **Count distributions → ladders:** MLB/NBA counts are **overdispersed** — use **Negative Binomial (with zero-inflation for the empty-game tail), NOT Poisson** (Dolinar/FanGraphs for MLB runs; Binomial Basketball for NBA scoring; Kim et al. 2024 ZINB for MLB). A **ladder is just the survival function**: `P(X ≥ k) = scipy.stats.nbinom.sf(k−1, …)` across thresholds. No special "ladder" library exists or is needed.
- **Margins / two correlated counts:** Skellam (Karlis–Ntzoufras 2009), bivariate Poisson (Karlis–Ntzoufras 2003), Dixon–Coles 1997 (the most-cited applied betting paper; Poisson + low-score correlation correction).
- **Correlated multi-leg simulation:** no open-source book-grade copula pricer exists (it's proprietary; DraftKings' patents 11,657,680 / 12,002,332 describe the method). The open path is **simulate** — NBA: `scottwillson/play-by-play` (Markov PBP sim), `tony-mtz/nba-simulation` (possession-level box lines); MLB: `bdilday/pybbda`, `calestini/markov-baseball` (24-state base-out Markov sims). Then filter the sim set per parlay.
- **Betting math utilities:** `sedemmler/WagerBrain` (odds conversion, implied prob, EV, Kelly, parlay payouts); `DavidLevy310/Sportsbook-Parlay-Simulator` (parlay PnL × probability distribution).
- **Kelly portfolio:** Busseti–Ryu–Boyd (arXiv:1603.06183) + `cvxpy`.
- **Data backbone (highest value):** MLB `jldbc/pybaseball` (Statcast/BRef/FanGraphs) + Retrosheet; NBA `swar/nba_api` + `vishaalagartha/basketball_reference_scraper` + `wyattowalsh/nbadb`. Odds: The Odds API (you already use it).
- **Market-efficiency context:** inefficiencies found in NFL/NCAAF/NCAAB **and MLB**, but *not* NBA/NHL (2022 study) — prioritization signal: **MLB props are more findable than NBA**, which also matches your operator note that MLB is the more provable calibration sport.

---

## 7. Prioritized build plan — what to add to THIS engine

You already have: a prop-scoring engine with `pred.stats[family]{floor, mostLikely, ceiling, ladder}`, a now-honest per-odds-bucket tier (post-R2), a CLV loop, The Odds API across 7 books, and the archetype/tier doctrine. Build in this order:

1. **Ladders done right (T2 MVP).** Replace/upgrade the `ladder` field to a **fitted Negative-Binomial survival function** per player-family — real `P(player ≥ k)` at each rung (threes, hits, total bases, HR). One sport, one family first (MLB total bases or NBA threes) to prove the surface. *Validate against realized hit rates before trusting it.* This is the per-rung probability you've wanted since day one.
2. **Correlation engine.** Start with a **Gaussian copula over legs** using an empirical correlation matrix from your own graded history (you have the ledger). Output: correctly-priced joint probability for any 2–4 leg combo, with the **negative-correlation sign enforced** (pitcher-K vs opposing-hitter overs must *lower* joint prob). Later, graduate to a Monte-Carlo box-score simulator and price by filtering.
3. **Parlay constructor + EV gate.** Given ladders + correlation, enumerate candidate milestone parlays, compute true joint prob, de-vig the book's offered parlay odds, and **surface only +EV or boost-overlaid combos**. Hard rule baked in: never bundle correlated legs without the model; default to separate singles otherwise (the 7×-EV result).
4. **Fractional-Kelly staking module.** Size every play at **¼–½ Kelly, 2–3% hard cap, `1/√n` for simultaneous bets**. Surface the stake, not a payout screenshot. (WagerBrain math; Busseti–Ryu–Boyd for the portfolio version.)
5. **+EV leg models that feed the parlays.** Barrel-rate/xHR HR model (pybaseball/Statcast), platoon-split TB, first-basket opening-play model, threes with true-talent regression. These manufacture the +EV legs steps 1–4 depend on.
6. **Execution reality.** Keep modeling on The Odds API, but for *placing* real winning bets plan for sharper books (Circa/Pinnacle/BetOnline) + bankroll/account discipline — retail books will limit a working prop model fast.

**The honest framing to hold onto:** steps 1–5 don't make parlays magically +EV. They make it *possible* to find the rare ones that are, size them so variance doesn't bust you, and stop auto-bundling into the book's highest-hold product. That is the difference between the engine you're building and the Twitter screenshots — and it's the only version that makes money over a season instead of one lucky slip.

---

## Sources

**Correlation / SGP pricing:** Wizard of Odds (mathematics of correlation; copula + empirical worked examples; 15–25% SGP hold) · Analytics.bet (Buchalter, Mahomes correlated-parlay conditional EV) · Huddle (Monte-Carlo + OLAP SGP architecture) · Boyd's Bets (historical correlated-cover %s) · OddsJam (sport-specific positive/negative examples; PrizePicks block) · DraftKings patents US 11,657,680 / 12,002,332.

**Parlay economics:** Unabated (Ed Miller reframe) · OddsJam (compounding +EV math) · BettorEdge / Washington Post (Nevada 30.9%, NJ 24.2% / 72.5% revenue) · Establish The Run (parlay math) · OddsJam (odds-boost / bonus-bet conversion).

**Lotto reality / limiting:** Establish The Run (6.6% coin-flip; who-to-trust) · Pinnacle/Buchdahl (120-tipster regression) · Washington Post (Beau Wagner $3.63 props) · Huddle Up/Pompliano (PointsBet 0.5%→70%) · ESPN / Mass Gaming (CLV-based limiting) · betstamp (scam tells).

**Kelly / staking:** Wizard of Odds (variance & bankroll for props — Kelly, risk-of-ruin, 1/√n) · Busseti–Ryu–Boyd arXiv:1603.06183 · Wharton (Beggy 2023, longshots → faster ruin).

**Distributions / repos / data:** Dolinar (FanGraphs NBD for runs) · Binomial Basketball (NBA NBD) · Kim et al. 2024 (ZINB baseball) · Karlis–Ntzoufras (Skellam / bivariate Poisson) · Dixon–Coles 1997 · `pybaseball`, `nba_api`, `pybbda`, `WagerBrain`, `scottwillson/play-by-play`, `calestini/markov-baseball`, Retrosheet, Statcast/Baseball Savant.

**Market-specific:** HeatCheckHQ / FirstBasketStats / BettingPros (first basket) · Statcast park factors + xHR (HR) · The Best Bet on Sports (platoon splits) · Propeller Picks / BettingPros DvP (threes).
