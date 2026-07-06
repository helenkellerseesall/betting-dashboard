# Repo State & Strategy Deep-Dive — Where This Really Is, and the Realistic Path to Real Money

**Date:** 2026-07-05 · **Author:** Claude-C (research chat, Fable 5) · **Mandate:** the 5 OPEN STRATEGIC QUESTIONS in `docs/STATE_AND_STRATEGY_2026-07-05.md`.
**Source tags:** [REPO] = measured from this repo tonight (probe/file/commit named) · [PRAC] = practitioner web source · [AUTH] = authoritative/primary source. Confidence labeled HIGH/MED/LOW per claim. No number in this doc is fabricated; each traces to a tag.

---

## 0. Bottom line up front

The repo is an unusually good **measurement instrument** that has never placed a bet. It can capture 7 books, self-grade ~25k predictions, calibrate honestly, and stamp CLV — and it has **zero live bets, zero calibrated-era record, and no demonstrated edge** [REPO]. The honest strategic read: the modeling edge is thin-to-unproven and will stay hard to prove; the **verified live record itself is the most valuable asset this repo can produce**, because it is the prerequisite for BOTH endgames (grinding stakes and selling to an audience). Everything in "do this next" (§7) is ordered around producing that record as fast and as honestly as possible.

Three findings that should change how we operate:

