# Operator Truth Audit — 2026-06-01

**Audit generated**: 2026-06-01 ~20:45 ET
**Triggered by**: operator trust-reset request (full quote in `OPERATOR_SESSION_LOG.md` 18:25 ET entry)
**Scope**: 16 explicit operator concerns. Each gets a GREEN / YELLOW / RED verdict with plain-English explanation, proof, and recommended fix.

---

## Executive summary — what's actually true

Most of the autopilot **infrastructure works**. The scheduler is firing all 176 expected events today on time, the 4 AM grading autopilot completed, the 5 AM audit completed, populators are all current. The recent ship work (composite-variance fix, ledger-dedup, backend auto-recovery, status dashboard, MLB platoon persistence, NBA context persistence, free MLB lineups fallback) is all live.

**What's NOT true**: most of the bettor-visible display layer. Multiple "completed" tasks have regressed. Specifically:

| Severity | Item | What's wrong |
|---|---|---|
| 🔴 RED | Books filter | 22% of NBA picks, 75% of MLB picks shown today are off-allowlist (Hard Rock + BetRivers); task #29 supposedly closed this |
| 🔴 RED | Null-as-zero fabrications | 41 blurb fabrications today including "SAS allows 0 ppg"; task #54 supposedly closed this |
| 🔴 RED | MY BETS filter | 3 test entries (`sqlite_dualwrite_smoke` / `diag` / `cleanup_verify` at $0.01) surfacing instead of your 2 real $5 placed bets |
| 🔴 RED | CLV stamping | 0/1741 stamped on yesterday's slate (May 31) — closing-odds capture is genuinely broken, not just operator perception |
| 🔴 RED | Lifted flat fields | `isHome`, `elimination`, `game7`, `oppDef` are 0% populated despite being in persistence whitelist — wiring bug in lifted-field derivation |
| 🟡 YELLOW | Bettor language | Engineering jargon visible to bettor: "class hits 50.0% · n=14", "PLAYABLE / STRONG / ELITE" tier strings exposed |
| 🟡 YELLOW | gameContext | 0% populated today because no NBA Finals game on June 1 (Game 1 is June 3); auto-fetch shipped but the date logic only looks at today |
| 🟡 YELLOW | Ledger pollution | Historical pollution (50k JSON / 293k SQLite rows) is still there — fix from earlier today stopped NEW pollution but didn't sweep old |
| 🟢 GREEN | Autopilots | All 11 distinct event types fired their expected counts today |
| 🟢 GREEN | Dampener corpus | Rebuilt fresh at 20:01 ET today (~45 min old) |
| 🟢 GREEN | Most data fields | 90% population on core fields (oppDef, pace, shots, recentForm, displayBundle, etc.) — only the newest additions (restContext family) at 65% and the lifted-flat-field bugs at 0% |

---

## Item-by-item verdicts

### Item 1 — All 50 TOP PICKS are real, current, choose-from-able for parlays

🟡 **YELLOW**

**What's true:**
- NBA tracked_best for today (ET) has 331 entries, last refreshed 3.8 min ago. Fresh.
- MLB tracked_best for today (ET) has 121 entries, last refreshed 42 min ago. Fresh.
- The 50 TOP PICKS visible on FE are a quality-filtered slice of those 452 entries.

**What's NOT true:**
- 22% of NBA picks shown are from books you don't bet on (off-allowlist — see Item 5).
- 75% of MLB picks shown are off-allowlist (53 of 121 from Hard Rock Bet alone).
- Blurbs on individual picks have fabrications (see Item 6).
- Pick rankings are still being suppressed by the points_assists overconfidence corpus from days when MLB canonical inputs were missing — the picks ARE real but the model probability dampening on them is reactive to old broken data.

**Recommended fix**: deal with Items 5 + 6 first (book filter + fabrication filter). After those, the 50 picks become genuinely usable.

---

### Item 2 — All info on the screen is accurate / verified / up to date

🟡 **YELLOW**

**What's true:**
- File freshness is good (slates refreshing every 30 min for NBA, hourly for MLB).
- Dampener corpus is 45 min old.
- Backend uptime + commit visible on /status dashboard.

