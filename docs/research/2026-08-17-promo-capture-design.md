# PROMO / BOOST CAPTURE — Design (Michigan, 7 books, POLICY_STAKING_v1)

**Date:** 2026-08-17 · **Author:** Claude-C (research, Fable 5) · **Origin:** gap-sweep v2 item #4 — the only deterministic +EV item on the board, never built.
**Hard boundary, stated once:** everything here is **within published book terms** — using offers the books hand existing customers, on bets we'd defend on their merits. No multi-accounting, no bonus abuse, no synthetic-hedge schemes, nothing that puts an account at risk. If an offer requires behavior the terms forbid, it's out of the design.
**Tags:** [REPO]/[AUTH]/[PRAC]; grades REAL/SPECULATIVE/FANTASY. All formulas worked below; the monthly figure is a **bounded projection**, labeled as such.

---

## 1. Promo types these books actually run for EXISTING customers, with the math

Sign-up offers are largely spent — the operator holds funded accounts at all seven [REPO: POLICY_STAKING_v1 balances]. What matters is the recurring inventory: **profit/odds boost tokens** (BetMGM issues several nightly incl. Lions-branded boosts; DK runs frequent boosts + No Sweat tokens) [PRAC: [BetMGM MI promo page](https://sports.betmgm.com/en/blog/betmgm-state-promos/michigan-sportsbook/), [SBD daily boosts tracker](https://www.sportsbettingdime.com/promos/daily-boosted-odds/), [PlayMichigan MI promos](https://www.playmichigan.com/sports-betting/bonus/)].

**Type A — Profit boost token (X% added to profit). GRADE: REAL.**
`EV_gain = stake × (dec − 1) × X × p_true` — at a fairly-priced bet (p = 1/dec) this is `stake × (dec−1)/dec × X`.
Worked (50% token, $2 max stake per policy): −110 → **+$0.48** · +150 → **+$0.60** · +200 → **+$0.67** · +300 → **+$0.75** · +500 → **+$0.83**.
**Rule: boosts are worth more on longer odds** (24% of stake at −110 vs 42% at +500). This is deterministic value the moment the token exists — the only judgment is which bet to attach it to.

**Type B — Bonus bet / free bet (stake NOT returned). GRADE: REAL.**
`value = Face × (1 − 1/dec)` at fair odds. $5 bonus bet: −110 → **$2.38** · +200 → **$3.33** · +300 → **$3.75** · +500 → **$4.17** · +1000 → **$4.55**.
**Rule: bonus bets go on LONG odds, never favorites** — the ~70% rule of thumb [PRAC: [OddsJam bonus-bet primer](https://oddsjam.com/betting-education/bonus-bet), [OddsPlays guide](https://oddsplays.com/us/guides/how-to-use-bonus-bets-smarter/)] corresponds to roughly +230; at −110 you throw away half the face value.

**Type C — No-sweat / bonus-back (refund as bonus bet if the qualifier loses). GRADE: REAL, with a variance note.**
`EV_gain = (1 − p) × stake × 0.70` (0.70 = bonus→cash conversion [PRAC]), minus the qualifier's own vig drag.
Worked at $2: −110 → **+$0.67** · +150 → **+$0.84** · +300 → **+$1.05** · +500 → **+$1.17**.
**Rule: no-sweats also favor longer odds** (the refund triggers more often) — but the cash swing is real, so they belong on bets we'd have made anyway.

**Type D — Deposit match. GRADE: SPECULATIVE→SKIP at this bankroll.** Playthrough requirements typically demand turnover many multiples of the match; on a $100 bankroll that means forced volume at forced odds — the tail wagging the policy. Revisit only if a specific offer's rollover math clears on its published terms.

**Type E — Automated promo ingestion. GRADE: FANTASY.** No legal, reliable feed exists; promo pages are marketing surfaces and scraping them is both fragile and against the spirit we've held elsewhere. **Promo inventory must be operator-entered.** This is the design's fixed constraint, not a shortcoming.

---

## 2. The collision with POLICY_STAKING_v1 (the honest headline)

**Promo EV scales linearly with stake — and our policy caps a single bet at $2 (2 units).** A 50% boost token that books permit on a $25 stake is worth **$8.33** at +200; at our $2 cap it is worth **$0.67**. *Policy forfeits ~92% of each token's available value.* That is not an argument to break the policy — the policy exists because a $20 heater-night bet is the biggest bankroll risk at this size [REPO: POLICY_STAKING_v1 §4]. It is an argument that **CA/operator must consciously decide one narrow question**, and I'd rather name it than let it get decided by accident:

> Should a boosted bet be allowed a higher cap than an unboosted one — e.g. a "promo stake" line of up to 5 units ($5) when a token is attached, still inside the nightly exposure cap?

Arguments both ways, honestly: **for** — boosted bets carry documented positive EV, so a larger stake is the one case where the math genuinely favors more money, and the cap is currently costing real dollars; **against** — every heater-night rationalization sounds like "but this one's different," a $5 promo bet is 5% of bankroll on a single outcome, and policy v1 is four days old. **My recommendation: leave the $2 cap alone for now**, capture at $2, and revisit after one month of *measured* promo results — the same evidence-before-scaling rule everything else obeys. Capture consistency matters more than per-token size at this bankroll.

**Honest monthly projection (bounded, not measured):** at $2 stakes, typical tokens are worth $0.40–$0.83 each. Assuming 8–16 usable tokens/week across the four books where our machine can actually see lines (DK/MGM/Fanatics/BetRivers — bet365 is blind-money per policy §7):

| Tokens/wk | @ $0.40 avg | @ $0.67 avg |
|---|---|---|
| 8 | $14/mo | $23/mo |
| 12 | $21/mo | $35/mo |
| 16 | $28/mo | $46/mo |

**Read that honestly: $15–45/month in absolute dollars — trivial money, but 15–45% of a $100 bankroll per month, and it is the only line item on this project that doesn't require our edge to be real.** The token-count assumption is the soft part (books vary weekly, some tokens are sport- or market-restricted and unusable); **one month of actual capture replaces this table with measurement.** Grade of the projection itself: SPECULATIVE on volume, REAL on per-token math.

Two interactions to carry forward: (a) **tax** — promo churn inflates gross winnings, which the new 90% loss cap punishes [PRIOR: gap-sweep v2 §1.1]; bonus-bet winnings are taxable. At these dollars it's negligible, but the accounting must exist before any scaling. (b) **limits** — bonus-hunting patterns are a known flag; attaching tokens to bets we'd defend anyway is both the honest play and the safe one.

---

## 3. Surfacing design — "free money available today," without hunting 7 apps

**The inventory (operator-entered, ~2 min/week):** a simple promo list — book · type · value (e.g. "50% profit boost") · max stake · expiry · any sport/market restriction. Tokens expire unused; **expiry is the main leak**, so the card leads with what dies soonest.

**The card (the actual feature):** the machine already knows tonight's board, each leg's calibrated probability, de-vig fair price, and best book. So the card should not just list promos — it should **match each live token to the best qualifying pick and show the dollar value**:

> 🎟 **BetMGM 50% profit boost** · expires tonight → best use: *[tonight's board leg, +340 @ BetMGM]* · **+$0.71 EV** at $2 · [tap to open slip]
> 🎟 **DK $5 bonus bet** · expires Thu → hold for a longer-odds leg (worth $3.75 at +300 vs $2.38 at −110)

Design rules, all grading REAL: match tokens only to legs the board already qualifies (a promo must never conjure a pick we wouldn't otherwise make); rank by EV; prefer long odds per §1; show expiry countdown; never auto-place. Unused-token count and expired-token count both get logged — **"we let $X of tokens expire this month" is exactly the kind of number this project exists to make visible.**

---

## 4. Record integration — what exists vs what's missing

**Exists:** the ledger carries a bonus/free-bet flag and full per-bet stake/odds/result/timestamps [REPO: personal_ledger schema].
**Missing (all small, report-layer):**
1. **Promo metadata on the bet:** promo type, boost %, token id/expiry, and *boosted* vs *base* odds recorded separately — so CLV is measured against the base market price, not the boosted one (otherwise every boosted bet fakes positive CLV).
2. **Stake-type semantics:** a $5 bonus bet is not $5 of bankroll risk — it must not consume the nightly cash exposure cap the way a cash bet does, and its "loss" is not a $5 bankroll loss. Without this, both the exposure math and the ROI denominator are wrong.
3. **Segregated accounting:** promo P/L reported as its own line, never blended into model-edge ROI [PRIOR: 07-07 §3.4 — blending would flatter the record, which is the one thing we don't do].
4. **Token lifecycle log:** issued → used → expired, so the projection in §2 gets replaced by measurement and the expiry leak is visible.

---

## 5. For CA triage (all small; nothing competes with the chain)

1. Promo inventory entry + "free money today" card with token→pick matching and EV [CB, S-M] — the feature.
2. Ledger promo metadata + base-vs-boosted odds separation (protects CLV integrity) [CB, S] — **should land with or before #1.**
3. Segregated promo P/L line + token lifecycle counters [CB, S].
4. **Operator/CA decision to record:** the §2 stake-cap question (recommendation: hold at $2, revisit after one measured month).

---

**Sources:** [BetMGM Michigan promos (odds boost tokens, no-sweat tokens, worked boost example)](https://sports.betmgm.com/en/blog/betmgm-state-promos/michigan-sportsbook/) · [SBD daily boosted odds tracker](https://www.sportsbettingdime.com/promos/daily-boosted-odds/) · [PlayMichigan MI promo landscape](https://www.playmichigan.com/sports-betting/bonus/) · [LSR Michigan promos](https://www.legalsportsreport.com/sports-betting/promos/michigan/) · [OddsJam — bonus bets explained](https://oddsjam.com/betting-education/bonus-bet) · [OddsPlays — using bonus bets smarter (70% conversion)](https://oddsplays.com/us/guides/how-to-use-bonus-bets-smarter/) · [BettorEdge EV formula](https://www.bettoredge.com/post/how-to-calculate-expected-value-in-betting) [PRAC] · Repo: POLICY_STAKING_v1 (bankroll/caps/bet365 blind-money) · personal_ledger schema · prior docs 07-05 §4, 07-07 §3.4, gap-sweep v2 §1.1/§3.4 · EV tables computed this session (probe in log block).
