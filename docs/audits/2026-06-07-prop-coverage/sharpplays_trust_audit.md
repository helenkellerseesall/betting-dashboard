# SHARP PLAYS Trust Audit — two traces (read-only)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** read-only, no code, zero bettor delta
**Surface:** SHARP PLAYS tab = `payload.candidates` from `/api/ws/state` (FE `index.html:1548`). Operator would bet from it → its honesty is T1.
**Probe:** `.scratch/probe_sharpplays_calib.js/.txt` (real `applyCalibrationDampener`/`dampenModelProb` over live board picks). **STOP after report — no fix this turn (both bet/trust-affecting).**

---

## TRACE 1 — is the Sharp Plays edge calibration-dampened or RAW? → fork (b), with nuance

**Structural (definitive):** `applyCalibrationDampener` is called in exactly two places — `/top-picks` (workstationRoutes:2567) and `/games-browser` (:2776). **`/api/ws/state` — the route that builds the `.candidates` SHARP PLAYS renders — never calls it.** So Sharp Plays shows the **un-dampened edge** and **no calibration badge** (no "raw +Xpp −Ypp cal" breakdown that GAMES shows). Fork (b) confirmed.

**Magnitude — and this is the honest nuance:** running the real dampener over the 163 live board picks:

| family | n | line-aware moves | id-join moves | mean id-join model-cut |
|---|---|---|---|---|
| hits | 33 | 0 | 33 | −8.2pp |
| total_bases | 42 | 0 | 42 | −4.2pp |
| rbis | 38 | 0 | **0** | — |
| hr | 50 | 0 | **0** | — |

- `applyCalibrationDampener` passes the prop **line** → line-aware path. The board is **alt-line-heavy** (high lines 2.5+), and the line-aware corpus has **no buckets above line 1.5** → it **no-ops on every board pick** (even in top-picks/games, which call it). So the dampener barely touches the longshot board regardless of route.
- The **id-join** (line-null) path *would* cut hits ~8pp / total-bases ~4pp — but **RBIs and HR have no calibration that moves at all**.

**Operator's example (Jase Bowen RBIs OVER 1.5, model 0.4506, edge +29%):** the dampener **no-ops** at every line and id-join — *applying it would not change the +29%* (there is no RBIs-over calibration to apply).

**So the real trust hole is broader than "skipped the dampener":** Sharp Plays surfaces **high-RAW-edge longshots on families with no calibration and no honesty marker** — and Step-1 showed those families net-negative vig-aware (RBIs PLAYABLE **−11.9pp**, `step1_trust_proof.md`). The bare "+29%" reads as a strong edge on a market that historically loses. The dampener-skip is a symptom; the disease is **no "less reliable / uncalibrated" framing on raw longshot edges.**

**Fix design (NOT shipped — operator decides):**
1. *Parity (cheap, low value):* call `applyCalibrationDampener` in the `/api/ws/state` candidates path so Sharp Plays matches top-picks/games. Honest, but **no-ops for the alt-line longshots that dominate Sharp Plays** — cosmetic for this surface.
2. *The meaningful fix:* surface an explicit **"raw edge · uncalibrated"** / "less reliable" marker on Sharp Plays longshot rows (the families with no calibration or Step-1-negative realized), so the +29% isn't shown bare. This is the trust-honest move; it's a design choice (what threshold, what label) the operator should set.

---

## TRACE 2 — do the candidates carry the new Step-2 signalsTable? → fork (a), no fix needed

**Carry path exists:** `enrichBestEntry` (workstationRoutes:419) already copies `displayBundle: e.displayBundle || null` from the tracked_best entry onto every candidate — the same carry the GAMES/state entries use. `signalsTable` lives **inside** `displayBundle`, so it rides along automatically; `diversifyCandidates` selects/caps but does **not** strip fields. So once tracked_best carries the bundle, Sharp Plays renders the Facing/Season/L5/L15 rows with **no new code**.

**Why the rows weren't visible on-screen = STALE, not broken:** the current `mlb_tracked_best_2026-06-08.json` has **0 / 163** entries with `displayBundle` — it was written **before** the Step-2 commits' slate write. The live `/api/best-available` shows the bundle (rebuilt per request, 1683 hits per operator), but tracked_best (which feeds the candidates) hasn't been rewritten yet. **It populates at the next `recordMlbBestProps` slate write** (now carrying `displayBundle` via `toTrackedMlbBestEntry`), and Sharp Plays renders it then.

**Verdict: fork (a) — no code fix. Claude-A re-checks on-screen at the next fresh slate.**

---

## Bottom line for the operator

- **Sharp Plays edge IS raw (un-dampened)** vs GAMES/top-picks — real asymmetry. But for the longshot families it actually surfaces (RBIs/HR/alt-lines), the dampener wouldn't change the numbers (no calibration). **The honest fix is a "less reliable / uncalibrated" marker on raw longshot edges, not just wiring the dampener.** Bet-affecting → your call on whether/how.
- **The new stat rows (Facing/Season/L5/L15) will show on Sharp Plays automatically at the next slate write** — the carry already exists; today's file was just stale. No fix.
