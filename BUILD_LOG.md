# BUILD LOG

**Append-only short entries. One paragraph per work session, max. Keep total under ~300 lines — when it gets longer, summarize the old half into "earlier history" and prune.**

This is the "what's done, what's next" answer in 60 seconds. Reverse chronological (newest at top). For the full product vision, see `PRODUCT_VISION.md`. For preserved cognition, see `PRESERVED.md`.

---

## 2026-05-22 — Mobile PWA v0.2.2 — Slip Analyzer paste-text parser + milestone props

**What:** Operator tested v0.2.1 ANALYZE tab on a real DK SGP screenshot (Jalen Williams 20+ Points + 4 other legs). Two real blockers: (a) over/under-only side dropdown didn't fit milestone props like Double-Double or Anytime TD, (b) typing 5 legs by hand = hard pass for daily use.

**Done (frontend/mobile/index.html, +~190):**
- **Milestone prop types added**: Double-Double, Triple-Double, First Basket, Anytime TD, Anytime Goal, Hit a HR (plus combo props Pts+Reb, Pts+Ast, Reb+Ast for SGP-style threshold parlays).
- **Side dropdown adapts to prop type**: milestone props show Yes/No instead of Over/Under. Line input disabled for milestone props (no line needed). `onPropTypeChange` handler auto-flips side from over→yes when switching from threshold to milestone.
- **⚡ Quick paste mode**: textarea at top of analyze tab. Operator pastes the slip text from any screenshot, taps "Parse into legs" → `parseSlipText()` regex/keyword parser produces structured legs that populate the form. Saves the 5-leg-by-hand pain operator flagged.
- **Parser tested** on operator's actual DK SGP screenshot text ("Jalen Williams To Score 20+ Points, Dylan Harper To Score 20+ Points, SGA To Record 8+ Assists, Wembanyama To Score 30+ Points, Stephon Castle To Record A Double-Double") → **5/5 legs parsed correctly** including milestone Double-Double detection.
- Supported patterns: `X To Score Y+ Points`, `X Y+ Points`, `X Over Y.5 Points`, `X Under Y.5 Points`, `X To Record A Double-Double`, `X Triple-Double`, `X First Basket`, `X Anytime Touchdown`, `X HR`, etc. across MLB + NBA + NFL + soccer prop families.
- Operator still confirms / edits parsed legs before submitting (odds aren't usually in slip text, so they're the one field operator fills in per leg).

**Validation:** PWA → ANALYZE tab → paste the screenshot's slip text into the cyan textarea → tap "⚡ Parse into legs" → 5 legs appear in form, just fill in odds → tap "Analyze Slip" → verdict card.

