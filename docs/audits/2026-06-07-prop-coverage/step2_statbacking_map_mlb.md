# Step-2 Stat-Backing Availability Map — MLB

**Date:** 2026-06-08 ET · **Author:** Claude-B (4.8) · **Type:** read-only audit, no code, zero bettor delta
**Goal:** the literal spec for the believable MLB pick card — for each thing the operator wants to SEE on a pick, is it (a) already on the pick, (b) computed-but-not-serialized (cheap wire), or (c) not-ingested (needs a feed)?
**Method:** code trace (file:line) + live grounding (`.scratch/probe_step2_statbacking_mlb.js/.txt`: 106 real `mlb_tracked_best_2026-06-08` picks for (a) population; 8,618 enriched snapshot rows for (b) presence).
**Cross-ref (no shadow authority):** `market-coverage-map` memory (MLB family signal state) · `operator-trust-definition-stat-attribution` memory (wishlist) · `docs/audits/2026-06-07-fe-trust-surface/synthesis.md` §E (MLB carries only `contextualTags`, no `displayBundle` — asymmetry vs NBA).

---

## 0. Headline

The MLB engine **already computes almost every stat-backing signal the operator wants** — it's enriched onto the candidate row every cycle (probe: `pitcherEnvironmentContext` on 8030/8618 rows, `batterStats` 7353, `parkContext` 8030, `lineupContextV2` 7106, `weatherContext` 6350). The gap is **serialization + rendering**, not data:
- A chunk reaches the persisted pick already → **(a)**.
- A bigger chunk is on the row but never copied to the pick → **(b)**, cheap wire.
- Only **live news/world context** is genuinely missing a feed → **(c)**.

And per the FE-trust audit §E: MLB picks carry **no `displayBundle`**, so even the (a) fields render as bare values, not reasoning. **The Step-2 card build = build an MLB `displayBundle` that renders (a), serialize the (b) fields onto the pick, and label (c) honestly.**

---

## 1. (a) ON-PICK TODAY — already serialized (live-confirmed population %)

From `toTrackedMlbBestEntry` / `leanBet` whitelists (`phase4Tracking.js`), populated on real picks:

| Field | On-pick % (106 picks) | Source |
|---|---|---|
| `impliedTeamTotal`, `gameTotal` | 100% | book lines |
| `isPlatoonAdvantage` (handedness edge) | 100% | `applyMlbContextualLayers` |
| `hrEnvironmentTag`, `hrFactor` (park HR) | 100% | `deriveMlbParkContext` |
| `windDirectionTag`, `carryShift`, `temperatureF` (weather) | 89% | `deriveMlbWeatherContext` |
| `contextualTags` (plain-English tag list) | 100% | `composeMlbContextualSignal` |
| `lineupSpot`, `depth`, `plateAppearancesProxy`, `runEnvironment`, `rbiEnvironment` | **22%** | `lineupContextV2` (sparse — see note) |

**Note on the 22%:** lineup-derived fields populate only when a confirmed lineup exists for that pick at write time. So even an (a) field is **unreliably present** today — the card must null-guard and show "lineup not yet confirmed" rather than a blank.

---

## 2. (b) COMPUTED-NOT-SERIALIZED — on the candidate row, cheap to surface

These are enriched onto the row (live-confirmed counts) but **absent from every persisted pick** (probe: all "on-pick: no"). Surfacing = extend the serializer whitelist (+ a form-cache lookup for L5/L15).

| Wishlist item | Where computed (file:line) | On row | Effort to surface |
|---|---|---|---|
| **Opposing pitcher NAME + vulnerability** (kRate, gbRate, fbRate, velocity, rest, fatigue) | `deriveMlbPitcherEnvironmentContext.js` (returns `pitcherName,kRate,gbRate,fbRate,velocityMph,restDays,fatigueFlag,kEnvironmentShift`) → `row.pitcherEnvironmentContext` | 8030/8618 | **cheap** — whitelist copy |
| **Season batting line** (avg/obp/slg/ops/iso/kRate) | `applyMlbContextualLayers.js:140` `row.batterStats` | 7353/8618 | **cheap** — whitelist copy |
| **Park factor for HITS/doubles** (not just HR) | `deriveMlbParkContext.js` → `row.parkContext` (hitsFactor/doublesFactor) | 8030/8618 | **cheap** — only `hrFactor` serialized today |
| **L5 / L15 batting line + recent trend** | `mlbBatterFormCache.js` (windowed hits/2B/3B/HR/RBI/R/BB/K over last 5 & 15) | computed on-demand, **not stamped on row** (`recentForm`/`batterForm` 0/8618) | **low-medium** — form-cache lookup at serialize time (cache exists; just not wired to the pick) |
| **Lineup detail** (spot/depth/PA proxy) for ALL picks | `lineupContextV2` on row | 7106/8618 | partly (a) at 22% — wire reliably |

**This is the cheap-win pile** — the engine's richest reasoning, "rendered nowhere" (FE-trust synthesis). A `displayBundle` that reads these row fields turns a bare MLB pick into "Judge TB o1.5 — L15 .310/9 XBH, vs Ragans (28% K, fatigued, 95 pitches last start), Yankee Stadium +6% hits, wind out 12mph, batting 2nd."

---

## 3. (c) NOT-INGESTED — needs a new feed

| Wishlist item | Status | Evidence |
|---|---|---|
| **Live news / world context** (beat-reporter scratches, breaking news, weather-delay buzz) | **(c) — no feed** | No news/twitter/headline ingestion in `pipeline/mlb/`. The closest is **structured** lineup/starter confirmation (`deriveMlbStarterConfirmationState.js`, `mlbLineupCache.js`) — that gives confirmed-lineup + scratch STATE, not free-text news. |

**Honest framing for the card:** the structured scratch/lineup-confirmation IS available and should drive a "lineup confirmed ✓ / not yet" chip + a live-state "player scratched" guard (Phase 1b already does the guard). Free-text "news" is the one real ingestion lift — label it "not wired" on the card, never fabricate a headline.

---

## 4. Wishlist coverage summary (the Step-2 card spec)

| Operator wants to SEE | Verdict | Card action |
|---|---|---|
| L5 / L15 batting line | **(b)** | form-cache lookup → render |
| Opposing pitcher + vulnerability to this stat | **(b)** | whitelist copy `pitcherEnvironmentContext` → render |
| Platoon / handedness edge | **(a)** | render `isPlatoonAdvantage` (100%) |
| Park factor | **(a)** HR / **(b)** hits | render `hrFactor`; wire `parkContext.hitsFactor` |
| Recent trend | **(b)** | derive L5-vs-season from form cache |
| Lineup spot | **(a)** sparse | render `lineupSpot`, null-guard "unconfirmed" |
| Weather | **(a)** | render wind/carry/temp (89%) |
| Live news / world context | **(c)** | label "not wired"; surface structured scratch state instead |

**Bottom line:** ~6 of 8 wishlist items are already-real or one-wire-away. Build the MLB `displayBundle` from (a)+(b); the only genuine gap is free-text news (c). No fabrication required — every rendered number traces to a computed field (probabilityHonesty / betting-dashboard-invariants).

**Out of scope / follow-up:** NBA stat-backing map (Finals ending — MLB-first per operator). The serializer-whitelist extension (b) and the `displayBundle` build are the Step-2 implementation, scoped separately.
