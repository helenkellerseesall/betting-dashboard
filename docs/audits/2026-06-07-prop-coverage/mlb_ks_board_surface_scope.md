# MLB Strikeouts → Top-Picks Board: Build Scope (Option B)

**Date:** 2026-06-08 ET · **Author:** Claude-B (4.8) · **Type:** build SCOPE only — NO code written yet
**Operator decision:** surface pitcher strikeouts on the curated top-picks board now (accepting +EV is not yet confirmed; safeguards below).
**Gate:** operator + Claude-A review this scope before any code.

---

## 0. Corrected premise (read first)

The earlier audit/trace concluded pitcher Ks were "scored but not tracked/graded." **That was wrong** — measured the display board (`mlb_tracked_best`/`mlb_picks`), not the graded ledger. The graded ledger `mlb_tracked_bets` already holds **789 K picks across 10/10 slate-days**, settled and in the CLV/grading/learning loop (probe this turn). Corrections are being applied to `prop_ingestion_truth_audit_v2.md` §3 and `mlb_pitcher_surface_trace.md` in the same commit.

**So this build is NOT "wire up missing data." It is a CURATION change:** put already-scored K picks onto the curated best-available board (`buildMlbLiveDualBestAvailablePayload().best`), which today is batter-offense-only.

**Calibration reality (probe this turn, raw — NOT vig-adjusted):** graded K-over picks hit **12.7% (18W/124L)**; that's longshot-alternate-dominated and in line with batter families on the same ledger (hits 10.7%, total bases 9.2%), so it is NOT a verdict — a vig-aware read (F1.1 method) is still owed before treating Ks as proven. This scope therefore ships Ks at a **capped tier** so they cannot present as high-confidence until that read + live grading justify it.

---

## 1. Approach — Option B (reuse the K engine, append-only)

Do NOT extend `scoreMlbProp`/`buildMlbClusters` (Option A). The K engine (`buildMlbPitcherKsToday`, `buildMlbPitcherKsProbabilityEngine.js`) already produces a richer, honesty-tagged ladder (`modelProbability`, `edge`, `predictionResolved`, `predictionSource`, `expectedKs`, k5+..k8+, book/line/odds). Reuse it: map its entries to board-pick rows and **append** to `best`. Batter board stays byte-identical → regression gate is trivial.

## 2. Exact change (one file: `server.js`)

Inside `buildMlbLiveDualBestAvailablePayload()` (`server.js:3630`), at the `best` assignment (`server.js:4011-4013`):

- **Import** `buildMlbPitcherKsToday` (from `pipeline/mlb/buildMlbPitcherKsProbabilityEngine`) at top of `server.js`.
- **Compute** `const ksToday = buildMlbPitcherKsToday({ rows })` (`rows` already in scope at :3631).
- **Map** resolved entries → board rows (table below), drop non-resolved.
- **Append** into a fresh array (no mutation of `mixedBest`):
  `const best = [ ...(mixedBest.length > 0 ? mixedBest : finalPlayableRows), ...mappedKsPicks ]`
- All of the above behind the kill-switch; OFF ⇒ `mappedKsPicks = []` ⇒ `best` identical to today.

No change to `scoreMlbProp.js`, `buildMlbClusters.js`, `buildMlbPropClusters.js`, `phase4Tracking.js` (the writers persist whatever rows `best` carries; `recordMlbBestProps`/`recordMlbDailyPicks` and the API response all read `best`).

## 3. K-entry → board-row mapping

