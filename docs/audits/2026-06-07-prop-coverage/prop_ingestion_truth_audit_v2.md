# Prop-Ingestion Truth Audit — v2 (probe-level, multi-slate)

**Date:** 2026-06-07 (continued into early 06-08 ET) · **Author:** Claude-B (4.8) · **Type:** read-only audit, no code changed, no vendor calls
**Companion to:** `prop_coverage_truth_map.md` (v1 grep + §7 single-snapshot). This v2 is the rigorous chain that v1 §6 deferred.
**Operator ask:** Step-1 trust — "believe every top pick is bettable; proof of what's true and what I can't trust."

**Every number below traces to a `.scratch/` probe** (per `feedback_no_fabricated_numbers_in_scope_memos`):
- `.scratch/probe_ingestion_truth_chain.js/.txt` — current-cycle chain {requested → returned → classified-and-kept}, both sports, driven through the REAL production classifiers (`marketPropsFromPoolRows` / `marketPropsFromMlbRows`).
- `.scratch/probe_ingestion_truth_multislate.js/.txt` — surfaced + per-book reliability across retained `*_tracked_best_*.json` (MLB 35 slate-days, NBA 25) + `mlb_picks_*.json` (35).

---

## 0. The honest scope limit (read first)

The raw vendor feed is persisted for the **current cycle only** (`backend/snapshot.json`, `backend/snapshot-mlb.json` — each rolls forward, overwriting). There are **no retained historical raw snapshots** (`backend/runtime/market/baseline_snapshots/` holds one 2026-05-14 text file). So:

- **{requested → returned → classified}** is proven on **one cycle per sport** (NBA = single SAS@NYK Finals game; MLB = the 8-game 06-07 slate).
- **{surfaced} and per-book reliability** ARE proven multi-slate, from the durable per-slate pick boards (`*_tracked_best`, `mlb_picks`) going back to **2026-04-20 (MLB)** / **2026-05-08 (NBA)**.

Multi-slate "returned-by-vendor" cannot be reconstructed without retaining raw snapshots — that's a future instrumentation task, flagged in §6.

---

## 1. PHASE 0 — request authority per sport (closes v1's grep gap)

**The two sports request markets from completely different authorities. This is the single most important structural fact.**

| Sport | Request authority | Markets | Config-driven? |
|---|---|---|---|
| **NBA** | **3 hardcoded arrays in `fetchNbaOddsSnapshot.js`** (`NBA_BASE_MARKETS` 14, `NBA_DK_EXTRA_MARKETS` 9, `NBA_DEFENSIVE_MARKETS` 3) fired as 3 parallel requests | 26 distinct | **NO** |
| **MLB** | **`sportConfig.js` → `mlb.baseMarkets` (20) + `mlb.extraMarkets` (13)** via `buildMarketRequestList()` in `buildMlbBootstrapSnapshot.js` | 33 distinct | **YES** |

**⚠️ DRIFT RISK (new finding):** `sportConfig.js` has an `nba` entry with its own `baseMarkets`/`extraMarkets` — but **no live NBA pipeline file reads it** (verified: `grep getSportConfig` across `pipeline/nba/` returns nothing). The live NBA request authority is the hardcoded arrays. So the NBA `sportConfig` block **looks** authoritative and is **dead** — editing it to add/remove a market changes nothing. Anyone (including a future Claude) who edits NBA markets in `sportConfig.js` expecting an effect will be silently wrong. This resolves why v1's grep of `buildMlbBootstrapSnapshot.js` missed the MLB market list (it's in `sportConfig.js`), and surfaces the inverse trap for NBA.

**⚠️ MLB config→vendor strip (new finding):** Of the **33** configured MLB markets, only **21** reach the vendor. The other **12 are stripped every slate, identically across all 8 events** (probe: `distinct marketsRequested sets: 1`). Mechanism (verified `buildMlbBootstrapSnapshot.js:864-885`): the first request 422s with `"invalid markets: …"`, the code drops the rejected keys (`parseInvalidMarketsFromError` → `fallbackMarkets`) and re-fires; the snapshot records the **post-fallback accepted list**. The 12 stripped:

```
player_total_bases, player_home_runs, player_rbis, player_runs_scored,
player_strikeouts, player_pitcher_strikeouts            (player_* variant keys — vendor uses batter_*/pitcher_*)
player_total_bases_alternate, player_rbis_alternate,
player_runs_scored_alternate, player_strikeouts_alternate (player_* alt variants)
nrfi, yrfi                                                (no-run / yes-run first inning)
```

