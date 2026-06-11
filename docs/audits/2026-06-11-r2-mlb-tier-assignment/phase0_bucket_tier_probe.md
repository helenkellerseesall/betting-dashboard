# R2 — MLB Tier-Assignment Fix · PHASE 0 (read-only bucket × tier probe)

**Date:** 2026-06-11 ET · **Author:** Claude-B (Fable 5) · **Type:** read-only PHASE 0 — NO code changes. Operator + Claude-A review this table before ANY threshold design.
**Probe:** `.scratch/probe_r2_mlb_bucket_tier.js` → `.scratch/probe_r2_mlb_bucket_tier.txt` (run 2026-06-11; canonical F1.1/Step-1 method via PRESERVED `vigStripping.js`).

---

## 1. Why this probe exists

The inverted-ladder finding (`docs/audits/2026-06-07-prop-coverage/t1_hitrate_by_tier_phase0.md`) showed MLB ELITE −8.4pp / STRONG −8.0pp vig-aware. F1.2 fixed the NBA classifier from per-bucket evidence (F1.1 probe); MLB never got the equivalent. This probe is the MLB analog: it locates WHICH odds buckets and stat families make ELITE/STRONG anti-predictive, so R2 thresholds are set ONCE from data (operator stability milestone: frozen base, no threshold churn).

**The structural gap being measured** — `tierForPlay(edge, ev, conf, family)` at `backend/pipeline/mlb/buildMlbPropClusters.js:734` stamps ELITE/STRONG from edge/EV/conf alone. It never sees modelProb or odds. The ONLY no-opinion protection on the MLB path is the coin-flip drop at **`backend/pipeline/mlb/buildMlbPropClusters.js:912`**:

```
if (modelProb > 0.49 && modelProb < 0.51) {
```

— a ±1pp band, vs the NBA classifier's ±6pp FADE / ±10pp PLAYABLE-cap conviction gates (`nbaTierClassifier.js:224-225`). Both modelProb (`:904`) and odds (`:883`) are already computed at the tier call site (`:959`), so threading them is additive.

## 2. Method (canonical, unchanged from t1/F1.1 probes)

Graded ledger `mlb_tracked_bets_*.json`, settled rows only (win/loss). Dedup key `player|family|side|line|slateDate` (book excluded), median American odds per pick. Fair-implied via PRESERVED `vigStripping.js` when the opposite side is recoverable (18/4603 = 0.4%), else raw-implied fallback — **edges ≈1–3pp PESSIMISTIC** (true edges slightly less negative). Bucket boundaries exactly match `nbaTierClassifier.bucketForOdds` (F1.2a, ≤ semantics). Tiers/buckets never blended; n<30 cells labeled not-yet-meaningful.

Corpus: **12 files · 11,070 raw settled rows → 4,603 deduped graded picks (0 collisions)**.

## 3. The full table (verbatim probe output)

