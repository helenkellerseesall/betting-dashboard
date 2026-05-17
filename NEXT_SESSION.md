**Exact operational resumption state. Overwrite every session. Never append.**

> **2026-05-17 PHASE Candidate-Ecology-Parity-1A:** restored MLB battlefield widening (date-sanity gate rejects `9999-12-31` sentinel: MLB 196 eligible → 43 elite / 129 discovery) + restored NBA slip ecology (NEW aggressive + lotto NBA tier overrides: 12 candidates → 5 slips). NEW `verifyCandidateEcologyParity.js` (19/19 PASS). `ops:verify` now **36/36 PASS**.

_Last updated: 2026-05-17 (Phase Candidate-Ecology-Parity-1A SHIPPED — restored MLB battlefield widening + NBA slip ecology. MLB: `findLatestDateWithData()` date-sanity gate rejects future-dated sentinel files (`9999-12-31` no longer shadows real `2026-05-17` 196-entry file; real ecology now 43 elite / 129 discovery). NBA: `applyNbaTierOverrides()` extended with aggressive (maxPerGame: 3) + lotto (maxPerGame: 4) overrides with `skipScriptCorrelation: true` — same canonical-authority doctrine that already justifies safe + balanced NBA overrides; 12 NBA candidates → 5 slips. Trust layers preserved: MLB tiers unchanged; NBA safe/balanced still forbid aggressive; MLB-COV blocks still fire on MLB tiers. NEW `verifyCandidateEcologyParity.js` (19/19 PASS with real-data smoke against actual tracked_bets files) enforces 3-layer continuity invariant in 30-verifier matrix. `ops:verify`: 36/36 PASS (1 runtime + 30 verify\*.js + 5 probes). `cd frontend && npx tsc --noEmit` clean. ZERO scoring / ecology architecture / calibration / grading / settlement / FE / OCR / vision / LLM touched. Thirty approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyCandidateEcologyParity.js` (19/19 PASS); `npm run ops:verify` (36/36 PASS).)_

Prior session record (Phase Sport-Identity-Integrity-1A):
_Last updated: 2026-05-17 (Phase Sport-Identity-Integrity-1A SHIPPED — canonical sport-identity resolver restored. `?sport=mlb` and `?sport=baseball_mlb` (and `MLB` / `baseball`) all converge to canonical `"mlb"` → identical hydration. NEW `backend/pipeline/shared/resolveCanonicalSport.js` + NEW `verifySportIdentityParity.js` (69/69 PASS). `ops:verify` now 35/35 PASS (1 runtime + 29 verify\*.js + 5 probes).

_Last updated: 2026-05-17 (Phase Sport-Identity-Integrity-1A SHIPPED — canonical sport identity resolver. Operator caught MLB silently broken when called as `?sport=baseball_mlb` (0 slips / 0 anchors / no discoveryCandidates) while `?sport=mlb` worked. Trace identified 3 fragmentation points in workstationRoutes.js: resolveSportDate only lowercased; fileFor built paths from raw input; findLatestDateWithData filtered by raw prefix. NEW `backend/pipeline/shared/resolveCanonicalSport.js` (10-alias frozen map → canonical `mlb` | `nba`) wired into resolveSportDate. All downstream layers operate on canonical identity unchanged. NEW `verifySportIdentityParity.js` (69/69 PASS) enforces ONE-resolver doctrine. ZERO duplicate runtime states / ZERO bypass of trust layers. `ops:verify`: 35/35 PASS. `cd frontend && npx tsc --noEmit` clean. Twenty-nine approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifySportIdentityParity.js` (69/69 PASS); `npm run ops:verify` (35/35 PASS).)_

