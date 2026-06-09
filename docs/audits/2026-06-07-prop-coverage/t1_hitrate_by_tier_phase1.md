# T1 #2 — HIT%-by-Tier Honest GRADES Card · PHASE 1 (build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator nodded PHASE 0 fork (a)+(b); number twice-verified by 4.8 + Claude-A, re-confirmed at build time).
**Companion:** `t1_hitrate_by_tier_phase0.md` (the audit + live table + fork).

---

## What shipped

The GRADES tab now renders a **TRACK RECORD BY TIER** card: realized hit% vs the vig-stripped fair price the book charged, per confidence tier, over the full graded ledger. It shows the **inverted tier ladder honestly** — the badges that claim the most confidence (ELITE/STRONG) currently realize the worst.

### Files (3)

- **NEW** `backend/pipeline/tracking/buildHitRateByTier.js` — net-new per-tier vig-aware compute. Reporting-only (never a calibration input). Reuses **PRESERVED** `vigStripping.js` (untouched). Mirrors the canonical F1.1/Step-1 method exactly (dedup `player|family|side|line|slateDate`, book excluded; fair-implied via opposite-side recovery, raw-implied fallback). Exports `computeHitRateByTier(sport, { trackingDir })`.
- `backend/routes/workstationRoutes.js` — `/api/ws/grades-health` gains an additive, fail-safe `out.hitRateByTier` (full graded corpus, NOT the `days` CLV window). A compute error attaches `{error}` and never breaks the existing CLV payload.
- `frontend/mobile/index.html` — `_fetchGradesHealth` renders the per-tier card after the CLV blocks (MLB first). One existing-copy update: the placeholder "by-tier breakdown soon" → "see by-tier track record below".

## The live numbers it renders (= the canonical probe, byte-for-byte)

`computeHitRateByTier` output was diffed against `.scratch/probe_t1_hitrate_by_tier.js` — **identical** on every cell:

**MLB** (11 graded days, 3,896 deduped): ELITE n=38 32% **−8.4pp** · STRONG n=159 21% **−8.0pp** · PLAYABLE n=372 43% −0.8pp · LONGSHOT n=3327 4% −3.0pp
**NBA** (12 graded days, 1,259 deduped): ELITE n=35 17% **−31.3pp** · STRONG n=47 47% −5.3pp · PLAYABLE n=190 41% −2.2pp · FADE n=987 21% −4.9pp

## Honesty rails (binding — this IS the trust number)

- Every number traces to `{sport}_tracked_bets_*.json` + `vigStripping`. No fabrication anywhere.
- A tier with zero settled rows is **omitted** (never shown as 0). A tier with n<30 sets `insufficient:true` → FE renders "not yet meaningful" instead of a rate.
- NBA block labeled "pre-F1.2 fix corpus · re-checks ~14d" (NBA graded corpus predates the F1.2a/b tier fixes).
- Card framing line is neutral, not alarmist: "Higher tiers aren't beating the market yet — judge picks by the stats, not the badge. Tier ranking is under review."

## Verification (this side)

- `node --check` clean on both backend files; FE script body `new Function()` clean (3,716 lines).
- Parity: route compute == standalone probe on all 8 cells (printed both).
- Additive + fail-safe: existing `out.sports`/CLV health path unchanged; FE renderSport path unchanged except the one promised-placeholder copy line.
- **LIVE render proof is Claude-A's step** (backend runs on the operator host): operator reloads backend, Claude-A screenshot-verifies the card on `/m` GRADES (real per-tier numbers + honest n-flags + the inversion visible).

## Next (the real cure, separate track)

The card shows the *symptom*. The queued **MLB-TIER-ASSIGNMENT-FIX (R2)** is the *cause* fix — why MLB ELITE/STRONG are anti-predictive (analogous to F1.2 but MLB-side). Own audit-first track + operator sign-off; ~14d to verify like F1.2.