The `player_*` variants are **harmless duplicates** — the canonical `batter_*`/`pitcher_*` keys cover the same stats and DO land. But **`nrfi`/`yrfi` are simply rejected as named** — if the operator wants first-inning run props, the correct Odds API key differs (vendor naming check needed; not `nrfi`/`yrfi`). This is config cruft worth cleaning so the request surface is honest.

---

## 2. PHASE 1 — chain on the current cycle (both sports)

### NBA (`snapshot.json`, savedAt 2026-06-08T03:30Z, 1 event, 5,489 raw rows)

26 requested → **22 returned** → **5,306 rows classified-and-kept**. Chain breaks:

| Market(s) | rows | Chain state | Interpretation |
|---|---|---|---|
| 18 core + alternate player markets | 5,306 | **OK → classified** | points/threes/reb/ast/PRA/PR/PA/RA + their alternates + blocks/steals all clean |
| `h2h`, `spreads`, `totals` | 0 | REQUESTED-not-returned | game lines don't come back on the player-prop request path; **by design context-only**, never scored as picks |
| `player_turnovers` | 0 | REQUESTED-not-returned | **structural vendor gap** (see `project-nba-turnovers-api-unavailable`; confirmed 0/25 surfaced in §3) |
| `player_double_double`, `player_triple_double`, `player_first_basket`, `player_first_team_basket` | 63/20/60/40 | RETURNED-not-kept by band path | These ARE returned and classify to a family, but `marketPropsFromPoolRows` drops them at its **over/under + finite-line gate** (they're yes/no or no-line markets). DD/TD/first-basket are handled by **dedicated binary engines** (`buildNbaFirstBasketEngine`, DD/TD candidates), NOT the band board — so "dropped" here ≠ "never scored." Confirmed: `double_double` surfaces on 12/25 slate-days (§3). |

### MLB (`snapshot-mlb.json`, savedAt 2026-06-08T03:00Z, 8 events, 5,811 raw rows)

21 vendor-accepted → **16 returned** → **5,508 rows classified-and-kept**. Chain breaks:

| Market(s) | rows | Chain state | Interpretation |
|---|---|---|---|
| batter hits/TB/RBI + alternates, runs_alt, pitcher Ks/outs/ER + Ks_alt, HR, first-HR | 5,508 | **OK → classified** | classification layer is healthy for both batter AND pitcher markets |
| `batter_runs_scored` (base) | 0 | REQUESTED-not-returned | base runs empty this slate, but `batter_runs_scored_alternate` returned 497 |
| `pitcher_walks` | 0 | REQUESTED-not-returned | absent this slate; **0/35 surfaced ever** (§3) |
| `player_hits`, `player_hits_alternate` | 0 | REQUESTED-not-returned | vendor-accepted the key but returned nothing (the `batter_*` equivalents carry the data) |
| `batter_stolen_bases` | 115 | RETURNED-not-classified (DROP) | `resolveStatFamily` has no SB branch → returns null → genuinely dropped at classification (confirms v1 "classified-but-dropped") |
| `h2h`, `spreads` | 94/94 | RETURNED-not-kept | game lines, context-only by design |

---

## 3. THE HEADLINE — MLB surfaces batter offense ONLY (scored-but-not-surfaced)

This is the finding most relevant to "can I trust every top pick."

**Across 35 MLB slate-days, in BOTH surfaced pick files, the ONLY markets that ever reach a bettor-visible pick are batter offense:**

`mlb_picks_*` (35 slates, newer + older formats both): RBIs, Total Bases, Home Runs, Hits, and their `batter_*_alternate` keys + `batter_home_runs`; plus `First Home Run`/`Moneyline`/`Run Line` on **1 slate each** (rare).
`mlb_tracked_best_*` (35 slates): `batter_home_runs`, `batter_total_bases_alternate`, `batter_hits_alternate`, `batter_rbis_alternate` — each on **100% of slate-days**.

**NEVER surfaced in any MLB pick file across 35 slates:** `pitcher_strikeouts`, `pitcher_outs`, `pitcher_earned_runs`, `pitcher_walks`, `batter_runs_scored`, `batter_strikeouts`, `batter_stolen_bases`.

Yet the current cycle proves the chain feeds them: the snapshot **returned + classified + kept** `ks` 467, `outs` 50, `earnedRuns` 14, `runs` 497 rows. So the data arrives and passes classification — it just **does not reach a surfaced pick**.

**What I proved vs did not:** I proved (two independent files, 35 slates) that the MLB surface is batter-offense-only. I did **NOT** trace the root cause. The likely explanation, from reading `buildMlbAutoTickets.js`, is that the MLB surfacing path is **architecturally hitter/power-focused** — `pitcherMatchupBoost()` treats the pitcher as an opponent modifier that boosts *hitters*, never as a pick subject. Whether pitcher props are intentionally out of scope or fall through a wiring gap between `buildMlbBestBetsBoard` (whose `STAT_FAMILIES` DOES include `ks`/`outs`/`earnedRuns`/`walks`) and the persisted pick files is a **scoped follow-up trace**, not something to assert here.

**Operator-language version:** *Every MLB top pick you've ever been shown is a batter hits / total-bases / RBI / home-run bet. Strikeout props and other pitcher bets are pulled in and understood by the model, but nothing turns them into a pick. If you want pitcher props bettable, that's a real build, not a config toggle.*

---

## 4. PHASE 2 — structural vs slate-dependent absences

| Market | Verdict | Basis |
|---|---|---|
| NBA `player_turnovers` | **STRUCTURAL** | vendor not offering (2026 playoffs); 0/25 surfaced |
| NBA `h2h`/`spreads`/`totals` | **DESIGN-EXCLUDED** (not "missing") | game lines requested for context, never scored as picks; 0/25 surfaced as expected |
| MLB `pitcher_*`, `batter_runs_scored`, `batter_strikeouts` | **SURFACE GAP, not ingestion gap** | returned+classified this cycle but 0/35 surfaced — see §3 |
| MLB `batter_stolen_bases` | **CLASSIFICATION DROP** | returns 115 rows but `resolveStatFamily`→null; 0/35 surfaced |
| MLB `nrfi`/`yrfi` | **VENDOR-REJECTED key** | stripped pre-request every slate; 0/35 surfaced |
| MLB `h2h`/`spreads` | **SLATE-RARE** | surfaced on exactly 1/35 slate-days (the auto-ticket Moneyline/Run-Line day) |

Honest note: I could not separate "vendor didn't offer this market on slate X" from "vendor offered it but no pick surfaced" for past slates, because raw feed isn't retained. The structural verdicts above lean on **current-cycle returned-status + multi-slate surfaced-status together**, which is the strongest evidence available without raw-snapshot retention.

---

## 5. PHASE 3 — per-book fill reliability (multi-slate, surfaced picks)

"% slates" = fraction of slate-days where the book supplied ≥1 surfaced pick.

**NBA (25 slate-days):** FanDuel **100%** (1,966), DraftKings **100%** (1,001), BetMGM 64% (571), BetRivers 64% (405), Hard Rock 60% (566), Fanatics 52% (67, thin). **bet365 + Caesars: never surfaced.**
→ Effectively **2 always-on books + 4 partial**; not 8.

**MLB (35 slate-days):** DraftKings **100%** (1,813), FanDuel **100%** (1,090), BetRivers 80% (354), Caesars 77% (498), BetOnline.ag 66% (303), Fanatics 37% (332), Hard Rock 34% (747), BetMGM 29% (240). **bet365: never surfaced.**
→ Effectively **2 always-on + a rotating tail**.

**⚠️ Book-set temporal drift (new caveat):** the MLB surfaced history contains **`BetOnline.ag`**, which is **not in the current `sportConfig.mlb.activeBooks`** list, and **`Caesars` at 77%** even though Caesars returned nothing on the current cycle. So the per-book history spans **config/vendor changes over the 7-week window** — it answers "which books have fed picks historically," not "which books are live tonight." Tonight's live depth (per v1 §7 + this cycle): NBA 6 books returning, MLB effectively 4 deep + 2 thin; **bet365 + Caesars absent on the current cycle for both sports.**

The "line-shop across 7-8 books" premise is, in surfaced practice, **DraftKings + FanDuel carrying ~75% of every slate**, with the rest intermittent.

---

## 6. What this still does NOT prove (next-layer)

1. **Multi-slate returned-by-vendor** — needs raw-snapshot retention (append a daily frozen copy of `snapshot*.json` to a dated dir). Cheap instrumentation; would let a future audit prove vendor offer-rate per market over time.
2. **Root cause of the MLB pitcher-surface gap (§3)** — scoped follow-up: trace `buildMlbBestBetsBoard` output families → what persists to `mlb_picks`/`mlb_tracked_best`. Determines curation-scope vs wiring-gap.
3. **`resolveStatFamily` SB drop (MLB) + NBA binary-market band-path drop** — known, low priority; documented for completeness.

**Canonical-authority note:** read-only artifact under `docs/audits/`. Cross-references `market-coverage-map` (memory), `SPORTSBOOK_CONTRACTS.md`, `sportConfig.js`, the two fetch files — creates no new authority.
