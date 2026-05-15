// tooltips.ts — Phase Operator-Experience-1B-1 (2026-05-15)
//
// Single source of truth for deterministic plain-English tooltips.
// Every function in this module takes a deterministic backend value and
// returns a human-readable explanation string. NEVER fabricates. NEVER
// invents confidence. NEVER produces "AI-style" prose.
//
// Anti-fabrication enforcement: if the input is undefined / null / NaN,
// the function returns an empty string. Caller decides whether to omit
// the title= attribute entirely (recommended) or render the dim label
// without a tooltip.
//
// Source-of-truth field references (kept in sync with backend by Law 12
// carry-forward discipline):
//   - consensusConfidence: backend/pipeline/shared/buildLineShoppingIntelligence.js:188
//     formula: clamp(0, 1, 1 - (marketDispersion / max(consensus, 0.001)))
//   - marketDispersion:    same file:185-187 (std-dev of implied probs across books)
//   - bestImpDelta:        same file:175 (bestOdds_imp - consensus)
//   - staleRowTag:         same file:152-171 (threshold ±0.025)
//   - volatility rules:    backend/pipeline/shared/buildPortfolioOptimizer.js:50-87
//   - tier boosts:         backend/pipeline/shared/buildFeaturedPlays.js:269-275
//   - portfolio score:     backend/pipeline/shared/buildPortfolioOptimizer.js:437-470
//   - portfolio mood:      same file:480-487 (5 bands)
//   - timing state/urgency: backend/pipeline/shared/buildMarketTimingIntelligence.js
//   - CLV / archetype:     backend/pipeline/shared/buildFeaturedPlays.js scoreCandidate
//
// Phase Operator-Experience-1B-1 doctrine: reduce translation cost between
// sportsbook-native intelligence and operator-native understanding. Every
// tooltip in this file is a function of existing backend fields; no values
// are invented.

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

// ─── consensusConfidence ────────────────────────────────────────────────────
// Input: float [0, 1]. 1.0 = books unanimous; 0.0 = wide disagreement.
// Threshold language follows the actual buildLineShoppingIntelligence formula.

export function tooltipForConsensusConfidence(v: unknown, bookCount?: number): string {
  if (!isNum(v)) return ""
  const pct = (v * 100).toFixed(0)
  const books = isNum(bookCount) && bookCount > 0 ? ` Across ${bookCount} book${bookCount === 1 ? "" : "s"}.` : ""
  if (v >= 0.85) return `Consensus confidence: ${pct}/100. Books are largely aligned on this line.${books}`
  if (v >= 0.60) return `Consensus confidence: ${pct}/100. Some book-to-book disagreement on the implied probability.${books}`
  if (v >= 0.30) return `Consensus confidence: ${pct}/100. Notable disagreement across books — interpret line value with care.${books}`
  return `Consensus confidence: ${pct}/100. Wide disagreement — books are not aligned on what this should be priced.${books}`
}

// ─── bestImpDelta (vs consensus) ────────────────────────────────────────────
// Input: signed float (decimal implied prob points). Negative = bettor value.
// 1 "implied prob point" ≈ 1 percentage point of implied probability.

export function tooltipForBestImpDelta(v: unknown, bestBook?: string): string {
  if (!isNum(v)) return ""
  const mag = Math.abs(v * 100).toFixed(1)
  const who = bestBook ? `${bestBook}` : "The best book"
  if (v < -0.01) return `${who} prices this ~${mag}¢ below consensus on implied probability — i.e., better-than-consensus odds for the bettor (a value gap).`
  if (v > 0.01)  return `${who} prices this ~${mag}¢ above consensus on implied probability — i.e., the best available is still worse than the cross-book consensus.`
  return `${who}'s price matches the cross-book consensus within ~${mag}¢ of implied probability.`
}

// ─── staleRowTag pills ──────────────────────────────────────────────────────

export function tooltipForStaleTag(tag?: string, book?: string, delta?: unknown): string {
  if (!tag) return ""
  const deltaStr = isNum(delta) ? ` (${(Math.abs(delta) * 100).toFixed(1)}¢ from consensus)` : ""
  const bookStr = book ? ` ${book}` : ""
  if (tag === "soft_line") return `SOFT: this book prices this prop below the multi-book consensus — possible stale-line value for the bettor.${bookStr}${deltaStr}`
  if (tag === "stale_line") return `STALE: this book prices this prop above the multi-book consensus — book may be overcorrecting or slow to update.${bookStr}${deltaStr}`
  return ""
}

// ─── volatility enum ────────────────────────────────────────────────────────
// Rule source: buildPortfolioOptimizer.js:50-87 (VOLATILITY_RULES).

