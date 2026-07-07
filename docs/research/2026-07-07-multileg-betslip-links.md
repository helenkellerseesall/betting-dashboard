# Multi-Leg Betslip Link Composition — Per-Book Syntax, Verified vs Unknown

**Date:** 2026-07-07 · **Author:** Claude-C (research, Fable 5) · **Extends:** `docs/research/2026-07-06-betslip-deeplink-feasibility.md` (single-leg feasibility; not re-derived) + the LIVE probe v2 results (`.scratch/deeplink_probe.txt`, run pre-game 07-06/07 on the Mac [REPO]).
**Question:** given per-outcome SIDs/links from The Odds API (`includeSids`/`includeLinks`), what is the verified syntax to open a 2–4-leg slip per book?
**Honesty bar:** CONFIRMED = official docs or live observed URLs. PARTIAL = mechanism proven, exact syntax inferred. UNKNOWN = labeled as such — the templates below exist so a 2-minute phone tap turns UNKNOWN into a verdict. **Source tags:** [REPO] · [AUTH] · [PRAC] · [PRIOR].

---

## 0. What the live probe already established (inputs to composition)

Probe v2 (pre-game, real quota headers) returned per-outcome artifacts per book [REPO: .scratch/deeplink_probe.txt]:

- **FanDuel** — outcome link `…/addToBetslip?marketId=42.590522831&selectionId=84731375` (props AND h2h). Inputs per leg: `marketId`, `selectionId`.
- **DraftKings** — outcome link `sportsbook.draftkings.com/?outcomes=0QA349298753%232204871575_13L84240Q1-1570309299Q20` (prop) / `?outcomes=0ML85398709_3` (h2h). The **sid IS the outcomes token**.
- **BetMGM** — outcome link `sports.{state}.betmgm.com/en/sports?options=19768145-1539627759-2243928606&type=Single`. The single-leg link itself carries the full `{fixtureId}-{marketId}-{optionId}` triplet (sid alone = optionId only) → composition requires **parsing the triplet out of the vendor's single-leg link** (trivial regex). Note: MGM was ABSENT on the props call at probe time, present on h2h — availability varies by market/hour.
- **Hard Rock** — outcome link `app.hardrock.bet/?deep_link_value=betslip/3858096551683555634`. One opaque sid per outcome.
- **BetRivers** — vendor returns a **template with placeholders we fill**: `https://{state}.betrivers.com/?page=sportsbook#event/{eventId}?coupon={pickType}|4249387048|{wagerAmount}` — Kambi coupon syntax, `pickType` and `wagerAmount` ours to supply.
- **Fanatics** — sids present, links `(none)` at every level, `bookmaker.link` also none → **no link surface at all today**; record-only book (matches 07-06 NOT-NOW verdict [PRIOR]).

---

## 1. Per-book multi-leg verdict table

