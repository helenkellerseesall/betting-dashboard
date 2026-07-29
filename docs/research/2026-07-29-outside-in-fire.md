# OUTSIDE-IN FIRE — What the Best Documented Prediction Operations Do That We Don't

**Date:** 2026-07-29 · **Author:** Claude-C (research, Fable 5) · **Sources scoured:** documented-pro profiles, r/algobetting-class practitioner consensus, academic sports-forecasting lit (incl. 2025–26 arXiv), LLM-forecasting benchmarks, tout-industry patterns. **Extends** 07-05 deep-dive, 07-07 moonshot, 07-16 ingestion audit — no re-derivation. **Tags:** [REPO]/[AUTH]/[PRAC]/[PRIOR]; grades REAL/SPECULATIVE/FANTASY.

---

## 1. Modeling techniques we lack — graded

**1.1 Market-implied features (odds as model INPUT) — REAL, the biggest gap.**
Academic consensus: betting odds are the strongest single predictor of outcomes — stronger than rankings or public stats; odds-only models are the benchmark serious models must beat ([arXiv 2604.17194](https://arxiv.org/pdf/2604.17194) [AUTH]; [ResearchGate market-efficiency lit](https://www.researchgate.net/publication/276014117_Are_Sports_Betting_Markets_Prediction_Markets_Evidence_From_a_New_Test)). Our stack calibrates model-vs-outcome but never feeds the market's own probability INTO the per-player curves as an exogenous prior. Concrete, era-rule-safe upgrade (market prob is exogenous — no calibration-on-calibration risk): blend origination-weighted de-vig consensus prob into family curves as a shrinkage prior, weight fit forward. Maps directly onto the queued CLV-first re-point [PRIOR: 07-05 §3]. This is the one modeling idea here with both academic backing and an existing pipe.

**1.2 Derivative origination — REAL, independently validated by the best documented bettor.**
Voulgaris's core edge was exploiting books deriving half/quarter lines mechanically from game totals ([Wikipedia](https://en.wikipedia.org/wiki/Haralabos_Voulgaris), [Trademate profile](https://tradematesports.medium.com/nbas-greatest-ever-bettor-haralabos-voulgaris-from-pro-bettor-to-maverick-s-director-10-people-7f142bbf95dd) [PRAC]) — structurally identical to our F5/team-total attach thesis [PRIOR: 07-05 §2, ingestion audit §1]. Peabody likewise bets his own numbers into markets the book derives rather than originates ([TheLines interview](https://www.thelines.com/professional-sports-betting-journey-bettor-rufus-peabody-2022/) [PRAC]). Outside-in verdict: the F5 attach is not a nice-to-have; it's the documented-pro playbook applied to our sport. Stays sequenced behind/with G2.

**1.3 Ensembles — SPECULATIVE for us.** Academic gains over single well-calibrated models are marginal; the market benchmark is the hard bar, not model count. A solo operator's marginal hour goes to calibration + record, not a model zoo. Cheap variant worth maybe-one-day: an empirical-Bayes rate model as a sanity ensemble vote. Low priority, honestly graded.

**1.4 In-game/live priors — FANTASY for us.** Re-affirmed (speed infrastructure, solo operator) [PRIOR: 07-05 §6.9]. r/algobetting-class consensus agrees: live windows are ~seconds and "speed is everything" [PRAC: [SportBot arb roundup](https://www.sportbotai.com/blog/arbitrage-betting-reddit)].

**1.5 LLM-as-forecaster — FANTASY, now with a clean benchmark.** The 2026 World Cup contamination-free benchmark ran four frontier LLM agents (search-act-reflect, all 104 matches): they herded (same pick 92% of matches) and **none beat the market's Brier score** ([arXiv 2607.17765](https://arxiv.org/html/2607.17765v1) [AUTH]). LLM sentiment-as-feature adds marginal complement value at best ([IEEE hybrid study](https://ieeexplore.ieee.org/abstract/document/11415979/) [AUTH]). **LLM-as-structured-ingestion and as-explainer — REAL and already our pattern** (OCR adapter, plain-English WHY [REPO]): the upgrade is an LLM classifier on the Bluesky reporter feed (news → player/impact/severity tags → SCR surface), bounded, never forecasting [PRIOR: moonshot §1.5].

---

## 2. What actually made money (documented) vs folklore

**Documented money:** (a) **originate your own number, bet where the book derives** — Voulgaris derivatives, Peabody/Massey-Peabody own-model origination [PRAC above]; (b) **origination/steam information** — Spanky: books move on WHO bets, not size; his stated bar = CLV on 80%+ of bets ([The Ringer profile](https://www.theringer.com/2019/06/05/gambling/sports-betting-bettors-sharps-kicked-out-spanky-william-hill-new-jersey) [PRAC]); (c) **openers are measurably softer than closes** — academically confirmed (opening lines significantly less accurate, NBA) [AUTH via search: line-movement lit] — our morning-window niche is the retail-scale version of this; (d) **arbs/promos harvest real money until accounts die** — practitioner consensus: "profitable betting is a getting-limited business," 98% of arbs return <1.2%, windows ~13s [PRAC: SportBot/Wikipedia/Columbia scrape study].

**Folklore (graded FANTASY, resist forever):** public-stats ML models beating closers without market features; trend/"system" betting; sentiment pickers; LLM pickers (§1.5); staking schemes that create edge (they only reshape variance [PRIOR: parlay playbook §4]); "one weird prop the books forgot" as a repeatable business.

**The uncomfortable documented constant:** every winner in the record gets limited (Spanky's profile is literally a requiem for retail access). Longevity = origination quality + venue rotation + the audience asset books can't confiscate — all three already in our doctrine [PRIOR: 07-05 §5, moonshot §4]. Outside-in adds no new escape hatch; there isn't one.

---

## 3. The selling side — what separates monetizable records from noise

From verification-product mechanics + tout-pattern teardowns already cited [PRIOR: 07-05 §5 — Pikkit auto-sync/no-manual-entry, Betstamp odds-available verification, "no auditable record = red flag" consumer standard]:

What buyers of records actually price (each maps to a Daily 3 gap or asset):
1. **External verification** (not self-hosted claims) — Daily 3 is self-hosted today. Gap: mirror every locked pick to a public Pikkit/Betstamp profile at lock time. [REPO: Daily 3 locks at T-60 — the mirror hook is trivial]
2. **n and longevity** — 300+ graded picks / months, not weeks [PRIOR consensus]. Daily 3 at 3/day reaches n=300 in ~100 days: the record's calendar is the marketing calendar. No selling before the 90-day gate — unchanged guardrail.
3. **Losses shown as prominently as wins** — the tout signature is survivorship (deleted losers, screenshot wins [PRIOR: integrity docs; state-doc All-In-Abe verdict]). Our HONEST-COMMS surfaces + lifetime MY BETS + write-once locks [REPO: 680b164, 4efacb1] are *already* the differentiator — productize honesty: the public page leads with the full ledger, not highlights.
4. **A niche identity** — "MLB pitcher-prop morning window, calibrated + CLV-stamped" sells; "we pick games" doesn't [PRIOR: 07-05 §4].
5. **Process content cadence** — the nightly critic + archetype postmortems [REPO] are ready-made "why we won/lost" content; the bets are the marketing, the process is the product [PRIOR].

Grade: REAL as mechanics (all assembly, no new systems); the SELL decision itself stays gated on the record proving CLV/ROI — selling a proven-flat record is the tout move, and saying so is this doc's job.

---

## 4. TOP-5 DO-NEXT (mapped to existing pipes; chain still wins for CB-hours [PRIOR: ingestion audit])

1. **Market-prob-as-prior (§1.1)** → extends the queued CLV-first re-point; origination-weighted de-vig consensus as shrinkage prior in family curves; forward-gated like G1. [CA spec → CB, M]
2. **F5/derivative attach (§1.2)** → now carries documented-pro validation; with/after G2; capture keys already mapped [PRIOR: ingestion §6]. [CB, M]
3. **Daily 3 saleability rails (§3)** → external mirror at lock + losses-forward public page + critic-notes feed; sell-gate untouched. [CB, S]
4. **LLM news classifier on the Bluesky feed (§1.5)** → bounded ingestion (entity/impact tags → SCR), never forecasting. [CB, S-M; Phase-A companion]
5. **Steam-confirmation discipline (§2b)** → when the queued line-velocity layer ships, add Spanky's bar to the critic: %-of-bets-with-positive-CLV tracked as a first-class KPI (target band, not vanity stat). [rides existing builds, XS]

---

## Sources

**Web:** [TheLines — Peabody interview](https://www.thelines.com/professional-sports-betting-journey-bettor-rufus-peabody-2022/) · [The Ringer — Spanky](https://www.theringer.com/2019/06/05/gambling/sports-betting-bettors-sharps-kicked-out-spanky-william-hill-new-jersey) · [Wikipedia — Voulgaris](https://en.wikipedia.org/wiki/Haralabos_Voulgaris) · [Trademate — Voulgaris profile](https://tradematesports.medium.com/nbas-greatest-ever-bettor-haralabos-voulgaris-from-pro-bettor-to-maverick-s-director-10-people-7f142bbf95dd) · [The Power Rank — CLV](https://thepowerrank.com/2021/07/29/closing-line-value/) · [arXiv 2604.17194 — odds-only vs GLM](https://arxiv.org/pdf/2604.17194) · [arXiv 2607.17765 — WC-2026 LLM benchmark (none beat market Brier)](https://arxiv.org/html/2607.17765v1) · [IEEE — LLM sentiment hybrid](https://ieeexplore.ieee.org/abstract/document/11415979/) · [ResearchGate — betting markets as prediction markets](https://www.researchgate.net/publication/276014117_Are_Sports_Betting_Markets_Prediction_Markets_Evidence_From_a_New_Test) · [ResearchGate — line-movement inefficiency](https://www.researchgate.net/publication/372441761_Inefficient_Forecasts_at_the_Sportsbook_An_Analysis_of_Real-Time_Betting_Line_Movement) · [SportBot — arb Reddit consensus](https://www.sportbotai.com/blog/arbitrage-betting-reddit) · [Wikipedia — arbitrage betting](https://en.wikipedia.org/wiki/Arbitrage_betting) · [Columbia — arb scrape study](https://www.cs.columbia.edu/~sedwards/classes/2024/4840-spring/proposals/Sports-Arbitrage.pdf).
**Repo/prior:** 07-05 deep-dive · 07-07 moonshot · 07-16 ingestion audit · Daily 3 (4efacb1) · OPERATOR-TRIPLE (680b164) · line-freshness (1935957) · critic/archetype classifiers [REPO].
