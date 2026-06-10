# Wave 1 — Honest Trust Signals · AUDIT (cap unearned ELITE + pick-specific won-X%)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** audit-first — propose the approach + tonight's-pick impact, **STOP for operator nod** (no build).
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-09 22:19 ET — Claude-A. Both fixes touch what's bet on.

---

## PART B — "won X% of N similar" is misleading (the clearest one; lead with it)

**Where:** `archetypeHistoryLookup.js`. Picks from tracked_best carry no volatility/tier, so the lookup falls through to the **family-level** bucket (`_keyFam`, line 161-163) — `GROUP BY stat_family` only, no side, no line, no odds. The FE chip ("won X% of N similar") renders that family number.

**The proof (canonical, `outcome_snapshots` — the same source the lookup uses):**

| bucket | n | hit% |
|---|---|---|
| `totalbases` FAMILY (what the card shows now) | 2984 | **16.3%** |
| `totalbases` + side **UNDER** | 617 | **58.3%** |
| `totalbases` UNDER + **favorite** (implied ≥ .55) | 83 | **~70%** |
| (`totalbases` + side OVER, for contrast) | 2367 | 5.4% |

So **Langeliers UNDER 2.5 TB**: the card says "won **16.3%** of 2984" — but that's the OVER-longshot-dominated *family* rate. The pick is an UNDER favorite, whose real rate is **58% (UNDER) / ~70% (UNDER-favorite)**. The 16% is not just imprecise — it's the *opposite kind of bet's* number. This is the single biggest "the card lies" item.

**Proposed fix — a bucket ladder (most specific that clears n, else fall back, else omit):**
1. `family + side + oddsBucket` (oddsBucket from implied_prob: favorite ≥.55 · pickem .45–.55 · dog .30–.45 · longshot <.30) — when n ≥ 10.
2. `family + side` — when the odds sub-bucket is too thin.
3. `family` — last resort, **labeled as broad** (or omitted).
4. omit when even family n < 10.

Keep the honest n; soften/omit small buckets; never fabricate.

**Before/after for the 3 requested picks:**
- **Langeliers UNDER 2.5 TB:** `16.3% / 2984` (family) → **`58.3% / 617` (UNDER)**, refining to **`~70% / 83` (UNDER-favorite)**.
- **Pitcher Ks (`ks` OVER):** family `20.8% / 419` → `ks OVER` **`17.8% / 381`**. (The OVER+favorite odds sub-bucket is **n=0** in the corpus → the ladder correctly falls back to family+side, not a fabricated rate.)
- **HR (`hr` OVER):** family `10.1% / 388` → `hr OVER` **`10.1% / 388`** (all HR props are overs; implied_prob sparse on HR rows → falls back to family+side, no fake odds bucket).

This is a clean, data-driven win — the number becomes "this *kind* of pick's" rate.

---

## PART A — unearned ELITE/STRONG badges (the cap)

**Where:** the badge renders in the FE from `c.confidenceTier || c.tier` via `tierClass` (index.html:1189) + the `.tier-pill` classes (`.tier-elite` gold, `.tier-strong` blue, 516-518). `tier` is stamped upstream by the MLB classifier and flows through `/api/ws/top-picks`. The cleanest cap point is the **backend serializer** (stamp a capped display tier on the pick) so it's consistent across Top Picks + GAMES — mirroring the SB cap.

**The cap basis must be the CANONICAL vig-aware truth, not a raw cut** (anti-fabrication). The GRADES card already shows it (`buildHitRateByTier`, vig-aware, deduped): **MLB ELITE −8.4pp (n=38), STRONG −8.0pp (n=159)** — both net-negative (the inverted ladder). A quick *raw* per-(tier×family) cut hints `totalbases` ELITE/STRONG are near-breakeven (raw +2.5/+5.2pp ≈ vig-aware ~0 once the ~4–5pp vig is removed) — but that raw number is **not** the canonical method and must not be the cap basis on its own.

**Proposed rule (data-driven, ×family — not a blanket hide):** show ELITE/STRONG **only** if that `(sport, tier, family)` has **n ≥ 30 graded AND canonical vig-aware realized edge ≥ 0** (extend `buildHitRateByTier` to per-family — the same method as GRADES). Otherwise **demote to PLAYABLE + a small "tier under review" marker** (mirrors the SB cap + the GRADES "tiers under review" copy). The Wave-1 build computes the exact per-family vig-aware number; this audit reports the structure + impact.

**Tonight's impact (60 ELITE/STRONG picks across preferred books, by family):**

| family | ELITE | STRONG | graded family×tier evidence | likely outcome |
|---|---|---|---|---|
| totalbases | 16 | 20 | sufficient n (only family clearing n≥20 graded) | judged on its real number — borderline; kept iff vig-aware ≥ 0 |
| ks | 5 | 8 | thin family×tier n | **relabel** (can't prove earned) |
| outs | 3 | 4 | thin | **relabel** |
| hits | 0 | 3 | thin | **relabel** |
| walks | 0 | 1 | thin | **relabel** |

So **≈24 of the 60 high-tier picks (the thin-n ks/outs/hits/walks) relabel for sure** — they were flying ELITE/STRONG with no graded evidence. The **36 totalbases** picks (incl. the Langeliers ELITE) are judged on their real, sufficient-n track record by the Wave-1 vig-aware compute — kept if it clears 0, demoted if not. This is the honest "no badge until earned," and it's NOT blanket — totalbases gets a fair hearing on its actual record.

---

## Decision asked of the operator (STOP — no build yet)

1. **PART B:** approve the bucket ladder (family + side + odds, fall back, omit when thin). The won-X% becomes the *kind-of-pick* rate (Langeliers 16% → ~58–70%). ✅ clean, recommend.
2. **PART A:** approve the cap rule = ELITE/STRONG shown only where `(sport, tier, family)` has n ≥ 30 AND canonical (vig-aware, GRADES-method) edge ≥ 0; else demote to PLAYABLE + "tier under review". Confirm the **demote target** (PLAYABLE vs strip-to-no-badge) and the **bar** (edge ≥ 0, or a small tolerance like ≥ −2pp).
3. Acknowledge: tonight ~24/60 high-tier picks relabel for sure (thin-n families); totalbases (36) depends on its vig-aware number (computed in the build). This is the stopgap until R2 (Wave 3) cures the assignment.

No code written. Every number traces to `outcome_snapshots` / `buildHitRateByTier` / tonight's `tracked_bets`; the raw per-family cut is flagged as a hint, not the cap basis.
