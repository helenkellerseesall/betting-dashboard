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
