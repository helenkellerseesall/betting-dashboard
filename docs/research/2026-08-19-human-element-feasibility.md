# HUMAN ELEMENT / HYPE — What's Cheaply Ingestible, What Actually Predicts, and How Signals Earn Weight

**Date:** 2026-08-19 · **Author:** Claude-C (research, Fable 5) · **Lane:** L8 of `docs/OPERATOR_ROADMAP_2026-08-19.md` — "run all the hype, all the news," with the operator's own rule attached: *every human-element signal gets the same forward test as every stat — if "hot streak" predicts, it earns weight; if it doesn't, it dies.*
**Tags:** [REPO]/[AUTH]/[PRAC]; grades REAL/SPECULATIVE/FANTASY. Extends 07-16 §1 and 07-07 §1 — sources not re-derived, **the new content here is the forward-test design (§3), which is what makes this lane honest.**

---

## 1. The two-outcome distinction that organizes everything

A signal can predict **the OUTCOME** (does the player go over?) or **the LINE MOVE** (does the market re-price toward us?). They are different tests with different value:
- Predicting the outcome = a modeling edge (rare, hard, what everyone claims).
- **Predicting the line move = CLV**, which is our doctrine's leading indicator and, per every documented pro, the thing that actually correlates with long-run profit [PRIOR: 07-29 §2].
**Most "human element" signals are line-move signals, not outcome signals** — news moves markets faster than it moves reality. The forward test must therefore score BOTH, separately. This distinction is the single most useful thing in this doc.

---

## 2. Signal-by-signal feasibility

| Signal | Ingestible? (cost) | Predicts what? | Grade |
|---|---|---|---|
| **Injuries / scratches / inactives** | **Yes, free** — MLB StatsAPI lineups (~2-4h pre-game); NBA ESPN injuries autopiloted [REPO]; NFL = the scheduled Wed/Thu practice → Fri designation cascade, but the free nflverse injury feed is DEAD [PRIOR: 08-11 §2] | **Both**, strongly — but the *direct* news is priced in minutes. The durable value is **second-order: usage redistribution** (who absorbs the vacated targets/minutes/PAs) | **REAL** — for the SCR protection surface (never bet into stale news) and for redistribution modeling |
| **Confirmed lineups / batting order / starters** | **Yes, free** (StatsAPI; NBA starters ~30 min pre-tip) | Outcome (PA count, first-basket eligibility) more than line | **REAL** — already a hard gate in two places (MLB lineupSpot, NBA first-basket starter gate) |
| **Weather (wind/temp/park)** | **Yes, free** — Open-Meteo; staged as #28 air-density [REPO] | Both; documented mechanism for totals/HR | **REAL, untested-forward** — it is *staged and unvalidated*, which is precisely what §3 is for |
| **Umpire assignment** | **Yes, free** — day-of trackers [PRIOR: 07-16 §1.3] | Outcome (K/total props) | **REAL, small** |
| **Rest / travel / B2B / schedule spots** | **Yes, free** (computed from schedule) | Both, weakly — heavily public | **SPECULATIVE** |
| **"Hot streak" / recent form narrative** | Yes, free (we already compute L5/L10) | **Mostly NEITHER** — recency is the classic bettor bias; books price form fully, and our own longshot doc named "he's hot" as a hardcoded trap [PRIOR: 06-29 §5] | **SPECULATIVE→likely FANTASY as an edge**; REAL only as a *WHY-panel display* fact. The forward test should be allowed to kill it. |
| **Beat-reporter news feed (structured)** | **Yes, free via Bluesky Jetstream**; X API is pay-per-read and dead on cost [PRIOR: 07-07 §1.5] | Line move (minutes-level), occasionally outcome | **REAL as infrastructure**, SPECULATIVE on magnitude |
| **Public hype / social volume / "everyone's on this"** | Partially — no clean free volume feed; screenshots are the honest channel | **Line move (adverse):** hype is a *fade/contrarian* input and a Public-Bait archetype tag, not a follow signal [PRIOR: 06-15, 06-29 "Judge HR +190 = name premium not edge"] | **SPECULATIVE, and only as a FADE input** |
| **Screenshot ANALYZE loop (tail-or-bail)** | Yes — OCR pipeline exists [REPO: `backend/pipeline/screenshots/`] | Neither directly — it's a **decision-support** surface that grades someone else's slip against our numbers | **REAL and the highest-uniqueness item on this lane** [PRIOR: 07-07 §3.1] |
| Betting splits (bets% vs handle%) | Yes, free, but **game-level only** (DK/VSIN), not props [PRIOR: 07-07 §1.4] | Line move | **REAL-coarse** for game markets; not a prop signal |