**What's NOT true:**
- Off-allowlist books shown on cards = inaccurate display.
- "SAS allows 0 ppg" tags = fabricated stats from null inputs.
- MY BETS pulls wrong entries = inaccurate count on the tab.
- Some entries have 100% field coverage, others have partial — the operator can't tell which they're looking at.

**Recommended fix**: render confidence-of-data badges on each card (✓ all signals present / ⚠ partial signals / ✗ thin data). Stops operator from staking real money on picks the engine itself isn't confident about.

---

### Item 3 — Blurbs explain WHY, with prop-type-correct stats

🟢 **GREEN, mostly**

**What's true:** Probed all 12 NBA prop families that exist on today's slate. Each gets prop-appropriate tags:

| Family | Tags present |
|---|---|
| points | STARTER, minutes, L5, **FG: 3.6 / 8.3 (44%)**, **3P: 1 / 3.1 (32%)** — points-specific ✓ |
| rebounds | STARTER, minutes, MINS↑, L5, L10 — rebounds-appropriate ✓ |
| assists | STARTER, minutes, L5, opp ast/g, L8 ast/g — assists-appropriate ✓ |
| threes | STARTER, minutes, L5, opp 3PM/g, **L8 3PM: 2.1/g** — threes-specific ✓ |
| points_rebounds | STARTER, minutes, MINS↑, L5, L10 — composite-appropriate ✓ |
| pra | BENCH/STARTER, minutes, L5, **P/R/A: 3.1 / 3.4 / 0.5** — PRA-specific ✓ |
| steals | STARTER, L5 — minimal but stat-correct ✓ |
| blocks | STARTER, minutes, MINS↑, L5 — blocks-appropriate ✓ |
| double_double | STARTER, minutes, MINS↑, L5, **DD last 5: 1/5** — DD-specific ✓ |
| first_basket | (no tags) — gap ⚠ |

**What's NOT true:**
- `first_basket` family has empty displayBundle.tags
- Tags include fabrications when opp stats are null (Item 6)
- Tags use engineering jargon (Item 4)

**Recommended fix**: add fabrication filter (Item 6) + bettor language pass (Item 4). first_basket fix is a separate small ticket.

---

### Item 4 — Bettor-readable language across the board

🔴 **RED**

**Specific jargon exposed to operator (from your screenshots):**
- `class hits 50.0% · n=14` → "n=14" is sample size; bettor doesn't know that. Should read: "This kind of pick has won 50% of the time in the last 14 we've graded."
- `PLAYABLE / STRONG / ELITE` → internal tier labels exposed unfiltered.
- `P+R` / `TotalBases` / `Pts+Ast` → inconsistent casing for the same idea (Points + Rebounds).
- `66%` next to `+17.5%` — operator likely doesn't know one is confidence and one is edge over the market.

**Recommended fix**: a single `frontend/mobile/index.html` pass that wraps every internal label in a bettor-facing translator function. Probably 1-2 hours of focused work. Examples:
- "class hits 50.0% · n=14" → "wins 50% of the time on 14 graded picks like this"
- "ELITE" → "Top tier"
- "PLAYABLE" → "Worth a look"
- "+17.5%" → "+17.5% edge over the market"
- "66%" → "model's confidence: 66%"

---

### Item 5 — Books shown match FD/DK/Fanatics/BetMGM allowlist

🔴 **RED — confirmed regression on task #29**

**Hard data, today (ET 2026-06-01):**

| Book | NBA | MLB | Allowed? |
|---|---|---|---|
| FanDuel | 138 | 7 | ✓ |
| DraftKings | 67 | 3 | ✓ |
| BetMGM | 47 | 18 | ✓ |
| Fanatics | 5 | 18 | ✓ |
| **Hard Rock Bet** | **39** | **53** | ❌ |
| **BetRivers** | **35** | **22** | ❌ |

**74 of 331 NBA picks (22%) and 75 of 121 MLB picks (62%) come from books you don't bet on.** Even worse on MLB — Hard Rock Bet alone is your most-shown MLB book.