```
── SECTION A: per-bucket aggregate (all tiers) ──
bucket         |   n  | hit%  | fair-impl% | edge(pp) | flag
mid-fav        |  200 |  49.0 |     57.7   |  -8.7 |
pickem         |  114 |  39.5 |     48.5   |  -9.0 |
mid-dog        |  235 |  38.7 |     41.4   |  -2.7 |
longshot       |   75 |  17.3 |     20.6   |  -3.2 |
heavy-longshot | 3979 |   5.6 |      8.0   |  -2.4 |

── SECTION B: ELITE by bucket (tier n=56) ──
bucket         |   n  | hit%  | fair-impl% | edge(pp) | flag
mid-fav        |   32 |  40.6 |     56.0   | -15.3 |
pickem         |    6 |  33.3 |     42.3   |  -9.0 | INSUFFICIENT-N (not yet meaningful)
mid-dog        |    3 |   0.0 |     46.3   | -46.3 | INSUFFICIENT-N (not yet meaningful)
heavy-longshot |   15 |   6.7 |     11.9   |  -5.2 | INSUFFICIENT-N (not yet meaningful)

── SECTION B: STRONG by bucket (tier n=173) ──
bucket         |   n  | hit%  | fair-impl% | edge(pp) | flag
mid-fav        |   49 |  46.9 |     58.1   | -11.1 |
pickem         |   12 |  25.0 |     41.3   | -16.3 | INSUFFICIENT-N (not yet meaningful)
mid-dog        |    7 |   0.0 |     45.4   | -45.4 | INSUFFICIENT-N (not yet meaningful)
longshot       |   20 |  10.0 |     18.4   |  -8.4 | INSUFFICIENT-N (not yet meaningful)
heavy-longshot |   85 |  12.9 |     13.7   |  -0.7 |

── SECTION B: PLAYABLE by bucket (tier n=519) ──
bucket         |   n  | hit%  | fair-impl% | edge(pp) | flag
mid-fav        |  119 |  52.1 |     58.1   |  -6.0 |
pickem         |   96 |  41.7 |     49.8   |  -8.1 |
mid-dog        |  225 |  40.4 |     41.2   |  -0.7 |
longshot       |   55 |  20.0 |     21.3   |  -1.3 |
heavy-longshot |   24 |  16.7 |     13.9   | +  2.7 | INSUFFICIENT-N (not yet meaningful)

── SECTION B: LONGSHOT by bucket (tier n=3855) ──
bucket         |   n  | hit%  | fair-impl% | edge(pp) | flag
heavy-longshot | 3855 |   5.4 |      7.8   |  -2.4 |

── SECTION C: ELITE+STRONG by stat family ──
family         |   n  | hit%  | fair-impl% | edge(pp) | flag
hits           |   11 |  18.2 |     51.5   | -33.3 | INSUFFICIENT-N (not yet meaningful)
hr             |  118 |  11.9 |     14.0   |  -2.2 |
ks             |   42 |  31.0 |     52.2   | -21.3 |
outs           |    1 |   0.0 |     53.5   | -53.5 | INSUFFICIENT-N (not yet meaningful)
totalbases     |   57 |  45.6 |     54.1   |  -8.4 |
```

## 4. Honest reading (observations only — NO threshold design yet, per operator gate)

- **The toxic sufficient-n cells are on the FAVORITE side**: ELITE mid-fav −15.3pp (n=32) and STRONG mid-fav −11.1pp (n=49). MLB's pathology lives at mid-fav — a different bucket than NBA's (pickem/mid-dog). The F1.2b override predicates do NOT port verbatim; MLB needs its own, which is exactly why this probe ran.
- **Pickem looks consistent with mid-fav** (ELITE −9.0 n=6, STRONG −16.3 n=12, PLAYABLE −8.1 n=96 sufficient-n) but the badge cells are thin — directional only.
- **STRONG heavy-longshot is near-breakeven** (−0.7pp, n=85) — confident-tier longshots are NOT the problem cell.
- **By family (Section C): ks (−21.3pp, n=42) and totalbases (−8.4pp, n=57) carry the sufficient-n damage; hr is only −2.2pp (n=118)** — the HR-specific thresholds (ECOLOGY FIX T2) appear roughly market-rate; the generic `!isHr` ELITE/STRONG path (conf ≥0.56/0.42 + edge ≥0.10/0.075) is what's selecting anti-predictive picks, concentrated in pitcher-Ks and total-bases on favorite-side odds.
- Pattern consistent with overconfident modelProb on favorite sides: claimed edge ≥0.10 against a fair-implied ~56-58% favorite means the model asserts ~66%+ — and realizes 41-47%.
- Caveats: vig recovery 0.4% → edges pessimistic by ~1-3pp (does not change the ordering); mid-dog ELITE/STRONG 0% cells are n=3/7 — never design from those alone.

## 5. Decision fork (operator picks before any design)

- **(a)** Proceed to R2 Phase 1 design from these measurements: thread modelProb + oddsAmerican into `tierForPlay`, MLB conviction gate, bucket-aware demotions targeting the proven cells (mid-fav first), family-aware per Law 29 — single governed ship behind `MLB_BUCKET_TIER_POLICY`, additive `tierPolicy: "mlb-r2-v1"` stamp, ~14d scoring freeze. Design doc shown before any edit.
- **(b)** Extend the probe first (e.g., side split over/under within toxic cells, conf-band split) if the operator wants deeper evidence before design.
- **(c)** Hold.

No code changed. Awaiting operator + Claude-A review of this table.
