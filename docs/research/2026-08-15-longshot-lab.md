# THE LONGSHOT LAB — Small-Stake, Long-Odds Portfolio Design, Run Honestly

**Date:** 2026-08-15 · **Author:** Claude-C (research, Fable 5) · **Mandate:** CA/operator 8/15 — the parlay-craft endgame as the product [PRIOR: product_parlay_craft_vision, ladder-direction]. Design only; CB builds after CA triage. **Tags:** [REPO]/[AUTH]/[PRAC]/[PRIOR]; grades REAL/SPECULATIVE/FANTASY. Every number below traces to a named repo artifact or the computed math in §2 (probe outputs in the log block).

---

## 0. What our own instruments already said (the frame the lab must live inside)

- **The pricer's paper gate is REFUSING, decisively and correctly.** Current readout (scan 2026-08-15): 24 nights, 4,204 decided tickets, **flat units −4,159** — near-total loss rate, both halves negative [REPO: mlb_parlay_scan_2026-08-15.json .gate]. Tonight's top "EV +1186%" candidate is *Freeman 4+ hits +15000 × Hancock 10+ Ks +5000 × Henderson 3+ runs +8000* (joint 2e-05) [same file] — the candidate generator is betting the model's uncertified extreme tails, i.e., the FLB trap our own 06-29 decision rule warned about, at scale. **The lab's first design act is to stop generating those tickets, not to price them better.**
- **A structural gate flaw to fix while we're here:** the gate's `gapPp` bar reads 0.1pp — "calibrated!" — while units crater. At joint probs of 1e-4/1e-5, absolute pp-gaps are near-zero BY CONSTRUCTION even under catastrophic *ratio* mispricing. Tail gates must be ratio/likelihood tests at the odds-band level (§3), never per-ticket pp.
- **Correlation evidence (the 42-slate pair corpus, regenerated this morning — 1.51M class-tagged pairs; the mandate's 934k was an earlier snapshot):** class counts batter_batter_opposing 686k · same_team 643k · same_player_multi_family 58k · batter_pitcher_opposition 37.5k · cross_game 80k [REPO: mlb_pair_corpus_summary.json 2026-08-15]. Walk-forward validation (g3-l2-v1, 689k pairs/37 slates): **only batter_pitcher_opposition PASSES** (ρ_Z −0.068, Brier beats independence); batter_batter_same_team shows REAL positive dependence (ρ_Z +0.113, n≈274k) but its copula does NOT beat independence out-of-sample (Brier bar fail → STOP); other classes STOP [REPO: g3_correlation_validation.json].
- Daily 3 record as of 08-11: 40-19-7, +4.02u flat — real but small-n [PRIOR: state 08-11].

---

## 1. Longshot classes, graded against OUR corpus

| Class | Grade | Evidence + reasoning |
|---|---|---|
| **Cross-game 2–3-leg parlays of Daily3-class legs** (calibrated-zone, obtainable rungs; ticket lands ~+500 to +2000) | **REAL-mechanism, gated** | Parlay amplifies the SIGN of leg edge, never creates it [PRIOR: 06-11]. The only leg population with any positive live evidence is the Daily3-class lens (+4.02u/66, n small). Independence holds cross-game (no correlation model needed); pricing = product of calibrated, market-prior-blended leg probs. This is the lab's WORKHORSE band. |
| **Opposition-trap blocking in every ticket** (never Ks-over × opposing batter-over, etc.) | **REAL — the one VALIDATED correlation use** | The single PASS class is negative-dependence opposition (ρ_Z −0.068) [REPO]. Its money value is loss-avoidance in construction, not payout boost. Ships as a hard constraint. |
| **Same-team batter stacks (SGP)** | **SPECULATIVE — real correlation, no validated pricing, no execution path** | ρ_Z +0.113 at n≈274k is a real measured dependence [REPO] — but the copula fails the Brier bar out-of-sample (STOP), same-game combos run through the books' SGP engines with their own correlation discount [PRIOR: 07-07 §1], and SGP link execution is UNVERIFIED. Stays in shadow until G3's bar clears AND the SGP tap-test matrix exists. |
| **Ladder top rungs / milestone singles (+2000–+10000 one-leg tickets)** | **SPECULATIVE, tiny experimental allocation only** | Rung capture is live (3-pass ladders [REPO]) but top-rung honesty = tail calibration, exactly where G2 validation is stalled/unproven and where the pricer's −4,159u came from. One $1 experimental ticket/night max, certified-zone legs only (§3), purely to accumulate band evidence. |
| **Model-tail mega-joints (the current top-board 1e-05 class)** | **FANTASY — prohibited by design** | 24 nights of our own paper gate says these are phantom-EV [REPO]. The lab's candidate generator must be structurally unable to emit legs whose calibrated prob lacks map support. |

---

## 2. Portfolio math, published honestly ($1–2 stakes; 300-ticket season ≈ 3+ months at 3/night)

Computed exactly (binomial/geometric; probe in log block). "Drought" = expected LONGEST losing streak in 300 tickets.

| Band | Breakeven hit rate | At breakeven: exp wins /300 · exp longest drought · P(down after 300) | With a REAL +15% edge: exp wins · drought · P(down after 300) · EV/300 |
|---|---|---|---|
| **+500** | 16.67% | 50 wins · **31-straight drought** · 53.8% | 57.5 · 27 · **15.2% still down** · +$45 |
| **+2000** | 4.76% | 14.3 wins · **117-straight drought** · 53.9% | 16.4 · 101 · **32.3% still down** · +$45 |
| **+10000** | 0.99% | 3.0 wins · drought 573 (exceeds the season) · 5.1% chance of ZERO wins in 300 · 42.9% down | 3.4 wins · ~498 · **33.5% still down** · +$45 |

Read those middle columns again: **at +2000 with a genuine 15% edge, a 100-straight losing run is the EXPECTED worst stretch of the season, and one program in three is still underwater after 300 tickets.** At +10000, droughts longer than the whole season are the norm and a fairly-priced program has a 5% chance of never cashing once. This is why: (a) stakes are $1–2 and capped (~$3–6/night ≈ $90–180/mo exposure — survivable by construction); (b) the drought expectation gets DISPLAYED on the surface next to the running record, so reality has a printed benchmark; (c) nobody scales on a heater — a heater at these odds is indistinguishable from luck for months.

---

## 3. The paper gate design (Daily-3-grade honesty, bar stated up front)

**Nightly auto-build, N=3 tickets:** 2 workhorse (cross-game 2–3 legs, each leg calibrated-zone + market-prior-blended + obtainable rung + CLV-stampable, ticket odds +500–+2000) + 1 experimental (+2000–+10000, certified-zone legs only — ladder top rungs allowed only where the calibration map has support). Constraints baked in: opposition-trap blocker ON; no same-game legs v1; no leg without calibration-map support (kills the 1e-05 class structurally); round $1 paper stakes.

**Write-once honesty, verbatim from Daily 3 [REPO: 4efacb1 precedent]:** lock at T-60 of earliest leg; no card if unlocked at pitch; settled rows immutable; lock receipts ride git; droughts and losses displayed losses-forward; band-level expected-drought line printed beside the record.

**Bar to go bettable (stated NOW, before the first ticket):** per band — ≥90 nights AND ≥250 decided tickets; **band-level realized-wins ÷ priced-expected-wins ≥ 0.85 by a Poisson likelihood test** (replaces gapPp — the §0 flaw); flat units > 0 in-band; leg-level CLV-positive share ≥ house bar; and the existing pricer-gate refuse must have CLEARED on the same window. Flip = OPERATOR, never automatic. At 3/night this is ~3 months minimum — the calendar is the cost, stated up front. If the bar never clears, the lab's product output is the honest verdict "this band is not beatable by us," published on the record like everything else.

---

## 4. What the market-prior upgrade buys HERE (why it lands before the lab bets)

Parlay pricing compounds leg error multiplicatively: a leg truly 4.8% priced by the model at 6.0% (25% relative overstatement — mild by our tails' standards) makes a 3-leg joint overstated 1.95× — a fair ticket masquerading as +95% EV. That compounding is precisely the −4,159u mechanism. The approved market-prior spec [PRIOR: state 08-11 — CA→CB] shrinks each leg's prob toward origination-weighted de-vig consensus, hardest exactly at the tails where model support is thinnest [PRIOR: 07-29 §1.1]. For the lab: it bounds per-leg relative error → bounds joint phantom-EV → turns the workhorse band's EV numbers from model-confessions into market-disciplined estimates. **Sequencing consequence: the lab's paper clock should not START until market-prior leg pricing is live in the scan — otherwise we spend 90 nights measuring a pricer we already know we're replacing.**

---

## For CA triage (CB standing queue, ranked)

1. Candidate-generator constraints + gate re-base (certified-zone legs, trap blocker, band structure, Poisson ratio bar) — turns the existing nightly scan into the lab. [M]
2. Market-prior leg pricing into the scan (spec already approved) — the clock-starter. [M, first if parallelism is limited]
3. Longshot Lab surface card (3 tickets, locks, receipts, drought benchmark line, losses-forward). [S-M]
4. Same-team SGP class: stays shadow; revisit only on G3 Brier-bar PASS + SGP tap-matrix. [no build]

---

**Sources:** mlb_parlay_scan_2026-08-15.json (gate + top board) · mlb_pair_corpus_summary.json (2026-08-15) · g3_correlation_validation.json (g3-l2-v1) · Daily 3 record via 08-11 state [PRIOR] · §2 math computed this session (binomial/geometric, probe in log block) · docs/research: 06-11 parlay playbook · 06-29 decision rule · 07-07 multileg (SGP engine distinction) · 07-29 outside-in §1.1 · product_parlay_craft_vision [PRIOR].
