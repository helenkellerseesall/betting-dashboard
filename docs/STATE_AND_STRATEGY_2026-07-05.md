# STATE + STRATEGY SNAPSHOT — 2026-07-05 (model switch: Opus 4.8 → Fable 5)

**What this is:** a point-in-time state + honest-strategy memo written by Claude-A as the operator switches the CA/CB/CC chats to Fable 5. It is NOT a canonical authority — the brain docs remain authoritative. It exists to (a) give a fresh chat a rock-solid cold start and (b) preserve the honest strategic picture across the model switch.

## READ-ORDER for a fresh chat (rock-solid onboarding)
1. THIS file (state + honest strategy + open questions).
2. Claude memory `MEMORY.md` (index) — esp. START HERE + `[[project-post-flip-build-queue]]` + `[[product-parlay-craft-vision]]`.
3. `backend/runtime/brain/`: MASTER_BRAIN → OPERATOR_PROTOCOL → ACTIVE_INCIDENTS → PIPELINE_AUTHORITY_MAP → ARCHITECTURE_LAWS → SPORTSBOOK_CONTRACTS → MODEL_EVOLUTION_LOG.
4. `OPERATOR_SESSION_LOG.md` (tail — newest ## Claude-A/B/C blocks; latest = the G1 flip 07-01 + persistence re-scope 07-05).
5. `PRODUCT_VISION.md`, `BUILD_LOG.md`, `docs/POST_FREEZE_25TH_RUNBOOK.md`, `docs/research/` (CC's playbooks).

**Roles:** CA = coordinator/analyst/reviewer (does NOT edit code; reviews from the repo). CB = builder (edits/commits/signs ## Claude-B). CC = online research (writes docs/research/ + online_findings.md). Channel between chats = the repo (commit + log block). Operator is NOT the courier.

## WHERE WE ARE (07-05 — honest technical state)
- **G1 calibration FLIPPED ON (07-01, `MLB_CALIB_LIVE=1`).** Forward gate PASSED on 14 out-of-sample days: raw model claimed ~26% where reality was ~11% (wildly overconfident on overs) → calibrated to 10.6% vs 10.8% realized; Brier .102→.079; 11/12 families better. Calibration DRIVES BOARD SELECTION (verified real: OFF modelProb 0.42 → ON 0.14, ranking changed).
- **BUT it does NOT yet reach the operator surface (CB commit 3b15fc0).** The calibrated board (`buildMlbBestBetsBoard`→`makePlay`) and the best-available SERVED surface (`safeBest`/`bestRows` → `/api/best-available` → `tracked_best`) are SEPARATE pipelines. What the operator SEES, BETS, and what the 14-day self-grader measures still carry the RAW probability. Real follow-up (bigger than first scoped): inject calibrated modelProb + stamp onto the best-available serializer (near server.js:6231 / the /api/best-available MLB builder — check PRESERVED status first), gated, diff-before-land.
- Security: backend tunnel LOCKED (Cloudflare Access, 06-29).
- Corpus fix (H1: outcome_snapshots.model_prob 91% NULL): audited, JSON-sourced fix scoped, QUEUED behind the chain.
- Graduation chain: G1 done (board only); N1 (mean→median) / G2 (NB ladder) / G3 (correlation) / G4 (parlay) / selection re-point — NOT started.
- **Bets tracked in the calibrated era: ZERO. No live CLV record yet.**

## THE HONEST STRATEGIC PICTURE (operator asked for brutal honesty, 07-05)
- **Trustworthy ≠ profitable.** Calibration removed FAKE edge; it did not create a real one. No profitable edge has been demonstrated. Prior research verdict: there is NO independent sharp prop line to copy; the only real retail edges are line-shopping soft books, fading market overreactions, obtainable-rung CLV, and promos. Realistic ceiling = low-single-digit-to-~10% ROI on turnover, capped HARD by books limiting/banning winners, and only provable over 300–500+ bets.
- **The "hit it BIG once" dream = a lottery.** The All In Abe HR-parlay screenshots are survivorship (winners posted, losers buried); a $50→$112k parlay is ~1-in-2,200. It is not engineerable. A life plan (quit the job, move to Cali) built on hitting one is a hope, not a plan — and saying so is the honest job.
- **The realistic wealth path = the media/selling business** — which is what All In Abe ACTUALLY does. His income is selling picks to an audience; the bets are the marketing. The route to real money here is: model + a verified public CLV track record → audience → sell. The money is the content/product business; the model is the credibility engine. Honest, real, and it needs the SAME first step as the grind: prove the edge.
- **GUARDRAIL (wellbeing + honesty):** do NOT quit anything or plan the move on betting hope. Prove the edge live (CLV over hundreds of bets, months) FIRST. Be genuinely prepared for the honest answer that the edge is too thin to matter — and if it is, say it plainly.

## OPEN STRATEGIC QUESTIONS — the CC (Fable 5) deep-dive mandate
1. **Is MLB props even the right surface?** Is another sport or prop type genuinely MORE exploitable for a small, limit-capped bettor (NBA usage-redistribution lag, NFL, player-props vs game markets, alt-lines, live/in-game)? Rank candidates by realistic edge × obtainability × limit-resistance.
2. **Are we scoring the right thing?** Is calibrated-modelProb-vs-line the right selection signal, or is the actual edge CLV-first / line-shop-first (the research leans this way)? Should selection re-point to obtainable CLV+ rungs NOW rather than after the whole chain graduates?
3. **Where is the single most exploitable, repeatable niche** — the one thing worth going deep on and owning?
4. **Is the honest endgame the grind or the audience/selling business** — and if selling, what must the repo build (a public, shareable, verified track record; a picks feed; a CLV scoreboard others can see)?
5. **What are we NOT looking at that we should be** — data, signals, market microstructure, the operator's Twitter screenshots as a pattern source?

**Deliverable:** a cited, honest, prioritized report — brutal about edge vs variance, generative about the real opportunities, ending with a ranked "do this next" that could actually move the needle toward real money (or honestly conclude where it can't).
