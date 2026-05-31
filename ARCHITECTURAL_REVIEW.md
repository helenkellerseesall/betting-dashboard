# Architectural Review — 2026-05-31

Operator asked: "do we still use json? is sql better? do we use sql now? like what can be even better? faster? smarter?" This document answers honestly with trade-offs, not hand-waving.

## Question 1: JSON files vs SQLite for persistent data

### Where we are today

| File | Size | Read pattern | Write pattern |
|---|---|---|---|
| `personal_ledger.json` | **67MB** (50,002 entries) | Loaded entire file on every read | Rewritten entire file on every write |
| `tracked_bets_YYYY-MM-DD.json` | 2-3MB per day | Loaded per request in `/top-picks` | Rewritten per slate run |
| `tracked_best_YYYY-MM-DD.json` | 1-2MB per day | Loaded per request in reasoning hydration | Rewritten per slate run |
| `mlbBatterGameLogs.json` | 2.6MB | Loaded by populator | Rewritten daily |
| `family_calibration.json` | <50KB | Loaded by dampener (5min cache) | Rewritten hourly by audit |
| `lessons.json` | <50KB | Loaded by traceMyBets | Append on settle |

### Problems with JSON-on-disk

1. **Full file rewrite on every mutation.** Adding 1 bet to a 50k-bet ledger rewrites 67MB. Risk: corruption mid-write if process crashes (we saw two placed bets vanish from a sweep — JSON had no transactional safety to prevent it).
2. **O(n) lookups.** Finding "did we already have bet ID X?" is a full scan. addOrUpdateBet does this on every write — increasingly painful as ledger grows.
3. **No concurrent-write safety.** If the orchestrator settles bets while addPlacedBet writes a new bet, last-writer-wins clobbers one of them silently. We have not hit this yet because writes are infrequent, but it's a lurking time bomb.
4. **No range queries.** Want "all NBA picks for week of 5-25 to 5-31"? You read all 7 tracked_bets files and union. SQLite would be `WHERE sport='nba' AND date BETWEEN '2026-05-25' AND '2026-05-31'`, indexed.
5. **No constraints.** Nothing enforces that every tracked_bets row has `modelProb` numeric. Bad rows silently leak; we catch them downstream. SQLite columns would reject them at write.

### Why SQLite specifically

Not Postgres / Mongo / a server. **SQLite is a single file**, just like JSON, but with:
- Transactional safety (write fails atomically — no half-written state)
- Indexed lookups (microseconds vs milliseconds)
- Range queries (date BETWEEN, family IN, ...)
- Column constraints (NOT NULL, type checks)
- Concurrent reads safe by default; one writer at a time with WAL mode
- Already used by `intelligence.db` in this repo (today 0 bytes, but the dependency is installed)
- Zero ops cost: still backed up as a single file, still no daemon, still works offline

### Honest cons of migrating

- Every read site has to be updated (loadLedger → db.prepare/all). Big diff: ~30 call sites.
- Ad-hoc inspection harder: today you can `cat personal_ledger.json | jq '.bets | length'`. With SQLite you need `sqlite3 ledger.db 'select count(*) from bets'` — still trivial but new muscle memory.
- Migration writes need to be 100% tested before flipping over (otherwise we corrupt data).

### Recommendation

**Migrate `personal_ledger.json` first** because it's the biggest pain point: 67MB, FIFO-prune bug just bit us, write contention will get worse. SQLite removes all 5 problems above. Estimated effort: 1 focused day. The other JSON files (tracked_bets per day, calibration, lessons) are fine as-is — small enough that the JSON pattern is honest and the ad-hoc inspection benefit is real.

Migration plan when ready: dual-write phase (write to both JSON and SQLite, read from JSON) → verification phase (sysAudit compares counts) → cutover (read from SQLite, deprecate JSON write). 3 ships, rollback-safe.

---

## Question 2: FE freshness — how does the PWA know it's stale?

### Where we are today

The PWA loads `index.html` from the backend. iOS Safari aggressively caches that file. When backend updates, the PWA continues serving the cached HTML/JS until the user manually triggers a hard refresh. Operator has hit this multiple times.

### Current pattern

- Backend has `/api/ws/version` (commit hash + bootAt)
- FE does NOT poll it
- FE does NOT compare its built version to the current backend version
- Operator finds out about staleness when something looks weird

### What would actually fix this

**Three options, escalating commitment:**

**Option A — Polling + auto-refresh banner (~30 min ship):**
- FE polls `/api/ws/version` every 60s
- Stores backend commit in `window.__BACKEND_COMMIT_AT_LOAD` on first call
- On subsequent polls, if commit changes, show "Backend updated — tap to refresh" banner
- Operator taps → `location.reload()`
- Pros: low risk, zero infrastructure
- Cons: still 60s lag, still requires operator tap (better than nothing)

**Option B — Auto-reload on mismatch (~1 hr ship):**
- Same poll but on mismatch, FE silently calls `location.reload(true)` (cache-bust reload)
- Pros: zero operator action required, never stale
- Cons: could interrupt operator mid-tap; need throttling so backend deploys don't refresh-loop the FE

