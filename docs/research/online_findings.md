# Online Findings — Claude-C research log

Append-only. Each block is one verified research pass for CA.

## 2026-06-22 19:40 ET — Claude-C [research] — MLB game-date/timezone: use officialDate, never truncate UTC gameDate

- QUESTION: The canonical, verified way to map an MLB game to the calendar date its result counts for — fixing our recurring "always a day ahead" bug where results get fetched for the wrong day.

- SOURCES:
  - https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2024-10-05 — PRIMARY (live MLB Stats API). Real response shows the trap directly: Padres @ Dodgers NLDS G1 (gamePk 775323) has gameDate "2024-10-06T00:38:00Z" but officialDate "2024-10-05". The three earlier games that night (gameDate 17:08Z / 20:08Z / 22:38Z) sit on 2024-10-05 in both fields; only the late game crosses midnight UTC and diverges.
  - https://github.com/toddrob99/MLB-StatsAPI/wiki/Function:-schedule — AUTHORITATIVE (most-used Python wrapper, ~777 stars). Verbatim field note: `game_datetime` = "date and timestamp in UTC (be careful if you truncate the time--the date may be the next day for a late game)"; `game_date` = "date of game (YYYY-MM-DD)". The wrapper exposes a separate YYYY-MM-DD date precisely so callers do not truncate the UTC stamp.
  - https://billpetti.github.io/baseballr/reference/mlb_game_pks.html — AUTHORITATIVE (baseballr / SportsDataverse, R). Verbatim column dictionary: `gameDate` = "Game date-time (ISO 8601, UTC)"; `officialDate` = "Official game date (YYYY-MM-DD)".
  - https://sportsdata.io/developers/api-documentation/mlb — SECONDARY (third-party mirror docs). Corroborates that a suspended game keeps its original game record on resume (no new game id), so the official date stays sticky rather than being recomputed from the resume time.

- VERIFIED TAKEAWAY (cross-referenced: live API + two independent libraries agree):
  Every MLB Stats API game carries TWO date fields. `gameDate` is a full UTC/Zulu ISO-8601 timestamp; `officialDate` is the YYYY-MM-DD calendar date the game officially counts for. The "day ahead" bug comes from deriving the date off `gameDate` (e.g. `toISOString().slice(0,10)` or any `getUTC*` truncation): for any first pitch around 8pm ET or later the UTC stamp has already rolled to tomorrow (8:38pm ET = 00:38Z), so truncation returns the next day. This hits a large share of night games every slate, not a rare edge case. Canonical fix: read the API's `officialDate` field as the result-date. It is correct for late games by construction and is the field both major community libraries standardize on. `officialDate` also beats rolling your own UTC-to-local conversion because it is MLB-assigned and stays stable across suspended/resumed games and doubleheaders, where a DIY conversion of the start timestamp would mis-date. Confidence: HIGH on the core rule (three independent sources including primary API data); MEDIUM on the suspended-game specifics (one secondary doc, consistent with primary behavior, not re-verified against a live suspended record). Venue-local vs ET: `officialDate` follows MLB's official (venue/scheduled-local) date; for virtually all games this equals the ET calendar date and it should not be recomputed.

- APPLY TO REPO (hand to CB):
  1. Make `officialDate` the single source of truth for an MLB game's result-date everywhere results are fetched, graded, or joined to predictions. Where the results/grading path derives a date from a UTC timestamp, switch the key to the upstream `officialDate` field.
  2. Audit for the bug pattern in the MLB results/grading path: grep for `toISOString().slice`, `.slice(0,10)` on a date value, and `getUTCDate` / `getUTCFullYear` / `getUTCMonth` applied to a gameDate. The slate-date doctrine already bans `toISOString().slice` via slateDate.js — confirm the MLB grading join actually routes through that authority and is not truncating a UTC gameDate upstream of it.
  3. Keep two date concepts distinct and documented: `officialDate` = the game's official result date (use for "did this prop/game hit on day D"); slateDate.js ET-day-with-4am-boundary = which betting slate a game is bucketed into. Do not cross-wire them.
  4. Verification probe (non-zero output, per Law 13): on a slate with a late West-Coast game, assert that the UTC-truncated gameDate does not equal officialDate for that game, and that the graded result lands on officialDate. Ready-made fixture from the primary source above: 2024-10-05 schedule, gamePk 775323 — officialDate 2024-10-05 vs UTC-truncated 2024-10-06.