**Recommended fix**: trace where the FE display filter is supposed to fire. Memory `[[operator-preferred-books]]` says FE display narrowed to 4. The filter exists somewhere but is bypassed. Likely a single conditional that broke in the v2 FE overhaul.

---

### Item 6 — No null-as-zero fabrications anywhere

🔴 **RED — confirmed regression on task #54**

**41 null-as-zero fabrications today in NBA tracked_best displayBundle tags.** Sample:

```
Jalen Brunson    | points_rebounds | "v STRONG D (SAS 0 ppg)"  ← Spurs do not allow 0 ppg
Victor Wembanyama| points_rebounds | "v STRONG D (NYK 0 ppg)"  ← Knicks do not allow 0 ppg
Karl-Anthony Towns | assists       | "SAS allows 0 ast/g"      ← false
                   | threes         | "SAS allows 0 3PM/g"      ← false
                   | assists        | "SAS allows 0 ast/g"      ← false (multiple)
```

These are tags written when the upstream opponent-stats source returns null but the renderer converts `null` to `0` and labels it as "STRONG D" because 0 is the strongest possible. This is exactly the bug task #54 supposedly fixed.

**Recommended fix**: re-do task #54 properly. The fabrication is happening downstream of where #54 patched it, OR #54's patch was reverted by a later commit. Trace + repair.

---

### Item 7 — MY BETS shows real placed bets

🔴 **RED**

**Hard data:**
- Total ledger entries: 50,000 (max cap — pollution from yesterday's stableId bug not pruned yet)
- `decisionType=placed` AND `stake >= 1`: **2 entries** (your real bets)
- `decisionType=placed` AND `stake < 1`: **3 test entries** (`sqlite_dualwrite_smoke`, `diag`, `cleanup_verify` at $0.01 each — from QA work)
- `decisionType=followed`: 49,995 entries (model imports — not bets you placed)

**Your real placed bets exist** but the FE MY BETS filter is grabbing the 3 test entries instead. The FE filter likely doesn't exclude `sportsbook IN ('smoke-test', 'diag', 'verify')`, OR the filter is `decisionType === 'placed'` without a stake threshold.

**Recommended fix**: two-line FE filter update — exclude test sportsbooks AND require stake >= 1.

---

### Item 8 — GRADES tab is real, understandable, shows the right books

🟡 **YELLOW** (incomplete probe — operator said "not paying attention yet")

**What I can confirm:** grading_summary_*.json files exist for May 24, 27, 30 only (the dates with actual NBA playoff games). Missing days where no games occurred is correct behavior. **But:** the same off-allowlist book leak applies to GRADES — the picks shown as historical are pulled from the same source so they will show Hard Rock / BetRivers entries.

**Recommended fix**: ship the Item 5 book filter properly and GRADES auto-cleans alongside.

---

### Item 9 — Grading actually runs and shows proof

🟢 **GREEN**

**Proof:**
- Scheduler.log today: `grading:backfill-all starting` + `grading:backfill-all OK` BOTH present.
- Brain doc MODEL_EVOLUTION_LOG records the Phase Autonomous-Orchestrator-1A first fire verified 04:00 ET 2026-06-01.
- Dampener corpus `family_calibration.json` rebuilt 20:01 ET tonight (proves grading wrote outcomes that fed the rebuild).

---

### Item 10 — Stamping (closing odds) actually runs and shows proof

🔴 **RED**

**Proof against:**
- NBA tracked_bets 2026-05-31: 731 bets, **0 with closingOdds (0%)**
- MLB tracked_bets 2026-05-31: 1,010 bets, **0 with closingOdds (0%)**
- Total yesterday: 1,741 bets, **0 stamped**

The CLV-Resilience-1A fix (widened capture window 30 min → 180 min) shipped this morning but yesterday's slate was already past. **Tonight's slate should test whether the fix actually works.** As of probe time, today's slate hasn't tipped yet so 0/0 is expected — verify tomorrow morning.

**Recommended fix**: tomorrow morning (June 2) re-probe yesterday's slate (June 1). If still 0 stamped, the fix didn't work and CLV is genuinely broken — escalate.

---

### Item 11 — CLV ticks every 5 min

🟢 **GREEN, but reactive**

**Proof:**
- `captureClosingLines.js` is wired (LaunchAgent / backend internal interval). Backend has been continuously up for ~30 min on the latest commit.
- Dampener corpus rebuilt 45 min ago — proves the downstream cascade works.

**But:** CLV ticking doesn't help if nothing gets stamped (Item 10). The tick fires; the capture window may not be matching against tipped games correctly.

---

### Item 12 — Autopilots actually fire

🟢 **GREEN**

**Hard data — every autopilot fired its expected count today:**

| Autopilot | Today fires (ET) |
|---|---|
| slate:mlb | 12 starting / 12 OK |
| slate:nba | 10 starting / 10 OK |
| sysAudit | 12 starting (hourly :00) |
| populateNbaInjuryReport | 12 starting / 12 OK |
| populateNbaGameLogs | 11 starting / 11 OK |
| populateMlbBatterStats | 1 OK (3:05 ET) |
| populateMlbBatterGameLogs | 1 OK (3:10 ET) |
| populateMlbPitcherGameLogs | 1 OK (3:15 ET) |
| deriveNbaDvP | 1 OK (3:20 ET) |
| populateNbaTeamStats | 1 OK (3:25 ET) |
| grading:backfill-all | 1 OK (4:00 ET) |
| audit:nightly | 1 OK (5:00 ET) |

Total 176 scheduled events fired and completed today. No FAILED entries.

---

### Item 13 — Auditing catches what it claims to catch

🟢 **GREEN**

**Proof:** drift_alerts.log has 20 entries — every hourly sysAudit fire from 16:00-20:00 ET tonight correctly logged the `points_assists` overconfidence RED. The audit IS catching the calibration drift it's designed to catch. The auto-recovery wire would fire if the RED were ECONNREFUSED (it's not — backend is healthy).

