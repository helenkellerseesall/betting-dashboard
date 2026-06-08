# MLB Pitcher-Surface Root-Cause Trace

**Date:** 2026-06-08 ET · **Author:** Claude-B (4.8) · **Type:** read-only trace, NO code changed
**Follows:** `prop_ingestion_truth_audit_v2.md` §3 (headline: MLB surfaces batter offense only) + §6 follow-up #2.
**Question:** why do pitcher props (and runs scored) get ingested + classified but never reach a surfaced pick — intentional scope, or wiring bug?

All claims trace to file:line below; no probe needed (this is a code-path trace).

---

## Verdict (one line)

**INTENTIONAL SCOPE, not a bug** — the MLB *tracked/graded* pick surface is a deliberately batter-offense-only engine. **But** pitcher strikeouts are already fully scored and DO reach the live API response; they're **un-tracked, not un-scored**. That makes part of the fix small.

---

## The two MLB engines (this is the crux)

There are **two parallel MLB scoring paths**, and only one feeds the tracked picks:

**Path A — the TRACKED surface (what v1/v2 measured, what feeds grading + CLV + learning):**
`/api/best-available` (MLB) → `buildMlbLiveDualBestAvailablePayload()` (`server.js:3630`) → `buildMlbClusters()` (`pipeline/mlb/buildMlbClusters.js`) → `scoreMlbProp()` → `.best` → `recordMlbBestProps` / `recordMlbDailyPicks` (`phase4Tracking.js`) → `mlb_tracked_best_*.json` + `mlb_picks_*.json`.

This path is hardcoded to **4 batter-offense categories at all three layers**:
- `scoreMlbProp.js:31-35` — `category` is set ONLY for propType `"Hits"`/`"Home Runs"`/`"Total Bases"`/`"RBIs"`; everything else → `category = null`.
- `buildMlbClusters.js:5` — `BUCKET_KEYS = ["hits", "hr", "tb", "rbi"]`; `:41` drops any row whose category isn't one of the 4 buckets.
- `server.js:3641-3664` — `buildMlbLiveDualBestAvailablePayload` only ever reads `clusters.{hits, hr, tb, rbi}`.

So a pitcher-strikeout row is returned + classified by `marketPropsFromMlbRows` (v2 §2) but hits a `category = null` wall in `scoreMlbProp` and never enters the tracked surface. **This explains 0/35 surfaced exactly.**

**Path B — the richer board (NOT persisted to tracked picks):**
`mlbIsolatedRoutes.js:484` builds `pitcherKsToday` via `buildMlbPitcherKsToday` — a **full strikeout ladder** (`expectedKs`, `k5plus`, `k6plus`, `k7plus`, `k8plus`; verified by the live `[KS LADDER VERIFY]` log at `:515`). It feeds `buildMlbInsightBoard` (`:502`) and `buildMlbOpportunityBoard` (`:509`), and **all three are returned in the route response** (`responseBody` at `:587-613` → `res.json` at `:632`).

So pitcher-K scoring **exists and reaches the API** (and presumably the in-app board), but its output is **never written to `mlb_tracked_best`/`mlb_picks`** — so it's never graded, never in CLV, never in the learning loop, and absent from the tracked "top picks" surface the audit measured.

(There's also `buildMlbPropClusters.js` / `buildMlbBestBetsBoard` whose `STAT_FAMILIES` includes `ks`/`outs`/`earnedRuns`/`walks` — a third, more general scorer that likewise isn't the one feeding the tracked surface. Confirms the codebase has pitcher-scoring capability that the tracked path doesn't use.)

---

## Per-market fix size (honest)

| Market | Scored today? | Where | Fix to make it a tracked pick |
|---|---|---|---|
| `pitcher_strikeouts` | **YES** — full ladder (`pitcherKsToday`) | reaches API board, not tracked files | **SMALL / wiring**: route the existing K ladder into the tracked surface (new category + bucket + payload read, or persist the opportunity-board K picks) |
| `pitcher_outs`, `pitcher_earned_runs`, `pitcher_walks` | **NO dedicated scorer** in the tracked path | classified+kept only (v2 §2) | **LARGER / net-new**: needs projection engines, then wiring |
| `batter_runs_scored` | NO (base empty this slate; alt lands) | classified+kept | net-new scorer + wiring |
| `batter_strikeouts` | NO | classified (degenerate const per v1) | net-new |
| `batter_stolen_bases` | NO (`resolveStatFamily`→null) | dropped at classification | classifier branch + scorer |

---

## What a fix would touch + risk

Two architectural options (this is the operator/design call — NOT decided here):

1. **Extend Path A** — add categories to `scoreMlbProp.js`, buckets to `buildMlbClusters.js`, reads to `buildMlbLiveDualBestAvailablePayload`. Smallest diff for strikeouts (scoring exists); incremental per family.
2. **Switch the tracked surface to Path B's richer engine** (`buildMlbPropClusters`/`buildMlbBestBetsBoard`, already pitcher-aware) — bigger architectural change, removes the dual-engine split, but higher blast radius.

**Risk class: MEDIUM, bet-affecting.** It changes what surfaces as a bettor pick and touches the shared `/api/best-available` path. Whichever option: same discipline as F1.2 — regression-gate-first single fence, byte-identical batter-offense output as the gate (the 4 existing categories must not change), kill-switch (precedent `NBA_BUCKET_TIER_POLICY` / `CALIB_LINEAWARE`), and `buildMlbPropClusters.js` sha256 unchanged if Path A is chosen.

---

## Recommendation (for operator/Claude-A gate)

Start with **strikeouts only via Option 1** — the scoring already exists (`pitcherKsToday` ladder), so it's the smallest, lowest-risk first pick-type to add, and pitcher Ks are a high-volume, sharp-friendly market. Prove the wiring on Ks (tracked + graded for ~14 days) before deciding whether outs/earned-runs/walks justify net-new scoring engines. Do NOT attempt all pitcher families at once.

**Honest limits:** I traced the code path, not realized performance — I have NOT verified that the existing `pitcherKsToday` ladder is well-calibrated (it reaches the board but has never been graded, precisely because it isn't tracked). The first build step should track it and let grading judge calibration before leaning on it.

No code changed in this trace. Probes/path-refs are all file:line above; no `.scratch` artifact required.