---

## 3. The forward-test design (how a signal earns weight instead of being assumed)

**This is the deliverable that matters.** It reuses machinery that already exists rather than inventing a framework: the shadow-column pattern (market-prior), forward-only fitting, the LB90 interval bar from the fade-tier watch segments, and the graduation-gate idiom [REPO: marketPrior.js, 1bc76a5, validateG2Curves.js].

**Step 1 — Every signal enters as a STAMPED TAG, never as a weight.** When a signal fires on a row (e.g. `wind_out_15mph`, `ump_high_K`, `usage_vacated_25pct`, `hot_streak_L5`, `hype_flagged`), it is recorded on the tracked row as a tag. **Zero effect on selection.** This is the same discipline that let the archetype classifier accumulate honestly.

**Step 2 — Two scoreboards per tag, run nightly on settled rows:**
- **Outcome lift:** realized hit rate of tagged rows vs matched untagged rows in the same family × odds band. Bar: **LB90 of the lift > 0** at **n ≥ 60 decided and ≥ 3 distinct slates** (the small-n interval grammar already adopted [REPO: 1bc76a5]).
- **CLV lift:** mean CLV and positive-CLV share of tagged rows vs matched controls. Same n bars. **A signal may pass CLV and fail outcome — that is a legitimate and valuable result** (it means the signal predicts the market, i.e., bet earlier), and the report must be able to say so.

**Step 3 — Matched controls, not raw averages.** Comparing tagged rows to the whole pool would credit a signal for merely appearing on better families. Match on family × side × odds band × slate date; report n on both sides. Without this, every signal looks predictive.

**Step 4 — Multiple-testing honesty (the part everyone skips).** If we test 15 tags, roughly one will clear a 90% bar by luck alone. Two protections: (a) **pre-register** each tag's hypothesis and direction *before* it accrues data — a tag that only "works" in the opposite of its stated direction is noise, not a discovery; (b) require a **holdout confirmation window** (a fresh 30-day period after the bar is first met) before any tag touches selection. State it now so a lucky tag can't be promoted retroactively.

**Step 5 — Promotion = an ASK, never automatic.** A tag that clears both bars plus the holdout becomes a **CB ASK candidate** for entry as a small bounded adjustment (the PCE-style additive, capped, never a gate). A tag that fails is **published as failed** in the nightly artifact and retired — "hot streak died in the forward test" is a genuinely valuable public artifact for the record page.

**Step 6 — Death dates.** Every tag carries a `firstSeen` and an evaluation deadline (spec: 90 days). No permanent "still gathering data" limbo; at deadline it promotes, dies, or is explicitly re-chartered with a reason.

---

## 4. Sequenced recommendation for CA

1. **Tag infrastructure + dual scoreboard (outcome & CLV lift with matched controls)** — the whole lane depends on it; nothing else should ship first. [CB, M]
2. **Backfill the tags we can compute retroactively** (weather/air-density #28, umpire, rest, hot-streak, lineup slot) onto historical settled rows — these are deterministic from stored data, so **the forward test can start with real n instead of from zero**. Honesty rule: retro-tagged rows are stamped `retro` and reported separately from live-tagged rows (retro tagging is not a forward test — it's the prior). [CB, S-M]
3. **Bluesky beat-reporter feed → SCR alerts** (protection, needs no edge claim). [CB, S-M]
4. **Screenshot ANALYZE (tail-or-bail) revival** — highest uniqueness, and it's decision-support so it doesn't need to clear a predictive bar to be valuable. [CB, M]
5. **Hype/public-bait as a FADE tag only**, entering the same forward test as everything else. [CB, S]

**The lane's honest promise:** at the end of a season this produces a published list of which human-element signals actually earned their place and which died — with receipts. That artifact is worth more than any individual signal, and it's the thing no tout account will ever show you.

---

**Sources:** [PRIOR] 07-16 ingestion audit §1 (sources/cadence/costs) · 07-07 moonshot §1.4-1.5 (X vs Bluesky, splits granularity) · 07-29 outside-in §2 (CLV as the pro-validated indicator) · 06-29 §5 (recency + name-premium traps) · 06-15 menus · 08-11 NFL §2 (dead injury feed) · 08-15 fade-tier (LB90 grammar) · [REPO] marketPrior.js shadow pattern · validateG2Curves.js bars · commit 1bc76a5 (watch-segment promotion bar) · backend/pipeline/screenshots/ · nbaRecentFormCache/nbaRestCache · staged signals #25/#27/#28/#29 · roadmap L8.
