# Prop-Coverage & Ingestion Truth Map — v1

**Date:** 2026-06-07 · **Author:** Claude-A (Cowork) · **Type:** read-only audit, no code changed
**Operator ask:** "know every little prop type that is and isn't (1) in the repo, (2) fully ingested via real data — proof of what's true and what I can't trust" + map per book.

---

## 0. Honest scope — what this audit IS and IS NOT

**What I CAN prove (and did, here):**
- Every prop market the repo **requests** from its data vendor, per sport — verified at file:line.
- Every prop market the **vendor (The Odds API) offers** for NBA/MLB — from their public catalog (fetched 2026-06-07).
- The **gap**: vendor-offered markets the repo does not request at all.
- Which books the repo requests, per sport — verified at file:line.

**What I CANNOT prove and will not fake:**
- The repo does **not** talk to DraftKings / FanDuel / Fanatics / BetMGM directly. It pulls them through **one vendor aggregator, The Odds API.** So "what props each book offers" for THIS repo = what that vendor exposes per book. Direct-from-book scraping is login/geo-gated and unreliable — anything claimed that way would be guesswork.
- This v1 is **grep-level + vendor-doc level**, not probe-level. "Requested" is proven from source. "Scored/ingested/surfaced" status is carried from the existing `market-coverage-map` memory (itself grep/trace-level), NOT re-proven with a live probe here. Items needing a live probe to *prove* ingestion are tagged **[PROBE-TO-CONFIRM]**.

**Verification-state legend** (a prop can be at any of these depths):
1. `REQUESTED` — in the odds-snapshot market list sent to the vendor (proven file:line).
2. `CLASSIFIED` — has an entry in the classifier table (`mlbClassification.js` / NBA equivalent).
3. `SCORED` — a projection engine produces a band (floor/mostLikely/ceiling) → can become a pick.
4. `SURFACED` — reaches a bettor-visible pick/board/slip.
A market can be REQUESTED but not SCORED (data arrives, nothing models it), or CLASSIFIED but DROPPED (`resolveStatFamily` returns null → never scored).

---

## 1. Books — verified

Both sports request the same **8 book-keys** = the 7-book vision + Caesars (data-feed exception per project canon):
`draftkings, fanduel, fanatics, caesars, betmgm, betrivers, hardrockbet, bet365`

- NBA: `fetchNbaOddsSnapshot.js` — `NBA_BOOKMAKERS_CSV` (8 keys, hardcoded).
- MLB: `buildMlbBootstrapSnapshot.js:789` reads `mlbConfig.activeBooks` = same 8 (`sportConfig.js:80`); `regions:"us"` always; falls back to `["DraftKings","FanDuel"]` only if config missing.
- FE display narrows to 4 (FanDuel, DraftKings, Fanatics, BetMGM) per operator preference; backend keeps all 8 for line-shopping.

**Honest caveat:** requesting 8 keys ≠ getting 8 books back on every market. The vendor returns empty silently for books that don't price a given market, and (per code comments) **truncates long combined market lists** — which is why NBA splits requests into 3 batches (base / DK-extra / defensive). So per-book fill is uneven and market-dependent; proving per-book fill on a live slate is **[PROBE-TO-CONFIRM]**.

---

## 2. NBA — vendor catalog vs repo

Vendor NBA player markets (24 total incl. alternates) cross-referenced against what the repo requests.

