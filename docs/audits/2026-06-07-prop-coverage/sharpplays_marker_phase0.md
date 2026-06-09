# Sharp Plays Honesty Marker — PHASE 0 (predicate + copy + counts)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** read-only PHASE 0 — NO code. Operator nods predicate + copy + scope before PHASE 1.
**Probe:** `.scratch/probe_sharpplays_marker.js/.txt` (real dampener over the 163-row live candidate pool `mlb_tracked_best_2026-06-08`).

---

## 0. The finding that reframes the fix (read first)

**Every Sharp Plays row shows a raw, not-calibration-adjusted edge — it's the whole tab, not a subset.** And it is **NOT Sharp-Plays-unique**: `applyCalibrationDampener` is line-aware, and the line-aware corpus has **no buckets above line 1.5**, so it **no-ops on every alternate-line longshot** — on TOP PICKS and GAMES too. Verified: `applyCalibrationDampener` on rbis/hr/hits/tb alt-lines all return no-op. So the alt-line-heavy MLB board shows raw edges on **every** surface; the calibration dampener only ever adjusts standard-line (0.5/1.5) picks, which are rare on this board.

So the honest marker isn't "Sharp Plays skipped a step everyone else does" — it's "**these longshot edges aren't calibration-backed anywhere**, and Sharp Plays is the surface that leans hardest into them."

---

## 1. Predicate variants — tagged-row counts (163-row pool)

| Variant | Tags | Meaning |
|---|---|---|
| V1 line-aware no-op | **163/163** | every row (board is all alt-line) — too blanket as a per-row badge |
| V2 NO calibration at all (line-aware AND id-join both no-op) | **88/163** | genuinely uncalibrated families — **RBIs (38) + HR (50)** |
| V3 calibration EXISTS but row shows RAW (id-join would move, line-aware empty) | **75/163** | **hits (33) + total_bases (42)** — family calibration says lower, surface shows raw |
| V4 no-calibration AND longshot odds (≥ +250) | 88/163 | the "bold edge on unverified longshot" core (= all of V2) |
| V5 Step-1 vig-negative family (rbis) | **38/163** | families Step-1 showed realized-negative (RBIs −11.9pp) |

**V2 ∪ V3 = 163 = the whole tab** (every family is either "no calibration" or "calibrated-but-shown-raw"). Per-family: hr/rbis are all V2; hits/tb are all V3.

So a per-row "not calibration-backed" badge would tag **100%** of Sharp Plays — honest, but visually it's a blanket, which is really a **tab-level** statement.

---

## 2. Recommended approach (operator picks — these are the design forks)

**RECOMMEND: a hybrid — tab-level honesty line + a per-row escalation on the worst families.**

- **Tab-level disclaimer** (one line at the top of Sharp Plays, since the condition is the whole tab): plain, honest, e.g.
  > *"Raw model edges — not calibration-adjusted. Less reliable than TOP PICKS."*
  This is the truthful framing of the actual situation (whole-tab raw) without 163 repeated badges.

- **Per-row escalation badge ONLY on the genuinely-worst rows** — V5, the Step-1 vig-negative families (RBIs, 38 rows): a small
  > *"⚠ family historically below break-even"*
  badge. This is the one that protects the bankroll-draining bet the operator flagged (the +29% RBIs longshot). It's a stronger, narrower, evidence-backed claim (ties to `step1_trust_proof.md` realized −11.9pp), distinct from the generic "raw" framing.

**Why not the alternatives:**
- *Per-row "RAW · UNCALIBRATED" on all 163* — honest but blanket noise; the tab-line says the same thing once.
- *Wire applyCalibrationDampener into Sharp Plays* — cosmetic: it no-ops on the alt-lines that dominate the tab (confirmed §0), so it would change almost nothing.
- *Apply the id-join (family-level) calibration to alt-lines* — this WOULD move hits/TB ~4–8pp and is arguably the real engine fix, but it's a **calibration-engine change** (touches the PRESERVED dampener's line-vs-id-join logic), not a marker — bigger, separate decision.

---

## 3. Compute + render sites (for PHASE 1, after nod)

- **Backend flag (additive, real condition):** in the `/api/ws/state` candidate assembly (`workstationRoutes.js`, where `enrichedBest`/`candidates` are built), stamp each candidate with `calibrationStatus: "uncalibrated" | "calibrated_shown_raw" | "calibrated"` computed from the **real** dampener condition (`dampenModelProb(...) === modelProb` per family/side/line + the id-join check). Never fabricate "calibrated."
- **Tab flag:** a boolean on the Sharp Plays payload (or derive in FE from "all candidates uncalibrated") to show the tab-level line.
- **FE render:** the tab-level line in the Sharp Plays header; the per-row escalation badge in `renderCard` for rows whose family is Step-1-negative. FE only renders a flag the backend computed — never invents one.

---

## 4. Decision asked of the operator (STOP here)

1. **Scope:** tab-level disclaimer + per-row escalation on Step-1-negative families (recommended) — OR per-row "raw" on all — OR tab-level only?
2. **Copy:** the two strings above (tab line + escalation badge) — exact words your call.
3. **Out of scope unless you want it:** the deeper engine fix (apply family-level calibration to alt-lines so hits/TB edges actually drop). That's a PRESERVED-dampener change, separate from the marker.

No code written. Awaiting nod on predicate scope + copy.