| Board field (toTrackedMlbBestEntry / legKey) | Source (K engine `out`) | Note |
|---|---|---|
| `player` | `out.player` | |
| `team` | `out.team` | legKey component |
| `propType` | `"Strikeouts"` | constant; matches batter convention ("Hits" etc.) |
| `marketKey` | `out.marketKey` | `pitcher_strikeouts` / `_alternate` |
| `side` | `"over"` | engine ladder is an OVER ladder (`poissonProbAtLeast`); unders out of scope v1 |
| `line` | `out.line` | |
| `odds` | `out.odds` | |
| `predictedProbability` | `out.modelProbability` | rename |
| `edgeProbability` | `out.edge` | rename |
| `eventId`,`matchup`,`gameTime`,`awayTeam`,`homeTeam`,`opponent` | `out.*` | for FE indexing |
| `book` | `out.book` | legKey component |
| `tier` | **capped** (see §4) | NOT engine-derived ELITE |
| `mlbPhase3Score` | null | not produced by K engine; tracked-entry allows null |
| `predictionSource` | `out.predictionSource` | carry for honesty audit |

## 4. Safeguards (binding for the build)

1. **Kill-switch** `MLB_KS_BOARD_SURFACE`, read once at module load (precedent `CALIB_LINEAWARE`, `NBA_BUCKET_TIER_POLICY`). `unset/"1"` → ON (operator wants it live to gather board-grading); exact `"0"` → OFF ⇒ byte-identical to today. `[KS-BOARD-BOOT]` log line. Reload to flip.
2. **Resolved-only** — surface only entries with `predictionResolved === true` (drop `predictionSource:"unresolved"`), per `probabilityHonesty` null-preservation. Never fabricate a probability to fill the board.
3. **Capped tier** — K board picks get a tier **no higher than the existing batter board's lowest non-FADE tier** (e.g. `PLAYABLE`, or a distinct `EXPERIMENTAL` label) regardless of edge magnitude. Honors "no fake confidence" + "trust over abundance." Uncapping requires the vig-aware read + live board grading. Decision point for operator: `PLAYABLE`-cap vs explicit `EXPERIMENTAL` tag.
4. **Volume cap** — append at most N K picks (recommend N≈8, ~one per game) ranked by `edge`, so Ks don't flood/dominate the batter board.
5. **Dedup** — run mapped K picks through the existing `dedupeMlbLegs` / `legKey` so no collision with batter rows.

## 5. Verification (regression-gate-first single fence)

- **Frozen fixture**: copy current `snapshot-mlb.json` rows to `.scratch/`. Drive `buildMlbLiveDualBestAvailablePayload` PRE/POST.
- **GATE 1 (append-only)**: the batter subset of `best` (every row whose `propType ∈ {Hits, Home Runs, Total Bases, RBIs}`) is **BYTE-IDENTICAL** pre/post. Even 1 changed batter row = halt.
- **GATE 2 (kill-switch OFF)**: with `MLB_KS_BOARD_SURFACE=0`, `best` is **fully** byte-identical to today (zero K rows).
- **GATE 3 (ON behavior)**: K rows appended; ALL `predictionResolved===true`; ALL `tier` ≤ cap; count ≤ N; `legKey` unique; each maps cleanly through `toTrackedMlbBestEntry` (no required field dropped).
- **GATE 4 (untouched files)**: sha256 of `scoreMlbProp.js`, `buildMlbClusters.js`, `buildMlbPropClusters.js` unchanged.
- `node --check` server.js; `runtime:verify` 13/13; backend reload.
- **Operator-language spot-check**: 5 surfaced K picks (pitcher, opponent, line, odds, modelProb, why).

## 6. Risk + caveats

- **Risk class: MEDIUM, bet-affecting** — changes the board the operator bets from. Mitigated by append-only + kill-switch + capped tier + resolved-only + volume cap.
- **Honest limit**: surfacing without confirmed +EV is an operator-accepted risk. The capped tier + the fact Ks are already graded in `tracked_bets` means we get the real vig-aware read over ~14 days; **the vig-aware F1.1-method read on the graded K corpus should still run before uncapping tier.** Recommend scheduling it.
- **Scope edge**: v1 surfaces OVER-ladder Ks only (engine output). Under-Ks + outs/runs are separate, later.

## 7. Files touched (summary)
- `server.js` — import + ~15-line gated block in `buildMlbLiveDualBestAvailablePayload`. Nothing else.

No code written in this scope. Awaiting operator/Claude-A gate.
