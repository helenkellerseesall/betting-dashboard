# THE MAGNITUDE DOC — every lane from here to the machine you're describing
**2026-08-19 ~02:00 ET · written by CA while you shower · your words are the spec: "algorithms on every player/every prop/every sport consistently running to tell me who's worth playing" · "turn winners into bets before they become winners" · "i want to make big, easy money off small bets" · every claim below is either verified against the repo tonight or labeled PROPOSAL**

---

## 0. First: is the code safe? (your integrity question — answered with evidence)

Since the night NFL work began (baseline commit 718255d, 8/16), exactly **five** pipeline
files changed, and I diffed them tonight:

| File | What changed | Formula risk |
|---|---|---|
| brokenFamilies.js | NEW — the containment list (rbis, outs) | Changes what's SHOWN, not how anything is priced. Deliberate, logged. |
| marketPrior.js | NEW — shadow column only | Served payloads verified byte-identical when it landed. Zero effect until graduation, which is YOUR call. |
| lineFreshness.js | One opt-in parameter (Lab batch fix) | Serve default byte-identical. |
| buildPersonalLedger.js | Perf projection (display path) | No pricing involvement. |
| daily3.js | +19 lines: the grading evidence branch (hard-gated through CA, live receipt verified) | Grading honesty improvement; selection math untouched. |

**Zero edits to curves, calibration, weights, G2 exam math, or backend/ml since NFL began.**
The 68/68 fixture matrix pins the formulas — if a change skewed the math, fixtures throw.
NFL itself is capture-only and self-gated OFF until its season flag flips. Your numbers are
not being quietly bent. The two things that visibly changed (broken families dropped from
the board; the redesign) were deliberate, logged, and verified.

---

## 1. The regression you just caught (and you're right)

You used to tap a pick and see WHY — park, wind, batter/pitcher hand, last 5/10, streaks.
Tonight's TONIGHT card shows a name, a line, a book — and asks for your trust. **That's a
real regression and it's item 0 of CB's next pack:** restore a tap-to-expand WHY on every
pick, every surface — the factor lines, plain English, "why this player, why this book, why
this price." A pick without its receipts is exactly the "random people and props" feeling
you described. This comes back first, before anything new.

---

## 2. The lanes (each = a machine that runs nightly without you)

**L1 — WHY restored.** Above. CB pack item 0. Trust surface; everything else sits on it.

**L2 — WHAT'S WINNING board.** The pattern leaderboard: every segment the machine tracks —
record, NET units, trend, distance-to-graduation. Watch tomorrow's bettable edges form.
Queued (CB pack item 1). This is "turn winners into bets before they win," made visible.

**L3 — HR PARLAY TRACK (your MLB endgame, said plainly).** Honest state: on HR longshots
our model does NOT currently beat the closing line — the first weight-fit said "market owns
this band" (w=1). That's measured, not a refusal. So the move: the Lab adds a nightly
**hr_parlay paper ticket** — 3-5 leg HR overs, certified legs, its own record — starting
now, so the HR band builds the exact evidence that flips it live. $5-10 on a 3-5 leg HR
bet netting hundreds is a real payout structure; the only question is whether the picks
carry edge, and a nightly paper ticket answers that with receipts instead of vibes.

**L4 — GAME PAGES (the "Det vs Chi, tell me everything" machine). PROPOSAL, big.** One page
per game: predicted winner + moneyline read · every pitcher prop as a LADDER with the rung
picker you described ("6+ Ks but not 7 → bet the 6 rung, or his ceiling") · every batter's
board (hits, HR, TB, runs, RBI, SB) with our number next to the book's · first-HR/first-score
and inning markets wherever a book posts them. Two honesty rules make this real instead of
fantasy: where we have a calibrated curve, the page predicts with its chest AND shows its
record; where we don't yet, it says "no model yet — building" instead of inventing a number.
The gap list comes from L9. This is the single biggest build on the board and it's the one
that makes the app feel like what you actually wanted.

**L5 — NIGHT-BEFORE BETTING. Honest split:** MLB can't fully do it — next-day prop lines
post late/thin and the measured record says the overnight preview picks different players
than the locked card (betting the preview = betting a worse product). But two real fixes:
(a) **NFL solves this by nature** — Sunday lines are firm Saturday night, so NFL cards lock
SATURDAY EVENING and you bet before bed, asleep through kickoff with money working. Your
schedule and NFL's schedule actually fit. (b) MLB gets an **EARLY CARD trial**: a ~9-11 PM
lock for tomorrow where lines already exist, tracked as its OWN record next to the main one
— if the early card proves it holds up, you bet at night with a clear conscience; if it
bleeds, the record says so and saved you money. PROPOSAL — say yes and it enters the queue.

**L6 — NFL = the season we don't squander. Dates:** capture is live now · curves build from
CC's spec (receptions first) over the next ~2 weeks · **Week 1 (~Sep 4-7): paper picks live**
· Saturday-night lock cadence from the first Sunday · Lab NFL tickets the moment legs
certify · market prior carries Week 1 (by design — tiny early-season data is exactly what
it's for). The goal stated plainly: by mid-season, an NFL board with a receipted record and
Saturday-night bettable cards — not "little tweaks."

**L7 — NBA READY DAY ONE.** You spent months last season and the season ended first — that
doesn't happen again. CC specs the exact markets you named (threes, first baskets/first
scorer, points ladders) in September; capture starts at preseason; paper picks from opening
night in October. The NBA engine exists; this aims it at YOUR markets before the season
instead of during it.

**L8 — HUMAN ELEMENT / HYPE ENGINE.** Your "run all the hype, all the news" ask. Three
ingestible layers, each cheap or free: injuries/lineups/scratches · weather (wind/park —
also feeds the WHY panel) · the hype layer (the parked screenshot-ANALYZE loop revived:
drop any slip you see on Twitter, machine says TAIL or BAIL with reasons, and learns your
taste). One rule keeps it honest: every human-element signal gets the same forward test as
every stat — if "hot streak" predicts, it earns weight; if it doesn't, it dies. CC
researches which signals measurably move outcomes vs which are noise dressed as narrative.

**L9 — FULL PROP-COVERAGE SWEEP.** Your "comb through every prop type each book gives"
offer — accepted, but the machine does the combing: enumerate every market our books post
via the odds API's own catalog, diff against what we price, rank the gaps by your interest
(HR, first-HR, K ladders, SB, innings) × buildability. Output = the L4 build list. You
audit the result on your phone instead of screenshotting sportsbooks at 2 AM.

**L10 — THE BACKBONE (already running, funds the fun).** Market-prior graduation ~Sep 1 ·
Lab gates accumulating nightly · pattern promotions · CLV tracking · receipts + public page
+ Pikkit. The "boring" machine is what proves which exciting bets are real. It stays on.

---

## 3. What this costs you: almost nothing
Run fences when I hand them · eyeball verdicts when packs land · bet the graduated stuff
if you want to. The machines run while you sleep — that's the entire design.

## 4. The two clauses that never bend
No fabricated numbers — a market without a model says so instead of lying. And "predict
with its chest" means with its RECORD on its chest — every prediction surface carries its
own wins and losses where you can see them. That's what separates this from the Twitter
accounts: they delete their losers, yours can't.

*Everything in §0-§1 verified tonight against the repo. §2 lanes marked PROPOSAL need only
your yes. CB + CC kickoff prompts are in the chat, ready to paste.*
