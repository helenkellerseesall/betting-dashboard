# R2 — MLB Tier-Assignment Fix · PHASE 1 DESIGN (no code yet)

**Date:** 2026-06-11 ET · **Author:** Claude-B (Fable 5) · **Type:** design doc, shown to operator + Claude-A BEFORE any edit. Fork (a) from `phase0_bucket_tier_probe.md`.
**Honest framing (operator-mandated):** R2 makes the tier badge HONEST and the scoring base FROZEN + MEASURABLE. It is NOT expected to make picks +EV. Nothing in this doc implies profitability — every sufficient-n cell in the corpus is net-negative vig-aware, including the cells picks get demoted INTO (PLAYABLE mid-fav −6.0pp). R2 stops the badge from overpromising; making the underlying model better is future governed work on the frozen base.

---

## 1. Evidence base — sufficient-n cells ONLY (operator constraint)

From `phase0_bucket_tier_probe.md` (12 files · 11,070 settled rows · 4,603 deduped picks):

| Evidence cell | n | edge(pp) | Used for |
|---|---|---|---|
| ELITE @ mid-fav | 32 | −15.3 | Rule R2-2 |
| STRONG @ mid-fav | 49 | −11.1 | Rule R2-2 |
| PLAYABLE @ mid-fav | 119 | −6.0 | R2-2 demotion target (least-bad mid-fav cell) |
| ELITE+STRONG, family ks | 42 | −21.3 | Rule R2-3 |
| ELITE+STRONG, family totalbases | 57 | −8.4 | Rule R2-3 |
| ELITE+STRONG, family hr | 118 | −2.2 | Explicit NON-target (near market-rate) |
| STRONG @ heavy-longshot | 85 | −0.7 | Explicit NON-target (near breakeven) |

Thin cells (mid-dog 0% n=3/7, pickem badges n=6/12, hits n=11, longshot badges n=20) are **directional watch-cells for the 14d re-probe — no rule derives from them.**

## 2. The rules (all behind ONE kill-switch; OFF = byte-identical)

**Kill-switch:** `MLB_BUCKET_TIER_POLICY` — read ONCE at module load in `buildMlbPropClusters.js`; unset/`"1"` → ON; ONLY exact string `"0"` → OFF; boot log `[TIER-POLICY-BOOT] MLB bucket tier policy ON/OFF`. Exact mirror of `NBA_BUCKET_TIER_POLICY` (`nbaTierClassifier.js:81-84`) and `CALIB_LINEAWARE` precedents. Flip requires backend reload — deliberate operator action.

**R2-1 — plumbing (F1.2a analog).** Extend `tierForPlay(edge, ev, conf, family)` → `tierForPlay(edge, ev, conf, family, oddsAmerican, modelProb)` additively at `buildMlbPropClusters.js:734`; update the single call site `:959` (both values already computed locally — odds `:883`, modelProb `:904`; zero new computation). Odds bucket via the CANONICAL `bucketForOdds` imported from `nbaTierClassifier.js` (already exported; sport-agnostic odds arithmetic; importing extends the canonical per Law 1 — no duplicate). Trap-1 guard inherited: missing/invalid odds → bucket `"unknown"` → NO overrides fire → pre-R2 behavior. `modelProb` is plumbed for the stamp/observability and future governed versions; **consumed by NO v1 predicate** (see §3).

**R2-2 — mid-fav badge cap.** When policy ON and bucket === `"mid-fav"`: tier capped at PLAYABLE (ELITE and STRONG both demote to PLAYABLE; PLAYABLE/LONGSHOT unchanged). Never produces FADE → **no pick is added to or dropped from the board by this rule; only the label (and downstream stake suggestion) changes.** Applies to all families: the evidence cell is bucket-level; HR rarely prices at mid-fav so the cap barely touches it in practice. Demotion target is PLAYABLE (not STRONG) because STRONG @ mid-fav is itself a proven-bad cell (−11.1, n=49) — demoting ELITE into it would move picks from one toxic label to another.

**R2-3 — family badge cap (Law 29 family-aware).** When policy ON and family ∈ {`ks`, `totalBases`}: tier capped at PLAYABLE in ALL buckets. Evidence is the pooled family cells (n=42 / n=57). In-file precedent: the `stolenBases` PLAYABLE cap already inside `tierForPlay` (`:743`, SHIP 2). Same return-early shape, same "unproven/anti-predictive family never wears a confident badge until it earns it" logic.

**R2-4 — version stamp.** When policy ON, plays carry `tierPolicy: "mlb-r2-v1"`; `phase4Tracking.js` whitelists the field additively (`?? null`) at the three persistence sites (toTrackedMlbBestEntry `~:274` block, toTrackedMlbPick, bets path `~:818`). When OFF the field is **absent entirely** (not `"off"`) — byte-identical artifacts. Stamp presence = which rules assigned the tier; the 14d re-probe filters on it; any future scoring change MUST bump the version in a governed phase. This is what makes the frozen base mechanically auditable rather than a promise.

