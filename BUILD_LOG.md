# BUILD LOG

**Append-only short entries. One paragraph per work session, max. Keep total under ~300 lines — when it gets longer, summarize the old half into "earlier history" and prune.**

This is the "what's done, what's next" answer in 60 seconds. Reverse chronological (newest at top). For the full product vision, see `PRODUCT_VISION.md`. For preserved cognition, see `PRESERVED.md`.

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
