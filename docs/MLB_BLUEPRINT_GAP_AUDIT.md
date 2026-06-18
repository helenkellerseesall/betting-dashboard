# MLB BLUEPRINT GAP AUDIT — repo vs the standard MLB-betting blueprint

**Status:** READ-ONLY audit · Claude-B (CB) · 2026-06-17 · no code, no scoring change.
**Core question answered up front:** **NOTHING in the blueprint is missing *because of the freeze.***
The R2 freeze blocks SCORING/SELECTION (how signals are weighted/gated), NOT data ingestion.
Every gap below is "not built yet," and every one is **FREEZE-SAFE to INGEST** now. The freeze
only blocks *using* a new signal in scoring/selection — which is a separate, gated step.

Legend: **HAVE** (present, file:field) · **PARTIAL** (present but weak/heuristic/thin) ·
**MISSING** (absent). Freeze: **INGEST-SAFE** (additive data, freeze-exempt) vs **SCORING-BLOCKED**
(using it in scoring/selection waits for the freeze lift + governance).

---

## 1. STARTING PITCHER
| Metric | Status | Where / note |
|---|---|---|
| K% (kRate), BB% (bbRate) | **HAVE** | `refreshMlbPitcherStats.js:197-198` (strikeOuts/walks ÷ battersFaced) |
| WHIP, ERA | **HAVE** | `refreshMlbPitcherStats.js:200-201` |
| FIP, xFIP, SIERA, xERA, LOB%, HR/9 | **MISSING** | none in repo (sabermetric grep = substring false-positives only) |

Have the basic/result-based four; **all fielding-independent metrics absent**. INGEST-SAFE.
Source: FanGraphs / pybaseball (`pitching_stats`) for FIP/xFIP/SIERA/xERA/LOB%/HR9.

## 2. BULLPEN
| Metric | Status | Where / note |
|---|---|---|
| 3-day high-leverage / fatigue | **HAVE** | `refreshMlbBullpenWorkload.js:127-150` (reliefIp, highLeverageUses, closerLeverageRank); `deriveMlbBullpenContext.js:54-79` (recentInningsLast3Days, highLeverageUsesLast3Days, reliefFatigueScore, bullpenShift) |
| Relief FIP / xFIP / WHIP | **MISSING** | only innings + high-leverage *count* — no quality-of-relief metric |

Fatigue modeled (volume); **relief quality (FIP/WHIP) absent**. INGEST-SAFE. Source: FanGraphs team-relief splits / pybaseball.

## 3. HITTER CONTACT / DISCIPLINE
| Metric | Status | Where / note |
|---|---|---|
| "powerScore" (the live one) | **HAVE (not Statcast)** | `deriveMlbStatcastPower.js` (nightly via `auditNightly.js`) derives powerScore from `mlbBatterStats.json` **iso + hrRate** (`36 + (iso−.140)*40 + (hrRate−.035)*150`, clamp[25,58]); sets `avgExitVelocity: null`. Consumed by HR scoring (`buildMlbHrPredictionCandidates.js`). **No Savant, no exit velocity.** |
| Barrel% · Hard-Hit% · xwOBA (+ xSLG/xBA/wOBA · avg EV) | **HAVE (staging, unwired)** | NEW `deriveMlbStatcastQuality.js` (2026-06-18, v2) → `backend/data/mlbStatcastQuality.json`. Joins the two Savant SEASON-AGGREGATE leaderboard CSVs — `expected_statistics` (xwOBA/xBA/xSLG/wOBA) + `exit_velocity_barrels` (barrel%/hard-hit%/avg EV) — current-ET-season (from `slateDate`), one row per qualified player. (v1 used `statcast_search` event search → 0 coverage; fixed.) **Zero live consumer by design** — wire post-freeze + forward-CLV-gated. |
| wOBA · wRC+ · ISO · Chase/O-Swing% | **MISSING** | not in Savant `statcast_search` — needs FanGraphs / pybaseball (`statcast_batter_*` for plate-discipline) — separate later task. |
| ⚠ correction (was wrong here) | — | The old row blamed `buildMlbStatcastPower.js:36` (`hfSea=2025`). That file is a **test-guarded ORPHAN** (`verifyOrphanAuthorityHardening.js:161` asserts zero require callers; in runtime:verify) and its output is **overwritten** nightly by `deriveMlbStatcastPower.js` — so its stale season is dead/irrelevant, NOT the live path. Do not edit it. |

