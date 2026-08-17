# FADE-TIER AUDIT — Discipline or Leak?

**Date:** 2026-08-15 · **Author:** Claude-C (research, Fable 5) · **Mandate:** CA 8/15 — the weekly critic attributes ~2,400 dropped WINNING rows/week to `fade_tier`, two weeks running, biggest refuser. Question: discipline or leak?
**Method:** full replay of the critic's `fade_tier` predicate (`nightlyCritic.js:44` — tier FADE **or LONGSHOT**) over every settled row in `mlb_tracked_bets_2026-07-27 … 2026-08-16` (three weekly windows W1 07-27–08-02, W2 08-03–08-09, W3 08-10–08-16), segmented by tier-reason × family × odds band × market-move-at-close (closeImpliedProb − openImpliedProb; toward >+0.5pp, away <−0.5pp, else flat). Net = flat-$1 units over the WHOLE segment, winners AND losers, critic's own `unitsOf` math. All numbers from the tracking files via the probes in the log block. **No code changed.**

---

## Verdict up front: DISCIPLINE — overwhelmingly, in every segment large enough to trust. Plus one naming bug and two small watch-segments.

**The headline numbers (3 weeks, 135,631 settled rows, 128,589 of them fade_tier):**

| Window | fade_tier n | wins | win% | **NET at flat $1** |
|---|---|---|---|---|
| W1 (07-27–08-02) | 48,693 | 2,122 | 4.4% | **−21,812u** |
| W2 (08-03–08-09) | 47,283 | 2,447 | 5.2% | **−16,238u** |
| W3 (08-10–08-16) | 32,613 | 1,577 | 4.8% | **−12,483u** |

The critic's ~2,400 winning rows/week are real — and the same gate refused ~40,000 rows/week that NET −12k to −22k units. The gross missed-volume number the critic prints is winners-only; the net number now exists and it is catastrophic in the other direction. **Un-gating fade_tier wholesale would have been the single most expensive decision in the project's history.**

**Why the pool can't win:** every settled fade_tier row is +501 or longer (126,760 in +501–2000, 1,829 above +2000, ZERO at shorter odds); breakeven at +1000-class odds needs ~9.1% hits; the pool delivers 4.4–5.2%. The gate is refusing a population that wins at roughly HALF its breakeven rate. That is the R2/inverted-ladder cure working exactly as designed [PRIOR: project_inverted_tier_ladder].

---

## 1. Naming bug (cosmetic but misleading): `fade_tier` contains zero FADE rows

The predicate maps tier FADE **or** LONGSHOT into one bucket. Settled-tier census over the 3 weeks: LONGSHOT 128,589 · PLAYABLE 5,951 · STRONG 930 · ELITE 161 · **FADE 0**. The critic's biggest refuser is really the **longshot-tier refusal**; a FADE-quality leak (if one ever appears) would be invisible inside this bucket. → CB ASK candidate (S, report-only): split the counter into `longshot_tier` / `fade_tag`; zero behavior change.

## 2. Per-segment table (tier × family × band, n≥100 — all of them)

Every segment NET-negative; **zero positive-net segments exist at n≥100**:

| Segment (all LONGSHOT, +501–2000 unless noted) | n | win% | gross winner units | **NET** |
|---|---|---|---|---|
| totalBases | 35,856 | 5.0% | +20,331 | **−13,744u** |
| hits | 30,078 | 4.8% | +17,063 | **−11,557u** |
| rbis | 25,061 | 4.3% | +12,575 | **−11,405u** |
| runs | 20,600 | 4.8% | +10,782 | **−8,838u** |
| hr | 10,932 | 4.8% | +6,878 | **−3,529u** |
| ks | 4,233 | 6.4% | +3,153 | **−808u** |
| hr >+2000 | 1,829 | 2.7% | +1,129 | **−652u** |

The "gross winner units" column is what the eye sees in the critic (+20k on totalBases alone!); the NET column is what the bankroll would see. This table is the argument for adding the net line to the weekly critic itself (→ ASK candidate #2).

## 3. Market-move-at-close sub-segments (the leak detector; 90.5% of rows measurable)

Directionally, the CLV doctrine holds: market-toward winners > market-away in most families (hits 6.4% vs 4.1%, hr 8.7% vs 3.6%). But NET, only two sub-segments clear zero across three weeks:

- **hr × toward: n=230, 20 wins (8.7%), NET +31.0u** — the one honest leak CANDIDATE. Caveat before anyone touches the gate: ±2–3 wins of ordinary variance swings this segment ±~30u; +31u over 230 tickets at these odds is **inside one standard deviation of luck**. Not a proven leak — a WATCH segment.
- ks × away: n=643, NET +8.7u — sign-inconsistent with the doctrine (away!) and ≈ noise. WATCH only, promotion unlikely.
- Everything else negative, including every "toward" bucket outside hr (ks toward −268u, totalBases toward −1,452u) — market agreement alone does NOT rescue longshot overs.

**Watch-segment promotion test (stated now, so nobody moves the gate on vibes):** hr×toward gets a weekly line in the critic; it becomes a gate-adjustment ASK only if it holds n≥600 cumulative AND NET>0 AND a Poisson ratio test ≥1.0 at 90% confidence. Same bar for ks×away. Until then: closed.

## 4. Answer to the critic, per-segment verdicts

| Segment class | Verdict |
|---|---|
| All fade_tier families/bands at n≥100 | **DISCIPLINE — documented here, closed.** The gate refuses a half-of-breakeven population; the weekly "missed winners" line is survivorship glare. |
| hr × market-toward | **WATCH** (leak candidate inside noise band; promotion test defined above; no gate change) |
| ks × market-away | **WATCH** (weaker; same bar) |
| FADE-tag rows | **N/A — zero exist**; naming split requested so a real FADE leak could ever be seen |

**CB ASK candidates for CA triage (all report-layer, zero gate changes):** (1) split `fade_tier` → `longshot_tier`/`fade_tag` in the critic [S]; (2) add the per-segment NET line next to the gross missed-winners line in the weekly critic — this audit's §2 table, automated [S]; (3) add the two watch-segment weekly lines with the promotion bar printed [S].

---

**Traceability:** predicate `backend/scripts/nightlyCritic.js:44` · rows `backend/runtime/tracking/mlb_tracked_bets_2026-07-27…08-16.json` (21 files, 154,345 rows, 135,631 settled) · critic sample `critic_2026-08-14.json` (fade_tier 393 that night; pool 7,654 / −2,356u / 6.8% win corroborates) · probes: two read-only python passes this session (segment + market-move), outputs quoted verbatim in the 22:2x ET Claude-C log block · units math = critic's own `unitsOf`.
