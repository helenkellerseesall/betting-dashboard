# MARKET-PRIOR SPEC v1 — the market's probability becomes the model's starting point
**2026-08-16 · Author: Claude-A (spec; CB builds via hard-gated ASK) · Basis: CC 07-29 §1.1 (odds = strongest single predictor; arXiv 2604.17194), Longshot Lab §4 (this is the Lab's clock-starter), NFL doc §3 (tiny-n makes market priors non-optional). Era-rule-safe by construction: the market probability is EXOGENOUS — no calibration-on-calibration.**

## 1. Plain-English purpose
Today our per-leg probability comes from our own curves alone, and the record says that
isn't beating the close. This change makes the market's own de-vigged probability the
STARTING POINT for every leg price, with our model earning deviations from it — never
the other way around. Where our curves know something real (role change, matchup, news
the line hasn't eaten), the blend moves off the market; where they don't, we stop
pretending they do.

## 2. The mechanic (one formula, no new engines)
For every scoreable leg:  p_final = w · p_market + (1 − w) · p_model
- **p_model** = the existing calibrated curve probability (unchanged pipeline; the
  calibration dampener and every PRESERVED file stay untouched).
- **p_market** = de-vigged consensus probability from the EXISTING vig-strip machinery
  (backend/pipeline/shared/vigStripping.js — read-only reuse), origination-weighted per
  sportsbookTopology (originating books weigh more than copiers), computed at serve/lock
  time and STORED on the row (auditability: every blended number must show its inputs).
- **w** (shrinkage weight, per family × odds-band): fit FORWARD-ONLY on the corpus
  accumulated since 07-16 (prediction_snapshots × outcome_snapshots), minimizing Brier
  of p_final on held-forward nights. Refit weekly (Sunday, alongside the G2 exam),
  never backward, w history committed. No hand-picked initial w — the first fit IS the
  initialization; until a family has fit support, that family runs w=1 (pure market)
  and says so on its provenance stamp.

## 3. Where it applies — and where it never touches
APPLIES: leg pricing for Daily 3 selection · Longshot Lab ticket EV · board tier/conf
display · parlay/pricer leg probs · NFL families from day one (receptions first).
NEVER TOUCHES: grading, settlement, the record, receipts, CLV capture (which measures
us AGAINST the market and must stay independent), or any PRESERVED cognition file.

## 4. Forward gate before it drives anything real (hard-gate-then-tune, Law 22-30)
Ships as a SHADOW COLUMN first: for N=14 nights every leg logs {p_model, p_market,
p_final, outcome} with zero effect on served surfaces. Graduation bars, stated now:
- pooled Brier(p_final) ≤ Brier(p_market) on the shadow window (must beat the market
  benchmark, not just our old selves), AND
- Brier(p_final) ≤ Brier(p_model) (the blend must never be worse than what we had), AND
- CLV-positive share of shadow-selected top picks ≥ current selection's share.
All three or it doesn't flip; the operator makes the flip call with the numbers in hand.
Graduation board: the market_prob_prior row flips queued→caged the night the shadow
column starts logging, with these bars as its printed unlock condition.

## 5. Honesty & safety rails
- Provenance on every card: "model 38% · market 31% · blended 33% (w=0.72)".
- p_market missing (thin market, no de-viggable pair): fail-open to p_model, labeled
  "model-only — no market consensus", counted daily; >20% model-only on a slate = alarm.
- Kill switch: MARKET_PRIOR_OFF env var reverts to p_model everywhere in one reload.
- Weekly w-refit commits its diff; a w that moves >0.15 in one refit = alarm (drift).
- New fixture (verifyMarketPrior): blend math exact, w=1 no-support path, missing-market
  fail-open label, provenance stamp, forward-only fit guard (a backward-fit attempt must
  throw), shadow isolation (served payloads byte-identical while shadowing).

## 6. Build order for CB's ASK (one pack)
(1) p_market extraction + storage at serve/lock (read-only reuse of vig-strip +
topology) · (2) shadow column logging + w forward-fit job (Sunday) · (3) provenance
plumbing (stored, not yet displayed) · (4) fixture + graduation-board row wiring ·
(5) AFTER graduation only: display + selection flip, its own mini-ASK.
CONSEQUENCES the ASK must state: files touched, the shadow log's disk cost, the Sunday
refit's runtime, and the explicit list of surfaces that flip at graduation vs stay.

*Spec ends. CB: audit against the repo, correct anything this spec got wrong about the
actual pipeline (say so plainly), then ASK with CONSEQUENCES; the build GO remains
hard-gated through CA.*
