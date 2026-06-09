# Prop-Specific Stat-Backing — Data Map (read-only audit)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** read-only audit — NO code. Operator + Claude-A scope the rebuild from this.
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-09 17:10 ET — Claude-A. Operator's #1 requirement (stat backing SPECIFIC to the prop + player) was never delivered; map ideal vs ingested vs gap honestly.

---

## 0. The failure, confirmed at the spine (and the reframe)

The Top Picks cards render `pick.reasoning` from **`buildReasoning`** (`backend/routes/workstationRoutes.js:2365`). For MLB (block at `:2464–2491`) it emits, identically for a pitcher-K pick and a batter-TB pick:

- **`out.l5` = "Team implied total"** (`:2466–2468`) — the slot *named* `l5` is the team's vegas-derived run total, **not** the player's last-5. The comment admits it: *"MLB tracked_best doesn't carry L5 today — surface implied team total as proxy."*
- **`out.opp` = `{ label: "vs <team>", value: <team> }`** (`:2469`) — **the #101 duplication**: `label` and `value` are the same `opp` string, so the FE renders "vs Dodgers · Dodgers" with **no stat**.
- **`out.propSpec`** — generic environment: pitcher/K branch (`:2476–2480`) = temperature + game O/U total; HR branch (`:2470–2475`) = park HR factor + wind + temp; everything-else branch (`:2481–2487`) = O/U + lineup spot + temp. **None of these predict the prop.**

### The reframe (this changes the rebuild scope)

The data is **not** mostly missing. The rich, prop-specific backing already exists as **`displayBundle.statBacking`** (built by `backend/pipeline/mlb/buildMlbDisplayBundle.js`, the Step-2 work) and is **present and non-null on all 92 rows of today's `mlb_tracked_best`** (probe: 92/92). One real row (Jose Altuve, Home Runs) carries:

```
statBacking.opposingPitcher = { name, kRate: 0.2202, kEnvironmentShift }
statBacking.seasonLine       = { avg, obp, slg, ops, iso, kRate, hrRate }
statBacking.recentForm.l5    = { hitsPerGame, totalBasesPerGame, hrPerGame, rbiPerGame, runsPerGame,
                                 iso, kRate, hitStreak, hrInWindow, daysSinceLastGame, source: "mlb_statsapi_gamelog" }
statBacking.recentForm.l15   = { …same shape… }
statBacking.park             = { hrFactor, hrEnvironmentTag }
statBacking.platoon          = { isPlatoonAdvantage, batterHand, pitcherHand }
statBacking.weather          = { windDirectionTag, windSpeedMph, carryShift, temperatureF }
```

So the problem is **not "we don't have the stats."** It's two things:

