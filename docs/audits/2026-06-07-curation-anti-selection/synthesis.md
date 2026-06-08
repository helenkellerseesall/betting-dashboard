# Curation-AntiSelection-Audit-2A (R2) — Synthesis

**Date:** 2026-06-07. **Status:** READ-ONLY audit complete — no code, config, or dampener changes.
**Strands:** `.scratch/audit_r2_strand1_classifier.txt`, `_strand2_dampener_selection.txt`, `_strand3_silent_stream.txt`. Source probes: `.scratch/probe_hit_recency_pre_post.txt` (R1), `probe_hit_tier_inventory.txt` (T1 #2), plus this turn's tier×bucket×window probe and the post-calib settled-sample trace.
**Bridge:** executed per Claude-A DRAFT_HANDOFF (task #102) under CLAUDE_BRIDGE_PROTOCOL.md.

---

## Headline findings (one per strand, plus one nobody asked for)

**S1 — The anti-selection mechanism is real and located.** Both tier classifiers are **raw-model-edge threshold ladders** — NBA `nbaTierClassifier.js:154-157` (edge ≥0.12 → ELITE, ≥0.07 → STRONG, ≥0.04 → PLAYABLE; conviction <0.06 → FADE) and MLB `buildMlbPropClusters.js:722` (edge ≥0.1 + ev + conf → ELITE). The pre-calib corpus shows realized hit rate **inverts the tier ladder in all three mid buckets** (FADE/PLAYABLE outperform STRONG/ELITE; e.g. midfav FADE 61.9% vs STRONG 41.0%; pickem ELITE 20.9% — worst in bucket). ELITE simultaneously carries the *highest* mean claimed edge (0.124-0.174). In mid buckets, the model's claimed edge is **inversely predictive**, so an edge-ranked ladder systematically promotes the most-overconfident picks. That is the anti-selection.

**S2 — The dampener changed selection in the *designed* direction, which currently amplifies S1.** Post-calib, the curated share of mid-bucket picks **rose** (midfav 77.5%→88.7%, pickem 51.5%→56.0%, middog 53.4%→66.8%; FADE share shrank). This matches Calibration-LineAware-1A's intent (stop over-suppressing easy lines) — expected, not a defect — but it pushes *more* mid-bucket picks through the inverted ladder until S1 is fixed. Post-calib *realized* quality is unreadable this turn (~1 slate-day, see S4).

**S3 — The "silent uncurated mid-stream" was an analysis artifact, fully dissolved.** Post-calib FADE mid-bucket entries exist (n=24/96/176) but are `result=pending` — they're dominated by NBA picks for **games that haven't played yet** (the NBA file-date offset from the CLV audit). Not a logging change, not a grading defect, not a threshold change. No pipeline fix needed.

**S4 — Methodological finding affecting every hit-rate analysis to date: per-book duplication.** The alarming post-calib "0/48 ELITE/STRONG settled" collapses to **~4-5 distinct bets** logged once per book (Yamamoto ks-over ×~9 book-lines, Pages TB-under ×3, McLean ks ×2 — all one slate). All n's in T1 #2 and R1 are inflated by book-duplicates; effective samples are several-fold smaller. The S1 inversion *direction* survives (consistent across 3 buckets × 2 windows — duplication alone can't produce that), but **every magnitude needs a deduped re-run before being quoted**.

---

## Ranked fixes

**Strand 1 (anti-selection):**
1. **F1.1 — Deduped + vig-aware re-probe (read-only, prerequisite).** Re-run tier×bucket realized analysis deduped by `player|family|side|line|slateDate` (and vig-stripped where oppOdds permits) to size the TRUE inversion. Scope: probe only. Risk: none. Bettor delta: none (gates the next two). Everything below depends on this.
2. **F1.2 — Tier on corpus-calibrated edge, not raw edge (engine change, own phase).** The ladder should rank by realized-calibrated edge (the calibration corpus already computes per-family/line realized-vs-stated) instead of raw model edge. Scope: nbaTierClassifier + MLB cluster tiering + design review. Risk: bet-affecting, PRESERVED-adjacent (operator design gate). Bettor delta: curated picks stop anti-selecting — the core fix.
3. **F1.3 — Interim exposure guard (operator call, optional).** Until F1.2, an operator-policy cap on mid-bucket ELITE/STRONG surfacing. Small, but visibly changes TOP PICKS — only with explicit operator approval.

**Strand 2:** **F2.1 — no action.** Selection shift is designed line-aware behavior. Re-evaluate post-calib realized at 7-14 days *with F1.1 method*.

**Strand 3:** **F3.1 — method fix only.** Hit-rate analyses must dedup per-book, treat NBA tracked_bets as containing future games, and never read 1-day post windows. Documented here; no pipeline change.

**Dependency order:** F1.1 → (re-read S1 magnitudes) → operator decides F1.2 design phase (and whether F1.3 interim guard is wanted) → F2.1 re-eval rides the same deduped method at 7-14d.

---

*Every number above traces to this turn's probes (.scratch/ files named in header) or file:line citations. No edits shipped.*