| Vendor market | Repo requests? | Scored state (coverage-map, grep-level) |
|---|---|---|
| player_points | ✅ | SCORED |
| player_rebounds | ✅ | SCORED |
| player_assists | ✅ | SCORED (no opp multiplier — signal gap) |
| player_threes | ✅ | SCORED (best-wired family) |
| player_points_rebounds_assists (PRA) | ✅ | SCORED (sum of components, no joint correlation) |
| player_points_rebounds (PR) | ✅ | SCORED (composite sum) |
| player_points_assists (PA) | ✅ | SCORED (composite sum) |
| player_rebounds_assists (RA) | ✅ | SCORED (composite sum) |
| player_blocks | ✅ | SCORED (dedicated engine) |
| player_steals | ✅ | SCORED (dedicated engine) |
| player_turnovers | ✅ | SCORED (FIX 6, commit 6078b29) |
| player_double_double | ✅ | SCORED (binary hit-rate, bypasses minutes/role) |
| player_triple_double | ✅ | SCORED (same caveat) |
| player_first_basket | ✅ | SCORED (low priority, sparse) |
| player_first_team_basket | ✅ | [PROBE-TO-CONFIRM] requested; scoring state unclear |
| player_*_alternate (pts/reb/ast/threes/PRA/PR/PA/RA) | ✅ (DK-extra batch) | alt rungs ingested; ladder only scaffolded for blocks/steals |
| **player_blocks_steals (combined)** | ❌ NOT requested | — |
| **player_method_of_first_basket** | ❌ NOT requested | — ← operator explicitly wanted "first basket by method" |
| **player_field_goals** | ❌ NOT requested | — |
| **player_frees_made / player_frees_attempts** | ❌ NOT requested | — |
| **player_fantasy_points** | ❌ NOT requested | — (DFS) |
| **player_points_q1 / rebounds_q1 / assists_q1** | ❌ NOT requested | — (1st-quarter props) |
| **player_blocks_alternate / steals_alternate / turnovers_alternate** | ❌ NOT requested | — ← blocks/steals have base but no alt rungs = ladder gap |
| h2h / spreads / totals (game) | ✅ requested | game-level: ingested for context, **not** scored as picks |

