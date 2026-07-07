# Sportsbook Betslip Deep-Linking — Per-Book Feasibility for the /m Surface

**Date:** 2026-07-06 · **Author:** Claude-C (research, Fable 5) · **Mandate:** tap a pick on the /m PWA → the book's app/site opens with the bet (or at least the market) prefilled — for FanDuel, DraftKings, BetMGM, Fanatics, Hard Rock Bet, BetRivers. What the @Playbook-style products actually do; per-book verdict; ToS notes; honest fallback design. **No code — research + a verification probe for CB.**
**Source tags:** [REPO] measured in this repo · [AUTH] vendor/official docs · [PRAC] practitioner source. Confidence labeled per claim.

---

## 0. Bottom line

**This feature is one API parameter away, not a scraping project.** The Odds API — our existing paid vendor — ships `includeLinks=true` + `includeSids=true` on the same `/odds` and `/events/odds` endpoints we already call: per-bookmaker **event links, market links, and outcome-level betslip links** where available, plus the book's own source IDs ([The Odds API deep-links release](https://the-odds-api.com/releases/deep-links.html) [AUTH], HIGH). Their own docs example is literally a FanDuel MLB `addToBetslip` outcome link. Our fetchers pass neither parameter today (grep across `backend/`: zero hits for `includeLinks|includeSids|addToBetslip` [REPO], HIGH).

**The @Playbook-style products are links, not magic.** Action Network's QuickSlip and its Playbook bot (X/Discord: tag @Playbook under a pick → get a link → "clicking the generated link opens the bettor's sportsbook app with the wager preloaded", FanDuel/DraftKings/BetMGM/Caesars/bet365) are partner/affiliate deep links — the same `addToBetslip`-class URLs, wrapped in affiliate tracking ([SportsHandle](https://sportshandle.com/action-network-launches-playbook-ai-x-bot-for-bettors/), [Action Network](https://www.actionnetwork.com/education/action-network-quickslip-how-it-works-more) [PRAC], HIGH). Nobody does "true betslip injection" into another company's app; the injection IS the URL, handled by the book's own front-end. The bet is never placed by the link — the user reviews the prefilled slip and taps Place Bet in the book's app. That's exactly the human-at-the-trigger design we want.

**Honest expectation-setting:** outcome-level (true betslip-prefill) links are per-book, per-market, not guaranteed — The Odds API says availability "will depend on the bookmaker" and prescribes a fallback ladder (outcome → market → event → homepage) [AUTH]. Player-prop coverage of outcome links must be **verified empirically with our key** (probe below) before CB builds the FE button. Worst realistic case for a book: tap opens the right **game page** and the operator taps the leg himself — still a large win over app-hunting.

---

## 1. The backbone: The Odds API `includeLinks` + `includeSids`

Released 2024-09-22; available on `/v4/sports/{sport}/odds` and `/v4/sports/{sport}/events/{id}/odds` — the exact endpoints our MLB pipeline already uses [AUTH; REPO].

- `includeLinks=true` → adds `link` at bookmaker (event page), market, and outcome (betslip) levels, null where unavailable.
- `includeSids=true` → adds the book's own ids (`sid`) at the same levels — documented purpose: "construct your own links to handle variations in state or mobile app links" [AUTH]. This is what lets us build BetMGM's state-specific URLs (§2.3) without scraping anything.
- Documented FanDuel example (from their release page): outcome link `https://sportsbook.fanduel.com/addToBetslip?marketId=42.448600011&selectionId=29165` [AUTH].
- Fallback logic prescribed by the vendor, to mirror verbatim in the FE card: `outcome.link || market.link || event.link || book homepage` [AUTH].
- Region note [AUTH; REPO]: `hardrockbet` lives in region `us2` (plus `hardrockbet_az/_fl/_oh` state variants); `fanatics` is paid-plan-only in `us`; exchanges (`novig`, `prophetx`, `kalshi`, `polymarket`) are region `us_ex` ([bookmaker list](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html)). Where our calls pass an explicit `bookmakers=` CSV (e.g. `captureMlbTrueOpen.js:47`), region keys don't constrain; `buildMlbBootstrapSnapshot.js:729` passes `regions:"us"` — check per-call at build time [REPO].