**Option C — Server-Sent Events push (~half day ship):**
- Backend opens an SSE stream `/api/ws/events`
- Emits `{type:"version", commit:"..."}` on backend boot
- Emits `{type:"slate-ready", sport:"mlb", date:"..."}` after slate refresh writes
- FE reacts: on version event, queue reload; on slate-ready event, refetch TOP PICKS without page reload
- Pros: zero polling overhead, instant freshness, scales to other "things-changed" notifications
- Cons: more code, requires connection management

### Recommendation

**Option A first** as a quick win (today). **Option C second** as the eventual architecture — slate-ready events solve a class of problems beyond just freshness (e.g. "the dampener multipliers updated, recompute"). Option B is the trap path: silent reloads are anti-UX.

---

## Question 3: Cron-scheduled vs event-driven pipeline

### Where we are today

`scheduler.sh` fires `slate:mlb` hourly at :00, `slate:nba` at :00 + :30. sysAudit runs at :00. Everything is time-based. If a slate refresh fails, the next attempt is 30-60 min later. If a populator dies, nothing knows until the next cron tick.

### Event-driven alternative

A central message bus (could be as simple as a Node EventEmitter, or a small Redis instance, or just files-as-flags). Steps:
1. Slate refresh COMPLETES → emits `slate-ready` event
2. Subscribers (calibration updater, dampener reload, FE push, sysAudit selective categories) react
3. Failures emit `slate-failed` → triggers immediate retry + alert

### What this gains

- **Tighter feedback loop.** Today a slate failure waits ≤60 min for the next tick. Event-driven: retry in 90s.
- **No more "is this stale?" guessing.** Every downstream consumer knows the exact timestamp of upstream data.
- **Easier debugging.** Event log is a chronological story of what fired when.

### What this costs

- A simple event bus is ~100 lines of Node. Not a heavy lift.
- BUT: every subscriber site has to be updated. The migration is the work, not the bus.

### Recommendation

**Defer.** Not because event-driven is wrong — it's the right long-term architecture — but because the current cron pattern is working well enough now that the migration cost outweighs the immediate gain. Reconsider when: (a) we're firing more than 4 sources, (b) we need slate-ready signaling for the FE per Question 2, or (c) we hit the "two events fired within the same minute, both fight over the file" race we keep almost-hitting.

If we ship Question 2's Option C (SSE push), that infrastructure can be the seed.

---

## Question 4: Hot-path memoization

### Where we are today

`/api/ws/top-picks` and `/api/ws/games-browser` read `tracked_bets_YYYY-MM-DD.json` from disk on every request. PWA might refresh every minute. Backend was working fine until tonight when the dampener added more file reads per request.

### Quick win

5-minute in-process cache on the read paths:
```js
const _cache = new Map() // key = `${sport}|${date}` → {bets, readAt}
function readBetsCached(sport, date) {
  const key = `${sport}|${date}`
  const c = _cache.get(key)
  if (c && (Date.now() - c.readAt) < 5 * 60 * 1000) return c.bets
  const bets = readJsonSafe(fileFor(sport, "tracked_bets", date), [])
  _cache.set(key, { bets, readAt: Date.now() })
  return bets
}
```

Then bust on file mtime change (`fs.statSync(p).mtimeMs` — if newer than `readAt`, reload).

### What it buys

- Backend serves /top-picks in <50ms instead of ~200ms (mostly the JSON parse)
- 10x more requests/sec capacity (we don't need it today, but cheap to have)
- Same correctness — mtime check ensures we always see the latest slate

### Recommendation

**Ship as part of any FE freshness work** (Question 2). Doesn't affect anything else; pure win.

---

## Cross-cutting: things I'd add that the operator didn't ask about

1. **Pre-commit hook that runs sysAudit.** If a commit would leave the audit in RED state, hook blocks the commit. Catches infrastructure regressions at the moment they're introduced rather than at the next slate cycle.

2. **Backup script.** `personal_ledger.json`, `lessons.json`, `family_calibration.json`, and the curated `nbaSeriesState.json` should be backed up daily to a separate directory. If a future bug corrupts the ledger again, we have a known-good snapshot. ~20 lines of bash, fires from `scheduler.sh`.

3. **Schema golden files.** For each persistent JSON shape, ship a `*.schema.json` that the deep audit validates against. If a code change starts writing a different shape, audit goes RED immediately.

4. **API key health metric.** The-odds-api has quota limits. Surface remaining quota in sysAudit so we don't get rate-limited mid-slate without warning.

5. **Frontend automated tests.** Right now the FE has zero test coverage. Even a single Playwright smoke test ("PWA loads, shows N top picks, modal opens") would catch a regression like tonight's empty TOP PICKS faster than a manual probe.

---

## Recommended order of operations

1. **deepAudit first** (just shipped) — run it, see what's already broken, get current truth
2. **FE freshness Option A** — quick win, no more "is the PWA stale" anxiety
3. **Schema golden files** — locks current shapes against silent drift
4. **Personal ledger → SQLite** — kills the FIFO-prune class of bugs, unlocks proper queries
5. **Backup script** — defense in depth
6. **Pre-commit hook** — catches regressions at the source
7. **Hot-path memoization** — bundled with #2

Each step is independently shippable and rolls back cleanly. Total effort: 2-3 focused days for #1-#5, another for #6-#7. None of them is the heroic-rewrite trap. They compound — each one makes the next layer of bugs visible.