**NBA takeaways:**
- Core scoring families: fully covered and requested. Good.
- **"First basket by method"** (operator's explicit wish) — vendor offers `player_method_of_first_basket`; repo does not request it. Actionable.
- **Blocks/steals have no alternate (ladder) rungs requested** — directly relevant to the ladder endgame for those families.
- Quarter props, field goals, free throws, fantasy — not pursued (likely fine to defer; low operator priority).

---

## 3. MLB — vendor catalog vs repo

Vendor MLB player markets (20 base + 16 alternate) cross-referenced.

| Vendor market | Repo requests? | Scored state (coverage-map, grep-level) |
|---|---|---|
| batter_hits | ✅ | SCORED (best-wired MLB family) |
| batter_total_bases | ✅ | SCORED (FIX 7b park factor, commit 4bf124f) |
| batter_rbis | ✅ | SCORED (depends on hits; missing OBP correlation) |
| batter_runs_scored | ✅ | SCORED (lineup spot + team total only) |
| batter_home_runs | ✅ | SCORED (hand/park/weather ✓; HR/9 constant gap) |
| batter_first_home_run | ✅ | [PROBE-TO-CONFIRM] requested; Yes/No scoring unclear |
| batter_stolen_bases | ✅ requested | CLASSIFIED but **DROPPED** (resolveStatFamily → null) |
| pitcher_strikeouts | ✅ | SCORED (market-anchored) |
| pitcher_outs | ✅ | SCORED (FIX 2, commit 302acf9) |
| pitcher_earned_runs | ✅ | SCORED |
| pitcher_walks | ✅ | SCORED (FIX 1, commit 7351e81) |
| **batter_strikeouts** | ❌ not in snapshot list | CLASSIFIED (mlbClassification.js:185); batterKs projection exists (degenerate const 2.0) — **requested-gap** [PROBE-TO-CONFIRM] |
| **batter_walks** | ❌ not in snapshot list | CLASSIFIED-but-DROPPED |
| **batter_singles / doubles** | ❌ NOT requested | CLASSIFIED-but-DROPPED (mlbClassification.js:741-770) |
| **batter_triples** | ❌ NOT requested | not classified |
| **batter_hits_runs_rbis (H+R+RBI)** | ❌ NOT requested | — |
| **pitcher_hits_allowed** | ❌ not in snapshot list | CLASSIFIED (mlbClassification.js:99); projection = deterministic inverse of Ks (derived, not ingested) [PROBE-TO-CONFIRM] |
| **pitcher_record_a_win** | ❌ NOT requested | — |
| **ALL MLB alternate markets** (batter/pitcher *_alternate) | ❌ NOT requested | — ← **MLB has no alt-line rungs at all = MLB ladder gap** |
| h2h / spreads / totals (game) | ✅ requested | game-level context, not scored as picks |

**MLB takeaways:**
- Core batter + pitcher families: requested and scored. Good.
- **No MLB alternate markets are requested at all.** Alternate lines are the literal rungs of a probability ladder. Per `product-ladder-direction` (the strategic endgame), **MLB is currently un-laddered at the data layer.** This is the single biggest MLB data gap for the ladder vision.
- **`batter_strikeouts`** classified + has a (degenerate) projection but may not be requested in the live snapshot — needs a probe to confirm whether the data even arrives.
- **`batter_singles/doubles/SB/batter_walks`** are classified but dropped — a known "enable dropped families" phase, deferred.
- **"No home-run game"** (operator's example) — **not a market The Odds API offers.** Closest is `batter_first_home_run` (Yes/No first HR). An "any HR — No" derivation is possible from `batter_home_runs` under-0.5 but isn't a native market. Honest: not vendor-available as named.

---

## 4. Operator's specific wishes — mapped

| Operator wish | Reality |
|---|---|
| NBA points/reb/ast/threes/PRA/PR/PA/RA | ✅ requested + scored |
| NBA blocks/steals/first basket | ✅ requested + scored |
| **NBA "first basket by method"** | ❌ vendor offers it (`player_method_of_first_basket`), repo doesn't request — **actionable** |
| NBA ML / win-loss | ✅ requested (h2h) — used for context, not scored as a pick |
| MLB hits/RBIs/total bases | ✅ requested + scored |
| MLB home runs | ✅ requested + scored (HR/9 constant is a known signal gap, not a coverage gap) |
| **MLB "no home run game"** | ❌ not a vendor market — can only be derived, not ingested as named |
| MLB ML / win-loss | ✅ requested (h2h) — context, not a scored pick |
| **Per-player stat backing on each pick** (L5, position-defense-vs-stat) | L5 ✅ exists; position-level defense-vs-stat ⚠️ partial (signal files exist, depth unconfirmed); live news ❌ no real-time feed. See `operator-trust-definition-stat-attribution` memory. |

---

## 5. Ranked actionable gaps (for operator decision — NOT yet scoped to build)

1. **MLB alternate-line ingestion** — biggest lever for the ladder endgame; MLB has zero alt rungs today. (Vendor offers 16 MLB alternate markets.)
2. **NBA blocks/steals alternate rungs** — base markets scored, but no ladder rungs requested for the two cleanest dedicated-engine families.
3. **`player_method_of_first_basket`** — operator explicitly wanted it; vendor has it; one request-list addition (low effort, sparse/lotto-flavored market).
4. **Enable classified-but-dropped MLB families** (singles/doubles/SB/batter_walks) — already classified, just gated off; a known deferred phase.
5. **`batter_strikeouts` request-gap** — confirm whether the snapshot even pulls it; the projection is a degenerate constant today.
6. **Game-level markets as scored picks** (ML/spread/total) — requested for context but never scored; operator wants ML/win-loss as bettable.

---

## 6. What this audit did NOT prove (next-layer work)

This v1 proves **requested vs vendor-available**. It does **not** prove, with a live probe, that requested markets actually *arrive and get scored on tonight's slate* per book. To get to the operator's "proof of what's true I can trust," the next layer is a **probe-level ingestion audit**: drive one live slate per sport and record, per market per book, {requested → returned-by-vendor → classified → scored → surfaced}. That's the artifact that turns this map from "what we ask for" into "what actually lands." Recommend running it as a structured 4.8 deep-audit with stable `.scratch/` probes, since it touches live snapshot fetches.

**Canonical-authority note:** this doc is a read-only audit artifact under `docs/audits/`. It is NOT a new authority and does not duplicate `market-coverage-map` (memory) or `SPORTSBOOK_CONTRACTS.md` (brain) — it cross-references them. No shadow canonical created.