## 2026-06-22 20:39 ET — Claude-C [research] — RECONCILE: officialDate is the #3-guard basis, NOT our bug (CA/CB verdict) + 2026 example

- QUESTION (reconciliation pass, after read-first): Does the officialDate finding (54f1989) survive CB's repo audit (ed372ff) + CA's decision (this log, 2026-06-22 19:50 ET)? Plus a current-season (2026) demonstration.

- WHAT READ-FIRST FOUND (current repo truth, not memory):
  - My first block committed to the WRONG path (`backend/docs/research/online_findings.md`); moved to repo-root `docs/research/online_findings.md` in this commit (operator Rule 1).
  - VERDICT (CB audit `docs/audits/2026-06-22-game-date-bug-class/AUDIT.md` + CA decision): the officialDate principle is correct but is NOT our active bug. The grading path already derives each game's date from the bet's real `gameTime` (odds-API `commence_time`) via `gameDatesForSlate` -> `calendarDateForTimestamp` (slateDate.js:124, canonical); it does not truncate a UTC stamp. The "day-ahead" symptom is a slate-LABEL-vs-game-DATE semantic (slate file named by pick-generation date; games are slate+1) -> fixed by decision (A): make grading/readiness game-date-driven. My finding is kept as the basis for the #3 recurrence guard, not as the fix.

- CURRENT-SEASON SOURCE (2026, live MLB Stats API, fetched 2026-06-22):
  - https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-06-20 -- five games carry UTC `gameDate` 2026-06-21 with `officialDate` 2026-06-20: gamePk 824342 Pirates@Rockies (2026-06-21T01:10:00Z), 824988 Angels@Athletics (02:05:00Z), 823937 Orioles@Dodgers (02:10:00Z), 823126 RedSox@Mariners (02:10:00Z), 825068 Twins@Diamondbacks (02:10:00Z). Truncating the UTC stamp mis-dates all five to 06-21; `officialDate` keeps them on 06-20.
  - https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-06-21 -- latest game 2026-06-21T23:20:00Z (Mets@Phillies); NO post-midnight-UTC game, so NO divergence. The anti-pattern is slate-dependent (only slates with late West-Coast/Mountain games).
  - [DELIBERATELY HISTORICAL regression fixture] 2024-10-05 gamePk 775323 (Padres@Dodgers): gameDate 2024-10-06T00:38:00Z vs officialDate 2024-10-05 -- a stable unit-test case, chosen for stability, NOT as a current example.
  - Library corroboration (unchanged): toddrob99 MLB-StatsAPI wiki + baseballr both standardize on `officialDate` and warn that truncating the UTC stamp lands a late game on the next day.

- VERIFIED TAKEAWAY: Principle confirmed and adopted -- as the #3 recurrence-GUARD basis, not a bug fix. NUANCE that matters: our dates come from odds-API `commence_time`, so `officialDate` (an MLB Stats API field) is not in our current path; the guard should target the ANTI-PATTERN (deriving YYYY-MM-DD via raw `toISOString().slice(0,10)`, `setDate(+1)`, or `getUTC*` on a timestamp) and require routing through slateDate.js -- exactly CA's #3 spec. `officialDate` is the right field only IF we ever date a game off the MLB Stats API directly. Honest correction: my first block framed officialDate as "the fix for our day-ahead bug" -- that framing was WRONG; the repo audit was right (CB-audit > CC-web). The principle stands; the diagnosis did not.

- APPLY TO REPO (aligned to the decided direction):
  1. #3 recurrence guard (CA-approved): runtime:verify should FAIL on any grading/ingest date-path deriving a calendar date via `toISOString().slice(0,10)`, `setDate(+1)`/`setDate(-1)`, or `getUTCFullYear`/`getUTCMonth`/`getUTCDate` on a game timestamp instead of slateDate.js. Allowlist pure display formatters. Unit fixture: 2024-10-05 gamePk 775323 (UTC-truncate -> 2024-10-06 WRONG vs officialDate 2024-10-05).
  2. No change to `gameDatesForSlate` or the fetch (audit-confirmed correct). officialDate not needed in the current path.
  3. OFFER: CC can enumerate the full JS date-from-timestamp anti-pattern set for the guard net (`new Date('YYYY-MM-DD')` UTC-parse, `Date.parse`, `toLocaleDateString` without timeZone, etc.) -- operator say the word.