export function tooltipForVolatility(v?: string): string {
  if (!v) return ""
  switch (v) {
    case "safe":       return "Volatility: safe. Low-variance pick — outcome is predictable from the model."
    case "balanced":   return "Volatility: balanced. Normal-variance pick — depends on game flow but typically follows the model."
    case "aggressive": return "Volatility: aggressive. Higher-variance pick — depends on specific events; strong upside but more swings."
    case "lotto":      return "Volatility: lotto. Long-shot pick — rare event needed; small stakes appropriate."
    default:           return `Volatility: ${v}.`
  }
}

// ─── tier enum ──────────────────────────────────────────────────────────────
// Source: tierBoost in buildFeaturedPlays.js:269-275.

export function tooltipForTier(t?: string): string {
  if (!t) return ""
  const T = t.toUpperCase()
  if (T.includes("ELITE"))   return "Tier: ELITE. Pipeline's highest-confidence band — multi-factor agreement across edge, model, market, timing."
  if (T.includes("STRONG"))  return "Tier: STRONG. High-confidence band — corroborated by multiple lenses."
  if (T.includes("PLAYABLE"))return "Tier: PLAYABLE. Standard-confidence pick — meets baseline filters."
  if (T.includes("LOTTO"))   return "Tier: LOTTO. Low-probability, high-payoff. Treat as a small-stake speculation."
  if (T.includes("FADE"))    return "Tier: FADE. Pipeline recommends against this — consider passing."
  return `Tier: ${t}.`
}

// ─── bookCount ──────────────────────────────────────────────────────────────

export function tooltipForBookCount(n: unknown): string {
  if (!isNum(n) || n < 1) return ""
  if (n === 1) return "Only one sportsbook carries this prop right now — consensus can't be measured."
  return `${n} sportsbooks currently carry this prop — cross-book consensus is measurable.`
}

// ─── EV (expected value, slip) ──────────────────────────────────────────────
// Source: buildSlipAi.js combineLegs — ev = combinedModelProb * (dec-1) - (1-combinedModelProb)
// Units: per $1 staked.

export function tooltipForSlipEv(v: unknown): string {
  if (!isNum(v)) return ""
  const pct = (v * 100).toFixed(1)
  if (v > 0)  return `Expected Value: +${pct}%. Per $1 staked, the model projects +$${(v).toFixed(2)} on average across many similar slips.`
  if (v < 0)  return `Expected Value: ${pct}%. Per $1 staked, the model projects a $${Math.abs(v).toFixed(2)} loss on average across many similar slips.`
  return "Expected Value: 0%. Model projects break-even on this slip."
}

// ─── Combined modelProb (slip win probability after calibration) ────────────
// Source: buildSlipAi.js combineLegs — calibrated joint probability product.

export function tooltipForSlipProb(v: unknown): string {
  if (!isNum(v)) return ""
  const pct = (v * 100).toFixed(0)
  return `Combined model probability: ${pct}%. Calibration coefficients (per stat family) are applied to each leg before multiplication — this is the post-calibration win probability for the parlay.`
}

// ─── Portfolio score (0–100) ────────────────────────────────────────────────
// Source: buildPortfolioOptimizer.js:437-470.
// Bands: 85+ healthy / 72+ mostly diversified / 60+ some concentration / 45+ elevated / <45 high correlation.

export function tooltipForPortfolioScore(score: unknown): string {
  if (!isNum(score)) return ""
  const band =
    score >= 85 ? "Healthy diversification — spread across players / games / stats / books looks balanced." :
    score >= 72 ? "Mostly diversified — minor concentration but acceptable." :
    score >= 60 ? "Some concentration — review your top game / player / stat exposures." :
    score >= 45 ? "Elevated concentration — heavy overlap in one or more dimensions." :
                  "High correlation — consider trimming overlapping bets before locking in."
  return `Portfolio score: ${score.toFixed(0)}/100. Bands: 85+ healthy · 72+ mostly diversified · 60+ some concentration · 45+ elevated · <45 high correlation. ${band}`
}

// ─── Correlation cluster level ──────────────────────────────────────────────
// Source: buildPortfolioOptimizer.js correlation threshold table.

export function tooltipForCorrelationLevel(level?: string): string {
  if (!level) return ""
  switch (level.toLowerCase()) {
    case "high":     return "HIGH correlation: these picks are likely to win or lose together. Consider trimming overlap before locking in."
    case "moderate": return "MODERATE correlation: these picks share some outcome dependency. Worth a second look."
    case "low":      return "LOW correlation: picks are largely independent."
    default:         return `Correlation level: ${level}.`
  }
}

// ─── Disagreement-filter chip tooltips (LineShoppingView) ───────────────────

export function tooltipForDisagreementFlag(flag?: string): string {
  if (!flag) return ""
  switch (flag) {
    case "soft_book":
      return "Soft book: this sportsbook underprices the prop vs the cross-book consensus — possible bettor value."
    case "stale_line":
      return "Stale line: this sportsbook overprices the prop vs the cross-book consensus — book may be slow to update."
    case "market_disagreement":
      return "Market disagreement: books are not aligned on implied probability — interpret the line carefully."
    default:
      return `Flag: ${flag}.`
  }
}

