# THE FULL PICTURE — State, Strategy, and Your Playbook
**2026-07-30 · written by CA for the operator · successor to STATE_AND_STRATEGY_2026-07-05 · every number below traces to a repo file, probe, or commit — nothing estimated**

---

## 1. THE SHORT ANSWER — what you should actually do each day

**Yes: the locked Daily 3 is the thing to bet.** It is the only surface with a
positive, honestly-measured record: **23-7-3P, +7.06 units at flat $1, 76.7%
hit rate over 11 graded nights** (after the accent-bug repair surfaced three
hidden wins). Everything else on the board is either raw material (not
bet-ready by design) or still caged behind gates.

**Your daily loop, as of today:**
1. **At wake (~4 PM):** open the app. The locked card has been posted since
   ~noon. Bet the picks whose games HAVEN'T started yet — on night-heavy
   slates that's usually 2 or 3 of the 3. Skip any that already started.
   (Section 4 has the permanent fix for the noon-lock problem.)
2. **Betstamp tap (~2 min, optional but it feeds the proving clock):** log the
   locked picks publicly before their games start.
3. **Bet small.** The record is the product right now, not the profits.
   Real-money scale waits for the 90-day CLV/ROI gate — that is doctrine, not
   caution for its own sake.
4. **Do NOT bet the midnight "TOMORROW" preview list.** It now says so on the
   board itself. Last night proved why: the preview 3 went 1-2 while the
   locked card picked different players.

---

## 2. What every surface is, and its real record

| Surface | What it is | Measured record |
|---|---|---|
| **Locked Daily 3** | 3 picks locked 60 min before the slate's first pitch, write-once, receipt-chained | **23-7-3P · +7.06u · 76.7% · 11 nights · 5 of 11 nights went perfect 3-0** |
| **TOMORROW preview** | Early candidates captured at night, before lines firm | **Not separately measured yet** — I am queueing that measurement; until then it is explicitly not bet-ready |
| **TOP PICKS board** | Everything that survives the hard gates tonight, full breadth | Tracked pick-by-pick (every serve), graded nightly; the raw un-curated version of this loses (next row) |
| **Raw scanner (paper)** | Every rung the scanner would buy with no curation | **−270.08u on paper** over its current 14-night window (12 nights in) — it is SUPPOSED to look like this; it's the control group proving the gates earn their keep |
| **Your real bets (MY BETS)** | What you actually staked | **4W-4L · +$31.74 lifetime · $22 real risked** (bonus credits excluded) |

**"Are we tracking all the other stuff?" — yes, at a scale you may not have
realized:** 135,285 paper bets in the closing-line tracker, ~5,000-8,000
graded prop rows per slate, and a 934,672-pair correlation corpus across 42
slates. Nothing the board shows goes unmeasured.

**"What's winning that ISN'T shown?"** Also measured, every night: the critic
attributes missed-winner volume by which gate blocked it (7/28 audit: ~3,128u
of gross missed-winner volume — gross, not net of the losers those same gates
also blocked; the ceiling audit says the gates only cost ~1.9% of realizable
ceiling). One earlier fix already recovered 43 of 50 winners trapped by a
pricing bug. Your Hard Rock field-check errand is still the key to unlocking
54 more known winners.

---

## 3. The money question — "Daily 3 isn't making much. Do I group more together?"

Straight math on what you're feeling: three −200 singles at $1 each win about
$1.43 on a perfect night. That's proving-phase money, deliberately.

**Parlaying the locked 3 together:** a 3-leg parlay of −200 legs pays about
+237. Break-even there is 29.7% of nights perfect; the record's observed rate
is **5 of 11 (45%)**. So the observed record says a small nightly parlay of
the locked card would have been solidly profitable — BUT 11 nights is a tiny
sample and I will not pretend it's proof. Honest verdict: a **small flat-stake
parlay of the locked 3 alongside the singles is a defensible test**, sized
like a test (a dollar or two), not like a conclusion.

**"If so, what should I group?"** The machinery to answer this properly
already exists and is mid-exam: the pair corpus knows which legs correlate
(wins that travel together and losses that do), and the **parlay pricer is
running its paper gate right now** (needs 14 nights / 100 decided / +3pp
edge before it may touch real suggestions). When it passes, the app itself
starts proposing groupings with measured correlation behind them. Until then,
any grouping beyond "the locked 3 together" is vibes, and we don't bet vibes.

