# Prop-Specific Card Layout + Real Samples (show-before-edit)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** show-before-edit for the all-in-one rebuild. Layout + REAL sample cards (live data) + the assembly mechanism + one coverage caveat the operator should weigh before the rewrite.
**Builds on:** `prop_predictors_data_map.md` (the approved data map).

---

## 1. The three card layouts (rows, order, labels) + REAL samples from tonight's data

Every row is **omit-not-fabricate**: it renders only when the stat is real for that pick. Labels are plain; a helps/hurts read is added where it isn't obvious (vs the league baseline).

### Pitcher strikeouts — `Recent Ks · Season · Opp lineup K% · Expected outs`
Real sample (probe, live caches) — **Paul Skenes (Ks over 6.5)**:
```
Recent Ks   L2 avg 8.5/start (7, 10)
Season      29% K (82K/278 BF) · 10.5 K/9 · 0.90 WHIP
Workload    5.4 IP/start (13 GS, 70 IP)
Opp lineup  — (omitted: Dodgers not in batter cache tonight; see §3 caveat)
```
Source: `mlbPitcherGameLogs.json` (recent Ks) · `mlbPitcherStats.json` (K%/K9/WHIP/IP) · opp-lineup-K% derived from `mlbBatterStats` (when the opposing team is cached).

### Batter hits / total bases — `Facing · Season · Last 5 · Last 15 · Platoon · Park`
Real sample — **Victor Robles (Hits)**:
```
Facing      Trevor Rogers (17% K)        ← low-K pitcher = helps a contact bat
Season      .276 AVG · .345 SLG · 21% K
Last 5      0.2 H/G · 0.2 TB/G
Last 15     0.5 H/G · .313 AVG
Platoon     advantage (R vs L)
```
Source: snapshot `pitcherEnvironmentContext` (opposing pitcher) · `mlbBatterStats` (season line) · `getBatterForm` L5/L15 · platoon/hand on the row · park doubles factor when real.

### Home runs — `Power form · Season power · Park · Weather · Pitcher HR/9`
Real sample — **Jose Altuve (Home Runs)**:
```
Power form  L15: 1 HR · .250 ISO
Season      2.9% HR rate · .143 ISO
Park        HR 1.00x (neutral)
Weather     wind out to CF 35.6 mph · 77.7°F   ← out + warm = helps carry
Pitcher HR/9  — (b: computed in HR candidate engine; wire in if promoted)
```
Source: `getBatterForm` (recent HR / ISO) · `mlbBatterStats` (season ISO/HR rate) · `parkContext.hrFactor` · `weatherContext`.

**The #101 fix:** the old `vs <team> · <team>` row is gone — "Facing" now carries the opposing **pitcher + a real rate**, not the team name twice.

---

## 2. Assembly mechanism (how the stats reach every pick — not just 3.6%)

For each Top Picks pick, at serve time (no new network, all file caches):

- **Resolve the player's snapshot row by canonical `normPlayer`** (covers the full slate, not the 92-row board). The batter prop row already carries `pitcherEnvironmentContext` (opposing pitcher kRate/gb/fb), `parkContext`, `weatherContext`, platoon/hand.
- **Batters:** attach the season line from `mlbBatterStats[normPlayer]`, add L5/L15 from `getBatterForm`, then run `buildMlbDisplayBundle` → full `statBacking`. (Today this reaches ~0 picks because top-picks never does this lookup; the fix is to do it for every pick.)
- **Pitchers (Ks):** a **new pitcher-shaped assembly** — L5/L15 Ks from `mlbPitcherGameLogs.players[normPlayer]`, K%/K9/WHIP/IP-per-start derived from `mlbPitcherStats[normPlayer]`, opp-lineup-K% from §3.
- `buildReasoning` then renders the prop-specific rows above from `statBacking`, omit-not-fabricate. **Pick selection / edge / tier / odds are untouched** — only the reasoning display changes (byte-identical pick gate).

**No new external feed is needed.** Opp-lineup-K% is *derived* by averaging the opposing team's batter kRates that are already cached.

---

## 3. The one caveat + decision for the operator

**The batter cache covers 16 of 30 teams right now** (`mlbBatterStats.json` = 208 batters / 16 teams tonight, not the full 30-team slate). Consequence, handled honestly by omit-not-fabricate:
- A batter on an **uncached** team → the **Season** row (and his contribution to any opp-lineup-K%) is **omitted**, never faked. His Facing/L5/L15/Platoon/Park rows still render from the other caches.
- **Opp lineup K%** renders only when the opposing team is cached (tonight: works for the 16 cached teams; omitted for e.g. the Dodgers). League avg = 23% for the helps/hurts read.

This is truthful but means some cards are thinner tonight than they'll be once the batter cache covers all 30 teams.

**Decision:** ship the rebuild now with **omit-when-absent** (every real stat shows; missing ones omit) — and treat **expanding the batter-stats populator to the full 30-team slate** as a separate, follow-up coverage task (it widens Season + opp-K% coverage without changing this rebuild). Recommended. Alternative: block the rebuild until the batter cache is full (slower; the operator has waited long enough for the trust card).

---

## 4. Build plan (on layout confirm) — all-in-one, byte-identical pick gate

1. Serve-time per-pick `statBacking` assembly in `/api/ws/top-picks` (and the same helper for GAMES/state for consistency).
2. New pitcher-shaped assembly (extend `buildMlbDisplayBundle` with a pitcher branch or a sibling `buildMlbPitcherStatBacking`).
3. `opponentKPercent` derivation helper (aggregate opposing lineup kRates; omit when team uncached).
4. Prop-aware `buildReasoning` rewrite (the layouts above) + #101 fix.
5. Regression: pick selection/edge/tier/odds byte-identical pre/post; spot-check all 3 prop types on real cards; absent stats omitted; opp-K% traces to real aggregation; node --check + FE check + reload; Claude-A screenshot-verifies.

**Confirm the layout reads right + the omit-when-absent coverage approach, and I build all-in-one.**
