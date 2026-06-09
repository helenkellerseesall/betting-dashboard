# T1 #2 — HIT%-by-Tier Trust Surface · PHASE 0 (audit-first)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** read-only PHASE 0 — NO code. Operator eyeballs the live table + render site before PHASE 1.
**Probe:** `.scratch/probe_t1_hitrate_by_tier.js/.txt` (canonical F1.1/Step-1 vig-aware read via PRESERVED `vigStripping.js`).

---

## 1. The live per-tier table (operator: read this first — it's the whole point)

Realized hit% vs vig-stripped fair-implied%, BY TIER, from the graded ledger (`{sport}_tracked_bets_*.json`). Dedup key `player|family|side|line|slateDate` (book excluded). **Edges are ~1–3pp PESSIMISTIC** (vig recoverable on only 0.4–1.0% of picks → mostly raw-implied fallback; true edges are a bit less negative).

**MLB** — 11 files, 3,896 deduped graded picks:

| tier | n | hit% | fair-impl% | edge(pp) |
|---|---|---|---|---|
| ELITE | 38 | 31.6 | 40.0 | **−8.4** |
| STRONG | 159 | 20.8 | 28.7 | **−8.0** |
| PLAYABLE | 372 | 42.5 | 43.2 | **−0.8** |
| LONGSHOT | 3327 | 4.4 | 7.4 | −3.0 |

**NBA** — 12 files, 1,259 deduped graded picks:

| tier | n | hit% | fair-impl% | edge(pp) |
|---|---|---|---|---|
| ELITE | 35 | 17.1 | 48.5 | **−31.3** |
| STRONG | 47 | 46.8 | 52.1 | −5.3 |
| PLAYABLE | 190 | 41.1 | 43.3 | −2.2 |
| FADE | 987 | 20.9 | 25.8 | −4.9 |

### What this honestly says (the trust number)

**The tier ladder is INVERTED on the graded corpus: ELITE and STRONG — the badges that say "trust me most" — realize the WORST.** MLB ELITE/STRONG are ≈−8pp, worse than PLAYABLE's −0.8pp. NBA ELITE is −31pp (n=35, volatile but clears the n≥30 bar). **Every tier is net-negative vig-aware.** PLAYABLE is the least-bad on both sports (≈breakeven on MLB).

This is the same anti-selection the R2/Step-1/F1.2 work found, now quantified at the tier level. **Honest caveats to render with it:**
- ELITE cells are **small** (MLB n=38, NBA n=35) — just over the n≥30 bar; a few picks swing them. They're directional, not precise.
- The NBA corpus **predates the F1.2a/b tier fixes** (shipped 2026-06-07–08); their effect needs the 14-day re-probe before NBA ELITE/STRONG can be re-judged.
- The MLB tier ladder ranks by raw model edge (R2 finding) — which is why its "best" tier underperforms.

**The surface's job is to show THIS** — so the operator sees that today the tier badge is *not yet earned* (and which tier, PLAYABLE, is actually the most reliable). That is the T1 trust number, and it's not flattering — which is exactly why it belongs on screen.

---

## 2. PHASE 0 answers

- **DATA SOURCE — confirmed clean.** Graded ledger carries `tier` + `oddsAmerican` + `result` on every settled row (MLB 9003/9003, NBA 3596/3596). No gap.
- **EXISTING vs NET-NEW.** `buildGradingSummary.byTier` already computes a **RAW** per-tier hit% (`wins/(wins+losses)`) — but **no fair-implied / vig-aware edge**. The honest "vs market" edge-by-tier (the trust number above) is **net-new**. `family_calibration.json` is per-family, not per-tier — also no overlap.
- **COMPUTE METHOD.** Reuse the canonical F1.1/Step-1 vig-aware read via PRESERVED `vigStripping.js` (dedup, fair-strip, realized vs fair, by tier). Do NOT reimplement vig. Same method as `step1_trust_proof.md`.
- **RENDER SITE.** The **GRADES tab** — `renderGradesView` (frontend/mobile/index.html:2350), which already renders the P2a `hitRate` + `beatMarketRate` ("beat-market") honest-edge bundle. Add a per-tier card there; **do not spawn a parallel surface.** Data window: the **multi-day** graded corpus (like `/api/ws/grades-health?days=7`), NOT `/api/ws/ledger/yesterday` (single day = n far too thin per tier). So the by-tier card belongs in the multi-day/health section, backed by a small new backend compute.
- **SPORT SCOPE.** **MLB-first** (3,896 graded vs NBA 1,259; NBA Finals ending shrinks NBA sample further). Both have data; render MLB, offer NBA as a toggle or a second block.
- **HONESTY RAILS.** Every cell n<30 → "not yet meaningful" label (not a rate); tiers never blended; every number traces to ledger + `vigStripping`. (In the current corpus all shown tiers clear n≥30, but ELITE is borderline — render the n so the operator weights it.)

---

## 3. Decision fork

**FORK (i)** — clean data + clear render site → ready for PHASE 1. One judgment call for the operator, because the finding is bigger than a UI card:

**This surface will tell the operator their ELITE/STRONG badges are currently anti-predictive.** That's honest and it's the point — but it also means the natural follow-on is *fixing the tier assignment* (the R2/anti-selection engine work), which is a separate, larger track than rendering the number. PHASE 1 here is just the honest **render** (show the real per-tier track record + thin-n flags). The engine fix (why ELITE underperforms) is the deeper queued item.

**Operator decides:** (a) build the render now (show the honest tier track record on GRADES, MLB-first) — recommended, it's the T1 trust number; (b) also queue the engine-side tier-assignment fix as the real remedy; (c) hold.

No code written. Awaiting nod on render site + scope (and acknowledgment of the inverted-tier finding).
