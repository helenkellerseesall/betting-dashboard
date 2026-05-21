# FE-ASYMMETRY P1A — CONVICTION SIGNAL RENDERING PROPAGATION
## Canonical Render-Spec Artifact (PENDING_AE)

**Lane of authorship:** FRONTEND / UX LAB
**Authorized by:** MASTER CONTROL ROOM (P1A — first post-reconciliation implementation phase; ACTIVE EXECUTION partially reopened, scoped to this artifact)
**Consumes:** ACTIVE EXECUTION
**Status:** PENDING_AE — not canonical until ACTIVE EXECUTION lands the implementation and seals via brain checkpoint
**Doctrine class:** canonical rendering propagation ONLY · additive-only · canonical-authority-first · anti-fabrication
**Scope hard-locks:** zero backend mutation · zero new conviction fields · zero new visual idioms · zero architectural redesign · zero conviction-semantics alteration · zero new color/typography tokens introduced

---

## AMENDMENT BANNER — 2026-05-17 (post-T3-seal, pre-T1)

This artifact has been **amended in place** following MCR's finalized T1 architectural ruling. The original spec contemplated propagating conviction onto `Candidate` and `AiSlipLeg` via FE type widening (former §3.1, §3.2, §3.3, §6 C-1/C-2). MCR has formally classified that approach as architecturally incorrect.

**Cemented architectural ruling (MCR, 2026-05-17):**
- `Candidate` is the **canonical battlefield-layer type** (broad pool, breadth-first; preserves canonical-authority for the discovery surface).
- `FeaturedPlay` / `compactPlay` are the **canonical curated-layer authority types** (narrow pool, curated; conviction lives here).
- `convictionNote` / `convictionReasonTag` are **curated-layer signals**, NOT battlefield-layer attributes. Type widening on `Candidate` to carry these fields would silently fork canonical authority and is now explicitly forbidden.
- **FE renders conviction on battlefield surfaces ONLY where a canonical FeaturedPlay overlap exists.** No inference. No approximate match. No FE-side conviction synthesis. Honest absence on every non-overlap row.
- The battlefield-vs-curated hierarchy is **canonical architecture** going forward. Future surfaces must honor it.

**What changed in this amendment:**
- New **§0.A Architectural Cementing** (immediately below) — codifies the ruling.
- **§2** target-mapping notes — clarify that conviction is a curated-layer signal even when it renders on a battlefield surface.
- **§3.1 / §3.2 / §3.3** — replaced with **featured-overlap-lookup propagation (Option A)**. No `Candidate` / `AiSlipLeg` type widening. Render-nothing on overlap miss is doctrine.
- New **§3.6** — specifies the featured-overlap-lookup mechanism (Option A).
- **§4.4** absence behavior — extended with the no-overlap render-nothing case.
- New **§5.5** — sparse-distribution felt-experience validation.
- **§6** chokepoints — C-1 and C-2 (Candidate / AiSlipLeg type widening) are now explicitly NON-MITIGATIONS — they describe a forbidden direction. Replaced with overlap-lookup chokepoints (C-12 through C-15).
- **§7** non-goals — adds "no flattening conviction across battlefield surfaces."
- **§8** success criteria — updated for overlap-aware T1/T2.
- New **§A1** at end — amendment attestation lineage.

**What did NOT change:**
- **§1** (canonical conviction-rendering surface description) — unchanged.
- **§3.0** (reference render block) — unchanged. Helper is the immutable authority.
- **§3.4 T3 RecommendationLadder** — unchanged. T3 has shipped and sealed.
- ConvictionNote helper (`frontend/src/workstation/components/ConvictionNote.tsx`) — unchanged; remains the single canonical render authority. The amendment changes WHERE conviction renders, not HOW.
- Color hierarchy, sigil, tooltip, typography, density rules — all unchanged.

This amendment preserves the additive-only doctrine: every change adds clarification or replaces a draft section with its architecturally-correct successor. Nothing is silently mutated.

---

## 0.A ARCHITECTURAL CEMENTING (MCR ruling, 2026-05-17)

The battlefield-vs-curated hierarchy is now canonical FE architecture. Every conviction-rendering decision in this spec must reduce to one of the following four cases.

| Surface class | Source data type | Conviction source | Render rule |
|---|---|---|---|
| **Curated-layer surface** (FeaturedCard, RecommendationLadder slot picks) | `FeaturedPlay` | The play's own `convictionNote` / `convictionReasonTag` | Render directly via `ConvictionNote` helper. Absence gated on field presence. |
| **Battlefield-layer surface** (Discover PropRail rows, LadderExplorer leg rows) | `Candidate` | **NONE on Candidate.** Conviction is curated-layer-only. | Build a featured-overlap index from `state.featured.*`. For each battlefield row, look up by canonical join key. If a FeaturedPlay with `convictionNote` matches, render via helper. **Otherwise render nothing.** |
| **AI-slip-leg surface** (SlipLegRow inside SlipCard) | `AiSlipLeg` | **NONE on AiSlipLeg.** Same as battlefield: curated-layer-only. | Same featured-overlap lookup; same render-nothing-on-miss. |
| **Other surfaces** (HeroPickCard, SpotlightCard, VerdictCard, BetBuilderDock, PortfolioView) | various | **Not in P1A scope.** | Render nothing. Deferred to future-phase decisions. |

**The doctrinal sentence to internalize:**
> "Conviction is what the curated layer says about a play. The battlefield surface reflects that statement when and only when the play is in the curated layer."

**Operational consequence:** the Discover battlefield will display conviction on a **sparse, non-uniform** subset of rows — only those rows that the curated layer (`state.featured.*`) has anointed. This is the felt-flow signal the operator is selling: *breadth, with the curated subset visibly annotated within it.* Rows the curated layer has not anointed render their canonical baseline shape, unchanged. This is the architectural distinction between flattening (forbidden) and propagation (authorized).

**Forbidden directions cemented by this ruling (do NOT propose):**
- Widening `Candidate` to carry `convictionNote` or `convictionReasonTag` (silent canonical fork).
- Widening `AiSlipLeg` to carry the same (silent canonical fork).
- FE-side recomputation of PCE-1A from raw fields on `Candidate` (canonical-authority violation).
- Rendering a "no conviction signal" placeholder on non-overlap rows (anti-fabrication violation).
- Rendering a dimmed / neutral conviction line by default (anti-fabrication violation).
- Approximate-match join (e.g., player+stat-only) when the canonical id join misses (silent fabrication).
- Promoting conviction onto rows ABOVE the canonical featured.* threshold (silent inversion of the curation gate).

---

## 1. CANONICAL CONVICTION-RENDERING SURFACE (the native idiom)

Single existing surface today: `frontend/src/workstation/components/FeaturedCard.tsx` lines 128–150. Inspected verbatim. This is the **only** prior conviction-rendering authority in the FE. RecommendationLadder, HeroPickCard, SpotlightCard, VerdictCard, and every Discover-side component currently render zero conviction signal.

### 1.1 Field positioning (within FeaturedCard `.ws-feat-row`)

Conviction is the **last bettor-readable annotation** in the row's vertical stack, below `processNote`. It does not consume a column; it occupies a grid-row-2 cell that spans `grid-column: 2 / -1` (under the player-name column to the end of the row).

The row's vertical annotation order is operator-cemented:
1. inline annotation strip (`confStr / booksStr / volStr / deltaStr / SOFT / STALE`)
2. `reasoning` (canonical) — when present
3. `processNote` (italic, opacity 0.85) — when present
4. **`convictionNote` (italic, opacity 0.85, tri-color, `◆` prefix)** ← the conviction slot
5. `avoidReason` (italic, warn-color, `⚠` prefix) — when present

Conviction sits **above** the avoid-reason and **below** the process-note. This ordering is the canonical "bettor-readable annotation cascade" — process explanation first, then conviction posture, then avoid-flag last. Propagation must preserve this ordering on every target surface.

### 1.2 Typography (exact, from `.ws-feat-reason` in `workstation.css` and inline overrides in `FeaturedCard.tsx`)

