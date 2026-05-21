# PRODUCT VISION

**Canonical 2026-05-21. Operator-authored. The "what are we building?" answer in 60 seconds.**

This is a short doc on purpose. The fuller spec lives in auto-memory (`product_vision_iphone_pwa`); the architecture lives in `ARCHITECTURE.md`; the preserved cognition lives in `PRESERVED.md`; what's done and what's next lives in `BUILD_LOG.md`.

---

## What this is

iPhone-first sportsbook intelligence engine. Mobile web app (PWA), Safari add-to-home-screen, looks iPhone-native. Surfaces tonight's strongest betting edges across 7 books and 4 sports with sportsbook-native reasoning — not fake confidence percentages.

## Books (7)

DraftKings · FanDuel · Fanatics · BetRivers · BetMGM · Hard Rock · bet365

## Sports (4)

MLB · NBA · NFL · NHL

(MLB has the most existing cognition. NBA needs scaffolding to parity. NFL is offseason. NHL playoffs depending on round.)

## Frame

**battlefield breadth → curated edge → AI compression → sportsbook-native execution**

The app feels like *"show me the slate, then intelligently narrow it."*
Never *"here are 5 random props."*

## Output frame

Every play comes with: prop · line · book · archetype tag · plain-English reasoning · tier (Core / Strong / Lotto).

Reasoning sounds like *"weak side platoon, hitter-friendly park, bullpen exhausted"* — not *"92% confidence."*

## Archetype tags (not all props are equal)

Stable · Volatile · Matchup-Driven · Public-Bait · Role-Consistent · Variance-Heavy · Soft-Line · Late-Movement · Narrative-Driven · Low-Liquidity.

## Cognition the system understands

Players, roles, positions, usage, pace, minutes, lineups, injuries, weather, travel/rest, coaching tendencies, gameflow, sportsbook behavior, line movement, public vs sharp money, matchup dynamics, archetypes, correlation, variance, survivability, sportsbook-specific pricing tendencies.

The system thinks like a bettor + sharp + DFS grinder + tape watcher + risk desk + reporter + analyst — all at once.

## Screenshot ingestion (first-class)

Operator drops screenshots from Twitter / Discord / sportsbooks / slips / beat reporters. System OCRs, extracts props/odds/books, compares to model conviction, explains agreement/disagreement, detects narrative-vs-edge.

## Self-grading + evolution

Every recommendation logged. Each morning: W/L, CLV, archetype hit rate, sport hit rate, tier hit rate, ladder survivability, book-specific performance. System learns where its edges are real vs where it overestimates.

## Anti-goals

AI governance systems · memory theater · operational doctrine recursion · fake confidence percentages · "shipped" claims without verification · fabricated props/OCR/stats/outcomes · parallel runtime systems · governance about governance.

## Retail-book reality

Every book on the list limits and bans winning bettors. Bankroll, staking, and rotation design must assume this. Realistic goal: consistent monthly profit while managing limit risk.

## Catch-up surface for new sessions

A new chat reads, in order: this file → `BUILD_LOG.md` → memory index → `PRESERVED.md` → `ARCHITECTURE.md`. ~5 short files. The repo is the continuity layer.
