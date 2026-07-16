# FULL-SPECTRUM INGESTION AUDIT — Four Sports, Every Exploitable Angle, Graded

**Date:** 2026-07-16 · **Author:** Claude-C (research, Fable 5) · **Mandate:** the exploitation map — every ingestible signal class per sport (MLB now; NFL ~Sept; NHL ~Oct; NBA ~late Oct), graded and costed, plus the LADDER capture requirements (G2 enabler) and a calendar-aligned build roadmap.
**Extends, never re-derives:** moonshot map (07-07) · signal menus (06-15 ×2) · longshot loop (06-29) · strategy deep-dive (07-05) · MLB signal-ingestion track (memory: #25/#28/#29/#30 staged). **Tags:** [REPO] · [AUTH] · [PRAC] · [PRIOR]. Grades: **REAL / SPECULATIVE / FANTASY**, always with why.
**Product-surface legend:** **LAD** ladders (G2) · **PAR** parlay legs (G3/G4) · **D3** Daily 3 · **NO** night-owl early lines · **SCR** live scratch protection.

---

## 0. Standing verdicts that frame everything (do not re-litigate)

1. The frontier is wiring + forward-testing, not feed-hoarding: four MLB signals sit staged and untested-forward [PRIOR: moonshot §1]. New ingestion below is ranked with that discipline.
2. Social ingestion: X API = pay-per-use dead end; Bluesky Jetstream = free/legal structured feed [PRIOR: moonshot §1.5]. Per-sport reporter lists are the only new work.
3. Splits are REAL but game-level only (DK/VSIN) [PRIOR: moonshot §1.4]. Appears once per sport table below, not re-argued.
4. Everything here uses vendor/official/free-download sources — zero book-site scraping [doctrine].

**Vendor quota reality (the constraint everything prices against)** [AUTH: [cost formula](https://the-odds-api.com/liveapi/guides/v4/), FAQ; REPO probe headers]: event-odds cost = *unique markets returned × regions*, where every group of 10 bookmakers in a `bookmakers=` list counts as one region-unit (our 6-book CSV = 1). Measured mid-month burn: 17,312 used / 82,688 remaining on 2026-07-16 [REPO: .scratch/deeplink_probe.txt headers] → ~35k/mo pace on a 100k plan. **Headroom exists but is NOT infinite: full-ladder capture every hourly cycle would roughly double prop-call cost and threaten the cap; the roadmap prices alternates at 3 passes/day instead (§6).**

---

## 1. MLB (live now — additions only; the pipes are the house standard)

| Signal class | Source (cost) | ToS | Pipe-fit | Grade | Surfaces |
|---|---|---|---|---|---|
| Weather/park/air-density | Open-Meteo + static park factors (#28 staged) [REPO] | clean | DONE — needs forward test, not ingestion | REAL (magnitude TBD) | LAD·PAR·NO |
| Lineups/scratch latency | MLB StatsAPI free; lineups ~2–4h pregame; upgrade = 5-min pre-close diff poll | clean | HIGH — extends existing pulls | REAL (small, cheap) | SCR·D3 |
| Batting order precision | same feed; already canonical (lineupSpot 1–9 in PCE) [REPO] | clean | DONE | REAL | LAD·PAR |
| Pitch-mix vs swing profile | Statcast/pybaseball free (#25 partially staged) | clean | MED — extend staging, join on Statcast IDs | SPECULATIVE (edge unproven; books price the obvious splits) | LAD·PAR |
| BvP (batter-vs-pitcher) | StatsAPI free | clean | HIGH | FANTASY as signal — n too small; classic trap [PRIOR: 06-15]; ingest only as display context, never scoring | — |
| Umpires (#27 — the hole) | RefMetrics/RotoWire/Action free, day-of [PRIOR: moonshot §1.3] | clean (read, cite) | HIGH — staging-file pattern | REAL (K/total props mechanism documented) | LAD·PAR·D3 |
| Bullpen fatigue (#29) | staged [REPO] | clean | DONE — forward-test | REAL-ish | PAR |
| Travel/rest/schedule spots | derivable free from StatsAPI schedule (getaway-day day-games, cross-country legs) | clean | MED — pure computation | SPECULATIVE (public + likely priced; test before trusting) | PAR |
| Steam/line-velocity | OUR OWN captures (hourly + 5-min close loop + 6AM/22:00 trueOpen) [REPO: ccf3a76] | clean | HIGHEST — zero new data | REAL as timing/CLV signal [PRIOR: moonshot §1.1] | NO·D3·LAD |
| Exchange fair-value leg | The Odds API `us_ex` region (novig/prophetx/kalshi) — +1 region-unit per call where requested [AUTH] | clean | HIGH — param + canonicalBook entries | REAL as benchmark (thin props coverage caveat [PRIOR: 07-05]) | all (benchmark) |
| Promos/boosts | manual entry UI (operator taps offer in) + EV pricer vs our de-vig fair | clean | MED — no automated feed exists without scraping (that part: skip) | REAL (deterministic floor [PRIOR]) | D3-adjacent |
| External cross-check projections | FanGraphs Steamer/ZiPS ROS pages free-view (no API; cite-and-eyeball), THE BAT X paid (~$) — **skip paid** | gray if scraped — DON'T; operator-glance only | LOW | SPECULATIVE as pipeline, REAL as sanity glance | — |

**MLB verdict:** ingestion is ~done. Finish #27, wire the staged four through forward CLV, add velocity + exchange benchmark. Nothing else new for MLB.

---

## 2. NFL (returns ~Sept; **August is the build window**)

The weekly rhythm changes everything: props post Wed–Thu for Sunday [PRIOR: 07-05 microstructure], injury reports are a Wed/Thu/Fri practice-participation ritual with designations Fri — a *scheduled* information cascade, unlike MLB's daily scramble.

| Signal class | Source (cost) | ToS | Pipe-fit | Grade | Surfaces |
|---|---|---|---|---|---|
| **Snap/target/usage shares** | **nflverse/nflreadpy FREE** — snap counts (updates 0/6/12/18 UTC in-season), depth charts (daily 7AM UTC), pbp since 1999, NGS [AUTH: [nflreadr schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)] | clean (open data project) | MED — new adapter, but batch-file simple (parquet/CSV pulls) | **REAL — the #1 NFL spine; role/usage is the prop driver** | LAD·PAR·D3 |
| **Injury/practice reports** | **HONEST FINDING: nflverse's injury source DIED post-2024 — no 2025 data, no ETA** [AUTH: [load_injuries](https://rdrr.io/cran/nflreadr/man/load_injuries.html)] → fallback = ESPN unofficial API (fragile) or Bluesky beat-list (§0.2) + operator glance | ESPN unofficial = gray-but-tolerated read | MED | REAL need, source UNSETTLED — **August decision item, not a scramble in Sept** | SCR·PAR |
| QB status | same cascade; the market's fastest-priced input | — | — | as above; QB news itself = FANTASY to beat, downstream usage shifts = REAL [PRIOR: usage-redistribution] | PAR |
| Weather | Open-Meteo (have); matters for totals/kicking/deep passing | clean | DONE-adjacent | REAL (documented, partially priced) | PAR·D3 |
| Coverage/scheme, DvP | PFF/FTN paid ($30–40/mo class); nflverse participation data partial/free | clean | LOW | SPECULATIVE — skip paid year one; books employ people who read PFF too | — |
| Officials (crews) | Football Zebras/refstats free; crew over/flag tendencies | clean | LOW — annual static + weekly assignment | SPECULATIVE (small, public) | PAR |
| Schedule spots (TNF short week, post-bye, travel) | free schedule computation | clean | HIGH | SPECULATIVE→REAL only where our own graded data confirms | PAR |
| Ladders (alt props) | vendor: full `player_*_alternate` NFL suite [AUTH: markets page] | clean | HIGH — same capture pattern as MLB | REAL (see §6) | LAD |
| Splits (DK/VSIN game-level) | free [PRIOR] | clean | HIGH | REAL-coarse | PAR context |

**NFL verdict:** two August builds — the nflverse spine adapter and the injury-source decision — plus market-key config. Weekly cadence = *lower* quota burn than MLB (one slate/week + TNF/MNF).

---

## 3. NHL (returns ~Oct)

| Signal class | Source (cost) | ToS | Pipe-fit | Grade | Surfaces |
|---|---|---|---|---|---|
| **Starting goalies** | THE NHL scratch-equivalent; DailyFaceoff publishes confirmations (site, no API; morning-skate → gameday trickle) | scraping their site = gray — treat as operator-glance + Bluesky beat-list; NHL API `api-web.nhle.com` starters appear near puck-drop (free, unofficial-but-open) | MED | **REAL need — goalie identity swings totals/saves/win props like a pitcher change** | SCR·PAR·D3 |
| Shot-level history | **MoneyPuck free downloads** — every shot 2007→present, 124 attributes [AUTH: [moneypuck.com/data.htm](https://moneypuck.com/data.htm)]; Natural Stat Trick aggregates free | clean (published downloads) | MED — one-time bulk + nightly increment | **REAL — the per-player distribution spine for SOG/goals ladders** | LAD |
| TOI / line combos / PP units | NHL API boxscores free (TOI); combos: DailyFaceoff/LeftWingLock sites (no API) → derive combos from our own pbp ingest instead (shift data in NHL API) | clean if derived | MED | REAL for TOI (the NHL "minutes"); combos SPECULATIVE (derivable but noisy) | LAD·PAR |
| B2Bs / travel | schedule computation free; B2B goalie-rest interaction is the documented angle | clean | HIGH | REAL-small (partially priced; test) | PAR |
| Officials (refs) | Scouting the Refs free; penalty-rate tendencies → PP-dependent props | clean (read) | LOW | SPECULATIVE (public, small) | PAR |
| Ladders (alt props) | vendor: `player_goals_alternate`, `player_shots_on_goal_alternate`, `player_points_alternate`, saves alt [AUTH] | clean | HIGH | REAL (see §6) | LAD |
| External cross-check | MoneyPuck game/player projections free | clean | LOW-effort glance | REAL as sanity check (free + public = no edge, good honesty rail) | — |

**NHL verdict:** cheapest new sport to stand up honestly — one bulk MoneyPuck download + NHL API adapter + a goalie-confirmation ritual. The goalie feed is the only hard operational problem (same class as MLB scratch latency).

---

## 4. NBA (returns ~late Oct — pipes largely EXIST [REPO])

| Signal class | Status | Grade | Surfaces |
|---|---|---|---|
| Injuries/lineups | ESPN slate-wide feed autopiloted [REPO: memory espn-injuries] — re-verify endpoint liveness in Oct, off-season drift likely | REAL (have) | SCR·PAR |
| Minutes/usage/gamelogs | ESPN gamelogs canonical autopilot [REPO] + nba_api free for possession-level if G2 needs deeper distributions | REAL (have + free upgrade path) | LAD |
| Usage-redistribution on news | THE documented NBA edge [PRIOR: research-findings #1 codifiable] — build = selection logic on existing feeds, not ingestion | REAL | PAR·D3·SCR |
| B2B/rest/schedule | computable free (have injury/schedule data) | REAL-small | PAR |
| Refs | official.nba.com daily assignments free; over/whistle tendencies [PRIOR: 06-15 menu] | SPECULATIVE (public) | PAR |
| DvP | free scrapes coarse [PRIOR: craft playbook] — display context, weak signal | SPECULATIVE | — |
| External cross-check | **DARKO free** (public gold-standard player projections) — ingest as calibration cross-check, never as our number | REAL as cross-check | — |
| Ladders | vendor: full NBA alternate suite incl. combined (PRA etc.) [AUTH]; turnovers still absent as base market (re-probe Oct [REPO: memory]) | REAL | LAD |

**NBA verdict:** re-activation + one honest upgrade (DARKO cross-check) + the usage-redistribution selection build. Smallest lift of the three returning sports.

---

## 5. Cross-sport: news latency infrastructure (one build, four sports)

Bluesky Jetstream consumer (free [PRIOR: moonshot §1.5]) + per-sport curated reporter lists + slate-entity matcher (player/team names on today's board) → one alert channel feeding SCR across all sports. Per-sport lists are editorial work (seed: 06-15 named-follows; NFL/NHL lists built in Aug). Grade: REAL as infrastructure, SPECULATIVE as edge magnitude (mins-level latency win, sometimes beaten) — but it powers the *protection* surface (don't bet into news), which needs no edge claim.

---

## 6. LADDER-SPECIFIC SECTION — what G2 actually requires (top priority)

**What we get today:** base prop markets only — grep shows no `_alternate` keys requested anywhere [REPO: buildMlbBootstrapSnapshot markets]. The NegBinom shadow (G2) fits curves from gamelogs but the MARKET side of ladders (all rungs, all books) is uncaptured — we model ladders we never price.

**What the vendor offers (all four sports, confirmed):** full alternate suites — MLB `{batter_*,pitcher_*}_alternate` (17 keys), NBA `player_*_alternate` incl. PRA combos (12), NFL alternate suite (26), NHL (7) [AUTH: [markets list](https://the-odds-api.com/sports-odds-data/betting-markets.html)]. Alternates = "milestones (X+ lines) and markets books label alternate" — exactly the rung space the parlay-craft vision needs. Per-event endpoint only (already our pattern).

**Cost math (honest, from the formula + measured burn):** adding ~8 MLB alternate keys to a 15-event slate costs ~8×15 = ~120 credits per capture pass (6-book CSV = 1 region-unit). Hourly (15 passes/day) ≈ +1,800/day ≈ +54k/mo → **BLOWS the 100k plan on top of current ~35k pace.** At 3 passes/day (post-6AM trueOpen, 22:00 night-owl, T-60min pre-close) ≈ +360/day ≈ **+11k/mo → comfortably inside plan. Recommendation: 3-pass ladder capture, hourly stays base-markets-only.** $0 incremental; plan upgrade only if NFL+NHL+NBA concurrency in Nov demands it (re-price then with measured burn).

**Which books post deepest ladders:** expected FD/DK (they carry ~75% of slate depth [REPO: coverage audit]) but UNVERIFIED per-rung — the same probe pattern as deep-links answers it in one pre-game run: request alternate keys on 2 events, count rungs per book per family. Hand CB with the Phase-0 fence.

**Historical distribution spines per sport (the model side of honest per-player curves):**

| Sport | Unit | Source | Status |
|---|---|---|---|
| MLB | PA-level | Statcast/pybaseball + StatsAPI gamelogs | HAVE [REPO] |
| NBA | possession/minutes | ESPN gamelogs (have) + nba_api pbp (free upgrade) | HAVE-mostly |
| NFL | snap/target | nflverse weekly + NGS, free | BUILD (Aug) |
| NHL | TOI/shots | MoneyPuck shot-level bulk + NHL API | BUILD (Sept) |

**Grade for the whole ladder program: REAL** — it enables pricing/EV on rungs (mechanics), while the EDGE stays whatever calibration + CLV prove. Capturing ladders ≠ beating ladders; G2's forward gate still decides.

---

## 7. PHASED ROADMAP — calendar-aligned, costed, ranked by exploit-value / $ / operator-hour

| Phase | When | Items (ranked within phase) | $/mo | Build effort | Why this order |
|---|---|---|---|---|---|
| **0 — MLB now** | Jul | (1) **Ladder capture 3-pass + rung-depth probe** [G2 enabler, §6] · (2) line-velocity layer from existing captures · (3) umpire #27 staging · (4) exchange `us_ex` capture on the 3 passes · (5) scratch fast-poll pre-close · (6) DK/VSIN splits daily pull | $0 (≈+11–13k credits/mo inside plan) | S/S/S/S/S/S — each days-class | G2 is next in the chain; everything else here is zero-new-vendor and feeds D3/NO/SCR immediately |
| **A — lead time** | Aug | (1) **nflverse spine adapter** (snap/target/depth/pbp priors) · (2) **NFL injury-source decision** (nflverse feed dead — pick ESPN-unofficial vs Bluesky-list vs operator-ritual, decide THEN) · (3) NHL: MoneyPuck bulk download + NHL API adapter · (4) NFL+NHL market-key configs into the canonical fetchers (extend, never sibling — Law 1) · (5) Bluesky reporter lists ×2 sports | $0 | M/S/M/S/S | Sept must not be a scramble; all free; no live burn until seasons start |
| **B — NFL live** | Sept | (1) NFL prop+alt capture on (weekly cadence = LOW burn) · (2) forward-CLV scoreboard per NFL family from day 1 · (3) goalie-ritual dry-run in NHL preseason | +credits (weekly slates; well inside plan) | S | Capture + measure FIRST; NFL selection models only after weeks of graded data — no launch-week hero picks |
| **C — NHL+NBA live** | Oct | (1) NBA re-activation + endpoint re-verify + turnovers re-probe · (2) NHL props on + goalie feed live · (3) DARKO cross-check ingest · (4) usage-redistribution selection build (NBA) | $0–credits | S/M/S/M | NBA pipes exist; NHL rides Phase-A spine |
| **D — re-price** | Nov | Concurrency check: 4-sport quota math on MEASURED burn → plan upgrade only if data says so | TBD (measured) | XS | Never pre-buy capacity on projections |

**Paid products explicitly SKIPPED year one (named, with why):** PFF/FTN (scheme data — SPECULATIVE edge, books read it too), SportsDataIO/Sportradar (duplicate of free spines at $500+/mo class), THE BAT X/paid projections (cross-checks must not become crutches), X API (dead on cost [PRIOR]). Re-open any of these only when a graded record shows the free spine is the binding constraint — not before.

**The ruthless self-grade of this whole audit:** ingestion powers surfaces and protection; it has never been our binding constraint — selection honesty was, and the chain (N1→G2→G3→G4) plus the live record remain the critical path. If this roadmap ever competes with the chain for CB-hours, the chain wins. That sentence is the audit's most important line.

---

## Sources

**Repo/prior:** ccf3a76 (night-owl trueOpen passes) · 4efacb1 (Daily 3) · .scratch/deeplink_probe.txt (quota headers) · buildMlbBootstrapSnapshot.js markets grep · docs/research/ 07-07 moonshot · 06-15 ×2 · 06-29 · 07-05 · memory: mlb-signal-track, espn-injuries, nba-turnovers.
**Web (new):**
- [The Odds API — betting markets list (full alternate suites per sport)](https://the-odds-api.com/sports-odds-data/betting-markets.html) [AUTH]
- [The Odds API — v4 docs/FAQ (cost = markets × regions; 10-bookmaker groups)](https://the-odds-api.com/liveapi/guides/v4/) [AUTH]
- [nflverse — data update & availability schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html) · [load_injuries (source dead post-2024)](https://rdrr.io/cran/nflreadr/man/load_injuries.html) · [nflreadpy](https://github.com/nflverse/nflreadpy) [AUTH]
- [MoneyPuck — data downloads (shot-level 2007→, 124 attrs)](https://moneypuck.com/data.htm) [AUTH] · [DataPunkHockey — free sources overview](https://www.datapunkhockey.com/free-data-sources/) [PRAC]
- [RefMetrics umpires](https://www.refmetrics.com/baseball/mlb/umpire-assignments) · [RotoWire umpire stats](https://www.rotowire.com/baseball/umpire-stats-daily.php) [PRAC] (carried from moonshot)
- [VSIN splits](https://data.vsin.com/betting-splits/) · [DK Network splits](https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/) [AUTH/PRAC] (carried)
- [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream) [AUTH] (carried)
