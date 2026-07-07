# THE MOONSHOT MAP — What This Project Could Become, Graded Ruthlessly

**Date:** 2026-07-07 · **Author:** Claude-C (research, Fable 5) · **Mandate:** the outside-the-box map of "the best self-improving sports-betting intelligence ever built by one operator + AI" — every idea graded **REAL / SPECULATIVE / FANTASY**, ranked by realistic edge × buildability × uniqueness.
**Anti-re-derivation:** this doc EXTENDS the standing corpus — strategy deep-dive (07-05), betslip deep-linking (07-06), longshot discovery (06-29), edge menu + integrity (06-15 ×2), parlay playbook (06-11), post-flip game plan (online_findings) — and cites them instead of repeating them. **Source tags:** [REPO] measured here · [AUTH] official/vendor · [PRAC] practitioner · [PRIOR] our own prior cited research.

---

## 0. What "best in history" actually means here

Not the biggest model or the most feeds. The honest claim available to a solo operator + AI is: **the first fully-closed, zero-fabrication self-improvement loop** — *predict → price-shop → bet → capture close → grade → classify the outcome's WHY → retrain calibration on the raw axis → re-select tomorrow* — where every arrow is verified by probes, every settled row is immutable, and the public can audit the record. Most of these arrows now exist in this repo [REPO: G1/G1-Serve/SPINE-FIX/H1, commits 4dca1ab→0a9d52a]. Nobody sells this loop; books can't confiscate it; and it's the one asset that compounds whether or not the edge turns out large. The moonshot is closing the last arrows and never once lying to ourselves inside the loop. Grade of the framing itself: **REAL** — because it claims a *process* superlative, not an edge superlative. The edge remains unproven (ZERO live-bet record as of tonight [REPO]) and this doc grades everything against that fact.

---

## 1. INGESTION FRONTIER — what the machine should be scouring that it isn't