Cost/quota: the params are documented as plain booleans; no extra quota cost is documented. Verify actual usage headers in the probe (don't assume) [AUTH→verify].

---

## 2. Per-book verdicts

| Book | Verdict | Mechanism (evidence) | iPhone tap behavior (expected) |
|---|---|---|---|
| **FanDuel** | **WORKS** (HIGH) | `sportsbook.fanduel.com/addToBetslip?marketId={m}&selectionId={s}` — documented in The Odds API example, live URLs indexed by Google, the pattern behind QuickSlip [AUTH/PRAC] | Universal link domain → FD app opens with slip prefilled if installed (login may interpose); else mobile web slip |
| **DraftKings** | **LIKELY WORKS — verify outcome-link presence** (MED) | No public self-serve docs, but DK is a Playbook/QuickSlip partner book (slip prefill demonstrably exists) [PRAC]; The Odds API returns DK links/sids where available — event page `sportsbook.draftkings.com/event/{sid}` constructible from sid at minimum | Universal link → DK app at event/market; betslip-prefill depth = what the probe shows |
| **BetMGM** | **WORKS — officially documented** (HIGH) | The ONLY book with public partner deep-link docs: `{base}/en/sports?options={fixtureId}-{marketId}-{optionId}[,…]&stake={stake}` — multi-selection via commas, stake prefill, `wm` affiliate param ([sportsapi.wv.betmgm.com](https://sportsapi.wv.betmgm.com/restapi/generatedeeplink.html), [elements](https://sportsapi.tn.betmgm.com/restapi/elementsdeeplink.html) [AUTH]) | Base URL is STATE-SPECIFIC (`sports.{state}.betmgm.com`) — build from `sid`s + operator's state; universal link → MGM app |
| **BetRivers** | **PARTIAL — event-level likely, betslip unknown** (LOW-MED) | Kambi-platform book; no public deep-link docs found; Kambi coupon/betslip URL formats are not publicly documented [PRAC, thin] | Expect event.link at best from the API; fallback = game page, operator taps the leg |
| **Hard Rock Bet** | **PARTIAL — real deep-link params exist in the wild** (MED) | Live URLs show `app.hardrock.bet/competition/{...}?deep_link_value=betslip%2F{id}` (AppsFlyer OneLink-style param) [PRAC — live URL, indexed]; id space is internal; The Odds API carries `hardrockbet` in us2 | app.hardrock.bet links open the HRB app when installed; depth (event vs betslip) = what the probe shows |
| **Fanatics** | **NOT NOW** (MED confidence in the negative) | No public deep-link scheme found anywhere; paid-plan-only on The Odds API (we should still get event links if on the right plan — verify) | Fallback: event link if provided, else book homepage; operator navigates manually |

*(bet365 excluded per measured reality — returns nothing on our slates; Caesars is data-feed-only per allowlist doctrine.)*

**The probe decides, not this table.** The table is the literature; per-book × per-market (pitcher props!) outcome-link coverage for OUR slates comes from one real API call with the key (§5). Player-prop deep links may be thinner than moneyline links — that's exactly what to measure.

---

## 3. iPhone PWA mechanics (the /m reality)

Our FE is a standalone home-screen PWA (`frontend/mobile/index.html`, served at /m) [REPO]. iOS specifics that shape the design [PRAC: [MagicBell PWA guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [CodeLessGenie](https://www.codelessgenie.com/blog/ios-pwa-how-to-open-external-link-on-mobile-default-safari-not-in-app-browser/)]:

- External (cross-origin) links tapped inside a standalone PWA open in an **in-app browser sheet** by default, not Safari proper. Universal-link app-opening from that sheet is inconsistent across iOS versions — it often works (the sheet hands off to the app) but is not guaranteed.
- Mitigations, in order: render bet links as real `<a href target="_blank" rel="noopener noreferrer">` anchors (not `window.open`/JS navigation); if a book's app-open proves unreliable in operator testing, that book's link falls back to its mobile-web slip — which still prefills, and the book's own web page then offers its "Open in app" banner.
- Do NOT chase custom URL schemes (`dksb://` etc.): undocumented, break silently, and the https universal links are what the books themselves maintain for affiliates [PRAC].
- Test matrix for the operator (one-time, 2 minutes per book): tap from /m → does the app open? at the right market? with the leg in the slip? Record per book; the FE can badge each book's button with its actual depth ("slip ✓" / "game page").

**Honest fallback design (the product rule):** every pick card gets ONE tap target per book, built from the vendor's ladder — betslip link if present (button says "Add to slip @ FanDuel −118"), else market link, else event link ("Open game @ BetRivers"), else nothing (no fake buttons). The card must never imply slip-prefill where only an event link exists — mislabeling that is a trust-layer violation (Law: never fabricate bettor-visible reality).

---

## 4. ToS + legality notes (plain English)

- **Deep links are the books' own acquisition funnel.** They exist FOR third parties (media/affiliates); Action Network runs a business on them in partnership with these books [PRAC]. Consuming them via our paid Odds API subscription is inside our vendor contract — the vendor built the feature for exactly this [AUTH].
- **What stays forbidden:** automated bet *placement* (bots) — book ToS and state regs; we never do it, the operator always taps Place Bet in the book's app. Scraping the books' sites/apps for ids — unnecessary now (the sids come from the vendor). Affiliate *compensation* without registration — irrelevant: single-operator personal tool, no referral revenue, no public marketing.
- **Account-risk realism:** tapping deep links doesn't flag an account; the flagged behavior is the betting pattern itself (CLV — already doctrined). One nuance: don't robotically bet the exact deep-linked price the instant lines post, every day, at every book — same discipline as the existing limits doctrine, unchanged by this feature.
- **Affiliate params:** BetMGM's `wm=` and similar tracking params are optional; omit them (we're not an affiliate; cleaner links).

---

## 5. What CB builds (spec sketch — research only, no code this turn)

1. **PROBE FIRST (operator/CB fence, needs the live key + network):** one `/v4/sports/baseball_mlb/events/{id}/odds` call for tonight's slate with `&includeLinks=true&includeSids=true`, our 7-book `bookmakers=` CSV, our prop markets CSV → count per book × per level (event/market/outcome) non-null links; check usage headers for quota cost. Output to `.scratch/last.txt`. **This produces the real feasibility table** — §2 is the hypothesis, the probe is the verdict (Law 13: verification = non-zero probe output).
2. **Capture:** add the two params to the MLB event-odds fetchers (`buildMlbSlateEvents.js` / `buildMlbBootstrapSnapshot.js`; NOT needed on `captureMlbTrueOpen` — measurement only); persist `link`+`sid` per outcome alongside price in the snapshot rows. Additive fields, kill-switch-gated like everything else; OFF = byte-identical snapshots.
3. **Serve:** carry `betLink` (the ladder-resolved URL) + `betLinkDepth` ("betslip"/"market"/"event") through the best-available serializer onto served rows — same join pattern G1-Serve-1A just built.
4. **FE:** per-book anchor buttons on /m pick cards labeled by real depth; `target="_blank" rel="noopener noreferrer"`; no button when no link.
5. **BetMGM constructor (phase 2):** if the probe shows MGM outcome links absent but sids present, build `?options={fixtureId}-{marketId}-{optionId}` links ourselves from sids + operator's state base URL per the official docs [AUTH].
6. **Placement loop tie-in:** when the operator places off a deep link, `addPlacedBet` already records book/odds — the deep-link tap and the recorded bet should reference the same served row id, closing pick→tap→bet→CLV in one chain.

---

## Sources

- [The Odds API — Bookmaker Deep Links release (includeLinks/includeSids, FanDuel addToBetslip example, fallback ladder)](https://the-odds-api.com/releases/deep-links.html) [AUTH]
- [The Odds API — bookmaker list & regions (hardrockbet us2, fanatics paid, us_ex exchanges)](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) [AUTH]
- [BetMGM partner deep-link docs — Generating Deep Links](https://sportsapi.wv.betmgm.com/restapi/generatedeeplink.html) · [Elements of a Deep Link](https://sportsapi.tn.betmgm.com/restapi/elementsdeeplink.html) [AUTH]
- [Action Network — QuickSlip: how it works](https://www.actionnetwork.com/education/action-network-quickslip-how-it-works-more) · [What is QuickSlip (help center)](https://actionnetworkhq.zendesk.com/hc/en-us/articles/14416743820685-What-is-QuickSlip) [PRAC]
- [SportsHandle — Action Network launches Playbook AI bot (books supported; link→preloaded slip)](https://sportshandle.com/action-network-launches-playbook-ai-x-bot-for-bettors/) · [FantasyLabs — Playbook launch](https://www.fantasylabs.com/articles/action-network-launches-playbook-ai-bot-for-prizepicks-entries-and-betslips/) [PRAC]
- Live FanDuel addToBetslip URLs (indexed): [example 1](https://sportsbook.fanduel.com/addToBetslip?marketId=42.461334694&selectionId=25609) · [example 2](https://account.sportsbook.fanduel.com/sportsbook/addToBetslip?marketId%5B0%5D=42.472358136&selectionId%5B0%5D=21604085) [PRAC]
- Live Hard Rock Bet deep-link URL (indexed): [competition page with deep_link_value=betslip/…](https://app.hardrock.bet/competition/premier-league/7610562287872245803?deep_link_value=betslip%2F6889085231645327408) [PRAC]
- [MagicBell — iOS PWA limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) · [CodeLessGenie — iOS PWA external links](https://www.codelessgenie.com/blog/ios-pwa-how-to-open-external-link-on-mobile-default-safari-not-in-app-browser/) [PRAC]
- [Adjust — deep linking in sports betting apps (industry background)](https://www.adjust.com/blog/deep-linking-sports-betting/) [PRAC]
- Repo: grep `includeLinks|includeSids|addToBetslip` = 0 hits; `buildMlbBootstrapSnapshot.js:729` regions:"us"; `captureMlbTrueOpen.js:47` bookmakers CSV; `sportsbookAllowlist.js` book keys; SPORTSBOOK_CONTRACTS.md §The Odds API [REPO]