1. **`buildReasoning` ignores `displayBundle.statBacking`** and emits the generic blob instead.
2. **The bundle reaches almost no surfaced picks.** Top Picks reads **`tracked_bets`** (`:2584`), then joins each pick to a `tracked_best` entry by **`player|side|line`** (`loadReasoningIndex:2242–2252` reads tracked_best; `findReasoningEntry:2333–2347`), and only then carries `best.displayBundle` (`:2663`). Probe over today's MLB slate:
   - **Batter picks: 51 of 1,400** eligible (non-FADE/LONGSHOT) tracked_bets rows join a tracked_best entry = **3.6%** (all 51 that join DO carry the bundle). The other ~96% fall to the `mlbPseudoBest` snapshot fallback (`:2287–2310`), which has **no displayBundle** → generic blob.
   - **Pitcher-K picks: 0 of 288** join (pitcher Ks aren't on the batter-only `tracked_best` board) → always the generic blob.

**Bottom line:** batter backing exists but only reaches picks whose exact line is on the 92-row curated board; pitcher-K backing is never assembled at all. The rebuild is mostly *surfacing/assembly*, plus a few real ingestion gaps.

---

## 1. PITCHER STRIKEOUTS (priority #1 — current TOP TIER, worst-covered)

| Ideal predictor | Status | Where (file:line · field) |
|---|---|---|
| Pitcher recent-form Ks (L5/L15) | **(b) computed, not on pick** | `data/mlbPitcherGameLogs.json` (`.players`, **29 pitchers / 57 starts**, 14-day window — incl. Skenes; the memory "~4 pitchers" is **STALE**) → `mlbPitcherFormCache.js` → consumed by `buildMlbPitcherKsProbabilityEngine.js` (streak/recent adj). Raw recent Ks never serialized to the pick. |
| Season K% / K9 | **(b) computed, not on pick** | `ingest/refreshMlbPitcherStats.js` computes `kRate`,`k9`,`whip` → `data/mlbPitcherStats.json`; read by the K engine (`buildMlbPitcherKsProbabilityEngine.js:~156`). Only the derived `expectedKs`/modelProb reaches the row. |
| Expected innings / outs | **(b) computed, not on pick** | `buildMlbPitcherKsProbabilityEngine.js:~246–252` (`ipExpected`, clamped 2–7.5). Not carried to tracked_bets. |
| Opponent TEAM strikeout rate (lineup K%) | **(c) NOT ingested** | `buildMlbPitcherCandidates.js:~15` reads `row.opponentKPercent` but it is **never populated**. Needs a feed: team batting K% (statsapi team hitting splits) — ideally split by pitcher hand. |
| Opponent K% vs pitcher handedness | **(c) NOT ingested** | No handedness-split team K% anywhere. Same feed as above, stratified L/R. |
| Park / weather | **(b) baked into score, not shown** | Weather temp read in the K engine (`:~164–172`) and folded into `expectedKs`; raw value not on the pitcher-K row. |

**Pitcher-K tracked_bets row reality (Skenes, 2026-06-09):** carries `modelProb`, `edge`, `confidence`, `line`, `tier` — and **no** pitcher-K stat (`hrEnvironmentTag`/`lineupSpot`/`temperatureF`/`contextualTags` all null; no `expectedKs`/`kRate`/`recentKs`). No `displayBundle`.

**VERDICT — pitcher Ks:** today the card can show **nothing prop-specific** truthfully (it shows temp + game total, which don't predict Ks). But the *inputs exist* (recent Ks for 29 pitchers, season kRate/k9/whip, expectedKs, ipExpected). The fix is a **pitcher-shaped statBacking** assembled at serve time from those caches + the K engine, attached to the pitcher-K pick. The one true ingest gap is **opponent team K% (split by hand)** — the single highest-value new feed.

---

## 2. BATTER HITS + TOTAL BASES (priority #2)

| Ideal predictor | Status | Where (file:line · field) |
|---|---|---|
| Batter recent form L5/L15 (this stat) | **(a) on the row — when the board join hits** | `mlbBatterFormCache.js` `getBatterForm()` → `buildMlbDisplayBundle.js` → `statBacking.recentForm.l5/l15.{hitsPerGame,totalBasesPerGame,…}` (source `mlb_statsapi_gamelog`). On 92/92 board rows; reaches only **3.6%** of eligible picks via the player\|side\|line join. |
| Opposing pitcher kRate | **(a) on the row — same caveat** | `refreshMlbPitcherStats.js` → `deriveMlbPitcherEnvironmentContext` → `statBacking.opposingPitcher.kRate`. |
| Platoon / handedness | **(a) on the row — same caveat** | `statBacking.platoon.{isPlatoonAdvantage,batterHand,pitcherHand}` (`buildMlbDisplayBundle.js`). |
| Park doubles factor | **(a) on the row — same caveat** | `data/mlbParkFactors.json` `doublesFactor` → `statBacking.park`/signalsTable. |
| Park hits factor | **(c) present but intentionally withheld** | `mlbParkFactors.json` has `hitsFactor`, but `buildMlbDisplayBundle.js:~88–92` **deliberately omits it** ("only hr/doubles/triples are real"). Decision for rebuild: trust it or leave out. |
| Opposing pitcher gbRate / fbRate / contact / hard-hit | **(c) NOT ingested** | `refreshMlbPitcherStats.js` fetches only K/BB/H/ER/HR/IP-derived stats; no batted-ball or contact feed. Needs Statcast/pitch-outcome feed. |
| Batter-vs-this-pitcher history | **(c) NOT ingested** | No batter-vs-pitcher history in `pipeline/mlb` (the few `h2h` refs are identity-resolution, not matchup). Needs statsapi vs-pitcher splits. |

**VERDICT — hits/TB:** the *right* stats (batter L5/L15 line, opposing-pitcher kRate, platoon, park doubles) are **already computed and on the board rows** — the card just (i) doesn't read them in `buildReasoning` and (ii) only ~4% of picks carry them. Fix = **assemble statBacking for every surfaced pick** (call the form/pitcher-env caches per pick at serve time, keyed by player — independent of the 92-row board join) + **read it in the reason**. Remaining true gaps: pitcher batted-ball profile, batter-vs-pitcher history.

---

## 3. HOME RUNS (priority #3)

> Correction to the sub-agent sweep: **HR rows ARE surfaced** in `mlb_tracked_best` (the audited row above is `Jose Altuve · Home Runs`, with a full displayBundle). The "no HR rows" reads were a regex miss on "home runs" (space, no `hr` substring).

| Ideal predictor | Status | Where (file:line · field) |
|---|---|---|
| Batter power form — recent HR, ISO | **(a) on the row — board-join caveat** | `statBacking.recentForm.l5/l15.{hrPerGame, hrInWindow, iso}` + `statBacking.seasonLine.{iso, hrRate}` (derived from statsapi game logs, **not** Statcast). ISO is available today. |
| Park HR factor | **(a) on the row** | `data/mlbParkFactors.json` → `deriveMlbParkContext` → `applyMlbContextualLayers` → row `hrFactor`/`statBacking.park.hrFactor`. Reaches the row directly (the one field `buildReasoning`'s HR branch already reads, `:2472`). |
| Weather / wind / temp / carry | **(a) on the row** | `data/mlbGameWeather.json` → `deriveMlbWeatherContext` → row `windDirectionTag`,`temperatureF`,`carryShift` + `statBacking.weather`. |
| Platoon / handedness | **(a) on the row** | `statBacking.platoon`. |
| Barrel% / hard-hit% (Statcast power) | **(c) NOT ingested (orphan)** | `data/mlbStatcastPower.json` exists but is **orphan** — required only by `buildMlbHrPredictionCandidates.js:~25` (inspection board / oomph parlay path), not the live pick pipeline. No live barrel/hard-hit on a pick. |
| Pitcher HR/9 + fly-ball rate | **(b) computed, not on pick** | `buildMlbHrPredictionCandidates.js:~12–20, ~170–172` (`deriveOpposingPitcherHrPer9`, `getPitcherFlyBallRate`) — used for HR-candidate scoring only, never serialized to a tracked pick. |

**VERDICT — HR:** the card can already show **park HR factor + weather/carry + platoon + batter ISO/recent-HR truthfully** (all on the row) — `buildReasoning`'s HR branch only uses park/wind/temp and ignores the batter power form that's right there. Wire the power form in; optionally promote pitcher HR/9 from the candidate engine. Barrel/hard-hit stays a (c) Statcast gap.

---

## 4. The rebuild spec (what to build from this map)

**Principle (binding):** the card's reason must be the **prop-specific** stats. **Never show team-implied-total or generic park/weather AS the reason.** If a stat isn't available for a pick, **omit it** — never substitute a generic one, never fabricate.

**Per-prop card layout from REAL fields (a)+(b):**

- **Pitcher Ks:** `Recent: L5 Ks <x>, L15 Ks <y>` · `Season: K% <k%>, K/9 <k9>` · `Projected: ~<expectedKs> Ks in ~<ipExpected> IP` · *(add when ingested)* `Opp lineup K% <z>`. Source = pitcher form cache + pitcher stats + K engine. (Requires assembling a **pitcher-shaped statBacking**; current bundle is batter-only.)
- **Hits / TB:** `Recent: L5 <hits/TB per game>, L15 <…>` · `Matchup: vs <pitcher> (K% <k%>, <hand>)` · `Platoon <adv/none>` · `Park 2B <doublesFactor>x`. Source = batter form cache + opposing-pitcher env + park.
- **HR:** `Power: L15 HR <n>, ISO <iso>` · `Pitcher HR/9 <hr9>` · `Park HR <hrFactor>x` · `Wind <dir> <mph> / <temp>°F`. Source = batter form + (promoted) pitcher HR/9 + park + weather.

**Two structural fixes the layout depends on:**
1. **Assemble statBacking for every surfaced pick at serve time** (per-player cache lookups), not only the ~3.6% that line-match the 92-row board. This is the single change that makes batter/HR backing actually appear.
2. **Pitcher-shaped statBacking** — `buildMlbDisplayBundle.js` is batter-only; add a pitcher branch (or a sibling builder) for the K layout above.

**Prioritized ingest list (the true (c) gaps):**
1. **Opponent team K% (split by pitcher hand)** — highest value; unblocks the core pitcher-K predictor. Source: statsapi team hitting splits.
2. **Opposing-pitcher batted-ball profile (gb%/fb%/hard-hit)** — improves hits/TB + HR. Source: Statcast / pitch-outcome feed.
3. **Batter-vs-pitcher history** — statsapi vs-pitcher splits.
4. **Batter Statcast power (barrel%/hard-hit%)** — promote the orphan `mlbStatcastPower.json` into the live path, or fetch fresh. (ISO already covers most of this from game logs.)

**Also fix (#101):** `buildReasoning:2469` — `out.opp.value` must be a **stat** (e.g. opposing pitcher K% / batting-allowed), not the opponent team name repeated. Currently `label="vs <team>"` and `value=<team>` → "vs Dodgers Dodgers".

---

## 5. STOP — decisions for operator + Claude-A

1. **Scope confirm:** the rebuild is mostly **assembly/surfacing** (per-pick statBacking + a pitcher branch + rewire `buildReasoning`), not a big new ingest. Agree to scope it that way?
2. **Ingest priority:** opponent team K% first (unblocks pitcher Ks). OK to put it at the top of the feed list?
3. **Park hits factor:** trust `hitsFactor` (currently withheld as unreliable) or leave it out of the hits card?
4. Then I scope the build (prop-aware `buildReasoning` + serve-time statBacking + pitcher bundle) as its own PHASE 1, regression-gated, operator-reviewed.

No code written. Every claim above is file:line- or probe-backed; gaps are named honestly with the feed required.