---

### Item 14 — What layers aren't being pulled for all prop types

🔴 **RED — confirmed wiring gaps**

**Today's NBA tracked_best field-presence scan (331 entries):**

| Field | Population | Status |
|---|---|---|
| oppDef | **0/331 (0%)** | ✗ COMPLETELY MISSING — should be NBA opp defense vs position |
| gameContext | 0/331 (0%) | ✗ MISSING (auto-fetch shipped but no NBA Finals today; will populate June 3) |
| isHome | 0/331 (0%) | ✗ MISSING (lifted-field bug — was supposed to derive from team comparison, not homeAwaySplit.isHome which doesn't exist) |
| elimination / game7 | 0/331 (0%) | ✗ MISSING (cascade from gameContext gap) |
| restContext | 215/331 (65%) | ⚠ partial — 35% of entries don't have rest data (probably bench/depth players not in cache) |
| homeAwaySplit | 167/331 (50%) | ⚠ partial — 50% have historical splits |
| pace, shots, astRate, rebRate | 299/331 (90%) | ⚠ partial — 10% missing (likely cache misses) |
| recentForm, displayBundle | 299/331 (90%) | ⚠ same |

**oppDef = 0% is the biggest finding.** The defense-vs-position signal is one of the model's key inputs. It's been in the persistence whitelist for weeks but the upstream populator either isn't writing it to rows OR the field name diverged.

**Recommended fix**: probe `play.oppDef` source in `buildNbaBestBetsBoard.js` and find why it's null even when picks have full opponent context.

---

### Item 15 — What code is alive but not hitting / not helping

🟡 **YELLOW** (partial — needs a real dead-code sweep)

**Known dormant code from the discovery audit yesterday:**
- Owner-B NBA enrichment (api-sports) — marked `@orphan`, retired per Phase Discovery-Audit-Cleanup-1A
- Some NBA slip engines confirmed dead — deleted
- `backend/ml/` doctrine conflict — operator decision pending

**Known dormant code from THIS audit:**
- Status dashboard ANALYZE backend (built, classifier always returns 'unknown' for 5/5 ingested slips — Tier 2 degradation per task #5)
- bettor_profiles + outcome_links tables — schema exists, 0 rows in production (loop never closed — tasks #2 + #3)
- `nbaSeriesState.json` hand-curated file is stale and the auto-fetched file is empty for today

**Recommended fix**: schedule a full dead-code sweep when calmer time available. For now the high-impact items are the loop-close work (tasks #2-5).

---

### Item 16 — STATUS TAB inside the PWA (new requirement)

🟡 **YELLOW — needs scope discussion before any build**

**Operator's stated requirement (verbatim from session log):**
> "on the backend instead of having /status id like a set tab instead on the repo. that updates however it still should and does the autonomy, what is needed from me and when, everything. literally everything should be seen in the status tab that if ai disappeared tomorrow id be able to read it and know exactly what was going on in my repo. we dont need it to be perfect in one walk through, but we do need to expand and not stop until i agree its perfect."

**What this WANTS to be:**
- A 5th tab in the PWA alongside TOP PICKS / MY BETS / GAMES / ANALYZE / GRADES
- All the data currently on `edge.motel666.com/status` but rendered inside the PWA shell
- Plus operator-required actions surfaced ("you need to caffeinate before tonight's slate", "you have a placed bet pending live tracking", "this pick is being dampened because corpus has X gap")
- Living, iterative — expand until perfect

**What I need from operator before building:**
- Should this REPLACE `/status` or live ALONGSIDE? (recommend: keep both — the standalone /status survives PWA cache problems, the tab is convenience)
- Priority order for sections inside the tab (system health first? today's autopilot status first? something else?)
- "What does the operator need to DO" callouts — should these be just informational or actionable (e.g. tap-to-restart-backend buttons)?

**Recommended fix**: small scope-out conversation, then ship Layer 1 (the JSON endpoint already exists at /api/ws/status — just need a TAB renderer that pulls from it). Layer 2+ iterate based on operator review.

---

## Recommended fix order (my proposal — your call to confirm or rearrange)

| Priority | Item | Fix size | Why first |
|---|---|---|---|
| 1 | #5 Books filter | small | 22-75% of picks shown are from books you don't bet on; biggest visible noise |
| 2 | #6 Null-as-zero fabrications | small | 41 lies on cards including "SAS 0 ppg"; trust killer |
| 3 | #7 MY BETS filter | tiny | 2-line FE filter; your real bets surface immediately |
| 4 | #4 Bettor language | medium | One FE translator pass; affects every card |
| 5 | #14 oppDef wiring | small-medium | Restore key projection input that's 0% populated |
| 6 | #16 Status tab in PWA | medium | New surface; iterate scope first |
| 7 | #10 CLV stamping (verify tomorrow) | unknown | Need tomorrow's data to know if today's fix held |
| 8 | #14 Lifted flat fields (isHome/elimination/game7) | small | Cosmetic until gameContext data flows; matters for Finals |
| 9+ | Loop-close work (#2/#3/#4/#5 from earlier task batch) | large | Screenshot intelligence learning loop |

**1-4 are quick fixes that close the trust gap on what you see daily.** 5-8 are mid-size wires. 9+ is the bigger system intent work.

---

## What I'm NOT claiming

- I have not verified `captureClosingLines.js` actually runs successfully — only that the backend hosts it.
- I have not verified MLB tracked_best families beyond the book distribution.
- I have not graded any picks myself — relying on the engine's `result` field where present.
- The Status Tab scope is operator-direction-pending; my proposal is one shape but not the only one.
- This audit is point-in-time (20:45 ET 2026-06-01). Anything that changes after this — including tonight's slate firing — needs re-verification.

---

## Verifiable proof artifacts

All numbers in this doc came from probes against actual data files. Probe scripts saved to `.scratch/truth_audit_probe.js` and `.scratch/truth_audit_probe2.js` — re-run any time to verify findings or check for drift.

The audit doc itself lives at `OPERATOR_TRUTH_AUDIT.md` (this file, repo root). Committed to git → survives compaction. Re-run the audit by re-running the probes; refresh this doc to update verdicts.