Prior session record (Phase Operational-Parity-1A):
_Last updated: 2026-05-17 (Phase Operational-Parity-1A SHIPPED — canonical `ops:*` wrappers restored to FULL historical orchestration depth. 3 NEW orchestrators chain Verification Telemetry V1 + slate/market/lineage helpers + git checkpoint stages (previously dropped by COS-1C inline `&&` chains). `npm run ops:term2` now executes full historical depth (slate + brain + runtime regression + helper-unit + probe matrix + Verification Telemetry V1); `npm run ops:checkpoint` chains FULL seal (ops:term2 + checkpointRepo + finalizeCheckpoint + git push + brain:checkpoint). NEW `verifyOperationalParity.js` (69/69 PASS) enforces. `ops:verify`: **34/34 PASS** via single command.

_Last updated: 2026-05-17 (Phase Operational-Parity-1A SHIPPED — canonical `ops:*` wrappers restored to FULL historical orchestration depth. 3 NEW orchestrators under `backend/scripts/ops/`: runTerm2Workflow.js (14-step historical Term 2 chain with required/optional classification + --strict/--quick flags), runCheckpointSeal.js (5-stage historical seal chain with --strict/--skip-term2/--skip-push/--message flags), showTerm1Status.js (read-only TERM 1 health; NEVER auto-starts/restarts — operator-cemented invariant). NEW `docs/OPERATIONAL_PARITY_AUDIT.md` documents historical inventory + parity restoration plan. NEW `verifyOperationalParity.js` (69/69 PASS) enforces wrapper-parity doctrine in 28-verifier matrix. 3 doctrine docs (OPERATIONAL_FLOW / GPT_RECONSTRUCTION_BOOTSTRAP / OPERATOR_RUNBOOK) cite Operational-Parity-1A + "historical orchestration depth" + "WRAPPERS" terminology. Backend logic / FE / scoring / ecology / calibration / grading / settlement / persistence / new ML / OCR / vision / LLM — all untouched. `npm run ops:verify`: **34/34 PASS** (1 runtime + 28 verify\*.js + 5 probes). `cd frontend && npx tsc --noEmit` clean. Twenty-eight approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyOperationalParity.js` (69/69 PASS); `npm run ops:verify` (34/34 PASS single command).)_

Prior session record (Phase Continuity-OS-1C):
_Last updated: 2026-05-17 (Phase Continuity-OS-1C SHIPPED — canonical `npm run ops:*` abstraction layer (6 commands + 3 orchestrators) replaces 4 legacy inline-chain variants. Fresh chats run `npm run ops:term2` / `ops:verify` / `ops:checkpoint` / `ops:state` / `ops:nightly` exclusively. `verifyOperationalContinuity.js` (92/92 PASS) enforces drift-prohibition. Single `npm run ops:verify` runs full 33-check matrix.

_Last updated: 2026-05-17 (Phase Continuity-OS-1C SHIPPED — OPERATIONAL RECONCILIATION. Canonical `npm run ops:*` abstraction layer + 3 NEW orchestrators (runAllVerifiers / showState / runNightlyReview) consolidate 4 legacy inline-chain variants (for-loop verifier scans / curl+jq state inspectors / 4-step bootstrap-checkpoint chains). All 3 canonical continuity docs (OPERATIONAL_FLOW / GPT_RECONSTRUCTION_BOOTSTRAP / BOOTSTRAP_PROMPT) updated with "⚠️ CANONICAL OPS LAYER" section + explicit "DO NOT regenerate legacy inline chains" prohibition. NEW `docs/OPERATIONAL_RECONCILIATION_AUDIT.md` (COS-1C-1) maps competing flows + canonical migration. NEW `verifyOperationalContinuity.js` (92/92 PASS) — drift detector. All existing brain:* / status / action commands preserved verbatim. `ops:verify` runs 33/33 checks (1 runtime + 27 verify\*.js + 5 probes) in single command. `ops:checkpoint` wraps bootstrap+continuity+verify+brain:checkpoint. ZERO backend / FE / scoring / ecology / calibration / grading / settlement / OCR / vision / LLM touched. Doctrine: canonical ops layer + legacy-chain prohibition + orchestrator-owned chains + back-compat preservation + drift detection automation. Twenty-seven approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `npm run ops:verify` (33/33 PASS via single command).)_

Prior session record (Phase Continuity-OS-1B):
_Last updated: 2026-05-17 (Phase Continuity-OS-1B SHIPPED — PORTABLE CROSS-CHAT RECONSTRUCTION ARTIFACT. Fresh GPT chats now upload ONE file (`GPT_RECONSTRUCTION_BOOTSTRAP.md`, 551 lines) to reconstruct full operating state — no longer need to read 7 anchor files OR consume long-form NEXT_SESSION.md. Long-form session memory preserved here; portable artifact is the fastest path. Estimated drift reduction ~96% vs pre-COS-1A.

_Last updated: 2026-05-17 (Phase Continuity-OS-1B SHIPPED — PORTABLE CROSS-CHAT RECONSTRUCTION ARTIFACT. Single file `GPT_RECONSTRUCTION_BOOTSTRAP.md` (551 lines, 10 required canonical sections) consolidates the COS-1A 6-anchor chain for fresh GPT upload-and-continue. Updated OPERATIONAL_FLOW anchor-reconciliation ritual to REGENERATE this file on every phase seal; brain:checkpoint FAILs if drift. NEW verifyContinuityOs1B.js (113/113 PASS) enforces sync with all 6 anchors + line budget + cross-file non-contradiction. Updated BOOTSTRAP_PROMPT with "⚡ FASTEST PATH" entry. 26/26 verify*.js · 14/14 runtime:verify · 5/5 probes · tsc clean. ZERO backend / FE / scoring / ecology / calibration / grading / settlement / OCR / vision / LLM touched. Doctrine: portable cross-chat reconstruction + mandatory regeneration + 10-section canonical structure + line-budget discipline + cross-file synchronization. Twenty-six approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyContinuityOs1B.js` (113/113 PASS expected).)_

Prior session record (Phase Continuity-OS-1A):
_Last updated: 2026-05-17 (Phase Continuity-OS-1A SHIPPED — cross-chat reconstruction system: New chats no longer need this file as the entry point. Read `BOOTSTRAP_PROMPT.md` first; it chains through 7 anchor files (~775 lines total) that reconstruct full operating state. This NEXT_SESSION.md is preserved as long-form next-priorities memory; `NEXT_PHASE.md` at the repo root is the new scannable single-source-of-truth for next-step authority.

_Last updated: 2026-05-17 (Phase Continuity-OS-1A SHIPPED — cross-chat reconstruction system. NEW 6-file anchor system at repo root: ACTIVE_PHASE.md / PRODUCT_IDENTITY.md / CURRENT_PROBLEMS.md / NEXT_PHASE.md / OPERATIONAL_FLOW.md / DEFERRED_PHASES.md (775 total lines, scannable). BOOTSTRAP_PROMPT.md updated to chain new chats (Claude OR GPT) through 7-file sequence; explicit 70-90% drift reduction goal vs prior 15000-line reconstruction surface. NEW verifyContinuityOs1A.js (117/117 PASS): asserts anchor file existence + canonical sections + cross-reference consistency + size discipline (50-400 lines each, <1500 total) + anti-hype sentinels. Anchor-file reconciliation ritual added to OPERATIONAL_FLOW.md. 25/25 verify*.js · 14/14 runtime:verify · 5/5 probes · tsc clean. ZERO backend / FE / scoring / ecology / calibration / grading / settlement / OCR / vision / LLM touched. Doctrine: cross-chat reconstruction + anti-drift + anchor-size discipline + scannable-in-30-seconds. Twenty-five approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyContinuityOs1A.js` (117/117 PASS expected).)_

Prior session record (Phase Bettor-Native Discovery Surface — BNDS-1B):
_Last updated: 2026-05-17 (Phase Bettor-Native Discovery Surface — BNDS-1B SHIPPED — CANONICAL DISCOVERY EXPANSION. Traced the FE-feels-empty root cause to `workstationRoutes.js:566` `diversifyCandidates(supplementedCandidates, { maxPerPlayer: 3, maxPerGame: 7/12, maxPerStat: 10, maxPerStatSide: 6 })` collapse: 101 MLB canonical → 32 elite; 83 NBA canonical → 12 elite. Shipped additive `discoveryCandidates` field on `/state` payload computed from SAME canonical source via SAME diversifyCandidates helper but with DISCOVERY-SAFE looser caps `{ maxPerPlayer: 8, maxPerGame: 60, maxPerStat: 60, maxPerStatSide: 35 }` (Object.frozen). REAL before/after on 2026-05-17 tracked_bets: MLB 32→85 (+53 props, +166%); NBA 12→40 (+28 props, +233%). Discovery is STRICT SUPERSET of elite (verified) + every row traces to canonical eligible pool (verified — zero synthesized). Elite path UNCHANGED (portfolio / featured / aiSlips all on tight `candidates`). Three-layer architecture now real (Battlefield / Curated Edge / Compression). FE: SportState extended with optional `discoveryCandidates?: Candidate[]`; GameDiscoveryView prefers it with graceful fallback + honest source-label badge. 35/35 verifyBnds1B + 24/24 verify*.js (zero regression) + 14/14 runtime + 5/5 probes + tsc clean. 1 backend file (additive only) + 2 FE files + 1 NEW helper unit. ZERO scoring / ecology / calibration / grading / settlement / new ML / OCR / multer / vision / LLM. Doctrine: discovery-safe canonical expansion + strict-superset invariant + three-layer separation + anti-bypass discipline + observable-widening (operator-visible `[WS-PROBE] discoveryCandidates=N` log + FE source-label badge). Twenty-four approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyBnds1B.js` (35/35 PASS expected); `cd frontend && npx tsc --noEmit` (clean expected).)_

Prior session record (Phase Bettor-Native Discovery Surface — BNDS-1A):
_Last updated: 2026-05-17 (Phase Bettor-Native Discovery Surface — BNDS-1A SHIPPED — pure FE-discovery-architecture phase. NEW 🗺 Discover section in Workstation NAV exposes game-first exploration with 7 levers: BNDS-1A-1 GameCard (per-event ecology: matchup / start time / book count / prop counts / per-team implied totals / game total / HR-park/wind/carry env chips / explosive marker via canonical OE-5 threshold / book-disagreement marker via canonical EXPL-1 threshold / most-propped player strip); BNDS-1A-2 PropRails (19 prop family rails: Hits/TB/HR/RBIs/Runs/Ks/Walks/Outs/Points/Rebounds/Assists/Threes/PRA/Blocks/Steals/FirstBasket/Alts/Specials/Other; collapsed-by-default + local search + sortable; consumes FULL in-game candidate breadth — NEVER hard-filtered upstream); BNDS-1A-3 LadderExplorer (per-player ecosystem with survivability + ecology support + contradiction warnings; focuses on players with 2+ legs); BNDS-1A-4 composeExplosiveSentence (fixed-template env sentence; NO LLM; NO hype; returns null on empty); BNDS-1A-5 density upgrade (responsive auto-fit game-card grid + single-card expanded focus); BNDS-1A-6 8 discovery lenses (All/Top/Explosive/Ladder zones/Strongest envs/Contradiction zones/HR envs/K envs) — SOFT filters on game-card array, never hard-filter props; BNDS-1A-7 ScreenshotIntake foundation (cmd+v paste + drag/drop + click-to-pick + in-memory staging tray; EXPLICITLY NO OCR / NO tesseract / NO vision / NO backend submission / honest "parsing pipeline not connected yet" copy). 2 NEW FE files (`gameEcosystem.ts` pure helpers + `ScreenshotIntake.tsx`) + 1 NEW FE section (`GameDiscoveryView.tsx`) + Workstation.tsx wired (Discover tab + section gate + SectionId union extension) + Candidate type extended additively with 14 optional canonical fields preserved by backend BC-1/OE-1 normalizeCandidate field lifts (impliedTeamTotal / gameTotal / hrEnvironmentTag / windDirectionTag / runEnvironment / rbiEnvironment / carryShift / hrFactor / temperatureF / contextualTags / depth / lineupSpot / plateAppearancesProxy / bullpenShift / reliefFatigueScore / bullpenDataAvailable / startTime / gameTime / consensusConfidence / marketDispersion) + 1 NEW helper unit `verifyBnds1A.js` (93/93 PASS) + 1 prior verifier updated (verifyBnsb1A.js: NAV label "Analyze Slip" → "Check My Slip" reflected). 23/23 verify*.js PASS · 14/14 runtime:verify · 5/5 probes (158 assertions). `cd frontend && npx tsc --noEmit` clean. ZERO backend touched. ZERO scoring / ecology / calibration / grading / settlement / new ML / OCR / multer / formidable / tesseract / vision / LLM parsing / adaptive AI styling / mobile redesign / persisted slip history. Doctrine: game-first discovery + canonical-only env derivation + soft lens (lenses sort game-card array, never hard-filter props) + ladder relationship surfacing (NOT prediction) + anti-fake-OCR continuation + bettor-native interaction (drag/drop + cmd+v matches sportsbook muscle memory). Twenty-three approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyBnds1A.js` (93/93 PASS expected); `cd frontend && npx tsc --noEmit` (clean expected).)_

Prior session record (Phase Bettor-Native Surface Bridge — BNSB-1B):
_Last updated: 2026-05-17 (Phase Bettor-Native Surface Bridge — BNSB-1B SHIPPED — pure FE-interaction-architecture phase that transforms the workstation from operator/QA tool into bettor-native interaction surface WITHOUT inventing nonexistent capability. Operator approved 10 levers (1B-1/2/3/4/6/7/8/9/10/13); deferred 1B-5/11/12. BNSB-1B-1 NEW PathPicker landing (4 cards: 🛠 Build → Bet Builder / 🔁 Borrow / 📋 Paste / 🎯 Sample) replaces JSON-textarea wall; BNSB-1B-2 fabricated `{rawText:raw}` payload REMOVED (backend has no rawText handler — was anti-fabrication doctrine violation); BNSB-1B-3 NEW BorrowTonight consumes existing `state.aiSlips` + NEW `aiSlipToIngestShape()` (ZERO new fetches); BNSB-1B-4 NEW `frontend/src/workstation/sampleSlips.ts` (4 canonical fixture slips — coherent HR / fake-safe UNDER / pitcher-hitter contradiction / explosive environment); BNSB-1B-6 VerdictCard hero re-shape (CoherenceRing SVG donut + headline + biggest-takeaway phrase + HeroLegLine + SummaryChip row + collapsible 12-section forensic detail); BNSB-1B-7 NEW `intelligenceSentence.ts` pure helper composes one bettor-readable sentence from canonical counters (only > 0; returns null on empty) — Dashboard IntelligenceStrip re-shaped (sentence default; 13-chip strip collapsible); BNSB-1B-8 NEW "Analyze this" SlipCard affordance dispatches `ws:analyze-slip` CustomEvent; Workstation listens + captures pendingAnalyzeSlip + routes + onPendingConsumed callback; AnalyzeSlipView auto-submits on receipt; BNSB-1B-9 internal `ss_*` hashes + archetype taxonomy stripped from default render (forensic tooltip only); sharp/bait re-toned "construction"; BNSB-1B-10 bettor-native loading "Reading your slip…" / network error "service offline right now" / parse error "isn't valid JSON. Try the Borrow path" / empty "I couldn't read that one"; engineer-speak removed; BNSB-1B-13 NEW `backend/scripts/verifyBnsb1B.js` (84/84 PASS) + verifyBnsb1A.js updated 3 empty-state assertions to match BNSB-1B re-tone. 2 NEW FE files + 4 FE files modified + Dashboard.tsx IntelligenceStrip re-shape + 1 NEW helper + 1 prior verifier updated. 22/22 verify*.js PASS · 14/14 runtime:verify · 5/5 probes (158 assertions) · `cd frontend && npx tsc --noEmit` clean. ZERO backend touched (NO logic / NO schema / NO new persistence / NO new ML / NO OCR / NO tesseract / NO multer / NO formidable / NO vision APIs / NO LLM parsing / NO adaptive AI styling / NO mobile redesign / NO persisted slip history). ZERO scoring / grading / ecology / calibration / settlement / replay / lineage / MLB-COV-block / EXPL / NBA-correlation / screenshot classification touch. Doctrine: bettor-native interaction architecture + anti-fake-OCR + visible intelligence (narrative density over counter density) + anti-terminal-UX (bettor-spoken loading/empty/error; internal IDs never reach bettor strings) + canonical interaction philosophy (every visible string traces to canonical source). Twenty-two approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required. Verify on demand: `node backend/scripts/verifyBnsb1B.js` (84/84 PASS expected); `cd frontend && npx tsc --noEmit` (clean expected).)_

Prior session record (Phase Bettor-Native Surface Bridge — BNSB-1A):
_Last updated: 2026-05-17 (Phase Bettor-Native Surface Bridge — BNSB-1A SHIPPED — pure FE-bridge phase that surfaces backend intelligence already shipped across BC-1A/OE-1A/OE-1B/MLB-COV-1A/VBI-1A but previously invisible to the operator. BNSB-1 RecommendationLadder slots 8 (💡 BELIEVABLE UPSIDE) + 9 (💥 EXPLOSIVE UPSIDE) wired to canonical `bestBelievableUpside`/`bestExplosiveUpside`. BNSB-2 NEW `IntelligenceStrip` component on `Dashboard.tsx` renders BC-8 `bettorRealismScore` as 🧠 advisory pill with full canonical sub-component tooltip; tone class derived from score (≥70 good / ≥40 neutral / else watch). BNSB-3 `AiSlipsView.SlipCard` surfaces optional `bettorLanguageSummary` phrases as 💬 chips when backend supplies them (present-only render). BNSB-4 `IntelligenceStrip` counter-chip row consumes 13 canonical counters across 5 phases (OE-1A 5 + OE-1B 4 + BC-1A 2 + OE-11 2 + MLB-COV-1A 2) with > 0 truthy guard + per-chip tooltip; anti-fabrication: zero counters never render, fully-empty payload shows single dimmed advisory line. BNSB-5 SlipCard reinforcement transparency ladder (raw → calibrated → reinforced + final) with `Number.isFinite` guards on each canonical field; OE-11 boost rendered as ✚ green positive when > 0, italic dim "no pairwise reinforcement applied" when explicitly 0. BNSB-6 NEW `AnalyzeSlipView.tsx` + NEW `VerdictCard.tsx`: operator pastes JSON or free text → `POST /api/ws/screenshots/ingest` pure passthrough; backend resolver computes verdict; VerdictCard renders canonical 12-field VBI shape (verdictSummary / strongestLeg / weakestLeg / contradictionFlags / ecologicalCoherence / covarianceProfile / exploitabilityProfile / availabilityProfile / fakeSafeRisk / unresolvedLegs / signals / bettorLanguageSummary) with honest "(none surfaced)" empty-state copy per section; FE does ZERO slip parsing. BNSB-7 "📸 Analyze Slip" nav tab wired into Workstation NAV + SectionId union + section router. Supporting backend bridges: FE-VBI-1 `screenshotRoutes.js` imports `analyzeSlip` from `buildSlipAnalysis` and returns `verdict` + `legsParsed` per result (anti-fabrication: `verdict = null` on resolver failure — never synthesized); FE-VBI-2 NEW `SHORT_SIGNAL_PHRASES` frozen sibling map in `bettorLanguage.js` (14 canonical SIGNAL_IDS → ≤50-char chip labels; cardinality matches `SIGNAL_PHRASES` exactly); `buildSlipAi.js` slip payload propagates `calibratedCombinedModelProb` + `oe11ReinforcementBoost` + `rawCombinedModelProb`; `workstationRoutes.js` `aiSlipsSummary` extended with `bettorRealismScore` + `oe11SlipStats` + `mlbCovStats`. 5 backend files + 1 FE types + 1 FE api + 5 FE component/section files = 12 files touched additively + 2 NEW FE files (AnalyzeSlipView.tsx + VerdictCard.tsx) + 1 NEW helper unit `backend/scripts/verifyBnsb1A.js` (131/131 PASS). 14/14 runtime:verify + 5/5 probe matrix (158 assertions) + 21/21 verify*.js across all prior phases (verifyBettorCuration1A 83/83 + verifyOffensiveEcology1A 101/101 + verifyOffensiveEcology1B 61/61 + verifyMlbCorrelationEngine1A 37/37 + verifyMarketExploitation1A 40/40 + verifyVisualBettingIntelligence1A 76/76 — zero regression). `cd frontend && npx tsc --noEmit` clean. ZERO backend logic touched (payload propagation + SHORT_SIGNAL_PHRASES sibling only). ZERO scoring redesign / persistence / new ML / LLM / OCR / new fetches / calibration / grading / settlement / replay / lineage / MLB-COV-block / EXPL / NBA-correlation / existing screenshot classification / TIER_TEMPLATES / combineLegs joint-prob math / recommendation-hierarchy-architecture touch. Doctrine: bettor-native surface bridge + canonical FE passthrough (FE never synthesizes) + visible reinforcement transparency + 9-slot fixed-cardinality ladder + intelligence visibility + observational surfacing. Twenty-one approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — pure additive FE module render + additive backend payload propagation. Verify on demand: `node backend/scripts/verifyBnsb1A.js` (131/131 PASS expected); `cd frontend && npx tsc --noEmit` (clean expected).)_

Prior session record (Phase Offensive-Ecology-Intelligence-1B):
_Last updated: 2026-05-17 (Phase Offensive-Ecology-Intelligence-1B SHIPPED — OE-11 stackReinforcementScore (per-pair cap 0.02 + aggregate cap 0.03 in combineLegs joint-prob multiplier; 7-gate AND: same-event + same-team + both OVER + isOffensiveAttackStat + pressureIndex>0.60 + EXPLOSIVE env per-leg + canonical pairCorrelationScore===+0.5; dependency-injected into combineLegs via opts.stackReinforcementScore + lazy-require from buildFeaturedPlays; auditable `calibratedCombinedModelProb` + `oe11ReinforcementBoost` exposed on slip return; back-compat preserved when opts absent) + OE-12 lineupTurnoverPotential (per-event aggregator: 0.35 depth fraction + 0.30 avg teamTotal/5.0 + 0.35 avg runEnv + 0.20 explosive upgrade; NEUTRAL 0.50 when no canonical signals) + buildLineupTurnoverIndex + lineupTurnoverBoost (cap 0.02 sort-time soft boost) wired into buildBestAggressive + buildSmartAggression + buildExplosiveUpsideTickets ONLY + OE-13 bullpenFragilityContext (~+0.02 cap on hitter overs; composes canonical bullpen fragility AND late-game offensive support; NEUTRAL fallback OE13_NEUTRAL_FRAGILITY=0.50 when bullpenDataAvailable !== true) wired into scoreCandidate as additive boost alongside OE-3 + OE-4 + OE-1B field lift (bullpenShift/reliefFatigueScore/bullpenDataAvailable through both normalizeCandidate paths) + NEW _oe1bStats 4-dim counter (pairReinforcementBoosts/turnoverBoostsApplied/bullpenBoostsApplied/lineupTurnoverEventsHigh) + `[OE-1B] offensive reinforcement` log + `[OE-1B] slip reinforcement` log + NEW `backend/scripts/verifyOffensiveEcology1B.js` (61/61 PASS). 14/14 runtime:verify + 5/5 probe matrix (158 assertions). All 4 prior phase helper units still PASS (OE-1A 101/101, BC-1A 83/83, MLB-COV-1A 37/37, EXPL-1A 40/40). Integration smoke confirmed: 1 explosive event + 1 high-turnover event + 2 OE-2 pressure boosts + 2 OE-12 turnover boosts + cross-phase BC-1A signals. Preservation: MLB-COV hard blocks intact (pitcher-K-vs-opposing-hitter returns 0 boost — canonical -1.0 case); hidden-value unders UNTOUCHED. ZERO scoring redesign (OE-13 is additive small-cap boost; existing 10+OE-2 factors UNCHANGED). ZERO new persistence / FE / OCR / ML / LLM / GPT / celebrity scoring / new fetches / calibration / grading / settlement / replay / lineage / MLB-COV-block / EXPL / NBA-correlation / existing screenshot / TIER_TEMPLATES.balanced override / recommendation-hierarchy-architecture / bullpen-feed-activation touch. Doctrine: positive reinforcement + lineup turnover + bullpen survivability + anti-fake-correlation + offensive chain-reaction. Twenty approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — pure additive in-process modules. Verify on demand: `node backend/scripts/verifyOffensiveEcology1B.js` (61/61 PASS expected).)_

Prior session record (Phase Offensive-Ecology-Intelligence-1A):
_Last updated: 2026-05-17 (Phase Offensive-Ecology-Intelligence-1A SHIPPED — OE-1 canonical realism+env lift (both `normalizeCandidate` paths now also preserve `runEnvironment`/`rbiEnvironment`/`windDirectionTag`/`carryShift`/`hrFactor`/`temperatureF` on top of BC-1) + OE-2 NEW `offensivePressureIndex(c)` 5% additive composite weight in `scoreCandidate` (hitter OVERS only; `runEnvironment × oe2TeamTotalMultiplier(impliedTeamTotal) × oe2CarryShiftBonus(carryShift)`; neutral 0.50 fallback) + OE-3 NEW `hrCarryEnvironment(c)` +0.03 cap on HR OVERS (4-gate AND: wind-out + carryShift>0 + HR_FRIENDLY + temp≥75) + OE-4 NEW `correlatedRunProduction(c)` +0.03 cap on runs/RBIs OVERS at top-of-order (lineupSpot 1-4 + runEnv OR rbiEnv ≥0.55) + OE-5 NEW `buildExplosiveEnvironmentIndex(normalized)` per-event aggregator (gameTotal≥9.5 AND avg(impliedTeamTotal)≥4.5 AND wind-out AND no HR_SUPPRESSING) + OE-6 NEW `buildExplosiveUpsideTickets` observational bucket (mirrors BC-5 doctrine; auto-empty when no event qualifies) + OE-7 NEW recommendation ladder slot 9 `bestExplosiveUpside` (9 slots total; pickFirstUnique dedup walk; existing 8 preserved verbatim) + OE-8 NEW `ladderSurvivabilityFactor(c)` + sort-time `ladderSurvivabilityDemote` -0.04 cap inside `buildBestLadders` (additive on top of BC-4 demote; never mutates composite) + OE-9 NEW `_oe1aStats` 5-dimension counter (`resetOe1aStats`/`getOe1aStats` discipline; per-run `[OE-1A] offensive ecology: ...` operator-visible log; `oe1aStats` on result payload) + OE-10 NEW `backend/scripts/verifyOffensiveEcology1A.js` (101/101 deterministic assertions + sterile-vs-explosive integration smoke). 14/14 runtime:verify + 5/5 probe matrix (158 assertions). End-to-end integration confirmed: Boom Bat (top + 5.5 teamTotal + 10.0 gameTotal + wind-out + HR_FRIENDLY) surfaces in explosive bucket; Quiet Bat UNDER leg untouched (preserves hidden-value unders); BC-1A counters fire correctly on sterile candidate (cross-phase compatibility). ZERO scoring redesign (OE-2 is purely additive 11th factor at 5%; existing 10 factors UNCHANGED). ZERO new persistence / FE / OCR / ML / LLM / GPT / celebrity scoring / new fetches / calibration / grading / settlement / replay / lineage / MLB-COV-block / EXPL / NBA-correlation / existing screenshot / TIER_TEMPLATES.balanced override / combineLegs joint-prob / bullpen activation / recommendation-hierarchy-architecture-outside-slot-9 touch. Doctrine: offensive ecology (positive symmetry to BC-4 hostile-soft-demote) + explosive-environment + ladder survivability + believable upside + anti-chaos ticket + observational-only OE-1A + canonical-authority-first. Nineteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — pure additive in-process modules. Verify on demand: `node backend/scripts/verifyOffensiveEcology1A.js` (101/101 PASS expected).)_

Prior session record (Phase Bettor-Curation-Intelligence-1A):
_Last updated: 2026-05-17 (Phase Bettor-Curation-Intelligence-1A SHIPPED — BC-1 canonical realism-field lift (both `normalizeCandidate` paths preserve `lineupSpot`/`depth`/`plateAppearancesProxy`/`impliedTeamTotal`/`gameTotal`/`hrEnvironmentTag`/`contextualTags`) + BC-2 NEW `playerLegitimacyFactor` 7% composite weight in `scoreCandidate` (depth × teamTotal ramp; neutral 0.70 fallback when canonical signals absent) + BC-4 believable-upside soft-demote (-0.05 sort-time only; never mutates; HR_SUPPRESSING OR teamTotal<3.5; applied in `buildBestHr` / `buildBestLadders` / `buildBestAggressive`; anti-fabrication: 0 demote on absent signals) + BC-5 NEW `buildBelievableUpsideTickets` observational bucket (depth∈{top,middle} ∧ teamTotal≥4.5 ∧ park favorable; auto-empty on absent signals) + BC-6 NEW recommendation ladder slot 8 `bestBelievableUpside` (8 slots total; pickFirstUnique dedup walk; null when bucket empty) + BC-7 additive anti-replacement anchor corroborator (depth∈{top,middle} OR teamTotal≥4.5; 7th corrob; existing 6 untouched) + BC-8 NEW `computeBettorRealismScore` advisory aggregate on `buildAiSlips` result (sub-weights 0.40 depth-coverage + 0.30 avg-teamTotal + 0.15 gameTotal + 0.15 hrEnv = 1.0; null on empty pool) + BC-9 NEW operator-visible `[BC-1A] realism gate: soft-demoted N HR-suppressing-park + M desert-team-total candidate(s)` log per `buildFeaturedPlays` run. 83/83 helper unit PASS via NEW `backend/scripts/verifyBettorCuration1A.js`. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). End-to-end integration confirmed: Star Hitter (top+5.5+HR_FRIENDLY) surfaces in believable bucket; Bench Backup (back+3.0+HR_SUPPRESSING) excluded + soft-demoted; ladder slot 8 picks Star. ZERO scoring redesign (BC-2 is additive 10th factor at 7%; existing 9 factors UNCHANGED). ZERO new persistence / FE / OCR / ML / LLM / celebrity scoring / new fetches / calibration / grading / settlement / replay / lineage / MLB-COV / EXPL / NBA-correlation / existing screenshot module / recommendation-hierarchy-architecture touch. Doctrine: bettor-curation + bettor-realism + believable-upside + anti-overenumeration + realism-weighted curation. Eighteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — pure additive in-process modules. Verify on demand: `node backend/scripts/verifyBettorCuration1A.js` (83/83 PASS expected).)_

Prior session record (Phase Visual-Betting-Intelligence-1A):
_Last updated: 2026-05-16 (Phase Visual-Betting-Intelligence-1A SHIPPED — VBI-2 canonical prediction resolver + VBI-3 unified slip-analysis engine + VBI-4 deterministic bettor-language phrase library + VBI-6 end-to-end verification fixture + VBI-8 canonical verdict payload shape. VBI-2 in NEW `backend/pipeline/shared/resolveSlipLegToPrediction.js`: pure resolver reusing `intelligence.predictionId` + `normPlayer` + `normFam` + `normBook`; NEW `STAT_FAMILY_TO_CANONICAL_PROPTYPE` translation bridges screenshot camelCase (`totalBases`/`hr`/`ks`) to substring-friendly propType strings the canonical MLB role predicates already match; explicit `UNRESOLVED_REASONS` taxonomy (MISSING_PLAYER / MISSING_STAT_FAMILY / MISSING_SIDE / MISSING_LINE / MISSING_SPORT / MISSING_SLATE_DATE — anti-fabrication). VBI-3 in NEW `backend/pipeline/shared/buildSlipAnalysis.js`: pure composition engine consuming canonical `pairCorrelationScore` (MLB-COV-1/3) + role predicates for MLB-COV-2 detection + `marketSupportFor` (EXPL-1) + `candidateIsHardDropAvailability` (EXPL-4); deterministic `ecologicalCoherence` formula `1.0 - 0.50×contradictions - 0.10×unresolved - 0.05×unsupportedSolo - 0.25×hardDropOut + 0.05×positiveStacks` clamped; canonical 12-field verdict payload (VBI-8 shape). ZERO new math / ML / LLM / opaque survivability percentages. VBI-4 in NEW `backend/pipeline/shared/bettorLanguage.js`: deterministic SIGNAL_PHRASES dictionary mapping 14 canonical signal IDs to operator-approved phrases; `renderVerdictPhrases` deterministic priority sort + dedupe; `composeVerdictSummary` deterministic single-line pick; unknown IDs silently dropped (anti-fabrication); **NO LLM. NO GPT. ZERO opaque prose.** VBI-6 in NEW `backend/scripts/verifyVisualBettingIntelligence1A.js`: 76 deterministic assertions across 4 canonical operator-named fixture slips (coherent stack → positive_offensive_stack / Coors fake-safe UNDER → shared_game_suppression_exposure + fake_safe_same_game_exposure / pitcher-K vs hitter contradiction → mlb_pitcher_hitter_conflict + structural_contradiction / unsupported bait → market_context_unavailable when shopMap absent). 76/76 PASS. VBI-8 frozen `VERDICT_PAYLOAD_SHAPE` constant — single source of truth for FE / persistence / CLI consumers. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). Three NEW pipeline modules + one NEW verification fixture; ZERO existing screenshot pipeline / scoring / persistence / FE / OCR / new ML / calibration / grading / settlement / replay / lineage / recommendation-hierarchy / MLB-COV / EXPL / NBA-correlation touch. Doctrine: visual betting intelligence + deterministic bettor-language + screenshot interpretation philosophy + canonical screenshot authority + anti-fabrication screenshot doctrine. Seventeen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — pure additive in-process modules. Try it: `node backend/scripts/verifyVisualBettingIntelligence1A.js` (76/76 PASS expected).)_

Prior session record (Phase MLB-Correlation-Engine-1A):
_Last updated: 2026-05-16 (Phase MLB-Correlation-Engine-1A SHIPPED — MLB-COV-1 canonical engine bridge + MLB-COV-2 shared-game suppression + MLB-COV-3 role-aware pitcher-hitter conflict. MLB-COV-1 in `backend/pipeline/shared/buildSlipAi.js`: NEW lazy loader `getMlbCorr()` mirroring NBA pattern; reuses canonical `pairCorrelationScore` + role predicates from `pipeline/mlb/buildMlbCorrelationEngine.js` (additive exports — zero logic change on the engine itself). MLB-COV-2 in same file: NEW gate in `canAddLeg()` blocking 2nd hitter-counting UNDER same-game with canonical reason `shared_game_suppression_exposure`. MLB-COV-3 in same file: NEW gate consuming `pairCorrelationScore ≤ -0.99` (opposing-team pitcher-K-OVER + hitter-counting-OVER) with canonical reason `mlb_pitcher_hitter_conflict`. Both new gates sport-gated via EXISTING `!tpl.skipScriptCorrelation` (NBA bypasses; NBA correlation path UNCHANGED). NEW operator-visible `[MLB-COV-1A] suppressed N+M ...` log; `mlbCovStats` returned on slip-build payload. NEW pure helpers `resetMlbCovStats()` + `getMlbCovStats()` for per-invocation counter discipline. 37/37 helper unit PASS via NEW `backend/scripts/verifyMlbCorrelationEngine1A.js`. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). End-to-end LOTTO smoke confirmed: Coors Vargas+Goodman UNDER stack BLOCKED + Ohtani-K-OVER + opposing-hitter-OVER BLOCKED + Judge+Soto same-team OVER stack PRESERVED. ZERO scoring redesign / persistence / ML / calibration / grading / settlement / replay / lineage / recommendation-hierarchy / NBA path touch. Doctrine: deterministic covariance + same-game ecological suppression + role-aware anti-correlation + parlay survivability + canonical-authority-first. Sixteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — additive pure-function changes only (canAddLeg gates evaluated on the next slip build).)_

Prior session record (Phase Market-Exploitation-1A):
_Last updated: 2026-05-16 (Phase Market-Exploitation-1A SHIPPED — EXPL-1 consensus-support gate + EXPL-4 availability hard-filter. EXPL-1 in `backend/pipeline/shared/buildFeaturedPlays.js`: NEW constants `EXPL1_MIN_BOOK_COUNT=3` + `EXPL1_MIN_CONSENSUS_CONFIDENCE=0.6`; NEW pure helpers `marketSupportFor` + `staleRowLookupKey`; gate wired into `buildBestDisagreementEdges` + `buildStaleLineOpportunities` + `buildInflatedSuperstarSpots`; surviving plays receive canonical `processNote = "market-supported disagreement"` (or `"market-supported overprice"` on AVOID) appended via ` · ` separator. EXPL-4 in same file: NEW `EXPL4_HARD_DROP_STATUSES={"out"}`; `normalizeCandidate` extended additively to preserve canonical `playerStatus` + `availabilityContext` (reuses `pipeline/nba/nbaAvailabilityCache.enrichRowWithAvailability`); NEW helpers `candidateIsHardDropAvailability` + `buildAvailabilityIndex` + `staleRowIsHardDropAvailability`; hard-filter at main-entry choke point; staleRows symmetrically gated; operator-visible warnings on every drop. MLB no-op (anti-fabrication on missing playerStatus). 40/40 helper unit PASS via NEW `backend/scripts/verifyMarketExploitation1A.js`. 14/14 runtime:verify + 5/5 probe matrix (158 assertions). End-to-end smoke confirmed all gates fire correctly. ZERO scoring redesign / persistence / ML / calibration / grading / settlement / replay / lineage / recommendation-hierarchy touch. Doctrine: market-supported disagreement + availability-authority + exploitability-ranking philosophy. Fifteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED. No operator restart required — additive pure-function changes only.)_

Prior session record (Phase Operational-Governance-1A):
_Last updated: 2026-05-16 (Phase Operational-Governance-1A SHIPPED — receipt-as-memory-ledger + symmetric enforcement. GOV-1: `brain:checkpoint` now enforces `CURRENT_STATE.md` + `NEXT_SESSION.md` + `docs/OPERATOR_RUNBOOK.md` as required-on-patch alongside backend brain docs. GOV-2: `RUNTIME_CODE_DIRS` includes `frontend/src` — frontend changes participate in continuity. GOV-3: 5-probe canonical integrity matrix runs at every checkpoint (grading_backfill / lineage / epoch_authority / persistence_idempotency / ledger_mirror); failure FAILs checkpoint. GOV-4: receipt schema gains `probeMatrixHashAtCheckpoint`; continuity warns on probe-script drift. Live checkpoint PASS + FAIL semantic verified. Fourteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase NightlyReview-Hydration-1A):
_Last updated: 2026-05-16 (Phase NightlyReview-Hydration-1A SHIPPED — alias-before-render canonical names. HYDRATE-1 in `backend/pipeline/shared/buildPostGameReview.js` adds canonical `projected`/`actual` row aliases (sourced from `b.line` / `b.actualValue` with legacy fallback) + repairs stale `actualStat` to read `num(b.actualValue) ?? b.actualStat ?? null` first; all legacy keys preserved verbatim. HYDRATE-2 in `scripts/nightlyReview.js` replaces direct `${p.projected}`/`${p.actual}` reads with deterministic fallback chains ending in `"?"` sentinel. Live verification: MLB + NBA proj/actual now render correctly across 6 sample rows. 150/150 probe matrix PASS, tsc clean. ZERO grading/settlement/persistence/calibration touch. Thirteen approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase SQLite-Persistence-Hygiene-1A):
_Last updated: 2026-05-16 (Phase SQLite-Persistence-Hygiene-1A SHIPPED — deterministic primitive-safe SQLite bindings. HYGIENE-1 hoists totalBets/settledCount/hitCount/missCount/hitRate from `report.answers.*` onto outer `report.*` in `backend/pipeline/review/buildDailyIntelligenceReview.js`. HYGIENE-2 introduces `bindBool(v,{ifNull})` pure helper (coerces JS booleans to 1/0/NULL — better-sqlite3 rejects raw booleans) and applies it at every boolean-shaped binding across 6 INSERTs + adds defensive `?? null/?? 0/JSON.stringify(x ?? null)` everywhere. HYGIENE-4 replaces template-literal coercion of portfolio warnings in `scripts/nightlyReview.js` with frontend label-extraction pattern. Binding errors progression: param 5 → param 13 → ZERO. 10/10 bindBool unit + 150/150 probe matrix PASS, tsc clean. ZERO schema/grading/settlement rewrite. Twelve approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Settlement-Ingestion-Window-1A):
_Last updated: 2026-05-15 (Phase Settlement-Ingestion-Window-1A SHIPPED — rolling settlement window via AUTO-3. NEW `buildWindowDates(todayStr, N)` pure helper + `--window=N` (default 2) flag + `dateExplicit` tracking in `backend/scripts/settlementRun.js`. Bare `npm run settlement:run` now sweeps `[yesterday, today]`; `--date=YYYY-MM-DD` preserves single-date semantics; new operator log line `processing settlement window: [YYYY-MM-DD ... YYYY-MM-DD]`. CHECK + EXECUTE iterate via EXISTING `executePair`. 15/15 helper unit + 150/150 probe matrix PASS, tsc clean. ZERO grading/writer/orchestration/persistence/calibration mutation. AUTO-1 lifecycle preserved. Eleven approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Recommendation-Hierarchy-1A):
_Last updated: 2026-05-15 (Phase Recommendation-Hierarchy-1A SHIPPED — deterministic 7-slot decision ladder. NEW `buildRecommendationLadder()` in `backend/pipeline/shared/buildFeaturedPlays.js` + NEW `RecommendationLadder` interface in `frontend/src/workstation/types.ts` + NEW `frontend/src/workstation/components/RecommendationLadder.tsx` + Dashboard.tsx wiring between risk pulse and HeroPickCard. Slot priority: bestOverall → safestPlay → bestDisagreement → bestUpsidePlay → bestBalancedPlay → mostOverpricedAvoid → highestTrapRiskAvoid; dedup walks bucket past taken ids; empty slot doctrine = null + honest "(no qualifying X tonight)". 20/20 helper unit + 150/150 probe matrix PASS, tsc clean. ZERO pipeline mutation. ZERO scoring rewrite. ZERO new ranking math. Ten approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Canonical-Shape-Hardening-1A):
_Last updated: 2026-05-15 (Phase Canonical-Shape-Hardening-1A SHIPPED — canonical resolver helpers + slateMlb.js drift closure. NEW `backend/pipeline/shared/responseShapeResolvers.js` exports 5 deterministic helpers; `slateMlb.js` migrated. 31/31 helper unit assertions PASS + 150/150 probe matrix unchanged. tsc clean. ZERO API/writer/pipeline/payload mutation. Nine approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Intelligence-Shaping-1A):
_Last updated: 2026-05-15 (Phase Intelligence-Shaping-1A SHIPPED — INC-017 RESOLVED. 4 key-path corrections in `backend/scripts/slateNba.js` aligned diagnostic reader to canonical API response shapes. Same family pattern as INC-016 — diagnostic-reader key-path drift, NOT substrate failure. ZERO backend pipeline file changed. ZERO API route change. Full matrix 150/150 PASS. tsc clean. Eight approved gates shipped. INC-013/014/015/016/017 all RESOLVED.)_

Prior session record (Phase Snapshot-Authority-1A):
_Last updated: 2026-05-15 (Phase Snapshot-Authority-1A SHIPPED — INC-016 RESOLVED. Two one-line reader fallback fixes (marketStatus.js + buildIntelligencePresentation.js) add `data.props` to the snapshot-row resolution chain, mirroring the canonical workstation reader pattern. NBA `market:status` now correctly reports rows=5655 / books=2 (was 0/0). MLB unchanged. ZERO writer-side change. ZERO new files. Full matrix 150/150 PASS. tsc clean. Seven approved gates shipped. INC-013/014/015/016 all RESOLVED.)_

Prior session record (Phase Settlement-Orchestration-1A):
_Last updated: 2026-05-15 (Phase Settlement-Orchestration-1A SHIPPED — deterministic settlement automation. AUTO-1: runHistoricalGrade.js chain hook; AUTO-2: NEW `npm run settlement:run` canonical entry. Daily ceremony 3 commands → 1 command. ZERO backend pipeline change. Sandbox smoke confirmed full chain. 150/150 matrix unchanged. tsc clean.)_

Prior session record (Phase Operator-Experience-1B-1):
_Last updated: 2026-05-15 (Phase Operator-Experience-1B-1 SHIPPED — readable intelligence via deterministic plain-English tooltips. NEW `frontend/src/workstation/tooltips.ts` (25 helpers, ~220 lines) + 82 title= attributes across 7 surfaces + `(2b)` → `(2 books)` cleanup. ZERO backend file changed. ZERO layout / card / navigation redesign. ZERO AI-generated prose. Anti-fabrication enforced. tsc clean (exit 0). 150/150 matrix unchanged. All prior phases preserved.)_

Prior session record (Phase Operator-Experience-1A):
_Last updated: 2026-05-14 (Phase Operator-Experience-1A SHIPPED — actionable intelligence surfacing. 5 additive changes: 8 new operator-priority buckets in buildFeaturedPlays + 3 Phase Market-1A fields lifted onto every compactPlay + ActionableBucketsGrid Dashboard component + inline `conf=0.86 (3 books) volatility: balanced Δ-3.2¢` annotations on HeroPickCard/SpotlightCard/FeaturedCard + processNote/avoidReason lifted from tooltips to visible rows. tsc clean (exit 0). 150/150 probe matrix unchanged. Pre/post snapshots in backend/runtime/operator/baseline_snapshots/. No grading / replay / lineage / persistence / market-pipeline path changed. INC-013/014/015 all RESOLVED. Realism-1A + Market-1A + Operator-1A all shipped.)_

---

## OPERATOR ACTION — Fresh workstation review

```bash
cd backend
# 1. Run the slate refresh + workstation backend
npm run engine:restart        # ensure clean backend
npm run slate:refresh         # populates api_call_log.jsonl + freshens snapshot

# 2. Visit the workstation in the browser
# Default route: Workstation.tsx renders Dashboard.
# Look for:
#   - "Actionable Operator Buckets" section ABOVE the sport-native spotlight grid.
#   - 8 SpotlightCards: Best Balanced / Aggressive / Unders / Alt Ladders /
#     Disagreement Edges / Stale-Line Opportunities / Trap Ladders / Inflated Spots.
#   - On HeroPickCard: new "conf=X.XX (Nb) volatility: X Δ±X¢ vs consensus" row.
#   - On every SpotlightCard top: same inline annotations + SOFT/STALE pill if applicable.
#   - On FeaturedCard rows: same annotations + processNote no longer tooltip-only.
# 3. Verify the substrate is untouched
npm run market:status         # still works; api_call_log.jsonl still populating
npm run grading:status        # unchanged
npm run calibration:status    # unchanged
npm run lineage:status        # unchanged
npm run runtime:verify        # 14/14 PASS expected
```

---

## OPERATOR-EXPERIENCE — Remaining lever options (held for operator-approval gates)

| Phase | Levers | Effect |
|---|---|---|
| **1B** | whyQualifies + whyAvoid per card; tier text labels; mobile @media rules; keyboard shortcuts (Cmd/Ctrl+1..8 to jump buckets); copy-to-clipboard | Faster operator decision flow; mobile use enabled |
| **1C** | Operator-customizable bucket priority weights; "what changed since last refresh" delta surface; per-prop drill-down route | Personalized priority; live diff awareness |
| **1D** | Per-slip calibration-coefficient impact surfacing; Phase 1A filter-applied indicators on AGGRESSIVE slips | Trust-anchor surface for AGG-2 / TEXT-1 observation window |
| **1E** | Refined TRAP / INFLATED detection — depends on Phase Market-Ecology-1B INFLATE-1 / ANCHOR-1 levers | Per-book inflation index + reference-book truth anchor |

---

## MARKET-ECOLOGY — Remaining lever options (held)

| Phase | Levers |
|---|---|
| **1B** | STALE-1 (time-series stale detector — requires snapshot delta log) + CONS-1 (trimmed-mean consensus) + CONS-2 (low-book-count warning) |
| **1C** | DISAG-1 (disagreementScore field) + DISAG-2 (outlier-book cluster detection) + ALT-DISAG-1 (per-rung alt-line price divergence) |
| **1D** | INFLATE-1 (per-book inflation index) + ANCHOR-1 (reference-book truth anchor) |

---

## REALISM-ECOLOGY — Remaining lever options (held)

| Phase | Levers |
|---|---|
| **1B** | ALT-1 (BALANCED alt-line sort bonus) + PORT-1 (samePlayer thresholds re-tightened) |
| **1C** | CORR-1 (cap pairwise boost in AGGRESSIVE) + VOL-1 (split aggressive volatility bucket) |
| **1D** | AGG-1 (AGGRESSIVE minModelProb 0.20→0.28) + AGG-3 (drop lotto from AGGRESSIVE) + MLB-AGGRESSIVE under-only |

---

## DEFERRED ITEMS

| Phase | Scope |
|---|---|
| **1F-cosmetic** | Normalize 3 remaining `bet.actualStat` reads (lines 154/335/374 in buildPostGameReview.js) for display parity |
| **1H** | Personal-ledger settlement activation (INC-011 — 2000/2000 bets dormant at `result='pending'`) |
| **canAddLeg same-game gateway hardening** | Pre-existing gap when gameKey() returns null |
| **Snapshot retention for time-series** | Required before Market 1B STALE-1 |

---

## KNOWN OPEN INCIDENTS

| Inc | Status | Summary |
|---|---|---|
| INC-001 | OPEN — runtime-verification pending | F6.3 player-id resolution awaiting operator TERM 1 restart + diagnostics check |
| INC-002 | OPEN — known edge case | Same-lastname collision on same team (low NBA frequency) |
| INC-003 | OPEN — known limitation | NBA roster Map has no TTL; mid-season trades require process restart |
| INC-011 | OPEN — dormant ledger | personal_ledger.json 2000/2000 bets at `result='pending'`. Phase 1H candidate |
| INC-012 | OPEN — by design | ~84% of historical outcomes are pre-corpus orphans. Permanent |
| **INC-013** | **✅ RESOLVED 2026-05-14 (Phase Grading-Calibration-Operations-1E)** | Field-mapping fix shipped; calibration unblocked |
| **INC-014** | **✅ RESOLVED 2026-05-14 (Phase 1F)** | Stale-lockfile blocked deterministic backfill; PID-liveness + `--clear-locks` shipped |
| **INC-015** | **✅ RESOLVED 2026-05-14 (Phase 1G)** | PID-reuse edge case in Phase 1F's liveness probe; age-aware reclaim shipped |

---

## ACTIONABLE INTELLIGENCE DOCTRINE (Phase Operator-Experience-1A established)

- **Observability first** — surface existing intelligence before introducing new heuristics.
- **Anti-fabrication** — every visible annotation must trace to a deterministic backend value; if missing, omit (no "(n/a)" guesses).
- **Anti-clutter** — every new visible surface declares a top-N cap and auto-hides when empty.
- **Operator decision-speed** — calibration/market-informed actionable buckets render FIRST.
- **Replay/grading/calibration substrate untouched** — UX surfacing never disturbs pipeline.
- **Pre/post snapshots mandatory** — every Operator-Experience phase captures source-shape snapshots in `backend/runtime/operator/baseline_snapshots/`.

---

## MARKET OBSERVABILITY DOCTRINE (Phase Market-Ecology-1A established — still in force)

- Observability first; zero new network calls per phase unless approved.
- Anti-fabrication; empty sections print `(no data)`.
- Pre/post snapshots in `backend/runtime/market/baseline_snapshots/`.
- No sharp/soft book classification yet; no truth-anchor yet (deferred).
- API-burn observed, not enforced.

---

## REALISM ECOLOGY DOCTRINE (Phase Realism-Ecology-1A established — still in force)

- Incremental, attributable, calibration-informed.
- Pre/post snapshots in `backend/runtime/calibration_snapshots/`.
- Smallest safe step first.
- LOTTO and SAFE preserved unless explicitly approved.
- No hardcoded under-forcing, no player punishment, no slip rejection.

---

## TIERED LOCK STATE MACHINE (Phase 1F + 1G — preserved)

| Lock age | PID probe | Outcome |
|---|---|---|
| 0–10 min | alive | Honor |
| 0–10 min | dead (ESRCH) | Reclaim |
| 10–30 min | alive | Reclaim with `[INC-015]` warning |
| 10–30 min | dead | Reclaim |
| >30 min | any | Reclaim (hard TTL) |

---

## CANONICAL COMMAND SURFACE

```
# Brain enforcement
npm run brain:bootstrap    npm run brain:continuity    npm run brain:verify    npm run brain:checkpoint

# Slate refresh (Phase Market-1A: populates api_call_log.jsonl)
npm run slate:refresh    npm run slate:nba    npm run slate:mlb

# Engine lifecycle
npm run engine:start    npm run engine:restart    npm run engine:status

# Grading + calibration
npm run grading:run    npm run grading:backfill-all    npm run grading:backfill-all -- --clear-locks
npm run grading:status    npm run calibration:status    npm run lineage:status

# Market intelligence
npm run market:status    npm run market:status -- --sport=nba    npm run market:status -- --top=20

# Persistence
npm run persistence:status    npm run persistence:probe    npm run persistence:backfill-aliases    npm run persistence:import

# Epoch authority
npm run epoch:status

# 14-suite regression
npm run runtime:verify
```

---

## STATE INTEGRITY CHECKLIST (operator pre-flight)

```bash
cd backend
npm run brain:bootstrap        # MANDATORY
npm run brain:continuity       # MANDATORY
npm run brain:verify           # MANDATORY
npm run runtime:verify         # 14/14 PASS expected
node ../probe_grading_backfill_v1.js   # 42/42 PASS
node ../probe_lineage_v1.js            # 24/24 PASS
node ../probe_epoch_authority_v1.js    # 48/48 PASS
npm run persistence:probe              # 22/22 PASS
cd ../frontend && ./node_modules/.bin/tsc --noEmit -p . ; cd ..   # exit 0 expected
```

All probes must pass before declaring work done. brain:checkpoint must be run at end of every operator session.