| Property | Value | Source |
|---|---|---|
| `font-family` | `var(--ws-sans)` | `.ws-feat-reason` |
| `font-size` | `11px` | `.ws-feat-reason` |
| `color` (base) | `var(--ws-text-dim)` (#8a96a4) | `.ws-feat-reason` |
| `font-style` | `italic` | inline override |
| `opacity` | `0.85` | inline override |
| `padding-top` | `2px` | `.ws-feat-reason` |
| `grid-column` | `2 / -1` (spans col-2 → end) | `.ws-feat-reason` |
| Leading glyph | `◆` (U+25C6), single space, then phrase | inline `<div>` body |

The `◆` glyph is the **conviction sigil**. It is distinct from the `⚠` (avoid) and `💬` (bettor-language phrase chip in SlipCard) and `✚` (reinforcement boost). Together these four glyphs are the operator-readable visual taxonomy for FE annotation layers. Propagation MUST use `◆` and ONLY `◆` for conviction. Do not introduce a substitute glyph on any target surface.

### 1.3 Color hierarchy (tri-state, anchored to `convictionReasonTag`)

Color is determined by `convictionReasonTag`. The FeaturedCard maps it through a JS ternary inside the inline `color:` style. Each color reference uses `var(<token>, <hex-fallback>)` — and at present, **neither `--ws-good` nor `--ws-muted` is defined in `workstation.css`. The hex fallbacks ARE the canonical conviction colors.** `--ws-warn` IS defined (`#f59e0b`) but FeaturedCard intentionally passes a darker amber (`#b26a00`) as the conviction-warn color — a deliberate downshift from the alert-warn used elsewhere (e.g., HR-suppressing pill, avoid-reason).

| Tag | Phrase (verbatim from PCE-1A) | Color expression | Effective hex | Semantic |
|---|---|---|---|---|
| `PCE:earned` | "earned upside profile" | `var(--ws-good, #2e7d32)` | **#2e7d32** | positive — earned upside |
| `PCE:supported` | "lineup-supported edge" | `var(--ws-good, #2e7d32)` | **#2e7d32** | positive — supported |
| `PCE:modest` | "modest lineup conviction" | `var(--ws-muted, #6b6b6b)` | **#6b6b6b** | neutral — modest |
| `PCE:thin` | "thin-process longshot" | `var(--ws-warn, #b26a00)` | **#b26a00** | caution — thin process |
| `PCE:ecology_light` | "ecology-light spot" | `var(--ws-warn, #b26a00)` | **#b26a00** | caution — ecology-light |
| `null` / unknown | (no render — see §4) | — | — | absent — render nothing |

**Doctrine-critical:** propagation across new surfaces MUST replicate the exact ternary, including the `var(<token>, <hex>)` expression with the same hex fallbacks. ACTIVE EXECUTION may choose to either (a) copy the ternary inline at each call site, or (b) extract a single pure helper `convictionColorForTag(tag): string` and call it identically. Either is doctrine-safe; (b) is preferred for canonical-authority-first (single point of color authority).

**The CSS variable definitions for `--ws-good` and `--ws-muted` MUST NOT be introduced in P1A.** Adding new CSS variables is a visual-idiom expansion and is forbidden by phase scope. If those tokens are eventually added to `workstation.css`, it is a separate doctrine decision routed through MCR — not P1A.

### 1.4 Density relationship (the row's existing breathing room)

The `.ws-feat-row` grid template is `16px 1fr auto auto auto auto` with `gap: 8px` and per-row `padding: 6px 0`. Conviction occupies the bottom edge of the row — not a separate row, not a hover affordance, not a modal. The row's `border-bottom: 1px dashed var(--ws-border)` closes beneath the conviction line.

Densities to preserve when propagating:
- Conviction adds at most ~14px of vertical space (11px text + 2px padding-top + line-height descend) when present
- Conviction adds **0px when absent** (the `<div>` is conditionally rendered, not `visibility: hidden`)
- No animation; no expand/collapse; no hover-to-reveal
- No background color, no border, no chip-frame
- No marker before `◆` other than the inherited row indent (grid col-2 start)

### 1.5 Spacing hierarchy

In the FeaturedCard row:
- annotation strip (`confStr…`) → `font-family: var(--ws-mono); font-size: 10px; color: var(--ws-dim)` — densest, monospace
- `reasoning` → `.ws-feat-reason` defaults (11px sans, dim)
- `processNote` → `.ws-feat-reason` + `fontStyle: italic, opacity: 0.85`
- **`convictionNote` → `.ws-feat-reason` + `fontStyle: italic, opacity: 0.85` + tri-color + `◆` prefix**
- `avoidReason` → `.ws-feat-reason` + `fontStyle: italic, color: var(--ws-warn)` + `⚠` prefix

Conviction is **typographically siblings with `processNote` and `avoidReason`** — same class, same italic, same opacity. The differentiator is color tag + sigil. This is what makes it feel native — ACTIVE EXECUTION must replicate the same italic/opacity/sigil triad on every target surface.

### 1.6 Tooltip (title attribute, verbatim)

```
Player Conviction Engine (PCE-1A): ${convictionReasonTag || "neutral"} — derived from canonical lineupSpot × plate-appearance proxy × stat-side coherence × model-trust
```

Propagation MUST carry this tooltip verbatim on every target surface. Anti-fabrication: the tooltip is the only place the canonical signal name is exposed; bettor sees the phrase, operator hovers for the canonical derivation.

### 1.7 Conviction phrase vocabulary (closed set, length-bounded)

Five phrases total. Max length 24 chars. ALL describe *process*, *lineup*, or *ecology* — never name the player, line, odds, or sportsbook. Safe to propagate to any surface without coupling.

```
"earned upside profile"      (21)
"lineup-supported edge"      (21)
"modest lineup conviction"   (24)
"thin-process longshot"      (21)
"ecology-light spot"         (18)
```

This vocabulary is closed at the backend layer. ACTIVE EXECUTION MUST NOT introduce a sixth phrase, alias an existing phrase, or alter capitalization. If a future PCE-1B widens the vocabulary, the FE will pick it up automatically as long as the same `.ws-feat-reason`-class tri-color ternary is reused.

---

## 2. TARGET PROPAGATION SURFACES

The phase brief named three propagation surfaces. Mapping each to its existing FE module:

| # | Brief term | Concrete FE target | File | Native-idiom anchor |
|---|---|---|---|---|
| T1 | **Discover cards** | Discover prop rail row (`PropRail` row) + LadderExplorer leg row (`PlayerLadderBlock` leg row) | `frontend/src/workstation/sections/GameDiscoveryView.tsx` lines 399–432 (rail row), lines 517–534 (ladder leg) | `.ws-feat-reason` cascade |
| T2 | **Slip card legs** | `SlipLegRow` inside `SlipCard` (AI Parlays) | `frontend/src/workstation/sections/AiSlipsView.tsx` lines 154–175 | `.ws-feat-reason` cascade |
| T3 | **AI slip pick rows** | `RecommendationLadder` per-slot pick row | `frontend/src/workstation/components/RecommendationLadder.tsx` (slot-rendering region) | `.ws-feat-reason` cascade |

Each target has an EXISTING last-annotation slot that can carry conviction without changing the row's column grid. Conviction never adds a new column to any target. It always lands as a vertical-stack append below the row's monospace primary line.

### 2.1 Why these three are the correct scope (amended)

- **T1 (battlefield-layer surface)** is the largest blast radius. Conviction renders here ONLY via featured-overlap lookup (curated-layer signal reflected onto matching battlefield rows). The asymmetry being closed is *"the curated layer's verdict is invisible to the battlefield reader, even when both surfaces describe the same canonical prop"* — NOT *"the battlefield lacks its own conviction layer"* (it cannot have one; conviction is curated-layer-only per §0.A).
- **T2 (AI-slip-leg surface)** is also curated-by-derivation (AI slips are a curation product) but the `AiSlipLeg` payload does not carry conviction today. Per amended §0.A, T2 uses the same featured-overlap lookup. Type widening on `AiSlipLeg` is forbidden.
- **T3 (curated-layer surface)** is `FeaturedPlay`-shaped at the data layer — conviction is already present. T3 has shipped and sealed; this amendment leaves T3 untouched.

`FeaturedCard` itself remains the canonical surface and is **not modified** by P1A. The reference render block now lives in `ConvictionNote.tsx` (extracted during T3). All propagation routes through that helper.

### 2.2 Helper props consideration for amended T1 / T2

The `ConvictionNote` helper currently types its props as `convictionNote?: FeaturedPlay["convictionNote"]` and `convictionReasonTag?: FeaturedPlay["convictionReasonTag"]`. Under the amended approach this is **correct as-is** — the helper's caller always passes values that originated from a `FeaturedPlay`. There is no longer a case where `Candidate.convictionNote` is passed (because `Candidate` does not and will not carry the field). The non-blocking observation from the T3 inspection report about widening helper props to `string | undefined` is now **resolved as obsolete**: the helper stays coupled to FeaturedPlay because that is the only canonical source of conviction.

### 2.2 Out-of-scope surfaces for P1A (do NOT propagate)

- `HeroPickCard` — emotional hero, already carries its own copy structure; conviction integration is a future-phase emotional-compression decision (not rendering propagation)
- `SpotlightCard` — bucket-level summary, not a per-pick row
- `VerdictCard` — slip-analysis surface; conviction integration requires backend leg-resolution coupling, out of P1A scope
- `BetBuilderDock` — manual builder dock; conviction-aware builder is a separate phase candidate
- `PortfolioView` warnings — portfolio is correlation/risk, not conviction

Adding any of the above is **scope creep** under P1A's "rendering propagation ONLY" lock. They are noted here so ACTIVE EXECUTION sees the explicit deferral.

---

## 3. EXACT RENDER RULES PER TARGET

The render block from FeaturedCard.tsx (the reference implementation) is reproduced once below for clarity, then mapped to each target with surface-specific notes.

### 3.0 Reference render block (verbatim from FeaturedCard.tsx)

```tsx
{p.convictionNote && (
  <div
    className="ws-feat-reason"
    style={{
      fontStyle: "italic",
      opacity: 0.85,
      color:
        p.convictionReasonTag === "PCE:earned" || p.convictionReasonTag === "PCE:supported"
          ? "var(--ws-good, #2e7d32)"
          : p.convictionReasonTag === "PCE:thin" || p.convictionReasonTag === "PCE:ecology_light"
            ? "var(--ws-warn, #b26a00)"
            : "var(--ws-muted, #6b6b6b)",
    }}
    title={`Player Conviction Engine (PCE-1A): ${p.convictionReasonTag || "neutral"} — derived from canonical lineupSpot × plate-appearance proxy × stat-side coherence × model-trust`}
  >
    ◆ {p.convictionNote}
  </div>
)}
```

**Five invariants of this block (preserve on every target):**
1. Conditional gate is `{value.convictionNote && (…)}` — falsy value renders nothing. NEVER substitute a placeholder.
2. `className="ws-feat-reason"` — propagation MUST reuse this exact class. Do not fork into `.ws-rail-reason` or similar.
3. Inline style is the SAME shape on every target. No additions, no removals.
4. Tooltip string is byte-identical across every target.
5. `◆` glyph + single space + `{convictionNote}` — no alternative glyphs, no parenthetical wrappers.

### 3.1 T1 — Discover prop rail row (`PropRail` row in `GameDiscoveryView.tsx`) — AMENDED

**Current row** (lines 399–432 in `GameDiscoveryView.tsx`):
```
gridTemplateColumns: "1fr auto auto auto auto"
columns: [player+team+side+line, odds, edge, book, +/-]
fontSize: 11, padding: "2px 0", borderBottom: 1px solid faint
```

**Render rule for T1 (Option A — featured-derived canonical overlap lookup):**

1. At the `GameDiscoveryView` level (or at a sibling memoized helper), build a single **featured-overlap index** from `state.featured` per §3.6. The index keys canonical FeaturedPlay identifiers; each value carries `{ convictionNote, convictionReasonTag }`. The index is built ONCE per `state` change, not per row.
2. The index is threaded down to `PropRail` as a prop (or read via context — ACTIVE EXECUTION chooses, but the index MUST NOT be rebuilt inside each row's render).
3. For each `Candidate c` in the rail, perform a strict canonical lookup against the index (see §3.6 join-key strategy). Result is either a `{ convictionNote, convictionReasonTag }` payload or `null`.
4. If the lookup returns a payload AND `convictionNote` is truthy: render `<ConvictionNote convictionNote={…} convictionReasonTag={…} />` as a **grid-row-2 child** of the existing row container.
5. The `<ConvictionNote>` MUST be wrapped in a `<div>` carrying `gridColumn: "1 / -1"` (override the inherited `.ws-feat-reason` default of `2 / -1`, because the rail row's column-1 is the player text — not a 16px rank gutter as in FeaturedCard). This wrapper exists solely to anchor the grid span; it adds no styling.
6. If the lookup returns null OR the payload's `convictionNote` is falsy: render **nothing** for this row. The row appears exactly as it does pre-P1A. No placeholder, no dimmed pill, no "(no conviction signal)" line, no spacer.

**The row WRAPPER itself is unchanged.** The 5-column primary grid stays as-is. Conviction is a conditional grid-row-2 cell that exists only on the overlap subset of rows.

**Data integrity rules:**
- The conviction text rendered is the FEATUREDPLAY's `convictionNote`, NEVER `c.convictionNote`. `Candidate` does not carry the field. Reading it would either be `undefined` (type-correct) or, if widened, would constitute the canonical fork forbidden by §0.A.
- Join misses are NEVER bridged by approximate match. If id-based join misses, render nothing (see §3.6 for the strict id-then-fallback policy).
- No FE-side PCE recomputation. The featured-overlap index is the SOLE conviction authority on the battlefield surface.

**Sparse-distribution density target (revised under amended approach):**
- Realistic featured-bucket cardinality across `state.featured.*` is roughly 25–40 unique canonical plays per slate (anchors + tonightsBest + sport-specific buckets, with deduplication).
- Of those, PCE-1A fires on the hitter-overs subset with canonical inputs present — empirically ~60–70% of curated hitter-over plays carry conviction.
- Net: realistic per-rail conviction-lit row count is **3–8 rows out of a rail of 20–40 props** on MLB nights, **0–2 rows out of a rail of ~12 on NBA** (NBA-parity ecology deferred per D-2; conviction stays sparse on NBA by canonical design, not by FE gating).
- Rail vertical growth: ~42–112px added per fully-expanded rail (3–8 × 14px). Well within `max-height: 280px, overflow-y: scroll` budget. No scrollbar-creep concern.

**Sort/lens interaction:** conviction MUST NOT enter rail sort logic in P1A. Sort options remain `edge / modelProb / odds / line`. Adding "by conviction" is a separate phase candidate (and would itself require operator approval given the asymmetry implications).

### 3.2 T1' — LadderExplorer leg row (`PlayerLadderBlock` leg in `GameDiscoveryView.tsx`) — AMENDED

**Current leg row** (lines 517–534):
```
gridTemplateColumns: "1fr auto auto auto"
columns: [stat+side+line, odds, edge, book]
fontSize: 11, padding: "2px 0"
```

**Render rule:** same featured-overlap-lookup shape as T1. The same memoized index built at `GameDiscoveryView` level is threaded down to `LadderExplorer` → `PlayerLadderBlock`. For each leg in a player's ladder, lookup against the index; if a curated-layer match with conviction exists, render `<ConvictionNote …/>` wrapped in `<div style={{ gridColumn: "1 / -1" }}>`. Otherwise render nothing.

**Sparse-cluster correctness note (amended):**
Conviction is per-LEG, derived from curated-layer overlap. Two legs from the same player can differ: Aaron Judge HR-over may be in `state.featured.bestHr` (conviction shown), while Aaron Judge TB-over may not be in any featured bucket (no conviction shown — even though PCE-1A may have fired on that candidate's underlying score). The visible-conviction set on the battlefield is **strictly a function of curated-layer membership**, not raw PCE fire. This is the architectural cementing in action.

**Felt-experience consequence:** a player-block expanded in LadderExplorer typically shows 2–8 legs. Realistic conviction-lit cardinality is 0–3 legs. The mixed appearance — 1–2 conviction-lit legs amongst 5–7 baseline legs — IS the felt-flow signal: *"some of this player's prop board is curated-anointed; the rest is battlefield breadth."* The bettor reads which legs are *the* legs without the rail having to mark them with a separate badge.

**No leg-aggregation:** do not summarize "this player has conviction" at the player-block header. Conviction is a per-row signal. Player-block headers stay canonical-baseline.

### 3.3 T2 — Slip card leg row (`SlipLegRow` in `AiSlipsView.tsx`) — AMENDED

**Current row** (lines 154–175):
```
.ws-slip-leg grid-template-columns: 1.4fr 0.5fr 0.6fr 0.4fr 0.5fr 0.7fr 36px
columns: [player+team, statFamily, side+line, odds, book, reason, +/-]
font-family: var(--ws-mono), font-size: 12px
```

**Render rule (amended — featured-overlap lookup):**

Same featured-overlap-lookup shape as T1. The `AiSlipsView` (or a memoized helper consumed by it) builds — OR reuses if already built upstream — the same featured-overlap index per §3.6. For each `AiSlipLeg`, lookup against the index; if a curated-layer match with conviction exists, render `<ConvictionNote …/>` as a grid-row-2 child wrapped in `<div style={{ gridColumn: "1 / -1" }}>`. Otherwise render nothing.

`AiSlipLeg` is NOT widened. The leg's own payload does not need to carry conviction. The conviction text rendered is always the FeaturedPlay's, looked up by canonical join key.

**Coexistence with existing `reason`:** the slip-leg row already carries a `reason` cell (column 6) populated from `slip.legReasonings[i].reason`. This is a **different signal** — per-leg justification from `buildAiSlips` (composite-score reasoning), not the PCE-1A bettor-readable phrase. Both surfaces render when both are present. Order on the row's vertical stack:
1. Primary monospace line (columns 1–7 inline) — `reason` lives inline in column 6
2. **conviction line below (grid-row-2)** — italic, opacity 0.85, tri-color, `◆` prefix — present only on overlap-hit rows

The existing `reason` and the new conviction line are visually distinguished by: existing `reason` is column-bounded (truncates within col-6, no italic), conviction is full-width row-2 italic. They do not compete; they sit at different visual depths.

**Sparse-distribution behavior:**
An AI slip typically has 2–6 legs. Realistic per-slip conviction-lit cardinality (legs whose underlying canonical prop ALSO appears in `state.featured.*` AND carries `convictionNote`) is 0–3. Most slips will have 1–2 conviction-lit legs and 1–4 non-conviction legs. The non-uniform appearance — a parlay where some legs carry the curated-layer verdict and others do not — IS the felt-flow signal. The bettor sees *which legs the curated layer has independently endorsed* without the slip card having to mark them with a separate badge.

**No aggregation at the slip-card level.** Do not summarize "this slip has N conviction-lit legs" at the slip header. Do not promote a slip's combinedScore based on conviction count. Conviction is a per-leg render-only signal in P1A.

### 3.4 T3 — RecommendationLadder pick rows (`RecommendationLadder.tsx`)

**Current slot rendering:** each ladder slot renders a `FeaturedPlay` (or null). `FeaturedPlay` ALREADY carries `convictionNote` and `convictionReasonTag` per current `types.ts` lines 208–217. **No type widening required for T3.**

**Render rule:** in the slot's pick-row body (where the play's player/stat/odds/etc render), append the reference render block as the last child of the slot's vertical content. Match FeaturedCard's annotation cascade order exactly (annotation strip → reasoning → processNote → conviction → avoidReason).

T3 is the **lowest-risk, highest-fidelity** propagation target. It is the smallest patch (data already present, type already widened, surface already FeaturedPlay-shaped) and produces the most immediately-visible felt-flow improvement (the Dashboard's 7-slot decision ladder gains conviction text inline). ACTIVE EXECUTION should land T3 first.

### 3.5 Recommended landing order for ACTIVE EXECUTION — AMENDED

1. **T3 (RecommendationLadder)** — ✅ SHIPPED AND SEALED (2026-05-17). Helper extracted to `ConvictionNote.tsx`; FeaturedCard rerouted byte-identically.
2. **T1 (Discover PropRail + LadderExplorer leg) — featured-overlap lookup.** No `Candidate` type widening. Single memoized featured-overlap index threaded into both row variants.
3. **T2 (SlipLegRow) — featured-overlap lookup.** No `AiSlipLeg` type widening. Reuses the same featured-overlap index pattern.

T1 and T2 can land in either order or together. The featured-overlap index implementation is shared; once written, both targets consume it identically. The amended approach is **strictly FE-only** — zero backend mutation — and stays within the original P1A phase scope.

### 3.6 Featured-overlap-lookup mechanism (Option A — authoritative spec)

This section is the canonical specification for how battlefield-layer and AI-slip-leg surfaces consult the curated layer for conviction. ACTIVE EXECUTION builds this once and reuses it for T1 + T2.

#### 3.6.1 Index source

The index reads ONLY from `state.featured`. Specifically, every FeaturedPlay-shaped array under `state.featured.*` is walked, plus the slot entries inside `state.featured.recommendationLadder`. Concretely (per `frontend/src/workstation/types.ts` `Featured` interface):

```
state.featured.anchors            (FeaturedPlay[])
state.featured.tonightsBest       (FeaturedPlay[])
state.featured.bestHr             (FeaturedPlay[])
state.featured.bestPra            (FeaturedPlay[])
state.featured.bestFirstBasket    (FeaturedPlay[])
state.featured.bestLadders        (FeaturedPlay[])
state.featured.smartAggression    (FeaturedPlay[])
state.featured.safest             (FeaturedPlay[])
state.featured.bestClv            (FeaturedPlay[])
state.featured.marketAgreement    (FeaturedPlay[])
state.featured.timingWindows      (FeaturedPlay[])
state.featured.bestBalanced       (FeaturedPlay[]?)
state.featured.bestAggressive     (FeaturedPlay[]?)
state.featured.bestUnders         (FeaturedPlay[]?)
state.featured.bestAltLadders     (FeaturedPlay[]?)
state.featured.bestDisagreementEdges  (FeaturedPlay[]?)
state.featured.staleLineOpportunities (FeaturedPlay[]?)
state.featured.trapLadders        (FeaturedPlay[]?)
state.featured.inflatedSuperstarSpots (FeaturedPlay[]?)
state.featured.believableUpsideTickets (FeaturedPlay[]?)
state.featured.explosiveUpsideTickets  (FeaturedPlay[]?)
state.featured.recommendationLadder.bestOverall          (FeaturedPlay | null)
state.featured.recommendationLadder.safestPlay           (FeaturedPlay | null)
state.featured.recommendationLadder.bestUpsidePlay       (FeaturedPlay | null)
state.featured.recommendationLadder.bestBalancedPlay     (FeaturedPlay | null)
state.featured.recommendationLadder.bestDisagreement     (FeaturedPlay | null)
state.featured.recommendationLadder.mostOverpricedAvoid  (FeaturedPlay | null)
state.featured.recommendationLadder.highestTrapRiskAvoid (FeaturedPlay | null)
state.featured.recommendationLadder.bestBelievableUpside (FeaturedPlay | null?)
state.featured.recommendationLadder.bestExplosiveUpside  (FeaturedPlay | null?)
```

The walk is a flat union with deduplication-on-id. Plays appearing in multiple buckets contribute one index entry.

#### 3.6.2 Index entry shape

```ts
interface ConvictionIndexEntry {
  convictionNote: string
  convictionReasonTag: NonNullable<FeaturedPlay["convictionReasonTag"]>
                       | null   // present-but-untagged path stays renderable
}
```

The index ONLY indexes plays where `convictionNote` is a non-empty string. Plays with absent/null `convictionNote` are NOT added (their non-presence is the lookup signal for the consumer).

#### 3.6.3 Join key — primary then strict-fallback

**Primary join key:** `FeaturedPlay.id` ↔ `Candidate.id` / `AiSlipLeg.id`.

The backend `normalizeCandidate` and `buildFeaturedPlays` share the same canonical id allocation (per `buildFeaturedPlays.js` normalizeCandidate path). For canonical scoring outputs, `Candidate.id === FeaturedPlay.id` for the same underlying canonical prop row. The id is the canonical-authority join.

**ACTIVE EXECUTION verifies this empirically before shipping:** log a side-by-side comparison of `state.candidates[0].id` and the corresponding `state.featured.anchors[i].id` for at least one canonical match. If ids match → primary join is authoritative. If ids diverge → escalate to MCR; do NOT silently fall back to composite-key matching (composite-key matching is fabrication-adjacent because any near-match can produce a false positive).

**Strict fallback (only if MCR explicitly authorizes after empirical id-divergence finding):** composite key `[player.toLowerCase().trim(), normFam(statFamily), side.toLowerCase(), line, book.toLowerCase()].join("|")`. The fallback is only authorized if ALL five components are present on both sides and the comparison is strict equality (no fuzzy match, no `book ?? bestBook` substitution, no rounding tolerance on `line`).

For P1A initial implementation, ACTIVE EXECUTION uses the **primary id join only**. If that produces empirical misses on canonical-matched rows, the matter routes back to MCR before any fallback is introduced.

#### 3.6.4 Lookup function (specification, not implementation)

```ts
// Pure FE helper. Build once per state change; memoize on state.featured reference.
function buildConvictionIndex(featured: Featured | null | undefined): Map<string, ConvictionIndexEntry>

// Per-row lookup. Returns null on miss; consumer renders nothing on null.
function lookupConviction(
  index: Map<string, ConvictionIndexEntry>,
  row: { id?: string }
): ConvictionIndexEntry | null
```

The functions live in a new file `frontend/src/workstation/convictionOverlap.ts` (or similar — ACTIVE EXECUTION's choice within `workstation/`). They are pure, deterministic, dependency-free of any backend call. The implementation must not import `ConvictionNote` (the helper is the renderer; this file is the indexer).

#### 3.6.5 Memoization rules

- The index MUST be built ONCE per `state.featured` reference change (use `useMemo` keyed on `state?.featured`).
- The index MUST be built at the highest sensible component level (`GameDiscoveryView` for T1, `AiSlipsView` for T2) — not inside child rows.
- The index MUST NOT be rebuilt during sort/lens/filter operations on the rail body — those operations don't change `state.featured`.
- If `state.featured` is null/undefined, the index is an empty Map. Every lookup returns null. Every row renders no conviction. This is the legacy-backend graceful degradation case.

#### 3.6.6 Strict no-fabrication rules

- The index reads ONLY canonical `convictionNote` strings from `state.featured.*`. It does not derive, infer, capitalize-correct, or otherwise transform them.
- The index does not include `convictionReasonTag` defaults. If a FeaturedPlay has `convictionNote` but `convictionReasonTag` is undefined, the entry preserves `convictionReasonTag: undefined` and the helper's color ternary falls through to the neutral branch per existing §1.3 / §4.5 doctrine.
- On lookup miss, the consumer renders nothing. No empty-state placeholder. No "—" em-dash. No dimmed line.
- The index is never logged, exposed via console, or persisted. It is purely a per-render derived structure.

---

## 4. RESPONSIVE / TRUNCATION / OVERFLOW / ABSENCE BEHAVIOR

### 4.1 Responsive behavior

The conviction line uses `var(--ws-sans)` 11px italic. No fixed width, no max-width. It inherits the row container's width via `gridColumn: "1 / -1"`. On narrow viewports (the FE is desktop-first per `D-9 / F-5` deferral), the conviction line wraps to a second visual line at the container's text-wrap boundary. This is acceptable because phrase max length is 24 chars and even at 11px the longest phrase consumes ~140px — far below any rail's expected min-width.

**No media queries are introduced in P1A.** No `@media` rules, no breakpoint logic, no mobile-specific handling. If a future mobile redesign opens, conviction inherits whatever rule the row container adopts.

### 4.2 Truncation behavior

The closed phrase set has max 24 chars. No truncation required at any plausible row width on desktop. ACTIVE EXECUTION MUST NOT introduce `text-overflow: ellipsis` on the conviction line — this is a sportsbook-chaos visual idiom that is hostile to bettor scanability (truncated conviction text reads as broken).

If a future PCE phase widens the vocabulary beyond ~40 chars, truncation policy is re-decided at that time. For P1A, **no truncation**.

### 4.3 Overflow behavior

Conviction lives inside the row container. If the container has `overflow: hidden` (it does not, in any of T1/T1'/T2/T3) the line would clip vertically; since it does not, the line renders in full and the row container grows to accommodate. The Discover PropRail's `max-height: 280px; overflow-y: scroll` is on the RAIL body container, not on individual row containers — the conviction line stays fully visible inside its row, and the rail's scroll absorbs the cumulative row-height increase.

**No `overflow` styles are introduced on the conviction `<div>` itself.**

### 4.4 Absence behavior (anti-fabrication, doctrine-critical) — AMENDED

Conviction is GATED on the helper's `if (!convictionNote) return null` check inside `ConvictionNote.tsx`. The gate is invoked on every target surface.

Anti-fabrication implications — there are now **five distinct absence cases**, all of which render exactly the same byte-identical "nothing":

1. **Curated-layer absence — neutral PCE:** When PCE-1A is "neutral" (all four canonical inputs absent for a play that IS in a featured bucket), backend returns `convictionNote: null` on that FeaturedPlay. Helper renders nothing. Curated surface (FeaturedCard, RecommendationLadder slot) looks pre-P1A.

2. **Curated-layer absence — gated:** When PCE-1A is gated by side (under), pitcher prop, or non-offensive stat, same backend null. Helper renders nothing.

3. **Backend payload absence — legacy / version mismatch:** When the backend version predates PCE-1A or for any reason omits the field, same outcome. Helper renders nothing.

4. **Battlefield-layer no-curated-overlap (NEW under amendment):** When a `Candidate` row in PropRail / LadderExplorer does NOT appear in `state.featured.*` (it's broad-pool-only, not curated), the featured-overlap index lookup returns null. The row renders no `<ConvictionNote>` element at all. The row's primary 5-column grid renders byte-identically to pre-P1A.

5. **Battlefield-layer curated-overlap-but-no-conviction (NEW under amendment):** When a `Candidate` row matches a FeaturedPlay but that FeaturedPlay has `convictionNote: null`, the index does not contain the play (per §3.6.2 — only plays with non-empty `convictionNote` are indexed). Lookup returns null. Row renders no conviction.

**Cases 4 and 5 are the load-bearing new absence modes under the amended architecture.** They are NOT regressions; they are the doctrinally-correct outcome of the battlefield-vs-curated cementing. Most battlefield rows will fall into case 4 (no curated overlap) — this is the EXPECTED, doctrinally-correct, sparse-distribution outcome.

**The honest-empty principle on the battlefield:** for the vast majority of rows in a Discover rail (typically 70–90%), conviction renders nothing — because the curated layer has not anointed that prop. This is not a bug. It is the felt-flow signal the architecture is selling: *breadth visible, with the curated subset visibly annotated within it.*

**What is forbidden:**
- Rendering a "(not curated)" placeholder on non-overlap rows.
- Rendering a dimmed em-dash or `◆ —` on non-overlap rows.
- Inferring conviction from raw fields on the Candidate (FE-side PCE recomputation).
- Logging or surfacing the non-overlap count anywhere in the UI.
- Any UI element that visually distinguishes non-overlap rows from overlap-rows-without-conviction.

The surface looks identical to its pre-P1A state for every row where conviction is absent, regardless of which of the five absence cases applies.

### 4.5 No-fallback rule

If `convictionNote` is present but `convictionReasonTag` is absent or unrecognized, the inline color ternary falls through to the neutral branch (`var(--ws-muted, #6b6b6b)`). The phrase still renders with `◆` prefix and italic, just in neutral gray. This is a defensive degradation, not a fabrication — the canonical phrase is honored, and the color is the least-load-bearing fallback.

### 4.6 No interaction states

Conviction is **read-only text**. No click handler, no hover effect on the line itself (the row may have its own hover), no focus state, no aria-expanded, no expand-to-detail affordance. The `title` attribute provides the canonical derivation on hover — that is the only interaction surface conviction owns.

---

## 5. BATTLEFIELD-DENSITY EXPECTATIONS

### 5.1 Conviction visible without drill-in

Conviction MUST render at the same depth as the row it annotates. Specifically:
- On Discover PropRail rows: visible the moment the rail is expanded (one click after game expand). No additional drill-in to reveal.
- On LadderExplorer leg rows: visible the moment the player ladder is expanded.
- On SlipLegRow: visible immediately on slip card render (slip cards are not collapsed; legs render with the card).
- On RecommendationLadder slot picks: visible on Dashboard load (the ladder is the Dashboard's primary scan-line — no drill-in at all).

Conviction is **never** behind a hover, tooltip, expansion toggle, or modal. The `title` tooltip carries the canonical derivation for operator hover, but the bettor-readable phrase is always visible when present.

### 5.2 No surface clutter

Conviction is ONE LINE of 11px italic text per row. The five-phrase vocabulary is short by construction. There is no chip frame, no background color, no icon other than `◆`, no per-row badge stack. The line adds visual weight comparable to `processNote` — a sibling already accepted into the surface.

Quantified density budget (per row, when present):
- Vertical: +14px max
- Horizontal: ≤140px text width at 11px italic
- Visual weight: 1 sigil + 1 short italic phrase, opacity 0.85

This budget is **lower** than the existing inline annotation strip on FeaturedCard (`confStr / booksStr / volStr / deltaStr / SOFT / STALE` is a 6-element monospace ribbon at 10px). Conviction is **not the densest** signal on the surface — it slots in below an already-accepted density baseline.

### 5.3 No sportsbook-chaos regression

The conviction line specifically avoids every visual idiom that signals "sportsbook chaos":
- No high-saturation colors (uses the muted tri-color palette already in FeaturedCard)
- No animation, no pulse, no flash
- No CTA wrapping
- No price/payout text adjacency change
- No marketing emoji (the `◆` is a typographic mark, not a brand glyph)
- No "BOOM" / "LOCK" / "🔒" copy (forbidden by `PRODUCT_IDENTITY.md` lines 47–60 in any case)

Conviction reads as **operator annotation**, not as **promotional badge**. This is the exact tone calibration FeaturedCard already established and which propagation must preserve.

### 5.4 Felt-flow expectation

After P1A lands, the Discover prop rail row — *for the curated-overlap subset of rows* — should read as:
```
Aaron Judge NYY · over 1.5 TB    +110   +4.2%   DK    [+]
◆ earned upside profile
```
in green, italic, 11px sans, opacity 0.85. Not flagged. Not framed. Not bolted on. **Ambient.**

The bettor's perceived experience: "the system has an opinion about this prop, and the opinion looks like the same opinion it expressed on the curated Featured cards." Not "a new conviction feature was added." The propagation succeeds when the conviction sits below the row as if it had always been there.

### 5.5 Sparse-distribution felt-experience validation (amended)

Because conviction renders ONLY where canonical FeaturedPlay overlap exists (§0.A, §3.6), the FE will display conviction on a sparse, non-uniform subset of battlefield rows. This is the felt-flow signal — and it must be validated against bettor experience.

**5.5.1 Clustered conviction rendering**
When the curated layer concentrates on an explosive game, that game's PropRail will show a higher density of conviction-lit rows. Example: a Coors-Field-style explosive game card may have 6 of its 22 rail rows conviction-lit; an adjacent game card may have 0 of 14. **This asymmetry is informational, not visual noise.** The bettor reads: *"the curated layer is alive on THIS game, quieter on THAT game."*
- ✅ Battlefield still feels **abundant** — every game card still shows full breadth; only the annotation overlay differs.
- ✅ Battlefield still feels **alive** — clustering communicates curated-layer attention.
- ✅ Battlefield still feels **edge-aware** — the conviction-lit subset is exactly the edge the system has decided to anoint.
- ✅ NOT cluttered — non-curated rows stay canonical-baseline; the rail's density baseline is unchanged.
- ✅ NOT over-signaled — only ~10–18% of rows carry the signal.
- ✅ NOT fake-intelligent — conviction text is canonical PCE-1A output, rendered verbatim, with no FE inference.

**5.5.2 Non-uniform battlefield signaling**
Within a single rail (e.g., the HR family rail on a single game), conviction may light up rows 2 and 7 of 12 — based on which props the curated layer included in `state.featured.bestHr`. The bettor reads: *"these particular HR props are also in the system's curated picks."* The non-lit rows still render their canonical 5-column primary; they are not visually demoted, framed, or dimmed.

**Critical risk vector and its mitigation:** the eye is naturally drawn to the colorful italic ◆ lines, which could make non-lit rows feel like "negative space." This is the intended hierarchy (curated subset draws attention within the breadth), but it must NOT degrade into a perception that non-lit rows are *worse* or *not worth scanning*. Mitigations baked into the spec:
- Conviction font-size 11px italic is **identical** to processNote font-size — conviction does not visually outweigh the existing annotation cadence.
- Conviction colors are **muted** (#2e7d32 / #b26a00 / #6b6b6b) — not the high-chroma `--ws-positive` / `--ws-warn` of slot accents. The ◆ lines are dimmer than the primary row content (opacity 0.85). They draw the eye but do not dominate it.
- Non-lit rows are **unchanged** — no opacity reduction, no styling delta. They stand on their own merits (edge, odds, model probability, book).

The result is a row hierarchy that reads as: *"primary row content first, conviction subordinate gloss second."* The breadth remains the primary scan layer; conviction is editorial annotation.

**5.5.3 Mixed conviction/non-conviction rows in a single rail**
Realistic per-rail render cadence on an MLB hits/HR/TB rail of 30 props:
```
[row]                              ← canonical baseline (no curated overlap)
[row]                              ← canonical baseline
[row]
  ◆ earned upside profile          ← curated overlap, conviction shown
[row]
[row]
[row]
[row]
  ◆ lineup-supported edge          ← curated overlap, conviction shown
[row]
[row]
... (etc, ~3–8 conviction-lit out of 30)
```
The dashed `borderBottom: 1px solid var(--ws-border-faint, #222)` provides uniform cadence regardless. Conviction-lit rows are taller by ~14px; the rail's `max-height: 280px, overflow-y: scroll` absorbs it. No reflow concerns; no scroll-jump on rail expansion.

**5.5.4 LadderExplorer mixed rendering**
A player ladder of 5 legs may show conviction on legs 2 and 4 (curated overlap on those specific lines) and not on 1, 3, 5. Realistic mixed-distribution per player-block. Same rules: tucked `◆` line on overlap-hit legs, no annotation on others. The player-block header does NOT aggregate conviction state across legs (§3.2 amended).

**5.5.5 Verdict on battlefield felt-experience under amended approach**

| Property | Status under amended T1/T2 |
|---|---|
| Abundant | ✅ Preserved — full canonical pool still rendered; conviction is overlay, not filter |
| Alive | ✅ Reinforced — clustering communicates curated-layer attention to specific games/players |
| Edge-aware | ✅ Newly surfaced — the curated subset is now visibly distinguishable within the breadth |
| Cluttered | ✅ Avoided — sparse render (10–18% of rows); muted typography; subordinate visual weight |
| Over-signaled | ✅ Avoided — case 4 + case 5 absence behavior (§4.4) keep most rows silent |
| Fake-intelligent | ✅ Avoided — conviction text is canonical, render is verbatim, no FE-side inference, no approximate match, no synthesized signals |

The amended approach delivers the felt-flow benefit P1A targets *without* the architectural cost the original T1 approach would have incurred (silent fork of `Candidate` authority).

---

## 6. FE CHOKEPOINTS THAT COULD SUPPRESS CANONICAL CONVICTION RENDERING — AMENDED

Identified during scoping. ACTIVE EXECUTION must verify each before/during implementation.

**C-1 and C-2 from the original spec are now classified as FORBIDDEN DIRECTIONS, not chokepoints with mitigations.** They describe the type-widening approach that MCR's amended ruling has explicitly rejected (§0.A). They are preserved here with strikethrough as a doctrine record so future readers see why type widening is not in this spec.

| # | Chokepoint | Location | Suppression risk | Mitigation |
|---|---|---|---|---|
| ~~C-1~~ | ~~Candidate type lacks convictionNote / convictionReasonTag~~ | ~~types.ts~~ | **FORBIDDEN — DO NOT WIDEN** | Type-widening `Candidate` to carry conviction is now explicitly forbidden by §0.A. The architectural correct approach is featured-overlap lookup (§3.6) |
| ~~C-2~~ | ~~AiSlipLeg type lacks the same fields~~ | ~~types.ts~~ | **FORBIDDEN — DO NOT WIDEN** | Same as C-1. Use featured-overlap lookup |
| C-3 | `buildSlipAi` does not propagate conviction onto leg payload | `backend/pipeline/shared/buildSlipAi.js` | Was a concern under type-widening approach; now moot | Obsolete under amended approach — leg conviction reads from featured-overlap, not from leg payload |
| C-4 | PCE outputs may or may not be attached to `Candidate` rows by `scoreCandidate` | `backend/pipeline/shared/buildFeaturedPlays.js` | Was a concern under type-widening approach; now moot | Obsolete under amended approach — the battlefield surfaces NEVER read PCE outputs from `Candidate`. They read them from `state.featured.*` via overlap-lookup |
| C-5 | PCE-1A bypasses pitcher / under / non-offensive stats | `playerConvictionEngine.js` lines 188–190 | Most rows have no curated overlap AND most curated plays have no PCE fire — silence is correct | No mitigation needed; this IS anti-fabrication. Surface looks unchanged on non-fire rows. Verify §4.4 cases 1–3 preserved |
| C-6 | `--ws-good` and `--ws-muted` CSS variables are not defined | `workstation.css` | Color falls through to hex fallback every time | Acceptable. The hex fallbacks ARE the canonical colors. Do NOT add these variables in P1A |
| C-7 | PropRail row uses 5-column grid; `.ws-feat-reason`'s default `grid-column: 2 / -1` mis-aligns | `GameDiscoveryView.tsx` lines 405–432 | Conviction line indents under odds column, not under player | Wrap `<ConvictionNote>` in `<div style={{ gridColumn: "1 / -1" }}>`. Documented in §3.1 |
| C-8 | SlipLegRow's `.ws-slip-leg` is `display: grid` 7-column | `workstation.css` line 266 | Naïve `<div>` append breaks grid layout | Wrap `<ConvictionNote>` in `<div style={{ gridColumn: "1 / -1" }}>`. Documented in §3.3 |
| C-9 | Rail body has `max-height: 280px; overflow-y: scroll` | `GameDiscoveryView.tsx` line 398 | Cumulative height increase from conviction lines is absorbed by scroll | Do NOT modify rail's max-height/overflow |
| C-10 | Inline color ternary across multiple call sites is fragile | now centralized in `ConvictionNote.tsx` | RESOLVED in T3 — helper is single canonical authority | No further action; T1/T2 reuse the same helper |
| C-11 | RecommendationLadder shadow-render risk | RecommendationLadder.tsx | Verified absent during audit | RESOLVED in T3 — confirmed clean |
| **C-12 (NEW)** | **`Candidate.id` ↔ `FeaturedPlay.id` join correctness** | `backend/pipeline/shared/buildFeaturedPlays.js` normalizeCandidate id allocation; FE `state.candidates[i].id` and `state.featured.anchors[i].id` | If ids diverge for the same canonical prop, every battlefield lookup misses and T1/T2 silently produce zero conviction | ACTIVE EXECUTION verifies empirically before shipping (§3.6.3). If ids match → primary join is authoritative. If ids diverge → route back to MCR; do NOT silently fall back to composite-key matching |
| **C-13 (NEW)** | **Featured-overlap index rebuild cost** | new `convictionOverlap.ts` module | If index rebuilds on every row render, performance degrades on rails with 30+ rows | Memoize the index at the `GameDiscoveryView` / `AiSlipsView` level using `useMemo` keyed on `state?.featured`. Documented in §3.6.5 |
| **C-14 (NEW)** | **Sparse-distribution misread risk** | rail visual hierarchy | Bettor could perceive non-conviction rows as "demoted" or "low-quality" | Mitigated by spec design (§5.5.2): conviction typography subordinate to row primary, muted colors, no styling delta on non-conviction rows. ACTIVE EXECUTION must verify visually post-implementation that the unchanged rows still feel scan-worthy |
| **C-15 (NEW)** | **`state.featured` null / partial paths** | `state.featured?.bestHr ?? []` etc | If a backend version omits a featured bucket, that bucket's contributions vanish from the overlap index | Acceptable. Index becomes smaller; battlefield surfaces show fewer conviction lines on that slate. This is graceful degradation, not a bug. Documented in §3.6.5 (empty Map case) |

---

## 7. NON-GOALS / EXPLICIT DEFERRALS — AMENDED

P1A explicitly DOES NOT:
- Render conviction on `HeroPickCard`, `SpotlightCard`, `VerdictCard`, `BetBuilderDock`, `PortfolioView`, or any non-listed surface
- Introduce a "conviction lens" or "by-conviction" sort option to Discover
- Modify the PCE-1A phrase vocabulary, color mapping, sigil, tooltip text, or weight
- Add `--ws-good` / `--ws-muted` CSS variables to `workstation.css`
- Add a per-conviction-tag CSS class (e.g., `.ws-conviction-earned`)
- Add a "show me earned upside only" filter anywhere
- Introduce a backend mutation, a new conviction field, an alternate phrase taxonomy, or any LLM/GPT layer
- Promote conviction into composite-score visibility (the score remains as today)
- Modify the FeaturedCard render block (reference implementation is frozen in `ConvictionNote.tsx`)
- Adjust the absence-behavior rule (no placeholders ever)

**Amendment-added non-goals (per MCR ruling §0.A):**
- **Widen `Candidate` to carry `convictionNote` / `convictionReasonTag`** — explicitly forbidden as canonical fork
- **Widen `AiSlipLeg` to carry the same** — explicitly forbidden as canonical fork
- **FE-side recomputation of PCE-1A from raw `Candidate` fields** — forbidden as canonical-authority violation
- **Flatten conviction uniformly across battlefield surfaces** — forbidden as it would inverse the curated-layer gate
- **Approximate-match join** (player-only / stat-only / fuzzy) on overlap lookup — forbidden as fabrication-adjacent
- **Render any visual element that distinguishes non-overlap rows from overlap-rows-without-conviction** — forbidden; both render byte-identically (canonical baseline)
- **Aggregate conviction state at any container level** (player-block, slip card, game card) — forbidden; conviction is per-row only in P1A

Each of the above is either permanently forbidden by §0.A or a candidate for a future post-P1A phase routed through MCR.

---

## 8. SUCCESS CRITERIA (for ACTIVE EXECUTION sealing) — AMENDED

P1A is sealed when:
1. **T3 (RecommendationLadder)** — ✅ SEALED 2026-05-17. `ConvictionNote.tsx` helper extracted; FeaturedCard rerouted byte-identically; RecommendationLadder slot picks render via helper.
2. **T1 (Discover PropRail + LadderExplorer leg)** — renders conviction via featured-overlap lookup (§3.6). No `Candidate` type widening. Sparse-distribution behavior matches §5.5. Empirical id-join verification per §3.6.3 / C-12 passed before ship.
3. **T2 (SlipLegRow)** — renders conviction via the same featured-overlap lookup. No `AiSlipLeg` type widening. Same sparse-distribution behavior.
4. `cd frontend && npx tsc --noEmit` clean.
5. **All five absence cases from §4.4 verified** — rows in cases 1–5 render byte-identically to pre-P1A. Particular emphasis on case 4 (non-overlap on battlefield) and case 5 (overlap-but-no-conviction) — both are the new high-frequency absence modes.
6. The `◆` sigil, italic, opacity 0.85, tri-color ternary, and tooltip string remain byte-identical at all call sites — guaranteed by single `ConvictionNote.tsx` helper authority.
7. No new CSS class is added to `workstation.css`. No new CSS variable. No new visual idiom.
8. The new `convictionOverlap.ts` module (or equivalent — ACTIVE EXECUTION chooses path within `frontend/src/workstation/`) contains the pure index-builder and lookup function per §3.6.4. It is the only new code surface beyond JSX wiring at the two new call sites.
9. Verifier `verifyPlayerConvictionEngine1A.js` continues to PASS (no backend touch).
10. A new `verifyFeAsymmetryP1A.js` is added under `backend/scripts/` asserting (via static grep, not runtime):
   - exactly one `ConvictionNote` definition exists in `frontend/src/workstation/components/`;
   - exactly four `<ConvictionNote …/>` call sites exist (FeaturedCard + RecommendationLadder slot + PropRail row + LadderExplorer leg + SlipLegRow — actual count is **five** if all P1A targets shipped, or fewer if any deferred);
   - no occurrence of `convictionNote` or `convictionReasonTag` exists on `Candidate` or `AiSlipLeg` interfaces in `types.ts` (asserts the canonical fork has not been silently introduced);
   - the new `convictionOverlap.ts` module exists and exports the canonical index-builder name.
   Per `NEXT_PHASE.md` template, every phase ships a helper verifier.
11. **Sparse-distribution visual sanity-check** — ACTIVE EXECUTION captures one screenshot of an MLB Discover rail showing the mixed-distribution case (some rows with conviction, some without), verifies the non-conviction rows look canonical-baseline, and verifies the conviction-lit rows look identical to the FeaturedCard treatment. Visual report attached to the seal record.
12. **C-12 empirical id-join verification** — a single log entry or snapshot demonstrating `Candidate.id === FeaturedPlay.id` for at least one canonical match across a live slate. If the join fails, escalate per §3.6.3.
13. 6-doc reconciliation: `CURRENT_STATE.md` / `NEXT_SESSION.md` / `MASTER_BRAIN.md` / `CURRENT_RUNTIME_STATE.md` / `MODEL_EVOLUTION_LOG.md` / `OPERATOR_RUNBOOK.md` updated under additive doctrine.
14. Anchor-file reconciliation: `ACTIVE_PHASE.md` flipped to FE-Asymmetry-P1A · SHIPPED + SEALED; `NEXT_PHASE.md` "last sealed" updated; `CURRENT_PROBLEMS.md` moves the FE-asymmetry bottleneck to 🟢 SOLVED.
15. This artifact (`docs/FE_ASYMMETRY_P1A_RENDER_SPEC_2026-05-17_PENDING_AE.md`) is renamed to drop the `_PENDING_AE` suffix and lands as canonical at MCR's discretion.

---

## 9. ACTIVE EXECUTION HANDOFF NOTES

- This artifact is the **single render-spec authority** for P1A. Do not fork its rules into per-component micro-specs.
- The reference implementation is FeaturedCard.tsx lines 128–150, byte-for-byte. Treat it as immutable in this phase.
- Three propagation surfaces, ordered by recommended landing: T3 → T1 → T2.
- Eleven chokepoints documented in §6. Verify each before the corresponding render-site lands.
- Anti-fabrication absence behavior (§4.4) is the **single most load-bearing rule** in this spec. A regression on absence behavior is a P1A failure regardless of how good the present-case rendering looks.
- If anything in this spec conflicts with `PRODUCT_IDENTITY.md` (anti-fabrication / hidden-value / soft-lens / bettor-native), `PRODUCT_IDENTITY.md` wins and ACTIVE EXECUTION routes the conflict back through MCR before shipping.
- This spec does NOT modify any other lane's authority. INFRA / GOVERNANCE continues R4 verifier extensions in parallel under its own lane; ecology-authority surfaces remain blocked behind R3 as MCR specified.

— end of P1A render-spec artifact (PENDING_AE) —

---

## §A1 — AMENDMENT ATTESTATION

**Amendment date:** 2026-05-17
**Amendment author lane:** FRONTEND / UX LAB
**Triggered by:** MASTER CONTROL ROOM finalized T1 architectural ruling (§0.A)
**Authorized phase scope:** Option A — featured-derived canonical overlap lookup propagation
**Amendment class:** in-place revision of the canonical P1A render-spec artifact. No new artifact created. No shadow fork. Additive-only doctrine preserved by recording the prior approach as struck-through chokepoints (§6 C-1/C-2) and replacing draft target sections with their architecturally-correct successors.

### A1.1 Lineage

| Event | Date | Authority |
|---|---|---|
| Original spec authored | 2026-05-17 | FRONTEND / UX LAB scoping under MCR FE-Asymmetry-P1A authorization |
| T3 shipped + sealed | 2026-05-17 | ACTIVE EXECUTION (`ConvictionNote.tsx` extracted, FeaturedCard rerouted, RecommendationLadder propagated) |
| T3 FE-inspection cleared | 2026-05-17 | FRONTEND / UX LAB inspection verdict |
| MCR T1 architectural ruling finalized | 2026-05-17 | MASTER CONTROL ROOM (battlefield-vs-curated cementing; Option A authorized) |
| This amendment | 2026-05-17 | FRONTEND / UX LAB amendment in place per MCR directive |

### A1.2 Sealed-vs-pending status under the amended spec

| Target | Surface | Status |
|---|---|---|
| T3 | RecommendationLadder slot picks (curated-layer) | ✅ SHIPPED + SEALED |
| T1 | PropRail + LadderExplorer leg rows (battlefield-layer) | 🟡 PENDING — ACTIVE EXECUTION consumption under amended §3.1 / §3.2 / §3.6 |
| T2 | SlipLegRow inside SlipCard (AI-slip-leg surface) | 🟡 PENDING — ACTIVE EXECUTION consumption under amended §3.3 / §3.6 |

### A1.3 What this amendment preserves

- The `ConvictionNote.tsx` helper as the single canonical render authority (unchanged).
- FeaturedCard reroute (unchanged).
- T3 implementation (unchanged; sealed).
- §1 typography / color / sigil / tooltip / class authority (unchanged).
- §3.0 reference render block (unchanged).
- §4.1 / §4.2 / §4.3 / §4.5 / §4.6 responsive / truncation / overflow / no-fallback / no-interaction rules (unchanged).
- §5.1 / §5.2 / §5.3 / §5.4 density / clutter / chaos / felt-flow expectations (unchanged; reinforced by new §5.5).

### A1.4 What this amendment changes

- Adds §0.A formalizing the battlefield-vs-curated architectural cementing.
- Replaces §3.1, §3.2, §3.3 with featured-overlap-lookup propagation rules (Option A).
- Adds §3.6 specifying the featured-overlap-lookup mechanism, join-key strategy, memoization, and strict no-fabrication rules.
- Extends §4.4 absence behavior with cases 4 and 5 (no-overlap, overlap-but-no-conviction).
- Adds §5.5 validating sparse / clustered / non-uniform / mixed felt experience against the abundant/alive/edge-aware-without-clutter/over-signal/fake-intelligence criteria.
- Updates §6 chokepoints: C-1 / C-2 reclassified as forbidden directions (preserved with strikethrough); C-3 / C-4 / C-10 / C-11 marked resolved or obsolete; C-12 / C-13 / C-14 / C-15 added.
- Updates §7 non-goals with amendment-cemented forbidden directions.
- Updates §8 success criteria for the overlap-aware T1 + T2 approach, T3 sealed status, and the new `verifyFeAsymmetryP1A.js` assertions (including the explicit anti-fork check on `types.ts`).

### A1.5 ACTIVE EXECUTION consumption attestation

ACTIVE EXECUTION may now consume the amended T1 + T2 sections. Recommended landing order remains as in §3.5 (amended): T1 and T2 can land together (single shared overlap-index implementation), or T1 first followed by T2. Both routes are doctrinally equivalent under the amended spec.

The render-spec is doctrinally complete and architecturally coherent. The amendment closes the open T1 / T2 ambiguity in the original spec without introducing a new canonical, a new visual idiom, or a new doctrine layer.

**Returned to ACTIVE EXECUTION for T1 + T2 implementation.**

— end of amendment attestation —