| Book | Multi-leg verdict | Syntax | SGP (same-game) note |
|---|---|---|---|
| **BetMGM** | **CONFIRMED — officially documented** | Cross-game combo: comma-chained triplets — `?options={fx1}-{mkt1}-{opt1},{fx2}-{mkt2}-{opt2}&type=combo` (docs show `type=combo` and `type=COMBO`; stake prefill supported) [AUTH: [MGM deep-link docs](https://sportsapi.wv.betmgm.com/restapi/generatedeeplink.html)] | **Separately documented, different syntax:** SGP legs chain with `~`, intra-leg fields with `_`, and a `pickGroupId` GUID must sit after fixtureId, IDENTICAL in each leg: `{fx}_{guid}_{mkt}_{opt}_{isClassicBetBuilder}~…`; mixable with `,`-singles; Sportcast BetBuilder format is separate and **cannot combine** [AUTH]. Whether arbitrary standard-market options are ACCEPTED as SGP legs via URL = UNVERIFIED — phone test |
| **FanDuel** | **PARTIAL — array syntax observed at index 0, index ≥1 inferred** | `addToBetslip?marketId[0]={m1}&selectionId[0]={s1}&marketId[1]={m2}&selectionId[1]={s2}` — the indexed live URL `…addToBetslip?marketId%5B0%5D=…&selectionId%5B0%5D=…` exists in the wild [PRIOR: 07-06 sources]; QuickSlip demonstrably prefills **parlays and SGPs** at FD via partner links [PRAC: [Action Network](https://www.actionnetwork.com/education/action-network-quickslip-how-it-works-more)] → multi-leg prefill mechanism EXISTS; exact multi-index acceptance = phone test | Same-event selections may load as singles, trigger the SGP flow, or conflict — FD's SGP is a separate pricing engine; treat SGP as UNKNOWN until tapped |
| **DraftKings** | **PARTIAL — param exists, separator UNKNOWN** | `?outcomes={token}` confirmed live for one leg [REPO]. Multi-leg separator publicly undocumented (search verdict [PRAC]); comma is the natural first test. **Deterministic 5-min resolution:** build a 2-leg slip in the DK app → native Share → inspect the generated URL → the separator reveals itself; then we mint identical links from vendor sids | DK SGP/SGPx is its own product; prop tokens (`0QA…#…` format) vs ML tokens (`0ML…`) already differ — same-game composition = UNKNOWN, phone test |
| **BetRivers (Kambi)** | **PARTIAL — coupon template in hand, combination values UNKNOWN** | Vendor hands `#event/{eventId}?coupon={pickType}|{outcomeId}|{wagerAmount}`. Kambi vocabulary suggests `pickType` ∈ single/combination-class values; multi-outcome plausibly a list in the outcomeId slot. No public Kambi docs [PRAC: search verdict]. Test ladder: (1) `coupon=single|{id}|` one leg, (2) `coupon=combination|{id1},{id2}|`, (3) cross-EVENT legs may need a different anchor than `#event/{eventId}` — flag | Kambi SGP exists on BetRivers but its coupon encoding is fully UNKNOWN |
| **Hard Rock** | **UNKNOWN — single confirmed, multi untested** | `?deep_link_value=betslip/{sid}` works per vendor [REPO]. Multi: try `betslip/{sid1},{sid2}` — pure speculation, labeled as such | Proprietary platform; SGP encoding unknown |
| **Fanatics** | **NONE** | No links at any level [REPO]. Record-only; revisit if the vendor adds links | — |

**The SGP vs straight-parlay distinction, stated plainly:** cross-game parlays are the safe composition target — each leg is a standard independently-priced outcome, and every mechanism above (comma, array-index, token-list) is built for exactly that. Same-game combos run through a DIFFERENT pricing engine at every book (correlation-priced; MGM makes this explicit with a distinct `~`/GUID syntax [AUTH]); a URL that naively lists two same-game outcomes may be rejected, silently dropped to one leg, or re-priced into an SGP whose odds differ from any product of the legs. **The /m execution card should compose cross-game multi-legs only, v1; same-game pairs stay two taps (or wait for verified SGP syntax per book).** This also matches the model reality: our G3 correlation engine is shadow — we shouldn't be pushing SGP slips before the engine that prices them graduates [REPO: graduation chain].

---

## 2. Test-link templates for CB (fill `{…}` with real probe SIDs; operator phone-taps each; record works/partial/fails per book)

All templates compose from artifacts The Odds API already returns — zero scraping. URL-encode where noted. Do NOT prefill stakes anywhere (human sizing + round-number discipline [PRIOR: survival doctrine]; MGM `&stake=` exists but skip it).

**FanDuel — 2-leg cross-game** (brackets URL-encoded `%5B0%5D` etc.):
```
https://sportsbook.fanduel.com/addToBetslip?marketId%5B0%5D={m1}&selectionId%5B0%5D={s1}&marketId%5B1%5D={m2}&selectionId%5B1%5D={s2}
```
**DraftKings — separator discovery first** (operator: 2-leg slip in DK app → Share → paste URL into the log), then candidate:
```
https://sportsbook.draftkings.com/?outcomes={token1},{token2}
```
(tokens = vendor sids verbatim, URL-encode `#` as `%23` in prop tokens)
**BetMGM — 2-leg cross-game combo** (triplets parsed from each single-leg vendor link; state base from operator's state):
```
https://sports.{state}.betmgm.com/en/sports?options={fx1}-{mkt1}-{opt1},{fx2}-{mkt2}-{opt2}&type=combo
```
**BetMGM — SGP probe (2 same-game legs; GUID minted once, identical in both; expect possible rejection — that's a finding, not a failure):**
```
https://sports.{state}.betmgm.com/en/sports?options={fx}_{guid}_{mkt1}_{opt1}_false~{fx}_{guid}_{mkt2}_{opt2}_false&type=COMBO
```
**BetRivers — ladder (single → combination):**
```
https://{state}.betrivers.com/?page=sportsbook#event/{eventId}?coupon=single|{outcomeId}|
https://{state}.betrivers.com/?page=sportsbook#event/{eventId}?coupon=combination|{outcomeId1},{outcomeId2}|
```
**Hard Rock — ladder (confirmed single → speculative multi):**
```
https://app.hardrock.bet/?deep_link_value=betslip/{sid1}
https://app.hardrock.bet/?deep_link_value=betslip/{sid1},{sid2}
```

**Recording the verdicts:** one row per template in the log block after the tap session — book · template · opened where (app/web) · legs loaded (0/1/2) · odds matched board (y/n). That table, not this doc, becomes the canonical composition matrix. Templates that fail multi fall back to the 07-06 single-leg ladder (link per leg, operator assembles the slip in-app — still one tap per leg, still no manual search).

---

## 3. ToS notes (delta from 07-06 — unchanged foundations, two additions)

Foundations unchanged [PRIOR: 07-06 §4]: deep links are the books' own affiliate funnel; all ids come from our paid vendor (zero scraping); the operator always reviews the slip and taps Place Bet — no automated placement, ever.

Additions specific to multi-leg:
1. **Skip stake prefill** even where documented (MGM `&stake=`): a URL that arrives with selections AND stake pre-set looks like automation and removes the human-sizing checkpoint. Selections yes, money no.
2. **DK share-link inspection is clean:** using the app's own Share feature on our own slip to learn the URL format is ordinary user behavior, not reverse-engineering of a protected system; the resulting links we mint carry vendor-supplied tokens only.

---

## 4. Build implications (for CA triage — small, sequenced behind the in-flight EXEC-CARD)

1. The EXEC-CARD (d63c0a1, in flight) records single bets — multi-leg link composition is a **Part-2 add** to the same card: when the operator marks 2+ picks, offer per-book "open as slip" links for the books where composition verified.
2. Composition helper = pure function per book (parse vendor single-leg artifacts → compose per §2 syntax) + the verified-matrix gate: books stay single-leg-ladder until their template passes the phone test. Kill-switched, OFF = no composed links, per house pattern.
3. The phone-tap session needs ONE pre-game slate with MGM/BetRivers present on props (probe when books are fullest, morning) — pair it with the already-queued probe re-runs.

---

## Sources

- **Live probe (the ground truth this doc composes from):** `.scratch/deeplink_probe.txt` — pre-game run, 4–6 books returning, per-book outcome links + sids + quota headers [REPO]
- [BetMGM partner docs — Generating Deep Links (multi-selection `,` + `type=combo`; SGP `~`/`_`/pickGroupId GUID; Sportcast BetBuilder non-combinable; stake/currency params)](https://sportsapi.wv.betmgm.com/restapi/generatedeeplink.html) [AUTH]
- [The Odds API — deep links release (includeLinks/includeSids)](https://the-odds-api.com/releases/deep-links.html) [AUTH] — vendor contract for every artifact used here
- [Action Network — QuickSlip works for parlays and SGPs](https://www.actionnetwork.com/education/action-network-quickslip-how-it-works-more) [PRAC] — proof multi-leg prefill exists at FD-class books via partner links
- Live indexed FanDuel array-form URL (`marketId%5B0%5D`) [PRIOR: 07-06 sources list]
- DK `?outcomes=` multi-leg separator: **no public documentation** (search verdict, 2026-07-07) [PRAC] — hence the share-link discovery step
- Kambi coupon syntax: **no public docs** (search verdict) [PRAC] — hence the coupon ladder
- `docs/research/2026-07-06-betslip-deeplink-feasibility.md` [PRIOR] — single-leg verdicts, PWA tap mechanics, fallback ladder, ToS foundations