**Next:** real image OCR (task #36) so operator doesn't even copy text. For now this drastically reduces typing pain.

---

## 2026-05-22 — Session N+1: Mobile PWA v0.2.1 (slip analyzer) + API-SPORTS audit

### Mobile PWA v0.2.1 — "Analyze a slip" tab (Flow A, manual entry)

**What:** Fourth tab "ANALYZE" on the mobile PWA. Operator looks at a winning parlay screenshot on Twitter / Discord, manually types each leg (player, prop, side, line, odds, book), submits → backend scores the slip via existing `analyzeSlip` cognition (`pipeline/screenshots/screenshotRoutes.js` POST `/api/ws/screenshots/ingest`). Returns: composite score (0-100), archetype tag, sharp/bait/viral signals, verdict summary, strongest/weakest leg, contradiction flags.

**Why manual entry only tonight (not image OCR):** Backend `/screenshots/ingest` endpoint is **JSON-only** today (docstring line 16: "JSON-only ingestion for now — no multer/image upload — deferred to future phase"). The cognition exists and is well-built; the OCR/parsing layer is the gap. v0.2.1 ships the manual-entry path that uses the existing cognition now, and tasks #20.5 + #21 cover OCR + viral-winner learning (Flow B) as next sessions.

**Done (frontend/mobile/index.html, +395):**
- New "ANALYZE" tab with cyan accent
- Slip metadata form: source dropdown (X/Twitter/Discord/Sportsbook/Viral/Tout/Mine), auto-detect sport, attribution input
- Per-leg form: player, prop type (16 options across MLB+NBA), side (over/under), line, odds, sportsbook (operator's 7-book list)
- "+ Add another leg" / "× remove leg" / "Analyze Slip (N legs)" submit
- New leg defaults sportsbook to the previous leg's book (encourages single-book discipline)
- Verdict card renders: large 0-100 composite score (color-graded green/yellow/red), archetype pill, sharp/bait/viral signal badges, verdict summary, bettor-language read, strongest/weakest leg call-outs, contradiction flags

**Validation:** operator opens PWA → ANALYZE tab → types 2-3 legs from any Twitter parlay screenshot → tap "Analyze Slip" → verdict card renders with score + archetype + signals.

---

### API-SPORTS audit (Session N+1 deliverable)

**Today's bill:** $15/mo MLB + $15/mo NBA = $30/mo. 7,500 pulls/day per sport = 450K/month combined headroom. Currently using ~10% of available capacity. Adding NFL + NHL when seasons start = +$30/mo total ($60/mo).

**MLB — what we currently consume** (`pipeline/mlb/external/adapters/fetchMlbApiSportsScaffold.js`):
- Base: `https://v1.baseball.api-sports.io`
- Endpoints hit: `/games`, `/lineups`, `/players`, `/teams/statistics`

**MLB — endpoints AVAILABLE but NOT consumed at $15/mo tier:**
- `/injuries` — player injury reports (HIGH IMPACT — currently zero injury awareness)
- `/statistics/players` — per-player season splits (vs LHP/RHP, home/away, last 30) (HIGH IMPACT — this is "Soler career vs RHP: .268, 24 HR/season pace" data the operator asked for)
- `/odds` — could cross-verify against The Odds API
- `/standings` — division/conference context for pace + motivation

**NBA — the big gap:**
- **No api-sports NBA adapter exists.** Only a passing reference in `nbaOpportunityCandidates.js` as "api-sports-rolled" source label (just a cache annotation, no live fetcher).
- NBA cognition currently runs on: `nbaPlayerProjections.json` (21 days old, missing 24/55 current rotation players — task #33), ESPN game logs (`nbaRecentFormCache.js`).
- **API-SPORTS NBA endpoints we COULD consume at $15/mo:** `/games`, `/games/statistics/players`, `/games/statistics/teams`, `/standings`, `/teams/statistics`, `/players/statistics`, `/injuries`.

**Cognition deepening opportunities (within current $30/mo budget):**

| # | Opportunity | Impact | Effort |
|---|---|---|---|
| 1 | Build NBA api-sports adapter (parity with MLB scaffold) — unlocks NBA injuries, team stats, player stats with splits | HIGHEST | 1 session |
| 2 | Add MLB `/injuries` endpoint to existing scaffold | HIGH | small |
| 3 | Add MLB `/statistics/players` for season splits (vs handedness, home/away, last 30) | HIGH | 1 session |
| 4 | DIY opponent-defensive metrics computed from `/games/statistics/teams` (e.g., "Cavs allow 12.2 threes per game to opposing point guards") | HIGHEST | 1-2 sessions |
| 5 | Per-prop-type calibration audit using settled outcomes (fix the Hits-2.5-at-34% over-prediction) | HIGH | 1 session |
| 6 | Cross-stat correlation modeling (joint distribution per player — what enables "Wemby WILL hit 40+20" tier predictions) | HIGHEST | multi-session |

**Recommended Session N+2:** opportunity #1 (NBA api-sports adapter) + opportunity #2 (MLB injuries) — both are pure data ingestion work, no model architecture changes, both unlock data the cognition layer can immediately consume. Sets up #4 + #5 + #6 to actually have data to work with.

---

## 2026-05-22 — Mobile PWA v0.2.0 + v0.1.6 (Parlay Builder + 7-book canonical + NBA team fallback)

**What:** First true product-feature beyond display + filtering. Operator can now build parlays directly in the mobile PWA. Three things shipped in one batch:

**v0.1.6 backend (B + A):**
- `backend/pipeline/shared/sportsbookAllowlist.js`: removed Caesars, added bet365. Final canonical 7-book list = DraftKings / FanDuel / Fanatics / BetMGM / Hard Rock / BetRivers / bet365. 16/16 alias self-tests pass. BetOnline.ag and any other leak drops at the persistence boundary now.
- `backend/routes/workstationRoutes.js`: defensive `applyTeamFallbackFromProjections` call for NBA candidates in `/state` route. Root cause: NBA `tracked_bets` files don't write a `team` field (0/55 confirmed); team-fallback was only running in snapshot path. Verified: 31/55 NBA candidates now get team populated (Mobley, Brunson, Jarrett Allen, James Harden, etc). 24/55 still missing because projections.json is 21 days old and doesn't cover newer/rookie players (tracked separately).

**v0.2.0 frontend (C — Parlay Builder):**
- Third tab "PARLAY" with leg-count badge (purple accent).
- Per-card "+ add to parlay" button (top-right of every card). Tap → leg added. Becomes "✓" when in parlay.
- Parlay tab shows: combined American odds (large), implied hit rate %, decimal odds, leg count, per-leg list with × to remove.
- **Single-book constructability check** — when all legs share the same book, surfaces "✓ Buildable on [Book]". When mixed, surfaces "⚠ Mixed books — can't construct at one sportsbook." Enforces the sportsbook-governance discipline canonically.
- Empty-state explainer with purple gradient.
- localStorage persistence — parlay legs survive page reloads, app restarts, PWA close/reopen. Namespaced key `edge:parlay:v1` for future migrations.
- "Clear All" with confirmation.
- ~315 lines added to `frontend/mobile/index.html`. JS syntax-clean. Total file now 1,383 lines.

**Foundation for next features:** this is the surface for v0.2.1 (Playbook-style book optimization + deep-link slip auto-build — task #25), and the natural place to wire recommendation logging (task #7) since logging happens when operator commits a parlay.

**Validation:** operator opens EDGE PWA, taps + on a card → "+" becomes "✓", PARLAY tab badge increments. Taps PARLAY tab → sees combined odds + buildability. Removes a leg → updates. Closes app + reopens → parlay still there.

---

## 2026-05-21 — MLB lineup ingest reactivated (one env flag, no code change)

**What:** Operator opened v0.1.4 PWA and observed every MLB candidate still showing "LINEUPS PENDING" with PCE-1A canonical inputs null. Investigation traced the data path: `buildMlbBootstrapSnapshot.js` → conditionally calls `applyMlbLiveStateLayers` → `deriveMlbConfirmedLineupState` → `fetchMlbOfficialLineupsSnapshot` (free MLB Stats API). The entire pipeline was gated behind `MLB_LIVE_STATE_ENABLED=1` environment variable, defaulted OFF. Operator's `.env` had `ODDS_API_KEY`, `PORT`, `API_SPORTS_KEY` but not the live-state gate.

**Done:** Operator added `MLB_LIVE_STATE_ENABLED=1` to `backend/.env`, restarted backend. Live-state pipeline now firing. Verified from boot logs: `[MLB-LIVE-STATE-BOOT-PROBE] enabled="1"`, `[MLB-LIVE-STATE-PHASE-2] lineupDerived: 9012, topTags: [['LINEUP_CONFIRMED', 8477]]`. 8,477 MLB candidate rows now carry confirmed-lineup data (Trea Turner / Elly De La Cruz / Bryce Harper / Alec Bohm visible in match results).

**Impact:**
- PCE-1A (hitter conviction engine) reactivated — canonical inputs (lineupSpot, plateAppearancesProxy, runEnvironment, rbiEnvironment, depth) now populate
- "LINEUPS PENDING" badges should disappear from most MLB cards after next slate refresh
- WHY chips for MLB hitter-overs will now include real lineup-derived signals
- Conviction-tier filter on mobile PWA will start finding qualifying plays (previously zero because lineup-pending notes disqualified everything)

**No code changes.** Pure config. Zero risk to existing cognition; pure additive enrichment.

---

## 2026-05-21 — Mobile PWA v0.1.5 (stop force-refresh on PWA open)

**What:** Operator 2026-05-21 caught that v0.1.2's force-refresh-on-open burns ~80 odds-API calls per PWA launch. Reverted to cheap state-fetch only on initial load. Refresh button (↻) keeps explicit force-refresh behavior. Header "X ago" makes staleness visible. One-line change.

---

## 2026-05-21 — Mobile PWA v0.1.4 (prop-aware lotto + grid overflow + empty-explainer)

**What:** Third-pass operator feedback. v0.1.3 +400 lotto threshold sent EVERY MLB play to Lotto because tonight's MLB slate is all +499+. Result: MLB tab showed only collapsed Lotto Room with nothing else — screen looked dead. Also, MLB 2-column grid had cards overflowing the column because grid children default to `min-width: auto` which prevented ellipsis from kicking in.

**Done (frontend/mobile/index.html, +42 / -10):**
- **Prop-type-aware lotto gating** — Hits 2.5+ always lotto (model over-predicts 3+ hits at ~34% when real rate is ~10-15%). Payout threshold for other props raised +400 → +600 so RBI 1.5 plays at +500-+550 surface in Bigger Edges, HR 0.5 at +500 surfaces normally. Quarantines the genuine tail-outcome lottery tickets without sweeping everything under the rug.
- **Empty-state explainer** when only Lotto is populated — auto-opens the Lotto details, shows yellow explainer above: "Tonight's slate is variance-heavy — no plays in the high-hit-rate buckets, only longshots. Use small stakes." Honest about the slate condition instead of looking broken.
- **Grid overflow fix** — `min-width: 0` on `.card-grid .card`. Allows ellipsis on long MLB team names to actually engage; cards stop overflowing the column boundary.

---

## 2026-05-21 — Mobile PWA v0.1.3 (layout + allowlist + lotto gating + broken-data hiding)

**What:** Second pass after operator opened v0.1.2 on phone. Spencer Jones via BetOnline.ag leaked through (non-allowed book) — allowlist enforcement gap. Hits Over 2.5 at +700 still surfaced in Bigger Edges — operator: "I'd never play that". Cards wrapping to 2 lines on narrow screens. Tab counts showed 20/17 but only ~8 actually surfaced. Mobley showed 11d rest in expand panel even though he played yesterday — broken ESPN feed value being exposed verbatim.

**Done (frontend/mobile/index.html, +92 / -22):**
- **Defense-in-depth allowlist** — `ALLOWED_BOOKS` set on the mobile side drops any play from a non-7-book source before classification. BetOnline.ag and any other leaks now never reach the surface. Diagnostic footer reports how many were filtered ("X non-allowed books filtered"). Canonical fix to `sportsbookAllowlist.js` tracked as task #22.
- **Payout-based lotto gating** — any play paying ≥ +400 lands in Lotto Room regardless of what the model says about hit rate. Catches the structural model overconfidence on tail outcomes (Ketel Marte Hits Over 2.5 surfaced at 34% modelProb — real MLB rate ~10-15%, that's a calibration bug tracked as task #26). Quarantines the lottery tickets honestly.
- **Tab counts reflect surfaced count** — operator: "mlb shows 20 but only 8 on screen". Now MLB/NBA tab badges show allowed-book count.
- **2-column grid on ≥720px, 3-column on ≥1100px** — operator: "can we 2 per row instead of 1?" — Mac Safari at full width shows 3 columns, iPad shows 2, phone stays 1. Section headers / freshness / lotto summary stay full-width.
- **Single-line prop + meta** with ellipsis — long matchups + prop names stop wrapping.
- **NBA broken "days since last game" hidden** from expand panel — operator confirmed Mobley played yesterday but feed says 11d. Surfaces "playoff data refreshing" instead of misleading "11". Real ESPN-playoff-ingest fix tracked as task #12.

**Tracked separately as new tasks (not in v0.1.3):**
- **#22** — canonical sportsbookAllowlist.js update to 7 books (matches operator vision, drops BetOnline.ag at persistence boundary)
- **#23** — Cloudflare Tunnel via edge.motel666.com — operator has Cloudflare account; solves iPhone access AND anywhere-access without LAN dependency (firewall confirmed OFF, so the iPhone hang is router-side or VPN/cellular; tunnel sidesteps all of that)
- **#24** — Parlay builder: + per-card add button, third "Parlay" tab, single-book constructability
- **#25** — Playbook-style book optimization + deep-link slip auto-build (operator's @playbook reference)
- **#26** — MLB tail-outcome calibration audit (model over-predicting 2+ / 3+ outcomes)

**Closed:**
- **#13** (iPhone external access) — superseded by #23 Cloudflare Tunnel. Diagnosis complete: bind is fine, firewall is off; the hang is router/VPN-side. Tunnel is the proper fix.

---

## 2026-05-21 — Mobile PWA v0.1.2 (parlay-confidence reframe)

**What:** Most important architectural realization of the project so far. Operator opened v0.1.1 and observed every surfaced play was +500 to +920 longshots ("Hits Over 2.5") and called it out: *"I want to feel confident multi-leg parlays will hit"* — not lottery tickets dressed up as high-edge. The current sort by raw edge% structurally favors longshots because high modelProb on low-implied-prob = inflated edge. The product needs to optimize for **hit rate first, edge second.**

**Done (frontend/mobile/index.html, +147 / -63):**

- **Source switch**: now reads `state.featured` (bucketed curated set from `buildFeaturedPlays.js`) with fallback to `state.candidates`. The featured feed includes `safest` and `bestLadders` buckets — the cognition was always there, we'd been reading the wrong feed.
- **New parlay-confidence classifier** `playClass(c, sport)` — bins every play into:
  - **Conviction** — modelProb ≥ 0.65, edge ≥ 0.05, tier ELITE/BEST
  - **Likely To Hit** — modelProb ≥ 0.55, positive edge (parlay-leg pool)
  - **Bigger Edges** — modelProb 0.30-0.55, positive edge
  - **Lotto** — modelProb < 0.30 (honestly quarantined)
- **Four-section render** replaces the prior conviction+all flat layout:
  - `★ Tonight's Convictions` (gold-bordered, top 3)
  - `Likely To Hit` (green-accented header — parlay-leg pool, sorted by modelProb desc, capped 10)
  - `Bigger Edges` (sorted by edge desc, capped 8)
  - `Lotto Room` (collapsible `<details>`, honestly labeled "variance plays · big payouts · low hit rate", capped 12)
- **Force-refresh on initial load** — app open hits `/refresh-snapshot` first. No more "updated 2h 23m ago" on open.
- **"Lineups pending" visual softening** — transparent background, smaller font, faint border. Stops dominating cards when it's the only note (which is most cards right now until lineup ingest fix lands — task #19).
- **Diagnostic footer** — small grey line shows which source feed and counts ("source: featured · 18/30 shown · classified by parlay-confidence"). Operator transparency.

**The cognition difference, plainly:** a 4-leg parlay of 65% legs = 17.8% combined hit rate. A 4-leg parlay of 33% legs = 1.2% hit rate. Same number of legs, 14x more likely to cash. The product now surfaces parlay-buildable plays first and quarantines lottery tickets honestly.

**Validation:** operator restarts backend (route is cached — actually no backend change in v0.1.2, just frontend, so hard-reload Safari/PWA suffices), opens `/m/`, validates: (a) "Likely To Hit" section now exists with parlay-leg-friendly plays, (b) longshots are in collapsed Lotto Room not dominating the top, (c) data is fresh on open (no "updated 2h ago"), (d) "lineups pending" notes no longer dominate visually.

**Tracked separately (not in v0.1.2):**
- Task #19: actual fix for MLB lineup data being null (so PCE-1A reactivates)
- Task #20: Flow A — screenshot uploader for tail-or-fade analysis
- Task #21: Flow B — X/Twitter big-winner parlay learning

---

## 2026-05-21 — Mobile PWA v0.1.1 (operator-feedback iteration)

**What:** Operator opened v0.1 on phone, gave substantive bettor review. Most-cited issues were bettor-language tone (red "no lineup data" alarms, raw "null" in expand panel, "STALE 114min" freshness scare) and missing conviction hierarchy ("model REALLY loves these 2-3"). v0.1.1 ships Bucket-A language/UX fixes and a first-pass conviction section. Deeper Bucket B/C work (NBA playoff schedule data, opponent intelligence, sportsbook movement, conviction compression cognition) tracked as separate tasks #11-#17.

**Done (frontend/mobile/index.html, +175 / -39):**
- Bettor-native language across the surface — `no lineup data` → `lineups pending`, `team unknown` → `team pending`, raw `null` in expand panel → `—` em-dash, `no canonical context signals fired` → `context loading`, `snapshot stale 114min` → `updated 1h 54m ago` (neutral grey, never red).
- Expand-panel keys renamed to bettor-language: `PA proxy` → `plate appearances`, `RBI env` → `RBI environment`, `starter flag` → `starter status (starter/bench)`, `DNPs recent` → `recent DNPs`, `source` → `data source`, etc.
- Note-style refactor: replaced `note-gap` red with `note-pending` informational yellow. Missing canonical inputs at slate-build time are normal pipeline stage, not defect.
- Tier+edge composite sort: ELITE/BEST surface above STRONG/GOOD even at lower edge — answers "smartest bets vs crazy payouts" feedback at the visible-order level. Lotto-heavy raw-edge sort no longer dominates the top of the list.
- **Tonight's Convictions section** at top — first-pass conviction-compression surface. Filter: edge ≥ 20% AND tier ELITE/BEST AND ≥ 2 WHY chips AND no pending/gap notes AND (NBA) days_since_last_game < 6. Capped at 3 cards. Gold-bordered conviction-card style, glow on tier pill. Below: "All Opportunities" header + the rest.
- NBA stale-rest chip suppression: chip only shown when days_since_last_game ∈ [2, 5]. Values ≥ 6 are almost always broken data (active playoff teams play every 2-3 days); surfacing them killed bettor trust. Underlying data fix tracked as task #12.
- Volatility note added: NBA cards with minutes_volatility ≥ 8 get a "minutes volatile" warning chip.

**NOT in v0.1.1 (operator-flagged, tracked separately):**
- Task #11 — NBA team-name resolution (real fix vs "team pending" placeholder)
- Task #12 — NBA playoff-schedule data (real fix vs chip suppression)
- Task #13 — iPhone external access (firewall/bind debug)
- Task #14 — consume state.featured buckets (Anchors/Strong/Lotto UI)
- Task #15 — true conviction compression cognition (design first)
- Task #16 — sportsbook movement intelligence (wire steam/stale/sharp into WHY chips)
- Task #17 — opponent matchup intelligence (defensive ratings per position, splits, pace)

**Validation:** operator restarts backend, reloads `http://localhost:4000/m/`, validates: (a) tone shifted from alarming red to informational, (b) Tonight's Convictions section surfaces sensible plays only, (c) "10d rest" chips gone, (d) expand panel reads as bettor-language not engine-internals.

---

## 2026-05-21 — Mobile PWA v0.1 (Edge)

**What:** First bettor-mobile surface. Single-file HTML+CSS+JS PWA at `frontend/mobile/index.html`, served by backend at `/m`. No framework, no build step, no React bloat. Fetches `/api/ws/state?sport={mlb|nba}` same-origin and renders the top 15 candidates per sport with sportsbook-flavored UI.

**Done:**
- `frontend/mobile/index.html` (754 lines) — dark sportsbook UI with tier pills (ELITE gold / BEST green / STRONG blue / GOOD grey), book-branded pills (DraftKings green, FanDuel blue, Fanatics red, BetRivers cyan, BetMGM gold, Hard Rock red, bet365 green), edge bars, sport tabs (MLB green / NBA orange accent), pull-to-refresh button, tap-to-expand cards.
- **WHY-this-play surface** — front-and-center on every card, compiled from canonical signals via pure `buildWhy()` function. MLB: implied team total, park (hrFactor), HR env tag, wind direction, temp, carry shift, lineup spot, contextual tags, PCE-1A conviction notes. NBA: starter/role status, projected minutes, minutes trend, minutes volatility, DNPs, last-5 average, days-since-last-game.
- **Honesty layer** — `buildNotes()` surfaces gaps visibly: "no lineup data" badge when PCE-1A inputs null, "X-game sample" warning when sample_count < 5, "bench over" warning for over bets from bench players. Honest empty state "no canonical context signals fired" when nothing matches. Team field shown as "team unknown" (in red) instead of blank when NBA team field is null.
- **Expand panel** — tap "▾ show signals" reveals the full canonical signal dump (predicted prob, edge prob, all enrichment fields, contextual tags, source attribution). Nulls rendered as italic "null" — never silently hidden.
- `frontend/mobile/manifest.json` — PWA metadata for iPhone Add-to-Home-Screen. Standalone display mode, portrait orientation, dark theme color.
- `frontend/mobile/icon.svg` — simple gold "E" on dark gradient with green dot accent.
- `backend/server.js` +8 lines additive — `app.use("/m", express.static(...))` mount. Zero changes to existing routes, cognition, or pipeline.

**Explicitly NOT in v0.1:**
- archetype tags (Stable / Volatile / Public-Bait) — needs cognition we haven't written
- screenshot ingestion
- recommendation logging (task #7 — next)
- next-morning grading
- ladders / correlated parlays / SGPs
- bankroll / staking / accounts / auth

**Validation:** operator opens `http://localhost:4000/m/` on Mac (after backend restart) or `http://[Mac-LAN-IP]:4000/m/` on iPhone on same WiFi. Should see real tonight's MLB + NBA candidates with WHY chips and gap notes. Visual + on-phone validation is the ship gate.

**Next:** observe v0.1 on phone tonight → iterate on what looks wrong → start task #7 (recommendation logging) so we can begin grading what the system actually picks.

---

## 2026-05-21 — slateMlb.js output upgrade

**What:** `npm run slate:mlb` Step 3 was reporting `featured plays count: n/a` because the featured-plays builder runs asynchronously after refresh and the first ws/state hit landed before it completed. The resolver was correct, the script wasn't lying — but the operator saw "n/a" and thought MLB was broken when it was actually populated 2 seconds later.

**Done:** additive change to `backend/scripts/slateMlb.js` (30 insertions, 9 deletions, commit `eacc556`). Now surfaces all the canonical `/api/ws/state` counts: candidates, discovery candidates, urgent plays, multi-book props, steam/stale counts, snapshot freshness label+age, degraded flag. Annotates `featured=n/a` as "may be still building — re-run to recheck" so operator knows it's a timing issue, not a real failure. Zero changes to resolver, route, or cognition.

---

## 2026-05-21 — Consolidation + governance compression

**What:** Massive reset from the dual-AI (GPT + Claude) governance-doctrine era to a single-chat Claude workflow focused on shipping bettor-visible product. Operator's instruction: archive 3 of the meta-system specs (runtime supervisor, operator cockpit, drift detection layer) for reference; everything else governance gets deleted/legacy-archived. Preserve observability + diagnostics + grading + stale detection + provider health + fallback detection as **tooling/support infrastructure** — not product spine, not governance doctrine.

**Done:**
- Cognition audit complete → `PRESERVED.md` tiers all 28 modules in `backend/pipeline/shared/`. Headline finding: substantially more real cognition exists than implied during the GPT-era governance growth. Vision is mostly already built in pieces — what's missing is 7-book extension, NBA cognition parity, mobile front-end, and recommendation logging.
- Memory consolidated 18 → 9 indexed files. 11 governance memories deprecated, 3 archived to `memory/archived/`, 5 new (user_profile, product_vision_iphone_pwa, cognition_preserve_list, collaboration_rules, lessons_from_gpt_era), 1 updated (sportsbook_governance: Caesars → bet365, expanded to 7 books).
- Repo root went from ~50 files to 7. Governance docs moved to `docs/_legacy/repo_root/` (13 files). `docs/` audits moved to `docs/_legacy/docs_audits/` (38 files). `probe_*.js` + `trace_*.js` + `label_sample.sh` moved to `scripts/probes/`. Nothing deleted — all recoverable via `git mv` reverse.
- `PRODUCT_VISION.md` + `BUILD_LOG.md` (this file) created at repo root as the new continuity surface.

**Preserved at repo root (the new lean surface):** `PRODUCT_VISION.md` · `BUILD_LOG.md` · `PRESERVED.md` · `ARCHITECTURE.md` · `PRODUCT_IDENTITY.md` · `backend/` · `frontend/` · `docs/` · `scripts/`.

**Next:** smallest-path sportsbook intelligence stabilization. Sequence:
1. Right-size odds API tier (task #3) — `apiCallLogger.js` plus a counter pass to confirm whether 5M-pull tier ($120/mo) can drop to $40-60/mo.
2. Diagnostic run of existing cognition against today's MLB + NBA data (new task — surface what's actually broken: stale slate, fallback projection, provider instability before we wire NBA cognition on top of a wobbly foundation).
3. Then sequenced: NBA cognition scaffolding · unified slate object · mobile slate page · recommendation logging · grading.

**Operator validation needed:** none for this session — pure reorganization + memory work, zero cognition code touched. Verifiable by inspecting repo root file list and `PRESERVED.md` content.
