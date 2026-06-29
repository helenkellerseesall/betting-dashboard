# MLB Daily Longshot & Max-Payout Discovery — Finding the Few Genuinely Mispriced High-Payout Plays

**Date:** 2026-06-29 (MLB mid-season) · **Author:** Claude-C [research] · **Status:** research only, freeze-irrelevant, no code.

**What this is.** The repeatable DAILY process by which a sharp recreational MLB bettor finds the few genuinely *mispriced* high-payout plays each day — (a) single-leg longshots where the book's price is actually wrong, and (b) engineered parlays of OBTAINABLE legs that amplify a real edge into a big payout — and, just as important, how to *reject* the overhyped, fairly-priced lottery tickets that look identical from the outside.

**Extends, does not re-derive:** `2026-06-11-parlay-ladder-playbook.md` (correlation/EV/Kelly), `2026-06-15-prop-parlay-craft-playbook.md` (obtainable-vs-longshot, sharp-vs-lottery line, matchup data sources), `2026-06-15-parlay-edge-menu-and-integrity.md` (the MLB signal menu + integrity rules). This doc is the LONGSHOT/max-payout slice of those, operationalized.

**Honest north star (unchanged):** there is NO sharp PROP line to copy — every "sharp prop" product is a de-vig of the same correlated retail books. The edge is interpretation + line-shop + fading overreactions + obtainable rungs + CLV, graded over 300-500+ bets, capped by limits. The single-leg longshot edge specifically is THIN and RARE; most longshots are fairly priced. The win is finding the few that are not, and sizing them so variance never causes ruin.

---

## 1. Mispriced vs. merely-unlikely — the decision rule

A +EV longshot (price genuinely wrong) and a -EV lottery ticket (fairly priced, just rare) look identical on the bet slip. The only thing that separates them is a **fair-probability estimate you trust**, compared against the **de-vigged offered price**.

**Favorite-longshot bias (FLB) — the structural tailwind, and the trap.** [consensus, PRAC] Betting markets systematically *overstate* longshots and *understate* favorites: humans overweight large lottery-like payouts, so books can tax the longshot leg harder (margin is distributed unevenly, heaviest on the long end). Two consequences that pull in OPPOSITE directions, and you must hold both:
- The bias means most posted longshots are priced a *little too expensive* — so the default prior on a random longshot is **-EV, fade**.
- But FLB is a market-wide *average*; it does not mean every longshot is overpriced. A specific longshot becomes +EV only when a *real, day-of, under-priced input* (wind, park, arsenal mismatch, bullpen fatigue) pushes the true probability above the de-vigged price. The edge is the residual after the book's longshot tax, not the bias itself.

**The decision rule (hardcode this):**
1. Estimate the fair probability `p_fair` from a calibrated model (NegBinom tail for a ladder rung; HR model for HR props), NOT from the line and NOT from a hot streak.
2. De-vig the *best available* price across our books to `p_book` (power method; Shin cross-check on high-vig two-way markets — see prior Part 2 E3).
3. Surface ONLY if `p_fair > p_book` by a margin that exceeds your calibration uncertainty on that bucket. On the long end, `p_fair` is a TAIL probability where calibration is weakest (thin samples) — so the required margin is LARGER for longer odds, not smaller.
4. If you cannot produce a `p_fair` you trust (low sample, uncalibrated tail), the honest output is **no play**, not a guess. A longshot with an uncalibrated tail prob is entertainment, not edge.

