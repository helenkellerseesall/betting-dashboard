# NBA READY DAY ONE — Spec for Threes, First Baskets, Points Ladders

**Date:** 2026-08-19 · **Author:** Claude-C (research, Fable 5) · **Lane:** L7 of `docs/OPERATOR_ROADMAP_2026-08-19.md` — "you spent months last season and the season ended first — that doesn't happen again."
**Target dates:** spec now (Aug) → capture at **preseason (early Oct)** → **paper picks from opening night (~Oct 20-21)**. Design only, no code. **Tags:** [REPO]/[AUTH]/[PRAC]; grades REAL/SPECULATIVE/FANTASY.

---

## 0. The headline: you are far closer than the MLB build was at the same point

Repo inventory tonight — **45 NBA pipeline modules already exist** [REPO: `backend/pipeline/nba/`], including the three things this lane needs most:

- **`buildNbaFirstBasketEngine.js`** — already a bottom-up first-basket model, not a stat prop: tip-off ~50% ± market nudge → per-team first-possession quality → per-starter `usageWeight × scoringProbability × firstShotTendency × minutesStartCertainty`, then **normalized so the five starters sum to the team's tip-weighted "scores first" probability** [REPO, read this session]. That normalization is exactly the discipline first-scorer markets need.
- **`nbaStatLadder.js`** — ladder/milestone classification with the **combo-market ordering bug already fixed** (PRA before P+R before Points, learned the hard way when a KAT P+R line rendered as Points) [REPO, comment dated 2026-05-25].
- **Capture already requests your markets:** `player_threes` **and** `player_threes_alternate`, `player_first_basket`, `player_first_team_basket`, points/rebounds/assists + all their `_alternate` suites, plus a separate 3-market defensive call [REPO: `fetchNbaOddsSnapshot.js`].

**So the honest framing: this is an AIM-AND-VALIDATE job, not a build-from-scratch job.** The gap is not machinery — it's (a) curves fit to *your three markets* under the same honesty rules MLB now has, (b) capture running early enough to have data on opening night, (c) each market carrying its own record. Grade: **REAL**.

---

## 1. Market-by-market spec

### 1.1 THREES — the cleanest of the three. GRADE: REAL.
**Model shape:** counts, small integers (0–8ish) → **the existing MLB count machinery transfers directly** — `fitPlayerFamilyCurve`'s MoM negbinom/Poisson-by-evidence fitter with half-life decay and `supportCap = maxObserved + 1` [REPO: negBinomLadder.js]. Threes are over-dispersed relative to Poisson (volume varies with minutes and game script), so expect the negbinom branch to fire — which is exactly the branch the code already picks by variance test.
**Data:** ESPN game logs are canonical + autopiloted [REPO: `nbaRecentFormCache.js`, scheduler]; `nba_api` free is the deeper upgrade path if per-possession detail is ever needed (not needed for v1).
**The NBA-specific wrinkle that must be in the fit:** threes are **minutes- and role-conditioned**. A 3PA rate per 36 minutes × projected minutes is more stable than raw per-game counts. Spec: fit the **rate**, then scale by projected minutes at serve time (the repo already has minutes/role context: `nbaRoleContextDeriver`, `nbaRecentFormCache`, `nbaRestCache`) [REPO].
**Ladder value:** `player_threes_alternate` is already captured — the "4+ threes" rungs are your parlay-leg inventory.

### 1.2 POINTS LADDERS — REAL, with one honest caveat.
**Model shape:** points are counts but with a wide, right-skewed range (0–50+). Two candidates, decided the same way the NFL spec decides yardage — **by bakeoff, not assertion**: (a) negbinom on points directly (fits the existing fitter, likely adequate), (b) a **compound shape** — `points ≈ 2×(2PM) + 3×(3PM) + FTM` — which is more faithful but multiplies parameter noise. **Recommendation: start with (a), the machinery you already have**; only pursue (b) if the bakeoff shows it beats OOS at the market's rungs. Grade of (a) REAL; (b) SPECULATIVE.
**Caveat, stated plainly:** points is the **most-attended NBA prop market** — deepest liquidity, sharpest pricing. Expect the market-prior weight to land near `w=1` here for a long time, exactly as it did for MLB hr-longshots [REPO: 2e837b5]. That's not failure; it means points ladders may serve mostly as *parlay legs priced honestly* rather than as a standalone edge.

