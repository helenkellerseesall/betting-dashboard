# BUILD LOG

**Append-only short entries. One paragraph per work session, max. Keep total under ~300 lines — when it gets longer, summarize the old half into "earlier history" and prune.**

This is the "what's done, what's next" answer in 60 seconds. Reverse chronological (newest at top). For the full product vision, see `PRODUCT_VISION.md`. For preserved cognition, see `PRESERVED.md`.

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