Statcast **quality** (barrel%/hardHit%/xwOBA) now EXISTS as a staging ingest (current-season, real,
anti-fabrication-guarded) but feeds nothing yet — wiring into HR scoring / the snapshot is the
post-freeze, forward-CLV-gated step. Discipline metrics (wOBA/wRC+/ISO/chase) still need a
FanGraphs/pybaseball source.

## 4. SPLITS
| Split | Status | Where / note |
|---|---|---|
| Handedness vs LHP/RHP | **PARTIAL (flat heuristic)** | `deriveMlbHandednessContext.js:62-64` — opp non-switch **+0.022**, switch **+0.012**, same **−0.020**. NOT real per-player splits (no vsLHP/vsRHP wOBA). Confirmed: it's a bounded constant, not data. |
| Home / away | **HAVE (thin)** | `isHome` signal, weight 0.04 (`buildMlbBootstrapSnapshot.js:319-321`) |
| Rolling form | **PARTIAL** | `mlbBatterFormCache.js:161-162` batterL5 + batterL15 (5/15-GAME); no 7/14/30-DAY calendar windows; opposingPitcherL3/L5 exist |

Real per-player platoon splits **absent** (flat ±0.022 stand-in). INGEST-SAFE. Source: pybaseball / Savant platoon splits, FanGraphs split leaderboards.

## 5. ENVIRONMENT
| Item | Status | Where / note |
|---|---|---|
| Park factors | **HAVE** | `deriveMlbParkContext.js` → parkContext.hrFactor / hrEnvironmentTag (96% coverage) |
| Wind speed / vector | **HAVE** | `refreshMlbWeatherForSlate.js:113` Open-Meteo (wind_speed_10m, wind_direction_10m) → weatherContext.windDirectionTag/windSpeedMph/windDirectionDeg |
| Air density (temp+humidity+elevation) | **PARTIAL** | temp + humidity ingested (`refreshMlbWeatherForSlate.js:113,127`); **elevation `altitudeFt: null`** (`deriveMlbParkContext.js:75`); no computed airDensity |
| **UMPIRE strike-zone** | **MISSING** | zero umpire/strikeZone refs anywhere |

Park + wind solid; air-density missing elevation + no composite; **umpire entirely absent**. All
INGEST-SAFE. Sources: Open-Meteo (already wired — add station elevation); umpire — UmpScorecards /
EVAnalytics / Retrosheet (assigned-ump + historical zone tendencies).