// ─── Sort-option tooltips (LineShoppingView) ────────────────────────────────

export function tooltipForSortOption(sort?: string): string {
  if (!sort) return ""
  switch (sort) {
    case "impSpread":
      return "Sort by implied-probability spread — the actionable cross-book edge. Larger = bigger gap between best and worst implied probability."
    case "spread":
      return "Sort by raw American-odds spread — display only, not a reliable edge metric."
    case "best":
      return "Sort by best (highest American) odds available."
    default:
      return `Sort: ${sort}.`
  }
}

// ─── Timing state / urgency (KpiCard) ──────────────────────────────────────
// Source: buildMarketTimingIntelligence.js — state {stable, drifting, steam, stale_window, …}
//                                            urgency {immediate, soon, patient, wait, avoid}

export function tooltipForSteamCount(n?: unknown): string {
  if (!isNum(n)) return ""
  return `Steam count: ${n}. "Steam" means a sportsbook line has moved meaningfully recently, signaling sharp money or breaking news.`
}

export function tooltipForStaleWindowCount(n?: unknown): string {
  if (!isNum(n)) return ""
  return `Stale-window count: ${n}. A "stale window" is a prop where one or more books are slow to update vs the cross-book consensus — potential bettor value if it's the bettor's side.`
}

// ─── Slip-tier chip labels (AiSlipsView) ────────────────────────────────────

export function tooltipForSlipTierChip(tierId?: string): string {
  if (!tierId) return ""
  switch (tierId) {
    case "safe":       return "Core: safe-tier parlays. Lower combined odds, higher individual modelProb, tight diversification (1 leg per game, 1-2 per stat family)."
    case "balanced":   return "Value Mix: balanced-tier parlays. Mid-range combined odds, mix of safe and balanced legs, FAMILY_CALIBRATION_COEFFICIENTS applied."
    case "aggressive": return "Fire Shots: aggressive-tier parlays. Higher combined odds, volatile leg seeding. Phase Realism-1A AGG-2 (maxPerGame=1) and TEXT-1 (halved over-side boost) applied."
    case "lotto":      return "Moon Shots: lotto-tier parlays. Long-shot combined odds, 3-5 legs, low individual modelProb floor. Treat as speculation."
    default:           return ""
  }
}

// ─── AI-Parlay KPI sub-labels ──────────────────────────────────────────────

export function tooltipForAiParlayMix(safe: number, balanced: number, aggressive: number, lotto: number): string {
  return `Slip count by tier — core (safe): ${safe} · mix (balanced): ${balanced} · fire (aggressive): ${aggressive} · moon (lotto): ${lotto}.`
}

// ─── Anchor count KPI ──────────────────────────────────────────────────────

export function tooltipForAnchorCount(n: unknown): string {
  if (!isNum(n)) return ""
  return `Anchors: ${n} highest-trust picks of the night. Each anchor cleared corroboration filters (edge + CLV + archetype + market + timing).`
}

// ─── Book Coverage KPI ─────────────────────────────────────────────────────

export function tooltipForBookCoverageCount(n: unknown): string {
  if (!isNum(n)) return ""
  return `Multi-book props: ${n} unique props are currently priced by 2 or more sportsbooks tonight — these are the props with measurable consensus.`
}

// ─── Risk-flag mood tooltip ────────────────────────────────────────────────

export function tooltipForMoodHeadline(headline?: string, tone?: string): string {
  if (!headline) return ""
  const toneStr = tone ? ` (tone: ${tone})` : ""
  return `Portfolio mood: ${headline}${toneStr}. Derived deterministically from the portfolio score band — see score tooltip for the 5-band guide.`
}

// ─── CLV reasoning tag tooltip ─────────────────────────────────────────────

export function tooltipForClvTag(): string {
  return "CLV = Closing Line Value. A 'positive CLV' tag means historical bets in this stat family have, on average, beaten the closing line — a key proxy for sustainable edge regardless of single-bet outcome."
}

// ─── Archetype tag tooltip ─────────────────────────────────────────────────

export function tooltipForArchetypeTag(): string {
  return "Archetype = the player/stat-family profile pattern. An 'archetype proven' tag means historical bets matching this pattern have shown positive ROI over the rolling window."
}

// ─── Steam tag tooltip ─────────────────────────────────────────────────────

export function tooltipForSteamTag(): string {
  return "Steam = the line has moved meaningfully recently across multiple books, often signaling sharp money or breaking news. Timing-sensitive — act before further movement."
}

// ─── Generic processNote / attackNote / avoidReason wrap ───────────────────

export function tooltipForProcessNote(note?: string): string {
  if (!note) return ""
  return `Process note: ${note}`
}

export function tooltipForAttackNote(note?: string): string {
  if (!note) return ""
  return `Attack note: ${note}`
}

export function tooltipForAvoidReason(reason?: string): string {
  if (!reason) return ""
  return `Avoid reason: ${reason}`
}