## 3. What R2-v1 deliberately does NOT include (and why)

- **No conviction-gate widening.** Phase 0 disproved my own earlier hypothesis: the toxic mid-fav badges carry HIGH claimed conviction (edge ≥0.10 over ~56-58% fair-implied ⇒ modelProb ≥ ~0.66), so an NBA-style ±6pp no-opinion gate would not fire on a single toxic-cell pick. The ±1pp guard at `buildMlbPropClusters.js:912` stays untouched. Widening it has NO sufficient-n evidence cell behind it.
- **No raised edge/conf thresholds.** Same reasoning that rejected P1-B in the F1.2 design: claimed edge is inverse-predictive inside the toxic cells — raising the bar selects MORE extreme claims, i.e. likely worse picks.
- **No rules from thin cells** (mid-dog/pickem badges, hits, longshot badges). Watch-cells only.
- **No HR threshold changes** (−2.2pp, n=118 — near market-rate; ECOLOGY FIX T2 stands).
- **No selection/edge/modelProb/scoring change.** Caps return PLAYABLE, never FADE → the pick set is identical; only tier labels, the stamp, and tier-derived stake suggestions change.

## 4. Expected effect — grounded in the live surface (not fabricated)

Live read 2026-06-11 ~02:4x ET, `GET edge.motel666.com/api/ws/top-picks?sport=mlb` (verbatim capture: `.scratch/r2_live_toppicks_2026-06-10.txt`): counts `ELITE 0 · STRONG 2 · PLAYABLE 9`; both STRONGs are NBA; the only MLB pick on the board (Bryan Woo, ks over 6.5, +122, mid-dog) is already PLAYABLE. **R2-v1 would change nothing on tonight's board** — its effect accrues on future slates at stamp time, whenever MLB ELITE/STRONG would have been stamped on mid-fav/ks/totalBases picks. Post-R2, MLB ELITE/STRONG become rare and skew HR-family; most picks that used to wear badges surface as PLAYABLE. That is the honest intent: badge = earned-or-absent.

## 5. Verification plan (Law 13 + Law 31 + bindings)

1. NEW fixture `backend/scripts/verifyMlbTierPolicyR2.js`: (a) OFF ⇒ byte-identical tier outputs across a golden matrix (families × buckets × edge/ev/conf grids, incl. stolenBases + HR paths); (b) ON ⇒ caps fire ONLY on mid-fav or ks/totalBases; (c) unknown-bucket no-op (Trap-1); (d) stamp present iff ON; (e) caps never emit FADE (no admission change).
2. `npm run runtime:verify` full regression matrix green; `node --check` on touched files.
3. Live closure per Law 31: production server regenerates today's `mlb_tracked_best_<date>.json` through the mutated write path with `tierPolicy` populated — non-zero probe output, no probe-only closure.
4. backend==HEAD via `/api/ws/version` after ship.
5. ~14d later: re-run `.scratch/probe_r2_mlb_bucket_tier.js` filtered to `tierPolicy === "mlb-r2-v1"` rows — clean post-R2 read, no legacy pollution.

## 6. Scoring freeze (operator milestone)

From ship: ~14 days, NO changes to MLB pick selection / edges / modelProb / tier code. Display + infra work (queue items 2-3) continues — display-only discipline already separates it. Any scoring change after the window = new governed phase + version bump (`mlb-r2-v2`), never silent.

## 7. Planned file touches (for the eventual single ship — NOT yet made)

`buildMlbPropClusters.js` (kill-switch const + tierForPlay extension + call-site + stamp) · `phase4Tracking.js` (additive `tierPolicy` whitelist ×3) · NEW `verifyMlbTierPolicyR2.js` · brain docs per Law 12 (MASTER_BRAIN current-phase, MODEL_EVOLUTION_LOG entry, PIPELINE_AUTHORITY_MAP tier-authority note). `nbaTierClassifier.js`: ZERO change (bucketForOdds already exported).

## 8. Open questions for the operator (answer before build)

1. **Mid-fav cap covers ALL families** (incl. HR, which rarely prices there) — keep for rule simplicity, or exempt HR?
2. **Both ELITE and STRONG cap to PLAYABLE** — confirm (alternative: ELITE→STRONG only, rejected above because STRONG @ mid-fav is itself −11.1).
3. **modelProb threading** — plumbed-but-unused in v1 (ready for v2 without re-plumbing). Keep or strike for minimalism?

No code edited. Awaiting operator + Claude-A review.