**The FLB self-test (the proof it's real for us):** split our graded bets into odds buckets and compare ROI + CLV + hit-rate by bucket. [PRAC] If our worst ROI/CLV concentrates at the longest prices, our longshots are -EV and we're paying the bias, not beating it. This is a CLV-tracker feature, not a vibe (build-next #5).

**Confidence:** HIGH that FLB exists and that longshot props are the most-taxed, most-recreational segment; MEDIUM on the size of any residual +EV after the tax on our specific books — that is an empirical question only the bucketed CLV test answers.

---

## 2. Where MLB longshot value recurs DAILY (markets + the day-of signals the book is slow to price)

Longshot value clusters where (a) recreational demand is high (so the book shades the price for hold, not accuracy) and (b) a real input moves the true probability but the line lags. The MLB signal menu (edge-menu PART 4) maps each input to a free data source; here it is re-cut for the LONGSHOT lens — which *market* each signal makes mispriced, and in which direction.

| Market (long end) | Day-of signal that mis-prices it | Direction | Free data source |
|---|---|---|---|
| HR props (the canonical longshot, +250 to +600) | Wind OUT 15+ mph; high temp; power park; fly-ball/barrel hitter vs high HR/9, fly-ball pitcher; handedness ISO split | Wind-out + barrel + bad arm in a bandbox = HR over genuinely under-priced | Open-Meteo (hourly, by park lat/long); Baseball Savant park factors + barrel/ISO; FanGraphs HR/9 |
| Pitcher-K ladders, upper rungs (8+, 9+ K) | Big umpire zone; good catcher framing; opponent high-K lineup; opener mislabeled as "starter" | Upper-rung K over under-priced when zone+framing+lineup all align | UmpScorecards; Savant framing; MLB StatsAPI lineup K%; pybaseball |
| First-inning / F5 unders & "no run 1st" | Two strong starters; pitcher's-duel script; big zone | F5/1st-inning under under-priced in a duel the public ignores | MLB StatsAPI probables; Savant; UmpScorecards |
| Alt-line total bases / hits thresholds (2+, 3+) | Batting-order slot bump (volume); platoon edge; slugfest game-total | Higher-rung TB over reachable when volume + matchup + park all push | MLB StatsAPI lineups; Savant splits; Open-Meteo |
| RBI 2+, runs-scored alt | Lineup-slot RBI opportunity (men on base ahead); park/weather run environment | Mispriced when a middle-order bat draws a soft arm in a hitter's park | MLB StatsAPI lineup; Savant; Ballpark Pal |
| Team-total OVER alts / run-line longshots | Bullpen fatigue (>40 pitches in prior 72h); weather; weak SP | Late-inning run blowups under-priced vs a gassed pen | MLB StatsAPI game logs (rolling 3-day workload); pybaseball |

**The recurring daily setup (the one that actually prints, when it prints):** a power hitter with an elite barrel rate and a favorable handedness split, facing a fly-ball-prone pitcher with a high HR/9, in a hitter's park, with the wind blowing OUT 15+ mph and a warm temperature. The HR model (ISO × park power factor × opposing HR/9, barrel/exit-velo as the Statcast booster, handedness-specific column) puts the true HR probability meaningfully above the de-vigged +300-ish price the book posts off the player's name and season HR total. [PRAC — HR-model method consensus] The book is *slowest* to fully price same-day wind/temperature, which is exactly the input Open-Meteo gives us for free.

**Current-season honesty note (2026):** the most *famous* HR names are the most over-priced, not the most mispriced. Aaron Judge HR props are routinely posted at +190 or shorter — public-bait, usually fairly-to-over-priced, almost never the +EV longshot. [PRAC] The value is in the un-hyped barrel-rate hitter in the right park/weather, not the name everyone bets.

---

## 3. Engineering obtainable-leg parlays for max payout (correlation-aware)

A parlay is EV-neutral machinery that amplifies the SIGN of what you feed it (parlay-ladder sec 0). To turn a real single-leg edge into a big payout WITHOUT becoming a random ticket, stack **obtainable** legs (role-justified, structurally floored — prop-craft sec 1) that are **positively correlated with the same thesis**, and let the book's independence-assumption mispricing work for you.

**MLB legs that legitimately POSITIVELY correlate (stack these — the book often prices the SGP as if independent):**
- **Pitcher Ks OVER + that pitcher's opposing TEAM-TOTAL UNDER.** Both win on the same event: the starter dominates. A book that prices the same-game combo near the independent product is under-charging you for a real positive correlation. This is the cleanest MLB max-payout stack.
- **Pitcher Ks OVER + opposing team "no run first inning" / F5 UNDER.** Same dominance thesis, earlier-inning slice.
- **Same-team multiple hitters' total-bases OVERS in a projected slugfest.** The shared driver is the GAME total / opposing weak arm + park/weather — they rise together. (Keep it 2-3 legs; this is game-total-correlated, not independent.)
- **A team's run-line + its top-of-order bat's runs-scored OVER.** Team scores → leadoff scores.

**Negative-correlation TRAPS (never bundle as if independent — the engine must enforce the sign and BLOCK):**
- **Pitcher Ks OVER + an opposing hitter's hits/TB OVER.** These FIGHT each other: a high-K dominant start suppresses the offense. Bundling them is paying for two legs that cancel.
- **Two opposing pitchers both OVER Ks in the same game** when your thesis is a pitchers' duel — possible but the legs partly compete for the same outs/innings; treat with the copula, not independence.
- **A hitter's HR OVER + the same game's F5 UNDER** — a HR is a run; you're betting for and against scoring in the same window.

**The construction rule:** ≤3-4 legs (beyond ~4 same-game legs is lottery territory regardless of leg quality — prop-craft sec 1). Price the joint probability with the correlation engine (Gaussian copula over legs, empirical matrix from our own graded ledger, **negative sign enforced**), de-vig the book's offered parlay price, and surface ONLY +EV or boost-overlaid combos. Default to separate singles otherwise (the book's SGP is its highest-hold product — feeding it uncorrelated legs is the single most profitable thing you can do *for the book*).

**Confidence:** HIGH on the correlation *directions* (they follow directly from baseball causality); MEDIUM on the *magnitudes* until the copula is fit on our real graded history — which is exactly what the G3 shadow engine is for.

---

## 4. The daily operational loop (morning → lineups → close)

A concrete sequence, composing the lineup-independent/dependent split (early-CLV pass, R1) with the longshot lens. Times are ET.

**Overnight / early AM (~6-9 AM) — lineup-INDEPENDENT pass (inputs already locked: SP announced ~1 day ahead).**
1. Pull probable starters (MLB StatsAPI), park, and the day's weather forecast (Open-Meteo hourly by park) + roof state.
2. Pull pitcher arsenal + handedness + HR/9 + K% (Savant/FanGraphs), bullpen rolling 3-day workload (StatsAPI game logs), umpire assignment + zone tendency (UmpScorecards).
3. Build the lineup-INDEPENDENT longshot CANDIDATE list: pitcher-K upper rungs, F5/first-inning, team totals, run lines, and HR setups that depend only on park/weather/pitcher (not the exact order yet). Capture the OPENER price here (this is the soft number — R1 is already measuring whether the 6 AM opener beats the 9 AM line on our books).

**Midday (~11 AM-1 PM, lineups post 2-4h pre-game) — lineup-DEPENDENT pass.**
4. Confirm batting orders + starting status; run a SCRATCH check (a scratched hitter voids/wrongs an early batter leg).
5. Finalize lineup-DEPENDENT longshots: HR props (now you have the confirmed hitter + slot), RBI/hits/TB thresholds, batting-order-slot volume plays.

**Pre-close (final 1-2h) — vet, line-shop, stake.**
6. For every surviving candidate: estimate `p_fair` (NegBinom tail / HR model), de-vig the BEST price across our 4-7 books, apply the section-1 decision rule. Reject anything failing the margin-vs-uncertainty test.
7. For parlays: run the copula, de-vig the offered SGP price, keep only +EV/boost-overlaid ≤4-leg combos.
8. Line-shop the survivors (take the least-taxed book per leg), stake per section 6, and STAMP the bet so the CLV tracker captures open→close.

**Output discipline:** the loop should yield a SHORT list most days (often zero genuine single-leg longshots; a slate is allowed to have none). "Few or none" is the correct, honest output — manufacturing a daily longshot is how you bleed the FLB tax.

---

## 5. Traps to hardcode against

1. **The over-the-over trap.** Books over-price OVERs because the public loves them; our own dry-run showed the projection MEAN sits above the true MEDIAN for 305/341 players (89.4%), which over-bets the over. Center every projection→line comparison on the MEDIAN, not the mean. (Part 2 E3; this is the single most codifiable longshot self-protection.)
2. **Public-bait longshots.** Famous-name HR/SB longshots (Judge HR at +190) carry name premium, not edge. Down-weight or exclude the most-bet names; favor the un-hyped barrel-rate hitter.
3. **Manipulated / low-limit single-actor micro-markets — EXCLUDE.** The only proven betting manipulation is isolated single-actor low-limit micro-props (own-unders / specific-pitch props: the Porter/Rozier/Clase-type cases). Hardcode: exclude single-actor micro-markets, block low-limit two-way/10-day legs, and treat an anomalous line move as a RED FLAG that SUPPRESSES the leg (never recommends it). (integrity doc.)
4. **Correlation traps.** Any negative-sign pair (section 3) bundled as if independent. The engine must refuse, not just warn.
5. **"He's hot" recency bias.** A 3-game HR streak is noise; regress to true talent (ISO/barrel over a stable window). The streak is already in the book's price — paying up for it is paying the public premium.
6. **Calibration-tail blindness.** Surfacing a longshot whose tail probability comes from a thin/uncalibrated bucket (or a 0.5/`||` default — Part 1 H3). No calibrated tail prob → no play.

---

## 6. Staking the high-variance slice under retail reality

Longshots and parlays are where variance and the limit-radar are both highest — size accordingly.

- **Carve out a small "lotto allocation."** The longshot/parlay slice is a FIXED small fraction of bankroll (e.g. a single-digit %), never the core. The core stays on obtainable, CLV-validated rungs.
- **Fractional Kelly, then HALVE it again for longshots.** Use 1/4-1/2 Kelly with a 2-3% hard cap and 1/√n for simultaneous bets (parlay-ladder sec 4), but for a long-odds leg the edge estimate is NOISY and the variance enormous, so apply a tighter fraction (e.g. 1/8-1/4 Kelly) and a lower per-ticket cap. A "½ Kelly" stake on a +500 leg whose edge you're unsure of can still be ruinous.
- **Size on the CLV-validated edge, not the raw model edge** (Part 2 E5), with an uncertainty haircut when the bucket's calibration sample is small — which, for tails, it usually is.
- **Limit reality is WORST here.** Parlays are the book's highest-hold product, so a *winning* parlay/longshot bettor is flagged fast (it's beating the closing line that gets you limited). Use round-number stakes (never exact-Kelly $47.32), spread the longshot slice across books, and expect the longshot accounts to die first. Track CLV by odds bucket so you know whether the slice is real edge or paid entertainment — and if the long-bucket CLV is not green, shrink or stop it. The process is the protection.

