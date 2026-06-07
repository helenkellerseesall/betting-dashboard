# P2 Design — Metric-Framing Fixes

**Phase:** FE-Trust-Surface-1A → P2 (synthesis rank #2). **Date:** 2026-06-07. **Status:** AUDIT complete (read-only). No code until operator approves phasing.
**Goal:** stop the daily-glance trust killers — numbers that are *honest* but *framed* so they read as "the system is broken." Evidence: `.scratch/probe_p2_01_hitrate_roi.txt`, `_02_clv_star_ev.txt`. Screenshot `ss_3575ukjvm` (GRADES).

---

## The core pattern

Every P2 item is a number that is **true** but **mis-presented**. The model isn't broken; the *framing* makes a glance say it is. Two items also expose real data gaps underneath the framing — those get flagged as separate sub-phases, not faked.

---

## Per-fix audit + classification

### 1. HIT% reads as catastrophe (GRADES) — RENDER (data already present)
"HIT 10%" (MLB) / "23%" (NBA) sits co-equal with BEAT MKT in the health row, so the eye lands on it as the verdict. It's W/(W+L) on a **longshot-heavy** book (HR overs at +400…+900 hit ~10%) — not a sample problem (MLB n=4988 settled, NBA n=2372). The honest edge metric **already exists in the payload**: `beatMarketRate` (MLB 0.147), `clvSumCents` (16.89), `clvBeatMarket` (593).
- **Fix (render):** lead with "**Beating the market 14.7%**" as the headline metric; demote HIT% with a qualifier ("raw W/L · longshot-heavy book — expected low; the edge is in beating the close") and show the settled denominator. No backend — reframe what's there.
- **Visual:** make BEAT MKT the large/colored number; HIT% smaller + grey with the qualifier; show "n=4,988 settled."

### 2. ROI −100% on 2 bets (MY BETS) — RENDER
`placedBets.count = 2`, `roi = -1`. A −100% headline on n=2 reads as "system loses everything."
- **Fix (render):** sample-size guard — suppress or tag ROI/hit when settled `n < ~20` ("small sample · n=2 · not yet meaningful"). The count is present; pure render.
- **Also:** GRADES says "no bets placed yet" while MY BETS shows 2 — reconcile the cross-surface copy.

### 3. NBA CLV bare "—" / 0% (GRADES) — RENDER label + a DATA-GAP sub-phase
`clvStamped = 0` across all 7 NBA days; `beatMarketRate/avgClvCents = null`. The card shows bare "—", which reads as "0% / we lose every line." But it's **not measured** — `captureClosingLines` runs NBA (not skipped) yet never lands (suspect: the NBA `snapshot.json`/`rawProps` source or eventTime eligibility — needs runtime trace).
- **Fix (render, now):** label it "**NBA CLV — capture pending (not yet measured)**" so "not measured" ≠ "measured bad."
- **Sub-phase (separate, data):** `NBA-CLV-Capture-Repair` — diagnose `loadSnapshotRawProps('nba')` output + eventTimeMap size + scheduler tipoff timing. This is a pipeline repair, not framing.

### 4. ⭐ on a negative-edge pick (GAMES) — small BACKEND LOGIC
`isTopPick` (⭐) = membership in `topKeys`, built purely from tier slices (ELITE/STRONG/PLAYABLE) — it never checks edge sign (workstationRoutes:2673-2688). So a tier-ranked pick that went negative-edge after dampening still gets ⭐, while TOP PICKS already filters those out. Inconsistent — the ⭐ marks a pick the engine wouldn't back.
- **Fix (backend, ~1-2 lines + reload):** exclude `edge <= 0` (or `< threshold`) from `topKeys` so ⭐ means "worth betting," consistent with TOP PICKS' dampener gate.

### 5. Lotto EV +1996% (SLIPS) — RENDER framing
The `ev` is the engine's real field, mathematically consistent (2-3% model × ~800x payout). Honest, but a four-figure EV% next to a 2% prob reads as "free money." The lotto narrative already says "Longshot upside — small stake / asymmetric payoff."
- **Fix (render):** pair EV with a variance tag ("moonshot · high variance · small stake · expect to lose most"), or de-emphasize raw EV% on lotto tier and lead with the realistic hit prob + the small-stake note.

---

## Deferred data-gap sub-phases (not P2 framing — flagged, not faked)

- **NBA-CLV-Capture-Repair** — fix the actual NBA closing-line capture (blocks BEAT MKT/AVG CLV/CLV for all NBA). Real pipeline gap.
- **HIT% by-odds-tier + hit-vs-implied** — not in the payload; needs backend to bucket settled picks by odds tier + compute implied-from-odds. The richer version of fix #1.

---

## Ranked phasing (by daily-glance trust impact, cheap-first)

1. **HIT% reframe (#1)** — scariest number, fix is cheap, data already there. Highest impact.
2. **ROI small-sample guard (#2)** — −100% reads as broken; trivial render.
3. **NBA CLV honest label (#3a)** — "capture pending"; cheap; stops the "0%/—" misread.
4. **⭐ edge-gate (#4)** — small backend; makes the star trustworthy.
5. **Lotto EV framing (#5)** — lower surface; light render.

**Recommended packaging:** ship **1 + 2 + 3a + 5 as one FE render bundle** (all in `index.html` renderGrades/renderMyBets/renderSlips — one file, one commit, no backend reload), then **#4 as a small backend follow** (workstationRoutes topKeys filter + reload). Schedule the two data sub-phases (NBA-CLV-Capture-Repair, HIT% by-tier) separately.

Each build keeps the rhythm: show-before-edit, verify at the rendered FE (the binding rule), never fabricate a metric, Trap-1 num guards on every field read.

*Audit complete. No code changed.*