### 1.3 FIRST BASKET / FIRST TEAM BASKET — the most interesting, and the most dangerous. GRADE: REAL to build, SPECULATIVE on edge.
**Why interesting:** it's a long-odds market (+400 to +2000 class) where the *structure* is knowable — only ~10 players can realistically score first, tip-off possession is near-50/50, and opening-possession play design is somewhat stable. Your engine already models it bottom-up with normalization [REPO].
**Why dangerous:** it is a **high-vig, public, longshot market** — the exact profile our own fade-tier audit showed loses at roughly half breakeven when un-gated [PRIOR: 08-15 fade-tier audit]. It must launch under the Lab's certified-zone discipline, not on the main board.
**Spec additions to the existing engine, all honesty-class:**
1. **Starter confirmation is a hard gate.** The engine's `minutesStartCertainty` is 1 for starters, 0 otherwise — so a wrong starting lineup silently zeroes or mis-assigns the whole distribution. Until starters are confirmed (~30 min pre-tip), first-basket rows must be **abstain-visible, not served**.
2. **Normalization must be checked at serve time:** the per-team starter probabilities summing to the team's tip-weighted total is the engine's core invariant — it deserves a fixture and a nightly assertion (this is the class of bug that hid for 12 days in cure-C [REPO]).
3. **Calibration before conviction:** run it in shadow for the first ~3 weeks of the season, grading realized first scorers vs stated probabilities, before any surface shows a tier.

---

## 2. Capture plan — so opening night has data, not excuses

| When | What | Why |
|---|---|---|
| **Now (Aug–Sep)** | Backfill last season's ESPN game logs for threes/points; verify the `nba_api`/ESPN endpoints still respond (off-season drift is real — the injuries endpoint needs a live re-verify) [PRIOR: 07-16 §4] | Curves need history the day the season starts; endpoint rot is discovered in October otherwise |
| **Preseason (~Oct 5-15)** | Flip capture ON for threes/points/first-basket + alternates; **expect junk data** (starters rest, minutes are meaningless) | The point is proving the *pipe* works — quota, market keys, join, storage — NOT fitting curves on preseason minutes. **Preseason rows must be excluded from every fit**, flagged at ingest. |
| **Opening night (~Oct 20-21)** | Paper picks live; market-prior carries early weeks at `w=1` by construction; every row stamped `prior_dominant` until in-season n accrues | Same design that protects the NFL launch [PRIOR: 08-18 NFL spec §4] — the model earns weight, it isn't granted it |
| **~Nov (weeks 3-5)** | First gate readouts per market; first-basket exits shadow only if calibrated | Evidence before conviction |

**Quota:** NBA already runs three parallel calls per event (base/DK-extra/defensive) because long market lists get silently truncated [REPO: comment 2026-05-26 — a real, hard-won lesson]. Adding nothing new; the ladder 3-pass discipline from MLB applies if alternates get expensive [PRIOR: 07-16 §6].

---

## 3. Honesty rules (carried, not re-derived)

Raw-axis era rule on any refit · support caps refuse rather than serve · abstain tallies by reason · settled rows immutable · every market carries its own record on the surface · preseason excluded from fits · starters-unconfirmed = no first-basket serve. All [PRIOR: repo doctrine, MLB-proven].

## 4. For CA triage
1. Endpoint re-verify + last-season log backfill (do in Sept, not Oct) [CB, S]
2. Threes curve via existing count fitter + minutes-rate scaling [CB, S-M]
3. Points ladder bakeoff (negbinom-direct vs compound) [CB, M]
4. First-basket: starter gate + normalization fixture + 3-week shadow [CB, S-M]
5. Market-prior NBA segments (config extension only) [CB, S]

---

**Sources:** [REPO] `backend/pipeline/nba/` (45 modules; firstBasketEngine formula; nbaStatLadder combo-ordering; fetchNbaOddsSnapshot market lists + 3-call truncation lesson) · negBinomLadder.js · commit 2e837b5 (market-prior behavior at extremes) · [PRIOR] 08-15 fade-tier audit (longshot discipline) · 08-18 NFL yardage spec (bakeoff + w=1 launch pattern) · 07-16 ingestion audit §4/§6 · `docs/OPERATOR_ROADMAP_2026-08-19.md` L7.