**Bigger picture on making money:** the era's honest sequence is record →
proof → scale. The +$31.74 is not the product. The 76.7% documented hit rate
is. The research was unambiguous: winners get limited by the books; the
durable asset is the proven record — which is why the receipts, the public
page, and Betstamp matter as much as tonight's profit.

---

## 4. The timing problem — real, structural, and fixable

I measured it: **10 of the 12 locks so far happened between 11:11 AM and
3:12 PM ET — while you're asleep.** This is not bad luck; the card locks 60
minutes before the SLATE's first pitch, and most days some game starts around
1 PM. Your instinct to bet the night before was a rational response to a
product that ignores your clock. But the preview list is measurably not the
locked card, so the fix has to come from the product, not from you.

**Proposed fix (needs your yes, then it's a CB build):** restrict the Daily 3
pick universe to games starting **6 PM ET or later**. The lock then lands
~5-8 PM ET — you're awake, every pick is still bettable, the single public
record continues unbroken (no forked history), and day games simply leave the
pool. Cost: a somewhat smaller candidate pool on day-heavy slates and no card
on the rare all-day-game slate. My recommendation is yes — a record you can
never act on is a résumé, not a strategy.

**Until that ships:** the wake-at-4 loop from Section 1 covers most nights,
since most picks land in night games anyway.

---

## 5. The machine, in one paragraph each

**Machine 1 — the board.** Ingests seven books' lines hourly, strips the vig,
runs role/gameflow/trust/integrity hard gates, then tuners, and serves what
survives with plain-English reasoning. Serve-time revalidation now re-checks
every card against the freshest snapshot (moved/drifted/suspended lines get
badged, never silently served).

**Machine 2 — the record.** Everything served is tracked; everything tracked
is graded nightly against official box scores (the accent bug that silently
starved this for weeks is fixed and back-graded); closing lines are captured
for CLV; your real bets live in a write-once ledger with book-truth
settlement; the Daily 3 locks, receipts, and publishes itself.

**Machine 3 — the critic.** Every night at ~5:40 AM it audits the other two:
what won, what lost, what was missed and which gate blocked it, whether
served-line movement cost units, and it classifies settled bets into process
archetypes so a good-process loss never gets mistaken for a bad pick.

**The gates calendar (what you're actually waiting on):**
- **Scanner cure columns:** 12 of 14 nights in — reads out in ~2 nights.
- **N1 median instrument:** dual-scoring ~610 tuples nightly at 17:30, mid-window.
- **Parlay pricer paper gate:** running (14n/100 decided/3pp bar).
- **When they read green (~early August), you decide the flips.** Green
  unlocks: new stat families (steals, doubles, triples, total bases, RBIs
  are wired and deliberately caged at STOP), the market-probability prior
  (the biggest modeling upgrade on the docket), and CLV-first re-pointing.
  That is the honest answer to "the picks are dull": 33 of 36 Daily 3 picks
  so far are unders because that's where the proven edge lives TODAY; variety
  arrives via passed exams, not decoration.

**Confirmed never-build (research-graded, so you never wonder):** AI picking
games (benchmarked: four frontier models, none beat the market), live/in-game
betting, model zoos, staking systems as edge.

---

## 6. The proving clock

Receipts: live since yesterday — every lock writes a tamper-evident,
hash-chained receipt; git double-stamps it. Public page: built (/daily3 on
your domain), losses shown as loudly as wins, currently visible only to you
until a 5-minute Cloudflare errand opens exactly that page. Betstamp: your
account + a nightly 2-minute tap adds third-party timestamps. n=300 at 3/day
is ~100 days — the calendar itself is the marketing plan. Nothing is for sale
before the 90-day CLV/ROI gate, and the page says so on its face.

**Your open errands, all optional-timing:** Betstamp account · Cloudflare
bypass for /daily3 (when you want it public) · Hard Rock format field-check
(unlocks 54 known winners).

---

## 7. Who does what (so the three chats never confuse you again)

**CA (this chat)** scopes, verifies everything off the repo with real probes,
and brings you decisions — it never edits code. **CB** builds: audit → ASK
with consequences → your GO through CA → build → verify → hand back. **CC**
researches outside-in and drops cited findings. The repo is their only
shared channel; every claim you act on has been independently verified by a
second chat. Every turn ends with one clear next thing. When gates read
green, each flip is presented to you with numbers in hand — you decide.

---

*Verification note: figures in this doc were pulled 2026-07-30 ~01:30 ET from
the live tracking files, component health sidecar, Daily 3 cards, and ledger
of the mounted repo, after the diacritic regrade. Where something is NOT yet
measured (preview-board performance), this doc says so rather than guessing.*