**The honest headline: the frontier is mostly NOT new feeds.** Four blueprint signals are already staged and untested-forward (#25 Statcast-quality, #28 air-density, #29 bullpen, #30 FIP [REPO: mlb_signal_ingestion_track]) — new ingestion ranks BELOW wiring what's staged through forward-CLV tests. That said, graded:

**1.1 Line-velocity / steam detection across our own 6 books — REAL, rank #1 of this section.**
We already store hourly slate snapshots + a 5-minute closing-capture loop + 6 AM trueOpen [REPO]. A velocity layer is pure derivation on data we already own: per tuple (player·market·line·book), compute price-change rate and cross-book synchronization. Synchronized all-book moves = origin (sharp) repricing; single-book lag = the stale outlier our line-shop should pounce on; velocity into close = the CLV predictor. Zero new data, zero ToS exposure, directly feeds the morning-window niche [PRIOR: 07-05 §4] and the CLV-first re-point. Uniqueness MED (Unabated/OddsJam sell this; nobody wires it to a personal calibrated board). Edge contribution honest: it sharpens *timing*, doesn't create edge alone.

**1.2 Scratch/lineup fast-poll — REAL.**
MLB StatsAPI is free and carries probables + lineups; lineups post ~2–4h pre-game [PRIOR: 06-29 daily loop]. Current pulls are slate-cadence; the upgrade is a cheap 5-min poll in the pre-close window diffing lineup cards → scratch/order-change alerts → re-vet affected picks. The books reprice scratches fast, but lineup-DEPENDENT props (batter slot changes) lag more than star-out news [PRAC: prior NBA injury findings generalize weakly to MLB — magnitude honest-unknown]. Buildability HIGH, edge SMALL-but-real, cost ~zero.

**1.3 Umpire assignments (#27, the one staged-track hole) — REAL.**
Assignments surface morning-to-afternoon day-of via free trackers ([RefMetrics](https://www.refmetrics.com/baseball/mlb/umpire-assignments), [RotoWire daily](https://www.rotowire.com/baseball/umpire-stats-daily.php), [Action Network](https://www.actionnetwork.com/mlb/referee-assignments) [PRAC]); zone effects on K/total props are the documented mechanism [PRIOR: 06-15 menu]. Fits the existing staging-file pattern (additive, zero consumers until forward-tested). Small, honest, queued — finish the track.

**1.4 Public-vs-sharp money splits — REAL data, COARSE use.**
These are NOT pure marketing: DraftKings publishes real bets%-vs-handle% splits ([DK Network](https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/) [AUTH]) and VSIN carries DK + Circa feeds updated every 5 minutes ([VSIN splits](https://data.vsin.com/betting-splits/) [PRAC/AUTH]). The catch for us: they cover **game markets (spread/total/ML), not props**. Honest use: (a) bait-detection input for the Public-Bait archetype tag on game-adjacent derivatives (F5/team totals), (b) a fade-the-overreaction context signal [PRIOR: 06-15]. As a prop-selection signal: **SPECULATIVE** — the data doesn't exist at prop granularity, and inferring prop sharpness from game splits is a guess. Ingest the free DK/VSIN game-level table daily; grade its correlation with our CLV before letting it touch selection.

**1.5 Automated social/beat-reporter ingestion — split grade.**
- **X/Twitter automated monitoring: SPECULATIVE-to-DEAD on cost.** 2026 X API is pay-per-use (~$0.005/post read; legacy $200/mo Basic being migrated out) [PRAC: [Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/), [twitterapi.io](https://twitterapi.io/blog/x-api-cost-breakdown-2026)]. Polling reporter timelines at news-speed burns real money for a signal the books ingest faster. Scraping without the API violates X ToS — off the table by our own integrity doctrine.
- **Bluesky Jetstream: REAL and free.** The AT Protocol firehose has no paid tier and no API wall ([Bluesky docs](https://docs.bsky.app/docs/advanced-guides/firehose), [Jetstream](https://docs.bsky.app/blog/jetstream) [AUTH]); many MLB beat reporters cross-post. A filtered Jetstream consumer on a curated reporter list (the 06-15 named-follows list is the seed) → keyword/entity match (player names on today's slate) → alert into the same channel as 1.2. Legal, free, structured. Honest ceiling: minutes-level news advantage on lineup/scratch/role news, sometimes beaten by paid feeds; it's a complement to 1.2, not a replacement.
- **The screenshot pipeline stays the HUMAN social channel** — operator sees, drops, machine grades (§3.1). Automating "read all of betting Twitter" is **FANTASY** (cost, ToS, and sentiment ≠ edge; the structured fact feed above is the real version of this wish).

**1.6 "Data most bettors never see" — mostly already ours.** Air density (#28), Statcast quality buckets (#25), bullpen fatigue (#29), FIP (#30), trueOpen 6 AM prices [REPO] — the differentiation is already in the staging files. The remaining genuinely-underused public sources: umpire zones (1.3) and weather at forecast-hour granularity vs our current pull cadence (check freshness in the wiring pass, not a new feed). **Anything requiring book-site scraping for hidden ids/limits: FANTASY by doctrine** (ToS; and the 07-06 deep-link work just proved the vendor route supplies what we need [PRIOR]).

---

## 2. SOFT-MARKET FRONTIER — ranked by softness × our ability to model it with existing pipes

| Rank | Market | Grade | Why (evidence) | Pipe fit |
|---|---|---|---|---|
| 1 | **MLB derivatives: F5 lines + team totals** | **REAL** | Mechanically-derived openers, documented weak [PRIOR: 07-05 §2 citing Predictem/Logic-of-Sports-Betting]; priced FROM markets we already model (pitcher families) | HIGHEST — same data, same calibration, new market-family grading only |
| 2 | **WNBA props (in season NOW)** | **REAL (pilot)** | Softer than NBA, thin sharp coverage, DK deepest board; winners stand out fast [PRIOR: 07-05 §2 citing Betstamp] | MED — dormant NBA pipeline is the scaffold; needs a WNBA data spine + family map (CC scoped next pass if operator wants) |
| 3 | **Exchanges as execution venue (Novig/ProphetX/Sporttrade/Kalshi)** | **REAL (op-gated)** | No limiting of winners, ~1–2% fees [PRIOR: 07-05 §6.2]; The Odds API already carries `novig`/`prophetx`/`kalshi` in `us_ex` [AUTH: bookmaker list] — we can CAPTURE their prices with one region param before ever holding an account | HIGH for capture; venue access = the still-unanswered operator state question |
| 4 | **Micro-market EXCLUSION list** | **REAL (defensive)** | Single-actor low-limit micro-markets (1st-inning events, specific-batter-vs-pitcher) = high hold, instant limits, integrity-risk zone [PRIOR: 06-29 §5, 06-15 integrity] | Trivial — a blocklist in selection; "what we refuse to bet" is also alpha |
| 5 | **KBO/NPB** | **SPECULATIVE** | PrizePicks-side softness documented [PRIOR: 07-05 pick'em]; but on OUR books only 2–3 carry KBO beyond ML and props are thin [PRAC: [DK KBO](https://sportsbook.draftkings.com/leagues/baseball/south-korean-kbo), search verdict] → line-shop (our core edge mechanism) starves; no free Statcast-class spine (mykbostats ≠ API). Overnight hours fit the 6 AM rhythm, everything else doesn't | LOW — new spine, new calibration corpus from zero |
| 6 | **College baseball / AAA props** | **FANTASY** | Barely offered on regulated US books; tiny limits where they exist; college props are the #1 integrity-flag zone [PRIOR: 06-15 Part 1 — IBIA-flagged categories]. A solo operator does not want to be the sharp fish in a pond regulators are draining | — |

**Section verdict:** the soft-market moonshot is NOT a new league — it's **attaching derivatives to the pitcher model (rank 1) while capturing exchange prices (rank 3) so the CLV benchmark gets a genuinely independent leg** [extends 07-05 origination-cluster finding].

---

## 3. UNIQUE-WEAPON FRONTIER — what nobody else has that we half-possess

**3.1 The screenshot "tail-or-fade verdict machine" — REAL, the most unique thing on this map.**
The pipeline exists: OCR adapter, slip normalizer, slip classifier [REPO: backend/pipeline/screenshots/]. The missing half is the VERDICT: parse any Twitter/Discord slip → resolve each leg against our board (calibrated prob, de-vig fair, line-shop best price, archetype tag, CLV history on that slice) → output TAIL / FADE / NO-EDGE with the four-question plain-English WHY (Law 30 format). Uniqueness: HIGH — @Playbook converts slips into *bets* (a conversion funnel [PRIOR: 07-06]); nobody converts slips into *honest gradings against a calibrated private record*. This is also the audience-path content engine: "you send the hype, the machine tells you the truth" is a shareable product one screenshot at a time [PRIOR: 07-05 §5]. Edge contribution: indirect (it prevents bad tails and generates the record's story; it doesn't create prices). Buildability: HIGH (assembly of existing parts). **Honesty clause hard-wired: when our board has no opinion, say NO-EDGE — a verdict machine that always has a take is a capper, not an instrument.**
**3.2 Closing the self-learning loop (the 10-archetype postmortem → selection) — mechanism REAL, edge SPECULATIVE.**
Today the Session-W classifier tags settled bets post-hoc (good_process_bad_variance, fake_sharp_trap, …) and feeds nothing [REPO]. The closed loop, concretely: nightly job aggregates archetype rates per (family · side · rung-band · book) slice with min-n floors → slices where trap/bad-process archetypes concentrate get selection penalties; slices where suppressed_winner/hidden_sharpness concentrate get review-for-loosening — shipped as a versioned, default-OFF selection prior, forward-gated exactly like G1, retrained on the raw axis per the era rule [REPO: d6b17d1 doctrine]. That IS the "self-improving" in the moonshot title, made real at whatever magnitude the data supports. Grade split is deliberate: the LOOP is buildable now; whether archetype priors add edge beyond calibration+CLV is unproven until forward-tested. Risk to name: double-counting (archetype rates correlate with the calibration signal itself) — the forward gate must test *incremental* Brier/CLV, not standalone.
**3.3 The verified public CLV record as the trust asset — REAL, already doctrine.** [PRIOR: 07-05 §5 — Pikkit/Betstamp external verification; not re-derived here.] The moonshot addition: the record page should show the *loop* (calibration version stamps, archetype postmortems, CLV per slice), not just W/L — that's the "nobody else has this" layer, and it's free because the stamps already exist [REPO: G1-Serve, GRADING_RULES].
**3.4 Promo/boost EV harvesting as the deterministic income floor — REAL.** [PRIOR: 07-05 §4/§7-4; unchanged.] Moonshot framing only: it's the revenue that funds the variance while the record accrues. Build the pricer (boost × our de-vig fair), surface as a daily certain-EV card, track separately from the edge record (mixing promo ROI into the model record would flatter it — a never-cut integrity line, §5).
**3.5 The plain-English WHY on every pick — REAL, ship-polish tier.** Already Law 30 canon; its moonshot value is §3.1/§3.3 leverage (content + auditability), not edge.

---

## 4. SURVIVAL FRONTIER — limit-avoidance as a first-class feature

All REAL, none create edge, all protect the record's lifespan [extends online_findings A2/A3 — cited there, not re-derived]:

- **Stake camouflage in the product, not the head:** the /m execution card (in flight [REPO: CB block 07-06]) should *suggest* round-number stakes and *never display exact-Kelly amounts* — doctrine already written [PRIOR: A2/playbook §4]; make the UI enforce it so discipline isn't memory-dependent.
- **Book-rotation scheduler:** per-book weekly volume/stake budget with a simple traffic-light on each book button ("cool off DK this week"). Data already in personal_ledger; trivial aggregation. Extends the deep-link card naturally.
- **Bet-timing jitter:** never bet the same minute-offset from line-post daily; the morning-window niche makes us *systematically early*, which is exactly the CLV-flag pattern [PRIOR: A2 — beating the close IS the flag]. Jitter within the soft window costs little EV and buys account weeks. SPECULATIVE on magnitude (no public data on detection thresholds — books don't publish them), REAL on cost-benefit asymmetry.
- **Exchange migration path:** when book X limits, its volume shifts venue — which requires the §2 rank-3 capture work done BEFORE limits arrive, not after. The record continues uninterrupted because the record is ours, not the book's (the whole point of the spine [REPO: 27a5b08]).
- **Bankroll disaster-recovery:** segregated bankroll, KYC-early, small regular withdrawals, credentials hygiene [PRIOR: A3 — done research, partially done ops]; the addition: a written "account death runbook" (what happens to open bets, pending withdrawals, and the record when a book locks you) — one page, CA can draft it from A2/A3.
- **What stays FANTASY here:** multi-accounting, others' accounts, VPN state-hopping — ToS/legal violations; permanently out by doctrine regardless of edge [PRIOR: A2 ethics line].

---

## 5. CORNERS — CUT vs NEVER CUT (named current practices)

**CUT (speed beats polish for a solo operator):**
- The vestigial /status G1 readiness card (already flagged for retirement [REPO: CB block 07-06]) and cosmetic /status layout debt — display polish on operator-only surfaces.
- cockpit port 4001 (defined, inactive [REPO: RUNTIME_FACTS]) — delete-class item, not maintain-class.
- MASTER_BRAIN's giant historical session blobs — lineage, not operating doc; stop grooming, never re-read past the CURRENT sections (this is a reading-discipline cut, not a delete).
- NBA off-season pipes — leave dormant until October; zero maintenance.
- New-sport/new-league expansion (KBO, college, NFL-prep) before the MLB record exists — §2 grades stand.
- Exact-Kelly staking sophistication — flat small stakes are CORRECT for the 90-day record phase [PRIOR: post-flip cadence]; portfolio-optimizer polish waits.
- Multi-file FE architecture dreams — the single-file /m PWA is fine; it ships.

**NEVER CUT (each one, if cut, quietly destroys the record's meaning):**
- **The raw-axis era rule** on every retrain (calibration-on-calibration = the silent death of honesty; now code-owned [REPO: d6b17d1] — never bypass "just this once").
- **Settled-row immutability + version stamping** (GRADING_RULES v1 locked [REPO: 475d810]); model improvements change FUTURE selection only.
- **Diff-before-land on PRESERVED files + operator sign-off** — the H1/SPINE pattern [REPO: 0a9d52a, 27a5b08] is the collaboration contract.
- **runtime:verify green before "done"** (25/25 tonight) and probe-output-or-it-didn't-happen (Law 13).
- **Display honesty as a trust layer:** the lingering uniform-82% hits-unders FE bug [REPO: CB block 07-06 queue] is NOT cosmetic-cut class — a wrong probability shown to the bettor is a fabrication in the one place it matters most. Fix-class, always.
- **Deep-link buttons labeled at real depth** ("Add to slip" vs "Open game") [PRIOR: 07-06 §3].
- **Promo ROI segregated from model-edge ROI** (§3.4) — one blended number would be marketing, not measurement.
- **NO-EDGE as a first-class verdict** everywhere (board, screenshot machine, daily card): "few or none today" stays an honest output [PRIOR: 06-29 §4].
- **The log/commit protocol itself** — the repo is the only channel; an unlogged build is an invisible build [REPO: bridge doctrine].

---

## 6. TOP-5 DO-NEXT (for CA triage — sequenced around in-flight work: deep-link execution card and N1→G4 stay in their lane)

1. **Line-velocity/steam layer on our own captures** (§1.1) — REAL · zero new data · feeds the morning-window niche AND the CLV-first re-point; ship as read-only /status card first (measure), selection input only after a forward look. [CB, small-med]
2. **Close the self-learning loop v0** (§3.2) — REAL mechanism · versioned default-OFF archetype-prior job + forward gate spec; the title deed of "self-improving." [CA spec → CB; gate before any live effect]
3. **Scratch fast-poll + Bluesky reporter Jetstream** (§1.2 + 1.5) — REAL · free · one alerting channel, two sources; curated list seed from 06-15 named-follows. [CB, small]
4. **Screenshot tail-or-fade verdict machine v1** (§3.1) — REAL · highest uniqueness · assembles existing OCR + board + line-shop into the product's signature move; NO-EDGE verdict hard-wired. [CB, med]
5. **Promo/boost EV pricer + umpire #27 rider** (§3.4 + 1.3) — REAL · the deterministic floor + the last staged-signal hole. [CB, small]

*(Deliberately absent: KBO/college (§2.5–2.6 grades), X API ingestion (§1.5 cost), SGP-edge chasing and live in-game (settled FANTASY [PRIOR: 07-05 §6.9]), any form of automated bet placement (forbidden, permanently).)*

**Deep-link probe honesty note (read-first finding):** the 07-06 rider probe ran on the Mac (quota headers real, links-params cost 0 on that call) but hit a nearly-finished game — all 6 books absent ⇒ **inconclusive on per-book link depth, timing artifact, not a verdict**; re-run pre-game on the 07-07 slate before the execution card assumes any depth tier [REPO: .scratch/deeplink_probe.txt].

---

## Sources

**Repo/prior (not re-derived):** docs/research/2026-07-05-repo-state-and-strategy-deepdive.md · 2026-07-06-betslip-deeplink-feasibility.md · 2026-06-29-mlb-daily-longshot-discovery.md · 2026-06-15-parlay-edge-menu-and-integrity.md · 2026-06-15-prop-parlay-craft-playbook.md · 2026-06-11-parlay-ladder-playbook.md · docs/research/online_findings.md (A2/A3/post-flip) · commits 0a9d52a/d6b17d1/27a5b08/6baf92d/475d810 · .scratch/deeplink_probe.txt · memory: mlb_signal_ingestion_track.

**Web (new this doc):**
- [Postproxy — X API pricing 2026 (pay-per-use default)](https://postproxy.dev/blog/x-api-pricing-2026/) · [twitterapi.io — X API cost breakdown](https://twitterapi.io/blog/x-api-cost-breakdown-2026) [PRAC]
- [Bluesky — Firehose docs](https://docs.bsky.app/docs/advanced-guides/firehose) · [Bluesky — Jetstream](https://docs.bsky.app/blog/jetstream) [AUTH]
- [VSIN — betting splits (DK + Circa feeds, 5-min updates)](https://data.vsin.com/betting-splits/) · [DK Network — DraftKings betting splits](https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/) [AUTH/PRAC]
- [RefMetrics — daily MLB umpire assignments](https://www.refmetrics.com/baseball/mlb/umpire-assignments) · [RotoWire — daily umpire stats](https://www.rotowire.com/baseball/umpire-stats-daily.php) · [Action Network — MLB umpire assignments + records](https://www.actionnetwork.com/mlb/referee-assignments) [PRAC]
- [DraftKings — KBO board](https://sportsbook.draftkings.com/leagues/baseball/south-korean-kbo) [AUTH] · KBO/NPB coverage search verdict (2–3 books beyond ML; props thin) [PRAC]