## 2026-06-22 21:15 ET — Claude-C [research] — FULL JS date-from-timestamp anti-pattern net for the #3 guard (verifyGameDateDiscipline)

- QUESTION: The COMPLETE set of JavaScript ways a YYYY-MM-DD can be silently mis-derived from a timestamp, each with its exact failure mode, so the #3 guard (verifyGameDateDiscipline.js) FAILS on ALL of them -- not just the few it currently nets. (Read-first this pass: the guard already shipped in a319e49 using the CC 775323 fixture; this is a coverage-gap pass, not a new build.)

- SOURCES:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse -- PRIMARY (MDN). Verbatim: a date-only string like "2019-01-01" "will imply UTC time because it's date-only"; a date-time string with no offset "will be set to ... at 00:00:00 in the local timezone of the system, because it has both date and time"; other formats are "implementation-defined and may not work across all browsers."
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleDateString -- PRIMARY (MDN). Verbatim: returns the date "in the local timezone"; with no timeZone option the default is the runtime's default time zone; output "varies according to local timezone"; "You should not compare the results of toLocaleDateString() to hardcoded constants."
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString -- PRIMARY (MDN). toISOString() always returns the simplified-ISO string in UTC (Z suffix); toJSON() delegates to it.
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat -- PRIMARY (MDN). The canonical fix: pass an explicit timeZone; the en-CA locale yields YYYY-MM-DD ordering.