**Honest bottom line on the slice:** done right, the longshot/max-payout slice is a small, CLV-tracked, tightly-staked carve-out that occasionally pays big and is *not expected to carry the operation*. Done as daily lottery stacks, it is the fastest way to hand the FLB tax and the SGP hold straight to the book. The product's job is to surface the few genuine ones and make the variance survivable — not to promise a big hit every day.

---

## Build-next shortlist (ranked; each names the existing engine piece it plugs into)

1. **Longshot-rung EV scanner → plugs into per-player NegBinom ladders (G2 shadow).** Use the fitted `P(player ≥ k)` tail at each rung to find the rung where `p_fair > de-vigged price` by more than the bucket's calibration uncertainty. This is the single-leg longshot finder; it is only as honest as the ladder's tail calibration.
2. **Tail-probability honesty gate → plugs into calibration / probability-honesty.** Refuse to surface any longshot whose tail prob is low-sample/uncalibrated or comes from a 0.5/`||` default. Longshot EV lives entirely in the tail, where calibration is weakest (isotonic overfits thin — Part 2 E1) — so this gate is what stops the scanner manufacturing fake edges. (Depends on the H1 corpus fix so the calibrator has real tail data.)
3. **Same-game stack proposer + negative-trap blocker → plugs into the correlation engine (G3 copula).** Encode the section-3 positive stacks (pitcher-K + opposing team-total under, etc.) and HARD-BLOCK the negative-sign traps; price joint probability with the negative sign enforced.
4. **Max-payout obtainable-parlay surfacer → plugs into the parlay constructor (G4).** Enumerate ≤4-leg obtainable combos, de-vig the offered SGP price, surface only +EV/boost-overlaid; default to singles otherwise.
5. **Odds-bucketed longshot CLV scoreboard → plugs into CLV tracking.** Split graded bets by odds bucket; report ROI + CLV + hit-rate per bucket (the FLB self-test). This is the proof the longshot slice is real edge vs entertainment, and the kill-switch that shrinks the slice when the long bucket goes red. (Extends the live `sectionForwardClvSlices` /status card.)
6. **Day-of mispricing tagger (lower priority, additive) → plugs into the matchup-context layer.** Combine wind/temp (Open-Meteo) + park power + barrel/HR/9 + handedness + umpire zone + bullpen fatigue into an "under-priced longshot" tag, freeze-safe as a shadow feature, so the scanner (#1) knows WHERE to look before devigging.

**Sequencing note:** #2 (tail honesty) and the H1 corpus fix gate everything — a longshot scanner on uncalibrated tails just relocates the FLB tax onto us. Build the honesty gate with the scanner, not after.

---

## Sources

Favorite-longshot bias: [thewagertheorem.com — Favorite-Longshot Bias Explained](https://thewagertheorem.com/favorite-longshot-bias-betting/) [PRAC] · longshot-prop overpricing + Judge HR + the odds-bucket self-test: [CBS Sports MLB player-prop best bets](https://www.cbssports.com/mlb/news/mlb-best-bets-expert-picks-2026-player-props-pitcher-wins-home-runs-stolen-bases/) [PRAC].
HR-prop model (ISO × park power × HR/9 + barrel/exit-velo + handedness + wind/temp): [Baseball Savant — Statcast Park Factors](https://baseballsavant.mlb.com/leaderboard/statcast-park-factors) [AUTH — official MLB/Statcast] · [Ballpark Pal — daily park factors + simulations](https://www.ballparkpal.com/) [PRAC].
MLB signal menu + free data sources (umpire/wind/bullpen/park/platoon/order): internal `docs/research/2026-06-15-parlay-edge-menu-and-integrity.md` PART 4 (cited within), backed by UmpScorecards, Open-Meteo, MLB StatsAPI, pybaseball/Baseball Savant.
Correlation / EV / Kelly method, obtainable-vs-longshot, sharp-vs-lottery line: internal `docs/research/2026-06-11-parlay-ladder-playbook.md`, `docs/research/2026-06-15-prop-parlay-craft-playbook.md`.
Devig (power/Shin/median), calibration tails, CLV-as-scoreboard, realistic ROI/limits: internal `docs/research/online_findings.md` (Part 2 E1/E3/E5, post-flip game plan).
Integrity / manipulation exclusions: internal betting-integrity research (single-actor micro-market exclusion, anomalous-line-move suppression).