1. **The "7 books" are really ~2–3 independent prices.** DraftKings, Caesars, and BetMGM outsource prop-line origination from the same source; FanDuel originates its own numbers ([Establish The Run](https://establishtherun.com/understanding-the-current-ecosystem-of-nfl-player-props/) [PRAC], HIGH). Our consensus de-vig and line-shop logic weight books as if they were independent samples. They are not. FanDuel-weighting (already our practice) was directionally right; §3 makes it structural.
2. **The limit problem is partially obsolete.** CFTC-regulated exchanges/prediction markets (Novig, ProphetX, Sporttrade, Kalshi) matured in 2025–26; peer-to-peer venues have no directional position and don't limit winners ([XCLSV](https://xclsvmedia.com/novig-review-2026-peer-to-peer-sportsbook-sharp-bettors/), [Legal Sports Report](https://www.legalsportsreport.com/prediction-markets/prophetx-promo-code/) [PRAC], MED — props coverage is still thin there). Retail-book limits cap the grind, but they no longer cap the *ceiling* the way our doctrine assumes.
3. **Our self-grader is currently grading the wrong surface.** G1 calibration drives board selection (verified live, commit aa15d61) but the served/tracked best-available surface still carries raw probability (CB re-scope, commit 3b15fc0) [REPO], HIGH. Until that's closed, no record we accrue is a record of the calibrated system. This is the hard blocker in front of everything else.

---

## 1. Where the repo actually is (measured tonight, not narrated)

- **Settled model predictions:** 25,101 rows across 24 `mlb_tracked_bets_*.json` files; 3,004 won / 22,097 lost = **12.0% hit rate** [REPO: probe over `backend/runtime/tracking/`, 2026-07-05]. The low hit rate is expected — the tracked corpus is dominated by high-odds tail overs — but it means raw hit% is meaningless as a trust signal; only calibrated-prob-vs-realized and CLV matter.
- **G1 calibration:** flipped ON 07-01; forward gate passed on 14 out-of-sample days — raw model ~26% claimed vs ~11% realized on overs; calibrated 10.6% vs 10.8% realized; Brier .102→.079; selection provably changed (OFF modelProb 0.42 → ON 0.14, stamped) [REPO: commits 4dca1ab, aa15d61; `docs/STATE_AND_STRATEGY_2026-07-05.md`], HIGH.
- **The gap:** calibrated prob does NOT reach `/api/best-available` → `tracked_best` → the 14-day self-grader [REPO: commit 3b15fc0], HIGH.
- **Forward CLV slices** (`backend/runtime/tracking/forward_clv_slices.json`, generated 2026-07-05) [REPO], HIGH:
  - rbis_low: forward meanCLV +0.28pp, n=133, pos-share 24.1% — verdict "hold"
  - mod_dog: +0.13pp, n=725, pos-share 11.3% — "hold"
  - low_conf: +0.15pp, n=1,258, pos-share 11.2% — "hold"
  - hits_low: n=23 — "too-thin"
  - Read honestly: mean CLV is barely positive and the **median tracked pick loses to the close** (pos-share ~11–24%). This is not yet an edge; it's a faint signal concentrated on obtainable low rungs, consistent with the 06-16 selection-edge finding.
- **Line-shop:** +1.2pp mean price improvement across 1,632 props (real, mechanical, repeatable) — but against de-vigged fair consensus, the best available price still averages **−2.9pp** on the 169 measurable props [REPO: same file], HIGH. Translation: shopping recovers vig; it has not yet found fair-value-positive prices at scale.
- **Live bets in the calibrated era: ZERO. Public verified record: none.** [REPO]
- **What the repo has that most solo operators never build** (for honest balance): 7-book odds capture with trueOpen 6 AM snapshots, nightly self-grading, isotonic calibration with a forward gate, a kill-switched shadow stack (NegBinom ladders, copula correlation, parlay constructor), screenshot OCR ingestion, and a CLV scoreboard. That inventory is the credibility engine for §5 — it is genuinely rare. What it is *not*, yet, is evidence of a betting edge.

---

## 2. Q1 — Is MLB props even the right surface?

**Ranking candidates by realistic edge × obtainability × limit-resistance × fit to what we've built:**

| Surface | Edge case | Against | Verdict |
|---|---|---|---|
| **MLB props (now)** | Deepest daily prop board in-season; no book can efficiently price the whole board, so books defend with low limits rather than sharp prices ([ETR](https://establishtherun.com/understanding-the-current-ecosystem-of-nfl-player-props/) [PRAC]); shared DK/Caesars/MGM origination creates cross-book divergence signals; morning-posted lines are softest early ([Covers](https://www.covers.com/guides/prop-betting), [OddsShopper](https://www.oddsshopper.com/articles/betting-101/sports-betting-prop-strategy-finding-player-prop-inefficiencies-y10) [PRAC]) | Low limits by design; higher prop juice than ever (−125 where −110 is fair, per [SportsLine](https://www.sportsline.com/guides/props/) [PRAC]); our own data shows no fair-value edge yet | **Keep as primary. It's in season, it's what we've built, and its inefficiency is real — the constraint is limits, which caps the grind but not the record.** |
| **MLB derivatives (F5, team totals, alt lines)** | Derivative lines are "calculated mechanically" from main markets and openers are weak ([Predictem](https://www.predictem.com/betting/strategy/betting-derivatives/), [Issuu/The Logic of Sports Betting](https://issuu.com/sbc.global/docs/the_logic_of_sports_betting_v1_0_5/s/12292357) [PRAC]); F5 is pitcher-driven — the exact families our model is strongest on (29 pitchers/57 starts of real gamelogs) | Still limited; a new market family to grade | **Add as an attach to the pitcher model — same thesis, different (softer) market.** MED |
| **WNBA props (in season NOW)** | Materially softer than NBA: wider lines, thinner sharp coverage, DK carries the deepest board ([Betstamp guide](https://www.betstamp.com/education/wnba-betting-strategy-guide) [PRAC]) | Tighter limits; winners stand out fast because almost everyone firing WNBA props is sharp [same source]; we'd need a WNBA data spine | **Second surface, worth a scoped pilot — our dormant NBA pipeline is the scaffold and it fills the NBA off-season.** MED |
| **NBA usage-redistribution (Oct+)** | Still the #1 codifiable news edge; props move minutes after role news and slow books lag ([nba-prop-bets.com](https://nba-prop-bets.com/articles/how-nba-injuries-impact-prop-bets/), [OddsIndex](https://oddsindex.com/guides/nba-player-props-guide) [PRAC]) | Off-season until October | Queue for October; don't build now. |
| **MLB live/in-game** | Argued the most exploitable in-play market 2026 — slow, mechanical plate-appearance pricing ([XCLSV](https://xclsvmedia.com/mlb-live-betting-strategy-2026-how-sharp-bettors-beat-the-books-during-baseball-games/) [PRAC]) | Requires latency infrastructure we don't have; single-source claim | Not now. LOW |
| **DFS pick'em (PrizePicks/Underdog)** | Soft lines on niche slates linger ([PropsBot](https://propsbot.ai/prizepicks-vs-underdog/) [PRAC]) | Structural house edge is brutal: 4-pick power play ≈ 37.5% before you start [same source]; they also restrict winners | Only ever 2–3-pick plays on independently-verified soft lines; not a pillar. LOW |
| **Exchanges/prediction markets (Novig, ProphetX, Sporttrade, Kalshi)** | No limiting of winners (peer-to-peer, no directional book position); ~1–2% commission vs 4.76–30% hold ([XCLSV](https://xclsvmedia.com/best-sharp-friendly-sportsbooks-2026-where-bet-when-limited/), [Kalshi](https://kalshi.com/category/sports/all-sports/all/props) [PRAC/AUTH]) | Thin prop coverage; heavily banded contracts; state availability varies (Kalshi restricted in 9 states as of May 2026); CFTC has proposed barring some prop-type contracts ([ESPN](https://www.espn.com/espn/betting/story/_/id/49019930/cftc-proposes-rules-limiting-prediction-markets-kalshi-sports) [AUTH]) | **Not a modeling surface — a routing/execution venue and the long-term answer to limits. Verify operator's state access (op task).** |

**Answer: yes, MLB props remains the right primary surface for now** — not because it's the most beatable in the abstract, but because (a) it's in season, (b) the infrastructure exists and is verified, (c) its inefficiency (limits-instead-of-sharp-prices) is documented, and (d) every alternative either isn't live (NBA), needs a new spine (WNBA), or isn't a modeling surface at all (exchanges). The correction is **structural, not directional**: treat the board as ~2–3 independent price sources, attach derivatives to the pitcher model, and route execution toward the least-limited venue available.

---

## 3. Q2 — Are we scoring the right thing?

Short answer: **no — and the repo's own data has been telling us this since June 16.** Re-point selection to CLV-first/line-shop-first now, with calibrated probability as the honesty *gate* rather than the ranking *signal*.

The case, in order of evidence strength:

1. **[REPO, HIGH]** Our calibrated-prob-vs-line signal has never produced positive realized ROI. The in-sample +EV gate selected −17% singles / −42% parlays (MASTER_BRAIN, T2-Parlay-1A). The 06-16 CLV-backed finding: CLV sorts realized ROI monotonically (+38/−8/−34% across CLV terciles) and the CLV+ signal lives on obtainable low rungs the frozen selection avoids (memory: `project_selection_edge_target`, grounded in the graded ledger). Tonight's forward slices confirm the same shape at small magnitude (§1).
2. **[PRAC, HIGH consensus]** CLV is the industry's accepted leading indicator of long-run profit — the Pinnacle finding that positive-CLV bettors were almost universally profitable and negative-CLV bettors almost universally not ([Pinnacle](https://www.pinnacle.com/betting-resources/en/educational/what-is-closing-line-value-clv-in-sports-betting) [AUTH], [Sharp Football Analysis](https://www.sharpfootballanalysis.com/sportsbook/clv-betting/) [PRAC]). Prop markets specifically allow outsized CLV because they're less efficient ([BettorEdge](https://www.bettoredge.com/post/what-is-closing-line-value-in-sports-betting) [PRAC]).
3. **One honest caveat [MED]:** prop CLV at soft books is a weaker truth-signal than sides/totals CLV, because the "close" you're beating is itself a low-limit retail price, and part of measured CLV is vig recovery rather than fair-value edge — our own −2.9pp fair-edge number (§1) demonstrates exactly this. So: CLV-first selection, but graded against **de-vigged, origination-weighted** consensus (FanDuel independent; DK/Caesars/MGM cluster counted as ~one source [PRAC: ETR]), median-centered per the 06-17 benchmark verdict. That upgrade turns our CLV from "beat a soft close" toward "beat the best fair estimate available."
4. **Microstructure supports the same re-point [PRAC, MED]:** daily-sport props post the morning of the game; early lines are soft with low limits and get corrected fast once respected action arrives ([Covers](https://www.covers.com/guides/prop-betting), [OddsShopper](https://www.oddsshopper.com/articles/betting-101/sports-betting-prop-strategy-finding-player-prop-inefficiencies-y10)). The exploitable moment is the **morning window**, not the close. R1's 6 AM trueOpen capture was built for precisely this; it's currently a measurement tool — it should become the selection trigger.

**What calibrated probability is still for:** the gate. It killed a fake +16pp edge and stops us betting the model's overconfident tail (the FLB trap the longshot doc hardcodes). A pick should require calibrated-EV-not-terrible AND rank by expected/realized close-beat. That is a re-ordering of the existing pieces, not a new model — and it does not need to wait for G2/G3/G4.

---

## 4. Q3 — The single most exploitable, repeatable niche to own

**The MLB pitcher-prop morning window.** One sentence: *be earliest to the softest mechanically-priced pitcher numbers, sized small, at the best of ~3 independent prices, every single slate.*

Why this niche beats the alternatives we considered (HR longshots, SGP correlation, live betting, pick'em):

- **It's daily and structural, not situational.** Pitcher K/outs/walks/ER lines post every morning, are lineup-independent (bettable before lineups), and our pitcher data is the deepest real data we have (29 pitchers / 57 starts of gamelogs; the 5 pitcher families already captured at 6 AM by R1) [REPO, HIGH].
- **The pricing structure is documented soft.** Boards too large to price efficiently; low limits instead of sharp lines [PRAC: ETR]; early lines softest [PRAC: Covers/OddsShopper]; DK/Caesars/MGM share origination so genuine disagreement between FanDuel and the DK-cluster flags a mispricing candidate [PRAC: ETR, HIGH].
- **It compounds with everything already built or staged:** trueOpen capture (R1) → divergence detection (line-shop stack) → calibrated tail gate (G1, live) → NegBinom K-ladders (G2, shadow) → F5/team-total derivative attach (§2) → CLV stamp (live scoreboard).
- **Its weakness is known and priced in:** pitcher-prop limits are low, so the niche produces a *record and a process*, not big dollars. That's acceptable because the record is the asset (§5).
- **SGP correlation mispricing is NOT the niche**, despite the parlay-craft vision: 2026 SGP holds run 20–30% and books' correlation engines have matured; residual mispricings are rare, transient, news-driven ([OddsIndex](https://oddsindex.com/guides/same-game-parlay-correlation), [tech-insider](https://tech-insider.org/sports-betting/parlay-betting-explained/) [PRAC], MED-HIGH). Parlay-craft stays a *product feature* (obtainable ladders, cash-out math for the app's user) — not the operator's edge.

**The guaranteed-EV floor that isn't modeling at all:** promo/boost harvesting. Profit boosts and bonus-bet offers are deterministic +EV when applied correctly (boost on an already-fair bet; bonus bets on high-odds markets) and 2026 books still shower them — e.g. 10×100% profit boosts for a $10 deposit at Caesars ([Covers bonuses](https://www.covers.com/betting/bonuses), [North Penn Now](https://northpennnow.com/news/2026/feb/23/how-sportsbook-promos-can-boost-your-betting-value/) [PRAC], HIGH for the mechanism). For a small bankroll this is likely the largest *certain* dollar stream available in year one, and the repo can price every boost against our de-vig fair automatically. It's unglamorous; it's also how small sharp bettors actually eat.

---

## 5. Q4 — Grind vs audience/selling: the honest endgame

**The economics are lopsided and worth stating plainly.**

- **Grind ceiling [PRAC, HIGH]:** prior research (06-28 game plan, cross-corroborated) — realistic 4–10% ROI on turnover, provable only over 300–500+ bets, on stakes that get limited within weeks-to-months precisely when you win. Modest bankroll → tens-to-low-hundreds of dollars/month. Exchanges raise this ceiling somewhat (no limits, ~1–2% commission) but thin prop liquidity caps volume there today [PRAC: XCLSV/LSR].
- **Audience economics [PRAC, HIGH]:** pick-selling Discords charge $15–$400/month; established groups run $25–$60/month with thousands of members; All In Abe — the operator's own aspiration screenshot source — is 100K+ followers on X and a 7,000+ member Discord launched in 2023, selling access, where the posted bets function as marketing ([Whop review](https://whop.com/blog/all-in-abe-review/), [Whop guide](https://whop.com/blog/sell-sports-picks/), [Bet Hero](https://betherosports.com/blog/sports-betting-discord-monetization) [PRAC]). Even 200 subscribers at $30/month is $6k/month — an order of magnitude above the realistic grind on a small bankroll, and **books cannot limit an audience business**.
- **The market's credibility bar has risen — in our favor [PRAC, HIGH]:** third-party verified records are now table stakes. Pikkit syncs bets automatically and disallows manual entry, so a public Pikkit record is auditable by construction; Betstamp verifies a pick only if the odds were actually available when tracked ([Pikkit](https://pikkit.com/follow-bettors), [Betstamp](https://betstamp.com/tutorials/track-bets) [PRAC]). "No verified auditable record = red flag" is now standard consumer advice ([Betsmart](https://www.betsmart.co/tool-reviews/pikkit) [PRAC]). A rigorously honest operator with a real-time public record and plain-English reasoning per pick is *differentiated* in a market of survivorship-bias screenshots — and rigorous honesty is the one thing this repo enforces by doctrine.

**The honest answer: it's not either/or, and the order is fixed.** Both endgames require the same first artifact — a live, externally-verified, CLV-stamped record of real bets. The grind needs it to justify scaling stakes; the audience business needs it as the product. Build the record first at small stakes; the 90-day checkpoint (~300 bets, per the established cadence) tells you which door is open:

- CLV green + ROI positive → scale the grind AND start publishing (they compound: the public record is content).
- CLV green + ROI flat → the audience path is still viable ("process-verified, variance-honest" is a sellable identity) and the grind isn't dead, just slow.
- CLV flat/negative → **say it plainly and do not sell picks.** Selling a record that isn't there is becoming the thing our own research documented as survivorship marketing. The wellbeing guardrail from the state doc binds here: no life decisions on betting hope, and no monetizing an edge we haven't shown.

**What the repo must build for the audience path (small, mostly done):** (a) route every real bet through a public Pikkit/Betstamp profile — external verification beats anything self-hosted, zero build; (b) a public read-only CLV/record page (the /status CLV cards are 90% of this); (c) share-card output for picks with the four-question plain-English reasoning (the Law 30 frame IS the content format); (d) keep the never-fabricate doctrine absolute — it's the moat.

---

## 6. Q5 — What we're NOT looking at

Ranked by how much it could matter:

1. **Origination structure of our own consensus [HIGH, actionable now].** DK/Caesars/MGM = one origination source; FanDuel = independent [PRAC: ETR]. Our de-vig consensus, line-shop edge, and CLV baseline all currently treat books as independent. Weighting by origination cluster is a small change to `forward_clv_slices`/benchmark math that makes every downstream number more honest.
2. **Exchanges/prediction markets as execution venue [HIGH, op task first].** Novig/ProphetX/Sporttrade/Kalshi don't limit winners; fees ~1–2%; prop coverage thin but growing; regulatory posture in flux (Third Circuit ruled sports event contracts are CFTC-preempted swaps, April 2026; CFTC has proposed barring injury/prop-type contracts) ([ESPN](https://www.espn.com/espn/betting/story/_/id/49019930/cftc-proposes-rules-limiting-prediction-markets-kalshi-sports), [DeFi Rate](https://defirate.com/news/novig-receives-cftc-approval-as-prophetx-launches-sports-prediction-markets-days-after-designation/) [AUTH/PRAC]). **First step is not code: confirm which venues the operator's state allows.** Nothing in the repo records this.
3. **Promo/boost EV engine [HIGH].** Free money we don't compute. §4.
4. **The tracked-surface gap [HIGH, already scoped].** Our own self-grader measures a surface the calibration never touched (3b15fc0). Every day it stays open, the "14-day verify" accrues evidence about the wrong system.
5. **WNBA as the summer surface [MED].** In season now, softer than NBA, DK deepest board [PRAC: Betstamp]. Fills the exact seasonal hole (NBA off-season) our roadmap has.
6. **Pre-6AM/overnight line capture [MED].** R1 captures at 6 AM; several books post overnight. The earliest price is the softest [PRAC: Covers]. Cheap extension of R1 — verify earliest reliable posting hour, which R1's builder already flagged as unverified.
7. **F5/derivative attach [MED].** §2 — mechanically-priced derivatives of a market we already model.
8. **Twitter/screenshot corpus as market-psychology data [LOW-MED].** The 61 `hr_slips_*.json` files show exactly what the aspiration pattern is (LOTTO-tagged +650 HR clusters with "positive betting edge" reasons) [REPO]. The right use is the one already doctrined: hype-vs-edge detection and public-bait fading — plus §5's insight that this content *format* (big clean multi-leg cards with reasons) is what audiences buy. Not a betting signal.
9. **What we should explicitly STOP looking at:** single sharp prop line to copy (settled: doesn't exist, 06-17); SGP correlation as an edge (§4); live in-game betting (infrastructure we don't have); any "hit it big once" engineering (the state doc's ~1-in-2,200 lottery math stands).

---

## 7. DO THIS NEXT (ranked; each names its blocker and its owner-chat)

1. **Close the served-surface gap** — inject calibrated modelProb + stamp at the best-available serializer (CB's re-scoped fix, diff-before-land, check PRESERVED). *Blocks: everything — no honest record can accrue until the surface the operator sees/bets/grades is the calibrated one.* [CB, days]
2. **Start the real-money micro-record** — small flat stakes, obtainable pitcher-family + CLV+ rungs only, best price of the ~3 independent sources, every bet mirrored to a public Pikkit or Betstamp profile from bet #1. Target ~300 bets by early September; 90-day checkpoint decides grind vs publish vs stop (§5). *Blocked by #1. The operator is the bettor; the repo supplies picks + stamps.* [Operator + CA process, starts this week]
3. **Re-point selection CLV-first** — rank by expected close-beat (trueOpen/9AM vs origination-weighted de-vig median), calibrated prob as gate not ranker; fold in the origination-cluster weighting (§6.1). The re-point spec was pre-written in the freeze docket; this supersedes waiting for G2–G4. *Not blocked; scoring change → operator approval + forward-gated like G1.* [CA spec → CB]
4. **Promo/boost EV module** — price every live boost/promo against our de-vig fair; surface as a daily "certain-EV" card. *Not blocked; additive.* [CB, small]
5. **Exchange/prediction-market access check** — operator confirms state availability for Novig/ProphetX/Sporttrade/Kalshi; if yes, add their prices to capture (routing venue, maybe better CLV benchmark). *Op task, then small CB add.* [Operator → CB]
6. **WNBA pilot** — scope what the dormant NBA pipeline needs to serve WNBA props (data source, family map). Research-first, no build commitment. [CC next pass, if operator wants the summer surface]
7. **F5/team-total derivative attach** — after G2/G3 graduate or as sanctioned shadow, derive F5 recommendations from the pitcher model. [Post-chain]
8. **Pre-6AM capture extension** — verify earliest reliable posting hour per book; move trueOpen earlier if real. [CB, small; pairs with R1's open verification item]

**What would make this plan wrong:** if 90 days of honest record shows flat-to-negative CLV on the re-pointed selection, the modeling thesis is exhausted on this surface — the remaining honest paths are the promo floor, the exchange venue, and building the app as a *product for other bettors* rather than an edge engine. That outcome is genuinely possible (call it 40–50% likely; the priors from our own graded data are mixed) — and it would still leave the operator with a rare asset: a provably honest, verified, self-grading betting intelligence system. That is worth owning either way.

---

## Sources

**Repo (measured 2026-07-05):** `backend/runtime/tracking/mlb_tracked_bets_*.json` (25,101 settled probe) · `backend/runtime/tracking/forward_clv_slices.json` · `docs/STATE_AND_STRATEGY_2026-07-05.md` · commits 4dca1ab / aa15d61 / 3b15fc0 / 214a321 · MASTER_BRAIN (T2-Parlay-1A validation) · `docs/research/` prior playbooks (06-11, 06-15 ×2, 06-29) · `hr_slips_*.json` (61 files).

**Web:**
- [Establish The Run — ecosystem of player props (origination structure)](https://establishtherun.com/understanding-the-current-ecosystem-of-nfl-player-props/) [PRAC]
- [Pinnacle — what is CLV](https://www.pinnacle.com/betting-resources/en/educational/what-is-closing-line-value-clv-in-sports-betting) [AUTH]
- [Sharp Football Analysis — CLV guide](https://www.sharpfootballanalysis.com/sportsbook/clv-betting/) · [BettorEdge — CLV in props](https://www.bettoredge.com/post/what-is-closing-line-value-in-sports-betting) [PRAC]
- [Covers — prop betting guide (posting timing)](https://www.covers.com/guides/prop-betting) · [OddsShopper — prop inefficiencies](https://www.oddsshopper.com/articles/betting-101/sports-betting-prop-strategy-finding-player-prop-inefficiencies-y10) [PRAC]
- [SportsLine — props guide (2026 juice)](https://www.sportsline.com/guides/props/) [PRAC]
- [XCLSV — MLB live betting 2026](https://xclsvmedia.com/mlb-live-betting-strategy-2026-how-sharp-bettors-beat-the-books-during-baseball-games/) · [XCLSV — sharp-friendly books 2026](https://xclsvmedia.com/best-sharp-friendly-sportsbooks-2026-where-bet-when-limited/) · [XCLSV — Novig review](https://xclsvmedia.com/novig-review-2026-peer-to-peer-sportsbook-sharp-bettors/) [PRAC]
- [Legal Sports Report — ProphetX](https://www.legalsportsreport.com/prediction-markets/prophetx-promo-code/) · [DeFi Rate — Novig CFTC approval](https://defirate.com/news/novig-receives-cftc-approval-as-prophetx-launches-sports-prediction-markets-days-after-designation/) [PRAC]
- [ESPN — CFTC proposed prediction-market rules](https://www.espn.com/espn/betting/story/_/id/49019930/cftc-proposes-rules-limiting-prediction-markets-kalshi-sports) [AUTH] · [Kalshi sports props](https://kalshi.com/category/sports/all-sports/all/props) [AUTH] · [CBS Sports — prediction markets 2026](https://www.cbssports.com/prediction/news/best-prediction-markets/) [PRAC]
- [Betstamp — WNBA strategy guide](https://www.betstamp.com/education/wnba-betting-strategy-guide) [PRAC]
- [OddsIndex — SGP correlation + calculator](https://oddsindex.com/guides/same-game-parlay-correlation) · [tech-insider — parlay hold 2026](https://tech-insider.org/sports-betting/parlay-betting-explained/) · [Wizard of Odds — SGP correlation math](https://wizardofodds.com/article/same-game-parlays-the-mathematics-of-correlation/) [PRAC]
- [nba-prop-bets.com — injuries and props](https://nba-prop-bets.com/articles/how-nba-injuries-impact-prop-bets/) · [OddsIndex — NBA props guide](https://oddsindex.com/guides/nba-player-props-guide) [PRAC]
- [PropsBot — PrizePicks vs Underdog (house-edge math)](https://propsbot.ai/prizepicks-vs-underdog/) · [Unabated — pick'em breakeven](https://unabated.com/articles/art-and-science-of-dfs-pickem-strategy) [PRAC]
- [Covers — sportsbook promos July 2026](https://www.covers.com/betting/bonuses) · [North Penn Now — promo EV mechanics](https://northpennnow.com/news/2026/feb/23/how-sportsbook-promos-can-boost-your-betting-value/) [PRAC]
- [Whop — All In Abe review](https://whop.com/blog/all-in-abe-review/) · [Whop — selling picks guide](https://whop.com/blog/sell-sports-picks/) · [Bet Hero — Discord monetization](https://betherosports.com/blog/sports-betting-discord-monetization/) [PRAC]
- [Pikkit — follow bettors (verified records)](https://pikkit.com/follow-bettors) · [Betstamp — bet verification](https://betstamp.com/tutorials/track-bets) · [Betsmart — Pikkit review](https://www.betsmart.co/tool-reviews/pikkit) [PRAC]
- [Predictem — derivative markets](https://www.predictem.com/betting/strategy/betting-derivatives/) · [The Logic of Sports Betting (excerpt) — derivatives](https://issuu.com/sbc.global/docs/the_logic_of_sports_betting_v1_0_5/s/12292357) · [OddsIndex — F5 guide](https://oddsindex.com/guides/f5-betting-first-5-innings) [PRAC]