- VERIFIED TAKEAWAY -- the full anti-pattern net (instant -> intended ET / officialDate calendar day). DIRECTION: AHEAD = a late ET game (first pitch ~8pm ET or later in EDT; ~7pm in EST) has a UTC stamp already on tomorrow; BEHIND = a correct YYYY-MM-DD re-parsed as UTC midnight reads as yesterday in ET. Tags: [caught] / [GAP] = vs the CURRENT verifyGameDateDiscipline FORBIDDEN regex `toISOString().slice(0 | getUTCDate( | getUTCFullYear( | getUTCMonth(`.

  UTC-truncation family (lands AHEAD for late ET games):
  1. d.toISOString().slice(0,10) -- toISOString is always UTC(Z) -> UTC date. [caught]
  2. d.toISOString().split('T')[0] -- same, split form. [GAP -- regex matches only ".slice(0"]
  3. d.toISOString().substring(0,10) / .substr(0,10) -- same, substring/substr form. [GAP]
  4. d.toJSON().slice(0,10) -- toJSON() === toISOString() -> UTC. [GAP -- toJSON not matched]
  5. `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}` -- explicit UTC parts (and getUTCMonth is 0-indexed = a second off-by-one if +1 is forgotten). [caught -- the 3 getUTC* getters]
  6. Math.floor(d.getTime()/86400000) (or Date.now()/86400000) day-bucketing -- whole UTC days from epoch -> a late ET game buckets into the next day. [GAP]

  Runtime-local family (lands AHEAD on a UTC/container host; silently host-dependent):
  7. d.toLocaleDateString() / d.toLocaleString() with no { timeZone } -- formats in the runtime tz; on a UTC server == UTC -> AHEAD; also locale-dependent, not stable YYYY-MM-DD. [GAP]
  8. new Intl.DateTimeFormat(locale, opts).format(d) with no timeZone in opts -- same runtime-tz dependence. [GAP]
  9. bare local d.getFullYear()/getMonth()/getDate() assembled into a date key -- reads the runtime tz; on a UTC host == getUTC* -> AHEAD; "correct" only if the process TZ happens to be ET (an undocumented, fragile dependency). [GAP -- regex bans only the getUTC* variants]

  Date-only-string-parsed-as-UTC family (lands BEHIND in ET -- the round-trip trap):
  10. new Date('2026-06-20') then any local getter/format -- date-only string parsed as UTC midnight; read in ET (UTC-4/-5) -> 2026-06-19. [GAP]
  11. Date.parse('2026-06-20') then local read -- same UTC parse (MDN). [GAP]

  Datetime-without-offset / non-ISO family (wrong INSTANT -> possible day flip; cross-engine divergence):
  12. new Date('2026-06-20T19:05:00') / Date.parse(no Z or offset) -- parsed as LOCAL time per spec; an ET-intended wall time is mis-anchored on a UTC host -> wrong instant, can flip the day; browsers historically diverged here. [GAP]
  13. new Date('6/20/2026') or other non-ISO strings into Date()/Date.parse -- implementation-defined, defaults to local, cross-engine-divergent (MDN). [GAP]

  Manual day-arithmetic family (over/under-correction; DST drift):
  14. d.setDate(d.getDate() +/- 1) / any setDate(+/-n) "shift a day" -- usually a band-aid compensating for an (A)-type UTC bug; then breaks the non-late games, double-corrects, and is DST-fragile (local-field math). CA explicitly named this. [GAP -- setDate is NOT in the regex]
  15. d.setHours(0,0,0,0) "to midnight" then slice -- sets LOCAL midnight, then still UTC-truncates on output. [GAP, minor]

  CANONICAL (what the guard should REQUIRE instead): slateDate.js calendarDateForTimestamp / slateDateForTimestamp (ET-explicit -- the guard's own behavioral test proves it maps 00:38Z -> 2024-10-05), or the upstream officialDate field. Robust vanilla equivalent: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) -> 'YYYY-MM-DD'.

  Confidence: HIGH -- all spec-level, MDN-documented (primary), stable behaviors.

- APPLY TO REPO (hand to CB -- extend verifyGameDateDiscipline.js, a319e49):
  1. The FORBIDDEN regex currently nets only #1 and #5. Extend the net to also flag: `.split('T')[0]` / `.substring(0,10)` / `.substr(0,10)` / `toJSON()` truncations (#2-4); `getTime()` or `Date.now()` divided by 86400000 (#6); `toLocaleDateString` / `toLocaleString` / `Intl.DateTimeFormat` with NO `timeZone:` key (#7-8); bare local `getFullYear`/`getMonth`/`getDate` building a key (#9); `new Date(<string>)` and `Date.parse(` in a date-key path (#10-13); `setDate(` / `setUTCDate(` shifts (#14). setDate was named in CA's #3 but is NOT in the regex yet -- the most important single add.
  2. WIDEN scope: the static scan covers only 3 grading files. CA's #3 = "any grading/INGEST date-path." Add the ingest date-path files CB's own audit named -- saveTrackedSlateSnapshot.js, refreshMlbWeatherForSlate, refreshMlbBullpenWorkload, buildMlbWeather, fetchMlbOfficialLineupsSnapshot (+ the NBA equivalents).
  3. AVOID false positives (important, honest caveat): toLocaleDateString / new Date(str) / local getters are LEGITIMATE in pure display formatters and in pure YYYY-MM-DD calendar arithmetic. A blocklist-only regex WILL over-match. Keep the existing `date-arith-ok` allowlist tag, add a `display-ok` tag for FE/format-only lines, and prefer the guard's existing POSITIVE check (assert the result-date function calls calendarDateForTimestamp, as it already does for gameDatesForSlate) over pure blocklisting where feasible.
  4. ADD a BEHIND case to the static scan: flag `new Date(<string literal/var>)` and `Date.parse(` in date-key paths (#10-13); document it with the fixture new Date('2026-06-20').getDate() === 19 in ET (the round-trip trap), since the existing 775323 fixture only proves the AHEAD direction.

## 2026-06-23 02:49 ET — Claude-C [audit] — PART 1: repo-wide read-only audit by failure class (ranked; for CA triage)

READ-ONLY. No code touched. Evidence tags: [CC-VERIFIED] = CC read the file:line or reproduced the probe this session; [AGENT-SWEEP] = found by a read-only sub-agent with file:line cited, CC spot-check pending (CA: confirm before CB acts). Ranked by severity then blast radius.

=== HIGH ===

H1 [CC-VERIFIED] DATA-INTEGRITY -- starved id-join -> ~90% NULL model_prob; MLB calibration effectively dead.
- intelligence.js:884-887,924 -- recordOutcome runs `SELECT * FROM prediction_snapshots WHERE id = ?`; on a miss `pred` is null -> `modelP = safeNum(pred?.model_prob)` is null -> writes NULL model_prob into outcome_snapshots.
- Live consumer calibrationDampener.js:228-242 joins `FROM outcome_snapshots os JOIN prediction_snapshots ps ON ps.id = os.id WHERE os.hit IS NOT NULL`; comment :217-227 says the book-agnostic column-join "would yield MLB n=57 vs 0 today" is BUILT but deliberately NOT live (needs a line dimension first).
- CC PROBE (Python sqlite3 3.37.2, read-only immutable, backend/storage/betting.db): outcome_snapshots=26,125; model_prob NOT NULL=2,524 (9.66%); prediction_snapshots=9,576; join overlap (o.id=p.id)=2,524 (== the non-null count, i.e. every populated model_prob is a joined row); by sport MLB 21,122 rows / 447 with model_prob (2.1%), NBA 5,003 / 2,077 (41.5%); last 200 MLB outcomes = 0 with model_prob.
- CORRECTS the brief: the corpus is NOT empty and not "0.1%" -- it is a join miss -> ~90% null (MLB ~98% null). IMPACT: calibrationDampener (the documented sole runtime probability-calibration authority) runs MLB on ~447 historical rows and ~0 fresh, so MLB calibration is effectively a no-op -- any "calibrated probability" shown for MLB is barely corrected.
- FIX (CA->CB): land the line-aware book-agnostic column join already built at calibrationDampener.js:217-227 so MLB outcomes rejoin; OR fix recordOutcome predId <-> prediction_snapshots.id matching so model_prob populates at settle. Add runtime:verify: FAIL if a graded slate's outcome rows carry <X% model_prob.

H2 [CC-VERIFIED] FAKE-GREEN -- grading reports PASS / exits 0 even when a PAST slate grades zero.
- runHistoricalGrade.js:289-293 logs "RED: games ... are PAST but 0 results fetched" but :336 `return { success: true }` unconditionally -> main `process.exit(anyFailure ? 1 : 0)` exits 0.
- runGradingBackfillAll.js:243-256 `r.settled === 0 -> "SKIP (no settled bets)"`, :253 `continue` (not counted failed), :297 `RESULT: ${tally.failed === 0 ? "PASS" : "FAIL"}`, :338 `process.exit(tally.failed === 0 ? 0 : 1)`. This is the canonical 4 AM grading autopilot (autopilots/grading-nightly.sh). A slate that never settled (settlement:run failed / API outage) -> 0 settled -> SKIP -> PASS -> exit 0.
- IMPACT: the operator's nightly logs / autopilots can read grading "OK" while a played slate silently failed to grade. [AGENT-SWEEP] statusRoute openIssues has a clv_capture source but NO grading-completion source (statusRoute.js:1306) -> this never reaches a /status dot.
- FIX: a PAST-games-0-results / 0-settled-on-a-played-slate must be FAIL (exit 1): runHistoricalGrade should return success:false on the gamesPast RED branch; runGradingBackfillAll should FAIL (not SKIP) a date whose game-dates are PAST with 0 settled. Add a /status openIssues "grading_complete" source.

H3 [CC-VERIFIED] FAUX -- MLB-live displayed confidenceScore defaults to 0.5 (and `||` turns a real 0 into 0.5).
- buildMlbInspectionBoard.js:1498 `const confidenceScore = clamp(Number(top?.surfaceScore || top?.homeRunPathScore || 0.5), 0, 1)` -> feeds playerConvictionScore (:1510, weight 0.52), shown as the per-conviction confidence on the MLB inspection board the operator reads.
- :1571 same on parlay-ticket legs: `... : Number(leg?.surfaceScore || 0.5)`.
- IMPACT: a conviction/leg with no real surface/HR-path score is shown a synthetic 0.5 confidence (fabricated bettor-visible number), and a genuine score of exactly 0 is masked as 0.5 by `||` (violates the repo's own probabilityHonesty null-preservation doctrine).
- FIX: when both score fields are absent, surface null/"unrated", not 0.5; use a finite check + `??` so a true 0 survives.

=== MED ===

M1 [CC-VERIFIED] DEAD/BROKEN-as-live + parallel authority -- populator-chain LaunchAgent runs 5 npm scripts that do not exist; nightly populators fail every run.
- populator-chain.sh:33-40 `npm run derive:nba-dvp` / `npm run populate:nba-team-stats` / populate:mlb-batter-stats / populate:mlb-batter-game-logs / populate:mlb-pitcher-game-logs. CC grep: NONE of the 5 targets exist in backend/package.json (the only package.json) -> each step exits 1. Installed 3:05 AM via com.motel666.populator-chain.plist (install-autopilots.sh:11). The same populators run correctly via `node scripts/populate*.js` from scheduler.sh:329-351 -- so this is a broken PARALLEL owner; if the operator relies on the LaunchAgent (not the single-terminal scheduler), the caches never refresh and stale signals feed scoring.
- FIX: point populator-chain.sh at the real `node scripts/populate*.js` (match scheduler.sh) OR retire the LaunchAgent and keep scheduler.sh as sole populator owner (Law 1).

M2 [AGENT-SWEEP] FAKE-GREEN -- 5 AM audit:nightly ignores the grading exit code and sets no exit code of its own.
- auditNightly.js:134-146 runGrading() status only printed; main() ends ~:456 with no process.exit; the anomaly grading-lag check (:402) needs total>50 AND settled/total<0.10 across a 7-day window (one 0-graded day is diluted). CA: confirm.

M3 [AGENT-SWEEP] SILENT-FAILURE -- results fetchers return EMPTY on API failure, indistinguishable from "no games".
- fetchMlbGameResults.js:141-143 `catch { console.error(...); return resultMap }` (empty Map); fetchNbaGameResults.js:117-123 `return []` on catch. Feeds H2: a transient 500/timeout looks like an off-day, bets stay pending, grading greens. CA: confirm.

M4 [AGENT-SWEEP] FAUX -- archetype TIER legitimacy defaults to 0.5 -> bettor-visible tier label + stake weight.
- archetypeWeighting.js:127-129 `const propL = propLegit ?? 0.5 ... (consensusConfidence ?? 0.5) * 0.1` -> archetype tier (superstar/proven/role-player/bench). A no-data prop lands mid-tier rather than withheld. CA: confirm intent (may be deliberate base weight).

M5 [AGENT-SWEEP] FAUX (legacy/NBA path) -- estimateLegTrueProbability defaults model prob 0.5 -> trueProb/edge/EV.
- server.js:16450 `let prob = hitRate || 0.5` (surfaced server.js:18631 trueProb, :18584 EV on /picks/today); workstationRoutes.js:2245 parlay-preview leg `... : 0.5` -> combined edge/ev/payout (server.js:2249-2251). Agent notes the live MLB mobile FE does not consume trueProb (NBA/legacy path; NBA paused) -> capped MED; PROMOTE to HIGH if /picks/today is still served to any client. CA: confirm reachability.

M6 [AGENT-SWEEP] DEAD-as-live -- /api/bets + /api/bets/metrics serve a ~2-month-stale parallel JSON store; its write path is dead.
- server.js:19773 (/api/bets) + :19782 (/api/bets/metrics) read tracker/betStorage.json; betTracker.js write fns saveBets/logBet/settleBet (:44/:68/:82) have no live caller (server.js:97 imports logBet, unused) -> betStorage.json stale since ~Apr 23. Canonical ledger = personal_ledger.json; PIPELINE_AUTHORITY_MAP.md:86 already tags betStorage a "PARALLEL ... consolidation target". CA: confirm endpoint consumers.

M7 [AGENT-SWEEP] DEAD imports -- 6 board-builders required in server.js, zero call sites: buildMlbOomphEngine (server.js:68), buildMlbBetSelector (:66), buildBestSpecials (:35), buildFirstBasketBoard (:36), buildSpecialtyOutputs (:38), buildCuratedLayer2Buckets (:37). Dead weight that looks wired via require; agent checked no spawnSync/require(var) dispatch. CA: confirm before any delete (server.js is a half-extracted monolith).

M8 [AGENT-SWEEP] SILENT-FAILURE -- settlement:run failure is logged but the chain continues to 4 AM grading with no /status alert.
- scheduler.sh:447-452 `else log "settlement:run FAILED ... grading will skip them"`, loop proceeds; combined with H2 a settlement failure silently stalls the corpus. (Also: `$?` is captured after `log` ran, so it may not be settlement's real exit.) CA: confirm.

=== LOW ===

L1 [CC-VERIFIED] PARALLEL DRIVER + swallow -- runGradingBackfillAll.js:317-336 uses better-sqlite3 (`new Database(dbPath,{readonly:false})`) while the canonical driver is node:sqlite (db.js, Law 5). The inline outcomeLinks block swallows failure (:333-336 "do not fail the whole grading job") and the comment (:306-315) records outcome_links "stayed at 0 rows" historically. CA: confirm outcome_links is now populated; reconcile the driver.

L2 [AGENT-SWEEP] sysAudit.js:382-383 -- the "CLV LOOP DEAD" canary is suppressed under 50 tipped picks and section 7 has no grading-completion (0-of-N) check, so a small or fully-failed slate raises nothing.

L3 [AGENT-SWEEP] TIER-AUTHORITY overlap -- ELITE/STRONG vocabulary computed in 2+ places (buildMlbHrPredictionCandidates.js:678 tag + buildMlbPropClusters tierForPlay) vs PIPELINE_AUTHORITY_MAP.md:198 "sole MLB badge authority". Different label sets, overlapping words -> Law-1 collision risk. Reconcile or document.

L4 [AGENT-SWEEP] 10 zero-reference one-shot scripts in backend/scripts/ (backfillCloseMirror.js, restoreLostPlacedBets.js, game7Ladders.js, scanGame7.js, traceCandidates.js, traceDdTdPipeline.js, traceWilliamsThrees.js, nbaPipelineHardAudit.js, nbaPipelineSelfCheck.js, + .scratch/dryrun_mean_median.js) -- dev tooling, expected-unreferenced, not presented as live; dead weight only.

L5 [AGENT-SWEEP] NAMING COLLISION -- buildMlbCorrelationEngine.js (LIVE heuristic, consumed by buildSlipAi.js:119 etc.) vs the sanctioned shadow mlbCorrelationEngine.js (copula, kill-switched). Confusingly similar basenames one dir apart -> edit-the-wrong-file trap. Add a one-line authority-map entry.

=== NOT-FINDINGS (brief premises corrected / sanctioned-by-design) ===
- lineupSpot / battingOrder 0% = RESOLVED 2026-06-01 (free statsapi.mlb.com fallback wired, fetchMlbStatsApiLineups.js; merge fetchMlbApiSportsScaffold.js:742-759). Live now ~34-38% (64/189, 90/234, 49/179 on 06-22/21/20) -- partial BY DESIGN (anti-fabrication omits unconfirmed orders). Self-healing wiring check statusRoute.js:1025-1042. NOT a current hollow feed.
- bullpen / air-density / pitcher-FIP / Statcast staging JSONs (the untracked backend/data/*.json + *.meta.json now in the working tree) = additive staging, ZERO live consumer BY DESIGN (sanctioned shadow stack, freeze-safe). grep across pipeline/ found no consumer. NOT treated as live.
- nba_tracked_best gameContext 0% on disk = real but SELF-FLAGGED WARN (#71 wiring gap, sysAudit.js:252) -- surfaced, not silently trusted.
- /status route itself is generally robust vs fake-greens: every section try-wraps to {ok:false,error}; componentHealthCheck GREEN only if `node <file>` exits 0 this cycle (:44-49); launch-agent health traces real PIDs/exit codes. The real gap is the MISSING grading-completion source (H2), not rendering.

=== META (process integrity -- for CA) ===
- node:sqlite in this sandbox CANNOT open the live betting.db: both readOnly and default-open, original and a fresh copy, return "file is not a database" (DB last written by SQLite 3.51.2; the magic header is valid "SQLite format 3"; Node's bundled SQLite rejects it). The H1 counts were reproduced ONLY via Python sqlite3 (3.37.2) `file:...?mode=ro&immutable=1`. An audit sub-agent had reported these same counts as a node:sqlite probe -- that path does not work here, so the numbers were treated as UNVERIFIED until CC independently reproduced them (now reproduced, HIGH). Operational rule for future CC/CB DB probes in-sandbox: use Python sqlite3 (or the app's own driver on the host), NOT bare node:sqlite; and never pass a sub-agent "probe number" to the operator without an independent reproduction.

PART 2 (online bettor-edge deep dive) lands next, separate commit.