## 6. MARKET
| Item | Status | Where / note |
|---|---|---|
| Implied prob | **HAVE** | impliedProb on every row |
| CLV | **HAVE** | `buildClv.js` + closeOdds/clvQuality (capture fixed docket #2) |
| Hold% / vig | **HAVE** | `vigStripping.js:48-57` stripVigTwoWay → vig; fairProbFromAmericanPair |
| Market consensus line | **HAVE** | consensusImpliedProbability + bookImpliedDispersion on snapshot rows |
| **SHARP benchmark (Pinnacle / Circa / Bookmaker)** | **MISSING** | `sportsbookAllowlist.js:40-41,28` = 7 RETAIL books (DK/FD/Fanatics/BetRivers/BetMGM/HardRock/bet365) + Caesars feed. No Pinnacle/Circa. → consensus + CLV are **retail-only**; CLV is vs our own open, not a sharp close. |

The big one: **no sharp book in the feed**, so "beat the close" is measured against retail
consensus, not a sharp line. INGEST-SAFE. Source: the Odds API exposes Pinnacle (us2/eu regions) —
adding it to the fetch is ingestion, not scoring.

## 7. PROCESS / TOOLING
| Item | Status | Where / note |
|---|---|---|
| Multi-book line-shop | **HAVE** | `buildLineShoppingIntelligence.js`; surfaced on /m (docket #1) |
| Bet log | **HAVE** | `mlb_tracked_bets_<date>.json` (phase4Tracking) |
| **MLB bankroll / unit staking** | **HAVE** (corrects "expected MISSING") | `buildMlbOpportunityBoard.js:438` buildMlbBankrollPlan + `:537` kellyUnitsForPlay — Kelly + tier sizing + per-player + daily caps. NOT NBA-only. |
| First-5-innings (F5) markets | **MISSING (parked)** | `sportConfig.js:148-150` — period markets (`totals_1st_1_innings` etc.) explicitly "a separate market class PARKED on backlog, not a player prop" |

INGEST-SAFE for F5 (it's a market-fetch addition).

---

## FREEZE VERDICT (the operator's core question)
Every gap is **"not built," not "freeze-blocked."** All of it is INGEST-SAFE during the freeze —
ingestion adds fields to the snapshot, which the freeze does not touch. What the freeze blocks is
**using** any new signal inside scoring/selection (tierForPlay/edge/modelProb weighting) — that's
the governed post-freeze step. So we can ingest everything now; we just can't *wire it into
scoring* until ~06-25 + governance.

---

## RANKED FREEZE-SAFE INGESTION PLAN (honest about value tiers)

### (a) Confirmed-edge / near-done — finish these first (highest certainty)
1. **Add a SHARP book (Pinnacle) to the Odds API feed.** Today CLV/consensus are retail-only;
   a sharp benchmark turns "beat the close" into the real, trustworthy CLV signal that docket #1/#2
   and the selection re-point all lean on. INGEST-SAFE (add a book to the fetch). **Highest value.**
2. **Add station elevation → air-density** (cheap; Open-Meteo already wired) — completes the wind/
   park environment that park-CLV will test.
3. Line-shop (done/surfaced), CLV capture (fixed docket #2 — watch it climb forward), MLB bankroll
   (have), selection re-point (spec ready, gated on G1). Nothing to ingest — these are wiring/forward.

### (b) Plausibly edge-relevant matchup-context — ingest now, test via the docket #3 context-CLV loop
4. **UMPIRE strike-zone** (assigned ump + zone tendency) — the highest-signal missing context;
   feeds the context-CLV test directly. Source: UmpScorecards / Retrosheet.
5. **Real per-player handedness splits** (replace the flat ±0.022 heuristic with actual vsLHP/vsRHP).
6. **Relief-quality (bullpen FIP/WHIP)** to complement the fatigue volume we already have.
   → All three become *testable* (not just ingested) once docket #3 context-persistence accrues
   forward graded days. Ingest now; prove forward; only THEN wire into selection (post-freeze).

### (c) Speculative model-fuel — freeze-safe but uncertain payoff (do NOT assume edge)
7. The big sabermetrics list: pitcher FIP/xFIP/SIERA/xERA/LOB%/HR9; hitter wOBA/wRC+/ISO/Barrel%/
   Hard-Hit%/Chase/O-Swing%; fix the stale Statcast season + extend the Savant parse.
   **Reality check (G4):** the market is already sharper than our model on the current bet
   population. Ingesting these only helps IF they sharpen modelProb enough to beat the closing line
   on SOME slice — unproven. Ingest is cheap and freeze-safe, but **"ingest all = edge" is false.**
   Sequence them behind a forward-CLV test (same discipline as the selection re-point): ingest →
   shadow-feature → does it move forward CLV on a slice → only then graduate.

**One-line bottom line:** the dependable next ingestion is a **sharp book (Pinnacle)** for a real
CLV benchmark (tier a); umpire + real splits are the best *context* bets (tier b, test via docket #3);
the sabermetrics wishlist is tier c — cheap to ingest, payoff unproven, never wire to scoring without
a forward-CLV gate. None of it is blocked by the freeze — only its use in scoring is.
